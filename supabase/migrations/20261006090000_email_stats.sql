-- Statistiques des e-mails v2 (06/10/2026)
-- email_log.resend_id : identifiant Resend de chaque envoi ; email_log.mail : code de l'e-mail (p0, l2, c1, w3, z0…).
-- email_events : un événement par type et par envoi (délivré, ouvert, cliqué, rebond, plainte, désinscrit), reçu par
-- la fonction email-events (webhook Resend) et email-unsub. Lecture : service role uniquement (aucune policy).
-- email_stats : envoyés / délivrés / ouverts / cliqués / désinscrits et taux, par e-mail.

alter table public.email_log add column if not exists resend_id text;
alter table public.email_log add column if not exists mail text;
create index if not exists email_log_resend_id_idx on public.email_log (resend_id) where resend_id is not null;

create table if not exists public.email_events (
  id         bigserial primary key,
  resend_id  text not null,
  type       text not null check (type in ('delivered', 'opened', 'clicked', 'bounced', 'complained', 'delivery_delayed', 'unsubscribed')),
  at         timestamptz not null default now(),
  link       text,
  unique (resend_id, type)   -- une ligne par type et par envoi : on compte des destinataires uniques
);
alter table public.email_events enable row level security;
revoke all on public.email_events from anon, authenticated;
revoke all on sequence public.email_events_id_seq from anon, authenticated;

create or replace view public.email_stats with (security_invoker = true) as
select
  l.mail,
  count(*)                                                    as envoyes,
  count(*) filter (where e.delivered)                         as delivres,
  count(*) filter (where e.opened or e.clicked)               as ouverts,
  count(*) filter (where e.clicked)                           as cliques,
  count(*) filter (where e.bounced)                           as rebonds,
  count(*) filter (where e.unsub)                             as desinscrits,
  round(100.0 * count(*) filter (where e.opened or e.clicked) / nullif(count(*) filter (where e.delivered), 0), 1) as taux_ouverture,
  round(100.0 * count(*) filter (where e.clicked)            / nullif(count(*) filter (where e.delivered), 0), 1) as taux_clic,
  round(100.0 * count(*) filter (where e.unsub)              / nullif(count(*) filter (where e.delivered), 0), 1) as taux_desinscription,
  min(l.sent_at)                                              as premier_envoi,
  max(l.sent_at)                                              as dernier_envoi
from public.email_log l
left join lateral (
  select bool_or(ev.type = 'delivered') as delivered, bool_or(ev.type = 'opened') as opened,
         bool_or(ev.type = 'clicked') as clicked, bool_or(ev.type = 'bounced') as bounced,
         bool_or(ev.type = 'unsubscribed') as unsub
  from public.email_events ev where ev.resend_id = l.resend_id
) e on true
where l.resend_id is not null and l.mail is not null
group by l.mail;
revoke all on public.email_stats from anon, authenticated;
