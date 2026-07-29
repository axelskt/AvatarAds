// Supabase Edge Function — 📤 Publier partout (#116, compte developer uniquement)
//
// Proxy sécurisé vers l'API publique de Postiz (auto-hébergé sur Railway).
// La clé POSTIZ_API_KEY vit dans les secrets Supabase et ne quitte JAMAIS le serveur.
//
//   POST { action:'channels' }
//        → { channels: [{ id, name, identifier, picture, disabled }] }
//   POST { action:'publish', videoPath, caption, title?, integrations?:[ids], schedule_at?,
//          captions?:{ [integrationId]: string }, stagger?:boolean }
//        captions : légende propre à un réseau (#117) — vide ⇒ la description commune
//        stagger  : true par défaut ⇒ un appel /posts par réseau, espacés de 20-40 min
//        videoPath : chemin dans le bucket privé render-media (doit commencer par l'uid)
//        schedule_at : ISO 8601 optionnel (#150) → publication PROGRAMMÉE au lieu de « now »
//        → télécharge le MP4, l'upload vers Postiz, publie/programme sur les canaux
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

// ─────────────────────────────────────────────────────────────────────────────
// DÉCALAGE DES PUBLICATIONS (#117)
//
// Avant : UN seul appel /posts avec UNE date → les 5 réseaux partaient à la même
// milliseconde. Dans les logs Postiz : cinq jobs traités à `16:00:00.657`. Même
// fichier, même légende, cinq plateformes, la même seconde — c'est la signature
// d'automatisation la plus lisible qui existe, et Instagram démote les comptes
// qu'il classe en contenu recyclé.
//
// Maintenant : un appel /posts PAR réseau, chacun avec sa propre date. Le premier
// part tout de suite (ou à l'heure programmée), les suivants sont espacés de 20 à
// 40 min tirés au sort — un intervalle FIXE se repère aussi bien qu'une rafale.
//
// L'ordre n'est pas alphabétique : les réseaux où la fenêtre des premières
// minutes décide de la portée passent en premier, les vitrines ferment la marche.
const ORDRE = ['tiktok', 'instagram', 'youtube', 'threads', 'x', 'facebook', 'linkedin', 'pinterest', 'snapchat']
const rang = (identifier: string) => {
  const id = identifier.toLowerCase()
  const i = ORDRE.findIndex((k) => id.includes(k))
  return i < 0 ? ORDRE.length : i
}
const ECART_MIN = 20, ECART_MAX = 40   // minutes entre deux réseaux

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

    // #150 · programmation : date future (≥ 2 min pour laisser l'upload finir, ≤ 1 an)
    let when: Date | null = null
    if (body.schedule_at) {
      when = new Date(String(body.schedule_at))
      if (isNaN(when.getTime())) return json(400, { error: 'bad_schedule_date' })
      if (when.getTime() < Date.now() + 2 * 60_000) return json(400, { error: 'schedule_in_past' })
      if (when.getTime() > Date.now() + 365 * 86_400_000) return json(400, { error: 'schedule_too_far' })
    }

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

    // 3ter) légendes par réseau (#117) : `captions` est indexé par id d'intégration.
    // Une entrée vide = ce réseau reprend la description principale.
    const parReseau = (body.captions && typeof body.captions === 'object')
      ? body.captions as Record<string, string> : {}

    // 4) un appel /posts PAR réseau, chacun avec sa propre date
    const espace = body.stagger === false ? 0 : 1
    const base = when ?? new Date()
    const file = [...wanted].sort((a, b) => rang(String(a.identifier || '')) - rang(String(b.identifier || '')))

    let curseur = base.getTime()
    const envois: Array<{ name: string; at: string; ok: boolean; detail?: string }> = []
    for (let i = 0; i < file.length; i++) {
      const c = file[i]
      if (i > 0 && espace) {
        curseur += Math.round((ECART_MIN + Math.random() * (ECART_MAX - ECART_MIN)) * 60_000)
      }
      const quand = new Date(curseur)
      // le premier part « now » s'il n'y a pas de programmation ; tout le reste
      // est forcément une programmation, sinon Postiz publierait immédiatement.
      const immediat = i === 0 && !when
      const texte = String(parReseau[String(c.id)] || '').trim() || caption
      const payload = {
        type: immediat ? 'now' : 'schedule',
        date: quand.toISOString(),
        shortLink: false,
        tags: [],
        posts: [{
          integration: { id: c.id },
          value: [{
            content: contentFor(String(c.identifier || ''), texte, tags),
            image: [{ id: media.id, path: media.path }],
          }],
          group: '',
          settings: settingsFor(String(c.identifier || ''), title),
        }],
      }
      const pr = await postiz('/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const prText = await pr.text()
      envois.push({
        name: String(c.name || c.identifier || ''),
        at: quand.toISOString(),
        ok: pr.ok,
        ...(pr.ok ? {} : { detail: prText.slice(0, 300) }),
      })
    }
    // UN réseau qui échoue ne doit pas faire échouer les autres : ils sont déjà
    // partis. On renvoie donc le détail réseau par réseau, et on n'échoue en bloc
    // que si RIEN n'est passé.
    const passes = envois.filter((e) => e.ok)
    if (!passes.length) return json(502, { error: 'postiz_post_failed', detail: envois })

    // 5) ménage : le MP4 n'a plus besoin de traîner dans render-media
    await svc.storage.from('render-media').remove([videoPath]).then(() => {}, () => {})

    return json(200, {
      ok: true,
      published: passes.map((e) => e.name),
      failed: envois.filter((e) => !e.ok),
      hashtags: tags,
      scheduled_at: when ? when.toISOString() : null,
      plan: envois,                                  // qui part, et à quelle heure
    })
  }

  return json(400, { error: 'unknown_action' })
})
