// « Cloner l'audio de la vidéo » (Motion Control, 09/10/2026) — lecture d'un WAV envoyé par l'app. GRATUIT (Axel 09/10).
// Module sans réseau ni Deno.env : testé par wav.test.ts (deno test).

// Motion Control : référence de 30 s au plus (l'app coupe le WAV à 30 s) ; jamais moins de 0,5 s.
export const VOIX_DUREE_MIN = 0.5
export const VOIX_DUREE_MAX = 30.5
// 31 s en 48 kHz stéréo 16 bits ≈ 6 Mo ; l'app envoie du mono 44,1 kHz (≈ 2,7 Mo).
export const VOIX_OCTETS_MAX = 8 * 1024 * 1024

export type Wav = { sampleRate: number; channels: number; bitsPerSample: number; format: number; duree: number; dataOffset: number; dataLen: number }

// En-tête RIFF/WAVE : chunk « fmt » puis le PREMIER chunk « data ». null = pas un WAV PCM cohérent (le client n'envoie que ça).
// Relecture 09/10 : la durée ne vient JAMAIS du byteRate déclaré par le client — un byteRate gonflé faisait passer 5 min
// d'audio pour 0,6 s (et 5 min de conversion ElevenLabs à nos frais). byteRate et blockAlign doivent correspondre à fréquence × canaux ×
// bits, la durée est calculée sur ces valeurs, et SEULS ces octets partent chez ElevenLabs (wavCanonique) : un 2e chunk
// « data » ou tout octet en trop n'est jamais converti.
export function lireWav(b: Uint8Array): Wav | null {
  if (b.length < 44) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let o = 12, fmt: { format: number; channels: number; sampleRate: number; byteRate: number; blockAlign: number; bitsPerSample: number } | null = null
  let dataOffset = -1, dataLen = -1
  while (o + 8 <= b.length) {
    const id = tag(o), size = v.getUint32(o + 4, true), corps = o + 8
    if (id === 'fmt ' && size >= 16 && corps + 16 <= b.length) {
      fmt = { format: v.getUint16(corps, true), channels: v.getUint16(corps + 2, true), sampleRate: v.getUint32(corps + 4, true),
        byteRate: v.getUint32(corps + 8, true), blockAlign: v.getUint16(corps + 12, true), bitsPerSample: v.getUint16(corps + 14, true) }
    } else if (id === 'data') {
      // taille déclarée plafonnée à ce qui est réellement là (un en-tête de flux peut annoncer 0xFFFFFFFF)
      dataOffset = corps; dataLen = Math.min(size, b.length - corps)
      break
    }
    o = corps + size + (size & 1)   // les chunks sont alignés sur 2 octets
  }
  if (!fmt || dataOffset < 0) return null
  if (![1, 3].includes(fmt.format) || fmt.channels < 1 || fmt.channels > 2 || fmt.sampleRate < 8000 || fmt.sampleRate > 96000) return null
  if (![16, 24, 32].includes(fmt.bitsPerSample) || (fmt.format === 3 && fmt.bitsPerSample !== 32)) return null
  const ba = fmt.channels * fmt.bitsPerSample / 8
  if (fmt.blockAlign !== ba || fmt.byteRate !== fmt.sampleRate * ba) return null
  dataLen -= dataLen % ba   // échantillons complets seulement
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, format: fmt.format,
    duree: dataLen / (fmt.sampleRate * ba), dataOffset, dataLen }
}

// WAV reconstruit avec un en-tête propre de 44 octets et EXACTEMENT les échantillons validés (envoyé à ElevenLabs).
export function wavCanonique(w: Wav, b: Uint8Array): Uint8Array {
  const ba = w.channels * w.bitsPerSample / 8, out = new Uint8Array(44 + w.dataLen), v = new DataView(out.buffer)
  const put = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i) }
  put(0, 'RIFF'); v.setUint32(4, 36 + w.dataLen, true); put(8, 'WAVE'); put(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, w.format, true); v.setUint16(22, w.channels, true); v.setUint32(24, w.sampleRate, true)
  v.setUint32(28, w.sampleRate * ba, true); v.setUint16(32, ba, true); v.setUint16(34, w.bitsPerSample, true)
  put(36, 'data'); v.setUint32(40, w.dataLen, true)
  out.set(b.subarray(w.dataOffset, w.dataOffset + w.dataLen), 44)
  return out
}

// Voix proposées dans l'app → voix ElevenLabs par défaut (premade, disponibles sur tout compte). Le speech-to-speech garde
// les mots, le rythme et l'intonation de la prise d'origine (le français reste du français) : seul le timbre change.
// Axel 09/10 : « une voix fille et une voix garçon » — deux voix FIXES choisies avec lui.
export const VOIX_ELEVENLABS: Record<string, string> = {
  fille: 'cgSgspJ2msm6clMCkdW9',    // Jessica — jeune, naturelle, expressive (à valider à l'écoute avec Axel)
  garcon: 'TX3LPaxmHKxFdv7VOQHJ',   // Liam — jeune, énergique (à valider à l'écoute avec Axel)
}
