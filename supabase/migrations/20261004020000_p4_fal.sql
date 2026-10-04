-- Audit 04/10 (P4, chantier « fal ») — MC-5 : écart de sortie des vidéos fal à la seconde NON couvert par le solde.
-- Va avec supabase/functions/fal-proxy et reconcile-fal-orphans du même jour. Idempotente : create or replace seulement,
-- droits réaffirmés (revoke public / anon / authenticated, grant service_role). Aucune table, aucune donnée modifiée.
--
-- Problème : reconcile_fal_job (20261003040000) débitait l'écart « coût réel − payé » PLAFONNÉ AU SOLDE, réglait le job et
-- fal-proxy rendait la vidéo. Il suffisait de garer son solde sur une op neuve (spend_credits, ouverte au client) le temps de
-- lire le résultat, puis de rembourser cette op (refund_credits) : l'écart n'était jamais payé.
--
-- Correctif : un écart que le solde ne couvre pas ENTIÈREMENT n'est plus débité du tout ; la facture reste OUVERTE, le job
-- n'est PAS réglé et la réponse porte held = true (avec le manque) — fal-proxy retient alors le résultat (402) et le filet
-- reconcile-fal-orphans ne le dépose pas en Bibliothèque. Dès que le solde couvre l'écart, la lecture suivante (app ou filet)
-- débite l'écart une fois et livre. Owner / developer (exemptés) et mode ombre (p_enforce = false) : jamais retenu.
-- Un client honnête n'a pas d'écart : la réserve d'entrée est le prix de l'app (≥ coût réel, marge en sa faveur).
--   1) fal_job_cover — ce que couvre l'op du job (code inchangé, sorti de reconcile_fal_job pour être partagé) ;
--   2) reconcile_fal_job — même signature, même comportement quand l'écart est couvert ou absent ; held sinon ;
--   3) fal_job_quote — même calcul SANS effet (ni débit, ni verrou, ni règlement) : le filet le consulte AVANT de déposer
--      une vidéo en Bibliothèque (le dépôt précède le règlement, pour qu'un dépôt raté soit retenté).
--
-- Déploiement : fonctions edge fal-proxy et reconcile-fal-orphans AVANT cette migration (une ancienne fal-proxy ignorerait
-- held et rendrait la vidéo d'un job resté ouvert). Dans l'autre sens rien ne casse : sans fal_job_quote le filet garde son
-- comportement actuel, et l'ancien reconcile_fal_job ne renvoie jamais held.

-- 1) Couverture d'un job par son op : ce qu'il a payé (tirage + annexes ≤ 6, noté à la soumission), borné au montant de
--    l'op ; tirage inconnu → l'op moins les autres jobs à la seconde déjà réglés dessus ; op remboursée ou introuvable → 0.
create or replace function public.fal_job_cover(p_user uuid, p_op uuid, p_job text, p_paid integer)
returns integer language sql stable security definer set search_path = public as $$
  select case
    when o.id is null or o.refunded_at is not null then 0
    when p_paid is not null then least(p_paid, greatest(0, coalesce(o.amount, 0)))
    else greatest(0, coalesce(o.amount, 0) - coalesce((
      select sum(f.real_cost)::int from public.fal_job_bills f
       where f.op_id = p_op and f.job <> p_job and f.state = 'settled' and f.real_cost is not null), 0))
  end
  from (select 1) as un
  left join public.credit_ops o on o.id = p_op and o.user_id = p_user
$$;

-- 2) reconcile_fal_job : écart couvert → débité une fois puis job réglé (inchangé) ; NON couvert → held, rien d'écrit.
create or replace function public.reconcile_fal_job(p_user uuid, p_job text, p_real_cost integer, p_out_sec numeric default null, p_enforce boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.fal_job_bills%rowtype; v_cover integer := 0;
        v_real integer; v_short integer := 0; v_charged integer := 0;
        v_bal integer; v_bought integer; v_plan text; v_owner boolean; v_exempt boolean := false; v_ledger uuid;
begin
  if p_user is null or p_job is null or p_job not like 'fal:%' or length(p_job) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'bad_args');
  end if;
  select * into b from public.fal_job_bills where job = p_job and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_bill'); end if;
  if b.state is null then
    if p_real_cost is not null then
      v_real := least(greatest(0, p_real_cost), b.per_sec * b.max_sec);   -- borné au tarif × durée max posés à la soumission
      perform 1 from public.credit_ops where id = b.op_id and user_id = p_user for update;   -- op figée pendant le calcul
      v_cover := public.fal_job_cover(p_user, b.op_id, b.job, b.paid);
      v_short := greatest(0, v_real - v_cover);
    end if;
    if v_short > 0 then
      select credits_remaining, bought_credits, lower(coalesce(plan, '')), coalesce(is_owner, false)
        into v_bal, v_bought, v_plan, v_owner
        from public.profiles where id = p_user for update;
      v_exempt := coalesce(v_plan = 'developer' or v_owner, false);
      if coalesce(p_enforce, false) and not v_exempt then
        -- Audit 04/10 (MC-5) : solde insuffisant → RETENU (ni débit partiel, ni règlement, facture ouverte)
        if coalesce(v_bal, 0) < v_short then
          return jsonb_build_object('ok', true, 'held', true, 'real_cost', v_real, 'cover', v_cover, 'shortfall', v_short,
                                    'missing', v_short - greatest(0, coalesce(v_bal, 0)), 'charged', 0, 'enforce', true,
                                    'out_sec', p_out_sec, 'measured', true);
        end if;
        v_charged := v_short;
        update public.profiles
           set credits_remaining = coalesce(credits_remaining, 0) - v_charged,
               bought_credits    = greatest(0, coalesce(bought_credits, 0) - v_charged)   -- achetés d'abord (spend_credits)
         where id = p_user;
        insert into public.credit_ops (user_id, amount, reason, bought_part, reserved_remaining, settled_at)
          values (p_user, v_charged, 'fal-reconcile', least(greatest(0, coalesce(v_bought, 0)), v_charged), 0, now())
          returning id into v_ledger;
      end if;
    end if;
    update public.fal_job_bills
       set state = 'settled', real_cost = v_real, charged = v_charged, out_sec = p_out_sec, closed_at = now()
     where job = b.job;
  end if;
  -- Règlement du job : exactement settle_by_job (op LIÉE à ce job, s'il y en a une), aussi quand la facture était déjà close.
  update public.credit_ops
     set settled_at = coalesce(settled_at, now()), job_bill_state = coalesce(job_bill_state, 'settled')
   where user_id = p_user and provider_job = p_job and refunded_at is null;
  if b.state is not null then
    return jsonb_build_object('ok', true, 'reason', 'already', 'state', b.state, 'charged', 0);
  end if;
  return jsonb_build_object('ok', true, 'held', false, 'real_cost', v_real, 'cover', v_cover, 'shortfall', v_short,
                            'charged', v_charged, 'exempt', v_exempt, 'enforce', coalesce(p_enforce, false),
                            'out_sec', p_out_sec, 'measured', p_real_cost is not null, 'ledger', v_ledger);
end $$;

-- 3) Devis sans effet : le même calcul que reconcile_fal_job, sans verrou ni écriture. held = la lecture serait retenue.
create or replace function public.fal_job_quote(p_user uuid, p_job text, p_real_cost integer, p_enforce boolean default true)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b public.fal_job_bills%rowtype; v_real integer; v_cover integer; v_short integer;
        v_bal integer; v_plan text; v_owner boolean;
