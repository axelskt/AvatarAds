#!/usr/bin/env node
// audio-server.mjs — le Nettoyage audio de l'app, servi aux edge functions (MCP).
//
//   POST /audio/clean   corps = l'audio en octets (15 Mo max), en-tête x-worker-key
//                       → 200 audio/mpeg (MP3 192 kbps) + X-Audio-Duration (secondes)
//   GET  /health        → 200 {"ok":true}, public, rien d'autre
//
// ── POURQUOI UN PROCESSUS À PART, ET PAS UNE ROUTE DANS worker.mjs ──────────
// La boucle de rendu (pollLoop) lance la CLI hyperframes et les ffmpeg en
// execSync / execFileSync : pendant un rendu, sa boucle d'événements est
// BLOQUÉE plusieurs minutes. Un serveur HTTP logé dans ce même processus ne
// répondrait donc à personne pendant qu'une vidéo se rend — le MCP tomberait sur
// son délai de 60 s à chaque fois. Le serveur tourne donc dans un processus
// enfant, lancé et surveillé par worker.mjs (superviserServeurAudio, en bas) :
//   · il répond même au milieu d'un rendu ;
//   · il tourne en priorité CPU basse (nice 10) : c'est le rendu qui passe
//     d'abord, le nettoyage prend ce qui reste ;
//   · il se désigne comme victime préférée du tueur OOM du conteneur : si la
//     mémoire vient à manquer, c'est un nettoyage qui tombe (le MCP bascule
//     alors sur ElevenLabs), jamais le rendu d'un client ;
//   · concurrence bornée, file courte, délai maximal par requête.
//
// Sécurité : la route exige un secret partagé (AUDIO_CLEAN_KEY, comparé en temps
// constant). Sans secret configuré, elle répond 503 — jamais ouverte par défaut.
// Elle ne reçoit que des OCTETS, jamais une URL à aller chercher (pas de SSRF),
// et ffmpeg n'accepte que des démuxeurs audio et le protocole `file`.
// Journaux sobres : un statut, des durées, des tailles. Jamais le contenu, jamais la clé.
import http from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nettoyerAudio, chargerRnnoise } from './audio-clean.mjs'
import { PRESETS, PRESET_DEFAUT } from './voice-chain.mjs'

const MO = 1_000_000
export const TAILLE_MAX = 15 * MO
// mêmes types que ceux que le MCP accepte aujourd'hui pour clean_audio
export const TYPES_ACCEPTES = /^(audio\/[a-z0-9][a-z0-9.+-]*|video\/mp4|application\/octet-stream)$/
export const CLE_MIN = 16

const entier = (v, defaut, min, max) => {
  const n = parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut
}

export function configDepuisEnv(env = process.env) {
  return {
    port: entier(env.PORT, 8080, 1, 65535),
    cle: String(env.AUDIO_CLEAN_KEY || ''),
    tailleMax: TAILLE_MAX,
    concurrence: entier(env.AUDIO_CLEAN_CONCURRENCY, 1, 1, 4),     // nettoyages simultanés
    file: entier(env.AUDIO_CLEAN_QUEUE, 3, 0, 20),                  // requêtes en attente au-delà
    delaiMs: entier(env.AUDIO_CLEAN_TIMEOUT_MS, 55_000, 1_000, 300_000), // < 60 s du MCP : on répond avant qu'il abandonne
    maxSecondes: entier(env.AUDIO_CLEAN_MAX_SECONDS, 600, 1, 3_600), // borne la mémoire (10 min ≈ 230 Mo au pic)
  }
}

const empreinte = (s) => createHash('sha256').update(String(s)).digest()
// comparaison en temps constant, quelle que soit la longueur de ce qu'on reçoit
export function cleValide(recue, attendue) {
  if (!attendue || attendue.length < CLE_MIN || typeof recue !== 'string' || !recue) return false
  return timingSafeEqual(empreinte(recue), empreinte(attendue))
}

class ErreurHttp extends Error {
  constructor(statut, code) { super(code); this.statut = statut; this.code = code }
}

