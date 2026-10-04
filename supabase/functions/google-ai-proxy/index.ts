// Supabase Edge Function — Google AI API proxy
// La clé Google AI est stockée côté serveur (secret Supabase GOOGLE_AI_KEY).
//
// Endpoints (via ?path=) — ALLOWLIST STRICTE :
//   POST /v1beta/models/<m>:predictLongRunning → Veo (async start)                  [FACTURANT async]
//   POST /v1beta/models/<m>:generateContent    → Nano Banana (image) / Gemini flash / TTS
//   GET  /v1beta/models/<m>/operations/<id>    → poll d'une opération Veo           [non facturant → settle]
//   GET  /v1beta/operations/<id>               → poll d'une opération               [non facturant → settle]
//   GET  /v1beta/files/<id>:download           → téléchargement vidéo Veo           [non facturant]
//
// Sécurité (audit 05/09) : session obligatoire ; `?path=` résolu contre la base (clé en en-tête
// x-goog-api-key) ; FACTURANT = plafond + débit + RÉSERVATION. generateContent facturant UNIQUEMENT pour
// les modèles d'IMAGE (Nano) ; gemini-2.5-flash (helper) et *tts* (voix, débit couvert par Express) exemptés.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate, requirePlan, userPlan, applyReservation, applyOmniReservation, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp, releaseOmniOp, omniStartUsed, opHasJob, bindJob, releaseByJob, settleByJob, refundByJobTerminal, chainCreditTake, chainCreditGiveBack, wantsNanoChain, svc } from '../_shared/guard.ts'
import { KIE_OPEN } from '../_shared/kie.ts'

const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com'
// 23/09/2026 : `:predict` (Imagen 4, arrêté par Google le 17/08/2026, seul appelant = module Cartoon supprimé) retiré.
// Veo : SEULS Lite et Fast (les deux proposés par l'app). Un autre Veo (Standard 3.1 = 0,40 $/s, 8× Lite) passait le motif
// générique et était coté au tarif Lite par costFor → refusé ici (revue du 23/09/2026).
const ALLOW = /^\/v1beta\/(models\/(veo-3\.1-(lite|fast)-generate-preview:predictLongRunning|[A-Za-z0-9._-]+:generateContent)|models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+|operations\/[A-Za-z0-9._-]+|files\/[A-Za-z0-9._-]+:download)$/
// FACTURANT : predictLongRunning (Veo), + generateContent SEULEMENT pour un modèle d'image (Nano « *-image »).
const isBillablePath = (bare: string) =>
  /:predictLongRunning$/.test(bare) || /\/models\/[A-Za-z0-9._-]*image[A-Za-z0-9._-]*:generateContent$/i.test(bare)

// Coût serveur (borne basse, jamais > coût réel → ne 402 jamais un flux légitime) :
function costFor(bare: string, body: string): number {
  if (/gemini-[A-Za-z0-9._-]*image[A-Za-z0-9._-]*:generateContent$/i.test(bare)) return 5   // Nano Banana Pro = 5
  if (/:predictLongRunning$/.test(bare)) {                                                   // Veo
    const rate = /fast/i.test(bare) ? 3 : 1.5
    let dur = 0, mult = 1, isExt = false
    try { const b = JSON.parse(body); dur = Number(b?.parameters?.durationSeconds) || 0; if (String(b?.parameters?.resolution) === '1080p') mult = 2; isExt = !!(b?.instances?.[0]?.video) } catch { /* */ }
    // audit 14/09 : durée absente → 8 s (anti-abus : omettre durationSeconds ne finance plus une vidéo Veo
    // complète à bas coût, et plusieurs soumissions ne partagent plus une op). EXCEPTION : une EXTENSION
    // vidéo→vidéo (instances[].video, sans durationSeconds) produit ~7 s fixes et est débitée à 7 s côté
    // client (_extCost) → la coter 7 s, sinon 402 systématique sur chaque extension Express.
    const sec = dur > 0 ? dur : (isExt ? 7 : 8)
    return Math.ceil(sec * rate * mult)
  }
  return 1
}

