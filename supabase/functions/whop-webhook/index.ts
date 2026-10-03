import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WHOP_WEBHOOK_SECRET  = Deno.env.get('WHOP_WEBHOOK_SECRET') ?? ''  // Whop Dashboard → Developer → Webhooks
const RESEND_API_KEY       = Deno.env.get('RESEND_API_KEY') ?? ''       // e-mail de bienvenue — no-op si absent

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

// ── PARRAINAGE (21/08) : 30 % de chaque paiement d'un filleul → gains du parrain ──
// Prix affichés (centimes) par plan Whop, utilisés si le payload ne porte pas le montant payé.
const PLAN_PRICE_CENTS: Record<string, number> = {
  plan_YKcdyPT6RRQSi: 2999, plan_g4BVtDmk6hgjQ: 4999, plan_w8lh5zpEJFOQR: 8999, plan_pZmWh1dVdmIWT: 15899, plan_63PGeG3MesbJR: 22499,
  plan_cNydK89X39PLE: 24999, plan_P7WIywSa6YrxT: 44999, plan_OvRwm5CW3xcNh: 79999, plan_uWTkJDl1GvxNR: 143988, plan_x2kDWR6ur2W5E: 189588,
  plan_hR0u4VHoeszbu: 1999, plan_GLoKHMqZtNbLK: 3999, plan_iRh99E5F2g4XU: 7499,
}
const REFERRAL_RATE = 0.30
// Audit 02/10 (PAY-4) : plans ANNUELS (bloc « Annuel » de SUB_MAP) — leur PLAN_PRICE_CENTS est le prix de l'ANNÉE.
// Le plafond anti auto-parrainage est ce que le parrain paie PAR MOIS : un plan annuel est ramené à son équivalent
// mensuel (÷ 12). Les packs (paiement unique) restent tels quels. Synchro avec handle_new_user (migration 03/10).
const ANNUAL_PLAN_IDS = new Set(['plan_cNydK89X39PLE', 'plan_P7WIywSa6YrxT', 'plan_OvRwm5CW3xcNh', 'plan_uWTkJDl1GvxNR', 'plan_x2kDWR6ur2W5E'])
const monthlyCents = (cents: number, planId: string) => ANNUAL_PLAN_IDS.has(planId) ? Math.round(cents / 12) : cents
// Prix mensuel (centimes) du plan du PARRAIN par tier — sert de plafond économique anti auto-parrainage ASYMÉTRIQUE
// (audit 14/09) : si la commission (30% du plan DU FILLEUL) dépasse ce que le parrain paie lui-même, c'est le signal
// typique d'un compte-leurre petit-plan qui parraine un gros filleul → on FLAGUE la commission pour revue owner
// (referral_reviews / approve_referral_earning) au lieu de l'auto-créditer. Faux positif = un vrai petit affilié qui
// amène un gros client → il est simplement mis en revue, jamais perdu (l'owner approuve). elite = plan mensuel max.
// Repli par TIER = prix MINIMUM du tier (audit chaînes 15/09) : un parrain Élite30 (8999) ne doit pas être jugé sur
// le prix Élite max (22499) — sinon commission 13500 (filleul Pro annuel) < 22499 → NON flaguée alors qu'elle dépasse
// ce que le parrain paie. On préfère le prix EXACT via whop_plan_id (ci-dessous) ; ce repli ne sert que s'il manque.
const REFERRER_PLAN_CAP: Record<string, number> = { starter: 2999, pro: 4999, elite: 8999 }
async function creditReferral(sb: any, referredId: string, referredEmail: string, planId: string, data: any, label: string) {
  try {
    const { data: prof } = await sb.from('profiles').select('referred_by, signup_ip').eq('id', referredId).maybeSingle()
    const code = String(prof?.referred_by || '').trim()
    if (!code) return
    const { data: referrerId } = await sb.rpc('referrer_id_from_code', { p_code: code })
    if (!referrerId || referrerId === referredId) return
    // Audit métier 14/09 (Phase 2) : la commission n'est due que si le PARRAIN est lui-même un client PAYANT.
    // Ce gate n'existait que côté client (app/index.html:8966,8972). Le porter au serveur ferme l'auto-parrainage
    // RENTABLE (2 comptes à soi) : pour toucher 30 % il faut désormais garder un 2e compte payant → net négatif.
    // Ne bloque JAMAIS un paiement — n'écarte qu'une commission indue (le paiement du filleul est traité normalement).
    const { data: refProf, error: refErr } = await sb.from('profiles').select('plan, signup_ip, whop_plan_id').eq('id', referrerId).maybeSingle()
    if (!refErr) {   // FAIL-OPEN sur hoquet DB (cohérent avec requirePlan/userPlan) : ne jamais dropper une commission légitime
      const refPlan = String(refProf?.plan || 'free').toLowerCase()
      if (refPlan === 'free' || refPlan === '') { console.log(`ℹ️ parrainage : parrain ${referrerId} non-payant (plan=${refPlan || '—'}) → pas de commission`); return }
    }
    // Audit métier 14/09 : auto-parrainage same-IP. Parrain et filleul inscrits depuis la MÊME IP → très probablement
    // le même propriétaire (2 comptes) → pas de commission. Faux positif rare (wifi partagé) = perte d'une commission
    // seulement (jamais un blocage de paiement), et c'est logué pour un override manuel de l'owner au virement du 1er.
    const _sipRef = String(refProf?.signup_ip || '').trim()
    const _sipFilleul = String((prof as { signup_ip?: string } | null)?.signup_ip || '').trim()
    if (_sipRef && _sipFilleul && _sipRef === _sipFilleul) {
      console.warn(`🚩 parrainage SAME-IP (auto-parrainage probable) — parrain ${referrerId} + filleul ${referredId} même IP d'inscription → pas de commission`)
      return
    }
    // Parrainage OU code promo — jamais les deux (Axel 11/09). Si un COUPON/REMISE Whop a été appliqué au
    // paiement → PAS de commission de parrainage. Whop peut nommer le champ de plusieurs façons : on regarde
    // large ET on logge les clés du payload pour CONFIRMER le nom exact du champ sur un vrai paiement avec promo.
    const _cpFields: Record<string, unknown> = {
      coupon: data?.coupon, coupon_id: data?.coupon_id, coupon_code: data?.coupon_code,
      discount: data?.discount, discount_code: data?.discount_code, discount_id: data?.discount_id,
      promo_code: data?.promo_code, promo: data?.promo,
      checkout_coupon: data?.checkout?.coupon, membership_coupon: data?.membership?.coupon,
      plan_coupon: data?.plan?.coupon, meta_promo: data?.metadata?.promo, meta_coupon: data?.metadata?.coupon,
    }
    const _hasCoupon = Object.values(_cpFields).some(v => v !== undefined && v !== null && v !== '' && v !== false && v !== 0)
    if (_hasCoupon) {
      console.log(`🎟️ Parrainage ANNULÉ (coupon détecté) — filleul ${referredEmail}, plan ${planId}, champs=${JSON.stringify(Object.fromEntries(Object.entries(_cpFields).filter(([, v]) => v !== undefined)))}`)
      return
    }
    console.log(`🔎 parrainage payload keys (${label}/${planId}): ${Object.keys(data || {}).join(',')}`)   // confirmer le champ coupon sur un vrai paiement avec promo
    // Montant RÉELLEMENT payé (audit 14/09, vérifié sur les vrais webhooks) : Whop l'expose en chaîne
    // formatée `initial_price_paid` ("€49.99" ; "€0.00" pour une promo 100%). Les champs final_amount/amount/
    // total N'EXISTENT PAS dans le payload. On calcule la commission sur le VRAI payé quand il est là → JAMAIS
    // 30% du prix plein d'une vente remisée. Ferme le stacking promo⊕parrainage à la racine : une vente à 0 €
    // = 0 commission, même si une promo échappait au check promo_code. Repli sur le prix du plan uniquement si
    // le champ manque (une vente SANS promo = prix plein ; les ventes AVEC promo sont déjà écartées plus haut).
    const _payStr = String(data?.initial_price_paid ?? '').trim()
    const _pay = parseFloat(_payStr.replace(/[^0-9.]/g, ''))
    let amountCents = _payStr !== '' && Number.isFinite(_pay) ? Math.round(_pay * 100) : (PLAN_PRICE_CENTS[planId] ?? 0)
    // Garde-fou (audit 14/09) : JAMAIS plus que le prix plein du plan. Protège d'un parse de locale à virgule
    // (« €1 439,88 » → strip → 143988 → gonflé ×100). Le montant vient d'un payload SIGNÉ, mais on borne par sûreté.
    const _cap = PLAN_PRICE_CENTS[planId] ?? 0
    if (_cap > 0 && amountCents > _cap) { console.warn(`⚠️ parrainage : montant parsé ${amountCents} > prix plan ${_cap} (${_payStr}) → plafonné`); amountCents = _cap }
    if (!amountCents) { console.log(`ℹ️ parrainage : payé 0/inconnu (${_payStr || '—'}) pour ${planId} → pas de commission`); return }
    const commission = Math.round(amountCents * REFERRAL_RATE)
    const day = new Date().toISOString().slice(0, 10)
    // Anti auto-parrainage ASYMÉTRIQUE (audit 14/09) : commission > prix du plan du parrain = signal typique du
    // compte-leurre. On n'écarte pas (un vrai petit affilié amenant un gros client existe) → on FLAGUE pour revue owner :
    // la commission est enregistrée mais N'ENTRE PAS dans le disponible (get_referral_summary l'exclut) tant que
    // l'owner ne l'a pas approuvée (approve_referral_earning). refProf null (hoquet DB, fail-open) → cap 0 → pas de flag.
    // Prix EXACT du plan du parrain via son whop_plan_id (Élite30=8999 ≠ Élite90=22499) ; repli tier-min sinon.
    // Audit 02/10 (PAY-4) : plafond = prix MENSUEL du plan du parrain. Un parrain ANNUEL était jugé sur le prix de son
    // ANNÉE (Starter annuel 249,99 €) → une commission jusqu'à ~250 € (filleul Élite30 annuel : 240 €) n'était jamais
    // flaguée. La commission, elle, n'est PAS divisée : celle d'un filleul annuel est versée d'un coup (30 % de l'année)
    // et c'est ce montant qui est en jeu (cas fermé le 15/09 : filleul Pro annuel 135 € > parrain Élite30 89,99 €).
    const refPlanId = String(refProf?.whop_plan_id || '')
    const refPlanCap = (PLAN_PRICE_CENTS[refPlanId] !== undefined
      ? monthlyCents(PLAN_PRICE_CENTS[refPlanId], refPlanId)
      : REFERRER_PLAN_CAP[String(refProf?.plan || '').toLowerCase()]) ?? 0
    // Relecture 25/09 : seul auth-otp enregistre l'IP d'inscription → un filleul inscrit par Google n'en a pas et la garde
    // same-IP ci-dessus ne peut rien vérifier (2e compte Google = 30 % sans signal) → commission en REVUE owner.
    const reviewReason = (refPlanCap > 0 && commission > refPlanCap)
      ? `auto-parrainage possible : commission ${(commission / 100).toFixed(2)}€ > plan parrain ${refProf?.plan} ${(refPlanCap / 100).toFixed(2)}€/mois`
      : !_sipFilleul ? 'IP d’inscription du filleul inconnue (inscription Google) : auto-parrainage non vérifiable'
      : null
    if (reviewReason) console.warn(`🚩 parrainage ASYMÉTRIQUE (flag revue owner) — ${reviewReason} (parrain ${referrerId}, filleul ${referredEmail})`)
    const { error } = await sb.from('referral_earnings').insert({
      referrer_id: referrerId, referred_id: referredId, referred_email: referredEmail, plan_id: planId, label,
      amount_cents: amountCents, commission_cents: commission, currency: 'EUR',
      review_reason: reviewReason,
      dedupe_key: `${referredId}:${planId}:${day}`,   // une commission par paiement (activation + payment.succeeded = même jour)
    })
    if (error) { if (String(error.code) === '23505') console.log('↩️ parrainage : commission déjà comptée aujourd\'hui'); else console.error('⚠️ parrainage :', error.message); return }
    console.log(`💶 Parrainage : +${(commission / 100).toFixed(2)} € pour ${referrerId} (${label} ${planId}, filleul ${referredEmail})`)
  } catch (e) { console.error('⚠️ parrainage :', e) }
}

