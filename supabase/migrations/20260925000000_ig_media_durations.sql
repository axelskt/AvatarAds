-- Creative Factory v2 (25/09/2026, demande d'Axel) : durée des reels dont Instagram ne donne pas le fichier
-- (media_url absent quand la musique est sous droits) → saisie une fois dans la fiche par le propriétaire.
-- Lue par ig-insights (service role) quand la durée n'a pas pu être mesurée à la transcription.
create table if not exists public.ig_media_durations (
  ig_media_id text primary key,
  duration_s  numeric not null check (duration_s > 0 and duration_s <= 900),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.ig_media_durations enable row level security;   -- aucune policy : lecture ig-insights, écriture RPC
revoke all on table public.ig_media_durations from anon, authenticated;

create or replace function public.ig_media_duration_set(p_media text, p_seconds numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select (coalesce(is_owner,false) or lower(coalesce(plan,''))='developer') into ok from public.profiles where id = auth.uid();
  if not coalesce(ok,false) then return jsonb_build_object('error','forbidden'); end if;
  if p_media is null or p_media !~ '^[0-9]{5,30}$' then return jsonb_build_object('error','publication inconnue'); end if;
  if p_seconds is null or p_seconds = 0 then
    delete from public.ig_media_durations where ig_media_id = p_media;
    return jsonb_build_object('ok', true, 'duration_s', null);
  end if;
  if p_seconds < 0 or p_seconds > 900 then return jsonb_build_object('error','durée entre 1 et 900 s'); end if;
  insert into public.ig_media_durations(ig_media_id, duration_s, updated_at, updated_by)
  values (p_media, round(p_seconds, 1), now(), auth.uid())
  on conflict (ig_media_id) do update set duration_s = excluded.duration_s, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true, 'duration_s', round(p_seconds, 1));
end $$;
revoke execute on function public.ig_media_duration_set(text, numeric) from public, anon;
grant execute on function public.ig_media_duration_set(text, numeric) to authenticated;
