-- Audit supply-chain 06/09/2026 (SC-9) — pg_net hors du schéma public (advisor extension_in_public).
--
-- pg_net n'est PAS relocalisable (extrelocatable = false) → drop + create dans `extensions`.
-- Le schéma `net` (http_get / http_post) est recréé par l'extension ; les jobs pg_cron
-- (email-drip-hourly, mcp-keepwarm, provider-balance-watch) l'appellent par nom → inchangés.
-- La file de requêtes en attente est perdue, sans conséquence (crons horaires / 15 min).
drop extension if exists pg_net;
create extension pg_net with schema extensions;
