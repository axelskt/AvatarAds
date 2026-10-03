-- Audit sécurité du 02/10 — P2 « fal-reconcile » (va avec supabase/functions/fal-proxy, reconcile-fal-orphans et les
-- helpers « fal-reconcile » de _shared/guard.ts du même jour). Idempotente : create table / index if not exists, contraintes
-- dans la table, create or replace ; table et fonctions NOUVELLES fermées à public / anon / authenticated, service_role seul.
--
-- Problème : en P1, fal-proxy facture Motion Control (Kling 2.6 / 3.0) et l'édition Omni à la durée MESURÉE de la vidéo
-- d'ENTRÉE (copie fal-in/, _shared/mp4-duree.ts). La revue a montré que les métadonnées d'un MP4 fourni par le client ne
-- sont pas une base de facturation fiable : des fichiers forgés (ctts, sidx sans tfdt, elst neutralisé…) paraissent plus
-- courts à notre lecture qu'au décodeur de fal. Le cas simple (payer seulement le plancher) est fermé, pas le reste.
--
-- Correctif : comme reconcile_hedra_job (20260907000000) pour Hedra, l'ÉCART sur la durée de la vidéo PRODUITE par fal
-- (fichier de l'encodeur du fournisseur = source fiable) est débité à la livraison.
--   1) fal_job_bills — UNE ligne par job fal facturé à la seconde, écrite par fal-proxy à la soumission (fal_job_bill_open) :
--      tarif du JOB (crédits / s et durée max du modèle : Motion 2.6 standard 2, 2.6 pro 4, 3.0 6, 30 s ; Omni édition
--      720p 3, 1080p 4, 10 s ; upscale Topaz 1, 60 s), op qui l'a financé, ce qu'il a payé, URL de suivi fal. Le tarif
--      n'est jamais déduit du chemin de suivi que fournit le client (un job 3.0 peut être relu par un chemin 2.6).
--      Relecture adverse (02/10) : la 1re version posait le tarif sur l'op LIÉE au job (credit_ops.provider_job). Or
--      bind_reservation_job n'écrase jamais une liaison : un détourage fal (birefnet / rembg, auxiliaire) soumis d'abord sur
--      la même op — parcours « Glisse un fond » de Motion, ou exprès — gardait la liaison, le job Kling n'était lié à rien
--      et échappait à la réconciliation (30 s de Kling livrés pour 5 crédits). La facture vit donc dans sa propre table,
--      clé = le job, quelle que soit la liaison ; les liaisons et leurs règles (release / settle / refund) sont inchangées.
--   2) reconcile_fal_job — à la lecture du résultat (fal-proxy) ou à la récupération par le filet (reconcile-fal-orphans),
--      le serveur mesure la vidéo produite et calcule le coût réel avec les MÊMES tarif et arrondi que la réserve d'entrée
--      (secondesFacturees : seconde supérieure, 1,25 s de tolérance en faveur du client, borné à la durée max). Couverture
--      = ce que le job a PAYÉ, noté à la soumission : tirage du job + étapes annexes déjà tirées sur l'op, plafonnées à 6
--      (ANNEXES_MAX_CR de P1 : fond effacé 3 + détourages 3 de « Glisse un fond » ; le prix Motion de l'app les comprend)
--      — jamais le montant entier de l'op, sinon des auxiliaires à 1 crédit (matting ben…) tirés d'abord sur une grosse op
--      couvriraient AUSSI le Kling. Tirage nul (hoquet DB laissé passer) → repli : montant de l'op moins le coût réel des
--      autres jobs à la seconde déjà réglés dessus (un client honnête ne paie jamais deux fois). Op remboursée ou
--      introuvable → 0. Écart = coût réel − couverture, débité UNE fois par job (facture verrouillée, state), plafonné au
--      solde (jamais négatif), journalisé dans credit_ops (reason 'fal-reconcile', réserve 0 : refund_credits le refuse),
--      puis job réglé comme settle_by_job. p_real_cost NULL = sortie illisible : facture close, règlement simple, rien débité.
--      Owner / developer exemptés (comme spend_credits / requirePlan) ; p_enforce = false → mode ombre (secret
--      FAL_RECONCILE=0 côté edge) : écart calculé et renvoyé, job réglé sans charge.
--      Jamais de remboursement ici : une vidéo produite plus courte laisse le minimum d'entrée de P1.
--   3) list_open_fal_bills / fal_job_bill_close — filet : factures encore ouvertes d'un job dont le client est parti et que
--      list_open_jobs ne reprend pas (job non lié, op déjà réglée) ; vidéo livrée → Bibliothèque + réconciliation ; échec
--      confirmé par fal → facture close sans charge (aucun remboursement ici, comme avant pour ces jobs).
--
-- Déploiement : migration AVANT les fonctions de préférence. Dans l'autre ordre, rien ne casse : sans table, l'ouverture de
-- facture échoue (rien posé) et la lecture renvoie une erreur → règlement simple settle_by_job (comportement actuel) ; sans
-- fonctions edge, table et RPC dorment. Aucune fonction existante modifiée.

