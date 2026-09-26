# 🎼 render-worker — le renderer serveur d'AvatarAds (partie 4 du chef d'orchestre)

Transforme **vidéo avatar + plan de montage v0.2 + images** en **MP4 final** sans navigateur :
zooms punch, b-roll placé, hook, sous-titres Punch mot-à-mot (accents orange), musique
d'ambiance duckée à 16 % sous la voix, SFX aux timestamps.

- Visuel : composition HyperFrames générée depuis le plan (`build-composition.mjs`),
  rendue en headless (Chrome + ffmpeg embarqués par la CLI `hyperframes@0.7.60`).
- Audio : mix ffmpeg — voix de la vidéo de base + SFX (`assets/sfx/`, mappés sur les
  kinds du plan) + musique (`assets/music/`, mood → piste : intense=music-2,
  dynamique=music-1, chill=music-3).

Mesuré : **11 s de vidéo → ~27 s de rendu** en qualité high (Mac M-series).

## Prérequis

- Node ≥ 20, ffmpeg/ffprobe dans le PATH (`brew install ffmpeg`)
- ~1 Go de disque (Chrome headless téléchargé par la CLI au premier rendu)

## Test local (aucun réseau, aucun secret)

```bash
cd render-worker
npm run test:local          # rend test/job → test/final.mp4
# ou : node worker.mjs --local test/job --output out.mp4 [--draft]
```

Un dossier de job local contient : `base.mp4` (la vidéo), `plan.json` (la réponse
`plan` de l'edge function orchestrate + `duration`), `assets/<assetId>.jpg` (les
images b-roll référencées par `plan.broll[].assetId`).

## Mode connecté (poll de la table `render_jobs`)

```bash
cp .env.example .env        # coller SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
npm start                   # boucle : queued → rendering → done/failed
```

Le worker réclame les jobs `status='queued'` (claim atomique), télécharge
`input_video` et `assets[]` du bucket `render-media`, rend, uploade
`<user_id>/<job_id>.mp4` (public) et marque `done` avec `output_url`.

Table attendue (à créer, voir la migration dans `supabase/`) :

```sql
create table render_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'queued',   -- queued | rendering | done | failed
  plan jsonb not null,
  input_video text not null,               -- chemin storage render-media
  assets jsonb default '[]',               -- [{ id, path }]
  output_url text, error text,
  credits_cost int default 2, attempts int default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
```

## Nettoyage audio pour Claude (`audio-server.mjs`, 25/09)

Le MCP (outil `clean_audio` et étape 0 du Montage IA) nettoie les voix ICI, avec le
même traitement que le module « Nettoyage audio » de l'app, au lieu d'ElevenLabs
(qui reste le secours du MCP si ce serveur ne répond pas) :

- ffprobe (refus immédiat au-delà de 8 canaux ou 192 kHz ; durée bornée à 10 min au décodage) → ffmpeg → 48 kHz
  mono avec le **mixage de Web Audio** (0,5·(G+D) en stéréo, comme l'app) → signal
  assaini (NaN / infinis → 0) → **RNNoise** (le WASM de l'app, copié dans
  `vendor/rnnoise/`) → passage 16 bits → **chaîne voix** `voice-chain.mjs` (copie à
  l'identique des fonctions de `app/index.html`, préréglage par défaut de l'app) →
  MP3 192 kbps écrit dans un fichier (en-tête LAME : durée exacte, voix sans
  décalage). Pas de coupe des silences. Une sortie muette pour une entrée audible
  est refusée (422), jamais livrée.
- `POST /audio/clean` (octets audio, 15 Mo max, en-tête `x-worker-key` =
  `AUDIO_CLEAN_KEY`, en-tête facultatif `x-clean-delai-ms`) → `audio/mpeg` +
  `X-Audio-Duration`. 413 `trop_long` / `hors_limites` = refus définitif (le MCP ne
  passe pas au secours). `GET /health` → `{"ok":true}`.
- Tourne dans un **processus enfant** surveillé par un **thread** de `worker.mjs`
  (`audio-superviseur.mjs`) : les rendus bloquent la boucle d'événements du
  processus principal, pas celle du thread — le serveur répond pendant un rendu et,
  s'il meurt, il est relancé 2 s plus tard. Priorité CPU basse, concurrence 1,
  file 3, délai 40 s au plus (le MCP envoie le sien, 12 à 37 s selon la taille).
  Fichiers temporaires sous `$TMPDIR/aa-clean/<pid>-…`, effacés même après un
  plantage (au redémarrage). Sans `AUDIO_CLEAN_KEY` la route répond 503.
- Variables : `PORT` (8080), `AUDIO_CLEAN_KEY` (≥ 16 caractères), optionnelles
  `AUDIO_CLEAN_CONCURRENCY`, `AUDIO_CLEAN_QUEUE`, `AUDIO_CLEAN_TIMEOUT_MS` (40000),
  `AUDIO_CLEAN_MAX_SECONDS` (600), `AUDIO_CLEAN_DISABLED=1` pour ne pas le lancer.
- Mémoire : ~340 Mo au pic pour 10 min d'audio (mesuré), plus les corps en attente
  (jusqu'à 4 × 15 Mo) et la réponse (~14 Mo) : compter 350 à 420 Mo.

```bash
npm run test:audio      # chaîne identique à l'app, décodage (stéréo…), Chrome, route, auth, délais
```

Les bancs : `parite.test.mjs` (la chaîne, au bit près), `decodage.test.mjs` (mixage
de Web Audio, formats, signaux piégés, ménage), `parite-chrome.test.mjs` (l'app dans
un vrai Chrome headless contre le worker, fichier par fichier : corrélation ≥ 0,9999,
résidu ≤ -40 dB, gain ±0,1 dB ; sauté sans Chrome), `serveur.test.mjs` (la route et
le superviseur). Parité = « identique à l'app sur un appareil à 48 kHz, au décodeur
près » : le décodeur est ffmpeg et non celui de Chrome, écarts inaudibles consignés
dans `parite-chrome.json`.

⚠️ Toute modification de la chaîne voix se fait d'abord dans l'app, puis se reporte
dans `voice-chain.mjs` : le banc `test/audio-clean/parite.test.mjs` échoue sinon.

## Hébergement

- **Sur le Mac d'Axel (0 €)** : `npm start` dans un terminal (ou `caffeinate -i npm start`).
  Suffisant pour démarrer — les jobs attendent en file si le Mac est éteint.
- **Railway / Fly.io (~5-10 €/mois, 24/7)** : conteneur Node 20 + ffmpeg + Chrome.
  Dockerfile fourni. Variables : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Ce que ça débloque

1. Toggle Générateur « livraison finale » : le MP4 monté tombe tout seul.
2. Module A-Z (#43) et outil MCP `render_montage` (#103) : Claude livre la vidéo finie.
3. Export serveur de l'Éditeur : qualité constante, pas de MediaRecorder temps réel.
4. Ensuite : lipsync segmenté (#108) — Hedra uniquement sur les sections visage.
