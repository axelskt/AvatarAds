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
