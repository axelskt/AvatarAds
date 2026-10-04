// mp4-duree.ts — vidéo d'un client facturée À LA SECONDE : durée MESURÉE par le serveur (audit 02/10, PRX-1).
//
// Motion Control (fal Kling 2.6 / 3.0) et le Module Omni (fal gemini-omni-flash v1.1/edit) se paient à la seconde de la
// vidéo envoyée par le client. fal-proxy ne réservait qu'un PLANCHER fixe (2 / 4 / 6 / 3 crédits) et relayait le corps tel
// quel : une réserve de 2 finançait une vidéo de 15 s. Désormais, pour ces deux chemins (clients, jamais le moteur de rendu) :
//   1. la vidéo doit venir de NOTRE stockage (render-media/<uid de l'appelant>/…), sinon 400 ;
//   2. le serveur en fait une COPIE dans render-media/fal-in/<uid>/ (premier segment ≠ un uid : aucune policy ne laisse le
//      client y écrire) — remplacer son fichier après la mesure ne change donc plus ce que fal reçoit ;
//   3. il MESURE la durée de cette copie (lecture partielle par Range : en-têtes des boîtes, puis `moov` seul) ;
//   4. il réécrit le corps (champs de l'app seulement) vers une URL signée de la copie, et réserve tarif/s × durée.
// Durée illisible → 400 (jamais de repli au plancher). Même arrondi que l'app (seconde supérieure) avec 1 s de tolérance
// (+ 0,25 s de gigue de ré-encodage) en faveur du client, moins les étapes annexes déjà payées sur la même op (≤ 6 crédits,
// minimumSurReserve) : le minimum serveur ne dépasse jamais ce que l'app débite. Audit 04/10 : Omni (fichier original, sans
// ré-encodage) = 0,5 s de marge et aucune remise d'étapes annexes (OMNI-S1 / OMNI-S2).
//
// DURÉE RETENUE = la PLUS LONGUE des durées de présentation déclarées : mvhd, et pour chaque piste vidéo / son : tkhd, la
// liste d'éditions (elst) si elle existe, sinon la durée du média (mdhd, somme des stts). Un MP4 fragmenté ajoute mehd et
// la somme des échantillons de ses fragments (trun). Rétrécir un seul champ (mvhd) ne fait donc plus payer moins ; un média
// rogné par une liste d'éditions (coupe sans ré-encodage) n'est compté que pour ce qui est joué — comme le navigateur.
// Audit 02/10 (revue + reprise 03/10) : la mesure doit voir les MÊMES pistes que le décodeur de fal (ffmpeg / libavformat).
// Trois contournements vérifiés avec ffmpeg 8.1 sur un MP4 de 15 s mesuré 1 s ici : (a) piste rendue invisible (hdlr
// inconnu, tkhd / mdhd / hdlr renommés — ffmpeg classe la piste par le FORMAT de stsd et tolère ces absences) ; (b) vrai moov
// compressé dans un `cmov` ; (c) boîte de minutage cachée ailleurs qu'à sa place (elst dans trak > udta : ffmpeg la lit et
// décode 15 s ; piste `trak` au premier niveau du fichier : 2e flux de 15 s). Désormais : pistes classées comme ffmpeg, cmov
// ou aucune piste audio / vidéo → illisible, et toute boîte qui fixe pistes / minutage (SENSIBLES) doit être à SA place, une
// seule fois — sinon illisible. Aucun multiplexeur réel (téléphone, navigateur, ffmpeg) n'en met ailleurs.
// MP4 et MOV (QuickTime) : même structure. Tout le reste (WebM, audio, octets quelconques) → null = illisible.
// mp4Duree (balayage brut de l'atome mvhd) = port fidèle de supabase/functions/mcp/index.ts, gardé pour référence / tests.

const txt = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
const r3 = (n: number) => Math.round(n * 1000) / 1000
const PLAFOND_SEC = 6 * 3600   // au-delà : valeur aberrante (champ forgé / corrompu) → illisible

// ── Port fidèle de mcp/index.ts (balayage de « mvhd ») ──────────────────────────────────────────────────────────────────
export function mp4Duree(b: Uint8Array): number | null {
  for (let i = 4; i < b.length - 32; i++) {
    if (b[i] !== 0x6d || b[i + 1] !== 0x76 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue   // « mvhd »
    const dv = new DataView(b.buffer, b.byteOffset + i + 4), v = dv.getUint8(0)
    const ts = v === 1 ? dv.getUint32(20) : dv.getUint32(12)
    const du = v === 1 ? Number(dv.getBigUint64(24)) : dv.getUint32(16)
    if (ts > 0 && du > 0) return du / ts
  }
  return null
}

// ── Boîtes ISO-BMFF ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type Boite = { type: string; off: number; hdr: number; size: number }
// Enfants de [deb, fin[ ; null si une taille sort du parent (fichier tronqué / forgé). Moins de 8 octets en fin = bourrage.
export function boites(b: Uint8Array, deb: number, fin: number): Boite[] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Boite[] = []
  let off = deb
  while (off + 8 <= fin) {
    let size = dv.getUint32(off), hdr = 8
    if (size === 1) {
      if (off + 16 > fin) return null
      const big = dv.getBigUint64(off + 8)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
      size = Number(big); hdr = 16
    } else if (size === 0) size = fin - off
    if (size < hdr || off + size > fin) return null
    out.push({ type: txt(b, off + 4), off, hdr, size })
    if (out.length > 20000) return null
    off += size
  }
  return out
}
const enfant = (l: Boite[] | null, t: string) => (l || []).find((x) => x.type === t)
const contenu = (b: Uint8Array, x: Boite) => boites(b, x.off + x.hdr, x.off + x.size)
// Audit 02/10 : une boîte d'un même groupe présente 2 fois dans le même parent (deux stts, deux elst…) → illisible : ffmpeg
// garde la DERNIÈRE (ou échoue), ce module lisait la première.
const doublon = (l: Boite[], ...groupes: string[][]) => groupes.some((g) => l.filter((x) => g.includes(x.type)).length > 1)

