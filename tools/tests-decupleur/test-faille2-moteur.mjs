// Banc de l'audit Décupleur du 30/10, faille 2 (lien de live TikTok : ffmpeg orphelin qui remplit /tmp), côté MOTEUR.
// Code réel de render-worker/decupleur.mjs (dcFetch) ; yt-dlp remplacé par faux-ytdlp/ (aucun réseau, aucune vraie vidéo) qui
// applique le VRAI choix d'extracteur et le VRAI --match-filter de yt-dlp (bibliothèque installée, ytdlp-reel.py). Le délai
// de récupération (240 s) est ramené à 3 s dans une copie du module. Chaque scénario tourne dans un processus à part
// (25 s au plus) : un moteur bloqué compte comme un échec. Les faux ffmpeg restés vivants sont comptés puis tués.
//
//   node test-faille2-moteur.mjs                         → code du dépôt (APRÈS)
//   DC_MODULE=/chemin/decupleur.mjs node test-faille2-moteur.mjs   → autre version (AVANT : voir ab-faille2.sh)
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const DEPOT = resolve(ICI, '../..')

// ── mode scénario (processus enfant) ──────────────────────────────────────────────────────────────────────────────
if (process.argv[2] === '--scenario') {
  const sc = JSON.parse(process.argv[3])
  // « web » du lien de partage Instagram (seul fetch fait par le moteur) : redirections de la table, rien d'autre
  const WEB = { 'https://www.instagram.com/share/reel/BAshare06/': 'https://www.instagram.com/reel/DAreel06/',
    'https://www.instagram.com/share/BAlive08/': 'https://www.instagram.com/compte/live/' }
  globalThis.fetch = async (u) => WEB[u] ? new Response(null, { status: 302, headers: { location: WEB[u] } }) : new Response('', { status: 200 })
  const m = await import(pathToFileURL(process.env.DC_MOD_COPIE).href)
  const t0 = Date.now()
  try {
    await m.dcFetch(sc.lien, sc.sortie)
    console.log(JSON.stringify({ ok: true, ms: Date.now() - t0 }))
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e && e.message || e), ms: Date.now() - t0 }))
  }
  process.exit(0)
}

// ── préparation ───────────────────────────────────────────────────────────────────────────────────────────────────
const MODULE = process.env.DC_MODULE || join(DEPOT, 'render-worker/decupleur.mjs')
const YTDLP_PY = process.env.YTDLP_PY || '/opt/homebrew/Cellar/yt-dlp/2026.3.17_2/libexec/bin/python'
if (!existsSync(YTDLP_PY)) { console.error('Python du yt-dlp installé introuvable (YTDLP_PY) :', YTDLP_PY); process.exit(2) }
const RACINE = mkdtempSync(join(tmpdir(), 'banc-faille2-'))
const src = readFileSync(MODULE, 'utf8')
const nDelai = src.split('240000').length - 1
if (nDelai !== 1) { console.error(`délai 240000 trouvé ${nDelai} fois dans ${MODULE} (1 attendu)`); process.exit(2) }
mkdirSync(join(RACINE, 'mod'))
const COPIE = join(RACINE, 'mod', 'decupleur.mjs')
writeFileSync(COPIE, src.replace('240000', '3000'))
const SOURCE = join(RACINE, 'source-30s.mp4')
const g = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', SOURCE])
if (g.status !== 0) { console.error('ffmpeg (vidéo de test) :', String(g.stderr)); process.exit(2) }

const vivant = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const dodo = (ms) => new Promise((r) => setTimeout(r, ms))
const taille = (dir) => readdirSync(dir).filter((n) => n.startsWith('fantome-')).reduce((s, n) => s + statSync(join(dir, n)).size, 0)

