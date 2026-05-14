// Supabase Edge Function — Hedra API proxy
// Contourne le CORS de api.hedra.com qui n'autorise que app.hedra.com comme origin.
// La clé Hedra est stockée dans les secrets Supabase (HEDRA_API_KEY).
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/hedra-proxy
//
// Appel : POST ?path=/assets          (multipart → upload image)
//         POST ?path=/assets/ID/upload (multipart → upload audio)
//         POST ?path=/generations      (JSON → créer génération)
//         GET  ?path=/generations/ID/status (JSON → polling statut)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const HEDRA_BASE = 'https://api.hedra.com/web-app/public'

serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const url      = new URL(req.url)
    const hedraPath = url.searchParams.get('path') ?? '/'
    // Clé uniquement depuis les secrets Supabase (plus jamais côté client)
    const hedraKey  = Deno.env.get('HEDRA_API_KEY') ?? ''
    if (!hedraKey) {
      return new Response(JSON.stringify({ error: 'HEDRA_API_KEY not configured in Supabase secrets' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const ct        = req.headers.get('content-type') ?? ''

    let hedraRes: Response

    if (ct.includes('multipart/form-data')) {
      // ── Transfert de fichier (upload audio / image) ──
      // On lit le formData entrant et on le recrée pour Hedra
      const incoming = await req.formData()
      const outgoing = new FormData()
      for (const [key, value] of incoming.entries()) {
        outgoing.append(key, value)
      }
      hedraRes = await fetch(`${HEDRA_BASE}${hedraPath}`, {
        method: 'POST',
        headers: { 'X-API-Key': hedraKey },
        body: outgoing,
      })
    } else if (req.method === 'GET') {
      // ── Polling ou récupération asset ──
      hedraRes = await fetch(`${HEDRA_BASE}${hedraPath}`, {
        method: 'GET',
        headers: { 'X-API-Key': hedraKey },
      })
    } else {
      // ── JSON (POST génération, etc.) ──
      const rawBody = await req.text()
      hedraRes = await fetch(`${HEDRA_BASE}${hedraPath}`, {
        method: req.method,
        headers: {
          'X-API-Key': hedraKey,
          'Content-Type': 'application/json',
        },
        body: rawBody,
      })
    }

    const body = await hedraRes.text()

    return new Response(body, {
      status: hedraRes.status,
      headers: {
        ...CORS,
        'Content-Type': hedraRes.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    console.error('hedra-proxy error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
