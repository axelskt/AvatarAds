// Déployé par Railway au push (watch render-worker/**) — 02/10 : le railway.json racine de factory-render bloquait ces déploiements depuis le 30/09.
// ── RETOUCHE « FORTE » DES VIDÉOS OMNI FLASH (Axel 02/10, validée sur la vidéo AXE) ─────────────────────────────
// Le moteur vidéo redessine chaque image : peau ~25 % plus lisse que la photo de départ (« effet plastique / filtre »).
// Après génération, on rapproche la vidéo de SA photo de départ, sans rien inventer :
//   1) couleurs : transfert moyenne / écart-type par canal RGB, calculé UNE fois sur la 1re image (pas de scintillement),
//      borné (le moteur ne dérive que de quelques %) ;
//   2) netteté : unsharp 7×7 à 0,8 (calibré pour égaler GaussianBlur σ1,3 × 0,75 de l'essai validé) ;
//   3) grain : bruit luma gaussien temporel dont l'écart-type = 1,6 × √(grain photo² − grain vidéo²), grain mesuré comme
//      la médiane |image − flou σ1,2| × 1,4826 (essai : photo 1,77, vidéo 1,33 → +1,86).
// ffmpeg seul (pas de Python sur l'image Railway). Aucun crédit : la vidéo est déjà payée.
import { execFile } from 'node:child_process'
import { horsBornes, BORNES_MEDIA } from './securite.mjs'

// Audit 04/10 (EXP-1, GEN-4) : la retouche passe DEVANT la file du moteur — chaque ffmpeg est borné dans le temps (tué au-delà :
// le job échoue, l'app et le MCP livrent la vidéo d'origine). Une vidéo de 10 s se retouche en ~10 s.
// 2e relecture 30/10 : tout est ASYNCHRONE (execFileSync bloquait la boucle du moteur : plus de battement ni de sonde pendant
// jusqu'à 3 min × 7 appels) ; chaque lecture d'image ne décode QU'UNE image (-frames:v 1, photo comprise : un MP4 renommé
// .jpg était décodé en entier, 3 fois, dans un tampon d'1 Go) ; tampon borné à la taille d'UNE image ; la « photo » doit être
// une image (PNG, JPEG ou WebP, 8192 px au plus) ; cadence de sortie ≤ 30 i/s (avant : -r de la source, sans plafond) ;
// la retouche entière tient en RETOUCHE_TOTAL_MS (100 s).
// 2e relecture 30/10 : la retouche ENTIÈRE (sondes, 6 lectures d'image, encodage) tient en RETOUCHE_TOTAL_MS — avant, 7 appels de
// 3 min chacun. L'app abandonne au bout de 150 s (vidéo d'origine livrée) : une retouche plus longue ne sert à personne, et une
// retouche honnête (10 s, 1080p, 24 i/s) prend quelques dizaines de secondes. Ce délai borne aussi l'attente d'une retouche
// honnête derrière une autre (une seule place « retouche » par défaut, RETOUCHE_MOTEURS_MAX).
export const RETOUCHE_TOTAL_MS = 100_000
const PHOTO_COTE_MAX = 8192
const CODECS_PHOTO = ['png', 'mjpeg', 'webp']
const RETOUCHE_FPS_MAX = 30   // Omni Flash / Veo : 24 i/s
let finRetouche = 0
const reste = () => { const ms = finRetouche - Date.now(); if (ms <= 0) throw new Error('retouche trop longue (délai dépassé)'); return ms }
const ffAsync = (args, maxBuffer) => new Promise((resolve, reject) => {
  execFile('ffmpeg', ['-nostdin', '-v', 'error', ...args], { encoding: 'buffer', maxBuffer, timeout: reste(), killSignal: 'SIGKILL' },
    (e, out, err) => (e ? reject(new Error('ffmpeg (retouche) ' + (e.killed ? 'arrêté (délai)' : '') + ' : ' + String(err || e.message || e).trim().split('\n').pop().slice(0, 200))) : resolve(out)))
})
const ffprobe = (args) => new Promise((resolve, reject) => {
  execFile('ffprobe', ['-v', 'error', ...args], { timeout: Math.min(30000, reste()), killSignal: 'SIGKILL', maxBuffer: 1 << 20 }, (e, out) => (e ? reject(e) : resolve(String(out).trim())))
})
const cadence = (fr) => { const [n, d] = String(fr || '').split('/').map(Number); return d ? n / d : Number(n) }

