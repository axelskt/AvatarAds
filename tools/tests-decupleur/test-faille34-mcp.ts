// Banc de la relecture du 30/10 (failles 3 et 4 du Décupleur, côté OUTILS CLAUDE) : les préparations gratuites du MCP
// (dc-fetch d'un lien, mc-ref d'une vidéo déposée) étaient créées par « comptage puis insertion » sans verrou — 30 cartes
// (30 par heure et par compte) puis 30 POST /start envoyés au même instant donnaient 30 jobs gratuits, servis devant tous
// les rendus payés ; et decupler_video n'avait ni quota de liens ni « 1 récupération en cours ».
// Rejoue le CODE RÉEL de supabase/functions/mcp/index.ts (routes /start et /status) sur la base factice avec latence
// (fake-supabase-file.ts : 30 requêtes simultanées s'entremêlent ; render_job_dc_creer = modèle de la migration
// 20261030140000, dont le SQL réel est rejoué par test-faille34-sql.ts). Aucun réseau, aucune vraie vidéo, aucun fournisseur.
//   cd tools/tests-decupleur && deno run --allow-env --allow-read --import-map=import_map_file.json test-faille34-mcp.ts
//   MCP_MODULE=/chemin/mcp/index.ts …  → une autre version (AVANT : voir ab-faille34.sh)
import { FakeDB, FakeStorage, rpcsDecupleur, jobsDe } from './fake-supabase-file.ts'
import { rpcsCreditsMcp } from './fake-supabase-dc.ts'

for (const [k, v] of Object.entries({ SUPABASE_URL: 'https://test.local', SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'a', KIEAI_API_KEY: 'k', FAL_KEY: 'f', DECUPLEUR_OUVERT: '1' })) Deno.env.set(k, v)
const keep = console.log
let logs: string[] = []
for (const m of ['log', 'warn', 'error', 'info'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))
globalThis.fetch = (async (u: unknown) => { throw new Error('réseau interdit dans le banc : ' + String(u instanceof Request ? u.url : u)) }) as typeof fetch

const db = new FakeDB(); (globalThis as any).__db = db
if (Deno.env.get('MIGRATION') === '1er') (globalThis as any).__migration1er = true   // ab-faille34.sh : base du 1er correctif
const st = new FakeStorage(); (globalThis as any).__st = st
const MODULE = Deno.env.get('MCP_MODULE') || new URL('../../supabase/functions/mcp/index.ts', import.meta.url).pathname
const atomique = Deno.readTextFileSync(MODULE).includes('creerPrepMcp')
await import('file://' + MODULE)
const handler = (globalThis as any).__handler as (r: Request) => Promise<Response>

const PRO = '11111111-2222-4333-8444-555555555555', PRO2 = '22222222-2222-4333-8444-555555555555', OWNER = '33333333-2222-4333-8444-555555555555'
const LIEN = 'https://www.tiktok.com/@client/video/7400000000000000001'
function reset() {
  for (const k of Object.keys(db.t)) delete db.t[k]
  db.rpcs = { ...rpcsDecupleur(db), ...rpcsCreditsMcp(db), rate_hit: () => true } as any
  db.pannes.clear(); logs = []; st.o.clear()
  db.rows('profiles').push({ id: PRO, plan: 'pro', is_owner: false, credits_remaining: 500 }, { id: PRO2, plan: 'pro', is_owner: false, credits_remaining: 500 },
    { id: OWNER, plan: 'elite', is_owner: true, credits_remaining: 0 })
}
// cap de la carte : HMAC-SHA256('cap:' + job) avec la clé service (= jobCap du MCP)
async function cap(job: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('x'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('cap:' + job)))
  return Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
