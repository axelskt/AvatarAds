-- Parrainage (Axel 25/09) : depuis la page connexion.html (OTP et Google), set_referrer n'était JAMAIS appelé → 10 inscrits
-- depuis le 14/09, 0 parrain posé. Le client l'appelle désormais à chaque ouverture de l'app tant que aa_ref est présent
-- (tous les chemins de connexion passent par l'app). Comme l'appel n'est plus limité à « compte tout juste créé », le
-- serveur tranche :
--   · code au format des liens de parrainage, résolu vers un VRAI compte (referrer_id_from_code), jamais soi-même ;
--   · compte créé il y a 30 jours au plus : un compte ancien ne peut pas se rattacher après coup à un parrain
--     (30 j = rattrape les filleuls perdus depuis le 14/09 dont le navigateur a gardé le lien) ;
--   · write-once inchangé (referred_by déjà posé → false, jamais de rotation).
-- Renvoie false pour tout refus (réponse définitive : le client oublie le code), une erreur SQL seulement si la base
-- est indisponible (le client garde le code pour la prochaine ouverture).
create or replace function public.set_referrer(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_code text := trim(coalesce(p_code, ''));          -- stocké tel quel (comme avant) : get_referral_summary compare aussi l'uuid entier
  v_cur text;
  v_created timestamptz;
  v_ref uuid;
begin
  if v_uid is null then return false; end if;
  if v_code !~* '^[a-z0-9_-]{4,40}$' then return false; end if;
  select referred_by, created_at into v_cur, v_created from public.profiles where id = v_uid;
  if not found or coalesce(v_cur, '') <> '' then return false; end if;             -- déjà posé → write-once
  if v_created is null or v_created < now() - interval '30 days' then return false; end if;
  v_ref := public.referrer_id_from_code(v_code);
  if v_ref is null or v_ref = v_uid then return false; end if;                     -- code inconnu ou auto-parrainage
  update public.profiles set referred_by = v_code
    where id = v_uid and coalesce(referred_by, '') = '';
  return found;
end $$;
revoke all on function public.set_referrer(text) from public, anon;
grant execute on function public.set_referrer(text) to authenticated;
