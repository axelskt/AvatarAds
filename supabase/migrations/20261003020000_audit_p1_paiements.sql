-- Audit sécurité du 02/10 — P1 « paiements » (va avec supabase/functions/whop-webhook/index.ts du même jour).
-- Idempotente (create or replace, drop trigger if exists). CREATE OR REPLACE conserve les droits existants des
-- fonctions redéfinies (handle_new_user, get_referral_summary : aucun revoke/grant dans le dépôt pour elles) ; les
-- fonctions NOUVELLES sont fermées à public/anon/authenticated.
--
-- 1) PAY-1 — handle_new_user : un ABONNEMENT payé sans compte vit dans pending_activations et était appliqué à
--    l'inscription quel que soit son âge. Un abonnement remboursé, résilié ou jamais renouvelé donnait donc son plan à
--    vie à l'inscription. Le webhook supprime désormais la ligne au remboursement / à la résiliation ; filet ici : une
--    ligne d'abonnement dont le DERNIER paiement (paid_at, rafraîchi par whop-webhook à chaque renouvellement de
--    l'acheteur toujours sans compte) date de plus d'une période + marge (35 j mensuel, 370 j annuel) perd son PLAN ;
--    les crédits de packs achetés sans compte qu'elle porte sont gardés (comme à la résiliation côté webhook).
--    Colonnes réelles de pending_activations (setup-whop.sql + webhook) : email (clé), product, plan, credits,
--    img_credits, paid_at, whop_member_id, whop_plan_id (+ applied, héritage, inutilisée) ; pas de created_at ni de
--    période → la période se lit sur whop_plan_id (bloc « Annuel » de SUB_MAP). Les packs seuls (plan free)
--    n'expirent pas. Rattrapage unique de paid_at sur le dernier paiement journalisé (webhook_events) pour ne pas
--    priver un abonné actif sans compte de son plan.
-- 2) PAY-2 — profiles.email suit auth.users.email : après un changement d'adresse (Mon compte → lien de confirmation),
--    profiles.email restait l'ANCIENNE adresse → whop-webhook (profil retrouvé par e-mail) et auth-otp (connexion par
--    code) résolvaient le mauvais compte. Aucun trigger existant ne le faisait (seuls triggers sur auth.users dans le
--    dépôt : le trigger d'inscription → handle_new_user, block_password_signup, et l'héritage apply_pending_activation
--    à l'INSERT). Rattrapage unique des profils déjà décalés. + garde-fou : profiles.email n'est plus modifiable par
--    un client (rôles anon / authenticated), seulement par le serveur.
-- 3) PAY-3 — commissions de parrainage : « disponible » (base des virements) = commissions SANS motif de revue ET de
--    plus de 30 jours (un remboursement / litige du filleul arrive dans ce délai : whop-webhook met alors ses
--    commissions des 90 derniers jours en revue). get_referral_summary garde EXACTEMENT ses clés (lues par l'app :
--    signups, paying, earned_cents, available_cents, pending_cents, min_payout_cents ; + review_cents, paid_cents) et
--    ajoute hold_cents / hold_days. request_referral_payout n'est pas dans le dépôt (appliquée via MCP le 21/08) → un
--    garde-fou AVANT INSERT sur referral_payouts impose le MÊME disponible quelle que soit sa définition.

-- ─── 1) PAY-1 : handle_new_user (copie de 20260906060000_pending_sub_marks_first_bonus.sql, dernière définition) ───
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
                                    'plan_uWTkJDl1GvxNR', 'plan_x2kDWR6ur2W5E')   -- annuels, synchro SUB_MAP (whop-webhook)
             then interval '370 days'
           else interval '35 days' end) then
    -- crédits du plan + bonus 1er abonnement inclus dans pa.credits (SUB_MAP + FIRST_SUB_BONUS de whop-webhook) ;
    -- plan Whop hors catalogue → part pack inconnue → 0 (prudence, comme le webhook).
    v_sub := case
      when pa.whop_plan_id in ('plan_YKcdyPT6RRQSi', 'plan_cNydK89X39PLE') then 150 + 25    -- Starter
      when pa.whop_plan_id in ('plan_g4BVtDmk6hgjQ', 'plan_P7WIywSa6YrxT') then 550 + 50    -- Pro
      when pa.whop_plan_id in ('plan_w8lh5zpEJFOQR', 'plan_OvRwm5CW3xcNh') then 1100 + 75   -- Élite30
      when pa.whop_plan_id in ('plan_pZmWh1dVdmIWT', 'plan_uWTkJDl1GvxNR') then 2200 + 75   -- Élite60
      when pa.whop_plan_id in ('plan_63PGeG3MesbJR', 'plan_x2kDWR6ur2W5E') then 3300 + 75   -- Élite90
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

