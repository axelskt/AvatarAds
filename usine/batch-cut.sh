#!/usr/bin/env bash
# Creative Factory — batch : découpe hook/liaison/CTA de TOUS les audios Cartoon (12→77).
# Séquentiel (Whisper est lourd). Sortie dans ~/Downloads/Creative Factory/briques audio/cartoon-<N>/.
set -uo pipefail
CA="/Users/axelskotnicki/Downloads/Contenue AvatarAds"
OUTBASE="/Users/axelskotnicki/Downloads/Creative Factory/briques audio"
REPO="/Users/axelskotnicki/Downloads/Autre SaaS/avatarads-membres"
ok=0; skip=0
for n in $(seq 12 77); do
  dir="$CA/Cartoon $n"
  audio=$(ls "$dir"/audio-nettoye*.wav 2>/dev/null | grep -v sansbruit | head -1)
  [ -z "$audio" ] && audio=$(ls "$dir"/*.wav 2>/dev/null | head -1)
  if [ -z "$audio" ]; then echo "— Cartoon $n : pas d'audio"; skip=$((skip+1)); continue; fi
  echo "=== Cartoon $n ==="
  node "$REPO/usine/cut-audio.mjs" "$audio" "$OUTBASE/cartoon-$n" "$n" 2>&1 | grep -aE "✓|⚠|mots" && ok=$((ok+1)) || echo "  (échec Cartoon $n)"
done
echo "BATCH TERMINÉ — $ok Cartoons découpés, $skip sans audio."
