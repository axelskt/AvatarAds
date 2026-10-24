// Rejoue supabase/functions/auth-otp (code réel) sur la base factice : connexion par code, audit 23/10 constat n° 40 —
// plafond CUMULÉ de codes faux par couple (adresse, IP) (30 / 24 h) qui bloque l'appareil fautif et prévient le titulaire
// une seule fois ; seul le DERNIER code envoyé vaut (un code plus ancien ne redevient jamais valable). Le parcours honnête
// ne change pas. rate_hit simulé pour de vrai (fenêtre + maximum, comme la migration 20261009130000), e-mails interceptés.
import { FakeDB } from './fake-supabase.ts'
Deno.env.set('SUPABASE_URL', 'https://test.local'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x'); Deno.env.set('RESEND_API_KEY', 'k')
const keep = console.log
let logs: string[] = []
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
// UNE seule base factice pour tout le banc : rateHit (guard.ts) garde le 1er client créé ; on la vide entre les scénarios
const db = new FakeDB(); (globalThis as any).__db = db
db.rpcs.rate_hit = (a: any) => {
  const depuis = Date.now() - a.p_window_s * 1000
  const n = db.rows('rate_events').filter((r) => r.key === a.p_key && Date.parse(r.created_at) > depuis).length
  if (n >= a.p_max) return false
  db.rows('rate_events').push({ id: crypto.randomUUID(), key: a.p_key, created_at: new Date().toISOString() }); return true
}
db.rpcs.otp_take_attempt = (a: any) => { const r = db.rows('otp_codes').find((x) => x.id === a.p_id && (x.attempts || 0) < a.p_max); if (!r) return null; r.attempts = (r.attempts || 0) + 1; return r.attempts }
await import('../../supabase/functions/auth-otp/index.ts')
const handler = (globalThis as any).__handler
const call = async (body: unknown, ip = '198.51.100.1') => {
  const r = await handler(new Request('https://x/', { method: 'POST', body: JSON.stringify(body), headers: { 'x-real-ip': ip } })); return { status: r.status, j: await r.json() } }
const envoyer = (email: string, ip?: string) => call({ action: 'send', email, mode: 'login' }, ip)
const verifier = (email: string, code: string, ip?: string) => call({ action: 'verify', email, code }, ip)
const reset = () => { for (const k of Object.keys(db.t)) delete db.t[k]; db.log.length = 0; mails.length = 0; logs = []; resendKo = false }
const codeDe = (to: string) => { const m = [...mails].reverse().find((x) => x.to === to && /ton code AvatarAds/.test(x.subject)); return m ? m.subject.slice(0, 6) : '' }
const faux = (...vrais: string[]) => { for (const c of ['111111', '222222', '333333']) if (!vrais.includes(c)) return c; return '444444' }
const vieillir = () => { for (const r of db.rows('otp_codes')) r.created_at = new Date(Date.parse(r.created_at) - 40_000).toISOString() }   // délai de 30 s écoulé
// 11 min écoulées pour les plafonds de VÉRIFICATION et d'envoi à l'heure (12 vérifications / 10 min par couple adresse + IP) :
// un appareil seul met ~25 min à taper 30 codes faux. Les échecs (otp:echec:…) gardent leur heure : fenêtre de 24 h.
const passer11min = () => { for (const x of db.rows('rate_events')) if (!String(x.key).startsWith('otp:echec:')) x.created_at = new Date(Date.parse(x.created_at) - 11 * 60_000).toISOString() }
const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); if (!c) keep('  ✗ ' + n + ' — ' + d + '\n    ' + logs.slice(-3).join('\n    ')) }
const E = 'client@test.fr'
let r: { status: number, j: any }

// ── Parcours honnête inchangé ──
reset()
r = await envoyer(E)
ok('honnête : code envoyé', r.status === 200 && r.j.ok === true && mails.length === 1 && mails[0].to === E, JSON.stringify(r.j))
r = await verifier(E, faux(codeDe(E)))
ok('honnête : une faute de frappe → « code faux », 4 essais restants', r.status === 400 && r.j.error === 'wrong_code' && r.j.remaining === 4, JSON.stringify(r.j))
r = await verifier(E, codeDe(E))
ok('honnête : code juste → session (compte créé)', r.status === 200 && !!r.j.token_hash && r.j.created === true, JSON.stringify(r.j))
r = await verifier(E, codeDe(E))
ok('honnête : un code ne sert qu\'une fois', r.status === 400 && r.j.error === 'expired', JSON.stringify(r.j))

// ── Seul le DERNIER code envoyé vaut ──
reset()
await envoyer(E); const a1 = codeDe(E); vieillir()
await envoyer(E); const b1 = codeDe(E)
r = await verifier(E, b1)
ok('2 codes demandés : le 2e connecte', r.status === 200 && !!r.j.token_hash, JSON.stringify(r.j))
r = await verifier(E, a1)
ok('connexion faite avec le 2e code → le 1er (moins de 10 min) ne connecte plus', a1 === b1 || (r.status === 400 && r.j.error === 'expired'), JSON.stringify(r.j))
reset()
await envoyer(E); const a2 = codeDe(E); vieillir()
await envoyer(E); const b2 = codeDe(E)
for (let i = 0; i < 5; i++) r = await verifier(E, faux(a2, b2))
ok('2e code brûlé par 5 essais faux', r.status === 400 && r.j.error === 'too_many_attempts', JSON.stringify(r.j))
r = await verifier(E, a2)
ok('2e code brûlé → le 1er ne redevient PAS valable', r.status === 400 && r.j.error === 'expired', JSON.stringify(r.j))
reset()
await envoyer(E); const a3 = codeDe(E); vieillir()
resendKo = true
r = await envoyer(E)
resendKo = false
ok('envoi du 2e code raté (502)', r.status === 502 && r.j.error === 'send_failed', JSON.stringify(r.j))
r = await verifier(E, a3)
ok('envoi raté → le code déjà reçu reste valable', r.status === 200 && !!r.j.token_hash, JSON.stringify(r.j))

