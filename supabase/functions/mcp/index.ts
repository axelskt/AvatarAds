import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const GOOGLE_AI_KEY  = Deno.env.get('GOOGLE_AI_KEY') ?? ''
const HEDRA_API_KEY  = Deno.env.get('HEDRA_API_KEY') ?? ''
const ELEVEN_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? ''

const APP_URL         = 'https://avatarads.fr/app/'
const IMG_COST        = { standard: 3, high: 5 }
const VIDEO_COST_SEC  = 1 // Veo 3.1 Lite = tarif Express Lite
// ── Générateur (avatar parlant) via Claude : mêmes briques que l'app ──
const HEDRA_BASE      = 'https://api.hedra.com/web-app/public'
const HEDRA_MODEL_ID  = 'd1dd37a3-e39a-4854-a298-6510289f9cf2' // Hedra Character 3 (même modèle que l'app)
const AVATAR_COST_SEC = 1.5 // 1 cr/s lipsync + 0,5 cr/s voix ElevenLabs (barème app)
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
const MONTAGE_PLAN_COST   = 6  // = montageIA (transcription Scribe + plan Claude)
const MONTAGE_RENDER_COST = 2  // = montageRender (MP4 monté par le moteur de rendu)
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
// Accès réservé Pro/Élite (+ developer/owner) ; plafond de crédits dépensés via MCP par 24 h
const ALLOWED_PLANS   = ['pro', 'elite']
const DAILY_CAPS: Record<string, number> = { pro: 100, elite: 200 }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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
type ToolContent = { content: Array<Record<string, unknown>>; isError?: boolean }
const toolText = (t: string): ToolContent => ({ content: [{ type: 'text', text: t }] })
const toolErr = (t: string): ToolContent => ({ content: [{ type: 'text', text: t }], isError: true })

