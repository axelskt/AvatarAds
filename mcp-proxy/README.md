# Proxy Netlify du serveur MCP (avatarads-mcp / mcp.avatarads.fr)

Site Netlify `avatarads-mcp` (id 17efbc30-fe2f-492c-ba8c-d08253c03122), déployé
à la main : `netlify deploy --prod --dir mcp-proxy --site 17efbc30-…`.
Il ne fait que proxifier vers l'edge function Supabase `mcp`. La règle
`/.well-known/*` est EXPLICITE : le catch-all ne transmettait pas les chemins
pointés et la découverte OAuth tombait sur un 404 (15/08/2026).
