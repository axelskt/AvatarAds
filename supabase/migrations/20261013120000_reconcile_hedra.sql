-- 13/10 — filet « jamais perdre de crédits » étendu à Hedra (reconcile-fal-orphans → hedraPass). Seul changement :
-- list_open_jobs accepte aussi le préfixe 'hedra:' (ops liées par hedra-proxy à 'hedra:<job_id>'). Mêmes filtres
-- qu'avant pour fal / veo ; droits inchangés (service_role seul).
create or replace function public.list_open_jobs(p_prefix text, p_min_age_min integer, p_max_age_min integer, p_limit integer)
returns table(id uuid, user_id uuid, reason text, provider_job text, provider_path text, job_bill_state text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select o.id, o.user_id, o.reason, o.provider_job, o.provider_path, o.job_bill_state, o.created_at
    from public.credit_ops o
   where o.refunded_at is null and o.amount > 0
     and p_prefix in ('fal:', 'veo:', 'hedra:') and o.provider_job like p_prefix || '%'
     and (o.job_bill_state is null or o.job_bill_state = 'released')
     and (o.settled_at is null or o.reason in ('express-omni', 'express'))
     and o.created_at < now() - (greatest(1, p_min_age_min) || ' minutes')::interval
     and o.created_at > now() - (greatest(2, p_max_age_min) || ' minutes')::interval
   order by o.created_at asc
   limit greatest(1, least(200, coalesce(p_limit, 50)))
$$;
revoke all on function public.list_open_jobs(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.list_open_jobs(text, integer, integer, integer) to service_role;
notify pgrst, 'reload schema';
