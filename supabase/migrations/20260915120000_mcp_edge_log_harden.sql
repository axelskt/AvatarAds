-- Audit escalade de privilèges 14/09 — finding LOW (CONFIRMÉ) : mcp_edge_log.
-- anon pouvait insérer des lignes de log ARBITRAIRES en ILLIMITÉ (grant INSERT + policy RLS with_check=true) via
-- PostgREST direct avec la clé publishable → DoS de stockage (183 774 lignes, croissance non bornée) + pollution
-- de l'inspection manuelle des logs. AUCUN impact crédit/plan/owner, AUCUNE lecture (RLS deny-all en SELECT), pas d'IDOR.
--
-- Le log provient d'un site Netlify SÉPARÉ (mcp.avatarads.fr, mcp-proxy/) qui écrit avec la clé publishable (= rôle
-- anon). Un « revoke insert from anon » pur CASSERAIT ce logging (qu'Axel croise pour debugger le MCP) tant que le
-- proxy n'est pas redéployé pour écrire en service_role — redéploiement risqué d'un service sur le chemin de connexion
-- claude.ai, disproportionné pour un LOW. On BORNE donc l'abus SANS casser le logging ni toucher au proxy :
--   (1) trigger BEFORE INSERT = plafond de VOLUME (rate_hit, self-cleaning) + troncature des champs texte ;
--   (2) rétention pg_cron 14 j + purge immédiate du backlog.
-- (Option plus stricte, sur demande : revoke insert anon + passage du proxy en service_role, avec redéploiement Netlify.)

-- 1) Purge immédiate du backlog accumulé (> 14 j).
delete from public.mcp_edge_log where ts < now() - interval '14 days';

-- 2) Garde à l'insertion. RETURN NULL au-delà du plafond = ligne ignorée SILENCIEUSEMENT (le proxy garde son 2xx via
--    Prefer: return=minimal ; le logging légitime, bien en-dessous du plafond, continue). Troncature = borne un
--    payload géant envoyé en direct. SECURITY DEFINER : peut appeler rate_hit (service_role only) via le propriétaire.
create or replace function public.mcp_edge_log_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  -- ~100 insert / 10 s max (>> trafic MCP légitime d'un connecteur). Au-delà (flood) : la ligne est jetée.
  if not public.rate_hit('mcpedgelog:insert', 10, 100) then return null; end if;
  new.path          := left(coalesce(new.path, ''), 200);
  new.ua            := left(coalesce(new.ua, ''), 200);
  new.accept        := left(coalesce(new.accept, ''), 120);
  new.extra         := left(coalesce(new.extra, ''), 2000);
  new.bearer_prefix := left(coalesce(new.bearer_prefix, ''), 16);
  new.rpc_method    := left(coalesce(new.rpc_method, ''), 80);
  new.served        := left(coalesce(new.served, ''), 40);
  new.method        := left(coalesce(new.method, ''), 10);
  return new;
end $function$;

drop trigger if exists trg_mcp_edge_log_guard on public.mcp_edge_log;
create trigger trg_mcp_edge_log_guard before insert on public.mcp_edge_log
  for each row execute function public.mcp_edge_log_guard();

-- 3) Rétention quotidienne (pg_cron) — borne la croissance quel que soit le débit. cron.schedule met à jour si le nom existe.
select cron.schedule('mcp-edge-log-retention', '17 3 * * *',
  $$delete from public.mcp_edge_log where ts < now() - interval '14 days'$$);
