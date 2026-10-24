// Rejoue la migration 20261024010000_resiliation_atomique.sql sur un VRAI Postgres en mémoire (PGlite, Postgres 16),
// chargé avec les fonctions de crédits telles qu'elles sont EN LIGNE le 24/10 (copiées de pg_get_functiondef, voir
// ENLIGNE). Chaque scénario tourne deux fois : A = la base d'aujourd'hui (ancienne résiliation de whop-cancel : solde lu
// AVANT l'appel Whop puis réécrit), B = la base migrée (cancel_remove_plan_credits). A doit montrer le défaut, B non.
//   cd tools/tests-whop-webhook && deno run --allow-env --allow-read --allow-net test-credits-sql.ts [migration.sql]
// (1er lancement : télécharge PGlite depuis npm.) Si une fonction change en ligne, mettre ENLIGNE à jour d'abord.
// A/B : un 1er argument rejoue une autre version de la migration (ex. une copie d'avant un correctif) avec les mêmes cas.
import { PGlite } from 'npm:@electric-sql/pglite@0.2.17'

const ENLIGNE = String.raw`
create role anon; create role authenticated; create role service_role;
-- comme Supabase : toute nouvelle fonction est d'abord exécutable par anon / authenticated / service_role
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.profiles (
  id uuid primary key, email text, plan text default 'free', credits_remaining integer default 0, credits_total integer default 0,
  is_owner boolean default false, bought_credits integer default 0, whop_member_id text, whop_plan_id text,
  whop_cancel_at_period_end boolean default false, retention_bonus_used boolean default false, first_sub_bonus_used boolean default false,
  mcp_day_spent integer default 0, rendu_prioritaire boolean not null default false, prio_member_id text);
create table public.credit_ops (
  id uuid primary key default gen_random_uuid(), user_id uuid, amount integer, reason text, created_at timestamptz default now(),
  refunded_at timestamptz, bought_part integer default 0, remaining integer, consumed_at timestamptz, reserved_remaining integer,
  settled_at timestamptz, provider_job text, job_drawn integer, provider_path text, job_bill_state text, refunded_amount integer);
create table public.mcp_debits (
  id bigint generated always as identity primary key, user_id uuid, amount integer, bought integer default 0, refunded boolean default false,
  created_at timestamptz default now(), job_id uuid, refunded_amt integer not null default 0, refunded_bought integer not null default 0);
create table public.kie_jobs (task_id text primary key, user_id uuid, op_id uuid, bill_state text, drawn integer, start_img integer,
  billed_at timestamptz, bill_reason text);
create table public.cancellation_feedback (id bigint generated always as identity, user_id uuid, email text, plan text, reason text,
  detail text, outcome text);
create table public.credit_events (id bigint generated always as identity primary key, user_id uuid not null, created_at timestamptz not null default now(),
  kind text not null, delta integer not null, balance_after integer not null, plan text, label text);

create or replace function public.spend_credits(p_secs integer, p_reason text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare
  v_row public.profiles%rowtype; v_new integer; v_charged integer; v_bought integer := 0; v_op uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_secs is null or p_secs <= 0 or p_secs > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    v_charged := 0; v_new := coalesce(v_row.credits_remaining, 0);
  else
    if coalesce(v_row.credits_remaining,0) < p_secs then
      return jsonb_build_object('ok', false, 'balance', coalesce(v_row.credits_remaining,0), 'op_id', null);
    end if;
    v_bought := least(p_secs, greatest(0, coalesce(v_row.bought_credits,0) - (coalesce(v_row.credits_remaining,0) - p_secs)));   -- 23/10 : plan d'abord, achetés ensuite
    update public.profiles
       set credits_remaining = coalesce(credits_remaining,0) - p_secs,
           bought_credits    = greatest(0, coalesce(bought_credits,0) - v_bought)
     where id = auth.uid() returning credits_remaining into v_new;
    v_charged := p_secs;
  end if;
  insert into public.credit_ops (user_id, amount, reason, bought_part, reserved_remaining)
  values (auth.uid(), v_charged, left(coalesce(p_reason,''), 80), v_bought, v_charged)
  returning id into v_op;
  return jsonb_build_object('ok', true, 'balance', v_new, 'op_id', v_op);
end;
$function$;

create or replace function public.refund_credits(p_op_id uuid) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare v_op public.credit_ops%rowtype; v_new integer; v_res integer; v_bought integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_op from public.credit_ops where id = p_op_id and user_id = auth.uid() for update;
  if not found then
    select credits_remaining into v_new from public.profiles where id = auth.uid();
    return jsonb_build_object('ok', false, 'reason', 'unknown_op', 'balance', v_new);
  end if;
  select credits_remaining into v_new from public.profiles where id = auth.uid();
  if v_op.refunded_at is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_refunded',  'balance', v_new); end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old',           'balance', v_new); end if;
  v_res := coalesce(v_op.reserved_remaining, v_op.amount);
  if v_res < v_op.amount and v_op.settled_at is null then
                                                       return jsonb_build_object('ok', false, 'reason', 'in_progress',       'balance', v_new); end if;
  if v_res <= 0 then                                   return jsonb_build_object('ok', false, 'reason', 'already_delivered', 'balance', v_new); end if;
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0 where id = v_op.id;
  v_bought := least(coalesce(v_op.bought_part, 0), floor(coalesce(v_op.bought_part, 0)::numeric * v_res / greatest(v_op.amount, 1))::int);
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_res,
         bought_credits    = coalesce(bought_credits, 0) + v_bought
   where id = auth.uid() returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_res, 'partial', v_res < v_op.amount);
end;
$function$;

create or replace function public.refund_op_terminal(p_user uuid, p_op uuid, p_restore integer) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare v_op public.credit_ops%rowtype; v_new integer; v_res integer;
begin
  if p_user is null or p_op is null then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  select * into v_op from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'unknown_op');       end if;
  if v_op.refunded_at is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  if v_op.settled_at  is not null then                 return jsonb_build_object('ok', false, 'reason', 'delivered');        end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');          end if;
  v_res := least(v_op.amount, coalesce(v_op.reserved_remaining, v_op.amount) + greatest(1, coalesce(p_restore, 1)));
  if v_res < v_op.amount then                          return jsonb_build_object('ok', false, 'reason', 'not_clean');        end if;
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0 where id = v_op.id and refunded_at is null;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_op.amount,
         bought_credits    = coalesce(bought_credits, 0) + coalesce(v_op.bought_part, 0)
   where id = p_user returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end $function$;

create or replace function public.refund_by_job_terminal(p_user uuid, p_job text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare v_op public.credit_ops%rowtype; v_new integer; v_res integer;
begin
  if p_user is null or p_job is null or length(p_job) = 0 then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  select * into v_op from public.credit_ops
    where user_id = p_user and provider_job = p_job and refunded_at is null
    order by created_at desc limit 1 for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'no_op');            end if;
  if v_op.settled_at is not null or v_op.job_bill_state = 'settled' then
                                                       return jsonb_build_object('ok', false, 'reason', 'delivered');        end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');          end if;
  v_res := least(v_op.amount, coalesce(v_op.reserved_remaining, v_op.amount)
             + case when v_op.job_bill_state is null then greatest(1, coalesce(v_op.job_drawn, v_op.amount)) else 0 end);
  if v_res < v_op.amount then                          return jsonb_build_object('ok', false, 'reason', 'not_clean');        end if;
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0, job_bill_state = coalesce(job_bill_state, 'refunded')
   where id = v_op.id and refunded_at is null;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_op.amount,
         bought_credits    = coalesce(bought_credits, 0) + coalesce(v_op.bought_part, 0)
   where id = p_user returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end $function$;

create or replace function public.refund_job_open(p_user uuid, p_job text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare v public.credit_ops%rowtype; v_res integer; v_bought integer; v_new integer;
begin
  if p_user is null or p_job is null or length(p_job) = 0 then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  select * into v from public.credit_ops
   where user_id = p_user and provider_job = p_job and refunded_at is null
   order by created_at desc limit 1 for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'no_op');       end if;
  if v.job_bill_state = 'settled' then                 return jsonb_build_object('ok', false, 'reason', 'delivered');   end if;
  if v.job_bill_state is null and v.job_drawn is null then
                                                       return jsonb_build_object('ok', false, 'reason', 'no_drawn');    end if;
  v_res := least(v.amount, coalesce(v.reserved_remaining, v.amount)
             + case when v.job_bill_state is null then greatest(0, coalesce(v.job_drawn, 0)) else 0 end);
  if v_res < v.amount and v.settled_at is null then   return jsonb_build_object('ok', false, 'reason', 'in_progress'); end if;
  if v_res <= 0 then                                   return jsonb_build_object('ok', false, 'reason', 'nothing');     end if;
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0, job_bill_state = 'refunded' where id = v.id;
  v_bought := least(coalesce(v.bought_part, 0), floor(coalesce(v.bought_part, 0)::numeric * v_res / greatest(v.amount, 1))::int);
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_res,
         bought_credits    = coalesce(bought_credits, 0) + v_bought
   where id = p_user returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'refunded', v_res, 'partial', v_res < v.amount, 'balance', v_new,
                            'late', v.created_at < now() - interval '2 hours');
end $function$;

create or replace function public.kie_job_bill(p_user uuid, p_task text, p_action text) returns jsonb
 language plpgsql security definer set search_path to 'public' as $function$
declare v_job public.kie_jobs%rowtype; v_op public.credit_ops%rowtype; v_r jsonb; v_reason text; v_res integer; v_bought integer;
begin
  if p_user is null or p_task is null or length(p_task) = 0 or p_action is null or p_action not in ('settle', 'release', 'refund') then
    return jsonb_build_object('ok', false, 'reason', 'bad_args', 'bill', null);
  end if;
  select * into v_job from public.kie_jobs where task_id = p_task and user_id = p_user for update;
  if not found then            return jsonb_build_object('ok', false, 'reason', 'no_job', 'bill', null);   end if;
  if v_job.op_id is null then  return jsonb_build_object('ok', false, 'reason', 'no_op',  'bill', 'none'); end if;

  if p_action = 'settle' then
    if v_job.bill_state is distinct from 'drawn' then return jsonb_build_object('ok', false, 'reason', 'not_drawn', 'bill', v_job.bill_state); end if;
    perform public.settle_reservation(p_user, v_job.op_id);
    update public.kie_jobs set bill_state = 'settled', billed_at = now() where task_id = p_task;
    return jsonb_build_object('ok', true, 'bill', 'settled');
  end if;

  if p_action = 'release' then
    if v_job.bill_state is distinct from 'drawn' then return jsonb_build_object('ok', false, 'reason', 'not_drawn', 'bill', v_job.bill_state); end if;
    if coalesce(v_job.drawn, 0) > 0 then perform public.release_omni_reservation(p_user, v_job.op_id, v_job.drawn, coalesce(v_job.start_img, 0)); end if;
    update public.kie_jobs set bill_state = 'released', billed_at = now() where task_id = p_task;
    return jsonb_build_object('ok', true, 'bill', 'released');
  end if;

  if v_job.bill_state not in ('drawn', 'released') then
    return jsonb_build_object('ok', false, 'reason', 'not_open', 'bill', v_job.bill_state);
  end if;
  if v_job.bill_state = 'drawn' then
    v_r := public.refund_op_terminal(p_user, v_job.op_id, greatest(1, coalesce(v_job.drawn, 1)));
    if coalesce((v_r->>'ok')::boolean, false) then
      update public.kie_jobs set bill_state = 'refunded', billed_at = now() where task_id = p_task;
      return jsonb_build_object('ok', true, 'bill', 'refunded', 'refunded', v_r->'refunded');
    end if;
    v_reason := coalesce(v_r->>'reason', 'refused');
    if v_reason in ('unknown_op', 'already_refunded') then
      update public.kie_jobs set bill_state = 'closed', bill_reason = v_reason, billed_at = now() where task_id = p_task;
      return jsonb_build_object('ok', false, 'reason', v_reason, 'bill', 'closed');
    end if;
    if coalesce(v_job.drawn, 0) > 0 then perform public.release_reservation(p_user, v_job.op_id, v_job.drawn); end if;
    update public.kie_jobs set bill_state = 'released', billed_at = now() where task_id = p_task;
  end if;

  select * into v_op from public.credit_ops where id = v_job.op_id and user_id = p_user for update;
  if not found then v_reason := 'unknown_op';
  elsif v_op.refunded_at is not null then v_reason := 'already_refunded';
  else
    v_res := coalesce(v_op.reserved_remaining, v_op.amount);
    if v_res < v_op.amount and v_op.settled_at is null then v_reason := 'in_progress';
    elsif v_res <= 0 then v_reason := 'already_delivered';
    else
      update public.credit_ops set refunded_at = now(), reserved_remaining = 0 where id = v_op.id;
      v_bought := least(coalesce(v_op.bought_part, 0), floor(coalesce(v_op.bought_part, 0)::numeric * v_res / greatest(v_op.amount, 1))::int);
      update public.profiles
         set credits_remaining = coalesce(credits_remaining, 0) + v_res,
             bought_credits    = coalesce(bought_credits, 0) + v_bought
       where id = p_user;
      update public.kie_jobs set bill_state = 'refunded', billed_at = now(),
             bill_reason = case when v_op.created_at < now() - interval '2 hours' then 'too_old' end where task_id = p_task;
      return jsonb_build_object('ok', true, 'bill', 'refunded', 'refunded', v_res, 'partial', v_res < v_op.amount,
                                'late', v_op.created_at < now() - interval '2 hours');
    end if;
  end if;
  update public.kie_jobs set bill_state = 'closed', bill_reason = v_reason, billed_at = now() where task_id = p_task;
  return jsonb_build_object('ok', false, 'reason', v_reason, 'bill', 'closed');
end $function$;

create or replace function public.mcp_refund_credits(p_user uuid, p_secs integer) returns integer
 language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_new integer; v_d public.mcp_debits%rowtype; v_rb integer := 0;
begin
  if p_secs is null or p_secs <= 0 or p_secs > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    return coalesce(v_row.credits_remaining, 0);
  end if;
  select * into v_d from public.mcp_debits
   where user_id = p_user and not refunded and job_id is null and amount >= p_secs and created_at > now() - interval '2 days'
   order by (amount = p_secs) desc, created_at desc limit 1 for update skip locked;
  if found then
    update public.mcp_debits set refunded = true where id = v_d.id;
    v_rb := least(v_d.bought, p_secs);
  end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) + p_secs,
         bought_credits    = coalesce(bought_credits,0) + v_rb,
         mcp_day_spent     = greatest(0, coalesce(mcp_day_spent,0) - p_secs)
   where id = p_user returning credits_remaining into v_new;
  return v_new;
end; $function$;

create or replace function public.mcp_credit_back_for_job(p_user uuid, p_job uuid, p_amt integer) returns integer
 language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_d public.mcp_debits%rowtype; v_rb integer := 0; v_plan integer; v_new integer;
begin
  if p_amt is null or p_amt <= 0 or p_amt > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    return coalesce(v_row.credits_remaining, 0);
  end if;
  select * into v_d from public.mcp_debits where job_id = p_job and user_id = p_user order by id desc limit 1 for update;
  if found then
    -- part abonnement encore à rendre, puis seulement le reste en crédits achetés
    v_plan := greatest(0, (v_d.amount - v_d.bought) - (v_d.refunded_amt - v_d.refunded_bought));
    v_rb := least(greatest(v_d.bought - v_d.refunded_bought, 0), greatest(0, p_amt - v_plan));
    update public.mcp_debits
       set refunded_amt = refunded_amt + p_amt, refunded_bought = refunded_bought + v_rb,
           refunded = (refunded_amt + p_amt) >= amount
     where id = v_d.id;
  else
    -- job antérieur au rattachement : ancienne heuristique (débit récent du même montant)
    return public.mcp_refund_credits(p_user, p_amt);
  end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) + p_amt,
         bought_credits    = coalesce(bought_credits,0) + v_rb,
         mcp_day_spent     = greatest(0, coalesce(mcp_day_spent,0) - p_amt)
   where id = p_user returning credits_remaining into v_new;
  return v_new;
end $function$;

create or replace function public.claim_retention_bonus(p_reason text) returns integer
 language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_new integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_row from public.profiles where id = auth.uid() for update;
  if not found then return -1; end if;
  if lower(coalesce(v_row.plan,'free')) = 'free' then return -1; end if;
  if coalesce(v_row.retention_bonus_used, false) then return -1; end if;
  if coalesce(v_row.whop_cancel_at_period_end, false) then return -1; end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) + 25,
         retention_bonus_used = true
   where id = auth.uid()
   returning credits_remaining into v_new;
  insert into public.cancellation_feedback (user_id, email, plan, reason, outcome)
  values (auth.uid(), v_row.email, v_row.plan, p_reason, 'kept_bonus');
  return v_new;
end;
$function$;

-- Historique (20261015120000_credit_history.sql, identique en ligne)
alter table public.credit_ops add column if not exists refunded_amount integer;
create or replace function public.credit_hist_mark_op() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform set_config('aa.ledger', 'op', true);
    if tg_table_name = 'credit_ops' and tg_op = 'UPDATE' and new.refunded_at is not null and old.refunded_at is null then
      perform set_config('aa.refund_op', new.id::text, true);
    end if;
  exception when others then null;
  end;
  return null;
end $$;
create trigger credit_hist_mark_ins after insert on public.credit_ops for each row execute function public.credit_hist_mark_op();
create trigger credit_hist_mark_upd after update of refunded_at on public.credit_ops for each row execute function public.credit_hist_mark_op();
create trigger credit_hist_mark_mcp after insert or update on public.mcp_debits for each row execute function public.credit_hist_mark_op();
create or replace function public.credit_hist_refund_amount() returns trigger language plpgsql security definer set search_path = public as $$
declare v_op text;
begin
  begin
    v_op := nullif(current_setting('aa.refund_op', true), '');
    if v_op is not null and coalesce(new.credits_remaining, 0) > coalesce(old.credits_remaining, 0) then
      update public.credit_ops set refunded_amount = coalesce(new.credits_remaining, 0) - coalesce(old.credits_remaining, 0)
       where id = v_op::uuid and user_id = new.id and refunded_amount is null;
      perform set_config('aa.refund_op', '', true);
    end if;
  exception when others then null;
  end;
  return null;
end $$;
create trigger credit_hist_refund_amount after update of credits_remaining on public.profiles
  for each row execute function public.credit_hist_refund_amount();
create or replace function public.credit_hist_event() returns trigger
 language plpgsql security definer set search_path to 'public' as $function$
declare
  v_old integer; v_new integer; v_delta integer; v_kind text; v_label text;
  p_old text; p_new text; v_force text;
  lbl constant jsonb := '{"starter":"Starter","pro":"Pro","elite":"Élite","developer":"Développeur","free":"Free"}';
begin
  begin
    if coalesce(current_setting('aa.ledger', true), '') <> '' then return null; end if;
    v_new := coalesce(new.credits_remaining, 0);
    v_old := case when tg_op = 'INSERT' then 0 else coalesce(old.credits_remaining, 0) end;
    v_delta := v_new - v_old;
    if v_delta = 0 then return null; end if;
    p_new := lower(coalesce(new.plan, 'free'));
    p_old := case when tg_op = 'INSERT' then 'free' else lower(coalesce(old.plan, 'free')) end;
    v_force := nullif(current_setting('aa.credit_label', true), '');   -- geste à la main : select set_config('aa.credit_label', '…', true)

    if v_force is not null then v_kind := case when v_delta > 0 then 'cadeau' else 'ajustement' end; v_label := v_force;
    elsif tg_op = 'INSERT' then
      v_kind := 'achat'; v_label := 'Achat fait avant la création du compte';
    elsif p_old = 'free' and p_new <> 'free' then
      v_kind := 'abonnement';
      v_label := 'Abonnement ' || coalesce(lbl->>p_new, p_new) || ' activé'
        || case when coalesce(new.first_sub_bonus_used, false) and not coalesce(old.first_sub_bonus_used, false) then ' (bonus de bienvenue inclus)' else '' end;
    elsif p_old <> 'free' and p_new = 'free' then
      v_kind := 'fin'; v_label := 'Fin de l''abonnement ' || coalesce(lbl->>p_old, p_old);
    elsif p_old <> p_new then
      v_kind := 'changement'; v_label := 'Passage au plan ' || coalesce(lbl->>p_new, p_new)
        || case when coalesce(new.first_sub_bonus_used, false) and not coalesce(old.first_sub_bonus_used, false) then ' (bonus de bienvenue inclus)' else '' end;
    elsif coalesce(new.retention_bonus_used, false) and not coalesce(old.retention_bonus_used, false) then
      v_kind := 'cadeau'; v_label := 'Cadeau de fidélité';
    elsif v_delta > 0 and coalesce(new.bought_credits, 0) - coalesce(old.bought_credits, 0) = v_delta then
      v_kind := 'pack'; v_label := 'Pack de crédits';
    elsif v_delta < 0 and coalesce(new.bought_credits, 0) < coalesce(old.bought_credits, 0) and p_new = p_old and new.credits_total is not distinct from old.credits_total then
      v_kind := 'retrait'; v_label := 'Crédits d''un pack remboursé retirés';
    elsif p_new <> 'free' and new.credits_total is not distinct from old.credits_total and coalesce(new.credits_total, 0) > 0 then
      v_kind := 'renouvellement'; v_label := 'Renouvellement ' || coalesce(lbl->>p_new, p_new) || ' (crédits du mois)';
    else
      v_kind := 'ajustement'; v_label := 'Ajustement du solde';
    end if;

    insert into public.credit_events (user_id, kind, delta, balance_after, plan, label)
    values (new.id, v_kind, v_delta, v_new, p_new, v_label);
  exception when others then null;
  end;
  return null;
end $function$;
create constraint trigger credit_hist_event after insert or update of credits_remaining on public.profiles
  deferrable initially deferred for each row execute function public.credit_hist_event();

-- Droits EN LIGNE (has_function_privilege du 24/10)
revoke all on function public.refund_op_terminal(uuid,uuid,integer), public.refund_by_job_terminal(uuid,text), public.refund_job_open(uuid,text),
  public.kie_job_bill(uuid,text,text), public.mcp_refund_credits(uuid,integer), public.mcp_credit_back_for_job(uuid,uuid,integer),
  public.credit_hist_event(), public.credit_hist_mark_op(), public.credit_hist_refund_amount() from public, anon, authenticated;
revoke all on function public.spend_credits(integer,text), public.refund_credits(uuid), public.claim_retention_bonus(text) from public, anon;
`

