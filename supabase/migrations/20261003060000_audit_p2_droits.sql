-- Audit sécurité du 02/10 — P2 « droits » (base). Idempotente : chaque revoke ne retire que ce qui est encore accordé,
-- les fonctions sont retrouvées par to_regprocedure (absente = ignorée), create or replace + revoke/grant explicites.
-- Deux blocs de CONTRÔLE à la fin font échouer la migration (donc rien n'est appliqué) si un droit dangereux subsiste
-- OU si un accès légitime recensé a disparu.
--
-- 1) Tables du schéma public : anon / authenticated recevaient TOUT (arwdDxtm, droits par défaut de Supabase) sur une
--    vingtaine de tables protégées par la SEULE RLS (render_jobs, mcp_oauth_clients/codes/tokens, ig_accounts…).
--    Règle appliquée pour chaque (table, rôle, privilège) accordé à anon ou authenticated :
--      • TRUNCATE, REFERENCES, TRIGGER, MAINTAIN : retirés partout (la RLS ne s'applique pas à TRUNCATE) ;
--      • INSERT / UPDATE / DELETE : retiré s'il n'existe AUCUNE policy PERMISSIVE pour ce rôle (ou PUBLIC) et cette
--        commande (ou ALL) — avec la RLS active, ces écritures échouaient ou ne touchaient aucune ligne : rien ne
--        change pour l'app, seule l'exposition disparaît ;
--      • SELECT : gardé s'il existe une policy SELECT, UPDATE ou DELETE pour ce rôle (UPDATE/DELETE lisent les colonnes
--        du WHERE), retiré sinon (lecture vide aujourd'hui ; masque aussi le schéma de ces tables à l'API GraphQL).
--    Les droits PAR COLONNE (brand_assets, brand_memory, profiles) ne sont pas touchés : leurs commandes ont une policy.
--    Relevé du catalogue prod (03/10) — ce que la règle retire :
--      anon + authenticated, TOUT (SELECT compris) : factory_missions, factory_render_jobs, factory_variants,
--        ig_accounts, ig_dm_log, ig_rules, lipsync_cache, mcp_oauth_clients, mcp_oauth_codes, mcp_oauth_tokens,
--        service_health, trackads_users ;
--      anon + authenticated, écritures (SELECT gardé, policy SELECT) : anim_creations, mcp_meta, tiktok_accounts ;
--        factory_qc : INSERT, DELETE (SELECT / UPDATE gardés, revue QC du propriétaire) ;
--      render_jobs : anon TOUT, authenticated écritures (SELECT propre gardé) ; social_daily : authenticated écritures ;
--      brand_animations : anon TOUT, authenticated UPDATE (SELECT / INSERT / DELETE propres gardés) ;
--      mcp_edge_log : anon SELECT (INSERT gardé pour le relais MCP, en return=minimal) ;
--      mcp_jobs, mcp_keys, otp_codes : SELECT (aucune policy) ;
--      + TRUNCATE / REFERENCES / TRIGGER / MAINTAIN partout où ils étaient accordés (library_items, brand_screens,
--        factory_bricks/posts/recipes… ; MAINTAIN seul sur profiles, referral_earnings, referral_payouts).
--    Recensement des usages client (app/index.html, *.html, factory-v2, mcp-proxy, ia-lebd, dashboard propriétaire) :
--    sb.from() ne vise que profiles, library_items, brand_assets, brand_memory, brand_animations (select + insert),
--    factory_qc (select + update), factory_bricks, factory_recipes, factory_posts, access_codes (admin LEBD) ;
--    mcp-proxy écrit mcp_edge_log (anon, return=minimal). Tout le reste passe par service_role (edge functions,
--    render-worker, usine) ou par des RPC SECURITY DEFINER. Les edge functions qui utilisent le jeton de l'utilisateur
--    ne lisent que profiles (hedra-proxy) et brand_memory (brand-memory).
--    Séquences : UPDATE (setval) retiré partout ; USAGE / SELECT gardés seulement là où le rôle garde INSERT sur la
--    table (mcp_edge_log), retirés ailleurs (tables réservées au serveur).
-- 2) Droits PAR DÉFAUT de postgres (pg_default_acl) : les tables / fonctions / séquences CRÉÉES PLUS TARD naissaient
--    ouvertes à anon / authenticated (et les fonctions à PUBLIC, défaut global de Postgres : le retrait « in schema »
--    ne l'atteint pas, d'où la ligne globale). Désormais : rien pour les rôles client par défaut — une nouvelle table
--    lue par l'app ou une nouvelle RPC appelée par l'app doit recevoir son GRANT explicite (c'est déjà l'usage des
--    migrations du dépôt). service_role garde ses droits par défaut.
-- 3) Fonctions : EXECUTE retiré à public / anon / authenticated sur
--      • les fonctions mortes, vérifiées sans aucun appel (app, pages, factory, edge functions, render-worker, usine,
--        ia-lebd, dashboard, corps SQL, cron) : spend_credits(integer) (l'app et anim-creer passent TOUJOURS p_reason →
--        surcharge (integer, text)), use_image_quota(), spend_img_bonus(integer), charge_voice_clone() (seul appel :
--        cloneVoice(), bouton dans #voice-clone-section, display:none jamais levé → inatteignable ; s'il était forcé,
--        l'erreur arrête le clonage AVANT ElevenLabs) ;
--      • toutes les fonctions de trigger du schéma (brand_assets_cap, brand_memory_touch, mcp_edge_log_guard,
--        touch_brand_screens étaient exécutables par anon) : l'EXECUTE n'est pas vérifié au déclenchement (preuve en
--        prod : handle_new_user et profiles_guard, déjà fermés, se déclenchent normalement).
--    GARDÉES (appelées par l'app, contrairement à la liste de l'audit) : ensure_quota_month() (ouverture de l'app,
--    _checkAndResetQuota) et use_video_quota() (_incrementVideosUsed après chaque génération). Gardées aussi : les
--    outils propriétaire à garde is_owner interne (mark_referral_payout_paid, approve_referral_earning,
--    referral_reviews, ig_media_duration_set) et les RPC anon du portail IA LEBD (lebd_verify_code, lebd_code_stats,
--    track_usage).
--    factory_hook_matrix (SECURITY INVOKER, exécutable par anon) : search_path figé à public.
-- 4) RGPD, contrat C4 : fichiers temporaires serveur de render-media hors du dossier <uid>/ —
--    mcp-prep/<uid>/<job>.mp4 (vidéo préparée et mesurée par le render-worker) et fal-in/<uid>/<aléatoire>.<ext>
--    (copie servie à fal par fal-proxy) : purgés après 7 jours par list_media_purge (même exclusion owner / developer,
--    l'uid est le 2e segment) et inclus dans list_user_objects (suppression de compte : delete-account boucle déjà
--    sur render-media, aucun changement de code).

