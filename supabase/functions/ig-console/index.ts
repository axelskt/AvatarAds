// Console Instagram de la page ig-review.html (App Review Meta, 04/10/2026).
// Meta a refusé instagram_business_manage_messages et instagram_business_manage_comments : la vidéo devait montrer l'APP qui
// envoie un message (reçu dans la messagerie Instagram) et qui crée / modifie / supprime des commentaires (visibles dans
// l'app Instagram). Cette fonction fait ces actions sur le compte qui vient de se connecter dans le navigateur :
//   session = identifiant aléatoire remis par instagram-auth à la fin de l'OAuth (table ig_review_sessions, 3 h, jeton côté
//   serveur seulement). Toutes les requêtes en POST (la session ne passe jamais dans une URL).
// Actions : me · media · comments · comment · reply · hide · delete · private_reply · conversations · thread · send.
// Garde-fous : identifiants au format strict, textes bornés, débit limité par session ; Instagram n'autorise de toute façon
// que les commentaires des publications du compte et les messages aux personnes qui l'ont contacté (fenêtre de 24 h,
// 7 jours pour une réponse privée à un commentaire). Messages d'erreur en anglais (interface de la page en anglais).
import { svc, rateHit } from '../_shared/guard.ts'

const GRAPH = 'https://graph.instagram.com/v21.0'
const CORS = {
  'Access-Control-Allow-Origin': 'https://avatarads.fr',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const ID_RE = /^\d{5,40}$/                       // publication, commentaire, destinataire (IGSID)
const CONV_RE = /^[A-Za-z0-9_-]{10,300}$/          // conversation (identifiant opaque)
const SID_RE = /^[A-Za-z0-9_-]{40,60}$/
const txt = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

type Sess = { id: string; ig_user_id: string | null; username: string | null; access_token: string }

async function session(sid: string): Promise<Sess | null> {
  if (!SID_RE.test(sid)) return null
  const { data, error } = await svc().from('ig_review_sessions')
    .select('id, ig_user_id, username, access_token').eq('id', sid).gt('expires_at', new Date().toISOString()).maybeSingle()
  return error || !data ? null : (data as Sess)
}

// Appel Graph avec le jeton en en-tête (jamais dans l'URL). Erreur → message Instagram nettoyé (sans jeton).
async function g(token: string, path: string, init?: { method?: string; body?: unknown }) {
  const r = await fetch(GRAPH + path, {
    method: init?.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.error) {
    const m = String(j?.error?.error_user_msg || j?.error?.message || `HTTP ${r.status}`).replace(/access_token=[^&\s"'<>]*/gi, 'access_token=***')
    throw new Error(m.slice(0, 240))
  }
  return j
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  let b: Record<string, unknown> = {}
  try { b = await req.json() } catch { return json(400, { error: 'Invalid request.' }) }
  const s = await session(String(b.s || ''))
  if (!s) return json(401, { error: 'Session expired — please click “Connect Instagram” again.' })
  const a = String(b.a || '')
  const write = ['comment', 'reply', 'hide', 'delete', 'private_reply', 'send'].includes(a)
  if (!(await rateHit('ig-console:' + s.id, 60, 40))) return json(429, { error: 'Too many requests — wait a few seconds.' })
  if (write && !(await rateHit('ig-console-w:' + s.id, 3600, 60))) return json(429, { error: 'Action limit reached for this session.' })
  const T = s.access_token

  try {
    if (a === 'me') {
      const me = await g(T, '/me?fields=user_id,username,profile_picture_url,followers_count,media_count')
      return json(200, { username: me.username ?? s.username, followers_count: me.followers_count ?? null, media_count: me.media_count ?? null, profile_picture_url: me.profile_picture_url ?? null })
    }

    // ── Commentaires (instagram_business_manage_comments) ──
    if (a === 'media') {
      const r = await g(T, '/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count&limit=12')
      return json(200, { media: (r.data || []).map((m: Record<string, unknown>) => ({
        id: m.id, caption: txt(m.caption, 140), type: m.media_type, thumb: m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null,
        permalink: m.permalink, timestamp: m.timestamp, comments_count: m.comments_count ?? 0 })) })
    }
    if (a === 'comments') {
      const mid = String(b.media_id || ''); if (!ID_RE.test(mid)) return json(400, { error: 'Invalid post.' })
      const r = await g(T, `/${mid}/comments?fields=id,text,username,timestamp,hidden,like_count,replies{id,text,username,timestamp,hidden}&limit=50`)
      return json(200, { comments: (r.data || []).map((c: Record<string, unknown>) => ({
        id: c.id, text: c.text, username: c.username, timestamp: c.timestamp, hidden: !!c.hidden,
        replies: (((c.replies as Record<string, unknown>)?.data as Record<string, unknown>[]) || []).map((x) => ({ id: x.id, text: x.text, username: x.username, timestamp: x.timestamp, hidden: !!x.hidden })) })) })
    }
    if (a === 'comment') {
      const mid = String(b.media_id || ''), t = txt(b.text, 300)
      if (!ID_RE.test(mid) || !t) return json(400, { error: 'Write a comment first.' })
      const r = await g(T, `/${mid}/comments`, { method: 'POST', body: { message: t } })
      return json(200, { ok: true, id: r.id })
    }
    if (a === 'reply') {
      const cid = String(b.comment_id || ''), t = txt(b.text, 300)
      if (!ID_RE.test(cid) || !t) return json(400, { error: 'Write a reply first.' })
      const r = await g(T, `/${cid}/replies`, { method: 'POST', body: { message: t } })
      return json(200, { ok: true, id: r.id })
    }
    if (a === 'hide') {
      const cid = String(b.comment_id || ''); if (!ID_RE.test(cid)) return json(400, { error: 'Invalid comment.' })
      await g(T, `/${cid}?hide=${b.hide === true ? 'true' : 'false'}`, { method: 'POST' })
      return json(200, { ok: true, hidden: b.hide === true })
    }
    if (a === 'delete') {
      const cid = String(b.comment_id || ''); if (!ID_RE.test(cid)) return json(400, { error: 'Invalid comment.' })
      await g(T, `/${cid}`, { method: 'DELETE' })
      return json(200, { ok: true })
    }

    // ── Messages (instagram_business_manage_messages) ──
    if (a === 'private_reply') {   // DM à l'auteur d'un commentaire (réponse privée, 7 jours) — le cœur de l'auto-DM
      const cid = String(b.comment_id || ''), t = txt(b.text, 1000)
      if (!ID_RE.test(cid) || !t) return json(400, { error: 'Write a message first.' })
      const r = await g(T, '/me/messages', { method: 'POST', body: { recipient: { comment_id: cid }, message: { text: t } } })
      return json(200, { ok: true, id: r.message_id || null })
    }
    if (a === 'conversations') {
      const r = await g(T, '/me/conversations?platform=instagram&fields=id,updated_time,participants&limit=15')
      const me = String(s.username || '').toLowerCase()
      return json(200, { conversations: (r.data || []).map((c: Record<string, unknown>) => {
        const ps = (((c.participants as Record<string, unknown>)?.data as Record<string, unknown>[]) || [])
        const other = ps.find((p) => String(p.username || '').toLowerCase() !== me) || ps[0] || {}
        return { id: c.id, updated_time: c.updated_time, username: other.username || null, user_id: other.id || null }
      }) })
    }
    if (a === 'thread') {
      const conv = String(b.conversation_id || ''); if (!CONV_RE.test(conv)) return json(400, { error: 'Invalid conversation.' })
      const r = await g(T, `/${conv}?fields=messages`)
      const ids = ((((r.messages as Record<string, unknown>)?.data as Record<string, unknown>[]) || []).map((m) => String(m.id || '')).filter(Boolean)).slice(0, 10)
      const msgs = await Promise.all(ids.map((id) => g(T, `/${encodeURIComponent(id)}?fields=id,created_time,from,message`).catch(() => null)))
      return json(200, { messages: msgs.filter(Boolean).map((m: Record<string, unknown>) => ({
        id: m.id, created_time: m.created_time, from: ((m.from as Record<string, unknown>) || {}).username || null, text: m.message || '' })).reverse() })
    }
    if (a === 'send') {
      const rid = String(b.recipient_id || ''), t = txt(b.text, 1000)
      if (!ID_RE.test(rid) || !t) return json(400, { error: 'Write a message first.' })
      // destinataire = un participant d'une conversation du compte (jamais un identifiant quelconque)
      const r = await g(T, '/me/conversations?platform=instagram&fields=participants&limit=25')
      const known = (r.data || []).some((c: Record<string, unknown>) => ((((c.participants as Record<string, unknown>)?.data as Record<string, unknown>[]) || []).some((p) => String(p.id) === rid)))
      if (!known) return json(403, { error: 'This person has no conversation with your account.' })
      const sent = await g(T, '/me/messages', { method: 'POST', body: { recipient: { id: rid }, message: { text: t } } })
      return json(200, { ok: true, id: sent.message_id || null })
    }
    return json(400, { error: 'Unknown action.' })
  } catch (e) {
    return json(400, { error: (e as Error).message || 'Instagram error' })
  }
})
