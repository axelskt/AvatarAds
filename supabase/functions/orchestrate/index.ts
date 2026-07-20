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
const SFX_KINDS = ['whoosh', 'pop', 'ding', 'boom', 'click', 'riser', 'success', 'magic', 'hit', 'flash', 'snap', 'hu', 'bip', 'fahh', 'robot']
// #125 · REGISTRE FUN : ces sons-la ne vont QUE sur un contenu qui assume l'humour.
// Sur une video serieuse ils sonnent amateur et tuent la credibilite -> ils sont
// SUPPRIMES DU PLAN cote serveur quand tone !== 'fun' (verrou, pas simple consigne).
const SFX_FUN = ['hu', 'bip', 'fahh', 'robot']
const BED_NAMES = ['grave', 'tension', 'montee']
const SECTION_ROLES = ['hook', 'benefice', 'preuve', 'cta', 'outro']
const MOODS = ['intense', 'dynamique', 'chill']
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
  required: ['sections', 'zooms', 'broll', 'sfx', 'hook', 'accents', 'music', 'slides', 'face', 'detected', 'avatarSegments', 'tone', 'beds'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'start', 'end', 'label'],
        properties: {
          role: { type: 'string' },   // hook|benefice|preuve|cta|outro — filtre serveur
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
        properties: { kind: { type: 'string' }, t: { type: 'number' } },   // SFX_KINDS — filtre serveur
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
    tone: { type: 'string' },   // fun|neutre — filtre serveur
    beds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 't', 'reason'],
        properties: {
          name: { type: 'string' },   // grave|tension|montee — filtre serveur
          t: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
    music: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['mood'],
          properties: { mood: { type: 'string' } },   // intense|dynamique|chill — filtre serveur
        },
        { type: 'null' },
      ],
    },
    face: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['cy'],
          properties: { cy: { type: 'number' } },
        },
        { type: 'null' },
      ],
    },
    detected: {
      type: 'object',
      additionalProperties: false,
      required: ['subtitles'],
      properties: { subtitles: { type: 'boolean' } },
    },
    avatarSegments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end', 'format', 'reason'],
        properties: {
          start: { type: 'number' }, end: { type: 'number' },
          format: { type: 'string' },   // portrait|paysage — filtre serveur
          reason: { type: 'string' },
        },
      },
    },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'layout', 'motif', 'start', 'end', 'title', 'eyebrow', 'accent', 'sub', 'center', 'value', 'unit', 'wide', 'options', 'items'],
        properties: {
          // Deliberation : les traitements compares pour CE moment, notes sur 100.
          // Format COMPACT "type|layout|score|pourquoi" (ex "nodes|full|82|montre les 3 etapes")
          // -> un tableau d'objets imbrique ici fait exploser la grammaire du mode strict
          // ("compiled grammar is too large"). On parse et on valide cote serveur.
          options: { type: 'array', items: { type: 'string' } },
          type: { type: 'string' },   // liste dans le prompt — filtre serveur (SLIDE_TYPES)
          layout: { type: 'string' },   // split|full|banner — recalcule serveur depuis le type
          // #131 · l'ANIMATION, choisie d'apres ce que dit l'audio a cet instant.
          // Utilisee par les styles visuels "page blanche" (Mot par mot, Editorial blanc) ;
          // "" = laisse le rendu la deduire du type de scene.
          motif: { type: 'string' },   // liste dans le prompt — filtre serveur (MOTIFS)
          start: { type: 'number' },
          end: { type: 'number' },
          title: { type: 'string' },
          eyebrow: { type: 'string' },   // sur-titre des scenes plein cadre / bandeaux ("" sinon)
          accent: { type: 'string' },    // bandeau : le mot du titre colore ("" sinon)
          sub: { type: 'string' },       // bandeau : ligne de preuve ("" sinon)
          center: { type: 'string' },    // loop : mot au centre ("" sinon)
          value: { type: 'string' },     // kpi/timer : chiffre principal ("" sinon)
          unit: { type: 'string' },      // kpi/timer : ce que mesure le chiffre ("" sinon)
          wide: { type: 'boolean' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 't', 'value', 'label'],
              properties: {
                text: { type: 'string' },
                t: { type: 'number' },
                value: { type: 'string' },  // bars/versus : le chiffre ("" sinon)
                label: { type: 'string' },  // bars/versus : le libelle sous le chiffre ("" sinon)
              },
            },
          },
        },
      },
    },
  },
}

