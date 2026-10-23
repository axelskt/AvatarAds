Bancs de test de la page de paiement et de whop-webhook (23/10/2026). Aucun appel réel : ni Supabase, ni paiement.

1) Webhook (code réel de supabase/functions/whop-webhook/index.ts, base factice en mémoire, événements Whop signés) :
   cd tools/tests-whop-webhook && deno run --allow-env --allow-read --allow-net --import-map=import_map.json test.ts
   → « 197/197 vérifications OK ». À relancer après tout changement de plan, de prix ou du webhook (tableau V du test).

2) Page de paiement : copier page-combos.html à la racine du dépôt, servir la racine (preview avatarads-root, port 8793),
   ouvrir /page-combos.html, attendre ~1 min, lire window.__res (54 combinaisons : plan Whop, total, module Whop chargé).
   Supprimer la copie ensuite. Le tableau W reprend les prix Whop : le tenir à jour.
