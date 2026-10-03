-- Audit 02/10 (P3) : base — journal du relais MCP, rattrapage parrainage, bonus de rétention, portail IA LEBD.
-- Idempotente : create or replace (définitions recopiées du catalogue prod du 03/10, modifiées au minimum),
-- create sequence if not exists, revoke / grant explicites. Un bloc de CONTRÔLE final fait échouer la migration
-- (donc rien n'est appliqué) si un droit légitime a disparu ou si un droit dangereux apparaît.
--
-- 1) mcp_edge_log (relais mcp.avatarads.fr, INSERT anon avec la clé publique, return=minimal) : le trigger laissait
--    passer 60 lignes / 10 s par IP et 400 / 10 s au total, avec extra jusqu'à 2 000 caractères → ~9 Go/jour possibles.
--    Débit réel mesuré en prod (agrégats count seulement, 7 derniers jours, 98 920 lignes, ~14 000/jour, ~1,4 Mo/jour) :
--      par 10 s : p99 7, p99,9 14, pic 41 (deux fois) ; par minute : p99 21, p99,9 53, pic 184 ;
--      par IP (échantillon : clés mcpedgelog:ip:* restées dans rate_events, 63 IP distinctes depuis le 29/09) : pic 18 / 10 s ;
--      champs : path ≤ 120, ua ≤ 120, accept ≤ 80, extra ≤ 82 (le proxy tronque déjà lui-même).
--    Nouveaux plafonds : 40 / 10 s par IP (≈ 2× le pic par IP, = le pic global) et 120 / 10 s au total (≈ 3× le pic).
--    Champs texte bornés à 300 caractères au plus (extra 2 000 → 300 ; path / ua / accept gardent 200 / 200 / 120).
--    ts est forcé à now() : une ligne envoyée avec une date future échappait à la purge pg_cron des 14 jours.
--    Pire cas : ~1 Go/jour au lieu de ~9 Go, purgé à 14 jours. Une ligne au-delà du plafond n'est pas écrite (le
--    proxy reçoit quand même 201 et ne bloque jamais) : seul le diagnostic est concerné, jamais le relais.
-- 2) set_referrer : le rattrapage des filleuls perdus (comptes créés du 14/09 au 25/09, encore gratuits et sans
--    Whop) n'avait pas de date de fin → fermé après le 15/10/2026 inclus (heure de Paris). Le cas normal (compte créé
--    il y a 24 h au plus) ne change pas.
-- 3) claim_retention_bonus : recensement — UN seul appel, app/index.html _retClaimBonus(), étape 2 (contre-offre) du
--    parcours de résiliation ouvert par cancelSubscription() ; whop-cancel ne l'appelle pas (il n'écrit que
--    cancellation_feedback 'cancelled'), aucune autre fonction SQL ni tâche pg_cron. Le bonus est proposé AVANT
--    l'annulation (« reste et reçois +25 crédits ») : au moment de l'appel, whop_cancel_at_period_end vaut false
--    (et cancelSubscription() n'ouvre même pas le parcours s'il vaut true). Exiger une résiliation en cours (true)
--    refuserait donc 100 % des demandes légitimes, et aucune trace serveur de « parcours ouvert » n'existe avant
--    whop-cancel. On aligne seulement le serveur sur la condition réelle de l'écran : refus si une résiliation est
--    DÉJÀ programmée (le bonus n'est pas un cadeau de départ). Le reste est inchangé : abonné payant, une seule fois
--    par compte (retention_bonus_used), +25 crédits. Lier vraiment le bonus à une intention de départ demanderait
--    une étape serveur au début du parcours (hors périmètre base).
-- 4) lebd_verify_code (portail IA LEBD, anon) : recensement — un seul appel, ia-lebd/portail-ialebd-final.html
--    tryLogin(), sb.rpc('lebd_verify_code', { p_code }).single() à chaque validation du code (POST) ; l'auto-login
--    (session locale de 30 jours) ne l'appelle pas (il passe par lebd_code_stats). Usage réel : 19 codes, 4 utilisés
--    sur 30 jours. Ajout de deux plafonds :
--      · par IP (rate_hit, IPv6 regroupée par /64) : 30 essais / 10 min — une salle de formation derrière une même
--        box passe ;
--      · GLOBAL : rafale de 30 puis 1 essai toutes les 10 s, compteur dans une SÉQUENCE. Pourquoi pas rate_hit :
--        PostgREST annule la transaction (ROLLBACK) quand un appel .single() / Accept objet unique ne renvoie pas
--        exactement 1 ligne (failNotSingular → condemn), et un client peut filtrer le résultat (?active=is.true)
--        pour provoquer ce 406 sur chaque mauvais code : l'insertion de rate_hit disparaît, l'essai n'est jamais
--        compté. nextval / setval ne sont PAS annulés par un ROLLBACK : le plafond global tient quoi qu'il arrive.
--    Pour que le portail lui-même ne déclenche plus ce ROLLBACK (et que ses mauvais essais comptent par IP), la
--    fonction renvoie TOUJOURS exactement une ligne : code inconnu ou révoqué → (null, false, null, null). Le portail
--    teste !data.active → même message « Code invalide ou accès révoqué » qu'avant. Refus = HTTP 429 (SQLSTATE PT429)
--    avec un message français ; le portail l'affiche aujourd'hui comme un code invalide (son texte générique).
--    Pas de plafond PAR CODE : il ne ralentit pas une énumération (chaque essai vise un code différent), laisserait
--    n'importe qui bloquer le titulaire d'un code connu, et créerait une ligne rate_events par code essayé.
--    VOLATILE (au lieu de STABLE) : obligatoire pour écrire ; un appel en GET (transaction en lecture seule) échoue
--    avant la recherche, sans rien révéler.

