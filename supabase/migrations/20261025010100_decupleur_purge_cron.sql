-- Décupleur (Axel 25/10) : purge chaque nuit à 4 h 53 (UTC) des fichiers de travail du Décupleur → edge purge-decupleur
-- (liste : list_decupleur_purge, 20261025010000). Même clé de cron que les autres tâches (vault email_drip_cron_key = CRON_SECRET).
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'decupleur-purge';
end $$;
select cron.schedule('decupleur-purge', '53 4 * * *', $cron$
  select net.http_post(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/purge-decupleur',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
