// Rejoue whop-cancel, whop-uncancel et delete-account (code réel) sur la base factice : constat 1 (dépense PENDANT l'appel
// Whop puis remboursement, en boucle avec la réactivation), rendu prioritaire résilié / réactivé avec le plan et à la
// suppression du compte, erreurs d'écriture jamais annoncées comme un succès. Whop et Resend sont interceptés.
// Les RPC de crédits sont simulées comme en base après 20261024010000 (le SQL lui-même : test-credits-sql.ts).
//   cd tools/tests-whop-webhook && deno run --allow-env --allow-read --allow-net --import-map=import_map.json test-credits-resiliation.ts
// A/B : un 1er argument donne un autre dossier de fonctions (ex. une copie de origin/main) à rejouer avec les mêmes cas.
// 24/10 (relecture) : + relecture de l'abonnement chez Whop après un refus (GET simulé par lectureWhop), chemin « already »
// (double clic réel, webhook Whop arrivé avant la RPC : départ enregistré une seule fois, solde renvoyé), suppression du
// compte avec un prioritaire déjà en fin chez Whop, message au client quand le prioritaire n'est pas réactivé.
import { FakeDB } from './fake-supabase.ts'
Deno.env.set('SUPABASE_URL', 'https://test.local'); Deno.env.set('SUPABASE_ANON_KEY', 'anon'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x')
Deno.env.set('WHOP_API_KEY', 'whop_test'); Deno.env.set('RESEND_API_KEY', 'k')
const keep = console.log
let logs: string[] = []
for (const m of ['log', 'warn', 'error'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))

// ── Whop et Resend interceptés ──
let whop: { url: string; body: any }[] = []
let mails: { subject: string; html: string }[] = []
let pendantWhop: (() => void) | null = null                       // exécuté PENDANT le 1er appel Whop (la course)
let refusWhop: (url: string) => number = () => 0                  // statut d'erreur à renvoyer pour cette URL (0 = accepté)
let lectureWhop: (url: string) => any = () => ({ status: 'active', cancel_at_period_end: false })   // GET d'un abonnement
globalThis.fetch = (async (u: any, o: any) => {
  const url = String(u)
  if (url.includes('api.whop.com')) {
    whop.push({ url, body: o?.body ? JSON.parse(o.body) : null })
    if (!o?.method || o.method === 'GET') return new Response(JSON.stringify(lectureWhop(url)), { status: 200 })
    if (pendantWhop) { const f = pendantWhop; pendantWhop = null; f() }
    const st = refusWhop(url)
    return st ? new Response('{"error":"refus"}', { status: st }) : new Response(JSON.stringify({ status: 'active', cancel_at_period_end: !url.endsWith('/uncancel'), renewal_period_end: '2026-11-23T00:00:00Z' }), { status: 200 })
  }
  if (url.includes('api.resend.com')) { const b = JSON.parse(o.body); mails.push({ subject: b.subject, html: b.html }); return new Response('{"id":"x"}', { status: 200 }) }
  throw new Error('réseau interdit dans le test : ' + url)
}) as typeof fetch

// UNE base factice pour tout le test (guard.ts garde son client) : vidée entre les cas
const db = new FakeDB(); (globalThis as any).__db = db
const UID = '00000000-0000-4000-8000-0000000000c1', JETON = 'jeton-client'
let horloge = 0, appelsRpc: string[] = []
const P = () => db.rows('profiles').find((p) => p.id === UID)!
function reset(profil: Record<string, unknown>) {
  // whop-cancel / whop-uncancel / authUser appellent getUser() SANS argument : la base factice cherche alors la clé
  // « undefined » (retirée pour le cas « sans session »)
  const client = { id: UID, email: 'client@test.fr' }
  db.t = {}; db.log = []; db.tokens = { [JETON]: client, [String(undefined)]: client }; db.pannes = new Set(); db.avantRpc = null
  logs = []; whop = []; mails = []; pendantWhop = null; refusWhop = () => 0; appelsRpc = []
  lectureWhop = () => ({ status: 'active', cancel_at_period_end: false })
  db.rows('profiles').push({ id: UID, email: 'client@test.fr', plan: 'starter', credits_remaining: 270, credits_total: 150, bought_credits: 120,
    whop_member_id: 'mem_plan', whop_cancel_at_period_end: false, prio_member_id: null, prio_cancel_member_id: null, cancel_requested_at: null,
    cancel_notified_at: null, ...profil })
  db.rpcs = {
    rate_hit: () => true,
    // = public.cancel_remove_plan_credits (une écriture sur la ligne COURANTE, seulement si pas déjà résilié ; « already » :
    // solde relu, prioritaire noté, notify vrai une seule fois par résiliation)
    cancel_remove_plan_credits: ({ p_user, p_prio_member }: any) => {
      appelsRpc.push('cancel_remove_plan_credits')
      const p = db.rows('profiles').find((x) => x.id === p_user)
      if (!p) return { ok: false, reason: 'no_profile' }
      if (p.whop_cancel_at_period_end) {
        const notify = p.cancel_requested_at != null && p.cancel_notified_at !== p.cancel_requested_at
        if (p_prio_member) p.prio_cancel_member_id = p_prio_member
        if (notify) p.cancel_notified_at = p.cancel_requested_at
        return { ok: false, reason: 'already', kept: p.credits_remaining || 0, notify }
      }
      const avant = p.credits_remaining || 0, garde = Math.min(Math.max(p.bought_credits || 0, 0), avant), at = ++horloge
      Object.assign(p, { credits_remaining: garde, bought_credits: Math.max(0, Math.min(p.bought_credits || 0, avant)), whop_cancel_at_period_end: true,
        cancel_requested_at: at, cancel_notified_at: at, prio_cancel_member_id: p_prio_member || p.prio_cancel_member_id || null })
      return { ok: true, kept: garde, removed: Math.max(0, avant - garde), notify: true }
    },
    list_user_objects: () => [], delete_user_rows: (a: any) => { appelsRpc.push('delete_user_rows' + (a.p_dry ? ' dry' : '')); return {} },
  }
}
// = spend_credits (plan d'abord) et refund_credits (part achetée seulement pour un débit antérieur à une résiliation)
function depense(n: number) {
  const p = P(), vb = Math.min(n, Math.max(0, (p.bought_credits || 0) - ((p.credits_remaining || 0) - n)))
  p.credits_remaining -= n; p.bought_credits = Math.max(0, (p.bought_credits || 0) - vb)
  return { amount: n, bought_part: vb, created_at: ++horloge }
}
function rembourse(op: { amount: number; bought_part: number; created_at: number }) {
  const p = P(), res = p.cancel_requested_at && op.created_at <= p.cancel_requested_at ? op.bought_part : op.amount
  p.credits_remaining += res; p.bought_credits = (p.bought_credits || 0) + op.bought_part
}

const DOSSIER = Deno.args[0] ? new URL(Deno.args[0].replace(/\/?$/, '/'), 'file://' + Deno.cwd() + '/') : new URL('../../supabase/functions/', import.meta.url)
const charge = async (f: string) => { await import(new URL(f + '/index.ts', DOSSIER).href); return (globalThis as any).__handler as (r: Request) => Promise<Response> }
const hCancel = await charge('whop-cancel'), hUncancel = await charge('whop-uncancel'), hDelete = await charge('delete-account')
// delete-account passe par le client de guard.ts : suppression du compte et stockage simulés sur CE client
const { svc } = await import(new URL('_shared/guard.ts', DOSSIER).href)
let compteSupprime = false
;(svc() as any).auth.admin.deleteUser = async () => { compteSupprime = true; return { error: null } }
;(svc() as any).storage = { from: () => ({ remove: async () => ({ error: null }) }) }

const appel = async (h: (r: Request) => Promise<Response>, body: unknown = {}, jeton: string | null = JETON) => {
  const r = await h(new Request('https://x/', { method: 'POST', body: JSON.stringify(body), headers: jeton ? { authorization: 'Bearer ' + jeton } : {} }))
  return { status: r.status, j: await r.json().catch(() => ({})) }
}
const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); if (!c) keep('  ✗ ' + n + ' — ' + d + '\n    ' + logs.slice(-4).join('\n    ')) }
const solde = () => `${P().credits_remaining}/${P().bought_credits}`

