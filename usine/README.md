# usine/ — Creative Factory (côté « usine » du repo)

Base de briques créatives pour l'usine d'assemblage variante × cohérence.
Plan complet : [`../PLAN-CREATIVE-FACTORY-TRACKADS.md`](../PLAN-CREATIVE-FACTORY-TRACKADS.md).

- **`catalogue-briques.md`** — 66 hooks (avec `compatible_subjects`), ~15 CTA canoniques (dédupliqués), 8 démos de contenu. Cartoon 12→77 (1-11 ignorés).
- **`registres.md`** — musiques (`M`), avatars (`A`), styles-subs (`S`), mapping contenus→fichiers, règle de mix.

**Convention ID** : brique de Cartoon N → `H{N}`/`L{N}`/`C{N}`/`CTA{N}` (traçable) ; briques générées ensuite continuent au-delà ; `M/A/S` en séquences indépendantes.

**Cohérence** : `contenu.subject ∈ hook.compatible_subjects` ; `hook.avatar == cta.avatar` ; `image-ia ⟺ express` (99 %).

**Prochaines briques** : (1) tables Supabase (IDs auto + recette + score) ; (2) assembleur `ffmpeg` (hook + contenu + cta, voix -16 LUFS / musique duckée, canevas 9:16) ; (3) **JARVIS** (graphe de nœuds : cliquer un hook illumine ses possibilités compatibles) — à construire au fur et à mesure ; (4) render-on-distribute.
