// Supabase Edge Function — ElevenLabs API proxy
// La clé ElevenLabs est stockée côté serveur (secret Supabase ELEVENLABS_API_KEY).
//
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/elevenlabs-proxy
//
// Endpoints supportés (via ?path=) :
//   GET  ?path=/v1/user                          → infos compte / test
//   GET  ?path=/v1/voices                        → liste des voix
//   POST ?path=/v1/text-to-speech/{voice_id}     → TTS (JSON → audio/mpeg)
//   POST ?path=/v1/speech-to-speech/{voice_id}   → STS (multipart → audio/mpeg)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const EL_BASE = 'https://api.elevenlabs.io'

serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // Clé ElevenLabs depuis les secrets Supabase
  const elKey = Deno.env.get('ELEVENLABS_API_KEY') ?? ''
  if (!elKey) {
    return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured in Supabase secrets' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const url     = new URL(req.url)
    const apiPath = url.searchParams.get('path') ?? '/v1/user'
    const ct      = req.headers.get('content-type') ?? ''

    let elRes: Response

    if (req.method === 'GET') {
      // ── GET (user info, voices liste) ──
      elRes = await fetch(`${EL_BASE}${apiPath}`, {
        method: 'GET',
        headers: { 'xi-api-key': elKey },
      })
    } else if (ct.includes('multipart/form-data')) {
      // ── Speech-to-Speech ou tout autre multipart ──
      const incoming = await req.formData()
      const outgoing = new FormData()
      for (const [key, value] of incoming.entries()) {
        outgoing.append(key, value)
      }
      elRes = await fetch(`${EL_BASE}${apiPath}`, {
        method: 'POST',
        headers: { 'xi-api-key': elKey },
        body: outgoing,
      })
    } else {
      // ── Text-to-Speech (JSON) ──
      const rawBody = await req.text()
      elRes = await fetch(`${EL_BASE}${apiPath}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elKey,
          'Content-Type': 'application/json',
          'Accept': req.headers.get('accept') ?? 'audio/mpeg',
        },
        body: rawBody,
      })
    }

    // Retourner la réponse (audio binaire ou JSON)
    const resBody = await elRes.arrayBuffer()
    const resContentType = elRes.headers.get('content-type') ?? 'application/json'

    return new Response(resBody, {
      status: elRes.status,
      headers: {
        ...CORS,
        'Content-Type': resContentType,
      },
    })
  } catch (err) {
    console.error('elevenlabs-proxy error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
