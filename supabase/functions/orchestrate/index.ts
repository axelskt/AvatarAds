// Supabase Edge Function — 🎼 Chef d'orchestre (#108, partie 2)
// L'audio de la vidéo dirige le montage : transcription mot-à-mot (ElevenLabs
// Scribe) + alignement forcé sur le script exact (si fourni) → Claude analyse
// le transcript + les images utilisateur (vision) → émet un PLAN DE MONTAGE
// JSON strict (sections, zooms punch, b-roll placé, SFX, hook, sous-titres, scènes avatar).
//
// Auth : JWT utilisateur (verify_jwt au gateway). Les crédits sont débités
// côté client AVANT l'appel via spendCreditsFor (RPC anti-triche), comme pour
// les autres proxys.
//
// Entrée (multipart/form-data) :
//   audio     : fichier audio (wav/mp3/m4a, ≤ 20 Mo) — la voix de la vidéo
//   duration  : durée de la timeline en secondes
//   script    : (optionnel) texte exact du script → sous-titres parfaits
//   assets    : (optionnel) JSON [{ id, name, kind:'image'|'video' }] des b-roll (#111 : les clips video JOUENT dans la carte)
//   asset_<id>: (optionnel) miniature JPEG de chaque asset (≤ 400 Ko)
//   options   : (optionnel) JSON { lang }
//   website   : (optionnel) URL du site de l'utilisateur → contexte produit pour les slides
//   brief     : (optionnel) ce que l'utilisateur veut mettre en avant (≠ script : c'est une INTENTION, pas le texte parlé)
//
// #124 — MÉMOIRE DE MARQUE : la fiche de l'utilisateur (business, produit,
// fonctionnalités, chiffres, réseaux, ton, CTA) est lue en base avec SON jeton
// et injectée dans le prompt. Il ne retape plus son contexte à chaque vidéo, et
// le cache de son site évite de re-crawler à chaque montage.
//
// #125 — REGISTRE SONORE : le plan porte un `tone` (fun / neutre). Les bruitages
// comiques et les lits musicaux ne survivent à la validation que si tone === 'fun'.
//
// Sortie : { ok, plan, transcript, model, usage }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Sonnet 5 plutot qu'Opus : le chef d'orchestre ne fait plus le gros du travail —
// le placement dense, la cadence, les bruitages et les verrous sont deterministes
// cote serveur. Ce qui lui reste (decouper les sections, reperer les moments forts)
// ne justifie pas le tarif d'Opus. A rebasculer si la qualite des plans chute.
const CLAUDE_MODEL = 'claude-sonnet-5'
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const MAX_ASSETS = 8
const MAX_THUMB_BYTES = 400 * 1024
const MAX_DURATION = 180

// ---------- alignement forcé (même algo que tools/chef-orchestre/orchestrate.mjs) ----------
type Word = { text: string; start: number; end: number }

const norm = (w: string) =>
  w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

function lev(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}
const sim = (a: string, b: string) => (!a.length && !b.length ? 1 : 1 - lev(a, b) / Math.max(a.length, b.length))

// Needleman-Wunsch : mots du script (texte exact) ↔ mots transcrits (timing réel)
function alignScript(script: string, tWords: Word[], duration: number): Word[] {
  const sWords = script.split(/\s+/).map((w) => w.trim()).filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => ({ text: w, key: norm(w) })).filter((w) => w.key.length > 0)
  const t = tWords.map((w) => ({ ...w, key: norm(w.text) })).filter((w) => w.key.length > 0)
  if (!sWords.length || !t.length) return tWords
  const GAP = -0.45
  const S = sWords.length, T = t.length
  const dp: Float64Array[] = Array.from({ length: S + 1 }, () => new Float64Array(T + 1))
  const bt: Uint8Array[] = Array.from({ length: S + 1 }, () => new Uint8Array(T + 1))
  for (let i = 1; i <= S; i++) { dp[i][0] = i * GAP; bt[i][0] = 2 }
  for (let j = 1; j <= T; j++) { dp[0][j] = j * GAP; bt[0][j] = 3 }
  for (let i = 1; i <= S; i++) {
    for (let j = 1; j <= T; j++) {
      const match = dp[i - 1][j - 1] + (sim(sWords[i - 1].key, t[j - 1].key) * 2 - 1)
      const up = dp[i - 1][j] + GAP
      const left = dp[i][j - 1] + GAP
      if (match >= up && match >= left) { dp[i][j] = match; bt[i][j] = 1 }
      else if (up >= left) { dp[i][j] = up; bt[i][j] = 2 }
      else { dp[i][j] = left; bt[i][j] = 3 }
    }
  }
  const out: (Word & { matched: boolean })[] = sWords.map((w) => ({ text: w.text, start: -1, end: -1, matched: false }))
  let i = S, j = T
  while (i > 0 || j > 0) {
    const move = bt[i][j]
    if (move === 1) { out[i - 1].start = t[j - 1].start; out[i - 1].end = t[j - 1].end; out[i - 1].matched = true; i--; j-- }
    else if (move === 2) i--
    else j--
  }
  // interpolation des mots non appariés, proportionnelle à leur longueur
  for (let a = 0; a < out.length; a++) {
    if (out[a].matched) continue
    let lo = a - 1; while (lo >= 0 && !out[lo].matched) lo--
    let hi = a + 1; while (hi < out.length && !out[hi].matched) hi++
    const t0 = lo >= 0 ? out[lo].end : 0
    const t1 = hi < out.length ? out[hi].start : duration
    const span = out.slice(lo + 1, hi)
    const totalChars = span.reduce((s, w) => s + w.text.length, 0) || 1
    let cursor = t0
    for (const w of span) {
      const d = Math.max(0, t1 - t0) * (w.text.length / totalChars)
      w.start = cursor; w.end = cursor + d; cursor += d
    }
  }
  for (let a = 0; a < out.length; a++) {
    if (a > 0) out[a].start = Math.max(out[a].start, out[a - 1].end)
    out[a].end = Math.max(out[a].end, out[a].start + 0.14)
  }
  return out
}

