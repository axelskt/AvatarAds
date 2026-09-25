// serveur.test.mjs — la route POST /audio/clean du worker : auth, taille, type,
// concurrence, délai, sécurité (SSRF), vrai nettoyage de bout en bout, et le
// serveur qui répond PENDANT qu'un rendu bloque le processus principal.
//
//   node --test test/audio-clean/serveur.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerServeurAudio, cleValide, envEnfant } from '../../audio-server.mjs'
import { nettoyerAudio } from '../../audio-clean.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const CLE = 'cle-de-test-0123456789abcdef'
const H73 = readFileSync(join(ICI, 'H73.wav'))
const TMP = mkdtempSync(join(tmpdir(), 'aa-srv-'))
after(() => rmSync(TMP, { recursive: true, force: true }))

const ouverts = []
after(() => Promise.all(ouverts.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()) }))))

async function demarrer(options = {}) {
  const lignes = []
  const s = creerServeurAudio({ cle: CLE, journal: (m) => lignes.push(m), ...options })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  ouverts.push(s)
  const base = `http://127.0.0.1:${s.address().port}`
  return { s, base, lignes }
}
const poster = (base, corps, entetes = {}, chemin = '/audio/clean') =>
  fetch(base + chemin, { method: 'POST', headers: { 'x-worker-key': CLE, 'content-type': 'audio/wav', ...entetes }, body: corps })

// faux traitement piloté par le test (concurrence / délai)
function fauxNettoyage({ ignoreSignal = false } = {}) {
  const enCours = []
  const fn = (octets, { signal }) => new Promise((ok, ko) => {
    const job = { fini: () => ok({ mp3: Buffer.from('ID3fauxmp3'), duree: 1.5, infos: {} }), signal }
    if (!ignoreSignal) signal.addEventListener('abort', () => ko(Object.assign(new Error('annulé'), { code: 'annule' })), { once: true })
    enCours.push(job)
  })
  return { fn, enCours }
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
async function jusqua(cond, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond()) { if (Date.now() > fin) throw new Error('condition jamais remplie'); await attendre(10) }
}

// ── routes publiques ──
test('GET /health répond 200 {"ok":true}, sans clé', async () => {
  const { base } = await demarrer()
  const r = await fetch(base + '/health')
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ok: true })
})
test('route inconnue → 404 ; mauvaise méthode → 405', async () => {
  const { base } = await demarrer()
  assert.equal((await fetch(base + '/nimportequoi')).status, 404)
  assert.equal((await fetch(base + '/audio/clean')).status, 405)
  assert.equal((await fetch(base + '/health', { method: 'POST' })).status, 405)
})

// ── authentification ──
test('sans AUDIO_CLEAN_KEY configurée : 503, la route n\'est jamais ouverte', async () => {
  const { base } = await demarrer({ cle: '' })
  const r = await poster(base, H73, { 'x-worker-key': '' })
  assert.equal(r.status, 503)
  assert.equal((await r.json()).error, 'non_configure')
})
test('clé configurée trop courte (< 16 caractères) : 503 aussi', async () => {
  const { base } = await demarrer({ cle: 'court' })
  assert.equal((await poster(base, H73, { 'x-worker-key': 'court' })).status, 503)
})
test('en-tête absent ou clé fausse : 401, sans lire le corps', async () => {
  let appels = 0
  const { base, lignes } = await demarrer({ nettoyer: async () => { appels++; return { mp3: Buffer.alloc(1), duree: 1, infos: {} } } })
  const sans = await fetch(base + '/audio/clean', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: H73 })
  assert.equal(sans.status, 401)
  const fausse = await poster(base, H73, { 'x-worker-key': CLE.slice(0, -1) + 'X' })
  assert.equal(fausse.status, 401)
  const longue = await poster(base, H73, { 'x-worker-key': CLE + 'en-trop' })
  assert.equal(longue.status, 401)
  assert.equal(appels, 0)
  assert.ok(lignes.every((l) => !l.includes(CLE)), 'la clé ne doit jamais apparaître dans les journaux')
})
test('comparaison de clé : bonne clé acceptée, tout le reste refusé', () => {
  assert.equal(cleValide(CLE, CLE), true)
  assert.equal(cleValide(CLE.toUpperCase(), CLE), false)
  assert.equal(cleValide(undefined, CLE), false)
  assert.equal(cleValide(['a'], CLE), false)
  assert.equal(cleValide('x', ''), false)
})

