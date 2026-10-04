-- Audit 04/10 — chantier « données » : quotas de stockage et de Bibliothèque PAR COMPTE, bornes des colonnes de
-- library_items, droits des tables de parrainage, préparation (NON planifiée) de la purge RGPD.
-- Idempotente : create or replace, drop … if exists, revoke / grant explicites (privilèges par défaut FERMÉS depuis P2 :
-- la fonction appelée par les policies de stockage reçoit son GRANT ci-dessous, sinon TOUT envoi échouerait).
-- Un bloc de CONTRÔLE final fait échouer la migration (donc rien n'est appliqué) si l'état attendu n'est pas atteint
-- OU si un accès légitime recensé a disparu. Aucune donnée existante n'est modifiée ni supprimée.
--
-- APPLICATION — Audit 04/10 (relecture) : SURTOUT PAS « supabase db push --linked ». L'historique distant
-- (supabase_migrations.schema_migrations) ne contient que des versions de style MCP jusqu'à 20260926014730 : aucun fichier
-- local à partir de 20260927 n'y est inscrit, P2 / P3 comprises. db push refuse (« Remote migration versions not found in
-- local migrations directory »), et la réparation que propose la CLI (migration repair puis --include-all) rejouerait
-- ~80 anciennes migrations sur la prod et s'arrêterait au bloc de contrôle c) de P2, devenu faux après celle-ci.
-- Appliquer CE fichier SEUL et d'un seul envoi, comme les migrations d'audit précédentes :
--   supabase db query --linked -f supabase/migrations/20261004060000_p4_donnees.sql
--   (ou SQL Editor : coller le fichier ENTIER et l'exécuter en une fois ; avec psql : psql -v ON_ERROR_STOP=1 -f …).
-- Le fichier ouvre et ferme SA transaction (begin … commit) : quel que soit l'outil, tout passe ou rien ne passe, ce que
-- suppose le bloc de contrôle final. lock_timeout 10 s : si un verrou (storage.objects, library_items) n'est pas obtenu,
-- la migration échoue sans rien appliquer au lieu de bloquer les envois de fichiers en file d'attente ; relancer alors.
-- (Non vérifié en direct : si db query refusait begin / commit, rien ne serait appliqué ; passer alors par le SQL Editor.)
--
-- Mesures prod du 04/10 (agrégats en lecture seule, aucun identifiant) qui fixent les plafonds — chacun est PLUSIEURS
-- FOIS l'usage réel ; owner / developer ne sont jamais plafonnés :
--   render-media : payant max 8,2 Go et 298 fichiers (6,9 Go sur 30 j) ; Free max 1,2 Go et 142 fichiers.
--   mcp-media    : payant max 342 Mo et 176 fichiers ; Free max 20 Mo.     brand-assets : max 3 Mo, 21 fichiers.
--   library_items : payant max 183 lignes (111 sur 30 j, 30 / jour) ; Free max 50 (27 sur 30 j) ; vignettes : 10,8 Mo
--                   max par compte ; vignettes récentes ≤ 637 000 car. (Claude, ≤ 600 Ko binaires = 800 000 car. en base64),
--                   ≤ 125 000 car. (app) ; name ≤ 31 car., style ≤ 14, emo ≤ 2, kind ≤ 12, chemin ≤ 81, tags ≤ 31 octets.
--
-- 1) STO-1 / IMG-2 : quota de stockage par compte, vérifié par les policies d'ENVOI (rôle authenticated) de render-media,
--    brand-assets et mcp-media (anim-img). Refus = policy non satisfaite (403 RLS, que l'app traduit en « espace de
--    stockage du compte plein, ou non inclus dans ton plan »). On compare l'usage DÉJÀ stocké dans le dossier <uid>/ du
--    bucket : un envoi passe tant que le compte est sous son plafond (dépassement maximal = un fichier, ≤ 500 Mo).
--      render-media, mcp-media : Free 10 Go / 5 000 fichiers ; plans payants 100 Go / 50 000 fichiers.
--      brand-assets (« Ma marque ») : plan payant exigé (même règle que _brandGate dans l'app, qui n'existait que côté
--      client) ; 2 Go / 1 000 fichiers.
--    Le service (moteur de rendu, MCP, réconciliations) écrit en service_role : RLS non appliquée, inchangé.
--    PAS de liste de types MIME sur render-media : le catalogue montre application/json (25 fichiers du moteur) et
--    binary/octet-stream, et l'app envoie des Blob sans type (la partie multipart part alors en application/octet-stream) :
--    une liste blanche casserait des envois légitimes. Le quota borne le volume quel que soit le type.
--    Limites connues (relecture 04/10, IMG-2 reste PARTIEL) :
--      • les URL d'envoi signées émises par le SERVICE (mcp/index.ts, createSignedUploadUrl en service_role pour la
--        carte Omni / Motion Control : un chemin fixe par job en attente, ≤ 200 Mo vidéo, ≤ 15 Mo photo) sont exécutées
--        par Storage sans RLS : ces dépôts ne sont pas contrôlés au moment de l'envoi, seulement comptés ensuite. Les URL
--        signées demandées par l'app avec la session du compte passent par la policy à la signature : quota appliqué ;
--      • storage_quota_ok compte toutes les lignes de storage.objects du dossier ; si le versionnage d'un bucket est
--        activé un jour, les versions archivées compteront aussi (négligeable tant qu'il ne l'est pas) ;
--      • les plafonds par compte n'empêchent pas l'abus réparti sur plusieurs comptes Free (plafonds acceptés par Axel).
-- 2) LIB-1 : library_items
--    • trigger library_items_cap (BEFORE INSERT, SECURITY INVOKER : current_user = le vrai rôle de la requête, cf.
--      profiles_guard 03/10) — seulement pour un envoi CLIENT (anon / authenticated), owner / developer exemptés :
--        - plafond d'AJOUTS sur 30 jours glissants : Free 300, payant 3 000 (refus, message français) ;
--        - plafond TOTAL : Free 2 000 lignes, payant 50 000 (refus) — un plafond glissant seul ne bloque jamais un compte
--          à cause de lignes anciennes (les créations via Claude ne sont pas purgées par l'app) ;
--        - budget de vignettes par compte : Free 30 Mo, payant 300 Mo ; au-delà la ligne est GARDÉE sans vignette ;
--        - valeurs client ramenées dans les bornes au lieu d'un refus (ancienne app en cache) : name 200, style 100,
--          emo 32 car., tags = 12 chaînes de 40 car., vignette > 1 000 000 car. retirée.
--    • contraintes CHECK (TOUS les rôles, filet dur) : name ≤ 300, style ≤ 100, emo ≤ 32, kind ≤ 40, storage_path ≤ 512
--      car., tags ≤ 4 000 octets, thumb ≤ 1 000 000 car. (au lieu de 1 500 000). NOT VALID : les nouvelles lignes et les
--      lignes modifiées seulement (2 anciennes vignettes de 3,3 Mo restent lisibles).
--    • index (user_id, created_at) : plafonds ci-dessus et chargement de la Bibliothèque (_libLoadServer).
--    • UPDATE retiré à authenticated (jamais utilisé : l'app fait select / insert / delete, le service passe en
--      service_role) ; anon perd tout (auth.uid() est nul pour lui : droits inutiles).
--    NB : le bloc de contrôle c) de 20261003060000_audit_p2_droits.sql exige encore ('library_items','authenticated',
--    'UPDATE') et ('referral_earnings','authenticated','SELECT') : rejouées DANS L'ORDRE (db reset, branche), les
--    migrations passent (P2 tourne avant celle-ci) ; ne jamais rejouer P2 seule après celle-ci.
-- 3) CRED-1 : referral_earnings n'est plus lisible en direct par les rôles client (e-mail, plan, montant payé du filleul,
--    motif anti-fraude). L'écran Parrainage passe par les RPC SECURITY DEFINER (get_referral_summary, get_referral_count,
--    referral_reviews, approve_referral_earning) : inchangé. referral_payouts : anon perd un SELECT inutile (RLS) ;
--    authenticated garde la lecture de SES virements.
-- 4) RGPD-1 : la purge (purge-mcp-media → list_media_purge) n'est PAS planifiée ici (suppression définitive : validation
--    d'Axel). Les commandes prêtes sont en fin de fichier, en commentaire.