// ---------- transcription ElevenLabs Scribe ----------
async function transcribe(audio: File, lang: string | null): Promise<{ text: string; words: Word[]; hasMusic: boolean }> {
  const elKey = Deno.env.get('ELEVENLABS_API_KEY') ?? ''
  if (!elKey) throw new Error('ELEVENLABS_API_KEY manquante')
  const fd = new FormData()
  fd.append('file', audio, audio.name || 'audio.wav')
  fd.append('model_id', 'scribe_v1')
  fd.append('timestamps_granularity', 'word')
  fd.append('tag_audio_events', 'true')
  fd.append('diarize', 'false')
  if (lang) fd.append('language_code', lang)
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': elKey },
    body: fd,
  })
  if (!res.ok) throw new Error(`Scribe ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const words: Word[] = (data.words || [])
    .filter((w: { type?: string }) => !w.type || w.type === 'word')
    .map((w: { text: string; start: number; end: number }) => ({
      text: String(w.text || '').trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    }))
    .filter((w: Word) => w.text.length > 0)
  // musique de fond déjà présente ? (events Scribe type audio_event, ex: "(music)")
  const hasMusic = (data.words || []).some((w: { type?: string; text?: string }) =>
    w.type === 'audio_event' && /music|musique/i.test(String(w.text || '')))
  return { text: String(data.text || ''), words, hasMusic }
}

// ---------- schéma JSON strict du plan (sortie Claude garantie valide) ----------
// Deux sons retires de la banque du Montage IA (ils restent dans l'Editeur manuel,
// ou l'utilisateur les place lui-meme en connaissance de cause) :
//   'flash' — pose sur « plus de cinquante scripts », il sonnait comme une erreur ;
//   'riser' — le fichier dure DIX SECONDES. Pose sur « cloner ta voix », il couvrait
//             tout le reste de la video. Un bruitage de ponctuation souligne un
//             instant ; au-dela de ~2,5 s ce n'est plus un accent, c'est un tapis.
const SFX_KINDS = ['whoosh', 'pop', 'ding', 'boom', 'click', 'success', 'magic', 'hit', 'snap', 'hu', 'bip', 'fahh', 'robot']
// #125 · REGISTRE FUN : ces sons-la ne vont QUE sur un contenu qui assume l'humour.
// Sur une video serieuse ils sonnent amateur et tuent la credibilite -> ils sont
// SUPPRIMES DU PLAN cote serveur quand tone !== 'fun' (verrou, pas simple consigne).
const SFX_FUN = ['hu', 'bip', 'fahh', 'robot']
// #135 · EMOJIS 3D (Fluent Emoji, licence MIT). Vocabulaire UNIVERSEL : contrairement
// aux animations maison — taillees pour AvatarAds — il illustre n'importe quel script.
// Sur un audio d'une autre marque, les animations ne couvraient que 11 % de la duree.
const EMOJIS = ['airplane', 'alarm_clock', 'bank', 'bar_chart', 'battery', 'beach_with_umbrella', 'bell', 'bookmark_tabs', 'books', 'brain', 'bullseye', 'bust_in_silhouette', 'busts_in_silhouette', 'calendar', 'camera', 'chart_decreasing', 'chart_increasing', 'check_mark_button', 'clapper_board', 'coin', 'credit_card', 'cross_mark', 'crown', 'crystal_ball', 'desktop_computer', 'direct_hit', 'dollar_banknote', 'envelope', 'eyes', 'fire', 'floppy_disk', 'gear', 'gift', 'glowing_star', 'growing_heart', 'hammer_and_wrench', 'handshake', 'headphone', 'high_voltage', 'hourglass_done', 'hundred_points', 'key', 'laptop', 'light_bulb', 'link', 'locked', 'loudspeaker', 'magic_wand', 'magnifying_glass_tilted_left', 'megaphone', 'memo', 'microphone', 'mobile_phone', 'money_bag', 'money_with_wings', 'movie_camera', 'musical_note', 'open_book', 'package', 'party_popper', 'puzzle_piece', 'question_mark', 'rainbow', 'recycling_symbol', 'red_exclamation_mark', 'red_heart', 'robot', 'rocket', 'scissors', 'shopping_cart', 'sparkles', 'speaker_high_volume', 'speech_balloon', 'spiral_calendar', 'star', 'stopwatch', 'studio_microphone', 'thinking_face', 'trophy', 'unlocked', 'video_camera', 'warning', 'wrench']
const BED_NAMES = ['grave', 'tension', 'montee']
const SECTION_ROLES = ['hook', 'benefice', 'preuve', 'cta', 'outro']
const MOODS = ['intense', 'dynamique', 'chill']
// Captures d'AvatarAds et zones MESUREES sur la page elle-meme (script
// render-worker/recapture.cjs), pas estimees a l'oeil sur l'image. Les captures
// sont prises dans l'etat qu'Axel a valide : champs VIDES et « Photo Reel » +
// 9:16 selectionnes. Le chef d'orchestre ne connait que les NOMS — les
// coordonnees ne sortent jamais du serveur, un cadrage invente est impossible.
const TUTO: Record<string, Record<string, number[]>> = {
  'images-ia': { 'menu': [0.288, 0.117, 0.209, 0.059], 'photo-reel': [0.240, 0.311, 0.089, 0.087], 'pixar': [0.336, 0.311, 0.089, 0.087], 'fruit': [0.240, 0.409, 0.089, 0.087], 'ugc': [0.336, 0.409, 0.089, 0.087], 'format': [0.288, 0.666, 0.057, 0.078], 'prompt': [0.749, 0.818, 0.472, 0.121], 'generer': [0.896, 0.923, 0.177, 0.062] },
  'express': { 'menu': [0.290, 0.133, 0.210, 0.084], 'realiste': [0.242, 0.272, 0.091, 0.071], 'cartoon': [0.338, 0.272, 0.091, 0.071], 'portrait': [0.242, 0.501, 0.091, 0.065], 'duree': [0.290, 0.620, 0.210, 0.075], 'qualite': [0.290, 0.743, 0.210, 0.122], 'voix': [0.290, 0.918, 0.187, 0.067], 'ajouter': [0.501, 0.786, 0.146, 0.217], 'prompt': [0.786, 0.759, 0.394, 0.151], 'generer': [0.886, 0.936, 0.189, 0.076] },
}
const TUTO_FILE: Record<string, string> = { 'images-ia': '01-imagesia', 'express': '02-express' }

const ANIMS = ['split', 'voice', 'list', 'grow', 'compare', 'type', 'phone', 'clock', 'avatar', 'logo', 'faceless', 'money', 'idea', 'target', 'lock', 'search', 'rocket', 'network', 'check',
  'swipe', 'views', 'engage', 'calendar', 'upload', 'stack', 'swap', 'cut', 'steps', 'toggle',
  // ces six-la existaient dans la banque de rendu mais manquaient ICI : le
  // filtre serveur les rejetait, donc le modele ne pouvait jamais les utiliser.
  'flow', 'funnel', 'orbit', 'bars2', 'wallet', 'countup']
const SLIDE_TYPES = ['flow', 'checklist', 'compare', 'stat', 'card', 'nodes', 'loop', 'bars', 'kpi', 'timer', 'versus', 'punch', 'banner']

// ⚠️ AUCUN enum dans PLAN_SCHEMA. Le mode strict d'Anthropic compile le schema en
// grammaire ; chaque enum multiplie les branches et au-dela d'un seuil l'API refuse
// tout appel avec « The compiled grammar is too large » — c'est ce qui a mis le
// Montage IA a l'arret. Les valeurs permises sont donc annoncees dans le PROMPT et
// verifiees ICI, cote serveur. Le filtre serveur est de toute facon le seul verrou
// fiable : un enum de schema n'empeche pas un modele de renvoyer autre chose.
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections', 'zooms', 'broll', 'beats', 'tuto', 'sfx', 'hook', 'accents', 'music', 'slides', 'face', 'detected', 'avatarSegments', 'tone', 'beds'],
  properties: {
    // LIGNES COMPACTES "champ|champ|…" — le format exact est decrit dans le prompt
    // et re-etale en objets par expandPlan() juste apres la reponse.
    sections: { type: 'array', items: { type: 'string' } },        // "role|start|end|label"
    zooms: { type: 'array', items: { type: 'string' } },           // "t|dur|scale|cx|cy"
    broll: { type: 'array', items: { type: 'string' } },           // "assetId|start|end|fonctionnalite"
    beats: { type: 'array', items: { type: 'string' } },           // "mot|animation" — les mots forts
    tuto: { type: 'array', items: { type: 'string' } },            // "mot|ecran|zone" — démo dans l'app
    sfx: { type: 'array', items: { type: 'string' } },             // "kind|t"
    beds: { type: 'array', items: { type: 'string' } },            // "name|t"
    avatarSegments: { type: 'array', items: { type: 'string' } },  // "start|end|format"
    hook: { type: 'string' },                                      // "texte|start|end" ("" si aucun)
    accents: { type: 'array', items: { type: 'string' } },
    tone: { type: 'string' },
    music: { type: 'string' },                                     // "intense"|"dynamique"|"chill"|""
    face: { type: 'string' },                                      // "0.32" ou "" si aucun visage
    detected: { type: 'string' },                                  // "subtitles" si deja incrustes, "" sinon
    slides: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'layout', 'motif', 'anim', 'start', 'end', 'wide', 'title', 'meta', 'items'],
        properties: {
          type: { type: 'string' },
          layout: { type: 'string' },
          motif: { type: 'string' },
          anim: { type: 'string' },     // #135 · animation fabriquee — liste dans le prompt
          emoji: { type: 'string' },    // #135 · emoji 3D — liste dans le prompt
          start: { type: 'number' },
          end: { type: 'number' },
          wide: { type: 'boolean' },
          title: { type: 'string' },
          meta: { type: 'string' },                                // "eyebrow|accent|sub|center|value|unit"
          items: { type: 'array', items: { type: 'string' } },      // "texte|t|value|label"
        },
      },
    },
  },
}

// ---------- re-etalement des lignes compactes en objets ----------
// Le reste du fichier (validatePlan, la sortie) travaille sur la forme objet
// d'origine : tout se remet a plat ICI, juste apres la reponse du modele.
const cut = (v: unknown, n: number) => {
  const parts = String(v ?? '').split('|').map((x) => x.trim())
  while (parts.length < n) parts.push('')
  return parts.slice(0, n)
}
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

// deno-lint-ignore no-explicit-any
function expandPlan(raw: any): Plan {
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  const [hookText, hookStart, hookEnd] = cut(raw.hook, 3)
  return {
    sections: arr(raw.sections).map((l) => { const [role, a, b, label] = cut(l, 4); return { role, start: num(a), end: num(b), label } }),
    zooms: arr(raw.zooms).map((l) => { const [t, dur, scale, cx, cy] = cut(l, 5); return { t: num(t), dur: num(dur), scale: num(scale), cx: num(cx), cy: num(cy) } }),
    broll: arr(raw.broll).map((l) => { const [assetId, a, b, feature] = cut(l, 4); return { assetId, start: num(a), end: num(b), feature } }),
    beats: arr(raw.beats).map((l) => { const [word, anim] = cut(l, 2); return { word, anim } }),
    tuto: arr(raw.tuto).map((l) => { const [word, screen, zone, text] = cut(l, 4); return { word, screen, zone, text } }),
    sfx: arr(raw.sfx).map((l) => { const [kind, t] = cut(l, 2); return { kind, t: num(t) } }),
    beds: arr(raw.beds).map((l) => { const [name, t] = cut(l, 2); return { name, t: num(t) } }),
    avatarSegments: arr(raw.avatarSegments).map((l) => { const [a, b, format] = cut(l, 3); return { start: num(a), end: num(b), format } }),
    hook: hookText ? { text: hookText, start: num(hookStart), end: num(hookEnd) } : null,
    accents: arr(raw.accents).map((x) => String(x)),
    tone: String(raw.tone || ''),
    music: String(raw.music || '').trim() ? { mood: String(raw.music).trim() } : null,
    face: String(raw.face || '').trim() ? { cy: num(String(raw.face)) } : null,
    detected: { subtitles: /subtitle/i.test(String(raw.detected || '')) },
    slides: arr(raw.slides).map((sl) => {
      const [eyebrow, accent, sub, center, value, unit] = cut(sl?.meta, 6)
      return {
        type: String(sl?.type || ''), layout: String(sl?.layout || ''), motif: String(sl?.motif || ''),
        anim: String(sl?.anim || ''),
        emoji: String(sl?.emoji || ''),
        start: Number(sl?.start) || 0, end: Number(sl?.end) || 0, wide: !!sl?.wide,
        title: String(sl?.title || ''), eyebrow, accent, sub, center, value, unit,
        items: arr(sl?.items).map((l) => { const [text, t, v, label] = cut(l, 4); return { text, t: num(t), value: v, label } }),
      }
    }),
  }
}

type Plan = {
  sections: { role: string; start: number; end: number; label: string }[]
  zooms: { t: number; dur: number; scale: number; cx: number; cy: number; reason?: string }[]
  broll: { assetId: string; start: number; end: number; feature?: string; reason?: string }[]
  beats?: { word: string; anim: string }[]
  tuto?: { word: string; screen: string; zone: string; text?: string }[]
  sfx: { kind: string; t: number }[]
  hook: { text: string; start: number; end: number } | null
  accents: string[]
  tone?: string
  beds?: { name: string; t: number; reason?: string }[]
  music: { mood: string } | null
  slides: {
    type: string; layout?: string; motif?: string; anim?: string; emoji?: string; start: number; end: number; title: string; wide: boolean
    eyebrow?: string; accent?: string; sub?: string; center?: string; value?: string; unit?: string
    // en entree : lignes "type|layout|score|pourquoi" ; en sortie : objets parses
    options?: (string | { type: string; layout: string; score: number; why: string })[]
    items: { text: string; t: number; value?: string; label?: string }[]
  }[]
  face: { cy: number } | null
  detected: { subtitles: boolean }
  avatarSegments: { start: number; end: number; format?: string; reason?: string }[]
}

// ---------- contexte site web (optionnel) : titre + description + texte brut ----------
async function fetchSiteContext(url: string): Promise<string> {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url)
    if (!/^https?:$/.test(u.protocol)) return ''
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return ''
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(u.href, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AvatarAds/1.0)' } })
    clearTimeout(to)
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return ''
    const html = (await res.text()).slice(0, 400_000)
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || '').trim()
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
    return [title && 'TITRE: ' + title, desc && 'DESCRIPTION: ' + desc, body && 'CONTENU: ' + body]
      .filter(Boolean).join('\n').slice(0, 2400)
  } catch (_) { return '' }
}

// ---------- mémoire de marque (#124) ----------
// La fiche de l'utilisateur, construite au fil de ses montages. Lue avec SON
// jeton → RLS : on ne peut lire que la sienne. Jamais bloquante : si la table
// ou la session pose problème, on monte la vidéo sans mémoire.
type BrandMemory = { text: string; siteUrl: string; siteCache: string }

async function loadBrandMemory(token: string): Promise<BrandMemory> {
  const empty: BrandMemory = { text: '', siteUrl: '', siteCache: '' }
  if (!token) return empty
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    )
    const { data } = await sb.from('brand_memory')
      .select('summary, facts, site_url, site_cache, site_fetched_at')
      .maybeSingle()
    if (!data) return empty

    const f = (data.facts || {}) as Record<string, unknown>
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [])
    const lines: string[] = []
    if (data.summary) lines.push(String(data.summary))
    const push = (label: string, v: unknown) => { const s = String(v || '').trim(); if (s) lines.push(label + ' : ' + s) }
    push('ACTIVITE', f.business)
    push('PRODUIT', f.produit)
    if (list(f.features).length) lines.push('FONCTIONNALITES / BENEFICES : ' + list(f.features).join(' · '))
    if (list(f.chiffres).length) lines.push('CHIFFRES VERIFIES (a citer tels quels) : ' + list(f.chiffres).join(' · '))
    push('AUDIENCE', f.audience)
    push('OFFRES', f.offres)
    if (list(f.reseaux).length) lines.push('RESEAUX : ' + list(f.reseaux).join(' · '))
    push('TON', f.ton)
    push('CTA HABITUEL', f.cta)
    if (list(f.interdits).length) lines.push('A NE JAMAIS AFFICHER : ' + list(f.interdits).join(' · '))

    // cache du site : valable 14 jours, rempli par la fonction brand-memory
    const fresh = data.site_fetched_at && (Date.now() - new Date(data.site_fetched_at).getTime()) < 14 * 24 * 3600 * 1000
    return {
      text: lines.join('\n').slice(0, 2600),
      siteUrl: String(data.site_url || ''),
      siteCache: fresh ? String(data.site_cache || '') : '',
    }
  } catch (_) { return empty }
}

// ---------- appel Claude (Messages API, sortie structurée + vision) ----------
async function claudePlan(
  duration: number,
  words: Word[],
  assets: { id: string; name: string; kind: string; thumb?: { media: string; b64: string } }[],
  lang: string,
  frames: { t: number; media: string; b64: string }[],
  siteContext: string,
  musicAlready: boolean,
  brief: string,
  memory: string,
): Promise<{ plan: Plan; usage: unknown }> {
  const anthKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!anthKey) throw new Error('ANTHROPIC_API_KEY manquante')

  const transcriptCompact = words
    .map((w) => `${w.text}[${w.start.toFixed(2)}-${w.end.toFixed(2)}]`)
    .join(' ')

  const styleBlock = `
FORMAT COMPACT (obligatoire) — plusieurs champs sont des LIGNES "a|b|c" et non des objets : un schema tout en objets imbriques fait exploser la grammaire du mode strict et l'API refuse alors TOUT appel. Respecte l'ordre des champs a la lettre, separateur "|", aucun espace autour :
  sections[]       : "role|start|end|label"            ex "hook|0|3.2|l'accroche"
  zooms[]          : "t|dur|scale|cx|cy"               ex "4.10|0.9|1.22|0.50|0.34"
  broll[]          : "assetId|start|end|fonctionnalite"  ex "img1|6.20|8.40|split screen"
  beats[]          : "mot|animation"                    ex "viral|rocket"
  tuto[]           : "mot|ecran|zone|texte"             ex "decrire|images-ia|prompt|une banane musclee"
  sfx[]            : "kind|t"                          ex "whoosh|4.10"
  beds[]           : "name|t"                          ex "montee|12.00"
  avatarSegments[] : "start|end|format"                ex "0|3.20|portrait"
  hook             : "texte|start|end"                 ex "PERSONNE NE FAIT CA|0|2.60"   ("" si aucun hook)
  music            : "intense" | "dynamique" | "chill" | ""   ("" = l'audio a deja une musique)
  face             : la position verticale du visage, ex "0.32"   ("" si aucun visage)
  detected         : "subtitles" si des sous-titres sont DEJA incrustes dans la video, "" sinon
  slides[].meta    : "eyebrow|accent|sub|center|value|unit"  — laisse vide ce qui ne s'applique pas,
                     mais garde les 5 barres. ex "ETAPE 01||||" ou "RESULTAT|||8750|VUES EN 24 H"
  slides[].items[] : "texte|t|value|label"             ex "TU PARLES|3.20||" ou "PRO|5.10|49|PAR MOIS"
Les autres champs de slides restent des champs normaux : type, layout, motif, start, end, wide, title.

VALEURS AUTORISEES (le schema ne les contraint plus — un enum de schema fait exploser la grammaire du mode strict — donc RESPECTE-LES a la lettre, tout le reste est jete par le serveur) :
  sections[].role : hook | benefice | preuve | cta | outro
  slides[].type   : flow | checklist | compare | stat | card | nodes | loop | bars | kpi | timer | versus | punch | banner
  slides[].layout : split | full | banner
  slides[].motif  : "" | chain | tiles | versus | bars | ring | cloud | halftone | grid
  tone            : fun | neutre
  music.mood      : intense | dynamique | chill
  beds[].name     : grave | tension | montee
  avatarSegments[].format : portrait | paysage
  sfx[].kind      : whoosh | pop | ding | boom | click | riser | success | magic | hit | flash | snap | hu | bip | fahh | robot

LES 4 RYTHMES (le coeur du format) : une bonne video n'est JAMAIS un seul cadre du debut a la fin. Tu alternes QUATRE rythmes, et tu changes de rythme toutes les 2 a 5s.
  1. FULL ECRAN (layout absent) = la personne plein cadre : zooms punch, b-roll, respiration.
  2. SPLIT (layout "split") = la video glisse dans la moitie basse, une slide motion design sombre occupe la moitie haute. Types : flow, checklist, compare, stat, card.
  3. PLEIN CADRE (layout "full") = la video DISPARAIT, une scene editoriale sur fond creme occupe tout l'ecran (gros titre noir + sur-titre) et les sous-titres passent dessus. C'est le rythme le plus fort visuellement : garde-le pour les moments cles (une demonstration, un chiffre, un avant/apres, une punchline). Types : nodes, loop, bars, kpi, timer, versus, punch.
  4. BANDEAU (layout "banner") = la personne reste plein ecran et une carte titre noire se pose en haut de l'image. Parfait pour poser le sujet au debut ou annoncer une partie.
- MOTIF D'ANIMATION (champ "motif", une valeur par scene) : une forme abstraite, utilisee par le style "Editorial blanc" uniquement. Le style "Mot par mot" l'IGNORE — des carres de couleur qui apparaissent n'y montrent rien ; sur ce style, seul le champ "anim" illustre. Quand tu hesites, laisse motif vide.
    chain    — un enchainement, des etapes qui se suivent, une progression.
    tiles    — une enumeration d'elements de meme nature (une liste, des inclus).
    versus   — une opposition, un avant/apres, un "au lieu de".
    bars     — une montee, une croissance, des quantites qu'on compare.
    ring     — une boucle, un cycle, ou une punchline qu'on laisse resonner.
    cloud    — il ENUMERE des notions abstraites ou des ressentis (confort, confiance, statut...) : les mots s'eparpillent sur la page et arrivent un par un sur SA voix. Mets alors chaque notion dans items[].text avec son t = l'instant exact ou il la prononce.
    halftone — une respiration, une transition, un moment ou il laisse un blanc.
    grid     — de la quantite, de la repetition, "des centaines de...", l'echelle.
  Laisse "" quand le mot prononce n'evoque VRAIMENT rien de visuel (un connecteur, une transition) : une forme decorative qui ne correspond a rien casse la video. Mais ne laisse pas l'ecran vide plus de 3s d'affilee — s'il n'y a ni image ni animation qui colle, c'est que la scene ne devait pas exister : etends la scene voisine.
- ANIMATION FABRIQUEE (champ "anim") — DECISIF quand aucune image ne colle : une capture d'ecran ne montre pas un CONCEPT. Le bouton "Split Screen" ne dit pas a quoi RESSEMBLE un split screen. Quand il parle d'une notion que les images fournies n'illustrent pas, DEMANDE une animation : elle est fabriquee pour toi, gratuitement, et elle montre l'idee.
- REGLE DE FOND, VALABLE POUR TOUT VISUEL : une animation doit MONTRER quelque chose de CONCRET, un objet ou une action qu'on reconnait en un coup d'oeil. Si le spectateur ne peut pas dire en une seconde « c'est un billet », « c'est une fusee », « c'est un cadenas », l'animation ne sert a rien et il vaut mieux ne rien mettre. Une forme abstraite, un rectangle qui bouge, un motif decoratif : ca ne montre RIEN. Ne place jamais un visuel juste pour occuper l'ecran.
- EMOJI 3D (champ "emoji", une valeur par scene) — LE VOCABULAIRE UNIVERSEL. L'emoji REMPLACE le mot a l'ecran pendant qu'il est affiche : un seul element a la fois, jamais l'emoji ET le sous-titre. C'est le geste de reference (Thinks) : il dit « un SaaS », un vieil ordinateur apparait ; il dit « de l'argent », un billet apparait ; il dit « le cerveau », un cerveau.
  LES MOTS FORTS, C'EST TOI QUI LES DESIGNES (champ "beats"). Relis le script mot a mot et sors la LISTE des mots qui appellent une image mentale — un objet, une action, un gain, un chiffre, une emotion. Pour chacun, ecris "mot|animation" avec le mot EXACTEMENT tel qu'il est prononce (une seule forme, sans article) et l'animation de la banque qui le dessine. Vise 15 a 25 lignes sur 45 secondes, dans l'ordre du script.
  C'est le champ le plus utile que tu remplis : le serveur s'en sert pour poser les animations au bon endroit, la ou un simple mot-cle se tromperait. Exemple sur « tu gagnes du temps et tu produis dix fois plus » : "gagnes|clock", "produis|stack", "dix|grow".
  Un mot vide de sens (un connecteur, un article) n'a rien a faire dans cette liste.
  DEMO DANS L'APPLICATION (champ "tuto"). Si — et SEULEMENT si — l'utilisateur EXPLIQUE COMMENT FAIRE quelque chose dans son outil (« tu vas dans X », « tu selectionnes Y », « tu ecris ton prompt »), montre son vrai ecran plutot qu'une animation abstraite. Ecris "mot|ecran|zone" avec le mot EXACT prononce, et un ecran + une zone pris DANS CETTE LISTE, rien d'autre :
    images-ia  -> menu | photo-reel | pixar | fruit | ugc | format | prompt | generer
    express    -> menu | realiste | cartoon | portrait | duree | qualite | voix | ajouter | prompt | generer
  COUVRE CHAQUE ETAPE QU'IL DECRIT, dans l'ordre, sans en sauter : s'il enumere « tu vas dans Images IA, tu selectionnes photo reel, tu mets le format TikTok, tu decris ton image », cela fait QUATRE lignes (menu, photo-reel, format, prompt). Une etape decrite sans ligne, c'est un moment de la video ou l'on ne montre rien.
  N'OUBLIE JAMAIS L'ETAPE "prompt" DE CHAQUE MODULE : c'est le moment ou l'on voit le texte s'ecrire dans le champ, avec le bruit du clavier. S'il decrit ce qu'il tape dans Images IA ET dans Express, il faut DEUX lignes prompt, une par module.
  QUATRIEME CHAMP, seulement sur une zone "prompt" : ce que l'utilisateur taperait dans le champ. Ecris-le court (moins de 60 caracteres) et dans SES mots — il s'ecrira lettre par lettre dans le vrai champ de l'app pendant qu'il parle, avec le bruit du clavier. Laisse vide sur toutes les autres zones.
  ATTENTION AU MOT EXACT : s'il dit « selectionner photo reel », la zone est photo-reel, pas fruit. Ne prends pas la case qui est deja selectionnee sur la capture, prends CELLE QU'IL NOMME.
  Une ligne par etape decrite, dans l'ordre du script. Si l'audio ne decrit AUCUNE manipulation dans l'outil, laisse la liste VIDE — ne montre jamais une interface pour meubler.
  COMBIEN ? BEAUCOUP PLUS QUE TU NE CROIS. Sur 30 secondes, vise 12 a 20 animations ; sur 45 secondes, 18 a 30. Une par phrase au minimum, et souvent une par GROUPE DE MOTS : "tu gagnes du temps" / "tu produis plus" / "tu touches plus de monde" = trois animations, pas une. Si tu en as pose moins de 10 sur 30 s, tu n'as pas fini : relis le script et cherche ce que chaque phrase MONTRE.
  CHAQUE BENEFICE A LA SIENNE. C'est la faute la plus frequente : il enumere ce que ca apporte et l'ecran ne bouge pas. Des qu'il dit un gain — du temps, de l'argent, de la simplicite, de la portee, de la qualite, de la liberte — cette seconde-la merite son animation.
  DENSITE — LE PLUS DYNAMIQUE POSSIBLE. Une video virale illustre presque en permanence : les gens comprennent mieux avec des images. Tu peux couvrir JUSQU'A 99% de la duree d'animations, il n'y a AUCUN quota a respecter et aucun espacement a tenir. La seule limite est la PERTINENCE : chaque animation doit illustrer ce qui est dit A CET INSTANT. Deux regles fermes : jamais deux fois la MEME animation dans une video, et jamais une animation qui ne correspond pas au sens (mieux vaut un blanc qu'un contresens).
  C'EST TOI QUI CHOISIS, PAS UNE LISTE DE MOTS. Tu comprends le SENS d'une phrase ; un mot-cle isole se trompe. « sans jamais montrer ton visage » n'appelle pas un cadenas parce qu'il y a « jamais » : ca appelle faceless. Lis la phrase entiere, demande-toi ce qu'elle MONTRE, et prends l'animation qui la dessine.
  L'EMOJI EST UN REPLI RARE, PAS LE DEFAUT. La regle voulue est 99% d'ANIMATIONS et 1% d'emoji : une animation dure, elle occupe le cadre et elle raconte, la ou l'emoji n'est qu'une image posee. Cherche donc TOUJOURS une animation d'abord dans la liste ci-dessus — elle couvre l'argent, le temps, l'idee, l'objectif, la securite, la recherche, le lancement, le reseau, la validation, la liste, la croissance, la comparaison, le format vertical, le texte qui s'ecrit. Ne prends un emoji que si AUCUNE animation ne colle, et au maximum une ou deux fois par video.
  Rythme : 0,7 a 1,5s, jamais deux colles.
  VALEURS AUTORISEES (toute autre valeur est jetee) :
    airplane alarm_clock bank bar_chart battery beach_with_umbrella bell bookmark_tabs books brain bullseye bust_in_silhouette busts_in_silhouette
    calendar camera chart_decreasing chart_increasing check_mark_button clapper_board coin credit_card cross_mark crown crystal_ball desktop_computer
    direct_hit dollar_banknote envelope eyes fire floppy_disk gear gift glowing_star growing_heart hammer_and_wrench handshake headphone high_voltage
    hourglass_done hundred_points key laptop light_bulb link locked loudspeaker magic_wand magnifying_glass_tilted_left megaphone memo microphone
    mobile_phone money_bag money_with_wings movie_camera musical_note open_book package party_popper puzzle_piece question_mark rainbow
    recycling_symbol red_exclamation_mark red_heart robot rocket scissors shopping_cart sparkles speaker_high_volume speech_balloon spiral_calendar
    star stopwatch studio_microphone thinking_face trophy unlocked video_camera warning wrench
    split   — un split screen, deux choses cote a cote, un ecran qui se coupe en deux.
    voice   — une voix, un clonage vocal, un enregistrement, du son.
    list    — une liste, une bibliotheque, un catalogue, "plus de X scripts / modeles / options".
    grow    — une croissance, des vues qui montent, un resultat qui progresse.
    compare — un avant/apres, deux options opposees, "au lieu de".
    type    — un texte qui s'ecrit tout seul : un script genere, une IA qui redige. Mets alors la phrase dans items[0].text (34 caracteres max).
    phone   — le format final vertical, une video qui defile, "sur TikTok / Reels / Shorts".
    clock   — la rapidite, le temps gagne, "en 30 secondes", "en 2 minutes".
    avatar  — la creation d'un avatar, un personnage qui se genere, "ton premier avatar".
    logo    — DES QU'IL PRONONCE LE NOM DE SON SITE OU DE SON PRODUIT : le logo s'affiche EN GRAND, plein cadre dans la zone sure. C'est le moment le plus important de la video pour la marque, il ne reste jamais nu. SI il prononce le NOM de la marque : le logo apparait avec un halo. Une seule fois dans la video, au premier passage.
    money   — l'argent, un revenu, un prix, un cout, ce qui est gratuit.
    idea    — une idee, une astuce, une methode, un declic, "le secret c'est...".
    target  — un objectif, une cible, quelque chose de precis, "exactement".
    lock    — la securite, l'acces reserve, ce qui se debloque, une cle.
    search  — chercher, analyser, trouver, reperer.
    rocket  — un lancement, un decollage, ce qui explose, devenir viral.
    network — un reseau, une connexion, une communaute, des gens relies.
    check   — c'est valide, c'est fait, ca marche, c'est simple, c'est inclus.
    swipe   — un fil qui defile, le scroll, "les gens scrollent", le feed.
    views   — des vues qui grimpent, la portee, "X personnes t'ont vu".
    engage  — des commentaires et des coeurs qui montent : l'engagement, les reactions.
    calendar— une grille qui se remplit : publier regulierement, tous les jours, la constance.
    upload  — une carte qui s'envole : publier, mettre en ligne, poster.
    stack   — des videos qui s'empilent : le volume, produire en serie, "10 videos par jour".
    swap    — une chose remplacee par une autre : "au lieu de", "a la place de", remplacer.
    cut     — une timeline qu'on coupe : le montage, la decoupe, "on enleve les blancs".
    steps   — 1, 2, 3 : une methode, "il te suffit de", les etapes.
    toggle  — un interrupteur qui s'allume : activer, "en un clic", ca se met en marche.
    flow    — A MENE A B MENE A C : une chaine d'etapes reliees par des fleches. Mets les libelles dans items[].text (3 max, 14 caracteres). Ideal pour "tu fais X, ca te donne Y, et Y te rapporte Z".
    funnel  — un entonnoir : beaucoup entrent, peu ressortent.
    orbit   — un centre et des satellites : tout part d'un seul outil.
    bars2   — deux colonnes comparees : le avant/apres chiffre.
    wallet  — un portefeuille qui se remplit : ce que ca rapporte.
    faceless— l'anonymat : "sans montrer ton visage", "sans camera", "personne ne sait que c'est toi". Une tete dont les yeux se font masquer.
  COMMENT TU T'Y PRENDS, DANS CET ORDRE — ne saute aucune etape :
  ETAPE 1 · LA LISTE DES MOMENTS FORTS. Avant d'ecrire le moindre JSON, releve les instants qui PORTENT la video : (a) la PROMESSE, ce qu'il jure au spectateur ("sans jamais montrer ton visage", "devenir viral") ; (b) CHAQUE fonctionnalite qu'il nomme, une par une ; (c) le chiffre marquant ; (d) le CTA. Sur un script de 30s il y en a typiquement 5 a 8.
  ETAPE 2 · CHAQUE MOMENT FORT RECOIT SON VISUEL. Sans exception : c'est exactement la que le spectateur decroche s'il ne voit rien. Par defaut une ANIMATION. Tu ne deliberes pas pour savoir SI le moment merite un visuel — il en a un ; tu deliberes seulement pour savoir LEQUEL.
    Deux erreurs a ne jamais commettre ici :
      · Une PROMESSE couverte par une capture d'interface. "Sans jamais montrer ton visage" n'est pas une page d'accueil, c'est "faceless". Cherche l'animation qui DIT la phrase.
      · Une ENUMERATION de BENEFICES sans visuel a chacun. Quand il enchaine ce que ca apporte ("tu gagnes du temps, tu produis plus, tu touches plus de monde"), CHAQUE benefice recoit SON animation, calee sur le moment ou il le dit.
      · Une ENUMERATION ecrasee sous UNE SEULE scene de 8 ou 10 secondes. S'il cite 3, 4 ou 5 fonctionnalites a la suite, chacune a SON visuel de 1,5 a 2,5s, cale sur la seconde exacte ou il la prononce. Une checklist figee pendant qu'il en enumere cinq, c'est cinq moments forts perdus d'un coup.
  ETAPE 3 · QUAND UNE IMAGE, QUAND UNE ANIMATION — la regle est nette. UNE IMAGE NE SERT QU'A PRESENTER UNE FONCTIONNALITE : il la NOMME, il dit ce qu'elle fait, tu montres a quoi elle ressemble. C'est son unique emploi. TOUT LE RESTE — l'accroche, la promesse, un benefice, une transition, le CTA — c'est une ANIMATION, ou rien.
    Pourquoi : une animation parle mieux qu'une capture (un ecran d'application entier, avec ses menus et ses boutons, est ILLISIBLE en vertical : le spectateur a 2 secondes) et elle reste dans la direction artistique du style, alors qu'une image posee sur une promesse casse les deux d'un coup.
    IL DOIT LA PRESENTER, PAS SEULEMENT LA CITER. Une image ne se justifie que s'il DEVELOPPE la fonctionnalite : il s'y arrete, il explique ce qu'elle fait, ca dure. S'il l'expedie dans une ENUMERATION rapide ("des sous-titres, le split screen, le clonage de voix, une personnalisation totale"), il ne presente rien — chacune de ces mentions appelle une ANIMATION. Consequence directe : sur un script qui enumere, tu dois avoir BEAUCOUP plus d'animations que d'images, et souvent AUCUNE image.
    UNE IMAGE MONTRE LE RESULTAT, JAMAIS L'ECRAN QUI LE PRODUIT. Pour "generation de ton premier avatar", c'est un avatar IA fini — un vrai visage — pas la page "choisis ton avatar". Pour les sous-titres, c'est le rendu des sous-titres, pas le panneau de reglages. Si la seule image disponible pour cette fonctionnalite est une capture d'interface (menus, champs, boutons), elle ne montre rien : prends l'ANIMATION.
    Concretement : "le split screen disponible" -> il nomme une fonctionnalite ET on peut en montrer le rendu, image. "la possibilite de cloner ta voix" -> une fonctionnalite, mais l'ecran de clonage n'est qu'un formulaire : animation (voice). "sans jamais montrer ton visage" -> une promesse, donc animation (faceless), JAMAIS une capture.
  ETAPE 4 · TU COMBLES ENSUITE. Une fois les moments forts servis, regarde les trous : sur une page blanche, un ecran vide trop longtemps donne une video pauvre. VISE 60 a 70% de la duree couverte, aucun trou de plus de 3s — soit 7 a 9 visuels sur 30s. Si un trou ne t'inspire rien de juste, etends le visuel voisin plutot que d'inventer une scene decorative.
  ETAPE 5 · LES LIMITES, et il n'y en a que trois : AU MAXIMUM 3 CAPTURES D'INTERFACE (au-dela on dirait une doc produit) ; jamais deux fois la MEME animation ; jamais deux animations qui se suivent. Tout le reste est libre.
  ETAPE 6 · SOIS LITTERAL. L'animation doit correspondre a ce qu'il dit MOT POUR MOT, pas a une idee vaguement proche : s'il dit "sur n'importe quel reseau", "phone" ne montre pas les reseaux. Sur un moment fort, cette regle veut dire CHERCHE MIEUX — pas "laisse vide". Sur un moment secondaire, elle veut dire laisse vide.
