-- Kit de publication (29/09/2026) : Axel programme lui-même ses reels dans l'app Instagram (programmation native,
-- musique tendance possible, jamais d'API de publication). Une ligne = un post prévu : la vidéo finale, la légende à
-- coller, le compte et l'heure. Quand il a programmé, il valide → on sait ce qui est calé, on suit le rythme 5/jour
-- (3 @avataradss + 2 @leoadsia) et on relie ensuite chaque post à ses stats.
create table if not exists public.factory_posts (
  id            uuid primary key default gen_random_uuid(),
  scheduled_at  timestamptz not null,                 -- heure de programmation (Europe/Paris côté affichage)
  platform      text not null default 'instagram' check (platform in ('instagram','tiktok','youtube')),
  account       text not null,                        -- @ sans arobase : avataradss, leoadsia…
  video_url     text not null,                        -- vidéo finale (factory-media/final/…)
  caption       text not null default '',
  combo         jsonb not null default '{}'::jsonb,   -- {avatar, hook, liaison, demo, cta} : pas deux fois le même hook le même jour
  status        text not null default 'todo' check (status in ('todo','scheduled','published','skipped')),
  done_at       timestamptz,                          -- validé « programmé » par Axel
  media_id      text,                                 -- id Instagram/TikTok/YouTube une fois publié (suivi des stats)
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists factory_posts_when on public.factory_posts (scheduled_at);
create index if not exists factory_posts_status on public.factory_posts (status, scheduled_at);

alter table public.factory_posts enable row level security;
drop policy if exists factory_posts_owner on public.factory_posts;
create policy factory_posts_owner on public.factory_posts for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner,false) or lower(coalesce(p.plan,''))='developer')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner,false) or lower(coalesce(p.plan,''))='developer')));
revoke all on public.factory_posts from anon;
