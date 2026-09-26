# usine/ — Creative Factory (côté « usine » du repo)

Base de briques créatives pour l'usine d'assemblage variante × cohérence.
Plan complet : [`../PLAN-CREATIVE-FACTORY-TRACKADS.md`](../PLAN-CREATIVE-FACTORY-TRACKADS.md).

- **`catalogue-briques.md`** — 66 hooks (avec `compatible_subjects`), ~15 CTA canoniques (dédupliqués), 8 démos de contenu. Cartoon 12→77 (1-11 ignorés).
- **`registres.md`** — musiques (`M`), avatars (`A`), styles-subs (`S`), mapping contenus→fichiers, règle de mix.

**Convention ID** : brique de Cartoon N → `H{N}`/`L{N}`/`C{N}`/`CTA{N}` (traçable) ; briques générées ensuite continuent au-delà ; `M/A/S` en séquences indépendantes.

**Cohérence** (Axel 25/09, code : `usine/coherence.js`, même règle pour le dashboard et `publish-qc.mjs`) : toute démo peut suivre tout hook, au besoin avec une liaison **générique** (subject `generique`). `contenu.subject ∈ hook.compatible_subjects` (ou hook générique) = cohérent d'office ; sinon la vidéo part en **revue QC manuelle** (raison dans `technical.coherence`), Axel accepte ou refuse. `hook.avatar == cta.avatar`.

**Vidéos finales** (Axel 25/09 au soir, `usine/coherence.js` : `capacity`, `impact`, `comboKey`) : format court = avatar × hook ; format long = avatar × hook × liaison **compatible** (matrice validée `coherence-hook-liaison.md`, en données dans `hook-liaison.js` — les deux générés par `node usine/gen-coherence-matrix.mjs` ; hook absent de la matrice → liaisons génériques seulement), dans **2 modes de voix comptés séparément** : `axel` « Audio d'Axel » (audio enregistré + lipsync : brique avec `meta.media` audio) et `omni` « Voix native Omni » (Omni Flash dit le texte : hook = `meta.script` sinon `label`, liaison = `label`). La **démo et le CTA sont tirés au hasard** (`pickDemo` préfère une démo dont le sujet est cité par le hook et que la liaison accepte, sinon revue QC) et ne font jamais une nouvelle vidéo ; seule exception : décliner un top (`declineTop` : même hook + liaison, autre démo, autre CTA ; renvoie `{ combo, from }` — n'écrire que `combo`). Vidéo déjà produite = clé `voice|avatar|hook|liaison` d'une ligne `factory_qc` (`brick_combo.voice`, `axel` par défaut). `brick_combo` n'accepte que les clés `COMBO_KEYS` et une voix `axel` | `omni` : `publish-qc.mjs` refuse le reste avant tout rendu ; `comboCheck` envoie en revue une brique parlée sans audio (axel) ou sans texte (omni). Briques `retired` exclues partout. Tests : `node usine/coherence.test.mjs`.

**Avant / après** (Axel 26/09) : hooks `meta.lipsync === false` / `hook_mode 'avant-apres'` (H19, H53, H57, H63, H74) jamais en lipsync → 3e mode `aa` de `capacity` (voix off d'Axel sur un assemblage ; court = assemblages × hooks du module, long = × liaisons × avatars) ; `total` = axel + omni + aa ; hooks `overlay_required` signalés dans `capacity().overlayRequired`.
Assemblage = 2-3 clips distincts d'**un seul** groupe de transformations (`assemblies`, `assemblyCheck`, IDs `HK-O2-0ab`…) ; rendu local ffmpeg `node usine/assemble-hk.mjs --bricks … --out … [--sql …] [--tsv …]` (recette visuelle des HK du 18/09) ; règle + tableau : `transformations-omni.md`.
Clé d'une vidéo avant / après : `aa|avatar|hook|liaison|assemblage` (`brick_combo.assemblage`, avatar vide en court) ; les clés à 4 champs gardent leur sens.

**Formats de hook à tester** (Axel 26/09 : « tester différents formats et récolter de la data », code : `usine/formats.js`, tests `node usine/formats.test.mjs`) : la façon de présenter les 3 premières secondes et les sous-titres. **Variété à tester, jamais un multiplicateur de vidéos** (la clé reste `voix|avatar|hook|liaison`).

| id | libellé | à l'écran |
|---|---|---|
| `F01` | Sous-titres seuls | l'actuel : sous-titres mot à mot blancs contour noir (82 px, bande basse) |
| `F02` | Texte choc 3 s + gros sous-titres colorés | phrase choc de 0 à 3 s (bandeaux blancs, texte noir), puis gros sous-titres (108 px), mot fort en jaune |
| `F03` | Texte choc 3 s + sous-titres normaux | phrase choc de 0 à 3 s, puis les sous-titres de F01 |
| `F04` | Gros sous-titres colorés | pas de phrase choc ; gros sous-titres, mot fort en jaune (F01–F04 = plan 2 × 2 phrase choc × style) |
| `F05` | Texte + musique | hook UGC muet tête choquée + phrase, démo muette, musique seule : **modélisé, pas rendable** (attend les démos muettes) |

- **Phrase choc** = banque **validée** TH01–TH19 (`~/Downloads/Creative Factory/banque-phrases-hook.md`, copiée à l'identique, vérifié par les tests) : générique = toute démo, sinon seulement la démo de son module ; TH13 seulement si le hook visuel montre `TX-O02a`. Nouvelles phrases = proposées à part, jamais publiées sans validation d'Axel.
- **Placement** (`chocLayout`) : zone sûre TikTok / Reels (ni la barre du haut, ni les icônes de droite, ni la légende du bas), **jamais sur un visage** (visages détectés sur les images 0-3 s du hook : `usine/face-zones.mjs`, Vision macOS ; indisponible → revue QC), jamais sur le médaillon « avant » d'un hook avant/après ; en haut d'abord, sinon sous le visage. **Visible dès la frame 0** (couverture). Les sous-titres ne commencent qu'après elle.
- **Rotation** (`build.mjs --format auto`, défaut) : le format le moins testé pour ce hook, puis le moins testé en tout (`--done` = recettes déjà produites, sinon lues en base) ; format `retired` en base (`factory_bricks` kind `format`) = plus tiré. `--format F0x` / `--choc THxx` pour forcer.
- **Data** : `build.mjs` écrit `<vidéo>.format.json` ; `publish-qc.mjs` le recopie dans `factory_qc.brick_combo.format` (+ `texte_choc`) et met en **revue** une phrase qui ne va pas avec la démo ou posée sur un visage (`technical.format`). Le dashboard lit ces deux clés à part (`q.format`, `q.texteChoc`) : la recette reste comptée.

**Prochaines briques** : (1) tables Supabase (IDs auto + recette + score) ; (2) assembleur `ffmpeg` (hook + contenu + cta, voix -16 LUFS / musique duckée, canevas 9:16) ; (3) **JARVIS** (graphe de nœuds : cliquer un hook illumine ses possibilités compatibles) — à construire au fur et à mesure ; (4) render-on-distribute.
