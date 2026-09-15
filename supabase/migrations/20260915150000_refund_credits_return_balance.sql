-- refund_credits renvoie le SOLDE sur CHAQUE retour, y compris les refus (audit Omni 15/09).
--
-- Problème : depuis que le PROXY rembourse le solde côté serveur sur un échec fal (refund_op_terminal /
-- refund_by_job_terminal), un refund_credits client sur la MÊME op tombe sur 'already_refunded' et ne
-- renvoyait AUCUN solde → le mirror local `currentMember.credits_remaining` restait périmé (trop bas).
-- Conséquence concrète : le repli modération Motion 3.0→2.6 re-débite 60 cr, mais son pré-check CLIENT
-- (`creditsBalance() < amount`) lisait le solde périmé → un Pro à 90-149 cr voyait « crédits insuffisants »
-- alors que le serveur avait bien le solde. Plus généralement : l'affichage du solde restait faux après
-- tout remboursement proxy (5xx/404…) jusqu'à un refresh complet.
--
-- Fix (purement ADDITIF — aucune logique de remboursement modifiée) : chaque retour porte désormais 'balance'
-- = credits_remaining courant. Le client resynchronise son mirror dessus (même quand data.ok=false), donc le
-- solde affiché ET les pré-checks client sont toujours exacts après un remboursement serveur.
create or replace function public.refund_credits(p_op_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_op public.credit_ops%rowtype; v_new integer; v_res integer; v_bought integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_op from public.credit_ops where id = p_op_id and user_id = auth.uid() for update;
  if not found then
    select credits_remaining into v_new from public.profiles where id = auth.uid();
    return jsonb_build_object('ok', false, 'reason', 'unknown_op', 'balance', v_new);
  end if;
  -- op trouvée → on connaît le solde de l'appelant : on le renvoie sur CHAQUE refus (resync du mirror client).
  select credits_remaining into v_new from public.profiles where id = auth.uid();
  if v_op.refunded_at is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_refunded',  'balance', v_new); end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old',           'balance', v_new); end if;
  v_res := coalesce(v_op.reserved_remaining, v_op.amount);
  if v_res < v_op.amount and v_op.settled_at is null then
                                                       return jsonb_build_object('ok', false, 'reason', 'in_progress',       'balance', v_new); end if;
  if v_res <= 0 then                                   return jsonb_build_object('ok', false, 'reason', 'already_delivered', 'balance', v_new); end if;
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0 where id = v_op.id;
  v_bought := least(coalesce(v_op.bought_part, 0), floor(coalesce(v_op.bought_part, 0)::numeric * v_res / greatest(v_op.amount, 1))::int);
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_res,
         bought_credits    = coalesce(bought_credits, 0) + v_bought
   where id = auth.uid() returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_res, 'partial', v_res < v_op.amount);
end;
$function$;
