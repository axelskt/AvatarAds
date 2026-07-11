import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WHOP_WEBHOOK_SECRET  = Deno.env.get('WHOP_WEBHOOK_SECRET') ?? ''  // Whop Dashboard → Developer → Webhooks

// ─────────────────────────────────────────────────────────────────
// ABONNEMENTS (mensuel + annuel) → fixe le plan + remet les crédits
// IDs synchronisés avec PLAN_CHECKOUT_URLS de app/index.html
// ─────────────────────────────────────────────────────────────────
const SUB_MAP: Record<string, { plan: string; credits: number }> = {
  // CRÉDITS UNIFIÉS — validé le 11/07/2026 : avatar 1 cr/s · Express Lite 1 cr/s · Fast 3 cr/s · image 1/3/5
  // Mensuel
  'plan_YKcdyPT6RRQSi': { plan: 'starter', credits: 150  },  // Starter  29,99€/mois
  'plan_g4BVtDmk6hgjQ': { plan: 'pro',     credits: 550  },  // Pro      49,99€/mois
  'plan_w8lh5zpEJFOQR': { plan: 'elite',   credits: 1100 },  // Élite30  89,99€/mois
  'plan_pZmWh1dVdmIWT': { plan: 'elite',   credits: 2200 },  // Élite60 158,99€/mois
  'plan_63PGeG3MesbJR': { plan: 'elite',   credits: 3300 },  // Élite90 224,99€/mois
  // Annuel
  'plan_cNydK89X39PLE': { plan: 'starter', credits: 150  },
  'plan_P7WIywSa6YrxT': { plan: 'pro',     credits: 550  },
  'plan_OvRwm5CW3xcNh': { plan: 'elite',   credits: 1100 },
  'plan_uWTkJDl1GvxNR': { plan: 'elite',   credits: 2200 },
  'plan_x2kDWR6ur2W5E': { plan: 'elite',   credits: 3300 },
}

// 🌞 Promo de l'été : bonus offert UNE FOIS, au premier abonnement du compte
const FIRST_SUB_BONUS: Record<string, number> = { starter: 25, pro: 50, elite: 75 }

// ─────────────────────────────────────────────────────────────────
// PACKS one-shot → AJOUTE des crédits (ne touche pas au plan)
// ─────────────────────────────────────────────────────────────────
const PACK_MAP: Record<string, { credits?: number; imgCredits?: number }> = {
  // Packs one-shot : tout crédite la MÊME monnaie (packs images fusionnés dans les crédits)
  'plan_rn0Lomy4QJy0U': { credits: 60  },  // Pack S  19,99€
  'plan_8ZlMDLvTi5M05': { credits: 115 },  // Pack M  34,99€
  'plan_EVUzCdQ1H1EdL': { credits: 180 },  // Pack L  49,99€
  'plan_iTRFSpFkMkfJv': { credits: 12  },  // Spark    4,99€
  'plan_w0DMfzGzEdmYF': { credits: 28  },  // Flash    9,99€
  'plan_9OOdLpbiNYCKj': { credits: 45  },  // Storm   14,99€
}

