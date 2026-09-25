-- Express Omni Flash (UGC réel) : l'image de départ est OFFERTE (Axel 25/09 : « on offre l'image de départ, c'est plus simple »).
-- Avant : l'app réservait 5 × durée + le coût de l'image (1 low / 3 medium) quand Express devait la créer.
-- Maintenant : l'app réserve 5 × durée seulement. L'image est toujours tirée sur la MÊME op par openai-proxy (x-aa-chain:
-- omni-start) — rien ne change pour elle — et openai-proxy note ce montant sur l'op (omni_start_img, 3 max, une seule fois,
-- op « express-omni » seulement). kie-proxy / fal-proxy tirent ensuite la vidéo avec draw_omni_reservation : 5 × durée
-- MOINS l'image déjà tirée. Total payé = 5 × durée, image comprise.
-- Aucune porte nouvelle : l'image reste tirée et réglée à sa livraison (refund_credits ne rend que la réserve restante),
-- la remise n'existe que si l'image a réellement été tirée sur cette op, et elle est consommée par le tirage de la vidéo.
-- Vidéo en échec : la vidéo est rendue (release du tiré), l'image livrée reste payée (comme avant).
alter table public.credit_ops add column if not exists omni_start_img integer not null default 0;

create or replace function public.omni_start_add(p_user uuid, p_op uuid, p_cost integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  update public.credit_ops
     set omni_start_img = least(3, greatest(1, coalesce(p_cost, 1)))
   where id = p_op and user_id = p_user and refunded_at is null and omni_start_img = 0
     and reason = 'express-omni' and created_at > now() - interval '2 hours'
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Tire la vidéo Omni : p_cost (5 × durée) moins l'image de départ déjà tirée sur l'op (consommée ici, une fois).
-- Renvoie le montant RÉELLEMENT tiré (> 0), ou 0 si la réserve ne couvre pas (→ 402 sous RESERVE_ENFORCE).
create or replace function public.draw_omni_reservation(p_user uuid, p_op uuid, p_cost integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_r integer; v_g integer; v_need integer;
begin
  select coalesce(reserved_remaining, amount), least(3, greatest(0, omni_start_img)) into v_r, v_g
    from public.credit_ops
   where id = p_op and user_id = p_user and refunded_at is null and created_at > now() - interval '2 hours'
   for update;
  if not found then return 0; end if;
  v_need := greatest(1, greatest(1, coalesce(p_cost, 1)) - v_g);
  if v_r < v_need then return 0; end if;
  update public.credit_ops set reserved_remaining = v_r - v_need, omni_start_img = 0 where id = p_op;
  return v_need;
end $$;

revoke all on function public.omni_start_add(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.draw_omni_reservation(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.omni_start_add(uuid, uuid, integer) to service_role;
grant execute on function public.draw_omni_reservation(uuid, uuid, integer) to service_role;
