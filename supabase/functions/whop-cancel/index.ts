import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { rateHit } from '../_shared/guard.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Annulation d'abonnement in-app ──
// L'utilisateur connecté annule SON abonnement (fin de période) via l'API Whop.
// Clé WHOP_API_KEY (permission membership:cancel) dans les secrets Supabase.
// 24/10 (audit 23/10) : le retrait des crédits du plan se fait EN BASE, en une écriture sous verrou, APRÈS l'accord de Whop
// (RPC cancel_remove_plan_credits). Avant, le solde lu ici était réécrit après l'appel Whop : une dépense faite pendant
// l'appel était effacée puis remboursée (crédits achetés dupliqués, rejouable avec whop-uncancel). Le rendu prioritaire,
// abonnement Whop À PART (profiles.prio_member_id), est résilié avec le plan, en fin de période lui aussi.
// 24/10 (relecture) : un refus de Whop n'est plus une erreur quand l'abonnement finit déjà chez lui (2e clic, relance
// après une panne de la base) : la suite, idempotente, est rejouée. Et quand le webhook Whop de cette résiliation a posé le
// drapeau avant la RPC (« already »), le retour du client et l'e-mail à Axel sont quand même enregistrés, une seule fois
// (décidé en base), et le solde relu est renvoyé à l'app.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aa-op',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Fin déjà acquise chez Whop : fin de période programmée, ou abonnement résilié / terminé (même liste que whop-webhook)
const finitDeja = (m: any) => !!m && (m.cancel_at_period_end === true || ['canceled', 'cancelled', 'completed', 'expired'].includes(String(m.status ?? '').toLowerCase()))

