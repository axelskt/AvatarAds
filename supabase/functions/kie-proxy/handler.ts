// Supabase Edge Function — kie.ai proxy (23/09/2026 ; ouvert aux clients payants le 25/09/2026)
// Fournisseur « comme fal » moins cher sur Nano Banana Pro, Veo 3.1, Kling Motion Control et OmniHuman.
//
// ACCÈS (Axel 25/09/2026) :
//   • compte developer : tous les alias, aucune réservation, aucun repli (INCHANGÉ) ; service_role : tout (moteur / tests) ;
//   • clients payants : EXACTEMENT deux usages — nano-banana-pro (« Améliorer en 4K », Starter / Pro / Élite / BYOK) et
//     omni-flash (Omni Flash image→vidéo d'Express, Pro / Élite) — voir KIE_OPEN (../_shared/kie.ts). Tout autre alias
//     (Veo, Kling Motion Control, OmniHuman, faceswap Nano 1K) → 403. Secret KIE_CLIENTS=0 = tout refermer sans redéployer.
// RGPD : kie.ai n'a ni DPA ni garantie RGPD. L'ouverture aux clients de ces deux usages est une décision d'Axel du 25/09/2026 ;
//        la politique de confidentialité doit lister kie.ai comme sous-traitant. La clé reste dans les secrets (KIEAI_API_KEY).
//
// FACTURATION (clients) — identique aux proxys existants (guard.ts) :
//   • tirage AVANT l'appel kie : Nano = 5 sur l'op x-aa-op (comme google-ai-proxy) ; Omni = réserve ENTIÈRE avec plancher
//     serveur (comme fal-proxy) ; réservation absente / insuffisante → 402 (RESERVE_ENFORCE / RESERVE_STRICT) ;
//   • l'op tirée est LIÉE à la tâche (kie_jobs.op_id / drawn / bill_state) → RPC kie_job_bill, exactement une fois :
//       résultat rapatrié → settle ; échec kie (FAILED, résultat vide) → release (rendu à la RÉSERVE : l'app peut re-tirer
//       la MÊME op pour son repli Google / fal, ou la rembourser) ; soumission refusée par kie → release ; soumission SANS
//       réponse (délai, réseau) → refund serveur (taskId inconnu = rien de récupérable) et PAS de repli (double coût) ;
//   • onglet fermé : reconcile-kie règle (rangée en Bibliothèque) ou rembourse (échec), et balaie les réserves rendues
//     jamais re-tirées ni remboursées.
//
// Appels (grammaire calquée sur fal-proxy → le client change de PROXY, pas de logique) :
//   GET  ?path=/health                         → { ok, hasKey } (sans session)
//   GET  ?path=/balance                        → { credits, usd } (solde kie, gratuit — developer seulement)
//   POST ?path=/kie/<alias>                    → SOUMISSION → { request_id, status_url, response_url }
//   GET  ?path=/kie/requests/<rid>/status      → { status: IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED [, billing] }
//   GET  ?path=/kie/requests/<rid>             → résultat RAPATRIÉ dans render-media (URL signée 1 h)
//   POST ?path=/kie/requests/<rid>/ack         → l'app confirme avoir rangé le résultat (filet : plus rien à faire)
// alias : nano-banana-pro · veo3-lite · veo3-fast · kling-2.6-mc · kling-3.0-mc · omnihuman-1.5 · omni-flash
// `billing` (erreurs et FAILED) : none | released | refunded | drawn | closed | unfunded — l'app ne replie QUE sur
// released / none (réservation re-tirable proprement).
//
// Sécurité : le corps kie est RECONSTRUIT côté serveur (jamais de spread du corps client) ; modèle, traduction,
// filigrane, fond Kling… imposés ici (clients : Nano en 4K, UNE image). Entrées = URL signées de NOTRE storage
// (render-media/<uid>/…) seulement. Propriété des tâches : le `param` renvoyé par kie contient nos URL d'entrée → on y
// exige /render-media/<uid>/ ; clients : la ligne kie_jobs (écrite à la soumission) doit AUSSI être la leur.
// Les URL de résultat kie expirent (~24 h) → rapatriement dans render-media/<uid>/kie/<taskId>.<ext>.

