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
// 25/10 (Axel : « c'est normal c'est aussi long ? ») : chaque variante part dès qu'elle est prête (onVariante → le moteur
// l'envoie, l'app l'affiche) ; empreinte en UNE lecture (au lieu de 6 recherches) ; filtres moins coûteux à rendu égal
// (flou 3×3 sur la luminance au lieu de gblur, grain sur la luminance, netteté 3×3). Rotation gardée sur toutes les
// variantes : sans elle, deux variantes miroir tombaient au seuil d'écart entre elles (3 au lieu de 6,8).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir, availableParallelism } from 'node:os'
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
// 30/10 (audit Décupleur, faille 2) : un lien de LIVE (TikTok /@compte/live, m.tiktok.com/share/live/…, Instagram
// /<compte>/live/) est refusé AVANT yt-dlp — un direct n'a pas de fin, son enregistrement remplissait /tmp. Même règle que
// lienEstLive de supabase/functions/_shared/decupleur.ts. Chemin décodé (jusqu'à 3 fois) : « %6Cive » ne passe pas.
export function lienEstLive(u) {
  let chemin = String(u || '').replace(/^[a-z]+:\/\/[^/?#]*/i, '').split(/[?#]/)[0]
  for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(chemin); if (d === chemin) break; chemin = d } catch { break } }
  return /(?:^|\/)live(?:\/|$)/i.test(chemin)
}
export const lienDecupleurOk = (u) => typeof u === 'string' && LIEN.test(u) && !lienEstLive(u)
export const MSG_LIVE = 'Lien de live : le Décupleur ne prend que des vidéos publiées (3 min maximum)'