- C'EST LE SCRIPT QUI COMMANDE : tu pars de CE QUI EST DIT a cet instant et tu prends le traitement qui l'illustre le mieux — jamais un type choisi "pour varier".
- CETTE RETENUE NE S'APPLIQUE PAS AUX ANIMATIONS. Pour les scenes plein cadre et les bandeaux, qui INTERROMPENT la video, mieux vaut trois scenes justifiees que huit decoratives. Les ANIMATIONS, elles, SONT la video en style mot-a-mot : la page est blanche, il n'y a rien d'autre a regarder. Une phrase sans animation est une phrase perdue.
- TOUT LE TEXTE AFFICHE VIENT DE SA BOUCHE : chaque title, item, value, label reprend SES mots (condenses en 2 a 5 mots), avec SON vocabulaire. Tu n'inventes RIEN : pas un chiffre qu'il n'a pas prononce, pas une etape qu'il n'a pas citee, pas un prix, pas une marque, pas une statistique. Si le chiffre n'est ni dit ni visible a l'image (ni dans le contexte produit fourni), le type kpi/bars/versus est INTERDIT — prends autre chose.
- Verification finale : tu ne dois avoir ni 2 scenes IDENTIQUES collees, ni un moment fort de l'ETAPE 1 sans visuel, ni un trou de plus de 3s. Si deux scenes se ressemblent, c'est l'une des deux qui n'etait pas justifiee — supprime-la ; si un moment fort est nu, c'est une animation qui manque — ajoute-la.
- TU DELIBERES AVANT DE TRANCHER (obligatoire pour CHAQUE scene) : a chaque moment ou un traitement visuel est possible, tu ne prends pas la premiere idee. Dans ton RAISONNEMENT (pas dans le JSON), compare 2 a 4 traitements candidats pour ce moment precis et note chacun sur 100 = son POTENTIEL VIRAL POUR CE SCRIPT-LA (retention : est-ce que ca donne envie de rester ? clarte : est-ce que ca rend l'idee plus limpide ? surprise : est-ce que ca casse la monotonie au bon moment ?). "rester en plein ecran sur la personne" est TOUJOURS un des candidats a evaluer, et c'est souvent le meilleur. Puis n'ecris dans le JSON que LE CANDIDAT LE MIEUX NOTE. Attention : cette deliberation tranche QUEL traitement, jamais SI le moment merite un visuel — les moments forts de la REGLE 3 en ont un, toujours ; c'est seulement entre eux que "rester en plein ecran" redevient un candidat.
- Note honnetement, sans complaisance : un traitement qui n'apporte rien merite 20, pas 60. Si le meilleur candidat est sous 55, ce moment ne merite AUCUNE scene — ne l'ecris pas du tout (le rendu restera en plein ecran). Deux scenes tres bien notees valent mieux que six scenes a 60.
- TYPES PLEIN CADRE — le declencheur est ce qui est DIT, chacun a sa condition d'entree :
    nodes  — SI il enonce un enchainement de 2 a 4 etapes ("tu fais X, puis Y, et t'obtiens Z"). items[].text = 1 a 3 mots, ses mots.
    loop   — SI il decrit un cycle qui se repete tout seul ("et ca recommence", "en boucle", "tous les jours") ; center = le mot qui resume la boucle.
    bars   — SI il cite 3 a 5 chiffres COMPARABLES a voix haute ; chaque item porte value (le chiffre EXACT qu'il dit) et label (ce qu'il compte).
    kpi    — SI il assene UN chiffre marquant : value = ce chiffre EXACT, unit = ce qu'il mesure, avec ses mots.
    timer  — SI il oppose deux durees ("avant ca me prenait 3 jours, la c'est 3 minutes") : value = les secondes du chrono, unit = "CHRONO".
    versus — SI il oppose explicitement 2 options : item 0 = celle qu'il rejette, item 1 = celle qu'il garde ; text (le nom qu'IL emploie), value (le prix/chiffre s'il le dit, "" sinon), label (l'unite, ex "PAR MOIS").
    punch  — SI c'est une punchline, une phrase choc qui se suffit : sa phrase, raccourcie, seule a l'ecran.
  Chaque scene plein cadre porte eyebrow (sur-titre court MAJUSCULES, ex "ETAPE 01", "RESULTAT") et title (2 a 4 mots MAJUSCULES ; utilise " / " pour forcer un retour a la ligne).
- BANDEAU : eyebrow (sur-titre), title (la phrase, " / " pour couper la ligne), accent = LE mot du titre a colorer en orange (doit apparaitre tel quel dans title), sub = une ligne de preuve courte. Duree 2 a 3s.
- Une scene PLEIN CADRE ne doit jamais tomber sur un segment avatar (la personne serait masquee pour rien).
- Les ~3 premieres secondes (l'accroche) : TOUJOURS full ecran, AUCUNE slide split ni plein cadre — cale la borne sur la FIN de la phrase d'accroche. Un BANDEAU y est le bienvenu, et un zoom punch sur le mot fort.
- Les ~3 dernieres secondes (CTA / chute) : soit full ecran (scene avatar OU gameplay), soit une CARTE motion-design (slide type card) qui affiche l'action a faire — choisis selon le type de video (pas besoin de l'avatar a la fin si une carte fait le job). Cale la borne sur le DEBUT de la phrase de CTA.
- Entre les deux : ALTERNE les 4 rythmes. Le contenu decide du type (enumeration -> checklist, processus -> flow ou nodes, opposition -> compare ou versus, chiffre -> stat ou kpi ou bars, cycle -> loop, duree -> timer, punchline -> card ou punch) : une scene dure le temps de sa ou ses phrases (2 a 6s). Entre deux scenes, reviens en full ecran 1.5 a 4s avec un zoom punch sur un mot fort.
- SLIDES : title court MAJUSCULES ("" si inutile) ; items[].text 2 a 5 mots MAJUSCULES percutants ; CHAQUE item porte t = timestamp EXACT du mot correspondant dans le transcript (il apparait PILE quand c'est dit), t dans [start, end] de sa slide, items en ordre chronologique.
- CADRAGE VIDEO PENDANT LES SLIDES : chaque slide porte wide. wide=false => la video remplit la moitie basse (9:16 croppe). wide=true => la video devient une bande CINEMA 16:9 centree dans la moitie basse (bandes noires, look premium). ALTERNE les deux d'une slide a l'autre pour varier le format (jamais deux slides consecutives avec le meme wide si possible). Si une scene avatar paysage est sous la slide, wide sera force a true au rendu.
- ZOOMS et B-ROLL : UNIQUEMENT pendant les passages full ecran, JAMAIS pendant une slide (garde 0.5s de marge autour des slides).
- SFX : whoosh a chaque changement de cadre (entree ET sortie de slide), pop/click sur les items de slide marquants.
- Si un CONTEXTE PRODUIT (site web) est fourni, les slides refletent les VRAIES fonctionnalites, offres et chiffres du produit — pas d'invention.`

  const system = `Tu es le chef d'orchestre d'AvatarAds : un monteur video expert en formats viraux TikTok/Reels/Shorts (style Hormozi, 1600.agency, Captions.ai).
OBJECTIF ABSOLU : un montage COHERENT avec ce qui est dit et montre, une qualite premium, et le maximum de retention (contenu viral).
On te donne des IMAGES DE LA VIDEO a differents timestamps, la transcription mot-a-mot (timestamps en secondes), sa duree, et eventuellement des images fournies par l'utilisateur (b-roll).

ETAPE 1 - ANALYSE (obligatoire, avant tout) : etudie les images de la video. Qu'est-ce qu'on VOIT reellement (personne face camera ? ou est son visage dans le cadre ? gameplay ? produit ? ambiance, lumiere, rythme visuel) ? Croise avec le script : de quoi parle la video, sur quel ton ?
- Renseigne face.cy = position verticale du CENTRE du visage dans le cadre (0=haut, 1=bas), moyenne sur les images ; null si aucun visage. Le rendu s'en sert pour cadrer la personne pendant les slides.
- Renseigne detected.subtitles = true si des SOUS-TITRES mot-a-mot sont DEJA incrustes dans la video (les mots qui changent en bas/milieu, pas un simple titre) — dans ce cas on n'en rajoutera pas par-dessus.
- Si les images montrent du TEXTE deja incruste dans la video (video deja montee) : mets hook=null (pas de doublon). Les SLIDES restent OBLIGATOIRES : pendant une slide, le cadrage se resserre sur le visage et le texte incruste disparait — genere l'alternance normalement.

ETAPE 2 - PLAN : construis le PLAN DE MONTAGE au format JSON demande, adapte a CE contenu precis :
- Les zooms se centrent sur le sujet REELLEMENT visible dans les images (deduis cx/cy de la position du visage ou du point d'interet observe, pas d'une valeur par defaut).
- Le b-roll ne recouvre jamais un moment visuellement fort de la video.
- B-roll : un asset kind=video est un CLIP qui sera JOUE dans la carte flottante (pas une image figee) — place-le sur le passage qu'il illustre le mieux et donne-lui une fenetre un peu plus longue (2.5 a 4s) ; une image se contente de 1.5 a 2.5s.
- La musique colle a l'ambiance VISUELLE observee autant qu'au ton du script.
- Si le visuel ne montre pas de visage, reduis les zooms (1 ou 2 max) et privilegie hook, sous-titres et musique.
${styleBlock}

Regles :

SECTIONS : decoupe narrative complete de 0 a la duree totale (hook / benefice / preuve / cta / outro selon ce qui est dit). Bornes alignees sur les phrases.

RYTHME ADAPTATIF : decoupe D'ABORD le transcript en phrases — TOUTES les bornes (sections, slides, entrees/sorties de cadre) tombent sur des fins de phrase ou des respirations, jamais en plein milieu d'une idee. Le tempo depend de la duree et du debit : video courte (<20s) ou debit rapide = un evenement visuel (changement de cadre, zoom, b-roll, item de slide) toutes les 2 a 3.5s ; video plus longue et posee = toutes les 3 a 5s. Jamais plus de 5s sans changement. Jamais deux evenements a moins de 0.8s l'un de l'autre.

ZOOMS (punch-in sur la personne) : scale entre 1.12 et 1.35, duree 0.6 a 1.4s, declenches PILE sur un mot fort (le timestamp du mot). cx/cy = point de zoom relatif (0-1) deduit des images de la video (la ou est reellement le visage). Pas de zoom pendant un b-roll.

B-ROLL (images utilisateur, plein ecran par-dessus la video) — UNE IMAGE NE SERT QU'A PRESENTER UNE FONCTIONNALITE. C'est sa seule raison d'exister : il NOMME une fonctionnalite et dit ce qu'elle fait, tu montres a quoi elle ressemble. Partout ailleurs — l'accroche, la promesse, un benefice, une transition, le CTA — c'est une ANIMATION, ou rien. Une animation parle mieux qu'une capture et elle reste dans la direction artistique du style ; une image posee sur une promesse casse les deux.
Le 4e champ est OBLIGATOIRE : ecris-y la fonctionnalite presentee, avec SES mots a lui, tels qu'il les prononce a cet instant ("split screen", "clonage de voix", "sous-titres"). Le serveur verifie que ces mots sont reellement dits dans la fenetre — une image dont la fonctionnalite n'est pas prononcee la est jetee.
Place CHAQUE image au moment ou son CONTENU correspond a ce qui est dit (regarde les images !). Duree 1.5 a 3.5s. Jamais dans les 1.5 premieres secondes (le hook montre le visage), jamais dans la derniere seconde. Si aucune image fournie : broll = [].

SFX : whoosh sur chaque entree/sortie de b-roll et zoom marquant, click/pop sur les enumerations, riser avant le CTA, success/ding sur une preuve ou un resultat. Maximum 1 SFX par 1.5s. Les timestamps tombent sur les evenements qu'ils soulignent.

SCENES AVATAR (lipsync segmente, economie MAXIMALE) : dans avatarSegments, liste les fenetres ou l'on VOIT la personne parler face camera. Le lipsync ne sera genere QUE sur ces fenetres (chaque seconde d'avatar coute cher), donc mets une scene avatar UNIQUEMENT quand voir le visage a un vrai impact. Chaque scene porte un format :
- format "portrait" (9:16) = la personne PLEIN ECRAN, en dehors des slides. C'est le format du hook et des temps forts.
- format "paysage" (16:9) = la personne dans la moitie basse PENDANT une slide (bande cinema sous la slide). Utilise-le quand le passage est incarne (la personne explique, temoigne) ; sinon laisse le gameplay sous la slide (aucune scene = hyperframes seul).
ALTERNE selon l'AUDIO : le HOOK est presque toujours une scene portrait (le visage cree la confiance des la 1re seconde) — et PARFOIS une seule scene (le hook) suffit pour toute la video. Le CTA n'a PAS besoin d'etre une scene avatar : une carte motion-design (slide card) peut porter l'action. 1 a 6 scenes au total selon la dynamique. Une scene portrait ne chevauche JAMAIS une slide ; une scene paysage est TOUJOURS pendant une slide. Bornes calees sur des fins de phrase. Si le montage est 100% gameplay/voix off (aucun visage), avatarSegments = [].

HOOK TEXTE : si les 3 premieres secondes contiennent une accroche forte, un texte MAJUSCULES de 5 mots max qui la resume (start 0, end <= 3). Sinon null.

ACCENTS : 5 a 12 mots EXACTS du transcript (les plus percutants : chiffres, benefices, verbes d'action) qui seront colores en orange dans les sous-titres.

TON DE LA VIDEO (tone) : "fun" UNIQUEMENT si le contenu assume l'humour, l'autoderision, le second degre, le storytelling decontracte. "neutre" pour tout le reste : demonstration produit, conseil, vente, temoignage serieux, sujet sensible. Dans le doute, c'est "neutre" — un son comique sur une video serieuse fait amateur et detruit la credibilite, alors qu'une video fun sans son comique reste tres bien.

SONS FUN (uniquement si tone = "fun", sinon ils sont supprimes) : ils ne s'ajoutent JAMAIS "pour faire rire". Chacun a un declencheur precis et tu n'en poses AU MAXIMUM que 2 dans toute la video — un seul, bien place, vaut mieux que trois.
  hu    — une reaction de surprise ("hein ?") : sur un retournement, une question rhetorique, une affirmation qui choque.
  bip   — un bip de censure : sur un gros mot, un chiffre/nom qu'il fait mine de cacher.
  fahh  — une exclamation qui claque : sur LA punchline, un resultat spectaculaire.
  robot — voix robotique : quand il parle d'IA, d'automatisation, de machine.
  Regles de pose : sur le timestamp EXACT du mot declencheur (pas entre deux mots), jamais avant 1s, jamais pendant une slide, jamais a moins de 3s d'un autre son fun. Si aucun declencheur clair n'existe dans le script, tu n'en mets AUCUN — c'est le cas le plus frequent.

LITS MUSICAUX (beds) : un extrait de ~10s pose a un instant et qui accompagne un passage (il ne boucle pas, il passe sous la voix). AU MAXIMUM 1 par video, et seulement si le moment le justifie vraiment :
  grave   — lourd, sombre : quand il decrit un probleme, un echec, une galere.
  tension — tenu, suspense : quand il fait attendre ("attends de voir la suite").
  montee  — build-up qui CULMINE a ~9s : pose-le donc environ 9 SECONDES AVANT la punchline ou le CTA, pour que le pic tombe pile dessus. Si la video est trop courte pour ca, ne le mets pas.
  Si rien ne colle : beds = []. C'est le defaut.

MUSIQUE : choisis l'ambiance de la musique de fond selon le ton du script — "intense" (vente agressive, hype, urgence), "dynamique" (astuce, tuto rythme, presentation produit), "chill" (storytelling, lifestyle, calme). Mets null UNIQUEMENT si l'audio semble deja contenir de la musique.

Tous les timestamps entre 0 et la duree, 2 decimales. Reponds uniquement dans le schema JSON impose.`

  const content: unknown[] = []
  for (const f of frames) {
    content.push({ type: 'text', text: `Image de la video a t=${f.t.toFixed(1)}s :` })
    content.push({ type: 'image', source: { type: 'base64', media_type: f.media, data: f.b64 } })
  }
  for (const a of assets) {
    if (!a.thumb) continue
    const label = a.kind === 'video'
      ? `Clip VIDEO utilisateur (b-roll ANIME - il sera JOUE dans la carte) assetId="${a.id}" (${a.name}) - voici sa premiere image :`
      : `Image utilisateur (b-roll a placer) assetId="${a.id}" (${a.name}) :`
    content.push({ type: 'text', text: label })
    content.push({ type: 'image', source: { type: 'base64', media_type: a.thumb.media, data: a.thumb.b64 } })
  }
  if (memory) {
    content.push({
      type: 'text',
      text: `MEMOIRE DE MARQUE (sa fiche, construite au fil de ses videos precedentes — c'est du VERIFIE, tu peux t'appuyer dessus comme sur ce qu'il dit) :
${memory}

Sers-t'en pour : employer SON vocabulaire, ses vrais noms de produit et de fonctionnalites, son ton, son CTA habituel, et pour ne jamais contredire son offre. Ces elements sont autorises a l'ecran meme s'il ne les prononce pas dans cet audio-la. Ce qui n'y est PAS et qui n'est ni dit ni sur le site reste interdit.`,
    })
  }
  if (siteContext) {
    content.push({
      type: 'text',
      text: `CONTEXTE PRODUIT (extrait du site web de l'utilisateur — sers-t'en pour des slides precises : vraies fonctionnalites, vrais chiffres, vrai vocabulaire) :\n${siteContext}`,
    })
  }
  if (brief) {
    content.push({
      type: 'text',
      text: `BRIEF DE L'UTILISATEUR (ce qu'il veut que la video mette en avant — c'est SON intention, elle prime sur ton interpretation) :
${brief}

Sers-t'en pour : choisir quoi illustrer en priorite, le ton, l'ordre des idees, et le CTA. Les mots du brief sont autorises a l'ecran meme s'ils ne sont pas prononces mot pour mot (c'est lui qui te les donne). Mais tu n'inventes toujours RIEN au-dela : ni chiffre, ni promesse, ni fonctionnalite qui ne soit ni dans le brief, ni dans l'audio, ni dans le contexte produit.`,
    })
  }
  content.push({
    type: 'text',
    text: `Duree totale : ${duration.toFixed(2)}s. Langue : ${lang}. ${assets.length} image(s) utilisateur a placer : ${assets.map((a) => a.id).join(', ') || 'aucune'}.

Transcription (mot[debut-fin]) :
${transcriptCompact}
${musicAlready ? '\nATTENTION : une musique de fond a ete detectee dans l\'audio -> music = null obligatoirement.' : ''}
Analyse d'abord la video, puis genere le plan de montage.`,
  })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      // effort BAS : 88 % des tokens produits etaient du raisonnement interne
      // (11 999 sur 13 581 mesures), ce qui faisait depasser le budget de 150 s de
      // la fonction — 3 generations sur 4 echouaient en timeout. Le placement, la
      // cadence et les verrous sont deterministes cote serveur : le modele n a plus
      // qu a designer les mots forts, ce qui ne demande pas une longue deliberation.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: PLAN_SCHEMA },
      },
      system,
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  if (data.stop_reason === 'refusal') throw new Error('Le plan a ete refuse par le modele — reessaie')
  if (data.stop_reason === 'max_tokens') throw new Error('Plan tronque — reessaie')
  const textBlock = (data.content || []).find((b: { type: string }) => b.type === 'text')
  if (!textBlock) throw new Error('Reponse Claude vide')
  return { plan: expandPlan(JSON.parse(textBlock.text)), usage: data.usage }
}

// ---------- validation / normalisation serveur (le schema garantit la forme, ici les bornes) ----------
const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))


