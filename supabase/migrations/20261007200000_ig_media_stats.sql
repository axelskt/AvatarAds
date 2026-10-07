-- 07/10 (Axel : « enregistre les chaque jour ») : vues Instagram PAR PUBLICATION, une ligne par jour et par vidéo, pour
-- comparer les formats dans le temps (hypothèse du 07/10 : Instagram / YouTube freinent les visages animés par IA —
-- lipsync Character-3 0-329 vues contre 658-2 400 pour les avant / après). Avant, ces chiffres n'étaient lus qu'en direct
-- par le dashboard (ig-insights) et jamais gardés. Relevé : ig-insights?part=snapshot, appelé par pg_cron une fois par jour
-- (clé x-cron-key du coffre Vault = secret CRON_SECRET de l'edge, jamais en clair ici). Lien avec la recette :
-- factory_posts.media_id = ig_media_stats.media_id.
create table if not exists public.ig_media_stats (
  media_id       text        not null,
  day            date        not null,             -- jour du relevé (Europe/Paris)
  account        text        not null,             -- @ du compte
  posted_at      timestamptz,
  media_type     text,                             -- REELS, FEED…
  permalink      text,
  caption        text,
  views          bigint,
  reach          bigint,
  likes          bigint,
  comments       bigint,
  shares         bigint,
  saved          bigint,
  interactions   bigint,
  avg_watch_s    numeric,
  skip_rate      numeric,                          -- brut de l'API (échelle 0-1 ou 0-100 selon la réponse)
  shared_to_feed boolean,                          -- false = réel d'essai (pas sur la grille du profil)
  vf             text,                             -- ID complet de la vidéo de l'usine (factory_posts relié), sinon null
  combo          jsonb,                            -- recette (avatar, hook, liaison, démo, CTA, format…)
  fetched_at     timestamptz not null default now(),
  primary key (media_id, day)
);
alter table public.ig_media_stats add column if not exists vf text, add column if not exists combo jsonb;
create index if not exists ig_media_stats_account_day on public.ig_media_stats (account, day);

alter table public.ig_media_stats enable row level security;
drop policy if exists ig_media_stats_owner_read on public.ig_media_stats;
create policy ig_media_stats_owner_read on public.ig_media_stats for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner, false) or lower(coalesce(p.plan, '')) = 'developer'))
);
revoke all on public.ig_media_stats from anon;
grant select on public.ig_media_stats to authenticated;

-- relevé quotidien à 23 h 40 (Paris, heure d'été = 21 h 40 UTC)
select cron.unschedule('ig-media-stats-daily') where exists (select 1 from cron.job where jobname = 'ig-media-stats-daily');
select cron.schedule('ig-media-stats-daily', '40 21 * * *', $$
  select net.http_get(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/ig-insights?part=snapshot',
    headers := jsonb_build_object(
      'apikey', 'sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck',
      'Authorization', 'Bearer sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)
    ),
    timeout_milliseconds := 120000
  );
$$);
