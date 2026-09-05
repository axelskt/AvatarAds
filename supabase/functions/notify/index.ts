// Supabase Edge Function — notify : relais AUTHENTIFIÉ vers le webhook Make (rapports de bug, demandes de
// virement parrainage). Audit 05/09 (M6) : l'URL Make était codée en dur dans le client — non authentifiée,
// 1000 ops/mois en offre gratuite, et elle recevait les demandes de virement (IBAN) → n'importe qui pouvait
// l'épuiser (DoS du canal) ou forger une fausse demande de virement. Ici :
//   • session utilisateur obligatoire (verify_jwt + getUser) ;
//   • plafond par utilisateur (10 / h) ;
//   • l'e-mail de l'expéditeur est pris de la SESSION, jamais du corps ;
//   • l'URL Make vit dans le secret MAKE_WEBHOOK_URL (côté serveur).
// Rappel : le paiement des virements se fait d'après la table referral_payouts (RPC request_referral_payout),
// jamais d'après la notification Make, qui n'est qu'un confort.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, rateHit, svc } from '../_shared/guard.ts'

const MAKE_URL = Deno.env.get('MAKE_WEBHOOK_URL') ?? ''

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return jsonRes(405, { error: 'method_not_allowed' })

  const auth = await authUser(req)
  if (!auth.userId) return jsonRes(401, { error: 'unauthorized' })
  if (!MAKE_URL) return jsonRes(503, { error: 'notify_unavailable' })
  if (!(await rateHit(`notify:${auth.userId}`, 3600, 10))) return jsonRes(429, { error: 'too_many' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return jsonRes(400, { error: 'bad_request' }) }
  if (!body || typeof body !== 'object') return jsonRes(400, { error: 'bad_request' })

  const { data: prof } = await svc().from('profiles').select('email').eq('id', auth.userId).maybeSingle()
  const payload = {
    ...body,
    type: String(body.type || 'bug').slice(0, 40),
    user: String(prof?.email || ''),          // identité VÉRIFIÉE (le champ client est écrasé)
    user_id: auth.userId,
    date: new Date().toLocaleString('fr-FR'),
  }
  const raw = JSON.stringify(payload)
  if (raw.length > 2_000_000) return jsonRes(413, { error: 'too_large' })

  try {
    const r = await fetch(MAKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })
    return jsonRes(r.ok ? 200 : 502, { ok: r.ok })
  } catch (e) {
    console.error('notify → Make :', e)
    return jsonRes(502, { ok: false })
  }
})