// ── LEXIQUE mot→emoji (#135) ────────────────────────────────────────────────
// Permet au SERVEUR de poser un emoji sur un mot fort SANS repasser par le modele.
// C'est ce qui garantit la cadence : le modele place les visuels evidents, le
// serveur comble les trous pour atteindre un visuel toutes les ~2,5s (reference
// Thinks). Cle = racine normalisee (prefixe), valeur = nom d'emoji de la banque.
const EMOJI_LEX: [string, string][] = [
  ['argent', 'money_bag'], ['euro', 'money_bag'], ['dollar', 'dollar_banknote'], ['revenu', 'money_with_wings'],
  ['gagn', 'money_bag'], ['paie', 'credit_card'], ['cash', 'money_bag'], ['million', 'money_bag'], ['mille', 'money_bag'],
  ['banqu', 'bank'], ['compte', 'bank'], ['carte', 'credit_card'], ['paiement', 'credit_card'], ['piece', 'coin'], ['credit', 'coin'],
  ['croiss', 'chart_increasing'], ['augment', 'chart_increasing'], ['monte', 'chart_increasing'], ['progress', 'chart_increasing'],
  ['hausse', 'chart_increasing'], ['scale', 'chart_increasing'], ['baisse', 'chart_decreasing'], ['chute', 'chart_decreasing'],
  ['diminu', 'chart_decreasing'], ['statis', 'bar_chart'], ['resultat', 'bar_chart'], ['chiffre', 'bar_chart'], ['donnee', 'bar_chart'], ['courbe', 'chart_increasing'],
  ['temps', 'stopwatch'], ['minute', 'stopwatch'], ['heure', 'alarm_clock'], ['rapid', 'high_voltage'], ['vite', 'high_voltage'],
  ['chrono', 'stopwatch'], ['seconde', 'stopwatch'], ['jour', 'calendar'], ['semaine', 'spiral_calendar'], ['planning', 'spiral_calendar'],
  ['fusee', 'rocket'], ['lance', 'rocket'], ['decoll', 'rocket'], ['boost', 'rocket'], ['demarr', 'rocket'],
  ['feu', 'fire'], ['viral', 'fire'], ['tendance', 'fire'], ['explos', 'fire'], ['energie', 'high_voltage'], ['puissan', 'high_voltage'],
  ['cerveau', 'brain'], ['intellig', 'brain'], ['apprend', 'brain'], ['reflech', 'thinking_face'], ['pense', 'thinking_face'],
  ['idee', 'light_bulb'], ['astuce', 'light_bulb'], ['solution', 'light_bulb'], ['cible', 'direct_hit'], ['objectif', 'bullseye'], ['precis', 'direct_hit'],
  ['trophe', 'trophy'], ['gagnant', 'trophy'], ['meilleur', 'trophy'], ['champion', 'trophy'], ['victoire', 'trophy'], ['succes', 'trophy'],
  ['etoile', 'glowing_star'], ['premium', 'crown'], ['qualite', 'glowing_star'], ['avis', 'star'], ['parfait', 'hundred_points'], ['total', 'hundred_points'],
  ['ordinateur', 'desktop_computer'], ['logiciel', 'laptop'], ['saas', 'desktop_computer'], ['plateforme', 'laptop'], ['outil', 'hammer_and_wrench'],
  ['appli', 'mobile_phone'], ['site', 'laptop'], ['telephone', 'mobile_phone'], ['mobile', 'mobile_phone'], ['tiktok', 'mobile_phone'],
  ['insta', 'mobile_phone'], ['reseau', 'mobile_phone'], ['story', 'mobile_phone'], ['poste', 'mobile_phone'], ['robot', 'robot'], ['automat', 'robot'],
  ['reglage', 'gear'], ['parametre', 'gear'], ['config', 'gear'], ['moteur', 'gear'], ['cle', 'key'], ['acces', 'key'], ['secret', 'key'],
  ['verrou', 'locked'], ['secur', 'locked'], ['protege', 'locked'], ['debloqu', 'unlocked'], ['lien', 'link'], ['connect', 'link'], ['integr', 'link'],
  ['camera', 'video_camera'], ['video', 'video_camera'], ['film', 'movie_camera'], ['montage', 'clapper_board'], ['micro', 'studio_microphone'],
  ['voix', 'studio_microphone'], ['audio', 'headphone'], ['parl', 'speech_balloon'], ['enregistr', 'microphone'], ['musique', 'musical_note'],
  ['annonce', 'loudspeaker'], ['diffus', 'megaphone'], ['promo', 'megaphone'], ['message', 'speech_balloon'], ['commentaire', 'speech_balloon'],
  ['mail', 'envelope'], ['email', 'envelope'], ['contact', 'envelope'], ['notif', 'bell'], ['alerte', 'bell'], ['rappel', 'bell'],
  ['oeil', 'eyes'], ['regard', 'eyes'], ['vue', 'eyes'], ['visib', 'eyes'], ['attention', 'eyes'], ['coeur', 'red_heart'], ['aime', 'red_heart'],
  ['passion', 'growing_heart'], ['fan', 'growing_heart'], ['communaut', 'busts_in_silhouette'], ['cadeau', 'gift'], ['offre', 'gift'], ['gratuit', 'gift'],
  ['bonus', 'gift'], ['fete', 'party_popper'], ['celebr', 'party_popper'], ['nouveau', 'sparkles'], ['magi', 'magic_wand'], ['transform', 'magic_wand'],
  ['brillant', 'sparkles'], ['incroyable', 'sparkles'], ['livre', 'books'], ['formation', 'open_book'], ['cours', 'open_book'], ['guide', 'open_book'],
  ['script', 'memo'], ['texte', 'memo'], ['ecri', 'memo'], ['redig', 'memo'], ['contenu', 'memo'], ['catalogue', 'bookmark_tabs'], ['modele', 'bookmark_tabs'],
  ['puzzle', 'puzzle_piece'], ['assembl', 'puzzle_piece'], ['combin', 'puzzle_piece'], ['construis', 'hammer_and_wrench'], ['build', 'hammer_and_wrench'],
  ['coupe', 'scissors'], ['decoup', 'scissors'], ['clip', 'scissors'], ['panier', 'shopping_cart'], ['achat', 'shopping_cart'], ['vente', 'shopping_cart'],
  ['boutique', 'shopping_cart'], ['ecommerce', 'shopping_cart'], ['produit', 'package'], ['colis', 'package'], ['livraison', 'package'],
  ['couronne', 'crown'], ['leader', 'crown'], ['elite', 'crown'], ['partenaire', 'handshake'], ['deal', 'handshake'], ['collab', 'handshake'],
  ['accord', 'handshake'], ['rejoins', 'handshake'], ['client', 'busts_in_silhouette'], ['utilisateur', 'busts_in_silhouette'], ['gens', 'busts_in_silhouette'],
  ['audience', 'busts_in_silhouette'], ['futur', 'crystal_ball'], ['avenir', 'crystal_ball'], ['recycl', 'recycling_symbol'], ['boucle', 'recycling_symbol'],
  ['repet', 'recycling_symbol'], ['valide', 'check_mark_button'], ['reussi', 'check_mark_button'], ['erreur', 'cross_mark'], ['stop', 'cross_mark'],
  ['jamais', 'cross_mark'], ['evit', 'cross_mark'], ['probleme', 'warning'], ['piege', 'warning'], ['danger', 'warning'], ['important', 'red_exclamation_mark'],
  ['pourquoi', 'question_mark'], ['comment', 'question_mark'], ['cherch', 'magnifying_glass_tilted_left'], ['trouv', 'magnifying_glass_tilted_left'],
  ['analys', 'magnifying_glass_tilted_left'], ['decouvr', 'magnifying_glass_tilted_left'], ['sauvegard', 'floppy_disk'], ['batterie', 'battery'],
  ['voyage', 'airplane'], ['vacances', 'beach_with_umbrella'], ['detente', 'beach_with_umbrella'], ['chill', 'beach_with_umbrella'], ['passif', 'beach_with_umbrella'],
  ['photo', 'camera'], ['image', 'camera'],
]
// Lexique mot→ANIMATION. Ces six animations-la sont GENERIQUES (elles ne parlent pas
// d'AvatarAds) donc elles marchent sur n'importe quel script. Elles sont testees AVANT
// les emojis : a moment egal, une animation vaut mieux qu'un emoji — elle dure, elle
// raconte, elle occupe le cadre. L'emoji reste le repli quand aucune ne colle.
const ANIM_LEX: [string, string][] = [
  // FILET DE SECURITE uniquement. Les mots-outils (tout, plus, sans, jamais, deja,
  // fois...) ont ete RETIRES : ils declenchaient une animation sans rapport — un
  // champ de mot de passe sur « visage » parce que « jamais » pointait vers lock.
  // Le CHOIX revient au chef d'orchestre, qui comprend le sens ; ce lexique ne
  // sert plus qu'a combler un trou quand un mot est sans ambiguite.
  ['liste', 'list'], ['catalogue', 'list'], ['bibliotheque', 'list'], ['modele', 'list'], ['script', 'list'], ['choix', 'list'], ['croiss', 'grow'], ['augment', 'grow'], ['monte', 'grow'], ['progress', 'grow'], ['hausse', 'grow'], ['scale', 'grow'], ['resultat', 'grow'], ['courbe', 'grow'], ['vues', 'grow'], ['abonne', 'grow'], ['temps', 'clock'], ['minute', 'clock'], ['heure', 'clock'], ['seconde', 'clock'], ['rapid', 'clock'], ['vite', 'clock'], ['chrono', 'clock'], ['avant', 'compare'], ['apres', 'compare'], ['difference', 'compare'], ['versus', 'compare'], ['compar', 'compare'], ['contraire', 'compare'], ['tiktok', 'phone'], ['insta', 'phone'], ['reels', 'phone'], ['shorts', 'phone'], ['telephone', 'phone'], ['vertical', 'phone'], ['feed', 'phone'], ['ecri', 'type'], ['redig', 'type'], ['texte', 'type'], ['tape', 'type'], ['genere', 'type'], ['sous-titre', 'type'], ['soustitre', 'type'], ['argent', 'money'], ['euro', 'money'], ['dollar', 'money'], ['revenu', 'money'], ['gagn', 'money'], ['paie', 'money'], ['prix', 'money'], ['cash', 'money'], ['million', 'money'], ['mille', 'money'], ['gratuit', 'money'], ['cout', 'money'], ['tarif', 'money'], ['budget', 'money'], ['idee', 'idea'], ['astuce', 'idea'], ['solution', 'idea'], ['secret', 'idea'], ['methode', 'idea'], ['truc', 'idea'], ['comprend', 'idea'], ['cible', 'target'], ['objectif', 'target'], ['precis', 'target'], ['but', 'target'], ['exact', 'target'], ['pile', 'target'], ['secur', 'lock'], ['protege', 'lock'], ['prive', 'lock'], ['verrou', 'lock'], ['acces', 'lock'], ['cle', 'lock'], ['debloqu', 'lock'], ['cherch', 'search'], ['trouv', 'search'], ['analys', 'search'], ['decouvr', 'search'], ['repere', 'search'], ['detect', 'search'], ['lance', 'rocket'], ['decoll', 'rocket'], ['demarr', 'rocket'], ['boost', 'rocket'], ['explos', 'rocket'], ['viral', 'rocket'], ['propuls', 'rocket'], ['reseau', 'network'], ['connect', 'network'], ['communaut', 'network'], ['partage', 'network'], ['relie', 'network'], ['ensemble', 'network'], ['valide', 'check'], ['reussi', 'check'], ['fait', 'check'], ['termine', 'check'], ['fini', 'check'], ['marche', 'check'], ['parfait', 'check'], ['simple', 'check'], ['facile', 'check'], ['inclus', 'check'], ['video', 'phone'], ['clip', 'phone'], ['short', 'phone'], ['post', 'phone'], ['publi', 'phone'], ['contenu', 'phone'], ['compte', 'network'], ['abonne', 'network'], ['follow', 'network'], ['public', 'network'], ['monde', 'network'], ['client', 'network'], ['outil', 'idea'], ['app', 'idea'], ['logiciel', 'idea'], ['plateforme', 'idea'], ['system', 'idea'], ['fonctionn', 'idea'], ['creer', 'type'], ['produi', 'type'], ['constru', 'type'], ['prompt', 'type'], ['test', 'search'], ['essai', 'search'], ['essaie', 'search'], ['regarde', 'search'], ['jour', 'clock'], ['semaine', 'clock'], ['mois', 'clock'], ['annee', 'clock'], ['premier', 'target'], ['meilleur', 'target'], ['top', 'target'], ['numero', 'target'], ['unique', 'target'], ['nouveau', 'rocket'], ['commence', 'rocket'], ['grandi', 'rocket'], ['plusieurs', 'list'], ['options', 'list'], ['different', 'list'], ['double', 'grow'], ['triple', 'grow'], ['econom', 'clock'], ['gagne', 'clock'], ['perd', 'clock'], ['libre', 'clock'], ['dispo', 'clock'], ['24', 'clock'], ['illimit', 'grow'], ['autant', 'grow'], ['volume', 'grow'], ['masse', 'grow'], ['serie', 'grow'], ['chaine', 'grow'], ['personnalis', 'idea'], ['adapt', 'idea'], ['sur-mesure', 'idea'], ['choisi', 'idea'], ['controle', 'idea'], ['libert', 'idea'], ['qualite', 'target'], ['pro', 'target'], ['net', 'target'], ['propre', 'target'], ['impec', 'target'], ['4k', 'target'], ['auto', 'check'], ['clic', 'check'], ['instant', 'check'], ['immediat', 'check'], ['anonym', 'lock'], ['discret', 'lock'], ['cache', 'lock'], ['partout', 'network'], ['toutes', 'network'], ['multi', 'network'], ['plateformes', 'network'], ['audience', 'network'], ['essaye', 'search'], ['decouvre', 'search'], ['compare', 'search'], ['choisis', 'search'], ['viral', 'rocket'],
  ['perce', 'rocket'], ['exploser', 'rocket'], ['carton', 'rocket'], ['succes', 'rocket'],
  // QUINZE ANIMATIONS N'AVAIENT AUCUNE ENTREE : avatar, faceless, split, voice,
  // swipe, views, engage, calendar, upload, stack, swap, cut, steps, toggle, logo.
  // Le remplissage ne pouvait donc jamais les poser, quel que soit le script — c'est
  // ce qui laissait des phrases entieres sans rien.
  ['avatar', 'avatar'], ['personnage', 'avatar'], ['perso', 'avatar'], ['humain', 'avatar'],
  ['visage', 'faceless'], ['anonym', 'faceless'], ['camera', 'faceless'], ['filmer', 'faceless'], ['montrer', 'faceless'],
  ['split', 'split'], ['gameplay', 'split'], ['ecran', 'split'], ['cote', 'split'],
  ['voix', 'voice'], ['clon', 'voice'], ['audio', 'voice'], ['parle', 'voice'], ['micro', 'voice'], ['son', 'voice'],
  ['scroll', 'swipe'], ['defil', 'swipe'], ['fil', 'swipe'],
  ['vue', 'views'], ['portee', 'views'], ['personnes', 'views'], ['millier', 'views'],
  ['commentaire', 'engage'], ['like', 'engage'], ['reaction', 'engage'], ['engagement', 'engage'], ['aiment', 'engage'],
  ['regulier', 'calendar'], ['quotidien', 'calendar'], ['planning', 'calendar'], ['constan', 'calendar'],
  ['publi', 'upload'], ['poste', 'upload'], ['ligne', 'upload'], ['envoi', 'upload'], ['diffus', 'upload'],
  ['dizaine', 'stack'], ['batch', 'stack'], ['quantite', 'stack'], ['enchain', 'stack'],
  ['remplace', 'swap'], ['lieu', 'swap'], ['place', 'swap'], ['change', 'swap'], ['switch', 'swap'],
  ['montage', 'cut'], ['coupe', 'cut'], ['edit', 'cut'], ['decoup', 'cut'], ['monte', 'cut'],
  ['etape', 'steps'], ['suffit', 'steps'], ['ensuite', 'steps'], ['process', 'steps'], ['tuto', 'steps'],
  ['active', 'toggle'], ['bouton', 'toggle'], ['allume', 'toggle'], ['branch', 'toggle'], ['parametr', 'toggle'],
]
const STOP_FILL = new Set(['pour', 'avec', 'dans', 'tout', 'tous', 'plus', 'sans', 'cette', 'votre', 'notre', 'vous', 'nous', 'mais', 'donc', 'alors', 'meme', 'chaque', 'etre', 'cest', 'quand', 'comme', 'fait', 'faire', 'que', 'qui', 'les', 'des', 'une', 'est', 'son', 'ses', 'ton', 'tes'])
function emojiForWord(w: string): string {
  const k = norm(w)
  if (k.length < 3 || STOP_FILL.has(k)) return ''
  for (const [stem, emo] of EMOJI_LEX) if (k.startsWith(stem)) return emo
  return ''
}
function animForWord(w: string): string {
  const k = norm(w)
  if (k.length < 3 || STOP_FILL.has(k)) return ''
  for (const [stem, an] of ANIM_LEX) if (k.startsWith(stem)) return an
  return ''
}

