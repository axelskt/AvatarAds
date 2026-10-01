// ── RETOUCHE « FORTE » DES VIDÉOS OMNI FLASH (Axel 02/10, validée sur la vidéo AXE) ─────────────────────────────
// Le moteur vidéo redessine chaque image : peau ~25 % plus lisse que la photo de départ (« effet plastique / filtre »).
// Après génération, on rapproche la vidéo de SA photo de départ, sans rien inventer :
//   1) couleurs : transfert moyenne / écart-type par canal RGB, calculé UNE fois sur la 1re image (pas de scintillement),
//      borné (le moteur ne dérive que de quelques %) ;
//   2) netteté : unsharp 7×7 à 0,8 (calibré pour égaler GaussianBlur σ1,3 × 0,75 de l'essai validé) ;
//   3) grain : bruit luma gaussien temporel dont l'écart-type = 1,6 × √(grain photo² − grain vidéo²), grain mesuré comme
//      la médiane |image − flou σ1,2| × 1,4826 (essai : photo 1,77, vidéo 1,33 → +1,86).
// ffmpeg seul (pas de Python sur l'image Railway). Aucun crédit : la vidéo est déjà payée.
import { execFileSync } from 'node:child_process'

const ff = (args, opts = {}) => execFileSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 1 << 30, ...opts })

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', file]).toString().trim()
  const [w, h, fr] = out.split(',')
  return { W: +w, H: +h, fps: fr || '24/1' }
}
// image brute (rgb24 ou gray) à la taille W×H, éventuellement floutée
function raw(input, W, H, fmt, blur, isVideo) {
  const vf = [`scale=${W}:${H}:flags=area`]
  if (fmt === 'gray16le') vf.push('format=gray16le')   // 16 bits : en 8 bits la médiane du grain s'arrondit à l'entier (1,33 ≈ 1,77)
  if (blur) vf.push(`gblur=sigma=${blur}`)
  const b = ff([...(isVideo ? ['-i', input, '-frames:v', '1'] : ['-i', input]), '-vf', vf.join(','), '-f', 'rawvideo', '-pix_fmt', fmt, '-'])
  return fmt === 'gray16le' ? new Uint16Array(b.buffer, b.byteOffset, b.length / 2) : b
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

export function retoucheVideo(base, photo, out) {
  const { W, H, fps } = probe(base)
  const P = rgbStats(raw(photo, W, H, 'rgb24', 0, false)), V = rgbStats(raw(base, W, H, 'rgb24', 0, true))
  const gp = grain(raw(photo, W, H, 'gray16le', 0, false), raw(photo, W, H, 'gray16le', 1.2, false))
  const gv = grain(raw(base, W, H, 'gray16le', 0, true), raw(base, W, H, 'gray16le', 1.2, true))
  const ajout = 1.2 * 1.6 * Math.sqrt(Math.max(0, gp * gp - gv * gv))   // ×1,2 : gblur ffmpeg mesure ~20 % plus bas que le flou de l essai validé (1,42/1,04 vs 1,77/1,33)
  const S = Math.max(0, Math.min(12, Math.round((ajout + 0.55) / 0.67)))   // force ffmpeg noise → écart-type (calibré : 4 → 2,23)
  const lut = ['r', 'g', 'b'].map((c, i) => {
    const k = Math.min(1.15, Math.max(0.87, P[i].sd / V[i].sd)), off = Math.max(-25, Math.min(25, P[i].m - V[i].m))
    return `${c}='clip((val-${V[i].m.toFixed(2)})*${k.toFixed(4)}+${(V[i].m + off).toFixed(2)},0,255)'`
  }).join(':')
  const vf = `lutrgb=${lut},unsharp=7:7:0.8:7:7:0.8,format=yuv444p${S > 0 ? `,noise=c0s=${S}:c0f=t` : ''},format=yuv420p`
  ff(['-y', '-i', base, '-vf', vf, '-map', '0:v', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-r', fps,
    '-c:a', 'copy', '-movflags', '+faststart', out])
  return { grainPhoto: +gp.toFixed(2), grainVideo: +gv.toFixed(2), bruit: S, vf }
}
