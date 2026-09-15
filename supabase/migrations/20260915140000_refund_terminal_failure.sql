-- ═══════════════════════════════════════════════════════════════════════════
-- Remboursement SERVEUR du SOLDE sur ÉCHEC TERMINAL fal (audit Omni 15/09/2026)
--
-- Problème (audit Omni) : sur un échec fal, le proxy ne faisait qu'un release_reservation /
-- release_by_job — qui restaurent SEULEMENT le compteur reserved_remaining, JAMAIS
-- credits_remaining. Le vrai remboursement du solde ne se produisait que via refund_credits,
-- appelé CÔTÉ CLIENT (creditsFlowRefund). Onglet fermé / crash JS pendant l'échec = crédits
-- perdus, sans récupération auto. (C'est ce qui a coûté 40 cr sur le Kling O1 404 le 14/09.)
--
-- Fix : deux RPC service-role qui, sur un état TERMINAL confirmé par le proxy (soumission fal
-- 4xx non-retryable, ou job FAILED/ERROR/CANCELLED), remboursent le solde ET posent refunded_at.
-- Poser refunded_at rend le refund_credits client automatiquement no-op (garde already_refunded)
-- → remboursement EXACTEMENT-UNE-FOIS, garanti serveur, quoi qu'il arrive au navigateur.
--
-- CONCEPTION (revue adversariale 15/09, 4 findings) — PÉRIMÈTRE VOLONTAIREMENT ÉTROIT AU CAS PROPRE :
-- ces fonctions ne remboursent QUE l'op PRIMAIRE ENTIÈREMENT RÉCUPÉRABLE dont RIEN n'a été livré :
--   • settled_at is null      → rien n'a été livré (aucune étape réglée) → pas de refund-and-keep possible ;
--   • v_res >= amount         → restaurer le tirage de CE job/soumission rend TOUTE la réserve (aucune autre
--                               part vivante : ni matting co-tiré, ni étape multi-pipeline non rendue).
-- Ce sont exactement les gens dont on est SÛR qu'ils ont juste échoué (Omni/OmniHuman/Kling standalone).
-- Tout le reste (op partagée aux, multi-étapes, op livrée, replay) → renvoie ok:false SANS RIEN écrire →
-- le proxy RETOMBE sur le release réserve existant (release_by_job / release_reservation) + repli client
-- refund_credits : comportement 100 % INCHANGÉ pour ces cas (aucune régression, findings aux 1/4 = pré-existants).
--
-- Deux propriétés du cas propre :
--   • Pas de refund-and-keep : settled_at null ⇒ rien livré ; on rembourse amount, jamais un montant déjà livré.
--   • Idempotence TOTALE : la restauration est CALCULÉE (jamais persistée) ; seul refunded_at est écrit,
--     atomiquement (garde refunded_at is null dans l'UPDATE). Un 2e appel (double-poll) → already_refunded /
--     no_op, sans jamais ré-incrémenter reserved_remaining. Le repli release_by_job côté proxy no-op alors
--     (garde refunded_at is null). Fini le finding « branche released non idempotente ».
--
-- Portée : couvre les échecs TERMINAUX (4xx soumission + statut FAILED) d'une gen PRIMAIRE. Les transitoires
-- (5xx/timeout de soumission) restent un release réserve + repli client (un refund serveur aveugle sur un 504
-- où fal a quand même mis le job en file rouvrirait le refund-and-keep — chantier séparé : balayage périodique).
--
-- Additif et sûr : aucune signature existante modifiée ; service_role only ; pur (aucun schéma modifié).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Échec de SOUMISSION (op connue, aucun job encore lié). p_restore = ce que CETTE soumission a tiré
--    (drawnAmt côté proxy). Rembourse SEULEMENT si op propre (rien livré + réserve entièrement récupérable).
create or replace function public.refund_op_terminal(p_user uuid, p_op uuid, p_restore integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_op public.credit_ops%rowtype; v_new integer; v_res integer;
begin
  if p_user is null or p_op is null then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  select * into v_op from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'unknown_op');       end if;
  if v_op.refunded_at is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  if v_op.settled_at  is not null then                 return jsonb_build_object('ok', false, 'reason', 'delivered');        end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');          end if;
  -- réserve APRÈS restauration du tirage de cette soumission (CALCULÉE, non persistée), bornée à amount
  v_res := least(v_op.amount, coalesce(v_op.reserved_remaining, v_op.amount) + greatest(1, coalesce(p_restore, 1)));
  if v_res < v_op.amount then                          return jsonb_build_object('ok', false, 'reason', 'not_clean');        end if;   -- op partagée/multi-étapes → repli release côté proxy
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0 where id = v_op.id and refunded_at is null;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;   -- course perdue
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_op.amount,
         bought_credits    = coalesce(bought_credits, 0) + coalesce(v_op.bought_part, 0)
   where id = p_user returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end $$;

-- 2) Échec ASYNCHRONE au poll (op retrouvée par le job lié). Restaure le tiré de CE job (job_drawn), calculé.
--    Rembourse SEULEMENT si op propre (rien livré + réserve entièrement récupérable = 1 job = 1 gen).
create or replace function public.refund_by_job_terminal(p_user uuid, p_job text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_op public.credit_ops%rowtype; v_new integer; v_res integer;
begin
  if p_user is null or p_job is null or length(p_job) = 0 then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  select * into v_op from public.credit_ops
    where user_id = p_user and provider_job = p_job and refunded_at is null
    order by created_at desc limit 1 for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'no_op');            end if;
  if v_op.settled_at  is not null then                 return jsonb_build_object('ok', false, 'reason', 'delivered');        end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');          end if;
  v_res := least(v_op.amount, coalesce(v_op.reserved_remaining, v_op.amount) + greatest(1, coalesce(v_op.job_drawn, v_op.amount)));
  if v_res < v_op.amount then                          return jsonb_build_object('ok', false, 'reason', 'not_clean');        end if;   -- aux partagée / multi-étapes → repli release_by_job côté proxy
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0 where id = v_op.id and refunded_at is null;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_op.amount,
         bought_credits    = coalesce(bought_credits, 0) + coalesce(v_op.bought_part, 0)
   where id = p_user returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end $$;

-- service_role only (le proxy). Jamais anon/authenticated (sinon = imprimante à crédits).
revoke all on function public.refund_op_terminal(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.refund_by_job_terminal(uuid, text)      from public, anon, authenticated;
grant execute on function public.refund_op_terminal(uuid, uuid, integer) to service_role;
grant execute on function public.refund_by_job_terminal(uuid, text)      to service_role;
