// lipsync-audio.ts — l'audio ENVOYÉ à Hedra par le MCP (lipsync_video) et la coupe de la vidéo livrée.
//
// 26/09 (« le dernier mot n'est pas articulé », mesuré sur CTA28) : un audio qui s'arrête net sur le dernier phonème
// laisse Hedra (Avatar et Character-3) sans « contexte droit » → la dernière syllabe n'est pas articulée. On ne touche
// JAMAIS aux octets reçus (la brique de l'usine, la voix de l'utilisateur) : on fabrique une COPIE, complétée de silence
// jusqu’à 0,5 s après le dernier mot, et la vidéo livrée est recoupée au dernier son + 0,06 s par sa liste d’éditions
// (edts/elst : aucun ré-encodage, aucun ffmpeg dans une edge function). Même règle que render-worker/lipsync-audio.mjs.
// WAV PCM (16/24/32 bits, flottant 32) : silence complété après le dernier mot ; MP3 couche III (relecture 26/09) : 0,5 s de
// trames de silence ajoutées (preparerMp3Lipsync). La MESURE facturée (mesurerAudio) ne lit jamais un en-tête à offset fixe.

const PAD = 0.5          // silence garanti après le dernier mot
// 27/09 (Axel : « les 0,5 qu'on ajoute et qu'on raccourcit après, c'est parfait, mets-le partout ») : la coupe suit la
// règle VALIDÉE de l'usine (silencedetect −35 dB → dernier son + 0,06 s) au lieu de fin de parole + 0,3 s.
const COUPE = 0.06       // coupe vidéo = dernier son (> −35 dBFS) + 0,06 s
const SEUIL_SON = 0.01778 // −35 dBFS en amplitude (10^(−35/20)) : le seuil de silencedetect de l'usine
const QUEUE_MAX = 2.5    // au-delà de 2,5 s de silence après le dernier mot détecté, on ne coupe que ce qui dépasse l'audio
const r3 = (n: number) => Math.round(n * 1000) / 1000

const txt = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))

export interface WavInfo { fmt: number; ch: number; sr: number; bits: number; blockAlign: number; fmtOff: number; fmtLen: number; dataOff: number; dataLen: number }

