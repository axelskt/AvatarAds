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
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate, userPlan, applyReservation, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp } from '../_shared/guard.ts'

const OPENAI_BASE = 'https://api.openai.com'
const ALLOW = /^\/v1\/(chat\/completions|audio\/transcriptions|images\/(generations|edits))$/
const BILLABLE = /^\/v1\/images\/(generations|edits)$/
// Endpoints « helper » LLM (chat/completions) : NON facturants (helperGate = rate-limit seul, aucun crédit) → un compte
// pouvait relayer un modèle/prompt ARBITRAIRE vers la clé OpenAI du proprio (drain de coût, audit chaînes 15/09). On borne
// le COÛT par appel : allowlist de modèle (l'app n'utilise que ceux-ci ; hors liste → coercé vers le moins cher) + plafond tokens.
const OPENAI_HELPER_MODELS = new Set(['gpt-4o', 'gpt-4o-mini'])
const OPENAI_HELPER_MAX_TOKENS = 4096
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
    const isTranscribe = bare.includes('transcriptions')
    // M1 (audit 14/09) : Whisper est un fournisseur PAYANT. Le client réserve la transcription aux plans
    // payants (whisperTranscribe) mais le serveur ne le gardait pas → un compte Free l'appelait direct.
    // On aligne le serveur sur le produit : Starter+ / owner / dev (comme derush-transcribe pour Scribe).
    if (isTranscribe) {
      const { plan, isOwner, err } = await userPlan(uid)
      if (!err && !isOwner && !['starter', 'pro', 'elite', 'developer', 'byok'].includes(plan)) {   // err = hoquet DB → fail-open (ne pas 403 un abonné pendant un incident)
        return jsonRes(403, { error: 'La transcription est réservée aux plans payants.' })
      }
    }
    const gate = isBillable
      ? await billableGate({ userId: uid, proxy: 'openai', requireDebit: true, rateMax: 40, label: bare })
      : await helperGate(uid, 'openai', isTranscribe ? 12 : 20)   // round3 (06/09) : GPT-4o/Whisper payants → 20/12 par 10 min (drain réduit)
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  let drawn = 0   // L1 (audit 14/09) : hissé HORS du try — le catch le référence (sinon ReferenceError → réserve non rendue + 500 sans CORS)
  let drawnOp: string | undefined   // l'op PRÉCISE tirée — resolveOp ne la retrouve plus une fois à réserve 0 (audit 06/09)
  try {
    const ct = req.headers.get('content-type') ?? ''
    let openaiRes: Response
    if (ct.includes('multipart/form-data')) {
      const incoming = await req.formData()
      const outgoing = new FormData()
      let q = 'medium', n = 1
      for (const [k, v] of incoming.entries()) { if (k === 'quality') q = String(v); if (k === 'n') n = Math.max(1, parseInt(String(v)) || 1); outgoing.append(k, v) }
      if (isBillable && gated) { drawn = imgCost(q) * n; const r = await applyReservation({ req, userId: uid, proxy: 'openai', cost: drawn, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }); drawnOp = r.opId }
      openaiRes = await fetch(up.url, { method: 'POST', headers: { 'Authorization': `Bearer ${openaiKey}` }, body: outgoing })
    } else {
      const rawBody = await req.text()
      let sendBody = rawBody
      if (isBillable && gated) {
        let cost = 3
        try { const b = JSON.parse(rawBody); cost = imgCost(String(b.quality || 'medium')) * Math.max(1, Number(b.n) || 1) } catch { /* défaut 3 */ }
        drawn = cost
        const r = await applyReservation({ req, userId: uid, proxy: 'openai', cost, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }); drawnOp = r.opId
      } else if (gated && bare.includes('/chat/completions')) {
        // Helper LLM non facturant : borne le coût (audit chaînes 15/09) — modèle hors allowlist coercé vers le moins cher + plafond tokens.
        try {
          const b = JSON.parse(rawBody)
          if (!OPENAI_HELPER_MODELS.has(String(b?.model || ''))) b.model = 'gpt-4o-mini'
          b.max_tokens = Math.min(Number(b.max_tokens) || OPENAI_HELPER_MAX_TOKENS, OPENAI_HELPER_MAX_TOKENS)
          sendBody = JSON.stringify(b)
        } catch { /* body non-JSON : laissé tel quel (OpenAI le rejettera) */ }
      }
      openaiRes = await fetch(up.url, { method: 'POST', headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, body: sendBody })
    }
    const body = await openaiRes.text()
    // Images gpt-image = SYNCHRONE : un 2xx = image livrée → on règle la réservation (op non remboursable).
    if (isBillable && gated && openaiRes.ok) { if (drawnOp) await settleReservation(uid, drawnOp) }   // image livrée (synchrone) → op non remboursable
    if (isBillable && gated && !openaiRes.ok) await releaseOp(uid, drawnOp, drawn)   // amont en erreur → on rend l'op TIRÉE (resolveOp ne la retrouverait pas à réserve 0)
    return new Response(body, {
      status: openaiRes.status,
      headers: { ...CORS, 'Content-Type': openaiRes.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    if (isBillable && gated) await releaseOp(uid, drawnOp, drawn).catch(() => {})   // exception → rendre EXACTEMENT le tiré (drawn hissé), jamais 9999 (sur-restauration)
    console.error('openai-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
