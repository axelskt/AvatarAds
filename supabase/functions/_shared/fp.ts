// Empreintes d'image pour reconnaître une vidéo de l'usine sur TikTok (07/10).
// L'API TikTok ne donne pas le fichier vidéo, seulement sa COUVERTURE (Axel garde celle par défaut = la première image)
// et sa durée. On compare cette couverture à la première image de chaque vidéo finale (table factory_fp).
// Fichier UNIQUE, importé par l'edge tiktok-auth (Deno) ET par usine/fingerprint.mjs (Node lit le TypeScript tel quel) :
// les deux côtés calculent forcément la même chose. Aucune syntaxe TypeScript non effaçable ici (pas d'enum, etc.).
//
// Pourquoi une vignette et pas seulement un hash : deux vidéos qui partagent photo + hook ont presque la même première
// image (dHash à 4-30 sur 256 bits) ; ce qui les sépare, c'est le premier mot du sous-titre et le texte choc. On compare
// donc des vignettes 54 × 96 en luminance, normalisées (moyenne et contraste : la couverture TikTok est réencodée), par
// blocs de 3 × 3, et on garde le 3e plus grand écart de bloc (robuste à 1-2 blocs de bord).

export const TH_W = 54, TH_H = 96

// RGBA → luminance 8 bits (BT.601, pleine échelle)
export function toGray(rgba: ArrayLike<number>, n: number): Uint8Array {
  const g = new Uint8Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000
  return g
}

// Réduction par moyenne de cases (bornes entières) : W × H → ow × oh
export function fpThumb(gray: ArrayLike<number>, W: number, H: number, ow = TH_W, oh = TH_H): Uint8Array {
  const out = new Uint8Array(ow * oh)
  for (let r = 0; r < oh; r++) {
    const y0 = Math.floor(r * H / oh), y1 = Math.max(y0 + 1, Math.floor((r + 1) * H / oh))
    for (let c = 0; c < ow; c++) {
      const x0 = Math.floor(c * W / ow), x1 = Math.max(x0 + 1, Math.floor((c + 1) * W / ow))
      let s = 0
      for (let y = y0; y < y1; y++) { const o = y * W; for (let x = x0; x < x1; x++) s += gray[o + x] }
      out[r * ow + c] = Math.round(s / ((y1 - y0) * (x1 - x0)))
    }
  }
  return out
}

// dHash 256 bits (17 × 16 cases, chaque case comparée à sa voisine de droite), en hexadécimal (64 caractères)
export function fpHash(gray: ArrayLike<number>, W: number, H: number): string {
  const t = fpThumb(gray, W, H, 17, 16)
  let hex = ''
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c += 4) {
    let nib = 0
    for (let b = 0; b < 4; b++) nib = (nib << 1) | (t[r * 17 + c + b] < t[r * 17 + c + b + 1] ? 1 : 0)
    hex += nib.toString(16)
  }
  return hex
}
export function fpDist(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1 } }
  return d
}

// Écart entre la vignette C (cw × ch) et la zone de T (54 × 96) qui commence en (ox, oy) : valeurs centrées-réduites sur
// la zone comparée (× 40 pour garder une échelle lisible), moyenne par bloc 3 × 3, 3e plus grand bloc.
function regionScore(C: ArrayLike<number>, cw: number, ch: number, T: ArrayLike<number>, ox: number, oy: number): number {
  const n = cw * ch
  let ma = 0, mb = 0
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { ma += C[y * cw + x]; mb += T[(y + oy) * TH_W + x + ox] }
  ma /= n; mb /= n
  let va = 0, vb = 0
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const a = C[y * cw + x] - ma, b = T[(y + oy) * TH_W + x + ox] - mb; va += a * a; vb += b * b
  }
  const sa = Math.sqrt(va / n) || 1, sb = Math.sqrt(vb / n) || 1
  const bl: number[] = []
  for (let r = 0; r + 3 <= ch; r += 3) for (let c = 0; c + 3 <= cw; c += 3) {
    let s = 0
    for (let y = r; y < r + 3; y++) for (let x = c; x < c + 3; x++) {
      s += Math.abs((C[y * cw + x] - ma) / sa - (T[(y + oy) * TH_W + x + ox] - mb) / sb)
    }
    bl.push(s / 9 * 40)
  }
  bl.sort((p, q) => q - p)
  return bl[Math.min(2, bl.length - 1)]
}

