// audio-clean.mjs — le module « Nettoyage audio » de l'app, rejoué sur le serveur de rendu.
//
// Décision d'Axel (25/09) : le nettoyage demandé via Claude (outil MCP clean_audio,
// et l'étape de nettoyage du Montage IA) ne passe plus par ElevenLabs Voice
// Isolator (0,12 $/min) mais par NOTRE serveur, avec EXACTEMENT le traitement que
// l'app applique dans le navigateur, qui ne nous coûte rien :
//
//   octets reçus ─ ffprobe (canaux, fréquence : on refuse avant de décoder)
//                ─ ffmpeg ─▶ 48 kHz mono Float32, mixage mono de Web Audio (0,5·(G+D) en stéréo)
//                ─ RNNoise (même WASM que l'app, même boucle : trames de 480, échelle int16)
//                ─ passage 16 bits (le WAV intermédiaire de l'app)
//                ─ chaîne voix _acMasterVoice, préréglage par défaut de l'app
//                ─ ffmpeg libmp3lame 192 kbps ─▶ MP3 écrit dans un FICHIER (en-tête LAME :
//                  durée exacte, aucun décalage de la voix)
//
// Parité : identique à l'app sur un appareil à 48 kHz, AU DÉCODEUR PRÈS. La chaîne
// (RNNoise → 16 bits → chaîne voix) est la même au bit près (banc parite.test.mjs) ;
// le décodage, lui, est celui de ffmpeg et non celui de Chrome (conversion 16 bits,
// rééchantillonneur, queue AAC) : écarts inaudibles, mesurés dans Chrome par
// parite-chrome.test.mjs (corrélation ≥ 0,9999, résidu ≤ -40 dB, gain ±0,1 dB).
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
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
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

// Au-delà, on refuse AVANT de décoder : un FLAC de 1 Mo peut annoncer 8 canaux à
// 384 kHz et occuper le serveur pour rien. Web Audio (l'app) ne sait pas non plus
// décoder au-delà de 96 kHz dans la plupart des navigateurs.
export const CANAUX_MAX = 8
export const FREQUENCE_MAX = 192_000

// ── Assainissement du signal décodé ─────────────────────────────────────────
// Un audio en PCM flottant (WAV / CAF / AIFF-C / W64 float) peut contenir des NaN,
// des infinis ou des amplitudes démesurées (1e30). Un SEUL NaN empoisonne l'état
// récurrent de RNNoise : tout ce qui suit sort en silence, et le serveur livrerait
// (et ferait facturer) un MP3 muet. Valeur non finie → 0, reste borné à ±8 (18 dB
// au-dessus de la pleine échelle : RNNoise le digère, voir le banc). Pour un signal
// normal, rien ne change : la parité avec l'app est intacte.
export const AMPLITUDE_MAX = 8
export function assainir(pcm) {
  let corriges = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]
    if (v >= -AMPLITUDE_MAX && v <= AMPLITUDE_MAX) continue   // cas courant ; NaN échoue aux deux comparaisons
    pcm[i] = Number.isFinite(v) ? (v > 0 ? AMPLITUDE_MAX : -AMPLITUDE_MAX) : 0
    corriges++
  }
  return corriges
}

// Sortie « muette » : -90 dBFS ou moins, alors que l'entrée était audible (crête
// au-dessus de -60 dBFS, ce que dépasse toute vraie prise de voix).
const SEUIL_MUET = 10 ** (-90 / 20)
const SEUIL_AUDIBLE = 10 ** (-60 / 20)
function crete(x) {
  let m = 0
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a }
  return m
}
function nonFinis(x) {
  let n = 0
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) n++
  return n
}

