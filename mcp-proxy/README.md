# Proxy Netlify du serveur MCP (avatarads-mcp / mcp.avatarads.fr)

Site Netlify `avatarads-mcp` (id 17efbc30-fe2f-492c-ba8c-d08253c03122), déployé
à la main : `netlify deploy --prod --dir mcp-proxy --site 17efbc30-…`.
Il ne fait que proxifier vers l'edge function Supabase `mcp`. La règle
`/.well-known/*` est EXPLICITE : le catch-all ne transmettait pas les chemins
pointés et la découverte OAuth tombait sur un 404 (15/08/2026).

## gen-snapshot — régénérer le handshake en mémoire (OBLIGATOIRE après tout changement d'outils/instructions)

Le handshake MCP (initialize + server/discover → 13 outils + instructions) est servi EN MÉMOIRE par
`netlify/edge-functions/proxy.ts` depuis `snapshot.ts` (zéro réseau, zéro cold start). Ce fichier est
GÉNÉRÉ depuis la fonction Supabase déployée. Après `supabase functions deploy mcp` :

```bash
F=https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/mcp/aa_probe
curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' "$F" > /tmp/init.json
curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"server/discover"}' "$F" > /tmp/disc.json
# La ressource UI fait PARTIE du snapshot (l'edge répond à resources/read ui://avatarads/*.html avec elle).
# C'est une COQUILLE de ~2,7 k car qui charge widget.js en direct (no-store) : le code de la carte (aaMedia…)
# n'est PAS dans le snapshot — le regénérer ne sert qu'aux outils/instructions/coquille.
curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"ui://avatarads/image.html"}}' "$F" > /tmp/res.json
node -e 'const fs=require("fs");const i=JSON.parse(fs.readFileSync("/tmp/init.json")).result,d=JSON.parse(fs.readFileSync("/tmp/disc.json")).result,r=JSON.parse(fs.readFileSync("/tmp/res.json")).result;const c=r.contents[0];if(!c||!c.text||c.text.length<1000)throw new Error("resources/read vide ou tronqué");fs.writeFileSync("netlify/lib/snapshot.ts","// GÉNÉRÉ — ne pas éditer à la main. Snapshot du handshake MCP (initialize + server/discover) ET de la\n// ressource UI (resources/read ui://avatarads/*.html → la coquille de la carte). Procédure : README « gen-snapshot ».\nexport const SNAPSHOT: { initialize: Record<string, unknown>; discover: Record<string, unknown>; ui_resource: { mimeType: string; text: string; _meta: Record<string, unknown> } } = "+JSON.stringify({initialize:i,discover:d,ui_resource:{mimeType:c.mimeType,text:c.text,_meta:c._meta||{}}})+"\n")'
grep -c "ui_resource" netlify/lib/snapshot.ts   # doit afficher 1
npx netlify deploy --prod --dir .
```
Vérifier en live : `POST https://mcp.avatarads.fr/mcp` (Bearer aat_warm) `tools/list` ou `resources/read` →
chercher une chaîne propre à la nouvelle version. Un snapshot regénéré mais NON déployé ne change rien.
