import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { rateHit, realIp, timingSafeEqual } from '../_shared/guard.ts'

// ── Après un paiement sur paiement.html (Axel 23/10, test réel sur iPhone) ──
// Sans session AvatarAds dans le navigateur, Whop proposait de « réclamer » l'achat avec un code Whop puis renvoyait sur la
// page d'accueil. Désormais la page joint à son paiement un identifiant aléatoire (metadata aa_nonce, gardé dans l'onglet)
// et interroge cette fonction :
//   POST { action:'etat', nonce }       → { paid:false } tant que l'activation n'est pas arrivée (whop-webhook),
//                                          puis { paid:true, compte:'connecte'|'nouveau'|'existant'|'attente', email,
//                                          mdp, google, recu } — mdp : le compte a un mot de passe ; google : il se connecte
//                                          par Google ; recu : n° de commande, moyen de paiement, 4 derniers chiffres,
//                                          montant ENCAISSÉ, remise, taxes et devise (événements payment.succeeded, arrivent
//                                          quelques secondes après)
//   POST { action:'code', nonce }       → compte NEUF seulement (créé il y a < 24 h, jamais connecté, sans mot de passe) :
//                                          code à 6 chiffres envoyé à l'adresse de l'achat
//   POST { action:'connexion', nonce, code } → code juste : jeton de connexion à usage unique (lien magique, un seul par
//                                          paiement)
//   POST { action:'mot_de_passe', password } + Bearer de la session obtenue ainsi → 1er mot de passe du compte (même
//                                          autorisation serveur que auth-otp : password_change_grants + guard_password_change)
//   POST { action:'plan' } + Bearer     → plan du compte connecté (page de paiement : même palier, palier inférieur, pack
//                                          d'un compte Free)
//   POST { action:'adresse', email }    → achat d'un abonnement SANS session (Axel 24/10) : { abonne } — l'adresse a déjà un
//                                          abonnement en cours → la page refuse l'achat et propose de se connecter
// Un compte déjà utilisé (connexion passée ou mot de passe posé) n'est JAMAIS ouvert par ce chemin : connexion habituelle.
//
// Audit 23/10 (constats 3, 10, 12, 15) : Whop ne vérifie pas l'adresse saisie par un acheteur sans compte. Payer avec
// l'adresse d'un autre suffisait à recevoir une session sur son compte (créé par le webhook), puis à y poser un mot de
// passe. Le jeton n'est plus remis qu'après un code envoyé À CETTE ADRESSE (même mécanique que la connexion par code
// d'auth-otp : code haché HMAC, 10 min, 5 essais, usage unique, délai entre deux envois, plafonds rate_events). Le verrou
// de connexion porte la preuve (preuve:'code') : sans lui, pas de 1er mot de passe. Codes dans paiement_codes (migration
// 20261024030000), liés au compte ET à l'identifiant du paiement : ils ne valent ni pour une connexion ordinaire ni pour
// un autre paiement.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = 'AvatarAds <bonjour@avatarads.fr>'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FENETRE_MS = 3 * 3600_000       // paiement cherché sur les 3 dernières heures
const NEUF_MS = 24 * 3600_000         // compte « neuf » : créé il y a moins de 24 h
const PWD_MIN = 8, PWD_MAX_BYTES = 72, GRANT_TTL_S = 120   // = auth-otp
const CODE_TTL_MIN = 10, COOLDOWN_S = 30, MAX_ATTEMPTS = 5   // = auth-otp (connexion par code)
const CODE_MAX_USER_H = 5, CODE_MAX_IP_H = 30                // envois par compte / par IP et par heure (= changement de mot de passe)
const VERIF_WIN_S = 600, VERIF_MAX_USER = 12, VERIF_MAX_IP = 40   // vérifications sur 10 min (= auth-otp)
const masque = (e: string) => { const [u, d] = e.split('@'); return (u || '').slice(0, 2) + '•••@' + (d || '') }
const verrou = (nonce: string) => 'paiement-compte:' + nonce.toLowerCase()

