#!/usr/bin/env bash
# Déploie l'edge function orchestrate. À lancer une fois `supabase login --token …` fait.
#   ./deploy-orchestrate.sh
set -euo pipefail
cd "$(dirname "$0")"

# La CLI range le jeton dans le trousseau macOS, pas dans un fichier : on teste
# donc l'authentification pour de vrai plutôt que la présence de ~/.supabase.
if ! supabase projects list >/dev/null 2>&1; then
  echo "❌ Pas connecté à Supabase. Lance :  supabase login"
  echo "   (un code s'affiche dans le navigateur, à recoller dans le terminal)"
  exit 1
fi

echo "▶ vérification TypeScript…"
deno check --no-lock supabase/functions/orchestrate/index.ts

echo "▶ déploiement…"
supabase functions deploy orchestrate --project-ref guvwgiejzkiodghywpwj

echo "✅ orchestrate déployée."