// Audit 02/10 (revue) : entrées stsd NON audio / vidéo — timecode, sous-titres, chapitres, métadonnées, indices. ffmpeg ne
// les décode ni en image ni en son. Tout autre format (avc1, hvc1, mp4a… ou inconnu) compte comme audio / vidéo.
const NON_AV = new Set(['tmcd', 'text', 'tx3g', 'wvtt', 'stpp', 'sbtt', 'c608', 'c708', 'mett', 'metx', 'mebx', 'mp4s',
  'rtp ', 'srtp', 'rtcp', 'fdp ', 'gpmd', 'camm', 'fdsc', 'djmd', 'dbgi'])
// Audit 02/10 (reprise 03/10) : boîtes qui fixent les pistes ou leur minutage. ffmpeg les lit OÙ QU'ELLES SOIENT (il parcourt
// udta, edts, entrées stsd… et même le premier niveau du fichier avec la même table) : chacune doit être à la place lue ici.
export const SENSIBLES = new Set(['moov', 'cmov', 'mvhd', 'trak', 'tkhd', 'edts', 'elst', 'mdia', 'mdhd', 'minf', 'stbl',
  'stsd', 'stts', 'ctts', 'stsz', 'stz2', 'stsc', 'stco', 'co64', 'mvex', 'mehd', 'trex', 'moof', 'traf', 'tfhd', 'tfdt', 'trun'])
const CODES_SENSIBLES = new Set([...SENSIBLES].map((t) => ((t.charCodeAt(0) << 24) | (t.charCodeAt(1) << 16) | (t.charCodeAt(2) << 8) | t.charCodeAt(3)) >>> 0))
const INITIALES = new Uint8Array(256); for (const t of SENSIBLES) INITIALES[t.charCodeAt(0)] = 1
// Y a-t-il dans [deb, fin[ un en-tête PLAUSIBLE (taille 0 / 1 / qui tient avant `fin`) d'une boîte sensible, ailleurs qu'aux
// positions `vues` (boîtes lues à leur place) ? Du texte devant le type donne une taille énorme : jamais plausible.
// `exclus` = contenus de bourrage (free / skip / wide) que ffmpeg saute sans les lire : l'iPhone y laisse l'ancien `mvex`
// (7 trex) de son enregistrement fragmenté, renommé `free` à la finalisation (IMG_6663.MOV, iOS 27).
const BOURRAGE = new Set(['free', 'skip', 'wide'])
export function sensibleCachee(b: Uint8Array, deb: number, fin: number, vues: Set<number>, exclus: [number, number][] = []): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const ex = exclus.slice().sort((x, y) => x[0] - y[0])
  let k = 0
  for (let p = deb; p + 8 <= fin; p++) {
    while (k < ex.length && ex[k][1] <= p) k++
    if (k < ex.length && p >= ex[k][0]) { p = ex[k][1] - 1; continue }
    if (!INITIALES[b[p + 4]] || !CODES_SENSIBLES.has(dv.getUint32(p + 4)) || vues.has(p)) continue
    const s = dv.getUint32(p)
    if (s <= 1 || (s >= 8 && s <= fin - p)) return true
  }
  return false
}

type Piste = { ts: number; av: boolean; ticksMdhd: number; ticksStts: number; secPres: number; defDur: number }
export type MoovInfo = { sec: number; mvTs: number; fragmente: boolean; pistes: Map<number, Piste> }

