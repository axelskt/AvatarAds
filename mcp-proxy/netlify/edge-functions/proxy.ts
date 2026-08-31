// Proxy MCP : avatarads-mcp.netlify.app ET mcp.avatarads.fr → edge function Supabase `mcp`.
//
// FIX COLD-START (31/08) : la « Vérification du serveur » de claude.ai (challenge 401 +
// découverte OAuth via /.well-known) réveillait la GROSSE fonction Supabase (démarrage à froid
// lent) → sous la rafale de requêtes de Claude, certaines dépassaient 5 s → vérif « une fois sur
// deux ». On sert donc CES réponses-là DIRECTEMENT ICI (edge Netlify, minuscule, rapide, exécutée
// au PoP proche de Claude) : zéro aller-retour Supabase pour la vérif → verte à tous les coups.
// Tout le reste (OAuth /authorize /token /register /oauth/approve, requêtes MCP AUTHENTIFIÉES,
// appels d'outils) est TRANSMIS à la fonction Supabase avec x-forwarded-host (le vrai domaine de
// connexion — seule façon pour Supabase de servir la métadonnée OAuth sur le bon host).

const SUPABASE_MCP = 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/mcp'

// CORS identiques à ceux de la fonction Supabase (WWW-Authenticate exposé : non « safelisted »).
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
}
const j = (obj: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } })

export default async (request: Request): Promise<Response> => {
  const inUrl = new URL(request.url)
  const host = inUrl.host           // le VRAI domaine : mcp.avatarads.fr | avatarads-mcp.netlify.app
  const path = inUrl.pathname
  const base = `https://${host}`

  // ── Préflight CORS → immédiat ──
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // ── Métadonnées OAuth : servies STATIQUEMENT ici, sur le host réel (0 aller-retour Supabase) ──
  // (identique octet pour octet à ce que sert la fonction Supabase)
  if (path === '/.well-known/oauth-protected-resource') {
    return j({
      resource: base,
      authorization_servers: [base],
      scopes_supported: ['avatarads'],
      bearer_methods_supported: ['header'],
    }, 200)
  }
  if (path === '/.well-known/oauth-authorization-server') {
    return j({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['avatarads'],
      client_id_metadata_document_supported: true,
    }, 200)
  }

  // ── Endpoint MCP racine SANS identifiant → challenge 401 servi ICI (rapide) ──
  // Claude sonde `/` (POST initialize ou GET) sans token pendant la vérif → on renvoie le 401 +
  // WWW-Authenticate directement, sans réveiller Supabase. Les requêtes AVEC identifiant
  // (Bearer aat_/aa_, clé /aa_… dans le chemin, ou ?key=) DOIVENT partir vers Supabase (vrai MCP).
  const auth = request.headers.get('authorization') || ''
  const authed =
    /^Bearer\s+(aat_|aa_)/i.test(auth) ||
    /\/aa_[A-Za-z0-9]/.test(path) ||
    inUrl.searchParams.has('key')
  const isRoot = path === '/' || path === ''
  if (isRoot && !authed) {
    return j({ error: 'unauthorized' }, 401, {
      'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    })
  }

  // ── Tout le reste → TRANSMIS à la fonction Supabase (avec le host réel) ──
  const target = SUPABASE_MCP + path + inUrl.search
  const headers = new Headers(request.headers)
  headers.set('x-forwarded-host', host)
  headers.set('x-mcp-connect-host', host)  // trace côté logs Supabase

  const init: RequestInit & { duplex?: string } = {
    method: request.method,
    headers,
    redirect: 'manual', // laisser passer le 302 /authorize tel quel
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }
  return fetch(target, init)
}

// Toutes les routes (racine MCP, /.well-known/*, /authorize, /token, /register, /oauth/approve…)
export const config = { path: '/*' }
