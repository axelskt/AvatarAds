// lipsync-audio.mjs — l'audio qu'on ENVOIE au modèle de lipsync (Hedra Avatar / Character-3 / Omni via Hedra).
//
// Le défaut mesuré (enquête 25/09, clip CTA28) : un audio qui s'arrête NET sur le dernier phonème laisse le modèle
// sans « contexte droit » → il n'articule pas la dernière syllabe (le /m/ final de « toi-même » ne se ferme jamais,
// bouche entrouverte et figée jusqu'à la fin). Même symptôme sur Hedra Avatar et Character-3.
//
// Règles (Axel 26/09, « ok, lance le correctif ») :
//   · on ne modifie JAMAIS la brique ni la voix d'origine : on fabrique seulement l'audio envoyé au modèle ;
//   · la voix continue après la fenêtre → on prend la SUITE RÉELLE de la voix jusqu'à +0,6 s (contexte droit),
//     avec un fondu de 30 ms à la coupe ;
//   · c'est la fin de l'audio → on complète le silence de fin jusqu'à 0,5 s (jamais plus que nécessaire) ;
//   · la vidéo rendue se coupe ensuite à fin de parole + 0,3 s (Générateur, MCP) ou l'affichage s'arrête à la
//     matière réellement lipsynchronisée (Montage IA, `lipEnd`) ;
//   · la facturation client reste celle de la durée UTILE (fenêtre), jamais notre marge de sécurité.
//
// Module isolé (comme lipsync-cache.mjs) : importer worker.mjs démarre la boucle de jobs. Ici tout se teste seul.

import { execFileSync } from 'node:child_process'

const r3 = (n) => Math.round(n * 1000) / 1000

export const LIP = Object.freeze({
  CTX: 0.6,              // contexte droit : suite réelle de la voix envoyée après la fin de la fenêtre
  PAD: 0.5,              // silence garanti après le dernier mot quand c'est la fin de l'audio
  MIN: 3.3,              // Hedra refuse sous 3,24 s → on étire vers la droite (comme avant)
  FADE: 0.03,            // fondu de sortie quand on coupe en pleine voix
  COUPE: 0.3,            // coupe vidéo = fin de parole + 0,3 s (fourchette 0,2-0,35 s)
  FIN_TOL: 0.05,         // à moins de 50 ms de la fin du fichier = fin de l'audio
  DERNIER_MAX: 3,        // dernier panneau : on couvre jusqu'à 3 s de voix en plus, pas davantage
  POUSSEE: 0.45,         // le moteur joue le clip jusqu'à t1 + 0,45 s (poussée du panneau suivant)
})

// ── FIN DE PAROLE ────────────────────────────────────────────────────────────────
// Même mesure que _expSpeechEnd (app/index.html) : RMS par fenêtres de 50 ms, seuil RELATIF au pic (−25 dB,
// plancher −60 dBFS). Un clip anormalement faible (pic ≤ −40 dBFS) → null : on ne coupe jamais au jugé.
// `canaux` = tableau de Float32Array (un par canal) ou un seul Float32Array.
export function finDeParole(canaux, sr) {
  const ch = Array.isArray(canaux) ? canaux : [canaux]
  const n = ch.length ? ch[0].length : 0
  if (!n || !(sr > 0)) return null
  const W = Math.max(1, Math.round(sr * 0.05))
  const db = []
  for (let i = 0; i < n; i += W) {
    let sum = 0, c = 0
    const e = Math.min(n, i + W)
    for (const d of ch) for (let j = i; j < e; j++) { sum += d[j] * d[j]; c++ }
    db.push(20 * Math.log10(Math.sqrt(sum / Math.max(1, c)) + 1e-9))
  }
  let peak = -Infinity
  for (const v of db) if (v > peak) peak = v
  if (!(peak > -40)) return null
  const thr = Math.max(-60, peak - 25)
  for (let i = db.length - 1; i >= 0; i--) if (db[i] > thr) return { end: r3(Math.min(n / sr, (i + 1) * 0.05)), dur: r3(n / sr) }
  return null
}

// Décode la voix (n'importe quel conteneur que ffmpeg lit) en PCM mono 16 kHz → { dur, finParole }.
// Lecture seule : le fichier d'origine n'est jamais réécrit.
export function analyserVoix(chemin) {
  const SR = 16000
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', chemin, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1024 * 1024 * 1024 })
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
  const f = finDeParole(pcm, SR)
  return { dur: r3(pcm.length / SR), finParole: f ? f.end : null }
}

