-- Comptes TikTok : @ saisi à la main dans Factory V2 (06/10/2026). L'app TikTok n'a que user.info.basic (nom affiché,
-- pas de username) ; le @ est écrit par l'edge tiktok-auth?action=handle (owner / developer) et lisible côté client
-- par un grant de colonne explicite (la liste blanche de 20261003080000 n'inclut jamais une colonne ajoutée après).
alter table public.tiktok_accounts add column if not exists handle text;
alter table public.tiktok_accounts drop constraint if exists tiktok_accounts_handle_chk;
alter table public.tiktok_accounts add constraint tiktok_accounts_handle_chk
  check (handle is null or handle ~ '^[A-Za-z0-9._]{2,24}$');
grant select (handle) on table public.tiktok_accounts to authenticated;
