// Rejoue whop-webhook (code réel) sur une base factice, avec de vrais événements signés : chaque variante
// « abonnement + pack », le rendu prioritaire, et les cas de base (non-régression).
import { FakeDB } from './fake-supabase.ts'
const RAW = 'secret-de-test-0123456789abcdef'
Deno.env.set('SUPABASE_URL', 'https://test.local'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x')
Deno.env.set('WHOP_WEBHOOK_SECRET', 'whsec_' + btoa(RAW)); Deno.env.set('WHOP_PRIO_PLANS', 'plan_5mcgIdN0ZTlCG,plan_2KlnrycFeoXMT,plan_oPv9MNE8701Tt')
for (const k of ['RESEND_API_KEY', 'WHOP_API_KEY', 'WHOP_UPSELL_PACKS']) Deno.env.delete(k)
let logs: string[] = []
const keep = console.log
for (const m of ['log', 'warn', 'error'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))
let db = new FakeDB(); (globalThis as any).__db = db
await import('../../supabase/functions/whop-webhook/index.ts')
const handler = (globalThis as any).__handler
const reset = () => { db = new FakeDB(); (globalThis as any).__db = db; logs = [] }
async function send(ev: unknown) {
  const body = JSON.stringify(ev), id = 'msg_' + crypto.randomUUID(), ts = String(Math.floor(Date.now() / 1000))
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
  // 6) compte EXISTANT (connecté sur la page : metadata aa_user_id) puis remboursement
  reset(); db.rows('profiles').push({ id: '11111111-1111-4111-8111-111111111111', email: 'moi@test.fr', plan: 'free', credits_remaining: 10, bought_credits: 10, first_sub_bonus_used: true })
  await send(act(id, 'mem_2', 'autre-adresse@test.fr', { metadata: { aa_user_id: '11111111-1111-4111-8111-111111111111' } })); p = prof('moi@test.fr')
  ok(tag + ' : compte connecté (autre e-mail chez Whop)', p?.plan === plan && p?.credits_remaining === cr + 10 + pc && p?.bought_credits === 10 + pc && db.rows('profiles').length === 1, `${p?.plan} ${p?.credits_remaining}/${p?.bought_credits} profils=${db.rows('profiles').length}`)
  await send(remb(id, 'mem_2', 'autre-adresse@test.fr')); p = prof('moi@test.fr')
  ok(tag + ' : remboursement → free, 0', p?.plan === 'free' && p?.credits_remaining === 0, `${p?.plan} ${p?.credits_remaining}`)
}

// Passage Pro (abonnement normal) → Elite + Pack M : ancien abonnement remplacé, achetés gardés + pack
reset(); db.rows('profiles').push({ id: '22222222-2222-4222-8222-222222222222', email: 'pro@test.fr', plan: 'pro', credits_remaining: 300, bought_credits: 40, first_sub_bonus_used: true, whop_member_id: 'mem_old', whop_plan_id: 'plan_g4BVtDmk6hgjQ' })
await send(act('plan_wn7ZntgBemFL0', 'mem_new', 'pro@test.fr'))
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

const ko = res.filter((r) => !r[1])
keep(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) { keep('ÉCHECS :'); for (const r of ko) keep(' - ' + r[0] + ' ' + r[2]); Deno.exit(1) }
