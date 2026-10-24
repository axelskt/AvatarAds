// ── DÉCUPLEUR (Axel 24/10) ─────────────────────────────────────────────────────────────────────────────────────
// Une vidéo → N variantes TOUTES différentes, pour publier plusieurs fois sans être vu comme un doublon. Trois jobs :
//   · dc-fetch    : lien TikTok / Instagram → MP4 (yt-dlp, binaire épinglé dans le Dockerfile), normalisé H.264 / AAC ;
//   · dc-cut      : le passage gardé [a, b] seul (≤ 15 s) — c'est la vidéo de référence du changement de personnage ;
//   · decupleur   : les N variantes + leurs affiches + contrôle des empreintes + ZIP.
// Chaque variante tire SA combinaison d'altérations (graine par variante, valeurs réparties sur une grille mélangée : deux
// variantes n'ont jamais le même zoom, la même teinte, la même vitesse ni la même hauteur de voix). Même toutes les options
// coupées, cadrage, découpe au millième et encodage changent d'une variante à l'autre (fichiers jamais identiques).
// Contrôle : empreinte visuelle (dHash 64 bits sur 6 images) de chaque variante comparée à l'original ET aux autres ;
// trop proche → re-tirée une fois plus fort ; le résultat (distances) est écrit dans dc.json.
// ffmpeg seul (textes choc = PNG pré-rendus, tools/decupleur/textes-choc.py : aucune dépendance à drawtext).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEXTES_DIR = join(HERE, 'assets', 'dc-textes')
export const DC_VARIANTES = [5, 10, 20, 50]
export const DC_PASSAGE_MAX = 60          // secondes gardées, sans changement de personnage
export const DC_PERSO_MAX = 15            // secondes gardées avec changement de personnage (référence kie : 15 s au total)
export const DC_BUDGET_S = 900            // N × passage ≤ 15 min de vidéo produite par job
export const DC_SOURCE_MAX = 180          // vidéo récupérée par lien : 3 min au plus
const ZIP_MAX = 250 * 1024 * 1024         // le ZIP est lu en mémoire par le moteur pour l'envoi : au-delà, téléchargement variante par variante
const FF_MS = 10 * 60 * 1000

const LIEN = /^https:\/\/(?:(?:www|m|vm|vt)\.)?(?:tiktok\.com|instagram\.com)\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{1,400}$/
export const lienDecupleurOk = (u) => typeof u === 'string' && LIEN.test(u)

// ffmpeg asynchrone : le battement du job (setInterval du moteur) continue pendant les longs encodages
function ffmpeg(args, ms = FF_MS) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    const t = setTimeout(() => { p.kill('SIGKILL') }, ms)
    p.stderr.on('data', (d) => { if (err.length < 4000) err += d })
    p.on('error', (e) => { clearTimeout(t); reject(e) })
    p.on('close', (code, sig) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error('ffmpeg ' + (sig || code) + ' : ' + err.trim().split('\n').pop())) })
  })
}

export function dcProbe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,width,height,r_frame_rate,sample_rate:stream_tags=rotate:stream_side_data=rotation:format=duration',
    '-of', 'json', file], { timeout: 30000 }).toString())
  const v = (j.streams || []).find((s) => s.codec_type === 'video')
  const a = (j.streams || []).find((s) => s.codec_type === 'audio')
  if (!v) throw new Error('aucune piste vidéo')
  let w = +v.width, h = +v.height
  const rot = Math.abs(Number((v.tags && v.tags.rotate) || ((v.side_data_list || []).find((d) => d.rotation != null) || {}).rotation || 0))
  if (rot === 90 || rot === 270) [w, h] = [h, w]   // ffmpeg redresse la vidéo au décodage : on raisonne sur l'image redressée
  const [fn, fd] = String(v.r_frame_rate || '30/1').split('/').map(Number)
  const fps = Math.min(60, Math.max(15, fd ? fn / fd : 30))
  return { w, h, fps, dur: parseFloat((j.format || {}).duration) || NaN, audio: !!a, sr: Math.min(48000, Math.max(16000, +(a && a.sample_rate) || 48000)) }
}