-- Audit 04/10 (relecture) : une seule transaction pour tout le fichier (voir APPLICATION en tête).
begin;
set local lock_timeout = '10s';

-- ─── 1) Quota de stockage par compte ────────────────────────────────────────────────────────────────────────────────
-- true = le compte connecté peut encore déposer dans ce bucket. Appelée par les policies d'envoi (rôle authenticated)
-- avec le bucket de la ligne insérée ; le compte vient de la session (auth.uid()), jamais d'un argument : appelée
-- directement en RPC, elle ne renseigne que sur soi-même.
create or replace function public.storage_quota_ok(p_bucket text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_owner boolean;
  v_max_octets bigint;
  v_max_fichiers bigint;
  v_octets bigint;
  v_fichiers bigint;
begin
  if p_bucket is null or p_bucket not in ('render-media', 'mcp-media', 'brand-assets') then return true; end if;
  if v_uid is null then return false; end if;
  select lower(coalesce(nullif(p.plan, ''), 'free')), coalesce(p.is_owner, false) into v_plan, v_owner
  from public.profiles p where p.id = v_uid;
  v_plan := coalesce(v_plan, 'free');
  if coalesce(v_owner, false) or v_plan = 'developer' then return true; end if;
  if p_bucket = 'brand-assets' then
    if v_plan = 'free' then return false; end if;           -- « Ma marque » : plan payant (règle de _brandGate)
    v_max_octets := 2::bigint * 1024 * 1024 * 1024;  v_max_fichiers := 1000;
  elsif v_plan = 'free' then
    v_max_octets := 10::bigint * 1024 * 1024 * 1024; v_max_fichiers := 5000;
  else
    v_max_octets := 100::bigint * 1024 * 1024 * 1024; v_max_fichiers := 50000;
  end if;
  -- dossier <uid>/ du bucket : intervalle en ordre binaire (« / » précède « 0 »), servi par l'index (bucket_id, name "C")
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,18}$' then (o.metadata->>'size')::bigint else 0 end), 0),
         count(*)
    into v_octets, v_fichiers
  from storage.objects o
  where o.bucket_id = p_bucket
    and o.name collate "C" >= (v_uid::text || '/') collate "C"
    and o.name collate "C" <  (v_uid::text || '0') collate "C";
  return v_octets < v_max_octets and v_fichiers < v_max_fichiers;
