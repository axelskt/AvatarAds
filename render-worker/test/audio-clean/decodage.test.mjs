// decodage.test.mjs — l'entrée du nettoyage : ce que le banc de parité (qui part d'un
// PCM déjà décodé) ne voit pas.
//
//   · le mixage mono est celui de Web Audio (l'app) : 0,5·(G+D) en stéréo, et les
//     règles « speakers » pour 4 et 6 canaux, le 1er canal sinon — pas le 0,707·(G+D)
//     de `ffmpeg -ac 1` (+3 dB, RNNoise écrêté au passage 16 bits) ;
//   · 44,1 kHz, MP3, MP4 vidéo, M4A : même niveau que la prise mono, longueur
//     ceil(durée × 48 000) pour un WAV ;
//   · signaux piégés (NaN, infini, amplitude 1e30) : assainis, jamais de MP3 muet ;
//   · garde-fou « sortie muette » ;
//   · ménage des dossiers temporaires laissés par un serveur tué.
//
//   node --test test/audio-clean/decodage.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decoder48kMono, debruiter, nettoyerPcm, nettoyerAudio, assainir, filtreMono, menageTemporaire, SR, AMPLITUDE_MAX,
} from '../../audio-clean.mjs'
import { allerRetourInt16 } from '../../voice-chain.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const H73 = join(ICI, 'H73.wav')
const TMP = mkdtempSync(join(tmpdir(), 'aa-dec-'))
after(() => rmSync(TMP, { recursive: true, force: true }))

function ff(...args) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
}
// un canal précis d'un fichier, en float 48 kHz (référence indépendante du code testé)
function canal(fichier, k) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', fichier, '-af', `pan=mono|c0=c${k}`, '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 })
  const ab = new ArrayBuffer(r.stdout.length); new Uint8Array(ab).set(r.stdout)
  return new Float32Array(ab)
}
const ecartMax = (a, b) => {
  assert.equal(a.length, b.length, 'longueurs différentes')
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}
const rmsDb = (x) => { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length) }
const creteDb = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return 20 * Math.log10(m || 1e-20) }

// ── mixage mono : la matrice de Web Audio ──────────────────────────────────
test('filtre de mixage : mono sans filtre ; 2, 4, 6 canaux selon Web Audio ; autres = 1er canal', () => {
  assert.equal(filtreMono(1), null)
  assert.equal(filtreMono(null), null)
  // mixage en flottant (comme Web Audio), puis la matrice
  assert.equal(filtreMono(2), 'aformat=sample_fmts=fltp,pan=mono|c0=0.5*c0+0.5*c1')
  assert.equal(filtreMono(3), 'aformat=sample_fmts=fltp,pan=mono|c0=c0')
  assert.match(filtreMono(6), /pan=mono\|c0=0\.7071067811865476\*c0\+0\.7071067811865476\*c1\+c2\+0\.5\*c4\+0\.5\*c5$/)
})

test('stéréo G=D (48 kHz, 16 bits) : décodage IDENTIQUE à la prise mono (écart 0)', async () => {
  const f = join(TMP, 'st48.wav')
  ff('-i', H73, '-af', 'pan=stereo|c0=c0|c1=c0', '-c:a', 'pcm_s16le', f)
  assert.equal(ecartMax(await decoder48kMono(f), await decoder48kMono(H73)), 0)
})

test('stéréo décorrélée : 0,5·(G+D) exactement', async () => {
  const f = join(TMP, 'decor.wav')
  ff('-i', H73, '-f', 'lavfi', '-i', 'anoisesrc=d=8.02:c=pink:a=0.2:r=48000:s=7', '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]', '-map', '[a]', '-c:a', 'pcm_s16le', f)
  const g = canal(f, 0), d = canal(f, 1)
  const attendu = new Float32Array(g.length)
  for (let i = 0; i < g.length; i++) attendu[i] = 0.5 * g[i] + 0.5 * d[i]
  assert.ok(ecartMax(await decoder48kMono(f), attendu) <= 1e-7)
})

