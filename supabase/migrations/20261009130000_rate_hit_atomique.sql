-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- rate_hit ATOMIQUE (relecture « Cloner l'audio », 09/10/2026).
--
-- Problème : rate_hit comptait (select count) PUIS insérait, sans verrou. N appels simultanés sur la même clé lisaient tous
-- le même compte et passaient tous : une rafale de requêtes parallèles franchissait n'importe quel plafond (10 / h par
-- compte, plafonds IP et plateforme, 3 conversions de voix par rendu Motion Control…), et pouvait vider un plafond global
-- au détriment des vrais clients.
--
-- Fix : verrou consultatif de TRANSACTION par clé (classe 7301 réservée à rate_hit) avant le comptage → les appels sur une
-- même clé passent un par un (quelques ms chacun), des clés différentes ne s'attendent jamais. Corps, signature, valeur de
-- retour et droits inchangés : aucun appelant à redéployer.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.rate_hit(p_key text, p_window_s integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(7301, hashtext(p_key));
  delete from public.rate_events where key = p_key and created_at < now() - make_interval(secs => p_window_s * 4);
  select count(*) into n from public.rate_events where key = p_key and created_at > now() - make_interval(secs => p_window_s);
  if n >= p_max then return false; end if;
  insert into public.rate_events (key) values (p_key);
  return true;
end $$;
revoke all on function public.rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer) to service_role;
