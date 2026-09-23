// Supabase Edge Function — kie.ai proxy (23/09/2026)
// Fournisseur « comme fal » moins cher sur Nano Banana Pro, Veo 3.1, Kling Motion Control et OmniHuman.
// RÉSERVÉ au plan 'developer' (test avant ouverture éventuelle) + service_role (moteur / tests serveur).
// kie.ai n'a ni DPA ni garantie RGPD : JAMAIS de contenu client ici tant que ce n'est pas tranché
// (mémoire couts-fournisseurs-ia). La clé reste dans les secrets Supabase (KIEAI_API_KEY).
//
// Appels (grammaire calquée sur fal-proxy → le client change de PROXY, pas de logique) :
//   GET  ?path=/health                         → { ok, hasKey } (sans session)
//   GET  ?path=/balance                        → { credits, usd } (solde kie, gratuit)
//   POST ?path=/kie/<alias>                    → SOUMISSION → { request_id, status_url, response_url }
//   GET  ?path=/kie/requests/<rid>/status      → { status: IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED }
//   GET  ?path=/kie/requests/<rid>             → résultat RAPATRIÉ dans render-media (URL signée 1 h)
//   POST ?path=/kie/requests/<rid>/ack         → l'app confirme avoir rangé le résultat (filet : plus rien à faire)
// alias : nano-banana-pro · veo3-lite · veo3-fast · kling-2.6-mc · kling-3.0-mc · omnihuman-1.5 · omni-flash
//
// Sécurité : le corps kie est RECONSTRUIT côté serveur (jamais de spread du corps client) ; modèle, traduction,
// filigrane, fond Kling… imposés ici. Entrées = URL signées de NOTRE storage (render-media/<uid>/…) seulement.
// Propriété des tâches : le `param` renvoyé par kie contient nos URL d'entrée → on y exige /render-media/<uid>/.
// Les URL de résultat kie expirent (~24 h) → rapatriement dans render-media/<uid>/kie/<taskId>.<ext>.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, userPlan, helperGate, rateHit, safePath, svc, SUPABASE_URL } from '../_shared/guard.ts'
import { KIE, kieKey as key, kieHeaders, kieRecord as record, kieDownload as download, kieKindOf as kindOf, kieOwnedBy, KIE_LABELS } from '../_shared/kie.ts'

