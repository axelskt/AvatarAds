-- Audit métier 14/09 — anti auto-parrainage. Persiste l'IP d'inscription (aujourd'hui uniquement dans otp_codes.ip,
-- purgée à 24 h et jamais liée à un user_id) pour flaguer les paires parrain↔filleul créées sur la même IP.
-- Colonne NON écrivable par le client (aucun GRANT UPDATE dessus ; posée seulement par auth-otp en service_role).
alter table public.profiles add column if not exists signup_ip text;
