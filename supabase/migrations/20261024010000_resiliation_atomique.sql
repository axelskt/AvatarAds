-- 24/10/2026 — audit du 23/10, zone « crédits et résiliation » (constats 1, 6, 13, 35 ; 2, 7, 8 ; 33).
-- Un crédit est de l'argent : la résiliation ne calcule plus AUCUN solde dans la fonction Edge.
--
-- 1) cancel_remove_plan_credits (service_role seulement) : retrait des crédits DU PLAN en UNE écriture, sous verrou de la
--    ligne, seulement si la résiliation n'est pas déjà programmée ; kept / removed lus sur la ligne écrite (RETURNING).
--    Avant : whop-cancel lisait le solde, appelait Whop (plusieurs centaines de ms), puis réécrivait en valeur ABSOLUE le
--    solde lu avant l'appel. Une dépense passée pendant l'appel était effacée puis remboursée par refund_credits : crédits
--    achetés dupliqués (270 dont 120 achetés → 390 dont 240), et rejouable avec whop-uncancel.
-- 2) Remboursement d'un débit fait AVANT une résiliation : seule sa part achetée revient (les crédits du plan ont été
--    retirés au clic). Sans ça, « débiter tout le solde, résilier, se rembourser » gardait les crédits du plan.
--    Date de référence : profiles.cancel_requested_at, posée sous le verrou et JAMAIS remise à null (whop-uncancel n'y
--    touche pas) : annuler puis réactiver ne rouvre rien. Seule la ligne qui crédite le profil change, dans les 7 fonctions
--    qui rendent des crédits ; le reste est repris tel quel depuis la base (pg_get_functiondef, comme 20261023150000).
-- 2b) MCP remboursé en plusieurs fois (relecture du 24/10) : la part plan d'un débit antérieur à la résiliation est close
--     dans mcp_debits.plan_perdu, jamais rendue. Le 1er correctif réécrivait le montant AVANT de le journaliser : la part
--     plan restait « à rendre », et un 2e remboursement du même job (partiel puis échec) ne rendait plus les crédits ACHETÉS
--     (0 au lieu de 40 sur un débit de 100 dont 40 achetés, remboursé 50 + 50). refunded_amt reste ce qui est revenu.
-- 3) Rendu prioritaire : l'abonnement prioritaire dont l'app a programmé la fin est mémorisé (prio_cancel_member_id),
--    pour que whop-uncancel le réactive avec le plan — et lui seul (pas un prioritaire résilié chez Whop par le client).
-- 3b) Départ signalé UNE fois par résiliation (relecture du 24/10) : le webhook Whop de cette même résiliation
--    (whop_webhook_resiliation, 20261024020000) peut poser le drapeau AVANT la RPC. « already » renvoie alors le solde relu
--    et notify = vrai si personne n'a encore enregistré ce départ (profiles.cancel_notified_at), décidé sous le verrou : le
--    retour du client et l'e-mail à Axel ne sont plus perdus, et un double clic ne les envoie toujours qu'une fois.
-- 4) Historique : ce retrait s'affichait « Renouvellement Pro (crédits du mois) » en négatif (credit_hist_event) ; il
--    s'affiche « Résiliation : crédits du plan retirés », et « renouvellement » ne classe plus que des hausses.
--
-- Les colonnes ajoutées à profiles sont protégées d'office : profiles_guard n'autorise au client que first_name / phone /
-- affiliate_payment. mcp_debits : service_role seulement (aucune policy).

create or replace function pg_temp.r1(d text, o text, n text) returns text language plpgsql as $f$
declare c int := (length(d) - length(replace(d, o, ''))) / greatest(length(o), 1);
begin
  if c <> 1 then raise exception 'remplacement introuvable ou ambigu (% occurrences) : %', c, left(o, 80); end if;
  return replace(d, o, n);
end $f$;

