// Rejoue whop-webhook (code réel) sur une base factice, avec de vrais événements signés : chaque variante
// « abonnement + pack », le rendu prioritaire, et les cas de base (non-régression).
// 24/10 : + corrections de l'audit du 23/10 (zone webhook, constats 1/13, 4/11/16, 5/9, 14/19, 20-24, 27, 34, 43-45, 59).
// Les fonctions serveur whop_webhook_* sont rejouées par leurs modèles JS (fake-supabase.ts) ; le SQL lui-même est
// rejoué sur un vrai Postgres par le banc SQL de la migration 20261024020000.
// A/B : un 1er argument donne un autre dossier de fonctions (ex. une copie de origin/main) à rejouer avec les mêmes cas.
// Relecture du 24/10 : + achat mis de côté quand le compte n'est retrouvé que par l'adresse (sabotage), parrain posé
// seulement sur un compte créé par le paiement, essai d'un annuel, alerte « aa_user_id ≠ adresse », file des résiliations
// sans 500, verrous de l'achat en attente, lien de gestion repris, fin du rendu prioritaire en panne de lecture.
// Changement VOULU : les montées en gamme d'un abonné (Pro → Élite, palier, 2e rendu prioritaire) passent par la page de
// paiement connectée, donc portent aa_user_id ; sans lui, l'achat est désormais mis de côté (cas dédiés plus bas).
import { FakeDB, plusMois, createClient } from './fake-supabase.ts'
const RAW = 'secret-de-test-0123456789abcdef'
Deno.env.set('SUPABASE_URL', 'https://test.local'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x')
Deno.env.set('WHOP_WEBHOOK_SECRET', 'whsec_' + btoa(RAW)); Deno.env.set('WHOP_PRIO_PLANS', 'plan_5mcgIdN0ZTlCG,plan_2KlnrycFeoXMT,plan_oPv9MNE8701Tt')
for (const k of ['WHOP_API_KEY', 'WHOP_UPSELL_PACKS']) Deno.env.delete(k)
// relecture du 24/10 : clé Resend factice (lue au chargement du webhook) pour vérifier les alertes à Axel ; tout appel à
// api.resend.com est intercepté plus bas (aucun envoi réel, et la clé serait de toute façon refusée)
Deno.env.set('RESEND_API_KEY', 're_test_intercepte')
let logs: string[] = []
const keep = console.log
for (const m of ['log', 'warn', 'error'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))
let db = new FakeDB(); (globalThis as any).__db = db
// API Whop interceptée (résiliation d'un abonnement remplacé) : statuts à rendre aux POST …/cancel (200 par défaut), et
// abonnement renvoyé par un GET (relecture après un refus). Resend aussi (alertes à Axel, aucun envoi réel) : n'est appelé
// que dans les blocs qui posent RESEND_API_KEY.
const whop = { appels: [] as string[], cancel: [] as number[], get: { status: 'active', cancel_at_period_end: false } as any }
let mails: { subject: string; html: string }[] = []
const f0 = globalThis.fetch
globalThis.fetch = (async (u: any, o: any) => {
  const url = String(u)
  if (url.startsWith('https://api.resend.com/')) { const b = JSON.parse(String(o?.body || '{}')); mails.push({ subject: String(b.subject || ''), html: String(b.html || '') }); return new Response('{"id":"re_test"}', { status: 200 }) }
  if (url.startsWith('https://api.whop.com/')) {
    const m = String(o?.method || 'GET').toUpperCase()
    whop.appels.push(`${m} ${url.replace('https://api.whop.com/api/v1/memberships/', '')}`)
    if (m === 'POST') { const st = whop.cancel.length ? whop.cancel.shift()! : 200; return new Response(st < 300 ? '{}' : '{"error":"refus"}', { status: st }) }
    return new Response(JSON.stringify(whop.get), { status: 200 })
  }
  return f0(u, o)
}) as typeof fetch
const whopReset = () => { whop.appels = []; whop.cancel = []; whop.get = { status: 'active', cancel_at_period_end: false } }
const FN = Deno.args[0] ? new URL(Deno.args[0].replace(/\/?$/, '/'), 'file://' + Deno.cwd() + '/').href : '../../supabase/functions/'
await import(FN + 'whop-webhook/index.ts')
const handler = (globalThis as any).__handler
const reset = () => { db = new FakeDB(); (globalThis as any).__db = db; logs = [] }
// id : identifiant Svix imposé (un REJEU de Whop porte le même que l'envoi d'origine)
async function send(ev: unknown, id = 'msg_' + crypto.randomUUID()) {
  const body = JSON.stringify(ev), ts = String(Math.floor(Date.now() / 1000))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(RAW), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)))
  const r = await handler(new Request('https://x/', { method: 'POST', body, headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': 'v1,' + btoa(String.fromCharCode(...mac)) } }))
  return r.status
}
const act = (plan: string, mem: string, email: string, extra: any = {}) => ({ action: 'membership.went_valid', data: { id: mem, plan: { id: plan }, user: { email }, ...extra } })
const pay = (plan: string | null, mem: string, email: string, paid: string) => ({ action: 'payment.succeeded', data: { id: 'pay_' + crypto.randomUUID().slice(0, 8), membership_id: mem, ...(plan ? { plan: { id: plan } } : {}), user: { email }, initial_price_paid: paid } })
const fin = (plan: string, mem: string, email: string) => ({ action: 'membership.went_invalid', data: { id: mem, plan: { id: plan }, user: { email } } })
const remb = (plan: string, mem: string, email: string) => ({ action: 'refund.created', data: { id: 'ref_1', status: 'succeeded', payment: { id: 'pay_1', membership: { id: mem }, plan: { id: plan }, user: { email } } } })
const prof = (email: string) => db.rows('profiles').find((p) => p.email === email)
const vieillir = () => { for (const e of db.rows('webhook_events')) e.received_at = new Date(Date.now() - 40 * 86400000).toISOString() }

const TIERS: Record<string, [string, number, number]> = { starter: ['starter', 150, 25], pro: ['pro', 550, 50], elite: ['elite', 1100, 75], elite60: ['elite', 2200, 75], elite90: ['elite', 3300, 75] }
// [variante, palier, mensuel|annuel, pack, crédits pack, 1er paiement affiché par Whop, prix normal]
const V: [string, string, string, string, number, string, string][] = [
  ['plan_blQtyUh90R2wP', 'starter', 'm', 'S', 120, '€44.98', '€29.99'], ['plan_hE8bkwTPoTkrj', 'pro', 'm', 'S', 120, '€64.98', '€49.99'],
  ['plan_0iHH0kY3uoJpo', 'pro', 'm', 'M', 300, '€77.98', '€49.99'], ['plan_wn7ZntgBemFL0', 'elite', 'm', 'M', 300, '€117.98', '€89.99'],
  ['plan_i7ubxuFfVHQ5k', 'elite', 'm', 'L', 600, '€149.98', '€89.99'], ['plan_th1REeLIfRP50', 'elite60', 'm', 'L', 600, '€218.98', '€158.99'],
  ['plan_xN9BOWCvFUWXp', 'elite90', 'm', 'L', 600, '€284.98', '€224.99'], ['plan_NcMairMUEz3ST', 'starter', 'y', 'S', 120, '€264.98', '€249.99'],
  ['plan_iATzKyUuANyfI', 'pro', 'y', 'S', 120, '€464.98', '€449.99'], ['plan_QF7HXCR81yXRy', 'pro', 'y', 'M', 300, '€477.98', '€449.99'],
  ['plan_5RTUZOJ3sGCXd', 'elite', 'y', 'M', 300, '€827.98', '€799.99'], ['plan_QaAyO2Msc11Xk', 'elite', 'y', 'L', 600, '€859.98', '€799.99'],
  ['plan_tAKWwP8U88eTT', 'elite60', 'y', 'L', 600, '€1499.87', '€1439.88'], ['plan_xzr5jL4TCAlWf', 'elite90', 'y', 'L', 600, '€1955.87', '€1895.88'],
]
const res: [string, boolean, string][] = []
const ok = (nom: string, c: boolean, d = '') => { res.push([nom, c, d]); if (!c) keep('  ✗ ' + nom + ' — ' + d + '\n    ' + logs.slice(-6).join('\n    ')) }

for (const [id, tier, bill, pk, pc, first, renew] of V) {
  const [plan, cr, bonus] = TIERS[tier], tag = `${tier}${bill === 'y' ? ' annuel' : ''}+${pk}`
  // 1) acheteur SANS compte : compte créé, plan + bonus + pack (en crédits achetés)
  reset(); const e = `${tier}${bill}${pk}@test.fr`.toLowerCase()
  ok(tag + ' : activation 200', await send(act(id, 'mem_1', e)) === 200)
  let p = prof(e)
  ok(tag + ' : compte créé', !!p, JSON.stringify(db.rows('pending_activations')))
  ok(tag + ' : plan', p?.plan === plan, String(p?.plan))
  ok(tag + ' : crédits = plan + bonus + pack', p?.credits_remaining === cr + bonus + pc, `${p?.credits_remaining} ≠ ${cr + bonus + pc}`)
  ok(tag + ' : pack en crédits achetés', p?.bought_credits === pc, String(p?.bought_credits))
  ok(tag + ' : abonnement mémorisé', p?.whop_member_id === 'mem_1' && p?.whop_plan_id === id)
  ok(tag + ' : rien en attente', db.rows('pending_activations').length === 0)
  // 2) même abonnement activé une 2e fois (autre événement) : pas de 2e pack
  await send({ ...act(id, 'mem_1', e), action: 'membership.activated' }); p = prof(e)
  ok(tag + ' : pas de 2e pack', p?.bought_credits === pc && p?.credits_remaining <= cr + bonus + pc, `${p?.credits_remaining}/${p?.bought_credits}`)
  // 3) paiement du 1er cycle juste après : aucun re-crédit
  const avant = p?.credits_remaining
  await send(pay(id, 'mem_1', e, first)); p = prof(e)
  ok(tag + ' : paiement du 1er cycle sans effet', p?.credits_remaining === avant, `${avant} → ${p?.credits_remaining}`)
  // 4) renouvellement plus tard, 100 crédits dépensés : plan remis, pack gardé une fois, plan Whop inchangé
  vieillir(); p!.credits_remaining -= 100; const solde = p!.credits_remaining
  await send(pay(id, 'mem_1', e, renew)); p = prof(e)
  const planLeft = solde - pc, attendu = Math.min(planLeft + cr, 2 * cr) + pc
  ok(tag + ' : renouvellement', p?.credits_remaining === attendu && p?.bought_credits === pc && p?.whop_plan_id === id && p?.plan === plan, `${p?.credits_remaining} ≠ ${attendu}`)
  // 5) résiliation : retour en free, crédits du pack gardés
  await send(fin(id, 'mem_1', e)); p = prof(e)
  ok(tag + ' : résiliation garde le pack', p?.plan === 'free' && p?.credits_remaining === pc && !p?.whop_member_id, `${p?.plan} ${p?.credits_remaining}`)
  // 6) compte EXISTANT (connecté sur la page : metadata aa_user_id, adresse Whop verrouillée sur celle du compte) puis
  //    remboursement. Audit 23/10 (constats 4, 11, 16) : changement VOULU — avant, ce cas passait avec une AUTRE adresse
  //    chez Whop ; aa_user_id n'est plus suivi que si le compte porte l'adresse de l'acheteur (cas inverse : plus bas).
  reset(); db.rows('profiles').push({ id: '11111111-1111-4111-8111-111111111111', email: 'moi@test.fr', plan: 'free', credits_remaining: 10, bought_credits: 10, first_sub_bonus_used: true })
  await send(act(id, 'mem_2', 'moi@test.fr', { metadata: { aa_user_id: '11111111-1111-4111-8111-111111111111' } })); p = prof('moi@test.fr')
  ok(tag + ' : compte connecté (même adresse chez Whop)', p?.plan === plan && p?.credits_remaining === cr + 10 + pc && p?.bought_credits === 10 + pc && db.rows('profiles').length === 1, `${p?.plan} ${p?.credits_remaining}/${p?.bought_credits} profils=${db.rows('profiles').length}`)
  await send(remb(id, 'mem_2', 'moi@test.fr')); p = prof('moi@test.fr')
  ok(tag + ' : remboursement → free, 0', p?.plan === 'free' && p?.credits_remaining === 0, `${p?.plan} ${p?.credits_remaining}`)
}

// Passage Pro (abonnement normal) → Elite + Pack M : ancien abonnement remplacé, achetés gardés + pack
// (relecture du 24/10 : abonné connecté sur la page de paiement → aa_user_id vérifié ; sans, achat mis de côté, plus bas)
reset(); db.rows('profiles').push({ id: '22222222-2222-4222-8222-222222222222', email: 'pro@test.fr', plan: 'pro', credits_remaining: 300, bought_credits: 40, first_sub_bonus_used: true, whop_member_id: 'mem_old', whop_plan_id: 'plan_g4BVtDmk6hgjQ' })
await send(act('plan_wn7ZntgBemFL0', 'mem_new', 'pro@test.fr', { metadata: { aa_user_id: '22222222-2222-4222-8222-222222222222' } }))
let q = prof('pro@test.fr')
ok('Pro → Elite+M : plan elite, 1100 + 40 achetés + 300', q?.plan === 'elite' && q?.credits_remaining === 1440 && q?.bought_credits === 340 && q?.whop_member_id === 'mem_new', `${q?.credits_remaining}/${q?.bought_credits}`)
ok('Pro → Elite+M : ancien abonnement à annuler signalé', logs.some((l) => l.includes('WHOP_API_KEY manquant')))
await send(fin('plan_g4BVtDmk6hgjQ', 'mem_old', 'pro@test.fr')); q = prof('pro@test.fr')
ok('Pro → Elite+M : la fin de l\'ancien abonnement ne touche pas le nouveau', q?.plan === 'elite' && q?.credits_remaining === 1440)

// Rendu prioritaire, dans les deux ordres d'arrivée avec une variante (même panier, acheteur sans compte)
for (const ordre of ['prio-dabord', 'variante-dabord']) {
  reset(); const e = ordre + '@test.fr'
  const a1 = act('plan_5mcgIdN0ZTlCG', 'mem_prio', e), a2 = act('plan_0iHH0kY3uoJpo', 'mem_abo', e)
  for (const ev of ordre === 'prio-dabord' ? [a1, a2] : [a2, a1]) await send(ev)
  const p = prof(e)
  ok(`prio + Pro+M (${ordre}) : prioritaire`, p?.rendu_prioritaire === true && p?.prio_member_id === 'mem_prio', JSON.stringify(p))
  ok(`prio + Pro+M (${ordre}) : plan + crédits + pack`, p?.plan === 'pro' && p?.credits_remaining === 550 + 50 + 300 && p?.bought_credits === 300 && p?.whop_member_id === 'mem_abo', JSON.stringify(p))
  vieillir(); const c = p!.credits_remaining
  await send(pay(null, 'mem_prio', e, '€5.00'))
  ok(`prio (${ordre}) : son paiement ne touche ni plan ni crédits`, prof(e)?.credits_remaining === c && prof(e)?.plan === 'pro')
  await send(fin('plan_5mcgIdN0ZTlCG', 'mem_prio', e))
  ok(`prio (${ordre}) : résiliation → retiré, abonnement intact`, prof(e)?.rendu_prioritaire === false && prof(e)?.plan === 'pro' && prof(e)?.credits_remaining === c)
}

// Rendu prioritaire ANNUEL (plan à part pour Elite 60 / 90 annuels, même réglage 3D Secure)
for (const [prio, abo, plan, cr] of [['plan_2KlnrycFeoXMT', 'plan_QF7HXCR81yXRy', 'pro', 550 + 50 + 300], ['plan_oPv9MNE8701Tt', 'plan_tAKWwP8U88eTT', 'elite', 2200 + 75 + 600]] as [string, string, string, number][]) {
  reset(); const e = (prio + '@test.fr').toLowerCase()
  await send(act(prio, 'mem_prio', e)); await send(act(abo, 'mem_abo', e))
  const p = prof(e)
  ok(`prio annuel ${prio} : prioritaire + plan + pack`, p?.rendu_prioritaire === true && p?.plan === plan && p?.credits_remaining === cr && p?.whop_member_id === 'mem_abo', JSON.stringify(p))
  await send(fin(prio, 'mem_prio', e))
  ok(`prio annuel ${prio} : résiliation → retiré, abonnement intact`, prof(e)?.rendu_prioritaire === false && prof(e)?.plan === plan)
}

// Non-régression : abonnement normal sans pack (sans compte), et Pack M seul (avec compte)
reset(); await send(act('plan_g4BVtDmk6hgjQ', 'mem_b', 'base@test.fr')); q = prof('base@test.fr')
ok('Pro normal (sans compte) : 550 + 50, rien d\'acheté', q?.plan === 'pro' && q?.credits_remaining === 600 && (q?.bought_credits || 0) === 0, JSON.stringify(q))
reset(); db.rows('profiles').push({ id: '33333333-3333-4333-8333-333333333333', email: 'pk@test.fr', plan: 'pro', credits_remaining: 100, bought_credits: 0, first_sub_bonus_used: true, whop_member_id: 'mem_x', whop_plan_id: 'plan_g4BVtDmk6hgjQ' })
await send(act('plan_GLoKHMqZtNbLK', 'mem_pk', 'pk@test.fr')); q = prof('pk@test.fr')
ok('Pack M seul : +300 achetés, plan inchangé', q?.plan === 'pro' && q?.credits_remaining === 400 && q?.bought_credits === 300 && q?.whop_member_id === 'mem_x', JSON.stringify(q))

// Parrainage : 30 % du 1er paiement (pack compris), renouvellement plafonné au prix SANS le pack
reset()
db.rows('profiles').push({ id: '44444444-4444-4444-8444-444444444444', email: 'parrain@test.fr', plan: 'pro', whop_plan_id: 'plan_g4BVtDmk6hgjQ', signup_ip: '1.1.1.1' })
db.rows('profiles').push({ id: '55555555-5555-4555-8555-555555555555', email: 'filleul@test.fr', plan: 'free', credits_remaining: 0, bought_credits: 0, referred_by: 'CODE', signup_ip: '2.2.2.2' })
db.rpcs.referrer_id_from_code = () => '44444444-4444-4444-8444-444444444444'
await send(act('plan_0iHH0kY3uoJpo', 'mem_f', 'filleul@test.fr', { initial_price_paid: '€77.98' }))
let com = db.rows('referral_earnings')[0]
ok('parrainage 1er paiement Pro+M : 30 % de 77,98 €', com?.amount_cents === 7798 && com?.commission_cents === 2339, JSON.stringify(com))
db.t.referral_earnings = []; vieillir()
await send(pay('plan_0iHH0kY3uoJpo', 'mem_f', 'filleul@test.fr', '€77.98'))
com = db.rows('referral_earnings')[0]
ok('parrainage renouvellement : plafonné à 49,99 € (sans le pack)', com?.amount_cents === 4999 && com?.commission_cents === 1500, JSON.stringify(com))

// ═══════════════ Audit du 23/10 — zone webhook Whop (24/10) ═══════════════
const PRO = 'plan_g4BVtDmk6hgjQ', STARTER = 'plan_YKcdyPT6RRQSi', ELITE90 = 'plan_63PGeG3MesbJR', PRO_AN = 'plan_P7WIywSa6YrxT', PRO_AN_M = 'plan_QF7HXCR81yXRy'
const PRIO = 'plan_5mcgIdN0ZTlCG', PACK_S = 'plan_hR0u4VHoeszbu'
const ilYa = (jours: number) => new Date(Date.now() - jours * 86400_000).toISOString()
const compte = (id: string, email: string, extra: any = {}) => db.rows('profiles').push({ id, email, plan: 'free', credits_remaining: 0, bought_credits: 0, first_sub_bonus_used: false, created_at: ilYa(30), ...extra })
const evId = (id: string) => db.rows('webhook_events').some((e) => e.event_id === id)
const annul = (m: string) => db.rows('whop_annulations').find((r) => r.membership_id === m)

// ── Constats 4, 11, 16 : aa_user_id d'un AUTRE compte (écrit dans le navigateur) n'est plus suivi ──
reset(); whopReset(); Deno.env.set('WHOP_API_KEY', 'whop_test')
const VICT = '66666666-6666-4666-8666-666666666666'
compte(VICT, 'victime@test.fr', { plan: 'elite', credits_remaining: 3900, bought_credits: 600, first_sub_bonus_used: true, whop_member_id: 'mem_vict', whop_plan_id: ELITE90 })
await send(act(STARTER, 'mem_att', 'attaquant@test.fr', { metadata: { aa_user_id: VICT } }))
q = prof('victime@test.fr')
ok('aa_user_id d’un autre compte : plan, crédits et abonnement de la victime intacts', q?.plan === 'elite' && q?.credits_remaining === 3900 && q?.bought_credits === 600 && q?.whop_member_id === 'mem_vict', JSON.stringify(q))
ok('aa_user_id d’un autre compte : abonnement de la victime jamais résilié chez Whop', !whop.appels.some((x) => x.includes('mem_vict')) && !annul('mem_vict'), whop.appels.join(' | '))
ok('aa_user_id d’un autre compte : achat rattaché à l’adresse de l’acheteur', prof('attaquant@test.fr')?.plan === 'starter' && prof('attaquant@test.fr')?.whop_member_id === 'mem_att', JSON.stringify(prof('attaquant@test.fr')))
await send(remb(STARTER, 'mem_att', 'attaquant@test.fr')); await send(fin(STARTER, 'mem_att', 'attaquant@test.fr'))
q = prof('victime@test.fr')
ok('aa_user_id d’un autre compte : remboursement et fin de l’achat ne touchent pas la victime', q?.plan === 'elite' && q?.credits_remaining === 3900 && q?.whop_member_id === 'mem_vict', JSON.stringify(q))
Deno.env.delete('WHOP_API_KEY')

// ── Constats 1/13 (côté webhook) : une dépense faite PENDANT le traitement n'est plus effacée ni rendue ──
// (db.apresSelect : débit « plan d'abord », comme spend_credits, qui passe juste APRÈS la lecture du compte par le webhook)
const depense = (id: string, n: number) => { const p = db.rows('profiles').find((x) => x.id === id)!; const plan = Math.max(0, p.credits_remaining - p.bought_credits); p.bought_credits -= Math.max(0, n - plan); p.credits_remaining -= n }
const pendantTraitement = (id: string, n: number) => { let fait = false; db.apresSelect = (t, rows) => { if (!fait && t === 'profiles' && rows.some((r) => r.id === id && 'credits_remaining' in r)) { fait = true; depense(id, n) } } }
const U1 = '77777777-7777-4777-8777-777777777777'
reset(); compte(U1, 'atom@test.fr', { plan: 'pro', credits_remaining: 400, bought_credits: 100, first_sub_bonus_used: true, whop_member_id: 'mem_a', whop_plan_id: PRO })
pendantTraitement(U1, 300); await send(pay(PRO, 'mem_a', 'atom@test.fr', '€49.99')); db.apresSelect = null
ok('renouvellement : dépense pendant le traitement non effacée (100 + 550, pas 950)', prof('atom@test.fr')?.credits_remaining === 650 && prof('atom@test.fr')?.bought_credits === 100, JSON.stringify(prof('atom@test.fr')))
reset(); compte(U1, 'atom@test.fr', { plan: 'pro', credits_remaining: 500, bought_credits: 300, first_sub_bonus_used: true, whop_member_id: 'mem_a', whop_plan_id: PRO })
pendantTraitement(U1, 400); await send(fin(PRO, 'mem_a', 'atom@test.fr')); db.apresSelect = null
ok('fin d’abonnement : achetés dépensés pendant le traitement non rendus (100, pas 300)', prof('atom@test.fr')?.plan === 'free' && prof('atom@test.fr')?.credits_remaining === 100, JSON.stringify(prof('atom@test.fr')))
reset(); compte(U1, 'atom@test.fr', { plan: 'pro', credits_remaining: 100, bought_credits: 0, first_sub_bonus_used: true, whop_member_id: 'mem_a', whop_plan_id: PRO })
pendantTraitement(U1, 100); await send(act(PACK_S, 'mem_pk1', 'atom@test.fr')); db.apresSelect = null
ok('pack : ajouté au solde COURANT (0 + 120, pas 100 + 120)', prof('atom@test.fr')?.credits_remaining === 120 && prof('atom@test.fr')?.bought_credits === 120, JSON.stringify(prof('atom@test.fr')))
reset(); compte(U1, 'atom@test.fr', { plan: 'pro', credits_remaining: 300, bought_credits: 40, first_sub_bonus_used: true, whop_member_id: 'mem_old', whop_plan_id: PRO })
pendantTraitement(U1, 290); await send(act('plan_w8lh5zpEJFOQR', 'mem_new', 'atom@test.fr', { metadata: { aa_user_id: U1 } })); db.apresSelect = null
ok('changement de palier : achetés dépensés pendant le traitement non rendus (1100 + 10)', prof('atom@test.fr')?.credits_remaining === 1110 && prof('atom@test.fr')?.bought_credits === 10, JSON.stringify(prof('atom@test.fr')))

// ── Constats 5 et 9 : plans ANNUELS, crédits du plan versés chaque mois (modèle de verser_credits_annuels) ──
reset(); await send(act(PRO_AN, 'mem_an', 'annuel@test.fr')); q = prof('annuel@test.fr')
ok('annuel : activation = mois 1 (550 + 50) et décompte posé', q?.credits_remaining === 600 && q?.annuel_mois === 1 && !!q?.annuel_debut, JSON.stringify(q))
ok('annuel : rien à verser avant la date anniversaire', db.rpcs.verser_credits_annuels({}) === 0 && prof('annuel@test.fr')?.credits_remaining === 600)
q!.annuel_debut = plusMois(new Date().toISOString(), -1); q!.credits_remaining = 100
ok('annuel : 1 versement à la date anniversaire', db.rpcs.verser_credits_annuels({}) === 1)
q = prof('annuel@test.fr')
ok('annuel : mois 2 = report + 550 (100 + 550)', q?.credits_remaining === 650 && q?.annuel_mois === 2 && db.rows('credits_annuels_versements').length === 1, JSON.stringify(q))
ok('annuel : 2e passage le même jour sans effet (idempotent)', db.rpcs.verser_credits_annuels({}) === 0 && prof('annuel@test.fr')?.credits_remaining === 650)
q!.annuel_debut = plusMois(new Date(Date.now() - 2 * 86400_000).toISOString(), -3); q!.annuel_mois = 1; q!.bought_credits = 300; q!.credits_remaining = 300
db.t.credits_annuels_versements = []
ok('annuel : échéances en retard rattrapées une par une (3)', db.rpcs.verser_credits_annuels({}) === 3)
q = prof('annuel@test.fr')
ok('annuel : report plafonné à 2× le mois, achetés gardés par-dessus (1100 + 300)', q?.credits_remaining === 1400 && q?.bought_credits === 300 && q?.annuel_mois === 4, JSON.stringify(q))
q!.annuel_debut = plusMois(new Date().toISOString(), -14); q!.annuel_mois = 1; db.t.credits_annuels_versements = []
ok('annuel : jamais plus de 12 mois par année payée (11 versements après l’activation)', db.rpcs.verser_credits_annuels({}) === 11 && prof('annuel@test.fr')?.annuel_mois === 12)
ok('annuel : rien au-delà du 12e mois', db.rpcs.verser_credits_annuels({}) === 0)
vieillir(); await send(pay(PRO_AN, 'mem_an', 'annuel@test.fr', '€449.99')); q = prof('annuel@test.fr')
ok('annuel : le paiement de l’année suivante repart au mois 1', q?.annuel_mois === 1 && Date.now() - Date.parse(q?.annuel_debut) < 60_000, JSON.stringify(q))
q!.whop_cancel_at_period_end = true; q!.annuel_debut = plusMois(new Date().toISOString(), -1)
ok('annuel résilié (fin de période programmée) : le mois suivant de l’année payée est versé', db.rpcs.verser_credits_annuels({}) === 1)
await send(fin(PRO_AN, 'mem_an', 'annuel@test.fr')); q = prof('annuel@test.fr')
ok('annuel : fin d’abonnement → plus aucun versement', q?.plan === 'free' && q?.annuel_debut == null && db.rpcs.verser_credits_annuels({}) === 0, JSON.stringify(q))
reset(); await send(act(PRO_AN_M, 'mem_anm', 'annuelm@test.fr')); q = prof('annuelm@test.fr')
ok('annuel + pack (variante) : décompte posé, pack en achetés', q?.annuel_mois === 1 && q?.bought_credits === 300 && q?.credits_remaining === 900, JSON.stringify(q))
reset(); await send(act(PRO, 'mem_mens', 'mensuel@test.fr'))
ok('mensuel : aucun décompte annuel', prof('mensuel@test.fr')?.annuel_debut == null && db.rpcs.verser_credits_annuels({}) === 0)
reset(); compte('88888888-8888-4888-8888-888888888888', 'sansdebut@test.fr', { plan: 'pro', credits_remaining: 600, whop_member_id: 'mem_sd', whop_plan_id: PRO_AN })
ok('annuel sans date de départ (achat en attente) : décompte posé à partir de maintenant, rien versé', db.rpcs.verser_credits_annuels({}) === 0 && prof('sansdebut@test.fr')?.annuel_mois === 1 && !!prof('sansdebut@test.fr')?.annuel_debut)

// ── Constats 14 et 19 : panier sans compte « abonnement sans pack + rendu prioritaire », événements SIMULTANÉS ──
{
  const ko: string[] = []
  for (let i = 0; i < 8; i++) for (const [nom, plan, mem] of [['Pro', PRO, 'mem_abo'], ['Pack S', PACK_S, 'mem_pk']] as const) {
    reset(); const e = `panier${i}${nom.replace(' ', '')}@test.fr`.toLowerCase()
    const evs = [act(PRIO, 'mem_prio', e), act(plan, mem, e)]
    if (i % 2) evs.reverse()
    const st = await Promise.all(evs.map((ev) => send(ev)))
    const p = prof(e), attendu = nom === 'Pro' ? p?.plan === 'pro' && p?.credits_remaining === 600 : p?.credits_remaining === 120 && p?.bought_credits === 120
    if (!(st.every((x) => x === 200) && p?.rendu_prioritaire === true && attendu && db.rows('pending_activations').length === 0 && db.rows('profiles').length === 1))
      ko.push(`${nom}#${i}: ${st} ${JSON.stringify(p)} attente=${JSON.stringify(db.rows('pending_activations'))}`)
  }
  ok('prio + abonnement / pack sans compte, arrivés en même temps (16 essais) : achat toujours appliqué', ko.length === 0, ko.slice(0, 2).join(' || '))
}

// ── Constat 20 : nouveau rendu prioritaire → l'ancien est résilié chez Whop ──
// (relecture du 24/10 : abonné connecté → aa_user_id vérifié ; refus de Whop → 200, la file est retentée par les webhooks
// suivants au lieu d'un 500 qui sortait l'activation du journal)
const UP = '99999999-9999-4999-8999-999999999999'
const ping = () => send({ action: 'app.ping', data: {} })   // n'importe quel webhook signé : la file est retentée après lui
const relancer = (m: string) => { const r = annul(m); if (r) r.dernier_essai_at = ilYa(1) }   // 30 min passées depuis l'essai
reset(); whopReset(); Deno.env.set('WHOP_API_KEY', 'whop_test')
compte(UP, 'prio2@test.fr', { plan: 'pro', credits_remaining: 500, first_sub_bonus_used: true, whop_member_id: 'mem_p', whop_plan_id: PRO, rendu_prioritaire: true, prio_member_id: 'mem_prio_old' })
ok('2e rendu prioritaire : 200', await send(act(PRIO, 'mem_prio_new', 'prio2@test.fr', { metadata: { aa_user_id: UP } })) === 200)
ok('2e rendu prioritaire : l’ancien est résilié chez Whop (fin de période)', whop.appels.includes('POST mem_prio_old/cancel') && !!annul('mem_prio_old')?.fait_at && prof('prio2@test.fr')?.prio_member_id === 'mem_prio_new', whop.appels.join(' | '))
await send(fin(PRIO, 'mem_prio_old', 'prio2@test.fr'))
ok('2e rendu prioritaire : la fin de l’ancien ne coupe pas le nouveau', prof('prio2@test.fr')?.rendu_prioritaire === true && prof('prio2@test.fr')?.prio_member_id === 'mem_prio_new')
reset(); whopReset(); whop.cancel = [500]
compte(UP, 'prio3@test.fr', { plan: 'pro', credits_remaining: 500, first_sub_bonus_used: true, whop_member_id: 'mem_p', whop_plan_id: PRO, rendu_prioritaire: true, prio_member_id: 'mem_prio_old' })
const evP = act(PRIO, 'mem_prio_new', 'prio3@test.fr', { metadata: { aa_user_id: UP } })
ok('2e rendu prioritaire, Whop refuse : 200, activation gardée au journal, ancien en file (1 essai)', await send(evP, 'msg_prio_fixe') === 200 && evId('msg_prio_fixe') && annul('mem_prio_old')?.essais === 1 && !annul('mem_prio_old')?.fait_at && prof('prio3@test.fr')?.prio_member_id === 'mem_prio_new')
await ping()
ok('2e rendu prioritaire : pas de nouvel essai avant 30 min', whop.appels.filter((x) => x === 'POST mem_prio_old/cancel').length === 1)
relancer('mem_prio_old'); await ping()
ok('2e rendu prioritaire : webhook suivant, 30 min après → résiliation retentée et faite', !!annul('mem_prio_old')?.fait_at && whop.appels.filter((x) => x === 'POST mem_prio_old/cancel').length === 2, whop.appels.join(' | '))
Deno.env.delete('WHOP_API_KEY')

// ── Constat 22 : changement de palier, échec de résiliation de l'ancien abonnement → signalé et retenté ──
const UG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
reset(); whopReset(); Deno.env.set('WHOP_API_KEY', 'whop_test'); whop.cancel = [503]
compte(UG, 'palier@test.fr', { plan: 'pro', credits_remaining: 300, bought_credits: 40, first_sub_bonus_used: true, whop_member_id: 'mem_old', whop_plan_id: PRO })
const evG = act('plan_wn7ZntgBemFL0', 'mem_new', 'palier@test.fr', { metadata: { aa_user_id: UG } })
const st1 = await send(evG, 'msg_palier_fixe'); q = prof('palier@test.fr')
ok('palier, Whop ne répond pas : 200, activation gardée au journal (page « Paiement confirmé »)', st1 === 200 && evId('msg_palier_fixe'), String(st1))
ok('palier, Whop ne répond pas : nouveau plan appliqué (1100 + 40 + 300)', q?.plan === 'elite' && q?.credits_remaining === 1440 && q?.bought_credits === 340 && q?.whop_member_id === 'mem_new', JSON.stringify(q))
ok('palier, Whop ne répond pas : ancien abonnement en file, échec signalé', annul('mem_old')?.essais === 1 && !annul('mem_old')?.fait_at && logs.some((l) => l.includes('Échec annulation ancien abonnement mem_old')))
q!.credits_remaining -= 200   // dépense entre l'échec et le nouvel essai
ok('palier, rejeu du même événement par Whop : déjà traité', await send(evG, 'msg_palier_fixe') === 200 && whop.appels.filter((x) => x === 'POST mem_old/cancel').length === 1)
relancer('mem_old'); await ping(); q = prof('palier@test.fr')
ok('palier, webhook suivant 30 min après : ancien abonnement résilié', !!annul('mem_old')?.fait_at && whop.appels.filter((x) => x === 'POST mem_old/cancel').length === 2, whop.appels.join(' | '))
ok('palier : rien n’est recrédité (1240, pas de 2e pack ni de remise à plein)', q?.credits_remaining === 1240 && q?.bought_credits === 340, JSON.stringify(q))
reset(); whopReset(); whop.cancel = [400]; whop.get = { status: 'active', cancel_at_period_end: true }
compte(UG, 'palier2@test.fr', { plan: 'pro', credits_remaining: 300, first_sub_bonus_used: true, whop_member_id: 'mem_old', whop_plan_id: PRO })
ok('palier, Whop refuse mais l’ancien finit déjà : traité comme fait (200)', await send(act('plan_w8lh5zpEJFOQR', 'mem_new', 'palier2@test.fr', { metadata: { aa_user_id: UG } })) === 200 && !!annul('mem_old')?.fait_at, whop.appels.join(' | '))
reset(); whopReset()
compte(UG, 'palier3@test.fr', { plan: 'pro', credits_remaining: 300, first_sub_bonus_used: true, whop_member_id: 'mem_old', whop_plan_id: PRO, whop_cancel_at_period_end: true })
await send(act('plan_w8lh5zpEJFOQR', 'mem_new', 'palier3@test.fr'))
ok('palier, ancien déjà résilié dans l’app : aucun appel Whop (appliqué même sans aa_user_id)', whop.appels.length === 0 && !annul('mem_old') && prof('palier3@test.fr')?.plan === 'elite', whop.appels.join(' | '))
reset(); whopReset(); vieillir()
compte(UG, 'palier4@test.fr', { plan: 'elite', credits_remaining: 900, first_sub_bonus_used: true, whop_member_id: 'mem_new', whop_plan_id: 'plan_w8lh5zpEJFOQR' })
await send(pay(PRO, 'mem_old', 'palier4@test.fr', '€49.99'))
ok('palier : paiement de l’ANCIEN abonnement (résiliation ratée) ignoré par identifiant', prof('palier4@test.fr')?.plan === 'elite' && prof('palier4@test.fr')?.credits_remaining === 900 && logs.some((l) => l.includes('n\'est plus l\'actif')))
reset(); vieillir()
compte(UG, 'palier5@test.fr', { plan: 'pro', credits_remaining: 100, first_sub_bonus_used: true, whop_member_id: 'mem_new', whop_plan_id: PRO })
await send(pay(PRO, 'mem_old', 'palier5@test.fr', '€49.99'))
ok('palier : ancien abonnement du MÊME plan Whop ne compte plus comme un renouvellement du nouveau', prof('palier5@test.fr')?.credits_remaining === 100, JSON.stringify(prof('palier5@test.fr')))
// Relecture du 24/10 : Whop refuse pour de bon → 8 essais espacés puis alerte « à la main » ; les activations suivantes du
// compte ne sont plus bloquées (avant : 500 à chacune, tant que la ligne restait dans la file)
reset(); whopReset(); whop.cancel = Array(30).fill(500); mails = []
compte(UG, 'refus@test.fr', { plan: 'pro', credits_remaining: 300, first_sub_bonus_used: true, whop_member_id: 'mem_r_old', whop_plan_id: PRO })
ok('Whop refuse toujours : 200, activation gardée au journal, plan appliqué', await send(act('plan_w8lh5zpEJFOQR', 'mem_r_new', 'refus@test.fr', { metadata: { aa_user_id: UG } }), 'msg_refus') === 200 && evId('msg_refus') && prof('refus@test.fr')?.plan === 'elite')
ok('Whop refuse toujours : Axel alerté dès le 1er échec', mails.some((m) => m.subject.includes('Ancien abonnement Whop non résilié')))
for (let i = 0; i < 10; i++) { relancer('mem_r_old'); await ping() }
ok('Whop refuse toujours : 8 essais au plus, puis alerte « à résilier à la main »', annul('mem_r_old')?.essais === 8 && whop.appels.filter((x) => x === 'POST mem_r_old/cancel').length === 8 && mails.some((m) => m.subject.includes('à résilier à la main')), `${annul('mem_r_old')?.essais} ${whop.appels.length}`)
ok('Whop refuse toujours : activation suivante du compte en 200 (plus de blocage)', await send(act(ELITE90, 'mem_r_new2', 'refus@test.fr', { metadata: { aa_user_id: UG } })) === 200 && prof('refus@test.fr')?.whop_plan_id === ELITE90)
Deno.env.delete('WHOP_API_KEY')

// ── Constat 23 : écritures vérifiées → 500, Whop rejoue, sans double crédit ──
const UE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
reset(); compte(UE, 'panne@test.fr', { plan: 'pro', credits_remaining: 100, first_sub_bonus_used: true, whop_member_id: 'mem_e', whop_plan_id: PRO })
const evR = pay(PRO, 'mem_e', 'panne@test.fr', '€49.99')
db.pannes.add('rpc:whop_webhook_renouveler')
ok('renouvellement, base en panne : 500 et verrou relâché', await send(evR, 'msg_ren_fixe') === 500 && !evId('msg_ren_fixe') && prof('panne@test.fr')?.credits_remaining === 100)
db.pannes.clear()
ok('renouvellement, rejeu de Whop : mois versé', await send(evR, 'msg_ren_fixe') === 200 && prof('panne@test.fr')?.credits_remaining === 650)
ok('renouvellement, 2e rejeu : déjà traité, rien de plus', await send(evR, 'msg_ren_fixe') === 200 && prof('panne@test.fr')?.credits_remaining === 650)
db.pannes.add('select:profiles')
ok('renouvellement, lecture du compte en panne : 500 (plus de paiement « sans profil »)', await send(pay(PRO, 'mem_e', 'panne@test.fr', '€49.99')) === 500)
db.pannes.clear(); db.pannes.add('rpc:whop_webhook_fin')
const evF = fin(PRO, 'mem_e', 'panne@test.fr')
ok('fin d’abonnement, base en panne : 500, compte toujours payant', await send(evF, 'msg_fin_fixe') === 500 && prof('panne@test.fr')?.plan === 'pro')
db.pannes.clear()
ok('fin d’abonnement, rejeu de Whop : free', await send(evF, 'msg_fin_fixe') === 200 && prof('panne@test.fr')?.plan === 'free')
reset(); compte(UE, 'panne2@test.fr', { plan: 'pro', credits_remaining: 400, first_sub_bonus_used: true, whop_member_id: 'mem_e', whop_plan_id: PRO })
db.pannes.add('update:profiles')
ok('remboursement, écriture en panne : 500, plus d’alerte « plan remis à free » mensongère', await send(remb(PRO, 'mem_e', 'panne2@test.fr'), 'msg_remb_fixe') === 500 && prof('panne2@test.fr')?.plan === 'pro')
db.pannes.clear()
ok('remboursement, rejeu de Whop : free, 0', await send(remb(PRO, 'mem_e', 'panne2@test.fr'), 'msg_remb_fixe') === 200 && prof('panne2@test.fr')?.plan === 'free' && prof('panne2@test.fr')?.credits_remaining === 0)
reset(); db.pannes.add('rpc:whop_webhook_activer')
ok('activation, base en panne : 500, rien d’appliqué', await send(act(PRO, 'mem_x1', 'panne3@test.fr'), 'msg_act_fixe') === 500 && prof('panne3@test.fr')?.plan === 'free')
db.pannes.clear()
ok('activation, rejeu de Whop : plan appliqué une fois (550 + 50)', await send(act(PRO, 'mem_x1', 'panne3@test.fr'), 'msg_act_fixe') === 200 && prof('panne3@test.fr')?.credits_remaining === 600 && db.rows('profiles').length === 1)

// ── Constat 24 : résiliation / réactivation faite CHEZ WHOP ──
const UC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const capeEv = (mem: string, email: string, v: boolean, action = 'membership.cancel_at_period_end_changed') => ({ action, data: { id: mem, plan: { id: PRO }, user: { email }, cancel_at_period_end: v, status: 'active' } })
reset(); compte(UC, 'whopcancel@test.fr', { plan: 'pro', credits_remaining: 700, bought_credits: 100, first_sub_bonus_used: true, whop_member_id: 'mem_c', whop_plan_id: PRO })
await send(capeEv('mem_c', 'whopcancel@test.fr', true)); q = prof('whopcancel@test.fr')
ok('résiliation chez Whop : crédits du plan retirés, achetés gardés, drapeau posé, plan actif', q?.credits_remaining === 100 && q?.bought_credits === 100 && q?.whop_cancel_at_period_end === true && q?.plan === 'pro' && !!q?.cancel_requested_at, JSON.stringify(q))
await send(capeEv('mem_c', 'whopcancel@test.fr', true))
ok('résiliation chez Whop reçue deux fois : rien de plus', prof('whopcancel@test.fr')?.credits_remaining === 100)
await send(capeEv('mem_c', 'whopcancel@test.fr', false)); q = prof('whopcancel@test.fr')
ok('réactivation chez Whop : drapeau retiré, crédits inchangés', q?.whop_cancel_at_period_end === false && q?.credits_remaining === 100, JSON.stringify(q))
await send(capeEv('mem_autre', 'whopcancel@test.fr', true, 'membership.updated'))
ok('résiliation chez Whop d’un AUTRE abonnement que l’actif : rien', prof('whopcancel@test.fr')?.whop_cancel_at_period_end === false && prof('whopcancel@test.fr')?.credits_remaining === 100)
await send(capeEv('mem_c', 'whopcancel@test.fr', true, 'membership.updated'))
ok('membership.updated avec cancel_at_period_end : traité pareil', prof('whopcancel@test.fr')?.whop_cancel_at_period_end === true)

// ── Constat 27 : abonnement qui redevient valide après une désactivation ──
reset(); await send(act('plan_xN9BOWCvFUWXp', 'mem_v', 'react@test.fr')); await send(fin('plan_xN9BOWCvFUWXp', 'mem_v', 'react@test.fr'))
ok('variante désactivée : free, pack gardé (600)', prof('react@test.fr')?.plan === 'free' && prof('react@test.fr')?.credits_remaining === 600)
await send(act('plan_xN9BOWCvFUWXp', 'mem_v', 'react@test.fr')); q = prof('react@test.fr')
ok('même abonnement réactivé : plan revenu, pack PAS reversé (3300 + 600, pas 1200 achetés)', q?.plan === 'elite' && q?.bought_credits === 600 && q?.credits_remaining === 3900 && q?.whop_member_id === 'mem_v', JSON.stringify(q))
reset(); await send(act(PRO, 'mem_w', 'react2@test.fr')); await send(fin(PRO, 'mem_w', 'react2@test.fr')); vieillir()
await send(pay(PRO, 'mem_w', 'react2@test.fr', '€49.99')); q = prof('react2@test.fr')
ok('réactivation par un simple paiement : plan revenu ET abonnement Whop rattaché (bouton Annuler, résiliation)', q?.plan === 'pro' && q?.credits_remaining === 550 && q?.whop_member_id === 'mem_w', JSON.stringify(q))

// ── Constat 21 : achat sans compte avec code de parrainage joint au paiement ──
const PARRAIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
reset(); compte(PARRAIN, 'parrain2@test.fr', { plan: 'pro', whop_plan_id: PRO, signup_ip: '1.1.1.1' })
db.rpcs.referrer_id_from_code = (a: any) => a.p_code === 'DDDDDDDDDD' ? PARRAIN : null
await send(act(PRO, 'mem_nf', 'nouveau-filleul@test.fr', { initial_price_paid: '€49.99', metadata: { aa_ref: 'DDDDDDDDDD' } }))
com = db.rows('referral_earnings')[0]
ok('achat sans compte + code de parrainage : parrain posé sur le compte créé', prof('nouveau-filleul@test.fr')?.referred_by === 'DDDDDDDDDD', JSON.stringify(prof('nouveau-filleul@test.fr')))
ok('achat sans compte + code de parrainage : commission du 1er paiement (30 % de 49,99 €, en revue IP inconnue)', com?.referrer_id === PARRAIN && com?.commission_cents === 1500 && !!com?.review_reason, JSON.stringify(com))
compte('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'ancien-client@test.fr')
await send(act(PACK_S, 'mem_ac', 'ancien-client@test.fr', { metadata: { aa_ref: 'DDDDDDDDDD' } }))
ok('code de parrainage sur un compte de plus de 24 h : refusé (règle de set_referrer)', !prof('ancien-client@test.fr')?.referred_by && db.rows('referral_earnings').length === 1)

// ── Constat 45 : deux packs identiques le même jour = deux commissions ──
reset(); compte(PARRAIN, 'parrain3@test.fr', { plan: 'pro', whop_plan_id: PRO, signup_ip: '1.1.1.1' })
compte('ffffffff-ffff-4fff-8fff-ffffffffffff', 'filleul2@test.fr', { referred_by: 'CODE', signup_ip: '2.2.2.2' })
db.rpcs.referrer_id_from_code = () => PARRAIN
await send(act(PACK_S, 'mem_s1', 'filleul2@test.fr', { initial_price_paid: '€19.99' })); await send(act(PACK_S, 'mem_s2', 'filleul2@test.fr', { initial_price_paid: '€19.99' }))
ok('2 Pack S le même jour : 2 commissions de 6,00 €', db.rows('referral_earnings').length === 2 && db.rows('referral_earnings').every((r) => r.commission_cents === 600), JSON.stringify(db.rows('referral_earnings').map((r) => r.dedupe_key)))
await send(act(PRO, 'mem_s3', 'filleul2@test.fr', { initial_price_paid: '€49.99' })); await send({ ...pay(PRO, 'mem_s3', 'filleul2@test.fr', '€49.99'), })
ok('activation + paiement du 1er cycle : une seule commission', db.rows('referral_earnings').filter((r) => r.plan_id === PRO).length === 1)

// ── Constat 34 : 1er cycle reconnu par l'abonnement, plus par l'adresse ni par 10 minutes ──
const UR = '12121212-1212-4212-8212-121212121212'
reset(); compte(UR, 'cycle@test.fr', { plan: 'pro', credits_remaining: 100, first_sub_bonus_used: true, whop_member_id: 'mem_r', whop_plan_id: PRO })
await send(act(PACK_S, 'mem_pack_r', 'cycle@test.fr'))   // pack acheté juste avant le renouvellement, même adresse
await send(pay(PRO, 'mem_r', 'cycle@test.fr', '€49.99'))
ok('renouvellement juste après un pack de la même adresse : versé (100 + 120 + 550)', prof('cycle@test.fr')?.credits_remaining === 770, JSON.stringify(prof('cycle@test.fr')))
reset(); await send(act(PRO, 'mem_t', 'tard@test.fr'))
for (const e of db.rows('webhook_events')) e.received_at = new Date(Date.now() - 30 * 60_000).toISOString()   // 30 min plus tard
await send(pay(PRO, 'mem_t', 'tard@test.fr', '€49.99'))
ok('paiement du 1er cycle rejoué 30 min après l’activation : pas de 2e mois', prof('tard@test.fr')?.credits_remaining === 600, JSON.stringify(prof('tard@test.fr')))
compte('34343434-3434-4434-8434-343434343434', 'avant2@test.fr')
await send({ action: 'payment.succeeded', data: { id: 'pay_z2', membership: { id: 'mem_z2' }, plan: { id: 'plan_0iHH0kY3uoJpo' }, user: { email: 'avant2@test.fr' }, billing_reason: 'subscription_create' } })
await send(act('plan_0iHH0kY3uoJpo', 'mem_z2', 'avant2@test.fr')); q = prof('avant2@test.fr')
ok('paiement arrivé AVANT l’activation : plan + bonus + pack une seule fois (550 + 50 + 300)', q?.credits_remaining === 900 && q?.bought_credits === 300 && q?.first_sub_bonus_used === true, JSON.stringify(q))

// ── Constat 59 : essai gratuit (trialing) ──
reset(); await send(act(PRO, 'mem_trial', 'essai@test.fr', { status: 'trialing' })); q = prof('essai@test.fr')
ok('essai gratuit : plan ouvert, aucun crédit du plan ni bonus', q?.plan === 'pro' && q?.credits_remaining === 0 && q?.first_sub_bonus_used === false, JSON.stringify(q))
await send(pay(PRO, 'mem_trial', 'essai@test.fr', '€49.99'))
ok('essai gratuit : le 1er vrai paiement verse le mois (550)', prof('essai@test.fr')?.credits_remaining === 550, JSON.stringify(prof('essai@test.fr')))

// ── Constat 44 : litige du 1er paiement d'une variante APRÈS la fin de l'abonnement ──
reset(); await send(act('plan_0iHH0kY3uoJpo', 'mem_v44', 'litige@test.fr')); await send(act(PACK_S, 'mem_s44', 'litige@test.fr'))
await send(fin('plan_0iHH0kY3uoJpo', 'mem_v44', 'litige@test.fr'))
ok('variante + pack à part, fin d’abonnement : 300 + 120 achetés gardés', prof('litige@test.fr')?.credits_remaining === 420)
const litige = { action: 'dispute.created', data: { id: 'dsp_1', status: 'needs_response', payment: { id: 'pay_v44', billing_reason: 'subscription_create', membership: { id: 'mem_v44' }, plan: { id: 'plan_0iHH0kY3uoJpo' }, user: { email: 'litige@test.fr' } } } }
await send(litige)
ok('litige du 1er paiement de la variante après la fin : crédits du pack retirés, pack à part gardé (120)', prof('litige@test.fr')?.credits_remaining === 120 && prof('litige@test.fr')?.bought_credits === 120, JSON.stringify(prof('litige@test.fr')))
await send({ ...litige, action: 'dispute.updated' })
ok('litige : 2e événement du même paiement, rien de plus', prof('litige@test.fr')?.credits_remaining === 120)

// ── Constat 43 : aucune adresse en clair dans les journaux ──
{
  reset(); compte(PARRAIN, 'parrain4@test.fr', { plan: 'pro', whop_plan_id: PRO, signup_ip: '1.1.1.1' }); db.rpcs.referrer_id_from_code = () => PARRAIN
  await send(act('plan_0iHH0kY3uoJpo', 'mem_l1', 'journal-client@test.fr', { initial_price_paid: '€77.98', metadata: { aa_ref: 'DDDDDDDDDD' } }))
  await send(act(PACK_S, 'mem_l2', 'journal-client@test.fr')); vieillir()
  await send(pay('plan_0iHH0kY3uoJpo', 'mem_l1', 'journal-client@test.fr', '€49.99'))
  await send(remb(PACK_S, 'mem_l2', 'journal-client@test.fr')); await send(fin('plan_0iHH0kY3uoJpo', 'mem_l1', 'journal-client@test.fr'))
  await send(act(PACK_S, 'mem_l3', 'journal-sans@test.fr'))
  const clair = logs.filter((l) => /[a-z0-9._-]{3,}@test\.fr/i.test(l))
  ok('journaux : adresses masquées (achat, pack, renouvellement, remboursement, fin, parrainage)', clair.length === 0 && logs.some((l) => l.includes('jo•••@test.fr')), clair.slice(0, 2).join(' || '))
}

// ═══════════════ Relecture du 24/10 (zone webhook) ═══════════════
const ELITE30 = 'plan_w8lh5zpEJFOQR', PRO_M = 'plan_0iHH0kY3uoJpo'
const aVerifier = (m: string) => db.rows('whop_achats_a_verifier').find((r) => r.membership_id === m)
const sujets = (t: string) => mails.filter((m) => m.subject.includes(t)).length

// ── 1) Sabotage par la seule ADRESSE (constats 4/11/16 sans aa_user_id) : compte déjà abonné → achat mis de côté ──
const VA = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
reset(); whopReset(); Deno.env.set('WHOP_API_KEY', 'whop_test'); mails = []
compte(VA, 'abonne@test.fr', { plan: 'elite', credits_remaining: 3900, bought_credits: 600, first_sub_bonus_used: true, whop_member_id: 'mem_vict', whop_plan_id: ELITE90 })
ok('adresse seule, compte déjà abonné : 200', await send(act(STARTER, 'mem_att2', 'abonne@test.fr')) === 200)
q = prof('abonne@test.fr')
ok('adresse seule : plan, crédits et abonnement du compte intacts', q?.plan === 'elite' && q?.credits_remaining === 3900 && q?.bought_credits === 600 && q?.whop_member_id === 'mem_vict', JSON.stringify(q))
ok('adresse seule : abonnement du compte jamais résilié chez Whop', !whop.appels.some((x) => x.includes('mem_vict')) && !annul('mem_vict'), whop.appels.join(' | '))
ok('adresse seule : achat mis de côté, Axel alerté avec les deux abonnements', aVerifier('mem_att2')?.abonnement_du_compte === 'mem_vict' && sujets('Achat à vérifier') === 1 && mails.some((m) => m.html.includes('mem_att2') && m.html.includes('mem_vict') && m.html.includes('whop_achat_valider')))
await send({ ...act(STARTER, 'mem_att2', 'abonne@test.fr'), action: 'membership.activated' })
ok('adresse seule : 2e événement d’activation, rien de plus (une seule alerte)', sujets('Achat à vérifier') === 1 && prof('abonne@test.fr')?.credits_remaining === 3900)
ok('adresse seule : ni bienvenue ni commission', sujets('Bienvenue') === 0 && db.rows('referral_earnings').length === 0 && db.rows('email_log').length === 0)
await send({ action: 'payment.succeeded', data: { id: 'pay_att2', membership: { id: 'mem_att2' }, plan: { id: STARTER }, user: { email: 'abonne@test.fr' }, billing_reason: 'subscription_create', initial_price_paid: '€29.99' } })
await send({ action: 'dispute.created', data: { id: 'dsp_a', status: 'needs_response', payment: { id: 'pay_att2', billing_reason: 'subscription_create', membership: { id: 'mem_att2' }, plan: { id: STARTER }, user: { email: 'abonne@test.fr' } } } })
q = prof('abonne@test.fr')
ok('adresse seule, paiement puis litige de l’achat : compte toujours intact (elite, 3900, 600 achetés)', q?.plan === 'elite' && q?.credits_remaining === 3900 && q?.bought_credits === 600 && q?.whop_member_id === 'mem_vict', JSON.stringify(q))
ok('adresse seule, litige : achat clos, plus validable', aVerifier('mem_att2')?.decision === 'remboursé ou contesté' && db.rpcs.whop_achat_valider({ p_member: 'mem_att2' })?.ok === false)
// variante (abonnement + pack) mise de côté puis contestée : aucun pack retiré au compte de l'adresse (constat 44)
reset(); whopReset(); mails = []
compte(VA, 'abonne2@test.fr', { plan: 'elite', credits_remaining: 1500, bought_credits: 300, first_sub_bonus_used: true, whop_member_id: 'mem_v2', whop_plan_id: ELITE90 })
await send(act(PRO_M, 'mem_att3', 'abonne2@test.fr'))
await send({ action: 'dispute.created', data: { id: 'dsp_b', status: 'needs_response', payment: { id: 'pay_att3', billing_reason: 'subscription_create', membership: { id: 'mem_att3' }, plan: { id: PRO_M }, user: { email: 'abonne2@test.fr' } } } })
q = prof('abonne2@test.fr')
ok('variante mise de côté puis contestée : aucun pack retiré au compte de l’adresse (1500, 300 achetés)', q?.credits_remaining === 1500 && q?.bought_credits === 300 && q?.plan === 'elite', JSON.stringify(q))
// fin de l'abonnement mis de côté : achat clos, compte intact
reset(); whopReset()
compte(VA, 'abonne3@test.fr', { plan: 'pro', credits_remaining: 500, first_sub_bonus_used: true, whop_member_id: 'mem_v3', whop_plan_id: PRO })
await send(act(STARTER, 'mem_att4', 'abonne3@test.fr')); await send(fin(STARTER, 'mem_att4', 'abonne3@test.fr'))
ok('adresse seule, fin de l’abonnement payé : achat clos, compte intact', aVerifier('mem_att4')?.decision === 'abonnement terminé' && prof('abonne3@test.fr')?.plan === 'pro' && db.rpcs.whop_achat_valider({ p_member: 'mem_att4' })?.ok === false)
// comptes NON concernés par la mise de côté : gratuit, ou abonnement déjà résilié (palier3 plus haut)
reset(); compte(VA, 'gratuit@test.fr', { credits_remaining: 100, bought_credits: 100, first_sub_bonus_used: true })
await send(act(STARTER, 'mem_g', 'gratuit@test.fr')); q = prof('gratuit@test.fr')
ok('adresse seule, compte gratuit : achat appliqué normalement (150 + 100 achetés)', q?.plan === 'starter' && q?.credits_remaining === 250 && q?.whop_member_id === 'mem_g' && !aVerifier('mem_g'), JSON.stringify(q))

// ── 2) Montée en gamme SANS session (page de secours whop.com) : mise de côté, puis validée par Axel ──
const VB = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
reset(); whopReset(); mails = []
compte(VB, 'monte@test.fr', { plan: 'pro', credits_remaining: 300, bought_credits: 40, first_sub_bonus_used: true, whop_member_id: 'mem_old_b', whop_plan_id: PRO })
await send(act('plan_wn7ZntgBemFL0', 'mem_new_b', 'monte@test.fr', { manage_url: 'https://whop.com/billing/manage/tok_b' }))
ok('montée en gamme sans session : mise de côté, rien changé', prof('monte@test.fr')?.plan === 'pro' && prof('monte@test.fr')?.credits_remaining === 300 && !!aVerifier('mem_new_b') && whop.appels.length === 0)
vieillir(); await send(pay('plan_wn7ZntgBemFL0', 'mem_new_b', 'monte@test.fr', '€89.99'))
ok('achat mis de côté prélevé de nouveau : rappel dédié à Axel, aucun crédit', sujets('Rappel : achat à vérifier') === 1 && sujets('ancien abonnement') === 0 && prof('monte@test.fr')?.credits_remaining === 300)
const rv = db.rpcs.whop_achat_valider({ p_member: 'mem_new_b' }); q = prof('monte@test.fr')
ok('validation par Axel : plan + achetés + pack (1100 + 40 + 300), ancien abonnement en file', rv?.ok && q?.plan === 'elite' && q?.credits_remaining === 1440 && q?.bought_credits === 340 && q?.whop_member_id === 'mem_new_b' && q?.whop_manage_url === 'https://whop.com/billing/manage/tok_b' && !!annul('mem_old_b') && !annul('mem_old_b')?.fait_at, JSON.stringify([rv, q]))
await ping()
ok('validation : l’ancien abonnement est résilié chez Whop au webhook suivant', whop.appels.includes('POST mem_old_b/cancel') && !!annul('mem_old_b')?.fait_at, whop.appels.join(' | '))
ok('validation refaite : refusée (achat clos)', db.rpcs.whop_achat_valider({ p_member: 'mem_new_b' })?.ok === false && prof('monte@test.fr')?.credits_remaining === 1440)
await send({ ...act('plan_wn7ZntgBemFL0', 'mem_new_b', 'monte@test.fr'), action: 'membership.activated' })
ok('validation : une activation tardive du même abonnement ne change rien', prof('monte@test.fr')?.credits_remaining === 1440 && prof('monte@test.fr')?.bought_credits === 340)

// ── 3) Rendu prioritaire payé par la seule adresse d'un compte qui a déjà le sien : rien ne change ──
const VC = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'
reset(); whopReset(); mails = []
compte(VC, 'prio-adr@test.fr', { plan: 'pro', credits_remaining: 500, first_sub_bonus_used: true, whop_member_id: 'mem_pc', whop_plan_id: PRO, rendu_prioritaire: true, prio_member_id: 'mem_prio_v' })
ok('rendu prioritaire par adresse, compte qui a déjà le sien : 200', await send(act(PRIO, 'mem_prio_att', 'prio-adr@test.fr')) === 200)
ok('rendu prioritaire par adresse : le sien n’est ni remplacé ni résilié, Axel alerté', prof('prio-adr@test.fr')?.prio_member_id === 'mem_prio_v' && whop.appels.length === 0 && !annul('mem_prio_v') && sujets('Rendu prioritaire à vérifier') === 1)
await send(fin(PRIO, 'mem_prio_att', 'prio-adr@test.fr'))
ok('rendu prioritaire par adresse : la fin de l’abonnement payé ne coupe pas celui du compte', prof('prio-adr@test.fr')?.rendu_prioritaire === true && prof('prio-adr@test.fr')?.prio_member_id === 'mem_prio_v')
reset(); compte(VC, 'prio-neuf@test.fr', { plan: 'pro', credits_remaining: 500, first_sub_bonus_used: true, whop_member_id: 'mem_pn', whop_plan_id: PRO })
await send(act(PRIO, 'mem_prio_n', 'prio-neuf@test.fr'))
ok('rendu prioritaire par adresse, compte sans rendu prioritaire : activé normalement', prof('prio-neuf@test.fr')?.rendu_prioritaire === true && prof('prio-neuf@test.fr')?.prio_member_id === 'mem_prio_n')

// ── 4) Parrain posé seulement sur un compte créé par le paiement (ou connecté) ──
const VD = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4'
reset(); compte(PARRAIN, 'parrain5@test.fr', { plan: 'pro', whop_plan_id: PRO, signup_ip: '1.1.1.1' })
db.rpcs.referrer_id_from_code = (a: any) => a.p_code === 'DDDDDDDDDD' ? PARRAIN : null
compte(VD, 'tout-neuf@test.fr', { created_at: new Date().toISOString(), signup_ip: '3.3.3.3' })
await send(act(PACK_S, 'mem_tn1', 'tout-neuf@test.fr', { initial_price_paid: '€19.99', metadata: { aa_ref: 'DDDDDDDDDD' } }))
await send(act(PRO, 'mem_tn2', 'tout-neuf@test.fr', { initial_price_paid: '€49.99', metadata: { aa_ref: 'DDDDDDDDDD' } }))
ok('compte de moins de 24 h retrouvé par l’adresse : le code du payeur n’est pas posé, aucune commission', !prof('tout-neuf@test.fr')?.referred_by && db.rows('referral_earnings').length === 0, JSON.stringify(prof('tout-neuf@test.fr')))
await send(act(PACK_S, 'mem_tn3', 'tout-neuf@test.fr', { initial_price_paid: '€19.99', metadata: { aa_ref: 'DDDDDDDDDD', aa_user_id: VD } }))
ok('même compte, connecté (aa_user_id vérifié) : parrain posé, commission du paiement', prof('tout-neuf@test.fr')?.referred_by === 'DDDDDDDDDD' && db.rows('referral_earnings').length === 1)
for (const ordre of ['prio-dabord', 'abo-dabord']) {
  reset(); compte(PARRAIN, 'parrain6@test.fr', { plan: 'pro', whop_plan_id: PRO, signup_ip: '1.1.1.1' })
  db.rpcs.referrer_id_from_code = (a: any) => a.p_code === 'DDDDDDDDDD' ? PARRAIN : null
  const e = `panier-ref-${ordre}@test.fr`, md = { metadata: { aa_ref: 'DDDDDDDDDD' } }
  const evs = [act(PRIO, 'mem_pp', e, md), act(PRO, 'mem_pa', e, { initial_price_paid: '€49.99', ...md })]
  for (const ev of ordre === 'prio-dabord' ? evs : evs.reverse()) await send(ev)
  ok(`panier sans compte rendu prioritaire + abonnement + code (${ordre}) : parrain posé, commission du 1er paiement`, prof(e)?.referred_by === 'DDDDDDDDDD' && db.rows('referral_earnings').length === 1 && db.rows('referral_earnings')[0]?.commission_cents === 1500, JSON.stringify([prof(e), db.rows('referral_earnings')]))
}

// ── 5) Essai gratuit d'un plan ANNUEL : aucun mois versé avant le 1er paiement ──
reset(); await send(act(PRO_AN, 'mem_ta', 'essai-an@test.fr', { status: 'trialing' })); q = prof('essai-an@test.fr')
ok('essai d’un annuel : aucun crédit, marqué essai (annuel_mois 0, sans départ)', q?.plan === 'pro' && q?.credits_remaining === 0 && q?.annuel_mois === 0 && q?.annuel_debut == null, JSON.stringify(q))
ok('essai d’un annuel : le rattrapage du versement mensuel ne le prend pas pour un annuel payé', db.rpcs.verser_credits_annuels({}) === 0 && prof('essai-an@test.fr')?.annuel_debut == null && prof('essai-an@test.fr')?.credits_remaining === 0)
ok('essai d’un annuel : toujours rien au passage suivant', db.rpcs.verser_credits_annuels({}) === 0 && prof('essai-an@test.fr')?.credits_remaining === 0)
await send(pay(PRO_AN, 'mem_ta', 'essai-an@test.fr', '€449.99')); q = prof('essai-an@test.fr')
ok('essai d’un annuel : le 1er vrai paiement verse le mois et pose le départ', q?.credits_remaining === 550 && q?.annuel_mois === 1 && !!q?.annuel_debut, JSON.stringify(q))

// ── 6) aa_user_id d'un compte qui ne porte pas l'adresse Whop : refus gardé, Axel alerté ──
const VE = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5'
reset(); mails = []; compte(VE, 'connecte@test.fr')
await send(act(PRO, 'mem_ec', 'autre-adresse@test.fr', { metadata: { aa_user_id: VE } }))
ok('aa_user_id ≠ adresse Whop : achat sur l’adresse Whop, compte connecté intact', prof('autre-adresse@test.fr')?.plan === 'pro' && prof('connecte@test.fr')?.plan === 'free')
ok('aa_user_id ≠ adresse Whop : Axel alerté (compte, deux adresses, compte créé)', sujets('autre adresse que le compte connecté') === 1 && mails.some((m) => m.html.includes(VE) && m.html.includes('connecte@test.fr') && m.html.includes('autre-adresse@test.fr') && m.html.includes('créé pour cet achat')))
await send(pay(PRO, 'mem_ec', 'autre-adresse@test.fr', '€49.99'))
ok('aa_user_id ≠ adresse Whop : pas de nouvelle alerte aux paiements suivants', sujets('autre adresse que le compte connecté') === 1)

// ── 7) Création de compte refusée : achat en attente, avec les verrous d'une activation ──
reset(); db.pannes.add('auth:createUser')
await send(act(PRO_M, 'mem_pend', 'attente@test.fr'))
ok('création refusée : achat en attente (550 + 50 + 300) et verrous posés', db.rows('pending_activations')[0]?.credits === 900 && evId('whop-activation:mem_pend') && evId('whop-pack-variante:mem_pend'), JSON.stringify(db.rows('pending_activations')))
db.pannes.delete('auth:createUser')
await createClient('', '').auth.admin.createUser({ email: 'attente@test.fr' })   // inscription plus tard (handle_new_user)
ok('inscription : achat en attente appliqué', prof('attente@test.fr')?.plan === 'pro' && prof('attente@test.fr')?.credits_remaining === 900)
await send({ ...act(PRO_M, 'mem_pend', 'attente@test.fr'), action: 'membership.activated' })
ok('2e activation du même abonnement après l’inscription : ni mois remis à plein ni 2e pack (900)', prof('attente@test.fr')?.credits_remaining === 900, JSON.stringify(prof('attente@test.fr')))
reset(); db.pannes.add('auth:createUser')
await send(act(PRO, 'mem_pe', 'attente-essai@test.fr', { status: 'trialing' }))
ok('création refusée, essai gratuit : plan en attente sans crédits ni verrou', db.rows('pending_activations')[0]?.credits === 0 && db.rows('pending_activations')[0]?.plan === 'pro' && !evId('whop-activation:mem_pe'))
db.pannes.clear()

// ── 8) Réactivation par un simple paiement : lien « Gérer mon abonnement » repris du journal (constat 27b) ──
reset(); await send(act(PRO, 'mem_mu', 'lien@test.fr', { manage_url: 'https://whop.com/billing/manage/tok_1' }))
await send(fin(PRO, 'mem_mu', 'lien@test.fr')); vieillir()
ok('fin d’abonnement : lien de gestion retiré', !prof('lien@test.fr')?.whop_manage_url && !prof('lien@test.fr')?.whop_member_id)
await send(pay(PRO, 'mem_mu', 'lien@test.fr', '€49.99')); q = prof('lien@test.fr')
ok('réactivation par un simple paiement : abonnement ET lien de gestion rattachés', q?.whop_member_id === 'mem_mu' && q?.whop_manage_url === 'https://whop.com/billing/manage/tok_1', JSON.stringify(q))

// ── 9) Fin du rendu prioritaire, lecture du compte en panne : 500, rien n'est retiré ──
const VF = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6'
reset(); compte(VF, 'prio-lect@test.fr', { plan: 'pro', rendu_prioritaire: true, prio_member_id: 'mem_prio_cur' })
db.pannes.add('select:profiles')
const evPF = fin(PRIO, 'mem_prio_cur', 'prio-lect@test.fr')
ok('fin du rendu prioritaire, lecture en panne : 500, drapeau intact', await send(evPF, 'msg_prio_lect') === 500 && prof('prio-lect@test.fr')?.rendu_prioritaire === true)
db.pannes.clear()
ok('fin du rendu prioritaire, rejeu : drapeau retiré', await send(evPF, 'msg_prio_lect') === 200 && prof('prio-lect@test.fr')?.rendu_prioritaire === false)

// ── 10) Modèle de verser_credits_annuels aligné sur le SQL : un refus annule les versements du compte dans ce passage ──
const VG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
reset(); const deb = plusMois(new Date(Date.now() - 86400_000).toISOString(), -3)
compte(VG, 'doublon@test.fr', { plan: 'pro', whop_plan_id: PRO_AN, credits_remaining: 0, annuel_mois: 1, annuel_debut: deb })
db.rows('credits_annuels_versements').push({ user_id: VG, echeance: plusMois(deb, 3), mois: 4, credits: 1, solde_avant: 0, solde_apres: 0 })
ok('modèle annuel : échéance déjà au journal → aucun versement de ce compte dans ce passage (comme en SQL)', db.rpcs.verser_credits_annuels({}) === 0 && prof('doublon@test.fr')?.credits_remaining === 0 && prof('doublon@test.fr')?.annuel_mois === 1 && db.rows('credits_annuels_versements').length === 1)
Deno.env.delete('WHOP_API_KEY')

// ── Relecture finale du 24/10 : compte payant DONNÉ À LA MAIN (plan Élite, ni abonnement ni plan Whop) — un achat par la
//    seule adresse, son renouvellement 40 jours plus tard, sa fin et son litige ne changent jamais ce compte ──
reset(); whopReset(); mails = []
const VM = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'
compte(VM, 'offert@test.fr', { plan: 'elite', credits_remaining: 549, bought_credits: 312, first_sub_bonus_used: true })
await send(act(STARTER, 'mem_off', 'offert@test.fr'))
q = prof('offert@test.fr')
ok('plan offert, achat par adresse : mis de côté, compte intact', !!aVerifier('mem_off') && q?.plan === 'elite' && q?.credits_remaining === 549 && !q?.whop_member_id, JSON.stringify(q))
vieillir()
await send(pay(STARTER, 'mem_off', 'offert@test.fr', '€29.99'))
q = prof('offert@test.fr')
ok('plan offert, renouvellement de l’achat mis de côté : rien de rattaché ni de crédité', q?.plan === 'elite' && q?.credits_remaining === 549 && !q?.whop_member_id && !q?.whop_plan_id, JSON.stringify(q))
db.rows('whop_achats_a_verifier').forEach((r) => { r.traite_at = new Date().toISOString(); r.decision = 'test' })   // tranché ailleurs
await send(pay(STARTER, 'mem_off', 'offert@test.fr', '€29.99'))
q = prof('offert@test.fr')
ok('plan offert, paiement d’un abonnement inconnu (plus en attente) : plan jamais remplacé', q?.plan === 'elite' && q?.credits_remaining === 549 && !q?.whop_member_id, JSON.stringify(q))
await send(fin(STARTER, 'mem_off', 'offert@test.fr'))
q = prof('offert@test.fr')
ok('plan offert, fin d’un abonnement inconnu : jamais repassé en gratuit', q?.plan === 'elite' && q?.credits_remaining === 549, JSON.stringify(q))
await send({ action: 'dispute.created', data: { id: 'dsp_off', status: 'needs_response', payment: { id: 'pay_off', billing_reason: 'subscription_cycle', membership: { id: 'mem_off' }, plan: { id: STARTER }, user: { email: 'offert@test.fr' } } } })
q = prof('offert@test.fr')
ok('plan offert, litige d’un abonnement inconnu : jamais remis à zéro', q?.plan === 'elite' && q?.credits_remaining === 549 && q?.bought_credits === 312, JSON.stringify(q))
// ancien abonné sans identifiant enregistré mais AVEC le même plan Whop : un simple paiement le rattache toujours
reset(); whopReset()
compte(VM, 'ancien@test.fr', { plan: 'starter', credits_remaining: 20, first_sub_bonus_used: true, whop_plan_id: STARTER })
vieillir()
await send(pay(STARTER, 'mem_anc', 'ancien@test.fr', '€29.99'))
q = prof('ancien@test.fr')
ok('ancien abonné, même plan Whop, sans identifiant : le paiement le rattache et le crédite', q?.whop_member_id === 'mem_anc' && q?.credits_remaining > 20, JSON.stringify(q))

const ko = res.filter((r) => !r[1])
keep(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) { keep('ÉCHECS :'); for (const r of ko) keep(' - ' + r[0] + ' ' + r[2]); Deno.exit(1) }