// Relecture 26/09 (facturation) : UN SEUL chunk « fmt », complet, avant « data ». ffmpeg et libsndfile lisent le PREMIER
// « fmt » ; on gardait le DERNIER → un WAV à deux « fmt » (8 kHz puis 192 kHz) décodait 60 s et se mesurait 2,5 s. Tout
// WAV ambigu (2e « fmt », « fmt » tronqué ou trop court) est désormais refusé (null = illisible), jamais deviné.
export function lireWav(b: Uint8Array): WavInfo | null {
  if (b.length < 44 || txt(b, 0, 4) !== 'RIFF' || txt(b, 8, 4) !== 'WAVE') return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let off = 12
  let fmt = -1, ch = 0, sr = 0, bits = 0, blockAlign = 0, fmtOff = -1, fmtLen = 0, dataOff = -1, dataLen = 0
  while (off + 8 <= b.length) {
    const id = txt(b, off, 4), size = dv.getUint32(off + 4, true)
    if (id === 'fmt ') {
      if (fmtOff >= 0 || size < 16 || off + 8 + size > b.length) return null
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
// `son` (27/09) : juste après le DERNIER échantillon > −35 dBFS (= silence_start de silencedetect, la mesure de l'usine),
// borné à [end − 0,05 ; end + 0,25] : un fond bruité ne repousse jamais la coupe au-delà de l'ancienne (end + 0,3).
export function finParoleWav(b: Uint8Array, w: WavInfo): { end: number; dur: number; son: number } | null {
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
  for (let i = db.length - 1; i >= 0; i--) {
    if (!(db[i] > thr)) continue
    const end = r3(Math.min(n / w.sr, (i + 1) * 0.05))
    let son = end
    for (let j = n - 1; j >= 0; j--) {
      const base = w.dataOff + j * w.blockAlign
      let fort = false
      for (let k = 0; k < w.ch; k++) if (Math.abs(lire(base + k * bps)) > SEUIL_SON) { fort = true; break }
      if (fort) { son = (j + 1) / w.sr; break }
    }
    return { end, dur: r3(n / w.sr), son: r3(Math.min(end + 0.25, Math.max(end - 0.05, son))) }
  }
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

// ── COPIE CANONIQUE (relecture 26/09) : ce que le fournisseur décode = ce qu'on a mesuré ──────────────────────────────
// Un seul RIFF, le « fmt » lu, un seul « data » qui porte TOUS les octets présents après l'en-tête « data » (arrondis au
// bloc) : un champ de taille rétréci à la main ne fait pas payer moins, des chunks parasites (JUNK, LIST, 2e data…) ne
// voyagent plus. Les proxys facturent la durée de CETTE copie et c'est elle (jamais les octets du client) qu'ils envoient.
export function wavCanonique(b: Uint8Array, w: WavInfo): { bytes: Uint8Array; w: WavInfo } | null {
  const present = b.length - w.dataOff
  const len = present - (present % w.blockAlign)
  if (!(len > 0)) return null
  const out = wavAvecSilence(b, { ...w, dataLen: len }, 0)
  const w2 = lireWav(out)
  return w2 ? { bytes: out, w: w2 } : null
}
// Silence NUMÉRIQUE en fin de fichier (échantillons exactement nuls sur tous les canaux), en secondes : c'est le silence
// que l'app ajoute après le dernier mot (« dernier mot », 26/09) — il ne coûte rien au client (omnihuman-bill.ts).
export function zerosFinWav(b: Uint8Array, w: WavInfo): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const n = Math.floor(w.dataLen / w.blockAlign), bps = w.bits / 8
  let k = 0
  for (let i = n - 1; i >= 0; i--) {
    const base = w.dataOff + i * w.blockAlign
    let nul = true
    for (let c = 0; c < w.ch && nul; c++) {
      const o = base + c * bps
      if (w.fmt === 3) nul = dv.getFloat32(o, true) === 0
      else for (let j = 0; j < bps; j++) if (b[o + j] !== 0) { nul = false; break }
    }
    if (!nul) break
    k++
  }
  return r3(k / w.sr)
}

// ── MP3 (relecture 26/09) : durée = somme des TRAMES MPEG réellement présentes ──────────────────────────────────────────
// Avant : octets ÷ 16 000 (un MP3 à 8 kb/s de 60 s coûtait 20 crédits). On lit chaque trame (en-tête valide ET suivie d'une
// autre trame / de la fin / d'un tag), chacune comptée à SA fréquence ; les octets hors trames (tags ID3v2 en tête, ID3v1…)
// ne voyagent pas : la copie envoyée au fournisseur = les trames comptées, rien d'autre. Un fichier qui n'est pas à 90 %
// fait de trames (M4A, AAC, OGG…) → null (illisible) : on ne facture jamais au jugé.
const MP3_KBPS: Record<string, number[]> = {
  '3-3': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],   // MPEG-1 couche I
  '3-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],      // MPEG-1 couche II
  '3-1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],       // MPEG-1 couche III
  '2-3': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],      // MPEG-2 / 2.5 couche I
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],           // MPEG-2 / 2.5 couches II et III
  '2-1': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const MP3_SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }
