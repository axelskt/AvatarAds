// Banc de l'audit Décupleur du 30/10, faille 8 (côté base) : la colonne render_jobs.trace ne doit plus être lisible par un
// compte client. Rejoue la migration 20261030180800_render_jobs_trace_privee.sql sur un VRAI Postgres en mémoire (PGlite,
// Postgres 16) avec les droits relus en ligne le 30/10 : SELECT de table pour authenticated, policy render_jobs_select_own
// (auth.uid() = user_id), 16 colonnes. Sans la migration (AVANT) : le client lit sa trace.
//   cd tools/tests-decupleur && deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille8-trace-sql.ts
//   SANS_MIGRATION=1 … → état d'avant (ab-faille678.sh)
// (PGlite déjà en cache s'il a servi aux bancs de tools/tests-whop-webhook ; sinon téléchargé une fois depuis npm.)
import { PGlite } from 'npm:@electric-sql/pglite@0.2.17'

const BASE = String.raw`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.render_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null default 'queued', plan jsonb,
  input_video text, assets jsonb, output_url text, error text, credits_cost integer, attempts integer default 0,
  created_at timestamptz default now(), updated_at timestamptz default now(), avatar_clips jsonb, trace jsonb,
  prioritaire boolean default false, progress integer);
alter table public.render_jobs enable row level security;
create policy render_jobs_select_own on public.render_jobs for select to authenticated using (auth.uid() = user_id);
grant select on public.render_jobs to authenticated;
grant all on public.render_jobs to service_role;
grant usage on schema public to anon, authenticated, service_role;
`
const MOI = '11111111-2222-4333-8444-555555555555', AUTRE = '99999999-2222-4333-8444-555555555555'
const db = new PGlite()
await db.exec(BASE)
await db.exec(`insert into public.render_jobs (user_id, status, error, output_url, progress, trace, plan) values
  ('${MOI}', 'failed', 'Vidéo illisible', null, null, '[{"niveau":"warn","msg":"dc-fetch yt-dlp : ERROR: [TikTok] … /tmp/dc-lien-x"}]', '{"__compose":"dc-fetch"}'),
  ('${MOI}', 'done', null, '${MOI}/dc-1/dc.json', 100, '[{"niveau":"log","msg":"▶ décupleur ×5 sur 8 cœur(s) · quota CPU 8.00"}]', '{"__compose":"decupleur"}'),
  ('${AUTRE}', 'done', null, '${AUTRE}/dc-2/dc.json', 100, '[]', '{"__compose":"decupleur"}')`)
if (Deno.env.get('SANS_MIGRATION') !== '1') {
  const MIG = await Deno.readTextFile(new URL('../../supabase/migrations/20261030180800_render_jobs_trace_privee.sql', import.meta.url))
  await db.exec(MIG)
}

const res: boolean[] = []
const ok = (n: string, c: boolean, d = '') => { res.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : ' — ' + d)) }
async function comme(role: string, sub: string | null, sql: string): Promise<{ rows?: any[]; err?: string }> {
  try {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false); set role ${role};`)
    const r = await db.query(sql); return { rows: r.rows as any[] }
  } catch (e) { return { err: (e as Error).message } } finally { await db.exec('reset role') }
}

console.log('Compte client (authenticated)')
let r = await comme('authenticated', MOI, 'select trace from public.render_jobs')
ok('le client NE lit PLUS la trace de ses rendus', !!r.err && /permission denied/i.test(r.err), r.err || JSON.stringify(r.rows))
r = await comme('authenticated', MOI, 'select id, user_id, status, plan, input_video, assets, output_url, error, credits_cost, attempts, created_at, updated_at, avatar_clips, prioritaire, progress from public.render_jobs order by created_at')
ok('il lit toujours toutes les autres colonnes de SES rendus (2 lignes)', !r.err && r.rows!.length === 2 && r.rows!.every((x) => x.user_id === MOI), r.err || JSON.stringify(r.rows))
r = await comme('authenticated', MOI, `select status from public.render_jobs where user_id = '${AUTRE}'`)
ok('jamais les rendus d’un autre compte (policy inchangée)', !r.err && r.rows!.length === 0, r.err || JSON.stringify(r.rows))
r = await comme('anon', null, 'select status from public.render_jobs')
ok('anonyme : rien', !!r.err, JSON.stringify(r.rows))
console.log('Serveur (service_role : moteur, render-job, MCP)')
r = await comme('service_role', null, 'select count(*)::int as n, count(trace)::int as t from public.render_jobs')
ok('le serveur lit tout, trace comprise', !r.err && r.rows![0].n === 3 && r.rows![0].t === 3, r.err || JSON.stringify(r.rows))

const nok = res.filter((c) => !c).length
console.log(`\n${res.length - nok}/${res.length} vérifications OK`)
Deno.exit(nok ? 1 : 0)
