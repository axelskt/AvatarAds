-- Le projet TrackAds s'appelle BloxAI (Axel 15/10) : table d'inscriptions renommée.
alter table if exists public.trackads_waitlist rename to bloxai_waitlist;
alter index if exists public.trackads_waitlist_email rename to bloxai_waitlist_email;
alter policy trackads_waitlist_insert on public.bloxai_waitlist rename to bloxai_waitlist_insert;
notify pgrst, 'reload schema';
