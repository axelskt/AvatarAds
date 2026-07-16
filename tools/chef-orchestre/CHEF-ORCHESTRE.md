# 🎼 Chef d'orchestre — V0 (pipeline local)

**Objectif** : à partir de ce que DIT l'audio, générer automatiquement un montage
synchronisé (caméra, highlight, sous-titres mot-à-mot, SFX) → MP4 1080×1920.

C'est la première partie de la tâche #108. La « tête » (étape 3) sera remplacée
par Claude dans une edge function Supabase (`ANTHROPIC_API_KEY` déjà en secret) ;
tout le reste du pipeline est déjà là et ne changera pas.

## Le pipeline (5 étapes)

```
1. VOIX OFF        npx hyperframes tts "…" -v ff_siwis -l fr-fr   (prod : ElevenLabs de l'app)
2. TRANSCRIPTION   npx hyperframes transcribe narration.wav -m small -l fr   (word-level)
3. ORCHESTRATION   node scripts/orchestrate.mjs → plan.json      ← EN PROD : Claude (edge function)
4. BUILD           node scripts/build.mjs → index.html           (composition HyperFrames)
5. RENDU           npm run check && npx hyperframes render --quality high -o out.mp4
```

Reproduire le rendu de démo :

```bash
export HYPERFRAMES_PYTHON=/Users/axelskotnicki/.venvs/kokoro/bin/python   # TTS local
node scripts/orchestrate.mjs --script script/script.json \
  --transcript assets/vo/transcript.json --scene scene-maps/express.json \
  --audio assets/vo/narration.wav --out plan.json
node scripts/build.mjs --plan plan.json --out index.html
npm run check && npx hyperframes render --quality high --output avatarads-express-guide-vo.mp4
```

## Les 3 entrées de l'orchestrateur

| Fichier | Rôle | En prod |
|---|---|---|
| `script/script.json` | Le TEXTE exact des phrases (sous-titres fiables) | Script du Générateur / brief user |
| `assets/vo/transcript.json` | Le TIMING mot-à-mot (Whisper) | ElevenLabs timestamps ou Scribe (upload MP3) |
| `scene-maps/express.json` | Les cibles zoomables : rect px + zoom + mots-clés | Une scene-map par module / par asset user |

**Idée clé — alignement forcé** : Whisper se trompe sur les mots (« prong » pour
« prompt ») mais pas sur le timing. L'orchestrateur aligne le script exact sur la
transcription (Needleman-Wunsch sur les mots normalisés, similarité Levenshtein,
interpolation des mots non appariés). Résultat : texte parfait + timing réel.
Le même algo se porte tel quel en TypeScript dans l'edge function.

## Le contrat : `plan.json` (version 0.1)

C'est CE schéma que l'edge function Claude devra émettre. Le renderer (`build.mjs`)
ne contient AUCUNE logique créative — tout vient du plan.

```jsonc
{
  "version": "0.1",
  "format": { "width": 1080, "height": 1920, "fps": 30, "duration": 11.7 },
  "scene": "scene-maps/express.json",
  "audio": { "narration": { "src": "…", "start": 0, "duration": 11.104 } },
  "style": { "anticipation": 0.15, "moveDuration": 0.5, "tailSeconds": 0.6 },
  "segments": [   // découpage caméra — un segment par phrase/idée
    { "id": "express", "role": "step", "camera": "target", "target": "express",
      "start": 2.84, "end": 4.82, "speechStart": 2.84, "speechEnd": 4.2,
      "emphasis": "pulse" }  // emphasis optionnel
  ],
  "captions": [   // sous-titres Punch mot-à-mot, texte EXACT du script
    { "text": "EXPRESS", "start": 3.62, "end": 4.2, "accent": true }
  ],
  "sfx": [ { "kind": "whoosh", "at": 2.69 }, { "kind": "click", "at": 8.59 } ]
}
```

Règles appliquées par l'orchestrateur :
- cible choisie par score de mots-clés de la scene-map (0 hit → `wide`) ;
- whoosh à chaque mouvement de caméra, clic UI sur `emphasis: pulse` ;
- caméra anticipée de 0,15 s (le mouvement précède le mot — montage pro) ;
- sous-titres : durée min 0,14 s, mots-clés en orange (`accent`), safe-zone (69 % H).

## Maths caméra (généralisées dans build.mjs)

Panel `1560×878` centré dans `1080×1920`, `transformOrigin: "0 0"` sur `#cam`.
Pour centrer le centre C d'une cible à (W/2, 49 % H) au zoom z :
`x = W/2 − panelLeft − Cx·z` ; `y = 0.49·H − panelTop − Cy·z`.
Zoom par cible dans la scene-map (défaut : `clamp(0.72·W / rectW, 1.3, 2.3)`).

## Pièges HyperFrames appris (ne pas re-payer)

- `<audio>` timé SANS `id` → rendu MUET (`media_missing_id`, erreur lint) ;
- jamais de tween `left/top` → `x/y` transforms (`gsap_non_transform_motion`) ;
- pas de CSS `transform` sur un élément tweené par GSAP (conflit) ;
- polices système aliasées au rendu : 'Arial Black' → Montserrat (très bien pour le Punch) ;
- 1 seule composition racine (les brouillons vont dans `archive/`) ;
- sous-titres qui se chevauchent → alterner les `data-track-index`.

## Résultat de la démo

`avatarads-express-guide-vo.mp4` — 11,7 s, 7,1 Mo, voix FR (Kokoro ff_siwis) :
« Tu veux une vidéo virale en trente secondes ? Va sur Express. Importe ton image.
Tape ton prompt. Et clique sur Générer. AvatarAds fait le reste. »
Chaque zoom + bordure orange se déclenche pile sur le mot correspondant ;
sous-titres Punch mot-à-mot ; whoosh sur chaque cut ; clic UI sur « Générer ».
Alignement : 24/25 mots appariés. Vérifié frame par frame (verify/) + niveaux audio.

## Prochaines parties (#108)

1. **Edge function `orchestrate`** : Claude reçoit transcript + scene-map + assets
   user → émet `plan.json` (même schéma). ANTHROPIC_API_KEY déjà en secret Supabase.
2. **Assets utilisateur** : images/vidéos uploadées = nouvelles « cibles » plein
   écran que le plan place aux bons timestamps (`camera: "asset"` à ajouter au schéma).
3. **Lipsync sélectif** : segments `camera: "avatar"` seulement où l'avatar est
   visible (~40-50 % → coût ÷2 → finance OmniHuman sur Élite).
4. **UI app** : toggle « Montage IA » dans le Générateur + prepare_edit vers
   l'Éditeur — **ne pas oublier la version mobile** à ce moment-là.
