// Rapprochement d'une COUVERTURE (TikTok, Instagram) avec les vidéos finales de l'usine — code commun à tiktok-auth et
// le serveur de l'usine (07/10 : sorti de tiktok-auth tel quel ; Instagram en a besoin quand la légende du reel n'est pas
// celle du kit). AUCUN import d'URL ici : le fichier est aussi chargé par Node (usine/cover-match.mjs, --experimental-strip-types).
// Le décodage de l'image est fourni par l'appelant (edge : _shared/cover-decode.ts ; Node : ffmpeg). Sur l'edge, comparer
// une couverture à TOUTES les empreintes dépasse le budget CPU (~2 s, « CPU Time exceeded » le 07/10) dès que l'usine a
// beaucoup de vidéos : Instagram est donc reconnu sur le serveur de l'usine.
import { fpCoverScore, fpCoverCoarse, fpCoarse, b64ToBytes, fpDecide, fpStyleCover, fpStyleDist, type FpCand } from './fp.ts'

// client Supabase minimal (tiktok-auth et ig-insights n'épinglent pas la même version de supabase-js)
// deno-lint-ignore no-explicit-any
type Svc = { from: (table: string) => any }
export type CoverMatch = { vf: string | null, state: string, score: number | null, candidates: { vf: string, score: number }[] }
export type Decoded = { w: number, h: number, gray: Uint8Array, rgba: ArrayLike<number> }
export type Decode = (bytes: Uint8Array) => Promise<Decoded | null>

