#!/usr/bin/env node
// Faux yt-dlp du banc faille 2 (Décupleur, 30/10). AUCUN réseau : le « web » est une table de redirections ci-dessous.
// Le CHOIX de l'extracteur et le FILTRE (--use-extractors, --match-filter) sont ceux du VRAI yt-dlp (ytdlp-reel.py, bibliothèque
// installée), appliqués aux options reçues. Ensuite :
//   · extracteur de redirection (vm.tiktok / generic) → suit la table ;
//   · aucun extracteur → « ERROR: Unsupported URL » (code 1) ;
//   · filtre refusé → « does not pass filter » (code 0, aucun fichier), comme yt-dlp ;
//   · live accepté, ou vidéo « lente » (…0001) → lance un faux ffmpeg (processus ENFANT, même groupe, comme le Popen de
//     yt-dlp) qui écrit sans fin dans FAUX_DIR, puis attend pour toujours (le moteur doit tout tuer) ;
//   · sinon → copie FAUX_SOURCE (MP4 de 30 s) à la sortie -o.
// Comme le VRAI yt-dlp_linux du Dockerfile (PyInstaller « onefile ») : au lancement, son chargeur extrait Python dans
// $TMPDIR/_MEI<pid> (ici 1 Mo) et ne l'efface qu'à une sortie propre — sortie normale ou SIGTERM (relayé puis nettoyé) ;
// un SIGKILL le laisse. FAUX_TETU=1 : yt-dlp et son ffmpeg ignorent SIGTERM (seul SIGKILL les arrête).
'use strict'
const { appendFileSync, copyFileSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawn, execFileSync } = require('node:child_process')

const MEI = join(tmpdir(), `_MEI${process.pid}`)
mkdirSync(MEI, { recursive: true }); writeFileSync(join(MEI, 'libpython.so'), Buffer.alloc(1048576))
const nettoyer = () => { try { rmSync(MEI, { recursive: true, force: true }) } catch { /* déjà parti */ } }
process.on('exit', nettoyer)
process.on('SIGTERM', () => { if (process.env.FAUX_TETU !== '1') { nettoyer(); process.exit(143) } })

const args = process.argv.slice(2)
const DIR = process.env.FAUX_DIR
appendFileSync(join(DIR, 'appels.jsonl'), JSON.stringify(args) + '\n')
appendFileSync(join(DIR, 'fantomes.pid'), process.pid + '\n')   // yt-dlp lui-même doit aussi être mort après le job
const iLien = args.indexOf('--')
let url = args[iLien + 1]
const opts = args.slice(0, iLien)
const sortie = args[args.indexOf('-o') + 1]

const WEB = {
  'https://vm.tiktok.com/ZMLIVE01/': 'https://www.tiktok.com/@compte/live',
  'https://vm.tiktok.com/ZMVIDEO7/': 'https://www.tiktok.com/@compte/video/7000000000000000007',
  'https://tiktok.com/@compte/video/7000000000000000005': 'https://www.tiktok.com/@compte/video/7000000000000000005',
  'https://www.instagram.com/share/reel/BAshare06/': 'https://www.instagram.com/reel/DAreel06/',
}
const infos = (u) => /\/live(?:[/?#]|$)/.test(u) ? { is_live: true, live_status: 'is_live', duration: null }
  : /0004(?:[?#]|$)/.test(u) ? { is_live: false, duration: 240 }
  : /DAsansduree/.test(u) ? { is_live: false, duration: null }   // Reel dont InstagramIE n'a pas trouvé video_duration
  : { is_live: false, duration: 30 }

for (let saut = 0; saut < 6; saut++) {
  const r = JSON.parse(execFileSync(process.env.YTDLP_PY, ['-I', process.env.YTDLP_REEL, JSON.stringify(opts), url, JSON.stringify(infos(url))]).toString())
  if (!r.ie) { process.stderr.write(`ERROR: Unsupported URL: ${url}\n`); process.exit(1) }
  if (r.ie === 'TikTokVM' || r.ie === 'Generic') {
    if (!WEB[url]) { process.stderr.write(`ERROR: [${r.ie}] Unable to follow ${url}\n`); process.exit(1) }
    url = WEB[url]; continue
  }
  if (r.filtre) { process.stdout.write(`[download] ${r.filtre.replace(/^entry/, 'Vidéo')}\n`); process.exit(0) }
  if (r.ie === 'TikTokLive' || infos(url).is_live || /0001(?:[?#]|$)/.test(url)) {
    const n = Date.now() + '-' + process.pid
    const tuyau = process.env.FAUX_TUYAU === 'herite' ? ['ignore', 'ignore', 'inherit'] : 'ignore'
    const f = spawn(process.execPath, ['-e', "const fs=require('fs');if(process.env.FAUX_TETU==='1')process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(process.env.FICHIER,Buffer.alloc(65536)),100)"],
      { stdio: tuyau, env: { ...process.env, FICHIER: join(DIR, `fantome-${n}.ts`) } })
    appendFileSync(join(DIR, 'fantomes.pid'), f.pid + '\n')
    setInterval(() => {}, 1000)   // yt-dlp « enregistre » pour toujours
  } else {
    copyFileSync(process.env.FAUX_SOURCE, sortie.replace('%(ext)s', 'mp4'))
    process.exit(0)
  }
  break
}
