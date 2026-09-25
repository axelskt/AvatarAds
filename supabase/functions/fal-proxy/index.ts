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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, safePath, billableGate, helperGate, requirePlan, applyReservationFull, applyReservation, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp, bindJob, releaseByJob, settleByJob, refundOpTerminal, refundByJobTerminal, OMNI_FLASH_PER_SEC } from '../_shared/guard.ts'

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
// Coût serveur (borne basse) : Kling v3=6, Kling pro=4, Kling standard=2, OmniHuman=5, AuraSR=3, Nano=5,
// Omni edit=3 ; auxiliaires (ben/birefnet/rembg/topaz, couverts par l'op parente) = 1.
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
    const gate = isSubmit
      ? await billableGate({ userId: auth.userId, proxy: 'fal', requireDebit: true, debitMinutes: 120, rateMax: 40, label: path })
      : await helperGate(auth.userId, 'fal', 900)   // polling 4 s × 11 min Kling + 2 mattings en parallèle (traçage 05/09)
    if (!gate.ok) return jsonRes(gate.status, { error: gate.error })
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
      // Primaire : plancher serveur = falCost(path) (audit 14/09) → une réserve sous ce plancher (ex.
      // spend_credits(1) devant un OmniHuman à 5) est refusée (402), fin de « 1 crédit = vidéo chère ».
      const rr = (_aux || omniCost)
        ? await applyReservation({ req, userId: auth.userId, proxy: 'fal', cost: omniCost || falCost(path), label: path })
        : await applyReservationFull({ req, userId: auth.userId, proxy: 'fal', label: path, minCost: falCost(path) })
      if (!rr.ok) return jsonRes(rr.status, { error: rr.error })
      drawnOp = rr.opId
      drawnAmt = omniCost || (_aux ? falCost(path) : ((rr as { drawn?: number }).drawn ?? 0))   // Omni / aux = coût tiré ; primaire = réserve drainée
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
      if (isSubmit && res.ok) { if (submitRid) await bindJob(auth.userId, drawnOp, 'fal:' + submitRid, drawnAmt, falBase) }   // lie l'op au job créé + tiré + URL de suivi fal (réconciliation)
      // Soumission NON-2xx AVEC un request_id (rare : erreur mais job créé) → on LIE (le poll gèrera), jamais de refund.
      else if (isSubmit && !res.ok && submitRid) { await bindJob(auth.userId, drawnOp, 'fal:' + submitRid, drawnAmt, falBase) }
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
      else if (isResult && res.ok && hasOutput) { if (jobId) await settleByJob(auth.userId, 'fal:' + jobId) }                                                                         // livré → op LIÉE non remboursable
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
    }
    console.error('fal-proxy error:', err)
    return jsonRes(502, { error: 'upstream_error' })
  }
})
