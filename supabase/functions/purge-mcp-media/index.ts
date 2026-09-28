// purge-mcp-media — conservation RGPD des médias MCP (Axel 28/09 : « oui » à 7 jours / 30 jours).
//   • photos et voix ENVOYÉES (mcp-media ref-* / omni-*, render-media mcp-veo/*) : supprimées après 7 jours ;
//   • médias GÉNÉRÉS via Claude (mcp-media <horodatage>-<suffixe>.<ext>) : après 30 jours — la copie rangée dans la
//     Bibliothèque (render-media/<uid>/lib) reste ; le lien /i/ d'un média expiré affiche « expiré ».
// Jamais : comptes owner / developer, images d'animation (logos des montages). La liste vient de list_media_purge (SQL).
// POST + x-cron-key = CRON_SECRET (pg_cron, planifié quotidiennement). { "dry_run": true } : compte sans rien supprimer.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const isCron = !!CRON_SECRET && timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)
  if (!isCron) return json({ error: 'forbidden' }, 403)
  let dry = false, limit = 500
  try { const b = await req.json(); if (b && typeof b === 'object') { dry = b.dry_run === true; if (Number.isFinite(b.limit)) limit = Math.max(1, Math.min(1000, b.limit)) } } catch { /* corps optionnel */ }

  const { data, error } = await svc.rpc('list_media_purge', { p_limit: limit })
  if (error) return json({ error: 'list_failed', detail: error.message }, 500)
  const rows = (data as Array<{ bucket_id: string; name: string; motif: string }>) || []
  const parMotif: Record<string, number> = {}
  for (const r of rows) parMotif[`${r.bucket_id} · ${r.motif}`] = (parMotif[`${r.bucket_id} · ${r.motif}`] || 0) + 1
  if (dry) return json({ ok: true, dry_run: true, a_supprimer: rows.length, par_motif: parMotif })

  let removed = 0, errors = 0
  for (const bucket of ['mcp-media', 'render-media']) {
    const names = rows.filter((r) => r.bucket_id === bucket).map((r) => r.name)
    for (let i = 0; i < names.length; i += 100) {
      const { data: del, error: e } = await svc.storage.from(bucket).remove(names.slice(i, i + 100))
      if (e) { errors++; console.error('[purge-mcp-media]', bucket, e.message) } else removed += (del || []).length
    }
  }
  console.log(`[purge-mcp-media] supprimés=${removed} erreurs=${errors} ${JSON.stringify(parMotif)}`)
  return json({ ok: true, supprimes: removed, erreurs: errors, par_motif: parMotif })
})
