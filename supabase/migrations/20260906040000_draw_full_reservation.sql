-- Audit métier (06/09) — CRITICAL « N générations pour un débit » sur la VIDÉO.
-- Le tirage forfaitaire (Hedra=2, fal par modèle, migration 20260906010000) laissait une grosse réserve
-- intacte → un débit unique finançait N soumissions vidéo. Fix : sur une soumission VIDÉO, TIRER LA RÉSERVE
-- ENTIÈRE → une op = une seule génération ; une 2e soumission sur la même op trouve réserve 0 → 402
-- (RESERVE_ENFORCE=1). Le worker de rendu (service_role) ne réserve pas → chemin réservé au Générateur direct.
-- ⚠ Résidu connu : ne ferme PAS la sous-facturation par génération (débit client < coût réel) — voir mémoire.
create or replace function public.draw_full_reservation(p_user uuid, p_op uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  update public.credit_ops
     set reserved_remaining = 0
   where id = p_op and user_id = p_user and refunded_at is null and settled_at is null
     and coalesce(reserved_remaining, amount) > 0
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.draw_full_reservation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.draw_full_reservation(uuid, uuid) to service_role;
