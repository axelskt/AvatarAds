-- 07/10 (Axel : « go ») : relecture des stats YouTube toutes les heures, même dashboard fermé — un point par jour sur la
-- courbe des abonnés (social_daily). Quota YouTube Data API : ~3 unités par appel, ~72 / jour sur 10 000.
-- Clé x-cron-key lue dans le coffre Vault (= secret CRON_SECRET de l'edge), jamais en clair ici.
select cron.unschedule('yt-stats-hourly') where exists (select 1 from cron.job where jobname = 'yt-stats-hourly');
select cron.schedule('yt-stats-hourly', '14 * * * *', $$
  select net.http_get(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/yt-stats',
    headers := jsonb_build_object(
      'apikey', 'sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck',
      'Authorization', 'Bearer sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)
    ),
    timeout_milliseconds := 60000
  );
$$);
