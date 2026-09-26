// audio-superviseur.mjs — la surveillance du serveur audio, dans un THREAD à part.
//
// Lancé par superviserServeurAudio() (audio-server.mjs) dans un worker_threads.Worker.
// Pourquoi un thread : la boucle de rendu de worker.mjs bloque sa boucle
// d'événements plusieurs minutes (execSync de la CLI hyperframes et des ffmpeg).
// Un superviseur logé dans cette boucle-là ne verrait la mort du serveur audio
// qu'à la FIN du rendu — or c'est pendant un rendu que la mémoire manque et que le
// serveur audio (victime désignée du tueur OOM) tombe. Tout ce temps, le MCP
// basculerait sur ElevenLabs, donc paierait. Un thread a SA propre boucle
// d'événements : il relance le serveur 2 s après sa mort, rendu ou pas.
//
// Journaux : écrits directement sur le descripteur 1 (writeSync). Le console.log
// d'un thread passe par le thread principal — il attendrait, lui aussi, la fin
// du rendu.
import { parentPort, workerData } from 'node:worker_threads'
import { spawn } from 'node:child_process'
import { existsSync, writeSync } from 'node:fs'

const { script, env, pauseMs = 2_000, pauseMaxMs = 300_000 } = workerData || {}
const journal = (m) => { try { writeSync(1, m + '\n') } catch (_) { /* sortie fermée */ } }
const nice = ['/usr/bin/nice', '/bin/nice'].find((p) => existsSync(p))

let enfant = null, arret = false, pause = pauseMs, minuterie = null

function lancer() {
  minuterie = null
  if (arret) return
  // priorité CPU basse : le rendu passe d'abord, le nettoyage prend ce qui reste
  const cmd = nice || process.execPath
  const args = nice ? ['-n', '10', process.execPath, script] : [script]
  const debut = Date.now()
  // canal IPC : si le processus du worker disparaît, le serveur audio reçoit
  // « disconnect » et s'arrête (il ne lui survit jamais)
  const p = spawn(cmd, args, { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  enfant = p
  p.on('spawn', () => parentPort.postMessage({ pid: p.pid }))
  p.on('error', (e) => journal(`[clean] lancement du serveur audio impossible : ${e.message}`))
  p.on('exit', (code, sig) => {
    if (enfant === p) enfant = null
    parentPort.postMessage({ pid: null })
    if (arret) return
    if (Date.now() - debut > 60_000) pause = pauseMs   // il a tenu : on repart du délai court
    journal(`[clean] serveur audio arrêté (${sig || 'code ' + code}) — relance dans ${pause / 1000} s`)
    minuterie = setTimeout(lancer, pause)
    pause = Math.min(pause * 2, pauseMaxMs)
  })
}

parentPort.on('message', (m) => {
  if (m !== 'stop') return
  arret = true
  if (minuterie) clearTimeout(minuterie)
  if (enfant) { try { enfant.kill('SIGTERM') } catch (_) { /* déjà mort */ } }
  parentPort.close()
})

lancer()
