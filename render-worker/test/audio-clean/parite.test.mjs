// parite.test.mjs — le nettoyage du serveur EST celui de l'app.
//
// On extrait de app/index.html les vraies fonctions du module « Nettoyage audio »
// (boucle RNNoise _denoisePcm, WAV intermédiaire _pcmToWavBlob, chaîne voix
// _acMasterVoice et ses briques, préréglage par défaut, options par défaut), on
// les exécute dans Node sur le WASM RNNoise de l'app, et on compare leur sortie à
// celle du worker sur les mêmes échantillons :
//   · RNNoise : identique à l'échantillon près (même WASM, même boucle) ;
//   · après la chaîne : écart maximal ≤ 1e-5 (en pratique 0).
// Échantillons : deux prises d'Axel (H73, CTA74) et un signal synthétique bruité.
// On mesure aussi sonie (LUFS) et crêtes avant / après avec ffmpeg ebur128 ;
// les mesures sont consignées dans mesures-lufs.json.
//
//   node --test test/audio-clean/parite.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sourceApp, extraireFonction, extraireObjet, extraireLigne, codeNormalise, APP_RNNOISE_DIR } from './extraire-app.mjs'
import * as chaine from '../../voice-chain.mjs'
import { debruiter, nettoyerPcm, decoder48kMono, nettoyerAudio, chargerRnnoise, RNNOISE_DIR, SR } from '../../audio-clean.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const TOLERANCE = 1e-5

// ── le WASM RNNoise tel que l'app le charge (sa propre copie, son propre module) ──
async function rnnoiseDeLApp() {
  // copié en .mjs le temps du test : assets/lib n'a pas de package.json « module »
  const d = mkdtempSync(join(tmpdir(), 'aa-rnn-app-'))
  copyFileSync(join(APP_RNNOISE_DIR, 'rnnoise.js'), join(d, 'rnnoise.mjs'))
  const { default: creer } = await import(pathToFileURL(join(d, 'rnnoise.mjs')).href)
  const m = creer({ wasmBinary: readFileSync(join(APP_RNNOISE_DIR, 'rnnoise.wasm')), locateFile: (p) => join(APP_RNNOISE_DIR, p) })
  const mod = (m && m.ready) ? await m.ready : await m
  rmSync(d, { recursive: true, force: true })
  return mod
}

// ── les fonctions de l'app, exécutées dans un bac à sable ──
function chargerApp(modRnnoise) {
  const s = sourceApp()
  const noms = ['_acNiveauConstant', '_acBqJs', '_acCompressJs', '_acMasterVoice', '_acNormalizeLoudness',
    '_acLimitPeaks', '_acDetectDenoised', '_acBruitDeFondDb', '_denoisePcm', '_pcmToWavBlob']
  const code = [
    extraireLigne(s, /let _acVoicePreset = '[a-z]+';/),
    extraireObjet(s, 'const _AC_VOICE_PRESETS ='),
    extraireLigne(s, /const _acOpts = \{[^\n]*\};/),
    ...noms.map((n) => extraireFonction(s, n)),
    `({ ${noms.join(', ')}, _acVoicePreset, _acOpts, _AC_VOICE_PRESETS })`,
  ].join('\n\n')
  const bac = vm.createContext({
    Math, Float32Array, ArrayBuffer, DataView, Blob, Promise, Object, Array, Number, isFinite, setTimeout,
    _loadRnnoise: async () => modRnnoise,
  })
  return vm.runInContext(code, bac, { filename: 'app/index.html (extrait)' })
}

// AudioBuffer minimal, écrit ICI (indépendant de celui du worker)
class BufferTest {
  constructor(d, sr) { this._d = d; this.sampleRate = sr; this.length = d.length; this.numberOfChannels = 1; this.duration = d.length / sr }
  getChannelData() { return this._d }
}
// relecture d'un WAV PCM 16 bits comme le fait le décodeur de Chrome
function lireWav16(octets) {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  const n = dv.getUint32(40, true) / 2
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) { const v = dv.getInt16(44 + i * 2, true); out[i] = v < 0 ? v / 32768 : v / 32767 }
  return out
}

