# Aperçus des styles de sous-titres (Creative Factory)

Les briques `factory_bricks` de kind `sous-titre` (S01…) reçoivent chacune un aperçu vidéo 9:16 de 4,5 s et une
vignette. Tout est rendu en local, donc gratuit, et chaque style passe par son vrai moteur (voir `catalogue.mjs`).

```bash
cd render-worker && npm ci && cd ..                     # CLI HyperFrames du worker (une fois)
node tools/apercus-soustitres/fond.mjs "<Creative Factory>/avatars/A1/A1-3.jpg" /tmp/fond.mp4 11
node tools/apercus-soustitres/render.mjs --fond /tmp/fond.mp4 --out <deploy>/apercus [--only S03,S11]
node tools/apercus-soustitres/livrables.mjs --apercus <deploy>/apercus --deploy <deploy> --planches <dossier>
```

- `render.mjs` écrit `<id>.mp4`, `<id>.jpg` et `_controle/<id>.jpg` (5 images de contrôle, à regarder), plus
  `manifest.json`. Deux options : `--poster-only` refait seulement la vignette, `--reuse-raw` refait seulement le
  montage final à partir du rendu brut.
- `livrables.mjs` écrit `upload.tsv` (vers `factory-media/subtitles/`), le SQL idempotent
  `soustitres-apercus.sql` et les deux planches contact.
- Les propositions (`propositions.mjs`) sont des maquettes HyperFrames : en base, elles restent `draft` avec
  `meta.proposal = true` tant qu'aucun moteur ne sait les graver.
