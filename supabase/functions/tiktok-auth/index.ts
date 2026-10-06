// TikTok OAuth (Login Kit) — AvatarAds
//  action=authorize : renvoie l'URL d'autorisation TikTok (client_key public, redirect vérifié)
//  action=exchange  : échange le `code` reçu sur le callback contre un access_token, le stocke
//  action=status    : y a-t-il un compte TikTok connecté ? (open_id + display_name, JAMAIS le token)
// Le client_secret ne sort JAMAIS du serveur : l'échange se fait ici. verify_jwt=false (session vérifiée ICI).
// Voir aussi la page publique tiktok-callback.html.
// Audit 02/10 : TOUTES les actions exigent une session owner/developer. authorize émet un state signé lié à cette
// session (10 min) ; exchange exige ce state ET la même session (Bearer envoyé par tiktok-callback.html, lu dans la
// session avatarads.fr du même domaine). Avant, n'importe qui pouvait relier son compte TikTok (qui devenait « le
// plus récent », choisi par défaut pour l'envoi des brouillons) ou faire relier le sien depuis le navigateur d'Axel.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// trim : un copier-coller depuis la console TikTok peut ajouter un retour à la ligne (vécu le 03/10 au passage en production).
const CLIENT_KEY    = (Deno.env.get('TIKTOK_CLIENT_KEY') || '').trim()
const CLIENT_SECRET = (Deno.env.get('TIKTOK_CLIENT_SECRET') || '').trim()
const REDIRECT_URI  = 'https://avatarads.fr/tiktok-callback.html'
const SCOPE         = 'user.info.basic,video.upload'
const SB_URL        = Deno.env.get('SUPABASE_URL') || ''
const SERVICE       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Photo de profil (06/10) : l'avatar_url de TikTok est un lien CDN signé qui expire ~2 jours après la connexion (403
// ensuite) ; on en garde une copie dans le bucket public factory-media (tiktok-avatars/<hash>.jpg), lien stable.
async function keepAvatar(openId: string, src: string): Promise<string | null> {
  try {
    if (!/^https:\/\/[\w.-]+\.(tiktokcdn(-eu|-us)?\.com|ibyteimg\.com|byteimg\.com)\//.test(src)) return null
    const r = await fetch(src, { signal: AbortSignal.timeout(8000) })
    const type = r.headers.get('content-type') || ''
    if (!r.ok || !type.startsWith('image/')) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    if (!buf.length || buf.length > 2_000_000) return null
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(openId))))
      .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24)
    const path = `tiktok-avatars/${h}.jpg`
    const { error } = await svc.storage.from('factory-media').upload(path, buf, { contentType: type, upsert: true })
    if (error) return null
    return `${SB_URL}/storage/v1/object/public/factory-media/${path}?v=${Date.now()}`
  } catch { return null }
}

// Session owner/developer exigée (audit 29/09 : accounts, status, post et poststatus étaient ouverts — n'importe qui
// pouvait lister nos comptes et pousser une vidéo en brouillon sur eux, en nous faisant télécharger l'URL de son
// choix ; audit 02/10 : authorize et exchange aussi). Fermé par défaut. Renvoie l'uid de l'owner ('' = refus).
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