-- ─── 1) mcp_edge_log : plafonds resserrés, champs bornés, horodatage serveur ─────────────────────────────────────────
create or replace function public.mcp_edge_log_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare h json; ip text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  ip := left(coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(h->>'x-real-ip', ''), '?'), 64);
  -- Audit 02/10 : plafonds à quelques fois le débit réel (pic 18 / 10 s par IP, 41 / 10 s au total sur 7 jours).
  if not public.rate_hit('mcpedgelog:ip:' || ip, 10, 40) then return null; end if;   -- 4 / s par IP
  if not public.rate_hit('mcpedgelog:insert', 10, 120) then return null; end if;     -- filet global, ~1 Go/jour au pire
  new.ts            := now();                                -- Audit 02/10 : une date future échappait à la purge 14 j
  new.path          := left(coalesce(new.path, ''), 200);
  new.ua            := left(coalesce(new.ua, ''), 200);
  new.accept        := left(coalesce(new.accept, ''), 120);
  new.extra         := left(coalesce(new.extra, ''), 300);  -- Audit 02/10 : 2 000 → 300 (réel ≤ 82)
  new.bearer_prefix := left(coalesce(new.bearer_prefix, ''), 16);
  new.rpc_method    := left(coalesce(new.rpc_method, ''), 80);
  new.served        := left(coalesce(new.served, ''), 40);
  new.method        := left(coalesce(new.method, ''), 10);
  return new;
end $function$;
revoke all on function public.mcp_edge_log_guard() from public, anon, authenticated;

-- ─── 2) set_referrer : date de fin du rattrapage 14/09 → 25/09 ──────────────────────────────────────────────────────
create or replace function public.set_referrer(p_code text)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_code text := trim(coalesce(p_code, ''));
  v_cur text;
  v_created timestamptz;
  v_plan text;
  v_whop text;
  v_ref uuid;