import { CORS, jsonRes, authUser, userPlan, billableGate, helperGate, applyReservation, applyReservationFull, refundOpTerminal, releaseOp, safePath, svc, SUPABASE_URL } from '../_shared/guard.ts'
import { KIE, kieKey as key, kieHeaders, kieRecord as record, kieDownload as download, kieKindOf as kindOf, kieOwnedBy, kieBill, KIE_LABELS, KIE_OPEN, kieClientsOn } from '../_shared/kie.ts'

const BUCKET = 'render-media'
const STORE_SIGN = `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/`
const ALIASES = ['nano-banana-pro', 'veo3-lite', 'veo3-fast', 'kling-2.6-mc', 'kling-3.0-mc', 'omnihuman-1.5', 'omni-flash'] as const
type Alias = typeof ALIASES[number]
const ALLOW = /^\/(health|balance|kie\/(nano-banana-pro|veo3-lite|veo3-fast|kling-2\.6-mc|kling-3\.0-mc|omnihuman-1\.5|omni-flash)|kie\/requests\/(mk|veo)-[A-Za-z0-9_-]{6,120}(\/status|\/ack)?)$/
const NB_AR = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto']
// Coûts serveur (bornes basses, jamais > débit légitime → ne 402 jamais un flux normal) :
//   Nano Banana Pro = 5 (= google-ai-proxy costFor, = CREDIT_COSTS.imgUpscale4K / imgRealistic) ;
//   Omni Flash = plancher 3, IDENTIQUE à fal-proxy (falCost gemini-omni-flash). Pas de plancher « par seconde » : dans
//   Express, l'image de départ (gpt-image, 1 à 5 cr, + composition multi-réfs) est tirée sur la MÊME op juste avant
//   Omni → un plancher 3 cr/s × durée refusait (402) des vidéos légitimes de 3 à 5 s.
const NANO_COST = 5
const OMNI_MIN = 3

const str = (v: unknown, max: number) => String(v ?? '').slice(0, max)
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed as readonly string[]).includes(String(v)) ? String(v) as T : dflt

// Entrée acceptée = URL signée de NOTRE bucket, dans le dossier de l'appelant (service_role : tout le bucket).
function okInput(u: unknown, uid: string | null): string | null {
  const s = String(u ?? '')
  if (!s.startsWith(STORE_SIGN)) return null
  const rest = s.slice(STORE_SIGN.length)
  const p = rest.split('?')[0]
  if (!p || /\.\.|%2e|%2f|%5c|@|\\/i.test(p)) return null
  if (uid && !p.startsWith(uid + '/')) return null
  return s
}

