// Banc de l'audit Décupleur du 30/10, faille 1 : « changement de personnage obtenu gratuitement par l'outil Claude (MCP) ».
// Rejoue le CODE RÉEL de supabase/functions/mcp/index.ts (route /status/<job>, celle que sonde la carte) et la règle
// d'entrée RÉELLE du moteur (render-worker/securite.mjs), sur une base, un stockage, kie.ai et un moteur de rendu factices.
// AUCUN réseau : tout fetch hors des faux services lève une erreur.
//   cd tools/tests-decupleur && deno run --allow-env --allow-read --import-map=import_map.json test-decupleur-perso.ts
import { FakeDB, FakeStorage, SIGNE, rpcsCreditsMcp } from './fake-supabase-dc.ts'
import * as W from '../../render-worker/securite.mjs'

for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://test.local', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'a', KIEAI_API_KEY: 'k', DECUPLEUR_OUVERT: '1' })) Deno.env.set(k, v)
const keep = console.log
let logs: string[] = []
for (const m of ['log', 'warn', 'error', 'info'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))

const db = new FakeDB(); (globalThis as any).__db = db
Object.assign(db.rpcs, rpcsCreditsMcp(db))
const st = new FakeStorage(); (globalThis as any).__st = st
// résolution DNS du résultat kie : une IP publique (aucune vraie requête)
try { (Deno as any).resolveDns = async (_h: string, t: string) => t === 'A' ? ['93.184.216.34'] : [] } catch { Object.defineProperty(Deno, 'resolveDns', { value: async (_h: string, t: string) => t === 'A' ? ['93.184.216.34'] : [] }) }

// ── kie.ai factice ──
const PERSO_BYTES = new Uint8Array(6000).fill(7)
let kieEtat: 'success' | 'fail' | 'generating' = 'success'
const TACHE = 'wanTache000001'
globalThis.fetch = (async (u: any, o: any) => {
  const s = String(u instanceof Request ? u.url : u)
  if (s.startsWith(SIGNE)) {
    const [b, ...rest] = s.slice(SIGNE.length).split('?')[0].split('/')
    const x = st.o.get(st.k(b, rest.join('/')))
    return x ? new Response(x.bytes as BodyInit, { status: 200, headers: { 'content-type': x.mime } }) : new Response('nf', { status: 404 })
  }
  if (s === 'https://api.kie.ai/api/v1/jobs/createTask') return Response.json({ code: 200, data: { taskId: TACHE } })
  if (s.startsWith('https://api.kie.ai/api/v1/jobs/recordInfo')) {
    if (kieEtat === 'success') return Response.json({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/r/perso.mp4'] }) } })
    if (kieEtat === 'fail') return Response.json({ code: 200, data: { state: 'fail', failMsg: 'generation failed', failCode: '500' } })
    return Response.json({ code: 200, data: { state: 'generating' } })
  }
  if (s === 'https://tempfile.aiquickdraw.com/r/perso.mp4') return new Response(PERSO_BYTES as BodyInit, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(PERSO_BYTES.length) } })
  throw new Error('réseau interdit dans le banc : ' + s + ' ' + (o?.method || 'GET'))
}) as typeof fetch

await import('../../supabase/functions/mcp/index.ts')
const handler = (globalThis as any).__handler as (r: Request) => Promise<Response>

