-- 30/10/2026 — audit du Décupleur, failles 3 et 4.
--
-- Faille 4 : le plafond « 3 jobs Décupleur en cours par compte » de render-job se contournait par des requêtes simultanées.
-- render-job COMPTAIT les jobs en cours PUIS insérait, en deux requêtes sans verrou : 30 demandes envoyées au même instant
-- lisaient toutes « 0 » et créaient 30 jobs (dc-fetch gratuits). render_job_dc_creer prend un verrou PAR COMPTE
-- (pg_advisory_xact_lock, relâché à la fin de la transaction), compte et insère dans la MÊME transaction : la 4e demande
-- simultanée voit les 3 premières. Elle applique aussi les nouvelles bornes de la récupération par lien (faille 3) :
-- 1 dc-fetch en cours par compte et un quota (6 par 10 min par défaut), comptés sur TOUS les dc-fetch du compte (app ou
-- MCP, réussis ou non). render-job l'appelle à la place de « comptage + insertion » pour dc-fetch, dc-cut et decupleur ;
-- les autres rendus (Montage IA, Express, Générateur, Motion Control, retouche…) ne passent PAS par elle : rien ne change
-- pour eux.
--
-- Faille 3 : dc-fetch et dc-cut passaient devant tous les rendus payés et pouvaient occuper tous les moteurs.
-- render_claim_dc est la prise en charge (queued → rendering) d'un dc-fetch / dc-cut par un moteur Railway, sous un verrou
-- GLOBAL : au plus p_max de ces jobs rendus en même temps (DC_MOTEURS_MAX, 2 par défaut sur 6 moteurs) — les autres moteurs
-- restent toujours aux rendus normaux. Les autres jobs gardent leur prise en charge habituelle (UPDATE … WHERE status = 'queued').
--
-- Relecture du 30/10 (avant toute mise en ligne de cette migration) :
--   · mc-ref (préparation GRATUITE d'une vidéo des outils Claude : Omni, Motion Control, Décupleur) rouvrait la faille 3 :
--     classe prioritaire, aucun plafond global, créé par le MCP avec un « comptage puis insertion » sans verrou. Il entre
--     dans le plafond global de render_claim_dc (dc-fetch, dc-cut, mc-ref) et le MCP le crée par render_job_dc_creer.
--   · Le MCP (decupler_video) créait ses dc-fetch par une insertion directe (ni quota, ni « 1 en cours ») : il passe aussi
--     par render_job_dc_creer (p_compte = SES composes, p_en_cours_max = 2).
--   · Un compte pouvait garder des dc-cut / dc-fetch d'avance dans la file (3 en cours) : les plus anciens passaient devant
--     le client honnête dès qu'une place se libérait. Désormais UN travail gratuit court (dc-fetch, dc-cut, mc-ref) en file
--     ou en cours par compte (p_court_en_cours_max), tous parcours confondus, et un quota de découpes (p_cut_quota, 10 par
--     fenêtre de p_fetch_fenetre_s).
--
-- Les deux fonctions ne sont exécutables QUE par service_role (render-job, moteurs) : jamais par public / anon / authenticated
-- (un client pourrait sinon créer des jobs pour n'importe quel compte, ou bloquer la file).
-- Un job sans battement depuis 45 min (render-job) / 30 min (moteur : reprise des orphelins) n'est plus compté « en cours »,
-- comme avant.

create or replace function public.render_job_dc_creer(
  p_user uuid,
  p_plan jsonb,
  p_input text,
  p_assets jsonb default '[]'::jsonb,
  p_en_cours_max integer default 3,
  p_fetch_en_cours_max integer default 1,
  p_fetch_quota integer default 6,
  p_fetch_fenetre_s integer default 600,
  p_compte text[] default null,
  p_court_en_cours_max integer default 1,
  p_cut_quota integer default 10
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compose text := p_plan->>'__compose';
  v_vivant timestamptz := now() - interval '45 minutes';
  v_tous constant text[] := array['dc-fetch', 'dc-cut', 'decupleur', 'mc-ref'];
  v_courts constant text[] := array['dc-fetch', 'dc-cut', 'mc-ref'];
  v_compte text[] := coalesce(p_compte, array['dc-fetch', 'dc-cut', 'decupleur']);
  v_fenetre interval := make_interval(secs => greatest(60, least(coalesce(p_fetch_fenetre_s, 600), 86400)));
  v_n integer;
  v_id uuid;
begin
  if p_user is null or p_input is null or p_input = '' or jsonb_typeof(p_plan) is distinct from 'object'
     or v_compose is null or not (v_compose = any (v_tous))
     or cardinality(v_compte) = 0 or not (v_compte <@ v_tous) then
    raise exception 'render_job_dc_creer : job Décupleur invalide';
  end if;
  -- un verrou par compte : deux demandes du même compte passent l'une après l'autre (les autres comptes ne s'attendent pas)
  perform pg_advisory_xact_lock(hashtextextended('render_job_dc:' || p_user::text, 0));

  -- plafond « N en cours » du parcours appelant (render-job : 3 jobs Décupleur ; MCP : 2 préparations)
  select count(*) into v_n from public.render_jobs
   where user_id = p_user and status in ('queued', 'rendering')
     and plan->>'__compose' = any (v_compte) and updated_at >= v_vivant;
  if v_n >= greatest(1, least(coalesce(p_en_cours_max, 3), 10)) then
    return jsonb_build_object('ok', false, 'raison', 'en_cours');
  end if;

  if v_compose = 'dc-fetch' and p_fetch_en_cours_max is not null then
    select count(*) into v_n from public.render_jobs
     where user_id = p_user and status in ('queued', 'rendering')
       and plan->>'__compose' = 'dc-fetch' and updated_at >= v_vivant;
    if v_n >= greatest(1, least(p_fetch_en_cours_max, 10)) then
      return jsonb_build_object('ok', false, 'raison', 'fetch_en_cours');
    end if;
  end if;

  -- relecture du 30/10 : UN travail gratuit court (récupération, découpe, préparation MCP) en file ou en cours par compte,
  -- tous parcours confondus (app ET MCP). Un compte ne peut plus en mettre d'avance dans la file : chaque nouveau job
  -- arrive APRÈS ceux des autres clients (file des moteurs : created_at).
  if v_compose = any (v_courts) and p_court_en_cours_max is not null then
    select count(*) into v_n from public.render_jobs
     where user_id = p_user and status in ('queued', 'rendering')
       and plan->>'__compose' = any (v_courts) and updated_at >= v_vivant;
    if v_n >= greatest(1, least(p_court_en_cours_max, 10)) then
      return jsonb_build_object('ok', false, 'raison', 'court_en_cours');
    end if;
  end if;

  if v_compose = 'dc-fetch' and p_fetch_quota is not null then
    select count(*) into v_n from public.render_jobs
     where user_id = p_user and plan->>'__compose' = 'dc-fetch' and created_at >= now() - v_fenetre;
    if v_n >= greatest(1, least(p_fetch_quota, 100)) then
      return jsonb_build_object('ok', false, 'raison', 'quota');
    end if;
  end if;
  if v_compose = 'dc-cut' and p_cut_quota is not null then
    select count(*) into v_n from public.render_jobs
     where user_id = p_user and plan->>'__compose' = 'dc-cut' and created_at >= now() - v_fenetre;
    if v_n >= greatest(1, least(p_cut_quota, 100)) then
      return jsonb_build_object('ok', false, 'raison', 'quota');
    end if;
  end if;

  insert into public.render_jobs (user_id, status, plan, input_video, assets, avatar_clips)
  values (p_user, 'queued', p_plan, p_input, coalesce(p_assets, '[]'::jsonb), '[]'::jsonb)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.render_job_dc_creer(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text[], integer, integer) from public, anon, authenticated;
grant execute on function public.render_job_dc_creer(uuid, jsonb, text, jsonb, integer, integer, integer, integer, text[], integer, integer) to service_role;

create or replace function public.render_claim_dc(p_job uuid, p_max integer default 2) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  if p_job is null then return false; end if;
  -- verrou GLOBAL : deux moteurs qui prennent un dc-fetch / dc-cut / mc-ref au même instant passent l'un après l'autre
  -- (relecture 30/10 : mc-ref, préparation gratuite des outils Claude, compte dans le même plafond)
  perform pg_advisory_xact_lock(hashtextextended('render_claim_dc', 0));
  select count(*) into v_n from public.render_jobs
   where status = 'rendering' and plan->>'__compose' in ('dc-fetch', 'dc-cut', 'mc-ref')
     and updated_at >= now() - interval '30 minutes';
  if v_n >= greatest(1, least(coalesce(p_max, 2), 50)) then
    return false;
  end if;
  update public.render_jobs
     set status = 'rendering', updated_at = now(), attempts = coalesce(attempts, 0) + 1
   where id = p_job and status = 'queued' and plan->>'__compose' in ('dc-fetch', 'dc-cut', 'mc-ref');
  return found;
end $$;

revoke all on function public.render_claim_dc(uuid, integer) from public, anon, authenticated;
grant execute on function public.render_claim_dc(uuid, integer) to service_role;