export interface Mp3Trame { off: number; ver: number; layer: number; sr: number; spf: number; len: number; mono: boolean; crc: boolean }
export function mp3Trame(b: Uint8Array, i: number): Mp3Trame | null {
  if (i < 0 || i + 4 > b.length || b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return null
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3
  const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1
  if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) return null   // réservé / format libre refusés
  const kbps = MP3_KBPS[(ver === 3 ? '3' : '2') + '-' + layer][bri], sr = MP3_SR[ver][sri]
  const spf = layer === 3 ? 384 : (layer === 2 || ver === 3) ? 1152 : 576
  const len = layer === 3 ? (Math.floor(12 * kbps * 1000 / sr) + pad) * 4 : Math.floor((layer === 1 && ver !== 3 ? 72 : 144) * kbps * 1000 / sr) + pad
  return len > 4 ? { off: i, ver, layer, sr, spf, len, mono: ((b[i + 3] >> 6) & 3) === 3, crc: (b[i + 1] & 1) === 0 } : null
}
const estTag = (b: Uint8Array, i: number) => i + 3 <= b.length && (txt(b, i, 3) === 'TAG' || txt(b, i, 3) === 'ID3' || (i + 8 <= b.length && txt(b, i, 8) === 'APETAGEX'))
export interface Mp3Info { sec: number; trames: Mp3Trame[]; octets: number }
export function lireMp3(b: Uint8Array): Mp3Info | null {
  if (b.length < 4 || (b.length >= 12 && txt(b, 0, 4) === 'RIFF')) return null
  let i = 0, entete = 0
  if (b.length >= 10 && txt(b, 0, 3) === 'ID3') { entete = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)) + ((b[5] & 0x10) ? 10 : 0); i = entete }
  const trames: Mp3Trame[] = []
  let sec = 0, octets = 0
  while (i + 4 <= b.length) {
    const f = mp3Trame(b, i)
    if (f && i + f.len <= b.length) {
      const nxt = i + f.len
      if (nxt + 4 > b.length || mp3Trame(b, nxt) || estTag(b, nxt)) { trames.push(f); sec += f.spf / f.sr; octets += f.len; i = nxt; continue }
    }
    i++
  }
  if (!trames.length || octets < 0.9 * (b.length - Math.min(entete, b.length))) return null
  // Trame d'en-tête Xing / Info (aucun son : les décodeurs la sautent) + retard d'encodeur et bourrage final du tag LAME / Lavc
  // (retirés par les décodeurs) : la durée facturée = celle que le fournisseur décode (ffprobe à la milliseconde). Sans ça, un
  // MP3 de 4,00 s pesait 4,05 s → 5 s facturées. Retrait borné (≤ 1 trame + 3 trames de retard) : rien à gagner à le falsifier.
  const f0 = trames[0], x = xingOff(b, f0)
  if (x >= 0) {
    sec -= f0.spf / f0.sr
    const fl = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(x + 4)
    const p = x + 8 + (fl & 1 ? 4 : 0) + (fl & 2 ? 4 : 0) + (fl & 4 ? 100 : 0) + (fl & 8 ? 4 : 0)
    if (p + 24 <= f0.off + f0.len && /^[A-Za-z]{4}$/.test(txt(b, p, 4))) {
      const d = (b[p + 21] << 4) | (b[p + 22] >> 4), pad = ((b[p + 22] & 0x0f) << 8) | b[p + 23]
      if (d + pad <= 3 * f0.spf) sec -= (d + pad) / f0.sr
    }
  }
  return { sec: r3(Math.max(0, sec)), trames, octets }
}
// Position de l'en-tête Xing / Info dans la 1re trame (après les informations annexes, + 2 si CRC) ; -1 s'il n'y en a pas.
function xingOff(b: Uint8Array, f0: Mp3Trame): number {
  const annexe = f0.ver === 3 ? (f0.mono ? 17 : 32) : (f0.mono ? 9 : 17)
  const x = f0.off + 4 + (f0.crc ? 2 : 0) + annexe
  return x + 16 <= Math.min(b.length, f0.off + f0.len) && (txt(b, x, 4) === 'Xing' || txt(b, x, 4) === 'Info') ? x : -1
}
// Copie CANONIQUE : les trames comptées, bout à bout (aucun tag, aucun octet parasite).
export function mp3Canonique(b: Uint8Array, m: Mp3Info): Uint8Array {
  const out = new Uint8Array(m.octets)
  let o = 0
  for (const f of m.trames) { out.set(b.subarray(f.off, f.off + f.len), o); o += f.len }
  return out
}
// COPIE + ~`padSec` de silence en trames MP3 au format de la 1re trame (couche III seulement : trame dont les
// informations annexes sont nulles = silence numérique, aucun décodage nécessaire). En-tête Xing / Info mis à jour
// (nombre de trames et d'octets) sinon ffmpeg jetterait le silence ajouté. `b` = copie canonique (mp3Canonique).
export function mp3AvecSilence(b: Uint8Array, m: Mp3Info, padSec: number): Uint8Array | null {
  const f0 = m.trames[0]
  if (!f0 || f0.layer !== 1 || !(padSec > 0)) return null
  const h = new Uint8Array([b[f0.off], b[f0.off + 1] | 1, b[f0.off + 2] & ~0x02, b[f0.off + 3]])   // sans CRC, sans bourrage
  const t = mp3Trame(h, 0)
  if (!t) return null
  const n = Math.ceil(padSec * t.sr / t.spf)
  const out = new Uint8Array(b.length + n * t.len)
  out.set(b, 0)
  for (let k = 0; k < n; k++) out.set(h, b.length + k * t.len)
  // Xing / Info dans la 1re trame (après les informations annexes, + 2 si CRC)
  const x = xingOff(b, f0)
  if (x >= 0) {
    const dv = new DataView(out.buffer)
    const flags = dv.getUint32(x + 4)
    let p = x + 8
    if (flags & 1) { dv.setUint32(p, dv.getUint32(p) + n); p += 4 }
    if (flags & 2) dv.setUint32(p, dv.getUint32(p) + n * t.len)
  }
  return out
}

