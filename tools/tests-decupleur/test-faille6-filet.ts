// Banc de l'audit Décupleur du 30/10, faille 6 : « le filet des 60 min rembourse un décuplage dont le lot tourne encore ».
// CODE RÉEL de supabase/functions/mcp/index.ts, déclenché par ses DEUX filets : réconciliation globale (GET /mcp du cron
// keep-warm, x-cron-key) → reconcileAllStale, et rattrapage par compte (appel d'outil du client) → reconcileStaleJobs.
// Base, stockage et moteur de rendu factices ; AUCUN réseau (tout fetch hors des faux services lève une erreur).
//   cd tools/tests-decupleur && deno run --allow-env --allow-read --import-map=import_map.json test-faille6-filet.ts
//   MCP_INDEX=/chemin/vers/mcp/index.ts … → une autre version (AVANT : voir ab-faille678.sh)
import { FakeDB, FakeStorage, SIGNE, rpcsCreditsMcp, createClient as fauxClient } from './fake-supabase-dc.ts'

const CRON = 'cron-banc'
// DNS factice (hôte public) : kieDownload résout l'hôte du résultat avant de le télécharger — aucun réseau réel
try { (Deno as any).resolveDns = async (_h: string, t: string) => t === 'A' ? ['93.184.216.34'] : [] } catch { Object.defineProperty(Deno, 'resolveDns', { value: async (_h: string, t: string) => t === 'A' ? ['93.184.216.34'] : [] }) }
for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://test.local', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'a', KIEAI_API_KEY: 'k', DECUPLEUR_OUVERT: '1', CRON_SECRET: CRON })) Deno.env.set(k, v)
const keep = console.log
let logs: string[] = []
for (const m of ['log', 'warn', 'error', 'info'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))

// horloge du banc : avance de 3 min entre deux passages du filet global (il ne repasse pas avant 2 min)
const vraiNow = Date.now.bind(Date)
let decal = 0
Date.now = () => vraiNow() + decal
const enAttente: Promise<unknown>[] = []
;(globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { enAttente.push(p) } }
const finirTaches = async () => { while (enAttente.length) await Promise.allSettled(enAttente.splice(0)) }

const db = new FakeDB(); (globalThis as any).__db = db
Object.assign(db.rpcs, rpcsCreditsMcp(db))
const st = new FakeStorage(); (globalThis as any).__st = st
// .neq (utilisé par le filet global, étape 2) manque à la base factice partagée : ajouté ici, sans toucher au fichier commun
{ const Q = Object.getPrototypeOf((fauxClient('u', 'k') as any).from('x')); if (!Q.neq) Q.neq = function (c: string, v: unknown) { this.f.push((r: any) => String(r[c]) !== String(v)); return this } }
globalThis.fetch = (async (u: any, o: any) => {
  const s = String(u instanceof Request ? u.url : u)
  throw new Error('réseau interdit dans le banc : ' + s + ' ' + (o?.method || 'GET'))
}) as typeof fetch

const INDEX = Deno.env.get('MCP_INDEX') || new URL('../../supabase/functions/mcp/index.ts', import.meta.url).href
await import(INDEX.startsWith('/') ? 'file://' + INDEX : INDEX)
const handler = (globalThis as any).__handler as (r: Request) => Promise<Response>