// ── Dossier temporaire privé ────────────────────────────────────────────────
// Tous les fichiers du nettoyage vivent sous $TMPDIR/aa-clean/<pid>-XXXXXX/ (0700).
// Le finally de nettoyerAudio les efface ; si le processus est TUÉ (SIGKILL, manque
// de mémoire : c'est justement la victime désignée), l'audio de l'utilisateur
// resterait sur le disque. menageTemporaire() — appelé au démarrage du serveur
// audio — efface donc les dossiers laissés par un processus qui n'existe plus.
export const dossierTemporaire = () => join(tmpdir(), 'aa-clean')
const vivant = (pid) => {
  try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' }
}
export async function menageTemporaire(base = dossierTemporaire()) {
  let effaces = 0
  let noms = []
  try { noms = await readdir(base) } catch (_) { return 0 }   // pas encore créé
  for (const nom of noms) {
    const pid = parseInt(nom, 10)
    if (Number.isFinite(pid) && pid > 0 && (pid === process.pid || vivant(pid))) continue
    await rm(join(base, nom), { recursive: true, force: true }).catch(() => {})
    effaces++
  }
  return effaces
}

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
//
// Deux garde-fous, pour ne JAMAIS livrer (ni faire facturer) du silence :
//   · RNNoise qui rend des valeurs non finies (état empoisonné) → erreur ;
//   · une entrée audible qui ressort à -90 dBFS ou moins → erreur.
// Le serveur répond alors 422 « sortie_muette » et le MCP passe à son secours.
export async function nettoyerPcm(pcm, { signal, preset = PRESET_DEFAUT, rnnoise } = {}) {
  if (!Object.prototype.hasOwnProperty.call(_AC_VOICE_PRESETS, preset)) throw new ErreurAudio('preset', 'préréglage inconnu')
  const entree = new TamponAudio([pcm], SR)
  const dejaDebruite = _acDetectDenoised(entree)
  const priseSaine = !dejaDebruite && _acBruitDeFondDb(entree) < _AC_BRUIT_SEUIL_DB
  const creteEntree = crete(pcm)
  const debruite = await debruiter(pcm, { signal, rnnoise })
  if (signal && signal.aborted) throw annule()
  if (nonFinis(debruite)) throw new ErreurAudio('sortie_muette', 'RNNoise a rendu des valeurs non finies')
  allerRetourInt16(debruite, debruite)   // en place
  const sortie = await _acMasterVoice(new TamponAudio([debruite], SR), preset)
  const propre = sortie.getChannelData(0)
  if (creteEntree > SEUIL_AUDIBLE && !(crete(propre) > SEUIL_MUET)) throw new ErreurAudio('sortie_muette', 'sortie muette pour une entrée audible')
  return { propre, infos: { dejaDebruite, priseSaine, preset } }
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

// ── ffprobe : ce qu'annonce le fichier, AVANT tout décodage ──────────────────
// Mêmes verrous que le décodage (démuxeurs audio seulement, protocole `file`).
export async function sonder(fichier, { signal } = {}) {
  const r = await lancer('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', DEMUXEURS,
    '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate',
    '-of', 'json', fichier,
  ], { signal, maxSortie: 64 * 1024 })
  if (r.depasse || r.code !== 0) throw new ErreurAudio('illisible', 'audio illisible')
  let j
  try { j = JSON.parse(Buffer.concat(r.sortie, r.total).toString('utf8')) } catch (_) { throw new ErreurAudio('illisible', 'audio illisible') }
  const piste = Array.isArray(j.streams) ? j.streams[0] : null
  if (!piste) throw new ErreurAudio('sans_audio', 'aucune piste audio')
  const nombre = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
  // Pas de refus sur la DURÉE annoncée : elle peut être fausse dans les deux sens
  // (MP3 VBR sans en-tête Xing estimé sur ses premières trames…). La durée est
  // bornée par le décodage lui-même (-t et taille de sortie), qui ne ment pas.
  return { canaux: nombre(piste.channels), frequence: nombre(piste.sample_rate) }
}

