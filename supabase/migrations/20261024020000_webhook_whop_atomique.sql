-- 24/10/2026 (audit du 23/10 — zone webhook Whop, constats 1/13, 5/9, 20, 21, 22, 23, 24, 27, 34, 44, 59).
-- whop-webhook lisait le profil, faisait parfois un appel réseau (annulation Whop de l'ancien abonnement), puis écrivait
-- des soldes ABSOLUS calculés sur cette lecture : une dépense, un remboursement ou un pack passé entre les deux était
-- effacé ou rendu. Chaque écriture de crédits du webhook passe désormais par UNE fonction serveur qui lit la ligne
-- VERROUILLÉE (select … for update) et écrit dans la même transaction. Réservées au service_role (edge whop-webhook) :
-- le client ne décide jamais d'un crédit, aucun droit pour public / anon / authenticated.
--
--   · whop_webhook_activer      : abonnement activé (plan, crédits du mois, bonus 1er abonnement, pack d'une variante
--                                 versé UNE fois par abonnement même après désactivation puis réactivation, ancien
--                                 abonnement mis en file d'annulation, essai gratuit sans crédits) ;
--   · whop_webhook_pack         : pack acheté (ajout, jamais d'écriture absolue) ;
--   · whop_webhook_renouveler   : paiement d'un abonnement (report plafonné à 2×, paiement d'un ANCIEN abonnement ignoré
--                                 par identifiant d'abonnement, 1er cycle reconnu par l'activation de CE membership) ;
--   · whop_webhook_fin          : fin d'abonnement (retour en free, crédits achetés gardés) ;
--   · whop_webhook_resiliation  : résiliation / réactivation faite chez Whop (cancel_at_period_end) ;
--   · whop_webhook_retirer_pack : remboursement / litige d'un pack (ou du pack d'une variante) ;
--   · whop_webhook_poser_parrain: code de parrainage joint au paiement (achat sans compte), règles de set_referrer.
-- + whop_annulations : file (et journal) des abonnements Whop que le webhook doit résilier (changement de palier, nouveau
--   rendu prioritaire). Échec de l'API Whop → alerte + 500, Whop rejoue le webhook et la résiliation est retentée.
-- + PLANS ANNUELS : les crédits sont vendus « par mois » ; ils ne tombaient qu'à l'activation et au renouvellement, une
--   fois par an. verser_credits_annuels() (pg_cron, toutes les heures) verse les crédits du plan chaque mois à la date
--   anniversaire de l'activation (même report plafonné à 2×, crédits achetés gardés), 12 versements par année payée,
--   idempotent, journal credits_annuels_versements. 0 abonné annuel au 23/10.
-- Relecture du 24/10 :
--   · compte retrouvé par la SEULE adresse payée chez Whop (p_par_adresse) et déjà abonné ailleurs : l'achat n'est plus
--     appliqué d'office (abonnement de la victime résilié, plan et crédits remplacés). Il va dans whop_achats_a_verifier,
--     Axel est alerté et le valide (whop_achat_valider) ou le résilie dans Whop ;
--   · essai gratuit d'un plan annuel : marqué (annuel_mois = 0), le rattrapage du versement mensuel ne le compte plus
--     comme un annuel payé ;
--   · whop_annulations : essais espacés (dernier_essai_at), retentés par le webhook sans renvoyer d'erreur à Whop ;
--   · whop_webhook_renouveler : rattache aussi le lien « Gérer mon abonnement » (journal) d'un profil réactivé.
--
-- Rejouable (if not exists / create or replace / revoke + grant explicites / cron re-planifié par nom), y compris par-dessus
-- la 1re version de ce fichier (ancienne signature de whop_webhook_activer supprimée). À appliquer AVANT de déployer
-- whop-webhook (la fonction appelle ces RPC).

-- ─── 1) Plans annuels : départ de l'année payée + nombre de mois déjà versés ─────────────────────────────────────────
-- Protégées d'office : profiles_guard n'autorise au client que first_name / phone / affiliate_payment.
alter table public.profiles add column if not exists annuel_debut timestamptz;   -- activation ou dernier paiement annuel
alter table public.profiles add column if not exists annuel_mois integer;        -- mois versés sur cette année (1 à 12 ; 0 = essai pas encore payé)

-- Crédits MENSUELS d'un plan annuel Whop (null = pas un plan annuel). Synchro SUB_MAP / VARIANTES de whop-webhook.
create or replace function public.whop_credits_mensuels_annuel(p_plan_id text)
returns integer language sql immutable set search_path = '' as $$
  select case
    when p_plan_id in ('plan_cNydK89X39PLE', 'plan_NcMairMUEz3ST') then 150                                -- Starter
    when p_plan_id in ('plan_P7WIywSa6YrxT', 'plan_iATzKyUuANyfI', 'plan_QF7HXCR81yXRy') then 550          -- Pro
    when p_plan_id in ('plan_OvRwm5CW3xcNh', 'plan_5RTUZOJ3sGCXd', 'plan_QaAyO2Msc11Xk') then 1100         -- Élite30
    when p_plan_id in ('plan_uWTkJDl1GvxNR', 'plan_tAKWwP8U88eTT') then 2200                               -- Élite60
    when p_plan_id in ('plan_x2kDWR6ur2W5E', 'plan_xzr5jL4TCAlWf') then 3300                               -- Élite90
    else null end
