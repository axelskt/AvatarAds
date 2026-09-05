// Proxy MCP : avatarads-mcp.netlify.app ET mcp.avatarads.fr → edge function Supabase `mcp`.
//
// FIX COLD-START (01/09) — DÉFINITIF. La « Vérification du serveur » de claude.ai envoie des
// RAFALES de requêtes non authentifiées : on les termine ICI en 401 + WWW-Authenticate (défi OAuth),
// jamais Supabase. Les /.well-known/* aussi.
//
// FIX POST-AUTH (01/09) — le handshake AUTHENTIFIÉ (initialize / server/discover / tools/list) est
// STATIQUE : on le sert ICI aussi, à partir d'un snapshot (`public.mcp_meta` via PostgREST). La grosse
// fonction n'est réveillée que par les VRAIS appels (tools/call, resources/read).
//
// FIX FIABILITÉ (01/09 18h) — « Ce connecteur n'a aucun outil disponible » 1 fois sur 2 : sur un
// isolate edge FROID, le fetch PostgREST pouvait traîner/échouer → repli sur la fonction froide →
// timeout → liste vide. Corrigé sur DEUX fronts :
//   1. fetch snapshot avec TIMEOUT (AbortController) + retry + PRÉCHAUFFAGE au chargement du module
//      (promesse partagée : une rafale de requêtes concurrentes ne déclenche qu'UN fetch).
//   2. REPLI EMBARQUÉ (FALLBACK ci-dessous) : si le fetch échoue quand même, on sert une liste
//      d'outils EMBARQUÉE dans l'edge → Claude voit TOUJOURS les 13 outils, JAMAIS « aucun outil »,
//      et on ne touche JAMAIS la fonction froide pour le handshake. Le snapshot reste la source des
//      descriptions riches ; le fallback garantit juste que la connexion aboutit.

import { SNAPSHOT } from '../lib/snapshot.ts'

const SUPABASE_MCP = 'https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/mcp'
const SB_PUBLISHABLE = 'sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck'
const SB_LOG = 'https://guvwgiejzkiodghywpwj.supabase.co/rest/v1/mcp_edge_log'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
}
const j = (obj: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } })

// ── REPLI EMBARQUÉ : 13 outils (noms + schémas EXACTS + descriptions condensées) + instructions
// essentielles. Sert uniquement si le snapshot PostgREST est injoignable → Claude voit toujours les
// outils et la connexion aboutit. Schémas et enums fidèles (ce qui compte pour un appel correct) ;
// les descriptions riches viennent du snapshot quand il répond. Régénéré si la liste d'outils change. ──
const V = { prompt: { type: 'string' }, confirm: { type: 'boolean' } }
const UI = (f: string) => ({ _meta: { ui: { resourceUri: `ui://avatarads/${f}` } } })
const FALLBACK: Record<string, unknown> = {
  serverInfo: { name: 'AvatarAds', title: 'AvatarAds', version: '1.4.1', websiteUrl: 'https://avatarads.fr' },
  capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
  protocolVersion: '2025-06-18',
  prompts: [],
  resources: ['image', 'video', 'avatar', 'montage'].map((k) => ({
    uri: `ui://avatarads/${k}.html`, name: `Viewer ${k}.html`, mimeType: 'text/html;profile=mcp-app',
    _meta: { ui: { csp: { connectDomains: [SUPABASE_MCP.replace('/functions/v1/mcp', ''), 'https://mcp.avatarads.fr'], resourceDomains: ['https://mcp.avatarads.fr', SUPABASE_MCP.replace('/functions/v1/mcp', ''), 'https://avatarads.fr'] } } },
  })),
  tools: [
    { name: 'get_account', description: 'Infos du compte : plan, crédits, barème.', inputSchema: { type: 'object', properties: {} } },
    { name: 'generate_image', ...UI('image.html'), description: "Génère une image IA (visuel libre, STATIC AD, ou photo UGC). Passe le lien produit dans product_url.", inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: V.prompt, kind: { type: 'string', enum: ['free', 'static_ad', 'ugc'] }, reference_image_url: { type: 'string' }, product_url: { type: 'string' }, no_reference: { type: 'boolean' }, headline: { type: 'string' }, subheadline: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, brand: { type: 'string' }, cta: { type: 'string' }, format: { type: 'string', enum: ['portrait', 'square', 'landscape'] }, quality: { type: 'string', enum: ['standard', 'high'] }, confirm: V.confirm } } },
    { name: 'generate_video', ...UI('image.html'), description: "EXPRESS : vidéo IA (audio inclus) depuis un prompt + image de départ optionnelle (image_url). LE seul outil vidéo d'une personne. 📷 claude.ai ne transmet PAS les photos jointes au chat : pour partir de LA photo de l'utilisateur, demande une URL publique (bouton « Glisse la photo pour Claude » sur le site) à passer dans image_url. Ne nomme jamais le moteur technique.", inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: V.prompt, duration_seconds: { type: 'integer', minimum: 4, maximum: 10 }, aspect_ratio: { type: 'string', enum: ['9:16', '16:9'] }, image_url: { type: 'string' }, confirm: V.confirm } } },
    { name: 'check_image', ...UI('image.html'), description: 'Statut image (normalement inutile).', inputSchema: { type: 'object', required: ['job_id'], properties: { job_id: { type: 'string' } } } },
    { name: 'check_video', ...UI('video.html'), description: "Statut/affichage vidéo Express. Appelle SANS job_id après « Impossible de joindre » (ne relance PAS generate).", inputSchema: { type: 'object', properties: { job_id: { type: 'string' } } } },
    { name: 'check_avatar_video', ...UI('avatar.html'), description: 'Statut/affichage vidéo avatar (lipsync).', inputSchema: { type: 'object', properties: { job_id: { type: 'string' } } } },
    { name: 'clean_audio', description: "Nettoie un audio (isolation de voix). 1 cr/min.", inputSchema: { type: 'object', required: ['audio_url'], properties: { audio_url: { type: 'string' }, confirm: V.confirm } } },
    { name: 'lipsync_video', description: "LIPSYNC sur un audio EXISTANT (photo + segment audio → clip synchro). Qualité via engine : standard (défaut) / haute résolution.", inputSchema: { type: 'object', required: ['image_url', 'audio_url'], properties: { image_url: { type: 'string' }, audio_url: { type: 'string' }, engine: { type: 'string', enum: ['hedra', 'omnihuman'] }, aspect_ratio: { type: 'string', enum: ['9:16', '1:1', '16:9'] }, confirm: V.confirm } } },
    { name: 'montage_ia', description: "MONTAGE IA : un AUDIO → vidéo motion-design complète (plan + rendu). Puis check_montage.", inputSchema: { type: 'object', required: ['audio_url'], properties: { audio_url: { type: 'string' }, brief: { type: 'string' }, script: { type: 'string' }, style: { type: 'string', enum: ['auto', 'apple', 'glass', 'dynamic', 'word'] }, media: { type: 'array', maxItems: 7, items: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, name: { type: 'string' } } } }, lipsync: { type: 'boolean' }, lipsync_model: { type: 'string', enum: ['hedra', 'omnihuman', 'mix'] }, avatar_url: { type: 'string' }, avatar_urls: { type: 'array', maxItems: 5, items: { type: 'string' } }, clean_audio: { type: 'boolean' }, duration_seconds: { type: 'number' }, confirm: V.confirm } } },
    { name: 'check_montage', ...UI('montage.html'), description: 'Statut Montage IA → MP4 final.', inputSchema: { type: 'object', required: ['job_id'], properties: { job_id: { type: 'string' } } } },
    { name: 'get_montage_plan', description: "Lien « Détails du montage » + plan JSON. Gratuit.", inputSchema: { type: 'object', required: ['job_id'], properties: { job_id: { type: 'string' } } } },
    { name: 'render_montage_plan', description: "ÉDITEUR : re-rend un montage depuis un plan modifié. 4 cr.", inputSchema: { type: 'object', required: ['job_id', 'plan'], properties: { job_id: { type: 'string' }, plan: { type: 'string' }, confirm: V.confirm } } },
    { name: 'list_media', description: 'Derniers médias générés (URLs publiques).', inputSchema: { type: 'object', properties: {} } },
  ],
}
const FALLBACK_INIT: Record<string, unknown> = {
  serverInfo: { name: 'AvatarAds', title: 'AvatarAds', version: '1.4.1', websiteUrl: 'https://avatarads.fr', icons: [{ src: 'https://mcp.avatarads.fr/icon.svg?v=2', mimeType: 'image/svg+xml', sizes: ['any'] }, { src: 'https://mcp.avatarads.fr/icon-256.png?v=2', mimeType: 'image/png', sizes: ['256x256'] }] },
  capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
  protocolVersion: '2025-06-18',
  instructions: "Serveur MCP AvatarAds (avatarads.fr). ⛔ MODE SILENCIEUX pour une demande d'image / visuel / static ad / UGC image : réponds UNIQUEMENT par des appels generate_image, ZÉRO texte autour. ⚡ VIDÉO UGC — une personne qui PRÉSENTE/PARLE à partir d'une PHOTO : utilise TOUJOURS generate_video (Express) avec un prompt style UGC réel (selfie authentique, ton naturel, improvise sa présentation, pas de « euh »), 4-8 s, 9:16. 📷 claude.ai ne transmet PAS les photos jointes au chat : pour partir de LA photo de l'utilisateur, demande une URL publique (« Glisse la photo pour Claude » sur le site) à passer dans image_url ; sans URL, propose la scène sans sa photo, ne réclame pas un Drive au hasard. Ne nomme jamais le moteur technique. Il n'y a PAS d'outil générateur d'avatar ici. Modules : Images IA = generate_image · Vidéo Express = generate_video puis check_video · Nettoyage audio = clean_audio · Montage IA = montage_ia puis check_montage · Éditeur = get_montage_plan / render_montage_plan. Tout consomme les crédits du compte. RÉCUPÉRATION : sur « Impossible de joindre » après generate_video, la génération a DÉMARRÉ (crédits débités) — rappelle IMMÉDIATEMENT check_video SANS argument, ne relance JAMAIS generate. Un devis peut être retourné : montre-le puis rappelle avec confirm:true. get_account donne le solde.",
}

