// Banc de l'audit Décupleur du 30/10, faille 5 : « une image avec une adresse truquée (# ou &, suivie du dossier d'un autre
// compte) fait générer — payé par la plateforme chez le fournisseur — puis rembourser à 100 % ». Rejoue le CODE RÉEL de
// supabase/functions/kie-proxy/handler.ts (soumission, suivi, résultat) et de reconcile-kie/handler.ts (le filet), sur une base,
// un stockage et un kie.ai factices. AUCUN réseau : tout fetch hors des faux services lève une erreur ; aucune vraie vidéo
// (f5-ref-5s.mp4 = 5 s d'image noire 64×64 fabriquée localement).
//   cd tools/tests-decupleur && deno run --allow-env --allow-read --import-map=import_map_f5.json test-faille5.ts
// F5_FUNCS=<dossier supabase/functions d'un autre commit> rejoue le même banc sur ce code-là (ab-faille5.sh).
import { FakeDB, FakeStorage, rpcsReservation, signe, JETON } from './fake-supabase-f5.ts'

const SUPABASE_URL = 'https://test.local'
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'a', KIEAI_API_KEY: 'k', DECUPLEUR_OUVERT: '1', CRON_SECRET: 'cron-banc', RESERVE_ENFORCE: '1' })) Deno.env.set(k, v)
const keep = console.log
let logs: string[] = []
for (const m of ['log', 'warn', 'error', 'info'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))

const db = new FakeDB(); (globalThis as any).__db = db
Object.assign(db.rpcs, rpcsReservation(db))
const st = new FakeStorage(); (globalThis as any).__st = st
try { (Deno as any).resolveDns = async (_h: string, t: string) => t === 'A' ? ['93.184.216.34'] : [] } catch { Object.defineProperty(Deno, 'resolveDns', { value: async (_h: string, t: string) => t === 'A' ? ['93.184.216.34'] : [] }) }

const STORE = `${SUPABASE_URL}/storage/v1/object/sign/render-media/`
const UID = '11111111-2222-4333-8444-555555555555'      // l'attaquant (abonné Élite)
const AUTRE = '99999999-2222-4333-8444-555555555555'    // un autre compte (la victime dont le dossier est cité)
db.tokens = { tokA: { id: UID }, tokB: { id: AUTRE } }
const REF = await Deno.readFile(new URL('./f5-ref-5s.mp4', import.meta.url))
const JPG = new Uint8Array(4000).fill(9); JPG[0] = 0xff; JPG[1] = 0xd8
function wav(sec: number): Uint8Array {   // PCM 16 bits mono 16 kHz, signal non nul (pas de silence de fin)
  const sr = 16000, n = sr * sec, b = new Uint8Array(44 + n * 2), dv = new DataView(b.buffer)
  const w = (o: number, s: string) => [...s].forEach((c, i) => b[o + i] = c.charCodeAt(0))
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  w(36, 'data'); dv.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, (i % 40 < 20 ? 3000 : -3000), true)
  return b
}
const WAV = wav(3)

// ── Stockage servi comme le vrai : le fragment (#…) n'est jamais envoyé, les paramètres en trop (&…) sont ignorés ──
function servirStockage(s: string, range?: string | null): Response {
  const u = new URL(s)
  if (!u.pathname.startsWith('/storage/v1/object/sign/') || u.searchParams.get('token') !== JETON) return new Response('{"error":"InvalidJWT"}', { status: 400 })
  const [b, ...rest] = decodeURIComponent(u.pathname.slice('/storage/v1/object/sign/'.length)).split('/')
  const x = st.o.get(st.k(b, rest.join('/')))
  if (!x) return new Response('{"error":"not_found"}', { status: 404 })
  void range
  return new Response(x.bytes as BodyInit, { status: 200, headers: { 'content-type': x.mime, 'content-length': String(x.bytes.length) } })
}