// ── Rapprochement vidéo publiée → vidéo de l'usine (07/10) ──
// La couverture TikTok est une image du HOOK, pas forcément la première (constaté sur @avatarads le 07/10). On la compare
// aux empreintes de chaque vidéo finale (usine/fingerprint.mjs) avec le code partagé _shared/fp.ts : factory_fp (images à
// 0 / 0,5 / 1 s, ou le poster seul pour une vidéo supprimée) + factory_fp_frames (4 images par seconde sur les 10
// premières secondes). Pré-tri rapide sur 18 × 32, puis score fin sur les meilleures images des 8 vidéos les plus proches.
// Durée TikTok (secondes entières) à 1,5 s près quand celle de la vidéo est connue. auto = sûr ; unsure = 1-3 propositions
// à choisir dans Factory V2 ; none = pas une vidéo de l'usine (ancienne vidéo, autre montage).
// légende comparée sur ses 50 premiers caractères, sans hashtags ni casse
export const capNorm = (t: unknown) => String(t || '').replace(/#[^\s#]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 50)

export function coverMatcher(svc: Svc, decodeCover: Decode) {
  type Fp = { vf: string, url: string, duration: number | null, thumbs: Uint8Array[], coarse: Uint8Array[], styles: Uint8Array[], cap: string }
  let fpCache: { at: number, rows: Fp[] } | null = null
  async function loadFp(): Promise<Fp[]> {
    if (fpCache && Date.now() - fpCache.at < 10 * 60 * 1000) return fpCache.rows
    const { data, error } = await svc.from('factory_fp').select('vf, video_url, duration, thumbs, styles').not('thumbs', 'is', null).limit(3000)
    if (error) { console.log('empreintes', error.message); return [] }
    // légende du kit de chaque vidéo (indice seulement : Axel ne colle pas toujours la même sur TikTok)
    const { data: posts } = await svc.from('factory_posts').select('video_url, caption').not('video_url', 'is', null).limit(5000)
    const capOf = new Map((posts || []).map((p: any) => [String(p.video_url), capNorm(p.caption)]))
    const rows = (data || []).filter((r: any) => r.vf && Array.isArray(r.thumbs) && r.thumbs.length).map((r: any) => {
      const thumbs = r.thumbs.map((t: string) => b64ToBytes(t))
      return { vf: String(r.vf), url: String(r.video_url), duration: r.duration == null ? null : Number(r.duration), thumbs, coarse: thumbs.map(fpCoarse),
        styles: Array.isArray(r.styles) ? r.styles.map((t: string) => b64ToBytes(t)) : [], cap: capOf.get(String(r.video_url)) || '' }
    })
    fpCache = { at: Date.now(), rows }
    return rows
  }
  type Fr = { t: number, coarse: Uint8Array }
  let frCache: { at: number, by: Map<string, Fr[]> } | null = null
  async function loadFrames(): Promise<Map<string, Fr[]>> {
    if (frCache && Date.now() - frCache.at < 10 * 60 * 1000) return frCache.by
    const by = new Map<string, Fr[]>()
    for (let from = 0; from < 100000; from += 1000) {   // PostgREST : 1 000 lignes par page
      const { data, error } = await svc.from('factory_fp_frames').select('video_url, t, coarse').order('video_url').order('t').range(from, from + 999)
      if (error) { console.log('images du hook', error.message); break }
      for (const r of data || []) {
        const k = String(r.video_url)
        if (!by.has(k)) by.set(k, [])
        by.get(k)!.push({ t: Number(r.t), coarse: b64ToBytes(String(r.coarse)) })
      }
      if (!data || data.length < 1000) break
    }
    frCache = { at: Date.now(), by }
    return by
  }
  async function matchCover(bytes: Uint8Array, duration: number | null, title: string): Promise<CoverMatch | null> {
    const img = await decodeCover(bytes)
    if (!img) return null
    const style = fpStyleCover(img.rgba, img.w, img.h), cap = capNorm(title)
    const fps = (await loadFp()).filter((f) => f.duration == null || duration == null || Math.abs(f.duration - duration) <= 1.5)
    if (!fps.length) return { vf: null, state: 'none', score: null, candidates: [] }
    const frames = await loadFrames()
    // pré-tri : meilleure image (grossière) de chaque vidéo, en gardant les 3 meilleures images du hook pour le score fin
    const all = fps.map((f) => {
      const own = Math.min(...f.coarse.map((t) => fpCoverCoarse(img.gray, img.w, img.h, t)))
      const fr = (frames.get(f.url) || []).map((x) => ({ t: x.t, c: fpCoverCoarse(img.gray, img.w, img.h, x.coarse) })).sort((a, b) => a.c - b.c)
      const st = f.styles.length ? Math.min(...f.styles.map((x) => fpStyleDist(style, x))) : null
      return { f, c: Math.min(own, fr[0]?.c ?? Infinity), ts: fr.slice(0, 3).map((x) => x.t), st }
    })
    // score fin pour les 8 plus proches en luminance + les 3 plus proches en style
    const byC = [...all].sort((a, b) => a.c - b.c).slice(0, 8)
    const byS = all.filter((x) => x.st != null).sort((a, b) => (a.st as number) - (b.st as number)).slice(0, 3)
    const pick = [...new Set([...byC, ...byS])]
    const list: FpCand[] = await Promise.all(pick.map(async ({ f, ts, st }) => {
      let best = Math.min(...f.thumbs.map((t) => fpCoverScore(img.gray, img.w, img.h, t)))
      if (ts.length) {
        const { data } = await svc.from('factory_fp_frames').select('thumb').eq('video_url', f.url).in('t', ts)
        for (const r of data || []) best = Math.min(best, fpCoverScore(img.gray, img.w, img.h, b64ToBytes(String(r.thumb))))
      }
      return { vf: f.vf, score: +best.toFixed(1), style: st == null ? null : +st.toFixed(3), cap: !!cap && f.cap === cap }
    }))
    return fpDecide(list)
  }
  // Score de la couverture contre UNE vidéo précise (celle que le kit prévoyait à cette heure-là sur ce compte) : ses images
  // 0 / 0,5 / 1 s (ou son poster) + toutes ses images du hook. frames = false → poster seul (vidéo supprimée avant l'empreinte).
  async function scoreVf(bytes: Uint8Array, vf: string): Promise<{ score: number, frames: boolean } | null> {
    const img = await decodeCover(bytes)
    if (!img) return null
    const f = (await loadFp()).find((x) => x.vf === vf)
    if (!f) return null
    let best = Math.min(...f.thumbs.map((t) => fpCoverScore(img.gray, img.w, img.h, t)))
    const { data } = await svc.from('factory_fp_frames').select('thumb').eq('video_url', f.url)
    for (const r of data || []) best = Math.min(best, fpCoverScore(img.gray, img.w, img.h, b64ToBytes(String(r.thumb))))
    return { score: +best.toFixed(1), frames: (data || []).length > 0 }
  }
  return { matchCover, scoreVf }
}
