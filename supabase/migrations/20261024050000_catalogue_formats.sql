-- 24/10/2026 (Axel) : « noter tous les formats qu'on a et avoir la data dessus », y compris ceux pas encore publiés.
-- 1) factory_formats : le CATALOGUE des formats de contenu (famille + format), un identifiant chacun ;
-- 2) factory_format_de(recette) : range une recette (factory_qc.brick_combo / factory_posts.combo / ig_media_stats.combo)
--    dans son format d'après ses champs (fond_vert, voix_off, split, hook_variant, reaction, musique, voice…) ;
-- 3) factory_format_stats() : par format, publiés Instagram (vues à J+2, comme le rapport du 23/10) et TikTok, vidéos
--    approuvées et stock à poster. Réservé au propriétaire / développeur (même règle que les tables de l'usine).
-- Les codes F01-F05 de factory_bricks restent les STYLES de rendu (sous-titres, texte choc) : c'est une autre dimension.

create table if not exists public.factory_formats (
  id          text primary key,
  famille     text not null,
  nom         text not null,
  description text,
  ordre       integer not null default 100,
  statut      text not null default 'actif' check (statut in ('actif', 'test', 'arrete')),
  created_at  timestamptz not null default now()
);
alter table public.factory_formats enable row level security;
drop policy if exists factory_formats_owner on public.factory_formats;
create policy factory_formats_owner on public.factory_formats for all using (exists (
  select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner, false) or lower(coalesce(p.plan, '')) = 'developer')));

insert into public.factory_formats (id, famille, nom, description, ordre, statut) values
  ('F-AP-CLASSIQUE', 'Avatar qui parle', 'Hook parlé + démo', 'L''avatar dit le hook (voix native), puis la démo et le CTA.', 10, 'actif'),
  ('F-AP-SPLIT-A', 'Avatar qui parle', 'Split A · résultats qui s''enchaînent', 'Écran partagé : deux résultats « Hook démo » en haut, l''avatar en bas ; d''autres résultats prennent le relais.', 11, 'test'),
  ('F-AP-SPLIT-B', 'Avatar qui parle', 'Split B · retour plein écran', 'Écran partagé, puis l''avatar repasse en plein écran à la fin des deux résultats.', 12, 'test'),
  ('F-AP-GRILLE', 'Avatar qui parle', 'Hook grille qui se multiplie', 'L''avatar se multiplie 1 → 4 → 16 → 64 → 256, seul l''original parle.', 13, 'test'),
  ('F-VA-SIMPLE', 'Voix d''Axel + avatar', 'Voix d''Axel, simple', 'Lipsync sur la voix d''Axel, sans illustration.', 20, 'arrete'),
  ('F-VA-ILLUS', 'Voix d''Axel + avatar', 'Voix d''Axel + illustrations', 'Ce que la voix nomme arrive à l''écran.', 21, 'arrete'),
  ('F-VA-TRANSFO', 'Voix d''Axel + avatar', 'Voix d''Axel + transformation avant / après', 'Transformation Omni montrée pendant la vidéo.', 22, 'arrete'),
  ('F-VA-HK', 'Voix d''Axel + avatar', 'Voix d''Axel + hook assemblé', 'Hook construit à partir de plusieurs plans (HK).', 23, 'arrete'),
  ('F-TM-CHOQUE', 'Texte + musique', 'Tête choquée + musique', 'Réaction muette (main sur la bouche…), texte choc, démo muette, musique.', 30, 'actif'),
  ('F-TM-INSOMNIE', 'Texte + musique', 'Insomnie', 'Au lit, yeux fermés, « Tu essaies de dormir mais… », démo muette, musique.', 31, 'actif'),
  ('F-TM-LIT', 'Texte + musique', 'Tête choquée au lit', 'Allongée au lit, choquée, texte choc, démo muette, musique.', 32, 'actif'),
  ('F-TM-STADE', 'Texte + musique', 'Choqué lifestyle (stade)', 'Réaction satisfaite dans un lieu stylé, texte choc, démo.', 33, 'actif'),
  ('F-TM-SCOTCH', 'Texte + musique', 'Scotch', 'Se scotche la bouche (muet), texte choc, démo.', 34, 'test'),
  ('F-TC-CHOQUE', 'Texte choc sans musique', 'Tête choquée, texte choc, sans musique', 'Réaction muette + texte choc, aucune musique.', 40, 'test'),
  ('F-TC-PARLEE', 'Texte choc sans musique', 'Réaction choquée parlée', 'Enlève ses lunettes, « C''est quoi cette dinguerie là ? », texte choc, sans musique, démo parlée.', 41, 'test'),
  ('F-MC-FONDVERT', 'Motion Control', 'Fond vert', 'Avatar détouré devant la transformation, texte choc.', 50, 'actif'),
  ('F-MC-VOIXOFF', 'Motion Control', 'Voix off Motion Control', 'Transformation Motion Control en voix off (format arrêté le 21/10 au profit du fond vert).', 51, 'arrete')
