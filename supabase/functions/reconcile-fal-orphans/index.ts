// reconcile-fal-orphans — filets « jamais perdre de crédits ni une vidéo payée » des jobs LIÉS à une op
// (credit_ops.provider_job) : fal (audit Omni 15/09, dont le carré 1:1 d'Express) et le repli Google Veo d'Express
// (audit Express 28/09 #11). Déclenché par pg_cron toutes les 30 min (POST + x-cron-key = CRON_SECRET).
//
// Un job SOUMIS (op liée, réserve tirée) dont le client meurt ou abandonne l'attente continue chez le fournisseur ;
// personne n'observe la fin → crédits perdus (échec) ou vidéo payée jamais livrée (succès). Pour chaque job ouvert
// (list_open_jobs : pas encore réglé ni remboursé — y compris les ops Express, réglées par leur image de départ), on
// VÉRIFIE le statut chez le fournisseur et on tranche :
//   • échec confirmé (FAILED / 422 / opération Veo terminée sans vidéo) → refund_job_open (le tirage du job + le reste
//     de l'op ; une étape déjà livrée, l'image de départ, reste payée) ;
//   • terminé AVEC vidéo → copiée dans render-media/<uid>/lib + ligne library_items (la Bibliothèque de l'app la fusionne
//     au prochain chargement), PUIS settle_by_job ; copie ratée → nouvelle tentative au passage suivant, remboursement
//     au-delà de 24 h (le client ne l'a jamais eue : un job récupéré par l'app est déjà réglé, donc absent de la liste) ;
//   • en cours → on saute ; toujours en cours après 6 h → remboursé (comme reconcile-kie) ;
//   • statut illisible / hoquet → aucune décision (jamais de remboursement sans preuve), sauf introuvable après 24 h ;
//   • job rendu à la réserve par l'app ('released') puis onglet fermé (ni remboursé ni re-tiré) → remboursé après 30 min.
// Fenêtre : jobs de plus de 20 min (l'app attend fal ~11 min, Google ~10 min) et de moins de 48 h. Le travail tourne en
// tâche de fond (EdgeRuntime.waitUntil) : le cron n'attend que 30 s, une copie de vidéo peut en prendre davantage.
// Audit 02/10 (P2, fal-reconcile) : un job fal à tarif à la seconde (Motion Control Kling, Omni édition, Topaz — facture
// fal_job_bills ouverte par fal-proxy à la soumission) livré par ce filet est réglé comme dans fal-proxy : durée de la vidéo
// PRODUITE mesurée sur le fichier téléchargé (déjà en mémoire, aucune lecture de plus), écart débité une fois, plafonné au
// solde (reconcile_fal_job) ; sans facture, ou si la mesure échoue, settle_by_job comme avant. Jamais de remboursement à ce
// titre. 2e passe (billsPass) : factures encore ouvertes que list_open_jobs ne reprend pas — job Kling NON lié (l'op portait
// déjà le détourage de « Glisse un fond »), op liée déjà réglée par l'image de fond — livrées et réconciliées de la même façon ;
// échec confirmé par fal → facture close sans charge (aucun remboursement ici, comme avant pour ces jobs).
// Audit 04/10 (P4, chantier « fal ») :
//   • MC-5 : une vidéo dont l'écart de sortie n'est pas couvert par le solde n'est NI déposée en Bibliothèque NI réglée (devis
//     sans effet fal_job_quote AVANT le dépôt) ; nouvel essai à chaque passage — livrée dès que le solde couvre l'écart. Jamais
//     remboursée au-delà de 24 h (la vidéo existe : la rembourser rendrait gratuit un job forgé) ; durée mesurée par plages sur
//     le CDN de fal AVANT tout téléchargement (une vidéo retenue n'est pas retéléchargée à chaque passage).
//   • MC-3 : le job Kling de « Glisse un fond » est désormais LIÉ à son op (le détourage ne lie plus, il règle l'op) ; son échec
//     confirmé par fal, client parti, est remboursé ici (refund_job_open : le tirage du job, étapes annexes payées) au lieu de
//     fermer la facture sans rien rendre.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { kieDownload, kieKindOf } from '../_shared/kie.ts'
import { reglerJobFal, fermerFactureFal, tarifJobFal, falReconcileEnforce, urlSortieFal, lecteurSortieFal, avecDelai } from '../_shared/guard.ts'
import { dureeMp4, dureeMp4Octets, secondesFacturees } from '../_shared/mp4-duree.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''
const FAL_KEY = ['FALAI_API_KEY', 'FAL_KEY', 'FAL_API_KEY', 'FAL_AI_KEY', 'FALAI_KEY', 'FAL_SECRET'].map(n => Deno.env.get(n) ?? '').find(Boolean) ?? ''
const GOOGLE_KEY = Deno.env.get('GOOGLE_AI_KEY') ?? ''
const VEO_BASE = 'https://generativelanguage.googleapis.com/v1beta/'
const VEO_MODELS = ['veo-3.1-lite-generate-preview', 'veo-3.1-fast-generate-preview']   // les seuls que google-ai-proxy soumet
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
const H = 60, DAY = 24 * 60
// P2 : MÊMES tarif et arrondi que la réserve d'entrée de fal-proxy (secondesFacturees, mp4-duree.ts)
const coutSortie = (sec: number, parSec: number, maxSec: number) => parSec * secondesFacturees(sec, maxSec)

