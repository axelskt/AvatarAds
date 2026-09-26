// parite-chrome.test.mjs — le worker contre la VRAIE app, dans un VRAI Chrome.
//
// parite.test.mjs prouve que la chaîne (RNNoise → 16 bits → chaîne voix) est celle de
// l'app au bit près, mais il lui donne le PCM décodé par ffmpeg. Ici on compare de
// bout en bout, fichier par fichier : dans Chrome headless, les fonctions extraites de
// app/index.html (_denoiseDecode48kMono puis _acCleanCore, coupe des silences
// désactivée comme dans le MCP) ; côté worker, decoder48kMono puis nettoyerPcm.
//
// Le décodeur n'est pas le même (ffmpeg / Chrome : conversion 16 bits, rééchantillonneur,
// queue AAC), l'identité au bit près n'a donc pas de sens ici. Tolérance réaliste, par
// fichier, au décodage ET après nettoyage :
//   corrélation ≥ 0,9999 · résidu ≤ -40 dB · gain ±0,1 dB · longueur ±30 ms (queue AAC)
// AudioContext forcé à 48 kHz : c'est « l'app sur un appareil à 48 kHz ». (Sur un
// appareil à 44,1 kHz, l'app elle-même masterise en 44,1 kHz et ne donne pas le même
// résultat qu'à 48 kHz.)
//
// Sauté si aucun Chrome / Chromium n'est trouvé (CHROME_PATH pour en indiquer un).
// Résultats consignés dans parite-chrome.json.
//
//   node --test test/audio-clean/parite-chrome.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceApp, extraireFonction, extraireObjet, extraireLigne, APP_RNNOISE_DIR } from './extraire-app.mjs'
import { decoder48kMono, nettoyerPcm } from '../../audio-clean.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => p && existsSync(p))
const TOL = { correlation: 0.9999, residuDb: -40, gainDb: 0.1, longueurS: 0.03 }

// ── les entrées : les prises d'Axel, déclinées dans les formats qu'un client envoie ──
const TMP = mkdtempSync(join(tmpdir(), 'aa-chrome-'))
after(() => rmSync(TMP, { recursive: true, force: true }))
const H73 = join(ICI, 'H73.wav'), CTA74 = join(ICI, 'CTA74.wav')
const STEREO = 'pan=stereo|c0=c0|c1=c0'
const ENTREES = {
  'h73.wav': null,                                                                    // mono 48 kHz 16 bits
  'cta74.wav': null,
  'h73_bruit.wav': ['-i', H73, '-f', 'lavfi', '-i', 'anoisesrc=d=8.02:c=pink:a=0.03:r=48000:s=3', '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0[a]', '-map', '[a]', '-c:a', 'pcm_s16le'],
  'h73_st48.wav': ['-i', H73, '-af', STEREO, '-c:a', 'pcm_s16le'],                   // stéréo G=D (récepteur DJI)
  'h73_decor48.wav': ['-i', H73, '-f', 'lavfi', '-i', 'anoisesrc=d=8.02:c=pink:a=0.05:r=48000:s=5', '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]', '-map', '[a]', '-c:a', 'pcm_s16le'],
  'cta74_faible_st48.wav': ['-i', CTA74, '-af', `volume=0.25,${STEREO}`, '-c:a', 'pcm_s16le'],
  'h73_mono44.wav': ['-i', H73, '-ar', '44100', '-c:a', 'pcm_s16le'],
  'h73_st44.mp3': ['-i', H73, '-af', STEREO, '-ar', '44100', '-b:a', '128k'],
  'h73_mono48.m4a': ['-i', H73, '-c:a', 'aac', '-b:a', '128k'],
  'h73_video.mp4': ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=8.02', '-i', H73, '-af', STEREO, '-ar', '44100', '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '128k', '-shortest'],
}
const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', mp4: 'video/mp4', m4a: 'audio/mp4' }
function preparer() {
  for (const [nom, args] of Object.entries(ENTREES)) {
    const f = join(TMP, nom)
    if (!args) { writeFileSync(f, readFileSync(nom.startsWith('h73') ? H73 : CTA74)); continue }
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, f], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  }
}

