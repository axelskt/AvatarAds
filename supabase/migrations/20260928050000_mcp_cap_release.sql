-- Audit Express 28/09 (#23) — plafond 24 h « via Claude » : la part réservée par preSpendGate (mcp_cap_reserve) n'était
-- rendue que par mcp_refund_credits, donc seulement après un débit. Une génération refusée APRÈS la porte (solde
-- insuffisant, erreur d'insertion, carte photo jamais utilisée…) gardait sa part pendant 24 h : le client voyait
-- « plafond atteint » sans avoir rien dépensé. mcp_cap_release rend cette part quand AUCUN débit n'a eu lieu.
-- p_at = moment de la réservation : on ne rend que dans la fenêtre de 24 h qui l'a comptée (jamais dans la suivante).
create or replace function public.mcp_cap_release(p_user uuid, p_cost integer, p_at timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_cost is null or p_cost <= 0 then return; end if;
  update public.profiles
     set mcp_day_spent = greatest(0, coalesce(mcp_day_spent, 0) - p_cost)
   where id = p_user and mcp_day_start is not null
     and mcp_day_start > now() - interval '24 hours' and mcp_day_start <= coalesce(p_at, now());
end $$;
revoke all on function public.mcp_cap_release(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mcp_cap_release(uuid, integer, timestamptz) to service_role;
notify pgrst, 'reload schema';
