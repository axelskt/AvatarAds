import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { type Mail, render, subject, imageUrl, unsubUrl, sendResend, PROSPECT_STEPS, LONG_START, LONG_EVERY,
  LONG_ROTATION, isBlackFridaySeason, CLIENT_GAP, ROTATION_IDS } from '../_shared/email-v2.ts'
import { PROSPECTS, LONGUE, CLIENTS, ROTATION, ZERO } from '../_shared/email-v2-data.ts'

// ── E-mails automatiques (Resend), séquences v2 validées par Axel le 05/10/2026 ──
// Appelée toutes les heures par pg_cron (job email-drip-hourly, clé x-cron-key lue dans Vault).
// Idempotente : chaque envoi est journalisé dans email_log (unique user+kind) AVANT l'envoi, donc des appels
// répétés ne renvoient jamais deux fois le même e-mail. L'identifiant Resend est ensuite rangé dans
// email_log.resend_id : c'est la clé des statistiques (email-events reçoit ouvertures / clics / rebonds).
//   · prospects (plan free) : inscription, H+2, J+1, J+3, J+5, J+7, J+10, J+14, puis une idée toutes les
//     2 semaines dès J+28 jusqu'à l'abonnement (Black Friday en novembre) ;
//   · clients : première vidéo (J+2 sans création), relance après 7 jours sans création, l'idée de la semaine
//     (5 fonctionnalités en boucle), 1 e-mail tous les 2 jours au plus. La bienvenue (c0) part de whop-webhook ;
//   · abonnés à 0 crédit (z0) : 1 par mois au plus, jamais pendant une annulation — activé quand Z0_LIVE = true.
// Textes et visuels : _shared/email-v2-data.ts, GÉNÉRÉ depuis tools/emails/emails.py (ne pas éditer à la main).

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET    = Deno.env.get('CRON_SECRET') ?? ''   // OBLIGATOIRE : verrouille le déclenchement
const APP_URL        = 'https://avatarads.fr/app/'
const MAX_SENDS      = 40     // par exécution (rate-limit Resend)
const Z0_LIVE        = false  // e-mail « 0 crédit » : en attente de validation d'Axel (06/10)
const DAY            = 86400_000

