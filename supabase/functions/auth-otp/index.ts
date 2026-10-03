import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { rateHit, realIp, timingSafeEqual, tokenRole } from '../_shared/guard.ts'

// ── Auth par code e-mail (OTP à 6 chiffres) ──
// Remplace le mot de passe à l'inscription ET à la connexion.
//   POST { action:'send',   email, mode:'login'|'signup' }
//     → génère un code 6 chiffres (10 min, usage unique), l'envoie via Resend.
//   POST { action:'verify', email, code, firstName? }
//     → vérifie le code, crée le compte si besoin, retourne un token_hash
//       que le client échange contre une session via sb.auth.verifyOtp().
// Anti-abus : cooldown 30 s / e-mail, 6 codes/h par e-mail, 30/h par IP,
// 5 essais max par code, code haché (HMAC service key) — jamais stocké en clair.
//
// Audit 02/10 : changement d'adresse e-mail (contrat C1), SESSION EXIGÉE (Authorization: Bearer <JWT de session>) :
//   POST { action:'email_change_send',   new_email }        → code 6 chiffres envoyé à la NOUVELLE adresse (Resend)
//   POST { action:'email_change_verify', new_email, code }  → auth.admin.updateUserById(email, email_confirm) puis
//     e-mail d'information à l'ANCIENNE adresse. Remplace sb.auth.updateUser({ email }) (confirmation Supabase active,
//     aucun SMTP configuré dans Supabase → plus aucun lien n'arrivait). Codes dans email_change_codes (≠ otp_codes).

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM           = 'AvatarAds <bonjour@avatarads.fr>'

const CODE_TTL_MIN     = 10   // validité d'un code
const COOLDOWN_S       = 30   // délai mini entre deux envois pour un même e-mail
const MAX_PER_EMAIL_H  = 6    // codes par e-mail et par heure
const MAX_PER_IP_H     = 30   // codes par IP et par heure
const MAX_ATTEMPTS     = 5    // essais de vérification par code
// Audit 02/10 : changement d'adresse — même validité / cooldown / essais que la connexion (constantes ci-dessus).
const CHG_MAX_PER_USER_H = 5  // codes de changement par compte et par heure
const CHG_MAX_PER_DEST_H = 5  // codes de changement par adresse cible et par heure

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aa-op',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function hashCode(email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${email}:${code}`)))
  return Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('')
}

function otpEmail(code: string): string {
  // Pas d'espaces entre les chiffres (Gmail mobile casse la ligne dessus) —
  // l'aération vient du letter-spacing + nowrap pour garder le code sur une ligne.
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:22px">🎬 AvatarAds</div>
    <div style="background:#fff;border-radius:16px;padding:30px 28px;border:1px solid #e7e5e4">
      <div style="font-size:21px;font-weight:800;color:#111;line-height:1.3;margin-bottom:14px">Ton code de connexion</div>
      <div style="font-size:15px;color:#44403c;line-height:1.65">Entre ce code sur AvatarAds pour continuer :</div>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:20px 8px;margin-top:20px;text-align:center;white-space:nowrap;font-size:30px;font-weight:800;letter-spacing:8px;color:#111;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Ce code expire dans ${CODE_TTL_MIN} minutes et ne peut être utilisé qu'une fois.<br>Si tu n'es pas à l'origine de cette demande, ignore simplement cet e-mail.</div>
    </div>
    <div style="font-size:11.5px;color:#a8a29e;text-align:center;margin-top:18px;line-height:1.6">AvatarAds · avatarads.fr</div>
  </div></body></html>`
}

// Audit 02/10 : envoi Resend factorisé (mêmes 2 tentatives) pour servir aussi les e-mails du changement d'adresse.
async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  // 2 tentatives : absorbe les micro-pannes Resend sans bloquer la connexion
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [to], subject, html }),
      })
      if (r.ok) return true
      if (r.status === 422) return false // adresse invalide : inutile de retenter
    } catch (_e) { /* réseau : on retente */ }
    if (attempt === 0) await new Promise(res => setTimeout(res, 800))
  }
  return false
}

async function sendCodeEmail(email: string, code: string): Promise<boolean> {
  return await sendMail(email, `${code} — ton code AvatarAds`, otpEmail(code))
}

// ── Audit 02/10 : CHANGEMENT D'ADRESSE E-MAIL (contrat C1) ──
// Gabarit sobre d'otpEmail, sans émoji ; toute valeur venant du client est échappée.
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, c => ESC[c] ?? c)

function mailLayout(title: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:22px">AvatarAds</div>
    <div style="background:#fff;border-radius:16px;padding:30px 28px;border:1px solid #e7e5e4">
      <div style="font-size:21px;font-weight:800;color:#111;line-height:1.3;margin-bottom:14px">${title}</div>
      ${inner}
    </div>
    <div style="font-size:11.5px;color:#a8a29e;text-align:center;margin-top:18px;line-height:1.6">AvatarAds · avatarads.fr</div>
  </div></body></html>`
}

