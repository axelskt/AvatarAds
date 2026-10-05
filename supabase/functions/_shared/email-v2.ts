// ── E-mails v2 (05/10/2026) : gabarit + calendrier des séquences ──
// Textes et visuels : email-v2-data.ts, GÉNÉRÉ par tools/emails/gen_ts.py (source : tools/emails/emails.py).
// Chaque e-mail = accroche (titre + 1re phrase) → contenu (visuel au marqueur, texte qui le décrit) → CTA.
// Utilisé par email-drip (séquences) et whop-webhook (bienvenue client, c0).

export type Para = string | { liste: string[] } | { visuel: true }
export type Mail = {
  id: string; quand: string; objet: string; preheader: string; titre: string; corps: Para[]
  image: string; alt: string; legende: string; cta: string; url: string
}

export const FROM = 'AvatarAds <bonjour@avatarads.fr>'
const IMG_BASE = 'https://avatarads.fr/assets/mail/v2'
const FONT = '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro', elite: 'Élite' }

export const imageUrl = (m: Mail) => `${IMG_BASE}/${m.image}`

// Le prénom est saisi par l'utilisateur : toujours échappé (audit 02/10, PAY-6)
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// Lien de désinscription signé (HMAC dérivé de la service key, vérifié par email-unsub)
export async function unsubUrl(supabaseUrl: string, serviceKey: string, userId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(serviceKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId)))
  const k = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
  return `${supabaseUrl}/functions/v1/email-unsub?u=${userId}&k=${k}`
}

export function subject(m: Mail, plan = ''): string {
  return m.objet.replace('{plan}', PLAN_LABEL[plan] ?? plan)
}

// Gabarit (tables + styles en ligne : Gmail / Apple Mail / Outlook), identique à l'aperçu validé
export function render(m: Mail, o: { prenom?: string; plan?: string; unsub: string }): string {
  const fill = (s: string) => s.replace('{plan}', PLAN_LABEL[o.plan ?? ''] ?? (o.plan ?? ''))
  const visuel = `<img src="${imageUrl(m)}" width="484" alt="${esc(m.alt)}" style="display:block;width:100%;max-width:484px;height:auto;border:0;border-radius:12px;margin:4px 0 8px">`
    + `<p style="margin:0 0 22px;font:12.5px/1.5 ${FONT};color:#8a8a93">${esc(m.legende)}</p>`
  const body = m.corps.map((p) => {
    if (typeof p === 'string') return `<p style="margin:0 0 16px">${fill(p)}</p>`
    if ('liste' in p) return `<ul style="margin:0 0 16px;padding-left:20px">${p.liste.map((x) => `<li style="margin:0 0 8px">${fill(x)}</li>`).join('')}</ul>`
    return visuel
  }).join('')
  const hello = o.prenom ? `Salut ${esc(o.prenom.trim())},` : 'Salut,'
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(fill(m.objet))}</title></head>
<body style="margin:0;padding:0;background:#f6f4f0">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f0"><tr><td align="center" style="padding:28px 14px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">
  <tr><td style="padding:0 6px 16px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td><img src="https://avatarads.fr/apple-touch-icon.png" width="28" height="28" alt="" style="display:block;border-radius:7px"></td>
      <td style="padding-left:9px;font:800 16px ${FONT};color:#15151a;letter-spacing:-.01em">AvatarAds</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid #e9e6e1;border-radius:18px;padding:30px 28px;font:15px/1.65 ${FONT};color:#3d3d46">
    <div style="font:800 22px/1.25 ${FONT};color:#15151a;letter-spacing:-.02em;margin:0 0 18px">${fill(m.titre)}</div>
    <p style="margin:0 0 16px">${hello}</p>
    ${body}
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ff6b35;border-radius:12px">
      <a href="${m.url}" style="display:inline-block;padding:13px 22px;font:700 15px ${FONT};color:#ffffff;text-decoration:none">${m.cta}</a>
    </td></tr></table>
    <p style="margin:26px 0 0;color:#3d3d46">À bientôt,<br><b style="color:#15151a">Axel</b><br><span style="color:#73737d;font-size:13px">Fondateur d’AvatarAds</span></p>
  </td></tr>
  <tr><td style="padding:16px 6px 0;text-align:center;font:12px/1.6 ${FONT};color:#9a9aa3">
    AvatarAds · avatarads.fr<br><a href="${o.unsub}" style="color:#9a9aa3">Ne plus recevoir ces e-mails</a>
  </td></tr>
 </table>
</td></tr></table>
</body></html>`
}

// Envoi Resend avec en-têtes de désinscription en un clic (Gmail / Apple Mail) et un tag « mail » (p0, w3…)
// pour retrouver l'e-mail dans Resend. Renvoie l'identifiant Resend (clé des statistiques), ou null en cas d'échec.
export async function sendResend(apiKey: string, to: string, subj: string, html: string, unsub: string, tag = ''): Promise<string | null> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [to], subject: subj, html,
      headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      ...(tag ? { tags: [{ name: 'mail', value: tag.replace(/[^A-Za-z0-9_-]/g, '_') }] } : {}),
    }),
  })
  if (!r.ok) { console.error(`❌ Resend ${r.status} pour ${to}:`, (await r.text().catch(() => '')).slice(0, 300)); return null }
  const j = await r.json().catch(() => ({}))
  return typeof j?.id === 'string' ? j.id : 'sans-id'
}

// ── Calendrier ──
const H = 3600_000, D = 24 * H

// Prospects (plan free, aucun achat), calés sur drip_anchor. Fenêtres [début, fin) : un compte qui n'est
// pas passé dans une fenêtre (cron en panne, déploiement en cours de série) la saute, il ne reçoit pas
// tout le retard d'un coup.
export const PROSPECT_STEPS: { id: string; from: number; to: number }[] = [
  { id: 'p0', from: 0, to: 2 * H },          // à l'inscription
  { id: 'p1', from: 2 * H, to: 24 * H },     // H+2 : Omni
  { id: 'p2', from: 1 * D, to: 3 * D },      // J+1 : Claude
  { id: 'p3', from: 3 * D, to: 5 * D },      // J+3 : Express
  { id: 'p4', from: 5 * D, to: 7 * D },      // J+5 : Montage IA
  { id: 'p5', from: 7 * D, to: 10 * D },     // J+7 : Motion Control
  { id: 'p6', from: 10 * D, to: 14 * D },    // J+10 : campagne
  { id: 'p7', from: 14 * D, to: 21 * D },    // J+14 : objection
]
// Suite : une idée toutes les 2 semaines à partir de J+28, en rotation l1 → l2 → l3, jusqu'à l'abonnement.
// En novembre, le créneau devient l'idée de saison (l4, Black Friday), une fois par an.
export const LONG_START = 28 * D, LONG_EVERY = 14 * D
export const LONG_ROTATION = ['l1', 'l2', 'l3']
export const isBlackFridaySeason = (d: Date) => d.getUTCMonth() === 10 && d.getUTCDate() <= 25

// Clients (starter / pro / elite), calés sur l'envoi de la bienvenue (email_log 'welcome', posé par whop-webhook) :
// c1 à J+2 s'il n'a rien créé, c2 après 7 jours sans création, l'idée de la semaine (w1 → w5, puis boucle)
// chaque semaine. Jamais plus d'un e-mail tous les deux jours, toutes séquences confondues.
export const CLIENT_GAP = 2 * D
export const ROTATION_IDS = ['w1', 'w2', 'w3', 'w4', 'w5']
