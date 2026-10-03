// Supabase Edge Function — fal.ai proxy (#121)
// OmniHuman 1.5 passe par fal.ai et non plus par Hedra : fal rend en 1080p là où
// Hedra plafonnait nos générations à 720p (résolution codée en dur côté app).
// La clé fal reste dans les secrets Supabase (FAL_KEY) — jamais exposée au client.
//
// Appels :
//   GET  ?path=/health                            → { ok, hasKey } (diagnostic, sans session)
//   POST ?path=/fal-ai/<modèle>                   → SOUMISSION dans la file (FACTURANT)
//   GET  ?path=/fal-ai/<modèle>/requests/<id>[/status] → statut / résultat (non facturant)
//   GET  ?path=/requests/<id>[/status]            → idem, forme courte
//
// Sécurité (audit 05/09) : session utilisateur obligatoire (moteur de rendu = service_role) ;
// `?path=` validé (allowlist, jamais d'`@`/`..`) ; soumissions plafonnées par utilisateur + preuve de
// débit récent (H3) ; gate de plan serveur sur Kling 3.0 (Pro/Élite).
// Omni Flash IMAGE→VIDÉO (Axel 25/09) : ici = le seul CARRÉ 1:1 d'Express (kie ne fait pas de carré ; tout le reste passe
// par kie-proxy, sans repli fal) — Starter / Pro / Élite / BYOK, 1080p imposé, tirage EXACT de 5 cr × durée.
// Audit 02/10 (PRX-1) : Motion Control (Kling 2.6 / 3.0) et Omni ÉDITION sont facturés à la seconde de la vidéo du CLIENT.
// Le proxy n'acceptait qu'un plancher fixe (2 / 4 / 6 / 3) et relayait le corps tel quel → 2 crédits réservés = 15 s de Kling.
// Désormais (clients, jamais le moteur de rendu) : vidéo de NOTRE stockage dans le dossier de l'appelant, COPIE serveur
// (render-media/fal-in/<uid>/) mesurée par lecture partielle, corps réécrit vers cette copie, réserve ≥ tarif/s × durée
// (même arrondi que l'app, 1 s de tolérance + 0,25 s de gigue pour le client), moins les étapes annexes déjà payées sur la
// même op (fond effacé + détourage de Motion, ≤ 6) — voir _shared/mp4-duree.ts. Illisible → 400.
// Audit 02/10 (PRX-3) : le suivi d'un job LIÉ à l'op d'un AUTRE utilisateur (credit_ops.provider_job) répond 404.
// Audit 02/10 (P2, fal-reconcile) : la mesure d'entrée reste le MINIMUM de réservation, mais un MP4 forgé peut encore y
// paraître plus court qu'au décodeur de fal. À la soumission, la FACTURE du job est ouverte (fal_job_bills : tarif, op qui l'a
// financé), que le job soit lié à l'op ou non (relecture adverse : un détourage birefnet soumis avant sur la même op garde la
// liaison) ; à la lecture du RÉSULTAT, la vidéo PRODUITE par fal est mesurée (Range, hôtes fal seulement) et l'écart débité
// une fois, plafonné au solde (reconcile_fal_job, voir _shared/guard.ts « fal-reconcile »). Jamais de remboursement ici ;
// réponse inchangée.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, safePath, billableGate, helperGate, requirePlan, applyReservationFull, applyReservation, applyOmniReservation, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp, bindJob, releaseByJob, settleByJob, refundOpTerminal, refundByJobTerminal, OMNI_FLASH_PER_SEC, svc, ouvrirFactureFal, reglerJobFal, videoSortieFal, lecteurSortieFal, avecDelai } from '../_shared/guard.ts'
import { omnihumanFalBody } from '../_shared/omnihuman-bill.ts'   // OmniHuman (repli de kie, Axel 25/09) : durée MESURÉE, tirage exact
import { KIE_OPEN } from '../_shared/kie.ts'   // OmniHuman : mêmes plans que kie-proxy (lecture seule)
import { preparerVideoFal, tarifVideoFal, nettoyerCopiesFal, minimumSurReserve, ANNEXES_MAX_CR, dureeMp4, secondesFacturees, type TarifVideo } from '../_shared/mp4-duree.ts'   // PRX-1 : vidéo client mesurée ; P2 : vidéo PRODUITE mesurée

