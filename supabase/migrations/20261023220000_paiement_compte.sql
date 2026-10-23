-- 23/10/2026 (Axel, test réel sur iPhone) : après un paiement sur paiement.html sans être connecté, l'acheteur doit
-- arriver CONNECTÉ dans l'app (puis créer son mot de passe), pas sur l'écran « réclamer » de Whop puis la page d'accueil.
-- La fonction paiement-compte lit ici l'état du compte (date de création, dernière connexion, mot de passe posé ou non) :
-- connexion automatique uniquement pour un compte NEUF (créé il y a moins de 24 h, jamais connecté, sans mot de passe).
-- Lecture seule, réservée au serveur (service_role).
create or replace function public.paiement_compte_etat(p_email text default null, p_user uuid default null)
returns table(id uuid, created_at timestamptz, last_sign_in_at timestamptz, a_mot_de_passe boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, u.created_at, u.last_sign_in_at, coalesce(u.encrypted_password, '') <> ''
    from auth.users u
   where (p_user is not null and u.id = p_user)
      or (p_user is null and p_email is not null and lower(u.email) = lower(trim(p_email)))
   limit 1
$$;
revoke all on function public.paiement_compte_etat(text, uuid) from public, anon, authenticated;
grant execute on function public.paiement_compte_etat(text, uuid) to service_role;
