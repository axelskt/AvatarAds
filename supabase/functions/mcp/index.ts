import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// ImageScript : décodeur/redimensionneur PNG-JPEG en WASM. Indispensable ici —
// le chef d'orchestre REFUSE les miniatures au-dessus de 400 Ko, et une photo
// d'utilisateur en pèse 2 à 3. Sans réduction, il reçoit le nom du média mais
// jamais l'image : il ne le place donc pas (vu le 31/07, broll vide).
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'

// ── Serveur MCP AvatarAds ↔ Claude (#73) ──
// Protocole MCP « Streamable HTTP » (JSON-RPC sur POST, réponses JSON, sans état).
// Compatible connecteurs personnalisés claude.ai et `claude mcp add --transport http`.
//
//   POST /mcp/key            (JWT utilisateur)  → gérer sa clé : status / create / revoke / set_confirm
//   POST /mcp/aa_<clé>       (clé personnelle)  → endpoint MCP (initialize, tools/list, tools/call)
//
// La clé est dans l'URL (pattern Zapier) : c'est la seule forme que les connecteurs
// claude.ai acceptent sans OAuth. Stockée hachée (HMAC service key), jamais en clair.
// Génération : gpt-image-2/1 (images) et Veo 3.1 (vidéos, job asynchrone start/poll).
// Crédits : mêmes tarifs que l'app, débit via les RPC service-only mcp_spend_credits
// / mcp_refund_credits (barème #79 : image 3 ou 5, vidéo 1/s).

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
// ── L'URL QU'ON DONNE À L'UTILISATEUR NE PEUT PAS ÊTRE CELLE DE SUPABASE ──
// Claude sonde l'emplacement RFC 9728 pour savoir si la ressource est protégée :
//   https://<hôte>/.well-known/oauth-protected-resource/<chemin>
// Sur supabase.co, c'est la PASSERELLE Supabase qui répond (jamais l'edge
// function) et elle renvoie 401 « No API key found in request ». Un 401 là-bas
// signifie « OAuth » : Claude enchaîne sur l'inscription dynamique du client,
// qu'on n'a pas, et échoue — « Impossible de s'inscrire auprès du service de
// connexion de AvatarAds ». Rien dans ce fichier ne peut corriger ça : la
// requête ne l'atteint jamais.
// On distribue donc l'adresse du relais (mcp-proxy/), servi depuis un domaine
// où l'on maîtrise /.well-known/* et où il répond 404 = « pas d'OAuth ».
const MCP_PUBLIC_BASE = 'https://mcp.avatarads.fr'   // 20/08 : domaine de marque (ex avatarads-mcp.netlify.app, toujours accepté)
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const GOOGLE_AI_KEY  = Deno.env.get('GOOGLE_AI_KEY') ?? ''
const HEDRA_API_KEY  = Deno.env.get('HEDRA_API_KEY') ?? ''
const ELEVEN_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? ''

const APP_URL         = 'https://avatarads.fr/app/'
const IMG_COST        = { standard: 3, high: 5 }
const VIDEO_COST_SEC  = 1.5 // Veo 3.1 Lite 720p (« Veo Standard ») = 0,05 $/s API (audio inclus)
const VIDEO_COST_SEC_PRO = 3 // Veo 3.1 Fast (« Veo Pro », qualité max) = 0,10 $/s API — modèle au choix
// ── Générateur (avatar parlant) via Claude : mêmes briques que l'app ──
const HEDRA_BASE      = 'https://api.hedra.com/web-app/public'
const HEDRA_MODEL_ID  = '26f0fc66-152b-40ab-abed-76c43df99bc8' // Hedra Avatar (swap 10/08, même modèle que l'app). Character-3 = d1dd37a3-e39a-4854-a298-6510289f9cf2
const AVATAR_COST_SEC = 2.5 // 2 cr/s lipsync Hedra (1080p, barème 23/08) + 0,5 cr/s voix ElevenLabs
const AVATAR_MAX_SEC  = 60
const CHARS_PER_SEC   = 14  // débit de parole FR moyen pour estimer la durée depuis le script
// Voix presets (mêmes IDs ElevenLabs que l'app)
const MCP_VOICES: Record<string, string> = {
  homme: 'onwK4e9ZLuTAKqWW03F9',  // Daniel — posé, confiant
  femme: 'XB0fDUnXU5powFXDhCwa',  // Charlotte — chaleureuse, naturelle
}
// Nettoyage audio (Voice Isolator ElevenLabs) : ~1 crédit / minute d'audio
const CLEAN_COST_PER_MIN = 1
const CLEAN_MAX_BYTES    = 15_000_000 // ~15 min de MP3 128 kbps
// Montage IA via Claude (#125) : chef d'orchestre + rendu serveur (mêmes tarifs que l'app)
// ⚠️ CE QUI DOIT CORRESPONDRE À L'APP, C'EST LE TOTAL, PAS LE DÉTAIL.
// Un montage complet coûte 8 crédits ici comme dans l'app (CREDIT_COSTS.montageIA),
// et un re-rendu de plan modifié en coûte 4 (CREDIT_COSTS.montageRender). Le
// montage étant facturé PLAN + RENDER, la somme doit donc faire 8.
const MONTAGE_PLAN_COST   = 4  // part « chef d'orchestre » (transcription Scribe + plan Claude)
const MONTAGE_RENDER_COST = 4  // = montageRender (MP4 monté par le moteur de rendu)
const MONTAGE_STYLES      = ['auto', 'apple', 'glass', 'dynamic', 'word']
const MONTAGE_MAX_BYTES   = 20_000_000 // limite du chef d'orchestre
// OmniHuman 1.5 (ByteDance via fal) — le moteur lipsync le plus réaliste (#107/#121)
const OMNI_COST_SEC = 5
const FAL_OMNI_PATH = 'fal-ai/bytedance/omnihuman/v1.5'
// ID d'APPLICATION fal (2 premiers segments) : c'est LUI qui sert au polling
// de la file d'attente, pas le chemin complet du modèle.
const FAL_OMNI_APP  = FAL_OMNI_PATH.split('/').slice(0, 2).join('/')
const FAL_QUEUE     = 'https://queue.fal.run'
const FAL_KEY = ['FALAI_API_KEY', 'FAL_KEY', 'FAL_API_KEY', 'FAL_AI_KEY', 'FALAI_KEY', 'FAL_SECRET']
  .map((n) => Deno.env.get(n)).find(Boolean) ?? ''
const falFetch = (path: string, init?: RequestInit) =>
  fetch(`${FAL_QUEUE}/${path}`, { ...init, headers: { Authorization: `Key ${FAL_KEY}`, ...(init?.headers || {}) } })
const GPT_IMG_MODELS  = ['gpt-image-2', 'gpt-image-1']
const VEO_MODELS      = ['veo-3.1-lite-generate-preview', 'veo-3.1-fast-generate-preview']
// Réalisme « UGC / makeugc » — MÊME bloc que le module Images IA de l'app
// (_IMG_REALISM_SUFFIX). Ajouté AUTOMATIQUEMENT à toute image de PERSONNE générée via
// le MCP → rendu photo Instagram réelle, plus de « random IA ». Leçon clé : le bloc
// porte le détail ET les INTERDITS (jamais lisser/plastifier/filtre beauté) — c'est
// l'interdit qui tue l'effet « peau de cire ». JAMAIS sur un produit (packshot).
const IMG_REALISM_SUFFIX = '. Shot as a real candid amateur photo taken on a phone — NOT a professional studio portrait, no beauty retouching. Natural realistic human skin with fine natural texture and normal pores, subtle imperfections and slightly uneven skin tone, fine peach fuzz, a natural hairline with a few flyaways, individual eyebrow hairs and eyelashes, natural facial asymmetry, an authentic relaxed candid expression, believable natural lighting and true-to-life colors. The ENTIRE background is sharp and in focus (deep depth of field, no background blur, no bokeh, no lens blur). Frame the person fairly close so the face is large, prominent and richly detailed in the frame — a chest-up shot or closer, never a tiny or far-away face — unless a clearly wider or full-body composition is requested. Keep it natural, clean and flattering — never plastic, waxy, airbrushed, over-smoothed, over-sharpened, blotchy or over-textured, no exaggerated or enlarged pores, no heavy blemishes. It must look like a genuine unedited real photograph, clearly NOT AI-generated, NOT 3D, NOT CGI, no digital-art look, no beauty filter.'
const RE_PERSONNE = /\b(femmes?|filles?|hommes?|gar[çc]ons?|meufs?|nanas?|influenceu\w*|mannequins?|mod[eè]les?|models?|selfies?|portraits?|personnes?|gens|visages?|humains?|humans?|women|woman|man|men|girls?|boys?|guys?|ladies|lady|people|persons?|faces?|influencers?|creators?|avatars?|ugc)\b/i
// N'augmente QUE si le prompt parle d'une personne (sinon on casserait un packshot produit).
function augmenterPortrait(prompt: string): string {
  if (!RE_PERSONNE.test(prompt)) return prompt
  return prompt.slice(0, 3990 - IMG_REALISM_SUFFIX.length) + IMG_REALISM_SUFFIX
}
// Accès réservé Pro/Élite (+ developer/owner) ; plafond de crédits dépensés via MCP par 24 h
const ALLOWED_PLANS   = ['pro', 'elite']
const DAILY_CAPS: Record<string, number> = { pro: 100, elite: 200 }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  // WWW-Authenticate n'est PAS un header « safelisted » : sans Expose-Headers un
  // client MCP dans un NAVIGATEUR (vérification du nouvel écran claude.ai,
  // inspector) reçoit le 401 mais ne peut pas LIRE resource_metadata → la
  // découverte OAuth est « Ignorée ». Ajout 29/08, purement additif.
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function hashKey(key: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(key)))
  return Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('')
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Tâche de fond garantie jusqu'au flush : sans ça, l'isolate edge peut être tué
// avant qu'une écriture « fire-and-forget » (ex. last_used_at, rattrapage) ne parte.
function bg(task: Promise<unknown>) {
  const ru = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (ru?.waitUntil) ru.waitUntil(task.catch(() => {}))
  else task.catch(() => {})
}

// Anti-SSRF : refuse les hôtes internes / link-local / metadata pour une URL fournie par l'utilisateur.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'metadata.google.internal') return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = +m[1], b = +m[2]
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return true
  }
  if (h.includes(':')) { // IPv6 littéral
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:')) return true
  }
  return false
}

async function uploadMedia(userId: string, bytes: Uint8Array, ext: string, contentType: string): Promise<string> {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await svc.storage.from('mcp-media').upload(path, bytes, { contentType })
  if (error) throw new Error('upload: ' + error.message)
  return `${SUPABASE_URL}/storage/v1/object/public/mcp-media/${path}`
}

// ── FILET : ranger la création dans la BIBLIOTHÈQUE du compte ────────────────
// Une génération MCP n'apparaît PAS dans l'app (elle vit dans mcp-media public, l'app lit
// render-media privé + library_items). Or quand le proxy claude.ai mange la réponse, la carte
// ne s'affiche jamais : le client croit avoir tout perdu. On dépose donc une COPIE dans sa
// Bibliothèque (bucket render-media/<uid>/lib + ligne library_items, EXACTEMENT le format de
// l'app) → il retrouve TOUJOURS sa vidéo/image dans son compte, indépendamment de claude.ai.
// Best-effort absolu : jamais un throw ici ne doit empêcher la livraison.
async function saveToLibrary(userId: string, bytes: Uint8Array, ext: string, mime: string, kind: string, name: string, thumb?: string): Promise<void> {
  try {
    const path = `${userId}/lib/mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await svc.storage.from('render-media').upload(path, bytes, { contentType: mime, upsert: true })
    if (error) return
    await svc.from('library_items').insert({ user_id: userId, kind, name, tags: [], storage_path: path, ...(thumb ? { thumb } : {}) })
  } catch (_) { /* la Bibliothèque est un filet, jamais un bloquant */ }
}

// ── L'IMAGE DOIT S'AFFICHER DANS CLAUDE, PAS ÊTRE UN LIEN ───────────────────
// Axel : « les vidéos et images ne s'affichent pas dans Claude ». Le protocole
// MCP sait renvoyer un bloc `image` en base64, que le client rend en vignette —
// mais l'originale pèse 3 Mo (≈ 4 Mo une fois en base64), impensable dans un
// résultat d'outil. On fabrique donc une vignette ~640 px à la génération, une
// seule fois, et c'est elle qu'on renvoie. Si la vignette échoue, on retombe
// simplement sur le lien : jamais de génération perdue pour une miniature.
const APERCU_LARGEUR = 1080   // vignette rendue en grand dans le fil claude.ai → nette (Axel « non pixélisé »)
async function fabriquerApercu(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    // 1.3.0 : la 1.2.17 plantait une fois sur deux sur les PNG gpt-image
    // (profils couleur) — c'est pour ça qu'Axel ne voyait « que des liens »
    const { Image } = await import('https://deno.land/x/imagescript@1.3.0/mod.ts')
    const img = await Image.decode(bytes)
    if (img.width > APERCU_LARGEUR) img.resize(APERCU_LARGEUR, Image.RESIZE_AUTO)
    return await img.encodeJPEG(82)
  } catch (e) {
    console.error('apercu:', (e as Error)?.message || e)
    return null
  }
}
// Recadre une image AU RATIO cible (9:16 ou 16:9) par recadrage CENTRÉ. ⚠ Veo IGNORE
// `aspectRatio` quand on lui fournit une image de départ : il garde le ratio de l'IMAGE.
// Une photo 2:3 (ex. 1024×1536) sort donc en 2:3 et pas en 9:16. On recadre l'image
// AVANT de l'envoyer → la vidéo sort au bon format. Tolérance ±3 % (on ne touche pas si
// c'est déjà bon). Ne jette jamais vers l'appelant (try/catch côté bg).
async function reframeToAspect(bytes: Uint8Array, aspect: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const target = aspect === '16:9' ? 16 / 9 : 9 / 16
  const img = await Image.decode(bytes)
  const cur = img.width / img.height
  if (Math.abs(cur - target) / target <= 0.03) return { bytes, mimeType: 'image/png' }
  let cw = img.width, ch = img.height, cx = 0, cy = 0
  if (cur > target) { cw = Math.round(img.height * target); cx = Math.round((img.width - cw) / 2) }
  else { ch = Math.round(img.width / target); cy = Math.round((img.height - ch) / 2) }
  const cropped = img.crop(cx, cy, cw, ch)
  return { bytes: await cropped.encode(), mimeType: 'image/png' }
}
// Un résultat d'outil ne doit pas dépasser ~1,5 Mo : au-delà, les clients
// tronquent ou refusent. Mais « trop gros » ne doit plus JAMAIS vouloir dire
// « pas d'image » : on REDIMENSIONNE à la volée (768 px JPEG ≈ 100-250 Ko).
const APERCU_MAX_OCTETS = 1_500_000
const b64DepuisOctets = (buf: Uint8Array): string => {
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}
async function blocImage(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    if (!buf.length) return null
    // au-delà de 400 Ko on tente la réduction (l'image s'affiche pareil dans la
    // carte, et la conversation reste légère) ; en dessous, le fichier tel quel
    if (buf.length > 400_000) {
      const petit = await fabriquerApercu(buf)
      if (petit && petit.length <= APERCU_MAX_OCTETS)
        return { type: 'image', data: b64DepuisOctets(petit), mimeType: 'image/jpeg' }
    }
    if (buf.length > APERCU_MAX_OCTETS) return null   // réduction impossible ET trop gros
    const mime = /\.png($|\?)/i.test(url) ? 'image/png' : 'image/jpeg'
    return { type: 'image', data: b64DepuisOctets(buf), mimeType: mime }
  } catch { return null }
}

const isUnlimited = (p: Record<string, unknown>) =>
  (String(p.plan || '').toLowerCase() === 'developer') || !!p.is_owner

async function spendCredits(userId: string, n: number): Promise<number | null> {
  const { data, error } = await svc.rpc('mcp_spend_credits', { p_user: userId, p_secs: n })
  return error ? null : (data as number)
}
async function refundCredits(userId: string, n: number): Promise<void> {
  await svc.rpc('mcp_refund_credits', { p_user: userId, p_secs: n })
}

// Crédits dépensés via MCP sur les dernières 24 h (jobs vidéo + images, hors remboursés)
async function mcpSpentToday(userId: string): Promise<number> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const { data } = await svc.from('mcp_jobs').select('credits_cost, refunded')
    .eq('user_id', userId).gte('created_at', dayAgo)
  return (data || []).filter((j) => !j.refunded).reduce((s, j) => s + (j.credits_cost || 0), 0)
}

// Contexte d'exécution des outils (clé + plan)
type ToolCtx = { requireConfirm: boolean; dailyCap: number | null }

// Devis / plafond communs aux deux générateurs. Retourne null si on peut débiter.
async function preSpendGate(
  profile: Record<string, unknown>, ctx: ToolCtx, args: Record<string, unknown>,
  cost: number, label: string, toolName: string,
): Promise<ToolContent | null> {
  if (ctx.requireConfirm && args.confirm !== true) {
    const bal = Number(profile.credits_remaining) || 0
    const balTxt = isUnlimited(profile) ? '∞' : `${bal} → ${bal - cost} après génération`
    return toolText(
      `🧾 Devis — ${label}
Coût : ${cost} crédits · solde : ${balTxt}
Montre ce devis à l'utilisateur et attends son accord explicite, puis rappelle ${toolName} avec les mêmes paramètres + confirm: true. Ne confirme JAMAIS à sa place.`)
  }
  if (ctx.dailyCap !== null && !isUnlimited(profile)) {
    const spent = await mcpSpentToday(String(profile.id))
    if (spent + cost > ctx.dailyCap) {
      return toolErr(`Plafond quotidien via Claude atteint : ${spent}/${ctx.dailyCap} crédits sur 24 h (cette génération en demande ${cost}). Réessaie plus tard ou génère directement sur ${APP_URL}`)
    }
  }
  return null
}

// ── Réponses JSON-RPC / contenus d'outils ──
const rpcResult = (id: unknown, result: unknown) => json(200, { jsonrpc: '2.0', id, result })
const rpcError = (id: unknown, code: number, message: string) =>
  json(200, { jsonrpc: '2.0', id, error: { code, message } })
type ToolContent = { content: Array<Record<string, unknown>>; isError?: boolean; structuredContent?: Record<string, unknown> }
const toolText = (t: string): ToolContent => ({ content: [{ type: 'text', text: t }] })
const toolErr = (t: string): ToolContent => ({ content: [{ type: 'text', text: t }], isError: true })

// ── ANNONCER UN MÉDIA, PAS SEULEMENT SON URL ────────────────────────────────
// J'avais affirmé à Axel qu'aucun serveur MCP ne pouvait faire apparaître une
// vidéo dans la conversation. C'était faux, et son contre-exemple l'a montré :
// Higgsfield y arrive. Le protocole ne connaît pas de type « vidéo », mais il
// connaît le LIEN DE RESSOURCE, qui porte un mimeType arbitraire — et ce que le
// client en fait ensuite n'est pas dans la spec, c'est son affaire.
// On ne peut pas embarquer le fichier : un montage pèse 20 Mo, impensable en
// base64 dans un résultat d'outil. Le lien, lui, coûte trois lignes.
// ── MCP APPS · LE VIEWER MÉDIA (#79) ────────────────────────────────────────
// claude.ai pré-charge ce template via resources/read (l'URI déclarée dans
// _meta.ui.resourceUri) puis l'affiche en iframe et lui pousse le résultat de
// l'outil par postMessage. Le média vient de structuredContent { url, kind, name }.
//
// ⚠⚠ LEÇON PLETOR (16/08) — apprise en inspectant api.pletor.ai/mcp, un connecteur
// PUBLIC qui MARCHE dans claude.ai : le JS du widget NE PEUT PAS être inline. La
// sandbox du host applique un CSP strict (pas de 'unsafe-inline' sur script-src)
// → notre <script> inline n'a JAMAIS tourné, le handshake ne partait pas, la carte
// restait vide. Pletor sert son JS depuis un domaine autorisé (leur API) et
// déclare `domain` + `ui/resourceUri` à plat. On fait pareil : JS servi à
// WIDGET_ORIGIN/widget.js, chargé en <script type=module src>.
const WIDGET_ORIGIN = 'https://mcp.avatarads.fr'
// Le corps du widget, servi tel quel à GET /widget.js (hors sandbox → autorisé).
const UI_WIDGET_JS = `
var aaOk=false, aaSeen=[], aaHugW=0, aaId=100, aaUrlNow='', aaKindNow='', aaNameNow='', aaPollT=null, aaPct=5, aaStart=0, aaPrompt='', aaJobId='', aaFormat='portrait', aaRef='', aaRaw=false, aaProductUrl='';
// Requête vers l'HÔTE (claude.ai) — protocole MCP Apps : télécharger un fichier
// (ui/download-file), ouvrir un lien (ui/open-link), ou envoyer un message au chat
// (ui/message = régénérer). Le sandbox bloque download+popups DIRECTS depuis l'iframe,
// mais l'HÔTE peut les faire → c'est le mécanisme des boutons d'Alexya.
function aaSend(method, params){ try{ window.parent.postMessage({ jsonrpc:'2.0', id:(++aaId), method:method, params:params }, '*'); }catch(e){} }
function aaUrlFrom(out){
  var sc=(out&&(out.structuredContent||out))||{};
  var url=sc.url||'';
  if(!url&&out&&out.content){ for(var i=0;i<out.content.length;i++){ var t=(out.content[i]&&out.content[i].text)||''; var mm=/https?:[^\\s)\\]]+/.exec(t); if(mm){ url=mm[0]; break; } } }
  return { url:url, kind:sc.kind||'', name:sc.name||'', statusUrl:sc.statusUrl||sc.status_url||'', prompt:sc.prompt||'', job_id:sc.job_id||'', format:sc.format||'', ref:sc.ref||'', raw:!!sc.raw, pending:!!sc.pending, productUrl:sc.productUrl||'' };
}
function aaBtns(){
  var b=document.getElementById('b'); if(b) b.style.display='flex';
  var dl=document.getElementById('dl'), rg=document.getElementById('rg');
  var v=aaKindNow==='video';
  // Télécharger : claude.ai N'honore PAS ui/download-file, mais honore ui/open-link.
  // Lien de MARQUE mcp.avatarads.fr/i/<jobId>?download=<nom> (302 → média + Content-
  // Disposition:attachment) au lieu de l'URL Supabase brute dans la modale « Ouvrir le lien ».
  // Repli aaUrlNow (déjà en /i/ pour les vidéos) s'il n'y a pas de job_id.
  if(dl){ dl.disabled=false; dl.onclick=function(){ var fn=(aaNameNow||'avatarads')+(v?'.mp4':'.png'); var base=aaJobId?('https://mcp.avatarads.fr/i/'+aaJobId):aaUrlNow; var u=base+(base.indexOf('?')<0?'?':'&')+'download='+encodeURIComponent(fn); aaSend('ui/open-link', { url:u }); }; }
  // Regénérer EN UN CLIC : le widget tape /regenerate (job_id = capacité) → PAS de chat,
  // pas d'avertissement. La MÊME carte repart en mode progression → nouvelle image.
  // ⚠ /regenerate est IMAGE-ONLY → sur une VIDÉO on cache le bouton (pas de re-gen vidéo).
  if(rg){ if(v){ rg.style.display='none'; } else { rg.style.display=''; rg.disabled=false; rg.textContent='↻ Regénérer'; rg.onclick=function(){
    if(!aaJobId||!aaPrompt){ return; }
    var lbl='↻ Regénérer'; rg.disabled=true; rg.textContent='↻ …';
    fetch('https://mcp.avatarads.fr/regenerate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ job:aaJobId, prompt:aaPrompt, format:aaFormat||'portrait', ref:aaRef||'', raw:!!aaRaw }) })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(x){ if(x.ok&&x.j&&x.j.statusUrl){ aaJobId=x.j.job_id||aaJobId; aaOk=false; aaPct=5; aaStartPoll(x.j.statusUrl); } else { var er=(x.j&&x.j.error)||''; rg.textContent=er==='daily_cap'?'Plafond 24 h':(er==='no_credits'||er==='credits')?'Crédits épuisés':'Échec'; setTimeout(function(){ rg.textContent=lbl; rg.disabled=false; }, 2400); } })
      .catch(function(){ rg.textContent='Réessaie'; setTimeout(function(){ rg.textContent=lbl; rg.disabled=false; }, 2200); });
  }; } }
}
function aaMedia(url, kind, name){
  aaOk=true; aaUrlNow=url; aaNameNow=(name||'').replace(/[^a-z0-9]+/gi,'-').toLowerCase();
  var v=kind==='video'||/\\.(mp4|mov|webm|m4v)(\\?|#|$)/i.test(url); aaKindNow=v?'video':'image';
  var m=document.getElementById('m');
  m.innerHTML = v
    ? '<video src="'+url+'#t=0.1" controls playsinline preload="metadata" class="aa-m"></video>'
    : '<img src="'+url+'" alt="" class="aa-m"/>';
  var media=m.querySelector('video,img');
  if(media){ media.addEventListener(v?'loadeddata':'load', aaKick); }
  m.style.padding='0'; aaBtns(); aaKick();
}
function aaSetPct(p){ if(p>aaPct) aaPct=p; var pb=document.getElementById('pb'); if(pb) pb.style.width=aaPct+'%'; }
function aaPollStatus(u){
  fetch(u, { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(j){
    if(!j) return;
    if(typeof j.progress==='number') aaSetPct(j.progress);
    if(j.status==='done' && j.url){ if(aaPollT){ clearInterval(aaPollT); aaPollT=null; } aaSetPct(100); setTimeout(function(){ aaMedia(j.url, j.kind||'image', ''); }, 350); return; }
    if(j.status==='failed'){ if(aaPollT){ clearInterval(aaPollT); aaPollT=null; } var pt=document.getElementById('pt'); if(pt) pt.textContent='Échec de la génération — réessaie.'; }
  }).catch(function(){});
}
function aaStartPoll(u){
  aaStart=Date.now();
  var b=document.getElementById('b'); if(b) b.style.display='none';
  var m=document.getElementById('m');
  m.innerHTML='<div class="aa-pt" id="pt">Génération en cours…</div><div class="aa-pw"><div class="aa-pb" id="pb"></div></div>';
  aaSetPct(6); aaKick(); aaPollStatus(u);
  aaPollT=setInterval(function(){ if(Date.now()-aaStart>240000){ if(aaPollT){ clearInterval(aaPollT); aaPollT=null; } return; } aaPollStatus(u); }, 2500);
}
function aaShow(out){
  try{
    var d=aaUrlFrom(out);
    if(d.prompt) aaPrompt=d.prompt;
    if(d.job_id) aaJobId=d.job_id;
    if(d.format) aaFormat=d.format;
    if(d.ref) aaRef=d.ref; if(d.raw) aaRaw=true; if(d.productUrl) aaProductUrl=d.productUrl;
    if(d.url){ aaMedia(d.url, d.kind, d.name); return; }
    if(d.pending){ aaAskPhoto(); return; }
    if(d.statusUrl){ aaStartPoll(d.statusUrl); return; }
  }catch(e){}
}
// ── PHOTO DU PRODUIT DANS LA CARTE (21/08) : claude.ai ne transmet pas les images jointes aux outils →
//    l'utilisateur la dépose ICI (glisser / choisir / coller), le widget l'envoie à /start qui lance la
//    génération avec le produit à l'identique, dans la MÊME carte. « Sans photo » = génération libre. ──
function aaAskPhoto(){
  aaOk=true; if(aaPollT){ clearInterval(aaPollT); aaPollT=null; }
  var b=document.getElementById('b'); if(b) b.style.display='none';
  var m=document.getElementById('m'); m.style.padding='0';
  m.innerHTML='<div id="dz" style="margin:12px;padding:20px 16px;text-align:center;border:1.5px dashed var(--aa-line);border-radius:12px;transition:border-color .15s">'
    +'<div style="font-size:14.5px;font-weight:700;margin-bottom:4px">Dépose la photo de ton produit</div>'
    +'<div style="font-size:12px;opacity:.72;margin-bottom:14px">Glisse-la ici, choisis-la ou colle-la (⌘V) · PNG, JPG, WebP — elle sera reproduite à l\\'identique</div>'
    +'<input type="file" id="fi" accept="image/png,image/jpeg,image/webp" style="display:none">'
    +'<button class="aa-a aa-dl" id="pick" type="button" style="border:none;cursor:pointer">Choisir une photo</button>'
    +'<button class="aa-a aa-rg" id="skip" type="button" style="border:none;cursor:pointer;margin-left:8px">Sans photo</button>'
    +'<div style="display:flex;gap:6px;margin-top:12px;align-items:center"><input id="pl" type="url" placeholder="ou colle le lien de la page produit…" style="flex:1;min-width:0;font-size:12px;padding:8px 10px;border-radius:9px;border:1px solid var(--aa-line);background:transparent;color:inherit;outline:none"><button class="aa-a aa-rg" id="go" type="button" style="border:none;cursor:pointer;padding:8px 12px">OK</button></div>'
    +'<div id="pe" style="font-size:12px;margin-top:10px;min-height:16px;opacity:.85"></div></div>';
  var dz=document.getElementById('dz'), fi=document.getElementById('fi');
  document.getElementById('pick').onclick=function(){ try{ fi.click(); }catch(e){ var pe=document.getElementById('pe'); if(pe) pe.textContent='Glisse la photo directement dans la carte.'; } };
  fi.onchange=function(){ if(fi.files&&fi.files[0]) aaSendPhoto(fi.files[0]); };
  dz.addEventListener('dragover',function(e){ e.preventDefault(); dz.style.borderColor='#FF5A1F'; });
  dz.addEventListener('dragleave',function(){ dz.style.borderColor=''; });
  dz.addEventListener('drop',function(e){ e.preventDefault(); dz.style.borderColor=''; var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(f) aaSendPhoto(f); });
  document.addEventListener('paste',function(e){ var it=e.clipboardData&&e.clipboardData.items; if(!it) return; for(var i=0;i<it.length;i++){ if(it[i].type&&it[i].type.indexOf('image/')===0){ var f=it[i].getAsFile(); if(f){ aaSendPhoto(f); break; } } } });
  document.getElementById('skip').onclick=function(){ aaStartJob(''); };
  var pl=document.getElementById('pl'), go=document.getElementById('go');
  if(aaProductUrl){ pl.value=aaProductUrl; var _pe=document.getElementById('pe'); if(_pe) _pe.textContent='Lecture de la page produit…'; aaStartJob('', aaProductUrl); }
  var _go2=null;
  var sendLink=function(){ var v=(pl.value||'').trim(); if(!(new RegExp('^https?://','i')).test(v)){ var pe=document.getElementById('pe'); if(pe) pe.textContent='Colle un lien complet (https://…)'; return; } aaStartJob('', v); };
  go.onclick=sendLink; pl.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); sendLink(); } });
  pl.addEventListener('paste',function(e){ e.stopPropagation(); });   // coller un lien ≠ coller une image
  aaHugW=Math.max(320, Math.min(560, Math.ceil(window.innerWidth||420))); aaMeasure();
}
function aaSendPhoto(file){
  var pe=document.getElementById('pe'); if(pe) pe.textContent='Préparation de la photo…';
  if(!file||!(new RegExp('^image/(png|jpe?g|webp)$')).test(file.type||'')){ if(pe) pe.textContent='PNG, JPG ou WebP uniquement.'; return; }
  var fr=new FileReader();
  fr.onload=function(){
    var img=new Image();
    img.onload=function(){
      var k=Math.min(1, 2048/Math.max(img.naturalWidth||1, img.naturalHeight||1));
      var cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round((img.naturalWidth||1)*k)); cv.height=Math.max(1,Math.round((img.naturalHeight||1)*k));
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      var out=cv.toDataURL(file.type==='image/png'?'image/png':'image/jpeg', 0.92);
      aaStartJob(out);
    };
    img.onerror=function(){ if(pe) pe.textContent='Image illisible — essaie un PNG ou un JPG.'; };
    img.src=fr.result;
  };
  fr.readAsDataURL(file);
}
function aaStartJob(dataUrl, link){
  var pe=document.getElementById('pe'); if(pe) pe.textContent=link?'Lecture de la page produit…':(dataUrl?'Envoi de la photo…':'Lancement…');
  var pk=document.getElementById('pick'), sk=document.getElementById('skip'); if(pk) pk.disabled=true; if(sk) sk.disabled=true;
  fetch('https://mcp.avatarads.fr/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ job:aaJobId, data_url:dataUrl||'', product_url:link||'', skip:!dataUrl&&!link }) })
    .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(x){
      if(x.ok&&x.j&&x.j.statusUrl){ if(x.j.ref) aaRef=x.j.ref; if(x.j.prompt) aaPrompt=x.j.prompt; aaRaw=true; aaOk=false; aaPct=5; aaStartPoll(x.j.statusUrl); return; }
      var er=(x.j&&x.j.error)||'';
      if(pe) pe.textContent = er==='daily_cap'?'Plafond 24 h atteint':(er==='no_credits'||er==='credits')?'Crédits épuisés — recharge sur avatarads.fr':er==='expired'?'Carte expirée — redemande à Claude':er==='not_pending'?'Déjà lancé':er==='plan'?'Réservé aux plans Pro et Élite':er==='no_image_in_link'?'Photo non récupérable depuis ce lien (site protégé) — dépose-la ci-dessus, ou colle le lien DIRECT de l\\'image':'Échec ('+(er||'réseau')+') — réessaie';
      if(pk) pk.disabled=false; if(sk) sk.disabled=false;
    })
    .catch(function(){ if(pe) pe.textContent='Réseau indisponible — réessaie.'; if(pk) pk.disabled=false; if(sk) sk.disabled=false; });
}
function aaLikely(p){ return p&&(p.structuredContent||(p.content&&p.content.length)); }
function aaTheme(t){ try{ document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light'); }catch(e){} }
var aaReady=false, aaFinal=false, aaLW=0, aaLH=0, aaSched=false;
function aaMeasure(){
  if(aaSched) return; aaSched=true;
  requestAnimationFrame(function(){
    aaSched=false; if(!aaReady) return;
    var html=document.documentElement, oh=html.style.height;
    html.style.height='max-content';
    var h=Math.ceil(html.getBoundingClientRect().height);
    html.style.height=oh;
    // largeur = celle du média (aaHugW, calculée depuis ses dimensions réelles → jamais 0) ;
    // avant que le média soit chargé, on retombe sur le viewport (avec plancher). JAMAIS ~0
    // (sinon iframe à 0 → image « disparue » → tempête → 502).
    var w = aaHugW > 0 ? aaHugW : Math.max(200, Math.ceil(window.innerWidth || 360));
    if(w!==aaLW||h!==aaLH){ aaLW=w; aaLH=h;
      window.parent.postMessage({ jsonrpc:'2.0', method:'ui/notifications/size-changed', params:{ width:w, height:h } }, '*'); }
  });
}
function aaKick(){
  // hug par les DIMENSIONS DE L'IMAGE (réelles, jamais 0 → pas d'effondrement) : on cale
  // l'iframe pile sur la largeur d'affichage du média (hauteur max 620), donc aucune bande.
  try{ var _e=document.querySelector('#m video,#m img');
    if(_e){ var _nw=_e.videoWidth||_e.naturalWidth||0, _nh=_e.videoHeight||_e.naturalHeight||0;
      if(_nw>0&&_nh>0){ var _dh=Math.min(_nh,620); aaHugW=Math.max(240,Math.min(680,Math.round(_nw*_dh/_nh))); } } }catch(e){}
  aaMeasure();
}
function aaFinalize(){
  if(aaFinal) return; aaFinal=true;
  try{ window.parent.postMessage({ jsonrpc:'2.0', method:'ui/notifications/initialized', params:{} }, '*'); }catch(e){}
  aaReady=true;
  try{ var ro=new ResizeObserver(aaMeasure); ro.observe(document.documentElement); ro.observe(document.body); }catch(e){}
  aaMeasure(); setTimeout(aaMeasure,300); setTimeout(aaMeasure,1500);
}
window.addEventListener('message', function(e){
  var d=e.data||{};
  try{ aaSeen.push(d.method||d.type||(d.id!==undefined?'rep#'+d.id:'msg')); }catch(_){ }
  if(d.jsonrpc==='2.0'&&d.id===1&&d.result){
    try{ var hc=d.result.hostContext||{}; if(hc.theme) aaTheme(hc.theme); if(hc.toolInfo&&hc.toolInfo.result) aaShow(hc.toolInfo.result); }catch(_){ }
    aaFinalize(); return;
  }
  if(d.jsonrpc==='2.0'&&d.method&&d.id===undefined){
    if(d.method==='ui/notifications/tool-result') aaShow(d.params||{});
    else if(d.method==='ui/notifications/host-context-changed'&&d.params&&d.params.theme) aaTheme(d.params.theme);
    else if(aaLikely(d.params)) aaShow(d.params);
    return;
  }
  if(d.type==='ui-lifecycle-iframe-render-data'&&d.payload&&d.payload.renderData){
    var rd=d.payload.renderData; aaShow(rd.toolOutput||rd.toolResult||rd);
  }
});
window.parent.postMessage({ jsonrpc:'2.0', id:1, method:'ui/initialize', params:{
  capabilities:{}, clientInfo:{ name:'AvatarAds Media Viewer', version:'1.0.0' },
  appCapabilities:{ availableDisplayModes:['inline'] },
  appInfo:{ name:'AvatarAds Media Viewer', version:'1.0.0' },
  protocolVersion:'2026-01-26' } }, '*');
window.parent.postMessage({ type:'ui-lifecycle-iframe-ready' }, '*');
setInterval(aaMeasure, 1000);
setTimeout(aaFinalize, 1200);
setTimeout(function(){ if(!aaOk && !aaPollT){ try{ document.getElementById('m').textContent='AvatarAds — génération en cours…'; }catch(e){} } }, 6000);
`