end $$;
revoke all on function public.storage_quota_ok(text) from public, anon, authenticated;
grant execute on function public.storage_quota_ok(text) to authenticated, service_role;

-- Policies d'envoi : mêmes conditions qu'avant (bucket + dossier du compte) + quota.
drop policy if exists render_media_user_upload on storage.objects;
create policy render_media_user_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'render-media' and (storage.foldername(name))[1] = auth.uid()::text
              and public.storage_quota_ok(bucket_id));

drop policy if exists brand_assets_user_upload on storage.objects;
create policy brand_assets_user_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-assets' and (storage.foldername(name))[1] = auth.uid()::text
              and public.storage_quota_ok(bucket_id));

drop policy if exists mcp_media_anim_img_user_insert on storage.objects;
create policy mcp_media_anim_img_user_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'mcp-media' and (storage.foldername(name))[1] = auth.uid()::text
              and (storage.foldername(name))[2] = 'anim-img' and public.storage_quota_ok(bucket_id));

-- ─── 2) library_items : plafonds par compte, bornes des colonnes, droits ─────────────────────────────────────────────
create index if not exists library_items_user_created_idx on public.library_items (user_id, created_at);

create or replace function public.library_items_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan text;
  v_owner boolean;
  v_free boolean;
  v_total bigint;
  v_30j bigint;
  v_vignettes bigint;
  v_max_vignettes bigint;
