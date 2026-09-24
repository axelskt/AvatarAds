// Insights compte Instagram — AvatarAds (instagram_business_manage_insights + basic)
//  GET (sans range ni part) → ancien format de factory.html v1 : profil + insights 28 j glissants + top 5 des
//      12 dernières publications. Inchangé.
//  GET ?range=3j|7j|30j|90j|6m|all → dashboard v2 : profil + insights de la fenêtre + répartitions
//      (abonnements/désabonnements, vues par type de contenu, vues abonnés / non-abonnés, clics sur le lien en bio) + courbe JOUR PAR JOUR (series). Chaque bloc a son propre appel : un refus de l'API sur l'un
//      met SON erreur dans part_errors, sans toucher aux autres.
//      · 3j / 7j / 30j / 90j / 6m = jours Instagram (minuit heure du Pacifique) jusqu'à maintenant, aujourd'hui compris ;
//        all = depuis la 1re publication. Totaux demandés DIRECTEMENT à l'API sur toute la fenêtre (elle répond aussi
//        au-delà de 30 jours, mesuré le 24/09) ; repli = somme des jours pour les métriques additives.
//      · 24h (glissant) reste accepté, le dashboard ne le propose plus (Instagram met ~48 h à tout compter).
//      · Abonnements des 1-2 derniers jours pas encore publiés par Instagram → follows_pending (ni 0 ni erreur) ;
//        followers_base = compteur d'abonnés relevé la veille du 1er jour (ig_followers_daily) → net exact.
//      Les jours viennent de la table ig_daily_insights (cache service role) : un jour clos depuis > 48 h n'est
//      plus jamais relu ; les jours récents sont relus au plus toutes les 15 min.
//  GET ?part=media → profil + TOUTES les publications (≤ 200) avec leurs chiffres à vie (vues, reach, likes,
//      commentaires, enregistrements, partages, visionnage moyen des reels) : publications par période,
//      visionnage moyen, top publications.
//  GET ?part=audience → répartition des abonnés (pays, villes, âge, genre).
//  Réservé owner/developer. verify_jwt=false. ⚠ « qui regarde mon profil » / vues UNIQUES = NON exposé par l'API IG.
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

