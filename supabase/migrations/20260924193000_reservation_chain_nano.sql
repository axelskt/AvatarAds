-- Palier « 4K » d'Images IA (24/09/2026) : 5 crédits par image = gpt-image MEDIUM puis upscale Nano Banana Pro 4K.
-- Sous RESERVE_ENFORCE=1 le serveur tirait 3 (gpt medium) puis 5 (Nano) sur une op de 5 → Nano refusé (402) en
-- silence, le client gardait l'image gpt sans 4K. Correctif sans toucher au prix :
--   · openai-proxy, appel gpt marqué x-aa-chain: nano4k (medium/low, n=1) → tire 5 (le palier entier) et, s'il réussit,
--     crédite l'op d'UN droit d'upscale (chain_nano + 1) ;
--   · google-ai-proxy, appel Nano → consomme d'abord un droit (tirage 0), sinon tire ses 5 comme avant ;
--     Nano en échec → le droit est rendu.
-- Invariant : un droit n'existe que pour un appel gpt réussi payé 5 → jamais plus d'appels Nano que de paliers payés.
alter table public.credit_ops add column if not exists chain_nano integer not null default 0;

create or replace function public.chain_credit_add(p_user uuid, p_op uuid, p_n integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  update public.credit_ops
     set chain_nano = chain_nano + greatest(1, least(coalesce(p_n, 1), 10))
   where id = p_op and user_id = p_user and refunded_at is null and amount > 0
     and created_at > now() - interval '2 hours'
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Prend UN droit (op la plus récente de l'utilisateur, < 2 h, non remboursée) ; renvoie l'op ou null.
create or replace function public.chain_credit_take(p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_op uuid;
begin
  update public.credit_ops
     set chain_nano = chain_nano - 1
   where id = (select id from public.credit_ops
                where user_id = p_user and refunded_at is null and chain_nano > 0
                  and created_at > now() - interval '2 hours'
                order by created_at desc
                limit 1
                for update skip locked)
     and chain_nano > 0
  returning id into v_op;
  return v_op;
end $$;

create or replace function public.chain_credit_give_back(p_user uuid, p_op uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean := false;
begin
  update public.credit_ops set chain_nano = chain_nano + 1
   where id = p_op and user_id = p_user and refunded_at is null
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- Service seulement (les proxies) : jamais appelables par un client.
revoke execute on function public.chain_credit_add(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.chain_credit_take(uuid) from public, anon, authenticated;
revoke execute on function public.chain_credit_give_back(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chain_credit_add(uuid, uuid, integer) to service_role;
grant execute on function public.chain_credit_take(uuid) to service_role;
grant execute on function public.chain_credit_give_back(uuid, uuid) to service_role;
