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
// alias : nano-banana-pro · veo3-lite · veo3-fast · kling-2.6-mc · kling-3.0-mc · omnihuman-1.5
//
// Sécurité : le corps kie est RECONSTRUIT côté serveur (jamais de spread du corps client) ; modèle, traduction,
// filigrane, fond Kling… imposés ici. Entrées = URL signées de NOTRE storage (render-media/<uid>/…) seulement.
// Propriété des tâches : le `param` renvoyé par kie contient nos URL d'entrée → on y exige /render-media/<uid>/.
// Les URL de résultat kie expirent (~24 h) → rapatriement dans render-media/<uid>/kie/<taskId>.<ext>.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, userPlan, helperGate, rateHit, safePath, svc, SUPABASE_URL, isBlockedHost, hostResolvesInternal } from '../_shared/guard.ts'

const KIE = 'https://api.kie.ai'
const BUCKET = 'render-media'
const STORE_SIGN = `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/`
const ALIASES = ['nano-banana-pro', 'veo3-lite', 'veo3-fast', 'kling-2.6-mc', 'kling-3.0-mc', 'omnihuman-1.5'] as const
type Alias = typeof ALIASES[number]
const ALLOW = /^\/(health|balance|kie\/(nano-banana-pro|veo3-lite|veo3-fast|kling-2\.6-mc|kling-3\.0-mc|omnihuman-1\.5)|kie\/requests\/(mk|veo)-[A-Za-z0-9_-]{6,120}(\/status)?)$/
const NB_AR = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto']
const MAX_RESULT_BYTES = 90 * 1024 * 1024   // mémoire Edge = 256 Mo (lecture en flux, abandon au-delà)

