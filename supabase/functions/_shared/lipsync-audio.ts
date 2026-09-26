// lipsync-audio.ts — l'audio ENVOYÉ à Hedra par le MCP (lipsync_video) et la coupe de la vidéo livrée.
//
// 26/09 (« le dernier mot n'est pas articulé », mesuré sur CTA28) : un audio qui s'arrête net sur le dernier phonème
// laisse Hedra (Avatar et Character-3) sans « contexte droit » → la dernière syllabe n'est pas articulée. On ne touche
// JAMAIS aux octets reçus (la brique de l'usine, la voix de l'utilisateur) : on fabrique une COPIE, complétée de silence
// jusqu'à 0,5 s après le dernier mot, et la vidéo livrée est recoupée à fin de parole + 0,3 s par sa liste d'éditions
// (edts/elst : aucun ré-encodage, aucun ffmpeg dans une edge function). Même règle que render-worker/lipsync-audio.mjs.
// Seul le WAV PCM (16/24/32 bits, flottant 32) est préparé ; tout autre format part tel quel (comportement d'avant).

const PAD = 0.5          // silence garanti après le dernier mot
const COUPE = 0.3        // coupe vidéo = fin de parole + 0,3 s
const QUEUE_MAX = 2.5    // au-delà de 2,5 s de silence après le dernier mot détecté, on ne coupe que ce qui dépasse l'audio
const r3 = (n: number) => Math.round(n * 1000) / 1000

const txt = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))

export interface WavInfo { fmt: number; ch: number; sr: number; bits: number; blockAlign: number; fmtOff: number; fmtLen: number; dataOff: number; dataLen: number }

export function lireWav(b: Uint8Array): WavInfo | null {
  if (b.length < 44 || txt(b, 0, 4) !== 'RIFF' || txt(b, 8, 4) !== 'WAVE') return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let off = 12
  let fmt = -1, ch = 0, sr = 0, bits = 0, blockAlign = 0, fmtOff = -1, fmtLen = 0, dataOff = -1, dataLen = 0
  while (off + 8 <= b.length) {
    const id = txt(b, off, 4), size = dv.getUint32(off + 4, true)
    if (id === 'fmt ' && size >= 16 && off + 8 + size <= b.length) {
      fmtOff = off; fmtLen = 8 + size
      fmt = dv.getUint16(off + 8, true); ch = dv.getUint16(off + 10, true); sr = dv.getUint32(off + 12, true)
      blockAlign = dv.getUint16(off + 20, true); bits = dv.getUint16(off + 22, true)
      if (fmt === 0xFFFE && size >= 26) fmt = dv.getUint16(off + 8 + 24, true)   // WAVE_FORMAT_EXTENSIBLE → sous-format
    } else if (id === 'data') { dataOff = off + 8; dataLen = Math.min(size, b.length - dataOff); break }
    off += 8 + size + (size & 1)
  }
  if (fmtOff < 0 || dataOff < 0 || !(ch > 0) || !(sr > 0) || !(blockAlign > 0)) return null
  const ok = (fmt === 1 && (bits === 16 || bits === 24 || bits === 32)) || (fmt === 3 && bits === 32)
  if (!ok || blockAlign !== ch * (bits / 8)) return null
  return { fmt, ch, sr, bits, blockAlign, fmtOff, fmtLen, dataOff, dataLen: dataLen - (dataLen % blockAlign) }
}