// HMAC (clé service) : code jamais stocké en clair ; empreinte des IP dans les clés de rate_events (audit 04/10, CC-4)
async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)))
  return Array.from(mac).map((x) => x.toString(16).padStart(2, '0')).join('')
}
const rk = async (v: string) => (await hmac('rl:' + v)).slice(0, 32)
// lié au compte ET au paiement : un code ne vaut ni pour une connexion par code ordinaire, ni pour un autre paiement
const codeHash = (userId: string, nonce: string, code: string) => hmac(`achat:${userId}:${nonce.toLowerCase()}:${code}`)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)
  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'json' }, 400) }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const action = String(b?.action ?? 'etat')
  if (action === 'mot_de_passe') return await motDePasse(req, b, sb)
  if (action === 'plan') return await planActuel(req, sb)
  if (action === 'adresse') return await adresseAbonnee(req, b, sb)
  if (action !== 'etat' && action !== 'code' && action !== 'connexion') return json({ ok: false, error: 'action' }, 400)

  const nonce = String(b?.nonce ?? '').trim()
  if (!NONCE_RE.test(nonce)) return json({ ok: false, error: 'nonce' }, 400)
  // la page interroge toutes les 3 s pendant le paiement : ~200 appels / 10 min au plus par onglet
  const ip = realIp(req)
  if (!(await rateHit('paiement-compte:' + (ip ? await rk('ip:' + ip) : 'inconnu'), 600, 400))) return json({ ok: false, error: 'rate' }, 429)

  const depuis = new Date(Date.now() - FENETRE_MS).toISOString()
  const { data: evs, error } = await sb.from('webhook_events').select('body')
    .eq('body->data->metadata->>aa_nonce', nonce).gte('received_at', depuis).order('received_at', { ascending: false }).limit(20)
  if (error) { console.error('paiement-compte journal :', error.message); return json({ ok: false, error: 'db' }, 500) }
  const act = (evs || []).find((e: any) => /membership[._](went[._]valid|activated)/.test(String(e?.body?.action ?? e?.body?.event ?? e?.body?.type ?? '').toLowerCase()))
  if (!act) return json({ ok: true, paid: false })

  const d = act.body?.data ?? {}
  const recu = recuDe(evs || [], String(d.id ?? ''))
  // acheteur déjà connecté sur la page (identifiant de compte joint au paiement) : il a sa session, rien à ouvrir
  const uid = String(d.metadata?.aa_user_id ?? '')
  if (/^[0-9a-f-]{36}$/i.test(uid)) {
    const { data: rows } = await sb.rpc('paiement_compte_etat', { p_user: uid })
    return json({ ok: true, paid: true, compte: 'connecte', recu, ...acces(Array.isArray(rows) ? rows[0] : null) })
  }
  const email = String(d.user?.email ?? d.member?.user?.email ?? d.customer?.email ?? d.email ?? '').toLowerCase().trim()
  if (!email) return json({ ok: true, paid: true, compte: 'attente', recu })
  const { data: rows, error: e2 } = await sb.rpc('paiement_compte_etat', { p_email: email })
  if (e2) { console.error('paiement-compte état :', e2.message); return json({ ok: false, error: 'db' }, 500) }
  const u: any = Array.isArray(rows) ? rows[0] : null
  if (!u) return json({ ok: true, paid: true, compte: 'attente', email: masque(email), recu })   // le webhook crée le compte
  const neuf = !u.a_mot_de_passe && !u.last_sign_in_at && Date.now() - Date.parse(u.created_at) < NEUF_MS
  if (!neuf) return json({ ok: true, paid: true, compte: 'existant', email: masque(email), recu, ...acces(u) })
  if (action === 'etat') return json({ ok: true, paid: true, compte: 'nouveau', email: masque(email), recu, ...acces(u) })
  if (action === 'code') return await envoyerCode(req, sb, u, email, nonce, b.lang === 'en' ? 'en' : 'fr')   // 26/10 : page anglaise

  // connexion : l'adresse est prouvée par le code reçu, sinon rien
  const v = await verifierCode(req, sb, u, nonce, String(b?.code ?? '').trim())
  if (!v.ok) return v.res
  const rendreCode = async () => { try { await sb.from('paiement_codes').update({ used_at: null }).eq('id', v.id) } catch { /* best-effort */ } }
  // une seule connexion par paiement : verrou = ligne du journal (index unique sur event_id, comme les verrous du webhook) ;
  // il porte la preuve (code reçu à l'adresse) exigée par le 1er mot de passe
  const { error: lkErr } = await sb.from('webhook_events').insert({ event_id: verrou(nonce), body: { action: 'audit.paiement_compte', data: { user: u.id, preuve: 'code' } } })
  if (lkErr) return json({ ok: true, paid: true, compte: 'existant', email: masque(email) })
  const { data: link, error: le } = await sb.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = (link as any)?.properties?.hashed_token
  if (le || !tokenHash) {
    try { await sb.from('webhook_events').delete().eq('event_id', verrou(nonce)) } catch { /* best-effort */ }
    await rendreCode()
    console.error('paiement-compte lien :', le?.message || 'sans jeton')
    return json({ ok: false, error: 'link' }, 500)
  }
  console.log(`Connexion après achat (adresse prouvée par code) pour ${masque(email)}`)
  return json({ ok: true, paid: true, compte: 'nouveau', email, token_hash: tokenHash, recu, ...acces(u) })
})

