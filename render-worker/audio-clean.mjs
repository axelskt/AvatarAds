// audio-clean.mjs — le module « Nettoyage audio » de l'app, rejoué sur le serveur de rendu.
//
// Décision d'Axel (25/09) : le nettoyage demandé via Claude (outil MCP clean_audio,
// et l'étape de nettoyage du Montage IA) ne passe plus par ElevenLabs Voice
// Isolator (0,12 $/min) mais par NOTRE serveur, avec EXACTEMENT le traitement que
// l'app applique dans le navigateur, qui ne nous coûte rien :
//
//   octets reçus ─ ffmpeg ─▶ 48 kHz mono Float32
//                ─ RNNoise (même WASM que l'app, même boucle : trames de 480, échelle int16)
//                ─ passage 16 bits (le WAV intermédiaire de l'app)
//                ─ chaîne voix _acMasterVoice, préréglage par défaut de l'app
//                ─ ffmpeg libmp3lame 192 kbps ─▶ MP3
//
// Pas de coupe des silences : le MCP promet une voix nettoyée, pas un montage.
//
// Ce que l'app fait AUSSI et qu'on reproduit : l'auscultation « prise déjà
// débruitée / déjà saine » (_acDetectDenoised, _acBruitDeFondDb). Elle est
// INFORMATIVE — depuis le 27/07 l'app débruite dès que la case est cochée (elle
// l'est par défaut), même une prise saine : les préréglages ont été réglés sur un
// signal débruité (voir _acCleanCore dans app/index.html). On la calcule et on la
// renvoie en en-tête, sans changer le traitement.
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  _acMasterVoice, _acDetectDenoised, _acBruitDeFondDb, _AC_BRUIT_SEUIL_DB,
  _AC_VOICE_PRESETS, TamponAudio, allerRetourInt16, PRESET_DEFAUT,
} from './voice-chain.mjs'

export const SR = 48000
const ICI = dirname(fileURLToPath(import.meta.url))
export const RNNOISE_DIR = join(ICI, 'vendor', 'rnnoise')

// Démuxeurs audio acceptés. Tout le reste est refusé AVANT décodage : un fichier
// qui se présente comme de l'audio mais contient une liste de lecture (HLS,
// concat…) pourrait sinon faire ouvrir des URL au serveur. Le protocole est
// verrouillé en plus sur `file` (défense en profondeur contre le SSRF).
// « mov » couvre mp4 / m4a / 3gp ; « matroska » couvre webm.
export const DEMUXEURS = 'mp3,wav,w64,mov,ogg,flac,aac,matroska,caf,aiff,amr'

export class ErreurAudio extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const annule = () => new ErreurAudio('annule', 'traitement interrompu')

// ── RNNoise : le WASM de l'app, chargé une fois ────────────────────────────
let _rnnoise = null
export function chargerRnnoise(dir = RNNOISE_DIR) {
  if (!_rnnoise) {
    _rnnoise = (async () => {
      const { default: creer } = await import(pathToFileURL(join(dir, 'rnnoise.js')).href)
      // le binaire est fourni directement : le module (compilé pour le web) ne
      // sait pas lire un fichier tout seul dans Node
      const wasmBinary = await readFile(join(dir, 'rnnoise.wasm'))
      const m = creer({ wasmBinary, locateFile: (p) => join(dir, p) })
      return (m && m.ready) ? await m.ready : await m
    })().catch((e) => { _rnnoise = null; throw e })
  }
  return _rnnoise
}

// La boucle de _denoisePcm (app/index.html), à l'identique : trames de 480
// échantillons, passage à l'échelle int16 (×32768) et retour, la queue de moins
// d'une trame recopiée telle quelle. Seul ajout : toutes les 128 trames on rend
// la main (l'app le fait pour sa barre de progression) et on s'arrête net si la
// requête a été abandonnée — un traitement ne doit jamais survivre à son délai.
export async function debruiter(pcm, { signal, rnnoise } = {}) {
  const mod = rnnoise || await chargerRnnoise()
  const FRAME = 480
  const state = mod._rnnoise_create(0)
  const ptr = mod._malloc(FRAME * 4)
  const out = new Float32Array(pcm.length)
  const tmp = new Float32Array(FRAME)
  const n = Math.floor(pcm.length / FRAME)
  try {
    for (let i = 0; i < n; i++) {
      const b = i * FRAME
      for (let j = 0; j < FRAME; j++) tmp[j] = pcm[b + j] * 32768
      mod.HEAPF32.set(tmp, ptr >> 2)
      mod._rnnoise_process_frame(state, ptr, ptr)
      const o = mod.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + FRAME)
      for (let j = 0; j < FRAME; j++) out[b + j] = o[j] / 32768
      if ((i & 127) === 0) {
        if (signal && signal.aborted) throw annule()
        await new Promise((r) => setImmediate(r))
      }
    }
    for (let k = n * FRAME; k < pcm.length; k++) out[k] = pcm[k]
  } finally {
    mod._free(ptr); mod._rnnoise_destroy(state)
  }
  return out
}

