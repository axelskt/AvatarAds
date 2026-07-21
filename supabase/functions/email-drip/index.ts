import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Relances e-mail automatiques (Resend) ──
// Appelée toutes les heures par le cron GitHub Actions (.github/workflows/email-drip.yml).
// Idempotente : chaque envoi est journalisé dans email_log (unique user+kind), donc
// des appels répétés ne renvoient jamais deux fois le même e-mail.
//   · Non-payeurs (plan free) : +2h / +24h / +3j / +5j / +7j après l'inscription
//   · Abonnés à 0 crédit : 1 relance max par mois (sauf annulation en cours)
// Sans RESEND_API_KEY dans les secrets → no-op silencieux (déploiement dormant).

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET     = Deno.env.get('CRON_SECRET') ?? ''   // optionnel : verrouille le déclenchement
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

const GAL_VIDEOS = gallery([
  ['hero-strawberry', 'Personnage IA dans une vidéo verticale'],
  ['lipsync', 'Avatar IA en lipsync face caméra'],
  ['hero-center', 'Vidéo générée par AvatarAds'],
], 'À quoi ressemblent tes vidéos, dès la première ✨')

const GAL_IMAGES_IA = gallery([
  ['demo-cartoon', 'Personnage cartoon 3D généré par IA'],
  ['demo-paris', 'Personnages fruits à Paris générés par IA'],
  ['demo-basket', 'Scène de basket ultra-réaliste générée par IA'],
], 'Générées avec Images IA — un prompt, quelques secondes ✨')

const GAL_MONTAGE = gallery([
  ['feat-split', 'Vidéo en split screen'],
  ['express-veo', 'Vidéo Express générée en 30 secondes'],
  ['gen-fan-5', 'Vidéo verticale prête à poster'],
], 'Split screen, Express, montage auto — tout est inclus ✨')

const GAL_AVATARS = gallery([
  ['gen-fan-1', 'Avatar IA généré'],
  ['gen-fan-2', 'Autre avatar IA généré'],
  ['gen-fan-4', 'Avatar IA en situation'],
], 'Ton avatar, ta voix — sans jamais te filmer ✨')

const GAL_AVANT_APRES = gallery([
  ['ia-before', 'Image avant retouche IA'],
  ['ia-after', 'La même image après retouche IA'],
  ['tout-en-un', 'Tous les outils réunis dans AvatarAds'],
], 'Avant / après, et tout dans le même abonnement ✨')

const quoteBlock = (q: string, who: string, tag: string) => `
  <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:18px 20px;margin-top:22px">
    <div style="color:#f59e0b;font-size:13px;letter-spacing:2px;margin-bottom:8px">★★★★★</div>
    <div style="font-size:14px;color:#44403c;line-height:1.6;font-style:italic">« ${q} »</div>
    <div style="font-size:12.5px;color:#78716c;margin-top:10px"><b>${who}</b> — ${tag}</div>
  </div>`
// Visuels de RESULTATS (ceux de la landing page) : ce que l'outil produit,
// pas des captures d'interface.

const QUOTE_SARAH  = quoteBlock("Je n'aimais pas me filmer. Mon avatar parle à ma place avec ma propre voix. Mes abonnés ne font pas la différence.", "Sarah K.", "Coach business · 2 vidéos/jour automatisées")
const QUOTE_INES   = quoteBlock("De 2k à 60k vues de moyenne en un mois. La régularité a tout changé — je poste 3× par jour sans y penser.", "Inès B.", "Nutrition & fitness · ×30 sur les vues")
const QUOTE_HUGO   = quoteBlock("Premier mois : 3 vidéos virales, 12k nouveaux abonnés et mes premières ventes en automatique. Je ne reviendrai jamais en arrière.", "Hugo L.", "Finance perso · +12k abonnés / mois")
const QUOTE_LUCAS  = quoteBlock("3 vidéos TikTok en une heure. L'une d'elles fait déjà 80k vues. 40 leads en DM le lendemain. Clairement l'outil le plus ROI que j'utilise.", 'Lucas M. · E-commerce', '+80k vues · 40 leads')
const QUOTE_THOMAS = quoteBlock("Mon agence me facturait 1500€/mois pour du montage. J'ai tout internalisé avec AvatarAds pour le prix d'un café par jour.", 'Thomas D. · Agence SMMA', '−1500€/mois économisés')

