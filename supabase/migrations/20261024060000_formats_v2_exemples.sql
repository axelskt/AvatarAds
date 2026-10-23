-- 24/10/2026 (Axel, carte Formats : « soit précis, je ne sais pas quel format c'est », « met une option tout »,
-- « met un truc voir l'exemple », « ajoute aussi split screen même si pas encore posté », « y'a d'autre format ? ») :
-- 1) noms et descriptions qui disent ce qu'on VOIT dans la vidéo ; + 2 formats oubliés (rafale en voix off, aimée le 14/10 ;
--    tes têtes choquées R-AX, 23/10, réservées au nouveau compte) ;
-- 2) exemple de chaque format : la vidéo publiée la plus vue (fichier final/ ou stock/ de son VF), sinon une vidéo du stock
--    (approuvée d'abord), sinon un test enregistré à la main (exemple_url) ;
-- 3) factory_format_stats renvoie aussi le total « Tout » (Instagram à J+2 + TikTok) et l'exemple.

alter table public.factory_formats add column if not exists exemple_url text;
alter table public.factory_formats add column if not exists exemple_poster text;
alter table public.factory_formats add column if not exists exemple_note text;

insert into public.factory_formats (id, famille, nom, description, ordre, statut, exemple_url, exemple_poster, exemple_note) values
  ('F-AP-CLASSIQUE', 'Avatar qui parle', 'Avatar qui parle + démo',
   'Un avatar IA dit la phrase d''accroche face caméra avec sa propre voix, puis démo de l''app et appel à l''action.', 10, 'actif', null, null, null),
  ('F-AP-SPLIT-A', 'Avatar qui parle', 'Split screen A',
   'Écran coupé en deux : un résultat de l''app en haut, l''avatar qui parle en bas ; d''autres résultats s''enchaînent en haut.', 11, 'test',
   'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/formats/exemples/F-AP-SPLIT-A.mp4',
   'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/formats/exemples/F-AP-SPLIT-A-poster.jpg',
   'Vidéo test du 23/10 (l''accroche seulement)'),
  ('F-AP-SPLIT-B', 'Avatar qui parle', 'Split screen B',
   'Même début que le split A, puis l''avatar repasse en plein écran après deux résultats.', 12, 'test',
   'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/formats/exemples/F-AP-SPLIT-B.mp4',
   'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/formats/exemples/F-AP-SPLIT-B-poster.jpg',
   'Vidéo test du 23/10 (l''accroche seulement)'),
  ('F-AP-GRILLE', 'Avatar qui parle', 'Avatar qui se multiplie',
   'Pendant l''accroche, l''avatar se duplique (1 → 4 → 16 → 64 → 256) ; seul celui du milieu parle.', 13, 'test', null, null, null),
  ('F-AP-RAFALE', 'Avatar qui parle', 'Rafale de résultats en voix off',
   '7 résultats de l''app en plein écran coupés sur la musique, la voix de l''avatar en voix off, puis la démo sans voix. Aimé le 14/10.', 14, 'test',
   null, null, null),
  ('F-VA-SIMPLE', 'Ta voix + avatar', 'Ta voix sur un avatar',
   'Ton audio enregistré, dit par un avatar IA en synchro labiale, sans image ajoutée.', 20, 'arrete', null, null, null),
  ('F-VA-ILLUS', 'Ta voix + avatar', 'Ta voix sur un avatar + images',
   'Pareil, et ce que tu cites (outil, résultat) apparaît à l''écran au moment où tu le dis.', 21, 'arrete', null, null, null),
  ('F-VA-TRANSFO', 'Ta voix + avatar', 'Ta voix sur un avatar + avant / après',
   'Pareil, avec une transformation photo avant → après montrée pendant la vidéo.', 22, 'arrete', null, null, null),
  ('F-VA-HK', 'Ta voix + avatar', 'Avant / après + ta voix off',
   'L''accroche enchaîne 2 ou 3 transformations avant → après (sans avatar) avec ta voix off par-dessus, puis la démo.', 23, 'arrete', null, null, null),
  ('F-TM-CHOQUE', 'Texte + musique', 'Tête choquée + musique',
   'Une personne réagit choquée sans parler (main sur la bouche…), phrase choc à l''écran, démo de l''app, musique.', 30, 'actif', null, null, null),
  ('F-TM-AXEL', 'Texte + musique', 'Ta tête choquée (nouveau compte)',
   'Tes 8 réactions choquées filmées le 23/10, réservées au nouveau compte : même montage que « Tête choquée + musique ».', 31, 'test',
   'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/choque/axel/R-AX-1.mp4',
   'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/choque/axel/R-AX-1-poster.jpg',
   'Ta réaction seule (R-AX-1), pas une vidéo montée'),
  ('F-TM-INSOMNIE', 'Texte + musique', 'Insomnie + musique',
   'Au lit les yeux fermés, texte « Tu essaies de dormir mais tu repenses à… », démo de l''app, musique.', 32, 'actif', null, null, null),
  ('F-TM-LIT', 'Texte + musique', 'Tête choquée au lit + musique',
   'Allongée au lit, réaction choquée, phrase choc, démo de l''app, musique.', 33, 'actif', null, null, null),
  ('F-TM-STADE', 'Texte + musique', 'Réaction dans un lieu stylé + musique',
   'Réaction satisfaite filmée en selfie dans un lieu stylé (stade…), phrase choc, démo de l''app, musique.', 34, 'actif', null, null, null),
  ('F-TM-SCOTCH', 'Texte + musique', 'Bouche scotchée + musique',
   'La personne a la bouche scotchée (elle ne peut pas parler), phrase choc, démo de l''app, musique.', 35, 'test',
   'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/scotch/tests/S-A3-1-v4.mp4', null,
   'Test de la réaction (16/10), pas une vidéo montée'),
  ('F-TC-CHOQUE', 'Texte choc sans musique', 'Tête choquée sans musique',
   'Comme « Tête choquée + musique », mais sans aucune musique : la réaction, la phrase choc, la démo.', 40, 'test', null, null, null),
  ('F-TC-PARLEE', 'Texte choc sans musique', 'Réaction choquée qui parle',
   'La personne enlève ses lunettes : « C''est quoi cette dinguerie là ? », phrase choc, démo commentée, sans musique.', 41, 'test',
   'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/choque/R-A1-1-2s.mp4', null,
   'La réaction seule (R-A1-1), pas une vidéo montée'),
  ('F-MC-FONDVERT', 'Transformation vidéo', 'Fond vert',
   'L''avatar détouré devant une transformation vidéo (Motion Control), phrase choc en haut.', 50, 'actif', null, null, null),
  ('F-MC-VOIXOFF', 'Transformation vidéo', 'Transformation en voix off',
   'Une transformation vidéo (Motion Control) commentée en voix off, sans avatar. Remplacé par le fond vert le 21/10.', 51, 'arrete', null, null, null)
