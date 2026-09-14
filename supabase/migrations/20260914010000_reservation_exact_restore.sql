-- Audit métier offensif 14/09 — Phase 1. Ferme DEUX classes confirmées :
--
--  (CRITICAL) « refund-and-keep » : les libérations RE-REMONTAIENT la réserve à `amount`
--   (release_by_job passait 9999 → least(amount, reserved+9999) = amount ; fal passait falCost),
--   et refund_credits (client) ne refusait plus une op livrée dès que la réserve était à `amount`.
--   → un job async échoué (ou une soumission fal refusée) sur une op qui avait déjà LIVRÉ une étape
--   restaurait TOUT, puis refund_credits rendait l'intégralité = N générations livrées gardées, net 0.
--   Fix : les libérations ne rendent QUE ce que le job a réellement tiré (nouvelle colonne job_drawn,
--   posée au bind). Sans sur-restauration, refund_credits ne peut plus rendre que du VRAI reliquat.
--
--  (HIGH) sous-facturation « 1 crédit = génération chère » : draw_full_reservation drainait
--   n'importe quelle réserve > 0 SANS la comparer au coût → spend_credits(1) finançait une vidéo
--   OmniHuman/Kling complète. Fix : draw_full n'accepte plus une réserve < plancher serveur p_min
--   (le proxy passe le coût plancher du modèle) et RENVOIE le montant drainé (0 = refusé → 402).
--
--  (LOW) déanonymisation : referrer_id_from_code était exécutable par anon/authenticated (GRANT
--   PUBLIC par défaut jamais révoqué) → mapper un ?ref=<10HEX> public vers l'UUID de compte.
--
-- Additif et sûr : job_drawn NULL sur les ops existantes → repli sur l'ancien p_cost (borné à amount) ;
-- p_min a une valeur par défaut 1 (comportement inchangé pour les appelants non modifiés, ex. render-job
-- de guard.ts non redéployés) ; draw/settle/release restent service_role only.

-- 1) Montant réellement tiré par le job asynchrone lié → restauration EXACTE sur échec.
alter table public.credit_ops add column if not exists job_drawn integer;
-- Backfill des ops liées en vol (créées avant cette migration) : ce qui a été tiré jusqu'ici. Restreint aux ops
-- NON réglées (settled_at is null) → sur une op multi-étapes déjà livrée, amount-reserved inclurait la part
-- LIVRÉE : on la laisse retomber sur p_cost (repli transitoire < 2 h) plutôt que sur-attribuer au job lié.
update public.credit_ops
   set job_drawn = greatest(0, coalesce(amount,0) - coalesce(reserved_remaining, amount))
 where provider_job is not null and job_drawn is null and refunded_at is null and settled_at is null;

-- 2) draw_full_reservation : draine SEULEMENT si la réserve couvre le plancher p_min ; RENVOIE le montant
--    drainé (0 = rien → le proxy 402 sous RESERVE_ENFORCE). WHERE inchangé par ailleurs (parité 050000).
--    On DROP l'ancienne signature 2-arg (boolean) : sinon un appel {p_user,p_op} matcherait les DEUX
--    (la 2-arg ET la 3-arg à défaut) = ambiguïté PostgREST. Après le drop, {p_user,p_op} résout la 3-arg
--    avec p_min=1 → les fonctions non encore redéployées (guard.ts ancien) continuent sans coupure.
drop function if exists public.draw_full_reservation(uuid, uuid);
create or replace function public.draw_full_reservation(p_user uuid, p_op uuid, p_min integer default 1)
returns integer language plpgsql security definer set search_path = public as $$
declare v_drawn integer; v_min integer := greatest(1, coalesce(p_min, 1));
begin
  with pre as (
    select id, coalesce(reserved_remaining, amount) as r
      from public.credit_ops
     where id = p_op and user_id = p_user and refunded_at is null
       and created_at > now() - interval '2 hours'
       and coalesce(reserved_remaining, amount) >= v_min
     for update
  )
  update public.credit_ops c
     set reserved_remaining = 0
    from pre
   where c.id = pre.id
   returning pre.r into v_drawn;
  return coalesce(v_drawn, 0);
end $$;

-- 3) bind_reservation_job : mémorise le montant tiré par CE job (p_drawn) en plus du provider_job.
--    Idem : DROP de l'ancienne 3-arg pour éviter l'ambiguïté ; après quoi {p_user,p_op,p_job} résout la
--    4-arg avec p_drawn=NULL → les appelants non redéployés fonctionnent (repli p_cost au release).
drop function if exists public.bind_reservation_job(uuid, uuid, text);
create or replace function public.bind_reservation_job(p_user uuid, p_op uuid, p_job text, p_drawn integer default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  if p_job is null or length(p_job) = 0 or length(p_job) > 300 then return false; end if;
  update public.credit_ops
     set provider_job = p_job,
         job_drawn    = coalesce(p_drawn, job_drawn)
   where id = p_op and user_id = p_user and provider_job is null and refunded_at is null
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- 4) release_by_job : restaure EXACTEMENT ce que le job avait tiré (job_drawn), jamais 9999. Repli sur
--    p_cost (borné à amount) uniquement pour les anciens binds sans job_drawn. Ferme la sur-restauration.
create or replace function public.release_by_job(p_user uuid, p_job text, p_cost integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_row public.credit_ops%rowtype; v_id uuid; v_add integer;
begin
  if p_job is null or length(p_job) = 0 then return null; end if;
  select * into v_row from public.credit_ops
    where user_id = p_user and provider_job = p_job and refunded_at is null
    order by created_at desc limit 1 for update;
  if not found then return null; end if;
  v_add := coalesce(v_row.job_drawn, greatest(1, coalesce(p_cost, 1)));   -- job_drawn = tiré réel ; sinon repli
  update public.credit_ops
     set reserved_remaining = least(amount, coalesce(reserved_remaining, amount) + v_add)
   where id = v_row.id
   returning id into v_id;
  return v_id;
end $$;

grant execute on function public.draw_full_reservation(uuid, uuid, integer) to service_role;
grant execute on function public.bind_reservation_job(uuid, uuid, text, integer) to service_role;
revoke all on function public.draw_full_reservation(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.bind_reservation_job(uuid, uuid, text, integer) from public, anon, authenticated;

-- 5) Déanonymisation : referrer_id_from_code n'est appelée que par whop-webhook (service_role). Fermer anon.
-- La fonction a été créée hors-migration (dashboard) → elle n'existe pas sur une DB fraîche / en CI : on garde
-- ce bloc idempotent (if exists) pour ne PAS faire échouer toute la migration (et donc les correctifs crédits)
-- lors d'un `supabase db reset` / staging. Sur prod la fonction existe → le revoke/grant s'appliquent.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'referrer_id_from_code'
  ) then
    execute 'revoke all on function public.referrer_id_from_code(text) from public, anon, authenticated';
    execute 'grant execute on function public.referrer_id_from_code(text) to service_role';
  end if;
end $$;
