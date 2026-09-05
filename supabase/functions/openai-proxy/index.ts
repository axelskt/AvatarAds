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
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate, applyReservation, settleReservation, opFromReq } from '../_shared/guard.ts'

const OPENAI_BASE = 'https://api.openai.com'
const ALLOW = /^\/v1\/(chat\/completions|audio\/transcriptions|images\/(generations|edits))$/
const BILLABLE = /^\/v1\/images\/(generations|edits)$/
const imgCost = (q: string) => q === 'low' ? 1 : q === 'high' ? 5 : 3   // gpt-image : low 1 / medium 3 / high 5

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return jsonRes(405, { error: 'method_not_allowed' })

  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.isService && !auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })

  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!openaiKey) return jsonRes(500, { error: 'OPENAI_API_KEY not configured in Supabase secrets' })

  const url = new URL(req.url)
  const up = safeUpstream(OPENAI_BASE, url.searchParams.get('path') ?? '/v1/chat/completions', ALLOW)
  if (!up.ok) return jsonRes(400, { error: 'path refusé : ' + up.reason })
  const bare = new URL(up.url).pathname
  const isBillable = BILLABLE.test(bare)
  const gated = !auth.isService && !!auth.userId
  const uid = auth.userId as string

  if (gated) {
    const gate = isBillable
      ? await billableGate({ userId: uid, proxy: 'openai', requireDebit: true, rateMax: 40, label: bare })
      : await helperGate(uid, 'openai', bare.includes('transcriptions') ? 30 : 80)
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  try {
    const ct = req.headers.get('content-type') ?? ''
    let openaiRes: Response
    if (ct.includes('multipart/form-data')) {
      const incoming = await req.formData()
      const outgoing = new FormData()
      let q = 'medium', n = 1
      for (const [k, v] of incoming.entries()) { if (k === 'quality') q = String(v); if (k === 'n') n = Math.max(1, parseInt(String(v)) || 1); outgoing.append(k, v) }
      if (isBillable && gated) { const r = await applyReservation({ req, userId: uid, proxy: 'openai', cost: imgCost(q) * n, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }) }
      openaiRes = await fetch(up.url, { method: 'POST', headers: { 'Authorization': `Bearer ${openaiKey}` }, body: outgoing })
    } else {
      const rawBody = await req.text()
      if (isBillable && gated) {
        let cost = 3
        try { const b = JSON.parse(rawBody); cost = imgCost(String(b.quality || 'medium')) * Math.max(1, Number(b.n) || 1) } catch { /* défaut 3 */ }
        const r = await applyReservation({ req, userId: uid, proxy: 'openai', cost, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error })
      }
      openaiRes = await fetch(up.url, { method: 'POST', headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, body: rawBody })
    }
    const body = await openaiRes.text()
    // Images gpt-image = SYNCHRONE : un 2xx = image livrée → on règle la réservation (op non remboursable).
    if (isBillable && gated && openaiRes.ok) { const op = opFromReq(req); if (op) await settleReservation(uid, op) }
    return new Response(body, {
      status: openaiRes.status,
      headers: { ...CORS, 'Content-Type': openaiRes.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    console.error('openai-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
