// Supabase Edge Function — fal.ai proxy (#121)
// OmniHuman 1.5 passe par fal.ai et non plus par Hedra : fal rend en 1080p là où
// Hedra plafonnait nos générations à 720p (résolution codée en dur côté app).
// La clé fal reste dans les secrets Supabase (FAL_KEY) — jamais exposée au client.
//
// Sécurité : même contrat que hedra-proxy — JWT utilisateur obligatoire (la clé anon
// seule ne suffit pas), sauf pour ?path=/health qui ne renvoie qu'un booléen.
//
// Appels :
//   GET  ?path=/health                       → { ok, hasKey } (diagnostic, sans session)
//   POST ?path=/fal-ai/bytedance/omnihuman/v1.5   (JSON → soumet dans la file d'attente)
//   GET  ?path=/requests/<id>/status         → statut d'une génération
//   GET  ?path=/requests/<id>                → résultat (URL de la vidéo)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// file d'attente fal : soumission + polling (les générations vidéo durent ~1 min)
const FAL_QUEUE = 'https://queue.fal.run'
// noms de secret tolérés (au cas où la clé serait nommée autrement)
const KEY_NAMES = ['FAL_KEY', 'FAL_API_KEY', 'FAL_AI_KEY', 'FALAI_KEY', 'FAL_SECRET']
const readKey = () => {
  for (const n of KEY_NAMES) { const v = Deno.env.get(n); if (v) return { name: n, value: v } }
  return { name: '', value: '' }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const path = url.searchParams.get('path') ?? '/'
  const { name: keyName, value: falKey } = readKey()

  // ── diagnostic : dit SI la clé existe, jamais sa valeur ──
  if (path === '/health') {
    return json({ ok: true, hasKey: !!falKey, found: keyName || null, checked: KEY_NAMES, keyLength: falKey ? falKey.length : 0 })
  }

  if (!falKey) return json({ error: 'Aucune clé fal.ai dans les secrets Supabase (attendu : FAL_KEY)' }, 500)

  // ── session utilisateur obligatoire (comme hedra-proxy) ──
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized — token manquant' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized — session invalide ou expirée' }, 401)

  // ── relais vers fal ──
  try {
    const target = `${FAL_QUEUE}${path.startsWith('/') ? path : '/' + path}`
    const init: RequestInit = {
      method: req.method,
      headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
    }
    if (req.method === 'POST') init.body = await req.text()

    const res = await fetch(target, init)
    const text = await res.text()

    // fal renvoie 403/402 quand le compte n'a plus de crédit : message explicite côté app
    if (res.status === 402 || /insufficient|balance|quota/i.test(text)) {
      return json({ error: 'Crédits fal.ai épuisés — recharge le compte fal', falStatus: res.status, detail: text.slice(0, 300) }, 402)
    }
    return new Response(text, {
      status: res.status,
      headers: { ...CORS, 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    console.error('fal-proxy error:', err)
    return json({ error: String((err as Error)?.message || err).slice(0, 300) }, 500)
  }
})