// Lit une boîte `moov` COMPLÈTE (en-tête compris). null = structure inattendue (pas de mvhd, tailles incohérentes, boîte
// sensible hors de sa place ou en double, aucune piste audio / vidéo…).
export function lireMoov(b: Uint8Array): MoovInfo | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const top = boites(b, 0, b.length), moov = top && top.length === 1 && top[0].type === 'moov' ? top[0] : null
  if (!moov) return null
  const vues = new Set<number>(), exclus: [number, number][] = []   // boîtes lues à leur place / bourrage (sensibleCachee)
  const enfants = (x: Boite) => {
    const l = contenu(b, x)
    if (l) for (const k of l) { vues.add(k.off); if (BOURRAGE.has(k.type)) exclus.push([k.off + k.hdr, k.off + k.size]) }
    return l
  }
  const kids = enfants(moov), mvhd = enfant(kids, 'mvhd')
  if (!kids || !mvhd) return null
  // Audit 02/10 (revue) : moov compressé (cmov, que ffmpeg décompresse) = les vraies pistes sont invisibles ici → illisible
  if (enfant(kids, 'cmov') || doublon(kids, ['mvhd'], ['mvex'])) return null
  const lit = (x: Boite, besoin: number) => x.off + x.hdr + besoin <= x.off + x.size   // champ dans la boîte ?
  const u64 = (o: number) => Number(dv.getBigUint64(o))
  const duree = (o: number, v: number) => {   // durée 32 / 64 bits ; « tout à 1 » = inconnue → 0
    const d = v === 1 ? dv.getBigUint64(o) : BigInt(dv.getUint32(o))
    return (v === 1 ? d === 0xFFFFFFFFFFFFFFFFn : d === 0xFFFFFFFFn) ? 0 : Number(d)
  }
  const c0 = mvhd.off + mvhd.hdr, v0 = b[c0]
  if (!lit(mvhd, v0 === 1 ? 32 : 20)) return null
  const mvTs = v0 === 1 ? dv.getUint32(c0 + 20) : dv.getUint32(c0 + 12)
  if (!(mvTs > 0)) return null
  let sec = duree(v0 === 1 ? c0 + 24 : c0 + 16, v0) / mvTs
  const pistes = new Map<number, Piste>()
  let fictif = -1, nbAv = 0
  for (const t of kids.filter((x) => x.type === 'trak')) {
    const tk = enfants(t); if (!tk) return null
    if (doublon(tk, ['tkhd'], ['mdia'], ['edts'])) return null
    const tkhd = enfant(tk, 'tkhd'), mdia = enfant(tk, 'mdia')
    if (!mdia) continue   // ni format ni échantillons : rien à décoder
    // Audit 02/10 (revue) : tkhd absent → ffmpeg décode quand même : durée 0, numéro fictif (aucun fragment ne s'y rattache)
    let id = fictif--, tkhdSec = 0
    if (tkhd) {
      const ct = tkhd.off + tkhd.hdr, vt = b[ct]
      if (!lit(tkhd, vt === 1 ? 36 : 24)) return null
      id = vt === 1 ? dv.getUint32(ct + 20) : dv.getUint32(ct + 12)
      tkhdSec = duree(vt === 1 ? ct + 28 : ct + 20, vt) / mvTs
    }
    if (pistes.has(id)) return null   // deux pistes du même numéro : ffmpeg rattache les fragments à l'une, ce module à l'autre
    const md = enfants(mdia); if (!md) return null
    if (doublon(md, ['mdhd'], ['hdlr'], ['minf'])) return null
    const mdhd = enfant(md, 'mdhd'), hdlr = enfant(md, 'hdlr')
    // Audit 02/10 (revue) : mdhd absent → échelle du film, comme ffmpeg ; échelle 0 → 1 (ffmpeg prend celle du film : 1 donne
    // une durée au moins aussi longue). Ces pistes ne sont plus ignorées.
    let ts = mvTs, ticksMdhd = 0
    if (mdhd) {
      const cm = mdhd.off + mdhd.hdr, vm = b[cm]
      if (!lit(mdhd, vm === 1 ? 32 : 20)) return null
      const e = vm === 1 ? dv.getUint32(cm + 20) : dv.getUint32(cm + 12)
      ts = e > 0 ? e : 1
      ticksMdhd = duree(vm === 1 ? cm + 24 : cm + 16, vm)
    }
    const minf = enfant(md, 'minf'), mi = minf ? enfants(minf) : null
    if (minf && !mi) return null
    if (mi && doublon(mi, ['stbl'])) return null
    const stbl = enfant(mi, 'stbl'), sb = stbl ? enfants(stbl) : null
    if (stbl && !sb) return null
    if (sb && doublon(sb, ['stsd'], ['stts'], ['ctts'], ['stsc'], ['stsz', 'stz2'], ['stco', 'co64'])) return null
    // Audit 02/10 (revue) : audio / vidéo = hdlr vide / soun, OU une entrée stsd dont le format n'est pas NON_AV — ffmpeg classe
    // la piste par ce format (un hdlr « xxxx » ou absent sur de l'avc1 reste une vidéo décodée).
    const genre = hdlr && lit(hdlr, 12) ? txt(b, hdlr.off + hdlr.hdr + 8) : ''
    const stsd = enfant(sb, 'stsd'), formats: string[] = []
    if (stsd && lit(stsd, 16)) {
      const ent = boites(b, stsd.off + stsd.hdr + 8, stsd.off + stsd.size)
      if (ent && ent.length) for (const e of ent) formats.push(e.type)
      else formats.push(txt(b, stsd.off + stsd.hdr + 12))
    }
    const av = genre === 'vide' || genre === 'soun' || formats.some((f) => !NON_AV.has(f))
    if (av) nbAv++
    // stts : somme des durées d'échantillons (ce que le décodeur horodate réellement)
    let ticksStts = 0, nStts = 0, dernier = 0
    const stts = enfant(sb, 'stts')
    if (stts) {
      const cs = stts.off + stts.hdr
      if (!lit(stts, 8)) return null
      const n = dv.getUint32(cs + 4)
      if (cs + 8 + n * 8 > stts.off + stts.size) return null
      for (let i = 0; i < n; i++) { const c = dv.getUint32(cs + 8 + i * 8), d = dv.getUint32(cs + 12 + i * 8); ticksStts += c * d; nStts += c; dernier = d }
    }
    // Audit 02/10 (reprise) : échantillons de stsz que stts ne couvre pas (stts « 1 × 512 » sur 375 images) — ffmpeg les décode
    // TOUS : comptés à la durée de la dernière entrée de stts. Plusieurs images sans aucune durée → illisible.
    const stsz = sb?.find((x) => x.type === 'stsz' || x.type === 'stz2')
    if (stsz) {
      if (!lit(stsz, 12)) return null
      const n = dv.getUint32(stsz.off + stsz.hdr + 8)
      if (n > nStts) { if (av && n > 1 && !(ticksStts > 0)) return null; ticksStts += (n - nStts) * dernier }
    }
    // elst : la présentation (rognage / décalage) — en échelle du film. Une entrée de durée 0 veut dire « jusqu'à la fin du
    // média » : la liste ne borne alors plus rien → durées du média (sinon tkhd + elst à 0 sous-mesureraient un fichier forgé).
    const edts = enfant(tk, 'edts'), ed = edts ? enfants(edts) : null
    if (edts && !ed) return null
    if (ed && doublon(ed, ['elst'])) return null
    const elst = enfant(ed, 'elst')
    let elstSec = -1
    if (elst) {
      const ce = elst.off + elst.hdr, ve = b[ce]
      if (!lit(elst, 8)) return null
      const n = dv.getUint32(ce + 4), pas = ve === 1 ? 20 : 12
      if (ce + 8 + n * pas > elst.off + elst.size) return null
      let s = 0, zero = false
      for (let i = 0; i < n; i++) { const d = ve === 1 ? u64(ce + 8 + i * pas) : dv.getUint32(ce + 8 + i * pas); if (d === 0) zero = true; s += d }
      if (n > 0 && !zero) elstSec = s / mvTs
    }
    const secPres = elstSec >= 0 ? Math.max(tkhdSec, elstSec) : Math.max(tkhdSec, ticksMdhd / ts, ticksStts / ts)
    pistes.set(id, { ts, av, ticksMdhd, ticksStts, secPres, defDur: 0 })
    if (av) sec = Math.max(sec, secPres)
  }
  // Audit 02/10 (revue) : aucune piste audio / vidéo lisible → illisible (jamais facturé sur le seul mvhd, champ du client)
  if (!nbAv) return null
  // MP4 fragmenté : mehd (durée totale annoncée) + durées par défaut des fragments (trex)
  const mvex = enfant(kids, 'mvex')
  if (mvex) {
    const mx = enfants(mvex); if (!mx) return null
    if (doublon(mx, ['mehd'])) return null
    const mehd = enfant(mx, 'mehd')
    if (mehd) { const c = mehd.off + mehd.hdr, v = b[c]; if (!lit(mehd, v === 1 ? 12 : 8)) return null; sec = Math.max(sec, duree(c + 4, v) / mvTs) }
    const trexVus = new Set<number>()
    for (const t of mx.filter((x) => x.type === 'trex')) {
      const c = t.off + t.hdr; if (!lit(t, 16)) return null
      const tid = dv.getUint32(c + 4)
      if (trexVus.has(tid)) return null   // deux trex pour une piste : durées par défaut ambiguës
      trexVus.add(tid)
      const p = pistes.get(tid); if (p) p.defDur = dv.getUint32(c + 12)
    }
  }
  // Audit 02/10 (reprise) : une boîte sensible ailleurs qu'à sa place (elst dans trak > udta, trak dans udta, stts dans une
  // entrée stsd…) serait lue par ffmpeg et pas ici → illisible.
  if (sensibleCachee(b, moov.hdr, moov.size, vues, exclus)) return null
  if (!Number.isFinite(sec)) return null
  return { sec, mvTs, fragmente: !!mvex, pistes }
}

