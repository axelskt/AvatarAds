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

const GAL_CLAUDE = gallery([
  ['feat-claude', 'AvatarAds connecté à Claude'],
  ['step-05', 'Une vidéo diffusée sur tous les réseaux'],
  ['gen-fan-1', 'Vidéo générée, prête à poster'],
], 'Tu demandes, Claude génère, tu publies ✨')

const GAL_MONTAGE = gallery([
  ['feat-split', 'Vidéo en split screen'],
  ['feat-soustitres', 'Sous-titres animés sur la vidéo montée'],
  ['feat-editeur', 'Montage récupérable dans l\'Éditeur'],
], 'Ton rush entre brut, il ressort monté ✨')

const GAL_IMAGES = gallery([
  ['demo-basket', 'Scène de sport ultra-réaliste générée en 4K'],
  ['hero-bacteria', 'Personnage 3D généré par IA'],
  ['demo-paris', 'Scène de rue générée par IA'],
], 'Images 4K — un prompt, quelques secondes ✨')

const GAL_LIPSYNC = gallery([
  ['lipsync', 'Avatar IA en lipsync, indétectable'],
  ['gen-fan-5', 'Avatar IA indiscernable d\'une vraie personne'],
  ['hero-center', 'Rendu réaliste en plein écran'],
], 'Ton visage, ta voix — sans jamais te filmer ✨')

const GAL_EXPRESS = gallery([
  ['gen-veo', 'Scène générée avec Veo 3.1'],
  ['express-veo', 'Vidéo Express prête en 30 secondes'],
  ['hero-strawberry', 'Personnage IA dans une vidéo verticale'],
], 'Express × Veo 3.1 — une idée, une vidéo ✨')

const quoteBlock = (q: string, who: string, tag: string) => `
  <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:18px 20px;margin-top:22px">
    <div style="color:#f59e0b;font-size:13px;letter-spacing:2px;margin-bottom:8px">★★★★★</div>
    <div style="font-size:14px;color:#44403c;line-height:1.6;font-style:italic">« ${q} »</div>
    <div style="font-size:12.5px;color:#78716c;margin-top:10px"><b>${who}</b> — ${tag}</div>
  </div>`
// Visuels de RESULTATS (ceux de la landing page) : ce que l'outil produit,
// pas des captures d'interface.

const Q_CLAUDE  = quoteBlock("J'ai lancé une boutique et une chaîne faceless en parallèle. 5 vidéos avatar le matin, je publie, je passe à autre chose.", "Karim Z.", "Dropshipping · 5 vidéos/jour")
const Q_MONTAGE = quoteBlock("Tout est inclus, je me connecte et je génère. Avant je payais 4 abonnements séparés, là c'est tout en un. Game changer.", "Mehdi R.", "Créateur de contenu · Stack IA complète")
const Q_IMAGES  = quoteBlock("De 2k à 60k vues de moyenne en un mois. La régularité a tout changé — je poste 3× par jour sans y penser.", "Inès B.", "Nutrition & fitness · ×30 sur les vues")
const Q_LIPSYNC = quoteBlock("Les sous-titres et le lipsync sont bluffants. On dirait vraiment un vrai créateur qui parle. Personne ne capte que c'est IA.", "Yasmine A.", "Beauté & lifestyle · Lipsync indétectable")
const Q_EXPRESS = quoteBlock("3 vidéos TikTok en une heure. L'une d'elles fait déjà 80k vues. 40 leads en DM le lendemain.", "Lucas M.", "E-commerce · +80k vues · 40 leads")

