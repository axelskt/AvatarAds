#!/usr/bin/env bash
# Creative Factory — assembleur v1 (déterministe)
# HOOK (muet) + CONTENU/démo (voix) [+ musique duckée] -> MP4 9:16 1080x1920.
# Voix normalisée -16 LUFS · musique -9 dB duckée en sidechain sous la voix.
# Usage : assembler.sh <hook.mp4> <demo.mp4> <out.mp4> [music.mp3]
set -euo pipefail
HOOK="$1"; DEMO="$2"; OUT="$3"; MUSIC="${4:-}"
TMP="$(dirname "$OUT")/.asm_stitch_$$.mp4"
VF="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1"

HOOKDUR=$(ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 "$HOOK")

# ── Étape 1 : normaliser + concaténer (hook muet + démo voix -16 LUFS) ──
ffmpeg -v error -y -i "$HOOK" -f lavfi -t "$HOOKDUR" -i "anullsrc=r=48000:cl=stereo" -i "$DEMO" \
  -filter_complex "\
    [0:v]$VF[hv]; \
    [2:v]$VF[dv]; \
    [2:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[da]; \
    [hv][1:a][dv][da]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -crf 20 -r 30 -c:a aac -b:a 192k "$TMP"

if [ -n "$MUSIC" ] && [ -f "$MUSIC" ]; then
  # ── Étape 2 : lit de musique duckée sous la voix (sidechain) ──
  ffmpeg -v error -y -i "$TMP" -stream_loop -1 -i "$MUSIC" \
    -filter_complex "\
      [1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-9dB[m]; \
      [m][0:a]sidechaincompress=threshold=0.02:ratio=6:attack=5:release=250[mduck]; \
      [0:a][mduck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]" \
    -map "0:v" -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
  rm -f "$TMP"
else
  mv "$TMP" "$OUT"
fi
echo "OK -> $OUT ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s)"
