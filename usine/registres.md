# Registres annexes — Creative Factory (v1)

> Complète `catalogue-briques.md`. IDs : `M` musique · `A` avatar · `S` style-subs · `C{N}` contenu (Cartoon N).

## 1. Musiques (`M…`)
**RÈGLE DE MIX (non négociable)** : voix prioritaire ~**-16 LUFS**, musique **duckée -22/-26 dB** sous la voix (ou sidechain).
**Compatibilité musique↔sujet** : **M01-M08 (beds)** = **génériques** → tous les sujets SAUF motion-control/omni (~80 % du temps) · **M09-M13 (ssstik)** = **motion-control / omni** (musique style avant/après).

### Beds instrumentaux (`~/Downloads/Musique/Musique 2/`) — utilisables directement
| ID | fichier | durée |
|---|---|---|
| M01 | Convergence.mp3 | 2:44 |
| M02 | Let it burn.mp3 | 2:09 |
| M03 | Me And The Devil (Instrumental).mp3 | 3:02 |
| M04 | Monuments.mp3 | 4:53 |
| M05 | She Will Instrumental Slowed.mp3 | 2:00 |
| M06 | falling forwards.mp3 | 3:16 |
| M07 | ridgeclub - do i clench my fists.mp3 | 2:33 |
| M08 | ta1ls - FATIGUE (uh..) 4.mp3 | 3:06 |

### Sons courts trending (`Musique 2/` — ssstik) — ⚠️ copyright cross-plateforme à cadrer
- 5 × `ssstik.io_*.mp3` (14-30 s) → `M09…M13`. OK on-platform TikTok, risqué en re-upload YouTube/cross-plateforme.

> ⚠️ **Le dossier parent `~/Downloads/Musique/` (15 clips `.MP4`) N'EST PAS la source musique** — la banque = **`Musique 2/`** uniquement (8 beds + 5 ssstik).

### Banque existante (app)
- `AA_MUSIC` (`window.AA_MUSIC`) : 3 originales + 4 virales — déjà intégrée.

## 2. Avatars (`A…`) — À PEUPLER depuis ta bibliothèque Image IA
**RÈGLE : `hook.avatar == cta.avatar`** (même personne ouvre/ferme). Indices repérés dans les scripts : *(femme)* H54/H59, *(zoom visage)* H14.
| ID | description | genre |
|---|---|---|
| A01 | (à définir — ex. homme 20-25) | H |
| A02 | (à définir — ex. femme) | F |
→ à remplir depuis les avatars réutilisables de l'app.

## 3. Styles de sous-titres (`S…`) — depuis l'app
| ID | style |
|---|---|
| S01 | word-style-v3 (Anton capitales, cadence ~2,1 s) |
| S02 | (autres styles existants du render-worker) |

## 4. Contenus → fichiers (`C{N}` = vidéo fournie + audio)
- **Montages vidéo RENDUS présents** : C12 (`vidéo 1M.mp4`) · C13 (`montage-apple-v4-lipsync` + `montage-mcp-cartoon13`) · C14 (`montage-DYNAMIQUE-v5`) · C15 (`slam-TOM-final` + `slam-lipsync`) · **C16 (6 variantes de style : v1/v3/v6/v7/v9/v10)** · C17 (`montage-v12`) · C18 (`1212`) · C20 (`Cartoon 20 - montage lipsync`) · C21 (`hook-word-v8-VALIDE` + `montage-v18-dynamic-VALIDE`) · C40 (`montage-validation-apple`).
- **Audio seul (montage vidéo à fournir)** : C19, C22→C36, C48, C53→C58, C63→C72.
- **Dossiers vides (audio à enregistrer)** : 37,38,39,41→47,49→52,59→62,65,73→77.
- Chemin : `~/Downloads/Contenue AvatarAds/Cartoon N/audio-nettoye*.wav` (+ `montage-*.mp4` si listé).

## 5. À faire
1. Peupler `A…` (avatars) et `S…` (styles-subs) depuis l'app.
2. Extraire l'audio des clips Musique + cadrer le copyright.
3. Fournir les montages vidéo manquants (contenus audio-seul) + enregistrer les audios manquants (dossiers vides) + pousser les scripts **omni** (feature récente).
4. Porter tout ça en **tables Supabase** (IDs auto + recette + `usage_count`/`score`), puis **JARVIS** (graphe de nœuds).
