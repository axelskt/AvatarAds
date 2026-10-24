-- Décupleur (Axel 25/10) : purge AUTOMATIQUE des fichiers du Décupleur dans render-media. Ce sont des fichiers de travail :
-- l'utilisateur télécharge ses variantes (liens signés 2 h, lot retrouvé jusqu'à 3 h), rien ne les range en Bibliothèque.
--   • 3 jours : sources importées (<uid>/dc-src-*), lots de variantes (<uid>/dc-<job>/ : vidéos, affiches, ZIP, manifeste),
--     vidéos récupérées par lien et passages découpés (sorties <uid>/<job>.mp4 des jobs dc-fetch / dc-cut), vidéos du
--     changement de personnage (résultat wan-3 rapatrié <uid>/kie/<tâche>.mp4, copies MCP <uid>/mcp-src/<job>-perso|prep.mp4),
--     vidéos préparées des outils MCP (mcp-prep/<uid>/ : supprimées en fin de job, un job ne dure jamais 3 jours) ;
--   • 1 jour : copies servies aux moteurs (fal-in/<uid>/) — leur lien signé expire au bout d'une heure, nettoyerCopiesFal les
--     supprime déjà à la soumission suivante de l'utilisateur ; ici on rattrape la dernière copie de chacun.
-- JAMAIS un fichier rangé en Bibliothèque (library_items / kie_jobs.library_id : le filet reconcile-kie range une vidéo de
-- personnage abandonnée dans <uid>/lib/, dossier que cette liste ne vise pas — le garde reste là en cas de changement).
-- Tous les comptes, owner compris (fichiers jetables). Exécutée chaque nuit par pg_cron « decupleur-purge » → purge-decupleur.
create or replace function public.list_decupleur_purge(p_limit integer default 500)
returns table(bucket_id text, name text, motif text)
language sql security definer set search_path = public, storage as $$
  select t.bucket_id, t.name, t.motif from (
    select o.bucket_id, o.name, 'source > 3 j'::text as motif from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '3 days'
       and o.name ~ '^[0-9a-f-]{36}/dc-src-[0-9]+\.(mp4|mov|webm|m4v)$'
    union all
    select o.bucket_id, o.name, 'variantes > 3 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '3 days'
       and o.name ~ '^[0-9a-f-]{36}/dc-[0-9a-f-]{36}/(v[0-9]{2}\.(mp4|jpg)|variantes\.zip|dc\.json)$'
    union all
    select o.bucket_id, o.name, 'lien / passage > 3 j' from public.render_jobs j
      join storage.objects o on o.bucket_id = 'render-media'
       and o.name in (j.user_id::text || '/' || j.id::text || '.mp4', j.user_id::text || '/' || j.id::text || '.mp4.poster.jpg')
     where j.plan->>'__compose' in ('dc-fetch', 'dc-cut') and j.created_at < now() - interval '3 days'
       and o.created_at < now() - interval '3 days'
    union all
    select o.bucket_id, o.name, 'personnage > 3 j' from public.kie_jobs k
      join storage.objects o on o.bucket_id = 'render-media' and o.name = k.storage_path
     where k.alias = 'wan-3' and k.library_id is null and k.storage_path ~ '^[0-9a-f-]{36}/kie/'
       and o.created_at < now() - interval '3 days'
    union all
    select o.bucket_id, o.name, 'personnage > 3 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '3 days'
       and o.name ~ '^[0-9a-f-]{36}/mcp-src/[0-9a-f-]{36}-(perso|prep)\.mp4$'
    union all
    select o.bucket_id, o.name, 'préparée > 3 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '3 days'
       and o.name ~ '^mcp-prep/[0-9a-f-]{36}/'
    union all
    select o.bucket_id, o.name, 'temporaire > 1 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '1 day'
       and o.name ~ '^fal-in/[0-9a-f-]{36}/'
  ) t
  where not exists (select 1 from public.library_items li where li.storage_path in (t.name, 'render-media/' || t.name))
  limit greatest(1, least(1000, coalesce(p_limit, 500)))
$$;
revoke all on function public.list_decupleur_purge(integer) from public, anon, authenticated;
grant execute on function public.list_decupleur_purge(integer) to service_role;