// ── MESURE D'UN AUDIO REÇU (MCP lipsync_video, relecture 26/09) ─────────────────────────────────────────────────────────
// WAV PCM → copie canonique ; MP3 → trames comptées (copie canonique) ; tout le reste → refusé. `sec` = durée de la copie
// que le fournisseur recevra (c'est elle qui est facturée), jamais une estimation d'après la taille ou un en-tête à offset fixe.
export type AudioMesure = { kind: 'wav'; sec: number; bytes: Uint8Array } | { kind: 'mp3'; sec: number; bytes: Uint8Array; mp3: Mp3Info } | { kind: null; error: string }
export function mesurerAudio(b: Uint8Array): AudioMesure {
  if (b.length >= 12 && txt(b, 0, 4) === 'RIFF') {
    const w = lireWav(b)
    if (!w || w.sr < 8000 || w.sr > 192000 || w.ch < 1 || w.ch > 8) return { kind: null, error: 'WAV illisible : un WAV PCM (16, 24 ou 32 bits) est attendu' }
    const c = wavCanonique(b, w)
    if (!c) return { kind: null, error: 'WAV vide' }
    return { kind: 'wav', sec: r3(Math.floor(c.w.dataLen / c.w.blockAlign) / c.w.sr), bytes: c.bytes }
  }
  const m = lireMp3(b)
  if (m) { const c = mp3Canonique(b, m); const m2 = lireMp3(c); if (m2) return { kind: 'mp3', sec: m2.sec, bytes: c, mp3: m2 } }
  return { kind: null, error: 'format audio non pris en charge : envoie un WAV (PCM) ou un MP3' }
}
// ── Audit 04/10 (MCP-4) : DURÉE MESURÉE des autres formats audio courants ─────────────────────────────────────────────
// clean_audio / montage_ia (MCP) : FLAC, Ogg Opus (notes vocales WhatsApp, Telegram), WebM Opus (enregistreur des
// navigateurs) et AAC brut (ADTS) étaient « non mesurables » depuis le 03/10 → refusés au-delà de 1,2 / 3 Mo. On compte ce
// qu'un décodeur DÉCODE — trames FLAC validées par leurs deux CRC, paquets Opus d'après leur octet TOC (pages Ogg validées
// par leur CRC), trames ADTS chaînées — jamais une durée DÉCLARÉE seule (STREAMINFO, granule, Duration), qu'un fichier
// forgé peut raccourcir. Les octets hors trames reconnues doivent rester marginaux (< 10 %), sinon null : jamais au jugé.
// N'est PAS utilisée par la facturation du lipsync (mesurerAudio reste WAV / MP3 seulement).
export type AudioAutre = { kind: 'flac' | 'ogg-opus' | 'webm-opus' | 'aac'; sec: number }
export function dureeAudioAutres(b: Uint8Array): AudioAutre | null {
  try {
    const debut = finId3(b)
    if (b.length >= debut + 4 && txt(b, debut, 4) === 'fLaC') { const s = dureeFlac(b, debut + 4); return s === null ? null : { kind: 'flac', sec: s } }
    if (b.length >= 4 && txt(b, 0, 4) === 'OggS') { const s = dureeOggOpus(b); return s === null ? null : { kind: 'ogg-opus', sec: s } }
    if (b.length >= 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) { const s = dureeWebmOpus(b); return s === null ? null : { kind: 'webm-opus', sec: s } }
    const s = dureeAdts(b, debut)
    return s === null ? null : { kind: 'aac', sec: s }
  } catch { return null }
}
// Fin d'un tag ID3v2 en tête (0 s'il n'y en a pas) — même calcul que lireMp3.
function finId3(b: Uint8Array): number {
  if (b.length < 10 || txt(b, 0, 3) !== 'ID3') return 0
  return Math.min(b.length, 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)) + ((b[5] & 0x10) ? 10 : 0))
}

