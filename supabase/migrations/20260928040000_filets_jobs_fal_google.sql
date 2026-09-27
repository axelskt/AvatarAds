-- Audit Express 28/09 (#11) — filets des jobs liés à une op (credit_ops.provider_job) : fal (dont le carré 1:1 d'Express)
-- et repli Google Veo d'Express. Utilisés par reconcile-fal-orphans (pg_cron, x-cron-key) — jamais par un client.
--
-- Avant : list_fal_orphans ne voyait que les ops NON réglées ; or l'image de départ d'Express RÈGLE l'op → un échec fal
-- survenu onglet fermé n'était jamais remboursé, et refund_by_job_terminal refuse une op réglée ('delivered') ou dont une
-- étape est livrée ('not_clean'). Aucun filet pour le repli Google. Une vidéo terminée après l'abandon du client était
-- réglée sans être copiée : payée, jamais livrée.
--
-- refund_job_open : rend le tirage du job (une seule fois, job_bill_state) PUIS rembourse tout ce qui reste sur l'op —
-- partiel si une étape a été livrée (image de départ d'Express : elle reste payée), comme refund_credits / kie_job_bill.
-- Jamais un job réglé ; jamais une op non réglée dont la réserve est entamée par autre chose (in_progress). Pas de garde
-- 2 h : le filet est le seul recours d'un client parti (même règle que kie_job_bill, 'late').

create or replace function public.refund_job_open(p_user uuid, p_job text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.credit_ops%rowtype; v_res integer; v_bought integer; v_new integer;
begin
  if p_user is null or p_job is null or length(p_job) = 0 then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  select * into v from public.credit_ops
   where user_id = p_user and provider_job = p_job and refunded_at is null
   order by created_at desc limit 1 for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'no_op');       end if;
  if v.job_bill_state = 'settled' then                 return jsonb_build_object('ok', false, 'reason', 'delivered');   end if;
  if v.job_bill_state is null and v.job_drawn is null then
                                                       return jsonb_build_object('ok', false, 'reason', 'no_drawn');    end if;
  v_res := least(v.amount, coalesce(v.reserved_remaining, v.amount)
             + case when v.job_bill_state is null then greatest(0, coalesce(v.job_drawn, 0)) else 0 end);
  if v_res < v.amount and v.settled_at is null then   return jsonb_build_object('ok', false, 'reason', 'in_progress'); end if;
  if v_res <= 0 then                                   return jsonb_build_object('ok', false, 'reason', 'nothing');     end if;
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0, job_bill_state = 'refunded' where id = v.id;
  v_bought := least(coalesce(v.bought_part, 0), floor(coalesce(v.bought_part, 0)::numeric * v_res / greatest(v.amount, 1))::int);
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_res,
         bought_credits    = coalesce(bought_credits, 0) + v_bought
   where id = p_user returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'refunded', v_res, 'partial', v_res < v.amount, 'balance', v_new,
                            'late', v.created_at < now() - interval '2 hours');
end $$;

-- Jobs ouverts d'un préfixe ('fal:' / 'veo:') : tirés et pas encore réglés/remboursés (job_bill_state null), ou rendus à la
-- réserve par le client ('released') sans remboursement ni nouveau tirage (onglet fermé après l'échec).
create or replace function public.list_open_jobs(p_prefix text, p_min_age_min integer, p_max_age_min integer, p_limit integer)
returns table(id uuid, user_id uuid, reason text, provider_job text, provider_path text, job_bill_state text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select o.id, o.user_id, o.reason, o.provider_job, o.provider_path, o.job_bill_state, o.created_at
    from public.credit_ops o
   where o.refunded_at is null and o.amount > 0
     and p_prefix in ('fal:', 'veo:') and o.provider_job like p_prefix || '%'
     and (o.job_bill_state is null or o.job_bill_state = 'released')
     and (o.settled_at is null or o.reason in ('express-omni', 'express'))
     and o.created_at < now() - (greatest(1, p_min_age_min) || ' minutes')::interval
     and o.created_at > now() - (greatest(2, p_max_age_min) || ' minutes')::interval
   order by o.created_at asc
   limit greatest(1, least(200, coalesce(p_limit, 50)))
$$;

revoke all on function public.refund_job_open(uuid, text)                          from public, anon, authenticated;
revoke all on function public.list_open_jobs(text, integer, integer, integer)      from public, anon, authenticated;
grant execute on function public.refund_job_open(uuid, text)                       to service_role;
grant execute on function public.list_open_jobs(text, integer, integer, integer)   to service_role;
notify pgrst, 'reload schema';