const MIG = await Deno.readTextFile(Deno.args[0] ?? new URL('../../supabase/migrations/20261024010000_resiliation_atomique.sql', import.meta.url))
const U = '00000000-0000-4000-8000-000000000001'
const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); if (!c) console.log('  ✗ ' + n + ' — ' + d) }

type Base = { db: PGlite; migree: boolean }
async function base(migree: boolean): Promise<Base> {
  const db = new PGlite()
  await db.exec(ENLIGNE)
  if (migree) await db.exec(MIG)
  return { db, migree }
}
const q1 = async (b: Base, sql: string, p: unknown[] = []) => (await b.db.query<any>(sql, p)).rows[0]
async function compte(b: Base, c: number, bought: number, extra = '') {
  await b.db.exec(`delete from public.profiles; delete from public.credit_ops; delete from public.mcp_debits; delete from public.kie_jobs; delete from public.credit_events`)
  await b.db.query(`insert into public.profiles (id, email, plan, credits_remaining, credits_total, bought_credits, whop_member_id)
                    values ($1, 'client@test.fr', 'starter', $2, 150, $3, 'mem_plan')`, [U, c, bought])
  if (extra) await b.db.query(extra)
}
const solde = async (b: Base) => { const r = await q1(b, `select credits_remaining c, bought_credits b, whop_cancel_at_period_end f from public.profiles where id = $1`, [U]); return { c: r.c as number, b: r.b as number, f: r.f as boolean } }
const commeClient = (b: Base) => b.db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [U])
// PGlite date à la milliseconde (Postgres en ligne : à la microseconde) : une pause sépare les étapes qui se suivent
const pause = () => new Promise((r) => setTimeout(r, 3))
async function depense(b: Base, n: number): Promise<string> { await commeClient(b); const op = (await q1(b, `select public.spend_credits($1, 'test') r`, [n])).r.op_id; await pause(); return op }
async function rembourse(b: Base, op: string) { await commeClient(b); return (await q1(b, `select public.refund_credits($1) r`, [op])).r }
// Résiliation telle que whop-cancel la fait : A = valeurs lues AVANT l'appel Whop puis réécrites, B = la RPC en base
async function resilie(b: Base, luAvantWhop: { c: number; b: number }, pendantWhop: () => Promise<unknown> = async () => {}) {
  await pause(); await pendantWhop()
  if (!b.migree) {
    const garde = Math.min(luAvantWhop.b || 0, luAvantWhop.c || 0)
    await b.db.query(`update public.profiles set whop_cancel_at_period_end = true, credits_remaining = $2, bought_credits = $2 where id = $1`, [U, garde])
    return { ok: true, kept: garde, removed: Math.max(0, luAvantWhop.c - garde) }
  }
  const r = (await q1(b, `select public.cancel_remove_plan_credits($1) r`, [U])).r
  await pause(); return r
}
const reactive = (b: Base) => b.db.query(`update public.profiles set whop_cancel_at_period_end = false where id = $1`, [U])