// ── Définition des outils ──
function toolDefs(isOwner: boolean) {
  const tools: Array<Record<string, unknown>> = [
    {
      name: 'get_account',
      description: 'Infos du compte AvatarAds connecté : plan, crédits restants, barème des coûts en crédits.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_image',
      description: `Génère une image IA (moteur AvatarAds, gpt-image) et retourne son URL publique. Coût : ${IMG_COST.standard} crédits en qualité standard, ${IMG_COST.high} en high. La qualité high peut prendre 1 à 2 minutes.`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "Description détaillée de l'image (sujet, style, lumière, cadrage…). Français ou anglais." },
          format: { type: 'string', enum: ['portrait', 'square', 'landscape'], description: 'portrait 9:16 (défaut, idéal TikTok/Reels), square 1:1, landscape 16:9' },
          quality: { type: 'string', enum: ['standard', 'high'], description: `standard (défaut, ${IMG_COST.standard} crédits) ou high (${IMG_COST.high} crédits, plus détaillée)` },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'generate_video',
      description: `Le module EXPRESS d'AvatarAds : génère une vidéo IA (Veo 3.1, audio et dialogues inclus) à partir d'un prompt et optionnellement d'une image de départ. Coût : ${VIDEO_COST_SEC} crédit/seconde, débité au lancement (remboursé si échec). Retourne un job_id — appelle ensuite check_video pour récupérer la vidéo (compte 1 à 3 minutes).`,
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
      name: 'check_video',
      description: "Vérifie l'état d'une génération vidéo lancée avec generate_video et retourne l'URL du MP4 quand elle est prête. Si toujours en cours, rappelle cet outil ~30 secondes plus tard.",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par generate_video.' } },
        required: ['job_id'],
      },
    },
    {
      name: 'generate_avatar_video',
      description: `Génère une VIDÉO AVATAR PARLANT (le Générateur AvatarAds) : voix IA ElevenLabs + lipsync Hedra Character-3 à partir d'un script et optionnellement d'une photo d'avatar. Coût : ${AVATAR_COST_SEC} crédit/seconde (durée estimée depuis le script, max ${AVATAR_MAX_SEC} s), débité au lancement (remboursé si échec). Retourne un job_id — appelle ensuite check_avatar_video (compte 2 à 5 minutes). La vidéo sort SANS sous-titres : pour les sous-titres et effets, ouvrir la vidéo dans l'app.`,
      inputSchema: {
        type: 'object',
        properties: {
          script: { type: 'string', description: `Le texte que l'avatar va dire (français ou anglais). ~${CHARS_PER_SEC} caractères ≈ 1 seconde de vidéo.` },
          avatar_image_url: { type: 'string', description: "URL publique de la photo de l'avatar (optionnel) — ex. une image générée avec generate_image. Sans photo, Hedra invente une personne réaliste." },
          voice: { type: 'string', enum: ['homme', 'femme'], description: 'Voix preset : homme (Daniel, posé) ou femme (Charlotte, chaleureuse). Défaut : homme.' },
          voice_id: { type: 'string', description: "ID de voix ElevenLabs précis (optionnel, prioritaire sur voice) — ex. une voix clonée du compte." },
          aspect_ratio: { type: 'string', enum: ['9:16', '1:1'], description: '9:16 vertical (défaut) ou 1:1 carré.' },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['script'],
      },
    },
    {
      name: 'check_avatar_video',
      description: "Vérifie l'état d'une vidéo avatar lancée avec generate_avatar_video et retourne l'URL du MP4 quand elle est prête. Si toujours en cours, rappelle cet outil ~30 secondes plus tard.",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par generate_avatar_video.' } },
        required: ['job_id'],
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
      description: `Le MONTAGE IA d'AvatarAds : à partir d'un simple AUDIO (voix parlée), le chef d'orchestre transcrit, analyse et génère un plan de montage complet (slides motion-design, zooms, sous-titres mot à mot, bruitages), puis le moteur de rendu serveur produit le MP4 final 1080×1920. Coût : ${MONTAGE_PLAN_COST + MONTAGE_RENDER_COST} crédits, débités au lancement (remboursés si échec). Retourne un job_id — appelle ensuite check_montage (compte 2 à 5 minutes).`,
      inputSchema: {
        type: 'object',
        properties: {
          audio_url: { type: 'string', description: "URL publique de l'audio (voix) : WAV, MP3 ou M4A, 20 Mo max — ex. un audio nettoyé avec clean_audio." },
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
      description: "Vérifie l'état d'un Montage IA lancé avec montage_ia (ou render_montage_plan) et retourne l'URL du MP4 final quand il est prêt. Si toujours en cours, rappelle cet outil ~1 minute plus tard.",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par montage_ia ou render_montage_plan.' } },
        required: ['job_id'],
      },
    },
    {
      name: 'get_montage_plan',
      description: "L'ÉDITEUR via Claude (lecture) : récupère le PLAN DE MONTAGE JSON d'un Montage IA (slides, textes, timings, zooms, bruitages, sous-titres). Modifie ce JSON puis appelle render_montage_plan pour re-rendre la vidéo ajustée. Gratuit.",
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
          plan: { type: 'string', description: 'Le plan de montage complet, en JSON (chaîne) — version modifiée de celui retourné par get_montage_plan.' },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['job_id', 'plan'],
      },
    },
    {
      name: 'list_media',
      description: 'Liste les derniers médias (images et vidéos) générés via Claude sur ce compte, avec leurs URLs publiques.',
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

Barème : image standard ${IMG_COST.standard} crédits · image high ${IMG_COST.high} crédits · vidéo Express ${VIDEO_COST_SEC} crédit/s (4 à 10 s) · vidéo avatar parlant ${AVATAR_COST_SEC} crédit/s (max ${AVATAR_MAX_SEC} s) · nettoyage audio ${CLEAN_COST_PER_MIN} crédit/min · Montage IA ${MONTAGE_PLAN_COST + MONTAGE_RENDER_COST} crédits · re-rendu d'un plan modifié ${MONTAGE_RENDER_COST} crédits.
Recharger / changer de plan : ${APP_URL}`)
}

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

  const userId = String(profile.id)
  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `image ${quality} (${format})`, 'generate_image')
  if (gate) return gate

  // Débit AVANT génération (comme la vidéo) : jamais d'image livrée sans débit réel.
  // Si la génération échoue ensuite, le finally rembourse.
  const bal = await spendCredits(userId, cost)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  let delivered = false
  try {
    let lastErr = 'Erreur génération'
    for (const model of GPT_IMG_MODELS) {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, n: 1, size, quality: quality === 'high' ? 'high' : 'medium', moderation: 'low' }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.error) {
        lastErr = data.error.message || 'Erreur génération'
        if (/model|not found|does not exist|unsupported/i.test(lastErr)) continue // modèle indispo → suivant
        return toolErr('Génération refusée : ' + lastErr) // finally rembourse
      }
      const b64 = data.data?.[0]?.b64_json
      if (!b64) { lastErr = 'Aucune image retournée'; continue }

      const url = await uploadMedia(userId, b64ToBytes(b64), 'png', 'image/png')
      // Trace la dépense (plafond quotidien + suivi d'usage) — seulement après succès
      await svc.from('mcp_jobs').insert({ user_id: userId, kind: 'image', status: 'done', credits_cost: cost, result_url: url })
      delivered = true
      const balTxt = isUnlimited(profile) ? '∞' : String(bal)
      const content: Array<Record<string, unknown>> = []
      if (b64.length < 4_000_000) content.push({ type: 'image', data: b64, mimeType: 'image/png' })
      content.push({ type: 'text', text: `✅ Image générée !\nURL : ${url}\n−${cost} crédits · solde : ${balTxt}` })
      return { content }
    }
    return toolErr('Génération échouée : ' + lastErr) // finally rembourse
  } finally {
    if (!delivered) await refundCredits(userId, cost)
  }
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

async function runGenerateVideo(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!GOOGLE_AI_KEY) return toolErr('Génération vidéo indisponible (configuration serveur incomplète).')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) return toolErr('Le paramètre "prompt" est requis.')
  const duration = Math.min(10, Math.max(4, Number(args.duration_seconds) || 8))
  const aspect = args.aspect_ratio === '16:9' ? '16:9' : '9:16'
  const cost = duration * VIDEO_COST_SEC
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits (${duration} s × ${VIDEO_COST_SEC}), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `vidéo ${duration} s (${aspect}${args.image_url ? ', avec image de départ' : ''})`, 'generate_video')
  if (gate) return gate

  // Image de départ optionnelle
  let image: { bytesBase64Encoded: string; mimeType: string } | null = null
  if (args.image_url) {
    const u = String(args.image_url)
    let parsed: URL | null = null
    try { parsed = new URL(u) } catch { /* invalide */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) return toolErr('image_url doit être une URL http(s) publique.')
    if (isBlockedHost(parsed.hostname)) return toolErr('image_url doit pointer vers une image publique (adresse interne refusée).')
    const r = await fetch(u).catch(() => null)
    if (!r || !r.ok) return toolErr("Impossible de télécharger l'image de départ (image_url).")
    const ct = (r.headers.get('content-type') || '').split(';')[0]
    if (!/^image\/(png|jpe?g|webp)$/.test(ct)) return toolErr('image_url doit pointer vers une image PNG, JPEG ou WebP.')
    const buf = new Uint8Array(await r.arrayBuffer())
    if (buf.length > 10_000_000) return toolErr('Image de départ trop lourde (10 Mo max).')
    let bin = ''
    for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768))
    image = { bytesBase64Encoded: btoa(bin), mimeType: ct }
  }

  // Débit au lancement : le coût Veo est engagé dès le start (remboursé si échec)
  const bal = await spendCredits(userId, cost)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits (${duration} s × ${VIDEO_COST_SEC}). Recharge sur ${APP_URL}`)

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
  if (!opName) {
    await refundCredits(userId, cost)
    return toolErr(`Lancement vidéo échoué (crédits remboursés) : ${lastErr}`)
  }

  const { data: job, error } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'video', op_name: opName, credits_cost: cost }).select('id').single()
  if (error || !job) {
    await refundCredits(userId, cost)
    return toolErr('Erreur serveur au suivi du job (crédits remboursés) — réessaie.')
  }
  return toolText(
    `🎬 Génération vidéo lancée ! (${duration} s, ${aspect}, −${cost} crédits)
job_id : ${job.id}
Appelle check_video avec ce job_id dans environ 1 minute (la génération prend 1 à 3 minutes).`)
}

