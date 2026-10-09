-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Motion Control chez kie pour TOUS les clients (Axel 09/10/2026 : « push pour tout le monde Motion Control chez kie »,
-- 2.6 720p / 2.6 1080p natif / 3.0 1080p).
--
-- bill_sec = durée de la vidéo de référence du client MESURÉE par kie-proxy à la soumission (copie serveur, comme fal-proxy) :
--   • relue au rapatriement (kie-proxy) et par le filet (reconcile-kie) : une sortie nettement plus longue que la vidéo
--     facturée (entrée maquillée) n'est jamais livrée (op réglée, tâche close en échec) ;
--   • relue par voice-change (« Remplacer l'audio », gratuit) : plafond de la durée de voix convertie.
-- Index op_id : voice-change retrouve la tâche kie d'une op « motion » livrée.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.kie_jobs add column if not exists bill_sec numeric;
create index if not exists kie_jobs_op_idx on public.kie_jobs (op_id) where op_id is not null;
