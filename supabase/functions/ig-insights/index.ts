// Insights compte Instagram — AvatarAds (utilise instagram_business_manage_insights)
//  GET ?ig_id=... (ou 1er compte connecté) → renvoie followers, publications + insights (reach…).
//  Sert à alimenter la section « Insights du compte » du dashboard (dev/owner). verify_jwt=false.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GRAPH   = 'https://graph.instagram.com/v21.0'
const SB_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function accountToken(igId: string): Promise<string | null> {
  const { data } = await svc.from('ig_accounts').select('access_token').eq('ig_id', igId).single()
  if (data?.access_token) return data.access_token
  return Deno.env.get('IG_TOKEN') || null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  let igId = url.searchParams.get('ig_id') || ''
  if (!igId) {
    const { data } = await svc.from('ig_accounts').select('ig_id').order('updated_at', { ascending: false }).limit(1)
    igId = data?.[0]?.ig_id || ''
  }
  const token = await accountToken(igId)
  if (!token) return json({ error: 'aucun compte connecté / token' }, 400)

  const out: Record<string, unknown> = { ig_id: igId }
  // compte (basic)
  try {
    const r = await fetch(`${GRAPH}/me?fields=username,followers_count,media_count&access_token=${token}`)
    const j = await r.json()
    out.username = j.username ?? null
    out.followers_count = j.followers_count ?? null
    out.media_count = j.media_count ?? null
    if (j.error) out.basic_error = j.error?.message
  } catch (e) { out.basic_error = String(e) }

  // insights (reach) — on essaie plusieurs formats, on garde le 1er qui marche
  const variants = [
    'metric=reach&period=days_28&metric_type=total_value',
    'metric=reach&period=day&metric_type=total_value',
    'metric=reach,profile_views&period=day',
  ]
  for (const q of variants) {
    try {
      const r = await fetch(`${GRAPH}/me/insights?${q}&access_token=${token}`)
      const j = await r.json()
      if (!j.error && Array.isArray(j.data) && j.data.length) {
        const vals: Record<string, number> = {}
        for (const m of j.data) {
          const tv = m.total_value?.value
          const ts = m.values?.[m.values.length - 1]?.value
          vals[m.name] = (typeof tv === 'number' ? tv : (typeof ts === 'number' ? ts : 0))
        }
        out.insights = vals
        out.insights_query = q
        break
      } else if (j.error) { out.insights_error = j.error?.message }
    } catch (e) { out.insights_error = String(e) }
  }
  return json(out)
})
