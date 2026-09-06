-- Re-test adverse (06/09 soir, workflow) — 3 contournements RÉELS de la réservation + pipelines multi-étapes.
--
-- (1) Une LIBÉRATION était déclenchée par n'importe quel signal amont : poll d'un id de job ÉTRANGER/bidon
--     (fal /requests/<x>, hedra /v3/jobs/<x>, Veo operations/<x>), résultat 422, exception avant le tirage →
--     la réserve revenait → refund PENDANT la génération, ou 2e soumission sur la même op (refund-and-keep,
--     N-pour-1 rouverts). Fix : l'op est LIÉE à l'id du job fournisseur (provider_job) ; les libérations et
--     règlements ASYNCHRONES se font PAR JOB (release_by_job / settle_by_job) — un job non lié ne rend rien.
-- (2) « Aucune op ouverte » = laisser passer (chemin owner/dev) → après un règlement, un abonné soumettait
--     SANS réservation pendant 60-120 min (has_recent_debit compte les ops réglées). Fix côté edge : fail-closed
--     sauf owner/dev.
-- (3) Pour que (2) ne casse pas les pipelines à UN SEUL débit (Express : image gpt → Veo → extensions ;
--     Cartoon : Imagen → Veo ; Montage : orchestrate → rendu), une op RÉGLÉE reste TIRABLE tant qu'il lui reste
--     de la réserve (< 2 h). Règlement = « non remboursable » ; remboursement = la RÉSERVE RESTANTE (partiel),
--     jamais un montant déjà tiré : un échec après une étape livrée ne rend que l'étape échouée.
-- (4) Le worker (Montage IA / Éditeur) ne tirait ni ne réglait → refund après téléchargement. render-job tire
--     la réserve entière à la création et lie l'op au job ('render:<id>') ; le worker règle (done) / libère (failed).

alter table public.credit_ops add column if not exists provider_job text;
create index if not exists credit_ops_provider_job_idx on public.credit_ops (user_id, provider_job) where provider_job is not null;

-- Op TIRABLE : non remboursée, réserve > 0, < 2 h — réglée ou non. L'indice client n'est retenu que s'il est tirable.
create or replace function public.resolve_op(p_user uuid, p_hint uuid)
returns uuid language sql security definer set search_path = public as $$
  select coalesce(
    (select id from public.credit_ops
       where id = p_hint and user_id = p_user and refunded_at is null and amount > 0
         and coalesce(reserved_remaining, amount) > 0 and created_at > now() - interval '2 hours'),
    (select id from public.credit_ops
       where user_id = p_user and refunded_at is null and amount > 0
         and coalesce(reserved_remaining, amount) > 0 and created_at > now() - interval '2 hours'
       order by created_at desc limit 1)
  )
$$;

