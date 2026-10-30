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
  ok('2e relecture : récupération de l’app en cours → la préparation d’une carte Claude du même compte PASSE (familles séparées)', m.ok === true, JSON.stringify(m))
  const c = await creer(U1, 'dc-cut')
  ok('… mais une découpe pendant la récupération : refus « court_en_cours » (même famille)', !c.ok && c.raison === 'court_en_cours', JSON.stringify(c))
  const m2 = await creer(U1, 'mc-ref', OMNI)
  ok('… et une 2e préparation pendant la 1re : refus « court_en_cours »', !m2.ok && m2.raison === 'court_en_cours', JSON.stringify(m2))
  ok('… un autre compte passe', (await creer(U2, 'mc-ref', OMNI)).ok)
  await q(`update public.render_jobs set status = 'done'`)
  ok('tout terminé : la préparation (suite du parcours) passe', (await creer(U1, 'mc-ref', OMNI)).ok)
  await vider()
  const OMNIQ = `, 2, 1, 6, 600, array['mc-ref']::text[], 1, null, 10`
  for (let i = 0; i < 10; i++) { await creer(U1, 'mc-ref', OMNIQ); await q(`update public.render_jobs set status = case when random() < .5 then 'failed' else 'done' end where status = 'queued'`) }
  const q11 = await creer(U1, 'mc-ref', OMNIQ)
  ok('2e relecture : 11e préparation en 10 min (échecs compris) : refus « quota » (p_prep_quota = 10)', !q11.ok && q11.raison === 'quota', JSON.stringify(q11))
  ok('… quota null (owner / developer) : passe', (await creer(U1, 'mc-ref', `, 2, 1, 6, 600, array['mc-ref']::text[], 1, null, null`)).ok)
  await vider()
  const OMNIE = `, 2, 1, 6, 600, array['mc-ref']::text[], 1, null, 10, 3`
  for (let i = 0; i < 3; i++) { await creer(U1, 'mc-ref', OMNIE); await q(`update public.render_jobs set status = 'failed' where status = 'queued'`) }
  const e4 = await creer(U1, 'mc-ref', OMNIE)
  ok('2e relecture : 3 préparations ÉCHOUÉES dans l’heure (jamais débitées) → la 4e est refusée « quota »', !e4.ok && e4.raison === 'quota', JSON.stringify(e4))
  await q(`update public.render_jobs set created_at = now() - interval '61 minutes'`)
  ok('… une heure plus tard : elle passe', (await creer(U1, 'mc-ref', OMNIE)).ok)
  await vider()
  for (let i = 0; i < 3; i++) { await creer(U1, 'mc-ref', OMNIE); await q(`update public.render_jobs set status = 'done' where status = 'queued'`) }
  ok('… des préparations RÉUSSIES (suivies d’un débit) ne comptent pas', (await creer(U1, 'mc-ref', OMNIE)).ok)
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

