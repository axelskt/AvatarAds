// Banc de la 2e relecture du 30/10 (retouche « forte », render-worker/retouche.mjs) : la retouche est gratuite et passait devant
// toute la file. Les relecteurs : « photo » non contrôlée (un MP4 renommé .jpg décodé EN ENTIER, 3 fois, tampon d'1 Go, 180 s par
// appel), cadence de sortie = celle de la source (aucun plafond), execFileSync qui bloque la boucle du moteur (plus de battement).
// Code RÉEL de retouche.mjs, vrai ffmpeg local sur des vidéos SYNTHÉTIQUES (mires lavfi, aucun fichier client, aucun réseau,
// aucun fournisseur). Fichiers dans un dossier temporaire, supprimés à la fin.
//   node tools/tests-decupleur/test-retouche-bornes.mjs
//   RETOUCHE=/chemin/retouche.mjs node …   → une autre version (AVANT : voir ab-faille34.sh)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const RETOUCHE = process.env.RETOUCHE || join(ICI, '../../render-worker/retouche.mjs')
const mod = await import(pathToFileURL(RETOUCHE).href)
const ASYNC = mod.retoucheVideo.constructor.name === 'AsyncFunction'
console.log(`retouche.mjs : ${RETOUCHE}${ASYNC ? '' : '  (version SYNCHRONE)'}`)

const D = mkdtempSync(join(tmpdir(), 'retouche-banc-'))
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a])
const probe = (f, e) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', e, '-of', 'csv=p=0', f]).toString().trim()
// vidéo « Express » honnête : 4 s, 720×1280, 24 i/s, H.264 ; photo de départ : PNG
const VIDEO = join(D, 'retouche-1-a.mp4'), PHOTO = join(D, 'retouche-1-a.png')
ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=d=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', VIDEO)
ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=1:duration=1', '-frames:v', '1', PHOTO)
// « photo » = une vidéo de 12 s renommée .jpg (le cas des relecteurs)
const FAUSSE = join(D, 'retouche-2-b.jpg')
ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-f', 'mp4', FAUSSE)
// source à 240 i/s (ralenti, ou cadence absurde) : 3 s
const RAPIDE = join(D, 'retouche-3-c.mp4')
ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=240:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', RAPIDE)

let nOk = 0, nKo = 0
const ok = (nom, c, d = '') => { if (c) nOk++; else nKo++; console.log(`${c ? '  ✓' : '  ✗'} ${nom}${c || !d ? '' : '  → ' + d}`) }
// lance la retouche en mesurant la boucle Node : un minuteur de 20 ms doit continuer de tourner (battement du job, sondes)
async function lancer(base, photo, out, ...extra) {
  let tics = 0
  const it = setInterval(() => { tics++ }, 20)
  const t0 = Date.now()
  let r = null, err = null
  try { r = await mod.retoucheVideo(base, photo, out, ...extra) } catch (e) { err = e }
  clearInterval(it)
  const ms = Date.now() - t0
  return { r, err, ms, tics, tAttendu: Math.floor(ms / 20) }
}

console.log('T1. client honnête : vidéo Express 4 s 24 i/s + photo PNG')
{
  const out = join(D, 'o1.mp4')
  const x = await lancer(VIDEO, PHOTO, out)
  const fps = existsSync(out) ? probe(out, 'stream=r_frame_rate') : ''
  const dur = existsSync(out) ? parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString()) : 0
  console.log(`     → ${x.err ? 'échec : ' + x.err.message : 'retouchée en ' + x.ms + ' ms'} ; sortie ${fps} i/s, ${dur.toFixed(2)} s ; minuteur : ${x.tics} tics sur ~${x.tAttendu}`)
  ok('retouchée (même cadence, même durée)', !x.err && fps === '24/1' && Math.abs(dur - 4) < 0.15, `${fps} ${dur}`)
  ok('la boucle du moteur reste libre pendant la retouche (battement, sondes)', x.tics >= x.tAttendu * 0.5, `${x.tics}/${x.tAttendu}`)
}

console.log('T2. « photo » = une vidéo de 12 s renommée .jpg')
{
  const out = join(D, 'o2.mp4')
  const x = await lancer(VIDEO, FAUSSE, out)
  console.log(`     → ${x.err ? 'refusée : ' + x.err.message.slice(0, 90) : 'ACCEPTÉE'} en ${x.ms} ms`)
  ok('refusée (la photo de départ doit être une image)', !!x.err && /photo/i.test(x.err.message), x.err ? x.err.message : 'acceptée')
  ok('sans rien encoder', !existsSync(out))
}

console.log('T3. source à 240 i/s')
{
  const out = join(D, 'o3.mp4')
  const x = await lancer(RAPIDE, PHOTO, out)
  const fps = existsSync(out) ? probe(out, 'stream=r_frame_rate') : ''
  const n = existsSync(out) ? Number(probe(out, 'stream=nb_frames')) : 0
  const [a, b] = fps.split('/').map(Number)
  console.log(`     → ${x.err ? 'échec : ' + x.err.message : 'retouchée en ' + x.ms + ' ms'} ; sortie ${fps} i/s, ${n} images`)
  ok('sortie à 30 i/s au plus (avant : 240, toutes les images réencodées en preset medium)', !x.err && b > 0 && a / b <= 30 && n <= 3 * 30 + 2, `${fps}, ${n} images`)
}

console.log('T4. délai GLOBAL de la retouche (sondes, lectures et encodage compris)')
if (!('RETOUCHE_TOTAL_MS' in mod)) console.log('  · sans objet sur cette version (chaque appel : 3 min, 7 appels)')
else {
  ok('100 s au plus (l’app abandonne à 150 s)', mod.RETOUCHE_TOTAL_MS <= 100_000, String(mod.RETOUCHE_TOTAL_MS))
  const out = join(D, 'o4.mp4')
  const x = await lancer(VIDEO, PHOTO, out, 300)
  console.log(`     → délai de 0,3 s : ${x.err ? 'arrêtée en ' + x.ms + ' ms (' + x.err.message.slice(0, 60) + ')' : 'finie en ' + x.ms + ' ms'}`)
  ok('une retouche qui dépasse son délai est arrêtée (job en échec, vidéo d’origine livrée)', !!x.err && x.ms < 3000, `${x.ms} ms`)
}

rmSync(D, { recursive: true, force: true })
console.log(`\n${nKo === 0 ? '✓' : '✗'} ${nOk}/${nOk + nKo} vérifications OK`)
process.exit(nKo ? 1 : 0)