// Chemin de l'app, étape par étape, avec ses propres fonctions :
// _denoisePcm → _pcmToWavBlob → (décodage) → _acMasterVoice(buf, preset | null = défaut de l'app)
async function pipelineApp(app, pcm, preset) {
  const debruite = await app._denoisePcm(Float32Array.from(pcm))
  const wav = new Uint8Array(await app._pcmToWavBlob(debruite, SR).arrayBuffer())
  const buf = new BufferTest(lireWav16(wav), SR)
  const sortie = await app._acMasterVoice(buf, preset)
  return { debruite, sortie: sortie.getChannelData(0) }
}

function ecartMax(a, b) {
  assert.equal(a.length, b.length, 'longueurs différentes')
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > m || d !== d) m = d !== d ? Infinity : d
  }
  return m
}

// signal synthétique déterministe : voix simulée (harmoniques modulées), souffle,
// ronflement 50 Hz, clics, silences, et un passage près du plein niveau
function signalSynthetique(secondes = 6) {
  const n = Math.round(secondes * SR), x = new Float32Array(n)
  let graine = 12345
  const alea = () => { graine = (graine * 1103515245 + 12345) >>> 0; return graine / 4294967296 * 2 - 1 }
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const parle = (t % 1.5) < 1.05 && t > 0.4
    const f0 = 140 + 25 * Math.sin(2 * Math.PI * 0.8 * t)
    let v = 0
    if (parle) for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * f0 * h * t + h) / h
    const env = parle ? 0.18 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t) ** 2) : 0
    x[i] = env * v + 0.02 * alea() + 0.01 * Math.sin(2 * Math.PI * 50 * t)
    if (i % 17_000 === 0) x[i] += 0.6                   // clic
    if (t > 4.6 && t < 4.9) x[i] = 0.97 * Math.sin(2 * Math.PI * 300 * t)   // quasi plein niveau
  }
  return x
}

function ffmpegPcm(fichier) {
  return decoder48kMono(fichier, { maxSecondes: 600 })
}

// ── mesures ebur128 (sonie intégrée, plage, crête échantillon, crête vraie) ──
function mesurer(fichier) {
  const r = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-i', fichier, '-map', '0:a:0',
    '-af', 'ebur128=peak=sample+true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' })
  const txt = String(r.stderr || '')
  const resume = txt.slice(txt.lastIndexOf('Summary:'))
  const nombre = (re) => { const m = re.exec(resume); return m ? parseFloat(m[1]) : null }
  return {
    lufs: nombre(/I:\s*(-?[\d.]+|-inf)\s*LUFS/),
    lra: nombre(/LRA:\s*(-?[\d.]+)\s*LU/),
    crete_echantillon_dbfs: nombre(/Sample peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/),
    crete_vraie_dbfs: nombre(/True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/),
  }
}
function ecrireWavFloat(fichier, pcm) {
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0', '-c:a', 'pcm_f32le', fichier],
    { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) })
  assert.equal(r.status, 0, 'écriture WAV')
}

const ECHANTILLONS = [
  { nom: 'H73.wav', fichier: join(ICI, 'H73.wav') },
  { nom: 'CTA74.wav', fichier: join(ICI, 'CTA74.wav') },
  { nom: 'synthetique-bruite', synth: true },
]

let app, entrees
test('préparation : fonctions et WASM de l\'app chargés', async () => {
  const modApp = await rnnoiseDeLApp()
  app = chargerApp(modApp)
  assert.equal(typeof app._acMasterVoice, 'function')
  entrees = {}
  for (const e of ECHANTILLONS) entrees[e.nom] = e.synth ? signalSynthetique() : await ffmpegPcm(e.fichier)
})

test('le WASM RNNoise du worker est celui de l\'app, octet pour octet', () => {
  for (const f of ['rnnoise.js', 'rnnoise.wasm']) {
    const h = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
    assert.equal(h(join(RNNOISE_DIR, f)), h(join(APP_RNNOISE_DIR, f)), f)
  }
})

test('les fonctions portées ont le même code que dans l\'app (commentaires et blancs mis à part)', () => {
  const app = sourceApp()
  const worker = readFileSync(join(ICI, '..', '..', 'voice-chain.mjs'), 'utf8')
  for (const n of ['_acNiveauConstant', '_acBqJs', '_acCompressJs', '_acMasterVoice', '_acNormalizeLoudness', '_acLimitPeaks', '_acDetectDenoised', '_acBruitDeFondDb']) {
    assert.equal(codeNormalise(extraireFonction(worker, n)), codeNormalise(extraireFonction(app, n)), `${n} diverge de l'app`)
  }
})