for (const migree of [false, true]) {
  const T = migree ? 'B' : 'A', b = await base(migree)

  // 1) Constat 1 : Starter 150 + Pack S 120 = 270 dont 120 achetés. Tout le solde est débité PENDANT l'appel Whop, puis
  //    remboursé ; résilier / réactiver, et on recommence.
  await compte(b, 270, 120)
  let op = ''
  for (let tour = 1; tour <= 3; tour++) {
    const lu = await solde(b)
    await resilie(b, lu, async () => { op = await depense(b, lu.c) })
    await rembourse(b, op)
    await reactive(b)
  }
  let s = await solde(b)
  if (migree) ok(`${T} constat 1 : 3 tours annuler / réactiver → toujours 120 achetés, rien de créé`, s.c === 120 && s.b === 120, JSON.stringify(s))
  else ok(`${T} constat 1 reproduit : les crédits achetés doublent à chaque tour (120 → 240 → 480 → 960)`, s.b === 960 && s.c === 1110, JSON.stringify(s))

  // 2) Sans course : tout débiter AVANT de résilier, se rembourser APRÈS
  await compte(b, 270, 120)
  op = await depense(b, 270)
  await resilie(b, await solde(b))
  const r2 = await rembourse(b, op); s = await solde(b)
  if (migree) ok(`${T} débit avant, remboursement après : seule la part achetée revient (120/120)`, s.c === 120 && s.b === 120 && r2.ok === true && r2.refunded === 120 && r2.partial === true, JSON.stringify([s, r2]))
  else ok(`${T} débit avant, remboursement après : les 150 crédits du plan survivent à la résiliation`, s.c === 270 && s.b === 120, JSON.stringify(s))

  // 3) Les autres chemins de remboursement (proxys, kie, MCP) : même règle
  const chemins: [string, (op: string) => Promise<unknown>, string][] = [
    ['refund_op_terminal', (o) => q1(b, `select public.refund_op_terminal($1, $2, 1) r`, [U, o]), ''],
    ['refund_by_job_terminal', () => q1(b, `select public.refund_by_job_terminal($1, 'job1') r`, [U]), `update public.credit_ops set provider_job = 'job1'`],
    ['refund_job_open', () => q1(b, `select public.refund_job_open($1, 'job2') r`, [U]), `update public.credit_ops set provider_job = 'job2', job_drawn = amount, reserved_remaining = 0`],
    ['kie_job_bill refund', () => q1(b, `select public.kie_job_bill($1, 'task1', 'refund') r`, [U]), `insert into public.kie_jobs (task_id, user_id, op_id, bill_state) select 'task1', user_id, id, 'released' from public.credit_ops`],
  ]
  for (const [nom, appel, prep] of chemins) {
    await compte(b, 270, 120)
    op = await depense(b, 270)
    if (prep) await b.db.query(prep)
    await resilie(b, await solde(b))
    await appel(op); s = await solde(b)
    if (migree) ok(`${T} ${nom} après résiliation : part achetée seulement`, s.c === 120 && s.b === 120, JSON.stringify(s))
    else ok(`${T} ${nom} après résiliation : tout revient (défaut)`, s.c === 270, JSON.stringify(s))
  }
  // MCP : débit de 270 dont 120 achetés rattaché à un job, puis échec du job après la résiliation
  for (const [nom, sql, jobId] of [['mcp_credit_back_for_job', `select public.mcp_credit_back_for_job($1, $2, 270) r`, '00000000-0000-4000-8000-0000000000aa'],
                                    ['mcp_refund_credits', `select public.mcp_refund_credits($1, 270) r`, null]] as [string, string, string | null][]) {
    await compte(b, 0, 0, `insert into public.mcp_debits (user_id, amount, bought, job_id) values ('${U}', 270, 120, ${jobId ? `'${jobId}'` : 'null'})`)
    await resilie(b, await solde(b))
    await q1(b, sql, jobId ? [U, jobId] : [U]); s = await solde(b)
    const d = await q1(b, `select refunded_amt, refunded from public.mcp_debits`)
    if (migree) ok(`${T} ${nom} après résiliation : part achetée seulement`, s.c === 120 && s.b === 120 && (jobId ? d.refunded_amt === 120 : true), JSON.stringify([s, d]))
    else ok(`${T} ${nom} après résiliation : tout revient (défaut)`, s.c === 270, JSON.stringify(s))
  }
  // MCP remboursé en PLUSIEURS fois (relecture du 24/10) : débit de 100 dont 40 achetés, rattaché à un job, fait AVANT la
  // résiliation, remboursé APRÈS en deux temps (mcp_job_partial_refund puis mcp_job_fail_refund, chemin réel du MCP).
  // Le 1er correctif réécrivait p_amt AVANT de le journaliser : la part plan n'était jamais close et les crédits ACHETÉS ne
  // revenaient plus (0/0 au lieu de 40/40 pour 50 + 50, 10 au lieu de 40 pour 70 + 30).
  const JOB = '00000000-0000-4000-8000-0000000000bb'
  const debitJob = `insert into public.mcp_debits (user_id, amount, bought, job_id) values ('${U}', 100, 40, '${JOB}')`
  const rendJob = (n: number) => q1(b, `select public.mcp_credit_back_for_job($1, $2, $3) r`, [U, JOB, n])
  const journal = () => q1(b, `select refunded_amt, refunded_bought, refunded from public.mcp_debits`)
  for (const [x, y] of [[50, 50], [70, 30], [30, 70]]) {
    await compte(b, 0, 0, debitJob)
    await resilie(b, await solde(b))
    await rendJob(x); await rendJob(y); s = await solde(b); const d = await journal()
    if (migree) ok(`${T} MCP ${x} puis ${y} après résiliation : les 40 achetés reviennent (40/40), journal = ce qui est revenu`,
      s.c === 40 && s.b === 40 && d.refunded_amt === 40 && d.refunded_bought === 40 && d.refunded === false, JSON.stringify([s, d]))
    else ok(`${T} MCP ${x} puis ${y} après résiliation : tout revient (défaut)`, s.c === 100 && s.b === 40, JSON.stringify([s, d]))
  }
  // 50 rendus AVANT la résiliation (crédits du plan, retirés ensuite par elle), 50 APRÈS : les 40 achetés reviennent
  await compte(b, 0, 0, debitJob)
  await rendJob(50); await resilie(b, await solde(b)); await rendJob(50); s = await solde(b)
  let dj = await journal()
  if (migree) ok(`${T} MCP 50 avant, 50 après la résiliation : 40/40, journal = 90 revenus`, s.c === 40 && s.b === 40 && dj.refunded_amt === 90 && dj.refunded_bought === 40, JSON.stringify([s, dj]))
  else ok(`${T} MCP 50 avant, 50 après la résiliation : 10 crédits du plan survivent (défaut)`, s.c === 50 && s.b === 40, JSON.stringify([s, dj]))
  // tout le débit fait de crédits du plan : rien ne revient, et le journal ne dit pas « remboursé »
  await compte(b, 0, 0, `insert into public.mcp_debits (user_id, amount, bought, job_id) values ('${U}', 100, 0, '${JOB}')`)
  await resilie(b, await solde(b)); await rendJob(60); await rendJob(40); s = await solde(b); dj = await journal()
  if (migree) ok(`${T} MCP débit 100 % plan, 60 puis 40 après résiliation : rien ne revient, rien d'affiché comme remboursé`, s.c === 0 && s.b === 0 && dj.refunded_amt === 0 && dj.refunded === false, JSON.stringify([s, dj]))
  // débit fait APRÈS la résiliation (réactivée) : remboursé en entier, en deux fois aussi
  if (migree) {
    await compte(b, 0, 0)
    await resilie(b, await solde(b)); await reactive(b); await pause()
    await b.db.query(debitJob)
    await rendJob(50); await rendJob(50); s = await solde(b); dj = await journal()
    ok(`${T} MCP débit postérieur, 50 puis 50 : tout revient (100/40), débit clos`, s.c === 100 && s.b === 40 && dj.refunded_amt === 100 && dj.refunded === true, JSON.stringify([s, dj]))
  }

  if (!migree) continue
  // 4) Débit APRÈS la résiliation (réactivée, renouvelée) : remboursement complet, rien n'est bridé à tort
  await compte(b, 270, 120)
  await resilie(b, await solde(b)); await reactive(b)
  await b.db.query(`update public.profiles set credits_remaining = credits_remaining + 150 where id = $1`, [U])   // renouvellement : 150 du plan
  op = await depense(b, 270)
  const r4 = await rembourse(b, op); s = await solde(b)
  ok('B débit fait après la résiliation : remboursé en entier', s.c === 270 && s.b === 120 && r4.refunded === 270, JSON.stringify([s, r4]))
  op = await depense(b, 270)
  const r4b = await q1(b, `select public.refund_op_terminal($1, $2, 1) r`, [U, op]); s = await solde(b)
  ok('B refund_op_terminal d\'un débit postérieur : en entier', s.c === 270 && s.b === 120 && r4b.r.refunded === 270, JSON.stringify([s, r4b]))

  // 5) La RPC : kept / removed, déjà résilié, profil inconnu, achetés > solde, prioritaire mémorisé
  await compte(b, 270, 120)
  let r = await q1(b, `select public.cancel_remove_plan_credits($1, 'mem_prio') r`, [U]); s = await solde(b)
  const p5 = await q1(b, `select cancel_requested_at is not null t, prio_cancel_member_id m from public.profiles where id = $1`, [U])
  ok('B RPC : kept 120 / removed 150, drapeau posé, date et prioritaire mémorisés', r.r.ok === true && r.r.kept === 120 && r.r.removed === 150 && s.c === 120 && s.b === 120 && s.f === true && p5.t === true && p5.m === 'mem_prio', JSON.stringify([r, s, p5]))
  r = await q1(b, `select public.cancel_remove_plan_credits($1) r`, [U]); s = await solde(b)
  ok('B RPC rejouée : « already », rien ne bouge (prioritaire gardé)', r.r.ok === false && r.r.reason === 'already' && s.c === 120 && (await q1(b, `select prio_cancel_member_id m from public.profiles`)).m === 'mem_prio', JSON.stringify([r, s]))
  r = await q1(b, `select public.cancel_remove_plan_credits('00000000-0000-4000-8000-0000000000ff') r`)
  ok('B RPC sur un compte inconnu : no_profile', r.r.ok === false && r.r.reason === 'no_profile', JSON.stringify(r))
  await compte(b, 300, 500)
  r = await q1(b, `select public.cancel_remove_plan_credits($1) r`, [U]); s = await solde(b)
  ok('B achetés supérieurs au solde : bornés au solde (300/300), rien retiré', r.r.kept === 300 && r.r.removed === 0 && s.c === 300 && s.b === 300, JSON.stringify([r, s]))
  await compte(b, 270, 120)
  await resilie(b, await solde(b)); await reactive(b)
  const avant = (await q1(b, `select cancel_requested_at::text t from public.profiles`)).t
  await resilie(b, await solde(b))
  const apres = await q1(b, `select cancel_requested_at > $1::timestamptz x from public.profiles`, [avant])
  ok('B 2e résiliation après réactivation : rien de plus retiré, date avancée', (await solde(b)).c === 120 && apres.x === true, JSON.stringify(apres))
  // « already » (relecture du 24/10) : solde relu sous le verrou, départ (retour + e-mail à Axel) signalé UNE fois par résiliation
  await compte(b, 270, 120)
  const r5a = (await q1(b, `select public.cancel_remove_plan_credits($1) r`, [U])).r
  const r5b = (await q1(b, `select public.cancel_remove_plan_credits($1, 'mem_prio') r`, [U])).r
  const p5b = await q1(b, `select prio_cancel_member_id m from public.profiles`)
  ok('B double clic : la 1re demande signale le départ ; la 2e « already » avec le solde, sans 2e signalement, son prioritaire noté',
    r5a.ok === true && r5a.notify === true && r5b.ok === false && r5b.reason === 'already' && r5b.kept === 120 && r5b.notify === false && p5b.m === 'mem_prio', JSON.stringify([r5a, r5b, p5b]))
  // résiliation posée juste avant par le webhook Whop de CETTE résiliation (whop_webhook_resiliation, 20261024020000 :
  // drapeau + date, rien de signalé) : la demande de l'app enregistre quand même le départ, une seule fois
  await compte(b, 270, 120)
  await b.db.query(`update public.profiles set credits_remaining = 120, whop_cancel_at_period_end = true, cancel_requested_at = clock_timestamp() where id = $1`, [U])
  const r5c = (await q1(b, `select public.cancel_remove_plan_credits($1, 'mem_prio') r`, [U])).r
  const r5d = (await q1(b, `select public.cancel_remove_plan_credits($1) r`, [U])).r
  ok('B webhook Whop arrivé avant la RPC : « already », solde 120, départ signalé une fois, prioritaire noté',
    r5c.reason === 'already' && r5c.kept === 120 && r5c.notify === true && r5d.notify === false && (await solde(b)).c === 120
    && (await q1(b, `select prio_cancel_member_id m from public.profiles`)).m === 'mem_prio', JSON.stringify([r5c, r5d]))

  // 6) Historique : le retrait s'affiche comme une résiliation, plus comme un renouvellement
  await compte(b, 270, 120)
  await b.db.query(`delete from public.credit_events`)
  await resilie(b, await solde(b))
  const ev = await q1(b, `select kind, delta, label from public.credit_events where user_id = $1 order by id desc limit 1`, [U])
  ok('B historique : « Résiliation : crédits du plan retirés », −150', ev?.kind === 'resiliation' && ev?.delta === -150 && /^Résiliation : crédits du plan retirés$/.test(ev?.label), JSON.stringify(ev))
  await reactive(b)
  await b.db.query(`update public.profiles set credits_remaining = credits_remaining + 150 where id = $1`, [U])
  const ev2 = await q1(b, `select kind, delta from public.credit_events where user_id = $1 order by id desc limit 1`, [U])
  ok('B historique : un vrai renouvellement reste « renouvellement »', ev2?.kind === 'renouvellement' && ev2?.delta === 150, JSON.stringify(ev2))
  await b.db.query(`update public.profiles set credits_remaining = credits_remaining - 10 where id = $1`, [U])
  const ev3 = await q1(b, `select kind from public.credit_events where user_id = $1 order by id desc limit 1`, [U])
  ok('B historique : une baisse inexpliquée n\'est plus un « renouvellement »', ev3?.kind === 'ajustement', JSON.stringify(ev3))

  // 7) Droits : rien d'ouvert au client
  const dr = await q1(b, `select has_function_privilege('authenticated', 'public.cancel_remove_plan_credits(uuid,text)', 'EXECUTE') a1,
      has_function_privilege('anon', 'public.cancel_remove_plan_credits(uuid,text)', 'EXECUTE') a2,
      has_function_privilege('authenticated', 'public.plan_credits_removed_since(uuid,timestamptz)', 'EXECUTE') a3,
      has_function_privilege('service_role', 'public.cancel_remove_plan_credits(uuid,text)', 'EXECUTE') s1,
      has_function_privilege('authenticated', 'public.refund_credits(uuid)', 'EXECUTE') c1,
      has_function_privilege('authenticated', 'public.refund_op_terminal(uuid,uuid,integer)', 'EXECUTE') c2`)
  ok('B droits : RPC et garde fermées au client, ouvertes à service_role ; refund_credits inchangé', !dr.a1 && !dr.a2 && !dr.a3 && dr.s1 && dr.c1 && !dr.c2, JSON.stringify(dr))

  // 8) Constat 42 : cadeau +25 pris, débité, résiliation, remboursement → le cadeau ne revient pas
  await compte(b, 150, 0)
  await commeClient(b); await q1(b, `select public.claim_retention_bonus('test') r`)
  op = await depense(b, 175)
  await resilie(b, await solde(b))
  await rembourse(b, op); s = await solde(b)
  ok('B cadeau +25 débité avant la résiliation puis remboursé : rien ne revient', s.c === 0 && s.b === 0, JSON.stringify(s))

  // 9) La migration refuse de s'appliquer si une fonction en ligne a changé (texte attendu introuvable)
  const b2 = await base(false)
  await b2.db.exec(`create or replace function public.refund_job_open(p_user uuid, p_job text) returns jsonb language plpgsql security definer as $f$ begin return null; end $f$`)
  let refus = ''
  try { await b2.db.exec(MIG) } catch (e) { refus = String((e as Error).message) }
  const rien = await q1(b2, `select count(*)::int n from pg_proc where proname = 'cancel_remove_plan_credits'`)
  ok('B migration sur une fonction changée : refusée en bloc, rien appliqué', /introuvable ou ambigu/.test(refus) && rien.n === 0, refus + ' / ' + JSON.stringify(rien))
}

const ko = res.filter((x) => !x[1])
console.log(`\n${res.length - ko.length}/${res.length} vérifications OK`)
if (ko.length) Deno.exit(1)
