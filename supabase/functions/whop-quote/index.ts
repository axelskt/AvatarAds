import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { rateHit, realIp } from '../_shared/guard.ts'

// ── Devis Whop pour la page de paiement (paiement.html, 23/10) ──
// Le code promo se saisit dans NOTRE récapitulatif (Axel : « à droite, sous AvatarAds Pro ») et non plus dans le module Whop :
// il faut alors le montant remisé exact. Whop le calcule lui-même (POST /payment_quotes : panier + code promo → sous-total,
// remise, total), ce qui garde Whop seul juge du prix. Un devis n'encaisse rien et n'engage rien. Public (acheteur parfois
// sans compte) : uniquement les plans de la page, code au format strict, 30 devis / 10 min par IP.
const COMPTE = 'biz_8qU05lX54eJW0z'
const PLANS = new Set([
  // abonnements (mensuel, annuel)
  'plan_YKcdyPT6RRQSi', 'plan_g4BVtDmk6hgjQ', 'plan_w8lh5zpEJFOQR', 'plan_pZmWh1dVdmIWT', 'plan_63PGeG3MesbJR',
  'plan_cNydK89X39PLE', 'plan_P7WIywSa6YrxT', 'plan_OvRwm5CW3xcNh', 'plan_uWTkJDl1GvxNR', 'plan_x2kDWR6ur2W5E',
  // abonnement + pack (whop-webhook, VARIANTES)
  'plan_blQtyUh90R2wP', 'plan_hE8bkwTPoTkrj', 'plan_0iHH0kY3uoJpo', 'plan_wn7ZntgBemFL0', 'plan_i7ubxuFfVHQ5k', 'plan_th1REeLIfRP50',
  'plan_xN9BOWCvFUWXp', 'plan_NcMairMUEz3ST', 'plan_iATzKyUuANyfI', 'plan_QF7HXCR81yXRy', 'plan_5RTUZOJ3sGCXd', 'plan_QaAyO2Msc11Xk',
  'plan_tAKWwP8U88eTT', 'plan_xzr5jL4TCAlWf',
  // rendu prioritaire (mensuel, annuel, annuel 3D Secure pour Elite 60 / 90)
  'plan_5mcgIdN0ZTlCG', 'plan_2KlnrycFeoXMT', 'plan_oPv9MNE8701Tt',
  // packs seuls (?pack=S|M|L)
  'plan_hR0u4VHoeszbu', 'plan_GLoKHMqZtNbLK', 'plan_iRh99E5F2g4XU',
])
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const montant = (m: any) => Math.round(parseFloat(String(m?.amount ?? 'NaN')) * 100) / 100

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)
  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'json' }, 400) }
  const plans: string[] = Array.isArray(b?.plans) ? b.plans.map(String) : []
  const promo = String(b?.promo ?? '').trim()
  if (!plans.length || plans.length > 2 || new Set(plans).size !== plans.length || !plans.every((p) => PLANS.has(p))) return json({ ok: false, error: 'plans' }, 400)
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(promo)) return json({ ok: false, error: 'promo_format', message: 'Code promo invalide.' })
  if (!(await rateHit('whop-quote:' + (realIp(req) || 'inconnu'), 600, 30))) return json({ ok: false, error: 'rate', message: 'Trop d’essais, réessaie dans quelques minutes.' }, 429)
  const key = Deno.env.get('WHOP_API_KEY') ?? ''
  if (!key) return json({ ok: false, error: 'config' }, 503)
  let r: Response
  try {
    r = await fetch('https://api.whop.com/api/v1/payment_quotes', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: COMPTE, ...(plans.length === 1 ? { plan_id: plans[0] } : { line_items: plans.map((plan_id) => ({ plan_id, quantity: 1 })) }), promo_code: promo, presentment_country: 'FR' }),
    })
  } catch (e) { console.error('whop-quote : Whop injoignable', (e as Error)?.message); return json({ ok: false, error: 'whop' }, 502) }
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) {
    const code = String(j?.error?.code ?? j?.code ?? r.status), msg = String(j?.error?.message ?? j?.message ?? '')
    console.log(`whop-quote : refusé ${code} — ${msg.slice(0, 200)}`)
    // Whop ne chiffre pas un achat ramené à 0 € (multi_item_free_unsupported, même pour un seul plan dans un devis)
    if (/to zero|free_unsupported/i.test(msg)) return json({ ok: false, error: 'promo_zero', message: plans.length > 1
      ? 'Ce code ne peut pas s’appliquer avec le rendu prioritaire : retire l’option pour l’utiliser.'
      : 'Ce code rend l’achat gratuit : il ne s’utilise pas sur cette page.' })
    if (/promo/i.test(code) || /promo/i.test(msg)) return json({ ok: false, error: 'promo_invalid', message: 'Ce code promo n’est pas valable pour cet achat.' })
    return json({ ok: false, error: 'whop', status: r.status }, 502)
  }
  const total = montant(j.total), remise = montant(j.discount), sousTotal = montant(j.subtotal)
  if (![total, remise, sousTotal].every(Number.isFinite)) return json({ ok: false, error: 'whop' }, 502)
  if (plans.length > 1 && total <= 0) return json({ ok: false, error: 'promo_zero', message: 'Ce code ne peut pas s’appliquer avec le rendu prioritaire : retire l’option pour l’utiliser.' })
  return json({ ok: true, code: promo.toUpperCase(), subtotal: sousTotal, discount: remise, total })
})