// Le cœur, sans ffmpeg : signal 48 kHz mono → signal nettoyé. C'est lui que le
// banc de parité compare aux fonctions de l'app.
// Mémoire : deux signaux entiers au plus à la fois (l'entrée et le débruité,
// puis le débruité et la courbe de gain du limiteur) — 10 min = 2 × 115 Mo.
export async function nettoyerPcm(pcm, { signal, preset = PRESET_DEFAUT, rnnoise } = {}) {
  if (!Object.prototype.hasOwnProperty.call(_AC_VOICE_PRESETS, preset)) throw new ErreurAudio('preset', 'préréglage inconnu')
  const entree = new TamponAudio([pcm], SR)
  const dejaDebruite = _acDetectDenoised(entree)
  const priseSaine = !dejaDebruite && _acBruitDeFondDb(entree) < _AC_BRUIT_SEUIL_DB
  const debruite = await debruiter(pcm, { signal, rnnoise })
  if (signal && signal.aborted) throw annule()
  allerRetourInt16(debruite, debruite)   // en place
  const sortie = await _acMasterVoice(new TamponAudio([debruite], SR), preset)
  return { propre: sortie.getChannelData(0), infos: { dejaDebruite, priseSaine, preset } }
}

// ── ffmpeg, en asynchrone (jamais execSync ici : le serveur doit rester réactif) ──
function lancer(cmd, args, { signal, entree, maxSortie } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(annule())
    // ffmpeg ne reçoit aucune variable d'environnement au-delà du PATH : il lit des fichiers venus de l'extérieur
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin' } })
    const morceaux = []
    let total = 0, depasse = false, err = ''
    const tuer = () => { try { p.kill('SIGKILL') } catch (_) { /* déjà mort */ } }
    const surAbandon = () => tuer()
    if (signal) signal.addEventListener('abort', surAbandon, { once: true })
    p.stdout.on('data', (c) => {
      total += c.length
      if (maxSortie && total > maxSortie) { depasse = true; tuer(); return }
      morceaux.push(c)
    })
    p.stderr.on('data', (c) => { err = (err + c.toString()).slice(-2000) })
    p.stdin.on('error', () => { /* ffmpeg a fermé son entrée (erreur ou fin) : le code de sortie tranche */ })
    p.on('error', (e) => {
      if (signal) signal.removeEventListener('abort', surAbandon)
      reject(new ErreurAudio('ffmpeg', 'ffmpeg indisponible : ' + e.message))
    })
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', surAbandon)
      if (signal && signal.aborted) return reject(annule())
      resolve({ code, sortie: morceaux, total, depasse, err })
    })
    if (entree) p.stdin.end(entree)
    else p.stdin.end()
  })
}

// n'importe quel audio accepté → Float32 mono 48 kHz (-1..1), borné en durée
export async function decoder48kMono(fichier, { signal, maxSecondes = 600 } = {}) {
  const limite = Math.ceil((maxSecondes + 1) * SR) * 4
  const r = await lancer('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-threads', '1',
    '-protocol_whitelist', 'file', '-format_whitelist', DEMUXEURS,
    '-i', fichier, '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-t', String(maxSecondes + 1), '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1',
  ], { signal, maxSortie: limite + SR * 4 })
  if (r.depasse) throw new ErreurAudio('trop_long', `audio de plus de ${maxSecondes} s`)
  if (r.code !== 0) {
    if (/matches no streams|does not contain any stream|Output file .*does not contain/i.test(r.err)) throw new ErreurAudio('sans_audio', 'aucune piste audio')
    throw new ErreurAudio('illisible', 'audio illisible')
  }
  const n = Math.floor(r.total / 4)
  if (!n) throw new ErreurAudio('illisible', 'audio vide')
  if (n > maxSecondes * SR) throw new ErreurAudio('trop_long', `audio de plus de ${maxSecondes} s`)
  // copie dans un ArrayBuffer aligné (les morceaux de flux ne le sont pas)
  const ab = new ArrayBuffer(n * 4)
  const u8 = new Uint8Array(ab)
  let o = 0
  for (const c of r.sortie) {
    const k = Math.min(c.length, u8.length - o)
    u8.set(k === c.length ? c : c.subarray(0, k), o)
    o += k
    if (o >= u8.length) break
  }
  return new Float32Array(ab)
}

// Float32 mono 48 kHz → MP3 192 kbps
export async function encoderMp3(pcm, { signal } = {}) {
  const r = await lancer('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error',
    '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0',
    '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', 'pipe:1',
  ], { signal, entree: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) })
  if (r.code !== 0 || !r.total) throw new ErreurAudio('ffmpeg', 'encodage MP3 impossible')
  return Buffer.concat(r.sortie, r.total)
}

// Chaîne complète : octets → { mp3, duree, infos }. Le fichier reçu ne passe que
// par un dossier temporaire privé, effacé quoi qu'il arrive.
export async function nettoyerAudio(octets, { signal, preset = PRESET_DEFAUT, maxSecondes = 600 } = {}) {
  const dossier = await mkdtemp(join(tmpdir(), 'aa-clean-'))
  try {
    const entree = join(dossier, 'entree')
    await writeFile(entree, octets, { mode: 0o600 })
    const brut = await decoder48kMono(entree, { signal, maxSecondes })
    await rm(entree, { force: true })
    const { propre, infos } = await nettoyerPcm(brut, { signal, preset })
    const mp3 = await encoderMp3(propre, { signal })
    return { mp3, duree: propre.length / SR, infos }
  } finally {
    await rm(dossier, { recursive: true, force: true })
  }
}