// ── le code de l'app, tel que les clients l'exécutent ──
function codeApp() {
  const src = sourceApp()
  const fns = ['_loadRnnoise', '_denoiseDecode48kMono', '_denoisePcm', '_pcmToWavBlob', 'denoiseAudioFile', '_audioBufferToWavBlob',
    '_acNiveauConstant', '_acBqJs', '_acCompressJs', '_acMasterVoice', '_acNormalizeLoudness', '_acLimitPeaks',
    '_acDetectDenoised', '_acBruitDeFondDb', '_acCleanCore']
  return [
    extraireLigne(src, /let _rnnoiseModPromise = null;/),
    extraireLigne(src, /let _acDenoiseEnabled = true;/),
    extraireLigne(src, /let _acVoicePreset = '[a-z]+';/),
    extraireObjet(src, 'const _AC_VOICE_PRESETS ='),
    extraireLigne(src, /const _acOpts = \{[^\n]*\};/),
    extraireLigne(src, /let _acLevel\s*= '[a-z]+';/),
    extraireLigne(src, /let _acDenoisedBuf = null;/),
    extraireLigne(src, /const _AC_BRUIT_SEUIL_DB = -?\d+;/),
    'function toast(){}',
    ...fns.map((n) => extraireFonction(src, n)),
  ].join('\n\n')
}
const page = (noms) => `<!doctype html><meta charset="utf-8"><script>
  // l'app sur un appareil à 48 kHz
  { const O = window.AudioContext; window.AudioContext = class extends O { constructor(o) { super({ ...(o || {}), sampleRate: 48000 }) } } }
</script><script src="fns.js"></script><script>
(async () => {
  const envoyer = (q, f32) => fetch('/resultat?' + q, { method: 'POST', body: f32 ? new Blob([f32.buffer.slice(f32.byteOffset, f32.byteOffset + f32.byteLength)]) : '' })
  for (const nom of ${JSON.stringify(noms)}) {
    try {
      const b = await (await fetch('/entree/' + nom)).blob()
      const fichier = new File([b], nom, { type: (${JSON.stringify(MIME)})[nom.split('.').pop()] || '' })
      await envoyer('nom=' + nom + '&etape=decodage&sr=48000', await _denoiseDecode48kMono(fichier))
      _acOpts.silences = false   // le MCP ne coupe pas les silences
      const r = await _acCleanCore(fichier)
      await envoyer('nom=' + nom + '&etape=nettoyage&sr=' + r.cleanBuf.sampleRate, r.cleanBuf.getChannelData(0))
    } catch (e) { await envoyer('nom=' + nom + '&erreur=' + encodeURIComponent(String((e && e.message) || e))) }
  }
  await envoyer('fin=1')
})()
</script>`

async function executerDansChrome() {
  const code = codeApp()
  const noms = Object.keys(ENTREES)
  const html = page(noms)
  const res = {}
  let finir
  const fini = new Promise((r) => { finir = r })
  const serveur = http.createServer((req, rep) => {
    const u = new URL(req.url, 'http://x')
    const envoyer = (type, corps) => { rep.writeHead(200, { 'content-type': type }); rep.end(corps) }
    if (u.pathname === '/app/page.html') return envoyer('text/html', html)
    if (u.pathname === '/app/fns.js') return envoyer('text/javascript', code)
    if (u.pathname.startsWith('/assets/lib/rnnoise/')) {
      const f = u.pathname.split('/').pop()
      if (!['rnnoise.js', 'rnnoise.wasm'].includes(f)) { rep.writeHead(404); return rep.end() }
      return envoyer(f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', readFileSync(join(APP_RNNOISE_DIR, f)))
    }
    if (u.pathname.startsWith('/entree/')) {
      const nom = decodeURIComponent(u.pathname.slice(8))
      if (!noms.includes(nom)) { rep.writeHead(404); return rep.end() }
      return envoyer('application/octet-stream', readFileSync(join(TMP, nom)))
    }
    if (u.pathname === '/resultat') {
      const morceaux = []
      req.on('data', (c) => morceaux.push(c))
      req.on('end', () => {
        const q = Object.fromEntries(u.searchParams)
        const buf = Buffer.concat(morceaux)
        if (q.fin) finir()
        else if (q.erreur) (res[q.nom] ||= {}).erreur = q.erreur
        else {
          const ab = new ArrayBuffer(buf.length); new Uint8Array(ab).set(buf)
          ;(res[q.nom] ||= {})[q.etape] = { sr: Number(q.sr), data: new Float32Array(ab) }
        }
        rep.writeHead(200); rep.end('ok')
      })
      return
    }
    rep.writeHead(404); rep.end()
  })
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
  const profil = mkdtempSync(join(tmpdir(), 'aa-chrome-profil-'))
  const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profil}`, `http://127.0.0.1:${serveur.address().port}/app/page.html`], { stdio: 'ignore' })
  const garde = setTimeout(() => finir('délai'), 180_000)
  const issue = await fini
  clearTimeout(garde)
  chrome.kill('SIGKILL'); serveur.close()
  try { rmSync(profil, { recursive: true, force: true }) } catch (_) { /* Chrome tient encore un fichier */ }
  assert.notEqual(issue, 'délai', 'Chrome n\'a pas terminé en 3 min')
  return res
}

