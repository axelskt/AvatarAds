# render-worker — Node 22 + ffmpeg + CHROMIUM EMBARQUÉ
#
# Node 22 et pas 20 : @supabase/supabase-js ≥ 2.110 utilise le WebSocket NATIF
# pour son client realtime. Sous Node 20 il n'existe pas et la boucle de poll
# meurt au démarrage — « Node.js detected but native WebSocket not found ».
#
# ⚠️ CHROME EST INSTALLÉ ICI, PLUS TÉLÉCHARGÉ AU PREMIER RENDU.
# L'image comptait sur la CLI hyperframes pour aller chercher Chrome toute seule.
# Elle le téléchargeait bien (115 Mo), puis échouait à l'ouvrir :
#   « Extraction failed: no zip archiver is available. Install `unzip` »
#   → « ✗ Chrome not found » → « Command failed: hyperframes render »
# Résultat : TOUT rendu serveur échouait en production (constaté sur un montage
# lancé depuis Claude via le MCP — crédits remboursés, mais aucune vidéo).
# Chromium fait maintenant partie de l'image, et `unzip` est là de toute façon
# si la CLI décide un jour d'aller chercher sa propre version.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates fonts-liberation unzip \
    chromium \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
    libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# la CLI hyperframes utilise CE navigateur : plus de téléchargement, plus de
# dépendance réseau au moment du rendu, et un démarrage à froid bien plus court
ENV HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=1

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# ⚠️ HYPERFRAMES EST INSTALLÉ DANS L'IMAGE ET PATCHÉ ICI — PLUS NPX AU RENDU.
# Découvert sur les montages à 6 vidéos du 08/08 (3 rendus perdus, zéro ligne
# de diagnostic) :
#   ① la CLI 0.7.60 AVALE les erreurs d'extraction vidéo : quand un des ffmpeg
#      d'extraction meurt, l'erreur va dans un tableau que personne ne lit et
#      le rendu échoue plus loin sur « captured 0 of expected N frames » — un
#      message qui accuse la capture alors que la stderr du ffmpeg perdu vient
#      d'être jetée. patch-hyperframes.mjs ajoute LE log manquant ; le build
#      ÉCHOUE si l'ancre a bougé (version épinglée dans package.json).
#   ② la CLI lance ses N ffmpeg d'extraction d'un coup (Promise.all sans
#      borne), chacun en threads=auto — une explosion de threads qu'un Mac
#      encaisse et qu'un conteneur ne pardonne pas. hf-ffmpeg plafonne les
#      threads du DÉCODEUR (-threads en option d'ENTRÉE : l'encodeur x264 du
#      MP4 final garde tous ses cœurs). Branché par worker.mjs via
#      HYPERFRAMES_FFMPEG_PATH — les ffmpeg du worker (mix audio) ne passent
#      pas par là.
# Bonus : plus de téléchargement npx (~380 Mo) au premier rendu — même
# philosophie que Chromium ci-dessus.
RUN printf '#!/bin/sh\nexec /usr/bin/ffmpeg -threads "${HF_FFMPEG_THREADS:-2}" "$@"\n' > /usr/local/bin/hf-ffmpeg \
  && chmod +x /usr/local/bin/hf-ffmpeg \
  && node patch-hyperframes.mjs node_modules/hyperframes/dist/cli.js

ENV NODE_ENV=production
CMD ["node", "worker.mjs"]