$$;
revoke all on function public.whop_credits_mensuels_annuel(text) from public, anon, authenticated;
grant execute on function public.whop_credits_mensuels_annuel(text) to service_role;

create table if not exists public.credits_annuels_versements (
  id           bigint generated always as identity primary key,
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  echeance     timestamptz not null,   -- date anniversaire versée (annuel_debut + n mois)
  mois         integer     not null,   -- n-ième mois de l'année payée (2 à 12 ; le 1er est versé à l'activation)
  credits      integer     not null,   -- crédits du mois
  solde_avant  integer     not null,
  solde_apres  integer     not null,
  whop_plan_id text,
  created_at   timestamptz not null default now(),
  unique (user_id, echeance)           -- un versement par échéance, quoi qu'il arrive
);
alter table public.credits_annuels_versements enable row level security;
alter table public.credits_annuels_versements force row level security;
revoke all on table public.credits_annuels_versements from public, anon, authenticated;
grant select, insert, update, delete on table public.credits_annuels_versements to service_role;

-- ─── 2) File des résiliations Whop à faire par le webhook ─────────────────────────────────────────────────────────────
create table if not exists public.whop_annulations (
  membership_id   text        primary key,                                         -- abonnement Whop à résilier (mem_…)
  user_id         uuid        references public.profiles (id) on delete set null,
  genre           text        not null default 'abonnement',                       -- abonnement | prio
  remplace_par    text,                                                            -- abonnement qui le remplace
  created_at      timestamptz not null default now(),
  essais          integer     not null default 0,
  derniere_erreur text,
  fait_at         timestamptz                                                      -- null = encore à résilier
);
-- relecture du 24/10 : essais espacés (30 min) et bornés (8) par le webhook, sans plus lui faire renvoyer d'erreur à Whop
alter table public.whop_annulations add column if not exists dernier_essai_at timestamptz;
create index if not exists whop_annulations_a_faire on public.whop_annulations (user_id) where fait_at is null;
alter table public.whop_annulations enable row level security;
alter table public.whop_annulations force row level security;
revoke all on table public.whop_annulations from public, anon, authenticated;
grant select, insert, update, delete on table public.whop_annulations to service_role;

-- ─── 2b) Achats à vérifier (relecture du 24/10) ───────────────────────────────────────────────────────────────────────
-- Abonnement payé avec l'adresse d'un compte DÉJÀ abonné (autre abonnement payant non résilié), sans identifiant de compte
-- vérifié : le paiement a été fait sans session (page de secours whop.com, page Tarifs déconnectée) ou par un tiers qui
-- connaît l'adresse. Rien n'est appliqué au compte ; Axel valide (whop_achat_valider) ou résilie le nouvel abonnement dans
-- Whop. Fin, remboursement ou litige de cet abonnement : la ligne est close par le webhook (plus validable).
create table if not exists public.whop_achats_a_verifier (
  membership_id        text        primary key,                                  -- abonnement Whop payé (mem_…)
  user_id              uuid        not null references public.profiles (id) on delete cascade,
  plan_id              text,
  plan                 text,
  credits              integer,
  bonus                integer,
  pack                 integer,
  manage_url           text,
  annuel               boolean,
  essai                boolean,
  abonnement_du_compte text,                                                     -- abonnement en cours du compte à ce moment
  created_at           timestamptz not null default now(),
  traite_at            timestamptz,                                              -- null = en attente
  decision             text                                                      -- appliqué | abonnement terminé | remboursé ou contesté
);
alter table public.whop_achats_a_verifier enable row level security;
alter table public.whop_achats_a_verifier force row level security;
revoke all on table public.whop_achats_a_verifier from public, anon, authenticated;
grant select, insert, update, delete on table public.whop_achats_a_verifier to service_role;

-- Journal : recherche d'un abonnement par son identifiant (1er cycle, plan d'un remboursement).
create index if not exists webhook_events_data_id on public.webhook_events ((body->'data'->>'id'));

