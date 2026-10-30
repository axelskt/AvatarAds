// Banc de l'audit Décupleur du 30/10, faille 3 (« dc-fetch et dc-cut sont gratuits et passent devant tous les rendus payés :
// quelques comptes suffisent à bloquer les moteurs »), côté MOTEURS. Code réel de render-worker/securite.mjs (prochainJob) ;
// la file render_jobs est une base factice en mémoire qui applique les filtres PostgREST utilisés (eq, neq, in, gte, or avec
// not.in / is.null — sémantique SQL : NULL ne passe ni « in » ni « not in »). La prise en charge reprend celle de
// render-worker/worker.mjs (pollLoop) : UPDATE … WHERE status = 'queued' pour tous les jobs, et, APRÈS, render_claim_dc pour
// dc-fetch / dc-cut (modèle JS identique à la migration 20261030140000, dont le SQL réel est testé par test-faille34-sql.ts).
// 6 moteurs simulés en temps virtuel (aucune attente réelle), aucun réseau, aucune vraie vidéo.
//
//   node tools/tests-decupleur/test-faille3-file.mjs                       → code du dépôt (APRÈS)
//   SECURITE=/chemin/securite.mjs DECUPLEUR=/chemin/decupleur.mjs node …   → une autre version (AVANT)
// La version est reconnue d'après le module : sans DC_COURTS exporté = ancienne file (dc-fetch / dc-cut dans la liste
// prioritaire de pollLoop, prise habituelle) ; avec = nouvelle (liste prioritaire sans eux, dcFile, render_claim_dc).
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ICI = dirname(fileURLToPath(import.meta.url))
const SECURITE = process.env.SECURITE || join(ICI, '../../render-worker/securite.mjs')
const DECUPLEUR = process.env.DECUPLEUR || join(ICI, '../../render-worker/decupleur.mjs')
const sec = await import(pathToFileURL(SECURITE).href)
const NOUVEAU = Array.isArray(sec.DC_COURTS)
const m = readFileSync(DECUPLEUR, 'utf8').match(/DC_FETCH_MS = (\d+)\b/)   // délai de yt-dlp (dcFetch)
const DC_FETCH_S = m ? Number(m[1]) / 1000 : 240
const DC_MAX = 2   // DC_MOTEURS_MAX par défaut (worker.mjs)
const MOTEURS = 6
console.log(`securite.mjs : ${SECURITE}  (${NOUVEAU ? 'file NOUVELLE' : 'file d’AVANT'}) ; délai yt-dlp ${DC_FETCH_S} s`)