// Audit 28/09 : le corps Veo était relayé BRUT (sampleCount, résolution '4k'/'1080P', personGeneration… passaient, seul
// durationSeconds et resolution === '1080p' étaient lus pour le coût). Corps RECONSTRUIT avec les seuls champs de l'app.
function veoBody(raw: string): { body: string } | { error: string } {
  let b: any = null
  try { b = JSON.parse(raw || '{}') } catch { /* traité juste dessous */ }
  const i0 = b && Array.isArray(b.instances) ? b.instances[0] : null
  if (!i0 || typeof i0 !== 'object' || typeof i0.prompt !== 'string' || !i0.prompt.trim()) return { error: 'corps Veo invalide' }
  const inst: Record<string, unknown> = { prompt: i0.prompt.slice(0, 8000) }
  if (i0.image && typeof i0.image === 'object') {
    const mt = String(i0.image.mimeType || '')
    if (typeof i0.image.bytesBase64Encoded !== 'string' || !/^image\/(png|jpeg)$/.test(mt)) return { error: 'image de départ invalide (PNG ou JPEG)' }
    inst.image = { bytesBase64Encoded: i0.image.bytesBase64Encoded, mimeType: mt }
  }
  if (i0.video && typeof i0.video === 'object') inst.video = i0.video   // extension (Fast 720p, Élite — gatée plus haut)
  const pr = (b.parameters && typeof b.parameters === 'object') ? b.parameters : {}
  const params: Record<string, unknown> = { sampleCount: 1, aspectRatio: pr.aspectRatio === '16:9' ? '16:9' : '9:16', resolution: pr.resolution === '1080p' ? '1080p' : '720p' }
  if (!inst.video) params.durationSeconds = [4, 6, 8].includes(Number(pr.durationSeconds)) ? Number(pr.durationSeconds) : 8
  if (pr.generateAudio === true) params.generateAudio = true
  return { body: JSON.stringify({ instances: [inst], parameters: params }) }
}

// Audit 04/10 (IMG-1) : le corps Nano Banana Pro (generateContent d'un modèle d'image, tirage fixe de 5) partait TEL QUEL
// chez Google : generationConfig (candidateCount, thinkingConfig…), safetySettings (filtres abaissés), tools (recherche
// Google, facturée en plus), systemInstruction, plusieurs tours, pièces jointes vidéo / audio / PDF… Corps RECONSTRUIT avec
// les seuls champs de l'app (_nbEdit, _nbHeadSwap), comme veoBody pour Veo et kie-proxy / fal-proxy pour le même modèle :
//   • UN message « user » ; ses parties dans l'ordre reçu : texte (10 000 caractères au total, l'app en envoie ~3 000) et
//     images inline (type image/*, 4 au plus : l'app en envoie 1 ou 2), écrites au format de l'app (inline_data) ;
//   • responseModalities TEXT + IMAGE (ce que l'app envoie toujours) ; imageConfig : imageSize 1K / 2K / 4K et aspectRatio de
//     la liste de Gemini (= _NB_RATIOS de l'app) ; une valeur hors liste est écartée (Google prend alors sa valeur par
//     défaut, comme pour les replis de l'app sans imageConfig) ; candidateCount absent = UNE réponse.
// Messages d'erreur choisis pour ne déclencher ni le repli « config rejetée » ni les nouvelles tentatives de _nbEdit.
const NB_MAX_IMAGES = 4, NB_MAX_TEXTE = 10_000
const NB_TAILLES = new Set(['1K', '2K', '4K'])
const NB_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'])
function nanoBody(raw: string): { body: string } | { error: string } {
  let b: any = null
  try { b = JSON.parse(raw || '{}') } catch { /* traité juste dessous */ }
  const c0 = b && Array.isArray(b.contents) && b.contents.length === 1 ? b.contents[0] : null
  if (!c0 || typeof c0 !== 'object' || !Array.isArray(c0.parts) || !c0.parts.length) return { error: 'Requête image illisible : un seul message attendu.' }
  const parts: Record<string, unknown>[] = []
  let texte = 0, images = 0
  for (const p of c0.parts) {
    if (!p || typeof p !== 'object') return { error: 'Requête image illisible.' }
    if (typeof p.text === 'string') {
      const t = p.text.slice(0, Math.max(0, NB_MAX_TEXTE - texte))
      texte += t.length
      if (t) parts.push({ text: t })
      continue
    }
    const d = (p.inline_data && typeof p.inline_data === 'object') ? p.inline_data : (p.inlineData && typeof p.inlineData === 'object') ? p.inlineData : null
    if (!d) return { error: 'Requête image : seuls du texte et des images sont acceptés.' }
    let mt = String(d.mime_type ?? d.mimeType ?? '').toLowerCase()
    if (mt === 'image/jpg') mt = 'image/jpeg'
    if (!/^image\/[a-z0-9.+-]{1,40}$/.test(mt) || typeof d.data !== 'string' || !d.data) return { error: 'Requête image : pièce jointe refusée (une image est attendue).' }
    if (++images > NB_MAX_IMAGES) return { error: `Requête image : ${NB_MAX_IMAGES} images au maximum.` }
    parts.push({ inline_data: { mime_type: mt, data: d.data } })
  }
  if (!parts.length) return { error: 'Requête image vide.' }
  const gc0 = (b.generationConfig && typeof b.generationConfig === 'object') ? b.generationConfig : {}
  const ic0 = (gc0.imageConfig && typeof gc0.imageConfig === 'object') ? gc0.imageConfig : null
  const gc: Record<string, unknown> = { responseModalities: ['TEXT', 'IMAGE'] }
  if (ic0) {
    const ic: Record<string, string> = {}
    if (NB_TAILLES.has(String(ic0.imageSize))) ic.imageSize = String(ic0.imageSize)
    if (NB_RATIOS.has(String(ic0.aspectRatio))) ic.aspectRatio = String(ic0.aspectRatio)
    if (Object.keys(ic).length) gc.imageConfig = ic
  }
  return { body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: gc }) }
}

