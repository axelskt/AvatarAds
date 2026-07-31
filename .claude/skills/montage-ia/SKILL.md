---
name: montage-ia
description: Le Montage IA d'AvatarAds — un audio devient une vidéo montée toute seule (chef d'orchestre Claude → plan.json → render-worker → MP4). À lire AVANT de toucher à supabase/functions/orchestrate, render-worker/ (dynamic-derive, dynamic-engine, anim-pack, anim-bank, build-composition, worker), ou au module Montage IA de app/index.html. Couvre la chaîne, les règles de montage d'Axel qui ne se négocient pas, les pièges qui coûtent une session entière, comment tester un rendu en local et comment déployer.
---

# Montage IA

Un audio entre, une vidéo montée sort. Personne ne touche à une timeline.

## La chaîne, dans l'ordre

```
audio (+ brief, visuels, site, mémoire de marque)
  ↓  supabase/functions/orchestrate/index.ts      ← Claude lit la transcription
plan.json  { captions, slides, beats, tuto, broll, avatarSegments, sections, sfx, music }
  ↓  render-worker/worker.mjs                     ← Railway, watch render-worker/**
render-worker/dynamic-derive.mjs                  ← DÉCIDE ce qu'on voit et quand
  ↓
dynamic-engine.mjs (styles dynamic + apple)  |  build-composition.mjs (autres styles)
  ↓  HTML + GSAP  →  hyperframes  →  visual.mp4
mix audio (voix loudnorm + musique + SFX + frappes clavier)  →  MP4 final
```

**Le point le plus important : `plan.json` est une PROPOSITION, la dérivation TRANCHE.**
`dynamic-derive.mjs` réserve les fenêtres dans un ordre de priorité strict, et ce qui
n'entre pas est écarté. Debugger un rendu en lisant seulement le plan renvoyé par
`orchestrate` fait perdre des heures : c'est la dérivation qu'il faut lire.

Ordre de réservation dans `deriveDynamicSlides` (§0 → §4) :

| § | Ce qui réserve | Pourquoi en premier |
|---|---|---|
| 0 | le hook (visage) | une vidéo face caméra s'ouvre sur celui qui parle |
| 0a | les **médias de l'utilisateur** | sa photo bat n'importe quelle animation |
| 0b | les **adresses directes** (« c'est toi qui vois », « maintenant… ») | la voix ne désigne plus rien de montrable |
| 0a-bis/ter | les **phrases fortes** (« le lien en bio », « générer des vues ») | une phrase explicite bat une interprétation |
| 1 | la **visite guidée** (`plan.tuto`) + le navigateur | ses captures, rejouées au clic |
| 2 | les fenêtres avatar restantes (6,5 s max, 40 % du temps) | le visage est une respiration |
| 3-4 | les animations du chef d'orchestre, puis les tables locales | ce qui reste |

## Les règles d'Axel — elles ne se négocient pas

Chacune vient d'un rendu raté et d'un retour précis. Ne pas les redécouvrir.

1. **Le visuel EST le mot.** Tout élément posé doit pouvoir nommer le mot qui le
   justifie. Si le libellé d'une zone / les mots-clés d'une animation ne se retrouvent
   pas dans ce qui est prononcé à cet instant, on n'affiche rien.
2. **Un trou se remplit par le VISAGE, jamais par une animation fausse.** Axel :
   « limite si tu as un trou tu mets ton avatar principal, ça dynamise et c'est
   clean ». La hiérarchie est donc : un visuel juste (son média, une animation
   justifiée, une capture) → sinon l'avatar principal → et seulement si aucun
   visage n'est disponible, rien. Un écran vide reste vrai, mais il est mou ; un
   encadré qui contredit la voix, lui, est faux — c'est le seul interdit.
3. **Le chiffre affiché vient de ce qui est DIT.** Jamais une valeur de repli dans le
   code : l'écran a annoncé « 2 MIN » pendant que la voix disait « en quelques
   secondes ». Sans valeur → pas de nombre, ou une autre animation.
4. **Les médias de l'utilisateur passent devant.** Une carte de texte ne recouvre
   jamais sa photo ou sa vidéo — c'est la carte qui recule.
5. **Jamais un mot creux seul à l'écran.** « entièrement », « vont » en très gros ne
   montrent rien. Adverbes en -ment, auxiliaires, prépositions → la carte dégage.
6. **Une animation montre une ACTION et porte de la matière.** Test : si ça tient sur
   une image fixe, ça n'entre pas dans la banque. Axel a supprimé 12 icônes-sur-fond.
7. **Vérifier le VRAI rendu.** Extraire des frames du MP4 et les REGARDER. Une
   métrique verte sur un mauvais rendu veut dire qu'on a mesuré la mauvaise chose —
   c'est arrivé trois fois (harnais à fond noir, « couverture % » qui comptait des
   slides vides, sous-titre mesuré au démarrage du panneau et non sur le mot).

## Les pièges qui coûtent une session

