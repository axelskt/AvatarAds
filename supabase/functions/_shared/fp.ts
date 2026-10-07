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

// Décision (calibrée le 07/10). Deux cas :
//  - image exacte (la couverture tombe sur une image échantillonnée) : même vidéo ≤ 10-17, autre vidéo ≥ 20 ;
//  - image entre deux échantillons (4 par seconde) : le mot du sous-titre a changé, la bonne vidéo sort à 25-66 mais reste
//    loin devant (2e ≥ 1,7 × 1re) ; sur 70 vraies couvertures hors usine (@ia.axl, @avatarads), la 1re n'est jamais
//    nettement devant (rapport ≤ 1,34, et ≥ 80 dès qu'il dépasse 1,2).
// auto = sûr ; unsure = propositions (vidéos à ≤ 1,3 × la meilleure, 5 au plus) ; none = pas une vidéo de l'usine.
export const FP_AUTO = 18, FP_GAP = 6, FP_MAYBE = 45, FP_FAR = 70, FP_RATIO = 1.6
export function fpDecide(sc: { vf: string, score: number }[]): { vf: string | null, state: 'auto' | 'unsure' | 'none', score: number | null, candidates: { vf: string, score: number }[] } {
  const b = sc[0], b2 = sc[1]
  if (!b) return { vf: null, state: 'none', score: null, candidates: [] }
  // 5 au plus : une démo partagée par plusieurs vidéos F05 donne des ex aequo (couverture prise dans la démo)
  const cands = sc.filter((c) => c.score <= Math.max(FP_MAYBE, b.score * 1.3)).slice(0, 5)
  if (b.score <= FP_AUTO && (!b2 || b2.score - b.score >= FP_GAP)) return { vf: b.vf, state: 'auto', score: b.score, candidates: cands }
  if (b.score <= FP_FAR && (!b2 || (b2.score >= b.score * FP_RATIO && b2.score - b.score >= 20))) return { vf: b.vf, state: 'auto', score: b.score, candidates: cands }
  if (b.score <= FP_MAYBE || (b.score <= FP_FAR && b2 && b2.score >= b.score * 1.3)) return { vf: null, state: 'unsure', score: b.score, candidates: cands }
  return { vf: null, state: 'none', score: b.score, candidates: [] }
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
