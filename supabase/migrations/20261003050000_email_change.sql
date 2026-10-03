-- Audit 02/10 : changement d'adresse e-mail par CODE (envoyé via Resend par auth-otp), contrat C1.
-- Contexte : la confirmation des e-mails Supabase Auth est active et aucun SMTP n'est configuré côté Supabase →
-- sb.auth.updateUser({ email }) n'envoyait plus rien : le changement d'adresse était cassé pour les clients.
-- Nouveau flux (edge auth-otp, actions email_change_send / email_change_verify, session Supabase exigée) :
--   1) code à 6 chiffres envoyé à la NOUVELLE adresse (preuve qu'elle appartient bien au client : sinon on pourrait
--      se rattacher l'adresse d'un acheteur Whop et récupérer son paiement, cf. PAY-2) ;
--   2) code vérifié → auth.admin.updateUserById(email, email_confirm) ; le trigger sync_profile_email recopie dans
--      profiles.email ; e-mail d'information à l'ANCIENNE adresse.
-- Table SÉPARÉE d'otp_codes : un code de changement d'adresse n'ouvre jamais de session, et un code de connexion ne
-- change jamais d'adresse. Rejouable sans effet de bord (if not exists / create or replace / revoke + grant).

create table if not exists public.email_change_codes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,   -- suppression de compte = purge
  new_email   text        not null,
  code_hash   text        not null,                                                -- HMAC (clé service), jamais le code en clair
  attempts    integer     not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists email_change_codes_user_time on public.email_change_codes (user_id, created_at desc);
create index if not exists email_change_codes_created on public.email_change_codes (created_at);   -- purge > 24 h

-- Réservée au service_role (auth-otp) : RLS activée et forcée SANS policy, aucun droit pour les rôles clients.
alter table public.email_change_codes enable row level security;
alter table public.email_change_codes force row level security;
revoke all on table public.email_change_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.email_change_codes to service_role;

-- Essai consommé de façon ATOMIQUE, AVANT la comparaison du code (même modèle qu'otp_take_attempt : un seul UPDATE
-- conditionnel, NULL = plafond atteint). Lié au compte : un code ne peut être tenté que par son propriétaire.
create or replace function public.email_change_take_attempt(p_id uuid, p_user uuid, p_max integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.email_change_codes
     set attempts = attempts + 1
   where id = p_id and user_id = p_user and attempts < p_max
  returning attempts;
$$;
revoke all on function public.email_change_take_attempt(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.email_change_take_attempt(uuid, uuid, integer) to service_role;

-- Adresse cible déjà portée par UN AUTRE compte (auth.users ou profiles), insensible à la casse. auth.users n'est pas
-- exposé par l'API → lecture ici en SECURITY DEFINER. Échec fermé : adresse vide = « prise ». Service_role seul
-- (sinon un client pourrait sonder l'existence de n'importe quelle adresse).
create or replace function public.email_change_target_taken(p_user uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(btrim(p_email), '') = ''
      or exists (select 1 from auth.users u
                  where lower(u.email) = lower(btrim(p_email)) and u.id is distinct from p_user)
      or exists (select 1 from public.profiles p
                  where lower(p.email) = lower(btrim(p_email)) and p.id is distinct from p_user);
$$;
revoke all on function public.email_change_target_taken(uuid, text) from public, anon, authenticated;
grant execute on function public.email_change_target_taken(uuid, text) to service_role;

notify pgrst, 'reload schema';