// ── 1) Constat 1 : 270 dont 120 achetés, tout le solde débité PENDANT l'appel Whop puis remboursé, 3 tours ──
reset({})
for (let tour = 1; tour <= 3; tour++) {
  let op: ReturnType<typeof depense> | null = null
  pendantWhop = () => { op = depense(P().credits_remaining) }
  const r = await appel(hCancel, { reason: 'trop_cher' })
  if (op) rembourse(op)
  if (tour === 1) ok('constat 1 : la résiliation répond ok', r.status === 200 && r.j.ok === true, JSON.stringify(r))
  await appel(hUncancel)
}
ok('constat 1 : après 3 tours annuler / dépenser / se rembourser / réactiver, toujours 120 achetés (rien de créé)', solde() === '120/120', solde())

// ── 2) Résiliation normale : kept / removed lus en base, Whop en fin de période, e-mail à Axel ──
reset({})
let r = await appel(hCancel, { reason: 'trop_cher', detail: 'test' })
ok('résiliation : kept 120 / removed 150 renvoyés par la base', r.status === 200 && r.j.ok === true && r.j.kept === 120 && r.j.removed === 150 && r.j.rendu_prioritaire === null, JSON.stringify(r.j))
ok('résiliation : 120/120 et drapeau posé', solde() === '120/120' && P().whop_cancel_at_period_end === true, solde())
ok('résiliation : UN appel Whop, fin de période', whop.length === 1 && whop[0].url.endsWith('/mem_plan/cancel') && whop[0].body?.cancel_at_period_end === true, JSON.stringify(whop))
ok('résiliation : retrait fait EN BASE (RPC), après Whop', appelsRpc.join() === 'cancel_remove_plan_credits', appelsRpc.join())
ok('résiliation : e-mail à Axel avec les crédits retirés', mails.length === 1 && /150 du plan retirés, 120 achetés gardés/.test(mails[0].html), JSON.stringify(mails.map((m) => m.subject)))

