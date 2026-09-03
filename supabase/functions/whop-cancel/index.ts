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
  // Le membre GARDE ses crédits du mois déjà payé jusqu'à cette expiration (03/09 — Axel) :
  // ils ne sont supprimés qu'au passage réel en free (membership.deactivated), pas au clic d'annulation.
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

  // On GARDE les crédits du mois payé (rien n'est retiré ici) ; on ne fait que programmer l'annulation.
  const kept = profile.credits_remaining || 0
  await svc.from('profiles').update({
    whop_cancel_at_period_end: true,
  }).eq('id', user.id)
  try {
    await svc.from('cancellation_feedback').insert({
      user_id: user.id, email: user.email, plan: profile.plan,
      reason: reason || null, detail: detail || null, outcome: 'cancelled',
    })
  } catch (_) {}

  // ── Notif e-mail à Axel (même logique que Suggestions/Bug via Resend) — NON bloquant ──
  // Axel reçoit le formulaire de rétention (raison + détail) à chaque churn effectif.
  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
    if (RESEND_API_KEY) {
      const REASON_LABELS: Record<string, string> = {
        trop_cher: "C'est trop cher pour moi",
        pas_assez_utilise: "Je ne l'utilise pas assez",
        qualite: 'La qualité ne me convient pas',
        technique: 'A eu des problèmes techniques',
        autre: 'Autre raison',
      }
      const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const reasonLabel = REASON_LABELS[reason] || reason || '(non précisée)'
      const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#111">
        <h2 style="margin:0 0 10px">🚪 Annulation d'abonnement — AvatarAds</h2>
        <p style="margin:0 0 4px"><b>Membre :</b> ${esc(user.email || '')}</p>
        <p style="margin:0 0 4px"><b>Plan annulé :</b> ${esc(profile.plan || '—')}</p>
        <p style="margin:12px 0 4px"><b>Raison du départ :</b> ${esc(reasonLabel)}</p>
        <div style="margin:0;padding:12px 14px;background:#f6f6f6;border-radius:8px;white-space:pre-wrap">${esc(detail) || '(pas de détail ajouté)'}</div>
        <p style="margin:12px 0 0;font-size:12px;color:#666">Annulation en fin de période (l'accès reste jusqu'à la date déjà payée). L'utilisateur a poursuivi malgré l'offre de rétention.</p>
      </div>`
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'AvatarAds <bonjour@avatarads.fr>',
          to: ['axel@iamanager.fr'],
          reply_to: user.email || undefined,
          subject: `🚪 Annulation AvatarAds — ${reasonLabel}`.slice(0, 120),
          html,
        }),
      })
    }
  } catch (e) { console.error('churn email', e) }

  console.log(`⏸️ Annulation programmée pour ${user.email} (${profile.plan}) · ${kept} crédits conservés jusqu'à la fin de période · raison: ${reason || '—'}`)
  return json({ ok: true, kept, renewal_period_end: mem?.renewal_period_end ?? null })
})
