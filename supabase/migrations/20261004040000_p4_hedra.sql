-- Audit 04/10 — chantier « hedra » (GEN-2 côté serveur, contrat K1 ; GEN-3). Va avec supabase/functions/hedra-proxy du
-- même jour. Idempotente : create table / index if not exists, create or replace ; table et fonctions NOUVELLES fermées à
-- public / anon / authenticated, service_role seul (droits par défaut fermés depuis P2). Aucune fonction existante modifiée :
-- reconcile_hedra_job (20260907000000) reste le repli des jobs soumis AVANT le déploiement (aucune facture).
--
-- Problème (GEN-2) : le Générateur débitait DEUX ops en 1080p (avatar 2 cr/s, puis 1080p 0,5 cr/s) et x-aa-op portait la
-- dernière (le 1080p). hedra-proxy tirait et liait cette op seule ; reconcile_hedra_job comparait 2 cr/s × durée rendue à
-- ses 0,5 cr/s → ~1,5 cr/s rechargés en « hedra-reconcile » alors que l'op avatar avait déjà payé (relevé prod 04/10 :
-- 6 lignes du 09 au 16/09, 1 compte, 125 crédits). GEN-3 : la résolution n'était pas facturée côté serveur (1080p au prix
-- du 720p en forgeant la requête).
--
-- Correctif (contrat K1) : l'app débite UNE op (avatar + 1080p) envoyée en x-aa-op ; le serveur facture le job au tarif
-- de la résolution DEMANDÉE, lue dans le corps qu'il reconstruit lui-même (hedra-proxy) — jamais déduite du libellé seul.
--   1) hedra_job_bills — UNE ligne par job Hedra d'un client, écrite à la soumission (hedra_job_bill_open) : op qui l'a
--      financé, tarif (20 = 2 cr/s, 25 = 2,5 cr/s), ce que le job a tiré. Clé = le job, quelle que soit la liaison
--      (bind_reservation_job n'écrase jamais une liaison : un job soumis sur une op déjà liée restait sans réconciliation).
--      Tarif : 2,5 cr/s si 1080p demandé, SAUF op d'une scène du Montage IA (libellé « scène avatar … ») dont le prix
--      (2 cr/s partout, 1080p compris — barème) est calculé pour cette réconciliation. Un client qui imite ce libellé obtient
--      le prix du Montage IA (2 cr/s, coût fournisseur 1080p couvert), jamais moins.
--      Transition (ancienne app en cache, 2 ops) : l'op tirée est l'op « 1080p (… s) » seule ; son op sœur « avatar »
--      (même compte, débitée dans les 2 min avant, intacte) est notée sur la facture.
--   2) reconcile_hedra_job_tarif — à la lecture du résultat (durée rendue, marge de fin retirée par hedra-proxy) : coût
--      réel = ⌈secondes × tarif⌉ (= l'arrondi du débit de l'app : 2 s + ⌈0,5 s⌉) ; couverture = ce que le job a tiré (repli :
--      montant de l'op moins les autres jobs déjà réglés dessus), plus l'op sœur de l'ancienne app si elle est ENCORE
--      intacte — elle est alors consommée (réserve 0, réglée : plus remboursable, sinon « 2 ops puis rembourser l'avatar »
--      ferait payer 0,5 cr/s). Écart chargé à partir de 2 s au tarif du job (4 crédits à 2 cr/s, comme avant ; 5 à 2,5),
--      une seule fois (facture verrouillée), plafonné au solde, journalisé 'hedra-reconcile' (réserve 0, réglée : jamais
--      remboursable). Owner / developer exemptés ; p_enforce = false → mode ombre (HEDRA_RECONCILE≠1) : calculé, réglé,
--      rien chargé. Puis règlement comme settle_by_job (+ job_bill_state 'settled' : un statut « failed » relu ensuite ne
--      rend plus la réserve d'un job livré) et l'op de la facture si elle n'était pas liée à ce job.
--
-- Déploiement : migration AVANT hedra-proxy de préférence. Dans l'autre ordre rien ne casse : sans fonctions, l'ouverture
-- de facture échoue (rien posé) et la réconciliation retombe sur reconcile_hedra_job (comportement actuel).
-- ⚠ Ordre : render-job du contrat K2 (gen-subs sans op) D'ABORD, puis cette migration + hedra-proxy. L'op sœur consommée
-- ici n'est plus tirable : avec l'ancien render-job, le rendu serveur d'une ancienne app en 1080p ne trouverait plus d'op
-- (402 en mode strict) — et il n'a pas de repli navigateur pour la voix native ni les gros fichiers.
-- Charge bornée à 3600 par job (contrainte credit_ops.amount ; au-delà l'insertion échouait et rien n'était réglé).

-- 1) Factures des jobs Hedra des clients (service_role seul ; RLS active sans policy : aucun accès client)
create table if not exists public.hedra_job_bills (
  job          text primary key check (job ~ '^hedra:[A-Za-z0-9._-]{1,200}$'),
  user_id      uuid not null references auth.users(id) on delete cascade,   -- suppression de compte : comme credit_ops
  op_id        uuid not null,                                               -- op (credit_ops) tirée par la soumission
  per_sec_x10  smallint not null check (per_sec_x10 in (20, 25)),           -- 20 = 2 cr/s (720p, Montage IA) ; 25 = 1080p
  hd           boolean not null default false,                              -- 1080p demandé (corps reconstruit par le proxy)
  paid         integer check (paid is null or paid between 1 and 20000),    -- tiré par ce job ; NULL = inconnu (repli)
  sibling_op   uuid,                                                        -- ancienne app : op « avatar » sœur, si trouvée
  sibling_paid integer,                                                     -- montant de l'op sœur consommée au règlement
  state        text check (state is null or state = 'settled'),             -- NULL = job ouvert
  real_cost    integer,
  charged      integer,
  secs         integer,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz
);
create index if not exists hedra_job_bills_op_idx   on public.hedra_job_bills (op_id);
create index if not exists hedra_job_bills_user_idx on public.hedra_job_bills (user_id, created_at desc);
alter table public.hedra_job_bills enable row level security;
revoke all on table public.hedra_job_bills from public, anon, authenticated;
grant select, insert, update, delete on table public.hedra_job_bills to service_role;

-- 2) hedra_job_bill_open : facture du job, une seule fois (on conflict do nothing), sur une op de p_user (liée ou non).
--    p_hd = 1080p demandé ; p_paid = tiré par la soumission (draw_full), borné au montant de l'op ; ≤ 0 / NULL = inconnu.
create or replace function public.hedra_job_bill_open(p_user uuid, p_op uuid, p_job text, p_hd boolean, p_paid integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_op public.credit_ops%rowtype; v_rate smallint := 20; v_sib uuid; v_ok boolean := false;
begin
  if p_user is null or p_op is null or p_job is null or p_job !~ '^hedra:[A-Za-z0-9._-]{1,200}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_args');
  end if;
  select * into v_op from public.credit_ops where id = p_op and user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_op'); end if;
  -- 1080p : 2,5 cr/s, sauf une scène du Montage IA (2 cr/s, 1080p compris dans son prix)
  if coalesce(p_hd, false) and coalesce(v_op.reason, '') not like 'scène avatar %' then v_rate := 25; end if;
  -- Ancienne app (2 ops) : op « 1080p (… s) » seule → son op sœur « avatar », débitée juste avant dans le même flux
  if coalesce(v_op.reason, '') like '1080p (%' then
    select a.id into v_sib from public.credit_ops a
     where a.user_id = p_user and a.id <> p_op and a.reason = 'avatar' and a.amount > 0
       and a.created_at between v_op.created_at - interval '2 minutes' and v_op.created_at
       and a.refunded_at is null and a.settled_at is null and a.provider_job is null
       and coalesce(a.reserved_remaining, a.amount) = a.amount
     order by a.created_at desc limit 1;
  end if;
  insert into public.hedra_job_bills (job, user_id, op_id, per_sec_x10, hd, paid, sibling_op)
  values (p_job, p_user, p_op, v_rate, coalesce(p_hd, false),
          case when p_paid > 0 and v_op.amount > 0 then least(p_paid, v_op.amount) end, v_sib)
  on conflict (job) do nothing
  returning true into v_ok;
  return jsonb_build_object('ok', coalesce(v_ok, false), 'per_sec_x10', v_rate, 'sibling', v_sib is not null);