// ── Snapshot EN MÉMOIRE (01/09, refonte « zéro réseau sur le chemin de connexion ») ──
// AVANT : getMeta() allait chercher public.mcp_meta via PostgREST (Irlande) avec timeout 1,5 s +
// retry 1,8 s, et un cache qui EXPIRAIT toutes les 60 s. Sur un isolate FROID — typiquement un POP
// AMÉRICAIN, celui du backend de claude.ai, que ni pg_cron (eu-west-1) ni mes sondes (France) ne
// chauffaient jamais (DNS géographique Netlify) — ou à chaque expiration du cache, le 1er handshake
// bloquait jusqu'à ~3,3 s (transatlantique) → claude.ai lâchait → « aucun outil disponible » et jetait
// le jeton tout neuf (« L'autorisation a échoué ») — 1 fois sur 2, OK au 2e essai (POP chaud, cache
// plein). MAINTENANT : le snapshot (13 outils + instructions, GÉNÉRÉ depuis la fonction déployée) est
// une CONSTANTE importée (snapshot.ts) → réponse en mémoire, identique à froid et à chaud, sur tous
// les POP. ⚠️ À RÉGÉNÉRER après tout changement de toolDefs()/instructions : README.md « gen-snapshot ».
type Meta = { initialize?: Record<string, unknown>; discover?: Record<string, unknown> }
async function getMeta(): Promise<Meta | null> {
  return SNAPSHOT as Meta
}

const DISCOVERY = new Set(['initialize', 'tools/list', 'server/discover', 'ping', 'resources/list', 'resources/templates/list', 'prompts/list'])
function discoveryResult(method: string, meta: Meta): Record<string, unknown> | null {
  const disc = (meta.discover as Record<string, unknown>) || FALLBACK
  const init = (meta.initialize as Record<string, unknown>) || FALLBACK_INIT
  switch (method) {
    case 'initialize': return init
    case 'server/discover': return disc
    case 'tools/list': return { tools: (disc.tools as unknown) ?? FALLBACK.tools }
    case 'resources/list': return { resources: (disc.resources as unknown) ?? FALLBACK.resources }
    case 'resources/templates/list': return { resourceTemplates: [] }
    case 'prompts/list': return { prompts: [] }
    case 'ping': return {}
    default: return null
  }
}

