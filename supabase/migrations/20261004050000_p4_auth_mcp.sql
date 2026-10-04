-- Audit 04/10 (P4) — chantier « auth-mcp » (va avec supabase/functions/auth-otp/index.ts, mcp/index.ts, connexion.html du
-- même jour).
--
-- CC-1 : un changement d'adresse ne demandait que la session et un code reçu à la NOUVELLE adresse (choisie par l'appelant).
-- Avec une session volée, on posait sa propre adresse, puis on se reconnectait par code à volonté : prise de contrôle
-- durable, l'ancienne adresse n'étant que prévenue. Sans modifier l'app (la vraie parade, un 2e code envoyé à l'adresse
-- ACTUELLE, demande un 2e champ dans Mon compte), on rend le changement RÉVERSIBLE pendant 72 h :
--   · chaque changement validé est journalisé (email_change_events) avec l'empreinte d'un jeton d'annulation à usage unique ;
--   · l'e-mail envoyé à l'ancienne adresse porte un lien « Ce n'est pas moi » (connexion.html#annuler-adresse=<jeton>, un
--     clic sur un bouton est exigé : les robots qui ouvrent les liens des e-mails ne déclenchent rien) ;
--   · l'annulation (auth-otp email_change_revert, sans session) rétablit l'adresse puis VERROUILLE le compte
--     (email_change_lockdown) : sessions fermées, identités Google / facteurs MFA ajoutés depuis le changement retirés, mot de
--     passe posé depuis le changement retiré (le trigger guard_password_change laisse toujours passer un retrait), accès
--     Claude (OAuth MCP) révoqué, codes en attente supprimés, jetons GoTrue en attente (magic link, changement d'adresse
--     natif…) vidés, changements postérieurs invalidés.
--   · pendant ces 72 h, l'ancienne adresse ne peut pas servir à créer un NOUVEAU compte, ni par code (auth-otp verify), ni
--     par Google (trigger block_recently_released_email à l'INSERT d'auth.users) : sinon la victime qui tente de se
--     reconnecter avec son adresse habituelle la « consommerait » et l'annulation deviendrait impossible (adresse prise).
-- CC-4 : rate_events gardait sans limite de durée des clés contenant l'adresse en clair (et le couple adresse + IP). Les clés
-- d'auth-otp sont désormais des EMPREINTES HMAC ; la purge des lignes de plus de 2 jours est écrite ici (auth_traces_purge)
-- mais NON PLANIFIÉE : suppression définitive de données, à valider par Axel (commande en fin de fichier).
--
-- Sans SQL dans ce chantier : CC-2 / MCP-1 (révocation de l'accès Claude par auth-otp, route /revoke du MCP), CC-3 (plafonds
-- d'envoi par couple e-mail + IP), MCP-2 (photo de départ Express nommée comme les autres médias générés → 30 jours de
-- list_media_purge), MCP-3 (plafond de rendus simultanés du MCP), MCP-4 (durée mesurée des FLAC / Opus / AAC).
--
-- Rejouable sans effet de bord (if not exists / create or replace / revoke + grant explicites). Privilèges par défaut fermés
-- depuis le P2 : tout est réservé au service_role (edge auth-otp), aucun droit pour public / anon / authenticated.

-- ─── 1) Journal des changements d'adresse (CC-1) ───
create table if not exists public.email_change_events (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users(id) on delete cascade,   -- suppression de compte = purge
  old_email           text        not null,                 -- destinataire du lien d'annulation (minuscules)
  new_email           text        not null,
  changed_at          timestamptz not null default now(),
  revert_hash         text        unique,                    -- HMAC (clé service) du jeton d'annulation, jamais le jeton en clair
  revert_expires_at   timestamptz not null,
  password_changed_at timestamptz,                           -- mot de passe posé pendant la fenêtre : retiré par l'annulation
  reverted_at         timestamptz,                           -- annulation réussie (usage unique)
  voided_at           timestamptz                            -- invalidé par l'annulation d'un changement plus ancien
);
create index if not exists email_change_events_user_time on public.email_change_events (user_id, changed_at desc);
create index if not exists email_change_events_old on public.email_change_events (old_email, changed_at desc);

alter table public.email_change_events enable row level security;
alter table public.email_change_events force row level security;
revoke all on table public.email_change_events from public, anon, authenticated;
grant select, insert, update, delete on table public.email_change_events to service_role;

