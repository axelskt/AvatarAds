// Supabase Edge Function — Google AI API proxy
// La clé Google AI est stockée côté serveur (secret Supabase GOOGLE_AI_KEY).
//
// Endpoints (via ?path=) — ALLOWLIST STRICTE :
//   POST /v1beta/models/<m>:predict            → Imagen (sync)                      [FACTURANT sync]
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
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate, applyReservation, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp, bindJob, releaseByJob, settleByJob } from '../_shared/guard.ts'

const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com'
const ALLOW = /^\/v1beta\/(models\/[A-Za-z0-9._-]+:(predict|predictLongRunning|generateContent)|models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+|operations\/[A-Za-z0-9._-]+|files\/[A-Za-z0-9._-]+:download)$/
// FACTURANT : predict/predictLongRunning, + generateContent SEULEMENT pour un modèle d'image (Nano « *-image »).
const isBillablePath = (bare: string) =>
  /:(predict|predictLongRunning)$/.test(bare) || /\/models\/[A-Za-z0-9._-]*image[A-Za-z0-9._-]*:generateContent$/i.test(bare)

// Coût serveur (borne basse, jamais > coût réel → ne 402 jamais un flux légitime) :
function costFor(bare: string, body: string): number {
  if (/gemini-[A-Za-z0-9._-]*image[A-Za-z0-9._-]*:generateContent$/i.test(bare)) return 5   // Nano Banana Pro = 5
  if (/:predict$/.test(bare)) return 3                                                       // Imagen
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
  if (req.method === 'GET' && /:(predict|predictLongRunning)$/.test(bare)) return jsonRes(405, { error: 'method_not_allowed' })
  const gated = !auth.isService && !!auth.userId
  const uid = auth.userId as string
  const isSyncBillable = isBillable && /:(predict|generateContent)$/.test(bare)   // Imagen/Nano = synchrone
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

  let drawn = 0   // L1 (audit 14/09) : hissé HORS du try — le catch le référence (sinon ReferenceError → réserve non rendue + 500 sans CORS)
  let drawnOp: string | undefined
  try {
    const headers: Record<string, string> = { 'x-goog-api-key': googleKey }
    let googleRes: Response
    if (req.method === 'GET') {
      googleRes = await fetch(up.url, { method: 'GET', headers })
    } else {
      const rawBody = await req.text()
      if (isBillable && gated) { drawn = costFor(bare, rawBody); const r = await applyReservation({ req, userId: uid, proxy: 'google', cost: drawn, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }); drawnOp = r.opId }
      googleRes = await fetch(up.url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: rawBody })
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
    // Les images (Imagen/Nano) sont SYNCHRONES → on règle/libère l'op PRÉCISE tirée dans cette requête.
    if (gated) {
      const opTail = (bare.match(/operations\/([A-Za-z0-9._-]+)/) || [])[1] || ''   // depuis le path (poll)
      if (isSyncBillable) {
        // Imagen/Nano synchrones : 2xx → op livrée (non remboursable) ; erreur → on rend l'op tirée.
        if (googleRes.ok) { if (drawnOp) await settleReservation(uid, drawnOp) }
        else await releaseOp(uid, drawnOp, drawn)
      } else if (isBillable) {
        // Veo : soumission async. 2xx → on lie l'op au job ; erreur → on rend l'op tirée.
        if (googleRes.ok) { const name = (body.match(/operations\/([A-Za-z0-9._-]+)/) || [])[1] || ''; if (name) await bindJob(uid, drawnOp, 'veo:' + name, drawn) }
        else await releaseOp(uid, drawnOp, drawn)
      } else if (isPoll && googleRes.ok && /"done"\s*:\s*true/.test(body)) {
        // Poll d'une opération Veo terminée : livrée (pas d'erreur) → règle le job ; en erreur → rend le job.
        if (opTail) { if (/"error"/.test(body)) await releaseByJob(uid, 'veo:' + opTail); else await settleByJob(uid, 'veo:' + opTail) }
      }
    }
    return new Response(buf, {
      status: googleRes.status,
      headers: { ...CORS, 'Content-Type': ct },
    })
  } catch (err) {
    if (isBillable && gated) await releaseOp(uid, drawnOp, drawn).catch(() => {})   // audit 14/09 : rendre EXACTEMENT le tiré (drawn hissé), jamais 9999 (sur-restauration = refund-and-keep sur une op multi-étapes réglée)
    console.error('google-ai-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
