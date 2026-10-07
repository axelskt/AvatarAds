// Décodage d'une couverture JPEG / WebP dans une edge function (Deno, imports esm.sh). Le serveur de l'usine (Node) décode
// avec ffmpeg et partage le reste (_shared/cover-match.ts).
import jpeg from 'https://esm.sh/jpeg-js@0.4.4'
import webpDecode, { init as webpInit } from 'https://esm.sh/@jsquash/webp@1.4.0/decode'
import { WEBP_DEC_WASM } from './webp-dec-wasm.ts'
import { toGray, b64ToBytes } from './fp.ts'

let webpReady: Promise<void> | null = null
export async function decodeCover(bytes: Uint8Array): Promise<{ w: number, h: number, gray: Uint8Array, rgba: ArrayLike<number> } | null> {
  try {
    let img: { width: number, height: number, data: ArrayLike<number> }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {   // RIFF....WEBP
      if (!webpReady) webpReady = webpInit(new WebAssembly.Module(b64ToBytes(WEBP_DEC_WASM) as Uint8Array<ArrayBuffer>))
      await webpReady
      img = await webpDecode(bytes.slice().buffer)
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 96 })
    } else return null
    return { w: img.width, h: img.height, gray: toGray(img.data, img.width * img.height), rgba: img.data }
  } catch (e) { console.log('décodage couverture', String((e as Error)?.message || e).slice(0, 120)); return null }
}
