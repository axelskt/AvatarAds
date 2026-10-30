// Banc SQL des failles 3 et 4 (audit Décupleur du 30/10) : rejoue la migration 20261030140000_decupleur_file_atomique.sql sur
// un VRAI Postgres en mémoire (PGlite, Postgres 16), avec la table render_jobs telle qu'elle est EN LIGNE le 30/10 (colonnes lues
// en lecture seule par information_schema) et le déclencheur « Rendu prioritaire » (migration 20261023200000).
// Aucune base en ligne touchée.
//   cd tools/tests-decupleur && deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille34-sql.ts
// (PGlite déjà en cache : aucun téléchargement.) PGlite n'a qu'UNE connexion : les appels « simultanés » y passent l'un après
// l'autre. Le banc montre donc (A) le défaut de l'ancien schéma « comptage PUIS insertion » (deux requêtes : toutes les
// lectures avant la 1re insertion, ce qui arrive en vrai avec 30 requêtes simultanées) et (B) que la fonction fait comptage et
// insertion dans UNE transaction sous pg_advisory_xact_lock par compte — la garantie en concurrence réelle est celle du verrou
// de Postgres. Le banc test-faille4-rafale.ts rejoue, lui, le code réel de render-job en rafale.
import { PGlite } from 'npm:@electric-sql/pglite@0.2.17'

const ICI = new URL('.', import.meta.url).pathname
const MIGR = Deno.args[0] || ICI + '../../supabase/migrations/20261030140000_decupleur_file_atomique.sql'
const PRIO = ICI + '../../supabase/migrations/20261023200000_rendu_prioritaire.sql'

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create table public.profiles (id uuid primary key, plan text default 'free', is_owner boolean default false);
create table public.render_jobs (
  id uuid default gen_random_uuid() not null primary key, user_id uuid not null, status text default 'queued' not null,
  plan jsonb not null, input_video text not null, assets jsonb default '[]'::jsonb, output_url text, error text,
  credits_cost integer default 2, attempts integer default 0, created_at timestamptz default now(), updated_at timestamptz default now(),
  avatar_clips jsonb default '[]'::jsonb not null, trace jsonb, prioritaire boolean default false not null, progress smallint);
