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
//
// Audit 02/10 (P3) : changement de MOT DE PASSE (Mon compte), SESSION EXIGÉE. La revérification de l'identité n'existait
// que côté client (ancien mot de passe relu par l'app, puis sb.auth.updateUser({ password }) : appel que la seule session
// suffit à faire). Désormais :
//   POST { action:'password_change_send' }                   → code 6 chiffres envoyé à l'adresse DU COMPTE (Resend)
//   POST { action:'password_change_verify', code, password } → code vérifié → autorisation à usage unique
//     (password_change_grants) → auth.admin.updateUserById(password) → e-mail d'information au compte.
//     Réponse { ok:true, email } : le serveur Auth ferme TOUTES les sessions du compte, l'app se reconnecte avec le
//     nouveau mot de passe. En base, tout changement de mot de passe sans autorisation est ignoré (trigger
//     guard_password_change, migration 20261003100000). Codes dans password_change_codes.
// Audit 02/10 (P3) : connexion par code — plafond QUOTIDIEN d'envoi par e-mail, et compteur de vérifications par couple
// (e-mail, IP) : un tiers ne peut plus bloquer à lui seul la connexion d'une victime en épuisant son compteur.
//
// Audit 04/10 (P4, migration 20261004050000) :
//   · CC-3 : les plafonds d'ENVOI de code comptent aussi par couple (e-mail, IP) — 6 / h et 15 / 24 h, comme avant mais par
//     demandeur — avec un plafond GLOBAL par adresse plus large (40 / 24 h) : une seule IP ne bloque plus une adresse ~22 h.
//   · CC-4 : les clés de rate_events ne contiennent plus ni l'adresse ni l'IP en clair (empreinte HMAC, rk()).
//   · CC-1 : chaque changement d'adresse est journalisé (email_change_events) ; l'ancienne adresse reçoit un lien « Ce n'est
//     pas moi » valable 72 h → POST { action:'email_change_revert', token } (SANS session) rétablit l'adresse et verrouille
//     le compte (sessions fermées, identités / MFA / mot de passe ajoutés depuis retirés, accès Claude coupé). Un mot de
//     passe changé pendant la fenêtre est signalé aussi à l'ancienne adresse ; l'ancienne adresse ne peut pas ouvrir un
//     NOUVEAU compte pendant 72 h (verify → 409 email_recently_changed).
//   · CC-2 / MCP-1 (contrat K3) : tout changement de mot de passe ou d'adresse validé révoque l'accès Claude (jetons et
//     codes OAuth MCP, clés aa_) du compte.
//
// Audit 23/10 (migration 20261024040000) :
//   · n° 26 : un changement d'adresse DÉLIE les identités Google (ou autres fournisseurs) qui ne portent pas la nouvelle
//     adresse (RPC email_change_delier_identites). GoTrue retrouve une identité Google par son identifiant (sub) avant toute
//     adresse : sans cela, le compte Google de l'ancienne adresse ouvrait toujours le compte, alors que l'avis à l'ancienne
//     adresse affirmait le contraire. L'avis ne promet plus rien que le serveur n'a pas fait.
//   · n° 40 : connexion par code — plafond CUMULÉ de codes faux par COUPLE (adresse, IP) : 30 / 24 h, puis cet appareil ne
//     peut plus ni demander ni vérifier de code pour l'adresse ; le titulaire est prévenu ; seul le DERNIER code envoyé vaut
//     (les précédents expirent à l'envoi d'un nouveau et à la connexion).
//   · n° 41 : email_change_send ne dit plus si l'adresse visée a déjà un compte ; « adresse déjà prise » n'est répondu
//     qu'à email_change_verify_old, après la preuve de l'adresse actuelle.

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM           = 'AvatarAds <bonjour@avatarads.fr>'

const CODE_TTL_MIN     = 10   // validité d'un code
const COOLDOWN_S       = 30   // délai mini entre deux envois pour un même e-mail
const MAX_PER_EMAIL_H  = 6    // codes par e-mail et par heure
const MAX_PER_IP_H     = 30   // codes par IP et par heure
const MAX_ATTEMPTS     = 5    // essais de vérification par code
// Audit 02/10 (P3) : anti bombardement d'une boîte (6 / h laissait 144 codes / jour) et vérifications par couple.
const MAX_PER_EMAIL_DAY      = 15   // codes de connexion par e-mail sur 24 h glissantes
const VERIFY_WIN_S           = 600  // fenêtre des compteurs de vérification (10 min)
const MAX_VERIFY_EMAIL_IP    = 12   // vérifications par couple (e-mail, IP) — l'ancien plafond par e-mail seul
const MAX_VERIFY_EMAIL       = 60   // plafond GLOBAL par e-mail, toutes IP confondues (5 IP saturées pour l'atteindre)
const MAX_VERIFY_IP          = 40   // vérifications par IP, tous e-mails confondus (inchangé)
// Audit 02/10 (P3) : changement de mot de passe — même validité / cooldown / essais que la connexion.
const PWD_MAX_PER_USER_H = 5    // codes de changement de mot de passe par compte et par heure
const PWD_MIN_LEN        = 8    // comme l'app (Mon compte)
const PWD_MAX_BYTES      = 72   // limite de bcrypt (GoTrue refuse au-delà)
const PWD_GRANT_TTL_S    = 120  // durée de l'autorisation serveur posée juste avant updateUserById
// Audit 02/10 : changement d'adresse — même validité / cooldown / essais que la connexion (constantes ci-dessus).
const CHG_MAX_PER_USER_H = 5  // codes de changement par compte et par heure
const CHG_MAX_PER_DEST_H = 5  // codes de changement par adresse cible et par heure
// Audit 04/10 (CC-3) : 6 / h et 15 / 24 h comptés par couple (e-mail, IP) ; ce plafond-ci, toutes IP confondues, borne le
// bombardement d'une boîte (3 IP au moins pour l'atteindre).
const MAX_PER_EMAIL_DAY_GLOBAL = 40
// Audit 04/10 (CC-1) : fenêtre d'annulation d'un changement d'adresse (lien « Ce n'est pas moi » envoyé à l'ancienne adresse).
const REVERT_TTL_H = 72
const REVERT_PAGE  = 'https://avatarads.fr/connexion.html'   // le jeton voyage dans le fragment (#) : jamais envoyé à un serveur
// Audit 23/10 (n° 40) : codes de connexion FAUX sur 24 h glissantes, comptés par COUPLE (adresse, IP) — même règle que les
// plafonds d'envoi depuis l'audit du 04/10 (CC-3). Atteint → CET appareil ne peut plus demander ni vérifier de code pour
// l'adresse. Relecture du 24/10 : la 1re version comptait par adresse seule, toutes IP → un tiers coupait la connexion par
// code de n'importe quel client (et recommençait dès qu'un échec sortait de la fenêtre) ; les comptes créés par code n'ont
// ni Google ni mot de passe. Le brute-force distribué reste borné par le plafond GLOBAL d'envoi (40 codes / 24 h par
// adresse × 5 essais) et par le plafond global de vérification (MAX_VERIFY_EMAIL).
const MAX_ECHECS_EMAIL_JOUR = 30

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

// Audit 04/10 (CC-4) : empreinte d'une adresse ou d'une IP pour les clés de rate_events (HMAC, clé service, 128 bits) —
// le compteur reste exact, la table ne contient plus de donnée personnelle lisible. Préfixe « e: » / « ip: » à l'appel.
const rk = async (v: string) => (await hashCode('rl', v)).slice(0, 32)