// ── base factice : render_jobs + filtres PostgREST ──
let rows = [], seq = 0, panneLecture = null
const T0 = Date.parse('2026-10-30T09:00:00Z')
const col = (r, c) => c === 'plan->>__compose' ? (r.plan && r.plan.__compose != null ? String(r.plan.__compose) : null) : (r[c] ?? null)
const sansNull = (f) => (r) => { return f(r) }
function orFiltre(s) {
  // découpe au niveau 0 des parenthèses : « a.not.in.(x,y),b.is.null »
  const parts = []; let d = 0, cur = ''
  for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { parts.push(cur); cur = '' } else cur += ch }
  if (cur) parts.push(cur)
  const conds = parts.map((p) => {
    let mm = p.match(/^(.+?)\.not\.in\.\((.*)\)$/)
    if (mm) { const [, c, l] = mm, set = l.split(','); return (r) => { const v = col(r, c); return v !== null && !set.includes(String(v)) } }
    mm = p.match(/^(.+?)\.is\.null$/)
    if (mm) return (r) => col(r, mm[1]) === null
    throw new Error('filtre or non géré : ' + p)
  })
  return (r) => conds.some((f) => f(r))
}
function from(table) {
  if (table !== 'render_jobs') throw new Error('table ' + table)
  const fs = []; let lim = Infinity, ord = null, cols = '*', upd = null
  const q = {
    select(c) { cols = c || '*'; return q },
    eq(c, v) { fs.push(sansNull((r) => { const x = col(r, c); return x !== null && String(x) === String(v) })); return q },
    neq(c, v) { fs.push((r) => { const x = col(r, c); return x !== null && String(x) !== String(v) }); return q },
    in(c, l) { fs.push((r) => { const x = col(r, c); return x !== null && l.map(String).includes(String(x)) }); return q },
    gte(c, v) { fs.push((r) => { const x = col(r, c); return x !== null && String(x) >= String(v) }); return q },
    lt(c, v) { fs.push((r) => { const x = col(r, c); return x !== null && String(x) < String(v) }); return q },
    or(s) { fs.push(orFiltre(s)); return q },
    order(c) { ord = c; return q },
    limit(n) { lim = n; return q },
    update(v) { upd = v; return q },
    then(ok, ko) {
      try {
        if (panneLecture && cols === 'user_id' && !upd) return Promise.resolve({ data: null, error: { message: panneLecture } }).then(ok, ko)
        let l = rows.filter((r) => fs.every((f) => f(r)))
        if (upd) { for (const r of l) Object.assign(r, upd); return Promise.resolve({ data: l.map((r) => ({ id: r.id })), error: null }).then(ok, ko) }
        if (ord) l = [...l].sort((a, b) => String(a[ord]).localeCompare(String(b[ord])))
        l = l.slice(0, lim).map((r) => {
          if (cols === '*') return r
          const o = {}
          for (const c of cols.split(',').map((x) => x.trim())) { const [alias, src] = c.includes(':') ? c.split(':') : [c, c]; o[alias] = col(r, src) }
          return o
        })
        return Promise.resolve({ data: l, error: null }).then(ok, ko)
      } catch (e) { return Promise.reject(e).then(ok, ko) }
    },
  }
  return q
}
// render_claim_dc (migration 20261030140000) : comptage + prise d'un bloc (verrou global)
function render_claim_dc(id, max) {
  const vivant = new Date(Date.now() - 30 * 60_000).toISOString()
  const n = rows.filter((r) => r.status === 'rendering' && ['dc-fetch', 'dc-cut'].includes(col(r, 'plan->>__compose')) && r.updated_at >= vivant).length
  if (n >= Math.max(1, Math.min(max ?? 2, 50))) return false
  const r = rows.find((x) => x.id === id && x.status === 'queued' && ['dc-fetch', 'dc-cut'].includes(col(x, 'plan->>__compose')))
  if (!r) return false
  Object.assign(r, { status: 'rendering', updated_at: new Date().toISOString(), attempts: (r.attempts || 0) + 1 })
  return true
}
const sb = { from, rpc: async (n, a) => n === 'render_claim_dc' ? { data: render_claim_dc(a.p_job, a.p_max), error: null } : { data: null, error: { code: 'PGRST202' } } }

// pollLoop (worker.mjs), une itération : choix puis prise. Rend le job pris ou null.
const PRIO_AVANT = ['retouche', 'mc-ref', 'motion-voix', 'dc-fetch', 'dc-cut']
const PRIO_APRES = ['retouche', 'mc-ref', 'motion-voix']
async function uneIteration(moteur) {
  const cand = NOUVEAU
    ? await sec.prochainJob(sb, moteur.dernier, PRIO_APRES, null, { courts: sec.DC_COURTS, max: DC_MAX })
    : await sec.prochainJob(sb, moteur.dernier, PRIO_AVANT, null)
  if (!cand) return null
  const job = rows.find((r) => r.id === cand.id && r.status === 'queued')
  if (!job) return null
  const estDc = NOUVEAU && sec.DC_COURTS.includes(col(job, 'plan->>__compose'))
  let pris
  if (estDc) pris = (await sb.rpc('render_claim_dc', { p_job: job.id, p_max: DC_MAX })).data === true
  else { const { data } = await from('render_jobs').update({ status: 'rendering', updated_at: new Date().toISOString(), attempts: (job.attempts || 0) + 1 }).eq('id', job.id).eq('status', 'queued').select('id'); pris = data.length > 0 }
  if (!pris) return null
  moteur.dernier = job.user_id
  return job
}