// Fin de parole : RMS par fenêtres de 50 ms, seuil relatif au pic (−25 dB, plancher −60 dBFS) — comme _expSpeechEnd.
export function finParoleWav(b: Uint8Array, w: WavInfo): { end: number; dur: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const n = Math.floor(w.dataLen / w.blockAlign)
  if (!n) return null
  const bps = w.bits / 8
  const lire = (o: number): number => {
    if (w.fmt === 3) return dv.getFloat32(o, true)
    if (w.bits === 16) return dv.getInt16(o, true) / 32768
    if (w.bits === 24) { const v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); return ((v << 8) >> 8) / 8388608 }
    return dv.getInt32(o, true) / 2147483648
  }
  const W = Math.max(1, Math.round(w.sr * 0.05))
  const db: number[] = []
  for (let i = 0; i < n; i += W) {
    let sum = 0, c = 0
    const e = Math.min(n, i + W)
    for (let j = i; j < e; j++) {
      const base = w.dataOff + j * w.blockAlign
      for (let k = 0; k < w.ch; k++) { const x = lire(base + k * bps); sum += x * x; c++ }
    }
    db.push(20 * Math.log10(Math.sqrt(sum / Math.max(1, c)) + 1e-9))
  }
  let peak = -Infinity
  for (const v of db) if (v > peak) peak = v
  if (!(peak > -40)) return null
  const thr = Math.max(-60, peak - 25)
  for (let i = db.length - 1; i >= 0; i--) if (db[i] > thr) return { end: r3(Math.min(n / w.sr, (i + 1) * 0.05)), dur: r3(n / w.sr) }
  return null
}

// COPIE du WAV + `padSec` de silence numérique (en-tête RIFF + fmt d'origine, un seul bloc data). L'entrée n'est pas modifiée.
export function wavAvecSilence(b: Uint8Array, w: WavInfo, padSec: number): Uint8Array {
  const padBytes = Math.round(padSec * w.sr) * w.blockAlign
  const dataLen = w.dataLen + padBytes
  const total = 12 + w.fmtLen + (w.fmtLen & 1) + 8 + dataLen + (dataLen & 1)
  const out = new Uint8Array(total)   // zéros = silence en PCM signé et en flottant
  const dv = new DataView(out.buffer)
  out.set([0x52, 0x49, 0x46, 0x46], 0); dv.setUint32(4, total - 8, true); out.set([0x57, 0x41, 0x56, 0x45], 8)
  out.set(b.subarray(w.fmtOff, w.fmtOff + w.fmtLen), 12)
  let o = 12 + w.fmtLen + (w.fmtLen & 1)
  out.set([0x64, 0x61, 0x74, 0x61], o); dv.setUint32(o + 4, dataLen, true); o += 8
  out.set(b.subarray(w.dataOff, w.dataOff + w.dataLen), o)
  return out
}

// Audio à envoyer + instant de coupe de la vidéo (timeline de la vidéo = celle de l'audio). null = format non géré
// (on envoie alors l'original, sans coupe : exactement le comportement d'avant).
export function preparerWavHedra(b: Uint8Array): { bytes: Uint8Array; padSec: number; finParole: number | null; dur: number; coupe: number | null } | null {
  const w = lireWav(b)
  if (!w) return null
  const dur = r3(Math.floor(w.dataLen / w.blockAlign) / w.sr)
  const f = finParoleWav(b, w)
  if (!f) return { bytes: b, padSec: 0, finParole: null, dur, coupe: null }
  const silence = Math.max(0, dur - f.end)
  const padSec = r3(Math.max(0, PAD - silence))
  const coupe = f.end > 1 ? r3(silence <= QUEUE_MAX ? f.end + COUPE : dur + COUPE) : null
  return { bytes: padSec >= 0.02 ? wavAvecSilence(b, w, padSec) : b, padSec: padSec >= 0.02 ? padSec : 0, finParole: f.end, dur, coupe }
}