// ── kie.ai factice : à la création, il TÉLÉCHARGE les entrées (comme le vrai) ; tâche réussie = facturée à la plateforme ──
type Tache = { fam: 'mk' | 'veo'; body: Record<string, any>; etat: 'success' | 'fail'; param?: string }
const taches = new Map<string, Tache>()
let factureKie = 0, nTache = 0
const entrees = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') { if (v.startsWith(SUPABASE_URL + '/storage/')) out.push(v) }
  else if (Array.isArray(v)) v.forEach((x) => entrees(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => entrees(x, out))
  return out
}
function creer(fam: 'mk' | 'veo', body: Record<string, any>): Response {
  const id = 'tache' + String(++nTache).padStart(6, '0')
  const ok = entrees(body).every((u) => servirStockage(u).status === 200)
  if (ok) factureKie++
  taches.set(id, { fam, body, etat: ok ? 'success' : 'fail' })
  return Response.json({ code: 200, data: { taskId: id } })
}
const resultat = (id: string) => `https://tempfile.aiquickdraw.com/r/${id}`
globalThis.fetch = (async (u: any, o: any) => {
  const s = String(u instanceof Request ? u.url : u)
  if (s.startsWith(SUPABASE_URL + '/storage/v1/object/sign/')) return servirStockage(s, o?.headers?.Range)
  if (s === 'https://api.kie.ai/api/v1/jobs/createTask') return creer('mk', JSON.parse(o.body))
  if (s === 'https://api.kie.ai/api/v1/veo/generate') return creer('veo', JSON.parse(o.body))
  const m = s.match(/^https:\/\/api\.kie\.ai\/api\/v1\/(jobs\/recordInfo|veo\/record-info)\?taskId=(.+)$/)
  if (m) {
    const t = taches.get(decodeURIComponent(m[2])); if (!t) return Response.json({ code: 404, msg: 'record not found' })
    const param = t.param ?? JSON.stringify(t.body), id = decodeURIComponent(m[2])
    if (t.fam === 'veo') return Response.json({ code: 200, data: t.etat === 'success'
      ? { successFlag: 1, paramJson: param, response: { resultUrls: [resultat(id)] } } : { successFlag: 2, paramJson: param, errorMessage: 'failed' } })
    return Response.json({ code: 200, data: t.etat === 'success'
      ? { state: 'success', param, resultJson: JSON.stringify({ resultUrls: [resultat(id)] }) } : { state: 'fail', param, failMsg: 'generation failed', failCode: '500' } })
  }
  if (s.startsWith('https://tempfile.aiquickdraw.com/r/')) {
    const t = taches.get(s.split('/').pop() as string)
    const bytes = t?.body?.model === 'nano-banana-pro' ? JPG : REF
    return new Response(bytes as BodyInit, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) } })
  }
  throw new Error('réseau interdit dans le banc : ' + s + ' ' + (o?.method || 'GET'))
}) as typeof fetch

const FUNCS = Deno.env.get('F5_FUNCS') || '../../supabase/functions'
const mod = (p: string) => FUNCS.startsWith('/') ? 'file://' + FUNCS + p : new URL(FUNCS + p, import.meta.url).href
const kie = (await import(mod('/kie-proxy/handler.ts'))).handler as (r: Request) => Promise<Response>
const filet = (await import(mod('/reconcile-kie/handler.ts'))).handler as (r: Request) => Promise<Response>

