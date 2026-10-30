Banc de l'audit Décupleur du 30/10 (faille 1 : changement de personnage obtenu gratuitement par l'outil Claude). Aucun appel
réel : base, stockage, kie.ai et moteur de rendu factices ; code réel de supabase/functions/mcp/index.ts (route /status) et
de render-worker/securite.mjs. Aucun réseau autorisé (pas de --allow-net).

   cd tools/tests-decupleur && deno run --allow-env --allow-read --import-map=import_map.json test-decupleur-perso.ts
   → « 26/26 vérifications OK ». Avant le correctif : 16/26 (153 crédits rendus, vidéo du personnage gardée).
