-- Audit métier 14/09 — résidu auto-parrainage ASYMÉTRIQUE (trouvé à la re-vérif adversariale).
-- Les gardes Phase 2 (parrain payant + même-IP) ferment le 2e compte gratuit et le même-IP, MAIS pas le cas
-- « parrain petit plan (Starter) + filleul gros plan (Élite), IP d'inscription distinctes » : la garde 1 ne teste
-- que plan!='free', pas le MONTANT, et la commission vaut 30% du plan DU FILLEUL → un client peut s'auto-accorder
-- ~30% de remise à vie via un compte-leurre. Décision owner (14/09) : NE PLUS auto-créditer une commission dont le
-- signal économique trahit l'auto-parrainage → la FLAGUER pour revue manuelle (le paiement du filleul, lui, reste
-- traité normalement ; on n'écarte qu'une commission indue). Une commission flaguée reste VISIBLE mais NON RETIRABLE
-- tant que l'owner ne l'a pas approuvée. Non-rétroactif : les gains existants (review_reason NULL) sont inchangés.

alter table public.referral_earnings add column if not exists review_reason text;

-- get_referral_summary : le DISPONIBLE (available_cents, base des virements) n'inclut QUE les commissions non-flaguées.
-- earned_cents reste le total gagné (affichage) ; review_cents = part flaguée en attente de revue owner. Reste identique.
create or replace function public.get_referral_summary()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with e as (
    select coalesce(sum(commission_cents),0)::int as earned_all,
           coalesce(sum(commission_cents) filter (where review_reason is null),0)::int as earned_ok,
           coalesce(sum(commission_cents) filter (where review_reason is not null),0)::int as review,
           count(distinct coalesce(referred_id::text, referred_email))::int as paying
    from public.referral_earnings where referrer_id = auth.uid()
  ), p as (
    select coalesce(sum(amount_cents) filter (where status = 'paid'),0)::int as paid,
           coalesce(sum(amount_cents) filter (where status = 'pending'),0)::int as pending
    from public.referral_payouts where user_id = auth.uid()
  ), r as (
    select count(*)::int as signups from public.profiles pr
    where pr.id <> auth.uid()
      and (pr.referred_by = auth.uid()::text
           or upper(pr.referred_by) = upper(substr(replace(auth.uid()::text,'-',''),1,10)))
  )
  select jsonb_build_object(
    'signups', r.signups, 'paying', e.paying,
    'earned_cents', e.earned_all,
    'review_cents', e.review,
    'paid_cents', p.paid, 'pending_cents', p.pending,
    'available_cents', greatest(0, e.earned_ok - p.paid - p.pending),
    'min_payout_cents', 5000)
  from e, p, r;
$function$;

-- Surface de revue OWNER : lister les commissions flaguées (auto-parrainage possible) en attente.
create or replace function public.referral_reviews()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare out jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_owner = true) then raise exception 'owner only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', re.id, 'referrer_id', re.referrer_id, 'referrer_email', pr.email, 'referrer_plan', pr.plan,
      'referred_id', re.referred_id, 'referred_email', re.referred_email, 'plan_id', re.plan_id,
      'amount_cents', re.amount_cents, 'commission_cents', re.commission_cents,
      'review_reason', re.review_reason, 'created_at', re.created_at) order by re.created_at desc), '[]'::jsonb)
    into out
    from public.referral_earnings re
    left join public.profiles pr on pr.id = re.referrer_id
   where re.review_reason is not null;
  return out;
end $function$;

-- Approuver une commission flaguée (owner) → review_reason NULL → elle redevient disponible au virement.
create or replace function public.approve_referral_earning(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_owner = true) then raise exception 'owner only'; end if;
  update public.referral_earnings set review_reason = null where id = p_id;
  return jsonb_build_object('ok', found);
end $function$;

revoke all on function public.referral_reviews() from public, anon;
revoke all on function public.approve_referral_earning(uuid) from public, anon;
grant execute on function public.referral_reviews() to authenticated;          -- garde is_owner interne
grant execute on function public.approve_referral_earning(uuid) to authenticated;  -- garde is_owner interne