const BUCKET = 'render-media'
const STORE_SIGN = `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/`
const ALIASES = ['nano-banana-pro', 'veo3-lite', 'veo3-fast', 'kling-2.6-mc', 'kling-3.0-mc', 'omnihuman-1.5', 'omni-flash'] as const
type Alias = typeof ALIASES[number]
const ALLOW = /^\/(health|balance|kie\/(nano-banana-pro|veo3-lite|veo3-fast|kling-2\.6-mc|kling-3\.0-mc|omnihuman-1\.5|omni-flash)|kie\/requests\/(mk|veo)-[A-Za-z0-9_-]{6,120}(\/status|\/ack)?)$/
const NB_AR = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto']

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
type Built = { url: string; body: Record<string, unknown> } | { error: string }
function build(alias: Alias, b: Record<string, any>, uid: string | null): Built {
  const cb = `${SUPABASE_URL}/functions/v1/kie-proxy?path=/cb`   // exigé par Kling 3.0 ; le suivi reste la seule source de vérité
  if (alias === 'nano-banana-pro') {
    const raw = Array.isArray(b.image_urls) ? b.image_urls : (Array.isArray(b.image_input) ? b.image_input : [])
    const imgs = raw.slice(0, 8).map((x: unknown) => okInput(x, uid))
    if (imgs.some((x: string | null) => !x)) return { error: 'image_urls : URL de notre storage uniquement' }
    const prompt = str(b.prompt, 10000)
    if (!prompt) return { error: 'prompt requis' }
    return { url: `${KIE}/api/v1/jobs/createTask`, body: { model: 'nano-banana-pro', input: {
      prompt, image_input: imgs, aspect_ratio: pick(b.aspect_ratio, NB_AR, 'auto'),
      resolution: pick(b.resolution, ['1K', '2K', '4K'] as const, '2K'), output_format: 'jpg' } } }
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

// Erreur métier kie (le code est DANS le corps, le HTTP peut valoir 200) → réponse client lisible.
function kieErr(code: number, msg: string) {
  const m = String(msg || '').slice(0, 300)
  if (code === 402) return jsonRes(402, { error: 'Crédits kie.ai épuisés', kieCode: code })
  if (code === 429 || code === 433) return jsonRes(429, { error: 'kie.ai : trop de requêtes, réessaie dans un instant', kieCode: code })
  if (code === 401) return jsonRes(500, { error: 'clé kie.ai invalide', kieCode: code })
  if (code === 451) return jsonRes(422, { error: 'kie.ai : média inaccessible', detail: [{ type: 'media', msg: m }], kieCode: code })
  if (code === 455 || code === 505) return jsonRes(503, { error: 'kie.ai indisponible (maintenance)', kieCode: code })
  if (code === 400 || code === 422) return jsonRes(422, { error: 'kie.ai a refusé la demande : ' + m, detail: [{ type: 'validation', msg: m }], kieCode: code })
  return jsonRes(502, { error: `kie.ai ${code || 'erreur'} : ${m}`, kieCode: code })
}

// Suivi, rapatriement et détection du format : ../_shared/kie.ts (partagés avec reconcile-kie, le filet).

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST' && req.method !== 'GET') return jsonRes(405, { error: 'method_not_allowed' })
  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path') ?? '/'
  if (rawPath === '/health') return jsonRes(200, { ok: true, hasKey: !!key() })
  if (!key()) return jsonRes(500, { error: 'Aucune clé kie.ai dans les secrets Supabase (attendu : KIEAI_API_KEY)' })

  const v = safePath(rawPath, ALLOW)
  if (!v.ok) return jsonRes(400, { error: 'path refusé : ' + v.reason })
  const path = v.path

  // ── Accès : plan developer UNIQUEMENT (fermé en cas de doute), ou service_role ──
  const auth = await authUser(req)
  let uid: string | null = null
  if (!auth.isService) {
    if (!auth.userId) return jsonRes(401, { error: 'Session requise' })
    const { plan, err } = await userPlan(auth.userId)
    if (err || plan !== 'developer') return jsonRes(403, { error: 'kie.ai est réservé au compte développeur' })
    uid = auth.userId
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
    const sub = path.match(/^\/kie\/([a-z0-9.-]+)$/)
    if (sub && req.method === 'POST') {
      const alias = sub[1] as Alias
      if (!ALIASES.includes(alias)) return jsonRes(400, { error: 'modèle inconnu' })
      if (uid && !(await rateHit(`proxy:kie:bill:${uid}`, 600, 40))) return jsonRes(429, { error: 'Trop de générations en peu de temps — patiente quelques minutes.' })
      const b = await req.json().catch(() => ({}))
      const built = build(alias, b && typeof b === 'object' ? b : {}, uid)
      if ('error' in built) return jsonRes(400, { error: built.error })
      const r = await fetch(built.url, { method: 'POST', headers: kieHeaders(), body: JSON.stringify(built.body), signal: AbortSignal.timeout(30000) })
      const j = await r.json().catch(() => ({}))
      const taskId = String(j?.data?.taskId || '')
      if (j?.code !== 200 || !/^[A-Za-z0-9_-]{6,120}$/.test(taskId)) {
        console.warn('[kie] submit refusé', alias, j?.code, String(j?.msg || '').slice(0, 200))
        return kieErr(Number(j?.code) || r.status, j?.msg)
      }
      const fam = alias.startsWith('veo3') ? 'veo' : 'mk'
      const rid = `${fam}-${taskId}`
      console.log('[kie] submit ok', alias, taskId, who)
      if (uid) { const { error: jErr } = await svc().from('kie_jobs').insert({ task_id: rid, user_id: uid, alias, label: KIE_LABELS[alias] || 'kie.ai' }); if (jErr) console.warn('[kie] kie_jobs insert', jErr.message) }
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
      const rec = await record(fam, taskId)
      // Clé / solde / droits kie refusés : erreur IMMÉDIATE et vraie (pas 15 min d'attente), la tâche reste au filet.
      if (rec.account) return jsonRes(424, { error: 'clé ou compte kie.ai refusé (' + rec.err.slice(0, 120) + ') — la génération sera rangée dans ta Bibliothèque une fois réglé', detail: [{ type: 'kie_account', msg: rec.err }] })
      if (rec.transient) return jsonRes(503, { error: 'kie.ai momentanément indisponible', detail: [{ type: 'transient', msg: rec.err }] })
      if (!rec.found) return jsonRes(404, { error: 'tâche kie introuvable', detail: [{ type: 'not_found', msg: rec.err }] })
      // Propriété : TOUTES les URL d'entrée enregistrées par kie viennent du dossier de l'appelant. Un échec sans param
      // (ex. refus 400) passe (rien à protéger) ; un résultat réussi exige toujours la preuve.
      if (uid && (rec.state === 'ok' || rec.param) && !kieOwnedBy(rec.param, uid, STORE_SIGN)) return jsonRes(404, { error: 'tâche kie introuvable' })
      const failed = rec.state === 'fail' || (rec.state === 'ok' && !rec.urls.length)   // « succès » sans URL = échec
      if (isStatus) {
        if (failed) return jsonRes(200, { status: 'FAILED', error: rec.err || 'résultat vide', detail: [{ type: rec.errType || 'failed', msg: rec.err || 'résultat vide' }], meta: rec.meta })
        return jsonRes(200, { status: rec.state === 'ok' ? 'COMPLETED' : rec.state === 'run' ? 'IN_PROGRESS' : 'IN_QUEUE', meta: rec.meta })
      }
      if (failed && uid) { const { error: jErr } = await svc().from('kie_jobs').update({ state: 'failed', last_error: (rec.err || 'échec kie').slice(0, 200), updated_at: new Date().toISOString() }).eq('task_id', rid).eq('user_id', uid).in('state', ['pending', 'fetched']); if (jErr) console.warn('[kie] kie_jobs failed', jErr.message) }
      if (failed) return jsonRes(422, { status: 'FAILED', error: rec.err || 'résultat vide', detail: [{ type: rec.errType || 'failed', msg: rec.err || 'résultat vide' }], meta: rec.meta })
      if (rec.state !== 'ok') return jsonRes(202, { status: rec.state === 'run' ? 'IN_PROGRESS' : 'IN_QUEUE' })

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
})