const UI_VIEWER_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  /* ⚠ ANGLES BLANCS : claude.ai peint un fond BLANC derrière l'iframe → il transparaissait
     aux 4 coins arrondis de la carte (fond transparent). Fix = html/body OPAQUES et de la
     MÊME couleur que la carte (thème-aware) → les coins montrent la couleur de la carte,
     plus le blanc de l'hôte. Palette en variables : clair par défaut, sombre via
     [data-theme=dark] (posé par aaTheme) ET la préférence OS (garde :not([data-theme=light])). */
  :root{--aa-bg:#fff;--aa-fg:#1a1a1a;--aa-line:rgba(128,128,128,.28);--aa-btn:rgba(128,128,128,.16)}
  :root[data-theme=dark]{--aa-bg:#1f1f1f;--aa-fg:#ededed;--aa-line:rgba(255,255,255,.16);--aa-btn:rgba(255,255,255,.14)}
  @media (prefers-color-scheme:dark){:root:not([data-theme=light]){--aa-bg:#1f1f1f;--aa-fg:#ededed;--aa-line:rgba(255,255,255,.16);--aa-btn:rgba(255,255,255,.14)}}
  html,body{margin:0;background:var(--aa-bg);color:var(--aa-fg)}
  .aa-c{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    border:1px solid var(--aa-line);border-radius:16px;overflow:hidden;
    background:var(--aa-bg);color:var(--aa-fg);width:100%;box-sizing:border-box}
  #m a{display:block;font-size:0}
  #m{text-align:center;background:var(--aa-bg)}
  .aa-m{display:block;width:auto;max-width:100%;height:auto;max-height:760px;margin:0 auto;object-fit:contain;background:var(--aa-bg)}
  .aa-b{display:flex;align-items:center;gap:10px;padding:11px 13px;flex-wrap:wrap;
    border-top:1px solid var(--aa-line)}
  .aa-n{font-size:12.5px;font-weight:600;opacity:.9}
  .aa-a{font-size:13px;font-weight:700;text-decoration:none;padding:9px 16px;border-radius:10px;line-height:1;white-space:nowrap}
  .aa-dl{background:#FF5A1F;color:#fff}
  .aa-rg{background:var(--aa-btn);color:inherit}
  .aa-a:disabled{opacity:.55;cursor:default}
  .aa-pt{font-size:12.5px;opacity:.85;margin-bottom:2px}
  .aa-pw{height:6px;background:rgba(128,128,128,.22);border-radius:6px;overflow:hidden;margin:12px 0 2px}
  .aa-pb{height:100%;width:5%;background:#FF5A1F;border-radius:6px;transition:width .6s ease}
</style></head><body>
<div class="aa-c" id="c"><div id="m" style="padding:14px 13px;font-size:13px;opacity:.75">AvatarAds — chargement…</div>
<div class="aa-b" id="b" style="display:none"><button class="aa-a aa-rg" id="rg" type="button" style="border:none;cursor:pointer">↻ Regénérer</button><span style="flex:1"></span><button class="aa-a aa-dl" id="dl" type="button" style="border:none;cursor:pointer">Télécharger</button></div></div>
<script type="module" src="${WIDGET_ORIGIN}/widget.js"></script></body></html>`

// CSP du widget : sans `resourceDomains`, la sandbox de l'hôte bloque le
// chargement des images/vidéos externes dans l'iframe → carte vide (constaté
// au test OAuth du 15/08). L'origin Supabase sert tous les médias (mcp-media
// public + render-media signé), avatarads.fr sert les logos.
const SUPA_ORIGIN = (Deno.env.get('SUPABASE_URL') || 'https://guvwgiejzkiodghywpwj.supabase.co').replace(/\/$/, '')
// _meta.ui de la RESSOURCE — RÉDUIT à la forme officielle (video-resource-server).
// ⚠⚠ LA VRAIE CAUSE du « problème d'affichage » (trouvée le 16/08 dans le SDK
// officiel, src/spec.types.ts L704) : le champ `domain` est « Dedicated origin for
// view sandbox », dont « the format and validation rules are determined by each
// host » — claude.ai attend `{hash}.claudemcpcontent.com`, PAS un domaine à nous.
// Notre `domain: mcp.avatarads.fr` faisait échouer le sandbox de l'iframe →
// « problème d'affichage » → tempête de reconnexions. OMIS → claude.ai utilise son
// origine de sandbox par défaut (par conversation). On ne fait AUCUN appel CORS
// depuis l'iframe (juste un <img>), donc pas besoin de domaine stable.
// ★★★★★ VRAIE CAUSE FINALE (16/08 14h — console DevTools d'Axel) : le CSP du
// widget côté claude.ai BLOQUE le JS INLINE — « Refused to execute a script because
// its hash, its nonce, or 'unsafe-inline' does not appear in the script-src
// directive ». Donc `<script>${JS}</script>` inline ne tourne JAMAIS → handshake mort
// → rendu échoue → tempête. (Mon mock local mettait `'unsafe-inline'` → il passait à
// tort.) FIX = servir le JS en EXTERNE `<script src=WIDGET_ORIGIN/widget.js>` + mettre
// WIDGET_ORIGIN dans `resourceDomains` (→ mappe sur CSP `script-src`). C'est exactement
// le mécanisme de Pletor. `resourceDomains` reste OBLIGATOIRE aussi pour l'<img>
// Supabase (« omitted → no network resources »). PAS de `domain` (format host-
// spécifique, cassait le sandbox).
const UI_META = {
  ui: {
    csp: {
      connectDomains: [SUPA_ORIGIN, WIDGET_ORIGIN],
      resourceDomains: [WIDGET_ORIGIN, SUPA_ORIGIN, 'https://avatarads.fr'],
    },
  },
}

const UI_RESOURCES = ['image.html', 'video.html', 'avatar.html', 'montage.html'].map((n) => ({
  uri: `ui://avatarads/${n}`,
  name: `Viewer ${n}`,
  mimeType: 'text/html;profile=mcp-app',
  _meta: UI_META,
}))

const carteHtml = (url: string, nom: string, mime: string) => {
  const video = mime.startsWith('video')
  // Contrastes : la premiere version posait un libelle a 65 % d'opacite et un
  // bouton a bordure grise 35 % — sur le fond sombre de Claude, Axel ne voyait
  // ni l'un ni l'autre. Les couleurs sont maintenant declarees pour les DEUX
  // themes via prefers-color-scheme, et « Ouvrir » a un fond, pas un filet.
  // `#t=0.1` : le navigateur se cale sur la frame a 0,1 s et l'affiche comme
  // apercu. Sans ca le lecteur reste un rectangle noir tant qu'on n'a pas
  // appuye sur play — Axel : « pareil pour pas que le lecteur soit un
  // rectangle noir ». Aucune extraction serveur, aucun fichier en plus.
  const image = mime.startsWith('image')
  const media = video
    ? `<video src="${url}#t=0.1" controls playsinline preload="metadata" class="aa-m"></video>`
    : image
      ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="" class="aa-m" style="object-fit:contain"/></a>`
      : `<audio src="${url}" controls preload="metadata" class="aa-m" style="height:44px"></audio>`
  return `<style>
  .aa-c{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    border:1px solid rgba(128,128,128,.28);border-radius:16px;overflow:hidden;
    background:#fff;color:#1a1a1a;max-width:520px}
  .aa-m{width:auto;max-width:100%;height:auto;display:block;margin:0 auto;background:var(--aa-bg);max-height:70vh}
  .aa-b{display:flex;align-items:center;gap:10px;padding:11px 13px;flex-wrap:wrap;
    border-top:1px solid rgba(128,128,128,.22)}
  .aa-n{font-size:12.5px;font-weight:600;opacity:.9;font-variant-numeric:tabular-nums}
  .aa-a{font-size:13px;font-weight:700;text-decoration:none;padding:9px 16px;border-radius:10px;
    line-height:1;white-space:nowrap}
  .aa-dl{background:#FF5A1F;color:#fff}
  .aa-op{background:rgba(128,128,128,.16);color:inherit}
  @media (prefers-color-scheme:dark){
    .aa-c{background:#1f1f1f;color:#ededed;border-color:rgba(255,255,255,.16)}
    .aa-b{border-top-color:rgba(255,255,255,.12)}
    .aa-op{background:rgba(255,255,255,.14)}
  }
</style>
<div class="aa-c">
  ${media}
  <div class="aa-b">
    <span class="aa-n">${nom}</span>
    <a class="aa-a aa-dl" href="${url}" download="${nom}" style="margin-left:auto">T&#233;l&#233;charger</a>
    ${video ? `<a class="aa-a aa-op" href="${APP_URL}?video=${encodeURIComponent(url)}&nom=${encodeURIComponent(nom)}" target="_blank" rel="noopener">Ouvrir dans l&#39;&#201;diteur</a>` : ''}
    <a class="aa-a aa-op" href="${url}" target="_blank" rel="noopener">Ouvrir</a>
  </div>
</div>`
}

// ── FAIRE APPARAÎTRE LE MÉDIA, PAS SON URL ──────────────────────────────────
// J'avais affirmé qu'aucun serveur MCP ne pouvait afficher une vidéo dans la
// conversation. Faux : Higgsfield le fait. Axel m'a montré sa carte — lecteur,
// boutons Download / Recreate, icône `</>` — c'est un WIDGET HTML, pas un lien.
// Le client rend une ressource embarquée `text/html` dans une iframe ; c'est
// l'iframe qui va chercher le MP4 à son URL, donc AUCUN base64 : le problème du
// poids (21 Mo pour un montage) disparaît.
// On envoie les trois formes, de la plus riche à la plus sobre : le widget, le
// lien de ressource, puis le texte. Un client qui ignore la première tombe sur
// la suivante — on ne parie pas sur une seule.
// ── « COMME HIGGSFIELD » (31/07, demande d'Axel) ────────────────────────────
// Ce que fait réellement Higgsfield pour qu'un média « s'affiche dans le MCP » :
// (1) un bloc `image` MCP (base64) — les clients Claude le rendent nativement
// dans la carte de l'outil ; (2) demander AU MODÈLE d'écrire le markdown
// `![...](url)` — c'est le seul chemin pour que le visuel descende dans le FIL
// de la conversation (le rendu inline des ressources y est cassé côté client,
// cf. anthropics/claude-ai-mcp#238 — on contourne, on ne re-creuse pas).
// La vidéo n'a pas de bloc MCP : sa VIGNETTE (mcp_jobs.preview_url, 640 px)
// joue ce rôle, et le fil affiche vignette-image + lien cliquable vers le MP4.
const toolMedia = async (url: string, nom: string, mime: string, texte: string, apercuUrl?: string): Promise<ToolContent> => {
  // Bilan 16/08 : le widget ne se rend pas → on garde la VIGNETTE (bloc image),
  // seul visuel fiable, visible en dépliant la carte.
  const contenu: Array<Record<string, unknown>> = []
  const estVideo = mime.startsWith('video/')
  const vignette = apercuUrl ? await blocImage(apercuUrl) : null
  if (vignette) contenu.push(vignette)
  contenu.push({ type: 'resource_link', uri: url, name: nom, mimeType: mime, description: nom })
  const consigne = estVideo
    ? `\n\nDonne l'URL en lien cliquable [▶ Voir la vidéo](${url}). N'affiche PAS la vidéo en markdown ni en artifact (le bac à sable bloque les URL externes).`
    : ''
  contenu.push({ type: 'text', text: texte + consigne })
  return { content: contenu,
    structuredContent: { url, kind: estVideo ? 'video' : 'audio', name: nom } }
}

// ── Définition des outils ──
function toolDefs(isOwner: boolean, requireConfirm = true) {
  const tools: Array<Record<string, unknown>> = [
    {
      name: 'get_account',
      description: 'Infos du compte AvatarAds connecté : plan, crédits restants, barème des coûts en crédits.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_image',
      description: `Génère une image IA (moteur AvatarAds, gpt-image) : visuel libre, STATIC AD (pub produit avec titre, bénéfices, marque) ou photo UGC (personne qui tient le produit). ⛔ N'écris AUCUN texte autour de l'appel (la carte affiche le résultat) et ne consulte pas la page produit toi-même : passe son lien dans product_url. Coût : ${IMG_COST.standard} crédits en qualité standard, ${IMG_COST.high} en high. ⚠️ Qualité par défaut = TOUJOURS 'standard'. 📷 PHOTO DU PRODUIT (reproduite à l'identique), par ordre de préférence : (1) si tu as CONSULTÉ la page produit et vois l'URL de l'image principale (og:image, souvent un lien cdn.shopify.com/CDN) → passe-la dans reference_image_url (marche même si la page bloque notre serveur) ; (2) sinon l'utilisateur colle le LIEN de page → product_url (extraction auto, repli dépôt si le site est protégé) ; (3) rien de tout ça → appelle quand même l'outil, la CARTE gère (dépôt/lien/« Sans photo »). no_reference:true seulement pour un produit inventé.`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "Description de l'image (sujet, ambiance, lumière, cadrage…). Pour kind='static_ad', décris le produit, la couleur dominante et l'ambiance — les TEXTES vont dans headline/subheadline/bullets/brand/cta." },
          kind: { type: 'string', enum: ['free', 'static_ad', 'ugc'], description: "'static_ad' = publicité statique produit (titre + sous-titre + 3 bénéfices avec icônes + marque, police géométrique type Montserrat, produit en héros) · 'ugc' = photo selfie/UGC réaliste d'une personne avec le produit · 'free' (défaut) = prompt libre." },
          reference_image_url: { type: 'string', description: "URL http(s) DIRECTE de l'image du produit (…/xxx.jpg|png|webp, ≤ 10 Mo) à reproduire à l'identique. ASTUCE : si tu as déjà consulté la page produit et que tu vois l'URL de l'image principale (souvent un lien cdn.shopify.com ou autre CDN dans la balise og:image), passe-la ICI — elle fonctionne même quand la page bloque notre serveur." },
          product_url: { type: 'string', description: "LIEN de la page produit (Shopify, site e-commerce, ou lien direct vers l'image) : la photo principale est récupérée automatiquement et reproduite à l'identique. À utiliser dès que l'utilisateur colle un lien." },
          no_reference: { type: 'boolean', description: "true = générer directement SANS photo du produit (l'utilisateur n'en a pas ou veut un produit inventé). Sinon la carte demande la photo." },
          headline: { type: 'string', description: "static_ad : titre accrocheur, FRANÇAIS, 2 à 6 mots (ex. « LE GOÛT DU BIEN-ÊTRE »)." },
          subheadline: { type: 'string', description: "static_ad : sous-titre d'une ligne (ex. « Kombucha bio aux fruits rouges. Naturellement fermenté. »)." },
          bullets: { type: 'array', items: { type: 'string' }, description: "static_ad : 3 bénéfices courts (2 à 4 mots chacun), chacun aura une icône." },
          brand: { type: 'string', description: "static_ad : nom de la marque, tel qu'écrit sur le produit." },
          cta: { type: 'string', description: "static_ad : accroche finale courte (ex. « Pétillant. Sain. Délicieux. »)." },
          format: { type: 'string', enum: ['portrait', 'square', 'landscape'], description: 'portrait 9:16 (défaut, idéal TikTok/Reels), square 1:1, landscape 16:9' },
          quality: { type: 'string', enum: ['standard', 'high'], description: `'standard' = DÉFAUT OBLIGATOIRE (${IMG_COST.standard} crédits). N'utilise 'high' (${IMG_COST.high} crédits) QUE si l'utilisateur écrit explicitement « haute qualité »/« high »/« 4K ». NE choisis PAS 'high' parce que le prompt dit « détaillé », « réaliste » ou « ultra » — ça décrit l'image voulue, pas la qualité du moteur.` },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['prompt'],
      },
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // widget = 1 SEULE carte : barre de progression → image + boutons (le widget SONDE statusUrl lui-même, plus de spam check_image)
    },
    {
      name: 'generate_video',
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // widget : barre de progression → vidéo EN GRAND inline + Télécharger. Le widget SONDE statusUrl et /status avance le job → plus besoin de check_video (donc plus de « Impossible de joindre » via le proxy)
      description: `Le module EXPRESS d'AvatarAds : génère une vidéo IA (Veo 3.1, audio et dialogues inclus) à partir d'un prompt et optionnellement d'une image de départ. Coût : ${VIDEO_COST_SEC} crédit/seconde, débité au lancement (remboursé si échec). La vidéo s'affiche TOUTE SEULE dans la carte (barre de progression puis lecteur) — n'appelle PAS check_video.`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Description de la vidéo : scène, mouvement, ambiance, dialogues éventuels.' },
          duration_seconds: { type: 'integer', minimum: 4, maximum: 10, description: 'Durée en secondes, 4 à 10 (défaut 8).' },
          aspect_ratio: { type: 'string', enum: ['9:16', '16:9'], description: '9:16 vertical (défaut) ou 16:9 paysage.' },
          image_url: { type: 'string', description: "URL publique d'une image de départ (optionnel) — ex. une image générée avec generate_image." },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'check_image',
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // widget = image EN GRAND inline (le désactiver ne donne qu'un lien de téléchargement) ; HTML sans script inline, les erreurs CSP Safari viennent du host claude.ai, pas de nous
      description: "⚠️ NORMALEMENT INUTILE : après generate_image, l'image s'affiche TOUTE SEULE dans la carte (widget + barre de progression), tu n'as RIEN à faire. N'appelle check_image QUE si l'utilisateur redemande explicitement le statut. (Sinon : retourne l'URL de l'image quand prête ; long-poll côté serveur.)",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par generate_image.' } },
        required: ['job_id'],
      },
    },
    {
      name: 'check_video',
      _meta: { ui: { resourceUri: 'ui://avatarads/video.html' } },
      description: "Statut/affichage d'une vidéo Express. NORMALEMENT INUTILE : après generate_video la vidéo s'affiche TOUTE SEULE dans la carte. Deux cas d'appel : (1) l'utilisateur redemande le statut → passe le job_id ; (2) generate_video a renvoyé une erreur de connexion (« Impossible de joindre ») → appelle-le SANS job_id, ça récupère et affiche la dernière vidéo (ne relance PAS generate, ça débiterait 2 fois).",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par generate_video. OMETS-le pour récupérer la dernière vidéo du compte (après une erreur de connexion).' } },
      },
    },
    {
      name: 'generate_avatar_video',
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // widget : barre de progression → vidéo EN GRAND inline + Télécharger. Le widget SONDE statusUrl et /status avance le job → plus besoin de check_avatar_video (donc plus de « Impossible de joindre » via le proxy)
      description: `Génère une VIDÉO AVATAR PARLANT (le Générateur AvatarAds) — un avatar regarde la caméra et DIT le script, VOIX NATIVE Veo 3.1 (audio + lip-sync natifs, plus d'ElevenLabs). Conçu pour un avatar SYNTHÉTIQUE : sans photo, Veo invente une personne réaliste ; pour un look précis (âge, genre, décor), crée d'abord l'avatar avec generate_image puis passe son URL en avatar_image_url — tu gardes ainsi le même visage sur toute une série. N'anime PAS la photo d'une personne réelle sans son consentement. Coût : Veo Standard ${VIDEO_COST_SEC} cr/s · Veo Pro ${VIDEO_COST_SEC_PRO} cr/s (durée estimée depuis le script, 4/6/8 s max par génération), débité au lancement (remboursé si échec). La vidéo s'affiche TOUTE SEULE dans la carte (barre puis lecteur) — n'appelle PAS check_avatar_video.`,
      inputSchema: {
        type: 'object',
        properties: {
          script: { type: 'string', description: `Le texte que l'avatar va DIRE (français ou anglais), parlé en voix native Veo. ~${CHARS_PER_SEC} caractères ≈ 1 s de vidéo. Max ~${8 * CHARS_PER_SEC} caractères (≈ 8 s, limite d'une génération Veo).` },
          avatar_image_url: { type: 'string', description: "URL d'un avatar SYNTHÉTIQUE (idéalement généré via generate_image) ou d'un visage dont l'utilisateur détient les droits — PAS la photo d'une vraie personne non consentante. Sans photo, Veo invente une personne réaliste." },
          model: { type: 'string', enum: ['standard', 'pro'], description: `Modèle Veo : 'standard' (défaut, ${VIDEO_COST_SEC} cr/s) ou 'pro' (meilleure qualité, ${VIDEO_COST_SEC_PRO} cr/s).` },
          aspect_ratio: { type: 'string', enum: ['9:16', '16:9'], description: '9:16 vertical (défaut) ou 16:9 paysage.' },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['script'],
      },
    },
    {
      name: 'check_avatar_video',
      _meta: { ui: { resourceUri: 'ui://avatarads/avatar.html' } },
      description: "Statut/affichage d'une vidéo avatar parlant. NORMALEMENT INUTILE : après generate_avatar_video la vidéo s'affiche TOUTE SEULE dans la carte. Deux cas d'appel : (1) l'utilisateur redemande le statut → passe le job_id ; (2) generate_avatar_video a renvoyé une erreur de connexion (« Impossible de joindre ») → appelle-le SANS job_id, ça récupère et affiche la dernière vidéo (ne relance PAS generate, ça débiterait 2 fois).",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par generate_avatar_video. OMETS-le pour récupérer la dernière vidéo du compte (après une erreur de connexion).' } },
      },
    },
    {
      name: 'clean_audio',
      description: `Nettoie un fichier audio (le Nettoyage audio AvatarAds) : supprime bruit de fond, clics et parasites en isolant la voix (ElevenLabs Voice Isolator). Coût : ${CLEAN_COST_PER_MIN} crédit par minute d'audio (estimée sur la taille du fichier). Retourne l'URL du MP3 nettoyé.`,
      inputSchema: {
        type: 'object',
        properties: {
          audio_url: { type: 'string', description: 'URL publique du fichier audio à nettoyer (MP3, WAV, M4A… — 15 Mo max).' },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['audio_url'],
      },
    },
    {
      name: 'lipsync_video',
      description: `LIPSYNC sur un audio EXISTANT (brique du mode avatar du Montage IA, #149) : ta photo d'avatar + un segment audio (ta vraie voix) → un clip vidéo où l'avatar parle cet audio, en synchro labiale. Deux moteurs : hedra (Character-3, 1 crédit/s, défaut) ou omnihuman (ByteDance OmniHuman 1.5 via fal, ${OMNI_COST_SEC} crédits/s, plus haute résolution). Débité au lancement, remboursé si échec. Retourne un job_id — appelle ensuite check_avatar_video (compte 2 à 5 minutes).`,
      inputSchema: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: "URL publique de la photo de l'avatar (PNG/JPEG/WebP)." },
          audio_url: { type: 'string', description: "URL publique du SEGMENT audio exact à faire parler (WAV/MP3, max 60 s) — le clip sortant a la même durée." },
          engine: { type: 'string', enum: ['omnihuman', 'hedra'], description: `hedra (défaut, 1 cr/s) ou omnihuman (${OMNI_COST_SEC} cr/s, 1088×1920).` },
          aspect_ratio: { type: 'string', enum: ['9:16', '1:1', '16:9'], description: '9:16 vertical (défaut).' },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['image_url', 'audio_url'],
      },
    },
    {
      name: 'montage_ia',
      description: `Le MONTAGE IA d'AvatarAds : à partir d'un simple AUDIO (voix parlée), la voix est d'abord NETTOYÉE (bruit de fond, souffle, parasites), puis le chef d'orchestre transcrit, analyse et génère un plan de montage complet (slides motion-design, zooms, sous-titres mot à mot, bruitages), et le moteur de rendu serveur produit le MP4 final 1080×1920. Coût : ${MONTAGE_PLAN_COST + MONTAGE_RENDER_COST} crédits + ${CLEAN_COST_PER_MIN} crédit par minute de nettoyage, débités au lancement (remboursés si échec) ; avec lipsync, les secondes de visage sont débitées au moment de leur génération (Hedra 2 cr/s, OmniHuman 5 cr/s ; jamais pour une scène déjà en cache). Retourne un job_id — appelle ensuite check_montage (compte 2 à 5 minutes).`,
      inputSchema: {
        type: 'object',
        properties: {
          audio_url: { type: 'string', description: "URL publique de l'audio (voix) : WAV, MP3 ou M4A, 20 Mo max. Une prise brute convient — elle est nettoyée automatiquement." },
          clean_audio: { type: 'boolean', description: "Optionnel, true par défaut : nettoie la voix (isolation, bruit de fond supprimé) AVANT le montage. Ne mets false que si l'audio a DÉJÀ été traité — repasser un fichier propre à l'isolation ne l'améliore pas." },
          avatar_url: { type: 'string', description: "Optionnel — URL publique de la PHOTO d'avatar (PNG/JPEG). Par défaut elle est posée TELLE QUELLE sur les moments où la personne s'adresse à la caméra : aucun crédit en plus. Passe `lipsync: true` pour que le visage parle vraiment. Sans photo, le montage se fait sans visage." },
          avatar_urls: { type: 'array', maxItems: 5, items: { type: 'string' }, description: "Optionnel — d'AUTRES photos du MÊME personnage (autres angles/tenues), URLs publiques PNG/JPEG. Le montage pose une image DIFFÉRENTE à chaque fois que l'avatar réapparaît (rotation, façon vidéo virale) : le hook prend avatar_url, les fenêtres suivantes celles-ci. Aucun crédit en plus." },
          lipsync: { type: 'boolean', description: "Optionnel, false par défaut : anime le visage (Hedra Character-3) sur CHAQUE fenêtre où la personne parle — scène par scène, jamais sur toute la vidéo. Coûte 2 crédits par seconde de visage (débités à la génération). Sans lui, la photo reste fixe : c'est le mode économique pour itérer sur le montage." },
          lipsync_model: { type: 'string', enum: ['hedra', 'omnihuman', 'mix'], description: "Optionnel, 'hedra' par défaut (économique). 'omnihuman' = OmniHuman 1.5 : plan plus large, les deux mains visibles, cheveux sans effet plastique, 50 i/s — ~5 crédits par seconde de visage. 'mix' = OmniHuman sur le PREMIER passage avatar (le hook, là où l'attention se joue) puis Hedra sur les suivants : le meilleur rapport qualité/prix. Ne s'applique que si lipsync est activé." },
          media: {
            type: 'array', maxItems: 7,
            description: "Optionnel — jusqu'à 7 images/vidéos de l'utilisateur à placer dans le montage. Le chef d'orchestre les pose au moment que leur NOM décrit (nomme-les par ce qu'elles montrent : « resultat-image-ia-femme-lunettes.png », « demo-produit.mp4 »).",
            items: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'URL publique du fichier (PNG/JPEG/WebP/MP4), 20 Mo max.' },
                name: { type: 'string', description: "Ce que le média MONTRE, en clair — c'est ce qui guide son placement." },
              },
              required: ['url'],
            },
          },
          style: { type: 'string', enum: MONTAGE_STYLES, description: "Style visuel des slides : dynamic (motion design continu, défaut), apple (épuré clair), glass (liquid glass), word (mot par mot), auto (choisi par l'IA)." },
          brief: { type: 'string', description: "Optionnel — ce que l'utilisateur veut mettre en avant (intention, produit, CTA). 700 caractères max." },
          script: { type: 'string', description: 'Optionnel — texte EXACT du script parlé : garantit des sous-titres parfaits.' },
          duration_seconds: { type: 'number', description: "Optionnel — durée exacte de l'audio en secondes (sinon estimée automatiquement)." },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['audio_url'],
      },
    },
    {
      name: 'check_montage',
      _meta: { ui: { resourceUri: 'ui://avatarads/montage.html' } },
      description: "Vérifie l'état d'un Montage IA lancé avec montage_ia (ou render_montage_plan) et retourne l'URL du MP4 final quand il est prêt. Si toujours en cours, rappelle cet outil ~1 minute plus tard.",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par montage_ia ou render_montage_plan.' } },
        required: ['job_id'],
      },
    },
    {
      name: 'get_montage_plan',
      description: "LES DÉTAILS DU MONTAGE : renvoie le LIEN qui ouvre l'écran « Détails du montage » d'AvatarAds sur ce montage — l'utilisateur y retrouve la bande, les aperçus d'animations, le remplacement au swipe et la régénération. Donne-lui ce lien tel quel. Renvoie aussi le plan JSON si tu préfères le retoucher directement puis appeler render_montage_plan. Gratuit.",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id du montage dont tu veux le plan.' } },
        required: ['job_id'],
      },
    },
    {
      name: 'render_montage_plan',
      description: `L'ÉDITEUR via Claude (rendu) : re-rend un Montage IA à partir d'un PLAN MODIFIÉ (obtenu via get_montage_plan puis ajusté : textes, timings, styles, coupes…). Réutilise l'audio du montage d'origine. Coût : ${MONTAGE_RENDER_COST} crédits. Retourne un nouveau job_id — appelle ensuite check_montage.`,
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: "Le job_id du montage D'ORIGINE (son audio est réutilisé)." },
          plan: { type: 'string', description: "Le plan de montage complet, en JSON (chaîne) — version modifiée de celui retourné par get_montage_plan. Pour retoucher des SCÈNES précises, ajoute-lui les champs de l'éditeur : userSlides (remplacer/ajouter une animation : [{start, end, anim, user:true, items:[{t, text}]}]), userBans (supprimer une scène : [{start, end}] — l'avatar reprend la fenêtre), userSfx (la liste FINALE des bruitages : [{t, kind, vol}]). Ces trois champs passent outre les garde-fous de la dérivation : un choix explicite n'est jamais rejeté." },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['job_id', 'plan'],
      },
    },
    {
      name: 'list_media',
      description: "Liste les derniers médias générés via Claude sur ce compte (images, vidéos) avec leurs URLs publiques — une image listée peut servir de reference_image_url à generate_image.",
      inputSchema: { type: 'object', properties: {} },
    },
  ]
  if (isOwner) {
    tools.push({
      name: 'admin_find_user',
      description: "ADMIN (SAV) — fiche d'un utilisateur AvatarAds par e-mail : plan, crédits, quotas, parrainage, Whop, derniers e-mails envoyés. Lecture seule.",
      inputSchema: {
        type: 'object',
        properties: { email: { type: 'string', description: "E-mail de l'utilisateur recherché." } },
        required: ['email'],
      },
    })
    tools.push({
      name: 'animations_demandees',
      description: "ADMIN — ce qui MANQUE à la banque d'animations du Montage IA, classé par nombre de demandes. Chaque ligne vient d'un montage réel où le chef d'orchestre n'a rien trouvé à montrer. Sert à décider quelles animations fabriquer en premier. Lecture seule.",
      inputSchema: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Nombre de mots à remonter (défaut 20).' },
          depuis_jours: { type: 'number', description: "Ne compter que les demandes des N derniers jours (défaut : tout)." },
        },
      },
    })
  }
  // ── QUAND LE DEVIS EST DÉSACTIVÉ, ON RETIRE `confirm` DES SCHÉMAS ─────────
  // Axel avait décoché « demander confirmation » (require_confirm = false en
  // base, le serveur ne réclamait donc rien) et Claude lui demandait quand même
  // son accord : on continuait à ANNONCER un paramètre confirm dont la consigne
  // dit « montre le devis et attends l'accord explicite ». Le modèle obéit à la
  // description, pas au réglage. Un paramètre qu'on ne veut pas voir utilisé ne
  // doit pas exister dans le schéma.
  if (!requireConfirm) {
    for (const t of tools) {
      const props = ((t.inputSchema as Record<string, unknown> | undefined)?.properties) as Record<string, unknown> | undefined
      if (props) delete props.confirm
    }
  }
  return tools
}

