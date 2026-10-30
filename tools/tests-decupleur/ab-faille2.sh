#!/bin/bash
# A/B de la faille 2 (audit Décupleur 30/10) : les deux bancs sur le code d'AVANT (commit de base, défaut c4a25051) puis sur
# le code du dépôt (APRÈS). Aucun réseau, aucune vraie vidéo. Attendu : AVANT 9/16 et 9/18, APRÈS 16/16 et 18/18.
#   bash tools/tests-decupleur/ab-faille2.sh [commit_avant]
set -u
cd "$(dirname "$0")"
BASE="${1:-c4a25051}"
AVANT="$(mktemp -d "${TMPDIR:-/tmp}/faille2-avant-XXXX")"
trap 'rm -rf "$AVANT"' EXIT
git show "$BASE:supabase/functions/_shared/decupleur.ts" > "$AVANT/decupleur.ts"
git show "$BASE:render-worker/decupleur.mjs" > "$AVANT/decupleur.mjs"
echo "════ AVANT ($BASE) ════"
DC_SHARED="$AVANT/decupleur.ts" deno run --allow-read --allow-env test-faille2-lien.ts | tail -1
DC_MODULE="$AVANT/decupleur.mjs" node test-faille2-moteur.mjs | tail -1
echo "════ APRÈS (dépôt) ════"
deno run --allow-read --allow-env test-faille2-lien.ts | tail -1
node test-faille2-moteur.mjs | tail -1
