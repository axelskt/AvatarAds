-- Dashboard Creative Factory v2 (24/09/2026) : contrôle d'accès LÉGER et dédié.
-- Avant, la préprod testait l'accès via factory_ops_stats() : une RPC lourde (somme sur factory_missions, qui peut
-- lever une erreur sur une valeur non entière et bloquer TOUT le dashboard) et vouée à disparaître après la bascule.
-- Même critère que les edge functions : is_owner OU plan developer (insensible à la casse). Renvoie {ok:true} ou
-- {error:'forbidden'} ; jamais exécutable par anon.
create or replace function public.factory_access()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean;
begin
  select (coalesce(is_owner, false) or lower(coalesce(plan, '')) = 'developer') into ok
  from public.profiles where id = auth.uid();
  if not coalesce(ok, false) then return jsonb_build_object('error', 'forbidden'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.factory_access() from public, anon;
grant execute on function public.factory_access() to authenticated;
