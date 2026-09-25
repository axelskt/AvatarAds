// aide-bloque.mjs — simule worker.mjs pendant un rendu : lance le serveur audio
// comme en production (superviserServeurAudio), attend qu'il écoute, puis bloque
// SA boucle d'événements avec un execSync, exactement comme `hyperframes render`.
// Utilisé par serveur.test.mjs.
import { execSync } from 'node:child_process'
import { superviserServeurAudio } from '../../audio-server.mjs'

superviserServeurAudio({ journal: (m) => console.log(m) })
const port = process.env.PORT
for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break } catch (_) { /* pas encore prêt */ }
  await new Promise((r) => setTimeout(r, 100))
}
console.log('BLOQUE')
execSync('sleep 8')
console.log('DEBLOQUE')
process.exit(0)
