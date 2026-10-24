Bancs de test de la page de paiement et de whop-webhook (23/10/2026). Aucun appel réel : ni Supabase, ni paiement.

1) Webhook (code réel de supabase/functions/whop-webhook/index.ts, base factice en mémoire, événements Whop signés) :
   cd tools/tests-whop-webhook && deno run --allow-env --allow-read --allow-net --import-map=import_map.json test.ts
   → « 324/324 vérifications OK ». À relancer après tout changement de plan, de prix ou du webhook (tableau V du test).

2) Page de paiement : copier page-combos.html à la racine du dépôt, servir la racine (preview avatarads-root, port 8793),
   ouvrir /page-combos.html, attendre ~1 min, lire window.__res (54 combinaisons : plan Whop, total, module Whop chargé).
   Supprimer la copie ensuite. Le tableau W reprend les prix Whop : le tenir à jour.

3) Connexion après achat (supabase/functions/paiement-compte, base factice) :
   cd tools/tests-whop-webhook && deno run --allow-env --allow-read --allow-net --import-map=import_map.json test-paiement-compte.ts
   → « 69/69 vérifications OK » : compte neuf seulement, une connexion par paiement, 1er mot de passe seulement.

- Changement d'adresse en deux codes (auth-otp, 23/10) :
   cd tools/tests-whop-webhook && deno run --allow-env --allow-read --allow-net --import-map=import_map.json test-email-change.ts

Bancs ajoutés le 24/10 (correctifs de l'audit paiement / comptes du 23/10) — tous depuis tools/tests-whop-webhook :
- Connexion par code (auth-otp : seul le dernier code vaut, plafond de 30 codes faux par couple adresse + IP) :
   deno run --allow-env --allow-read --allow-net --import-map=import_map.json test-auth-codes.ts   → 19/19
- Résiliation (whop-cancel / whop-uncancel / delete-account, base factice) :
   deno run --allow-env --allow-read --allow-net --import-map=import_map.json test-credits-resiliation.ts   → 43/43
- Changement d'adresse en deux codes + retrait de Google : test-email-change.ts → 21/21
- SQL réel (PGlite, Postgres 16 en mémoire ; --node-modules-dir=none, un package.json parent bloque sinon npm:@electric-sql/pglite) :
   deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-credits-sql.ts        → 41/41 (20261024010000)
   deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-webhook-sql.ts        → 88/88 (20261024020000)
   deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-combo-sql.ts          → 36/36 (les deux, dans les deux ordres)
   deno run --node-modules-dir=none --allow-env --allow-read --allow-net test-auth-delier-sql.ts    → 14/14 (20261024040000)

