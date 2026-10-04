-- Audit 04/10 — chantier « proxies » : EXP-2 (relances gratuites de l'image de départ d'Express), EXP-4 (propriété des
-- opérations et fichiers Veo relayés par google-ai-proxy), AUD-1 (durée des transcriptions Whisper / dérush bornée par jour).
-- Rejouable (if not exists / create or replace). Service_role seulement : aucune table ni fonction ouverte à anon /
-- authenticated (privilèges par défaut fermés depuis le P2, droits posés explicitement ci-dessous).
--
-- DÉPLOIEMENT — ordre :
--   1. appliquer CETTE migration, puis  NOTIFY pgrst, 'reload schema';  (inclus en fin de fichier) ;
--   2. déployer openai-proxy, google-ai-proxy, derush-transcribe et anim-creer (anim-creer n'utilise que des RPC existantes) ;
--   Les fonctions déployées AVANT la migration restent compatibles (voir chaque section) ; les nouvelles fonctions edge
--   déployées SANS la migration retombent sur l'ancien comportement (RPC ou table absente → repli : relances d'avant, suivi
--   Veo sans contrôle de propriété, transcriptions sans quota du jour mais avec le plafond par fichier).
--   EXP-3 (plan Veo de google-ai-proxy) et MONT-3 (anim-creer) n'ont besoin d'aucune migration.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. EXP-2 — image de départ d'Express : une relance gratuite ne se cumule plus avec le remboursement de la réserve.
--
-- Avant : après l'image payée (réglée), omni_start_claim accordait jusqu'à 2 relances « free » (aucun tirage) tant que la
-- réserve valait au moins 3, en n'importe quelle qualité ; refund_credits (et kie_job_bill, refund_job_open) remboursait
-- ensuite toute la réserve restante. Une op « express » de 4 crédits donnait ainsi 1 image basse + 2 moyennes pour 1 crédit.
--
-- Maintenant, une relance gratuite MET DE CÔTÉ son prix (≤ 3, sans jamais vider la réserve : il reste au moins 1 crédit
-- pour la vidéo) dans omni_start_gift, HORS de reserved_remaining :
--   • si la vidéo est faite, draw_omni_reservation déduit ce montant mis de côté comme l'image offerte → total payé = prix de
--     la vidéo, exactement comme avant (la relance reste offerte) ;
--   • sans vidéo, TOUS les chemins de remboursement (refund_credits, kie_job_bill, refund_job_open, filets) ne rendent que la
--     réserve → la relance est payée. Aucune de ces fonctions n'est modifiée ;
--   • relance en échec chez OpenAI → omni_start_free_fail rend ce qu'elle avait mis de côté ;
--   • une relance ne peut plus être d'un palier plus cher que l'image payée (omni_start_tier) : l'app relance toujours dans la
--     même qualité (_imgGptQuality).
-- draw_omni_reservation note ce qu'il a consommé (omni_start_used_*) ; release_omni_reservation le remet EXACTEMENT (la
-- remise passée par les proxys est plafonnée à 3 par omniStartUsed) → le repli Veo kie → Google re-tire au même prix.
-- Sans relance (omni_start_gift = 0), tirage et rendu sont identiques à avant. Les relances restent accordées aux mêmes
-- conditions qu'avant (2 au plus, réserve de la vidéo ≥ 3 comptée avant les mises de côté) : seule une très petite op
-- (moins de « image + 2 relances + 1 » crédits, ex. Veo 4 s) met de côté moins que le prix de sa 2e relance.
-- Prod (04/10, agrégats 30 j) : 12 ops Express, aucune relance → aucun rattrapage à calculer.
-- Compatibilité : omni_start_claim(uuid, uuid) (openai-proxy d'avant) délègue avec le palier le plus cher (3).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.credit_ops add column if not exists omni_start_gift integer not null default 0;   -- mis de côté par les relances gratuites
alter table public.credit_ops add column if not exists omni_start_tier smallint not null default 0;  -- palier de l'image payée (1 basse, 3 moyenne)
alter table public.credit_ops add column if not exists omni_start_used_img integer;                  -- remise d'image consommée par le dernier tirage vidéo
alter table public.credit_ops add column if not exists omni_start_used_gift integer;                 -- relances consommées par le dernier tirage vidéo

-- 'paid' | 'deny' | 'free:<mis de côté>'
create or replace function public.omni_start_claim_tier(p_user uuid, p_op uuid, p_cost integer)
returns text language plpgsql security definer set search_path = public as $$
declare v public.credit_ops%rowtype; c integer := least(3, greatest(1, coalesce(p_cost, 3))); v_res integer; v_hold integer;
begin
  select * into v from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found or v.reason not in ('express-omni', 'express') or v.refunded_at is not null
     or v.created_at < now() - interval '2 hours' then return 'paid'; end if;
  if v.omni_start_paid = 0 and v.omni_start_img = 0 then
    update public.credit_ops set omni_start_paid = 1, omni_start_tier = c where id = p_op;
    return 'paid';
  end if;
  -- Condition d'avant (« la réserve de la vidéo est là ») comptée AVANT les mises de côté : une 2e relance sur une petite op
  -- (Veo 4 s = 6 crédits) reste accordée comme avant ; elle met alors de côté ce qui reste au-delà de 1 crédit (0 au pire).
  v_res := coalesce(v.reserved_remaining, v.amount);
  if v.omni_start_free < 2 and v_res + greatest(0, v.omni_start_gift) >= 3 and (v.omni_start_tier = 0 or c <= v.omni_start_tier) then
    v_hold := least(c, greatest(0, v_res - 1));
    update public.credit_ops
       set omni_start_free = v.omni_start_free + 1, omni_start_gift = omni_start_gift + v_hold, reserved_remaining = v_res - v_hold
     where id = p_op;
    return 'free:' || v_hold;
  end if;
  return 'deny';
end $$;

-- Ancienne signature (openai-proxy déployé avant cette migration) : palier le plus cher, réponse d'avant ('free').
create or replace function public.omni_start_claim(p_user uuid, p_op uuid)
returns text language plpgsql security definer set search_path = public as $$
declare r text;
begin
  r := public.omni_start_claim_tier(p_user, p_op, 3);
  return case when r like 'free%' then 'free' else r end;
end $$;

-- Relance gratuite en échec chez OpenAI : rend ce qu'elle avait mis de côté (déjà consommé par une vidéo → rien).
create or replace function public.omni_start_free_fail(p_user uuid, p_op uuid, p_hold integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v public.credit_ops%rowtype; v_back integer;
begin
  select * into v from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found or v.reason not in ('express-omni', 'express') or v.refunded_at is not null then return 0; end if;
  v_back := least(greatest(0, v.omni_start_gift), greatest(0, coalesce(p_hold, 0)));
  if v_back = 0 then return 0; end if;
  update public.credit_ops
     set omni_start_gift = omni_start_gift - v_back, reserved_remaining = least(amount, coalesce(reserved_remaining, amount) + v_back)
   where id = p_op;
  return v_back;
end $$;

-- Identique à 20260928030000, sauf la branche « la payée a échoué et a été rendue » : la relance devient l'image payée et se
-- règle d'abord avec ce qu'elle a mis de côté (jamais deux fois).
create or replace function public.omni_start_free_done(p_user uuid, p_op uuid, p_cost integer)
returns text language plpgsql security definer set search_path = public as $$
declare v public.credit_ops%rowtype; c integer := least(3, greatest(1, coalesce(p_cost, 1))); v_take integer; v_res integer;
begin
  select * into v from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found or v.reason not in ('express-omni', 'express') or v.refunded_at is not null then return 'free'; end if;
  if v.omni_start_paid = 2 or v.omni_start_img > 0 then return 'free'; end if;   -- déjà payée (ou op d'avant 20260928030000)
  if v.omni_start_paid = 1 then                                                   -- la payée est en cours : son tirage paie
    update public.credit_ops set omni_start_paid = 2, omni_start_img = c, settled_at = coalesce(settled_at, now()) where id = p_op;
    return 'posted_by_paid';
  end if;
  v_take := least(greatest(0, v.omni_start_gift), c);                           -- la payée a échoué et a été rendue
  v_res := coalesce(v.reserved_remaining, v.amount);
  if v_res >= c - v_take then
    update public.credit_ops
       set omni_start_paid = 2, omni_start_img = c, omni_start_gift = omni_start_gift - v_take,
           reserved_remaining = v_res - (c - v_take), settled_at = coalesce(settled_at, now())
     where id = p_op;
    return 'drawn';
  end if;
  return 'free';
end $$;

-- Identique à 20260925201000, plus : les relances mises de côté sont déduites comme l'image offerte, et le tirage note ce
-- qu'il a consommé (rendu exact par release_omni_reservation).
create or replace function public.draw_omni_reservation(p_user uuid, p_op uuid, p_cost integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_r integer; v_g integer; v_k integer; v_need integer;
begin
  select coalesce(reserved_remaining, amount), least(3, greatest(0, omni_start_img)), greatest(0, omni_start_gift) into v_r, v_g, v_k
    from public.credit_ops
   where id = p_op and user_id = p_user and refunded_at is null and created_at > now() - interval '2 hours'
   for update;
  if not found then return 0; end if;
  v_need := greatest(1, greatest(1, coalesce(p_cost, 1)) - v_g - v_k);
  if v_r < v_need then return 0; end if;
  update public.credit_ops
     set reserved_remaining = v_r - v_need, omni_start_img = 0, omni_start_gift = 0,
         omni_start_used_img = v_g, omni_start_used_gift = v_k
   where id = p_op;
  return v_need;
end $$;

-- Identique à 20260925230000 quand rien n'est noté (tirage d'avant cette migration) ; sinon la remise d'image et les relances
-- consommées par le tirage sont remises telles qu'elles étaient, une seule fois (notes effacées).
create or replace function public.release_omni_reservation(p_user uuid, p_op uuid, p_cost integer, p_img integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rem integer; v_c integer := greatest(1, coalesce(p_cost, 1)); v_g integer := least(3, greatest(0, coalesce(p_img, 0)));
begin
  update public.credit_ops
     set reserved_remaining = least(amount, coalesce(reserved_remaining, amount) + v_c),
         omni_start_img = case when v_g > 0 and omni_start_img = 0 and reason in ('express-omni', 'express')
                               then least(3, greatest(0, coalesce(omni_start_used_img, v_g))) else omni_start_img end,
         omni_start_gift = case when v_g > 0 and reason in ('express-omni', 'express')
                                then omni_start_gift + greatest(0, coalesce(omni_start_used_gift, 0)) else omni_start_gift end,
         omni_start_used_img = case when v_g > 0 then null else omni_start_used_img end,
         omni_start_used_gift = case when v_g > 0 then null else omni_start_used_gift end
   where id = p_op and user_id = p_user and refunded_at is null
   returning reserved_remaining into v_rem;
  return v_rem;
end $$;

revoke all on function public.omni_start_claim_tier(uuid, uuid, integer)        from public, anon, authenticated;
revoke all on function public.omni_start_claim(uuid, uuid)                      from public, anon, authenticated;
revoke all on function public.omni_start_free_fail(uuid, uuid, integer)         from public, anon, authenticated;
revoke all on function public.omni_start_free_done(uuid, uuid, integer)         from public, anon, authenticated;
revoke all on function public.draw_omni_reservation(uuid, uuid, integer)        from public, anon, authenticated;
revoke all on function public.release_omni_reservation(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.omni_start_claim_tier(uuid, uuid, integer)        to service_role;
grant execute on function public.omni_start_claim(uuid, uuid)                      to service_role;
grant execute on function public.omni_start_free_fail(uuid, uuid, integer)         to service_role;
grant execute on function public.omni_start_free_done(uuid, uuid, integer)         to service_role;
grant execute on function public.draw_omni_reservation(uuid, uuid, integer)        to service_role;
grant execute on function public.release_omni_reservation(uuid, uuid, integer, integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. EXP-4 — à qui est cette opération / ce fichier Veo ? google-ai-proxy relayait le suivi (operations/<id>) et le
-- téléchargement (files/<id>:download) de N'IMPORTE QUEL identifiant avec la clé de la plateforme. Il note désormais le
-- propriétaire à la soumission ('op:<id>', même sans tirage) et au suivi terminé ('file:<id>' de chaque fichier livré), et
-- exige que l'appelant en soit le propriétaire (owner / developer : identifiant inconnu toléré) — y compris pour une extension
-- qui désigne la vidéo à prolonger par son fichier (Élite, plus proposée par l'app). Volume : ~2 lignes par vidéo
-- Veo passée par Google (repli de kie). Suppression du compte : cascade sur auth.users.
-- Les identifiants Google expirent après 48 h : une purge (> 7 jours) est possible mais N'EST PAS planifiée ici — commande
-- proposée à Axel :  delete from public.veo_refs where created_at < now() - interval '7 days';
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.veo_refs (
  ref        text primary key check (ref ~ '^(op|file):[A-Za-z0-9._-]{1,200}$'),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists veo_refs_user_idx on public.veo_refs (user_id);
alter table public.veo_refs enable row level security;   -- aucune policy : service_role seulement (google-ai-proxy)
revoke all on table public.veo_refs from public, anon, authenticated;
grant select, insert, delete on table public.veo_refs to service_role;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. AUD-1 — minutes de transcription par compte et par jour (UTC). Une ligne par compte et par moteur, remise à zéro au
-- changement de jour (aucune ligne ajoutée, rien à purger). Suppression du compte : cascade sur auth.users.
--   transcription_take(user, kind, secs, max) : -1 si le quota du jour est atteint (ou si `secs` le dépasserait), sinon
--     réserve `secs` et renvoie le total du jour. secs = 0 → contrôle seul (durée inconnue avant l'appel).
--   transcription_add(user, kind, secs) : corrige le total (durée réelle après coup, ou rendu négatif sur échec), plancher 0.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.transcription_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind    text not null check (kind in ('whisper', 'derush')),
  day     date not null,
  secs    integer not null default 0 check (secs >= 0),
  primary key (user_id, kind)
);
alter table public.transcription_usage enable row level security;   -- aucune policy : service_role seulement
revoke all on table public.transcription_usage from public, anon, authenticated;
grant select, insert, update on table public.transcription_usage to service_role;

create or replace function public.transcription_take(p_user uuid, p_kind text, p_secs integer, p_max integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'utc')::date; v_cur integer;
        v_add integer := least(604800, greatest(0, coalesce(p_secs, 0))); v_max integer := greatest(0, coalesce(p_max, 0));
begin
  if p_user is null or p_kind is null or p_kind not in ('whisper', 'derush') then return -1; end if;
  insert into public.transcription_usage as t (user_id, kind, day, secs) values (p_user, p_kind, v_today, 0)
  on conflict (user_id, kind) do update set day = v_today, secs = case when t.day = v_today then t.secs else 0 end
  returning secs into v_cur;
  if v_cur >= v_max or v_cur + v_add > v_max then return -1; end if;
  if v_add > 0 then
    update public.transcription_usage set secs = secs + v_add where user_id = p_user and kind = p_kind returning secs into v_cur;
  end if;
  return v_cur;
end $$;

create or replace function public.transcription_add(p_user uuid, p_kind text, p_secs integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'utc')::date; v_cur integer; v_s integer := least(604800, greatest(-604800, coalesce(p_secs, 0)));
begin
  if p_user is null or p_kind is null or p_kind not in ('whisper', 'derush') then return null; end if;
  insert into public.transcription_usage as t (user_id, kind, day, secs) values (p_user, p_kind, v_today, greatest(0, v_s))
  on conflict (user_id, kind) do update
     set day = v_today, secs = greatest(0, (case when t.day = v_today then t.secs else 0 end) + v_s)
  returning secs into v_cur;
  return v_cur;
end $$;

revoke all on function public.transcription_take(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.transcription_add(uuid, text, integer)          from public, anon, authenticated;
grant execute on function public.transcription_take(uuid, text, integer, integer) to service_role;
grant execute on function public.transcription_add(uuid, text, integer)          to service_role;

notify pgrst, 'reload schema';
