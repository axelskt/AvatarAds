-- #123 · Idempotence du webhook de paiement (appliqué le 19/07/2026)
--
-- Whop (Svix) REJOUE un webhook tant qu'il n'a pas reçu de 2xx : timeout, erreur
-- réseau, ou l'un des `return 500` du handler. Or l'achat d'un PACK de crédits
-- INCRÉMENTE le solde (credits_remaining + pack.credits) : un rejeu créditait
-- DEUX FOIS pour un seul paiement.
-- Les abonnements, eux, FIXENT le solde (= sub.credits + …) → déjà idempotents.
--
-- webhook_events ne servait que de journal. On lui ajoute l'identifiant Svix +
-- un index unique : la 2e insertion du même événement échoue, ce qui sert de
-- verrou (le handler sort alors en 200 sans rien recréditer).
--
-- Testé : 1er envoi accepté · rejeu rejeté par l'index unique · autre paiement accepté.
alter table public.webhook_events add column if not exists event_id text;
create unique index if not exists webhook_events_event_id_key
  on public.webhook_events (event_id) where event_id is not null;