async function handle(request: Request, probe: { rpcMethod: string; rpcTool: string }): Promise<Response> {
  const inUrl = new URL(request.url)
  const host = inUrl.host
  const path = inUrl.pathname
  const base = `https://${host}`

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // (Normalement servi par le CDN — fichiers statiques, excludedPath — ; gardé ici en filet, IDENTIQUE.)
  if (path.startsWith('/.well-known/')) {
    const doc = path.slice('/.well-known/'.length).replace(/\/+$/, '')
    if (doc === 'oauth-protected-resource') {
      return j({ resource: base, authorization_servers: [base], scopes_supported: ['avatarads'], bearer_methods_supported: ['header'] }, 200)
    }
    if (doc === 'oauth-authorization-server' || doc === 'openid-configuration') {
      return j({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        // /token et /register EN DIRECT sur Supabase (02/09) : plus de Netlify dans l'échange du code.
        token_endpoint: `${SUPABASE_MCP}/token`,
        registration_endpoint: `${SUPABASE_MCP}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['avatarads'],
        client_id_metadata_document_supported: true,
      }, 200)
    }
    return j({ error: 'not_found' }, 404)
  }

  const isOAuthEndpoint = path === '/authorize' || path === '/token' || path === '/register' || path.startsWith('/oauth/')
  // Ressources statiques PUBLIQUES (JS du widget de carte, icônes) : servies par la fonction SANS auth.
  const isPublicStatic = /^\/(widget\.js|icon\.svg|favicon\.(ico|png|svg)|apple-touch-icon(-precomposed)?\.png|icon-\d+\.png)$/.test(path)
  const auth = request.headers.get('authorization') || ''
  const authed = /^Bearer\s+(aat_|aa_)/i.test(auth) || /\/aa_[A-Za-z0-9]/.test(path) || inUrl.searchParams.has('key')
  // ENDPOINT MCP = la racine (et l'ancienne forme /aa_<clé>). SEUL ce chemin porte le défi OAuth 401, le 405 du
  // GET SSE et la découverte en mémoire. TOUT LE RESTE est forwardé tel quel : la fonction y applique sa propre
  // logique — /status/<job> et /i/<job> sont PUBLICS (sondés par la carte-widget depuis le navigateur, SANS
  // jeton), /regenerate, /ref, /key ont leur propre auth (JWT). 02/09 : le 401 global bloquait /status → la carte
  // « Génération en cours… » tournait à l'infini alors que l'image était prête depuis 37 s.
  const isMcpEndpoint = path === '/' || path === '/mcp' || path === '/mcp/' || /^\/aa_[A-Za-z0-9]+\/?$/.test(path)

  let body: ArrayBuffer | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') body = await request.arrayBuffer()
  // JSON-RPC parsé sur TOUT POST avec corps : découverte, idempotence du forward, journal.
  let rpc: Record<string, unknown> | unknown[] | null = null
  if (request.method === 'POST' && body && body.byteLength) {
    try { rpc = JSON.parse(new TextDecoder().decode(body)) } catch { rpc = null }
    if (rpc) {
      probe.rpcMethod = Array.isArray(rpc) ? '[batch]' : String((rpc as Record<string, unknown>).method || '')
      const prm = Array.isArray(rpc) ? undefined : (rpc as Record<string, unknown>).params as Record<string, unknown> | undefined
      probe.rpcTool = prm && typeof prm.name === 'string' ? prm.name : ''
    }
  }

  // ── DÉCOUVERTE + RESSOURCE UI SERVIES À L'EDGE (snapshot en mémoire — JAMAIS la fonction froide) ──
  if (isMcpEndpoint && authed && request.method === 'POST' && rpc && !Array.isArray(rpc)) {
    const method = probe.rpcMethod
    const id = 'id' in rpc ? (rpc as Record<string, unknown>).id : undefined
    if (id === undefined && (method.startsWith('notifications/') || method === '')) {
      return new Response(null, { status: 202, headers: CORS })
    }
    // RESSOURCE UI (widget de carte, MCP Apps) — 01/09 : claude.ai va chercher ui://avatarads/*.html juste
    // après la connexion. Avant : forwardé → fonction froide → connexion refusée pendant le boot d'un isolate
    // → exception edge → 500 → claude.ai jetait le connecteur « quelques secondes après Connecté »
    // (« aucun outil disponible »). Même HTML pour toutes les URIs ui://avatarads/ (comme la fonction).
    if (method === 'resources/read') {
      const uri = String(((rpc as Record<string, unknown>).params as Record<string, unknown> | undefined)?.uri || '')
      const ui = SNAPSHOT.ui_resource
      if (uri.startsWith('ui://avatarads/') && ui && ui.text) {
        return j({ jsonrpc: '2.0', id: id ?? null, result: { contents: [{ uri, mimeType: ui.mimeType, text: ui.text, _meta: ui._meta }] } }, 200)
      }
    }
    if (DISCOVERY.has(method)) {
      const meta = (await getMeta()) || {}
      const result = discoveryResult(method, meta)
      // (02/09) PAS de Mcp-Session-Id : testé 10 min, aucun bénéfice observé, et un id qui change à chaque
      // initialize peut faire croire à un client qu'il a perdu sa session. Serveur sans état, point.
      if (result) return j({ jsonrpc: '2.0', id: id ?? null, result }, 200)
    }
  }

  // ── GET authentifié = ouverture du flux SSE serveur→client (streamable HTTP). Notre serveur est SANS ÉTAT
  // et n'émet AUCUNE notification → réponse spec MCP : **405** (« pas de flux ici »). Le SDK officiel gère
  // 405 explicitement (il n'essaie plus). AVANT (01/09) : on répondait 200 text/event-stream puis on FERMAIT
  // aussitôt → le client reconnectait EN BOUCLE (journal edge : 4 GET en 4 s, ~1 s d'écart) puis abandonnait ;
  // côté claude.ai, cet abandon vaut « serveur déconnecté » → outils vidés « quelques secondes après Connecté »
  // (« Ce connecteur n'a aucun outil disponible »). GET non authentifié → 401 ci-dessous (défi OAuth, étape 1).
  if (isMcpEndpoint && request.method === 'GET' && authed) {
    return j({ error: 'method_not_allowed', message: 'Pas de flux serveur→client sur ce serveur (sans état) : utilise POST.' }, 405, { Allow: 'POST, OPTIONS' })
  }

  if (isMcpEndpoint && !authed) {
    return j({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` })
  }

  // ── Forward vers Supabase (OAuth + vrais appels d'outils authentifiés) ──
  const target = SUPABASE_MCP + path + inUrl.search
  const headers = new Headers(request.headers)
  headers.set('x-forwarded-host', host)
  headers.set('x-mcp-connect-host', host)
  if (body !== undefined) { headers.delete('content-length'); headers.delete('transfer-encoding') }
  const forward = () => fetch(target, { method: request.method, headers, body, redirect: 'manual' })
  // FORWARD RÉSILIENT : quand Supabase n'a aucun isolate chaud, la connexion entrante ÉCHOUE pendant le boot
  // (~2 s) ; un retry immédiat retombe sur le même boot. → 3 tentatives, pause 900 ms. JAMAIS de retry sur
  // timeout (la requête a pu être traitée). Réservé à l'OAuth (idempotent par construction) et aux appels
  // idempotents (GET, resources/*, prompts/*, ping, tools/call check_*/get_*/list_*). Les appels qui
  // DÉBITENT (generate_*, montage_ia, render…) gardent UN seul retry immédiat : pas de double débit.
  const withRetry = async (ms: number, shape: 'oauth' | 'rpc'): Promise<Response> => {
    const fail = (code: number, msg: string) => shape === 'oauth'
      ? j({ error: 'server_error', error_description: msg }, code)
      : j({ jsonrpc: '2.0', id: null, error: { code: code === 504 ? -32001 : -32002, message: msg } }, code)
    for (let i = 0; i < 3; i++) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms)
      try { return await fetch(target, { method: request.method, headers, body, redirect: 'manual', signal: ctrl.signal }) }
      catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return fail(504, 'upstream trop lent')
        if (i < 2) await new Promise((r) => setTimeout(r, 900))
      } finally { clearTimeout(t) }
    }
    return fail(502, 'upstream indisponible')
  }
  if (isOAuthEndpoint) return withRetry(8000, 'oauth')
  const idempotent = request.method === 'GET' ||
    (probe.rpcMethod !== '' && probe.rpcMethod !== '[batch]' &&
      (probe.rpcMethod !== 'tools/call' || /^(check_|get_|list_)/.test(probe.rpcTool)))
  if (idempotent) return withRetry(20000, 'rpc')
  try { return await forward() } catch (_) { return await forward() }
}