const uid = (p, i) => `${p}${String(i).padStart(8, '0')}-2222-4333-8444-555555555555`.slice(0, 36)
function ajouter(user_id, compose, duree, t, extra = {}) {
  const r = { id: `job-${++seq}`, user_id, status: 'queued', plan: compose ? { __compose: compose } : { duration: 30 }, created_at: new Date(T0 + t * 1000).toISOString(),
    updated_at: new Date().toISOString(), attempts: 0, prioritaire: false, _duree: duree, _arrivee: t, ...extra }
  rows.push(r); return r
}
const estDcJob = (r) => ['dc-fetch', 'dc-cut'].includes(col(r, 'plan->>__compose'))

// Simulation à événements discrets : chaque moteur libre prend un job ; un job occupe le moteur _duree secondes.
// `arrivees(t)` ajoute les nouveaux jobs à l'instant t (pas de 1 s). Rend les mesures.
async function simuler(dureeS, arrivees) {
  FIN = dureeS
  const moteurs = Array.from({ length: MOTEURS }, (_, i) => ({ i, libreA: 0, job: null, dernier: null }))
  let maxDc = 0, minNormauxOccupes = Infinity
  for (let t = 0; t <= dureeS; t++) {
    for (const mo of moteurs) if (mo.job && mo.libreA <= t) { mo.job.status = 'done'; mo.job._fin = t; mo.job = null }
    arrivees(t)
    for (const mo of moteurs) {
      if (mo.job) continue
      const j = await uneIteration(mo)
      if (j) { j._debut = t; mo.job = j; mo.libreA = t + j._duree }
    }
    const dc = moteurs.filter((mo) => mo.job && estDcJob(mo.job)).length
    maxDc = Math.max(maxDc, dc)
    const normauxEnAttente = rows.some((r) => r.status === 'queued' && !estDcJob(r))
    if (normauxEnAttente) minNormauxOccupes = Math.min(minNormauxOccupes, moteurs.filter((mo) => mo.job && !estDcJob(mo.job)).length + moteurs.filter((mo) => !mo.job).length)
  }
  return { maxDc, minNormauxOccupes }
}
let FIN = 0   // un rendu jamais servi compte pour toute la durée de la simulation
const attente = (r) => (r._debut ?? FIN) - r._arrivee

let nOk = 0, nKo = 0
const ok = (nom, c, d = '') => { if (c) nOk++; else nKo++; console.log(`${c ? '  ✓' : '  ✗'} ${nom}${c || !d ? '' : '  → ' + d}`) }
const reset = () => { rows = []; seq = 0; panneLecture = null }

