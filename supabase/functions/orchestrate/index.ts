// Supabase Edge Function — 🎼 Chef d'orchestre (#108, partie 2)
// L'audio de la vidéo dirige le montage : transcription mot-à-mot (ElevenLabs
// Scribe) + alignement forcé sur le script exact (si fourni) → Claude analyse
// le transcript + les images utilisateur (vision) → émet un PLAN DE MONTAGE
// JSON strict (sections, zooms punch, b-roll placé, SFX, hook, sous-titres).
//
// Auth : JWT utilisateur (verify_jwt au gateway). Les crédits sont débités
// côté client AVANT l'appel via spendCreditsFor (RPC anti-triche), comme pour
// les autres proxys.
//
// Entrée (multipart/form-data) :
//   audio     : fichier audio (wav/mp3/m4a, ≤ 20 Mo) — la voix de la vidéo
//   duration  : durée de la timeline en secondes
//   script    : (optionnel) texte exact du script → sous-titres parfaits
//   assets    : (optionnel) JSON [{ id, name, kind }] des images b-roll
//   asset_<id>: (optionnel) miniature JPEG de chaque asset (≤ 400 Ko)
//   options   : (optionnel) JSON { lang }
//
// Sortie : { ok, plan, transcript, model, usage }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CLAUDE_MODEL = 'claude-opus-4-8'
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
async function transcribe(audio: File, lang: string | null): Promise<{ text: string; words: Word[] }> {
  const elKey = Deno.env.get('ELEVENLABS_API_KEY') ?? ''
  if (!elKey) throw new Error('ELEVENLABS_API_KEY manquante')
  const fd = new FormData()
  fd.append('file', audio, audio.name || 'audio.wav')
  fd.append('model_id', 'scribe_v1')
  fd.append('timestamps_granularity', 'word')
  fd.append('tag_audio_events', 'false')
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
  return { text: String(data.text || ''), words }
}

// ---------- schéma JSON strict du plan (sortie Claude garantie valide) ----------
const SFX_KINDS = ['whoosh', 'pop', 'ding', 'boom', 'click', 'riser', 'success', 'magic', 'hit', 'flash', 'snap']
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections', 'zooms', 'broll', 'sfx', 'hook', 'accents'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'start', 'end', 'label'],
        properties: {
          role: { type: 'string', enum: ['hook', 'benefice', 'preuve', 'cta', 'outro'] },
          start: { type: 'number' },
          end: { type: 'number' },
          label: { type: 'string' },
        },
      },
    },
    zooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['t', 'dur', 'scale', 'cx', 'cy', 'reason'],
        properties: {
          t: { type: 'number' }, dur: { type: 'number' }, scale: { type: 'number' },
          cx: { type: 'number' }, cy: { type: 'number' }, reason: { type: 'string' },
        },
      },
    },
    broll: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assetId', 'start', 'end', 'reason'],
        properties: {
          assetId: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, reason: { type: 'string' },
        },
      },
    },
    sfx: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 't'],
        properties: { kind: { type: 'string', enum: SFX_KINDS }, t: { type: 'number' } },
      },
    },
    hook: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'start', 'end'],
          properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
        },
        { type: 'null' },
      ],
    },
    accents: { type: 'array', items: { type: 'string' } },
  },
}

type Plan = {
  sections: { role: string; start: number; end: number; label: string }[]
  zooms: { t: number; dur: number; scale: number; cx: number; cy: number; reason?: string }[]
  broll: { assetId: string; start: number; end: number; reason?: string }[]
  sfx: { kind: string; t: number }[]
  hook: { text: string; start: number; end: number } | null
  accents: string[]
}

