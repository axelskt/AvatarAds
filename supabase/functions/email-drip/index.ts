import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { type Mail, render, subject, imageUrl, unsubUrl, sendResend, PROSPECT_STEPS, LONG_START, LONG_EVERY,
  LONG_ROTATION, isBlackFridaySeason, CLIENT_GAP, ROTATION_IDS } from '../_shared/email-v2.ts'
import { PROSPECTS, LONGUE, CLIENTS, ROTATION } from '../_shared/email-v2-data.ts'

// ── Relances e-mail automatiques (Resend) ──
// Appelée toutes les heures par le cron GitHub Actions (.github/workflows/email-drip.yml).
// Idempotente : chaque envoi est journalisé dans email_log (unique user+kind), donc
// des appels répétés ne renvoient jamais deux fois le même e-mail.
//   · v2 (05/10/2026, textes validés par Axel, _shared/email-v2*.ts) :
//       - prospects (plan free) : inscription, H+2, J+1, J+3, J+5, J+7, J+10, J+14, puis une idée toutes les
//         2 semaines dès J+28 jusqu'à l'abonnement (Black Friday en novembre) ;
//       - clients : première vidéo (J+2 sans création), relance après 7 jours sans création, l'idée de la
//         semaine (5 fonctionnalités en boucle), 1 e-mail tous les 2 jours au plus. La bienvenue (c0) part de whop-webhook.
//   · Abonnés à 0 crédit : 1 relance max par mois (sauf annulation en cours)
// Sans RESEND_API_KEY dans les secrets → no-op silencieux (déploiement dormant).

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET     = Deno.env.get('CRON_SECRET') ?? ''   // OBLIGATOIRE : verrouille le déclenchement
const FROM            = 'AvatarAds <bonjour@avatarads.fr>'
const APP_URL         = 'https://avatarads.fr/app/'
const PRICING_URL     = 'https://avatarads.fr/tarifs.html'
const UNSUB_BASE      = `${SUPABASE_URL}/functions/v1/email-unsub`
const MAX_SENDS       = 40   // par exécution (rate-limit Resend)

// Lien de désinscription signé (HMAC dérivé de la service key — aucun secret supplémentaire)
async function unsubKey(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId)))
  return Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