-- Rattrapage unique de paid_at (lignes d'abonnement en attente existantes). Avant le 03/10, un renouvellement sans
-- compte ne rafraîchissait PAS paid_at : un acheteur qui paie depuis plus de 35 j sans avoir créé son compte serait vu
-- comme périmé jusqu'à son prochain paiement. paid_at est recalé sur le DERNIER paiement reçu pour ce même abonnement
-- (identifiant Whop ; l'adresse seulement si la ligne n'en porte pas, pour qu'un paiement de pack ne prolonge pas un
-- abonnement) dans le journal webhook_events, SAUF si une résiliation / un remboursement / un litige (abonnement OU
-- adresse) est arrivé après ce paiement (rien n'est alors prolongé). Ne fait que repousser paid_at (jamais en arrière).
-- Même filtrage des actions que whop-webhook (isRenew / isDeactivate / isClawback). Journal absent ou de forme
-- inattendue → rattrapage sauté avec un avis, la migration continue.
do $$
declare n integer;
begin
  with ev as (
    select w.received_at as at,
           lower(coalesce(w.body->>'action', w.body->>'event', w.body->>'type', '')) as action,
           coalesce(w.body->'data'->>'membership_id', w.body->'data'->'membership'->>'id') as mid,
           w.body->'data'->>'id' as did,
           lower(trim(coalesce(w.body->'data'->'user'->>'email', w.body->'data'->'member'->'user'->>'email',
                               w.body->'data'->'customer'->>'email', w.body->'data'->>'email', ''))) as em
      from public.webhook_events w
     where w.received_at > now() - interval '400 days'
  ), m as (
    select pa.email,
           max(ev.at) filter (where ev.action ~ 'membership[._]renewed|invoice[._]paid|payment[._]succeeded'
                                and (pa.whop_member_id is null or pa.whop_member_id in (ev.mid, ev.did))) as last_paid,
           max(ev.at) filter (where (ev.action ~ '(refund|dispute|chargeback)' and ev.action !~ 'dispute[._](won|closed|resolved)')
                                 or ev.action ~ 'membership[._](went[._]invalid|deactivated)') as last_end
      from public.pending_activations pa
      join ev on (pa.whop_member_id is not null and pa.whop_member_id in (ev.mid, ev.did))
              or (ev.em <> '' and ev.em = lower(pa.email))
     where pa.plan is not null and pa.plan <> 'free'
     group by pa.email
  )
  update public.pending_activations pa set paid_at = m.last_paid
    from m
   where pa.email = m.email
     and m.last_paid > coalesce(pa.paid_at, '-infinity'::timestamptz)
     and (m.last_end is null or m.last_end < m.last_paid);
  get diagnostics n = row_count;
  raise notice 'Audit 02/10 (PAY-1) : paid_at recalé sur le dernier paiement pour % abonnement(s) en attente', n;
exception when others then
  raise notice 'Audit 02/10 (PAY-1) : rattrapage de paid_at sauté (%)', sqlerrm;
end $$;

-- ─── 2) PAY-2 : profiles.email = e-mail de connexion, toujours ───
-- Échec FERMÉ : si le profil ne peut pas suivre (adresse déjà portée par un autre profil), le changement d'adresse est
-- refusé plutôt que de laisser deux comptes se disputer la même adresse côté paiements / connexion par code.
create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.email, '') <> '' and new.email is distinct from old.email then
    begin
      update public.profiles set email = lower(new.email)
       where id = new.id and email is distinct from lower(new.email);
    exception when unique_violation then
      raise exception 'cette adresse e-mail est déjà rattachée à un autre compte AvatarAds' using errcode = 'unique_violation';
    end;
  end if;
  return new;
end $$;
revoke all on function public.sync_profile_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_profile_email();

-- Rattrapage : profils déjà décalés (adresse changée avant ce trigger). Jamais deux profils sur la même adresse : un
-- profil dont la nouvelle adresse est encore portée (périmée) par un autre attend la passe suivante, où cet autre a été
-- corrigé. 3 passes au plus.
do $$
declare n integer; total integer := 0;
begin
  for i in 1..3 loop
    update public.profiles p set email = lower(u.email)
      from auth.users u
     where p.id = u.id and coalesce(u.email, '') <> ''
       and p.email is distinct from lower(u.email)
       and not exists (select 1 from public.profiles o where o.id <> p.id and lower(o.email) = lower(u.email));
    get diagnostics n = row_count;
    total := total + n;
    exit when n = 0;
  end loop;
  raise notice 'Audit 02/10 (PAY-2) : % profil(s) resynchronisé(s) sur l''e-mail de connexion', total;
