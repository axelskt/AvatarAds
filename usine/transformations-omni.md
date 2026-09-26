# Transformations OMNI — hooks avant/après (registre + tags)

Type de brique : **HOOK visuel « avant/après »** pour les contenus **omni** (et plus tard **motion-control**).
Gabarit validé (18/09) : plein écran = résultat (luxe), médaillon **9:16** haut-droite = original, **présent dès la frame 0**,
sans texte, flash de transition entre 2 transformations, muet (voix off ajoutée par Axel).
Canvas 1080×1920, 2,8 s par clip. Assembleur 18/09 : `scratchpad/omni-hook-1/index.html` (HyperFrames, perdu) ; depuis le 26/09 :
**`usine/assemble-hk.mjs`** (ffmpeg local, même recette au pixel près : zoom 1,05 → 1 en 0,8 s, médaillon 446×793 à (591, 93),
bord 3 px, rayon 28, ombre, flash 0,72 ; points d'entrée des clips du 18/09).

## Unités de transformation (briques atomiques)

| ID | sujet | avant (médaillon) → après (plein écran) | fichier après (main) | fichier avant (inset) | notes |
|---|---|---|---|---|---|
| `TX-O01`  | omni | Audi A3 → **Lamborghini Urus** (intérieur) | `OMNI/Vidéo 1.mp4` | `OMNI/Vidéo 1.1.MP4` | inset rotation **-90°** à appliquer |
| `TX-O02a` | omni | Clio → **Porsche 911 GT3** (extérieur) | `OMNI/Vidéo 2.1.mp4` | `OMNI/Vidéo 2.mp4` | même plaque/cadrage, top |
| `TX-O02b` | omni | Clio → **Bugatti Chiron** (extérieur) | `OMNI/Vidéo 2.2.mp4` | `OMNI/Vidéo 2.mp4` | 2ᵉ résultat de la même Clio (corrigé le 26/09 : pas une Mustang ; feux arrière ronds façon Veyron = artefact IA) |
| `TX-O03`  | omni | bracelet fitness → **Patek Philippe Nautilus** | `OMNI/Vidéo 3.1.mp4` | `OMNI/Vidéo 3.MOV` | inset rotation **-90°**, source 4K |

> Convention fichiers (Axel 18/09) : `Vidéo N` = original filmé, `Vidéo N.M` = résultats OMNI.
> Mapping brique = **par contenu** (luxe = plein écran), pas par nom (ex. `TX-O01` : le luxe est dans `Vidéo 1.mp4`).
> `OMNI/Vidéo 5.MOV` = pas de paire → non utilisable en transformation pour l'instant.

## Assemblages avant / après — RÈGLE (Axel, 26/09)

Un **groupe** = un même original filmé (`meta.group`) : M1, M2, M4, O1, O2, O3. Clips d'un groupe : `0` = l'original
(`meta.before`) + une lettre par version (`meta.after`, a, b… dans l'ordre des IDs TX ; O2 : a = Porsche 911, b = Bugatti Chiron).
Un **assemblage valide** = une suite de clips **distincts** du **même** groupe : tous les 2-clips dans les deux sens (original → version,
version → original, version → autre version) + pour un groupe à ≥ 2 versions les 3-clips qui partent de l'original.
**Jamais deux groupes mélangés** (plus de « montre puis voiture »). Code : `usine/coherence.js` → `assemblies(bricks)` (liste) et
`assemblyCheck(recette, bricks)` (contrôle d'une recette existante). ID = `HK-<groupe>-<clips>` ; `components` =
`[{slot, brick_id, clip:'before'|'after'}]` (l'original est rattaché à la version voisine dans la suite).
Rendu : 2,8 s par clip (5,6 s / 8,4 s), plein écran = le clip en cours, **médaillon = le clip suivant pendant le 1er, puis le
précédent** (la frame 0 montre déjà l'avant et l'après), flash blanc entre deux clips, muet (voix off d'Axel ajoutée à l'assemblage final).

| ID | groupe | suite | durée |
|---|---|---|---|
| `HK-M1-0a` / `HK-M1-a0` | M1 (cuisine) | homme → femme / femme → homme | 5,6 s |
| `HK-M2-0a` / `HK-M2-a0` | M2 (Spider-Man) | homme → femme / femme → homme | 5,6 s |
| `HK-M4-0a` / `HK-M4-a0` | M4 (veste) | homme → femme / femme → homme | 5,6 s |
| `HK-O1-0a` / `HK-O1-a0` | O1 | Audi A3 → Lamborghini Urus / l'inverse | 5,6 s |
| `HK-O2-0a` / `HK-O2-a0` | O2 | Renault Clio → Porsche 911 GT3 / l'inverse | 5,6 s |
| `HK-O2-0b` / `HK-O2-b0` | O2 | Renault Clio → Bugatti Chiron / l'inverse | 5,6 s |
| `HK-O2-ab` / `HK-O2-ba` | O2 | Porsche 911 GT3 → Bugatti Chiron / l'inverse | 5,6 s |
| `HK-O2-0ab` | O2 | Renault Clio → Porsche 911 GT3 → Bugatti Chiron | 8,4 s |
| `HK-O2-0ba` | O2 | Renault Clio → Bugatti Chiron → Porsche 911 GT3 | 8,4 s |
| `HK-O3-0a` / `HK-O3-a0` | O3 | Bracelet fitness → Patek Philippe Nautilus / l'inverse | 5,6 s |

**18 assemblages** (M1, M2, M4, O1, O3 : 2 chacun ; O2 : 8), fichiers `factory-media/assemblages/<ID>.mp4`.
Les 16 recettes du 18/09 (`HK-O01-02a` … `HK-M04-02`, 2 transformations de groupes différents) sont au statut **`retired`**.

**Capacité** (`capacity(…).modes.aa`, « Avant / après ») : les hooks `meta.lipsync === false` / `hook_mode 'avant-apres'`
(H19, H53, H57, H63, H74 ; H64 alias) ne sont jamais en lipsync, ils sont dits en voix off sur un assemblage de leur module.
Court = Σ groupes (assemblages × hooks avant / après du module ayant un audio) ; long = × liaisons compatibles avec audio × avatars.
Au 26/09 : 48 courts + 432 longs = **480** (motion-control : 3 × 2 × 4 hooks ; omni : 12 × 2 hooks).

## Motion Control — unités `TX-M*` (18/09)
Même gabarit (avant/après, médaillon 9:16 dès frame 0). Concept MC = **transformation de personnage** : MÊME mouvement/pose, l'avatar change (homme → femme ici). main = résultat, médaillon = original.

| ID | avant (médaillon) → après (plein écran) | fichiers | notes |
|---|---|---|---|
| `TX-M01` | homme → femme (cuisine) | `MC/VIdéo 1.mp4` → `MC/Vidéo 1.1.mp4` | source **paysage 16:9** recadrée 9:16 |
| `TX-M02` | homme → femme (Spider-Man) | `MC/Vidéo 2.mp4` → `MC/Vidéo 2.1.mp4` | 9:16 natif |
| `TX-M04` | homme → femme (veste) | `MC/Vidéo 4.mp4` → `MC/Vidéo 4.1.mp4` | 9:16 natif |
> `MC/Vidéo 3.mp4` = solo (pas de paire). Dossier source : `Vidéo et Motion Control/Motion Control/Vidéo qui vont ensemble/`.

Hooks MC du 18/09 (`HK-M01-02` … `HK-M04-02`) : retirés le 26/09 (mélangeaient deux personnages) → `HK-M1-*`, `HK-M2-*`, `HK-M4-*`.

## Source de vérité = Supabase (18/09)
Tout est en base : `factory_bricks` (34 briques : 7 transfo + 10 contenus/démos + 13 musiques + 2 sous-titres + 2 avatars) et
`factory_recipes` (26/09 : 18 assemblages `done` + 16 anciens `retired`). Ce `.md` reste la doc humaine.
Règle Axel : **chaque nouveau contenu → générer TOUTES ses variantes** = `assemblies()` puis `node usine/assemble-hk.mjs --bricks … --out … --sql … --tsv …`.

## Règles de cohérence (pour Supabase)
- `TX-O*` = sujet **omni** → compatibles avec les contenus/CTA de sujet omni.
- Un assemblage = **clips distincts d'un seul groupe** (jamais 2× le même clip, jamais deux originaux) ; `TX-O02a` et `TX-O02b` se
  combinent (Porsche → Bugatti), ce sont deux versions de la même Clio.
- Durée : 5,6 s (2 clips) ou 8,4 s (3 clips, groupe à ≥ 2 versions) — à caler sur la **voix off**.
- Prochaines : `TX-M*` (motion-control, dossier `Vidéo et Motion Control/…/Vidéo qui vont ensemble/`, paires `N`↔`N.1`).
