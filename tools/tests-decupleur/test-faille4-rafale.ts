// Banc de l'audit Décupleur du 30/10, faille 4 (« le plafond de 3 jobs en cours par compte se contourne avec des requêtes
// simultanées ») et partie render-job de la faille 3 (1 récupération de lien en cours par compte, quota de 6 par 10 min).
// Rejoue le CODE RÉEL de supabase/functions/render-job/index.ts (actions dc-fetch, dc-cut, decupleur) sur une base factice
// avec latence réseau (fake-supabase-file.ts) : 30 requêtes envoyées au même instant s'entremêlent comme en vrai. Aucun
// réseau, aucune vraie vidéo, aucun appel à un fournisseur.
//   cd tools/tests-decupleur && deno run --allow-env --allow-read --import-map=import_map_file.json test-faille4-rafale.ts
//   RJ_MODULE=/chemin/render-job/index.ts …  → une autre version (AVANT : voir ab-faille34.sh ; le dossier doit contenir
//   ../_shared/ à côté de render-job/, comme dans le dépôt)
import { FakeDB, FakeStorage, rpcsDecupleur, jobsDe } from './fake-supabase-file.ts'

for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://test.local', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'a', DECUPLEUR_OUVERT: '1' })) Deno.env.set(k, v)
const keep = console.log
let logs: string[] = []
for (const m of ['log', 'warn', 'error', 'info'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))
globalThis.fetch = (async (u: unknown) => { throw new Error('réseau interdit dans le banc : ' + String(u)) }) as typeof fetch

const db = new FakeDB(); (globalThis as any).__db = db
if (Deno.env.get('MIGRATION') === '1er') (globalThis as any).__migration1er = true   // ab-faille34.sh : base du 1er correctif
const st = new FakeStorage(); (globalThis as any).__st = st
const MODULE = Deno.env.get('RJ_MODULE') || new URL('../../supabase/functions/render-job/index.ts', import.meta.url).pathname
const source = Deno.readTextFileSync(MODULE)
const atomique = source.includes('render_job_dc_creer')
await import('file://' + MODULE)
const handler = (globalThis as any).__handler as (r: Request) => Promise<Response>

const PRO = '11111111-2222-4333-8444-555555555555', PRO2 = '22222222-2222-4333-8444-555555555555'
const OWNER = '33333333-2222-4333-8444-555555555555', FREE = '44444444-2222-4333-8444-555555555555'
const LIEN = 'https://www.tiktok.com/@client/video/7400000000000000001'
function reset() {
  for (const k of Object.keys(db.t)) delete db.t[k]
  db.rpcs = rpcsDecupleur(db) as any
  db.pannes.clear(); logs = []
  db.tokens = { 'tok-pro': { id: PRO }, 'tok-pro2': { id: PRO2 }, 'tok-owner': { id: OWNER }, 'tok-free': { id: FREE } }
  db.rows('profiles').push({ id: PRO, plan: 'pro', is_owner: false }, { id: PRO2, plan: 'starter', is_owner: false },
    { id: OWNER, plan: 'elite', is_owner: true }, { id: FREE, plan: 'free', is_owner: false })
}
async function appel(tok: string, body: Record<string, unknown>) {
  const r = await handler(new Request('https://fn.test/render-job', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: r.status, j: await r.json().catch(() => ({})) as Record<string, any> }
}
const finir = (uid: string) => { for (const r of jobsDe(db, uid)) if (r.status === 'queued' || r.status === 'rendering') r.status = 'done' }

let nOk = 0, nKo = 0, nSans = 0
const ok = (nom: string, c: boolean, detail = '') => { if (c) nOk++; else nKo++; keep(`${c ? '  ✓' : '  ✗'} ${nom}${c || !detail ? '' : '  → ' + detail}`) }
const sansObjet = (nom: string) => { nSans++; keep(`  · ${nom} : sans objet sur cette version (pas de render_job_dc_creer)`) }
keep(`render-job : ${MODULE}${atomique ? '' : '  (version SANS création atomique)'}`)
// relecture 30/10 : le modèle de render_job_dc_creer (fake-supabase-file.ts) applique « 1 travail gratuit court par compte »
// et le quota de découpes même quand render-job ne les passe pas (valeurs par défaut de la fonction SQL)

// ── S1. Faille 4 : 30 récupérations de lien envoyées au même instant par un abonné Pro ──
// S1 : requêtes en phase (latence fixe : les 30 comptages passent avant la 1re insertion, le cas de l'audit) ;
// S1b : latence variable (entremêlement partiel). Les autres scénarios : latence variable.
for (const fixe of [true, false]) {
keep(fixe ? 'S1. 30 dc-fetch simultanés (même compte), requêtes en phase' : 'S1b. 30 dc-fetch simultanés (même compte), latence variable')
reset(); (globalThis as any).__latenceFixe = fixe
{
  const rs = await Promise.all(Array.from({ length: 30 }, () => appel('tok-pro', { action: 'dc-fetch', url: LIEN })))
  const crees = jobsDe(db, PRO, 'dc-fetch').length, acceptes = rs.filter((r) => r.status === 200).length
  keep(`     → ${crees} jobs dc-fetch créés, ${acceptes} réponses 200, ${rs.filter((r) => r.status === 429).length} refus 429`)
  ok('au plus 3 jobs créés (plafond « 3 en cours » respecté même en rafale)', crees <= 3, `${crees} créés`)
  ok('au plus 1 récupération de lien en cours pour le compte', crees <= 1, `${crees} créés`)
  ok('chaque réponse 200 correspond à un job réel, chaque refus est un 429 lisible', acceptes === crees && rs.every((r) => r.status === 200 || (r.status === 429 && /en cours|récupér/i.test(String(r.j.error)))),
    JSON.stringify(rs.filter((r) => r.status !== 200).slice(0, 2)))
}
}
(globalThis as any).__latenceFixe = false

// ── S2. 30 découpes simultanées : le plafond de 3 tient ──
keep('S2. 30 dc-cut simultanés (même compte)')
reset()
{
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => appel('tok-pro', { action: 'dc-cut', input_video: `${PRO}/src-${i}.mp4`, a: 0, b: 5 })))
  const crees = jobsDe(db, PRO, 'dc-cut').length
  keep(`     → ${crees} jobs dc-cut créés`)
  ok('au plus 3 découpes créées', crees <= 3, `${crees} créées`)
  ok('relecture 30/10 : au plus 1 découpe en file ou en cours (aucune gardée d’avance dans la file)', crees <= 1, `${crees} créées`)
  ok('les refus sont des 429 « déjà en cours »', rs.filter((r) => r.status !== 200).every((r) => r.status === 429 && /en cours/.test(String(r.j.error))))
}

