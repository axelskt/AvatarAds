-- Réservation de crédits — préalable à RESERVE_ENFORCE=1 (06/09/2026).
--
-- Deux régressions auraient frappé des flux LÉGITIMES si on avait activé l'enforcement tel quel :
--   1. un tirage n'était jamais RENDU quand le fournisseur échouait : le retry 4K après un 503 Google
--      (fréquent) re-tirait 5 sur une réserve déjà à 0 → 402. → release_reservation, appelée par les
--      proxies quand l'amont répond en erreur (soumission 4xx/5xx, ou job async FAILED au poll).
--   2. une image Flux/Kontext bas de gamme (débit 1) fait 2 appels facturants — la génération puis
--      l'auto-HD. → traité dans replicate-proxy : l'upscale devient un appel de FINITION non tiré
--      (helperGate 30/h). PAS en rendant le tirage neutre sur une op réglée : ça rouvrirait #4 (débiter 1,
--      faire une gen à 1 → réglée, puis réutiliser le même x-aa-op pour un Omni à 5 sans tirage).
--
-- draw_reservation reste STRICT (chaque soumission facturante doit tenir dans la réserve, réglée ou non),
-- rendu seulement robuste à reserved_remaining NULL (anciennes ops) via coalesce → amount.

create or replace function public.draw_reservation(p_user uuid, p_op uuid, p_cost integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_rem integer; v_c integer := greatest(1, coalesce(p_cost, 1));
begin
  update public.credit_ops
     set reserved_remaining = coalesce(reserved_remaining, amount) - v_c
   where id = p_op and user_id = p_user and refunded_at is null
     and coalesce(reserved_remaining, amount) >= v_c
   returning reserved_remaining into v_rem;
  return v_rem;   -- NULL = réserve insuffisante (le proxy décide selon RESERVE_ENFORCE)
end $$;

-- Rend p_cost à la réserve (plafonné à amount) sur une op non réglée, non remboursée.
create or replace function public.release_reservation(p_user uuid, p_op uuid, p_cost integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_rem integer; v_c integer := greatest(1, coalesce(p_cost, 1));
begin
  update public.credit_ops
     set reserved_remaining = least(amount, coalesce(reserved_remaining, amount) + v_c)
   where id = p_op and user_id = p_user and refunded_at is null and settled_at is null
   returning reserved_remaining into v_rem;
  return v_rem;
end $$;

revoke all on function public.draw_reservation(uuid, uuid, integer)    from public, anon, authenticated;
revoke all on function public.release_reservation(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.draw_reservation(uuid, uuid, integer)    to service_role;
grant execute on function public.release_reservation(uuid, uuid, integer) to service_role;