-- 1) Colonnes ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists cancel_requested_at timestamptz;   -- dernière résiliation faite dans l'app (jamais remise à null)
alter table public.profiles add column if not exists prio_cancel_member_id text;        -- prioritaire (mem_…) dont l'app a programmé la fin
alter table public.profiles add column if not exists cancel_notified_at timestamptz;    -- résiliation (cancel_requested_at) dont le départ est enregistré
alter table public.mcp_debits add column if not exists plan_perdu integer not null default 0;   -- part plan close sans être rendue (résiliation)

-- 2) Résiliation : retrait des crédits du plan ──────────────────────────────────────────────────────────────────────
-- Appelée par whop-cancel APRÈS l'accord de Whop. p_prio_member : l'abonnement prioritaire résilié en même temps (ou null).
-- notify : à cette demande d'enregistrer le départ (retour du client, e-mail à Axel) — vrai une seule fois par résiliation.
create or replace function public.cancel_remove_plan_credits(p_user uuid, p_prio_member text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_before integer; v_kept integer; v_deja boolean; v_at timestamptz; v_signale timestamptz;
  v_prio text := nullif(p_prio_member, '');
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'bad_args'); end if;
  -- Verrou de la ligne d'abord : spend_credits, les remboursements et le webhook passent entièrement avant ou après.
  select coalesce(credits_remaining, 0), coalesce(whop_cancel_at_period_end, false), cancel_requested_at, cancel_notified_at
    into v_before, v_deja, v_at, v_signale
    from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_profile'); end if;

  if v_deja then
    -- Déjà résiliée : par une autre demande de l'app (double clic) ou par le webhook Whop de cette résiliation, arrivé
    -- avant. Rien n'est retiré une 2e fois. Le départ reste à enregistrer si personne ne l'a fait pour CETTE résiliation.
    v_signale := case when v_at is not null and v_signale is distinct from v_at then v_at end;
    if v_prio is not null or v_signale is not null then
      update public.profiles
         set prio_cancel_member_id = coalesce(v_prio, prio_cancel_member_id),
             cancel_notified_at    = coalesce(v_signale, cancel_notified_at)
       where id = p_user;
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already', 'kept', v_before, 'notify', v_signale is not null);
  end if;

  -- Crédits du plan retirés, crédits achetés gardés (bornés au solde : ce qui est dépensé est dépensé). Les deux
  -- expressions lisent la ligne verrouillée, jamais une valeur lue avant un appel réseau.
  v_at := clock_timestamp();   -- prise APRÈS le verrou : tout débit déjà passé lui est antérieur
  update public.profiles
     set credits_remaining         = least(greatest(coalesce(bought_credits, 0), 0), coalesce(credits_remaining, 0)),
         bought_credits            = greatest(0, least(coalesce(bought_credits, 0), coalesce(credits_remaining, 0))),
         whop_cancel_at_period_end = true,
         cancel_requested_at       = v_at,
         cancel_notified_at        = v_at,   -- départ enregistré par CETTE demande
         prio_cancel_member_id     = coalesce(v_prio, prio_cancel_member_id)
   where id = p_user
   returning credits_remaining into v_kept;
  return jsonb_build_object('ok', true, 'kept', v_kept, 'removed', greatest(0, v_before - v_kept), 'notify', true);
end $$;
revoke all on function public.cancel_remove_plan_credits(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_remove_plan_credits(uuid, text) to service_role;

-- 3) Remboursements : part achetée seulement pour un débit antérieur à une résiliation ─────────────────────────────
-- Vrai si une résiliation a été faite dans l'app APRÈS ce débit. Verrouille la ligne du profil AVANT de répondre : une
-- résiliation concurrente passe entièrement avant (le remboursement est réduit) ou après (elle retire ce qui est rendu).
-- Appelée seulement depuis les fonctions SECURITY DEFINER ci-dessous : aucun droit pour le client.
create or replace function public.plan_credits_removed_since(p_user uuid, p_at timestamptz) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  select cancel_requested_at into v_at from public.profiles where id = p_user for update;
  return v_at is not null and p_at is not null and p_at <= v_at;   -- même instant : traité comme antérieur (sans effet après : plus rien du plan)