// ── type et taille ──
test('type non audio → 415 (texte, html, webm vidéo) ; audio/*, video/mp4, octet-stream acceptés', async () => {
  const { base } = await demarrer({ nettoyer: async () => ({ mp3: Buffer.from('ok'), duree: 1, infos: {} }) })
  for (const t of ['text/plain', 'text/html', 'video/webm', 'image/png', 'application/json', ''])
    assert.equal((await poster(base, H73, { 'content-type': t })).status, 415, `type « ${t} »`)
  for (const t of ['audio/mpeg', 'audio/wav', 'audio/x-m4a', 'video/mp4', 'application/octet-stream', 'audio/mpeg; charset=binary'])
    assert.equal((await poster(base, H73, { 'content-type': t })).status, 200, `type « ${t} »`)
})
test('corps annoncé au-delà de 15 Mo → 413 avant toute lecture', async () => {
  let appels = 0
  const { base } = await demarrer({ nettoyer: async () => { appels++; return { mp3: Buffer.alloc(1), duree: 1, infos: {} } } })
  const port = new URL(base).port
  // requête brute : Content-Length mensonger, aucun octet envoyé
  const reponse = await new Promise((ok, ko) => {
    const c = net.connect(port, '127.0.0.1', () => c.write(
      `POST /audio/clean HTTP/1.1\r\nHost: x\r\nx-worker-key: ${CLE}\r\ncontent-type: audio/wav\r\ncontent-length: 15000001\r\n\r\n`))
    let txt = ''
    c.on('data', (d) => { txt += d })
    c.on('end', () => ok(txt)); c.on('error', ko)
  })
  assert.match(reponse, /^HTTP\/1\.1 413/)
  assert.equal(appels, 0)
})
test('corps envoyé en flux qui dépasse 15 Mo → 413', async () => {
  const { base } = await demarrer({ nettoyer: async () => ({ mp3: Buffer.alloc(1), duree: 1, infos: {} }) })
  const u = new URL(base)
  const statut = await new Promise((ok, ko) => {
    const req = http.request({ host: u.hostname, port: u.port, path: '/audio/clean', method: 'POST',
      headers: { 'x-worker-key': CLE, 'content-type': 'audio/wav', 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); ok(res.statusCode) })
    req.on('error', (e) => (e.code === 'ECONNRESET' || e.code === 'EPIPE') ? ok('coupé') : ko(e))
    const bloc = Buffer.alloc(1_000_000, 7)
    let envoyes = 0
    const pousser = () => {
      while (envoyes < 16) { envoyes++; if (!req.write(bloc)) return req.once('drain', pousser) }
      req.end()
    }
    pousser()
  })
  assert.ok(statut === 413 || statut === 'coupé', `statut ${statut}`)
})
test('corps vide → 400 ; préréglage inconnu → 400', async () => {
  const { base } = await demarrer()
  assert.equal((await poster(base, new Uint8Array(0))).status, 400)
  assert.equal((await poster(base, H73, {}, '/audio/clean?preset=inconnu')).status, 400)
})

