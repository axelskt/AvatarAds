// purge-decupleur — fichiers de travail du Décupleur supprimés automatiquement (Axel 25/10) : sources, lots de variantes,
// vidéos récupérées par lien, passages découpés, vidéos du changement de personnage et vidéos préparées après 3 jours ;
// copies servies aux moteurs (lien signé 1 h) après 1 jour. Jamais un fichier de la Bibliothèque. La liste vient de
// list_decupleur_purge (SQL, service_role seul).
// POST + x-cron-key = CRON_SECRET (pg_cron « decupleur-purge », chaque nuit). { "dry_run": true } : compte sans supprimer.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
// Noms acceptés à la suppression : les MÊMES motifs que la liste SQL (défense en profondeur — jamais un autre fichier)
const SUR = /^([0-9a-f-]{36}\/(dc-src-[0-9]+\.(mp4|mov|webm|m4v)|dc-[0-9a-f-]{36}\/(v[0-9]{2}\.(mp4|jpg)|variantes\.zip|dc\.json)|[0-9a-f-]{36}\.mp4(\.poster\.jpg)?|kie\/[A-Za-z0-9_-]{6,120}\.mp4|mcp-src\/[0-9a-f-]{36}-(perso|prep)\.mp4)|(fal-in|mcp-prep)\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+)$/

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const isCron = !!CRON_SECRET && timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)
  if (!isCron) return json({ error: 'forbidden' }, 403)
  let dry = false
  try { const b = await req.json(); if (b && typeof b === 'object') dry = b.dry_run === true } catch { /* corps optionnel */ }

  const parMotif: Record<string, number> = {}
  let removed = 0, errors = 0, ecartes = 0
  // jusqu'à 5 tours de 500 (2 500 fichiers par nuit) : une nuit chargée ne bloque pas la suivante
  for (let tour = 0; tour < 5; tour++) {
    const { data, error } = await svc.rpc('list_decupleur_purge', { p_limit: 500 })
    if (error) return json({ error: 'list_failed', detail: error.message }, 500)
    const rows = ((data as Array<{ bucket_id: string; name: string; motif: string }>) || []).filter((r) => r.bucket_id === 'render-media')
    const surs = rows.filter((r) => SUR.test(r.name))
    ecartes += rows.length - surs.length
    for (const r of surs) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1
    if (dry || !surs.length) break
    for (let i = 0; i < surs.length; i += 100) {
      const { data: del, error: e } = await svc.storage.from('render-media').remove(surs.slice(i, i + 100).map((r) => r.name))
      if (e) { errors++; console.error('[purge-decupleur]', e.message) } else removed += (del || []).length
    }
    if (rows.length < 500 || errors) break
  }
  if (dry) return json({ ok: true, dry_run: true, a_supprimer: Object.values(parMotif).reduce((a, b) => a + b, 0), par_motif: parMotif, ecartes })
  console.log(`[purge-decupleur] supprimés=${removed} erreurs=${errors} écartés=${ecartes} ${JSON.stringify(parMotif)}`)
  return json({ ok: true, supprimes: removed, erreurs: errors, ecartes, par_motif: parMotif })
})