// ── Plafond cumulé : 30 codes faux en 24 h par COUPLE (adresse, IP) — relecture du 24/10 : seul l'appareil fautif est
//    bloqué, jamais le titulaire (la 1re version suspendait l'adresse pour tout le monde) ──
reset()
const CIBLE = 'cible@test.fr', IP_A = '198.51.100.10'
let dernier = '', reponses: { status: number, j: any }[] = []
for (let k = 0; k < 6; k++) {
  vieillir(); passer11min()
  r = await envoyer(CIBLE, `203.0.113.${k + 1}`)
  if (r.status !== 200) { reponses.push(r); break }
  dernier = codeDe(CIBLE)
  const essais = k < 5 ? 5 : 4   // 5 codes × 5 essais + 4 sur le 6e = 29 échecs, tous depuis IP_A
  for (let i = 0; i < essais; i++) reponses.push(await verifier(CIBLE, faux(dernier), IP_A))
}
const avis = () => mails.filter((m) => m.to === CIBLE && /Codes faux/.test(m.subject))
passer11min()
ok('29 codes faux depuis un appareil : réponses habituelles, rien de bloqué', reponses.length === 29 && reponses.every((x) => x.status === 400 && ['wrong_code', 'too_many_attempts'].includes(x.j.error)) && reponses.at(-1)?.j.remaining === 1 && !avis().length, JSON.stringify(reponses.slice(-3)))
r = await verifier(CIBLE, faux(dernier), IP_A)
ok('30e code faux → CET appareil bloqué (429) + avis au titulaire', r.status === 429 && r.j.error === 'too_many_attempts' && avis().length === 1 && /24 heures/.test(avis()[0].html) && /toujours te connecter/.test(avis()[0].html), JSON.stringify([r.j, mails.map((m) => m.subject)]))
const nbMails = mails.length
vieillir()
r = await envoyer(CIBLE, IP_A)
ok('appareil bloqué : il ne peut plus demander de code pour l\'adresse', r.status === 429 && r.j.error === 'too_many_codes' && mails.length === nbMails, JSON.stringify(r.j))
r = await verifier(CIBLE, faux(dernier), IP_A)
ok('appareil bloqué : un essai de plus ne renvoie pas d\'avis (un seul par 24 h)', r.status === 429 && avis().length === 1, JSON.stringify([r.j, avis().length]))
vieillir()
r = await envoyer(CIBLE, '203.0.113.50')
const duTitulaire = codeDe(CIBLE)
const rT = await verifier(CIBLE, duTitulaire, '203.0.113.50')
ok('le titulaire, sur son appareil, reçoit un code et se connecte (pas de blocage pour tout le monde)', r.status === 200 && rT.status === 200 && !!rT.j.token_hash, JSON.stringify([r.j, rT.j]))
vieillir()
r = await envoyer(CIBLE, '203.0.113.51')
const rA = await verifier(CIBLE, codeDe(CIBLE), IP_A)
ok('appareil bloqué : même un bon code est refusé depuis lui', rA.status === 429 && rA.j.error === 'too_many_attempts', JSON.stringify([r.j, rA.j]))
r = await envoyer('autre@test.fr', '203.0.113.60')
const autre = codeDe('autre@test.fr')
const r2 = await verifier('autre@test.fr', autre, IP_A)
ok('une autre adresse n\'est pas touchée (même depuis l\'appareil bloqué)', r.status === 200 && r2.status === 200 && !!r2.j.token_hash, JSON.stringify([r.j, r2.j]))
// 24 h plus tard : les échecs sortent de la fenêtre
for (const x of db.rows('rate_events')) x.created_at = new Date(Date.parse(x.created_at) - 25 * 3600_000).toISOString()
vieillir()
r = await envoyer(CIBLE, IP_A)
const r3 = await verifier(CIBLE, codeDe(CIBLE), IP_A)
ok('24 h plus tard : l\'appareil peut de nouveau se connecter par code', r.status === 200 && r3.status === 200 && !!r3.j.token_hash, JSON.stringify([r.j, r3.j]))

// ── Pas d'oracle : même réponse qu'il y ait un compte ou non ──
reset()
db.rows('profiles').push({ id: 'u-existant', email: 'existant@test.fr', plan: 'free' })
const avec = await envoyer('existant@test.fr', '203.0.113.80'), sans = await envoyer('inconnu@test.fr', '203.0.113.81')
ok('envoi : réponse identique avec ou sans compte', avec.status === sans.status && JSON.stringify(avec.j) === JSON.stringify(sans.j), JSON.stringify([avec, sans]))

const ko = res.filter((x) => !x[1])
keep(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) Deno.exit(1)