const BY_ID: Record<string, Mail> = Object.fromEntries([...PROSPECTS, ...LONGUE, ...CLIENTS, ...ROTATION, ...ZERO].map((m) => [m.id, m]))
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  // ÉCHEC FERMÉ : sans secret configuré, n'importe qui muni de la clé publiable pourrait déclencher des envois.
  if (!CRON_SECRET) {
    console.error('❌ CRON_SECRET absent : envoi refusé (à définir dans Supabase → Edge Functions → Secrets)')
    return json({ error: 'CRON_SECRET non configuré côté serveur' }, 503)
  }
  // Comparaison du secret cron en TEMPS CONSTANT (audit 14/09)
  const ck = req.headers.get('x-cron-key') ?? ''
  const ctEq = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
  if (!ctEq(ck, CRON_SECRET)) return new Response('Unauthorized', { status: 401 })
  if (!RESEND_API_KEY) return json({ ok: true, skipped: 'RESEND_API_KEY manquant' })

  // Mode APERÇU : { test_to: "adresse", test_ids?: ["p0", "w2", …] } envoie la série (ou une sélection) à cette
  // seule adresse, préfixée [TEST], sans lire la base ni journaliser.
  let testTo = '', testIds: string[] = []
  try {
    const j = await req.clone().json()
    testTo = String(j?.test_to || ''); testIds = Array.isArray(j?.test_ids) ? j.test_ids.map(String) : []
  } catch (_) { /* pas de corps JSON */ }
  if (testTo) {
    const mails = testIds.length ? testIds.map((id) => BY_ID[id]).filter(Boolean) : Object.values(BY_ID)
    // Garde-fou : chaque visuel doit être en ligne avant d'écrire à qui que ce soit
    const broken: string[] = []
    for (const u of [...new Set(mails.map(imageUrl))]) {
      try { const r = await fetch(u, { method: 'HEAD' }); if (!r.ok) broken.push(`${u} → ${r.status}`) }
      catch (_) { broken.push(`${u} → injoignable`) }
    }
    if (broken.length) return json({ ok: false, error: 'images cassées, rien envoyé', broken })
    const results: Record<string, boolean> = {}
    for (const m of mails) {
      results[m.id] = !!(await sendResend(RESEND_API_KEY, testTo, '[TEST] ' + subject(m, 'starter'),
        render(m, { prenom: 'Axel', plan: 'starter', unsub: APP_URL }), APP_URL, 'test'))
      await new Promise((r) => setTimeout(r, 600))
    }
    return json({ ok: true, test_to: testTo, results })
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

  // Dernier envoi (toutes séquences) et dernier envoi d'un ancien e-mail (hors v2), par compte
  const logsFor = async (ids: string[]) => {
    const last = new Map<string, { at: number; legacyAt: number }>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from('email_log').select('user_id, kind, sent_at').in('user_id', ids.slice(i, i + 200))
      for (const r of data ?? []) {
        const t = Date.parse(r.sent_at), cur = last.get(r.user_id) ?? { at: 0, legacyAt: 0 }
        cur.at = Math.max(cur.at, t)
        if (!String(r.kind).startsWith('v2_') && r.kind !== 'welcome') cur.legacyAt = Math.max(cur.legacyAt, t)
        last.set(r.user_id, cur)
      }
    }
    return last
  }

  // Envoie un e-mail v2 : réserve le kind, envoie, range l'identifiant Resend (statistiques)
  const sendV2 = async (u: { id: string; email: string; first_name?: string | null; plan?: string }, m: Mail, kind: string, also?: string) => {
    if (!(await claim(u.id, u.email, kind))) return false
    if (also) await claim(u.id, u.email, also)
    const unsub = await unsubUrl(SUPABASE_URL, SERVICE_KEY, u.id)
    const id = await sendResend(RESEND_API_KEY, u.email, subject(m, u.plan || ''),
      render(m, { prenom: u.first_name || '', plan: u.plan || '', unsub }), unsub, m.id)
    if (id) {
      await sb.from('email_log').update({ resend_id: id, mail: m.id }).eq('user_id', u.id).eq('kind', kind)
      sent++; report[m.id] = (report[m.id] || 0) + 1
    }
    await new Promise((r) => setTimeout(r, 600))
    return !!id
  }

  // ── 1) Prospects : plan free sans aucun achat ──
  // Un client qui a payé ne reçoit pas la série prospects : les packs one-shot ne changent pas le plan, on exclut
  // donc toute trace d'achat (whop_member_id posé ou bought_credits > 0). drip_anchor = created_at par défaut ;
  // le remettre à now() REDÉMARRE la série pour un compte.
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
      // Transition : après un e-mail de l'ancienne série, on attend 20 h (jamais deux e-mails le même jour)
      if (now - l.legacyAt < 20 * 3600_000) continue
      const step = PROSPECT_STEPS.find((s) => age >= s.from && age < s.to)
      if (step) { await sendV2(u, BY_ID[step.id], `v2_${step.id}`); continue }
      if (age >= LONG_START) {
        if (now - l.at < CLIENT_GAP) continue
        const k = Math.floor((age - LONG_START) / LONG_EVERY)
        if (isBlackFridaySeason(today)) await sendV2(u, BY_ID['l4'], `v2_l4_${today.getUTCFullYear()}`, `v2_l_${k}`)
        else await sendV2(u, BY_ID[LONG_ROTATION[k % LONG_ROTATION.length]], `v2_l_${k}`)
      }
    }
  }

  // ── 2) Clients : première vidéo, relance d'inactivité, 0 crédit, l'idée de la semaine ──
  // Point de départ = bienvenue envoyée par whop-webhook (email_log 'welcome'), sinon création du compte.
  if (sent < MAX_SENDS) {
    const { data: users } = await sb.from('profiles')
      .select('id, email, first_name, plan, created_at, credits_remaining, whop_cancel_at_period_end')
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
        .gte('created_at', new Date(now - 60 * DAY).toISOString())
      for (const r of li ?? []) lastMade.set(r.user_id, Math.max(lastMade.get(r.user_id) ?? 0, Date.parse(r.created_at)))
    }
    const month = new Date(now).toISOString().slice(0, 7).replace('-', '')
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
      if (Z0_LIVE && u.credits_remaining === 0 && !u.whop_cancel_at_period_end) {
        if (await sendV2(u, BY_ID['z0'], `v2_z0_${month}`)) continue
      }
      const week = Math.floor(age / (7 * DAY))
      if (week >= 1) await sendV2(u, BY_ID[ROTATION_IDS[(week - 1) % ROTATION_IDS.length]], `v2_w_${week}`)
    }
  }

  console.log(`📬 email-drip: ${sent} envoi(s)`, JSON.stringify(report))
  return json({ ok: true, sent, report })
})
