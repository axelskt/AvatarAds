// Banc de l'audit Décupleur du 30/10, faille 8 : « les messages d'erreur techniques sont lisibles par le client ».
// Ce que le moteur ÉCRIT dans render_jobs.error et render_jobs.trace d'un job Décupleur (colonnes que le client lit : render-job
// renvoie error à l'app, la policy de lecture couvre la ligne). Code RÉEL : render-worker/decupleur.mjs (dcFetch, dcProbe,
// dcVariantes) et la capture de trace du moteur (PHASES + ouvrirTrace, extraites de render-worker/worker.mjs : le module ne
// s'importe pas, il lance sa boucle). Le câblage du moteur (job Décupleur → dcErreurClient / dcTraceClient) est relu dans
// worker.mjs ; sans lui (code d'avant), le moteur écrivait e.message et la trace brute.
// yt-dlp remplacé par un faux (script local) : aucun réseau, aucune vraie vidéo (vidéos de test fabriquées par ffmpeg).
//   node tools/tests-decupleur/test-faille8-messages.mjs
//   DC_MODULE=/chemin/decupleur.mjs WORKER=/chemin/worker.mjs node … → une autre version (AVANT : ab-faille678.sh)
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const DEPOT = resolve(ICI, '../..')
const MODULE = process.env.DC_MODULE || join(DEPOT, 'render-worker/decupleur.mjs')
const WORKER = process.env.WORKER || join(DEPOT, 'render-worker/worker.mjs')
const RACINE = mkdtempSync(join(tmpdir(), 'banc-faille8-'))
// le module importe ses textes choc depuis son dossier : copie à côté des assets du dépôt
mkdirSync(join(RACINE, 'mod', 'assets'), { recursive: true })
cpSync(join(DEPOT, 'render-worker/assets/dc-textes'), join(RACINE, 'mod', 'assets', 'dc-textes'), { recursive: true })
writeFileSync(join(RACINE, 'mod', 'decupleur.mjs'), readFileSync(MODULE, 'utf8'))
const m = await import(pathToFileURL(join(RACINE, 'mod', 'decupleur.mjs')).href)

// ── capture de trace du moteur (code réel) et câblage du job Décupleur ──
const W = readFileSync(WORKER, 'utf8')
const bloc = W.slice(W.indexOf('const PHASES = ['), W.indexOf('\n}\n', W.indexOf('function ouvrirTrace()')) + 3)
const ouvrirTrace = new Function(bloc + '\nreturn ouvrirTrace')()
const cableErreur = /estDc \? dcErreurClient\(job\.plan\.__compose/.test(W) && /status: 'failed', error: errEcrite, trace: traceEcrite\(\)/.test(W)
const cableTrace = /estDc \? dcTraceClient\(trace\.fermer\(\)\)/.test(W) && (W.match(/trace: traceEcrite\(\)/g) || []).length >= 3 && !/trace: trace\.fermer\(\)/.test(W)
const ecrit = (compose, err, evts) => ({
  error: err == null ? null : (cableErreur && m.dcErreurClient ? m.dcErreurClient(compose, err) : String(err).slice(0, 300)),
  trace: cableTrace && m.dcTraceClient ? m.dcTraceClient(evts) : evts,
})
// Un job comme le fait la boucle du moteur : trace ouverte, « ▶ job », travail, « ✗ job … » sur échec, trace fermée
async function job(compose, travail) {
  const t = ouvrirTrace(); let err = null
  const vraiErr = process.stderr.write.bind(process.stderr)
  process.stderr.write = () => true   // le journal du moteur (process.stderr) : hors trace, non affiché ici
  try { console.log('▶ job', 'banc'); await travail() } catch (e) { err = e && e.message || String(e); console.error('✗ job', 'banc', err) }
  finally { process.stderr.write = vraiErr }
  return ecrit(compose, err, t.fermer())
}
// Ce qui ne doit jamais atteindre le client
const FUITE = /Command failed|\/tmp\/|\/var\/folders|\/private\/|aa-job-|dc-lien-|banc-faille8|^ERROR|ERROR:|yt-dlp|ffprobe|c(?:œ|oe)ur|quota CPU|calcul \d+ s/im
const fuites = (w) => { const s = JSON.stringify(w); const x = FUITE.exec(s); return x ? s.slice(Math.max(0, x.index - 60), x.index + 80) : '' }

// ── faux yt-dlp (PATH) : mode lu dans FAUX_YTDLP ──
const BIN = join(RACINE, 'bin'); mkdirSync(BIN)
writeFileSync(join(BIN, 'yt-dlp'), `#!/bin/bash
out=""; prev=""
for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done
dest="\${out%%.%(ext)s}.mp4"
case "$FAUX_YTDLP" in
  erreur) echo "[TikTok] Extracting URL" ; echo "ERROR: [TikTok] 7300000000000000001: Unable to download webpage: HTTP Error 403: Forbidden (caused by <HTTPError 403>); see $TMPDIR/yt-dlp-cache" >&2 ; exit 1 ;;
  illisible) printf 'pas une video' > "$dest" ; exit 0 ;;
  ok) cp "$FAUX_SOURCE" "$dest" ; exit 0 ;;
esac
exit 2
`)
chmodSync(join(BIN, 'yt-dlp'), 0o755)
process.env.PATH = BIN + ':' + process.env.PATH
const SOURCE = join(RACINE, 'source.mp4')
const g = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', SOURCE])
if (g.status !== 0) { console.error('ffmpeg (vidéo de test) :', String(g.stderr)); process.exit(2) }
process.env.FAUX_SOURCE = SOURCE
const LIEN = 'https://www.tiktok.com/@compte/video/7300000000000000001'

const res = []
const ok = (n, c, d = '') => { res.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : ' — ' + d)) }
// dossier de travail du moteur (comme aa-job-*) : c'est son chemin que l'erreur brute recopiait
const jobDir = mkdtempSync(join(RACINE, 'aa-job-'))
const casse = join(jobDir, 'base.mp4'); writeFileSync(casse, 'ceci n’est pas une vidéo')

