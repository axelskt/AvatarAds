// Supabase Edge Function — OpenAI API proxy
// La clé OpenAI est stockée côté serveur (secret Supabase OPENAI_API_KEY).
//
// Endpoints (via ?path=) — ALLOWLIST STRICTE :
//   POST /v1/chat/completions        → GPT-4o (JSON)              [helper, plafonné]
//   POST /v1/audio/transcriptions    → Whisper (multipart)        [helper, plafonné]
//   POST /v1/images/generations      → gpt-image                  [FACTURANT, SYNCHRONE]
//   POST /v1/images/edits            → gpt-image edits (multipart) [FACTURANT, SYNCHRONE]
//
// Sécurité (audit 05/09) : session obligatoire ; `?path=` résolu contre la base ; appels facturants =
// plafond + preuve de débit + RÉSERVATION (draw le coût de l'op x-aa-op, settle à la livraison).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate, userPlan, applyReservation, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp, wantsNanoChain, chainCreditAdd, CHAIN_NANO_COST, wantsOmniStart, omniStartAdd, omniStartClaim, omniStartDone, omniStartFail, omniStartFreeDone, svc } from '../_shared/guard.ts'
import { lireWav, lireMp3, dureeAudioAutres } from '../_shared/lipsync-audio.ts'
import { dureeMp4Octets } from '../_shared/mp4-duree.ts'

const OPENAI_BASE = 'https://api.openai.com'
const ALLOW = /^\/v1\/(chat\/completions|audio\/transcriptions|images\/(generations|edits))$/
const BILLABLE = /^\/v1\/images\/(generations|edits)$/
// Endpoints « helper » LLM (chat/completions) : NON facturants (helperGate = rate-limit seul, aucun crédit) → un compte
// pouvait relayer un modèle/prompt ARBITRAIRE vers la clé OpenAI du proprio (drain de coût, audit chaînes 15/09). On borne
// le COÛT par appel : allowlist de modèle (l'app n'utilise que ceux-ci ; hors liste → coercé vers le moins cher) + plafond tokens.
const OPENAI_HELPER_MODELS = new Set(['gpt-4o', 'gpt-4o-mini'])
const OPENAI_HELPER_MAX_TOKENS = 4096
// Audit 28/09 : champs d'image RELAYÉS = liste fermée (un champ annexe comme input_fidelity faisait coûter plus que le tirage) ;
// fichiers bornés en nombre et en taille ; helper chat : n = 1, sortie plafonnée, entrée bornée, quota réduit pour le plan Free.
const IMG_TEXT_ALLOW = new Set(['prompt', 'background', 'output_format', 'output_compression', 'moderation', 'user'])
const IMG_MAX_FILES = 8, IMG_MAX_FILE_BYTES = 25_000_000, IMG_MAX_PROMPT = 32_000
const HELPER_MAX_BODY = 100_000
const imgCost = (q: string) => q === 'low' ? 1 : q === 'high' ? 5 : 3   // gpt-image : low 1 / medium 3 / high 5
// Images facturantes (relecture du 24/09/2026) : ce qui est FACTURÉ est exactement ce qui part chez OpenAI. Modèle et
// taille bornés à ce que l'app envoie ; qualité hors low/medium/high (absente, auto, xhigh, max) → medium, ÉCRITE dans la
// requête ; n borné à 1-4 ; un champ texte en double n'est transmis qu'une fois (la valeur facturée).
const IMG_MODELS = new Set(['gpt-image-2.5-flare', 'gpt-image-2'])
const IMG_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024', '1152x2048', 'auto'])
const IMG_QUALITIES = new Set(['low', 'medium', 'high'])
function normImage(p: Record<string, unknown>): { error: string } | { fields: Record<string, string>, q: string, n: number } {
  const model = String(p.model ?? '')
  if (!IMG_MODELS.has(model)) return { error: 'modèle d’image non autorisé' }
  const fields: Record<string, string> = { model }
  if (p.size != null) {
    const size = String(p.size)
    if (!IMG_SIZES.has(size)) return { error: 'taille d’image non autorisée' }
    fields.size = size
  }
  const q = IMG_QUALITIES.has(String(p.quality)) ? String(p.quality) : 'medium'
  const n = Math.min(4, Math.max(1, parseInt(String(p.n ?? '1')) || 1))
  fields.quality = q
  fields.n = String(n)
  return { fields, q, n }
}