async function runCheckVideo(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const userId = String(profile.id)
  const { data: job } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).eq('kind', 'video').maybeSingle()
  if (!job) return toolErr('Job introuvable sur ce compte (pour une vidéo avatar, utilise check_avatar_video).')
  if (job.status === 'done') return toolText(`✅ Vidéo prête !\nURL : ${job.result_url}`)
  if (job.status === 'failed') return toolErr(`Génération échouée : ${job.error || 'erreur inconnue'} (crédits remboursés).`)

  // Poll Google jusqu'à ~40 s dans cet appel, puis on rend la main à Claude
  let done: Record<string, unknown> | null = null
  let opErr = ''
  for (let i = 0; i < 9; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5000))
    const res = await veoFetch(`/v1beta/${job.op_name}`, { method: 'GET' })
    if (!res.ok) continue
    const data = await res.json().catch(() => ({}))
    if (data.done) {
      if (data.error) opErr = data.error.message || 'Génération refusée par Google'
      else done = data
      break
    }
  }
  if (opErr) {
    await failAndRefund(userId, job, opErr) // idempotent : rembourse une seule fois
    return toolErr(`Génération échouée : ${opErr}. Les ${job.credits_cost} crédits ont été remboursés.`)
  }
  if (!done) return toolText('⏳ Toujours en cours — rappelle check_video dans ~30 secondes.')

  // Vidéo terminée : base64 direct ou URI à télécharger (mêmes chemins de réponse que l'app)
  const { b64, uri } = extractVideo(done)
  const bytes = await fetchVideoBytes(b64, uri)
  if (!bytes) {
    await failAndRefund(userId, job, 'video_missing')
    return toolErr('Vidéo terminée mais introuvable dans la réponse — crédits remboursés, relance generate_video.')
  }
  const url = await deliverVideo(userId, job, bytes) // claim atomique : pas de double upload
  return url
    ? toolText(`✅ Vidéo prête !\nURL : ${url}`)
    : toolText('⏳ Presque prête — rappelle check_video dans quelques secondes.')
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
async function fetchUserFile(rawUrl: string, maxBytes: number, ctRegex: RegExp, label: string):
  Promise<{ bytes: Uint8Array; contentType: string } | string> {
  let parsed: URL | null = null
  try { parsed = new URL(rawUrl) } catch { /* invalide */ }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return `${label} doit être une URL http(s) publique.`
  if (isBlockedHost(parsed.hostname)) return `${label} doit pointer vers un fichier public (adresse interne refusée).`
  const r = await fetch(rawUrl).catch(() => null)
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
  if (!HEDRA_API_KEY || !ELEVEN_API_KEY) return toolErr('Génération avatar indisponible (configuration serveur incomplète).')
  const script = String(args.script || '').trim()
  if (!script) return toolErr('Le paramètre "script" est requis.')
  const maxChars = AVATAR_MAX_SEC * CHARS_PER_SEC
  if (script.length > maxChars) {
    return toolErr(`Script trop long (${script.length} caractères) : maximum ~${maxChars} caractères (≈ ${AVATAR_MAX_SEC} s de vidéo). Raccourcis le script.`)
  }
  const estSec = Math.min(AVATAR_MAX_SEC, Math.max(3, Math.ceil(script.length / CHARS_PER_SEC)))
  const cost = Math.ceil(estSec * AVATAR_COST_SEC)
  const aspect = args.aspect_ratio === '1:1' ? '1:1' : '9:16'
  const voiceId = String(args.voice_id || '').trim() || MCP_VOICES[String(args.voice || 'homme')] || MCP_VOICES.homme
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits (~${estSec} s × ${AVATAR_COST_SEC}), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost,
    `vidéo avatar parlant ~${estSec} s (${aspect}${args.avatar_image_url ? ', avec photo' : ''}, voix ${args.voice_id ? 'personnalisée' : (args.voice || 'homme')})`,
    'generate_avatar_video')
  if (gate) return gate

  // Photo d'avatar optionnelle — téléchargée AVANT le débit
  let imgFile: { bytes: Uint8Array; contentType: string } | null = null
  if (args.avatar_image_url) {
    const got = await fetchUserFile(String(args.avatar_image_url), 10_000_000, /^image\/(png|jpe?g|webp)$/, "la photo d'avatar (avatar_image_url)")
    if (typeof got === 'string') return toolErr(got)
    imgFile = got
  }

  // Débit au lancement (remboursé si échec avant la création du job)
  const bal = await spendCredits(userId, cost)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  let launched = false
  try {
    // 1) Voix ElevenLabs (mêmes réglages que l'app)
    const tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: script, model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
      }),
    })
    if (!tts.ok) {
      const err = await tts.text().catch(() => '')
      return toolErr(`Voix échouée (ElevenLabs ${tts.status})${/voice/i.test(err) ? ' — voice_id introuvable ?' : ''} — crédits remboursés.`)
    }
    const audioBytes = new Uint8Array(await tts.arrayBuffer())

    // 2) Assets Hedra (audio obligatoire, image optionnelle)
    const audioId = await hedraUploadAsset('audio', 'voice.mp3', audioBytes, 'audio/mpeg')
    if (!audioId) return toolErr('Upload audio vers Hedra échoué — crédits remboursés, réessaie.')
    let imageId: string | null = null
    if (imgFile) {
      imageId = await hedraUploadAsset('image', 'avatar.jpg', imgFile.bytes, imgFile.contentType)
      if (!imageId) return toolErr("Upload de la photo d'avatar vers Hedra échoué — crédits remboursés, réessaie.")
    }

    // 3) Lancer la génération (même payload que l'app)
    const genBody: Record<string, unknown> = {
      type: 'video',
      ai_model_id: HEDRA_MODEL_ID,
      audio_id: audioId,
      generated_video_inputs: {
        text_prompt: 'A person talking naturally to camera, UGC style, authentic, direct gaze, precise accurate lip-sync, mouth movements exactly matching every syllable and pause of the audio, clear articulation, static background, no camera movement, background objects completely still, no scene motion',
        aspect_ratio: aspect,
        character_orientation: 'video',
        // 1080p natif : Character-3 le rend sans surcoût (7 crédits Hedra par
        // seconde quelle que soit la définition, grille du 27/07/2026). Le 720p
        // était arbitraire — il bridait toutes les vidéos avatar du produit.
        resolution: '1080p',
      },
    }
    if (imageId) genBody.start_keyframe_id = imageId
    const genRes = await hedraFetch('/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(genBody),
    })
    if (!genRes.ok) {
      const err = await genRes.text().catch(() => '')
      return toolErr(`Lancement Hedra échoué (${genRes.status}${err ? ' — ' + err.slice(0, 120) : ''}) — crédits remboursés.`)
    }
    const gen = await genRes.json().catch(() => ({}))
    if (!gen.id) return toolErr('Hedra n\'a pas retourné d\'ID de génération — crédits remboursés.')

    const { data: job, error } = await svc.from('mcp_jobs')
      .insert({ user_id: userId, kind: 'avatar', op_name: String(gen.id), credits_cost: cost }).select('id').single()
    if (error || !job) return toolErr('Erreur serveur au suivi du job — crédits remboursés, réessaie.')
    launched = true
    return toolText(
      `🎬 Vidéo avatar lancée ! (~${estSec} s, ${aspect}, −${cost} crédits)
job_id : ${job.id}
Appelle check_avatar_video avec ce job_id dans environ 1 minute (la génération prend 2 à 5 minutes).
💡 La vidéo sort sans sous-titres : pour sous-titres, effets et montage, ouvre-la dans ${APP_URL}`)
  } finally {
    if (!launched) await refundCredits(userId, cost)
  }
}