function tpl(opts: { title: string; body: string; cta: string; ctaUrl: string; unsubUrl: string; extra?: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:22px">🎬 AvatarAds</div>
    <div style="background:#fff;border-radius:16px;padding:30px 28px;border:1px solid #e7e5e4">
      <div style="font-size:21px;font-weight:800;color:#111;line-height:1.3;margin-bottom:14px">${opts.title}</div>
      <div style="font-size:15px;color:#44403c;line-height:1.65">${opts.body}</div>
      ${opts.extra || ''}
      <a href="${opts.ctaUrl}" style="display:block;text-align:center;background:#FF6B35;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 20px;border-radius:12px;margin-top:24px">${opts.cta}</a>
    </div>
    <div style="font-size:11.5px;color:#a8a29e;text-align:center;margin-top:18px;line-height:1.6">
      AvatarAds · avatarads.fr<br>
      <a href="${opts.unsubUrl}" style="color:#a8a29e">Ne plus recevoir ces conseils</a>
    </div>
  </div></body></html>`
}

// ── Blocs réutilisables : galerie d'exemples générés + témoignages (avis de la LP) ──
const ASSETS = 'https://avatarads.fr/assets/mail'
// Toutes les vignettes de galerie sont pré-recadrées en CARRÉ 600×600 : des ratios
// différents faisaient des galeries bancales (une image haute au milieu, deux
// écrasées sur les côtés), et aucun client mail ne gère object-fit de façon fiable.
const G = 'https://avatarads.fr/assets/mail/g'
const gallery = (files: [string, string][], legend: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr>
${files.map(([f, alt], k) => `    <td width="33.33%" style="${k === 0 ? 'padding-right:4px' : k === files.length - 1 ? 'padding-left:4px' : 'padding:0 4px'}"><a href="${APP_URL}"><img src="${G}/${f}.jpg" alt="${alt}" width="100%" style="display:block;width:100%;height:auto;border-radius:10px"></a></td>`).join('\n')}
  </tr></table>
  <div style="font-size:11.5px;color:#a8a29e;text-align:center;margin-top:8px">${legend}</div>`

const GAL_LIPSYNC = gallery([
  ['lipsync', 'Avatar IA en lipsync, indétectable'],
  ['gen-fan-5', 'Avatar IA indiscernable d\'une vraie personne'],
  ['hero-center', 'Rendu réaliste en plein écran'],
], 'Ton visage, ta voix — sans jamais te filmer ✨')

const hi = (n: string) => n ? `${n}, ` : ''
const BY_ID: Record<string, Mail> = Object.fromEntries([...PROSPECTS, ...LONGUE, ...CLIENTS, ...ROTATION].map((m) => [m.id, m]))

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  })
  if (!r.ok) console.error(`❌ Resend ${r.status} pour ${to}:`, (await r.text().catch(() => '')).slice(0, 300))
  return r.ok
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  // ÉCHEC FERMÉ. Avant, la garde était `if (CRON_SECRET && ...)` : le secret n'étant
  // pas défini côté Supabase, la condition sautait et N'IMPORTE QUI muni de la clé
  // publiable — publique dans app/index.html — pouvait déclencher un envoi de mails
  // à de vrais inscrits. Un endpoint qui écrit à des clients ne s'ouvre jamais par
  // défaut d'une variable manquante.
  if (!CRON_SECRET) {
    console.error('❌ CRON_SECRET absent : envoi refusé (à définir dans Supabase → Edge Functions → Secrets)')
    return new Response(JSON.stringify({ error: 'CRON_SECRET non configuré côté serveur' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }
  // L2 (audit 14/09) : comparaison du secret cron en TEMPS CONSTANT (comme whop/lemonsqueezy/email-unsub).
  const _ck = req.headers.get('x-cron-key') ?? ''
  const _ctEq = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
  if (!_ctEq(_ck, CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!RESEND_API_KEY) return new Response(JSON.stringify({ ok: true, skipped: 'RESEND_API_KEY manquant' }), { status: 200 })

  // Mode APERCU : { test_to: "adresse", test_ids?: ["p0", "w2", …] } envoie la série v2 (ou une sélection)
  // à cette seule adresse, préfixée [TEST], sans lire la base ni journaliser. Protégé par la clé cron.
  let testTo = '', testIds: string[] = []
  try {
    const j = await req.clone().json()
    testTo = String(j?.test_to || ''); testIds = Array.isArray(j?.test_ids) ? j.test_ids.map(String) : []
  } catch (_) { /* pas de corps JSON */ }
  if (testTo) {
    const mails = testIds.length ? testIds.map((id) => BY_ID[id]).filter(Boolean) : Object.values(BY_ID)
    // Garde-fou : on vérifie CHAQUE visuel avant d'écrire à qui que ce soit (images pas encore en ligne = rien envoyé)
    const broken: string[] = []
    for (const u of [...new Set(mails.map(imageUrl))]) {
      try { const r = await fetch(u, { method: 'HEAD' }); if (!r.ok) broken.push(`${u} → ${r.status}`) }
      catch (_) { broken.push(`${u} → injoignable`) }
    }
    if (broken.length) {
      return new Response(JSON.stringify({ ok: false, error: 'images cassées, rien envoyé', broken }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    const results: Record<string, boolean> = {}
    for (const m of mails) {
      results[m.id] = await sendResend(RESEND_API_KEY, testTo, '[TEST] ' + subject(m, 'starter'),
        render(m, { prenom: 'Axel', plan: 'starter', unsub: APP_URL }), APP_URL)
      await new Promise((r) => setTimeout(r, 600))
    }
    return new Response(JSON.stringify({ ok: true, test_to: testTo, results }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const now = Date.now()
  let sent = 0
  const report: Record<string, number> = {}

  // Journalise AVANT d'envoyer (contrainte unique = anti-doublon même en cas d'appels concurrents)
  const claim = async (userId: string, email: string, kind: string): Promise<boolean> => {
    const { error } = await sb.from('email_log').insert({ user_id: userId, email, kind })
    return !error // erreur 23505 (duplicate) → déjà envoyé
  }

  // Dernier envoi (toutes séquences) et kinds déjà reçus, par compte
  const logsFor = async (ids: string[]) => {
    const last = new Map<string, { at: number; legacyAt: number }>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from('email_log').select('user_id, kind, sent_at').in('user_id', ids.slice(i, i + 200))
      for (const r of data ?? []) {
        const t = Date.parse(r.sent_at), cur = last.get(r.user_id) ?? { at: 0, legacyAt: 0 }
        cur.at = Math.max(cur.at, t)
        if (!String(r.kind).startsWith('v2_')) cur.legacyAt = Math.max(cur.legacyAt, t)
        last.set(r.user_id, cur)
      }
    }
    return last
  }
  const sendV2 = async (u: { id: string; email: string; first_name?: string | null; plan?: string }, m: Mail, kind: string, also?: string) => {
    if (!(await claim(u.id, u.email, kind))) return false
    if (also) await claim(u.id, u.email, also)
    const unsub = await unsubUrl(SUPABASE_URL, SERVICE_KEY, u.id)
    const ok = await sendResend(RESEND_API_KEY, u.email, subject(m, u.plan || ''),
      render(m, { prenom: u.first_name || '', plan: u.plan || '', unsub }), unsub)
    if (ok) { sent++; report[kind.replace(/_\d+$/, '')] = (report[kind.replace(/_\d+$/, '')] || 0) + 1 }
    await new Promise((r) => setTimeout(r, 600))
    return ok
  }

  // ── 1) Prospects : plan free sans aucun achat ──
  // ── UN CLIENT QUI A PAYÉ NE REÇOIT PAS LA SÉRIE « NON-PAYEURS » (07/08) ── Les packs one-shot ne changent pas
  // le plan : on exclut toute trace d'achat (whop_member_id posé ou bought_credits > 0).
  // drip_anchor = created_at par défaut ; le remettre à now() REDÉMARRE la série pour un compte.
  {
    const { data: users } = await sb.from('profiles')
      .select('id, email, first_name, drip_anchor')
      .eq('plan', 'free').eq('email_optout', false)
      .is('whop_member_id', null)
      .or('bought_credits.is.null,bought_credits.eq.0')
      .not('drip_anchor', 'is', null)
      .order('drip_anchor', { ascending: false })
      .limit(2000)
    const list = (users ?? []).filter((u) => u.email)
    const last = await logsFor(list.map((u) => u.id))
    const today = new Date(now)
    for (const u of list) {
      if (sent >= MAX_SENDS) break
      const age = now - Date.parse(u.drip_anchor)
      const l = last.get(u.id) ?? { at: 0, legacyAt: 0 }
      // Transition : un compte qui a reçu un e-mail de l'ancienne série dans les 20 dernières heures attend
      // le créneau suivant (jamais deux e-mails le même jour).
      if (now - l.legacyAt < 20 * 3600_000) continue
      const step = PROSPECT_STEPS.find((s) => age >= s.from && age < s.to)
      if (step) { await sendV2(u, BY_ID[step.id], `v2_${step.id}`); continue }
      if (age >= LONG_START) {
        if (now - l.at < CLIENT_GAP) continue   // pas collé à un autre envoi (win-back, etc.)
        const k = Math.floor((age - LONG_START) / LONG_EVERY)
        if (isBlackFridaySeason(today)) await sendV2(u, BY_ID['l4'], `v2_l4_${today.getUTCFullYear()}`, `v2_l_${k}`)
        else await sendV2(u, BY_ID[LONG_ROTATION[k % LONG_ROTATION.length]], `v2_l_${k}`)
      }
    }
  }

  // ── 1 bis) Clients : première vidéo, relance d'inactivité, l'idée de la semaine ──
  // Point de départ = bienvenue envoyée par whop-webhook (email_log 'welcome'), sinon création du compte.
  if (sent < MAX_SENDS) {
    const { data: users } = await sb.from('profiles')
      .select('id, email, first_name, plan, created_at')
      .in('plan', ['starter', 'pro', 'elite']).eq('email_optout', false)
      .limit(2000)
    const list = (users ?? []).filter((u) => u.email)
    const ids = list.map((u) => u.id)
    const last = await logsFor(ids)
    const welcomeAt = new Map<string, number>(), lastMade = new Map<string, number>()
    if (ids.length) {
      const { data: w } = await sb.from('email_log').select('user_id, sent_at').eq('kind', 'welcome').in('user_id', ids)
      for (const r of w ?? []) welcomeAt.set(r.user_id, Date.parse(r.sent_at))
      // Une création = un élément de la Bibliothèque (tout ce qui est généré y est enregistré)
      const { data: li } = await sb.from('library_items').select('user_id, created_at').in('user_id', ids)
        .gte('created_at', new Date(now - 60 * 86400_000).toISOString())
      for (const r of li ?? []) lastMade.set(r.user_id, Math.max(lastMade.get(r.user_id) ?? 0, Date.parse(r.created_at)))
    }
    const DAY = 86400_000
    for (const u of list) {
      if (sent >= MAX_SENDS) break
      const l = last.get(u.id) ?? { at: 0, legacyAt: 0 }
      if (now - l.at < CLIENT_GAP) continue
      const start = welcomeAt.get(u.id) ?? Date.parse(u.created_at)
      const age = now - start
      const made = lastMade.get(u.id) ?? 0
      if (age >= 2 * DAY && age < 5 * DAY && made < start) { await sendV2(u, BY_ID['c1'], 'v2_c1'); continue }
      const active = Math.max(made, start)
      if (age >= 7 * DAY && now - active >= 7 * DAY) {
        if (await sendV2(u, BY_ID['c2'], `v2_c2_${new Date(active).toISOString().slice(0, 10)}`)) continue
      }
      const week = Math.floor(age / (7 * DAY))
      if (week >= 1) await sendV2(u, BY_ID[ROTATION_IDS[(week - 1) % ROTATION_IDS.length]], `v2_w_${week}`)
    }
  }

  // ── 2) Abonnés à 0 crédit (1 relance max / mois, jamais pendant une annulation) ──
  const zeroKind = `zero_${new Date().toISOString().slice(0, 7).replace('-', '')}`
  if (sent < MAX_SENDS) {
    const { data: users } = await sb.from('profiles')
      .select('id, email, first_name, plan')
      .in('plan', ['starter', 'pro', 'elite'])
      .eq('credits_remaining', 0).eq('email_optout', false)
      .or('whop_cancel_at_period_end.is.null,whop_cancel_at_period_end.eq.false')
      .limit(MAX_SENDS)
    for (const u of users ?? []) {
      if (sent >= MAX_SENDS) break
      if (!u.email || !(await claim(u.id, u.email, zeroKind))) continue
      const unsubUrl = `${UNSUB_BASE}?u=${u.id}&k=${await unsubKey(u.id)}`
      const ok = await sendEmail(u.email, 'Plus de crédits ⚡ Recharge en 1 clic', tpl({
        title: 'Ton solde est à zéro',
        body: `${hi(u.first_name || '')}tes crédits du mois sont épuisés — bien joué, ça veut dire que tu produis 💪 Recharge en un clic avec un pack de crédits, ou passe au plan supérieur pour ne plus jamais compter.`,
        cta: 'Recharger mes crédits →', ctaUrl: APP_URL, unsubUrl,
      }))
      if (ok) { sent++; report[zeroKind] = (report[zeroKind] || 0) + 1 }
      await new Promise(r => setTimeout(r, 600))
    }
  }

  // ── 3) (b) Win-back : compte Free DORMANT qui vient de se RECONNECTER (1 max / mois) ──
  // « Reconnexion » = auth.users.last_sign_in_at récent ; « dormant » = compte de +30j (drip
  // d'onboarding déjà épuisé). La jointure profiles×auth.users se fait dans une fonction SQL
  // SECURITY DEFINER (le schéma auth n'est pas exposé à PostgREST), qui exclut déjà les déjà-relancés
  // ce mois-ci. Dédup dur en plus via email_log (kind mensuel).
  const winbackKind = `winback_${new Date().toISOString().slice(0, 7).replace('-', '')}`
  if (sent < MAX_SENDS) {
    const { data: users, error: wbErr } = await sb.rpc('winback_candidates', { p_limit: MAX_SENDS })
    if (wbErr) console.error('⚠️ winback_candidates:', wbErr.message)
    for (const u of (users ?? []) as Array<{ id: string; email: string; first_name: string | null }>) {
      if (sent >= MAX_SENDS) break
      if (!u.email || !(await claim(u.id, u.email, winbackKind))) continue
      const unsubUrl = `${UNSUB_BASE}?u=${u.id}&k=${await unsubKey(u.id)}`
      const ok = await sendEmail(u.email, 'Content de te revoir sur AvatarAds 👋', tpl({
        title: 'Ça faisait un moment !',
        body: `${hi(u.first_name || '')}tu viens de repasser sur AvatarAds — et beaucoup de choses ont changé. Tu peux maintenant faire parler un avatar avec TA vraie voix, transformer un simple audio en vidéo montée, et générer des visuels produit en 4K, le tout prêt à poster. Reprends là où tu t'étais arrêté :`,
        cta: 'Reprendre la création →', ctaUrl: APP_URL, unsubUrl, extra: GAL_LIPSYNC,
      }))
      if (ok) { sent++; report[winbackKind] = (report[winbackKind] || 0) + 1 }
      await new Promise(r => setTimeout(r, 600))
    }
  }

  console.log(`📬 email-drip: ${sent} envoi(s)`, JSON.stringify(report))
  return new Response(JSON.stringify({ ok: true, sent, report }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
