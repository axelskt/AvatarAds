// Supabase Edge Function — ElevenLabs API proxy
// La clé ElevenLabs est stockée côté serveur (secret Supabase ELEVENLABS_API_KEY).
//
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/elevenlabs-proxy
//
// Endpoints supportés (via ?path=) — ALLOWLIST STRICTE :
//   GET  ?path=/v1/user                          → infos compte / test     [non facturant]
//   GET  ?path=/v1/voices                        → liste des voix          [non facturant]
//   POST ?path=/v1/text-to-speech/{voice_id}     → TTS (JSON → audio)      [FACTURANT]
//   POST ?path=/v1/speech-to-speech/{voice_id}   → STS (multipart → audio) [FACTURANT]
//
// Sécurité (audit 05/09) — cette fonction n'avait AUCUNE authentification applicative (C3/H2) : la clé
// anon/publiable du site suffisait à drainer le quota ElevenLabs, et `path=@evil.com/…` exfiltrait la clé.
//   • session utilisateur obligatoire (moteur de rendu = service_role, passe sans profil) ;
//   • `?path=` validé + résolu contre la base (même origine exigée) ;
//   • TTS/STS : plafond par utilisateur + preuve de débit récent (H3).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, safeUpstream, billableGate, helperGate } from '../_shared/guard.ts'

const EL_BASE = 'https://api.elevenlabs.io'
// Chemins réellement utilisés par l'app (traçage 05/09) : TTS, STS, Voice Design (text-to-voice/*), clonage (voices/add).
const ALLOW = /^\/v1\/(user|voices|voices\/add|text-to-voice\/(create-previews|create-voice-from-preview)|text-to-speech\/[A-Za-z0-9]+(\/stream)?|speech-to-speech\/[A-Za-z0-9]+(\/stream)?)$/
const BILLABLE = /^\/v1\/(text-to-speech|speech-to-speech|text-to-voice|voices\/add)/

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST' && req.method !== 'GET') return jsonRes(405, { error: 'method_not_allowed' })

  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.isService && !auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })

  const elKey = Deno.env.get('ELEVENLABS_API_KEY') ?? ''
  if (!elKey) return jsonRes(500, { error: 'ELEVENLABS_API_KEY not configured in Supabase secrets' })

  const url = new URL(req.url)
  const up = safeUpstream(EL_BASE, url.searchParams.get('path') ?? '/v1/user', ALLOW)
  if (!up.ok) return jsonRes(400, { error: 'path refusé : ' + up.reason })
  const bare = new URL(up.url).pathname
  const isBillable = req.method === 'POST' && BILLABLE.test(bare)
  if (req.method === 'GET' && BILLABLE.test(bare)) return jsonRes(405, { error: 'method_not_allowed' })
  if (req.method === 'POST' && !BILLABLE.test(bare)) return jsonRes(405, { error: 'method_not_allowed' })

  if (!auth.isService && auth.userId) {
    // Traçage 05/09 : les flux ElevenLabs vivants (voix Cartoon, Voice Design, pré-écoute de voix) ne sont
    // PAS débités côté client par conception → pas d'exigence de débit ici (elle casserait ces flux), mais un
    // plafond serré par utilisateur : l'abus anonyme (C3/H2) est déjà fermé par l'auth obligatoire.
    const gate = isBillable
      ? await billableGate({ userId: auth.userId, proxy: 'elevenlabs', requireDebit: false, rateMax: 20, label: bare })
      : await helperGate(auth.userId, 'elevenlabs', 60)
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  try {
    const ct = req.headers.get('content-type') ?? ''
    let elRes: Response
    if (req.method === 'GET') {
      elRes = await fetch(up.url, { method: 'GET', headers: { 'xi-api-key': elKey } })
    } else if (ct.includes('multipart/form-data')) {
      const incoming = await req.formData()
      const outgoing = new FormData()
      for (const [key, value] of incoming.entries()) outgoing.append(key, value)
      elRes = await fetch(up.url, { method: 'POST', headers: { 'xi-api-key': elKey }, body: outgoing })
    } else {
      const rawBody = await req.text()
      if (rawBody.length > 20_000) return jsonRes(413, { error: 'Texte trop long (max ~5 000 caractères).' })   // borne serveur (coût ElevenLabs = caractères)
      elRes = await fetch(up.url, {
        method: 'POST',
        headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json', 'Accept': req.headers.get('accept') ?? 'audio/mpeg' },
        body: rawBody,
      })
    }
    const resBody = await elRes.arrayBuffer()
    return new Response(resBody, {
      status: elRes.status,
      headers: { ...CORS, 'Content-Type': elRes.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    console.error('elevenlabs-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
