// Proxy MCP : avatarads-mcp.netlify.app ET mcp.avatarads.fr → edge function
// Supabase `mcp`. Contrairement aux redirections `200!` de netlify.toml, cette
// fonction edge TRANSMET le domaine d'origine en `x-forwarded-host` — c'est la
// seule façon pour la fonction Supabase de savoir par quel domaine claude.ai
// s'est connecté, et donc de servir la métadonnée OAuth sur le BON host
// (resource/issuer/endpoints), condition exigée par claude.ai. (Constat du
// 15/08 : le proxy par redirection ne laissait passer que `edge-runtime.
// supabase.com` et des `x-nf-*`, jamais le host réel.)

const SUPABASE_MCP = 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/mcp'

export default async (request: Request): Promise<Response> => {
  const inUrl = new URL(request.url)
  const host = inUrl.host // le VRAI domaine de connexion : mcp.avatarads.fr | avatarads-mcp.netlify.app
  const target = SUPABASE_MCP + inUrl.pathname + inUrl.search

  const headers = new Headers(request.headers)
  headers.set('x-forwarded-host', host)
  // trace utile côté logs Supabase ; sans effet fonctionnel
  headers.set('x-mcp-connect-host', host)

  const init: RequestInit & { duplex?: string } = {
    method: request.method,
    headers,
    redirect: 'manual', // laisser passer le 302 /authorize tel quel
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half' // requis par Deno pour un body en flux
  }

  return fetch(target, init)
}

// Toutes les routes (racine MCP, /.well-known/*, /authorize, /token, /register…)
export const config = { path: '/*' }