on conflict (id) do update set famille = excluded.famille, nom = excluded.nom, description = excluded.description,
  ordre = excluded.ordre, exemple_url = excluded.exemple_url, exemple_poster = excluded.exemple_poster, exemple_note = excluded.exemple_note;

-- Rangement d'une recette : + R-AX (tes réactions, hors réaction parlée R-AX-8) → F-TM-AXEL. La rafale n'a pas encore de
-- recette (aucune vidéo produite) : elle aura son cas le jour où l'usine la fabrique.
create or replace function public.factory_format_de(c jsonb)
returns text language sql stable set search_path = public as $$
  select case
    when c is null then null
    when c ? 'fond_vert' then 'F-MC-FONDVERT'
    when c ? 'voix_off' then 'F-MC-VOIXOFF'
    when c->>'split' = 'A' then 'F-AP-SPLIT-A'
    when c->>'split' = 'B' then 'F-AP-SPLIT-B'
    when coalesce(c->>'hook_variant', '') ilike '%GRILLE%' then 'F-AP-GRILLE'
    when c ? 'reaction' or c->>'format' = 'F05' then case
      when c->>'reaction' like 'R-I-%' then 'F-TM-INSOMNIE'
      when c->>'reaction' like 'R-LIT%' then 'F-TM-LIT'
      when c->>'reaction' like 'R-STADE%' then 'F-TM-STADE'
      when c->>'reaction' like 'S-%' then 'F-TM-SCOTCH'
      when exists (select 1 from public.factory_bricks b where b.id = c->>'reaction' and coalesce((b.meta->>'parlee')::boolean, false)) then 'F-TC-PARLEE'
      when c->>'reaction' like 'R-AX-%' then 'F-TM-AXEL'
      when coalesce(c->>'musique', '') = '' then 'F-TC-CHOQUE'
      else 'F-TM-CHOQUE' end
    when c->>'voice' = 'axel' then case
      when c ? 'assemblage' then 'F-VA-HK'
      when c ? 'transformation' then 'F-VA-TRANSFO'
      when coalesce(c->>'illustrations', '[]') <> '[]' then 'F-VA-ILLUS'
      else 'F-VA-SIMPLE' end
    when c->>'voice' = 'omni' then 'F-AP-CLASSIQUE'
  end
