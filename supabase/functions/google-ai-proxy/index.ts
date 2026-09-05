// Supabase Edge Function — Google AI API proxy
// La clé Google AI est stockée côté serveur (secret Supabase GOOGLE_AI_KEY).
//
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/google-ai-proxy
//
// Endpoints supportés (via ?path=) — ALLOWLIST STRICTE :
//   POST ?path=/v1beta/models/<model>:predict            → Imagen (sync)          [FACTURANT]
//   POST ?path=/v1beta/models/<model>:predictLongRunning → Veo (async start)      [FACTURANT]
//   POST ?path=/v1beta/models/<model>:generateContent    → Gemini / Nano Banana   [FACTURANT]
//   GET  ?path=/v1beta/models/<model>/operations/<id>    → poll d'une opération   [non facturant]
//   GET  ?path=/v1beta/operations/<id>                   → poll d'une opération   [non facturant]
//
// Sécurité (audit 05/09) :
//   • `?path=` validé + résolu contre la base (C2 : `path=@evil.com/…` détournait l'hôte et la clé
//     partait EN CLAIR dans la query string). La clé passe désormais en en-tête x-goog-api-key.
//   • appels facturants : plafond par utilisateur + preuve de débit récent (H3).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate } from '../_shared/guard.ts'

const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com'
// + GET /v1beta/files/<id>:download?alt=media = téléchargement d'une vidéo Veo (clé côté serveur)  [non facturant]
const ALLOW = /^\/v1beta\/(models\/[A-Za-z0-9._-]+:(predict|predictLongRunning|generateContent)|models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+|operations\/[A-Za-z0-9._-]+|files\/[A-Za-z0-9._-]+:download)$/
const BILLABLE = /:(predict|predictLongRunning|generateContent)$/

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
  const isBillable = req.method === 'POST' && BILLABLE.test(bare)
  if (req.method === 'GET' && BILLABLE.test(bare)) return jsonRes(405, { error: 'method_not_allowed' })

  if (!auth.isService && auth.userId) {
    const gate = isBillable
      ? await billableGate({ userId: auth.userId, proxy: 'google', requireDebit: true, rateMax: 30, label: bare })
      : await helperGate(auth.userId, 'google', 240)   // polling toutes les ~3 s pendant une génération Veo
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  try {
    const headers: Record<string, string> = { 'x-goog-api-key': googleKey }
    let googleRes: Response
    if (req.method === 'GET') {
      googleRes = await fetch(up.url, { method: 'GET', headers })
    } else {
      const rawBody = await req.text()
      googleRes = await fetch(up.url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: rawBody })
    }
    const body = await googleRes.text()
    return new Response(body, {
      status: googleRes.status,
      headers: { ...CORS, 'Content-Type': googleRes.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    console.error('google-ai-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
