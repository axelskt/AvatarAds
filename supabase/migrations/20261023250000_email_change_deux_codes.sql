-- 23/10/2026 (Axel) : changement d'adresse en DEUX codes. 1) code envoyé à l'adresse ACTUELLE (preuve que c'est bien le
-- titulaire du compte, pas une simple session) ; 2) code envoyé à la NOUVELLE adresse (preuve qu'elle lui appartient).
-- auth-otp : email_change_send (étape « ancienne ») → email_change_verify_old → email_change_send_new / email_change_verify
-- (étape « nouvelle », seule à changer l'adresse). Les codes déjà en cours restent « nouvelle » (comportement d'avant).
alter table public.email_change_codes add column if not exists etape text not null default 'nouvelle';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_change_codes_etape_check') then
    alter table public.email_change_codes add constraint email_change_codes_etape_check check (etape in ('ancienne', 'nouvelle'));
  end if;
end $$;