// ── LE PLAN DE L'AUDIO ENVOYÉ ────────────────────────────────────────────────────
// Fenêtre [start, end] (secondes, absolues dans la voix) d'une voix de durée `voixDur`.
//   finParole : fin de parole de la voix ENTIÈRE (silence déjà présent en fin de fichier), si connue ;
//   jusqua    : fin d'affichage à couvrir (dernier panneau du Montage) — bornée à end + 3 s.
// Renvoie :
//   from / to   bornes de VOIX réelle envoyées ; padSec = silence ajouté après ; fadeOut = fondu à la coupe ;
//   envoyeSec   durée totale envoyée au modèle ;
//   lipEnd      instant ABSOLU jusqu'où les lèvres suivent la voix (null = jusqu'à la fin : la voix s'arrête) ;
//   factureSec  durée facturée au client = durée UTILE (fenêtre, plancher Hedra) — jamais la marge.
export function planAudioLipsync({ start, end, voixDur, finParole = null, jusqua = null, min = LIP.MIN, ctx = LIP.CTX, pad = LIP.PAD } = {}) {
  const s = Math.max(0, Number(start) || 0)
  const e = Math.max(s, Number(end) || s)
  const D = Number(voixDur) > 0 ? Number(voixDur) : Infinity
  let cible = Math.max(s + min, e + ctx)
  if (jusqua != null && Number(jusqua) > cible) cible = Math.min(Number(jusqua), e + LIP.DERNIER_MAX)
  const to = Math.max(s, Math.min(D, cible))
  const finFichier = D - to <= LIP.FIN_TOL
  const voixSec = to - s
  // silence DÉJÀ présent après le dernier mot (seulement si la tranche va jusqu'au bout du fichier)
  const fp = finParole != null && Number.isFinite(Number(finParole)) ? Number(finParole) : null
  const silenceDeja = finFichier && fp != null ? Math.max(0, D - Math.max(fp, s)) : 0
  let padSec = finFichier ? Math.max(0, pad - silenceDeja) : 0
  if (voixSec + padSec < min) padSec = min - voixSec          // plancher Hedra : complété en silence
  padSec = r3(padSec)
  return {
    from: r3(s), to: r3(to), voixSec: r3(voixSec), padSec,
    fadeOut: finFichier ? 0 : LIP.FADE,
    envoyeSec: r3(voixSec + padSec),
    lipEnd: finFichier ? null : r3(to),
    factureSec: r3(Math.max(min, e - s)),
  }
}

// Arguments ffmpeg qui fabriquent l'audio envoyé (WAV PCM 16 bits mono 44,1 kHz — plus de MP3 : son retard
// d'encodeur décalait les lèvres d'environ 25 ms). `voix` n'est que LUE.
export function argsAudioLipsync(voix, plan, sortie) {
  const af = []
  if (plan.fadeOut > 0 && plan.voixSec > plan.fadeOut) af.push(`afade=t=out:st=${r3(plan.voixSec - plan.fadeOut)}:d=${plan.fadeOut}`)
  if (plan.padSec > 0) af.push(`apad=pad_dur=${plan.padSec}`)
  return ['-v', 'error', '-y', '-ss', String(plan.from), '-t', String(plan.voixSec), '-i', voix, '-vn', '-ac', '1', '-ar', '44100',
    ...(af.length ? ['-af', af.join(',')] : []), '-c:a', 'pcm_s16le', sortie]
}

// Fabrique l'audio d'une fenêtre (fichier `sortie`) → { buf, plan }.
export function fabriquerAudioLipsync(voix, fenetre, voixInfo, sortie, opts = {}) {
  const plan = planAudioLipsync({ start: fenetre.start, end: fenetre.end, voixDur: voixInfo && voixInfo.dur, finParole: voixInfo && voixInfo.finParole, ...opts })
  execFileSync('ffmpeg', argsAudioLipsync(voix, plan, sortie))
  return { plan }
}

// ── COUPE DE LA VIDÉO RENDUE ─────────────────────────────────────────────────────
// Fin de parole (dans la timeline de la vidéo) + 0,3 s ; null si rien d'utile à couper (moins de 0,1 s gagné)
// ou si la mesure est suspecte (moins d'1 s de parole).
export function pointDeCoupe(finParole, dureeVideo, marge = LIP.COUPE) {
  const f = Number(finParole), d = Number(dureeVideo)
  if (!(f > 1) || !(d > 0)) return null
  const c = r3(Math.min(d, f + Math.max(0.2, Math.min(0.35, marge))))
  return d - c >= 0.1 ? c : null
}

// ── TRANCHES DES FENÊTRES LONGUES (> 17 s) ALIGNÉES SUR LES SILENCES ─────────────
// Avant : tranches égales → la borne tombait au milieu d'un mot (fin de tranche non articulée, début de la
// suivante amputé). Chaque borne cherche, à ±1,5 s du pas régulier, le PLUS GRAND blanc entre deux mots
// (égalité → le plus proche du pas) ; sans mot sous la main, le pas régulier (comportement d'avant).
export function bornesTranches(start, end, mots = [], max = 15, rayon = 1.5) {
  const s = Number(start) || 0, e = Number(end) || s
  const d = e - s
  if (d <= max + 2) return [{ start: s, end: e }]
  const n = Math.ceil(d / max)
  const pas = d / n
  const ws = (mots || []).map((w) => ({ start: Number(w.start), end: Number(w.end) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start)
  const out = []
  let prev = s
  for (let i = 1; i < n; i++) {
    const cible = s + i * pas
    let best = null
    for (let k = 0; k + 1 < ws.length; k++) {
      const a = ws[k].end, b = Math.max(a, ws[k + 1].start)
      const m = (a + b) / 2
      if (m < cible - rayon || m > cible + rayon) continue
      if (m - prev < LIP.MIN || e - m < LIP.MIN) continue
      const gap = b - a, dist = Math.abs(m - cible)
      if (!best || gap > best.gap + 1e-6 || (Math.abs(gap - best.gap) <= 1e-6 && dist < best.dist)) best = { t: m, gap, dist }
    }
    const b = r3(best ? best.t : cible)
    out.push({ start: r3(prev), end: b })
    prev = b
  }
  out.push({ start: r3(prev), end: r3(e) })
  return out
}
