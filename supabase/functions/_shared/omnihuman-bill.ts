// OmniHuman 1.5 chez kie pour les CLIENTS (Axel 25/09/2026) — ce que coûte une soumission, décidé ICI et jamais par le client.
//
// Prix client inchangé : 5 cr/s (= CREDIT_COSTS.omniPerSec de l'app, à changer ENSEMBLE). kie facture 0,135 $/s, même prix en
// 720p et 1080p. La durée facturée est MESURÉE côté serveur sur le fichier audio que kie recevra :
//   • le client dépose son WAV dans render-media/<uid>/… ; kie-proxy le lit (borné à 12 Mo), le mesure (en-tête RIFF + octets
//     réellement présents), puis en dépose une COPIE dans render-media/omnih-in/ (dossier que seul le service écrit) : kie lit
//     CETTE copie. Remplacer son fichier après la mesure (même chemin, upsert) ne change donc plus ce que kie génère ;
//   • un chiffre de durée envoyé par le client est ignoré ; un audio illisible (autre chose qu'un WAV PCM) est refusé AVANT tout
//     tirage (400) ; au-delà de 60 s facturées → 400 (plafond kie / fal).
// Durée facturée = max(1 s, durée envoyée − 0,6 s) : l'app ajoute au plus 0,6 s de « contexte » après la fin utile de chaque
// extrait (la suite réelle de la voix, ou le silence qui manque après le dernier mot : correctif « dernier mot » du 26/09) ;
// cette marge est pour NOUS, comme LIPSYNC_PAD_MS dans hedra-proxy. Constante SERVEUR, jamais lue du client.
// Coût = ⌈5 × durée facturée⌉ (arrondi au centième avant le plafond : aucun crédit fantôme dû au flottant).
// Même formule côté app (_omniKieCost) : la réservation de l'app couvre toujours ce que le serveur tire.
import { lireWav } from './lipsync-audio.ts'
import { svc } from './guard.ts'
import { clampOmnihumanPrompt, omnihumanPrompt } from './omnihuman-prompts.ts'

export const OMNIHUMAN_PER_SEC = 5
export const OMNIHUMAN_MARGE_S = 0.6
export const OMNIHUMAN_MIN_S = 1
export const OMNIHUMAN_MAX_S = 60
export const OMNIHUMAN_AUDIO_MAX_BYTES = 12 * 1024 * 1024
export const OMNIHUMAN_IN_DIR = 'omnih-in'   // copies servies à kie (hors de tout dossier utilisateur : ni écrasables, ni prises pour une preuve de propriété)

const r3 = (n: number) => Math.round(n * 1000) / 1000

// Durée d'un WAV PCM (16/24/32 bits, flottant 32, extensible) d'après TOUS les octets présents après l'en-tête « data » :
// un champ de taille rétréci à la main ne fait pas payer moins (le décodeur de kie lit le fichier réel), un champ gonflé non
// plus (on ne compte que les octets présents). Fréquence / canaux hors normes → illisible. null = pas un WAV PCM lisible.
export function dureeWavSec(bytes: Uint8Array): number | null {
  const w = lireWav(bytes)
  if (!w || w.sr < 8000 || w.sr > 192000 || w.ch < 1 || w.ch > 8) return null
  const present = bytes.length - w.dataOff
  const frames = Math.floor(present / w.blockAlign)
  return frames > 0 ? r3(frames / w.sr) : null
}
export const omnihumanFactureSec = (envoyeSec: number): number => r3(Math.max(OMNIHUMAN_MIN_S, (Number(envoyeSec) || 0) - OMNIHUMAN_MARGE_S))
export const omnihumanCout = (envoyeSec: number): number => Math.ceil(Math.round(OMNIHUMAN_PER_SEC * omnihumanFactureSec(envoyeSec) * 100) / 100)

// Lecture bornée (flux, abandon au-delà de `max`) de NOTRE storage (l'URL a déjà été validée : render-media/<uid>/…).
async function lireBorne(url: string, max: number): Promise<Uint8Array | 'too_big' | null> {
  let r: Response
  try { r = await fetch(url, { signal: AbortSignal.timeout(20000) }) } catch { return null }
  if (!r.ok || !r.body) return null
  const len = Number(r.headers.get('content-length') || 0)
  if (len > max) { try { await r.body.cancel() } catch { /* */ } return 'too_big' }
  const chunks: Uint8Array[] = []; let total = 0
  const reader = r.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { try { await reader.cancel() } catch { /* */ } return 'too_big' }
    chunks.push(value)
  }
  const out = new Uint8Array(total); let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

