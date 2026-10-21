-- Creative Factory — capacité RÉELLE de l'usine (Axel 21/10) : vidéos possibles maintenant / si toutes les briques sont
-- générées / coût des prises, calculée par usine/lots/capacite.mjs avec les règles des lots (plan.mjs) et écrite ici par
-- usine/lots/capacite.py (service). Le tableau de bord (factory-v2, onglet Production) la lit : owner / plan developer seulement.
create table if not exists public.factory_capacite (
  id text primary key default 'usine',
  data jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.factory_capacite enable row level security;
drop policy if exists factory_capacite_owner_sel on public.factory_capacite;
create policy factory_capacite_owner_sel on public.factory_capacite for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and (coalesce(p.is_owner, false) or lower(coalesce(p.plan, '')) = 'developer'))
);
revoke all on public.factory_capacite from anon;
grant select on public.factory_capacite to authenticated;
