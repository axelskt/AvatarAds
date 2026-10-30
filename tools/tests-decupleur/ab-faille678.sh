#!/bin/bash
# A/B des failles 6, 7 et 8 (audit Décupleur 30/10) : les bancs sur le code d'AVANT (commit de base, défaut 3c00be72 : fonctions,
# moteur, app ; base SANS la migration 20261030180800) puis sur le code du dépôt (APRÈS). Aucun réseau (sauf PGlite depuis le
# cache npm de Deno), aucune vraie vidéo, aucun appel à un fournisseur.
# Attendu : AVANT 6/26, 3/7, 5/14, 4/5 ; APRÈS 26/26, 7/7, 14/14, 5/5.
#   bash tools/tests-decupleur/ab-faille678.sh [commit_avant]
set -u
cd "$(dirname "$0")"
BASE="${1:-3c00be72}"
AVANT="$(mktemp -d "${TMPDIR:-/tmp}/faille678-avant-XXXX")"
trap 'rm -rf "$AVANT"' EXIT
git -C "$(git rev-parse --show-toplevel)" archive "$BASE" supabase/functions | tar -x -C "$AVANT"
git show "$BASE:app/index.html" > "$AVANT/app-index.html"
git show "$BASE:render-worker/decupleur.mjs" > "$AVANT/decupleur.mjs"
git show "$BASE:render-worker/worker.mjs" > "$AVANT/worker.mjs"
F="$AVANT/supabase/functions"
echo "════ AVANT ($BASE) ════"
MCP_INDEX="$F/mcp/index.ts" deno run --allow-env --allow-read --import-map=import_map.json test-faille6-filet.ts | tail -1
FONCTIONS="$F" APP_HTML="$AVANT/app-index.html" deno run --allow-env --allow-read --allow-write --allow-run=ffmpeg --import-map=import_map_f7.json test-faille7-nsfw.ts | tail -1
DC_MODULE="$AVANT/decupleur.mjs" WORKER="$AVANT/worker.mjs" node test-faille8-messages.mjs 2>/dev/null | tail -1
SANS_MIGRATION=1 deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille8-trace-sql.ts | tail -1
echo "════ APRÈS (dépôt) ════"
deno run --allow-env --allow-read --import-map=import_map.json test-faille6-filet.ts | tail -1
deno run --allow-env --allow-read --allow-write --allow-run=ffmpeg --import-map=import_map_f7.json test-faille7-nsfw.ts | tail -1
node test-faille8-messages.mjs 2>/dev/null | tail -1
deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille8-trace-sql.ts | tail -1