// mot de passe posé ? connexion Google ? (« Ouvrir mon espace » ne propose un mot de passe qu'à un compte qui n'a ni l'un ni l'autre)
const acces = (u: any) => u ? { mdp: !!u.a_mot_de_passe, google: Array.isArray(u.fournisseurs) && u.fournisseurs.includes('google') } : {}

// Reçu de la page « Paiement confirmé » : n° de commande Whop (paiement, sinon abonnement), moyen de paiement, 4 derniers
// chiffres, montant encaissé (somme des paiements distincts de ce passage en caisse) et date. Audit 23/10 (constats 32, 48) :
// remise et taxes lues sur les paiements réels (sous-total, taxe, total) au lieu d'être déduites d'un seul écart, et devise
// encaissée (Whop peut facturer dans la devise de l'acheteur)
function recuDe(evs: any[], membre: string) {
  const vus = new Set<string>()
  let total = 0, remise: number | null = 0, taxes = 0, incluses = false, p: any = null
  for (const e of evs) {
    if (!/payment[._]succeeded/.test(String(e?.body?.action ?? e?.body?.event ?? e?.body?.type ?? '').toLowerCase())) continue
    const d = e.body?.data ?? {}, id = String(d.id ?? '')
    if (!id || vus.has(id)) continue
    vus.add(id)
    const tot = Number(d.total) || 0, sous = Number(d.subtotal), taxe = Number(d.tax_amount) || 0
    const incl = String(d.tax_behavior ?? '').toLowerCase() === 'inclusive'
    total += tot; taxes += taxe; incluses = incluses || (incl && taxe > 0)
    // remise = sous-total (+ taxe ajoutée) − encaissé ; sous-total absent → remise inconnue
    if (remise !== null) remise = d.subtotal == null || !Number.isFinite(sous) ? null : remise + Math.max(0, sous + (incl ? 0 : taxe) - tot)
    if (!p) p = d
  }
  if (!p) return { commande: membre.slice(0, 40) || null }
  const type = [p.payment_method_type, p.payment_method?.payment_method_type, p.payment_instrument?.payment_method_type,
    p.payment_instrument?.display_name].map((x) => String(x ?? '').toLowerCase()).join(' ')
  const last4 = String(p.card_last4 ?? p.payment_method?.card?.last4 ?? p.payment_instrument?.card?.last4 ?? '').replace(/\D/g, '').slice(-4)
  const devise = String(p.currency ?? '').toLowerCase()
  const c = (n: number) => Math.round(n * 100) / 100
  return {
    commande: String(p.id).slice(0, 40),
    methode: /apple/.test(type) ? 'Apple Pay' : /google/.test(type) ? 'Google Pay' : 'Carte bancaire',
    last4: last4 || null,
    total: c(total),
    remise: remise === null ? null : c(remise),
    taxes: c(taxes),
    taxes_incluses: incluses,
    devise: /^[a-z]{3}$/.test(devise) ? devise : 'eur',
    date: p.paid_at ?? p.created_at ?? null,
  }
}

