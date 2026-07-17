# render-worker — Node 20 + ffmpeg (Chrome headless installé par la CLI hyperframes au 1er rendu)
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
    libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# 1er rendu à vide pour précacher la CLI + Chrome (accélère les jobs suivants)
ENV NODE_ENV=production
CMD ["node", "worker.mjs"]
