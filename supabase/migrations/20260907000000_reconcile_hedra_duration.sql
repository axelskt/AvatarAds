-- Audit métier 07/09 — SOUS-FACTURATION À LA DURÉE (Hedra). Calibré sur un VRAI job Hedra terminé :
-- durée = somme des outputs[].duration_ms, tarif = avatarPerSec = 2 cr/s (plat). reconcile_hedra_job charge
-- seulement le MANQUE (coût réel − débit), tolérance 2s (n'affecte pas un client honnête), plafonné au solde
-- (jamais négatif), une seule fois (garde settled), atomique (FOR UPDATE), puis règle l'op. Activé par le secret
-- HEDRA_RECONCILE=1 (interrupteur ; =0 = mode ombre, réglé sans charge). Vérifié en direct : op abuseur de 2 →
-- vidéo 4,56s (coût réel 10) → manque 8 chargé.
create or replace function public.reconcile_hedra_job(p_user uuid, p_job text, p_real_cost integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_op public.credit_ops%rowtype; v_short int; v_charged int := 0; v_bal int; v_bought int;
begin
  if p_job is null or length(p_job) = 0 then return jsonb_build_object('ok', false, 'reason', 'no_job'); end if;
  select * into v_op from public.credit_ops
    where user_id = p_user and provider_job = p_job and refunded_at is null
    order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_op'); end if;
  if v_op.settled_at is not null then return jsonb_build_object('ok', true, 'reason', 'already_settled'); end if;
  v_short := greatest(0, coalesce(p_real_cost, 0) - v_op.amount);
  if v_short >= 4 then
    select credits_remaining, bought_credits into v_bal, v_bought from public.profiles where id = p_user for update;
    v_charged := least(v_short, greatest(0, coalesce(v_bal, 0)));
    if v_charged > 0 then
      update public.profiles
         set credits_remaining = coalesce(credits_remaining, 0) - v_charged,
             bought_credits    = greatest(0, coalesce(bought_credits, 0) - v_charged)
       where id = p_user;
      insert into public.credit_ops (user_id, amount, reason, reserved_remaining, settled_at)
        values (p_user, v_charged, 'hedra-reconcile', 0, now());
    end if;
  end if;
  update public.credit_ops set settled_at = now() where id = v_op.id;
  return jsonb_build_object('ok', true, 'real_cost', p_real_cost, 'op_amount', v_op.amount, 'shortfall', v_short, 'charged', v_charged);
end $$;
revoke all on function public.reconcile_hedra_job(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reconcile_hedra_job(uuid, text, integer) to service_role;
