// nettoyage-voix.test.ts — le nettoyage de la voix côté MCP, avec un fetch simulé
// (aucun appel réel au serveur de rendu, à ElevenLabs ni à Supabase).
//
//   deno test supabase/functions/mcp/nettoyage-voix.test.ts
//
// Ce qui est vérifié :
//   · serveur de rendu OK → ElevenLabs n'est JAMAIS appelé ;
//   · serveur de rendu KO (erreur HTTP, injoignable, délai, non configuré, fichier trop gros,
//     redirection) → repli ElevenLabs, journalisé « [clean] repli ElevenLabs » ;
//   · refus DÉFINITIF du serveur (413 trop_long / hors_limites) → pas de repli ;
//   · les deux KO → clean_audio rembourse le débit, montage_ia continue sur l'audio
//     d'origine et rembourse la part nettoyage (credits_cost décrémenté) ; le message ne
//     nomme aucun fournisseur ;
//   · le temps : délai du serveur proportionnel à la taille (15 à 40 s) et transmis au
//     serveur, secours borné (60 s) ;
//   · sécurité : https:// obligatoire, redirections refusées (vrais serveurs locaux).
import {
  nettoyerVoix, nettoyerViaWorker, nettoyageDisponible, nettoyerEtLivrer, nettoyerAvantMontage, isolerViaElevenLabs,
  workerConfigure, delaiWorker, WORKER_MAX_OCTETS, WORKER_DELAI_MIN_MS, WORKER_DELAI_MAX_MS, WORKER_MARGE_MS, ELEVEN_DELAI_MS,
  type ConfigNettoyage,
} from './nettoyage-voix.ts'

function egal(a: unknown, b: unknown, msg = '') {
  const x = JSON.stringify(a), y = JSON.stringify(b)
  if (x !== y) throw new Error(`${msg} attendu ${y}, obtenu ${x}`)
}
function vrai(c: unknown, msg: string) { if (!c) throw new Error(msg) }

const WORKER = 'https://render-worker.example.up.railway.app'
const CLE = 'cle-partagee-0123456789abcdef'
const AUDIO = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const MP3_WORKER = new Uint8Array([0x49, 0x44, 0x33, 9, 9, 9])      // « ID3… »
const MP3_ELEVEN = new Uint8Array([0xff, 0xfb, 7, 7])

type Appel = { url: string; init?: RequestInit }
type Scenario = 'ok' | 'http500' | 'http503' | 'injoignable' | 'lent' | 'mauvais_type' | 'trop_long' | 'hors_limites' | 'illisible'
function fauxFetch(worker: Scenario, eleven: 'ok' | 'http500' | 'injoignable' | 'lent') {
  const appels: Appel[] = []
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    appels.push({ url, init })
    if (url.startsWith(WORKER)) {
      if (worker === 'injoignable') throw new TypeError('error sending request: connection refused')
      if (worker === 'lent') {
        return await new Promise<Response>((_, ko) => {
          init?.signal?.addEventListener('abort', () => ko(new DOMException('signal timed out', 'TimeoutError')))
        })
      }
      if (worker === 'http500') return new Response(JSON.stringify({ ok: false, error: 'interne' }), { status: 500, headers: { 'content-type': 'application/json' } })
      if (worker === 'http503') return new Response(JSON.stringify({ ok: false, error: 'occupe' }), { status: 503, headers: { 'content-type': 'application/json' } })
      if (worker === 'mauvais_type') return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
      if (worker === 'trop_long' || worker === 'hors_limites') return new Response(JSON.stringify({ ok: false, error: worker }), { status: 413, headers: { 'content-type': 'application/json' } })
      if (worker === 'illisible') return new Response(JSON.stringify({ ok: false, error: 'illisible' }), { status: 422, headers: { 'content-type': 'application/json' } })
      return new Response(MP3_WORKER, { status: 200, headers: { 'content-type': 'audio/mpeg', 'x-audio-duration': '1.000' } })
    }
    if (url === 'https://api.elevenlabs.io/v1/audio-isolation') {
      if (eleven === 'injoignable') throw new TypeError('dns error')
      if (eleven === 'http500') return new Response('quota', { status: 500 })
      if (eleven === 'lent') {
        return await new Promise<Response>((_, ko) => {
          init?.signal?.addEventListener('abort', () => ko(new DOMException('signal timed out', 'TimeoutError')))
        })
      }
      return new Response(MP3_ELEVEN, { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }
    throw new Error('appel réseau inattendu : ' + url)
  }) as typeof fetch
  return { f, appels }
}
function config(f: typeof fetch, journal: string[], extra: Partial<ConfigNettoyage> = {}): ConfigNettoyage {
  return { workerUrl: WORKER + '/', workerKey: CLE, elevenKey: 'xi-test', fetch: f, journal: (m) => journal.push(m), timeoutMs: 200, ...extra }
}
const versElevenLabs = (a: Appel[]) => a.filter((x) => x.url.includes('elevenlabs')).length
const versWorker = (a: Appel[]) => a.filter((x) => x.url.startsWith(WORKER)).length