// Fragments (moof) : somme des durées d'échantillons par piste + étendue [premier tfdt ; dernière fin]. Mutates `acc`.
export type AccFrag = Map<number, { somme: number; debut: number; fin: number }>
export function lireMoof(b: Uint8Array, info: MoovInfo, acc: AccFrag): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const top = boites(b, 0, b.length), moof = top && top.length === 1 && top[0].type === 'moof' ? top[0] : null
  if (!moof) return false
  const vues = new Set<number>(), exclus: [number, number][] = []   // audit 02/10 : comme lireMoov
  const enfants = (x: Boite) => {
    const l = contenu(b, x)
    if (l) for (const k of l) { vues.add(k.off); if (BOURRAGE.has(k.type)) exclus.push([k.off + k.hdr, k.off + k.size]) }
    return l
  }
  const kids = enfants(moof); if (!kids) return false
  for (const traf of kids.filter((x) => x.type === 'traf')) {
    const tf = enfants(traf); if (!tf) return false
    if (doublon(tf, ['tfhd'], ['tfdt'])) return false
    const tfhd = enfant(tf, 'tfhd'); if (!tfhd) return false
    const ch = tfhd.off + tfhd.hdr, fin = tfhd.off + tfhd.size
    if (ch + 8 > fin) return false
    const fl = dv.getUint32(ch) & 0xFFFFFF, id = dv.getUint32(ch + 4)
    let o = ch + 8 + (fl & 0x01 ? 8 : 0) + (fl & 0x02 ? 4 : 0)
    // Audit 02/10 : fragment d'une piste absente du moov (ffmpeg 8.1 refuse le fichier) → illisible, plus jamais ignoré
    const piste = info.pistes.get(id); if (!piste) return false
    let defDur = piste.defDur
    if (fl & 0x08) { if (o + 4 > fin) return false; defDur = dv.getUint32(o) }
    let base = -1
    const tfdt = enfant(tf, 'tfdt')
    if (tfdt) { const c = tfdt.off + tfdt.hdr, v = b[c]; if (c + (v === 1 ? 12 : 8) > tfdt.off + tfdt.size) return false; base = v === 1 ? Number(dv.getBigUint64(c + 4)) : dv.getUint32(c + 4) }
    let somme = 0
    for (const tr of tf.filter((x) => x.type === 'trun')) {
      const c = tr.off + tr.hdr, f = tr.off + tr.size
      if (c + 8 > f) return false
      const tfl = dv.getUint32(c) & 0xFFFFFF, n = dv.getUint32(c + 4)
      o = c + 8 + (tfl & 0x01 ? 4 : 0) + (tfl & 0x04 ? 4 : 0)
      const pas = (tfl & 0x100 ? 4 : 0) + (tfl & 0x200 ? 4 : 0) + (tfl & 0x400 ? 4 : 0) + (tfl & 0x800 ? 4 : 0)
      if (o + n * pas > f) return false
      if (tfl & 0x100) for (let i = 0; i < n; i++) somme += dv.getUint32(o + i * pas)
      else somme += n * defDur
    }
    const a = acc.get(id) || { somme: 0, debut: Infinity, fin: 0 }
    a.somme += somme
    if (base >= 0) { a.debut = Math.min(a.debut, base); a.fin = Math.max(a.fin, base + somme) }
    acc.set(id, a)
  }
  return !sensibleCachee(b, moof.hdr, moof.size, vues, exclus)
}

// Durée finale d'après moov + fragments. null = illisible / aberrante.
export function dureeDepuis(info: MoovInfo, acc: AccFrag): number | null {
  let sec = info.sec
  for (const [id, a] of acc) {
    const p = info.pistes.get(id)
    if (!p) return null   // (lireMoof refuse déjà les pistes inconnues)
    if (!p.av) continue
    const etendue = a.fin > 0 && Number.isFinite(a.debut) ? a.fin - a.debut : 0
    // mdhd d'un MP4 fragmenté = soit la partie du moov, soit le TOTAL (selon le multiplexeur) : jamais additionné aux fragments
    sec = Math.max(sec, Math.max(p.ticksMdhd, p.ticksStts + Math.max(a.somme, etendue)) / p.ts)
  }
  return Number.isFinite(sec) && sec > 0 && sec < PLAFOND_SEC ? r3(sec) : null
}