// Audit 04/10 (EXP-4) : à qui est cette opération / ce fichier Veo ? Le suivi (operations/<id>) et le téléchargement
// (files/<id>:download) étaient relayés à Google avec la clé de la plateforme pour N'IMPORTE QUEL identifiant (fal-proxy et
// kie-proxy vérifient la propriété depuis le 02/10). Le propriétaire est noté dans veo_refs (migration 20261004030000) :
// 'op:<id>' à la soumission (même sans tirage : owner, developer, hoquet), 'file:<id>' de chaque fichier livré au suivi
// terminé. Repli pour une opération soumise avant ce correctif : l'op de crédits liée au job (credit_ops.provider_job).
// Inconnu → 404 pour un client (owner / developer : toléré) ; lecture impossible → 503 (l'app re-sonde le suivi).
// Table absente (fonction déployée avant la migration) → contrôle d'avant (aucun), jamais un suivi légitime bloqué.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tableAbsente = (e: { code?: string; message?: string } | null) =>
  !!e && /42P01|PGRST205|does not exist|could not find the table/i.test(`${e.code || ''} ${e.message || ''}`)
async function veoNoter(uid: string, refs: string[]): Promise<boolean> {
  const rows = [...new Set(refs)].filter((r) => /^(op|file):[A-Za-z0-9._-]{1,200}$/.test(r)).map((ref) => ({ ref, user_id: uid }))
  if (!rows.length) return true
  for (let essai = 0; essai < 2; essai++) {
    if (essai) await sleep(250)
    try {
      const { error } = await svc().from('veo_refs').upsert(rows, { onConflict: 'ref', ignoreDuplicates: true })
      if (!error) return true
      if (tableAbsente(error)) { console.warn('[veo] table veo_refs absente : propriétaire non noté (migration 20261004030000 à appliquer)'); return true }
      console.warn('[veo] propriétaire non noté:', error.message)
    } catch { /* nouvel essai */ }
  }
  return false
}
async function veoProprio(uid: string, ref: string, job?: string): Promise<'moi' | 'autrui' | 'inconnu' | 'erreur' | 'absente'> {
  for (let essai = 0; essai < 2; essai++) {   // un hoquet isolé ne fait pas échouer un suivi légitime : 2e lecture
    if (essai) await sleep(250)
    try {
      const { data, error } = await svc().from('veo_refs').select('user_id').eq('ref', ref).limit(1)
      if (tableAbsente(error)) { console.warn('[veo] table veo_refs absente : propriété non contrôlée (migration 20261004030000 à appliquer)'); return 'absente' }
      if (error) { console.warn('[veo] propriété illisible:', error.message); continue }
      if (data && data.length) return (data[0] as { user_id: string }).user_id === uid ? 'moi' : 'autrui'
      if (!job) return 'inconnu'
      const { data: ops, error: e2 } = await svc().from('credit_ops').select('user_id').eq('provider_job', job).limit(5)
      if (e2) { console.warn('[veo] propriété illisible:', e2.message); continue }
      if (!ops || !ops.length) return 'inconnu'
      return (ops as { user_id: string }[]).every((o) => o.user_id === uid) ? 'moi' : 'autrui'
    } catch { /* nouvel essai */ }
  }
  return 'erreur'
}
// Identifiants de fichiers livrés dans la réponse d'un suivi terminé (uri « …/files/<id>:download », ou « files/<id> » ;
// barre oblique éventuellement échappée « files\/<id> » dans le JSON).
const veoFichiers = (body: string): string[] =>
  [...body.matchAll(/files\\?\/([A-Za-z0-9._-]+)/g)].map((m) => 'file:' + m[1].replace(/[.]+$/, '')).filter((r) => r.length > 5)

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST' && req.method !== 'GET') return jsonRes(405, { error: 'method_not_allowed' })

  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.isService && !auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })

  const googleKey = Deno.env.get('GOOGLE_AI_KEY') ?? ''
  if (!googleKey) return jsonRes(500, { error: 'GOOGLE_AI_KEY not configured in Supabase secrets' })

  const url = new URL(req.url)
  const apiPath = url.searchParams.get('path') ?? ''
  if (!apiPath) return jsonRes(400, { error: 'Paramètre ?path= manquant' })
  const up = safeUpstream(GOOGLE_AI_BASE, apiPath, ALLOW)
  if (!up.ok) return jsonRes(400, { error: 'path refusé : ' + up.reason })
  const bare = new URL(up.url).pathname
  // Audit 28/09 (HAUTE) : la query du client partait telle quelle chez Google — « ?fields=done » vidait la réponse du poll de sa
  // vidéo → remboursement serveur alors que la vidéo restait téléchargeable. URL amont = chemin nu ; seul « alt=media » d'un
  // téléchargement (files/<id>:download) est gardé.
  const upstream = GOOGLE_AI_BASE + bare + (/:download$/.test(bare) ? '?alt=media' : '')
  const isBillable = req.method === 'POST' && isBillablePath(bare)
  if (req.method === 'GET' && /:predictLongRunning$/.test(bare)) return jsonRes(405, { error: 'method_not_allowed' })
  const gated = !auth.isService && !!auth.userId
  const uid = auth.userId as string
  const isSyncBillable = isBillable && /:generateContent$/.test(bare)   // Nano = synchrone
  const isPoll = req.method === 'GET' && /\/operations\/[A-Za-z0-9._-]+$/.test(bare)
  const isDownload = req.method === 'GET' && /\/files\/[A-Za-z0-9._-]+:download$/.test(bare)

  if (gated) {
    const isTts = req.method === 'POST' && /:generateContent$/.test(bare) && /tts/i.test(bare)
    const isChat = req.method === 'POST' && /:generateContent$/.test(bare) && !isTts && !isBillable   // gemini texte/vision (non facturant)
    // Audit 28/09 : la voix Gemini (TTS) n'est plus utilisée nulle part (Axel : « supprime la voix Gemini ») → fermée.
    if (isTts) return jsonRes(403, { error: 'synthèse vocale non disponible' })
    let chatMax = 40
    if (isChat) { const { plan, isOwner, err } = await userPlan(uid); if (!err && !isOwner && (!plan || plan === 'free')) chatMax = 10 }   // plan Free : 10 / 10 min
    const gate = isBillable
      ? await billableGate({ userId: uid, proxy: 'google', requireDebit: true, debitMinutes: 120, rateMax: 30, label: bare })
      : isChat
        ? await helperGate(uid, 'google-chat', chatMax, 600)   // audit 06/09 : chat gemini plafonné 40/10min (au lieu de 900 → drain)
        : await helperGate(uid, 'google', 900)   // polling ≤10 min par génération Veo, plusieurs en série
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  // Helper LLM/TTS non facturant (audit chaînes 15/09) : le MODÈLE est dans le PATH → un compte pouvait appeler
  // gemini-2.5-PRO:generateContent gratuitement sur la clé du proprio (helperGate = rate-limit seul). On restreint le
  // chemin helper à la famille 'flash' (l'app n'utilise que gemini-2.5-flash + *-flash-preview-tts). Le facturant (images/Veo) n'est pas concerné.
  if (gated && !isBillable && /:generateContent$/.test(bare) && !/flash/i.test(bare)) {
    return jsonRes(403, { error: 'modèle non autorisé sur cet endpoint (famille flash uniquement)' })
  }

  // Audit 04/10 (EXP-3) : Veo (Lite comme Fast) = plans payants, comme kie-proxy (KIE_OPEN['veo3-lite'] : Starter, Pro, Élite,
  // byok) et fal-proxy pour Omni. Avant, seul Fast était gaté : un compte Free avec des crédits (pack acheté sans abonnement,
  // abonnement résilié) générait du Veo Lite en appelant le proxy directement. L'app réserve déjà Express aux abonnés.
  if (gated && isBillable && /:predictLongRunning$/.test(bare)) {
    const g = await requirePlan(uid, KIE_OPEN['veo3-lite'], 'Vidéo Express')
    if (!g.ok) return jsonRes(g.status, { error: 'La vidéo Express est réservée aux abonnés (Starter, Pro ou Élite).' })
  }
  // Audit métier 14/09 (Phase 2) : Veo 3.1 FAST (Express « Pro ») = Pro/Élite. Veo Lite reste Starter+ (porte EXP-3
  // ci-dessus) → on ne gate ici QUE le modèle 'fast' (pas la famille veo-3.1). Résolution 1080p / extensions >8 s sont des paliers
  // par PARAMÈTRE de body (non-chemin) et NE sont PAS gatés ici (risque de 402 l'extension légitime).
  if (gated && isBillable && /:predictLongRunning$/.test(bare) && /veo-3\.1-fast/i.test(bare)) {
    const g = await requirePlan(uid, ['pro', 'elite'], 'Veo Pro (rapide)'); if (!g.ok) return jsonRes(g.status, { error: g.error })
  }

  // Audit 04/10 (EXP-4) : suivi / téléchargement d'une opération ou d'un fichier Veo d'un autre compte → 404, AVANT Google.
  if (gated && (isPoll || isDownload)) {
    const id = isPoll ? ((bare.match(/operations\/([A-Za-z0-9._-]+)$/) || [])[1] || '') : ((bare.match(/files\/([A-Za-z0-9._-]+):download$/) || [])[1] || '')
    const p = await veoProprio(uid, (isPoll ? 'op:' : 'file:') + id, isPoll ? 'veo:' + id : undefined)
    // Base illisible : le suivi répond 503 (l'app re-sonde toutes les 5 s) ; le téléchargement, lui, n'est pas relancé par
    // l'app (vidéo déjà réglée, perdue sur une erreur) → il passe, l'identifiant n'étant connu que de son propriétaire.
    if (p === 'erreur' && isPoll) return jsonRes(503, { error: 'Suivi momentanément indisponible — réessaie dans un instant.' })
    if (p === 'erreur') console.warn('[veo] propriété du fichier illisible : téléchargement laissé passer')
    if (p === 'autrui') return jsonRes(404, { error: 'Vidéo introuvable.' })
    if (p === 'inconnu') {
      const { plan, isOwner, err } = await userPlan(uid)
      if (err) return jsonRes(503, { error: 'Suivi momentanément indisponible — réessaie dans un instant.' })
      if (!isOwner && plan !== 'developer') return jsonRes(404, { error: 'Vidéo introuvable.' })
    }
  }

  let drawn = 0   // L1 (audit 14/09) : hissé HORS du try — le catch le référence (sinon ReferenceError → réserve non rendue + 500 sans CORS)
  let drawnOp: string | undefined
  let startImg = 0   // Veo d'Express (25/09) : remise « image de départ offerte » consommée par le tirage — rendue AVEC lui
  let chainOp: string | null = null   // droit d'upscale du palier 4K consommé (tirage 0) — rendu si Nano échoue
  let settled = false, gaveBack = false
  // Rend UNE seule fois, jamais après un règlement : le droit s'il a été pris, sinon le tirage (jamais un tirage nul,
  // que release_reservation arrondirait à 1 crédit rendu).
  const giveBack = async () => {
    if (settled || gaveBack) return
    gaveBack = true
    if (chainOp) await chainCreditGiveBack(uid, chainOp)
    else if (drawn > 0) await releaseOmniOp(uid, drawnOp, drawn, startImg)   // startImg 0 (Nano, Veo sans image offerte) = releaseOp
  }
  try {
    const headers: Record<string, string> = { 'x-goog-api-key': googleKey }
    let googleRes: Response
    if (req.method === 'GET') {
      googleRes = await fetch(upstream, { method: 'GET', headers })
    } else {
      let rawBody = await req.text()
      if (gated && isBillable && /:predictLongRunning$/.test(bare)) { const vb = veoBody(rawBody); if ('error' in vb) return jsonRes(400, { error: vb.error }); rawBody = vb.body }
      // Audit 04/10 (IMG-1) : corps Nano reconstruit AVANT tout tirage (un refus ne coûte rien).
      if (gated && isSyncBillable) { const nb = nanoBody(rawBody); if ('error' in nb) return jsonRes(400, { error: nb.error }); rawBody = nb.body }
      let sendBody = rawBody
      if (isBillable && gated) {
        // Audit 14/09 : paliers Veo PAR BODY-PARAM (non-chemin, donc lus sur le VRAI body → précis, pas de faux 402).
        // 1080p = Pro/Élite ; extension vidéo→vidéo (instances[].video, >8 s) = Élite (le client réserve déjà ces paliers).
        if (/:predictLongRunning$/.test(bare)) {
          let _res = '', _ext = false
          try { const _b = JSON.parse(rawBody); _res = String(_b?.parameters?.resolution || ''); _ext = !!(_b?.instances?.[0]?.video) } catch { /* */ }
          // 23/09/2026 : l'API Gemini n'étend QUE Veo 3.1 / 3.1 Fast en 720p (jamais Lite, jamais 1080p). Refus
          // AVANT toute réservation (gratuit) au lieu d'un échec Google payé en temps et en réserve.
          if (_ext && (/lite/i.test(bare) || (_res !== '' && _res !== '720p'))) return jsonRes(400, { error: 'Extension Veo : Veo 3.1 Fast en 720p uniquement (Lite et 1080p non pris en charge par Google).' })
          if (_ext) { const g = await requirePlan(uid, ['elite'], 'Extension vidéo (>8 s)'); if (!g.ok) return jsonRes(g.status, { error: g.error }) }
          // Audit 04/10 (EXP-4, même règle que le téléchargement) : une extension qui désigne une vidéo Veo par son fichier
          // Google (video.uri) prolongerait la vidéo d'un autre compte → seul son propriétaire peut la prolonger (owner /
          // developer : identifiant inconnu toléré). L'app ne propose plus d'extension depuis le 23/09.
          if (_ext) {
            let vuri = ''
            try { vuri = String(JSON.parse(rawBody)?.instances?.[0]?.video?.uri || '') } catch { /* corps déjà validé par veoBody */ }
            if (vuri) {
              const fid = (vuri.match(/files\/([A-Za-z0-9._-]+)/) || [])[1] || ''
              const p = fid ? await veoProprio(uid, 'file:' + fid) : 'autrui'
              if (p === 'erreur') return jsonRes(503, { error: 'Vérification momentanément indisponible — réessaie dans un instant.' })
              if (p === 'autrui') return jsonRes(404, { error: 'Vidéo à prolonger introuvable.' })
              if (p === 'inconnu') {
                const { plan, isOwner, err } = await userPlan(uid)
                if (err || (!isOwner && plan !== 'developer')) return jsonRes(404, { error: 'Vidéo à prolonger introuvable.' })
              }
            }
          }
          else if (_res === '1080p') { const g = await requirePlan(uid, ['pro', 'elite'], 'Veo 1080p'); if (!g.ok) return jsonRes(g.status, { error: g.error }) }
        }
        // Nano marqué x-aa-chain (upscale du palier 4K) : le droit déjà payé (5 tirés par openai-proxy) passe avant un
        // nouveau tirage ; pris d'abord sur l'op du palier (x-aa-op). Un Nano non marqué tire ses 5 comme avant.
        if (isSyncBillable && wantsNanoChain(req)) chainOp = await chainCreditTake(uid, opFromReq(req))
        if (chainOp) { drawn = 0; drawnOp = chainOp }
        else if (/:predictLongRunning$/.test(bare)) {
          // Veo (25/09, Express : kie par défaut, Google = repli / kie fermé) : tirage EXACT tarif × durée MOINS l'image de
          // départ d'Express offerte (draw_omni_reservation, notée par openai-proxy — même règle que kie-proxy). `drawn` = le
          // montant RÉELLEMENT tiré (0 en mode ombre / hoquet DB) : c'est lui qu'on lie au job et qu'on rend, jamais le coût
          // (restaurer un tirage qui n'a pas eu lieu rouvrait le refund-and-keep). La remise consommée est rendue avec lui
          // (releaseOmniOp) : l'app relance Veo sur la MÊME op après certains refus (sans audio natif, Fast → Lite).
          const cost = costFor(bare, rawBody)
          const r = await applyOmniReservation({ req, userId: uid, proxy: 'google', cost, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error })
          drawn = r.drawn ?? 0; drawnOp = drawn > 0 ? r.opId : undefined; startImg = omniStartUsed(cost, drawn)
          // UNE vidéo Google liée par op (relecture 26/09) : un 2e Veo sur une op déjà liée à un job ne pourrait être ni lié,
          // ni réglé, ni rendu par job → refusé AVANT Google, tiré et remise d'image rendus. Aucun flux de l'app ne le fait
          // (les relances « sans audio » / « Fast → Lite » suivent un refus de soumission, jamais lié ; le repli après kie
          // n'utilise pas provider_job).
          if (drawn > 0 && await opHasJob(uid, drawnOp)) {
            await releaseOmniOp(uid, drawnOp, drawn, startImg); gaveBack = true
            return jsonRes(409, { error: 'Une vidéo est déjà en cours pour ce débit — relance la génération depuis l’app.' })
          }
        }
        else { drawn = costFor(bare, rawBody); const r = await applyReservation({ req, userId: uid, proxy: 'google', cost: drawn, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }); drawnOp = r.opId }
      } else if (gated && /:generateContent$/.test(bare) && !/tts/i.test(bare)) {
        // Helper chat non facturant : plafond de tokens de sortie (audit chaînes 15/09).
        if (rawBody.length > 12_000_000) return jsonRes(413, { error: 'requête trop longue' })   // une image inline (détection des mains) passe
        let b: any = null
        try { b = JSON.parse(rawBody) } catch { /* traité juste dessous */ }
        if (!b || typeof b !== 'object') return jsonRes(400, { error: 'corps JSON invalide' })
        b.generationConfig = { ...(b.generationConfig || {}), candidateCount: 1, maxOutputTokens: Math.min(Number(b?.generationConfig?.maxOutputTokens) || 4096, 4096) }
        sendBody = JSON.stringify(b)
      }
      googleRes = await fetch(upstream, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: sendBody })
    }
    // Le corps amont est relayé en BINAIRE. `.text()` (05/09, réservation) ré-encodait un MP4 Veo
    // (GET /files/<id>:download) en UTF-8 → fichier corrompu (moov absent), lecteur noir, Safari qui plante
    // au téléchargement (bug Express 06/09). Le texte n'est décodé QUE pour les réponses JSON/texte (poll).
    const buf = await googleRes.arrayBuffer()
    const ct = googleRes.headers.get('content-type') ?? 'application/json'
    const body = /json|text\//i.test(ct) ? new TextDecoder().decode(buf) : ''
    // Réconciliation. Le job Veo = le nom d'opération (models/…/operations/<id>) renvoyé à la soumission et
    // présent dans le path des polls. On LIE l'op tirée à ce job à la soumission, puis règle/libère PAR JOB au
    // poll (audit 06/09) → un poll d'une opération étrangère ne peut plus rendre/régler la réserve d'une autre op.
    // Les images (Nano) sont SYNCHRONES → on règle/libère l'op PRÉCISE tirée dans cette requête.
    if (gated) {
      const opTail = (bare.match(/operations\/([A-Za-z0-9._-]+)/) || [])[1] || ''   // depuis le path (poll)
      if (isSyncBillable) {
        // Nano synchrone : 2xx → op livrée (non remboursable) ; erreur → on rend l'op tirée. EXCEPTION (24/09/2026) :
        // un 200 SANS image ET marqué REFUS par Google (promptFeedback.blockReason, ou finishReason de sécurité) → on
        // rend l'op, sinon le repli client (gpt-image) prenait un 402 et le client perdait ses crédits. Volontairement
        // étroit : une réponse texte ordinaire (finishReason STOP, pas d'image) reste RÉGLÉE — jamais d'appel gratuit.
        const hasImage = /"inline_?[dD]ata"\s*:\s*\{[^}]*?"data"\s*:\s*"/.test(body)
        const refused = !hasImage && /json/i.test(ct) && (/"blockReason"\s*:\s*"/.test(body)
          || /"finishReason"\s*:\s*"(SAFETY|IMAGE_SAFETY|PROHIBITED_CONTENT|IMAGE_PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION|IMAGE_RECITATION)"/.test(body))
        if (googleRes.ok && !refused) { if (drawnOp) await settleReservation(uid, drawnOp); settled = true }
        else await giveBack()
      } else if (isBillable) {
        // Veo : soumission async. 2xx → on lie l'op au job (seulement si un tirage a RÉELLEMENT eu lieu : un bind sans montant
        // rendrait tout au release_by_job) ; erreur → on rend le tiré et la remise d'image consommée.
        if (googleRes.ok) {
          const name = (body.match(/operations\/([A-Za-z0-9._-]+)/) || [])[1] || ''
          if (name) await veoNoter(uid, ['op:' + name])   // Audit 04/10 (EXP-4) : propriétaire noté, même sans tirage
          // chemin complet de l'opération = de quoi la suivre si l'onglet se ferme (filet reconcile-fal-orphans, audit 28/09 #11)
          const full = (body.match(/"name"\s*:\s*"(models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+)"/) || [])[1] || ''
          if (name && drawn > 0) await bindJob(uid, drawnOp, 'veo:' + name, drawn, full ? `${GOOGLE_AI_BASE}/v1beta/${full}` : undefined)
        }
        else if (drawn > 0) { await releaseOmniOp(uid, drawnOp, drawn, startImg); gaveBack = true }
      } else if (isPoll && googleRes.ok && /"done"\s*:\s*true/.test(body)) {
        // Poll d'une opération Veo terminée. Livrée = une VIDÉO est présente (octets, uri ou files/…). « done » sans vidéo
        // (erreur, ou vidéo bloquée par le filtre RAI : raiMediaFilteredCount > 0) = échec NON facturé par Google →
        // remboursement SERVEUR (comme fal-proxy : refundByJobTerminal, sinon on rend la réserve) au lieu d'un règlement
        // qui faisait perdre les crédits au client (revue du 23/09/2026). Relu N fois (le client relit le suivi à volonté) :
        // la libération par job n'a lieu qu'UNE fois (job_bill_state, migration 20260925233000) — avant, chaque lecture
        // rajoutait job_drawn à la réserve (remboursement > prix payé, étape livrée gratuite).
        if (opTail) {
          const hasVideo = /"bytesBase64Encoded"\s*:\s*"|"uri"\s*:\s*"|files\/[A-Za-z0-9_-]+/.test(body)
          const filtered = /"raiMediaFilteredCount"\s*:\s*[1-9]/.test(body)
          // Audit 28/09 : une vidéo PRÉSENTE = livrée → réglée, même avec un échantillon filtré ou un champ "error" à côté
          // (avant : remboursée en entier alors que la vidéo restait téléchargeable). Rien à télécharger = remboursée.
          if (hasVideo) {
            await settleByJob(uid, 'veo:' + opTail)
            // Audit 04/10 (EXP-4) : le fichier livré n'est téléchargeable que par ce compte. Propriétaire non noté (hoquet DB) →
            // 503 au lieu de la réponse : l'app re-sonde (règlement idempotent) et le note au passage suivant.
            if (!(await veoNoter(uid, veoFichiers(body)))) return jsonRes(503, { error: 'Suivi momentanément indisponible — réessaie dans un instant.' })
          }
          else { void filtered; if (!(await refundByJobTerminal(uid, 'veo:' + opTail))) await releaseByJob(uid, 'veo:' + opTail) }
        }
      }
    }
    return new Response(buf, {
      status: googleRes.status,
      headers: { ...CORS, 'Content-Type': ct },
    })
  } catch (err) {
    if (isBillable && gated) await giveBack().catch(() => {})   // audit 14/09 : rendre EXACTEMENT le tiré (drawn hissé), jamais 9999 (sur-restauration = refund-and-keep sur une op multi-étapes réglée)
    console.error('google-ai-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
