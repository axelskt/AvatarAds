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
   0. DEPUIS UNE COPIE PROPRE, jamais depuis wt-dcfix tel quel (relecture 30/10). « supabase functions deploy » et « railway up »
      envoient les fichiers SUR DISQUE, pas le commit : wt-dcfix porte aussi, non committé, le lot des failles 3 et 4
      (render-job/index.ts, render-worker/{worker,securite,decupleur}.mjs, migration 20261030140000). Ce render-job-là crée TOUS
      les jobs Décupleur (dc-fetch, dc-cut, decupleur) par render_job_dc_creer, qui n'existe que dans cette migration non
      appliquée → 503 « Création impossible » pour tout le monde ; railway up enverrait en plus DC_FETCH_MS à 90 s.
      Deux façons correctes :
        A. Faille 2 seule : copie propre du commit de la faille 2 (HEAD de dc-fix-securite au moment du déploiement, tant que le
           lot 3-4 n'y est pas committé ; 3c00be72 ou plus récent) :
              git worktree add ../wt-deploy-f2 <commit>   puis TOUT déployer depuis ../wt-deploy-f2
           Contrôle avant chaque commande : « git status --porcelain -- render-worker supabase » vide, et
           « grep -c render_job_dc_creer supabase/functions/render-job/index.ts » = 0.
        B. Avec le lot 3-4 : seulement après l'avoir committé, et en appliquant SA migration (20261030140000) EN PREMIER, avant
           render-job ; puis suivre l'ordre de déploiement de ce lot.
   1. Aucune migration (cas A).
   2. render-worker sur Railway (decupleur.mjs + Dockerfile : tini, ENTRYPOINT). Vérifier dans Railway qu'aucune « Custom Start
      Command » ne remplace l'ENTRYPOINT ; au premier démarrage, « ps -o pid,comm 1 » dans le conteneur doit montrer tini.
   3. Fonctions : supabase functions deploy render-job ; supabase functions deploy mcp (message « live » ; _shared/decupleur.ts).
      kie-proxy importe _shared/decupleur.ts mais n'utilise pas lienDecupleur : rien à redéployer.
   Ordre : moteur (Railway) EN PREMIER — c'est lui qui lance yt-dlp (délai SIGTERM puis SIGKILL du groupe, TMPDIR du job,
   filtre, extracteurs) ; les fonctions ensuite (refus plus tôt, message clair). Chacun refuse seul les variantes de « /live ». Le moteur LOCAL du Mac (tools/decupleur-local.sh,
   DC_LOCAL=1) ne prend QUE les jobs « decupleur » (prochainJob, securite.mjs), jamais dc-fetch : rien d'obligatoire
   (un git pull + relance garde simplement sa copie à jour).

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Failles 3 et 4 (dc-fetch / dc-cut gratuits servis devant tous les rendus payés ; plafond « 3 jobs en cours par compte »
contourné par 30 requêtes simultanées). Trois bancs, aucun réseau, aucune base en ligne, aucune vraie vidéo :
   · test-faille4-rafale.ts : code RÉEL de render-job (dc-fetch, dc-cut, decupleur) sur une base factice avec latence
     (fake-supabase-file.ts, import_map_file.json) — 30 requêtes simultanées, quota, client honnête, lots payés, panne ;
       deno run --allow-env --allow-read --import-map=import_map_file.json test-faille4-rafale.ts
   · test-faille3-file.mjs : prochainJob RÉEL (render-worker/securite.mjs) + prise en charge de pollLoop, 6 moteurs simulés
     en temps virtuel (30 min d'attaque par 3 comptes, ordre retouche > Rendu prioritaire > reste, client honnête) ;
       node test-faille3-file.mjs
   · test-faille34-sql.ts : la migration 20261030140000 sur un vrai Postgres en mémoire (PGlite, déjà en cache) — atomicité,
     quota, render_claim_dc, déclencheur « Rendu prioritaire », EXECUTE réservé à service_role ;
       deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-faille34-sql.ts
A/B : bash tools/tests-decupleur/ab-faille34.sh   (AVANT = 02a160f2)
   → AVANT  19/29 (30 jobs dc-fetch créés pour 30 requêtes) et 5/14 (6/6 moteurs pris, 8/38 rendus payés servis en 30 min,
            Rendu prioritaire jamais servi, délai yt-dlp 240 s)
   → APRÈS  31/31 (1 job créé, 29 refus 429 lisibles), 15/15 (2/6 moteurs au plus, 38/38 rendus payés servis), SQL 24/24.

Déploiement des failles 3 et 4 (depuis une copie propre du commit, jamais depuis un arbre modifié) — ORDRE OBLIGATOIRE :
   1. Migration 20261030140000_decupleur_file_atomique.sql (render_job_dc_creer + render_claim_dc) EN PREMIER : le nouveau
      render-job crée TOUS les jobs Décupleur par render_job_dc_creer (absente → 503 « Création impossible » pour tous).
   2. Fonction render-job : supabase functions deploy render-job (et mcp si la faille 2 n'est pas encore en ligne).
   3. render-worker sur Railway (worker.mjs, securite.mjs, decupleur.mjs). Il fonctionne aussi avant la migration (prise
      habituelle si render_claim_dc est absente, plafond lu par prochainJob). Variable optionnelle DC_MOTEURS_MAX (défaut 2 ;
      depuis la 2e relecture : dc-fetch + dc-cut seulement — mc-ref : DC_PREP_MAX, retouche : RETOUCHE_MOTEURS_MAX ; la somme
      des trois toujours STRICTEMENT inférieure au nombre de moteurs).
   4. Moteur local du Mac (DC_LOCAL=1) : il ne prend que les lots « decupleur », jamais dc-fetch / dc-cut — rien d'obligatoire
      (git pull dans ~/.avatarads/moteur + relance pour garder sa copie à jour).
CORRIGÉ (relecture du 30/10) : la phrase qui figurait ici (« la route MCP decupler_video reste hors lot ; les moteurs la bornent
quand même ») était FAUSSE. mc-ref n'était pas dans DC_COURTS et restait dans la liste prioritaire de pollLoop : gratuit, servi
devant tous les rendus payés et le Rendu prioritaire, sans plafond global ; et le MCP créait dc-fetch / mc-ref par « comptage
puis insertion » sans verrou (30 /start simultanés = 30 jobs, aucun quota de liens). Traité par le lot ci-dessous.

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Relecture du 30/10 des failles 3 et 4 (5 remarques, toutes vérifiées dans le code et corrigées) :
   a. mc-ref (préparation GRATUITE des cartes Claude : Omni, Motion Control, Décupleur) rouvrait la faille 3 → il entre dans
      DC_COURTS (render-worker/securite.mjs) : plafond global de render_claim_dc (dc-fetch + dc-cut + mc-ref ≤ DC_MOTEURS_MAX ;
      REMPLACÉ par la 2e relecture : une place à part, famille « prep », DC_PREP_MAX),
      1 par compte en priorité, plus dans la classe prioritaire de pollLoop. Son ffmpeg (execFileSync SANS délai, boucle Node
      bloquée, battement compris) devient asynchrone, ≤ 10 min, sondes ffprobe ≤ 30 s, entrée ≤ 4096 px (BORNES_MEDIA['mc-ref']).
   b. La faille 4 se contournait par le MCP → /start (decup, omni_edit, motion) et l'étape df: → mc-ref créent leurs jobs par
      render_job_dc_creer (creerPrepMcp) : verrou par compte, liens 1 en cours et 6 par 10 min (comptés avec ceux de l'app), 2
      préparations en cours. Refus → la carte redevient « pending » et reçoit 429 « busy » (elle relance seule toutes les 15 s) ;
      fonction absente / hoquet → 500 « prep », carte close sans débit (jamais l'ancienne insertion sans plafond).
   c. dc-cut sans quota ni bornes, découpes gardées d'avance dans la file → UN travail gratuit court (dc-fetch, dc-cut, mc-ref)
      en file ou en cours par compte, app et MCP confondus (court_en_cours) : chaque nouveau job arrive APRÈS ceux des autres
      clients ; 10 découpes par 10 min (pas de quota owner / developer) ; découpe : entrée ≤ 4096 px, sortie ≤ 60 i/s
      (normaliser), réencodage ≤ 5 min (DC_CUT_MS, au lieu de 10). Effet pour un client honnête de l'app : une découpe lancée
      PENDANT une récupération de lien reçoit 429 « Une récupération ou une découpe de vidéo est déjà en cours » (parcours
      normal : lien → découpe → variantes, l'un après l'autre : inchangé).
   d. README faux sur mc-ref → corrigé (ci-dessus).
   e. Erreur durable de render_claim_dc (42501, PGRST203, délai…) = 6 moteurs qui rebouclaient sur le même dc-fetch → après
      toute prise refusée (erreur ou plafond), le moteur met ces jobs en PAUSE 5 s (dcFile.pauseJusqua, prochainJob les traite
      comme « plafond atteint » sans lecture) et sert les autres rendus.
   Migration 20261030140000 MODIFIÉE EN PLACE (vérifié le 30/10 en lecture seule : ni render_job_dc_creer ni render_claim_dc
   n'existent en ligne) : render_job_dc_creer prend 3 paramètres de plus (p_compte, p_court_en_cours_max défaut 1, p_cut_quota
   défaut 10) et accepte mc-ref ; render_claim_dc compte et prend aussi mc-ref.
Bancs (aucun réseau sauf PGlite en cache, aucune vraie vidéo, aucune base en ligne) :
   · test-faille34-mcp.ts (NOUVEAU) : code RÉEL de mcp/index.ts (/start, /status) sur la base factice avec latence —
     30 /start simultanés (lien, Omni, fichier), parcours honnête, quota, étape df:, panne, deux comptes ;
       deno run --allow-env --allow-read --import-map=import_map_file.json test-faille34-mcp.ts
   · test-faille3-file.mjs : + R1-R4 (bancs adverses des relecteurs : dc-cut lents, 30 mc-ref, 2 × 30 dc-fetch MCP, prise en panne) ;
   · test-faille4-rafale.ts : S2, S6, S6b (1 travail court, quota de découpes, préparation MCP en file) ;
   · test-faille34-sql.ts : B2 (préparations MCP, court_en_cours, quota de découpes), D (mc-ref dans render_claim_dc), E (signature).
A/B : bash tools/tests-decupleur/ab-faille34.sh   (AVANT = 02a160f2, 1er correctif = 9e56e41d, APRÈS = dépôt)
   → AVANT        21/35 (+1 sans objet), 7/21, 10/17
   → 1er correctif 33/37 (30 dc-cut → 3 en file), 15/24 (6/6 moteurs pris par 30 mc-ref, 1er montage payé à t=300 s ; client
                  honnête servi à t=1800 s derrière 2 × 3 dc-cut ; prise en panne : 0/10 montages servis, 3606 appels),
                  10/17 (30 /start → 30 jobs gratuits)
   → APRÈS        37/37, 24/24 (2/6 moteurs au plus, client honnête à t=300 s, 10/10 montages et 6 appels en panne), 20/20,
                  SQL 37/37.

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
2e relecture du 30/10 (commit 8daf5ea5, 5 remarques). Toutes vérifiées dans le code et rejouées par un banc ; 4 sont vraies
telles quelles, la 5e (mc-ref, « important ») aussi, avec une nuance sur son chiffrage. Trois touchent du code d'AVANT le Décupleur
(retouche, compositions sans tirage) : le banc les montre déjà sur 02a160f2.
   1. [important, VRAI] mc-ref partageait le plafond DC_MOTEURS_MAX des dc-fetch / dc-cut : sous une charge Décupleur, la
      préparation d'une carte Claude attendait une découpe (jusqu'à 5 min), et la carte ne relançait que 20 × 15 s. Banc R5 sur
      8daf5ea5 : carte 1 prête à 280 s, carte 2 à 578 s, carte 3 « La file est encore pleine » (bouton).
      → TROIS FAMILLES, chacune sous SON plafond (render_claim_dc, prochainJob) : dc (dc-fetch, dc-cut : DC_MOTEURS_MAX, 2),
        prep (mc-ref : DC_PREP_MAX, 1), retouche (RETOUCHE_MOTEURS_MAX, 1). La carte relance 40 × 15 s (10 min). APRÈS : cartes
        prêtes à 40, 85 et 130 s. Une famille n'emprunte jamais la place d'une autre : au total ≤ 4 moteurs sur 6 aux travaux
        gratuits, 2 toujours aux rendus payés (avant ce lot : la retouche n'avait AUCUN plafond, voir 3).
   2. [important, VRAI] « 1 travail court par compte » comptait dc-fetch, dc-cut ET mc-ref ensemble : une préparation Claude
      donnait à l'app un 429 « récupération ou découpe en cours » trompeur, sans relance ; une carte attendait une découpe de l'app.
      → compté PAR FAMILLE (render_job_dc_creer) : l'app (dc) et les cartes Omni / Motion Control (prep) ne se bloquent plus.
        Seule une carte Décupleur PAR LIEN (dc-fetch, même famille que l'app) reste en concurrence avec l'app : message
        « … en cours sur ton compte (ici ou depuis Claude) » + code court_en_cours, et l'app relance seule toutes les 10 s
        pendant 5 min (_dcJob). Bancs : S6b (render-job), M4 / M6 (MCP), B2 (SQL).
   3. [BLOQUANT, VRAI — existait avant le Décupleur] retouche : comptage puis insertion sans verrou (15 requêtes → 15 jobs ;
      8 en latence variable), classe prioritaire sans plafond (R6 sur 02a160f2 comme sur 8daf5ea5 : 6/6 moteurs, 0/38 rendus payés
      servis en 30 min), photo jamais contrôlée (MP4 renommé .jpg décodé en entier : 3 s au lieu de 65 ms sur la mire du banc),
      sortie à la cadence de la source (240 i/s → 720 images), execFileSync (0 tic de minuteur pendant la retouche).
      → render_job_creer_borne (verrou par compte : 2 retouches en cours, tenu en rafale) ; famille « retouche » plafonnée
        (RETOUCHE_MOTEURS_MAX, 1) ; photo ≤ 40 Mo (render-job) puis PNG / JPEG / WebP ≤ 8192 px (ffprobe) ; UNE image décodée par
        lecture (-frames:v 1), tampon = une image ; sortie ≤ 30 i/s ; tout asynchrone ; la retouche ENTIÈRE ≤ 100 s
        (RETOUCHE_TOTAL_MS ; l'app abandonne à 150 s). Comptes dont une retouche a échoué dans l'heure : plus prioritaires.
      Reste (assumé) : avant leur 1er échec, des retouches lourdes de comptes payants peuvent faire attendre une retouche honnête
      au-delà des 150 s de l'app → vidéo d'origine livrée (aucun crédit perdu) ; les rendus payés ne sont plus touchés.
   4. [important, VRAI — existait avant le Décupleur] gen-subs / motion-split / motion-bg : « 2 rendus en cours » = comptage puis
      insertion (20 requêtes d'un Starter sans débit → 20 jobs ; 13 en latence variable). → même render_job_creer_borne (2 rendus
      en cours, tous types, comme avant) ; refus → tirage motion-bg rendu, 429. Reste (inchangé, voulu) : un compte payant garde 2
      rendus de ce type à la fois.
   5. [important, VRAI ; chiffrage nuancé] mc-ref : place gratuite de 10 min, sans plafond de cadence ni quota ; un échec n'est
      jamais débité. Nuance : avec la 1re relecture, 3 comptes prenaient 119 min de moteur par heure (R7, plafond de 2), pas
      « toute la voie en permanence » pour deux comptes : la file équitable intercalait déjà le client honnête (prêt à 340 s).
      → sortie ≤ 60 i/s (-fpsmax), délai 5 min (au lieu de 10), 10 préparations par 10 min et 3 préparations ÉCHOUÉES par heure
        par compte (render_job_dc_creer p_prep_quota, p_prep_echecs_max ; pas pour owner / developer), comptes en échec dans
        l'heure plus prioritaires, et place à part (famille prep) : APRÈS, 3 comptes = 9 préparations / 45 min de moteur par heure
        sur la SEULE place prep, carte honnête prête en 40 s ; Décupleur et rendus payés jamais touchés.
Bancs (aucun réseau sauf PGlite en cache, aucune vraie vidéo — mires ffmpeg synthétiques —, aucune base en ligne) :
   · test-retouche-bornes.mjs (NOUVEAU) : retouche.mjs réel, vrai ffmpeg local — client honnête, photo = MP4 renommé, 240 i/s,
     boucle Node libre, délai global ;   node test-retouche-bornes.mjs
   · test-faille4-rafale.ts : + S13 / S13b (15 retouches simultanées), S14 / S14b (20 gen-subs), S15 (clients honnêtes, photo
     45 Mo), S16 (fonction absente : insertion d'avant ; autre erreur : refus) ; S6b réécrit (familles) ;
   · test-faille3-file.mjs : familles, + R5 (charge Décupleur + 3 cartes), R6 (retouches lourdes), R7 (préparations qui échouent) ;
   · test-faille34-mcp.ts : M4 / M6 réécrits (familles), + M9 (quota et échecs), M10 (10 min de relance) ;
   · test-faille34-sql.ts : B2 (familles, quota, échecs), D (render_claim_dc par famille), F (render_job_creer_borne), E (droits,
     une seule signature par fonction même après un brouillon appliqué).
A/B : bash tools/tests-decupleur/ab-faille34.sh   (AVANT = 02a160f2, 1er correctif = 9e56e41d, 1re relecture = 8daf5ea5)
   → AVANT          31/49 (+1 sans objet), 8/31, 12/22, 1/5
   → 1er correctif  43/51, 18/34, 12/22, 1/5
   → 1re relecture  45/51 (15 retouches, 20 gen-subs), 26/34 (carte 3 « file pleine », 6/6 moteurs aux retouches, 0/38 payés),
                    19/25, 1/5 (photo-MP4 acceptée, 240 i/s, boucle bloquée)
   → APRÈS          53/53, 34/34, 25/25, 7/7, SQL 61/61.
   Les autres bancs (perso 26/26, faille 2 30/30 et 37/37, faille 5 38/38, failles 6-8 36/36, 7/7, 14/14, 5/5) : inchangés, OK.
Migration 20261030140000 MODIFIÉE EN PLACE une 2e fois (vérifié le 30/10 en lecture seule : ni render_job_dc_creer, ni
render_claim_dc, ni render_job_creer_borne n'existent en ligne). Elle retire d'abord les signatures des brouillons (drop function
if exists) : jamais deux surcharges (PGRST203).

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
   → AVANT 8/36, 3/7, 5/14, 4/5 (lot en cours remboursé à 60 min puis livré quand même ; lot en file > 6 h jamais arrêté ;
     nsfw_checker false partout ; refus anglais brut dans l'app ; « Command failed: ffprobe … /var/…/aa-job-…/base.mp4 » et ligne
     « ERROR: » de yt-dlp dans error / trace ; « N cœur(s) · quota CPU » dans la trace ; trace lisible par le client ; relecture 30/10 : filet qui clôt un job qu'un suivi
     concurrent vient de passer à « dj: », réservation récente tranchée, lot inséré laissé en file sur un job déjà clos)
   → APRÈS 36/36, 7/7, 14/14, 5/5 (lien TikTok normal récupéré, lot de 5 variantes rendu, parcours MCP normal livré).

Déploiement failles 6-8 (ordre) :
   1. Migration 20261030180800_render_jobs_trace_privee.sql, appliquée SEULE (jamais « supabase db push » : voir le plan unique
      ci-dessous). Indépendante du reste.
   2. render-worker sur Railway (decupleur.mjs + worker.mjs). Moteur LOCAL du Mac (DC_LOCAL=1) : il rend des lots decupleur →
      git pull dans ~/.avatarads/moteur puis relance (sinon ses lots gardent l'ancienne trace / les anciennes erreurs).
   3. Fonctions : supabase functions deploy mcp ; supabase functions deploy kie-proxy.
   4. Site (app/index.html : phrase du refus du filtre) : déploiement GitHub Pages habituel.

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Faille 5 (adresse d'image truquée dans kie-proxy ; tâche truquée réglée au lieu d'être remboursée). Banc : test-faille5.ts
(code réel de kie-proxy et reconcile-kie, base / stockage / kie factices, aucun réseau).
A/B : bash tools/tests-decupleur/ab-faille5.sh   (AVANT = 3c00be72) → AVANT 19/38, APRÈS 38/38 (lien dc-cut signé avec
&download accepté par wan-3). Déploiement : aucune migration ; kie-proxy et reconcile-kie (ordre indifférent).

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
PLAN DE DÉPLOIEMENT UNIQUE des failles 2 à 8 (contrôle final 30/10, commit de fusion 4f370d8b ; mis à jour pour la 1re relecture
des failles 3-4 (8daf5ea5) puis pour la 2e relecture : commit qui suit 8daf5ea5 sur dc-fix-securite). Remplace les ordres
partiels ci-dessus, qui datent d'avant la fusion. Ordre vérifié : tant que la migration n'est pas appliquée, le NOUVEAU moteur
prend retouche / mc-ref / dc-fetch / dc-cut par la prise habituelle sous le plafond LU de chaque famille (render_claim_dc absente) ;
l'ANCIEN moteur, après la migration, garde sa prise habituelle (retouche prioritaire sans plafond, comme aujourd'hui). render-job
fonctionne aussi sans la migration pour la retouche et le Générateur (render_job_creer_borne absente → insertion d'avant), mais
PAS pour le Décupleur (render_job_dc_creer absente → 503) ; le MCP non plus (préparations → « préparation impossible »). Les
FONCTIONS passent donc en dernier.
   Piège : les migrations en ligne sont enregistrées sous d'AUTRES numéros que les fichiers du dépôt (apply_migration) ;
   « supabase db push » voudrait rejouer ou refuserait tout l'historique. Chaque migration est appliquée SEULE (apply_migration
   avec son nom, ou supabase db query --linked -f <fichier>).
   0. Copie propre : main avancée jusqu'au DERNIER commit de dc-fix-securite (2e relecture comprise) ; « git status --porcelain »
      vide dans le dossier de déploiement ; « grep -c render_job_creer_borne supabase/functions/render-job/index.ts » ≥ 1 et
      « grep -c DC_PREP_MAX render-worker/worker.mjs » ≥ 1.
      Variables Railway du render-worker À VÉRIFIER AVANT le push (lecture seule ; ne rien afficher d'autre) :
        DC_MOTEURS_MAX (défaut 2), DC_PREP_MAX (défaut 1), RETOUCHE_MOTEURS_MAX (défaut 1) — absentes = défauts, c'est le cas
        prévu. Si l'une existe : DC_PREP_MAX ≥ 1 et RETOUCHE_MOTEURS_MAX ≥ 1, et la SOMME des trois STRICTEMENT inférieure au
        nombre de moteurs (6) ; un DC_MOTEURS_MAX=1 ne touche plus les cartes Claude (famille à part), seulement le Décupleur.
   1. Migration 20261030140000_decupleur_file_atomique.sql (AVANT render-job ET mcp), puis 20261030180800_render_jobs_trace_privee.sql.
      Contrôles après (lecture seule) :
        select pg_get_function_identity_arguments('public.render_job_dc_creer'::regproc)   → 13 paramètres (… p_compte text[],
          p_court_en_cours_max integer, p_cut_quota integer, p_prep_quota integer, p_prep_echecs_max integer)
        select pg_get_function_identity_arguments('public.render_claim_dc'::regproc)       → p_job uuid, p_max integer,
          p_max_prep integer, p_max_retouche integer
        select pg_get_function_identity_arguments('public.render_job_creer_borne'::regproc) → p_user uuid, p_plan jsonb,
          p_input text, p_assets jsonb, p_en_cours_max integer
        (« regproc » échoue s'il existe deux surcharges : c'est voulu, ce serait un PGRST203 côté PostgREST.)
   2. git push de main (aucun rendu « rendering » en cours : le push redéploie Railway et tue le rendu en vol) → render-worker
      Railway (Dockerfile tini + decupleur / worker / securite / retouche) et site GitHub Pages (app/index.html : phrase du refus
      du filtre, relance du Décupleur sur 429) partent ensemble. Journal Railway au démarrage : « travaux gratuits : 2
      récupération(s) / découpe(s), 1 préparation(s) Claude, 1 retouche(s) … ».
   3. Moteur local du Mac : launchctl kickstart -k gui/$(id -u)/fr.avatarads.decupleur-local (il refait fetch + reset sur
      origin/main au démarrage) ; journal ~/Library/Logs/avatarads-decupleur.log → « code à jour : <commit> ».
   4. Fonctions : render-job, mcp, kie-proxy, reconcile-kie (fal-proxy, google-ai-proxy, provider-watch, reconcile-fal-orphans
      importent _shared/kie.ts, mais kieOwnedBy est inchangé : rien à redéployer). _shared/decupleur.ts gagne des constantes
      (DC_FETCH_QUOTA, DC_CUT_QUOTA, DC_FETCH_FENETRE_S, DC_COURT_EN_COURS_MAX, DC_PREP_QUOTA, DC_PREP_ECHECS_MAX) : kie-proxy
      l'importe sans les utiliser, il part de toute façon dans cette étape. La carte Claude (HTML servi par mcp) relance 10 min.
   Après (lecture seule) : aucun job « mc-ref » ni « retouche » resté « queued » plus de 2 min
      (select plan->>'__compose' c, count(*) from render_jobs where status = 'queued' and plan->>'__compose' in ('mc-ref', 'retouche')
       and created_at < now() - interval '2 minutes' group by 1)
      et, dans les journaux Railway, aucune ligne « render_claim_dc : » en boucle (une erreur = pause de 5 s de sa famille, par moteur).
