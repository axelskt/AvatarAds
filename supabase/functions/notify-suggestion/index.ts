// Supabase Edge Function — notification e-mail des Suggestions / Bug reports (Resend)
// Le formulaire « Suggestion / Report Bug » du Générateur poste ici → e-mail à Axel.
// Auth : utilisateur connecté requis (anti-spam). from = domaine vérifié avatarads.fr.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = 'AvatarAds <bonjour@avatarads.fr>'
const TO   = 'axel@iamanager.fr'

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

  // ── Auth : session utilisateur valide obligatoire (anti-spam vers la boîte d'Axel) ──
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: { user }, error: authErr } = await sb.auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  if (!RESEND_API_KEY) return json({ ok: true, skipped: 'RESEND_API_KEY manquant' })

  let body: any = {}
  try { body = await req.json() } catch { /* ignore */ }
  const title = String(body.title || '(sans titre)').slice(0, 200)
  const desc  = String(body.description || body.desc || '').slice(0, 6000)
  const who   = String(body.user || user.email || 'Membre').slice(0, 120)
  const date  = String(body.date || '').slice(0, 60)

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#111">
    <h2 style="margin:0 0 10px">💡 Suggestion / Bug — AvatarAds</h2>
    <p style="margin:0 0 4px"><b>De :</b> ${esc(who)} &lt;${esc(user.email || '')}&gt;</p>
    ${date ? `<p style="margin:0 0 4px"><b>Date :</b> ${esc(date)}</p>` : ''}
    <p style="margin:12px 0 4px"><b>Titre :</b> ${esc(title)}</p>
    <div style="margin:0;padding:12px 14px;background:#f6f6f6;border-radius:8px;white-space:pre-wrap">${esc(desc) || '(pas de description)'}</div>
  </div>`

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      reply_to: user.email || undefined,
      subject: `💡 Suggestion AvatarAds — ${title}`.slice(0, 120),
      html,
    }),
  })
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 300)
    console.error('Resend', r.status, detail)
    return json({ error: 'resend ' + r.status, detail }, 502)
  }
  return json({ ok: true })
})
