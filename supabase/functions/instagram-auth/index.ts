// Instagram Business Login (OAuth) — AvatarAds Auto-DM (Phase 2 : chaque user branche SON compte)
//  action=authorize : URL d'autorisation (Instagram Business Login → écran de consentement)
//  action=exchange  : code → token court → token long (60j) → username + id pro → upsert ig_accounts → webhooks
//  action=accounts  : liste des comptes connectés (jamais le token)
// Le client_secret (IG_APP_SECRET) ne sort JAMAIS du serveur. verify_jwt=false (session vérifiée ICI).
// Redirect URI = avatarads.fr/ig-callback.html (enregistré côté Meta).
// Audit 02/10 : authorize et exchange exigent une session owner/developer (Bearer) et un state signé (stateMint) :
//  avant, n'importe qui pouvait relier SON compte Instagram à notre auto-DM (ig_accounts + webhooks) ou faire relier
//  le sien depuis le navigateur d'Axel. ig-callback.html renvoie le Bearer de la session avatarads.fr (même domaine).
//  Exception bornée, la page du relecteur Meta (ig-review.html, ?mode=review) : sans session owner, le state est de
//  type « r » et l'échange ne renvoie que l'aperçu du compte qui vient de s'authentifier, SANS rien enregistrer
//  (ni ig_accounts, ni abonnement webhooks).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IG_APP_ID  = Deno.env.get('IG_APP_ID') || '1101714336162805'   // ID d'app Instagram (public)
const APP_SECRET = Deno.env.get('IG_APP_SECRET') || ''
const REDIRECT   = 'https://avatarads.fr/ig-callback.html'
const SCOPE      = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights'
const SB_URL     = Deno.env.get('SUPABASE_URL') || ''
const SERVICE    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Session owner/developer exigée (fermé par défaut : sans session valide ou si la base ne répond pas,
// on refuse). La clé publique du site n'a pas d'utilisateur → refusée.
// Audit 02/10 : renvoie l'uid de l'owner ('' = refus), auquel le state signé est lié.
async function ownerUid(req: Request): Promise<string> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return ''
  try {
    const { data: { user }, error } = await svc.auth.getUser(jwt)
    if (error || !user?.id) return ''
    const { data, error: e2 } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
    if (e2 || !data) return ''
    return (!!data.is_owner || String(data.plan || '').toLowerCase() === 'developer') ? user.id : ''
  } catch { return '' }
}

// Audit 02/10 : state OAuth signé (HMAC-SHA256 avec le secret de l'app et un préfixe dédié ; même schéma que
// tiktok-auth, préfixe différent). Format : 1.<o|r>.<expiration en s, base 36>.<nonce>.<signature>
//  - o (owner) : la signature couvre AUSSI l'uid de la session qui l'a demandé (jamais écrit en clair dans l'URL vue
//    par Instagram) : l'échange n'aboutit qu'avec cette même session.
//  - r (relecteur Meta) : sans session, aperçu seul à l'échange.
//  - valable 10 minutes.
const STATE_TTL_S = 600
const STATE_RE = /^1\.([or])\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function stateSig(body: string, uid: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('aa-oauth-state|ig|' + body + '|' + uid))))
}
async function stateMint(mode: 'o' | 'r', uid: string): Promise<string> {
  const body = '1.' + mode + '.' + (Math.floor(Date.now() / 1000) + STATE_TTL_S).toString(36) + '.' + b64u(crypto.getRandomValues(new Uint8Array(12)))
  return body + '.' + await stateSig(body, mode === 'o' ? uid : '')
}
// Mode d'un state bien formé et non expiré (null sinon). La signature est vérifiée à part (stateOk), avec l'uid.
function stateMode(state: string): 'o' | 'r' | null {
  const m = STATE_RE.exec(state)
  if (!m) return null
  const exp = parseInt(m[2], 36) * 1000
  if (!(exp > Date.now()) || exp - Date.now() > (STATE_TTL_S + 300) * 1000) return null
  return m[1] as 'o' | 'r'
}
async function stateOk(state: string, uid: string): Promise<boolean> {
  const i = state.lastIndexOf('.')
  const expected = await stateSig(state.slice(0, i), uid)
  const got = state.slice(i + 1)
  if (expected.length !== got.length) return false
  let d = 0
  for (let k = 0; k < got.length; k++) d |= expected.charCodeAt(k) ^ got.charCodeAt(k)   // temps constant
  return d === 0
}

