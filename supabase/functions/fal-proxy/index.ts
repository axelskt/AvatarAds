// Supabase Edge Function — fal.ai proxy (#121)
// OmniHuman 1.5 passe par fal.ai et non plus par Hedra : fal rend en 1080p là où
// Hedra plafonnait nos générations à 720p (résolution codée en dur côté app).
// La clé fal reste dans les secrets Supabase (FAL_KEY) — jamais exposée au client.
//
// Appels :
//   GET  ?path=/health                            → { ok, hasKey } (diagnostic, sans session)
//   POST ?path=/fal-ai/<modèle>                   → SOUMISSION dans la file (FACTURANT)
//   GET  ?path=/fal-ai/<modèle>/requests/<id>[/status] → statut / résultat (non facturant)
//   GET  ?path=/requests/<id>[/status]            → idem, forme courte
//
// Sécurité (audit 05/09) : session utilisateur obligatoire (moteur de rendu = service_role) ;
// `?path=` validé (allowlist, jamais d'`@`/`..`) ; soumissions plafonnées par utilisateur + preuve de
// débit récent (H3) ; gate de plan serveur sur Kling 3.0 (Pro/Élite).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, safePath, billableGate, helperGate, userPlan } from '../_shared/guard.ts'

// file d'attente fal : soumission + polling (les générations vidéo durent ~1 min)
const FAL_QUEUE = 'https://queue.fal.run'
// noms de secret tolérés (au cas où la clé serait nommée autrement)
const KEY_NAMES = ['FALAI_API_KEY', 'FAL_KEY', 'FAL_API_KEY', 'FAL_AI_KEY', 'FALAI_KEY', 'FAL_SECRET']
const readKey = () => {
  for (const n of KEY_NAMES) { const v = Deno.env.get(n); if (v) return { name: n, value: v } }
  return { name: '', value: '' }
}
// /fal-ai/<owner>/<model>[/sub…] pour les soumissions et le polling ; /requests/<id>[/status] forme courte
const ALLOW = /^\/(fal-ai\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*|requests\/[A-Za-z0-9-]+(\/status)?)$/
const IS_POLL = /\/requests\/[A-Za-z0-9-]+(\/status)?$/

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST' && req.method !== 'GET') return jsonRes(405, { error: 'method_not_allowed' })

  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path') ?? '/'
  const { name: keyName, value: falKey } = readKey()

  // ── diagnostic : dit SI la clé existe, jamais sa valeur ──
  if (rawPath === '/health') {
    return jsonRes(200, { ok: true, hasKey: !!falKey, found: keyName || null, checked: KEY_NAMES, keyLength: falKey ? falKey.length : 0 })
  }
  if (!falKey) return jsonRes(500, { error: 'Aucune clé fal.ai dans les secrets Supabase (attendu : FALAI_API_KEY)' })

  const v = safePath(rawPath, ALLOW)
  if (!v.ok) return jsonRes(400, { error: 'path refusé : ' + v.reason })
  const path = v.path
  const isSubmit = req.method === 'POST' && !IS_POLL.test(path.split('?')[0])

  // ── session utilisateur obligatoire — SAUF le moteur de rendu / backend Motion Control (service_role,
  //    jeton déjà vérifié par la passerelle et impossible à forger sans le secret du projet) ──
  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.isService && !auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })

  if (!auth.isService && auth.userId) {
    // ── Gate serveur : Motion 3.0 = Kling 3.0 (fal-ai/kling-video/v3/…) réservé Pro/Élite (0,168 $/s) ──
    if (isSubmit && /\/fal-ai\/kling-video\/v3\//i.test(path)) {
      const { plan, isOwner } = await userPlan(auth.userId)
      if (!isOwner && !['pro', 'elite', 'developer'].includes(plan)) {
        return jsonRes(403, { error: 'Motion 3.0 (Kling 3.0) est réservé aux plans Pro et Élite.' })
      }
    }
    const gate = isSubmit
      ? await billableGate({ userId: auth.userId, proxy: 'fal', requireDebit: true, debitMinutes: 120, rateMax: 40, label: path })
      : await helperGate(auth.userId, 'fal', 900)   // polling 4 s × 11 min Kling + 2 mattings en parallèle (traçage 05/09)
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
  }

  // ── relais vers fal ──
  try {
    const target = `${FAL_QUEUE}${path}`
    const init: RequestInit = { method: req.method, headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' } }
    if (req.method === 'POST') init.body = await req.text()
    const res = await fetch(target, init)
    const text = await res.text()
    // fal renvoie 403/402 quand le compte n'a plus de crédit : message explicite côté app
    if (res.status === 402 || /insufficient|balance|quota/i.test(text)) {
      return jsonRes(402, { error: 'Crédits fal.ai épuisés — recharge le compte fal', falStatus: res.status })
    }
    return new Response(text, { status: res.status, headers: { ...CORS, 'Content-Type': res.headers.get('content-type') ?? 'application/json' } })
  } catch (err) {
    console.error('fal-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