-- ─── 1) Tables : droits d'écriture sans policy, TRUNCATE / REFERENCES / TRIGGER / MAINTAIN ───────────────────────────
do $$
declare r record; n integer := 0;
begin
  for r in
    with roles as (
      select oid as roid, rolname from pg_roles where rolname in ('anon', 'authenticated')
    ), droits as (     -- privilèges de table accordés DIRECTEMENT à anon / authenticated (relacl)
      select c.oid as relid, c.relname, ro.roid, ro.rolname, a.privilege_type as priv
      from pg_class c
      join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
      cross join lateral aclexplode(c.relacl) a
      join roles ro on ro.roid = a.grantee
      where c.relkind in ('r', 'p')
    ), couvert as (    -- (table, rôle, commande) couverts par au moins une policy PERMISSIVE visant ce rôle ou PUBLIC
      select d.relid, d.roid, cmd.priv
      from (select distinct relid, roid from droits) d
      cross join (values ('SELECT', 'r'), ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')) cmd(priv, code)
      where exists (
        select 1 from pg_policy p
        where p.polrelid = d.relid and p.polpermissive and p.polcmd in (cmd.code, '*')
          and (0 = any(p.polroles) or exists (select 1 from unnest(p.polroles) x where pg_has_role(d.roid, x, 'MEMBER'))))
    )
    select dr.relname, dr.rolname, dr.priv from droits dr
    where dr.priv in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
       or (dr.priv in ('INSERT', 'UPDATE', 'DELETE')
           and not exists (select 1 from couvert c where c.relid = dr.relid and c.roid = dr.roid and c.priv = dr.priv))
       or (dr.priv = 'SELECT'
           and not exists (select 1 from couvert c where c.relid = dr.relid and c.roid = dr.roid
                                                     and c.priv in ('SELECT', 'UPDATE', 'DELETE')))
    order by 1, 2, 3
  loop
    execute format('revoke %s on table public.%I from %I', r.priv, r.relname, r.rolname);
    raise notice 'Audit 02/10 : revoke % on public.% from %', r.priv, r.relname, r.rolname;
    n := n + 1;
  end loop;
  raise notice 'Audit 02/10 : % droits de table retirés', n;
end $$;

-- Séquences : setval (UPDATE) jamais ; nextval (USAGE) seulement si le rôle peut encore insérer dans la table.
do $$
declare r record;
begin
  for r in
    select s.relname as seq, ro.rolname, a.privilege_type as priv,
           (select dp.refobjid from pg_depend dp
             where dp.classid = 'pg_class'::regclass and dp.objid = s.oid and dp.refclassid = 'pg_class'::regclass
               and dp.deptype in ('a', 'i') limit 1) as tbl
    from pg_class s
    join pg_namespace n on n.oid = s.relnamespace and n.nspname = 'public'
    cross join lateral aclexplode(s.relacl) a
    join pg_roles ro on ro.oid = a.grantee and ro.rolname in ('anon', 'authenticated')
    where s.relkind = 'S'
  loop
    if r.priv = 'UPDATE' or r.tbl is null or not has_table_privilege(r.rolname, r.tbl, 'INSERT') then
      execute format('revoke %s on sequence public.%I from %I', r.priv, r.seq, r.rolname);
    end if;
  end loop;
end $$;

-- ─── 2) Droits par défaut des objets créés plus tard par postgres ────────────────────────────────────────────────────
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;   -- défaut GLOBAL (PUBLIC)
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke update on sequences from anon, authenticated;