- **Backtick ou `${` dans un template literal d'`anim-pack.mjs`** → casse tout le
  fichier, y compris les animations voisines. Un garde existe dans
  `sync-anim-bank.mjs`, ne pas le contourner.
- **`animJs` ne reçoit ni W ni H, ni `items`, ni `P`.** Ces trois-là n'existent que
  dans `animHtml`. Pour une distance : `FH(id, ratio)` / `FW(id, ratio)`, qui mesurent
  le cadre au moment du rendu. Pour les valeurs : relire `s.items`.
- **Les blocs `ANIMS` / catalogue de `orchestrate/index.ts` sont GÉNÉRÉS** depuis
  `render-worker/anim-bank.mjs` par `node render-worker/sync-anim-bank.mjs`. Les
  éditer à la main est écrasé au prochain sync.
- **Grammaire stricte Anthropic** : les champs du schéma sont des lignes
  `"a|b|c"`, jamais des tableaux d'objets — un schéma trop gros fait échouer l'appel.
- **HyperFrames refuse le rendu si un clip vidéo est plus court que sa fenêtre**
  (« captured 72 of expected 116 frames »). Découper les clips avatar APRÈS la
  dérivation, avec de la marge.
- **Les panneaux se poussent en 0,42 s.** Tout ce qui est programmé à l'ouverture
  d'un panneau se joue pendant que la capture glisse encore : le cadre doit attendre
  la fin de la poussée, et un panneau dont le contenu est calé sur des mots doit
  s'ouvrir AVANT le premier mot.
- **La barre latérale est identique sur toutes les captures** et ses libellés sont
  les noms des modules, que la voix prononce sans arrêt. Elle ne doit jamais gagner
  un rapprochement par mots contre un champ du contenu (`MENU_ZONES` dans
  `screen-spots.mjs`).

## Tester un rendu en local

Un job est un dossier :

```
job/
  base.mp4        vidéo de base (ou AUDIO SEUL : pas de piste vidéo → fond noir généré)
  plan.json       le plan (+ slideStyle, capStyle, music…)
  assets/         les médias de l'utilisateur, nommés par leur assetId
  avatar.png      sa photo d'avatar (sinon photo de démo — à ne jamais laisser en prod)
  avatar/av0.mp4  clips lipsync, dans l'ordre des avatarSegments DÉRIVÉS
  brand-logo.png
```

```bash
node render-worker/worker.mjs --local <job> --output out.mp4 --draft
```

- **Chromium meurt en pleine capture sur le Mac d'Axel** (« Protocol error …
  Target closed », à un pourcentage aléatoire) : c'est la pression RAM — le mode
  auto lance 8 workers Chrome (~256 Mo chacun). Relancer avec `RENDER_WORKERS=2`
  (branché dans worker.mjs) : 65 s rendues en ~73 s, stable. NE PAS utiliser
  `PRODUCER_LOW_MEMORY_MODE=1` : son mode screenshot à 1 worker CALE (60 s sans
  progression). Trois échecs le 31/07 avant ce réglage.
- **Un média utilisateur sous 700 px de LARGE est écarté sans bruit**
  (« asset ignoré (trop basse résolution … serait flou) » dans le log seulement).
  Un `sips -Z 1080` sur un portrait 941×1672 donne 608 px de large → rejeté.
  Ne jamais réduire par la hauteur ; garder l'original si sa largeur est < 1080.

Puis **regarder** : extraire une planche de vignettes et la lire.

```bash
for t in 1 5 10 20 30 40 50 60; do ffmpeg -v error -y -ss $t -i out.mp4 -vframes 1 -vf scale=250:-1 f$t.jpg; done
```

`DERIVE_DEBUG=1` journalise chaque réservation de fenêtre (`CLAIM`), chaque pose
(`POSE`) et chaque rejet des gardes (`REJET doublon` / `REJET hors-ancre`) avec la
ligne d'appel — c'est l'instrument qui a trouvé la réservation fantôme du 31/07
(un beat doublon délogé par `fit()` volait la fenêtre de `gaugefill` sur son
propre mot). L'ordre de réservation est invisible sans lui.

Pour inspecter la décision sans rendre (rapide, gratuit) : appeler
`deriveDynamicSlides(plan, { assetFiles })` et lister `plan.slides` + `plan.avatarSegments`
triés par `start`, avec le mot le plus proche de chaque `start`.

## Déployer

```bash
supabase functions deploy orchestrate --project-ref guvwgiejzkiodghywpwj
```
Le render-worker part sur Railway au push sur `main` (watch `render-worker/**`).
L'app part sur GitHub Pages au push. **Toujours tester un appel réel après un deploy
d'`orchestrate`** : une erreur de schéma ne se voit qu'à l'exécution.

## Les styles visuels

Un style est une identité, pas un moteur. `apple` et `dynamic` partagent
`dynamic-engine.mjs` ; les autres passent par `build-composition.mjs`.
Voir `references/styles.md` avant d'en modifier un.
