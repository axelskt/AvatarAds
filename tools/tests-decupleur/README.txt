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