// FLAC : blocs de métadonnées, puis trames. Une trame compte si son en-tête (CRC-8) ET son contenu (CRC-16) sont valides et
// qu'elle est suivie d'une autre trame, d'un tag ou de la fin : c'est aussi ce que garde ffmpeg (err_detect=crccheck).
const CRC8 = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; t[i] = c } return t })()
const CRC16 = (() => { const t = new Uint16Array(256); for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c } return t })()
const FLAC_SR = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000]
const FLAC_TRAME_MAX = 1 << 20   // fin de trame cherchée sur 1 Mio au plus (une trame réelle pèse quelques Ko)
function flacEntete(b: Uint8Array, p: number, srInfo: number): { len: number; bs: number; sr: number } | null {
  if (p + 6 > b.length || b[p] !== 0xFF || (b[p + 1] & 0xFE) !== 0xF8) return null
  const bsc = b[p + 2] >> 4, src = b[p + 2] & 0x0F, ch = b[p + 3] >> 4, ssc = (b[p + 3] >> 1) & 7
  if (bsc === 0 || src === 15 || ch > 10 || ssc === 3 || (b[p + 3] & 1)) return null   // valeurs réservées
  let q = p + 4
  const c0 = b[q]   // numéro de trame / d'échantillon, codé façon UTF-8 (1 à 7 octets)
  const n = c0 < 0x80 ? 0 : (c0 & 0xE0) === 0xC0 ? 1 : (c0 & 0xF0) === 0xE0 ? 2 : (c0 & 0xF8) === 0xF0 ? 3
    : (c0 & 0xFC) === 0xF8 ? 4 : (c0 & 0xFE) === 0xFC ? 5 : c0 === 0xFE ? 6 : -1
  if (n < 0 || q + 1 + n > b.length) return null
  for (let k = 1; k <= n; k++) if ((b[q + k] & 0xC0) !== 0x80) return null
  q += 1 + n
  let bs: number
  if (bsc === 1) bs = 192
  else if (bsc <= 5) bs = 576 << (bsc - 2)
  else if (bsc === 6) { if (q + 1 > b.length) return null; bs = b[q] + 1; q += 1 }
  else if (bsc === 7) { if (q + 2 > b.length) return null; bs = ((b[q] << 8) | b[q + 1]) + 1; q += 2 }
  else bs = 256 << (bsc - 8)
  let sr: number
  if (src === 0) sr = srInfo
  else if (src <= 11) sr = FLAC_SR[src]
  else if (src === 12) { if (q + 1 > b.length) return null; sr = b[q] * 1000; q += 1 }
  else { if (q + 2 > b.length) return null; sr = ((b[q] << 8) | b[q + 1]) * (src === 14 ? 10 : 1); q += 2 }
  if (!(sr > 0) || q + 1 > b.length) return null
  let crc = 0
  for (let k = p; k < q; k++) crc = CRC8[crc ^ b[k]]
  return crc === b[q] ? { len: q + 1 - p, bs, sr } : null
}
function dureeFlac(b: Uint8Array, p: number): number | null {
  let srInfo = 0, derniere = false
  while (!derniere) {   // blocs de métadonnées (STREAMINFO = type 0, toujours le premier)
    if (p + 4 > b.length) return null
    const type = b[p] & 0x7F, len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]
    derniere = (b[p] & 0x80) !== 0
    if (type === 127) return null
    if (type === 0) { if (len < 34 || p + 4 + 13 > b.length) return null; srInfo = (b[p + 14] << 12) | (b[p + 15] << 4) | (b[p + 16] >> 4) }
    p += 4 + len
  }
  const audio = b.length - p
  if (!(audio > 0)) return null
  // budget de lecture : un fichier forgé (faux en-têtes en rafale) ne fait jamais relire chaque octet des millions de fois
  let sec = 0, couverts = 0, budget = 4 * b.length + 4 * FLAC_TRAME_MAX
  while (p + 6 <= b.length) {
    const h = flacEntete(b, p, srInfo)
    if (!h) { p++; continue }   // resynchronisation : ces octets restent « non couverts »
    let crc = 0, q = p, fin = -1
    for (; q < p + h.len; q++) crc = ((crc << 8) & 0xffff) ^ CRC16[((crc >> 8) ^ b[q]) & 0xff]
    const borne = Math.min(b.length, p + FLAC_TRAME_MAX), q0 = q
    for (; q + 2 <= borne; q++) {
      if (((b[q] << 8) | b[q + 1]) === crc && (q + 2 === b.length || estTag(b, q + 2) || flacEntete(b, q + 2, srInfo))) { fin = q + 2; break }
      crc = ((crc << 8) & 0xffff) ^ CRC16[((crc >> 8) ^ b[q]) & 0xff]
    }
    budget -= q - q0
    if (budget < 0) return null
    if (fin < 0) { p++; continue }
    sec += h.bs / h.sr
    couverts += fin - p
    p = fin
  }
  return sec > 0 && couverts >= 0.9 * audio ? r3(sec) : null
}

// Opus : échantillons (à 48 kHz) d'un paquet d'après son octet TOC (RFC 6716 §3.1) — 120 ms au plus par paquet.
function opusEchantillons(b: Uint8Array, o: number, len: number): number {
  if (len < 1) return 0
  const toc = b[o], cfg = toc >> 3, c = toc & 3
  const taille = cfg < 12 ? [480, 960, 1920, 2880][cfg & 3] : cfg < 16 ? [480, 960][cfg & 1] : [120, 240, 480, 960][cfg & 3]
  const n = c === 0 ? 1 : c < 3 ? 2 : (len >= 2 ? (b[o + 1] & 0x3F) : 0)
  return Math.min(5760, n * taille)
}
const lirePreskip = (b: Uint8Array, o: number, len: number) => (len >= 19 && txt(b, o, 8) === 'OpusHead') ? (b[o + 10] | (b[o + 11] << 8)) : -1