// ─── Vérification de signature ───────────────────────────────────
// Whop V1 = spec « Standard Webhooks » (Svix) :
//   headers webhook-id / webhook-timestamp / webhook-signature ("v1,BASE64 …")
//   signature = HMAC-SHA256 base64 de "id.timestamp.body", clé = base64-décodé du secret après "whsec_"
// + repli sur les anciens formats hex ("sha256=HEX", "t=TS,v1=HEX")
function _secretBytes(): Uint8Array {
  if (WHOP_WEBHOOK_SECRET.startsWith('whsec_')) {
    const raw = atob(WHOP_WEBHOOK_SECRET.slice(6))
    return Uint8Array.from(raw, c => c.charCodeAt(0))
  }
  return new TextEncoder().encode(WHOP_WEBHOOK_SECRET)
}
async function _hmac(payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', _secretBytes(), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return new Uint8Array(mac)
}
const _b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const _hex = (u: Uint8Array) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('')
async function verifyWebhook(req: Request, body: string): Promise<boolean> {
  try {
    const h = req.headers
    // 1) Standard Webhooks (Whop V1 / Svix)
    const id  = h.get('webhook-id') ?? h.get('svix-id') ?? ''
    const ts  = h.get('webhook-timestamp') ?? h.get('svix-timestamp') ?? ''
    const sig = h.get('webhook-signature') ?? h.get('svix-signature') ?? ''
    if (id && ts && sig) {
      const expected = _b64(await _hmac(`${id}.${ts}.${body}`))
      for (const part of sig.split(' ')) {
        const v = part.includes(',') ? part.split(',')[1] : part
        if (v && v === expected) return true
      }
    }
    // 2) Anciens formats hex
    const legacy = h.get('whop-signature') ?? h.get('x-whop-signature') ?? ''
    if (legacy) {
      if (legacy.includes('v1=')) {
        const t  = (legacy.match(/t=([^,]+)/) ?? [])[1] ?? ''
        const v1 = (legacy.match(/v1=([0-9a-f]+)/i) ?? [])[1] ?? ''
        if (t && v1 && _hex(await _hmac(`${t}.${body}`)) === v1.toLowerCase()) return true
      }
      const plain = legacy.replace(/^sha256=/, '').trim().toLowerCase()
      if (_hex(await _hmac(body)) === plain) return true
    }
    // Diagnostic (noms de headers seulement, jamais les valeurs)
    console.error('❌ Signature invalide · headers presents:', [...h.keys()].filter(k => /sig|whop|svix|webhook/i.test(k)).join(', ') || 'aucun header de signature')
    return false
  } catch { return false }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body = await req.text()

  // Signature OBLIGATOIRE dès que le secret est configuré (sinon n'importe qui peut se créditer)
  if (WHOP_WEBHOOK_SECRET) {
    if (!(await verifyWebhook(req, body))) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  let event: any
  try { event = JSON.parse(body) }
  catch { return new Response('Invalid JSON', { status: 400 }) }

  // Formats supportés : ancien ("membership.went_valid") et nouveau V1 ("membership_activated")
  // Noms d'événements Whop : 3 orthographes selon la version ("membership.went_valid",
  // "membership_activated" dans le dashboard, "membership.activated" dans le payload réel) → matching tolérant
  const action = String(event.action ?? event.event ?? event.type ?? '').toLowerCase()
  const data   = event.data ?? {}
  const email  = (data.user?.email ?? data.member?.user?.email ?? data.customer?.email ?? data.email ?? '').toLowerCase().trim()
  const planId = data.plan?.id ?? data.plan_id ?? ''
  const isActivate   = /membership[._](went[._]valid|activated)/.test(action)
  const isDeactivate = /membership[._](went[._]invalid|deactivated)/.test(action)
  const isRenew      = /membership[._]renewed|invoice[._]paid|payment[._]succeeded/.test(action)

  console.log(`📨 Whop webhook: ${action} · plan=${planId} · email=${email || '—'}`)

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // DEBUG TEMPORAIRE : capture du payload brut pour caler le parsing sur le format réel Whop V1
  try { await sb.from('webhook_events').insert({ body: event }) } catch (_) {}

  const findProfile = async () => {
    if (!email) return null
    const { data: p } = await sb.from('profiles')
      .select('id, plan, credits_remaining, img_bonus_credits, whop_plan_id, whop_member_id, first_sub_bonus_used')
      .eq('email', email).maybeSingle()
    return p
  }

  // ─── membership.went_valid → abonnement actif OU pack acheté ──
  if (isActivate) {
    if (!email) { console.error('❌ Email manquant'); return new Response('Missing email', { status: 400 }) }

    const sub  = SUB_MAP[planId]
    const pack = PACK_MAP[planId]
    if (!sub && !pack) {
      console.log(`⚠️ Plan Whop inconnu ignoré: ${planId}`)
      return new Response('OK', { status: 200 })
    }

    const profile = await findProfile()

    if (sub) {
      if (profile) {
        // ── UPGRADE/CHANGEMENT DE PLAN : annule l'ancien abonnement Whop pour ne JAMAIS facturer deux fois ──
        const oldMemberId = profile.whop_member_id
        const newMemberId = data.id ?? null
        if (oldMemberId && newMemberId && oldMemberId !== newMemberId) {
          const key = Deno.env.get('WHOP_API_KEY') ?? ''
          if (key) {
            try {
              const rc = await fetch(`https://api.whop.com/api/v1/memberships/${oldMemberId}/cancel`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cancellation_mode: 'at_period_end' }),
              })
              console.log(rc.ok
                ? `🔁 Ancien abonnement ${oldMemberId} annulé automatiquement (remplacé par ${newMemberId})`
                : `⚠️ Échec annulation ancien abonnement ${oldMemberId}: ${rc.status} ${await rc.text().catch(()=> '')}`.slice(0, 300))
            } catch (e) { console.error('⚠️ Annulation ancien abonnement:', e) }
          } else {
            console.error('⚠️ WHOP_API_KEY manquant — ancien abonnement NON annulé (risque de double facturation)')
          }
        }
        // 🌞 Bonus premier abonnement (une seule fois par compte)
        const bonus = profile.first_sub_bonus_used ? 0 : (FIRST_SUB_BONUS[sub.plan] ?? 0)
        const { error } = await sb.from('profiles').update({
          plan:              sub.plan,
          credits_remaining: sub.credits + bonus,
          credits_total:     sub.credits,
          whop_member_id:    data.id ?? null,
          whop_plan_id:      planId,
          whop_manage_url:   data.manage_url ?? null,
          whop_cancel_at_period_end: false,
          first_sub_bonus_used: true,
        }).eq('id', profile.id)
        if (error) { console.error('❌ Update profil:', error); return new Response('DB error', { status: 500 }) }
        console.log(`✅ Plan activé pour ${email}: ${sub.plan} (${sub.credits} crédits${bonus ? ' +' + bonus + ' bonus' : ''})`)
      } else {
        const { error } = await sb.from('pending_activations').upsert({
          email, product: 'avatarads', plan: sub.plan, credits: sub.credits + (FIRST_SUB_BONUS[sub.plan] ?? 0),
          whop_member_id: data.id ?? null, whop_plan_id: planId, paid_at: new Date().toISOString(),
        }, { onConflict: 'email' })
        if (error) { console.error('❌ pending_activations:', error); return new Response('DB error', { status: 500 }) }
        console.log(`⏳ Activation en attente pour ${email}: ${sub.plan}`)
      }
    } else if (pack) {
      if (profile) {
        const { error } = await sb.from('profiles').update({
          credits_remaining: (profile.credits_remaining || 0) + (pack.credits || 0),
          img_bonus_credits: (profile.img_bonus_credits || 0) + (pack.imgCredits || 0),
        }).eq('id', profile.id)
        if (error) { console.error('❌ Crédit pack:', error); return new Response('DB error', { status: 500 }) }
        console.log(`✅ Pack crédité pour ${email}: +${pack.credits || 0} crédits, +${pack.imgCredits || 0} images`)
      } else {
        // Pack payé sans compte → stocké en attente (cumulatif, plan inchangé)
        const { data: pa } = await sb.from('pending_activations').select('plan, credits, img_credits').eq('email', email).maybeSingle()
        const { error } = await sb.from('pending_activations').upsert({
          email, product: 'avatarads',
          plan:        pa?.plan || 'free',
          credits:     (pa?.credits || 0) + (pack.credits || 0),
          img_credits: (pa?.img_credits || 0) + (pack.imgCredits || 0),
          paid_at:     new Date().toISOString(),
        }, { onConflict: 'email' })
        if (error) { console.error('❌ pending pack:', error); return new Response('DB error', { status: 500 }) }
        console.log(`⏳ Pack en attente pour ${email}`)
      }
    }
  }

  // ─── membership.went_invalid → annulation / expiration ────────
  else if (isDeactivate) {
    if (!email) return new Response('OK', { status: 200 })
    // Les packs one-shot n'affectent jamais le plan
    if (PACK_MAP[planId] || !SUB_MAP[planId]) return new Response('OK', { status: 200 })

    const profile = await findProfile()
    // Downgrade uniquement si c'est BIEN l'abonnement actif du profil
    // (évite qu'un ancien abonnement expiré après upgrade ne casse le nouveau plan)
    if (profile && (!profile.whop_plan_id || profile.whop_plan_id === planId)) {
      await sb.from('profiles').update({
        plan:              'free',
        credits_remaining: 0,
        whop_member_id:    null,
        whop_plan_id:      null,
        whop_manage_url:   null,
        whop_cancel_at_period_end: false,
      }).eq('id', profile.id)
      console.log(`⛔ Plan résilié pour ${email} → free`)
    }
  }

  // ─── membership.renewed → renouvellement mensuel ──────────────
  else if (isRenew) {
    if (!email) return new Response('OK', { status: 200 })
    const sub = SUB_MAP[planId]
    if (!sub) return new Response('OK', { status: 200 })

    const profile = await findProfile()
    // Ignore le renouvellement d'un ANCIEN abonnement (après upgrade) → ne doit pas écraser le plan actif
    if (profile && profile.whop_plan_id && profile.whop_plan_id !== planId) {
      console.log(`ℹ️ Renouvellement ignoré (abonnement ${planId} n'est plus l'actif de ${email})`)
      return new Response('OK', { status: 200 })
    }
    if (profile) {
      await sb.from('profiles').update({
        plan:              sub.plan,
        credits_remaining: sub.credits,  // remise à niveau chaque mois
        credits_total:     sub.credits,
        whop_plan_id:      planId,
        whop_cancel_at_period_end: false,
      }).eq('id', profile.id)
      console.log(`🔄 Renouvellement pour ${email}: ${sub.plan} (${sub.credits} crédits remis)`)
    }
  }

  // ─── Autres events → on ignore ────────────────────────────────
  else {
    console.log(`ℹ️ Event ignoré: ${action}`)
  }

  return new Response('OK', { status: 200 })
})
