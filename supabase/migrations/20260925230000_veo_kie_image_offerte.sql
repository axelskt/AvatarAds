-- ═══════════════════════════════════════════════════════════════════════════
-- Veo 3.1 Lite chez kie.ai pour TOUS les clients payants (Axel 25/09/2026 : « Veo Lite passe sur kie, 1080p compris »).
--
-- Prix clients INCHANGÉS (1,5 cr/s en 720p, 3 cr/s en 1080p) ; kie-proxy tire EXACTEMENT tarif × durée facturée, comme
-- Omni Flash. Express crée parfois l'image de départ (gpt-image) sur la MÊME op juste avant la vidéo : comme pour Omni
-- (migration 20260925201000), elle est désormais OFFERTE pour Veo aussi — l'app réserve tarif × durée seulement (le prix
-- affiché), openai-proxy tire l'image puis la note sur l'op (omni_start_img, x-aa-chain: omni-start, 1 image low/medium,
-- ≤ 3, une fois) et la vidéo tire tarif × durée MOINS cette image (draw_omni_reservation, kie-proxy ET google-ai-proxy).
-- Total payé = le débit affiché, image comprise. Avant, l'image était tirée sur la réserve de la vidéo SANS remise : le
-- tirage exact de la vidéo (Google comme kie) ne passait plus (402 sous RESERVE_ENFORCE=1).
--
-- Différence avec Omni : Veo garde un REPLI Google sur la même op quand kie échoue AVANT tout livrable (réserve rendue).
-- La remise d'image, consommée par le tirage kie, doit donc revenir AVEC lui, sinon le repli (tarif × durée − image)
-- trouverait une réserve trop courte d'exactement l'image → 402. D'où :
--   1. omni_start_add accepte aussi l'op « express » (Veo) ;
--   2. kie_jobs.start_img = la remise consommée par le tirage de CETTE tâche (écrite par kie-proxy, jamais par le client) ;
--   3. release_omni_reservation = release_reservation + la remise rendue à l'op, dans la même instruction ;
--   4. kie_job_bill 'release' rend le tiré ET la remise (start_img) — une seule fois (garde bill_state inchangée).
-- Sûreté : la remise ne revient que sur une op Express non remboursée dont la remise est à 0 (donc consommée), plafonnée à
-- 3 ; elle n'est rendue qu'avec le tirage qui l'a consommée (une transition 'release' par tâche) → jamais deux remises
-- pour une image. Service_role seulement.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Image de départ offerte : op Express Omni (« express-omni ») ET op Express Veo (« express »).
create or replace function public.omni_start_add(p_user uuid, p_op uuid, p_cost integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  update public.credit_ops
     set omni_start_img = least(3, greatest(1, coalesce(p_cost, 1)))
   where id = p_op and user_id = p_user and refunded_at is null and omni_start_img = 0
     and reason in ('express-omni', 'express') and created_at > now() - interval '2 hours'
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- 2. Remise d'image consommée par le tirage d'une tâche kie (NULL / 0 = aucune).
alter table public.kie_jobs add column if not exists start_img integer;

-- 3. Rend un tirage draw_omni_reservation en entier : le tiré (comme release_reservation, borné à amount) ET la remise
--    d'image qu'il avait consommée (seulement si elle est à 0 sur l'op, plafonnée à 3, op Express).
create or replace function public.release_omni_reservation(p_user uuid, p_op uuid, p_cost integer, p_img integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rem integer; v_c integer := greatest(1, coalesce(p_cost, 1)); v_g integer := least(3, greatest(0, coalesce(p_img, 0)));
begin
  update public.credit_ops
     set reserved_remaining = least(amount, coalesce(reserved_remaining, amount) + v_c),
         omni_start_img = case when v_g > 0 and omni_start_img = 0 and reason in ('express-omni', 'express') then v_g else omni_start_img end
   where id = p_op and user_id = p_user and refunded_at is null
   returning reserved_remaining into v_rem;
  return v_rem;
end $$;

-- 4. kie_job_bill : identique à 20260925130000, sauf la branche 'release' (tiré + remise d'image, voir l'en-tête).
create or replace function public.kie_job_bill(p_user uuid, p_task text, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.kie_jobs%rowtype; v_op public.credit_ops%rowtype; v_r jsonb; v_reason text; v_res integer; v_bought integer;
begin
  if p_user is null or p_task is null or length(p_task) = 0 or p_action is null or p_action not in ('settle', 'release', 'refund') then
    return jsonb_build_object('ok', false, 'reason', 'bad_args', 'bill', null);
  end if;
  select * into v_job from public.kie_jobs where task_id = p_task and user_id = p_user for update;
  if not found then            return jsonb_build_object('ok', false, 'reason', 'no_job', 'bill', null);   end if;
  if v_job.op_id is null then  return jsonb_build_object('ok', false, 'reason', 'no_op',  'bill', 'none'); end if;

  if p_action = 'settle' then
    if v_job.bill_state is distinct from 'drawn' then return jsonb_build_object('ok', false, 'reason', 'not_drawn', 'bill', v_job.bill_state); end if;
    perform public.settle_reservation(p_user, v_job.op_id);
    update public.kie_jobs set bill_state = 'settled', billed_at = now() where task_id = p_task;
    return jsonb_build_object('ok', true, 'bill', 'settled');
  end if;

  if p_action = 'release' then
    if v_job.bill_state is distinct from 'drawn' then return jsonb_build_object('ok', false, 'reason', 'not_drawn', 'bill', v_job.bill_state); end if;
    -- 25/09 (Veo) : le tiré EXACT ET la remise d'image de départ qu'il avait consommée (start_img) → l'op revient à son
    -- état d'avant la soumission et le repli Google la re-tire au même prix (vidéo − image offerte).
    if coalesce(v_job.drawn, 0) > 0 then perform public.release_omni_reservation(p_user, v_job.op_id, v_job.drawn, coalesce(v_job.start_img, 0)); end if;
    update public.kie_jobs set bill_state = 'released', billed_at = now() where task_id = p_task;
    return jsonb_build_object('ok', true, 'bill', 'released');
  end if;

  -- refund
  if v_job.bill_state not in ('drawn', 'released') then
    return jsonb_build_object('ok', false, 'reason', 'not_open', 'bill', v_job.bill_state);
  end if;
  if v_job.bill_state = 'drawn' then
    v_r := public.refund_op_terminal(p_user, v_job.op_id, greatest(1, coalesce(v_job.drawn, 1)));
    if coalesce((v_r->>'ok')::boolean, false) then
      update public.kie_jobs set bill_state = 'refunded', billed_at = now() where task_id = p_task;
      return jsonb_build_object('ok', true, 'bill', 'refunded', 'refunded', v_r->'refunded');
    end if;
    v_reason := coalesce(v_r->>'reason', 'refused');
    if v_reason in ('unknown_op', 'already_refunded') then
      update public.kie_jobs set bill_state = 'closed', bill_reason = v_reason, billed_at = now() where task_id = p_task;
      return jsonb_build_object('ok', false, 'reason', v_reason, 'bill', 'closed');
    end if;
    -- op multi-étapes / livrée / de plus de 2 h → release du tiré EXACT (comportement des proxys), puis règle refund_credits
    if coalesce(v_job.drawn, 0) > 0 then perform public.release_reservation(p_user, v_job.op_id, v_job.drawn); end if;
    update public.kie_jobs set bill_state = 'released', billed_at = now() where task_id = p_task;
  end if;

  -- Réserve rendue : MÊME règle que refund_credits (ce que l'app aurait remboursé si l'onglet avait survécu). Ligne op
  -- verrouillée → aucun tirage concurrent entre le contrôle et le remboursement. Re-tirée par le repli (réserve 0, ou
  -- tirage en cours non réglé) → rien à rendre, l'étape suivante (Google / fal) a sa propre facturation.
  -- (Axel 25/09) PAS de garde « op de plus de 2 h » ici (voir l'en-tête) : le filet arrive souvent après 2 h, et une op
  -- morte n'est plus tirable par personne → sa réserve restante est exactement ce qui n'a pas été livré.
  select * into v_op from public.credit_ops where id = v_job.op_id and user_id = p_user for update;
  if not found then v_reason := 'unknown_op';
  elsif v_op.refunded_at is not null then v_reason := 'already_refunded';
  else
    v_res := coalesce(v_op.reserved_remaining, v_op.amount);
    if v_res < v_op.amount and v_op.settled_at is null then v_reason := 'in_progress';
    elsif v_res <= 0 then v_reason := 'already_delivered';
    else
      update public.credit_ops set refunded_at = now(), reserved_remaining = 0 where id = v_op.id;
      v_bought := least(coalesce(v_op.bought_part, 0), floor(coalesce(v_op.bought_part, 0)::numeric * v_res / greatest(v_op.amount, 1))::int);
      update public.profiles
         set credits_remaining = coalesce(credits_remaining, 0) + v_res,
             bought_credits    = coalesce(bought_credits, 0) + v_bought
       where id = p_user;
      update public.kie_jobs set bill_state = 'refunded', billed_at = now(),
             bill_reason = case when v_op.created_at < now() - interval '2 hours' then 'too_old' end where task_id = p_task;
      return jsonb_build_object('ok', true, 'bill', 'refunded', 'refunded', v_res, 'partial', v_res < v_op.amount,
                                'late', v_op.created_at < now() - interval '2 hours');
    end if;
  end if;
  update public.kie_jobs set bill_state = 'closed', bill_reason = v_reason, billed_at = now() where task_id = p_task;
  return jsonb_build_object('ok', false, 'reason', v_reason, 'bill', 'closed');
end $$;

revoke all on function public.omni_start_add(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_omni_reservation(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.kie_job_bill(uuid, text, text) from public, anon, authenticated;
grant execute on function public.omni_start_add(uuid, uuid, integer) to service_role;
grant execute on function public.release_omni_reservation(uuid, uuid, integer, integer) to service_role;
grant execute on function public.kie_job_bill(uuid, text, text) to service_role;
