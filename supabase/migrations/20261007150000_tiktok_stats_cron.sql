-- 07/10 (Axel : « go ») : relecture automatique des statistiques TikTok toutes les heures, même dashboard fermé — chiffres à
-- jour, nouvelles vidéos rapprochées de leur recette dans l'heure, un point par jour sur la courbe des abonnés
-- (social_daily). Même mécanisme que provider-balance-watch : clé x-cron-key lue dans le coffre Vault (= secret CRON_SECRET
-- de l'edge), jamais en clair ici. tiktok-auth n'accepte cette clé QUE pour action=stats.
select cron.unschedule('tiktok-stats-hourly') where exists (select 1 from cron.job where jobname = 'tiktok-stats-hourly');
select cron.schedule('tiktok-stats-hourly', '12 * * * *', $$
  select net.http_post(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/tiktok-auth?action=stats&force=1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck',
      'Authorization', 'Bearer sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
