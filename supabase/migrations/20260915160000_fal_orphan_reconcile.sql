-- Réconciliation serveur des orphelins fal « job lié mort en plein poll » (audit Omni 15/09).
--
-- Résidu restant après le remboursement proxy des échecs de SOUMISSION : un job fal SOUMIS AVEC SUCCÈS (op LIÉE,
-- reserve tirée) dont le client MEURT pendant le polling (minutes), puis qui ÉCHOUE côté fal → personne n'observe
-- le FAILED → l'op reste `reserved_remaining < amount, settled_at null, refunded_at null` = crédits perdus, sans
-- récupération. Un balayage SQL pur NE PEUT PAS le traiter (indistinguable d'un succès dont le settle a raté). Il
-- faut VÉRIFIER LE STATUT auprès de fal → une edge function (reconcile-fal-orphans) le fait, déclenchée par pg_cron.
--
-- Pour interroger fal il faut le CHEMIN DU MODÈLE (status = <modèle>/requests/<id>/status) — on ne stockait que
-- provider_job='fal:'+id. On ajoute donc `provider_path` (posé au bind) + une RPC qui liste les orphelins primaires.

-- 1) Chemin du modèle fal, posé au bind (soumission réussie). Additif, NULL sur les ops existantes.
alter table public.credit_ops add column if not exists provider_path text;

-- 2) bind_reservation_job : + p_path (chemin modèle). DROP de la 4-arg pour éviter l'ambiguïté PostgREST ;
--    après quoi {p_user,p_op,p_job} résout la 5-arg avec défauts → appelants non redéployés inchangés.
drop function if exists public.bind_reservation_job(uuid, uuid, text, integer);
create or replace function public.bind_reservation_job(p_user uuid, p_op uuid, p_job text, p_drawn integer default null, p_path text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  if p_job is null or length(p_job) = 0 or length(p_job) > 300 then return false; end if;
  update public.credit_ops
     set provider_job  = p_job,
         job_drawn     = coalesce(p_drawn, job_drawn),
         provider_path = coalesce(nullif(left(p_path, 400), ''), provider_path)
   where id = p_op and user_id = p_user and provider_job is null and refunded_at is null
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.bind_reservation_job(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.bind_reservation_job(uuid, uuid, text, integer, text) to service_role;

-- 3) list_fal_orphans : ops PRIMAIRES orphelines à vérifier auprès de fal. Fenêtre [min,max] minutes (min > runtime
--    max d'un job pour éviter un job encore en cours ; max < 2 h car refund_by_job_terminal refuse au-delà). Exclut
--    les aux (matting partagé : refund_by_job_terminal les refuserait de toute façon). Service-role only.
create or replace function public.list_fal_orphans(p_min_age_min integer, p_max_age_min integer, p_limit integer)
returns table(id uuid, user_id uuid, provider_job text, provider_path text)
language sql security definer set search_path = public as $$
  select id, user_id, provider_job, provider_path
  from public.credit_ops
  where refunded_at is null and settled_at is null
    and amount > 0
    and provider_job like 'fal:%'
    and provider_path like 'https://queue.fal.run/%'                  -- URL de suivi fal (posée au bind) ; exclut les anciennes ops sans URL
    and coalesce(reserved_remaining, amount) < amount                 -- une soumission a TIRÉ (orphelin réserve-entamée)
    and provider_path !~ '/(ben|birefnet|rembg|remove-background|bria|imageutils)/'   -- exclut les aux partagés
    and created_at < now() - (greatest(1, p_min_age_min) || ' minutes')::interval
    and created_at > now() - (greatest(2, p_max_age_min) || ' minutes')::interval
  order by created_at asc
  limit greatest(1, least(200, coalesce(p_limit, 50)))
$$;
revoke all on function public.list_fal_orphans(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.list_fal_orphans(integer, integer, integer) to service_role;

-- 4) pg_cron (toutes les 30 min) → edge function reconcile-fal-orphans (POST + x-cron-key). cron.schedule met à
--    jour si le nom existe (idempotent). Sur une DB fraîche sans le secret Vault, l'appel obtient un x-cron-key nul
--    → 403 inoffensif (aucune action) jusqu'à ce que le secret existe. Fenêtre [20,110] min : min > runtime max d'un
--    job (~11 min), max < 2 h (gel du ledger) ; un passage /30 min rattrape tout orphelin dans la fenêtre.
select cron.schedule('fal-orphan-reconcile', '*/30 * * * *', $cron$
  select net.http_post(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/reconcile-fal-orphans',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