begin
  if v_uid is null then return false; end if;
  if v_code !~* '^[a-z0-9_-]{4,40}$' then return false; end if;
  select referred_by, created_at, lower(coalesce(plan, 'free')), coalesce(whop_member_id, '')
    into v_cur, v_created, v_plan, v_whop from public.profiles where id = v_uid;
  if not found or coalesce(v_cur, '') <> '' then return false; end if;
  if v_created is null then return false; end if;
  -- Audit 02/10 : le rattrapage des comptes créés du 14/09 au 25/09 ferme après le 15/10/2026 inclus (Paris).
  if not (v_created >= now() - interval '24 hours'
          or (v_created >= timestamptz '2026-09-14 00:00:00+02' and v_created < timestamptz '2026-09-26 00:00:00+02'
              and v_plan = 'free' and v_whop = ''
              and now() < timestamptz '2026-10-16 00:00:00+02')) then return false; end if;
  v_ref := public.referrer_id_from_code(v_code);
  if v_ref is null or v_ref = v_uid then return false; end if;
  update public.profiles set referred_by = upper(substr(replace(v_ref::text, '-', ''), 1, 10))
    where id = v_uid and coalesce(referred_by, '') = '';
  return found;
end $function$;
revoke all on function public.set_referrer(text) from public, anon;
grant execute on function public.set_referrer(text) to authenticated, service_role;

-- ─── 3) claim_retention_bonus : pas de bonus quand une résiliation est déjà programmée ──────────────────────────────
create or replace function public.claim_retention_bonus(p_reason text default null::text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_new integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into v_row from public.profiles where id = auth.uid() for update;
  if not found then return -1; end if;
  if lower(coalesce(v_row.plan,'free')) in ('free','byok') then return -1; end if;
  if coalesce(v_row.retention_bonus_used, false) then return -1; end if;
  -- Audit 02/10 : contre-offre proposée AVANT l'annulation (cancelSubscription n'ouvre pas le parcours si elle est
  -- déjà programmée) → refus si whop_cancel_at_period_end est déjà vrai : le bonus n'est pas un cadeau de départ.
  if coalesce(v_row.whop_cancel_at_period_end, false) then return -1; end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) + 25,
         retention_bonus_used = true
   where id = auth.uid()
   returning credits_remaining into v_new;
  insert into public.cancellation_feedback (user_id, email, plan, reason, outcome)
  values (auth.uid(), v_row.email, v_row.plan, p_reason, 'kept_bonus');
  return v_new;
end;
$function$;
revoke all on function public.claim_retention_bonus(text) from public, anon;
grant execute on function public.claim_retention_bonus(text) to authenticated, service_role;

-- ─── 4) lebd_verify_code : plafonds par IP et global ─────────────────────────────────────────────────────────────────
-- Compteur global : une valeur de séquence = un essai ; « créneau » = secondes epoch / 10. Réservé au propriétaire
-- (les séquences créées par postgres dans public naissent avec USAGE / SELECT pour anon et authenticated).
create sequence if not exists public.lebd_verify_budget_seq as bigint minvalue 1 start with 1;
revoke all on sequence public.lebd_verify_budget_seq from public, anon, authenticated;