// la promesse `p`, ou un 504 dès que `signal` est levé — le premier des deux
function auPlusTard(p, signal) {
  if (signal.aborted) return Promise.reject(new ErreurHttp(504, 'delai'))
  return new Promise((ok, ko) => {
    const abandon = () => ko(new ErreurHttp(504, 'delai'))
    signal.addEventListener('abort', abandon, { once: true })
    p.then((v) => { signal.removeEventListener('abort', abandon); ok(v) },
      (e) => { signal.removeEventListener('abort', abandon); ko(e) })
  })
}

// statut HTTP de chaque erreur du traitement
const STATUT_ERREUR = { trop_long: 413, illisible: 422, sans_audio: 422, preset: 400, annule: 504, ffmpeg: 500 }

function lireCorps(req, max, signal) {
  return new Promise((resolve, reject) => {
    const morceaux = []
    let total = 0, fini = false
    const finir = (f, v) => { if (fini) return; fini = true; signal.removeEventListener('abort', surAbandon); f(v) }
    const surAbandon = () => finir(reject, new ErreurHttp(504, 'delai'))
    signal.addEventListener('abort', surAbandon, { once: true })
    req.on('data', (c) => {
      if (fini) return
      total += c.length
      if (total > max) return finir(reject, new ErreurHttp(413, 'trop_lourd'))
      morceaux.push(c)
    })
    req.on('end', () => finir(resolve, Buffer.concat(morceaux, total)))
    req.on('error', () => finir(reject, new ErreurHttp(400, 'corps_interrompu')))
    req.on('aborted', () => finir(reject, new ErreurHttp(400, 'corps_interrompu')))
  })
}

