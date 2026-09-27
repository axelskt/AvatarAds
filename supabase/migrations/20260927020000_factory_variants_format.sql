-- Creative Factory — vidéos d'avatar par FORMAT (Axel 27/09) : chaque brique parlée existe en 3 formats (Audio d'Axel =
-- lipsync, Voix native Omni, Texte + musique pour les textes choc), chacun avec 3 photos par avatar. factory_variants
-- gagne la colonne format ('axel' par défaut : toutes les lignes existantes sont des lipsync Hedra) et la clé devient
-- (avatar_id = la photo, brick_id, format). factory_prod_stats renvoie en plus la liste des vidéos (photo, brique, format,
-- url) pour la fiche d'une brique ; « pairs » ne compte toujours que le format lipsync (variantes du pipeline).
alter table public.factory_variants add column if not exists format text not null default 'axel';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'factory_variants_format_chk') then
    alter table public.factory_variants add constraint factory_variants_format_chk check (format in ('axel', 'omni', 'muet'));
  end if;
end $$;
alter table public.factory_variants drop constraint if exists factory_variants_pkey;
alter table public.factory_variants add constraint factory_variants_pkey primary key (avatar_id, brick_id, format);

create or replace function public.factory_prod_stats()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  ok boolean;
  v_var jsonb;
  v_mis jsonb;
begin
  select (coalesce(is_owner, false) or lower(coalesce(plan, '')) = 'developer') into ok
  from public.profiles where id = auth.uid();
  if not coalesce(ok, false) then return jsonb_build_object('error', 'forbidden'); end if;

  with v as (select to_jsonb(t) as j from public.factory_variants t),
       p as (select distinct j->>'avatar_id' as a, j->>'brick_id' as b from v
             where coalesce(j->>'avatar_id', '') <> '' and coalesce(j->>'brick_id', '') <> '' and coalesce(j->>'format', 'axel') = 'axel')
  select jsonb_build_object(
    'rows', (select count(*) from v),
    'pairs_total', (select count(*) from p),
    'pairs', coalesce((select jsonb_agg(jsonb_build_array(q.a, q.b) order by q.a, q.b)
                       from (select a, b from p order by a, b limit 5000) q), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(jsonb_build_array(t.avatar_id, t.brick_id, t.format, t.video_url) order by t.brick_id, t.format, t.created_at)
                        from (select * from public.factory_variants order by created_at limit 5000) t), '[]'::jsonb)
  ) into v_var;

  with m as (select coalesce(nullif(to_jsonb(t)->>'status', ''), 'inconnu') as st from public.factory_missions t)
  select jsonb_build_object(
    'total', (select count(*) from m),
    'by_status', coalesce((select jsonb_object_agg(s.st, s.n) from (select st, count(*) as n from m group by st) s), '{}'::jsonb)
  ) into v_mis;

  return jsonb_build_object('variants', v_var, 'missions', v_mis, 'at', now());
end $function$;
