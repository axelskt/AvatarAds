#!/bin/bash
# A/B des failles 3 et 4 (audit Décupleur 30/10) : les bancs sur le code d'AVANT (commit de base, défaut 02a160f2), sur le
# 1er correctif (commit 9e56e41d, contesté en relecture le 30/10 : mc-ref hors plafond, MCP sans création atomique, découpes
# gardées d'avance dans la file, prise en panne = file bloquée), sur la 1re relecture (commit 8daf5ea5, contestée en 2e relecture :
# mc-ref dans le plafond des dc, app et MCP qui se bloquent, retouche et Générateur créés sans verrou, retouche sans plafond ni
# borne de photo, préparations qui échouent sans limite) puis sur le code du dépôt (APRÈS).
# Aucun réseau (sauf PGlite, déjà en cache), aucune vraie vidéo (mires ffmpeg synthétiques), aucune base en ligne.
# Attendu : AVANT        test-faille4-rafale 34/51 + 1 sans objet, test-faille3-file 7/31 (+ sans objet), test-faille34-mcp 10/22,
#                        test-retouche-bornes 1/5 ;
#           1er correctif 44/52, 15/34, 10/22, 1/5 ;
#           1re relecture 45/51 (15 retouches et 20 gen-subs créés en rafale), 26/34 (3e carte Claude « file encore pleine »,
#                        6/6 moteurs pris par des retouches, 0/38 rendus payés servis), 19/24, 1/5 (photo = MP4 accepté, 240 i/s,
#                        boucle bloquée) ;
#           APRÈS        53/53, 34/34, 25/25, 7/7, SQL 61/61.
#   bash tools/tests-decupleur/ab-faille34.sh [commit_avant] [commit_1er_correctif] [commit_1re_relecture]
set -u
cd "$(dirname "$0")"
BASE="${1:-02a160f2}"
PREMIER="${2:-9e56e41d}"
RELU1="${3:-8daf5ea5}"
AVANT="$(mktemp -d "${TMPDIR:-/tmp}/faille34-avant-XXXX")"
P1="$(mktemp -d "${TMPDIR:-/tmp}/faille34-1er-XXXX")"
P2="$(mktemp -d "${TMPDIR:-/tmp}/faille34-relu1-XXXX")"
trap 'rm -rf "$AVANT" "$P1" "$P2"' EXIT
FICHIERS="supabase/functions render-worker/securite.mjs render-worker/decupleur.mjs render-worker/worker.mjs render-worker/retouche.mjs"
for x in "$BASE:$AVANT" "$PREMIER:$P1" "$RELU1:$P2"; do (cd ../.. && git archive "${x%%:*}" $FICHIERS) | tar -x -C "${x#*:}"; done
lance() {   # $1 = dossier du code testé (vide = dépôt), $2 = MIGRATION (vide, 1er ou 2)
  local D="$1"
  if [ -n "$D" ]; then
    MIGRATION="$2" RJ_MODULE="$D/supabase/functions/render-job/index.ts" deno run --allow-env --allow-read --import-map=import_map_file.json test-faille4-rafale.ts | grep -E '→ [0-9]+ (jobs|retouches)|vérifications'
    SECURITE="$D/render-worker/securite.mjs" DECUPLEUR="$D/render-worker/decupleur.mjs" node test-faille3-file.mjs | grep -E '→ (moteurs|mc-ref|dc-fetch honnête|montages|carte|retouches|préparations)|vérifications'
    MIGRATION="$2" MCP_MODULE="$D/supabase/functions/mcp/index.ts" deno run --allow-env --allow-read --import-map=import_map_file.json test-faille34-mcp.ts | grep -E '→ [0-9]+ travaux|→ statuts|→ préparations|relances|vérifications'
    RETOUCHE="$D/render-worker/retouche.mjs" node test-retouche-bornes.mjs | grep -E '→|vérifications'
  else
    deno run --allow-env --allow-read --import-map=import_map_file.json test-faille4-rafale.ts | grep -E '→ [0-9]+ (jobs|retouches)|vérifications'
    node test-faille3-file.mjs | grep -E '→ (moteurs|mc-ref|dc-fetch honnête|montages|carte|retouches|préparations)|vérifications'
    deno run --allow-env --allow-read --import-map=import_map_file.json test-faille34-mcp.ts | grep -E '→ [0-9]+ travaux|→ statuts|→ préparations|relances|vérifications'
    node test-retouche-bornes.mjs | grep -E '→|vérifications'
    deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille34-sql.ts | grep -E '→|vérifications'
  fi
}
echo "════ AVANT ($BASE) ════";              lance "$AVANT" 1er
echo "════ 1er correctif ($PREMIER) ════";   lance "$P1" 1er
echo "════ 1re relecture ($RELU1) ════";     lance "$P2" 2
echo "════ APRÈS (dépôt) ════";              lance "" ""
