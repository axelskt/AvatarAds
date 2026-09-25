-- Creative Factory v2 · onglet Auto-DM (Axel 25/09) : statistiques de l'auto-DM en PERSONNES UNIQUES, sur une période.
-- ig_dashboard_stats() (ancien factory.html) compte des ÉVÈNEMENTS all time (3 liens = 3, même pour 1 seule personne) :
-- elle reste en place pour l'ancien dashboard, celle-ci la remplace pour factory-v2.
--
-- Définition validée par Axel : commentaire mot-clé → a tapé « Je suis abonné » → lien reçu → clic.
--   · ancre d'une personne = son 1er commentaire mot-clé ('ask') DANS la période ; elle compte UNE fois, rattachée à
--     l'heure / au jour / à la semaine / au mois de cette ancre (les points de la courbe s'additionnent donc sans doublon) ;
--   · a tapé   = un 'notyet' ou un 'link' après l'ancre (le tap du bouton écrit l'un ou l'autre) ;
--   · lien     = un 'link' après l'ancre (abonnement vérifié) ; bloquée = a tapé sans lien (pas encore abonnée) ;
--   · clic     = un 'click' après ce 1er lien (ig-go ne logge que des clics sur nos liens signés) ;
--   → chaque étape est incluse dans la précédente : le funnel ne peut pas remonter.
-- Relance (LECTURE SEULE, faite par ig-followup, cron ig-followup-hourly) : lien reçu sans clic → UNE relance 12 à 22 h
-- après le lien, jamais si la personne a déjà cliqué ou déjà été relancée (même règle qu'ig_followup_candidates) :
--   'done' = relancée après l'ancre · 'planned' = pas encore, un lien de moins de 22 h et aucune relance / aucun clic
--   · 'missed' = ne sera pas relancée (fenêtre passée, ou déjà relancée / cliqué auparavant).
-- Données personnelles : seulement le pseudo Instagram et l'état de chaque lead (jamais sender_id ni nombre d'abonnés).
-- Jours, semaines, mois et créneaux horaires à l'heure de Paris. Réservée owner / plan developer (comme factory_access).

create index if not exists ig_dm_log_created_idx on public.ig_dm_log (created_at);

