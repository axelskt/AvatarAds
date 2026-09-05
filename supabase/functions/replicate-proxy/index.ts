// Supabase Edge Function — Replicate proxy (Flux · Kontext img2img · upscale Clarity)
//
// Audit supply-chain 06/09/2026 (SC-1) : cette fonction n'existait QUE dans Supabase (déployée à la main,
// jamais dans le dépôt) — sans auth applicative, sans débit, sans plafond. La clé publiable passait la
// passerelle et le handler tournait : n'importe qui lançait des générations facturées à AvatarAds.
// Rapatriée ici, sur la garde partagée : session obligatoire, plafond, preuve de débit, RÉSERVATION
// (coût borne basse tiré sur l'op `x-aa-op`, réglé à la livraison). Le mode `faceswap` (Replicate) est
// retiré : plus aucun appelant (le changement de tête passe par Nano Banana).
//
// Corps JSON :
//   { poll: '<prediction id>' }                                   → statut d'une prédiction (helper)
//   { mode:'flux', prompt, aspect_ratio?, tier?: eco|pro|ultra }  → texte → image        [FACTURANT]
//   { mode:'kontext', prompt, input_image, aspect_ratio? }        → img2img               [FACTURANT]
//   { image, scale_factor? }                                       → upscale Clarity (≤2×) [FACTURANT]

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, billableGate, helperGate, applyReservation, settleReservation, resolveOp } from '../_shared/guard.ts'

const FLUX: Record<string, { slug: string; raw: boolean; cost: number }> = {
  eco:   { slug: 'black-forest-labs/flux-dev',           raw: false, cost: 1 },
  pro:   { slug: 'black-forest-labs/flux-1.1-pro',       raw: false, cost: 3 },
  ultra: { slug: 'black-forest-labs/flux-1.1-pro-ultra', raw: true,  cost: 3 },
}
const ASPECTS = new Set(['9:16', '16:9', '1:1', '4:5', '5:4', '3:4', '4:3', '2:3', '3:2', '21:9', '9:21'])
const MAX_BODY = 12_000_000            // data URL d'image de référence ≤ ~9 Mo
const isImageRef = (v: unknown) => typeof v === 'string' && v.length <= MAX_BODY && (/^data:image\/[a-z0-9.+-]+;base64,/i.test(v) || /^https:\/\/[^\s]+$/i.test(v))
const short = (s: unknown) => String(s ?? '').slice(0, 300)

function parseOut(d: Record<string, unknown>) {
  const o = d.output
  const out = Array.isArray(o) ? o[o.length - 1] : o
  if (d.status === 'succeeded' && out) return { url: out as string }
  return { id: d.id as string, status: d.status as string }
}

async function replicate(slug: string, input: unknown, H: Record<string, string>) {
  const r = await fetch(`https://api.replicate.com/v1/models/${slug}/predictions`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'wait' }, body: JSON.stringify({ input }),
  })
  const d = await r.json().catch(() => ({})) as Record<string, unknown>
  if (!r.ok || d?.error) return { error: short(d?.error || d?.detail || ('HTTP ' + r.status)) }
  return parseOut(d)
}

