-- 03/09/2026 (Axel) : les crédits ACHETÉS en pack sont dépensés EN PREMIER, avant ceux du plan.
-- Chaque opération mémorise la part payée avec des crédits achetés (bought_part), rendue au remboursement.
-- (Appliquée en prod via MCP apply_migration « credits_bought_spent_first » — copie pour l'historique du repo.)
alter table public.credit_ops add column if not exists bought_part integer not null default 0;

create or replace function public.spend_credits(p_secs integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.profiles%rowtype; v_new integer; v_charged integer; v_bought integer := 0; v_op uuid;
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
    v_bought := least(coalesce(v_row.bought_credits,0), p_secs);           -- achetés d'abord, puis le plan
    update public.profiles
       set credits_remaining = coalesce(credits_remaining,0) - p_secs,
           bought_credits    = greatest(0, coalesce(bought_credits,0) - p_secs)
     where id = auth.uid() returning credits_remaining into v_new;
    v_charged := p_secs;
  end if;
  insert into public.credit_ops (user_id, amount, reason, bought_part)
  values (auth.uid(), v_charged, left(coalesce(p_reason,''), 80), v_bought) returning id into v_op;
  return jsonb_build_object('ok', true, 'balance', v_new, 'op_id', v_op);
end; $$;

create or replace function public.refund_credits(p_op_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_op public.credit_ops%rowtype; v_new integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_op from public.credit_ops where id = p_op_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown_op'); end if;
  if v_op.refunded_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old'); end if;
  update public.credit_ops set refunded_at = now() where id = v_op.id;
  if v_op.amount > 0 then
    update public.profiles                                                    -- rend le montant ET la part achetée
       set credits_remaining = coalesce(credits_remaining,0) + v_op.amount,
           bought_credits    = coalesce(bought_credits,0) + coalesce(v_op.bought_part,0)
     where id = auth.uid() returning credits_remaining into v_new;
  else
    select credits_remaining into v_new from public.profiles where id = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end; $$;

create or replace function public.mcp_spend_credits(p_user uuid, p_secs integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_row public.profiles%rowtype; v_new integer;
begin
  if p_secs is null or p_secs <= 0 or p_secs > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then return coalesce(v_row.credits_remaining, 0); end if;
  if coalesce(v_row.credits_remaining,0) < p_secs then return -1; end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) - p_secs,
         bought_credits    = greatest(0, coalesce(bought_credits,0) - p_secs)              -- achetés d'abord
   where id = p_user returning credits_remaining into v_new;
  return v_new;
end; $$;