create or replace function public.ig_dm_stats_v2(p_range text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  tz constant text := 'Europe/Paris';
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_first timestamptz;
  v_last timestamptz;
  v_since timestamptz;
  v_step text;
  v_cron jsonb;
  res jsonb;
begin
  select (coalesce(is_owner, false) or lower(coalesce(plan, '')) = 'developer') into ok
  from public.profiles where id = auth.uid();
  if not coalesce(ok, false) then return jsonb_build_object('error', 'forbidden'); end if;
  if p_range is null or p_range not in ('24h', '7j', '30j', '90j', 'all') then return jsonb_build_object('error', 'range'); end if;

  select min(created_at), max(created_at) into v_first, v_last from public.ig_dm_log;
  -- 24 h glissantes par heure ; N jours de Paris entiers, aujourd'hui compris ; 90 j par tranches de 7 jours ;
  -- all time par mois, depuis le mois du 1er évènement
  v_step := case p_range when '24h' then 'hour' when '90j' then 'week' when 'all' then 'month' else 'day' end;
  v_since := case p_range
    when '24h' then v_now - interval '24 hours'
    when '7j'  then (v_today - 6)::timestamp at time zone tz
    when '30j' then (v_today - 29)::timestamp at time zone tz
    when '90j' then (v_today - 89)::timestamp at time zone tz
    else date_trunc('month', coalesce(v_first, v_now) at time zone tz) at time zone tz
  end;

  -- État du cron de relance (jamais sa commande : elle peut contenir la clé IG_CRON_SECRET)
  begin
    select jsonb_build_object('active', j.active, 'schedule', j.schedule) into v_cron
    from cron.job j where j.jobname = 'ig-followup-hourly' limit 1;
  exception when others then v_cron := null;
  end;

  with
  anc as (   -- ancre : 1er commentaire mot-clé de la personne dans la période
    select l.sender_id as s, min(l.created_at) as ta
    from public.ig_dm_log l
    where l.kind = 'ask' and coalesce(l.sender_id, '') <> '' and l.created_at >= v_since and l.created_at <= v_now
    group by l.sender_id
  ),
  ppl as (
    select a.s, a.ta,
      exists (select 1 from public.ig_dm_log e where e.sender_id = a.s and e.kind in ('notyet', 'link') and e.created_at >= a.ta) as tapped,
      (select min(e.created_at) from public.ig_dm_log e where e.sender_id = a.s and e.kind = 'link' and e.created_at >= a.ta) as l1,
      (select min(e.created_at) from public.ig_dm_log e where e.sender_id = a.s and e.kind = 'relance' and e.created_at >= a.ta) as r1,
      exists (select 1 from public.ig_dm_log e where e.sender_id = a.s and e.kind = 'link' and e.created_at > v_now - interval '22 hours') as fresh,
      exists (select 1 from public.ig_dm_log e where e.sender_id = a.s and e.kind in ('click', 'relance')) as any_cr
    from anc a
  ),
  pp as (
    select q.s, q.ta, q.tapped, q.linked, q.r1, q.c1, (q.c1 is not null) as clicked,
      case when q.l1 is null then null
           when q.r1 is not null then 'done'
           when q.c1 is not null then null
           when q.fresh and not q.any_cr then 'planned'
           else 'missed' end as rel
    from (
      select p.*, (p.l1 is not null) as linked,
        (select min(e.created_at) from public.ig_dm_log e where e.sender_id = p.s and e.kind = 'click' and e.created_at >= p.l1) as c1
      from ppl p
    ) q
  ),
  bk as (    -- groupes de la courbe (tous présents, même vides : « 0 » = mesuré)
    select g as b0, g + interval '1 hour' as b1
    from generate_series(v_since, v_now - interval '1 hour', interval '1 hour') g
    where v_step = 'hour'
    union all
    select g at time zone tz, (g + interval '1 day') at time zone tz
    from generate_series((v_since at time zone tz)::date::timestamp, v_today::timestamp, interval '1 day') g
    where v_step = 'day'
    union all
    select g at time zone tz, least(g + interval '7 days', (v_today + 1)::timestamp) at time zone tz
    from generate_series((v_since at time zone tz)::date::timestamp, v_today::timestamp, interval '7 days') g
    where v_step = 'week'
    union all
    select g at time zone tz, (g + interval '1 month') at time zone tz
    from generate_series(date_trunc('month', v_since at time zone tz), date_trunc('month', v_now at time zone tz), interval '1 month') g
    where v_step = 'month'
  ),
  ser as (
    select b.b0,
      count(p.s) as commented,
      count(p.s) filter (where p.tapped) as tapped,
      count(p.s) filter (where p.linked) as linked,
      count(p.s) filter (where p.clicked) as clicked
    from bk b left join pp p on p.ta >= b.b0 and p.ta < b.b1
    group by b.b0
  ),
  pm as (    -- par publication : ancre = 1er commentaire de la personne SUR ce post dans la période
    select l.media_id as m, l.sender_id as s, min(l.created_at) as ta
    from public.ig_dm_log l
    where l.kind = 'ask' and coalesce(l.sender_id, '') <> '' and l.media_id is not null
      and l.created_at >= v_since and l.created_at <= v_now
    group by l.media_id, l.sender_id
  ),
  pm2 as (
    select pm.m, pm.s,
      exists (select 1 from public.ig_dm_log e where e.sender_id = pm.s and e.kind in ('notyet', 'link') and e.created_at >= pm.ta) as tapped,
      (select min(e.created_at) from public.ig_dm_log e where e.sender_id = pm.s and e.kind = 'link' and e.created_at >= pm.ta) as l1
    from pm
  ),
  bm as (
    select m, count(*) as commented,
      count(*) filter (where tapped) as tapped,
      count(*) filter (where l1 is not null) as linked,
      count(*) filter (where l1 is not null and exists (
        select 1 from public.ig_dm_log e where e.sender_id = pm2.s and e.kind = 'click' and e.created_at >= pm2.l1)) as clicked
    from pm2 group by m
  ),
  ht as (    -- meilleures heures : commentaires mot-clé par jour de la semaine (1 = lundi) et par heure
    select extract(isodow from l.created_at at time zone tz)::int as dow, extract(hour from l.created_at at time zone tz)::int as h, count(*)::int as n
    from public.ig_dm_log l
    where l.kind = 'ask' and coalesce(l.sender_id, '') <> '' and l.created_at >= v_since and l.created_at <= v_now
    group by 1, 2
  ),
  late as (  -- ont tapé pendant la période après un commentaire plus ancien : comptées dans la période de leur commentaire
    select count(distinct e.sender_id)::int as n
    from public.ig_dm_log e
    where e.kind in ('notyet', 'link') and coalesce(e.sender_id, '') <> '' and e.created_at >= v_since and e.created_at <= v_now
      and not exists (select 1 from anc a where a.s = e.sender_id and a.ta <= e.created_at)
  ),
  ld as (
    select p.ta, p.tapped, p.linked, p.clicked, p.rel,
      (select e.username from public.ig_dm_log e where e.sender_id = p.s and coalesce(e.username, '') <> '' order by e.created_at desc limit 1) as u
    from pp p order by p.ta desc limit 200
  )
  select jsonb_build_object(
    'range', p_range, 'tz', tz, 'step', v_step, 'since', v_since, 'until', v_now,
    'first_event_at', v_first, 'last_event_at', v_last,
    'funnel', (select jsonb_build_object('commented', count(*), 'tapped', count(*) filter (where tapped),
        'linked', count(*) filter (where linked), 'clicked', count(*) filter (where clicked)) from pp),
    'relance', (select jsonb_build_object('unclicked', count(*) filter (where linked and not clicked),
        'done', count(*) filter (where rel = 'done'), 'done_unclicked', count(*) filter (where rel = 'done' and not clicked),
        'done_clicked', count(*) filter (where rel = 'done' and clicked and c1 >= r1),
        'planned', count(*) filter (where rel = 'planned'), 'missed', count(*) filter (where rel = 'missed')) from pp),
    'relance_cron', v_cron,
    'late', (select n from late),
    'comments', (select count(*) from public.ig_dm_log l
        where l.kind = 'ask' and coalesce(l.sender_id, '') <> '' and l.created_at >= v_since and l.created_at <= v_now),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('t', b0, 'd', to_char(b0 at time zone tz, 'YYYY-MM-DD'),
        'h', extract(hour from b0 at time zone tz)::int, 'commented', commented, 'tapped', tapped, 'linked', linked, 'clicked', clicked)
        order by b0), '[]'::jsonb) from ser),
    'by_media', (select coalesce(jsonb_agg(jsonb_build_object('media_id', m, 'commented', commented, 'tapped', tapped,
        'linked', linked, 'clicked', clicked) order by commented desc, clicked desc, m), '[]'::jsonb)
        from (select * from bm order by commented desc, clicked desc, m limit 30) x),
    'heat', (select coalesce(jsonb_agg(jsonb_build_array(dow, h, n) order by dow, h), '[]'::jsonb) from ht),
    'leads_total', (select count(*) from pp),
    'leads', (select coalesce(jsonb_agg(jsonb_build_object('username', u, 'at', ta, 'tapped', tapped, 'linked', linked,
        'clicked', clicked, 'relance', rel) order by ta desc), '[]'::jsonb) from ld)
  ) into res;
  return res;
end $$;
revoke execute on function public.ig_dm_stats_v2(text) from public, anon;
grant execute on function public.ig_dm_stats_v2(text) to authenticated;
