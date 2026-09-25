// aide-bloque.mjs — simule worker.mjs pendant un rendu : lance le serveur audio
// comme en production (superviserServeurAudio), attend qu'il écoute, puis bloque
// SA boucle d'événements avec un execSync, exactement comme `hyperframes render`.
// Utilisé par serveur.test.mjs. Affiche « BLOQUE <pid du serveur audio> » juste
// avant le blocage : le test peut alors tuer le serveur audio EN PLEIN « rendu » et
// vérifier que le superviseur (dans son thread) le relance sans attendre.
import { execSync } from 'node:child_process'
import { superviserServeurAudio } from '../../audio-server.mjs'

const sup = superviserServeurAudio({ journal: (m) => console.log(m) })
const port = process.env.PORT
for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok && sup.pid()) break } catch (_) { /* pas encore prêt */ }
  await new Promise((r) => setTimeout(r, 100))
}
console.log('BLOQUE ' + sup.pid())
execSync('sleep ' + (process.env.BLOCAGE_S || '8'))
console.log('DEBLOQUE')
process.exit(0)
