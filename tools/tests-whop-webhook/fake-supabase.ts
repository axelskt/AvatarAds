// Base factice en mémoire : juste ce que whop-webhook utilise (from/select/eq/gte/order/limit/maybeSingle/update/insert/
// upsert/delete, rpc, auth.admin.createUser avec l'effet du trigger handle_new_user non périmé).
// 24/10 : + modèles JS des fonctions serveur du webhook (migration 20261024020000_webhook_whop_atomique.sql, à garder
// identiques), pannes simulées (db.pannes : 'update:profiles', 'select:profiles', 'rpc:whop_webhook_renouveler'…) et
// db.apresSelect (ce qui se passe juste APRÈS une lecture : dépense concurrente…). Sans effet sur les autres bancs.
// Relecture du 24/10 : + achats à vérifier (p_par_adresse, whop_achat_valider), essai annuel (annuel_mois = 0), lien de
// gestion repris du journal au renouvellement, panne 'auth:createUser' (création de compte refusée).
type Row = Record<string, any>
const clone = (x: any) => JSON.parse(JSON.stringify(x))
const path = (r: Row, c: string) => c.includes('->') ? c.split(/->>?/).reduce((v: any, k) => v?.[k], r) : r[c]
export class FakeDB {
  t: Record<string, Row[]> = {}
  rpcs: Record<string, (a: any) => any> = rpcsWebhook(this)
  log: string[] = []
  tokens: Record<string, any> = {}
  mdp: Record<string, boolean> = {}
  pannes = new Set<string>()
  apresSelect: ((table: string, rows: Row[]) => void) | null = null
  rows(name: string) { return (this.t[name] ||= []) }
}
const UNIQUE: Record<string, string> = { webhook_events: 'event_id', referral_earnings: 'dedupe_key', whop_annulations: 'membership_id', whop_achats_a_verifier: 'membership_id' }
const PANNE = { code: 'XX000', message: 'panne simulée' }
class Q {
  f: ((r: Row) => boolean)[] = []; op = 'select'; p: any = null; key = ''; lim = 0; ret = false
  constructor(public db: FakeDB, public name: string) {}
  select() { if (this.op !== 'select') this.ret = true; return this }   // après insert/update/delete : renvoie les lignes
  eq(c: string, v: any) { this.f.push((r) => String(path(r, c)) === String(v)); return this }
  // ilike PostgREST : % et _ jokers, \ échappe, casse ignorée (24/10 : vérification d'adresse de paiement-compte)
  ilike(c: string, v: any) {
    const re = new RegExp('^' + String(v).replace(/\\(.)|([%_])|([.*+?^${}()|[\]\\])/g, (_m: string, e: string, w: string, sp: string) =>
      e !== undefined ? e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : w ? (w === '%' ? '.*' : '.') : '\\' + sp) + '$', 'i')
    this.f.push((r) => re.test(String(path(r, c) ?? ''))); return this
  }
  gte(c: string, v: any) { this.f.push((r) => path(r, c) != null && String(path(r, c)) >= String(v)); return this }
  lte(c: string, v: any) { this.f.push((r) => path(r, c) != null && String(path(r, c)) <= String(v)); return this }
  like(c: string, pat: string) { const re = new RegExp('^' + pat.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'); this.f.push((r) => re.test(String(path(r, c) ?? ''))); return this }
  gt(c: string, v: any) { this.f.push((r) => path(r, c) != null && String(path(r, c)) > String(v)); return this }
  lt(c: string, v: any) { this.f.push((r) => path(r, c) != null && String(path(r, c)) < String(v)); return this }
  is(c: string, v: any) { this.f.push((r) => v === null ? path(r, c) == null : path(r, c) === v); return this }
  not(c: string, op: string, v: any) { this.f.push((r) => op === 'is' && v === null ? path(r, c) != null : String(path(r, c)) !== String(v)); return this }
  in(c: string, a: any[]) { this.f.push((r) => a.map(String).includes(String(path(r, c)))); return this }
  order() { return this }
  limit(n: number) { this.lim = n; return this }
  update(o: Row) { this.op = 'update'; this.p = o; return this }
  delete() { this.op = 'delete'; return this }
  insert(o: Row) { this.op = 'insert'; this.p = o; return this }
  upsert(o: Row, opt?: { onConflict?: string }) { this.op = 'upsert'; this.p = o; this.key = opt?.onConflict || 'id'; return this }
  run(): { data: any; error: any } {
    if (this.db.pannes.has(`${this.op}:${this.name}`)) return { data: null, error: PANNE }
    const rows = this.db.rows(this.name), hit = () => rows.filter((r) => this.f.every((f) => f(r)))
    if (this.op === 'select') { let d = hit(); if (this.lim) d = d.slice(0, this.lim); const out = clone(d); this.db.apresSelect?.(this.name, out); return { data: out, error: null } }
    if (this.op === 'update') { const h = hit(); for (const r of h) Object.assign(r, clone(this.p)); this.db.log.push(`update ${this.name} ${JSON.stringify(this.p)}`); return { data: this.ret ? clone(h) : null, error: null } }
    if (this.op === 'delete') { const hh = hit(), h = new Set(hh); this.db.t[this.name] = rows.filter((r) => !h.has(r)); return { data: this.ret ? clone(hh) : null, error: null } }
    if (this.op === 'insert') {
      const u = UNIQUE[this.name]
      if (u && this.p[u] != null && rows.some((r) => r[u] === this.p[u])) return { data: null, error: { code: '23505', message: 'duplicate' } }
      const row = { id: crypto.randomUUID(), received_at: new Date().toISOString(), created_at: new Date().toISOString(), ...clone(this.p) }
      rows.push(row); return { data: this.ret ? [clone(row)] : null, error: null }
    }
    if (this.op === 'upsert') {
      const ex = rows.find((r) => r[this.key] === this.p[this.key])
      if (ex) Object.assign(ex, clone(this.p)); else rows.push(clone(this.p)); return { data: null, error: null }
    }
    return { data: null, error: null }
  }
  maybeSingle() { const r = this.run(); if (r.error) return Promise.resolve(r); const d = r.data || []
    return Promise.resolve(d.length > 1 ? { data: null, error: { code: 'PGRST116', message: 'multiple' } } : { data: d[0] ?? null, error: null }) }
  single() { return this.maybeSingle().then((r: any) => r.data ? r : { data: null, error: { code: 'PGRST116' } }) }
  then(ok: any, ko: any) { return Promise.resolve(this.run()).then(ok, ko) }
}

// ── Modèles des fonctions serveur whop_webhook_* et verser_credits_annuels (SQL : 20261024020000) ──
// Une fonction SQL s'exécute d'un bloc sur la ligne verrouillée : ici, d'un bloc synchrone (aucun await au milieu).
const ANNUELS: Record<string, number> = {
  plan_cNydK89X39PLE: 150, plan_NcMairMUEz3ST: 150,
  plan_P7WIywSa6YrxT: 550, plan_iATzKyUuANyfI: 550, plan_QF7HXCR81yXRy: 550,
  plan_OvRwm5CW3xcNh: 1100, plan_5RTUZOJ3sGCXd: 1100, plan_QaAyO2Msc11Xk: 1100,
  plan_uWTkJDl1GvxNR: 2200, plan_tAKWwP8U88eTT: 2200,
  plan_x2kDWR6ur2W5E: 3300, plan_xzr5jL4TCAlWf: 3300,
}
// timestamptz + n mois (Postgres : jour ramené au dernier jour du mois si besoin, calcul depuis le départ)
export function plusMois(iso: string, n: number): string {
  const d = new Date(iso), y = d.getUTCFullYear(), m = d.getUTCMonth() + n
  const dernier = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), dernier), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString()
}
function rpcsWebhook(db: FakeDB): Record<string, (a: any) => any> {
  const now = () => new Date().toISOString()
  const prof = (id: string) => db.rows('profiles').find((p) => p.id === id)
  const ev = () => db.rows('webhook_events')
  const lock = (k: string) => ev().find((e) => e.event_id === k)
  const achetes = (v: Row) => Math.min(Math.max(v.bought_credits || 0, 0), Math.max(v.credits_remaining || 0, 0))
  const actionDe = (b: any) => String(b?.action ?? b?.event ?? b?.type ?? '')
  const ilYa3j = () => new Date(Date.now() - 3 * 86400_000).toISOString()
  return {
    whop_webhook_activer: (a: any) => {
      const v = prof(a.p_user); if (!v) return { ok: false, raison: 'profil introuvable' }
      const essai = !!a.p_essai, m = a.p_member ?? null
      if (m != null && v.whop_member_id === m && String(v.plan || 'free').toLowerCase() !== 'free' && (v.whop_plan_id ?? null) === (a.p_plan_id ?? null) && (essai || lock('whop-activation:' + m)))
        return { ok: true, deja: true, plan_avant: v.plan }
      if (a.p_par_adresse && String(v.plan || 'free').toLowerCase() !== 'free' && !v.whop_cancel_at_period_end && (v.whop_member_id ?? null) !== m) {
        let nouveau = true
        if (m != null) {
          const t = db.rows('whop_achats_a_verifier')
          nouveau = !t.some((r) => r.membership_id === m)
          if (nouveau) t.push({ membership_id: m, user_id: a.p_user, plan_id: a.p_plan_id, plan: a.p_plan, credits: a.p_credits, bonus: a.p_bonus, pack: a.p_pack,
            manage_url: a.p_manage_url ?? null, annuel: !!a.p_annuel, essai, abonnement_du_compte: v.whop_member_id ?? null, created_at: now(), traite_at: null, decision: null })
        }
        return { ok: true, a_verifier: true, nouveau, abonnement_du_compte: v.whop_member_id ?? null, plan_avant: v.plan }
      }
      const keep = achetes(v)
      let bonus = 0, pack = 0
      if (!essai) {
        if (!v.first_sub_bonus_used) bonus = Math.max(a.p_bonus || 0, 0)
        if ((a.p_pack || 0) > 0) {
          if (m == null) pack = a.p_pack
          else if (!lock('whop-pack-variante:' + m)) { ev().push({ event_id: 'whop-pack-variante:' + m, received_at: now(), body: { action: 'audit.pack_variante', data: { membership: m, user: a.p_user } } }); pack = a.p_pack }
        }
        if (m != null) { const l = lock('whop-activation:' + m); if (l) l.received_at = now(); else ev().push({ event_id: 'whop-activation:' + m, received_at: now(), body: { action: 'audit.activation', data: { membership: m } } }) }
      }
      let ancien: string | null = null
      if (v.whop_member_id && m != null && v.whop_member_id !== m && !v.whop_cancel_at_period_end) {
        ancien = v.whop_member_id
        if (!db.rows('whop_annulations').some((r) => r.membership_id === ancien))
          db.rows('whop_annulations').push({ membership_id: ancien, user_id: a.p_user, genre: 'abonnement', remplace_par: m, created_at: now(), essais: 0, derniere_erreur: null, fait_at: null })
      }
      const plan_avant = v.plan, credits = (essai ? 0 : Math.max(a.p_credits || 0, 0)) + bonus + keep + pack
      Object.assign(v, {
        plan: a.p_plan, credits_remaining: credits, bought_credits: keep + pack, credits_total: a.p_credits,
        whop_member_id: m, whop_plan_id: a.p_plan_id, whop_manage_url: a.p_manage_url ?? null, whop_cancel_at_period_end: false,
        first_sub_bonus_used: !!v.first_sub_bonus_used || !essai,
        annuel_debut: a.p_annuel && !essai ? now() : null, annuel_mois: a.p_annuel ? (essai ? 0 : 1) : null,
      })
      return { ok: true, deja: false, plan_avant, bonus, keep, pack, credits, a_annuler: ancien, essai }
    },
    whop_achat_valider: (a: any) => {
      const x = db.rows('whop_achats_a_verifier').find((r) => r.membership_id === a.p_member)
      if (!x) return { ok: false, raison: 'achat introuvable' }
      if (x.traite_at) return { ok: false, raison: 'achat déjà clos : ' + (x.decision || '—') }
      const r = db.rpcs.whop_webhook_activer({ p_user: x.user_id, p_member: x.membership_id, p_plan_id: x.plan_id, p_plan: x.plan, p_credits: x.credits,
        p_bonus: x.bonus, p_pack: x.pack, p_manage_url: x.manage_url, p_annuel: x.annuel, p_essai: x.essai, p_par_adresse: false })
      if (r?.ok) Object.assign(x, { traite_at: now(), decision: 'appliqué' })
      return r
    },
    whop_webhook_pack: (a: any) => {
      const v = prof(a.p_user); if (!v) return { ok: false, raison: 'profil introuvable' }
      const n = Math.max(a.p_credits || 0, 0)
      v.bought_credits = achetes(v) + n
      v.credits_remaining = Math.max(v.credits_remaining || 0, 0) + n
      v.img_bonus_credits = (v.img_bonus_credits || 0) + Math.max(a.p_img || 0, 0)
      return { ok: true, credits: v.credits_remaining }
    },
    whop_webhook_renouveler: (a: any) => {
      const v = prof(a.p_user); if (!v) return { ok: false, raison: 'profil introuvable' }
      const m = a.p_member ?? null
      if (v.whop_member_id && m != null && v.whop_member_id !== m) return { ok: true, effet: 'ancien_abonnement', abonnement_du_compte: v.whop_member_id }
      // relecture finale du 24/10 (même règle que le SQL) : achat mis de côté non tranché, ou plan donné à la main (payant,
      // sans abonnement ni plan Whop identique) → un paiement d'un abonnement inconnu ne change rien
      if (m != null && db.rows('whop_achats_a_verifier').some((x) => x.membership_id === m && !x.traite_at)) return { ok: true, effet: 'ancien_abonnement', abonnement_du_compte: v.whop_member_id ?? null }
      if (!v.whop_member_id && m != null && String(v.plan || 'free').toLowerCase() !== 'free' && (v.whop_plan_id ?? null) !== (a.p_plan_id ?? null)) return { ok: true, effet: 'ancien_abonnement', abonnement_du_compte: null }
      if (m != null) {
        const l = lock('whop-activation:' + m)
        const journal = ev().some((e) => String(e.body?.data?.id ?? '') === m && String(e.received_at) >= ilYa3j()
          && /membership[._](went[._]valid|activated)/i.test(actionDe(e.body)) && String(e.body?.data?.status ?? '').toLowerCase() !== 'trialing')
        if ((l && String(l.received_at) >= ilYa3j()) || journal) return { ok: true, effet: 'premier_cycle' }
      }
      const mm = Math.max(a.p_credits || 0, 0), b = achetes(v), planLeft = Math.max(0, (v.credits_remaining || 0) - b)
      const avant = v.credits_remaining || 0, apres = Math.min(planLeft + mm, 2 * mm) + b, plan_avant = v.plan
      const lien = v.whop_manage_url == null && m != null
        ? ([...ev()].filter((e) => String(e.body?.data?.id ?? '') === m && e.body?.data?.manage_url).sort((x, y) => String(y.received_at).localeCompare(String(x.received_at)))[0]?.body?.data?.manage_url ?? null)
        : v.whop_manage_url
      Object.assign(v, { plan: a.p_plan, credits_remaining: apres, bought_credits: b, credits_total: mm, whop_plan_id: a.p_plan_id,
        whop_member_id: v.whop_member_id ?? m, whop_manage_url: lien, whop_cancel_at_period_end: false,
        annuel_debut: a.p_annuel ? now() : null, annuel_mois: a.p_annuel ? 1 : null })
      return { ok: true, effet: 'credite', plan_avant, avant, apres, report: planLeft, achetes: b }
    },
    whop_webhook_fin: (a: any) => {
      const v = prof(a.p_user); if (!v) return { ok: false, raison: 'profil introuvable' }
      const actif = (v.whop_member_id && a.p_member != null && v.whop_member_id === a.p_member) || (!v.whop_member_id && !!v.whop_plan_id && v.whop_plan_id === a.p_plan_id)
      if (!actif) return { ok: true, actif: false }
      const keep = achetes(v), plan_avant = v.plan
      Object.assign(v, { plan: 'free', credits_remaining: keep, bought_credits: keep, whop_member_id: null, whop_plan_id: null, whop_manage_url: null,
        whop_cancel_at_period_end: false, annuel_debut: null, annuel_mois: null })
      return { ok: true, actif: true, keep, plan_avant }
    },
    whop_webhook_resiliation: (a: any) => {
      const v = prof(a.p_user); if (!v) return { ok: false, raison: 'profil introuvable' }
      if (a.p_member == null || v.whop_member_id !== a.p_member) return { ok: true, effet: 'autre_abonnement' }
      if (a.p_programmee) {
        if (v.whop_cancel_at_period_end) return { ok: true, effet: 'deja' }
        const keep = achetes(v), avant = v.credits_remaining || 0
        Object.assign(v, { credits_remaining: keep, bought_credits: keep, whop_cancel_at_period_end: true, cancel_requested_at: now() })
        return { ok: true, effet: 'resiliee', avant, keep }
      }
      if (!v.whop_cancel_at_period_end) return { ok: true, effet: 'deja' }
      v.whop_cancel_at_period_end = false
      return { ok: true, effet: 'reactivee' }
    },
    whop_webhook_retirer_pack: (a: any) => {
      const v = prof(a.p_user); if (!v) return { ok: false, raison: 'profil introuvable' }
      const n = Math.max(a.p_credits || 0, 0), avant = v.credits_remaining || 0, apres = Math.max(0, avant - n)
      v.bought_credits = Math.min(apres, Math.max(0, achetes(v) - n))
      v.credits_remaining = apres
      v.img_bonus_credits = Math.max(0, (v.img_bonus_credits || 0) - Math.max(a.p_img || 0, 0))
      return { ok: true, avant, apres }
    },
    whop_webhook_poser_parrain: (a: any) => {
      const code = String(a.p_code ?? '').trim()
      if (!a.p_user || !/^[a-z0-9_-]{4,40}$/i.test(code)) return false
      const ref = db.rpcs.referrer_id_from_code ? db.rpcs.referrer_id_from_code({ p_code: code }) : null
      if (!ref || ref === a.p_user) return false
      const v = prof(a.p_user)
      if (!v || String(v.referred_by || '') !== '' || !v.created_at || v.created_at < new Date(Date.now() - 86400_000).toISOString()) return false
      v.referred_by = String(ref).replace(/-/g, '').slice(0, 10).toUpperCase()
      return true
    },
    verser_credits_annuels: () => {
      let total = 0
      for (const v of db.rows('profiles')) {
        if (!v.annuel_debut && v.annuel_mois == null && String(v.plan || 'free').toLowerCase() !== 'free' && ANNUELS[v.whop_plan_id] != null) { v.annuel_debut = now(); v.annuel_mois = 1 }
      }
      for (const v of db.rows('profiles')) {
        // comme en SQL (bloc begin … exception par compte) : un refus annule TOUS les versements de ce compte dans ce passage
        const avantCompte = clone(v), jAvant = db.rows('credits_annuels_versements').length, totalAvant = total
        for (let tour = 0; tour < 12; tour++) {
          if (!v.annuel_debut || (v.annuel_mois ?? 1) >= 12 || (v.annuel_mois ?? 1) < 1 || String(v.plan || 'free').toLowerCase() === 'free') break
          const ech = plusMois(v.annuel_debut, v.annuel_mois ?? 1)
          if (ech > now()) break
          const mm = ANNUELS[v.whop_plan_id]
          if (mm == null) { v.annuel_debut = null; v.annuel_mois = null; break }
          const b = achetes(v), apres = Math.min(Math.max(0, (v.credits_remaining || 0) - b) + mm, 2 * mm) + b
          const j = db.rows('credits_annuels_versements')
          if (j.some((x) => x.user_id === v.id && x.echeance === ech)) {   // échéance unique (en SQL : erreur, versements du compte annulés)
            for (const k of Object.keys(v)) delete v[k]
            Object.assign(v, avantCompte); j.length = jAvant; total = totalAvant
            break
          }
          j.push({ user_id: v.id, echeance: ech, mois: (v.annuel_mois ?? 1) + 1, credits: mm, solde_avant: v.credits_remaining || 0, solde_apres: apres, whop_plan_id: v.whop_plan_id })
          Object.assign(v, { credits_remaining: apres, bought_credits: b, annuel_mois: (v.annuel_mois ?? 1) + 1 })
          total++
        }
      }
      return total
    },
  }
}

