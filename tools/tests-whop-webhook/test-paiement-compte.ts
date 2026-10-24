// Rejoue supabase/functions/paiement-compte (code réel) sur la base factice : connexion après achat réservée aux comptes neufs,
// et (audit 23/10, constats 3, 10, 12, 15) seulement après un code envoyé à l'adresse de l'achat. E-mails Resend interceptés.
import { FakeDB } from './fake-supabase.ts'
Deno.env.set('SUPABASE_URL', 'https://test.local'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x'); Deno.env.set('RESEND_API_KEY', 'k')
let logs: string[] = []
const keep = console.log
for (const m of ['log', 'warn', 'error'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))
const mails: { to: string, subject: string, html: string }[] = []
let resendKo = false
const f0 = globalThis.fetch
globalThis.fetch = (async (u: any, o: any) => {
  if (String(u).includes('api.resend.com')) {
    if (resendKo) return new Response('{}', { status: 500 })
    const b = JSON.parse(o.body); mails.push({ to: b.to[0], subject: b.subject, html: b.html }); return new Response('{"id":"x"}', { status: 200 })
  }
  return f0(u, o)
}) as typeof fetch
// plafonds rate_events : rateHit (guard.ts) garde le 1er client créé → la règle vit ici, partagée par toutes les bases factices
let refuse = (_k: string) => false
const cles: string[] = []
let db = new FakeDB(); (globalThis as any).__db = db
await import('../../supabase/functions/paiement-compte/index.ts')
const handler = (globalThis as any).__handler
const call = async (body: unknown, auth = '', ip = '') => { const h: Record<string, string> = {}; if (auth) h.authorization = 'Bearer ' + auth; if (ip) h['x-real-ip'] = ip
  const r = await handler(new Request('https://x/', { method: 'POST', body: JSON.stringify(body), headers: h })); return { status: r.status, j: await r.json() } }
const N = 'a1b2c3d4-e5f6-4789-abcd-0123456789ab', N2 = 'b2c3d4e5-f6a7-4890-bcde-123456789abc'
const recent = new Date().toISOString(), vieux = new Date(Date.now() - 3 * 86400_000).toISOString()
// état des comptes vu par la fonction SQL paiement_compte_etat
const comptes: Record<string, any> = {}
const setup = () => {
  db = new FakeDB(); (globalThis as any).__db = db; logs = []; mails.length = 0; resendKo = false; refuse = () => false; cles.length = 0
  for (const k of Object.keys(comptes)) delete comptes[k]
  db.rpcs.rate_hit = (a: any) => { cles.push(String(a.p_key)); return !refuse(String(a.p_key)) }
  db.rpcs.paiement_compte_etat = (a: any) => { const u = Object.values(comptes).find((c: any) => (a.p_user && c.id === a.p_user) || (!a.p_user && c.email === a.p_email)); return u ? [{ ...u, a_mot_de_passe: !!(u.a_mot_de_passe || db.mdp[u.id]) }] : [] }
  db.rpcs.paiement_code_take_attempt = (a: any) => { const r = db.rows('paiement_codes').find((x) => x.id === a.p_id && x.user_id === a.p_user && (x.attempts || 0) < a.p_max); if (!r) return null; r.attempts = (r.attempts || 0) + 1; return r.attempts }
}
const activation = (email: string, meta: any = {}, nonce = N) => db.rows('webhook_events').push({ event_id: 'msg_' + Math.random(), received_at: new Date().toISOString(), body: { action: 'membership.activated', data: { id: 'mem_1', plan: { id: 'plan_x' }, user: { email }, metadata: { aa_page: 'paiement', aa_nonce: nonce, ...meta } } } })
const codeDe = (to: string) => { const m = [...mails].reverse().find((x) => x.to === to); return m ? m.subject.slice(0, 6) : '' }
const autre = (c: string) => c === '123456' ? '654321' : '123456'
const vieillir = () => { for (const r of db.rows('paiement_codes')) r.created_at = new Date(Date.now() - 120_000).toISOString() }   // délai d'envoi écoulé
const liens = () => db.log.filter((l) => l.startsWith('lien')).length
const res: [string, boolean, string][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c, d]); if (!c) keep('  ✗ ' + n + ' — ' + d + '\n    ' + logs.slice(-4).join('\n    ')) }

