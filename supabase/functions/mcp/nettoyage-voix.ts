// nettoyage-voix.ts — le nettoyage de la voix pour le MCP (outil clean_audio + étape 0 du Montage IA).
//
// Décision d'Axel (25/09) : on nettoie sur NOTRE serveur de rendu (render-worker, route
// POST /audio/clean), avec le même traitement que le module « Nettoyage audio » de l'app :
// RNNoise + chaîne voix, 0 € la minute. ElevenLabs Voice Isolator (0,12 $/min) ne sert
// plus que de SECOURS, quand le serveur est injoignable ou répond en erreur — pour ne
// jamais laisser l'utilisateur sans résultat. Seule exception : un refus DÉFINITIF du
// serveur (HTTP 413 : plus de 10 min, format hors limites), que le secours ne rattraperait
// pas au prix facturé. Si rien n'aboutit, l'appelant garde son comportement d'avant :
// erreur + remboursement pour clean_audio ; le Montage IA continue sur l'audio d'origine
// et rembourse la part nettoyage.
//
// Aucun accès réseau ni variable d'environnement ici : tout arrive par la configuration
// (index.ts la remplit depuis les secrets), ce qui rend le module testable avec un fetch simulé.

export type ConfigNettoyage = {
  workerUrl: string   // AUDIO_CLEAN_URL : domaine public Railway du render-worker (https:// obligatoire)
  workerKey: string   // AUDIO_CLEAN_KEY : même secret que la variable Railway du worker
  elevenKey: string   // ELEVENLABS_API_KEY : le secours
  timeoutMs?: number        // délai fixe accordé au worker (tests) ; sinon delaiWorker(taille)
  elevenTimeoutMs?: number  // délai accordé au secours (60 s par défaut)
  httpAutorise?: boolean    // TESTS SEULEMENT (serveur local en http://) — jamais en production
  fetch?: typeof fetch
  journal?: (msg: string) => void
}

// Octets nettoyés, ou une chaîne d'erreur (jamais d'exception : l'appelant décide).
// La chaîne est montrée à l'utilisateur : jamais de nom de fournisseur dedans.
export type ResultatNettoyage = Uint8Array | string

// ── Le temps, compté au plus juste ──────────────────────────────────────────
// clean_audio est un appel d'outil SYNCHRONE : téléchargement (20 s max) + serveur de
// rendu + secours + upload doivent tenir sous le délai d'inactivité de Supabase (150 s),
// sinon l'isolat est coupé et le remboursement du finally ne s'exécute jamais — et bien
// avant, le client claude.ai abandonne. D'où :
//   · un délai du serveur de rendu PROPORTIONNEL à la durée estimée (≈ 960 Ko par
//     minute, comme le devis) : 5 s + 0,1 s par seconde d'audio, entre 15 et 40 s. Le
//     traitement lui-même prend ~0,3 s pour 90 s d'audio, ~12 s pour 10 min ;
//   · ce délai est transmis au serveur (x-clean-delai-ms, 3 s de marge) : il répond 504
//     AVANT qu'on abandonne, jamais un 200 qui arrive après notre délai et un secours
//     payé pour rien ;
//   · le secours est borné lui aussi (60 s). Pire cas : 20 + 40 + 60 s + upload.
export const WORKER_DELAI_MIN_MS = 15_000
export const WORKER_DELAI_MAX_MS = 40_000
export const WORKER_MARGE_MS = 3_000
export const ELEVEN_DELAI_MS = 60_000
export const WORKER_MAX_OCTETS = 15_000_000   // la borne de la route /audio/clean
export const delaiWorker = (taille: number) =>
  Math.min(WORKER_DELAI_MAX_MS, Math.max(WORKER_DELAI_MIN_MS, Math.round(5_000 + taille / 160)))

// https:// obligatoire : le secret partagé ne circule jamais en clair
export const urlWorkerValide = (c: ConfigNettoyage) =>
  /^https:\/\/[^/\s]+/i.test(c.workerUrl) || (!!c.httpAutorise && /^http:\/\/[^/\s]+/i.test(c.workerUrl))
export const workerConfigure = (c: ConfigNettoyage) => !!(c.workerKey && urlWorkerValide(c))
export const nettoyageDisponible = (c: ConfigNettoyage) => workerConfigure(c) || !!c.elevenKey

