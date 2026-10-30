// Base factice du banc des failles 3 et 4 (audit Décupleur 30/10) : la base en mémoire des autres bancs (fake-supabase-dc.ts)
// avec, en plus :
//   · une LATENCE réseau (10 ms fixe, ou 2 à 20 ms tirée d'une graine fixe) avant chaque requête et chaque RPC : 30 requêtes envoyées au même
//     instant s'entremêlent comme sur la vraie base (lectures des unes avant les insertions des autres) ;
//   · select('…', { count: 'exact', head: true }) → { count } (comme PostgREST) ;
//   · auth.getUser() lu dans l'en-tête Authorization du client (jeton → utilisateur : db.tokens) ;
//   · les modèles JS des fonctions SQL utilisées par render-job pour le Décupleur. Une fonction SQL s'exécute d'un bloc
//     (verrou, comptage, insertion dans la même transaction) : ici, d'un bloc SYNCHRONE, sans await au milieu.
//     render_job_dc_creer = MÊME règle que supabase/migrations/20261030140000_decupleur_file_atomique.sql (à garder
//     identique ; le SQL réel est rejoué sur Postgres par test-faille34-sql.ts). Relecture 30/10 : + mc-ref, p_compte,
//     « 1 travail gratuit court par compte » (court_en_cours), quota de découpes. Aussi utilisé par le banc MCP
//     (test-faille34-mcp.ts : /start des cartes Claude).
import { FakeDB, FakeStorage, createClient as baseClient } from './fake-supabase-dc.ts'
export { FakeDB, FakeStorage }

let graine = 20261030
const hasard = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648 }
// latence « fixe » (globalThis.__latenceFixe = true) : toutes les requêtes avancent en phase — le pire cas décrit par l'audit
// (les 30 comptages passent avant la 1re insertion) ; sinon variable (entremêlement partiel).
const latence = () => new Promise((r) => setTimeout(r, (globalThis as any).__latenceFixe ? 10 : 2 + Math.floor(hasard() * 18)))

type Row = Record<string, any>
const DC = ['dc-fetch', 'dc-cut', 'decupleur']
const TOUS = [...DC, 'mc-ref'], COURTS = ['dc-fetch', 'dc-cut', 'mc-ref']