// N canaux de sinus distincts, en float : la formule de Web Audio, canal par canal
async function multicanal(n) {
  const f = join(TMP, `c${n}.wav`)
  const entrees = []
  for (let k = 0; k < n; k++) entrees.push('-f', 'lavfi', '-i', `sine=f=${150 + 70 * k}:d=1:r=48000`)
  const pistes = Array.from({ length: n }, (_, k) => `[${k}:a]`).join('')
  ff(...entrees, '-filter_complex', `${pistes}amerge=inputs=${n}[a]`, '-map', '[a]', '-c:a', 'pcm_f32le', f)
  return { f, c: Array.from({ length: n }, (_, k) => canal(f, k)) }
}
test('4 canaux : 0,25·(G+D+SG+SD) ; 5.1 : √½·(G+D) + C + 0,5·(SG+SD), LFE ignoré ; 3 canaux : 1er canal', async () => {
  const q = await multicanal(4)
  const aq = q.c[0].map((_, i) => 0.25 * q.c[0][i] + 0.25 * q.c[1][i] + 0.25 * q.c[2][i] + 0.25 * q.c[3][i])
  assert.ok(ecartMax(await decoder48kMono(q.f), aq) <= 1e-6, 'quadriphonie')
  const s = await multicanal(6)
  const as = s.c[0].map((_, i) => Math.SQRT1_2 * (s.c[0][i] + s.c[1][i]) + s.c[2][i] + 0.5 * (s.c[4][i] + s.c[5][i]))
  assert.ok(ecartMax(await decoder48kMono(s.f), as) <= 1e-6, '5.1')
  const t = await multicanal(3)
  assert.ok(ecartMax(await decoder48kMono(t.f), t.c[0]) <= 1e-7, '3 canaux')
})

test('44,1 kHz : stéréo G=D = mono, longueur ceil(durée × 48 000)', async () => {
  const mono = join(TMP, 'm44.wav'), st = join(TMP, 's44.wav')
  ff('-i', H73, '-ar', '44100', '-c:a', 'pcm_s16le', mono)
  ff('-i', mono, '-af', 'pan=stereo|c0=c0|c1=c0', '-c:a', 'pcm_s16le', st)
  const a = await decoder48kMono(mono), b = await decoder48kMono(st)
  assert.equal(a.length, Math.ceil(8.02 * 48000))
  assert.equal(ecartMax(a, b), 0)
})

test('MP3 stéréo et MP4 vidéo (AAC stéréo) : même niveau que leur version mono (±0,1 dB), pas +3 dB', async () => {
  const cas = [
    { st: 'st.mp3', mono: 'mono.mp3', args: ['-ar', '44100', '-b:a', '128k'] },
    { st: 'st.mp4', mono: 'mono.m4a', args: ['-ar', '44100', '-c:a', 'aac', '-b:a', '128k'], video: true },
  ]
  for (const c of cas) {
    const st = join(TMP, c.st), mono = join(TMP, c.mono)
    ff('-i', H73, ...c.args, mono)
    if (c.video) ff('-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=8.02', '-i', H73, '-af', 'pan=stereo|c0=c0|c1=c0', '-c:v', 'libx264', '-shortest', ...c.args, st)
    else ff('-i', H73, '-af', 'pan=stereo|c0=c0|c1=c0', ...c.args, st)
    const ecart = rmsDb(await decoder48kMono(st)) - rmsDb(await decoder48kMono(mono))
    assert.ok(Math.abs(ecart) <= 0.1, `${c.st} : ${ecart.toFixed(2)} dB par rapport au mono`)
  }
})

test('prise stéréo proche du plein niveau : RNNoise n\'est pas écrêté plus que sur la prise mono', async () => {
  const f = join(TMP, 'st48-fort.wav')
  ff('-i', H73, '-af', 'pan=stereo|c0=c0|c1=c0', '-c:a', 'pcm_s16le', f)
  const ecretes = async (fichier) => {
    const x = await debruiter(await decoder48kMono(fichier))
    let n = 0; for (const v of x) if (Math.abs(v) >= 1) n++
    return n
  }
  assert.ok(await ecretes(f) <= await ecretes(H73))
})