// ── ATTRIBUTION AUTO-DM INSTAGRAM (25/09) : un compte relié à un lead Instagram (table ig_lead_links, posée par
// ig-go) qui passe d'un plan GRATUIT à un abonnement payant → paid_at + plan, 1re fois seulement (idempotent côté SQL :
// rejeu, renouvellement ou changement pro → élite ne changent rien). Appel ISOLÉ et best-effort : ne touche ni aux
// crédits ni au plan, ne peut ni bloquer ni faire échouer le traitement du paiement (erreur avalée, jamais de 500).
async function markIgLeadPaid(sb: any, userId: string, plan: string, prevPlan: string | null | undefined) {
  try {
    const { error } = await sb.rpc('ig_lead_mark_paid', { p_user: userId, p_plan: plan, p_prev_plan: prevPlan ?? null })
    if (error) console.warn('ℹ️ attribution Instagram (non bloquant) :', error.message)
  } catch (e) { console.warn('ℹ️ attribution Instagram (non bloquant) :', (e as Error)?.message) }
}
// Remboursement / litige / chargeback (branche clawback, profil remis en free) d'un compte relié → son passage payant
// est annulé (paid_at et plan remis à null, refunded_at posé) : il n'est plus compté « payant » dans les stats Auto-DM.
// Un réabonnement ultérieur (free → payant) le re-marque par markIgLeadPaid. Mêmes garanties : isolé, erreur avalée.
async function unmarkIgLeadPaid(sb: any, userId: string) {
  try {
    const { error } = await sb.rpc('ig_lead_unmark_paid', { p_user: userId })
    if (error) console.warn('ℹ️ attribution Instagram, remboursement (non bloquant) :', error.message)
  } catch (e) { console.warn('ℹ️ attribution Instagram, remboursement (non bloquant) :', (e as Error)?.message) }
}