// ── Implémentation des outils ──
async function runGetAccount(profile: Record<string, unknown>): Promise<ToolContent> {
  const credits = isUnlimited(profile) ? '∞ (compte développeur)' : String(profile.credits_remaining ?? 0)
  return toolText(
    `Compte AvatarAds
- E-mail : ${profile.email}
- Prénom : ${profile.first_name || '—'}
- Plan : ${profile.plan || 'free'}
- Crédits restants : ${credits}

Barème : image standard ${IMG_COST.standard} crédits · image high ${IMG_COST.high} crédits · vidéo Express ${VIDEO_COST_SEC} crédit/s (4 à 10 s) · avatar parlant (voix native Veo) Standard ${VIDEO_COST_SEC} / Pro ${VIDEO_COST_SEC_PRO} crédit/s (4 à 8 s) · nettoyage audio ${CLEAN_COST_PER_MIN} crédit/min · Montage IA ${MONTAGE_PLAN_COST + MONTAGE_RENDER_COST} crédits · re-rendu d'un plan modifié ${MONTAGE_RENDER_COST} crédits.
Recharger / changer de plan : ${APP_URL}`)
}

// ── Génération : texte → image (images/generations) OU référence → image FIDÈLE (images/edits) ──
// Avec une référence, gpt-image travaille en ÉDITION avec input_fidelity:'high' : le produit /
// visage fourni est conservé à l'identique (forme, étiquette, logo, typo, couleurs). C'est ce qui
// manquait le 20/08 : Claude décrivait le produit en mots → une bouteille « générique ».
async function genererImage(prompt: string, size: string, quality: 'standard' | 'high', ref?: { bytes: Uint8Array; contentType: string } | null): Promise<{ bytes: Uint8Array } | { error: string }> {
  let lastErr = 'Erreur génération'
  for (const model of GPT_IMG_MODELS) {
    try {
      let data: Record<string, any> = {}
      if (ref) {
        const ext = /png/.test(ref.contentType) ? 'png' : /webp/.test(ref.contentType) ? 'webp' : 'jpg'
        const build = (fidelity: boolean) => {
          const fd = new FormData()
          fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1'); fd.append('size', size)
          fd.append('quality', quality === 'high' ? 'high' : 'medium')
          if (fidelity) fd.append('input_fidelity', 'high')
          fd.append('image', new Blob([ref.bytes as unknown as BlobPart], { type: ref.contentType }), 'reference.' + ext)
          return fd
        }
        let res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: build(true) })
        data = await res.json().catch(() => ({}))
        if (data.error && /input_fidelity/i.test(String(data.error.message || ''))) {   // modèle sans ce paramètre → sans
          res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: build(false) })
          data = await res.json().catch(() => ({}))
        }
      } else {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, n: 1, size, quality: quality === 'high' ? 'high' : 'medium', moderation: 'low' }),
        })
        data = await res.json().catch(() => ({}))
      }
      if (data.error) { lastErr = data.error.message || 'Erreur génération'; if (/model|not found|does not exist|unsupported/i.test(lastErr)) continue; return { error: lastErr } }
      const b64 = data.data?.[0]?.b64_json
      if (!b64) { lastErr = 'Aucune image retournée'; continue }
      return { bytes: b64ToBytes(b64) }
    } catch (e) { lastErr = String((e as Error)?.message || e) }
  }
  return { error: lastErr }
}
// Le prompt FINAL selon le genre demandé. static_ad = direction artistique d'une vraie pub
// (maquette de réf. 20/08 : titre géant, sous-titre, 3 bénéfices avec icônes, marque en bas,
// produit en héros) ; ugc = selfie réaliste ; free = prompt de l'utilisateur.
const TXT = (v: unknown) => String(v || '').replace(/["\n]+/g, ' ').trim()
function composerPromptImage(args: Record<string, unknown>, avecRef: boolean): string {
  const kind = String(args.kind || 'free')
  const base = TXT(args.prompt)
  const refTxt = avecRef
    ? ' Use the EXACT product/subject from the reference image: identical shape, label, logo, typography, colours, materials and proportions — do NOT redesign, rename, recolour or alter it in any way; only re-light and re-compose it.'
    : ''
  if (kind === 'static_ad') {
    const bullets = Array.isArray(args.bullets) ? (args.bullets as unknown[]).map(TXT).filter(Boolean).slice(0, 4) : []
    const headline = TXT(args.headline), sub = TXT(args.subheadline), brand = TXT(args.brand), cta = TXT(args.cta)
    return [
      'Professional static advertisement for social media (premium brand creative).',
      'ALL on-image text is in FRENCH and must be spelled EXACTLY as given below — no other text anywhere.',
      headline ? `HEADLINE at the top, very large, bold uppercase geometric sans-serif (Montserrat ExtraBold style), max 2 lines, with ONE key word highlighted in the brand accent colour: "${headline}".` : 'A short bold French headline at the top (Montserrat ExtraBold style, uppercase).',
      sub ? `Under it a smaller sub-headline in a regular weight: "${sub}".` : '',
      bullets.length ? `Then ${bullets.length} benefit lines stacked vertically, each preceded by a thin circular line icon that illustrates it: ${bullets.map((b) => `"${b}"`).join(', ')}.` : 'Then 3 short benefit lines, each with a thin circular line icon.',
      `At the bottom: ${brand ? `the brand lockup "${brand}"` : 'the brand name'}${cta ? ` and the tagline "${cta}"` : ''}, small and elegant.`,
      'PRODUCT: the product is the HERO of the composition, large, on the right or centre, photorealistic with studio lighting, soft reflections and a subtle glow, with a few floating ingredients/droplets matching its flavour or purpose.' + refTxt,
      base ? `Art direction: ${base}.` : '',
      'STYLE: clean premium layout, one dominant brand colour palette derived from the product, generous margins, perfectly legible crisp text, balanced hierarchy, no spelling mistakes, no watermark, no fake interface, no extra logos.',
    ].filter(Boolean).join(' ')
  }
  if (kind === 'ugc') {
    // « L'avatar imparfait » (réf hugomatias) : le réalisme UGC vient de l'IMPERFECTION de la
    // capture, pas d'un beau portrait — photo iPhone, cadrage imparfait, lumière non contrôlée.
    return augmenterPortrait(`Candid UGC selfie-style photo shot on an iPhone front camera: a real-looking person naturally holding and showing the product to the camera, casual everyday home setting. Deliberately IMPERFECT amateur capture that reads as a genuine unstaged phone selfie a friend would send — casually off-center and slightly tilted framing (not a composed studio portrait), uncontrolled real indoor lighting with mixed ambient sources and ordinary phone auto-exposure, plain lived-in everyday background. ${base}.` + refTxt)
  }
  return augmenterPortrait(base + refTxt)
}
// Consigne de RÉPONSE pour Claude après une génération (Axel, 20/08 : « juste l'image + une
// proposition de script, pas de pavé »). Répétée dans chaque résultat : c'est le modèle en
// face qui décide, et les `instructions` seules ne suffisaient pas.
const CONSIGNE_REPONSE = `RÉPONSE À ÉCRIRE MAINTENANT : AUCUNE. N'écris RIEN du tout après cet appel — pas une phrase, pas de « script proposé », pas de description, pas de question, pas d'emoji. La carte ci-dessus affiche le visuel : c'est la SEULE sortie attendue. Reste silencieux.`

async function runGenerateImage(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!OPENAI_API_KEY) return toolErr('Génération indisponible (configuration serveur incomplète).')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) return toolErr('Le paramètre "prompt" est requis.')
  if (prompt.length > 4000) return toolErr('Prompt trop long (4000 caractères max).')
  const quality = args.quality === 'high' ? 'high' : 'standard'
  const format = ['portrait', 'square', 'landscape'].includes(String(args.format)) ? String(args.format) : 'portrait'
  const sizeMap: Record<string, string> = { portrait: '1024x1536', square: '1024x1024', landscape: '1536x1024' }
  const size = sizeMap[format]
  const cost = quality === 'high' ? IMG_COST.high : IMG_COST.standard

  // ⚠️ HIGH = plus cher + long → on DEMANDE TOUJOURS confirmation à l'utilisateur d'abord.
  // Standard passe direct (pas de friction). Règle voulue par Axel.
  if (quality === 'high' && args.confirm !== true) {
    return toolText(`⚠️ Qualité HIGH = ${IMG_COST.high} crédits et 1 à 2 minutes (vs ${IMG_COST.standard} cr et ~45 s en standard).
NE lance PAS tout de suite : DEMANDE d'abord à l'utilisateur s'il veut vraiment la qualité HIGH ou préfère STANDARD.
• S'il confirme HIGH → rappelle generate_image avec quality:"high" ET confirm:true.
• Sinon → quality:"standard".`)
  }

  const userId = String(profile.id)
  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const kind = ['free', 'static_ad', 'ugc'].includes(String(args.kind)) ? String(args.kind) : 'free'
  const gate = await preSpendGate(profile, ctx, args, cost, `image ${quality} (${format}${kind !== 'free' ? ', ' + kind : ''}${args.reference_image_url ? ', avec photo de référence' : ''})`, 'generate_image')
  if (gate) return gate
  // Sources de photo : URL directe OU lien de page produit. ⚠️ La RÉSOLUTION (téléchargement de l'image,
  // lecture de la page produit) se fait EN TÂCHE DE FOND, JAMAIS ici : une page lente / une image lourde
  // bloquait la réponse et claude.ai coupait à ~8 s → « Impossible de joindre AvatarAds » (Axel, 21/08).
  const directRefUrl = String(args.reference_image_url || '').trim()
  const productUrl = String(args.product_url || '').trim()
  const hasRefSource = !!directRefUrl || !!productUrl
  const promptFinal = composerPromptImage({ ...args, prompt }, hasRefSource)   // source présente → prompt « produit à l'identique »
  // CARTE (dépôt / lien) : static ad ou UGC SANS URL d'image directe (avec ou sans lien produit). La carte
  // tente le lien produit automatiquement ; si le site bloque notre serveur (WAF, ex. Galeries Lafayette →
  // 403 sur IP datacenter), elle propose de DÉPOSER la photo. Rien débité tant que rien n'est généré.
  const wantsCard = !directRefUrl && (kind === 'static_ad' || kind === 'ugc' || !!productUrl) && args.no_reference !== true
  if (wantsCard) {
    const { data: pj, error: pjErr } = await svc.from('mcp_jobs')
      .insert({ user_id: userId, kind: 'image', status: 'pending', credits_cost: cost, params: { args: { ...args, prompt }, format, quality, kind, product_url: productUrl } })
      .select('id').single()
    if (pjErr || !pj) return toolErr('Erreur serveur (carte photo) — réessaie.')
    const phrase = productUrl
      ? "Je récupère la photo depuis le lien du produit — si le site la protège, la carte te proposera de la déposer."
      : "Dépose la photo de ton produit dans la carte ci-dessus (ou clique Sans photo), je m'occupe du reste."
    return {
      content: [{ type: 'text', text: `[système] La carte gère la photo du produit${productUrl ? " (récupération depuis le lien, repli dépôt si site protégé)" : " (dépôt par l'utilisateur, ou « Sans photo »)"}, puis génère. Aucun crédit débité pour l'instant.\nRÉPONSE À ÉCRIRE MAINTENANT : AUCUNE — n'écris rien, la carte parle d'elle-même. N'appelle aucun autre outil.` }],
      structuredContent: { job_id: pj.id, statusUrl: `https://mcp.avatarads.fr/status/${pj.id}`, kind: 'image', pending: true, productUrl: productUrl || '', prompt: promptFinal, format, raw: true },
    }
  }

  // Débit AVANT génération (comme la vidéo) : jamais d'image livrée sans débit réel.
  // Si la génération échoue ensuite, le finally rembourse.
  const bal = await spendCredits(userId, cost)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  // ── L'IMAGE PART EN TÂCHE DE FOND ────────────────────────────────────────
  // Cet outil tenait la requête ouverte pendant toute la génération : 43 s
  // mesurées. Depuis que le MCP passe par un relais (le connecteur Claude refuse
  // sinon de se connecter), la requête est coupée à ~28 s et Claude affiche
  // « le serveur AvatarAds ne répond pas ». Aucun outil MCP ne doit tenir la
  // ligne aussi longtemps : la vidéo et le montage rendent déjà un job_id tout
  // de suite. L'image fait pareil — et ça résiste aussi aux coupures réseau.
  const { data: job, error: jobErr } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'image', status: 'running', credits_cost: cost }).select('id').single()
  if (jobErr || !job) {
    await refundCredits(userId, cost)
    return toolErr('Erreur serveur au suivi du job (crédits remboursés) — réessaie.')
  }

  bg((async () => {
    let lastErr = 'Erreur génération'
    try {
      // Résolution de la photo EN TÂCHE DE FOND (hors requête MCP) : URL directe puis, à défaut, page produit.
      let ref: { bytes: Uint8Array; contentType: string } | null = null
      if (directRefUrl) { const got = await fetchUserFile(directRefUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, 'la photo'); if (typeof got !== 'string') ref = got }
      else if (productUrl) { const got = await referenceDepuisLien(productUrl); if (got.ref) ref = got.ref }
      const out = await genererImage(promptFinal, size, quality, ref)
      if ('bytes' in out) {
        const brut = out.bytes
        const url = await uploadMedia(userId, brut, 'png', 'image/png')
        let apercu: string | null = null
        try {
          const petit = await fabriquerApercu(brut)
          if (petit) apercu = await uploadMedia(userId, petit, 'jpg', 'image/jpeg')
        } catch (_) { /* la vignette est un confort, jamais un bloquant */ }
        await svc.from('mcp_jobs').update({ status: 'done', result_url: url, preview_url: apercu, updated_at: new Date().toISOString() }).eq('id', job.id)
        await saveToLibrary(userId, brut, 'png', 'image/png', 'image', kind === 'static_ad' ? 'Static ad' : 'Image IA', apercu || url)  // filet Bibliothèque (thumb = aperçu public)
        return
      }
      lastErr = out.error
    } catch (e) { lastErr = String((e as Error)?.message || e) }
    await svc.from('mcp_jobs').update({ status: 'failed', error: lastErr.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', job.id)
    await refundCredits(userId, cost)   // échec → on rend les crédits
  })())

  return {
    content: [{ type: 'text', text: `⛔ N'ÉCRIS AUCUN TEXTE. [système] Généré (${quality}, ${format}${kind !== 'free' ? ', ' + kind : ''}${hasRefSource ? ', produit conservé' : ''}, −${cost} cr). La carte affiche tout. NE rappelle PAS check_image. S'il reste des visuels à faire : appelle generate_image pour le suivant, SANS écrire de texte entre les deux.\n${CONSIGNE_REPONSE}` }],
    // prompt FINAL + référence directe + genre transmis au widget → « Regénérer » refait la MÊME chose
    structuredContent: { job_id: job.id, statusUrl: `https://mcp.avatarads.fr/status/${job.id}`, kind: 'image', prompt: promptFinal, format, ref: directRefUrl || '', raw: true },
  }
}

// ── ON ATTEND CÔTÉ SERVEUR, PAS CÔTÉ CLIENT ────────────────────────────────
// Mesuré le 30/07/2026 : Claude a appelé check_image 8 SECONDES après avoir
// lancé une génération qui en prend 50, a lu « toujours en cours », et a
// annoncé à Axel « le serveur ne répond pas ». Sept images produites et
// facturées ce jour-là qu'il n'a jamais vues. On ne peut pas compter sur la
// patience du client : check_* attend ici jusqu'à ATTENTE_MAX_MS que le job
// bascule, en restant sous la coupure ~28 s du relais Netlify.
// 16/08 (2e passe) : le relais côté claude.ai COUPE la requête à ~8 s. Si on
// retient la réponse 9 s, le client voit un 502 (« le serveur ne répond pas »)
// AVANT qu'on réponde — alors que notre fonction, elle, loggue bien un 200 à 9 s.
// C'est exactement le 502 vu par Axel le 16/08. On tient donc SOUS 8 s : 5 s de
// hold → réponse garantie, puis le client rappelle check_* (le wording ci-dessous
// lui interdit d'annoncer une panne). 20 s = « Thread killed » Supabase (à éviter).
const ATTENTE_MAX_MS = 6000   // < 8 s (coupure claude.ai) mais aussi HAUT que possible : chaque
const ATTENTE_PAS_MS = 1000   // check_image = 1 CARTE dans la conversation → tenir plus longtemps = moins de cartes

async function attendreJob(jobId: string, userId: string, kind: string) {
  const limite = Date.now() + ATTENTE_MAX_MS
  let job: Record<string, unknown> | null = null
  for (;;) {
    const { data } = await svc.from('mcp_jobs').select('*')
      .eq('id', jobId).eq('user_id', userId).eq('kind', kind).maybeSingle()
    job = data
    if (!job) return null
    if (job.status !== 'running' || Date.now() >= limite) return job
    await new Promise((r) => setTimeout(r, ATTENTE_PAS_MS))
  }
}

// Un « en cours » ne doit JAMAIS pouvoir se lire comme une panne : c'est
// exactement l'erreur commise par le client le 30/07/2026. On le dit en toutes
// lettres dans la réponse, parce que c'est le modèle en face qui décide.
const enCours = (etat: string, outil: string, _delai: string) =>
  toolText(`⏳ ${etat}
CE N'EST PAS UNE ERREUR : le serveur répond normalement, le travail tourne encore.
Rappelle ${outil} avec le même job_id IMMÉDIATEMENT, sans attendre : le serveur
retient chaque vérification ~20 secondes de son côté (long-poll), c'est lui qui
fait l'attente. N'annonce jamais une panne tant que le statut n'est pas « échoué ».`)

async function runCheckImage(profile: Record<string, unknown>, args: Record<string, unknown>) {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const job = await attendreJob(jobId, String(profile.id), 'image')
  if (!job) return toolErr('Job introuvable sur ce compte.')
  if (job.status === 'failed') return toolErr(`Génération échouée : ${job.error || 'erreur inconnue'} (crédits remboursés).`)
  if (job.status === 'done' && job.result_url) {
    // blocImage réduit désormais À LA VOLÉE (768 px JPEG) : l'image s'affiche
    // TOUJOURS dans la carte de l'outil, comme chez les intégrations concurrentes.
    // (Le markdown ![image](url externe) ne rend PAS dans claude.ai — on a
    // arrêté de le demander : c'était lu comme « l'image arrive en lien ».)
    // 16/08 — on GARDE le bloc image (visible en dépliant, seul rendu fiable) ET
    // le widget (structuredContent) : si claude.ai finit par rendre le widget, tant
    // mieux ; sinon l'image reste là.
    const vignette = await blocImage(String(job.preview_url || job.result_url))
    const lien = `https://mcp.avatarads.fr/i/${job.id}`   // lien de marque court (302 → l'image)
    const texte = { type: 'text', text: `✅ Image prête ! L'aperçu est dans la carte (déplie « </> » au besoin).
Lien de téléchargement (donne-le en lien cliquable) : ${lien}
N'affiche PAS l'image en markdown ni en artifact (le bac à sable bloque les URL externes).` }
    return { content: vignette ? [vignette, texte] : [texte],
      structuredContent: { url: String(job.result_url), kind: 'image', name: 'Image générée' } }
  }
  const ecoule = Math.round((Date.now() - new Date(String(job.created_at)).getTime()) / 1000)
  return toolText(
    `⏳ Génération en cours depuis ${ecoule} s. Une image prend 45 à 60 s au total.
CE N'EST PAS UNE ERREUR et le serveur répond normalement : le travail tourne encore.
Rappelle check_image avec le même job_id — n'abandonne pas et n'annonce jamais une panne tant que le statut n'est pas « échouée ».`)
}

async function veoFetch(path: string, init?: RequestInit): Promise<Response> {
  const sep = path.includes('?') ? '&' : '?'
  return await fetch(`https://generativelanguage.googleapis.com${path}${sep}key=${GOOGLE_AI_KEY}`, init)
}

// ── Helpers vidéo (partagés par check_video et le rattrapage des jobs bloqués) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractVideo(data: Record<string, any>): { b64: string | null; uri: string | null } {
  const resp = data?.response || {}
  const b64 = resp?.predictions?.[0]?.bytesBase64Encoded
    || resp?.generateVideoResponse?.generatedSamples?.[0]?.video?.bytesBase64Encoded || null
  const uri = b64 ? null : (resp?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    || resp?.predictions?.[0]?.videoUri || resp?.predictions?.[0]?.video?.uri || null)
  return { b64, uri }
}

