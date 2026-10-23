-- 23/10/2026 (Axel) : page « Paiement confirmé » — « Ouvrir mon espace » propose de créer un mot de passe quand le compte
-- n'en a pas. paiement_compte_etat renvoie en plus les moyens de connexion du compte (fournisseurs : email, google…) : un
-- compte Google sans mot de passe n'en a pas besoin. Même contrat que 20261023220000 sinon (lecture seule, service_role).
drop function if exists public.paiement_compte_etat(text, uuid);
create function public.paiement_compte_etat(p_email text default null, p_user uuid default null)
returns table(id uuid, created_at timestamptz, last_sign_in_at timestamptz, a_mot_de_passe boolean, fournisseurs text[])
language sql stable security definer set search_path = '' as $$
  select u.id, u.created_at, u.last_sign_in_at, coalesce(u.encrypted_password, '') <> '',
         array(select jsonb_array_elements_text(case when jsonb_typeof(u.raw_app_meta_data->'providers') = 'array'
                                                     then u.raw_app_meta_data->'providers' else '[]'::jsonb end))
    from auth.users u
   where (p_user is not null and u.id = p_user)
      or (p_user is null and p_email is not null and lower(u.email) = lower(trim(p_email)))
   limit 1
$$;
revoke all on function public.paiement_compte_etat(text, uuid) from public, anon, authenticated;
grant execute on function public.paiement_compte_etat(text, uuid) to service_role;