-- ─── 2) Verrouillage du compte après une annulation (CC-1, CC-2, MCP-1) ───
-- Appelée par auth-otp APRÈS avoir rétabli l'adresse (auth.admin.updateUserById). p_event = le changement annulé (déjà
-- marqué reverted_at par l'appelant, conditionnellement). SECURITY DEFINER (propriétaire postgres : droits DELETE sur
-- auth.sessions / identities / mfa_factors et UPDATE sur auth.users vérifiés au catalogue le 04/10).
-- Sessions supprimées = jetons de rafraîchissement supprimés (FK en cascade) ; un jeton d'accès déjà émis reste lisible par
-- PostgREST jusqu'à son expiration, mais auth.getUser (toutes les fonctions sensibles, dont auth-otp) le refuse aussitôt.
create or replace function public.email_change_lockdown(p_user uuid, p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_pwd   boolean := false;
  n_void integer := 0; n_sess integer := 0; n_id integer := 0; n_mfa integer := 0; n_pwd integer := 0; n_tok integer := 0;
  n_ott  integer := 0;
begin
  if p_user is null or p_event is null then return jsonb_build_object('ok', false, 'error', 'bad_args'); end if;
  select changed_at into v_since from public.email_change_events where id = p_event and user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  -- Mot de passe posé depuis le changement annulé (ou un changement postérieur) : marqué par auth-otp password_change_verify.
  select exists (select 1 from public.email_change_events
                  where user_id = p_user and changed_at >= v_since and password_changed_at is not null) into v_pwd;
  -- Changements postérieurs : leur lien d'annulation (envoyé à une adresse posée pendant la prise de contrôle) ne vaut plus.
  update public.email_change_events set voided_at = now()
   where user_id = p_user and id <> p_event and changed_at >= v_since and reverted_at is null and voided_at is null;
  get diagnostics n_void = row_count;

  -- Audit 04/10 (relecture CC-1) : jetons GoTrue EN ATTENTE supprimés AVANT de fermer les sessions. Sans cela, l'attaquant
  -- qui a obtenu un token_hash (auth-otp verify sur SON adresse) sans l'échanger le gardait valable après l'annulation :
  -- GoTrue le retrouve par empreinte seule (auth.one_time_tokens, puis la colonne recovery_token en secours), pendant
  -- OTP_EXP (1 h) depuis recovery_sent_at, et updateUserById(email) ne vide rien → nouvelle session sur le compte rétabli.
  -- Même chose pour un changement d'adresse NATIF GoTrue lancé avec la session volée (jetons email_change_*, vérifiables
  -- sans session). Tous les types sont vidés, comme GoTrue le fait lui-même après une récupération (ClearAllOneTimeTokens).
  -- GoTrue lit ces colonnes comme des chaînes : '' (jamais NULL) ; les dates *_sent_at sont des pointeurs (NULL admis).
  -- Aucun trigger touché : guard_password_change (encrypted_password) et sync_profile_email (email) visent d'autres colonnes.
  delete from auth.one_time_tokens where user_id = p_user;                                       get diagnostics n_ott = row_count;
  update auth.users
     set recovery_token = '', recovery_sent_at = null,
         confirmation_token = '',
         email_change = '', email_change_token_new = '', email_change_token_current = '',
         email_change_sent_at = null, email_change_confirm_status = 0,
         reauthentication_token = '', reauthentication_sent_at = null
   where id = p_user;

  delete from auth.sessions where user_id = p_user;                                              get diagnostics n_sess = row_count;
  delete from auth.identities where user_id = p_user and provider <> 'email' and created_at >= v_since;  get diagnostics n_id = row_count;
  delete from auth.mfa_factors where user_id = p_user and created_at >= v_since;                 get diagnostics n_mfa = row_count;
  if v_pwd then
    update auth.users set encrypted_password = '' where id = p_user and coalesce(encrypted_password, '') <> '';
    get diagnostics n_pwd = row_count;
  end if;

  delete from public.mcp_oauth_tokens where user_id = p_user;                                    get diagnostics n_tok = row_count;
  delete from public.mcp_oauth_codes where user_id = p_user;
  update public.mcp_keys set revoked_at = now() where user_id = p_user and revoked_at is null;
  delete from public.email_change_codes where user_id = p_user and used_at is null;
  delete from public.password_change_codes where user_id = p_user and used_at is null;
  delete from public.password_change_grants where user_id = p_user;

  return jsonb_build_object('ok', true, 'sessions', n_sess, 'otp_tokens', n_ott, 'identities', n_id, 'mfa', n_mfa,
                            'password_removed', n_pwd > 0, 'mcp_tokens', n_tok, 'voided', n_void);
