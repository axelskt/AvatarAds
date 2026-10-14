# Outils de lot — Creative Factory

Reconstruits le 14/10 après la perte du scratchpad : **ils vivent ici, jamais seulement dans un dossier temporaire.**
Dossier de travail (cache, états, rendus en cours) : `~/Downloads/Creative Factory/cache/lots/` (variable `CF_LOT_DIR`).

| Commande | Rôle |
|---|---|
| `python3 usine/lots/lot.py 5 5 lot-1410b` | lance 5 séries × 5 vidéos (moitié parlées, moitié Texte + musique) → file de revue, statut *pending* |
| `DRY=1 python3 usine/lots/lot.py 5 5 essai` | essai à blanc : affiche le plan, ne rend rien |
| `python3 usine/lots/valider.py VF-0439 VF-0440` (ou `--lot lot-1410b`) | « validé » → final/ + kit Instagram (intercalé, légende du CTA) |
| `python3 usine/lots/refaire.py VF-0316 …` | refait EN PLACE des Texte + musique déjà dans le kit (même recette, règles du jour) |
| `python3 usine/lots/equilibrer.py [AAAA-MM-JJ] [--dry]` | rééquilibre le kit à partir d'une date (défaut J+4) : chaque compte alterne parlé / sans voix chaque jour, mêmes créneaux — lancé aussi à la fin de `valider.py` |
| `python3 usine/lots/verifier.py` | contrôle du kit : vidéo accessible, adresse valide, aucun post parqué en 2099 |

Les règles de rendu (bruitages, centrage, cartes de résultats, musique) sont dans l'usine (`build.mjs`, `build-f05.mjs`,
`formats.js`, `illustrations.json`) ; les règles de recette (démos, réactions, anti-doublon) dans `plan.mjs` ; les règles de
programmation (comptes, horaires, alternance, légendes) dans `valider.py`.
