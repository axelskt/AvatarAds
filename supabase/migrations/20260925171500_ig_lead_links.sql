-- Attribution « lead Instagram → compte AvatarAds → plan payant » (Axel 25/09 : « si quelqu'un s'inscrit avec un plan
-- payant, on pourra le voir ? → oui construis-le »).
--
-- Chaîne : clic sur le lien DM (r.html → ig-go vérifie la signature, logge le clic, rend une RÉFÉRENCE CHIFFRÉE du lead,
-- jamais l'identifiant Instagram en clair) → le navigateur la garde 30 jours (localStorage aa_lead) → après connexion,
-- l'app l'envoie UNE fois à ig-go ?action=attach → ig-go la vérifie et appelle ig_lead_attach (ci-dessous) avec le
-- user_id de la SESSION (jamais un id fourni par le client) → whop-webhook appelle ig_lead_mark_paid quand ce compte
-- passe d'un plan gratuit à un abonnement payant.
--
-- Définitions :
--   · new_account  = compte CRÉÉ APRÈS le clic (auth.users.created_at > clicked_at) → « devenu user » ;
--                    un compte existant qui clique n'est PAS un nouvel user (new_account = false) ;
--   · paid_at/plan = 1er passage d'un plan gratuit à un abonnement payant (starter / pro / élite) APRÈS le clic ;
--                    un compte déjà payant au rattachement (paying_at_link) n'est pas un « passé payant » ;
--                    nouveau compte déjà payant au rattachement (abonnement payé AVANT la création du compte, via
--                    pending_activations) : paid_at = création du compte, forcément après le clic ;
--   · UNE seule attribution par compte (la 1re) : clé primaire user_id, insert … on conflict do nothing (idempotent).
-- Données : le minimum pour relier aux stats d'ig_dm_log (sender_id, déjà stocké en clair côté serveur dans ig_dm_log ;
-- ni pseudo, ni e-mail, ni IP). Supprimée avec le compte (on delete cascade). RLS activée SANS policy : service role
-- seulement (ig-go, whop-webhook, et la RPC ig_dm_stats_v2 qui n'en sort que des totaux).

create table if not exists public.ig_lead_links (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  sender_id          text not null check (sender_id ~ '^[0-9A-Za-z_-]{3,64}$'),
  clicked_at         timestamptz not null,
  account_created_at timestamptz not null,
  new_account        boolean not null,
  paying_at_link     boolean not null default false,
  attributed_at      timestamptz not null default now(),
  paid_at            timestamptz,
  plan               text
);
create index if not exists ig_lead_links_sender_idx on public.ig_lead_links (sender_id);
alter table public.ig_lead_links enable row level security;
revoke all on table public.ig_lead_links from public, anon, authenticated;

-- Rattachement d'un compte à un lead. Appelée UNIQUEMENT par ig-go (service role) après vérification de la référence ;
-- p_user = l'utilisateur de la session vérifiée par ig-go. Rend { ok, attached, new_account } ou { ok:false, reason }.
create or replace function public.ig_lead_attach(p_user uuid, p_sender text, p_clicked_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created timestamptz;
  v_plan text;
  v_new boolean;
  v_paying boolean;
  n integer;
begin
  if p_user is null or p_clicked_at is null or coalesce(p_sender, '') !~ '^[0-9A-Za-z_-]{3,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'args');
  end if;
  if p_clicked_at > now() + interval '5 minutes' or p_clicked_at < now() - interval '30 days' then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select u.created_at into v_created from auth.users u where u.id = p_user;
  if v_created is null then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;
  select lower(coalesce(nullif(p.plan, ''), 'free')) into v_plan from public.profiles p where p.id = p_user;
  v_plan := coalesce(v_plan, 'free');
  v_new := v_created > p_clicked_at;
  v_paying := v_plan in ('starter', 'pro', 'elite');
  insert into public.ig_lead_links (user_id, sender_id, clicked_at, account_created_at, new_account, paying_at_link, paid_at, plan)
  values (p_user, p_sender, p_clicked_at, v_created, v_new, v_paying,
          case when v_new and v_paying then v_created end,
          case when v_new and v_paying then v_plan end)
  on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', true, 'attached', false, 'reason', 'already'); end if;
  return jsonb_build_object('ok', true, 'attached', true, 'new_account', v_new);
end $$;
revoke execute on function public.ig_lead_attach(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ig_lead_attach(uuid, text, timestamptz) to service_role;

-- Passage payant d'un compte relié. Appelée UNIQUEMENT par whop-webhook (service role), dans un appel isolé qui ne peut
-- ni bloquer ni faire échouer le traitement du paiement. p_prev_plan = plan du profil AVANT la mise à jour du webhook :
-- seul un passage gratuit → abonnement compte (un renouvellement, un changement pro → élite ou un rejeu ne changent
-- rien). 1re fois seulement (paid_at is null) : idempotent. Rend true si la ligne a été marquée.
create or replace function public.ig_lead_mark_paid(p_user uuid, p_plan text, p_prev_plan text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if p_user is null or lower(coalesce(p_plan, '')) not in ('starter', 'pro', 'elite') then return false; end if;
  if lower(coalesce(nullif(p_prev_plan, ''), 'free')) <> 'free' then return false; end if;
  update public.ig_lead_links
     set paid_at = now(), plan = lower(p_plan)
   where user_id = p_user and paid_at is null and clicked_at <= now();
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.ig_lead_mark_paid(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ig_lead_mark_paid(uuid, text, text) to service_role;