begin
  -- Service (MCP, réconciliations : crédits débités côté serveur) et SQL direct : pas de plafond ici, seulement les CHECK.
  if current_user not in ('anon', 'authenticated') then return new; end if;

  -- Valeurs client ramenées dans les bornes (une ancienne app en cache ne les coupait pas) : jamais un refus pour ça.
  -- (NULL reste NULL : les NOT NULL de la table jouent comme avant.)
  new.name  := left(new.name, 200);
  new.style := left(new.style, 100);
  new.emo   := left(new.emo, 32);
  if new.tags is not null and (pg_column_size(new.tags) > 2000
                               or (jsonb_typeof(new.tags) = 'array' and jsonb_array_length(new.tags) > 12)) then
    if jsonb_typeof(new.tags) = 'array' then   -- 12 étiquettes de 40 caractères au plus, dans l'ordre
      select coalesce(jsonb_agg(to_jsonb(left(t.v, 40)) order by t.i), '[]'::jsonb) into new.tags
      from (select e.v, e.i from jsonb_array_elements_text(new.tags) with ordinality as e(v, i) order by e.i limit 12) t;
    else
      new.tags := '[]'::jsonb;
    end if;
  end if;
  if new.thumb is not null and length(new.thumb) > 1000000 then new.thumb := null; end if;

  select lower(coalesce(nullif(p.plan, ''), 'free')), coalesce(p.is_owner, false) into v_plan, v_owner
  from public.profiles p where p.id = new.user_id;
  v_plan := coalesce(v_plan, 'free');
  if coalesce(v_owner, false) or v_plan = 'developer' then return new; end if;
  v_free := (v_plan = 'free');

  select count(*), count(*) filter (where l.created_at > now() - interval '30 days'), coalesce(sum(pg_column_size(l.thumb)), 0)
    into v_total, v_30j, v_vignettes
  from public.library_items l where l.user_id = new.user_id;
  if v_30j >= (case when v_free then 300 else 3000 end) then
    raise exception 'Limite atteinte : % ajouts sur 30 jours au maximum dans la Bibliothèque du compte',
      (case when v_free then 300 else 3000 end);
  end if;
  if v_total >= (case when v_free then 2000 else 50000 end) then
    raise exception 'Limite atteinte : % éléments au maximum dans la Bibliothèque du compte, supprimes-en pour en ajouter',
      (case when v_free then 2000 else 50000 end);
  end if;
  -- Budget de vignettes du compte : au-delà, l'élément est gardé SANS vignette (l'app relit le fichier par son URL signée).
  v_max_vignettes := case when v_free then 30 else 300 end * 1024 * 1024;
  if new.thumb is not null and v_vignettes + pg_column_size(new.thumb) > v_max_vignettes then new.thumb := null; end if;
  return new;
end $$;
revoke all on function public.library_items_cap() from public, anon, authenticated;

drop trigger if exists library_items_cap_t on public.library_items;
create trigger library_items_cap_t before insert on public.library_items
  for each row execute function public.library_items_cap();

alter table public.library_items drop constraint if exists li_thumb_len;
alter table public.library_items add constraint li_thumb_len check (thumb is null or length(thumb) <= 1000000) not valid;
alter table public.library_items drop constraint if exists li_text_len;
alter table public.library_items add constraint li_text_len check (
  char_length(name) <= 300 and (style is null or char_length(style) <= 100) and (emo is null or char_length(emo) <= 32)
  and char_length(kind) <= 40 and char_length(storage_path) <= 512) not valid;
alter table public.library_items drop constraint if exists li_tags_size;
alter table public.library_items add constraint li_tags_size check (pg_column_size(tags) <= 4000) not valid;

revoke update on table public.library_items from authenticated;
revoke all on table public.library_items from anon;

-- ─── 3) Parrainage : plus de lecture directe des commissions ─────────────────────────────────────────────────────────
revoke all on table public.referral_earnings from anon, authenticated;
revoke all on table public.referral_payouts from anon;

