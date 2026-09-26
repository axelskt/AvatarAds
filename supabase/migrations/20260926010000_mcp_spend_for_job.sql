-- MCP · débit LIÉ AU JOB (relecture wf/veo-kie, 26/09).
-- Avant : generate_video / generate_avatar_video (et le lancement d'une image depuis la carte) créaient le job
-- « running » AVEC credits_cost, PUIS débitaient (mcp_spend_credits) dans une tâche de fond. Les filets de
-- réconciliation (8 min sans op_name, 20 min) remboursent credits_cost à tout job « running » : si l'isolate mourait
-- entre l'insert et le débit (boucle d'événements bloquée par une image énorme, mémoire saturée…), le filet rendait
-- des crédits JAMAIS débités — et mcp_refund_credits libérait en plus la part de plafond 24 h, donc répétable.
-- Désormais : le job naît avec credits_cost = 0 ; CETTE fonction débite ET pose credits_cost dans la MÊME transaction
-- (verrou de ligne du job, puis celui du profil — même ordre que failAndRefund → pas d'interblocage). Un job
-- remboursable (credits_cost > 0) a donc TOUJOURS été débité ; les filets et failAndRefund ne rendent que ce montant.
-- Retour : nouveau solde (>= 0 ; solde inchangé pour owner / developer, comme mcp_spend_credits) · -1 crédits
-- insuffisants (rien débité) · -2 job déjà clos ou déjà débité (rien débité : jamais deux débits pour un job).
-- service_role seulement. À APPLIQUER AVANT `supabase functions deploy mcp`.
create or replace function public.mcp_spend_for_job(p_user uuid, p_job uuid, p_cost integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_job public.mcp_jobs%rowtype; v_bal integer;
begin
  if p_cost is null or p_cost <= 0 or p_cost > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_job from public.mcp_jobs where id = p_job for update;
  if not found or v_job.user_id is distinct from p_user then raise exception 'no_job'; end if;
  if v_job.status <> 'running' or coalesce(v_job.refunded, false) or coalesce(v_job.credits_cost, 0) <> 0 then
    return -2;
  end if;
  v_bal := public.mcp_spend_credits(p_user, p_cost);   -- même règle de débit (achetés d'abord, owner / developer non débités)
  if v_bal is null or v_bal < 0 then return -1; end if;
  update public.mcp_jobs set credits_cost = p_cost, updated_at = now() where id = p_job;
  return v_bal;
end $$;
revoke all on function public.mcp_spend_for_job(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.mcp_spend_for_job(uuid, uuid, integer) to service_role;
