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
// relecture 30/10 : mc-ref (préparation gratuite des outils Claude) dans le plafond global + pause locale après une prise
// refusée (worker.mjs) + création « 1 travail gratuit court par compte » (render_job_dc_creer). Version reconnue d'après
// DC_COURTS : avec mc-ref = code du dépôt ; sans = 1er correctif (02/10 → 30/10 matin) ; absent = file d'avant.
const RELU = NOUVEAU && sec.DC_COURTS.includes('mc-ref')
// 2e relecture 30/10 : familles (dc, prep, retouche) plafonnées séparément, création par famille, pénalité des échecs
const FAM = sec.FAMILLES_GRATUITES || null, R2 = !!FAM
const COURTS_V = NOUVEAU ? sec.DC_COURTS : ['dc-fetch', 'dc-cut']
const familleV = (c) => { if (!FAM) return COURTS_V.includes(c) ? '_' : null; for (const [n, l] of Object.entries(FAM)) if (l.includes(c)) return n; return null }
const composesFam = (n) => (FAM ? FAM[n] : COURTS_V)
const srcDc = readFileSync(DECUPLEUR, 'utf8')
const m = srcDc.match(/DC_FETCH_MS = (\d+)\b/)   // délai de yt-dlp (dcFetch)
const DC_FETCH_S = m ? Number(m[1]) / 1000 : 240
const mc = srcDc.match(/DC_CUT_MS = (\d+) \* 60 \* 1000/)   // délai du réencodage d'une découpe (avant : FF_MS = 10 min)
const DC_CUT_S = mc ? Number(mc[1]) * 60 : 600
const DC_MAX = 2   // DC_MOTEURS_MAX par défaut (worker.mjs)
const PREP_MAX = 1, RET_MAX = 1   // DC_PREP_MAX, RETOUCHE_MOTEURS_MAX par défaut (worker.mjs, 2e relecture)
const MOTEURS = 6
// délai d'une préparation mc-ref (worker.mjs MCREF_MAX_MS) et nombre de relances automatiques d'une carte Claude (mcp/index.ts)
const WORKER = process.env.WORKER || join(dirname(SECURITE), 'worker.mjs')
const MCP = process.env.MCP || join(dirname(SECURITE), '../supabase/functions/mcp/index.ts')
const lire = (f) => { try { return readFileSync(f, 'utf8') } catch (_) { return '' } }
const mm = lire(WORKER).match(/MCREF_MAX_MS = (\d+) \* 60 \* 1000/)
const MCREF_S = mm ? Number(mm[1]) * 60 : 600
const mr = lire(MCP).match(/er==='busy'&&aaRetryN<(\d+)\)/)
const mt = lire(join(dirname(SECURITE), 'retouche.mjs')).match(/RETOUCHE_TOTAL_MS = (\d+)_000/)
const RETOUCHE_S = mt ? Number(mt[1]) : 180   // avant : chaque ffmpeg 3 min (7 appels) — on garde 180 s, déjà favorable à l'ancien code
const RELANCES = mr ? Number(mr[1]) : 20
console.log(`securite.mjs : ${SECURITE}  (${R2 ? 'file NOUVELLE (2e relecture 30/10 : familles dc / prep / retouche)' : RELU ? 'file de la 1re relecture (mc-ref dans le plafond des dc, retouche sans plafond)' : NOUVEAU ? 'file du 1er correctif (mc-ref hors plafond)' : 'file d’AVANT'}) ; délai yt-dlp ${DC_FETCH_S} s ; découpe ${DC_CUT_S} s au plus ; préparation ${MCREF_S} s au plus ; carte : ${RELANCES} relances × 15 s ; retouche ${RETOUCHE_S} s au plus`)

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
    if (p.startsWith('and(') && p.endsWith(')')) return andFiltre(p.slice(4, -1))
    let mm = p.match(/^(.+?)\.not\.in\.\((.*)\)$/)
    if (mm) { const [, c, l] = mm, set = l.split(','); return (r) => { const v = col(r, c); return v !== null && !set.includes(String(v)) } }
    mm = p.match(/^(.+?)\.in\.\((.*)\)$/)
    if (mm) { const [, c, l] = mm, set = l.split(','); return (r) => { const v = col(r, c); return v !== null && set.includes(String(v)) } }
    mm = p.match(/^(.+?)\.is\.null$/)
    if (mm) return (r) => col(r, mm[1]) === null
    throw new Error('filtre or non géré : ' + p)
  })
  return (r) => conds.some((f) => f(r))
}
// and(a,b) : mêmes conditions, toutes vraies
function andFiltre(s) {
  const parts = []; let d = 0, cur = ''
  for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { parts.push(cur); cur = '' } else cur += ch }
  if (cur) parts.push(cur)
  const conds = parts.map((x) => orFiltre(x))
  return (r) => conds.every((f) => f(r))
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
        if (panneLecture && cols.startsWith('user_id') && !upd) return Promise.resolve({ data: null, error: { message: panneLecture } }).then(ok, ko)
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
// (relecture 30/10 : la version du dépôt compte aussi mc-ref — COURTS_V suit la version testée)
let panneClaim = null, appelsClaim = 0
function render_claim_dc(id, a) {
  const vivant = new Date(Date.now() - 30 * 60_000).toISOString()
  const job = rows.find((x) => x.id === id)
  const fam = job && familleV(col(job, 'plan->>__compose'))
  if (!fam) return false
  const cs = composesFam(fam), max = fam === 'prep' ? a.p_max_prep ?? 1 : fam === 'retouche' ? a.p_max_retouche ?? 1 : a.p_max ?? 2
  const n = rows.filter((r) => r.status === 'rendering' && cs.includes(col(r, 'plan->>__compose')) && r.updated_at >= vivant).length
  if (n >= Math.max(1, Math.min(max, 50))) return false
  const r = rows.find((x) => x.id === id && x.status === 'queued' && cs.includes(col(x, 'plan->>__compose')))
  if (!r) return false
  Object.assign(r, { status: 'rendering', updated_at: new Date().toISOString(), attempts: (r.attempts || 0) + 1 })
  return true
}
const sb = { from, rpc: async (n, a) => {
  if (n !== 'render_claim_dc') return { data: null, error: { code: 'PGRST202' } }
  appelsClaim++
  return panneClaim ? { data: null, error: panneClaim } : { data: render_claim_dc(a.p_job, a), error: null }
} }

