-- 27/10 (Axel : « la carte des briques à ajouter dans Production ») : données de la Carte des briques du tableau de bord,
-- mêmes lectures que usine/lots/carte.py (le graphe est construit dans le navigateur avec les mêmes règles, cf-carte.js) :
--   bricks     briques (id, kind, status, subject, label) + les seules clés de meta lues par la carte
--   variants   clips [photo, brique, format] (factory_variants)
--   qc         vidéos finales VF-… (statut, motif, date, affiche, MP4, recette brick_combo, format = factory_format_de)
--   formats    catalogue des formats (factory_formats : nom, famille, statut) — les carrefours « format » de la carte
--   stats      dernière mesure Instagram de chaque reel dont on connaît la recette (distinct on media_id, jour le plus récent)
--   non_relies reels sans recette (nombre, vues)
-- Réservé owner / plan developer, comme factory_prod_stats.
drop function if exists public.factory_carte_stats();
create or replace function public.factory_carte_data()
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  ok boolean;
begin
  select (coalesce(is_owner, false) or lower(coalesce(plan, '')) = 'developer') into ok
  from public.profiles where id = auth.uid();
  if not coalesce(ok, false) then return jsonb_build_object('error', 'forbidden'); end if;
  return (
    with s as (select distinct on (media_id) media_id, combo, account, posted_at, permalink, views, reach, likes, comments, shares, saved, avg_watch_s
                 from public.ig_media_stats order by media_id, day desc)
    select jsonb_build_object(
      'bricks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'status', b.status, 'subject', b.subject, 'label', b.label,
                                                               'meta', jsonb_strip_nulls(jsonb_build_object(
                                                                 'cover', b.meta->'cover', 'poster', b.meta->'poster', 'thumbs', b.meta->'thumbs',
                                                                 'thumbs_retirees', b.meta->'thumbs_retirees', 'images', b.meta->'images',
                                                                 'images_retirees', b.meta->'images_retirees', 'decors', b.meta->'decors',
                                                                 'transcript', b.meta->'transcript', 'script', b.meta->'script', 'text', b.meta->'text',
                                                                 'compatible_subjects', b.meta->'compatible_subjects', 'module', b.meta->'module',
                                                                 'muette', b.meta->'muette', 'media', b.meta->'media', 'keyword', b.meta->'keyword',
                                                                 'hook_demos', b.meta->'incruste'->'hook_demos')))
                                           order by b.id) from public.factory_bricks b), '[]'::jsonb),
      'variants', coalesce((select jsonb_agg(jsonb_build_array(v.avatar_id, v.brick_id, v.format)) from public.factory_variants v), '[]'::jsonb),
      'qc', coalesce((select jsonb_agg(jsonb_build_object('vf', q.template, 'status', q.status, 'refusal_reason', q.refusal_reason,
                                                           'created_at', q.created_at, 'poster_url', q.poster_url, 'video_url', q.video_url,
                                                           'combo', q.brick_combo, 'format', public.factory_format_de(q.brick_combo)) order by q.template)
                       from public.factory_qc q where q.template like 'VF-%'), '[]'::jsonb),
      'formats', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'nom', f.nom, 'famille', f.famille, 'statut', f.statut) order by f.ordre)
                           from public.factory_formats f), '[]'::jsonb),
      'stats', coalesce((select jsonb_agg(jsonb_build_object('media_id', media_id, 'combo', combo, 'account', account, 'posted_at', posted_at,
                                                              'permalink', permalink, 'views', views, 'reach', reach, 'likes', likes,
                                                              'comments', comments, 'shares', shares, 'saved', saved, 'avg_watch_s', avg_watch_s)
                                           order by posted_at desc nulls last)
                           from s where combo is not null and combo <> '{}'::jsonb), '[]'::jsonb),
      'non_relies', jsonb_build_object(
        'nombre', (select count(*) from s where combo is null or combo = '{}'::jsonb),
        'vues', (select coalesce(sum(views), 0) from s where combo is null or combo = '{}'::jsonb)),
      'at', now()));
end $function$;
revoke execute on function public.factory_carte_data() from public, anon;
grant execute on function public.factory_carte_data() to authenticated;