// ── S3. Deux comptes en rafale en même temps : chacun son plafond, aucun ne bloque l'autre ──
keep('S3. 2 comptes × 15 dc-fetch simultanés')
reset()
{
  await Promise.all([...Array.from({ length: 15 }, () => appel('tok-pro', { action: 'dc-fetch', url: LIEN })), ...Array.from({ length: 15 }, () => appel('tok-pro2', { action: 'dc-fetch', url: LIEN }))])
  const a = jobsDe(db, PRO, 'dc-fetch').length, b = jobsDe(db, PRO2, 'dc-fetch').length
  keep(`     → compte 1 : ${a}, compte 2 : ${b}`)
  ok('au plus 1 récupération en cours par compte', a <= 1 && b <= 1, `${a} / ${b}`)
  ok('chaque compte obtient bien SA récupération', a === 1 && b === 1, `${a} / ${b}`)
}

// ── S4. Quota : 7 récupérations à la suite (chacune terminée avant la suivante) ──
keep('S4. 7 dc-fetch à la suite en moins de 10 min')
reset()
{
  const st7: number[] = []
  for (let i = 0; i < 7; i++) { st7.push((await appel('tok-pro', { action: 'dc-fetch', url: LIEN })).status); finir(PRO) }
  keep(`     → statuts : ${st7.join(' ')}`)
  ok('les 6 premières passent', st7.slice(0, 6).every((s) => s === 200), st7.join(' '))
  ok('la 7e est refusée (6 par 10 min)', st7[6] === 429, st7.join(' '))
}
// ── S5. Le quota glisse : des récupérations de plus de 10 min ne comptent plus ──
keep('S5. quota : 6 récupérations vieilles de 11 min, puis une nouvelle')
reset()
{
  for (let i = 0; i < 6; i++) { await appel('tok-pro', { action: 'dc-fetch', url: LIEN }); finir(PRO) }
  const vieux = new Date(Date.now() - 11 * 60_000).toISOString()
  for (const r of jobsDe(db, PRO, 'dc-fetch')) { r.created_at = vieux; r.updated_at = vieux }
  const r = await appel('tok-pro', { action: 'dc-fetch', url: LIEN })
  ok('acceptée', r.status === 200, JSON.stringify(r))
}
// ── S6. Une récupération en cours : 2e récupération et découpe attendent (relecture 30/10 : 1 travail gratuit court par compte),
//        puis la découpe passe dès la vidéo arrivée (parcours de l'app : lien → découpe → variantes, l'un après l'autre) ──
keep('S6. dc-fetch en cours, puis 2e dc-fetch et dc-cut ; puis dc-cut une fois la vidéo arrivée')
reset()
{
  const r1 = await appel('tok-pro', { action: 'dc-fetch', url: LIEN })
  const r2 = await appel('tok-pro', { action: 'dc-fetch', url: LIEN })
  const r3 = await appel('tok-pro', { action: 'dc-cut', input_video: `${PRO}/src.mp4`, a: 2, b: 9 })
  ok('1re récupération acceptée', r1.status === 200, JSON.stringify(r1))
  ok('2e récupération refusée tant que la 1re tourne (message clair)', r2.status === 429 && /récupération/.test(String(r2.j.error)), JSON.stringify(r2))
  ok('découpe pendant la récupération : 429 lisible (récupération ou découpe en cours)', r3.status === 429 && /récupération ou une découpe/.test(String(r3.j.error)), JSON.stringify(r3))
  finir(PRO)
  const r4 = await appel('tok-pro', { action: 'dc-cut', input_video: `${PRO}/src.mp4`, a: 2, b: 9 })
  ok('vidéo arrivée : la découpe passe', r4.status === 200, JSON.stringify(r4))
  const r5 = await appel('tok-pro', { action: 'decupleur', input_video: `${PRO}/src.mp4`, a: 2, b: 9, n: 5, alt: {}, textPos: 'Haut', ops: [] })
  ok('un lot de variantes n’est pas un travail court : jamais bloqué par la découpe en cours (refus seulement faute de réservation)', r5.status === 402, JSON.stringify(r5))
}

