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
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate, userPlan, applyReservation, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp, wantsNanoChain, chainCreditAdd, CHAIN_NANO_COST, wantsOmniStart, omniStartAdd } from '../_shared/guard.ts'

const OPENAI_BASE = 'https://api.openai.com'
const ALLOW = /^\/v1\/(chat\/completions|audio\/transcriptions|images\/(generations|edits))$/
const BILLABLE = /^\/v1\/images\/(generations|edits)$/
// Endpoints « helper » LLM (chat/completions) : NON facturants (helperGate = rate-limit seul, aucun crédit) → un compte
// pouvait relayer un modèle/prompt ARBITRAIRE vers la clé OpenAI du proprio (drain de coût, audit chaînes 15/09). On borne
// le COÛT par appel : allowlist de modèle (l'app n'utilise que ceux-ci ; hors liste → coercé vers le moins cher) + plafond tokens.
const OPENAI_HELPER_MODELS = new Set(['gpt-4o', 'gpt-4o-mini'])
const OPENAI_HELPER_MAX_TOKENS = 4096
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
  let drawnReal = 0   // montant RÉELLEMENT tiré (0 si fail-open / ombre) — seul lui ouvre la remise image de départ Omni
  let drawnOp: string | undefined   // l'op PRÉCISE tirée — resolveOp ne la retrouve plus une fois à réserve 0 (audit 06/09)
  // Palier 4K (x-aa-chain: nano4k, plans Pro/Élite comme dans l'app depuis le 24/09) : seulement une image gpt low/medium, n=1 → tire 5 et
  // crée un droit d'upscale Nano. Toute autre combinaison = tirage normal, aucun droit (pas de gpt high + Nano pour 5).
  let chain = false, chainPlanOk = false
  if (isBillable && gated && wantsNanoChain(req)) {
    const { plan, isOwner, err } = await userPlan(uid)
    chainPlanOk = !err && (isOwner || ['pro', 'byok', 'elite', 'developer'].includes(plan))
  }
  const chainCost = (q: string, n: number) => (chainPlanOk && n === 1 && (q === 'medium' || q === 'low')) ? (chain = true, CHAIN_NANO_COST) : imgCost(q) * n
  try {
    const ct = req.headers.get('content-type') ?? ''
    let openaiRes: Response
    if (ct.includes('multipart/form-data')) {
      const incoming = await req.formData()
      const outgoing = new FormData()
      if (isBillable && gated) {
        // fichiers (image, image[], mask) : tous transmis ; champs texte : UNE valeur chacun, bornée, celle qui est facturée
        const text: Record<string, string> = {}
        for (const [k, v] of incoming.entries()) { if (typeof v === 'string') text[k] = v; else outgoing.append(k, v) }
        const nm = normImage(text)
        if ('error' in nm) return jsonRes(400, { error: nm.error })
        for (const [k, v] of Object.entries({ ...text, ...nm.fields })) outgoing.append(k, v)
        drawn = chainCost(nm.q, nm.n); const r = await applyReservation({ req, userId: uid, proxy: 'openai', cost: drawn, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }); drawnOp = r.opId; drawnReal = r.drawn ?? 0
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
        Object.assign(b, nm.fields, { n: nm.n })
        sendBody = JSON.stringify(b)
        drawn = chainCost(nm.q, nm.n)
        const r = await applyReservation({ req, userId: uid, proxy: 'openai', cost: drawn, label: bare }); if (!r.ok) return jsonRes(r.status, { error: r.error }); drawnOp = r.opId; drawnReal = r.drawn ?? 0
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
    if (isBillable && gated && openaiRes.ok) {   // image livrée (synchrone) → op non remboursable
      if (drawnOp) {
        await settleReservation(uid, drawnOp)
        if (chain) await chainCreditAdd(uid, drawnOp, 1)
        // Image de départ d'Express Omni OFFERTE (Axel 25/09) : ce qui vient d'être tiré sera déduit du tirage de la vidéo
        // (draw_omni_reservation). Seulement une image low/medium (≤ 3), op « express-omni », une fois (garde SQL).
        else if (wantsOmniStart(req) && drawnReal > 0 && drawnReal <= 3) await omniStartAdd(uid, drawnOp, drawnReal)
      }
    }
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