// ── COUPE DE LA VIDÉO PAR SA LISTE D'ÉDITIONS ──────────────────────────────────────────────────────────────────
// Les MP4 de Hedra (Avatar comme Character-3) sont muxés par ffmpeg : chaque piste porte edts/elst à UNE entrée
// (vérifié sur 5 sorties réelles). On raccourcit, SUR PLACE et à taille égale, la durée de présentation (mvhd,
// tkhd, segment_duration de l'elst) : aucun octet de média n'est touché, les lecteurs (QuickTime/AVFoundation,
// Chrome/ffmpeg) s'arrêtent à `sec`. Structure inattendue → null (la vidéo part entière, comme avant).
interface Boite { type: string; off: number; hdr: number; size: number }
function boites(b: Uint8Array, dv: DataView, deb: number, fin: number): Boite[] | null {
  const out: Boite[] = []
  let off = deb
  while (off + 8 <= fin) {
    let size = dv.getUint32(off), hdr = 8
    if (size === 1) { if (off + 16 > fin) return null; size = Number(dv.getBigUint64(off + 8)); hdr = 16 }
    else if (size === 0) size = fin - off
    if (size < hdr || off + size > fin) return null
    out.push({ type: txt(b, off + 4, 4), off, hdr, size })
    off += size
  }
  return out
}
export function couperMp4(bytes: Uint8Array, sec: number): Uint8Array | null {
  if (!(sec > 0)) return null
  const b = bytes.slice()
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const top = boites(b, dv, 0, b.length)
  const moov = top && top.find((x) => x.type === 'moov')
  if (!moov) return null
  const kids = boites(b, dv, moov.off + moov.hdr, moov.off + moov.size)
  const mvhd = kids && kids.find((x) => x.type === 'mvhd')
  if (!kids || !mvhd) return null
  const mv = mvhd.off + mvhd.hdr, v = b[mv]
  const ts = v === 1 ? dv.getUint32(mv + 20) : dv.getUint32(mv + 12)
  const durOff = v === 1 ? mv + 24 : mv + 16
  const durMv = v === 1 ? Number(dv.getBigUint64(durOff)) : dv.getUint32(durOff)
  if (!(ts > 0)) return null
  const neuf = Math.round(sec * ts)
  if (!(neuf > 0) || neuf >= durMv) return null            // rien à couper
  const traks = kids.filter((x) => x.type === 'trak')
  if (!traks.length) return null
  const ecrire = (o: number, ver: number, val: number) => { if (ver === 1) dv.setBigUint64(o, BigInt(val)); else dv.setUint32(o, val) }
  const lireD = (o: number, ver: number) => ver === 1 ? Number(dv.getBigUint64(o)) : dv.getUint32(o)
  const ops: Array<() => void> = []
  for (const t of traks) {
    const tk = boites(b, dv, t.off + t.hdr, t.off + t.size)
    if (!tk) return null
    const tkhd = tk.find((x) => x.type === 'tkhd'), edts = tk.find((x) => x.type === 'edts')
    if (!tkhd || !edts) return null
    const eb = boites(b, dv, edts.off + edts.hdr, edts.off + edts.size)
    const elst = eb && eb.find((x) => x.type === 'elst')
    if (!elst) return null
    const e0 = elst.off + elst.hdr, ev = b[e0]
    if (dv.getUint32(e0 + 4) !== 1) return null              // une seule entrée (sortie ffmpeg) ; sinon on ne touche à rien
    const segOff = e0 + 8
    const mediaTime = ev === 1 ? Number(dv.getBigInt64(segOff + 8)) : dv.getInt32(segOff + 4)
    if (mediaTime < 0) return null                          // entrée vide (décalage) : structure non prévue
    const th = tkhd.off + tkhd.hdr, tv = b[th], tdOff = tv === 1 ? th + 28 : th + 20
    ops.push(() => {
      if (lireD(segOff, ev) > neuf) ecrire(segOff, ev, neuf)
      if (lireD(tdOff, tv) > neuf) ecrire(tdOff, tv, neuf)
    })
  }
  for (const f of ops) f()
  ecrire(durOff, v, neuf)
  return b
}

// L'instant de coupe voyage avec le job MCP dans op_name (« v3:<job>#cut=4.660 ») : aucun schéma à migrer.
// Un id de job Hedra ne contient jamais « # ».
export const opAvecCoupe = (op: string, coupe: number | null | undefined) => (coupe && coupe > 0 ? `${op}#cut=${coupe.toFixed(3)}` : op)
export const jobSansCoupe = (id: string) => String(id || '').split('#')[0]
export function coupeDeOp(op: unknown): number | null {
  const m = String(op || '').match(/#cut=([0-9]+(?:\.[0-9]+)?)$/)
  const v = m ? Number(m[1]) : NaN
  return v > 1 && v < 600 ? v : null
}
