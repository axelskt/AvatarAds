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
      habituelle si render_claim_dc est absente, plafond lu par prochainJob). Variable optionnelle DC_MOTEURS_MAX (défaut 2,
      depuis la relecture : dc-fetch + dc-cut + mc-ref ensemble) : toujours STRICTEMENT inférieure au nombre de moteurs.
   4. Moteur local du Mac (DC_LOCAL=1) : il ne prend que les lots « decupleur », jamais dc-fetch / dc-cut — rien d'obligatoire
      (git pull dans ~/.avatarads/moteur + relance pour garder sa copie à jour).
CORRIGÉ (relecture du 30/10) : la phrase qui figurait ici (« la route MCP decupler_video reste hors lot ; les moteurs la bornent
quand même ») était FAUSSE. mc-ref n'était pas dans DC_COURTS et restait dans la liste prioritaire de pollLoop : gratuit, servi
devant tous les rendus payés et le Rendu prioritaire, sans plafond global ; et le MCP créait dc-fetch / mc-ref par « comptage
puis insertion » sans verrou (30 /start simultanés = 30 jobs, aucun quota de liens). Traité par le lot ci-dessous.

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Relecture du 30/10 des failles 3 et 4 (5 remarques, toutes vérifiées dans le code et corrigées) :
   a. mc-ref (préparation GRATUITE des cartes Claude : Omni, Motion Control, Décupleur) rouvrait la faille 3 → il entre dans
      DC_COURTS (render-worker/securite.mjs) : plafond global de render_claim_dc (dc-fetch + dc-cut + mc-ref ≤ DC_MOTEURS_MAX),
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
PLAN DE DÉPLOIEMENT UNIQUE des failles 2 à 8 (contrôle final 30/10, commit de fusion 4f370d8b ; mis à jour pour la relecture
des failles 3-4 : commit qui suit 9e56e41d sur dc-fix-securite). Remplace les ordres partiels ci-dessus, qui datent d'avant la
fusion. Ordre de la relecture vérifié : tant que la migration n'est pas appliquée, le NOUVEAU moteur prend mc-ref / dc-fetch /
dc-cut par la prise habituelle sous le plafond lu (render_claim_dc absente) ; l'ANCIEN moteur, après la migration, garde sa
prise habituelle. Seules les FONCTIONS (render-job, mcp) exigent la migration : elles passent en dernier.
   Piège : les migrations en ligne sont enregistrées sous d'AUTRES numéros que les fichiers du dépôt (apply_migration) ;
   « supabase db push » voudrait rejouer ou refuserait tout l'historique. Chaque migration est appliquée SEULE (apply_migration
   avec son nom, ou supabase db query --linked -f <fichier>).
   0. Copie propre : main avancée jusqu'au DERNIER commit de dc-fix-securite (relecture 3-4 comprise) ; « git status --porcelain »
      vide dans le dossier de déploiement ; « grep -c creerPrepMcp supabase/functions/mcp/index.ts » ≥ 1.
   1. Migration 20261030140000_decupleur_file_atomique.sql (AVANT render-job ET mcp : depuis la relecture du 30/10, le MCP crée
      aussi ses préparations par render_job_dc_creer — sans la migration, toute carte Omni / Motion Control / Décupleur
      échouerait en « préparation impossible », sans débit), puis 20261030180800_render_jobs_trace_privee.sql.
      Contrôle après : select pg_get_function_identity_arguments('public.render_job_dc_creer'::regproc) → 11 paramètres
      (… p_compte text[], p_court_en_cours_max integer, p_cut_quota integer).
   2. git push de main (aucun rendu « rendering » en cours : le push redéploie Railway et tue le rendu en vol) → render-worker
      Railway (Dockerfile tini + decupleur / worker / securite) et site GitHub Pages (app/index.html) partent ensemble.
   3. Moteur local du Mac : launchctl kickstart -k gui/$(id -u)/fr.avatarads.decupleur-local (il refait fetch + reset sur
      origin/main au démarrage) ; journal ~/Library/Logs/avatarads-decupleur.log → « code à jour : <commit> ».
   4. Fonctions : render-job, mcp, kie-proxy, reconcile-kie (fal-proxy, google-ai-proxy, provider-watch, reconcile-fal-orphans
      importent _shared/kie.ts, mais kieOwnedBy est inchangé : rien à redéployer). _shared/decupleur.ts gagne des constantes
      (DC_FETCH_QUOTA, DC_CUT_QUOTA, DC_FETCH_FENETRE_S, DC_COURT_EN_COURS_MAX) : kie-proxy l'importe sans les utiliser, il part
      de toute façon dans cette étape.
   Après (lecture seule) : aucun job « mc-ref » resté « queued » plus de 2 min
      (select count(*) from render_jobs where status = 'queued' and plan->>'__compose' = 'mc-ref' and created_at < now() - interval '2 minutes')
      et, dans les journaux Railway, aucune ligne « render_claim_dc : » en boucle (une erreur = pause de 5 s par moteur).
