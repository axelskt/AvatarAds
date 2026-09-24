-- Creative Factory v2 (24/09/2026, demande d'Axel) : reconnaître les briques (hook, liaison, CTA) de CHAQUE publication.
-- ig-insights transcrit l'audio du reel une seule fois (whisper-1) en tâche de fond, puis le compare au texte des briques
-- (factory_bricks.meta.transcript, transcrit lui aussi une fois depuis l'audio de la brique). Service role seulement.
create table if not exists public.ig_media_analysis (
  ig_media_id   text primary key,
  status        text not null default 'running' check (status in ('running','done','error')),
  transcript    text,
  segments      jsonb,          -- [{s, e, t}] segments horodatés (secondes)
  bricks        jsonb,          -- [{kind, id, score}] briques reconnues (score 0-1)
  module        text,           -- module déduit du hook reconnu (sinon null)
  error         text,
  audio_seconds numeric,
  started_at    timestamptz not null default now(),
  analyzed_at   timestamptz
);
alter table public.ig_media_analysis enable row level security;   -- aucune policy : ig-insights (service role) seulement
revoke all on table public.ig_media_analysis from anon, authenticated;