// ── Données ──
const UID = '11111111-2222-4333-8444-555555555555', AUTRE = '99999999-2222-4333-8444-555555555555'
const N = 5, VAR = Math.ceil(N * 0.5), DUREE = 15, PERSO = DUREE * 10, COUT = VAR + PERSO   // 153 crédits (exemple de l'audit)
const SOLDE = 500
// MP4 minimal : atome mvhd version 0, timescale 1000, durée DUREE s
function mp4(sec: number): Uint8Array {
  const b = new Uint8Array(64); b.set([0x6d, 0x76, 0x68, 0x64], 4)
  const dv = new DataView(b.buffer, 8); dv.setUint32(12, 1000); dv.setUint32(16, Math.round(sec * 1000)); return b
}
let jobId = '', prepId = ''
function preparer() {
  for (const k of Object.keys(db.t)) delete db.t[k]
  st.o.clear(); logs = []; kieEtat = 'success'
  jobId = crypto.randomUUID(); prepId = crypto.randomUUID()
  db.rows('profiles').push({ id: UID, plan: 'pro', credits_remaining: SOLDE, bought_credits: 0 })
  db.rows('render_jobs').push({ id: prepId, user_id: UID, status: 'done', output_url: `mcp-prep/${UID}/${prepId}.mp4`, plan: { __compose: 'mc-ref' }, assets: [], avatar_clips: [] })
  st.put('render-media', `mcp-prep/${UID}/${prepId}.mp4`, mp4(DUREE + 3))              // vidéo préparée par le moteur (mc-ref)
  st.put('render-media', `${UID}/mcp-src/${jobId}-src.mp4`, mp4(DUREE + 3))             // vidéo déposée dans la carte
  st.put('mcp-media', `${UID}/mcp-src/${jobId}-char.jpg`, new Uint8Array(900), 'image/jpeg')   // photo du personnage
  db.rows('mcp_jobs').push({ id: jobId, user_id: UID, kind: 'avatar', status: 'running', op_name: 'vn:' + prepId, credits_cost: 0, refunded: false,
    created_at: new Date().toISOString(), updated_at: new Date(Date.now() - 60_000).toISOString(),
    params: { video: true, tool: 'decup', n: N, perso: true, alt: { mirror: true, pixels: true, tint: true, audio: true, text: true }, text_pos: 'Haut', max_dur: DUREE,
      src_path: `${UID}/mcp-src/${jobId}-src.mp4`, char_path: `${UID}/mcp-src/${jobId}-char.jpg` } })
}
const mj = () => db.rows('mcp_jobs').find((r) => r.id === jobId)!
const solde = () => db.rows('profiles').find((r) => r.id === UID)!.credits_remaining as number

// ── Moteur de rendu factice : MÊMES règles d'entrée que render-worker (entreesJobSures avant tout, puis chaque lecture) ──
const lisible = (job: any, p: string) => typeof (W as any).cheminLisibleJob === 'function' ? (W as any).cheminLisibleJob(job, p) : W.cheminSur(String(job.user_id), p)
let panneMoteur = false
function moteur() {
  for (const rj of db.rows('render_jobs').filter((r) => r.status === 'queued' && r.plan?.__compose === 'decupleur')) {
    if (panneMoteur) { Object.assign(rj, { status: 'failed', error: 'panne du moteur' }); continue }
    if (!W.entreesJobSures(rj)) { Object.assign(rj, { status: 'failed', error: "Fichier d'entrée refusé" }); continue }
    const entrees = [rj.input_video, ...(rj.assets || []).map((a: any) => a.path)]
    const ko = entrees.find((p) => !lisible(rj, p) || !st.has('render-media', p))
    if (ko) { Object.assign(rj, { status: 'failed', error: 'download ' + ko + ': Object not found' }); continue }
    const pre = `${rj.user_id}/dc-${rj.id}`
    const variantes = Array.from({ length: rj.plan.n }, (_, i) => ({ fichier: `v${String(i + 1).padStart(2, '0')}.mp4`, affiche: `v${String(i + 1).padStart(2, '0')}.jpg` }))
    for (const v of variantes) { st.put('render-media', `${pre}/${v.fichier}`, new Uint8Array(100)); st.put('render-media', `${pre}/${v.affiche}`, new Uint8Array(10), 'image/jpeg') }
    st.put('render-media', `${pre}/dc.json`, new TextEncoder().encode(JSON.stringify({ variantes, controle: 'ok', faibles: 0, passage: DUREE })), 'application/json')
    Object.assign(rj, { status: 'done', output_url: `${pre}/dc.json`, progress: 100 })
  }
}
// La carte sonde /status ; entre deux sondes, le moteur travaille et l'attaquant agit (hook)
async function sonder(hook?: (op: string) => void, max = 12): Promise<any> {
  let r: any = null
  for (let i = 0; i < max; i++) {
    mj().updated_at = new Date(Date.now() - 60_000).toISOString()   // verrou de 8 s de /status écoulé
    const res = await handler(new Request(`https://mcp.avatarads.fr/mcp/status/${jobId}`))
    r = await res.json()
    if (r.status === 'done' || r.status === 'failed') return r
    hook?.(String(mj().op_name || ''))
    moteur()
  }
  return r
}
// Le client a-t-il la vidéo du personnage ? (fichier lisible dans SON dossier, ou lien donné par la carte)
const persoChezClient = (r: any) => st.duClient(UID).some((p) => { const x = st.o.get(st.k('render-media', p))!; return x.bytes.length === PERSO_BYTES.length && x.bytes[0] === 7 }) || !!r?.perso

const res: [string, boolean][] = []
const ok = (n: string, c: boolean, d = '') => { res.push([n, c]); keep((c ? '  ✓ ' : '  ✗ ') + n + (c ? '' : ' — ' + d + '\n    ' + logs.slice(-4).join('\n    '))) }
let r: any

