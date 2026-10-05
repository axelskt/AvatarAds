import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Webhook Resend → statistiques des e-mails (06/10/2026) ──
// Resend appelle cette fonction à chaque événement (délivré, ouvert, cliqué, rebond, plainte, retard).
// On ne garde un événement QUE si son identifiant Resend existe dans email_log.resend_id (un envoi fait par
// email-drip ou whop-webhook) : un appel forgé ne peut donc rien créer d'autre qu'une ligne pour un de nos envois.
// Une ligne par type et par envoi (unique resend_id + type) → la vue email_stats compte des destinataires uniques.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TYPES: Record<string, string> = {
  'email.delivered': 'delivered', 'email.opened': 'opened', 'email.clicked': 'clicked',
  'email.bounced': 'bounced', 'email.complained': 'complained', 'email.delivery_delayed': 'delivery_delayed',
}
const ok = (o: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: true, ...o }), { status: 200, headers: { 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await req.text()
  if (raw.length > 20_000) return new Response('Too large', { status: 413 })
  let ev: { type?: string; created_at?: string; data?: { email_id?: string; click?: { link?: string } } }
  try { ev = JSON.parse(raw) } catch { return new Response('Bad JSON', { status: 400 }) }
  const type = TYPES[String(ev?.type || '')]
  const id = String(ev?.data?.email_id || '')
  if (!type || !/^[0-9a-f-]{36}$/i.test(id)) return ok({ ignored: true })   // 200 : Resend ne réessaie pas

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: log } = await sb.from('email_log').select('id').eq('resend_id', id).limit(1)
  if (!log?.length) return ok({ ignored: 'envoi inconnu' })
  const at = ev.created_at && !isNaN(Date.parse(ev.created_at)) ? ev.created_at : new Date().toISOString()
  const link = type === 'clicked' ? String(ev.data?.click?.link || '').slice(0, 500) || null : null
  const { error } = await sb.from('email_events').upsert({ resend_id: id, type, at, link }, { onConflict: 'resend_id,type', ignoreDuplicates: true })
  if (error) console.error('⚠️ email_events:', error.message)
  return ok()
})
