-- RÉSERVATION DE CRÉDITS (audit offensif 05/09 — corrige refund-and-keep + débit découplé du coût).
-- Modèle : chaque op de spend_credits est une RÉSERVATION (reserved_remaining = montant débité). Un proxy
-- fournisseur « tire » (draw_reservation) le coût de CHAQUE soumission facturante sur cette réservation
-- (refus si le reste est insuffisant → un débit sous-évalué ne couvre pas une génération chère). Quand une
-- génération ABOUTIT, le proxy « règle » la réservation (settle_reservation) → l'op devient NON remboursable
-- (fin du refund-and-keep : on ne rembourse qu'une op non livrée). Le remboursement légitime (échec) reste
-- possible tant que l'op n'est pas réglée.
--
-- ADDITIF et sûr : reserved_remaining = montant pour les ops existantes ; settled_at NULL → remboursables
-- comme avant. draw/settle sont service_role only (les proxies). L'enforcement du montant est piloté par le
-- secret RESERVE_ENFORCE côté edge (mode ombre au départ) ; le refus de remboursement d'une op réglée, lui,
-- est actif dès maintenant (il ne peut jamais bloquer un remboursement d'échec, qui n'est jamais réglé).

alter table public.credit_ops add column if not exists reserved_remaining integer;
alter table public.credit_ops add column if not exists settled_at timestamptz;
update public.credit_ops set reserved_remaining = amount where reserved_remaining is null;

-- spend_credits : initialise reserved_remaining = montant débité (le reste identique).
create or replace function public.spend_credits(p_secs integer, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
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
    v_bought := least(coalesce(v_row.bought_credits,0), p_secs);
    update public.profiles
       set credits_remaining = coalesce(credits_remaining,0) - p_secs,
           bought_credits    = greatest(0, coalesce(bought_credits,0) - p_secs)
     where id = auth.uid() returning credits_remaining into v_new;
    v_charged := p_secs;
  end if;
  insert into public.credit_ops (user_id, amount, reason, bought_part, reserved_remaining)
  values (auth.uid(), v_charged, left(coalesce(p_reason,''), 80), v_bought, v_charged)
  returning id into v_op;
  return jsonb_build_object('ok', true, 'balance', v_new, 'op_id', v_op);
end;
$function$;

-- refund_credits : REFUSE une op déjà RÉGLÉE (settled = génération livrée). Le reste identique.
create or replace function public.refund_credits(p_op_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_op public.credit_ops%rowtype; v_new integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_op from public.credit_ops where id = p_op_id and user_id = auth.uid() for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'unknown_op');        end if;
  if v_op.refunded_at is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_refunded');  end if;
  if v_op.settled_at  is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_delivered'); end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');           end if;
  update public.credit_ops set refunded_at = now() where id = v_op.id;
  if v_op.amount > 0 then
    update public.profiles
       set credits_remaining = coalesce(credits_remaining,0) + v_op.amount,
           bought_credits    = coalesce(bought_credits,0) + coalesce(v_op.bought_part,0)
     where id = auth.uid() returning credits_remaining into v_new;
  else
    select credits_remaining into v_new from public.profiles where id = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end;
$function$;

-- draw_reservation : un proxy tire p_cost sur la réservation d'une op (service_role only). NULL = refusé
-- (op introuvable, mauvais user, déjà remboursée, ou reste insuffisant). N'affecte PAS settled → un flux
-- multi-scènes peut tirer plusieurs fois sur la même op.
create or replace function public.draw_reservation(p_user uuid, p_op uuid, p_cost integer)
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_rem integer; v_c integer := greatest(1, coalesce(p_cost, 1));
begin
  update public.credit_ops
     set reserved_remaining = reserved_remaining - v_c
   where id = p_op and user_id = p_user and refunded_at is null
     and coalesce(reserved_remaining, amount) >= v_c
   returning reserved_remaining into v_rem;
  return v_rem;
end $$;

-- settle_reservation : marque l'op livrée (non remboursable), idempotent. Appelée par le proxy quand une
-- génération ABOUTIT (poll COMPLETED). Ne règle jamais une op déjà remboursée.
create or replace function public.settle_reservation(p_user uuid, p_op uuid)
returns boolean language plpgsql security definer set search_path to 'public'
as $$
begin
  update public.credit_ops set settled_at = coalesce(settled_at, now())
   where id = p_op and user_id = p_user and refunded_at is null;
  return found;
end $$;

revoke all on function public.draw_reservation(uuid, uuid, integer)   from public, anon, authenticated;
revoke all on function public.settle_reservation(uuid, uuid)          from public, anon, authenticated;
grant execute on function public.draw_reservation(uuid, uuid, integer) to service_role;
grant execute on function public.settle_reservation(uuid, uuid)        to service_role;