// corrélation, résidu (après alignement du gain), gain, longueurs
function comparer(w, a) {
  const n = Math.min(w.length, a.length)
  let ww = 0, aa = 0, wa = 0
  for (let i = 0; i < n; i++) { ww += w[i] * w[i]; aa += a[i] * a[i]; wa += w[i] * a[i] }
  const g = wa / aa
  let e = 0
  for (let i = 0; i < n; i++) { const d = w[i] - g * a[i]; e += d * d }
  return {
    correlation: +(wa / Math.sqrt(ww * aa)).toFixed(6),
    residuDb: +(10 * Math.log10(e / ww)).toFixed(1),
    gainDb: +(10 * Math.log10(ww / aa)).toFixed(3),
    ecartLongueurS: +((w.length - a.length) / 48000).toFixed(4),
  }
}
function verifier(nom, etape, m) {
  assert.ok(m.correlation >= TOL.correlation, `${nom} (${etape}) : corrélation ${m.correlation}`)
  assert.ok(m.residuDb <= TOL.residuDb, `${nom} (${etape}) : résidu ${m.residuDb} dB`)
  assert.ok(Math.abs(m.gainDb) <= TOL.gainDb, `${nom} (${etape}) : gain ${m.gainDb} dB`)
  assert.ok(Math.abs(m.ecartLongueurS) <= TOL.longueurS, `${nom} (${etape}) : longueur ${m.ecartLongueurS} s`)
}

test('parité de bout en bout avec l\'app dans Chrome (décodage + nettoyage, 10 fichiers)', { skip: !CHROME && 'Chrome / Chromium introuvable (CHROME_PATH)', timeout: 240_000 }, async () => {
  preparer()
  const app = await executerDansChrome()
  const rapport = { genere_par: 'render-worker/test/audio-clean/parite-chrome.test.mjs', tolerance: TOL, entrees: {} }
  for (const nom of Object.keys(ENTREES)) {
    const r = app[nom] || {}
    assert.ok(!r.erreur, `${nom} : l'app a échoué dans Chrome (${r.erreur})`)
    assert.ok(r.decodage && r.nettoyage, `${nom} : résultat Chrome manquant`)
    assert.equal(r.nettoyage.sr, 48000)
    const pcm = await decoder48kMono(join(TMP, nom))
    const w = await nettoyerPcm(Float32Array.from(pcm))
    const dec = comparer(pcm, r.decodage.data)
    const net = comparer(w.propre, r.nettoyage.data)
    rapport.entrees[nom] = { decodage: dec, nettoyage: net }
    verifier(nom, 'décodage', dec)
    verifier(nom, 'nettoyage', net)
  }
  writeFileSync(join(ICI, 'parite-chrome.json'), JSON.stringify(rapport, null, 2) + '\n')
  console.log('\n' + Object.entries(rapport.entrees).map(([nom, m]) =>
    `  ${nom.padEnd(24)} décodage corr ${m.decodage.correlation} résidu ${m.decodage.residuDb} dB gain ${m.decodage.gainDb} dB` +
    `  ·  nettoyage corr ${m.nettoyage.correlation} résidu ${m.nettoyage.residuDb} dB gain ${m.nettoyage.gainDb} dB (Δ ${m.nettoyage.ecartLongueurS} s)`).join('\n'))
})
