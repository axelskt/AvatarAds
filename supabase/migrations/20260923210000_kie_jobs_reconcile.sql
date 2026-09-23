-- Filet kie.ai (23/09/2026) : ne jamais perdre une génération kie déjà payée.
-- kie-proxy note chaque tâche lancée par un user ('pending'), la passe à 'fetched' quand il copie le résultat pour
-- l'app, et l'app confirme ('saved', route /ack) une fois rangée. reconcile-kie (pg_cron, toutes les 10 min) reprend les
-- 'fetched' sans accusé depuis > 2 h (range la copie déjà faite), et les
-- 'pending' de plus de 45 min (l'app attend au plus ~30 min, latence comprise) : chaque tâche est d'abord RÉSERVÉE
-- ('saving'), puis réussie → rapatriée + ligne library_items ('saved') ; échouée → 'failed' ; en cours > 6 h ou
-- introuvable > 24 h → 'expired' ; copie impossible 6 fois (ou > 24 h) → 'failed' (plus jamais bloquante).
create table if not exists public.kie_jobs (
  task_id      text primary key,                          -- request_id kie-proxy : 'mk-<taskId>' | 'veo-<taskId>'
  user_id      uuid not null references auth.users(id) on delete cascade,
  alias        text not null,                             -- nano-banana-pro, veo3-lite, kling-3.0-mc…
  label        text,                                      -- nom affiché en Bibliothèque si le filet la range
  state        text not null default 'pending' check (state in ('pending', 'fetched', 'saving', 'saved', 'failed', 'expired')),
  attempts     integer not null default 0,                -- essais du filet (download / copie / insert ratés)
  last_error   text,
  storage_path text,
  library_id   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists kie_jobs_open_idx on public.kie_jobs (state, updated_at) where state in ('pending', 'fetched', 'saving');
alter table public.kie_jobs enable row level security;   -- aucune policy : service_role uniquement (edge functions)
revoke all on public.kie_jobs from anon, authenticated;

-- pg_cron → reconcile-kie (POST + x-cron-key, même secret Vault que reconcile-fal-orphans / email-drip).
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'kie-reconcile';
end $$;
select cron.schedule('kie-reconcile', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/reconcile-kie',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
