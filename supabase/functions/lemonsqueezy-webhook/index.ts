import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const LS_SIGNING_SECRET       = Deno.env.get('LEMONSQUEEZY_SIGNING_SECRET')!

// ─────────────────────────────────────────────
// REMPLIS CES VARIANT IDs avec tes vrais IDs
// LemonSqueezy → Produit → Variants → copie l'ID numérique
// ─────────────────────────────────────────────
const VARIANT_MAP: Record<string, { product: string; plan: string; credits: number; topup?: boolean }> = {
  // AvatarAds — abonnements (remplacent le plan)
  'XXXXX_AVATARADS_FORMATION': { product: 'avatarads', plan: 'starter',   credits: 300  },
  'XXXXX_AVATARADS_STARTER'  : { product: 'avatarads', plan: 'starter',   credits: 300  },
  'XXXXX_AVATARADS_PRO'      : { product: 'avatarads', plan: 'pro',       credits: 600  },
  'XXXXX_AVATARADS_ELITE'    : { product: 'avatarads', plan: 'elite',     credits: 1500 },
  // BloxAI — abonnements (remplacent le plan)
  'XXXXX_BLOX_FORMATION'     : { product: 'blox',      plan: 'starter',   credits: 300  },
  'XXXXX_BLOX_STARTER'       : { product: 'blox',      plan: 'starter',   credits: 300  },
  'XXXXX_BLOX_PRO'           : { product: 'blox',      plan: 'pro',       credits: 600  },
  'XXXXX_BLOX_ELITE'         : { product: 'blox',      plan: 'elite',     credits: 1500 },
  // Packs de minutes (s'ajoutent au solde existant — topup: true)
  // AvatarAds — crée ces produits dans LemonSqueezy et colle leurs variant IDs
  'XXXXX_AVATARADS_PACK_S'   : { product: 'avatarads', plan: '',          credits: 300,  topup: true },
  'XXXXX_AVATARADS_PACK_M'   : { product: 'avatarads', plan: '',          credits: 900,  topup: true },
  'XXXXX_AVATARADS_PACK_L'   : { product: 'avatarads', plan: '',          credits: 1800, topup: true },
}

// ─── Vérifie la signature HMAC-SHA256 de LemonSqueezy ───
async function verifySignature(body: string, signature: string): Promise<boolean> {
  try {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(LS_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body))
    const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2,'0')).join('')
    return hex === signature
  } catch { return false }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body      = await req.text()
  const signature = req.headers.get('x-signature') ?? ''

  if (!(await verifySignature(body, signature))) {
    console.error('Invalid signature')
    return new Response('Unauthorized', { status: 401 })
  }

  const event     = JSON.parse(body)
  const eventName = event.meta?.event_name

  // On ne traite que les commandes réussies
  if (eventName !== 'order_created') return new Response('OK', { status: 200 })

  const order     = event.data?.attributes
  const email     = (order?.user_email ?? '').toLowerCase().trim()
  const variantId = String(event.data?.attributes?.first_order_item?.variant_id ?? '')

  if (!email || !variantId) {
    console.error('Missing email or variantId', { email, variantId })
    return new Response('Missing data', { status: 400 })
  }

  const config = VARIANT_MAP[variantId]
  if (!config) {
    console.log(`Variant inconnu ignoré: ${variantId}`)
    return new Response('OK', { status: 200 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // ─── Cherche le profil par email ───
  const { data: profile, error: profileErr } = await sb
    .from('profiles')
    .select('id, plan, credits_remaining')
    .eq('email', email)
    .maybeSingle()

  if (profileErr) {
    console.error('Erreur lookup profil:', profileErr)
    return new Response('DB error', { status: 500 })
  }

  if (profile) {
    if (config.topup) {
      // ➕ Pack de minutes → ajouter au solde existant
      const newCredits = (profile.credits_remaining || 0) + config.credits
      const { error } = await sb.from('profiles')
        .update({ credits_remaining: newCredits })
        .eq('id', profile.id)

      if (error) {
        console.error('Erreur topup crédits:', error)
        return new Response('DB error', { status: 500 })
      }
      console.log(`➕ Crédits ajoutés pour ${email}: +${config.credits}s → total ${newCredits}s`)

    } else {
      // ✅ Abonnement → mise à jour du plan
      const { error } = await sb.from('profiles').update({
        plan:               config.plan,
        credits_remaining:  config.credits,
      }).eq('id', profile.id)

      if (error) {
        console.error('Erreur update profil:', error)
        return new Response('DB error', { status: 500 })
      }
      console.log(`✅ Plan activé pour ${email}: ${config.plan} (${config.product})`)
    }

  } else {
    if (config.topup) {
      // ⚠️ Achat de crédits sans compte existant — peu probable mais on log
      console.warn(`⚠️ Pack crédits pour ${email} mais aucun compte trouvé — ignoré`)
      return new Response('OK', { status: 200 })
    }
    // ⏳ Abonnement sans compte → sauvegarde en "pending"
    // Le plan s'activera automatiquement à l'inscription
    const { error } = await sb.from('pending_activations').upsert({
      email,
      product:  config.product,
      plan:     config.plan,
      credits:  config.credits,
      paid_at:  new Date().toISOString(),
    }, { onConflict: 'email' })

    if (error) {
      console.error('Erreur pending_activations:', error)
      return new Response('DB error', { status: 500 })
    }
    console.log(`⏳ Activation en attente pour ${email}: ${config.plan} (${config.product})`)
  }

  return new Response('OK', { status: 200 })
})