create or replace function public.draw_reservation(p_user uuid, p_op uuid, p_cost integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rem integer; v_c integer := greatest(1, coalesce(p_cost, 1));
begin
  update public.credit_ops
     set reserved_remaining = coalesce(reserved_remaining, amount) - v_c
   where id = p_op and user_id = p_user and refunded_at is null
     and created_at > now() - interval '2 hours'
     and coalesce(reserved_remaining, amount) >= v_c
   returning reserved_remaining into v_rem;
  return v_rem;
end $$;

create or replace function public.draw_full_reservation(p_user uuid, p_op uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  update public.credit_ops
     set reserved_remaining = 0
   where id = p_op and user_id = p_user and refunded_at is null
     and created_at > now() - interval '2 hours'
     and coalesce(reserved_remaining, amount) > 0
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Liaison op ↔ job fournisseur : la PREMIÈRE liaison gagne (une op = un job asynchrone).
create or replace function public.bind_reservation_job(p_user uuid, p_op uuid, p_job text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  if p_job is null or length(p_job) = 0 or length(p_job) > 300 then return false; end if;
  update public.credit_ops set provider_job = p_job
   where id = p_op and user_id = p_user and provider_job is null and refunded_at is null
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Libération PAR OP : réservée au chemin « même requête que le tirage » (soumission refusée / exception).
create or replace function public.release_reservation(p_user uuid, p_op uuid, p_cost integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rem integer; v_c integer := greatest(1, coalesce(p_cost, 1));
begin
  update public.credit_ops
     set reserved_remaining = least(amount, coalesce(reserved_remaining, amount) + v_c)
   where id = p_op and user_id = p_user and refunded_at is null
   returning reserved_remaining into v_rem;
  return v_rem;
end $$;

-- Libération / règlement PAR JOB : seul le job LIÉ à l'op peut la rendre ou la régler.
create or replace function public.release_by_job(p_user uuid, p_job text, p_cost integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_c integer := greatest(1, coalesce(p_cost, 1));
begin
  if p_job is null or length(p_job) = 0 then return null; end if;
  update public.credit_ops
     set reserved_remaining = least(amount, coalesce(reserved_remaining, amount) + v_c)
   where user_id = p_user and provider_job = p_job and refunded_at is null
   returning id into v_id;
  return v_id;
end $$;

create or replace function public.settle_by_job(p_user uuid, p_job text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_job is null or length(p_job) = 0 then return null; end if;
  update public.credit_ops set settled_at = coalesce(settled_at, now())
   where user_id = p_user and provider_job = p_job and refunded_at is null
   returning id into v_id;
  return v_id;
end $$;

create or replace function public.settle_reservation(p_user uuid, p_op uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  update public.credit_ops set settled_at = coalesce(settled_at, now())
   where id = p_op and user_id = p_user and refunded_at is null
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Remboursement = RÉSERVE RESTANTE. Refusé si une étape est en cours (tirée, rien de livré) ou s'il ne reste rien.
create or replace function public.refund_credits(p_op_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_op public.credit_ops%rowtype; v_new integer; v_res integer; v_bought integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_op from public.credit_ops where id = p_op_id and user_id = auth.uid() for update;
  if not found then                                    return jsonb_build_object('ok', false, 'reason', 'unknown_op');        end if;
  if v_op.refunded_at is not null then                 return jsonb_build_object('ok', false, 'reason', 'already_refunded');  end if;
  if v_op.created_at < now() - interval '2 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old');           end if;
  v_res := coalesce(v_op.reserved_remaining, v_op.amount);
  if v_res < v_op.amount and v_op.settled_at is null then
                                                       return jsonb_build_object('ok', false, 'reason', 'in_progress');       end if;
  if v_res <= 0 then                                   return jsonb_build_object('ok', false, 'reason', 'already_delivered'); end if;
  update public.credit_ops set refunded_at = now(), reserved_remaining = 0 where id = v_op.id;
  v_bought := least(coalesce(v_op.bought_part, 0), floor(coalesce(v_op.bought_part, 0)::numeric * v_res / greatest(v_op.amount, 1))::int);
  update public.profiles
     set credits_remaining = coalesce(credits_remaining, 0) + v_res,
         bought_credits    = coalesce(bought_credits, 0) + v_bought
   where id = auth.uid() returning credits_remaining into v_new;
  return jsonb_build_object('ok', true, 'balance', v_new, 'refunded', v_res, 'partial', v_res < v_op.amount);
end;
$function$;

revoke all on function public.resolve_op(uuid, uuid) from public, anon, authenticated;
revoke all on function public.draw_reservation(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.draw_full_reservation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.bind_reservation_job(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_reservation(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_by_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.settle_by_job(uuid, text) from public, anon, authenticated;
revoke all on function public.settle_reservation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_op(uuid, uuid) to service_role;
grant execute on function public.draw_reservation(uuid, uuid, integer) to service_role;
grant execute on function public.draw_full_reservation(uuid, uuid) to service_role;
grant execute on function public.bind_reservation_job(uuid, uuid, text) to service_role;
grant execute on function public.release_reservation(uuid, uuid, integer) to service_role;
grant execute on function public.release_by_job(uuid, text, integer) to service_role;
grant execute on function public.settle_by_job(uuid, text) to service_role;
grant execute on function public.settle_reservation(uuid, uuid) to service_role;
