-- Audit Express 28/09 (#14) — image de départ d'Express : UNE SEULE payée par op, relances sûres.
--
-- Avant : l'app relance l'image de départ sur 5xx / 429 / délai, toujours sur la même op (x-aa-chain: omni-start). Si le
-- 1er appel avait abouti côté serveur mais que la réponse s'était perdue (504 de la passerelle), la relance tirait 3 de plus
-- et omni_start_add refusait la 2e remise → réserve = 5 × durée − 6 alors que la vidéo en exige 5 × durée − 3 → 402, vidéo
-- refusée alors que le client avait payé.
--
-- Maintenant (openai-proxy) :
--   omni_start_claim     avant le tirage : 'paid' (1re image : tirage normal), 'free' (relance d'une image payée ou en cours :
--                        aucun tirage, 2 max, seulement tant que la réserve de la vidéo est là), 'deny' (409).
--   omni_start_done      image payée livrée : pose la remise (paid = 2), sauf si une relance l'a déjà posée → 'kept'.
--   omni_start_fail      image payée en échec : 'release' (on rend le tiré, paid = 0) sauf si une relance livrée s'appuie
--                        déjà sur ce tirage (paid = 2) → 'keep' (on ne rend rien).
--   omni_start_free_done relance livrée : rien si déjà payée ; si la payée est EN COURS, son tirage paiera (paid = 2) ; si
--                        elle a échoué et a été rendue, la relance tire elle-même son prix → jamais d'image offerte par un
--                        échec provoqué.
-- Une seule remise, un seul tirage d'image par op, quel que soit l'ordre d'arrivée. Ops non Express : comportement inchangé.
-- omni_start_add reste en place (repli si ces fonctions manquent). Service_role seulement.

alter table public.credit_ops add column if not exists omni_start_paid smallint not null default 0;   -- 0 aucune, 1 en cours, 2 payée
alter table public.credit_ops add column if not exists omni_start_free smallint not null default 0;   -- relances gratuites consommées

create or replace function public.omni_start_claim(p_user uuid, p_op uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.credit_ops%rowtype;
begin
  select * into v from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found or v.reason not in ('express-omni', 'express') or v.refunded_at is not null
     or v.created_at < now() - interval '2 hours' then return 'paid'; end if;
  if v.omni_start_paid = 0 and v.omni_start_img = 0 then
    update public.credit_ops set omni_start_paid = 1 where id = p_op;
    return 'paid';
  end if;
  if v.omni_start_free < 2 and coalesce(v.reserved_remaining, v.amount) >= 3 then
    update public.credit_ops set omni_start_free = v.omni_start_free + 1 where id = p_op;
    return 'free';
  end if;
  return 'deny';
end $$;

create or replace function public.omni_start_done(p_user uuid, p_op uuid, p_cost integer)
returns text language plpgsql security definer set search_path = public as $$
declare v public.credit_ops%rowtype;
begin
  select * into v from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found or v.reason not in ('express-omni', 'express') or v.refunded_at is not null
     or v.created_at < now() - interval '2 hours' then return 'na'; end if;
  if v.omni_start_paid = 2 then return 'kept'; end if;
  update public.credit_ops set omni_start_paid = 2, omni_start_img = least(3, greatest(1, coalesce(p_cost, 1))) where id = p_op;
  return 'posted';
end $$;

create or replace function public.omni_start_fail(p_user uuid, p_op uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.credit_ops%rowtype;
begin
  select * into v from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found or v.reason not in ('express-omni', 'express') then return 'release'; end if;
  if v.omni_start_paid = 2 then return 'keep'; end if;
  update public.credit_ops set omni_start_paid = 0 where id = p_op and omni_start_paid = 1;
  return 'release';
end $$;

create or replace function public.omni_start_free_done(p_user uuid, p_op uuid, p_cost integer)
returns text language plpgsql security definer set search_path = public as $$
declare v public.credit_ops%rowtype; c integer := least(3, greatest(1, coalesce(p_cost, 1)));
begin
  select * into v from public.credit_ops where id = p_op and user_id = p_user for update;
  if not found or v.reason not in ('express-omni', 'express') or v.refunded_at is not null then return 'free'; end if;
  if v.omni_start_paid = 2 or v.omni_start_img > 0 then return 'free'; end if;   -- déjà payée (ou op d'avant cette migration)
  if v.omni_start_paid = 1 then                                                   -- la payée est en cours : son tirage paie
    update public.credit_ops set omni_start_paid = 2, omni_start_img = c, settled_at = coalesce(settled_at, now()) where id = p_op;
    return 'posted_by_paid';
  end if;
  if coalesce(v.reserved_remaining, v.amount) >= c then                           -- la payée a échoué et a été rendue
    update public.credit_ops
       set omni_start_paid = 2, omni_start_img = c, reserved_remaining = coalesce(reserved_remaining, amount) - c,
           settled_at = coalesce(settled_at, now())
     where id = p_op;
    return 'drawn';
  end if;
  return 'free';
end $$;

revoke all on function public.omni_start_claim(uuid, uuid)              from public, anon, authenticated;
revoke all on function public.omni_start_done(uuid, uuid, integer)      from public, anon, authenticated;
revoke all on function public.omni_start_fail(uuid, uuid)               from public, anon, authenticated;
revoke all on function public.omni_start_free_done(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.omni_start_claim(uuid, uuid)              to service_role;
grant execute on function public.omni_start_done(uuid, uuid, integer)      to service_role;
grant execute on function public.omni_start_fail(uuid, uuid)               to service_role;
grant execute on function public.omni_start_free_done(uuid, uuid, integer) to service_role;
notify pgrst, 'reload schema';