function emailChangeCodeEmail(code: string): string {
  return mailLayout('Confirme ta nouvelle adresse', `<div style="font-size:15px;color:#44403c;line-height:1.65">Entre ce code dans Mon compte sur AvatarAds pour en faire ton adresse de connexion :</div>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:20px 8px;margin-top:20px;text-align:center;white-space:nowrap;font-size:30px;font-weight:800;letter-spacing:8px;color:#111;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Ce code expire dans ${CODE_TTL_MIN} minutes et ne peut être utilisé qu'une fois.<br>Si tu n'es pas à l'origine de cette demande, ignore simplement cet e-mail : rien ne change sur ton compte.</div>`)
}

function emailChangedNotice(newEmailMasked: string): string {
  return mailLayout('Ton adresse de connexion a été changée', `<div style="font-size:15px;color:#44403c;line-height:1.65">L'adresse e-mail de connexion de ton compte AvatarAds vient d'être remplacée par <b>${esc(newEmailMasked)}</b>. Cette adresse-ci ne permet plus de te connecter.</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Si ce n'est pas toi, contacte-nous tout de suite à <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a>.</div>`)
}

// « jean.dupont@gmail.com » → « j***t@gmail.com » : l'ancienne adresse reconnaît le changement sans recevoir l'adresse entière.
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at), domain = email.slice(at + 1)
  return (local.length <= 2 ? local.slice(0, 1) + '***' : local[0] + '***' + local[local.length - 1]) + '@' + domain
}

// Même format que la connexion, sans les caractères qui n'ont rien à faire dans une adresse réelle (HTML, séparateurs).
const isChangeEmail = (e: string) =>
  e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && !/[<>"\\,;()[\]\x00-\x1f]/.test(e)

// Session Supabase RÉELLE exigée. auth-otp tourne en verify_jwt = false : la passerelle ne vérifie RIEN, donc pas de
// raccourci service_role ici (contrairement à authUser). Échec FERMÉ : jeton absent, clé anon / publiable (pas
// d'utilisateur), service_role, jeton expiré ou session révoquée → null → 401. Le claim role n'est qu'un pré-filtre
// (lu sans vérifier la signature) ; la vérification réelle est auth.getUser (GoTrue : signature, expiration, session).
async function sessionUser(sb: SupabaseClient, req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token || tokenRole(token) !== 'authenticated') return null
  try {
    const { data, error } = await sb.auth.getUser(token)
    const u = data?.user
    if (error || !u?.id || u.is_anonymous) return null
    return { id: u.id, email: String(u.email || '').trim().toLowerCase() }
  } catch { return null }
}

// true = adresse portée par un AUTRE compte (auth.users ou profiles, casse ignorée) ; null = vérification impossible
// → l'appelant refuse (échec fermé : on ne pose jamais une adresse sans avoir pu vérifier qu'elle est libre).
async function targetTaken(sb: SupabaseClient, userId: string, email: string): Promise<boolean | null> {
  try {
    const { data, error } = await sb.rpc('email_change_target_taken', { p_user: userId, p_email: email })
    if (error || typeof data !== 'boolean') return null
    return data
  } catch { return null }
}

// Hash lié au compte ET à l'adresse cible : un code ne vaut que pour ce couple (et jamais pour une connexion).
const changeHash = (userId: string, newEmail: string, code: string) => hashCode(`chg:${userId}:${newEmail}`, code)

