#!/bin/bash
# A/B des failles 3 et 4 (audit Décupleur 30/10) : les bancs sur le code d'AVANT (commit de base, défaut 02a160f2), sur le
# 1er correctif (commit 9e56e41d, contesté en relecture le 30/10 : mc-ref hors plafond, MCP sans création atomique, découpes
# gardées d'avance dans la file, prise en panne = file bloquée) puis sur le code du dépôt (APRÈS).
# Aucun réseau (sauf PGlite, déjà en cache), aucune vraie vidéo, aucune base en ligne.
# Attendu : AVANT        test-faille4-rafale 21/35 + 1 sans objet (30 jobs créés pour 30 requêtes simultanées), test-faille3-file 7/21
#                        (6/6 moteurs pris, 8/38 rendus payés servis en 30 min), test-faille34-mcp 10/17 (30 /start → 30 jobs) ;
#           1er correctif 33/37 (30 dc-cut → 3 en file), 15/24 (6/6 moteurs pris par des mc-ref, client honnête servi à
#                        t=1800 s, 0/10 montages servis et 3606 appels quand la prise est en panne), 10/17 (30 /start → 30 jobs) ;
#           APRÈS        37/37, 24/24, 20/20, SQL 37/37.
#   bash tools/tests-decupleur/ab-faille34.sh [commit_avant] [commit_1er_correctif]
set -u
cd "$(dirname "$0")"
BASE="${1:-02a160f2}"
PREMIER="${2:-9e56e41d}"
AVANT="$(mktemp -d "${TMPDIR:-/tmp}/faille34-avant-XXXX")"
P1="$(mktemp -d "${TMPDIR:-/tmp}/faille34-1er-XXXX")"
trap 'rm -rf "$AVANT" "$P1"' EXIT
(cd ../.. && git archive "$BASE" supabase/functions render-worker/securite.mjs render-worker/decupleur.mjs) | tar -x -C "$AVANT"
(cd ../.. && git archive "$PREMIER" supabase/functions render-worker/securite.mjs render-worker/decupleur.mjs) | tar -x -C "$P1"
lance() {   # $1 = dossier du code testé (vide = dépôt), $2 = MIGRATION (vide ou 1er)
  local D="$1"
  if [ -n "$D" ]; then
    MIGRATION="$2" RJ_MODULE="$D/supabase/functions/render-job/index.ts" deno run --allow-env --allow-read --import-map=import_map_file.json test-faille4-rafale.ts | grep -E '→ [0-9]+ jobs dc-(fetch|cut)|vérifications'
    SECURITE="$D/render-worker/securite.mjs" DECUPLEUR="$D/render-worker/decupleur.mjs" node test-faille3-file.mjs | grep -E '→ (moteurs|mc-ref|dc-fetch honnête|montages)|vérifications'
    MIGRATION="$2" MCP_MODULE="$D/supabase/functions/mcp/index.ts" deno run --allow-env --allow-read --import-map=import_map_file.json test-faille34-mcp.ts | grep -E '→ [0-9]+ travaux|vérifications'
  else
    deno run --allow-env --allow-read --import-map=import_map_file.json test-faille4-rafale.ts | grep -E '→ [0-9]+ jobs dc-(fetch|cut)|vérifications'
    node test-faille3-file.mjs | grep -E '→ (moteurs|mc-ref|dc-fetch honnête|montages)|vérifications'
    deno run --allow-env --allow-read --import-map=import_map_file.json test-faille34-mcp.ts | grep -E '→ [0-9]+ travaux|vérifications'
    deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille34-sql.ts | grep -E '→|vérifications'
  fi
}
echo "════ AVANT ($BASE) ════";            lance "$AVANT" 1er
echo "════ 1er correctif ($PREMIER) ════"; lance "$P1" 1er
echo "════ APRÈS (dépôt) ════";            lance "" ""