create or replace function public.lebd_verify_code(p_code text)
returns table(id uuid, active boolean, uses_count integer, time_spent_seconds integer)
language plpgsql volatile security definer set search_path to 'public' as $function$
declare h json; v_ip text; v_slot bigint; v_n bigint;
begin
  -- Audit 02/10 : 1) plafond par IP (cf-connecting-ip posé par Cloudflare ; IPv6 regroupée par /64) — 30 / 10 min.
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  v_ip := left(coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(h->>'x-real-ip', ''), '?'), 64);
  begin
    if family(v_ip::inet) = 6 then v_ip := network(set_masklen(v_ip::inet, 64))::text; end if;
  exception when others then null;   -- '?' ou valeur inattendue : clé telle quelle
  end;
  if not public.rate_hit('lebd:verify:ip:' || v_ip, 600, 30) then
    raise exception using errcode = 'PT429',
      message = 'Trop de tentatives depuis cette connexion : réessaie dans 10 minutes.';
  end if;
  -- 2) plafond GLOBAL hors transaction (séquence) : rafale de 30, puis 1 essai toutes les 10 s.
  v_slot := floor(extract(epoch from now()) / 10)::bigint;
  v_n := nextval('public.lebd_verify_budget_seq');
  if v_n < v_slot then
    perform setval('public.lebd_verify_budget_seq', v_slot, true);        -- période calme : pas de réserve cumulée
  elsif v_n > v_slot + 30 then
    perform setval('public.lebd_verify_budget_seq', v_slot + 30, true);   -- pas de dette : reprise 10 s après l'afflux
    raise exception using errcode = 'PT429',
      message = 'Trop de tentatives de connexion en ce moment : réessaie dans quelques minutes.';
  end if;
  -- 3) recherche inchangée ; TOUJOURS une ligne (sinon .single() renvoie 406 et PostgREST annule la transaction).
  return query
    select a.id, a.active, a.uses_count, a.time_spent_seconds
    from public.access_codes a
    where upper(trim(a.code)) = upper(trim(coalesce(p_code, ''))) and a.active = true
    limit 1;
  if not found then
    return query select null::uuid, false, null::integer, null::integer;
  end if;
end $function$;
revoke all on function public.lebd_verify_code(text) from public;
grant execute on function public.lebd_verify_code(text) to anon, authenticated, service_role;

-- ─── Contrôles (échec = migration annulée en entier) ────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  -- a) accès légitimes recensés : toujours là
  select string_agg(format('%s:%s', e.f, e.r), ', ') into v
  from (values
    ('public.set_referrer(text)', 'authenticated'), ('public.claim_retention_bonus(text)', 'authenticated'),
    ('public.lebd_verify_code(text)', 'anon'), ('public.lebd_verify_code(text)', 'authenticated')
  ) e(f, r)
  where not has_function_privilege(e.r, to_regprocedure(e.f), 'EXECUTE');
  if v is not null then raise exception 'Audit 02/10 : RPC légitime fermée par erreur : %', v; end if;
  if not has_any_column_privilege('anon', 'public.mcp_edge_log'::regclass, 'INSERT') then
    raise exception 'Audit 02/10 : le relais MCP ne peut plus écrire mcp_edge_log';
  end if;
  -- b) rien de plus ouvert qu'avant
  select string_agg(format('%s:%s', e.f, e.r), ', ') into v
  from (values
    ('public.set_referrer(text)', 'anon'), ('public.claim_retention_bonus(text)', 'anon'),
    ('public.mcp_edge_log_guard()', 'anon'), ('public.mcp_edge_log_guard()', 'authenticated'),
    ('public.rate_hit(text,integer,integer)', 'anon'), ('public.rate_hit(text,integer,integer)', 'authenticated')
  ) e(f, r)
  where has_function_privilege(e.r, to_regprocedure(e.f), 'EXECUTE');
  if v is not null then raise exception 'Audit 02/10 : fonction exécutable par un client : %', v; end if;
  if has_sequence_privilege('anon', 'public.lebd_verify_budget_seq', 'USAGE,SELECT,UPDATE')
     or has_sequence_privilege('authenticated', 'public.lebd_verify_budget_seq', 'USAGE,SELECT,UPDATE') then
    raise exception 'Audit 02/10 : compteur global LEBD accessible à un client';
  end if;
  -- c) volatilité : sans VOLATILE, PostgREST exécuterait l'appel en lecture seule (écriture de rate_hit refusée)
  if (select provolatile from pg_proc where oid = 'public.lebd_verify_code(text)'::regprocedure) <> 'v' then
    raise exception 'Audit 02/10 : lebd_verify_code doit être VOLATILE';
  end if;
end $$;

notify pgrst, 'reload schema';