-- ─── 3) Activation d'un abonnement ────────────────────────────────────────────────────────────────────────────────────
-- p_credits = crédits du mois du palier ; p_bonus = bonus 1er abonnement (versé seulement si jamais reçu) ; p_pack =
-- crédits du pack d'une variante (0 sinon) ; p_essai = statut Whop « trialing » (constat 59 : plan ouvert, AUCUN crédit du
-- plan ni bonus ni pack ; le 1er vrai paiement verse le mois par whop_webhook_renouveler).
-- Verrous (journal webhook_events, index unique sur event_id) :
--   · 'whop-activation:<abonnement>' : l'activation de cet abonnement a versé ses crédits. Même abonnement encore actif
--     sur le profil → rien ne bouge (activation reçue deux fois, ou rejouée par Whop après un 500).
--   · 'whop-pack-variante:<abonnement>' : pack de la variante déjà versé (constat 27 : une réactivation après une
--     désactivation ne le reverse plus).
-- p_par_adresse (relecture du 24/10) : le webhook n'a retrouvé le compte que par l'adresse payée chez Whop (ni identifiant
-- de compte vérifié, ni même abonnement). Compte déjà sur un AUTRE abonnement payant non résilié → rien n'est appliqué,
-- l'achat va dans whop_achats_a_verifier ('a_verifier' ; 'nouveau' = 1re fois, pour une seule alerte).
drop function if exists public.whop_webhook_activer(uuid, text, text, text, integer, integer, integer, text, boolean, boolean);
create or replace function public.whop_webhook_activer(
  p_user uuid, p_member text, p_plan_id text, p_plan text, p_credits integer, p_bonus integer, p_pack integer,
  p_manage_url text, p_annuel boolean, p_essai boolean, p_par_adresse boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.profiles%rowtype;
  v_keep integer; v_bonus integer := 0; v_pack integer := 0; v_ancien text; v_credits integer; v_nouveau boolean := true;
  v_essai boolean := coalesce(p_essai, false);
begin
  select * into v from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'raison', 'profil introuvable'); end if;

  -- (même plan Whop seulement : un changement de plan sur le même abonnement, s'il arrivait, s'appliquerait comme avant)
  if p_member is not null and v.whop_member_id is not distinct from p_member and lower(coalesce(v.plan, 'free')) <> 'free'
     and v.whop_plan_id is not distinct from p_plan_id
     and (v_essai or exists (select 1 from public.webhook_events where event_id = 'whop-activation:' || p_member)) then
    return jsonb_build_object('ok', true, 'deja', true, 'plan_avant', v.plan);
  end if;

  -- compte retrouvé par la seule adresse et déjà abonné ailleurs (paiement sans session, ou tiers qui connaît l'adresse) :
  -- ni résiliation de son abonnement, ni plan ou crédits remplacés tant qu'Axel n'a pas validé
  if coalesce(p_par_adresse, false) and lower(coalesce(v.plan, 'free')) <> 'free'
     and not coalesce(v.whop_cancel_at_period_end, false) and v.whop_member_id is distinct from p_member then
    if p_member is not null then
      insert into public.whop_achats_a_verifier (membership_id, user_id, plan_id, plan, credits, bonus, pack, manage_url, annuel,
                                                 essai, abonnement_du_compte)
        values (p_member, p_user, p_plan_id, p_plan, p_credits, p_bonus, p_pack, p_manage_url, coalesce(p_annuel, false), v_essai,
                v.whop_member_id)
        on conflict (membership_id) do nothing;
      v_nouveau := found;
    end if;
    return jsonb_build_object('ok', true, 'a_verifier', true, 'nouveau', v_nouveau, 'abonnement_du_compte', v.whop_member_id,
      'plan_avant', v.plan);
  end if;

  -- crédits achetés encore là (les crédits du plan partent en premier) : ils survivent au changement de plan
  v_keep := least(greatest(coalesce(v.bought_credits, 0), 0), greatest(coalesce(v.credits_remaining, 0), 0));
  if not v_essai then
    if not coalesce(v.first_sub_bonus_used, false) then v_bonus := greatest(coalesce(p_bonus, 0), 0); end if;
    if coalesce(p_pack, 0) > 0 then
      if p_member is null then
        v_pack := p_pack;   -- sans identifiant d'abonnement (jamais observé) : comportement d'avant
      else
        begin
          insert into public.webhook_events (event_id, body) values ('whop-pack-variante:' || p_member,
            jsonb_build_object('action', 'audit.pack_variante', 'data', jsonb_build_object('membership', p_member, 'plan', p_plan_id, 'user', p_user, 'credits', p_pack)));
          v_pack := p_pack;
        exception when unique_violation then v_pack := 0;
        end;
      end if;
    end if;
    -- daté de CE versement (réactivation : verrou existant rafraîchi) : whop_webhook_renouveler s'en sert pour reconnaître
    -- le paiement du 1er cycle, même si le 500 d'un échec ultérieur a retiré l'activation du journal
    if p_member is not null then
      update public.webhook_events set received_at = now() where event_id = 'whop-activation:' || p_member;
      if not found then
        begin
          insert into public.webhook_events (event_id, body) values ('whop-activation:' || p_member,
            jsonb_build_object('action', 'audit.activation', 'data', jsonb_build_object('membership', p_member, 'plan', p_plan_id, 'user', p_user)));
        exception when unique_violation then null;
        end;
      end if;
    end if;
  end if;

  -- changement d'abonnement : l'ancien est mis en file de résiliation (fin de période), sauf s'il l'est déjà chez Whop
  if v.whop_member_id is not null and p_member is not null and v.whop_member_id <> p_member
     and not coalesce(v.whop_cancel_at_period_end, false) then
    v_ancien := v.whop_member_id;
    insert into public.whop_annulations (membership_id, user_id, genre, remplace_par)
      values (v_ancien, p_user, 'abonnement', p_member) on conflict (membership_id) do nothing;
  end if;

  v_credits := (case when v_essai then 0 else greatest(coalesce(p_credits, 0), 0) end) + v_bonus + v_keep + v_pack;
  update public.profiles set
    plan                      = p_plan,
    credits_remaining         = v_credits,
    bought_credits            = v_keep + v_pack,
    credits_total             = p_credits,
    whop_member_id            = p_member,
    whop_plan_id              = p_plan_id,
    whop_manage_url           = p_manage_url,
    whop_cancel_at_period_end = false,
    first_sub_bonus_used      = coalesce(first_sub_bonus_used, false) or not v_essai,
    -- essai d'un annuel : annuel_mois = 0 (relecture du 24/10), sinon le rattrapage de verser_credits_annuels le prenait
    -- pour un annuel payé et versait un mois pendant l'essai ; le 1er vrai paiement (whop_webhook_renouveler) pose le départ
    annuel_debut              = case when coalesce(p_annuel, false) and not v_essai then now() end,
    annuel_mois               = case when coalesce(p_annuel, false) then (case when v_essai then 0 else 1 end) end
  where id = p_user;

  return jsonb_build_object('ok', true, 'deja', false, 'plan_avant', v.plan, 'bonus', v_bonus, 'keep', v_keep,
    'pack', v_pack, 'credits', v_credits, 'a_annuler', v_ancien, 'essai', v_essai);
end $$;
revoke all on function public.whop_webhook_activer(uuid, text, text, text, integer, integer, integer, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.whop_webhook_activer(uuid, text, text, text, integer, integer, integer, text, boolean, boolean, boolean) to service_role;

-- Validation par Axel d'un achat mis de côté (SQL : select public.whop_achat_valider('mem_…');) : appliqué comme une
-- activation ordinaire (plan, crédits, bonus, pack) ; l'ancien abonnement du compte part dans whop_annulations, résilié
-- chez Whop par le prochain webhook reçu. Refusé si l'achat est clos (abonnement terminé, remboursé ou contesté entre-temps).
create or replace function public.whop_achat_valider(p_member text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.whop_achats_a_verifier%rowtype; r jsonb;
begin
  select * into a from public.whop_achats_a_verifier where membership_id = p_member for update;
  if not found then return jsonb_build_object('ok', false, 'raison', 'achat introuvable'); end if;
  if a.traite_at is not null then return jsonb_build_object('ok', false, 'raison', 'achat déjà clos : ' || coalesce(a.decision, '—')); end if;
  r := public.whop_webhook_activer(a.user_id, a.membership_id, a.plan_id, a.plan, a.credits, a.bonus, a.pack, a.manage_url,
                                   a.annuel, a.essai, false);
  if coalesce((r->>'ok')::boolean, false) then
    update public.whop_achats_a_verifier set traite_at = now(), decision = 'appliqué' where membership_id = p_member;
  end if;
  return r;
end $$;
revoke all on function public.whop_achat_valider(text) from public, anon, authenticated;
grant execute on function public.whop_achat_valider(text) to service_role;

-- ─── 4) Pack acheté : AJOUT sur la ligne courante (crédits achetés : jamais plafonnés, gardés à la résiliation) ─────
create or replace function public.whop_webhook_pack(p_user uuid, p_credits integer, p_img integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer := greatest(coalesce(p_credits, 0), 0); v_i integer := greatest(coalesce(p_img, 0), 0); v_apres integer;
begin
  update public.profiles set
    credits_remaining = greatest(coalesce(credits_remaining, 0), 0) + v_n,
    bought_credits    = least(greatest(coalesce(bought_credits, 0), 0), greatest(coalesce(credits_remaining, 0), 0)) + v_n,
    img_bonus_credits = coalesce(img_bonus_credits, 0) + v_i
  where id = p_user
  returning credits_remaining into v_apres;
  if not found then return jsonb_build_object('ok', false, 'raison', 'profil introuvable'); end if;
  return jsonb_build_object('ok', true, 'credits', v_apres);
end $$;
revoke all on function public.whop_webhook_pack(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.whop_webhook_pack(uuid, integer, integer) to service_role;

-- ─── 5) Paiement d'un abonnement (renouvellement) ─────────────────────────────────────────────────────────────────────
-- effet : 'ancien_abonnement' (paiement d'un abonnement qui n'est plus celui du profil : rien), 'premier_cycle'
-- (constat 34 : l'activation de CE membership, hors essai, a été reçue il y a moins de 3 jours — elle a déjà versé le
-- mois ; un renouvellement ne tombe jamais si tôt, et un 1er paiement rejoué tard par Whop reste reconnu ; un achat d'un
-- autre produit avec la même adresse ne compte plus), 'credite'. Le paiement réécrit l'abonnement Whop d'un profil qui
-- n'en a plus (constat 27 : réactivation par un simple paiement après une désactivation), et, relecture du 24/10, son
-- lien « Gérer mon abonnement » : un paiement ne le porte pas, il est repris du dernier événement de cet abonnement au
-- journal (activation ou désactivation).
create or replace function public.whop_webhook_renouveler(
  p_user uuid, p_member text, p_plan_id text, p_plan text, p_credits integer, p_annuel boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.profiles%rowtype; v_bought integer; v_planleft integer; v_new integer; v_m integer := greatest(coalesce(p_credits, 0), 0);
begin
  select * into v from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'raison', 'profil introuvable'); end if;
  if v.whop_member_id is not null and p_member is not null and v.whop_member_id <> p_member then
    return jsonb_build_object('ok', true, 'effet', 'ancien_abonnement', 'abonnement_du_compte', v.whop_member_id);
  end if;
  -- relecture finale du 24/10 : achat mis de côté pas encore tranché → ce paiement ne change rien (rappel côté webhook) ;
  -- compte payant SANS abonnement Whop enregistré (plan donné à la main : propriétaire, Élite offert) → un paiement d'un
  -- abonnement inconnu, retrouvé par l'adresse, ne remplace jamais son plan (seul un ancien abonné au MÊME plan Whop est
  -- encore rattaché par un simple paiement)
  if p_member is not null and exists (select 1 from public.whop_achats_a_verifier a where a.membership_id = p_member and a.traite_at is null) then
    return jsonb_build_object('ok', true, 'effet', 'ancien_abonnement', 'abonnement_du_compte', v.whop_member_id);
  end if;
  if v.whop_member_id is null and p_member is not null and lower(coalesce(v.plan, 'free')) <> 'free'
     and v.whop_plan_id is distinct from p_plan_id then
    return jsonb_build_object('ok', true, 'effet', 'ancien_abonnement', 'abonnement_du_compte', null);
  end if;
  -- verrou posé par whop_webhook_activer quand elle a versé le mois, OU activation de ce membership dans le journal (reçue
  -- mais pas encore appliquée : l'activation qui suit écrit le solde du plan en absolu, rien n'est versé deux fois)
  if p_member is not null and (
       exists (select 1 from public.webhook_events e
                where e.event_id = 'whop-activation:' || p_member and e.received_at >= now() - interval '3 days')
    or exists (select 1 from public.webhook_events e
                where e.body->'data'->>'id' = p_member
                  and e.received_at >= now() - interval '3 days'
                  and coalesce(e.body->>'action', e.body->>'event', e.body->>'type', '') ~* 'membership[._](went[._]valid|activated)'
                  and lower(coalesce(e.body->'data'->>'status', '')) <> 'trialing')) then
    return jsonb_build_object('ok', true, 'effet', 'premier_cycle');
  end if;
  -- REPORT PLAFONNÉ À 2× (03/09) : solde du plan reporté + mois neuf, jamais plus de 2× le mois ; achetés par-dessus
  v_bought   := least(greatest(coalesce(v.bought_credits, 0), 0), greatest(coalesce(v.credits_remaining, 0), 0));
  v_planleft := greatest(0, coalesce(v.credits_remaining, 0) - v_bought);
  v_new      := least(v_planleft + v_m, 2 * v_m) + v_bought;
  update public.profiles set
    plan                      = p_plan,
    credits_remaining         = v_new,
    bought_credits            = v_bought,
    credits_total             = v_m,
    whop_plan_id              = p_plan_id,
    whop_member_id            = coalesce(whop_member_id, p_member),
    whop_manage_url           = case when whop_manage_url is null and p_member is not null then
                                  (select e.body->'data'->>'manage_url' from public.webhook_events e
                                    where e.body->'data'->>'id' = p_member and coalesce(e.body->'data'->>'manage_url', '') <> ''
                                    order by e.received_at desc limit 1)
                                else whop_manage_url end,
    whop_cancel_at_period_end = false,
    annuel_debut              = case when coalesce(p_annuel, false) then now() end,
    annuel_mois               = case when coalesce(p_annuel, false) then 1 end
  where id = p_user;
  return jsonb_build_object('ok', true, 'effet', 'credite', 'plan_avant', v.plan, 'avant', coalesce(v.credits_remaining, 0),
    'apres', v_new, 'report', v_planleft, 'achetes', v_bought);
end $$;
revoke all on function public.whop_webhook_renouveler(uuid, text, text, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.whop_webhook_renouveler(uuid, text, text, text, integer, boolean) to service_role;

-- ─── 6) Fin d'abonnement (membership désactivé) ───────────────────────────────────────────────────────────────────────
-- Seulement si l'abonnement QUI EXPIRE est l'actif du profil (identifiant ; repli sur le MÊME plan Whop si aucun n'est enregistré),
-- vérifié sur la ligne verrouillée : une activation arrivée entre-temps n'est plus rétrogradée.
create or replace function public.whop_webhook_fin(p_user uuid, p_member text, p_plan_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.profiles%rowtype; v_keep integer;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'raison', 'profil introuvable'); end if;
  -- relecture finale du 24/10 : sans abonnement enregistré, repli seulement sur le MÊME plan Whop (un plan donné à la main,
  -- sans plan Whop, n'est jamais rétrogradé par la fin d'un abonnement inconnu retrouvé par l'adresse)
  if not ((v.whop_member_id is not null and p_member is not null and v.whop_member_id = p_member)
          or (v.whop_member_id is null and v.whop_plan_id is not null and v.whop_plan_id = p_plan_id)) then
    return jsonb_build_object('ok', true, 'actif', false);
  end if;
  v_keep := least(greatest(coalesce(v.bought_credits, 0), 0), greatest(coalesce(v.credits_remaining, 0), 0));
  update public.profiles set
    plan = 'free', credits_remaining = v_keep, bought_credits = v_keep,
    whop_member_id = null, whop_plan_id = null, whop_manage_url = null, whop_cancel_at_period_end = false,
    annuel_debut = null, annuel_mois = null
  where id = p_user;
  return jsonb_build_object('ok', true, 'actif', true, 'keep', v_keep, 'plan_avant', v.plan);
end $$;
revoke all on function public.whop_webhook_fin(uuid, text, text) from public, anon, authenticated;
grant execute on function public.whop_webhook_fin(uuid, text, text) to service_role;

-- ─── 7) Résiliation ou réactivation faite chez Whop (constat 24) ──────────────────────────────────────────────────────
-- Même règle que la résiliation dans l'app (cancel_remove_plan_credits, 20261024010000) : crédits du PLAN retirés tout de
-- suite, crédits ACHETÉS gardés, plan actif jusqu'à la fin de période, cancel_requested_at posé sous le verrou (un débit
-- antérieur remboursé ensuite ne rend que sa part achetée, une fois 20261024010000 appliquée ; jamais remise à null).
-- Retrait idempotent (le refaire ne retire rien de plus) : peu importe que whop-cancel ou ce webhook passe en premier.
-- Historique : classé « Résiliation : crédits du plan retirés » par credit_hist_event (passage du drapeau à true).
-- Réactivation : seul le drapeau revient à false (comme whop-uncancel). Abonnement de l'événement ≠ celui du profil → rien.
alter table public.profiles add column if not exists cancel_requested_at timestamptz;   -- même colonne que 20261024010000
create or replace function public.whop_webhook_resiliation(p_user uuid, p_member text, p_programmee boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.profiles%rowtype; v_keep integer;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'raison', 'profil introuvable'); end if;
  if p_member is null or v.whop_member_id is distinct from p_member then
    return jsonb_build_object('ok', true, 'effet', 'autre_abonnement');
  end if;
  if coalesce(p_programmee, false) then
    if coalesce(v.whop_cancel_at_period_end, false) then return jsonb_build_object('ok', true, 'effet', 'deja'); end if;
    v_keep := least(greatest(coalesce(v.bought_credits, 0), 0), greatest(coalesce(v.credits_remaining, 0), 0));
    update public.profiles set credits_remaining = v_keep, bought_credits = v_keep, whop_cancel_at_period_end = true,
           cancel_requested_at = clock_timestamp()   -- pris APRÈS le verrou : tout débit déjà passé lui est antérieur
     where id = p_user;
    return jsonb_build_object('ok', true, 'effet', 'resiliee', 'avant', coalesce(v.credits_remaining, 0), 'keep', v_keep);
  end if;
  if not coalesce(v.whop_cancel_at_period_end, false) then return jsonb_build_object('ok', true, 'effet', 'deja'); end if;
  update public.profiles set whop_cancel_at_period_end = false where id = p_user;
  return jsonb_build_object('ok', true, 'effet', 'reactivee');
end $$;
revoke all on function public.whop_webhook_resiliation(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.whop_webhook_resiliation(uuid, text, boolean) to service_role;

-- ─── 8) Remboursement / litige d'un pack (ou du pack d'une variante) : seuls SES crédits, plancher 0 ─────────────────
create or replace function public.whop_webhook_retirer_pack(p_user uuid, p_credits integer, p_img integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.profiles%rowtype; v_n integer := greatest(coalesce(p_credits, 0), 0); v_apres integer;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'raison', 'profil introuvable'); end if;
  v_apres := greatest(0, coalesce(v.credits_remaining, 0) - v_n);
  update public.profiles set
    credits_remaining = v_apres,
    bought_credits    = least(v_apres, greatest(0, least(greatest(coalesce(v.bought_credits, 0), 0), greatest(coalesce(v.credits_remaining, 0), 0)) - v_n)),
    img_bonus_credits = greatest(0, coalesce(v.img_bonus_credits, 0) - greatest(coalesce(p_img, 0), 0))
  where id = p_user;
  return jsonb_build_object('ok', true, 'avant', coalesce(v.credits_remaining, 0), 'apres', v_apres);
end $$;
revoke all on function public.whop_webhook_retirer_pack(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.whop_webhook_retirer_pack(uuid, integer, integer) to service_role;

-- ─── 9) Parrainage d'un achat sans compte (constat 21) ────────────────────────────────────────────────────────────────
-- Le code (metadata aa_ref du paiement) est posé sur le compte avec les règles de set_referrer : format, parrain existant
-- et différent, aucun parrain déjà posé, compte créé il y a moins de 24 h. Le webhook verse ensuite la commission du
-- 1er paiement comme pour un compte déjà parrainé.
create or replace function public.whop_webhook_poser_parrain(p_user uuid, p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_code text := trim(coalesce(p_code, '')); v_ref uuid;
begin
  if p_user is null or v_code !~* '^[a-z0-9_-]{4,40}$' then return false; end if;
  v_ref := public.referrer_id_from_code(v_code);
  if v_ref is null or v_ref = p_user then return false; end if;
  update public.profiles set referred_by = upper(substr(replace(v_ref::text, '-', ''), 1, 10))
   where id = p_user and coalesce(referred_by, '') = '' and created_at >= now() - interval '24 hours';
  return found;
end $$;
revoke all on function public.whop_webhook_poser_parrain(uuid, text) from public, anon, authenticated;
grant execute on function public.whop_webhook_poser_parrain(uuid, text) to service_role;

-- ─── 10) Versement mensuel des crédits des plans ANNUELS (constats 5 et 9) ────────────────────────────────────────────
-- Mois 1 versé par l'activation (ou le paiement annuel) ; mois 2 à 12 versés ici, à annuel_debut + 1…11 mois (calcul
-- depuis le départ : un 31 janvier donne 28/29 février puis 31 mars, sans dérive). Même règle qu'un renouvellement
-- mensuel : solde du plan reporté plafonné à 2× le mois, crédits ACHETÉS gardés par-dessus. Plusieurs échéances en
-- retard (tâche arrêtée) sont rattrapées une par une. Idempotent : chaque versement avance annuel_mois sur la ligne
-- verrouillée et l'échéance est unique dans le journal ; un 2e passage ne trouve rien à verser.
-- Résiliation programmée (whop_cancel_at_period_end) : les versements CONTINUENT jusqu'à la fin de l'année payée — la
-- résiliation ne retire que les crédits du mois en cours (consigne du 24/10). Pour les arrêter à la résiliation, ajouter
-- « and not coalesce(whop_cancel_at_period_end, false) » aux deux sélections ci-dessous.
-- Fin de l'abonnement (whop_webhook_fin), remboursement ou passage à un plan mensuel : annuel_debut remis à null, plus
-- rien n'est versé.
create or replace function public.verser_credits_annuels()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record; v public.profiles%rowtype; v_tour integer; v_ech timestamptz; v_m integer; v_bought integer; v_new integer;
  v_total integer := 0;
