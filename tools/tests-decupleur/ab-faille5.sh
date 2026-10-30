#!/bin/bash
# A/B de la faille 5 (audit Décupleur 30/10) : le banc test-faille5.ts sur supabase/functions du commit d'AVANT (défaut
# 3c00be72 : faille 1 et 2 corrigées, faille 5 ouverte), puis sur le code du dépôt (APRÈS). Aucun réseau, aucune vraie vidéo.
#   bash tools/tests-decupleur/ab-faille5.sh [commit_avant]
set -u
cd "$(dirname "$0")"
BASE="${1:-3c00be72}"
AVANT="$(mktemp -d "${TMPDIR:-/tmp}/faille5-avant-XXXX")"
trap 'rm -rf "$AVANT"' EXIT
git -C ../.. archive "$BASE" supabase/functions | tar -x -C "$AVANT"
echo "════ AVANT ($BASE) ════"
F5_FUNCS="$AVANT/supabase/functions" deno run --allow-env --allow-read --import-map=import_map_f5.json test-faille5.ts
echo "════ APRÈS (dépôt) ════"
deno run --allow-env --allow-read --import-map=import_map_f5.json test-faille5.ts
