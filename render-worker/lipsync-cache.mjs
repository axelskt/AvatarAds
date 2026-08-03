// lipsync-cache.mjs — les clips Hedra déjà payés ne se rachètent pas.
//
// Module à part, et pas quelques lignes de plus dans worker.mjs, pour UNE
// raison : importer worker.mjs démarre la boucle de jobs. Isolé ici, le cache
// se teste en trente secondes contre le vrai Supabase, sans lancer de rendu et
// sans toucher à Hedra — ce qui, vu ce que cette histoire a coûté, est le
// minimum qu'on lui doit.

import { createHash } from 'node:crypto'

const r2 = (n) => Math.round(n * 100) / 100

// ── UN CLIP IDENTIQUE NE SE PAIE QU'UNE FOIS ───────────────────────────────
// Le 03/08 Axel a perdu ~1 750 crédits en une soirée. Facture recoupée avec les
// traces, tarif établi : 8,75 crédits par seconde de lipsync en 1080p.
//   · 20 h 17, 20 h 23, 20 h 47 — TROIS générations de la même scène 0→50,4 s,
//     même photo, même audio, même cadrage : 3 × 441 = 1 323 crédits pour UN clip.
//   · 17 h 04 — un job qui échoue APRÈS avoir payé ses 5 scènes : 426 crédits
//     brûlés sans qu'aucune vidéo ne sorte.
// La cause est la même dans les deux cas : le seul « cache » était le dossier
// `jobDir/avatar/` du conteneur Railway. Éphémère. Une relance, un autre
// réplica, un crash — et tout repart chez Hedra au prix fort.
//
// On indexe donc sur le CONTENU, pas sur le job : sha256(photo + audio découpé +
// cadrage + modèle). Mêmes octets en entrée ⇒ même vidéo en sortie ⇒ inutile de
// la racheter. Le clip vit dans le bucket `render-media`, qui lui est permanent.
// Conséquence directe : relancer un montage, régénérer depuis « Détails du
// montage » sans avoir touché à la voix, ou reprendre un job mort en cours de
// route ne coûte plus RIEN en lipsync.
export const HEDRA_CR_SEC = 8.75      // mesuré, cf. tableau ci-dessus
const CACHE_BUCKET = 'render-media'

// Le modèle est un PARAMÈTRE : changer de modèle Hedra doit invalider le cache
// (mêmes entrées, autre rendu), et le module n'a pas à savoir lequel tourne.
export function cleLipsync(photo, audio, ratio, modele) {
  return createHash('sha256')
    .update(photo).update(audio)
    .update(`|${ratio}|${modele}|1080p`)
    .digest('hex')
}

function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return { Authorization: `Bearer ${key}`, apikey: key }
}

// Renvoie le Buffer du clip déjà payé, ou null.
export async function cacheLire(cle) {
  const url = process.env.SUPABASE_URL
  if (!url) return null
  try {
    const r = await fetch(`${url}/rest/v1/lipsync_cache?cle=eq.${cle}&select=chemin,hits`, { headers: supaHeaders() })
    if (!r.ok) return null
    const [row] = await r.json().catch(() => [])
    if (!row?.chemin) return null
    const f = await fetch(`${url}/storage/v1/object/${CACHE_BUCKET}/${row.chemin}`, { headers: supaHeaders() })
    // Le clip a disparu du bucket : on purge l'entrée et on laisse regénérer.
    if (!f.ok) {
      await fetch(`${url}/rest/v1/lipsync_cache?cle=eq.${cle}`, { method: 'DELETE', headers: supaHeaders() })
      return null
    }
    fetch(`${url}/rest/v1/lipsync_cache?cle=eq.${cle}`, {
      method: 'PATCH',
      headers: { ...supaHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hits: (row.hits || 0) + 1, vu_le: new Date().toISOString() }),
    }).catch(() => {})
    return Buffer.from(await f.arrayBuffer())
  } catch (_) { return null }
}

// Range le clip fraîchement payé. Un échec ici ne casse rien : on aura juste
// repayé la prochaine fois, comme avant.
export async function cacheEcrire(cle, buf, secondes) {
  const url = process.env.SUPABASE_URL
  if (!url) return
  const chemin = `lipsync/${cle}.mp4`
  try {
    const up = await fetch(`${url}/storage/v1/object/${CACHE_BUCKET}/${chemin}`, {
      method: 'POST',
      headers: { ...supaHeaders(), 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
      body: buf,
    })
    if (!up.ok) { console.warn(`cache lipsync : dépôt refusé (${up.status})`); return }
    await fetch(`${url}/rest/v1/lipsync_cache`, {
      method: 'POST',
      headers: { ...supaHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ cle, chemin, secondes: r2(secondes), credits: Math.round(secondes * HEDRA_CR_SEC) }),
    })
  } catch (e) { console.warn('cache lipsync :', e.message) }
}
