-- ══════════════════════════════════════════════════════
-- AvatarAds — Setup Webhook LemonSqueezy
-- À coller et exécuter dans Supabase → SQL Editor → Run
-- ══════════════════════════════════════════════════════

-- 1. Table pour stocker les paiements en attente de compte
-- (quand quelqu'un paie avant d'avoir créé son compte)
CREATE TABLE IF NOT EXISTS pending_activations (
  email     TEXT PRIMARY KEY,
  product   TEXT NOT NULL DEFAULT 'avatarads',
  plan      TEXT NOT NULL DEFAULT 'starter',
  credits   INTEGER NOT NULL DEFAULT 300,
  paid_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied   BOOLEAN NOT NULL DEFAULT FALSE
);

-- Seul le service role peut lire/écrire cette table
ALTER TABLE pending_activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_only" ON pending_activations
  USING (false);  -- personne ne peut lire via le client public

-- 2. Ajouter la colonne email dans profiles si absente
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- Remplir l'email depuis auth.users pour les comptes existants
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- 3. Trigger : à chaque nouvel utilisateur inscrit,
--    vérifie s'il a un paiement en attente et active son plan
CREATE OR REPLACE FUNCTION apply_pending_activation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending pending_activations%ROWTYPE;
BEGIN
  -- Cherche un paiement en attente pour cet email
  SELECT * INTO pending
  FROM pending_activations
  WHERE email = LOWER(NEW.email) AND applied = FALSE
  LIMIT 1;

  IF FOUND THEN
    -- Met à jour le profil avec le plan payé
    UPDATE profiles SET
      plan              = pending.plan,
      credits_remaining = pending.credits,
      email             = LOWER(NEW.email)
    WHERE id = NEW.id;

    -- Marque comme appliqué
    UPDATE pending_activations
    SET applied = TRUE
    WHERE email = LOWER(NEW.email);

    RAISE LOG 'Activation appliquée pour % → plan: %, produit: %',
      NEW.email, pending.plan, pending.product;
  ELSE
    -- Pas de paiement en attente → compte gratuit normal
    -- (le trigger existant a déjà créé le profil avec plan=free)
    UPDATE profiles SET email = LOWER(NEW.email) WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Attache le trigger sur auth.users (déclenché après chaque INSERT)
DROP TRIGGER IF EXISTS on_auth_user_created_check_pending ON auth.users;
CREATE TRIGGER on_auth_user_created_check_pending
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION apply_pending_activation();

-- 4. (Optionnel) Vérification : liste les activations en attente
-- SELECT * FROM pending_activations WHERE applied = FALSE;
