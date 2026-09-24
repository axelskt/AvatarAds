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
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate, requirePlan, applyReservation, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp, bindJob, releaseByJob, settleByJob, refundByJobTerminal, chainCreditTake, chainCreditGiveBack, wantsNanoChain } from '../_shared/guard.ts'

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
  const isBillable = req.method === 'POST' && isBillablePath(bare)
  if (req.method === 'GET' && /:predictLongRunning$/.test(bare)) return jsonRes(405, { error: 'method_not_allowed' })
  const gated = !auth.isService && !!auth.userId
  const uid = auth.userId as string
  const isSyncBillable = isBillable && /:generateContent$/.test(bare)   // Nano = synchrone
  const isPoll = req.method === 'GET' && /\/operations\/[A-Za-z0-9._-]+$/.test(bare)

  if (gated) {
    const isTts = req.method === 'POST' && /:generateContent$/.test(bare) && /tts/i.test(bare)
    const isChat = req.method === 'POST' && /:generateContent$/.test(bare) && !isTts && !isBillable   // gemini texte/vision (non facturant)
    const gate = isBillable
      ? await billableGate({ userId: uid, proxy: 'google', requireDebit: true, debitMinutes: 120, rateMax: 30, label: bare })
      : isTts
        ? await helperGate(uid, 'google-tts', 60, 3600)   // M3 (06/09) : TTS bridé 60/h (au lieu de 900/10min → drain de quota)
        : isChat
          ? await helperGate(uid, 'google-chat', 40, 600)   // audit 06/09 : chat gemini plafonné 40/10min (au lieu de 900 → drain)
          : await helperGate(uid, 'google', 900)   // polling ≤10 min par génération Veo, plusieurs en série
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  // Helper LLM/TTS non facturant (audit chaînes 15/09) : le MODÈLE est dans le PATH → un compte pouvait appeler
  // gemini-2.5-PRO:generateContent gratuitement sur la clé du proprio (helperGate = rate-limit seul). On restreint le
  // chemin helper à la famille 'flash' (l'app n'utilise que gemini-2.5-flash + *-flash-preview-tts). Le facturant (images/Veo) n'est pas concerné.
  if (gated && !isBillable && /:generateContent$/.test(bare) && !/flash/i.test(bare)) {
    return jsonRes(403, { error: 'modèle non autorisé sur cet endpoint (famille flash uniquement)' })
  }

  // Audit métier 14/09 (Phase 2) : Veo 3.1 FAST (Express « Pro ») = Pro/Élite. Veo Lite reste Starter+ → on
  // ne gate QUE le modèle 'fast' (pas la famille veo-3.1). Résolution 1080p / extensions >8 s sont des paliers
  // par PARAMÈTRE de body (non-chemin) et NE sont PAS gatés ici (risque de 402 l'extension légitime).
  if (gated && isBillable && /:predictLongRunning$/.test(bare) && /veo-3\.1-fast/i.test(bare)) {
    const g = await requirePlan(uid, ['pro', 'elite'], 'Veo Pro (rapide)'); if (!g.ok) return jsonRes(g.status, { error: g.error })
  }

  let drawn = 0   // L1 (audit 14/09) : hissé HORS du try — le catch le référence (sinon ReferenceError → réserve non rendue + 500 sans CORS)
  let drawnOp: string | undefined
  let chainOp: string | null = null   // droit d'upscale du palier 4K consommé (tirage 0) — rendu si Nano échoue
  let settled = false, gaveBack = false
  // Rend UNE seule fois, jamais après un règlement : le droit s'il a été pris, sinon le tirage (jamais un tirage nul,
  // que release_reservation arrondirait à 1 crédit rendu).
  const giveBack = async () => {
    if (settled || gaveBack) return
    gaveBack = true
    if (chainOp) await chainCreditGiveBack(uid, chainOp)
    else if (drawn > 0) await releaseOp(uid, drawnOp, drawn)
  }
  try {
    const headers: Record<string, string> = { 'x-goog-api-key': googleKey }
    let googleRes: Response
    if (req.method === 'GET') {
      googleRes = await fetch(up.url, { method: 'GET', headers })
    } else {
      const rawBody = await req.text()
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
          else if (_res === '1080p') { const g = await requirePlan(uid, ['pro', 'elite'], 'Veo 1080p'); if (!g.ok) return jsonRes(g.status, { error: g.error }) }
        }
        // Nano marqué x-aa-chain (upscale du palier 4K) : le droit déjà payé (5 tirés par openai-proxy) passe avant un
        // nouveau tirage ; pris d'abord sur l'op du palier (x-aa-op). Un Nano non marqué tire ses 5 comme avant.
        if (isSyncBillable && wantsNanoChain(req)) chainOp = await chainCreditTake(uid, opFromReq(req))
        if (chainOp) { drawn = 0; drawnOp = chainOp }
        else { drawn = costFor(bare, rawBody); const r = await applyReservation({ req, userId: uid, proxy: 'google', cost: drawn, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }); drawnOp = r.opId }
      } else if (gated && /:generateContent$/.test(bare) && !/tts/i.test(bare)) {
        // Helper chat non facturant : plafond de tokens de sortie (audit chaînes 15/09).
        try { const b = JSON.parse(rawBody); b.generationConfig = { ...(b.generationConfig || {}), maxOutputTokens: Math.min(Number(b?.generationConfig?.maxOutputTokens) || 4096, 4096) }; sendBody = JSON.stringify(b) } catch { /* body non-JSON : laissé tel quel */ }
      }
      googleRes = await fetch(up.url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: sendBody })
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
        // Veo : soumission async. 2xx → on lie l'op au job ; erreur → on rend l'op tirée.
        if (googleRes.ok) { const name = (body.match(/operations\/([A-Za-z0-9._-]+)/) || [])[1] || ''; if (name) await bindJob(uid, drawnOp, 'veo:' + name, drawn) }
        else await releaseOp(uid, drawnOp, drawn)
      } else if (isPoll && googleRes.ok && /"done"\s*:\s*true/.test(body)) {
        // Poll d'une opération Veo terminée. Livrée = une VIDÉO est présente (octets, uri ou files/…). « done » sans vidéo
        // (erreur, ou vidéo bloquée par le filtre RAI : raiMediaFilteredCount > 0) = échec NON facturé par Google →
        // remboursement SERVEUR (comme fal-proxy : refundByJobTerminal, sinon on rend la réserve) au lieu d'un règlement
        // qui faisait perdre les crédits au client (revue du 23/09/2026).
        if (opTail) {
          const hasVideo = /"bytesBase64Encoded"\s*:\s*"|"uri"\s*:\s*"|files\/[A-Za-z0-9_-]+/.test(body)
          const filtered = /"raiMediaFilteredCount"\s*:\s*[1-9]/.test(body)
          if (/"error"/.test(body) || filtered || !hasVideo) { if (!(await refundByJobTerminal(uid, 'veo:' + opTail))) await releaseByJob(uid, 'veo:' + opTail) }
          else await settleByJob(uid, 'veo:' + opTail)
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
