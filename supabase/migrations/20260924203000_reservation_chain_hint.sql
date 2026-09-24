-- Relecture du 24/09/2026 : le droit d'upscale Nano du palier 4K se prend d'abord sur l'op indiquée par le client
-- (x-aa-op, l'op du palier), sinon sur la plus récente de l'utilisateur. Le proxy ne l'appelle QUE pour un appel Nano
-- marqué x-aa-chain (un faceswap ou un « Améliorer en 4K » ne consomme plus un droit laissé par un palier raté).
drop function if exists public.chain_credit_take(uuid);
create or replace function public.chain_credit_take(p_user uuid, p_hint uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_op uuid;
begin
  update public.credit_ops
     set chain_nano = chain_nano - 1
   where id = coalesce(
           (select id from public.credit_ops
             where id = p_hint and user_id = p_user and refunded_at is null and chain_nano > 0
               and created_at > now() - interval '2 hours'
             for update skip locked),
           (select id from public.credit_ops
             where user_id = p_user and refunded_at is null and chain_nano > 0
               and created_at > now() - interval '2 hours'
             order by created_at desc
             limit 1
             for update skip locked))
     and chain_nano > 0
  returning id into v_op;
  return v_op;
end $$;
revoke execute on function public.chain_credit_take(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chain_credit_take(uuid, uuid) to service_role;
