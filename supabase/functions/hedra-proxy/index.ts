// Supabase Edge Function — Hedra API proxy
// Contourne le CORS de api.hedra.com qui n'autorise que app.hedra.com comme origin.
// La clé Hedra est stockée dans les secrets Supabase (HEDRA_API_KEY).
// Déployé à : https://guvwgiejzkiodghywpwj.supabase.co/functions/v1/hedra-proxy
//
// Sécurité :
//   - JWT Supabase obligatoire (anon key seule refusée)
//   - Clé Hedra toujours côté serveur (BYOK retiré le 04/10 : aucun en-tête de clé client accepté)
//   - Audit 02/10 (PRX-3) : un client ne lit que /models, /v3/models, et le suivi de SES jobs (404 sinon)
//   - Audit 04/10 (GEN-3) : un client ne soumet que hedra-character-3 / hedra-avatar, corps reconstruit (403 / 400 sinon) ;
//     il n'écrit que /v3/files et /v3/models/<slug> (GET / POST seulement, sans paramètres d'URL) — 403 / 405 sinon
//   - Audit 04/10 (GEN-2) : facture par job au tarif de la résolution demandée (2 cr/s, 2,5 en 1080p) — migration p4_hedra
//
// Appel : POST ?path=/assets          (multipart → upload image)
//         POST ?path=/assets/ID/upload (multipart → upload audio)
//         POST ?path=/generations      (JSON → créer génération)
//         GET  ?path=/generations/ID/status (JSON → polling statut)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aa-op',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

import { safePath, billableGate, helperGate, requirePlan, applyReservationFull, settleReservation, opFromReq, resolveOp, releaseReservation, releaseOp, bindJob, releaseByJob, settleByJob, reconcileJob, hedraStatusGate, providerPause, retryAfterS, svc } from '../_shared/guard.ts'

const HEDRA_BASE = 'https://api.hedra.com/web-app/public'
// Audit 05/09 : `?path=` validé (allowlist, jamais d'`@`/`..`). La base porte un chemin → l'hôte ne peut
// pas être détourné, mais on borne quand même la surface. Générations = FACTURANT (plafond + débit récent).
const HEDRA_ALLOW = /^\/(models|assets(\/[A-Za-z0-9._-]+\/upload)?|generations(\/[A-Za-z0-9._-]+\/status)?|v3\/(files|models(\/[A-Za-z0-9._-]+)?|jobs(\/[A-Za-z0-9._-]+(\/status)?)?|assets(\/[A-Za-z0-9._-]+(\/upload)?)?))$/   // audit 06/09 : les job id Hedra v3 contiennent un '_' (job_1f592f28) → les polls /v3/jobs/<id>/status tombaient en 400. safePath (une seule barre de tête, jamais @ \\ .. %2e) reste la garde de sécurité.
const HEDRA_BILLABLE = /^\/(generations|v3\/models\/[A-Za-z0-9._-]+)$/   // soumission = /generations (ancienne API) ou /v3/models/<slug> (v3)
// 26/09 (« le dernier mot n'est pas articulé ») : l'app ajoute jusqu'à 0,5 s de silence APRÈS le dernier mot de l'audio
// envoyé (sinon Hedra ne ferme pas la dernière syllabe), et coupe la vidéo ensuite. Cette marge est pour nous : la
// réconciliation la retire de la durée rendue avant de la comparer au débit. Constante SERVEUR (jamais lue du client).
// Retirée à TOUS les jobs (relecture 26/09, accepté en connaissance de cause) : le proxy ne sait pas si l'audio portait du
// silence ajouté (upload et soumission sont deux requêtes sans état). Effet borné : la tolérance de réconciliation passe de
// 2 s à 2,5 s par job, soit au plus 1 crédit, sur une op tirée entière (plancher 2) — une génération par débit.
// ⚠ Ordre de déploiement : CE proxy avant l'app ; jamais de retour arrière de ce proxy seul (skill deploiement).
const LIPSYNC_PAD_MS = 500
// Audit 02/10 (PRX-3) — lectures d'un CLIENT. La clé Hedra plateforme est COMMUNE à tous les comptes : un GET /v3/jobs,
// /v3/files, /v3/assets[/<id>], /assets ou /generations listerait / lirait les médias de n'importe qui. Recensement des
// lectures réelles (app/index.html : _hedraV3Poll, reprise _hedraLastJob, _expSeedanceModel ; le moteur de rendu est
// service_role, exempté) : /models, /v3/models[/<slug>], /v3/jobs/<id>[/status], /generations/<id>/status (ancienne API).
// Tout autre GET d'un client → 404. Et un job LIÉ à l'op d'un autre utilisateur (credit_ops.provider_job) → 404.
const HEDRA_LECTURE_CLIENT = /^\/(models|v3\/models(\/[A-Za-z0-9._-]+)?|v3\/jobs\/[A-Za-z0-9._-]+(\/status)?|generations\/[A-Za-z0-9._-]+\/status)$/
// Seul un job lié à l'op d'un AUTRE utilisateur est refusé : un job lié à aucune op reste lisible par son lanceur (owner /
// developer sans réservation, tirage en fail-open). 'inconnue' = lecture impossible → « en cours » au statut, 503 au résultat.
async function proprieteJob(job: string, uid: string): Promise<'ok' | 'autrui' | 'inconnue'> {
  for (let essai = 0; essai < 2; essai++) {   // un hoquet isolé ne fait pas échouer un résultat déjà prêt : 2e lecture
    if (essai) await new Promise((r) => setTimeout(r, 250))
    try {
      const { data, error } = await svc().from('credit_ops').select('user_id').eq('provider_job', job).neq('user_id', uid).limit(1)
      if (error) { console.warn('[hedra] propriété du job illisible:', error.message); continue }
      return data && data.length ? 'autrui' : 'ok'
    } catch { /* nouvel essai */ }
  }
  return 'inconnue'
}

