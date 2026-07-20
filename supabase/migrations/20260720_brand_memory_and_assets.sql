-- ═══════════════════════════════════════════════════════════════
-- #124 · MÉMOIRE DE MARQUE (par utilisateur)   — appliquée le 20/07/2026
-- Fiche persistante réutilisée par le chef d'orchestre : l'user ne
-- retape plus son business / site / offres / ton à chaque montage.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.brand_memory (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  summary         text        not null default '',            -- texte injecté dans le prompt (éditable par l'user)
  facts           jsonb       not null default '{}'::jsonb,   -- champs structurés (business, features[], reseaux{}, ton, cta…)
  site_url        text,
  site_cache      text,                                       -- cache du scrape (évite de re-crawler à chaque montage)
  site_fetched_at timestamptz,
  auto_learn      boolean     not null default true,          -- enrichissement auto après chaque montage
  learned_count   int         not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint brand_memory_summary_len check (char_length(summary) <= 4000),
  constraint brand_memory_facts_size  check (pg_column_size(facts) <= 12000),
  constraint brand_memory_site_len    check (site_url is null or char_length(site_url) <= 300),
  constraint brand_memory_cache_len   check (site_cache is null or char_length(site_cache) <= 6000)
);

alter table public.brand_memory enable row level security;

drop policy if exists brand_memory_select_own on public.brand_memory;
create policy brand_memory_select_own on public.brand_memory
  for select to authenticated using (user_id = auth.uid());

drop policy if exists brand_memory_insert_own on public.brand_memory;
create policy brand_memory_insert_own on public.brand_memory
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists brand_memory_update_own on public.brand_memory;
create policy brand_memory_update_own on public.brand_memory
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- privilèges COLONNE : la vraie barrière (cf. audit 19/07). learned_count reste serveur-only.
revoke all on table public.brand_memory from anon, authenticated;
grant select on table public.brand_memory to authenticated;
grant insert (user_id, summary, facts, site_url, site_cache, site_fetched_at, auto_learn) on table public.brand_memory to authenticated;
grant update (summary, facts, site_url, site_cache, site_fetched_at, auto_learn)          on table public.brand_memory to authenticated;

create or replace function public.brand_memory_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists brand_memory_touch_t on public.brand_memory;
create trigger brand_memory_touch_t before update on public.brand_memory
  for each row execute function public.brand_memory_touch();

-- ═══════════════════════════════════════════════════════════════
-- VISUELS ENREGISTRÉS : logo / photos produit réutilisés en b-roll
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.brand_assets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'image' check (kind in ('image', 'video', 'logo')),
  name       text not null default '',
  label      text not null default '',        -- ce que ça montre (lu par le chef d'orchestre)
  path       text not null,                   -- <uid>/<uuid>.<ext> dans le bucket brand-assets
  auto       boolean not null default true,   -- proposé/coché par défaut sur chaque montage
  created_at timestamptz not null default now(),
  constraint brand_assets_name_len  check (char_length(name)  <= 120),
  constraint brand_assets_label_len check (char_length(label) <= 200),
  constraint brand_assets_path_len  check (char_length(path)  <= 400)
);

create index if not exists brand_assets_user_idx on public.brand_assets(user_id, created_at desc);

alter table public.brand_assets enable row level security;

drop policy if exists brand_assets_select_own on public.brand_assets;
create policy brand_assets_select_own on public.brand_assets
  for select to authenticated using (user_id = auth.uid());

drop policy if exists brand_assets_insert_own on public.brand_assets;
create policy brand_assets_insert_own on public.brand_assets
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists brand_assets_update_own on public.brand_assets;
create policy brand_assets_update_own on public.brand_assets
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists brand_assets_delete_own on public.brand_assets;
create policy brand_assets_delete_own on public.brand_assets
  for delete to authenticated using (user_id = auth.uid());

revoke all on table public.brand_assets from anon, authenticated;
grant select, delete on table public.brand_assets to authenticated;
grant insert (id, user_id, kind, name, label, path, auto) on table public.brand_assets to authenticated;
grant update (name, label, auto)                          on table public.brand_assets to authenticated;

-- plafond : 40 visuels enregistrés par utilisateur
create or replace function public.brand_assets_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.brand_assets where user_id = new.user_id) >= 40 then
    raise exception 'Limite atteinte : 40 visuels enregistrés maximum';
  end if;
  return new;
end $$;

drop trigger if exists brand_assets_cap_t on public.brand_assets;
create trigger brand_assets_cap_t before insert on public.brand_assets
  for each row execute function public.brand_assets_cap();

-- bucket privé, même schéma d'accès que render-media (dossier = uid)
insert into storage.buckets (id, name, public, file_size_limit)
values ('brand-assets', 'brand-assets', false, 26214400)
on conflict (id) do nothing;

drop policy if exists brand_assets_user_upload on storage.objects;
create policy brand_assets_user_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists brand_assets_user_read on storage.objects;
create policy brand_assets_user_read on storage.objects
  for select to authenticated
  using (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists brand_assets_user_delete on storage.objects;
create policy brand_assets_user_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text);