console.log('1. Lien qui échoue chez yt-dlp (dc-fetch)')
process.env.FAUX_YTDLP = 'erreur'
let w = await job('dc-fetch', () => m.dcFetch(LIEN, join(jobDir, 'out.mp4')))
ok('erreur écrite = phrase pour le client', /^(Vidéo|Impossible de récupérer)/.test(String(w.error)), String(w.error))
ok('aucune ligne brute de yt-dlp / chemin temporaire dans error ni trace', !fuites(w), fuites(w))

console.log('2. Lien qui ramène un fichier illisible (dcProbe dans dc-fetch)')
process.env.FAUX_YTDLP = 'illisible'
w = await job('dc-fetch', () => m.dcFetch(LIEN, join(jobDir, 'out.mp4')))
ok(`erreur écrite « Vidéo illisible… » (écrit : « ${String(w.error).slice(0, 90)} »)`, /^Vidéo illisible/.test(String(w.error)), String(w.error))
ok('ni « Command failed » ni chemin temporaire', !fuites(w), fuites(w))

console.log('3. dcProbe sur une vidéo illisible')
let e3 = ''
try { m.dcProbe(casse) } catch (e) { e3 = e.message }
ok(`dcProbe lève « Vidéo illisible… » (levé : « ${e3.slice(0, 90)} »)`, /^Vidéo illisible/.test(e3) && !FUITE.test(e3), e3)

console.log('4. Lot de variantes sur une entrée illisible (decupleur)')
w = await job('decupleur', () => m.dcVariantes({ src: casse, outDir: join(jobDir, 'dc-out'), a: 0, b: 3, n: 5, alt: {}, seed: 1 }))
ok('erreur écrite = phrase pour le client', /^(Vidéo illisible|La fabrication des variantes)/.test(String(w.error)), String(w.error))
ok('ni « Command failed » ni chemin temporaire', !fuites(w), fuites(w))

console.log('5. Erreur technique quelconque (envoi, ffmpeg) : message neutre')
w = await job('decupleur', async () => { throw new Error(`upload v01.mp4: The resource was not found (${jobDir}/dc-out/v01.mp4)`) })
ok('erreur technique remplacée par un message neutre', w.error === 'La fabrication des variantes a échoué — réessaie', String(w.error))
w = await job('dc-cut', async () => { throw new Error(`ffmpeg 1 : ${jobDir}/base.mp4: Invalid data found when processing input`) })
ok('dc-cut : message neutre', /^Découpe du passage impossible/.test(String(w.error)), String(w.error))

console.log('6. Clients honnêtes (inchangés)')
process.env.FAUX_YTDLP = 'ok'
const sortie = join(jobDir, 'lien.mp4')
w = await job('dc-fetch', () => m.dcFetch(LIEN, sortie))
ok('lien TikTok normal récupéré, aucune erreur', w.error === null && existsSync(sortie), String(w.error))
ok('trace utile gardée (« ✓ dc-fetch … »), sans détail technique', w.trace.some((x) => /✓ dc-fetch/.test(x.msg)) && !fuites(w), fuites(w) || JSON.stringify(w.trace))
w = await job('dc-fetch', () => m.dcFetch('https://www.tiktok.com/@compte/live', sortie))
ok('refus d’un live : la phrase du client passe telle quelle', /^Lien de live/.test(String(w.error)), String(w.error))
const out = join(jobDir, 'dc-out-ok')
let man = null
w = await job('decupleur', async () => { man = await m.dcVariantes({ src: sortie, outDir: out, a: 0, b: 2, n: 5, alt: { mirror: true, pixels: true, tint: true, audio: true, text: true }, textPos: 'Haut', seed: 7 }) })
ok('lot de 5 variantes rendu normalement', w.error === null && man && man.variantes.length === 5 && existsSync(join(out, 'v05.mp4')), String(w.error))
ok('trace du lot sans cœurs / quota CPU / calcul', w.trace.length > 0 && !fuites(w), fuites(w) || JSON.stringify(w.trace))

rmSync(RACINE, { recursive: true, force: true })
const nok = res.filter((c) => !c).length
console.log(`\n${res.length - nok}/${res.length} vérifications OK`)
process.exit(nok ? 1 : 0)