create index render_jobs_status_idx on public.render_jobs (status, created_at);
create index render_jobs_user_idx on public.render_jobs (user_id, created_at desc);
`
const U1 = '11111111-2222-4333-8444-555555555555', U2 = '22222222-2222-4333-8444-555555555555', U3 = '33333333-2222-4333-8444-555555555555'
let nOk = 0, nKo = 0
const ok = (nom: string, c: boolean, d = '') => { if (c) nOk++; else nKo++; console.log(`${c ? '  ✓' : '  ✗'} ${nom}${c || !d ? '' : '  → ' + d}`) }

const db = new PGlite()
await db.exec(SCHEMA)
await db.exec(Deno.readTextFileSync(PRIO))
await db.exec(`alter table public.profiles add column if not exists rendu_prioritaire boolean not null default false`)
await db.exec(`insert into public.profiles (id, plan, rendu_prioritaire) values ('${U1}', 'pro', false), ('${U2}', 'starter', false), ('${U3}', 'elite', true)`)
const sql = Deno.readTextFileSync(MIGR)
await db.exec(sql)
await db.exec(sql)   // rejouable (create or replace)
const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Record<string, any>[]
const vider = () => db.exec('delete from public.render_jobs')
const plan = (c: string) => JSON.stringify(c === 'dc-fetch' ? { __compose: c, lien: 'https://www.tiktok.com/@a/video/1', duration: 1 } : c === 'mc-ref' ? { __compose: c, maxDur: 30 } : { __compose: c, a: 0, b: 5, duration: 5 })
const creer = async (u: string, c: string, extra = '') =>
  (await q(`select public.render_job_dc_creer($1::uuid, $2::jsonb, $3, '[]'::jsonb${extra}) as r`, [u, plan(c), `${u}/dc-lien-${Math.random()}.mp4`]))[0].r as { ok: boolean; id?: string; raison?: string }
const nb = async (u: string, c?: string) => Number((await q(`select count(*)::int n from public.render_jobs where user_id = $1 ${c ? `and plan->>'__compose' = '${c}'` : ''}`, [u]))[0].n)

console.log('A. AVANT : comptage puis insertion en deux requêtes (render-job jusqu’au 30/10), 30 requêtes simultanées')
{
  await vider()
  const DC = `('dc-fetch','dc-cut','decupleur')`
  // les 30 comptages arrivent avant la 1re insertion (requêtes simultanées)
  const comptes = await Promise.all(Array.from({ length: 30 }, () => q(`select count(*)::int n from public.render_jobs where user_id = $1 and status in ('queued','rendering') and plan->>'__compose' in ${DC} and updated_at >= now() - interval '45 minutes'`, [U1])))
  for (const c of comptes) if (Number(c[0].n) < 3) await q(`insert into public.render_jobs (user_id, status, plan, input_video) values ($1, 'queued', $2::jsonb, $3)`, [U1, plan('dc-fetch'), `${U1}/x.mp4`])
  const n = await nb(U1)
  console.log(`     → ${n} jobs créés pour un plafond de 3`)
  ok('(constat) l’ancien schéma dépasse le plafond en rafale', n === 30, String(n))
}

console.log('B. APRÈS : render_job_dc_creer, 30 appels « simultanés »')
{
  await vider()
  const rs = await Promise.all(Array.from({ length: 30 }, () => creer(U1, 'dc-fetch')))
  ok(`dc-fetch : 1 seul créé (1 en cours par compte) — ${await nb(U1)} créé(s)`, (await nb(U1)) === 1)
  ok('les 29 autres : refus « fetch_en_cours »', rs.filter((r) => !r.ok).length === 29 && rs.filter((r) => !r.ok).every((r) => r.raison === 'fetch_en_cours'), JSON.stringify(rs.slice(0, 3)))
  await vider()
  const rc = await Promise.all(Array.from({ length: 30 }, () => creer(U1, 'dc-cut')))
  ok(`dc-cut : 1 seul créé (relecture 30/10 : 1 travail gratuit court par compte) — ${await nb(U1)}`, (await nb(U1)) === 1)
  ok('les 29 autres : refus « court_en_cours »', rc.filter((r) => !r.ok).length === 29 && rc.filter((r) => !r.ok).every((r) => r.raison === 'court_en_cours'), JSON.stringify(rc.slice(0, 2)))
  await vider()
  await Promise.all([...Array.from({ length: 10 }, () => creer(U1, 'decupleur')), ...Array.from({ length: 10 }, () => creer(U2, 'decupleur'))])
  ok('deux comptes : 3 lots chacun, indépendants', (await nb(U1)) === 3 && (await nb(U2)) === 3, `${await nb(U1)} / ${await nb(U2)}`)
}

console.log('B2. Relecture 30/10 : préparations du MCP (mc-ref, dc-fetch) par la même fonction')
{
  await vider()
  const MCP = `, 2, 1, 6, 600, array['mc-ref','dc-fetch','decupleur']::text[]`
  const OMNI = `, 2, 1, 6, 600, array['mc-ref']::text[]`
  const rs = await Promise.all(Array.from({ length: 30 }, () => creer(U1, 'mc-ref', OMNI)))
  ok(`30 /start Omni simultanés : 1 mc-ref créé — ${await nb(U1, 'mc-ref')}`, (await nb(U1, 'mc-ref')) === 1 && rs.filter((r) => r.ok).length === 1, JSON.stringify(rs.slice(0, 2)))
  await vider()
  await Promise.all(Array.from({ length: 30 }, () => creer(U1, 'dc-fetch', MCP)))
  ok(`30 /start Décupleur (lien) simultanés : 1 dc-fetch — ${await nb(U1, 'dc-fetch')}`, (await nb(U1, 'dc-fetch')) === 1)
  await vider()
  for (let i = 0; i < 6; i++) { await creer(U1, 'dc-fetch', MCP); await q(`update public.render_jobs set status = 'done'`) }
  const r7 = await creer(U1, 'dc-fetch', MCP)
  ok('MCP : 7e lien en 10 min refusé « quota » (compté avec ceux de l’app)', !r7.ok && r7.raison === 'quota', JSON.stringify(r7))
  await vider()
  await creer(U1, 'dc-fetch')   // récupération lancée depuis l'app
  const m = await creer(U1, 'mc-ref', OMNI)
  ok('récupération de l’app en cours : préparation MCP du même compte refusée « court_en_cours »', !m.ok && m.raison === 'court_en_cours', JSON.stringify(m))
  ok('… un autre compte passe', (await creer(U2, 'mc-ref', OMNI)).ok)
  await q(`update public.render_jobs set status = 'done'`)
  ok('récupération terminée : la préparation (suite du parcours) passe', (await creer(U1, 'mc-ref', OMNI)).ok)
  await vider()
  // lot de variantes en cours : ni la découpe ni la préparation ne sont bloquées par la règle des travaux courts
  await creer(U1, 'decupleur')
  ok('lot de variantes en cours : la découpe passe (un lot n’est pas un travail court)', (await creer(U1, 'dc-cut')).ok)
  await vider()
  for (let i = 0; i < 10; i++) { await creer(U1, 'dc-cut'); await q(`update public.render_jobs set status = 'done'`) }
  const c11 = await creer(U1, 'dc-cut')
  ok('11e découpe en 10 min : refus « quota » (10 par défaut)', !c11.ok && c11.raison === 'quota', JSON.stringify(c11))
  ok('quota de découpes null (owner / developer) : passe', (await creer(U1, 'dc-cut', ', 3, 1, null, 600, null, 1, null')).ok)
  let err = ''
  try { await creer(U1, 'mc-ref', `, 2, 1, 6, 600, array['gen-subs']::text[]`) } catch (e) { err = String((e as Error).message) }
  ok('p_compte hors Décupleur / préparations : refusé', /invalide/.test(err), err)
}

console.log('C. Règles')
{
  await vider()
  const r1 = await creer(U1, 'dc-fetch')
  ok('job créé : en file, plan, entrée, assets [] et avatar_clips [] (comme l’insertion d’avant)', r1.ok && !!r1.id)
  const row = (await q(`select * from public.render_jobs where id = $1`, [r1.id]))[0]
  ok('colonnes', row.status === 'queued' && row.plan.__compose === 'dc-fetch' && Array.isArray(row.assets) && row.assets.length === 0 && Array.isArray(row.avatar_clips) && row.attempts === 0, JSON.stringify(row))
  const r3 = await creer(U3, 'dc-cut')
  ok('déclencheur « Rendu prioritaire » toujours appliqué (insertion par la fonction)', (await q(`select prioritaire from public.render_jobs where id = $1`, [r3.id]))[0].prioritaire === true)
  // 1 en cours : terminé → une nouvelle passe
  await q(`update public.render_jobs set status = 'done' where id = $1`, [r1.id])
  ok('récupération terminée → la suivante passe', (await creer(U1, 'dc-fetch')).ok)
  // job mort (sans battement depuis 46 min) : ne compte plus
  await vider()
  await creer(U1, 'dc-fetch')
  await q(`update public.render_jobs set updated_at = now() - interval '46 minutes'`)
  ok('job sans battement depuis 46 min : plus compté « en cours »', (await creer(U1, 'dc-fetch')).ok)
  // quota : 6 par 10 min, échecs compris, glissant
  await vider()
  for (let i = 0; i < 6; i++) { await creer(U1, 'dc-fetch'); await q(`update public.render_jobs set status = case when random() < .5 then 'failed' else 'done' end where status = 'queued'`) }
  const r7 = await creer(U1, 'dc-fetch')
  ok('7e récupération en 10 min (échecs compris) : refus « quota »', !r7.ok && r7.raison === 'quota', JSON.stringify(r7))
  ok('la découpe reste possible malgré le quota de liens', (await creer(U1, 'dc-cut')).ok)
  await q(`update public.render_jobs set status = 'done' where plan->>'__compose' = 'dc-cut'`)   // découpe finie (1 travail court à la fois)
  await q(`update public.render_jobs set created_at = now() - interval '11 minutes' where plan->>'__compose' = 'dc-fetch'`)
  ok('11 min plus tard : la récupération passe', (await creer(U1, 'dc-fetch')).ok)
  await vider()
  for (let i = 0; i < 6; i++) { await creer(U1, 'dc-fetch', ', 3, 1, null'); await q(`update public.render_jobs set status = 'done'`) }
  ok('quota null (owner / developer) : pas de quota', (await creer(U1, 'dc-fetch', ', 3, 1, null')).ok)
  let err = ''
  try { await q(`select public.render_job_dc_creer($1::uuid, '{"__compose":"gen-subs","duration":3}'::jsonb, 'x', '[]'::jsonb)`, [U1]) } catch (e) { err = String((e as Error).message) }
  ok('autre type de job refusé (la fonction ne crée QUE des jobs Décupleur)', /invalide/.test(err), err)
  err = ''
  try { await q(`select public.render_job_dc_creer($1::uuid, '{"duration":3}'::jsonb, 'x', '[]'::jsonb)`, [U1]) } catch (e) { err = String((e as Error).message) }
  ok('montage (sans __compose) refusé', /invalide/.test(err), err)
}

console.log('D. render_claim_dc (prise en charge des dc-fetch / dc-cut par les moteurs, plafond global)')
{
  await vider()
  const ids: string[] = []
  for (const u of [U1, U2, U3]) for (const c of ['dc-fetch', 'dc-cut']) ids.push((await q(`insert into public.render_jobs (user_id, plan, input_video) values ($1, $2::jsonb, 'x') returning id`, [u, plan(c)]))[0].id)
  const montage = (await q(`insert into public.render_jobs (user_id, plan, input_video) values ($1, '{"duration":30}'::jsonb, 'x') returning id`, [U1]))[0].id
  const pris = await Promise.all(ids.map((id) => q(`select public.render_claim_dc($1::uuid, 2) as ok`, [id]).then((r) => r[0].ok as boolean)))
  ok(`6 moteurs demandent en même temps : 2 pris (DC_MOTEURS_MAX = 2) — ${pris.filter(Boolean).length}`, pris.filter(Boolean).length === 2)
  ok('les pris passent en « rendering » avec attempts + 1', Number((await q(`select count(*)::int n from public.render_jobs where status = 'rendering' and attempts = 1`))[0].n) === 2)
  const mcref = (await q(`insert into public.render_jobs (user_id, plan, input_video) values ($1, $2::jsonb, 'x') returning id`, [U2, plan('mc-ref')]))[0].id
  ok('relecture 30/10 : mc-ref plafond atteint → refusé, reste en file', (await q(`select public.render_claim_dc($1::uuid, 2) as ok`, [mcref]))[0].ok === false
    && (await q(`select status from public.render_jobs where id = $1`, [mcref]))[0].status === 'queued')
  ok('… et un mc-ref en cours compte dans le plafond (3 max : pris, puis plus aucun dc)', (await q(`select public.render_claim_dc($1::uuid, 3) as ok`, [mcref]))[0].ok === true
    && (await q(`select public.render_claim_dc($1::uuid, 3) as ok`, [ids[pris.findIndex((x) => !x)]]))[0].ok === false)
  await q(`update public.render_jobs set status = 'queued' where id = $1`, [mcref])
  ok('un montage ne passe jamais par render_claim_dc', (await q(`select public.render_claim_dc($1::uuid, 50) as ok`, [montage]))[0].ok === false
    && (await q(`select status from public.render_jobs where id = $1`, [montage]))[0].status === 'queued')
  await q(`update public.render_jobs set status = 'done' where status = 'rendering' and id = $1`, [ids[pris.findIndex(Boolean)]])
  ok('une place libérée → un suivant pris', (await q(`select public.render_claim_dc($1::uuid, 2) as ok`, [ids[pris.findIndex((x) => !x)]]))[0].ok === true)
  await q(`update public.render_jobs set updated_at = now() - interval '31 minutes' where status = 'rendering'`)
  const restant = ids.filter((id, i) => !pris[i])
  const r = await q(`select public.render_claim_dc($1::uuid, 2) as ok`, [restant[restant.length - 1]])
  ok('orphelins sans battement depuis 31 min : plus comptés', r[0].ok === true)
  ok('job déjà pris : refusé (jamais deux moteurs sur le même)', (await q(`select public.render_claim_dc($1::uuid, 50) as ok`, [restant[restant.length - 1]]))[0].ok === false)
}

console.log('E. Droits : EXECUTE réservé à service_role')
for (const f of ['render_job_dc_creer(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text[], integer, integer)', 'render_claim_dc(uuid, integer)']) {
  const d = (await q(`select has_function_privilege('anon', 'public.${f}', 'execute') a, has_function_privilege('authenticated', 'public.${f}', 'execute') u,
    has_function_privilege('service_role', 'public.${f}', 'execute') s, exists (select 1 from information_schema.routine_privileges where routine_name = split_part('${f}', '(', 1) and grantee = 'PUBLIC') p,
    (select prosecdef from pg_proc where oid = 'public.${f}'::regprocedure) sd`))[0]
  ok(`${f.split('(')[0]} : anon non, authenticated non, PUBLIC non, service_role oui, SECURITY DEFINER`, !d.a && !d.u && d.s && !d.p && d.sd, JSON.stringify(d))
}

console.log(`\n${nKo === 0 ? '✓' : '✗'} ${nOk}/${nOk + nKo} vérifications OK`)
Deno.exit(nKo ? 1 : 0)
