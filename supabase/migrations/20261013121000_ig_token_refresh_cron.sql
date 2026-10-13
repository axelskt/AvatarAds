-- 13/10 — renouvellement quotidien des tokens Instagram de nos comptes (edge ig-token-refresh, voir son en-tête).
-- Même clé de cron que les autres filets (Vault 'email_drip_cron_key' = CRON_SECRET). Idempotent (cron.schedule par nom).
select cron.schedule('ig-token-refresh-daily', '13 5 * * *', $cron$
  select net.http_post(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/ig-token-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