// ── 1. L'ATTAQUE DE L'AUDIT : pendant le changement de personnage, le client vide tout ce qu'il peut dans son dossier ──
keep('1. Attaque : le client supprime l’entrée du lot pendant la génération du personnage')
preparer(); panneMoteur = false
let supprimes: string[] = []
r = await sonder((op) => { if (op.startsWith('dw:') && !supprimes.length) supprimes = st.clientSupprimeTout(UID) })
const rendu1 = solde() - (SOLDE - COUT)
ok(`débit au lancement = ${COUT} crédits (${VAR} variantes + ${PERSO} personnage)`, db.rows('debits').some((d) => d.job_id === jobId && d.amt === COUT), JSON.stringify(db.rows('debits')))
ok('l’attaquant a bien supprimé des fichiers de son dossier pendant la génération', supprimes.length > 0, JSON.stringify(supprimes))
ok(`jamais « personnage obtenu + plus que la part variantes rendue » (rendu : ${rendu1} crédits, personnage chez le client : ${persoChezClient(r)})`,
  !(persoChezClient(r) && rendu1 > VAR), `statut=${r?.status} rendu=${rendu1} perso=${persoChezClient(r)}`)
ok('le personnage, livré, reste payé : au plus la part variantes rendue', rendu1 <= VAR, `rendu=${rendu1}`)

// ── 2. Le lot échoue pour une autre raison (moteur en panne) APRÈS la vidéo du personnage ──
keep('2. Lot en échec après la vidéo du personnage (panne du moteur)')
preparer(); panneMoteur = true
r = await sonder()
panneMoteur = false
const rendu2 = solde() - (SOLDE - COUT)
ok('job en échec', r?.status === 'failed' && mj().status === 'failed', JSON.stringify(r))
ok(`seule la part variantes est rendue (${VAR} crédits, pas ${COUT})`, rendu2 === VAR, `rendu=${rendu2}`)
ok('la carte livre quand même la vidéo du personnage (lien signé dans le statut)', typeof r?.perso === 'string' && r.perso.startsWith(SIGNE), JSON.stringify(r))
ok('la vidéo du personnage n’est PAS dans un dossier que le client peut modifier', !st.duClient(UID).some((p) => /-perso\.mp4$/.test(p)), JSON.stringify(st.duClient(UID)))

// ── 3. Entrée du lot disparue avant le lancement : le lot n'est pas lancé, part variantes rendue, personnage livré ──
keep('3. Entrée disparue juste avant le lancement du lot')
preparer()
r = await sonder((op) => { if (op.startsWith('dw:')) { const b = String(mj().params.base_path || ''); if (b) st.o.delete(st.k('render-media', b)) } })
const rendu3 = solde() - (SOLDE - COUT)
ok('aucun lot de variantes lancé sans entrée', !db.rows('render_jobs').some((x) => x.plan?.__compose === 'decupleur'), JSON.stringify(db.rows('render_jobs').map((x) => [x.plan?.__compose, x.status, x.input_video])))
ok(`part variantes seule rendue (${VAR})`, rendu3 === VAR, `rendu=${rendu3} statut=${r?.status}`)
ok('vidéo du personnage livrée dans le statut', typeof r?.perso === 'string' && r.perso.startsWith(SIGNE), JSON.stringify(r))

// ── 4. Non-régression : le changement de personnage échoue chez kie → TOUT est rendu ──
keep('4. Personnage refusé par kie : remboursement total (inchangé)')
preparer(); kieEtat = 'fail'
r = await sonder()
const rendu4 = solde() - (SOLDE - COUT)
ok(`échec + ${COUT} crédits rendus`, r?.status === 'failed' && rendu4 === COUT, `statut=${r?.status} rendu=${rendu4}`)
ok('aucun lien de personnage', !r?.perso, JSON.stringify(r))

