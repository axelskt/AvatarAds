-- BloxAI a désormais son propre projet Supabase (rlkcyrldkwutyjymjcxi) : la liste d'attente y vit (table waitlist).
-- L'ancienne table du projet AvatarAds n'a jamais reçu d'inscription ; on la retire (refus si elle n'est pas vide).
do $$ begin
  if exists (select 1 from public.bloxai_waitlist) then raise exception 'bloxai_waitlist n''est pas vide : migrer avant de supprimer'; end if;
end $$;
drop table public.bloxai_waitlist;
