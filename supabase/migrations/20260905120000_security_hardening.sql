-- Durcissement sécurité (audit du 05/09/2026). Tout est ADDITIF ou restrictif : aucune donnée
-- utilisateur n'est modifiée, aucun flux légitime ne change de contrat.
--
-- 1) OTP : compteur d'essais ATOMIQUE (H1). Avant, verify faisait SELECT → test → UPDATE avec une
--    valeur recalculée côté fonction : N requêtes concurrentes lisaient toutes attempts=0 et le
--    plafond de 5 essais ne montait jamais → brute-force du code à 6 chiffres. Ici : un seul
--    UPDATE conditionnel ; NULL = plafond atteint.
create or replace function public.otp_take_attempt(p_id uuid, p_max integer)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.otp_codes
     set attempts = attempts + 1
   where id = p_id and attempts < p_max
  returning attempts;
$$;
revoke all on function public.otp_take_attempt(uuid, integer) from public, anon, authenticated;
grant execute on function public.otp_take_attempt(uuid, integer) to service_role;

-- 2) Rate limiting générique côté serveur (proxies, verify OTP…). Table réservée au service_role.
create table if not exists public.rate_events (
  id         bigserial primary key,
  key        text        not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_key_time on public.rate_events (key, created_at desc);
alter table public.rate_events enable row level security;
revoke all on table public.rate_events from anon, authenticated;

-- rate_hit(clé, fenêtre en s, max) → true si l'appel est accepté (et compté), false si le plafond
-- est atteint. Purge opportuniste des vieux événements de la même clé.
create or replace function public.rate_hit(p_key text, p_window_s integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.rate_events
   where key = p_key and created_at < now() - make_interval(secs => p_window_s * 4);
  select count(*) into n from public.rate_events
   where key = p_key and created_at > now() - make_interval(secs => p_window_s);
  if n >= p_max then return false; end if;
  insert into public.rate_events (key) values (p_key);
  return true;
end
$$;
revoke all on function public.rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, integer) to service_role;

-- 3) Preuve de débit récent (H3) : un proxy fournisseur vérifie qu'un spend_credits a bien eu lieu
--    pour cet utilisateur dans la fenêtre (les ops à 0 des comptes owner/developer comptent aussi).
create or replace function public.has_recent_debit(p_user uuid, p_minutes integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.credit_ops
     where user_id = p_user
       and refunded_at is null
       and created_at > now() - make_interval(mins => p_minutes)
  );
$$;
revoke all on function public.has_recent_debit(uuid, integer) from public, anon, authenticated;
grant execute on function public.has_recent_debit(uuid, integer) to service_role;

-- 4) Hygiène des grants (L5/H6) : les RPC monétaires/admin ne s'exécutent jamais depuis anon ; on
--    MATÉRIALISE dans le dépôt l'état service_role-only de mcp_spend/refund (jusqu'ici hors migration).
revoke execute on function public.request_referral_payout(integer, text, text, text) from anon;
revoke execute on function public.mark_referral_payout_paid(uuid, text) from anon;
revoke all on function public.mcp_spend_credits(uuid, integer)  from public, anon, authenticated;
revoke all on function public.mcp_refund_credits(uuid, integer) from public, anon, authenticated;

-- 5) mcp_edge_log (H5) : masquer les clés déjà journalisées + retirer les droits d'écriture inutiles.
--    (La RLS bloque déjà toute lecture ; on garde INSERT pour le journal edge.)
update public.mcp_edge_log
   set path = regexp_replace(path, 'aa_[A-Za-z0-9]+', 'aa_***', 'g')
 where path ~ 'aa_[A-Za-z0-9]{8,}';
update public.mcp_edge_log
   set path = regexp_replace(path, '([?&]key=)[^&]+', '\1***', 'g')
 where path ~ '[?&]key=';
revoke update, delete, truncate, references, trigger on table public.mcp_edge_log from anon, authenticated;
