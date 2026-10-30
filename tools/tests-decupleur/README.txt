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
A/B (code du commit c4a25051, puis 1er correctif 484683d2 contesté en relecture, puis code du dépôt) :
   bash tools/tests-decupleur/ab-faille2.sh
   → AVANT 14/30 et 12/37 (live accepté, yt-dlp lancé, ffmpeg orphelin vivant qui grossit, filtre « <=? », aucun --use-extractors)
   → 1er correctif 21/30 et 21/37 (relecture 30/10 : « /live%3Fx », « /live;x », « /live. », « /live%23 », « /lively »… acceptés
     et envoyés à yt-dlp ; _MEI* du chargeur PyInstaller laissé dans /tmp au délai (SIGKILL d'emblée) ; Reel Instagram sans
     durée connue refusé « trop longue » par le filtre sans « ? »)
   → APRÈS 30/30 et 37/37 (clients honnêtes : TikTok 30 s, sans www, lien court vm, partage Instagram, Reel sans durée → récupérés).
   Le faux yt-dlp imite le chargeur PyInstaller (dossier $TMPDIR/_MEI<pid> effacé seulement à une sortie propre) ; S3c le rend
   sourd à SIGTERM (SIGKILL de secours) ; S11 rejoue les contournements avec --use-extractors élargi à « default ».

Déploiement du correctif faille 2 :
   1. Aucune migration.
   2. render-worker sur Railway (decupleur.mjs + Dockerfile : tini, ENTRYPOINT). Vérifier dans Railway qu'aucune « Custom Start
      Command » ne remplace l'ENTRYPOINT ; au premier démarrage, « ps -o pid,comm 1 » dans le conteneur doit montrer tini.
   3. Fonctions : supabase functions deploy render-job ; supabase functions deploy mcp (message « live » ; _shared/decupleur.ts).
      kie-proxy importe _shared/decupleur.ts mais n'utilise pas lienDecupleur : rien à redéployer.
   Ordre : moteur (Railway) EN PREMIER — c'est lui qui lance yt-dlp (délai SIGTERM puis SIGKILL du groupe, TMPDIR du job,
   filtre, extracteurs) ; les fonctions ensuite (refus plus tôt, message clair). Chacun refuse seul les variantes de « /live ». Le moteur LOCAL du Mac (tools/decupleur-local.sh,
   DC_LOCAL=1) ne prend QUE les jobs « decupleur » (prochainJob, securite.mjs), jamais dc-fetch : rien d'obligatoire
   (un git pull + relance garde simplement sa copie à jour).

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Failles 6, 7 et 8 (30/10). Aucun réseau (sauf PGlite pris dans le cache npm de Deno), aucune vraie vidéo, aucun fournisseur.
   · test-faille6-filet.ts : les DEUX filets du MCP (GET /mcp du cron → reconcileAllStale ; appel d'outil → reconcileStaleJobs)
     sur un job à l'étape dj: (lot de variantes lancé) ; moteur de rendu factice.
       cd tools/tests-decupleur && deno run --allow-env --allow-read --import-map=import_map.json test-faille6-filet.ts
   · test-faille7-nsfw.ts : corps envoyé à kie CAPTURÉ (kie-proxy wan-3 : client Pro, propriétaire, developer ; MCP decupler_video)
     + refus du filtre (« DataInspectionFailed ») : remboursement (kie-proxy KIE_NO_FALLBACK, MCP étape dw:) et phrase de l'app.
       deno run --allow-env --allow-read --allow-write --allow-run=ffmpeg --import-map=import_map_f7.json test-faille7-nsfw.ts
       (fake-supabase-f7.ts : liens signés au format Supabase + jeton lu dans l'en-tête, pour kie-proxy)
   · test-faille8-messages.mjs : ce que le moteur ÉCRIT dans render_jobs.error / trace d'un job Décupleur (dcFetch avec un faux
     yt-dlp, dcProbe, dcVariantes ; capture de trace = PHASES + ouvrirTrace extraits de worker.mjs ; câblage relu dans worker.mjs).
       node test-faille8-messages.mjs
   · test-faille8-trace-sql.ts : migration 20261030180800 sur un vrai Postgres (PGlite) : trace illisible pour authenticated.
       deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille8-trace-sql.ts
A/B (code du commit 3c00be72, base sans la migration, puis code du dépôt) :
   bash tools/tests-decupleur/ab-faille678.sh
   → AVANT 6/26, 3/7, 5/14, 4/5 (lot en cours remboursé à 60 min puis livré quand même ; lot en file > 6 h jamais arrêté ;
     nsfw_checker false partout ; refus anglais brut dans l'app ; « Command failed: ffprobe … /var/…/aa-job-…/base.mp4 » et ligne
     « ERROR: » de yt-dlp dans error / trace ; « N cœur(s) · quota CPU » dans la trace ; trace lisible par le client)
   → APRÈS 26/26, 7/7, 14/14, 5/5 (lien TikTok normal récupéré, lot de 5 variantes rendu, parcours MCP normal livré).

Déploiement failles 6-8 (ordre) :
   1. Migration : supabase db push (20261030180800_render_jobs_trace_privee.sql). Indépendante du reste.
   2. render-worker sur Railway (decupleur.mjs + worker.mjs). Moteur LOCAL du Mac (DC_LOCAL=1) : il rend des lots decupleur →
      git pull dans ~/.avatarads/moteur puis relance (sinon ses lots gardent l'ancienne trace / les anciennes erreurs).
   3. Fonctions : supabase functions deploy mcp ; supabase functions deploy kie-proxy.
   4. Site (app/index.html : phrase du refus du filtre) : déploiement GitHub Pages habituel.