export type OmnihumanAudio = { ok: true; url: string; path: string; envoyeSec: number; factureSec: number; cost: number } | { ok: false; status: number; error: string }

// Mesure + copie serveur de l'audio d'une soumission OmniHuman (clients et developer). Aucun tirage ici : l'appelant tire `cost`.
export async function omnihumanAudio(audioUrl: string, bucket: string, storeSign: string): Promise<OmnihumanAudio> {
  const bytes = await lireBorne(audioUrl, OMNIHUMAN_AUDIO_MAX_BYTES)
  if (bytes === 'too_big') return { ok: false, status: 400, error: `audio trop lourd (${Math.round(OMNIHUMAN_AUDIO_MAX_BYTES / 1024 / 1024)} Mo maximum)` }
  if (!bytes) return { ok: false, status: 400, error: 'audio inaccessible (lien expiré ou fichier absent) — relance la génération' }
  const envoyeSec = dureeWavSec(bytes)
  if (envoyeSec === null) return { ok: false, status: 400, error: 'audio illisible : un WAV PCM est attendu' }
  const factureSec = omnihumanFactureSec(envoyeSec)
  if (factureSec > OMNIHUMAN_MAX_S) return { ok: false, status: 400, error: `audio trop long (${Math.round(factureSec)} s) : ${OMNIHUMAN_MAX_S} secondes maximum par clip` }
  const st = svc().storage.from(bucket)
  const path = `${OMNIHUMAN_IN_DIR}/${crypto.randomUUID()}.wav`
  const up = await st.upload(path, bytes, { contentType: 'audio/wav', upsert: false })
  if (up.error) return { ok: false, status: 503, error: 'préparation de l’audio impossible — réessaie dans un instant' }
  const sg = await st.createSignedUrl(path, 3600)
  const signed = sg.data?.signedUrl || ''
  // createSignedUrl renvoie une URL absolue ; on la ramène à notre préfixe signé (même forme que les entrées client).
  if (sg.error || !signed.includes('/object/sign/' + bucket + '/' + path)) return { ok: false, status: 503, error: 'préparation de l’audio impossible — réessaie dans un instant' }
  const url = signed.startsWith(storeSign) ? signed : storeSign + signed.slice(signed.indexOf(path))
  return { ok: true, url, path, envoyeSec, factureSec, cost: omnihumanCout(envoyeSec) }
}

// Entrée acceptée = URL signée de NOTRE bucket, dans le dossier de l'appelant (même règle que okInput de kie-proxy).
export function entreeNotreStockage(u: unknown, uid: string, storeSign: string): string | null {
  const s = String(u ?? '')
  if (!s.startsWith(storeSign)) return null
  const p = s.slice(storeSign.length).split('?')[0]
  if (!p || /\.\.|%2e|%2f|%5c|@|\\/i.test(p) || !p.startsWith(uid + '/')) return null
  return s
}

// Repli fal de l'app (Axel 25/09 : « repli fal sur la MÊME op ») — corps OmniHuman RECONSTRUIT pour fal-proxy, audio MESURÉ
// ici (copie serveur, comme kie), coût EXACT = même formule que kie. Avant : draw_full (plancher 5) → le repli d'UNE scène
// vidait la réservation d'un montage entier (scènes suivantes 402) et une réserve de 5 finançait 60 s de vidéo.
// fal : 1080p jusqu'à 30 s d'audio, 720p au-delà (limite fal). Prompt ≤ 300 (le même que chez kie), vide → standard.
export async function omnihumanFalBody(raw: string, uid: string, bucket: string, storeSign: string): Promise<{ body: string; cost: number; envoyeSec: number; factureSec: number } | { status: number; error: string }> {
  let b: Record<string, unknown> | null = null
  try { b = JSON.parse(raw || '{}') } catch { /* traité juste dessous */ }
  if (!b || typeof b !== 'object') return { status: 400, error: 'corps JSON invalide' }
  const img = entreeNotreStockage(b.image_url, uid, storeSign), aud = entreeNotreStockage(b.audio_url, uid, storeSign)
  if (!img || !aud) return { status: 400, error: 'image_url / audio_url : URL de notre storage uniquement' }
  const oa = await omnihumanAudio(aud, bucket, storeSign)
  if (!oa.ok) return { status: oa.status, error: oa.error }
  const prompt = clampOmnihumanPrompt(b.prompt) || omnihumanPrompt({ hands: false })
  return { body: JSON.stringify({ image_url: img, audio_url: oa.url, resolution: oa.envoyeSec > 29.5 ? '720p' : '1080p', prompt }), cost: oa.cost, envoyeSec: oa.envoyeSec, factureSec: oa.factureSec }
}