// ── Données ──
const UID = '11111111-2222-4333-8444-555555555555'
const N = 10, VAR = Math.ceil(N * 0.5), PERSO = 15 * 10, SOLDE = 500
const TOKEN = 'aat_' + 'b'.repeat(48)
async function hmac(s: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('x'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('')
}
const TOKEN_HASH = await hmac(TOKEN)
const iso = (minAvant: number) => new Date(Date.now() - minAvant * 60_000).toISOString()

let jobId = '', rid = ''
type Rendu = { status: string; creeMin: number; battuMin: number } | null
// Job MCP à l'étape « dj: » (lot de variantes lancé) : débité, personnage DÉJÀ déposé et dû si perso (credits_cost = part variantes)
function preparer(o: { perso: boolean; ageMin: number; rendu: Rendu }) {
  for (const k of Object.keys(db.t)) delete db.t[k]
  st.o.clear(); logs = []
  jobId = crypto.randomUUID(); rid = crypto.randomUUID()
  const cout = VAR + (o.perso ? PERSO : 0)
  db.rows('profiles').push({ id: UID, plan: 'pro', credits_remaining: SOLDE - cout, bought_credits: 0, email: 'client@test.local' })
  db.rows('mcp_oauth_tokens').push({ token_hash: TOKEN_HASH, user_id: UID, expires_at: new Date(Date.now() + 3600_000).toISOString() })
  db.rows('debits').push({ job_id: jobId, amt: cout })
  const perso = `mcp-prep/${UID}/${jobId}-perso.mp4`, base = `mcp-prep/${UID}/${rid}-prep.mp4`
  if (o.perso) st.put('render-media', perso, new Uint8Array(6000).fill(7))
  st.put('render-media', base, new Uint8Array(500))
  db.rows('mcp_jobs').push({ id: jobId, user_id: UID, kind: 'avatar', status: 'running', op_name: 'dj:' + rid, credits_cost: VAR, refunded: false,
    created_at: iso(o.ageMin), updated_at: iso(1),
    params: { video: true, tool: 'decup', n: N, perso: o.perso, alt: {}, text_pos: 'Haut', keep: 15, bill: cout, base_path: base, lot_at: Date.now() - (o.ageMin - 5) * 60_000,
      ...(o.perso ? { perso_path: perso, perso_du: PERSO } : {}) } })
  if (o.rendu) db.rows('render_jobs').push({ id: rid, user_id: UID, status: o.rendu.status, created_at: iso(o.rendu.creeMin), updated_at: iso(o.rendu.battuMin),
    input_video: base, assets: [], avatar_clips: [], plan: { __compose: 'decupleur', n: N }, progress: o.rendu.status === 'rendering' ? 40 : null })
}
const mj = () => db.rows('mcp_jobs').find((r) => r.id === jobId)!
const lot = () => db.rows('render_jobs').find((r) => r.id === rid)
const rendu = () => db.rows('profiles').find((r) => r.id === UID)!.credits_remaining - (SOLDE - VAR - (mj().params.perso ? PERSO : 0))

// Le moteur termine le lot : variantes + manifeste dans le dossier du CLIENT (render-media/<uid>/dc-<rendu>/, qu'il peut lire)
function moteurTermine() {
  const rj = lot(); if (!rj || (rj.status !== 'rendering' && rj.status !== 'queued')) return false
  const pre = `${UID}/dc-${rid}`
  const variantes = Array.from({ length: N }, (_, i) => ({ fichier: `v${String(i + 1).padStart(2, '0')}.mp4`, affiche: `v${String(i + 1).padStart(2, '0')}.jpg` }))
  for (const v of variantes) { st.put('render-media', `${pre}/${v.fichier}`, new Uint8Array(100)); st.put('render-media', `${pre}/${v.affiche}`, new Uint8Array(10), 'image/jpeg') }
  st.put('render-media', `${pre}/dc.json`, new TextEncoder().encode(JSON.stringify({ variantes, controle: 'ok', faibles: 0, passage: 15 })), 'application/json')
  Object.assign(rj, { status: 'done', output_url: `${pre}/dc.json`, progress: 100 })
  return true
}
const variantesChezClient = () => st.duClient(UID).filter((p) => /\/dc-[^/]+\/v\d{2}\.mp4$/.test(p)).length

// Les deux filets
async function filetGlobal() {
  decal += 180_000
  await handler(new Request('https://mcp.avatarads.fr/mcp', { method: 'GET', headers: { 'x-cron-key': CRON } }))
  await finirTaches()
}
async function filetCompte() {
  await handler(new Request('https://mcp.avatarads.fr/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_account', arguments: {} } }) }))
  await finirTaches()
}
const FILETS: [string, () => Promise<void>][] = [['filet global (cron)', filetGlobal], ['filet du compte (appel d’outil)', filetCompte]]

const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); keep((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : ' — ' + d + '\n    ' + logs.slice(-4).join('\n    '))) }