setup(); comptes.neuf = { id: 'u-neuf', email: 'neuf@test.fr', created_at: recent, last_sign_in_at: null, a_mot_de_passe: false }
let r = await call({ action: 'etat', nonce: N })
ok('avant le webhook : pas payé', r.j.paid === false, JSON.stringify(r.j))
r = await call({ action: 'code', nonce: N })
ok('avant le webhook : aucun code envoyé', r.j.paid === false && mails.length === 0, JSON.stringify(r.j))
activation('neuf@test.fr')
r = await call({ action: 'etat', nonce: N })
ok('après activation : compte neuf, adresse masquée', r.j.paid === true && r.j.compte === 'nouveau' && !r.j.token_hash && r.j.email === 'ne•••@test.fr', JSON.stringify(r.j))
// ── plus aucun jeton sans le code reçu à l'adresse de l'achat ──
r = await call({ action: 'connexion', nonce: N })
ok('connexion SANS code : aucun jeton', r.status === 400 && r.j.error === 'wrong_code' && !r.j.token_hash && liens() === 0, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N, code: '123456' })
ok('connexion avec un code inventé avant tout envoi : aucun jeton', r.j.error === 'expired' && !r.j.token_hash && liens() === 0, JSON.stringify(r.j))
ok('aucun verrou de connexion posé sans code', !db.rows('webhook_events').some((e) => String(e.event_id).startsWith('paiement-compte:')), '')
r = await call({ action: 'code', nonce: N, email: 'pirate@test.fr' })
ok('code envoyé à l\'adresse DE L\'ACHAT (jamais à une adresse fournie par la page)', r.status === 200 && r.j.envoye === true && mails.length === 1 && mails[0].to === 'neuf@test.fr' && /^\d{6} — /.test(mails[0].subject), JSON.stringify([r.j, mails.map((m) => m.to)]))
ok('réponse de l\'envoi : adresse masquée, pas de code', r.j.email === 'ne•••@test.fr' && !JSON.stringify(r.j).includes(codeDe('neuf@test.fr')), JSON.stringify(r.j))
const c1 = codeDe('neuf@test.fr')
const ligne = db.rows('paiement_codes')[0]
ok('code stocké haché (jamais en clair), 10 min, lié au paiement', !!ligne && ligne.code_hash !== c1 && !JSON.stringify(ligne).includes(c1) && ligne.nonce === N && ligne.user_id === 'u-neuf'
  && Math.abs(Date.parse(ligne.expires_at) - Date.now() - 600_000) < 5_000, JSON.stringify(ligne))
ok('e-mail sobre : code affiché, sans émoji', mails[0].html.includes(c1) && !/\p{Extended_Pictographic}/u.test(mails[0].html + mails[0].subject), mails[0].subject)
r = await call({ action: 'code', nonce: N })
ok('renvoi immédiat : délai de 30 s', r.status === 429 && r.j.error === 'cooldown' && r.j.wait > 0 && mails.length === 1, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N, code: autre(c1) })
ok('mauvais code : refusé, essais restants', r.status === 400 && r.j.error === 'wrong_code' && r.j.remaining === 4 && !r.j.token_hash && liens() === 0, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N2, code: c1 })
ok('le bon code avec un autre paiement : rien', r.j.paid === false && !r.j.token_hash, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N, code: c1 })
ok('connexion avec le bon code : jeton remis', r.j.compte === 'nouveau' && r.j.token_hash === 'th_neuf@test.fr' && r.j.email === 'neuf@test.fr', JSON.stringify(r.j))
const lk = db.rows('webhook_events').find((e) => e.event_id === 'paiement-compte:' + N)
ok('verrou de connexion avec la preuve par code', lk?.body?.data?.user === 'u-neuf' && lk?.body?.data?.preuve === 'code', JSON.stringify(lk))
r = await call({ action: 'connexion', nonce: N, code: c1 })
ok('code à usage unique : 2e connexion refusée', !r.j.token_hash && liens() === 1, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: 'ffffffff-ffff-4fff-bfff-ffffffffffff', code: c1 })
ok('autre identifiant : rien', r.j.paid === false && !r.j.token_hash, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: 'pas-un-uuid', code: c1 })
ok('identifiant mal formé : 400', r.status === 400, JSON.stringify(r.j))
r = await call({ action: 'nimporte', nonce: N })
ok('action inconnue : 400', r.status === 400 && r.j.error === 'action', JSON.stringify(r.j))
ok('journaux : aucune adresse en clair', !logs.some((l) => l.includes('neuf@test.fr')), logs.join(' | '))
// mot de passe
db.tokens['jeton-neuf'] = { id: 'u-neuf', email: 'neuf@test.fr' }
r = await call({ action: 'mot_de_passe', password: 'court' }, 'jeton-neuf')
ok('mot de passe trop court : refusé', r.status === 400 && r.j.error === 'weak_password', JSON.stringify(r.j))
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-neuf')
ok('1er mot de passe posé (après la preuve par code)', r.j.ok === true && db.mdp['u-neuf'] === true && db.rows('password_change_grants').length === 0, JSON.stringify(r.j))
r = await call({ action: 'mot_de_passe', password: 'unAutreMotDePasse9' }, 'jeton-neuf')
ok('2e mot de passe par ce chemin : refusé', r.status === 403, JSON.stringify(r.j))
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-inconnu')
ok('sans session : 401', r.status === 401, JSON.stringify(r.j))

