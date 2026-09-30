-- File d'attente des rendus de vidéos finales sur Railway (usine/railway-render.mjs, 30/09) : chaque machine prend UN
-- rendu à la fois (passage queued → running atomique) ; l'état vit ici, plus dans la mémoire d'une machine.
create table if not exists public.factory_render_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  recipe jsonb not null,
  result jsonb,
  error text,
  worker text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists factory_render_jobs_queue on public.factory_render_jobs (created_at) where status = 'queued';
alter table public.factory_render_jobs enable row level security;   -- clé service uniquement (aucune policy)