begin
  if p_user is null or p_job is null or p_job not like 'fal:%' or length(p_job) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'bad_args');
  end if;
  select * into b from public.fal_job_bills where job = p_job and user_id = p_user;
  if not found or b.state is not null or p_real_cost is null then
    return jsonb_build_object('ok', true, 'held', false, 'open', found and b.state is null);
  end if;
  v_real := least(greatest(0, p_real_cost), b.per_sec * b.max_sec);
  v_cover := public.fal_job_cover(p_user, b.op_id, b.job, b.paid);
  v_short := greatest(0, v_real - v_cover);
  if v_short = 0 or not coalesce(p_enforce, false) then
    return jsonb_build_object('ok', true, 'held', false, 'open', true, 'shortfall', v_short);
  end if;
  select credits_remaining, lower(coalesce(plan, '')), coalesce(is_owner, false) into v_bal, v_plan, v_owner
    from public.profiles where id = p_user;
  if coalesce(v_plan = 'developer' or v_owner, false) then
    return jsonb_build_object('ok', true, 'held', false, 'open', true, 'shortfall', v_short, 'exempt', true);
  end if;
  return jsonb_build_object('ok', true, 'held', coalesce(v_bal, 0) < v_short, 'open', true, 'shortfall', v_short,
                            'missing', greatest(0, v_short - greatest(0, coalesce(v_bal, 0))));
end $$;

-- Droits : service_role seul (fal-proxy, reconcile-fal-orphans). Privilèges par défaut FERMÉS depuis le P2 : réaffirmés.
revoke all on function public.fal_job_cover(uuid, uuid, text, integer)                    from public, anon, authenticated;
revoke all on function public.reconcile_fal_job(uuid, text, integer, numeric, boolean)    from public, anon, authenticated;
revoke all on function public.fal_job_quote(uuid, text, integer, boolean)                 from public, anon, authenticated;
grant execute on function public.fal_job_cover(uuid, uuid, text, integer)                 to service_role;
grant execute on function public.reconcile_fal_job(uuid, text, integer, numeric, boolean) to service_role;
grant execute on function public.fal_job_quote(uuid, text, integer, boolean)              to service_role;
notify pgrst, 'reload schema';