// Couverture (luminance W × H, n'importe quel cadrage) contre la vignette 54 × 96 d'une image de la vidéo. TikTok sert
// des couvertures en 9:16 (640 × 1139) ou recadrées en 3:4 (300 × 400) : pour un recadrage, on cherche la position de
// la zone visible (pas de 1 case) et on garde le meilleur alignement. Plus petit = plus ressemblant.
export function fpCoverScore(gray: ArrayLike<number>, W: number, H: number, T: ArrayLike<number>): number {
  const a = W / H, full = TH_W / TH_H
  if (Math.abs(a - full) <= 0.03) return regionScore(fpThumb(gray, W, H), TH_W, TH_H, T, 0, 0)
  let best = Infinity
  if (a > full) {   // plus large : toute la largeur, une bande de la hauteur
    const h = Math.max(24, Math.min(TH_H, Math.round(TH_W / a))), C = fpThumb(gray, W, H, TH_W, h)
    for (let oy = 0; oy + h <= TH_H; oy++) best = Math.min(best, regionScore(C, TH_W, h, T, 0, oy))
  } else {          // plus étroit : toute la hauteur, une bande de la largeur
    const w = Math.max(18, Math.min(TH_W, Math.round(TH_H * a))), C = fpThumb(gray, W, H, w, TH_H)
    for (let ox = 0; ox + w <= TH_W; ox++) best = Math.min(best, regionScore(C, w, TH_H, T, ox, 0))
  }
  return best
}

// Pré-tri rapide (l'edge a peu de temps de calcul) : vignettes 18 × 32 (moyenne 3 × 3 de la 54 × 96), écart moyen
// normalisé, même recherche d'alignement que fpCoverScore. Sert à garder les ~10 vidéos les plus proches avant le vrai score.
export const CO_W = 18, CO_H = 32
export function fpCoarse(T: ArrayLike<number>): Uint8Array { return fpThumb(T, TH_W, TH_H, CO_W, CO_H) }
function coarseMad(C: ArrayLike<number>, cw: number, ch: number, T: ArrayLike<number>, ox: number, oy: number): number {
  const n = cw * ch
  let ma = 0, mb = 0
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { ma += C[y * cw + x]; mb += T[(y + oy) * CO_W + x + ox] }
  ma /= n; mb /= n
  let va = 0, vb = 0
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const a = C[y * cw + x] - ma, b = T[(y + oy) * CO_W + x + ox] - mb; va += a * a; vb += b * b
  }
  const sa = Math.sqrt(va / n) || 1, sb = Math.sqrt(vb / n) || 1
  let d = 0
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) d += Math.abs((C[y * cw + x] - ma) / sa - (T[(y + oy) * CO_W + x + ox] - mb) / sb)
  return d / n * 40
}
export function fpCoverCoarse(gray: ArrayLike<number>, W: number, H: number, coarseT: ArrayLike<number>): number {
  const a = W / H, full = CO_W / CO_H
  if (Math.abs(a - full) <= 0.03) return coarseMad(fpThumb(gray, W, H, CO_W, CO_H), CO_W, CO_H, coarseT, 0, 0)
  let best = Infinity
  if (a > full) {
    const h = Math.max(8, Math.min(CO_H, Math.round(CO_W / a))), C = fpThumb(gray, W, H, CO_W, h)
    for (let oy = 0; oy + h <= CO_H; oy++) best = Math.min(best, coarseMad(C, CO_W, h, coarseT, 0, oy))
  } else {
    const w = Math.max(6, Math.min(CO_W, Math.round(CO_H * a))), C = fpThumb(gray, W, H, w, CO_H)
    for (let ox = 0; ox + w <= CO_W; ox++) best = Math.min(best, coarseMad(C, w, CO_H, coarseT, ox, 0))
  }
  return best
}

