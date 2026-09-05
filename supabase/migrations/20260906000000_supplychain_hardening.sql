-- Audit supply-chain & secrets — 06/09/2026 (SC-4, SC-9)
--
-- SC-4 — anim_demandes_top : vue créée sans security_invoker → s'exécute avec les droits de son
-- propriétaire (postgres) et CONTOURNE la RLS de anim_demandes. Elle avait tous les grants par défaut →
-- lisible par anon (prouvé : 200 + données avec la seule clé publique). Le seul lecteur légitime est
-- l'outil MCP owner, qui passe par service_role (BYPASSRLS) → il continue de fonctionner.
revoke all on public.anim_demandes_top from anon, authenticated;
alter view public.anim_demandes_top set (security_invoker = on);

-- SC-9 — search_path figé sur les 2 fonctions trigger signalées par l'advisor (function_search_path_mutable).
alter function public.brand_memory_touch() set search_path = public;
alter function public.touch_brand_screens() set search_path = public;