// Abonnement du compte (token) aux champs webhook de l'app. Les champs de repli servent si Meta refusait un champ.
async function subscribe(token: string): Promise<true | string> {
  let last = ''
  for (const fields of ['comments,messages,messaging_postbacks', 'comments,messages']) {
    try {
      const r = await fetch(`https://graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=${fields}&access_token=${encodeURIComponent(token)}`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (j?.success === true) return true
      last = String(j?.error?.message || `HTTP ${r.status}`)
    } catch (e) { last = String(e) }
  }
  return last.replace(/access_token=[^&\s"'<>]*/gi, 'access_token=***').slice(0, 160)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!APP_SECRET) return json({ error: 'IG_APP_SECRET manquant (secret Supabase)' }, 500)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || (req.method === 'POST' ? 'exchange' : 'authorize')

  // 1) URL d'autorisation à ouvrir côté user. Audit 02/10 : owner/developer seulement (state « o » lié à sa
  //    session) ; ig-review.html (?mode=review) sans session owner → state « r » (aperçu sans enregistrement).
  if (action === 'authorize') {
    const uid = await ownerUid(req)
    if (!uid && url.searchParams.get('mode') !== 'review') {
      return json({ error: 'Connexion Instagram réservée au propriétaire : reconnecte-toi au tableau de bord puis réessaie.' }, 401)
    }
    const state = await stateMint(uid ? 'o' : 'r', uid)
    const authorize = 'https://www.instagram.com/oauth/authorize'
      + `?client_id=${encodeURIComponent(IG_APP_ID)}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
      + `&response_type=code`
      + `&scope=${encodeURIComponent(SCOPE)}`
      + `&state=${encodeURIComponent(state)}`
    return json({ authorize_url: authorize })
  }

  // 2) échange du code (appelé par ig-callback.html)
  if (action === 'exchange') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const code = String(body.code || url.searchParams.get('code') || '')
    if (!code) return json({ error: 'code manquant' }, 400)
    // Audit 02/10 : state signé vérifié AVANT d'utiliser le code. « o » : la session owner qui l'a demandé doit être
    // celle qui termine (Bearer envoyé par ig-callback.html) ; « r » : relecteur Meta, aperçu sans enregistrement.
    const state = String(body.state || url.searchParams.get('state') || '')
    const mode = stateMode(state)
    if (!mode) return json({ error: 'Lien de connexion expiré ou invalide : relance « Connecter Instagram » depuis le tableau de bord.' }, 400)
    let uid = ''
    if (mode === 'o') {
      uid = await ownerUid(req)
      if (!uid) return json({ error: 'Session propriétaire requise : termine la connexion dans le navigateur où tu es connecté au tableau de bord.' }, 401)
    }
    if (!(await stateOk(state, uid))) return json({ error: 'Lien de connexion invalide (autre session ou lien modifié) : relance « Connecter Instagram ».' }, 403)
    const save = mode === 'o'

    // a) code → token court (~1h)
    const form = new URLSearchParams({
      client_id: IG_APP_ID, client_secret: APP_SECRET,
      grant_type: 'authorization_code', redirect_uri: REDIRECT, code,
    })
    const r1 = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    })
    const t1 = await r1.json().catch(() => ({}))
    if (!r1.ok || t1.error_type || !t1.access_token) {
      return json({ error: t1.error_message || t1.error_type || `HTTP ${r1.status}` }, 400)
    }
    const shortTok = String(t1.access_token)
    const userId = String(t1.user_id || '')

    // b) token court → token long (60j)
    // ⚠️ Si cet échange échoue (compte non pro, token court invalide, rate limit…), on
    // NE stocke PAS le token court : il meurt en ~1h et casse le dashboard/insights en
    // silence (vécu le 22/09 : token court stocké → « Unsupported request » sur /me).
    // On renvoie une erreur claire pour que l'utilisateur reconnecte proprement.
    const r2 = await fetch('https://graph.instagram.com/access_token?grant_type=ig_exchange_token'
      + `&client_secret=${encodeURIComponent(APP_SECRET)}&access_token=${encodeURIComponent(shortTok)}`)
    const t2 = await r2.json().catch(() => ({}))
    if (!r2.ok || !t2.access_token) {
      return json({ error: 'échange token long (60j) échoué : '
        + (t2.error?.message || t2.error_message || `HTTP ${r2.status}`)
        + ' — vérifie que le compte Instagram est bien un compte Professionnel (Business/Créateur).' }, 400)
    }
    const longTok = String(t2.access_token)
    const expiresIn = Number(t2.expires_in) || 5184000  // 60j par défaut si l'API ne le renvoie pas

    // c) profil + aperçu (affichage). L'aperçu n'est renvoyé QU'À celui qui vient de s'authentifier
    //    avec son propre code : c'est ce qu'affichent ig-callback.html et ig-review.html (page du
    //    reviewer Meta), sans passer par ig-insights, qui est réservé au propriétaire.
    let username: string | null = null
    let igUserId = ''   // id PROFESSIONNEL (= entry.id des webhooks, ig_dm_log.ig_id), ≠ userId app-scoped
    let preview: Record<string, unknown> | null = null
    try {
      const ru = await fetch(`https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url,followers_count,media_count&access_token=${encodeURIComponent(longTok)}`)
      const ju = await ru.json().catch(() => ({}))
      username = ju.username || null
      igUserId = String(ju.user_id || '').replace(/\D/g, '')
      if (!ju.error) {
        preview = {
          username, name: ju.name ?? null, profile_picture_url: ju.profile_picture_url ?? null,
          followers_count: ju.followers_count ?? null, media_count: ju.media_count ?? null, reach_28j: null,
        }
        const until = Math.floor(Date.now() / 1000), since = until - 28 * 86400
        const rr = await fetch(`https://graph.instagram.com/v21.0/me/insights?metric=reach&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(longTok)}`)
        const jr = await rr.json().catch(() => ({}))
        const v = jr?.data?.[0]?.total_value?.value
        if (typeof v === 'number') preview.reach_28j = v
      }
    } catch { /* non bloquant */ }

    // Relecteur Meta (state « r ») : l'aperçu seulement, rien n'est enregistré ni abonné aux webhooks.
    if (!save) {
      console.log('[instagram-auth] aperçu relecteur (non enregistré)', username)
      return json({ ok: true, ig_id: userId, username, preview, saved: false })
    }

    // d) upsert. Avec l'id professionnel, la ligne du compte est retrouvée par lui (l'id app-scoped peut changer
    //    d'une connexion à l'autre : on ne crée pas un doublon qui garderait un vieux token).
    const now = Date.now()
    const row: Record<string, unknown> = {
      ig_id: userId, username, access_token: longTok,
      token_expires_at: new Date(now + expiresIn * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
    }
    if (igUserId) {
      row.ig_user_id = igUserId
      // ligne relié avant le 28/09 (ig_user_id vide) avec ce même id app-scoped : on la complète, sinon l'upsert par
      // ig_user_id tenterait un 2e INSERT sur la même clé primaire
      await svc.from('ig_accounts').update({ ig_user_id: igUserId }).eq('ig_id', userId).is('ig_user_id', null)
    }
    const { error } = await svc.from('ig_accounts').upsert(row, { onConflict: igUserId ? 'ig_user_id' : 'ig_id' })
    if (error) return json({ error: 'stockage token : ' + error.message }, 500)

    // e) abonnement du compte aux webhooks (commentaires + DM + tap du bouton) : sans lui, Meta n'envoie rien pour
    //    un compte relié après coup (28/09 : 2e compte). Non bloquant : le résultat est renvoyé et journalisé.
    const webhooks = await subscribe(longTok)
    console.log('[instagram-auth] compte relié', username, 'webhooks', webhooks)
    return json({ ok: true, ig_id: userId, username, webhooks, preview, saved: true })
  }

  // 3) comptes connectés (jamais le token) — owner/dev uniquement : la liste contiendra les
  //    comptes des users TrackAds.
  if (action === 'accounts') {
    if (!(await ownerUid(req))) return json({ error: 'réservé au propriétaire' }, 401)
    // token_expires_at (date seule, JAMAIS le token) : le dashboard affiche « token valide jusqu'au … » (24/09/2026).
    const { data } = await svc.from('ig_accounts').select('ig_id, ig_user_id, username, updated_at, token_expires_at').order('updated_at', { ascending: false })
    return json({ accounts: data || [] })
  }

  return json({ error: 'action inconnue' }, 400)
})