// Audit 02/10 (PAY-3) : remboursement / litige d'un filleul → ses commissions des 90 derniers jours passent en REVUE
// owner (review_reason posé, rien n'est supprimé). get_referral_summary exclut du disponible toute commission en revue :
// plus de retrait d'une commission sur un paiement repris. L'owner la ré-approuve (approve_referral_earning) si le
// litige est gagné. Le motif existant (ex. IP inconnue) est conservé derrière le nouveau. Recherche par compte ET par
// e-mail du filleul (compte supprimé ou e-mail changé). Best-effort : ne bloque jamais le traitement du webhook.
// Renvoie le nombre de commissions mises en revue, ou null si la base n'a pas répondu (signalé dans l'alerte owner).
const CLAWBACK_REVIEW_PREFIX = 'remboursement ou litige du filleul'
async function flagReferralClawback(sb: any, referredId: string | null, referredEmail: string, action: string): Promise<number | null> {
  try {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const rows = new Map<string, string | null>()
    const keys: [string, string | null][] = [['referred_id', referredId], ['referred_email', referredEmail || null]]
    for (const [col, val] of keys) {
      if (!val) continue
      const { data, error } = await sb.from('referral_earnings').select('id, review_reason').eq(col, val).gte('created_at', since)
      if (error) { console.error('⚠️ parrainage (clawback) :', error.message); return null }
      for (const r of data || []) rows.set(String(r.id), r.review_reason ?? null)
    }
    let n = 0
    for (const [id, prev] of rows) {
      if (String(prev || '').startsWith(CLAWBACK_REVIEW_PREFIX)) continue   // déjà contestée (remboursement PUIS litige)
      const reason = `${CLAWBACK_REVIEW_PREFIX} (${action.slice(0, 60)})` + (prev ? ` · ${prev}` : '')
      const { error } = await sb.from('referral_earnings').update({ review_reason: reason }).eq('id', id)
      if (error) { console.error('⚠️ parrainage (clawback) :', error.message); return null }
      n++
    }
    if (n) console.warn(`🚩 parrainage : ${n} commission(s) du filleul ${referredId || referredEmail} mise(s) en revue (${action})`)
    return n
  } catch (e) { console.error('⚠️ parrainage (clawback) :', e); return null }
}

// Audit 02/10 (PAY-1) : un achat fait SANS compte vit dans pending_activations (appliqué par handle_new_user à
// l'inscription). Résiliation, remboursement ou litige n'y touchaient pas → plan payant gardé à vie après remboursement.
// Lignes retrouvées par e-mail (clé primaire) ET par abonnement Whop (un paiement / remboursement peut arriver sans
// e-mail). Dédoublonnées par e-mail.
const PENDING_COLS = 'email, plan, credits, img_credits, whop_member_id, whop_plan_id, paid_at'
async function findPendingRows(sb: any, email: string, memberId: string | null): Promise<{ rows: any[]; error: unknown }> {
  const rows = new Map<string, any>()
  const keys: [string, string | null][] = [['email', email || null], ['whop_member_id', memberId ? String(memberId) : null]]
  for (const [col, val] of keys) {
    if (!val) continue
    const { data, error } = await sb.from('pending_activations').select(PENDING_COLS).eq(col, val)
    if (error) return { rows: [], error }
    for (const r of data || []) rows.set(String(r.email), r)
  }
  return { rows: [...rows.values()], error: null }
}
// Part « pack » d'une ligne d'abonnement en attente : credits = crédits du plan + bonus 1er abonnement + packs achetés
// sans compte (cf. upserts de l'activation). Plan Whop hors catalogue → part inconnue → 0 (prudence).
function pendingPackLeft(pa: any): number {
  const sub = SUB_MAP[String(pa?.whop_plan_id || '')]
  if (!sub) return 0
  return Math.max(0, (pa?.credits || 0) - sub.credits - (FIRST_SUB_BONUS[sub.plan] ?? 0))
}
// Résiliation : retire de pending_activations l'abonnement QUI EXPIRE (même identifiant d'abonnement ; repli sur le plan
// si aucun n'est stocké, même règle que la branche avec profil). Les crédits de packs achetés sans compte restent en
// attente (ligne repassée en plan free), sinon la ligne est supprimée. Appelée AVEC OU SANS profil : après un changement
// d'e-mail, l'adresse de l'achat peut être portée par un autre compte (relecture 02/10). Renvoie le nombre de lignes
// neutralisées, ou null si la base n'a pas répondu (l'appelant rend 500 → Whop rejoue).
async function neutralisePendingSub(sb: any, email: string, expiringMember: string | null, planId: string): Promise<number | null> {
  const { rows, error } = await findPendingRows(sb, email, expiringMember)
  if (error) { console.error('❌ pending_activations (résiliation) :', error); return null }
  let n = 0
  for (const pa of rows) {
    if (!pa.plan || pa.plan === 'free') continue   // pack seul : l'expiration d'un abonnement ne le concerne pas
    const memeAbo = (pa.whop_member_id && expiringMember && String(pa.whop_member_id) === String(expiringMember)) ||
      (!pa.whop_member_id && (!pa.whop_plan_id || pa.whop_plan_id === planId))
    if (!memeAbo) continue
    const packLeft = pendingPackLeft(pa)
    const { error: e2 } = (packLeft > 0 || (pa.img_credits || 0) > 0)
      ? await sb.from('pending_activations').update({ plan: 'free', credits: packLeft, whop_member_id: null, whop_plan_id: null }).eq('email', pa.email)
      : await sb.from('pending_activations').delete().eq('email', pa.email)
    if (e2) { console.error('❌ pending_activations (résiliation) :', e2); return null }
    n++
  }
  return n
}
// Remboursement / litige : supprime TOUTES les lignes en attente de l'acheteur (e-mail ET abonnement), comme la branche
// avec profil remet tout à zéro. Avec ou sans profil (même raison que ci-dessus). null = échec DB (fail-closed : 500).
async function purgePendingRows(sb: any, email: string, memberId: string | null): Promise<number | null> {
  let n = 0
  const keys: [string, string | null][] = [['email', email || null], ['whop_member_id', memberId ? String(memberId) : null]]
  for (const [col, val] of keys) {
    if (!val) continue
    const { data: gone, error } = await sb.from('pending_activations').delete().eq(col, val).select('email')
    if (error) { console.error('❌ pending_activations (clawback) :', error); return null }
    n += (gone || []).length
  }
  return n
}

