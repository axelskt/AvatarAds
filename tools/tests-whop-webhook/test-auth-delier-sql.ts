// Rejoue la migration 20261024040000_email_change_delier_google.sql (audit 23/10, constat n° 26) sur un VRAI Postgres en
// mémoire (PGlite, Postgres 16), avec les tables d'auth réduites aux colonnes en ligne (auth.identities relue au catalogue le
// 23/10 : colonne email GÉNÉRÉE, unicité (provider_id, provider)). L'état « juste après auth.admin.updateUserById(email) »
// est reproduit comme GoTrue v2.194 le laisse (admin.go : identité « email » créée ou mise à jour à la nouvelle adresse).
//   cd tools/tests-whop-webhook && deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-auth-delier-sql.ts
// (--node-modules-dir=none : un package.json plus haut dans l'arborescence fait sinon chercher PGlite dans node_modules.)
// (1er lancement : télécharge PGlite depuis npm, déjà en cache s'il a servi à test-credits-sql.ts.)
import { PGlite } from 'npm:@electric-sql/pglite@0.2.17'

const BASE = String.raw`
create role anon; create role authenticated; create role service_role;
-- comme Supabase : toute nouvelle fonction est d'abord exécutable par anon / authenticated / service_role
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb, created_at timestamptz default now());
create table auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade, identity_data jsonb not null,
  provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data->>'email')) stored, id uuid primary key default gen_random_uuid());
create unique index identities_provider_id_provider_unique on auth.identities (provider_id, provider);
-- journal du 04/10 (20261004050000), colonnes en ligne au 23/10
create table public.email_change_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  old_email text not null, new_email text not null, changed_at timestamptz not null default now(), revert_hash text unique,
  revert_expires_at timestamptz not null, password_changed_at timestamptz, reverted_at timestamptz, voided_at timestamptz);
`
const MIG = await Deno.readTextFile(new URL('../../supabase/migrations/20261024040000_email_change_delier_google.sql', import.meta.url))
const db = new PGlite()
await db.exec(BASE)
await db.exec(MIG)
await db.exec(MIG)   // rejouable

const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); if (!c) console.log('  ✗ ' + n + ' — ' + d) }
const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as any[]
const U = '00000000-0000-4000-8000-000000000001'
const AVANT = '2026-09-01T10:00:00Z', MAINTENANT = new Date().toISOString()

// compte Google seul (cas de 144 comptes sur 146), adresse A ; puis état laissé par updateUserById(B) : users.email = B et
// identité « email » neuve à B. raw_app_meta_data tel que GoTrue l'avait écrit à l'inscription Google.
async function compte(o: { google?: string[]; email?: string; nouvelle?: string; identiteEmail?: boolean; mdp?: boolean } = {}) {
  await db.exec('delete from public.email_change_events; delete from auth.identities; delete from auth.users')
  const google = o.google ?? ['ancien@gmail.com'], nouvelle = o.nouvelle ?? 'nouveau@test.fr'
  await q(`insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)`,
    [U, o.email ?? nouvelle, JSON.stringify({ provider: google.length ? 'google' : 'email', providers: google.length ? ['google'] : ['email'], aa_origine: 'x' })])
  let i = 0
  for (const g of google) await q(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values ($1, $2, $3, 'google', $4, $4)`, ['sub-' + (++i), U, JSON.stringify({ email: g, email_verified: true, sub: 'sub-' + i, name: 'Client' }), AVANT])
  if (o.identiteEmail !== false) await q(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values ($1, $2, $3, 'email', $4, $4)`, [U, U, JSON.stringify({ email: nouvelle, email_verified: true, sub: U }), MAINTENANT])
  const ev = await q(`insert into public.email_change_events (user_id, old_email, new_email, revert_expires_at) values ($1, $2, $3, now() + interval '72 hours') returning id`,
    [U, google[0] || 'ancien@test.fr', nouvelle])
  return ev[0].id as string
}
const delier = async (ev: string | null, nouvelle = 'nouveau@test.fr') =>
  (await q(`select public.email_change_delier_identites($1, $2, $3) as r`, [U, ev, nouvelle]))[0].r
const identites = () => q(`select provider, email from auth.identities where user_id = $1 order by created_at`, [U])
const meta = async () => (await q(`select raw_app_meta_data m from auth.users where id = $1`, [U]))[0].m

