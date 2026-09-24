// Insights compte Instagram — AvatarAds (instagram_business_manage_insights + basic)
//  GET ?ig_id=... (ou 1er compte connecté) → profil + insights compte
//  (reach, profile_views, accounts_engaged, profile_links_taps, views) + top posts
//  (reach/vues/interactions par publication + temps de visionnage moyen des reels)
//  + répartitions de la fenêtre (abonnements/désabonnements, vues par type de contenu, vues et reach
//  abonnés / non-abonnés, clics sur le lien en bio). Chaque bloc a son propre appel : un refus de l'API
//  sur l'un met SON erreur dans part_errors, sans toucher aux autres.
//  GET ?part=audience → répartition des abonnés (pays, villes, âge, genre), sans le reste.
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

// Fenêtre glissante [since, until] en secondes. 30 j : l'API plafonne une requête à 30 jours, on reste
// 1 min sous la borne pour ne jamais tomber pile dessus. Toute autre valeur retombe sur 24 h (comme avant).
function windowFor(range: string) {
  const days = range === '7j' ? 7 : range === '28j' ? 28 : range === '30j' ? 30 : 1
  const until = Math.floor(Date.now() / 1000)
  return { since: until - days * 86400 + (days === 30 ? 60 : 0), until }
}
type Win = { since: number, until: number }
const RANGES = ['24h', '7j', '28j', '30j']
// Une erreur fetch de Deno contient l'URL COMPLÈTE, access_token compris : tout texte d'erreur renvoyé au
// dashboard passe par safeErr (jeton masqué dans l'URL et sous sa forme brute IG…).
const safeErr = (x: unknown) => String(x ?? '')
  .replace(/access_token=[^&\s"'<>]*/gi, 'access_token=***')
  .replace(/\bIG[A-Za-z0-9_-]{30,}/g, '***')
  .slice(0, 160)
const errMsg = (j: any) => safeErr(j?.error?.message || 'réponse vide')
// 20 s par appel Graph : un appel bloqué ne fait pas tomber toute la réponse.
const gfetch = (u: string) => fetch(u, { signal: AbortSignal.timeout(20000) })
const insightsUrl = (token: string, qs: string) => `${GRAPH}/me/insights?${qs}&access_token=${encodeURIComponent(token)}`

// Appel insights compte : 1 essai groupé, puis repli métrique par métrique (les métriques
// non supportées par la version/compte ne cassent pas les autres). Renvoie {name: value}.
async function fetchAccountInsights(token: string, metrics: string[], win: Win): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  // Fenêtre RÉELLE via since/until : le param `period` seul est ignoré par total_value
  // (24h/7j/28j renvoyaient le même total). since/until donne le vrai total glissant.
  const q = (ms: string[]) => insightsUrl(token, `metric=${ms.join(',')}&metric_type=total_value&period=day&since=${win.since}&until=${win.until}`)
  const parse = (j: any) => { if (Array.isArray(j?.data)) for (const m of j.data) { const tv = m.total_value?.value; if (typeof tv === 'number') out[m.name] = tv } }
  try {
    const j = await (await gfetch(q(metrics))).json()
    if (!j.error) parse(j)
    else for (const m of metrics) { try { const jj = await (await gfetch(q([m]))).json(); if (!jj.error) parse(jj) } catch { /* skip */ } }
  } catch { /* skip */ }
  return out
}

// Total d'UNE métrique sur la fenêtre, ou son erreur (métrique retirée, refusée…).
async function singleTotal(token: string, metric: string, win: Win): Promise<{ value: number } | { error: string }> {
  try {
    const j = await (await gfetch(insightsUrl(token, `metric=${metric}&metric_type=total_value&period=day&since=${win.since}&until=${win.until}`))).json()
    if (j?.error) return { error: errMsg(j) }
    const v = j?.data?.[0]?.total_value?.value
    return typeof v === 'number' ? { value: v } : { error: 'valeur absente de la réponse' }
  } catch (e) { return { error: safeErr(e) } }
}

// Répartition d'un total_value : { total, parts: {DIMENSION: valeur} }. `qs` = paramètres sans breakdown ;
// `breakdowns` = noms à essayer dans l'ordre (le 1er refusé, on tente le suivant). Répartition vide ({})
// SEULEMENT si le total vaut 0 : vide avec un total > 0 ou inconnu = erreur, jamais un faux « 0 ».
type Bk = { breakdown: string, total: number | null, parts: Record<string, number> }
async function breakdownOf(token: string, qs: string, breakdowns: string[]): Promise<Bk | { error: string }> {
  let last = 'réponse vide'
  for (const bd of breakdowns) {
    try {
      const j = await (await gfetch(insightsUrl(token, `${qs}&breakdown=${bd}`))).json()
      if (j?.error) { last = errMsg(j); continue }
      const tv = j?.data?.[0]?.total_value
      const res = tv?.breakdowns?.[0]?.results
      const total = typeof tv?.value === 'number' ? tv.value : null
      const parts: Record<string, number> = {}
      if (Array.isArray(res)) for (const r of res) {
        const k = String(r?.dimension_values?.[0] ?? '').slice(0, 80)
        if (k && typeof r?.value === 'number') parts[k] = (parts[k] || 0) + r.value
      }
      if (Object.keys(parts).length || total === 0) return { breakdown: bd, total, parts }
      last = total == null ? 'répartition absente de la réponse' : `répartition vide alors que le total vaut ${total}`
    } catch (e) { last = safeErr(e) }
  }
  return { error: last }
}

// Répartitions de la fenêtre, en parallèle. Chaque clé absente de la sortie a son erreur dans errors.
async function fetchWindowParts(token: string, win: Win) {
  const w = `period=day&since=${win.since}&until=${win.until}&metric_type=total_value`
  const [follows, byType, byFollower, reachFollow, bio] = await Promise.all([
    breakdownOf(token, `metric=follows_and_unfollows&${w}`, ['follow_type']),
    breakdownOf(token, `metric=views&${w}`, ['media_product_type']),
    breakdownOf(token, `metric=views&${w}`, ['follower_type', 'follow_type']),
    breakdownOf(token, `metric=reach&${w}`, ['follow_type']),
    singleTotal(token, 'website_clicks', win),
  ])
  const out: Record<string, unknown> = {}, errors: Record<string, string> = {}
  const put = (key: string, r: any) => { if (r && 'error' in r) errors[key] = r.error; else out[key] = r }
  put('follows', follows); put('views_by_type', byType); put('views_by_follower', byFollower); put('reach_by_follow', reachFollow)
  if ('error' in bio) errors.website_clicks = bio.error; else out.website_clicks = bio.value
  return { out, errors }
}

// Audience des abonnés actuels (follower_demographics, 100 abonnés minimum, 45 valeurs max par répartition).
// timeframe=this_month d'abord (seules this_week / this_month restent valides depuis la v20), puis sans timeframe.
async function fetchAudience(token: string) {
  const one = async (bd: string): Promise<[string, number][] | { error: string }> => {
    let first = ''
    for (const tf of ['&timeframe=this_month', '']) {
      const r = await breakdownOf(token, `metric=follower_demographics&period=lifetime&metric_type=total_value${tf}`, [bd])
      if ('error' in r) { first = first || r.error; continue }   // on garde l'erreur de l'appel documenté (this_month)
      return Object.entries(r.parts).sort((a, b) => b[1] - a[1]).slice(0, 45)
    }
    return { error: first || 'réponse vide' }
  }
  const keys = ['country', 'city', 'age', 'gender']
  const res = await Promise.all(keys.map(one))
  const audience: Record<string, unknown> = {}, errors: Record<string, string> = {}
  keys.forEach((k, i) => { const r = res[i]; if (Array.isArray(r)) audience[k] = r; else errors[k] = r.error })
  return { audience, errors }
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

  // Audience seule : 4 appels, rechargée à part (elle ne dépend pas de la fenêtre).
  if (url.searchParams.get('part') === 'audience') {
    const a = await fetchAudience(token)
    return json({ ig_id: igId, part: 'audience', audience: a.audience, audience_errors: a.errors })
  }

  // 1) profil (basic)
  try {
    const r = await gfetch(`${GRAPH}/me?fields=username,name,profile_picture_url,followers_count,follows_count,media_count&access_token=${encodeURIComponent(token)}`)
    const j = await r.json()
    out.username = j.username ?? null
    out.name = j.name ?? null
    out.profile_picture_url = j.profile_picture_url ?? null
    out.followers_count = j.followers_count ?? null
    out.follows_count = j.follows_count ?? null
    out.media_count = j.media_count ?? null
    if (j.error) out.basic_error = errMsg(j)
  } catch (e) { out.basic_error = safeErr(e) }

  // 2) insights compte — fenêtre SÉLECTIONNABLE : range=24h|7j|28j|30j (since/until glissants).
  //    (pas d'« all-time » : l'API IG ne fournit pas de total à vie sur ces métriques.)
  //    Sans range : 28j, ce qu'attend factory.html (v1).
  // range renvoyée = celle APPLIQUÉE (une valeur inconnue repasse en 24h) : le dashboard compare avec sa demande.
  const asked = url.searchParams.get('range') || '28j'
  const range = RANGES.includes(asked) ? asked : '24h'
  out.range = range
  const win = windowFor(range)
  out.since = win.since
  out.until = win.until
  const [ins, parts] = await Promise.all([
    fetchAccountInsights(token, ['reach', 'views', 'profile_views', 'accounts_engaged', 'profile_links_taps', 'total_interactions'], win),
    fetchWindowParts(token, win),
  ])
  out.insights = ins
  Object.assign(out, parts.out)
  out.part_errors = parts.errors

  // 3) top posts + temps de visionnage moyen (reels)
  try {
    const rm = await gfetch(`${GRAPH}/me/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=12&access_token=${encodeURIComponent(token)}`)
    const jm = await rm.json()
    const media: any[] = Array.isArray(jm?.data) ? jm.data : []
    if (jm?.error) out.media_error = errMsg(jm)
    const enriched = await Promise.all(media.map(async (m) => {
      const isReel = (m.media_product_type === 'REELS') || (m.media_type === 'VIDEO')
      const metrics = ['reach', 'views', 'total_interactions', 'saved', 'shares']
      if (isReel) metrics.push('ig_reels_avg_watch_time')
      const mi: Record<string, number> = {}
      try {
        const ri = await gfetch(`${GRAPH}/${m.id}/insights?metric=${metrics.join(',')}&access_token=${encodeURIComponent(token)}`)
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
  } catch (e) { out.top_posts_error = safeErr(e) }

  return json(out)
})