// ── 5. Non-régression : parcours normal ──
keep('5. Parcours normal')
preparer()
r = await sonder()
const rendu5 = solde() - (SOLDE - COUT)
ok(`${N} variantes livrées`, r?.status === 'done' && Array.isArray(r.variants) && r.variants.length === N && r.variants.every((v: any) => !!v.url), JSON.stringify(r))
ok('vidéo du personnage livrée', typeof r?.perso === 'string' && r.perso.startsWith(SIGNE), JSON.stringify(r))
ok('rien rendu', rendu5 === 0, `rendu=${rendu5}`)
ok('vidéo préparée et entrée du lot supprimées en fin de job', !st.has('render-media', `mcp-prep/${UID}/${prepId}.mp4`) && !st.noms('render-media').some((p) => /-prep\.mp4$/.test(p)), JSON.stringify(st.noms('render-media')))
const lot5 = db.rows('render_jobs').find((x) => x.plan?.__compose === 'decupleur')
ok('le lot lit son entrée et la vidéo du personnage hors du dossier du client', !!lot5 && String(lot5.input_video).startsWith('mcp-prep/') && (lot5.assets || []).every((a: any) => String(a.path).startsWith('mcp-prep/')), JSON.stringify(lot5))

// ── 5 bis. Job d'avant le correctif, déjà remboursé à 100 % : jamais de lien du personnage offert après coup ──
keep('5 bis. Ancien job en échec remboursé à 100 %')
preparer()
Object.assign(mj(), { status: 'failed', refunded: true, op_name: 'dj:' + crypto.randomUUID(), params: { ...mj().params, perso_path: `${UID}/mcp-src/${jobId}-perso.mp4`, user_msg: 'La fabrication des variantes a échoué — crédits rendus, réessaie.' } })
st.put('render-media', `${UID}/mcp-src/${jobId}-perso.mp4`, PERSO_BYTES)
r = await (await handler(new Request(`https://mcp.avatarads.fr/mcp/status/${jobId}`))).json()
ok('pas de lien du personnage sur un échec remboursé à 100 %', r?.status === 'failed' && !r?.perso, JSON.stringify(r))

// ── 6. Moteur : le préfixe serveur n'est admis QUE pour un lot Décupleur, et seulement pour le compte du job ──
keep('6. Règle d’entrée du moteur (render-worker/securite.mjs)')
const lot = (uid: string, compose: string, input: string, master?: string) => ({ id: crypto.randomUUID(), user_id: uid, plan: { __compose: compose }, input_video: input, avatar_clips: [], assets: master ? [{ id: 'master', path: master, kind: 'video' }] : [] })
const P = `mcp-prep/${UID}/${prepId}.mp4`, M = `mcp-prep/${UID}/${jobId}-perso.mp4`
ok('lot Décupleur du compte : entrée + personnage sous mcp-prep/<uid>/ admis', W.entreesJobSures(lot(UID, 'decupleur', P, M)) && lisible(lot(UID, 'decupleur', P, M), P) && lisible(lot(UID, 'decupleur', P, M), M))
ok('mcp-prep d’un AUTRE compte refusé', !W.entreesJobSures(lot(AUTRE, 'decupleur', P, M)) && !lisible(lot(AUTRE, 'decupleur', P), P))
ok('mcp-prep refusé hors Décupleur (montage)', !W.entreesJobSures(lot(UID, 'montage', P)) && !lisible(lot(UID, 'montage', P), P))
ok('chemins piégés refusés', ![`mcp-prep/${UID}/../${AUTRE}/x.mp4`, `mcp-prep/${UID}/%2e%2e/x.mp4`, `mcp-prep/${UID}/x.mp4.jpg`, `mcp-prep/${UID}/sous/x.mp4`].some((p) => W.entreesJobSures(lot(UID, 'decupleur', p))))
ok('chemins du compte toujours admis (app)', W.entreesJobSures(lot(UID, 'decupleur', `${UID}/dc-src-1.mp4`, `${UID}/kie/abcdef12.mp4`)))

// ── 7. Purge : les nouveaux fichiers serveur sont bien nettoyés (purge-decupleur + list_decupleur_purge) ──
keep('7. Purge des fichiers du Décupleur')
const srcPurge = await Deno.readTextFile(new URL('../../supabase/functions/purge-decupleur/index.ts', import.meta.url))
const SUR = new RegExp(srcPurge.match(/const SUR = \/(.+)\/\n/)![1])
const sql = await Deno.readTextFile(new URL('../../supabase/migrations/20261025010000_decupleur_purge.sql', import.meta.url))
const sqlPrep = new RegExp(sql.match(/o\.name ~ '(\^mcp-prep\/[^']+)'/)![1])
for (const p of [P, M]) ok(`purgé à 3 jours : ${p.replace(UID, '<uid>').replace(prepId, '<rendu>').replace(jobId, '<job>')}`, SUR.test(p) && sqlPrep.test(p))

const nok = res.filter(([, c]) => !c).length
keep(`\n${res.length - nok}/${res.length} vérifications OK`)
Deno.exit(nok ? 1 : 0)