// ── S6b. Relecture 30/10 : quota de découpes (10 par 10 min), et une préparation MCP (mc-ref) en cours bloque la découpe ──
keep('S6b. 11 dc-cut à la suite ; dc-cut pendant une préparation mc-ref du MCP')
reset()
{
  const s11: number[] = []
  for (let i = 0; i < 11; i++) { s11.push((await appel('tok-pro', { action: 'dc-cut', input_video: `${PRO}/src.mp4`, a: 0, b: 5 })).status); finir(PRO) }
  keep(`     → statuts : ${s11.join(' ')}`)
  ok('les 10 premières passent, la 11e est refusée (429)', s11.slice(0, 10).every((x) => x === 200) && s11[10] === 429, s11.join(' '))
  reset()
  const now = new Date().toISOString()
  db.rows('render_jobs').push({ id: crypto.randomUUID(), user_id: PRO, status: 'queued', plan: { __compose: 'mc-ref', maxDur: 30 }, input_video: `${PRO}/mcp-src/x-src.mp4`, assets: [], avatar_clips: [], created_at: now, updated_at: now, attempts: 0 })
  const r = await appel('tok-pro', { action: 'dc-cut', input_video: `${PRO}/src.mp4`, a: 0, b: 5 })
  ok('préparation MCP du même compte en file : découpe refusée 429 (1 travail gratuit court par compte, app et MCP confondus)', r.status === 429, JSON.stringify(r))
  const r2 = await appel('tok-owner', { action: 'dc-cut', input_video: `${OWNER}/src.mp4`, a: 0, b: 5 })
  ok('un autre compte n’est pas touché', r2.status === 200, JSON.stringify(r2))
}

// ── S7. Client honnête : un lien TikTok normal de 30 s ──
keep('S7. client honnête : 1 lien TikTok')
reset()
{
  const r = await appel('tok-pro', { action: 'dc-fetch', url: LIEN })
  const j = jobsDe(db, PRO, 'dc-fetch')[0]
  ok('accepté (200, job_id)', r.status === 200 && typeof r.j.job_id === 'string' && j?.id === r.j.job_id, JSON.stringify(r))
  ok('job créé tel qu’avant (plan reconstruit, clé réservée dc-lien-…, en file)', !!j && j.status === 'queued' && j.plan?.__compose === 'dc-fetch' && j.plan?.lien === LIEN
    && j.plan?.duration === 1 && Object.keys(j.plan).length === 3 && new RegExp(`^${PRO}/dc-lien-\\d+\\.mp4$`).test(j.input_video) && Array.isArray(j.assets) && j.assets.length === 0, JSON.stringify(j))
  ok('un lien Instagram (Reel) passe aussi', (await (async () => { finir(PRO); return appel('tok-pro', { action: 'dc-fetch', url: 'https://www.instagram.com/reel/DAreel06/' }) })()).status === 200)
  ok('un lien hors TikTok / Instagram reste refusé (400)', (await appel('tok-pro', { action: 'dc-fetch', url: 'https://example.com/v.mp4' })).status === 400)
}