// `strict` distingue deux familles de filtres. Les contraintes PHYSIQUES (chevauchements,
// safe zone, durees, ids d'assets connus) s'appliquent toujours : sans elles le rendu casse.
// Les filtres de GOUT (seuil de deliberation, garde-fou anti-invention, verrou des bruitages)
// sautent en mode 'low' — c'est le seul moyen de voir ce que le chef d'orchestre PROPOSE
// vraiment, sans mes reglages par-dessus.
export function validatePlan(plan: Plan, duration: number, assetIds: string[], words: Word[] = [], brief = '', strict = true, brand = ''): Plan {
  const D = duration
  const sections = (plan.sections || [])
    .map((s) => ({ ...s,
      role: SECTION_ROLES.includes(String(s.role || '')) ? String(s.role) : 'benefice',
      start: r2(clamp(s.start, 0, D)), end: r2(clamp(s.end, 0, D)), label: String(s.label || '').slice(0, 60) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)

  // slides d'abord : hook (~debut) et CTA (~fin) restent en full ecran
  const SPLIT_TYPES = ['flow', 'checklist', 'compare', 'stat', 'card']
  const FULL_TYPES = ['nodes', 'loop', 'bars', 'kpi', 'timer', 'versus', 'punch']
  const SLIDE_TYPES = [...SPLIT_TYPES, ...FULL_TYPES, 'banner']
  const txt = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)
  const slideMin = Math.min(2, r2(D * 0.2))
  const slideMax = Math.max(slideMin + 1, r2(D - 2))
  const slides = (plan.slides || [])
    .map((s) => {
      const type = SLIDE_TYPES.includes(String(s.type || '')) ? String(s.type) : ''
      // le layout se deduit du type si l'IA l'a oublie (ou l'a mis en contradiction)
      const layout = type === 'banner' ? 'banner' : FULL_TYPES.includes(type) ? 'full' : 'split'
      // #131 · motif d'animation : on ne laisse passer que la liste connue du rendu
      const MOTIFS = ['chain', 'tiles', 'versus', 'bars', 'ring', 'cloud', 'halftone', 'grid']
      const motif = MOTIFS.includes(String(s.motif || '')) ? String(s.motif) : ''
      const anim = ANIMS.includes(String(s.anim || '')) ? String(s.anim) : ''
      const emoji = EMOJIS.includes(String(s.emoji || '')) ? String(s.emoji) : ''
      return {
        type,
        layout,
        motif,
        anim,
        emoji,
        // un bandeau peut se poser des la 1re seconde (la video reste visible dessous)
        start: r2(clamp(s.start, layout === 'banner' ? 0.3 : slideMin, D)),
        end: r2(clamp(s.end, 0, layout === 'banner' ? r2(D - 0.3) : slideMax)),
        title: txt(s.title, 60).toUpperCase(),
        eyebrow: txt(s.eyebrow, 34).toUpperCase(),
        accent: txt(s.accent, 30).toUpperCase(),
        sub: txt(s.sub, 70),
        center: txt(s.center, 14).toUpperCase(),
        value: txt(s.value, 12),
        unit: txt(s.unit, 26).toUpperCase(),
        wide: !!s.wide,
        // deliberation du chef d'orchestre : "type|layout|score|pourquoi" -> objet
        options: (Array.isArray(s.options) ? s.options : []).slice(0, 4)
          .map((line) => {
            const [ty, la, sc, ...rest] = String(line || '').split('|')
            return {
              type: txt(ty, 20).toLowerCase(), layout: txt(la, 10).toLowerCase(),
              score: Math.round(clamp(Number(sc) || 0, 0, 100)), why: txt(rest.join('|'), 90),
            }
          })
          .filter((o) => [...SLIDE_TYPES, 'fullscreen'].includes(o.type))
          .sort((x, y) => y.score - x.score),
        items: (Array.isArray(s.items) ? s.items : []).slice(0, 8)
          .map((it) => ({
            text: txt(it.text, 60).toUpperCase(),
            t: r2(clamp(it.t, 0, D)),
            value: txt(it.value, 12),
            label: txt(it.label, 26).toUpperCase(),
          }))
          .filter((it) => it.text.trim()),
      }
    })
    // Un bandeau n'a pas d'items ; les autres en exigent au moins un — SAUF une scene
    // qui porte une animation fabriquee (#135) : elle se suffit a elle-meme, son visuel
    // ne vient pas de son texte. Sans cette exception, toutes les animations pures
    // (split, faceless, logo...) etaient jetees ici et la video repartait quasi vide.
    .filter((s) => SLIDE_TYPES.includes(s.type) && s.end > s.start + 0.5
      && (s.layout === 'banner' ? !!s.title : (s.items.length > 0 || !!s.anim || !!s.emoji)))
    .filter((s) => s.layout !== 'full' || s.items.length > 0 || !!s.anim || !!s.emoji || ['kpi', 'timer'].includes(s.type))
    // seuil de deliberation : sous 55/100, le moment ne merite pas de traitement (plein ecran)
    // Le seuil de deliberation ne s'applique PLUS aux animations : il a ete ecrit
    // pour un style ou une scene interrompait une video de visage, et il faisait
    // jeter les animations que le modele proposait. Ici l'animation EST la video.
    .filter((s) => !strict || s.anim || !s.options.length || s.options[0].score >= 55)
    .sort((a, b) => a.start - b.start)
    .slice(0, strict ? 24 : 40)
  // ── GARDE-FOU ANTI-INVENTION ────────────────────────────────────────────────
  // Une scene doit parler de ce que l'utilisateur dit A CE MOMENT-LA : au moins un
  // mot significatif de la scene doit avoir ete REELLEMENT prononce dans sa fenetre
  // (+/- 1.5 s). Sinon c'est du contenu invente ou mal cale -> on la jette (on revient
  // en plein ecran, ce qui est toujours un choix valable).
  const STOP = new Set(['pour', 'avec', 'dans', 'tout', 'tous', 'toute', 'plus', 'sans', 'cette', 'votre', 'notre', 'vous', 'nous', 'mais', 'donc', 'alors', 'meme', 'chaque', 'faire', 'fait', 'etre', 'cest', 'quand', 'comme', 'alors'])
  const keys = (s: string) => String(s || '').split(/\s+/).map(norm)
    .filter((k) => (k.length >= 4 && !STOP.has(k)) || /^\d+$/.test(k))
  const spokenAround = (a: number, b: number) => {
    const set = new Set<string>()
    for (const w of words) if (w.end > a - 1.5 && w.start < b + 1.5) { const k = norm(w.text); if (k.length > 2) set.add(k) }
    return set
  }
  // les mots du BRIEF sont autorises a l'ecran : c'est l'utilisateur lui-meme qui les fournit
  const briefKeys = new Set(keys(brief))
  const echoesScript = (s: typeof slides[number]) => {
    if (!words.length) return true
    const mine = [s.title, s.value, s.unit, s.sub, s.center, ...s.items.flatMap((it) => [it.text, it.value, it.label])]
      .flatMap(keys)
    if (!mine.length) return true
    const said = spokenAround(s.start, s.end)
    return mine.some((k) => briefKeys.has(k) || said.has(k)
      // meme racine (pluriel/conjugaison) : 5 premieres lettres communes — PAS une simple
      // inclusion, sinon "forfaits" matcherait "fait" et laisserait passer une invention
      || [...said].some((w) => (w.length >= 5 && k.length >= 5
        && (w.startsWith(k.slice(0, 5)) || k.startsWith(w.slice(0, 5)))) || sim(w, k) >= 0.82))
  }
  const grounded = strict ? slides.filter(echoesScript) : slides
  slides.length = 0
  slides.push(...grounded)

  // les scenes qui occupent le cadre (split + plein cadre) ne peuvent pas se chevaucher ;
  // les bandeaux vivent sur une couche a part (poses sur la video plein ecran)
  const visual = slides.filter((s) => s.layout !== 'banner')
  for (let i = 1; i < visual.length; i++) {
    if (visual[i].start < visual[i - 1].end) visual[i - 1].end = r2(Math.max(visual[i - 1].start + 0.5, visual[i].start))
  }
  for (const s of slides) {
    for (const it of s.items) it.t = r2(clamp(it.t, s.start, Math.max(s.start, s.end - 0.2)))
    s.items.sort((a, b) => a.t - b.t)
  }
  // un bandeau n'a de sens que sur du plein ecran : on jette ceux qui tombent sur une autre scene
  const cleanSlides = slides.filter((s) => s.layout !== 'banner'
    || !visual.some((v) => s.start < v.end + 0.2 && s.end > v.start - 0.2))
  slides.length = 0
  slides.push(...cleanSlides.sort((a, b) => a.start - b.start))

  const inSlide = (t: number, margin = 0.5) => slides.some((s) => s.layout !== 'banner' && t >= s.start - margin && t <= s.end + margin)

  const broll = (plan.broll || [])
    .filter((b) => assetIds.includes(b.assetId))
    .map((b) => ({ assetId: b.assetId, feature: String(b.feature || ''), start: r2(clamp(b.start, 1.5, D)), end: r2(clamp(b.end, 0, Math.max(0, D - 0.5))) }))
    .map((b) => ({ ...b, end: r2(clamp(b.end, b.start + 1.0, b.start + 4.0)) }))
    .filter((b) => b.end > b.start && b.end <= D)
    // VERROU · une image ne sert qu'a PRESENTER UNE FONCTIONNALITE : il la nomme, on
    // montre a quoi elle ressemble. Elle doit donc declarer laquelle, et ces mots-la
    // doivent etre REELLEMENT prononces dans sa fenetre. Sinon c'est une capture posee
    // sur une promesse ou une transition — la ou une animation parle mieux et reste
    // dans la direction artistique du style. Filtre de gout : saute en mode 'low'.
    .filter((b) => {
      if (!strict || !words.length) return true
      const mine = keys(b.feature)
      if (!mine.length) return false
      const said = spokenAround(b.start, b.end)
      return mine.some((k) => said.has(k) || [...said].some((w) => sim(w, k) >= 0.82))
    })
    // jamais pendant une slide (la zone haute est occupee)
    .filter((b) => !slides.some((s) => b.start < s.end + 0.3 && b.end > s.start - 0.3))
    .sort((a, b) => a.start - b.start)
  // pas de chevauchement entre b-rolls
  for (let i = 1; i < broll.length; i++) {
    if (broll[i].start < broll[i - 1].end) broll[i].start = r2(broll[i - 1].end + 0.2)
  }
  const cleanBroll = broll.filter((b) => b.end > b.start)

  const inBroll = (t: number) => cleanBroll.some((b) => t >= b.start - 0.2 && t <= b.end + 0.2)
  const zooms = (plan.zooms || [])
    .map((z) => ({
      t: r2(clamp(z.t, 0, D - 0.4)),
      dur: r2(clamp(z.dur, 0.4, 1.6)),
      scale: r2(clamp(z.scale, 1.1, 1.4)),
      cx: r2(clamp(z.cx, 0.15, 0.85)),
      cy: r2(clamp(z.cy, 0.15, 0.85)),
    }))
    .filter((z) => !inBroll(z.t) && !inSlide(z.t))
    .sort((a, b) => a.t - b.t)
    .filter((z, i, arr) => i === 0 || z.t - arr[i - 1].t >= 0.8)

  // #125 · le ton commande le registre sonore. « fun » doit etre EXPLICITE : tout ce qui
  // n'est pas exactement 'fun' retombe sur 'neutre' (defaut sur), et les sons comiques
  // sautent. C'est un filtre, pas une consigne : le modele ne peut pas passer outre.
  const tone = plan.tone === 'fun' ? 'fun' : 'neutre'
  let funLeft = tone === 'fun' ? 2 : 0   // 2 sons fun maximum sur toute la video
  const sfx = (plan.sfx || [])
    .filter((s) => SFX_KINDS.includes(s.kind))
    .map((s) => ({ kind: s.kind, t: r2(clamp(s.t, 0, D - 0.1)) }))
    .sort((a, b) => a.t - b.t)
    .filter((s, i, arr) => i === 0 || s.t - arr[i - 1].t >= 1.2)
    .filter((s) => {
      if (!SFX_FUN.includes(s.kind)) return true
      // un son comique ne se pose ni sur l'accroche, ni par-dessus une slide qui delivre
      // une info, ni colle a un autre son comique
      if (funLeft <= 0 || s.t < 1 || inSlide(s.t, 0.3)) return false
      funLeft--
      return true
    })
    .slice(0, Math.ceil(D / 1.5))
  // ecart minimum de 3s entre deux sons fun (deux gags colles = effet lourd)
  const funPlaced: number[] = []
  const sfxClean = sfx.filter((s) => {
    if (!SFX_FUN.includes(s.kind)) return true
    if (funPlaced.some((t) => Math.abs(t - s.t) < 3)) return false
    funPlaced.push(s.t)
    return true
  })

  // lits musicaux : 1 maximum, jamais sur une video neutre, jamais dans la derniere seconde
  const beds = tone === 'fun'
    ? (plan.beds || [])
      .filter((b) => BED_NAMES.includes(b.name))
      .map((b) => ({ name: b.name, t: r2(clamp(b.t, 0, Math.max(0, D - 1))) }))
      .sort((a, b) => a.t - b.t)
      .slice(0, 1)
    : []

  let hook = plan.hook || null
  if (hook) {
    hook = {
      text: String(hook.text || '').toUpperCase().slice(0, 42),
      start: r2(clamp(hook.start, 0, 1)),
      end: r2(clamp(hook.end, 1, Math.min(3.5, D))),
    }
    if (!hook.text.trim()) hook = null
  }

  const accents = (plan.accents || []).map((a) => String(a)).filter(Boolean).slice(0, 14)
  const music = (plan.music && ['intense', 'dynamique', 'chill'].includes(String(plan.music.mood)))
    ? { mood: String(plan.music.mood) } : null

  // anti-doublon : si la 1re slide est une card qui reprend le hook, on retire le hook
  if (hook && slides.length && slides[0].type === 'card' && slides[0].start < 1.5) {
    const a = norm(hook.text), b = norm(slides[0].items[0]?.text || '')
    if (a && b && (a.includes(b) || b.includes(a) || sim(a, b) >= 0.55)) hook = null
  }

  const face = (plan.face && typeof plan.face.cy === 'number') ? { cy: r2(clamp(plan.face.cy, 0.1, 0.9)) } : null
  const detected = { subtitles: !!(plan.detected && plan.detected.subtitles) }

  // #119 scenes avatar : portrait = plein ecran (hors slides), paysage = sous une slide.
  // Un segment du mauvais cote est reclasse ; chevauchements fusionnes par format.
  // "paysage" = sous une slide SPLIT uniquement (un bandeau laisse la video plein ecran)
  const inSplitSlide = (a: { start: number; end: number }) => slides.some((s) => s.layout === 'split' && a.start < s.end && a.end > s.start)
  // une scene PLEIN CADRE masque la video : inutile de payer un lipsync dessous
  const hiddenByFull = (a: { start: number; end: number }) => slides.some((s) =>
    s.layout === 'full' && a.start >= s.start - 0.15 && a.end <= s.end + 0.15)
  const avatarSegments: { start: number; end: number; format: string }[] = []
  for (const a of (plan.avatarSegments || [])
    .map((a) => ({
      start: r2(clamp(a.start, 0, D)), end: r2(clamp(a.end, 0, D)),
      format: a.format === 'paysage' ? 'paysage' : 'portrait',
    }))
    .filter((a) => a.end > a.start + 0.4)
    .filter((a) => !hiddenByFull(a))
    .map((a) => ({ ...a, format: inSplitSlide(a) ? 'paysage' : 'portrait' }))
    .sort((a, b) => a.start - b.start)) {
    const last = avatarSegments[avatarSegments.length - 1]
    if (last && a.start <= last.end + 0.1 && last.format === a.format) last.end = Math.max(last.end, a.end)
    else avatarSegments.push({ ...a })
  }

  // Un bruitage SOULIGNE quelque chose. S'il tombe sur un instant ou rien ne bouge
  // a l'ecran, il sonne comme une erreur de montage — c'est ce qu'Axel a entendu sur
  // les premiers essais. On ne garde donc que ceux qui coincident (+/- 0.35s) avec un
  // evenement visuel reel. Verrou serveur : la consigne seule ne suffisait pas.
  // Ne comptent QUE les evenements qu'on voit vraiment APPARAITRE. Avant, cette liste
  // contenait aussi les frontieres de section, les segments avatar, le hook et les
  // zooms : en mode mot-a-mot rien de tout ca ne rend quoi que ce soit (la video est
  // masquee), donc un bruitage tombait sur un ecran immobile — le son sans image
  // qu'Axel entend. On garde l'APPARITION d'une slide qui porte un visuel et
  // l'apparition d'une image ; leur fin ne compte pas non plus, rien n'y « arrive ».
  const visualEvents = [
    ...cleanBroll.map((b) => b.start),
    ...slides.filter((sl) => sl.emoji || sl.anim || (sl.items || []).length || sl.title)
      .flatMap((sl) => [sl.start, ...(sl.items || []).map((it) => it.t)]),
  ].filter((t) => typeof t === 'number')
  let sfxOnEvent = strict
    ? sfxClean.filter((x) => visualEvents.some((e) => Math.abs(e - x.t) <= 0.35))
    : sfxClean
  // Aucun visuel dans la video => aucun bruitage. Un son seul sur une page fixe
  // s'entend comme une erreur de montage.
  if (strict && !visualEvents.length) sfxOnEvent = []
  // TROIS SONS DIFFERENTS AU MAXIMUM, MAIS REUTILISABLES. Chaque moment souligne
  // merite son bruitage — ce qui gachait la video, ce n'etait pas leur NOMBRE mais
  // le fait d'en entendre huit DIFFERENTS : l'oreille n'y reconnaissait aucune
  // intention. Une palette de trois, en rotation, produit l'inverse : une signature
  // sonore. Le premier son est celui que le modele a choisi, les deux autres
  // viennent de la rotation neutre ; on alterne pour ne jamais repeter deux fois de
  // suite le meme.
  const SFX_ROTATION = ['pop', 'ding', 'snap', 'click', 'success', 'magic', 'hit', 'boom']
  if (sfxOnEvent.length) {
    const first = sfxOnEvent[0].kind
    const palette = [first, ...SFX_ROTATION.filter((k) => k !== first)].slice(0, 3)
    sfxOnEvent = sfxOnEvent.map((x, i) => ({ ...x, kind: palette[i % palette.length] }))
  }

  // ── GARANTIE DE CADENCE (#135) ──────────────────────────────────────────────
  // La reference (Thinks) pose un visuel toutes les ~2,5s. Le modele n'en met que
  // 4 a 6 : demander la densite dans le prompt ne suffit pas (comme le reste). Le
  // serveur comble donc les trous lui-meme, avec un emoji pose sur un mot fort du
  // creux — mot choisi par le lexique, sans nouvel appel modele. Deterministe.
  {
    // Pas de cadence mecanique : on illustre QUAND l'audio le demande. Le pas de 3s
    // n'est qu'un espacement MINIMUM entre deux visuels — le remplissage ne pose une
    // animation que si un mot du creux la justifie vraiment (lexique). Un moment qui
    // n'evoque rien reste nu, et c'est tres bien.
    // LE PLUS DENSE POSSIBLE. Axel : « oublie l'espacement, le but c'est le truc le
    // plus dynamique possible ». Le lexique est desormais purge des mots-outils, donc
    // chaque correspondance est fiable : on peut poser serre sans risquer le
    // contresens. 1,6 s = juste de quoi ne pas empiler deux animations.
    const TARGET = 1.15  // vise 85-90 % de couverture : une animation par groupe de mots
    // Les IMAGES ne bloquent plus. Le style mot-a-mot ne les affiche pas (0 image par
    // defaut), mais elles restaient dans le plan et rendaient leurs instants
    // « occupes » : l'ecran etait vide ET l'animation refusee. C'est ce qui privait
    // « generation de ton premier avatar », « sous-titres » et « split screen » de
    // toute animation — les trois moments ou le modele avait justement pose une image.
    const occupied = (t: number) =>
      slides.some((sl) => (sl.emoji || sl.anim) && t >= sl.start - 0.2 && t < sl.end + 0.2)
    // instants deja couverts par un visuel (slide portant emoji/anim, ou image)
    const visualStarts = [
      ...slides.filter((sl) => sl.emoji || sl.anim).map((sl) => sl.start),
      ...cleanBroll.map((b) => b.start),
    ].sort((a, b) => a - b)
    const usedAnims = new Set(slides.filter((sl) => sl.anim).map((sl) => sl.anim as string))
    // CONVERSION EMOJI → ANIMATION. Le modele pose des emojis de lui-meme ; comme le
    // remplissage ne touche que les TROUS, ces emojis-la restaient et plombaient le
    // ratio (Axel veut 99% d'animations). On regarde donc les mots prononces pendant
    // chaque emoji : si une animation dit la meme chose et n'a pas servi, elle prend
    // sa place. L'emoji ne survit que si aucune animation ne couvre son moment.
    for (const sl of slides) {
      if (!sl.emoji || sl.anim) continue
      const said = words.filter((w) => w.start >= sl.start - 0.4 && w.start < sl.end + 0.4)
      const hit = said.map((w) => animForWord(w.text)).find((a) => a && !usedAnims.has(a))
      if (hit) { sl.anim = hit; sl.emoji = ''; usedAnims.add(hit) }
    }
    // PASSAGE UNIQUE SUR TOUTE LA TIMELINE. L'ancienne version travaillait « trou par
    // trou » entre les scenes du modele, et un defaut de cette machinerie laissait des
    // pans entiers sans rien : sur l'audio de test, avatar@13,9 / type@15,4 /
    // split@20,8 / voice@23,2 etaient tous dans le lexique ET dans le transcript, et
    // aucun n'etait pose. On balaie donc les mots dans l'ordre, une seule fois, et on
    // pose des qu'un mot correspond a une animation encore libre.
    // DEUX PASSES. Avant, chaque animation durait 2 s en dur et « occupait » la suite :
    // « sous-titres » tombait dans la fenetre de l'animation avatar et etait donc
    // ignore — d'ou une animation sans rapport a cet instant. Maintenant on repere
    // d'abord TOUS les mots qui appellent une animation, puis on fait durer chacune
    // jusqu'a la suivante. Rien ne bloque plus rien, et l'ecran reste occupe.
    // index des « beats » proposes par le chef d'orchestre : mot normalise -> animation
    // Le modele confond les deux banques et repond souvent avec un nom d'EMOJI
    // (clapper_board, money_bag, eyes...). Plutot que de jeter ces lignes — c'est
    // l'essentiel de sa proposition — on les traduit vers l'animation equivalente.
    const EMO2ANIM: Record<string, string> = {
      money_bag: 'money', dollar_banknote: 'money', money_with_wings: 'money', coin: 'money',
      credit_card: 'money', bank: 'money', chart_increasing: 'grow', bar_chart: 'grow',
      eyes: 'views', clapper_board: 'cut', movie_camera: 'cut', video_camera: 'cut',
      camera: 'phone', mobile_phone: 'phone', laptop: 'idea', desktop_computer: 'idea',
      robot: 'avatar', bust_in_silhouette: 'avatar', busts_in_silhouette: 'network',
      light_bulb: 'idea', brain: 'idea', thinking_face: 'idea', crystal_ball: 'idea',
      memo: 'type', open_book: 'list', books: 'list', bookmark_tabs: 'list', puzzle_piece: 'list',
      rocket: 'rocket', fire: 'rocket', high_voltage: 'rocket', party_popper: 'engage',
      alarm_clock: 'clock', stopwatch: 'clock', hourglass_done: 'clock', calendar: 'calendar',
      spiral_calendar: 'calendar', locked: 'lock', unlocked: 'lock', key: 'lock',
      magnifying_glass_tilted_left: 'search', direct_hit: 'target', bullseye: 'target',
      trophy: 'target', crown: 'target', hundred_points: 'check', check_mark_button: 'check',
      cross_mark: 'swap', link: 'network', handshake: 'network', speech_balloon: 'engage',
      red_heart: 'engage', growing_heart: 'engage', megaphone: 'upload', loudspeaker: 'upload',
      package: 'upload', envelope: 'upload', shopping_cart: 'stack', gift: 'money',
      microphone: 'voice', studio_microphone: 'voice', headphone: 'voice', musical_note: 'voice',
      speaker_high_volume: 'voice', gear: 'toggle', hammer_and_wrench: 'toggle', wrench: 'toggle',
      magic_wand: 'toggle', sparkles: 'toggle', recycling_symbol: 'swap', scissors: 'cut',
    }
    const beatMap = new Map<string, string>()
    for (const b of plan.beats || []) {
      const k = norm(String(b.word || ''))
      const raw = String(b.anim || '')
      const a = ANIMS.includes(raw) ? raw : (EMO2ANIM[raw] || '')
      if (k.length >= 3 && a && !beatMap.has(k)) beatMap.set(k, a)
    }
    const beatFor = (t: string) => {
      const k = norm(t)
      if (k.length < 3) return ''
      return beatMap.get(k) || ''
    }
    // ECRANS DE DEMO : le modele designe (mot, ecran, zone) ; le serveur retrouve le
    // timing du mot dans la transcription et applique le cadrage MESURE. Deux zones
    // du meme ecran trop rapprochees (< 1,2 s) deviennent un seul plan avec travelling
    // — deux plans separes n'y tiendraient pas et l'un des deux serait jete.
    const tutoShots: { t: number; screen: string; z: number[]; z2?: number[]; text?: string }[] = []
    // RECHERCHE MONOTONE. Les etapes sont donnees DANS L'ORDRE du script : on ne
    // cherche donc chaque mot qu'APRES le precedent. Sans ca, « image » etait
    // trouve a 4,1 s dans une phrase sans rapport — le plan « Images IA » tombait
    // dans le hook, et il n'en restait plus quand il presentait vraiment le module.
    let from = 0
    for (const tu of plan.tuto || []) {
      const screen = String(tu.screen || '')
      const zone = String(tu.zone || '')
      const rect = TUTO[screen] && TUTO[screen][zone]
      if (!rect) continue
      // Le modele repond souvent par un GROUPE DE MOTS (« format TikTok »,
      // « decrire l'avatar ») alors que la transcription est mot a mot : chercher
      // une correspondance exacte ne trouvait presque rien. On cherche donc la
      // suite de mots, puis a defaut le mot le plus long du groupe (le plus
      // distinctif — « format » plutot que « le »).
      const toks = String(tu.word || '').split(/\s+/).map(norm).filter((x) => x.length >= 3)
      if (!toks.length) continue
      let w: Word | undefined
      let wi = -1
      for (let j = from; j + toks.length <= words.length && !w; j++) {
        if (toks.every((tk, m) => norm(words[j + m].text) === tk)) { w = words[j]; wi = j }
      }
      if (!w) {
        const main = toks.slice().sort((a, b) => b.length - a.length)[0]
        for (let j = from; j < words.length && !w; j++) {
          if (norm(words[j].text) === main) { w = words[j]; wi = j }
        }
      }
      if (!w) continue
      from = wi + 1
      const prev = tutoShots[tutoShots.length - 1]
      // JAMAIS DEUX FOIS LE MEME PLAN : Axel a vu la meme scene revenir a
      // l'identique. Une (ecran, zone) deja montree est ignoree — le modele
      // propose souvent plusieurs mots qui pointent vers la meme case.
      if (tutoShots.some((sh) => sh.screen === screen && (sh.z === rect || sh.z2 === rect))) continue
      if (prev && prev.screen === screen && !prev.z2 && w.start - prev.t < 2.0) prev.z2 = rect
      else tutoShots.push({ t: w.start, screen, z: rect, text: zone.includes('prompt') ? String(tu.text || '').slice(0, 60) : '' })
    }
    for (let i = 0; i < tutoShots.length; i++) {
      const sh = tutoShots[i]
      const start = r2(Math.max(0.2, sh.t - 0.15))
      const nextT = i + 1 < tutoShots.length ? tutoShots[i + 1].t - 0.15 : D
      // 6 s sur un ecran fige, c'est long — Axel : « c'est dommage qu'il reste
      // autant de temps ». On tient 5 s quand du texte s'ecrit (il faut le lire),
      // 3,5 s sinon.
      const nextIsPrompt = i + 1 < tutoShots.length && !!tutoShots[i + 1].text
      // un plan « prompt » a besoin de ses 5 s pour qu'on lise le texte se taper :
      // c'est son voisin qui se raccourcit, pas lui.
      const room = sh.text ? Math.max(nextT, sh.t + 5.2) : (nextIsPrompt ? nextT : nextT)
      const end = r2(Math.min(start + (sh.text ? 5 : 3.5), room - 0.3, D - 0.4))
      // Un plan doit rester lisible, mais Axel enchaine les etapes vite (« tu vas
      // dans Images IA, tu selectionnes photo reel, tu mets le format ») : un seuil
      // trop haut supprimait justement les etapes qu'il reprochait de ne pas voir.
      // 1,3 s suffit pour un simple cadre ; il en faut 3,2 quand du texte s'ecrit.
      if (!sh.text && end <= start + 1.3) continue
      if (sh.text && end <= start + 2.0) continue
      const z = sh.z, z2 = sh.z2
      slides.push({
        type: 'card', layout: 'full', motif: '', anim: 'screen', emoji: '',
        screen: TUTO_FILE[sh.screen] || '', screenText: sh.text || '', start, end,
        screenZoom: 2.1, screenX: z[0], screenY: z[1],
        boxX: z[0], boxY: z[1], boxW: z[2], boxH: z[3],
        ...(z2 ? { screenZoom2: 2.1, screenX2: z2[0], screenY2: z2[1], boxX2: z2[0], boxY2: z2[1], boxW2: z2[2], boxH2: z2[3] } : {}),
        title: '', eyebrow: '', accent: '', sub: '', center: '', value: '', unit: '',
        wide: false, options: [], items: [],
      } as unknown as typeof slides[number])
      usedAnims.add('screen')
    }
    // COMPTEUR AUTOMATIQUE. Axel veut voir « 0 a 3 millions de vues » sur « ca
    // cartonne » et « 0 a 8000 € » sur l'argent. Le modele ne le proposait jamais :
    // on declenche donc nous-memes des qu'un mot de resultat chiffre est prononce
    // ET qu'un nombre est reellement present a cet endroit de l'audio.
    const CU_WORDS = ['million', 'millions', 'vues', 'euros', 'abonnes', 'cartonne', 'cartonnent', 'explose', 'explosent']
    const cand: { t: number; an: string }[] = []
    let lastT = -99
    for (const w of words) {
      // Le HOOK aussi merite ses animations : c'est la ou le spectateur decide de
      // rester. On ne s'interdit plus que la toute premiere demi-seconde.
      if (w.start < 0.5 || w.start > D - 0.9) continue
      if (w.start - lastT < TARGET) continue
      if (occupied(w.start)) continue
      // le modele a designe les mots forts (beats) : ils priment sur le lexique
      let an = beatFor(w.text) || animForWord(w.text)
      if (CU_WORDS.includes(norm(w.text)) && !usedAnims.has('countup')) an = 'countup'
      if (!an || usedAnims.has(an)) continue
      usedAnims.add(an)
      lastT = w.start
      cand.push({ t: w.start, an })
    }
    const added: typeof slides = []
    // LE CHIFFRE DU COMPTEUR VIENT DE CE QU'IL DIT. On lit les mots autour du point
    // de pose : « trois millions de vues » -> 3000000 / vues, « huit mille euros »
    // -> 8000 / €. Sans chiffre trouve, on retombe sur une autre animation.
    const NUM: Record<string, number> = { un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, vingt: 20, trente: 30, cinquante: 50, cent: 100, mille: 1000 }
    const readNumber = (t: number) => {
      const win = words.filter((w) => w.start >= t - 1.2 && w.start <= t + 2.2).map((w) => norm(w.text))
      let n = 0
      for (let i = 0; i < win.length; i++) {
        const w = win[i]
        const digits = w.replace(/[^0-9]/g, '')
        if (digits && !n) n = parseInt(digits, 10)
        else if (NUM[w] && !n) n = NUM[w]
        if (n && (w === 'million' || w === 'millions')) n *= 1000000
        if (n && (w === 'mille' || w === 'milliers')) n *= 1000
      }
      if (!n) return null
      const unit = win.some((w) => w.includes('euro') || w.includes('€')) ? '€'
        : win.some((w) => w.includes('vue')) ? 'vues'
        : win.some((w) => w.includes('abonne')) ? 'abonnés' : ''
      return { value: String(n), unit }
    }
    for (let i = 0; i < cand.length; i++) {
      const nextT = i + 1 < cand.length ? cand[i + 1].t : D
      let cuv: { value: string; unit: string } | null = null
      if (cand[i].an === 'countup') {
        cuv = readNumber(cand[i].t)
        if (!cuv) { cand[i].an = 'grow' }   // rien de chiffre a montrer : on retombe
      }
      // 0,3 s de respiration : a 0,05 s les animations se touchaient et l'oeil ne
      // voyait qu'un flux continu. Il faut un souffle entre deux.
      // Chaque animation tient jusqu'a la suivante (moins la respiration), plafonnee
      // a 4 s. C'est ce qui fait passer la couverture au-dessus des 80 % demandes
      // sans inventer d'animation qui ne correspondrait a rien.
      const end = r2(Math.min(cand[i].t + 4.0, nextT - 0.3, D - 0.4))
      if (end - cand[i].t < 0.55) continue
      added.push({
        type: 'card', layout: 'full', motif: '', anim: cand[i].an, emoji: '',
        start: r2(cand[i].t), end, title: '', eyebrow: '', accent: '', sub: '',
        center: '', value: cuv ? cuv.value : '', unit: cuv ? cuv.unit : '',
        wide: false, options: [], items: [],
      })
    }
    for (const a of added) {
      if (!slides.some((sl) => Math.abs(sl.start - a.start) < 0.7)) slides.push(a)
    }

    // ENTRÉE DE MODULE GARANTIE. Axel : « quand je dis "tu vas aller dans Express",
    // on doit voir le zoom sur Express ». Le modèle proposait cette étape une fois
    // sur deux seulement. On ne lui fait donc plus confiance là-dessus : dès que le
    // NOM d'un module est prononcé et qu'on a sa capture, on pose l'écran nous-mêmes
    // sur sa zone `menu` — sauf si ce moment est déjà couvert par une autre démo.
    {
      const NAMES: Record<string, string[]> = {
        'express': ['express'],
        'images-ia': ['imagesia', 'imageia'],
      }
      for (const [screen, keys] of Object.entries(NAMES)) {
        const rect = TUTO[screen] && TUTO[screen].menu
        if (!rect) continue
        for (let i = 0; i < words.length; i++) {
          const a = norm(words[i].text)
          const two = i + 1 < words.length ? a + norm(words[i + 1].text) : ''
          if (!keys.includes(a) && !keys.includes(two)) continue
          const t = words[i].start
          if (t < 1.0 || t > D - 2.0) continue
          // deja montre a cet instant ? on ne double pas
          if (slides.some((sl) => sl.anim === 'screen' && t >= sl.start - 0.4 && t <= sl.end + 0.4)) break
          const start = r2(Math.max(0.2, t - 0.15))
          const nxt = slides.filter((sl) => sl.start > start).sort((x, y) => x.start - y.start)[0]
          const end = r2(Math.min(start + 3.0, nxt ? nxt.start - 0.3 : D - 0.4, D - 0.4))
          if (end - start < 1.2) break
          // ce qui empiete est raccourci : l'entree de module est un repere, elle prime
          for (let k = slides.length - 1; k >= 0; k--) {
            const sl = slides[k]
            if (sl.end <= start || sl.start >= end) continue
            if (sl.start < start) sl.end = r2(start - 0.2)
            else sl.start = r2(end + 0.2)
            if (sl.end - sl.start < 0.9) slides.splice(k, 1)
          }
          slides.push({
            type: 'card', layout: 'full', motif: '', anim: 'screen', emoji: '',
            screen: TUTO_FILE[screen] || '', screenText: '', start, end,
            screenZoom: 2.1, screenX: rect[0], screenY: rect[1],
            boxX: rect[0], boxY: rect[1], boxW: rect[2], boxH: rect[3],
            title: '', eyebrow: '', accent: '', sub: '', center: '', value: '', unit: '',
            wide: false, options: [], items: [],
          } as unknown as typeof slides[number])
          slides.sort((x, y) => x.start - y.start)
          break
        }
      }
    }

    // LE COMPTEUR PASSE DEVANT. Axel veut voir « 0 -> 8000 € » quand il annonce son
    // chiffre. Or ces moments-la sont justement les plus denses : une animation du
    // modele s'y trouvait deja et le remplissage n'y touchait pas. Un resultat
    // chiffre prononce a voix haute prime sur une illustration generique.
    if (!slides.some((sl) => sl.anim === 'countup')) {
      for (const w of words) {
        if (w.start < 0.8 || w.start > D - 2.0) continue
        if (!CU_WORDS.includes(norm(w.text))) continue
        const num = readNumber(w.start)
        if (!num) continue
        const host = slides.find((sl) => w.start >= sl.start - 0.6 && w.start <= sl.end + 0.6)
        if (host) {
          host.anim = 'countup'; host.emoji = ''
          ;(host as unknown as { value: string; unit: string }).value = num.value
          ;(host as unknown as { value: string; unit: string }).unit = num.unit
        } else {
          slides.push({
            type: 'card', layout: 'full', motif: '', anim: 'countup', emoji: '',
            start: r2(w.start), end: r2(Math.min(w.start + 2.2, D - 0.5)),
            title: '', eyebrow: '', accent: '', sub: '', center: '',
            value: num.value, unit: num.unit, wide: false, options: [], items: [],
          } as unknown as typeof slides[number])
        }
        slides.sort((x, y) => x.start - y.start)
        break
      }
    }
    slides.sort((x, y) => x.start - y.start)

    // AUCUN CHEVAUCHEMENT. Mon remplissage enchaine bien ses propres animations, mais
    // celles du MODELE gardaient leur fin : sur un test, voice (23,16 -> 25,56)
    // englobait toggle (24,2). Deux clips qui se recouvrent sur la meme piste ne
    // s'affichent pas de facon fiable. On coupe donc chaque visuel a l'arrivee du
    // suivant, et on jette ceux qui deviennent trop courts.
    {
      const vis = slides.filter((sl) => sl.anim || sl.emoji).sort((a, b) => a.start - b.start)
      // UN PLAN OU LE TEXTE S'ECRIT NE SE FAIT PAS RABOTER. Sur un test, la demo
      // Images IA tombait de 5 s a 1,3 s parce qu'une animation demarrait dedans :
      // le texte n'avait plus le temps de se taper, donc le bruit du clavier non
      // plus. C'est le voisin qui cede, comme pour le logo.
      const typing = (sl: typeof vis[number]) => sl.anim === 'screen'
        && !!(sl as unknown as { screenText?: string }).screenText
      for (let i = vis.length - 1; i >= 0; i--) {
        if (!typing(vis[i])) continue
        for (const o of vis) {
          if (o === vis[i] || o.start < vis[i].start) continue
          if (o.start < vis[i].end + 0.3) o.start = r2(vis[i].end + 0.3)
        }
      }
      vis.sort((a, b) => a.start - b.start)
      for (let i = 0; i < vis.length - 1; i++) {
        if (typing(vis[i])) continue
        if (vis[i].end > vis[i + 1].start - 0.3) vis[i].end = r2(vis[i + 1].start - 0.3)
      }
      const tooShort = new Set(vis.filter((v) => v.end - v.start < 0.5))
      if (tooShort.size) {
        const keep = slides.filter((sl) => !tooShort.has(sl))
        slides.length = 0
        slides.push(...keep)
      }
    }

    // LE LOGO QUAND IL NOMME SA MARQUE. Le modele l'oublie une fois sur deux : on le
    // pose nous-memes. La transcription deforme souvent le nom (« Avatar Ads »,
    // « avataria »…), d'ou la comparaison par similarite, sur le mot seul ET sur deux
    // mots colles.
    if (brand.length >= 4 && !slides.some((sl) => sl.anim === 'logo')) {
      const bk = norm(brand)
      let at = -1
      for (let i = 0; i < words.length; i++) {
        const a = norm(words[i].text)
        const b = i + 1 < words.length ? a + norm(words[i + 1].text) : ''
        if (sim(a, bk) >= 0.82 || (b && sim(b, bk) >= 0.82)) { at = words[i].start; break }
      }
      if (at >= 1.2 && at < D - 1.2) {
        // LE LOGO EST PRIORITAIRE. Avant, il etait pose puis rabote a zero par le
        // passage anti-chevauchement des qu'une demo tombait au meme moment — Axel
        // ne le voyait donc jamais. On libere sa fenetre : ce qui empiete est
        // raccourci, et supprime si le reste devient trop court pour etre lu.
        const lg = { start: r2(at), end: r2(Math.min(at + 2.0, D - 0.6)) }
        for (let i = slides.length - 1; i >= 0; i--) {
          const sl = slides[i]
          if (sl.end <= lg.start || sl.start >= lg.end) continue
          if (sl.start < lg.start) sl.end = r2(lg.start - 0.2)
          else sl.start = r2(lg.end + 0.2)
          if (sl.end - sl.start < 1.0) slides.splice(i, 1)
        }
        slides.push({
          type: 'card', layout: 'full', motif: '', anim: 'logo', emoji: '',
          start: lg.start, end: lg.end, title: '', eyebrow: '',
          accent: '', sub: '', center: '', value: '', unit: '', wide: false, options: [], items: [],
        })
        slides.sort((x, y) => x.start - y.start)
      }
    }

    // UN BRUITAGE SUR CHAQUE ANIMATION. Axel : « chaque fois qu'il y a une animation,
    // mettre un bruitage ». On repart donc des visuels, pas de ce que le modele a
    // propose : chaque apparition recoit un son, pris dans une palette de trois qui
    // tourne (jamais deux fois le meme d'affilee).
    {
      const PAL = ['whoosh', 'pop', 'ding', 'snap']
      const starts = slides.filter((sl) => sl.anim || sl.emoji).map((sl) => sl.start).sort((a, b) => a - b)
      sfxOnEvent = starts.map((t, i) => ({ kind: PAL[i % PAL.length], t: r2(t) }))
    }

    // RE-VERROUILLAGE DES BRUITAGES. Le verrou plus haut s'applique AVANT ce
    // remplissage : il ne voyait donc pas les animations qu'on vient d'ajouter. On
    // rejoue la regle sur la liste finale — un bruitage ne survit que s'il coincide
    // avec l'APPARITION d'un visuel reel. Pas de visuel a cet instant, pas de son.
    // (les sons viennent d'etre recalcules a partir des visuels eux-memes : ils sont
    // donc alignes par construction, il n'y a plus rien a filtrer ici)
  }

  return { sections, zooms, broll: cleanBroll, beats: plan.beats || [], tuto: plan.tuto || [], sfx: sfxOnEvent, hook, accents, music, slides, face, detected, avatarSegments, tone, beds }
}

// ---------- sous-titres mot-a-mot (texte exact + accents) ----------
// Scribe entend « avataria » pour « AvatarAds », « lypsync » pour « lipsync »… Les noms
// propres de la marque sont connus (fiche + site + brief) : on retablit ceux qui sont
// clairement le meme mot, sans jamais reecrire ce que la personne a reellement dit.
function fixBrandWords(words: Word[], terms: string[]): Word[] {
  const known = [...new Set(terms.map((t) => t.trim()).filter(Boolean))]
    .map((t) => ({ t, k: norm(t) }))
    .filter((x) => x.k.length >= 5)
  if (!known.length) return words
  return words.map((w) => {
    const k = norm(w.text)
    if (k.length < 5) return w
    for (const { t, k: tk } of known) {
      if (k === tk) return w                      // deja ecrit correctement
      if (sim(k, tk) >= 0.7) return { ...w, text: t }
    }
    return w
  })
}

// noms propres candidats : mots capitalises ou en CamelCase du contexte fourni
function brandTerms(...sources: string[]): string[] {
  const out = new Set<string>()
  for (const src of sources) {
    for (const m of String(src || '').matchAll(/\b[A-Z][a-zA-Z]{3,}(?:[A-Z][a-zA-Z]*)*\b/g)) out.add(m[0])
  }
  return [...out].slice(0, 40)
}

function buildCaptions(words: Word[], accents: string[], duration: number) {
  const accentKeys = accents.map(norm).filter(Boolean)
  const caps = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    // On garde la casse ET la ponctuation de la transcription : c'est le RENDERER qui
    // décide (les styles « punch » passent en majuscules, Apple / Éditorial blanc /
    // Mot par mot écrivent en casse normale, « une stratégie. » avec son point).
    // Normaliser ici rendait ces trois styles impossibles à respecter.
    const text = w.text.replace(/[«»"]/g, '').trim()   // l'apostrophe est GARDEE : « l'outil », « j'utilise »
    if (!text) continue
    let start = r2(clamp(w.start, 0, duration))
    let end = r2(clamp(w.end, 0, duration))
    if (caps.length) start = Math.max(start, caps[caps.length - 1].end)
    end = Math.max(end, start + 0.14)
    const next = words[i + 1]
    if (next) end = Math.min(end, Math.max(start + 0.14, r2(next.start + 0.06)))
    const key = norm(w.text)
    const accent = accentKeys.some((k) => k === key || sim(k, key) >= 0.8)
    caps.push({ text, start: r2(start), end: r2(end), accent })
  }
  return caps
}

// ---------- handler ----------
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  try {
    const form = await req.formData()
    const audio = form.get('audio')
    if (!(audio instanceof File)) return json({ error: 'Champ "audio" manquant' }, 400)
    if (audio.size > MAX_AUDIO_BYTES) return json({ error: 'Audio trop lourd (max 20 Mo)' }, 400)

    const duration = clamp(Number(form.get('duration')) || 0, 1, MAX_DURATION)
    if (!duration) return json({ error: 'Champ "duration" manquant' }, 400)

    const script = String(form.get('script') || '').trim().slice(0, 4000) || null
    let options: { lang?: string; filters?: string } = {}
    try { options = JSON.parse(String(form.get('options') || '{}')) } catch (_) { /* défauts */ }
    const lang = (options.lang || 'fr').slice(0, 5)
    // carte blanche au chef d'orchestre : ne desactive QUE les filtres de gout
    const filters = options.filters === 'low' ? 'low' : 'normal'
    const website = String(form.get('website') || '').trim().slice(0, 300)
    // brief = l'intention de l'utilisateur (≠ script, qui sert a l'alignement des sous-titres)
    const brief = String(form.get('brief') || '').trim().slice(0, 700)

    // assets b-roll : méta + miniatures
    let assetsMeta: { id: string; name: string; kind: string }[] = []
    try { assetsMeta = JSON.parse(String(form.get('assets') || '[]')) } catch (_) { /* aucun */ }
    assetsMeta = (Array.isArray(assetsMeta) ? assetsMeta : []).slice(0, MAX_ASSETS)
      .map((a) => ({ id: String(a.id || '').slice(0, 40), name: String(a.name || 'image').slice(0, 80), kind: a.kind === 'video' ? 'video' : 'image' }))
      .filter((a) => a.id)
    const assets = []
    for (const meta of assetsMeta) {
      const f = form.get('asset_' + meta.id)
      let thumb
      if (f instanceof File && f.size > 0 && f.size <= MAX_THUMB_BYTES) {
        const buf = new Uint8Array(await f.arrayBuffer())
        let bin = ''
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        thumb = { media: f.type || 'image/jpeg', b64: btoa(bin) }
      }
      assets.push({ ...meta, thumb })
    }

    // frames de la vidéo (analyse visuelle avant le plan)
    let frameTimes: number[] = []
    try { frameTimes = JSON.parse(String(form.get('frame_times') || '[]')) } catch (_) { /* aucune */ }
    const frames: { t: number; media: string; b64: string }[] = []
    for (let i = 0; i < Math.min(12, frameTimes.length); i++) {
      const f = form.get('frame_' + i)
      if (!(f instanceof File) || !f.size || f.size > 300 * 1024) continue
      const buf = new Uint8Array(await f.arrayBuffer())
      let bin = ''
      for (let j = 0; j < buf.length; j += 0x8000) bin += String.fromCharCode(...buf.subarray(j, j + 0x8000))
      frames.push({ t: Number(frameTimes[i]) || 0, media: f.type || 'image/jpeg', b64: btoa(bin) })
    }

    // 1. mémoire de marque (#124) : sa fiche + le cache de son site
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
    const mem = await loadBrandMemory(token)
    const siteToRead = website || mem.siteUrl
    // le site n'est re-crawlé que si le cache est vide ou porte sur une AUTRE url
    const siteJob = (mem.siteCache && (!website || website === mem.siteUrl))
      ? Promise.resolve(mem.siteCache)
      : (siteToRead ? fetchSiteContext(siteToRead) : Promise.resolve(''))

    // 2. transcription word-level + contexte site (en parallèle)
    const [scribe, siteContext] = await Promise.all([
      transcribe(audio, lang),
      siteJob,
    ])
    if (!scribe.words.length) return json({ error: 'Aucune parole detectee dans l\'audio' }, 422)

    // 3. alignement forcé si script fourni (texte exact + timing réel)
    const words = script ? alignScript(script, scribe.words, duration) : scribe.words

    // 4. Claude → analyse visuelle + plan alterné full/split (JSON strict garanti par le schéma)
    const { plan: rawPlan, usage } = await claudePlan(duration, words, assets, lang, frames, siteContext, scribe.hasMusic, brief, mem.text)

    // 5. bornes/cohérence côté serveur — la mémoire compte comme du fourni :
    // ses vrais noms de produit/features ont le droit d'apparaître à l'écran.
    // nom de marque deduit du site : « https://avatarads.fr » -> « avatarads »
    const brandName = website.replace(/^https?:\/\//, '').split('/')[0].split('.')[0]
    const plan = validatePlan(rawPlan, duration, assets.map((a) => a.id), words, brief + '\n' + mem.text, filters !== 'low', brandName)
    if (scribe.hasMusic) plan.music = null // musique déjà présente dans l'audio : on n'en rajoute pas

    // 6. sous-titres mot-à-mot — sauf si la vidéo en a déjà d'incrustés (détection visuelle)
    // les noms propres de la marque sont retablis AVANT de fabriquer les sous-titres
    const fixedWords = fixBrandWords(words, brandTerms(mem.text, siteContext, brief))
    const captions = plan.detected.subtitles ? [] : buildCaptions(fixedWords, plan.accents, duration)

    return json({
      ok: true,
      version: '1.5',
      model: CLAUDE_MODEL,
      plan: { ...plan, captions },
      transcript: { text: scribe.text, words, aligned: !!script },
      usage,
    })
  } catch (err) {
    console.error('orchestrate error:', err)
    return json({ error: String((err as Error)?.message || err).slice(0, 300) }, 500)
  }
})