// Audit 04/10 (AUD-1) : Whisper est gratuit pour le client (0 crédit) mais payé à la minute d'audio (0,006 $/min). Le serveur
// ne contrôlait que le plan, la fréquence et la taille : un Opus à ~6 kbit/s fait plusieurs heures dans 25 Mo. Désormais :
//   • champs RELAYÉS = ceux de l'app (whisperTranscribe, _expBurnSubs, expressWhisper) ; modèle imposé ; verbose_json imposé
//     (l'app ne demande que lui, et sa `duration` = la durée facturée par OpenAI) ; un seul fichier ≤ 25 Mo (limite OpenAI) ;
//   • durée MESURÉE avant l'envoi quand le format le permet (WAV PCM, MP3 trame par trame, MP4 / M4A / MOV, et — suite
//     AUD-1 — FLAC, Ogg Opus, WebM Opus, AAC brut par dureeAudioAutres : durée DÉCODÉE, jamais déclarée) : au-delà de
//     90 min → refus (l'app n'envoie jamais plus de ~70 min : 24 Mo d'AAC 48 kbit/s) ;
//   • quota quotidien de minutes par compte (300 min, RPC transcription_take / transcription_add, migration 20261004030000),
//     owner / developer exemptés. Format encore non mesurable ici (Ogg / WebM Vorbis, conteneur inhabituel…) : accepté
//     (aucun refus d'un fichier d'utilisateur), réservé pour une durée plausible (16 kbit/s, au plus 90 min) puis corrigé
//     par la `duration` renvoyée → un usage anormal est coupé dès l'appel suivant. Hoquet DB ou RPC absente (migration pas
//     encore appliquée) → laisser passer, comme rate_hit.
const WHISPER_MAX_BYTES = 25 * 1024 * 1024, WHISPER_MAX_PROMPT = 2000
const WHISPER_GRAINS = new Set(['word', 'segment'])
const WHISPER_MAX_S = 90 * 60, WHISPER_JOUR_S = 300 * 60, WHISPER_OCTETS_PAR_S = 2000   // 16 kbit/s : réservation d'un format non mesuré
const minutes = (sec: number) => Math.max(1, Math.round(sec / 60))
// Durée d'un audio / vidéo entier en mémoire. null = non mesurable ici (OpenAI, lui, le décodera peut-être).
function dureeAudio(b: Uint8Array): number | null {
  try {
    const t4 = (o: number) => o + 4 <= b.length ? String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) : ''
    if (t4(0) === 'RIFF' && t4(8) === 'WAVE') {
      const w = lireWav(b)
      return w && w.sr > 0 && w.blockAlign > 0 ? Math.floor(w.dataLen / w.blockAlign) / w.sr : null
    }
    if (t4(4) === 'ftyp') { const s = dureeMp4Octets(b); return s != null && s > 0 ? s : null }
    // Audit 04/10 (AUD-1, suite) : FLAC, Ogg Opus (notes vocales), WebM Opus (enregistreur / capture de Chrome), AAC brut —
    // trames réellement décodables comptées par dureeAudioAutres (_shared/lipsync-audio.ts, chantier MCP-4) ; < 90 % du
    // fichier reconnu → null (non mesurable). Conteneur reconnu à sa signature : mesuré directement, sans la recherche de
    // trames MP3 sur tout le fichier (~0,3 s pour 60 Mo).
    const conteneur = t4(0) === 'OggS' || t4(0) === 'fLaC' || (b.length >= 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3)
    if (conteneur) { const a = dureeAudioAutres(b); return a && a.sec > 0 ? a.sec : null }
    const m = lireMp3(b)
    if (m && m.sec > 0) return m.sec
    // ID3 suivi de FLAC, AAC brut (ADTS)
    const a = dureeAudioAutres(b)
    return a && a.sec > 0 ? a.sec : null
  } catch { return null }
}
// Réserve `secs` sur le quota du jour. false = quota atteint. Hoquet / RPC absente → true.
async function quotaWhisper(uid: string, secs: number): Promise<boolean> {
  try {
    const { data, error } = await svc().rpc('transcription_take', { p_user: uid, p_kind: 'whisper', p_secs: Math.max(0, Math.ceil(secs || 0)), p_max: WHISPER_JOUR_S })
    if (error) { console.warn('[whisper] quota illisible (laisse passer):', error.message); return true }
    return typeof data === 'number' ? data >= 0 : true
  } catch { return true }
}
// Corrige le compteur du jour (durée réelle connue après coup, ou réservation rendue sur échec). Best-effort.
async function ajusterWhisper(uid: string, secs: number): Promise<void> {
  const s = Math.max(-86400, Math.min(86400, Math.round(secs || 0)))
  if (!s) return
  try {
    const { error } = await svc().rpc('transcription_add', { p_user: uid, p_kind: 'whisper', p_secs: s })
    if (error) console.warn('[whisper] ajustement du quota non noté:', error.message)
  } catch { /* best-effort */ }
}