-- ─── 3) Fonctions mortes, fonctions de trigger, search_path ──────────────────────────────────────────────────────────
do $$
declare s text;
begin
  foreach s in array array[
    'public.spend_credits(integer)', 'public.use_image_quota()', 'public.spend_img_bonus(integer)',
    'public.charge_voice_clone()'
  ] loop
    if to_regprocedure(s) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', s);
    end if;
  end loop;
  -- toutes les fonctions de trigger (et d'event trigger) du schéma : jamais appelées par l'API
  for s in   -- format %I.%I(args) : nom qualifié quel que soit le search_path de la session
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', s);
  end loop;
  if to_regprocedure('public.factory_hook_matrix()') is not null then
    alter function public.factory_hook_matrix() set search_path = public;
  end if;
end $$;

-- ─── 4) RGPD C4 : temporaires serveur mcp-prep/<uid>/ et fal-in/<uid>/ ───────────────────────────────────────────────
-- (dernière définition : 20261002180000_mcp_credits_par_job.sql, + 4e branche)
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
    -- Audit 02/10 (C4) : vidéo préparée par le render-worker et copie servie à fal, hors du dossier du compte
    select o.bucket_id, o.name, 'temporaire > 7 j' from storage.objects o
     where o.bucket_id = 'render-media' and o.created_at < now() - interval '7 days'
       and o.name ~ '^(mcp-prep|fal-in)/[0-9a-f-]{36}/' and split_part(o.name, '/', 2) not in (select uid from illimites)
    union all
    select o.bucket_id, o.name, 'généré > 30 j' from storage.objects o
     where o.bucket_id = 'mcp-media' and o.created_at < now() - interval '30 days'
       and o.name ~ '^[0-9a-f-]{36}/[0-9]{10,}-[a-z0-9]{3,10}\.(png|jpe?g|webp|mp4|mp3|wav)$'
       and split_part(o.name, '/', 1) not in (select uid from illimites)
  ) t
  limit greatest(1, least(1000, coalesce(p_limit, 500)))
$function$;

-- Tous les fichiers d'un compte (suppression de compte) : dossier <uid>/ des 3 buckets + temporaires serveur (C4).
create or replace function public.list_user_objects(p_user uuid)
returns table(bucket_id text, name text)
language sql security definer set search_path = public, storage as $$
  select o.bucket_id, o.name from storage.objects o
   where p_user is not null and o.bucket_id in ('mcp-media', 'render-media', 'brand-assets')
     and o.name like p_user::text || '/%'
  union all
  select o.bucket_id, o.name from storage.objects o
   where p_user is not null and o.bucket_id = 'render-media'
     and (o.name like 'mcp-prep/' || p_user::text || '/%' or o.name like 'fal-in/' || p_user::text || '/%')
$$;

revoke all on function public.list_media_purge(integer) from public, anon, authenticated;
revoke all on function public.list_user_objects(uuid)  from public, anon, authenticated;
grant execute on function public.list_media_purge(integer) to service_role;
grant execute on function public.list_user_objects(uuid)  to service_role;