// ── JOURNAL EDGE (diagnostic 01/09) : ce que claude.ai envoie et ce qu'on répond → public.mcp_edge_log.
// Rien de sensible (préfixe du bearer seulement). Coût borné (≤ 350 ms), jamais bloquant, jamais en erreur.
async function logReq(request: Request, res: Response | null, probe: { rpcMethod: string; rpcTool: string }, err: string, ms: number) {
  try {
    const u = new URL(request.url)
    if (u.pathname.startsWith('/.netlify/')) return
    const auth = request.headers.get('authorization') || ''
    const ct = res?.headers.get('content-type') || ''
    const status = res?.status ?? 0
    const m = probe.rpcMethod
    const served = err ? 'edge-exception'
      : status === 202 ? 'edge-notif'
      : ct.includes('event-stream') ? 'edge-sse'
      : (status === 405 && request.method === 'GET') ? 'edge-sse-405'
      : (status === 401 && !auth) ? 'edge-401'
      : (m && (DISCOVERY.has(m) || m === 'resources/read') && status === 200) ? 'edge-discovery'
      : 'forward'
    // Audit 05/09 (H5) : la clé perso `aa_<hex>` circule dans le CHEMIN (et `?key=`) → jamais en clair au journal.
    const safePath = (u.pathname + u.search).replace(/aa_[A-Za-z0-9]+/g, 'aa_***').replace(/([?&]key=)[^&]+/g, '$1***')
    const row = {
      method: request.method, path: safePath.slice(0, 120),
      authed: /^Bearer\s+(aat_|aa_)/i.test(auth), bearer_prefix: auth.replace(/^Bearer\s+/i, '').slice(0, 10),
      rpc_method: m || null, rpc_batch: m === '[batch]', status, served, ms,
      ua: (request.headers.get('user-agent') || '').slice(0, 120), accept: (request.headers.get('accept') || '').slice(0, 80),
      extra: JSON.stringify({ sid: request.headers.get('mcp-session-id'), pv: request.headers.get('mcp-protocol-version'), tool: probe.rpcTool || undefined, err: err || undefined, ct: ct.slice(0, 40) }),
    }
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 200)
    await fetch(SB_LOG, { method: 'POST', headers: { apikey: SB_PUBLISHABLE, Authorization: `Bearer ${SB_PUBLISHABLE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row), signal: ctrl.signal })
      .catch(() => {}).finally(() => clearTimeout(t))
  } catch { /* jamais bloquant */ }
}

export default async (request: Request): Promise<Response> => {
  const t0 = Date.now()
  const probe = { rpcMethod: '', rpcTool: '' }
  let res: Response | null = null
  let err = ''
  try { res = await handle(request, probe); return res }
  catch (e) { err = String((e as Error)?.message || e); res = j({ error: 'edge_exception', message: err }, 500); return res }
  finally { await logReq(request, res, probe, err, Date.now() - t0) }
}

// /.well-known/* est EXCLU : servi par le CDN comme fichiers statiques (voir ../../.well-known + _headers),
// donc sans edge function, sans cold start, en cache sur chaque POP.
// /.netlify/* aussi (fonctions Netlify, dont warm.mjs) : routes internes, jamais du trafic MCP.
// 02/09 : /.well-known/* revient à l'EDGE (même document que les fichiers statiques, qui restent en filet) :
// l'edge répond en ~1 ms et, surtout, chaque fetch du VÉRIFICATEUR de claude.ai est JOURNALISÉ avec sa latence —
// en CDN on ne voyait rien quand il disait « Trouver le serveur d'autorisation : la connexion a expiré ».
// /assets/* = fichiers statiques publics servis par le CDN (ex. une image à donner à Claude comme image_url).
export const config = { path: '/*', excludedPath: ['/.netlify/*', '/assets/*'] }