// ── concurrence et délai ──
test('concurrence bornée : 1 à la fois, 1 en file, la 3e requête est refusée tout de suite (503)', async () => {
  const faux = fauxNettoyage()
  const { s, base } = await demarrer({ nettoyer: faux.fn, concurrence: 1, file: 1, delaiMs: 10_000 })
  const r1 = poster(base, H73)
  const r2 = poster(base, H73)
  await jusqua(() => s.etat().admis === 2 && faux.enCours.length === 1)
  const t = Date.now()
  const r3 = await poster(base, H73)
  assert.equal(r3.status, 503)
  assert.equal(r3.headers.get('retry-after'), '5')
  assert.ok(Date.now() - t < 1000, 'le refus doit être immédiat')
  assert.equal(faux.enCours.length, 1, 'la 2e attend son tour, elle ne tourne pas en parallèle')
  // (r1 ou r2 peut démarrer la première : peu importe laquelle, une seule tourne)
  faux.enCours[0].fini()
  await jusqua(() => faux.enCours.length === 2)
  faux.enCours[1].fini()
  const [a, b] = await Promise.all([r1, r2])
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(s.etat().picActifs, 1)
  assert.equal(s.etat().admis, 0)
})
test('délai maximal : un traitement trop long est interrompu (504) et son signal est levé', async () => {
  const faux = fauxNettoyage()
  const { s, base } = await demarrer({ nettoyer: faux.fn, delaiMs: 300 })
  const t = Date.now()
  const r = await poster(base, H73)
  assert.equal(r.status, 504)
  assert.ok(Date.now() - t < 2000)
  assert.equal(faux.enCours[0].signal.aborted, true, 'le travail en cours doit être arrêté')
  await jusqua(() => s.etat().actifs === 0)
})
test('traitement qui ignore son délai : 504 quand même, sa place reste prise jusqu\'à sa vraie fin, la file expire sans démarrer', async () => {
  const faux = fauxNettoyage({ ignoreSignal: true })
  const { s, base } = await demarrer({ nettoyer: faux.fn, concurrence: 1, file: 2, delaiMs: 400 })
  const t = Date.now()
  const r1 = poster(base, H73)
  await jusqua(() => faux.enCours.length === 1)
  const r2 = poster(base, H73)
  assert.equal((await r1).status, 504)
  assert.ok(Date.now() - t < 1500, 'le 504 part à l\'heure même si le travail ne s\'arrête pas')
  assert.equal((await r2).status, 504)
  assert.equal(faux.enCours.length, 1, 'la requête en file n\'a jamais démarré : la place était encore prise')
  assert.equal(s.etat().actifs, 1)
  faux.enCours[0].fini()
  await jusqua(() => s.etat().admis === 0 && s.etat().actifs === 0)
})
test('un vrai traitement abandonné arrête ffmpeg et RNNoise net', async () => {
  const long = join(TMP, 'long.wav')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=240:c=pink:a=0.1', '-ar', '48000', '-ac', '1', long])
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), 150)
  const t = Date.now()
  await assert.rejects(nettoyerAudio(readFileSync(long), { signal: ctrl.signal }), (e) => e.code === 'annule')
  assert.ok(Date.now() - t < 3000, `arrêt trop lent (${Date.now() - t} ms)`)
})

// ── le vrai nettoyage, de bout en bout ──
test('H73.wav → 200 audio/mpeg, durée en en-tête, MP3 lisible de même durée', async () => {
  const { base, lignes } = await demarrer()
  const r = await poster(base, H73)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'audio/mpeg')
  assert.equal(r.headers.get('x-audio-duration'), '8.020')
  assert.equal(r.headers.get('x-clean-preset'), 'off')
  const mp3 = Buffer.from(await r.arrayBuffer())
  const f = join(TMP, 'sortie.mp3'); writeFileSync(f, mp3)
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration', '-of', 'json', f], { encoding: 'utf8' })
  const info = JSON.parse(p.stdout)
  assert.equal(info.streams[0].codec_name, 'mp3')
  assert.equal(info.streams[0].sample_rate, '48000')
  assert.equal(info.streams[0].channels, 1)
  assert.equal(info.streams[0].bit_rate, '192000')
  assert.ok(Math.abs(Number(info.format.duration) - 8.02) < 0.1, 'durée ' + info.format.duration)
  assert.equal(lignes.length, 1)
  assert.match(lignes[0], /^\[clean\] 200 · 8\.0 s d'audio · 0\.77 Mo → 0\.19 Mo · \d+\.\d s$/)
})
test('un MP4 vidéo avec piste audio est accepté (video/mp4) ; sans piste audio → 422', async () => {
  const { base } = await demarrer()
  const avec = join(TMP, 'avec.mp4'), sans = join(TMP, 'sans.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=2', '-i', join(ICI, 'CTA74.wav'), '-shortest', '-c:v', 'libx264', '-c:a', 'aac', avec])
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1', '-c:v', 'libx264', sans])
  assert.equal((await poster(base, readFileSync(avec), { 'content-type': 'video/mp4' })).status, 200)
  const r = await poster(base, readFileSync(sans), { 'content-type': 'video/mp4' })
  assert.equal(r.status, 422)
  assert.equal((await r.json()).error, 'sans_audio')
})
test('octets illisibles → 422', async () => {
  const { base } = await demarrer()
  const r = await poster(base, Buffer.alloc(50_000, 0x5a), { 'content-type': 'audio/mpeg' })
  assert.equal(r.status, 422)
})
test('audio plus long que la borne → 413 trop_long', async () => {
  const { base } = await demarrer({ maxSecondes: 3 })
  const r = await poster(base, H73)
  assert.equal(r.status, 413)
  assert.equal((await r.json()).error, 'trop_long')
})
test('SSRF : une liste de lecture déguisée en audio ne fait ouvrir AUCUNE URL', async () => {
  let visites = 0
  const piege = http.createServer((q, s) => { visites++; s.end('x') })
  await new Promise((r) => piege.listen(0, '127.0.0.1', r))
  ouverts.push(piege)
  const cible = `http://127.0.0.1:${piege.address().port}/segment.mp3`
  const { base } = await demarrer()
  for (const corps of [
    `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${cible}\n#EXT-X-ENDLIST\n`,
    `ffconcat version 1.0\nfile '${cible}'\n`,
  ]) {
    const r = await poster(base, Buffer.from(corps), { 'content-type': 'audio/mpeg' })
    assert.equal(r.status, 422)
  }
  await attendre(200)
  assert.equal(visites, 0, 'le serveur ne doit jamais aller chercher une URL')
})

