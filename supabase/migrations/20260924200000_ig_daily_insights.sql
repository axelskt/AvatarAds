-- Creative Factory v2 (24/09/2026) : historique JOUR PAR JOUR des insights Instagram du compte principal.
-- Rempli à la demande par ig-insights (service role) : un jour Instagram = [minuit, minuit[ heure du Pacifique.
-- Sert la courbe « Évolution » et les totaux au-delà de 30 jours (l'API plafonne une requête à 30 jours).
-- Un jour clos depuis plus de 48 h (retard de l'API) est `final` : plus jamais relu.
create table if not exists public.ig_daily_insights (
  ig_id      text not null,
  day        date not null,
  metrics    jsonb not null default '{}'::jsonb,  -- reach, views, accounts_engaged, total_interactions, profile_views,
                                                  -- profile_links_taps, website_clicks, follows, unfollows (null = non fourni)
  errors     jsonb,                               -- { métrique: message } refusées ce jour-là
  final      boolean not null default false,
  fetched_at timestamptz not null default now(),
  primary key (ig_id, day)
);
alter table public.ig_daily_insights enable row level security;   -- aucune policy : lecture/écriture service role seulement
revoke all on table public.ig_daily_insights from anon, authenticated;
