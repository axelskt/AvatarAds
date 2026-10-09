-- 09/10/2026 — « Cloner l'audio de la vidéo » (Motion Control) : fichiers temporaires sous render-media/voix-prep/<uid>/…
-- (voix convertie par ElevenLabs + copie verrouillée de la vidéo, hors de portée du compte). Relecture adverse 09/10 : ils
-- échappaient à la suppression de compte (list_user_objects) et à la purge (list_media_purge). CREATE OR REPLACE garde les
-- droits existants (EXECUTE service_role seulement).

create or replace function public.list_user_objects(p_user uuid)
 returns table(bucket_id text, name text)
 language sql
 security definer
 set search_path to 'public', 'storage'
as $function$
  select o.bucket_id, o.name from storage.objects o
   where p_user is not null and o.bucket_id in ('mcp-media', 'render-media', 'brand-assets')
     and o.name like p_user::text || '/%'
  union all
  select o.bucket_id, o.name from storage.objects o
   where p_user is not null and o.bucket_id = 'render-media'
     and (o.name like 'mcp-prep/' || p_user::text || '/%' or o.name like 'fal-in/' || p_user::text || '/%'
          or o.name like 'voix-prep/' || p_user::text || '/%')
$function$;

CREATE OR REPLACE FUNCTION public.list_media_purge(p_limit integer DEFAULT 500)
 RETURNS TABLE(bucket_id text, name text, motif text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
  with illimites as (
    select id::text as uid from public.profiles where coalesce(is_owner, false) or lower(coalesce(plan, '')) = 'developer'
  )
  select * from (
    select o.bucket_id, o.name, 'envoyé > 7 j'::text from storage.objects o
     where o.bucket_id = 'mcp-media' and o.created_at < now() - interval '7 days'
       and o.name ~ '^[0-9a-f-]{36}/((ref|omni)-|mcp-src/)' and split_part(o.name, '/', 1) not in (select uid from illimites)
    union all
    select o.bucket_id, o.name, 'envoyé > 7 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '7 days'
       and o.name ~ '^[0-9a-f-]{36}/(mcp-veo|mcp-src|mcp-retouche)/' and split_part(o.name, '/', 1) not in (select uid from illimites)
    union all
    -- Audit 02/10 (C4) : vidéo préparée par le render-worker et copie servie à fal, hors du dossier du compte
    select o.bucket_id, o.name, 'temporaire > 7 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '7 days'
       and o.name ~ '^(mcp-prep|fal-in)/[0-9a-f-]{36}/' and split_part(o.name, '/', 2) not in (select uid from illimites)
    union all
    -- 09/10 « Cloner l'audio » (Motion Control) : voix convertie + copie de la vidéo, hors du dossier du compte ; le worker les
    -- supprime à la fin du job → ne restent que les orphelins (job jamais pris, worker tué) : 1 jour suffit, compte illimité compris
    select o.bucket_id, o.name, 'temporaire > 1 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '1 day'
       and o.name ~ '^voix-prep/[0-9a-f-]{36}/'
    union all
    select o.bucket_id, o.name, 'généré > 30 j' from storage.objects o
     where o.bucket_id = 'mcp-media' and o.created_at < now() - interval '30 days'
       and o.name ~ '^[0-9a-f-]{36}/[0-9]{10,}-[a-z0-9]{3,10}\.(png|jpe?g|webp|mp4|mp3|wav)$'
       and split_part(o.name, '/', 1) not in (select uid from illimites)
  ) t
  limit greatest(1, least(1000, coalesce(p_limit, 500)))
$function$;
