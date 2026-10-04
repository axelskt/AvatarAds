-- Console de démonstration Instagram (App Review Meta, 04/10/2026) : sessions de courte durée.
-- Meta a refusé instagram_business_manage_messages et instagram_business_manage_comments (vidéo ne montrant ni l'envoi d'un
-- message depuis l'app, ni la création / modification / suppression de commentaires). La page ig-review.html gagne une
-- console (edge ig-console) qui fait ces actions sur le compte qui vient de se connecter.
-- Depuis l'audit du 02/10, la connexion du relecteur n'enregistre RIEN (ni ig_accounts, ni webhooks). La console a pourtant
-- besoin du jeton de ce compte : il est gardé ici, côté serveur seulement, 3 heures, sous un identifiant aléatoire remis au
-- seul navigateur qui vient de terminer l'OAuth (instagram-auth, action exchange). Jamais lisible par un client.
-- Rejouable (if not exists, revoke + grant explicites). Privilèges par défaut fermés : service_role seul.

create table if not exists public.ig_review_sessions (
  id            text        primary key,                 -- 32 octets aléatoires (base64url), remis au navigateur
  ig_user_id    text,                                    -- id professionnel du compte (peut être vide)
  username      text,
  access_token  text        not null,                    -- jeton long du compte connecté (jamais renvoyé)
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists ig_review_sessions_exp on public.ig_review_sessions (expires_at);

alter table public.ig_review_sessions enable row level security;
alter table public.ig_review_sessions force row level security;
revoke all on table public.ig_review_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.ig_review_sessions to service_role;

notify pgrst, 'reload schema';
