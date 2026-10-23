-- 23/10/2026 (Axel) : variantes Whop « abonnement + pack remisé » de la page de paiement (paiement.html), payées en UN seul
-- paiement (whop-webhook, VARIANTES). Elles portent le palier et les crédits de leur abonnement de base : handle_new_user
-- doit les reconnaître quand un achat SANS compte attend dans pending_activations (le webhook crée normalement le compte
-- d'abord ; ce cas ne sert qu'en repli) :
--   · période : les variantes annuelles sont des plans annuels (370 jours de marge, pas 35) ;
--   · part « plan » d'une ligne périmée : celle du palier de base, le reste (pack compris) est gardé comme un pack.
-- Copie de la définition du 03/10 (20261003020000_audit_p1_paiements.sql), listes de plans complétées seulement.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare pa public.pending_activations%rowtype;
        v_pending boolean;
        v_sub integer;
begin
  select * into pa from public.pending_activations where lower(email) = lower(new.email);
  v_pending := found;
  -- Audit 02/10 (PAY-1) : abonnement en attente PÉRIMÉ (dernier paiement > 1 période + marge) → le PLAN est ignoré.
  -- Seuls les crédits de packs achetés sans compte (payés une fois, ils n'expirent pas) sont gardés : la ligne est
  -- ramenée à un pack seul, exactement comme whop-webhook le fait à la résiliation (pendingPackLeft). Elle est ensuite
  -- consommée normalement (supprimée) : aucun autre trigger (héritage apply_pending_activation) ne peut la réappliquer.
  if v_pending and pa.plan is not null and pa.plan <> 'free'
     and coalesce(pa.paid_at, '-infinity'::timestamptz) < now() - (case   -- parenthèses : sinon le IF s'arrête au 1er THEN
           when pa.whop_plan_id in ('plan_cNydK89X39PLE', 'plan_P7WIywSa6YrxT', 'plan_OvRwm5CW3xcNh',
                                    'plan_uWTkJDl1GvxNR', 'plan_x2kDWR6ur2W5E',   -- annuels, synchro SUB_MAP (whop-webhook)
                                    'plan_NcMairMUEz3ST', 'plan_iATzKyUuANyfI', 'plan_QF7HXCR81yXRy', 'plan_5RTUZOJ3sGCXd',
                                    'plan_QaAyO2Msc11Xk', 'plan_tAKWwP8U88eTT', 'plan_xzr5jL4TCAlWf')   -- variantes annuelles
             then interval '370 days'
           else interval '35 days' end) then
    -- crédits du plan + bonus 1er abonnement inclus dans pa.credits (SUB_MAP + FIRST_SUB_BONUS de whop-webhook) ;
    -- plan Whop hors catalogue → part pack inconnue → 0 (prudence, comme le webhook).
    v_sub := case
      when pa.whop_plan_id in ('plan_YKcdyPT6RRQSi', 'plan_cNydK89X39PLE',
                               'plan_blQtyUh90R2wP', 'plan_NcMairMUEz3ST') then 150 + 25    -- Starter
      when pa.whop_plan_id in ('plan_g4BVtDmk6hgjQ', 'plan_P7WIywSa6YrxT', 'plan_hE8bkwTPoTkrj', 'plan_0iHH0kY3uoJpo',
                               'plan_iATzKyUuANyfI', 'plan_QF7HXCR81yXRy') then 550 + 50    -- Pro
      when pa.whop_plan_id in ('plan_w8lh5zpEJFOQR', 'plan_OvRwm5CW3xcNh', 'plan_wn7ZntgBemFL0', 'plan_i7ubxuFfVHQ5k',
                               'plan_5RTUZOJ3sGCXd', 'plan_QaAyO2Msc11Xk') then 1100 + 75   -- Élite30
      when pa.whop_plan_id in ('plan_pZmWh1dVdmIWT', 'plan_uWTkJDl1GvxNR',
                               'plan_th1REeLIfRP50', 'plan_tAKWwP8U88eTT') then 2200 + 75   -- Élite60
      when pa.whop_plan_id in ('plan_63PGeG3MesbJR', 'plan_x2kDWR6ur2W5E',
                               'plan_xN9BOWCvFUWXp', 'plan_xzr5jL4TCAlWf') then 3300 + 75   -- Élite90
      else null end;
    raise log 'handle_new_user : abonnement en attente périmé ignoré (user %, plan %, dernier paiement %)', new.id, pa.plan, pa.paid_at;
    pa.plan := 'free';
    pa.credits := case when v_sub is null then 0 else greatest(0, coalesce(pa.credits, 0) - v_sub) end;
    pa.whop_member_id := null;
    pa.whop_plan_id := null;
  end if;
  if v_pending then
    insert into public.profiles (id, email, plan, credits_remaining, credits_total, img_bonus_credits, whop_member_id, whop_plan_id, first_sub_bonus_used)
    values (new.id, new.email, pa.plan, pa.credits, pa.credits, coalesce(pa.img_credits,0), pa.whop_member_id, pa.whop_plan_id,
            (pa.plan is not null and pa.plan <> 'free'));   -- un abonnement en attente a déjà reçu son bonus
    delete from public.pending_activations where lower(email) = lower(new.email);
  else
    insert into public.profiles (id, email, plan, credits_remaining, credits_total)
    values (new.id, new.email, 'free', 0, 0);
  end if;
  return new;
end;
$$;
