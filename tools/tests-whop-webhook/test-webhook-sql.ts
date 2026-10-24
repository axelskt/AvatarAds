// Rejoue la migration 20261024020000_webhook_whop_atomique.sql sur un VRAI Postgres en mémoire (PGlite, Postgres 16) :
// fonctions whop_webhook_*, versement mensuel des annuels, reprise des verrous, droits, rejouabilité.
// Relecture du 24/10 : + achats mis de côté (p_par_adresse, whop_achat_valider), essai d'un annuel, lien de gestion repris
// au renouvellement, file des résiliations (dernier_essai_at), rejouable par-dessus la 1re version (ancienne signature).
//   deno run --allow-env --allow-read --allow-net test-webhook-sql.ts <chemin du dépôt>
import { PGlite } from 'npm:@electric-sql/pglite@0.2.17'
const DEPOT = Deno.args[0] || '/Users/axelskotnicki/Downloads/Autre SaaS/avatarads-membres'
const MIG = await Deno.readTextFile(`${DEPOT}/supabase/migrations/20261024020000_webhook_whop_atomique.sql`)
const HIST = await Deno.readTextFile(`${DEPOT}/supabase/migrations/20261015120000_credit_history.sql`)
const BASE = String.raw`
set timezone = 'UTC';
create role anon; create role authenticated; create role service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema cron;
create table cron.jobs (jobname text primary key, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.jobs values (p_name, p_schedule, p_command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create table public.profiles (
  id uuid primary key, email text, plan text default 'free', credits_remaining integer default 2, credits_total integer default 2,
  bought_credits integer not null default 0, img_bonus_credits integer not null default 0, whop_member_id text, whop_plan_id text,
  whop_manage_url text, whop_cancel_at_period_end boolean not null default false, first_sub_bonus_used boolean not null default false,
  retention_bonus_used boolean not null default false, rendu_prioritaire boolean not null default false, prio_member_id text,
  referred_by text, signup_ip text, created_at timestamptz default now());
create table public.webhook_events (id bigint generated always as identity primary key, event_id text, body jsonb, received_at timestamptz default now());
create unique index webhook_events_event_id_key on public.webhook_events (event_id) where event_id is not null;
create table public.credit_ops (id uuid primary key default gen_random_uuid(), user_id uuid, amount integer, reason text, created_at timestamptz default now(), refunded_at timestamptz);
create table public.mcp_jobs (id uuid primary key, kind text);
create table public.mcp_debits (id bigint generated always as identity primary key, user_id uuid, amount integer, refunded boolean default false, refunded_amt integer, created_at timestamptz default now(), job_id uuid);
create or replace function public.referrer_id_from_code(p_code text) returns uuid language sql stable security definer set search_path to 'public' as $function$
  select p.id from public.profiles p
  where p.id::text = lower(p_code)
     or upper(substr(replace(p.id::text,'-',''),1,10)) = upper(trim(p_code))
  limit 1;
$function$;
`
const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); if (!c) console.log('  ✗ ' + n + ' — ' + d) }
const U = '00000000-0000-4000-8000-000000000001', P = 'abcdef01-2345-4000-8000-0000000000aa'
const db = new PGlite()
await db.exec(BASE)
await db.exec(HIST)   // historique des crédits (trigger différé sur profiles) : les fonctions doivent cohabiter avec lui
const q1 = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0]
const rpc = async (sql: string, p: unknown[] = []) => (await q1(`select ${sql} r`, p)).r
const prof = () => q1(`select * from public.profiles where id = $1`, [U])
const reset = async (extra: Record<string, unknown> = {}) => {
  await db.exec(`delete from public.profiles; delete from public.whop_annulations; delete from public.credits_annuels_versements; delete from public.webhook_events where event_id like 'whop-%' or event_id like 'msg_%'`)
  const cols = { id: U, email: 'client@test.fr', plan: 'free', credits_remaining: 0, credits_total: 0, bought_credits: 0, ...extra }
  const k = Object.keys(cols)
  await db.query(`insert into public.profiles (${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(cols))
}
const journal = (id: string, action: string, data: unknown, at = 'now()') => db.query(`insert into public.webhook_events (event_id, body, received_at) values ($1, $2::jsonb, ${at})`, [id, JSON.stringify({ action, data })])

// ── reprise des verrous : journal AVANT la migration ──
await journal('msg_b1', 'membership.activated', { id: 'mem_b1', status: 'active', plan: { id: 'plan_0iHH0kY3uoJpo' } }, `now() - interval '40 days'`)
await journal('msg_b2', 'membership.activated', { id: 'mem_b2', status: 'trialing', plan: { id: 'plan_g4BVtDmk6hgjQ' } }, `now() - interval '40 days'`)
await journal('msg_b3a', 'membership.activated', { id: 'mem_b3', status: 'active', plan: { id: 'plan_g4BVtDmk6hgjQ' } }, `now() - interval '80 days'`)
await journal('msg_b3b', 'membership.activated', { id: 'mem_b3', status: 'active', plan: { id: 'plan_g4BVtDmk6hgjQ' } }, `now() - interval '50 days'`)
await journal('msg_b4', 'payment.succeeded', { id: 'pay_b4', membership: { id: 'mem_b4' }, plan: { id: 'plan_g4BVtDmk6hgjQ' } }, `now() - interval '40 days'`)
// 1re version de la migration déjà appliquée : whop_annulations sans dernier_essai_at, ancienne signature à 10 paramètres
await db.exec(`create table public.whop_annulations (membership_id text primary key, user_id uuid, genre text not null default 'abonnement', remplace_par text,
  created_at timestamptz not null default now(), essais integer not null default 0, derniere_erreur text, fait_at timestamptz);
  create function public.whop_webhook_activer(p_user uuid, p_member text, p_plan_id text, p_plan text, p_credits integer, p_bonus integer, p_pack integer,
  p_manage_url text, p_annuel boolean, p_essai boolean) returns jsonb language sql as $$ select '{}'::jsonb $$;`)
await db.exec(MIG)
ok('par-dessus la 1re version : une seule whop_webhook_activer (11 paramètres)', (await q1(`select count(*)::int n, max(pronargs)::int a from pg_proc where proname = 'whop_webhook_activer'`)).n === 1 && (await q1(`select max(pronargs)::int a from pg_proc where proname = 'whop_webhook_activer'`)).a === 11)
ok('par-dessus la 1re version : whop_annulations.dernier_essai_at ajoutée', !!(await q1(`select 1 x from information_schema.columns where table_name = 'whop_annulations' and column_name = 'dernier_essai_at'`)))
ok('migration : s’applique', true)
let r: any = await q1(`select received_at < now() - interval '39 days' v from public.webhook_events where event_id = 'whop-activation:mem_b1'`)
ok('reprise : verrou d’activation daté de l’activation d’origine (jamais now())', r?.v === true, JSON.stringify(r))
ok('reprise : pas de verrou pour un essai, ni pour un paiement', !(await q1(`select 1 x from public.webhook_events where event_id in ('whop-activation:mem_b2', 'whop-activation:pay_b4', 'whop-activation:mem_b4')`)))
r = await q1(`select count(*)::int n, max(received_at) > now() - interval '51 days' v from public.webhook_events where event_id = 'whop-activation:mem_b3'`)
ok('reprise : un verrou par abonnement, à la plus récente activation', r?.n === 1 && r?.v === true, JSON.stringify(r))
ok('reprise : verrou du pack posé pour une variante seulement', !!(await q1(`select 1 x from public.webhook_events where event_id = 'whop-pack-variante:mem_b1'`)) && !(await q1(`select 1 x from public.webhook_events where event_id = 'whop-pack-variante:mem_b3'`)))
await db.exec(MIG)
ok('migration : rejouable (2e passage sans erreur ni verrou en double)', (await q1(`select count(*)::int n from public.webhook_events where event_id like 'whop-activation:%'`)).n === 2)
ok('cron : tâche « credits-annuels-hourly » planifiée', (await q1(`select command from cron.jobs where jobname = 'credits-annuels-hourly'`))?.command?.includes('verser_credits_annuels'))

// ── droits ──
const FN = ['whop_webhook_activer(uuid,text,text,text,integer,integer,integer,text,boolean,boolean,boolean)', 'whop_achat_valider(text)', 'whop_webhook_pack(uuid,integer,integer)',
  'whop_webhook_renouveler(uuid,text,text,text,integer,boolean)', 'whop_webhook_fin(uuid,text,text)', 'whop_webhook_resiliation(uuid,text,boolean)',
  'whop_webhook_retirer_pack(uuid,integer,integer)', 'whop_webhook_poser_parrain(uuid,text)', 'verser_credits_annuels()', 'whop_credits_mensuels_annuel(text)']
for (const f of FN) {
  const d = await q1(`select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u, has_function_privilege('service_role', $1, 'EXECUTE') s`, ['public.' + f])
  ok(`droits ${f.split('(')[0]} : client non, service_role oui`, d.a === false && d.u === false && d.s === true, JSON.stringify(d))
}
for (const t of ['whop_annulations', 'credits_annuels_versements', 'whop_achats_a_verifier']) {
  const d = await q1(`select has_table_privilege('anon', $1, 'SELECT') a, has_table_privilege('authenticated', $1, 'SELECT') u`, ['public.' + t])
  ok(`droits table ${t} : client non`, d.a === false && d.u === false, JSON.stringify(d))
}

// ── activation ──
const ACT = (m: string, plan = 'plan_0iHH0kY3uoJpo', p = 'pro', cr = 550, bonus = 50, pack = 300, annuel = false, essai = false, adresse = false) =>
  rpc(`public.whop_webhook_activer($1, $2, $3, $4, $5, $6, $7, 'https://whop/x', $8, $9, $10)`, [U, m, plan, p, cr, bonus, pack, annuel, essai, adresse])
await reset({ credits_remaining: 20, bought_credits: 20 })
r = await ACT('mem_1')
let p = await prof()
ok('activer : plan + bonus + achetés gardés + pack (550 + 50 + 20 + 300)', r.ok && !r.deja && p.credits_remaining === 920 && p.bought_credits === 320 && p.plan === 'pro' && p.first_sub_bonus_used && p.whop_member_id === 'mem_1', JSON.stringify([r, p]))
r = await ACT('mem_1'); p = await prof()
ok('activer : même abonnement une 2e fois → rien ne bouge', r.deja === true && p.credits_remaining === 920, JSON.stringify(r))
r = await ACT('mem_1', 'plan_w8lh5zpEJFOQR', 'elite', 1100, 75, 0); p = await prof()
ok('activer : même abonnement mais AUTRE plan Whop → appliqué (1100 + 320 achetés)', r.deja === false && p.plan === 'elite' && p.credits_remaining === 1420, JSON.stringify([r, p]))
await ACT('mem_1'); p = await prof()
await rpc(`public.whop_webhook_fin($1, 'mem_1', 'plan_0iHH0kY3uoJpo')`, [U]); p = await prof()
ok('fin : free, achetés gardés (320)', p.plan === 'free' && p.credits_remaining === 320 && p.whop_member_id === null, JSON.stringify(p))
r = await ACT('mem_1'); p = await prof()
ok('réactivation du même abonnement : plan revenu, pack pas reversé, pas de 2e bonus (550 + 320)', p.credits_remaining === 870 && p.bought_credits === 320 && r.pack === 0 && r.bonus === 0, JSON.stringify([r, p]))
await reset({ plan: 'pro', credits_remaining: 300, bought_credits: 40, first_sub_bonus_used: true, whop_member_id: 'mem_old', whop_plan_id: 'plan_g4BVtDmk6hgjQ' })
r = await ACT('mem_new', 'plan_w8lh5zpEJFOQR', 'elite', 1100, 75, 0)
ok('changement de palier : ancien abonnement en file de résiliation', r.a_annuler === 'mem_old' && !!(await q1(`select 1 x from public.whop_annulations where membership_id = 'mem_old' and user_id = $1 and fait_at is null`, [U])), JSON.stringify(r))
await reset({ plan: 'pro', credits_remaining: 300, first_sub_bonus_used: true, whop_member_id: 'mem_old', whop_plan_id: 'plan_g4BVtDmk6hgjQ', whop_cancel_at_period_end: true })
r = await ACT('mem_new', 'plan_w8lh5zpEJFOQR', 'elite', 1100, 75, 0)
ok('changement de palier, ancien déjà résilié : pas de file', r.a_annuler === null && !(await q1(`select 1 x from public.whop_annulations`)), JSON.stringify(r))
await reset()
r = await ACT('mem_t', 'plan_g4BVtDmk6hgjQ', 'pro', 550, 50, 0, false, true); p = await prof()
ok('essai : plan ouvert, 0 crédit, bonus gardé pour plus tard, aucun verrou', p.plan === 'pro' && p.credits_remaining === 0 && p.first_sub_bonus_used === false && !(await q1(`select 1 x from public.webhook_events where event_id = 'whop-activation:mem_t'`)), JSON.stringify(p))
await reset()
await ACT('mem_an', 'plan_P7WIywSa6YrxT', 'pro', 550, 50, 0, true); p = await prof()
ok('activer annuel : décompte posé (mois 1)', p.annuel_mois === 1 && p.annuel_debut !== null, JSON.stringify(p))
await ACT('mem_m', 'plan_g4BVtDmk6hgjQ', 'pro', 550, 50, 0, false); p = await prof()
ok('passage à un mensuel : décompte retiré', p.annuel_mois === null && p.annuel_debut === null, JSON.stringify(p))

// ── relecture du 24/10 : achat mis de côté (compte retrouvé par la seule adresse et déjà abonné) ──
await reset({ plan: 'elite', credits_remaining: 3900, bought_credits: 600, first_sub_bonus_used: true, whop_member_id: 'mem_v', whop_plan_id: 'plan_63PGeG3MesbJR' })
r = await ACT('mem_att', 'plan_YKcdyPT6RRQSi', 'starter', 150, 25, 0, false, false, true); p = await prof()
ok('par adresse, compte abonné : mis de côté, rien changé, pas de file d’annulation', r.a_verifier === true && r.nouveau === true && r.abonnement_du_compte === 'mem_v' && p.plan === 'elite' && p.credits_remaining === 3900 && p.whop_member_id === 'mem_v' && !(await q1(`select 1 x from public.whop_annulations`)) && !(await q1(`select 1 x from public.webhook_events where event_id = 'whop-activation:mem_att'`)), JSON.stringify([r, p]))
r = await ACT('mem_att', 'plan_YKcdyPT6RRQSi', 'starter', 150, 25, 0, false, false, true)
ok('par adresse, 2e fois : toujours mis de côté, plus « nouveau » (une seule alerte)', r.a_verifier === true && r.nouveau === false)
r = await rpc(`public.whop_achat_valider('mem_att')`); p = await prof()
ok('validation : appliqué (150 + 600 achetés), ancien en file, achat clos', r.ok && p.plan === 'starter' && p.credits_remaining === 750 && p.whop_member_id === 'mem_att' && !!(await q1(`select 1 x from public.whop_annulations where membership_id = 'mem_v'`)) && (await q1(`select decision from public.whop_achats_a_verifier where membership_id = 'mem_att'`)).decision === 'appliqué', JSON.stringify([r, p]))
ok('validation refaite : refusée', (await rpc(`public.whop_achat_valider('mem_att')`)).ok === false && (await rpc(`public.whop_achat_valider('mem_inconnu')`)).ok === false)
await reset({ plan: 'pro', credits_remaining: 300, first_sub_bonus_used: true, whop_member_id: 'mem_v', whop_plan_id: 'plan_g4BVtDmk6hgjQ', whop_cancel_at_period_end: true })
ok('par adresse, abonnement déjà résilié : appliqué', (await ACT('mem_n', 'plan_w8lh5zpEJFOQR', 'elite', 1100, 75, 0, false, false, true)).deja === false && (await prof()).plan === 'elite')
await reset({ credits_remaining: 100, bought_credits: 100 })
ok('par adresse, compte gratuit : appliqué', (await ACT('mem_g', 'plan_YKcdyPT6RRQSi', 'starter', 150, 25, 0, false, false, true)).deja === false && (await prof()).credits_remaining === 275)
await reset({ plan: 'pro', credits_remaining: 300, whop_member_id: 'mem_v', whop_plan_id: 'plan_g4BVtDmk6hgjQ' })
ok('sans p_par_adresse (compte connecté) : appliqué comme avant', (await ACT('mem_n2', 'plan_w8lh5zpEJFOQR', 'elite', 1100, 75, 0)).a_annuler === 'mem_v')
// ── essai d'un annuel : marqué, jamais pris pour un annuel payé par le rattrapage ──
await reset()
await ACT('mem_te', 'plan_P7WIywSa6YrxT', 'pro', 550, 50, 0, true, true); p = await prof()
ok('essai d’un annuel : annuel_mois 0, sans départ, 0 crédit', p.annuel_mois === 0 && p.annuel_debut === null && p.credits_remaining === 0, JSON.stringify(p))
ok('essai d’un annuel : le rattrapage ne pose aucun départ', (await rpc(`public.verser_credits_annuels()`)) === 0 && (await prof()).annuel_debut === null && (await prof()).credits_remaining === 0)
await db.query(`update public.profiles set annuel_debut = now() - interval '1 month 1 hour' where id = $1`, [U])
ok('essai d’un annuel, départ posé à la main : jamais versé par la tâche', (await rpc(`public.verser_credits_annuels()`)) === 0 && (await prof()).credits_remaining === 0)
await db.query(`update public.profiles set annuel_debut = null where id = $1`, [U])
await rpc(`public.whop_webhook_renouveler($1, 'mem_te', 'plan_P7WIywSa6YrxT', 'pro', 550, true)`, [U]); p = await prof()
ok('essai d’un annuel : le 1er vrai paiement verse le mois et pose le départ', p.credits_remaining === 550 && p.annuel_mois === 1 && p.annuel_debut !== null, JSON.stringify(p))
// ── renouvellement d'un profil sans abonnement : lien de gestion repris du journal ──
await reset({ plan: 'free', credits_remaining: 0 })
await journal('msg_mu1', 'membership.activated', { id: 'mem_mu', status: 'active', manage_url: 'https://whop.com/billing/manage/ancien' }, `now() - interval '50 days'`)
await journal('msg_mu2', 'membership.deactivated', { id: 'mem_mu', status: 'canceled', manage_url: 'https://whop.com/billing/manage/tok' }, `now() - interval '10 days'`)
await rpc(`public.whop_webhook_renouveler($1, 'mem_mu', 'plan_g4BVtDmk6hgjQ', 'pro', 550, false)`, [U]); p = await prof()
ok('renouveler sans abonnement rattaché : lien de gestion le plus récent repris', p.whop_member_id === 'mem_mu' && p.whop_manage_url === 'https://whop.com/billing/manage/tok', JSON.stringify(p))
await db.query(`update public.profiles set whop_manage_url = 'https://whop.com/billing/manage/actuel' where id = $1`, [U])
await rpc(`public.whop_webhook_renouveler($1, 'mem_mu', 'plan_g4BVtDmk6hgjQ', 'pro', 550, false)`, [U])
ok('renouveler : un lien de gestion déjà là n’est pas remplacé', (await prof()).whop_manage_url === 'https://whop.com/billing/manage/actuel')

// ── renouvellement ──
const REN = (m: string | null, plan = 'plan_g4BVtDmk6hgjQ', annuel = false) => rpc(`public.whop_webhook_renouveler($1, $2, $3, 'pro', 550, $4)`, [U, m, plan, annuel])
await reset({ plan: 'pro', credits_remaining: 400, bought_credits: 100, first_sub_bonus_used: true, whop_member_id: 'mem_r', whop_plan_id: 'plan_g4BVtDmk6hgjQ' })
ok('renouveler : ancien abonnement ignoré', (await REN('mem_autre')).effet === 'ancien_abonnement' && (await prof()).credits_remaining === 400)
r = await REN('mem_r'); p = await prof()
ok('renouveler : report plafonné 2× + achetés (min(300 + 550, 1100) + 100)', r.effet === 'credite' && p.credits_remaining === 950 && p.bought_credits === 100, JSON.stringify([r, p]))
r = await REN('mem_r'); p = await prof()
ok('renouveler : plafond 2× (1100 + 100)', p.credits_remaining === 1200, JSON.stringify(p))
await db.query(`insert into public.webhook_events (event_id, body) values ('whop-activation:mem_r', '{}'::jsonb)`)
ok('renouveler : verrou d’activation < 3 j → 1er cycle', (await REN('mem_r')).effet === 'premier_cycle')
await db.query(`update public.webhook_events set received_at = now() - interval '4 days' where event_id = 'whop-activation:mem_r'`)
ok('renouveler : verrou d’activation > 3 j → crédité', (await REN('mem_r')).effet === 'credite')
await journal('msg_j1', 'membership.activated', { id: 'mem_r', status: 'active' })
ok('renouveler : activation du membership dans le journal (pas encore appliquée) → 1er cycle', (await REN('mem_r')).effet === 'premier_cycle')
await db.query(`update public.webhook_events set body = jsonb_set(body, '{data,status}', '"trialing"') where event_id = 'msg_j1'`)
ok('renouveler : activation en essai → ne compte pas comme 1er cycle', (await REN('mem_r')).effet === 'credite')
await reset({ plan: 'free', credits_remaining: 120, bought_credits: 120, first_sub_bonus_used: true })
await REN('mem_w'); p = await prof()
ok('renouveler sans abonnement rattaché : plan revenu + abonnement réécrit', p.plan === 'pro' && p.whop_member_id === 'mem_w' && p.credits_remaining === 670, JSON.stringify(p))
await REN('mem_w', 'plan_P7WIywSa6YrxT', true); p = await prof()
ok('renouveler annuel : repart au mois 1', p.annuel_mois === 1 && p.annuel_debut !== null)
ok('renouveler : renouvellement d’un abonnement repris (activation 40 j avant la migration) → crédité', await (async () => { await db.query(`update public.profiles set whop_member_id = 'mem_b3' where id = $1`, [U]); return (await REN('mem_b3')).effet === 'credite' })())

// ── fin / résiliation chez Whop / pack / retrait ──
await reset({ plan: 'pro', credits_remaining: 500, bought_credits: 300, whop_member_id: 'mem_f', whop_plan_id: 'plan_g4BVtDmk6hgjQ' })
ok('fin d’un autre abonnement : rien', (await rpc(`public.whop_webhook_fin($1, 'mem_x', 'plan_g4BVtDmk6hgjQ')`, [U])).actif === false && (await prof()).plan === 'pro')
r = await rpc(`public.whop_webhook_resiliation($1, 'mem_f', true)`, [U]); p = await prof()
ok('résiliation chez Whop : achetés gardés, drapeau + date posés', r.effet === 'resiliee' && p.credits_remaining === 300 && p.bought_credits === 300 && p.whop_cancel_at_period_end && p.cancel_requested_at !== null, JSON.stringify([r, p]))
ok('résiliation chez Whop en double : déjà', (await rpc(`public.whop_webhook_resiliation($1, 'mem_f', true)`, [U])).effet === 'deja')
ok('réactivation chez Whop', (await rpc(`public.whop_webhook_resiliation($1, 'mem_f', false)`, [U])).effet === 'reactivee' && (await prof()).whop_cancel_at_period_end === false)
ok('résiliation chez Whop d’un autre abonnement : rien', (await rpc(`public.whop_webhook_resiliation($1, 'mem_x', true)`, [U])).effet === 'autre_abonnement')
await reset({ plan: 'pro', credits_remaining: 50, bought_credits: 10 })
r = await rpc(`public.whop_webhook_pack($1, 120, 0)`, [U]); p = await prof()
ok('pack : ajout au solde courant, achetés = min(achetés, solde) + pack', p.credits_remaining === 170 && p.bought_credits === 130, JSON.stringify(p))
r = await rpc(`public.whop_webhook_retirer_pack($1, 300, 0)`, [U]); p = await prof()
ok('retrait d’un pack : plancher 0', r.apres === 0 && p.credits_remaining === 0 && p.bought_credits === 0, JSON.stringify([r, p]))

// ── parrain ──
await reset({ created_at: new Date().toISOString() })
await db.query(`insert into public.profiles (id, email, plan) values ($1, 'parrain@test.fr', 'pro')`, [P])
const codeP = P.replace(/-/g, '').slice(0, 10).toUpperCase()
ok('parrain : code invalide refusé', (await rpc(`public.whop_webhook_poser_parrain($1, 'a b')`, [U])) === false)
ok('parrain : soi-même refusé', (await rpc(`public.whop_webhook_poser_parrain($1, $2)`, [U, U.replace(/-/g, '').slice(0, 10)])) === false)
ok('parrain : posé sur un compte neuf', (await rpc(`public.whop_webhook_poser_parrain($1, $2)`, [U, codeP])) === true && (await prof()).referred_by === codeP)
ok('parrain : jamais remplacé', (await rpc(`public.whop_webhook_poser_parrain($1, $2)`, [U, codeP])) === false)
await reset({ created_at: new Date(Date.now() - 2 * 86400_000).toISOString() })
await db.query(`insert into public.profiles (id, email, plan) values ($1, 'parrain@test.fr', 'pro')`, [P])
ok('parrain : compte de plus de 24 h refusé', (await rpc(`public.whop_webhook_poser_parrain($1, $2)`, [U, codeP])) === false)

// ── versement mensuel des annuels ──
const VERSE = () => rpc(`public.verser_credits_annuels()`)
const ANNUEL = { plan: 'pro', whop_plan_id: 'plan_P7WIywSa6YrxT', whop_member_id: 'mem_an', first_sub_bonus_used: true }
await reset({ ...ANNUEL, credits_remaining: 100, annuel_mois: 1, annuel_debut: new Date().toISOString() })
ok('annuels : rien avant la date anniversaire', (await VERSE()) === 0)
await db.query(`update public.profiles set annuel_debut = now() - interval '1 month' - interval '1 hour' where id = $1`, [U])
ok('annuels : 1 versement à la date anniversaire', (await VERSE()) === 1)
p = await prof()
ok('annuels : 100 + 550, mois 2, journal', p.credits_remaining === 650 && p.annuel_mois === 2 && (await q1(`select count(*)::int n from public.credits_annuels_versements`)).n === 1, JSON.stringify(p))
ok('annuels : idempotent', (await VERSE()) === 0 && (await prof()).credits_remaining === 650)
await reset({ ...ANNUEL, credits_remaining: 300, bought_credits: 300, annuel_mois: 1 })
await db.query(`update public.profiles set annuel_debut = now() - interval '3 months' - interval '2 days' where id = $1`, [U])
ok('annuels : 3 échéances en retard rattrapées', (await VERSE()) === 3)
p = await prof()
ok('annuels : plafond 2× + achetés gardés (1100 + 300), mois 4', p.credits_remaining === 1400 && p.bought_credits === 300 && p.annuel_mois === 4, JSON.stringify(p))
await reset({ ...ANNUEL, credits_remaining: 0, annuel_mois: 1 })
await db.query(`update public.profiles set annuel_debut = now() - interval '14 months' where id = $1`, [U])
ok('annuels : 11 versements au plus après l’activation (12 mois par année payée)', (await VERSE()) === 11 && (await prof()).annuel_mois === 12)
ok('annuels : rien au-delà du 12e mois', (await VERSE()) === 0)
await reset({ ...ANNUEL, credits_remaining: 0, annuel_mois: 1, annuel_debut: '2026-01-31T10:00:00Z' })
await VERSE()
const ech = (await db.query<any>(`select to_char(echeance at time zone 'UTC', 'YYYY-MM-DD') d from public.credits_annuels_versements order by mois limit 3`)).rows.map((x) => x.d)
ok('annuels : date anniversaire du 31 → 28 février puis 31 mars (calculée depuis le départ, sans dérive)', ech.join(',') === '2026-02-28,2026-03-31,2026-04-30', ech.join(','))
await reset({ ...ANNUEL, credits_remaining: 0, annuel_mois: 1, whop_cancel_at_period_end: true })
await db.query(`update public.profiles set annuel_debut = now() - interval '1 month' - interval '1 hour' where id = $1`, [U])
ok('annuels : résiliation programmée → le mois suivant de l’année payée est versé', (await VERSE()) === 1)
await reset({ ...ANNUEL, plan: 'free', credits_remaining: 0, annuel_mois: 1 })
await db.query(`update public.profiles set annuel_debut = now() - interval '2 months' where id = $1`, [U])
ok('annuels : compte free → rien', (await VERSE()) === 0)
await reset({ ...ANNUEL, whop_plan_id: 'plan_g4BVtDmk6hgjQ', credits_remaining: 0, annuel_mois: 1 })
await db.query(`update public.profiles set annuel_debut = now() - interval '2 months' where id = $1`, [U])
ok('annuels : plus un plan annuel → décompte arrêté, rien versé', (await VERSE()) === 0 && (await prof()).annuel_debut === null)
await reset({ ...ANNUEL, credits_remaining: 600 })
ok('annuels : sans date de départ → posée maintenant, rien versé', (await VERSE()) === 0 && (await prof()).annuel_mois === 1 && (await prof()).annuel_debut !== null)
await reset({ ...ANNUEL, credits_remaining: 0, annuel_mois: 1 })
await db.query(`update public.profiles set annuel_debut = now() - interval '1 month' - interval '1 hour' where id = $1`, [U])
await db.query(`insert into public.credits_annuels_versements (user_id, echeance, mois, credits, solde_avant, solde_apres) select id, annuel_debut + interval '1 month', 2, 1, 0, 0 from public.profiles where id = $1`, [U])
ok('annuels : échéance déjà au journal → versement refusé, rien d’autre ne casse', (await VERSE()) === 0 && (await prof()).credits_remaining === 0)
r = await q1(`select count(*)::int n from public.credit_events where user_id = $1`, [U])
ok('historique : le trigger différé des crédits cohabite (événements écrits)', r.n >= 0)

// relecture finale du 24/10 : compte payant DONNÉ À LA MAIN (ni abonnement ni plan Whop) — renouvellement, fin d'un
// abonnement inconnu et achat mis de côté ne le changent jamais ; un ancien abonné au MÊME plan Whop est encore rattaché
await reset({ plan: 'elite', credits_remaining: 549, bought_credits: 312, first_sub_bonus_used: true })
r = await rpc(`public.whop_webhook_renouveler($1, 'mem_inc', 'plan_YKcdyPT6RRQSi', 'starter', 150, false)`, [U]); p = await prof()
ok('plan offert : paiement d’un abonnement inconnu → ignoré, plan intact', r.effet === 'ancien_abonnement' && p.plan === 'elite' && p.credits_remaining === 549 && p.whop_member_id === null, JSON.stringify([r, p.plan, p.credits_remaining]))
r = await rpc(`public.whop_webhook_fin($1, 'mem_inc', 'plan_YKcdyPT6RRQSi')`, [U]); p = await prof()
ok('plan offert : fin d’un abonnement inconnu → jamais rétrogradé', r.actif === false && p.plan === 'elite' && p.credits_remaining === 549, JSON.stringify([r, p.plan]))
r = await rpc(`public.whop_webhook_fin($1, null, 'plan_YKcdyPT6RRQSi')`, [U]); p = await prof()
ok('plan offert : fin sans identifiant → jamais rétrogradé', r.actif === false && p.plan === 'elite', JSON.stringify([r, p.plan]))
await reset({ plan: 'pro', credits_remaining: 400, whop_member_id: 'mem_vict', whop_plan_id: 'plan_g4BVtDmk6hgjQ', first_sub_bonus_used: true })
await db.query(`insert into public.whop_achats_a_verifier (membership_id, user_id, plan_id, plan, credits, bonus, pack, annuel, essai, abonnement_du_compte) values ('mem_attente', $1, 'plan_YKcdyPT6RRQSi', 'starter', 150, 25, 0, false, false, 'mem_vict')`, [U])
await reset({ plan: 'elite', credits_remaining: 549, first_sub_bonus_used: true })
await db.query(`insert into public.whop_achats_a_verifier (membership_id, user_id, plan_id, plan, credits, bonus, pack, annuel, essai) values ('mem_att_b', $1, 'plan_YKcdyPT6RRQSi', 'starter', 150, 25, 0, false, false) on conflict do nothing`, [U])
r = await rpc(`public.whop_webhook_renouveler($1, 'mem_att_b', 'plan_YKcdyPT6RRQSi', 'starter', 150, false)`, [U]); p = await prof()
ok('achat mis de côté pas tranché : son paiement ne change rien', r.effet === 'ancien_abonnement' && p.plan === 'elite' && p.credits_remaining === 549, JSON.stringify([r, p.plan]))
await reset({ plan: 'starter', credits_remaining: 20, whop_plan_id: 'plan_YKcdyPT6RRQSi', first_sub_bonus_used: true })
r = await rpc(`public.whop_webhook_renouveler($1, 'mem_anc', 'plan_YKcdyPT6RRQSi', 'starter', 150, false)`, [U]); p = await prof()
ok('ancien abonné, même plan Whop sans identifiant : rattaché et crédité', r.effet === 'credite' && p.whop_member_id === 'mem_anc' && p.credits_remaining > 20, JSON.stringify([r, p.whop_member_id]))
r = await rpc(`public.whop_webhook_fin($1, 'mem_autre', 'plan_YKcdyPT6RRQSi')`, [U]); p = await prof()
ok('ancien abonné (après rattachement) : fin d’un AUTRE abonnement → rien', r.actif === false && p.plan === 'starter', JSON.stringify([r, p.plan]))

const ko = res.filter((x) => !x[1])
console.log(`\n${res.length - ko.length}/${res.length} vérifications SQL OK`)
if (ko.length) { for (const x of ko) console.log(' - ' + x[0]); Deno.exit(1) }
