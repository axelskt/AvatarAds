-- Audit sécurité du 02/10 — P0.
--
-- 1) Inscription par MOT DE PASSE bloquée en base. L'app ne crée JAMAIS de compte par /auth/v1/signup : les comptes
--    naissent par le code e-mail (auth-otp → admin.createUser SANS mot de passe) ou par Google (pas de mot de passe).
--    Avec l'auto-confirmation des e-mails active, /signup permettait de créer un compte confirmé sur l'adresse de
--    quelqu'un d'autre (la vraie personne arrivait ensuite dans ce compte par le code e-mail, et ses achats Whop y
--    étaient rattachés). Mesuré avant la migration : 0 compte créé hors code e-mail / Google depuis le 15/09, et aucun
--    compte créé par code n'a de mot de passe → ce blocage ne casse aucun parcours. Poser un mot de passe PLUS TARD
--    (Mon compte → updateUser) reste possible : seul l'INSERT est contrôlé.
-- 2) Cron ig-followup : envoie désormais x-cron-key (même secret Vault que reconcile-kie) — la fonction l'exige.

create or replace function public.block_password_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.encrypted_password, '') <> '' then
    raise exception 'inscription par mot de passe désactivée — connexion par code e-mail ou Google';
  end if;
  return new;
end $$;
revoke all on function public.block_password_signup() from public, anon, authenticated;

drop trigger if exists block_password_signup on auth.users;
create trigger block_password_signup before insert on auth.users
  for each row execute function public.block_password_signup();

select cron.alter_job(
  (select jobid from cron.job where jobname = 'ig-followup-hourly'),
  command := $cmd$
  select net.http_post(
    url := 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/ig-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'email_drip_cron_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cmd$);