console.log('D. render_claim_dc (prise en charge des travaux gratuits par les moteurs, plafond PAR FAMILLE)')
{
  await vider()
  const ins = async (u: string, c: string) => (await q(`insert into public.render_jobs (user_id, plan, input_video) values ($1, $2::jsonb, 'x') returning id`, [u, c === 'retouche' ? '{"__compose":"retouche"}' : plan(c)]))[0].id as string
  const prise = async (id: string, max = 2, prep = 1, ret = 1) => (await q(`select public.render_claim_dc($1::uuid, $2, $3, $4) as ok`, [id, max, prep, ret]))[0].ok as boolean
  const statut = async (id: string) => (await q(`select status from public.render_jobs where id = $1`, [id]))[0].status as string
  const ids: string[] = []
  for (const u of [U1, U2, U3]) for (const c of ['dc-fetch', 'dc-cut']) ids.push(await ins(u, c))
  const montage = (await q(`insert into public.render_jobs (user_id, plan, input_video) values ($1, '{"duration":30}'::jsonb, 'x') returning id`, [U1]))[0].id
  const pris = await Promise.all(ids.map((id) => prise(id)))
  ok(`6 moteurs demandent en même temps : 2 dc pris (DC_MOTEURS_MAX = 2) — ${pris.filter(Boolean).length}`, pris.filter(Boolean).length === 2)
  ok('les pris passent en « rendering » avec attempts + 1', Number((await q(`select count(*)::int n from public.render_jobs where status = 'rendering' and attempts = 1`))[0].n) === 2)
  const m1 = await ins(U2, 'mc-ref'), m2 = await ins(U3, 'mc-ref')
  ok('2e relecture : famille dc pleine → une préparation mc-ref est PRISE quand même (sa propre place)', (await prise(m1)) === true && (await statut(m1)) === 'rendering')
  ok('… la 2e préparation attend (DC_PREP_MAX = 1), reste en file', (await prise(m2)) === false && (await statut(m2)) === 'queued')
  ok('… et une préparation en cours ne prend aucune place aux dc (toujours 2 dc au plus)', (await prise(ids[pris.findIndex((x) => !x)], 2, 5, 1)) === false)
  const r1 = await ins(U1, 'retouche'), r2 = await ins(U2, 'retouche')
  ok('2e relecture : retouche prise sous SON plafond (RETOUCHE_MOTEURS_MAX = 1), la 2e attend', (await prise(r1)) === true && (await prise(r2)) === false && (await statut(r2)) === 'queued')
  ok('… RETOUCHE_MOTEURS_MAX = 2 : la 2e est prise', (await prise(r2, 2, 1, 2)) === true)
  ok('un montage ne passe jamais par render_claim_dc', (await prise(montage, 50, 50, 50)) === false && (await statut(montage)) === 'queued')
  await q(`update public.render_jobs set status = 'done' where status = 'rendering' and id = $1`, [ids[pris.findIndex(Boolean)]])
  ok('une place dc libérée → un suivant pris', (await prise(ids[pris.findIndex((x) => !x)])) === true)
  await q(`update public.render_jobs set updated_at = now() - interval '31 minutes' where status = 'rendering'`)
  const restant = ids.filter((id, i) => !pris[i])
  ok('orphelins sans battement depuis 31 min : plus comptés', (await prise(restant[restant.length - 1])) === true)
  ok('job déjà pris : refusé (jamais deux moteurs sur le même)', (await prise(restant[restant.length - 1], 50, 50, 50)) === false)
}

console.log('F. 2e relecture : render_job_creer_borne (retouche ; gen-subs, motion-split, motion-bg)')
{
  const pl = (c: string) => JSON.stringify(c === 'retouche' ? { __compose: c } : { __compose: c, duration: 30 })
  const creerB = async (u: string, c: string, max = 2) =>
    (await q(`select public.render_job_creer_borne($1::uuid, $2::jsonb, $3, '[{"id":"photo","path":"x"}]'::jsonb, $4) as r`, [u, pl(c), `${u}/retouche-1-a.mp4`, max]))[0].r as { ok: boolean; id?: string; raison?: string }
  await vider()
  // AVANT : comptage puis insertion (render-job jusqu'au 30/10) — 15 comptages avant la 1re insertion
  const comptes = await Promise.all(Array.from({ length: 15 }, () => q(`select count(*)::int n from public.render_jobs where user_id = $1 and status in ('queued','rendering') and plan->>'__compose' = 'retouche' and created_at >= now() - interval '15 minutes'`, [U1])))
  for (const c of comptes) if (Number(c[0].n) < 2) await q(`insert into public.render_jobs (user_id, status, plan, input_video) values ($1, 'queued', '{"__compose":"retouche"}'::jsonb, 'x')`, [U1])
  const avant = await nb(U1)
  console.log(`     → AVANT : ${avant} retouches créées pour un plafond de 2`)
  ok('(constat) l’ancien schéma dépasse « 2 retouches en cours » en rafale', avant === 15, String(avant))
  await vider()
  const rr = await Promise.all(Array.from({ length: 15 }, () => creerB(U1, 'retouche')))
  ok(`15 retouches « simultanées » : 2 créées — ${await nb(U1, 'retouche')}`, (await nb(U1, 'retouche')) === 2 && rr.filter((r) => !r.ok).every((r) => r.raison === 'en_cours'))
  await vider()
  await Promise.all(Array.from({ length: 20 }, () => creerB(U2, 'gen-subs')))
  ok(`20 gen-subs « simultanés » : 2 créés — ${await nb(U2, 'gen-subs')}`, (await nb(U2, 'gen-subs')) === 2)
  ok('un autre compte n’est pas touché', (await creerB(U1, 'motion-split')).ok)
  await vider()
  await q(`insert into public.render_jobs (user_id, status, plan, input_video) values ($1, 'rendering', '{"duration":30}'::jsonb, 'x'), ($1, 'queued', '{"__compose":"decupleur"}'::jsonb, 'x')`, [U1])
  const g = await creerB(U1, 'gen-subs')
  ok('gen-subs : « 2 rendus en cours » comptés TOUS types (montage, lot…) comme avant', !g.ok && g.raison === 'en_cours', JSON.stringify(g))
  ok('… mais une retouche ne compte que les retouches (Express pendant un montage : passe)', (await creerB(U1, 'retouche')).ok)
  await vider()
  await creerB(U1, 'retouche'); await creerB(U1, 'retouche')
  await q(`update public.render_jobs set created_at = now() - interval '16 minutes'`)
  ok('retouches créées il y a plus de 15 min : plus comptées (comme avant)', (await creerB(U1, 'retouche')).ok)
  await vider()
  await creerB(U1, 'gen-subs'); await creerB(U1, 'gen-subs')
  await q(`update public.render_jobs set updated_at = now() - interval '46 minutes'`)
  ok('rendus sans battement depuis 46 min : plus comptés (comme avant)', (await creerB(U1, 'gen-subs')).ok)
  const r3 = await creerB(U3, 'retouche')
  const row = (await q(`select * from public.render_jobs where id = $1`, [r3.id]))[0]
  ok('job créé : en file, plan, entrée, assets, avatar_clips [] ; « Rendu prioritaire » appliqué', row.status === 'queued' && row.plan.__compose === 'retouche' && row.assets[0].id === 'photo'
    && Array.isArray(row.avatar_clips) && row.avatar_clips.length === 0 && row.prioritaire === true, JSON.stringify(row))
  for (const bad of ['{"__compose":"decupleur"}', '{"__compose":"mc-ref"}', '{"duration":30}']) {
    let err = ''
    try { await q(`select public.render_job_creer_borne($1::uuid, $2::jsonb, 'x')`, [U1, bad]) } catch (e) { err = String((e as Error).message) }
    ok(`refusé : ${bad} (la fonction ne crée que retouche / gen-subs / motion-split / motion-bg)`, /invalide/.test(err), err)
  }
}