// ── S1. L'attaque de l'audit : 3 comptes Starter qui gardent chacun 3 récupérations en file (gratuites), en continu,
//        pendant que 5 clients payants envoient montages, Express, Générateur, Motion Control et Rendu prioritaire. ──
console.log('S1. 3 comptes enchaînent des récupérations de lien (3 en file chacun) ; clients payants : 1 rendu toutes les 40 s, 30 min')
reset()
{
  const ATT = [1, 2, 3].map((i) => uid('aaaaaaa', i)), CLI = [1, 2, 3, 4, 5].map((i) => uid('ccccccc', i))
  const DUREE_FETCH = DC_FETCH_S + 30   // vidéo qui va jusqu'au délai de yt-dlp, puis réencodage
  const types = [[null, 150], ['retouche', 8], ['gen-subs', 60], ['motion', 90], [null, 150, true]]
  let k = 0
  const res = await simuler(1800, (t) => {
    for (const a of ATT) { const n = rows.filter((r) => r.user_id === a && (r.status === 'queued' || r.status === 'rendering')).length; for (let i = n; i < 3; i++) ajouter(a, 'dc-fetch', DUREE_FETCH, t) }
    if (t % 40 === 0 && t < 1500) { const [c, d, prio] = types[k % types.length]; ajouter(CLI[k % CLI.length], c, d, t, { prioritaire: !!prio, _paye: true }); k++ }
  })
  const payes = rows.filter((r) => r._paye), servis = payes.filter((r) => r._debut != null)
  const att = payes.map(attente), moy = att.reduce((s, x) => s + x, 0) / Math.max(1, att.length)
  const prio = payes.filter((r) => r.prioritaire), prioMax = Math.max(...prio.map(attente))
  const fetchs = rows.filter((r) => estDcJob(r) && r._debut != null).length
  console.log(`     → moteurs pris par les récupérations : ${res.maxDc}/${MOTEURS} au plus ; rendus payés servis ${servis.length}/${payes.length}, attente moyenne ${Math.round(moy)} s, max ${Math.max(...att)} s (jamais servi = attente jusqu'à la fin) ; Rendu prioritaire : attente max ${prio.every((r) => r._debut != null) ? prioMax + ' s' : 'certains jamais servis'} ; récupérations servies : ${fetchs}`)
  ok(`au plus ${DC_MAX} moteurs sur ${MOTEURS} pris par dc-fetch / dc-cut`, res.maxDc <= DC_MAX, `${res.maxDc}`)
  ok('au moins un moteur toujours laissé aux rendus normaux qui attendent', res.minNormauxOccupes >= 1, String(res.minNormauxOccupes))
  ok('tous les rendus payés servis', servis.length === payes.length, `${servis.length}/${payes.length}`)
  ok('attente moyenne d’un rendu payé < 60 s', moy < 60, `${Math.round(moy)} s`)
  ok('Rendu prioritaire (5 €/mois) servi en moins de 2 min', prioMax < 120 && prio.every((r) => r._debut != null), prioMax + ' s')
  ok('les récupérations des attaquants avancent quand même (pas de famine)', fetchs >= 10, String(fetchs))
}

// ── S2. Un seul compte, 30 récupérations en file (ce que permettait la faille 4) : un seul en priorité par compte ──
console.log('S2. 1 compte, 30 dc-fetch en file + 6 montages payés arrivés après')
reset()
{
  const A = uid('aaaaaaa', 9)
  for (let i = 0; i < 30; i++) ajouter(A, 'dc-fetch', DC_FETCH_S + 30, 0)
  for (let i = 0; i < 6; i++) ajouter(uid('ccccccc', i), null, 150, 1, { _paye: true })
  const res = await simuler(5, () => {})
  const enCoursDc = rows.filter((r) => r.status === 'rendering' && estDcJob(r)).length, montages = rows.filter((r) => r._paye && r.status === 'rendering').length
  console.log(`     → après la 1re tournée des 6 moteurs : ${enCoursDc} récupérations, ${montages} montages payés en cours`)
  ok('au plus 1 récupération servie en priorité pour ce compte, et ≤ plafond global', enCoursDc <= DC_MAX, String(enCoursDc))
  ok('au moins 4 montages payés démarrent tout de suite', montages >= MOTEURS - DC_MAX, String(montages))
  void res
}

// ── S3. Client honnête : UN lien TikTok normal de 30 s, file chargée de montages → toujours servi en tête ──
console.log('S3. client honnête : 1 dc-fetch (30 s) derrière 10 montages en file, moteurs pleins')
reset()
{
  let h = null
  await simuler(400, (t) => {
    if (t === 0) for (let i = 0; i < 6; i++) ajouter(uid('ddddddd', i), null, 100, 0)        // les 6 moteurs pris jusqu'à t=100 s
    if (t === 1) for (let i = 0; i < 10; i++) ajouter(uid('ccccccc', i), null, 150, 1)       // 10 montages en file
    if (t === 2) h = ajouter(uid('eeeeeee', 1), 'dc-fetch', 35, 2)
  })
  const montagesAvant = rows.filter((r) => !estDcJob(r) && r._arrivee === 1 && r._debut != null && r._debut < h._debut).length
  console.log(`     → récupération démarrée à t=${h._debut} s (1er moteur libre à t=100 s), ${montagesAvant} montage(s) en file passé(s) avant`)
  ok('servie dès qu’un moteur se libère (devant les montages en file, comme avant)', h._debut === 100 && montagesAvant === 0, `t=${h._debut}, ${montagesAvant} avant`)
  ok('terminée', h.status === 'done')
}