// Ogg : pages validées par leur CRC-32 (sinon sautées, comme ffmpeg), paquets réassemblés par flux. Un seul flux admis, en
// Opus (paquet OpusHead en tête) : somme des paquets audio − pré-saut (audit 04/10, relecture : plusieurs flux → null).
const CRC32_OGG = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i << 24; for (let k = 0; k < 8; k++) c = (c & 0x80000000) ? ((c << 1) ^ 0x04C11DB7) >>> 0 : (c << 1) >>> 0; t[i] = c >>> 0 } return t })()
function oggPage(b: Uint8Array, p: number, budget: { n: number }): { len: number; serial: number; flags: number; nseg: number } | null {
  if (p + 27 > b.length || b[p] !== 0x4F || txt(b, p, 4) !== 'OggS' || b[p + 4] !== 0) return null
  const nseg = b[p + 26]
  if (p + 27 + nseg > b.length) return null
  let dlen = 0
  for (let k = 0; k < nseg; k++) dlen += b[p + 27 + k]
  const len = 27 + nseg + dlen
  if (p + len > b.length) return null
  budget.n -= len
  if (budget.n < 0) return null
  let crc = 0
  for (let k = 0; k < len; k++) crc = ((crc << 8) >>> 0) ^ CRC32_OGG[((crc >>> 24) ^ (k >= 22 && k < 26 ? 0 : b[p + k])) & 0xff]
  const lu = (b[p + 22] | (b[p + 23] << 8) | (b[p + 24] << 16) | (b[p + 25] << 24)) >>> 0
  if ((crc >>> 0) !== lu) return null
  return { len, serial: (b[p + 14] | (b[p + 15] << 8) | (b[p + 16] << 16) | (b[p + 17] << 24)) >>> 0, flags: b[p + 5], nseg }
}
function dureeOggOpus(b: Uint8Array): number | null {
  // par flux : paquet en cours (début + longueur), rang du paquet, pré-saut (−1 = pas Opus), échantillons
  type Flux = { debut: number; len: number; enCours: boolean; perdu: boolean; rang: number; preskip: number; ech: number }
  const actifs = new Map<number, Flux>(), tous: Flux[] = []
  let p = 0, couverts = 0
  const budget = { n: 4 * b.length + 4 * 65_307 }   // CRC calculés : borné (faux en-têtes « OggS » en rafale)
  while (p + 27 <= b.length) {
    const pg = oggPage(b, p, budget)
    if (!pg) { if (budget.n < 0) return null; p++; continue }
    couverts += pg.len
    let f = actifs.get(pg.serial)
    // début de flux (BOS) ou flux inconnu : nouveau flux (un flux sans OpusHead en tête n'est jamais compté)
    if (!f || (pg.flags & 2)) {
      f = { debut: 0, len: 0, enCours: false, perdu: !(pg.flags & 2) && !!(pg.flags & 1), rang: (pg.flags & 2) ? 0 : 1, preskip: -1, ech: 0 }
      actifs.set(pg.serial, f); tous.push(f)
    }
    // suite d'un paquet commencé dans une page perdue : ignorée jusqu'à sa fin
    if ((pg.flags & 1) && !f.enCours) f.perdu = true
    if (!(pg.flags & 1) && f.enCours) { f.enCours = false; f.len = 0 }   // paquet inachevé abandonné
    let o = p + 27 + pg.nseg
    for (let k = 0; k < pg.nseg; k++) {
      const s = b[p + 27 + k]
      if (!f.enCours && !f.perdu) { f.debut = o; f.len = 0; f.enCours = true }
      if (f.enCours) f.len += s
      o += s
      if (s < 255) {
        if (f.perdu) { f.perdu = false; continue }
        f.enCours = false
        if (f.rang === 0) f.preskip = lirePreskip(b, f.debut, f.len)
        else if (f.rang >= 2 && f.preskip >= 0) f.ech += opusEchantillons(b, f.debut, f.len)
        f.rang++
      }
    }
    p += pg.len
  }
  // Audit 04/10 (relecture MCP-4) : UN seul flux, et en Opus. Un 2e flux (Vorbis, Opus multiplexé, chaîne) n'est pas
  // compté ici alors que ffmpeg le décode (vu : Vorbis 300 s + Opus 3 s mesuré 3 s) → null, le refus d'avant s'applique.
  if (tous.length !== 1) return null
  let ech = 0, opus = false
  for (const f of tous) if (f.preskip >= 0) { opus = true; ech += Math.max(0, f.ech - f.preskip) }
  if (!opus || !(ech > 0) || couverts < 0.9 * b.length) return null
  return r3(ech / 48000)
}