-- 1) Factures des jobs fal à la seconde (service_role seul ; RLS active sans policy : aucun accès client)
create table if not exists public.fal_job_bills (
  job         text primary key check (job ~ '^fal:[A-Za-z0-9._-]{1,200}$'),
  user_id     uuid not null references auth.users(id) on delete cascade,   -- suppression de compte : comme credit_ops
  op_id       uuid not null,                                               -- op (credit_ops) qui a financé le job
  per_sec     smallint not null check (per_sec between 1 and 20),
  max_sec     smallint not null check (max_sec between 1 and 60),
  paid        integer check (paid is null or paid between 1 and 3600),        -- tirage du job + annexes ≤ 6 ; NULL = inconnu
  path        text check (path is null or (length(path) <= 400 and path ~ '^https://queue\.fal\.run/[A-Za-z0-9._/-]+$')),
  state       text check (state is null or state in ('settled', 'failed')),   -- NULL = job ouvert
  real_cost   integer,
  charged     integer,
  out_sec     numeric,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists fal_job_bills_op_idx   on public.fal_job_bills (op_id);
create index if not exists fal_job_bills_open_idx on public.fal_job_bills (created_at) where state is null;
alter table public.fal_job_bills enable row level security;
-- droits par défaut du schéma : toute nouvelle table naissait ouverte à anon / authenticated (relevé prod 03/10)
revoke all on table public.fal_job_bills from public, anon, authenticated;
grant select, insert, update, delete on table public.fal_job_bills to service_role;

-- 2) fal_job_bill_open : facture du job, une seule fois, sur une op de p_user (liée au job ou non). false = rien posé.
--    p_paid = ce que le job a payé (tirage + annexes ≤ 6), borné au montant de l'op ; NULL ou ≤ 0 = inconnu (repli).
create or replace function public.fal_job_bill_open(p_user uuid, p_op uuid, p_job text, p_per_sec integer, p_max_sec integer, p_path text default null, p_paid integer default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false; v_amount integer;
begin
  if p_user is null or p_op is null or p_job is null or p_job !~ '^fal:[A-Za-z0-9._-]{1,200}$' then return false; end if;
  if p_per_sec is null or p_per_sec < 1 or p_per_sec > 20 or p_max_sec is null or p_max_sec < 1 or p_max_sec > 60 then return false; end if;
  select amount into v_amount from public.credit_ops where id = p_op and user_id = p_user;
  if not found then return false; end if;
  insert into public.fal_job_bills (job, user_id, op_id, per_sec, max_sec, paid, path)
  values (p_job, p_user, p_op, p_per_sec, p_max_sec,
          case when p_paid > 0 and coalesce(v_amount, 0) > 0 then least(p_paid, v_amount) end,
          case when length(p_path) <= 400 and p_path ~ '^https://queue\.fal\.run/[A-Za-z0-9._/-]+$' then p_path end)
  on conflict (job) do nothing
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- 3) reconcile_fal_job : écart sur la durée de la vidéo PRODUITE, débité une fois, plafonné au solde, puis job réglé.
create or replace function public.reconcile_fal_job(p_user uuid, p_job text, p_real_cost integer, p_out_sec numeric default null, p_enforce boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.fal_job_bills%rowtype; v_amount integer; v_refunded boolean; v_prev integer := 0; v_cover integer := 0;
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
      select amount, refunded_at is not null into v_amount, v_refunded
        from public.credit_ops where id = b.op_id and user_id = p_user for update;
      if found and not v_refunded then
        if b.paid is not null then
          v_cover := least(b.paid, greatest(0, coalesce(v_amount, 0)));
        else   -- tirage inconnu : l'op, moins les autres jobs à la seconde déjà réglés dessus (elle ne paie qu'une fois)
          select coalesce(sum(real_cost), 0) into v_prev from public.fal_job_bills
           where op_id = b.op_id and job <> b.job and state = 'settled' and real_cost is not null;
          v_cover := greatest(0, coalesce(v_amount, 0) - v_prev);
        end if;
      end if;
      v_short := greatest(0, v_real - v_cover);
    end if;
    if v_short > 0 then
      select credits_remaining, bought_credits, lower(coalesce(plan, '')), coalesce(is_owner, false)
        into v_bal, v_bought, v_plan, v_owner
        from public.profiles where id = p_user for update;
      v_exempt := coalesce(v_plan = 'developer' or v_owner, false);
      if coalesce(p_enforce, false) and not v_exempt then
        v_charged := least(v_short, greatest(0, coalesce(v_bal, 0)));
        if v_charged > 0 then
          update public.profiles
             set credits_remaining = coalesce(credits_remaining, 0) - v_charged,
                 bought_credits    = greatest(0, coalesce(bought_credits, 0) - v_charged)   -- achetés d'abord (spend_credits)
           where id = p_user;
          insert into public.credit_ops (user_id, amount, reason, bought_part, reserved_remaining, settled_at)
            values (p_user, v_charged, 'fal-reconcile', least(greatest(0, coalesce(v_bought, 0)), v_charged), 0, now())
            returning id into v_ledger;
        end if;
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
  return jsonb_build_object('ok', true, 'real_cost', v_real, 'cover', v_cover, 'shortfall', v_short,
                            'charged', v_charged, 'exempt', v_exempt, 'enforce', coalesce(p_enforce, false),
                            'out_sec', p_out_sec, 'measured', p_real_cost is not null, 'ledger', v_ledger);
