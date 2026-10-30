Banc de l'audit Décupleur du 30/10 (faille 1 : changement de personnage obtenu gratuitement par l'outil Claude). Aucun appel
réel : base, stockage, kie.ai et moteur de rendu factices ; code réel de supabase/functions/mcp/index.ts (route /status) et
de render-worker/securite.mjs. Aucun réseau autorisé (pas de --allow-net).

   cd tools/tests-decupleur && deno run --allow-env --allow-read --import-map=import_map.json test-decupleur-perso.ts
   → « 26/26 vérifications OK ». Avant le correctif : 16/26 (153 crédits rendus, vidéo du personnage gardée).

Déploiement du correctif (ordre obligatoire : les moteurs AVANT la fonction mcp, sinon les lots sur mcp-prep/<uid>/ sont refusés
« Fichier d'entrée refusé ») :
   1. Aucune migration.
   2. Moteurs de rendu, TOUS avant la fonction :
      a. render-worker sur Railway (securite.mjs + worker.mjs).
      b. Moteur LOCAL du Décupleur sur le Mac (tools/decupleur-local.sh, DC_LOCAL=1) : il prend EN PREMIER les lots des comptes
         propriétaire / developer (Railway ne les prend qu'au bout de 15 s). Il tourne depuis sa propre copie
         ~/.avatarads/moteur (pas depuis le dépôt de travail) : y faire `git pull` (code à jour), puis arrêter le script (ctrl+C)
         et le relancer. Ou simplement l'arrêter : Railway prend alors ces lots après 15 s.
   3. Fonction mcp : supabase functions deploy mcp.
   4. Rien à redéployer pour purge-decupleur, render-job, kie-proxy.

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Faille 2 (lien de live TikTok : le ffmpeg lancé par yt-dlp restait orphelin et enregistrait le direct dans /tmp).
Deux bancs, aucun réseau, aucune vraie vidéo :
   · test-faille2-lien.ts  : lienDecupleur (supabase/functions/_shared/decupleur.ts) — liens de live refusés, liens honnêtes acceptés ;
   · test-faille2-moteur.mjs : dcFetch réel (render-worker/decupleur.mjs, délai ramené à 3 s dans une copie) avec un faux yt-dlp
     (faux-ytdlp/) qui applique le VRAI choix d'extracteur et le VRAI --match-filter de yt-dlp (bibliothèque installée par
     Homebrew, ytdlp-reel.py ; YTDLP_PY pour un autre Python). Ses faux ffmpeg écrivent sans fin : le banc compte ceux qui
     survivent au job, puis les tue.
A/B (code du commit c4a25051 puis code du dépôt) :
   bash tools/tests-decupleur/ab-faille2.sh
   → AVANT 9/16 et 9/18 (live accepté, yt-dlp lancé, ffmpeg orphelin vivant qui grossit, filtre « <=? », aucun --use-extractors)
   → APRÈS 16/16 et 18/18 (clients honnêtes : TikTok 30 s, sans www, lien court vm, partage Instagram → toujours récupérés).

Déploiement du correctif faille 2 :
   1. Aucune migration.
   2. render-worker sur Railway (decupleur.mjs + Dockerfile : tini, ENTRYPOINT). Vérifier dans Railway qu'aucune « Custom Start
      Command » ne remplace l'ENTRYPOINT ; au premier démarrage, « ps -o pid,comm 1 » dans le conteneur doit montrer tini.
   3. Fonctions : supabase functions deploy render-job ; supabase functions deploy mcp (message « live » ; _shared/decupleur.ts).
      kie-proxy importe _shared/decupleur.ts mais n'utilise pas lienDecupleur : rien à redéployer.
   L'ordre moteur / fonctions est libre : chacun refuse les lives seul. Le moteur LOCAL du Mac (tools/decupleur-local.sh,
   DC_LOCAL=1) ne prend QUE les jobs « decupleur » (prochainJob, securite.mjs), jamais dc-fetch : rien d'obligatoire
   (un git pull + relance garde simplement sa copie à jour).