// ancien verrou (posé sans code, avant ce correctif) : plus de 1er mot de passe
setup(); comptes.neuf = { id: 'u-neuf', email: 'neuf@test.fr', created_at: recent, last_sign_in_at: null, a_mot_de_passe: false }
db.rows('webhook_events').push({ event_id: 'paiement-compte:' + N, received_at: new Date().toISOString(), body: { action: 'audit.paiement_compte', data: { user: 'u-neuf' } } })
db.tokens['jeton-neuf'] = { id: 'u-neuf', email: 'neuf@test.fr' }
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-neuf')
ok('verrou sans preuve par code : mot de passe refusé', r.status === 403 && !db.mdp['u-neuf'], JSON.stringify(r.j))

// 5 essais faux brûlent le code ; un nouveau code fonctionne
setup(); comptes.neuf = { id: 'u-neuf', email: 'neuf@test.fr', created_at: recent, last_sign_in_at: null, a_mot_de_passe: false }
activation('neuf@test.fr')
await call({ action: 'code', nonce: N })
let bon = codeDe('neuf@test.fr')
for (let i = 0; i < 5; i++) r = await call({ action: 'connexion', nonce: N, code: autre(bon) })
ok('5e essai faux : code brûlé', r.j.error === 'too_many_attempts', JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N, code: bon })
ok('après 5 essais faux, le bon code ne passe plus', !r.j.token_hash && (r.j.error === 'expired' || r.j.error === 'too_many_attempts') && liens() === 0, JSON.stringify(r.j))
vieillir(); r = await call({ action: 'code', nonce: N })
const bon2 = codeDe('neuf@test.fr')
ok('nouveau code après le délai', r.j.envoye === true && mails.length === 2, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N, code: bon2 })
ok('nouveau code juste : jeton', r.j.token_hash === 'th_neuf@test.fr', JSON.stringify(r.j))
// un renvoi remplace l'ancien code (un seul code vivant par paiement)
setup(); comptes.neuf = { id: 'u-neuf', email: 'neuf@test.fr', created_at: recent, last_sign_in_at: null, a_mot_de_passe: false }
activation('neuf@test.fr')
await call({ action: 'code', nonce: N }); bon = codeDe('neuf@test.fr')
vieillir(); await call({ action: 'code', nonce: N }); const nouveau = codeDe('neuf@test.fr')
r = await call({ action: 'connexion', nonce: N, code: bon })
ok('code renvoyé : l\'ancien ne vaut plus', !r.j.token_hash && (bon === nouveau || r.j.error === 'expired' || r.j.error === 'wrong_code'), JSON.stringify(r.j))
ok('un seul code vivant par paiement', db.rows('paiement_codes').filter((x) => !x.used_at).length === 1, String(db.rows('paiement_codes').length))
// code expiré
for (const x of db.rows('paiement_codes')) x.expires_at = new Date(Date.now() - 1000).toISOString()
r = await call({ action: 'connexion', nonce: N, code: nouveau })
ok('code expiré (10 min) : refusé', r.j.error === 'expired' && !r.j.token_hash, JSON.stringify(r.j))
// le code d'un paiement ne vaut pas pour un autre paiement de la même adresse
setup(); comptes.neuf = { id: 'u-neuf', email: 'neuf@test.fr', created_at: recent, last_sign_in_at: null, a_mot_de_passe: false }
activation('neuf@test.fr'); activation('neuf@test.fr', {}, N2)
await call({ action: 'code', nonce: N }); bon = codeDe('neuf@test.fr')
r = await call({ action: 'connexion', nonce: N2, code: bon })
ok('code du paiement A refusé sur le paiement B (même adresse)', !r.j.token_hash && r.j.error === 'expired', JSON.stringify(r.j))
// plafonds rate_events
setup(); comptes.neuf = { id: 'u-neuf', email: 'neuf@test.fr', created_at: recent, last_sign_in_at: null, a_mot_de_passe: false }
activation('neuf@test.fr')
refuse = (k) => k.startsWith('paiement-code:send:user:')
r = await call({ action: 'code', nonce: N })
ok('plafond d\'envois par compte : 429, rien envoyé', r.status === 429 && r.j.error === 'too_many_codes' && mails.length === 0, JSON.stringify(r.j))
refuse = (k) => k.startsWith('paiement-code:send:ip:')
r = await call({ action: 'code', nonce: N }, '', '203.0.113.7')
ok('plafond d\'envois par IP : 429', r.status === 429 && r.j.error === 'too_many_codes' && mails.length === 0, JSON.stringify(r.j))
ok('clés de plafond sans IP en clair', cles.some((k) => k.startsWith('paiement-code:send:ip:')) && !cles.some((k) => k.includes('203.0.113.7')), JSON.stringify(cles))
refuse = () => false
await call({ action: 'code', nonce: N }); bon = codeDe('neuf@test.fr')
refuse = (k) => k.startsWith('paiement-code:verify:user:')
r = await call({ action: 'connexion', nonce: N, code: bon })
ok('plafond de vérifications : 429, aucun jeton', r.status === 429 && r.j.error === 'too_many_attempts' && !r.j.token_hash, JSON.stringify(r.j))
refuse = () => false
r = await call({ action: 'connexion', nonce: N, code: bon })
ok('le plafond ne brûle pas le code', r.j.token_hash === 'th_neuf@test.fr', JSON.stringify(r.j))
// envoi impossible : aucun code vivant
setup(); comptes.neuf = { id: 'u-neuf', email: 'neuf@test.fr', created_at: recent, last_sign_in_at: null, a_mot_de_passe: false }
activation('neuf@test.fr'); resendKo = true
r = await call({ action: 'code', nonce: N })
ok('Resend en panne : 502, aucun code vivant', r.status === 502 && r.j.error === 'send_failed' && db.rows('paiement_codes').length === 0, JSON.stringify(r.j))