for (const [nomF, filet] of FILETS) {
  keep(`── ${nomF} ──`)
  // 1. L'abus de l'audit : lot EN COURS (moteur chargé) à 70 min → le filet ne doit ni rembourser ni clore
  for (const perso of [false, true]) {
    preparer({ perso, ageMin: 70, rendu: { status: 'rendering', creeMin: 65, battuMin: 1 } })
    await filet()
    const j1 = { status: mj().status, rendu: rendu() }
    moteurTermine()
    await filet()
    ok(`${perso ? 'avec' : 'sans'} personnage, lot en cours à 70 min : rien remboursé tant qu’il tourne (statut ${j1.status}, rendu ${j1.rendu})`,
      j1.status === 'running' && j1.rendu === 0, JSON.stringify(j1))
    ok(`${perso ? 'avec' : 'sans'} personnage : lot fini ensuite → livré, 0 crédit rendu (jamais variantes + crédits)`,
      mj().status === 'done' && rendu() === 0, `statut=${mj().status} rendu=${rendu()} variantes chez le client=${variantesChezClient()}`)
  }
  // 2. Lot encore EN FILE à 2 h (moteurs saturés) → attente aussi
  preparer({ perso: true, ageMin: 125, rendu: { status: 'queued', creeMin: 120, battuMin: 120 } })
  await filet()
  ok('lot en file depuis 2 h : attente (ni échec ni remboursement)', mj().status === 'running' && rendu() === 0 && lot()?.status === 'queued', `statut=${mj().status} rendu=${rendu()} lot=${lot()?.status}`)
  // 3. Lot échoué → part encore due rendue ; personnage déposé = payé, toujours livré
  preparer({ perso: true, ageMin: 70, rendu: { status: 'failed', creeMin: 65, battuMin: 2 } })
  await filet()
  const s3 = await (await handler(new Request(`https://mcp.avatarads.fr/mcp/status/${jobId}`))).json()
  ok(`lot échoué → seule la part variantes rendue (${VAR}), personnage livré`, mj().status === 'failed' && rendu() === VAR && typeof s3.perso === 'string' && s3.perso.startsWith(SIGNE), `statut=${mj().status} rendu=${rendu()} ${JSON.stringify(s3)}`)
  // 4. Lot en FILE depuis plus de 6 h (moteurs hors ligne) → lot ARRÊTÉ puis part due rendue ; le moteur ne le prend plus
  preparer({ perso: true, ageMin: 400, rendu: { status: 'queued', creeMin: 395, battuMin: 395 } })
  await filet()
  const pris = moteurTermine()
  ok(`lot en file > 6 h → arrêté (« failed »), part variantes rendue (${VAR}), le personnage reste dû`, mj().status === 'failed' && rendu() === VAR && lot()?.status === 'failed', `statut=${mj().status} rendu=${rendu()} lot=${lot()?.status}`)
  ok('un moteur revenu ensuite ne fabrique plus ces variantes gratuites', !pris && variantesChezClient() === 0, `pris=${pris} variantes=${variantesChezClient()}`)
  // 5. Lot « en cours » sans battement depuis 40 min, lancé il y a > 6 h (moteur mort) → arrêté, part due rendue
  preparer({ perso: false, ageMin: 400, rendu: { status: 'rendering', creeMin: 395, battuMin: 40 } })
  await filet()
  ok(`lot sans battement > 6 h → arrêté, ${VAR} crédits rendus`, mj().status === 'failed' && rendu() === VAR && lot()?.status === 'failed', `statut=${mj().status} rendu=${rendu()} lot=${lot()?.status}`)
  // 6. Lot qui BAT encore à 7 h → attente ; abandonné à 24 h
  preparer({ perso: false, ageMin: 430, rendu: { status: 'rendering', creeMin: 425, battuMin: 1 } })
  await filet()
  ok('lot qui bat encore à 7 h : attente', mj().status === 'running' && rendu() === 0 && lot()?.status === 'rendering', `statut=${mj().status} rendu=${rendu()} lot=${lot()?.status}`)
  preparer({ perso: false, ageMin: 1500, rendu: { status: 'rendering', creeMin: 1495, battuMin: 1 } })
  await filet()
  ok('lot lancé il y a 25 h : abandonné et rendu (jamais bloqué à vie)', mj().status === 'failed' && rendu() === VAR && lot()?.status === 'failed', `statut=${mj().status} rendu=${rendu()} lot=${lot()?.status}`)
  // 7. Rendu disparu → filet habituel (part encore due rendue, jamais le personnage déposé)
  preparer({ perso: true, ageMin: 70, rendu: null })
  await filet()
  ok(`rendu disparu → remboursé de la part due seulement (${VAR}, pas ${VAR + PERSO})`, mj().status === 'failed' && rendu() === VAR, `statut=${mj().status} rendu=${rendu()}`)
  // 8. Non-régression : une étape avant le lot (personnage chez le fournisseur, « dw: ») garde le filet des 60 min
  preparer({ perso: true, ageMin: 70, rendu: null })
  Object.assign(mj(), { op_name: 'dw:tacheBloquee01', credits_cost: VAR + PERSO, params: { ...mj().params, perso_path: undefined, perso_du: undefined } })
  globalThis.fetch = (async (u: any) => { const s = String(u instanceof Request ? u.url : u)
    if (s.startsWith('https://api.kie.ai/api/v1/jobs/recordInfo')) return Response.json({ code: 200, data: { state: 'generating' } })
    throw new Error('réseau interdit dans le banc : ' + s) }) as typeof fetch
  await filet()
  ok(`étape personnage bloquée > 60 min : remboursée en entier comme avant (${VAR + PERSO})`, mj().status === 'failed' && rendu() === VAR + PERSO, `statut=${mj().status} rendu=${rendu()}`)
}

