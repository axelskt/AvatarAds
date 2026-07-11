import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── Désinscription des e-mails de conseils (lien signé dans chaque e-mail marketing) ──
// GET ?u=<user_id>&k=<hmac> → profiles.email_optout = true.
// La signature est un HMAC dérivé de la service key : impossible à forger sans elle.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function unsubKey(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId)))
  return Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

const page = (title: string, msg: string) => new Response(
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
  <body style="margin:0;background:#0b0c10;color:#e7e5e4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">
    <div style="max-width:420px;padding:40px 24px">
      <div style="font-size:40px;margin-bottom:16px">📭</div>
      <div style="font-size:22px;font-weight:800;margin-bottom:10px">${title}</div>
      <div style="font-size:14.5px;color:#a8a29e;line-height:1.6">${msg}</div>
      <a href="https://avatarads.fr" style="display:inline-block;margin-top:24px;color:#FF6B35;font-weight:700;text-decoration:none">← Retour sur AvatarAds</a>
    </div>
  </body></html>`,
  { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

serve(async (req) => {
  const url = new URL(req.url)
  const u = url.searchParams.get('u') ?? ''
  const k = url.searchParams.get('k') ?? ''
  if (!u || !k || k !== await unsubKey(u)) {
    return page('Lien invalide', 'Ce lien de désinscription est invalide ou expiré. Écris-nous si le problème persiste.')
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  await sb.from('profiles').update({ email_optout: true }).eq('id', u)
  return page('C’est noté !', 'Tu ne recevras plus nos e-mails de conseils. Les e-mails liés à ton compte (paiements, sécurité) continueront de te parvenir.')
})