async function runCheckAvatarVideo(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const userId = String(profile.id)
  const { data: job } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).eq('kind', 'avatar').maybeSingle()
  if (!job) return toolErr('Job avatar introuvable sur ce compte.')
  if (job.status === 'done') return toolText(`✅ Vidéo avatar prête !\nURL : ${job.result_url}`)
  if (job.status === 'failed') return toolErr(`Génération échouée : ${job.error || 'erreur inconnue'} (crédits remboursés).`)

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
      ? toolText(`✅ Clip OmniHuman prêt !\nURL : ${url}`)
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
  if (!videoUrl) return toolText(`⏳ Toujours en cours${lastProgress ? ` (${lastProgress} %)` : ''} — rappelle check_avatar_video dans ~30 secondes.`)

  // Ré-héberge le MP4 (l'URL Hedra expire) puis livre — claim atomique anti-doublon
  const vRes = await fetch(videoUrl).catch(() => null)
  if (!vRes || !vRes.ok) return toolText('⏳ Vidéo prête mais téléchargement en cours — rappelle check_avatar_video dans quelques secondes.')
  const bytes = new Uint8Array(await vRes.arrayBuffer())
  const url = await deliverVideo(userId, job, bytes)
  return url
    ? toolText(`✅ Vidéo avatar prête !\nURL : ${url}\n💡 Pour ajouter sous-titres et effets : ${APP_URL}`)
    : toolText('⏳ Presque prête — rappelle check_avatar_video dans quelques secondes.')
}

