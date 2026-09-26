#!/usr/bin/env node
// fond.mjs — le fond commun des aperçus de sous-titres : la photo A1-3 de l'avatar officiel A1, animée
// (poussée lente) puis passée au traitement « selfie tenu à la main » de l'usine (usine/selfie-treat.mjs,
// grain + tremblement faible). Même fond pour tous les styles : seul le sous-titre change d'un aperçu à l'autre.
//   node tools/apercus-soustitres/fond.mjs <photo A1-3> <sortie.mp4> [durée s]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const [photo, out, durArg] = process.argv.slice(2)
if (!photo || !out) { console.error('usage: fond.mjs <photo> <sortie.mp4> [durée]'); process.exit(1) }
const D = Number(durArg) || 11
const FPS = 30
const N = Math.round(D * FPS)
const work = mkdtempSync(join(tmpdir(), 'aa-fond-'))
try {
  // 1) poussée lente 1,00 → 1,06 sur une image 2× (zoompan sur du 1080 tremble au pixel près)
  const push = join(work, 'push.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', String(FPS), '-i', photo, '-frames:v', String(N),
    '-vf', `scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,`
      + `zoompan=z='1+0.06*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${FPS},format=yuv420p`,
    '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', push], { stdio: 'inherit' })
  // 2) traitement selfie de l'usine (grain + tremblement « faible » validé par Axel le 20/09)
  execFileSync('node', [join(HERE, '..', '..', 'usine', 'selfie-treat.mjs'), push, out, 'faible'], { stdio: 'inherit' })
  console.log(`fond prêt : ${out} (${D} s)`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
