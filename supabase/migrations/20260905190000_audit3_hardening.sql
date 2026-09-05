-- Durcissement audit offensif #3 (05/09/2026).

-- B1 — la RÉSERVATION ne doit JAMAIS dépendre d'un en-tête client. `latest_open_op` donne au proxy l'op
-- ouverte (non réglée, non remboursée) la plus récente de l'utilisateur → le settle et le draw sont
-- résolus CÔTÉ SERVEUR même si le client omet `x-aa-op`. Referme le refund-and-keep sur les générations
-- asynchrones (Veo/Kling/Hedra) : toute complétion vue par le proxy règle une op → non remboursable.
create or replace function public.latest_open_op(p_user uuid)
returns uuid language sql security definer set search_path to 'public' as $$
  select id from public.credit_ops
   where user_id = p_user and refunded_at is null and settled_at is null and amount > 0
   order by created_at desc limit 1
$$;
revoke all on function public.latest_open_op(uuid) from public, anon, authenticated;
grant execute on function public.latest_open_op(uuid) to service_role;

-- A5 — request_referral_payout TOCTOU : une seule demande `pending` par utilisateur (index unique partiel).
create unique index if not exists uniq_pending_payout on public.referral_payouts (user_id) where status = 'pending';

-- A2 — retirer les droits d'ÉCRITURE anon/authenticated sur les tables gérées uniquement par le serveur
-- (RLS deny-all les couvre déjà, mais un GRANT en trop = account-takeover à la moindre régression RLS).
-- On garde SELECT (l'app lit ses propres lignes via RLS). Ces tables ne sont jamais écrites par le client.
revoke insert, update, delete, truncate, references, trigger
  on public.referral_earnings, public.referral_payouts, public.mcp_jobs, public.mcp_keys,
     public.otp_codes, public.pending_activations
  from anon, authenticated;
alter table public.referral_payouts  force row level security;
alter table public.referral_earnings force row level security;
alter table public.mcp_keys          force row level security;
alter table public.mcp_jobs          force row level security;
alter table public.otp_codes         force row level security;

-- A1 — point de défaillance unique : la policy « Own profile update » n'a pas de WITH CHECK par colonne ;
-- seule l'ABSENCE de GRANT UPDATE empêche un `PATCH profiles {is_owner:true}`. Filet DÉFINITIF : un trigger
-- qui rejette toute modification des colonnes sensibles par un rôle ≠ définisseur/service. `current_user`
-- (et NON auth.role()) distingue un PATCH direct (authenticated/anon) d'un appel via une RPC SECURITY
-- DEFINER (spend_credits & co, exécutées en tant que postgres) ou le webhook (service_role) — qui, eux, DOIVENT passer.
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path to 'public' as $$
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
  ) then
    raise exception 'colonne protégée (plan/crédits/is_owner) — passe par une RPC serveur';
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles for each row execute function public.profiles_guard();
