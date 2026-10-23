-- 23/10/2026 (Axel, achat test sans compte : « Compte non créé … Database error creating new user »).
-- GoTrue pose un mot de passe ALÉATOIRE (64 caractères) à tout compte créé par admin.createUser sans mot de passe
-- (supabase/auth internal/api/admin.go : password.Generate quand Password et PasswordHash sont vides). Le blocage du 02/10
-- (block_password_signup : « mot de passe à l'insertion = refus ») refusait donc AUSSI nos créations serveur :
-- l'inscription par code e-mail (auth-otp) et le compte créé à l'achat (whop-webhook) échouaient depuis le 02/10 — seuls les
-- comptes Google passaient (0 compte « email » créé depuis). Les 19 comptes « email » antérieurs ont d'ailleurs tous ce
-- mot de passe aléatoire, que personne ne connaît.
-- Nouveau contrat, même protection contre /auth/v1/signup (compte confirmé + session sur l'adresse de quelqu'un d'autre) :
--   1) BEFORE INSERT : le mot de passe d'un compte qui naît est retiré (aléatoire de GoTrue ou choisi via /signup) ;
--   2) à la VALIDATION de la transaction (trigger différé) : un compte « email » qui ne porte pas la marque serveur
--      app_metadata.aa_origine = 'serveur' est refusé. Nos fonctions la posent à admin.createUser ; GoTrue l'écrit APRÈS
--      l'insertion, dans la même transaction (d'où le contrôle différé) ; un /signup ne peut pas écrire app_metadata.
--      Google (provider google) n'est pas concerné.
-- + handle_new_user : un achat fait AVANT la création du compte (pending_activations) verse la part « pack » en crédits
--   ACHETÉS (bought_credits), comme le webhook (pendingPackLeft) — sinon la résiliation les retirait avec ceux du plan.

create or replace function public.block_password_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.encrypted_password := '';   -- un compte naît toujours sans mot de passe (créé ensuite par l'utilisateur, avec preuve)
  return new;
end $$;
revoke all on function public.block_password_signup() from public, anon, authenticated;

create or replace function public.block_email_signup_hors_serveur()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users u
              where u.id = new.id
                and coalesce(u.raw_app_meta_data->>'provider', '') = 'email'
                and coalesce(u.raw_app_meta_data->>'aa_origine', '') <> 'serveur') then
    raise exception 'inscription par e-mail réservée au code e-mail ou à Google';
  end if;
  return null;
end $$;
revoke all on function public.block_email_signup_hors_serveur() from public, anon, authenticated;

drop trigger if exists block_email_signup_hors_serveur on auth.users;
create constraint trigger block_email_signup_hors_serveur after insert on auth.users
  deferrable initially deferred for each row execute function public.block_email_signup_hors_serveur();

-- Copie de la définition du 23/10 (20261023210000_variantes_pack.sql) ; ajout : v_bought → profiles.bought_credits.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare pa public.pending_activations%rowtype;
        v_pending boolean;
        v_sub integer;
        v_bought integer;
begin
  select * into pa from public.pending_activations where lower(email) = lower(new.email);
  v_pending := found;
  -- crédits du plan + bonus 1er abonnement inclus dans pa.credits (SUB_MAP + FIRST_SUB_BONUS de whop-webhook) ;
  -- plan Whop hors catalogue → part pack inconnue → null (prudence, comme le webhook).
  if v_pending and pa.plan is not null and pa.plan <> 'free' then
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
  end if;
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
    raise log 'handle_new_user : abonnement en attente périmé ignoré (user %, plan %, dernier paiement %)', new.id, pa.plan, pa.paid_at;
    pa.plan := 'free';
    pa.credits := case when v_sub is null then 0 else greatest(0, coalesce(pa.credits, 0) - v_sub) end;
    pa.whop_member_id := null;
    pa.whop_plan_id := null;
  end if;
  if v_pending then
    -- part « pack » = crédits achetés : jamais plafonnés, gardés à la résiliation (même calcul que pendingPackLeft)
    v_bought := case when pa.plan is null or pa.plan = 'free' then greatest(0, coalesce(pa.credits, 0))
                     when v_sub is null then 0
                     else greatest(0, coalesce(pa.credits, 0) - v_sub) end;
    insert into public.profiles (id, email, plan, credits_remaining, credits_total, bought_credits, img_bonus_credits, whop_member_id, whop_plan_id, first_sub_bonus_used)
    values (new.id, new.email, pa.plan, pa.credits, pa.credits, v_bought, coalesce(pa.img_credits,0), pa.whop_member_id, pa.whop_plan_id,
            (pa.plan is not null and pa.plan <> 'free'));   -- un abonnement en attente a déjà reçu son bonus
    delete from public.pending_activations where lower(email) = lower(new.email);
  else
    insert into public.profiles (id, email, plan, credits_remaining, credits_total)
    values (new.id, new.email, 'free', 0, 0);
  end if;
  return new;
end;
$$;