begin
  -- annuel sans date de départ (achat en attente appliqué à l'inscription, abonné d'avant ce versement) : le décompte
  -- part de maintenant (le mois en cours a été versé à l'activation). Jamais un essai gratuit (annuel_mois = 0, relecture
  -- du 24/10) : rien n'est dû avant son 1er paiement, qui pose lui-même le départ.
  update public.profiles set annuel_debut = now(), annuel_mois = 1
   where annuel_debut is null and annuel_mois is null and lower(coalesce(plan, 'free')) <> 'free'
     and public.whop_credits_mensuels_annuel(whop_plan_id) is not null;

  -- essai gratuit (annuel_mois = 0) : jamais versé ici, même avec une date de départ posée à la main
  for r in select id from public.profiles
            where annuel_debut is not null and coalesce(annuel_mois, 1) between 1 and 11
              and annuel_debut + make_interval(months => coalesce(annuel_mois, 1)) <= now()
  loop
    begin
      for v_tour in 1..12 loop
        select * into v from public.profiles where id = r.id for update;
        exit when not found or v.annuel_debut is null or coalesce(v.annuel_mois, 1) not between 1 and 11
                  or lower(coalesce(v.plan, 'free')) = 'free';
        v_ech := v.annuel_debut + make_interval(months => coalesce(v.annuel_mois, 1));
        exit when v_ech > now();
        v_m := public.whop_credits_mensuels_annuel(v.whop_plan_id);
        if v_m is null then   -- n'est plus un plan annuel (changement non suivi) : le décompte s'arrête
          update public.profiles set annuel_debut = null, annuel_mois = null where id = r.id;
          exit;
        end if;
        v_bought := least(greatest(coalesce(v.bought_credits, 0), 0), greatest(coalesce(v.credits_remaining, 0), 0));
        v_new    := least(greatest(0, coalesce(v.credits_remaining, 0) - v_bought) + v_m, 2 * v_m) + v_bought;
        insert into public.credits_annuels_versements (user_id, echeance, mois, credits, solde_avant, solde_apres, whop_plan_id)
          values (r.id, v_ech, coalesce(v.annuel_mois, 1) + 1, v_m, coalesce(v.credits_remaining, 0), v_new, v.whop_plan_id);
        update public.profiles set credits_remaining = v_new, bought_credits = v_bought, annuel_mois = coalesce(v.annuel_mois, 1) + 1
         where id = r.id;
        v_total := v_total + 1;
      end loop;
    exception when others then
      raise warning 'verser_credits_annuels : versement refusé pour % (%)', r.id, sqlerrm;   -- les autres comptes passent
    end;
  end loop;
  return v_total;