test('préréglage par défaut, options et barème des préréglages identiques à l\'app', () => {
  assert.equal(chaine.PRESET_DEFAUT, app._acVoicePreset)
  assert.equal(app._acOpts.voice, true, "l'app applique la chaîne voix par défaut")
  assert.equal(app._acOpts.denoise, true, "l'app débruite par défaut")
  assert.deepEqual(JSON.parse(JSON.stringify(chaine._AC_VOICE_PRESETS)), JSON.parse(JSON.stringify(app._AC_VOICE_PRESETS)))
})

const RESULTATS = []
for (const e of ECHANTILLONS) {
  test(`parité RNNoise — ${e.nom}`, async () => {
    const pcm = entrees[e.nom]
    const refApp = await app._denoisePcm(Float32Array.from(pcm))
    const worker = await debruiter(Float32Array.from(pcm))
    const ecart = ecartMax(worker, refApp)
    assert.equal(ecart, 0, `RNNoise : écart ${ecart}`)
  })
  for (const preset of [null, 'natural', 'podcast', 'punch']) {
    const libelle = preset || `défaut de l'app (${chaine.PRESET_DEFAUT})`
    test(`parité chaîne complète — ${e.nom} — ${libelle}`, async () => {
      const pcm = entrees[e.nom]
      const ref = await pipelineApp(app, pcm, preset)
      const w = await nettoyerPcm(Float32Array.from(pcm), { preset: preset || chaine.PRESET_DEFAUT })
      const ecart = ecartMax(w.propre, ref.sortie)
      RESULTATS.push({ echantillon: e.nom, preset: preset || chaine.PRESET_DEFAUT, ecart_max: ecart })
      assert.ok(ecart <= TOLERANCE, `écart ${ecart} > ${TOLERANCE}`)
    })
  }
}

test('mesures sonie / crêtes avant-après (ffmpeg ebur128) consignées', async () => {
  const d = mkdtempSync(join(tmpdir(), 'aa-mesures-'))
  const mesures = []
  try {
    for (const e of ECHANTILLONS) {
      let source = e.fichier
      if (e.synth) { source = join(d, 'synth.wav'); ecrireWavFloat(source, entrees[e.nom]) }
      const r = await nettoyerAudio(readFileSync(source))
      const sortie = join(d, e.nom + '.mp3')
      writeFileSync(sortie, r.mp3)
      const avant = mesurer(source), apres = mesurer(sortie)
      assert.ok(apres.lufs != null && apres.crete_echantillon_dbfs != null, 'mesure illisible')
      // le limiteur de l'app plafonne à 0,89 (-1,01 dBFS) ; l'encodage MP3 ajoute un peu de dépassement
      assert.ok(apres.crete_echantillon_dbfs <= 0, `crête ${apres.crete_echantillon_dbfs} dBFS`)
      mesures.push({ echantillon: e.nom, duree_s: +r.duree.toFixed(3), prise: r.infos, avant, apres })
    }
  } finally { rmSync(d, { recursive: true, force: true }) }
  const doc = {
    genere_par: 'render-worker/test/audio-clean/parite.test.mjs',
    chaine: `RNNoise → WAV 16 bits → _acMasterVoice('${chaine.PRESET_DEFAUT}') → MP3 192 kbps`,
    tolerance_parite: TOLERANCE,
    parite: RESULTATS,
    mesures,
  }
  writeFileSync(join(ICI, 'mesures-lufs.json'), JSON.stringify(doc, null, 2) + '\n')
  console.log('\n' + mesures.map((m) =>
    `  ${m.echantillon.padEnd(20)} avant ${String(m.avant.lufs).padStart(6)} LUFS · crête ${String(m.avant.crete_echantillon_dbfs).padStart(6)} dBFS (vraie ${m.avant.crete_vraie_dbfs})` +
    `  →  après ${String(m.apres.lufs).padStart(6)} LUFS · crête ${String(m.apres.crete_echantillon_dbfs).padStart(6)} dBFS (vraie ${m.apres.crete_vraie_dbfs})`).join('\n'))
})

test('le module RNNoise du worker se charge une seule fois', async () => {
  assert.equal(await chargerRnnoise(), await chargerRnnoise())
})