// WebM / Matroska : UNE piste audio, A_OPUS (audit 04/10, relecture ; pistes vidéo admises, non comptées), somme des paquets (SimpleBlock / Block, laçages compris) − CodecDelay (ou pré-saut
// d'OpusHead). Lecture STRICTE : un élément illisible → null. Taille inconnue admise pour Segment et Cluster (MediaRecorder).
function ebml(b: Uint8Array, p: number, id: boolean): { v: number; len: number; inconnu: boolean } | null {
  if (p >= b.length) return null
  const c = b[p]
  if (c === 0) return null
  let len = 1, m = 0x80
  while (!(c & m)) { m >>= 1; len++ }
  if (len > (id ? 4 : 8) || p + len > b.length) return null
  let v = id ? c : (c & (m - 1)), tousUn = (c & (m - 1)) === m - 1
  for (let k = 1; k < len; k++) { v = v * 256 + b[p + k]; if (b[p + k] !== 0xFF) tousUn = false }
  return { v, len, inconnu: !id && tousUn }
}
const MKV_NIVEAU1 = new Set([0x1F43B675, 0x1C53BB6B, 0x1254C367, 0x1043A770, 0x1941A469, 0x114D9B74, 0x1549A966, 0x1654AE6B, 0x1A45DFA3])
function dureeWebmOpus(b: Uint8Array): number | null {
  const elem = (p: number) => {
    const i = ebml(b, p, true); if (!i) return null
    const s = ebml(b, p + i.len, false); if (!s) return null
    return { id: i.v, deb: p + i.len + s.len, taille: s.v, inconnu: s.inconnu }
  }
  const hd = elem(0)
  if (!hd || hd.id !== 0x1A45DFA3 || hd.inconnu) return null
  const sg = elem(hd.deb + hd.taille)
  if (!sg || sg.id !== 0x18538067) return null
  const fin = sg.inconnu ? b.length : Math.min(b.length, sg.deb + sg.taille)
  if (b.length - fin > 0.1 * b.length) return null   // données hors du segment : jamais lues ici
  let piste = -1, delai = -1, preskip = -1, ech = 0, pistesLues = false
  let audios = 0, audioNonOpus = false   // audit 04/10 (relecture MCP-4) : pistes audio déclarées
  const bloc = (o: number, len: number): boolean => {
    const t = ebml(b, o, false); if (!t || t.inconnu) return false
    let q = o + t.len + 3
    const lim = o + len
    if (q > lim) return false
    if (t.v !== piste) return true
    const lacage = (b[o + t.len + 2] >> 1) & 3
    if (lacage === 0) { ech += opusEchantillons(b, q, lim - q); return true }
    if (q >= lim) return false
    const nb = b[q] + 1; q++
    const tailles: number[] = []
    if (lacage === 1) {
      for (let k = 0; k < nb - 1; k++) { let s = 0, v = 255; while (v === 255) { if (q >= lim) return false; v = b[q++]; s += v } tailles.push(s) }
    } else if (lacage === 3) {
      const t0 = ebml(b, q, false); if (!t0 || t0.inconnu) return false
      tailles.push(t0.v); q += t0.len
      for (let k = 1; k < nb - 1; k++) {
        const d = ebml(b, q, false); if (!d) return false
        const s = tailles[k - 1] + d.v - (Math.pow(2, 7 * d.len - 1) - 1)
        if (s < 0) return false
        tailles.push(s); q += d.len
      }
    } else {
      if ((lim - q) % nb) return false
      for (let k = 0; k < nb - 1; k++) tailles.push((lim - q) / nb)
    }
    const reste = lim - q - tailles.reduce((a, x) => a + x, 0)
    if (reste < 0) return false
    tailles.push(reste)
    for (const s of tailles) { ech += opusEchantillons(b, q, s); q += s }
    return true
  }
  let p = sg.deb
  while (p < fin) {
    const e = elem(p)
    if (!e) return null
    if (e.id === 0x1654AE6B) {   // Tracks → TrackEntry
      if (e.inconnu) return null
      for (let q = e.deb; q < e.deb + e.taille;) {
        const te = elem(q); if (!te || te.inconnu) return null
        if (te.id === 0xAE) {
          let num = -1, codec = '', cd = -1, ps = -1, type = -1
          for (let r = te.deb; r < te.deb + te.taille;) {
            const x = elem(r); if (!x || x.inconnu) return null
            if (x.id === 0xD7) { num = 0; for (let k = 0; k < x.taille; k++) num = num * 256 + b[x.deb + k] }
            else if (x.id === 0x83) { type = 0; for (let k = 0; k < x.taille; k++) type = type * 256 + b[x.deb + k] }
            else if (x.id === 0x86) codec = txt(b, x.deb, Math.min(x.taille, 32))
            else if (x.id === 0x56AA) { cd = 0; for (let k = 0; k < x.taille; k++) cd = cd * 256 + b[x.deb + k] }
            else if (x.id === 0x63A2) ps = lirePreskip(b, x.deb, x.taille)
            r = x.deb + x.taille
          }
          // Audit 04/10 (relecture MCP-4) : piste audio = TrackType 2 ou codec A_* ; une 2e piste audio, ou une piste audio
          // qui n'est pas de l'Opus, n'est pas comptée ici alors que ffmpeg la décode (vu : Vorbis 300 s + Opus 3 s → 3 s).
          if (type === 2 || codec.startsWith('A_')) { audios++; if (codec !== 'A_OPUS') audioNonOpus = true }
          if (codec === 'A_OPUS' && piste < 0) { piste = num; delai = cd; preskip = ps }
        }
        q = te.deb + te.taille
      }
      pistesLues = true
      p = e.deb + e.taille
    } else if (e.id === 0x1F43B675) {   // Cluster
      if (!pistesLues) return null
      const cFin = e.inconnu ? fin : Math.min(fin, e.deb + e.taille)
      let q = e.deb
      while (q < cFin) {
        const x = elem(q)
        if (!x) return null
        if (e.inconnu && MKV_NIVEAU1.has(x.id)) break   // taille inconnue : le cluster s'arrête au prochain élément de niveau 1
        if (x.inconnu || x.deb + x.taille > b.length) return null
        if (x.id === 0xA3) { if (!bloc(x.deb, x.taille)) return null }
        else if (x.id === 0xA0) {
          for (let r = x.deb; r < x.deb + x.taille;) {
            const y = elem(r); if (!y || y.inconnu) return null
            if (y.id === 0xA1 && !bloc(y.deb, y.taille)) return null
            r = y.deb + y.taille
          }
        }
        q = x.deb + x.taille
      }
      p = q
    } else {
      if (e.inconnu) return null
      p = e.deb + e.taille
    }
  }
  if (piste < 0 || audios !== 1 || audioNonOpus || !(ech > 0)) return null   // une seule piste audio, en Opus (relecture)
  const saut = delai >= 0 ? Math.round(delai * 48000 / 1e9) : Math.max(0, preskip)
  return r3(Math.max(0, ech - saut) / 48000)
}