// Audit 02/10 : state OAuth signé (HMAC-SHA256 avec le secret de l'app et un préfixe dédié ; même schéma
// qu'instagram-auth, préfixe différent). Format : 1.o.<expiration en s, base 36>.<nonce>.<signature>. La signature
// couvre AUSSI l'uid de la session owner qui l'a demandé (jamais écrit en clair dans l'URL vue par TikTok) :
// l'échange n'aboutit qu'avec cette même session. Valable 10 minutes. Pas de mode relecteur ici.
const STATE_TTL_S = 600
const STATE_RE = /^1\.o\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function stateSig(body: string, uid: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('aa-oauth-state|tk|' + body + '|' + uid))))
}
async function stateMint(uid: string): Promise<string> {
  const body = '1.o.' + (Math.floor(Date.now() / 1000) + STATE_TTL_S).toString(36) + '.' + b64u(crypto.getRandomValues(new Uint8Array(12)))
  return body + '.' + await stateSig(body, uid)
}
// State bien formé, non expiré, signé pour CETTE session owner.
async function stateOk(state: string, uid: string): Promise<boolean> {
  const m = STATE_RE.exec(state)
  if (!m || !uid) return false
  const exp = parseInt(m[1], 36) * 1000
  if (!(exp > Date.now()) || exp - Date.now() > (STATE_TTL_S + 300) * 1000) return false
  const i = state.lastIndexOf('.')
  const expected = await stateSig(state.slice(0, i), uid)
  const got = state.slice(i + 1)
  if (expected.length !== got.length) return false
  let d = 0
  for (let k = 0; k < got.length; k++) d |= expected.charCodeAt(k) ^ got.charCodeAt(k)   // temps constant
  return d === 0
}
// Token d'accès valide d'un compte : l'access_token TikTok vit 24 h ; au-delà (ou à 5 min de la fin) on le renouvelle
// avec le refresh_token (365 j) et on enregistre le nouveau couple. null = compte inconnu ou refresh refusé.
async function freshToken(open_id: string): Promise<{ token: string } | { error: string }> {
  const { data: acc } = await svc.from('tiktok_accounts').select('access_token, refresh_token, expires_at').eq('open_id', open_id).maybeSingle()
  if (!acc?.access_token) return { error: 'compte TikTok non connecté (open_id inconnu)' }
  const exp = acc.expires_at ? Date.parse(acc.expires_at) : 0
  if (exp && exp - Date.now() > 5 * 60 * 1000) return { token: acc.access_token }
  if (!acc.refresh_token) return { error: 'session TikTok expirée : reconnecte ce compte' }
  const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: CLIENT_KEY, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: acc.refresh_token }).toString(),
  })
  const t = await r.json().catch(() => ({}))
  if (!r.ok || t.error || !t.access_token) return { error: 'session TikTok expirée : reconnecte ce compte (' + String(t.error_description || t.error || r.status).slice(0, 80) + ')' }
  const now = Date.now()
  await svc.from('tiktok_accounts').update({
    access_token: t.access_token, refresh_token: t.refresh_token ?? acc.refresh_token,
    expires_at: new Date(now + (Number(t.expires_in) || 86400) * 1000).toISOString(),
    ...(t.refresh_expires_in ? { refresh_expires_at: new Date(now + Number(t.refresh_expires_in) * 1000).toISOString() } : {}),
    updated_at: new Date(now).toISOString(),
  }).eq('open_id', open_id)
  return { token: t.access_token }
}

