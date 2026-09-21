// Tracker de clics Auto-DM — AvatarAds
//  GET ?u=<igsid>&ig=<ig_id> : logge un clic (kind='click') dans ig_dm_log puis 302 vers la destination.
//  Le lien envoyé dans le DM pointe sur avatarads.fr/r.html (joli, notre domaine) qui appelle ceci.
// verify_jwt=false (lien public cliqué par le lead). ig_dm_log reste verrouillé (service role ici).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEST    = 'https://avatarads.fr'
const SB_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const u  = url.searchParams.get('u') || ''
  const ig = url.searchParams.get('ig') || ''
  let to = url.searchParams.get('to') || DEST
  try { const t = new URL(to); if (!/^https?:$/.test(t.protocol)) to = DEST } catch { to = DEST }   // anti open-redirect
  if (u) { try { await svc.from('ig_dm_log').insert({ ig_id: ig || null, sender_id: u, kind: 'click' }) } catch (_) { /* non bloquant */ } }
  // Appelé en fetch par r.html → on répond 200 (le redirect est fait côté page). Un GET direct redirige quand même.
  const wantsJson = (req.headers.get('accept') || '').includes('application/json') || url.searchParams.get('log') === '1'
  if (wantsJson) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
  return new Response(null, { status: 302, headers: { ...CORS, Location: to } })
})
