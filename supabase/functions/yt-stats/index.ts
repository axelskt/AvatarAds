// Stats YouTube de base (29/09/2026, Axel : « vues et likes principalement ») pour le dashboard Creative Factory.
// Données publiques via YouTube Data API v3 et une clé API (secret YT_API_KEY, restreinte à cette API) : aucun OAuth.
//  GET ?handle=ialebdaxel → { channel: {title, handle, subscribers, views, videos, thumb}, videos: [{id, title, published_at,
//  views, likes, comments, thumb}] (50 dernières), totals: {views, likes, comments} sur ces vidéos }
// Owner/dev uniquement. Coût quota : ~3 unités par appel (10 000/jour gratuits) ; cache mémoire 10 min par chaîne.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const KEY = Deno.env.get('YT_API_KEY') || ''
const DEFAULT_HANDLE = Deno.env.get('YT_HANDLE') || 'ialebdaxel'
const svc = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
const API = 'https://www.googleapis.com/youtube/v3/'
const TTL = 10 * 60 * 1000
const cache = new Map<string, { at: number, body: unknown }>()

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

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

// La clé ne sort jamais : les messages d'erreur de Google sont repris sans l'URL appelée.
async function yt(path: string, params: Record<string, string>) {
  const u = new URL(API + path)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  u.searchParams.set('key', KEY)
  const r = await fetch(u)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw new Error(String(j?.error?.message || `HTTP ${r.status}`).replace(/key=[^&\s]*/gi, 'key=***').slice(0, 200))
  return j
}
const n = (v: unknown) => (v == null || v === '' ? null : Number(v))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!(await ownerOk(req))) return json({ error: 'réservé au propriétaire' }, 401)
  if (!KEY) return json({ error: 'YT_API_KEY manquant (secret Supabase)' }, 500)

  const handle = (new URL(req.url).searchParams.get('handle') || DEFAULT_HANDLE).replace(/^@/, '').replace(/[^\w.-]/g, '').slice(0, 60)
  const hit = cache.get(handle)
  if (hit && Date.now() - hit.at < TTL) return json(hit.body)

  try {
    const ch = await yt('channels', { part: 'snippet,statistics,contentDetails', forHandle: handle })
    const c = ch.items?.[0]
    if (!c) return json({ error: `chaîne @${handle} introuvable` }, 404)
    const uploads = c.contentDetails?.relatedPlaylists?.uploads
    let videos: Record<string, unknown>[] = []
    if (uploads) {
      const pl = await yt('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '50' })
      const ids = (pl.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean)
      if (ids.length) {
        const vs = await yt('videos', { part: 'snippet,statistics', id: ids.join(',') })
        videos = (vs.items || []).map((v: any) => ({
          id: v.id, title: v.snippet?.title ?? '', published_at: v.snippet?.publishedAt ?? null,
          thumb: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
          views: n(v.statistics?.viewCount), likes: n(v.statistics?.likeCount), comments: n(v.statistics?.commentCount),
        })).sort((a: any, b: any) => String(b.published_at).localeCompare(String(a.published_at)))
      }
    }
    const sum = (k: string) => videos.reduce((a, v: any) => a + (v[k] ?? 0), 0)
    const body = {
      channel: {
        id: c.id, title: c.snippet?.title ?? '', handle: '@' + handle, thumb: c.snippet?.thumbnails?.default?.url ?? null,
        subscribers: c.statistics?.hiddenSubscriberCount ? null : n(c.statistics?.subscriberCount),
        views: n(c.statistics?.viewCount), videos: n(c.statistics?.videoCount),
      },
      videos, totals: { views: sum('views'), likes: sum('likes'), comments: sum('comments'), count: videos.length },
      at: new Date().toISOString(),
      history: [] as { day: string, subscribers: number | null, views: number | null, videos: number | null }[],
    }
    // Relevé du jour (Europe/Paris) puis historique : la seule façon d'avoir les abonnés dans le temps avec une clé publique.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
    await svc.from('social_daily').upsert({ platform: 'youtube', account: handle, day, subscribers: body.channel.subscribers,
      views: body.channel.views, videos: body.channel.videos, updated_at: body.at }, { onConflict: 'platform,account,day' })
    const { data: hist } = await svc.from('social_daily').select('day, subscribers, views, videos')
      .eq('platform', 'youtube').eq('account', handle).order('day').limit(800)
    body.history = (hist || []) as typeof body.history
    cache.set(handle, { at: Date.now(), body })
    return json(body)
  } catch (e) {
    return json({ error: 'YouTube : ' + String((e as Error).message || e) }, 502)
  }
})
