import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Auth par code e-mail (OTP à 6 chiffres) ──
// Remplace le mot de passe à l'inscription ET à la connexion.
//   POST { action:'send',   email, mode:'login'|'signup' }
//     → génère un code 6 chiffres (10 min, usage unique), l'envoie via Resend.
//   POST { action:'verify', email, code, firstName? }
//     → vérifie le code, crée le compte si besoin, retourne un token_hash
//       que le client échange contre une session via sb.auth.verifyOtp().
// Anti-abus : cooldown 60 s / e-mail, 6 codes/h par e-mail, 30/h par IP,
// 5 essais max par code, code haché (HMAC service key) — jamais stocké en clair.

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM           = 'AvatarAds <bonjour@avatarads.fr>'

const CODE_TTL_MIN     = 10   // validité d'un code
const COOLDOWN_S       = 60   // délai mini entre deux envois pour un même e-mail
const MAX_PER_EMAIL_H  = 6    // codes par e-mail et par heure
const MAX_PER_IP_H     = 30   // codes par IP et par heure
const MAX_ATTEMPTS     = 5    // essais de vérification par code

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

async function sendCodeEmail(email: string, code: string): Promise<boolean> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], subject: `${code} — ton code AvatarAds`, html: otpEmail(code) }),
  })
  return r.ok
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  let body: Record<string, string>
  try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }

  const action = body.action
  const email = (body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json(400, { error: 'invalid_email' })

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const nowIso = new Date().toISOString()

  // ── ENVOI D'UN CODE ──
  if (action === 'send') {
    if (!RESEND_API_KEY) return json(503, { error: 'email_unavailable' })
    const mode = body.mode === 'signup' ? 'signup' : 'login'

    // Le compte existe-t-il ? (profiles est créé par trigger pour chaque user)
    const { data: prof } = await sb.from('profiles').select('id').eq('email', email).maybeSingle()
    if (mode === 'login' && !prof) return json(404, { error: 'no_account' })

    // Rate limits
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { data: recent } = await sb.from('otp_codes').select('created_at')
      .eq('email', email).gte('created_at', hourAgo).order('created_at', { ascending: false })
    if (recent && recent.length) {
      const lastMs = new Date(recent[0].created_at).getTime()
      const waitS = Math.ceil((lastMs + COOLDOWN_S * 1000 - Date.now()) / 1000)
      if (waitS > 0) return json(429, { error: 'cooldown', wait: waitS })
      if (recent.length >= MAX_PER_EMAIL_H) return json(429, { error: 'too_many_codes' })
    }
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
    if (ip) {
      const { count } = await sb.from('otp_codes').select('id', { count: 'exact', head: true })
        .eq('ip', ip).gte('created_at', hourAgo)
      if ((count ?? 0) >= MAX_PER_IP_H) return json(429, { error: 'too_many_codes' })
    }

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
    return json(200, { ok: true, existing: !!prof })
  }

  // ── VÉRIFICATION D'UN CODE ──
  if (action === 'verify') {
    const code = (body.code || '').trim()
    if (!/^\d{6}$/.test(code)) return json(400, { error: 'wrong_code' })

    const { data: row } = await sb.from('otp_codes').select('*')
      .eq('email', email).is('used_at', null).gt('expires_at', nowIso)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!row) return json(400, { error: 'expired' })
    if (row.attempts >= MAX_ATTEMPTS) {
      await sb.from('otp_codes').delete().eq('id', row.id)
      return json(400, { error: 'too_many_attempts' })
    }
    if (row.code_hash !== await hashCode(email, code)) {
      await sb.from('otp_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
      const left = MAX_ATTEMPTS - row.attempts - 1
      return left <= 0
        ? json(400, { error: 'too_many_attempts' })
        : json(400, { error: 'wrong_code', remaining: left })
    }

    // Code correct → usage unique
    await sb.from('otp_codes').update({ used_at: nowIso }).eq('id', row.id)
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

    // Session : magic link admin → le client l'échange via verifyOtp({ token_hash })
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({ type: 'magiclink', email })
    const tokenHash = linkData?.properties?.hashed_token
    if (linkErr || !tokenHash) return json(500, { error: 'server_error' })
    return json(200, { ok: true, token_hash: tokenHash, created })
  }

  return json(400, { error: 'bad_request' })
})
