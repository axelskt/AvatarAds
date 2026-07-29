---
name: deploiement
description: Où part quoi quand on pousse — app et LP sur GitHub Pages, edge functions sur Supabase, render-worker sur Railway, paiements chez Whop. À lire avant de livrer une modification, et quand « c'est poussé mais je ne vois rien ». Contient les pièges qui font croire à un bug alors que le déploiement n'a simplement pas eu lieu.
---

# Déploiement

Quatre cibles, trois mécaniques différentes. Savoir laquelle bouge évite de
chercher un bug dans du code qui n'est pas encore en ligne.

| Ce qu'on modifie | Part comment | Délai |
|---|---|---|
| `app/index.html`, la LP | **GitHub Pages**, au push sur `main` | ~1 min |
| `supabase/functions/*` | **commande explicite** — le push ne déploie rien | ~30 s |
| `render-worker/**` | **Railway**, au push sur `main` (watch du dossier) | ~2-4 min |
| plans, prix, checkout | **Whop** (IDs de plans dans `app/index.html`) | immédiat |

```bash
supabase functions deploy orchestrate --project-ref guvwgiejzkiodghywpwj
```

La CLI est connectée. **Une edge function modifiée et poussée n'est PAS en ligne** —
c'est l'erreur la plus coûteuse du lot, parce que le code source dit une chose et
la production en fait une autre.

## Les pièges qui font perdre une heure

- **Le cache Safari.** L'app est un fichier unique servi par Pages : Safari le garde.
  Quand une correction « ne marche pas » chez Axel : Développement → Vider les caches.
  Toujours écarter ça avant de rouvrir le code.
- **Tester un appel RÉEL après un deploy d'`orchestrate`.** Une erreur de schéma
  (grammaire stricte Anthropic) ne se voit qu'à l'exécution, jamais à la compilation.
- **Railway ne redéploie que si `render-worker/**` a changé.** Une correction dans
  `app/` qui dépendait du worker ne bouge rien côté rendu.
- **Un `GRANT EXECUTE ... TO PUBLIC`** sur une fonction de crédits annule la
  protection : vérifier les droits après chaque migration (voir `credits-securite`).
- **Le plafond d'envoi de Storage est un réglage GLOBAL du projet** (50 Mo par
  défaut), pas une limite du bucket. Une vidéo refusée en 400 « The object exceeded
  the maximum allowed size » se règle dans Settings → Storage, pas dans le code.

## Après avoir livré

Regarder le résultat en vrai — la page, la vidéo, l'appel — plutôt qu'un statut vert.
C'est la même règle que pour les rendus : une métrique verte sur un mauvais résultat
veut dire qu'on a mesuré la mauvaise chose.
