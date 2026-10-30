#!/bin/bash
# A/B des failles 3 et 4 (audit Décupleur 30/10) : les bancs sur le code d'AVANT (commit de base, défaut 02a160f2) puis sur le
# code du dépôt (APRÈS). Aucun réseau (sauf PGlite, déjà en cache), aucune vraie vidéo, aucune base en ligne.
# Attendu : AVANT  test-faille4-rafale 19/29 (30 jobs créés pour 30 requêtes simultanées), test-faille3-file 5/14
#                  (6/6 moteurs pris par les récupérations, 8/38 rendus payés servis en 30 min), SQL A = 30 jobs ;
#           APRÈS  31/31, 15/15, 24/24.
#   bash tools/tests-decupleur/ab-faille34.sh [commit_avant]
set -u
cd "$(dirname "$0")"
BASE="${1:-02a160f2}"
AVANT="$(mktemp -d "${TMPDIR:-/tmp}/faille34-avant-XXXX")"
trap 'rm -rf "$AVANT"' EXIT
(cd ../.. && git archive "$BASE" supabase/functions render-worker/securite.mjs render-worker/decupleur.mjs) | tar -x -C "$AVANT"
echo "════ AVANT ($BASE) ════"
RJ_MODULE="$AVANT/supabase/functions/render-job/index.ts" deno run --allow-env --allow-read --import-map=import_map_file.json test-faille4-rafale.ts | grep -E '→ [0-9]+ jobs dc-fetch|vérifications'
SECURITE="$AVANT/render-worker/securite.mjs" DECUPLEUR="$AVANT/render-worker/decupleur.mjs" node test-faille3-file.mjs | grep -E '→ moteurs|vérifications'
echo "════ APRÈS (dépôt) ════"
deno run --allow-env --allow-read --import-map=import_map_file.json test-faille4-rafale.ts | grep -E '→ [0-9]+ jobs dc-fetch|vérifications'
node test-faille3-file.mjs | grep -E '→ moteurs|vérifications'
deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille34-sql.ts | grep -E '→|vérifications'