// Fin de période programmée chez Whop (cancel_at_period_end, jamais d'annulation immédiate ni de remboursement).
// Refus de Whop → l'abonnement est relu : s'il finit déjà, c'est fait (deja: true), la suite peut être rejouée.
async function whopCancel(memberId: string, key: string): Promise<{ ok: boolean; deja: boolean; status: number; mem: any; msg: string }> {
  const url = `https://api.whop.com/api/v1/memberships/${encodeURIComponent(memberId)}`
  const headers = { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
  try {
    const r = await fetch(`${url}/cancel`, { method: 'POST', headers, body: JSON.stringify({ cancel_at_period_end: true }) })
    if (r.ok) return { ok: true, deja: false, status: r.status, mem: await r.json().catch(() => ({})), msg: '' }
    const msg = (await r.text().catch(() => '')).slice(0, 400)
    const rg = await fetch(url, { headers }).catch(() => null)
    const m = rg && rg.ok ? await rg.json().catch(() => null) : null
    if (finitDeja(m)) return { ok: true, deja: true, status: r.status, mem: m, msg }
    return { ok: false, deja: false, status: r.status, mem: null, msg }
  } catch (e) { return { ok: false, deja: false, status: 0, mem: null, msg: String(e).slice(0, 400) } }
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

  // Audit 06/09 : une boucle cancel↔uncancel rejouait l'e-mail de départ vers Axel + l'API Whop. 6/h/user.
  if (!(await rateHit('whop-cancel:' + user.id, 3600, 6))) return json({ error: 'Trop de tentatives — réessaie plus tard.' }, 429)

  const svc = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  // Lecture pour les contrôles seulement : aucun solde n'est calculé ni réécrit d'après elle (le solde n'est renvoyé que
  // pour afficher une résiliation déjà faite).
  const { data: profile, error: pErr } = await svc.from('profiles')
    .select('plan, credits_remaining, whop_member_id, whop_cancel_at_period_end, prio_member_id, prio_cancel_member_id')
    .eq('id', user.id).maybeSingle()

  if (pErr) return json({ error: 'Lecture du compte impossible — réessaie.' }, 500)
  if (!profile) return json({ error: 'Profil introuvable' }, 404)
  if (!profile.whop_member_id) return json({ error: "Aucun abonnement Whop lié à ce compte — contacte le support" }, 400)
  if (profile.whop_cancel_at_period_end) return json({ ok: true, already: true, kept: Number(profile.credits_remaining) || 0 })

  // Raison du départ (flow de rétention) — stockée pour analyse
  let reason = '', detail = ''
  try { const b = await req.json(); reason = String(b?.reason ?? '').slice(0, 60); detail = String(b?.detail ?? '').slice(0, 500) } catch (_) {}

  const key = Deno.env.get('WHOP_API_KEY') ?? ''
  if (!key) { console.error('WHOP_API_KEY manquant'); return json({ error: 'Configuration incomplète — contacte le support' }, 500) }

  // Annulation en fin de période : l'accès au plan reste jusqu'à la date déjà payée,
  // puis Whop enverra membership.deactivated → le webhook repasse le compte en free.
  // 23/10 (test réel d'Axel) : le paramètre de l'API v1 est `cancel_at_period_end: true`. L'ancien `cancellation_mode` était
  // IGNORÉ par Whop → annulation IMMÉDIATE (accès coupé tout de suite au lieu de la fin de période payée).
  const w = await whopCancel(String(profile.whop_member_id), key)
  if (!w.ok) {
    console.error(`❌ Whop cancel ${w.status} pour ${user.id}:`, w.msg)
    return json({ error: `Whop a refusé l'annulation (${w.status}) — réessaie ou contacte le support` }, 502)
  }
  const mem = w.mem
  if (w.deja) console.log(`ℹ️ Whop cancel ${w.status} pour ${user.id} : abonnement déjà en fin chez Whop (${String(mem?.status ?? '')}${mem?.cancel_at_period_end === true ? ', fin de période programmée' : ''}) → suite rejouée`)
  else if (mem?.status === 'canceled' || mem?.cancel_at_period_end === false) console.error(`⚠️ Whop a annulé IMMÉDIATEMENT ${profile.whop_member_id} (statut ${mem?.status}) au lieu de la fin de période`)

  // Rendu prioritaire (abonnement Whop à part) : résilié avec le plan, sinon il continuait d'être prélevé sur un compte
  // repassé en free. Un échec ne bloque pas la résiliation du plan (déjà faite chez Whop) : il est signalé à Axel.
  // Déjà en fin chez Whop ('deja') : rien n'est plus prélevé, mais il n'est pas noté comme résilié PAR L'APP (whop-uncancel
  // ne doit pas réactiver un prioritaire que le client a résilié lui-même chez Whop).
  const prioId = String(profile.prio_member_id || '')
  let prio: 'resilie' | 'deja' | 'echec' | null = null
  if (prioId && prioId !== profile.prio_cancel_member_id) {
    const wp = await whopCancel(prioId, key)
    prio = !wp.ok ? 'echec' : wp.deja ? 'deja' : 'resilie'
    if (!wp.ok) console.error(`❌ Whop cancel prioritaire ${wp.status} pour ${user.id}:`, wp.msg)
  }

  // 23/10 (Axel) : comme l'annonce l'écran de confirmation, les crédits DU PLAN sont retirés au clic d'annulation ; les
  // crédits ACHETÉS en pack restent (ils ne sont jamais perdus). Le plan reste actif jusqu'à la fin de la période payée.
  // 24/10 : calculé et écrit EN BASE sur la ligne verrouillée (kept / removed renvoyés par la RPC), une seule fois. Le
  // prioritaire résilié par CETTE demande est noté dans la même écriture, même si la résiliation était déjà posée.
  let ret: any = null, rpcErr = ''
  for (let essai = 0; essai < 2 && !ret; essai++) {
    if (essai) await new Promise((r) => setTimeout(r, 400))
    const { data, error } = await svc.rpc('cancel_remove_plan_credits', { p_user: user.id, p_prio_member: prio === 'resilie' ? prioId : null })
    if (error) rpcErr = error.message
    else ret = data
  }
  if (!ret || (ret.ok !== true && ret.reason !== 'already')) {
    // Whop a programmé la fin, mais la base n'est pas à jour : jamais de faux succès, Axel corrige à la main.
    console.error('❌ annulation : base non mise à jour', user.id, rpcErr || JSON.stringify(ret))
    await alertOwner('Résiliation à finir à la main — AvatarAds', [
      ['Compte', user.id], ['Abonnement', String(profile.whop_member_id)], ['Rendu prioritaire', prio ? `${prio} (${prioId})` : 'aucun'],
      ['Problème', `Whop a programmé la fin, mais la base n'a pas retiré les crédits du plan (${rpcErr || ret?.reason || 'réponse vide'}). Rejouer : select public.cancel_remove_plan_credits('${user.id}'${prio === 'resilie' ? `, '${prioId}'` : ''});`],
    ])
    return json({ error: "Ton annulation est bien enregistrée chez notre prestataire de paiement, mais ton compte n'a pas encore été mis à jour. On s'en occupe, tu n'as rien à refaire." }, 500)
  }
  // « already » : la résiliation était déjà posée en base — par une autre demande (double clic, qui a retiré les crédits du
  // plan et enregistré le départ) ou par le webhook Whop de CETTE résiliation, arrivé avant (il a retiré les crédits du
  // plan, mais personne n'a enregistré le départ). notify, décidé en base sous le verrou : vrai une seule fois.
  const deja = ret.ok !== true
  const kept = Number(ret.kept) || 0, removed = deja ? null : (Number(ret.removed) || 0)
  if (ret.notify === true) {
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
        const reasonLabel = REASON_LABELS[reason] || reason || '(non précisée)'
        const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#111">
          <h2 style="margin:0 0 10px">🚪 Annulation d'abonnement — AvatarAds</h2>
          <p style="margin:0 0 4px"><b>Membre :</b> ${esc(user.email || '')}</p>
          <p style="margin:0 0 4px"><b>Plan annulé :</b> ${esc(profile.plan || '—')}</p>
          <p style="margin:0 0 4px"><b>Crédits :</b> ${removed === null ? `crédits du plan déjà retirés (résiliation reçue de Whop juste avant), ${kept} achetés gardés` : `${removed} du plan retirés, ${kept} achetés gardés`}</p>
          ${prio ? `<p style="margin:0 0 4px"><b>Rendu prioritaire :</b> ${prio === 'resilie' ? 'résilié aussi (fin de période)' : prio === 'deja' ? 'déjà en fin chez Whop' : `ÉCHEC de la résiliation chez Whop (${esc(prioId)}) — à résilier à la main`}</p>` : ''}
          <p style="margin:12px 0 4px"><b>Raison du départ :</b> ${esc(reasonLabel)}</p>
          <div style="margin:0;padding:12px 14px;background:#f6f6f6;border-radius:8px;white-space:pre-wrap">${esc(detail) || '(pas de détail ajouté)'}</div>
          <p style="margin:12px 0 0;font-size:12px;color:#666">Annulation en fin de période (le plan reste jusqu'à la date déjà payée ; crédits du plan retirés, crédits de packs gardés). L'utilisateur a poursuivi malgré l'offre de rétention.</p>
        </div>`
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'AvatarAds <bonjour@avatarads.fr>',
            to: ['axel@iamanager.fr'],
            reply_to: user.email || undefined,
            subject: `🚪 Annulation AvatarAds — ${prio === 'echec' ? 'rendu prioritaire à résilier à la main — ' : ''}${reasonLabel}`.slice(0, 120),
            html,
          }),
        })
      }
    } catch (e) { console.error('churn email', e) }
  }
  // Prioritaire non résilié sur une demande qui n'envoie pas l'e-mail de départ (déjà enregistré) : Axel prévenu quand même
  if (prio === 'echec' && ret.notify !== true) {
    await alertOwner('Rendu prioritaire à résilier à la main — AvatarAds', [
      ['Compte', user.id], ['Rendu prioritaire', prioId], ['Problème', "Whop a refusé sa résiliation (fin de période) : il continuerait d'être prélevé."],
    ])
  }

  console.log(`⏸️ Annulation programmée pour ${user.id} (${profile.plan}) · ${removed === null ? 'déjà posée en base' : removed + ' crédits du plan retirés'}, ${kept} achetés gardés · prioritaire: ${prio ?? '—'} · départ enregistré: ${ret.notify === true ? 'oui' : 'non (déjà fait)'} · raison: ${reason || '—'}`)
  return json({ ok: true, ...(deja ? { already: true } : { removed }), kept, renewal_period_end: mem?.renewal_period_end ?? null, rendu_prioritaire: prio })
})