type Plan = {
  sections: { role: string; start: number; end: number; label: string }[]
  zooms: { t: number; dur: number; scale: number; cx: number; cy: number; reason?: string }[]
  broll: { assetId: string; start: number; end: number; reason?: string }[]
  sfx: { kind: string; t: number }[]
  hook: { text: string; start: number; end: number } | null
  accents: string[]
  tone?: string
  beds?: { name: string; t: number; reason?: string }[]
  music: { mood: string } | null
  slides: {
    type: string; layout?: string; motif?: string; start: number; end: number; title: string; wide: boolean
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
- MOTIF D'ANIMATION (champ "motif", une valeur par scene) : c'est TOI qui choisis l'animation, d'apres CE QUI EST DIT a cet instant. Elle est utilisee par les styles visuels "page blanche" (Mot par mot, Editorial blanc) ou il n'y a ni video ni image : l'animation est alors le seul visuel, elle doit donc coller au sens.
    chain    — un enchainement, des etapes qui se suivent, une progression.
    tiles    — une enumeration d'elements de meme nature (une liste, des inclus).
    versus   — une opposition, un avant/apres, un "au lieu de".
    bars     — une montee, une croissance, des quantites qu'on compare.
    ring     — une boucle, un cycle, ou une punchline qu'on laisse resonner.
    cloud    — il ENUMERE des notions abstraites ou des ressentis (confort, confiance, statut...) : les mots s'eparpillent sur la page et arrivent un par un sur SA voix. Mets alors chaque notion dans items[].text avec son t = l'instant exact ou il la prononce.
    halftone — une respiration, une transition, un moment ou il laisse un blanc.
    grid     — de la quantite, de la repetition, "des centaines de...", l'echelle.
  Laisse "" si aucune ne s'impose : le rendu deduira l'animation du type de scene.
- REGLE ABSOLUE — C'EST LE SCRIPT QUI COMMANDE, PAS LA VARIETE : tu ne choisis JAMAIS un rythme ou un type pour "faire varier" ou pour remplir un quota. Tu pars de CE QUI EST DIT a cet instant et tu prends la scene qui l'illustre le mieux. Si aucune scene ne colle a la phrase, tu restes en FULL ECRAN — c'est un choix valable et frequent. Une video ou 3 scenes seulement sont justifiees vaut mille fois mieux qu'une video ou tu as case 8 scenes decoratives.
- TOUT LE TEXTE AFFICHE VIENT DE SA BOUCHE : chaque title, item, value, label reprend SES mots (condenses en 2 a 5 mots), avec SON vocabulaire. Tu n'inventes RIEN : pas un chiffre qu'il n'a pas prononce, pas une etape qu'il n'a pas citee, pas un prix, pas une marque, pas une statistique. Si le chiffre n'est ni dit ni visible a l'image (ni dans le contexte produit fourni), le type kpi/bars/versus est INTERDIT — prends autre chose.
- Consequence naturelle : comme un script alterne les idees (une enumeration, puis une preuve, puis une punchline), les rythmes alternent d'eux-memes. Verifie juste a la fin que tu n'as pas 2 scenes IDENTIQUES collees ni plus de 5s sans le moindre changement visuel : si ca arrive, c'est le signe qu'une des deux scenes n'etait pas justifiee — SUPPRIME-LA (repasse en full ecran) plutot que d'en inventer une autre.
- TU DELIBERES AVANT DE TRANCHER (obligatoire pour CHAQUE scene) : a chaque moment ou un traitement visuel est possible, tu ne prends pas la premiere idee. Tu remplis options[] avec 2 a 4 traitements CANDIDATS pour ce moment precis, chacun ecrit sur UNE ligne au format exact "type|layout|score|pourquoi" (ex "nodes|full|82|montre les 3 etapes citees" ou "fullscreen|none|45|rien a illustrer ici"), note sur 100 = son POTENTIEL VIRAL POUR CE SCRIPT-LA (retention : est-ce que ca donne envie de rester ? clarte : est-ce que ca rend l'idee plus limpide ? surprise : est-ce que ca casse la monotonie au bon moment ?), avec why = la raison en moins de 12 mots. "fullscreen"/layout "none" est TOUJOURS un des candidats a evaluer (rester sur la personne est souvent le meilleur choix). Puis type et layout de la scene = LE CANDIDAT LE MIEUX NOTE.
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

B-ROLL (images utilisateur, plein ecran par-dessus la video) : place CHAQUE image au moment ou son CONTENU correspond a ce qui est dit (regarde les images !). Duree 1.5 a 3.5s. Jamais dans les 1.5 premieres secondes (le hook montre le visage), jamais dans la derniere seconde. Si aucune image fournie : broll = [].

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

export function validatePlan(plan: Plan, duration: number, assetIds: string[], words: Word[] = [], brief = ''): Plan {
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
      return {
        type,
        layout,
        motif,
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
    // un bandeau n'a pas d'items ; les autres en exigent au moins un
    .filter((s) => SLIDE_TYPES.includes(s.type) && s.end > s.start + 0.5
      && (s.layout === 'banner' ? !!s.title : s.items.length > 0))
    .filter((s) => s.layout !== 'full' || s.items.length > 0 || ['kpi', 'timer'].includes(s.type))
    // seuil de deliberation : sous 55/100, le moment ne merite pas de traitement (plein ecran)
    .filter((s) => !s.options.length || s.options[0].score >= 55)
    .sort((a, b) => a.start - b.start)
    .slice(0, 24)
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
  const grounded = slides.filter(echoesScript)
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
    .map((b) => ({ assetId: b.assetId, start: r2(clamp(b.start, 1.5, D)), end: r2(clamp(b.end, 0, Math.max(0, D - 0.5))) }))
    .map((b) => ({ ...b, end: r2(clamp(b.end, b.start + 1.0, b.start + 4.0)) }))
    .filter((b) => b.end > b.start && b.end <= D)
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

  return { sections, zooms, broll: cleanBroll, sfx: sfxClean, hook, accents, music, slides, face, detected, avatarSegments, tone, beds }
}

// ---------- sous-titres mot-a-mot (texte exact + accents) ----------
function buildCaptions(words: Word[], accents: string[], duration: number) {
  const accentKeys = accents.map(norm).filter(Boolean)
  const caps = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    // On garde la casse ET la ponctuation de la transcription : c'est le RENDERER qui
    // décide (les styles « punch » passent en majuscules, Apple / Éditorial blanc /
    // Mot par mot écrivent en casse normale, « une stratégie. » avec son point).
    // Normaliser ici rendait ces trois styles impossibles à respecter.
    const text = w.text.replace(/[«»"']/g, '').trim()
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
    const plan = validatePlan(rawPlan, duration, assets.map((a) => a.id), words, brief + '\n' + mem.text)
    if (scribe.hasMusic) plan.music = null // musique déjà présente dans l'audio : on n'en rajoute pas

    // 6. sous-titres mot-à-mot — sauf si la vidéo en a déjà d'incrustés (détection visuelle)
    const captions = plan.detected.subtitles ? [] : buildCaptions(words, plan.accents, duration)

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