// Une erreur fetch de Deno contient l'URL COMPLÈTE, access_token compris : tout texte d'erreur renvoyé au
// dashboard (ou écrit dans les journaux) passe par safeErr (jeton masqué dans l'URL et sous sa forme brute IG…).
const safeErr = (x: unknown) => String(x ?? '')
  .replace(/access_token=[^&\s"'<>]*/gi, 'access_token=***')
  .replace(/\bIG[A-Za-z0-9_-]{30,}/g, '***')
  .slice(0, 160)
const errMsg = (j: any) => safeErr(j?.error?.message || 'réponse vide')
// 20 s par appel Graph : un appel bloqué ne fait pas tomber toute la réponse.
const gfetch = (u: string) => fetch(u, { signal: AbortSignal.timeout(20000) })
const insightsUrl = (token: string, qs: string) => `${GRAPH}/me/insights?${qs}&access_token=${encodeURIComponent(token)}`
// Journal de diagnostic : forme des réponses Graph (chiffres agrégés du compte, jamais de jeton).
const logIg = (label: string, detail: unknown) => console.log(`[ig] ${label} ${safeErr(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}`)

// ── jours Instagram = jours calendaires à l'heure du Pacifique ──
const PT = 'America/Los_Angeles'
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit' })
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: PT, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const ptYmd = (ms: number) => ymdFmt.format(new Date(ms))                       // 'AAAA-MM-JJ'
function ptOffsetMs(ms: number): number {                                        // heure PT − heure UTC (négatif)
  const p: Record<string, string> = {}
  for (const x of partsFmt.formatToParts(new Date(ms))) p[x.type] = x.value
  return Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000
}
function ptMidnight(ymd: string): number {                                       // minuit PT de ce jour, en secondes
  const [y, m, d] = ymd.split('-').map(Number)
  const utc0 = Date.UTC(y, m - 1, d)
  let t = utc0 - ptOffsetMs(utc0)
  t = utc0 - ptOffsetMs(t)                                                        // recalé si l'heure d'été change
  return Math.floor(t / 1000)
}
const ymdAdd = (ymd: string, n: number) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }

// ── fenêtres ──
type Win = { since: number, until: number }
const RANGES = ['24h', '3j', '7j', '28j', '30j', '90j', '6m', 'all']
const SPAN_DAYS: Record<string, number> = { '3j': 3, '7j': 7, '30j': 30, '90j': 90, '6m': 183 }
const MAX_SPAN = 30 * 86400 - 60      // l'API plafonne une requête à 30 jours : on reste 1 min dessous
const MAX_DAYS = 730                   // l'API garde 2 ans d'historique
function dayList(first: string, last: string): string[] {
  const out: string[] = []
  for (let d = first; d <= last && out.length < MAX_DAYS; d = ymdAdd(d, 1)) out.push(d)
  return out
}

// Appel insights compte : 1 essai groupé, puis repli métrique par métrique (les métriques
// non supportées par la version/compte ne cassent pas les autres). Renvoie {name: value} + erreurs.
async function fetchAccountInsights(token: string, metrics: string[], win: Win) {
  const out: Record<string, number> = {}, errors: Record<string, string> = {}
  // Fenêtre RÉELLE via since/until : le param `period` seul est ignoré par total_value.
  const q = (ms: string[]) => insightsUrl(token, `metric=${ms.join(',')}&metric_type=total_value&period=day&since=${win.since}&until=${win.until}`)
  const parse = (j: any) => { if (Array.isArray(j?.data)) for (const m of j.data) { const tv = m.total_value?.value; if (typeof tv === 'number') out[m.name] = tv } }
  try {
    const j = await (await gfetch(q(metrics))).json()
    if (!j.error) parse(j)
    else {
      for (const m of metrics) {
        try { const jj = await (await gfetch(q([m]))).json(); if (jj.error) errors[m] = errMsg(jj); else parse(jj) } catch (e) { errors[m] = safeErr(e) }
      }
    }
  } catch (e) { for (const m of metrics) errors[m] = safeErr(e) }
  for (const m of metrics) if (!(m in out) && !(m in errors)) errors[m] = 'valeur absente de la réponse'
  return { out, errors }
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
// `breakdowns` = noms à essayer dans l'ordre (le 1er refusé, on tente le suivant).
// Répartition vide ({}) acceptée si le total vaut 0, ou si l'API renvoie la répartition demandée avec une
// liste de résultats VIDE et sans total (aucun événement : cas de follows_and_unfollows sur une journée calme).
// Vide avec un total > 0, ou sans aucune répartition = erreur, jamais un faux « 0 ».
// Instagram publie les abonnements avec ~1-2 jours de retard : pour une fenêtre sans données publiées, il renvoie la
// répartition demandée SANS aucune clé results → { pending: true } (ni 0, ni erreur : « pas encore publié »).
type Bk = { breakdown: string, total: number | null, parts: Record<string, number>, pending?: boolean }
async function breakdownOf(token: string, qs: string, breakdowns: string[], label?: string, pendingOk = false): Promise<Bk | { error: string }> {
  let last = 'réponse vide'
  for (const bd of breakdowns) {
    try {
      const j = await (await gfetch(insightsUrl(token, `${qs}&breakdown=${bd}`))).json()
      if (label) logIg(label + '/' + bd, j?.error ? { error: errMsg(j) } : j?.data?.[0]?.total_value ?? j)
      if (j?.error) { last = errMsg(j); continue }
      const tv = j?.data?.[0]?.total_value
      const b0 = tv?.breakdowns?.[0]
      const res = b0?.results
      const total = typeof tv?.value === 'number' ? tv.value : null
      const parts: Record<string, number> = {}
      if (Array.isArray(res)) for (const r of res) {
        const k = String(r?.dimension_values?.[0] ?? '').slice(0, 80)
        if (k && typeof r?.value === 'number') parts[k] = (parts[k] || 0) + r.value
      }
      if (Object.keys(parts).length || total === 0) return { breakdown: bd, total, parts }
      const sameKey = Array.isArray(b0?.dimension_keys) && b0.dimension_keys[0] === bd
      if (Array.isArray(res) && sameKey && total == null) return { breakdown: bd, total: null, parts: {} }
      if (pendingOk && res === undefined && sameKey && total == null) return { breakdown: bd, total: null, parts: {}, pending: true }
      last = total == null ? 'répartition absente de la réponse' : `répartition vide alors que le total vaut ${total}`
    } catch (e) { last = safeErr(e) }
  }
  return { error: last }
}

// ── profil ──
async function fetchProfile(token: string, out: Record<string, unknown>) {
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
}

// ── publications ──
const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count,is_shared_to_feed'
async function listMedia(token: string, fields: string, max: number): Promise<{ list: any[], error?: string, raw?: number }> {
  const list: any[] = []
  let next: string | null = `${GRAPH}/me/media?fields=${fields}&limit=${Math.min(100, max)}&access_token=${encodeURIComponent(token)}`
  try {
    for (let page = 0; next && page < 10 && list.length < max; page++) {
      const j: any = await (await gfetch(next)).json()
      if (j?.error) return { list, error: errMsg(j) }
      if (Array.isArray(j?.data)) list.push(...j.data)
      next = typeof j?.paging?.next === 'string' ? j.paging.next : null
    }
  } catch (e) { return { list, error: safeErr(e) } }
  const seen = new Set<string>()
  const uniq = list.filter((m) => { const id = String(m?.id || ''); if (!id || seen.has(id)) return false; seen.add(id); return true })
  return { list: uniq.slice(0, max), raw: list.length } as { list: any[], error?: string, raw?: number }
}
async function mediaInsights(token: string, m: any) {
  const isReel = (m.media_product_type === 'REELS') || (m.media_type === 'VIDEO')
  const metrics = ['reach', 'views', 'total_interactions', 'saved', 'shares']
  if (isReel) metrics.push('ig_reels_avg_watch_time')
  const mi: Record<string, number> = {}
  const read = (ji: any) => { if (Array.isArray(ji?.data)) for (const x of ji.data) { const v = x.values?.[0]?.value ?? x.total_value?.value; if (typeof v === 'number') mi[x.name] = v } }
  const [ji, js] = await Promise.all([
    gfetch(`${GRAPH}/${m.id}/insights?metric=${metrics.join(',')}&access_token=${encodeURIComponent(token)}`).then((r) => r.json()).catch(() => null),
    // « swipe < 3 s » (part des vues qui passent le reel dans les 3 premières secondes), reels seulement, appel à part
    isReel ? gfetch(`${GRAPH}/${m.id}/insights?metric=reels_skip_rate&access_token=${encodeURIComponent(token)}`).then((r) => r.json()).catch(() => null) : Promise.resolve(null),
  ])
  read(ji); read(js)
  return {
    id: m.id, permalink: m.permalink, thumbnail: m.thumbnail_url || m.media_url || null,
    media_type: m.media_product_type || m.media_type, caption: (m.caption || '').slice(0, 90), timestamp: m.timestamp,
    reach: mi.reach ?? null, views: mi.views ?? null,
    likes: m.like_count ?? null, comments: m.comments_count ?? null,
    saved: mi.saved ?? null, shares: mi.shares ?? null, interactions: mi.total_interactions ?? null,
    avg_watch_s: mi.ig_reels_avg_watch_time != null ? Math.round(mi.ig_reels_avg_watch_time / 100) / 10 : null, // ms → s
    skip_rate: mi.reels_skip_rate ?? null,   // brut : l'échelle (0-1 ou 0-100) est fixée pour toute la liste dans normSkip
    shared_to_feed: typeof m.is_shared_to_feed === 'boolean' ? m.is_shared_to_feed : null,
  }
}
// L'API dit seulement « percentage » : si AUCUNE valeur ne dépasse 1, ce sont des fractions → ×100. Journalisé.
function normSkip(list: any[]) {
  const vals = list.map((m) => m.skip_rate).filter((v) => typeof v === 'number')
  if (!vals.length) return
  const frac = Math.max(...vals) <= 1
  for (const m of list) if (typeof m.skip_rate === 'number') m.skip_rate = Math.round((frac ? m.skip_rate * 100 : m.skip_rate) * 10) / 10
  logIg('swipe', { n: vals.length, echelle: frac ? '0-1 → ×100' : '0-100', exemples: vals.slice(0, 4) })
}
async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>, deadline = Infinity) {
  let i = 0
  const worker = async () => { while (i < items.length && Date.now() < deadline) { const k = i++; await fn(items[k], k) } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}

// ── historique jour par jour (table ig_daily_insights) ──
const DAY_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_views', 'profile_links_taps', 'website_clicks']
const DAY_KEYS = [...DAY_METRICS, 'follows', 'unfollows']
type DayRow = { day: string, metrics: Record<string, number | null>, errors: Record<string, string> | null, final: boolean, fetched_at: string }

// Un jour : 1 appel groupé (métriques valides) + 1 appel follows_and_unfollows. `valid` = métriques que l'API
// accepte, apprises sur le 1er jour (un appel groupé refusé pour UNE métrique retombe métrique par métrique).
async function fetchDay(token: string, day: string, nowS: number, valid: Set<string>): Promise<Omit<DayRow, 'fetched_at'>> {
  const since = ptMidnight(day), until = Math.min(ptMidnight(ymdAdd(day, 1)), nowS)
  const metrics: Record<string, number | null> = {}, errors: Record<string, string> = {}
  for (const k of DAY_KEYS) metrics[k] = null
  const want = DAY_METRICS.filter((m) => valid.has(m))
  if (until <= since) return { day, metrics, errors: null, final: false }
  const [ins, fol] = await Promise.all([
    want.length ? fetchAccountInsights(token, want, { since, until }) : Promise.resolve({ out: {} as Record<string, number>, errors: {} as Record<string, string> }),
    breakdownOf(token, `metric=follows_and_unfollows&period=day&since=${since}&until=${until}&metric_type=total_value`, ['follow_type'], undefined, true),
  ])
  for (const m of want) { if (m in ins.out) metrics[m] = ins.out[m]; else errors[m] = ins.errors[m] || 'valeur absente' }
  for (const m of DAY_METRICS) if (!valid.has(m)) errors[m] = 'métrique refusée par l’API'
  let pending = false
  if ('error' in fol) { errors.follows = fol.error; errors.unfollows = fol.error }
  else if (fol.pending) pending = true   // pas encore publié par Instagram : null, relu plus tard (sans erreur)
  else { metrics.follows = fol.parts.FOLLOWER ?? 0; metrics.unfollows = fol.parts.NON_FOLLOWER ?? 0 }
  const endS = ptMidnight(ymdAdd(day, 1))
  const final = endS < nowS - 48 * 3600 && !Object.keys(errors).some((k) => valid.has(k) || k === 'follows')
    && (!pending || endS < nowS - 7 * 86400)
  return { day, metrics, errors: Object.keys(errors).length ? errors : null, final }
}

async function dailySeries(token: string, igId: string, days: string[], nowS: number, deadline: number) {
  const rows = new Map<string, DayRow>()
  if (!days.length) return { rows, missing: 0, fetched: 0 }
  const { data } = await svc.from('ig_daily_insights').select('day, metrics, errors, final, fetched_at')
    .eq('ig_id', igId).gte('day', days[0]).lte('day', days[days.length - 1])
  for (const r of (data || []) as DayRow[]) rows.set(String(r.day).slice(0, 10), r)
  const stale = (r?: DayRow) => !r || (!r.final && Date.now() - Date.parse(r.fetched_at) > 15 * 60 * 1000)
  const todo = days.filter((d) => stale(rows.get(d)))
  if (!todo.length) return { rows, missing: 0, fetched: 0 }
  // Métriques valides : apprises sur un 1er jour seul (évite N replis métrique par métrique en parallèle).
  const valid = new Set(DAY_METRICS)
  const probe = await fetchAccountInsights(token, DAY_METRICS, { since: ptMidnight(todo[0]), until: Math.min(ptMidnight(ymdAdd(todo[0], 1)), nowS) })
  for (const m of DAY_METRICS) if (/\(#100\)|invalid|must be one of|not supported|unsupported/i.test(probe.errors[m] || '')) valid.delete(m)
  if (valid.size < DAY_METRICS.length) logIg('series metriques refusees', DAY_METRICS.filter((m) => !valid.has(m)).map((m) => m + ': ' + probe.errors[m]))
  const fresh: Omit<DayRow, 'fetched_at'>[] = []
  let firstErr = ''
  await pool(todo, 8, async (d) => {
    const r = await fetchDay(token, d, nowS, valid)
    if (r.errors && !firstErr) firstErr = d + ' ' + JSON.stringify(r.errors)
    fresh.push(r)
  }, deadline)
  const at = new Date().toISOString()
  if (fresh.length) {
    const { error } = await svc.from('ig_daily_insights').upsert(fresh.map((r) => ({ ig_id: igId, ...r, fetched_at: at })), { onConflict: 'ig_id,day' })
    if (error) logIg('series upsert', error.message)
    for (const r of fresh) rows.set(r.day, { ...r, fetched_at: at })
  }
  logIg('series', { asked: days.length, fetched: fresh.length, left: todo.length - fresh.length, firstErr })
  return { rows, missing: days.filter((d) => !rows.has(d)).length, fetched: fresh.length }
}

// Somme d'une métrique additive sur les jours ; null + raison si un jour manque ou a refusé la métrique.
function sumDays(days: string[], rows: Map<string, DayRow>, k: string): { value: number } | { error: string } {
  let s = 0, missing = 0, err = ''
  for (const d of days) {
    const r = rows.get(d)
    if (!r) { missing++; continue }
    const v = r.metrics?.[k]
    if (typeof v === 'number') s += v
    else err = err || (r.errors?.[k] ? d + ' : ' + r.errors[k] : d + ' : valeur absente')
  }
  if (missing) return { error: `historique en cours de relevé (${missing} jour${missing > 1 ? 's' : ''} manquant${missing > 1 ? 's' : ''})` }
  if (err) return { error: 'jour refusé par l’API · ' + err }
  return { value: s }
}

// Répartitions d'une fenêtre ≤ 30 jours, en parallèle. Chaque clé absente de la sortie a son erreur dans errors.
async function fetchWindowParts(token: string, win: Win, log: boolean) {
  const w = `period=day&since=${win.since}&until=${win.until}&metric_type=total_value`
  const [follows, byType, byFollower, bio] = await Promise.all([
    breakdownOf(token, `metric=follows_and_unfollows&${w}`, ['follow_type'], log ? 'follows' : undefined, true),
    breakdownOf(token, `metric=views&${w}`, ['media_product_type']),
    breakdownOf(token, `metric=views&${w}`, ['follower_type', 'follow_type']),
    singleTotal(token, 'website_clicks', win),
  ])
  const out: Record<string, unknown> = {}, errors: Record<string, string> = {}
  const put = (key: string, r: any) => { if (r && 'error' in r) errors[key] = r.error; else out[key] = r }
  if (follows && !('error' in follows) && follows.pending) out.follows_pending = true
  else put('follows', follows)
  put('views_by_type', byType); put('views_by_follower', byFollower)
  if ('error' in bio) errors.website_clicks = bio.error; else out.website_clicks = bio.value
  return { out, errors }
}

// Vues par type / par abonnés sur une fenêtre > 30 jours : somme de tranches ≤ 30 jours qui se suivent sans se
// chevaucher (les vues s'additionnent). Une tranche refusée = répartition entière en erreur (jamais partielle).
async function chunkedViewsParts(token: string, win: Win) {
  const chunks: Win[] = []
  for (let s = win.since; s < win.until; s += MAX_SPAN) chunks.push({ since: s, until: Math.min(s + MAX_SPAN, win.until) })
  const acc = async (bds: string[]): Promise<Bk | { error: string }> => {
    const parts: Record<string, number> = {}
    let used = ''
    for (const c of chunks) {
      const r = await breakdownOf(token, `metric=views&period=day&since=${c.since}&until=${c.until}&metric_type=total_value`, used ? [used] : bds)
      if ('error' in r) return { error: r.error }
      used = r.breakdown
      for (const [k, v] of Object.entries(r.parts)) parts[k] = (parts[k] || 0) + v
    }
    return { breakdown: used, total: null, parts }
  }
  const [byType, byFollower] = await Promise.all([acc(['media_product_type']), acc(['follower_type', 'follow_type'])])
  return { byType, byFollower }
}

// ── module de chaque publication (ig_media_tags) + étiquetage donné par rang, appliqué une fois ──
async function applyTags(list: any[]) {
  if (!list.length) return
  try {
    // Étiquetage par rang donné il y a MOINS de 48 h seulement : plus tard, l'ordre du top a pu changer.
    const { data: pend } = await svc.from('ig_media_tag_rank_pending').select('rank, module').gt('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString()).order('rank')
    if (pend && pend.length) {
      // Même ordre que le top du dashboard : publications avec des vues, triées par vues décroissantes (tri stable).
      const top = list.filter((m) => m.views != null).slice().sort((a, b) => b.views - a.views)
      const rows = pend.map((p: any) => ({ p, m: top[p.rank - 1] })).filter((x) => x.m)
      if (rows.length) {
        const { data: already } = await svc.from('ig_media_tags').select('ig_media_id').in('ig_media_id', rows.map((x) => String(x.m.id)))
        const has = new Set((already || []).map((r: any) => String(r.ig_media_id)))
        const ins = rows.filter((x) => !has.has(String(x.m.id))).map((x) => ({ ig_media_id: String(x.m.id), module: x.p.module }))
        if (ins.length) await svc.from('ig_media_tags').insert(ins)
        await svc.from('ig_media_tag_rank_pending').delete().in('rank', rows.map((x) => x.p.rank))
        logIg('tags par rang', rows.map((x) => ({ rang: x.p.rank, module: x.p.module, id: x.m.id, vues: x.m.views, le: String(x.m.timestamp || '').slice(0, 10) })))
      }
    }
    const { data } = await svc.from('ig_media_tags').select('ig_media_id, module').in('ig_media_id', list.map((m) => String(m.id)))
    const byId = new Map((data || []).map((r: any) => [String(r.ig_media_id), r.module]))
    for (const m of list) m.module = byId.get(String(m.id)) ?? null
  } catch (e) { logIg('tags', safeErr(e)) }
}

// ── compteur d'abonnés, un relevé par jour Instagram (le dernier de la journée) ──
async function snapFollowers(igId: string, followers: unknown) {
  if (!igId || typeof followers !== 'number') return
  try {
    await svc.from('ig_followers_daily').upsert({ ig_id: igId, day: ptYmd(Date.now()), followers, captured_at: new Date().toISOString() }, { onConflict: 'ig_id,day' })
  } catch { /* best-effort */ }
}
async function followersOn(igId: string, day: string): Promise<{ day: string, followers: number } | null> {
  try {
    const { data } = await svc.from('ig_followers_daily').select('day, followers').eq('ig_id', igId).eq('day', day).maybeSingle()
    return data && typeof data.followers === 'number' ? { day: String(data.day).slice(0, 10), followers: data.followers } : null
  } catch { return null }
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
  const t0 = Date.now()
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
  const part = url.searchParams.get('part') || ''

  // Audience seule : 4 appels, rechargée à part (elle ne dépend pas de la fenêtre).
  if (part === 'audience') {
    const a = await fetchAudience(token)
    return json({ ig_id: igId, part: 'audience', audience: a.audience, audience_errors: a.errors })
  }

  // Publications : profil + toutes les publications (≤ 200, dédoublonnées) avec leurs chiffres à vie et leur module.
  if (part === 'media') {
    out.part = 'media'
    await fetchProfile(token, out)
    const lm = await listMedia(token, MEDIA_FIELDS, 200)
    if (lm.error) out.media_error = lm.error
    const media: any[] = new Array(lm.list.length)
    await pool(lm.list, 8, async (m, i) => { media[i] = await mediaInsights(token, m) })
    const list = media.filter(Boolean)
    normSkip(list)
    await applyTags(list)
    out.media = list
    out.media_total = list.length
    const types: Record<string, number> = {}
    for (const m of list) types[m.media_type || '?'] = (types[m.media_type || '?'] || 0) + 1
    const notOnFeed = list.filter((m) => m.shared_to_feed === false).length
    logIg('media', { raw: lm.raw, unique: list.length, media_count: out.media_count, types, pas_sur_la_grille: notOnFeed })
    await snapFollowers(igId, out.followers_count)
    return json(out)
  }

  // 1) profil (basic)
  await fetchProfile(token, out)
  await snapFollowers(igId, out.followers_count)

  // 2) insights compte. range renvoyée = celle APPLIQUÉE (une valeur inconnue repasse en 24h) : le dashboard
  //    compare avec sa demande. Sans range : 28j glissants + top posts, ce qu'attend factory.html (v1).
  const legacy = !url.searchParams.has('range')
  const asked = url.searchParams.get('range') || '28j'
  const range = RANGES.includes(asked) ? asked : '24h'
  out.range = range
  const nowS = Math.floor(Date.now() / 1000)
  const today = ptYmd(nowS * 1000)
  let win: Win, days: string[] = []
  if (range === '24h' || range === '28j') {
    win = { since: nowS - (range === '28j' ? 28 : 1) * 86400, until: nowS }
  } else {
    let first: string
    if (range === 'all') {
      // Depuis la 1re publication (l'API garde 2 ans au plus).
      const lm = await listMedia(token, 'id,timestamp', 200)
      const ts = lm.list.map((m) => Date.parse(m.timestamp)).filter((t) => isFinite(t))
      first = ts.length ? ptYmd(Math.min(...ts)) : today
      if (lm.error) out.media_error = lm.error
      const floor = ymdAdd(today, -(MAX_DAYS - 1))
      if (first < floor) first = floor
    } else {
      first = ymdAdd(today, -(SPAN_DAYS[range] - 1))
    }
    days = dayList(first, today)
    win = { since: ptMidnight(first), until: nowS }
    // Net exact d'abonnés : compteur d'aujourd'hui − compteur relevé la veille du 1er jour (si on l'a déjà relevé).
    const base = await followersOn(igId, ymdAdd(first, -1))
    if (base) out.followers_base = base
  }
  out.since = win.since
  out.until = win.until
  out.day_first = days[0] ?? null
  out.day_last = days[days.length - 1] ?? null

  // Totaux et répartitions demandés DIRECTEMENT à l'API sur toute la fenêtre : mesuré le 24/09, elle répond aussi
  // au-delà de 30 jours (reach 6 mois = 13 407). Si elle refusait une métrique sur une longue fenêtre, repli = somme
  // des jours pour les métriques additives (jamais pour reach / comptes engagés, comptes UNIQUES).
  const long = win.until - win.since > MAX_SPAN + 3600
  const w: Win = long ? win : { since: Math.max(win.since, win.until - MAX_SPAN), until: win.until }
  const METRICS = ['reach', 'views', 'profile_views', 'accounts_engaged', 'profile_links_taps', 'total_interactions']
  const deadline = t0 + (long ? 50000 : 45000)
  const [ins, parts, series] = await Promise.all([
    fetchAccountInsights(token, METRICS, w),
    fetchWindowParts(token, w, !legacy),
    days.length ? dailySeries(token, igId, days, nowS, deadline) : Promise.resolve(null),
  ])
  if (long && series) {
    for (const m of ['views', 'profile_views', 'profile_links_taps', 'total_interactions']) {
      if (m in ins.out) continue
      const r = sumDays(days, series.rows, m)
      if (!('error' in r)) { ins.out[m] = r.value; delete ins.errors[m] }
    }
    if (!('website_clicks' in parts.out)) {
      const r = sumDays(days, series.rows, 'website_clicks')
      if (!('error' in r)) { parts.out.website_clicks = r.value; delete parts.errors.website_clicks }
    }
    if (!('views_by_type' in parts.out) || !('views_by_follower' in parts.out)) {
      const v = await chunkedViewsParts(token, win)
      if (!('views_by_type' in parts.out) && !('error' in v.byType)) { parts.out.views_by_type = v.byType; delete parts.errors.views_by_type }
      if (!('views_by_follower' in parts.out) && !('error' in v.byFollower)) { parts.out.views_by_follower = v.byFollower; delete parts.errors.views_by_follower }
    }
  }
  // Note : Meta écrit « User Metrics data is stored for up to 90 days », mais l'API a renvoyé le 24/09 des jours de
  // mars à juin (86-182 jours) non nuls et des totaux directs sur 6 mois : on garde les totaux directs. Si un jour
  // elle tronquait, le repli ci-dessus (somme de NOTRE historique) ne s'applique qu'aux métriques qu'elle refuse.
  // Abonnements : jours de la fenêtre pas encore publiés par Instagram (~2 jours de retard) → compte à part, affiché.
  if (series && 'follows' in parts.out) {
    const n = days.filter((d) => { const r = series.rows.get(d); return !r || (r.metrics?.follows == null && !r.errors?.follows) }).length
    if (n) out.follows_pending_days = n
  }
  out.insights = ins.out
  Object.assign(out, parts.out)
  out.part_errors = { ...parts.errors, ...Object.fromEntries(Object.entries(ins.errors).map(([k, v]) => ['insights.' + k, v])) }
  if (series) out.series = { days: days.map((d) => ({ d, ...(series.rows.get(d)?.metrics || {}) })), missing: series.missing, complete: series.missing === 0 }

  // 3) v1 seulement : top 5 (en vues) des 12 dernières publications. Le v2 lit ?part=media.
  if (legacy) {
    try {
      const lm = await listMedia(token, MEDIA_FIELDS, 12)
      if (lm.error) out.media_error = lm.error
      const enriched = await Promise.all(lm.list.map((m) => mediaInsights(token, m)))
      enriched.sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))
      out.top_posts = enriched.slice(0, 5)
    } catch (e) { out.top_posts_error = safeErr(e) }
  }
  logIg('done ' + (part || range), { ms: Date.now() - t0 })
  return json(out)
})