// compte déjà utilisé (connexion passée) : jamais ouvert, aucun code
setup(); comptes.vieux = { id: 'u-vieux', email: 'vieux@test.fr', created_at: vieux, last_sign_in_at: vieux, a_mot_de_passe: true }
activation('vieux@test.fr')
r = await call({ action: 'code', nonce: N })
ok('compte existant : aucun code envoyé', r.j.compte === 'existant' && mails.length === 0, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N, code: '123456' })
ok('compte existant : pas de jeton', r.j.paid === true && r.j.compte === 'existant' && !r.j.token_hash && liens() === 0, JSON.stringify(r.j))
db.tokens['jeton-vieux'] = { id: 'u-vieux', email: 'vieux@test.fr' }
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-vieux')
ok('compte existant : mot de passe refusé', r.status === 403, JSON.stringify(r.j))
// compte récent mais déjà connecté une fois
setup(); comptes.co = { id: 'u-co', email: 'co@test.fr', created_at: recent, last_sign_in_at: recent, a_mot_de_passe: false }
activation('co@test.fr')
r = await call({ action: 'connexion', nonce: N, code: '123456' })
ok('compte récent déjà connecté : pas de jeton', r.j.compte === 'existant' && !r.j.token_hash, JSON.stringify(r.j))
// compte neuf sans verrou (pas passé par la connexion après achat) : mot de passe refusé
db.tokens['jeton-co'] = { id: 'u-neuf', email: 'neuf@test.fr' }
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-co')
ok('mot de passe sans connexion après achat : refusé', r.status === 403, JSON.stringify(r.j))
// acheteur connecté sur la page
setup(); activation('moi@test.fr', { aa_user_id: '11111111-1111-4111-8111-111111111111' })
r = await call({ action: 'connexion', nonce: N, code: '123456' })
ok('acheteur déjà connecté : rien à ouvrir', r.j.compte === 'connecte' && !r.j.token_hash, JSON.stringify(r.j))
r = await call({ action: 'code', nonce: N })
ok('acheteur déjà connecté : aucun code', r.j.compte === 'connecte' && mails.length === 0, JSON.stringify(r.j))
// compte pas encore créé par le webhook
setup(); activation('pasencore@test.fr')
r = await call({ action: 'etat', nonce: N })
ok('compte pas encore créé : attente', r.j.compte === 'attente', JSON.stringify(r.j))
r = await call({ action: 'code', nonce: N })
ok('compte pas encore créé : aucun code', r.j.compte === 'attente' && mails.length === 0, JSON.stringify(r.j))