// ── 3) Course sans malveillance : un pack crédité par le webhook pendant l'appel Whop n'est plus écrasé ──
reset({})
pendantWhop = () => { P().credits_remaining += 300; P().bought_credits += 300 }
r = await appel(hCancel)
ok('pack crédité pendant l\'appel Whop : gardé (420/420)', solde() === '420/420' && r.j.kept === 420, solde() + ' ' + JSON.stringify(r.j))

// ── 4) Rendu prioritaire résilié avec le plan, réactivé avec lui ──
reset({ prio_member_id: 'mem_prio', rendu_prioritaire: true })
r = await appel(hCancel)
ok('prioritaire : résilié aussi, en fin de période', r.j.rendu_prioritaire === 'resilie' && whop.some((w) => w.url.endsWith('/mem_prio/cancel') && w.body?.cancel_at_period_end === true), JSON.stringify([r.j, whop]))
ok('prioritaire : mémorisé dans la même écriture', P().prio_cancel_member_id === 'mem_prio', String(P().prio_cancel_member_id))
ok('prioritaire : indiqué à Axel', /Rendu prioritaire :<\/b> résilié aussi/.test(mails[0]?.html || ''), mails[0]?.html)
whop = []
r = await appel(hUncancel)
ok('réactivation : plan ET prioritaire réactivés', r.status === 200 && r.j.rendu_prioritaire === 'reactive' && whop.map((w) => w.url.split('/').slice(-2).join('/')).join() === 'mem_plan/uncancel,mem_prio/uncancel', JSON.stringify([r.j, whop]))
ok('réactivation : drapeaux remis, crédits inchangés, date de résiliation gardée', P().whop_cancel_at_period_end === false && P().prio_cancel_member_id === null && solde() === '120/120' && P().cancel_requested_at != null, JSON.stringify(P()))
// prioritaire déjà résilié par l'app : pas de 2e résiliation ; prioritaire résilié chez Whop par le client : pas réactivé
reset({ prio_member_id: 'mem_prio', prio_cancel_member_id: 'mem_prio' })
r = await appel(hCancel)
ok('prioritaire déjà résilié : pas rappelé chez Whop', r.j.ok === true && r.j.rendu_prioritaire === null && whop.length === 1, JSON.stringify(whop))
reset({ prio_member_id: 'mem_prio', whop_cancel_at_period_end: true })
r = await appel(hUncancel)
ok('prioritaire que l\'app n\'a pas résilié : pas réactivé', r.j.ok === true && whop.length === 1 && !whop[0].url.includes('mem_prio'), JSON.stringify(whop))