// AAC brut (ADTS) : trames chaînées (en-tête valide suivi d'une autre trame, d'un tag ou de la fin), 1 024 échantillons par
// bloc de données ; ≥ 90 % des octets dans des trames (même règle que le MP3). Couche ≠ 0 = MP3 (jamais confondus).
const AAC_SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
function adtsTrame(b: Uint8Array, i: number): { len: number; ech: number; sr: number } | null {
  if (i + 7 > b.length || b[i] !== 0xFF || (b[i + 1] & 0xF6) !== 0xF0) return null
  const sfi = (b[i + 2] >> 2) & 0x0F
  if (sfi > 12) return null
  const len = ((b[i + 3] & 0x03) << 11) | (b[i + 4] << 3) | (b[i + 5] >> 5)
  if (len < ((b[i + 1] & 1) ? 7 : 9)) return null
  return { len, ech: 1024 * ((b[i + 6] & 3) + 1), sr: AAC_SR[sfi] }
}
function dureeAdts(b: Uint8Array, debut: number): number | null {
  let i = debut, sec = 0, octets = 0, n = 0
  while (i + 7 <= b.length) {
    const f = adtsTrame(b, i)
    if (f && i + f.len <= b.length) {
      const nxt = i + f.len
      if (nxt === b.length || nxt + 7 > b.length || adtsTrame(b, nxt) || estTag(b, nxt)) { sec += f.ech / f.sr; octets += f.len; n++; i = nxt; continue }
    }
    i++
  }
  return n >= 2 && octets >= 0.9 * (b.length - debut) ? r3(sec) : null
}

// MP3 envoyé à Hedra / OmniHuman (« dernier mot ») : copie + 0,5 s de silence, vidéo coupée à durée d’origine + 0,06 s
// (le silence ajouté commence à la durée d'origine). Couche I / II ou copie impossible → null (envoyé tel quel, sans coupe).
export function preparerMp3Lipsync(b: Uint8Array, m: Mp3Info): { bytes: Uint8Array; coupe: number } | null {
  const out = mp3AvecSilence(b, m, PAD)
  return out ? { bytes: out, coupe: r3(m.sec + COUPE) } : null
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
  const coupe = f.end > 1 ? r3(silence <= QUEUE_MAX ? f.son + COUPE : dur + COUPE) : null
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