// Audit 02/10 (reprise 03/10) : PREMIER NIVEAU. ffmpeg y lit aussi les boîtes sensibles (une `trak` après le moov = 2e flux
// de 15 s, vérifié 8.1) et parcourt certaines boîtes (udta, meta…) avec sa table. Seules les boîtes qu'il ne parcourt pas
// (données, bourrage, index) sont sautées sans lecture ; une boîte sensible → illisible ; toute autre est lue et inspectée.
const SAUTABLES = new Set(['mdat', 'free', 'skip', 'wide', 'ftyp', 'styp', 'uuid', 'sidx', 'ssix', 'mfra', 'emsg', 'prft', 'pdin'])
const hautSuspect = (type: string, b: Uint8Array, deb: number, fin: number): boolean =>
  SENSIBLES.has(type) || sensibleCachee(b, deb, fin, new Set())

// Durée d'un MP4 / MOV ENTIER déjà en mémoire (tests, petits fichiers). null = illisible.
export function dureeMp4Octets(b: Uint8Array): number | null {
  const top = boites(b, 0, b.length); if (!top) return null
  const moovs = top.filter((x) => x.type === 'moov'); if (moovs.length !== 1) return null
  for (const x of top) if (x.type !== 'moov' && x.type !== 'moof' && !SAUTABLES.has(x.type) && hautSuspect(x.type, b, x.off + x.hdr, x.off + x.size)) return null
  const info = lireMoov(b.subarray(moovs[0].off, moovs[0].off + moovs[0].size)); if (!info) return null
  const acc: AccFrag = new Map()
  for (const f of top.filter((x) => x.type === 'moof')) if (!lireMoof(b.subarray(f.off, f.off + f.size), info, acc)) return null
  return dureeDepuis(info, acc)
}

// ── Lecture partielle (Range) ───────────────────────────────────────────────────────────────────────────────────────────
// `lire(debut, fin)` (bornes incluses) → les octets + la taille TOTALE du fichier. null = lecture impossible.
export type LecteurPlage = (debut: number, fin: number) => Promise<{ octets: Uint8Array; total: number } | null>
const TETE = 256 * 1024, FENETRE = 64 * 1024
const MOOV_MAX = 16 * 1024 * 1024, MOOF_MAX = 4 * 1024 * 1024, FRAGS_MAX = 2000, LECTURES_MAX = 400, BOITES_MAX = 5000
// Audit 02/10 (reprise) : octets gardés / inspectés au total (moov + moof + boîtes de premier niveau lues) — 400 moof de 4 Mio
// tenaient en mémoire avant (≈ 1,6 Go). Une vidéo réelle de ≤ 30 s en lit quelques dizaines de Kio.
const OCTETS_MAX = 48 * 1024 * 1024

