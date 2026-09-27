-- Audit sécurité Express du 28/09/2026 — failles MOYENNES (stockage, remboursements MCP).

-- 1) Remboursement MCP : la part payée en crédits de PACK (bought_credits) était perdue — mcp_spend_credits prend les achetés
--    d'abord, mcp_refund_credits ne rendait que credits_remaining → chaque remboursement convertissait des crédits de pack
--    en crédits de plan (effacés au renouvellement). Chaque débit MCP est désormais noté avec sa part achetée ; le remboursement
--    retrouve le débit (même utilisateur, non remboursé, montant ≥, 2 jours, le plus récent de même montant d'abord) et rend
--    aussi cette part. Aucun changement de signature : les 8 appelants du MCP restent identiques.
create table if not exists public.mcp_debits (
  id         bigserial primary key,
  user_id    uuid not null,
  amount     integer not null,
  bought     integer not null default 0,
  refunded   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mcp_debits_user_open on public.mcp_debits (user_id, refunded, created_at desc);
alter table public.mcp_debits enable row level security;   -- aucune policy : service_role seulement
revoke all on public.mcp_debits from public, anon, authenticated;

create or replace function public.mcp_spend_credits(p_user uuid, p_secs integer)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_new integer; v_b integer;
begin
  if p_secs is null or p_secs <= 0 or p_secs > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    return coalesce(v_row.credits_remaining, 0);
  end if;
  if coalesce(v_row.credits_remaining,0) < p_secs then return -1; end if;
  v_b := least(greatest(coalesce(v_row.bought_credits,0), 0), p_secs);
  -- achetés d'abord, puis le plan
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) - p_secs,
         bought_credits    = greatest(0, coalesce(bought_credits,0) - p_secs)
   where id = p_user returning credits_remaining into v_new;
  insert into public.mcp_debits (user_id, amount, bought) values (p_user, p_secs, v_b);
  return v_new;
end; $function$;

create or replace function public.mcp_refund_credits(p_user uuid, p_secs integer)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_row public.profiles%rowtype; v_new integer; v_d public.mcp_debits%rowtype; v_rb integer := 0;
begin
  if p_secs is null or p_secs <= 0 or p_secs > 3600 then raise exception 'invalid_amount'; end if;
  select * into v_row from public.profiles where id = p_user for update;
  if not found then raise exception 'no_profile'; end if;
  if lower(coalesce(v_row.plan,'')) = 'developer' or coalesce(v_row.is_owner,false) then
    return coalesce(v_row.credits_remaining, 0);
  end if;
  select * into v_d from public.mcp_debits
   where user_id = p_user and not refunded and amount >= p_secs and created_at > now() - interval '2 days'
   order by (amount = p_secs) desc, created_at desc limit 1 for update skip locked;
  if found then
    update public.mcp_debits set refunded = true where id = v_d.id;
    v_rb := least(v_d.bought, p_secs);
  end if;
  update public.profiles
     set credits_remaining = coalesce(credits_remaining,0) + p_secs,
         bought_credits    = coalesce(bought_credits,0) + v_rb,
         mcp_day_spent     = greatest(0, coalesce(mcp_day_spent,0) - p_secs)
   where id = p_user returning credits_remaining into v_new;
  return v_new;
end; $function$;
revoke all on function public.mcp_spend_credits(uuid, integer)  from public, anon, authenticated;
revoke all on function public.mcp_refund_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.mcp_spend_credits(uuid, integer)  to service_role;
grant execute on function public.mcp_refund_credits(uuid, integer) to service_role;

-- 2) Bibliothèque : supprimer un élément (ou la purge des 30 jours) n'effaçait PAS le fichier — aucune policy DELETE sur
--    render-media. Chacun ne peut supprimer que dans SON dossier <uid>/.
drop policy if exists render_media_user_delete on storage.objects;
create policy render_media_user_delete on storage.objects for delete to authenticated
  using (bucket_id = 'render-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3) Limites des buckets. render-media (privé) : 500 Mo par fichier (plafond du projet, plus gros fichier actuel 268 Mo).
--    mcp-media (PUBLIC) : 100 Mo et types attendus seulement (plus gros fichier actuel 33 Mo) → plus d'hébergement
--    arbitraire (HTML, SVG…) sur le domaine du projet.
update storage.buckets set file_size_limit = 524288000 where id = 'render-media';
update storage.buckets set file_size_limit = 104857600,
  allowed_mime_types = array['video/mp4','image/png','image/jpeg','image/webp','audio/wav','audio/wave','audio/x-wav','audio/mpeg']
  where id = 'mcp-media';

-- 4) library_items : le client insère lui-même storage_path et thumb → chemin dans SON dossier, vignette bornée (1,5 Mo).
--    NOT VALID : s'applique aux nouvelles lignes (2 anciennes vignettes de 3 Mo restent lisibles).
alter table public.library_items drop constraint if exists li_path_own;
alter table public.library_items add constraint li_path_own check (storage_path is null or storage_path like user_id::text || '/%') not valid;
alter table public.library_items drop constraint if exists li_thumb_len;
alter table public.library_items add constraint li_thumb_len check (thumb is null or length(thumb) <= 1500000) not valid;