// Audit 04/10 (EXP-2) : réclamation de l'image de départ d'Express AVEC son palier (omni_start_claim_tier, migration
// 20261004030000). Une relance gratuite met son prix de côté (rendu si elle échoue, déduit de la vidéo sinon) et ne dépasse
// jamais le palier de l'image payée. Fonction SQL absente (migration pas encore appliquée) → réclamation d'avant ; autre
// erreur → 'paid' (tirage normal), comme guard.omniStartClaim.
async function claimStart(uid: string, op: string, cost: number): Promise<{ mode: 'paid' | 'free' | 'deny'; hold: number }> {
  try {
    const { data, error } = await svc().rpc('omni_start_claim_tier', { p_user: uid, p_op: op, p_cost: Math.ceil(cost) })
    if (!error && typeof data === 'string') {
      if (data === 'deny') return { mode: 'deny', hold: 0 }
      const f = /^free:(\d+)$/.exec(data)
      return f ? { mode: 'free', hold: Number(f[1]) } : { mode: 'paid', hold: 0 }
    }
    if (error && /PGRST202|42883|could not find the function|does not exist/i.test(`${(error as { code?: string }).code || ''} ${error.message || ''}`)) {
      return { mode: await omniStartClaim(uid, op), hold: 0 }
    }
    if (error) console.warn('omni_start_claim_tier erreur (tirage normal):', error.message)
  } catch { /* tirage normal */ }
  return { mode: 'paid', hold: 0 }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return jsonRes(405, { error: 'method_not_allowed' })

  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.isService && !auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })

  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!openaiKey) { console.error('OPENAI_API_KEY manquante'); return jsonRes(500, { error: 'Génération d’images momentanément indisponible — réessaie plus tard' }) }

  const url = new URL(req.url)
  const up = safeUpstream(OPENAI_BASE, url.searchParams.get('path') ?? '/v1/chat/completions', ALLOW)
  if (!up.ok) return jsonRes(400, { error: 'path refusé : ' + up.reason })
  const bare = new URL(up.url).pathname
  const isBillable = BILLABLE.test(bare)
  const gated = !auth.isService && !!auth.userId
  const uid = auth.userId as string
  const isTranscribe = bare.includes('transcriptions')
  let whisperExempt = false   // Audit 04/10 (AUD-1) : owner / developer — pas de quota quotidien de minutes

  if (gated) {
    // M1 (audit 14/09) : Whisper est un fournisseur PAYANT. Le client réserve la transcription aux plans
    // payants (whisperTranscribe) mais le serveur ne le gardait pas → un compte Free l'appelait direct.
    // On aligne le serveur sur le produit : Starter+ / owner / dev (comme derush-transcribe pour Scribe).
    if (isTranscribe) {
      const { plan, isOwner, err } = await userPlan(uid)
      if (!err && !isOwner && !['starter', 'pro', 'elite', 'developer'].includes(plan)) {   // err = hoquet DB → fail-open (ne pas 403 un abonné pendant un incident)
        return jsonRes(403, { error: 'La transcription est réservée aux plans payants.' })
      }
      whisperExempt = !err && (isOwner || plan === 'developer')
    }
    let helperMax = isTranscribe ? 12 : 20
    if (!isBillable && !isTranscribe) {   // helper chat : plan Free (comptes jetables) = 6 / 10 min
      const { plan, isOwner, err } = await userPlan(uid)
      if (!err && !isOwner && (!plan || plan === 'free')) helperMax = 6
    }
    const gate = isBillable
      ? await billableGate({ userId: uid, proxy: 'openai', requireDebit: true, rateMax: 40, label: bare })
      : await helperGate(uid, 'openai', helperMax)   // round3 (06/09) : GPT-4o/Whisper payants → 20/12 par 10 min (drain réduit)
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  let drawn = 0   // L1 (audit 14/09) : hissé HORS du try — le catch le référence (sinon ReferenceError → réserve non rendue + 500 sans CORS)
  let drawnReal = 0   // montant RÉELLEMENT tiré (0 si fail-open / ombre) : seul lui ouvre la remise Omni et seul lui est rendu
  let imgQ = '', imgN = 0   // qualité / nombre d'images facturés (remise Omni : UNE image low ou medium)
  let drawnOp: string | undefined   // l'op PRÉCISE tirée — resolveOp ne la retrouve plus une fois à réserve 0 (audit 06/09)
  let startMode = '' as '' | 'paid' | 'free' | 'legacy'   // image de départ d'Express (audit 28/09 #14) : payée, relance gratuite, ou ancien chemin
  let freeHold = 0   // Audit 04/10 (EXP-2) : crédits mis de côté par CETTE relance gratuite (rendus si elle échoue)
  let whisperPris = 0, whisperCompte = false   // Audit 04/10 (AUD-1) : secondes réservées sur le quota du jour (0 = durée inconnue)
  // Palier 4K (x-aa-chain: nano4k, plans Pro/Élite comme dans l'app depuis le 24/09) : seulement une image gpt low/medium, n=1 → tire 5 et
  // crée un droit d'upscale Nano. Toute autre combinaison = tirage normal, aucun droit (pas de gpt high + Nano pour 5).
  let chain = false, chainPlanOk = false
  if (isBillable && gated && wantsNanoChain(req)) {
    const { plan, isOwner, err } = await userPlan(uid)
    chainPlanOk = !err && (isOwner || ['pro', 'elite', 'developer'].includes(plan))
  }
  const chainCost = (q: string, n: number) => (chainPlanOk && n === 1 && (q === 'medium' || q === 'low')) ? (chain = true, CHAIN_NANO_COST) : imgCost(q) * n
  // Tirage d'une image facturée. Image de départ d'Express (x-aa-chain: omni-start, 1 image low/medium) : UNE payée par op
  // (audit 28/09 #14). Une relance (réponse perdue, 504, image lente) ne retire rien ; au-delà de 2 relances → 409.
  // Audit 04/10 (EXP-2) : la relance met son prix de côté sur l'op (payée si aucune vidéo ne suit) ; palier ≤ l'image payée.
  const drawImg = async (q: string, n: number): Promise<Response | null> => {
    drawn = chainCost(q, n); imgQ = q; imgN = n
    const hint = opFromReq(req)
    if (!chain && wantsOmniStart(req) && n === 1 && (q === 'low' || q === 'medium')) {
      if (!hint) startMode = 'legacy'
      else {
        const m = await claimStart(uid, hint, drawn)
        if (m.mode === 'deny') return jsonRes(409, { error: 'Image de départ déjà générée pour cette vidéo.' })
        if (m.mode === 'free') { startMode = 'free'; drawnOp = hint; freeHold = m.hold; return null }
        startMode = 'paid'
      }
    }
    const r = await applyReservation({ req, userId: uid, proxy: 'openai', cost: drawn, label: bare })
    if (!r.ok) { if (startMode === 'paid') { await omniStartFail(uid, hint); startMode = '' } return jsonRes(r.status, { error: r.error }) }
    drawnOp = r.opId; drawnReal = r.drawn ?? 0
    // rien tiré (ombre / hoquet DB) ou autre op que celle réclamée : on libère la réclamation, ancien chemin
    if (startMode === 'paid' && (!(drawnReal > 0) || drawnOp !== hint)) { await omniStartFail(uid, hint); startMode = 'legacy' }
    return null
  }
  // Rend le tiré d'un appel en échec — sauf l'image de départ payée dont une relance déjà livrée dépend (omni_start_fail 'keep').
  const releaseDrawn = async () => {
    if (!(drawnReal > 0)) return
    if (startMode === 'paid' && (await omniStartFail(uid, drawnOp)) === 'keep') return
    await releaseOp(uid, drawnOp, drawnReal)
  }
  // Audit 04/10 (EXP-2) : relance gratuite en échec → ce qu'elle avait mis de côté revient à la réserve (une seule fois).
  const releaseFree = async () => {
    if (startMode !== 'free' || !(freeHold > 0) || !drawnOp) return
    const h = freeHold; freeHold = 0
    try { await svc().rpc('omni_start_free_fail', { p_user: uid, p_op: drawnOp, p_hold: h }) } catch { /* best-effort */ }
  }
  // Audit 04/10 (AUD-1) : transcription en échec → la durée réservée sur le quota du jour est rendue.
  const releaseWhisper = async () => {
    if (!whisperCompte || !(whisperPris > 0)) return
    const s = whisperPris; whisperPris = 0
    await ajusterWhisper(uid, -s)
  }
  try {
    const ct = req.headers.get('content-type') ?? ''
    let openaiRes: Response
    if (ct.includes('multipart/form-data')) {
      const incoming = await req.formData()
      const outgoing = new FormData()
      if (isBillable && gated) {
        // fichiers (image, image[], mask) : tous transmis ; champs texte : UNE valeur chacun, bornée, celle qui est facturée
        const text: Record<string, string> = {}
        let nFiles = 0
        for (const [k, v] of incoming.entries()) {
          if (typeof v === 'string') { text[k] = v; continue }
          if (!/^(image|image\[\]|mask)$/.test(k)) continue   // seuls les fichiers attendus par /images/edits
          if (++nFiles > IMG_MAX_FILES) return jsonRes(400, { error: 'trop d’images de référence (8 max)' })
          if ((v as File).size > IMG_MAX_FILE_BYTES) return jsonRes(413, { error: 'image de référence trop lourde (25 Mo max)' })
          outgoing.append(k, v)
        }
        const nm = normImage(text)
        if ('error' in nm) return jsonRes(400, { error: nm.error })
        const kept: Record<string, string> = {}
        for (const [k, v] of Object.entries(text)) if (IMG_TEXT_ALLOW.has(k)) kept[k] = k === 'prompt' ? v.slice(0, IMG_MAX_PROMPT) : v
        for (const [k, v] of Object.entries({ ...kept, ...nm.fields })) outgoing.append(k, v)
        { const stop = await drawImg(nm.q, nm.n); if (stop) return stop }
      } else if (gated && isTranscribe) {
        // Audit 04/10 (AUD-1) : formulaire Whisper RECONSTRUIT (champs de l'app seulement), durée bornée, quota du jour.
        let file: File | null = null
        const text: Record<string, string> = {}
        const grains: string[] = []
        for (const [k, v] of incoming.entries()) {
          if (typeof v !== 'string') { if (k === 'file' && !file) file = v as File; continue }
          if (k === 'timestamp_granularities[]') { if (WHISPER_GRAINS.has(v) && !grains.includes(v)) grains.push(v); continue }
          if (!(k in text)) text[k] = v
        }
        if (!file) return jsonRes(400, { error: 'Fichier audio manquant.' })
        if (file.size > WHISPER_MAX_BYTES) return jsonRes(413, { error: 'Fichier trop lourd pour la transcription (25 Mo maximum).' })
        const mesure = dureeAudio(new Uint8Array(await file.arrayBuffer()))
        if (mesure != null && mesure > WHISPER_MAX_S) {
          return jsonRes(413, { error: `Audio trop long : ${minutes(mesure)} min (${WHISPER_MAX_S / 60} min maximum par transcription).` })
        }
        if (!whisperExempt) {
          const pris = mesure != null ? Math.ceil(mesure) : Math.min(WHISPER_MAX_S, Math.ceil(file.size / WHISPER_OCTETS_PAR_S))
          if (!(await quotaWhisper(uid, pris))) {
            return jsonRes(429, { error: `Limite quotidienne de transcription atteinte (${WHISPER_JOUR_S / 60} min par jour) — réessaie demain.` })
          }
          whisperPris = pris; whisperCompte = true
        }
        outgoing.append('file', file, file.name || 'audio.mp3')
        outgoing.append('model', 'whisper-1')
        if (/^[a-z]{2,3}$/.test(text.language || '')) outgoing.append('language', text.language)
        if (text.prompt) outgoing.append('prompt', text.prompt.slice(0, WHISPER_MAX_PROMPT))
        outgoing.append('response_format', 'verbose_json')
        for (const g of grains) outgoing.append('timestamp_granularities[]', g)
        const temp = Number(text.temperature)
        if ((text.temperature ?? '') !== '' && Number.isFinite(temp) && temp >= 0 && temp <= 1) outgoing.append('temperature', String(temp))
      } else {
        for (const [k, v] of incoming.entries()) outgoing.append(k, v)
      }
      openaiRes = await fetch(up.url, { method: 'POST', headers: { 'Authorization': `Bearer ${openaiKey}` }, body: outgoing })
    } else {
      const rawBody = await req.text()
      let sendBody = rawBody
      if (isBillable && gated) {
        let b: any = null
        try { b = JSON.parse(rawBody) } catch { /* traité juste dessous */ }
        if (!b || typeof b !== 'object') return jsonRes(400, { error: 'corps JSON invalide' })
        const nm = normImage(b)
        if ('error' in nm) return jsonRes(400, { error: nm.error })
        const kept: Record<string, unknown> = {}
        for (const k of Object.keys(b)) if (IMG_TEXT_ALLOW.has(k)) kept[k] = k === 'prompt' ? String(b[k]).slice(0, IMG_MAX_PROMPT) : b[k]
        sendBody = JSON.stringify({ ...kept, ...nm.fields, n: nm.n })
        { const stop = await drawImg(nm.q, nm.n); if (stop) return stop }
      } else if (gated && bare.includes('/chat/completions')) {
        // Helper LLM non facturant : borne le coût (audit chaînes 15/09) — modèle hors allowlist coercé vers le moins cher + plafond tokens.
        if (rawBody.length > HELPER_MAX_BODY) return jsonRes(413, { error: 'requête trop longue' })
        let b: any = null
        try { b = JSON.parse(rawBody) } catch { /* traité juste dessous */ }
        if (!b || typeof b !== 'object' || !Array.isArray(b.messages)) return jsonRes(400, { error: 'corps JSON invalide' })
        if (!OPENAI_HELPER_MODELS.has(String(b.model || ''))) b.model = 'gpt-4o-mini'
        b.max_tokens = Math.min(Number(b.max_tokens) || OPENAI_HELPER_MAX_TOKENS, OPENAI_HELPER_MAX_TOKENS)
        delete b.max_completion_tokens; delete b.logprobs; delete b.top_logprobs; delete b.stream; delete b.tools; delete b.functions
        b.n = 1
        sendBody = JSON.stringify(b)
      }
      openaiRes = await fetch(up.url, { method: 'POST', headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, body: sendBody })
    }
    const body = await openaiRes.text()
    // Audit 04/10 (AUD-1) : la durée RÉELLE (verbose_json `duration`, ce qu'OpenAI facture) remplace la réservation sur le
    // quota du jour — c'est elle qui compte un format non mesurable ici. Échec → réservation rendue.
    if (whisperCompte) {
      if (openaiRes.ok) {
        let reel = 0
        try { reel = Math.ceil(Number(JSON.parse(body)?.duration) || 0) } catch { /* corps non JSON : on garde la réservation */ }
        if (reel > 0 && Math.abs(reel - whisperPris) > 1) await ajusterWhisper(uid, reel - whisperPris)
        if (reel > WHISPER_MAX_S) console.warn(`[whisper] ${uid} : ${minutes(reel)} min transcrites (format non mesuré avant l'envoi)`)
      } else await releaseWhisper()
    }
    // Images gpt-image = SYNCHRONE : un 2xx = image livrée → on règle la réservation (op non remboursable).
    if (isBillable && gated && openaiRes.ok) {   // image livrée (synchrone) → op non remboursable
      if (startMode === 'free') await omniStartFreeDone(uid, drawnOp, drawn)   // relance : l'image n'est payée qu'une fois (#14)
      else if (drawnOp) {
        await settleReservation(uid, drawnOp)
        if (chain) await chainCreditAdd(uid, drawnOp, 1)
        // Image de départ d'Express OFFERTE (Axel 25/09 : Omni, puis Veo le même jour) : ce qui vient d'être tiré sera déduit
        // du tirage de la vidéo (draw_omni_reservation, kie-proxy / google-ai-proxy / fal-proxy). Seulement une image
        // low/medium (≤ 3), op « express-omni » ou « express », une fois (garde SQL de omni_start_add).
        else if (startMode === 'paid' && drawnReal > 0) await omniStartDone(uid, drawnOp, drawnReal)
        else if (startMode === 'legacy' && drawnReal > 0) await omniStartAdd(uid, drawnOp, drawnReal)
      }
    }
    if (isBillable && gated && !openaiRes.ok) { await releaseDrawn(); await releaseFree() }   // amont en erreur → on rend l'op TIRÉE (resolveOp ne la retrouverait pas à réserve 0)
    return new Response(body, {
      status: openaiRes.status,
      headers: { ...CORS, 'Content-Type': openaiRes.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    if (isBillable && gated) { await releaseDrawn().catch(() => {}); await releaseFree().catch(() => {}) }   // exception → rendre EXACTEMENT le tiré (drawn hissé), jamais 9999 (sur-restauration)
    await releaseWhisper().catch(() => {})
    console.error('openai-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
