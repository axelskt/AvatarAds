-- Round 2 du ré-audit (06/09) — le re-test adverse a trouvé 2 contournements de CRITICAL 2 :
--   (a) x-aa-op pointant une op LEURRE → resolveOp faisait confiance à l'indice client verbatim → le draw/
--       settle visait le leurre, la VRAIE op restait « propre » et remboursable après livraison.
--   (b) draw_reservation tirait sur le RELIQUAT d'une op déjà RÉGLÉE (p.ex. le reliquat laissé par le
--       forfait Hedra) → réutilisation de crédits déjà payés pour une nouvelle génération.
--
-- (a) resolve_op : l'indice n'est retenu que si c'est une op OUVERTE de l'utilisateur, sinon dernière op
--     ouverte. guard.resolveOp l'appelle → le settle/draw vise TOUJOURS une vraie op ouverte.
-- (b) draw_reservation : refuse une op réglée (settled_at is null exigé).

create or replace function public.resolve_op(p_user uuid, p_hint uuid)
returns uuid language sql security definer set search_path = public as $$
  select coalesce(
    (select id from public.credit_ops
       where id = p_hint and user_id = p_user and settled_at is null and refunded_at is null and amount > 0),
    (select id from public.credit_ops
       where user_id = p_user and settled_at is null and refunded_at is null and amount > 0
       order by created_at desc limit 1)
  )
$$;
revoke all on function public.resolve_op(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_op(uuid, uuid) to service_role;

create or replace function public.draw_reservation(p_user uuid, p_op uuid, p_cost integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rem integer; v_c integer := greatest(1, coalesce(p_cost, 1));
begin
  update public.credit_ops
     set reserved_remaining = coalesce(reserved_remaining, amount) - v_c
   where id = p_op and user_id = p_user and refunded_at is null and settled_at is null
     and coalesce(reserved_remaining, amount) >= v_c
   returning reserved_remaining into v_rem;
  return v_rem;
end $$;
