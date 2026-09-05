#!/usr/bin/env bash
# Dérive edge functions : ce qui est DÉPLOYÉ sur Supabase vs ce qui est dans le DÉPÔT.
#
# Audit supply-chain 06/09/2026 (SC-3) : replicate-proxy et removebg-proxy tournaient en prod depuis
# des mois sans exister dans le dépôt → jamais versionnées, jamais auditées (3 audits les ont ratées),
# hors garde partagée. Ce script rend la dérive visible en 2 secondes.
#   ./tools/functions-drift.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REF=guvwgiejzkiodghywpwj

deployed=$(supabase functions list --project-ref "$REF" -o json \
  | python3 -c 'import sys,json; print("\n".join(sorted(f["slug"] for f in json.load(sys.stdin))))')
local_=$(ls -1 supabase/functions | grep -v '^_shared$' | sort)

echo "── Déployées mais ABSENTES du dépôt (à rapatrier ou supprimer) :"
comm -23 <(echo "$deployed") <(echo "$local_") | sed 's/^/  ⚠  /'
echo "── Dans le dépôt mais NON déployées :"
comm -13 <(echo "$deployed") <(echo "$local_") | sed 's/^/  ·  /'