type Stage = { kind: string; subject: string; title: string; body: (name: string) => string; cta: string; ctaUrl: string; minH: number; maxH: number; extra?: string }
const hi = (n: string) => n ? `${n}, ` : ''
const DRIP: Stage[] = [
  { kind: 'drip_2h', minH: 2, maxH: 24,
    subject: 'Demande tes vidéos à Claude, il les fait 🤖',
    title: 'Ils publient 10 fois pendant que tu publies une fois',
    body: n => `${hi(n)}AvatarAds se branche directement sur Claude : tu lui demandes tes vidéos en langage normal, il les génère en série pendant que tu fais autre chose. L'algorithme récompense le volume — plus tu postes, plus tu multiplies tes chances de tomber sur la bonne audience. Résultat : tu occupes le terrain tous les jours, et ce sont tes vidéos qui remontent.`,
    cta: 'Connecter Claude →', ctaUrl: APP_URL, extra: Q_CLAUDE + GAL_CLAUDE },

  { kind: 'drip_24h', minH: 24, maxH: 72,
    subject: 'Ton rush entre brut, il ressort monté 🎬',
    title: 'Le montage, c\'est ce qui te prend le plus de temps',
    body: n => `${hi(n)}tu enregistres, tu déposes, et le Montage IA fait le reste : il écoute ce que tu dis, place les zooms sur les mots forts, ajoute les sous-titres, les bruitages et les visuels au bon moment. Ce qui te prenait une soirée sur un logiciel te prend le temps d'un café — et tu récupères tout dans l'Éditeur si tu veux ajuster.`,
    cta: 'Monter ma vidéo →', ctaUrl: APP_URL, extra: Q_MONTAGE + GAL_MONTAGE },

  { kind: 'drip_3d', minH: 72, maxH: 120,
    subject: 'Des visuels 4K qu\'on ne prend pas pour de l\'IA 🎨',
    title: 'La qualité qui fait qu\'on regarde jusqu\'au bout',
    body: n => `${hi(n)}Images IA sort en 4K, avec un rendu de peau qui tient le plein écran — là où la plupart des générateurs trahissent l'IA au premier zoom. C'est ce détail qui fait la différence entre une créa qu'on scrolle et une créa qu'on regarde : personne ne s'arrête sur une image qui sent la machine.`,
    cta: 'Générer mes visuels →', ctaUrl: APP_URL, extra: Q_IMAGES + GAL_IMAGES },

  { kind: 'drip_5d', minH: 120, maxH: 168,
    subject: 'Ta voix, ton visage — sans jamais te filmer 🎙️',
    title: 'Personne ne voit que c\'est une IA',
    body: n => `${hi(n)}30 secondes d'enregistrement suffisent à cloner ta voix. Ton avatar parle ensuite avec TON timbre, et le lipsync est calé au mot près — tes abonnés ne font pas la différence. Plus besoin de te maquiller, de trouver la lumière ou de refaire dix prises : tu écris, il parle.`,
    cta: 'Cloner ma voix →', ctaUrl: APP_URL, extra: Q_LIPSYNC + GAL_LIPSYNC },

  { kind: 'drip_7d', minH: 168, maxH: 336,
    subject: 'Une idée le matin, la vidéo à midi ⚡',
    title: 'Express : de l\'idée à la vidéo, en une phrase',
    body: n => `${hi(n)}tu écris ce que tu veux montrer, Express le fabrique avec Veo 3.1 — décor, mouvement, ambiance, tout est généré. Pas de tournage, pas de banque d'images, pas de montage. Pour moins qu'un café par jour, tu as de quoi alimenter tes réseaux toute la semaine. Si AvatarAds n'est pas pour toi, aucun souci : cet e-mail est le dernier de la série.`,
    cta: 'Essayer Express →', ctaUrl: APP_URL, extra: Q_EXPRESS + GAL_EXPRESS },
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
  if (req.headers.get('x-cron-key') !== CRON_SECRET) {
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
    // Garde-fou : on a déjà envoyé cinq mails dont les images n'étaient pas encore
    // en ligne (recadrées mais jamais poussées). On vérifie donc CHAQUE URL avant
    // d'écrire à qui que ce soit, et on refuse l'envoi s'il en manque une.
    const html = DRIP.map((st) => String(st.extra || '')).join('')
    const urls = [...new Set([...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]))]
    const broken: string[] = []
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'HEAD' })
        if (!r.ok) broken.push(`${u} → ${r.status}`)
      } catch (_) { broken.push(`${u} → injoignable`) }
    }
    if (broken.length) {
      return new Response(JSON.stringify({ ok: false, error: 'images cassées, rien envoyé', broken }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

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
        body: `${hi(u.first_name || '')}tes crédits du mois sont épuisés — bien joué, ça veut dire que tu produis 💪 Recharge en un clic avec un pack de crédits, ou passe au plan supérieur pour ne plus jamais compter.`,
        cta: 'Recharger mes crédits →', ctaUrl: APP_URL, unsubUrl,
      }))
      if (ok) { sent++; report[zeroKind] = (report[zeroKind] || 0) + 1 }
      await new Promise(r => setTimeout(r, 600))
    }
  }

  console.log(`📬 email-drip: ${sent} envoi(s)`, JSON.stringify(report))
  return new Response(JSON.stringify({ ok: true, sent, report }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
