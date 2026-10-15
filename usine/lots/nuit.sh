#!/bin/bash
# Creative Factory — enchaîne les lots de 30 jusqu'à épuiser le stock d'assemblages (Axel 15/10 : « le max ce soir »).
# usage (depuis la racine du repo, rattaché à la session — JAMAIS nohup) : bash usine/lots/nuit.sh <préfixe> [lot à attendre]
W="${CF_LOT_DIR:-$HOME/Downloads/Creative Factory/cache/lots}"; P="${1:-nuit}"
[ -n "$2" ] && while pgrep -f "lot.py .* $2\$" >/dev/null; do sleep 20; done
for i in $(seq 1 20); do
  N="$P-$i"; python3 usine/lots/lot.py 6 5 "$N" > "$W/$N.log" 2>&1 || { echo "$N : arrêt (code $?)"; break; }
  ok=$(grep -o 'FIN [^:]*: [0-9]* OK' "$W/$N.log" | grep -o '[0-9]* OK' | grep -o '[0-9]*'); echo "$N : ${ok:-0} OK"
  [ "${ok:-0}" -lt 5 ] && break   # stock épuisé
done