// Refus DÉFINITIFS du serveur de rendu (HTTP 413) : le fichier est hors limites, le
// secours n'y changerait rien — sinon, pire, il traiterait des heures d'audio (payées
// à la minute réelle) pour un devis calculé sur la taille (3 h d'Opus tiennent en 4 Mo).
const REFUS_DEFINITIFS: Record<string, string> = {
  trop_long: 'audio trop long pour le nettoyage : 10 min au plus',
  hors_limites: 'format audio hors limites : 8 canaux et 192 kHz au plus',
}

type EchecWorker = { raison: string; definitif?: string }

// ── 1. le serveur de rendu ──────────────────────────────────────────────────
export async function nettoyerViaWorker(bytes: Uint8Array, contentType: string, c: ConfigNettoyage): Promise<Uint8Array | EchecWorker> {
  if (!c.workerUrl || !c.workerKey) return { raison: 'non configuré' }
  if (!urlWorkerValide(c)) return { raison: 'AUDIO_CLEAN_URL doit commencer par https://' }
  if (bytes.length > WORKER_MAX_OCTETS) return { raison: `fichier au-delà de ${WORKER_MAX_OCTETS / 1_000_000} Mo` }
  const f = c.fetch ?? fetch
  const url = c.workerUrl.replace(/\/+$/, '') + '/audio/clean'
  const delai = c.timeoutMs ?? delaiWorker(bytes.length)
  try {
    const r = await f(url, {
      method: 'POST',
      headers: {
        'x-worker-key': c.workerKey,
        'content-type': contentType || 'application/octet-stream',
        'x-clean-delai-ms': String(Math.max(1_000, delai - WORKER_MARGE_MS)),
      },
      body: bytes as unknown as BodyInit,
      // une redirection est une erreur : le secret ne suit jamais une redirection
      // vers une autre origine, et une réponse venue d'ailleurs n'est jamais livrée
      redirect: 'error',
      signal: AbortSignal.timeout(delai),
    })
    if (!r.ok) {
      const code = await r.json().then((j: { error?: string }) => String(j?.error ?? '')).catch(() => '')
      const raison = `HTTP ${r.status}${code ? ' ' + code.slice(0, 40) : ''}`
      if (r.status === 413 && REFUS_DEFINITIFS[code]) return { raison, definitif: REFUS_DEFINITIFS[code] }
      return { raison }
    }
    if (!/^audio\/mpeg/i.test(r.headers.get('content-type') || '')) {
      await r.body?.cancel().catch(() => {})
      return { raison: 'réponse inattendue' }
    }
    const out = new Uint8Array(await r.arrayBuffer())
    if (!out.length) return { raison: 'réponse vide' }
    return out
  } catch (e) {
    const nom = (e as Error)?.name
    return { raison: nom === 'TimeoutError' || nom === 'AbortError' ? `délai de ${Math.round(delai / 1000)} s dépassé` : 'injoignable' }
  }
}

// ── 2. le secours : ElevenLabs Voice Isolator (appel d'avant, borné dans le temps) ──
// Renvoie une raison NEUTRE (sans nom de fournisseur) ; le détail va au journal.
export async function isolerViaElevenLabs(bytes: Uint8Array, contentType: string, c: ConfigNettoyage): Promise<ResultatNettoyage> {
  const log = c.journal ?? ((m: string) => console.log(m))
  if (!c.elevenKey) return 'non configuré'
  const f = c.fetch ?? fetch
  const delai = c.elevenTimeoutMs ?? ELEVEN_DELAI_MS
  try {
    const fd = new FormData()
    fd.append('audio', new Blob([bytes as unknown as BlobPart], { type: contentType }), 'input.mp3')
    const iso = await f('https://api.elevenlabs.io/v1/audio-isolation', {
      method: 'POST', headers: { 'xi-api-key': c.elevenKey }, body: fd,
      signal: AbortSignal.timeout(delai),
    })
    if (!iso.ok) {
      const err = await iso.text().catch(() => '')
      log(`[clean] ElevenLabs ${iso.status}${err ? ' — ' + err.slice(0, 120) : ''}`)
      return `HTTP ${iso.status}`
    }
    const out = new Uint8Array(await iso.arrayBuffer())
    return out.length ? out : 'réponse vide'
  } catch (e) {
    const nom = (e as Error)?.name
    return nom === 'TimeoutError' || nom === 'AbortError' ? `délai de ${Math.round(delai / 1000)} s dépassé` : 'injoignable'
  }
}