// ── Outils ──
const SOLDE = 1000
const credits = () => db.rows('profiles').find((p) => p.id === UID)!.credits_remaining as number
function remettre() {
  for (const k of Object.keys(db.t)) delete db.t[k]
  st.o.clear(); taches.clear(); logs = []; factureKie = 0
  db.rows('profiles').push({ id: UID, plan: 'elite', is_owner: false, credits_remaining: SOLDE }, { id: AUTRE, plan: 'elite', is_owner: false, credits_remaining: SOLDE })
  st.put('render-media', `${UID}/kie-in/photo.jpg`, JPG, 'image/jpeg')
  st.put('render-media', `${UID}/dc-ref-1.mp4`, REF, 'video/mp4')
  st.put('render-media', `${UID}/kie-in/voix.wav`, WAV, 'audio/wav')
  st.put('render-media', `${AUTRE}/kie-in/photo.jpg`, JPG, 'image/jpeg')
}
// L'app débite AVANT l'appel (spend_credits → op) : le banc pose l'op déjà débitée
function op(amount: number, user = UID): string {
  const id = crypto.randomUUID()
  db.rows('credit_ops').push({ id, user_id: user, amount, reserved_remaining: amount, created_at: new Date().toISOString() })
  const p = db.rows('profiles').find((x) => x.id === user)!; p.credits_remaining -= amount
  return id
}
const appel = (method: string, path: string, body?: unknown, opId?: string, tok = 'tokA') =>
  kie(new Request(`${SUPABASE_URL}/functions/v1/kie-proxy?path=${encodeURIComponent(path)}`, { method,
    headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...(opId ? { 'x-aa-op': opId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }))
const lancerFilet = () => filet(new Request(`${SUPABASE_URL}/functions/v1/reconcile-kie`, { method: 'POST', headers: { 'x-cron-key': 'cron-banc', 'content-type': 'application/json' }, body: '{}' }))
// vieillit les lignes kie_jobs de 2 h (au-delà des 45 min du filet) ; valeurs par défaut de la table (state 'pending', attempts 0)
const vieillir = () => { const t = new Date(Date.now() - 2 * 3600e3).toISOString(); for (const r of db.rows('kie_jobs')) { r.state ??= 'pending'; r.attempts ??= 0; r.created_at = t; r.billed_at = t; r.updated_at = t } }

const IMG = signe(SUPABASE_URL, 'render-media', `${UID}/kie-in/photo.jpg`)
const VID = signe(SUPABASE_URL, 'render-media', `${UID}/dc-ref-1.mp4`)
const AUD = signe(SUPABASE_URL, 'render-media', `${UID}/kie-in/voix.wav`)
const ETRANGER = `${STORE}${AUTRE}/kie-in/photo.jpg`
const TRUQUEES: Record<string, string> = {
  'dièse': `${IMG}#${ETRANGER}`,
  'esperluette': `${IMG}&v=${ETRANGER}`,
}
// corps de l'app par alias (champ image remplacé par l'adresse testée)
const CORPS: Record<string, (img: string) => Record<string, unknown>> = {
  'nano-banana-pro': (img) => ({ prompt: 'améliore', image_urls: [img], aspect_ratio: '9:16' }),
  'veo3-lite': (img) => ({ prompt: 'il parle', image_url: img, duration: 8, resolution: '720p', aspect_ratio: '9:16' }),
  'omni-flash': (img) => ({ prompt: 'il parle', image_url: img, duration: 6, aspect_ratio: '9:16' }),
  'kling-2.6-mc': (img) => ({ prompt: 'bouge', image_url: img, video_url: VID, mode: '720p' }),
  'kling-3.0-mc': (img) => ({ prompt: 'bouge', image_url: img, video_url: VID }),
  'omnihuman-1.5': (img) => ({ image_url: img, audio_url: AUD }),
  'wan-3': (img) => ({ image_url: img, video_url: VID, duration: 5 }),
}
const ALIASES = Object.keys(CORPS)

const res: { nom: string; ok: boolean; detail: string }[] = []
const verif = (nom: string, ok: boolean, detail = '') => res.push({ nom, ok, detail })

// ════ 1. Adresses truquées, tous les alias : refusées AVANT tout tirage, kie jamais appelé ════
for (const alias of ALIASES) {
  for (const [forme, img] of Object.entries(TRUQUEES)) {
    remettre()
    const o = op(200)
    const r = await appel('POST', `/kie/${alias}`, CORPS[alias](img), o)
    const j = await r.json().catch(() => ({}))
    verif(`${alias} · image truquée (${forme}) refusée à la soumission, rien envoyé au fournisseur`, r.status === 400 && taches.size === 0 && db.rows('tirages').length === 0,
      `HTTP ${r.status}, tâches kie ${taches.size}, facturées à la plateforme ${factureKie}, tirages ${db.rows('tirages').length} ${j.error ? '« ' + String(j.error).slice(0, 70) + ' »' : ''}`)
  }
}

// ════ 2. Le scénario complet de l'audit (wan-3, « # ») : soumission → suivi → filet 45 min ════
{
  remettre()
  const o = op(50), avant = credits()
  const r = await appel('POST', '/kie/wan-3', CORPS['wan-3'](TRUQUEES['dièse']), o)
  const j = await r.json().catch(() => ({})) as Record<string, any>
  let livre = false
  if (r.status === 200 && j.request_id) {
    const rr = await appel('GET', `/kie/requests/${j.request_id}`)
    const jr = await rr.json().catch(() => ({})) as Record<string, any>
    livre = rr.status === 200 && !!jr.url
    vieillir(); await lancerFilet(); await lancerFilet()
  }
  const rendus = credits() - avant
  verif('audit · plateforme facturée par le fournisseur pour une génération non payée', !(factureKie > 0 && rendus >= 50),
    `génération payée chez kie : ${factureKie}, crédits rendus au client : ${rendus} sur 50, livrée : ${livre}`)
  verif('audit · le résultat n’est jamais livré à l’attaquant', !livre && !st.noms('render-media').some((p) => p.startsWith(`${UID}/kie/`) || p.startsWith(`${UID}/lib/`)))
}

// ════ 3. Défense en profondeur : une tâche DÉJÀ lancée avec une entrée d'un autre compte (soumise avant le correctif) ════
//    ligne kie_jobs de l'attaquant, op tirée ; kie a réussi (et facturé). Attendu : jamais livrée, op RÉGLÉE (pas remboursée).
function tacheEtrangere(alias = 'wan-3'): { rid: string; o: string } {
  const o = op(50)
  const id = 'ancien' + String(++nTache).padStart(6, '0')
  const body = { model: 'wan/3-0-video', input: { reference_video_urls: [VID], reference_image_urls: [`${IMG}#${ETRANGER}`] } }
  taches.set(id, { fam: 'mk', body, etat: 'success' }); factureKie++
  const opRow = db.rows('credit_ops').find((x) => x.id === o)!; opRow.reserved_remaining = 0
  db.rows('kie_jobs').push({ task_id: 'mk-' + id, user_id: UID, alias, label: 'Changement de personnage', state: 'pending', op_id: o, drawn: 50, bill_state: 'drawn',
    attempts: 0, billed_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  return { rid: 'mk-' + id, o }
}
{ // 3a. l'attaquant interroge le résultat, puis le filet passe
  remettre()
  const { rid } = tacheEtrangere(); const avant = credits()
  const rr = await appel('GET', `/kie/requests/${rid}`)
  const jr = await rr.json().catch(() => ({})) as Record<string, any>
  vieillir(); await lancerFilet(); await lancerFilet()
  const job = db.rows('kie_jobs').find((x) => x.task_id === rid)!
  verif('ancienne tâche truquée · résultat interrogé : non livré', !jr.url && !st.noms('render-media').some((p) => p.startsWith(`${UID}/kie/`) || p.startsWith(`${UID}/lib/`)), `HTTP ${rr.status} ${jr.status || ''}`)
  verif('ancienne tâche truquée · op RÉGLÉE, aucun crédit rendu (le fournisseur a été payé)', credits() === avant && job.bill_state === 'settled',
    `crédits rendus ${credits() - avant}, bill_state ${job.bill_state}, état ${job.state}`)
}
{ // 3b. l'attaquant n'interroge rien : seul le filet passe (onglet fermé)
  remettre()
  const { rid } = tacheEtrangere(); const avant = credits()
  vieillir(); await lancerFilet(); await lancerFilet()
  const job = db.rows('kie_jobs').find((x) => x.task_id === rid)!
  verif('ancienne tâche truquée · filet seul : réglée, ni remboursée ni rangée en Bibliothèque', credits() === avant && job.bill_state === 'settled' && job.state === 'failed'
    && !db.rows('library_items').length, `crédits rendus ${credits() - avant}, bill_state ${job.bill_state}, état ${job.state}, bibliothèque ${db.rows('library_items').length}`)
}
{ // 3c. règlement impossible (hoquet base) : rien clos, rien remboursé ; repris au passage suivant
  remettre()
  const { rid } = tacheEtrangere(); const avant = credits()
  vieillir(); db.pannes.add('rpc:kie_job_bill'); await lancerFilet(); await lancerFilet()
  const pendant = { ...db.rows('kie_jobs').find((x) => x.task_id === rid)! }   // copie : la ligne continue de vivre
  const ok1 = credits() === avant && pendant.bill_state === 'drawn' && pendant.state !== 'failed'
  db.pannes.delete('rpc:kie_job_bill'); vieillir(); await lancerFilet(); await lancerFilet()
  const apres = db.rows('kie_jobs').find((x) => x.task_id === rid)!
  verif('ancienne tâche truquée · hoquet au règlement : jamais remboursée, réglée au passage suivant', ok1 && credits() === avant && apres.bill_state === 'settled',
    `pendant : ${pendant.state}/${pendant.bill_state} ; après : ${apres.state}/${apres.bill_state}, crédits rendus ${credits() - avant}`)
}
{ // 3d. personne d'autre ne récupère quoi que ce soit : le compte cité (AUTRE) interroge la tâche → introuvable
  remettre()
  const { rid } = tacheEtrangere()
  const rr = await appel('GET', `/kie/requests/${rid}`, undefined, undefined, 'tokB')
  verif('ancienne tâche truquée · le compte cité ne la récupère pas non plus', rr.status === 404, `HTTP ${rr.status}`)
}

// ════ 4. Comportement honnête intact ════
for (const alias of ALIASES) {   // chaque alias : soumission → résultat livré → op réglée
  remettre()
  const o = op(200)
  const r = await appel('POST', `/kie/${alias}`, CORPS[alias](IMG), o)
  const j = await r.json().catch(() => ({})) as Record<string, any>
  let ok = r.status === 200 && !!j.request_id, d = `soumission HTTP ${r.status} ${j.error || ''}`
  if (ok) {
    const rr = await appel('GET', `/kie/requests/${j.request_id}`, undefined, o)
    const jr = await rr.json().catch(() => ({})) as Record<string, any>
    const row = db.rows('kie_jobs').find((x) => x.task_id === j.request_id)
    ok = rr.status === 200 && !!jr.url && row?.bill_state === 'settled'
    d = `résultat HTTP ${rr.status} ${jr.error || ''}, bill_state ${row?.bill_state}`
  }
  verif(`honnête · ${alias} : lien signé normal → livré et réglé`, ok, d)
}
{ // lien signé réel avec espaces / accents encodés (encodeURI de supabase-js)
  remettre()
  st.put('render-media', `${UID}/lib/Mon fichier é.jpg`, JPG, 'image/jpeg')
  const img = signe(SUPABASE_URL, 'render-media', `${UID}/lib/${encodeURI('Mon fichier é.jpg')}`)
  const r = await appel('POST', '/kie/nano-banana-pro', CORPS['nano-banana-pro'](img), op(20))
  verif('honnête · nom de fichier encodé (%20, %C3%A9) accepté', r.status === 200, `HTTP ${r.status}`)
}
{ // Décupleur : changement de personnage normal, onglet fermé → le filet range et règle
  remettre()
  const o = op(50), avant = credits()
  const r = await appel('POST', '/kie/wan-3', CORPS['wan-3'](IMG), o)
  const j = await r.json() as Record<string, any>
  vieillir(); await lancerFilet()
  const row = db.rows('kie_jobs').find((x) => x.task_id === j.request_id)
  verif('honnête · wan-3 onglet fermé : rangé en Bibliothèque par le filet, réglé', row?.state === 'saved' && row?.bill_state === 'settled' && credits() === avant,
    `soumission HTTP ${r.status} ${j.error || ''}, état ${row?.state}, bill_state ${row?.bill_state}`)
}
{ // échec réel chez le fournisseur : toujours remboursé (wan-3, sans repli)
  remettre()
  const o = op(50), avant = credits()
  const r = await appel('POST', '/kie/wan-3', CORPS['wan-3'](IMG), o)
  const j = await r.json() as Record<string, any>
  taches.get(String(j.request_id).slice(3))!.etat = 'fail'
  const rs = await appel('GET', `/kie/requests/${j.request_id}/status`, undefined, o)
  const js = await rs.json() as Record<string, any>
  verif('honnête · échec du fournisseur : crédits rendus', js.status === 'FAILED' && credits() === avant + 50 && js.billing === 'refunded', `billing ${js.billing}, rendus ${credits() - avant}`)
}
{ // réussite SANS aucune URL d'entrée lisible (format kie changé) : non livrée, remboursée comme avant (le client n'y est pour rien)
  remettre()
  const o = op(50), avant = credits()
  const r = await appel('POST', '/kie/wan-3', CORPS['wan-3'](IMG), o)
  const j = await r.json() as Record<string, any>
  taches.get(String(j.request_id).slice(3))!.param = ''
  vieillir(); await lancerFilet()
  const row = db.rows('kie_jobs').find((x) => x.task_id === j.request_id)
  verif('honnête · propriété illisible (param vide) : remboursé, rien livré', credits() === avant + 50 && row?.bill_state === 'refunded' && !db.rows('library_items').length,
    `bill_state ${row?.bill_state}, rendus ${credits() - avant}`)
}
{ // l'URL d'un autre compte, sans maquillage : refusée (inchangé)
  remettre()
  const r = await appel('POST', '/kie/wan-3', CORPS['wan-3'](signe(SUPABASE_URL, 'render-media', `${AUTRE}/kie-in/photo.jpg`)), op(50))
  verif('honnête · image d’un autre compte refusée', r.status === 400 && taches.size === 0, `HTTP ${r.status}`)
}

console.log = keep
let n = 0
for (const x of res) { if (x.ok) n++; keep(`${x.ok ? 'OK ' : 'KO '} ${x.nom}${x.detail ? '  — ' + x.detail : ''}`) }
keep(`\n${n}/${res.length} vérifications OK`)
if (Deno.env.get('F5_LOGS')) keep(logs.join('\n'))
Deno.exit(n === res.length ? 0 : 1)
