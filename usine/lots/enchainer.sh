#!/bin/zsh
# Creative Factory — ENCHAÎNE des lots (6 séries × 5 = 30 vidéos) tant que la batterie du Mac reste au-dessus d'un seuil.
# Axel 19/10 : « une fois les 30 finis relance en 30, et ça jusqu'à ce que j'atteigne 10 % de batterie ».
#   · attend la fin du lot déjà en cours (s'il y en a un), puis lance <préfixe>b, <préfixe>c… avec les mêmes PHOTOS ;
#   · une sonde lit la batterie toutes les 30 s PENDANT un lot : au seuil, le lot est coupé (lot.py est reprenable :
#     `python3 usine/lots/lot.py 6 5 <nom>` relance la suite) et l'enchaînement s'arrête ;
#   · s'arrête aussi quand un lot ne rend plus rien (plus de recette nouvelle) ;
#   · caffeinate empêche la mise en veille tant que ça tourne (un capot fermé l'endort quand même).
# usage : PHOTOS=A3-7,A3-8,A3-9,A3-10,A3-11 usine/lots/enchainer.sh lot-1910 10 [lot en cours à attendre]
# journal : ~/Downloads/Creative Factory/cache/lots/enchainer-<préfixe>.log (+ un .log par lot)
PRE=${1:?préfixe}; SEUIL=${2:-10}; ATTENDRE=$3
REPO=${0:A:h:h:h}; DIR=${CF_LOT_DIR:-$HOME/Downloads/Creative Factory/cache/lots}; J="$DIR/enchainer-$PRE.log"
batt() { pmset -g batt | grep -o '[0-9]*%' | head -1 | tr -d % }
say() { print -r -- "$(date +%H:%M:%S) $*" >> "$J" }
# 19/10 : `setopt monitor` ne crée PAS de groupe de processus dans un script (le lot partageait celui de l'enchaîneur) →
# « kill -- -PID » ne touchait rien et le lot a continué à 10 % de batterie. On arrête donc l'ARBRE du lot : lot.py, ses
# node build.mjs et leurs navigateurs de capture, des feuilles vers la racine, puis on vérifie.
arbre() { local p; for p in $(pgrep -P $1); do arbre $p; done; print $1 }
tuer_lot() {
  local pids=($(arbre $1)); kill -TERM $pids 2>/dev/null; sleep 4; kill -KILL $pids 2>/dev/null
  pkill -KILL -f "usine/build.mjs" 2>/dev/null; sleep 1
  pgrep -f "lot.py 6 5 $2\$|usine/build.mjs" >/dev/null && say "⚠ des processus du lot $2 tournent encore" || say "lot $2 arrêté (aucun processus restant)"
}
caffeinate -i -w $$ &
if [[ -n $ATTENDRE ]]; then
  say "attente de la fin de $ATTENDRE"
  while pgrep -f "lot.py 6 5 $ATTENDRE\$" >/dev/null; do sleep 20; done
  say "$ATTENDRE terminé : $(grep -h '^.* FIN ' "$DIR/$ATTENDRE.log" | tail -1)"
fi
for L in b c d e f g h i j k l m n o p q r s t u v w x y z; do
  NOM=$PRE$L; B=$(batt)
  [[ -f "$DIR/$NOM.json" ]] && continue   # lot déjà lancé (état présent) : on passe au suivant
  if (( B <= SEUIL )); then say "batterie $B % ≤ $SEUIL % : arrêt avant $NOM"; break; fi
  say "lancement $NOM (batterie $B %)"
  (cd "$REPO" && exec python3 usine/lots/lot.py 6 5 $NOM > "$DIR/$NOM.log" 2>&1) &
  PID=$!; COUPE=0
  while kill -0 $PID 2>/dev/null; do
    sleep 30; B=$(batt)
    if (( B <= SEUIL )); then say "batterie $B % ≤ $SEUIL % : $NOM coupé (reprendre : python3 usine/lots/lot.py 6 5 $NOM)"; tuer_lot $PID $NOM; COUPE=1; break; fi
  done
  wait $PID 2>/dev/null
  FIN=$(grep -h ' FIN ' "$DIR/$NOM.log" | tail -1); say "$NOM : ${FIN:-pas de ligne FIN} · ✗ $(grep -c '✗' "$DIR/$NOM.log")"
  (( COUPE )) && break
  OK=$(print -r -- "$FIN" | grep -o '[0-9]* OK' | grep -o '[0-9]*')
  if [[ -z $OK || $OK == 0 ]]; then say "$NOM n'a rien rendu : arrêt (plus de recette nouvelle ?)"; break; fi
done
say "enchaînement terminé (batterie $(batt) %)"