type Job = { id: string; user_id: string; reason: string | null; provider_job: string; provider_path: string | null; job_bill_state: string | null; created_at: string }
type Facture = { job: string; user_id: string; op_id: string; path: string | null; created_at: string }
type Tally = Record<string, number>

const refund = async (o: Job, t: Tally) => {
  const { data, error } = await svc.rpc('refund_job_open', { p_user: o.user_id, p_job: o.provider_job })
  const d = (data || {}) as { ok?: boolean; reason?: string }
  if (!error && d.ok) t.refunded++
  else { t.unresolved++; console.log('[reconcile] remboursement refusé', o.provider_job, error?.message || d.reason) }
}
// Audit 04/10 (MC-5) : la lecture de ce job fal serait-elle RETENUE (écart de sortie non couvert par le solde) ? Devis sans effet
// (fal_job_quote) avec les MÊMES tarif, arrondi et coût que reglerJobFal. Sortie illisible, pas de facture ouverte, migration
// absente ou hoquet → false : comportement d'avant (dépôt puis règlement, facture close sans charge si illisible).
const retenu = async (o: Job, sec: number | null, tarif?: { perSec: number; maxSec: number }): Promise<boolean> => {
  if (!(sec && sec > 0)) return false
  const tf = tarif ?? await tarifJobFal(o.user_id, o.provider_job); if (!tf) return false
  const { data, error } = await svc.rpc('fal_job_quote', { p_user: o.user_id, p_job: o.provider_job, p_real_cost: Math.max(0, Math.ceil(coutSortie(sec, tf.perSec, tf.maxSec))), p_enforce: falReconcileEnforce() })
  if (error) { console.log('[reconcile] devis fal indisponible', o.provider_job, error.message); return false }
  return !!(data && (data as { held?: boolean }).held === true)
}
// Audit 04/10 (MC-5) : même devis AVANT le téléchargement, durée lue par plages sur le CDN de fal (comme fal-proxy). Lecture
// impossible ou hors CDN fal → false : le téléchargement et le devis sur le fichier entier (deliver) tranchent.
// Audit 04/10 (relecture) : facture lue AVANT la mesure — un job sans facture ouverte (Omni image→vidéo, Express…) ne peut
// pas être retenu : aucune lecture réseau (jusqu'à 15 s) à chaque passage du filet.
const retenuAvantCopie = async (o: Job, url: string): Promise<boolean> => {
  const u = o.provider_job.startsWith('fal:') ? urlSortieFal(url) : null
  if (!u) return false
  const tf = await tarifJobFal(o.user_id, o.provider_job); if (!tf) return false
  return await retenu(o, await avecDelai(dureeMp4(lecteurSortieFal(u)), 15000), tf)
}
// Range la vidéo en Bibliothèque (idempotent) puis règle le job. false = à retenter au prochain passage ; 'retenu' (MC-5) = écart
// non couvert, à retenter aussi mais JAMAIS remboursé.
const deliver = async (o: Job, buf: ArrayBuffer, ct: string, t: Tally): Promise<boolean | 'retenu'> => {
  const k = kieKindOf(ct, buf)
  if (!k || k.kind !== 'video') { console.log('[reconcile] sortie non vidéo', o.provider_job, ct); return false }
  // Audit 04/10 (MC-5) : écart non couvert → ni dépôt ni règlement (le dépôt PRÉCÈDE le règlement : un dépôt raté est retenté)
  const fal = o.provider_job.startsWith('fal:')
  const sec = fal ? dureeMp4Octets(new Uint8Array(buf)) : null
  if (fal && await retenu(o, sec)) { t.held = (t.held || 0) + 1; console.log('[reconcile] vidéo retenue (écart non couvert)', o.provider_job); return 'retenu' }
  const path = `${o.user_id}/lib/${o.provider_job.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 90)}.${k.ext}`
  const up = await svc.storage.from('render-media').upload(path, new Uint8Array(buf), { contentType: k.mime, upsert: true })
  if (up.error) { console.log('[reconcile] upload', o.provider_job, up.error.message); return false }
  const { data: prev, error: pErr } = await svc.from('library_items').select('id').eq('user_id', o.user_id).eq('storage_path', path).limit(1)
  if (pErr) return false
  let insere = false
  if (!(prev && prev[0])) {
    // vue CLIENT : jamais le nom du moteur ni du fournisseur (Axel 25/09)
    const ins = await svc.from('library_items').insert({ user_id: o.user_id, kind: 'video-simple', name: /^express/.test(String(o.reason || '')) ? 'Vidéo Express' : 'Vidéo récupérée', tags: ['récupérée'], style: '', emo: '', storage_path: path })
    if (ins.error) { console.log('[reconcile] bibliothèque', o.provider_job, ins.error.message); return false }
    insere = true
  }
  // Audit 02/10 (P2) : job fal → réconciliation à la durée de la vidéo produite (fichier déjà téléchargé) ; Veo → inchangé.
  if (fal) {
    const r = await reglerJobFal({ userId: o.user_id, job: o.provider_job, mesurer: async () => sec, cout: coutSortie, essais: 1, source: 'filet' })
    // Audit 04/10 (MC-5) : solde baissé entre le devis et le règlement → retenu : le dépôt de CE passage est retiré.
    if (r.held === true) {
      if (insere) {
        try { await svc.from('library_items').delete().eq('user_id', o.user_id).eq('storage_path', path) } catch { /* best-effort */ }
        try { await svc.storage.from('render-media').remove([path]) } catch { /* best-effort */ }
      }
      t.held = (t.held || 0) + 1
      return 'retenu'
    }
    if (r.mode === 'reconcile') { t.reconciled = (t.reconciled || 0) + 1; t.charged = (t.charged || 0) + (Number(r.charged) || 0) }
  } else await svc.rpc('settle_by_job', { p_user: o.user_id, p_job: o.provider_job })
  t.delivered++
  return true
}
// Premier lien vidéo d'une réponse JSON (fal : video.url ; Veo : …video.uri ou bytesBase64Encoded), sans dépendre de l'enveloppe.
function findVideo(node: unknown, depth = 0): { url?: string; b64?: string } | null {
  if (!node || typeof node !== 'object' || depth > 8) return null
  const o = node as Record<string, unknown>
  if (typeof o.bytesBase64Encoded === 'string' && o.bytesBase64Encoded.length > 100) return { b64: o.bytesBase64Encoded }
  for (const key of ['video', 'videos', 'generatedSamples', 'generatedVideos', 'generateVideoResponse', 'response', 'output']) {
    const v = o[key]
    if (v && typeof v === 'object') {
      if (!Array.isArray(v) && typeof (v as Record<string, unknown>).url === 'string') return { url: (v as Record<string, string>).url }
      if (!Array.isArray(v) && typeof (v as Record<string, unknown>).uri === 'string') return { url: (v as Record<string, string>).uri }
      const inner = Array.isArray(v) ? v.map(x => findVideo(x, depth + 1)).find(Boolean) : findVideo(v, depth + 1)
      if (inner) return inner
    }
  }
  return null
}

