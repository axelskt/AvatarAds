// Rejoue supabase/functions/auth-otp (code réel) sur la base factice : changement d'adresse en DEUX codes (Axel 23/10) —
// 1er code à l'adresse ACTUELLE, 2e à la NOUVELLE, seul le 2e change l'adresse. E-mails Resend interceptés (codes lus).
import { FakeDB } from './fake-supabase.ts'
Deno.env.set('SUPABASE_URL', 'https://test.local'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x'); Deno.env.set('RESEND_API_KEY', 'k')
const keep = console.log
let logs: string[] = []
for (const m of ['log', 'warn', 'error'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))
const mails: { to: string, subject: string }[] = []
const f0 = globalThis.fetch
globalThis.fetch = (async (u: any, o: any) => {
  if (String(u).includes('api.resend.com')) { const b = JSON.parse(o.body); mails.push({ to: b.to[0], subject: b.subject }); return new Response('{"id":"x"}', { status: 200 }) }
  return f0(u, o)
}) as typeof fetch
let db = new FakeDB(); (globalThis as any).__db = db
await import('../../supabase/functions/auth-otp/index.ts')
const handler = (globalThis as any).__handler
const jwt = 'h.' + btoa(JSON.stringify({ role: 'authenticated' })).replace(/=+$/, '') + '.s'
const call = async (body: unknown) => { const r = await handler(new Request('https://x/', { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer ' + jwt } })); return { status: r.status, j: await r.json() } }
const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); if (!c) keep('  ✗ ' + n + ' — ' + d + '\n    ' + logs.slice(-3).join('\n    ')) }
const codeDe = (to: string) => { const m = [...mails].reverse().find((x) => x.to === to); return m ? m.subject.slice(0, 6) : '' }
const setup = (email = 'ancien@test.fr') => {
  db = new FakeDB(); (globalThis as any).__db = db; logs = []; mails.length = 0
  db.tokens[jwt] = { id: 'u1', email }
  db.rpcs.rate_hit = () => true
  db.rpcs.email_change_target_taken = (a: any) => a.p_email === 'pris@test.fr'
  db.rpcs.email_change_take_attempt = (a: any) => { const r = db.rows('email_change_codes').find((x) => x.id === a.p_id && x.user_id === a.p_user && (x.attempts || 0) < a.p_max); if (!r) return null; r.attempts = (r.attempts || 0) + 1; return r.attempts }
}
const N = 'nouveau@test.fr'

setup()
let r = await call({ action: 'email_change_send', new_email: N })
ok('1er code envoyé à l\'adresse ACTUELLE (pas à la nouvelle)', r.status === 200 && r.j.etape === 'ancienne' && mails.length === 1 && mails[0].to === 'ancien@test.fr', JSON.stringify([r.j, mails]))
const c1 = codeDe('ancien@test.fr')
r = await call({ action: 'email_change_verify', new_email: N, code: c1 })
ok('le 1er code ne change PAS l\'adresse directement', r.status === 400 && r.j.error === 'expired' && !db.log.some((l) => l.startsWith('maj ')), JSON.stringify(r.j))
r = await call({ action: 'email_change_verify_old', new_email: N, code: c1 === '111111' ? '222222' : '111111' })
ok('mauvais 1er code refusé', r.status === 400 && r.j.error === 'wrong_code', JSON.stringify(r.j))
r = await call({ action: 'email_change_verify_old', new_email: 'autre@test.fr', code: c1 })
ok('1er code pour une autre adresse refusé', r.j.error === 'expired', JSON.stringify(r.j))
r = await call({ action: 'email_change_verify_old', new_email: N, code: c1 })
ok('1er code juste → 2e code envoyé à la NOUVELLE adresse', r.status === 200 && r.j.etape === 'nouvelle' && mails.at(-1)?.to === N, JSON.stringify([r.j, mails]))
r = await call({ action: 'email_change_verify_old', new_email: N, code: c1 })
ok('1er code à usage unique', r.j.error === 'expired', JSON.stringify(r.j))
const c2 = codeDe(N)
r = await call({ action: 'email_change_verify', new_email: N, code: c1 })
ok('le 1er code ne vaut pas pour la 2e étape', r.j.error === 'wrong_code' || (c1 === c2), JSON.stringify(r.j))
r = await call({ action: 'email_change_send_new', new_email: N })
ok('renvoi du 2e code : délai de 30 s respecté', r.status === 429 && r.j.error === 'cooldown', JSON.stringify(r.j))
r = await call({ action: 'email_change_verify', new_email: N, code: c2 })
ok('2e code juste → adresse changée + avis à l\'ancienne adresse', r.status === 200 && r.j.email === N && db.log.some((l) => l.startsWith('maj u1') && l.includes(N)) && mails.some((m) => m.to === 'ancien@test.fr' && /changée/.test(m.subject)), JSON.stringify([r.j, db.log.slice(-3), mails.map((m) => m.to + ' ' + m.subject)]))

setup()
r = await call({ action: 'email_change_send_new', new_email: N })
ok('2e code impossible sans la preuve de l\'adresse actuelle', r.status === 400 && r.j.error === 'expired' && mails.length === 0, JSON.stringify(r.j))
r = await call({ action: 'email_change_send', new_email: 'pris@test.fr' })
ok('adresse déjà prise refusée avant tout envoi', r.status === 409 && mails.length === 0, JSON.stringify(r.j))
// 1er code juste mais adresse prise entre-temps
setup()
await call({ action: 'email_change_send', new_email: N })
db.rpcs.email_change_target_taken = () => true
r = await call({ action: 'email_change_verify_old', new_email: N, code: codeDe('ancien@test.fr') })
ok('adresse prise entre-temps : pas de 2e code', r.status === 409 && !mails.some((m) => m.to === N), JSON.stringify(r.j))
// 5 essais faux brûlent le code
setup()
await call({ action: 'email_change_send', new_email: N })
const bon = codeDe('ancien@test.fr'), faux = bon === '123456' ? '654321' : '123456'
for (let i = 0; i < 5; i++) r = await call({ action: 'email_change_verify_old', new_email: N, code: faux })
r = await call({ action: 'email_change_verify_old', new_email: N, code: bon })
ok('après 5 essais faux, le bon code ne passe plus', r.j.error === 'expired' || r.j.error === 'too_many_attempts', JSON.stringify(r.j))
// sans session
r = await (async () => { const x = await handler(new Request('https://x/', { method: 'POST', body: JSON.stringify({ action: 'email_change_send', new_email: N }) })); return { status: x.status } })()
ok('sans session : 401', r.status === 401)

const ko = res.filter((x) => !x[1])
keep(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) Deno.exit(1)
