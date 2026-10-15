-- TrackAds (15/10) : inscriptions de la page d'accueil trackads.fr. Écriture anonyme seulement (aucune lecture côté public).
create table if not exists public.trackads_waitlist (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text not null check (char_length(email) between 5 and 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  networks text[] not null default '{}' check (networks <@ array['tiktok','instagram','youtube']::text[]),
  adult boolean not null check (adult),
  source text check (char_length(source) <= 200)
);
create unique index if not exists trackads_waitlist_email on public.trackads_waitlist (lower(email));
alter table public.trackads_waitlist enable row level security;
revoke all on public.trackads_waitlist from anon, authenticated;
grant insert (email, networks, adult, source) on public.trackads_waitlist to anon, authenticated;
drop policy if exists trackads_waitlist_insert on public.trackads_waitlist;
create policy trackads_waitlist_insert on public.trackads_waitlist for insert to anon, authenticated with check (adult);