// ── signaux piégés ─────────────────────────────────────────────────────────
function wavFloat(fichier, pcm) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(32, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.byteLength, 40)
  writeFileSync(fichier, Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]))
}
test('assainir : NaN et infinis → 0, amplitude bornée à ±8, signal normal intact', () => {
  const x = new Float32Array([0.5, NaN, Infinity, -Infinity, 1e30, -1e30, 7.9, -0.99])
  assert.equal(assainir(x), 5)
  assert.deepEqual(Array.from(x), [0.5, 0, 0, 0, AMPLITUDE_MAX, -AMPLITUDE_MAX, Math.fround(7.9), Math.fround(-0.99)])
  const y = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.9)
  const copie = Float32Array.from(y)
  assert.equal(assainir(y), 0)
  assert.deepEqual(y, copie)
})
test('WAV flottant piégé (1 NaN à 1 s, un NaN tous les 1000, un infini, amplitude 1e30) : MP3 jamais muet', async () => {
  const base = await decoder48kMono(H73)
  const pieges = {
    'un NaN à 1 s': (x) => { x[SR] = NaN },
    'NaN tous les 1000': (x) => { for (let i = 0; i < x.length; i += 1000) x[i] = NaN },
    'un infini': (x) => { x[1000] = Infinity },
    'amplitude 1e30': (x) => { for (let i = 0; i < x.length; i++) x[i] *= 1e30 },
  }
  for (const [nom, pieger] of Object.entries(pieges)) {
    const x = Float32Array.from(base); pieger(x)
    const f = join(TMP, 'piege.wav'); wavFloat(f, x)
    const r = await nettoyerAudio(readFileSync(f))
    const mp3 = join(TMP, 'piege.mp3'); writeFileSync(mp3, r.mp3)
    const d = spawnSync('ffmpeg', ['-v', 'error', '-i', mp3, '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 })
    const ab = new ArrayBuffer(d.stdout.length); new Uint8Array(ab).set(d.stdout)
    const sortie = new Float32Array(ab)
    // après le piège (1,1 s → fin) la voix est toujours là
    assert.ok(creteDb(sortie, Math.round(1.1 * SR), sortie.length) > -20, `${nom} : sortie muette après le piège`)
  }
})

// faux module RNNoise qui rend une valeur fixe (NaN : état empoisonné ; 0 : silence)
function fauxRnnoise(valeur) {
  const HEAPF32 = new Float32Array(1024)
  return {
    HEAPF32, _rnnoise_create: () => 1, _rnnoise_destroy: () => {}, _malloc: () => 0, _free: () => {},
    _rnnoise_process_frame: (_etat, sortie) => { HEAPF32.fill(valeur, sortie >> 2, (sortie >> 2) + 480) },
  }
}
test('garde-fou : RNNoise empoisonné (NaN) ou sortie muette pour une entrée audible → erreur sortie_muette', async () => {
  const pcm = await decoder48kMono(join(ICI, 'CTA74.wav'))
  await assert.rejects(nettoyerPcm(Float32Array.from(pcm), { rnnoise: fauxRnnoise(NaN) }), (e) => e.code === 'sortie_muette')
  await assert.rejects(nettoyerPcm(Float32Array.from(pcm), { rnnoise: fauxRnnoise(0) }), (e) => e.code === 'sortie_muette')
  // une entrée muette qui ressort muette n'est pas une erreur
  const r = await nettoyerPcm(new Float32Array(SR), { rnnoise: fauxRnnoise(0) })
  assert.equal(r.propre.length, SR)
})

// ── dossiers temporaires ───────────────────────────────────────────────────
test('ménage : dossiers d\'un processus mort effacés, ceux d\'un processus vivant gardés', async () => {
  const base = join(TMP, 'aa-clean')
  const mort = await new Promise((ok) => { const p = spawn('true'); p.on('exit', () => ok(p.pid)) })
  for (const nom of [`${mort}-abc123`, `${process.pid}-def456`, 'inconnu']) {
    mkdirSync(join(base, nom), { recursive: true })
    writeFileSync(join(base, nom, 'entree'), 'audio de quelqu\'un')
  }
  assert.equal(await menageTemporaire(base), 2)
  assert.deepEqual(readdirSync(base), [`${process.pid}-def456`])
  assert.equal(await menageTemporaire(join(TMP, 'absent')), 0)
})
test('nettoyerAudio travaille sous aa-clean/<pid>-… (0700) et n\'y laisse rien', async () => {
  const base = join(TMP, 'aa-clean-2')
  await nettoyerAudio(readFileSync(join(ICI, 'CTA74.wav')), { base })
  assert.ok(existsSync(base))
  assert.deepEqual(readdirSync(base), [])
})

test('passage 16 bits : borne à ±1 (c\'est lui qui écrêtait la stéréo à +3 dB)', () => {
  const x = new Float32Array([1.3, -1.3, 0.5])
  allerRetourInt16(x, x)
  assert.ok(Math.abs(x[0]) <= 1 && Math.abs(x[1]) <= 1)
})
