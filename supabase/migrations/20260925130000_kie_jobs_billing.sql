-- ═══════════════════════════════════════════════════════════════════════════
-- kie.ai ouvert aux clients payants (Axel 25/09/2026) — facturation liée à la tâche kie.
--
-- Deux usages seulement : « Améliorer en 4K » (Nano Banana Pro, Starter+) et Omni Flash image→vidéo (Express, Pro/Élite).
-- kie-proxy tire la réservation (x-aa-op) AVANT l'appel kie, exactement comme google-ai-proxy (Nano, tirage 5) et
-- fal-proxy (Omni, tirage de la réserve entière). La réservation est LIÉE à la tâche ici (op_id + drawn) pour que
-- reconcile-kie règle / rende aussi quand l'onglet a été fermé.
--
-- Pourquoi PAS credit_ops.provider_job (bind_reservation_job) : il n'écrit que si provider_job est NULL. Lier l'op à la
-- tâche kie empêcherait le repli fal (Omni, même op re-tirée après un échec kie) de lier SON job → règlement / remboursement
-- fal orphelins (l'op resterait tirée-non-réglée = crédits perdus sur un échec fal). Le lien vit donc côté kie_jobs.
--
-- États de facturation (bill_state, NULL = aucune réservation : developer / owner / service_role) :
--   drawn    → tirée, issue inconnue ;
--   settled  → résultat rapatrié (livré, non remboursable) ;
--   released → tirage rendu à la RÉSERVE (échec kie, onglet vivant) : l'app peut re-tirer la MÊME op pour son repli
--              (Google / fal), ou la rembourser (refund_credits) ;
--   refunded → solde remboursé côté serveur (refund_op_terminal : onglet fermé, ou soumission sans réponse ; op de plus
--              de 2 h : ce qui n'a pas été livré, voir kie_job_bill — bill_reason 'too_old') ;
--   closed   → plus rien à faire (op livrée / re-tirée par le repli, déjà remboursée…) — raison dans bill_reason.
-- Chaque transition passe par kie_job_bill (verrou de ligne + garde d'état dans la MÊME transaction) → EXACTEMENT UNE
-- FOIS : un résultat relu deux fois ne règle pas deux fois, un échec relu ne rend pas deux fois.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.kie_jobs
  add column if not exists op_id       uuid,          -- op credit_ops tirée pour cette tâche (NULL = aucune réservation)
  add column if not exists drawn       integer,       -- montant EXACT tiré par cette tâche (restauration exacte, jamais 9999)
  add column if not exists bill_state  text,          -- drawn → settled | released | refunded | closed
  add column if not exists bill_reason text,          -- pourquoi closed (already_delivered, in_progress…) / too_old = remboursement tardif (Axel 25/09)
  add column if not exists billed_at   timestamptz;   -- dernière transition de facturation

alter table public.kie_jobs drop constraint if exists kie_jobs_bill_state_check;
alter table public.kie_jobs add constraint kie_jobs_bill_state_check
  check (bill_state is null or bill_state in ('drawn', 'settled', 'released', 'refunded', 'closed'));

-- Filet de facturation (reconcile-kie) : seules les lignes encore « ouvertes » sont balayées (délai compté sur billed_at).
create index if not exists kie_jobs_bill_open_idx on public.kie_jobs (bill_state, billed_at)
  where bill_state in ('drawn', 'released');

-- ── Transition de facturation d'UNE tâche kie (service_role seulement : kie-proxy + reconcile-kie) ──
--   settle  : drawn → settled   (settle_reservation) ;
--   release : drawn → released  (release_reservation du tiré EXACT) — kie-proxy, onglet vivant (repli possible) ;
--   refund  : (reconcile-kie seulement : onglet fermé depuis > 30 min, plus aucun repli en cours)
--             drawn → refunded par refund_op_terminal (op propre : rembourse l'op entière) ; refus (op multi-étapes : ex.
--             image de départ Express réglée sur la même op) → release du tiré exact, puis règle ci-dessous ;
--             released → même règle que refund_credits (ce que l'app aurait fait) : rembourse la RÉSERVE RESTANTE si
--             personne ne l'a re-tirée (partiel si une autre étape a été livrée) ; re-tirée par le repli / en cours /
--             déjà remboursée → closed.
--             Op de PLUS DE 2 H (Axel 25/09) : refund_op_terminal / refund_credits la refusent (too_old). Avant, la ligne
--             passait closed SANS rien rendre, or le filet n'abandonne une tâche qu'après 6 h (en cours), 24 h
--             (introuvable), 48 h (kie injoignable) ou 6 copies ratées → crédits perdus à chaque fois. La règle
--             ci-dessous s'applique donc SANS la garde 2 h (bill_reason 'too_old' = remboursement tardif) : sûr, car après
--             2 h l'op n'est plus tirable (resolve_op / draw_* exigent < 2 h) ni remboursable par personne d'autre, et la
--             garde bill_state sous FOR UPDATE + refunded_at posé = une seule fois (même à deux tâches sur la même op).
-- Renvoie { ok, bill, reason?, refunded? } ; `bill` = état APRÈS l'appel (renvoyé tel quel au client).
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
    if coalesce(v_job.drawn, 0) > 0 then perform public.release_reservation(p_user, v_job.op_id, v_job.drawn); end if;
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

-- service_role only (kie-proxy, reconcile-kie). Jamais anon/authenticated (sinon = imprimante à crédits).
revoke all on function public.kie_job_bill(uuid, text, text) from public, anon, authenticated;
grant execute on function public.kie_job_bill(uuid, text, text) to service_role;