// ── S8. Parcours honnête complet : découpe puis 10 variantes payées ──
keep('S8. parcours payé : dc-cut puis decupleur ×10 (réservation de 5 crédits)')
reset()
{
  const OP = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  db.rows('credit_ops').push({ id: OP, user_id: PRO, amount: 5, reserved_remaining: 5 })
  const c = await appel('tok-pro', { action: 'dc-cut', input_video: `${PRO}/src.mp4`, a: 0, b: 10 })
  finir(PRO)
  const d = await appel('tok-pro', { action: 'decupleur', input_video: `${PRO}/src.mp4`, a: 0, b: 10, n: 10, alt: { mirror: true }, textPos: 'Haut', ops: [OP] })
  const j = jobsDe(db, PRO, 'decupleur')[0], o = db.rows('credit_ops')[0]
  ok('découpe acceptée', c.status === 200, JSON.stringify(c))
  ok('lot de variantes accepté', d.status === 200 && j?.id === d.j.job_id, JSON.stringify(d))
  ok('réservation tirée (5) et liée au job (render:<id>)', o.reserved_remaining === 0 && o.job_drawn === 5 && o.provider_job === 'render:' + j?.id, JSON.stringify(o))
  ok('plan du lot reconstruit (n = 10, passage 0–10 s)', j?.plan?.__compose === 'decupleur' && j.plan.n === 10 && j.plan.a === 0 && j.plan.b === 10, JSON.stringify(j?.plan))
}

// ── S9. Rafale de lots payés : au plus 3, et les crédits tirés pour les refusés sont RENDUS ──
keep('S9. 10 lots decupleur simultanés (10 réservations de 3 crédits)')
reset()
{
  const ops = Array.from({ length: 10 }, (_, i) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}`)
  for (const id of ops) db.rows('credit_ops').push({ id, user_id: PRO, amount: 3, reserved_remaining: 3 })
  const rs = await Promise.all(ops.map((op) => appel('tok-pro', { action: 'decupleur', input_video: `${PRO}/src.mp4`, a: 0, b: 6, n: 5, alt: {}, textPos: 'Haut', ops: [op] })))
  const crees = jobsDe(db, PRO, 'decupleur').length
  const lies = db.rows('credit_ops').filter((o) => o.provider_job).length
  const rendus = db.rows('credit_ops').filter((o) => !o.provider_job && o.reserved_remaining === 3).length
  keep(`     → ${crees} lots créés, ${lies} réservations liées, ${rendus} réservations rendues intactes`)
  ok('au plus 3 lots créés', crees <= 3, `${crees} créés`)
  ok('chaque refus a rendu ses crédits (aucune réservation tirée sans job)', lies === crees && lies + rendus === 10, `créés=${crees} liées=${lies} rendues=${rendus}`)
  ok('les refus sont des 429', rs.filter((r) => r.status !== 200).every((r) => r.status === 429), JSON.stringify(rs.map((r) => r.status)))
}

// ── S10. Panne de la fonction de création : refus net, crédits rendus, jamais l'ancienne insertion sans plafond ──
keep('S10. render_job_dc_creer en panne')
if (!atomique) sansObjet('S10')
else {
  reset()
  const OP = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  db.rows('credit_ops').push({ id: OP, user_id: PRO, amount: 5, reserved_remaining: 5 })
  db.pannes.add('rpc:render_job_dc_creer')
  const f = await appel('tok-pro', { action: 'dc-fetch', url: LIEN })
  const d = await appel('tok-pro', { action: 'decupleur', input_video: `${PRO}/src.mp4`, a: 0, b: 10, n: 10, alt: {}, textPos: 'Haut', ops: [OP] })
  ok('503 « réessaie », aucun job', f.status === 503 && d.status === 503 && db.rows('render_jobs').length === 0, JSON.stringify([f, d]))
  ok('réservation du lot rendue', db.rows('credit_ops')[0].reserved_remaining === 5, JSON.stringify(db.rows('credit_ops')[0]))
}

// ── S11. Owner / developer : pas de quota de récupérations (1 en cours seulement) ──
keep('S11. owner : 7 dc-fetch à la suite')
reset()
{
  const s: number[] = []
  for (let i = 0; i < 7; i++) { s.push((await appel('tok-owner', { action: 'dc-fetch', url: LIEN })).status); finir(OWNER) }
  ok('les 7 passent', s.every((x) => x === 200), s.join(' '))
}
// ── S12. Plan gratuit : toujours refusé ──
keep('S12. compte gratuit')
reset()
ok('403', (await appel('tok-free', { action: 'dc-fetch', url: LIEN })).status === 403)

keep(`\n${nKo === 0 ? '✓' : '✗'} ${nOk}/${nOk + nKo} vérifications OK${nSans ? ` (${nSans} sans objet)` : ''}`)
if (nKo) { keep('— journaux —'); for (const l of logs.slice(-15)) keep('   ' + l.slice(0, 200)) }
Deno.exit(nKo ? 1 : 0)
