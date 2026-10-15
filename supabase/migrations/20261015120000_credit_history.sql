-- Historique des crédits (Axel 15/10) : « Mes crédits » liste TOUT ce qui a bougé sur le solde.
--   · dépenses : credit_ops (app) et mcp_debits (via Claude) — déjà journalisées ;
--   · remboursement : montant RÉELLEMENT rendu, noté sur l'op (avant : seul refunded_at, le montant se perdait) ;
--   · tout le reste (abonnement, renouvellement, pack, cadeau, fin d'abonnement, retrait d'un pack remboursé, geste à la
--     main) : journalisé dans credit_events par des TRIGGERS sur profiles — aucun chemin d'argent n'est modifié (webhook
--     Whop, RPC de crédits) et un futur chemin est pris automatiquement.
-- Règle : un trigger d'historique ne doit JAMAIS faire échouer une opération de crédits → tout est sous exception.

-- 1) Montant rendu au remboursement ─────────────────────────────────────────────────────────────────────────────────
alter table public.credit_ops add column if not exists refunded_amount integer;

-- Marqueurs de transaction (set_config local) : « cette transaction a une op journalisée » (aa.ledger) et
-- « l'op remboursée dans cette transaction » (aa.refund_op). Tous les remboursements écrivent l'op PUIS le profil.
create or replace function public.credit_hist_mark_op() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform set_config('aa.ledger', 'op', true);
    if tg_table_name = 'credit_ops' and tg_op = 'UPDATE' and new.refunded_at is not null and old.refunded_at is null then
      perform set_config('aa.refund_op', new.id::text, true);
    end if;
  exception when others then null;
  end;
  return null;
end $$;

drop trigger if exists credit_hist_mark_ins on public.credit_ops;
create trigger credit_hist_mark_ins after insert on public.credit_ops for each row execute function public.credit_hist_mark_op();
drop trigger if exists credit_hist_mark_upd on public.credit_ops;
create trigger credit_hist_mark_upd after update of refunded_at on public.credit_ops for each row execute function public.credit_hist_mark_op();
drop trigger if exists credit_hist_mark_mcp on public.mcp_debits;
create trigger credit_hist_mark_mcp after insert or update on public.mcp_debits for each row execute function public.credit_hist_mark_op();

-- Le profil est re-crédité juste après l'op remboursée : la hausse du solde EST le montant rendu (partiel ou total).
create or replace function public.credit_hist_refund_amount() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_op text;
begin
  begin
    v_op := nullif(current_setting('aa.refund_op', true), '');
    if v_op is not null and coalesce(new.credits_remaining, 0) > coalesce(old.credits_remaining, 0) then
      update public.credit_ops set refunded_amount = coalesce(new.credits_remaining, 0) - coalesce(old.credits_remaining, 0)
       where id = v_op::uuid and user_id = new.id and refunded_amount is null;
      perform set_config('aa.refund_op', '', true);
    end if;
  exception when others then null;
  end;
  return null;
end $$;

drop trigger if exists credit_hist_refund_amount on public.profiles;
create trigger credit_hist_refund_amount after update of credits_remaining on public.profiles
  for each row execute function public.credit_hist_refund_amount();

-- 2) Mouvements du solde hors dépenses ────────────────────────────────────────────────────────────────────────────
create table if not exists public.credit_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  kind          text not null,      -- abonnement | changement | renouvellement | pack | cadeau | fin | retrait | achat | ajustement
  delta         integer not null,   -- variation du solde (+ / −)
  balance_after integer not null,
  plan          text,
  label         text
);
create index if not exists credit_events_user_at on public.credit_events (user_id, created_at desc);
alter table public.credit_events enable row level security;
drop policy if exists credit_events_select_own on public.credit_events;
create policy credit_events_select_own on public.credit_events for select to authenticated using (auth.uid() = user_id);
revoke all on public.credit_events from anon, authenticated;
grant select on public.credit_events to authenticated;

-- Différé à la fin de la transaction : on sait alors si une op de dépense / remboursement l'explique (marqueur posé
-- après la mise à jour du profil dans spend_credits). Sinon c'est un mouvement « hors dépense », classé d'après le profil.
create or replace function public.credit_hist_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old integer; v_new integer; v_delta integer; v_kind text; v_label text;
  p_old text; p_new text; v_force text;
  lbl constant jsonb := '{"starter":"Starter","pro":"Pro","elite":"Élite","developer":"Développeur","free":"Free"}';
