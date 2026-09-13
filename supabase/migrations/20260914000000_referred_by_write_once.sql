-- M2 (audit 14/09) : referred_by verrouillé côté serveur (write-once), comme plan/crédits.
-- Découverte : le rôle `authenticated` n'a JAMAIS eu le GRANT UPDATE sur referred_by → l'UPDATE direct du
-- client (app/index.html, ancien `sb.from('profiles').update({referred_by})`) échouait en 42501 (avalé par un
-- try/catch) → le parrainage n'était JAMAIS attribué (73 profils, 0 referred_by, 0 commission au 14/09).
-- Donc : pas un trou de sécurité (l'écriture directe était déjà refusée), mais une FONCTIONNALITÉ CASSÉE.
-- Fix : une RPC set_referrer (SECURITY DEFINER, write-once) pose le champ ; le trigger le protège en défense
-- en profondeur (interdit aussi une rotation via un futur GRANT). Le client appelle désormais set_referrer.

-- 1) set_referrer : pose referred_by UNE SEULE FOIS (si vide), scellé sur auth.uid().
create or replace function public.set_referrer(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_cur text;
begin
  if auth.uid() is null then return false; end if;
  select referred_by into v_cur from public.profiles where id = auth.uid();
  if coalesce(v_cur, '') <> '' then return false; end if;              -- déjà posé → write-once, pas de rotation
  update public.profiles set referred_by = nullif(trim(p_code), '')
    where id = auth.uid() and coalesce(referred_by, '') = '';
  return found;
end $$;
revoke all on function public.set_referrer(text) from public, anon;
grant execute on function public.set_referrer(text) to authenticated;

-- 2) profiles_guard : ajoute referred_by aux colonnes protégées (UPDATE direct interdit → via set_referrer).
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') and (
       new.is_owner            is distinct from old.is_owner
    or new.plan                is distinct from old.plan
    or new.credits_remaining   is distinct from old.credits_remaining
    or new.credits_total       is distinct from old.credits_total
    or new.bought_credits      is distinct from old.bought_credits
    or new.img_bonus_credits   is distinct from old.img_bonus_credits
    or new.whop_member_id      is distinct from old.whop_member_id
    or new.whop_plan_id        is distinct from old.whop_plan_id
    or new.first_sub_bonus_used is distinct from old.first_sub_bonus_used
    or new.referred_by         is distinct from old.referred_by
  ) then
    raise exception 'colonne protégée (plan/crédits/is_owner/parrainage) — passe par une RPC serveur';
  end if;
  return new;
end $$;
