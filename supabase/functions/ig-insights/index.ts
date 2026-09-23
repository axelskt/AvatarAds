// Insights compte Instagram — AvatarAds (instagram_business_manage_insights + basic)
//  GET ?ig_id=... (ou 1er compte connecté) → profil + insights compte
//  (reach, profile_views, accounts_engaged, profile_links_taps, views) + top posts
//  (reach/vues/interactions par publication + temps de visionnage moyen des reels).
//  Sert la section « Insights du compte » du dashboard (dev/owner). verify_jwt=false.
//  ⚠ « qui regarde mon profil » / vues UNIQUES / réguliers = NON exposé par l'API IG.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GRAPH   = 'https://graph.instagram.com/v21.0'
const SB_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)
// Liste explicite : le joker « * » ne couvre pas Authorization (spec Fetch), que le dashboard envoie.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
// Compte affiché par défaut (sans ig_id) : le compte principal, jamais « le dernier connecté ».
const PRIMARY_USERNAME = Deno.env.get('IG_PRIMARY_USERNAME') || 'avataradss'
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Session owner/developer exigée (fermé par défaut : sans session valide ou si la base ne répond pas,
// on refuse). La clé publique du site n'a pas d'utilisateur → refusée. La page du reviewer Meta
// (ig-review.html) n'appelle PAS cette fonction : elle affiche l'aperçu renvoyé par instagram-auth.
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

async function accountToken(igId: string): Promise<string | null> {
  const { data } = await svc.from('ig_accounts').select('access_token').eq('ig_id', igId).single()
  if (data?.access_token) return data.access_token
  return Deno.env.get('IG_TOKEN') || null
}

// Appel insights compte : 1 essai groupé, puis repli métrique par métrique (les métriques
// non supportées par la version/compte ne cassent pas les autres). Renvoie {name: value}.
async function fetchAccountInsights(token: string, metrics: string[], range: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const days = range === '7j' ? 7 : range === '28j' ? 28 : 1
  const until = Math.floor(Date.now() / 1000)
  const since = until - days * 86400
  // Fenêtre RÉELLE via since/until : le param `period` seul est ignoré par total_value
  // (24h/7j/28j renvoyaient le même total). since/until donne le vrai total glissant.
  const q = (ms: string[]) => `${GRAPH}/me/insights?metric=${ms.join(',')}&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`
  const parse = (j: any) => { if (Array.isArray(j?.data)) for (const m of j.data) { const tv = m.total_value?.value; if (typeof tv === 'number') out[m.name] = tv } }
  try {
    const j = await (await fetch(q(metrics))).json()
    if (!j.error) parse(j)
    else for (const m of metrics) { try { const jj = await (await fetch(q([m]))).json(); if (!jj.error) parse(jj) } catch { /* skip */ } }
  } catch { /* skip */ }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!(await ownerOk(req))) return json({ error: 'réservé au propriétaire' }, 401)
  const url = new URL(req.url)
  // Sans ig_id : le compte principal. Surtout PAS « le dernier connecté » : l'échange OAuth est public
  // (page du reviewer Meta, futurs users TrackAds) et changerait sans prévenir le compte affiché.
  let igId = url.searchParams.get('ig_id') || ''
  if (!igId) {
    const { data } = await svc.from('ig_accounts').select('ig_id').eq('username', PRIMARY_USERNAME).order('updated_at', { ascending: false }).limit(1)
    igId = data?.[0]?.ig_id || ''
  }
  const token = await accountToken(igId)
  if (!token) return json({ error: 'aucun compte connecté / token' }, 400)

  const out: Record<string, unknown> = { ig_id: igId }

  // 1) profil (basic)
  try {
    const r = await fetch(`${GRAPH}/me?fields=username,name,profile_picture_url,followers_count,follows_count,media_count&access_token=${encodeURIComponent(token)}`)
    const j = await r.json()
    out.username = j.username ?? null
    out.name = j.name ?? null
    out.profile_picture_url = j.profile_picture_url ?? null
    out.followers_count = j.followers_count ?? null
    out.follows_count = j.follows_count ?? null
    out.media_count = j.media_count ?? null
    if (j.error) out.basic_error = j.error?.message
  } catch (e) { out.basic_error = String(e) }

  // 2) insights compte — fenêtre SÉLECTIONNABLE : range=24h|7j|28j → period day|week|days_28.
  //    (pas d'« all-time » : l'API IG ne fournit pas de total à vie sur ces métriques.)
  const range = url.searchParams.get('range') || '28j'
  out.range = range
  out.insights = await fetchAccountInsights(token, ['reach', 'views', 'profile_views', 'accounts_engaged', 'profile_links_taps', 'total_interactions'], range)

  // 3) top posts + temps de visionnage moyen (reels)
  try {
    const rm = await fetch(`${GRAPH}/me/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=12&access_token=${encodeURIComponent(token)}`)
    const jm = await rm.json()
    const media: any[] = Array.isArray(jm?.data) ? jm.data : []
    if (jm?.error) out.media_error = jm.error?.message
    const enriched = await Promise.all(media.map(async (m) => {
      const isReel = (m.media_product_type === 'REELS') || (m.media_type === 'VIDEO')
      const metrics = ['reach', 'views', 'total_interactions', 'saved', 'shares']
      if (isReel) metrics.push('ig_reels_avg_watch_time')
      const mi: Record<string, number> = {}
      try {
        const ri = await fetch(`${GRAPH}/${m.id}/insights?metric=${metrics.join(',')}&access_token=${encodeURIComponent(token)}`)
        const ji = await ri.json()
        if (Array.isArray(ji?.data)) for (const x of ji.data) { const v = x.values?.[0]?.value ?? x.total_value?.value; if (typeof v === 'number') mi[x.name] = v }
      } catch { /* skip */ }
      return {
        id: m.id, permalink: m.permalink, thumbnail: m.thumbnail_url || m.media_url || null,
        media_type: m.media_product_type || m.media_type, caption: (m.caption || '').slice(0, 90), timestamp: m.timestamp,
        reach: mi.reach ?? null, views: mi.views ?? null,
        likes: m.like_count ?? null, comments: m.comments_count ?? null,
        saved: mi.saved ?? null, shares: mi.shares ?? null, interactions: mi.total_interactions ?? null,
        avg_watch_s: mi.ig_reels_avg_watch_time != null ? Math.round(mi.ig_reels_avg_watch_time / 100) / 10 : null, // ms → s
      }
    }))
    enriched.sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))
    out.top_posts = enriched.slice(0, 5)
  } catch (e) { out.top_posts_error = String(e) }

  return json(out)
})
