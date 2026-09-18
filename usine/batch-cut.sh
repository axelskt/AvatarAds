#!/usr/bin/env bash
# Creative Factory — batch : découpe hook/liaison/CTA des audios Cartoon.
# 10 par 10 (Axel : sinon l'ordi crash). RÉSUMABLE : saute ceux déjà découpés.
# Usage : batch-cut.sh [START] [END]   (défaut 12 77). Ex. chunk de 10 : batch-cut.sh 12 21
set -uo pipefail
START="${1:-12}"; END="${2:-77}"
CA="/Users/axelskotnicki/Downloads/Contenue AvatarAds"
OUTBASE="/Users/axelskotnicki/Downloads/Creative Factory/briques audio"
REPO="/Users/axelskotnicki/Downloads/Autre SaaS/avatarads-membres"
ok=0; skip=0; done_already=0
for n in $(seq "$START" "$END"); do
  dir="$CA/Cartoon $n"; outdir="$OUTBASE/cartoon-$n"
  # déjà fait (manifeste présent = découpe terminée) → on saute
  if [ -f "$outdir/cartoon-$n.manifest.json" ] && ls "$outdir"/H${n}-audio.wav >/dev/null 2>&1; then
    echo "— Cartoon $n : déjà découpé (skip)"; done_already=$((done_already+1)); continue; fi
  audio=$(ls "$dir"/audio*nettoye*.wav 2>/dev/null | grep -v sansbruit | head -1)   # tiret OU underscore
  [ -z "$audio" ] && audio=$(ls "$dir"/*.wav 2>/dev/null | grep -v sansbruit | head -1)
  [ -z "$audio" ] && audio=$(ls "$dir"/*.wav 2>/dev/null | head -1)
  if [ -z "$audio" ]; then echo "— Cartoon $n : pas d'audio"; skip=$((skip+1)); continue; fi
  echo "=== Cartoon $n ==="
  node "$REPO/usine/cut-audio.mjs" "$audio" "$outdir" "$n" 2>&1 | grep -aE "✓|⚠|mots" && ok=$((ok+1)) || echo "  (échec Cartoon $n)"
done
echo "CHUNK $START-$END TERMINÉ — $ok découpés, $done_already déjà faits, $skip sans audio."
