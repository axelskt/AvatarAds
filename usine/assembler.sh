#!/usr/bin/env bash
# Creative Factory — assembleur v2 (déterministe)
# HOOK (+voix off optionnelle) + CONTENU/démo (voix) [+ CTA] [+ musique duckée] + BRUITAGES en transition
# -> MP4 9:16 1080x1920. Voix -16 LUFS · musique -9 dB duckée sidechain · whoosh au milieu du hook, impact au passage démo.
# Sous-titres = étape séparée (usine/captions.mjs, via HyperFrames).
# Usage : assembler.sh <hook.mp4> <demo.mp4> <out.mp4> [music.mp3] [hook_voice.wav] [cta.mp4]
set -euo pipefail
HOOK="$1"; DEMO="$2"; OUT="$3"; MUSIC="${4:-}"; HOOKVOICE="${5:-}"; CTA="${6:-}"
DIR="$(dirname "$OUT")"; TMP="$DIR/.asm_stitch_$$.mp4"
SFX="$(cd "$(dirname "$0")" && pwd)/../render-worker/assets/sfx"
VF="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1"
dur(){ ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
HOOKDUR=$(dur "$HOOK")

# ── Étape 1 : normaliser + concaténer (hook + démo [+ CTA]) ──
if [ -n "$HOOKVOICE" ] && [ -f "$HOOKVOICE" ]; then
  HA_IN=(-i "$HOOKVOICE"); HA_FILT="[1:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5[ha]"
else
  HA_IN=(-f lavfi -t "$HOOKDUR" -i "anullsrc=r=48000:cl=stereo"); HA_FILT="[1:a]anull[ha]"
fi
if [ -n "$CTA" ] && [ -f "$CTA" ]; then
  ffmpeg -v error -y -i "$HOOK" "${HA_IN[@]}" -i "$DEMO" -i "$CTA" -filter_complex "\
    [0:v]$VF[hv];[2:v]$VF[dv];[3:v]$VF[cv]; $HA_FILT; \
    [2:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[da]; \
    [3:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5[ca]; \
    [hv][ha][dv][da][cv][ca]concat=n=3:v=1:a=1[v][a]" \
    -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -crf 20 -r 30 -c:a aac -b:a 192k "$TMP"
else
  ffmpeg -v error -y -i "$HOOK" "${HA_IN[@]}" -i "$DEMO" -filter_complex "\
    [0:v]$VF[hv];[2:v]$VF[dv]; $HA_FILT; \
    [2:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[da]; \
    [hv][ha][dv][da]concat=n=2:v=1:a=1[v][a]" \
    -map "[v]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -crf 20 -r 30 -c:a aac -b:a 192k "$TMP"
fi

# ── Étape 2 : bruitages en transition + musique duckée ──
T_MID=$(awk "BEGIN{printf \"%d\", $HOOKDUR/2*1000}")   # whoosh au flash milieu du hook
T_CUT=$(awk "BEGIN{printf \"%d\", $HOOKDUR*1000}")      # impact au passage hook->démo
WH="$SFX/whoosh.mp3"; IMP="$SFX/mo-impact-2.mp3"
if [ -n "$MUSIC" ] && [ -f "$MUSIC" ]; then
  ffmpeg -v error -y -i "$TMP" -stream_loop -1 -i "$MUSIC" -i "$WH" -i "$IMP" -filter_complex "\
    [1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-9dB[m]; \
    [m][0:a]sidechaincompress=threshold=0.02:ratio=6:attack=5:release=250[mduck]; \
    [2:a]adelay=${T_MID}|${T_MID},volume=-4dB[s1]; \
    [3:a]adelay=${T_CUT}|${T_CUT},volume=-6dB[s2]; \
    [0:a][mduck][s1][s2]amix=inputs=4:duration=first:normalize=0,alimiter=limit=0.95[a]" \
    -map "0:v" -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
  rm -f "$TMP"
else
  ffmpeg -v error -y -i "$TMP" -i "$WH" -i "$IMP" -filter_complex "\
    [1:a]adelay=${T_MID}|${T_MID},volume=-4dB[s1]; \
    [2:a]adelay=${T_CUT}|${T_CUT},volume=-6dB[s2]; \
    [0:a][s1][s2]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.95[a]" \
    -map "0:v" -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT"
  rm -f "$TMP"
fi
echo "OK -> $OUT ($(dur "$OUT")s)"