const key = () => Deno.env.get('KIEAI_API_KEY') ?? ''
const kieHeaders = () => ({ Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' })
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

// ── Suivi normalisé des deux familles (market = jobs/recordInfo ; veo = veo/record-info) ──
type Rec = { found: boolean; transient?: boolean; state: 'queue' | 'run' | 'ok' | 'fail'; urls: string[]; err: string; errType: string; param: string; meta: Record<string, unknown> }
async function record(fam: 'mk' | 'veo', taskId: string): Promise<Rec> {
  const path = fam === 'veo' ? '/api/v1/veo/record-info' : '/api/v1/jobs/recordInfo'
  const miss = (err: string, extra: Partial<Rec> = {}): Rec => ({ found: false, state: 'fail', urls: [], err, errType: 'not_found', param: '', meta: {}, ...extra })
  let r: Response, j: any
  try { r = await fetch(`${KIE}${path}?taskId=${encodeURIComponent(taskId)}`, { headers: kieHeaders(), signal: AbortSignal.timeout(20000) }) }
  catch { return miss('kie injoignable', { transient: true }) }
  try { j = await r.json() } catch { return miss('réponse kie illisible', { transient: true }) }
  const code = Number(j?.code), d = j?.data
  // Panne PASSAGÈRE (le client réessaie) ≠ tâche introuvable (404) ≠ échec réel (FAILED → repli possible côté client).
  if (r.status >= 500 || [429, 433, 455, 500, 505].includes(code)) return miss(String(j?.msg || 'kie momentanément indisponible'), { transient: true })
  if (code === 200 && !d) return miss('tâche introuvable')
  if (code !== 200) {
    if (code === 404 || (code === 422 && /null|not.?found|record/i.test(String(j?.msg || '')))) return miss(String(j?.msg || 'tâche introuvable'))
    return { found: true, state: 'fail', urls: [], err: String(j?.msg || 'échec kie'), errType: String(code || 'failed'), param: '', meta: { kieCode: code } }
  }
  if (fam === 'veo') {
    const f = Number(d.successFlag)
    const urls = Array.isArray(d.response?.resultUrls) ? d.response.resultUrls : []
    return { found: true, state: f === 1 ? 'ok' : (f === 2 || f === 3 ? 'fail' : 'run'), urls,
      err: String(d.errorMessage || ''), errType: String(d.errorCode ?? ''), param: String(d.paramJson || ''),
      meta: { resolution: d.response?.resolution ?? null, originUrls: d.response?.originUrls ?? null, fallbackFlag: d.fallbackFlag ?? null } }
  }
  const st = String(d.state || '')
  let urls: string[] = []
  if (st === 'success') { try { urls = JSON.parse(d.resultJson || '{}').resultUrls || [] } catch { urls = [] } }
  return { found: true, state: st === 'success' ? 'ok' : st === 'fail' ? 'fail' : st === 'generating' ? 'run' : 'queue', urls,
    err: String(d.failMsg || ''), errType: String(d.failCode || ''), param: String(d.param || ''),
    meta: { model: d.model ?? null, costTime: d.costTime ?? null, creditsConsumed: d.creditsConsumed ?? null } }
}

// Téléchargement du résultat kie (anti-SSRF : https, hôte public, redirections revalidées), JAMAIS .text() sur un binaire.
async function download(raw: string): Promise<{ buf: ArrayBuffer; ct: string; host: string } | null> {
  let u = raw
  for (let hop = 0; hop < 4; hop++) {
    let p: URL
    try { p = new URL(u) } catch { return null }
    if (p.protocol !== 'https:' || isBlockedHost(p.hostname) || await hostResolvesInternal(p.hostname)) return null
    const r = await fetch(p.href, { redirect: 'manual', signal: AbortSignal.timeout(120000) })
    if (r.status >= 300 && r.status < 400) { const loc = r.headers.get('location'); if (!loc) return null; u = new URL(loc, p.href).href; continue }
    if (!r.ok) return null
    const len = Number(r.headers.get('content-length') || 0)
    if (len > MAX_RESULT_BYTES || !r.body) return null
    const chunks: Uint8Array[] = []; let total = 0
    const reader = r.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESULT_BYTES) { try { await reader.cancel() } catch { /* */ } return null }
      chunks.push(value)
    }
    if (total < 1000) return null
    const buf = new Uint8Array(total); let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.byteLength }
    return { buf: buf.buffer, ct: (r.headers.get('content-type') || '').toLowerCase(), host: p.hostname }
  }
  return null
}