// ── l'enchaînement : le worker d'abord, ElevenLabs s'il le faut ─────────────
export async function nettoyerVoix(bytes: Uint8Array, contentType: string, c: ConfigNettoyage): Promise<ResultatNettoyage> {
  const log = c.journal ?? ((m: string) => console.log(m))
  const w = await nettoyerViaWorker(bytes, contentType, c)
  if (w instanceof Uint8Array) {
    log(`[clean] serveur de rendu : voix nettoyée (${(bytes.length / 1024).toFixed(0)} Ko → ${(w.length / 1024).toFixed(0)} Ko)`)
    return w
  }
  if (w.definitif) {
    log(`[clean] refus définitif du serveur de rendu (${w.raison}) — pas de repli`)
    return w.definitif
  }
  log(`[clean] repli ElevenLabs (serveur de rendu : ${w.raison})`)
  const e = await isolerViaElevenLabs(bytes, contentType, c)
  if (typeof e !== 'string') return e
  log(`[clean] repli ElevenLabs en échec aussi (${e})`)
  // les deux causes, sans nom de fournisseur : c'est ce que lit l'utilisateur
  return `serveur de rendu : ${w.raison} ; secours : ${e}`
}

// ── clean_audio : les crédits sont DÉJÀ débités par l'appelant ──────────────
// Même logique qu'avant l'extraction : tant que la livraison n'a pas abouti, le
// finally rembourse (échec du nettoyage, de l'upload ou de l'enregistrement).
export async function nettoyerEtLivrer<T>(p: {
  userId: string
  cost: number
  bytes: Uint8Array
  contentType: string
  nettoyer: (bytes: Uint8Array, contentType: string) => Promise<ResultatNettoyage>
  livrer: (propre: Uint8Array) => Promise<T>
  rembourser: (userId: string, n: number) => Promise<void>
  erreur: (message: string) => T
}): Promise<T> {
  let delivered = false
  try {
    const cleaned = await p.nettoyer(p.bytes, p.contentType)
    if (typeof cleaned === 'string') return p.erreur(`Nettoyage échoué (${cleaned}) — crédits remboursés.`)
    const out = await p.livrer(cleaned)
    delivered = true
    return out
  } finally {
    if (!delivered) await p.rembourser(p.userId, p.cost)
  }
}

// ── montage_ia, étape 0 : la voix d'abord ───────────────────────────────────
// On ne fait pas échouer le montage si le nettoyage échoue — mais on rend les crédits
// du nettoyage et on le DIT dans le job, sinon l'utilisateur paie un service qu'il n'a
// pas eu sans jamais le savoir. Audit métier MCP 14/09 : credits_cost est DÉCRÉMENTÉ du
// montant remboursé (DB + objet en mémoire) → si le montage échoue ensuite,
// failAndRefund ne rend QUE le reste (pas de double remboursement du nettoyage).
// Renvoie true si la voix a été nettoyée (got est alors modifié en place).
export async function nettoyerAvantMontage(p: {
  got: { bytes: Uint8Array; contentType: string }
  userId: string
  coutClean: number
  mcpJob: { credits_cost: number }
  nettoyer: (bytes: Uint8Array, contentType: string) => Promise<ResultatNettoyage>
  rembourser: (userId: string, n: number) => Promise<void>
  noterJob: (maj: { credits_cost: number; error: string }) => Promise<void>
  journal?: (msg: string) => void
}): Promise<boolean> {
  const log = p.journal ?? ((m: string) => console.log(m))
  const propre = await p.nettoyer(p.got.bytes, p.got.contentType)
  if (typeof propre === 'string') {
    log(`[clean] voix non nettoyée, montage sur l'audio d'origine : ${propre}`)
    await p.rembourser(p.userId, p.coutClean)
    p.mcpJob.credits_cost = Math.max(0, (Number(p.mcpJob.credits_cost) || 0) - p.coutClean)
    await p.noterJob({ credits_cost: p.mcpJob.credits_cost, error: `voix non nettoyée (${propre}) — ${p.coutClean} cr remboursés` })
    return false
  }
  p.got.bytes = propre
  p.got.contentType = 'audio/mpeg'
  log(`[clean] voix nettoyée avant montage (${(propre.length / 1024).toFixed(0)} Ko)`)
  return true
}
