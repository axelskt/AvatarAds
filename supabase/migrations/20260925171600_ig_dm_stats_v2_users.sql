-- Auto-DM · attribution « lead Instagram → compte AvatarAds → plan payant » dans ig_dm_stats_v2 (Axel 25/09).
-- Remplace la fonction de 20260925124500_ig_dm_stats_v2.sql : MÊME signature, MÊME garde owner / plan developer, mêmes
-- clés ; ajoute seulement, à partir de public.ig_lead_links (migration 20260925171500, à appliquer AVANT celle-ci) :
--   · funnel.users  = leads de la période (personnes uniques, ancrées sur leur 1er commentaire mot-clé) qui ont cliqué
--                     et dont un compte AvatarAds a été CRÉÉ APRÈS le clic (rattaché après l'ancre) → « Devenus users » ;
--   · funnel.paid   = parmi eux, ceux passés d'un plan gratuit à un abonnement payant après le clic ;
--   · attribution.existing      = leads qui ont cliqué avec un compte déjà existant (et aucun nouveau) : pas des users ;
--   · attribution.existing_paid = parmi eux, les comptes existants passés payants APRÈS le clic ;
--   · series[].users = « Devenus users » par groupe (ancre du lead, comme les autres courbes : les points s'additionnent).
-- Chaque étape reste incluse dans la précédente (users ⊂ clics) : le funnel ne peut pas remonter. « 0 » = mesuré.
-- Aucune donnée personnelle ajoutée : seulement des totaux (ni e-mail, ni compte, ni sender_id).

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
  -- 24 h = 24 heures PLEINES de Paris, l'heure en cours comprise ; N jours de Paris entiers, aujourd'hui compris ;
  -- 90 j par tranches de 7 jours ; all time par mois, depuis le mois du 1er évènement
  -- (Axel 25/09) 24 h calées sur l'heure : partir de now() - 24 h donnait des groupes HH:MM → HH+1:MM libellés « HH h »
  -- (un commentaire de 15:10 relevé à 15:27 tombait dans « 14 h–15 h » alors que la carte de chaleur le met à 15 h).
  v_step := case p_range when '24h' then 'hour' when '90j' then 'week' when 'all' then 'month' else 'day' end;
  v_since := case p_range
    when '24h' then date_trunc('hour', v_now, tz) - interval '23 hours'
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
           else 'missed' end as rel,
      -- Attribution (ig_lead_links) : seulement une personne qui a cliqué (le funnel ne remonte jamais), et un clic
      -- rattaché APRÈS son ancre. usr = compte créé après le clic ; ex = seulement un compte existant (disjoints).
      (q.c1 is not null and q.nk is not null) as usr,
      (q.c1 is not null and q.nk is not null and q.nk_paid) as usr_paid,
      (q.c1 is not null and q.nk is null and q.xk is not null) as ex,
      (q.c1 is not null and q.nk is null and q.xk is not null and q.xk_paid) as ex_paid
    from (
      select p.*, (p.l1 is not null) as linked,
        (select min(e.created_at) from public.ig_dm_log e where e.sender_id = p.s and e.kind = 'click' and e.created_at >= p.l1) as c1,
        (select min(k.clicked_at) from public.ig_lead_links k where k.sender_id = p.s and k.new_account and k.clicked_at >= p.ta) as nk,
        exists (select 1 from public.ig_lead_links k where k.sender_id = p.s and k.new_account and k.clicked_at >= p.ta and k.paid_at is not null) as nk_paid,
        (select min(k.clicked_at) from public.ig_lead_links k where k.sender_id = p.s and not k.new_account and k.clicked_at >= p.ta) as xk,
        exists (select 1 from public.ig_lead_links k where k.sender_id = p.s and not k.new_account and k.clicked_at >= p.ta and k.paid_at is not null) as xk_paid
      from ppl p
    ) q
  ),
  bk as (    -- groupes de la courbe (tous présents, même vides : « 0 » = mesuré) ; 24 h : 24 heures pleines, la dernière = l'heure en cours
    select g as b0, g + interval '1 hour' as b1
    from generate_series(v_since, date_trunc('hour', v_now, tz), interval '1 hour') g
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
      count(p.s) filter (where p.clicked) as clicked,
      count(p.s) filter (where p.usr) as users
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
        'linked', count(*) filter (where linked), 'clicked', count(*) filter (where clicked),
        'users', count(*) filter (where usr), 'paid', count(*) filter (where usr_paid)) from pp),
    'attribution', (select jsonb_build_object('existing', count(*) filter (where ex), 'existing_paid', count(*) filter (where ex_paid)) from pp),
    'relance', (select jsonb_build_object('unclicked', count(*) filter (where linked and not clicked),
        'done', count(*) filter (where rel = 'done'), 'done_unclicked', count(*) filter (where rel = 'done' and not clicked),
        'done_clicked', count(*) filter (where rel = 'done' and clicked and c1 >= r1),
        'planned', count(*) filter (where rel = 'planned'), 'missed', count(*) filter (where rel = 'missed')) from pp),
    'relance_cron', v_cron,
    'late', (select n from late),
    'comments', (select count(*) from public.ig_dm_log l
        where l.kind = 'ask' and coalesce(l.sender_id, '') <> '' and l.created_at >= v_since and l.created_at <= v_now),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('t', b0, 'd', to_char(b0 at time zone tz, 'YYYY-MM-DD'),
        'h', extract(hour from b0 at time zone tz)::int, 'commented', commented, 'tapped', tapped, 'linked', linked, 'clicked', clicked,
        'users', users)
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