// une carte « pending » telle que vtCarte la crée (outil decup avec lien, decup avec fichier, Omni) ; vidéo déjà déposée
function carte(uid: string, tool: 'decup' | 'omni_edit', lien = false): string {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  const src = `${uid}/mcp-src/${id}-src.mp4`
  if (!lien) st.put('render-media', src, new Uint8Array(4000), 'video/mp4')
  const params: Record<string, unknown> = tool === 'decup'
    ? { video: true, tool, n: 10, perso: false, alt: {}, text_pos: 'Haut', max_dur: 30, ...(lien ? { lien: LIEN } : { src_path: src }) }
    : { video: true, tool, prompt: 'mets-lui une veste en cuir', resolution: '720p', max_dur: 10, src_path: src }
  db.rows('mcp_jobs').push({ id, user_id: uid, kind: 'avatar', status: 'pending', credits_cost: 0, refunded: false, params, created_at: now, updated_at: now })
  return id
}
async function start(job: string) {
  const r = await handler(new Request('https://mcp.avatarads.fr/mcp/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ job, cap: await cap(job) }) }))
  return { status: r.status, j: await r.json().catch(() => ({})) as Record<string, any> }
}
const mj = (id: string) => db.rows('mcp_jobs').find((r) => r.id === id)!
const finir = (uid: string) => { for (const r of jobsDe(db, uid)) if (r.status === 'queued' || r.status === 'rendering') r.status = 'done' }

let nOk = 0, nKo = 0
const ok = (nom: string, c: boolean, d = '') => { if (c) nOk++; else nKo++; keep(`${c ? '  ✓' : '  ✗'} ${nom}${c || !d ? '' : '  → ' + d}`) }
keep(`mcp : ${MODULE}${atomique ? '' : '  (version SANS création atomique des préparations)'}`)

// ── M1. 30 cartes decupler_video (lien TikTok) + 30 /start simultanés, requêtes en phase ──
for (const [nom, tool, lien] of [['M1. 30 /start decupler_video (lien) simultanés', 'decup', true], ['M2. 30 /start edit_video (Omni, vidéo déposée) simultanés', 'omni_edit', false],
  ['M3. 30 /start decupler_video (vidéo déposée) simultanés', 'decup', false]] as const) {
  keep(nom)
  reset(); (globalThis as any).__latenceFixe = true
  const ids = Array.from({ length: 30 }, () => carte(PRO, tool, lien))
  const rs = await Promise.all(ids.map(start))
  const gratuits = jobsDe(db, PRO).filter((r) => ['dc-fetch', 'mc-ref'].includes(r.plan?.__compose)).length
  const pend = ids.filter((id) => mj(id).status === 'pending').length, ech = ids.filter((id) => mj(id).status === 'failed').length
  keep(`     → ${gratuits} travaux gratuits créés ; ${rs.filter((r) => r.status === 200).length} × 200, ${rs.filter((r) => r.status === 429).length} × 429 ; cartes en attente (relance) ${pend}, en échec ${ech}`)
  ok('au plus 1 travail gratuit créé pour le compte', gratuits <= 1, String(gratuits))
  ok('chaque 200 = un job réel ; chaque refus = 429 « busy » (la carte relance seule)', rs.filter((r) => r.status === 200).length === gratuits
    && rs.filter((r) => r.status !== 200).every((r) => r.status === 429 && r.j.error === 'busy'), JSON.stringify(rs.filter((r) => r.status !== 200 && r.status !== 429).slice(0, 2)))
  ok('les cartes refusées restent relançables (pending), aucune en échec', pend === 30 - gratuits && ech === 0, `${pend} pending, ${ech} failed`)
}
(globalThis as any).__latenceFixe = false

// ── M4. Parcours honnête : une carte Omni, puis une carte Décupleur par lien ──
keep('M4. client honnête : 1 carte Omni, puis 1 carte Décupleur (lien) une fois la 1re préparée')
reset()
{
  const a = carte(PRO, 'omni_edit'), ra = await start(a)
  const rj = jobsDe(db, PRO, 'mc-ref')[0]
  ok('Omni : 200 et étape vn:<préparation>', ra.status === 200 && mj(a).status === 'running' && mj(a).op_name === 'vn:' + rj?.id, JSON.stringify([ra, mj(a).op_name]))
  ok('préparation telle qu’avant (maxDur 10, crop916, entrée = vidéo déposée)', rj?.plan?.maxDur === 10 && rj.plan.crop916 === true && rj.plan.minDur === false && rj.input_video === mj(a).params.src_path, JSON.stringify(rj))
  const b = carte(PRO, 'decup', true), rb0 = await start(b)
  ok('Décupleur pendant la préparation Omni : 429 busy, carte toujours « pending »', rb0.status === 429 && mj(b).status === 'pending', JSON.stringify(rb0))
  finir(PRO)
  const rb = await start(b), f = jobsDe(db, PRO, 'dc-fetch')[0]
  ok('préparation finie : la carte relancée passe (df:<récupération>)', rb.status === 200 && mj(b).op_name === 'df:' + f?.id, JSON.stringify([rb, mj(b).op_name]))
  ok('récupération telle qu’avant (plan { __compose, lien, duration }, clé dc-lien-…)', f?.plan?.lien === LIEN && f.plan.duration === 1 && Object.keys(f.plan).length === 3 && new RegExp(`^${PRO}/dc-lien-\\d+\\.mp4$`).test(f.input_video), JSON.stringify(f))
}

// ── M5. Quota de liens par le MCP (6 par 10 min, comptés avec l'app) ; owner / developer : pas de quota ──
keep('M5. 7 cartes decupler_video (lien) à la suite (chaque récupération finie avant la suivante)')
reset()
{
  const s: number[] = []
  for (let i = 0; i < 7; i++) { s.push((await start(carte(PRO, 'decup', true))).status); finir(PRO) }
  keep(`     → statuts : ${s.join(' ')}`)
  ok('6 passent, la 7e est refusée (429, carte relançable)', s.slice(0, 6).every((x) => x === 200) && s[6] === 429, s.join(' '))
  const o: number[] = []
  for (let i = 0; i < 7; i++) { o.push((await start(carte(OWNER, 'decup', true))).status); finir(OWNER) }
  ok('compte propriétaire : 7 passent (pas de quota, 1 en cours seulement)', o.every((x) => x === 200), o.join(' '))
}

// ── M6. Suite du parcours lien → préparation (étape df:) : bornée elle aussi, et jamais perdue ──
keep('M6. récupération finie ; une découpe de l’app tourne pour le même compte ; la carte sonde /status')
if (!atomique) keep('  · sans objet sur cette version (pas de creerPrepMcp)')
else {
  reset()
  const id = carte(PRO, 'decup', true)
  await start(id)
  const f = jobsDe(db, PRO, 'dc-fetch')[0]
  Object.assign(f, { status: 'done', output_url: `${PRO}/${f.id}.mp4` })
  st.put('render-media', `${PRO}/${f.id}.mp4`, new Uint8Array(3000))
  const now = new Date().toISOString()
  db.rows('render_jobs').push({ id: crypto.randomUUID(), user_id: PRO, status: 'rendering', plan: { __compose: 'dc-cut', a: 0, b: 5 }, input_video: `${PRO}/x.mp4`, assets: [], avatar_clips: [], created_at: now, updated_at: now, attempts: 1 })
  const sonde = async () => { mj(id).updated_at = new Date(Date.now() - 60_000).toISOString(); await handler(new Request(`https://mcp.avatarads.fr/mcp/status/${id}`)) }
  await sonde()
  ok('découpe en cours : aucune préparation créée, étape remise à df: (nouvel essai à la sonde suivante)', jobsDe(db, PRO, 'mc-ref').length === 0 && mj(id).op_name === 'df:' + f.id && mj(id).status === 'running', JSON.stringify([mj(id).op_name, mj(id).status]))
  finir(PRO)
  await sonde()
  const p = jobsDe(db, PRO, 'mc-ref')[0]
  ok('découpe finie : préparation créée (mc-ref de la vidéo du lien), étape vn:<id>', !!p && p.input_video === `${PRO}/${f.id}.mp4` && mj(id).op_name === 'vn:' + p.id, JSON.stringify([mj(id).op_name, p]))
}

// ── M7. Fonction de création en panne : jamais l'ancienne insertion sans plafond ; la carte est close sans débit ──
keep('M7. render_job_dc_creer en panne')
if (!atomique) keep('  · sans objet sur cette version')
else {
  reset(); db.pannes.add('rpc:render_job_dc_creer')
  const id = carte(PRO, 'omni_edit'), r = await start(id)
  ok('500 « prep », aucun job créé, carte en échec (rien n’a été débité)', r.status === 500 && db.rows('render_jobs').length === 0 && mj(id).status === 'failed' && !db.rows('debits').length, JSON.stringify([r, mj(id).status]))
}

// ── M8. Deux comptes en rafale en même temps : chacun le sien ──
keep('M8. 2 comptes × 15 /start Omni simultanés')
reset()
{
  await Promise.all([...Array.from({ length: 15 }, () => start(carte(PRO, 'omni_edit'))), ...Array.from({ length: 15 }, () => start(carte(PRO2, 'omni_edit')))])
  const a = jobsDe(db, PRO, 'mc-ref').length, b = jobsDe(db, PRO2, 'mc-ref').length
  keep(`     → compte 1 : ${a}, compte 2 : ${b}`)
  ok('1 préparation par compte, aucun ne bloque l’autre', a === 1 && b === 1, `${a} / ${b}`)
}

keep(`\n${nKo === 0 ? '✓' : '✗'} ${nOk}/${nOk + nKo} vérifications OK`)
if (nKo) { keep('— journaux —'); for (const l of logs.slice(-15)) keep('   ' + l.slice(0, 200)) }
Deno.exit(nKo ? 1 : 0)