$$;

drop function if exists public.factory_format_stats();
create function public.factory_format_stats()
returns table(id text, famille text, nom text, description text, ordre integer, statut text,
              ig_posts integer, ig_med numeric, ig_max bigint,
              tt_posts integer, tt_med numeric, tt_max bigint,
              all_posts integer, all_med numeric, all_max bigint,
              approuvees integer, en_stock integer, dernier_post date,
              ex_url text, ex_poster text, ex_source text, ex_vues bigint, ex_lien text, ex_date date, ex_note text)
language plpgsql stable security definer set search_path = public as $$
declare pub constant text := 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/';
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid()
                 and (coalesce(p.is_owner, false) or lower(coalesce(p.plan, '')) = 'developer')) then
    raise exception 'réservé au propriétaire' using errcode = '42501';
  end if;
  return query
  with dern as (select distinct on (s.media_id) s.media_id, s.views, s.posted_at, s.combo, s.vf, s.permalink
                from public.ig_media_stats s order by s.media_id, s.day desc),
  j2 as (select distinct on (s.media_id) s.media_id, s.views v2 from public.ig_media_stats s join dern d using (media_id)
         where s.day >= (d.posted_at at time zone 'Europe/Paris')::date + 2 order by s.media_id, s.day),
  ig as (select public.factory_format_de(d.combo) f, d.views, j2.v2, d.posted_at, coalesce(d.vf, d.combo->>'vf') vf, d.permalink
         from dern d left join j2 using (media_id) where d.combo is not null),
  tt as (select public.factory_format_de(x.c) f, t.views, t.created, t.vf, t.share_url from public.tiktok_videos t
         cross join lateral (select q.brick_combo c from public.factory_qc q
                             where q.video_url like '%/' || t.vf || '\_%' or q.video_url like '%/' || t.vf || '.mp4' limit 1) x
         where t.vf is not null),
  -- « Tout » : chaque vidéo publiée compte une fois par réseau (Instagram à J+2, TikTok vues actuelles)
  tout as (select ig.f, ig.v2 v from ig where ig.v2 is not null union all select tt.f, tt.views from tt),
  -- exemple publié : la vidéo la plus vue du format dont le fichier est dans le stockage (final/ ou stock/ de son VF)
  cand as (select ig.f, ig.views v, ig.vf, ig.permalink lien, ig.posted_at::date d, 'instagram'::text src from ig where ig.vf is not null
           union all select tt.f, tt.views, tt.vf, tt.share_url, tt.created::date, 'tiktok' from tt),
  candf as (select c.*, o.name obj from cand c
            left join lateral (select so.name from storage.objects so where so.bucket_id = 'factory-media'
                                 and (so.name like 'final/' || c.vf || '\_%' or so.name like 'stock/' || c.vf || '\_%')
                                 and so.name like '%.mp4' order by so.name like 'final/%' desc limit 1) o on true),
  best as (select distinct on (candf.f) candf.f, candf.v, candf.lien, candf.d, candf.src, candf.obj from candf
           where candf.obj is not null order by candf.f, candf.v desc),
  qcall as (select public.factory_format_de(q.brick_combo) f, q.video_url, q.poster_url, q.status, q.created_at from public.factory_qc q),
  qx as (select distinct on (qcall.f) qcall.f, qcall.video_url, qcall.poster_url, qcall.status from qcall
         where qcall.f is not null and qcall.video_url is not null order by qcall.f, (qcall.status = 'approved') desc, qcall.created_at desc),
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
         case when b.obj is null and x.video_url is null then ff.exemple_note end
  from public.factory_formats ff
  left join best b on b.f = ff.id
  left join qx x on x.f = ff.id
  order by ff.ordre;
end $$;
revoke all on function public.factory_format_stats() from public, anon;
grant execute on function public.factory_format_stats() to authenticated;
