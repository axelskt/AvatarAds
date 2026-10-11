-- Liens courts de l'Auto-DM (Axel 11/10 : « un lien plus sexy, moins long »). Le DM envoie avatarads.fr/r?k=<code> au lieu
-- de r.html?u=…&ig=…&s=…&to=… ; le code renvoie aux mêmes valeurs, vérifiées comme avant par ig-go (signature datée).
create table if not exists public.ig_short_links (
  k text primary key check (k ~ '^[A-Za-z0-9]{6,12}$'),
  u text not null,
  ig text not null,
  s text not null,
  dest text not null,
  created_at timestamptz not null default now()
);
alter table public.ig_short_links enable row level security;
revoke all on public.ig_short_links from anon, authenticated;
