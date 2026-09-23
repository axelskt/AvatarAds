// Instagram Business Login (OAuth) — AvatarAds Auto-DM (Phase 2 : chaque user branche SON compte)
//  action=authorize : URL d'autorisation (Instagram Business Login → écran de consentement)
//  action=exchange  : code → token court → token long (60j) → username → upsert ig_accounts
//  action=accounts  : liste des comptes connectés (jamais le token)
// Le client_secret (IG_APP_SECRET) ne sort JAMAIS du serveur. verify_jwt=false (le callback arrive
// sans session Supabase). Redirect URI = avatarads.fr/ig-callback.html (enregistré côté Meta).
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
async function ownerOk(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return false
  try {
    const { data: { user }, error } = await svc.auth.getUser(jwt)
    if (error || !user) return false
    const { data, error: e2 } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
    if (e2 || !data) return false
    return !!data.is_owner || String(data.plan || '').toLowerCase() === 'developer'
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!APP_SECRET) return json({ error: 'IG_APP_SECRET manquant (secret Supabase)' }, 500)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || (req.method === 'POST' ? 'exchange' : 'authorize')

  // 1) URL d'autorisation à ouvrir côté user
  if (action === 'authorize') {
    const authorize = 'https://www.instagram.com/oauth/authorize'
      + `?client_id=${encodeURIComponent(IG_APP_ID)}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT)}`
      + `&response_type=code`
      + `&scope=${encodeURIComponent(SCOPE)}`
    return json({ authorize_url: authorize })
  }

  // 2) échange du code (appelé par ig-callback.html)
  if (action === 'exchange') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const code = String(body.code || url.searchParams.get('code') || '')
    if (!code) return json({ error: 'code manquant' }, 400)

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
    let preview: Record<string, unknown> | null = null
    try {
      const ru = await fetch(`https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url,followers_count,media_count&access_token=${encodeURIComponent(longTok)}`)
      const ju = await ru.json().catch(() => ({}))
      username = ju.username || null
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

    // d) upsert
    const now = Date.now()
    const row = {
      ig_id: userId, username, access_token: longTok,
      token_expires_at: new Date(now + expiresIn * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
    }
    const { error } = await svc.from('ig_accounts').upsert(row, { onConflict: 'ig_id' })
    if (error) return json({ error: 'stockage token : ' + error.message }, 500)
    return json({ ok: true, ig_id: userId, username, preview })
  }

  // 3) comptes connectés (jamais le token) — owner/dev uniquement : la liste contiendra les
  //    comptes des users TrackAds.
  if (action === 'accounts') {
    if (!(await ownerOk(req))) return json({ error: 'réservé au propriétaire' }, 401)
    const { data } = await svc.from('ig_accounts').select('ig_id, username, updated_at').order('updated_at', { ascending: false })
    return json({ accounts: data || [] })
  }

  return json({ error: 'action inconnue' }, 400)
})
