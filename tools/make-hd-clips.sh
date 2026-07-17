#!/bin/bash
# Régénère les segments gameplay en HD depuis les sources (clips/*.mp4, 1920x1080)
# → clips/hd/<id>_<seg>.mp4 en 1080x1920 (crop central 9:16, lanczos, CRF 20).
# Ensuite : uploader clips/hd/* sur le bucket R2 (dashboard Cloudflare) pour
# remplacer les versions 540x960 actuelles — même nommage, zéro changement d'app.
set -e
cd "$(dirname "$0")/.."
mkdir -p clips/hd
for src in clips/*_source.mp4 clips/minecraft_parkour_0*.mp4; do
  [ -f "$src" ] || continue
  base=$(basename "$src" .mp4)
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
  segs=$(python3 -c "print(max(1,int(float('$dur')//30)))")
  for i in $(seq 0 $((segs-1))); do
    out="clips/hd/${base}_$(printf '%02d' $i).mp4"
    [ -f "$out" ] && continue
    ffmpeg -v error -y -ss $((i*30)) -t 30 -i "$src" \
      -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=lanczos" \
      -c:v libx264 -preset slow -crf 20 -an "$out"
    echo "✓ $out"
  done
done
echo "Terminé — uploader clips/hd/* sur R2 pour remplacer les 540p."
