-- 16/10 (Axel : « un seul stock pour tout le monde », ses comptes servis en premier) : le kit de publication garde 7 jours
-- d'avance et se RECHARGE tout seul depuis le stock commun BloxAI (edge function kit-recharge, voir son en-tête).
-- 1) Bail de recharge (factory_kit_lease + kit_recharge_lease) : deux recharges en même temps (séries « N vidéos
--    programmées » rapprochées, cron de la nuit) ne remplissent jamais deux fois les mêmes créneaux. Une seule ligne,
--    3 min au plus, rendue à la fin de chaque recharge (sinon elle expire seule). Service seulement.
-- 2) kit_recharge_now() : lance une recharge (POST vers kit-recharge, clé x-cron-key du coffre Vault 'email_drip_cron_key'
--    = secret CRON_SECRET de l'edge, jamais en clair ici). Pour pg_cron et pour les scripts de l'usine (valider.py,
--    stock.py : « select kit_recharge_now() » via la CLI, rôle postgres). Asynchrone (pg_net) : renvoie l'id de la requête,
--    null si la clé manque (rien n'est appelé). Jamais exécutable par anon / authenticated.
-- 3) pg_cron 'kit-recharge-daily' : tous les jours à 03:30 UTC (05:30 Paris en heure d'été, 04:30 en hiver).
-- 4) 17/10 (revue) — journal des retraits factory_kit_pending : kit-recharge y note chaque vidéo AVANT de la retirer du
--    stock BloxAI (kit_withdraw) et l'efface une fois écrite dans le kit ou rendue au stock. Une ligne qui reste (réponse
--    de BloxAI perdue, fonction coupée, écriture sans réponse) est reprise par la recharge suivante après 10 min : jamais
--    une vidéo bloquée en 'kit' sans post. Service seulement (aucune lecture navigateur).
-- Idempotent (create if not exists / create or replace / cron re-planifié par nom).

create table if not exists public.factory_kit_lease (
  id      smallint    primary key default 1 check (id = 1),
  holder  uuid,
  until   timestamptz not null default '-infinity'
);
alter table public.factory_kit_lease enable row level security;
revoke all on public.factory_kit_lease from public, anon, authenticated;

-- p_seconds > 0 : prend (ou prolonge) le bail s'il est libre, expiré ou déjà à ce détenteur → true ; sinon false.
-- p_seconds <= 0 : rend le bail (seulement son détenteur).
create or replace function public.kit_recharge_lease(p_holder uuid, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare got uuid;
begin
  if p_holder is null then return false; end if;
  if coalesce(p_seconds, 0) <= 0 then
    update public.factory_kit_lease set holder = null, until = '-infinity' where id = 1 and holder = p_holder;
    return true;
  end if;
  insert into public.factory_kit_lease as l (id, holder, until)
  values (1, p_holder, now() + make_interval(secs => least(p_seconds, 600)))
  on conflict (id) do update set holder = excluded.holder, until = excluded.until
    where l.until < now() or l.holder = excluded.holder
  returning l.holder into got;
  return got is not distinct from p_holder;
end $$;
revoke all on function public.kit_recharge_lease(uuid, integer) from public, anon, authenticated;
grant execute on function public.kit_recharge_lease(uuid, integer) to service_role;

create table if not exists public.factory_kit_pending (
  vf  text        primary key check (vf ~ '^VF-[0-9]{4}$'),
  at  timestamptz not null default now()      -- dernière demande de retrait (reprise seulement 10 min après)
);
alter table public.factory_kit_pending enable row level security;
revoke all on public.factory_kit_pending from public, anon, authenticated;
grant select, insert, update, delete on public.factory_kit_pending to service_role;

create or replace function public.kit_recharge_now()
returns bigint language plpgsql security definer set search_path = '' as $$
declare k text; rid bigint;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1;
  if k is null or k = '' then
    raise notice 'kit_recharge_now : clé cron absente du coffre (email_drip_cron_key), rien n''est appelé';
    return null;
  end if;
  select net.http_post(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/kit-recharge',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', k),
    timeout_milliseconds := 120000
  ) into rid;
  return rid;
end $$;
revoke all on function public.kit_recharge_now() from public, anon, authenticated;
grant execute on function public.kit_recharge_now() to service_role;

select cron.unschedule('kit-recharge-daily') where exists (select 1 from cron.job where jobname = 'kit-recharge-daily');
select cron.schedule('kit-recharge-daily', '30 3 * * *', $cron$ select public.kit_recharge_now(); $cron$);
