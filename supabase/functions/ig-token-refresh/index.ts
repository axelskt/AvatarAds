// ig-token-refresh — renouvelle les tokens Instagram de NOS comptes avant qu'ils n'expirent (13/10, Axel).
// Un token long d'Instagram vit 60 jours ; sans renouvellement, l'auto-DM (« Commente CLAUDE » → lien en DM), la relance
// et les insights s'arrêtent net, sans erreur visible (le 1er expirait le 21/11). Instagram le prolonge de 60 jours via
// GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token, à condition qu'il ait plus de 24 h et ne soit
// pas encore expiré. Déclenché chaque jour par pg_cron (POST + x-cron-key = CRON_SECRET) :
//   • renouvelle chaque compte de OWN_USERNAMES (jamais un compte relié par un tiers / le reviewer Meta) dont le token
//     expire dans moins de 30 jours ;
//   • échec → e-mail à Axel si l'expiration est à moins de 10 jours (au plus un par jour : le cron ne passe qu'une fois),
//     avec le geste de secours : « Connecter » le compte depuis le dashboard Creative Factory.
// Le token n'apparaît jamais dans une réponse ni dans un log.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OWN_USERNAMES } from '../_shared/igacct.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = 'AvatarAds <bonjour@avatarads.fr>'
const TO   = 'axel@iamanager.fr'
const DAY = 86400000
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
const masque = (s: string) => s.replace(/access_token=[^&\s"'<>]*/gi, 'access_token=***').slice(0, 200)

type Row = { ig_id: string; username: string | null; access_token: string | null; token_expires_at: string | null; updated_at: string | null }
type Res = { username: string; action: 'renouvele' | 'pas_encore' | 'echec'; expire_le: string | null; detail?: string }

async function alerte(echecs: Res[]) {
  if (!RESEND_KEY || !echecs.length) return
  const lignes = echecs.map((e) => `<li><b>@${e.username}</b> — expire le ${e.expire_le ? new Date(e.expire_le).toLocaleDateString('fr-FR') : '?'} (${e.detail || 'refus Instagram'})</li>`).join('')
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px">
    <p>Le renouvellement automatique du token Instagram a échoué :</p><ul>${lignes}</ul>
    <p>À l'expiration, l'auto-DM s'arrête : les personnes qui commentent « CLAUDE » ne reçoivent plus le lien.</p>
    <p><b>Pour réparer</b> : ouvre le dashboard Creative Factory, connecte-toi à Instagram avec le compte concerné, puis clique « Connecter » sur sa carte. Le nouveau token repart pour 60 jours et sera ensuite renouvelé tout seul.</p></div>`
  await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [TO], subject: `Instagram : token à renouveler (${echecs.map((e) => '@' + e.username).join(', ')})`, html }) }).catch(() => {})
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!CRON_SECRET || !timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)) return json({ error: 'forbidden' }, 403)
  let force = false
  try { const b = await req.json(); force = !!(b && b.force === true) } catch { /* corps optionnel */ }

  const { data, error } = await svc.from('ig_accounts').select('ig_id, username, access_token, token_expires_at, updated_at')
  if (error) return json({ error: 'lecture', detail: error.message }, 500)
  const out: Res[] = []
  for (const a of (data || []) as Row[]) {
    const u = String(a.username || '').toLowerCase()
    if (!OWN_USERNAMES.includes(u) || !a.access_token) continue
    const exp = a.token_expires_at ? Date.parse(a.token_expires_at) : 0
    const age = a.updated_at ? Date.now() - Date.parse(a.updated_at) : Infinity
    // Instagram refuse un token de moins de 24 h ; au-delà de 30 jours restants, rien à faire.
    if (age < DAY || (!force && exp && exp - Date.now() > 30 * DAY)) { out.push({ username: u, action: 'pas_encore', expire_le: a.token_expires_at }); continue }
    try {
      const r = await fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(a.access_token), { signal: AbortSignal.timeout(20000) })
      const j = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } }
      if (!r.ok || !j.access_token || !(Number(j.expires_in) > 0)) {
        out.push({ username: u, action: 'echec', expire_le: a.token_expires_at, detail: masque(String(j.error?.message || `HTTP ${r.status}`)) }); continue
      }
      const nouvelle = new Date(Date.now() + Number(j.expires_in) * 1000).toISOString()
      const { error: e } = await svc.from('ig_accounts').update({ access_token: j.access_token, token_expires_at: nouvelle, updated_at: new Date().toISOString() }).eq('ig_id', a.ig_id)
      out.push(e ? { username: u, action: 'echec', expire_le: a.token_expires_at, detail: 'écriture : ' + e.message } : { username: u, action: 'renouvele', expire_le: nouvelle })
    } catch (e) { out.push({ username: u, action: 'echec', expire_le: a.token_expires_at, detail: masque(String((e as Error)?.message || e)) }) }
  }
  const urgents = out.filter((x) => x.action === 'echec' && (!x.expire_le || Date.parse(x.expire_le) - Date.now() < 10 * DAY))
  await alerte(urgents)
  console.log('[ig-token-refresh]', JSON.stringify(out))
  return json({ ok: true, comptes: out, alertes: urgents.length })
})
