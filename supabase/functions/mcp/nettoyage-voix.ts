// nettoyage-voix.ts — le nettoyage de la voix pour le MCP (outil clean_audio + étape 0 du Montage IA).
//
// Décision d'Axel (25/09) : on nettoie sur NOTRE serveur de rendu (render-worker, route
// POST /audio/clean), avec le même traitement que le module « Nettoyage audio » de l'app :
// RNNoise + chaîne voix, 0 € la minute. ElevenLabs Voice Isolator (0,12 $/min) ne sert
// plus que de SECOURS, quand le serveur est injoignable ou répond en erreur — pour ne
// jamais laisser l'utilisateur sans résultat. Si les deux échouent, l'appelant garde son
// comportement d'avant : erreur + remboursement pour clean_audio ; le Montage IA continue
// sur l'audio d'origine et rembourse la part nettoyage.
//
// Aucun accès réseau ni variable d'environnement ici : tout arrive par la configuration
// (index.ts la remplit depuis les secrets), ce qui rend le module testable avec un fetch simulé.

export type ConfigNettoyage = {
  workerUrl: string   // AUDIO_CLEAN_URL : domaine public Railway du render-worker (https://…)
  workerKey: string   // AUDIO_CLEAN_KEY : même secret que la variable Railway du worker
  elevenKey: string   // ELEVENLABS_API_KEY : le secours
  timeoutMs?: number  // délai accordé au worker (60 s par défaut)
  fetch?: typeof fetch
  journal?: (msg: string) => void
}

// Octets nettoyés, ou une chaîne d'erreur (jamais d'exception : l'appelant décide).
export type ResultatNettoyage = Uint8Array | string

export const WORKER_DELAI_MS = 60_000
export const WORKER_MAX_OCTETS = 15_000_000   // la borne de la route /audio/clean

export const workerConfigure = (c: ConfigNettoyage) => !!(c.workerUrl && c.workerKey)
export const nettoyageDisponible = (c: ConfigNettoyage) => workerConfigure(c) || !!c.elevenKey

// ── 1. le serveur de rendu ──────────────────────────────────────────────────
export async function nettoyerViaWorker(bytes: Uint8Array, contentType: string, c: ConfigNettoyage): Promise<ResultatNettoyage> {
  if (!workerConfigure(c)) return 'serveur de rendu non configuré'
  if (bytes.length > WORKER_MAX_OCTETS) return `fichier au-delà de ${WORKER_MAX_OCTETS / 1_000_000} Mo`
  const f = c.fetch ?? fetch
  const url = c.workerUrl.replace(/\/+$/, '') + '/audio/clean'
  try {
    const r = await f(url, {
      method: 'POST',
      headers: { 'x-worker-key': c.workerKey, 'content-type': contentType || 'application/octet-stream' },
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(c.timeoutMs ?? WORKER_DELAI_MS),
    })
    if (!r.ok) {
      const code = await r.json().then((j: { error?: string }) => j?.error).catch(() => '')
      return `serveur de rendu HTTP ${r.status}${code ? ' ' + String(code).slice(0, 40) : ''}`
    }
    if (!/^audio\/mpeg/i.test(r.headers.get('content-type') || '')) {
      await r.body?.cancel().catch(() => {})
      return 'serveur de rendu : réponse inattendue'
    }
    const out = new Uint8Array(await r.arrayBuffer())
    if (!out.length) return 'serveur de rendu : réponse vide'
    return out
  } catch (e) {
    const nom = (e as Error)?.name
    return nom === 'TimeoutError' || nom === 'AbortError'
      ? `serveur de rendu : délai de ${Math.round((c.timeoutMs ?? WORKER_DELAI_MS) / 1000)} s dépassé`
      : 'serveur de rendu injoignable'
  }
}

// ── 2. le secours : ElevenLabs Voice Isolator (appel d'avant, inchangé) ─────
export async function isolerViaElevenLabs(bytes: Uint8Array, contentType: string, c: ConfigNettoyage): Promise<ResultatNettoyage> {
  if (!c.elevenKey) return 'configuration serveur incomplète'
  const f = c.fetch ?? fetch
  try {
    const fd = new FormData()
    fd.append('audio', new Blob([bytes as unknown as BlobPart], { type: contentType }), 'input.mp3')
    const iso = await f('https://api.elevenlabs.io/v1/audio-isolation', {
      method: 'POST', headers: { 'xi-api-key': c.elevenKey }, body: fd,
    })
    if (!iso.ok) {
      const err = await iso.text().catch(() => '')
      return `ElevenLabs ${iso.status}${err ? ' — ' + err.slice(0, 120) : ''}`
    }
    return new Uint8Array(await iso.arrayBuffer())
  } catch (_) {
    return 'ElevenLabs injoignable'
  }
}

// ── l'enchaînement : le worker d'abord, ElevenLabs s'il le faut ─────────────
export async function nettoyerVoix(bytes: Uint8Array, contentType: string, c: ConfigNettoyage): Promise<ResultatNettoyage> {
  const log = c.journal ?? ((m: string) => console.log(m))
  const w = await nettoyerViaWorker(bytes, contentType, c)
  if (typeof w !== 'string') {
    log(`[clean] serveur de rendu : voix nettoyée (${(bytes.length / 1024).toFixed(0)} Ko → ${(w.length / 1024).toFixed(0)} Ko)`)
    return w
  }
  log(`[clean] repli ElevenLabs (${w})`)
  const e = await isolerViaElevenLabs(bytes, contentType, c)
  if (typeof e === 'string') log(`[clean] repli ElevenLabs en échec aussi (${e})`)
  return e
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
