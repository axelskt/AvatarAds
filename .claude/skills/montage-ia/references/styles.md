# Les styles visuels du Montage IA

`plan.slideStyle` choisit le style. Deux moteurs seulement :

| Moteur | Styles | Fichier |
|---|---|---|
| dynamique (panneaux qui se poussent) | `dynamic`, `apple` | `dynamic-engine.mjs` + `dynamic-derive.mjs` |
| classique (habillage sur une base vidéo) | `word`, `glass`, `editorial`, `auto` | `build-composition.mjs` + `visual-styles.mjs` |

Un style, c'est une **identité** : une palette, une typo, une façon d'entrer.
Ce n'est jamais une logique de montage — celle-là est commune et vit dans la
dérivation. Ajouter un style ne doit donc toucher qu'à des tons et des CSS.

---

## `dynamic` — référence : @lemosthiagoo

Le style historique du moteur. Des panneaux plein écran qui **se poussent** l'un
l'autre (0,42 s, direction alternée), fonds sombres et clairs en alternance,
Archivo Black très serré, accent orange. ~95 % de la vidéo est animée : le visage
n'est qu'une respiration.

Pièges connus, corrigés, à ne pas réintroduire :
- des mots fantômes hérités du mode classique
- des panneaux promus alors qu'ils étaient vides
- un `clamp` qui écrasait la durée des scènes courtes

## `apple` — référence : @beingmayy

**Une PEAU du moteur dynamique**, pas un second moteur (`build-composition.mjs`
ligne ~34 : `dynamic` et `apple` partent tous les deux dans `buildDynamicComposition`).
Même composition, même montée en puissance, autre habillage :

- deux tons **clairs** qui alternent (`AP_A` / `AP_B`), jamais de fond sombre
- accent iOS plutôt qu'orange saturé
- **Inter 800 très serré** (`letter-spacing:-.035em`) au lieu d'Archivo Black —
  Apple n'écrit jamais aussi gras
- pilules à grand rayon, ombres douces, halos radiaux qui dérivent lentement

Axel, en le validant : « je veux que le modèle ressemble principalement à la v18 ».
Toute dérive vers du sombre ou du gras est une régression.

## `word` — « mot à mot », référence : Thinks

Un mot à la fois, énorme, centré, calé sur la voix. Vit dans `visual-styles.mjs`
(`vs === 'word'`, classes `.vs-word`). Le b-roll y est cadré différemment : carte
haute en haut de la zone sûre, et `hero` en grand format centré.

C'est le style le plus exigeant sur la synchro : un mot affiché doit être le mot
prononcé, à la frame près. C'est `classic-derive.mjs` (`deriveClassicSlides`) qui
applique aux styles classiques les mêmes corrections côté donnée que la dérivation
dynamique — il sort immédiatement si le style est `dynamic` ou `apple`.

## `glass` — liquid glass

Panneaux translucides, flou d'arrière-plan, léger déplacement (`feDisplacementMap`,
`scale: 8` uniquement pour ce style). Fond sombre obligatoire : la palette des
animations bascule en clair pour tous les autres styles
(`const light = vs !== 'glass' && vs !== 'dynamic'` dans `anim-pack.mjs`).

⚠️ C'est cette ligne qui a produit un bug de production silencieux : sur un style
non résolu, les slides crème recevaient de l'encre blanche → animations invisibles.
Toujours vérifier une nouvelle valeur de `slideStyle` contre ce test.

## `editorial`

Mise en page de magazine : filets fins, capitales espacées, beaucoup de blanc.
Casse douce (`softCase`) comme `apple` et `word`.

---

## Les sous-titres

Le moteur dynamique en dessine (pastille sombre, texte blanc, mot prononcé en
accent, groupes de trois mots dans la zone sûre) — `plan.subtitles = false` les
retire. Le moteur classique a les siens, réglés par `capStyle` / `capAnim` /
`capPos` / `capSize` depuis les paramètres avancés du module.

Deux groupes ne doivent **jamais** se chevaucher : chacun s'arrête où le suivant
commence, sinon les phrases se superposent et deviennent illisibles.

## La zone sûre

`SAFE = { top: 0.12, bottom: 0.22, left: 0.04, right: 0.20 }` dans
`visual-styles.mjs`. Le bas est mangé par le bandeau TikTok/Reels, la droite par
la colonne d'icônes. Rien d'important ne descend sous `1 - SAFE.bottom`.