// file d'attente fal : soumission + polling (les générations vidéo durent ~1 min)
const FAL_QUEUE = 'https://queue.fal.run'
// noms de secret tolérés (au cas où la clé serait nommée autrement)
const KEY_NAMES = ['FALAI_API_KEY', 'FAL_KEY', 'FAL_API_KEY', 'FAL_AI_KEY', 'FALAI_KEY', 'FAL_SECRET']
const readKey = () => {
  for (const n of KEY_NAMES) { const v = Deno.env.get(n); if (v) return { name: n, value: v } }
  return { name: '', value: '' }
}
// /fal-ai/<owner>/<model>[/sub…] pour les soumissions et le polling ; /requests/<id>[/status] forme courte
const ALLOW = /^\/((fal-ai|google)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*|requests\/[A-Za-z0-9-]+(\/status)?)$/   // + google/ (Gemini Omni Flash : /edit, /image-to-video, /requests/<id>[/status])
const IS_POLL = /\/requests\/[A-Za-z0-9-]+(\/status)?$/
// Audit 28/09 (HAUTE) : ALLOW laissait SOUMETTRE n'importe quel modèle fal-ai/* ou google/* ; un modèle non listé retombait à
// falCost = 1 (réserve du client) → 1 crédit pour un modèle fal cher. SOUMISSION = liste FERMÉE des modèles réellement appelés
// (app, render-worker) ; le suivi (/requests/<id>…) reste libre (gratuit chez fal, sans tirage).
const SUBMIT_ALLOW: RegExp[] = [
  /^\/fal-ai\/kling-video\/(v2\.6|v3)\/(standard|pro)\/motion-control$/i,   // Motion Control 2.6 / 3.0
  /^\/fal-ai\/bytedance\/omnihuman\/v1\.5$/i,                               // OmniHuman 1.5 (repli de kie, worker)
  /^\/fal-ai\/nano-banana-pro\/edit$/i,                                      // 4K / faceswap
  /^\/fal-ai\/aura-sr$/i,                                                     // upscale HD
  /^\/google\/gemini-omni-flash\/v1\.1\/(edit|image-to-video)$/i,          // Module Omni + Flash (carré 1:1)
  /^\/fal-ai\/ben\/v2\/video$/i,                                            // matting vidéo (Motion Control)
  /^\/fal-ai\/birefnet(\/v2)?$/i, /^\/fal-ai\/imageutils\/rembg$/i,        // détourage
  /^\/fal-ai\/topaz\/upscale\/video$/i,                                     // upscale vidéo
]
// Coût serveur (borne basse) : Kling v3=6, Kling pro=4, Kling standard=2, OmniHuman=5, AuraSR=3, Nano=5,
// Omni edit=3 ; auxiliaires (ben/birefnet/rembg/topaz, couverts par l'op parente) = 1.
// Audit 02/10 : pour Kling et l'Omni édition d'un CLIENT, ce plancher n'est plus la borne : la réserve exigée est tarif/s ×
// durée MESURÉE (preparerVideoFal). Il ne reste que le repli du chemin réseau (catch) et les autres modèles.
function falCost(path: string): number {
  if (/\/kling-video\/v3\//i.test(path)) return 6
  if (/\/kling-video\//i.test(path)) return /\/pro\//i.test(path) ? 4 : 2
  if (/omnihuman/i.test(path)) return 5
  if (/nano-banana-pro/i.test(path)) return 5
  if (/aura-sr/i.test(path)) return 3
  if (/gemini-omni-flash/i.test(path)) return 3
  return 1
}
// Omni Flash image→vidéo (Axel 25/09) : corps RECONSTRUIT (champs de l'app seulement — jamais un paramètre client qui
// multiplierait le coût), 1080p IMPOSÉ, durée bornée 3-10 s comme fal (la même que celle qu'on facture). Facturé EXACTEMENT
// OMNI_FLASH_PER_SEC × durée : fin du plancher 3 cr quelle que soit la durée (réserve de 3 cr pour une vidéo de 10 s).
const OMNI_I2V = /\/google\/gemini-omni-flash\/[^?]*image-to-video/i
// OmniHuman 1.5 (26/09) : repli de kie-proxy (app, même op) — tirage EXACT 5 × durée MESURÉE (omnihuman-bill.ts), plus draw_full.
const OMNIHUMAN = /^\/fal-ai\/bytedance\/omnihuman\//i
const TOPAZ = /^\/fal-ai\/topaz\/upscale\/video$/i   // P2 : réconcilié à la sortie, 1 cr/s comme l'app (_mcGenerate : spendCreditsFor(dur, 'motion-topaz'))
const OMNIH_BUCKET = 'render-media'
const SUPA_URL = Deno.env.get('SUPABASE_URL') ?? ''
const OMNIH_SIGN = `${SUPA_URL}/storage/v1/object/sign/${OMNIH_BUCKET}/`
// Audit 02/10 (PRX-3) : à qui est ce job fal ? Seul un job LIÉ à l'op d'un AUTRE utilisateur est refusé : les jobs liés à
// aucune op restent lisibles par leur lanceur (owner / developer sans réservation, auxiliaires qui partagent l'op parente —
// birefnet / rembg / ben —, Kling lancé après un détourage sur la même op, tirage en fail-open). Les id fal sont des UUID.
// 'inconnue' = lecture impossible → ni 404 ni corps fal : « en cours » au suivi de statut, 503 au résultat (fermé, sans casser
// un suivi légitime : l'app sonde de nouveau).
async function proprieteJob(job: string, uid: string): Promise<'ok' | 'autrui' | 'inconnue'> {
  for (let essai = 0; essai < 2; essai++) {   // un hoquet isolé ne fait pas échouer un résultat déjà prêt : 2e lecture
    if (essai) await new Promise((r) => setTimeout(r, 250))
    try {
      const { data, error } = await svc().from('credit_ops').select('user_id').eq('provider_job', job).neq('user_id', uid).limit(1)
      if (error) { console.warn('[fal] propriété du job illisible:', error.message); continue }
      return data && data.length ? 'autrui' : 'ok'
    } catch { /* nouvel essai */ }
  }
  return 'inconnue'
}
// Audit 02/10 (PRX-1) : crédits que l'op a DÉJÀ payés avant cette vidéo (montant − réserve restante : fond effacé + détourage
// de Motion « Glisse un fond », tirés sur la même op). Même op que celle que tirera applyReservationFull (resolveOp). Pas d'op
// → 0 (le tirage tranchera) ; hoquet DB → le plafond (le tirage lui-même laisse passer sur hoquet, voir guard.ts).
async function dejaTireOp(uid: string, req: Request): Promise<number> {
  const op = await resolveOp(uid, req)
  if (!op) return 0
  if (op === '__ERR__') return ANNEXES_MAX_CR
  try {
    const { data, error } = await svc().from('credit_ops').select('amount, reserved_remaining').eq('id', op).eq('user_id', uid).maybeSingle()
    if (error) return ANNEXES_MAX_CR
    if (!data) return 0
    const a = Number(data.amount) || 0, r = data.reserved_remaining == null ? a : (Number(data.reserved_remaining) || 0)
    return Math.max(0, a - r)
  } catch { return ANNEXES_MAX_CR }
}
// Audit 02/10 (P2) : coût réel d'une vidéo PRODUITE = MÊMES tarif et arrondi que la réserve d'entrée (secondesFacturees,
// mp4-duree.ts) ; durée lue par plages sur le CDN de fal (≤ 15 s par essai : au-delà, règlement simple).
const coutSortie = (sec: number, parSec: number, maxSec: number) => parSec * secondesFacturees(sec, maxSec)
const mesurerSortie = (text: string) => (): Promise<number | null> => {
  const u = videoSortieFal(text)
  return u ? avecDelai(dureeMp4(lecteurSortieFal(u)), 15000) : Promise.resolve(null)
}
function omniI2vBody(raw: string): { body: string; sec: number } | { error: string } {
  let b: any = null
  try { b = JSON.parse(raw || '{}') } catch { /* traité juste dessous */ }
  if (!b || typeof b !== 'object') return { error: 'corps JSON invalide' }
  if (typeof b.image_url !== 'string' || !b.image_url) return { error: 'image_url requis' }
  if (typeof b.prompt !== 'string' || !b.prompt) return { error: 'prompt requis' }
  const sec = Math.max(3, Math.min(10, Math.round(Number(b.duration)) || 6))
  const aspect_ratio = ['9:16', '16:9', '1:1'].includes(String(b.aspect_ratio)) ? String(b.aspect_ratio) : '9:16'
  return { body: JSON.stringify({ image_url: b.image_url, prompt: b.prompt.slice(0, 20000), aspect_ratio, duration: sec, resolution: '1080p' }), sec }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST' && req.method !== 'GET') return jsonRes(405, { error: 'method_not_allowed' })

  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path') ?? '/'
  const { name: keyName, value: falKey } = readKey()

  // ── diagnostic : dit SI la clé existe, jamais sa valeur ──
  if (rawPath === '/health') {
    return jsonRes(200, { ok: true, hasKey: !!falKey })   // audit #3 : ne plus exposer longueur/nom de la clé sans auth
  }
  if (!falKey) return jsonRes(500, { error: 'Aucune clé fal.ai dans les secrets Supabase (attendu : FALAI_API_KEY)' })

  const v = safePath(rawPath, ALLOW)
  if (!v.ok) return jsonRes(400, { error: 'path refusé : ' + v.reason })
  const path = v.path
  const isSubmit = req.method === 'POST' && !IS_POLL.test(path.split('?')[0])
  if (isSubmit && !SUBMIT_ALLOW.some((r) => r.test(path.split('?')[0]))) return jsonRes(403, { error: 'modèle fal non autorisé' })
  // Op auxiliaire (matting/utilitaire, tirée per-cost et POTENTIELLEMENT partagée avec l'op parente) : on ne
  // rembourse JAMAIS le solde en son nom (sur-remboursement de la part parente) → seulement release réserve.
  // Hissé ici pour être lisible aussi dans le catch réseau (échec de soumission sans réponse).
  const isAuxPath = /\/(ben|birefnet|rembg|remove-background|bria|imageutils)\//i.test(path.split('?')[0])
  // Corps lu UNE fois ici (relayé tel quel plus bas) : Omni Flash image→vidéo doit connaître sa durée AVANT le tirage.
  let rawBody = req.method === 'POST' ? await req.text() : undefined
  const isOmniI2v = isSubmit && OMNI_I2V.test(path)

  // ── session utilisateur obligatoire — SAUF le moteur de rendu / backend Motion Control (service_role,
  //    jeton déjà vérifié par la passerelle et impossible à forger sans le secret du projet) ──
  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.isService && !auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })

  let drawnOp: string | undefined
  let drawnAmt = 0   // audit 14/09 : montant réellement tiré → restauration EXACTE au release (plus de falCost/9999)
  // Audit 02/10 (PRX-1) : copie serveur de la vidéo (Kling / Omni édition) — supprimée si aucun job fal n'a été créé.
  let videoCost = 0, videoCopie = ''
  let videoTarif: Pick<TarifVideo, 'parSec' | 'maxSec'> | null = null   // P2 : tarif du job à la seconde → sa facture (fal_job_bill_open)
  let annexesOp = 0   // P2 : étapes annexes déjà tirées sur l'op avant ce job (dejaTireOp) → « payé » de la facture, ≤ ANNEXES_MAX_CR
  const jeterCopie = async () => { if (videoCopie) { try { await svc().storage.from(OMNIH_BUCKET).remove([videoCopie]) } catch { /* best-effort */ } videoCopie = '' } }
  if (!auth.isService && auth.userId) {
    // ── Gate serveur : Motion 3.0 = Kling 3.0 (fal-ai/kling-video/v3/…) réservé Pro/Élite (0,168 $/s) ──
    if (isSubmit && /\/fal-ai\/kling-video\/v3\//i.test(path)) {
      const g = await requirePlan(auth.userId, ['pro', 'elite'], 'Motion 3.0 (Kling 3.0)'); if (!g.ok) return jsonRes(g.status, { error: g.error })   // via requirePlan → fail-open sur hoquet DB (audit 14/09)
    }
    // Audit métier 14/09 (Phase 2) — entitlement serveur des modèles à palier supérieur. Union client la plus
    // LARGE par chemin (voir matrice) → aucun 403 d'un flux légitime. AuraSR HD + Nano Banana Pro (fal) = Pro/Élite/BYOK.
    else if (isSubmit && (/\/fal-ai\/aura-sr/i.test(path) || /\/fal-ai\/nano-banana-pro/i.test(path))) {
      const g = await requirePlan(auth.userId, ['pro', 'elite', 'byok'], 'HD / 4K'); if (!g.ok) return jsonRes(g.status, { error: g.error })
    }
    // Omni Flash IMAGE→VIDÉO = tous les plans payants depuis le 25/09 (Axel : « Starter inclus ») ; Free → 403. L'EDIT
    // (/edit, Module Omni) reste Starter+ → ne PAS gater sur le nom seul.
    else if (isOmniI2v) {
      const g = await requirePlan(auth.userId, ['starter', 'pro', 'elite', 'byok'], 'Omni Flash'); if (!g.ok) return jsonRes(g.status, { error: g.error })
    }
    // OmniHuman (relecture 26/09) : ce chemin n'avait AUCUNE garde de plan — un Starter atteignait par le repli fal ce que
    // kie-proxy lui refuse. Mêmes plans que KIE_OPEN (Élite ; owner / developer passent), comme le Générateur et le Montage IA.
    else if (isSubmit && OMNIHUMAN.test(path.split('?')[0])) {
      const g = await requirePlan(auth.userId, KIE_OPEN['omnihuman-1.5'] || ['elite'], 'OmniHuman'); if (!g.ok) return jsonRes(g.status, { error: g.error })
    }
    const gate = isSubmit
      ? await billableGate({ userId: auth.userId, proxy: 'fal', requireDebit: true, debitMinutes: 120, rateMax: 40, label: path })
      : await helperGate(auth.userId, 'fal', 900)   // polling 4 s × 11 min Kling + 2 mattings en parallèle (traçage 05/09)
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
    // Audit 02/10 (PRX-3) : suivi / résultat d'un job lié à l'op d'un autre utilisateur → 404, AVANT tout appel à fal.
    if (!isSubmit) {
      const jid = (path.split('?')[0].match(/\/requests\/([A-Za-z0-9._-]+)/) || [])[1] || ''
      if (jid) {
        const p = await proprieteJob('fal:' + jid, auth.userId)
        if (p === 'autrui') return jsonRes(404, { error: 'Génération introuvable.' })
        if (p === 'inconnue') return /\/status$/.test(path.split('?')[0]) ? jsonRes(200, { status: 'IN_PROGRESS', throttled: true }) : jsonRes(503, { error: 'Suivi momentanément indisponible — réessaie dans un instant.' })
      }
    }
    if (isSubmit) {
      // H2 (audit 14/09) : AUXILIAIRES connus (matting/utilitaires « couverts par l'op parente ») = tirage
      // per-cost → plusieurs peuvent PARTAGER une op (corrige « garder le fond vidéo » : 2 mattings en parallèle
      // sur 1 débit se 402-aient mutuellement avec draw_full). TOUT LE RESTE (générations primaires ET modèles
      // NON listés) = draw_full : 1 op = 1 génération → ni refund-and-keep (reliquat remboursable) ni
      // sous-facturation d'un modèle inconnu retombé à falCost=1.
      const _aux = /\/(ben|birefnet|rembg|remove-background|bria|imageutils)\//i.test(path)
      // Omni Flash image→vidéo (25/09) : corps reconstruit + coût EXACT 5 × durée (tirage exact, comme kie-proxy).
      let omniCost = 0
      if (isOmniI2v) {
        const ob = omniI2vBody(rawBody ?? '')
        if ('error' in ob) return jsonRes(400, { error: ob.error })
        rawBody = ob.body; omniCost = OMNI_FLASH_PER_SEC * ob.sec
      }
      // OmniHuman (26/09) : corps reconstruit (URL de notre storage, audio WAV mesuré + copie serveur, prompt ≤ 300) ; illisible /
      // > 60 s / inaccessible → 400 AVANT tout tirage. Tirage EXACT (per-cost) : partage sûr d'une op (scènes du Montage).
      let omnihCost = 0
      if (OMNIHUMAN.test(path.split('?')[0])) {
        // UN job fal OmniHuman par op (relecture 26/09) : la liaison op ↔ job (credit_ops.provider_job) n'en garde qu'UN ; un
        // 2e job sur la même op n'était lié à rien → échec jamais rendu, succès jamais réglé. L'app n'en lance plus qu'un par
        // op (Montage IA : une op par scène ; Générateur : un seul repli fal pour tout l'audio) → refus AVANT tout tirage.
        const opH = await resolveOp(auth.userId, req)
        if (opH && opH !== '__ERR__') {
          try {
            const { data: row } = await svc().from('credit_ops').select('provider_job').eq('id', opH).maybeSingle()
            if (row && row.provider_job) return jsonRes(402, { error: 'Cette réservation porte déjà une génération : relance la génération.' })
          } catch { /* hoquet DB : on laisse passer (le tirage exact reste la barrière) */ }
        }
        const oh = await omnihumanFalBody(rawBody ?? '', auth.userId, OMNIH_BUCKET, OMNIH_SIGN)
        if ('error' in oh) return jsonRes(oh.status, { error: oh.error })
        rawBody = oh.body; omnihCost = oh.cost
        console.log('[fal] omnihuman audio', auth.userId, `envoyé=${oh.envoyeSec}s facturé=${oh.factureSec}s coût=${oh.cost}`)
      }
      // Audit 02/10 (PRX-1) : Motion Control / Omni édition — vidéo du client COPIÉE puis MESURÉE (voir en-tête) AVANT tout
      // tirage ; entrée hors de son stockage, illisible ou trop longue → 400, stockage indisponible → 503 (rien de tiré).
      if (tarifVideoFal(path)) {
        const pv = await preparerVideoFal({ path, raw: rawBody ?? '', uid: auth.userId, base: SUPA_URL, bucket: OMNIH_BUCKET, st: svc().storage.from(OMNIH_BUCKET) })
        if (!pv.ok) return jsonRes(pv.status, { error: pv.error })
        rawBody = pv.body; videoCopie = pv.copie
        // P2 : tarif du corps RECONSTRUIT (résolution Omni 720p / 1080p imposée par preparerVideoFal), pas celui du client.
        try { videoTarif = tarifVideoFal(path, (JSON.parse(pv.body) as { resolution?: unknown }).resolution) } catch { videoTarif = tarifVideoFal(path) }
        const deja = await dejaTireOp(auth.userId, req)
        videoCost = minimumSurReserve(pv.cost, deja); annexesOp = deja
        console.log('[fal] vidéo à la seconde', auth.userId, `mesuré=${pv.mesureSec}s facturé=${pv.factureSec}s coût=${pv.cost} annexes=${deja} minimum=${videoCost}`)
      }
      // Audit 02/10 (P2) : upscale Topaz (Motion 1080p depuis Standard : l'app débite 1 cr/s de la vidéo Kling, op
      // « motion-topaz ») — aucune mesure d'entrée possible (la vidéo vient du CDN de fal) et un plancher de 1 : l'écart sur
      // la vidéo PRODUITE est la seule borne. Max 60 s (l'app n'y envoie que des sorties Kling ≤ 30 s).
      if (TOPAZ.test(path.split('?')[0])) videoTarif = { parSec: 1, maxSec: 60 }
      // Primaire : plancher serveur = falCost(path) (audit 14/09) → une réserve sous ce plancher (ex.
      // spend_credits(1) devant un OmniHuman à 5) est refusée (402), fin de « 1 crédit = vidéo chère ».
      // Kling / Omni édition (02/10) : plancher = tarif/s × durée mesurée (− annexes déjà payées sur l'op, ≤ 6) ; toujours
      // draw_full (une op = une vidéo).
      const rr = omniCost
        ? await applyOmniReservation({ req, userId: auth.userId, proxy: 'fal', cost: omniCost, label: path })   // − image de départ offerte (25/09)
        : omnihCost
        ? await applyReservation({ req, userId: auth.userId, proxy: 'fal', cost: omnihCost, label: path })   // OmniHuman : tirage EXACT (26/09)
        : _aux
        ? await applyReservation({ req, userId: auth.userId, proxy: 'fal', cost: falCost(path), label: path })
        : await applyReservationFull({ req, userId: auth.userId, proxy: 'fal', label: path, minCost: videoCost || falCost(path) })
      if (!rr.ok) { await jeterCopie(); return jsonRes(rr.status, { error: rr.error }) }
      drawnOp = rr.opId
      // Omni = montant RÉELLEMENT tiré (relecture 25/09), jamais `omniCost` : 0 en mode ombre / hoquet DB → op NON liée
      // (ni bindJob, ni release / refund par job ou par op : rien à restaurer, pas de règlement de l'op d'une autre vidéo).
      if (omniCost || omnihCost) { drawnAmt = (rr as { drawn?: number }).drawn ?? 0; if (drawnAmt <= 0) drawnOp = undefined }
      else drawnAmt = _aux ? falCost(path) : ((rr as { drawn?: number }).drawn ?? 0)   // aux = coût tiré ; primaire = réserve drainée
    }
  }

  // ── relais vers fal ──
  try {
    const target = `${FAL_QUEUE}${path}`
    const init: RequestInit = { method: req.method, headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' } }
    if (req.method === 'POST') init.body = rawBody
    const res = await fetch(target, init)
    const text = await res.text()
    if (!auth.isService && auth.userId) {
      const bare = path.split('?')[0]
      const isStatus = /\/status$/.test(bare)
      const isResult = req.method === 'GET' && !isStatus && /\/requests\/[A-Za-z0-9._-]+$/.test(bare)
      const hasOutput = /"(video|image|images|url)"\s*:/.test(text)
      // Le job fal = le request_id (dans le path des polls, ou dans la réponse de soumission). On LIE l'op tirée
      // à ce job à la soumission, puis on règle/libère PAR JOB au poll → un poll d'un id ÉTRANGER ne peut plus
      // rendre la réserve d'une autre op (fermait le refund-and-keep) ni un id bidon débloquer un refund.
      const jobId = (bare.match(/\/requests\/([A-Za-z0-9._-]+)/) || [])[1] || ''
      const submitRid = isSubmit ? ((text.match(/"request_id"\s*:\s*"([^"]+)"/) || [])[1] || '') : ''
      // URL de suivi RENVOYÉE PAR fal (response_url = base .../requests/<id>, ou status_url sans /status) : l'espace-file
      // fal vit sur la RACINE fournisseur (ex. OmniHuman = /fal-ai/bytedance, PAS le chemin modèle qui répond 405) → on
      // stocke ce que fal donne, jamais une reconstruction. Sert à la réconciliation serveur (reconcile-fal-orphans).
      const submitRespUrl = isSubmit ? (((text.match(/"response_url"\s*:\s*"([^"]+)"/) || [])[1]) || (((text.match(/"status_url"\s*:\s*"([^"]+)"/) || [])[1] || '').replace(/\/status$/, ''))) : ''
      const falBase = /^https:\/\/queue\.fal\.run\/[A-Za-z0-9._\/-]+$/.test(submitRespUrl) ? submitRespUrl : ''   // jamais un autre hôte
      // ÉCHEC DE SOUMISSION — statuts RETRYABLES sur la MÊME op (à NE PAS rembourser, sinon on tue le renvoi) :
      //   • 400/422 = Motion Control v3 renvoie sans `elements` sur la même op (app _mcGenerate/runKling) ;
      //   • 408/425/429 = throttle/timeout, le flux peut re-tenter.
      // TOUT LE RESTE (5xx, 404, 401/402/403, 405, 410…) = définitif : le client n'a JAMAIS reçu de request_id
      //   (voir submitRid), donc il ne peut RIEN récupérer → aucun refund-and-keep possible même si fal a mis un
      //   job en file (504). On REMBOURSE donc le solde côté serveur (synchrone → l'onglet peut mourir, c'est déjà fait).
      const submitRetryable = res.status === 400 || res.status === 408 || res.status === 422 || res.status === 425 || res.status === 429
      // Audit 02/10 (P2) : + FACTURE du job à la seconde (Kling / Omni édition / Topaz) pour la réconciliation à la durée de
      // SORTIE — ouverte sur l'op TIRÉE même si bindJob n'a rien lié (op déjà liée à un détourage birefnet / rembg). Payé =
      // tirage du job + annexes de l'op plafonnées (jamais l'op entière : des auxiliaires tirés avant ne couvrent pas le Kling).
      const paye = drawnAmt > 0 ? drawnAmt + Math.min(Math.max(0, annexesOp), ANNEXES_MAX_CR) : null
      if (isSubmit && res.ok) { if (submitRid) { await bindJob(auth.userId, drawnOp, 'fal:' + submitRid, drawnAmt, falBase); if (videoTarif) await ouvrirFactureFal(auth.userId, drawnOp, 'fal:' + submitRid, videoTarif.parSec, videoTarif.maxSec, falBase, paye) } }   // lie l'op au job créé + tiré + URL de suivi fal (réconciliation)
      // Soumission NON-2xx AVEC un request_id (rare : erreur mais job créé) → on LIE (le poll gèrera), jamais de refund.
      else if (isSubmit && !res.ok && submitRid) { await bindJob(auth.userId, drawnOp, 'fal:' + submitRid, drawnAmt, falBase); if (videoTarif) await ouvrirFactureFal(auth.userId, drawnOp, 'fal:' + submitRid, videoTarif.parSec, videoTarif.maxSec, falBase, paye) }
      // Soumission échouée SANS job récupérable : définitif+primaire → REMBOURSE le solde serveur (couvre 5xx/timeout,
      // ferme « onglet fermé = crédits perdus », point 1) ; retryable OU aux OU refus (op partagée/multi-étapes/livrée)
      // → repli release réserve inchangé (préserve le renvoi même-op de MC v3).
      else if (isSubmit && !res.ok) { if (!(!submitRetryable && !isAuxPath && await refundOpTerminal(auth.userId, drawnOp, drawnAmt))) await releaseOp(auth.userId, drawnOp, drawnAmt) }
      // Poll de STATUT (GET .../status, 200 body FAILED) → job mort : REMBOURSE le solde de l'op LIÉE (cas propre,
      // idempotent ; refus → repli release_by_job). Aucun flux ne ré-utilise la même op après un statut FAILED.
      else if (req.method === 'GET' && res.ok && /"status"\s*:\s*"(FAILED|ERROR|CANCELLED|CANCELED)"/i.test(text)) { if (jobId) { if (!(await refundByJobTerminal(auth.userId, 'fal:' + jobId))) await releaseByJob(auth.userId, 'fal:' + jobId) } }
      // GET de RÉSULTAT terminal (422 / body FAILED) → REMBOURSE le solde de l'op LIÉE côté serveur (mort-client
      // protégé : Omni/OmniHuman/Express qui échouent en 422 au résultat n'attendent plus le refund client). SÛR
      // vis-à-vis du repli modération Motion 3.0→2.6 : le client refacture DÉSORMAIS AVANT de relancer la 2.6 (il
      // débite une op FRAÎCHE, cf. app _mcGenerate) → le 2.6 ne ré-utilise plus cette op (refundée) → pas de 402.
      // Refus (op partagée/multi-étapes/livrée) → repli release_by_job inchangé. (Échec TERMINAL only.)
      else if (isResult && (res.status === 422 || /"status"\s*:\s*"(FAILED|ERROR|CANCELLED|CANCELED)"/i.test(text))) { if (jobId) { if (!(await refundByJobTerminal(auth.userId, 'fal:' + jobId))) await releaseByJob(auth.userId, 'fal:' + jobId) } }
      // livré → op LIÉE non remboursable. Audit 02/10 (P2) : résultat VIDÉO d'un job dont la facture est ouverte (tarif posé à
      // la soumission, jamais lu dans ce chemin de suivi) → durée de la vidéo PRODUITE mesurée, écart débité une fois, plafonné
      // au solde ; pas de facture → settle_by_job comme avant ; sortie illisible ou hors CDN fal → facture close sans charge +
      // settle_by_job (résultat image : détourage, 4K… → settle_by_job direct). Le corps renvoyé au client ne change pas.
      else if (isResult && res.ok && hasOutput) { if (jobId) { if (videoSortieFal(text) || /"video(_url)?"\s*:/.test(text)) await reglerJobFal({ userId: auth.userId, job: 'fal:' + jobId, mesurer: mesurerSortie(text), cout: coutSortie, source: 'proxy' }); else await settleByJob(auth.userId, 'fal:' + jobId) } }
      // Audit 02/10 (PRX-1) : copie de la vidéo — gardée tant que fal peut la lire (job créé) ; sinon supprimée tout de suite.
      // Une soumission réussie supprime aussi les copies de CET utilisateur dont le lien signé a expiré (best-effort).
      if (isSubmit && videoCopie) {
        if (res.ok || submitRid) { videoCopie = ''; await nettoyerCopiesFal(svc().storage.from(OMNIH_BUCKET), auth.userId) }
        else await jeterCopie()
      }
    }
    // fal renvoie 403/402 quand le compte n'a plus de crédit : message explicite côté app
    if (res.status === 402 || /insufficient|balance|quota/i.test(text)) {
      return jsonRes(402, { error: 'Crédits fal.ai épuisés — recharge le compte fal', falStatus: res.status })
    }
    return new Response(text, { status: res.status, headers: { ...CORS, 'Content-Type': res.headers.get('content-type') ?? 'application/json' } })
  } catch (err) {
    // Échec RÉSEAU/TIMEOUT d'une soumission (aucune réponse fal reçue → aucun request_id renvoyé au client →
    // rien à récupérer → pas de refund-and-keep) : primaire → REMBOURSE le solde serveur (couvre le « timeout de
    // soumission », point 1) ; aux ou refus → repli release réserve. Best-effort (jamais bloquant).
    if (isSubmit && !auth.isService && auth.userId) {
      try { if (!(!isAuxPath && await refundOpTerminal(auth.userId, drawnOp, drawnAmt || 1))) await releaseOp(auth.userId, drawnOp, drawnAmt || 1) } catch { /* best-effort */ }
      await jeterCopie()   // aucune réponse fal → aucun job : la copie de la vidéo ne sert plus (02/10)
    }
    console.error('fal-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