end $$;
revoke all on function public.verser_credits_annuels() from public, anon, authenticated;
grant execute on function public.verser_credits_annuels() to service_role;

select cron.schedule('credits-annuels-hourly', '52 * * * *', $cron$ select public.verser_credits_annuels(); $cron$);

-- ─── 11) Reprise des verrous pour les abonnements déjà activés (journal) ──────────────────────────────────────────────
-- Sans eux, une 2e activation d'un abonnement activé AVANT cette migration reverserait le pack de sa variante (et
-- remettrait les crédits du plan à plein). Un verrou posé sur un pack ou un rendu prioritaire ne sert à rien mais ne gêne
-- pas (whop_webhook_activer n'est appelée que pour un abonnement).
-- Daté de l'activation d'origine (jamais de now() : le verrou marquerait les renouvellements des 3 prochains jours comme
-- « 1er cycle »).
insert into public.webhook_events (event_id, body, received_at)
select distinct on (e.body->'data'->>'id') 'whop-activation:' || (e.body->'data'->>'id'),
       jsonb_build_object('action', 'audit.activation', 'data', jsonb_build_object('membership', e.body->'data'->>'id',
         'plan', e.body->'data'->'plan'->>'id', 'reprise', '2026-10-24')),
       e.received_at
  from public.webhook_events e
 where coalesce(e.body->>'action', e.body->>'event', e.body->>'type', '') ~* 'membership[._](went[._]valid|activated)'
   and coalesce(e.body->'data'->>'id', '') <> ''
   and lower(coalesce(e.body->'data'->>'status', '')) <> 'trialing'   -- un essai n'a rien versé (verrou = crédits versés)
   and not exists (select 1 from public.webhook_events x where x.event_id = 'whop-activation:' || (e.body->'data'->>'id'))
 order by e.body->'data'->>'id', e.received_at desc   -- la plus récente activation de chaque abonnement
on conflict do nothing;

insert into public.webhook_events (event_id, body)
select distinct on (e.body->'data'->>'id') 'whop-pack-variante:' || (e.body->'data'->>'id'),
       jsonb_build_object('action', 'audit.pack_variante', 'data', jsonb_build_object('membership', e.body->'data'->>'id',
         'plan', e.body->'data'->'plan'->>'id', 'reprise', '2026-10-24'))
  from public.webhook_events e
 where coalesce(e.body->>'action', e.body->>'event', e.body->>'type', '') ~* 'membership[._](went[._]valid|activated)'
   and coalesce(e.body->'data'->>'id', '') <> ''
   and e.body->'data'->'plan'->>'id' in ('plan_blQtyUh90R2wP', 'plan_hE8bkwTPoTkrj', 'plan_0iHH0kY3uoJpo', 'plan_wn7ZntgBemFL0',
     'plan_i7ubxuFfVHQ5k', 'plan_th1REeLIfRP50', 'plan_xN9BOWCvFUWXp', 'plan_NcMairMUEz3ST', 'plan_iATzKyUuANyfI',
     'plan_QF7HXCR81yXRy', 'plan_5RTUZOJ3sGCXd', 'plan_QaAyO2Msc11Xk', 'plan_tAKWwP8U88eTT', 'plan_xzr5jL4TCAlWf')   -- variantes
   and not exists (select 1 from public.webhook_events x where x.event_id = 'whop-pack-variante:' || (e.body->'data'->>'id'))
 order by e.body->'data'->>'id'
on conflict do nothing;