// ── 1. serveur de rendu OK ──
Deno.test('worker OK : MP3 du worker rendu, aucun appel ElevenLabs', async () => {
  const { f, appels } = fauxFetch('ok', 'ok')
  const journal: string[] = []
  const r = await nettoyerVoix(AUDIO, 'audio/wav', config(f, journal))
  vrai(r instanceof Uint8Array, 'octets attendus')
  egal(Array.from(r as Uint8Array), Array.from(MP3_WORKER))
  egal(versElevenLabs(appels), 0, 'appels ElevenLabs')
  egal(versWorker(appels), 1, 'appels worker')
  vrai(!journal.some((l) => l.includes('repli')), 'pas de repli')
})
Deno.test('worker OK : bonne route, secret en en-tête, octets bruts, type transmis, redirections refusées', async () => {
  const { f, appels } = fauxFetch('ok', 'ok')
  await nettoyerVoix(AUDIO, 'audio/x-m4a', config(f, []))
  const a = appels[0]
  egal(a.url, WORKER + '/audio/clean')
  egal(a.init?.method, 'POST')
  const h = new Headers(a.init?.headers)
  egal(h.get('x-worker-key'), CLE)
  egal(h.get('content-type'), 'audio/x-m4a')
  vrai(a.init?.body === AUDIO, "l'audio part en octets, jamais une URL")
  vrai(a.init?.signal instanceof AbortSignal, 'un délai est posé')
  egal(a.init?.redirect, 'error', 'une redirection doit être une erreur')
})
Deno.test('le secret ne figure jamais dans les journaux', async () => {
  for (const sc of ['ok', 'http500', 'injoignable'] as Scenario[]) {
    const { f } = fauxFetch(sc, 'ok')
    const journal: string[] = []
    await nettoyerVoix(AUDIO, 'audio/wav', config(f, journal))
    vrai(journal.every((l) => !l.includes(CLE)), 'clé dans les journaux (' + sc + ')')
  }
})