// ── 5) Échecs : jamais de faux succès ──
reset({ prio_member_id: 'mem_prio' })
refusWhop = (u) => u.includes('mem_prio') ? 500 : 0
r = await appel(hCancel)
ok('prioritaire refusé par Whop : plan résilié, échec dit dans la réponse et à Axel', r.j.ok === true && r.j.rendu_prioritaire === 'echec' && P().prio_cancel_member_id === null
  && /rendu prioritaire à résilier à la main/.test(mails[0]?.subject || ''), JSON.stringify([r.j, mails.map((m) => m.subject)]))
reset({})
db.rpcs.cancel_remove_plan_credits = () => { appelsRpc.push('x'); throw new Error('base saturée') }   // → { error } côté client
r = await appel(hCancel)
ok('base en panne après Whop : erreur 500 (pas de ok), retentée une fois', r.status === 500 && !r.j.ok && /pas encore été mis à jour/.test(r.j.error || '') && appelsRpc.length === 2, JSON.stringify([r, appelsRpc]))
ok('base en panne : Axel prévenu avec la requête à rejouer', mails.length === 1 && /finir à la main/.test(mails[0].subject) && /cancel_remove_plan_credits/.test(mails[0].html), JSON.stringify(mails.map((m) => m.subject)))
reset({})
db.rpcs.cancel_remove_plan_credits = () => ({ ok: false, reason: 'already' })
r = await appel(hCancel)
ok('double clic (la base a déjà résilié) : ok « already », pas d\'e-mail de départ en double', r.status === 200 && r.j.already === true && mails.length === 0, JSON.stringify(r.j))
reset({})
refusWhop = () => 422
r = await appel(hCancel)
ok('Whop refuse : 502, rien retiré en base', r.status === 502 && solde() === '270/120' && appelsRpc.length === 0, JSON.stringify(r))
reset({ whop_cancel_at_period_end: true })
r = await appel(hCancel)
ok('déjà résilié : ok « already », Whop pas rappelé', r.j.already === true && whop.length === 0, JSON.stringify(r.j))
delete db.tokens[String(undefined)]
r = await appel(hCancel, {}, null)
ok('sans session : 401', r.status === 401)
reset({ whop_cancel_at_period_end: true })
;db.pannes.add('update:profiles')
r = await appel(hUncancel)
ok('réactivation : écriture ratée → 500 et Axel prévenu (plus de ok)', r.status === 500 && !r.j.ok && mails.some((m) => /Réactivation à finir à la main/.test(m.subject)), JSON.stringify([r, mails.map((m) => m.subject)]))

// ── 5b) Relecture du 24/10 : chemin « already », refus de Whop sur un abonnement qui finit déjà ──
const fb = () => db.rows('cancellation_feedback').filter((x) => x.outcome === 'cancelled')
reset({ whop_cancel_at_period_end: true, credits_remaining: 120, bought_credits: 120 })
r = await appel(hCancel)
ok('déjà résilié avant la demande : « already » avec le solde (120), Whop pas rappelé', r.j.already === true && r.j.kept === 120 && whop.length === 0, JSON.stringify(r.j))
// double clic réel : deux demandes en même temps → une seule écriture, un seul départ enregistré
reset({})
const [d1, d2] = await Promise.all([appel(hCancel, { reason: 'trop_cher' }), appel(hCancel, { reason: 'trop_cher' })])
ok('double clic réel : deux réponses ok, une « already », solde 120 dans les deux, crédits retirés une fois',
  d1.status === 200 && d2.status === 200 && [d1.j, d2.j].filter((j) => j.already).length === 1 && [d1.j, d2.j].every((j) => j.kept === 120) && solde() === '120/120',
  JSON.stringify([d1, d2, solde()]))
ok('double clic réel : un seul e-mail de départ, un seul retour enregistré (les deux demandes sont allées jusqu\'à la RPC)',
  mails.length === 1 && fb().length === 1 && appelsRpc.length === 2 && whop.length === 2, JSON.stringify([mails.map((m) => m.subject), fb().length, appelsRpc, whop.length]))
