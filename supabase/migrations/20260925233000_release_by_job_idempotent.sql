-- ═══════════════════════════════════════════════════════════════════════════
-- Libération PAR JOB exactement une fois (relecture wf/veo-kie, 26/09/2026).
--
-- Problème : release_by_job n'avait AUCUNE garde d'idempotence. Chaque appel ré-ajoutait job_drawn à la réserve (borné à
-- amount). Or le proxy l'appelle à CHAQUE lecture du suivi d'un job terminé sans résultat : un Veo bloqué par le filtre RAI
-- de Google (déclenchable à volonté, non facturé par Google), un fal FAILED, un Hedra failed… Relire deux fois le même suivi
-- remontait la réserve jusqu'à amount, et refund_by_job_terminal ajoutait EN PLUS job_drawn à une réserve déjà restaurée
-- (restauration « calculée » par-dessus la restauration persistée). Issue : remboursement supérieur au prix payé, ou
-- étape livrée gratuite sur la même op (image de départ d'Express, vidéo kie livrée…) = refund-and-keep.
--   Exemple (op Express 12) : image offerte 3 livrée, Veo Google 9 lié puis filtré, suivi lu 2 fois → 12 remboursés au
--   lieu de 9. Op 24 : Veo Google A filtré + Veo kie B livré, suivi de A lu 2 fois → 24 remboursés, B gratuite.
--
-- Fix : une op a au plus UN job lié (bind_reservation_job n'écrit que si provider_job est NULL) → son tirage se règle ou se
-- rend UNE fois. Colonne job_bill_state (NULL = job ouvert) :
--   • release_by_job   : agit seulement si job_bill_state est NULL, et pose 'released' dans le même UPDATE ;
--   • settle_by_job    : pose 'settled' (si encore NULL) → un job livré n'est plus jamais « rendu » ensuite ;
--   • refund_by_job_terminal : 'settled' = livré (refus) ; 'released' = le tirage est DÉJÀ dans la réserve → on ne le
--     rajoute plus au calcul (seul un reliquat réellement entier, rien de livré, est remboursé) ; pose 'refunded'.
-- Même correctif pour tous les appelants (google-ai-proxy, fal-proxy, hedra-proxy, render-job, render-worker) : signatures
-- et valeurs de retour inchangées. Ops liées avant la migration : job_bill_state NULL = une libération possible (comme
-- avant, mais une seule). Service_role seulement (inchangé).
--
-- Déploiement : mêmes signatures, aucun appelant à redéployer. À appliquer JUSTE APRÈS 20260925230000 et AVANT les
-- fonctions (google-ai-proxy nouvelle version rend ce chemin atteignable : image offerte → Google tire au lieu de 402).
-- Ops liées avant la migration (< 2 h, encore tirables) : job_bill_state NULL = une libération encore possible, jamais plus.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.credit_ops add column if not exists job_bill_state text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'credit_ops_job_bill_state_chk') then
    alter table public.credit_ops add constraint credit_ops_job_bill_state_chk check (job_bill_state is null or job_bill_state in ('released', 'settled', 'refunded'));
  end if;
end $$;

-- 1) release_by_job : rend EXACTEMENT ce que le job a tiré (job_drawn), UNE fois. Rejoué / job déjà réglé → NULL, rien écrit.
create or replace function public.release_by_job(p_user uuid, p_job text, p_cost integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_row public.credit_ops%rowtype; v_id uuid; v_add integer;
begin
  if p_job is null or length(p_job) = 0 then return null; end if;
  select * into v_row from public.credit_ops
    where user_id = p_user and provider_job = p_job and refunded_at is null
    order by created_at desc limit 1 for update;
  if not found then return null; end if;
  if v_row.job_bill_state is not null then return null; end if;   -- déjà rendu / réglé : jamais deux fois
  v_add := coalesce(v_row.job_drawn, greatest(1, coalesce(p_cost, 1)));   -- job_drawn = tiré réel ; sinon repli (anciens binds)
  update public.credit_ops
     set reserved_remaining = least(amount, coalesce(reserved_remaining, amount) + v_add),
         job_bill_state     = 'released'
   where id = v_row.id and job_bill_state is null
   returning id into v_id;
  return v_id;
end $$;

-- 2) settle_by_job : inchangé (op livrée, non remboursable) + le job est noté réglé → plus de libération possible après.
create or replace function public.settle_by_job(p_user uuid, p_job text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_job is null or length(p_job) = 0 then return null; end if;
  update public.credit_ops
     set settled_at     = coalesce(settled_at, now()),
         job_bill_state = coalesce(job_bill_state, 'settled')
   where user_id = p_user and provider_job = p_job and refunded_at is null
   returning id into v_id;
  return v_id;
end $$;

-- 3) refund_by_job_terminal : la restauration CALCULÉE n'ajoute job_drawn que si le job n'a pas déjà été rendu.
create or replace function public.refund_by_job_terminal(p_user uuid, p_job text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_op public.credit_ops%rowtype; v_new integer; v_res integer;
begin
  if p_user is null or p_job is null or length(p_job) = 0 then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  select * into v_op from public.credit_ops
    where user_id = p_user and provider_job = p_job and refunded_at is null
    order by created_at desc limit 1 for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'no_op');            end if;
  if v_op.settled_at is not null or v_op.job_bill_state = 'settled' then
                                                       return jsonb_build_object('ok', false, 'reason', 'delivered');        end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');          end if;
  v_res := least(v_op.amount, coalesce(v_op.reserved_remaining, v_op.amount)
             + case when v_op.job_bill_state is null then greatest(1, coalesce(v_op.job_drawn, v_op.amount)) else 0 end);
  if v_res < v_op.amount then                          return jsonb_build_object('ok', false, 'reason', 'not_clean');        end if;
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0, job_bill_state = coalesce(job_bill_state, 'refunded')
   where id = v_op.id and refunded_at is null;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_op.amount,
         bought_credits    = coalesce(bought_credits, 0) + coalesce(v_op.bought_part, 0)
   where id = p_user returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end $$;

revoke all on function public.release_by_job(uuid, text, integer)   from public, anon, authenticated;
revoke all on function public.settle_by_job(uuid, text)             from public, anon, authenticated;
revoke all on function public.refund_by_job_terminal(uuid, text)    from public, anon, authenticated;
grant execute on function public.release_by_job(uuid, text, integer) to service_role;
grant execute on function public.settle_by_job(uuid, text)           to service_role;
grant execute on function public.refund_by_job_terminal(uuid, text)  to service_role;
