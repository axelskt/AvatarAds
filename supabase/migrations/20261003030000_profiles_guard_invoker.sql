-- Audit sécurité du 02/10 — profiles_guard rendu EFFECTIF.
--
-- Le trigger était SECURITY DEFINER (propriétaire postgres) : à l'intérieur, current_user valait TOUJOURS
-- « postgres », qui figurait dans la liste d'exemption → la condition n'était jamais vraie, le garde ne bloquait
-- RIEN. Seuls les droits par colonne (UPDATE authenticated limité à first_name/phone/hedra_api_key/affiliate_payment)
-- protégeaient plan, is_owner, crédits et parrainage : une seule erreur de GRANT future suffisait à une auto-promotion.
--
-- Correctif :
--  1) SECURITY INVOKER → current_user est le VRAI rôle de la requête. Appel direct par PostgREST = anon/authenticated ;
--     dans une RPC SECURITY DEFINER (spend_credits, set_referrer, claim_retention_bonus…) = son propriétaire (postgres) ;
--     webhooks / worker = service_role. Les chemins serveur légitimes ne sont donc jamais touchés.
--  2) LISTE BLANCHE au lieu d'une liste noire : pour anon/authenticated, seules les 4 colonnes éditables par le client
--     peuvent changer ; toute autre colonne (y compris une colonne ajoutée plus tard) est refusée.
--  3) INSERT direct par anon/authenticated refusé (aucun GRANT INSERT aujourd'hui : défense en profondeur). Le profil
--     naît par handle_new_user (trigger sur auth.users, hors rôles client).

create or replace function public.profiles_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  editable constant text[] := array['first_name', 'phone', 'hedra_api_key', 'affiliate_payment'];
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
end $$;
revoke all on function public.profiles_guard() from public, anon, authenticated;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

drop trigger if exists trg_profiles_guard_insert on public.profiles;
create trigger trg_profiles_guard_insert before insert on public.profiles
  for each row execute function public.profiles_guard();
