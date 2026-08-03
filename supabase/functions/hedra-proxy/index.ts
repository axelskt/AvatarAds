// Supabase Edge Function — Hedra API proxy
// Contourne le CORS de api.hedra.com qui n'autorise que app.hedra.com comme origin.
// La clé Hedra est stockée dans les secrets Supabase (HEDRA_API_KEY).
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/hedra-proxy
//
// Sécurité :
//   - JWT Supabase obligatoire (anon key seule refusée)
//   - Plan BYOK sans clé user → 403 (ne tombe PAS sur la clé plateforme)
//
// Appel : POST ?path=/assets          (multipart → upload image)
//         POST ?path=/assets/ID/upload (multipart → upload audio)
//         POST ?path=/generations      (JSON → créer génération)
//         GET  ?path=/generations/ID/status (JSON → polling statut)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-hedra-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const HEDRA_BASE = 'https://api.hedra.com/web-app/public'

serve(async (req: Request) => {
  // Preflight
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

  // ── LE MOTEUR DE RENDU A LE DROIT D'ENTRER ────────────────────────────────
  // Le worker génère le lipsync scène par scène et doit donc parler à Hedra.
  // Il n'a pas de session utilisateur — il tourne sur Railway — mais il détient
  // la clé de service, qui ne quitte jamais le serveur et vaut plus qu'un JWT
  // d'utilisateur. Mesuré le 03/08 : sans cette porte, tous ses appels
  // repartaient en 401 et aucun clip n'était généré, en silence.
  // ⚠ Comparaison à longueur constante : un `===` sur un secret laisse fuiter
  // sa longueur et ses premiers octets par le temps de réponse.
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const memeSecret = (a: string, b: string) => {
    if (!a || !b || a.length !== b.length) return false
    let d = 0
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return d === 0
  }
  const estLeMoteur = memeSecret(token, service)

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: authErr } = estLeMoteur
    ? { data: { user: { id: 'render-worker' } }, error: null }
    : await supabase.auth.getUser()
  if (!estLeMoteur && (authErr || !user)) {
    return new Response(JSON.stringify({ error: 'Unauthorized — session invalide ou expirée' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Récupérer le plan de l'utilisateur ──
  // Le moteur de rendu n'a pas de profil : il travaille pour un job déjà payé,
  // et le contrôle de plan a eu lieu au lancement du montage. Il passe donc en
  // « developer » — jamais en BYOK, qui exigerait une clé personnelle qu'il n'a
  // pas et ne doit pas avoir.
  const { data: profile } = estLeMoteur || !user
    ? { data: null }
    : await supabase.from('profiles').select('plan, is_owner').eq('id', user.id).single()

  const userPlan = estLeMoteur ? 'developer' : (profile?.plan || 'free').toLowerCase()

  // ── Clé Hedra : user BYOK ou plateforme ──
  const userKey    = req.headers.get('x-user-hedra-key') ?? ''
  const platformKey = Deno.env.get('HEDRA_API_KEY') ?? ''

  // Si l'utilisateur est sur le plan BYOK, il DOIT fournir sa propre clé
  // Il ne doit PAS utiliser la clé plateforme
  if (userPlan === 'byok' && !userKey) {
    return new Response(JSON.stringify({ error: 'Plan BYOK : configure ta clé Hedra dans Connexions → Clé API Hedra' }), {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Sélection de la clé : BYOK user key prioritaire, sinon clé plateforme (plans payants)
  const hedraKey = userKey || platformKey
  if (!hedraKey) {
    return new Response(JSON.stringify({ error: 'Aucune clé Hedra configurée' }), {
      status: 402,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const url       = new URL(req.url)
    const hedraPath = url.searchParams.get('path') ?? '/'
    const ct        = req.headers.get('content-type') ?? ''

    let hedraRes: Response

    if (ct.includes('multipart/form-data')) {
      // ── Transfert de fichier (upload audio / image) ──
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
