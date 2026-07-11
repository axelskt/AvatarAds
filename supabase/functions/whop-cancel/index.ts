import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Annulation d'abonnement in-app ──
// L'utilisateur connecté annule SON abonnement (fin de période) via l'API Whop.
// Clé WHOP_API_KEY (permission membership:cancel) dans les secrets Supabase.

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
    .select('plan, whop_member_id, whop_cancel_at_period_end, credits_remaining, bought_credits')
    .eq('id', user.id).maybeSingle()

  if (!profile) return json({ error: 'Profil introuvable' }, 404)
  if (!profile.whop_member_id) return json({ error: "Aucun abonnement Whop lié à ce compte — contacte le support" }, 400)
  if (profile.whop_cancel_at_period_end) return json({ ok: true, already: true })

  // Raison du départ (flow de rétention) — stockée pour analyse
  let reason = '', detail = ''
  try { const b = await req.json(); reason = String(b?.reason ?? '').slice(0, 60); detail = String(b?.detail ?? '').slice(0, 500) } catch (_) {}

  const key = Deno.env.get('WHOP_API_KEY') ?? ''
  if (!key) { console.error('WHOP_API_KEY manquant'); return json({ error: 'Configuration incomplète — contacte le support' }, 500) }

  // Annulation en fin de période : l'accès au plan reste jusqu'à la date déjà payée,
  // puis Whop enverra membership.deactivated → le webhook repasse le compte en free.
  // Les crédits DU PLAN sont supprimés immédiatement (mécanique de rétention — annoncée
  // explicitement dans la modale avant le clic) ; les crédits ACHETÉS en pack sont conservés.
  const r = await fetch(`https://api.whop.com/api/v1/memberships/${profile.whop_member_id}/cancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancellation_mode: 'at_period_end' }),
  })
  if (!r.ok) {
    const msg = await r.text().catch(() => '')
    console.error(`❌ Whop cancel ${r.status} pour ${user.email}:`, msg.slice(0, 400))
    return json({ error: `Whop a refusé l'annulation (${r.status}) — réessaie ou contacte le support` }, 502)
  }
  const mem = await r.json().catch(() => ({} as any))

  // Crédits achetés en pack encore disponibles (les crédits du plan sont consommés en premier)
  const kept = Math.min(profile.bought_credits || 0, profile.credits_remaining || 0)
  await svc.from('profiles').update({
    whop_cancel_at_period_end: true,
    credits_remaining: kept,
    bought_credits: kept,
  }).eq('id', user.id)
  try {
    await svc.from('cancellation_feedback').insert({
      user_id: user.id, email: user.email, plan: profile.plan,
      reason: reason || null, detail: detail || null, outcome: 'cancelled',
    })
  } catch (_) {}
  console.log(`⏸️ Annulation programmée pour ${user.email} (${profile.plan}) · crédits du plan supprimés${kept ? ` · ${kept} achetés conservés` : ''} · raison: ${reason || '—'}`)
  return json({ ok: true, kept, renewal_period_end: mem?.renewal_period_end ?? null })
})