// ── Nettoyage audio (ElevenLabs Voice Isolator) ──
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
    const fd = new FormData()
    fd.append('audio', new Blob([got.bytes as unknown as BlobPart], { type: got.contentType }), 'input.mp3')
    const iso = await fetch('https://api.elevenlabs.io/v1/audio-isolation', {
      method: 'POST', headers: { 'xi-api-key': ELEVEN_API_KEY }, body: fd,
    })
    if (!iso.ok) {
      const err = await iso.text().catch(() => '')
      return toolErr(`Nettoyage échoué (ElevenLabs ${iso.status}${err ? ' — ' + err.slice(0, 120) : ''}) — crédits remboursés.`)
    }
    const cleaned = new Uint8Array(await iso.arrayBuffer())
    const url = await uploadMedia(userId, cleaned, 'mp3', 'audio/mpeg')
    await svc.from('mcp_jobs').insert({ user_id: userId, kind: 'audio_clean', status: 'done', credits_cost: cost, result_url: url })
    delivered = true
    const balTxt = isUnlimited(profile) ? '∞' : String(bal)
    return toolText(`✅ Audio nettoyé (voix isolée, bruit supprimé) !\nURL : ${url}\n−${cost} crédit${cost > 1 ? 's' : ''} · solde : ${balTxt}`)
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
          prompt: 'A person talking naturally to camera, UGC style, authentic, direct gaze, precise accurate lip-sync, mouth movements exactly matching every syllable and pause of the audio, clear articulation, static background, no camera movement, background objects completely still, no scene motion',
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
            text_prompt: 'A person talking naturally to camera, UGC style, authentic, direct gaze, precise accurate lip-sync, mouth movements exactly matching every syllable and pause of the audio, clear articulation, static background, no camera movement, background objects completely still, no scene motion',
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
  const durRaw = Number(args.duration_seconds) > 0 ? Number(args.duration_seconds) : estimateAudioSeconds(got.bytes, got.contentType)
  // format court assumé : au-delà de 90 s le montage perd son rythme (et coûte cher à rendre)
  if (durRaw > 90.5) {
    return toolErr(`Audio trop long (~${Math.round(durRaw)} s) : le Montage IA accepte 90 secondes maximum. Raccourcis l'audio (ou découpe-le en plusieurs vidéos courtes) puis relance.`)
  }
  const durEst = Math.max(5, durRaw)
  const cost = MONTAGE_PLAN_COST + MONTAGE_RENDER_COST
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `Montage IA ~${Math.round(durEst)} s (style ${style})`, 'montage_ia')
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
      // 1) chef d'orchestre — clé anon : passe le gateway, sans lire la mémoire de marque
      const ext = /wav/.test(got.contentType) ? 'wav' : /mp4|m4a|aac/.test(got.contentType) ? 'm4a' : 'mp3'
      const fd = new FormData()
      fd.append('audio', new File([got.bytes as unknown as BlobPart], 'audio.' + ext, { type: got.contentType }))
      fd.append('duration', String(Math.round(durEst * 100) / 100))
      if (script) fd.append('script', script)
      if (brief) fd.append('brief', brief)
      fd.append('options', JSON.stringify({ lang: 'fr' }))
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

      // 3) job de rendu, puis lien op_name → le job devient suivable de bout en bout
      const { data: rj, error: rjErr } = await svc.from('render_jobs')
        .insert({ user_id: userId, status: 'queued', plan, input_video: inputPath, assets: [] })
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
💡 Une fois prêt : get_montage_plan → ajuste le plan → render_montage_plan pour une variante.`)
}

async function runCheckMontage(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const userId = String(profile.id)
  const { data: job } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).eq('kind', 'montage').maybeSingle()
  if (!job) return toolErr('Job montage introuvable sur ce compte.')
  if (job.status === 'done') return toolText(`✅ Montage prêt !\nURL : ${job.result_url}`)
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
    return toolText("⏳ En file d'attente du moteur de rendu — rappelle check_montage dans ~1 minute.")
  }
  if (rj.status === 'rendering') return toolText('🎬 Rendu en cours — rappelle check_montage dans ~1 minute.')
  if (rj.status === 'done' && rj.output_url) {
    // ré-héberge le MP4 en public (render-media est privé) — claim atomique anti-doublon
    const dl = await svc.storage.from('render-media').download(String(rj.output_url))
    if (dl.error || !dl.data) return toolText('⏳ Presque prêt — rappelle check_montage dans quelques secondes.')
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const url = await deliverVideo(userId, job, bytes)
    return url
      ? toolText(`✅ Montage prêt !\nURL : ${url}\n💡 Pour ajuster : get_montage_plan → modifie → render_montage_plan. Ou ouvre l'Éditeur sur ${APP_URL}`)
      : toolText('⏳ Presque prêt — rappelle check_montage dans quelques secondes.')
  }
  return toolText(`⏳ Statut : ${rj.status} — rappelle check_montage dans ~1 minute.`)
}