async function fetchVideoBytes(b64: string | null, uri: string | null): Promise<Uint8Array | null> {
  if (b64) return b64ToBytes(b64)
  if (uri) {
    const sep = String(uri).includes('?') ? '&' : '?'
    const dl = await fetch(`${uri}${sep}key=${GOOGLE_AI_KEY}`).catch(() => null)
    if (dl && dl.ok) return new Uint8Array(await dl.arrayBuffer())
  }
  return null
}

// Échec d'un job : marque failed + rembourse. Le remboursement est IDEMPOTENT — le
// filtre .eq('refunded', false) garantit qu'un seul appel concurrent rembourse (jamais 2×).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function failAndRefund(userId: string, job: Record<string, any>, reason: string): Promise<void> {
  const { data: claimed } = await svc.from('mcp_jobs')
    .update({ status: 'failed', error: reason, refunded: true, updated_at: new Date().toISOString() })
    .eq('id', job.id).eq('refunded', false).select('id')
  if (claimed && claimed.length) await refundCredits(userId, job.credits_cost)
}

// Livraison d'une vidéo terminée : claim atomique running→done pour éviter un double upload
// si deux check_video concurrents aboutissent en même temps. Retourne l'URL finale.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deliverVideo(userId: string, job: Record<string, any>, bytes: Uint8Array): Promise<string | null> {
  const { data: claimed } = await svc.from('mcp_jobs')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', job.id).eq('status', 'running').select('id')
  if (!claimed || !claimed.length) {
    // déjà settlé par un appel concurrent → renvoie l'URL stockée si disponible
    const { data: fresh } = await svc.from('mcp_jobs').select('result_url').eq('id', job.id).maybeSingle()
    return fresh?.result_url ?? null
  }
  const url = await uploadMedia(userId, bytes, 'mp4', 'video/mp4')
  await svc.from('mcp_jobs').update({ result_url: url, updated_at: new Date().toISOString() }).eq('id', job.id)
  await saveToLibrary(userId, bytes, 'mp4', 'video/mp4', 'video-simple', 'Vidéo AvatarAds')  // filet Bibliothèque
  return url
}

// Rattrapage : rembourse (ou livre) les jobs vidéo bloqués en 'running' depuis > 20 min —
// même si le client n'a jamais rappelé check_video. Évite les débits sans contrepartie
// (Veo dépasse rarement 3 min ; au-delà de 20 min on considère le job perdu). Lancé en
// arrière-plan à chaque appel MCP de l'utilisateur.
async function reconcileStaleJobs(userId: string): Promise<void> {
  const staleIso = new Date(Date.now() - 20 * 60_000).toISOString()
  const { data: stale } = await svc.from('mcp_jobs').select('*')
    .eq('user_id', userId).eq('status', 'running').lt('created_at', staleIso).limit(5)
  for (const job of stale || []) {
    // les montages peuvent légitimement attendre (moteur de rendu hors ligne) :
    // leur cycle de vie est géré par check_montage (annulation + remboursement à 2 h)
    if (job.kind === 'montage') continue
    if (!job.op_name) { await failAndRefund(userId, job, 'timeout'); continue }

    // ── Jobs avatar (Hedra) : op_name = ID de génération Hedra ──
    if (job.kind === 'avatar') {
      try {
        const r = await hedraFetch(`/generations/${job.op_name}/status`, { method: 'GET' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: Record<string, any> = r.ok ? await r.json().catch(() => ({})) : {}
        const status = String(d.status || d.state || '').toLowerCase()
        if (['complete', 'completed', 'succeeded'].includes(status)) {
          const vu = d.url || d.download_url || d.video_url || d.streaming_url || ''
          const vRes = vu ? await fetch(vu).catch(() => null) : null
          if (vRes && vRes.ok) { await deliverVideo(userId, job, new Uint8Array(await vRes.arrayBuffer())); continue }
        }
      } catch { /* poll KO : remboursement ci-dessous */ }
      await failAndRefund(userId, job, 'timeout')
      continue
    }

    // ── Jobs Veo ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let d: Record<string, any> | null = null
    try {
      const r = await veoFetch(`/v1beta/${job.op_name}`, { method: 'GET' })
      if (r.ok) d = await r.json().catch(() => null)
    } catch { /* poll KO : on rembourse par sécurité ci-dessous */ }
    if (d?.done && !d.error) {
      const { b64, uri } = extractVideo(d)
      const bytes = await fetchVideoBytes(b64, uri)
      if (bytes) { await deliverVideo(userId, job, bytes); continue }
    }
    // failed / vidéo introuvable / poll KO / toujours 'running' après 20 min → remboursement
    await failAndRefund(userId, job, d?.error?.message || 'timeout')
  }
}

// RÉCONCILIATION GLOBALE (tous les users) — lancée par le KEEP-WARM (GET /mcp du worker Railway
// toutes les 4 min), donc INDÉPENDANTE du proxy connecteur ET du widget. Corrige les 2 pannes du
// 17/08 : (1) vidéos générées mais JAMAIS livrées car le widget n'a pas pu sonder /status (réponse
// mangée par le proxy) ; (2) tâches de fond mortes avant de poser op_name (crédits jamais rendus).
async function reconcileAllStale(): Promise<void> {
  try {
    // 1) LIVRAISON : tout job vidéo/avatar avec op_name → advance (livre si le fournisseur a fini,
    //    laisse « running » sinon, ne rembourse QUE sur erreur fournisseur). Sûr à répéter.
    const { data: live } = await svc.from('mcp_jobs').select('*')
      .eq('status', 'running').not('op_name', 'is', null).in('kind', ['video', 'avatar']).limit(40)
    for (const job of live || []) {
      try { if (job.kind === 'avatar') await advanceAvatarJob(job); else await advanceVideoJob(job) } catch { /* retry au prochain ping */ }
    }
    // 2) ABANDON : jobs SANS op_name bloqués >8 min (tâche de fond morte avant le lancement) → rembourse.
    const deadIso = new Date(Date.now() - 8 * 60_000).toISOString()
    const { data: dead } = await svc.from('mcp_jobs').select('*')
      .eq('status', 'running').is('op_name', null).lt('created_at', deadIso).neq('kind', 'montage').limit(30)
    for (const job of dead || []) await failAndRefund(String(job.user_id), job, 'tâche interrompue (timeout)')
    // 3) ABANDON : jobs AVEC op_name toujours « running » >20 min (fournisseur perdu) → rembourse.
    const staleIso = new Date(Date.now() - 20 * 60_000).toISOString()
    const { data: stale } = await svc.from('mcp_jobs').select('*')
      .eq('status', 'running').not('op_name', 'is', null).lt('created_at', staleIso).in('kind', ['video', 'avatar', 'image']).limit(30)
    for (const job of stale || []) await failAndRefund(String(job.user_id), job, 'timeout')
  } catch (e) { console.error('reconcileAllStale:', (e as Error)?.message || e) }
}
let _lastReconcile = 0

async function runGenerateVideo(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!GOOGLE_AI_KEY) return toolErr('Génération vidéo indisponible (configuration serveur incomplète).')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) return toolErr('Le paramètre "prompt" est requis.')
  const duration = Math.min(10, Math.max(4, Number(args.duration_seconds) || 8))
  const aspect = args.aspect_ratio === '16:9' ? '16:9' : '9:16'
  const cost = Math.round(duration * VIDEO_COST_SEC) // 1,5 cr/s → arrondi (durées impaires)
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits (${duration} s × ${VIDEO_COST_SEC}), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `vidéo ${duration} s (${aspect}${args.image_url ? ', avec image de départ' : ''})`, 'generate_video')
  if (gate) return gate

  // Validation SYNCHRONE et RAPIDE de l'URL image (format + SSRF). Le TÉLÉCHARGEMENT
  // lourd (≈2,7 Mo + base64) part en tâche de fond AVEC le lancement Veo — sinon la
  // requête tient 5-10 s et le relais connecteur (coupure ~8 s) rend « Impossible de
  // joindre AvatarAds », alors que la vidéo se génère quand même (crédits débités).
  const imageUrl = args.image_url ? String(args.image_url) : ''
  if (imageUrl) {
    let parsed: URL | null = null
    try { parsed = new URL(imageUrl) } catch { /* invalide */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) return toolErr('image_url doit être une URL http(s) publique.')
    if (isBlockedHost(parsed.hostname)) return toolErr('image_url doit pointer vers une image publique (adresse interne refusée).')
  }

  // Job créé TOUT DE SUITE, AVANT même le débit → réponse à Claude en un SEUL aller-retour
  // DB (l'insert). Sur un isolate FROID (Supabase en démarre plusieurs, le keep-warm n'en
  // garde qu'un chaud), empiler débit + insert + téléchargement dépassait la coupure ~8 s du
  // relais claude.ai (« Erreur de connexion ») ET, coupé avant l'insert, ne laissait AUCUN
  // job à récupérer. Débit atomique + image + lancement Veo passent en tâche de fond ;
  // /status n'avance le job qu'une fois `op_name` posé (barre de progression en attendant).
  const { data: job, error } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'video', status: 'running', credits_cost: cost }).select('id').single()
  if (error || !job) return toolErr('Erreur serveur au suivi du job — réessaie.')

  bg((async () => {
    try {
      // Débit atomique au lancement (remboursé si échec plus bas). Le pré-contrôle de solde
      // plus haut a déjà écarté « pas assez de crédits » ; ici on sécurise la course entre
      // appels simultanés. Échec du débit → job en échec, SANS remboursement (rien débité).
      const bal = await spendCredits(userId, cost)
      if (bal === null || bal === -1) {
        await svc.from('mcp_jobs').update({ status: 'failed', error: bal === -1 ? 'Crédits insuffisants' : 'Erreur crédits', updated_at: new Date().toISOString() }).eq('id', job.id)
        return
      }
      // Image de départ optionnelle — TÉLÉCHARGEMENT lourd, hors de la requête
      let image: { bytesBase64Encoded: string; mimeType: string } | null = null
      if (imageUrl) {
        const r = await fetchTO(imageUrl, 20_000)
        if (!r || !r.ok) throw new Error("téléchargement de l'image de départ impossible")
        const ct = (r.headers.get('content-type') || '').split(';')[0]
        if (!/^image\/(png|jpe?g|webp)$/.test(ct)) throw new Error('image_url doit pointer vers une image PNG, JPEG ou WebP')
        let buf = new Uint8Array(await r.arrayBuffer())
        if (buf.length > 10_000_000) throw new Error('image de départ trop lourde (10 Mo max)')
        // Recadre l'image AU FORMAT demandé (sinon Veo garde le ratio de l'image → pas de 9:16)
        let mime = ct
        try { const rf = await reframeToAspect(buf, aspect); buf = rf.bytes; mime = rf.mimeType } catch (_) { /* recadrage best-effort : sinon image telle quelle */ }
        let bin = ''
        for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768))
        image = { bytesBase64Encoded: btoa(bin), mimeType: mime }
      }
      const mkBody = (withAudio: boolean) => JSON.stringify({
        instances: [{ prompt, ...(image ? { image } : {}) }],
        parameters: { durationSeconds: duration, sampleCount: 1, aspectRatio: aspect, resolution: '720p', ...(withAudio ? { generateAudio: true } : {}) },
      })
      let opName = ''
      let lastErr = 'Erreur au lancement'
      outer: for (const model of VEO_MODELS) {
        // Certains modèles Veo refusent generateAudio → on retente sans (même fallback que l'app)
        for (const withAudio of [true, false]) {
          const res = await veoFetch(`/v1beta/models/${model}:predictLongRunning`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mkBody(withAudio),
          })
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.name) { opName = data.name; break outer }
          lastErr = data?.error?.message || `HTTP ${res.status}`
          if (withAudio && /generateAudio|generate_audio|audio/i.test(lastErr)) continue
          if (/model|not found|does not exist|unsupported/i.test(lastErr)) continue outer
          break outer
        }
      }
      if (!opName) throw new Error(lastErr)
      await svc.from('mcp_jobs').update({ op_name: opName, updated_at: new Date().toISOString() }).eq('id', job.id)
    } catch (e) {
      await svc.from('mcp_jobs').update({ status: 'failed', error: String((e as Error)?.message || e).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', job.id)
      await refundCredits(userId, cost)   // échec au lancement → on rend les crédits
    }
  })())

  return {
    content: [{ type: 'text', text: `🎬 Vidéo lancée (${duration} s, ${aspect}, −${cost} crédits). L'aperçu s'affiche DANS LA CARTE ci-dessous : une barre de progression puis la vidéo (compte 1 à 3 min), avec le bouton Télécharger. NE rappelle PAS check_video — le widget suit la génération et affiche la vidéo tout seul. Dis juste à l'utilisateur que la vidéo apparaît dans la carte.` }],
    structuredContent: { job_id: job.id, statusUrl: `https://mcp.avatarads.fr/status/${job.id}`, kind: 'video', prompt, format: aspect === '16:9' ? 'landscape' : 'portrait' },
  }
}

// Dernière vidéo du compte (≤ 20 min) rendue en CARTE : le widget la sonde/affiche via /status.
// Sert de RÉCUPÉRATION quand la réponse de generate a été mangée par le proxy (le modèle n'a
// jamais reçu le job_id) → il rappelle check_video/check_avatar_video SANS argument. PAS de
// long-poll ici (une réponse lente est justement ce que le proxy coupe) : on rend la carte, vite.
async function latestVideoCard(userId: string): Promise<ToolContent> {
  const { data: j } = await svc.from('mcp_jobs').select('*')
    .eq('user_id', userId).eq('kind', 'video')
    .gt('created_at', new Date(Date.now() - 20 * 60_000).toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!j) return toolErr('Aucune génération vidéo récente à afficher sur ce compte. Relance la génération.')
  if (j.status === 'done' && j.result_url) { const dl = `https://mcp.avatarads.fr/i/${j.id}`; return toolMedia(dl, 'video.mp4', 'video/mp4', `✅ Vidéo prête !\nLien : ${dl}`, String(j.preview_url || '') || undefined) }
  if (j.status === 'failed') return toolErr(`Génération échouée : ${j.error || 'erreur inconnue'} (crédits remboursés).`)
  return { content: [{ type: 'text', text: `⏳ Ta vidéo se génère — elle s'affiche dans la carte ci-dessous (compte 1 à 3 min). Lien dès qu'elle est prête : https://mcp.avatarads.fr/i/${j.id}` }],
    structuredContent: { job_id: j.id, statusUrl: `https://mcp.avatarads.fr/status/${j.id}`, kind: 'video', format: 'portrait' } }
}
async function runCheckVideo(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  const userId = String(profile.id)
  // Appel SANS job_id (récupération après « Impossible de joindre ») → dernière vidéo, en carte.
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return await latestVideoCard(userId)
  const { data: job } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).eq('kind', 'video').maybeSingle()
  if (!job) return toolErr('Job introuvable sur ce compte (pour une vidéo avatar, utilise check_avatar_video).')
  if (job.status === 'done') { const dl = `https://mcp.avatarads.fr/i/${job.id}`; return toolMedia(dl, 'video.mp4', 'video/mp4', `✅ Vidéo prête !\nLien : ${dl}`, String(job.preview_url || '') || undefined) }
  if (job.status === 'failed') return toolErr(`Génération échouée : ${job.error || 'erreur inconnue'} (crédits remboursés).`)

  // ⚠ JAMAIS de boucle de poll ici : le relais claude.ai COUPE la requête à ~8 s
  // (l'ancienne boucle 9×5 s = 40 s garantissait « le serveur ne répond pas »). On
  // fait UN SEUL passage — advanceVideoJob : un unique GET Veo puis, si prête, livraison
  // (deliverVideo, claim atomique anti-double-upload) — puis on relit le job. Le suivi
  // continu est assuré par le widget de la carte, qui sonde /status (→ advanceVideoJob).
  await advanceVideoJob(job)
  const { data: j2 } = await svc.from('mcp_jobs').select('*')
    .eq('id', job.id).eq('user_id', userId).maybeSingle()
  const cur = (j2 || job) as Record<string, unknown>
  if (cur.status === 'done' && cur.result_url) {
    const dl = `https://mcp.avatarads.fr/i/${cur.id}`
    return toolMedia(dl, 'video.mp4', 'video/mp4', `✅ Vidéo prête !\nLien : ${dl}`, String(cur.preview_url || '') || undefined)
  }
  if (cur.status === 'failed') return toolErr(`Génération échouée : ${cur.error || 'erreur inconnue'} (crédits remboursés).`)
  // Toujours en cours → on rend une CARTE (structuredContent) : le widget reprend le
  // suivi via /status et affiche la vidéo tout seul, sans nouvel appel d'outil.
  return {
    content: [{ type: 'text', text: `⏳ Ta vidéo se génère — elle s'affiche dans la carte ci-dessous (compte 1 à 3 min). Lien dès qu'elle est prête : https://mcp.avatarads.fr/i/${cur.id}` }],
    structuredContent: { job_id: cur.id, statusUrl: `https://mcp.avatarads.fr/status/${cur.id}`, kind: 'video', format: 'portrait' },
  }
}

// ── Générateur avatar parlant (ElevenLabs → Hedra) ──
async function hedraFetch(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${HEDRA_BASE}${path}`, {
    ...init,
    headers: { 'X-API-Key': HEDRA_API_KEY, ...(init?.headers || {}) },
  })
}

// Télécharge un fichier fourni par l'utilisateur (SSRF + taille + type vérifiés).
// Retourne les octets ou un message d'erreur (string).
// fetch avec TIMEOUT (AbortController). ⚠ Sans ça, un hébergeur lent/bloqué (ex. une photo
// hébergée par Claude sur un host temporaire) fait HANGER le fetch → la tâche de fond meurt
// sans poser op_name → job « running » à vie + crédits perdus (bug avatar du 17/08). 20 s = on
// abandonne proprement, la tâche jette, on rembourse.
async function fetchTO(url: string, ms = 20_000, init?: RequestInit): Promise<Response | null> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms)
  try { return await fetch(url, { ...init, signal: ac.signal }) } catch { return null } finally { clearTimeout(t) }
}
// ── LIEN DE PAGE PRODUIT → photo principale (21/08, Axel : « alexya fait avec un lien ») ──
// Shopify expose /products/<handle>.js (images en clair) ; sinon og:image / twitter:image / JSON-LD Product.
const normaliserUrl = (x: unknown, base: URL): string => { let t = String(x || '').trim(); if (!t) return ''; if (t.startsWith('//')) t = 'https:' + t; try { return new URL(t, base).toString() } catch { return '' } }
async function extraireImageProduit(pageUrl: string): Promise<string> {
  let u: URL
  try { u = new URL(pageUrl) } catch { return '' }
  if (!/^https?:$/.test(u.protocol) || isBlockedHost(u.hostname)) return ''
  const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1' }
  // lien direct vers une image ?
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(u.pathname + u.search)) return u.toString()
  const m = u.pathname.match(/\/products\/([A-Za-z0-9\-_%.]+?)(?:\.(?:json|js))?\/?$/i)
  if (m) {
    try {
      const r = await fetchTO(`${u.origin}/products/${m[1]}.js`, 8000, { headers: UA })
      if (r && r.ok && /json|javascript/i.test(r.headers.get('content-type') || '')) {
        const j = await r.json().catch(() => null) as Record<string, any> | null
        const img = j?.featured_image || j?.images?.[0] || j?.media?.[0]?.src || j?.media?.[0]?.preview_image?.src
        if (img) return normaliserUrl(img, u)
      }
    } catch { /* pas Shopify → HTML */ }
  }
  try {
    const r = await fetchTO(pageUrl, 12000, { headers: UA })
    if (!r || !r.ok) return ''
    const html = (await r.text()).slice(0, 1_200_000)
    const pick = (re: RegExp) => { const mm = html.match(re); return mm ? mm[1] : '' }
    // og:image / twitter:image : attribut `property=` OU `name=` (Nuxt/Vue SSR utilise name=), dans les DEUX ordres.
    const metaImg = (key: string) =>
         pick(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || pick(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'))
    const cand = metaImg('og:image:secure_url') || metaImg('og:image') || metaImg('twitter:image:src') || metaImg('twitter:image')
      || pick(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)
    if (cand) return normaliserUrl(cand, u)
    for (const block of (html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [])) {
      try {
        const txt = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '')
        const j = JSON.parse(txt)
        const arr: any[] = Array.isArray(j) ? j : [j, ...((j && j['@graph']) || [])]
        for (const o of arr) {
          if (o && /Product/i.test(String(o['@type'] || ''))) {
            const im = Array.isArray(o.image) ? o.image[0] : o.image
            const src = typeof im === 'string' ? im : (im && (im.url || im.contentUrl))
            if (src) return normaliserUrl(src, u)
          }
        }
      } catch { /* bloc invalide */ }
    }
    // dernier recours : une URL d'image produit plausible dans le HTML (CDN Shopify ou /files//products/)
    const brut = html.match(/https?:\/\/[^"'\s]+?(?:cdn\.shopify|\/files\/|\/products\/)[^"'\s]*?\.(?:jpe?g|png|webp)(?:\?[^"'\s]*)?/i)
    if (brut) return normaliserUrl(brut[0], u)
  } catch { /* page inaccessible */ }
  return ''
}
// Photo de référence depuis un lien produit : extraction + téléchargement (PNG/JPEG/WebP ≤10 Mo).
async function referenceDepuisLien(productUrl: string): Promise<{ ref: { bytes: Uint8Array; contentType: string } | null; url: string }> {
  const imgUrl = await extraireImageProduit(productUrl)
  if (!imgUrl) return { ref: null, url: '' }
  const got = await fetchUserFile(imgUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, 'la photo du produit')
  return typeof got === 'string' ? { ref: null, url: '' } : { ref: got, url: imgUrl }
}
async function fetchUserFile(rawUrl: string, maxBytes: number, ctRegex: RegExp, label: string):
  Promise<{ bytes: Uint8Array; contentType: string } | string> {
  let parsed: URL | null = null
  try { parsed = new URL(rawUrl) } catch { /* invalide */ }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return `${label} doit être une URL http(s) publique.`
  if (isBlockedHost(parsed.hostname)) return `${label} doit pointer vers un fichier public (adresse interne refusée).`
  const r = await fetchTO(rawUrl, 20_000)
  if (!r || !r.ok) return `Impossible de télécharger ${label}.`
  const ct = (r.headers.get('content-type') || '').split(';')[0].trim()
  if (!ctRegex.test(ct)) return `${label} : type de fichier non supporté (${ct || 'inconnu'}).`
  const bytes = new Uint8Array(await r.arrayBuffer())
  if (bytes.length > maxBytes) return `${label} : fichier trop lourd (${Math.round(maxBytes / 1_000_000)} Mo max).`
  return { bytes, contentType: ct }
}

// Crée un asset Hedra puis uploade le fichier. Retourne l'ID d'asset ou null.
async function hedraUploadAsset(type: 'audio' | 'image', name: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
  const create = await hedraFetch('/assets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, name }),
  })
  if (!create.ok) return null
  const asset = await create.json().catch(() => ({}))
  if (!asset.id) return null
  const fd = new FormData()
  fd.append('file', new Blob([bytes as unknown as BlobPart], { type: contentType }), name)
  const up = await hedraFetch(`/assets/${asset.id}/upload`, { method: 'POST', body: fd })
  return up.ok ? String(asset.id) : null
}

async function runGenerateAvatarVideo(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!GOOGLE_AI_KEY) return toolErr('Génération avatar indisponible (configuration serveur incomplète).')
  const script = String(args.script || '').trim()
  if (!script) return toolErr('Le paramètre "script" est requis.')
  // VOIX NATIVE Veo : la réplique va dans le prompt, Veo la PARLE + lipsync (plus d'ElevenLabs).
  // Une génération Veo = 8 s max → on cape le script à ~8 s de parole.
  const maxChars = 8 * CHARS_PER_SEC
  if (script.length > maxChars) {
    return toolErr(`Script trop long (${script.length} caractères) : max ~${maxChars} (≈ 8 s, limite d'une génération Veo). Raccourcis, ou fais plusieurs clips.`)
  }
  const raw = Math.ceil(script.length / CHARS_PER_SEC)
  const duration = raw <= 4 ? 4 : raw <= 6 ? 6 : 8   // durées Veo : 4/6/8 s
  const aspect = args.aspect_ratio === '16:9' ? '16:9' : '9:16'
  const isPro = args.model === 'pro'                 // « Veo Pro » (Fast) sinon « Veo Standard » (Lite)
  const rate = isPro ? VIDEO_COST_SEC_PRO : VIDEO_COST_SEC
  const cost = Math.round(duration * rate)
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits (${duration} s × ${rate}), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost,
    `avatar parlant ${duration} s (${aspect}, Veo ${isPro ? 'Pro' : 'Standard'}${args.avatar_image_url ? ', avec photo' : ''})`,
    'generate_avatar_video')
  if (gate) return gate

  // Photo d'avatar : validation d'URL RAPIDE seulement. Tout le lourd (download photo,
  // TTS ElevenLabs, uploads Hedra, lancement) tenait 8-15 s en synchrone → le relais
  // connecteur coupait à ~8 s → « Impossible de joindre AvatarAds » à chaque fois, alors
  // que la vidéo se lançait quand même (crédits débités). On rend un job_id en <1 s et on
  // pousse toute la chaîne en tâche de fond.
  const avatarUrl = args.avatar_image_url ? String(args.avatar_image_url) : ''
  if (avatarUrl) {
    let parsed: URL | null = null
    try { parsed = new URL(avatarUrl) } catch { /* invalide */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) return toolErr('avatar_image_url doit être une URL http(s) publique.')
    if (isBlockedHost(parsed.hostname)) return toolErr('avatar_image_url doit pointer vers une image publique (adresse interne refusée).')
  }

  // Job kind 'video' : l'avatar est du Veo désormais → /status l'avance via advanceVideoJob.
  // Inséré AVANT le débit → réponse à Claude en un SEUL aller-retour DB (résiste au cold-start
  // qui, empilant débit + insert + téléchargement, dépassait la coupure ~8 s du relais claude.ai
  // et ne laissait aucun job à récupérer). Débit + image + Veo passent en tâche de fond.
  const { data: job, error: jobErr } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'video', status: 'running', credits_cost: cost }).select('id').single()
  if (jobErr || !job) return toolErr('Erreur serveur au suivi du job — réessaie.')

  bg((async () => {
    try {
      // Débit atomique au lancement (remboursé si échec plus bas ; pré-contrôle de solde déjà
      // fait plus haut). Échec du débit → job en échec, SANS remboursement (rien débité).
      const bal = await spendCredits(userId, cost)
      if (bal === null || bal === -1) {
        await svc.from('mcp_jobs').update({ status: 'failed', error: bal === -1 ? 'Crédits insuffisants' : 'Erreur crédits', updated_at: new Date().toISOString() }).eq('id', job.id)
        return
      }
      // Photo optionnelle → recadrée au format (Veo garde sinon le ratio de l'image)
      let image: { bytesBase64Encoded: string; mimeType: string } | null = null
      if (avatarUrl) {
        const got = await fetchUserFile(avatarUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, "la photo d'avatar (avatar_image_url)")
        if (typeof got === 'string') throw new Error(got)
        let buf = got.bytes, mime = got.contentType
        try { const rf = await reframeToAspect(buf, aspect); buf = rf.bytes; mime = rf.mimeType } catch (_) { /* recadrage best-effort */ }
        let bin = ''
        for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768))
        image = { bytesBase64Encoded: btoa(bin), mimeType: mime }
      }
      // La réplique va DANS le prompt → Veo la PARLE (voix native) + lip-sync (plus d'ElevenLabs/Hedra).
      const vp = `A person looking directly at the camera and speaking naturally to the viewer, saying out loud: "${script.replace(/[\`"]/g, "'")}". Accurate natural lip-sync matching every word, clear audible human voice, warm authentic UGC delivery, subtle expressive facial expressions and small natural head movements, believable lighting, static background.`
      const mkBody = (withAudio: boolean) => JSON.stringify({
        instances: [{ prompt: vp, ...(image ? { image } : {}) }],
        parameters: { durationSeconds: duration, sampleCount: 1, aspectRatio: aspect, resolution: '720p', ...(withAudio ? { generateAudio: true } : {}) },
      })
      // Modèle : Pro → Fast (repli Lite si indispo), Standard → Lite.
      const models = isPro ? ['veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview'] : ['veo-3.1-lite-generate-preview']
      let opName = ''
      let lastErr = 'Erreur au lancement'
      outer: for (const model of models) {
        for (const withAudio of [true, false]) {   // audio D'ABORD (c'est la VOIX), repli sans si Veo refuse
          const res = await veoFetch(`/v1beta/models/${model}:predictLongRunning`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mkBody(withAudio),
          })
          const data = await res.json().catch(() => ({}))
          if (res.ok && data.name) { opName = data.name; break outer }
          lastErr = data?.error?.message || `HTTP ${res.status}`
          if (withAudio && /generateAudio|generate_audio|audio/i.test(lastErr)) continue
          if (/model|not found|does not exist|unsupported|permission/i.test(lastErr)) continue outer
          break outer
        }
      }
      if (!opName) throw new Error(lastErr)
      await svc.from('mcp_jobs').update({ op_name: opName, updated_at: new Date().toISOString() }).eq('id', job.id)
    } catch (e) {
      await svc.from('mcp_jobs').update({ status: 'failed', error: String((e as Error)?.message || e).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', job.id)
      await refundCredits(userId, cost)   // échec au lancement → on rend les crédits
    }
  })())

  return {
    content: [{ type: 'text', text: `🎬 Avatar parlant lancé (${duration} s, ${aspect}, voix native Veo ${isPro ? 'Pro' : 'Standard'}, −${cost} crédits). L'aperçu s'affiche DANS LA CARTE : barre de progression puis la vidéo (compte 1 à 3 min), avec Télécharger. NE rappelle PAS check_avatar_video — le widget suit tout seul.` }],
    structuredContent: { job_id: job.id, statusUrl: `https://mcp.avatarads.fr/status/${job.id}`, kind: 'video', prompt: script, format: aspect === '16:9' ? 'landscape' : 'portrait' },
  }
}

