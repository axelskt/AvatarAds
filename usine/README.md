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

**Prochaines briques** : (1) tables Supabase (IDs auto + recette + score) ; (2) assembleur `ffmpeg` (hook + contenu + cta, voix -16 LUFS / musique duckée, canevas 9:16) ; (3) **JARVIS** (graphe de nœuds : cliquer un hook illumine ses possibilités compatibles) — à construire au fur et à mesure ; (4) render-on-distribute.