// webhook Whop de CETTE résiliation traité avant la RPC (whop_webhook_resiliation : crédits du plan retirés, drapeau et date
// posés, départ non enregistré)
reset({})
pendantWhop = () => {
  const p = P(), garde = Math.min(p.bought_credits, p.credits_remaining)
  Object.assign(p, { credits_remaining: garde, bought_credits: garde, whop_cancel_at_period_end: true, cancel_requested_at: ++horloge })
}
r = await appel(hCancel, { reason: 'qualite', detail: 'flou' })
ok('webhook Whop avant la RPC : ok « already » avec le solde relu (120), l\'app se met à jour', r.status === 200 && r.j.ok === true && r.j.already === true && r.j.kept === 120 && solde() === '120/120', JSON.stringify(r.j))
ok('webhook Whop avant la RPC : raison enregistrée et Axel prévenu, une fois', fb().length === 1 && fb()[0].reason === 'qualite' && fb()[0].detail === 'flou'
  && mails.length === 1 && /déjà retirés/.test(mails[0].html), JSON.stringify([fb(), mails.map((m) => m.subject)]))
r = await appel(hCancel, { reason: 'qualite' })
ok('webhook Whop avant la RPC : un nouveau clic ne renvoie rien', r.j.already === true && mails.length === 1 && fb().length === 1, JSON.stringify(r.j))
// relance après une panne de la base : Whop refuse la 2e annulation (fin déjà programmée), l'abonnement est relu → la
// résiliation est finie au lieu d'un 502 « Whop a refusé »
reset({})
db.pannes.add('rpc:cancel_remove_plan_credits')
r = await appel(hCancel, { reason: 'trop_cher' })
ok('panne de la base après Whop : 500, rien retiré', r.status === 500 && solde() === '270/120', JSON.stringify(r))
db.pannes.delete('rpc:cancel_remove_plan_credits'); mails = []; whop = []
refusWhop = (u) => u.endsWith('/mem_plan/cancel') ? 422 : 0
lectureWhop = () => ({ status: 'active', cancel_at_period_end: true })
r = await appel(hCancel, { reason: 'trop_cher' })
ok('relance après la panne : refus de Whop, abonnement relu (fin déjà programmée) → 200, 120 gardés / 150 retirés',
  r.status === 200 && r.j.ok === true && r.j.kept === 120 && r.j.removed === 150 && solde() === '120/120' && whop.some((w) => w.url.endsWith('/memberships/mem_plan')), JSON.stringify([r, whop]))
ok('relance après la panne : départ enregistré', mails.length === 1 && /150 du plan retirés/.test(mails[0].html), JSON.stringify(mails.map((m) => m.subject)))
// refus de Whop sur un abonnement qui ne finit PAS : toujours 502, rien retiré
reset({})
refusWhop = () => 422
r = await appel(hCancel)
ok('refus de Whop, abonnement relu encore actif : 502, rien retiré', r.status === 502 && solde() === '270/120' && appelsRpc.length === 0, JSON.stringify(r))
// prioritaire déjà résilié par le client chez Whop : pas d'échec, mais pas noté comme résilié par l'app
reset({ prio_member_id: 'mem_prio' })
refusWhop = (u) => u.includes('mem_prio') ? 422 : 0
lectureWhop = (u) => u.endsWith('/mem_prio') ? { status: 'active', cancel_at_period_end: true } : { status: 'active', cancel_at_period_end: false }
r = await appel(hCancel)
ok('prioritaire déjà en fin chez Whop : « deja », pas noté comme résilié par l\'app, pas d\'alerte « à la main »',
  r.j.ok === true && r.j.rendu_prioritaire === 'deja' && P().prio_cancel_member_id === null && mails.length === 1 && !/à la main/.test(mails[0].subject) && /déjà en fin chez Whop/.test(mails[0].html),
  JSON.stringify([r.j, P().prio_cancel_member_id, mails.map((m) => m.subject)]))