async function lancer(nom, lien, { tuyau = 'ignore' } = {}) {
  const dir = join(RACINE, nom)
  mkdirSync(dir)
  const sortie = join(dir, 'sortie.mp4')
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--scenario', JSON.stringify({ lien, sortie })], {
    timeout: 25000, killSignal: 'SIGKILL', encoding: 'utf8',
    env: { ...process.env, PATH: join(ICI, 'faux-ytdlp') + ':' + process.env.PATH, FAUX_DIR: dir, FAUX_SOURCE: SOURCE, FAUX_TUYAU: tuyau,
      YTDLP_PY, YTDLP_REEL: join(ICI, 'ytdlp-reel.py'), DC_MOD_COPIE: COPIE },
  })
  const ligne = String(r.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop()
  const res = ligne ? JSON.parse(ligne) : { ok: false, err: 'MOTEUR BLOQUÉ (tué au bout de 25 s)', bloque: true }
  res.ms = res.ms ?? (Date.now() - t0)
  const appels = existsSync(join(dir, 'appels.jsonl')) ? readFileSync(join(dir, 'appels.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const pids = existsSync(join(dir, 'fantomes.pid')) ? readFileSync(join(dir, 'fantomes.pid'), 'utf8').trim().split('\n').filter(Boolean).map(Number) : []
  const avant = taille(dir); await dodo(1200); const apres = taille(dir)
  res.appels = appels
  res.fantomesVivants = pids.filter(vivant).length
  res.fantomeGrossit = apres > avant
  res.disqueFantome = apres
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch { /* déjà mort */ } }   // ménage du banc
  if (res.ok && existsSync(sortie)) {
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', sortie], { encoding: 'utf8' })
    res.duree = parseFloat(p.stdout)
  }
  return res
}

let ok = 0, total = 0
const verif = (cond, libelle, detail) => { total++; if (cond) ok++; console.log(`${cond ? '  ✓' : '  ✗'} ${libelle}${cond ? '' : '  → ' + detail}`) }
const Mo = (o) => (o / 1048576).toFixed(1) + ' Mo'

console.log(`Module testé : ${MODULE}\n`)

console.log('S1 · lien de live direct https://www.tiktok.com/@compte/live')
let r = await lancer('s1', 'https://www.tiktok.com/@compte/live')
verif(!r.ok && /live/i.test(r.err), 'refusé avec un message « live »', r.ok ? 'accepté' : r.err)
verif(r.appels.length === 0, 'yt-dlp jamais lancé', `${r.appels.length} appel(s)`)
verif(r.fantomesVivants === 0 && !r.fantomeGrossit, 'aucun ffmpeg orphelin après le job', `${r.fantomesVivants} orphelin(s) vivant(s), fichier fantôme ${Mo(r.disqueFantome)} qui grossit encore`)

console.log('S2 · lien court https://vm.tiktok.com/ZMLIVE01/ qui mène à un live')
r = await lancer('s2', 'https://vm.tiktok.com/ZMLIVE01/')
verif(!r.ok, 'refusé', 'accepté')
verif(r.ms < 2500, 'refusé tout de suite (pas d\'enregistrement jusqu\'au délai)', `${r.ms} ms (${r.err})`)
verif(r.fantomesVivants === 0 && !r.fantomeGrossit, 'aucun ffmpeg orphelin après le job', `${r.fantomesVivants} orphelin(s) vivant(s), fichier fantôme ${Mo(r.disqueFantome)} qui grossit encore`)

console.log('S3 · récupération bloquée jusqu\'au délai (yt-dlp + son ffmpeg), sorties du ffmpeg séparées')
r = await lancer('s3', 'https://www.tiktok.com/@compte/video/7000000000000000001')
verif(!r.ok && /trop longue/i.test(r.err), 'échec « Récupération trop longue » au délai', r.ok ? 'réussi ?' : r.err)
verif(r.fantomesVivants === 0 && !r.fantomeGrossit, 'tout le groupe tué au délai (aucun ffmpeg orphelin)', `${r.fantomesVivants} orphelin(s) vivant(s), fichier fantôme ${Mo(r.disqueFantome)} qui grossit encore`)

console.log('S3b · même chose, le ffmpeg partageant la sortie d\'erreur de yt-dlp (comme le Popen réel)')
r = await lancer('s3b', 'https://www.tiktok.com/@compte/video/7000000000000000001', { tuyau: 'herite' })
verif(!r.bloque && r.ms < 10000, 'le moteur rend la main peu après le délai', r.bloque ? r.err : `${r.ms} ms`)
verif(r.fantomesVivants === 0 && !r.fantomeGrossit, 'aucun ffmpeg orphelin', `${r.fantomesVivants} orphelin(s) vivant(s), fichier fantôme ${Mo(r.disqueFantome)} qui grossit encore`)

console.log('S4 · client honnête : https://www.tiktok.com/@compte/video/… de 30 s')
r = await lancer('s4', 'https://www.tiktok.com/@compte/video/7000000000000000002?is_from_webapp=1&sender_device=pc')
verif(r.ok && Math.abs(r.duree - 30) < 0.5, 'vidéo récupérée et normalisée (30 s)', r.ok ? `durée ${r.duree}` : r.err)
const a4 = (r.appels[0] || []).join(' ')
verif(a4.includes('--match-filter !is_live & duration<=180'), 'filtre « !is_live & duration<=180 » (sans « ? »)', a4.match(/--match-filter [^-]*/)?.[0] || 'absent')
verif(/--use-extractors TikTok,vm\\\.tiktok,Instagram(?: |$)/.test(a4), 'extracteurs limités à TikTok, vm.tiktok, Instagram', a4.match(/--use-extractors \S*/)?.[0] || 'absent')

console.log('S5 · client honnête : lien sans « www » https://tiktok.com/@compte/video/…')
r = await lancer('s5', 'https://tiktok.com/@compte/video/7000000000000000005')
verif(r.ok && Math.abs(r.duree - 30) < 0.5, 'vidéo récupérée (30 s)', r.ok ? `durée ${r.duree}` : r.err)

console.log('S6 · client honnête : lien de partage Instagram https://www.instagram.com/share/reel/…')
r = await lancer('s6', 'https://www.instagram.com/share/reel/BAshare06/')
verif(r.ok && Math.abs(r.duree - 30) < 0.5, 'vidéo récupérée (30 s)', r.ok ? `durée ${r.duree}` : r.err)

console.log('S7 · client honnête : lien court https://vm.tiktok.com/ZMVIDEO7/ vers une vidéo')
r = await lancer('s7', 'https://vm.tiktok.com/ZMVIDEO7/')
verif(r.ok && Math.abs(r.duree - 30) < 0.5, 'vidéo récupérée (30 s)', r.ok ? `durée ${r.duree}` : r.err)

console.log('S8 · vidéo publiée de 4 min (toujours refusée, pas de téléchargement)')
r = await lancer('s8', 'https://www.tiktok.com/@compte/video/7000000000000000004')
verif(!r.ok && r.fantomesVivants === 0, 'refusée', r.ok ? 'acceptée' : r.err)

console.log('S9 · lien de partage Instagram qui redirige vers un live')
r = await lancer('s9', 'https://www.instagram.com/share/BAlive08/')
verif(!r.ok && r.fantomesVivants === 0 && !r.fantomeGrossit, 'refusé, aucun ffmpeg orphelin', r.ok ? 'accepté' : `${r.err} / ${r.fantomesVivants} orphelin(s)`)

rmSync(RACINE, { recursive: true, force: true })
console.log(`\n${ok}/${total} vérifications OK`)
process.exit(ok === total ? 0 : 1)
