import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Réactivation d'abonnement in-app (type Disney+ « Vous avez changé d'avis ? ») ──
// L'utilisateur connecté annule l'annulation programmée de SON abonnement (uncancel Whop).
// Clé WHOP_API_KEY (permission membership:cancel) dans les secrets Supabase.
// Les crédits du plan (supprimés à l'annulation, mécanique annoncée) reviennent au
// prochain renouvellement — pas de re-crédit immédiat (anti-abus annuler/réactiver).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
  const anon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: { user }, error: authErr } = await anon.auth.getUser()
  if (authErr || !user) return json({ error: 'Non connecté — session invalide' }, 401)

  const svc = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: profile } = await svc.from('profiles')
    .select('plan, whop_member_id, whop_cancel_at_period_end')
    .eq('id', user.id).maybeSingle()

  if (!profile) return json({ error: 'Profil introuvable' }, 404)
  if (!profile.whop_member_id) return json({ error: 'Aucun abonnement Whop lié à ce compte' }, 400)
  if (!profile.whop_cancel_at_period_end) return json({ ok: true, already: true })

  const key = Deno.env.get('WHOP_API_KEY') ?? ''
  if (!key) { console.error('WHOP_API_KEY manquant'); return json({ error: 'Configuration incomplète — contacte le support' }, 500) }

  const r = await fetch(`https://api.whop.com/api/v1/memberships/${profile.whop_member_id}/uncancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
  })
  if (!r.ok) {
    const msg = await r.text().catch(() => '')
    console.error(`❌ Whop uncancel ${r.status} pour ${user.email}:`, msg.slice(0, 400))
    return json({ error: `Whop a refusé la réactivation (${r.status}) — réessaie ou contacte le support` }, 502)
  }

  await svc.from('profiles').update({ whop_cancel_at_period_end: false }).eq('id', user.id)
  try {
    await svc.from('cancellation_feedback').insert({
      user_id: user.id, email: user.email, plan: profile.plan, outcome: 'reactivated',
    })
  } catch (_) {}
  console.log(`🔁 Abonnement réactivé pour ${user.email} (${profile.plan})`)
  return json({ ok: true })
})