end $$;

-- Garde-fou : profiles.email n'est écrit QUE par le serveur (handle_new_user, la recopie ci-dessus, le rattrapage,
-- l'héritage apply_pending_activation). Sinon un client pourrait y mettre l'adresse d'un acheteur Whop et se faire
-- créditer son paiement (whop-webhook et auth-otp retrouvent le profil par e-mail). L'app ne l'écrit jamais : un
-- changement d'adresse passe par auth.updateUser + lien de confirmation, puis la recopie ci-dessus. Trigger SÉPARÉ de
-- profiles_guard et en SECURITY INVOKER exprès : current_user y est le rôle qui exécute l'UPDATE (dans une fonction
-- SECURITY DEFINER, current_user vaut le propriétaire de la fonction et ne dit rien de l'appelant).
create or replace function public.profiles_email_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.email is distinct from old.email
     and current_user not in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') then
    raise exception 'L''adresse e-mail se change depuis Mon compte (un lien de confirmation est envoyé à la nouvelle adresse).'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke all on function public.profiles_email_guard() from public, anon, authenticated;

drop trigger if exists trg_profiles_email_guard on public.profiles;
create trigger trg_profiles_email_guard before update of email on public.profiles
  for each row execute function public.profiles_email_guard();

-- ─── 3) PAY-3 : disponible au virement = commissions hors revue de plus de 30 jours ───
-- Source UNIQUE du disponible (résumé de l'app + garde-fou des virements). Interne : prend un user arbitraire → fermée
-- aux rôles clients (sinon lecture des gains d'un autre).
create or replace function public.referral_available_cents(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(0,
      coalesce((select sum(e.commission_cents) from public.referral_earnings e
                 where e.referrer_id = p_user and e.review_reason is null
                   and coalesce(e.created_at, '-infinity'::timestamptz) <= now() - interval '30 days'), 0)
    - coalesce((select sum(p.amount_cents) from public.referral_payouts p
                 where p.user_id = p_user and p.status in ('paid', 'pending')), 0)
  )::integer;
$$;
revoke all on function public.referral_available_cents(uuid) from public, anon, authenticated;

-- get_referral_summary (copie de 20260914200000_referral_earnings_review.sql) : mêmes clés, même types ; available_cents
-- passe par referral_available_cents ; + hold_cents (commissions hors revue de moins de 30 jours, pas encore
-- retirables) et hold_days. earned_cents reste le total gagné (affichage).
create or replace function public.get_referral_summary()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with e as (
    select coalesce(sum(commission_cents),0)::int as earned_all,
           coalesce(sum(commission_cents) filter (where review_reason is null and created_at > now() - interval '30 days'),0)::int as hold,
           coalesce(sum(commission_cents) filter (where review_reason is not null),0)::int as review,
           count(distinct coalesce(referred_id::text, referred_email))::int as paying
    from public.referral_earnings where referrer_id = auth.uid()
  ), p as (
    select coalesce(sum(amount_cents) filter (where status = 'paid'),0)::int as paid,
           coalesce(sum(amount_cents) filter (where status = 'pending'),0)::int as pending
    from public.referral_payouts where user_id = auth.uid()
  ), r as (
    select count(*)::int as signups from public.profiles pr
    where pr.id <> auth.uid()
      and (pr.referred_by = auth.uid()::text
           or upper(pr.referred_by) = upper(substr(replace(auth.uid()::text,'-',''),1,10)))
  )
  select jsonb_build_object(
    'signups', r.signups, 'paying', e.paying,
    'earned_cents', e.earned_all,
    'review_cents', e.review,
    'hold_cents', e.hold, 'hold_days', 30,
    'paid_cents', p.paid, 'pending_cents', p.pending,
    'available_cents', public.referral_available_cents(auth.uid()),
    'min_payout_cents', 5000)
  from e, p, r;
$function$;

-- Garde-fou des demandes de virement : une demande « pending » ne peut pas dépasser le disponible ci-dessus, même si
-- request_referral_payout calcule le sien autrement. Les écritures manuelles de l'owner (statut paid) passent.
create or replace function public.referral_payouts_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.status, 'pending') = 'pending'
     and coalesce(new.amount_cents, 0) > public.referral_available_cents(new.user_id) then
    raise exception 'Montant supérieur à ton solde disponible : une commission devient retirable 30 jours après le paiement du filleul, hors commissions en revue.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.referral_payouts_guard() from public, anon, authenticated;

drop trigger if exists trg_referral_payouts_guard on public.referral_payouts;
create trigger trg_referral_payouts_guard before insert on public.referral_payouts
  for each row execute function public.referral_payouts_guard();
