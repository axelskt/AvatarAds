#!/bin/bash
# A/B de la faille 2 (audit Décupleur 30/10) : les deux bancs sur le code d'AVANT (commit de base, défaut c4a25051), sur le
# PREMIER correctif (défaut 484683d2, celui que la relecture a contesté) puis sur le code du dépôt (APRÈS). Aucun réseau,
# aucune vraie vidéo. Attendu : AVANT 14/30 et 12/37 ; 1er correctif 21/30 et 21/37 ; APRÈS 30/30 et 37/37.
#   bash tools/tests-decupleur/ab-faille2.sh [commit_avant] [commit_premier_correctif]
set -u
cd "$(dirname "$0")"
BASE="${1:-c4a25051}"
PREMIER="${2:-484683d2}"
AVANT="$(mktemp -d "${TMPDIR:-/tmp}/faille2-avant-XXXX")"
trap 'rm -rf "$AVANT"' EXIT
for c in "$BASE" "$PREMIER"; do
  mkdir -p "$AVANT/$c"
  git show "$c:supabase/functions/_shared/decupleur.ts" > "$AVANT/$c/decupleur.ts"
  git show "$c:render-worker/decupleur.mjs" > "$AVANT/$c/decupleur.mjs"
done
echo "════ AVANT ($BASE) ════"
DC_SHARED="$AVANT/$BASE/decupleur.ts" deno run --allow-read --allow-env test-faille2-lien.ts | tail -1
DC_MODULE="$AVANT/$BASE/decupleur.mjs" node test-faille2-moteur.mjs | tail -1
echo "════ PREMIER CORRECTIF ($PREMIER) ════"
DC_SHARED="$AVANT/$PREMIER/decupleur.ts" deno run --allow-read --allow-env test-faille2-lien.ts | tail -1
DC_MODULE="$AVANT/$PREMIER/decupleur.mjs" node test-faille2-moteur.mjs | tail -1
echo "════ APRÈS (dépôt) ════"
deno run --allow-read --allow-env test-faille2-lien.ts | tail -1
node test-faille2-moteur.mjs | tail -1