async function falPass(minAge: number, maxAge: number, limit: number): Promise<Tally> {
  const t: Tally = { scanned: 0, refunded: 0, delivered: 0, settled: 0, running: 0, unresolved: 0, errors: 0 }
  if (!FAL_KEY) return t
  const { data, error } = await svc.rpc('list_open_jobs', { p_prefix: 'fal:', p_min_age_min: minAge, p_max_age_min: maxAge, p_limit: limit })
  if (error) { console.error('[reconcile] fal list', error.message); return t }
  const falAuth = { 'Authorization': `Key ${FAL_KEY}` }
  const failed = (s: string) => /^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(s)
  for (const o of (data as Job[]) || []) {
    t.scanned++
    try {
      const age = (Date.now() - Date.parse(o.created_at)) / 60000
      if (o.job_bill_state === 'released') { if (age >= 30) await refund(o, t); else t.running++; continue }
      // provider_path = l'URL de suivi RENVOYÉE PAR fal (…/requests/<id>), validée (hôte queue.fal.run, anti-SSRF) ;
      // les utilitaires synchrones (détourage…) ne passent jamais par ici.
      const base = String(o.provider_path || '')
      if (!/^https:\/\/queue\.fal\.run\/[A-Za-z0-9._\/-]+$/.test(base) || /\/(ben|birefnet|rembg|remove-background|bria|imageutils)\//.test(base)) { t.unresolved++; continue }
      const st = await fetch(base + '/status', { headers: falAuth, signal: AbortSignal.timeout(20000) })
      const stText = await st.text().catch(() => '')
      if (!st.ok) { if (st.status === 404 && age > DAY) await refund(o, t); else t.unresolved++; continue }
      const status = (stText.match(/"status"\s*:\s*"([^"]+)"/) || [])[1] || ''
      if (failed(status)) { await refund(o, t); continue }
      if (!/^COMPLETED$/i.test(status)) { if (age > 6 * H) await refund(o, t); else t.running++; continue }
      // COMPLETED au statut ne prouve pas la livraison (« COMPLETED puis 422 » n'apparaît qu'au résultat).
      const re = await fetch(base, { headers: falAuth, signal: AbortSignal.timeout(20000) })
      const reText = await re.text().catch(() => '')
      if (re.status === 422 || /"status"\s*:\s*"(FAILED|ERROR|CANCELLED|CANCELED)"/i.test(reText)) { await refund(o, t); continue }
      if (!re.ok) { t.unresolved++; continue }
      let parsed: unknown = null; try { parsed = JSON.parse(reText) } catch { /* illisible */ }
      const vid = findVideo(parsed)
      if (!vid || !vid.url) {
        // sortie sans vidéo (job image) : comme avant, livrée = réglée
        if (/"(image|images|url)"\s*:/.test(reText)) { await svc.rpc('settle_by_job', { p_user: o.user_id, p_job: o.provider_job }); t.settled++ } else t.unresolved++
        continue
      }
      // Audit 04/10 (MC-5) : vidéo retenue (écart non couvert par le solde) → ni téléchargée, ni déposée, ni remboursée.
      if (await retenuAvantCopie(o, vid.url)) { t.held = (t.held || 0) + 1; continue }
      const dl = await kieDownload(vid.url)   // https seulement, hôtes internes refusés, redirections vérifiées
      const livre = dl ? await deliver(o, dl.buf, dl.ct, t) : false
      if (livre === 'retenu') continue
      if (!livre) { if (age > DAY) await refund(o, t); else t.unresolved++ }
    } catch (e) { t.errors++; console.error('[reconcile] fal', o.provider_job, (e as Error)?.message) }
  }
  return t
}

// Audit 02/10 (P2) : factures fal à la seconde ouvertes, hors list_open_jobs (voir en-tête). Jamais close sans preuve d'échec
// de fal (statut FAILED, résultat 422) : en cours, illisible ou téléchargement raté → nouvel essai au passage suivant (une
// facture close ne serait plus réconciliée si le client lisait le résultat plus tard) ; au-delà de la fenêtre, plus listée.
async function billsPass(minAge: number, maxAge: number, limit: number): Promise<Tally> {
  const t: Tally = { scanned: 0, delivered: 0, failed: 0, running: 0, unresolved: 0, errors: 0 }
  if (!FAL_KEY) return t
  const { data, error } = await svc.rpc('list_open_fal_bills', { p_min_age_min: minAge, p_max_age_min: maxAge, p_limit: limit })
  if (error) { console.error('[reconcile] factures fal', error.message); return t }
  const falAuth = { 'Authorization': `Key ${FAL_KEY}` }
  // Audit 04/10 (MC-3) : échec CONFIRMÉ par fal d'un job LIÉ à une op déjà réglée (« Glisse un fond » : le détourage règle l'op
  // dès sa soumission) → refund_job_open rend le tirage du job et la réserve restante (étapes annexes payées). Job non lié,
  // déjà livré ou sans tirage noté → refus de la RPC : facture close sans charge, comme avant.
  const fermer = async (f: Facture) => {
    const { data, error } = await svc.rpc('refund_job_open', { p_user: f.user_id, p_job: f.job })
    const d = (data || {}) as { ok?: boolean; reason?: string }
    if (!error && d.ok) t.refunded = (t.refunded || 0) + 1
    else if (error || (d.reason && d.reason !== 'no_op')) console.log('[reconcile] facture fal : remboursement refusé', f.job, error?.message || d.reason)
    if (await fermerFactureFal(f.user_id, f.job)) t.failed++; else t.unresolved++
  }
  for (const f of (data as Facture[]) || []) {
    t.scanned++
    try {
      const base = String(f.path || '')   // URL de suivi RENVOYÉE PAR fal, revalidée (hôte queue.fal.run, anti-SSRF)
      if (!/^https:\/\/queue\.fal\.run\/[A-Za-z0-9._\/-]+$/.test(base) || /\/(ben|birefnet|rembg|remove-background|bria|imageutils)\//.test(base)) { t.unresolved++; continue }
      const st = await fetch(base + '/status', { headers: falAuth, signal: AbortSignal.timeout(20000) })
      const stText = await st.text().catch(() => '')
      if (!st.ok) { t.unresolved++; continue }
      const status = (stText.match(/"status"\s*:\s*"([^"]+)"/) || [])[1] || ''
      if (/^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(status)) { await fermer(f); continue }
      if (!/^COMPLETED$/i.test(status)) { t.running++; continue }
      const re = await fetch(base, { headers: falAuth, signal: AbortSignal.timeout(20000) })
      const reText = await re.text().catch(() => '')
      if (re.status === 422) { await fermer(f); continue }
      if (!re.ok) { t.unresolved++; continue }
      let parsed: unknown = null; try { parsed = JSON.parse(reText) } catch { /* illisible */ }
      const vid = findVideo(parsed)
      if (!vid || !vid.url) { t.unresolved++; continue }
      const o: Job = { id: f.op_id, user_id: f.user_id, reason: null, provider_job: f.job, provider_path: base, job_bill_state: null, created_at: f.created_at }
      if (await retenuAvantCopie(o, vid.url)) { t.held = (t.held || 0) + 1; continue }   // Audit 04/10 (MC-5)
      const dl = await kieDownload(vid.url)   // https seulement, hôtes internes refusés, redirections vérifiées
      const livre = dl ? await deliver(o, dl.buf, dl.ct, t) : false
      if (!livre) t.unresolved++
    } catch (e) { t.errors++; console.error('[reconcile] facture fal', f.job, (e as Error)?.message) }
  }
  return t
}

async function veoPass(minAge: number, maxAge: number, limit: number): Promise<Tally> {
  const t: Tally = { scanned: 0, refunded: 0, delivered: 0, running: 0, unresolved: 0, errors: 0 }
  if (!GOOGLE_KEY) return t
  const { data, error } = await svc.rpc('list_open_jobs', { p_prefix: 'veo:', p_min_age_min: minAge, p_max_age_min: maxAge, p_limit: limit })
  if (error) { console.error('[reconcile] veo list', error.message); return t }
  const gAuth = { 'x-goog-api-key': GOOGLE_KEY }
  for (const o of (data as Job[]) || []) {
    t.scanned++
    try {
      const age = (Date.now() - Date.parse(o.created_at)) / 60000
      if (o.job_bill_state === 'released') { if (age >= 30) await refund(o, t); else t.running++; continue }
      const id = o.provider_job.slice(4)
      if (!/^[A-Za-z0-9._-]{4,200}$/.test(id)) { t.unresolved++; continue }
      const path = String(o.provider_path || '')
      const urls = /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[A-Za-z0-9._-]+\/operations\/[A-Za-z0-9._-]+$/.test(path)
        ? [path] : VEO_MODELS.map(m => `${VEO_BASE}models/${m}/operations/${id}`)   // jobs liés avant le 28/09 : sans chemin
      let body = '', found = false
      for (const u of urls) {
        const r = await fetch(u, { headers: gAuth, signal: AbortSignal.timeout(20000) })
        if (r.ok) { body = await r.text(); found = true; break }
        await r.body?.cancel().catch(() => {})
      }
      if (!found) { if (age > DAY) await refund(o, t); else t.unresolved++; continue }
      if (!/"done"\s*:\s*true/.test(body)) { if (age > 6 * H) await refund(o, t); else t.running++; continue }
      let parsed: unknown = null; try { parsed = JSON.parse(body) } catch { /* illisible */ }
      const vid = findVideo(parsed)
      if (!vid) { await refund(o, t); continue }   // terminée sans vidéo (erreur, filtre RAI) : non livrée → remboursée
      let buf: ArrayBuffer | null = null, ct = ''
      if (vid.b64) { const bin = atob(vid.b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); buf = u8.buffer; ct = 'video/mp4' }
      else if (vid.url && /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/[A-Za-z0-9._-]+:download(\?alt=media)?$/.test(vid.url)) {
        const r = await fetch(vid.url.includes('?') ? vid.url : vid.url + '?alt=media', { headers: gAuth, signal: AbortSignal.timeout(120000) })
        if (r.ok) { buf = await r.arrayBuffer(); ct = r.headers.get('content-type') || '' } else await r.body?.cancel().catch(() => {})
      }
      if (!(buf && await deliver(o, buf, ct, t))) { if (age > DAY) await refund(o, t); else t.unresolved++ }
    } catch (e) { t.errors++; console.error('[reconcile] veo', o.provider_job, (e as Error)?.message) }
  }
  return t
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  // Auth : SEULEMENT le cron (x-cron-key = CRON_SECRET). Jamais un JWT/role d'un claim.
  const isCron = !!CRON_SECRET && timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)
  if (!isCron) return json({ error: 'forbidden' }, 403)

  let minAge = 20, maxAge = 2 * DAY, limit = 50, wait = false
  try {
    const b = await req.json()
    if (b && typeof b === 'object') {
      if (Number.isFinite(b.minAge)) minAge = b.minAge
      if (Number.isFinite(b.maxAge)) maxAge = b.maxAge
      if (Number.isFinite(b.limit)) limit = b.limit
      wait = b.wait === true   // test manuel : attendre le résultat au lieu de répondre tout de suite
    }
  } catch { /* corps optionnel */ }

  const work = (async () => {
    const fal = await falPass(minAge, maxAge, limit)
    const factures = await billsPass(minAge, maxAge, limit)   // APRÈS falPass : un job qu'il vient de livrer a sa facture close
    const veo = await veoPass(minAge, maxAge, limit)
    console.log(`[reconcile] fal=${JSON.stringify(fal)} factures=${JSON.stringify(factures)} veo=${JSON.stringify(veo)}`)
    return { fal, factures, veo }
  })()
  if (wait) return json({ ok: true, ...(await work) })
  const ru = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (ru && typeof ru.waitUntil === 'function') { ru.waitUntil(work); return json({ ok: true, started: true }) }
  return json({ ok: true, ...(await work) })
})