on conflict (id) do update set famille = excluded.famille, nom = excluded.nom, description = excluded.description, ordre = excluded.ordre;

-- Format d'une recette. L'ordre des cas compte : les formats « spéciaux » (fond vert, voix off, split, grille) portent
-- aussi voice='omni' ; une réaction PARLÉE se reconnaît à sa brique (meta.parlee).
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

create or replace function public.factory_format_stats()
returns table(id text, famille text, nom text, description text, ordre integer, statut text,
              ig_posts integer, ig_med_j2 numeric, ig_moy_j2 numeric, ig_max bigint, ig_500 integer,
              tt_posts integer, tt_med numeric, tt_moy numeric, tt_max bigint,
              approuvees integer, en_stock integer, dernier_post date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid()
                 and (coalesce(p.is_owner, false) or lower(coalesce(p.plan, '')) = 'developer')) then
    raise exception 'réservé au propriétaire' using errcode = '42501';
  end if;
  return query
  with dern as (select distinct on (s.media_id) s.media_id, s.views, s.posted_at, s.combo from public.ig_media_stats s order by s.media_id, s.day desc),
  j2 as (select distinct on (s.media_id) s.media_id, s.views v2 from public.ig_media_stats s join dern d using (media_id)
         where s.day >= (d.posted_at at time zone 'Europe/Paris')::date + 2 order by s.media_id, s.day),
  ig as (select public.factory_format_de(d.combo) f, d.views, j2.v2, d.posted_at from dern d left join j2 using (media_id) where d.combo is not null),
  tt as (select public.factory_format_de(x.c) f, t.views, t.created from public.tiktok_videos t
         cross join lateral (select q.brick_combo c from public.factory_qc q
                             where q.video_url like '%/' || t.vf || '\_%' or q.video_url like '%/' || t.vf || '.mp4' limit 1) x
         where t.vf is not null),
  qc as (select public.factory_format_de(q.brick_combo) f, count(*) n from public.factory_qc q where q.status = 'approved' group by 1),
  st as (select public.factory_format_de(p.combo) f, count(*) n from public.factory_posts p where p.status = 'todo' group by 1)
  select ff.id, ff.famille, ff.nom, ff.description, ff.ordre, ff.statut,
         (select count(*)::int from ig where ig.f = ff.id),
         (select round(percentile_cont(0.5) within group (order by ig.v2)::numeric) from ig where ig.f = ff.id and ig.v2 is not null),
         (select round(avg(ig.v2)) from ig where ig.f = ff.id and ig.v2 is not null),
         (select max(ig.views) from ig where ig.f = ff.id),
         (select count(*)::int from ig where ig.f = ff.id and ig.views >= 500),
         (select count(*)::int from tt where tt.f = ff.id),
         (select round(percentile_cont(0.5) within group (order by tt.views)::numeric) from tt where tt.f = ff.id),
         (select round(avg(tt.views)) from tt where tt.f = ff.id),
         (select max(tt.views) from tt where tt.f = ff.id),
         coalesce((select qc.n::int from qc where qc.f = ff.id), 0),
         coalesce((select st.n::int from st where st.f = ff.id), 0),
         greatest((select max(ig.posted_at)::date from ig where ig.f = ff.id), (select max(tt.created)::date from tt where tt.f = ff.id))
  from public.factory_formats ff
  order by ff.ordre;
end $$;
revoke all on function public.factory_format_stats() from public, anon;
grant execute on function public.factory_format_stats() to authenticated;
revoke all on function public.factory_format_de(jsonb) from public, anon;
grant execute on function public.factory_format_de(jsonb) to authenticated, service_role;