// Audit 04/10 (CC-1) : jeton d'annulation d'un changement d'adresse — 256 bits aléatoires, seule l'empreinte est stockée.
const hexAleatoire = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b => b.toString(16).padStart(2, '0')).join('')
const revertHash = (jeton: string) => hashCode('revert', jeton)
// Table / RPC de la migration 20261004050000 absente (fonction déployée avant la migration) : on retombe sur l'ancien
// comportement au lieu de casser le changement d'adresse.
const tableAbsente = (e: { code?: string } | null | undefined) => !!e && ['PGRST205', '42P01', 'PGRST202', '42883'].includes(String(e.code || ''))

// Audit 04/10 (CC-2, MCP-1, contrat K3) : accès Claude coupé — jetons et codes OAuth MCP supprimés, clés aa_ révoquées
// (même effet que POST /mcp/key { action:'revoke' }). Best-effort : journalisé, ne défait jamais le changement déjà fait.
async function couperClaude(sb: SupabaseClient, userId: string): Promise<void> {
  try {
    const r1 = await sb.from('mcp_oauth_tokens').delete().eq('user_id', userId)
    const r2 = await sb.from('mcp_oauth_codes').delete().eq('user_id', userId)
    const r3 = await sb.from('mcp_keys').update({ revoked_at: new Date().toISOString() }).eq('user_id', userId).is('revoked_at', null)
    const e = r1.error || r2.error || r3.error
    if (e) console.error('révocation de l\'accès Claude incomplète :', e.message)
  } catch (e) { console.error('révocation de l\'accès Claude impossible :', (e as Error)?.message || e) }
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

// Audit 23/10 (n° 40) : avis au titulaire quand un appareil est bloqué pour trop de codes faux sur son adresse (une fois par
// 24 h). Même texte que l'adresse ait un compte ou non (elle reçoit déjà des codes dans les deux cas).
function codesSuspendusNotice(): string {
  return mailLayout('Codes faux essayés sur ton adresse', `<div style="font-size:15px;color:#44403c;line-height:1.65">Beaucoup de codes faux viennent d'être essayés pour se connecter à AvatarAds avec cette adresse. L'appareil qui les tapait est bloqué pendant 24 heures. Toi, tu peux toujours te connecter normalement.</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Si c'était toi, attends un peu ou essaie depuis un autre appareil. Si ce n'est pas toi, tu n'as rien à faire : ces essais ont échoué. Si cela se répète, écris-nous à <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a>.</div>`)
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

// Axel 23/10 : 1re étape d'un changement d'adresse = code envoyé à l'adresse ACTUELLE (preuve que c'est bien le titulaire).
function emailChangeOldCodeEmail(code: string, newEmailMasked: string): string {
  return mailLayout('Confirme le changement de ton adresse', `<div style="font-size:15px;color:#44403c;line-height:1.65">Une demande de changement de l'adresse de connexion de ton compte AvatarAds vers <b>${esc(newEmailMasked)}</b> vient d'être faite. Entre ce code dans Mon compte pour confirmer que c'est bien toi :</div>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:20px 8px;margin-top:20px;text-align:center;white-space:nowrap;font-size:30px;font-weight:800;letter-spacing:8px;color:#111;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Ce code expire dans ${CODE_TTL_MIN} minutes et ne peut être utilisé qu'une fois.<br>Si tu n'es pas à l'origine de cette demande, ne donne ce code à personne : sans lui, ton adresse ne peut pas être changée. Écris-nous à <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a> si tu as un doute.</div>`)
}

// Audit 04/10 (CC-1) : lien « Ce n'est pas moi » (vide = journal indisponible : l'e-mail d'avant, sans lien).
// Audit 23/10 (n° 26) : `deliage` = résultat du retrait des identités de l'ancienne adresse (email_change_delier_identites).
// Retrait impossible (RPC en échec) → l'avis ne parle que du code e-mail : une connexion Google liée a pu rester.
function emailChangedNotice(newEmailMasked: string, lienAnnulation = '', deliage: Deliage = { ok: true, google: false }): string {
  const effet = !deliage.ok ? 'Cette adresse-ci ne permet plus de te connecter par code e-mail.'
    : deliage.google ? 'Cette adresse-ci ne permet plus de te connecter, ni par code e-mail ni avec Google : la connexion Google qui y était liée a été retirée du compte.'
    : 'Cette adresse-ci ne permet plus de te connecter.'
  const lien = lienAnnulation
    ? `<div style="margin-top:22px"><a href="${esc(lienAnnulation)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 20px;border-radius:12px">Ce n'est pas moi : rétablir mon adresse</a></div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:14px">Ce lien est valable ${REVERT_TTL_H} heures et ne sert qu'une fois. Il rétablit cette adresse, déconnecte toutes les sessions ouvertes et coupe l'accès de Claude à ton compte.</div>`
    : ''
  return mailLayout('Ton adresse de connexion a été changée', `<div style="font-size:15px;color:#44403c;line-height:1.65">L'adresse e-mail de connexion de ton compte AvatarAds vient d'être remplacée par <b>${esc(newEmailMasked)}</b>. ${effet}</div>${lien}
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Si ce n'est pas toi${lienAnnulation ? ' et que le lien ne fonctionne plus' : ''}, contacte-nous tout de suite à <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a>.</div>`)
}

// Audit 04/10 (CC-1) : confirmation envoyée à l'adresse rétablie.
function emailRevertedNotice(): string {
  return mailLayout('Ton adresse de connexion a été rétablie', `<div style="font-size:15px;color:#44403c;line-height:1.65">Cette adresse est de nouveau l'adresse de connexion de ton compte AvatarAds. Toutes les sessions ouvertes ont été déconnectées et l'accès de Claude à ton compte a été coupé.</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Reconnecte-toi par code e-mail sur avatarads.fr. Si tu utilisais AvatarAds dans Claude, relie-le de nouveau depuis « Connecter Claude ». Une question : <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a>.</div>`)
}

// Audit 04/10 (CC-1) : mot de passe changé dans les 72 h qui suivent un changement d'adresse → l'ancienne adresse est prévenue.
function passwordChangedOldNotice(): string {
  return mailLayout('Mot de passe modifié sur ton compte AvatarAds', `<div style="font-size:15px;color:#44403c;line-height:1.65">Le mot de passe du compte AvatarAds qui utilisait cette adresse jusqu'à récemment vient d'être modifié.</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Si tu n'as changé ni ton adresse ni ton mot de passe, ouvre le lien « Ce n'est pas moi » de l'e-mail « Ton adresse de connexion AvatarAds a été changée » (valable ${REVERT_TTL_H} heures) : il rétablit ton adresse et retire ce mot de passe. Sinon, écris-nous à <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a>.</div>`)
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

// Audit 23/10 (n° 26) : adresse changée → identités Google (ou autres fournisseurs) qui ne portent pas la NOUVELLE adresse
// retirées du compte (RPC email_change_delier_identites, migration 20261024040000 : aucune route admin GoTrue ne supprime une
// identité). Appelée APRÈS updateUserById : GoTrue vient de créer / mettre à jour l'identité « email » de la nouvelle adresse,
// que la RPC exige (jamais un compte sans moyen de connexion). Best-effort : l'adresse est déjà changée, un échec est
// journalisé et l'avis à l'ancienne adresse n'en promet pas plus. Après une annulation (lien « Ce n'est pas moi »), la
// connexion Google de l'adresse rétablie se relie d'elle-même (liaison automatique de GoTrue par adresse vérifiée).
type Deliage = { ok: boolean; google: boolean }
async function delierIdentites(sb: SupabaseClient, userId: string, evId: string, newEmail: string): Promise<Deliage> {
  try {
    const { data, error } = await sb.rpc('email_change_delier_identites', { p_user: userId, p_event: evId || null, p_new_email: newEmail })
    const r = data as { ok?: boolean; retirees?: number; fournisseurs?: string[]; error?: string } | null
    if (error || r?.ok !== true) {
      console.error('email_change : identités de l\'ancienne adresse non déliées —', error?.message || r?.error || 'réponse vide')
      return { ok: false, google: false }
    }
    return { ok: true, google: Array.isArray(r.fournisseurs) && r.fournisseurs.includes('google') }
  } catch (e) {
    console.error('email_change : identités de l\'ancienne adresse non déliées —', (e as Error)?.message || e)
    return { ok: false, google: false }
  }
}

// Hash lié au compte ET à l'adresse cible : un code ne vaut que pour ce couple (et jamais pour une connexion).
const changeHash = (userId: string, newEmail: string, code: string) => hashCode(`chg:${userId}:${newEmail}`, code)
const oldChangeHash = (userId: string, newEmail: string, code: string) => hashCode(`chg-old:${userId}:${newEmail}`, code)
const OLD_PROOF_MIN = 30   // après le code de l'adresse actuelle, 30 min pour valider la nouvelle

async function emailChange(req: Request, body: Record<string, string>, action: string): Promise<Response> {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const user = await sessionUser(sb, req)
  if (!user) return json(401, { error: 'unauthorized' })

  const newEmail = String(body.new_email ?? '').trim().toLowerCase()
  if (!isChangeEmail(newEmail)) return json(400, { error: 'invalid_email' })
  if (newEmail === user.email) return json(409, { error: 'email_taken', same: true })
  const purgeOld = () => sb.from('email_change_codes').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString())

  // Axel 23/10 : DEUX codes. 1) email_change_send → code à l'adresse ACTUELLE (preuve que c'est le titulaire, pas une
  // simple session) ; 2) email_change_verify_old → code juste, puis code à la NOUVELLE adresse (preuve qu'elle lui
  // appartient) ; 3) email_change_verify → changement. email_change_send_new renvoie le 2e code (preuve 1 de < 30 min).
  const verifPlafonds = async (): Promise<Response | null> => {
    const vip = realIp(req)
    if (!(await rateHit(`emailchg:verify:user:${user.id}`, 600, 12))) return json(400, { error: 'too_many_attempts' })
    if (vip && !(await rateHit(`emailchg:verify:ip:${await rk('ip:' + vip)}`, 600, 40))) return json(400, { error: 'too_many_attempts' })
    return null
  }
  // dernier code vivant de l'étape, pour CETTE adresse cible, essai consommé atomiquement puis comparé
  const verifierCode = async (etape: 'ancienne' | 'nouvelle', code: string): Promise<{ ok: true, id: string } | { ok: false, res: Response }> => {
    const nowIso = new Date().toISOString()
    const { data: row, error: rowErr } = await sb.from('email_change_codes').select('id, new_email, code_hash')
      .eq('user_id', user.id).eq('etape', etape).is('used_at', null).gt('expires_at', nowIso)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (rowErr) return { ok: false, res: json(500, { error: 'server_error' }) }
    if (!row || row.new_email !== newEmail) return { ok: false, res: json(400, { error: 'expired' }) }
    const { data: att, error: attErr } = await sb.rpc('email_change_take_attempt', { p_id: row.id, p_user: user.id, p_max: MAX_ATTEMPTS })
    if (attErr) return { ok: false, res: json(500, { error: 'server_error' }) }
    if (att === null || att === undefined) {
      await sb.from('email_change_codes').delete().eq('id', row.id)
      return { ok: false, res: json(400, { error: 'too_many_attempts' }) }
    }
    const attendu = etape === 'ancienne' ? await oldChangeHash(user.id, newEmail, code) : await changeHash(user.id, newEmail, code)
    if (!timingSafeEqual(String(row.code_hash), attendu)) {
      const left = MAX_ATTEMPTS - Number(att)
      if (left <= 0) { await sb.from('email_change_codes').delete().eq('id', row.id); return { ok: false, res: json(400, { error: 'too_many_attempts' }) } }
      return { ok: false, res: json(400, { error: 'wrong_code', remaining: left }) }
    }
    return { ok: true, id: String(row.id) }
  }
  // code de la 2e étape, à la NOUVELLE adresse (un seul vivant)
  const envoyerNouvelle = async (): Promise<Response> => {
    if (!(await rateHit(`emailchg:send:to:${await rk('e:' + newEmail)}`, 3600, CHG_MAX_PER_DEST_H))) return json(429, { error: 'too_many_codes' })
    await sb.from('email_change_codes').delete().eq('user_id', user.id).eq('etape', 'nouvelle').is('used_at', null)
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
    const { data: ins, error: insErr } = await sb.from('email_change_codes').insert({
      user_id: user.id, new_email: newEmail, etape: 'nouvelle', code_hash: await changeHash(user.id, newEmail, code),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    }).select('id').single()
    if (insErr || !ins) return json(500, { error: 'server_error' })
    const sent = await sendMail(newEmail, `${code} — confirme ta nouvelle adresse AvatarAds`, emailChangeCodeEmail(code))
    if (!sent) { await sb.from('email_change_codes').delete().eq('id', ins.id); return json(502, { error: 'send_failed' }) }
    return json(200, { ok: true, etape: 'nouvelle' })
  }

  // ── 1) CODE À L'ADRESSE ACTUELLE ──
  if (action === 'email_change_send') {
    if (!RESEND_API_KEY) return json(503, { error: 'email_unavailable' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(user.email) || user.email.length > 254) return json(400, { error: 'invalid_email' })

    // Cooldown 30 s par compte (dérivé du dernier code, comme la connexion).
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { data: recent } = await sb.from('email_change_codes').select('created_at')
      .eq('user_id', user.id).gte('created_at', hourAgo).order('created_at', { ascending: false }).limit(1)
    if (recent && recent.length) {
      const waitS = Math.ceil((new Date(recent[0].created_at).getTime() + COOLDOWN_S * 1000 - Date.now()) / 1000)
      if (waitS > 0) return json(429, { error: 'cooldown', wait: waitS })
    }
    // Plafonds horaires sur rate_events (5 / h par compte, par IP), puis plafond par adresse destinataire (pas de
    // bombardement d'une boîte).
    // Audit 23/10 (n° 41) : plus de test « adresse déjà prise » ici. Un 409 avant tout envoi disait à n'importe quel compte
    // (une adresse jetable suffit) si une adresse avait un compte AvatarAds. Le test se fait à email_change_verify_old, une
    // fois le code de l'adresse ACTUELLE vérifié, puis de nouveau au changement (email_change_verify).
    const ip = realIp(req)
    if (!(await rateHit(`emailchg:send:user:${user.id}`, 3600, CHG_MAX_PER_USER_H))) return json(429, { error: 'too_many_codes' })
    if (ip && !(await rateHit(`emailchg:send:ip:${await rk('ip:' + ip)}`, 3600, MAX_PER_IP_H))) return json(429, { error: 'too_many_codes' })   // Audit 04/10 (CC-4) : empreintes
    if (!(await rateHit(`emailchg:send:to:${await rk('e:' + user.email)}`, 3600, CHG_MAX_PER_DEST_H))) return json(429, { error: 'too_many_codes' })

    // Un seul parcours vivant par compte : les codes précédents (non utilisés, des deux étapes) sont supprimés.
    await sb.from('email_change_codes').delete().eq('user_id', user.id).is('used_at', null)
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
    const { data: ins, error: insErr } = await sb.from('email_change_codes').insert({
      user_id: user.id, new_email: newEmail, etape: 'ancienne', code_hash: await oldChangeHash(user.id, newEmail, code),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    }).select('id').single()
    if (insErr || !ins) return json(500, { error: 'server_error' })

    const sent = await sendMail(user.email, `${code} — confirme le changement de ton adresse AvatarAds`, emailChangeOldCodeEmail(code, maskEmail(newEmail)))
    if (!sent) {
      await sb.from('email_change_codes').delete().eq('id', ins.id)
      return json(502, { error: 'send_failed' })
    }
    try { await purgeOld() } catch { /* ménage best-effort */ }
    return json(200, { ok: true, etape: 'ancienne', to: maskEmail(user.email) })
  }

  // ── 2) CODE DE L'ADRESSE ACTUELLE VÉRIFIÉ → CODE À LA NOUVELLE ──
  if (action === 'email_change_verify_old') {
    const code = String(body.code ?? '').trim()
    if (!/^\d{6}$/.test(code)) return json(400, { error: 'wrong_code' })
    if (!RESEND_API_KEY) return json(503, { error: 'email_unavailable' })
    const plafond = await verifPlafonds(); if (plafond) return plafond
    const v = await verifierCode('ancienne', code)
    if (!v.ok) return v.res
    // Audit 23/10 (n° 41) : 1er endroit où « adresse déjà prise » est répondu (preuve de l'adresse actuelle faite)
    const taken = await targetTaken(sb, user.id, newEmail)
    if (taken === null) return json(500, { error: 'server_error' })
    if (taken) return json(409, { error: 'email_taken' })
    const { data: used } = await sb.from('email_change_codes').update({ used_at: new Date().toISOString() }).eq('id', v.id).is('used_at', null).select('id')
    if (!used || !used.length) return json(400, { error: 'expired' })
    return await envoyerNouvelle()
  }

  // ── 2 bis) RENVOI DU CODE DE LA NOUVELLE ADRESSE (preuve de l'adresse actuelle faite il y a moins de 30 min) ──
  if (action === 'email_change_send_new') {
    if (!RESEND_API_KEY) return json(503, { error: 'email_unavailable' })
    const depuis = new Date(Date.now() - OLD_PROOF_MIN * 60_000).toISOString()
    const { data: preuve } = await sb.from('email_change_codes').select('id').eq('user_id', user.id).eq('etape', 'ancienne')
      .eq('new_email', newEmail).not('used_at', 'is', null).gt('used_at', depuis).limit(1)
    if (!preuve || !preuve.length) return json(400, { error: 'expired' })
    const { data: recent } = await sb.from('email_change_codes').select('created_at').eq('user_id', user.id).eq('etape', 'nouvelle')
      .order('created_at', { ascending: false }).limit(1)
    if (recent && recent.length) {
      const waitS = Math.ceil((new Date(recent[0].created_at).getTime() + COOLDOWN_S * 1000 - Date.now()) / 1000)
      if (waitS > 0) return json(429, { error: 'cooldown', wait: waitS })
    }
    if (!(await rateHit(`emailchg:send:user:${user.id}`, 3600, CHG_MAX_PER_USER_H))) return json(429, { error: 'too_many_codes' })
    return await envoyerNouvelle()
  }

  // ── VÉRIFICATION DU CODE PUIS CHANGEMENT D'ADRESSE ──
  const code = String(body.code ?? '').trim()
  if (!/^\d{6}$/.test(code)) return json(400, { error: 'wrong_code' })

  // Plafond de vérifications INDÉPENDANT du compteur par code (par compte et par IP), avant même de lire le code.
  const vip = realIp(req)
  if (!(await rateHit(`emailchg:verify:user:${user.id}`, 600, 12))) return json(400, { error: 'too_many_attempts' })
  if (vip && !(await rateHit(`emailchg:verify:ip:${await rk('ip:' + vip)}`, 600, 40))) return json(400, { error: 'too_many_attempts' })

  const nowIso = new Date().toISOString()
  // Axel 23/10 : seul un code envoyé à la NOUVELLE adresse (donc après la preuve à l'adresse actuelle) change l'adresse
  const { data: row, error: rowErr } = await sb.from('email_change_codes').select('id, new_email, code_hash')
    .eq('user_id', user.id).eq('etape', 'nouvelle').is('used_at', null).gt('expires_at', nowIso)
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

  // Audit 04/10 (CC-1) : journal + jeton d'annulation posés AVANT de consommer le code (un échec ici laisse le code
  // utilisable). Échec FERMÉ, sauf migration 20261004050000 absente : changement sans lien d'annulation, comme avant.
  let evId = '', jeton = ''
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(user.email)) {
    // RETOUR à une adresse quittée il y a moins de 72 h (changement ni annulé ni invalidé) : l'adresse qu'on quitte a
    // elle-même été posée pendant la fenêtre → aucun lien d'annulation pour elle (sinon, après une prise de contrôle, le
    // titulaire qui remet son adresse donnerait à l'attaquant un lien pour la lui reprendre). Journalisé quand même.
    const depuis = new Date(Date.now() - REVERT_TTL_H * 3600_000).toISOString()
    const { data: retour, error: rErr } = await sb.from('email_change_events').select('id')
      .eq('user_id', user.id).eq('old_email', newEmail).gt('changed_at', depuis).is('reverted_at', null).is('voided_at', null).limit(1)
    // Audit 04/10 (relecture) : journal illisible pour une autre raison qu'une table absente → échec FERMÉ (avant, le
    // changement passait sans lien d'annulation). Le code n'est pas encore consommé : il resservira.
    if (rErr && !tableAbsente(rErr)) { console.error('email_change : journal illisible :', rErr.message); return json(500, { error: 'server_error' }) }
    const avecLien = !rErr && !(retour && retour.length)
    jeton = avecLien ? hexAleatoire(32) : ''
    const { data: ev, error: evErr } = await sb.from('email_change_events').insert({
      user_id: user.id, old_email: user.email, new_email: newEmail, revert_hash: jeton ? await revertHash(jeton) : null,
      revert_expires_at: new Date(Date.now() + (jeton ? REVERT_TTL_H * 3600_000 : 0)).toISOString(),
    }).select('id').single()
    if (evErr || !ev) {
      jeton = ''
      if (!tableAbsente(evErr)) { console.error('email_change : journal impossible :', evErr?.message || ''); return json(500, { error: 'server_error' }) }
      console.error('email_change : table email_change_events absente (migration 20261004050000) — changement sans lien d\'annulation')
    } else evId = String(ev.id)
  }
  const oublierEvenement = async () => { if (evId) { try { await sb.from('email_change_events').delete().eq('id', evId) } catch { /* best-effort */ } } }

  // Code correct → usage unique, CONDITIONNEL (un seul gagnant même sous concurrence).
  const { data: used } = await sb.from('email_change_codes').update({ used_at: nowIso }).eq('id', row.id).is('used_at', null).select('id')
  if (!used || !used.length) { await oublierEvenement(); return json(400, { error: 'expired' }) }

  // Adresse posée côté Auth, déjà confirmée (la preuve de possession vient d'être faite par le code). Le trigger
  // sync_profile_email recopie dans profiles.email ; GoTrue refuse lui-même une adresse déjà portée (index unique).
  const { error: upErr } = await sb.auth.admin.updateUserById(user.id, { email: newEmail, email_confirm: true })
  if (upErr) {
    await oublierEvenement()
    const e = upErr as { code?: string; message?: string }
    if (e.code === 'email_exists' || /already|exists|registered|duplicate|unique|rattach/i.test(e.message || '')) return json(409, { error: 'email_taken' })
    if (e.code === 'email_address_invalid' || e.code === 'validation_failed') return json(400, { error: 'invalid_email' })
    console.error('email_change updateUserById:', e.code || '', e.message || '')
    return json(500, { error: 'server_error' })
  }

  // Audit 23/10 (n° 26) : la connexion Google de l'ANCIENNE adresse est déliée (sinon elle ouvrait toujours ce compte).
  const deliage = await delierIdentites(sb, user.id, evId, newEmail)

  // Audit 04/10 (CC-2, MCP-1, contrat K3) : adresse changée = accès Claude coupé (Claude se relie de nouveau en un clic).
  await couperClaude(sb, user.id)

  // Information à l'ANCIENNE adresse (best-effort : le changement est fait, un échec d'envoi ne le défait pas), avec le
  // lien d'annulation (audit 04/10, CC-1) : le jeton voyage dans le fragment de l'URL, connexion.html exige un clic.
  if (user.email && user.email !== newEmail) {
    try {
      const lien = jeton ? `${REVERT_PAGE}#annuler-adresse=${jeton}` : ''
      const ok = await sendMail(user.email, 'Ton adresse de connexion AvatarAds a été changée', emailChangedNotice(maskEmail(newEmail), lien, deliage))
      if (!ok) console.warn('email_change : e-mail d\'information à l\'ancienne adresse non parti')
    } catch { /* best-effort */ }
  }
  try { await purgeOld() } catch { /* ménage best-effort */ }
  return json(200, { ok: true, email: newEmail })
}

// ── Audit 04/10 (CC-1) : ANNULATION D'UN CHANGEMENT D'ADRESSE (lien « Ce n'est pas moi », SANS session) ──
// La preuve = le jeton reçu à l'ANCIENNE adresse (256 bits, usage unique, 72 h). L'adresse est rétablie PUIS le compte est
// verrouillé (email_change_lockdown). Adresse reprise entre-temps par un autre compte → rien n'est touché (409, support).
async function emailChangeRevert(req: Request, body: Record<string, string>): Promise<Response> {
  const jeton = String(body.token ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(jeton)) return json(400, { error: 'expired' })
  const ip = realIp(req)
  if (ip && !(await rateHit(`emailchg:revert:ip:${await rk('ip:' + ip)}`, 3600, 20))) return json(429, { error: 'too_many_attempts' })

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const nowIso = new Date().toISOString()
  const { data: ev, error: evErr } = await sb.from('email_change_events').select('id, user_id, old_email')
    .eq('revert_hash', await revertHash(jeton)).is('reverted_at', null).is('voided_at', null).gt('revert_expires_at', nowIso)
    .maybeSingle()
  if (evErr) return tableAbsente(evErr) ? json(400, { error: 'expired' }) : json(500, { error: 'server_error' })
  if (!ev) return json(400, { error: 'expired' })
  const userId = String(ev.user_id), oldEmail = String(ev.old_email || '').trim().toLowerCase()
  if (!oldEmail) return json(400, { error: 'expired' })

  const taken = await targetTaken(sb, userId, oldEmail)
  if (taken === null) return json(500, { error: 'server_error' })
  if (taken) return json(409, { error: 'email_taken' })

  // Usage unique, CONDITIONNEL ; rendu si l'adresse ne peut pas être rétablie (le lien resservira).
  const { data: pris } = await sb.from('email_change_events').update({ reverted_at: nowIso })
    .eq('id', ev.id).is('reverted_at', null).is('voided_at', null).select('id')
  if (!pris || !pris.length) return json(400, { error: 'expired' })
  const rendre = async () => { try { await sb.from('email_change_events').update({ reverted_at: null }).eq('id', ev.id) } catch { /* best-effort */ } }

  const { data: cur, error: curErr } = await sb.auth.admin.getUserById(userId)
  if (curErr || !cur?.user) { await rendre(); console.error('email_change_revert getUserById:', curErr?.message || 'compte introuvable'); return json(500, { error: 'server_error' }) }
  if (String(cur.user.email || '').trim().toLowerCase() !== oldEmail) {
    const { error: upErr } = await sb.auth.admin.updateUserById(userId, { email: oldEmail, email_confirm: true })
    if (upErr) {
      await rendre()
      const e = upErr as { code?: string; message?: string }
      if (e.code === 'email_exists' || /already|exists|registered|duplicate|unique/i.test(e.message || '')) return json(409, { error: 'email_taken' })
      console.error('email_change_revert updateUserById:', e.code || '', e.message || '')
      return json(500, { error: 'server_error' })
    }
  }

  // Verrouillage : sessions, identités / MFA / mot de passe ajoutés depuis le changement, accès Claude, codes en attente.
  const { data: lock, error: lockErr } = await sb.rpc('email_change_lockdown', { p_user: userId, p_event: ev.id })
  const verrou = !lockErr && (lock as { ok?: boolean } | null)?.ok === true
  if (!verrou) {
    console.error('email_change_revert : verrouillage incomplet —', lockErr?.message || JSON.stringify(lock))
    await couperClaude(sb, userId)   // au moins l'accès Claude
  }
  try {
    const ok = await sendMail(oldEmail, 'Ton adresse de connexion AvatarAds a été rétablie', emailRevertedNotice())
    if (!ok) console.warn('email_change_revert : e-mail de confirmation non parti')
  } catch { /* best-effort */ }
  return json(200, { ok: true, email: maskEmail(oldEmail), sessions_closed: verrou })
}

// Audit 04/10 (CC-1) : adresses remplacées depuis moins de 72 h (changement ni annulé ni invalidé) — marquées « mot de passe
// changé » (l'annulation retirera ce mot de passe) et renvoyées pour être prévenues. Journal absent → [].
async function anciennesAdressesRecentes(sb: SupabaseClient, userId: string, courante: string): Promise<string[]> {
  try {
    const depuis = new Date(Date.now() - REVERT_TTL_H * 3600_000).toISOString()
    const { data, error } = await sb.from('email_change_events').select('id, old_email')
      .eq('user_id', userId).gt('changed_at', depuis).is('reverted_at', null).is('voided_at', null)
    if (error) { if (!tableAbsente(error)) console.error('password_change : journal illisible :', error.message); return [] }
    const rows = (data || []) as { id: string; old_email: string }[]
    if (!rows.length) return []
    const { error: mErr } = await sb.from('email_change_events').update({ password_changed_at: new Date().toISOString() }).in('id', rows.map(r => r.id))
    if (mErr) console.error('password_change : marquage du journal impossible :', mErr.message)
    return [...new Set(rows.map(r => String(r.old_email || '').toLowerCase()))].filter(a => a && a !== courante)
  } catch (e) { console.error('password_change : journal :', (e as Error)?.message || e); return [] }
}

// Audit 04/10 (CC-1) : l'adresse a quitté un compte il y a moins de 72 h (changement ni annulé ni invalidé) → elle ne
// peut pas ouvrir un NOUVEAU compte (l'annulation deviendrait impossible : adresse prise). Journal absent → false.
async function adresseRetireeRecemment(sb: SupabaseClient, email: string): Promise<boolean> {
  try {
    const depuis = new Date(Date.now() - REVERT_TTL_H * 3600_000).toISOString()
    const { data, error } = await sb.from('email_change_events').select('id')
      .eq('old_email', email).gt('changed_at', depuis).is('reverted_at', null).is('voided_at', null).limit(1)
    if (error) { if (!tableAbsente(error)) console.error('verify : journal illisible :', error.message); return false }
    return !!(data && data.length)
  } catch { return false }
}

// ── Audit 02/10 (P3) : CHANGEMENT DE MOT DE PASSE ──
// Preuve d'identité = code reçu à l'adresse DU COMPTE (lue dans la session vérifiée, jamais fournie par le client).
// Même mécanique que le changement d'adresse (cooldown, plafonds, essais atomiques, usage unique conditionnel).
function passwordCodeEmail(code: string): string {
  return mailLayout('Ton code pour changer de mot de passe', `<div style="font-size:15px;color:#44403c;line-height:1.65">Entre ce code dans Mon compte sur AvatarAds pour enregistrer ton nouveau mot de passe :</div>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:20px 8px;margin-top:20px;text-align:center;white-space:nowrap;font-size:30px;font-weight:800;letter-spacing:8px;color:#111;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Ce code expire dans ${CODE_TTL_MIN} minutes et ne peut être utilisé qu'une fois.<br>Si tu n'es pas à l'origine de cette demande, ignore cet e-mail : ton mot de passe ne change pas. Par prudence, déconnecte-toi des appareils que tu ne reconnais pas.</div>`)
}

function passwordChangedNotice(): string {
  return mailLayout('Ton mot de passe a été modifié', `<div style="font-size:15px;color:#44403c;line-height:1.65">Le mot de passe de ton compte AvatarAds vient d'être modifié depuis Mon compte. Toutes les sessions ouvertes ont été déconnectées.</div>
      <div style="font-size:13px;color:#78716c;line-height:1.6;margin-top:18px">Si ce n'est pas toi, connecte-toi tout de suite par code e-mail, change ton mot de passe et écris-nous à <a href="mailto:bonjour@avatarads.fr" style="color:#111">bonjour@avatarads.fr</a>.</div>`)
}

// Hash lié au compte : un code de changement de mot de passe ne vaut ni pour une connexion, ni pour un changement d'adresse.
const pwdHash = (userId: string, code: string) => hashCode(`pwd:${userId}`, code)

async function passwordChange(req: Request, body: Record<string, unknown>, action: string): Promise<Response> {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const user = await sessionUser(sb, req)
  if (!user) return json(401, { error: 'unauthorized' })
  // Compte sans adresse exploitable (ne devrait pas exister : comptes nés par code ou par Google) → pas de preuve possible.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(user.email) || user.email.length > 254) return json(400, { error: 'invalid_email' })
  const purgeOld = () => sb.from('password_change_codes').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString())

  // ── ENVOI D'UN CODE À L'ADRESSE DU COMPTE ──
  if (action === 'password_change_send') {
    if (!RESEND_API_KEY) return json(503, { error: 'email_unavailable' })
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { data: recent } = await sb.from('password_change_codes').select('created_at')
      .eq('user_id', user.id).gte('created_at', hourAgo).order('created_at', { ascending: false }).limit(1)
    if (recent && recent.length) {
      const waitS = Math.ceil((new Date(recent[0].created_at).getTime() + COOLDOWN_S * 1000 - Date.now()) / 1000)
      if (waitS > 0) return json(429, { error: 'cooldown', wait: waitS })
    }
    const ip = realIp(req)
    if (ip && !(await rateHit(`pwdchg:send:ip:${await rk('ip:' + ip)}`, 3600, MAX_PER_IP_H))) return json(429, { error: 'too_many_codes' })   // Audit 04/10 (CC-4)
    if (!(await rateHit(`pwdchg:send:user:${user.id}`, 3600, PWD_MAX_PER_USER_H))) return json(429, { error: 'too_many_codes' })

    // Un seul code vivant par compte : les précédents (non utilisés) sont supprimés.
    await sb.from('password_change_codes').delete().eq('user_id', user.id).is('used_at', null)
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
    const { data: ins, error: insErr } = await sb.from('password_change_codes').insert({
      user_id: user.id, code_hash: await pwdHash(user.id, code),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    }).select('id').single()
    if (insErr || !ins) return json(500, { error: 'server_error' })

    const sent = await sendMail(user.email, `${code} — ton code pour changer de mot de passe AvatarAds`, passwordCodeEmail(code))
    if (!sent) {
      await sb.from('password_change_codes').delete().eq('id', ins.id)
      return json(502, { error: 'send_failed' })
    }
    try { await purgeOld() } catch { /* ménage best-effort */ }
    return json(200, { ok: true })
  }

  // ── VÉRIFICATION DU CODE PUIS NOUVEAU MOT DE PASSE ──
  const code = String(body.code ?? '').trim()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!/^\d{6}$/.test(code)) return json(400, { error: 'wrong_code' })
  if (password.length < PWD_MIN_LEN) return json(400, { error: 'weak_password', reasons: ['length'] })
  if (new TextEncoder().encode(password).length > PWD_MAX_BYTES) return json(400, { error: 'password_too_long' })

  const vip = realIp(req)
  if (vip && !(await rateHit(`pwdchg:verify:ip:${await rk('ip:' + vip)}`, VERIFY_WIN_S, MAX_VERIFY_IP))) return json(400, { error: 'too_many_attempts' })
  if (!(await rateHit(`pwdchg:verify:user:${user.id}`, VERIFY_WIN_S, 12))) return json(400, { error: 'too_many_attempts' })   // comme le changement d'adresse

  const nowIso = new Date().toISOString()
  const { data: row, error: rowErr } = await sb.from('password_change_codes').select('id, code_hash')
    .eq('user_id', user.id).is('used_at', null).gt('expires_at', nowIso)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (rowErr) return json(500, { error: 'server_error' })
  if (!row) return json(400, { error: 'expired' })

  // Essai consommé ATOMIQUEMENT avant la comparaison (même modèle qu'email_change_take_attempt).
  const { data: att, error: attErr } = await sb.rpc('password_change_take_attempt', { p_id: row.id, p_user: user.id, p_max: MAX_ATTEMPTS })
  if (attErr) return json(500, { error: 'server_error' })
  if (att === null || att === undefined) {
    await sb.from('password_change_codes').delete().eq('id', row.id)   // plafond atteint → le code est brûlé
    return json(400, { error: 'too_many_attempts' })
  }
  if (!timingSafeEqual(String(row.code_hash), await pwdHash(user.id, code))) {
    const left = MAX_ATTEMPTS - Number(att)
    if (left <= 0) { await sb.from('password_change_codes').delete().eq('id', row.id); return json(400, { error: 'too_many_attempts' }) }
    return json(400, { error: 'wrong_code', remaining: left })
  }

  // Code correct → réservé CONDITIONNELLEMENT (un seul gagnant sous concurrence). Rendu si le mot de passe est refusé
  // (trop simple, fuite connue…) : le client corrige sans redemander de code ; les essais restent comptés.
  const { data: used } = await sb.from('password_change_codes').update({ used_at: nowIso }).eq('id', row.id).is('used_at', null).select('id')
  if (!used || !used.length) return json(400, { error: 'expired' })
  const release = async () => { try { await sb.from('password_change_codes').update({ used_at: null }).eq('id', row.id) } catch { /* best-effort */ } }

  // Autorisation à usage unique lue par le trigger guard_password_change : sans elle, la base garde l'ancien mot de passe.
  const { error: gErr } = await sb.from('password_change_grants').upsert(
    { user_id: user.id, expires_at: new Date(Date.now() + PWD_GRANT_TTL_S * 1000).toISOString() }, { onConflict: 'user_id' })
  if (gErr) { await release(); console.error('password_change grant:', gErr.message); return json(500, { error: 'server_error' }) }

  const { error: upErr } = await sb.auth.admin.updateUserById(user.id, { password })
  // Autorisation encore là = le trigger ne l'a pas consommée = mot de passe NON appliqué (ou état inconnu si la lecture échoue).
  const { data: left, error: leftErr } = await sb.from('password_change_grants').delete().eq('user_id', user.id).select('user_id')
  if (upErr) {
    await release()
    const e = upErr as { code?: string; message?: string; reasons?: string[] }
    if (/longer than|too long/i.test(e.message || '')) return json(400, { error: 'password_too_long' })
    if (e.code === 'weak_password' || /weak|pwned|leaked|at least|characters/i.test(e.message || '')) {
      return json(400, { error: 'weak_password', reasons: Array.isArray(e.reasons) ? e.reasons.slice(0, 3) : [] })
    }
    console.error('password_change updateUserById:', e.code || '', e.message || '')
    return json(500, { error: 'server_error' })
  }
  if (leftErr || (left && left.length)) {
    await release()
    console.error('password_change : autorisation non consommée par guard_password_change' + (leftErr ? ` (${leftErr.message})` : ''))
    return json(500, { error: 'server_error' })
  }

  // Audit 04/10 (CC-2, MCP-1, contrat K3) : mot de passe changé = accès Claude coupé (Claude se relie de nouveau en un clic).
  await couperClaude(sb, user.id)

  // Information au compte (best-effort : le changement est fait, un échec d'envoi ne le défait pas).
  try {
    const ok = await sendMail(user.email, 'Ton mot de passe AvatarAds a été modifié', passwordChangedNotice())
    if (!ok) console.warn('password_change : e-mail d\'information non parti')
  } catch { /* best-effort */ }
  // Audit 04/10 (CC-1) : adresse changée il y a moins de 72 h → l'ANCIENNE adresse est prévenue aussi (son lien
  // d'annulation retirera ce mot de passe).
  for (const ancienne of await anciennesAdressesRecentes(sb, user.id, user.email)) {
    try {
      const ok = await sendMail(ancienne, 'Mot de passe modifié sur ton compte AvatarAds', passwordChangedOldNotice())
      if (!ok) console.warn('password_change : e-mail à l\'ancienne adresse non parti')
    } catch { /* best-effort */ }
  }
  try { await purgeOld() } catch { /* ménage best-effort */ }
  return json(200, { ok: true, email: user.email })
}

