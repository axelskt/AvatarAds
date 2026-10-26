-- 26/10 (Axel) : langue des e-mails = langue de l'app utilisée (/app/ = français, /en/app/ = anglais).
-- profiles.lang ('fr' par défaut) posée par set_my_lang (l'app à l'ouverture, auth-otp pour un compte créé depuis la
-- connexion anglaise) ; lue par email-drip, whop-webhook, paiement-compte et les autres envois.
alter table public.profiles add column if not exists lang text not null default 'fr';
do $$ begin
  alter table public.profiles add constraint profiles_lang_check check (lang in ('fr', 'en'));
exception when duplicate_object then null; end $$;

-- profiles_guard bloque toute colonne hors liste pour anon / authenticated : la langue passe par cette RPC (valeur bornée)
create or replace function public.set_my_lang(p_lang text) returns void
language sql security definer set search_path = public as $$
  update public.profiles set lang = p_lang
   where id = auth.uid() and p_lang in ('fr', 'en') and lang is distinct from p_lang;
$$;
revoke all on function public.set_my_lang(text) from public, anon;
grant execute on function public.set_my_lang(text) to authenticated;