// ── Corps kie reconstruit par alias (les prompts backend de l'app passent TELS QUELS dans `prompt`) ──
// `full` = developer / service_role (paramètres libres dans les listes) ; sinon client : paramètres de l'usage ouvert imposés.
type Built = { url: string; body: Record<string, unknown> } | { error: string }
function build(alias: Alias, b: Record<string, any>, uid: string | null, full: boolean): Built {
  const cb = `${SUPABASE_URL}/functions/v1/kie-proxy?path=/cb`   // exigé par Kling 3.0 ; le suivi reste la seule source de vérité
  if (alias === 'nano-banana-pro') {
    const raw = Array.isArray(b.image_urls) ? b.image_urls : (Array.isArray(b.image_input) ? b.image_input : [])
    // Client (25/09) : « Améliorer en 4K » = UNE image, sortie 4K imposée (le ratio reste celui de l'image, envoyé par l'app).
    if (!full && raw.length !== 1) return { error: 'image_urls : une seule image (amélioration 4K)' }
    const imgs = raw.slice(0, 8).map((x: unknown) => okInput(x, uid))
    if (imgs.some((x: string | null) => !x)) return { error: 'image_urls : URL de notre storage uniquement' }
    const prompt = str(b.prompt, 10000)
    if (!prompt) return { error: 'prompt requis' }
    return { url: `${KIE}/api/v1/jobs/createTask`, body: { model: 'nano-banana-pro', input: {
      prompt, image_input: imgs, aspect_ratio: pick(b.aspect_ratio, NB_AR, 'auto'),
      resolution: full ? pick(b.resolution, ['1K', '2K', '4K'] as const, '2K') : '4K', output_format: 'jpg' } } }
  }
  if (alias === 'veo3-lite' || alias === 'veo3-fast') {
    const img = b.image_url ? okInput(b.image_url, uid) : null
    if (b.image_url && !img) return { error: 'image_url : URL de notre storage uniquement' }
    const prompt = str(b.prompt, 10000)
    if (!prompt) return { error: 'prompt requis' }
    const d = Number(b.duration) || 8
    const duration = d <= 4 ? 4 : (d <= 6 ? 6 : 8)
    // Ancienne API (seule à exposer Lite/Fast). enableTranslation:false IMPOSÉ : sinon la réplique française
    // entre guillemets serait traduite et l'avatar parlerait anglais. Ni filigrane, ni 4k, ni Quality (veo3).
    return { url: `${KIE}/api/v1/veo/generate`, body: {
      prompt, model: alias === 'veo3-fast' ? 'veo3_fast' : 'veo3_lite',
      ...(img ? { imageUrls: [img], generationType: 'FIRST_AND_LAST_FRAMES_2_VIDEO' } : { generationType: 'TEXT_2_VIDEO' }),
      aspect_ratio: pick(b.aspect_ratio, ['9:16', '16:9'] as const, '9:16'),
      resolution: pick(b.resolution, ['720p', '1080p'] as const, '720p'),
      duration, enableTranslation: false } }
  }
  if (alias === 'kling-2.6-mc' || alias === 'kling-3.0-mc') {
    const img = okInput(b.image_url, uid), vid = okInput(b.video_url, uid)
    if (!img || !vid) return { error: 'image_url / video_url : URL de notre storage uniquement' }
    const input: Record<string, unknown> = {
      prompt: str(b.prompt, 2500), input_urls: [img], video_urls: [vid],
      character_orientation: pick(b.character_orientation, ['video', 'image'] as const, 'video'),
    }
    if (alias === 'kling-2.6-mc') {
      input.mode = pick(b.mode, ['720p', '1080p'] as const, '720p')
      return { url: `${KIE}/api/v1/jobs/createTask`, body: { model: 'kling-2.6/motion-control', input } }
    }
    input.mode = pick(b.mode, ['1080p', '720p', 'pro', 'std'] as const, '1080p')   // doc kie ambiguë (720p/1080p vs std/pro)
    // Fond : celui de l'IMAGE (= comportement fal actuel). input_video seulement sur demande explicite.
    input.background_source = b.background_source === 'input_video' ? 'input_video' : 'input_image'
    return { url: `${KIE}/api/v1/jobs/createTask`, body: { model: 'kling-3.0/motion-control', callBackUrl: cb, input } }
  }
  if (alias === 'omni-flash') {
    // Gemini Omni 1.1 Flash image→vidéo (= fal google/gemini-omni-flash/v1.1/image-to-video). Chez kie le prix est un
    // forfait par clip IDENTIQUE en 720p et 1080p → 1080p IMPOSÉ (Axel 23/09). Durées kie : 4/6/8/10 s ; 9:16 ou 16:9.
    const img = okInput(b.image_url, uid)
    if (!img) return { error: 'image_url : URL de notre storage uniquement' }
    const prompt = str(b.prompt, 20000)
    if (!prompt) return { error: 'prompt requis' }
    const d = Number(b.duration) || 6
    const duration = d <= 4 ? '4' : d <= 6 ? '6' : d <= 8 ? '8' : '10'
    return { url: `${KIE}/api/v1/jobs/createTask`, body: { model: 'google/gemini-omni-flash-1-1', input: {
      prompt, first_frame_url: img, duration, aspect_ratio: pick(b.aspect_ratio, ['9:16', '16:9'] as const, '9:16'), resolution: '1080p' } } }
  }
  // omnihuman-1.5
  const img = okInput(b.image_url, uid), aud = okInput(b.audio_url, uid)
  if (!img || !aud) return { error: 'image_url / audio_url : URL de notre storage uniquement' }
  const res = (b.resolution === '720p' || b.output_resolution === '720') ? '720' : '1080'
  const input: Record<string, unknown> = { image_url: img, audio_url: aud, output_resolution: res, pe_fast_mode: false, seed: -1 }
  if (b.prompt) input.prompt = str(b.prompt, 1000)
  return { url: `${KIE}/api/v1/jobs/createTask`, body: { model: 'omnihuman-1-5', input } }
}

