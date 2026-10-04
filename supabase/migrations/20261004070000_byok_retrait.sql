-- Retrait complet du plan BYOK (Axel 04/10 : « supprime-le complètement proprement, on ne l'utilisera pas »).
-- Vérifié le 04/10 avant écriture : aucun profil sur ce plan, aucune clé Hedra personnelle enregistrée (0 / 0).
-- Va avec le même commit : app/index.html (gardes de plan, libellés, en-tête x-user-hedra-key, Connexions) et les fonctions
-- edge (listes de plans payants, hedra-proxy : clé toujours celle de la plateforme, en-tête client refusé).
--
--   1) profiles_guard : la clé Hedra personnelle n'est plus une colonne modifiable par le client ;
--   2) claim_retention_bonus : seul le plan Free est exclu (byok retiré de la condition) ;
--   3) profiles_plan_check : plans autorisés = free, starter, pro, elite, developer ;
--   4) colonne profiles.hedra_api_key supprimée (vide partout, aucune vue ni fonction n'en dépend hors profiles_guard).
-- Chaque étape s'annule d'elle-même si un profil byok ou une clé personnelle réapparaît d'ici l'exécution.
-- Rejouable sans effet de bord (create or replace, drop … if exists, colonne testée avant lecture).

begin;
set local lock_timeout = '10s';

-- ─── 1) Garde des profils (SECURITY INVOKER, liste blanche) ───
create or replace function public.profiles_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  editable constant text[] := array['first_name', 'phone', 'affiliate_payment'];
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      raise exception 'création de profil réservée au serveur' using errcode = '42501';
    end if;
    if (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
      raise exception 'colonne protégée (plan/crédits/is_owner/parrainage…) — passe par une RPC serveur' using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

-- ─── 2) Bonus de rétention ───
create or replace function public.claim_retention_bonus(p_reason text default null::text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row public.profiles%rowtype; v_new integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_row from public.profiles where id = auth.uid() for update;
  if not found then return -1; end if;
  if lower(coalesce(v_row.plan,'free')) = 'free' then return -1; end if;
  if coalesce(v_row.retention_bonus_used, false) then return -1; end if;
  -- Audit 02/10 : contre-offre proposée AVANT l'annulation (cancelSubscription n'ouvre pas le parcours si elle est
  -- déjà programmée) → refus si whop_cancel_at_period_end est déjà vrai : le bonus n'est pas un cadeau de départ.
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

-- ─── 3) Plans autorisés ───
do $$ begin
  if exists (select 1 from public.profiles where plan = 'byok') then
    raise exception 'profil byok présent : migration annulée (le repasser sur un autre plan d''abord)';
  end if;
end $$;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check
  check (plan = any (array['free'::text, 'starter'::text, 'pro'::text, 'elite'::text, 'developer'::text]));

-- ─── 4) Colonne de clé personnelle ───
do $$
declare v_n bigint;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'hedra_api_key') then
    execute 'select count(*) from public.profiles where coalesce(hedra_api_key, '''') <> ''''' into v_n;
    if v_n > 0 then
      raise exception 'clé Hedra personnelle présente (%) : migration annulée', v_n;
    end if;
    execute 'alter table public.profiles drop column hedra_api_key';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