// ── Signature de style (07/10, idée d'Axel) ──
// Couleur de l'encadré du texte choc, couleur / effet des sous-titres, tons de la pièce : stables pendant tout le hook,
// même quand la tête bouge ou que le mot change (ce qui fait varier la vignette en luminance). Histogramme YCbCr
// (Y 4 × Cb 6 × Cr 6 = 144 cases) sur 3 bandes horizontales (35 / 30 / 35 %), sur une image réduite à 54 de large.
// Stocké pour 4 fenêtres : 9:16 entière + 3 fenêtres 3:4 (haut, centre, bas), parce que TikTok sert aussi des
// couvertures 3:4 recadrées. Mesuré sur les vraies couvertures du 07/10 : bonne vidéo 0,06-0,07, vidéos hors usine ≥ 0,20.
export const ST_BINS = 144, ST_LEN = ST_BINS * 3
function rgbThumb(rgba: ArrayLike<number>, W: number, H: number, step: number, ow: number, oh: number): Float64Array[] {
  // réduction par moyenne de cases, canal par canal (step = 3 pour du RGB, 4 pour du RGBA)
  const ch = [0, 1, 2].map(() => new Float64Array(ow * oh))
  for (let r = 0; r < oh; r++) {
    const y0 = Math.floor(r * H / oh), y1 = Math.max(y0 + 1, Math.floor((r + 1) * H / oh))
    for (let c = 0; c < ow; c++) {
      const x0 = Math.floor(c * W / ow), x1 = Math.max(x0 + 1, Math.floor((c + 1) * W / ow))
      let a = 0, b = 0, d = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * W + x) * step; a += rgba[o]; b += rgba[o + 1]; d += rgba[o + 2] }
      const n = (y1 - y0) * (x1 - x0)
      ch[0][r * ow + c] = a / n; ch[1][r * ow + c] = b / n; ch[2][r * ow + c] = d / n
    }
  }
  return ch
}
function bandSig(ch: Float64Array[], ow: number, r0: number, r1: number): Uint8Array {
  const out = new Uint8Array(ST_LEN)
  const bands = [[r0, r0 + Math.round((r1 - r0) * 0.35)], [r0 + Math.round((r1 - r0) * 0.35), r0 + Math.round((r1 - r0) * 0.65)], [r0 + Math.round((r1 - r0) * 0.65), r1]]
  bands.forEach(([a, b], k) => {
    const h = new Float64Array(ST_BINS)
    let n = 0
    for (let r = a; r < b; r++) for (let c = 0; c < ow; c++) {
      const i = r * ow + c, R = ch[0][i], G = ch[1][i], B = ch[2][i]
      const Y = 0.299 * R + 0.587 * G + 0.114 * B, Cb = 128 - 0.1687 * R - 0.3313 * G + 0.5 * B, Cr = 128 + 0.5 * R - 0.4187 * G - 0.0813 * B
      const yi = Math.min(3, Math.max(0, Math.floor(Y / 64))), bi = Math.min(5, Math.max(0, Math.floor((Cb - 64) / 128 * 6))), ri = Math.min(5, Math.max(0, Math.floor((Cr - 64) / 128 * 6)))
      h[yi * 36 + bi * 6 + ri]++; n++
    }
    for (let j = 0; j < ST_BINS; j++) out[k * ST_BINS + j] = Math.round(h[j] / (n || 1) * 255)
  })
  return out
}
// Image d'une vidéo (RGB ou RGBA, W × H en 9:16) → 4 signatures (9:16, 3:4 haut, 3:4 centre, 3:4 bas), concaténées
export function fpStyleSet(px: ArrayLike<number>, W: number, H: number, step = 3): Uint8Array {
  const ch = rgbThumb(px, W, H, step, TH_W, TH_H), w34 = Math.round(TH_W * 4 / 3)
  const out = new Uint8Array(ST_LEN * 4)
  out.set(bandSig(ch, TH_W, 0, TH_H), 0)
  ;[0, Math.floor((TH_H - w34) / 2), TH_H - w34].forEach((o, k) => out.set(bandSig(ch, TH_W, o, o + w34), ST_LEN * (k + 1)))
  return out
}
// Couverture TikTok (RGBA) → sa signature + son cadrage (9:16 ou 3:4)
export function fpStyleCover(rgba: ArrayLike<number>, W: number, H: number): { sig: Uint8Array, crop: boolean } {
  const crop = Math.abs(W / H - 0.75) < Math.abs(W / H - TH_W / TH_H)
  const oh = crop ? Math.round(TH_W * 4 / 3) : TH_H
  return { sig: bandSig(rgbThumb(rgba, W, H, 4, TH_W, oh), TH_W, 0, oh), crop }
}
// Distance 0..1 (moitié de l'écart L1 entre histogrammes, moyenne des 3 bandes) ; fenêtres 3:4 : la plus proche
export function fpStyleDist(cover: { sig: Uint8Array, crop: boolean }, set: Uint8Array): number {
  const one = (off: number) => {
    let d = 0
    for (let j = 0; j < ST_LEN; j++) d += Math.abs(cover.sig[j] - set[off + j])
    return d / 255 / 2 / 3
  }
  return cover.crop ? Math.min(one(ST_LEN), one(ST_LEN * 2), one(ST_LEN * 3)) : one(0)
}