// Audit 02/10 (PAY-6) : toute valeur venant d'un utilisateur ou du payload est échappée avant d'entrer dans un e-mail
// HTML (même échappement que whop-cancel, + guillemets).
const escHtml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Alerte owner (remboursement, litige, résiliation d'un achat sans compte). Best-effort : jamais bloquant.
async function alertOwner(subject: string, title: string, rows: [string, string][], note: string) {
  if (!RESEND_API_KEY) return
  try {
    const html = `<div style="font-family:sans-serif;line-height:1.6"><h2>${escHtml(title)}</h2>`
      + rows.map(([k, v]) => `<p><b>${escHtml(k)} :</b> ${escHtml(v)}</p>`).join('')
      + `<p>${escHtml(note)}</p></div>`
    await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'AvatarAds <bonjour@avatarads.fr>', to: ['axel@iamanager.fr'], subject, html }),
    })
  } catch (e) { console.error('alerte owner', e) }
}

// ─────────────────────────────────────────────────────────────────
// PACKS one-shot → AJOUTE des crédits (ne touche pas au plan)
// ─────────────────────────────────────────────────────────────────
const PACK_MAP: Record<string, { credits?: number; imgCredits?: number }> = {
  // Packs revus 31/08 (Axel) — Flash 9,99€ supprimé ; nouveaux produits Whop S/M/L
  // (anciens plan_w0DMfzGzEdmYF / plan_xgsRkGzvSgUkf / plan_EVUzCdQ1H1EdL supprimés côté Whop)
  'plan_hR0u4VHoeszbu': { credits: 120 },  // Pack S  19,99€
  'plan_GLoKHMqZtNbLK': { credits: 300 },  // Pack M  39,99€ (le plus populaire)
  'plan_iRh99E5F2g4XU': { credits: 600 },  // Pack L  74,99€
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
function _ctEq(a: string, b: string): boolean {   // L1 (06/09) : comparaison de MAC en temps constant
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0
}
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
        if (v && _ctEq(v, expected)) return true
      }
    }
    // 2) Anciens formats hex
    const legacy = h.get('whop-signature') ?? h.get('x-whop-signature') ?? ''
    if (legacy) {
      if (legacy.includes('v1=')) {
        const t  = (legacy.match(/t=([^,]+)/) ?? [])[1] ?? ''
        const v1 = (legacy.match(/v1=([0-9a-f]+)/i) ?? [])[1] ?? ''
        if (t && v1 && _ctEq(_hex(await _hmac(`${t}.${body}`)), v1.toLowerCase())) return true
      }
      const plain = legacy.replace(/^sha256=/, '').trim().toLowerCase()
      if (_ctEq(_hex(await _hmac(body)), plain)) return true
    }
    // Diagnostic (noms de headers seulement, jamais les valeurs)
    console.error('❌ Signature invalide · headers presents:', [...h.keys()].filter(k => /sig|whop|svix|webhook/i.test(k)).join(', ') || 'aucun header de signature')
    return false
  } catch { return false }
}

