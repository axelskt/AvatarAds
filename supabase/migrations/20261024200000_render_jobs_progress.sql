-- Décupleur (24/10) : avancement d'un lot de variantes (0–100), écrit par le render-worker entre deux variantes et lu par
-- render-job (action status) pour la barre de l'app. Colonne seule, nullable : les autres jobs ne l'écrivent pas.
alter table public.render_jobs add column if not exists progress smallint;