end $$;

-- 4) Filet : factures ouvertes que list_open_jobs ne reprend pas (job non lié, ou op liée déjà réglée hors Express), dont
--    l'op n'est pas remboursée, avec une URL de suivi fal. Fenêtre [min, max] minutes après la soumission.
create or replace function public.list_open_fal_bills(p_min_age_min integer, p_max_age_min integer, p_limit integer)
returns table(job text, user_id uuid, op_id uuid, path text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select b.job, b.user_id, b.op_id, b.path, b.created_at
    from public.fal_job_bills b
   where b.state is null and b.path is not null
     and b.created_at < now() - (greatest(1, p_min_age_min) || ' minutes')::interval
     and b.created_at > now() - (greatest(2, p_max_age_min) || ' minutes')::interval
     and exists (select 1 from public.credit_ops f where f.id = b.op_id and f.user_id = b.user_id and f.refunded_at is null)
     and not exists (   -- même condition que list_open_jobs : ce job-là est déjà suivi par le filet des ops liées
       select 1 from public.credit_ops o
        where o.provider_job = b.job and o.refunded_at is null and o.amount > 0
          and (o.job_bill_state is null or o.job_bill_state = 'released')
          and (o.settled_at is null or o.reason in ('express-omni', 'express')))
   order by b.created_at asc
   limit greatest(1, least(200, coalesce(p_limit, 50)))
$$;

-- 5) fal_job_bill_close : échec CONFIRMÉ par fal (statut FAILED, résultat 422) → facture close sans charge. false = déjà close.
create or replace function public.fal_job_bill_close(p_user uuid, p_job text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  update public.fal_job_bills set state = 'failed', closed_at = now()
   where job = p_job and user_id = p_user and state is null
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke all on function public.fal_job_bill_open(uuid, uuid, text, integer, integer, text, integer) from public, anon, authenticated;
revoke all on function public.reconcile_fal_job(uuid, text, integer, numeric, boolean)      from public, anon, authenticated;
revoke all on function public.list_open_fal_bills(integer, integer, integer)                 from public, anon, authenticated;
revoke all on function public.fal_job_bill_close(uuid, text)                                 from public, anon, authenticated;
grant execute on function public.fal_job_bill_open(uuid, uuid, text, integer, integer, text, integer) to service_role;
grant execute on function public.reconcile_fal_job(uuid, text, integer, numeric, boolean)    to service_role;
grant execute on function public.list_open_fal_bills(integer, integer, integer)               to service_role;
grant execute on function public.fal_job_bill_close(uuid, text)                               to service_role;
notify pgrst, 'reload schema';