-- ─── Contrôles : la migration échoue (rien n'est appliqué) si l'état final n'est pas celui attendu ──────────────────
do $$
declare v text;
begin
  -- a) plus aucun droit dangereux sur une table publique pour anon / authenticated
  select string_agg(format('%s:%s:%s', c.relname, ro.rolname, a.privilege_type), ', ') into v
  from pg_class c
  join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
  cross join lateral aclexplode(c.relacl) a
  join pg_roles ro on ro.oid = a.grantee and ro.rolname in ('anon', 'authenticated')
  where c.relkind in ('r', 'p')
    and (a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
         or (a.privilege_type in ('INSERT', 'UPDATE', 'DELETE') and not exists (
               select 1 from pg_policy p
               where p.polrelid = c.oid and p.polpermissive
                 and p.polcmd in (case a.privilege_type when 'INSERT' then 'a' when 'UPDATE' then 'w' else 'd' end, '*')
                 and (0 = any(p.polroles) or exists (select 1 from unnest(p.polroles) x where pg_has_role(ro.oid, x, 'MEMBER'))))));
  if v is not null then raise exception 'Audit 02/10 : droits de table encore ouverts : %', v; end if;

  -- b) fonctions mortes / de trigger fermées aux rôles client
  select string_agg(p.oid::regprocedure::text, ', ') into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where (p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
         or p.oid in (select to_regprocedure(x) from unnest(array['public.spend_credits(integer)', 'public.use_image_quota()',
                                                                  'public.spend_img_bonus(integer)', 'public.charge_voice_clone()']) x))
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v is not null then raise exception 'Audit 02/10 : fonctions encore exécutables par un client : %', v; end if;
end $$;

do $$
declare v text;
begin
  -- c) accès LÉGITIMES recensés (app, pages factory, admin LEBD, relais MCP) : toujours là
  select string_agg(format('%s:%s:%s', e.t, e.r, e.p), ', ') into v
  from (values
    ('profiles', 'authenticated', 'SELECT'), ('profiles', 'authenticated', 'UPDATE'),
    ('library_items', 'authenticated', 'SELECT'), ('library_items', 'authenticated', 'INSERT'),
    ('library_items', 'authenticated', 'UPDATE'), ('library_items', 'authenticated', 'DELETE'),
    ('brand_assets', 'authenticated', 'SELECT'), ('brand_assets', 'authenticated', 'INSERT'),
    ('brand_assets', 'authenticated', 'UPDATE'), ('brand_assets', 'authenticated', 'DELETE'),
    ('brand_memory', 'authenticated', 'SELECT'), ('brand_memory', 'authenticated', 'INSERT'), ('brand_memory', 'authenticated', 'UPDATE'),
    ('brand_animations', 'authenticated', 'SELECT'), ('brand_animations', 'authenticated', 'INSERT'), ('brand_animations', 'authenticated', 'DELETE'),
    ('credit_ops', 'authenticated', 'SELECT'), ('render_jobs', 'authenticated', 'SELECT'),
    ('referral_earnings', 'authenticated', 'SELECT'), ('referral_payouts', 'authenticated', 'SELECT'),
    ('access_codes', 'authenticated', 'SELECT'), ('access_codes', 'authenticated', 'INSERT'),
    ('access_codes', 'authenticated', 'UPDATE'), ('access_codes', 'authenticated', 'DELETE'),
    ('factory_bricks', 'authenticated', 'SELECT'), ('factory_recipes', 'authenticated', 'SELECT'),
    ('factory_posts', 'authenticated', 'SELECT'), ('factory_posts', 'authenticated', 'UPDATE'),
    ('factory_qc', 'authenticated', 'SELECT'), ('factory_qc', 'authenticated', 'UPDATE'),
    ('mcp_edge_log', 'anon', 'INSERT'), ('mcp_meta', 'anon', 'SELECT')
  ) e(t, r, p)
  where to_regclass('public.' || e.t) is not null
    and not (case e.p when 'DELETE' then has_table_privilege(e.r, ('public.' || e.t)::regclass, 'DELETE')
                      else has_any_column_privilege(e.r, ('public.' || e.t)::regclass, e.p) end);
  if v is not null then raise exception 'Audit 02/10 : accès légitime retiré par erreur : %', v; end if;

  select string_agg(format('%s:%s', e.f, e.r), ', ') into v
  from (values
    ('public.spend_credits(integer,text)', 'authenticated'), ('public.refund_credits(uuid)', 'authenticated'),
    ('public.ensure_quota_month()', 'authenticated'), ('public.use_video_quota()', 'authenticated'),
    ('public.get_referral_count()', 'authenticated'), ('public.get_referral_summary()', 'authenticated'),
    ('public.set_referrer(text)', 'authenticated'), ('public.claim_retention_bonus(text)', 'authenticated'),
    ('public.factory_access()', 'authenticated'), ('public.factory_prod_stats()', 'authenticated'),
    ('public.factory_hook_matrix()', 'authenticated'), ('public.dashboard_owner_data()', 'authenticated'),
    ('public.lebd_verify_code(text)', 'anon'), ('public.lebd_code_stats(uuid)', 'anon'),
    ('public.track_usage(uuid,integer,integer,boolean)', 'anon')
  ) e(f, r)
  where to_regprocedure(e.f) is not null and not has_function_privilege(e.r, to_regprocedure(e.f), 'EXECUTE');
  if v is not null then raise exception 'Audit 02/10 : RPC légitime fermée par erreur : %', v; end if;
end $$;

notify pgrst, 'reload schema';