// ── RELECTURE 30/10 : courses entre un filet et un suivi /status concurrent (« remboursé + lot en file ») ──
const vraiFail = db.rpcs.mcp_job_fail_refund
for (const [nomF, filet] of FILETS) {
  keep(`── courses, ${nomF} ──`)
  // 9. Instantané du filet pris à « vn: » ; un /status CONCURRENT débite et lance le lot (→ « dj: ») juste avant que le filet
  //    appelle mcp_job_fail_refund. Avant : clos + tout rendu, lot en file → variantes gratuites. Après : p_only_op → le suivi gagne.
  preparer({ perso: false, ageMin: 70, rendu: null })
  const prepRid = crypto.randomUUID()
  Object.assign(mj(), { op_name: 'vn:' + prepRid, credits_cost: 0, params: { video: true, tool: 'decup', n: N, perso: false, alt: {}, text_pos: 'Haut', max_dur: 15 } })
  db.rows('profiles')[0].credits_remaining = SOLDE
  db.rows('render_jobs').push({ id: prepRid, user_id: UID, status: 'rendering', created_at: iso(69), updated_at: iso(1), plan: { __compose: 'mc-ref' } })
  let course = 0
  db.rpcs.mcp_job_fail_refund = (a: any) => {
    const j = mj()
    if (!course && j.op_name === 'vn:' + prepRid) {
      course++
      db.rows('profiles')[0].credits_remaining -= VAR
      j.credits_cost = VAR
      j.updated_at = new Date().toISOString()
      db.rows('render_jobs').push({ id: rid, user_id: UID, status: 'queued', created_at: iso(0), updated_at: iso(0), input_video: `mcp-prep/${UID}/${prepRid}.mp4`, assets: [], avatar_clips: [], plan: { __compose: 'decupleur', n: N } })
      j.op_name = 'dj:' + rid
      Object.assign(j.params, { lot_at: Date.now() })
    }
    return vraiFail(a)
  }
  await filet()
  db.rpcs.mcp_job_fail_refund = vraiFail
  const c9 = { course, statut: mj().status, solde: db.rows('profiles')[0].credits_remaining, lot: lot()?.status }
  ok('course vn: → dj: pendant le filet : le job n’est PAS clos ni remboursé (lot payé)', course === 1 && c9.statut === 'running' && c9.solde === SOLDE - VAR && c9.lot === 'queued', JSON.stringify(c9))
  moteurTermine(); await filet()
  ok('… puis le lot fini est livré, sans aucun crédit rendu', mj().status === 'done' && db.rows('profiles')[0].credits_remaining === SOLDE - VAR, `statut=${mj().status} solde=${db.rows('profiles')[0].credits_remaining}`)

  // 10. Réservation « vns: » RÉCENTE (un suivi débite / lance le lot en ce moment) sur un job de 70 min → jamais tranchée
  preparer({ perso: false, ageMin: 70, rendu: null })
  Object.assign(mj(), { op_name: 'vns:' + crypto.randomUUID(), updated_at: iso(1) })
  await filet()
  ok('réservation de 1 min : le filet attend (ni clos ni remboursé)', mj().status === 'running' && rendu() === 0, `statut=${mj().status} rendu=${rendu()}`)
  // 11. Réservation ORPHELINE (isolate tué, 10 min) → filet habituel : part encore due rendue
  preparer({ perso: false, ageMin: 70, rendu: null })
  Object.assign(mj(), { op_name: 'vns:' + crypto.randomUUID(), updated_at: iso(10) })
  await filet()
  ok(`réservation orpheline de 10 min : close, ${VAR} crédits rendus`, mj().status === 'failed' && rendu() === VAR, `statut=${mj().status} rendu=${rendu()}`)
}