end $$;
revoke all on function public.plan_credits_removed_since(uuid, timestamptz) from public, anon, authenticated;

do $mig$
declare d text;
  c     constant text := '   -- 24/10 : débit antérieur à une résiliation → seule sa part achetée revient';
  vb_op constant text := 'v_bought := least(coalesce(v_op.bought_part, 0), floor(coalesce(v_op.bought_part, 0)::numeric * v_res / greatest(v_op.amount, 1))::int);';
  vb_v  constant text := 'v_bought := least(coalesce(v.bought_part, 0), floor(coalesce(v.bought_part, 0)::numeric * v_res / greatest(v.amount, 1))::int);';
  maj   constant text := 'update public.credit_ops set refunded_at = now(), reserved_remaining = 0';
  borne constant text := 'v_res := case when public.plan_credits_removed_since(p_user, v_op.created_at) then least(v_op.amount, coalesce(v_op.bought_part, 0)) else v_op.amount end;';
begin
  -- refund_credits(op) : remboursement demandé par l'app (authenticated) — le chemin du constat 1
  d := pg_get_functiondef('public.refund_credits(uuid)'::regprocedure);
  d := pg_temp.r1(d, vb_op, vb_op || chr(10)
    || '  if public.plan_credits_removed_since(auth.uid(), v_op.created_at) then v_res := v_bought; end if;' || c);
  execute d;

  -- refund_job_open(user, job) : filets des proxys (job resté ouvert)
  d := pg_get_functiondef('public.refund_job_open(uuid,text)'::regprocedure);
  d := pg_temp.r1(d, vb_v, vb_v || chr(10)
    || '  if public.plan_credits_removed_since(p_user, v.created_at) then v_res := v_bought; end if;' || c);
  execute d;

  -- kie_job_bill(user, task, 'refund') : remboursement d'un job kie déjà relâché
  d := pg_get_functiondef('public.kie_job_bill(uuid,text,text)'::regprocedure);
  d := pg_temp.r1(d, vb_op, vb_op || chr(10)
    || '      if public.plan_credits_removed_since(p_user, v_op.created_at) then v_res := v_bought; end if;' || c);
  execute d;

  -- refund_op_terminal / refund_by_job_terminal : échec définitif chez le fournisseur (rendaient toujours v_op.amount)
  d := pg_get_functiondef('public.refund_op_terminal(uuid,uuid,integer)'::regprocedure);
  d := pg_temp.r1(d, maj, borne || c || chr(10) || '  ' || maj);
  d := pg_temp.r1(d, '+ v_op.amount,', '+ v_res,');
  d := pg_temp.r1(d, '''refunded'', v_op.amount)', '''refunded'', v_res)');
  execute d;

  d := pg_get_functiondef('public.refund_by_job_terminal(uuid,text)'::regprocedure);
  d := pg_temp.r1(d, maj, borne || c || chr(10) || '  ' || maj);
  d := pg_temp.r1(d, '+ v_op.amount,', '+ v_res,');
  d := pg_temp.r1(d, '''refunded'', v_op.amount)', '''refunded'', v_res)');
  execute d;

  -- MCP (Claude) : mêmes règles sur mcp_debits. Un job peut être remboursé en PLUSIEURS fois (mcp_job_partial_refund
  -- puis mcp_job_fail_refund) : la part plan de ce remboursement est close dans plan_perdu (jamais rendue), et la part
  -- plan encore « à rendre » (v_plan) la déduit, pour que le remboursement suivant rende bien les crédits achetés.
  -- Le montant rendu devient la part achetée : refunded_amt reste égal à ce qui est réellement revenu (historique).
  d := pg_get_functiondef('public.mcp_credit_back_for_job(uuid,uuid,integer)'::regprocedure);
  d := pg_temp.r1(d, 'v_plan := greatest(0, (v_d.amount - v_d.bought) - (v_d.refunded_amt - v_d.refunded_bought));',
    'v_plan := greatest(0, (v_d.amount - v_d.bought) - (v_d.refunded_amt - v_d.refunded_bought) - v_d.plan_perdu);');
  d := pg_temp.r1(d, 'v_rb := least(greatest(v_d.bought - v_d.refunded_bought, 0), greatest(0, p_amt - v_plan));',
    'v_rb := least(greatest(v_d.bought - v_d.refunded_bought, 0), greatest(0, p_amt - v_plan));' || chr(10)
    || '    if public.plan_credits_removed_since(p_user, v_d.created_at) then' || c || chr(10)
    || '      update public.mcp_debits set plan_perdu = plan_perdu + (p_amt - v_rb) where id = v_d.id;   -- part plan close, jamais rendue' || chr(10)
    || '      p_amt := v_rb;' || chr(10)
    || '    end if;');
  execute d;

  d := pg_get_functiondef('public.mcp_refund_credits(uuid,integer)'::regprocedure);
  d := pg_temp.r1(d, 'v_rb := least(v_d.bought, p_secs);', 'v_rb := least(v_d.bought, p_secs);' || chr(10)
    || '    if public.plan_credits_removed_since(p_user, v_d.created_at) then p_secs := v_rb; end if;' || c);
  execute d;

  -- 4) Historique : libellé de la résiliation, « renouvellement » réservé aux hausses
  d := pg_get_functiondef('public.credit_hist_event()'::regprocedure);
  d := pg_temp.r1(d, 'elsif coalesce(new.retention_bonus_used, false) and not coalesce(old.retention_bonus_used, false) then',
    'elsif v_delta < 0 and coalesce(new.whop_cancel_at_period_end, false) and not coalesce(old.whop_cancel_at_period_end, false) then' || chr(10)
    || '      v_kind := ''resiliation''; v_label := ''Résiliation : crédits du plan retirés'';   -- 24/10 (était classé « renouvellement »)' || chr(10)
    || '    elsif coalesce(new.retention_bonus_used, false) and not coalesce(old.retention_bonus_used, false) then');
  d := pg_temp.r1(d, 'elsif p_new <> ''free'' and new.credits_total is not distinct from old.credits_total and coalesce(new.credits_total, 0) > 0 then',
    'elsif v_delta > 0 and p_new <> ''free'' and new.credits_total is not distinct from old.credits_total and coalesce(new.credits_total, 0) > 0 then');
  execute d;
end $mig$;

comment on column public.credit_events.kind is
  'abonnement | changement | renouvellement | pack | cadeau | fin | retrait | resiliation | achat | ajustement';

-- 5) Droits : CREATE OR REPLACE garde ceux d'avant ; on vérifie quand même (un EXECUTE au client annulerait tout) ──
do $droits$
declare f text;
begin
  foreach f in array array['public.cancel_remove_plan_credits(uuid,text)', 'public.plan_credits_removed_since(uuid,timestamptz)',
    'public.refund_op_terminal(uuid,uuid,integer)', 'public.refund_by_job_terminal(uuid,text)', 'public.refund_job_open(uuid,text)',
    'public.kie_job_bill(uuid,text,text)', 'public.mcp_credit_back_for_job(uuid,uuid,integer)', 'public.mcp_refund_credits(uuid,integer)',
    'public.credit_hist_event()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'droits : % est exécutable par le client', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.refund_credits(uuid)', 'EXECUTE') then
    raise exception 'droits : refund_credits exécutable par anon';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_remove_plan_credits(uuid,text)', 'EXECUTE') then
    raise exception 'droits : cancel_remove_plan_credits fermée à service_role';
  end if;
end $droits$;