// 1) cas principal : compte Google seul qui passe de A (Gmail) à B
let ev = await compte()
let r = await delier(ev)
let ids = await identites(), m = await meta()
ok('compte Google seul : identité Google de l\'ancienne adresse retirée, identité « email » de la nouvelle gardée',
  r.ok === true && r.retirees === 1 && JSON.stringify(r.fournisseurs) === '["google"]' && ids.length === 1 && ids[0].provider === 'email' && ids[0].email === 'nouveau@test.fr', JSON.stringify([r, ids]))
ok('app_metadata recalculé comme GoTrue (providers = [email], provider = email), le reste gardé',
  JSON.stringify(m.providers) === '["email"]' && m.provider === 'email' && m.aa_origine === 'x', JSON.stringify(m))
ok('journal du changement : fournisseurs retirés notés (sans donnée d\'identité)',
  JSON.stringify((await q(`select identites_retirees from public.email_change_events where id = $1`, [ev]))[0].identites_retirees) === '["google"]')
ok('plus aucune identité du compte ne porte l\'ancienne adresse (GoTrue ne relie plus Google A à ce compte)',
  (await q(`select count(*)::int n from auth.identities where email = 'ancien@gmail.com'`))[0].n === 0)
r = await delier(ev)
ok('2e appel : rien de plus à retirer, aucune erreur', r.ok === true && r.retirees === 0 && (await identites()).length === 1, JSON.stringify(r))

// 2) garde-fous : jamais un compte sans moyen de connexion, jamais avant le changement côté Auth
ev = await compte({ identiteEmail: false })
r = await delier(ev)
ok('pas d\'identité « email » à la nouvelle adresse → refus, rien retiré', r.ok === false && r.error === 'identite_email_absente' && (await identites()).length === 1, JSON.stringify(r))
ev = await compte({ email: 'ancien@gmail.com' })
r = await delier(ev)
ok('adresse pas encore changée côté Auth → refus, rien retiré', r.ok === false && r.error === 'adresse_non_changee' && (await identites()).length === 2, JSON.stringify(r))
r = await delier(ev, '  ')
ok('nouvelle adresse vide → refus', r.ok === false && r.error === 'bad_args', JSON.stringify(r))

// 3) ce qui doit rester
ev = await compte({ google: ['Ancien@Gmail.com', 'nouveau@test.fr'] })
r = await delier(ev, 'NOUVEAU@test.fr ')
ids = await identites(); m = await meta()
ok('Google déjà lié à la NOUVELLE adresse gardé ; casse et espaces ignorés', r.ok === true && r.retirees === 1 && ids.length === 2 && ids.some((x) => x.provider === 'google' && x.email === 'nouveau@test.fr'), JSON.stringify([r, ids]))
ok('app_metadata : fournisseurs restants par ancienneté (google d\'abord)', JSON.stringify(m.providers) === '["google","email"]' && m.provider === 'google', JSON.stringify(m))
ev = await compte({ google: [] })
const avant = JSON.stringify(await meta())
r = await delier(ev)
ok('compte e-mail sans Google : rien retiré, app_metadata intact', r.ok === true && r.retirees === 0 && JSON.stringify(await meta()) === avant, JSON.stringify(r))
r = await delier(null)
ok('journal absent (p_event nul) : le déliage se fait quand même', r.ok === true)

// 4) droits : service_role seul
const droit = async (role: string) => (await q(`select has_function_privilege($1, 'public.email_change_delier_identites(uuid, uuid, text)', 'execute') d`, [role]))[0].d
const acl = String((await q(`select proacl::text a from pg_proc where proname = 'email_change_delier_identites'`))[0].a)
ok('EXECUTE : service_role oui ; anon, authenticated, public non', await droit('service_role') && !(await droit('anon')) && !(await droit('authenticated'))
  && !/[{,]=X\//.test(acl), acl)
ok('SECURITY DEFINER, search_path vide', (await q(`select prosecdef s, proconfig c from pg_proc where proname = 'email_change_delier_identites'`)).every((x) => x.s === true && String(x.c) === 'search_path=""'))

const ko = res.filter((x) => !x[1])
console.log(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) Deno.exit(1)