async function emailChange(req: Request, body: Record<string, string>, action: string): Promise<Response> {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const user = await sessionUser(sb, req)
  if (!user) return json(401, { error: 'unauthorized' })

  const newEmail = String(body.new_email ?? '').trim().toLowerCase()
  if (!isChangeEmail(newEmail)) return json(400, { error: 'invalid_email' })
  if (newEmail === user.email) return json(409, { error: 'email_taken', same: true })
  const purgeOld = () => sb.from('email_change_codes').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString())

  // ── ENVOI D'UN CODE À LA NOUVELLE ADRESSE ──
  if (action === 'email_change_send') {
    if (!RESEND_API_KEY) return json(503, { error: 'email_unavailable' })

    // Cooldown 30 s par compte (dérivé du dernier code, comme la connexion).
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { data: recent } = await sb.from('email_change_codes').select('created_at')
      .eq('user_id', user.id).gte('created_at', hourAgo).order('created_at', { ascending: false }).limit(1)
    if (recent && recent.length) {
      const waitS = Math.ceil((new Date(recent[0].created_at).getTime() + COOLDOWN_S * 1000 - Date.now()) / 1000)
      if (waitS > 0) return json(429, { error: 'cooldown', wait: waitS })
    }
    // Plafonds horaires sur rate_events, comptés AVANT le test « adresse déjà prise » : un compte ne peut pas sonder
    // l'existence d'adresses à volonté (5 / h). Puis plafond par adresse cible (pas de bombardement d'une boîte).
    const ip = realIp(req)
    if (!(await rateHit(`emailchg:send:user:${user.id}`, 3600, CHG_MAX_PER_USER_H))) return json(429, { error: 'too_many_codes' })
    if (ip && !(await rateHit(`emailchg:send:ip:${ip}`, 3600, MAX_PER_IP_H))) return json(429, { error: 'too_many_codes' })
    const taken = await targetTaken(sb, user.id, newEmail)
    if (taken === null) return json(500, { error: 'server_error' })
    if (taken) return json(409, { error: 'email_taken' })
    if (!(await rateHit(`emailchg:send:to:${newEmail}`, 3600, CHG_MAX_PER_DEST_H))) return json(429, { error: 'too_many_codes' })

    // Un seul code vivant par compte : les précédents (non utilisés) sont supprimés.
    await sb.from('email_change_codes').delete().eq('user_id', user.id).is('used_at', null)
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
    const { data: ins, error: insErr } = await sb.from('email_change_codes').insert({
      user_id: user.id, new_email: newEmail, code_hash: await changeHash(user.id, newEmail, code),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    }).select('id').single()
    if (insErr || !ins) return json(500, { error: 'server_error' })

    const sent = await sendMail(newEmail, `${code} — confirme ta nouvelle adresse AvatarAds`, emailChangeCodeEmail(code))
    if (!sent) {
      await sb.from('email_change_codes').delete().eq('id', ins.id)
      return json(502, { error: 'send_failed' })
    }
    try { await purgeOld() } catch { /* ménage best-effort */ }
    return json(200, { ok: true })
  }

  // ── VÉRIFICATION DU CODE PUIS CHANGEMENT D'ADRESSE ──
  const code = String(body.code ?? '').trim()
  if (!/^\d{6}$/.test(code)) return json(400, { error: 'wrong_code' })

  // Plafond de vérifications INDÉPENDANT du compteur par code (par compte et par IP), avant même de lire le code.
  const vip = realIp(req)
  if (!(await rateHit(`emailchg:verify:user:${user.id}`, 600, 12))) return json(400, { error: 'too_many_attempts' })
  if (vip && !(await rateHit(`emailchg:verify:ip:${vip}`, 600, 40))) return json(400, { error: 'too_many_attempts' })

  const nowIso = new Date().toISOString()
  const { data: row, error: rowErr } = await sb.from('email_change_codes').select('id, new_email, code_hash')
    .eq('user_id', user.id).is('used_at', null).gt('expires_at', nowIso)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (rowErr) return json(500, { error: 'server_error' })
  // Le code vivant doit viser CETTE adresse (un code demandé pour une autre adresse ne vaut rien ici).
  if (!row || row.new_email !== newEmail) return json(400, { error: 'expired' })

  // Essai consommé ATOMIQUEMENT avant la comparaison (RPC email_change_take_attempt, modèle d'otp_take_attempt).
  const { data: att, error: attErr } = await sb.rpc('email_change_take_attempt', { p_id: row.id, p_user: user.id, p_max: MAX_ATTEMPTS })
  if (attErr) return json(500, { error: 'server_error' })
  if (att === null || att === undefined) {
    await sb.from('email_change_codes').delete().eq('id', row.id)   // plafond atteint → le code est brûlé
    return json(400, { error: 'too_many_attempts' })
  }
  if (!timingSafeEqual(String(row.code_hash), await changeHash(user.id, newEmail, code))) {
    const left = MAX_ATTEMPTS - Number(att)
    if (left <= 0) { await sb.from('email_change_codes').delete().eq('id', row.id); return json(400, { error: 'too_many_attempts' }) }
    return json(400, { error: 'wrong_code', remaining: left })
  }

  // L'adresse a pu être prise entre l'envoi et la vérification (inscription, autre changement).
  const taken = await targetTaken(sb, user.id, newEmail)
  if (taken === null) return json(500, { error: 'server_error' })
  if (taken) return json(409, { error: 'email_taken' })

  // Code correct → usage unique, CONDITIONNEL (un seul gagnant même sous concurrence).
  const { data: used } = await sb.from('email_change_codes').update({ used_at: nowIso }).eq('id', row.id).is('used_at', null).select('id')
  if (!used || !used.length) return json(400, { error: 'expired' })

  // Adresse posée côté Auth, déjà confirmée (la preuve de possession vient d'être faite par le code). Le trigger
  // sync_profile_email recopie dans profiles.email ; GoTrue refuse lui-même une adresse déjà portée (index unique).
  const { error: upErr } = await sb.auth.admin.updateUserById(user.id, { email: newEmail, email_confirm: true })
  if (upErr) {
    const e = upErr as { code?: string; message?: string }
    if (e.code === 'email_exists' || /already|exists|registered|duplicate|unique|rattach/i.test(e.message || '')) return json(409, { error: 'email_taken' })
    if (e.code === 'email_address_invalid' || e.code === 'validation_failed') return json(400, { error: 'invalid_email' })
    console.error('email_change updateUserById:', e.code || '', e.message || '')
    return json(500, { error: 'server_error' })
  }

  // Information à l'ANCIENNE adresse (best-effort : le changement est fait, un échec d'envoi ne le défait pas).
  if (user.email && user.email !== newEmail) {
    try {
      const ok = await sendMail(user.email, 'Ton adresse de connexion AvatarAds a été changée', emailChangedNotice(maskEmail(newEmail)))
      if (!ok) console.warn('email_change : e-mail d\'information à l\'ancienne adresse non parti')
    } catch { /* best-effort */ }
  }
  try { await purgeOld() } catch { /* ménage best-effort */ }
  return json(200, { ok: true, email: newEmail })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  let body: Record<string, string>
  try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }

  const action = body.action
  // Audit 02/10 : changement d'adresse (contrat C1) — aiguillé AVANT la validation de `email` (ces actions portent
  // `new_email` + une session) ; send / verify ci-dessous restent strictement inchangés.
  if (action === 'email_change_send' || action === 'email_change_verify') return await emailChange(req, body, action)
  const email = (body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json(400, { error: 'invalid_email' })

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const nowIso = new Date().toISOString()

  // ── ENVOI D'UN CODE ──
  if (action === 'send') {
    if (!RESEND_API_KEY) return json(503, { error: 'email_unavailable' })
    const mode = body.mode === 'signup' ? 'signup' : 'login'

    // Audit 05/09 (L1) : réponse UNIFORME quel que soit l'état du compte — plus d'oracle d'existence (ni
    // 404 no_account, ni drapeau existing). Un e-mail inconnu reçoit aussi un code, et verify crée le compte
    // s'il n'existe pas (même flux que l'inscription). `mode` ne change plus rien côté serveur.
    void mode

    // Rate limits — COOLDOWN 30 s dérivé du dernier code (UX), mais les PLAFONDS HORAIRES d'envoi vivent
    // désormais dans rate_events (rateHit), INDÉPENDANT d'otp_codes : brûler/supprimer un code ne remet PLUS
    // le compteur à zéro (audit escalade 14/09 — finding LOW « reset du compteur d'envoi »). Même socle que verify.
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { data: recent } = await sb.from('otp_codes').select('created_at')
      .eq('email', email).gte('created_at', hourAgo).order('created_at', { ascending: false })
    if (recent && recent.length) {
      const lastMs = new Date(recent[0].created_at).getTime()
      const waitS = Math.ceil((lastMs + COOLDOWN_S * 1000 - Date.now()) / 1000)
      if (waitS > 0) return json(429, { error: 'cooldown', wait: waitS })
    }
    // IP réelle = DERNIER segment de x-forwarded-for (le premier est forgeable par le client — L2)
    const ip = realIp(req) || null
    // Plafonds horaires AUTORITAIRES sur rate_events (non réinitialisables via une suppression d'otp_codes) :
    if (!(await rateHit(`otp:send:email:${email}`, 3600, MAX_PER_EMAIL_H))) return json(429, { error: 'too_many_codes' })
    if (ip && !(await rateHit(`otp:send:ip:${ip}`, 3600, MAX_PER_IP_H))) return json(429, { error: 'too_many_codes' })

    // NB : on ne supprime pas les anciens codes ici — verify ne lit que le plus
    // récent (les précédents sont donc invalidés de fait) et les garder permet
    // aux compteurs horaires par e-mail / IP de rester exacts.
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
    const { data: ins, error: insErr } = await sb.from('otp_codes').insert({
      email, code_hash: await hashCode(email, code), ip,
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    }).select('id').single()
    if (insErr || !ins) return json(500, { error: 'server_error' })

    const sent = await sendCodeEmail(email, code)
    if (!sent) {
      await sb.from('otp_codes').delete().eq('id', ins.id)
      return json(502, { error: 'send_failed' })
    }
    return json(200, { ok: true })
  }

  // ── VÉRIFICATION D'UN CODE ──
  if (action === 'verify') {
    const code = (body.code || '').trim()
    if (!/^\d{6}$/.test(code)) return json(400, { error: 'wrong_code' })

    // ── Anti brute-force (H1) : plafond de vérifications INDÉPENDANT du compteur par code — par e-mail
    //    et par IP réelle — avant même de lire le code.
    const vip = realIp(req)
    if (!(await rateHit(`otp:verify:email:${email}`, 600, 12))) return json(429, { error: 'too_many_attempts' })
    if (vip && !(await rateHit(`otp:verify:ip:${vip}`, 600, 40))) return json(429, { error: 'too_many_attempts' })

    const { data: row } = await sb.from('otp_codes').select('*')
      .eq('email', email).is('used_at', null).gt('expires_at', nowIso)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!row) return json(400, { error: 'expired' })

    // ── Essai consommé de façon ATOMIQUE, AVANT la comparaison (RPC otp_take_attempt :
    //    UPDATE … SET attempts = attempts + 1 WHERE attempts < max RETURNING). Avant, un SELECT → test →
    //    UPDATE(attempts = n + 1) recalculé côté fonction laissait N requêtes concurrentes lire la même
    //    valeur → le plafond de 5 essais ne montait jamais → brute-force du code à 6 chiffres.
    const { data: att, error: attErr } = await sb.rpc('otp_take_attempt', { p_id: row.id, p_max: MAX_ATTEMPTS })
    if (attErr) return json(500, { error: 'server_error' })
    if (att === null || att === undefined) {
      await sb.from('otp_codes').delete().eq('id', row.id)   // plafond atteint → le code est brûlé
      return json(400, { error: 'too_many_attempts' })
    }
    if (row.code_hash !== await hashCode(email, code)) {
      const left = MAX_ATTEMPTS - Number(att)
      if (left <= 0) { await sb.from('otp_codes').delete().eq('id', row.id); return json(400, { error: 'too_many_attempts' }) }
      return json(400, { error: 'wrong_code', remaining: left })
    }

    // Code correct → usage unique, CONDITIONNEL (un seul gagnant même sous concurrence)
    const { data: used } = await sb.from('otp_codes').update({ used_at: nowIso }).eq('id', row.id).is('used_at', null).select('id')
    if (!used || !used.length) return json(400, { error: 'expired' })
    // Ménage : purge les codes de plus de 24 h
    await sb.from('otp_codes').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString())

    // Compte inexistant → création (le trigger handle_new_user crée le profil free)
    const { data: prof } = await sb.from('profiles').select('id').eq('email', email).maybeSingle()
    let created = false
    if (!prof) {
      const firstName = (body.firstName || '').trim().slice(0, 60)
      const { error: cuErr } = await sb.auth.admin.createUser({
        email, email_confirm: true, user_metadata: { first_name: firstName },
      })
      // "already registered" = user auth existant sans profil → on continue
      if (cuErr && !/already|exists/i.test(cuErr.message)) return json(500, { error: 'server_error' })
      created = !cuErr
    }
    // Audit métier 14/09 : persiste l'IP d'inscription (une seule fois, si absente) — signal anti auto-parrainage
    // (paires parrain↔filleul créées sur la même IP, cf. whop-webhook creditReferral). Colonne non écrivable côté
    // client ; posée ici en service_role. Best-effort (ne bloque jamais la connexion).
    try { const _sip = realIp(req); if (_sip) await sb.from('profiles').update({ signup_ip: _sip }).eq('email', email).is('signup_ip', null) } catch { /* best-effort */ }

    // Session : magic link admin → le client l'échange via verifyOtp({ token_hash })
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({ type: 'magiclink', email })
    const tokenHash = linkData?.properties?.hashed_token
    if (linkErr || !tokenHash) return json(500, { error: 'server_error' })
    return json(200, { ok: true, token_hash: tokenHash, created })
  }

  return json(400, { error: 'bad_request' })
})