end $$;

-- 3) reconcile_hedra_job_tarif : écart au tarif du job sur la durée RENDUE (p_secs, marge de fin déjà retirée), une fois.
--    'no_bill' = job sans facture (soumis avant le déploiement) → l'appelant retombe sur reconcile_hedra_job.
create or replace function public.reconcile_hedra_job_tarif(p_user uuid, p_job text, p_secs integer, p_enforce boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.hedra_job_bills%rowtype; v_amount integer; v_refunded boolean; v_prev integer := 0; v_cover integer := 0;
        v_real integer := 0; v_tol integer; v_short integer := 0; v_charged integer := 0; v_sib integer;
        v_bal integer; v_bought integer; v_plan text; v_owner boolean; v_exempt boolean := false; v_ledger uuid;
begin
  if p_user is null or p_job is null or p_job !~ '^hedra:[A-Za-z0-9._-]{1,200}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_args');
  end if;
  select * into b from public.hedra_job_bills where job = p_job and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_bill'); end if;
  if b.state is null then
    v_real := ceil(greatest(0, least(coalesce(p_secs, 0), 3600)) * b.per_sec_x10 / 10.0)::integer;
    select amount, refunded_at is not null into v_amount, v_refunded
      from public.credit_ops where id = b.op_id and user_id = p_user for update;
    if found and not v_refunded then
      if b.paid is not null then
        v_cover := least(b.paid, greatest(0, coalesce(v_amount, 0)));
      else   -- tirage inconnu (hoquet DB laissé passer) : l'op, moins les autres jobs déjà réglés dessus
        select coalesce(sum(real_cost), 0) into v_prev from public.hedra_job_bills
         where op_id = b.op_id and job <> b.job and state = 'settled' and real_cost is not null;
        v_cover := greatest(0, coalesce(v_amount, 0) - v_prev);
      end if;
    end if;
    -- Ancienne app : l'op sœur « avatar » encore intacte a payé la part avatar → comptée et consommée (plus remboursable)
    if b.sibling_op is not null then
      update public.credit_ops
         set reserved_remaining = 0, settled_at = now()
       where id = b.sibling_op and user_id = p_user and refunded_at is null and settled_at is null
         and provider_job is null and amount > 0 and coalesce(reserved_remaining, amount) = amount
      returning amount into v_sib;
      v_cover := v_cover + coalesce(v_sib, 0);
    end if;
    v_tol   := ceil(2 * b.per_sec_x10 / 10.0)::integer;   -- 2 s au tarif du job : 4 à 2 cr/s (comme avant), 5 à 2,5 cr/s
    v_short := greatest(0, v_real - v_cover);
    if v_short >= v_tol then
      select credits_remaining, bought_credits, lower(coalesce(plan, '')), coalesce(is_owner, false)
        into v_bal, v_bought, v_plan, v_owner
        from public.profiles where id = p_user for update;
      v_exempt := coalesce(v_plan = 'developer' or v_owner, false);
      if coalesce(p_enforce, false) and not v_exempt then
        -- jamais négatif ; ≤ 3600 = borne de credit_ops.amount (au-delà, l'insertion échouait et rien n'était réglé)
        v_charged := least(v_short, greatest(0, coalesce(v_bal, 0)), 3600);
        if v_charged > 0 then
          update public.profiles
             set credits_remaining = coalesce(credits_remaining, 0) - v_charged,
                 bought_credits    = greatest(0, coalesce(bought_credits, 0) - v_charged)   -- achetés d'abord (spend_credits)
           where id = p_user;
          insert into public.credit_ops (user_id, amount, reason, bought_part, reserved_remaining, settled_at)
            values (p_user, v_charged, 'hedra-reconcile', least(greatest(0, coalesce(v_bought, 0)), v_charged), 0, now())
            returning id into v_ledger;
        end if;
      end if;
    end if;
    update public.hedra_job_bills
       set state = 'settled', real_cost = v_real, charged = v_charged, secs = p_secs, sibling_paid = v_sib, closed_at = now()
     where job = b.job;
  end if;
  -- Règlement : exactement settle_by_job (op LIÉE à ce job), plus l'op de la facture si la liaison avait échoué.
  update public.credit_ops
     set settled_at = coalesce(settled_at, now()), job_bill_state = coalesce(job_bill_state, 'settled')
   where user_id = p_user and provider_job = p_job and refunded_at is null;
  update public.credit_ops set settled_at = coalesce(settled_at, now())
   where id = b.op_id and user_id = p_user and refunded_at is null and settled_at is null;
  if b.state is not null then
    return jsonb_build_object('ok', true, 'reason', 'already', 'charged', 0);
  end if;
  return jsonb_build_object('ok', true, 'per_sec_x10', b.per_sec_x10, 'secs', p_secs, 'real_cost', v_real,
                            'cover', v_cover, 'sibling', coalesce(v_sib, 0), 'shortfall', v_short, 'tolerance', v_tol,
                            'charged', v_charged, 'exempt', v_exempt, 'enforce', coalesce(p_enforce, false), 'ledger', v_ledger);
end $$;

revoke all on function public.hedra_job_bill_open(uuid, uuid, text, boolean, integer)       from public, anon, authenticated;
revoke all on function public.reconcile_hedra_job_tarif(uuid, text, integer, boolean)       from public, anon, authenticated;
grant execute on function public.hedra_job_bill_open(uuid, uuid, text, boolean, integer)    to service_role;
grant execute on function public.reconcile_hedra_job_tarif(uuid, text, integer, boolean)    to service_role;
notify pgrst, 'reload schema';