// ── S4. Ordre des autres rendus inchangé : retouche (Express) > Rendu prioritaire > le reste, plafond Décupleur atteint ──
console.log('S4. ordre de service des rendus payés, 2 récupérations déjà en cours (plafond atteint)')
reset()
{
  const A = uid('aaaaaaa', 1), B = uid('aaaaaaa', 2)
  for (const u of [A, B]) { const r = ajouter(u, 'dc-fetch', 999, 0); r.status = 'rendering' }
  ajouter(uid('aaaaaaa', 3), 'dc-cut', 60, 0)
  const montage = ajouter(uid('ccccccc', 1), null, 150, 1)
  const gen = ajouter(uid('ccccccc', 2), 'gen-subs', 60, 2)
  const prio = ajouter(uid('ccccccc', 3), null, 150, 3, { prioritaire: true })
  const ret = ajouter(uid('ccccccc', 4), 'retouche', 8, 4)
  const mv = ajouter(uid('ccccccc', 5), 'motion-voix', 5, 5)
  const ordre = []
  const mo = { dernier: null }
  for (let i = 0; i < 6; i++) { const j = await uneIteration(mo); if (!j) break; ordre.push(j.plan.__compose || (j.prioritaire ? 'prioritaire' : 'montage')) }
  console.log(`     → ordre : ${ordre.join(' > ') || '(rien)'}`)
  ok('retouche puis motion-voix (classe courte), puis Rendu prioritaire, puis montage et Générateur ; la découpe attend',
    ordre.join(',') === 'retouche,motion-voix,prioritaire,montage,gen-subs', ordre.join(','))
  ok('montage SANS __compose servi même plafond atteint (filtre « is.null »)', montage.status === 'rendering' && gen.status === 'rendering' && prio.status === 'rendering' && ret.status === 'rendering' && mv.status === 'rendering')
}

// ── S5. Lecture du nombre de récupérations en cours impossible : elles attendent, les autres passent ──
console.log('S5. lecture des récupérations en cours en panne')
if (!NOUVEAU) console.log('  · sans objet sur la file d’avant')
else {
  reset(); panneLecture = 'hoquet'
  ajouter(uid('aaaaaaa', 1), 'dc-fetch', 60, 0); const m2 = ajouter(uid('ccccccc', 1), null, 150, 1)
  const j = await uneIteration({ dernier: null })
  ok('le montage passe, la récupération attend', j && j.id === m2.id, JSON.stringify(j && j.plan))
}

// ── S6. Décupleur payant (lot de variantes) : jamais touché par le plafond des récupérations ──
console.log('S6. lot de variantes « decupleur » avec 2 récupérations en cours')
reset()
{
  for (const u of [uid('aaaaaaa', 1), uid('aaaaaaa', 2)]) { const r = ajouter(u, 'dc-fetch', 999, 0); r.status = 'rendering' }
  const lot = ajouter(uid('ccccccc', 1), 'decupleur', 120, 1)
  const j = await uneIteration({ dernier: null })
  ok('pris normalement', j && j.id === lot.id, JSON.stringify(j && j.plan))
}

// ── S7. Délai de yt-dlp ──
console.log('S7. délai de yt-dlp')
ok('≤ 90 s', DC_FETCH_S <= 90, `${DC_FETCH_S} s`)

console.log(`\n${nKo === 0 ? '✓' : '✗'} ${nOk}/${nOk + nKo} vérifications OK`)
process.exit(nKo ? 1 : 0)