async function replicateVersioned(slug: string, input: unknown, H: Record<string, string>) {
  const mr = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: H })
  const md = await mr.json().catch(() => ({})) as { latest_version?: { id?: string } }
  const version = md?.latest_version?.id
  if (!version) return { error: 'version introuvable pour ' + slug }
  const r = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'wait' }, body: JSON.stringify({ version, input }),
  })
  const d = await r.json().catch(() => ({})) as Record<string, unknown>
  if (!r.ok || d?.error) return { error: short(d?.error || d?.detail || ('HTTP ' + r.status)) }
  return parseOut(d)
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return jsonRes(405, { error: 'method_not_allowed' })

  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.isService && !auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })
  const gated = !auth.isService && !!auth.userId
  const uid = auth.userId as string

  const TOKEN = Deno.env.get('REPLICATE_API_TOKEN') ?? ''
  if (!TOKEN) return jsonRes(500, { error: 'replicate_not_configured' })
  const H = { Authorization: `Bearer ${TOKEN}` }

  const raw = await req.text()
  if (raw.length > MAX_BODY) return jsonRes(413, { error: 'too_large' })
  let body: Record<string, unknown>
  try { body = JSON.parse(raw); if (!body || typeof body !== 'object') throw 0 } catch { return jsonRes(400, { error: 'bad_request' }) }

  try {
    // ── Poll (helper, non facturant) : règle la réservation quand la prédiction a abouti ──
    if (body.poll !== undefined) {
      const id = String(body.poll)
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return jsonRes(400, { error: 'bad_poll_id' })
      if (gated) { const g = await helperGate(uid, 'replicate-poll', 600, 600); if (!g.ok) return jsonRes(g.status, { error: g.error }) }
      const r = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: H })
      const d = await r.json().catch(() => ({})) as Record<string, unknown>
      const o = d.output; const out = Array.isArray(o) ? o[o.length - 1] : o
      const ok = d.status === 'succeeded' && !!out
      if (ok && gated) { const op = await resolveOp(uid, req); if (op) await settleReservation(uid, op) }
      return jsonRes(200, { status: d.status ?? null, url: ok ? out : null, error: d.error ? short(d.error) : null })
    }

    // ── Facturant : mode + validation AVANT toute dépense ──
    const mode = body.mode === 'kontext' ? 'kontext' : (body.mode === 'flux' || (body.prompt && !body.image)) ? 'flux' : 'upscale'
    const aspect_ratio = ASPECTS.has(String(body.aspect_ratio)) ? String(body.aspect_ratio) : '9:16'
    let cost = 1
    let run: () => Promise<Record<string, unknown>>

    if (mode === 'kontext') {
      const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 2000) : ''
      if (!prompt || !isImageRef(body.input_image)) return jsonRes(400, { error: 'prompt ou image de référence manquant' })
      run = () => replicate('black-forest-labs/flux-kontext-pro', { prompt, input_image: body.input_image, aspect_ratio, output_format: 'jpg', safety_tolerance: 2 }, H)
    } else if (mode === 'flux') {
      const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 2000) : ''
      if (!prompt) return jsonRes(400, { error: 'prompt manquant' })
      const tier = FLUX[String(body.tier)] || FLUX.ultra
      cost = tier.cost
      const input: Record<string, unknown> = { prompt, aspect_ratio, output_format: 'jpg' }
      if (tier.slug.includes('flux-dev')) {
        Object.assign(input, { num_inference_steps: 30, guidance: 3, go_fast: true, disable_safety_checker: true, megapixels: '1' })
      } else {
        input.safety_tolerance = Math.min(6, Math.max(1, Number(body.safety_tolerance) || 6))
        if (tier.raw) input.raw = body.raw !== false
      }
      run = () => replicate(tier.slug, input, H)
    } else {
      // Restauration HD : Clarity ultra-fidèle (creativity minimale, resemblance max), scale plafonné à 2 —
      // au-delà, Clarity hallucine les petits visages. Repli Real-ESRGAN si Clarity échoue.
      if (!isImageRef(body.image)) return jsonRes(400, { error: 'image manquante' })
      const image = body.image
      const scale_factor = Math.min(Number(body.scale_factor) || 2, 2)
      run = async () => {
        let up = await replicateVersioned('philz1337x/clarity-upscaler', {
          image, scale_factor, dynamic: 2, creativity: 0.05, resemblance: 3,
          prompt: 'highly detailed, sharp, natural realistic skin texture with visible pores, keep the exact same identity, same face, same facial features',
          negative_prompt: 'plastic skin, smooth skin, airbrushed, waxy, blurry, different person, changed face, changed identity, deformed face, distorted face, distorted facial features, mutated face, melted face, asymmetric eyes, malformed eyes, crossed eyes, warped features, twisted face, extra details, oversharpened, hallucinated details, extra fingers, mutated hands',
          num_inference_steps: 14, scheduler: 'DPM++ 3M SDE Karras',
        }, H)
        if ((up as { error?: string }).error) up = await replicate('nightmareai/real-esrgan', { image, scale: scale_factor, face_enhance: false }, H)
        return up
      }
    }

    if (gated) {
      const g = await billableGate({ userId: uid, proxy: 'replicate', requireDebit: true, debitMinutes: 60, rateMax: 30, label: mode })
      if (!g.ok) return jsonRes(g.status, { error: g.error })
      const r = await applyReservation({ req, userId: uid, proxy: 'replicate', cost, label: mode })
      if (!r.ok) return jsonRes(r.status, { error: r.error })
    }

    const out = await run()
    if (gated && typeof out.url === 'string') { const op = await resolveOp(uid, req); if (op) await settleReservation(uid, op) }
    return jsonRes(200, out)
  } catch (e) {
    console.error('replicate-proxy error:', e)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
