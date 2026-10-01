#!/bin/bash
# Sauvegarde du CODE (pas des médias) de tous les projets vers Supabase Storage, bucket PRIVÉ « sauvegardes » (Axel 01/10).
# Contenu : ~/Downloads/Autre SaaS (tous les projets, y compris ceux qui ne sont pas sur GitHub), ~/Downloads/Creative Factory
# (scripts, briefs, registres), la mémoire et les skills de Claude. Seulement html/css/js/ts/json/md/py/sh/sql/svg… < 5 Mo.
# Jamais : vidéos, audio, node_modules, .git, caches, ni aucun fichier de clé (.env, *secret*, *token*, *.key, netlify.toml).
# Contrôle anti-secret avant envoi : une clé d'API trouvée dans un fichier = arrêt, rien n'est envoyé.
# Récupérer : dashboard Supabase → Storage → sauvegardes → télécharger, puis `tar -xzf sauvegarde-code-AAAA-MM-JJ.tar.gz`.
# Usage : bash tools/sauvegarde.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DAY=$(date +%Y-%m-%d)
TMP=$(mktemp -d)
LIST="$TMP/liste.txt"
ARCH="$TMP/sauvegarde-code-$DAY.tar.gz"
cd "$HOME"
find "Downloads/Autre SaaS" "Downloads/Creative Factory" ".claude/projects/-Users-axelskotnicki/memory" ".claude/skills" \
  \( -name node_modules -o -name .git -o -name .next -o -name dist -o -name .venv -o -name __pycache__ -o -name cache -o -name .cache \
     -o -name words-cache -o -name hyperframes-extract-cache -o -name .temp -o -name .netlify -o -name .vercel -o -name renders -o -name out \) -prune -o \
  -type f -size -5M \( -iname "*.html" -o -iname "*.css" -o -iname "*.js" -o -iname "*.mjs" -o -iname "*.cjs" -o -iname "*.ts" -o -iname "*.tsx" \
     -o -iname "*.jsx" -o -iname "*.json" -o -iname "*.md" -o -iname "*.py" -o -iname "*.sh" -o -iname "*.swift" -o -iname "*.sql" -o -iname "*.toml" \
     -o -iname "*.yml" -o -iname "*.yaml" -o -iname "*.svg" -o -iname "Dockerfile*" -o -iname "_headers" -o -iname "_redirects" \) \
  ! -iname ".env*" ! -iname "*secret*" ! -iname "*credential*" ! -iname "*token*" ! -iname "package-lock.json" ! -name "netlify.toml" ! -name "factory.key" \
  -print > "$LIST" 2>/dev/null || true
N=$(wc -l < "$LIST" | tr -d ' ')
# anti-secret : noms des fichiers seulement, jamais les valeurs
BAD=$(tr '\n' '\0' < "$LIST" | xargs -0 grep -lE "sk-[A-Za-z0-9_-]{20,}|sk_live_|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|re_[A-Za-z0-9]{20,}|xox[bp]-|SUPABASE_SERVICE_ROLE_KEY=[^ \$]{10,}" 2>/dev/null || true)
if [ -n "$BAD" ]; then echo "✗ clé secrète repérée, rien n'est envoyé — fichiers :"; echo "$BAD"; rm -rf "$TMP"; exit 1; fi
tar -czf "$ARCH" -T "$LIST"
echo "archive : $N fichiers, $(du -h "$ARCH" | cut -f1)"
cd "$REPO"
supabase storage cp --experimental --linked "$ARCH" "ss:///sauvegardes/$(basename "$ARCH")" --content-type application/gzip >/dev/null
echo "✓ envoyé dans Supabase → Storage → sauvegardes/$(basename "$ARCH")"
rm -rf "$TMP"
