// Supabase Edge Function — OpenAI API proxy
// La clé OpenAI est stockée côté serveur (secret Supabase OPENAI_API_KEY).
// Les clients n'ont pas besoin de fournir leur propre clé.
//
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/openai-proxy
//
// Endpoints supportés (via ?path=) :
//   POST ?path=/v1/chat/completions        → GPT-4o (JSON)
//   POST ?path=/v1/audio/transcriptions    → Whisper (multipart)
//
// Header requis pour auth : Authorization: Bearer <SUPABASE_ANON_KEY>
//   (automatiquement inclus par le client Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OPENAI_BASE = 'https://api.openai.com'

serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // Clé OpenAI depuis les secrets Supabase
  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!openaiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured in Supabase secrets' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const url      = new URL(req.url)
    const apiPath  = url.searchParams.get('path') ?? '/v1/chat/completions'
    const ct       = req.headers.get('content-type') ?? ''

    let openaiRes: Response

    if (ct.includes('multipart/form-data')) {
      // ── Whisper : transférer le multipart tel quel ──
      const incoming = await req.formData()
      const outgoing = new FormData()
      for (const [key, value] of incoming.entries()) {
        outgoing.append(key, value)
      }
      openaiRes = await fetch(`${OPENAI_BASE}${apiPath}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}` },
        body: outgoing,
      })
    } else {
      // ── Chat Completions (JSON) ──
      const rawBody = await req.text()
      openaiRes = await fetch(`${OPENAI_BASE}${apiPath}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: rawBody,
      })
    }

    const body = await openaiRes.text()

    return new Response(body, {
      status: openaiRes.status,
      headers: {
        ...CORS,
        'Content-Type': openaiRes.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    console.error('openai-proxy error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
