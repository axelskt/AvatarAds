-- Relevé quotidien des réseaux hors Instagram (29/09/2026). L'API YouTube (clé publique) ne donne que les totaux du jour :
-- on garde un relevé par jour pour tracer les abonnés dans le temps (Instagram a déjà son historique dans ig_daily_insights).
-- Écrit par l'edge yt-stats (service role) ; lu par le dashboard (owner/dev).
create table if not exists public.social_daily (
  platform    text not null check (platform in ('youtube','tiktok')),
  account     text not null,
  day         date not null,
  subscribers bigint,
  views       bigint,
  videos      integer,
  updated_at  timestamptz not null default now(),
  primary key (platform, account, day)
);
alter table public.social_daily enable row level security;
drop policy if exists social_daily_owner_read on public.social_daily;
create policy social_daily_owner_read on public.social_daily for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner,false) or lower(coalesce(p.plan,''))='developer')));
revoke all on public.social_daily from anon;