// réactivation : prioritaire refusé par Whop → plan réactivé (200, pas d'error que l'app prendrait pour un échec) + message
reset({ whop_cancel_at_period_end: true, prio_member_id: 'mem_prio', prio_cancel_member_id: 'mem_prio' })
refusWhop = (u) => u.includes('mem_prio') ? 500 : 0
r = await appel(hUncancel)
ok('réactivation, prioritaire refusé : 200 sans error, message au client, Axel prévenu, plan réactivé',
  r.status === 200 && r.j.ok === true && !('error' in r.j) && r.j.rendu_prioritaire === 'echec' && /rendu prioritaire n'a pas pu/.test(r.j.message || '')
  && mails.some((m) => /Réactivation à finir à la main/.test(m.subject)) && P().whop_cancel_at_period_end === false, JSON.stringify([r, mails.map((m) => m.subject)]))
reset({ whop_cancel_at_period_end: true, prio_member_id: 'mem_prio', prio_cancel_member_id: 'mem_prio' })
r = await appel(hUncancel)
ok('réactivation normale : pas de message', r.j.ok === true && r.j.rendu_prioritaire === 'reactive' && !('message' in r.j), JSON.stringify(r.j))

// ── 6) Suppression du compte : le prioritaire est résilié AVANT, sinon rien n'est supprimé ──
reset({ plan: 'free', whop_member_id: null, credits_remaining: 0, bought_credits: 0, prio_member_id: 'mem_prio' })
compteSupprime = false
r = await appel(hDelete, { dry_run: true })
ok('suppression (essai à blanc) : prioritaire annoncé, rien appelé', r.j.dry_run === true && r.j.rendu_prioritaire === 'a_resilier' && whop.length === 0 && !compteSupprime, JSON.stringify(r.j))
refusWhop = () => 503
r = await appel(hDelete, { confirm: 'SUPPRIMER' })
ok('suppression : Whop refuse le prioritaire → 502, compte intact', r.status === 502 && !compteSupprime && !appelsRpc.includes('delete_user_rows'), JSON.stringify([r, appelsRpc]))
refusWhop = () => 0; whop = []
r = await appel(hDelete, { confirm: 'SUPPRIMER' })
ok('suppression : prioritaire résilié en fin de période, puis compte supprimé', r.status === 200 && compteSupprime && whop.length === 1 && whop[0].url.endsWith('/mem_prio/cancel') && whop[0].body?.cancel_at_period_end === true, JSON.stringify([r, whop]))
reset({ whop_cancel_at_period_end: true, prio_member_id: 'mem_prio', prio_cancel_member_id: 'mem_prio' })
compteSupprime = false
r = await appel(hDelete, { confirm: 'SUPPRIMER' })
ok('suppression : prioritaire déjà résilié par la résiliation → pas rappelé', r.status === 200 && compteSupprime && whop.length === 0, JSON.stringify([r, whop]))
reset({ prio_member_id: 'mem_prio' })
compteSupprime = false
r = await appel(hDelete, { confirm: 'SUPPRIMER' })
ok('suppression : abonnement encore actif → 409 comme avant, prioritaire pas touché', r.status === 409 && whop.length === 0 && !compteSupprime, JSON.stringify(r))
// relecture du 24/10 : prioritaire déjà résilié par le client chez Whop, ou expiré (désactivation jamais reçue) → Whop
// refuse la résiliation, l'abonnement est relu, la suppression continue (avant : 502 à chaque essai)
for (const [quoi, lu] of [['fin de période déjà programmée', { status: 'active', cancel_at_period_end: true }], ['expiré', { status: 'expired', cancel_at_period_end: false }]] as [string, any][]) {
  reset({ plan: 'free', whop_member_id: null, credits_remaining: 0, bought_credits: 0, prio_member_id: 'mem_prio' })
  compteSupprime = false; refusWhop = () => 422; lectureWhop = () => lu
  r = await appel(hDelete, { confirm: 'SUPPRIMER' })
  ok(`suppression : prioritaire ${quoi} chez Whop (refus puis relecture) → compte supprimé`, r.status === 200 && compteSupprime && whop.some((w) => w.url.endsWith('/memberships/mem_prio')), JSON.stringify([r, whop]))
}

const ko = res.filter((x) => !x[1])
keep(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) Deno.exit(1)
