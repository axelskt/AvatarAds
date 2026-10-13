-- 13/10 (Axel : « prends juste la moyenne des 7 derniers jours Instagram, ça suffit ») : rythme de publication RÉEL pour la
-- prévision de stock de Factory V2 = reels réellement publiés sur Instagram (ig_media_stats, relevé chaque soir par
-- ig-insights, nos comptes seulement), sur les 7 derniers jours COMPLETS (jour de Paris, aujourd'hui exclu), ÷ 7.
-- Ni les programmations du kit, ni l'objectif : ce qu'Instagram a publié. Propriétaire / developer seulement (même garde
-- que ig_dashboard_stats) ; service_role pour les tests.
create or replace function public.factory_ig_rhythm()
returns jsonb language plpgsql security definer set search_path = public as $$
declare ok boolean; d1 date := (now() at time zone 'Europe/Paris')::date - 1; d0 date := d1 - 6; n integer; by_day jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    select coalesce(is_owner, false) or plan = 'developer' into ok from profiles where id = auth.uid();
    if not coalesce(ok, false) then return jsonb_build_object('error', 'forbidden'); end if;
  end if;
  select count(distinct media_id)::int into n from ig_media_stats
   where (posted_at at time zone 'Europe/Paris')::date between d0 and d1;
  select coalesce(jsonb_object_agg(d, c), '{}'::jsonb) into by_day from (
    select (posted_at at time zone 'Europe/Paris')::date::text d, count(distinct media_id)::int c from ig_media_stats
     where (posted_at at time zone 'Europe/Paris')::date between d0 and d1 group by 1) s;
  return jsonb_build_object('posts', n, 'per_day', round(n / 7.0, 2), 'from', d0, 'to', d1, 'by_day', by_day,
    'last_read', (select max(fetched_at) from ig_media_stats));
end $$;
revoke all on function public.factory_ig_rhythm() from public, anon;
grant execute on function public.factory_ig_rhythm() to authenticated, service_role;