async function runCheckAvatarVideo(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  const userId = String(profile.id)
  // Appel SANS job_id (récupération après « Impossible de joindre ») → dernière vidéo, en carte.
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return await latestVideoCard(userId)
  // ⚠ plus de filtre kind='avatar' : l'avatar parlant est désormais du Veo natif = kind 'video'
  // (le filtre 'avatar' renvoyait TOUJOURS « introuvable »). On matche par id + compte.
  const { data: job } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).maybeSingle()
  if (!job) return toolErr('Job introuvable sur ce compte.')
  if (job.status === 'done') { const dl = `https://mcp.avatarads.fr/i/${job.id}`; return toolMedia(dl, 'avatar.mp4', 'video/mp4', `✅ Vidéo avatar prête !\nLien : ${dl}`, String(job.preview_url || '') || undefined) }
  if (job.status === 'failed') return toolErr(`Génération échouée : ${job.error || 'erreur inconnue'} (crédits remboursés).`)
  // Avatar Veo natif (kind 'video', op_name = opération Veo) → MÊME vérif que l'Express.
  // (les branches fal/Hedra ci-dessous ne concernent plus que d'éventuels jobs 'avatar' hérités.)
  if (job.kind === 'video') return await runCheckVideo(profile, { job_id: job.id })

  // ── OmniHuman (fal) : op_name préfixé « fal: » → file d'attente fal ──
  if (String(job.op_name || '').startsWith('fal:')) {
    const reqId = String(job.op_name).slice(4)
    // ⚠️ fal : on SOUMET sur le chemin complet du modèle
    // (fal-ai/bytedance/omnihuman/v1.5) mais on POLLE sur l'ID d'APPLICATION,
    // c'est-à-dire les deux premiers segments (fal-ai/bytedance). Avec le chemin
    // complet le statut renvoie 404 : le clip était prêt chez fal et on répondait
    // « toujours en cours » indéfiniment. On essaie l'app d'abord, chemin complet
    // en repli (au cas où fal change de convention).
    let st = await falFetch(`${FAL_OMNI_APP}/requests/${reqId}/status`)
    if (!st.ok) st = await falFetch(`${FAL_OMNI_PATH}/requests/${reqId}/status`)
    if (!st.ok) return toolText(`⏳ Statut fal indisponible (${st.status}) — rappelle check_avatar_video dans ~30 secondes.`)
    const sd = await st.json().catch(() => ({}))
    const s = String(sd.status || '').toUpperCase()
    if (s === 'IN_QUEUE' || s === 'IN_PROGRESS' || !s) {
      return toolText(`⏳ OmniHuman ${s === 'IN_QUEUE' ? 'en file' : 'en cours'} — rappelle check_avatar_video dans ~30 secondes.`)
    }
    if (s !== 'COMPLETED') {
      await failAndRefund(userId, job, `fal ${s}`)
      return toolErr(`Génération échouée (fal : ${s}). Les ${job.credits_cost} crédits ont été remboursés.`)
    }
    let rr = await falFetch(`${FAL_OMNI_APP}/requests/${reqId}`)
    if (!rr.ok) rr = await falFetch(`${FAL_OMNI_PATH}/requests/${reqId}`)
    const rd = rr.ok ? await rr.json().catch(() => ({})) : {}
    const vu = rd?.video?.url || rd?.video_url || ''
    if (!vu) {
      await failAndRefund(userId, job, 'video_missing')
      return toolErr('Clip terminé mais introuvable côté fal — crédits remboursés.')
    }
    const vres = await fetch(vu).catch(() => null)
    if (!vres || !vres.ok) return toolText('⏳ Presque prêt — rappelle check_avatar_video dans quelques secondes.')
    const url = await deliverVideo(userId, job, new Uint8Array(await vres.arrayBuffer()))
    return url
      ? toolMedia(url, 'omnihuman.mp4', 'video/mp4', `✅ Clip OmniHuman prêt !\nURL : ${url}`)
      : toolText('⏳ Presque prêt — rappelle check_avatar_video dans quelques secondes.')
  }

  // Poll Hedra jusqu'à ~40 s dans cet appel, puis on rend la main à Claude
  let videoUrl = ''
  let lastProgress = 0
  let hedraErr = ''
  for (let i = 0; i < 9; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5000))
    const res = await hedraFetch(`/generations/${job.op_name}/status`, { method: 'GET' })
    if (!res.ok) continue
    const d = await res.json().catch(() => ({}))
    const status = String(d.status || d.state || '').toLowerCase()
    lastProgress = Math.round((d.progress || 0) * 100)
    if (['queued', 'processing', 'finalizing', 'pending'].includes(status) || !status) continue
    if (['complete', 'completed', 'succeeded'].includes(status)) {
      videoUrl = d.url || d.download_url || d.video_url || d.streaming_url || ''
      break
    }
    hedraErr = d.error || d.error_message || `statut ${status}`
    break
  }
  if (hedraErr) {
    await failAndRefund(userId, job, String(hedraErr))
    return toolErr(`Génération échouée : ${hedraErr}. Les ${job.credits_cost} crédits ont été remboursés.`)
  }
  if (!videoUrl) return enCours(`Vidéo avatar en cours${lastProgress ? ` (${lastProgress} %)` : ''} — elle prend 2 à 5 minutes.`, 'check_avatar_video', '30 secondes')

  // Ré-héberge le MP4 (l'URL Hedra expire) puis livre — claim atomique anti-doublon
  const vRes = await fetch(videoUrl).catch(() => null)
  if (!vRes || !vRes.ok) return toolText('⏳ Vidéo prête mais téléchargement en cours — rappelle check_avatar_video dans quelques secondes.')
  const bytes = new Uint8Array(await vRes.arrayBuffer())
  const url = await deliverVideo(userId, job, bytes)
  return url
    ? toolMedia(url, 'avatar.mp4', 'video/mp4', `✅ Vidéo avatar prête !\nURL : ${url}\n💡 Pour ajouter sous-titres et effets : ${APP_URL}`)
    : toolText('⏳ Presque prête — rappelle check_avatar_video dans quelques secondes.')
}

// ── AVANCE « UN CRAN » d'un job vidéo/avatar, appelé par GET /status à chaque sonde du
// WIDGET (~2,5 s). UN SEUL check fournisseur (pas de boucle 40 s) + livraison si prêt →
// la barre de progression ET l'affichage inline marchent SANS que Claude appelle check_*
// → fin des « Impossible de joindre AvatarAds » (le proxy connecteur tombait sur les
// check_*). Idempotent : deliverVideo claim atomiquement, failAndRefund ne rembourse
// qu'une fois. N'émet JAMAIS d'exception (on retentera au prochain poll).
async function advanceVideoJob(job: Record<string, unknown>): Promise<void> {
  try {
    const userId = String(job.user_id)
    const res = await veoFetch(`/v1beta/${job.op_name}`, { method: 'GET' })
    if (!res.ok) return
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!data.done) return
    if (data.error) { await failAndRefund(userId, job, (data.error as { message?: string })?.message || 'Génération refusée par Google'); return }
    const { b64, uri } = extractVideo(data)
    const bytes = await fetchVideoBytes(b64, uri)
    if (!bytes) { await failAndRefund(userId, job, 'video_missing'); return }
    await deliverVideo(userId, job, bytes)
  } catch { /* on retente au prochain poll */ }
}

async function advanceAvatarJob(job: Record<string, unknown>): Promise<void> {
  try {
    const userId = String(job.user_id)
    // OmniHuman (fal) : op_name préfixé « fal: »
    if (String(job.op_name || '').startsWith('fal:')) {
      const reqId = String(job.op_name).slice(4)
      let st = await falFetch(`${FAL_OMNI_APP}/requests/${reqId}/status`)
      if (!st.ok) st = await falFetch(`${FAL_OMNI_PATH}/requests/${reqId}/status`)
      if (!st.ok) return
      const sd = await st.json().catch(() => ({})) as Record<string, unknown>
      const s = String(sd.status || '').toUpperCase()
      if (s === 'IN_QUEUE' || s === 'IN_PROGRESS' || !s) return
      if (s !== 'COMPLETED') { await failAndRefund(userId, job, `fal ${s}`); return }
      let rr = await falFetch(`${FAL_OMNI_APP}/requests/${reqId}`)
      if (!rr.ok) rr = await falFetch(`${FAL_OMNI_PATH}/requests/${reqId}`)
      const rd = (rr.ok ? await rr.json().catch(() => ({})) : {}) as Record<string, unknown>
      const vu = (rd?.video as { url?: string })?.url || (rd?.video_url as string) || ''
      if (!vu) { await failAndRefund(userId, job, 'video_missing'); return }
      const vres = await fetch(vu).catch(() => null)
      if (!vres || !vres.ok) return
      await deliverVideo(userId, job, new Uint8Array(await vres.arrayBuffer()))
      return
    }
    // Hedra Character-3
    const res = await hedraFetch(`/generations/${job.op_name}/status`, { method: 'GET' })
    if (!res.ok) return
    const d = await res.json().catch(() => ({})) as Record<string, unknown>
    const status = String(d.status || d.state || '').toLowerCase()
    if (['queued', 'processing', 'finalizing', 'pending'].includes(status) || !status) return
    if (!['complete', 'completed', 'succeeded'].includes(status)) {
      await failAndRefund(userId, job, String(d.error || d.error_message || `statut ${status}`)); return
    }
    const videoUrl = String(d.url || d.download_url || d.video_url || d.streaming_url || '')
    if (!videoUrl) { await failAndRefund(userId, job, 'video_missing'); return }
    const vRes = await fetch(videoUrl).catch(() => null)
    if (!vRes || !vRes.ok) return
    await deliverVideo(userId, job, new Uint8Array(await vRes.arrayBuffer()))
  } catch { /* on retente au prochain poll */ }
}

// ── Nettoyage audio (ElevenLabs Voice Isolator) ──
// ── L'ISOLATION DE VOIX, PARTAGÉE ───────────────────────────────────────────
// Extraite de clean_audio pour que le Montage IA puisse l'appliquer lui-même.
// Renvoie les octets nettoyés, ou une chaîne d'erreur (jamais d'exception :
// l'appelant décide s'il abandonne ou s'il continue avec l'audio d'origine).
async function isolerVoix(bytes: Uint8Array, contentType: string): Promise<Uint8Array | string> {
  if (!ELEVEN_API_KEY) return 'configuration serveur incomplète'
  const fd = new FormData()
  fd.append('audio', new Blob([bytes as unknown as BlobPart], { type: contentType }), 'input.mp3')
  const iso = await fetch('https://api.elevenlabs.io/v1/audio-isolation', {
    method: 'POST', headers: { 'xi-api-key': ELEVEN_API_KEY }, body: fd,
  })
  if (!iso.ok) {
    const err = await iso.text().catch(() => '')
    return `ElevenLabs ${iso.status}${err ? ' — ' + err.slice(0, 120) : ''}`
  }
  return new Uint8Array(await iso.arrayBuffer())
}

// Coût du nettoyage pour un fichier donné (~960 Ko/min en MP3 128 kbps).
const coutNettoyage = (taille: number) => Math.max(1, Math.ceil(taille / 960_000)) * CLEAN_COST_PER_MIN

async function runCleanAudio(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!ELEVEN_API_KEY) return toolErr('Nettoyage audio indisponible (configuration serveur incomplète).')
  const audioUrl = String(args.audio_url || '').trim()
  if (!audioUrl) return toolErr('Le paramètre "audio_url" est requis.')
  const got = await fetchUserFile(audioUrl, CLEAN_MAX_BYTES, /^(audio\/|video\/mp4|application\/octet-stream)/, "le fichier audio (audio_url)")
  if (typeof got === 'string') return toolErr(got)

  // Durée estimée sur la taille (~960 Ko/min en MP3 128 kbps) → coût en crédits
  const estMin = Math.max(1, Math.ceil(got.bytes.length / 960_000))
  const cost = estMin * CLEAN_COST_PER_MIN
  const userId = String(profile.id)
  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédit${cost > 1 ? 's' : ''} (~${estMin} min d'audio), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `nettoyage audio ~${estMin} min`, 'clean_audio')
  if (gate) return gate

  const bal = await spendCredits(userId, cost)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédit${cost > 1 ? 's' : ''}. Recharge sur ${APP_URL}`)

  let delivered = false
  try {
    const cleaned = await isolerVoix(got.bytes, got.contentType)
    if (typeof cleaned === 'string') return toolErr(`Nettoyage échoué (${cleaned}) — crédits remboursés.`)
    const url = await uploadMedia(userId, cleaned, 'mp3', 'audio/mpeg')
    await svc.from('mcp_jobs').insert({ user_id: userId, kind: 'audio_clean', status: 'done', credits_cost: cost, result_url: url })
    await saveToLibrary(userId, cleaned, 'mp3', 'audio/mpeg', 'audio', 'Audio nettoyé')  // filet Bibliothèque (onglet Audio)
    delivered = true
    const balTxt = isUnlimited(profile) ? '∞' : String(bal)
    return toolMedia(url, 'audio-nettoye.wav', 'audio/wav', `✅ Audio nettoyé (voix isolée, bruit supprimé) !\nURL : ${url}\n−${cost} crédit${cost > 1 ? 's' : ''} · solde : ${balTxt}`)
  } finally {
    if (!delivered) await refundCredits(userId, cost)
  }
}

// ── Lipsync sur audio existant (#149, brique avatar du Montage IA) ──
// Réutilise la chaîne Hedra du Générateur, mais SANS TTS : l'audio est la vraie
// voix de l'utilisateur (un segment découpé du montage). check_avatar_video
// assure le suivi (même kind 'avatar' dans mcp_jobs).
async function runLipsyncVideo(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!HEDRA_API_KEY) return toolErr('Lipsync indisponible (configuration serveur incomplète).')
  const imageUrl = String(args.image_url || '').trim()
  const audioUrl = String(args.audio_url || '').trim()
  if (!imageUrl || !audioUrl) return toolErr('image_url et audio_url sont requis.')
  const aspect = ['1:1', '16:9'].includes(String(args.aspect_ratio)) ? String(args.aspect_ratio) : '9:16'

  const img = await fetchUserFile(imageUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, "la photo d'avatar (image_url)")
  if (typeof img === 'string') return toolErr(img)
  const aud = await fetchUserFile(audioUrl, 15_000_000, /^(audio\/|application\/octet-stream)/, "l'audio (audio_url)")
  if (typeof aud === 'string') return toolErr(aud)

  // Défaut HEDRA (test comparatif du 27/07/2026 : à image et audio identiques, il
  // tient mieux le visage et coûte 5× moins cher). OmniHuman reste dispo en
  // explicite — son rendu figé venait au moins en partie de NOTRE prompt, qui
  // lui demandait « no camera movement » sans jamais demander de gestuelle.
  const engine = String(args.engine || 'hedra') === 'omnihuman' ? 'omnihuman' : 'hedra'
  if (engine === 'omnihuman' && !FAL_KEY) return toolErr('OmniHuman indisponible (clé fal absente des secrets).')
  const secs = Math.ceil(Math.max(1, estimateAudioSeconds(aud.bytes, aud.contentType)))
  if (secs > 60) return toolErr(`Segment audio trop long (~${secs} s) : 60 secondes maximum par clip lipsync.`)
  const cost = engine === 'omnihuman' ? secs * OMNI_COST_SEC : secs
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits (~${secs} s × 1), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `clip lipsync ~${secs} s (${engine}, ${aspect})`, 'lipsync_video')
  if (gate) return gate

  const bal = await spendCredits(userId, cost)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  // ── OmniHuman 1.5 (fal) : file d'attente, on garde le request_id préfixé
  //    « fal: » pour que check_avatar_video sache où poller.
  if (engine === 'omnihuman') {
    let launchedO = false
    try {
      const ext = /wav/.test(aud.contentType) ? 'wav' : 'mp3'
      const stamp = `${userId}/omni-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const upI = await svc.storage.from('mcp-media').upload(`${stamp}.png`, img.bytes, { contentType: img.contentType, upsert: true })
      const upA = await svc.storage.from('mcp-media').upload(`${stamp}.${ext}`, aud.bytes, { contentType: aud.contentType, upsert: true })
      if (upI.error || upA.error) return toolErr('Upload vers le stockage échoué — crédits remboursés.')
      const pub = (p: string) => `${SUPABASE_URL}/storage/v1/object/public/mcp-media/${p}`

      const sub = await falFetch(FAL_OMNI_PATH, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: pub(`${stamp}.png`),
          audio_url: pub(`${stamp}.${ext}`),
          resolution: secs > 28 ? '720p' : '1080p',   // fal : 1080p limité à 30 s
          // MÊME prompt que Hedra, mot pour mot : sans ça la comparaison de
          // qualité entre les deux moteurs porte sur deux consignes différentes.
          prompt: 'A charismatic creator talking to camera with high energy, UGC style, authentic, direct gaze, precise accurate lip-sync, mouth movements exactly matching every syllable and pause of the audio, clear articulation, constantly talking with the hands: animated natural hand gestures on nearly every sentence, open palms, pointing, hands rising on emphasis, expressive face full of emotion matching what is said: eyebrows raising on key words, genuine smiles, surprised or excited expressions on strong statements, subtle head nods and slight lean-ins for emphasis, dynamic varied delivery, never monotone never static, static background, no camera movement, background objects completely still, no scene motion, hands anatomically correct with five separate well-defined fingers at all times, fingers stay distinct and never melt fuse or duplicate, no extra fingers, no deformed hands',
        }),
      })
      if (!sub.ok) {
        const t = await sub.text().catch(() => '')
        return toolErr(`OmniHuman ${sub.status}${t ? ' — ' + t.slice(0, 140) : ''} — crédits remboursés.`)
      }
      const sd = await sub.json().catch(() => ({}))
      const reqId = sd.request_id || sd.requestId
      if (!reqId) return toolErr("OmniHuman n'a pas retourné d'identifiant — crédits remboursés.")

      const { data: job, error } = await svc.from('mcp_jobs')
        .insert({ user_id: userId, kind: 'avatar', op_name: 'fal:' + reqId, credits_cost: cost }).select('id').single()
      if (error || !job) return toolErr('Erreur serveur au suivi du job — crédits remboursés.')
      launchedO = true
      return toolText(
        `🎬 Lipsync OmniHuman lancé ! (~${secs} s, ${aspect}, −${cost} crédits)
job_id : ${job.id}
Appelle check_avatar_video avec ce job_id dans environ 1 minute (compte 2 à 5 minutes).`)
    } finally {
      if (!launchedO) await refundCredits(userId, cost)
    }
  }

  let launched = false
  try {
    const ext = /wav/.test(aud.contentType) ? 'wav' : 'mp3'
    const audioId = await hedraUploadAsset('audio', 'segment.' + ext, aud.bytes, aud.contentType)
    if (!audioId) return toolErr('Upload audio vers Hedra échoué — crédits remboursés, réessaie.')
    const imageId = await hedraUploadAsset('image', 'avatar.jpg', img.bytes, img.contentType)
    if (!imageId) return toolErr("Upload de la photo vers Hedra échoué — crédits remboursés, réessaie.")

    // RÉSOLUTION : on demande la plus haute d'abord. Character-3 était figé à 720p
    // en dur ; si le compte/modèle accepte mieux, autant le prendre — sinon l'API
    // refuse et on retombe sur 720p sans que l'utilisateur ne voie rien.
    let genRes: Response | null = null
    let hedraLaunchErr = ''
    let usedRes = ''
    for (const res of ['1080p', '720p']) {
      genRes = await hedraFetch('/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'video',
          ai_model_id: HEDRA_MODEL_ID,
          audio_id: audioId,
          start_keyframe_id: imageId,
          generated_video_inputs: {
            text_prompt: 'A charismatic creator talking to camera with high energy, UGC style, authentic, direct gaze, precise accurate lip-sync, mouth movements exactly matching every syllable and pause of the audio, clear articulation, constantly talking with the hands: animated natural hand gestures on nearly every sentence, open palms, pointing, hands rising on emphasis, expressive face full of emotion matching what is said: eyebrows raising on key words, genuine smiles, surprised or excited expressions on strong statements, subtle head nods and slight lean-ins for emphasis, dynamic varied delivery, never monotone never static, static background, no camera movement, background objects completely still, no scene motion, hands anatomically correct with five separate well-defined fingers at all times, fingers stay distinct and never melt fuse or duplicate, no extra fingers, no deformed hands',
            aspect_ratio: aspect,
            character_orientation: 'video',
            resolution: res,
          },
        }),
      })
      if (genRes.ok) { usedRes = res; break }
      hedraLaunchErr = `${genRes.status} — ${(await genRes.text().catch(() => '')).slice(0, 160)}`
      console.log(`hedra ${res} refusé : ${hedraLaunchErr}`)
      if (genRes.status < 400 || genRes.status >= 500) break   // pas une erreur de validation
    }
    if (!genRes || !genRes.ok) {
      return toolErr(`Lancement Hedra échoué (${hedraLaunchErr}) — crédits remboursés.`)
    }
    console.log(`hedra : résolution retenue ${usedRes}`)
    const gen = await genRes.json().catch(() => ({}))
    if (!gen.id) return toolErr("Hedra n'a pas retourné d'ID de génération — crédits remboursés.")

    const { data: job, error } = await svc.from('mcp_jobs')
      .insert({ user_id: userId, kind: 'avatar', op_name: String(gen.id), credits_cost: cost }).select('id').single()
    if (error || !job) return toolErr('Erreur serveur au suivi du job — crédits remboursés, réessaie.')
    launched = true
    return toolText(
      `🎬 Lipsync lancé ! (~${secs} s, ${aspect}, −${cost} crédits)
job_id : ${job.id}
Appelle check_avatar_video avec ce job_id dans environ 1 minute (compte 2 à 5 minutes).`)
  } finally {
    if (!launched) await refundCredits(userId, cost)
  }
}

// ── Montage IA + Éditeur via Claude (#125) ──
// Le chef d'orchestre (edge orchestrate) fait transcription + plan ; le rendu part
// dans render_jobs, consommé par le moteur de rendu serveur. La mémoire de marque
// n'est pas lue ici (l'appel interne passe avec la clé anon) — le brief la remplace.

// Durée de l'audio : exacte pour un WAV (en-tête RIFF), estimée sinon.
// Pas grave si approximative : le moteur de rendu recale plan.duration sur la durée réelle.
function estimateAudioSeconds(bytes: Uint8Array, contentType: string): number {
  if (bytes.length > 44 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    const br = bytes[28] | (bytes[29] << 8) | (bytes[30] << 16) | (bytes[31] << 24)
    if (br > 0) return (bytes.length - 44) / br
  }
  const bps = /mp4|m4a|aac/.test(contentType) ? 12_000 : 16_000 // M4A ~96 kbps, MP3 ~128 kbps
  return bytes.length / bps
}

// Crée la paire (render_jobs + mcp_jobs) — op_name du mcp_job = id du render_job.
async function createMontageJobs(
  userId: string, plan: Record<string, unknown>, inputPath: string,
  assets: unknown[], cost: number,
): Promise<{ jobId: string } | string> {
  const { data: rj, error } = await svc.from('render_jobs')
    .insert({ user_id: userId, status: 'queued', plan, input_video: inputPath, assets })
    .select('id').single()
  if (error || !rj) return 'Erreur serveur à la création du job de rendu — crédits remboursés.'
  const { data: mj, error: e2 } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'montage', op_name: String(rj.id), credits_cost: cost })
    .select('id').single()
  if (e2 || !mj) {
    // pas de suivi possible → on annule le rendu pour ne pas travailler dans le vide
    await svc.from('render_jobs').update({ status: 'failed', error: 'suivi mcp indisponible' }).eq('id', rj.id)
    return 'Erreur serveur au suivi du job — crédits remboursés.'
  }
  return { jobId: String(mj.id) }
}