end $$;
revoke all on function public.email_change_lockdown(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_change_lockdown(uuid, uuid) to service_role;

-- ─── 2 bis) Adresse quittée depuis moins de 72 h : pas de NOUVEAU compte, même par Google (CC-1, relecture) ───
-- auth-otp verify refuse déjà la création par code (409 email_recently_changed). Sans ce trigger, la victime qui se
-- connecte avec Google sur son adresse habituelle (sans identité Google déjà liée au compte) faisait créer par GoTrue un
-- NOUVEAU compte portant cette adresse : le lien « Ce n'est pas moi » répondait ensuite 409 email_taken (support). Avec
-- lui, l'inscription Google échoue (l'app réaffiche la connexion, où le code e-mail donne le message clair) et le lien
-- reste utilisable. Même modèle que block_password_signup (BEFORE INSERT, SECURITY DEFINER). Échec OUVERT sur toute erreur
-- de lecture : un incident sur le journal ne bloque jamais une inscription. Les changements d'adresse (UPDATE, dont le
-- retour A→B→A et l'annulation) ne passent pas par ici ; la suppression du compte efface son journal (cascade).
create or replace function public.block_recently_released_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_bloque boolean := false;
begin
  if coalesce(new.email, '') = '' then return new; end if;
  begin
    select exists (select 1 from public.email_change_events
                    where lower(old_email) = lower(trim(new.email)) and changed_at > now() - interval '72 hours'
                      and reverted_at is null and voided_at is null)
      into v_bloque;
  exception when others then
    v_bloque := false;
  end;
  if v_bloque then
    raise exception 'adresse retirée d''un compte AvatarAds il y a moins de 72 h — lien « Ce n''est pas moi » ou support';
  end if;
  return new;
end $$;
revoke all on function public.block_recently_released_email() from public, anon, authenticated;

drop trigger if exists block_recently_released_email on auth.users;
create trigger block_recently_released_email before insert on auth.users
  for each row execute function public.block_recently_released_email();

-- ─── 3) Purge des traces d'authentification (CC-4) — ÉCRITE, NON PLANIFIÉE ───
-- rate_events : la plus longue fenêtre de rate_hit au 04/10 est de 24 h (otp:send:email:day / email-ip:day ; recensement :
-- rateHit / rate_hit dans supabase/functions et les migrations — à relever si un plafond plus long apparaît) → les lignes de
-- plus de 2 jours ne servent plus à aucun plafond. email_change_events : la fenêtre d'annulation est de 72 h → 30 jours de
-- recul pour le support, puis suppression. Bornes minimales imposées (un appel avec une conservation trop courte échoue).
create or replace function public.auth_traces_purge(p_rate_keep interval default interval '2 days',
                                                   p_events_keep interval default interval '30 days')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare n_rate integer := 0; n_ev integer := 0;
begin
  if p_rate_keep is null or p_rate_keep < interval '2 days' or p_events_keep is null or p_events_keep < interval '7 days' then
    raise exception 'auth_traces_purge : conservation trop courte (rate_events >= 2 jours, email_change_events >= 7 jours)';
  end if;
  delete from public.rate_events where created_at < now() - p_rate_keep;                get diagnostics n_rate = row_count;
  delete from public.email_change_events where changed_at < now() - p_events_keep;     get diagnostics n_ev = row_count;
  return jsonb_build_object('rate_events', n_rate, 'email_change_events', n_ev);
end $$;
revoke all on function public.auth_traces_purge(interval, interval) from public, anon, authenticated;
grant execute on function public.auth_traces_purge(interval, interval) to service_role;

-- À PLANIFIER APRÈS VALIDATION D'AXEL (suppression définitive, NON exécuté par cette migration) :
--   select cron.schedule('auth-traces-purge', '53 3 * * *', $c$select public.auth_traces_purge()$c$);
-- Rattrapage ponctuel équivalent (même validation) : select public.auth_traces_purge();

notify pgrst, 'reload schema';
