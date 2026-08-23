// Purge des rendus de TEST/DEV du storage (#69). Ne touche jamais :
//   - render-media/lipsync/*   (cache Hedra — regénérer coûte des crédits)
//   - brand-assets/*           (Ma marque)
// Tout le reste des buckets render-media + mcp-media appartient aux comptes
// dev d'Axel (vérifié en SQL) → supprimable. Dry-run par défaut ; --apply pour agir.
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('env manquant (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1) }
const APPLY = process.argv.includes('--apply')
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

// liste récursive robuste (pagination par offset, 100/page) — corrige le sous-comptage
async function walk(bucket, prefix = '') {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 100, offset })
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`)
    if (!data || !data.length) break
    for (const it of data) {
      const path = prefix ? `${prefix}/${it.name}` : it.name
      if (it.id === null || (it.metadata == null && !it.name.includes('.'))) {
        // dossier → descendre
        out.push(...await walk(bucket, path))
      } else {
        out.push({ path, size: Number(it.metadata?.size || 0), created: it.created_at || '' })
      }
    }
    if (data.length < 100) break
    offset += 100
  }
  return out
}

// On garde : le cache lipsync (crédits Hedra) et les médias MCP récents (< 5 j,
// au cas où une conversation MCP est ouverte en ce moment). Le reste = staging
// de rendu éphémère + test → supprimable.
const RECENT = '2026-08-04'
const KEEP = (bucket, path, created) =>
  (bucket === 'render-media' && path.startsWith('lipsync/')) ||
  (bucket === 'mcp-media' && created && created.slice(0, 10) >= RECENT)

let freed = 0, del = 0, kept = 0
for (const bucket of ['mcp-media', 'render-media']) {
  const files = await walk(bucket)
  const toDelete = files.filter(f => !KEEP(bucket, f.path, f.created))
  const toKeep = files.filter(f => KEEP(bucket, f.path, f.created))
  kept += toKeep.length
  console.log(`\n[${bucket}] ${files.length} fichiers — supprime ${toDelete.length}, garde ${toKeep.length}`)
  for (const f of toKeep) console.log(`   GARDE  ${f.path} (${(f.size/1e6).toFixed(1)} Mo)`)
  freed += toDelete.reduce((s, f) => s + f.size, 0)
  del += toDelete.length
  if (APPLY) {
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100).map(f => f.path)
      const { error } = await sb.storage.from(bucket).remove(batch)
      if (error) { console.error(`   ERREUR suppr ${bucket}:`, error.message); process.exit(1) }
      console.log(`   supprimé ${batch.length} (${bucket})`)
    }
  }
}
console.log(`\n${APPLY ? 'SUPPRIMÉ' : 'DRY-RUN — à supprimer'} : ${del} fichiers, ${(freed/1e6).toFixed(1)} Mo libérés. Gardés : ${kept}.`)
