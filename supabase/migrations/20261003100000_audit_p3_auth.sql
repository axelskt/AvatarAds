-- Audit sécurité du 02/10 — P3 « auth » (va avec supabase/functions/auth-otp/index.ts et app/index.html du même jour).
--
-- Changement de mot de passe (Mon compte) : la revérification de l'identité n'existait que CÔTÉ CLIENT. L'app relisait
-- l'ancien mot de passe (signInWithPassword) puis appelait sb.auth.updateUser({ password }) ; or n'importe quelle session
-- (jeton volé, poste partagé resté connecté) peut appeler /auth/v1/user directement, sans ancien mot de passe ni accès à la
-- boîte mail. Un mot de passe posé ainsi donne un accès DURABLE et SILENCIEUX au compte (les comptes nés par code e-mail ou
-- par Google n'en ont pas : il suffisait d'en ajouter un). La protection Supabase « Secure password change » exige un
-- nonce envoyé par le SMTP de Supabase (aucun SMTP configuré) : inutilisable ici.
--
-- Nouveau flux (edge auth-otp, session exigée) :
--   1) password_change_send : code à 6 chiffres envoyé (Resend) à l'adresse DU COMPTE (password_change_codes) ;
--   2) password_change_verify { code, password } : code vérifié → autorisation à usage unique (password_change_grants,
--      2 min) → auth.admin.updateUserById(password) → e-mail d'information au compte.
--
-- Garde en base : trigger guard_password_change (BEFORE UPDATE OF encrypted_password ON auth.users). Un changement de mot
-- de passe SANS autorisation serveur est IGNORÉ (l'ancien haché est conservé, avertissement dans les journaux Postgres)
-- plutôt que refusé : une CONNEXION par mot de passe ne peut jamais échouer à cause de ce trigger (si le serveur Auth
-- ré-hache un mot de passe à la connexion, l'ancien haché, toujours valide pour ce même mot de passe, est gardé). Toute
-- erreur interne du trigger aboutit au même résultat (jamais d'exception levée sur auth.users). Retirer un mot de passe
-- (null / vide : suppression douce d'un compte) reste libre : ce n'est jamais une prise de contrôle.
-- Recensement des usages légitimes (dépôt au 03/10) : seul app/index.html (Mon compte, pwdSaveNew) POSAIT un mot de passe
-- (updateUser), remplacé par le flux ci-dessus ; connexion par mot de passe : app/index.html, connexion.html, factory.html,
-- factory-v2/cf-store.js, mcp-consent.html (lecture seule du haché, non concernées) ; aucun autre écrit d'encrypted_password
-- (auth-otp crée les comptes SANS mot de passe, delete-account supprime en dur, block_password_signup à l'INSERT).
-- Poser un mot de passe À LA MAIN (SQL ou API admin) exige désormais une autorisation préalable :
--   insert into public.password_change_grants (user_id, expires_at) values ('<uuid>', now() + interval '2 minutes')
--     on conflict (user_id) do update set expires_at = excluded.expires_at;
--
-- Rejouable sans effet de bord (if not exists / create or replace / drop trigger if exists / revoke + grant explicites).
-- Privilèges par défaut fermés depuis le P2 : tables et fonctions réservées au service_role (edge auth-otp), aucun droit
-- pour public / anon / authenticated.

-- ─── 1) Codes de changement de mot de passe (modèle d'email_change_codes) ───
create table if not exists public.password_change_codes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,   -- suppression de compte = purge
  code_hash   text        not null,                                                -- HMAC (clé service), jamais le code en clair
  attempts    integer     not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists password_change_codes_user_time on public.password_change_codes (user_id, created_at desc);
create index if not exists password_change_codes_created on public.password_change_codes (created_at);   -- purge > 24 h

alter table public.password_change_codes enable row level security;
alter table public.password_change_codes force row level security;
revoke all on table public.password_change_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.password_change_codes to service_role;

-- Essai consommé ATOMIQUEMENT avant la comparaison du code (même modèle qu'email_change_take_attempt : un seul UPDATE
-- conditionnel, NULL = plafond atteint). Lié au compte : un code ne peut être tenté que par son propriétaire.
create or replace function public.password_change_take_attempt(p_id uuid, p_user uuid, p_max integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.password_change_codes
     set attempts = attempts + 1
   where id = p_id and user_id = p_user and attempts < p_max
  returning attempts;
$$;
revoke all on function public.password_change_take_attempt(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.password_change_take_attempt(uuid, uuid, integer) to service_role;

-- ─── 2) Autorisations à usage unique (une ligne par compte, 2 min, consommée par le trigger) ───
create table if not exists public.password_change_grants (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  expires_at  timestamptz not null
);
alter table public.password_change_grants enable row level security;
alter table public.password_change_grants force row level security;
revoke all on table public.password_change_grants from public, anon, authenticated;
grant select, insert, update, delete on table public.password_change_grants to service_role;

-- ─── 3) Garde sur auth.users ───
-- SECURITY DEFINER (propriétaire postgres) : le serveur Auth (supabase_auth_admin) n'a aucun droit sur public.*.
create or replace function public.guard_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ok boolean := false;
begin
  -- Rien à contrôler : haché inchangé, ou mot de passe retiré.
  if new.encrypted_password is not distinct from old.encrypted_password
     or coalesce(new.encrypted_password, '') = '' then
    return new;
  end if;
  begin
    delete from public.password_change_grants where user_id = new.id and expires_at > now();
    v_ok := found;
  exception when others then
    v_ok := false;   -- erreur interne : on garde l'ancien mot de passe, la mise à jour de la ligne n'échoue jamais
  end;
  if v_ok then
    return new;
  end if;
  raise warning 'Audit 02/10 (P3) : changement de mot de passe sans autorisation serveur ignoré (compte %)', new.id;
  new.encrypted_password := old.encrypted_password;
  return new;
end $$;
revoke all on function public.guard_password_change() from public, anon, authenticated;

drop trigger if exists guard_password_change on auth.users;
create trigger guard_password_change before update of encrypted_password on auth.users
  for each row execute function public.guard_password_change();

notify pgrst, 'reload schema';
