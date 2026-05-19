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
// Sécurité : seuls les utilisateurs authentifiés (JWT Supabase valide) peuvent appeler ce proxy.
// L'anon key seule est refusée — il faut un vrai user session token.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  // ── Vérification JWT : seuls les users connectés peuvent utiliser le proxy ──
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized — token manquant' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAnon   = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized — session invalide ou expirée' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Clé OpenAI depuis les secrets Supabase ──
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
