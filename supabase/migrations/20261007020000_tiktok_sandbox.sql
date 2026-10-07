-- 07/10 : comptes TikTok reliés à l'app de TEST (Sandbox) pour les stats (scopes user.info.profile, user.info.stats,
-- video.list, pas encore revus en production). Table SÉPARÉE de tiktok_accounts : un jeton Sandbox ne sert jamais aux
-- brouillons (tiktok-auth?action=post ne lit que tiktok_accounts) et la liste des comptes de production reste propre.
-- Écrite et lue uniquement par l'edge tiktok-auth (service role) : RLS active, aucune policy, aucun droit client.
create table if not exists public.tiktok_sandbox_accounts (
  open_id            text primary key,
  display_name       text,
  handle             text check (handle is null or handle ~ '^[A-Za-z0-9._]{2,24}$'),
  avatar_url         text,
  access_token       text,
  refresh_token      text,
  scope              text,
  expires_at         timestamptz,
  refresh_expires_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.tiktok_sandbox_accounts enable row level security;
revoke all on table public.tiktok_sandbox_accounts from anon, authenticated, public;
