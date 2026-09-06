-- CRITICAL 2 (06/09/2026) — refund-and-keep par course.
--
-- L'ancien refund_credits ne refusait qu'une op RÉGLÉE (settled_at). Or le règlement n'a lieu qu'au poll
-- de livraison ; pendant toute la génération ASYNCHRONE (Hedra/Kling/Omni/Veo) l'op restait remboursable →
-- un abonné remboursait pendant la génération et récupérait la vidéo ET les crédits.
--
-- Fix : refuser toute op DÉJÀ TIRÉE (reserved_remaining < amount → une soumission a eu lieu). Un échec amont
-- fait un release (reserved_remaining = amount) → le refund légitime d'une génération ratée reste possible.
create or replace function public.refund_credits(p_op_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_op public.credit_ops%rowtype; v_new integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_op from public.credit_ops where id = p_op_id and user_id = auth.uid() for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'unknown_op');        end if;
  if v_op.refunded_at is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_refunded');  end if;
  if v_op.settled_at  is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_delivered'); end if;
  if v_op.reserved_remaining is not null and v_op.reserved_remaining < v_op.amount then
                                                       return jsonb_build_object('ok', false, 'reason', 'in_progress');       end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');           end if;
  update public.credit_ops set refunded_at = now() where id = v_op.id;
  if v_op.amount > 0 then
    update public.profiles
       set credits_remaining = coalesce(credits_remaining,0) + v_op.amount,
           bought_credits    = coalesce(bought_credits,0) + coalesce(v_op.bought_part,0)
     where id = auth.uid() returning credits_remaining into v_new;
  else
    select credits_remaining into v_new from public.profiles where id = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end;
$function$;