// reçu (événement payment.succeeded, quelques secondes après l'activation) + état du mot de passe
const paiement = (id: string, total: number, extra: any = {}) => db.rows('webhook_events').push({ event_id: 'msg_' + Math.random(), received_at: new Date().toISOString(), body: { action: 'payment.succeeded', data: { id, total, currency: 'eur', card_last4: '9375', payment_method_type: 'card', paid_at: '2026-10-23T16:36:47.982Z', metadata: { aa_page: 'paiement', aa_nonce: N }, ...extra } } })
setup(); comptes.moi = { id: '11111111-1111-4111-8111-111111111111', email: 'moi@test.fr', created_at: vieux, last_sign_in_at: vieux, a_mot_de_passe: false, fournisseurs: ['email'] }
activation('moi@test.fr', { aa_user_id: comptes.moi.id })
r = await call({ action: 'etat', nonce: N })
ok('reçu pas encore arrivé : n° d\'abonnement seul', r.j.paid && r.j.recu?.commande === 'mem_1' && r.j.recu.total === undefined, JSON.stringify(r.j))
ok('connecté sans mot de passe : mdp=false, google=false', r.j.compte === 'connecte' && r.j.mdp === false && r.j.google === false, JSON.stringify(r.j))
paiement('pay_A', 34.99); paiement('pay_A', 34.99)
r = await call({ action: 'etat', nonce: N })
ok('reçu : commande, carte, total (doublon ignoré)', r.j.recu?.commande === 'pay_A' && r.j.recu.last4 === '9375' && r.j.recu.methode === 'Carte bancaire' && r.j.recu.total === 34.99 && !!r.j.recu.date, JSON.stringify(r.j.recu))
ok('reçu sans sous-total : remise inconnue, devise euro', r.j.recu?.remise === null && r.j.recu.taxes === 0 && r.j.recu.devise === 'eur', JSON.stringify(r.j.recu))
paiement('pay_B', 5, { payment_method_type: 'apple_pay', card_last4: null, payment_method: { card: { last4: '4242' } } })
r = await call({ action: 'etat', nonce: N })
ok('deux paiements distincts : total additionné', r.j.recu?.total === 39.99, JSON.stringify(r.j.recu))
setup(); comptes.g = { id: '22222222-2222-4222-8222-222222222222', email: 'g@test.fr', created_at: vieux, last_sign_in_at: vieux, a_mot_de_passe: false, fournisseurs: ['google'] }
activation('g@test.fr', { aa_user_id: comptes.g.id }); paiement('pay_C', 19.99, { payment_method_type: 'apple_pay' })
r = await call({ action: 'etat', nonce: N })
ok('compte Google : google=true', r.j.google === true && r.j.mdp === false, JSON.stringify(r.j))
ok('Apple Pay reconnu', r.j.recu?.methode === 'Apple Pay', JSON.stringify(r.j.recu))
setup(); comptes.vieux = { id: 'u-vieux', email: 'vieux@test.fr', created_at: vieux, last_sign_in_at: vieux, a_mot_de_passe: true, fournisseurs: ['email'] }
activation('vieux@test.fr')
r = await call({ action: 'etat', nonce: N })
ok('compte existant avec mot de passe : mdp=true', r.j.compte === 'existant' && r.j.mdp === true, JSON.stringify(r.j))
// reçu : remise ET taxe lues sur le paiement réel (constat 48), devise de l'encaissement (constat 32)
setup(); activation('moi@test.fr', { aa_user_id: '11111111-1111-4111-8111-111111111111' })
paiement('pay_D', 47.99, { subtotal: 49.99, tax_amount: 3, promo_code: { code: 'X', amount_off: 0.1, promo_type: 'percentage' } })
r = await call({ action: 'etat', nonce: N })
ok('reçu : remise 5 € ET taxe 3 € séparées (écart total −2 €)', r.j.recu?.remise === 5 && r.j.recu.taxes === 3 && r.j.recu.total === 47.99 && r.j.recu.taxes_incluses === false, JSON.stringify(r.j.recu))
setup(); activation('moi@test.fr', { aa_user_id: '11111111-1111-4111-8111-111111111111' })
paiement('pay_E', 0.7, { subtotal: 69.98, tax_amount: 0 }); paiement('pay_F', 5, { subtotal: 5, tax_amount: 0.83, tax_behavior: 'inclusive' })
r = await call({ action: 'etat', nonce: N })
ok('reçu : deux paiements, remise du 1er seule, taxe incluse signalée', r.j.recu?.remise === 69.28 && r.j.recu.taxes === 0.83 && r.j.recu.taxes_incluses === true && r.j.recu.total === 5.7, JSON.stringify(r.j.recu))
setup(); activation('moi@test.fr', { aa_user_id: '11111111-1111-4111-8111-111111111111' })
paiement('pay_G', 53.2, { currency: 'CHF', subtotal: 53.2, tax_amount: 0 })
r = await call({ action: 'etat', nonce: N })
ok('reçu : devise de l\'encaissement', r.j.recu?.devise === 'chf' && r.j.recu.remise === 0, JSON.stringify(r.j.recu))

