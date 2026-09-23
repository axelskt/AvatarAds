// Follow-up Auto-DM — AvatarAds
//  Relance les leads qui ont reçu le lien mais NE l'ont PAS cliqué (dans la fenêtre 12–22h,
//  donc encore dans la fenêtre de messagerie 24h). Appelé par un cron horaire (pg_cron → net.http_post).
//  Idempotent : dédup via kind='relance'. verify_jwt=false (déclencheur cron). Optionnel : ?key=IG_CRON_SECRET.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DEFAULT_DEST, trackedLink } from '../_shared/iglink.ts'

const GRAPH   = 'https://graph.instagram.com/v21.0'
const SB_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)

async function accountToken(igId: string): Promise<string | null> {
  const { data } = await svc.from('ig_accounts').select('access_token').eq('ig_id', igId).single()
  if (data?.access_token) return data.access_token
  return Deno.env.get('IG_TOKEN') || null
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const need = Deno.env.get('IG_CRON_SECRET')
  if (need && url.searchParams.get('key') !== need) return new Response('forbidden', { status: 403 })

  const { data } = await svc.rpc('ig_followup_candidates')
  const cands = Array.isArray(data) ? data : []
  let sent = 0
  for (const c of cands) {
    const igId = String(c.ig_id || '')
    const sender = String(c.sender_id || '')
    if (!sender) continue
    const token = await accountToken(igId)
    if (!token) continue
    const dest = await trackedLink(igId, sender, DEFAULT_DEST)   // lien signé (_shared/iglink.ts)
    const text = "Petit rappel — tu n'as pas encore ouvert le lien 👀 Le voici : " + dest
    const r = await fetch(`${GRAPH}/me/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: sender }, message: { text } }),
    })
    if (r.ok) {
      await svc.from('ig_dm_log').insert({ ig_id: igId || null, sender_id: sender, kind: 'relance' })
      sent++
    } else {
      console.log('[ig-followup] send fail', r.status, (await r.text()).slice(0, 200))
    }
  }
  return new Response(JSON.stringify({ ok: true, candidates: cands.length, sent }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