export function creerServeurAudio(options = {}) {
  const cfg = { ...configDepuisEnv({}), ...options }
  const nettoyer = options.nettoyer || nettoyerAudio
  const journal = options.journal || ((m) => console.log(m))
  const cleConfiguree = !!cfg.cle && cfg.cle.length >= CLE_MIN

  // ── concurrence bornée + file courte ──
  let actifs = 0, admis = 0, picActifs = 0
  const attente = []
  const liberer = () => {
    actifs--
    while (attente.length) {
      const suivant = attente.shift()
      if (suivant.signal.aborted) continue
      actifs++; picActifs = Math.max(picActifs, actifs)
      suivant.ok()
      return
    }
  }
  const prendrePlace = (signal) => new Promise((ok, ko) => {
    if (actifs < cfg.concurrence) { actifs++; picActifs = Math.max(picActifs, actifs); return ok() }
    const place = { ok: () => { signal.removeEventListener('abort', abandon); ok() }, signal }
    const abandon = () => { const i = attente.indexOf(place); if (i >= 0) attente.splice(i, 1); ko(new ErreurHttp(504, 'delai')) }
    signal.addEventListener('abort', abandon, { once: true })
    attente.push(place)
  })

  const repondre = (res, statut, corps, entetes = {}) => {
    if (res.headersSent) { res.destroy(); return }
    const txt = JSON.stringify(corps)
    res.writeHead(statut, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(txt), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...entetes })
    res.end(txt)
  }

  const serveur = http.createServer((req, res) => {
    traiter(req, res).catch((e) => {
      console.error('[clean] erreur inattendue :', String((e && e.message) || e).slice(0, 200))
      try { repondre(res, 500, { ok: false, error: 'interne' }) } catch (_) { /* socket déjà fermée */ }
    })
  })
  async function traiter(req, res) {
    let url
    try { url = new URL(req.url || '/', 'http://x') } catch (_) { return repondre(res, 400, { ok: false, error: 'url' }) }
    if (url.pathname === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return repondre(res, 405, { ok: false, error: 'methode' }, { Allow: 'GET, HEAD' })
      return repondre(res, 200, { ok: true })
    }
    if (url.pathname !== '/audio/clean') return repondre(res, 404, { ok: false, error: 'introuvable' })
    if (req.method !== 'POST') return repondre(res, 405, { ok: false, error: 'methode' }, { Allow: 'POST' })

    const t0 = Date.now()
    const trace = (statut, extra = '') => journal(`[clean] ${statut}${extra ? ' · ' + extra : ''} · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    // ── contrôles AVANT de lire le moindre octet du corps ──
    if (!cleConfiguree) { trace(503, 'AUDIO_CLEAN_KEY absente ou trop courte'); return repondre(res, 503, { ok: false, error: 'non_configure' }) }
    if (!cleValide(req.headers['x-worker-key'], cfg.cle)) { trace(401, 'clé refusée'); return repondre(res, 401, { ok: false, error: 'cle' }) }
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (!TYPES_ACCEPTES.test(type)) { trace(415, 'type ' + (type || 'absent').slice(0, 40)); return repondre(res, 415, { ok: false, error: 'type' }) }
    const annonce = req.headers['content-length'] != null ? Number(req.headers['content-length']) : null
    if (annonce != null && (!Number.isFinite(annonce) || annonce > cfg.tailleMax)) {
      trace(413, 'corps annoncé trop lourd')
      return repondre(res, 413, { ok: false, error: 'trop_lourd' }, { Connection: 'close' })
    }
    const preset = url.searchParams.get('preset') || PRESET_DEFAUT
    if (!PRESETS.includes(preset)) { trace(400, 'préréglage inconnu'); return repondre(res, 400, { ok: false, error: 'preset' }) }
    if (admis >= cfg.concurrence + cfg.file) {
      trace(503, `occupé (${actifs} en cours, ${attente.length} en attente)`)
      // pas de « Connection: close » ici : Node jette le corps (≤ 15 Mo) et le client
      // lit bien son 503 au lieu d'une connexion coupée en pleine écriture (EPIPE)
      return repondre(res, 503, { ok: false, error: 'occupe' }, { 'Retry-After': '5' })
    }

    admis++
    const ctrl = new AbortController()
    const minuterie = setTimeout(() => ctrl.abort(), cfg.delaiMs)
    // client parti avant la réponse : on arrête le travail tout de suite
    let clientParti = false
    res.on('close', () => { if (!res.writableFinished) { clientParti = true; ctrl.abort() } })
    let place = false, travail = null
    try {
      const octets = await lireCorps(req, cfg.tailleMax, ctrl.signal)
      if (!octets.length) throw new ErreurHttp(400, 'vide')
      await prendrePlace(ctrl.signal)
      place = true
      // Le délai est tenu CÔTÉ RÉPONSE quoi qu'il arrive : même un traitement qui
      // ignorerait le signal ne ferait pas attendre le MCP au-delà. Sa place, elle,
      // n'est rendue qu'à sa vraie fin (voir finally) : la concurrence reste bornée.
      travail = Promise.resolve().then(() => nettoyer(octets, { signal: ctrl.signal, preset, maxSecondes: cfg.maxSecondes }))
      const r = await auPlusTard(travail, ctrl.signal)
      if (ctrl.signal.aborted) throw new ErreurHttp(504, 'delai')
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg', 'Content-Length': r.mp3.length, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'X-Audio-Duration': r.duree.toFixed(3), 'X-Clean-Preset': preset,
        'X-Clean-Prise': r.infos && r.infos.dejaDebruite ? 'deja-debruitee' : r.infos && r.infos.priseSaine ? 'saine' : 'brute',
      })
      res.end(r.mp3)
      trace(200, `${r.duree.toFixed(1)} s d'audio · ${(octets.length / MO).toFixed(2)} Mo → ${(r.mp3.length / MO).toFixed(2)} Mo`)
    } catch (e) {
      let statut = 500, code = 'interne'
      if (clientParti) { statut = 499; code = 'client_parti' }
      else if (e instanceof ErreurHttp) { statut = e.statut; code = e.code }
      else if (ctrl.signal.aborted) { statut = 504; code = 'delai' }
      else if (e && STATUT_ERREUR[e.code]) { statut = STATUT_ERREUR[e.code]; code = e.code }
      if (statut === 500) console.error('[clean] erreur interne :', String((e && e.message) || e).slice(0, 200))
      trace(statut, code)
      repondre(res, statut, { ok: false, error: code }, statut === 413 ? { Connection: 'close' } : {})
    } finally {
      clearTimeout(minuterie)
      admis--
      if (place) { if (travail) travail.then(liberer, liberer); else liberer() }
    }
  }
  // lenteurs réseau bornées : en-têtes en 15 s, requête entière dans le délai (+ marge)
  serveur.headersTimeout = 15_000
  serveur.requestTimeout = cfg.delaiMs + 10_000
  serveur.etat = () => ({ actifs, enAttente: attente.length, admis, picActifs })
  return serveur
}

