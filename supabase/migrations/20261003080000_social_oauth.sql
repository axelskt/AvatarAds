-- Audit 02/10 (P2, « social ») : plus aucun accès client aux jetons TikTok / Instagram.
--
-- Constat (catalogue prod du 03/10) :
--  - tiktok_accounts : RLS active, une seule policy « tiktok_accounts_owner_select » (SELECT, rôle public, owner ou
--    developer) et les droits de table par défaut pour anon / authenticated → un owner ou un developer connecté pouvait
--    lire access_token ET refresh_token (365 j) depuis le navigateur, par l'API REST.
--  - ig_accounts : RLS active, aucune policy (aucune ligne lisible) mais droits de table par défaut, access_token compris.
-- Usages recensés (grep du dépôt + catalogue) : AUCUN code client ne lit ces tables. factory.html et factory-v2 passent
-- par les edges tiktok-auth / instagram-auth (?action=accounts, service role, jamais de jeton renvoyé) ; seuls
-- tiktok-auth, instagram-auth, ig-insights et _shared/igacct.ts y accèdent, avec la clé service. Aucune fonction SQL,
-- vue, trigger ni publication ne les référence.
-- Correctif :
--  - tiktok_accounts : retrait de TOUS les droits client, puis SELECT rendu au seul rôle authenticated sur les colonnes
--    sans secret (liste blanche explicite) ; la policy owner/developer, recréée « to authenticated », filtre toujours les
--    lignes. Une colonne ajoutée plus tard n'est donc jamais lisible côté client sans un grant explicite.
--  - ig_accounts : retrait de tous les droits client (rien ne s'en sert, la RLS sans policy reste en place).
--  - service_role : inchangé (droits réaffirmés).
-- Idempotent (revoke / grant rejouables, policy recréée) ; sans effet si une table n'existe pas (base locale vierge :
-- ces deux tables ont été créées hors migrations).

do $$
declare
  cols text;
begin
  if to_regclass('public.tiktok_accounts') is not null then
    execute 'revoke all on table public.tiktok_accounts from anon, authenticated, public';
    execute 'grant all on table public.tiktok_accounts to service_role';
    select string_agg(quote_ident(column_name), ', ' order by column_name) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = 'tiktok_accounts'
       and column_name in ('open_id', 'display_name', 'avatar_url', 'scope', 'expires_at', 'refresh_expires_at',
                           'created_at', 'updated_at');
    if cols is not null then
      execute 'grant select (' || cols || ') on table public.tiktok_accounts to authenticated';
    end if;
    execute 'alter table public.tiktok_accounts enable row level security';
    execute 'drop policy if exists tiktok_accounts_owner_select on public.tiktok_accounts';
    execute $p$create policy tiktok_accounts_owner_select on public.tiktok_accounts
      for select to authenticated
      using (exists (select 1 from public.profiles p
                      where p.id = auth.uid() and (p.is_owner or lower(p.plan) = 'developer')))$p$;
  else
    raise notice 'social_oauth : public.tiktok_accounts absente, rien à faire';
  end if;

  if to_regclass('public.ig_accounts') is not null then
    execute 'revoke all on table public.ig_accounts from anon, authenticated, public';
    execute 'grant all on table public.ig_accounts to service_role';
    execute 'alter table public.ig_accounts enable row level security';
  else
    raise notice 'social_oauth : public.ig_accounts absente, rien à faire';
  end if;
end
$$;