async function runGetMontagePlan(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const { data: job } = await svc.from('mcp_jobs').select('op_name')
    .eq('id', jobId).eq('user_id', String(profile.id)).eq('kind', 'montage').maybeSingle()
  if (!job) return toolErr('Job montage introuvable sur ce compte.')
  const { data: rj } = await svc.from('render_jobs').select('plan').eq('id', job.op_name).maybeSingle()
  if (!rj?.plan) return toolErr('Plan introuvable pour ce job.')
  return toolText(
    `Plan de montage du job ${jobId} (JSON). Modifie ce qu'il faut (textes, timings, slides, zooms, sfx…) en gardant la structure, puis appelle render_montage_plan avec le JSON complet :\n${JSON.stringify(rj.plan)}`)
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
    .list(userId, { limit: 20, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) return toolErr('Erreur lecture médias : ' + error.message)
  if (!data || !data.length) return toolText('Aucun média généré via Claude pour le moment.')
  const lines = data.map((f) =>
    `- ${f.name} (${f.created_at ? new Date(f.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—'}) : ${SUPABASE_URL}/storage/v1/object/public/mcp-media/${userId}/${f.name}`)
  return toolText(`Derniers médias générés :\n${lines.join('\n')}`)
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
      require_confirm: data?.require_confirm ?? true, plan_allowed: planAllowed,
    })
  }
  if (body.action === 'create') {
    if (!planAllowed) return json(403, { error: 'plan_required' }) // réservé Pro/Élite
    const raw = new Uint8Array(24)
    crypto.getRandomValues(raw)
    const key = 'aa_' + Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('')
    await svc.from('mcp_keys').update({ revoked_at: new Date().toISOString() }).eq('user_id', user.id).is('revoked_at', null)
    const { error: insErr } = await svc.from('mcp_keys').insert({ user_id: user.id, key_hash: await hashKey(key) })
    if (insErr) return json(500, { error: 'server_error' })
    return json(200, { ok: true, url: `${SUPABASE_URL}/functions/v1/mcp/${key}` })
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

// ── Endpoint MCP ──
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(req.url)
  const segs = url.pathname.split('/').filter(Boolean) // ['mcp', '<clé>' | 'key']

  if (segs[1] === 'key') {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    return await handleKeyManagement(req)
  }

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
  if (req.method === 'GET') return json(405, { error: 'method_not_allowed' })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // Authentification par clé personnelle (URL, ?key= ou Authorization: Bearer)
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  const key = segs[1] || url.searchParams.get('key') || (bearer.startsWith('aa_') ? bearer : '')
  if (!key || !key.startsWith('aa_')) {
    return json(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Clé AvatarAds manquante — génère-la dans Mon compte sur ' + APP_URL } })
  }
  const { data: keyRow } = await svc.from('mcp_keys').select('id, user_id, require_confirm')
    .eq('key_hash', await hashKey(key)).is('revoked_at', null).maybeSingle()
  if (!keyRow) {
    return json(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Clé AvatarAds invalide ou révoquée — génère-en une nouvelle dans Mon compte sur ' + APP_URL } })
  }
  bg((async () => { await svc.from('mcp_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id) })())

  const { data: profile } = await svc.from('profiles').select(
    'id, email, first_name, plan, credits_remaining, is_owner',
  ).eq('id', keyRow.user_id).maybeSingle()
  if (!profile) return json(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Compte introuvable.' } })

  // Accès réservé Pro/Élite (clé créée puis plan rétrogradé → on bloque à l'usage aussi)
  const planKey = String(profile.plan || '').toLowerCase()
  const planAllowed = isUnlimited(profile) || ALLOWED_PLANS.includes(planKey)
  const ctx: ToolCtx = {
    requireConfirm: keyRow.require_confirm !== false,
    dailyCap: isUnlimited(profile) ? null : (DAILY_CAPS[planKey] ?? 100),
  }

  let msg: Record<string, unknown>
  try { msg = await req.json() } catch { return rpcError(null, -32700, 'Parse error') }
  if (Array.isArray(msg)) return rpcError(null, -32600, 'Batch non supporté')
  const id = 'id' in msg ? msg.id : undefined
  const method = String(msg.method || '')
  const params = (msg.params || {}) as Record<string, unknown>

  // Notifications (pas d'id) → accusé de réception sans corps
  if (id === undefined) return new Response(null, { status: 202, headers: cors })

  try {
    if (method === 'initialize') {
      const requested = String(params.protocolVersion || '')
      const supported = ['2025-06-18', '2025-03-26', '2024-11-05']
      return rpcResult(id, {
        protocolVersion: supported.includes(requested) ? requested : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        // `title`, `websiteUrl` et `icons` : ce que les clients MCP affichent
        // dans leur liste de connecteurs (logo + nom lisible au lieu d'un « A »)
        serverInfo: {
          name: 'AvatarAds',
          title: 'AvatarAds',
          version: '1.4.1',
          websiteUrl: 'https://avatarads.fr',
          icons: [
            { src: 'https://avatarads.fr/favicon.svg', mimeType: 'image/svg+xml' },
            { src: 'https://avatarads.fr/assets/avatarads-logo.png', mimeType: 'image/png', sizes: ['512x512'] },
          ],
        },
        instructions: "Serveur MCP AvatarAds (avatarads.fr) — les modules de l'app pilotés depuis Claude : Images IA = generate_image · Express = generate_video puis check_video · Générateur (avatar parlant voix+lipsync) = generate_avatar_video puis check_avatar_video · Nettoyage audio = clean_audio · MONTAGE IA (audio → vidéo motion-design complète) = montage_ia puis check_montage · Éditeur = get_montage_plan (lire le plan) et render_montage_plan (re-rendre le plan modifié). Tout consomme les crédits du compte connecté. Avant toute génération, un devis en crédits peut être retourné : montre-le à l'utilisateur et attends son accord avant de rappeler l'outil avec confirm: true. get_account donne le solde.",
      })
    }
    if (method === 'ping') return rpcResult(id, {})
    if (method === 'tools/list') return rpcResult(id, { tools: toolDefs(isUnlimited(profile)) })
    if (method === 'resources/list') return rpcResult(id, { resources: [] })
    if (method === 'prompts/list') return rpcResult(id, { prompts: [] })
    if (method === 'tools/call') {
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
      else return rpcError(id, -32602, `Outil inconnu : ${name}`)
      return rpcResult(id, out)
    }
    return rpcError(id, -32601, `Méthode non supportée : ${method}`)
  } catch (e) {
    console.error('mcp error:', e)
    return rpcError(id, -32603, 'Erreur serveur : ' + String((e as Error)?.message || e))
  }
})