// ── point d'entrée du processus enfant ─────────────────────────────────────
export function demarrer(env = process.env) {
  const cfg = configDepuisEnv(env)
  // victime préférée du tueur OOM (voir l'en-tête) — Linux seulement, sans effet ailleurs
  try { writeFileSync('/proc/self/oom_score_adj', '800') } catch (_) { /* hors Linux */ }
  if (!cfg.cle) console.warn('[clean] AUDIO_CLEAN_KEY absente : /audio/clean répondra 503')
  else if (cfg.cle.length < CLE_MIN) console.warn(`[clean] AUDIO_CLEAN_KEY trop courte (< ${CLE_MIN} caractères) : /audio/clean répondra 503`)
  const serveur = creerServeurAudio(cfg)
  serveur.listen(cfg.port, () => console.log(`[clean] serveur audio en écoute sur :${cfg.port} (concurrence ${cfg.concurrence}, file ${cfg.file}, délai ${cfg.delaiMs / 1000} s)`))
  serveur.on('error', (e) => { console.error('[clean] écoute impossible :', e.message); process.exit(1) })
  chargerRnnoise().catch((e) => console.error('[clean] RNNoise indisponible :', e.message))   // préchauffage
  const arreter = () => { serveur.close(); process.exit(0) }
  process.on('SIGTERM', arreter)
  process.on('SIGINT', arreter)
  // le processus parent (worker.mjs) a disparu : on ne lui survit pas
  process.on('disconnect', arreter)
  return serveur
}

// Le processus enfant ne reçoit QUE ce dont il a besoin : ni la clé service
// Supabase, ni les clés des fournisseurs. Il décode des fichiers venus de
// l'extérieur ; moins il détient de secrets, mieux c'est.
const ENV_ENFANT = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'NODE_ENV', 'PORT', 'AUDIO_CLEAN_KEY',
  'AUDIO_CLEAN_CONCURRENCY', 'AUDIO_CLEAN_QUEUE', 'AUDIO_CLEAN_TIMEOUT_MS', 'AUDIO_CLEAN_MAX_SECONDS']
export function envEnfant(env) {
  const out = {}
  for (const k of ENV_ENFANT) if (env[k] != null) out[k] = env[k]
  return out
}

// ── côté worker.mjs : lancer le serveur en processus enfant et le relancer s'il tombe ──
export function superviserServeurAudio({ env = process.env, journal = (m) => console.log(m) } = {}) {
  const script = fileURLToPath(import.meta.url)
  const nice = ['/usr/bin/nice', '/bin/nice'].find((p) => existsSync(p))
  let enfant = null, arret = false, pause = 2_000
  const lancer = () => {
    const cmd = nice ? nice : process.execPath
    const args = nice ? ['-n', '10', process.execPath, script] : [script]
    const debut = Date.now()
    enfant = spawn(cmd, args, { env: envEnfant(env), stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    enfant.on('error', (e) => journal(`[clean] lancement du serveur audio impossible : ${e.message}`))
    enfant.on('exit', (code, sig) => {
      enfant = null
      if (arret) return
      if (Date.now() - debut > 60_000) pause = 2_000   // il a tenu : on repart du délai court
      journal(`[clean] serveur audio arrêté (${sig || 'code ' + code}) — relance dans ${pause / 1000} s`)
      setTimeout(() => { if (!arret) lancer() }, pause).unref()
      pause = Math.min(pause * 2, 300_000)
    })
  }
  lancer()
  const stop = () => { arret = true; if (enfant) { try { enfant.kill('SIGTERM') } catch (_) { /* déjà mort */ } } }
  process.on('exit', stop)
  return { stop, enfant: () => enfant }
}

const estPrincipal = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch (_) { return false }
})()
if (estPrincipal) demarrer()
