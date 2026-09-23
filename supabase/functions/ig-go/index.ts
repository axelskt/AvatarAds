// Tracker de clics Auto-DM — AvatarAds
//  GET ?u=<igsid>&ig=<ig_id>&s=<signature>&to=<dest> : logge un clic (kind='click') dans ig_dm_log
//  puis 302 vers la destination. Le lien envoyé dans le DM pointe sur avatarads.fr/r.html (joli, notre
//  domaine) qui appelle ceci en sendBeacon (?log=1).
//  - Destination en liste blanche (safeDest) : plus de redirection ouverte.
//  - Clic enregistré seulement si la signature s est valide (lien réellement envoyé par nos DM).
//    Liens envoyés AVANT la signature (23/09/2026, sans s) : clic accepté seulement si ce sender_id a
//    vraiment reçu un lien ('link' ou 'relance').
// verify_jwt=false (lien public cliqué par le lead). ig_dm_log reste verrouillé (service role ici).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { safeDest, verifyClick } from '../_shared/iglink.ts'

const SB_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

async function clickAllowed(u: string, ig: string, s: string): Promise<boolean> {
  if (s) return verifyClick(u, ig, s)
  const { data } = await svc.from('ig_dm_log').select('id').eq('sender_id', u).in('kind', ['link', 'relance']).limit(1)
  return !!data?.length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const u  = url.searchParams.get('u') || ''
  const ig = url.searchParams.get('ig') || ''
  const s  = url.searchParams.get('s') || ''
  const to = safeDest(url.searchParams.get('to'))
  if (u) {
    try {
      if (await clickAllowed(u, ig, s)) await svc.from('ig_dm_log').insert({ ig_id: ig || null, sender_id: u, kind: 'click' })
    } catch (_) { /* non bloquant : la redirection passe quand même */ }
  }
  // Appelé en sendBeacon par r.html → 200 (la redirection est faite par la page). Un GET direct redirige.
  const wantsJson = (req.headers.get('accept') || '').includes('application/json') || url.searchParams.get('log') === '1'
  if (wantsJson) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  return new Response(null, { status: 302, headers: { ...CORS, Location: to } })
})
