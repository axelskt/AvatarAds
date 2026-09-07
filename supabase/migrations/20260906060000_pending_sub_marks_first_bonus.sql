-- Audit métier 06/09 — BONUS PREMIER ABONNEMENT DUPLIQUÉ.
-- Un abonnement souscrit AVANT la création de compte passe par pending_activations, dont `credits` inclut déjà
-- le bonus (FIRST_SUB_BONUS, posé par whop-webhook). handle_new_user créditait ces crédits MAIS ne posait pas
-- first_sub_bonus_used → une activation Whop ultérieure (re-validation / changement de plan) re-versait le bonus.
-- Fix : au signup, si le pending est un ABONNEMENT (plan ≠ free), on marque first_sub_bonus_used = true.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare pa public.pending_activations%rowtype;
begin
  select * into pa from public.pending_activations where lower(email) = lower(new.email);
  if found then
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