const pair = (x) => Math.max(2, Math.round(x / 2) * 2)
// côtés ramenés dans [minCote, maxCote] (le plus grand ≤ maxCote, le plus petit ≥ minCote), pairs
function cotes(w, h, maxCote = 1920, minCote = 240) {
  let k = Math.min(1, maxCote / Math.max(w, h))
  if (Math.min(w, h) * k < minCote) k = minCote / Math.min(w, h)
  return { W: pair(w * k), H: pair(h * k) }
}

async function normaliser(src, out, p, { ss = 0, t = 0 } = {}) {
  const { W, H } = cotes(p.w, p.h)
  await ffmpeg([...(ss > 0 ? ['-ss', ss.toFixed(3)] : []), '-i', src, ...(t > 0 ? ['-t', t.toFixed(3)] : []),
    '-map', '0:v:0', '-map', '0:a:0?', '-vf', `scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1', out])
}

function messageLien(m) {
  if (/login|log in|cookies|private|unavailable for|requires authentication|rate.?limit/i.test(m)) return 'Vidéo privée ou protégée : ce lien demande une connexion — importe le fichier à la place'
  if (/not available|removed|404|does not exist|no video/i.test(m)) return 'Vidéo introuvable à ce lien'
  if (/File is larger|max-filesize/i.test(m)) return 'Vidéo trop lourde (300 Mo maximum)'
  if (/does not pass filter/i.test(m)) return `Vidéo trop longue (${DC_SOURCE_MAX / 60} min maximum)`
  return 'Impossible de récupérer cette vidéo — importe le fichier à la place'
}

// Lien TikTok / Instagram → MP4 normalisé (outPath). Le lien est revérifié ici (le moteur ne lit QUE ces deux sites).
export async function dcFetch(url, outPath) {
  if (!lienDecupleurOk(url)) throw new Error('Lien TikTok ou Instagram uniquement')
  const tmp = mkdtempSync(join(tmpdir(), 'dc-lien-'))
  try {
    const r = spawnSync('yt-dlp', ['--ignore-config', '--no-cache-dir', '--no-playlist', '--no-warnings', '--no-progress', '--no-mtime',
      '--no-part', '--max-filesize', '300M', '--socket-timeout', '20', '--retries', '2', '--match-filter', `duration <=? ${DC_SOURCE_MAX}`,
      '-f', 'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4',
      '-o', join(tmp, 'source.%(ext)s'), '--', url], { timeout: 240000, encoding: 'utf8', maxBuffer: 1 << 24 })
    if (r.error) throw new Error(r.error.code === 'ETIMEDOUT' ? 'Récupération trop longue — réessaie ou importe le fichier' : 'Récupération des liens indisponible')
    if (r.status !== 0) {
      const m = String(r.stderr || '').split('\n').filter(Boolean).pop() || ''
      console.warn('dc-fetch yt-dlp :', m.slice(0, 300))
      throw new Error(messageLien(m))
    }
    const f = readdirSync(tmp).find((n) => /^source\./.test(n) && !/\.(part|ytdl)$/.test(n))
    if (!f) throw new Error('Vidéo introuvable à ce lien')
    const src = join(tmp, f), p = dcProbe(src)
    if (!(p.dur > 0)) throw new Error('Vidéo illisible')
    if (p.dur > DC_SOURCE_MAX + 1) throw new Error(`Vidéo trop longue (${DC_SOURCE_MAX / 60} min maximum)`)
    await normaliser(src, outPath, p)
    console.log(`✓ dc-fetch ${p.w}×${p.h} ${p.dur.toFixed(1)} s`)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// Passage gardé seul, ≤ 15 s (référence du changement de personnage : 1–15 s, côtés 240–4096 px, ≤ 100 Mo).
export async function dcCut(src, outPath, a, b) {
  const p = dcProbe(src)
  a = Math.max(0, Number(a) || 0); b = Math.min(p.dur || 0, Number(b) || 0)
  if (!(b - a >= 1)) throw new Error('Passage trop court (1 s minimum)')
  if (b - a > DC_PERSO_MAX + 0.05) throw new Error(`Passage de ${DC_PERSO_MAX} s maximum avec le changement de personnage`)
  await normaliser(src, outPath, p, { ss: a, t: b - a })
}

// ── tirage des paramètres ──────────────────────────────────────────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function melange(n, r) { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
// valeur i de n, répartie sur [lo, hi] (une case de grille par variante, ordre mélangé) — deux variantes ne tombent jamais ensemble
const grille = (perm, i, n, lo, hi, r) => lo + (hi - lo) * ((perm[i] + 0.15 + 0.7 * r()) / n)
// idem sur ±[lo, hi], signe alterné (jamais autour de 0)
const grilleSigne = (perm, i, n, lo, hi, r) => (perm[i] % 2 ? -1 : 1) * grille(perm, i, n, lo, hi, r)

export function tirerParametres(n, alt, textPos, seed, nbTextes, len) {
  const r = rng(seed)
  const P = Array.from({ length: 8 }, () => melange(n, r))
  const textes = melange(nbTextes, r)
  const out = []
  for (let i = 0; i < n; i++) {
    const v = { i }
    v.miroir = !!alt.mirror && i % 2 === 1
    // cadrage : toujours un peu (fichiers jamais identiques), nettement plus avec « Pixels & grain »
    v.zoom = alt.pixels ? grille(P[0], i, n, 1.04, 1.12, r) : grille(P[0], i, n, 1.012, 1.04, r)
    v.ox = r(); v.oy = r()
    v.rotation = alt.pixels ? grilleSigne(P[1], i, n, 0.35, 1.0, r) : 0
    v.bruit = alt.pixels ? Math.round(grille(P[2], i, n, 2, 6, r)) : 0
    v.reechant = alt.pixels && i % 2 === 0 ? grille(P[2], i, n, 0.8, 0.93, r) : 0
    v.nettete = alt.pixels ? (i % 3 === 0 ? { flou: +grille(P[3], i, n, 0.35, 0.6, r).toFixed(2) } : { net: +grille(P[3], i, n, 0.35, 0.8, r).toFixed(2) }) : null
    if (alt.tint) {
      // ±3 à 9° seulement : au-delà la peau vire au rose / vert (vu sur une vidéo face caméra le 24/10)
      v.teinte = +grilleSigne(P[4], i, n, 3, 9, r).toFixed(1)
      v.saturation = +(0.94 + 0.14 * r()).toFixed(3)
      v.lumiere = +(-0.035 + 0.07 * r()).toFixed(3)
      v.contraste = +(0.95 + 0.12 * r()).toFixed(3)
      v.gamma = +(0.94 + 0.12 * r()).toFixed(3)
    }
    if (alt.audio) {
      v.vitesse = +(1 + grilleSigne(P[5], i, n, 0.012, 0.045, r)).toFixed(4)
      v.hauteur = +(1 + grilleSigne(P[6], i, n, 0.008, 0.03, r)).toFixed(4)
      v.eq = [{ f: Math.round(150 + 250 * r()), g: +((r() < 0.5 ? -1 : 1) * (1.5 + 2.5 * r())).toFixed(1) },
              { f: Math.round(2000 + 4000 * r()), g: +((r() < 0.5 ? -1 : 1) * (1.5 + 2.5 * r())).toFixed(1) }]
      v.volume = +(0.9 + 0.15 * r()).toFixed(3)
    }
    if (alt.text && i % 2 === 0) {
      v.texte = textes[Math.floor(i / 2) % nbTextes]
      v.position = textPos === 'Haut' || textPos === 'Centre' || textPos === 'Bas' ? textPos : ['Haut', 'Centre', 'Bas'][Math.floor(r() * 3)]
    }
    // découpe au millième (début / fin) + encodage propres à la variante
    v.debut = len > 2.5 ? +(0.12 * r()).toFixed(3) : 0
    v.fin = len > 2.5 ? +(0.12 * r()).toFixed(3) : 0
    v.crf = 19 + Math.floor(4 * r()); v.gop = 45 + Math.floor(105 * r())
    v.abr = ['128k', '160k', '192k'][Math.floor(3 * r())]; v.ar = r() < 0.5 ? 44100 : 48000
    v.date = new Date(Date.now() - Math.floor(r() * 60 * 86400000)).toISOString()
    out.push(v)
  }
  return out
}

// ── empreinte visuelle (dHash 9×8 → 64 bits) ──────────────────────────────────────────────────────────────────
const POSITIONS = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]
function dhashImage(file, t) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-'],
    { timeout: 60000, maxBuffer: 1 << 20 })
  if (buf.length < 72) return null
  const bits = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(buf[y * 9 + x] > buf[y * 9 + x + 1] ? 1 : 0)
  return bits
}
function empreinte(file, debut, duree) {
  return POSITIONS.map((q) => dhashImage(file, debut + q * duree))
}
function distance(e1, e2) {
  let s = 0, k = 0
  for (let i = 0; i < e1.length; i++) {
    if (!e1[i] || !e2[i]) continue
    let d = 0; for (let b = 0; b < 64; b++) d += e1[i][b] !== e2[i][b] ? 1 : 0
    s += d; k++
  }
  return k ? s / k : 0
}
export const SEUIL_ORIGINAL = 6, SEUIL_ENTRE = 3

// ── une variante ──────────────────────────────────────────────────────────────────────────────────────────────
function filtres(v, W, H, textePng, src) {
  const vf = ['setpts=PTS-STARTPTS']
  if (v.miroir) vf.push('hflip')
  let z = v.zoom
  if (v.rotation) {
    const th = Math.abs(v.rotation) * Math.PI / 180
    z = Math.max(z, Math.cos(th) + (Math.max(W, H) / Math.min(W, H)) * Math.sin(th) + 0.006)   // les coins noirs restent hors cadre
    vf.push(`rotate=${(v.rotation * Math.PI / 180).toFixed(5)}:ow=iw:oh=ih:c=black`)
  }
  const ZW = pair(W * z), ZH = pair(H * z)
  vf.push(`scale=${ZW}:${ZH}:flags=bicubic`, `crop=${W}:${H}:${Math.floor((ZW - W) * v.ox)}:${Math.floor((ZH - H) * v.oy)}`)
  if (v.reechant) vf.push(`scale=${pair(W * v.reechant)}:${pair(H * v.reechant)}:flags=bilinear`, `scale=${W}:${H}:flags=bicubic`)
  if (v.teinte != null) vf.push(`hue=h=${v.teinte}:s=${v.saturation}`, `eq=brightness=${v.lumiere}:contrast=${v.contraste}:gamma=${v.gamma}`)
  if (v.bruit) vf.push(`noise=alls=${v.bruit}:allf=t`)
  if (v.nettete && v.nettete.flou) vf.push(`gblur=sigma=${v.nettete.flou}`)
  if (v.nettete && v.nettete.net) vf.push(`unsharp=5:5:${v.nettete.net}:5:5:0`)
  if (v.vitesse) vf.push(`setpts=PTS/${v.vitesse}`)
  vf.push('setsar=1', 'format=yuv420p')
  let fc = `[0:v]${vf.join(',')}[v0]`
  let vOut = '[v0]'
  if (textePng) {
    const y = v.position === 'Haut' ? `${Math.round(H * 0.14)}` : v.position === 'Bas' ? `${Math.round(H * 0.72)}-h/2` : '(H-h)/2'
    fc += `;[2:v]scale=${pair(W * 0.92)}:-2:flags=lanczos,format=rgba[tx];[v0][tx]overlay=(W-w)/2:${y}:shortest=1:format=auto,format=yuv420p[v1]`
    vOut = '[v1]'
  }
  let aOut = null
  if (src.audio) {
    const af = ['asetpts=PTS-STARTPTS']
    if (v.hauteur) af.push(`asetrate=${Math.round(src.sr * v.hauteur)}`, `aresample=${src.sr}`)
    const tempo = (v.vitesse || 1) / (v.hauteur || 1)
    if (Math.abs(tempo - 1) > 0.0005) af.push(`atempo=${tempo.toFixed(5)}`)
    for (const e of v.eq || []) af.push(`equalizer=f=${e.f}:t=q:w=1.2:g=${e.g}`)
    if (v.volume) af.push(`volume=${v.volume}`)
    fc += `;[1:a]${af.join(',')}[a0]`
    aOut = '[a0]'
  }
  return { fc, vOut, aOut }
}

const maxrate = (W, H) => Math.round(Math.min(6000, Math.max(1500, 6000 * (W * H) / (1080 * 1920))))

async function rendreVariante({ v, vSrc, vDebut, aSrc, aDebut, len, W, H, src, textePng, out }) {
  const debut = v.debut, duree = Math.max(0.8, len - v.debut - v.fin)
  const { fc, vOut, aOut } = filtres(v, W, H, textePng, src)
  const args = ['-ss', (vDebut + debut).toFixed(3), '-t', duree.toFixed(3), '-i', vSrc,
    '-ss', (aDebut + debut).toFixed(3), '-t', duree.toFixed(3), '-i', aSrc]
  if (textePng) args.push('-loop', '1', '-t', (duree / (v.vitesse || 1) + 0.5).toFixed(3), '-i', textePng)
  args.push('-filter_complex', fc, '-map', vOut, ...(aOut ? ['-map', aOut] : ['-an']),
    // débit PLAFONNÉ (le grain se compresse mal : sans plafond, une variante 1080×1920 de 15 s pesait jusqu'à 60 Mo)
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(v.crf), '-maxrate', maxrate(W, H) + 'k', '-bufsize', 2 * maxrate(W, H) + 'k',
    '-g', String(v.gop), '-pix_fmt', 'yuv420p', '-r', String(Math.round(src.fps)),
    ...(aOut ? ['-c:a', 'aac', '-b:a', v.abr, '-ar', String(v.ar), '-ac', '2'] : []),
    '-movflags', '+faststart', '-map_metadata', '-1', '-metadata', 'creation_time=' + v.date, out)
  await ffmpeg(args)
}

// Les N variantes de la vidéo, dans outDir (v01.mp4…, v01.jpg…, dc.json, variantes.zip si ≤ 250 Mo).
// master = vidéo du changement de personnage (déjà limitée au passage : sa piste vidéo remplace celle de src, le son reste
// celui de src). onProgress(0–100) est attendu entre deux variantes (battement du job + barre de l'app).
export async function dcVariantes({ src, master = null, outDir, a, b, n, alt = {}, textPos = 'Aléatoire', seed = Date.now(), onProgress = async () => {} }) {
  if (!DC_VARIANTES.includes(n)) throw new Error('nombre de variantes invalide')
  mkdirSync(outDir, { recursive: true })
  const pSrc = dcProbe(src)
  a = Math.max(0, Number(a) || 0); b = Math.min(pSrc.dur || 0, Number(b) || 0)
  const len = b - a
  if (!(len >= 1)) throw new Error('Passage trop court (1 s minimum)')
  if (len > DC_PASSAGE_MAX + 0.05) throw new Error(`Passage de ${DC_PASSAGE_MAX} s maximum`)
  if (n * len > DC_BUDGET_S + 1) throw new Error(`Trop long pour ×${n} : garde ${Math.floor(DC_BUDGET_S / n)} s maximum`)
  const pV = master ? dcProbe(master) : pSrc
  const vSrc = master || src, vDebut = master ? 0 : a
  const lenV = master ? Math.min(len, pV.dur || len) : len
  const { W, H } = cotes(pV.w, pV.h)
  const info = { audio: pSrc.audio, sr: pSrc.sr, fps: pV.fps }
  const liste = JSON.parse(readFileSync(join(TEXTES_DIR, 'textes.json'), 'utf8'))
  const ref = empreinte(vSrc, vDebut, lenV)
  await onProgress(5)

  const params = tirerParametres(n, alt, textPos, Number(seed) >>> 0, liste.length, lenV)
  const faites = []   // { v, nom, emp }
  for (const v0 of params) {
    let v = v0, emp = null, dOrig = 0, dMin = 64
    const nom = 'v' + String(v.i + 1).padStart(2, '0')
    for (let essai = 0; essai < 2; essai++) {
      const textePng = v.texte != null ? join(TEXTES_DIR, liste[v.texte].fichier) : null
      await rendreVariante({ v, vSrc, vDebut, aSrc: src, aDebut: a, len: lenV, W, H, src: info, textePng, out: join(outDir, nom + '.mp4') })
      const d = dcProbe(join(outDir, nom + '.mp4')).dur || lenV
      emp = empreinte(join(outDir, nom + '.mp4'), 0, d)
      dOrig = distance(emp, ref)
      dMin = faites.reduce((m, f) => Math.min(m, distance(emp, f.emp)), 64)
      if (dOrig >= SEUIL_ORIGINAL && dMin >= SEUIL_ENTRE) break
      // trop proche : même variante, cadrage plus serré et décalé (et rotation si « Pixels & grain »)
      v = { ...v, zoom: Math.min(1.2, v.zoom + 0.05), ox: 1 - v.ox, oy: 1 - v.oy, ...(alt.pixels ? { rotation: (v.rotation || 0.5) * 1.4 } : {}) }
    }
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '0.5', '-i', join(outDir, nom + '.mp4'), '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', join(outDir, nom + '.jpg')], { timeout: 60000 })
    } catch (e) { console.warn('affiche', nom, e.message) }
    faites.push({ v, nom, emp, dOrig: +dOrig.toFixed(1), dMin: +dMin.toFixed(1) })
    await onProgress(Math.round(5 + 85 * faites.length / n))
  }

  // contrôle final : chaque paire de variantes + chaque variante face à l'original (distances recalculées sur l'ensemble)
  let faibles = 0
  for (const f of faites) {
    f.dMin = +faites.reduce((m, g) => g === f ? m : Math.min(m, distance(f.emp, g.emp)), 64).toFixed(1)
    if (f.dOrig < SEUIL_ORIGINAL || f.dMin < SEUIL_ENTRE) faibles++
  }
  await onProgress(94)
  const mp4 = faites.map((f) => join(outDir, f.nom + '.mp4'))
  const total = mp4.reduce((s, p) => s + statSync(p).size, 0)
  let zip = false
  if (total <= ZIP_MAX) {
    const z = spawnSync('zip', ['-0', '-j', '-q', join(outDir, 'variantes.zip'), ...mp4], { timeout: 300000 })
    zip = z.status === 0 && existsSync(join(outDir, 'variantes.zip'))
    if (!zip) console.warn('zip :', String(z.stderr || z.error || '').slice(0, 200))
  }
  const manifeste = {
    n, passage: +len.toFixed(3), largeur: W, hauteur: H, zip, controle: faibles ? 'faible' : 'ok', faibles,
    seuils: { original: SEUIL_ORIGINAL, entre: SEUIL_ENTRE },
    variantes: faites.map((f) => ({ fichier: f.nom + '.mp4', affiche: f.nom + '.jpg', distOriginal: f.dOrig, distMin: f.dMin,
      miroir: f.v.miroir, zoom: +f.v.zoom.toFixed(3), rotation: f.v.rotation ? +f.v.rotation.toFixed(2) : 0, teinte: f.v.teinte ?? 0,
      vitesse: f.v.vitesse ?? 1, hauteur: f.v.hauteur ?? 1, texte: f.v.texte != null ? liste[f.v.texte].texte : null, position: f.v.position || null })),
  }
  writeFileSync(join(outDir, 'dc.json'), JSON.stringify(manifeste))
  console.log(`✓ décupleur ×${n} (${len.toFixed(1)} s) — contrôle ${manifeste.controle}${faibles ? ` (${faibles} proches)` : ''}, ${(total / 1048576).toFixed(0)} Mo${zip ? ', zip' : ''}`)
  return manifeste
}
