-- Chef d'orchestre en tâche de fond (10/10) : orchestrate répond par un job_id, travaille en arrière-plan
-- (EdgeRuntime.waitUntil) et écrit ici son résultat ; l'app suit SA ligne (RLS). Écriture : service seulement.
create table if not exists public.orchestrate_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orchestrate_jobs_user_created on public.orchestrate_jobs (user_id, created_at desc);
alter table public.orchestrate_jobs enable row level security;
drop policy if exists orchestrate_jobs_lecture on public.orchestrate_jobs;
create policy orchestrate_jobs_lecture on public.orchestrate_jobs for select to authenticated using (user_id = auth.uid());
revoke all on public.orchestrate_jobs from anon;
revoke insert, update, delete on public.orchestrate_jobs from authenticated;
grant select on public.orchestrate_jobs to authenticated;
grant all on public.orchestrate_jobs to service_role;
