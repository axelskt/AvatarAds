import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { rateHit } from '../_shared/guard.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Réactivation d'abonnement in-app (type Disney+ « Vous avez changé d'avis ? ») ──
// L'utilisateur connecté annule l'annulation programmée de SON abonnement (uncancel Whop).
// Clé WHOP_API_KEY (permission membership:cancel) dans les secrets Supabase.
// Les crédits du plan (supprimés à l'annulation, mécanique annoncée) reviennent au
// prochain renouvellement — pas de re-crédit immédiat (anti-abus annuler/réactiver).
// 24/10 (audit 23/10) : profiles.cancel_requested_at n'est PAS effacée ici. Un débit fait avant l'annulation ne rendra
// donc toujours que sa part achetée s'il est remboursé après la réactivation : annuler / réactiver ne crée rien. Le rendu
// prioritaire résilié PAR L'APP avec le plan (prio_cancel_member_id) est réactivé avec lui — et lui seul.
// 24/10 (relecture) : si ce prioritaire n'a pas pu être réactivé, la réponse (200, plan bien réactivé) porte aussi un
// `message` pour le client. Pas dans `error` : l'app traite tout `error` comme un échec et garderait « Redémarrer ».

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
async function whopUncancel(memberId: string, key: string): Promise<{ ok: boolean; status: number; msg: string }> {
  try {
    const r = await fetch(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(memberId)}/uncancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    })
    return { ok: r.ok, status: r.status, msg: r.ok ? '' : (await r.text().catch(() => '')).slice(0, 400) }
  } catch (e) { return { ok: false, status: 0, msg: String(e).slice(0, 400) } }
}
// Alerte à Axel quand l'app et Whop ne sont plus d'accord (à corriger à la main). Best-effort : jamais bloquant.
async function alertOwner(subject: string, lignes: [string, string][]) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
  if (!RESEND_API_KEY) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'AvatarAds <bonjour@avatarads.fr>', to: ['axel@iamanager.fr'], subject: subject.slice(0, 120),
        html: `<div style="font-family:sans-serif;line-height:1.6">${lignes.map(([k, v]) => `<p><b>${esc(k)} :</b> ${esc(v)}</p>`).join('')}</div>`,
      }),
    })
  } catch (e) { console.error('alerte owner', e) }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aa-op',
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

  if (!(await rateHit('whop-uncancel:' + user.id, 3600, 12))) return json({ error: 'Trop de tentatives — réessaie plus tard.' }, 429)

  const svc = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: profile, error: pErr } = await svc.from('profiles')
    .select('plan, whop_member_id, whop_cancel_at_period_end, prio_member_id, prio_cancel_member_id')
    .eq('id', user.id).maybeSingle()

  if (pErr) return json({ error: 'Lecture du compte impossible — réessaie.' }, 500)
  if (!profile) return json({ error: 'Profil introuvable' }, 404)
  if (!profile.whop_member_id) return json({ error: 'Aucun abonnement Whop lié à ce compte' }, 400)
  if (!profile.whop_cancel_at_period_end) return json({ ok: true, already: true })

  const key = Deno.env.get('WHOP_API_KEY') ?? ''
  if (!key) { console.error('WHOP_API_KEY manquant'); return json({ error: 'Configuration incomplète — contacte le support' }, 500) }

  const w = await whopUncancel(String(profile.whop_member_id), key)
  if (!w.ok) {
    console.error(`❌ Whop uncancel ${w.status} pour ${user.id}:`, w.msg)
    return json({ error: `Whop a refusé la réactivation (${w.status}) — réessaie ou contacte le support` }, 502)
  }

  // Rendu prioritaire : seulement celui que whop-cancel a résilié avec le plan (pas un prioritaire résilié chez Whop par
  // le client lui-même). Un échec ne bloque pas la réactivation du plan : il reste « résilié » et Axel est prévenu.
  const prioId = String(profile.prio_cancel_member_id || '')
  let prio: 'reactive' | 'echec' | null = null
  if (prioId && prioId === profile.prio_member_id) {
    const wp = await whopUncancel(prioId, key)
    prio = wp.ok ? 'reactive' : 'echec'
    if (!wp.ok) console.error(`❌ Whop uncancel prioritaire ${wp.status} pour ${user.id}:`, wp.msg)
  }

  // Crédits : rien (voir plus haut). Écriture vérifiée : jamais de faux succès.
  const { error: upErr } = await svc.from('profiles')
    .update({ whop_cancel_at_period_end: false, ...(prio === 'reactive' ? { prio_cancel_member_id: null } : {}) })
    .eq('id', user.id)
  if (upErr || prio === 'echec') {
    await alertOwner('Réactivation à finir à la main — AvatarAds', [
      ['Compte', user.id], ['Abonnement', String(profile.whop_member_id)],
      ['Problème', upErr ? `Whop a réactivé l'abonnement${prio === 'reactive' ? ' et le rendu prioritaire' : ''}, mais la base n'est pas à jour (${upErr.message}) : remettre whop_cancel_at_period_end à false${prio === 'reactive' ? ' et prio_cancel_member_id à null' : ''}.`
        : `Le rendu prioritaire ${prioId} n'a pas pu être réactivé chez Whop : il s'arrêtera en fin de période.`],
    ])
  }
  if (upErr) {
    console.error('❌ réactivation : base non mise à jour', user.id, upErr.message)
    return json({ error: "Ton abonnement est bien réactivé chez notre prestataire de paiement, mais ton compte n'a pas encore été mis à jour. On s'en occupe, tu n'as rien à refaire." }, 500)
  }
  try {
    await svc.from('cancellation_feedback').insert({
      user_id: user.id, email: user.email, plan: profile.plan, outcome: 'reactivated',
    })
  } catch (_) {}
  console.log(`🔁 Abonnement réactivé pour ${user.id} (${profile.plan}) · prioritaire: ${prio ?? '—'}`)
  return json({ ok: true, rendu_prioritaire: prio, ...(prio === 'echec' ? {
    message: "Ton abonnement est bien réactivé, mais ton rendu prioritaire n'a pas pu l'être : il s'arrêtera à la fin de la période. On s'en occupe, tu n'as rien à faire.",
  } : {}) })
})
