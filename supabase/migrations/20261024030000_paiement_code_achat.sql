-- 24/10/2026 (audit du 23/10, constats 3, 10, 12 et 15) : après un paiement SANS compte sur paiement.html, la fonction
-- paiement-compte remettait une session (lien magique) puis le 1er mot de passe au compte de l'adresse saisie chez Whop.
-- Or Whop ne vérifie pas cette adresse : n'importe qui pouvait payer avec l'adresse d'un autre et « pré-occuper » son compte.
--
-- Désormais (edge paiement-compte) :
--   1) action 'code' { nonce } : code à 6 chiffres envoyé (Resend) à l'adresse de l'achat — compte NEUF seulement ;
--   2) action 'connexion' { nonce, code } : code vérifié (10 min, 5 essais, usage unique) → seulement alors le jeton de
--      connexion, puis le 1er mot de passe comme avant (le verrou de connexion porte la preuve, preuve = 'code').
-- Codes dans paiement_codes (≠ otp_codes, password_change_codes) : un code ne vaut que pour CE compte et CE paiement
-- (empreinte HMAC liée au compte et à l'identifiant aa_nonce de l'onglet), jamais pour une connexion par code ordinaire.
--
-- Rejouable sans effet de bord (if not exists / create or replace / revoke + grant explicites). Réservé au service_role
-- (edge paiement-compte) : aucun droit pour public / anon / authenticated, comme les autres tables de codes.

-- ─── 1) Codes « ouvrir mon espace » après un achat (modèle de password_change_codes) ───
create table if not exists public.paiement_codes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,   -- suppression de compte = purge
  nonce       uuid        not null,                                                -- identifiant aa_nonce du paiement (onglet)
  code_hash   text        not null,                                                -- HMAC (clé service), jamais le code en clair
  attempts    integer     not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists paiement_codes_user_time on public.paiement_codes (user_id, created_at desc);
create index if not exists paiement_codes_nonce on public.paiement_codes (nonce, user_id);
create index if not exists paiement_codes_created on public.paiement_codes (created_at);   -- purge > 24 h

alter table public.paiement_codes enable row level security;
alter table public.paiement_codes force row level security;
revoke all on table public.paiement_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.paiement_codes to service_role;

-- Essai consommé ATOMIQUEMENT avant la comparaison du code (même modèle que password_change_take_attempt : un seul UPDATE
-- conditionnel, NULL = plafond atteint). Lié au compte : un code ne peut être tenté que pour le compte qui l'a reçu.
create or replace function public.paiement_code_take_attempt(p_id uuid, p_user uuid, p_max integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.paiement_codes
     set attempts = attempts + 1
   where id = p_id and user_id = p_user and attempts < p_max
  returning attempts;
$$;
revoke all on function public.paiement_code_take_attempt(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.paiement_code_take_attempt(uuid, uuid, integer) to service_role;
