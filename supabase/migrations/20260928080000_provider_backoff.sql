-- Hedra (mail d'un ingénieur Hedra, 28/09) : 60 requêtes / min par clé API, la moitié de nos sondes
-- GET /v3/jobs/<id>/status prenaient un 429. Pause GLOBALE partagée par toutes les fonctions (MCP, hedra-proxy pour l'app
-- et le moteur de rendu) : tant que « until » est dans le futur, aucune sonde de statut n'est envoyée (Retry-After respecté).
-- Le budget par minute et l'intervalle par job passent par rate_hit (clés hedra:v3:status et hedra:job:<id>).
create table if not exists public.provider_backoff (
  provider text primary key,
  until    timestamptz not null
);
alter table public.provider_backoff enable row level security;   -- aucune policy : service_role seulement
revoke all on public.provider_backoff from public, anon, authenticated;
