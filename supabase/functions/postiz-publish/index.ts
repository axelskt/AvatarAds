// Supabase Edge Function — 📤 Publier partout (#116, compte developer uniquement)
//
// Proxy sécurisé vers l'API publique de Postiz (auto-hébergé sur Railway).
// La clé POSTIZ_API_KEY vit dans les secrets Supabase et ne quitte JAMAIS le serveur.
//
//   POST { action:'channels' }
//        → { channels: [{ id, name, identifier, picture, disabled }] }
//   POST { action:'publish', videoPath, caption, title?, integrations?:[ids] }
//        videoPath : chemin dans le bucket privé render-media (doit commencer par l'uid)
//        → télécharge le MP4, l'upload vers Postiz, publie « now » sur les canaux
//
// Auth : JWT utilisateur, réservé plan developer / is_owner (même règle que le MCP).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const POSTIZ_KEY   = Deno.env.get('POSTIZ_API_KEY') || ''
const POSTIZ_BASE  = 'https://postiz-production-dc64.up.railway.app/api/public/v1'

const svc = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const postiz = (path: string, init: RequestInit = {}) =>
  fetch(POSTIZ_BASE + path, { ...init, headers: { Authorization: POSTIZ_KEY, ...(init.headers || {}) } })

// Contenu adapté par réseau : X et Threads ont des limites dures → on tronque
// la description proprement en PRÉSERVANT les hashtags (jamais coupés).
function contentFor(identifier: string, caption: string, tags: string): string {
  const limits: Record<string, number> = { x: 270, threads: 480 }
  const suffix = tags ? '\n\n' + tags : ''
  const max = limits[identifier]
  if (!max) return caption + suffix
  const room = max - suffix.length
  let base = caption
  if (base.length > room) base = base.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '') + '…'
  return base + suffix
}

// Réglages requis par réseau — Postiz VALIDE ces champs et rejette tout le batch
// s'il en manque un (vu en prod : IG exige post_type, X exige who_can_reply_post).
function settingsFor(identifier: string, title: string): Record<string, unknown> {
  const id = identifier.toLowerCase()
  if (id.includes('youtube')) return { title: title.slice(0, 95) || 'AvatarAds', type: 'public' }
  if (id.includes('instagram')) return { post_type: 'post' } // Reel/feed, jamais story par défaut
  if (id === 'x' || id.includes('twitter')) return { who_can_reply_post: 'everyone' }
  return {}
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!POSTIZ_KEY) return json(500, { error: 'postiz_key_missing' })

  // ── Auth : JWT + plan developer/is_owner ──
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json(401, { error: 'unauthorized' })
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json(401, { error: 'unauthorized' })
  const { data: prof } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
  const isDev = !!prof && ((String(prof.plan || '').toLowerCase() === 'developer') || !!prof.is_owner)
  if (!isDev) return json(403, { error: 'developer_only' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }

  // ── Liste des canaux connectés ──
  if (body.action === 'channels') {
    const r = await postiz('/integrations')
    if (!r.ok) return json(502, { error: 'postiz_error', detail: await r.text() })
    const list = await r.json()
    const channels = (Array.isArray(list) ? list : []).map((c: Record<string, unknown>) => ({
      id: c.id, name: c.name, identifier: c.identifier, picture: c.picture || '', disabled: !!c.disabled,
    }))
    return json(200, { channels })
  }

  // ── Publication ──
  if (body.action === 'publish') {
    const videoPath = String(body.videoPath || '')
    const caption   = String(body.caption || '').trim()
    const title     = String(body.title || '').trim() || caption.split('\n')[0] || 'AvatarAds'
    if (!videoPath.startsWith(user.id + '/')) return json(400, { error: 'bad_path' }) // chacun ne publie que SES fichiers
    if (!caption) return json(400, { error: 'caption_required' })

    // 1) le MP4 depuis le bucket privé
    const dl = await svc.storage.from('render-media').download(videoPath)
    if (dl.error || !dl.data) return json(400, { error: 'video_not_found', detail: dl.error?.message })

    // 2) upload du média vers Postiz
    const fd = new FormData()
    fd.append('file', new File([dl.data], 'avatarads-' + Date.now() + '.mp4', { type: 'video/mp4' }))
    const up = await postiz('/upload', { method: 'POST', body: fd })
    if (!up.ok) return json(502, { error: 'postiz_upload_failed', detail: await up.text() })
    const media = await up.json() // { id, path, … }

    // 3) canaux cibles : ceux demandés, sinon tous les actifs
    const ir = await postiz('/integrations')
    if (!ir.ok) return json(502, { error: 'postiz_error', detail: await ir.text() })
    const all = (await ir.json()) as Array<Record<string, unknown>>
    const asked = Array.isArray(body.integrations) ? (body.integrations as string[]).map(String) : []
    const wanted = asked.length
      ? all.filter((c) => asked.includes(String(c.id)))
      : all.filter((c) => !c.disabled)
    if (!wanted.length) return json(400, { error: 'no_channels' })

    // 3bis) hashtags : ceux d'Axel, envoyés par le client (champ sauvegardé) — max 8, format #mot
    const tags = (String(body.tags || '').match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 8).join(' ')

    // 4) publication immédiate
    const payload = {
      type: 'now',
      date: new Date().toISOString(),
      shortLink: false,
      tags: [],
      posts: wanted.map((c) => ({
        integration: { id: c.id },
        value: [{
          content: contentFor(String(c.identifier || ''), caption, tags),
          image: [{ id: media.id, path: media.path }],
        }],
        group: '',
        settings: settingsFor(String(c.identifier || ''), title),
      })),
    }
    const pr = await postiz('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const prText = await pr.text()
    if (!pr.ok) return json(502, { error: 'postiz_post_failed', detail: prText })

    // 5) ménage : le MP4 n'a plus besoin de traîner dans render-media
    await svc.storage.from('render-media').remove([videoPath]).then(() => {}, () => {})

    let result: unknown = prText
    try { result = JSON.parse(prText) } catch { /* texte brut */ }
    return json(200, { ok: true, published: wanted.map((c) => c.name), hashtags: tags, result })
  }

  return json(400, { error: 'unknown_action' })
})
