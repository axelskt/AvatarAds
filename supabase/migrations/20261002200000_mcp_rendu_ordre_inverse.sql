-- Relecture 02/10 : un remboursement rend d'abord la part ABONNEMENT du débit, puis la part ACHETÉE (ordre inverse de la
-- consommation : mcp_spend_credits prend les achetés en premier). Avant, un remboursement PARTIEL (repli Motion 3.0 → 2.6,
-- Topaz raté, photo Express) rendait des crédits achetés alors que la consommation nette aurait dû les épuiser.
-- Remboursement total : résultat inchangé.
create or replace function public.mcp_credit_back_for_job(p_user uuid, p_job uuid, p_amt integer)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
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
revoke all on function public.mcp_credit_back_for_job(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.mcp_credit_back_for_job(uuid, uuid, integer) to service_role;