// Vidéos envoyables : seulement celles de notre stockage public factory-media (jamais une URL quelconque).
const MEDIA_PREFIX = `${SB_URL}/storage/v1/object/public/factory-media/`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!CLIENT_KEY || !CLIENT_SECRET) return json({ error: 'TikTok non configuré (secrets manquants).' }, 500)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || (req.method === 'POST' ? 'exchange' : 'authorize')
  // Audit 02/10 : toutes les actions (authorize et exchange compris) exigent la session owner/developer.
  const uid = await ownerUid(req)
  if (!uid) {
    return json({ error: action === 'exchange'
      ? 'Session propriétaire requise : termine la connexion TikTok dans le navigateur où tu es connecté au tableau de bord.'
      : 'réservé au propriétaire' }, 401)
  }

  // 1) URL d'autorisation à ouvrir côté app (state signé lié à la session owner)
  if (action === 'authorize') {
    const state = await stateMint(uid)
    const authorize = 'https://www.tiktok.com/v2/auth/authorize/'
      + `?client_key=${encodeURIComponent(CLIENT_KEY)}`
      + `&scope=${encodeURIComponent(SCOPE)}`
      + `&response_type=code`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      + `&state=${encodeURIComponent(state)}`
    return json({ authorize_url: authorize })
  }

  // 2) échange du code contre un token (appelé par tiktok-callback.html)
  if (action === 'exchange') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const code = String(body.code || url.searchParams.get('code') || '')
    if (!code) return json({ error: 'code manquant' }, 400)
    // Audit 02/10 : state signé pour cette session owner, vérifié AVANT d'utiliser le code.
    const state = String(body.state || url.searchParams.get('state') || '')
    if (!(await stateOk(state, uid))) {
      return json({ error: 'Lien de connexion expiré ou invalide (autre session ou lien modifié) : relance « Connecter TikTok » depuis le tableau de bord.' }, 403)
    }

    const form = new URLSearchParams({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    })
    const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const t = await r.json().catch(() => ({}))
    if (!r.ok || t.error) return json({ error: t.error_description || t.error || `HTTP ${r.status}` }, 400)

    const now = Date.now()
    const row = {
      open_id: t.open_id,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      scope: t.scope ?? null,
      expires_at: new Date(now + (Number(t.expires_in) || 0) * 1000).toISOString(),
      refresh_expires_at: new Date(now + (Number(t.refresh_expires_in) || 0) * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
    }
    const { error } = await svc.from('tiktok_accounts').upsert(row, { onConflict: 'open_id' })
    if (error) return json({ error: 'stockage token : ' + error.message }, 500)

    // (optionnel) récupérer le display_name pour l'affichage
    try {
      const ui = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
        headers: { Authorization: `Bearer ${t.access_token}` },
      })
      const uj = await ui.json().catch(() => ({}))
      const u = uj?.data?.user
      if (u?.display_name) {
        // @ : une reconnexion (Sandbox → production = nouvel open_id) reprend celui de l'ancienne connexion qui a la même
        // photo — la clé d'image du lien TikTok ne change pas tant que la photo de profil ne change pas
        const key = String(u.avatar_url || '').match(/\/tos-[^/]+\/([0-9a-f]{32})/)?.[1]
        let handle: string | null = null
        if (key) {
          const { data: prev } = await svc.from('tiktok_accounts').select('handle')
            .neq('open_id', t.open_id).not('handle', 'is', null).like('avatar_url', `%${key}%`).limit(1)
          handle = prev?.[0]?.handle ?? null
        }
        const avatar = u.avatar_url ? (await keepAvatar(t.open_id, u.avatar_url)) ?? u.avatar_url : null
        const upd: Record<string, unknown> = { display_name: u.display_name, avatar_url: avatar }
        const { data: cur } = await svc.from('tiktok_accounts').select('handle').eq('open_id', t.open_id).maybeSingle()
        if (handle && !cur?.handle) upd.handle = handle
        await svc.from('tiktok_accounts').update(upd).eq('open_id', t.open_id)
      }
    } catch { /* non bloquant */ }

    return json({ ok: true, open_id: t.open_id, scope: t.scope })
  }

  // 3) état de connexion (sans jamais exposer le token)
  if (action === 'status') {
    const { data } = await svc.from('tiktok_accounts').select('open_id, display_name, avatar_url, scope, updated_at').order('updated_at', { ascending: false }).limit(1)
    return json({ connected: !!(data && data.length), account: data?.[0] || null })
  }

  // 3a) @ d'un compte, saisi à la main dans Factory V2 (06/10) : l'app n'a pas le scope user.info.profile (username).
  //     body { open_id, handle } ; reporté sur les autres lignes du même nom affiché (ancienne connexion Sandbox et
  //     nouvelle connexion production n'ont pas le même open_id). handle vide = effacé.
  if (action === 'handle') {
    if (req.method !== 'POST') return json({ error: 'POST requis' }, 405)
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const openId = String(body.open_id || '')
    const handle = String(body.handle || '').trim().replace(/^@+/, '')
    if (!/^[\w.:=+\/-]{4,200}$/.test(openId)) return json({ error: 'compte invalide' }, 400)
    if (handle && !/^[A-Za-z0-9._]{2,24}$/.test(handle)) return json({ error: '@ invalide : lettres, chiffres, points et _ uniquement (2 à 24)' }, 400)
    const { data: acc } = await svc.from('tiktok_accounts').select('display_name').eq('open_id', openId).maybeSingle()
    if (!acc) return json({ error: 'compte introuvable' }, 404)
    const { error } = await svc.from('tiktok_accounts').update({ handle: handle || null }).eq('open_id', openId)
    if (error) return json({ error: 'enregistrement impossible' }, 500)
    // Report sur les autres connexions du même nom, sauf si ce nom porte déjà un autre @ (deux comptes peuvent
    // avoir le même nom affiché, ex. « Axel | SaaS IA » = @ia.axel et @ia.axl)
    if (handle && acc.display_name) {
      const { data: same } = await svc.from('tiktok_accounts').select('open_id, handle').eq('display_name', acc.display_name).neq('open_id', openId)
      const others = new Set((same || []).map((r) => r.handle).filter((h) => h && h !== handle))
      if (!others.size) await svc.from('tiktok_accounts').update({ handle }).eq('display_name', acc.display_name).is('handle', null)
    }
    return json({ ok: true, handle: handle || null })
  }

  // 3b) liste des comptes connectés (pour l'UI — jamais les tokens)
  if (action === 'accounts') {
    const { data } = await svc.from('tiktok_accounts').select('open_id, display_name, handle, avatar_url, updated_at').order('updated_at', { ascending: false })
    return json({ accounts: data || [] })
  }

  // 4) upload d'une vidéo dans les BROUILLONS TikTok (inbox) d'un compte connecté
  //    body { open_id, video_url } → la vidéo tombe dans les brouillons du compte, il publie à la main.
  if (action === 'post') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const open_id = String(body.open_id || '')
    const video_url = String(body.video_url || '')
    const title = String(body.title || '').slice(0, 2200)   // légende pré-remplie (max TikTok ~2200)
    if (!open_id || !video_url) return json({ error: 'open_id et video_url requis' }, 400)
    if (!SB_URL || !video_url.startsWith(MEDIA_PREFIX) || video_url.includes('..')) return json({ error: 'video_url non autorisée' }, 400)

    const ft = await freshToken(open_id)
    if ('error' in ft) return json({ error: ft.error }, 400)
    const acc = { access_token: ft.token }

    // 06/10 : les vidéos finales font 70 à 150 Mo, au-delà des 64 Mo d'un envoi en un seul morceau. On découpe en morceaux
    // de 10 Mo (TikTok : 5 à 64 Mo par morceau, le dernier absorbe le reste), lus un par un dans le stockage (Range) :
    // jamais la vidéo entière en mémoire.
    // ⚠ l'inbox VIDÉO n'accepte QUE source_info — ajouter post_info (titre) fait échouer la livraison SILENCIEUSEMENT (init ok
    // mais la vidéo n'arrive jamais dans l'inbox). La légende est donc renvoyée pour un copier-coller côté app.
    const head = await fetch(video_url, { method: 'HEAD' })
    const size = Number(head.headers.get('content-length') || 0)
    if (!head.ok || !size) return json({ error: `vidéo introuvable (HTTP ${head.status})` }, 400)
    const CHUNK = 10_000_000
    const chunks = size < 5_000_000 ? 1 : Math.floor(size / CHUNK)
    const chunkSize = chunks === 1 ? size : CHUNK
    const init = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${acc.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: chunks } }),
    })
    const ij = await init.json().catch(() => ({}))
    if (!init.ok || (ij.error && ij.error.code && ij.error.code !== 'ok')) {
      return json({ error: (ij.error && ij.error.message) || `init HTTP ${init.status}`, code: ij.error?.code }, 400)
    }
    const publish_id = ij?.data?.publish_id
    const upload_url = ij?.data?.upload_url
    if (!upload_url) return json({ error: 'pas d\'upload_url renvoyé par TikTok', detail: ij }, 400)

    for (let k = 0; k < chunks; k++) {
      const start = k * chunkSize, end = k === chunks - 1 ? size - 1 : start + chunkSize - 1
      const part = await fetch(video_url, { headers: { Range: `bytes=${start}-${end}` } })
      if (part.status !== 206 && !(chunks === 1 && part.ok)) return json({ error: `lecture vidéo morceau ${k + 1}/${chunks} (HTTP ${part.status})` }, 400)
      const bytes = new Uint8Array(await part.arrayBuffer())
      if (bytes.length !== end - start + 1) return json({ error: `morceau ${k + 1}/${chunks} incomplet` }, 400)
      const put = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}` },
        body: bytes,
      })
      if (![200, 201, 206].includes(put.status)) {
        const t = await put.text().catch(() => '')
        return json({ error: `envoi morceau ${k + 1}/${chunks} : HTTP ${put.status} ${t.slice(0, 140)}` }, 400)
      }
    }
    return json({ ok: true, publish_id, size, caption: title, note: 'Vidéo envoyée dans les brouillons TikTok (inbox). Colle la légende dans l\'éditeur.' })
  }

  // 5) statut d'un upload (diagnostic) : { open_id, publish_id } → status + fail_reason TikTok
  if (action === 'poststatus') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const open_id = String(body.open_id || '')
    const publish_id = String(body.publish_id || '')
    if (!open_id || !publish_id) return json({ error: 'open_id et publish_id requis' }, 400)
    const ft = await freshToken(open_id)
    if ('error' in ft) return json({ error: ft.error }, 400)
    const acc = { access_token: ft.token }
    const r = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${acc.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id }),
    })
    const j = await r.json().catch(() => ({}))
    return json({ http: r.status, data: j.data, error: j.error })
  }

  return json({ error: 'action inconnue' }, 400)
})