function kindOf(ct: string, buf: ArrayBuffer): { ext: string; mime: string; kind: 'image' | 'video' } | null {
  const h = new Uint8Array(buf.slice(0, 12))
  if (h[0] === 0xff && h[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg', kind: 'image' }
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return { ext: 'png', mime: 'image/png', kind: 'image' }
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57) return { ext: 'webp', mime: 'image/webp', kind: 'image' }
  if (h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) return { ext: 'mp4', mime: 'video/mp4', kind: 'video' }
  if (ct.startsWith('image/')) return { ext: ct.includes('png') ? 'png' : 'jpg', mime: ct.split(';')[0], kind: 'image' }
  if (ct.startsWith('video/')) return { ext: 'mp4', mime: 'video/mp4', kind: 'video' }
  return null
}

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
      return jsonRes(200, { request_id: rid, status_url: `/kie/requests/${rid}/status`, response_url: `/kie/requests/${rid}`, status: 'IN_QUEUE', provider: 'kie' })
    }

    // ── SUIVI / RÉSULTAT ──
    const q = path.match(/^\/kie\/requests\/(mk|veo)-([A-Za-z0-9_-]{6,120})(\/status)?$/)
    if (q && req.method === 'GET') {
      if (uid) { const g = await helperGate(uid, 'kie', 1500, 600); if (!g.ok) return jsonRes(g.status, { error: g.error }) }
      const fam = q[1] as 'mk' | 'veo', taskId = q[2], isStatus = !!q[3]
      const rec = await record(fam, taskId)
      if (rec.transient) return jsonRes(503, { error: 'kie.ai momentanément indisponible', detail: [{ type: 'transient', msg: rec.err }] })
      if (!rec.found) return jsonRes(404, { error: 'tâche kie introuvable', detail: [{ type: 'not_found', msg: rec.err }] })
      // Propriété : nos URL d'entrée signées portent /render-media/<uid>/ et kie les renvoie dans `param`.
      // Un échec kie peut revenir SANS param (ex. refus 400) : on laisse alors passer le statut d'échec (rien à protéger) ;
      // un résultat réussi, lui, exige toujours la preuve de propriété.
      if (uid && (rec.state === 'ok' || rec.param) && !rec.param.includes(`/${BUCKET}/${uid}/`)) return jsonRes(404, { error: 'tâche kie introuvable' })
      const failed = rec.state === 'fail' || (rec.state === 'ok' && !rec.urls.length)   // « succès » sans URL = échec
      if (isStatus) {
        if (failed) return jsonRes(200, { status: 'FAILED', error: rec.err || 'résultat vide', detail: [{ type: rec.errType || 'failed', msg: rec.err || 'résultat vide' }], meta: rec.meta })
        return jsonRes(200, { status: rec.state === 'ok' ? 'COMPLETED' : rec.state === 'run' ? 'IN_PROGRESS' : 'IN_QUEUE', meta: rec.meta })
      }
      if (failed) return jsonRes(422, { status: 'FAILED', error: rec.err || 'résultat vide', detail: [{ type: rec.errType || 'failed', msg: rec.err || 'résultat vide' }], meta: rec.meta })
      if (rec.state !== 'ok') return jsonRes(202, { status: rec.state === 'run' ? 'IN_PROGRESS' : 'IN_QUEUE' })

      // Rapatriement idempotent : déjà copié ? → URL signée directe.
      const st = svc().storage.from(BUCKET)
      const base = `${who}/kie/${taskId}`
      const { data: listed } = await st.list(`${who}/kie`, { search: taskId, limit: 5 })
      const hit = (listed || []).find((f: { name: string }) => f.name.startsWith(taskId + '.'))
      let dst = hit ? `${who}/kie/${hit.name}` : '', kind: 'image' | 'video' = hit && /\.(jpg|png|webp)$/.test(hit.name) ? 'image' : 'video', host = ''
      if (!dst) {
        const dl = await download(rec.urls[0])
        if (!dl) return jsonRes(502, { error: 'rapatriement du résultat kie impossible' })
        const k = kindOf(dl.ct, dl.buf)
        if (!k) return jsonRes(502, { error: 'format de résultat kie inattendu (' + (dl.ct || 'inconnu') + ')' })
        dst = `${base}.${k.ext}`; kind = k.kind; host = dl.host
        const { error: upErr } = await st.upload(dst, new Uint8Array(dl.buf), { contentType: k.mime, upsert: true })
        if (upErr) return jsonRes(500, { error: 'copie du résultat impossible : ' + upErr.message })
      }
      const { data: signed, error: sErr } = await st.createSignedUrl(dst, 3600)
      if (sErr || !signed?.signedUrl) return jsonRes(500, { error: 'URL signée impossible' })
      const out = signed.signedUrl
      console.log('[kie] résultat', fam, taskId, kind, dst, host)
      const media = kind === 'image' ? { images: [{ url: out }], image: { url: out } } : { video: { url: out }, video_url: out }
      return jsonRes(200, { status: 'COMPLETED', url: out, kind, storage_path: dst, ...media, kie: { taskId, source_host: host || null, ...rec.meta } })
    }
    return jsonRes(400, { error: 'requête non prise en charge' })
  } catch (e) {
    console.warn('[kie] exception', (e as Error)?.message)
    return jsonRes(502, { error: 'upstream_error', detail: String((e as Error)?.message || e).slice(0, 200) })
  }
})
