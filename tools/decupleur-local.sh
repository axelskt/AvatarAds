#!/bin/bash
# Moteur LOCAL du Décupleur (26/10, Axel : « sur le compte dev, que le Décupleur passe en local, pas par Railway »).
# Lancé sur le Mac, il ne prend QUE les Décupleurs des comptes propriétaire / developer (render-worker, DC_LOCAL=1) ;
# Railway leur laisse 15 s avant de les prendre lui-même : Mac éteint ou script arrêté = rendu Railway, comme avant.
# Les variables (adresse Supabase, clé du moteur) viennent de Railway par `railway run` : aucune clé écrite sur le disque.
# Arrêt : ctrl+C (un job en cours est remis en file, Railway le reprend).
# À RELANCER après chaque mise à jour de render-worker/ (git pull puis ctrl+C et relance) : un moteur local resté sur l'ancien
# code prend quand même en premier les lots de ces comptes (ex. 30/10 : entrée mcp-prep/<uid>/ refusée par l'ancien code).
set -e
cd "$(dirname "$0")/../render-worker"
if [ ! -d node_modules ]; then npm ci --omit=dev --no-audit --no-fund; fi
exec railway run -p 27c34ad4-cdbf-46bf-a865-42f0e1e7b08f -s render-worker -e production -- \
  env DC_LOCAL=1 AUDIO_CLEAN_DISABLED=1 node worker.mjs
