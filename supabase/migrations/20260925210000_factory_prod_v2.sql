-- Creative Factory v2 · onglet Production (étape 4, Axel 25/09/2026).
--
-- 1) factory_qc.classified_at : bouton « Classer » sur une vidéo refusée (maquette §13 : l'alerte de l'Accueil ne compte que
--    les refus NON classés). Écrit par le dashboard avec la policy UPDATE owner/dev déjà en place sur factory_qc : rien
--    d'autre à ouvrir. Ancienne ligne (refus « Test » du 19/09) : classified_at null = « à classer ».
-- 2) factory_prod_stats() : factory_variants et factory_missions ont la RLS SANS policy (illisibles côté client, voulu).
--    Cette RPC en rend un RÉSUMÉ, réservé owner / plan developer (même garde qu'ig_dm_stats_v2 et factory_access) :
--      · variants : nombre de lignes, paires DISTINCTES (avatar_id, brick_id) → « variantes générées » de la jauge
--        Capacité de création (variante = 1 avatar × 1 brique parlée) ;
--      · missions : total et compte par statut (TrackAds, Phase 3 : 0 ligne aujourd'hui).
--    Ces deux tables ont été créées hors migrations : on les lit par to_jsonb(ligne) plutôt que par nom de colonne, pour
--    qu'une colonne absente donne null (compté « inconnu ») au lieu de casser toute la RPC.
-- Jamais exécutable par anon. Ne renvoie aucune URL ni donnée de personne.

alter table public.factory_qc add column if not exists classified_at timestamptz;
comment on column public.factory_qc.classified_at is
  'Refus classé par le propriétaire (bouton « Classer » du dashboard Creative Factory v2). null = refus à classer.';

create or replace function public.factory_prod_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  v_var jsonb;
  v_mis jsonb;
begin
  select (coalesce(is_owner, false) or lower(coalesce(plan, '')) = 'developer') into ok
  from public.profiles where id = auth.uid();
  if not coalesce(ok, false) then return jsonb_build_object('error', 'forbidden'); end if;

  with v as (select to_jsonb(t) as j from public.factory_variants t),
       p as (select distinct j->>'avatar_id' as a, j->>'brick_id' as b from v
             where coalesce(j->>'avatar_id', '') <> '' and coalesce(j->>'brick_id', '') <> '')
  select jsonb_build_object(
    'rows', (select count(*) from v),
    'pairs_total', (select count(*) from p),
    'pairs', coalesce((select jsonb_agg(jsonb_build_array(q.a, q.b) order by q.a, q.b)
                       from (select a, b from p order by a, b limit 5000) q), '[]'::jsonb)
  ) into v_var;

  with m as (select coalesce(nullif(to_jsonb(t)->>'status', ''), 'inconnu') as st from public.factory_missions t)
  select jsonb_build_object(
    'total', (select count(*) from m),
    'by_status', coalesce((select jsonb_object_agg(s.st, s.n) from (select st, count(*) as n from m group by st) s), '{}'::jsonb)
  ) into v_mis;

  return jsonb_build_object('variants', v_var, 'missions', v_mis, 'at', now());
end $$;

revoke execute on function public.factory_prod_stats() from public, anon;
grant execute on function public.factory_prod_stats() to authenticated;
