-- 23/10/2026 (Axel) : les crédits de l'ABONNEMENT sont dépensés en premier, les crédits ACHETÉS (packs) ensuite.
-- Inverse la règle du 03/09 (20260903190000_credits_bought_spent_first). Raison : les crédits du plan se perdent au-delà
-- du plafond de report (2× le mois), les achetés jamais → dépenser le plan d'abord est ce que le client attend.
--
-- Pour un débit n sur un solde R dont B achetés (B ≤ R) : part du plan = R − B, prise d'abord ; part achetée =
-- max(0, n − (R − B)) = max(0, B − (R − n)), bornée à n. Elle est mémorisée (credit_ops.bought_part, mcp_debits.bought)
-- et rendue telle quelle au remboursement (fonctions de remboursement inchangées).
--
-- Seules les lignes de débit des 5 fonctions concernées sont réécrites, le reste du code est repris tel quel depuis la
-- base (pg_get_functiondef) : chaque remplacement doit trouver son texte EXACTEMENT une fois, sinon tout est annulé.
-- Le clonage de voix (charge_voice_clone) dépensait déjà le plan d'abord.

create or replace function pg_temp.r1(d text, o text, n text) returns text language plpgsql as $f$
declare c int := (length(d) - length(replace(d, o, ''))) / greatest(length(o), 1);
begin
  if c <> 1 then raise exception 'remplacement introuvable ou ambigu (% occurrences) : %', c, left(o, 80); end if;
  return replace(d, o, n);
end $f$;

do $mig$
declare d text;
  plan_dabord_fal constant text := 'least(v_charged, greatest(0, coalesce(v_bought, 0) - (coalesce(v_bal, 0) - v_charged)))';
begin
  -- spend_credits(p_secs, p_reason) : débit de l'app
  d := pg_get_functiondef('public.spend_credits(integer,text)'::regprocedure);
  d := pg_temp.r1(d, 'v_bought := least(coalesce(v_row.bought_credits,0), p_secs);',
    'v_bought := least(p_secs, greatest(0, coalesce(v_row.bought_credits,0) - (coalesce(v_row.credits_remaining,0) - p_secs)));   -- 23/10 : plan d''abord, achetés ensuite');
  d := pg_temp.r1(d, 'bought_credits    = greatest(0, coalesce(bought_credits,0) - p_secs)',
    'bought_credits    = greatest(0, coalesce(bought_credits,0) - v_bought)');
  execute d;

  -- mcp_spend_credits(p_user, p_secs) : débit du MCP (Claude)
  d := pg_get_functiondef('public.mcp_spend_credits(uuid,integer)'::regprocedure);
  d := pg_temp.r1(d, 'v_b := least(greatest(coalesce(v_row.bought_credits,0), 0), p_secs);',
    'v_b := least(p_secs, greatest(0, coalesce(v_row.bought_credits,0) - (coalesce(v_row.credits_remaining,0) - p_secs)));');
  d := pg_temp.r1(d, '-- achetés d''abord, puis le plan', '-- 23/10 (Axel) : plan d''abord, achetés ensuite');
  d := pg_temp.r1(d, 'bought_credits    = greatest(0, coalesce(bought_credits,0) - p_secs)',
    'bought_credits    = greatest(0, coalesce(bought_credits,0) - v_b)');
  execute d;

  -- reconcile_fal_job / reconcile_hedra_job_tarif : complément débité après coup (coût réel > réservé)
  d := pg_get_functiondef('public.reconcile_fal_job(uuid,text,integer,numeric,boolean)'::regprocedure);
  d := pg_temp.r1(d, 'bought_credits    = greatest(0, coalesce(bought_credits, 0) - v_charged)   -- achetés d''abord (spend_credits)',
    'bought_credits    = greatest(0, coalesce(bought_credits, 0) - ' || plan_dabord_fal || ')   -- 23/10 : plan d''abord, achetés ensuite (spend_credits)');
  d := pg_temp.r1(d, 'least(greatest(0, coalesce(v_bought, 0)), v_charged)', plan_dabord_fal);
  execute d;

  d := pg_get_functiondef('public.reconcile_hedra_job_tarif(uuid,text,integer,boolean)'::regprocedure);
  d := pg_temp.r1(d, 'bought_credits    = greatest(0, coalesce(bought_credits, 0) - v_charged)   -- achetés d''abord (spend_credits)',
    'bought_credits    = greatest(0, coalesce(bought_credits, 0) - ' || plan_dabord_fal || ')   -- 23/10 : plan d''abord, achetés ensuite (spend_credits)');
  d := pg_temp.r1(d, 'least(greatest(0, coalesce(v_bought, 0)), v_charged)', plan_dabord_fal);
  execute d;

  -- reconcile_hedra_job (ancienne version, sans bought_part) : même ordre
  d := pg_get_functiondef('public.reconcile_hedra_job(uuid,text,integer)'::regprocedure);
  d := pg_temp.r1(d, 'bought_credits    = greatest(0, coalesce(bought_credits, 0) - v_charged)',
    'bought_credits    = greatest(0, coalesce(bought_credits, 0) - ' || plan_dabord_fal || ')   -- 23/10 : plan d''abord');
  execute d;
end $mig$;
