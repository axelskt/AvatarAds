# Transformations OMNI — hooks avant/après (registre + tags)

Type de brique : **HOOK visuel « avant/après »** pour les contenus **omni** (et plus tard **motion-control**).
Gabarit validé (18/09) : plein écran = résultat (luxe), médaillon **9:16** haut-droite = original, **présent dès la frame 0**,
sans texte, flash de transition entre 2 transformations, muet (voix off ajoutée par Axel).
Canvas 1080×1920, ~2,8 s / transformation. Assembleur : `scratchpad/omni-hook-1/index.html` (HyperFrames, variables `slotAmain/slotAinset/slotBmain/slotBinset`).

## Unités de transformation (briques atomiques)

| ID | sujet | avant (médaillon) → après (plein écran) | fichier après (main) | fichier avant (inset) | notes |
|---|---|---|---|---|---|
| `TX-O01`  | omni | Audi A3 → **Lamborghini Urus** (intérieur) | `OMNI/Vidéo 1.mp4` | `OMNI/Vidéo 1.1.MP4` | inset rotation **-90°** à appliquer |
| `TX-O02a` | omni | Clio → **Porsche 911 GT3** (extérieur) | `OMNI/Vidéo 2.1.mp4` | `OMNI/Vidéo 2.mp4` | même plaque/cadrage, top |
| `TX-O02b` | omni | Clio → **Ford Mustang** (extérieur) | `OMNI/Vidéo 2.2.mp4` | `OMNI/Vidéo 2.mp4` | 2ᵉ résultat de la même Clio |
| `TX-O03`  | omni | bracelet fitness → **Patek Philippe Nautilus** | `OMNI/Vidéo 3.1.mp4` | `OMNI/Vidéo 3.MOV` | inset rotation **-90°**, source 4K |

> Convention fichiers (Axel 18/09) : `Vidéo N` = original filmé, `Vidéo N.M` = résultats OMNI.
> Mapping brique = **par contenu** (luxe = plein écran), pas par nom (ex. `TX-O01` : le luxe est dans `Vidéo 1.mp4`).
> `OMNI/Vidéo 5.MOV` = pas de paire → non utilisable en transformation pour l'instant.

## Hooks assemblés (recettes = 2 unités ordonnées) — RENDUS le 18/09

| ID hook | recette | contenu |
|---|---|---|
| `HK-O01-02a` | [TX-O01, TX-O02a] | Lambo puis Porsche |
| `HK-O02a-01` | [TX-O02a, TX-O01] | Porsche puis Lambo |
| `HK-O01-03`  | [TX-O01, TX-O03]  | Lambo puis Patek |
| `HK-O03-01`  | [TX-O03, TX-O01]  | Patek puis Lambo |
| `HK-O02a-03` | [TX-O02a, TX-O03] | Porsche puis Patek |
| `HK-O03-02a` | [TX-O03, TX-O02a] | Patek puis Porsche |
| `HK-O01-02b` | [TX-O01, TX-O02b] | Lambo puis Mustang |
| `HK-O02b-03` | [TX-O02b, TX-O03] | Mustang puis Patek |

Combos restants possibles (non encore rendus, l'assembleur/Supabase les produira) : toutes les paires ordonnées de
{TX-O01, TX-O02a, TX-O02b, TX-O03} avec unités distinctes → surface « en attente » du tableau des IDs.

## Règles de cohérence (pour Supabase)
- `TX-O*` = sujet **omni** → compatibles avec les contenus/CTA de sujet omni.
- Une recette de hook = **unités distinctes** (jamais 2× la même voiture) ; `TX-O02a` et `TX-O02b` s'excluent dans un même hook (même original Clio).
- Durée hook = calée sur la **voix off** : si l'audio dépasse 2 transformations → ajouter une 3ᵉ unité (slot C).
- Prochaines : `TX-M*` (motion-control, dossier `Vidéo et Motion Control/…/Vidéo qui vont ensemble/`, paires `N`↔`N.1`).