// Erreur métier kie (le code est DANS le corps, le HTTP peut valoir 200) → réponse client lisible. `billing` = sort de la
// réservation tirée pour cette soumission (clients) : l'app ne replie que sur 'released' / 'none'.
function kieErr(code: number, msg: string, billing = 'none') {
  const m = String(msg || '').slice(0, 300)
  if (code === 402) return jsonRes(402, { error: 'Crédits kie.ai épuisés', kieCode: code, billing })
  if (code === 429 || code === 433) return jsonRes(429, { error: 'kie.ai : trop de requêtes, réessaie dans un instant', kieCode: code, billing })
  if (code === 401) return jsonRes(500, { error: 'clé kie.ai invalide', kieCode: code, billing })
  if (code === 451) return jsonRes(422, { error: 'kie.ai : média inaccessible', detail: [{ type: 'media', msg: m }], kieCode: code, billing })
  if (code === 455 || code === 505) return jsonRes(503, { error: 'kie.ai indisponible (maintenance)', kieCode: code, billing })
  if (code === 400 || code === 422) return jsonRes(422, { error: 'kie.ai a refusé la demande : ' + m, detail: [{ type: 'validation', msg: m }], kieCode: code, billing })
  return jsonRes(502, { error: `kie.ai ${code || 'erreur'} : ${m}`, kieCode: code, billing })
}

// Suivi, rapatriement et détection du format : ../_shared/kie.ts (partagés avec reconcile-kie, le filet).

