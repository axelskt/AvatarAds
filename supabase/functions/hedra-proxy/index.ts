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

import { safePath, billableGate, helperGate, applyReservation, settleReservation, opFromReq } from '../_shared/guard.ts'

const HEDRA_BASE = 'https://api.hedra.com/web-app/public'
// Audit 05/09 : `?path=` validé (allowlist, jamais d'`@`/`..`). La base porte un chemin → l'hôte ne peut
// pas être détourné, mais on borne quand même la surface. Générations = FACTURANT (plafond + débit récent).
const HEDRA_ALLOW = /^\/(models|assets(\/[A-Za-z0-9-]+\/upload)?|generations(\/[A-Za-z0-9-]+\/status)?|v3\/(files|models(\/[A-Za-z0-9._-]+)?|jobs(\/[A-Za-z0-9-]+(\/status)?)?|assets(\/[A-Za-z0-9-]+(\/upload)?)?))$/
const HEDRA_BILLABLE = /^\/(generations|v3\/models\/[A-Za-z0-9._-]+)$/   // soumission = /generations (ancienne API) ou /v3/models/<slug> (v3)

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
  // Première tentative (02/08) : comparer le jeton reçu à SUPABASE_SERVICE_ROLE_KEY.
  // Mesuré le 03/08 : ça échoue. Les deux valeurs ont divergé — celle injectée
  // dans la fonction n'est pas celle que Railway détient. Comparer deux secrets
  // censés être identiques, c'est parier sur un alignement qu'on ne contrôle
  // pas ; une rotation de clé suffit à tout casser, en silence et en 401.
  //
  // La passerelle Supabase vérifie DÉJÀ la signature du jeton (verify_jwt est
  // actif sur cette fonction). Autrement dit : si l'exécution arrive jusqu'ici,
  // le jeton est authentique — signé avec le secret du projet. Il ne reste donc
  // qu'à lire ce qu'il déclare. Un jeton de service porte role='service_role',
  // et personne ne peut en forger un sans le secret.
  const roleDuJeton = (() => {
    try {
      const p = token.split('.')[1]
      if (!p) return ''
      const b = p.replace(/-/g, '+').replace(/_/g, '/')
      return String(JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4)))?.role || '')
    } catch { return '' }
  })()
  const estLeMoteur = roleDuJeton === 'service_role'

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

  // ── API v3 (développeur) vs ancienne API (web-app/public) ──
  // Un `?path` qui commence par /v3 bascule sur api.hedra.com + auth « Key … » + clé dev
  // HEDRA_V3_KEY. Tout le reste garde l'ancien passe-plat (web-app/public + X-API-Key +
  // HEDRA_API_KEY) → migration incrémentale, on ne casse rien.
  const url0      = new URL(req.url)
  const _pv = safePath(url0.searchParams.get('path') ?? '/', HEDRA_ALLOW)
  if (!_pv.ok) {
    return new Response(JSON.stringify({ error: 'path refusé : ' + _pv.reason }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
  const hedraPath0 = _pv.path
  const isV3      = hedraPath0.startsWith('/v3')

  // ── Facturation (H3) : une génération = plafond par utilisateur + preuve de débit récent ; le reste
  //    (uploads, polling) est seulement plafonné. Le moteur de rendu (service_role) passe.
  if (!estLeMoteur && user) {
    const bare = hedraPath0.split('?')[0]
    const gate = (req.method === 'POST' && HEDRA_BILLABLE.test(bare))
      ? await billableGate({ userId: user.id, proxy: 'hedra', requireDebit: true, debitMinutes: 120, rateMax: 30, label: bare })
      : await helperGate(user.id, 'hedra', 900)   // uploads + polling multi-scènes (Montage IA)
    if (!gate.ok) return new Response(JSON.stringify({ error: gate.error }), { status: gate.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
    // Réservation : la génération (POST /v3/models/<slug> ou /generations) tire son coût (borne basse 2 = avatarPerSec × 1 s).
    if (req.method === 'POST' && HEDRA_BILLABLE.test(bare)) {
      const rr = await applyReservation({ req, userId: user.id, proxy: 'hedra', cost: 2, label: bare })
      if (!rr.ok) return new Response(JSON.stringify({ error: rr.error }), { status: rr.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
  }

  // ── Clé Hedra : user BYOK ou plateforme ──
  const userKey    = req.headers.get('x-user-hedra-key') ?? ''
  const platformKey = Deno.env.get('HEDRA_API_KEY') ?? ''
  const v3Key      = Deno.env.get('HEDRA_V3_KEY') ?? ''

  // Le plan BYOK n'exige une clé perso que sur l'ANCIENNE API. La v3 tourne sur la clé dev
  // plateforme (Seedance = dev-only ; aucun user BYOK ne l'atteint).
  if (!isV3 && userPlan === 'byok' && !userKey) {
    return new Response(JSON.stringify({ error: 'Plan BYOK : configure ta clé Hedra dans Connexions → Clé API Hedra' }), {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Sélection de la clé : BYOK user key prioritaire, sinon clé plateforme (dev key en v3)
  const hedraKey = isV3 ? (userKey || v3Key) : (userKey || platformKey)
  if (!hedraKey) {
    return new Response(JSON.stringify({ error: isV3 ? 'Clé Hedra v3 manquante (HEDRA_V3_KEY)' : 'Aucune clé Hedra configurée' }), {
      status: 402,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const hedraPath = hedraPath0   // déjà validé (allowlist) plus haut
    const ct        = req.headers.get('content-type') ?? ''
    const base      = isV3 ? 'https://api.hedra.com' : HEDRA_BASE
    const authHeaders: Record<string, string> = isV3 ? { Authorization: `Key ${hedraKey}` } : { 'X-API-Key': hedraKey }

    let hedraRes: Response

    if (ct.includes('multipart/form-data')) {
      // ── Transfert de fichier (upload audio / image) ──
      const incoming = await req.formData()
      const outgoing = new FormData()
      for (const [key, value] of incoming.entries()) {
        outgoing.append(key, value)
      }
      hedraRes = await fetch(`${base}${hedraPath}`, {
        method: 'POST',
        headers: authHeaders,
        body: outgoing,
      })
    } else if (req.method === 'GET') {
      // ── Polling ou récupération asset ──
      hedraRes = await fetch(`${base}${hedraPath}`, {
        method: 'GET',
        headers: authHeaders,
      })
    } else {
      // ── JSON (POST génération, etc.) ──
      const rawBody = await req.text()
      hedraRes = await fetch(`${base}${hedraPath}`, {
        method: req.method,
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: rawBody,
      })
    }

    const body = await hedraRes.text()
    // Règlement de la réservation quand la génération a abouti (poll /v3/jobs COMPLETE) → op non remboursable.
    if (!estLeMoteur && user && req.method === 'GET' && hedraRes.ok) {
      const op = opFromReq(req)
      if (op && /"status"\s*:\s*"(complete|completed|succeeded|success)"/i.test(body)) await settleReservation(user.id, op)
    }

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