export function rpcsDecupleur(db: FakeDB) {
  const ops = () => db.rows('credit_ops')
  const cles = new Map<string, number[]>()
  return {
    rate_hit: (a: any) => {   // fenêtre glissante, comme public.rate_hit
      const t = Date.now(), l = (cles.get(a.p_key) || []).filter((x) => t - x < a.p_window_s * 1000)
      if (l.length >= a.p_max) { cles.set(a.p_key, l); return false }
      l.push(t); cles.set(a.p_key, l); return true
    },
    render_job_dc_creer: (a: any) => {
      // MIGRATION=1er (ab-faille34.sh) : la fonction telle que le 1er correctif l'écrivait (commit 9e56e41d) — ni mc-ref, ni
      // p_compte, ni « 1 travail court », ni quota de découpes
      if ((globalThis as any).__migration1er) a = { ...a, p_compte: undefined, p_court_en_cours_max: null, p_cut_quota: null }
      const compose = a.p_plan?.__compose
      const compte: string[] = a.p_compte ?? DC
      if ((globalThis as any).__migration1er && compose === 'mc-ref') throw new Error('render_job_dc_creer : job Décupleur invalide')
      if (!a.p_user || !a.p_input || !a.p_plan || typeof a.p_plan !== 'object' || !TOUS.includes(compose)
        || !compte.length || !compte.every((c) => TOUS.includes(c))) throw new Error('render_job_dc_creer : job Décupleur invalide')
      const vivant = new Date(Date.now() - 45 * 60_000).toISOString()
      const depuis = new Date(Date.now() - Math.max(60, Math.min(a.p_fetch_fenetre_s ?? 600, 86400)) * 1000).toISOString()
      const rj = db.rows('render_jobs').filter((r) => r.user_id === a.p_user)
      const enCours = (cs: string[]) => rj.filter((r) => ['queued', 'rendering'].includes(r.status) && cs.includes(r.plan?.__compose) && String(r.updated_at) >= vivant).length
      const recents = (c: string) => rj.filter((r) => r.plan?.__compose === c && String(r.created_at) >= depuis).length
      if (enCours(compte) >= Math.max(1, Math.min(a.p_en_cours_max ?? 3, 10))) return { ok: false, raison: 'en_cours' }
      if (compose === 'dc-fetch' && a.p_fetch_en_cours_max != null && enCours(['dc-fetch']) >= Math.max(1, Math.min(a.p_fetch_en_cours_max, 10))) return { ok: false, raison: 'fetch_en_cours' }
      const courtMax = a.p_court_en_cours_max === undefined ? 1 : a.p_court_en_cours_max
      if (COURTS.includes(compose) && courtMax != null && enCours(COURTS) >= Math.max(1, Math.min(courtMax, 10))) return { ok: false, raison: 'court_en_cours' }
      const fq = a.p_fetch_quota === undefined ? 6 : a.p_fetch_quota, cq = a.p_cut_quota === undefined ? 10 : a.p_cut_quota
      if (compose === 'dc-fetch' && fq != null && recents('dc-fetch') >= Math.max(1, Math.min(fq, 100))) return { ok: false, raison: 'quota' }
      if (compose === 'dc-cut' && cq != null && recents('dc-cut') >= Math.max(1, Math.min(cq, 100))) return { ok: false, raison: 'quota' }
      const now = new Date().toISOString(), id = crypto.randomUUID()
      db.rows('render_jobs').push({ id, user_id: a.p_user, status: 'queued', plan: JSON.parse(JSON.stringify(a.p_plan)), input_video: a.p_input,
        assets: a.p_assets ?? [], avatar_clips: [], created_at: now, updated_at: now, attempts: 0 })
      return { ok: true, id }
    },
    // réservations de crédits (modèle simplifié des fonctions en ligne : une op = credit_ops.reserved_remaining)
    resolve_op: (a: any) => { const o = ops().find((x) => x.id === a.p_hint && x.user_id === a.p_user && !x.refunded_at && (x.reserved_remaining || 0) > 0); return o ? o.id : null },
    draw_full_reservation: (a: any) => {
      const o = ops().find((x) => x.id === a.p_op && x.user_id === a.p_user); if (!o || (o.reserved_remaining || 0) < Math.max(1, a.p_min || 1)) return 0
      const amt = o.reserved_remaining; o.reserved_remaining = 0; o.job_drawn = (o.job_drawn || 0) + amt; return amt
    },
    release_reservation: (a: any) => { const o = ops().find((x) => x.id === a.p_op && x.user_id === a.p_user); if (o) { o.reserved_remaining = (o.reserved_remaining || 0) + a.p_cost; o.job_drawn = Math.max(0, (o.job_drawn || 0) - a.p_cost) } return true },
    bind_reservation_job: (a: any) => { const o = ops().find((x) => x.id === a.p_op && x.user_id === a.p_user); if (!o || o.provider_job) return false; o.provider_job = a.p_job; return true },
  }
}

export function createClient(u: string, k: string, o?: any) {
  const db: FakeDB = (globalThis as any).__db
  const c = baseClient(u, k, o) as any
  const jeton = String(o?.global?.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
  c.auth = { ...c.auth, getUser: async () => { await latence(); return { data: { user: db.tokens?.[jeton] ?? null }, error: null } } }
  const from0 = c.from, rpc0 = c.rpc
  c.from = (name: string) => {
    const q = from0(name)
    let compte = false
    const sel0 = q.select.bind(q)
    q.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => { if (opts?.count) compte = true; return sel0() }
    // valeurs par défaut de la table (created_at / updated_at = now(), attempts = 0), comme en base
    const ins0 = q.insert.bind(q)
    q.insert = (row: Row) => { const now = new Date().toISOString(); return ins0(name === 'render_jobs' ? { created_at: now, updated_at: now, attempts: 0, ...row } : row) }
    const run0 = q.run.bind(q)
    q.run = () => { const r = run0(); return compte && !r.error ? { data: null, count: (r.data || []).length, error: null } : r }
    const then0 = q.then.bind(q), may0 = q.maybeSingle.bind(q), single0 = q.single.bind(q)
    q.then = (ok: any, ko: any) => latence().then(() => then0((x: any) => x, (e: any) => { throw e })).then(ok, ko)
    q.maybeSingle = () => latence().then(() => may0())
    q.single = () => latence().then(() => single0())
    return q
  }
  c.rpc = async (name: string, args: any) => { await latence(); return rpc0(name, args) }
  return c
}

// lignes render_jobs d'un compte (pour les vérifications)
export const jobsDe = (db: FakeDB, uid: string, compose?: string) =>
  db.rows('render_jobs').filter((r: Row) => r.user_id === uid && (!compose || r.plan?.__compose === compose))
