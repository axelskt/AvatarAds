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
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate, applyReservation, settleReservation, opFromReq } from '../_shared/guard.ts'

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
    let dur = 0, mult = 1
    try { const b = JSON.parse(body); dur = Number(b?.parameters?.durationSeconds) || 0; if (String(b?.parameters?.resolution) === '1080p') mult = 2 } catch { /* */ }
    return dur > 0 ? Math.ceil(dur * rate * mult) : Math.ceil(rate)   // borne basse = 1 s si durée absente
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
    const gate = isBillable
      ? await billableGate({ userId: uid, proxy: 'google', requireDebit: true, debitMinutes: 120, rateMax: 30, label: bare })
      : await helperGate(uid, 'google', 900)   // polling ≤10 min par génération Veo, plusieurs en série
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  try {
    const headers: Record<string, string> = { 'x-goog-api-key': googleKey }
    let googleRes: Response
    if (req.method === 'GET') {
      googleRes = await fetch(up.url, { method: 'GET', headers })
    } else {
      const rawBody = await req.text()
      if (isBillable && gated) { const r = await applyReservation({ req, userId: uid, proxy: 'google', cost: costFor(bare, rawBody), label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }) }
      googleRes = await fetch(up.url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: rawBody })
    }
    const body = await googleRes.text()
    // Règlement de la réservation quand la génération a abouti :
    if (gated) {
      const op = opFromReq(req)
      if (op) {
        if (isSyncBillable && googleRes.ok) await settleReservation(uid, op)                          // Imagen/Nano synchrones
        else if (isPoll && googleRes.ok && /"done"\s*:\s*true/.test(body) && !/"error"/.test(body)) await settleReservation(uid, op)   // Veo : opération terminée
      }
    }
    return new Response(body, {
      status: googleRes.status,
      headers: { ...CORS, 'Content-Type': googleRes.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    console.error('google-ai-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
