#!/usr/bin/env bash
# Déploie l'edge function orchestrate. À lancer une fois `supabase login --token …` fait.
#   ./deploy-orchestrate.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f "$HOME/.supabase/access-token" ] && [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "❌ Pas de jeton Supabase."
  echo
  echo "   1. Ouvre https://supabase.com/dashboard/account/tokens"
  echo "   2. « Generate new token », copie-le (il commence par sbp_)"
  echo "   3. supabase login --token sbp_le_token_copié"
  echo
  echo "   Aucun navigateur à ouvrir, et le jeton reste chez toi."
  exit 1
fi

echo "▶ vérification TypeScript…"
deno check --no-lock supabase/functions/orchestrate/index.ts

echo "▶ déploiement…"
supabase functions deploy orchestrate --project-ref guvwgiejzkiodghywpwj

echo "✅ orchestrate déployée."