// 12. Lancement du lot (dcLancerLot) alors que le job vient d'être clos entre la dépose du personnage et l'insertion du lot :
//     avant, le lot restait EN FILE (variantes gratuites, part variantes déjà rendue) ; après, il est retiré de la file.
{
  keep('── lancement du lot sur un job clos entre-temps ──')
  preparer({ perso: true, ageMin: 30, rendu: null })
  const TACHE = 'wanCourse00001'
  Object.assign(mj(), { op_name: 'dw:' + TACHE, credits_cost: VAR + PERSO, updated_at: iso(1), params: { ...mj().params, perso_path: undefined, perso_du: undefined } })
  st.o.delete(st.k('render-media', `mcp-prep/${UID}/${jobId}-perso.mp4`))
  const PB = new Uint8Array(6000).fill(7)
  globalThis.fetch = (async (u: any) => { const s = String(u instanceof Request ? u.url : u)
    if (s.startsWith('https://api.kie.ai/api/v1/jobs/recordInfo')) return Response.json({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/r/perso.mp4'] }) } })
    if (s === 'https://tempfile.aiquickdraw.com/r/perso.mp4') return new Response(PB as BodyInit, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(PB.length) } })
    throw new Error('réseau interdit dans le banc : ' + s) }) as typeof fetch
  // le job est clos (filet) au moment où le suivi vérifie l'entrée du lot — juste avant l'insertion du render_job
  const vraisNoms = st.noms.bind(st)
  let clos = 0
  st.noms = (b: string) => {
    if (!clos && b === 'render-media' && mj().op_name === 'dwg:' + TACHE && typeof mj().params.perso_du === 'number') {
      clos++; vraiFail({ p_job: jobId, p_reason: 'timeout', p_only_op: 'dwg:' + TACHE, p_max: null })
    }
    return vraisNoms(b)
  }
  await filetCompte()   // job de 30 min : le rattrapage du compte AVANCE le job (advanceDecupleur), sans filet des 60 min
  st.noms = vraisNoms
  const lots = db.rows('render_jobs').filter((r) => r.plan?.__compose === 'decupleur')
  const c12 = { clos, job: mj().status, rendu: rendu(), lots: lots.map((r) => r.status) }
  ok('job clos pendant le lancement : le lot inséré est retiré de la file (« failed »)', clos === 1 && c12.job === 'failed' && lots.length === 1 && lots[0].status === 'failed', JSON.stringify(c12))
  // le moteur ne prend que les lots en file
  for (const r of lots) if (r.status === 'queued') { const pre = `${UID}/dc-${r.id}`; for (let i = 1; i <= N; i++) st.put('render-media', `${pre}/v${String(i).padStart(2, '0')}.mp4`, new Uint8Array(100)); r.status = 'done' }
  ok('aucune variante fabriquée pour ce job clos (part variantes rendue, personnage seul payé)', variantesChezClient() === 0 && c12.rendu === VAR, `variantes=${variantesChezClient()} rendu=${c12.rendu}`)
}

const nok = res.filter(([, c]) => !c).length
keep(`\n${res.length - nok}/${res.length} vérifications OK`)
Deno.exit(nok ? 1 : 0)
