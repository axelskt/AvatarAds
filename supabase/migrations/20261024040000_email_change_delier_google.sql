-- Audit du 23/10/2026, constat n° 26 (va avec supabase/functions/auth-otp/index.ts du même lot).
--
-- Après un changement d'adresse (auth-otp email_change_verify), l'identité Google de l'ANCIENNE adresse restait dans
-- auth.identities. GoTrue retrouve une identité externe par (fournisseur, identifiant Google « sub ») AVANT toute logique
-- d'adresse : « Continuer avec Google » avec l'ancien compte Google ouvrait donc toujours le compte, qui porte pourtant la
-- nouvelle adresse, et sans limite de temps. L'avis envoyé à l'ancienne adresse affirmait le contraire (« cette adresse-ci
-- ne permet plus de te connecter »). Cas jamais rencontré (email_change_events vide au 23/10, 146 identités Google).
--
-- GoTrue (v2.194, internal/api/admin.go) n'a AUCUNE route admin qui supprime une identité ; la route utilisateur
-- DELETE /user/identities/{id} exige la liaison manuelle activée et la session du client. D'où cette RPC, réservée au
-- service_role, appelée par auth-otp juste APRÈS auth.admin.updateUserById(email) :
--   · elle retire les identités autres que « email » dont l'adresse n'est PAS la nouvelle (l'ancienne adresse, et toute
--     identité restée d'un changement plus ancien) ;
--   · elle refuse d'agir si le compte ne porte pas déjà la nouvelle adresse, ou s'il n'a pas d'identité « email » à cette
--     adresse (GoTrue la crée ou la met à jour à updateUserById ; 144 comptes Google n'ont qu'une identité Google) : jamais
--     un compte sans moyen de connexion ;
--   · elle recalcule raw_app_meta_data.providers / provider comme GoTrue le fait après un déliage
--     (User.UpdateAppMetaDataProviders : fournisseurs des identités restantes par ancienneté, provider = le premier) — lu
--     par paiement_compte_etat (« compte Google sans mot de passe ») ;
--   · elle note les fournisseurs retirés dans email_change_events (support), sans aucune donnée d'identité.
-- Après une annulation (lien « Ce n'est pas moi »), rien à restaurer : l'adresse rétablie est de nouveau celle du compte et
-- GoTrue relie de lui-même le compte Google de cette adresse à la connexion suivante (liaison automatique par adresse
-- vérifiée, models/linking.go). Après 72 h, le compte Google de l'ancienne adresse ouvre un compte NEUF, exactement comme
-- une connexion par code sur cette adresse (avant : Google ouvrait l'ancien compte, le code en créait un autre).
--
-- RISQUE (documenté) : écriture directe dans le schéma de GoTrue, en dehors de son API — même pratique que
-- email_change_lockdown (20261004050000). GoTrue ne garde aucune identité en cache (relue à chaque connexion) ; aucune clé
-- étrangère ne pointe vers auth.identities (vérifié au catalogue le 23/10) ; aucun trigger d'auth.users ne porte sur
-- raw_app_meta_data. Les jetons d'accès déjà émis gardent l'ancienne liste « providers » jusqu'à leur renouvellement
-- (affichage seulement). À revérifier si GoTrue change le schéma d'auth.identities (identity_data, provider, created_at) ou
-- cesse de créer l'identité « email » à admin updateUserById : la RPC refuse alors d'agir (rien n'est retiré) et auth-otp
-- envoie un avis qui ne parle que du code e-mail.
--
-- Rejouable sans effet de bord (if not exists / create or replace / revoke + grant explicites). Aucun droit pour
-- public / anon / authenticated.

-- ─── 1) Journal : fournisseurs déliés au changement (support) ───
alter table public.email_change_events add column if not exists identites_retirees text[];

-- ─── 2) Déliage des identités de l'ancienne adresse ───
create or replace function public.email_change_delier_identites(p_user uuid, p_event uuid, p_new_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new   text := lower(btrim(coalesce(p_new_email, '')));
  v_prov  text[] := '{}';
  v_reste text[];
  n_del   integer := 0;
begin
  if p_user is null or v_new = '' then return jsonb_build_object('ok', false, 'error', 'bad_args'); end if;
  -- Appel après updateUserById : le compte porte déjà la nouvelle adresse, sinon on ne touche à rien.
  if not exists (select 1 from auth.users where id = p_user and lower(coalesce(email, '')) = v_new) then
    return jsonb_build_object('ok', false, 'error', 'adresse_non_changee');
  end if;
  -- Garde-fou : le compte garde au moins l'identité « email » de la nouvelle adresse.
  if not exists (select 1 from auth.identities
                  where user_id = p_user and provider = 'email'
                    and lower(coalesce(identity_data->>'email', '')) = v_new) then
    return jsonb_build_object('ok', false, 'error', 'identite_email_absente');
  end if;

  with retirees as (
    delete from auth.identities
     where user_id = p_user and provider <> 'email'
       and lower(coalesce(identity_data->>'email', '')) <> v_new
    returning provider
  )
  select coalesce(array_agg(distinct provider), '{}'), count(*) into v_prov, n_del from retirees;

  if n_del > 0 then
    -- Comme GoTrue après un déliage : fournisseurs restants par ancienneté, provider = le premier.
    select array_agg(provider order by premiere) into v_reste
      from (select provider, min(created_at) as premiere from auth.identities where user_id = p_user group by provider) x;
    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                               || jsonb_build_object('providers', to_jsonb(v_reste), 'provider', v_reste[1])
     where id = p_user;
    if p_event is not null then
      update public.email_change_events set identites_retirees = v_prov where id = p_event and user_id = p_user;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'retirees', n_del, 'fournisseurs', to_jsonb(v_prov));
end $$;
revoke all on function public.email_change_delier_identites(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.email_change_delier_identites(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
