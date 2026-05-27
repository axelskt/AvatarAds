// Supabase Edge Function — Google AI API proxy
// La clé Google AI est stockée côté serveur (secret Supabase GOOGLE_AI_KEY).
//
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/google-ai-proxy
//
// Endpoints supportés (via ?path=) :
//   POST ?path=/v1beta/models/imagen-4.0-generate-001:predict           → Imagen 4 (sync)
//   POST ?path=/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning → Veo 3.1 (async start)
//   GET  ?path=/v1beta/OPERATION_NAME                                   → Poll opération Veo
//
// Sécurité : seuls les utilisateurs authentifiés (JWT Supabase valide) peuvent appeler ce proxy.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com'

serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // ── Vérification JWT ──
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized — token manquant' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
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

  // ── Clé Google AI depuis les secrets Supabase ──
  const googleKey = Deno.env.get('GOOGLE_AI_KEY') ?? ''
  if (!googleKey) {
    return new Response(JSON.stringify({ error: 'GOOGLE_AI_KEY not configured in Supabase secrets' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const url     = new URL(req.url)
    const apiPath = url.searchParams.get('path') ?? ''
    if (!apiPath) {
      return new Response(JSON.stringify({ error: 'Paramètre ?path= manquant' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const googleUrl = `${GOOGLE_AI_BASE}${apiPath}?key=${googleKey}`

    let googleRes: Response

    if (req.method === 'GET') {
      // ── Poll opération Veo (GET) ──
      googleRes = await fetch(googleUrl, { method: 'GET' })
    } else {
      // ── POST (Imagen 4 ou Veo start) ──
      const rawBody = await req.text()
      googleRes = await fetch(googleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
      })
    }

    const body = await googleRes.text()

    return new Response(body, {
      status: googleRes.status,
      headers: {
        ...CORS,
        'Content-Type': googleRes.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    console.error('google-ai-proxy error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
