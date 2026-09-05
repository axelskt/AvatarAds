// Supabase Edge Function — remove.bg proxy (détourage)
//
// Audit supply-chain 06/09/2026 (SC-2) : cette fonction n'existait QUE dans Supabase (déployée à la main,
// jamais dans le dépôt). Elle exigeait bien une session, mais sans aucun plafond : un compte Free pouvait
// vider le solde remove.bg en boucle. Rapatriée ici, sur la garde partagée : session + plafond 20/h par
// utilisateur (le détourage n'est pas débité côté client — il accompagne une génération déjà payée).
//
// Corps JSON : { image_url?: 'https://…', image_b64?: 'data:image/…;base64,…' | base64 brut, size?: 'auto'|'preview' }
// Réponse   : PNG binaire (fond transparent) si succès, sinon JSON { error }.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, helperGate } from '../_shared/guard.ts'

const MAX_BODY = 16_000_000   // image en base64 ≤ ~12 Mo

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return jsonRes(405, { error: 'method_not_allowed' })

  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.isService && !auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })
  if (!auth.isService && auth.userId) {
    const g = await helperGate(auth.userId, 'removebg', 20, 3600)
    if (!g.ok) return jsonRes(g.status, { error: g.error })
  }

  const key = Deno.env.get('REMOVEBG_KEY') ?? ''
  if (!key) return jsonRes(500, { error: 'removebg_not_configured' })

  const raw = await req.text()
  if (raw.length > MAX_BODY) return jsonRes(413, { error: 'too_large' })
  let body: { image_url?: unknown; image_b64?: unknown; size?: unknown }
  try { body = JSON.parse(raw); if (!body || typeof body !== 'object') throw 0 } catch { return jsonRes(400, { error: 'bad_request' }) }

  const form = new FormData()
  if (typeof body.image_url === 'string' && /^https:\/\/[^\s]+$/i.test(body.image_url)) {
    form.append('image_url', body.image_url)
  } else if (typeof body.image_b64 === 'string' && body.image_b64.length > 0) {
    form.append('image_file_b64', body.image_b64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''))
  } else {
    return jsonRes(400, { error: 'image_url ou image_b64 requis' })
  }
  form.append('size', body.size === 'preview' ? 'preview' : 'auto')
  form.append('format', 'png')

  try {
    const rb = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key }, body: form })
    if (!rb.ok) {
      const errText = (await rb.text()).slice(0, 300)
      return jsonRes(rb.status >= 400 && rb.status < 600 ? rb.status : 502, { error: 'remove.bg: ' + errText })
    }
    return new Response(await rb.arrayBuffer(), { status: 200, headers: { ...CORS, 'Content-Type': 'image/png' } })
  } catch (err) {
    console.error('removebg-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