// yt-dlp est limité à SES extracteurs TikTok / Instagram (--use-extractors, noms vérifiés sur la version épinglée du Dockerfile :
// « TikTok » = /@compte/video/<id>, « vm.tiktok » = liens courts vm. / vt. / www.tiktok.com/t/, « Instagram » = /p/, /reel/,
// /tv/). Plus de « tiktok:live », ni de « generic » — qui suivait aussi les redirections des liens hors de ces formes. Ce que
// generic faisait pour un client honnête est refait ici : hôte ramené sur www (tiktok.com/…, m.tiktok.com/…,
// m.instagram.com/…), puis redirections suivies À LA MAIN (lien de partage instagram.com/share/…, ancien m.tiktok.com/v/…) :
// 4 sauts au plus, chaque étape revérifiée (hors TikTok / Instagram = arrêt ; vers un live = refus).
export const DC_EXTRACTEURS = 'TikTok,vm\\.tiktok,Instagram'
const FORMES_YTDLP = [
  /^https:\/\/www\.tiktok\.com\/(?:embed|(?:share|@[\w.-]*)\/video)\/\d+/,
  /^https:\/\/(?:(?:vm|vt)\.tiktok\.com|www\.tiktok\.com\/t)\/\w+/,
  /^https:\/\/(?:www\.)?instagram\.com(?:\/(?!share\/)[^/?#]+)?\/(?:p|tv|reels?(?!\/audio\/))\/[^/?#&]+/,
]
const hoteWww = (u) => u.replace(/^https:\/\/(?:m\.)?tiktok\.com\//i, 'https://www.tiktok.com/').replace(/^https:\/\/m\.instagram\.com\//i, 'https://www.instagram.com/')
export async function lienPourYtdlp(url, fetchFn = globalThis.fetch) {
  let u = hoteWww(url)
  for (let saut = 0; saut < 4 && !FORMES_YTDLP.some((r) => r.test(u)); saut++) {
    let r
    try {
      r = await fetchFn(u, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } })
    } catch { break }
    try { await r.body?.cancel() } catch { /* corps déjà fermé */ }
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null
    if (!loc) break
    let suivant
    try { suivant = new URL(loc, u).href.replace(/^http:\/\//i, 'https://') } catch { break }
    if (lienEstLive(suivant)) throw new Error(MSG_LIVE)
    if (!LIEN.test(suivant)) break
    u = hoteWww(suivant)
  }
  return u
}

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
  if (/unsupported url/i.test(m) && /\/live(?:[/?#\s]|$)/i.test(m)) return MSG_LIVE   // lien court (vm.tiktok) qui menait à un live
  if (/login|log in|cookies|private|unavailable for|requires authentication|rate.?limit/i.test(m)) return 'Vidéo privée ou protégée : ce lien demande une connexion — importe le fichier à la place'
  if (/not available|removed|404|does not exist|no video/i.test(m)) return 'Vidéo introuvable à ce lien'
  if (/File is larger|max-filesize/i.test(m)) return 'Vidéo trop lourde (300 Mo maximum)'
  if (/does not pass filter/i.test(m)) return `Vidéo trop longue (${DC_SOURCE_MAX / 60} min maximum)`
  return 'Impossible de récupérer cette vidéo — importe le fichier à la place'
}

// 25/10 : Railway Hobby donne 8 vCPU, mais le Décupleur y tourne comme sur ~1 cœur (143 s contre 10,6 s en local). Le
// quota réel du conteneur (cgroup v2 cpu.max « quota période », ou « max » = sans limite) tranche entre bride et code.
function quotaCpu() {
  try {
    const [q, p] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/)
    return q === 'max' ? 'illimité' : (Number(q) / Number(p)).toFixed(2) + ' cœur(s)'
  } catch { return 'inconnu' }
}
// 26/10 : calcul réellement consommé par le conteneur (cgroup v2 cpu.stat usage_usec, ffmpeg compris), en secondes ;
// null hors conteneur. Lu au début et à la fin d'un lot → « calcul X s, ~Y cœurs en moyenne » : dit si les 8 cœurs servent.
function calculCpu() {
  try { const m = /usage_usec (\d+)/.exec(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8')); return m ? Number(m[1]) / 1e6 : null } catch { return null }
}

// 30/10 (audit Décupleur, faille 2) : yt-dlp ASYNCHRONE dans SON groupe de processus (detached : il en est le chef, le ffmpeg
// qu'il lance pour un flux HLS ou la fusion y entre aussi). Au délai, TOUT le groupe est tué (SIGKILL sur -pid) ; avant,
// spawnSync ne tuait que yt-dlp et son ffmpeg orphelin enregistrait le live dans /tmp jusqu'au redémarrage du conteneur.
// Le groupe est aussi vidé à la sortie normale (aucun reste). Le battement du job continue pendant la récupération.
const DC_FETCH_MS = 240000
function ytdlp(args, ms = DC_FETCH_MS) {
  return new Promise((resolve) => {
    let p, sortie = '', fini = false, delai = false, code = null, signal = null, repli = null
    const tuerGroupe = () => { try { process.kill(-p.pid, 'SIGKILL') } catch { /* groupe déjà vide */ } }
    const finir = (r) => {
      if (fini) return
      fini = true; clearTimeout(t); clearTimeout(repli); tuerGroupe()
      try { p.stdout.destroy(); p.stderr.destroy() } catch { /* déjà fermés */ }
      resolve({ ...r, sortie })
    }
    const t = setTimeout(() => { delai = true; tuerGroupe() }, ms)
    try { p = spawn('yt-dlp', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { finir({ error: e }); return }
    const garder = (d) => { if (sortie.length < 65536) sortie += d }
    p.stdout.on('data', garder); p.stderr.on('data', garder)
    p.on('error', (e) => finir({ error: e }))
    const resultat = () => (delai ? { error: { code: 'ETIMEDOUT' } } : { status: code, signal })
    // sortie de yt-dlp : le reste du groupe est tué tout de suite ; « close » suit dès que les tuyaux sont fermés (2 s au plus)
    p.on('exit', (c, s) => { code = c; signal = s; tuerGroupe(); repli = setTimeout(() => finir(resultat()), 2000) })
    p.on('close', () => finir(resultat()))
  })
}

// Lien TikTok / Instagram → MP4 normalisé (outPath). Le lien est revérifié ici (le moteur ne lit QUE ces deux sites).
export async function dcFetch(url, outPath) {
  if (typeof url === 'string' && LIEN.test(url) && lienEstLive(url)) throw new Error(MSG_LIVE)
  if (!lienDecupleurOk(url)) throw new Error('Lien TikTok ou Instagram uniquement')
  const cible = await lienPourYtdlp(url)
  const tmp = mkdtempSync(join(tmpdir(), 'dc-lien-'))
  try {
    // filtre SANS « ? » : une durée inconnue (direct) ne passe plus ; « !is_live » écarte un live même si sa durée est connue
    const r = await ytdlp(['--ignore-config', '--no-cache-dir', '--no-playlist', '--no-warnings', '--no-progress', '--no-mtime',
      '--no-part', '--max-filesize', '300M', '--socket-timeout', '20', '--retries', '2', '--use-extractors', DC_EXTRACTEURS,
      '--match-filter', `!is_live & duration<=${DC_SOURCE_MAX}`,
      '-f', 'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4',
      '-o', join(tmp, 'source.%(ext)s'), '--', cible])
    if (r.error) throw new Error(r.error.code === 'ETIMEDOUT' ? 'Récupération trop longue — réessaie ou importe le fichier' : 'Récupération des liens indisponible')
    if (r.status !== 0) {
      const m = String(r.sortie || '').split('\n').filter((l) => /^ERROR/.test(l)).pop() || String(r.sortie || '').split('\n').filter(Boolean).pop() || ''
      console.warn('dc-fetch yt-dlp :', m.slice(0, 300))
      throw new Error(messageLien(m))
    }
    const f = readdirSync(tmp).find((n) => /^source\./.test(n) && !/\.(part|ytdl)$/.test(n))
    // vidéo écartée par le filtre : yt-dlp sort en 0 sans fichier (« does not pass filter ») — durée > 3 min, inconnue, ou live
    if (!f && /does not pass filter/i.test(r.sortie || '')) throw new Error(`Vidéo trop longue (${DC_SOURCE_MAX / 60} min maximum) ou live : importe une vidéo publiée`)
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
function bitsDe(buf, o) {
  const bits = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(buf[o + y * 9 + x] > buf[o + y * 9 + x + 1] ? 1 : 0)
  return bits
}
// 25/10 : les 6 images en UNE lecture du passage (select : la 1re image à 10 %, puis une tous les 15 %) — avant, 6 ffmpeg
// qui redécodaient chacun depuis l'image clé précédente (jusqu'à 150 images par recherche)
function empreinte(file, debut, duree) {
  const pas = 0.15 * duree, t1 = 0.1 * duree
  const sel = `select='if(isnan(prev_selected_t)\\,gte(t\\,${t1.toFixed(3)})\\,gte(t-prev_selected_t\\,${(pas - 0.02).toFixed(3)}))'`
  let buf = Buffer.alloc(0)
  try {
    buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', debut.toFixed(3), '-t', duree.toFixed(3), '-i', file, '-an',
      '-vf', `${sel},scale=9:8:flags=area,format=gray`, '-fps_mode', 'passthrough', '-frames:v', String(POSITIONS.length), '-f', 'rawvideo', '-'],
      { timeout: 120000, maxBuffer: 1 << 20 })
  } catch (e) { console.warn('empreinte :', String(e.message || e).slice(0, 200)) }
  return POSITIONS.map((_, k) => buf.length >= (k + 1) * 72 ? bitsDe(buf, k * 72) : null)
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
  // 25/10 : grain sur la luminance seule (pas de tavelures de couleur, un tiers de calcul en moins), flou 3×3 sur la
  // luminance (gblur coûtait 5 fois plus pour un flou de 0,35 à 0,6 px), netteté 3×3
  if (v.bruit) vf.push(`noise=c0s=${v.bruit}:c0f=t`)
  if (v.nettete && v.nettete.flou) vf.push('avgblur=sizeX=1:planes=1')
  if (v.nettete && v.nettete.net) vf.push(`unsharp=3:3:${v.nettete.net}:3:3:0`)
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

async function rendreVariante({ v, vSrc, vDebut, aSrc, aDebut, len, W, H, src, textePng, out, fils = 0 }) {
  const debut = v.debut, duree = Math.max(0.8, len - v.debut - v.fin)
  const { fc, vOut, aOut } = filtres(v, W, H, textePng, src)
  // fils (26/10) : variantes rendues par lots → chaque ffmpeg a sa part des cœurs (filtres + x264), sans s'écraser entre eux
  const args = [...(fils ? ['-filter_complex_threads', String(fils)] : []), '-ss', (vDebut + debut).toFixed(3), '-t', duree.toFixed(3), '-i', vSrc,
    '-ss', (aDebut + debut).toFixed(3), '-t', duree.toFixed(3), '-i', aSrc]
  if (textePng) args.push('-loop', '1', '-t', (duree / (v.vitesse || 1) + 0.5).toFixed(3), '-i', textePng)
  args.push('-filter_complex', fc, '-map', vOut, ...(aOut ? ['-map', aOut] : ['-an']),
    // débit PLAFONNÉ (le grain se compresse mal : sans plafond, une variante 1080×1920 de 15 s pesait jusqu'à 60 Mo)
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(v.crf), '-maxrate', maxrate(W, H) + 'k', '-bufsize', 2 * maxrate(W, H) + 'k',
    ...(fils ? ['-threads', String(fils)] : []), '-g', String(v.gop), '-pix_fmt', 'yuv420p', '-r', String(Math.round(src.fps)),
    ...(aOut ? ['-c:a', 'aac', '-b:a', v.abr, '-ar', String(v.ar), '-ac', '2'] : []),
    '-movflags', '+faststart', '-map_metadata', '-1', '-metadata', 'creation_time=' + v.date, out)
  await ffmpeg(args)
}

// Les N variantes de la vidéo, dans outDir (v01.mp4…, v01.jpg…, dc.json, variantes.zip si ≤ 250 Mo).
// master = vidéo du changement de personnage (déjà limitée au passage : sa piste vidéo remplace celle de src, le son reste
// celui de src). onProgress(0–100) est attendu entre deux variantes (battement du job + barre de l'app).
// 25/10 : onVariante(nom) est attendu dès qu'une variante est finie (MP4 + affiche) : le moteur l'envoie tout de suite et
// l'app l'affiche pendant que les suivantes se fabriquent. Une erreur d'envoi n'arrête rien (renvoi à la fin).
export async function dcVariantes({ src, master = null, outDir, a, b, n, alt = {}, textPos = 'Aléatoire', seed = Date.now(), onProgress = async () => {}, onVariante = async () => {} }) {
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
  console.log(`▶ décupleur ×${n} (${lenV.toFixed(1)} s, ${W}×${H}) sur ${availableParallelism()} cœur(s) · quota CPU ${quotaCpu()}`)

  const params = tirerParametres(n, alt, textPos, Number(seed) >>> 0, liste.length, lenV)
  const cpu0 = calculCpu(), t0 = Date.now()
  // 26/10 (Axel) : variantes rendues PAR LOTS. Test Railway du 26/10 : 8 cœurs et quota de 8, mais une variante à la fois
  // avec des filtres ffmpeg mono-fil → ~1 cœur occupé (×5 sur 7,6 s = 99 s). LOT ffmpeg tournent en même temps (FILS fils
  // chacun) ; l'acceptation reste dans l'ordre v01, v02… avec la même règle (assez loin de l'original et des variantes
  // déjà gardées, sinon 2e passe recadrée), et chaque variante part dès qu'elle est gardée (onVariante).
  const coeurs = availableParallelism(), LOT = Math.max(1, Math.min(4, Math.floor(coeurs / 2))), FILS = Math.max(1, Math.floor(coeurs / LOT))
  const nomDe = (v) => 'v' + String(v.i + 1).padStart(2, '0')
  const rendre = async (v) => {   // un essai : rendu + empreinte
    const out = join(outDir, nomDe(v) + '.mp4'), t = Date.now()
    await rendreVariante({ v, vSrc, vDebut, aSrc: src, aDebut: a, len: lenV, W, H, src: info,
      textePng: v.texte != null ? join(TEXTES_DIR, liste[v.texte].fichier) : null, out, fils: LOT > 1 ? FILS : 0 })
    return { emp: empreinte(out, 0, dcProbe(out).dur || lenV), s: (Date.now() - t) / 1000 }
  }
  // places de rendu : au plus LOT ffmpeg à la fois (1ers essais de la file + 2e passe éventuelle)
  let libres = LOT; const enAttente = []
  const prendre = () => libres > 0 ? (libres--, Promise.resolve()) : new Promise((r) => enAttente.push(r))
  const rendrePlace = () => { const r = enAttente.shift(); if (r) r(); else libres++ }
  const avecPlace = async (f) => { await prendre(); try { return await f() } finally { rendrePlace() } }
  const premiers = params.map((v) => { const p = avecPlace(() => rendre(v)); p.catch(() => {}); return p })   // attendue plus bas, dans l'ordre
  console.log(`  rendu par lots : ${LOT} à la fois, ${LOT > 1 ? FILS : 'tous les'} fil(s) chacun`)
  const faites = []   // { v, nom, emp }
  for (let i = 0; i < params.length; i++) {
    let v = params[i], essais = 1
    const nom = nomDe(v)
    let r = await premiers[i]
    let emp = r.emp, rendu = r.s
    let dOrig = distance(emp, ref), dMin = faites.reduce((m, f) => Math.min(m, distance(emp, f.emp)), 64)
    if (!(dOrig >= SEUIL_ORIGINAL && dMin >= SEUIL_ENTRE)) {
      // trop proche : même variante, cadrage plus serré et décalé (et rotation si « Pixels & grain »), une 2e passe
      v = { ...v, zoom: Math.min(1.2, v.zoom + 0.05), ox: 1 - v.ox, oy: 1 - v.oy, ...(alt.pixels ? { rotation: (v.rotation || 0.5) * 1.4 } : {}) }
      essais = 2
      r = await avecPlace(() => rendre(v))
      emp = r.emp; rendu += r.s
      dOrig = distance(emp, ref); dMin = faites.reduce((m, f) => Math.min(m, distance(emp, f.emp)), 64)
    }
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '0.5', '-i', join(outDir, nom + '.mp4'), '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', join(outDir, nom + '.jpg')], { timeout: 60000 })
    } catch (e) { console.warn('affiche', nom, e.message) }
    faites.push({ v, nom, emp, dOrig: +dOrig.toFixed(1), dMin: +dMin.toFixed(1) })
    console.log(`  ${nom} ${rendu.toFixed(1)} s${essais > 1 ? ' (re-tirée)' : ''}`)
    try { await onVariante(nom) } catch (e) { console.warn('envoi', nom, String(e.message || e).slice(0, 200)) }
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
  const cpu1 = calculCpu(), duree = (Date.now() - t0) / 1000
  const charge = cpu0 != null && cpu1 != null ? `, calcul ${(cpu1 - cpu0).toFixed(0)} s sur ${duree.toFixed(0)} s (~${((cpu1 - cpu0) / duree).toFixed(1)} cœurs en moyenne)` : ''
  console.log(`✓ décupleur ×${n} (${len.toFixed(1)} s) — contrôle ${manifeste.controle}${faibles ? ` (${faibles} proches)` : ''}, ${(total / 1048576).toFixed(0)} Mo${zip ? ', zip' : ''}${charge}`)
  return manifeste
}