// plan du compte connecté (page de paiement, constats 18 et 31)
setup(); db.rows('profiles').push({ id: 'u-pro', email: 'pro@test.fr', plan: 'pro', whop_plan_id: 'plan_g4BVtDmk6hgjQ', whop_cancel_at_period_end: false, credits_remaining: 900 })
db.tokens['jeton-pro'] = { id: 'u-pro', email: 'pro@test.fr' }
r = await call({ action: 'plan' })
ok('plan sans session : 401', r.status === 401, JSON.stringify(r.j))
r = await call({ action: 'plan' }, 'jeton-inconnu')
ok('plan avec un jeton invalide : 401', r.status === 401, JSON.stringify(r.j))
r = await call({ action: 'plan' }, 'jeton-pro')
ok('plan : palier et plan Whop du compte, rien d\'autre', r.j.ok && r.j.plan === 'pro' && r.j.plan_whop === 'plan_g4BVtDmk6hgjQ' && Object.keys(r.j).length === 3 && r.j.credits_remaining === undefined && r.j.email === undefined, JSON.stringify(r.j))
db.tokens['jeton-free'] = { id: 'u-free', email: 'free@test.fr' }
r = await call({ action: 'plan' }, 'jeton-free')
ok('plan d\'un compte sans profil lisible : free', r.j.ok && r.j.plan === 'free' && r.j.plan_whop === null, JSON.stringify(r.j))

// ── Abonnement acheté SANS session (Axel 24/10) : l'adresse est vérifiée avant le module Whop ──
setup()
db.rows('profiles').push({ id: 'u-ab', email: 'Abonne@Test.fr', plan: 'pro', whop_cancel_at_period_end: false },
  { id: 'u-res', email: 'resilie@test.fr', plan: 'pro', whop_cancel_at_period_end: true },
  { id: 'u-fr', email: 'gratuit@test.fr', plan: 'free' }, { id: 'u-joker', email: 'ab_x@test.fr', plan: 'pro' })
r = await call({ action: 'adresse', email: 'abonne@test.fr' })
ok('adresse : abonnement en cours (casse ignorée) → abonne', r.status === 200 && r.j.ok && r.j.abonne === true, JSON.stringify(r.j))
r = await call({ action: 'adresse', email: 'resilie@test.fr' })
ok('adresse : abonnement résilié → pas abonné (il peut repayer)', r.j.ok && r.j.abonne === false, JSON.stringify(r.j))
const rf = await call({ action: 'adresse', email: 'gratuit@test.fr' }), ri = await call({ action: 'adresse', email: 'inconnu@test.fr' })
ok('adresse : compte gratuit et adresse inconnue → même réponse (pas d\'oracle de compte)', JSON.stringify(rf.j) === JSON.stringify(ri.j) && rf.j.abonne === false, JSON.stringify([rf.j, ri.j]))
r = await call({ action: 'adresse', email: 'abxx@test.fr' })
ok('adresse : « _ » n\'est pas un joker (ab_x ne répond pas pour abxx)', r.j.ok && r.j.abonne === false, JSON.stringify(r.j))
r = await call({ action: 'adresse', email: 'pas-une-adresse' })
ok('adresse : adresse invalide → 400', r.status === 400 && r.j.error === 'email', JSON.stringify(r.j))
refuse = (k) => k.startsWith('paiement-adresse:ip:')
r = await call({ action: 'adresse', email: 'abonne@test.fr' }, '', '203.0.113.9')
ok('adresse : plafond par IP → 429', r.status === 429 && r.j.error === 'rate', JSON.stringify(r.j))

const ko = res.filter((x) => !x[1])
keep(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) Deno.exit(1)