// Le mixage mono de l'app. Elle décode avec Web Audio puis rend le signal dans un
// OfflineAudioContext à 1 canal (_denoiseDecode48kMono) : c'est le mixage
// « speakers » de la spécification Web Audio qui s'applique. `-ac 1` de ffmpeg
// fait 0,707·(G+D) : +3 dB sur toute prise stéréo (iPhone, MP3, récepteur DJI),
// RNNoise écrêté au passage 16 bits. On écrit donc la matrice de Web Audio :
//   2 canaux  : 0,5·(G+D)
//   4 canaux  : 0,25·(G+D+SG+SD)
//   6 canaux  : √½·(G+D) + C + 0,5·(SG+SD)   (LFE ignoré)
//   autres    : mixage « discret » = le premier canal
export function filtreMono(canaux) {
  if (!canaux || canaux === 1) return null
  // le mixage se fait en flottant, comme Web Audio : sur une source 16 bits, `pan`
  // travaillerait sinon en entiers et arrondirait (écart d'un demi-bit)
  const pan = (expr) => `aformat=sample_fmts=fltp,pan=mono|c0=${expr}`
  if (canaux === 2) return pan('0.5*c0+0.5*c1')
  if (canaux === 4) return pan('0.25*c0+0.25*c1+0.25*c2+0.25*c3')
  if (canaux === 6) return pan(`${Math.SQRT1_2}*c0+${Math.SQRT1_2}*c1+c2+0.5*c4+0.5*c5`)
  return pan('c0')
}

// n'importe quel audio accepté → Float32 mono 48 kHz (-1..1), borné en durée,
// canaux et fréquence, assaini (voir assainir)
export async function decoder48kMono(fichier, { signal, maxSecondes = 600 } = {}) {
  const info = await sonder(fichier, { signal })
  if ((info.canaux && info.canaux > CANAUX_MAX) || (info.frequence && info.frequence > FREQUENCE_MAX)) {
    throw new ErreurAudio('hors_limites', `audio hors limites (${CANAUX_MAX} canaux, ${FREQUENCE_MAX / 1000} kHz au plus)`)
  }
  const limite = Math.ceil((maxSecondes + 1) * SR) * 4
  const filtre = filtreMono(info.canaux)
  const r = await lancer('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-threads', '1',
    '-protocol_whitelist', 'file', '-format_whitelist', DEMUXEURS,
    '-i', fichier, '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-t', String(maxSecondes + 1), ...(filtre ? ['-af', filtre] : []),
    '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1',
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
  const pcm = new Float32Array(ab)
  assainir(pcm)
  return pcm
}

// Float32 mono 48 kHz → MP3 192 kbps, écrit dans le FICHIER `sortie`.
// Pas dans un pipe : ffmpeg ne peut pas rembobiner un pipe, il n'écrit alors pas
// l'en-tête Xing/LAME (délai d'encodeur + bourrage). Sans lui, le MP3 dure 44 ms
// de trop et la voix démarre 23 ms en retard sur la source — une image à 30 i/s
// si l'utilisateur remet ce son sur sa vidéo. Avec lui, les décodeurs sans blanc
// (ffmpeg, Chrome, Safari) rendent exactement les échantillons encodés.
export async function encoderMp3(pcm, sortie, { signal } = {}) {
  const r = await lancer('ffmpeg', [
    '-nostdin', '-hide_banner', '-v', 'error', '-y',
    '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0',
    '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', sortie,
  ], { signal, entree: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) })
  if (r.code !== 0) throw new ErreurAudio('ffmpeg', 'encodage MP3 impossible')
  const mp3 = await readFile(sortie)
  if (!mp3.length) throw new ErreurAudio('ffmpeg', 'encodage MP3 impossible')
  return mp3
}

// Chaîne complète : octets → { mp3, duree, infos }. Le fichier reçu et le MP3 ne
// passent que par un dossier temporaire privé, effacé quoi qu'il arrive (et, si le
// processus est tué, au démarrage suivant : menageTemporaire).
export async function nettoyerAudio(octets, { signal, preset = PRESET_DEFAUT, maxSecondes = 600, base = dossierTemporaire() } = {}) {
  await mkdir(base, { recursive: true, mode: 0o700 })
  const dossier = await mkdtemp(join(base, `${process.pid}-`))
  try {
    const entree = join(dossier, 'entree')
    await writeFile(entree, octets, { mode: 0o600 })
    const brut = await decoder48kMono(entree, { signal, maxSecondes })
    await rm(entree, { force: true })
    const { propre, infos } = await nettoyerPcm(brut, { signal, preset })
    const mp3 = await encoderMp3(propre, join(dossier, 'sortie.mp3'), { signal })
    return { mp3, duree: propre.length / SR, infos }
  } finally {
    await rm(dossier, { recursive: true, force: true })
  }
}
