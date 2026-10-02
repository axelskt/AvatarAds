// Follow-up Auto-DM — AvatarAds
//  Relance les leads qui ont reçu le lien mais NE l'ont PAS cliqué (dans la fenêtre 12–22h,
//  donc encore dans la fenêtre de messagerie 24h). Appelé par un cron horaire (pg_cron → net.http_post).
//  Idempotent : dédup via kind='relance'. verify_jwt=false (déclencheur cron).
//  Audit 02/10 : ÉCHEC FERMÉ — en-tête x-cron-key = CRON_SECRET obligatoire (comparé en temps constant), comme
//  reconcile-kie. Avant, la clé n'était vérifiée que si IG_CRON_SECRET existait (absent en prod) → n'importe qui
//  déclenchait les relances, et des appels simultanés envoyaient la même relance plusieurs fois. + verrou : un seul
//  passage toutes les 5 min (rate_events), donc jamais deux envois concurrents.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DEFAULT_DEST, trackedLink } from '../_shared/iglink.ts'
import { accountToken as tokenOf } from '../_shared/igacct.ts'
import { rateHit, timingSafeEqual } from '../_shared/guard.ts'

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

const GRAPH   = 'https://graph.instagram.com/v21.0'
const SB_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)

// Token du compte qui a envoyé le lien (ig_dm_log.ig_id = id professionnel) : _shared/igacct.ts (28/09 : 2 comptes).
const accountToken = (igId: string) => tokenOf(svc, igId)

Deno.serve(async (req) => {
  if (!CRON_SECRET) return new Response('misconfigured', { status: 500 })
  if (!timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)) return new Response('forbidden', { status: 403 })
  if (!(await rateHit('ig-followup:run', 300, 1))) return new Response(JSON.stringify({ ok: true, skipped: 'déjà lancé' }), { status: 200, headers: { 'Content-Type': 'application/json' } })

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