type Stage = { kind: string; subject: string; title: string; body: (name: string) => string; cta: string; ctaUrl: string; minH: number; maxH: number; extra?: string }
const hi = (n: string) => n ? `${n}, ` : ''
const DRIP: Stage[] = [
  { kind: 'drip_2h', minH: 2, maxH: 24,
    subject: 'Ta première vidéo t’attend 🎬',
    title: 'Ta première vidéo est en ligne ce soir',
    body: n => `${hi(n)}ton compte est prêt. Tu décris ton produit, l’IA tourne la vidéo à ta place — voix, sous-titres, montage. Concrètement : tu peux publier ce soir au lieu de bloquer un après-midi de tournage, et commencer à récolter des vues pendant que tes concurrents cherchent encore un angle.`,
    cta: 'Créer ma première vidéo →', ctaUrl: APP_URL, extra: QUOTE_SARAH + GAL_VIDEOS },
  { kind: 'drip_24h', minH: 24, maxH: 72,
    subject: 'Les pubs IA qui tournent en ce moment 👀',
    title: 'Ils publient 10 fois pendant que tu publies une fois',
    body: n => `${hi(n)}l’algorithme récompense le volume : plus tu postes, plus tu multiplies tes chances de toucher la bonne audience. AvatarAds se connecte à Claude — tu lui demandes tes vidéos, il les génère en série pendant que tu fais autre chose. Résultat : tu occupes le terrain tous les jours, et ce sont tes vidéos qui remontent, pas celles des autres.`,
    cta: 'Voir ce que je peux créer →', ctaUrl: APP_URL, extra: QUOTE_LUCAS + GAL_IMAGES_IA },
  { kind: 'drip_3d', minH: 72, maxH: 120,
    subject: '🌞 +25 crédits offerts sur ton 1er mois',
    title: 'Des visuels 4K qu’on ne prend pas pour de l’IA',
    body: n => `${hi(n)}tes crédits bonus t’attendent : +25 sur Starter, +50 sur Pro, +75 sur Élite. De quoi tester ce qui fait la différence — nos images sortent en 4K avec un rendu de peau qui tient le plein écran, là où la plupart des générateurs trahissent l’IA au premier zoom. Une créa qui ne fait pas « faite par une machine », c’est une créa qu’on regarde jusqu’au bout.`,
    cta: 'Choisir mon plan →', ctaUrl: PRICING_URL, extra: QUOTE_INES + GAL_MONTAGE },
  { kind: 'drip_5d', minH: 120, maxH: 168,
    subject: '1 € par jour pour ne plus jamais tourner de vidéo',
    title: '1 € par jour, contre 1500 € d’agence',
    body: n => `${hi(n)}29,99 €/mois pour des vidéos, des images et l’export sans watermark. Le montage qu’une agence te facture 1500 € par mois, tu le fais toi-même en quelques minutes — et tout ce que tu ne dépenses plus en production part directement dans ta marge ou dans ta pub.`,
    cta: 'Démarrer avec Starter →', ctaUrl: PRICING_URL, extra: QUOTE_THOMAS + GAL_AVATARS },
  { kind: 'drip_7d', minH: 168, maxH: 336,
    subject: 'On garde ta place ? 💛',
    title: 'Ce que tu laisses passer',
    body: n => `${hi(n)}ton compte reste ouvert, mais les crédits bonus du premier mois ne dureront pas. Chaque semaine sans publier, c’est une audience qui va chez quelqu’un d’autre — et elle ne revient pas toute seule. Si AvatarAds n’est pas pour toi, aucun souci : cet e-mail est le dernier de la série.`,
    cta: 'Retourner sur AvatarAds →', ctaUrl: APP_URL, extra: QUOTE_HUGO + GAL_AVANT_APRES },
]

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
  if (CRON_SECRET && req.headers.get('x-cron-key') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!RESEND_API_KEY) return new Response(JSON.stringify({ ok: true, skipped: 'RESEND_API_KEY manquant' }), { status: 200 })

  // Mode APERCU : { test_to: "adresse" } envoie les 5 mails du drip a cette seule
  // adresse, sans lire la base ni journaliser — sert a verifier le rendu reel dans
  // une boite mail (images, largeurs, mode sombre) avant de les envoyer a de vrais
  // inscrits. Protege par la meme cle cron que le reste.
  let testTo = ''
  try { testTo = String((await req.clone().json())?.test_to || '') } catch (_) { /* pas de corps JSON */ }
  if (testTo) {
    const results: Record<string, boolean> = {}
    for (const st of DRIP) {
      results[st.kind] = await sendEmail(testTo, '[TEST] ' + st.subject,
        tpl({ title: st.title, body: st.body('Axel'), cta: st.cta, ctaUrl: st.ctaUrl, unsubUrl: APP_URL, extra: st.extra }))
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

  // ── 1) Drip non-payeurs (free) ──
  for (const st of DRIP) {
    if (sent >= MAX_SENDS) break
    const from = new Date(now - st.maxH * 3600_000).toISOString()
    const to   = new Date(now - st.minH * 3600_000).toISOString()
    const { data: users } = await sb.from('profiles')
      .select('id, email, first_name')
      .eq('plan', 'free').eq('email_optout', false)
      .gte('created_at', from).lte('created_at', to)
      .limit(MAX_SENDS)
    for (const u of users ?? []) {
      if (sent >= MAX_SENDS) break
      if (!u.email || !(await claim(u.id, u.email, st.kind))) continue
      const unsubUrl = `${UNSUB_BASE}?u=${u.id}&k=${await unsubKey(u.id)}`
      const ok = await sendEmail(u.email, st.subject, tpl({
        title: st.title, body: st.body(u.first_name || ''), cta: st.cta, ctaUrl: st.ctaUrl, unsubUrl, extra: st.extra,
      }))
      if (ok) { sent++; report[st.kind] = (report[st.kind] || 0) + 1 }
      await new Promise(r => setTimeout(r, 600))
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
        body: `${hi(u.first_name || '')}tes crédits du mois sont épuisés — bien joué, ça veut dire que tu produis 💪 Recharge avec un pack (Flash +40, Pack S +90, Pack L +250, dès 9,99 €) ou passe au plan supérieur pour un budget mensuel plus large.`,
        cta: 'Recharger mes crédits →', ctaUrl: APP_URL, unsubUrl,
      }))
      if (ok) { sent++; report[zeroKind] = (report[zeroKind] || 0) + 1 }
      await new Promise(r => setTimeout(r, 600))
    }
  }

  console.log(`📬 email-drip: ${sent} envoi(s)`, JSON.stringify(report))
  return new Response(JSON.stringify({ ok: true, sent, report }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