// ── 2. serveur de rendu KO → repli ElevenLabs ──
for (const sc of ['http500', 'http503', 'injoignable', 'lent', 'mauvais_type'] as Scenario[]) {
  Deno.test(`worker ${sc} : repli ElevenLabs journalisé`, async () => {
    const { f, appels } = fauxFetch(sc, 'ok')
    const journal: string[] = []
    const r = await nettoyerVoix(AUDIO, 'audio/wav', config(f, journal))
    egal(Array.from(r as Uint8Array), Array.from(MP3_ELEVEN))
    egal(versElevenLabs(appels), 1)
    vrai(journal.some((l) => l.startsWith('[clean] repli ElevenLabs')), 'journal : ' + journal.join(' | '))
  })
}
Deno.test('worker trop lent : le délai coupe et le repli prend le relais', async () => {
  const { f } = fauxFetch('lent', 'ok')
  const t = Date.now()
  const journal: string[] = []
  const r = await nettoyerVoix(AUDIO, 'audio/wav', config(f, journal))
  vrai(r instanceof Uint8Array, 'repli attendu')
  vrai(Date.now() - t < 2000, 'le délai doit couper')
  vrai(journal.some((l) => l.includes('délai')), 'la cause est journalisée')
})
Deno.test('délai du worker proportionnel à la taille : 15 s au moins, 40 s au plus', () => {
  egal(delaiWorker(0), WORKER_DELAI_MIN_MS)
  egal(delaiWorker(1_440_000), WORKER_DELAI_MIN_MS)        // 90 s d'audio (montage) : 5 + 9 s → 15 s
  egal(delaiWorker(3_200_000), 25_000)                      // ~3 min 20 : 5 + 20 s
  egal(delaiWorker(9_600_000), WORKER_DELAI_MAX_MS)         // 10 min : plafonné
  egal(delaiWorker(WORKER_MAX_OCTETS), WORKER_DELAI_MAX_MS)
  egal([WORKER_DELAI_MIN_MS, WORKER_DELAI_MAX_MS, WORKER_MARGE_MS, ELEVEN_DELAI_MS], [15_000, 40_000, 3_000, 60_000])
})
Deno.test('le délai est transmis au serveur, 3 s plus court : il répond avant qu\'on abandonne', async () => {
  const { f, appels } = fauxFetch('ok', 'ok')
  const gros = new Uint8Array(3_200_000)
  await nettoyerVoix(gros, 'audio/mpeg', config(f, [], { timeoutMs: undefined }))
  egal(new Headers(appels[0].init?.headers).get('x-clean-delai-ms'), String(25_000 - WORKER_MARGE_MS))
  const { f: f2, appels: a2 } = fauxFetch('ok', 'ok')
  await nettoyerVoix(AUDIO, 'audio/mpeg', config(f2, [], { timeoutMs: undefined }))
  egal(new Headers(a2[0].init?.headers).get('x-clean-delai-ms'), String(WORKER_DELAI_MIN_MS - WORKER_MARGE_MS))
})
Deno.test('secours trop lent : borné (60 s en prod), jamais d\'attente sans fin', async () => {
  const { f } = fauxFetch('injoignable', 'lent')
  const t = Date.now()
  const r = await nettoyerVoix(AUDIO, 'audio/wav', config(f, [], { elevenTimeoutMs: 200 }))
  vrai(typeof r === 'string' && r.includes('secours : délai'), String(r))
  vrai(Date.now() - t < 2000, 'le délai du secours doit couper')
  const { f: f2, appels } = fauxFetch('injoignable', 'ok')
  await isolerViaElevenLabs(AUDIO, 'audio/wav', config(f2, []))
  vrai(appels.at(-1)?.init?.signal instanceof AbortSignal, 'un délai est posé sur le secours')
})
Deno.test('worker non configuré : ElevenLabs directement, journalisé', async () => {
  const { f, appels } = fauxFetch('ok', 'ok')
  const journal: string[] = []
  const r = await nettoyerVoix(AUDIO, 'audio/wav', config(f, journal, { workerUrl: '', workerKey: '' }))
  vrai(r instanceof Uint8Array, 'repli attendu')
  egal(versWorker(appels), 0)
  vrai(journal.some((l) => l.startsWith('[clean] repli ElevenLabs')), 'repli journalisé')
})
Deno.test('fichier au-delà de 15 Mo : le worker n\'est pas sollicité, repli direct', async () => {
  const { f, appels } = fauxFetch('ok', 'ok')
  const gros = new Uint8Array(WORKER_MAX_OCTETS + 1)
  const r = await nettoyerViaWorker(gros, 'audio/mpeg', config(f, []))
  vrai(!(r instanceof Uint8Array) && r.raison.includes('15 Mo') && !r.definitif, 'refus non définitif attendu')
  egal(versWorker(appels), 0)
  const journal: string[] = []
  const v = await nettoyerVoix(gros, 'audio/mpeg', config(f, journal))
  vrai(v instanceof Uint8Array, 'repli attendu')
  vrai(journal.some((l) => l.startsWith('[clean] repli ElevenLabs (serveur de rendu : fichier au-delà de 15 Mo)')), journal.join(' | '))
})
Deno.test('https:// obligatoire : une URL http:// n\'est jamais appelée (le secret circulerait en clair)', async () => {
  const { f, appels } = fauxFetch('ok', 'ok')
  const journal: string[] = []
  const c = config(f, journal, { workerUrl: 'http://render-worker.example.up.railway.app' })
  egal(workerConfigure(c), false)
  const r = await nettoyerVoix(AUDIO, 'audio/wav', c)
  vrai(r instanceof Uint8Array, 'repli attendu')
  egal(versElevenLabs(appels), 1)
  egal(appels.filter((a) => a.url.startsWith('http://')).length, 0)
  vrai(journal.some((l) => l.includes('https://')), journal.join(' | '))
  egal(nettoyageDisponible({ ...c, elevenKey: '' }), false)
  egal(workerConfigure({ ...c, httpAutorise: true }), true, 'exception réservée aux tests')
})
Deno.test('disponibilité : worker seul, ElevenLabs seul, ou rien', () => {
  const f = fauxFetch('ok', 'ok').f
  egal(nettoyageDisponible(config(f, [], { elevenKey: '' })), true)
  egal(nettoyageDisponible(config(f, [], { workerUrl: '', workerKey: '' })), true)
  egal(nettoyageDisponible(config(f, [], { workerUrl: '', workerKey: '', elevenKey: '' })), false)
})