// ── E-mail de bienvenue (Resend) — envoyé UNE fois par compte (dédup email_log) ──
const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro', elite: 'Élite' }
async function sendWelcomeEmail(sb: any, opts: { userId?: string; email: string; firstName?: string; plan: string; credits: number; pending?: boolean }) {
  if (!RESEND_API_KEY) return
  try {
    if (opts.userId) {
      const { error } = await sb.from('email_log').insert({ user_id: opts.userId, email: opts.email, kind: 'welcome' })
      if (error) return // déjà envoyé (ex. upgrade de plan)
    }
    const label = PLAN_LABEL[opts.plan] ?? opts.plan
    // Audit 02/10 (PAY-6) : le prénom est modifiable par l'utilisateur → échappé (sinon HTML/liens injectés dans un
    // e-mail envoyé depuis bonjour@avatarads.fr).
    const name = opts.firstName ? `${escHtml(opts.firstName)}, ` : ''
    const body = opts.pending
      ? `${name}ton paiement est bien enregistré ✅<br><br>Il ne reste qu'une étape : <b>crée ton compte sur avatarads.fr avec cette adresse e-mail</b> — ton plan ${label} et tes crédits s'activeront automatiquement à la connexion.`
      : `${name}bienvenue dans AvatarAds 🎉<br><br>Ton plan <b>${label}</b> est actif avec <b>${opts.credits} crédits</b> ce mois-ci (1 crédit = 1 seconde de vidéo).<br><br>Pour ta première vidéo :<br>1️⃣ Décris ton produit dans le Générateur<br>2️⃣ Choisis un avatar et une voix<br>3️⃣ Clique sur Générer — l'IA fait le reste 🎬<br><br>Une question ? Réponds simplement à cet e-mail.`
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:520px;margin:0 auto;padding:32px 20px">
        <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:22px">🎬 AvatarAds</div>
        <div style="background:#fff;border-radius:16px;padding:30px 28px;border:1px solid #e7e5e4">
          <div style="font-size:21px;font-weight:800;color:#111;line-height:1.3;margin-bottom:14px">${opts.pending ? 'Ton plan t’attend !' : 'Bienvenue à bord 🚀'}</div>
          <div style="font-size:15px;color:#44403c;line-height:1.65">${body}</div>
          <img src="https://avatarads.fr/assets/mail/avatars-podium.jpg" alt="Les avatars IA d'AvatarAds" width="100%" style="display:block;border-radius:12px;border:1px solid #e7e5e4;margin-top:22px">
          <a href="https://avatarads.fr/app/" style="display:block;text-align:center;background:#FF6B35;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 20px;border-radius:12px;margin-top:24px">${opts.pending ? 'Créer mon compte →' : 'Créer ma première vidéo →'}</a>
        </div>
        <div style="font-size:11.5px;color:#a8a29e;text-align:center;margin-top:18px">AvatarAds · avatarads.fr</div>
      </div></body></html>`
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'AvatarAds <bonjour@avatarads.fr>', to: [opts.email], subject: opts.pending ? 'Ton plan AvatarAds t’attend — une dernière étape' : `Bienvenue sur AvatarAds 🎉 Ton plan ${label} est actif`, html }),
    })
    console.log(r.ok ? `📧 Bienvenue envoyé à ${opts.email}` : `⚠️ Resend ${r.status} pour ${opts.email}`)
  } catch (e) { console.error('⚠️ welcome email:', e) }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body = await req.text()

  // Signature OBLIGATOIRE — FAIL-CLOSED (audit 05/09, M2) : sans secret configuré on ne traite RIEN,
  // sinon n'importe qui pourrait POSTer un faux « paiement réussi » et se créditer un plan.
  if (!WHOP_WEBHOOK_SECRET) {
    console.error('❌ WHOP_WEBHOOK_SECRET absent — webhook refusé (fail-closed)')
    return new Response('Webhook secret not configured', { status: 503 })
  }
  if (!(await verifyWebhook(req, body))) {
    return new Response('Unauthorized', { status: 401 })
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
  // Audit métier 06/09 : un remboursement / litige / chargeback n'était PAS traité → l'utilisateur gardait ses
  // crédits alors qu'il a récupéré son argent. On rétrograde + remet à zéro. (payment.failed = échec temporaire
  // avec retries Whop → EXCLU ; la résiliation définitive passe par membership.went_invalid.)
  const isClawback   = /(refund|dispute|chargeback)/.test(action) && !/dispute[._](won|closed|resolved)/.test(action)

  // paiements/renouvellements : l'e-mail peut manquer du payload → on garde aussi l'ID d'abonnement Whop
  const memberId = data.membership_id ?? data.membership?.id ?? ((isActivate || isDeactivate) ? (data.id ?? null) : null) ?? null
  console.log(`📨 Whop webhook: ${action} · plan=${planId} · email=${email || '—'}`)

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // ── #123 · VERROU D'IDEMPOTENCE ──────────────────────────────────────────
  // Whop (Svix) REJOUE un webhook tant qu'il n'a pas reçu de 2xx. L'achat d'un
  // pack de crédits INCRÉMENTE le solde → un rejeu créditait DEUX FOIS pour un
  // seul paiement. L'index unique sur webhook_events.event_id fait le verrou :
  // si l'insertion échoue, l'événement a déjà été traité, on sort en 200.
  const eventId = req.headers.get('webhook-id') ?? req.headers.get('svix-id') ?? null
  if (eventId) {
    const { error: dupErr } = await sb.from('webhook_events').insert({ event_id: eventId, body: event })
    if (dupErr) {
      console.log(`↩️ Webhook ${eventId} déjà traité — rejeu ignoré (${dupErr.code || 'conflit'})`)
      return new Response('OK (déjà traité)', { status: 200 })
    }
  } else {
    // pas d'identifiant fourni : on journalise seulement (on ne peut pas dédoublonner)
    console.warn('⚠️ Webhook sans identifiant — impossible de détecter un rejeu')
    try { await sb.from('webhook_events').insert({ body: event }) } catch (_) {}
  }

  // Audit métier 06/09 : le verrou d'idempotence est posé AVANT le traitement. Si une étape échoue (500), la
  // ligne webhook_events restait → au rejeu de Whop, l'insertion dédoublonnait → 200 « déjà traité » → le
  // crédit n'était JAMAIS appliqué (paiement perdu). failDb RELÂCHE le verrou avant tout 500 → le rejeu re-traite.
  const failDb = async () => {
    if (eventId) { try { await sb.from('webhook_events').delete().eq('event_id', eventId) } catch (_) { /* best-effort */ } }
    // H1 (audit 14/09) : était `return await failDb()` = RÉCURSION INFINIE (hang + martèlement DELETE, jamais
    // de 500). On relâche le verrou d'idempotence PUIS on rend un vrai 500 → Whop rejoue et re-traite proprement.
    return new Response('Erreur interne — réessai attendu', { status: 500 })
  }

  // Audit 02/10 : profil cherché par l'ABONNEMENT Whop d'abord, l'e-mail en repli. Depuis que le changement d'adresse
  // remarche (auth-otp, contrat C1), l'ancienne adresse peut être réinscrite (compte gratuit) : chercher par e-mail
  // d'abord envoyait remboursement, litige, résiliation ou renouvellement sur ce compte gratuit, et le compte abonné
  // gardait son plan. whop_member_id n'est jamais écrit par le client (profiles_guard) : il vient des seuls webhooks
  // signés. Pas d'index unique dessus : plusieurs lignes (PGRST116) = clé ambiguë → repli e-mail, comme avant.
  // lookup : clé qui a trouvé le profil + échec de lecture (hors PGRST116), lus par résiliation et remboursement.
  const lookup: { by: 'abonnement' | 'email' | null; failed: boolean } = { by: null, failed: false }
  const findProfile = async () => {
    const cols = 'id, plan, first_name, credits_remaining, bought_credits, img_bonus_credits, whop_plan_id, whop_member_id, first_sub_bonus_used'
    lookup.by = null; lookup.failed = false
    if (memberId) {
      const { data: p, error } = await sb.from('profiles').select(cols).eq('whop_member_id', memberId).maybeSingle()
      if (error && error.code !== 'PGRST116') lookup.failed = true
      if (p) { lookup.by = 'abonnement'; return p }
    }
    if (email) {
      const { data: p, error } = await sb.from('profiles').select(cols).eq('email', email).maybeSingle()
      if (error && error.code !== 'PGRST116') lookup.failed = true
      if (p) { lookup.by = 'email'; return p }
    }
    return null
  }
  // Crédits ACHETÉS en pack encore disponibles (les crédits du plan sont consommés en premier)
  const boughtLeft = (p: any) => Math.min(p?.bought_credits || 0, p?.credits_remaining || 0)

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
        const keep = boughtLeft(profile) // les crédits achetés en pack survivent au changement de plan
        const { error } = await sb.from('profiles').update({
          plan:              sub.plan,
          credits_remaining: sub.credits + bonus + keep,
          bought_credits:    keep,
          credits_total:     sub.credits,
          whop_member_id:    data.id ?? null,
          whop_plan_id:      planId,
          whop_manage_url:   data.manage_url ?? null,
          whop_cancel_at_period_end: false,
          first_sub_bonus_used: true,
        }).eq('id', profile.id)
        if (error) { console.error('❌ Update profil:', error); return await failDb() }
        await markIgLeadPaid(sb, profile.id, sub.plan, profile.plan)   // plan AVANT cette mise à jour (lu par findProfile)
        await creditReferral(sb, profile.id, email, planId, data, 'abonnement')
        console.log(`✅ Plan activé pour ${email}: ${sub.plan} (${sub.credits} crédits${bonus ? ' +' + bonus + ' bonus' : ''}${keep ? ' +' + keep + ' achetés reportés' : ''})`)
        await sendWelcomeEmail(sb, { userId: profile.id, email, firstName: profile.first_name || '', plan: sub.plan, credits: sub.credits + bonus + keep })
      } else {
        // Audit 06/09 : l'upsert écrasait un pending EXISTANT → un pack acheté AVANT l'abonnement (sans compte)
        // était perdu. On préserve les crédits d'un pack (pending plan=free) et les crédits image en attente.
        const { data: paS } = await sb.from('pending_activations').select('plan, credits, img_credits').eq('email', email).maybeSingle()
        const carryPack = (paS && (!paS.plan || paS.plan === 'free')) ? (paS.credits || 0) : 0
        const carryImg  = paS?.img_credits || 0
        const { error } = await sb.from('pending_activations').upsert({
          email, product: 'avatarads', plan: sub.plan,
          credits: sub.credits + (FIRST_SUB_BONUS[sub.plan] ?? 0) + carryPack,
          img_credits: carryImg,
          whop_member_id: data.id ?? null, whop_plan_id: planId, paid_at: new Date().toISOString(),
        }, { onConflict: 'email' })
        if (error) { console.error('❌ pending_activations:', error); return await failDb() }
        console.log(`⏳ Activation en attente pour ${email}: ${sub.plan}`)
        await sendWelcomeEmail(sb, { email, plan: sub.plan, credits: sub.credits + (FIRST_SUB_BONUS[sub.plan] ?? 0), pending: true })
      }
    } else if (pack) {
      if (profile) {
        const { error } = await sb.from('profiles').update({
          credits_remaining: (profile.credits_remaining || 0) + (pack.credits || 0),
          bought_credits:    boughtLeft(profile) + (pack.credits || 0), // tracés à part : préservés à l'annulation
          img_bonus_credits: (profile.img_bonus_credits || 0) + (pack.imgCredits || 0),
        }).eq('id', profile.id)
        if (error) { console.error('❌ Crédit pack:', error); return await failDb() }
        console.log(`✅ Pack crédité pour ${email}: +${pack.credits || 0} crédits, +${pack.imgCredits || 0} images`)
        await creditReferral(sb, profile.id, email, planId, data, 'pack')
      } else {
        // Pack payé sans compte → stocké en attente (cumulatif, plan inchangé)
        const { data: pa } = await sb.from('pending_activations').select('plan, credits, img_credits').eq('email', email).maybeSingle()
        // Audit 02/10 (PAY-1) : sur une ligne d'ABONNEMENT, paid_at = dernier paiement de l'abonnement (handle_new_user
        // ignore un abonnement en attente périmé) → un pack acheté par-dessus ne la rafraîchit pas (colonne omise :
        // l'upsert ne la touche pas). Ligne de pack seul ou nouvelle ligne : inchangé.
        const subPending = !!(pa?.plan && pa.plan !== 'free')
        const { error } = await sb.from('pending_activations').upsert({
          email, product: 'avatarads',
          plan:        pa?.plan || 'free',
          credits:     (pa?.credits || 0) + (pack.credits || 0),
          img_credits: (pa?.img_credits || 0) + (pack.imgCredits || 0),
          ...(subPending ? {} : { paid_at: new Date().toISOString() }),
        }, { onConflict: 'email' })
        if (error) { console.error('❌ pending pack:', error); return await failDb() }
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
    // Audit 02/10 : lecture en échec → 500, Whop rejoue (un repli silencieux sur l'e-mail pourrait viser le mauvais compte).
    if (lookup.failed) return await failDb()
    // Downgrade uniquement si l'abonnement QUI EXPIRE est BIEN l'actif du profil — par IDENTIFIANT D'ABONNEMENT
    // (audit 06/09 : comparer le plan id cassait l'upgrade vers le MÊME palier — l'ancien membership expirait avec
    // le même plan id et rétrogradait le nouveau). Repli sur le plan id seulement si aucun member id n'est stocké.
    const expiringMember = data.id ?? memberId ?? null
    // Audit 02/10 (PAY-1) : un abonnement payé SANS compte puis résilié restait dans pending_activations et
    // handle_new_user appliquait quand même le plan à l'inscription. Neutralisé AVANT tout autre effet (échec DB → 500,
    // Whop rejoue), avec ou sans profil : l'adresse de l'achat peut être portée par un autre compte (changement d'e-mail).
    const neutralised = await neutralisePendingSub(sb, email, expiringMember, planId)
    if (neutralised === null) return await failDb()
    if (neutralised) console.log(`⛔ Résiliation (${email}) : ${neutralised} abonnement(s) en attente retiré(s)`)
    const estActif = profile && (
      (profile.whop_member_id && expiringMember && String(profile.whop_member_id) === String(expiringMember)) ||
      (!profile.whop_member_id && (!profile.whop_plan_id || profile.whop_plan_id === planId))
    )
    if (estActif) {
      const keep = boughtLeft(profile) // les crédits achetés restent parqués (réutilisables au prochain abonnement)
      await sb.from('profiles').update({
        plan:              'free',
        credits_remaining: keep,
        bought_credits:    keep,
        whop_member_id:    null,
        whop_plan_id:      null,
        whop_manage_url:   null,
        whop_cancel_at_period_end: false,
      }).eq('id', profile.id)
      console.log(`⛔ Plan résilié pour ${email} → free${keep ? ` (${keep} crédits achetés conservés)` : ''}`)
    }
    // Audit 02/10 (PAY-1) : alerte owner pour toute résiliation SANS compte, et pour un abonnement en attente retiré
    // alors qu'un compte porte l'adresse (cas inhabituel : changement d'e-mail). Une résiliation ordinaire avec compte
    // reste silencieuse (inchangé).
    if (!profile || neutralised) {
      await alertOwner(`⚠️ Résiliation ${profile ? 'd’un achat en attente' : 'sans compte'} AvatarAds — ${email}`,
        profile ? 'Résiliation d’un abonnement en attente (adresse portée par un compte)' : 'Résiliation d’un abonnement sans compte', [
          ['Événement', action], ['E-mail Whop', email], ['Abonnement', String(expiringMember || '—')], ['Abonnements en attente retirés', String(neutralised)],
        ], neutralised
          ? 'Le plan en attente ne sera pas appliqué si cette personne crée un compte (les crédits de packs éventuels restent en attente).'
          : 'Aucun abonnement en attente trouvé : si cette personne a un compte sous une autre adresse, vérifie son plan à la main.')
    } else if (lookup.by === 'email' && !profile.whop_member_id && String(profile.plan || 'free').toLowerCase() === 'free') {
      // Audit 02/10 : aucun compte ne porte cet abonnement et le compte de l'adresse Whop est déjà gratuit → la résiliation
      // n'a rien retiré. Normal juste après un remboursement ; sinon l'abonnement peut être porté par un compte dont
      // l'adresse a changé (ancienne adresse réinscrite) → vérification à la main.
      await alertOwner(`⚠️ Résiliation sans effet AvatarAds — ${email}`, 'Résiliation reçue pour un compte déjà gratuit', [
        ['Événement', action], ['E-mail Whop', email], ['Abonnement', String(expiringMember || '—')], ['Compte de cette adresse', String(profile.id)],
      ], 'Aucun compte n’est relié à cet abonnement et le compte de cette adresse est déjà gratuit. Normal juste après un remboursement ; sinon, l’abonnement est peut-être porté par un compte dont l’adresse a changé : vérifie son plan à la main.')
    }
  }

  // ─── membership.renewed → renouvellement mensuel ──────────────
  else if (isRenew) {
    // Paiement réussi / renouvellement. L'e-mail peut manquer du payload d'un paiement → on retrouve le profil
    // par l'abonnement Whop (memberId), et on déduit le plan du profil si le payload ne le porte pas.
    const profile = await findProfile()
    // Audit 02/10 (PAY-1) : sans compte, l'abonnement en attente sert à rafraîchir paid_at (voir plus bas) et, si le
    // paiement ne porte pas le plan, à le déduire. Lecture best-effort : un hoquet DB ne bloque pas le webhook.
    const pend = profile ? null : await findPendingRows(sb, email, memberId)
    if (pend?.error) console.warn('ℹ️ pending_activations (renouvellement, non bloquant) :', pend.error)
    const pendSub = (pend?.rows || []).find((r: any) => r.plan && r.plan !== 'free') ?? null
    const effPlanId = planId || profile?.whop_plan_id || pendSub?.whop_plan_id || ''
    const sub = SUB_MAP[effPlanId]
    if (!sub) return new Response('OK', { status: 200 })
    // Ignore le renouvellement d'un ANCIEN abonnement (après upgrade) → ne doit pas écraser le plan actif
    if (profile && profile.whop_plan_id && planId && profile.whop_plan_id !== planId) {
      console.log(`ℹ️ Renouvellement ignoré (abonnement ${planId} n'est plus l'actif de ${profile.id})`)
      return new Response('OK', { status: 200 })
    }
    // ── Anti DOUBLE-CRÉDIT du 1er cycle (audit 05/09, M3) : au premier achat Whop envoie DEUX événements
    //    (activation + paiement) avec des webhook-id différents → l'idempotence par event_id ne les fusionne
    //    pas et le paiement REPORTAIT un solde tout juste fixé par l'activation (150 → 300). Si une activation
    //    du même abonnement / e-mail a été reçue dans les 10 dernières minutes, ce paiement est un no-op.
    if (profile) {
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString()
      const { data: recents } = await sb.from('webhook_events').select('body').gte('received_at', tenMinAgo).order('received_at', { ascending: false }).limit(200)   // audit métier 06/09 : ordonné + plafond relevé (l'activation ne doit pas sortir de la fenêtre)
      const memberKey = memberId || data.id || null
      const dupAct = (recents || []).some((e: any) => {
        const b = e?.body || {}; const a = String(b.action ?? b.event ?? b.type ?? '').toLowerCase(); const d = b.data || {}
        if (!/membership[._](went[._]valid|activated)/.test(a)) return false
        const em = String(d.user?.email ?? d.member?.user?.email ?? d.customer?.email ?? d.email ?? '').toLowerCase().trim()
        const mid = d.id ?? d.membership_id ?? d.membership?.id ?? null
        return (memberKey && mid && String(mid) === String(memberKey)) || (email && em && em === email)
      })
      if (dupAct) {
        console.log(`ℹ️ Paiement du 1er cycle déjà crédité par l'activation (${memberKey || email}) → pas de re-crédit`)
        return new Response('OK (déjà crédité à l\'activation)', { status: 200 })
      }
    }
    if (profile) {
      // REPORT PLAFONNÉ À 2× (03/09 — Axel) : les crédits du PLAN non consommés sont reportés au mois suivant,
      // mais le solde du plan ne peut jamais dépasser 2× les crédits mensuels (le surplus des vieux mois est perdu).
      // Les crédits ACHETÉS en pack (bought) ne sont jamais plafonnés et s'ajoutent par-dessus.
      const bought      = boughtLeft(profile)
      const planLeft    = Math.max(0, (profile.credits_remaining || 0) - bought)   // solde du plan encore là
      const rolled      = Math.min(planLeft + sub.credits, 2 * sub.credits)         // report + mois neuf, plafond 2×
      const newBalance  = rolled + bought
      await sb.from('profiles').update({
        plan:              sub.plan,
        credits_remaining: newBalance,
        bought_credits:    bought,
        credits_total:     sub.credits,
        whop_plan_id:      effPlanId,
        whop_cancel_at_period_end: false,
      }).eq('id', profile.id)
      console.log(`🔄 Renouvellement: ${sub.plan} → ${newBalance} (report ${planLeft} + ${sub.credits}, plafond ${2 * sub.credits}${bought ? ` +${bought} achetés` : ''}) — ${profile.id}`)
      await markIgLeadPaid(sb, profile.id, sub.plan, profile.plan)   // no-op pour un vrai renouvellement (déjà payant)
      await creditReferral(sb, profile.id, email, effPlanId, data, 'renouvellement')
    } else {
      console.warn(`⚠️ Renouvellement sans profil (email=${email || '—'} member=${memberId || '—'} plan=${effPlanId})`)
      // Audit 02/10 (PAY-1) : handle_new_user ignore désormais un abonnement en attente dont le DERNIER paiement
      // (paid_at) a plus d'une période + marge. Un acheteur toujours sans compte qui continue de payer garde donc une
      // ligne fraîche : paid_at est rafraîchi à chaque paiement du MÊME abonnement (identifiant, sinon plan).
      const memeAbo = pendSub && ((pendSub.whop_member_id && memberId)
        ? String(pendSub.whop_member_id) === String(memberId)
        : (!pendSub.whop_plan_id || pendSub.whop_plan_id === effPlanId))
      if (memeAbo) {
        const { error: touchErr } = await sb.from('pending_activations').update({ paid_at: new Date().toISOString() }).eq('email', pendSub.email)
        if (touchErr) console.warn('ℹ️ pending_activations (renouvellement, non bloquant) :', touchErr.message)
        else console.log(`⏳ Abonnement en attente prolongé (${pendSub.email}, ${effPlanId})`)
      }
    }
  }

  // ─── remboursement / litige / chargeback → clawback des crédits ──
  else if (isClawback) {
    const profile = await findProfile()
    // Audit 02/10 : lecture en échec → 500, Whop rejoue (même raison que la résiliation).
    if (lookup.failed) return await failDb()
    // Audit 02/10 (PAY-1) : remboursement / litige d'un achat fait SANS compte → la ligne en attente restait et
    // handle_new_user appliquait plan + crédits à l'inscription (plan payant gardé à vie). Toutes les lignes en attente
    // de l'acheteur (e-mail ET abonnement) sont supprimées AVANT tout autre effet, avec ou sans profil : l'adresse de
    // l'achat peut être portée par un autre compte après un changement d'e-mail (relecture 02/10). Échec DB → 500 :
    // Whop rejoue, la ligne ne doit pas survivre (fail-closed).
    const removed = await purgePendingRows(sb, email, memberId)
    if (removed === null) return await failDb()
    if (profile) {
      const { error: clawErr } = await sb.from('profiles').update({
        plan: 'free', credits_remaining: 0, bought_credits: 0,
        whop_member_id: null, whop_plan_id: null, whop_manage_url: null, whop_cancel_at_period_end: false,
      }).eq('id', profile.id)
      console.log(`💸 Clawback (${action}) pour ${email || profile.id} → free, crédits remis à zéro`)
      if (!clawErr) await unmarkIgLeadPaid(sb, profile.id)   // plus compté « payant » (seulement si le profil est bien repassé free)
      // Audit 02/10 (PAY-3) : les commissions récentes du filleul passent en revue → plus retirables. Une commission
      // DÉJÀ virée reste à réverser À LA MAIN (l'accounting des payouts est trop sensible pour un revert automatique).
      const flagged = await flagReferralClawback(sb, profile.id, email, action)
      if (removed) console.log(`💸 Clawback (${action}) : ${removed} ligne(s) en attente supprimée(s) pour ${email || memberId}`)
      // Audit 02/10 : compte retrouvé par l'e-mail et sans abonnement Whop enregistré → si c'est un ABONNEMENT qui est
      // remboursé, il peut être porté par un autre compte (adresse changée puis ancienne adresse réinscrite).
      const parEmailSansAbo = lookup.by === 'email' && !profile.whop_member_id
      await alertOwner(`⚠️ Clawback AvatarAds — ${email || profile.id}`, 'Remboursement / litige', [
        ['Événement', action], ['Membre', email || profile.id],
        ['Compte retrouvé par', lookup.by === 'abonnement' ? 'abonnement Whop' : 'e-mail'],
        ...(removed ? [['Achats en attente supprimés', String(removed)] as [string, string]] : []),
        ['Commissions de parrainage mises en revue (90 j)', flagged === null ? 'échec, à vérifier à la main' : String(flagged)],
      ], 'Plan remis à free, crédits à zéro. Les commissions du filleul ne sont plus retirables ; si l’une d’elles a déjà été virée, pense à la réverser dans « Tes gains ».'
        + (parEmailSansAbo ? ' Ce compte a été retrouvé par l’e-mail et n’avait pas d’abonnement Whop enregistré : s’il s’agit du remboursement d’un abonnement, vérifie qu’aucun autre compte ne le porte (adresse changée) et remets-le à free à la main le cas échéant.' : ''))
    } else {
      console.log(`ℹ️ Clawback ${action} sans profil (${email || '—'}) : ${removed} ligne(s) en attente supprimée(s)`)
      const flagged = email ? await flagReferralClawback(sb, null, email, action) : 0
      await alertOwner(`⚠️ Clawback AvatarAds (sans compte) — ${email || memberId || '—'}`, 'Remboursement / litige sans compte', [
        ['Événement', action], ['E-mail Whop', email || '—'], ['Abonnement', String(memberId || '—')],
        ['Achats en attente supprimés', String(removed)],
        ['Commissions de parrainage mises en revue (90 j)', flagged === null ? 'échec, à vérifier à la main' : String(flagged)],
      ], removed
        ? 'Le plan et les crédits ne seront pas appliqués si cette personne crée un compte.'
        : 'Aucun achat en attente trouvé : si cette personne a un compte sous une autre adresse, remets son plan à free à la main.')
    }
  }

  // ─── Autres events → on ignore ────────────────────────────────
  else {
    console.log(`ℹ️ Event ignoré: ${action}`)
  }

  return new Response('OK', { status: 200 })
})