begin
  begin
    if coalesce(current_setting('aa.ledger', true), '') <> '' then return null; end if;
    v_new := coalesce(new.credits_remaining, 0);
    v_old := case when tg_op = 'INSERT' then 0 else coalesce(old.credits_remaining, 0) end;
    v_delta := v_new - v_old;
    if v_delta = 0 then return null; end if;
    p_new := lower(coalesce(new.plan, 'free'));
    p_old := case when tg_op = 'INSERT' then 'free' else lower(coalesce(old.plan, 'free')) end;
    v_force := nullif(current_setting('aa.credit_label', true), '');   -- geste à la main : select set_config('aa.credit_label', '…', true)

    if v_force is not null then v_kind := case when v_delta > 0 then 'cadeau' else 'ajustement' end; v_label := v_force;
    elsif tg_op = 'INSERT' then
      v_kind := 'achat'; v_label := 'Achat fait avant la création du compte';
    elsif p_old = 'free' and p_new <> 'free' then
      v_kind := 'abonnement';
      v_label := 'Abonnement ' || coalesce(lbl->>p_new, p_new) || ' activé'
        || case when coalesce(new.first_sub_bonus_used, false) and not coalesce(old.first_sub_bonus_used, false) then ' (bonus de bienvenue inclus)' else '' end;
    elsif p_old <> 'free' and p_new = 'free' then
      v_kind := 'fin'; v_label := 'Fin de l''abonnement ' || coalesce(lbl->>p_old, p_old);
    elsif p_old <> p_new then
      v_kind := 'changement'; v_label := 'Passage au plan ' || coalesce(lbl->>p_new, p_new)
        || case when coalesce(new.first_sub_bonus_used, false) and not coalesce(old.first_sub_bonus_used, false) then ' (bonus de bienvenue inclus)' else '' end;
    elsif coalesce(new.retention_bonus_used, false) and not coalesce(old.retention_bonus_used, false) then
      v_kind := 'cadeau'; v_label := 'Cadeau de fidélité';
    elsif v_delta > 0 and coalesce(new.bought_credits, 0) - coalesce(old.bought_credits, 0) = v_delta then
      v_kind := 'pack'; v_label := 'Pack de crédits';
    elsif v_delta < 0 and coalesce(new.bought_credits, 0) < coalesce(old.bought_credits, 0) and p_new = p_old and new.credits_total is not distinct from old.credits_total then
      v_kind := 'retrait'; v_label := 'Crédits d''un pack remboursé retirés';
    elsif p_new <> 'free' and new.credits_total is not distinct from old.credits_total and coalesce(new.credits_total, 0) > 0 then
      v_kind := 'renouvellement'; v_label := 'Renouvellement ' || coalesce(lbl->>p_new, p_new) || ' (crédits du mois)';
    else
      v_kind := 'ajustement'; v_label := 'Ajustement du solde';
    end if;

    insert into public.credit_events (user_id, kind, delta, balance_after, plan, label)
    values (new.id, v_kind, v_delta, v_new, p_new, v_label);
  exception when others then null;
  end;
  return null;
end $$;

drop trigger if exists credit_hist_event on public.profiles;
create constraint trigger credit_hist_event after insert or update of credits_remaining on public.profiles
  deferrable initially deferred for each row execute function public.credit_hist_event();

-- 3) Lecture : la page « Mes crédits » ────────────────────────────────────────────────────────────────────────────
-- Une seule liste triée (récent d'abord), par pages : p_before = date de la dernière ligne déjà affichée.
create or replace function public.get_credit_history(p_before timestamptz default null, p_limit integer default 40)
returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid),
  lim as (select least(greatest(coalesce(p_limit, 40), 1), 100) as n),
  hist as (
    select o.created_at as at,
           case when o.reason ilike 'credit accorde%' or o.reason ilike 'cadeau%' then 'cadeau' else 'depense' end as kind,
           case when o.reason ilike 'credit accorde%' or o.reason ilike 'cadeau%'
                then coalesce(nullif(o.amount, 0), nullif(substring(o.reason from '\+\s*(\d+)'), '')::int, 0)
                else -o.amount end as delta,
           o.reason as label,
           o.refunded_at is not null as refunded,
           case when o.refunded_at is null then null else coalesce(o.refunded_amount, o.amount) end as refunded_amount,
           null::integer as balance_after,
           'app' as via
      from public.credit_ops o, me
     where o.user_id = me.uid and (p_before is null or o.created_at < p_before)
       and (o.amount > 0 or o.reason ilike 'cadeau%')
    union all
    select d.created_at, 'depense', -d.amount, coalesce(j.kind, ''),
           coalesce(d.refunded, false) or coalesce(d.refunded_amt, 0) > 0,
           case when coalesce(d.refunded_amt, 0) > 0 then d.refunded_amt when coalesce(d.refunded, false) then d.amount end,
           null, 'claude'
      from public.mcp_debits d left join public.mcp_jobs j on j.id = d.job_id, me
     where d.user_id = me.uid and d.amount > 0 and (p_before is null or d.created_at < p_before)
    union all
    select e.created_at, e.kind, e.delta, e.label, false, null, e.balance_after, 'compte'
      from public.credit_events e, me
     where e.user_id = me.uid and (p_before is null or e.created_at < p_before)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.at desc)
                        from (select * from hist order by at desc limit (select n from lim)) r), '[]'::jsonb),
    'events_since', '2026-10-15'
  )
$$;
revoke all on function public.get_credit_history(timestamptz, integer) from public, anon;
grant execute on function public.get_credit_history(timestamptz, integer) to authenticated;
revoke all on function public.credit_hist_mark_op() from public, anon, authenticated;
revoke all on function public.credit_hist_refund_amount() from public, anon, authenticated;
revoke all on function public.credit_hist_event() from public, anon, authenticated;