console.log('E. Droits : EXECUTE réservé à service_role')
for (const f of ['render_job_dc_creer(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text[], integer, integer, integer, integer)', 'render_claim_dc(uuid, integer, integer, integer)',
  'render_job_creer_borne(uuid, jsonb, text, jsonb, integer)']) {
  const d = (await q(`select has_function_privilege('anon', 'public.${f}', 'execute') a, has_function_privilege('authenticated', 'public.${f}', 'execute') u,
    has_function_privilege('service_role', 'public.${f}', 'execute') s, exists (select 1 from information_schema.routine_privileges where routine_name = split_part('${f}', '(', 1) and grantee = 'PUBLIC') p,
    (select prosecdef from pg_proc where oid = 'public.${f}'::regprocedure) sd`))[0]
  ok(`${f.split('(')[0]} : anon non, authenticated non, PUBLIC non, service_role oui, SECURITY DEFINER`, !d.a && !d.u && d.s && !d.p && d.sd, JSON.stringify(d))
}

// une seule surcharge de chaque fonction (jamais PGRST203 « ambigu » côté PostgREST), même si un brouillon précédent (signatures du
// commit 8daf5ea5 : 11 paramètres, render_claim_dc à 2) avait été appliqué quelque part avant celle-ci
{
  await db.exec(`create or replace function public.render_job_dc_creer(p_user uuid, p_plan jsonb, p_input text, p_assets jsonb default '[]'::jsonb, a integer default 3, b integer default 1,
    c integer default 6, d integer default 600, e text[] default null, f integer default 1, g integer default 10) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create or replace function public.render_claim_dc(p_job uuid, p_max integer default 2) returns boolean language sql as $$ select false $$;`)
  await db.exec(sql)
  const n = await q(`select proname, count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('render_job_dc_creer', 'render_claim_dc', 'render_job_creer_borne') group by 1`)
  ok('une seule signature par fonction', n.length === 3 && n.every((r) => r.n === 1), JSON.stringify(n))
}

console.log(`\n${nKo === 0 ? '✓' : '✗'} ${nOk}/${nOk + nKo} vérifications OK`)
Deno.exit(nKo ? 1 : 0)
