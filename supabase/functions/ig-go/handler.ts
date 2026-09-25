// Tracker de clics Auto-DM + attribution des inscriptions — AvatarAds
//  GET ?u=<igsid>&ig=<ig_id>&s=<signature>&to=<dest> : logge un clic (kind='click') dans ig_dm_log
//  puis 302 vers la destination. Le lien envoyé dans le DM pointe sur avatarads.fr/r.html (joli, notre
//  domaine) qui appelle ceci (?log=1) et lit la réponse JSON.
//  - Destination en liste blanche (safeDest) : plus de redirection ouverte.
//  - Clic enregistré seulement si la signature s est valide (lien réellement envoyé par nos DM).
//    Liens envoyés AVANT la signature (23/09/2026, sans s) : clic accepté seulement si ce sender_id a
//    vraiment reçu un lien ('link' ou 'relance').
//  - Attribution (Axel 25/09) : un clic enregistré renvoie une RÉFÉRENCE CHIFFRÉE du lead (_shared/leadref.ts,
//    jamais l'identifiant Instagram en clair) : { ok, ref } en JSON pour r.html, qui la garde 30 jours dans le
//    navigateur. Le 302 direct (aucun DM ne l'utilise : tous les liens passent par r.html) ne transporte JAMAIS de
//    référence : une référence lisible dans une URL permettrait à n'importe qui d'en déposer une dans le navigateur
//    d'un autre (lien avatarads.fr/?…=<sa ref>) et de relier le compte de cette personne à son propre lead.
//  POST ?action=attach (Authorization: Bearer <session de l'utilisateur>, corps { ref }) : l'app renvoie la référence
//    une fois connecté ; elle est vérifiée puis le compte est relié au lead (RPC ig_lead_attach, 1re attribution
//    seulement, idempotent). Référence forgée / expirée / d'un autre projet : 200 { attached:false }, rien d'écrit.
// verify_jwt=false (lien public cliqué par le lead ; la session de /attach est vérifiée ICI auprès de l'auth).
// ig_dm_log et ig_lead_links restent verrouillés (service role ici).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { safeDest, verifyClick } from '../_shared/iglink.ts'
import { mintLeadRef, openLeadRef } from '../_shared/leadref.ts'

const SB_URL  = Deno.env.get('SUPABASE_URL') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function clickAllowed(u: string, ig: string, s: string): Promise<boolean> {
  if (s) return verifyClick(u, ig, s)
  const { data } = await svc.from('ig_dm_log').select('id').eq('sender_id', u).in('kind', ['link', 'relance']).limit(1)
  return !!data?.length
}

function bearer(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
}
function tokenRole(token: string): string {
  try {
    const p = token.split('.')[1] || ''
    const b = p.replace(/-/g, '+').replace(/_/g, '/')
    return String(JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4)))?.role || '')
  } catch { return '' }
}

async function attach(req: Request): Promise<Response> {
  const token = bearer(req)
  if (!token || tokenRole(token) !== 'authenticated') return json(401, { ok: false, error: 'auth' })
  let userId = ''
  try {
    const { data, error } = await svc.auth.getUser(token)
    if (error || !data?.user?.id) return json(401, { ok: false, error: 'auth' })
    userId = data.user.id
  } catch { return json(503, { ok: false, error: 'auth_unavailable' }) }
  const raw = await req.text().catch(() => '')
  if (raw.length > 2000) return json(400, { ok: false, attached: false, error: 'body' })
  let ref: unknown = null
  try { ref = JSON.parse(raw || '{}')?.ref } catch { /* corps illisible → référence invalide */ }
  const opened = await openLeadRef(ref)
  if (!opened.ok) {
    if (opened.reason === 'unconfigured') { console.error('[ig-go] attach : aucun secret de référence configuré'); return json(503, { ok: false, error: 'unconfigured' }) }
    console.log('[ig-go] attach refusé :', opened.reason)
    return json(200, { ok: true, attached: false, reason: 'invalid' })   // silencieux côté utilisateur
  }
  try {
    const { data, error } = await svc.rpc('ig_lead_attach', {
      p_user: userId, p_sender: opened.ref.sender, p_clicked_at: new Date(opened.ref.clickedAt).toISOString(),
    })
    if (error || !data || typeof data !== 'object') {
      console.error('[ig-go] ig_lead_attach :', error?.message || 'réponse vide')
      return json(503, { ok: false, error: 'db' })   // l'app réessaiera à la prochaine ouverture
    }
    const d = data as { ok?: boolean; attached?: boolean; reason?: string }
    if (!d.ok) return json(200, { ok: true, attached: false, reason: 'invalid' })
    return json(200, { ok: true, attached: !!d.attached, ...(d.attached ? {} : { reason: 'already' }) })
  } catch (e) {
    console.error('[ig-go] ig_lead_attach exception :', (e as Error)?.message)
    return json(503, { ok: false, error: 'db' })
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  if (req.method === 'POST' && url.searchParams.get('action') === 'attach') return attach(req)
  const u  = url.searchParams.get('u') || ''
  const ig = url.searchParams.get('ig') || ''
  const s  = url.searchParams.get('s') || ''
  const to = safeDest(url.searchParams.get('to'))
  // Appelé par r.html (fetch, ou sendBeacon des anciennes pages) → 200 JSON (la redirection est faite par la page).
  // Un GET direct redirige, sans référence.
  const wantsJson = (req.headers.get('accept') || '').includes('application/json') || url.searchParams.get('log') === '1'
  let ref: string | null = null
  if (u) {
    try {
      if (await clickAllowed(u, ig, s)) {
        const clickedAt = Date.now()
        const { error } = await svc.from('ig_dm_log').insert({ ig_id: ig || null, sender_id: u, kind: 'click' })
        // Référence seulement pour un clic ENREGISTRÉ (un compte relié a donc toujours un clic dans ig_dm_log), et
        // seulement dans la réponse JSON lue par r.html (seule page qui l'écrit dans le navigateur).
        if (!error && wantsJson) ref = await mintLeadRef(u, clickedAt)
      }
    } catch (_) { /* non bloquant : la redirection passe quand même */ }
  }
  if (wantsJson) return json(200, ref ? { ok: true, ref } : { ok: true })
  return new Response(null, { status: 302, headers: { ...CORS, Location: to } })
}