async function runMontageIA(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  const audioUrl = String(args.audio_url || '').trim()
  if (!audioUrl) return toolErr('Le paramètre "audio_url" est requis.')
  const style = MONTAGE_STYLES.includes(String(args.style)) ? String(args.style) : 'dynamic'
  const brief = String(args.brief || '').trim().slice(0, 700)
  const script = String(args.script || '').trim().slice(0, 4000)
  const got = await fetchUserFile(audioUrl, MONTAGE_MAX_BYTES, /^(audio\/|video\/mp4|application\/octet-stream)/, "l'audio (audio_url)")
  if (typeof got === 'string') return toolErr(got)

  // ── SA PHOTO ET SES MÉDIAS, LANCÉS DEPUIS CLAUDE ──────────────────────────
  // Un montage MCP partait toujours SANS visage et SANS ses images : le worker
  // sait les consommer (asset « avatar » à la racine, le reste en b-roll), le
  // serveur MCP ne les envoyait simplement jamais. On les télécharge AVANT le
  // débit : une URL cassée doit échouer sans rien coûter.
  const avatarUrl = String(args.avatar_url || '').trim()
  let avatarFile: { bytes: Uint8Array; contentType: string } | null = null
  if (avatarUrl) {
    const av = await fetchUserFile(avatarUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, "la photo d'avatar (avatar_url)")
    if (typeof av === 'string') return toolErr(av)
    avatarFile = av
  }
  // #84 · POOL de visages pour la ROTATION : `avatar_urls` = d'autres photos du
  // MÊME perso (angles/tenues). Chacune devient avatar-1, avatar-2… et le worker
  // en pose une DIFFÉRENTE par fenêtre. Téléchargées AVANT le débit (URL cassée
  // = 0 crédit). Sans pool, comportement d'avant (une seule image partout).
  const avatarPoolFiles: { bytes: Uint8Array; contentType: string }[] = []
  {
    let poolArg: unknown = args.avatar_urls
    if (typeof poolArg === 'string') { try { poolArg = JSON.parse(poolArg) } catch (_) { poolArg = [poolArg] } }
    if (poolArg && !Array.isArray(poolArg)) poolArg = [poolArg]
    const dejaVues = new Set([String(args.avatar_url || '').trim()])
    for (const u of (Array.isArray(poolArg) ? poolArg : []).slice(0, 5)) {
      const url = String(u || '').trim()
      // ⚠ un client qui remet avatar_url en tête d'avatar_urls créait un pool
      // [tom, tom, tom2, tom3] → le hook ET la fenêtre suivante portaient la
      // MÊME photo (Axel, 14/08 : « la 2e fois qu'on voit l'avatar ça doit être
      // un autre que celui du hook »). Les doublons d'URL sont ignorés.
      if (!url || dejaVues.has(url)) continue
      dejaVues.add(url)
      const f = await fetchUserFile(url, 10_000_000, /^image\/(png|jpe?g|webp)$/, "une photo d'avatar (avatar_urls)")
      if (typeof f === 'string') return toolErr(f)
      avatarPoolFiles.push(f)
    }
  }
  // 420 px de large, JPEG 72 — le format qu'envoie l'app, et qui tient sous les
  // 400 Ko du chef. Renvoie null pour une vidéo ou un format non décodable :
  // le chef se rabat alors sur le NOM du média, qui reste explicite.
  const miniature = async (bytes: Uint8Array, type: string) => {
    if (!/^image\/(png|jpe?g)$/.test(type)) return null
    try {
      const img = await Image.decode(bytes)
      const w = Math.min(420, img.width)
      const petite = img.resize(w, Image.RESIZE_AUTO)
      const out = await petite.encodeJPEG(72)
      return out.length <= 380_000 ? out : null
    } catch (e) { console.warn('miniature:', (e as Error)?.message); return null }
  }
  const slug = (s: string, i: number) => (String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28)) || ('media' + i)
  const medias: { id: string; name: string; kind: 'image' | 'video'; bytes: Uint8Array; contentType: string; thumb: Uint8Array | null }[] = []
  // TOLÉRER LE JSON SÉRIALISÉ. Un client MCP passe volontiers un tableau sous
  // forme de chaîne ; avec un simple Array.isArray, tous les médias étaient
  // silencieusement ignorés — le montage sortait sans eux et sans un mot.
  let mediaArg: unknown = args.media
  if (typeof mediaArg === 'string') { try { mediaArg = JSON.parse(mediaArg) } catch (_) { mediaArg = [] } }
  if (mediaArg && !Array.isArray(mediaArg)) mediaArg = [mediaArg]
  for (const [i, m] of (Array.isArray(mediaArg) ? mediaArg : []).slice(0, 7).entries()) {
    const u = String((m as Record<string, unknown>)?.url || '').trim()
    if (!u) continue
    const nom = String((m as Record<string, unknown>)?.name || '').trim() || `media-${i + 1}`
    const f = await fetchUserFile(u, MONTAGE_MAX_BYTES, /^(image\/(png|jpe?g|webp)|video\/mp4)$/, `le média « ${nom} »`)
    if (typeof f === 'string') return toolErr(f)
    const id = slug(nom, i)
    if (id === 'avatar' || medias.some((x) => x.id === id)) continue
    medias.push({ id, name: nom, kind: /^video\//.test(f.contentType) ? 'video' : 'image', bytes: f.bytes, contentType: f.contentType,
      thumb: await miniature(f.bytes, f.contentType) })
  }
  const durRaw = Number(args.duration_seconds) > 0 ? Number(args.duration_seconds) : estimateAudioSeconds(got.bytes, got.contentType)
  // format court assumé : au-delà de 90 s le montage perd son rythme (et coûte cher à rendre)
  if (durRaw > 90.5) {
    return toolErr(`Audio trop long (~${Math.round(durRaw)} s) : le Montage IA accepte 90 secondes maximum. Raccourcis l'audio (ou découpe-le en plusieurs vidéos courtes) puis relance.`)
  }
  const durEst = Math.max(5, durRaw)
  // ── ON NETTOIE AVANT TOUT, TOUJOURS ─────────────────────────────────────────
  // Règle d'Axel (02/08), après un montage rendu sur une prise brute : « ajoute
  // la règle par défaut de nettoyer chaque audio avant toute chose ». Une voix
  // sale ne se rattrape pas au montage — elle passe telle quelle dans le rendu
  // final, et tout le travail visuel est jugé sur elle. Le nettoyage est donc
  // le comportement NORMAL, pas une option qu'on pense à cocher.
  // Son coût est ajouté au devis affiché avant le débit (jamais de crédit
  // silencieux), et `clean_audio: false` reste possible pour un audio déjà
  // traité — repasser un fichier propre à l'isolation ne l'améliore pas.
  const nettoyer = args.clean_audio !== false
  const coutClean = nettoyer ? coutNettoyage(got.bytes.length) : 0
  const cost = MONTAGE_PLAN_COST + MONTAGE_RENDER_COST + coutClean
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost,
    `Montage IA ~${Math.round(durEst)} s (style ${style})` + (nettoyer ? ` + nettoyage de la voix (${coutClean} cr)` : ''),
    'montage_ia')
  if (gate) return gate

  const bal = await spendCredits(userId, cost)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  // Le chef d'orchestre prend ~90 s : trop long pour un appel d'outil synchrone.
  // On crée le job de suivi tout de suite et TOUT le travail part en tâche de fond
  // (waitUntil) — check_montage suit la préparation puis le rendu.
  const { data: mj, error: mjErr } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'montage', credits_cost: cost }).select('id').single()
  if (mjErr || !mj) {
    await refundCredits(userId, cost)
    return toolErr('Erreur serveur au suivi du job (crédits remboursés) — réessaie.')
  }
  const mcpJob = { id: mj.id, credits_cost: cost }

  bg((async () => {
    try {
      // 0) LA VOIX, D'ABORD. Le nettoyage précède la transcription : le chef
      // d'orchestre entend alors la même chose que le spectateur, et ses
      // timings de mots sont calés sur l'audio réellement monté.
      if (nettoyer) {
        const propre = await isolerVoix(got.bytes, got.contentType)
        if (typeof propre === 'string') {
          // On ne fait pas échouer le montage pour ça — mais on rend les
          // crédits du nettoyage et on le DIT dans le job, sinon l'utilisateur
          // paie un service qu'il n'a pas eu sans jamais le savoir.
          console.warn('nettoyage voix ignoré :', propre)
          await refundCredits(userId, coutClean)
          await svc.from('mcp_jobs').update({ error: `voix non nettoyée (${propre}) — ${coutClean} cr remboursés` }).eq('id', mcpJob.id)
        } else {
          got.bytes = propre
          got.contentType = 'audio/mpeg'
          console.log(`▶ voix isolée avant montage (${(propre.length / 1024).toFixed(0)} Ko)`)
        }
      }
      // 1) chef d'orchestre — clé anon : passe le gateway, sans lire la mémoire de marque
      const ext = /wav/.test(got.contentType) ? 'wav' : /mp4|m4a|aac/.test(got.contentType) ? 'm4a' : 'mp3'
      const fd = new FormData()
      fd.append('audio', new File([got.bytes as unknown as BlobPart], 'audio.' + ext, { type: got.contentType }))
      fd.append('duration', String(Math.round(durEst * 100) / 100))
      if (script) fd.append('script', script)
      if (brief) fd.append('brief', brief)
      fd.append('options', JSON.stringify({ lang: 'fr', hasAvatar: !!avatarFile }))
      // le chef VOIT les médias (vision) et les place au moment que leur nom décrit
      if (medias.length) {
        fd.append('assets', JSON.stringify(medias.map((m) => ({ id: m.id, name: m.name, kind: m.kind }))))
        for (const m of medias) {
          // la MINIATURE, jamais l'original : au-delà de 400 Ko le chef ignore
          // l'image et le média ne se place nulle part
          if (m.thumb) fd.append('asset_' + m.id, new File([m.thumb as unknown as BlobPart], 'thumb.jpg', { type: 'image/jpeg' }))
          else if (m.bytes.length <= 380_000) fd.append('asset_' + m.id, new File([m.bytes as unknown as BlobPart], 'thumb', { type: m.contentType }))
        }
        console.log(`▶ médias envoyés au chef : ${medias.map((m) => m.id + (m.thumb ? '✓' : '✗')).join(', ')}`)
      }
      const or = await fetch(`${SUPABASE_URL}/functions/v1/orchestrate`, {
        method: 'POST', headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY }, body: fd,
      })
      const od = await or.json().catch(() => ({}))
      if (!or.ok || !od.ok || !od.plan) {
        await failAndRefund(userId, mcpJob, `chef d'orchestre : ${od.error || 'HTTP ' + or.status}`)
        return
      }
      const plan = od.plan as Record<string, unknown>
      plan.duration = Math.round(durEst * 100) / 100 // le moteur recale sur la durée réelle
      if (style !== 'auto') plan.slideStyle = style

      // 2) l'audio devient l'entrée du rendu (le moteur gère l'absence de piste vidéo)
      const inputPath = `${userId}/mcp-montage-${Date.now()}.${ext}`
      const { error: upErr } = await svc.storage.from('render-media').upload(inputPath, got.bytes, { contentType: got.contentType })
      if (upErr) { await failAndRefund(userId, mcpJob, "upload de l'audio : " + upErr.message); return }

      // 2b) sa photo et ses médias montent au bucket : le worker les récupère
      // par la liste `assets` (id « avatar » = photo d'avatar à la racine).
      const assets: { id: string; path: string; kind: string }[] = []
      if (avatarFile) {
        const aExt = /png/.test(avatarFile.contentType) ? 'png' : /webp/.test(avatarFile.contentType) ? 'webp' : 'jpg'
        const aPath = `${userId}/mcp-avatar-${Date.now()}.${aExt}`
        const { error: aErr } = await svc.storage.from('render-media').upload(aPath, avatarFile.bytes, { contentType: avatarFile.contentType })
        if (!aErr) assets.push({ id: 'avatar', path: aPath, kind: 'image' })
        else console.warn('upload avatar:', aErr.message)
      }
      // #84 · les visages du pool → assets avatar-1, avatar-2… (rotation worker)
      for (const [pi, pf] of avatarPoolFiles.entries()) {
        const pExt = /png/.test(pf.contentType) ? 'png' : /webp/.test(pf.contentType) ? 'webp' : 'jpg'
        const pPath = `${userId}/mcp-avatar-${pi + 1}-${Date.now()}.${pExt}`
        const { error: pErr } = await svc.storage.from('render-media').upload(pPath, pf.bytes, { contentType: pf.contentType })
        if (!pErr) assets.push({ id: 'avatar-' + (pi + 1), path: pPath, kind: 'image' })
        else console.warn('upload avatar pool ' + (pi + 1) + ':', pErr.message)
      }
      for (const m of medias) {
        const mExt = m.kind === 'video' ? 'mp4' : /png/.test(m.contentType) ? 'png' : /webp/.test(m.contentType) ? 'webp' : 'jpg'
        const mPath = `${userId}/mcp-as-${m.id}-${Date.now()}.${mExt}`
        const { error: mErr } = await svc.storage.from('render-media').upload(mPath, m.bytes, { contentType: m.contentType })
        if (!mErr) assets.push({ id: m.id, path: mPath, kind: m.kind })
        else console.warn('upload média ' + m.id + ':', mErr.message)
      }

      // ── #42 · LE VISAGE PARLE, SI ON LE DEMANDE ────────────────────────────
      // Axel : « faut qu'il appelle l'API Hedra et qu'il génère scène par scène,
      // pas tout l'audio » — et, pour ses propres tests : « continue à m'envoyer
      // juste une image, et quand je te dis passe au lipsync tu peux ». D'où le
      // défaut à false : itérer sur un montage ne doit pas brûler des crédits de
      // lipsync à chaque essai. Le drapeau voyage dans le plan ; c'est le worker
      // qui découpe et appelle Hedra, parce que lui seul a ffmpeg.
      // ⚠ ET AUSSI DEPUIS LE BRIEF. Mesuré : le premier essai n'a jamais activé le
      // lipsync parce que le client MCP avait en cache le schéma d'AVANT l'ajout
      // du paramètre — il l'a donc retiré de l'appel avant de l'envoyer, en
      // silence. Un marqueur dans le brief passe partout, quel que soit l'âge du
      // schéma côté client. Ceinture et bretelles, pour une option qui coûte des
      // crédits : mieux vaut deux chemins qu'un qui échoue sans le dire.
      const veutLipsync = args.lipsync === true || /\[LIPSYNC\]/i.test(brief)
      if (veutLipsync) (plan as Record<string, unknown>).__lipsync = true
      // modèle du lipsync (23/08) : hedra (défaut) | omnihuman | mix — param OU marqueur de brief
      // ([OMNI] / [MIX]), pour les mêmes raisons de schéma en cache que [LIPSYNC].
      let modeleLip = String(args.lipsync_model || (/\[MIX\]/i.test(brief) ? 'mix' : /\[OMNI\]/i.test(brief) ? 'omnihuman' : 'hedra')).toLowerCase()
      // MIX (Omni au hook + Hedra ensuite) = compte DEV/owner UNIQUEMENT pour le moment (Axel 23/08).
      if (modeleLip === 'mix' && profile.is_owner !== true) { modeleLip = 'hedra'; console.log('▶ lipsync : mode mix réservé au compte dev → repli hedra') }
      if (veutLipsync && modeleLip !== 'hedra') { (plan as Record<string, unknown>).lipsyncModel = modeleLip; console.log(`▶ lipsync : modèle ${modeleLip}`) }
      console.log(`▶ lipsync demandé : ${veutLipsync} (param ${args.lipsync}, brief ${/\[LIPSYNC\]/i.test(brief)})`)

      // ── SOUS-TITRES HOOK UNIQUEMENT (Axel 12/08 : « garde ceux du hook juste ») ─
      // Même mécanique que le lipsync : un marqueur [SUBSHOOK] dans le brief pose
      // le drapeau sur le plan, le moteur (dynamic-engine) ne garde alors que les
      // groupes de sous-titres qui tombent dans le hook — le reste de la vidéo se
      // lit par les visuels. Opt-in : sans le marqueur, rien ne change pour personne.
      if (/\[SUBSHOOK\]/i.test(brief)) {
        (plan as Record<string, unknown>).subtitlesHookOnly = true
        console.log('▶ sous-titres : hook uniquement (marqueur [SUBSHOOK])')
      }

      // 3) job de rendu, puis lien op_name → le job devient suivable de bout en bout
      const { data: rj, error: rjErr } = await svc.from('render_jobs')
        .insert({ user_id: userId, status: 'queued', plan, input_video: inputPath, assets })
        .select('id').single()
      if (rjErr || !rj) { await failAndRefund(userId, mcpJob, 'création du job de rendu impossible'); return }
      await svc.from('mcp_jobs').update({ op_name: String(rj.id), updated_at: new Date().toISOString() }).eq('id', mj.id)
    } catch (e) {
      await failAndRefund(userId, mcpJob, String((e as Error)?.message || e).slice(0, 200))
    }
  })())

  return toolText(
    `🎬 Montage IA lancé ! (~${Math.round(durEst)} s, style ${style}, −${cost} crédits)
job_id : ${mj.id}
Le chef d'orchestre transcrit et prépare le plan (~2 min), puis le moteur rend le MP4.
Appelle check_montage avec ce job_id dans environ 2 minutes.
${nettoyer
  ? `🔊 La voix est nettoyée avant le montage (isolation, −${coutClean} cr sur le total). Si ton audio est DÉJÀ traité, passe clean_audio: false — le repasser à l'isolation ne l'améliore pas.`
  : `⚠️ Audio monté TEL QUEL, à ta demande (clean_audio: false). Si le rendu sonne sale, relance sans ce paramètre.`}
💡 Une fois prêt : get_montage_plan → ajuste le plan → render_montage_plan pour une variante.`)
}

async function runCheckMontage(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const userId = String(profile.id)
  const { data: job } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).eq('kind', 'montage').maybeSingle()
  if (!job) return toolErr('Job montage introuvable sur ce compte.')
  // AJUSTER SANS REPASSER PAR MOI. Une fois la vidéo sortie, la vraie question
  // suivante est « et si je change cette animation ? ». Le lien ouvre l'écran
  // « Détails du montage » directement sur ce job — c'est plus juste que de lui
  // décrire le plan.
  if (job.status === 'done') {
    const lien = job.op_name ? `\nPour ajuster une scène, une transition ou un bruitage : ${lienDetails(String(job.op_name))}` : ''
    { const dl = `https://mcp.avatarads.fr/i/${job.id}`; return toolMedia(dl, 'montage.mp4', 'video/mp4', `✅ Montage prêt !\nLien : ${dl}${lien}`, String(job.preview_url || '') || undefined) }
  }
  if (job.status === 'failed') return toolErr(`Rendu échoué : ${job.error || 'erreur inconnue'} (crédits remboursés).`)

  // phase 1 (op_name vide) : le chef d'orchestre prépare encore le plan en tâche de fond
  if (!job.op_name) {
    if (Date.now() - new Date(job.created_at).getTime() > 20 * 60_000) {
      await failAndRefund(userId, job, 'préparation du plan bloquée')
      return toolErr('La préparation du plan est restée bloquée — crédits remboursés, relance montage_ia.')
    }
    return toolText('🧠 Le chef d\'orchestre transcrit et prépare le plan de montage — rappelle check_montage dans ~1 minute.')
  }

  const { data: rj } = await svc.from('render_jobs')
    .select('status, output_url, error, created_at').eq('id', job.op_name).maybeSingle()
  if (!rj) {
    await failAndRefund(userId, job, 'job de rendu disparu')
    return toolErr('Job de rendu introuvable — crédits remboursés.')
  }
  if (rj.status === 'failed') {
    await failAndRefund(userId, job, rj.error || 'échec du rendu')
    return toolErr(`Rendu échoué : ${rj.error || 'erreur inconnue'} — crédits remboursés.`)
  }
  if (rj.status === 'queued') {
    // moteur de rendu hors ligne ? au-delà de 2 h en file → annulation + remboursement
    if (Date.now() - new Date(rj.created_at).getTime() > 2 * 3600_000) {
      await svc.from('render_jobs').update({ status: 'failed', error: 'moteur de rendu hors ligne' })
        .eq('id', job.op_name).eq('status', 'queued')
      await failAndRefund(userId, job, 'moteur de rendu hors ligne')
      return toolErr('Le moteur de rendu est resté hors ligne plus de 2 h — crédits remboursés, réessaie plus tard.')
    }
    return enCours("En file d'attente du moteur de rendu.", 'check_montage', '1 minute')
  }
  if (rj.status === 'rendering') return enCours('Rendu du montage en cours (il prend 2 à 5 minutes).', 'check_montage', '1 minute')
  if (rj.status === 'done' && rj.output_url) {
    // ré-héberge le MP4 en public (render-media est privé) — claim atomique anti-doublon
    const dl = await svc.storage.from('render-media').download(String(rj.output_url))
    if (dl.error || !dl.data) return toolText('⏳ Presque prêt — rappelle check_montage dans quelques secondes.')
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const url = await deliverVideo(userId, job, bytes)
    // Le POSTER fabriqué par le worker (convention : `<clé>.poster.jpg`, cf.
    // worker.mjs). Ré-hébergé en public et mémorisé dans preview_url : le
    // premier check l'affiche, les relectures le retrouvent. Best-effort —
    // pas de poster (vieux rendu, worker pas encore à jour) = pas de vignette,
    // jamais un échec.
    let apercu: string | undefined
    if (url) {
      try {
        const dp = await svc.storage.from('render-media').download(String(rj.output_url) + '.poster.jpg')
        if (!dp.error && dp.data) {
          apercu = await uploadMedia(userId, new Uint8Array(await dp.data.arrayBuffer()), 'jpg', 'image/jpeg')
          await svc.from('mcp_jobs').update({ preview_url: apercu }).eq('id', job.id)
        }
      } catch { /* vignette best-effort */ }
    }
    return url
      ? toolMedia(url, 'montage.mp4', 'video/mp4', `✅ Montage prêt !\nURL : ${url}\n💡 Pour ajuster : get_montage_plan → modifie → render_montage_plan. Ou ouvre l'Éditeur sur ${APP_URL}`, apercu)
      : toolText('⏳ Presque prêt — rappelle check_montage dans quelques secondes.')
  }
  return toolText(`⏳ Statut : ${rj.status} — rappelle check_montage dans ~1 minute.`)
}

// ── RENVOYER L'ÉCRAN, PAS SA DESCRIPTION ────────────────────────────────────
// Relire un montage scène par scène dans une réponse d'outil, c'est demander à
// quelqu'un de se représenter un montage en lisant un tableau. L'app a déjà
// l'écran qu'il faut — la bande, les aperçus animés, le swipe, la
// régénération. On renvoie donc un LIEN qui l'ouvre sur le bon job.
// APP_URL vaut déjà « https://avatarads.fr/app/ » — pas de segment à rajouter.
const lienDetails = (renderJobId: string) => `${APP_URL.replace(/\/+$/, '')}/#montage=${renderJobId}`

async function runGetMontagePlan(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const { data: job } = await svc.from('mcp_jobs').select('op_name')
    .eq('id', jobId).eq('user_id', String(profile.id)).eq('kind', 'montage').maybeSingle()
  if (!job) return toolErr('Job montage introuvable sur ce compte.')
  const { data: rj } = await svc.from('render_jobs').select('plan').eq('id', job.op_name).maybeSingle()
  if (!rj?.plan) return toolErr('Plan introuvable pour ce job.')
  return toolText(
    `Détails du montage — ouvre l'écran d'AvatarAds sur ce montage :\n${lienDetails(String(job.op_name))}\n\n` +
    `(Donne ce lien tel quel à l'utilisateur : il y retrouve la bande, les aperçus d'animations, le remplacement au swipe et la régénération.)\n\n` +
    `Plan de montage du job ${jobId} en JSON, si tu préfères le retoucher ici puis appeler render_montage_plan :\n${JSON.stringify(rj.plan)}`)
}

async function runRenderMontagePlan(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  let plan: unknown = args.plan
  if (typeof plan === 'string') { try { plan = JSON.parse(plan) } catch { return toolErr('plan : JSON invalide.') } }
  if (!plan || typeof plan !== 'object' || !Number((plan as Record<string, unknown>).duration)) {
    return toolErr('plan invalide (champ duration manquant) — repars du JSON de get_montage_plan.')
  }
  if (Number((plan as Record<string, unknown>).duration) > 300) return toolErr('plan trop long (max 5 min).')

  const userId = String(profile.id)
  const { data: src } = await svc.from('mcp_jobs').select('op_name')
    .eq('id', jobId).eq('user_id', userId).eq('kind', 'montage').maybeSingle()
  if (!src) return toolErr("Job montage d'origine introuvable sur ce compte.")
  const { data: srcRj } = await svc.from('render_jobs').select('input_video, assets')
    .eq('id', src.op_name).maybeSingle()
  if (!srcRj?.input_video) return toolErr("Audio du montage d'origine introuvable.")

  const cost = MONTAGE_RENDER_COST
  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, 'nouveau rendu du plan modifié', 'render_montage_plan')
  if (gate) return gate
  const bal = await spendCredits(userId, cost)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  let launched = false
  try {
    const made = await createMontageJobs(userId, plan as Record<string, unknown>, String(srcRj.input_video), srcRj.assets || [], cost)
    if (typeof made === 'string') return toolErr(made)
    launched = true
    return toolText(
      `🎬 Nouveau rendu lancé avec le plan modifié ! (−${cost} crédits)
job_id : ${made.jobId}
Appelle check_montage avec ce job_id dans 1 à 2 minutes.`)
  } finally {
    if (!launched) await refundCredits(userId, cost)
  }
}

async function runListMedia(profile: Record<string, unknown>): Promise<ToolContent> {
  const userId = String(profile.id)
  const { data, error } = await svc.storage.from('mcp-media')
    .list(userId, { limit: 24, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) return toolErr('Erreur lecture médias : ' + error.message)
  if (!data || !data.length) return toolText('Aucun média généré via Claude pour le moment.')
  const urlDe = (n: string) => `${SUPABASE_URL}/storage/v1/object/public/mcp-media/${userId}/${n}`
  const lines = data.map((f) =>
    `- ${f.name} (${f.created_at ? new Date(f.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—'}) : ${urlDe(f.name)}`)
  // GALERIE (réf. intégrations concurrentes) : les dernières images s'affichent
  // directement dans la carte, pas seulement en liste de liens. On préfère les
  // aperçus .jpg (déjà réduits) et on plafonne à 5 pour rester léger.
  const contenu: Array<Record<string, unknown>> = []
  const images = data.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name))
  // un PNG et son aperçu JPG naissent à ~1 s d'écart avec deux timestamps :
  // on groupe par tranche de 5 s et on garde UN visuel par génération (le JPG
  // — déjà réduit — de préférence)
  const parGen = new Map<number, { name: string; jpg: boolean }>()
  for (const f of images) {
    const ts = Number((f.name.match(/^(\d{10,})/) || [])[1] || 0)
    const cle = ts ? Math.round(ts / 5000) : Math.random()
    const jpg = /\.jpe?g$/i.test(f.name)
    const ex = parGen.get(cle)
    if (!ex || (jpg && !ex.jpg)) parGen.set(cle, { name: f.name, jpg })
  }
  let n = 0
  for (const { name } of parGen.values()) {
    if (n >= 5) break
    const bloc = await blocImage(urlDe(name))
    if (bloc) { contenu.push(bloc); n++ }
  }
  contenu.push({ type: 'text', text: `Derniers médias générés (les ${n} images les plus récentes sont affichées ci-dessus) :\n${lines.join('\n')}` })
  return { content: contenu }
}

// ── #37 · LE BACKLOG DE LA BANQUE D'ANIMATIONS ────────────────────────────
// Idée d'Axel : plutôt que de deviner quelles animations écrire, on laisse les
// vrais montages nous le dire. À chaque fois que le rattrapage du chef
// d'orchestre répond « rien dans la banque ne montre ça », la demande est
// enregistrée avec le mot, la phrase et le nom qu'il proposerait.
// Ici on la lit, classée par fréquence : c'est l'ordre dans lequel fabriquer.
async function runAnimationsDemandees(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  if (!isUnlimited(profile)) return toolErr('Outil réservé au compte administrateur.')
  const limite = Math.max(1, Math.min(60, Number(args.limite) || 20))
  const jours = Number(args.depuis_jours) || 0
  let q = svc.from('anim_demandes_top').select('*').limit(limite)
  if (jours > 0) q = q.gte('derniere', new Date(Date.now() - jours * 86400000).toISOString())
  const { data, error } = await q
  if (error) return toolErr(`Lecture impossible : ${error.message}`)
  if (!data || !data.length) {
    return toolText("Aucune animation manquante enregistrée pour l'instant.\n(Chaque montage qui rencontre un mot que la banque ne sait pas dessiner en ajoute une.)")
  }
  const tot = data.reduce((n: number, r: Record<string, unknown>) => n + Number(r.demandes || 0), 0)
  const lignes = data.map((r: Record<string, unknown>, i: number) => {
    const d = Number(r.demandes || 0), u = Number(r.utilisateurs || 0)
    return `${String(i + 1).padStart(2)}. « ${r.mot} » — ${d} demande${d > 1 ? 's' : ''}`
      + `${u > 1 ? ` · ${u} utilisateurs` : ''}`
      + `${r.nom_propose ? ` · nom proposé : \`${r.nom_propose}\`` : ''}`
      + `${r.montre ? `\n      montre : ${r.montre}` : ''}`
      + `${r.exemple ? `\n      entendu : « ${String(r.exemple).slice(0, 90)} »` : ''}`
  }).join('\n')
  return toolText(
    `Animations manquantes — ${data.length} mot(s), ${tot} demande(s) au total${jours ? ` sur ${jours} jours` : ''}\n\n${lignes}\n\n`
    + `Les trois premières sont celles à fabriquer en priorité : elles reviennent le plus souvent dans de vrais montages.`,
  )
}

async function runAdminFindUser(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  if (!isUnlimited(profile)) return toolErr('Outil réservé au compte administrateur.')
  const email = String(args.email || '').trim().toLowerCase()
  if (!email) return toolErr('Le paramètre "email" est requis.')
  const { data: u } = await svc.from('profiles').select(
    'id, email, first_name, plan, credits_remaining, bought_credits, videos_used, images_used, quota_reset_date, referred_by, whop_member_id, whop_cancel_at_period_end, email_optout, created_at',
  ).eq('email', email).maybeSingle()
  if (!u) return toolText(`Aucun compte avec l'e-mail ${email}.`)
  const { data: logs } = await svc.from('email_log').select('kind, sent_at')
    .eq('email', email).order('sent_at', { ascending: false }).limit(5)
  const logTxt = (logs && logs.length)
    ? logs.map((l) => `  - ${l.kind} · ${new Date(l.sent_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`).join('\n')
    : '  (aucun)'
  return toolText(
    `Fiche utilisateur ${u.email}
- Prénom : ${u.first_name || '—'} · inscrit le ${new Date(u.created_at).toLocaleDateString('fr-FR')}
- Plan : ${u.plan || 'free'} · crédits : ${u.credits_remaining ?? 0} (dont achetés : ${u.bought_credits ?? 0})
- Vidéos utilisées ce mois : ${u.videos_used ?? 0} · images : ${u.images_used ?? 0} (reset : ${u.quota_reset_date || '—'})
- Parrainé par : ${u.referred_by || '—'} · Whop : ${u.whop_member_id || '—'}${u.whop_cancel_at_period_end ? ' (annulation en fin de période)' : ''}
- E-mails marketing : ${u.email_optout ? 'désinscrit' : 'inscrit'}
- Derniers e-mails envoyés :
${logTxt}`)
}

// ═══ OAUTH (RFC 8414 / 7591 / 7636) — le connecteur « Se connecter avec ═══
// AvatarAds » (15/08). Pourquoi : Bloom et Alexya rendent leurs widgets
// interactifs dans claude.ai en connecteurs persos, et leur seul différentiel
// structurel est l'OAuth — hypothèse : le rendu des iframes est réservé aux
// connecteurs authentifiés. Bonus immédiat : plus de clé à coller, et la
// régénération de clé ne casse plus rien.
// Le flux : claude.ai reçoit un 401 sur l'URL nue → lit les .well-known →
// s'enregistre (/register) → envoie l'utilisateur sur /authorize → on redirige
// vers l'app (déjà connectée) qui demande le consentement → l'app appelle
// /oauth/approve avec le JWT → code → claude.ai l'échange sur /token (PKCE)
// → jeton Bearer aat_… accepté par la porte MCP comme une clé.
const OAUTH_BASE = 'https://mcp.avatarads.fr'
// Domaines par lesquels on accepte de se faire appeler comme serveur MCP. Le
// domaine OAuth SUIT celui de connexion : claude.ai exige que la métadonnée
// (resource / issuer / endpoints) soit sur le MÊME host que le connecteur —
// sinon « autorisation impossible ». Netlify (proxy) transmet le host d'origine
// en `x-forwarded-host`. Host inconnu → repli sur le netlify (comportement
// actuel, aucune régression). Renommer = ajouter le domaine ici + DNS + Netlify.
const OAUTH_HOSTS = ['avatarads-mcp.netlify.app', 'mcp.avatarads.fr', 'avatarads-mcp.fr']
function oauthBase(req: Request): string {
  // Supabase (Deno Deploy) STRIPPE `x-forwarded-host` — mesuré le 15/08. La
  // fonction edge Netlify pose donc AUSSI `x-mcp-connect-host` (custom → survit) ;
  // on le lit en priorité, avec repli sur x-forwarded-host puis host.
  const fwd = (req.headers.get('x-mcp-connect-host') || req.headers.get('x-forwarded-host') || req.headers.get('host') || '')
    .split(',')[0].trim().toLowerCase()
  return OAUTH_HOSTS.includes(fwd) ? 'https://' + fwd : OAUTH_BASE
}
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000       // 30 jours ; refresh sans limite
const CODE_TTL_MS = 10 * 60 * 1000

const hexAleatoire = (n: number) => {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function sha256b64url(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
}

const DOC_AS = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/authorize`,
  token_endpoint: `${base}/token`,
  registration_endpoint: `${base}/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['avatarads'],
  // CIMD (draft-ietf-oauth-client-id-metadata-document) : le nouvel écran
  // claude.ai (08/2026) propose « métadonnées client hébergées par Anthropic —
  // Recommandé » ; il ne choisit CIMD QUE si ce flag est true ET que
  // token_endpoint_auth_methods_supported contient 'none' (doc Anthropic).
  client_id_metadata_document_supported: true,
})

