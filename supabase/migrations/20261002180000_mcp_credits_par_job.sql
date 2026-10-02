-- Audit MCP du 02/10 (crédits) — débit RATTACHÉ AU JOB, remboursements atomiques et idempotents, purge RGPD des dépôts.
--
-- 1) mcp_debits.job_id + refunded_amt / refunded_bought : un remboursement (total ou partiel) rend les crédits achetés du
--    BON débit (avant : mcp_refund_credits devinait le débit par son montant → bought_credits faussés sur un partiel).
-- 2) mcp_spend_for_job rattache son débit au job (même transaction : le profil est verrouillé, aucun autre débit du compte
--    ne peut s'intercaler ; created_at = now() = début de transaction).
-- 3) mcp_job_partial_refund(job, montant, étiquette) : remboursement PARTIEL une seule fois par étiquette (repli Motion
--    3.0 → 2.6, upscale Topaz raté…), sous verrou du job, seulement s'il tourne encore et n'est pas remboursé.
-- 4) mcp_job_fail_refund(job, raison, op, plafond) : passage en échec + remboursement dans UNE transaction (avant : le job
--    était marqué remboursé puis la RPC de remboursement pouvait échouer sans que personne ne la rejoue).
-- 5) list_media_purge : fichiers déposés dans les cartes Omni / Motion Control (photos de visage, vidéos) et bruts de
--    retouche purgés à 7 jours, comme les autres dépôts.

alter table public.mcp_debits add column if not exists job_id uuid;
alter table public.mcp_debits add column if not exists refunded_amt integer not null default 0;
alter table public.mcp_debits add column if not exists refunded_bought integer not null default 0;
create index if not exists mcp_debits_job_idx on public.mcp_debits (job_id) where job_id is not null;

create or replace function public.mcp_spend_for_job(p_user uuid, p_job uuid, p_cost integer)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_job public.mcp_jobs%rowtype; v_bal integer;
begin
  if p_cost is null or p_cost <= 0 or p_cost > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_job from public.mcp_jobs where id = p_job for update;
  if not found or v_job.user_id is distinct from p_user then raise exception 'no_job'; end if;
  if v_job.status <> 'running' or coalesce(v_job.refunded, false) or coalesce(v_job.credits_cost, 0) <> 0 then
    return -2;
  end if;
  v_bal := public.mcp_spend_credits(p_user, p_cost);
  if v_bal is null or v_bal < 0 then return -1; end if;
  -- le débit que mcp_spend_credits vient d'écrire (profil verrouillé jusqu'à la fin de la transaction)
  update public.mcp_debits set job_id = p_job
   where id = (select id from public.mcp_debits where user_id = p_user and job_id is null and created_at = now() order by id desc limit 1);
  update public.mcp_jobs set credits_cost = p_cost, updated_at = now() where id = p_job;
  return v_bal;
end $function$;

-- Crédite p_amt au compte en rendant les crédits achetés du débit du job (ordre corrigé par 20261002200000). Interne.
create or replace function public.mcp_credit_back_for_job(p_user uuid, p_job uuid, p_amt integer)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_d public.mcp_debits%rowtype; v_rb integer := 0; v_new integer;
begin
  if p_amt is null or p_amt <= 0 or p_amt > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    return coalesce(v_row.credits_remaining, 0);
  end if;
  select * into v_d from public.mcp_debits where job_id = p_job and user_id = p_user order by id desc limit 1 for update;
  if found then
    v_rb := least(greatest(v_d.bought - v_d.refunded_bought, 0), p_amt);
    update public.mcp_debits
       set refunded_amt = refunded_amt + p_amt, refunded_bought = refunded_bought + v_rb,
           refunded = (refunded_amt + p_amt) >= amount
     where id = v_d.id;
  else
    -- job antérieur au rattachement : ancienne heuristique (débit récent du même montant)
    return public.mcp_refund_credits(p_user, p_amt);
  end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) + p_amt,
         bought_credits    = coalesce(bought_credits,0) + v_rb,
         mcp_day_spent     = greatest(0, coalesce(mcp_day_spent,0) - p_amt)
   where id = p_user returning credits_remaining into v_new;
  return v_new;
end $function$;

-- Remboursement PARTIEL idempotent : rend min(p_amt, credits_cost) une seule fois par étiquette, baisse credits_cost
-- d'autant (le filet ne rendra jamais plus que ce qui reste débité). Retour : montant rendu (0 = rien à faire).
create or replace function public.mcp_job_partial_refund(p_job uuid, p_amt integer, p_tag text)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_job public.mcp_jobs%rowtype; v_amt integer; v_parts jsonb;
begin
  if p_amt is null or p_amt <= 0 or p_tag is null or length(p_tag) > 40 then return 0; end if;
  select * into v_job from public.mcp_jobs where id = p_job for update;
  if not found or v_job.status <> 'running' or coalesce(v_job.refunded, false) then return 0; end if;
  v_parts := coalesce(v_job.params -> 'partials', '[]'::jsonb);
  if v_parts ? p_tag then return 0; end if;
  v_amt := least(p_amt, coalesce(v_job.credits_cost, 0));
  if v_amt <= 0 then return 0; end if;
  update public.mcp_jobs
     set credits_cost = credits_cost - v_amt,
         params = jsonb_set(coalesce(params, '{}'::jsonb), '{partials}', v_parts || to_jsonb(p_tag)),
         updated_at = now()
   where id = p_job;
  perform public.mcp_credit_back_for_job(v_job.user_id, p_job, v_amt);
  return v_amt;