// ---------- appel Claude (Messages API, sortie structurée + vision) ----------
async function claudePlan(
  duration: number,
  words: Word[],
  assets: { id: string; name: string; kind: string; thumb?: { media: string; b64: string } }[],
  lang: string,
): Promise<{ plan: Plan; usage: unknown }> {
  const anthKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!anthKey) throw new Error('ANTHROPIC_API_KEY manquante')

  const transcriptCompact = words
    .map((w) => `${w.text}[${w.start.toFixed(2)}-${w.end.toFixed(2)}]`)
    .join(' ')

  const system = `Tu es le chef d'orchestre d'AvatarAds : un monteur video expert en formats viraux TikTok/Reels/Shorts (style Hormozi, 1600.agency, Captions.ai).
On te donne la transcription mot-a-mot (timestamps en secondes) d'une video verticale face camera, sa duree, et eventuellement des images fournies par l'utilisateur (b-roll).
Tu produis un PLAN DE MONTAGE au format JSON demande. Regles :

SECTIONS : decoupe narrative complete de 0 a la duree totale (hook / benefice / preuve / cta / outro selon ce qui est dit). Bornes alignees sur les phrases.

RYTHME : un evenement visuel (zoom, b-roll in/out) toutes les 3 a 5 secondes MAXIMUM. Jamais plus de 5s sans changement. Jamais deux evenements a moins de 0.8s l'un de l'autre.

ZOOMS (punch-in sur la personne) : scale entre 1.12 et 1.35, duree 0.6 a 1.4s, declenches PILE sur un mot fort (le timestamp du mot). cx/cy = point de zoom relatif (0-1) : visage face camera => cx 0.5, cy 0.32. Pas de zoom pendant un b-roll.

B-ROLL (images utilisateur, plein ecran par-dessus la video) : place CHAQUE image au moment ou son CONTENU correspond a ce qui est dit (regarde les images !). Duree 1.5 a 3.5s. Jamais dans les 1.5 premieres secondes (le hook montre le visage), jamais dans la derniere seconde. Si aucune image fournie : broll = [].

SFX : whoosh sur chaque entree/sortie de b-roll et zoom marquant, click/pop sur les enumerations, riser avant le CTA, success/ding sur une preuve ou un resultat. Maximum 1 SFX par 1.5s. Les timestamps tombent sur les evenements qu'ils soulignent.

HOOK TEXTE : si les 3 premieres secondes contiennent une accroche forte, un texte MAJUSCULES de 5 mots max qui la resume (start 0, end <= 3). Sinon null.

ACCENTS : 5 a 12 mots EXACTS du transcript (les plus percutants : chiffres, benefices, verbes d'action) qui seront colores en orange dans les sous-titres.

Tous les timestamps entre 0 et la duree, 2 decimales. Reponds uniquement dans le schema JSON impose.`

  const content: unknown[] = []
  for (const a of assets) {
    if (!a.thumb) continue
    content.push({ type: 'text', text: `Image utilisateur assetId="${a.id}" (${a.name}) :` })
    content.push({ type: 'image', source: { type: 'base64', media_type: a.thumb.media, data: a.thumb.b64 } })
  }
  content.push({
    type: 'text',
    text: `Duree totale : ${duration.toFixed(2)}s. Langue : ${lang}. ${assets.length} image(s) utilisateur a placer : ${assets.map((a) => a.id).join(', ') || 'aucune'}.

Transcription (mot[debut-fin]) :
${transcriptCompact}

Genere le plan de montage.`,
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
      output_config: {
        effort: 'medium',
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
  return { plan: JSON.parse(textBlock.text) as Plan, usage: data.usage }
}

// ---------- validation / normalisation serveur (le schema garantit la forme, ici les bornes) ----------
const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function validatePlan(plan: Plan, duration: number, assetIds: string[]): Plan {
  const D = duration
  const sections = (plan.sections || [])
    .map((s) => ({ ...s, start: r2(clamp(s.start, 0, D)), end: r2(clamp(s.end, 0, D)), label: String(s.label || '').slice(0, 60) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)

  const broll = (plan.broll || [])
    .filter((b) => assetIds.includes(b.assetId))
    .map((b) => ({ assetId: b.assetId, start: r2(clamp(b.start, 1.5, D)), end: r2(clamp(b.end, 0, Math.max(0, D - 0.5))) }))
    .map((b) => ({ ...b, end: r2(clamp(b.end, b.start + 1.0, b.start + 4.0)) }))
    .filter((b) => b.end > b.start && b.end <= D)
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
    .filter((z) => !inBroll(z.t))
    .sort((a, b) => a.t - b.t)
    .filter((z, i, arr) => i === 0 || z.t - arr[i - 1].t >= 0.8)

  const sfx = (plan.sfx || [])
    .filter((s) => SFX_KINDS.includes(s.kind))
    .map((s) => ({ kind: s.kind, t: r2(clamp(s.t, 0, D - 0.1)) }))
    .sort((a, b) => a.t - b.t)
    .filter((s, i, arr) => i === 0 || s.t - arr[i - 1].t >= 1.2)
    .slice(0, Math.ceil(D / 1.5))

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
  return { sections, zooms, broll: cleanBroll, sfx, hook, accents }
}

// ---------- sous-titres mot-a-mot (texte exact + accents) ----------
function buildCaptions(words: Word[], accents: string[], duration: number) {
  const accentKeys = accents.map(norm).filter(Boolean)
  const caps = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const text = w.text.replace(/[«»"']/g, '').replace(/[.,!?;:…]+$/, '').toUpperCase()
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
    let options: { lang?: string } = {}
    try { options = JSON.parse(String(form.get('options') || '{}')) } catch (_) { /* défauts */ }
    const lang = (options.lang || 'fr').slice(0, 5)

    // assets b-roll : méta + miniatures
    let assetsMeta: { id: string; name: string; kind: string }[] = []
    try { assetsMeta = JSON.parse(String(form.get('assets') || '[]')) } catch (_) { /* aucun */ }
    assetsMeta = (Array.isArray(assetsMeta) ? assetsMeta : []).slice(0, MAX_ASSETS)
      .map((a) => ({ id: String(a.id || '').slice(0, 40), name: String(a.name || 'image').slice(0, 80), kind: 'image' }))
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

    // 1. transcription word-level
    const scribe = await transcribe(audio, lang)
    if (!scribe.words.length) return json({ error: 'Aucune parole detectee dans l\'audio' }, 422)

    // 2. alignement forcé si script fourni (texte exact + timing réel)
    const words = script ? alignScript(script, scribe.words, duration) : scribe.words

    // 3. Claude → plan (JSON strict garanti par le schéma)
    const { plan: rawPlan, usage } = await claudePlan(duration, words, assets, lang)

    // 4. bornes/cohérence côté serveur
    const plan = validatePlan(rawPlan, duration, assets.map((a) => a.id))

    // 5. sous-titres mot-à-mot
    const captions = buildCaptions(words, plan.accents, duration)

    return json({
      ok: true,
      version: '0.2',
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