// ── Audit 23/10 (n° 40) : PLAFOND CUMULÉ DE CODES FAUX PAR COUPLE (ADRESSE, IP) (connexion par code) ──
// Échecs comptés dans rate_events (clé = empreintes de l'adresse et de l'IP, comme les autres plafonds), lus SANS compter un
// passage (rate_hit, lui, compte chaque appel accepté). Lecture impossible → 0 : échec OUVERT, comme rateHit.
const cleEchecs = (eK: string, ipK: string) => `otp:echec:email-ip:${eK}|${ipK}`
async function echecsCodes(sb: SupabaseClient, eK: string, ipK: string): Promise<number> {
  try {
    const { data, error } = await sb.from('rate_events').select('key').eq('key', cleEchecs(eK, ipK))
      .gt('created_at', new Date(Date.now() - 86_400_000).toISOString()).limit(MAX_ECHECS_EMAIL_JOUR)
    if (error) { console.warn('verify : échecs illisibles (plafond cumulé ignoré) :', error.message); return 0 }
    return (data || []).length
  } catch { return 0 }
}
// Un code faux de plus pour ce couple (adresse, IP). true = plafond atteint : cet appareil est bloqué pour l'adresse
// (titulaire prévenu une seule fois par 24 h). Les codes vivants ne sont PAS expirés : le titulaire garde le sien.
// L'appelant répond alors comme un plafond de vérification.
async function noterEchecCode(sb: SupabaseClient, email: string, eK: string, ipK: string): Promise<boolean> {
  await rateHit(cleEchecs(eK, ipK), 86_400, MAX_ECHECS_EMAIL_JOUR)
  if (await echecsCodes(sb, eK, ipK) < MAX_ECHECS_EMAIL_JOUR) return false
  if (await rateHit(`otp:echec:avis:${eK}`, 86_400, 1)) {
    console.warn('verify : appareil bloqué pour une adresse (trop de codes faux en 24 h)')
    try {
      const ok = await sendMail(email, 'Codes faux essayés sur ton adresse AvatarAds', codesSuspendusNotice())
      if (!ok) console.warn('verify : avis de suspension non parti')
    } catch { /* best-effort */ }
  }
  return true
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  let body: Record<string, string>
  try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }

  const action = body.action
  // Audit 02/10 : changement d'adresse (contrat C1) — aiguillé AVANT la validation de `email` (ces actions portent
  // `new_email` + une session) ; send / verify ci-dessous restent strictement inchangés.
  if (action === 'email_change_send' || action === 'email_change_verify_old' || action === 'email_change_send_new' || action === 'email_change_verify') return await emailChange(req, body, action)
  // Audit 02/10 (P3) : changement de mot de passe (session exigée, aucun `email` dans la requête : l'adresse est celle du compte).
  if (action === 'password_change_send' || action === 'password_change_verify') return await passwordChange(req, body, action)
  // Audit 04/10 (CC-1) : lien « Ce n'est pas moi » (aucune session : la preuve est le jeton reçu à l'ancienne adresse).
  if (action === 'email_change_revert') return await emailChangeRevert(req, body)
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
    // Audit 23/10 (n° 40) : cet appareil a tapé trop de codes faux pour l'adresse (24 h) → aucun code envoyé, avant de
    // toucher aux compteurs d'envoi. Même réponse qu'un plafond d'envoi, que l'adresse ait un compte ou non (pas d'oracle).
    const eK = await rk('e:' + email)
    const sip = realIp(req), sipK = sip ? await rk('ip:' + sip) : '-'
    if (await echecsCodes(sb, eK, sipK) >= MAX_ECHECS_EMAIL_JOUR) return json(429, { error: 'too_many_codes' })
    // IP réelle = DERNIER segment de x-forwarded-for (le premier est forgeable par le client — L2)
    const ip = realIp(req) || null
    // Plafonds horaires AUTORITAIRES sur rate_events (non réinitialisables via une suppression d'otp_codes) :
    // Audit 02/10 (P3) : l'IP d'abord — une demande refusée pour son IP n'entame plus les compteurs de l'adresse visée.
    // Puis l'heure, puis le jour (24 h glissantes) : une demande refusée par l'heure ne compte pas dans le jour.
    // Audit 04/10 (CC-3) : l'heure et le jour se comptent par COUPLE (e-mail, IP) — 15 demandes depuis une seule IP ne
    // bloquent plus l'adresse ~22 h pour tout le monde — puis un plafond GLOBAL par adresse plus large (40 / 24 h).
    // Audit 04/10 (CC-4) : adresse et IP réduites à une empreinte HMAC dans les clés.
    const ipK = ip ? await rk('ip:' + ip) : '-'
    if (ip && !(await rateHit(`otp:send:ip:${ipK}`, 3600, MAX_PER_IP_H))) return json(429, { error: 'too_many_codes' })
    if (!(await rateHit(`otp:send:email-ip:${eK}|${ipK}`, 3600, MAX_PER_EMAIL_H))) return json(429, { error: 'too_many_codes' })
    if (!(await rateHit(`otp:send:email-ip:day:${eK}|${ipK}`, 86_400, MAX_PER_EMAIL_DAY))) return json(429, { error: 'too_many_codes' })
    if (!(await rateHit(`otp:send:email:day:${eK}`, 86_400, MAX_PER_EMAIL_DAY_GLOBAL))) return json(429, { error: 'too_many_codes' })

    // NB : on ne supprime pas les anciens codes ici (le cooldown se lit sur leur created_at).
    // Audit 23/10 (n° 40) : ils EXPIRENT une fois le nouveau code parti. Avant, verify lisait « le plus récent code
    // vivant » : une fois celui-ci utilisé ou brûlé, le précédent (moins de 10 min) redevenait valable. Seuls les codes
    // créés AVANT celui-ci (deux envois simultanés : le dernier survit) ; envoi raté → l'ancien code reste valable.
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
    const { data: ins, error: insErr } = await sb.from('otp_codes').insert({
      email, code_hash: await hashCode(email, code), ip,
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    }).select('id, created_at').single()
    if (insErr || !ins) return json(500, { error: 'server_error' })

    const sent = await sendCodeEmail(email, code)
    if (!sent) {
      await sb.from('otp_codes').delete().eq('id', ins.id)
      return json(502, { error: 'send_failed' })
    }
    try {
      const { error: expErr } = await sb.from('otp_codes').update({ expires_at: new Date().toISOString() })
        .eq('email', email).is('used_at', null).gt('expires_at', nowIso).lt('created_at', ins.created_at)
      if (expErr) console.warn('send : anciens codes non expirés :', expErr.message)
    } catch { /* best-effort : verify ne lit de toute façon que le plus récent */ }
    return json(200, { ok: true })
  }

  // ── VÉRIFICATION D'UN CODE ──
  if (action === 'verify') {
    const code = (body.code || '').trim()
    if (!/^\d{6}$/.test(code)) return json(400, { error: 'wrong_code' })

    // ── Anti brute-force (H1) : plafond de vérifications INDÉPENDANT du compteur par code — par e-mail
    //    et par IP réelle — avant même de lire le code.
    // Audit 02/10 (P3) : le compteur par e-mail SEUL (12 / 10 min) était partagé avec n'importe qui → 12 essais bidon
    //    depuis une seule IP bloquaient la connexion par code de la victime. Désormais : IP (tous e-mails), puis couple
    //    (e-mail, IP) au même plafond de 12, puis plafond GLOBAL par e-mail plus large (60) contre un essai distribué.
    //    Ordre voulu : un essai refusé pour son IP ou son couple n'entame pas le plafond global de l'adresse. Le
    //    brute-force reste borné en amont par code (5 essais, otp_take_attempt) et par les plafonds d'envoi.
    const vip = realIp(req)
    const vipK = vip ? await rk('ip:' + vip) : '-', eK = await rk('e:' + email)   // Audit 04/10 (CC-4) : empreintes
    if (vip && !(await rateHit(`otp:verify:ip:${vipK}`, VERIFY_WIN_S, MAX_VERIFY_IP))) return json(429, { error: 'too_many_attempts' })
    if (!(await rateHit(`otp:verify:email-ip:${eK}|${vipK}`, VERIFY_WIN_S, MAX_VERIFY_EMAIL_IP))) return json(429, { error: 'too_many_attempts' })
    if (!(await rateHit(`otp:verify:email:${eK}`, VERIFY_WIN_S, MAX_VERIFY_EMAIL))) return json(429, { error: 'too_many_attempts' })
    // Audit 23/10 (n° 40) : cet appareil a tapé 30 codes faux pour l'adresse en 24 h → refusé avant même de lire le code,
    // bon code compris (relecture du 24/10 : par couple adresse + IP, plus pour tout le monde).
    if (await echecsCodes(sb, eK, vipK) >= MAX_ECHECS_EMAIL_JOUR) return json(429, { error: 'too_many_attempts' })

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
      // Audit 23/10 (n° 40) : code faux compté pour ce couple (adresse, IP) ; celui qui atteint le plafond bloque cet appareil
      if (await noterEchecCode(sb, email, eK, vipK)) return json(429, { error: 'too_many_attempts' })
      const left = MAX_ATTEMPTS - Number(att)
      if (left <= 0) { await sb.from('otp_codes').delete().eq('id', row.id); return json(400, { error: 'too_many_attempts' }) }
      return json(400, { error: 'wrong_code', remaining: left })
    }

    // Code correct → usage unique, CONDITIONNEL (un seul gagnant même sous concurrence)
    const { data: used } = await sb.from('otp_codes').update({ used_at: nowIso }).eq('id', row.id).is('used_at', null).select('id')
    if (!used || !used.length) return json(400, { error: 'expired' })
    // Audit 23/10 (n° 40) : connexion faite → tout autre code vivant de l'adresse expire (un code reçu plus tôt ne rouvre
    // pas de session pendant le reste de ses 10 minutes). Best-effort.
    try { await sb.from('otp_codes').update({ expires_at: nowIso }).eq('email', email).is('used_at', null).gt('expires_at', nowIso) } catch { /* best-effort */ }
    // Ménage : purge les codes de plus de 24 h
    await sb.from('otp_codes').delete().lt('created_at', new Date(Date.now() - 86_400_000).toISOString())

    // Compte inexistant → création (le trigger handle_new_user crée le profil free)
    const { data: prof } = await sb.from('profiles').select('id').eq('email', email).maybeSingle()
    let created = false
    if (!prof) {
      // Audit 04/10 (CC-1) : adresse retirée d'un compte il y a moins de 72 h → pas de NOUVEAU compte avec elle (la demande
      // vient de son titulaire : le code vient d'être vérifié). Sinon le lien « Ce n'est pas moi » deviendrait inutilisable.
      if (await adresseRetireeRecemment(sb, email)) {
        return json(409, { error: 'email_recently_changed', message: "Cette adresse vient d'être retirée d'un compte AvatarAds. Si tu n'as pas fait ce changement, ouvre le lien « Ce n'est pas moi » reçu par e-mail à cette adresse ; sinon, écris-nous à bonjour@avatarads.fr." })
      }
      const firstName = (body.firstName || '').trim().slice(0, 60)
      // aa_origine = 'serveur' : seule marque qu'un /signup ne peut pas poser (app_metadata) — le trigger différé
      // block_email_signup_hors_serveur refuse tout compte e-mail qui ne la porte pas (migration 23/10)
      const { error: cuErr } = await sb.auth.admin.createUser({
        email, email_confirm: true, user_metadata: { first_name: firstName }, app_metadata: { aa_origine: 'serveur' },
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