// ── Code « ouvrir mon espace » (audit 23/10) : envoi à l'adresse de l'achat, puis vérification par l'action connexion ──
async function envoyerCode(req: Request, sb: any, u: any, email: string, nonce: string, lang: 'fr' | 'en' = 'fr'): Promise<Response> {
  if (!RESEND_API_KEY) return json({ ok: false, error: 'email_unavailable' }, 503)
  // délai entre deux envois, par compte (dérivé du dernier code, comme auth-otp)
  const heure = new Date(Date.now() - 3600_000).toISOString()
  const { data: recent } = await sb.from('paiement_codes').select('created_at')
    .eq('user_id', u.id).gte('created_at', heure).order('created_at', { ascending: false }).limit(1)
  if (recent && recent.length) {
    const wait = Math.ceil((Date.parse(recent[0].created_at) + COOLDOWN_S * 1000 - Date.now()) / 1000)
    if (wait > 0) return json({ ok: false, error: 'cooldown', wait }, 429)
  }
  // plafonds horaires sur rate_events (non réinitialisables en supprimant des codes) : l'IP d'abord, puis le compte
  const ip = realIp(req)
  if (ip && !(await rateHit(`paiement-code:send:ip:${await rk('ip:' + ip)}`, 3600, CODE_MAX_IP_H))) return json({ ok: false, error: 'too_many_codes' }, 429)
  if (!(await rateHit(`paiement-code:send:user:${u.id}`, 3600, CODE_MAX_USER_H))) return json({ ok: false, error: 'too_many_codes' }, 429)

  // un seul code vivant par compte et par paiement : les précédents (non utilisés) sont supprimés
  await sb.from('paiement_codes').delete().eq('user_id', u.id).eq('nonce', nonce.toLowerCase()).is('used_at', null)
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
  const { data: ins, error: insErr } = await sb.from('paiement_codes').insert({
    user_id: u.id, nonce: nonce.toLowerCase(), code_hash: await codeHash(u.id, nonce, code),
    expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  }).select('id').single()
  if (insErr || !ins) { console.error('paiement-compte code :', insErr?.message || 'sans ligne'); return json({ ok: false, error: 'server_error' }, 500) }
  const sent = lang === 'en'
    ? await sendMail(email, `${code} — your code to open your AvatarAds space`, codeEmail(code, 'en'))
    : await sendMail(email, `${code} — ton code pour ouvrir ton espace AvatarAds`, codeEmail(code))
  if (lang === 'en') { try { await sb.from('profiles').update({ lang: 'en' }).eq('id', u.id) } catch { /* best-effort */ } }   // e-mails suivants en anglais
  if (!sent) {
    await sb.from('paiement_codes').delete().eq('id', ins.id)
    return json({ ok: false, error: 'send_failed' }, 502)
  }
  try { await sb.from('paiement_codes').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString()) } catch { /* ménage best-effort */ }
  console.log(`Code d'ouverture après achat envoyé à ${masque(email)}`)
  return json({ ok: true, paid: true, compte: 'nouveau', email: masque(email), envoye: true })
}

// dernier code vivant de CE compte pour CE paiement, essai consommé atomiquement AVANT la comparaison, puis usage unique
// (réservé conditionnellement : un seul gagnant sous concurrence)
async function verifierCode(req: Request, sb: any, u: any, nonce: string, code: string): Promise<{ ok: true; id: string } | { ok: false; res: Response }> {
  if (!/^\d{6}$/.test(code)) return { ok: false, res: json({ ok: false, error: 'wrong_code' }, 400) }
  const ip = realIp(req)
  if (ip && !(await rateHit(`paiement-code:verify:ip:${await rk('ip:' + ip)}`, VERIF_WIN_S, VERIF_MAX_IP))) return { ok: false, res: json({ ok: false, error: 'too_many_attempts' }, 429) }
  if (!(await rateHit(`paiement-code:verify:user:${u.id}`, VERIF_WIN_S, VERIF_MAX_USER))) return { ok: false, res: json({ ok: false, error: 'too_many_attempts' }, 429) }

  const nowIso = new Date().toISOString()
  const { data: row, error: rowErr } = await sb.from('paiement_codes').select('id, code_hash')
    .eq('user_id', u.id).eq('nonce', nonce.toLowerCase()).is('used_at', null).gt('expires_at', nowIso)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (rowErr) return { ok: false, res: json({ ok: false, error: 'server_error' }, 500) }
  if (!row) return { ok: false, res: json({ ok: false, error: 'expired' }, 400) }
  const { data: att, error: attErr } = await sb.rpc('paiement_code_take_attempt', { p_id: row.id, p_user: u.id, p_max: MAX_ATTEMPTS })
  if (attErr) return { ok: false, res: json({ ok: false, error: 'server_error' }, 500) }
  if (att === null || att === undefined) {
    await sb.from('paiement_codes').delete().eq('id', row.id)   // plafond atteint → le code est brûlé
    return { ok: false, res: json({ ok: false, error: 'too_many_attempts' }, 400) }
  }
  if (!timingSafeEqual(String(row.code_hash), await codeHash(u.id, nonce, code))) {
    const left = MAX_ATTEMPTS - Number(att)
    if (left <= 0) { await sb.from('paiement_codes').delete().eq('id', row.id); return { ok: false, res: json({ ok: false, error: 'too_many_attempts' }, 400) } }
    return { ok: false, res: json({ ok: false, error: 'wrong_code', remaining: left }, 400) }
  }
  const { data: used } = await sb.from('paiement_codes').update({ used_at: nowIso }).eq('id', row.id).is('used_at', null).select('id')
  if (!used || !used.length) return { ok: false, res: json({ ok: false, error: 'expired' }, 400) }
  return { ok: true, id: String(row.id) }
}