type JobRow = { state: string; library_id: string | null; op_id: string | null; bill_state: string | null }

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST' && req.method !== 'GET') return jsonRes(405, { error: 'method_not_allowed' })
  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path') ?? '/'
  if (rawPath === '/health') return jsonRes(200, { ok: true, hasKey: !!key() })
  if (!key()) return jsonRes(500, { error: 'Aucune clé kie.ai dans les secrets Supabase (attendu : KIEAI_API_KEY)' })

  const v = safePath(rawPath, ALLOW)
  if (!v.ok) return jsonRes(400, { error: 'path refusé : ' + v.reason })
  const path = v.path
  const sub = path.match(/^\/kie\/([a-z0-9.-]+)$/)

  // ── Accès (25/09) : developer = tout, sans réservation (inchangé) ; clients payants = les 2 usages ouverts (KIE_OPEN)
  //    + le suivi de LEURS tâches ; service_role = tout. Doute sur le plan (hoquet DB) → 403 FERMÉ AVANT tout tirage :
  //    l'app replie alors sur Google / fal (billing 'none'), dont les gates sont, eux, ouverts sur hoquet.
  const auth = await authUser(req)
  let uid: string | null = null, isDev = false, noBill = false
  if (!auth.isService) {
    if (!auth.userId) return jsonRes(401, { error: 'Session requise' })
    uid = auth.userId
    const { plan, isOwner, err } = await userPlan(uid)
    isDev = !err && plan === 'developer'
    noBill = !err && (isDev || isOwner)   // owner / developer : spendCreditsFor ne débite rien → aucune réservation à tirer
    if (!isDev) {
      if (path === '/balance') return jsonRes(403, { error: 'kie.ai est réservé au compte développeur' })
      if (sub && req.method === 'POST') {
        const allowed = KIE_OPEN[sub[1]]
        if (!allowed) return jsonRes(403, { error: 'kie.ai est réservé au compte développeur pour ce modèle', billing: 'none' })
        if (!kieClientsOn()) return jsonRes(403, { error: 'kie.ai momentanément fermé aux clients', billing: 'none' })
        if (err || !(isOwner || allowed.includes(plan))) return jsonRes(403, { error: `kie.ai (${sub[1]}) nécessite un plan ${allowed.join(' / ')}`, billing: 'none' })
      }
    }
  }
  const who = uid ?? 'svc'

  try {
    if (path === '/balance') {
      const r = await fetch(`${KIE}/api/v1/chat/credit`, { headers: kieHeaders(), signal: AbortSignal.timeout(15000) })
      const j = await r.json().catch(() => ({}))
      if (j?.code !== 200) return kieErr(Number(j?.code) || r.status, j?.msg)
      const credits = Number(j.data) || 0
      return jsonRes(200, { credits, usd: Math.round(credits * 0.5) / 100 })
    }

    // ── SOUMISSION ──
    if (sub && req.method === 'POST') {
      const alias = sub[1] as Alias
      if (!ALIASES.includes(alias)) return jsonRes(400, { error: 'modèle inconnu' })
      // Plafond 40 / 10 min (même clé qu'avant) + preuve de débit récent pour les clients (H3) ; developer : plafond seul.
      if (uid) { const g = await billableGate({ userId: uid, proxy: 'kie', requireDebit: true, debitMinutes: 120, rateMax: 40, label: alias }); if (!g.ok) return jsonRes(g.status, { error: g.error, billing: 'none' }) }
      const b = await req.json().catch(() => ({}))
      const built = build(alias, b && typeof b === 'object' ? b : {}, uid, isDev || !uid)
      if ('error' in built) return jsonRes(400, { error: built.error, billing: 'none' })

      // ── Réservation (clients, 25/09) : tirée AVANT l'appel kie, EXACTEMENT comme les proxys historiques ──
      //    Nano 4K = 5 sur l'op x-aa-op (google-ai-proxy) ; Omni = réserve ENTIÈRE, plancher 3 (fal-proxy) — 1 op = 1 vidéo.
      let opId: string | undefined, drawn = 0
      if (uid && !noBill) {
        const rr = alias === 'omni-flash'
          ? await applyReservationFull({ req, userId: uid, proxy: 'kie', label: alias, minCost: OMNI_MIN })
          : await applyReservation({ req, userId: uid, proxy: 'kie', cost: NANO_COST, label: alias })
        if (!rr.ok) return jsonRes(rr.status, { error: rr.error, billing: 'unfunded' })
        opId = rr.opId
        drawn = alias === 'omni-flash' ? ((rr as { drawn?: number }).drawn ?? 0) : NANO_COST
      }
      // Soumission ratée : tirage RENDU à la réservation (repli possible sur la même op) ou REMBOURSÉ (sans réponse de kie).
      // Une réserve rendue est notée (ligne 'sub-…', état failed) : si l'onglet meurt avant repli / remboursement, le
      // balayage de reconcile-kie la rembourse (> 30 min, seulement si personne ne l'a re-tirée).
      const failSubmit = async (why: string, refund: boolean): Promise<string> => {
        if (!uid || !opId) return 'none'
        if (refund && await refundOpTerminal(uid, opId, drawn || 1)) return 'refunded'
        if (drawn <= 0) return 'none'
        await releaseOp(uid, opId, drawn)
        const { error: fErr } = await svc().from('kie_jobs').insert({ task_id: 'sub-' + crypto.randomUUID(), user_id: uid, alias, label: KIE_LABELS[alias] || 'kie.ai',
          state: 'failed', last_error: why.slice(0, 200), op_id: opId, drawn, bill_state: 'released', billed_at: new Date().toISOString() })
        if (fErr) console.warn('[kie] kie_jobs (soumission ratée)', fErr.message)
        return 'released'
      }

      let r: Response, j: any
      try {
        r = await fetch(built.url, { method: 'POST', headers: kieHeaders(), body: JSON.stringify(built.body), signal: AbortSignal.timeout(30000) })
        j = await r.json().catch(() => ({}))
      } catch (e) {
        // SANS réponse (délai 30 s, réseau) : kie a peut-être créé la tâche, mais sans taskId personne ne pourra la récupérer
        // → remboursement serveur (comme fal-proxy) et `uncertain` : l'app NE replie PAS (risque de payer deux fois).
        console.warn('[kie] submit sans réponse', alias, (e as Error)?.message)
        const billing = await failSubmit('soumission sans réponse', true)
        return jsonRes(502, { error: 'kie.ai n’a pas répondu — réessaie dans un instant', uncertain: true, billing })
      }
      const taskId = String(j?.data?.taskId || '')
      if (j?.code !== 200 || !/^[A-Za-z0-9_-]{6,120}$/.test(taskId)) {
        console.warn('[kie] submit refusé', alias, j?.code, String(j?.msg || '').slice(0, 200))
        const billing = await failSubmit('kie ' + (j?.code || r.status) + ' : ' + String(j?.msg || ''), false)
        return kieErr(Number(j?.code) || r.status, j?.msg, billing)
      }
      const fam = alias.startsWith('veo3') ? 'veo' : 'mk'
      const rid = `${fam}-${taskId}`
      console.log('[kie] submit ok', alias, taskId, who, opId ? `op=${opId} tiré=${drawn}` : '')
      if (uid) {
        const row = { task_id: rid, user_id: uid, alias, label: KIE_LABELS[alias] || 'kie.ai',
          ...(opId ? { op_id: opId, drawn, bill_state: 'drawn', billed_at: new Date().toISOString() } : {}) }
        let jErr = (await svc().from('kie_jobs').insert(row)).error
        if (jErr && jErr.code !== '23505') jErr = (await svc().from('kie_jobs').insert(row)).error   // 1 réessai (23505 = déjà là)
        if (jErr && jErr.code !== '23505') {
          console.warn('[kie] kie_jobs insert', jErr.message)
          // Client sans ligne = ni suivi (propriété), ni règlement, ni filet → on rend ses crédits tout de suite ; la tâche
          // kie tourne pour rien (coût kie seul). `uncertain` : pas de repli (la tâche existe chez kie). Developer : inchangé.
          if (!isDev) {
            const billing = !opId ? 'none' : (await refundOpTerminal(uid, opId, drawn || 1)) ? 'refunded' : (drawn > 0 ? (await releaseOp(uid, opId, drawn), 'released') : 'none')
            return jsonRes(503, { error: 'suivi de la génération impossible — crédits rendus, réessaie', uncertain: true, billing })
          }
        }
      }
      return jsonRes(200, { request_id: rid, status_url: `/kie/requests/${rid}/status`, response_url: `/kie/requests/${rid}`, status: 'IN_QUEUE', provider: 'kie' })
    }

    // ── ACCUSÉ : l'app a rangé le résultat en Bibliothèque → le filet n'a plus rien à faire ──
    const ack = path.match(/^\/kie\/requests\/((mk|veo)-[A-Za-z0-9_-]{6,120})\/ack$/)
    if (ack && req.method === 'POST') {
      if (!uid) return jsonRes(200, { ok: true })
      const { error: aErr } = await svc().from('kie_jobs').update({ state: 'saved', updated_at: new Date().toISOString() })
        .eq('task_id', ack[1]).eq('user_id', uid).in('state', ['pending', 'fetched'])
      if (aErr) console.warn('[kie] ack', aErr.message)
      return jsonRes(200, { ok: true })
    }

    // ── SUIVI / RÉSULTAT ──
    const q = path.match(/^\/kie\/requests\/(mk|veo)-([A-Za-z0-9_-]{6,120})(\/status)?$/)
    if (q && req.method === 'GET') {
      if (uid) { const g = await helperGate(uid, 'kie', 1500, 600); if (!g.ok) return jsonRes(g.status, { error: g.error }) }
      const fam = q[1] as 'mk' | 'veo', taskId = q[2], isStatus = !!q[3], rid = `${fam}-${taskId}`
      // Propriété (clients, 25/09) : la tâche doit être la SIENNE (ligne kie_jobs écrite à SA soumission), EN PLUS de la preuve
      // par le param kie ci-dessous. Lecture impossible → 503 (l'app réessaie), jamais un accès « au doute ». Developer : inchangé.
      let job: JobRow | null = null
      if (uid) {
        const { data: jr, error: jrErr } = await svc().from('kie_jobs').select('state, library_id, op_id, bill_state').eq('task_id', rid).eq('user_id', uid).limit(1)
        if (jrErr) { if (!isDev) return jsonRes(503, { error: 'suivi momentanément indisponible', detail: [{ type: 'transient', msg: jrErr.message }] }) }
        else job = (jr && jr[0]) as JobRow || null
        if (!job && !isDev) return jsonRes(404, { error: 'tâche kie introuvable' })
      }
      const rec = await record(fam, taskId)
      // Clé / solde / droits kie refusés : erreur IMMÉDIATE et vraie (pas 15 min d'attente), la tâche reste au filet.
      if (rec.account) return jsonRes(424, { error: 'clé ou compte kie.ai refusé (' + rec.err.slice(0, 120) + ') — la génération sera rangée dans ta Bibliothèque une fois réglé', detail: [{ type: 'kie_account', msg: rec.err }] })
      if (rec.transient) return jsonRes(503, { error: 'kie.ai momentanément indisponible', detail: [{ type: 'transient', msg: rec.err }] })
      if (!rec.found) return jsonRes(404, { error: 'tâche kie introuvable', detail: [{ type: 'not_found', msg: rec.err }] })
      // Propriété : TOUTES les URL d'entrée enregistrées par kie viennent du dossier de l'appelant. Un échec sans param
      // (ex. refus 400) passe (rien à protéger) ; un résultat réussi exige toujours la preuve.
      if (uid && (rec.state === 'ok' || rec.param) && !kieOwnedBy(rec.param, uid, STORE_SIGN)) return jsonRes(404, { error: 'tâche kie introuvable' })
      const failed = rec.state === 'fail' || (rec.state === 'ok' && !rec.urls.length)   // « succès » sans URL = échec
      // Échec définitif chez kie : on le note TOUT DE SUITE (avant, seule la route résultat le faisait → une tâche
      // refusée pendant le suivi restait « pending » jusqu'au passage du filet, 45 min plus tard).
      if (failed && uid) { const { error: jErr } = await svc().from('kie_jobs').update({ state: 'failed', last_error: (rec.err || 'échec kie').slice(0, 200), updated_at: new Date().toISOString() }).eq('task_id', rid).eq('user_id', uid).in('state', ['pending', 'fetched']); if (jErr) console.warn('[kie] kie_jobs failed', jErr.message) }
      // …et le tirage est RENDU à la réservation (une seule fois, même relu) : l'app re-tire la MÊME op pour son repli
      // (Google / fal) ou la rembourse. Onglet mort ici → balayage de reconcile-kie. `billing` dit à l'app ce qui reste possible.
      let billing = 'none'
      if (failed && uid && job?.op_id) billing = (await kieBill(svc(), uid, rid, 'release')).bill ?? job.bill_state ?? 'drawn'
      if (isStatus) {
        if (failed) return jsonRes(200, { status: 'FAILED', error: rec.err || 'résultat vide', detail: [{ type: rec.errType || 'failed', msg: rec.err || 'résultat vide' }], meta: rec.meta, billing })
        return jsonRes(200, { status: rec.state === 'ok' ? 'COMPLETED' : rec.state === 'run' ? 'IN_PROGRESS' : 'IN_QUEUE', meta: rec.meta })
      }
      if (failed) return jsonRes(422, { status: 'FAILED', error: rec.err || 'résultat vide', detail: [{ type: rec.errType || 'failed', msg: rec.err || 'résultat vide' }], meta: rec.meta, billing })
      if (rec.state !== 'ok') return jsonRes(202, { status: rec.state === 'run' ? 'IN_PROGRESS' : 'IN_QUEUE' })
      // Réservation déjà rendue / remboursée / close (échec antérieur, filet) → on ne livre plus : sinon génération gratuite.
      // closed (Axel 25/09) = re-tirée / livrée par le repli ou déjà remboursée — jamais « trop vieille » : une op de plus de
      // 2 h est désormais REMBOURSÉE de ce qui n'a pas été livré (kie_job_bill → refunded), plus close sans crédit rendu.
      if (job?.op_id && ['released', 'refunded', 'closed'].includes(String(job.bill_state)))
        return jsonRes(422, { status: 'FAILED', error: job.bill_state === 'closed' ? 'génération close — déjà livrée par le repli ou crédits déjà rendus' : 'génération close — crédits déjà rendus',
          detail: [{ type: 'closed', msg: String(job.bill_state) }], billing: job.bill_state })

      // Le filet l'a déjà prise (onglet revenu après une veille) → on ne la redonne pas : sinon doublon en Bibliothèque.
      let claimed = false
      if (uid) {
        const { data: rows } = await svc().from('kie_jobs').select('state, library_id').eq('task_id', rid).eq('user_id', uid).limit(1)
        const row = rows && rows[0]
        if (row && (row.state === 'saving' || (row.state === 'saved' && row.library_id)))
          return jsonRes(409, { status: 'SAVED_BY_NET', error: 'déjà rangée dans ta Bibliothèque (récupérée automatiquement)', library_id: row.library_id || null })
        // Réservation pending → fetched AVANT la copie (le filet ne peut plus la prendre en même temps).
        const { data: cl } = await svc().from('kie_jobs').update({ state: 'fetched', updated_at: new Date().toISOString() }).eq('task_id', rid).eq('user_id', uid).eq('state', 'pending').select('task_id')
        claimed = !!(cl && cl.length)
      }
      const unclaim = async () => { if (claimed) await svc().from('kie_jobs').update({ state: 'pending', updated_at: new Date().toISOString() }).eq('task_id', rid).eq('user_id', uid as string).eq('state', 'fetched') }

      // Rapatriement idempotent : déjà copié ? → URL signée directe.
      const st = svc().storage.from(BUCKET)
      const base = `${who}/kie/${taskId}`
      const { data: listed } = await st.list(`${who}/kie`, { search: taskId, limit: 5 })
      const hit = (listed || []).find((f: { name: string }) => f.name.startsWith(taskId + '.'))
      let dst = hit ? `${who}/kie/${hit.name}` : '', kind: 'image' | 'video' = hit && /\.(jpg|png|webp)$/.test(hit.name) ? 'image' : 'video', host = ''
      if (!dst) {
        const dl = await download(rec.urls[0])
        if (!dl) { await unclaim(); return jsonRes(502, { error: 'rapatriement du résultat kie impossible' }) }
        const k = kindOf(dl.ct, dl.buf)
        if (!k) { await unclaim(); return jsonRes(502, { error: 'format de résultat kie inattendu' }) }
        dst = `${base}.${k.ext}`; kind = k.kind; host = dl.host
        const { error: upErr } = await st.upload(dst, new Uint8Array(dl.buf), { contentType: k.mime, upsert: true })
        if (upErr) { await unclaim(); return jsonRes(500, { error: 'copie du résultat impossible : ' + upErr.message }) }
      }
      const { data: signed, error: sErr } = await st.createSignedUrl(dst, 3600)
      if (sErr || !signed?.signedUrl) { await unclaim(); return jsonRes(500, { error: 'URL signée impossible' }) }
      // Copie faite : on la note (le filet saura ranger CE fichier si l'app ne confirme jamais le rangement).
      if (uid) { const { error: jErr } = await svc().from('kie_jobs').update({ storage_path: dst, updated_at: new Date().toISOString() }).eq('task_id', rid).eq('user_id', uid).eq('state', 'fetched'); if (jErr) console.warn('[kie] kie_jobs fetched', jErr.message) }
      // Résultat rapatrié = LIVRÉ → op réglée, non remboursable (une seule fois : relu, c'est un no-op). Raté → le filet règle.
      if (uid && job?.op_id) await kieBill(svc(), uid, rid, 'settle')
      const out = signed.signedUrl
      console.log('[kie] résultat', fam, taskId, kind, dst, host)
      const media = kind === 'image' ? { images: [{ url: out }], image: { url: out } } : { video: { url: out }, video_url: out }
      return jsonRes(200, { status: 'COMPLETED', url: out, kind, storage_path: dst, rid, ...media, kie: { taskId, source_host: host || null, ...rec.meta } })
    }
    return jsonRes(400, { error: 'requête non prise en charge' })
  } catch (e) {
    console.warn('[kie] exception', (e as Error)?.message)
    return jsonRes(502, { error: 'upstream_error', detail: String((e as Error)?.message || e).slice(0, 200) })
  }
}
