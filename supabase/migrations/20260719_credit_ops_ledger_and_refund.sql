-- ═══════════════════════════════════════════════════════════════════════════
-- #122 · Registre des débits + remboursement vérifiable   (appliqué le 19/07/2026)
--
-- Problème : les crédits sont débités AVANT d'appeler le fournisseur (Hedra, fal,
-- ElevenLabs) pour empêcher la triche. Si la génération échoue — panne, quota
-- fournisseur épuisé, timeout — l'utilisateur payait pour rien, sans recours.
--
-- Un remboursement ne peut PAS être une fonction « ajoute N crédits » : ce serait
-- une imprimante à crédits appelable par n'importe qui. Il ne peut rembourser
-- qu'un débit RÉELLEMENT enregistré, appartenant à l'appelant, jamais déjà
-- remboursé, et récent (< 2 h). Le montant vient de la base, jamais du client.
--
-- Testé : débit→remboursement OK · double remboursement refusé · opération
-- inconnue refusée · un utilisateur ne peut ni rembourser ni lire l'opération
-- d'un autre (RLS) · anon ne peut appeler aucune des fonctions.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.credit_ops (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      integer not null check (amount >= 0 and amount <= 3600),
  reason      text,
  created_at  timestamptz not null default now(),
  refunded_at timestamptz
);
create index if not exists credit_ops_user_created_idx on public.credit_ops (user_id, created_at desc);
alter table public.credit_ops enable row level security;
drop policy if exists credit_ops_select_own on public.credit_ops;
create policy credit_ops_select_own on public.credit_ops for select using (auth.uid() = user_id);
revoke all on public.credit_ops from anon, authenticated;
grant select on public.credit_ops to authenticated;

create or replace function public.spend_credits(p_secs integer, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_new integer; v_charged integer; v_op uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_secs is null or p_secs <= 0 or p_secs > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    v_charged := 0; v_new := coalesce(v_row.credits_remaining, 0);
  else
    if coalesce(v_row.credits_remaining,0) < p_secs then
      return jsonb_build_object('ok', false, 'balance', coalesce(v_row.credits_remaining,0), 'op_id', null);
    end if;
    update public.profiles
       set credits_remaining = coalesce(credits_remaining,0) - p_secs,
           bought_credits    = least(coalesce(bought_credits,0), coalesce(credits_remaining,0) - p_secs)
     where id = auth.uid() returning credits_remaining into v_new;
    v_charged := p_secs;
  end if;
  insert into public.credit_ops (user_id, amount, reason)
  values (auth.uid(), v_charged, left(coalesce(p_reason,''), 80)) returning id into v_op;
  return jsonb_build_object('ok', true, 'balance', v_new, 'op_id', v_op);
end; $function$;

-- ancienne signature conservée pour compatibilité : journalise aussi
create or replace function public.spend_credits(p_secs integer)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_res jsonb;
begin
  v_res := public.spend_credits(p_secs, null);
  if (v_res->>'ok')::boolean is not true then return -1; end if;
  return (v_res->>'balance')::integer;
end; $function$;

create or replace function public.refund_credits(p_op_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_op public.credit_ops%rowtype; v_new integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_op from public.credit_ops where id = p_op_id and user_id = auth.uid() for update;
  if not found then                                   return jsonb_build_object('ok', false, 'reason', 'unknown_op');       end if;
  if v_op.refunded_at is not null then                return jsonb_build_object('ok', false, 'reason', 'already_refunded'); end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');          end if;
  update public.credit_ops set refunded_at = now() where id = v_op.id;
  if v_op.amount > 0 then
    update public.profiles set credits_remaining = coalesce(credits_remaining,0) + v_op.amount
     where id = auth.uid() returning credits_remaining into v_new;
  else
    select credits_remaining into v_new from public.profiles where id = auth.uid();
  end if;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_op.amount);
end; $function$;

-- ⚠️ PostgreSQL accorde EXECUTE à PUBLIC par défaut : révoquer sur « anon » ne
-- suffit pas, il faut révoquer sur PUBLIC puis regranter à « authenticated ».
revoke all on function public.spend_credits(integer, text) from public;
revoke all on function public.spend_credits(integer)       from public;
revoke all on function public.refund_credits(uuid)         from public;
grant execute on function public.spend_credits(integer, text) to authenticated;
grant execute on function public.spend_credits(integer)       to authenticated;
grant execute on function public.refund_credits(uuid)         to authenticated;