// Gabarit sobre des e-mails d'auth-otp (mailLayout), sans émoji
function codeEmail(code: string, lang: 'fr' | 'en' = 'fr'): string {
  // 26/10 : version anglaise (page /en/paiement-confirme.html)
  const T = lang === 'en'
    ? { titre: 'Open your AvatarAds space', intro: 'Thanks for your purchase. Enter this code on the “Payment confirmed” page to open your space:',
        fin: `This code expires in ${CODE_TTL_MIN} minutes and can only be used once.<br>If you didn't buy anything on AvatarAds, don't give this code to anyone: without it, nobody can open an account with your address. Write to us at <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a> if you have any doubt.` }
    : { titre: 'Ouvre ton espace AvatarAds', intro: 'Merci pour ton achat. Entre ce code sur la page « Paiement confirmé » pour ouvrir ton espace :',
        fin: `Ce code expire dans ${CODE_TTL_MIN} minutes et ne peut être utilisé qu'une fois.<br>Si tu n'as rien acheté sur AvatarAds, ne donne ce code à personne : sans lui, personne ne peut ouvrir de compte à ton adresse. Écris-nous à <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a> si tu as un doute.` }
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:22px">AvatarAds</div>
    <div style="background:#fff;border-radius:16px;padding:30px 28px;border:1px solid #e7e5e4">
      <div style="font-size:21px;font-weight:800;color:#111;line-height:1.3;margin-bottom:14px">${T.titre}</div>
      <div style="font-size:15px;color:#44403c;line-height:1.65">${T.intro}</div>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:20px 8px;margin-top:20px;text-align:center;white-space:nowrap;font-size:30px;font-weight:800;letter-spacing:8px;color:#111;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">${T.fin}</div>
    </div>
    <div style="font-size:11.5px;color:#a8a29e;text-align:center;margin-top:18px;line-height:1.6">AvatarAds · avatarads.fr</div>
  </div></body></html>`
}

// envoi Resend (mêmes 2 tentatives qu'auth-otp)
async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [to], subject, html }),
      })
      if (r.ok) return true
      if (r.status === 422) return false   // adresse invalide : inutile de retenter
    } catch (_e) { /* réseau : on retente */ }
    if (attempt === 0) await new Promise((res) => setTimeout(res, 800))
  }
  return false
}

// Plan du compte connecté (audit 23/10, constats 18 et 31) : la page de paiement ne vend plus le même palier, prévient
// avant un palier inférieur, et ne vend pas de pack à un compte Free. Lecture seule de SON profil.
async function planActuel(req: Request, sb: any): Promise<Response> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ ok: false, error: 'unauthorized' }, 401)
  const { data: ud } = await sb.auth.getUser(token)
  const user = ud?.user
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401)
  if (!(await rateHit('paiement-plan:' + user.id, 600, 60))) return json({ ok: false, error: 'rate' }, 429)
  const { data: p, error } = await sb.from('profiles').select('plan, whop_plan_id').eq('id', user.id).maybeSingle()
  if (error) { console.error('paiement-compte plan :', error.message); return json({ ok: false, error: 'db' }, 500) }
  return json({ ok: true, plan: String(p?.plan || 'free'), plan_whop: p?.whop_plan_id ?? null })
}

// Achat d'un abonnement SANS session (Axel 24/10 : « l'achat doit juste être refusé et dire qu'il a déjà un plan en cours ») :
// la page vérifie l'adresse AVANT d'afficher le module Whop, puis la verrouille dans le module. Abonnement en cours = plan
// payant non résilié. Même réponse pour « aucun compte » et « compte gratuit » (on ne dit pas si un compte existe) ;
// plafonds par IP et par adresse (empreintes HMAC, comme les autres plafonds). Le webhook garde sa mise de côté pour un
// achat fait ailleurs (page Whop de secours).
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,}$/
async function adresseAbonnee(req: Request, b: any, sb: any): Promise<Response> {
  const email = String(b?.email ?? '').toLowerCase().trim()
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ ok: false, error: 'email' }, 400)
  const ip = realIp(req)
  if (ip && !(await rateHit(`paiement-adresse:ip:${await rk('ip:' + ip)}`, 3600, 30))) return json({ ok: false, error: 'rate' }, 429)
  if (!(await rateHit(`paiement-adresse:e:${await rk('e:' + email)}`, 3600, 10))) return json({ ok: false, error: 'rate' }, 429)
  // adresse comparée sans la casse ; % _ \ échappés (ilike)
  const motif = email.replace(/[\\%_]/g, (c) => '\\' + c)
  const { data, error } = await sb.from('profiles').select('plan, whop_cancel_at_period_end').ilike('email', motif).limit(1)
  if (error) { console.error('paiement-compte adresse :', error.message); return json({ ok: false, error: 'db' }, 500) }
  const p: any = (data || [])[0]
  const abonne = !!p && String(p.plan || 'free').toLowerCase() !== 'free' && !p.whop_cancel_at_period_end
  return json({ ok: true, abonne })
}

// 1er mot de passe d'un compte ouvert par ce chemin (verrou de connexion AVEC preuve par code, compte neuf, aucun mot de passe)
async function motDePasse(req: Request, b: any, sb: any): Promise<Response> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: ud } = await sb.auth.getUser(token)
  const user = ud?.user
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401)
  if (!(await rateHit('paiement-mdp:' + user.id, 3600, 10))) return json({ ok: false, error: 'rate' }, 429)
  const password = String(b?.password ?? '')
  if (password.length < PWD_MIN) return json({ ok: false, error: 'weak_password' }, 400)
  if (new TextEncoder().encode(password).length > PWD_MAX_BYTES) return json({ ok: false, error: 'password_too_long' }, 400)

  const { data: rows } = await sb.rpc('paiement_compte_etat', { p_user: user.id })
  const u: any = Array.isArray(rows) ? rows[0] : null
  if (!u || u.a_mot_de_passe || Date.now() - Date.parse(u.created_at) > NEUF_MS) return json({ ok: false, error: 'refuse' }, 403)
  // verrou posé APRÈS le code reçu à l'adresse (audit 23/10) : un verrou sans preuve (ancienne version) ne suffit pas
  const depuis = new Date(Date.now() - FENETRE_MS).toISOString()
  const { data: lk } = await sb.from('webhook_events').select('event_id').like('event_id', 'paiement-compte:%')
    .eq('body->data->>user', user.id).eq('body->data->>preuve', 'code').gte('received_at', depuis).limit(1)
  if (!lk || !lk.length) return json({ ok: false, error: 'refuse' }, 403)

  // autorisation à usage unique lue par le trigger guard_password_change (sinon la base garde l'ancien mot de passe)
  const { error: gErr } = await sb.from('password_change_grants').upsert(
    { user_id: user.id, expires_at: new Date(Date.now() + GRANT_TTL_S * 1000).toISOString() }, { onConflict: 'user_id' })
  if (gErr) { console.error('paiement-compte autorisation :', gErr.message); return json({ ok: false, error: 'server_error' }, 500) }
  const { error: upErr } = await sb.auth.admin.updateUserById(user.id, { password })
  const { data: reste } = await sb.from('password_change_grants').delete().eq('user_id', user.id).select('user_id')
  if (upErr) {
    const e = upErr as { code?: string; message?: string; reasons?: string[] }
    if (/longer than|too long/i.test(e.message || '')) return json({ ok: false, error: 'password_too_long' }, 400)
    if (e.code === 'weak_password' || /weak|pwned|leaked|at least|characters/i.test(e.message || '')) {
      return json({ ok: false, error: 'weak_password', reasons: Array.isArray(e.reasons) ? e.reasons.slice(0, 3) : [] }, 400)
    }
    console.error('paiement-compte mot de passe :', e.code || '', e.message || '')
    return json({ ok: false, error: 'server_error' }, 500)
  }
  if (reste && reste.length) { console.error('paiement-compte : autorisation non consommée'); return json({ ok: false, error: 'server_error' }, 500) }
  return json({ ok: true, email: user.email })
}