// pollLoop (worker.mjs), une itération : choix puis prise. Rend le job pris ou null.
const PRIO_AVANT = ['retouche', 'mc-ref', 'motion-voix', 'dc-fetch', 'dc-cut']
const PRIO_APRES = ['retouche', 'mc-ref', 'motion-voix'].filter((c) => !COURTS_V.includes(c))
let tVirtuel = 0
async function uneIteration(moteur) {
  // 2e relecture : la liste des comptes en échec (pénalité) est gardée 30 s par moteur — en temps VIRTUEL ici
  if (R2 && moteur.dcFile && moteur.dcFile._penal && tVirtuel - (moteur.penalT ?? -1e9) >= 30) { moteur.dcFile._penal = null }
  if (R2 && moteur.dcFile && !moteur.dcFile._penal) moteur.penalT = tVirtuel
  if (R2 && !moteur.dcFile) moteur.dcFile = { familles: { dc: DC_MAX, prep: PREP_MAX, retouche: RET_MAX }, pauseJusqua: {} }
  const cand = R2
    ? await sec.prochainJob(sb, moteur.dernier, ['motion-voix'], null, moteur.dcFile)
    : NOUVEAU
      ? await sec.prochainJob(sb, moteur.dernier, PRIO_APRES, null, { courts: sec.DC_COURTS, max: DC_MAX, pauseJusqua: moteur.pause || 0 })
      : await sec.prochainJob(sb, moteur.dernier, PRIO_AVANT, null)
  if (!cand) return null
  const job = rows.find((r) => r.id === cand.id && r.status === 'queued')
  if (!job) return null
  const estDc = NOUVEAU && sec.DC_COURTS.includes(col(job, 'plan->>__compose'))
  let pris
  if (estDc) {
    const { data, error } = await sb.rpc('render_claim_dc', { p_job: job.id, p_max: DC_MAX, p_max_prep: PREP_MAX, p_max_retouche: RET_MAX })
    pris = !error && data === true
    // worker.mjs du dépôt : prise refusée (erreur ou plafond) → pause locale (DC_PAUSE_MS, 5 s réelles : plus longue que toute
    // la simulation, qui tourne en temps virtuel) — par famille depuis la 2e relecture ; versions d'avant : aucune pause
    if (!pris && R2) moteur.dcFile.pauseJusqua[familleV(col(job, 'plan->>__compose'))] = Date.now() + 5000
    else if (!pris && RELU) moteur.pause = Date.now() + 5000
  }
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
const estGratuit = (r) => ['dc-fetch', 'dc-cut', 'mc-ref'].includes(col(r, 'plan->>__compose'))   // travaux gratuits courts (relecture 30/10)
// Création d'un travail gratuit, comme la base l'accepte selon la version : dépôt = render_job_dc_creer (UN travail court en
// file ou en cours par compte, liens 6 et découpes 10 par 10 min, app et MCP confondus) ; avant = « 3 en cours » côté app et
// aucune borne atomique côté MCP (mc-ref, dc-fetch du MCP). Rend la ligne créée ou null (refus).
function creer(user_id, compose, duree, t, extra = {}) {
  if (R2) {
    // render_job_dc_creer (2e relecture) : 1 en cours PAR FAMILLE ; liens 6, découpes 10, préparations 10 par 10 min ;
    // préparations : 3 échecs par heure ; render_job_creer_borne : 2 retouches en cours
    const actifs = (cs) => rows.filter((r) => r.user_id === user_id && (r.status === 'queued' || r.status === 'rendering') && cs.includes(col(r, 'plan->>__compose'))).length
    const fen = (c, s = 600) => rows.filter((r) => r.user_id === user_id && col(r, 'plan->>__compose') === c && r._arrivee > t - s).length
    if (compose === 'retouche') { if (actifs(['retouche']) >= 2) return null; return ajouter(user_id, compose, duree, t, extra) }
    const fam = familleV(compose)
    if (fam && actifs(FAM[fam]) >= 1) return null
    if (compose === 'dc-fetch' && fen('dc-fetch') >= 6) return null
    if (compose === 'dc-cut' && fen('dc-cut') >= 10) return null
    if (compose === 'mc-ref' && (fen('mc-ref') >= 10 || rows.filter((r) => r.user_id === user_id && col(r, 'plan->>__compose') === 'mc-ref' && r.status === 'failed' && r._arrivee > t - 3600).length >= 3)) return null
    return ajouter(user_id, compose, duree, t, extra)
  }
  if (RELU) {
    const enCours = rows.filter((r) => r.user_id === user_id && (r.status === 'queued' || r.status === 'rendering') && estGratuit(r)).length
    if (enCours >= 1) return null
    const fen = (c) => rows.filter((r) => r.user_id === user_id && col(r, 'plan->>__compose') === c && r._arrivee > t - 600).length
    if (compose === 'dc-fetch' && fen('dc-fetch') >= 6) return null
    if (compose === 'dc-cut' && fen('dc-cut') >= 10) return null
  }
  return ajouter(user_id, compose, duree, t, extra)
}

// Simulation à événements discrets : chaque moteur libre prend un job ; un job occupe le moteur _duree secondes.
// `arrivees(t)` ajoute les nouveaux jobs à l'instant t (pas de 1 s). Rend les mesures.
async function simuler(dureeS, arrivees) {
  FIN = dureeS
  const moteurs = Array.from({ length: MOTEURS }, (_, i) => ({ i, libreA: 0, job: null, dernier: null, pause: 0, dcFile: null }))
  let maxDc = 0, minNormauxOccupes = Infinity
  for (let t = 0; t <= dureeS; t++) {
    tVirtuel = t
    for (const mo of moteurs) if (mo.job && mo.libreA <= t) { mo.job.status = mo.job._echec ? 'failed' : 'done'; mo.job._fin = t; mo.job = null }
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
const reset = () => { rows = []; seq = 0; panneLecture = null; panneClaim = null; appelsClaim = 0 }

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

// ══ Relecture du 30/10 (bancs adverses des relecteurs, rejoués ici) ══
// ── R1. 2 comptes essaient de garder 3 découpes chacun en file, entrée lourde (la découpe va jusqu'à son délai) ;
//        un client honnête envoie UNE récupération de 35 s à t=60 ──
console.log(`R1. 2 comptes x 3 dc-cut lents (jusqu’au délai : ${DC_CUT_S} s) en continu ; client honnête : 1 dc-fetch à t=60`)
reset()
{
  const ATT = [1, 2].map((i) => uid('aaaaaaa', i))
  let h = null
  await simuler(3600, (t) => {
    for (const a of ATT) { const n = rows.filter((r) => r.user_id === a && (r.status === 'queued' || r.status === 'rendering')).length; for (let i = n; i < 3; i++) creer(a, 'dc-cut', DC_CUT_S, t) }
    if (t === 60) h = creer(uid('eeeeeee', 1), 'dc-fetch', 35, 60)
  })
  console.log(`     → dc-fetch honnête : ${h && h._debut != null ? 'démarré à t=' + h._debut + ' s (attente ' + (h._debut - 60) + ' s)' : 'JAMAIS servi en 1 h'}`)
  ok('client honnête servi en moins de 10 min', !!h && h._debut != null && h._debut - 60 < 600, String(h && h._debut))
  ok('il attend au plus UNE découpe déjà commencée (aucune gardée d’avance dans la file)', !!h && h._debut != null && h._debut - 60 <= DC_CUT_S, String(h && h._debut))
}

// ── R2. 30 mc-ref d'un coup (30 cartes Claude + 30 /start simultanés ; ou des mc-ref déjà en file) + 6 montages payés à t=1 ──
console.log('R2. 1 compte : 30 mc-ref en file d’un coup (60 s chacun) + 6 montages payés à t=1')
reset()
{
  const A = uid('aaaaaaa', 7)
  for (let i = 0; i < 30; i++) ajouter(A, 'mc-ref', 60, 0)   // insérés directement : le plafond des MOTEURS doit tenir seul
  for (let i = 0; i < 6; i++) ajouter(uid('ccccccc', i), null, 150, 1, { _paye: true })
  let maxMcRef = 0
  await simuler(600, () => { maxMcRef = Math.max(maxMcRef, rows.filter((r) => r.status === 'rendering' && col(r, 'plan->>__compose') === 'mc-ref').length) })
  const payes = rows.filter((r) => r._paye), premier = Math.min(...payes.map((r) => r._debut ?? 1e9))
  console.log(`     → mc-ref en cours au plus : ${maxMcRef}/${MOTEURS} ; 1er montage payé démarré à t=${premier} s ; ${payes.filter((r) => r._debut != null && r._debut <= 1).length}/6 montages démarrés à t=1`)
  ok(`mc-ref gratuits : au plus ${R2 ? PREP_MAX : DC_MAX} moteur(s) (plafond global${R2 ? ' de la famille « prep »' : ''})`, maxMcRef <= (R2 ? PREP_MAX : DC_MAX), String(maxMcRef))
  ok(`au moins ${MOTEURS - DC_MAX} montages payés démarrent dès leur arrivée`, payes.filter((r) => r._debut != null && r._debut <= 1).length >= MOTEURS - DC_MAX, String(premier))
  // création par la base (dépôt) : la rafale ne crée qu'UN mc-ref
  reset()
  const crees = Array.from({ length: 30 }, () => creer(A, 'mc-ref', 60, 0)).filter(Boolean).length
  console.log(`     → par render_job_dc_creer : ${crees} mc-ref créé(s) pour 30 /start`)
  ok('30 /start simultanés : 1 seule préparation créée (1 travail gratuit court par compte)', crees === 1, String(crees))
}

// ── R3. 2 comptes : 30 dc-fetch chacun par le MCP d'un coup ; client honnête (app) : 1 dc-fetch à t=60 ──
console.log('R3. 2 comptes x 30 dc-fetch (MCP) d’un coup ; client honnête (app) : 1 dc-fetch à t=60')
reset()
{
  let h = null
  await simuler(7200, (t) => {
    for (const a of [uid('aaaaaaa', 3), uid('aaaaaaa', 4)]) {
      if (t === 0) for (let i = 0; i < 30; i++) creer(a, 'dc-fetch', 120, 0)
      else if (t % 15 === 0) creer(a, 'dc-fetch', 120, t)   // il relance sans cesse (refusé tant que le sien tourne / quota)
    }
    if (t === 60) h = creer(uid('eeeeeee', 2), 'dc-fetch', 35, 60)
  })
  const att = rows.filter((r) => r.user_id !== uid('eeeeeee', 2) && col(r, 'plan->>__compose') === 'dc-fetch')
  console.log(`     → récupérations créées pour les attaquants : ${att.length} en 2 h ; dc-fetch honnête : ${h && h._debut != null ? 'démarré à t=' + h._debut + ' s (attente ' + (h._debut - 60) + ' s)' : 'jamais servi'}`)
  ok('client honnête servi en moins de 10 min', !!h && h._debut != null && h._debut - 60 < 600, String(h && h._debut))
  ok('attaquants : au plus 6 récupérations par 10 min et par compte (quota, MCP compris)', att.length <= 2 * 6 * 12 + 2, String(att.length))
}

// ── R4. render_claim_dc en erreur DURABLE (droits, surcharge ambiguë, délai) : les autres rendus doivent passer ──
console.log('R4. render_claim_dc renvoie une erreur durable (42501) ; 1 dc-fetch en tête de file + 10 montages payés')
if (!NOUVEAU) console.log('  · sans objet sur la file d’avant (pas de render_claim_dc)')
else {
  reset(); panneClaim = { code: '42501', message: 'permission denied for function render_claim_dc' }
  ajouter(uid('aaaaaaa', 1), 'dc-fetch', 60, 0)
  for (let i = 0; i < 10; i++) ajouter(uid('ccccccc', i), null, 150, 1, { _paye: true })
  await simuler(600, () => {})
  const payes = rows.filter((r) => r._paye), servis = payes.filter((r) => r._debut != null)
  console.log(`     → montages payés servis : ${servis.length}/10 en 10 min ; appels à render_claim_dc : ${appelsClaim}`)
  ok('tous les montages payés servis malgré la panne', servis.length === 10, `${servis.length}/10`)
  ok('les moteurs ne rebouclent pas sur la prise en panne (≤ 1 appel par moteur et par pause)', appelsClaim <= MOTEURS, String(appelsClaim))
}

// ══ 2e relecture du 30/10 (bancs adverses des relecteurs) ══
// Une carte Claude : /start → création de la préparation (refus = « busy » : relance toutes les 15 s, RELANCES fois au plus,
// puis « La file est encore pleine », bouton à cliquer) ; la préparation dure `duree` s une fois prise par un moteur.
function carteClaude(user_id, t0, duree, nom) {
  return { user_id, t0, duree, nom, essais: 0, job: null, abandon: false,
    tick(t) {
      if (this.job || this.abandon || t < this.t0 || (t - this.t0) % 15 !== 0) return
      if (this.essais > RELANCES) { this.abandon = true; return }
      this.essais++
      this.job = creer(this.user_id, 'mc-ref', this.duree, t, { _carte: this.nom })
    } }
}
// ── R5. Charge Décupleur (2 comptes : découpes lentes en continu) ; un client lance 3 cartes Omni à la suite (t=60, 62, 64) ──
console.log(`R5. 2 comptes x dc-cut lents (${DC_CUT_S} s) en continu ; client honnête : 3 cartes Omni lancées à t=60, 62 et 64 (préparation 40 s)`)
reset()
{
  const ATT = [1, 2].map((i) => uid('aaaaaaa', i)), H = uid('fffffff', 1)
  const cartes = [0, 2, 4].map((d, i) => carteClaude(H, 60 + d, 40, 'carte ' + (i + 1)))
  await simuler(1800, (t) => {
    for (const a of ATT) { const n = rows.filter((r) => r.user_id === a && (r.status === 'queued' || r.status === 'rendering')).length; for (let i = n; i < 3; i++) creer(a, 'dc-cut', DC_CUT_S, t) }
    for (const c of cartes) c.tick(t)
  })
  const res = cartes.map((c) => c.job && c.job._fin != null ? `${c.nom} prête à t=${c.job._fin} s (${c.job._fin - c.t0} s)` : `${c.nom} ${c.abandon ? '« La file est encore pleine » (bouton)' : 'jamais prête'}`)
  console.log(`     → ${res.join(' ; ')}`)
  ok('les 3 cartes sont préparées sans bouton « relance » (relance automatique suffisante)', cartes.every((c) => c.job && c.job._fin != null && !c.abandon), res.join(' ; '))
  ok('1re carte : préparation démarrée en moins de 30 s malgré la charge Décupleur (sa propre place)', !!cartes[0].job && cartes[0].job._debut != null && cartes[0].job._debut - 60 < 30, String(cartes[0].job && cartes[0].job._debut))
  ok('3e carte prête en moins de 5 min', !!cartes[2].job && cartes[2].job._fin != null && cartes[2].job._fin - cartes[2].t0 < 300, String(cartes[2].job && cartes[2].job._fin))
}

// ── R6. Retouches gratuites en rafale : 3 comptes (un débit quelconque dans l'heure) gardent des retouches lourdes en file
//        (la « photo » est un MP4 renommé ou la vidéo force l'encodage : jusqu'au délai, puis échec) ; clients payants comme S1 ──
console.log(`R6. 3 comptes x retouches lourdes (${RETOUCHE_S} s, échec au délai) en continu ; clients payants : 1 rendu toutes les 40 s, 30 min ; 1 retouche Express honnête toutes les 5 min`)
reset()
{
  const ATT = [1, 2, 3].map((i) => uid('bbbbbbb', i)), CLI = [1, 2, 3, 4, 5].map((i) => uid('ccccccc', i))
  const types = [[null, 150], ['gen-subs', 60], ['motion', 90], [null, 150, true]]
  let k = 0, maxRet = 0
  const honnetes = []
  await simuler(1800, (t) => {
    // version du dépôt : 2 retouches en cours par compte (création atomique) ; avant : la rafale en créait autant que voulu
    for (const a of ATT) {
      const n = rows.filter((r) => r.user_id === a && (r.status === 'queued' || r.status === 'rendering')).length
      for (let i = n; i < (R2 ? 2 : 6); i++) creer(a, 'retouche', RETOUCHE_S, t, { _echec: true })
    }
    if (t % 40 === 0 && t < 1500) { const [c, d, prio] = types[k % types.length]; ajouter(CLI[k % CLI.length], c, d, t, { prioritaire: !!prio, _paye: true }); k++ }
    if (t % 300 === 30) { const h = creer(uid('ddddddd', t), 'retouche', 8, t); if (h) honnetes.push(h) }
    maxRet = Math.max(maxRet, rows.filter((r) => r.status === 'rendering' && col(r, 'plan->>__compose') === 'retouche').length)
  })
  const payes = rows.filter((r) => r._paye), servis = payes.filter((r) => r._debut != null)
  const att = payes.map(attente), moy = att.reduce((x, y) => x + y, 0) / Math.max(1, att.length)
  const prio = payes.filter((r) => r.prioritaire), prioMax = Math.max(...prio.map(attente))
  // avant le 1er échec de chaque attaquant (3 × RETOUCHE_S), rien ne les distingue d'un client : la retouche honnête peut dépasser le
  // délai de l'app, qui livre alors la vidéo d'origine (aucun crédit perdu) ; après, elle passe devant eux
  const hTard = honnetes.filter((r) => r._arrivee >= 3 * RETOUCHE_S)
  const hOk = hTard.filter((r) => r._fin != null && r._fin - r._arrivee <= 150).length
  const hTot = honnetes.filter((r) => r._fin != null && r._fin - r._arrivee <= 150).length
  console.log(`     → retouches en cours au plus : ${maxRet}/${MOTEURS} ; rendus payés servis ${servis.length}/${payes.length}, attente moyenne ${Math.round(moy)} s ; Rendu prioritaire : attente max ${prioMax} s ; retouches honnêtes finies dans le délai de l’app (150 s) : ${hTot}/${honnetes.length} (après les 1ers échecs des attaquants : ${hOk}/${hTard.length})`)
  ok(`au plus ${RET_MAX} moteur(s) pris par les retouches`, maxRet <= RET_MAX, String(maxRet))
  ok('tous les rendus payés servis, attente moyenne < 60 s', servis.length === payes.length && moy < 60, `${servis.length}/${payes.length}, ${Math.round(moy)} s`)
  ok('Rendu prioritaire servi en moins de 2 min', prioMax < 120, prioMax + ' s')
  ok('après leurs 1ers échecs, les retouches Express honnêtes passent avant celles des attaquants (finies dans le délai de 150 s de l’app)', hTard.length > 0 && hOk === hTard.length, `${hOk}/${hTard.length}`)
}

// ── R7. Préparations gratuites qui échouent au délai : 3 comptes Starter relancent une carte à chaque fin ;
//        un client honnête lance une carte à t=1500 ──
console.log(`R7. 3 comptes relancent des préparations qui vont jusqu’au délai (${MCREF_S} s, échec, jamais débitées) ; client honnête : 1 carte à t=1500`)
reset()
{
  const ATT = [1, 2, 3].map((i) => uid('9999999', i))
  let h = null, maxPrep = 0
  await simuler(3600, (t) => {
    for (const a of ATT) if (t % 15 === 0) creer(a, 'mc-ref', MCREF_S, t, { _echec: true })   // la carte relance sans cesse
    if (t === 1500) h = carteClaude(uid('fffffff', 2), 1500, 40, 'carte honnête')
    if (h) h.tick(t)
    maxPrep = Math.max(maxPrep, rows.filter((r) => r.status === 'rendering' && col(r, 'plan->>__compose') === 'mc-ref').length)
  })
  const prepAtt = rows.filter((r) => ATT.includes(r.user_id) && r._debut != null && r._debut < 3600)
  const occ = prepAtt.reduce((x, r) => x + Math.min(r._duree, (r._fin ?? 3600) - r._debut), 0)
  console.log(`     → préparations des attaquants servies : ${prepAtt.length} en 1 h (${Math.round(occ / 60)} min de moteur) ; carte honnête : ${h && h.job && h.job._fin != null ? 'prête à t=' + h.job._fin + ' s (' + (h.job._fin - 1500) + ' s)' : 'jamais prête'}`)
  ok(`au plus ${R2 ? PREP_MAX : DC_MAX} moteur(s) pris par les préparations`, maxPrep <= (R2 ? PREP_MAX : DC_MAX), String(maxPrep))
  ok('attaquants : au plus 3 préparations en échec par compte et par heure', prepAtt.length <= 3 * ATT.length, String(prepAtt.length))
  ok('carte honnête prête en moins de 10 min (avant toute relance manuelle)', !!h && !!h.job && h.job._fin != null && h.job._fin - 1500 < 600, String(h && h.job && h.job._fin))
}

// ── S7. Délai de yt-dlp ──
console.log('S7. délai de yt-dlp')
ok('≤ 90 s', DC_FETCH_S <= 90, `${DC_FETCH_S} s`)

console.log(`\n${nKo === 0 ? '✓' : '✗'} ${nOk}/${nOk + nKo} vérifications OK`)
process.exit(nKo ? 1 : 0)
