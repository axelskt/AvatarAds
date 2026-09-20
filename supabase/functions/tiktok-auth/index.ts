// TikTok OAuth (Login Kit) — AvatarAds
//  action=authorize : renvoie l'URL d'autorisation TikTok (client_key public, redirect vérifié)
//  action=exchange  : échange le `code` reçu sur le callback contre un access_token, le stocke
//  action=status    : y a-t-il un compte TikTok connecté ? (open_id + display_name, JAMAIS le token)
// Le client_secret ne sort JAMAIS du serveur : l'échange se fait ici. verify_jwt=false (le callback
// TikTok arrive sans session Supabase). Voir aussi la page publique tiktok-callback.html.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CLIENT_KEY    = Deno.env.get('TIKTOK_CLIENT_KEY') || ''
const CLIENT_SECRET = Deno.env.get('TIKTOK_CLIENT_SECRET') || ''
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!CLIENT_KEY || !CLIENT_SECRET) return json({ error: 'TikTok non configuré (secrets manquants).' }, 500)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || (req.method === 'POST' ? 'exchange' : 'authorize')

  // 1) URL d'autorisation à ouvrir côté app
  if (action === 'authorize') {
    const state = crypto.randomUUID()
    const authorize = 'https://www.tiktok.com/v2/auth/authorize/'
      + `?client_key=${encodeURIComponent(CLIENT_KEY)}`
      + `&scope=${encodeURIComponent(SCOPE)}`
      + `&response_type=code`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      + `&state=${state}`
    return json({ authorize_url: authorize, state })
  }

  // 2) échange du code contre un token (appelé par tiktok-callback.html)
  if (action === 'exchange') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const code = String(body.code || url.searchParams.get('code') || '')
    if (!code) return json({ error: 'code manquant' }, 400)

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
      if (u?.display_name) await svc.from('tiktok_accounts').update({ display_name: u.display_name, avatar_url: u.avatar_url ?? null }).eq('open_id', t.open_id)
    } catch { /* non bloquant */ }

    return json({ ok: true, open_id: t.open_id, scope: t.scope })
  }

  // 3) état de connexion (sans jamais exposer le token)
  if (action === 'status') {
    const { data } = await svc.from('tiktok_accounts').select('open_id, display_name, avatar_url, scope, updated_at').order('updated_at', { ascending: false }).limit(1)
    return json({ connected: !!(data && data.length), account: data?.[0] || null })
  }

  // 3b) liste des comptes connectés (pour l'UI — jamais les tokens)
  if (action === 'accounts') {
    const { data } = await svc.from('tiktok_accounts').select('open_id, display_name, avatar_url, updated_at').order('updated_at', { ascending: false })
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

    const { data: acc } = await svc.from('tiktok_accounts').select('access_token').eq('open_id', open_id).single()
    if (!acc?.access_token) return json({ error: 'compte TikTok non connecté (open_id inconnu)' }, 400)

    const vr = await fetch(video_url)
    if (!vr.ok) return json({ error: `téléchargement vidéo échoué (HTTP ${vr.status})` }, 400)
    const bytes = new Uint8Array(await vr.arrayBuffer())
    const size = bytes.length
    if (!size) return json({ error: 'vidéo vide' }, 400)

    // init inbox : FILE_UPLOAD en 1 seul chunk (OK jusqu'à 64 Mo). ⚠ l'inbox VIDÉO n'accepte QUE
    // source_info — ajouter post_info (titre) fait échouer la livraison SILENCIEUSEMENT (init ok mais
    // la vidéo n'arrive jamais dans l'inbox). La légende est donc renvoyée pour un copier-coller côté app.
    const init = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${acc.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } }),
    })
    const ij = await init.json().catch(() => ({}))
    if (!init.ok || (ij.error && ij.error.code && ij.error.code !== 'ok')) {
      return json({ error: (ij.error && ij.error.message) || `init HTTP ${init.status}`, code: ij.error?.code }, 400)
    }
    const publish_id = ij?.data?.publish_id
    const upload_url = ij?.data?.upload_url
    if (!upload_url) return json({ error: 'pas d\'upload_url renvoyé par TikTok', detail: ij }, 400)

    // upload des octets
    const put = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${size - 1}/${size}` },
      body: bytes,
    })
    if (![200, 201, 206].includes(put.status)) {
      const t = await put.text().catch(() => '')
      return json({ error: `upload HTTP ${put.status} ${t.slice(0, 140)}` }, 400)
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
    const { data: acc } = await svc.from('tiktok_accounts').select('access_token').eq('open_id', open_id).single()
    if (!acc?.access_token) return json({ error: 'compte non connecté' }, 400)
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