// ── 3. refus définitifs : pas de repli ──
for (const sc of ['trop_long', 'hors_limites'] as Scenario[]) {
  Deno.test(`worker 413 ${sc} : refus définitif, ElevenLabs JAMAIS appelé`, async () => {
    const { f, appels } = fauxFetch(sc, 'ok')
    const journal: string[] = []
    const r = await nettoyerVoix(AUDIO, 'audio/ogg', config(f, journal))
    vrai(typeof r === 'string', 'erreur attendue')
    vrai(sc === 'trop_long' ? (r as string).includes('10 min') : (r as string).includes('hors limites'), String(r))
    egal(versElevenLabs(appels), 0)
    vrai(journal.some((l) => l.includes('refus définitif')), journal.join(' | '))
    vrai(!journal.some((l) => l.startsWith('[clean] repli ElevenLabs')), 'pas de repli')
  })
}
Deno.test('worker 422 illisible : repli ElevenLabs (le secours lit d\'autres formats)', async () => {
  const { f, appels } = fauxFetch('illisible', 'ok')
  const r = await nettoyerVoix(AUDIO, 'audio/x-ms-wma', config(f, []))
  vrai(r instanceof Uint8Array, 'repli attendu')
  egal(versElevenLabs(appels), 1)
})

// ── 4. les deux KO ──
Deno.test('worker KO + ElevenLabs KO : une chaîne d\'erreur, jamais d\'exception', async () => {
  for (const el of ['http500', 'injoignable'] as const) {
    const { f } = fauxFetch('injoignable', el)
    const journal: string[] = []
    const r = await nettoyerVoix(AUDIO, 'audio/wav', config(f, journal))
    vrai(typeof r === 'string', 'erreur attendue')
    vrai(journal.some((l) => l.includes('en échec aussi')), 'double échec journalisé')
  }
})
Deno.test('les deux KO : le message cite les deux causes, sans nom de fournisseur', async () => {
  const { f } = fauxFetch('http503', 'http500')
  const journal: string[] = []
  const r = await nettoyerVoix(AUDIO, 'audio/wav', config(f, journal)) as string
  egal(r, 'serveur de rendu : HTTP 503 occupe ; secours : HTTP 500')
  vrai(!/elevenlabs/i.test(r), r)
  vrai(journal.some((l) => l.includes('ElevenLabs 500 — quota')), 'le détail reste au journal')
  const { f: f2 } = fauxFetch('http503', 'ok')
  const r2 = await nettoyerVoix(AUDIO, 'audio/wav', config(f2, [], { elevenKey: '' })) as string
  egal(r2, 'serveur de rendu : HTTP 503 occupe ; secours : non configuré')
})