// ═══ CIMD — Client ID Metadata Documents (29/08) ═════════════════════════════
// Nouveau flux claude.ai : client_id = URL https d'un document JSON de
// métadonnées (ex. https://claude.ai/oauth/claude-code-client-metadata :
// { client_id: <l'URL>, client_name, redirect_uris: [...] }). Pas de /register.
// On mappe chaque URL sur un uuid interne (mcp_oauth_clients.cimd_url unique)
// pour que codes/tokens (colonnes client_id uuid) restent INCHANGÉS.
const isCimdClientId = (s: string) => /^https:\/\/\S+$/.test(s)
// redirection loopback (RFC 8252 §7.3) : Claude Code déclare
// http://localhost/callback et http://127.0.0.1/callback puis utilise un PORT
// éphémère → le port ne compte pas dans la comparaison.
function loopbackUrl(uri: string): URL | null {
  try {
    const v = new URL(uri)
    return (v.protocol === 'http:' && (v.hostname === 'localhost' || v.hostname === '127.0.0.1')) ? v : null
  } catch { return null }
}
function redirectUriAllowed(uri: string, allowed: string[]): boolean {
  if (allowed.includes(uri)) return true
  const v = loopbackUrl(uri)
  if (!v) return false
  return allowed.some((a) => {
    const w = loopbackUrl(a)
    return !!w && w.hostname === v.hostname && w.pathname === v.pathname
  })
}
// Récupère + valide le document, upsert la ligne client, rend l'uuid interne.
// Garde-fous : https only, pas d'IP/localhost/.local/.internal (anti-SSRF),
// 5 s max, 100 Ko max, doc.client_id DOIT être l'URL exacte (exigence du draft).
async function resolveCimdClient(clientIdUrl: string): Promise<{ id: string, uris: string[] } | null> {
  let u: URL
  try { u = new URL(clientIdUrl) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(h) ||
      h.endsWith('.local') || h.endsWith('.internal')) return null
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 5000)
  // deno-lint-ignore no-explicit-any
  let doc: any = null
  try {
    const r = await fetch(clientIdUrl, { signal: ctl.signal, redirect: 'error', headers: { Accept: 'application/json' } })
    if (r.ok) {
      const txt = await r.text()
      if (txt.length <= 100_000) doc = JSON.parse(txt)
    }
  } catch { doc = null } finally { clearTimeout(t) }
  if (!doc || typeof doc !== 'object') return null
  if (String(doc.client_id || '') !== clientIdUrl) return null
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.map(String).slice(0, 16) : []
  if (!uris.length || uris.some((x: string) => !/^https:\/\//.test(x) && !loopbackUrl(x))) return null
  const { data: row, error } = await svc.from('mcp_oauth_clients')
    .upsert({ cimd_url: clientIdUrl, client_name: String(doc.client_name || u.hostname).slice(0, 120), redirect_uris: uris },
      { onConflict: 'cimd_url' })
    .select('client_id').single()
  if (error || !row) return null
  return { id: String(row.client_id), uris }
}

// Toutes les routes OAuth ; renvoie null si la requête n'en est pas une.
async function handleOAuth(req: Request, url: URL, segs: string[]): Promise<Response | null> {
  const p1 = segs[1] || ''

  // ── découverte ──
  if (p1 === '.well-known') {
    const doc = segs[2] || ''
    const base = oauthBase(req)
    if (doc === 'oauth-protected-resource') {
      return json(200, { resource: base, authorization_servers: [base],
        scopes_supported: ['avatarads'], bearer_methods_supported: ['header'] })
    }
    if (doc === 'oauth-authorization-server' || doc === 'openid-configuration') {
      return json(200, DOC_AS(base))
    }
    return json(404, { error: 'not_found' })
  }

  // ── enregistrement dynamique du client (RFC 7591) ──
  if (p1 === 'register' && req.method === 'POST') {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json(400, { error: 'invalid_client_metadata' }) }
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String).slice(0, 8) : []
    if (!uris.length || uris.some((u) => !/^https:\/\//.test(u))) {
      return json(400, { error: 'invalid_redirect_uri' })
    }
    const { data: client, error } = await svc.from('mcp_oauth_clients')
      .insert({ client_name: String(body.client_name || 'client'), redirect_uris: uris })
      .select('client_id').single()
    if (error || !client) return json(500, { error: 'server_error' })
    return json(201, {
      client_id: String(client.client_id),
      client_name: String(body.client_name || 'client'),
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
  }

  // ── autorisation : on délègue le consentement à l'app (déjà connectée) ──
  if (p1 === 'authorize' && (req.method === 'GET' || req.method === 'POST')) {
    const q = url.searchParams
    const clientId = String(q.get('client_id') || '')
    const redirectUri = String(q.get('redirect_uri') || '')
    const challenge = String(q.get('code_challenge') || '')
    const method = String(q.get('code_challenge_method') || 'S256')
    if (!clientId || !redirectUri || !challenge || method !== 'S256') {
      return json(400, { error: 'invalid_request', error_description: 'client_id, redirect_uri, code_challenge (S256) requis' })
    }
    // CIMD : client_id = URL → on résout vers l'uuid interne (le relai, les
    // codes et les tokens ne voient QUE l'uuid ; /token n'exige pas client_id).
    let effClientId = clientId
    let uris: string[] = []
    if (isCimdClientId(clientId)) {
      const cimd = await resolveCimdClient(clientId)
      if (!cimd) return json(400, { error: 'invalid_client', error_description: 'client_id metadata document invalide' })
      effClientId = cimd.id
      uris = cimd.uris
    } else {
      const { data: client } = await svc.from('mcp_oauth_clients')
        .select('client_id, redirect_uris').eq('client_id', clientId).maybeSingle()
      if (!client) return json(400, { error: 'invalid_client' })
      uris = (client.redirect_uris as string[]) || []
    }
    if (!redirectUriAllowed(redirectUri, uris)) return json(400, { error: 'invalid_redirect_uri' })
    const relai = btoa(JSON.stringify({
      client_id: effClientId, redirect_uri: redirectUri, state: String(q.get('state') || ''),
      code_challenge: challenge, scope: String(q.get('scope') || 'avatarads'),
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return new Response(null, { status: 302, headers: { ...cors, Location: `${APP_URL}?mcp_oauth=${relai}` } })
  }

  // ── consentement approuvé par l'app (JWT utilisateur) → code ──
  if (p1 === 'oauth' && segs[2] === 'approve' && req.method === 'POST') {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!jwt) return json(401, { error: 'unauthorized' })
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: { user }, error } = await userClient.auth.getUser()
    if (error || !user) return json(401, { error: 'unauthorized' })
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }
    const clientId = String(body.client_id || ''), redirectUri = String(body.redirect_uri || '')
    const challenge = String(body.code_challenge || ''), state = String(body.state || '')
    const { data: client } = await svc.from('mcp_oauth_clients')
      .select('client_id, redirect_uris').eq('client_id', clientId).maybeSingle()
    // redirectUriAllowed (et non .includes) : port éphémère des redirections
    // loopback des clients CIMD type Claude Code (RFC 8252 §7.3).
    if (!client || !redirectUriAllowed(redirectUri, (client.redirect_uris as string[]) || []) || !challenge) {
      return json(400, { error: 'invalid_request' })
    }
    const code = 'aac_' + hexAleatoire(24)
    const { error: insErr } = await svc.from('mcp_oauth_codes').insert({
      code_hash: await hashKey(code), client_id: clientId, user_id: user.id,
      redirect_uri: redirectUri, code_challenge: challenge,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    if (insErr) return json(500, { error: 'server_error' })
    const sep = redirectUri.includes('?') ? '&' : '?'
    return json(200, { redirect_url: `${redirectUri}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}` })
  }

  // ── échange du code contre le jeton (PKCE) + refresh ──
  if (p1 === 'token' && req.method === 'POST') {
    const ct = req.headers.get('content-type') || ''
    let form: URLSearchParams
    if (ct.includes('application/json')) {
      const j = await req.json().catch(() => ({}))
      form = new URLSearchParams(Object.entries(j).map(([k, v]) => [k, String(v)]))
    } else {
      form = new URLSearchParams(await req.text())
    }
    const grant = form.get('grant_type') || ''

    if (grant === 'authorization_code') {
      const code = form.get('code') || '', verifier = form.get('code_verifier') || ''
      const redirectUri = form.get('redirect_uri') || ''
      if (!code || !verifier) return json(400, { error: 'invalid_request' })
      const { data: row } = await svc.from('mcp_oauth_codes').select('*')
        .eq('code_hash', await hashKey(code)).maybeSingle()
      if (!row) return json(400, { error: 'invalid_grant' })
      await svc.from('mcp_oauth_codes').delete().eq('code_hash', await hashKey(code))
      if (new Date(String(row.expires_at)).getTime() < Date.now()) return json(400, { error: 'invalid_grant', error_description: 'code expiré' })
      if (redirectUri && redirectUri !== row.redirect_uri) return json(400, { error: 'invalid_grant' })
      if (await sha256b64url(verifier) !== String(row.code_challenge)) return json(400, { error: 'invalid_grant', error_description: 'PKCE' })
      const access = 'aat_' + hexAleatoire(24), refresh = 'aar_' + hexAleatoire(24)
      const { error: insErr } = await svc.from('mcp_oauth_tokens').insert({
        token_hash: await hashKey(access), refresh_hash: await hashKey(refresh),
        client_id: row.client_id, user_id: row.user_id,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      })
      if (insErr) return json(500, { error: 'server_error' })
      return json(200, { access_token: access, token_type: 'Bearer',
        expires_in: Math.floor(TOKEN_TTL_MS / 1000), refresh_token: refresh, scope: 'avatarads' })
    }

    if (grant === 'refresh_token') {
      const refresh = form.get('refresh_token') || ''
      if (!refresh) return json(400, { error: 'invalid_request' })
      const { data: row } = await svc.from('mcp_oauth_tokens').select('*')
        .eq('refresh_hash', await hashKey(refresh)).maybeSingle()
      if (!row) return json(400, { error: 'invalid_grant' })
      const access = 'aat_' + hexAleatoire(24), refresh2 = 'aar_' + hexAleatoire(24)
      // Rotation DOUCE : l'ancien access reste valable 10 min (une autre session
      // claude.ai peut encore l'avoir en main — un delete sec la mettait en 401
      // « Problème de connexion »). L'ancien refresh, lui, meurt tout de suite
      // (écrasé par un hash jamais distribué, la colonne est NOT NULL + unique).
      await svc.from('mcp_oauth_tokens').update({
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        refresh_hash: await hashKey('dead_' + hexAleatoire(24)),
      }).eq('token_hash', row.token_hash)
      const { error: insErr } = await svc.from('mcp_oauth_tokens').insert({
        token_hash: await hashKey(access), refresh_hash: await hashKey(refresh2),
        client_id: row.client_id, user_id: row.user_id,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      })
      if (insErr) return json(500, { error: 'server_error' })
      return json(200, { access_token: access, token_type: 'Bearer',
        expires_in: Math.floor(TOKEN_TTL_MS / 1000), refresh_token: refresh2, scope: 'avatarads' })
    }

    return json(400, { error: 'unsupported_grant_type' })
  }

  return null
}

// ── Gestion de la clé personnelle (appelée par l'app avec le JWT utilisateur) ──
async function handleKeyManagement(req: Request): Promise<Response> {
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json(401, { error: 'unauthorized' })
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return json(401, { error: 'unauthorized' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }

  const { data: prof } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
  const planAllowed = !!prof && (isUnlimited(prof) || ALLOWED_PLANS.includes(String(prof.plan || '').toLowerCase()))

  if (body.action === 'status') {
    const { data } = await svc.from('mcp_keys').select('created_at, last_used_at, require_confirm')
      .eq('user_id', user.id).is('revoked_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    return json(200, {
      exists: !!data, created_at: data?.created_at ?? null, last_used_at: data?.last_used_at ?? null,
      // défaut false (29/08) : l'option confirmation quitte l'UI, les nouvelles
      // clés partent sans devis ; une clé existante garde sa valeur stockée.
      require_confirm: data?.require_confirm ?? false, plan_allowed: planAllowed,
    })
  }
  if (body.action === 'create') {
    if (!planAllowed) return json(403, { error: 'plan_required' }) // réservé Pro/Élite
    const raw = new Uint8Array(24)
    crypto.getRandomValues(raw)
    const key = 'aa_' + Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('')
    await svc.from('mcp_keys').update({ revoked_at: new Date().toISOString() }).eq('user_id', user.id).is('revoked_at', null)
    // require_confirm: false PAR DEFAUT (Axel, 29/08) — l'option « demander
    // confirmation » disparaît de l'UI (Anthropic confirme déjà côté client).
    // Explicite ici + défaut colonne passé à false ; les clés existantes
    // gardent leur réglage, et set_confirm reste fonctionnel pour qui l'a.
    const { error: insErr } = await svc.from('mcp_keys').insert({ user_id: user.id, key_hash: await hashKey(key), require_confirm: false })
    if (insErr) return json(500, { error: 'server_error' })
    return json(200, { ok: true, url: `${MCP_PUBLIC_BASE}/${key}` })
  }
  if (body.action === 'revoke') {
    await svc.from('mcp_keys').update({ revoked_at: new Date().toISOString() }).eq('user_id', user.id).is('revoked_at', null)
    return json(200, { ok: true })
  }
  if (body.action === 'set_confirm') {
    await svc.from('mcp_keys').update({ require_confirm: body.value !== false && body.value !== 'false' })
      .eq('user_id', user.id).is('revoked_at', null)
    return json(200, { ok: true })
  }
  return json(400, { error: 'bad_request' })
}

// Icône plein bord 256×256 (PNG, ~4 Ko) — même dessin que /icon.svg, pour les clients qui veulent du raster.
const ICON_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAQAElEQVR4AeydSbYcxw1F/9FQXJM05pqksbQmjqU1cWzzHhF2spRVlQ0QgQCej+DsogEugJf5P2n5p59//vk/MjFQDfSsgZ8+9B8REIG2BCQAbVOvwEXg40MCoCoQgaYECFsCAAWZCDQlIAFomniFLQIQkABAQSYCTQlIAJomXmH3JmDRSwCMhI4i0JCABKBh0hWyCBgBCYCR0FEEGhKQADRMukLuTWAbvQRgS0PnItCMgASgWcIVrghsCUgAtjR0LgLNCEgAmiVc4fYm8Bi9BOCRiK5FoBEBCUCjZCtUEXgkIAF4JKJrEWhEQALQKNkKtTeBveglAHtUdE8EmhCQADRJtMIUgT0CEoA9KronAk0ISACaJFph9ibwLHoJwDMyui8CDQhIABokWSGKwDMCEoBnZHRfBBoQkAA0SLJC7E3gVfQSgFd09EwEihOQABRPsMITgVcEJACv6OiZCBQnIAEonmCF15vAu+glAO8I6bkIFCYgASicXIUmAu8ISADeEdJzEShMQAJQOLkKrTeBI9FLAI5Q0hgRKEpAAlA0sQpLBI4QkAAcoaQxIlCUgASgaGIVVm8CR6OXABwlpXEiUJCABKBgUhWSCBwlIAE4SkrjRKAgAQlAwaQqpN4EzkQvAThDS2NFoBgBCUCxhCocEThDQAJwhpbGikAxAhKAYglVOL0JnI1eAnCWmMaLQCECEoBCyVQoInCWgATgLDGNF4FCBCQAhZKpUHoTuBK9BOAKNc0RgSIEJABFEqkwROAKAQnAFWqaIwJFCEgAiiRSYfQmcDV6CcBVcponAgUISAAKJPExhF9++eUD+/333z+wL1++fGBfv379OGKMxZiLsRb2uI+u1ycgAVg8hzQmTUrDYjQ4R+y33377wBiDHQ2VsRhzMdbCbG32wxhzdE2Ny0lAApAzL7te0XA0Hs2IWUPSpDzDdic63mQP9sPMB/zAL4znjttpqQME7gyRANyhFzyXZqKprNE40njcx4K3P7U8fmH4iCBwxPdsfp4KqsFgCUCiJNMsNA3NY01EU3E/kZuHXMFnfN/GQmzcP7SABg0hIAEYgvn5JjTEtkloGu49n7HmE2IiNosVMcDWjKaO1xKAwbmkETBrBI5cD3Zj+naIAWZfOhKDaym5O0sCcJfggfk0OI2+Ne4dmNpiCCxMDBAExIB7LYKfHKQEICgBFPBjw3MvaLtSyyIGsJMYxKdVAuDImAbHKF6Mc8xxi3ZLmRjAky+DdgCCA5YAOACmySlQM64dltUSGwIwRQzsq0Bi8PGxwXP5VAJwER0FScNTkBy5vriUpp0kgBBgsEcIxP4kwM1wCcAGxpFTio2Gxzg/Mkdj4gggBOQCQwzidqq5sgTgQF5pdIqLNw6FxvWBaRoykAA5QQzIEbkauPXSW0kAXqSPoqLhMYrrxVA9SkSAXJkQVBUDL9wSgB2S28bnfGeIbi1AACHAEAFsAZeHuygB2CCn2XnbY5xvHul0YQKIAGZfBQuH4u66BOAbUpqdpsc4/3ZL/xQlICH4MbGtBYBmp+kxzn9Eo6vKBFYWAs+8tBQAmp2mxzj3BKq11iLQXQhaCQDNTtNjnK9VqvI2kkBXIWghADQ7TY9xHllIWnttAggBf2LQpU7KCwBNj3VJ6Nrtl8N7RICaQQhyePR/L7zPygoAyeOPfdT43iXTZz2EgBqilqpGXU4AaHjUm+RVTZriGkuAWqKmqK2xO8fvVkoAUOqqiYovBe3wigDNT21RY6/GrfashABYclDq1RIgf9ciQI3N+rEggtTyAoAio8yIQAQgrSkCewQQAmpv79lK95YVABqexicRKwGXr3UIUHurfw0sKQAoL82PCNQpJ0WyKgGEgJpc0f/lBIDGB/iKsOVzXQLUZKQIRJFbRgB42/O5xTEKhtYVgTsEEAFqdCUhWEIAAMqb/05yNFcERhFACKjZUfvd2Se9AAASoHeC1FwRGE2AmqV2R+97dr/UAsBbH5Bng9J4EchAgNqlhu/6Ejk/pQDwcz7gOEYGr7VFIJoANczvBThG73Vl/XQCACg1/5VUak5mAllrOpUAWPNnTqR8E4GrBDKKQBoBUPNfLSvNW4nAWRGIji2FAKj5o9Os9TMRyCQC0wVAzZ+pNOXLKAJZRGCqAKj5R5Wb9slIIIMITBUAAGRMjHwSgVEEXvXACB+mCcDswEfA1R4icITAzF6YIgD8FUk+/4/A0RgRqE6AXpglAsMFgObnr0hWT6riE4EzBBABeuPMHI+xQwWAAKs0/99///2B/fnnnx/Y58+fP8w+ffr0v3Oebc0jaVXXgCdmvIzn49Ge25E5FZjQGwgBsYyyoQJAgKMC896HIsMoxm2D//HHHx8Yz8zY2855tjXmYla8jO1qxgimWzNe9vzxaM/tyNwtU8avynT0jwLDBIC3/2pJoZCsuDhi3POIw4qXwmVdBMFj3RXWgCExm3GN3fXdmLIuXFdlOlIEhggAzb/S259ipIgwzu8W5rv57EHxrly072LkOQ1JjKO4bpnCGB9WMH4MwEb4OkQAVml+ioTixDgfkYDHPbZF+/hsxWs4wpPGJ7YZMbAvPiBA2AwfzuzJ2FFfAeECwNufgLIbhUGRULAZfKVoaRr8yuDPFR9gmY0pXFdhOqJ3QgWAz5jsb38rUgrjSpFHz8GvVQp2ywKfaf7tvSznMMU3cp/Fpz0/6B16aO+Z171QAfj111+9/AxZx4o0eyGsUrAkCZY0Fz5zndXMT2ogq4/4Ff0VECYAOI6CEURGI/HZi3TLbYWChSnNj69b3zOfUwP4ncXHRz/4AsAe73tdhwmAl4MR65BwEh+xdvSa+J2xwfAJ36Ljj1gfv6mJiLU91uRl6rHO3hohAoDDWd/+JJqE78FY5V62tyzNj0+r8Nvzk5qgNvaezb7HFwAW4UeIAEQ46rEmCSbRHmvNXoOGo/Fm+4EP+DLbD4/9qQ1qxGMt7zV4qXqvyXohApDx7U9iSTBBV7EMjZfBB898UiOImueaR9d6NW6ZL4AopXoF58gzEntk3GpjELZZPs/cOzLmrLUSIQLuXwARTt5NdtVChQvFOuONxZ7sjQ/VjNgy1kzEy9VVAGh+LFtBVC1U4zwjPprE9q94hGm2GOktzJO3qwBk/Is/GZXcM4GsRaGOjJO9aBD2rmwjY5zF0VUAZgXxbN8uhUr8I4t15F7ENssQVmzW/nv7ev8Y4CoAGX/7vwex6r0RxYqoVuW3F1c2sUv7I4C3Y3vJOHsvW/LO+n92fLd4z/K5Mn6EqJ71y7PX3L4Asv383+1NRRGNKNaOIhPNldzNMjcBmBWA9v2RQGSxdhRV6GYTPc/fA7gJgOdnCdDvWrak3Y3n6PyucR/lc2VcpKhe8cdzTlkB8ISktf4h8Ndff/1z0vC/M4mA58vWTQAy1USmZI3mEhl75NqjOWXZb7YfJQVgNlTtLwKrECgpAHpTrVJ+6/hZtaZcBMDzZ5J1SiKvpxHFGrFmXoL5PfPqORcByI9LHorAPQIRvwC955HPbAmAD0etUpxAtr/o5oXbRQD0eeiVDp91vD4PfbzRKhEEvHrORQAiAryzphrgDr39uWK6z2X1uyUFYPWkyP98BLwFMEuEEoAsmXDyI7JQI9d2Cj9smaqxlxSAqsk6Ut1Vf1l1JHaNOU/ATQC8filxPoT9GZ1FYJ/I/bue/yu0+96MWyFb3J695iYA49JxbKdsSTvm9f1Rkf9WJonq/fywwl1LKQCeTt0FxPyOxTpC9DpyjRRVanWmuX0BZPybUh2LNbqYRohMdAxn1s8Yr2evuQnAGaijxmZMXmTsI95UEtXIDB5b2/Nr200APJ06huH9KIoVez9y/REjxW7kXjMzQ+14i+rMePb2dhMAFs8oAl2KdWShshfNQc4rW8ba8e4xVwHI+O+jo1AzJtKzcWbEN2NPT2bv1iI+aufduNHPUwvAaBhH9+ONdXTsauMo1Bnx0RzYaryO+juD6RHfPH8ByH6uXwCoE8bC2ezLly/ZXHLxZ2ahVmWKqLok52ERj0vv/nIVAI8Ao9bgbZU5sVfiztCAGXy4wu7ZHGpkpqg+84v7Ef+/DO4CkPH3AMDDSCwJ5nx1Iw5EbXYc+FBFBGBKjcxmOnJ/dwHw/kTxhkGCSbT3uiPXw3/iGLnnq70QAXx6NSb7M/zPxHSPV8TL1V0AcFwiAIUYy1qoNA++xUQduyp+43/kLnfXjvj8x6cQAYhQKpz1NBJO4j3XjF6LT238jt7n6vr4thpT/MXvqzGvPi9EAPgCwLLDIfEUQHY/+cT++vXrB8fsvsIUX7NzhWV2QbVc00tRL9UQAcDxKIdZ29OyFyyNRKF6xjxiLbji+4i9zu5hzc/x7NwZ4xGAqH3DBCDS6QgY2QqW4qTx8Ssi3hFr4jsxZBECY4pPI+K3Pe4eI1+mYQJA0CuKgH2+zirabZFyDseVjRgQAuM6IxZ8oOkxzmf4cHXPqF/+mT+hAvD582fbZ6kjBYshAtgI59mHAsVWK9KjfGA6UgjgCE+M86N+ZhoX+fYnzlABYINoBWOPKKNgMStamtSrkFiHwsRYn324FxVLpnWJlZiJ3ZspDFnX1uc6U+xnfBnRO+ECEK1gZ4DeGUvRYlZcFK4ZRWa23cPucbSxNp8j97HtnE7nxL5lChPjxJHn2JYJ12aMwZhnDc85z7dzZp7f2XtE74QLAABW/VEA358ZhWtG0ZlRiGZ2j6ONrVKcz7jcuQ8b48QRbpjx5Mi1GWMw5t3ZN+PcEW9/4h4iAPwyEGNDmQiIwHsCI97+eDFEANhoVEDsJROBlQmMevvDaJgA8AUwMjCCk4nATAJX9qZHRr4shwkAMAgMIeBcJgIi8CMBeoMe+fFu7NVQASCU0QGyp0wEViAwozeGCwAqx2fOCgmRjyIwigA9QW+M2s/2GS4AbIzSzQiWvWUiMILAmT3oBXrizByvsVMEAOf5uwEEzrlMBLoSoAfohVnxTxMAAp6leuwt+/ig+DCxmEdgdg9MFQCKb6b6zUt7jp3hP7sAc5CY4wW1Tw7m7P7PrlMFABcAwC9AOJeNIwBzmh/+2Lid6+90JEL4Z+A+XQCARSEChHPZGAIwt52253ZPxzgC1HoW5ikEANQAAQznslgCj5x5Ez3ei/Wg7+pwptazEEgjAAABDIA4l8UQgC+cH1fnHkLweF/XfgSesffb4fxKqQQA9ylEQHEu8ycA32ervnr2bI7u/0jg2RU1nZFvOgEAIKAAxrnMj8A7pnwBvBvj502flWBKTWeMOKUAAApg/DEJ57L7BI4WIdwRgvs7agUIUMMw5TyjpRUAYFGInz59+qB4uZZdJ3CmCCla2F/fTTPhR+1yzEwjtQAYOIpXImA0zh9p6LOzYH52TvfxFj+1eoW5zR95XEIAAEJBApZz2XECMLvyFmIOc4/vpJEQgBm1yvkKtowAABOwfFYBmWvZawJwgtnrUc+fMpc1no/QEyOAMpZh/gAABHdJREFUYPLWh5ndW+G4lAAYUCCrMI3G/hE+cNp/evwua7DW8Rn9RsKH5kcEVot+SQEAMoWprwFI/NsoRPj8+8m1O6zFmtdm150FE2oQPqtGuawAGHDgo8B23f1IUfI28ubAmqztve6K68EBHtiK/m99Xl4ACAYRQIm7C4EVJkwijIJnj4i1V1kTBlgVDiUEwIqnsxBQkBSmsYg6skdHoSVmXjJwjmI7Y91SAmAAuwkBxUljWvzRR/iyZ/Q+GdYnThqfmJ/5s/L9kgJgCSFpJI8kVlNui5HYiNOuRx3Zk71H7TdyH2oFQaV2iHPk3qP3Ki0ABpMkklCsStFakRKbxTn6yN4wHb1v1H7GlJg4j9on07otBMCAk1SKFmVHCLi2Zysd8T1LkcLQeK7E0HzFf1gSA0eu7VmHYysB2CYUISDhJJ6GwrbPM55TnPiL79n8wyd8W4UjuTeD61Weq89rKwDbxFG8mBVwtiKmQK1Yt35nPIcjvmZiCD8Mv8gxR66xjAxH+iQBeKBNAWMUCkYhY6OLhf0oVHzgyPWDq2kv8dUYwg4b6Sz7syfcjB/n3B/pxwp7SQDeZIlCxiggKyaKy4yiwt4s8/Yxa2DsY8b124nJB8AOgx3MvGJiHTPWNWbswzl78jw5nunuSQBOpoCiorjMKDaMwsM43xrFuWc2hjmYXbM+dtKtJYbDjDiJ14xr7BUjnps9zuM+68IMGwmiwl4SAOcsUoRbozj3zMY4b7/ccsbhFSMbw3G5AJM7LAFIniC5JwKRBCQAkXS1tggkJyABSJ4guZeTQBWvJABVMqk4ROACAQnABWiaIgJVCEgAqmRScYjABQISgAvQNKU3gUrRSwAqZVOxiMBJAhKAk8A0XAQqEZAAVMqmYhGBkwQkACeBaXhvAtWilwBUy6jiEYETBCQAJ2BpqAhUIyABqJZRxSMCJwhIAE7A0tDeBCpGLwGomFXFJAIHCUgADoLSMBGoSEACUDGrikkEDhKQABwEpWG9CVSNXgJQNbOKSwQOEJAAHICkISJQlYAEoGpmFZcIHCAgATgASUN6E6gcvQSgcnYVmwi8ISABeANIj0WgMgEJQOXsKjYReENAAvAGkB73JlA9eglA9QwrPhF4QUAC8AKOHolAdQISgOoZVnwi8IKABOAFHD3qTaBD9BKADllWjCLwhIAE4AkY3RaBDgQkAB2yrBhF4AkBCcATMLrdm0CX6CUAXTKtOEVgh4AEYAeKbolAFwISgC6ZVpwisENAArADRbd6E+gUvQSgU7YVqwg8EJAAPADRpQh0IiAB6JRtxSoCDwQkAA9AdNmbQLfoJQDdMq54RWBDQAKwgaFTEehGQALQLeOKVwQ2BCQAGxg67U2gY/QSgI5ZV8wi8J2ABOA7CB1EoCMBCUDHrCtmEfhOQALwHYQOvQl0jV4C0DXzilsEvhGQAHyDoH9EoCsBCUDXzCtuEfhGQALwDYL+6U2gc/QSgM7ZV+ztCUgA2peAAHQmIAHonH3F3p6ABKB9CfQG0D36/wIAAP//DM9wIwAAAAZJREFUAwB/HBeIduIONAAAAABJRU5ErkJggg=='

// ── Endpoint MCP ──
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(req.url)
  const segs = url.pathname.split('/').filter(Boolean) // ['mcp', '<clé>' | 'key' | 'i']

  // Lien de téléchargement de MARQUE : mcp.avatarads.fr/i/<jobId> → 302 vers le
  // média. L'URL storage est déjà publique (bucket mcp-media public) : on ne fait
  // qu'un raccourci propre à la place du long lien supabase brut. Aucune auth.
  if (segs[1] === 'i' && segs[2]) {
    const { data: j } = await svc.from('mcp_jobs').select('result_url').eq('id', segs[2]).maybeSingle()
    let dest = j?.result_url ? String(j.result_url) : ''
    if (dest) {
      // ?download=<nom> forwardé sur l'URL storage → Content-Disposition:attachment
      // (le navigateur télécharge au lieu d'ouvrir) = le bouton Télécharger du widget.
      const dl = new URL(req.url).searchParams.get('download')
      if (dl) dest += (dest.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(dl)
      return new Response(null, { status: 302, headers: { ...cors, Location: dest, 'Cache-Control': dl ? 'no-store' : 'public, max-age=3600' } })
    }
    return new Response('Média introuvable', { status: 404, headers: cors })
  }

  // Statut d'un job, SONDÉ PAR LE WIDGET lui-même → une seule carte avec barre de
  // progression, plus de spam check_image. UUID = capacité (rien de sensible : l'URL
  // du média est déjà publique). CORS ACAO:* via json(). Progress = estimation temps.
  if (segs[1] === 'status' && segs[2]) {
    const r0 = await svc.from('mcp_jobs').select('*').eq('id', segs[2]).maybeSingle()
    let j = r0.data as Record<string, unknown> | null
    if (!j) return json(404, { status: 'unknown' })
    // Le WIDGET pilote la génération vidéo : à chaque sonde, on avance le job d'un cran
    // (1 check fournisseur + livraison si prêt). Ainsi la barre + l'affichage inline
    // marchent SANS que Claude appelle check_* → plus de « Impossible de joindre » (proxy).
    // Images : op_name null (livrées par la tâche de fond) → jamais avancées ici.
    if (j.status !== 'done' && j.status !== 'failed' && j.op_name) {
      if (j.kind === 'video') await advanceVideoJob(j)
      else if (j.kind === 'avatar') await advanceAvatarJob(j)
      const { data: j2 } = await svc.from('mcp_jobs').select('status, kind, result_url, created_at, error').eq('id', segs[2]).maybeSingle()
      if (j2) j = { ...j, ...j2 }
    }
    if (j.status === 'pending') return new Response(JSON.stringify({ status: 'pending', kind: j.kind, url: null, progress: 0, error: null }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    const elapsed = Date.now() - new Date(String(j.created_at)).getTime()
    const attendu = j.kind === 'image' ? 50000 : j.kind === 'avatar' ? 200000 : 130000
    const done = j.status === 'done' || j.status === 'failed'
    const progress = done ? 100 : Math.min(94, Math.max(5, Math.round((elapsed / attendu) * 100)))
    return new Response(JSON.stringify({ status: j.status, kind: j.kind, url: j.status === 'done' ? j.result_url : null, progress, error: j.error || null }),
      { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }

  // Lancer un job IMAGE « en attente de la photo produit » depuis la carte : {job, data_url} (photo déposée
  // dans la carte → mcp-media/<uid>/ref-…) ou {job, skip:true}. Capacité = job_id (status pending, ≤2 h),
  // passage pending→running ATOMIQUE (un seul lancement), mêmes garde-fous que /regenerate.
  if (segs[1] === 'start' && req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const jobId = String(body.job || '')
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json(400, { error: 'bad_request' })
    const { data: pj } = await svc.from('mcp_jobs').select('*').eq('id', jobId).maybeSingle()
    if (!pj) return json(404, { error: 'not_found' })
    if (pj.status !== 'pending') return json(409, { error: 'not_pending' })
    if (Date.now() - new Date(String(pj.created_at)).getTime() > 2 * 3600 * 1000) return json(403, { error: 'expired' })
    const params = (pj.params || {}) as Record<string, unknown>
    const pArgs = (params.args || {}) as Record<string, unknown>
    const format = ['portrait', 'square', 'landscape'].includes(String(params.format)) ? String(params.format) : 'portrait'
    const quality: 'standard' | 'high' = params.quality === 'high' ? 'high' : 'standard'
    const kind = String(params.kind || 'free')
    const userId = String(pj.user_id)
    const { data: profile } = await svc.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (!profile) return json(404, { error: 'no_profile' })
    if (!isUnlimited(profile) && !['pro', 'elite'].includes(String(profile.plan || '').toLowerCase())) return json(403, { error: 'plan' })
    const cost = quality === 'high' ? IMG_COST.high : IMG_COST.standard
    if (!isUnlimited(profile)) {
      const cap = DAILY_CAPS[String(profile.plan || '').toLowerCase()] ?? 100
      const spent = await mcpSpentToday(userId)
      if (spent + cost > cap) return json(429, { error: 'daily_cap' })
      if ((Number(profile.credits_remaining) || 0) < cost) return json(402, { error: 'no_credits' })
    }
    // photo déposée dans la carte → mcp-media public (ref-…) → référence de l'édition
    let ref: { bytes: Uint8Array; contentType: string } | null = null
    let refUrl = ''
    const linkUrl = String(body.product_url || '').trim()
    if (!body.skip && linkUrl) {
      const got = await referenceDepuisLien(linkUrl)
      if (!got.ref) return json(422, { error: 'no_image_in_link' })
      ref = got.ref; refUrl = got.url
    } else if (!body.skip) {
      const m = /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url || ''))
      if (!m) return json(400, { error: 'bad_image' })
      const bytes = b64ToBytes(m[3])
      if (bytes.length > 10_000_000) return json(413, { error: 'too_large' })
      const ext = m[2] === 'png' ? 'png' : m[2] === 'webp' ? 'webp' : 'jpg'
      const path = `${userId}/ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error: upErr } = await svc.storage.from('mcp-media').upload(path, bytes, { contentType: m[1] })
      if (upErr) return json(500, { error: 'upload' })
      refUrl = `${SUPABASE_URL}/storage/v1/object/public/mcp-media/${path}`
      ref = { bytes, contentType: m[1] }
    }
    // pending → running, atomique (deux clics = un seul lancement)
    const { data: took } = await svc.from('mcp_jobs').update({ status: 'running', credits_cost: cost, updated_at: new Date().toISOString() })
      .eq('id', jobId).eq('status', 'pending').select('id')
    if (!took || !took.length) return json(409, { error: 'not_pending' })
    const bal = await spendCredits(userId, cost)
    if (bal === null || bal === -1) { await svc.from('mcp_jobs').update({ status: 'failed', error: 'crédits' }).eq('id', jobId); return json(402, { error: 'credits' }) }
    const size = ({ portrait: '1024x1536', square: '1024x1024', landscape: '1536x1024' } as Record<string, string>)[format]
    const promptFinal = composerPromptImage(pArgs, !!ref)
    bg((async () => {
      let lastErr = 'Erreur génération'
      try {
        const out = await genererImage(promptFinal, size, quality, ref)
        if ('bytes' in out) {
          const brut = out.bytes
          const url = await uploadMedia(userId, brut, 'png', 'image/png')
          let apercu: string | null = null
          try { const petit = await fabriquerApercu(brut); if (petit) apercu = await uploadMedia(userId, petit, 'jpg', 'image/jpeg') } catch (_) { /* vignette = confort */ }
          await svc.from('mcp_jobs').update({ status: 'done', result_url: url, preview_url: apercu, updated_at: new Date().toISOString() }).eq('id', jobId)
          await saveToLibrary(userId, brut, 'png', 'image/png', 'image', kind === 'static_ad' ? 'Static ad' : 'Image IA', apercu || url)
          return
        }
        lastErr = out.error
      } catch (e) { lastErr = String((e as Error)?.message || e) }
      await svc.from('mcp_jobs').update({ status: 'failed', error: lastErr.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', jobId)
      await refundCredits(userId, cost)
    })())
    return json(200, { job_id: jobId, statusUrl: `https://mcp.avatarads.fr/status/${jobId}`, ref: refUrl, prompt: promptFinal })
  }

  // Regénérer EN UN CLIC depuis le widget (la spec MCP Apps interdit au widget
  // d'appeler un outil ; ui/message passe par la barre). Ici le widget tape cet
  // endpoint : le job_id d'origine = CAPACITÉ → user_id. Mêmes garde-fous que
  // l'outil (plan Pro/Élite, plafond 24 h, crédits) + fraîcheur ≤12 h (un job_id
  // fuité ne peut pas être rejoué indéfiniment). Toujours STANDARD (3 cr).
  if (segs[1] === 'regenerate' && req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const origId = String(body.job || '')
    const prompt = String(body.prompt || '').trim()
    const format = ['portrait', 'square', 'landscape'].includes(String(body.format)) ? String(body.format) : 'portrait'
    const refUrl = String(body.ref || '').trim()
    const raw = body.raw === true || body.raw === 'true'   // prompt déjà composé par generate_image → ne pas le ré-augmenter
    if (!/^[0-9a-f-]{36}$/i.test(origId) || !prompt) return json(400, { error: 'bad_request' })
    const { data: orig } = await svc.from('mcp_jobs').select('user_id, created_at').eq('id', origId).maybeSingle()
    if (!orig) return json(404, { error: 'not_found' })
    if (Date.now() - new Date(String(orig.created_at)).getTime() > 12 * 3600 * 1000) return json(403, { error: 'expired' })
    const userId = String(orig.user_id)
    const { data: profile } = await svc.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (!profile) return json(404, { error: 'no_profile' })
    if (!isUnlimited(profile) && !['pro', 'elite'].includes(String(profile.plan || '').toLowerCase())) return json(403, { error: 'plan' })
    const cost = IMG_COST.standard
    if (!isUnlimited(profile)) {
      const cap = DAILY_CAPS[String(profile.plan || '').toLowerCase()] ?? 100
      const spent = await mcpSpentToday(userId)
      if (spent + cost > cap) return json(429, { error: 'daily_cap' })
      if ((Number(profile.credits_remaining) || 0) < cost) return json(402, { error: 'no_credits' })
    }
    const bal = await spendCredits(userId, cost)
    if (bal === null || bal === -1) return json(402, { error: 'credits' })
    const size = ({ portrait: '1024x1536', square: '1024x1024', landscape: '1536x1024' } as Record<string, string>)[format]
    const { data: job, error: jErr } = await svc.from('mcp_jobs').insert({ user_id: userId, kind: 'image', status: 'running', credits_cost: cost }).select('id').single()
    if (jErr || !job) { await refundCredits(userId, cost); return json(500, { error: 'job' }) }
    bg((async () => {
      let lastErr = 'Erreur génération'
      try {
        let ref: { bytes: Uint8Array; contentType: string } | null = null
        if (refUrl) { const got = await fetchUserFile(refUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, 'la photo de référence'); if (typeof got !== 'string') ref = got }
        const out = await genererImage(raw ? prompt : augmenterPortrait(prompt), size, 'standard', ref)
        if ('bytes' in out) {
          const brut = out.bytes
          const url = await uploadMedia(userId, brut, 'png', 'image/png')
          let apercu: string | null = null
          try { const petit = await fabriquerApercu(brut); if (petit) apercu = await uploadMedia(userId, petit, 'jpg', 'image/jpeg') } catch (_) { /* vignette = confort */ }
          await svc.from('mcp_jobs').update({ status: 'done', result_url: url, preview_url: apercu, updated_at: new Date().toISOString() }).eq('id', job.id)
          await saveToLibrary(userId, brut, 'png', 'image/png', 'image', 'Image IA', apercu || url)  // filet Bibliothèque (regénération)
          return
        }
        lastErr = out.error
      } catch (e) { lastErr = String((e as Error)?.message || e) }
      await svc.from('mcp_jobs').update({ status: 'failed', error: lastErr.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', job.id)
      await refundCredits(userId, cost)
    })())
    return json(200, { job_id: job.id, statusUrl: `https://mcp.avatarads.fr/status/${job.id}` })
  }

  // JS du widget MCP App, servi hors sandbox (comme Pletor sert le sien depuis
  // son API) : c'est CE fichier que l'iframe charge en <script src>, car le CSP
  // de la sandbox bloque tout JS inline.
  if (segs[1] === 'widget.js') {
    return new Response(UI_WIDGET_JS, { headers: { ...cors,
      'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } })
  }

  // Icône du connecteur en PLEIN BORD (fond sombre jusqu'aux coins). La favicon.svg
  // et le PNG du site ont les COINS TRANSPARENTS → claude.ai laissait transparaître son
  // fond blanc aux angles de l'avatar (arrondi par l'hôte). Ici le carré est PLEIN → une
  // fois arrondi par claude, coins nets, plus de blanc. Servie par la fonction (aucun
  // redeploy du site) et pointée par serverInfo.icons.
  // favicon.* et apple-touch-icon sur le domaine du connecteur : claude.ai (et d'autres clients) vont
  // chercher la favicon du DOMAINE — ici le catch-all MCP répondait un flux text/event-stream, d'où le
  // repli sur la favicon du site (coins transparents → angles blancs dans Claude, Axel 21/08).
  if (segs.length === 2 && /^(favicon\.(ico|png)|apple-touch-icon(-precomposed)?\.png|icon-(\d+)\.png)$/.test(segs[1])) {
    return new Response(b64ToBytes(ICON_PNG_B64) as unknown as BodyInit, { headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } })
  }
  if (segs[1] === 'icon.svg' || segs[1] === 'favicon.svg') {
    return new Response(
      '<svg viewBox="0 0 36 36" width="36" height="36" xmlns="http://www.w3.org/2000/svg"><rect width="36" height="36" fill="#0a0a0a"/><path fill-rule="evenodd" fill="white" d="M18 8C14.5 8 2.5 11.5 2.5 18.5C2.5 23.5 7 27.5 13 27.5C15.8 27.5 17.3 25 18 23.8C18.7 25 20.2 27.5 23 27.5C29 27.5 33.5 23.5 33.5 18.5C33.5 11.5 21.5 8 18 8ZM7.5 18.5C7.5 16.2 9.5 14.5 12 14.5C14.5 14.5 16.5 16.2 16.5 18.5C16.5 20.8 14.5 22.5 12 22.5C9.5 22.5 7.5 20.8 7.5 18.5ZM19.5 18.5C19.5 16.2 21.5 14.5 24 14.5C26.5 14.5 28.5 16.2 28.5 18.5C28.5 20.8 26.5 22.5 24 22.5C21.5 22.5 19.5 20.8 19.5 18.5Z"/></svg>',
      { headers: { ...cors, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
  }

  if (segs[1] === 'key') {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    return await handleKeyManagement(req)
  }
  // Photo PRODUIT pour Claude (20/08) : claude.ai ne transmet pas les images jointes aux outils →
  // l'utilisateur la dépose ici (app, JWT) ; on la range dans mcp-media/<uid>/ref-<stamp>.<ext>
  // (public) → URL à donner à Claude, et list_media la retrouve (nom ref-…).
  if (segs[1] === 'ref' && req.method === 'POST') {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!token) return json(401, { error: 'unauthorized' })
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error } = await userClient.auth.getUser()
    if (error || !user) return json(401, { error: 'unauthorized' })
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }
    const m = /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url || ''))
    if (!m) return json(400, { error: 'bad_image' })
    const bytes = b64ToBytes(m[3])
    if (bytes.length > 10_000_000) return json(413, { error: 'too_large' })
    const ext = m[2] === 'png' ? 'png' : m[2] === 'webp' ? 'webp' : 'jpg'
    const path = `${user.id}/ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error: upErr } = await svc.storage.from('mcp-media').upload(path, bytes, { contentType: m[1] })
    if (upErr) return json(500, { error: 'upload' })
    return json(200, { ok: true, url: `${SUPABASE_URL}/storage/v1/object/public/mcp-media/${path}` })
  }
  // Routes OAuth (.well-known, register, authorize, oauth/approve, token)
  const repOAuth = await handleOAuth(req, url, segs)
  if (repOAuth) return repOAuth

  // ── Découverte OAuth : on répond 404, PAS 405 ──
  // Les connecteurs claude.ai sondent /.well-known/oauth-* avant de parler MCP.
  // Un 405 (« méthode non autorisée ») laisse croire que la ressource EXISTE :
  // le client enchaîne alors sur l'inscription dynamique (RFC 7591) et échoue
  // avec « Impossible de s'inscrire auprès du service de connexion ». Un 404
  // dit clairement « pas d'OAuth ici » → le client accepte l'URL à clé.
  if (url.pathname.includes('/.well-known/')) {
    return new Response(JSON.stringify({ error: 'not_found' }),
      { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // Streamable HTTP sans état : pas de flux SSE côté GET
  // GET = ouverture d'un flux SSE serveur→client. On n'en émet aucun (transport
  // sans état), mais on répond 200 avec un flux vide plutôt qu'un 405 : côté
  // claude.ai, un 405 fait apparaître le connecteur comme injoignable.
  if (req.method === 'GET') {
    // Keep-warm (worker Railway, GET toutes les 4 min) → réconciliation globale des jobs vidéo,
    // INDÉPENDANTE du proxy connecteur/widget. Throttle 2 min pour ne pas la lancer sur chaque
    // sonde SSE de claude. Date.now() est OK ici (fonction edge normale, pas un script workflow).
    const _now = Date.now()
    if (_now - _lastReconcile > 120_000) { _lastReconcile = _now; bg(reconcileAllStale()) }
    // GET ANONYME → 401 + WWW-Authenticate (29/08). Le nouvel écran claude.ai
    // « vérification du serveur » sonde l'URL nue ; un 200 ici contredisait le
    // 401 du POST (claude.ai n'honore JAMAIS WWW-Authenticate sur un 200) →
    // « Impossible de vérifier ». Le 401 est le signal spec (RFC 9728 §5.1).
    // Les GET AVEC identifiant (clé aa_ dans le chemin/query, ou Bearer aat_)
    // gardent le flux SSE vide — keep-warm Railway (GET nu, statut ignoré) OK.
    const gAuth = (req.headers.get('Authorization') || '').trim()
    const gKey = segs[1] || url.searchParams.get('key') || ''
    if (!gAuth && !gKey.startsWith('aa_')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors,
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${oauthBase(req)}/.well-known/oauth-protected-resource"` } })
    }
    return new Response(': ok\n\n', {
      status: 200,
      headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // ── JAMAIS DE 401 ICI ──────────────────────────────────────────────────────
  // Le 401 est LE signal, dans la spec MCP, qui dit « ce serveur est protégé par
  // OAuth ». Le client enchaîne alors sur la découverte puis sur l'inscription
  // dynamique (RFC 7591) — et comme nous n'avons pas d'OAuth (la clé est dans
  // l'URL), ça échoue avec « Impossible de s'inscrire auprès du service de
  // connexion de AvatarAds ». Axel : « il fonctionne mais je n'arrive pas à le
  // connecter dans Claude » — le serveur répondait bien, c'est le 401 sur les
  // sondes SANS clé (claude.ai interroge aussi l'URL nue) qui déclenchait tout.
  //
  // En JSON-RPC, une erreur se transporte DANS LE CORPS, pas dans le statut
  // HTTP. On répond donc 200 avec un objet `error` : le client lit le message,
  // et aucun client ne part en OAuth.
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  const key = segs[1] || url.searchParams.get('key') || (bearer.startsWith('aa_') ? bearer : '')
  // ── UNE CLÉ MORTE NE BLOQUE PLUS LA CONNEXION (Axel, 15/08) ────────────────
  // Quand initialize échouait sur clé révoquée, claude.ai affichait
  // « Impossible de joindre » → l'utilisateur régénérait → ce qui révoquait la
  // clé de ses AUTRES connecteurs → boucle infernale. Désormais initialize,
  // tools/list et resources répondent TOUJOURS (rien de sensible dedans), et
  // l'erreur claire tombe à l'APPEL d'outil, avec la marche à suivre.
  let keyErr: string | null = null
  // deno-lint-ignore no-explicit-any
  let keyRow: any = null
  // ── jeton OAuth (aat_…) : équivalent d'une clé, mappé au compte ──
  if (bearer.startsWith('aat_')) {
    const { data: tok } = await svc.from('mcp_oauth_tokens').select('token_hash, user_id, expires_at')
      .eq('token_hash', await hashKey(bearer)).maybeSingle()
    if (!tok) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: { ...cors,
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${oauthBase(req)}/.well-known/oauth-protected-resource", error="invalid_token"` } })
    }
    if (new Date(String(tok.expires_at)).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'expiré' }), { status: 401, headers: { ...cors,
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${oauthBase(req)}/.well-known/oauth-protected-resource", error="invalid_token"` } })
    }
    bg((async () => { await svc.from('mcp_oauth_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', tok.token_hash) })())
    keyRow = { id: null, user_id: tok.user_id, require_confirm: false }
  } else if (!key || !key.startsWith('aa_')) {
    // AUCUN identifiant : 401 + WWW-Authenticate → claude.ai découvre l'OAuth
    // et lance « Se connecter avec AvatarAds ». (Les URLs à clé ne passent
    // jamais ici : la clé est dans le chemin.)
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors,
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${oauthBase(req)}/.well-known/oauth-protected-resource"` } })
  } else {
    const { data } = await svc.from('mcp_keys').select('id, user_id, require_confirm')
      .eq('key_hash', await hashKey(key)).is('revoked_at', null).maybeSingle()
    keyRow = data
    if (!keyRow) keyErr = 'Clé AvatarAds invalide ou révoquée. Va dans Mon compte sur ' + APP_URL + ', copie l’URL de la clé ACTUELLE et remplace l’URL de ce connecteur (ne régénère pas : ça révoque la clé partout ailleurs).'
  }
  if (keyRow && keyRow.id) bg((async () => { await svc.from('mcp_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id) })())

  // deno-lint-ignore no-explicit-any
  let profile: any = null
  if (keyRow) {
    const { data } = await svc.from('profiles').select(
      'id, email, first_name, plan, credits_remaining, is_owner',
    ).eq('id', keyRow.user_id).maybeSingle()
    profile = data
    if (!profile) keyErr = 'Compte introuvable.'
  }

  // Accès réservé Pro/Élite (clé créée puis plan rétrogradé → on bloque à l'usage aussi)
  const planKey = String(profile?.plan || '').toLowerCase()
  const planAllowed = profile ? (isUnlimited(profile) || ALLOWED_PLANS.includes(planKey)) : false
  const ctx: ToolCtx = {
    requireConfirm: keyRow ? keyRow.require_confirm !== false : true,
    dailyCap: profile && isUnlimited(profile) ? null : (DAILY_CAPS[planKey] ?? 100),
  }

  let msg: Record<string, unknown>
  try { msg = await req.json() } catch { return rpcError(null, -32700, 'Parse error') }
  if (Array.isArray(msg)) return rpcError(null, -32600, 'Batch non supporté')
  const id = 'id' in msg ? msg.id : undefined
  const method = String(msg.method || '')
  const params = (msg.params || {}) as Record<string, unknown>
  console.log('[mcp]', method || '(sans méthode)', '· id:', String(id), '· ua:', (req.headers.get('user-agent') || '?').slice(0, 40), keyErr ? '· keyErr' : '')

  // Notifications (pas d'id) → accusé de réception sans corps
  if (id === undefined) return new Response(null, { status: 202, headers: cors })

  try {
    if (method === 'initialize') {
      const requested = String(params.protocolVersion || '')
      const supported = ['2025-06-18', '2025-03-26', '2024-11-05']
      return rpcResult(id, {
        protocolVersion: supported.includes(requested) ? requested : '2025-06-18',
        // 16/08 14h : widget RÉ-ACTIVÉ avec le VRAI fix — la console d'Axel a montré
        // que claude.ai BLOQUE le JS inline (CSP script-src sans 'unsafe-inline'). Le
        // JS passe maintenant en EXTERNE (/widget.js, WIDGET_ORIGIN dans resourceDomains
        // → script-src). capability `resources` + `_meta.ui.resourceUri` (.html) sur les
        // check_* → claude.ai fetch resources/read + rend le widget inline.
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        // `title`, `websiteUrl` et `icons` : ce que les clients MCP affichent
        // dans leur liste de connecteurs (logo + nom lisible au lieu d'un « A »)
        serverInfo: {
          name: 'AvatarAds',
          title: 'AvatarAds',
          version: '1.4.1',
          websiteUrl: 'https://avatarads.fr',
          icons: [
            // Icône PLEIN BORD servie par la fonction (coins sombres jusqu'au bord) : la
            // favicon.svg/PNG du site ont les coins TRANSPARENTS → claude affichait son fond
            // blanc aux angles de l'avatar. Voir la route /icon.svg.
            { src: 'https://mcp.avatarads.fr/icon.svg?v=2', mimeType: 'image/svg+xml', sizes: ['any'] },
            { src: 'https://mcp.avatarads.fr/icon-256.png?v=2', mimeType: 'image/png', sizes: ['256x256'] },
          ],
        },
        instructions: "⛔ MODE SILENCIEUX ABSOLU (priorité n°1, avant tout le reste) : pour une demande de visuel/static ad/UGC, ta réponse ne contient QUE des appels generate_image et ZÉRO texte — pas une phrase avant, pas une phrase après, pas de préambule, pas de récap, pas de liste d'angles, pas de « je lance », pas de script, pas de question, pas d'emoji. Ne CONSULTE PAS la page toi-même (pas de web fetch / recherche) : passe l'URL du produit DIRECTEMENT dans product_url — l'outil récupère la photo et génère. Compose headline/subheadline/bullets/brand/cta toi-même de façon concise SANS les écrire dans le chat. Pour PLUSIEURS visuels : un appel APRÈS l'autre (jamais en parallèle). La carte affiche tout ; l'utilisateur ne veut RIEN lire d'autre. PHOTO PRODUIT (ordre de préférence) : (1) si tu as consulté la page produit et vois l'URL de l'image principale (og:image, souvent cdn.shopify.com) → reference_image_url (fiable même si la page bloque notre serveur) ; (2) l'utilisateur colle le lien de page → product_url (extraction auto + repli dépôt) ; (3) rien → appelle quand même generate_image (kind static_ad/ugc), la carte gère. Jamais de questions en rafale. STATIC AD : utilise kind:'static_ad' avec headline/subheadline/bullets/brand/cta en français. Serveur MCP AvatarAds (avatarads.fr) — les modules de l'app pilotés depuis Claude : Images IA = generate_image · Express = generate_video puis check_video · Générateur (avatar parlant voix+lipsync) = generate_avatar_video puis check_avatar_video · Nettoyage audio = clean_audio · MONTAGE IA (audio → vidéo motion-design complète) = montage_ia puis check_montage · Éditeur = get_montage_plan (lire le plan) et render_montage_plan (re-rendre le plan modifié). Tout consomme les crédits du compte connecté. ⚠️ RÉCUPÉRATION AUTOMATIQUE (TRÈS IMPORTANT) : « Impossible de joindre AvatarAds » / erreur de connexion sur generate_video ou generate_avatar_video NE VEUT PAS DIRE échec — la génération a bien DÉMARRÉ, les crédits sont débités, c'est juste le relais claude.ai qui a lâché la réponse du lancement (le serveur, lui, répond en ~2 s). Dans CE cas tu DOIS, dans le MÊME tour et SANS RIEN DEMANDER à l'utilisateur (n'écris PAS « la vidéo se génère », ne demande PAS « veux-tu que je vérifie », n'attends PAS qu'il te relance), rappeler IMMÉDIATEMENT check_video (Express) ou check_avatar_video (avatar) SANS aucun argument — c'est CE rappel qui fait apparaître la carte avec la barre de progression puis la vidéo. Si elle n'est pas encore prête, re-rappelle check_video (toujours SANS argument) au bout de ~20 s, jusqu'à ce que la carte s'affiche. Ne relance JAMAIS generate (2ᵉ débit)." + (ctx.requireConfirm
          ? "Avant toute génération, un devis en crédits peut être retourné : montre-le à l'utilisateur et attends son accord avant de rappeler l'outil avec confirm: true. "
          : "L'utilisateur a DÉSACTIVÉ la demande de confirmation : lance les générations directement, sans demander son accord ni annoncer le coût au préalable. ") + "get_account donne le solde.",
      })
    }
    if (method === 'ping') return rpcResult(id, {})
    if (method === 'tools/list') return rpcResult(id, { tools: toolDefs(profile ? isUnlimited(profile) : false, ctx.requireConfirm) })
    if (method === 'resources/list') return rpcResult(id, { resources: UI_RESOURCES })
    if (method === 'resources/templates/list') return rpcResult(id, { resourceTemplates: [] })
    if (method === 'resources/read') {
      const uri = String(params?.uri || '')
      if (uri.startsWith('ui://avatarads/')) {
        return rpcResult(id, { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: UI_VIEWER_HTML, _meta: UI_META }] })
      }
      return rpcError(id, -32002, 'Ressource inconnue : ' + uri)
    }
    if (method === 'prompts/list') return rpcResult(id, { prompts: [] })
    if (method === 'tools/call') {
      if (keyErr || !profile) {
        return rpcResult(id, { content: [{ type: 'text', text: keyErr || 'Compte introuvable.' }], isError: true })
      }
      const name = String(params.name || '')
      const args = (params.arguments || {}) as Record<string, unknown>
      if (!planAllowed) {
        return rpcResult(id, toolErr(`L'accès via Claude est réservé aux plans Pro et Élite. Ton plan actuel : ${profile.plan || 'free'}. Passe au plan supérieur sur ${APP_URL}`))
      }
      // Rattrapage en arrière-plan des vidéos bloquées (débits sans contrepartie) — n'ajoute pas de latence
      if (!isUnlimited(profile)) bg(reconcileStaleJobs(String(profile.id)))
      let out: ToolContent
      if (name === 'get_account') out = await runGetAccount(profile)
      else if (name === 'generate_image') out = await runGenerateImage(profile, args, ctx)
      else if (name === 'generate_video') out = await runGenerateVideo(profile, args, ctx)
      else if (name === 'check_image') out = await runCheckImage(profile, args)
      else if (name === 'check_video') out = await runCheckVideo(profile, args)
      else if (name === 'generate_avatar_video') out = await runGenerateAvatarVideo(profile, args, ctx)
      else if (name === 'check_avatar_video') out = await runCheckAvatarVideo(profile, args)
      else if (name === 'clean_audio') out = await runCleanAudio(profile, args, ctx)
      else if (name === 'lipsync_video') out = await runLipsyncVideo(profile, args, ctx)
      else if (name === 'montage_ia') out = await runMontageIA(profile, args, ctx)
      else if (name === 'check_montage') out = await runCheckMontage(profile, args)
      else if (name === 'get_montage_plan') out = await runGetMontagePlan(profile, args)
      else if (name === 'render_montage_plan') out = await runRenderMontagePlan(profile, args, ctx)
      else if (name === 'list_media') out = await runListMedia(profile)
      else if (name === 'admin_find_user') out = await runAdminFindUser(profile, args)
      else if (name === 'animations_demandees') out = await runAnimationsDemandees(profile, args)
      else return rpcError(id, -32602, `Outil inconnu : ${name}`)
      return rpcResult(id, out)
    }
    console.log('[mcp] méthode non supportée :', method)
    return rpcError(id, -32601, `Méthode non supportée : ${method}`)
  } catch (e) {
    console.error('mcp error:', e)
    return rpcError(id, -32603, 'Erreur serveur : ' + String((e as Error)?.message || e))
  }
})
