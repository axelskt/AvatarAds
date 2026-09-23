-- Nettoyage périodique pg_net + historique pg_cron (23/09/2026).
-- Constat : net._http_response pesait 1,26 Go pour ~17 Mo de vraies données. pg_net y écrit depuis un worker
-- de fond dont les écritures ne remontent pas dans les statistiques → l'autovacuum ne s'est JAMAIS déclenché,
-- et l'espace des réponses purgées (TTL pg_net = 6 h) n'était jamais réutilisé. Principal écrivain : la tâche
-- mcp-keepwarm (9 requêtes toutes les 20 s, gardée volontairement : elle garde le MCP Claude réactif).
-- Conséquence : le disque Supabase a été étendu automatiquement de 2 à 8 Go.
-- Correctif : VACUUM horaire de net._http_response (garde l'historique 6 h, réutilise l'espace) + purge
-- quotidienne de cron.job_run_details au-delà de 7 jours (97 650 lignes depuis le 23/08) puis VACUUM.
do $$ begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('pgnet-response-vacuum', 'cron-history-purge', 'cron-history-vacuum');
end $$;
select cron.schedule('pgnet-response-vacuum', '41 * * * *', 'VACUUM net._http_response');
select cron.schedule('cron-history-purge', '23 4 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
select cron.schedule('cron-history-vacuum', '33 4 * * *', 'VACUUM cron.job_run_details');
