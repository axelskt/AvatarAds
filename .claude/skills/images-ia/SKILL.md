---
name: images-ia
description: Le module Images IA d'AvatarAds — génération, correction img2img, « Améliorer en 4K », styles, formats et prompts de réalisme. À lire AVANT de toucher aux prompts d'image, aux moteurs (gpt-image, Nano Banana Pro, Imagen, Flux) ou au module Images IA de app/index.html. Contient la leçon la plus contre-intuitive du module : demander du détail à un modèle produit une peau de cire.
---

# Images IA

Un prompt (et parfois une image de référence) devient un visuel prêt à poster.

## Les moteurs

| Usage | Moteur | Proxy |
|---|---|---|
| Génération (texte → image) | `gpt-image-1` (`gpt-image-2` prévu) | `openai-proxy` |
| Correction / img2img | `gpt-image-1` edit | `openai-proxy` |
| « Améliorer en 4K », passe de détail | **Nano Banana Pro** (`gemini-3-pro-image-preview`) | `google-ai-proxy` |
| Cartoon (module Cartoon) | `imagen-4.0-generate-001` | `google-ai-proxy` |
| Alternative | Flux, derrière un drapeau | — |

Le repli est systématique : si Google échoue sur le 4K, on retombe sur gpt-image
plutôt que de laisser l'utilisateur sans rien, et **le toast dit quel moteur a
tourné** — c'est ce qui permet de diagnostiquer un rendu douteux d'un coup d'œil.

Aucune clé n'est dans le client : tout passe par un edge proxy.

## Les deux modes

- **Génération** — prompt + style + format. Le style ajoute un `suffix` au prompt
  (`_IMG_STYLES`), et une constante de réalisme (`_IMG_REALISM`, `_IMG_REALISM_SUFFIX`)
  s'y ajoute pour les styles photo.
- **Correction** — une image de référence est obligatoire. Les presets de la grille
  (`_IMG_CORRECT_PRESETS`) envoient chacun leur prompt back-end ; ceux marqués
  `needs` réclament une précision dans le champ avant de partir.

Styles : Photo Réel · Pixar 3D · Fruit · UGC Réel · Mascotte · Autre.
Formats : Carré 1024×1024 · Portrait 1024×1792 (9:16) · Paysage 1792×1024.
Qualités : Standard (1 cr) · Premium (3 cr) · 4K (5 cr).

## La leçon du réalisme — contre-intuitive, ne pas la reperdre

**Demander du détail produit une peau de cire.**

Le prompt de réalisme listait tout ce qu'on voulait voir : pores visibles, duvet,
iris fibreux, reflets nets, cils individuels, sourcils poil par poil. C'est mot
pour mot le vocabulaire d'un **portrait retouché**. Le modèle lit « beauté, détail,
netteté » et livre exactement ça : lissé, uniforme, plastique. Plus on insistait
sur le réalisme, plus on poussait vers le rendu beauty.

La correction n'est pas de retirer le détail — Axel le veut, et il a raison, c'est
lui qui donne la matière. C'est d'**ajouter l'interdit à côté** :

> Le détail dit CE QU'ON VEUT VOIR. L'interdit dit COMMENT NE PAS L'OBTENIR.

Les prompts (`_IMG_REALISM_EDIT`, `_NB_REFINE_PROMPT`) portent donc les deux :
la liste des détails, puis **jamais** lisser la peau, uniformiser le teint,
effacer boutons / rougeurs / brillance / cernes, épaissir sourcils ou cils,
blanchir dents et yeux, affiner un trait, ajouter maquillage ou éclat, appliquer
un filtre beauté. Plus l'ordre de **préserver** le grain du capteur, le flou de
profondeur de champ et l'asymétrie du visage.

⚠️ Limite honnête : un modèle génératif à qui on demande une sortie 4K **re-fabrique**
le visage, quoi qu'on lui écrive. Le prompt réduit la casse, il ne la supprime pas.
La garantie « zéro plastique » demanderait un agrandissement **non génératif**
(Real-ESRGAN ou équivalent), qui ne peut rien inventer — au prix d'aucun détail
récupéré. C'est un second bouton à côté, pas un remplacement.

## Autres pièges

- **Le format demandé et la taille envoyée diffèrent selon le moteur.** gpt-image
  veut `1024x1536` / `1536x1024`, l'affichage parle en `1024x1792` : la table
  `sizeMap` traduit. Nano Banana veut un ratio (`_NB_FMT_ASPECT`).
- **Une image de référence est obligatoire pour toute correction** — le module
  ouvre le sélecteur de fichier plutôt que d'échouer.
- **Le coût suit la qualité effective**, pas la qualité affichée : passer par
  `_imgCreditCost(_imgEffectiveQuality())`.
- Toute action payante passe par `spendCreditsFor` — voir la skill
  `credits-securite`. Le remboursement (`creditsFlowRefund`) est obligatoire sur
  échec, sinon un crédit disparaît sans image.
