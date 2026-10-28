-- 28/10 (Axel : nouveau client Pro, « Renouvellement Pro » 18 min après son abonnement) : chaque débit / remboursement fait
-- via Claude (mcp_debits) apparaissait EN DOUBLE dans « Mes crédits » : la ligne « via Claude » ET un « Ajustement du solde »
-- (débit) ou un « Renouvellement … (crédits du mois) » (remboursement). Cause : credit_hist_mark_op lisait new.refunded_at,
-- champ qui n'existe que sur credit_ops → erreur sur mcp_debits, avalée par le bloc d'exception… qui annulait aussi le
-- set_config('aa.ledger') posé dans le même bloc. Correctif : le marqueur est posé seul ; le champ n'est lu que pour credit_ops.
-- Les doublons déjà écrits (13 débits, 1 remboursement, 3 comptes) ne sont PAS supprimés : get_credit_history les écarte.

create or replace function public.credit_hist_mark_op() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform set_config('aa.ledger', 'op', true);
  exception when others then null;
  end;
  if tg_table_name = 'credit_ops' and tg_op = 'UPDATE' then
    begin
      if new.refunded_at is not null and old.refunded_at is null then
        perform set_config('aa.refund_op', new.id::text, true);
      end if;
    exception when others then null;
    end;
  end if;
  return null;
end $$;

CREATE OR REPLACE FUNCTION public.get_credit_history(p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select auth.uid() as uid),
  lim as (select least(greatest(coalesce(p_limit, 40), 1), 100) as n),
  hist as (
    select o.created_at as at,
           case when o.reason ilike 'credit accorde%' or o.reason ilike 'cadeau%' then 'cadeau' else 'depense' end as kind,
           case when o.reason ilike 'credit accorde%' or o.reason ilike 'cadeau%'
                then coalesce(nullif(o.amount, 0), nullif(substring(o.reason from '\+\s*(\d+)'), '')::int, 0)
                else -o.amount end as delta,
           o.reason as label,
           o.refunded_at is not null as refunded,
           case when o.refunded_at is null then null else coalesce(o.refunded_amount, o.amount) end as refunded_amount,
           null::integer as balance_after,
           'app' as via
      from public.credit_ops o, me
     where o.user_id = me.uid and (p_before is null or o.created_at < p_before)
       and (o.amount > 0 or o.reason ilike 'cadeau%')
    union all
    select d.created_at, 'depense', -d.amount, coalesce(j.kind, ''),
           coalesce(d.refunded, false) or coalesce(d.refunded_amt, 0) > 0,
           case when coalesce(d.refunded_amt, 0) > 0 then d.refunded_amt when coalesce(d.refunded, false) then d.amount end,
           null, 'claude'
      from public.mcp_debits d left join public.mcp_jobs j on j.id = d.job_id, me
     where d.user_id = me.uid and d.amount > 0 and (p_before is null or d.created_at < p_before)
    union all
    select e.created_at, e.kind, e.delta, e.label, false, null, e.balance_after, 'compte'
      from public.credit_events e, me
     where e.user_id = me.uid and (p_before is null or e.created_at < p_before)
       -- 28/10 : mouvements déjà montrés par la ligne « via Claude » (débit, ou son remboursement) — doublons d'avant le correctif
       and not exists (select 1 from public.mcp_debits d where d.user_id = e.user_id and d.created_at = e.created_at)
       and not (e.delta > 0 and exists (select 1 from public.mcp_jobs j where j.user_id = e.user_id and j.updated_at = e.created_at and coalesce(j.credits_cost, 0) > 0))
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.at desc)
                        from (select * from hist order by at desc limit (select n from lim)) r), '[]'::jsonb),
    'events_since', '2026-10-15'
  )
$function$;