end $function$;

-- Échec + remboursement ATOMIQUES. p_only_op : ne clôt que si op_name vaut encore cette valeur (suivi concurrent).
-- p_max : plafond connu de l'appelant (remboursement partiel du Montage IA). Retour : montant rendu, -1 = rien clos.
create or replace function public.mcp_job_fail_refund(p_job uuid, p_reason text, p_only_op text default null, p_max integer default null)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_job public.mcp_jobs%rowtype; v_amt integer;
begin
  select * into v_job from public.mcp_jobs where id = p_job for update;
  if not found or v_job.status <> 'running' or coalesce(v_job.refunded, false) then return -1; end if;
  if p_only_op is not null and v_job.op_name is distinct from p_only_op then return -1; end if;
  v_amt := coalesce(v_job.credits_cost, 0);
  if p_max is not null and p_max > 0 then v_amt := least(v_amt, p_max); end if;
  update public.mcp_jobs set status = 'failed', error = left(coalesce(p_reason, 'échec'), 500), refunded = true, updated_at = now()
   where id = p_job;
  if v_amt > 0 then perform public.mcp_credit_back_for_job(v_job.user_id, p_job, v_amt); end if;
  return v_amt;
end $function$;

revoke all on function public.mcp_spend_for_job(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.mcp_spend_for_job(uuid, uuid, integer) to service_role;
revoke all on function public.mcp_credit_back_for_job(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.mcp_credit_back_for_job(uuid, uuid, integer) to service_role;
revoke all on function public.mcp_job_partial_refund(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.mcp_job_partial_refund(uuid, integer, text) to service_role;
revoke all on function public.mcp_job_fail_refund(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.mcp_job_fail_refund(uuid, text, text, integer) to service_role;

create or replace function public.list_media_purge(p_limit integer default 500)
 returns table(bucket_id text, name text, motif text) language sql security definer set search_path to 'public', 'storage' as $function$
  with illimites as (
    select id::text as uid from public.profiles where coalesce(is_owner, false) or lower(coalesce(plan, '')) = 'developer'
  )
  select * from (
    select o.bucket_id, o.name, 'envoyé > 7 j'::text from storage.objects o
     where o.bucket_id = 'mcp-media' and o.created_at < now() - interval '7 days'
       and o.name ~ '^[0-9a-f-]{36}/((ref|omni)-|mcp-src/)' and split_part(o.name, '/', 1) not in (select uid from illimites)
    union all
    select o.bucket_id, o.name, 'envoyé > 7 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '7 days'
       and o.name ~ '^[0-9a-f-]{36}/(mcp-veo|mcp-src|mcp-retouche)/' and split_part(o.name, '/', 1) not in (select uid from illimites)
    union all
    select o.bucket_id, o.name, 'généré > 30 j' from storage.objects o
     where o.bucket_id = 'mcp-media' and o.created_at < now() - interval '30 days'
       and o.name ~ '^[0-9a-f-]{36}/[0-9]{10,}-[a-z0-9]{3,10}\.(png|jpe?g|webp|mp4|mp3|wav)$'
       and split_part(o.name, '/', 1) not in (select uid from illimites)
  ) t
  limit greatest(1, least(1000, coalesce(p_limit, 500)))
$function$;
revoke all on function public.list_media_purge(integer) from public, anon, authenticated;
grant execute on function public.list_media_purge(integer) to service_role;

-- 6) mcp_refund_credits (remboursements SANS job : nettoyage audio…) ne pioche plus dans un débit rattaché à un job.
create or replace function public.mcp_refund_credits(p_user uuid, p_secs integer)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_new integer; v_d public.mcp_debits%rowtype; v_rb integer := 0;
begin
  if p_secs is null or p_secs <= 0 or p_secs > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    return coalesce(v_row.credits_remaining, 0);
  end if;
  select * into v_d from public.mcp_debits
   where user_id = p_user and not refunded and job_id is null and amount >= p_secs and created_at > now() - interval '2 days'
   order by (amount = p_secs) desc, created_at desc limit 1 for update skip locked;
  if found then
    update public.mcp_debits set refunded = true where id = v_d.id;
    v_rb := least(v_d.bought, p_secs);
  end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) + p_secs,
         bought_credits    = coalesce(bought_credits,0) + v_rb,
         mcp_day_spent     = greatest(0, coalesce(mcp_day_spent,0) - p_secs)
   where id = p_user returning credits_remaining into v_new;
  return v_new;
end; $function$;
revoke all on function public.mcp_refund_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.mcp_refund_credits(uuid, integer) to service_role;