// ── 5. une redirection, pour de vrai (deux serveurs locaux) ──
Deno.test('redirection 307 vers une autre origine : refusée, la cible ne reçoit jamais le secret', async () => {
  const recues: string[] = []
  const cible = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen() {} }, (req) => {
    recues.push(req.headers.get('x-worker-key') ?? '')
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } })
  })
  const urlCible = `http://127.0.0.1:${cible.addr.port}/vol`
  const piege = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen() {} }, async (req) => {
    await req.body?.cancel()
    return new Response(null, { status: 307, headers: { location: urlCible } })
  })
  try {
    const journal: string[] = []
    const r = await nettoyerVoix(AUDIO, 'audio/wav', {
      workerUrl: `http://127.0.0.1:${piege.addr.port}`, workerKey: CLE, elevenKey: '', httpAutorise: true,
      journal: (m) => journal.push(m), timeoutMs: 3000,
    })
    vrai(typeof r === 'string', 'la réponse redirigée ne doit jamais être livrée')
    egal(recues.length, 0, 'la cible ne doit jamais être contactée')
    vrai(journal.some((l) => l.startsWith('[clean] repli ElevenLabs (serveur de rendu : injoignable)')), journal.join(' | '))
  } finally {
    await piege.shutdown(); await cible.shutdown()
  }
})

// ── crédits : clean_audio ──
type Tool = { texte: string; erreur?: boolean }
function banque() {
  const remboursements: Array<[string, number]> = []
  return { remboursements, rembourser: async (u: string, n: number) => { remboursements.push([u, n]) } }
}
Deno.test('clean_audio, worker OK : livré, aucun remboursement', async () => {
  const { f, appels } = fauxFetch('ok', 'ok')
  const b = banque()
  const livres: Uint8Array[] = []
  const out = await nettoyerEtLivrer<Tool>({
    userId: 'u1', cost: 3, bytes: AUDIO, contentType: 'audio/wav',
    nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
    livrer: async (p) => { livres.push(p); return { texte: 'ok' } },
    rembourser: b.rembourser, erreur: (m) => ({ texte: m, erreur: true }),
  })
  egal(out, { texte: 'ok' })
  egal(Array.from(livres[0]), Array.from(MP3_WORKER))
  egal(b.remboursements, [])
  egal(versElevenLabs(appels), 0)
})
Deno.test('clean_audio, worker KO + ElevenLabs KO : erreur et remboursement intégral, rien livré', async () => {
  const { f } = fauxFetch('http500', 'http500')
  const b = banque()
  let livre = false
  const out = await nettoyerEtLivrer<Tool>({
    userId: 'u1', cost: 3, bytes: AUDIO, contentType: 'audio/wav',
    nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
    livrer: async () => { livre = true; return { texte: 'ok' } },
    rembourser: b.rembourser, erreur: (m) => ({ texte: m, erreur: true }),
  })
  egal(out.erreur, true)
  vrai(out.texte.includes('crédits remboursés'), out.texte)
  egal(b.remboursements, [['u1', 3]])
  egal(livre, false)
})
Deno.test('clean_audio, worker KO mais repli ElevenLabs OK : livré, aucun remboursement', async () => {
  const { f } = fauxFetch('injoignable', 'ok')
  const b = banque()
  const out = await nettoyerEtLivrer<Tool>({
    userId: 'u1', cost: 2, bytes: AUDIO, contentType: 'audio/wav',
    nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
    livrer: async () => ({ texte: 'ok' }),
    rembourser: b.rembourser, erreur: (m) => ({ texte: m, erreur: true }),
  })
  egal(out, { texte: 'ok' })
  egal(b.remboursements, [])
})
Deno.test('clean_audio, nettoyage OK mais livraison en échec (upload) : remboursé, erreur propagée', async () => {
  const { f } = fauxFetch('ok', 'ok')
  const b = banque()
  let leve = false
  try {
    await nettoyerEtLivrer<Tool>({
      userId: 'u1', cost: 4, bytes: AUDIO, contentType: 'audio/wav',
      nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
      livrer: async () => { throw new Error('upload: 500') },
      rembourser: b.rembourser, erreur: (m) => ({ texte: m, erreur: true }),
    })
  } catch (_) { leve = true }
  egal(leve, true)
  egal(b.remboursements, [['u1', 4]])
})

