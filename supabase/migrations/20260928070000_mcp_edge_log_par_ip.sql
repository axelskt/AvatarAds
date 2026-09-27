-- Audit Express 28/09 (#34) — journal mcp_edge_log : le plafond d'insertion était GLOBAL (une seule clé
-- 'mcpedgelog:insert', 100 / 10 s). Le proxy mcp.avatarads.fr écrit avec la clé publishable (rôle anon), donc
-- n'importe qui pouvait occuper tout le quota en insérant directement via PostgREST : plus aucune vraie requête MCP
-- journalisée. Maintenant : plafond PAR IP (cf-connecting-ip, posé par Cloudflare, non falsifiable par le client ;
-- repli x-real-ip) — un anonyme n'épuise que le sien — plus un filet global large contre un afflux multi-IP.
-- Le proxy n'est pas modifié (pas de redéploiement Netlify depuis la copie de travail).
create or replace function public.mcp_edge_log_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare h json; ip text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  ip := left(coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(h->>'x-real-ip', ''), '?'), 64);
  if not public.rate_hit('mcpedgelog:ip:' || ip, 10, 60) then return null; end if;   -- 6 / s par IP (>> trafic du proxy)
  if not public.rate_hit('mcpedgelog:insert', 10, 400) then return null; end if;     -- filet global
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
