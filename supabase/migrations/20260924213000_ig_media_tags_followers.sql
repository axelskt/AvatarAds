-- Creative Factory v2 (24/09/2026, retours d'Axel)
-- 1) Module de chaque publication Instagram (« quelle vidéo = quelles briques ») : saisi par le propriétaire dans le
--    dashboard (RPC ig_media_tag_set), lu par ig-insights (service role). En attendant la reconnaissance automatique
--    des vidéos postées, c'est la seule source : jamais deviné.
create table if not exists public.ig_media_tags (
  ig_media_id text primary key,
  module      text not null check (module in ('motion-control','omni','express','generateur','image-ia','montage-ia','mcp-claude','autre')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.ig_media_tags enable row level security;   -- aucune policy : lecture par ig-insights, écriture par la RPC
revoke all on table public.ig_media_tags from anon, authenticated;

create or replace function public.ig_media_tag_set(p_media text, p_module text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select (coalesce(is_owner,false) or lower(coalesce(plan,''))='developer') into ok from public.profiles where id = auth.uid();
  if not coalesce(ok,false) then return jsonb_build_object('error','forbidden'); end if;
  if p_media is null or p_media !~ '^[0-9]{5,30}$' then return jsonb_build_object('error','publication inconnue'); end if;
  if p_module is null or p_module = '' then
    delete from public.ig_media_tags where ig_media_id = p_media;
    return jsonb_build_object('ok', true, 'module', null);
  end if;
  if p_module not in ('motion-control','omni','express','generateur','image-ia','montage-ia','mcp-claude','autre') then
    return jsonb_build_object('error','module inconnu');
  end if;
  insert into public.ig_media_tags(ig_media_id, module, updated_at, updated_by) values (p_media, p_module, now(), auth.uid())
  on conflict (ig_media_id) do update set module = excluded.module, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true, 'module', p_module);
end $$;
revoke execute on function public.ig_media_tag_set(text, text) from public, anon;
grant execute on function public.ig_media_tag_set(text, text) to authenticated;

-- Étiquetage donné par Axel le 24/09 sur le top 5 (toutes publications, triées par vues) : appliqué UNE fois par
-- ig-insights au prochain chargement des publications (il connaît les identifiants Instagram), puis effacé.
create table if not exists public.ig_media_tag_rank_pending (
  rank   integer primary key,
  module text not null
);
alter table public.ig_media_tag_rank_pending enable row level security;
revoke all on table public.ig_media_tag_rank_pending from anon, authenticated;
insert into public.ig_media_tag_rank_pending(rank, module) values
  (1,'autre'), (2,'omni'), (3,'motion-control'), (4,'motion-control'), (5,'motion-control')
on conflict (rank) do update set module = excluded.module;

-- 2) Nombre d'abonnés relevé chaque jour (le dernier relevé de la journée) : l'écart entre deux jours donne le VRAI
--    net d'une période courte, alors que follows_and_unfollows arrive avec ~2 jours de retard.
create table if not exists public.ig_followers_daily (
  ig_id       text not null,
  day         date not null,          -- jour Instagram (heure du Pacifique)
  followers   integer not null,
  captured_at timestamptz not null default now(),
  primary key (ig_id, day)
);
alter table public.ig_followers_daily enable row level security;
revoke all on table public.ig_followers_daily from anon, authenticated;

-- Relecture du 24/09 : l'étiquetage par rang n'est appliqué que s'il a moins de 48 h (après, l'ordre du top a pu changer).
alter table public.ig_media_tag_rank_pending add column if not exists created_at timestamptz not null default now();
