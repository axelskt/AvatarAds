-- RGPD (Axel 28/09 : « oui » à la proposition) — conservation limitée des médias MCP + suppression de compte.
--
-- Conservation (fonction purge-mcp-media, planifiée par Axel) :
--   • photos et voix ENVOYÉES : 7 jours — mcp-media/<uid>/ref-* (photo produit : /ref, carte), mcp-media/<uid>/omni-*
--     (visage + voix OmniHuman) et render-media/<uid>/mcp-veo/* (image de départ Veo) ;
--   • médias GÉNÉRÉS via Claude : 30 jours — mcp-media/<uid>/<horodatage>-<suffixe>.<ext>. La copie rangée dans la
--     Bibliothèque (render-media/<uid>/lib) n'est PAS touchée ;
--   • jamais : les comptes owner / developer (médias de test d'Axel), les images d'animation (anim-img, logos des montages).
-- Les fichiers se suppriment par l'API Storage (edge function, service_role) ; ces fonctions ne font que LISTER.

create or replace function public.list_media_purge(p_limit integer default 500)
returns table(bucket_id text, name text, motif text)
language sql security definer set search_path = public, storage as $$
  with illimites as (
    select id::text as uid from public.profiles where coalesce(is_owner, false) or lower(coalesce(plan, '')) = 'developer'
  )
  select * from (
    select o.bucket_id, o.name, 'envoyé > 7 j'::text from storage.objects o
     where o.bucket_id = 'mcp-media' and o.created_at < now() - interval '7 days'
       and o.name ~ '^[0-9a-f-]{36}/(ref|omni)-' and split_part(o.name, '/', 1) not in (select uid from illimites)
    union all
    select o.bucket_id, o.name, 'envoyé > 7 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '7 days'
       and o.name ~ '^[0-9a-f-]{36}/mcp-veo/' and split_part(o.name, '/', 1) not in (select uid from illimites)
    union all
    select o.bucket_id, o.name, 'généré > 30 j' from storage.objects o
     where o.bucket_id = 'mcp-media' and o.created_at < now() - interval '30 days'
       and o.name ~ '^[0-9a-f-]{36}/[0-9]{10,}-[a-z0-9]{3,10}\.(png|jpe?g|webp|mp4|mp3|wav)$'
       and split_part(o.name, '/', 1) not in (select uid from illimites)
  ) t
  limit greatest(1, least(1000, coalesce(p_limit, 500)))
$$;

-- Tous les fichiers d'un compte (suppression de compte).
create or replace function public.list_user_objects(p_user uuid)
returns table(bucket_id text, name text)
language sql security definer set search_path = public, storage as $$
  select o.bucket_id, o.name from storage.objects o
   where p_user is not null and o.bucket_id in ('mcp-media', 'render-media', 'brand-assets')
     and o.name like p_user::text || '/%'
$$;

-- Lignes d'un compte que la suppression de auth.users n'emporte PAS en cascade (le reste suit : profil, crédits,
-- Bibliothèque, jobs, clés MCP, marque…). p_dry = true : on compte sans rien supprimer. Filleuls : referred_by est un
-- CODE (referrer_id_from_code) — une fois le parrain supprimé il ne mène plus à personne, rien à détacher.
create or replace function public.delete_user_rows(p_user uuid, p_email text, p_dry boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; n integer; e text := lower(coalesce(p_email, ''));
begin
  if p_user is null then raise exception 'bad_args'; end if;
  if p_dry then
    r := jsonb_build_object(
      'mcp_oauth_codes',       (select count(*) from public.mcp_oauth_codes where user_id = p_user),
      'mcp_oauth_tokens',      (select count(*) from public.mcp_oauth_tokens where user_id = p_user),
      'mcp_debits',            (select count(*) from public.mcp_debits where user_id = p_user),
      'render_jobs',           (select count(*) from public.render_jobs where user_id = p_user),
      'anim_demandes',         (select count(*) from public.anim_demandes where user_id = p_user),
      'cancellation_feedback', (select count(*) from public.cancellation_feedback where user_id = p_user or (e <> '' and lower(email) = e)),
      'otp_codes',             (select count(*) from public.otp_codes where e <> '' and lower(email) = e),
      'pending_activations',   (select count(*) from public.pending_activations where e <> '' and lower(email) = e));
    return r;
  end if;
  delete from public.mcp_oauth_codes where user_id = p_user;       get diagnostics n = row_count; r := r || jsonb_build_object('mcp_oauth_codes', n);
  delete from public.mcp_oauth_tokens where user_id = p_user;      get diagnostics n = row_count; r := r || jsonb_build_object('mcp_oauth_tokens', n);
  delete from public.mcp_debits where user_id = p_user;            get diagnostics n = row_count; r := r || jsonb_build_object('mcp_debits', n);
  delete from public.render_jobs where user_id = p_user;           get diagnostics n = row_count; r := r || jsonb_build_object('render_jobs', n);
  delete from public.anim_demandes where user_id = p_user;         get diagnostics n = row_count; r := r || jsonb_build_object('anim_demandes', n);
  delete from public.cancellation_feedback where user_id = p_user or (e <> '' and lower(email) = e);
                                                                   get diagnostics n = row_count; r := r || jsonb_build_object('cancellation_feedback', n);
  if e <> '' then
    delete from public.otp_codes where lower(email) = e;           get diagnostics n = row_count; r := r || jsonb_build_object('otp_codes', n);
    delete from public.pending_activations where lower(email) = e; get diagnostics n = row_count; r := r || jsonb_build_object('pending_activations', n);
  end if;
  return r;
end $$;

revoke all on function public.list_media_purge(integer)               from public, anon, authenticated;
revoke all on function public.list_user_objects(uuid)                 from public, anon, authenticated;
revoke all on function public.delete_user_rows(uuid, text, boolean)   from public, anon, authenticated;
grant execute on function public.list_media_purge(integer)            to service_role;
grant execute on function public.list_user_objects(uuid)              to service_role;
grant execute on function public.delete_user_rows(uuid, text, boolean) to service_role;
notify pgrst, 'reload schema';
