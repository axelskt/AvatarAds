// Supabase Edge Function — OpenAI API proxy
// La clé OpenAI est stockée côté serveur (secret Supabase OPENAI_API_KEY).
//
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/openai-proxy
//
// Endpoints supportés (via ?path=) — ALLOWLIST STRICTE :
//   POST ?path=/v1/chat/completions        → GPT-4o (JSON)              [helper, plafonné]
//   POST ?path=/v1/audio/transcriptions    → Whisper (multipart)        [helper, plafonné]
//   POST ?path=/v1/images/generations      → gpt-image                  [FACTURANT]
//   POST ?path=/v1/images/edits            → gpt-image edits (multipart) [FACTURANT]
//
// Sécurité (audit 05/09) :
//   • session utilisateur obligatoire (la clé anon/publiable seule est refusée) ; le moteur de rendu
//     (jeton service_role, déjà vérifié par la passerelle) passe sans profil.
//   • `?path=` validé + résolu contre la base : un `path=@evil.com/…` détournait l'hôte et envoyait la
//     clé OpenAI à l'attaquant (C1). Plus jamais : même origine exigée.
//   • appels facturants : plafond par utilisateur + preuve de débit récent (H3, voir _shared/guard.ts).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate } from '../_shared/guard.ts'

const OPENAI_BASE = 'https://api.openai.com'
const ALLOW = /^\/v1\/(chat\/completions|audio\/transcriptions|images\/(generations|edits))$/
const BILLABLE = /^\/v1\/images\/(generations|edits)$/

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

  if (!auth.isService && auth.userId) {
    const gate = BILLABLE.test(bare)
      ? await billableGate({ userId: auth.userId, proxy: 'openai', requireDebit: true, rateMax: 40, label: bare })
      : await helperGate(auth.userId, 'openai', bare.includes('transcriptions') ? 30 : 80)
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  try {
    const ct = req.headers.get('content-type') ?? ''
    let openaiRes: Response
    if (ct.includes('multipart/form-data')) {
      const incoming = await req.formData()
      const outgoing = new FormData()
      for (const [key, value] of incoming.entries()) outgoing.append(key, value)
      openaiRes = await fetch(up.url, { method: 'POST', headers: { 'Authorization': `Bearer ${openaiKey}` }, body: outgoing })
    } else {
      const rawBody = await req.text()
      openaiRes = await fetch(up.url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: rawBody,
      })
    }
    const body = await openaiRes.text()
    return new Response(body, {
      status: openaiRes.status,
      headers: { ...CORS, 'Content-Type': openaiRes.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    console.error('openai-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
