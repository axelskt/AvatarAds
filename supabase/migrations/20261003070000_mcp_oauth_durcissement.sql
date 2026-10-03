-- Audit 02/10 (P2) : durcissement OAuth du connecteur Claude (mcp_oauth_*).
--
-- 1) Jetons de rafraîchissement en FAMILLES : une famille naît à l'échange d'un code (/token authorization_code) et
--    chaque rotation garde son family_id. Expiration ABSOLUE à 90 jours depuis la première émission de la famille
--    (family_started_at), et un refresh DÉJÀ TOURNÉ présenté à nouveau (vol probable) révoque TOUTE la famille.
--    Fenêtre de grâce courte (passée par l'appelant, 60 s) : deux rafraîchissements simultanés du même client ou un
--    renvoi après réponse perdue reçoivent invalid_grant SANS révocation (comportement actuel du compare-and-swap).
-- 2) Pierres tombales (mcp_oauth_refresh_used) : la purge quotidienne efface les jetons tournés depuis plus d'1 jour,
--    mais l'empreinte du refresh tourné reste (sans user_id) jusqu'à la fin de la famille → la détection de
--    réutilisation tient 90 jours, pas 24 h.
-- 3) Purge pg_cron quotidienne : codes expirés, jetons tournés depuis plus d'1 jour, familles finies depuis plus
--    d'1 jour, et lignes déjà tournées par l'ancien code (refresh écrasé, accès raccourci et expiré depuis plus d'1 jour).
--    Un jeton dont seul l'ACCÈS (30 j) a expiré garde son refresh valable : il n'est PAS purgé (sinon un client resté
--    inactif plus de 30 jours perdrait sa connexion).
--
-- RATTRAPAGE sans casser les connexions en cours : chaque ligne existante reçoit sa propre famille (lignée inconnue)
-- démarrée À LA MIGRATION → 90 jours pleins pour tout le monde. Les DEFAULT gardent l'ancien code compatible tant que
-- la fonction mcp n'est pas redéployée (ses insertions créent une famille neuve). Ordre conseillé : migration PUIS
-- déploiement de mcp (le nouveau code retombe de toute façon sur l'ancienne rotation si la RPC est absente).
-- Idempotente.

-- ── Colonnes de famille (rattrapage par les DEFAULT : gen_random_uuid() est évalué ligne par ligne) ──
alter table public.mcp_oauth_tokens add column if not exists family_id uuid not null default gen_random_uuid();
alter table public.mcp_oauth_tokens add column if not exists family_started_at timestamptz not null default now();
alter table public.mcp_oauth_tokens add column if not exists rotated_at timestamptz;
create index if not exists mcp_oauth_tokens_family on public.mcp_oauth_tokens (family_id);

-- ── Pierres tombales des refresh tournés (aucune donnée personnelle : empreinte HMAC + famille) ──
create table if not exists public.mcp_oauth_refresh_used (
  refresh_hash      text primary key,
  family_id         uuid not null,
  family_started_at timestamptz not null,
  rotated_at        timestamptz not null default now()
);
create index if not exists mcp_oauth_refresh_used_started on public.mcp_oauth_refresh_used (family_started_at);
alter table public.mcp_oauth_refresh_used enable row level security;

-- ── Accès : tables réservées au serveur (clé service). RLS sans policy bloquait déjà anon/authenticated ;
--    on retire aussi leurs GRANT (défense en profondeur). Aucun usage client : seule la fonction edge mcp (svc)
--    et les fonctions RGPD SECURITY DEFINER y touchent.
revoke all on table public.mcp_oauth_clients, public.mcp_oauth_codes, public.mcp_oauth_tokens,
  public.mcp_oauth_refresh_used from anon, authenticated;
grant select, insert, update, delete on table public.mcp_oauth_clients, public.mcp_oauth_codes,
  public.mcp_oauth_tokens, public.mcp_oauth_refresh_used to service_role;

-- ── Rotation ATOMIQUE d'un refresh (appelée par /token grant_type=refresh_token) ──
-- Verrou de ligne (FOR UPDATE) : deux rotations concurrentes du même refresh sont sérialisées, la seconde voit
-- rotated_at posé et reçoit 'concurrent'. Retour : {ok:true, expires_in} ou {ok:false, error:
-- invalid_request | invalid_grant | concurrent | reuse | expired}.
create or replace function public.mcp_oauth_rotate(
  p_refresh_hash text, p_new_token_hash text, p_new_refresh_hash text,
  p_access_ttl_s integer, p_family_ttl_s integer, p_grace_s integer, p_old_access_s integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r  public.mcp_oauth_tokens%rowtype;
  tb public.mcp_oauth_refresh_used%rowtype;
  v_fin timestamptz;
  v_exp timestamptz;
  n integer := 0;
begin
  if coalesce(p_refresh_hash, '') = '' or coalesce(p_new_token_hash, '') = '' or coalesce(p_new_refresh_hash, '') = ''
     or coalesce(p_access_ttl_s, 0) <= 0 or coalesce(p_family_ttl_s, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select * into r from public.mcp_oauth_tokens where refresh_hash = p_refresh_hash for update;
  if not found then
    -- Jeton tourné puis purgé : la pierre tombale garde la trace jusqu'à la fin de la famille.
    select * into tb from public.mcp_oauth_refresh_used where refresh_hash = p_refresh_hash;
    if not found then return jsonb_build_object('ok', false, 'error', 'invalid_grant'); end if;
    if tb.rotated_at > now() - make_interval(secs => greatest(coalesce(p_grace_s, 0), 0)) then
      return jsonb_build_object('ok', false, 'error', 'concurrent');
    end if;
    delete from public.mcp_oauth_tokens where family_id = tb.family_id;
    get diagnostics n = row_count;
    return jsonb_build_object('ok', false, 'error', 'reuse', 'revoked', n);
  end if;

  if r.rotated_at is not null then
    if r.rotated_at > now() - make_interval(secs => greatest(coalesce(p_grace_s, 0), 0)) then
      return jsonb_build_object('ok', false, 'error', 'concurrent');
    end if;
    delete from public.mcp_oauth_tokens where family_id = r.family_id;
    get diagnostics n = row_count;
    return jsonb_build_object('ok', false, 'error', 'reuse', 'revoked', n);
  end if;

  v_fin := r.family_started_at + make_interval(secs => p_family_ttl_s);
  if v_fin <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  -- Rotation douce : l'ancien accès reste valable au plus p_old_access_s (jamais prolongé), le refresh est marqué tourné.
  update public.mcp_oauth_tokens
     set rotated_at = now(),
         expires_at = least(expires_at, now() + make_interval(secs => greatest(coalesce(p_old_access_s, 0), 0)))
   where token_hash = r.token_hash;
  insert into public.mcp_oauth_refresh_used (refresh_hash, family_id, family_started_at, rotated_at)
  values (p_refresh_hash, r.family_id, r.family_started_at, now())
  on conflict (refresh_hash) do nothing;

  -- Nouvel accès : 30 jours, plafonné à la fin absolue de la famille.
  v_exp := least(now() + make_interval(secs => p_access_ttl_s), v_fin);
  insert into public.mcp_oauth_tokens (token_hash, refresh_hash, client_id, user_id, expires_at, family_id, family_started_at)
  values (p_new_token_hash, p_new_refresh_hash, r.client_id, r.user_id, v_exp, r.family_id, r.family_started_at);

  return jsonb_build_object('ok', true, 'expires_in', greatest(1, floor(extract(epoch from (v_exp - now()))))::bigint);
end $$;
revoke all on function public.mcp_oauth_rotate(text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.mcp_oauth_rotate(text, text, text, integer, integer, integer, integer) to service_role;

-- ── Purge quotidienne ──
-- Les 90 jours de famille sont aussi codés côté edge (FAMILY_TTL_MS) : 91 jours ici = fin de famille + 1 jour.
create or replace function public.mcp_oauth_purge()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n_codes integer := 0;
  n_tok   integer := 0;
  n_tomb  integer := 0;
begin
  delete from public.mcp_oauth_codes where expires_at < now();
  get diagnostics n_codes = row_count;

  delete from public.mcp_oauth_tokens t
   where (t.rotated_at is not null and t.rotated_at < now() - interval '1 day')
      or t.family_started_at < now() - interval '91 days'
      -- Ancienne rotation (avant cette migration) : refresh écrasé, accès ramené à 10 min. Un jeton jamais tourné a
      -- TOUJOURS expires_at = created_at + 30 jours (TTL inchangé depuis le 15/08) → il n'est jamais pris ici.
      or (t.rotated_at is null and t.expires_at < now() - interval '1 day'
          and t.expires_at < t.created_at + interval '29 days');
  get diagnostics n_tok = row_count;

  delete from public.mcp_oauth_refresh_used where family_started_at < now() - interval '91 days';
  get diagnostics n_tomb = row_count;

  return jsonb_build_object('codes', n_codes, 'tokens', n_tok, 'tombstones', n_tomb);
end $$;
revoke all on function public.mcp_oauth_purge() from public, anon, authenticated;
grant execute on function public.mcp_oauth_purge() to service_role;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'mcp-oauth-purge';
end $$;
select cron.schedule('mcp-oauth-purge', '47 3 * * *', $$select public.mcp_oauth_purge()$$);
