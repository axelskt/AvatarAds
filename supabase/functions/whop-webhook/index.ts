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
  // Mensuel
  'plan_YKcdyPT6RRQSi': { plan: 'starter', credits: 300  },  // Starter  29,99€/mois
  'plan_g4BVtDmk6hgjQ': { plan: 'pro',     credits: 600  },  // Pro      49,99€/mois
  'plan_w8lh5zpEJFOQR': { plan: 'elite',   credits: 1500 },  // Élite30  89,99€/mois
  'plan_pZmWh1dVdmIWT': { plan: 'elite',   credits: 3000 },  // Élite60 158,99€/mois
  'plan_63PGeG3MesbJR': { plan: 'elite',   credits: 4500 },  // Élite90 224,99€/mois
  // Annuel (crédits remis chaque mois via membership.renewed)
  'plan_cNydK89X39PLE': { plan: 'starter', credits: 300  },  // Starter  249,99€/an
  'plan_P7WIywSa6YrxT': { plan: 'pro',     credits: 600  },  // Pro      449,99€/an
  'plan_OvRwm5CW3xcNh': { plan: 'elite',   credits: 1500 },  // Élite30  799,99€/an
  'plan_uWTkJDl1GvxNR': { plan: 'elite',   credits: 3000 },  // Élite60 1439,88€/an
  'plan_x2kDWR6ur2W5E': { plan: 'elite',   credits: 4500 },  // Élite90 1895,88€/an
}

// ─────────────────────────────────────────────────────────────────
// PACKS one-shot → AJOUTE des crédits (ne touche pas au plan)
// ─────────────────────────────────────────────────────────────────
const PACK_MAP: Record<string, { credits?: number; imgCredits?: number }> = {
  // Packs avatars (60 s de crédit par avatar, même ratio que Starter)
  'plan_rn0Lomy4QJy0U': { credits: 300  },  // Pack S  +5 avatars  19,99€
  'plan_8ZlMDLvTi5M05': { credits: 600  },  // Pack M +10 avatars  34,99€
  'plan_EVUzCdQ1H1EdL': { credits: 1200 },  // Pack L +20 avatars  49,99€
  // Packs crédits images
  'plan_iTRFSpFkMkfJv': { imgCredits: 10 }, // Spark +10 images  4,99€
  'plan_w0DMfzGzEdmYF': { imgCredits: 25 }, // Flash +25 images  9,99€
  'plan_9OOdLpbiNYCKj': { imgCredits: 40 }, // Storm +40 images 14,99€
}

// ─── Vérifie la signature HMAC-SHA256 de Whop ───────────────────
// Whop envoie: header "Whop-Signature: sha256=XXXX"
async function verifySignature(body: string, sigHeader: string): Promise<boolean> {
  try {
    const signature = sigHeader.replace(/^sha256=/, '')
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(WHOP_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body))
    const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
    return hex === signature
  } catch { return false }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body      = await req.text()
  const sigHeader = req.headers.get('whop-signature') ?? req.headers.get('x-whop-signature') ?? ''

  // Signature OBLIGATOIRE dès que le secret est configuré (sinon n'importe qui peut se créditer)
  if (WHOP_WEBHOOK_SECRET) {
    if (!sigHeader || !(await verifySignature(body, sigHeader))) {
      console.error('❌ Signature Whop absente ou invalide')
      return new Response('Unauthorized', { status: 401 })
    }
  }

  let event: any
  try { event = JSON.parse(body) }
  catch { return new Response('Invalid JSON', { status: 400 }) }

  const action = event.action as string   // ex: "membership.went_valid"
  const data   = event.data ?? {}
  const email  = (data.user?.email ?? '').toLowerCase().trim()
  const planId = data.plan?.id ?? ''

  console.log(`📨 Whop webhook: ${action} · plan=${planId} · email=${email || '—'}`)

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const findProfile = async () => {
    if (!email) return null
    const { data: p } = await sb.from('profiles')
      .select('id, plan, credits_remaining, img_bonus_credits, whop_plan_id')
      .eq('email', email).maybeSingle()
    return p
  }

  // ─── membership.went_valid → abonnement actif OU pack acheté ──
  if (action === 'membership.went_valid') {
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
        const { error } = await sb.from('profiles').update({
          plan:              sub.plan,
          credits_remaining: sub.credits,
          credits_total:     sub.credits,
          whop_member_id:    data.id ?? null,
          whop_plan_id:      planId,
        }).eq('id', profile.id)
        if (error) { console.error('❌ Update profil:', error); return new Response('DB error', { status: 500 }) }
        console.log(`✅ Plan activé pour ${email}: ${sub.plan} (${sub.credits} crédits)`)
      } else {
        const { error } = await sb.from('pending_activations').upsert({
          email, product: 'avatarads', plan: sub.plan, credits: sub.credits,
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
  else if (action === 'membership.went_invalid') {
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
      }).eq('id', profile.id)
      console.log(`⛔ Plan résilié pour ${email} → free`)
    }
  }

  // ─── membership.renewed → renouvellement mensuel ──────────────
  else if (action === 'membership.renewed') {
    if (!email) return new Response('OK', { status: 200 })
    const sub = SUB_MAP[planId]
    if (!sub) return new Response('OK', { status: 200 })

    const profile = await findProfile()
    if (profile) {
      await sb.from('profiles').update({
        plan:              sub.plan,
        credits_remaining: sub.credits,  // remise à niveau chaque mois
        credits_total:     sub.credits,
        whop_plan_id:      planId,
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
