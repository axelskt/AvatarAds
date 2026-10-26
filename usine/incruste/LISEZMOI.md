# Format « texte incrusté » (essai validé par Axel le 26/10, hook H90 × A1-11)

Prototype (dossier de travail : `f/` images du clip, `m2/` masques, `demo/` et `demo2/` images des 2 Hook démo à 30 i/s,
`words.json` mots du hook ; CTA : `cta/f`, `cta/m2`, `cta/words.json`) :

1. `ffmpeg -i clip.mp4 f/%03d.png` puis `python3 detoure.py` — détourage de l'avatar (rembg `isnet-general-use`, ~0,6 s / image).
2. `python3 hook.py` → `oE/` : mot seul GRAND derrière la tête ; groupe de mots plus petit au-dessus de la tête ; les 2 mots
   avant le mot fort passent DEVANT en bas, les 2 démos arrivent derrière l'avatar (gauche / droite) à ce moment ; mot fort
   en vert devant, jusqu'à la fin du hook. Pas de texte choc.
3. `python3 cta.py` → `cta/o/` : consigne (« COMMENTE PLAN ») devant en bas, le reste de la phrase derrière la tête.
4. `node usine/build.mjs HOOK DEMO OUT MUSIQUE HOOK CTA --incruste --format F01 …` : l'assembleur ne remet ni zoom, ni
   tremblement, ni texte choc, ni sous-titres sur le hook et le CTA (la démo garde les siens).

Réglages par hook / photo : `incruste.json` dans le dossier de travail (essai H14 × A1-6 du 26/10) :
`{"fps": 30, "forts": ["QUALITÉ-LÀ"], "une_ligne": true, "carte": {"w": 320, "marge": 36}, "mot_seul": {"cap": 250, "chevauche": 120},
"groupes": "LAISSE-MOI / 30 SECONDES / POUR TE MONTRER / COMMENT CRÉER / UN AVATAR IA / AVEC CETTE / QUALITÉ-LÀ"}`.
Les positions derrière la tête suivent le haut du crâne mesuré sur le masque (A1-6 : −153 px par rapport à A1-11) ;
`oE/meta.json` donne `t_demo` (woosh). Tête large ou 1er mot long → `mot_seul` plus petit et plus haut (couverture lisible).

À faire pour la série : mot fort de chaque hook (banque), mots du hook depuis le cache vérifié (Whisper rate la fin sur le
clip habillé), woosh à l'arrivée des démos dans l'assembleur, intégration au lot.
