-- 24/10/2026 (suite de 20261024060000) :
-- - ig_media_stats.vf porte l'identifiant COMPLET (VF-0031_A1-8_…) : on garde la forme courte VF-0031 (combo.vf), sinon ni
--   le fichier final/ ni la vidéo TikTok du même VF ne sont retrouvés ;
-- - TikTok : la recette d'une vidéo est d'abord celle relevée sur Instagram pour le même VF (elle porte illustrations /
--   transformation, que factory_qc.brick_combo n'a pas) — sinon toutes les vidéos « Ta voix » TikTok tombaient en « simple » ;
-- - exemple de la revue (factory_qc) seulement si son fichier existe encore dans le stockage ;
-- - top_* : la vidéo publiée la plus vue du format, même sans fichier dans le stockage (lien Instagram / TikTok), à côté de
--   l'exemple jouable ex_* (la plus vue AVEC fichier, sinon stock, sinon test).

drop function if exists public.factory_format_stats();
create function public.factory_format_stats()
returns table(id text, famille text, nom text, description text, ordre integer, statut text,
              ig_posts integer, ig_med numeric, ig_max bigint,
              tt_posts integer, tt_med numeric, tt_max bigint,
              all_posts integer, all_med numeric, all_max bigint,
              approuvees integer, en_stock integer, dernier_post date,
              ex_url text, ex_poster text, ex_source text, ex_vues bigint, ex_lien text, ex_date date, ex_note text,
              top_vues bigint, top_lien text, top_source text, top_date date)
language plpgsql stable security definer set search_path = public as $$
declare pub constant text := 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/';
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid()
                 and (coalesce(p.is_owner, false) or lower(coalesce(p.plan, '')) = 'developer')) then
    raise exception 'réservé au propriétaire' using errcode = '42501';
  end if;
  return query
  with dern as (select distinct on (s.media_id) s.media_id, s.views, s.posted_at, s.combo, coalesce(s.combo->>'vf', substring(s.vf from '^(VF-[0-9]+)')) vf, s.permalink
                from public.ig_media_stats s order by s.media_id, s.day desc),
  j2 as (select distinct on (s.media_id) s.media_id, s.views v2 from public.ig_media_stats s join dern d using (media_id)
         where s.day >= (d.posted_at at time zone 'Europe/Paris')::date + 2 order by s.media_id, s.day),
  ig as (select public.factory_format_de(d.combo) f, d.views, j2.v2, d.posted_at, d.vf, d.permalink
         from dern d left join j2 using (media_id) where d.combo is not null),
  tt as (select public.factory_format_de(coalesce(
                  (select d.combo from dern d where d.vf = t.vf and d.combo is not null limit 1),
                  (select q.brick_combo from public.factory_qc q
                    where q.video_url like '%/' || t.vf || '\_%' or q.video_url like '%/' || t.vf || '.mp4' limit 1))) f,
                t.views, t.created, t.vf, t.share_url
         from public.tiktok_videos t where t.vf is not null),
  tout as (select ig.f, ig.v2 v from ig where ig.v2 is not null union all select tt.f, tt.views from tt where tt.f is not null),
  cand as (select ig.f, ig.views v, ig.vf, ig.permalink lien, ig.posted_at::date d, 'instagram'::text src from ig
           union all select tt.f, tt.views, tt.vf, tt.share_url, tt.created::date, 'tiktok' from tt where tt.f is not null),
  candf as (select c.*, o.name obj from cand c
            left join lateral (select so.name from storage.objects so where so.bucket_id = 'factory-media' and c.vf is not null
                                 and (so.name like 'final/' || c.vf || '\_%' or so.name like 'stock/' || c.vf || '\_%')
                                 and so.name like '%.mp4' order by so.name like 'final/%' desc limit 1) o on true),
  best as (select distinct on (candf.f) candf.f, candf.v, candf.lien, candf.d, candf.src, candf.obj from candf
           where candf.obj is not null order by candf.f, candf.v desc nulls last),
  top as (select distinct on (candf.f) candf.f, candf.v, candf.lien, candf.d, candf.src from candf
          order by candf.f, candf.v desc nulls last),
  qcall as (select public.factory_format_de(q.brick_combo) f, q.video_url, q.poster_url, q.status, q.created_at from public.factory_qc q),
  -- vidéo de la revue dont le FICHIER existe encore (les rendus refusés / anciens sont purgés du stockage)
  qx as (select distinct on (qcall.f) qcall.f, qcall.video_url, qcall.poster_url, qcall.status from qcall
         where qcall.f is not null and qcall.video_url like pub || '%'
           and exists (select 1 from storage.objects so where so.bucket_id = 'factory-media' and so.name = substr(qcall.video_url, length(pub) + 1))
         order by qcall.f, (qcall.status = 'approved') desc, qcall.created_at desc),
  qc as (select qcall.f, count(*) n from qcall where qcall.status = 'approved' group by 1),
  st as (select public.factory_format_de(p.combo) f, count(*) n from public.factory_posts p where p.status = 'todo' group by 1)
  select ff.id, ff.famille, ff.nom, ff.description, ff.ordre, ff.statut,
         (select count(*)::int from ig where ig.f = ff.id),
         (select round(percentile_cont(0.5) within group (order by ig.v2)::numeric) from ig where ig.f = ff.id and ig.v2 is not null),
         (select max(ig.views) from ig where ig.f = ff.id),
         (select count(*)::int from tt where tt.f = ff.id),
         (select round(percentile_cont(0.5) within group (order by tt.views)::numeric) from tt where tt.f = ff.id),
         (select max(tt.views) from tt where tt.f = ff.id),
         (select count(*)::int from ig where ig.f = ff.id) + (select count(*)::int from tt where tt.f = ff.id),
         (select round(percentile_cont(0.5) within group (order by tout.v)::numeric) from tout where tout.f = ff.id),
         greatest((select max(ig.views) from ig where ig.f = ff.id), (select max(tt.views) from tt where tt.f = ff.id)),
         coalesce((select qc.n::int from qc where qc.f = ff.id), 0),
         coalesce((select st.n::int from st where st.f = ff.id), 0),
         greatest((select max(ig.posted_at)::date from ig where ig.f = ff.id), (select max(tt.created)::date from tt where tt.f = ff.id)),
         coalesce(pub || b.obj, x.video_url, ff.exemple_url),
         case when b.obj is not null then pub || regexp_replace(b.obj, '\.mp4$', '-poster.jpg')
              when x.video_url is not null then x.poster_url else ff.exemple_poster end,
         case when b.obj is not null then b.src when x.video_url is not null then (case when x.status = 'approved' then 'stock' else 'refusee' end)
              when ff.exemple_url is not null then 'test' end,
         b.v, b.lien, b.d,
         case when b.obj is null and x.video_url is null then ff.exemple_note end,
         t.v, t.lien, t.src, t.d
  from public.factory_formats ff
  left join best b on b.f = ff.id
  left join top t on t.f = ff.id
  left join qx x on x.f = ff.id
  order by ff.ordre;
end $$;
revoke all on function public.factory_format_stats() from public, anon;
grant execute on function public.factory_format_stats() to authenticated;