// Garde `max` octets du flux après en avoir SAUTÉ `sauter` (jamais plus que la fenêtre en mémoire), puis coupe le flux.
async function lireFenetre(r: Response, sauter: number, max: number): Promise<Uint8Array | null> {
  if (!r.body) return null
  const reader = r.body.getReader(), out = new Uint8Array(max)
  let vu = 0, o = 0
  try {
    while (o < max) {
      const { done, value } = await reader.read()
      if (done) break
      const deb = Math.max(0, sauter - vu)
      vu += value.byteLength
      if (deb >= value.byteLength) continue
      const k = Math.min(value.byteLength - deb, max - o)
      out.set(value.subarray(deb, deb + k), o); o += k
    }
  } catch { return null } finally { try { await reader.cancel() } catch { /* */ } }
  return out.subarray(0, o)
}
// Lecteur HTTP : 206 + Content-Range (Supabase Storage les sert). Range ignoré (200) : le corps est parcouru EN FLUX jusqu'à
// la fenêtre demandée — seule la fenêtre est gardée en mémoire (repli plus lent, jamais tout le fichier chargé).
export function lecteurUrl(url: string, timeoutMs = 15000): LecteurPlage {
  return async (debut, fin) => {
    let r: Response
    try { r = await fetch(url, { headers: { Range: `bytes=${debut}-${fin}` }, signal: AbortSignal.timeout(timeoutMs) }) } catch { return null }
    const voulu = fin - debut + 1
    if (r.status === 206) {
      const m = (r.headers.get('content-range') || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
      if (!m || Number(m[1]) !== debut) { try { await r.body?.cancel() } catch { /* */ } return null }
      const octets = await lireFenetre(r, 0, voulu)
      return octets ? { octets, total: Number(m[3]) } : null
    }
    if (r.status === 200) {
      const total = Number(r.headers.get('content-length') || 0)
      if (!(total > debut)) { try { await r.body?.cancel() } catch { /* */ } return null }
      const octets = await lireFenetre(r, debut, Math.min(voulu, total - debut))
      return octets ? { octets, total } : null
    }
    try { await r.body?.cancel() } catch { /* */ }
    return null
  }
}

// Parcourt les boîtes de premier niveau SANS lire `mdat` : tête (256 Kio), puis fenêtres de 64 Kio aux en-têtes suivants ;
// `moov` (et les `moof`) lus en entier. moov en tête ou en fin de fichier : même chemin, 1 à 3 lectures en pratique.
export async function dureeMp4(lire: LecteurPlage): Promise<number | null> {
  const t0 = await lire(0, TETE - 1)
  if (!t0 || !(t0.total > 0) || !t0.octets.length) return null
  const total = t0.total
  const blocs: { debut: number; octets: Uint8Array }[] = [{ debut: 0, octets: t0.octets }]
  let lectures = 1
  const plage = async (a: number, n: number): Promise<Uint8Array | null> => {
    for (const bl of blocs) if (a >= bl.debut && a + n <= bl.debut + bl.octets.length) return bl.octets.subarray(a - bl.debut, a - bl.debut + n)
    if (++lectures > LECTURES_MAX) return null
    const fin = Math.min(total, a + Math.max(n, FENETRE))
    const r = await lire(a, fin - 1)
    if (!r || r.total !== total || r.octets.length < n) return null
    blocs.push({ debut: a, octets: r.octets })
    if (blocs.length > 3) blocs.splice(1, 1)   // la tête + les deux dernières fenêtres
    return r.octets.subarray(0, n)
  }
  let off = 0, nb = 0, lus = 0, moov: Uint8Array | null = null
  const frags: Uint8Array[] = []
  // Octets qui ne forment plus une boîte APRÈS le moov d'un MP4 NON fragmenté (bourrage de fin de certains enregistreurs) :
  // ignorés. Avant le moov, ou dans un MP4 fragmenté (des fragments pourraient s'y cacher) : illisible.
  const finTolerable = () => !!moov && !frags.length && lireMoov(moov)?.fragmente === false
  while (off + 8 <= total) {
    if (++nb > BOITES_MAX) return null
    const h = await plage(off, Math.min(16, total - off)); if (!h) return null
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength)
    let size = dv.getUint32(0), hdr = 8
    const type = txt(h, 4)
    if (!/^[\x20-\x7e]{4}$/.test(type)) { if (finTolerable()) break; return null }   // pas une boîte : pas un MP4 / MOV (WebM, audio…)
    if (size === 1) {
      if (h.length < 16) return null
      const big = dv.getBigUint64(8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
      size = Number(big); hdr = 16
    } else if (size === 0) size = total - off
    if (size < hdr || off + size > total) { if (finTolerable()) break; return null }
    if (type === 'moov' || type === 'moof') {
      if (size > (type === 'moov' ? MOOV_MAX : MOOF_MAX) || (lus += size) > OCTETS_MAX) return null
      const box = await plage(off, size); if (!box) return null
      if (type === 'moov') { if (moov) return null; moov = box.slice() }   // deux moov = ambigu → illisible
      else { frags.push(box.slice()); if (frags.length > FRAGS_MAX) return null }
    } else if (SENSIBLES.has(type)) return null   // audit 02/10 : trak, stts… au premier niveau (voir SAUTABLES)
    else if (!SAUTABLES.has(type)) {
      // udta, meta, boîte inconnue (quelques Kio dans un vrai fichier) : lue et inspectée, ≤ 4 Mio
      if (size > MOOF_MAX || (lus += size) > OCTETS_MAX) return null
      const box = await plage(off, size); if (!box || hautSuspect(type, box, hdr, size)) return null
    }
    off += size
  }
  if (!moov) return null
  const info = lireMoov(moov); if (!info) return null
  const acc: AccFrag = new Map()
  for (const f of frags) if (!lireMoof(f, info, acc)) return null
  return dureeDepuis(info, acc)
}
export const dureeMp4Url = (url: string): Promise<number | null> => dureeMp4(lecteurUrl(url))

// ── Facturation à la seconde des vidéos fal (fal-proxy) ─────────────────────────────────────────────────────────────────
// Tarifs = CREDIT_COSTS de l'app, à changer ENSEMBLE : Motion 2.6 standard 2 cr/s (_mcPreRate), repli modération 3.0 → 2.6
// pro 4 cr/s (_v26Rate), Motion 3.0 = motion30PerSec 6 ; Omni édition 720p = omniEditPerSec 3, 1080p = omniEdit1080PerSec 4.
// (Le 1080p de Motion 2.6 = Topaz, débité à part sur son op « motion-topaz » : hors de ce calcul.)
// Durée max : Kling 30 s (doc fal ; l'app coupe à 30 s), Omni 10 s (l'app refuse au-delà de 10,5 s).
export const TOLERANCE_S = 1   // en faveur du client : écarts de mesure navigateur ↔ conteneur, priming AAC, remux
// + gigue de ré-encodage (ffmpeg.wasm de _mcNormalizeRef : HEVC → H.264 + AAC, quelques centièmes de plus que la durée lue
// par le navigateur) et piste son un peu plus longue que l'image (le navigateur affiche parfois la seule piste vidéo).
export const GIGUE_S = 0.25
// Audit 04/10 (OMNI-S2) : l'Omni édition envoie le fichier ORIGINAL (aucun ré-encodage, contrairement à Motion) et le parseur
// colle à la durée que lit le navigateur (écart ≤ 45 ms sur 36 fichiers iPhone et exports MP4 relus le 04/10 ; Android non
// testé) : 1,25 s de marge laissait le MINIMUM D'ENTRÉE 1 à 2 s sous le prix de l'app. 0,5 s pour Omni, 1,25 s pour Kling.
// La réconciliation de SORTIE garde 1,25 s pour tous : le minimum d'entrée est déjà le prix de l'app, et une sortie Omni un
// peu plus longue que le fichier envoyé ne doit pas faire payer (ni retenir) un client honnête.
export const TOLERANCE_OMNI_S = 0.5
export const OMNI_MAX_SEC = 10
// Étapes ANNEXES que l'app paie sur la MÊME op juste avant Kling (Motion « Glisse un fond », ouvert à tous) : effacement de
// la personne du fond par gpt-image medium (3 crédits, openai-proxy, x-aa-op = l'op motion) + détourage birefnet / rembg
// (1 crédit par modèle resté tiré, 3 au plus). Le prix Motion de l'app = tarif × durée, ces étapes COMPRISES : la réserve
// restante devant Kling peut donc valoir jusqu'à 6 de moins que le tarif × durée. Le minimum exigé sur la réserve baisse
// d'AUTANT que l'op a réellement déjà payé (montant − réserve restante), plafonné à 6 : l'op entière couvre toujours la
// vidéo au minimum serveur, et une op sans étape annexe n'a aucune remise.
export const ANNEXES_MAX_CR = 6
export function minimumSurReserve(cout: number, dejaTire: number): number {
  const d = Number.isFinite(dejaTire) && dejaTire > 0 ? Math.min(Math.floor(dejaTire), ANNEXES_MAX_CR) : 0
  return Math.max(1, Math.ceil(cout) - d)
}
export type TarifVideo = { parSec: number; maxSec: number; modele: 'kling' | 'omni-edit'; tol: number }
export function tarifVideoFal(path: string, resolution?: unknown): TarifVideo | null {
  const p = path.split('?')[0]
  const k = p.match(/^\/fal-ai\/kling-video\/(v2\.6|v3)\/(standard|pro)\/motion-control$/i)
  if (k) return { parSec: k[1].toLowerCase() === 'v3' ? 6 : (k[2].toLowerCase() === 'pro' ? 4 : 2), maxSec: 30, modele: 'kling', tol: TOLERANCE_S + GIGUE_S }
  if (/^\/google\/gemini-omni-flash\/v1\.1\/edit$/i.test(p)) return { parSec: resolution === '1080p' ? 4 : 3, maxSec: OMNI_MAX_SEC, modele: 'omni-edit', tol: TOLERANCE_OMNI_S }
  return null
}
// App : ⌈durée⌉ × tarif (Omni : ⌈durée⌉ ; Motion : ⌈durée effective⌉ bornée à 30). Serveur : ⌈min(durée mesurée, durée max
// du modèle) − 1 s − gigue⌉, au moins 1 s → toujours ≤ ce que l'app a débité pour le même fichier ; les étapes annexes tirées
// sur la même op (fond effacé + détourage) sont retirées ensuite du minimum par minimumSurReserve (tests p1).
// La durée est bornée AVANT la tolérance : une vidéo de 30,1 s que l'app facture 30 s (elle ne coupe qu'au-delà de 30,5 s)
// exige 29 s, comme une vidéo de 30 s. Audit 04/10 (OMNI-S2) : `tol` = marge du modèle (Omni 0,5 s, défaut 1,25 s).
export function secondesFacturees(sec: number, maxSec: number, tol: number = TOLERANCE_S + GIGUE_S): number {
  return Math.max(1, Math.ceil(Math.min(r3(sec), maxSec) - tol))
}
// Au-delà de la durée max + la marge de l'app (0,5 s) + la tolérance : le fournisseur refuserait (Kling 422) ou facturerait
// plus que la réserve → refus clair AVANT tout tirage.
export const tropLongue = (sec: number, maxSec: number): boolean => r3(sec) > maxSec + 0.5 + TOLERANCE_S

// Fichier de NOTRE stockage dans le dossier de l'appelant : URL signée / publique / authentifiée du bucket `bucket` de NOTRE
// projet (`base` = SUPABASE_URL). Renvoie le chemin dans le bucket, sinon null. Chemin = caractères sûrs seulement (aucun %,
// donc aucun segment encodé), 1er segment = uid exact, jamais « . » / « .. » / segment vide. Les chemins de l'app sont
// `<uid>/omni-<ms>-<a>.mp4`, `<uid>/mc-<ms>-<a>.mp4|.jpg`, `<uid>/mc-<ms>-<a>-comp.jpg`.
export function cheminClient(u: unknown, uid: string, base: string, bucket: string): string | null {
  const s = String(u ?? '')
  if (!base || !uid || s.length > 4096) return null
  const pre = `${base}/storage/v1/object/`
  if (!s.startsWith(pre)) return null
  const m = s.slice(pre.length).match(/^(sign|public|authenticated)\/([^/?#]+)\/([^?#]+)(?:\?[^#]*)?$/)
  if (!m || m[2] !== bucket) return null
  const p = m[3]
  if (!/^[A-Za-z0-9._\/-]+$/.test(p)) return null
  const seg = p.split('/')
  if (seg.length < 2 || seg[0] !== uid || seg.some((x) => !x || x === '.' || x === '..')) return null
  return p
}

// ── Préparation d'une soumission fal facturée à la seconde (Motion Control / Omni édition) ─────────────────────────────
export const FAL_IN_DIR = 'fal-in'          // copies servies à fal (hors de tout dossier utilisateur)
export const FAL_IN_TTL_S = 3600            // = durée du lien signé que l'app donnait déjà à fal
export type StockageFal = {
  copy(from: string, to: string): Promise<{ error: unknown }>
  createSignedUrl(path: string, ttl: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>
  remove(paths: string[]): Promise<unknown>
  list(dir: string, opts: { limit: number }): Promise<{ data: { name: string }[] | null; error: unknown }>
}
export type VideoFal = { ok: true; body: string; cost: number; mesureSec: number; factureSec: number; copie: string } | { ok: false; status: number; error: string }

const str = (v: unknown, max: number) => String(v ?? '').slice(0, max)

// Audit 04/10 (OMNI-R1) : conteneur reconnu à son en-tête quand la durée est illisible — un WebM / MKV (EBML) ou un AVI
// n'est pas un fichier abîmé mais un format que la mesure ne lit pas : le dire au client (l'app n'accepte plus que MP4 / MOV,
// un ancien onglet ou un fichier renommé peut encore en envoyer). null = format non identifié (message générique).
export function formatNonIso(tete: Uint8Array | null): string | null {
  if (!tete || tete.length < 12) return null
  if (tete[0] === 0x1a && tete[1] === 0x45 && tete[2] === 0xdf && tete[3] === 0xa3) return 'WebM / MKV'
  if (txt(tete, 0) === 'RIFF' && txt(tete, 8) === 'AVI ') return 'AVI'
  if (tete[0] === 0x46 && tete[1] === 0x4c && tete[2] === 0x56 && tete[3] === 0x01) return 'FLV'
  return null
}
const sonderTete = async (url: string): Promise<Uint8Array | null> => (await lecteurUrl(url, 8000)(0, 15))?.octets ?? null

export async function preparerVideoFal(o: {
  path: string; raw: string; uid: string; base: string; bucket: string; st: StockageFal
  mesurer?: (url: string) => Promise<number | null>; maintenant?: number; sonder?: (url: string) => Promise<Uint8Array | null>
}): Promise<VideoFal> {
  let b: Record<string, unknown> | null = null
  try { b = JSON.parse(o.raw || '{}') } catch { /* traité juste dessous */ }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, status: 400, error: 'corps JSON invalide' }
  const tarif = tarifVideoFal(o.path, b.resolution)
  if (!tarif) return { ok: false, status: 400, error: 'modèle non facturé à la seconde' }
  const src = cheminClient(b.video_url, o.uid, o.base, o.bucket)
  if (!src) return { ok: false, status: 400, error: 'video_url : vidéo de ton espace de stockage uniquement — relance la génération depuis l’app' }
  const prompt = typeof b.prompt === 'string' ? b.prompt : ''
  // Corps RECONSTRUIT (champs de l'app seulement) : aucun paramètre client ne peut changer ce que fal facture.
  let corps: Record<string, unknown>
  if (tarif.modele === 'kling') {
    const img = cheminClient(b.image_url, o.uid, o.base, o.bucket) ? String(b.image_url) : null
    if (!img) return { ok: false, status: 400, error: 'image_url : image de ton espace de stockage uniquement' }
    if (!prompt) return { ok: false, status: 400, error: 'prompt requis' }
    corps = { image_url: img, character_orientation: b.character_orientation === 'image' ? 'image' : 'video', prompt: str(prompt, 2500) }
    if (typeof b.keep_original_sound === 'boolean') corps.keep_original_sound = b.keep_original_sound
    // Kling 3.0 : liaison d'identité faciale (1 élément, images de l'appelant seulement) ; ignorée en 2.6 (l'app ne l'y envoie pas)
    if (b.elements !== undefined && /\/v3\//i.test(o.path)) {
      const el = Array.isArray(b.elements) ? b.elements : null
      const e0 = el && el.length === 1 && el[0] && typeof el[0] === 'object' ? el[0] as Record<string, unknown> : null
      const refs = e0 && Array.isArray(e0.reference_image_urls) ? e0.reference_image_urls as unknown[] : null
      const ok = (u: unknown) => !!cheminClient(u, o.uid, o.base, o.bucket)
      if (!e0 || !ok(e0.frontal_image_url) || !refs || !refs.length || refs.length > 4 || !refs.every(ok)) return { ok: false, status: 400, error: 'elements : images de ton espace de stockage uniquement' }
      corps.elements = [{ frontal_image_url: String(e0.frontal_image_url), reference_image_urls: refs.map(String) }]
    }
  } else {
    if (!prompt) return { ok: false, status: 400, error: 'prompt requis' }
    corps = { prompt: str(prompt, 20000), resolution: b.resolution === '1080p' ? '1080p' : '720p' }
  }
  // Copie serveur (même bucket, hors du dossier du client) → c'est ELLE qui est mesurée et servie à fal.
  const ext = (src.match(/\.(mp4|mov|m4v)$/i)?.[1] || 'mp4').toLowerCase()
  const maintenant = o.maintenant ?? Date.now()
  const copie = `${FAL_IN_DIR}/${o.uid}/${maintenant}-${crypto.randomUUID()}.${ext}`
  let cp: { error: unknown }
  try { cp = await o.st.copy(src, copie) } catch (e) { cp = { error: e } }
  if (cp.error) {
    const e = cp.error as { message?: string; statusCode?: string | number; status?: number }
    const absent = /not.?found|404|no such/i.test(`${e?.statusCode ?? ''} ${e?.status ?? ''} ${e?.message ?? ''}`)
    return absent
      ? { ok: false, status: 400, error: 'vidéo introuvable (lien expiré ou fichier absent) — relance la génération' }
      : { ok: false, status: 503, error: 'préparation de la vidéo impossible — réessaie dans un instant' }
  }
  const jeter = async () => { try { await o.st.remove([copie]) } catch { /* best-effort */ } }
  let signed = ''
  try { const sg = await o.st.createSignedUrl(copie, FAL_IN_TTL_S); signed = (!sg.error && sg.data?.signedUrl) || '' } catch { signed = '' }
  const signPre = `${o.base}/storage/v1/object/sign/${o.bucket}/`
  if (!signed.includes(`/object/sign/${o.bucket}/${copie}`)) { await jeter(); return { ok: false, status: 503, error: 'préparation de la vidéo impossible — réessaie dans un instant' } }
  // createSignedUrl renvoie une URL absolue (ou relative selon la version du client) : ramenée à NOTRE préfixe signé.
  const url = signed.startsWith(signPre) ? signed : signPre + signed.slice(signed.indexOf(copie))
  const mesureSec = await (o.mesurer ?? dureeMp4Url)(url).catch(() => null)
  if (!(mesureSec && mesureSec > 0)) {
    const fmt = formatNonIso(await (o.sonder ?? sonderTete)(url).catch(() => null))   // Audit 04/10 (OMNI-R1), avant la suppression
    await jeter()
    return { ok: false, status: 400, error: fmt ? `vidéo au format ${fmt} : non prise en charge — réexporte-la en MP4 (H.264) ou en MOV et réessaie` : 'vidéo illisible : durée introuvable — réexporte-la en MP4 (H.264) et réessaie' }
  }
  if (tropLongue(mesureSec, tarif.maxSec)) { await jeter(); return { ok: false, status: 400, error: `vidéo trop longue (${Math.round(mesureSec)} s) : ${tarif.maxSec} secondes maximum` } }
  const factureSec = secondesFacturees(mesureSec, tarif.maxSec, tarif.tol)   // Audit 04/10 (OMNI-S2) : marge du modèle
  corps.video_url = url
  return { ok: true, body: JSON.stringify(corps), cost: tarif.parSec * factureSec, mesureSec, factureSec, copie }
}

// Copies devenues inutiles (lien signé expiré depuis 15 min : fal ne peut plus les lire) de CET utilisateur — appelé après
// chaque soumission réussie. Best-effort, jamais bloquant. (Une copie restée là est aussi supprimée à la soumission suivante.)
export async function nettoyerCopiesFal(st: StockageFal, uid: string, maintenant = Date.now()): Promise<number> {
  try {
    const { data, error } = await st.list(`${FAL_IN_DIR}/${uid}`, { limit: 100 })
    if (error || !data) return 0
    const limite = maintenant - (FAL_IN_TTL_S + 15 * 60) * 1000
    const vieux = data.map((x) => x.name).filter((n) => { const ms = Number((n.match(/^(\d{10,})-/) || [])[1]); return ms > 0 && ms < limite })
    if (vieux.length) await st.remove(vieux.map((n) => `${FAL_IN_DIR}/${uid}/${n}`))
    return vieux.length
  } catch { return 0 }
}
