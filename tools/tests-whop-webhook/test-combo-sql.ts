// Relecteur : 20261024010000 + 20261024020000 ensemble, dans les deux ordres, sur la base « en ligne » de test-credits-sql.ts
import { PGlite } from 'npm:@electric-sql/pglite@0.2.17'
const DEPOT = '/Users/axelskotnicki/Downloads/Autre SaaS/avatarads-membres'
const src = await Deno.readTextFile(`${DEPOT}/tools/tests-whop-webhook/test-credits-sql.ts`)
const ENLIGNE = src.slice(src.indexOf('String.raw`') + 11, src.indexOf('\n`\n', src.indexOf('String.raw`')))
const M1 = await Deno.readTextFile(`${DEPOT}/supabase/migrations/20261024010000_resiliation_atomique.sql`)
const M2 = await Deno.readTextFile(`${DEPOT}/supabase/migrations/20261024020000_webhook_whop_atomique.sql`)
const EXTRA = String.raw`
set timezone = 'UTC';
alter table public.profiles add column if not exists whop_manage_url text, add column if not exists img_bonus_credits integer not null default 0,
  add column if not exists referred_by text, add column if not exists signup_ip text, add column if not exists created_at timestamptz default now();
create schema if not exists cron;
create table cron.jobs (jobname text primary key, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.jobs values (p_name, p_schedule, p_command) on conflict (jobname) do update set schedule = excluded.schedule returning 1::bigint $$;
create table public.webhook_events (id bigint generated always as identity primary key, event_id text, body jsonb, received_at timestamptz default now());
create unique index webhook_events_event_id_key on public.webhook_events (event_id) where event_id is not null;
create or replace function public.referrer_id_from_code(p_code text) returns uuid language sql stable security definer set search_path to 'public' as $f$
  select p.id from public.profiles p where p.id::text = lower(p_code) or upper(substr(replace(p.id::text,'-',''),1,10)) = upper(trim(p_code)) limit 1; $f$;
`
const U = '00000000-0000-4000-8000-000000000001'
const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); console.log((c ? '  ok ' : '  ✗ ') + n + (c ? '' : ' — ' + d)) }
for (const ordre of ['010000 puis 020000', '020000 puis 010000']) {
  console.log('== ' + ordre)
  const db = new PGlite()
  await db.exec(ENLIGNE); await db.exec(EXTRA)
  try {
    if (ordre.startsWith('010000')) { await db.exec(M1); await db.exec(M2); await db.exec(M2) } else { await db.exec(M2); await db.exec(M1); await db.exec(M2) }
    ok('migrations appliquées (020000 rejouée)', true)
  } catch (e) { ok('migrations appliquées', false, String(e)); continue }
  const q1 = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0]
  const fns = ['whop_webhook_activer(uuid,text,text,text,integer,integer,integer,text,boolean,boolean,boolean)', 'whop_achat_valider(text)', 'whop_webhook_pack(uuid,integer,integer)',
    'whop_webhook_renouveler(uuid,text,text,text,integer,boolean)', 'whop_webhook_fin(uuid,text,text)', 'whop_webhook_resiliation(uuid,text,boolean)',
    'whop_webhook_retirer_pack(uuid,integer,integer)', 'whop_webhook_poser_parrain(uuid,text)', 'verser_credits_annuels()', 'whop_credits_mensuels_annuel(text)']
  for (const f of fns) {
    const r = await q1(`select has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') a, has_function_privilege('anon', 'public.${f}', 'EXECUTE') n, has_function_privilege('public', 'public.${f}', 'EXECUTE') p, has_function_privilege('service_role', 'public.${f}', 'EXECUTE') s`).catch((e) => ({ err: String(e) }))
    ok(`droits ${f.split('(')[0]}`, !r.a && !r.n && !r.p && (f.startsWith('whop_credits') || r.s), JSON.stringify(r))
  }
  // résiliation faite chez Whop puis whop-cancel : historique + 'already'
  await db.exec(`delete from public.profiles; delete from public.credit_events`)
  await db.query(`insert into public.profiles (id, email, plan, credits_remaining, credits_total, bought_credits, whop_member_id) values ($1,'c@t.fr','pro',700,550,100,'mem_c')`, [U])
  const r1 = await q1(`select public.whop_webhook_resiliation($1,'mem_c',true) r`, [U])
  const ev = await q1(`select kind, label, delta from public.credit_events order by id desc limit 1`)
  ok('résiliation chez Whop : 100 gardés', r1.r.effet === 'resiliee' && r1.r.keep === 100, JSON.stringify(r1))
  ok('historique : « Résiliation »', ev?.kind === 'resiliation', JSON.stringify(ev))
  const r2 = await q1(`select public.cancel_remove_plan_credits($1) r`, [U])
  ok('whop-cancel ensuite : already, départ encore à enregistrer (notify)', r2.r.reason === 'already' && r2.r.notify === true, JSON.stringify(r2))
  const r3 = await q1(`select public.cancel_remove_plan_credits($1) r`, [U])
  ok('whop-cancel une 2e fois : already, plus de notify (une seule fois)', r3.r.reason === 'already' && r3.r.notify === false, JSON.stringify(r3))
  // débit AVANT la résiliation chez Whop, remboursé APRÈS : seule la part achetée revient
  await db.exec(`delete from public.profiles; delete from public.credit_ops`)
  await db.query(`insert into public.profiles (id, email, plan, credits_remaining, credits_total, bought_credits, whop_member_id) values ($1,'c@t.fr','starter',270,150,120,'mem_c')`, [U])
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [U])
  const sp = await q1(`select public.spend_credits(270,'x') r`)
  await new Promise((r) => setTimeout(r, 5))
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  await q1(`select public.whop_webhook_resiliation($1,'mem_c',true) r`, [U])
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [U])
  const rf = await q1(`select public.refund_credits($1) r`, [sp.r.op_id]).catch((e) => ({ r: String(e) }))
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  const p = await q1(`select credits_remaining c, bought_credits b from public.profiles where id=$1`, [U])
  ok('débit avant résiliation chez Whop, remboursé après : 120 achetés seulement (pas 270)', p.c === 120 && p.b === 120, JSON.stringify({ rf, p }))
  // essai annuel : le rattrapage du cron pose-t-il un décompte sur un essai ?
  await db.exec(`delete from public.profiles; delete from public.credits_annuels_versements`)
  await db.query(`insert into public.profiles (id, email, plan, credits_remaining, credits_total, bought_credits) values ($1,'e@t.fr','free',0,0,0)`, [U])
  await q1(`select public.whop_webhook_activer($1,'mem_e','plan_P7WIywSa6YrxT','pro',550,50,0,null,true,true) r`, [U])
  await q1(`select public.verser_credits_annuels() r`)
  const pe = await q1(`select credits_remaining c, annuel_debut d, annuel_mois m from public.profiles where id=$1`, [U])
  ok('essai annuel : le cron ne pose PAS de décompte (aucun mois versé pendant un essai)', pe.d == null, JSON.stringify(pe))
  await db.query(`update public.profiles set annuel_debut = now() - interval '1 month 1 hour' where id=$1`, [U])
  const n = await q1(`select public.verser_credits_annuels() r`)
  const pe2 = await q1(`select credits_remaining c, annuel_mois m from public.profiles where id=$1`, [U])
  ok('essai annuel d’un mois : aucun crédit versé avant le 1er paiement', pe2.c === 0, JSON.stringify({ n, pe2 }))
  const lab = await q1(`select kind, label, delta from public.credit_events order by id desc limit 1`)
  console.log('   (libellé du versement mensuel : ' + JSON.stringify(lab) + ')')
  await db.close()
}
const ko = res.filter((r) => !r[1]); console.log(`\n${res.length - ko.length}/${res.length}`)