async function probe(file) {
  const out = await ffprobe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', file])
  const [w, h, fr] = out.split('\n')[0].split(',')
  let duree = NaN
  try { duree = parseFloat(await ffprobe(['-show_entries', 'format=duration', '-of', 'csv=p=0', file])) } catch (_) { /* illisible */ }
  return { W: +w, H: +h, fps: fr || '24/1', duree }
}
// la photo de départ : une IMAGE (premier flux vidéo = codec d'image), côtés bornés
async function controlerPhoto(file) {
  let l = ''
  try { l = (await ffprobe(['-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', file])).split('\n')[0] } catch (_) { /* illisible */ }
  const [codec, w, h] = l.split(',')
  if (!CODECS_PHOTO.includes(String(codec)) || !(+w > 0 && +h > 0)) throw new Error('photo de départ illisible (retouche)')
  if (+w > PHOTO_COTE_MAX || +h > PHOTO_COTE_MAX) throw new Error(`photo de départ trop grande (${PHOTO_COTE_MAX} px maximum par côté)`)
}
// image brute (rgb24 ou gray16le) à la taille W×H, éventuellement floutée — UNE image (la 1re), photo comme vidéo
async function raw(input, W, H, fmt, blur) {
  const vf = [`scale=${W}:${H}:flags=area`]
  if (fmt === 'gray16le') vf.push('format=gray16le')   // 16 bits : en 8 bits la médiane du grain s'arrondit à l'entier (1,33 ≈ 1,77)
  if (blur) vf.push(`gblur=sigma=${blur}`)
  const taille = W * H * (fmt === 'gray16le' ? 2 : 3)
  const b = await ffAsync(['-i', input, '-frames:v', '1', '-vf', vf.join(','), '-f', 'rawvideo', '-pix_fmt', fmt, '-'], taille + (1 << 20))
  if (b.length < taille) throw new Error('image illisible (retouche)')
  const x = b.subarray(0, taille)
  return fmt === 'gray16le' ? new Uint16Array(x.buffer.slice(x.byteOffset, x.byteOffset + taille)) : x
}
function rgbStats(buf) {
  const s = [0, 0, 0], q = [0, 0, 0], n = buf.length / 3
  for (let i = 0; i < buf.length; i += 3) for (let c = 0; c < 3; c++) { const v = buf[i + c]; s[c] += v; q[c] += v * v }
  return s.map((x, c) => { const m = x / n; return { m, sd: Math.sqrt(Math.max(1e-6, q[c] / n - m * m)) } })
}
function grain(g, b) {   // g, b : gray16le (0..65535) ; résultat en niveaux 8 bits
  const h = new Uint32Array(65536)
  for (let i = 0; i < g.length; i++) h[Math.abs(g[i] - b[i])]++
  let acc = 0; const half = g.length / 2
  for (let v = 0; v < 65536; v++) { acc += h[v]; if (acc >= half) return (v / 257) * 1.4826 }
  return 0
}

export async function retoucheVideo(base, photo, out, totalMs = RETOUCHE_TOTAL_MS) {
  finRetouche = Date.now() + totalMs   // un seul job à la fois par moteur (pollLoop)
  const { W, H, fps, duree } = await probe(base)
  // Audit 04/10 (EXP-1) : seule une vidéo d'Express (Omni Flash / Veo : 4 à 10 s, 1080p) est retouchée — n'importe quel MP4 du
  // dossier du compte (jusqu'à 500 Mo) était ré-encodé en entier, en priorité sur toute la file. Côtés lus AVANT d'allouer les
  // images brutes (W × H × 3 octets par lecture).
  if (!(W > 0 && H > 0)) throw new Error('vidéo illisible (retouche)')
  const refus = horsBornes({ duree, largeur: W, hauteur: H }, BORNES_MEDIA.retouche)
  if (refus) throw new Error(refus)
  await controlerPhoto(photo)
  const P = rgbStats(await raw(photo, W, H, 'rgb24', 0)), V = rgbStats(await raw(base, W, H, 'rgb24', 0))
  const gp = grain(await raw(photo, W, H, 'gray16le', 0), await raw(photo, W, H, 'gray16le', 1.2))
  const gv = grain(await raw(base, W, H, 'gray16le', 0), await raw(base, W, H, 'gray16le', 1.2))
  const ajout = 1.2 * 1.6 * Math.sqrt(Math.max(0, gp * gp - gv * gv))   // ×1,2 : gblur ffmpeg mesure ~20 % plus bas que le flou de l essai validé (1,42/1,04 vs 1,77/1,33)
  const S = ajout < 0.3 ? 0 : Math.max(0, Math.min(12, Math.round((ajout + 0.55) / 0.67)))   // vidéo déjà aussi granuleuse que la photo → AUCUN grain ajouté (02/10 : S valait 1 à tort)   // force ffmpeg noise → écart-type (calibré : 4 → 2,23)
  const lut = ['r', 'g', 'b'].map((c, i) => {
    const k = Math.min(1.15, Math.max(0.87, P[i].sd / V[i].sd)), off = Math.max(-25, Math.min(25, P[i].m - V[i].m))
    return `${c}='clip((val-${V[i].m.toFixed(2)})*${k.toFixed(4)}+${(V[i].m + off).toFixed(2)},0,255)'`
  }).join(':')
  const vf = `lutrgb=${lut},unsharp=7:7:0.8:7:7:0.8,format=yuv444p${S > 0 ? `,noise=c0s=${S}:c0f=t` : ''},format=yuv420p`
  // -t : la durée lue plus haut vient de l'en-tête du fichier (falsifiable) — l'encodage s'arrête de toute façon à la borne.
  // 2e relecture 30/10 : cadence de la source gardée jusqu'à 30 i/s (Omni / Veo : 24) ; au-delà (ou illisible) → 30.
  const f = cadence(fps), r = Number.isFinite(f) && f > 0 && f <= RETOUCHE_FPS_MAX ? fps : String(RETOUCHE_FPS_MAX)
  await ffAsync(['-y', '-i', base, '-vf', vf, '-map', '0:v', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-r', r,
    '-c:a', 'copy', '-t', String(BORNES_MEDIA.retouche.dureeMax), '-movflags', '+faststart', out], 1 << 20)
  return { grainPhoto: +gp.toFixed(2), grainVideo: +gv.toFixed(2), bruit: S, vf }
}