-- ─── Contrôles : la migration échoue (rien n'est appliqué) si l'état final n'est pas celui attendu ──────────────────
do $$
declare v text;
begin
  -- a) droits retirés
  select string_agg(format('%s:%s:%s', e.t, e.r, e.p), ', ') into v
  from (values
    ('library_items', 'authenticated', 'UPDATE'), ('library_items', 'anon', 'SELECT'), ('library_items', 'anon', 'INSERT'),
    ('library_items', 'anon', 'UPDATE'), ('library_items', 'anon', 'DELETE'),
    ('referral_earnings', 'authenticated', 'SELECT'), ('referral_earnings', 'anon', 'SELECT'), ('referral_payouts', 'anon', 'SELECT')
  ) e(t, r, p)
  where case e.p when 'DELETE' then has_table_privilege(e.r, ('public.' || e.t)::regclass, 'DELETE')
                 else has_any_column_privilege(e.r, ('public.' || e.t)::regclass, e.p) end;
  if v is not null then raise exception 'Audit 04/10 : droit encore ouvert : %', v; end if;

  -- b) accès LÉGITIMES toujours là (app : Bibliothèque, Parrainage, envois de fichiers)
  select string_agg(format('%s:%s:%s', e.t, e.r, e.p), ', ') into v
  from (values
    ('library_items', 'authenticated', 'SELECT'), ('library_items', 'authenticated', 'INSERT'),
    ('library_items', 'authenticated', 'DELETE'), ('referral_payouts', 'authenticated', 'SELECT'),
    ('profiles', 'authenticated', 'SELECT')
  ) e(t, r, p)
  where not (case e.p when 'DELETE' then has_table_privilege(e.r, ('public.' || e.t)::regclass, 'DELETE')
                      else has_any_column_privilege(e.r, ('public.' || e.t)::regclass, e.p) end);
  if v is not null then raise exception 'Audit 04/10 : accès légitime retiré par erreur : %', v; end if;

  select string_agg(format('%s:%s', e.f, e.r), ', ') into v
  from (values
    ('public.storage_quota_ok(text)', 'authenticated'), ('public.get_referral_summary()', 'authenticated'),
    ('public.get_referral_count()', 'authenticated')
  ) e(f, r)
  where to_regprocedure(e.f) is not null and not has_function_privilege(e.r, to_regprocedure(e.f), 'EXECUTE');
  if v is not null then raise exception 'Audit 04/10 : fonction légitime fermée : %', v; end if;

  if has_function_privilege('anon', 'public.storage_quota_ok(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.library_items_cap()', 'EXECUTE') then
    raise exception 'Audit 04/10 : fonction exécutable par un rôle client qui ne doit pas l''être';
  end if;

  -- c) les 3 policies d'envoi portent bien le quota, et le trigger est en place
  select string_agg(n, ', ') into v
  from unnest(array['render_media_user_upload', 'brand_assets_user_upload', 'mcp_media_anim_img_user_insert']) n
  where not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = n
                      and pg_get_expr(p.polwithcheck, p.polrelid) like '%storage_quota_ok%');
  if v is not null then raise exception 'Audit 04/10 : policy d''envoi sans quota : %', v; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.library_items'::regclass and tgname = 'library_items_cap_t') then
    raise exception 'Audit 04/10 : trigger library_items_cap_t absent';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- ─── 4) RGPD-1 — À PLANIFIER APRÈS VALIDATION D'AXEL (suppression définitive, NON exécuté par cette migration) ───────
-- Estimation du 04/10 (list_media_purge, agrégats en lecture seule) : 142 fichiers, tous dans mcp-media — 138 médias
-- générés via Claude de plus de 30 jours (260 Mo) et 4 envois de plus de 7 jours (1 Mo) ; rien dans render-media.
-- Prérequis : purge-mcp-media déployée (supabase functions deploy purge-mcp-media) ; CRON_SECRET = la valeur du secret
-- Vault « email_drip_cron_key » (même clé que reconcile-kie / reconcile-fal-orphans / ig-followup).
-- a) Essai à blanc (ne supprime rien, compte par motif) puis lecture de la réponse :
--   select net.http_post(
--     url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/purge-mcp-media',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--       'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)),
--     body := '{"dry_run": true, "limit": 1000}'::jsonb, timeout_milliseconds := 60000);
--   select status_code, content from net._http_response order by created desc limit 1;
-- b) Planification quotidienne (04:37, hors des autres tâches de nuit) :
--   select cron.schedule('purge-mcp-media-daily', '37 4 * * *', $cron$
--     select net.http_post(
--       url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/purge-mcp-media',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--         'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)),
--       body := '{"limit": 1000}'::jsonb, timeout_milliseconds := 120000);
--   $cron$);
-- Retour arrière : select cron.unschedule('purge-mcp-media-daily');
-- Reste hors de cette purge (à concevoir) : la rétention 30 jours de la Bibliothèque côté serveur (<uid>/lib + lignes
-- library_items non favorites) exige un favori stocké côté compte (LIB-3) ; les fichiers de transit de l'app (in-*, av*,
-- as-*, bgaud-*, gen-*, mc-*, retouche-*) demandent un recensement de ceux que l'app relit plus tard (régénération d'un
-- montage) avant toute suppression automatique.
