// deno test supabase/functions/voice-change/wav.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { lireWav, wavCanonique, VOIX_ELEVENLABS } from './wav.ts'

function wav(sec: number, sr = 44100, ch = 1, bits = 16, extra = false): Uint8Array {
  const bloc = ch * bits / 8, data = Math.round(sec * sr) * bloc
  const ex = extra ? 12 : 0   // chunk « LIST » de 4 octets avant « data » (fichiers réels)
  const b = new Uint8Array(44 + ex + data), v = new DataView(b.buffer)
  const put = (o: number, s: string) => { for (let i = 0; i < 4; i++) b[o + i] = s.charCodeAt(i) }
  put(0, 'RIFF'); v.setUint32(4, 36 + ex + data, true); put(8, 'WAVE')
  put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, ch, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * bloc, true); v.setUint16(32, bloc, true); v.setUint16(34, bits, true)
  let o = 36
  if (extra) { put(o, 'LIST'); v.setUint32(o + 4, 4, true); put(o + 8, 'INFO'); o += 12 }
  put(o, 'data'); v.setUint32(o + 4, data, true)
  return b
}

Deno.test('WAV mono 44,1 kHz 16 bits : durée exacte', () => {
  const w = lireWav(wav(12.5))
  assertEquals(w && Math.round(w.duree * 1000) / 1000, 12.5)
  assertEquals(w && [w.sampleRate, w.channels, w.bitsPerSample], [44100, 1, 16])
})
Deno.test('WAV stéréo 48 kHz avec un chunk LIST avant data', () => {
  const w = lireWav(wav(3, 48000, 2, 16, true))
  assertEquals(w && Math.round(w.duree * 1000) / 1000, 3)
})
Deno.test('WAV flottant 32 bits accepté', () => {
  assertEquals(lireWav(wav(1, 22050, 1, 32))?.format, 3)
})
Deno.test('refus : pas un WAV, trop court, canaux ou fréquence absurdes', () => {
  assertEquals(lireWav(new TextEncoder().encode('ID3 un mp3 déguisé, pas un wav du tout....................')), null)
  assertEquals(lireWav(new Uint8Array(10)), null)
  const b = wav(1); new DataView(b.buffer).setUint16(22, 6, true)   // 6 canaux
  assertEquals(lireWav(b), null)
  const c = wav(1); new DataView(c.buffer).setUint32(24, 4000, true)   // 4 kHz
  assertEquals(lireWav(c), null)
})
Deno.test('data déclaré plus long que le fichier : plafonné à ce qui est là', () => {
  const b = wav(2); new DataView(b.buffer).setUint32(40, 0xFFFFFFFF, true)
  assertEquals(Math.round((lireWav(b)?.duree ?? 0) * 100) / 100, 2)
})
Deno.test('FAILLE 09/10 : un byteRate gonflé (5 min déclarées 0,6 s) est refusé', () => {
  const b = wav(3, 8000)   // 3 s à 8 kHz
  new DataView(b.buffer).setUint32(28, Math.round(48000 / 0.6), true)   // byteRate falsifié
  assertEquals(lireWav(b), null)
  const c = wav(3, 8000); new DataView(c.buffer).setUint16(32, 4, true)   // blockAlign incohérent
  assertEquals(lireWav(c), null)
})
Deno.test('FAILLE 09/10 : un 2e chunk data n\u2019est ni compté ni envoyé (WAV canonique = 1er chunk seul)', () => {
  const un = wav(1), extra = new Uint8Array(8 + 16000 * 2 * 4)   // + 4 s cachées dans un 2e « data »
  const dv = new DataView(extra.buffer); 'data'.split('').forEach((ch, i) => extra[i] = ch.charCodeAt(0)); dv.setUint32(4, 16000 * 2 * 4, true)
  const b = new Uint8Array(un.length + extra.length); b.set(un); b.set(extra, un.length)
  const w = lireWav(b)!
  assertEquals(Math.round(w.duree * 1000) / 1000, 1)
  const canon = wavCanonique(w, b)
  assertEquals(canon.length, 44 + w.dataLen)
  assertEquals(Math.round((lireWav(canon)?.duree ?? 0) * 1000) / 1000, 1)
})
Deno.test('voix proposées : fille et garçon', () => {
  assertEquals(Object.keys(VOIX_ELEVENLABS).sort(), ['fille', 'garcon'])
})