// ── Décision (calibrée le 07/10) ──
// Luminance (g, plus petit = plus ressemblant) :
//  - image exacte (la couverture tombe sur une image échantillonnée) : même vidéo ≤ 10-17, autre vidéo ≥ 20 ;
//  - image entre deux échantillons : la bonne vidéo sort à 25-66 mais reste loin devant (2e ≥ 1,7 × 1re) ; sur 70 vraies
//    couvertures hors usine, la 1re n'est jamais nettement devant (rapport ≤ 1,34, et ≥ 80 dès qu'il dépasse 1,2).
// Style (d) : bonne vidéo 0,06-0,08 ; hors usine ≥ 0,19 (proposition dès 0,15). Légende (cap) : la légende du kit de la vidéo ; simple indice
// (Axel ne colle pas toujours la même légende sur TikTok : « UGC » sur la vidéo VF-0026 en CTA-GUIDE).
// auto = sûr ; unsure = propositions (5 au plus) ; none = pas une vidéo de l'usine.
export const FP_AUTO = 18, FP_GAP = 6, FP_MAYBE = 45, FP_FAR = 70, FP_RATIO = 1.6, ST_SURE = 0.12, ST_GAP = 0.03, ST_MAYBE = 0.15
export type FpCand = { vf: string, score: number, style: number | null, cap: boolean }
export function fpDecide(list: FpCand[]): { vf: string | null, state: 'auto' | 'unsure' | 'none', score: number | null, candidates: { vf: string, score: number }[] } {
  if (!list.length) return { vf: null, state: 'none', score: null, candidates: [] }
  const byG = [...list].sort((a, b) => a.score - b.score), g1 = byG[0], g2 = byG[1]
  const byS = list.filter((c) => c.style != null).sort((a, b) => (a.style as number) - (b.style as number)), s1 = byS[0], s2 = byS[1]
  // propositions : les meilleures en luminance et en style, rangées par rang cumulé (la légende avance d'un rang)
  const rank = new Map<string, number>()
  list.forEach((c) => {
    const rg = byG.indexOf(c), rs = c.style == null ? list.length : byS.indexOf(c)
    rank.set(c.vf, rg + rs - (c.cap ? 1 : 0))
  })
  const cands = list.filter((c) => c.score <= Math.max(FP_MAYBE, g1.score * 1.3) || (c.style != null && s1 && c.style <= Math.min(ST_MAYBE, (s1.style as number) + 0.05)))
    .sort((a, b) => (rank.get(a.vf) as number) - (rank.get(b.vf) as number)).slice(0, 5).map((c) => ({ vf: c.vf, score: c.score }))
  const auto = (c: FpCand) => ({ vf: c.vf, state: 'auto' as const, score: c.score, candidates: cands })
  if (g1.score <= FP_AUTO && (!g2 || g2.score - g1.score >= FP_GAP)) return auto(g1)
  if (g1.score <= FP_FAR && (!g2 || (g2.score >= g1.score * FP_RATIO && g2.score - g1.score >= 20))) return auto(g1)
  if (s1 && (s1.style as number) <= ST_SURE) {
    if (!s2 || (s2.style as number) - (s1.style as number) >= ST_GAP) return auto(s1)
    // style net mais serré : il faut que la luminance (à 10 % près de la meilleure) et la légende le confirment
    if (s1.score <= g1.score * 1.1 && s1.cap) return auto(s1)
  }
  if (cands.length && (g1.score <= FP_MAYBE || (g1.score <= FP_FAR && g2 && g2.score >= g1.score * 1.3) || (s1 && (s1.style as number) <= ST_MAYBE))) {
    return { vf: null, state: 'unsure', score: g1.score, candidates: cands }
  }
  return { vf: null, state: 'none', score: g1.score, candidates: [] }
}

// base64 ↔ octets (vignettes stockées en base64 dans factory_fp.thumbs)
export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s), out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function bytesToB64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
