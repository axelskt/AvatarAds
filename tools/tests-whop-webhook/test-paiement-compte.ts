// Rejoue supabase/functions/paiement-compte (code réel) sur la base factice : connexion après achat réservée aux comptes neufs.
import { FakeDB } from './fake-supabase.ts'
Deno.env.set('SUPABASE_URL', 'https://test.local'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x')
let logs: string[] = []
const keep = console.log
for (const m of ['log', 'warn', 'error'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))
let db = new FakeDB(); (globalThis as any).__db = db
await import('../../supabase/functions/paiement-compte/index.ts')
const handler = (globalThis as any).__handler
const call = async (body: unknown, auth = '') => { const r = await handler(new Request('https://x/', { method: 'POST', body: JSON.stringify(body), headers: auth ? { authorization: 'Bearer ' + auth } : {} })); return { status: r.status, j: await r.json() } }
const N = 'a1b2c3d4-e5f6-4789-abcd-0123456789ab'
const recent = new Date().toISOString(), vieux = new Date(Date.now() - 3 * 86400_000).toISOString()
// état des comptes vu par la fonction SQL paiement_compte_etat
const comptes: Record<string, any> = {}
const setup = () => {
  db = new FakeDB(); (globalThis as any).__db = db; logs = []
  db.rpcs.paiement_compte_etat = (a: any) => { const u = Object.values(comptes).find((c: any) => (a.p_user && c.id === a.p_user) || (!a.p_user && c.email === a.p_email)); return u ? [{ ...u, a_mot_de_passe: !!(u.a_mot_de_passe || db.mdp[u.id]) }] : [] }
}
const activation = (email: string, meta: any = {}) => db.rows('webhook_events').push({ event_id: 'msg_' + Math.random(), received_at: new Date().toISOString(), body: { action: 'membership.activated', data: { id: 'mem_1', plan: { id: 'plan_x' }, user: { email }, metadata: { aa_page: 'paiement', aa_nonce: N, ...meta } } } })
const res: [string, boolean, string][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c, d]); if (!c) keep('  ✗ ' + n + ' — ' + d + '\n    ' + logs.slice(-4).join('\n    ')) }

setup(); comptes.neuf = { id: 'u-neuf', email: 'neuf@test.fr', created_at: recent, last_sign_in_at: null, a_mot_de_passe: false }
let r = await call({ action: 'etat', nonce: N })
ok('avant le webhook : pas payé', r.j.paid === false, JSON.stringify(r.j))
activation('neuf@test.fr')
r = await call({ action: 'etat', nonce: N })
ok('après activation : compte neuf', r.j.paid === true && r.j.compte === 'nouveau' && !r.j.token_hash, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N })
ok('connexion : jeton remis', r.j.compte === 'nouveau' && r.j.token_hash === 'th_neuf@test.fr', JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: N })
ok('2e connexion avec le même paiement : refusée', r.j.compte === 'existant' && !r.j.token_hash, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: 'ffffffff-ffff-4fff-bfff-ffffffffffff' })
ok('autre identifiant : rien', r.j.paid === false && !r.j.token_hash, JSON.stringify(r.j))
r = await call({ action: 'connexion', nonce: 'pas-un-uuid' })
ok('identifiant mal formé : 400', r.status === 400, JSON.stringify(r.j))
// mot de passe
db.tokens['jeton-neuf'] = { id: 'u-neuf', email: 'neuf@test.fr' }
r = await call({ action: 'mot_de_passe', password: 'court' }, 'jeton-neuf')
ok('mot de passe trop court : refusé', r.status === 400 && r.j.error === 'weak_password', JSON.stringify(r.j))
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-neuf')
ok('1er mot de passe posé', r.j.ok === true && db.mdp['u-neuf'] === true && db.rows('password_change_grants').length === 0, JSON.stringify(r.j))
r = await call({ action: 'mot_de_passe', password: 'unAutreMotDePasse9' }, 'jeton-neuf')
ok('2e mot de passe par ce chemin : refusé', r.status === 403, JSON.stringify(r.j))
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-inconnu')
ok('sans session : 401', r.status === 401, JSON.stringify(r.j))

// compte déjà utilisé (connexion passée) : jamais ouvert
setup(); comptes.vieux = { id: 'u-vieux', email: 'vieux@test.fr', created_at: vieux, last_sign_in_at: vieux, a_mot_de_passe: true }
activation('vieux@test.fr')
r = await call({ action: 'connexion', nonce: N })
ok('compte existant : pas de jeton', r.j.paid === true && r.j.compte === 'existant' && !r.j.token_hash && !db.log.some((l) => l.startsWith('lien')), JSON.stringify(r.j))
db.tokens['jeton-vieux'] = { id: 'u-vieux', email: 'vieux@test.fr' }
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-vieux')
ok('compte existant : mot de passe refusé', r.status === 403, JSON.stringify(r.j))
// compte récent mais déjà connecté une fois
setup(); comptes.co = { id: 'u-co', email: 'co@test.fr', created_at: recent, last_sign_in_at: recent, a_mot_de_passe: false }
activation('co@test.fr')
r = await call({ action: 'connexion', nonce: N })
ok('compte récent déjà connecté : pas de jeton', r.j.compte === 'existant' && !r.j.token_hash, JSON.stringify(r.j))
// compte neuf sans verrou (pas passé par la connexion après achat) : mot de passe refusé
db.tokens['jeton-co'] = { id: 'u-neuf', email: 'neuf@test.fr' }
r = await call({ action: 'mot_de_passe', password: 'unBonMotDePasse9' }, 'jeton-co')
ok('mot de passe sans connexion après achat : refusé', r.status === 403, JSON.stringify(r.j))
// acheteur connecté sur la page
setup(); activation('moi@test.fr', { aa_user_id: '11111111-1111-4111-8111-111111111111' })
r = await call({ action: 'connexion', nonce: N })
ok('acheteur déjà connecté : rien à ouvrir', r.j.compte === 'connecte' && !r.j.token_hash, JSON.stringify(r.j))
// compte pas encore créé par le webhook
setup(); activation('pasencore@test.fr')
r = await call({ action: 'etat', nonce: N })
ok('compte pas encore créé : attente', r.j.compte === 'attente', JSON.stringify(r.j))

const ko = res.filter((x) => !x[1])
keep(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) Deno.exit(1)