let n = 0
export function createClient(_u: string, _k: string, _o?: unknown) {
  const db: FakeDB = (globalThis as any).__db
  return {
    from: (name: string) => new Q(db, name),
    rpc: async (name: string, args: any) => {
      if (db.pannes.has('rpc:' + name)) return { data: null, error: PANNE }
      try { return { data: db.rpcs[name] ? db.rpcs[name](args) : null, error: null } }
      catch (e) { return { data: null, error: { code: 'P0001', message: String((e as Error)?.message ?? e) } } }
    },
    auth: {
      getUser: async (tok: string) => ({ data: { user: db.tokens?.[tok] ?? null }, error: null }),
      admin: {
      generateLink: async ({ email }: { email: string }) => { db.log.push('lien ' + email); return { data: { properties: { hashed_token: 'th_' + email } }, error: null } },
      updateUserById: async (id: string, attrs: any) => { db.log.push('maj ' + id + ' ' + JSON.stringify(attrs));
        const g = db.rows('password_change_grants').find((r) => r.user_id === id); if (g) { db.t.password_change_grants = db.rows('password_change_grants').filter((r) => r !== g); db.mdp = { ...(db.mdp || {}), [id]: true } }
        return { data: {}, error: null } },
      createUser: async ({ email }: { email: string }) => {
      if (db.pannes.has('auth:createUser')) return { data: null, error: { message: 'création refusée (panne simulée)' } }
      if (db.rows('profiles').some((p) => p.email === email)) return { data: null, error: { message: 'already registered' } }
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
      const pa = db.rows('pending_activations').find((r) => r.email.toLowerCase() === email.toLowerCase())
      const created_at = new Date().toISOString()
      // handle_new_user (ligne non périmée) : achat en attente appliqué, crédits sans distinction pack/plan (bought 0)
      db.rows('profiles').push(pa
        ? { id, email, created_at, plan: pa.plan, credits_remaining: pa.credits, credits_total: pa.credits, img_bonus_credits: pa.img_credits || 0,
            whop_member_id: pa.whop_member_id ?? null, whop_plan_id: pa.whop_plan_id ?? null, first_sub_bonus_used: !!(pa.plan && pa.plan !== 'free'), bought_credits: 0 }
        : { id, email, created_at, plan: 'free', credits_remaining: 0, credits_total: 0, bought_credits: 0, first_sub_bonus_used: false })
      if (pa) db.t.pending_activations = db.rows('pending_activations').filter((r) => r !== pa)
      return { data: { user: { id } }, error: null }
    } } },
  }
}
export function serve(h: (req: Request) => Promise<Response>) { (globalThis as any).__handler = h }