// ── architecture : le serveur répond pendant qu'un rendu bloque worker.mjs ──
test('processus enfant : /health répond alors que le processus principal est bloqué (execSync)', async () => {
  const port = await new Promise((ok) => { const t = net.createServer().listen(0, '127.0.0.1', () => { const p = t.address().port; t.close(() => ok(p)) }) })
  const aide = spawn(process.execPath, [join(ICI, 'aide-bloque.mjs')], { env: { ...process.env, PORT: String(port), AUDIO_CLEAN_KEY: CLE }, stdio: ['ignore', 'pipe', 'pipe'] })
  let sortie = ''
  aide.stdout.on('data', (d) => { sortie += d })
  aide.stderr.on('data', (d) => { sortie += d })
  try {
    await jusqua(() => sortie.includes('BLOQUE'), 10_000)
    const t = Date.now()
    const r = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(r.status, 200)
    assert.ok(Date.now() - t < 1500, `réponse en ${Date.now() - t} ms pendant le blocage`)
    const n = await poster(`http://127.0.0.1:${port}`, readFileSync(join(ICI, 'CTA74.wav')))
    assert.equal(n.status, 200, 'le vrai nettoyage marche aussi pendant le blocage')
    assert.ok(!sortie.includes('DEBLOQUE'), 'le processus principal était bien encore bloqué')
  } finally {
    aide.kill('SIGKILL')
  }
  await attendre(500)
  // le parent tué, l'enfant (relié par IPC) s'arrête de lui-même
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }))
})
test('le processus enfant ne reçoit pas les secrets du worker', () => {
  const env = envEnfant({ PATH: '/bin', SUPABASE_SERVICE_ROLE_KEY: 'secret', HEDRA_API_KEY: 'x', AUDIO_CLEAN_KEY: CLE, PORT: '8080' })
  assert.deepEqual(Object.keys(env).sort(), ['AUDIO_CLEAN_KEY', 'PATH', 'PORT'])
})

// ── contrat MCP ↔ worker : le module Deno du MCP contre le vrai serveur ──
const deno = spawnSync('deno', ['--version'], { encoding: 'utf8' })
test('contrat MCP ↔ worker : nettoyage-voix.ts (Deno) obtient le MP3 du vrai serveur', { skip: deno.status !== 0 && 'Deno absent' }, async () => {
  const { base } = await demarrer()
  const lancer = (cle) => new Promise((ok) => {
    const p = spawn('deno', ['run', '--quiet', '--no-lock', '--no-config', '--allow-net=127.0.0.1', `--allow-read=${ICI}`, join(ICI, 'contrat-mcp.deno.ts'), base, cle, join(ICI, 'H73.wav'), 'audio/wav'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => ok({ code, out, err }))
  })
  const bon = await lancer(CLE)
  assert.equal(bon.code, 0, bon.err)
  const r = JSON.parse(bon.out.trim().split('\n').pop())
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.ok(r.octets > 100_000, 'MP3 de 8 s attendu')
  assert.ok(r.journal.some((l) => l.startsWith('[clean] serveur de rendu : voix nettoyée')))
  // mauvaise clé : le worker refuse (401) → le MCP le voit et tente son secours (absent ici)
  const mauvais = JSON.parse((await lancer('mauvaise-cle-0123456789')).out.trim().split('\n').pop())
  assert.equal(mauvais.ok, false)
  assert.ok(mauvais.journal.some((l) => l.includes('[clean] repli ElevenLabs (serveur de rendu HTTP 401 cle)')), JSON.stringify(mauvais.journal))
})