// Audit 04/10 (GEN-3) — soumission d'un CLIENT. La clé v3 plateforme ouvre tout l'agrégateur Hedra (Veo, Sora, Kling…) :
// un client ne soumet que les modèles de lipsync de l'app, avec un corps RECONSTRUIT (seuls les champs de l'app ; ni
// webhook, ni num_outputs, ni durée). Recensement (app/index.html) : callHedra / retryHedraAuto (Générateur) et
// _mtHedraScene (Montage IA) → _hedraSlug = hedra-character-3 | hedra-avatar, input { prompt, aspect_ratio, resolution,
// start_image, audio } ; Seedance = owner / developer (gate ci-dessous). Ancienne API POST /generations : plus aucun appel
// client depuis la v3 (le MCP parle à Hedra directement, le moteur de rendu est service_role) → owner / developer seuls.
// Owner / developer : corps relayé tel quel (tests).
// Écritures d'un client : les seuls POST de l'app sont /v3/files (upload multipart, _hedraV3UploadBlob) et /v3/models/<slug>
// (_hedraV3Submit), sans paramètre d'URL. Les autres routes de HEDRA_ALLOW (/v3/jobs, /v3/assets, /assets…) et les autres
// méthodes (DELETE, PUT…) partaient telles quelles avec la clé plateforme commune à tous les comptes → refusées.
const HEDRA_ECRITURE_CLIENT = /^\/(v3\/files|v3\/models\/[A-Za-z0-9._-]+)$/
const HEDRA_SLUGS_CLIENT = new Set(['hedra-character-3', 'hedra-avatar'])
const HEDRA_RATIOS = new Set(['9:16', '16:9', '1:1'])          // Générateur 9:16 | 1:1, Montage IA 9:16 | 16:9
const HEDRA_RESOLUTIONS = new Set(['720p', '1080p'])
const CORPS_MAX = 64 * 1024
type MediaHedra = { source: 'url'; url: string }
function mediaHedra(m: unknown): MediaHedra | null {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null
  const o = m as Record<string, unknown>
  // URL de /v3/files (signée, longue) : forme seule — l'hôte n'est pas présumé (non documenté), jamais un autre schéma.
  // { source: 'asset' } : jamais envoyé par l'app (recensement) → refusé (pas de réemploi d'un média Hedra par son id).
  if (o.source === 'url' && typeof o.url === 'string' && o.url.length <= 4096 && /^https?:\/\/[^\s"'<>\\]+$/i.test(o.url)) return { source: 'url', url: o.url }
  return null
}
function corpsLipsyncClient(raw: string): { ok: true; corps: string; hd: boolean } | { ok: false } {
  let j: unknown
  try { j = JSON.parse(raw) } catch { return { ok: false } }
  const input = (j && typeof j === 'object' && !Array.isArray(j)) ? (j as Record<string, unknown>).input : null
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false }
  const i = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (i.prompt != null) {
    if (typeof i.prompt !== 'string' || i.prompt.length > 4000) return { ok: false }
    if (i.prompt.trim()) out.prompt = i.prompt
  }
  if (typeof i.aspect_ratio !== 'string' || !HEDRA_RATIOS.has(i.aspect_ratio)) return { ok: false }
  if (typeof i.resolution !== 'string' || !HEDRA_RESOLUTIONS.has(i.resolution)) return { ok: false }
  const img = mediaHedra(i.start_image), aud = mediaHedra(i.audio)
  if (!img || !aud) return { ok: false }
  out.aspect_ratio = i.aspect_ratio; out.resolution = i.resolution; out.start_image = img; out.audio = aud
  return { ok: true, corps: JSON.stringify({ input: out }), hd: i.resolution === '1080p' }
}

// Audit 04/10 (GEN-2, contrat K1) — FACTURE du job à la soumission (migration 20261004040000_p4_hedra) : tarif de la
// résolution DEMANDÉE (2 cr/s, 2,5 en 1080p hors scène du Montage IA), op tirée, montant tiré. Best-effort : sans
// facture, la réconciliation retombe sur reconcile_hedra_job (comportement d'avant).
async function factureOuvre(userId: string, opId: string, job: string, hd: boolean, paid: number): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await svc().rpc('hedra_job_bill_open', { p_user: userId, p_op: opId, p_job: job, p_hd: hd, p_paid: paid > 0 ? Math.ceil(paid) : null })
    if (error) { console.warn('[hedra-facture] ouverture impossible:', error.message); return null }
    return (data as Record<string, unknown>) || null
  } catch (e) { console.warn('[hedra-facture] exception:', (e as Error)?.message); return null }
}
// Réconciliation au tarif de la facture. 'repli' = aucune facture (job soumis avant le déploiement) ou fonction absente
// (migration pas encore appliquée) → reconcile_hedra_job, comme avant. 'erreur' = hoquet : rien n'est réglé maintenant (la
// facture reste ouverte, l'op tirée n'est pas remboursable) — jamais de repli ici, qui pourrait charger deux fois.
async function reconcileTarif(userId: string, job: string, secs: number, enforce: boolean): Promise<{ k: 'ok'; r: Record<string, unknown> } | { k: 'repli' } | { k: 'erreur' }> {
  for (let essai = 0; essai < 2; essai++) {
    if (essai) await new Promise((r) => setTimeout(r, 250))
    try {
      const { data, error } = await svc().rpc('reconcile_hedra_job_tarif', { p_user: userId, p_job: job, p_secs: Math.max(0, Math.ceil(secs)), p_enforce: enforce })
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') return { k: 'repli' }
        console.warn('[hedra-reconcile] erreur:', error.message); continue
      }
      const r = (data as Record<string, unknown>) || {}
      if (r.reason === 'no_bill' || r.reason === 'bad_args') return { k: 'repli' }   // bad_args : id hors format de la facture → jamais facturé
      return { k: 'ok', r }
    } catch (e) { console.warn('[hedra-reconcile] exception:', (e as Error)?.message) }
  }
  return { k: 'erreur' }
}

serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // ── Vérification JWT ──
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized — token manquant' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── LE MOTEUR DE RENDU A LE DROIT D'ENTRER ────────────────────────────────
  // Le worker génère le lipsync scène par scène et doit donc parler à Hedra.
  // Il n'a pas de session utilisateur — il tourne sur Railway — mais il détient
  // la clé de service, qui ne quitte jamais le serveur et vaut plus qu'un JWT
  // d'utilisateur. Mesuré le 03/08 : sans cette porte, tous ses appels
  // repartaient en 401 et aucun clip n'était généré, en silence.
  // ⚠ Comparaison à longueur constante : un `===` sur un secret laisse fuiter
  // sa longueur et ses premiers octets par le temps de réponse.
  // Première tentative (02/08) : comparer le jeton reçu à SUPABASE_SERVICE_ROLE_KEY.
  // Mesuré le 03/08 : ça échoue. Les deux valeurs ont divergé — celle injectée
  // dans la fonction n'est pas celle que Railway détient. Comparer deux secrets
  // censés être identiques, c'est parier sur un alignement qu'on ne contrôle
  // pas ; une rotation de clé suffit à tout casser, en silence et en 401.
  //
  // La passerelle Supabase vérifie DÉJÀ la signature du jeton (verify_jwt est
  // actif sur cette fonction). Autrement dit : si l'exécution arrive jusqu'ici,
  // le jeton est authentique — signé avec le secret du projet. Il ne reste donc
  // qu'à lire ce qu'il déclare. Un jeton de service porte role='service_role',
  // et personne ne peut en forger un sans le secret.
  const roleDuJeton = (() => {
    try {
      const p = token.split('.')[1]
      if (!p) return ''
      const b = p.replace(/-/g, '+').replace(/_/g, '/')
      return String(JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4)))?.role || '')
    } catch { return '' }
  })()
  const estLeMoteur = roleDuJeton === 'service_role'

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: { user }, error: authErr } = estLeMoteur
    ? { data: { user: { id: 'render-worker' } }, error: null }
    : await supabase.auth.getUser()
  if (!estLeMoteur && (authErr || !user)) {
    return new Response(JSON.stringify({ error: 'Unauthorized — session invalide ou expirée' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Récupérer le plan de l'utilisateur ──
  // Le moteur de rendu n'a pas de profil : il travaille pour un job déjà payé,
  // et le contrôle de plan a eu lieu au lancement du montage. Il passe donc en
  // « developer ».
  const { data: profile } = estLeMoteur || !user
    ? { data: null }
    : await supabase.from('profiles').select('plan, is_owner').eq('id', user.id).single()

  const userPlan = estLeMoteur ? 'developer' : (profile?.plan || 'free').toLowerCase()

  // ── API v3 (développeur) vs ancienne API (web-app/public) ──
  // Un `?path` qui commence par /v3 bascule sur api.hedra.com + auth « Key … » + clé dev
  // HEDRA_V3_KEY. Tout le reste garde l'ancien passe-plat (web-app/public + X-API-Key +
  // HEDRA_API_KEY) → migration incrémentale, on ne casse rien.
  const url0      = new URL(req.url)
  const _pv = safePath(url0.searchParams.get('path') ?? '/', HEDRA_ALLOW)
  if (!_pv.ok) {
    return new Response(JSON.stringify({ error: 'path refusé : ' + _pv.reason }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
  const hedraPath0 = _pv.path
  const isV3      = hedraPath0.startsWith('/v3')

  // ── Facturation (H3) : une génération = plafond par utilisateur + preuve de débit récent ; le reste
  //    (uploads, polling) est seulement plafonné. Le moteur de rendu (service_role) passe.
  let drawnOp: string | undefined
  let drawnAmt = 0   // audit 14/09 : montant réellement tiré → restauration EXACTE au release (plus de 2/9999)
  let corpsSoumis: string | null = null   // audit 04/10 (GEN-3) : corps relayé à Hedra pour une soumission client (reconstruit)
  let demandeHd = false                   // audit 04/10 (GEN-2) : 1080p demandé dans ce corps → tarif de la facture
  let cheminAmont = hedraPath0            // audit 04/10 (GEN-3) : chemin envoyé à Hedra (sans paramètres d'URL pour un POST client)
  if (!estLeMoteur && user) {
    const bare = hedraPath0.split('?')[0]
    const libre = !!profile?.is_owner || userPlan === 'developer'   // owner / developer : tests d'Axel, rien de borné ici
    const gate = (req.method === 'POST' && HEDRA_BILLABLE.test(bare))
      ? await billableGate({ userId: user.id, proxy: 'hedra', requireDebit: true, debitMinutes: 120, rateMax: 30, label: bare })
      : await helperGate(user.id, 'hedra', 900)   // uploads + polling multi-scènes (Montage IA)
    if (!gate.ok) return new Response(JSON.stringify({ error: gate.error }), { status: gate.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
    // Audit 04/10 (GEN-3) : un client n'écrit que l'upload et la soumission (voir HEDRA_ECRITURE_CLIENT), sans paramètres d'URL.
    if (!libre && req.method !== 'GET' && req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Méthode non disponible.' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json', Allow: 'GET, POST, OPTIONS' } })
    }
    if (!libre && req.method === 'POST') {
      if (!HEDRA_ECRITURE_CLIENT.test(bare)) {
        const msg = HEDRA_BILLABLE.test(bare) ? 'Cette ancienne API Hedra n\'est plus disponible — mets la page à jour.' : 'Cette opération n\'est pas disponible.'
        return new Response(JSON.stringify({ error: msg }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } })
      }
      cheminAmont = bare
    }
    // Audit 02/10 (PRX-3) : lectures bornées au recensement + propriété du job, AVANT tout appel à Hedra (voir en-tête).
    const introuvable = () => new Response(JSON.stringify({ error: 'Génération introuvable.' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } })
    if (req.method === 'GET' && !HEDRA_LECTURE_CLIENT.test(bare)) return introuvable()
    const jidLu = HEDRA_BILLABLE.test(bare) ? '' : ((bare.match(/^\/(?:v3\/jobs|generations)\/([A-Za-z0-9._-]+)/) || [])[1] || '')
    if (jidLu) {
      const p = await proprieteJob('hedra:' + jidLu, user.id)
      if (p === 'autrui') return introuvable()
      if (p === 'inconnue') return /\/status$/.test(bare)
        ? new Response(JSON.stringify({ status: 'PENDING', throttled: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': '10' } })
        : new Response(JSON.stringify({ error: 'Suivi momentanément indisponible — réessaie dans un instant.' }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    // Audit métier 14/09 (Phase 2) : Seedance 2.0 = moteur DEV-only (tourne sur la clé dev HEDRA_V3_KEY). Le
    // client ne l'offre qu'aux dev, mais le serveur ne gatait rien → un non-dev pouvait forger le chemin. Fermé.
    if (req.method === 'POST' && HEDRA_BILLABLE.test(bare) && /\/v3\/models\/seedance/i.test(bare)) {
      const g = await requirePlan(user.id, [], 'Seedance'); if (!g.ok) return new Response(JSON.stringify({ error: g.error }), { status: g.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }
    // Audit 04/10 (GEN-3) : modèle + corps d'une soumission client, AVANT toute réservation (voir corpsLipsyncClient).
    if (req.method === 'POST' && HEDRA_BILLABLE.test(bare)) {
      const refus = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
      const slug = (bare.match(/^\/v3\/models\/([A-Za-z0-9._-]+)$/) || [])[1] || ''   // /generations (ancienne API) : refusé plus haut
      if (!libre && !HEDRA_SLUGS_CLIENT.has(slug)) return refus(403, 'Ce modèle vidéo n\'est pas disponible.')
      const raw = await req.text()
      if (raw.length > CORPS_MAX) return refus(413, 'Requête de génération trop volumineuse.')
      if (libre) {
        corpsSoumis = raw
        try { demandeHd = (JSON.parse(raw)?.input?.resolution) === '1080p' } catch { demandeHd = false }
      } else {
        const c = corpsLipsyncClient(raw)
        if (!c.ok) return refus(400, 'Paramètres de génération invalides — mets la page à jour puis relance.')
        corpsSoumis = c.corps
        demandeHd = c.hd
      }
    }
    // Réservation : la génération (POST /v3/models/<slug> ou /generations) tire son coût (borne basse 2 = avatarPerSec × 1 s).
    if (req.method === 'POST' && HEDRA_BILLABLE.test(bare)) {
      // Audit métier 06/09 : on tire la RÉSERVE ENTIÈRE (une op = une vidéo). Ferme « N vidéos pour un débit ».
      // 14/09 : plancher serveur = 2 (avatarPerSec × 1 s) → spend_credits(1) devant un lipsync est refusé (402) ;
      // le reconcile à la durée réelle (HEDRA_RECONCILE=1) charge le manque restant à la livraison.
      const rr = await applyReservationFull({ req, userId: user.id, proxy: 'hedra', label: bare, minCost: 2 })
      if (!rr.ok) return new Response(JSON.stringify({ error: rr.error }), { status: rr.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
      drawnOp = rr.opId
      drawnAmt = (rr as { drawn?: number }).drawn ?? 0
    }
  }

  // ── Clé Hedra : toujours celle de la plateforme (clé dev en v3) — BYOK retiré le 04/10 ──
  const platformKey = Deno.env.get('HEDRA_API_KEY') ?? ''
  const v3Key      = Deno.env.get('HEDRA_V3_KEY') ?? ''
  const hedraKey = isV3 ? v3Key : platformKey
  if (!hedraKey) {
    return new Response(JSON.stringify({ error: isV3 ? 'Clé Hedra v3 manquante (HEDRA_V3_KEY)' : 'Aucune clé Hedra configurée' }), {
      status: 402,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const hedraPath = cheminAmont   // déjà validé (allowlist) plus haut ; POST client : sans paramètres d'URL (audit 04/10, GEN-3)
    const ct        = req.headers.get('content-type') ?? ''
    const base      = isV3 ? 'https://api.hedra.com' : HEDRA_BASE
    const authHeaders: Record<string, string> = isV3 ? { Authorization: `Key ${hedraKey}` } : { 'X-API-Key': hedraKey }

    let hedraRes: Response

    if (corpsSoumis !== null) {
      // ── Soumission d'un client (audit 04/10, GEN-3) : le corps lu et contrôlé plus haut, toujours en JSON ──
      hedraRes = await fetch(`${base}${hedraPath}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: corpsSoumis,
      })
    } else if (ct.includes('multipart/form-data')) {
      // ── Transfert de fichier (upload audio / image) ──
      const incoming = await req.formData()
      const outgoing = new FormData()
      for (const [key, value] of incoming.entries()) {
        outgoing.append(key, value)
      }
      hedraRes = await fetch(`${base}${hedraPath}`, {
        method: 'POST',
        headers: authHeaders,
        body: outgoing,
      })
    } else if (req.method === 'GET') {
      // ── Polling ou récupération asset ──
      // Mail Hedra (28/09) : 60 requêtes / min par clé. Sondes de statut v3 = budget global partagé + une par job / 10 s +
      // pause après 429 (hedraStatusGate) ; au-delà, « en cours » SANS appeler Hedra (l'app et le moteur de rendu
      // continuent simplement d'attendre, aucun statut d'échec, aucune facturation touchée).
      const stJob = isV3 ? ((hedraPath.split('?')[0].match(/^\/v3\/jobs\/([A-Za-z0-9._-]+)\/status$/) || [])[1] || '') : ''
      const enCours = () => new Response(JSON.stringify({ status: 'PENDING', throttled: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': '10' } })
      if (stJob && !(await hedraStatusGate(stJob))) return enCours()
      hedraRes = await fetch(`${base}${hedraPath}`, {
        method: 'GET',
        headers: authHeaders,
      })
      if (isV3 && hedraRes.status === 429) {
        const pause = retryAfterS(hedraRes)
        await providerPause('hedra', pause)
        await hedraRes.body?.cancel().catch(() => {})
        if (stJob) return enCours()
        // résultat / fichier : UNE nouvelle tentative après la pause demandée (≤ 10 s) — sinon le moteur de rendu perdait le clip
        await new Promise((r) => setTimeout(r, Math.min(10, pause) * 1000))
        hedraRes = await fetch(`${base}${hedraPath}`, { method: 'GET', headers: authHeaders })
      }
    } else {
      // ── JSON (POST génération, etc.) ──
      const rawBody = await req.text()
      hedraRes = await fetch(`${base}${hedraPath}`, {
        method: req.method,
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: rawBody,
      })
    }

    const body = await hedraRes.text()
    // Amont en erreur → on rend le tirage : soumission refusée, ou job échoué au poll.
    if (!estLeMoteur && user) {
      const bare2 = hedraPath0.split('?')[0]
      // Le job Hedra = l'id renvoyé à la soumission (v3 « job_… », ou l'id de /generations) ; il figure dans le
      // path des polls (/v3/jobs/<id>/status, /generations/<id>/status). On LIE l'op au job à la soumission, puis
      // règle/libère PAR JOB → un poll d'un id étranger ne rend plus la réserve d'une autre op (refund-and-keep).
      const jobId = (bare2.match(/\/(?:v3\/jobs|generations)\/([A-Za-z0-9._-]+)/) || [])[1] || ''
      if (req.method === 'POST' && HEDRA_BILLABLE.test(bare2) && hedraRes.ok) {
        const jid = (body.match(/"job_id"\s*:\s*"([^"]+)"/) || body.match(/"id"\s*:\s*"([^"]+)"/) || [])[1] || ''
        if (jid) {
          await bindJob(user.id, drawnOp, 'hedra:' + jid, drawnAmt)   // lie l'op au job créé + mémorise le tiré
          // Audit 04/10 (GEN-2) : facture du job (tarif de la résolution demandée), lue à la réconciliation
          if (drawnOp) { const f = await factureOuvre(user.id, drawnOp, 'hedra:' + jid, demandeHd, drawnAmt); if (f) console.log(`[hedra-facture] job=${jid} ${JSON.stringify(f)}`) }
        }
      }
      else if (req.method === 'POST' && HEDRA_BILLABLE.test(bare2) && !hedraRes.ok) await releaseOp(user.id, drawnOp, drawnAmt)                                                                              // soumission refusée → rend EXACTEMENT le tiré
      else if (req.method === 'GET' && hedraRes.ok && /"status"\s*:\s*"(failed|error|errored|cancelled|canceled)"/i.test(body)) { if (jobId) await releaseByJob(user.id, 'hedra:' + jobId) }                // job échoué → rend l'op LIÉE
    }
    // Génération aboutie → RÉCONCILIATION À LA DURÉE RÉELLE (calibré 07/09 : la réponse complète /v3/jobs/<id>
    // porte outputs[].duration_ms ; tarif avatarPerSec = 2 cr/s). On ne règle QUE sur la réponse qui contient la
    // durée (la réponse complète, pas /status) pour ne pas régler avant d'avoir pu charger le manque. Le manque
    // (coût réel − débit) est débité par reconcile_hedra_job (tolérance 2s, plafonné au solde, une seule fois).
    // Audit 04/10 (GEN-2, contrat K1) : au tarif de la FACTURE du job (2,5 cr/s si 1080p demandé, hors scène du Montage
    // IA), contre ce que la soumission a tiré — plus l'op « avatar » sœur d'une ancienne app (2 ops). Job sans facture
    // (soumis avant le déploiement) → reconcile_hedra_job à 2 cr/s, comme avant.
    if (!estLeMoteur && user && req.method === 'GET' && hedraRes.ok && /"duration_ms"\s*:/.test(body)) {
      const jobId = (hedraPath0.split('?')[0].match(/\/(?:v3\/jobs|generations)\/([A-Za-z0-9._-]+)/) || [])[1] || ''
      if (jobId) {
        let sumMs = 0; const re = /"duration_ms"\s*:\s*([0-9]+)/g; let m: RegExpExecArray | null
        while ((m = re.exec(body))) sumMs += Number(m[1])
        const secs = Math.ceil(Math.max(0, sumMs - LIPSYNC_PAD_MS) / 1000)   // hors silence de fin ajouté
        const realCost = secs * 2   // repli sans facture : avatarPerSec = 2 cr/s (plat)
        const enforce = (Deno.env.get('HEDRA_RECONCILE') ?? '0') === '1'
        const t = await reconcileTarif(user.id, 'hedra:' + jobId, secs, enforce)
        if (t.k === 'ok') {
          console.log(`[hedra-reconcile${enforce ? '' : ' SHADOW'}] job=${jobId} durée=${(sumMs / 1000).toFixed(2)}s facture → ${JSON.stringify(t.r)}`)
        } else if (t.k === 'erreur') {
          console.warn(`[hedra-reconcile] job=${jobId} facture illisible — rien réglé (prochaine lecture du résultat)`)
        } else if (enforce) {
          const r = await reconcileJob(user.id, 'hedra:' + jobId, realCost)
          console.log(`[hedra-reconcile] job=${jobId} durée=${(sumMs / 1000).toFixed(2)}s coût_réel=${realCost} (sans facture) → ${JSON.stringify(r)}`)
        } else {
          console.log(`[hedra-reconcile SHADOW] job=${jobId} durée=${(sumMs / 1000).toFixed(2)}s coût_réel=${realCost} (enforce=0, réglé sans charge)`)
          await settleByJob(user.id, 'hedra:' + jobId)
        }
      }
    }

    return new Response(body, {
      status: hedraRes.status,
      headers: {
        ...CORS,
        'Content-Type': hedraRes.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    if (!estLeMoteur && user) await releaseOp(user.id, drawnOp, drawnAmt || 1).catch(() => {})
    console.error('hedra-proxy error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
