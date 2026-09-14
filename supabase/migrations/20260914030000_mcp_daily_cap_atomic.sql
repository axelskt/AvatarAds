-- Audit MCP 14/09 — F1 : plafond quotidien MCP (100 pro / 200 élite cr/24h) rendu ATOMIQUE.
-- Avant : mcpSpentToday() = SELECT non-atomique de la somme mcp_jobs AVANT le débit, la ligne mcp_jobs étant
-- insérée APRÈS → un burst concurrent lisait tous le même cumul bas, passait tous le plafond, et drainait le solde
-- entier (surtout dangereux avec une clé fuitée). Fix : un compteur profiles.mcp_day_spent réservé sous le VERROU
-- de ligne du profil → les réservations concurrentes se sérialisent, chacune voit l'incrément de la précédente.

alter table public.profiles add column if not exists mcp_day_spent integer not null default 0;
alter table public.profiles add column if not exists mcp_day_start timestamptz;

-- Amorçage : semer le compteur avec la dépense MCP réelle des dernières 24 h (sinon le plafond serait « remis à zéro »
-- au déploiement pour les comptes ayant déjà généré aujourd'hui).
update public.profiles p
   set mcp_day_spent = coalesce((select sum(j.credits_cost) from public.mcp_jobs j
                                  where j.user_id = p.id and j.created_at > now() - interval '24 hours' and not j.refunded), 0),
       mcp_day_start = now()
 where exists (select 1 from public.mcp_jobs j where j.user_id = p.id and j.created_at > now() - interval '24 hours');

-- Réservation ATOMIQUE d'une part du plafond. Retour : nouveau cumul (>=0) si réservé ; -1 si plafond atteint (rien
-- réservé) ; 0 pour owner/developer (illimité). Fenêtre 24 h glissante-approx (reset quand expirée). service_role only.
create or replace function public.mcp_cap_reserve(p_user uuid, p_cost integer, p_cap integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_row public.profiles%rowtype; v_spent integer; v_reset boolean;
begin
  if p_cost is null or p_cost <= 0 then return 0; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then return -1; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then return 0; end if;
  v_reset := v_row.mcp_day_start is null or v_row.mcp_day_start < now() - interval '24 hours';
  v_spent := case when v_reset then 0 else coalesce(v_row.mcp_day_spent, 0) end;
  if p_cap is not null and p_cap > 0 and v_spent + p_cost > p_cap then return -1; end if;   -- plafond atteint
  update public.profiles
     set mcp_day_spent = v_spent + p_cost,
         mcp_day_start = case when v_reset then now() else mcp_day_start end
   where id = p_user;
  return v_spent + p_cost;
end $$;
revoke all on function public.mcp_cap_reserve(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.mcp_cap_reserve(uuid, integer, integer) to service_role;

-- mcp_refund_credits : re-crédite ET LIBÈRE la part de plafond réservée (un job remboursé ne consomme pas le quota
-- 24 h). Reprend le corps live (créé au dashboard) + le décrément du compteur. CREATE OR REPLACE conserve les droits
-- (déjà révoqués de public/anon/authenticated, service_role only — migration 20260905120000).
create or replace function public.mcp_refund_credits(p_user uuid, p_secs integer)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_new integer;
begin
  if p_secs is null or p_secs <= 0 or p_secs > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    return coalesce(v_row.credits_remaining, 0);
  end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) + p_secs,
         mcp_day_spent      = greatest(0, coalesce(mcp_day_spent,0) - p_secs)
   where id = p_user returning credits_remaining into v_new;
  return v_new;
end; $function$;