// ── crédits : montage_ia ──
Deno.test('montage_ia, worker OK : audio remplacé par le MP3 nettoyé, rien remboursé', async () => {
  const { f, appels } = fauxFetch('ok', 'ok')
  const b = banque()
  const got = { bytes: AUDIO, contentType: 'audio/wav' }
  const mcpJob = { id: 'j1', credits_cost: 10 }
  const notes: unknown[] = []
  const ok = await nettoyerAvantMontage({
    got, userId: 'u1', coutClean: 2, mcpJob,
    nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
    rembourser: b.rembourser, noterJob: async (m) => { notes.push(m) }, journal: () => {},
  })
  egal(ok, true)
  egal(Array.from(got.bytes), Array.from(MP3_WORKER))
  egal(got.contentType, 'audio/mpeg')
  egal(mcpJob.credits_cost, 10)
  egal(b.remboursements, [])
  egal(notes, [])
  egal(versElevenLabs(appels), 0)
})
Deno.test('montage_ia, worker KO + ElevenLabs KO : on continue sur l\'audio d\'origine, part nettoyage remboursée', async () => {
  const { f } = fauxFetch('injoignable', 'injoignable')
  const b = banque()
  const got = { bytes: AUDIO, contentType: 'audio/wav' }
  const mcpJob = { id: 'j1', credits_cost: 10 }
  const notes: Array<{ credits_cost: number; error: string }> = []
  const ok = await nettoyerAvantMontage({
    got, userId: 'u1', coutClean: 2, mcpJob,
    nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
    rembourser: b.rembourser, noterJob: async (m) => { notes.push(m) }, journal: () => {},
  })
  egal(ok, false)
  vrai(got.bytes === AUDIO && got.contentType === 'audio/wav', "l'audio d'origine est conservé")
  egal(b.remboursements, [['u1', 2]])
  egal(mcpJob.credits_cost, 8, 'credits_cost décrémenté (pas de double remboursement ensuite)')
  egal(notes.length, 1)
  egal(notes[0].credits_cost, 8)
  vrai(notes[0].error.includes('2 cr remboursés'), notes[0].error)
})
Deno.test('clean_audio, refus définitif (plus de 10 min) : erreur claire et remboursement, aucun appel ElevenLabs', async () => {
  const { f, appels } = fauxFetch('trop_long', 'ok')
  const b = banque()
  const out = await nettoyerEtLivrer<Tool>({
    userId: 'u1', cost: 5, bytes: AUDIO, contentType: 'audio/ogg',
    nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
    livrer: async () => ({ texte: 'ok' }),
    rembourser: b.rembourser, erreur: (m) => ({ texte: m, erreur: true }),
  })
  egal(out.erreur, true)
  vrai(out.texte.includes('10 min') && out.texte.includes('crédits remboursés'), out.texte)
  egal(b.remboursements, [['u1', 5]])
  egal(versElevenLabs(appels), 0)
})
Deno.test('montage_ia, refus définitif : audio d\'origine conservé, part nettoyage remboursée, aucun appel ElevenLabs', async () => {
  const { f, appels } = fauxFetch('trop_long', 'ok')
  const b = banque()
  const got = { bytes: AUDIO, contentType: 'audio/ogg' }
  const mcpJob = { id: 'j1', credits_cost: 20 }
  const notes: Array<{ credits_cost: number; error: string }> = []
  const ok = await nettoyerAvantMontage({
    got, userId: 'u1', coutClean: 12, mcpJob,
    nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
    rembourser: b.rembourser, noterJob: async (m) => { notes.push(m) }, journal: () => {},
  })
  egal(ok, false)
  vrai(got.bytes === AUDIO, "l'audio d'origine est conservé")
  egal(b.remboursements, [['u1', 12]])
  egal(mcpJob.credits_cost, 8)
  egal(versElevenLabs(appels), 0)
})
Deno.test('montage_ia, worker KO + repli OK : audio nettoyé par ElevenLabs, rien remboursé', async () => {
  const { f } = fauxFetch('http503', 'ok')
  const b = banque()
  const got = { bytes: AUDIO, contentType: 'audio/wav' }
  const mcpJob = { id: 'j1', credits_cost: 10 }
  const ok = await nettoyerAvantMontage({
    got, userId: 'u1', coutClean: 2, mcpJob,
    nettoyer: (x, ct) => nettoyerVoix(x, ct, config(f, [])),
    rembourser: b.rembourser, noterJob: async () => {}, journal: () => {},
  })
  egal(ok, true)
  egal(Array.from(got.bytes), Array.from(MP3_ELEVEN))
  egal(b.remboursements, [])
})
