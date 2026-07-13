import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Serveur MCP AvatarAds ↔ Claude (#73) ──
// Protocole MCP « Streamable HTTP » (JSON-RPC sur POST, réponses JSON, sans état).
// Compatible connecteurs personnalisés claude.ai et `claude mcp add --transport http`.
//
//   POST /mcp/key            (JWT utilisateur)  → gérer sa clé : status / create / revoke
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

const APP_URL         = 'https://avatarads.fr/app/'
const IMG_COST        = { standard: 3, high: 5 }
const VIDEO_COST_SEC  = 1 // Veo 3.1 Lite = tarif Express Lite
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
      description: `Lance la génération d'une vidéo IA (Veo 3.1, audio inclus) à partir d'un prompt et optionnellement d'une image de départ. Coût : ${VIDEO_COST_SEC} crédit/seconde, débité au lancement (remboursé si échec). Retourne un job_id — appelle ensuite check_video pour récupérer la vidéo (compte 1 à 3 minutes).`,
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

Barème : image standard ${IMG_COST.standard} crédits · image high ${IMG_COST.high} crédits · vidéo ${VIDEO_COST_SEC} crédit/s (4 à 10 s).
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

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `image ${quality} (${format})`, 'generate_image')
  if (gate) return gate

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
      return toolErr('Génération refusée : ' + lastErr)
    }
    const b64 = data.data?.[0]?.b64_json
    if (!b64) { lastErr = 'Aucune image retournée'; continue }

    const url = await uploadMedia(String(profile.id), b64ToBytes(b64), 'png', 'image/png')
    const bal = await spendCredits(String(profile.id), cost)
    // Trace la dépense (sert au plafond quotidien et au suivi d'usage)
    await svc.from('mcp_jobs').insert({ user_id: String(profile.id), kind: 'image', status: 'done', credits_cost: cost, result_url: url })
    const balTxt = isUnlimited(profile) ? '∞' : (bal === null || bal === -1 ? '(voir get_account)' : String(bal))
    const content: Array<Record<string, unknown>> = []
    if (b64.length < 4_000_000) content.push({ type: 'image', data: b64, mimeType: 'image/png' })
    content.push({ type: 'text', text: `✅ Image générée !\nURL : ${url}\n−${cost} crédits · solde : ${balTxt}` })
    return { content }
  }
  return toolErr('Génération échouée : ' + lastErr)
}

async function veoFetch(path: string, init?: RequestInit): Promise<Response> {
  const sep = path.includes('?') ? '&' : '?'
  return await fetch(`https://generativelanguage.googleapis.com${path}${sep}key=${GOOGLE_AI_KEY}`, init)
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
    if (!/^https?:\/\//i.test(u)) return toolErr('image_url doit être une URL http(s) publique.')
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
  const { data: job } = await svc.from('mcp_jobs').select('*').eq('id', jobId).eq('user_id', userId).maybeSingle()
  if (!job) return toolErr('Job introuvable sur ce compte.')
  if (job.status === 'done') return toolText(`✅ Vidéo prête !\nURL : ${job.result_url}`)
  if (job.status === 'failed') return toolErr(`Génération échouée : ${job.error || 'erreur inconnue'} (crédits remboursés).`)

  // Poll Google jusqu'à ~45 s dans cet appel, puis on rend la main à Claude
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
    if (!job.refunded) await refundCredits(userId, job.credits_cost)
    await svc.from('mcp_jobs').update({ status: 'failed', error: opErr, refunded: true, updated_at: new Date().toISOString() }).eq('id', jobId)
    return toolErr(`Génération échouée : ${opErr}. Les ${job.credits_cost} crédits ont été remboursés.`)
  }
  if (!done) return toolText('⏳ Toujours en cours — rappelle check_video dans ~30 secondes.')

  // Vidéo terminée : base64 direct ou URI à télécharger (mêmes chemins de réponse que l'app)
  const resp = (done as Record<string, any>).response || {}
  const b64 = resp?.predictions?.[0]?.bytesBase64Encoded
    || resp?.generateVideoResponse?.generatedSamples?.[0]?.video?.bytesBase64Encoded || null
  const uri = b64 ? null : (resp?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    || resp?.predictions?.[0]?.videoUri || resp?.predictions?.[0]?.video?.uri || null)
  let bytes: Uint8Array | null = null
  if (b64) bytes = b64ToBytes(b64)
  else if (uri) {
    const sep = String(uri).includes('?') ? '&' : '?'
    const dl = await fetch(`${uri}${sep}key=${GOOGLE_AI_KEY}`).catch(() => null)
    if (dl && dl.ok) bytes = new Uint8Array(await dl.arrayBuffer())
  }
  if (!bytes) {
    if (!job.refunded) await refundCredits(userId, job.credits_cost)
    await svc.from('mcp_jobs').update({ status: 'failed', error: 'video_missing', refunded: true, updated_at: new Date().toISOString() }).eq('id', jobId)
    return toolErr('Vidéo terminée mais introuvable dans la réponse — crédits remboursés, relance generate_video.')
  }
  const url = await uploadMedia(userId, bytes, 'mp4', 'video/mp4')
  await svc.from('mcp_jobs').update({ status: 'done', result_url: url, updated_at: new Date().toISOString() }).eq('id', jobId)
  return toolText(`✅ Vidéo prête !\nURL : ${url}`)
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
  svc.from('mcp_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id).then(() => {})

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
        serverInfo: { name: 'AvatarAds', version: '1.0.0' },
        instructions: "Serveur MCP AvatarAds (avatarads.fr) : génère des images (generate_image) et des vidéos IA (generate_video puis check_video) avec les crédits du compte connecté. get_account donne le solde.",
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
      let out: ToolContent
      if (name === 'get_account') out = await runGetAccount(profile)
      else if (name === 'generate_image') out = await runGenerateImage(profile, args, ctx)
      else if (name === 'generate_video') out = await runGenerateVideo(profile, args, ctx)
      else if (name === 'check_video') out = await runCheckVideo(profile, args)
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
