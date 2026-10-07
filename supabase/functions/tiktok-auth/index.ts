// TikTok OAuth (Login Kit) — AvatarAds
//  action=authorize : renvoie l'URL d'autorisation TikTok (client_key public, redirect vérifié)
//  action=exchange  : échange le `code` reçu sur le callback contre un access_token, le stocke
//  action=status    : y a-t-il un compte TikTok connecté ? (open_id + display_name, JAMAIS le token)
//  action=stats     : @, abonnés, likes et vues de chaque vidéo des comptes qui ont donné les scopes de stats (07/10)
// env=sandbox (07/10) : même chose avec l'app de TEST (clés TIKTOK_SANDBOX_*) et la table tiktok_sandbox_accounts, pour
// les scopes de stats pas encore revus en production (user.info.profile, user.info.stats, video.list). Le state signé
// porte l'environnement (1.o. production, 1.s. Sandbox) : la page de retour n'a rien à savoir.
// Le client_secret ne sort JAMAIS du serveur : l'échange se fait ici. verify_jwt=false (session vérifiée ICI).
// Voir aussi la page publique tiktok-callback.html.
// Audit 02/10 : TOUTES les actions exigent une session owner/developer. authorize émet un state signé lié à cette
// session (10 min) ; exchange exige ce state ET la même session (Bearer envoyé par tiktok-callback.html, lu dans la
// session avatarads.fr du même domaine). Avant, n'importe qui pouvait relier son compte TikTok (qui devenait « le
// plus récent », choisi par défaut pour l'envoi des brouillons) ou faire relier le sien depuis le navigateur d'Axel.
// 07/10 : version épinglée — esm.sh servait une 2.117.3 cassée (module auth-js introuvable), déploiement refusé
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import jpeg from 'https://esm.sh/jpeg-js@0.4.4'
import webpDecode, { init as webpInit } from 'https://esm.sh/@jsquash/webp@1.4.0/decode'
import { WEBP_DEC_WASM } from '../_shared/webp-dec-wasm.ts'
import { toGray, fpCoverScore, fpCoverCoarse, fpCoarse, b64ToBytes, fpDecide, fpStyleCover, fpStyleDist, type FpCand } from '../_shared/fp.ts'

// trim : un copier-coller depuis la console TikTok peut ajouter un retour à la ligne (vécu le 03/10 au passage en production).
const CLIENT_KEY    = (Deno.env.get('TIKTOK_CLIENT_KEY') || '').trim()
const CLIENT_SECRET = (Deno.env.get('TIKTOK_CLIENT_SECRET') || '').trim()
const REDIRECT_URI  = 'https://avatarads.fr/tiktok-callback.html'
// Après la revue TikTok des scopes de stats (07/10, révision à soumettre) : ajouter ici user.info.profile,user.info.stats,video.list
// puis reconnecter les comptes. JAMAIS avant : un scope non accordé à l'app de production fait échouer l'autorisation.
const SCOPE         = 'user.info.basic,video.upload'
const SBX_KEY       = (Deno.env.get('TIKTOK_SANDBOX_CLIENT_KEY') || '').trim()
const SBX_SECRET    = (Deno.env.get('TIKTOK_SANDBOX_CLIENT_SECRET') || '').trim()
const SBX_SCOPE     = 'user.info.basic,user.info.profile,user.info.stats,video.list'
type Env = 'prod' | 'sandbox'
const CFG: Record<Env, { key: string, secret: string, table: string, scope: string }> = {
  prod:    { key: CLIENT_KEY, secret: CLIENT_SECRET, table: 'tiktok_accounts', scope: SCOPE },
  sandbox: { key: SBX_KEY, secret: SBX_SECRET, table: 'tiktok_sandbox_accounts', scope: SBX_SCOPE },
}
const SB_URL        = Deno.env.get('SUPABASE_URL') || ''
// 07/10 : relecture automatique des stats toutes les heures (pg_cron « tiktok-stats-hourly », clé du coffre Vault)
const CRON_SECRET   = Deno.env.get('CRON_SECRET') || ''
// comparaison à temps constant (même code que _shared/guard.ts, non importé : il tire supabase-js@2 non épinglé)
function timingSafeEqual(a: string, b: string): boolean {
  const x = String(a ?? ''), y = String(b ?? '')
  if (x.length !== y.length) return false
  let r = 0
  for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return r === 0
}
const SERVICE       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Photo de profil (06/10) : l'avatar_url de TikTok est un lien CDN signé qui expire ~2 jours après la connexion (403
// ensuite) ; on en garde une copie dans le bucket public factory-media (tiktok-avatars/<hash>.jpg), lien stable.
async function keepAvatar(openId: string, src: string): Promise<string | null> {
  try {
    if (!/^https:\/\/[\w.-]+\.(tiktokcdn(-eu|-us)?\.com|ibyteimg\.com|byteimg\.com)\//.test(src)) return null
    const r = await fetch(src, { signal: AbortSignal.timeout(8000) })
    const type = r.headers.get('content-type') || ''
    if (!r.ok || !type.startsWith('image/')) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    if (!buf.length || buf.length > 2_000_000) return null
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(openId))))
      .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24)
    const path = `tiktok-avatars/${h}.jpg`
    const { error } = await svc.storage.from('factory-media').upload(path, buf, { contentType: type, upsert: true })
    if (error) return null
    return `${SB_URL}/storage/v1/object/public/factory-media/${path}?v=${Date.now()}`
  } catch { return null }
}

// Session owner/developer exigée (audit 29/09 : accounts, status, post et poststatus étaient ouverts — n'importe qui
// pouvait lister nos comptes et pousser une vidéo en brouillon sur eux, en nous faisant télécharger l'URL de son
// choix ; audit 02/10 : authorize et exchange aussi). Fermé par défaut. Renvoie l'uid de l'owner ('' = refus).
async function ownerUid(req: Request): Promise<string> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return ''
  try {
    const { data: { user }, error } = await svc.auth.getUser(jwt)
    if (error || !user?.id) return ''
    const { data, error: e2 } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
    if (e2 || !data) return ''
    return (!!data.is_owner || String(data.plan || '').toLowerCase() === 'developer') ? user.id : ''
  } catch { return '' }
}

// Audit 02/10 : state OAuth signé (HMAC-SHA256 avec le secret de l'app et un préfixe dédié ; même schéma
// qu'instagram-auth, préfixe différent). Format : 1.o.<expiration en s, base 36>.<nonce>.<signature>. La signature
// couvre AUSSI l'uid de la session owner qui l'a demandé (jamais écrit en clair dans l'URL vue par TikTok) :
// l'échange n'aboutit qu'avec cette même session. Valable 10 minutes. Pas de mode relecteur ici.
// 07/10 : 1.s. = connexion Sandbox (la lettre est couverte par la signature, toujours faite avec le secret de production).
const STATE_TTL_S = 600
const STATE_RE = /^1\.([os])\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function stateSig(body: string, uid: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('aa-oauth-state|tk|' + body + '|' + uid))))
}
async function stateMint(uid: string, env: Env): Promise<string> {
  const body = '1.' + (env === 'sandbox' ? 's' : 'o') + '.' + (Math.floor(Date.now() / 1000) + STATE_TTL_S).toString(36) + '.' + b64u(crypto.getRandomValues(new Uint8Array(12)))
  return body + '.' + await stateSig(body, uid)
}
// State bien formé, non expiré, signé pour CETTE session owner → son environnement (null = refus).
async function stateOk(state: string, uid: string): Promise<Env | null> {
  const m = STATE_RE.exec(state)
  if (!m || !uid) return null
  const exp = parseInt(m[2], 36) * 1000
  if (!(exp > Date.now()) || exp - Date.now() > (STATE_TTL_S + 300) * 1000) return null
  const i = state.lastIndexOf('.')
  const expected = await stateSig(state.slice(0, i), uid)
  const got = state.slice(i + 1)
  if (expected.length !== got.length) return null
  let d = 0
  for (let k = 0; k < got.length; k++) d |= expected.charCodeAt(k) ^ got.charCodeAt(k)   // temps constant
  return d === 0 ? (m[1] === 's' ? 'sandbox' : 'prod') : null
}
// Token d'accès valide d'un compte : l'access_token TikTok vit 24 h ; au-delà (ou à 5 min de la fin) on le renouvelle
// avec le refresh_token (365 j) et on enregistre le nouveau couple. null = compte inconnu ou refresh refusé.
async function freshToken(open_id: string, env: Env = 'prod'): Promise<{ token: string } | { error: string }> {
  const C = CFG[env]
  const { data: acc } = await svc.from(C.table).select('access_token, refresh_token, expires_at').eq('open_id', open_id).maybeSingle()
  if (!acc?.access_token) return { error: 'compte TikTok non connecté (open_id inconnu)' }
  const exp = acc.expires_at ? Date.parse(acc.expires_at) : 0
  if (exp && exp - Date.now() > 5 * 60 * 1000) return { token: acc.access_token }
  if (!acc.refresh_token) return { error: 'session TikTok expirée : reconnecte ce compte' }
  const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: C.key, client_secret: C.secret, grant_type: 'refresh_token', refresh_token: acc.refresh_token }).toString(),
  })
  const t = await r.json().catch(() => ({}))
  if (!r.ok || t.error || !t.access_token) return { error: 'session TikTok expirée : reconnecte ce compte (' + String(t.error_description || t.error || r.status).slice(0, 80) + ')' }
  const now = Date.now()
  await svc.from(C.table).update({
    access_token: t.access_token, refresh_token: t.refresh_token ?? acc.refresh_token,
    expires_at: new Date(now + (Number(t.expires_in) || 86400) * 1000).toISOString(),
    ...(t.refresh_expires_in ? { refresh_expires_at: new Date(now + Number(t.refresh_expires_in) * 1000).toISOString() } : {}),
    updated_at: new Date(now).toISOString(),
  }).eq('open_id', open_id)
  return { token: t.access_token }
}

// Stats TikTok (07/10) : dernière réponse gardée 5 min par instance (le dashboard relit à chaque ouverture).
let statsCache: { at: number, body: unknown } | null = null

// Couvertures (07/10) : le lien renvoyé par TikTok est signé, expire, et une partie ne s'affichait pas dans Safari. On en
// garde UNE copie par vidéo dans factory-media/tiktok-covers/<id>.<ext> (lien stable, mis en cache), que le dashboard
// affiche ; les octets servent aussi à l'empreinte de rapprochement. Le lien vient de l'API TikTok (jamais du client) :
// https seulement, image seulement, 3 Mo au plus.
async function keepCover(id: string, src: string): Promise<{ url: string, bytes: Uint8Array, type: string } | null> {
  try {
    if (!/^\d{5,25}$/.test(id) || !/^https:\/\/[\w.-]+\//.test(src)) return null
    const r = await fetch(src, { headers: { Accept: 'image/jpeg,image/png;q=0.9,image/webp;q=0.8,image/*;q=0.5' }, signal: AbortSignal.timeout(8000) })
    const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!r.ok || !type.startsWith('image/')) { console.log('couverture', id, r.status, type, new URL(src).hostname); return null }
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (!bytes.length || bytes.length > 3_000_000) return null
    const ext = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/avif': 'avif' } as Record<string, string>)[type] || 'jpg'
    const path = `tiktok-covers/${id}.${ext}`
    const { error } = await svc.storage.from('factory-media').upload(path, bytes, { contentType: type, upsert: true })
    if (error) { console.log('couverture upload', id, error.message); return null }
    return { url: `${SB_URL}/storage/v1/object/public/factory-media/${path}`, bytes, type }
  } catch (e) { console.log('couverture', id, String((e as Error)?.message || e).slice(0, 120)); return null }
}

// ── Rapprochement vidéo TikTok → vidéo de l'usine (07/10) ──
// La couverture TikTok est une image du HOOK, pas forcément la première (constaté sur @avatarads le 07/10). On la compare
// aux empreintes de chaque vidéo finale (usine/fingerprint.mjs) avec le code partagé _shared/fp.ts : factory_fp (images à
// 0 / 0,5 / 1 s, ou le poster seul pour une vidéo supprimée) + factory_fp_frames (4 images par seconde sur les 10
// premières secondes). Pré-tri rapide sur 18 × 32, puis score fin sur les meilleures images des 8 vidéos les plus proches.
// Durée TikTok (secondes entières) à 1,5 s près quand celle de la vidéo est connue. auto = sûr ; unsure = 1-3 propositions
// à choisir dans Factory V2 ; none = pas une vidéo de l'usine (ancienne vidéo, autre montage).
let webpReady: Promise<void> | null = null
async function decodeCover(bytes: Uint8Array): Promise<{ w: number, h: number, gray: Uint8Array, rgba: ArrayLike<number> } | null> {
  try {
    let img: { width: number, height: number, data: ArrayLike<number> }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) {   // RIFF....WEBP
      if (!webpReady) webpReady = webpInit(new WebAssembly.Module(b64ToBytes(WEBP_DEC_WASM) as Uint8Array<ArrayBuffer>))
      await webpReady
      img = await webpDecode(bytes.slice().buffer)
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 96 })
    } else return null
    return { w: img.width, h: img.height, gray: toGray(img.data, img.width * img.height), rgba: img.data }
  } catch (e) { console.log('décodage couverture', String((e as Error)?.message || e).slice(0, 120)); return null }
}
type Fp = { vf: string, url: string, duration: number | null, thumbs: Uint8Array[], coarse: Uint8Array[], styles: Uint8Array[], cap: string }
let fpCache: { at: number, rows: Fp[] } | null = null
async function loadFp(): Promise<Fp[]> {
  if (fpCache && Date.now() - fpCache.at < 10 * 60 * 1000) return fpCache.rows
  const { data, error } = await svc.from('factory_fp').select('vf, video_url, duration, thumbs, styles').not('thumbs', 'is', null).limit(3000)
  if (error) { console.log('empreintes', error.message); return [] }
  // légende du kit de chaque vidéo (indice seulement : Axel ne colle pas toujours la même sur TikTok)
  const { data: posts } = await svc.from('factory_posts').select('video_url, caption').not('video_url', 'is', null).limit(5000)
  const capOf = new Map((posts || []).map((p: any) => [String(p.video_url), capNorm(p.caption)]))
  const rows = (data || []).filter((r: any) => r.vf && Array.isArray(r.thumbs) && r.thumbs.length).map((r: any) => {
    const thumbs = r.thumbs.map((t: string) => b64ToBytes(t))
    return { vf: String(r.vf), url: String(r.video_url), duration: r.duration == null ? null : Number(r.duration), thumbs, coarse: thumbs.map(fpCoarse),
      styles: Array.isArray(r.styles) ? r.styles.map((t: string) => b64ToBytes(t)) : [], cap: capOf.get(String(r.video_url)) || '' }
  })
  fpCache = { at: Date.now(), rows }
  return rows
}
// légende comparée sur ses 50 premiers caractères, sans hashtags ni casse
const capNorm = (t: unknown) => String(t || '').replace(/#[^\s#]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 50)
type Fr = { t: number, coarse: Uint8Array }
let frCache: { at: number, by: Map<string, Fr[]> } | null = null
async function loadFrames(): Promise<Map<string, Fr[]>> {
  if (frCache && Date.now() - frCache.at < 10 * 60 * 1000) return frCache.by
  const by = new Map<string, Fr[]>()
  for (let from = 0; from < 100000; from += 1000) {   // PostgREST : 1 000 lignes par page
    const { data, error } = await svc.from('factory_fp_frames').select('video_url, t, coarse').order('video_url').order('t').range(from, from + 999)
    if (error) { console.log('images du hook', error.message); break }
    for (const r of data || []) {
      const k = String(r.video_url)
      if (!by.has(k)) by.set(k, [])
      by.get(k)!.push({ t: Number(r.t), coarse: b64ToBytes(String(r.coarse)) })
    }
    if (!data || data.length < 1000) break
  }
  frCache = { at: Date.now(), by }
  return by
}
async function matchCover(bytes: Uint8Array, duration: number | null, title: string): Promise<{ vf: string | null, state: string, score: number | null, candidates: { vf: string, score: number }[] } | null> {
  const img = await decodeCover(bytes)
  if (!img) return null
  const style = fpStyleCover(img.rgba, img.w, img.h), cap = capNorm(title)
  const fps = (await loadFp()).filter((f) => f.duration == null || duration == null || Math.abs(f.duration - duration) <= 1.5)
  if (!fps.length) return { vf: null, state: 'none', score: null, candidates: [] }
  const frames = await loadFrames()
  // pré-tri : meilleure image (grossière) de chaque vidéo, en gardant les 3 meilleures images du hook pour le score fin
  const all = fps.map((f) => {
    const own = Math.min(...f.coarse.map((t) => fpCoverCoarse(img.gray, img.w, img.h, t)))
    const fr = (frames.get(f.url) || []).map((x) => ({ t: x.t, c: fpCoverCoarse(img.gray, img.w, img.h, x.coarse) })).sort((a, b) => a.c - b.c)
    const st = f.styles.length ? Math.min(...f.styles.map((x) => fpStyleDist(style, x))) : null
    return { f, c: Math.min(own, fr[0]?.c ?? Infinity), ts: fr.slice(0, 3).map((x) => x.t), st }
  })
  // score fin pour les 8 plus proches en luminance + les 3 plus proches en style
  const byC = [...all].sort((a, b) => a.c - b.c).slice(0, 8)
  const byS = all.filter((x) => x.st != null).sort((a, b) => (a.st as number) - (b.st as number)).slice(0, 3)
  const pick = [...new Set([...byC, ...byS])]
  const list: FpCand[] = await Promise.all(pick.map(async ({ f, ts, st }) => {
    let best = Math.min(...f.thumbs.map((t) => fpCoverScore(img.gray, img.w, img.h, t)))
    if (ts.length) {
      const { data } = await svc.from('factory_fp_frames').select('thumb').eq('video_url', f.url).in('t', ts)
      for (const r of data || []) best = Math.min(best, fpCoverScore(img.gray, img.w, img.h, b64ToBytes(String(r.thumb))))
    }
    return { vf: f.vf, score: +best.toFixed(1), style: st == null ? null : +st.toFixed(3), cap: !!cap && f.cap === cap }
  }))
  return fpDecide(list)
}

// Vidéos envoyables : seulement celles de notre stockage public factory-media (jamais une URL quelconque).
const MEDIA_PREFIX = `${SB_URL}/storage/v1/object/public/factory-media/`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (!CLIENT_KEY || !CLIENT_SECRET) return json({ error: 'TikTok non configuré (secrets manquants).' }, 500)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') || (req.method === 'POST' ? 'exchange' : 'authorize')
  // Audit 02/10 : toutes les actions (authorize et exchange compris) exigent la session owner/developer.
  // 07/10 : seule exception, action=stats appelée par pg_cron avec x-cron-key (aucune donnée renvoyée n'est un secret).
  const isCron = action === 'stats' && !!CRON_SECRET && timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)
  const uid = isCron ? 'cron' : await ownerUid(req)
  if (!uid) {
    return json({ error: action === 'exchange'
      ? 'Session propriétaire requise : termine la connexion TikTok dans le navigateur où tu es connecté au tableau de bord.'
      : 'réservé au propriétaire' }, 401)
  }

  // 1) URL d'autorisation à ouvrir côté app (state signé lié à la session owner ; &env=sandbox = app de test, stats)
  if (action === 'authorize') {
    const env: Env = url.searchParams.get('env') === 'sandbox' ? 'sandbox' : 'prod'
    if (!CFG[env].key || !CFG[env].secret) return json({ error: 'TikTok Sandbox non configuré (secrets TIKTOK_SANDBOX_* manquants).' }, 500)
    const state = await stateMint(uid, env)
    const authorize = 'https://www.tiktok.com/v2/auth/authorize/'
      + `?client_key=${encodeURIComponent(CFG[env].key)}`
      + `&scope=${encodeURIComponent(CFG[env].scope)}`
      + `&response_type=code`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      + `&state=${encodeURIComponent(state)}`
    return json({ authorize_url: authorize })
  }

  // 2) échange du code contre un token (appelé par tiktok-callback.html)
  if (action === 'exchange') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const code = String(body.code || url.searchParams.get('code') || '')
    if (!code) return json({ error: 'code manquant' }, 400)
    // Audit 02/10 : state signé pour cette session owner, vérifié AVANT d'utiliser le code.
    const state = String(body.state || url.searchParams.get('state') || '')
    const env = await stateOk(state, uid)
    if (!env) {
      return json({ error: 'Lien de connexion expiré ou invalide (autre session ou lien modifié) : relance « Connecter TikTok » depuis le tableau de bord.' }, 403)
    }
    const C = CFG[env]
    if (!C.key || !C.secret) return json({ error: 'TikTok Sandbox non configuré (secrets TIKTOK_SANDBOX_* manquants).' }, 500)

    const form = new URLSearchParams({
      client_key: C.key,
      client_secret: C.secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    })
    const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const t = await r.json().catch(() => ({}))
    if (!r.ok || t.error) return json({ error: t.error_description || t.error || `HTTP ${r.status}` }, 400)

    const now = Date.now()
    const row = {
      open_id: t.open_id,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      scope: t.scope ?? null,
      expires_at: new Date(now + (Number(t.expires_in) || 0) * 1000).toISOString(),
      refresh_expires_at: new Date(now + (Number(t.refresh_expires_in) || 0) * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
    }
    const { error } = await svc.from(C.table).upsert(row, { onConflict: 'open_id' })
    if (error) return json({ error: 'stockage token : ' + error.message }, 500)

    // (optionnel) récupérer le display_name pour l'affichage ; le @ (username) si le scope user.info.profile est donné
    const hasProfile = String(t.scope || '').split(',').includes('user.info.profile')
    try {
      const ui = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url' + (hasProfile ? ',username' : ''), {
        headers: { Authorization: `Bearer ${t.access_token}` },
      })
      const uj = await ui.json().catch(() => ({}))
      const u = uj?.data?.user
      if (u?.display_name && env === 'sandbox') {
        const handle = /^[A-Za-z0-9._]{2,24}$/.test(String(u.username || '')) ? String(u.username) : null
        const avatar = u.avatar_url ? (await keepAvatar(t.open_id, u.avatar_url)) ?? u.avatar_url : null
        await svc.from(C.table).update({ display_name: u.display_name, avatar_url: avatar, ...(handle ? { handle } : {}) }).eq('open_id', t.open_id)
      } else if (u?.display_name) {
        // @ : une reconnexion (Sandbox → production = nouvel open_id) reprend celui de l'ancienne connexion qui a la même
        // photo — la clé d'image du lien TikTok ne change pas tant que la photo de profil ne change pas
        const key = String(u.avatar_url || '').match(/\/tos-[^/]+\/([0-9a-f]{32})/)?.[1]
        let handle: string | null = null
        if (key) {
          const { data: prev } = await svc.from('tiktok_accounts').select('handle')
            .neq('open_id', t.open_id).not('handle', 'is', null).like('avatar_url', `%${key}%`).limit(1)
          handle = prev?.[0]?.handle ?? null
        }
        const avatar = u.avatar_url ? (await keepAvatar(t.open_id, u.avatar_url)) ?? u.avatar_url : null
        const upd: Record<string, unknown> = { display_name: u.display_name, avatar_url: avatar }
        const { data: cur } = await svc.from('tiktok_accounts').select('handle').eq('open_id', t.open_id).maybeSingle()
        if (handle && !cur?.handle) upd.handle = handle
        if (/^[A-Za-z0-9._]{2,24}$/.test(String(u.username || ''))) upd.handle = String(u.username)   // scope profil revu : le vrai @
        await svc.from('tiktok_accounts').update(upd).eq('open_id', t.open_id)
      }
    } catch { /* non bloquant */ }

    return json({ ok: true, open_id: t.open_id, scope: t.scope, env })
  }

  // 2b) stats (07/10) : pour chaque compte qui a donné user.info.stats (Sandbox aujourd'hui, production après la revue),
  //     profil (@, abonnés, likes, nombre de vidéos) + ses 60 dernières vidéos (vues, likes, commentaires, partages).
  //     Un même @ n'est lu qu'une fois (production d'abord). Relevé du jour dans social_daily (courbe des abonnés).
  //     Jamais de jeton dans la réponse. Cache 5 min (?force=1 pour relire tout de suite).
  if (action === 'stats') {
    const force = isCron || url.searchParams.get('force') === '1'
    if (!force && statsCache && Date.now() - statsCache.at < 5 * 60 * 1000) return json(statsCache.body)
    const rows: { env: Env, open_id: string, display_name: string | null, handle: string | null, avatar_url: string | null }[] = []
    for (const env of ['prod', 'sandbox'] as Env[]) {
      if (!CFG[env].key || !CFG[env].secret) continue
      const { data } = await svc.from(CFG[env].table).select('open_id, display_name, handle, avatar_url, scope').order('updated_at', { ascending: false })
      for (const r of data || []) if (String(r.scope || '').split(',').includes('user.info.stats')) rows.push({ env, ...r })
    }
    const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
    const seen = new Set<string>(), accounts: Record<string, unknown>[] = []
    for (const r of rows) {
      const a: Record<string, unknown> = { env: r.env, open_id: r.open_id, username: r.handle, display_name: r.display_name, avatar: r.avatar_url, videos: [] }
      try {
        const ft = await freshToken(r.open_id, r.env)
        if ('error' in ft) throw new Error(ft.error)
        const H = { Authorization: `Bearer ${ft.token}` }
        const ui = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,avatar_url,follower_count,following_count,likes_count,video_count,is_verified', { headers: H, signal: AbortSignal.timeout(10000) })
        const uj = await ui.json().catch(() => ({}))
        if (!ui.ok || (uj.error?.code && uj.error.code !== 'ok')) throw new Error('profil : ' + String(uj.error?.message || uj.error?.code || `HTTP ${ui.status}`).slice(0, 140))
        const u = uj.data?.user || {}
        const username = /^[A-Za-z0-9._]{2,24}$/.test(String(u.username || '')) ? String(u.username) : r.handle
        if (username && seen.has(username)) continue
        if (username) seen.add(username)
        Object.assign(a, { username, display_name: u.display_name ?? r.display_name, followers: n(u.follower_count), following: n(u.following_count),
          likes: n(u.likes_count), video_count: n(u.video_count), verified: !!u.is_verified })
        if (username && username !== r.handle) await svc.from(CFG[r.env].table).update({ handle: username }).eq('open_id', r.open_id)
        // vidéos : 3 pages de 20 au plus (les plus récentes d'abord)
        const vids: Record<string, unknown>[] = []
        let cursor: number | null = null
        for (let page = 0; page < 3; page++) {
          const vr: Response = await fetch('https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count', {
            method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
            body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
          })
          const vj: any = await vr.json().catch(() => ({}))
          if (!vr.ok || (vj.error?.code && vj.error.code !== 'ok')) { a.videos_error = 'vidéos : ' + String(vj.error?.message || vj.error?.code || `HTTP ${vr.status}`).slice(0, 140); break }
          for (const v of vj.data?.videos || []) {
            vids.push({ id: String(v.id || ''), title: String(v.title || v.video_description || '').slice(0, 300),
              published_at: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
              thumb: typeof v.cover_image_url === 'string' ? v.cover_image_url : null, url: typeof v.share_url === 'string' ? v.share_url : null,
              duration: n(v.duration), views: n(v.view_count), likes: n(v.like_count), comments: n(v.comment_count), shares: n(v.share_count) })
          }
          if (!vj.data?.has_more || !vj.data?.cursor) break
          cursor = Number(vj.data.cursor)
        }
        // vidéos gardées en base (tiktok_videos) + copie des couvertures pas encore copiées (30 au plus par lecture)
        if (username && vids.length) {
          const ids = vids.map((v) => String(v.id)).filter(Boolean)
          const { data: known } = await svc.from('tiktok_videos').select('id, cover_copy, vf, match_state, match_score, candidates').in('id', ids)
          const K = new Map((known || []).map((k: any) => [String(k.id), k]))
          await svc.from('tiktok_videos').upsert(vids.map((v) => ({ id: v.id, account: username, env: r.env,
            created: v.published_at, duration: v.duration, title: v.title, share_url: v.url, cover_src: v.thumb,
            views: v.views, likes: v.likes, comments: v.comments, shares: v.shares, updated_at: new Date().toISOString() })), { onConflict: 'id' })
          const todo = vids.filter((v) => v.thumb && !K.get(String(v.id))?.cover_copy).slice(0, 30)
          const got = new Map<string, Uint8Array>()
          for (let i = 0; i < todo.length; i += 6) {
            await Promise.all(todo.slice(i, i + 6).map(async (v) => {
              const kc = await keepCover(String(v.id), String(v.thumb))
              if (!kc) return
              got.set(String(v.id), kc.bytes)
              await svc.from('tiktok_videos').update({ cover_copy: kc.url }).eq('id', v.id)
              K.set(String(v.id), { ...(K.get(String(v.id)) || {}), cover_copy: kc.url })
            }))
          }
          // rapprochement des vidéos jamais rapprochées (8 au plus par lecture : temps de calcul de l'edge limité)
          const unmatched = vids.filter((v) => { const k: any = K.get(String(v.id)); return k?.cover_copy && !k.match_state }).slice(0, 8)
          for (const v of unmatched) {
            const k: any = K.get(String(v.id))
            let bytes = got.get(String(v.id))
            if (!bytes) {
              const r2 = await fetch(String(k.cover_copy), { signal: AbortSignal.timeout(8000) }).catch(() => null)
              if (r2?.ok) bytes = new Uint8Array(await r2.arrayBuffer())
            }
            if (!bytes) continue
            const m = await matchCover(bytes, typeof v.duration === 'number' ? v.duration : null, String(v.title || ''))
            if (!m) continue
            const upd = { vf: m.vf, match_state: m.state, match_score: m.score, candidates: m.candidates }
            await svc.from('tiktok_videos').update(upd).eq('id', v.id).is('match_state', null)
            K.set(String(v.id), { ...k, ...upd })
          }
          // recette des vidéos rapprochées : la ligne du kit (factory_posts) de la même vidéo finale
          const vfs = [...new Set([...K.values()].flatMap((k: any) => [k.vf, ...((k.candidates || []).map((c: any) => c.vf))]).filter(Boolean))]
          const files = new Map<string, { file: string, poster: string }>()   // nom complet (= ID de la recette) + poster (première image)
          if (vfs.length) {
            const { data: fr } = await svc.from('factory_fp').select('vf, video_url').in('vf', vfs)
            for (const r3 of fr || []) {
              const u = String(r3.video_url)
              files.set(String(r3.vf), { file: u.split('/final/')[1]?.replace(/\.mp4$/, '') || '', poster: u.replace(/\.mp4$/, '-poster.jpg') })
            }
          }
          for (const v of vids) {
            const k: any = K.get(String(v.id))
            if (k?.cover_copy) v.thumb = k.cover_copy
            if (k?.match_state) v.recipe = { vf: k.vf || null, state: k.match_state, score: k.match_score ?? null, ...(k.vf ? files.get(k.vf) || {} : {}),
              candidates: (k.candidates || []).map((c: any) => ({ vf: c.vf, score: c.score, ...(files.get(c.vf) || {}) })) }
          }
        }
        a.videos = vids
        if (username) {
          await svc.from('social_daily').upsert({ platform: 'tiktok', account: username, day, subscribers: a.followers ?? null,
            views: vids.reduce((s, v) => s + (Number(v.views) || 0), 0), videos: a.video_count ?? null, updated_at: new Date().toISOString() },
            { onConflict: 'platform,account,day' })
        }
      } catch (e) {
        a.error = String((e as Error)?.message || e).slice(0, 200)
      }
      accounts.push(a)
    }
    const names = accounts.map((a) => a.username).filter(Boolean) as string[]
    const { data: hist } = names.length
      ? await svc.from('social_daily').select('account, day, subscribers').eq('platform', 'tiktok').in('account', names).order('day').limit(2000)
      : { data: [] }
    const body = { accounts, history: hist || [], at: new Date().toISOString() }
    statsCache = { at: Date.now(), body }
    return json(body)
  }

  // 2c) rattachement choisi à la main (07/10) : body { id, vf } (vf vide = « pas une vidéo de l'usine »)
  if (action === 'link') {
    if (req.method !== 'POST') return json({ error: 'POST requis' }, 405)
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const id = String(body.id || ''), vf = String(body.vf || '')
    if (!/^\d{5,25}$/.test(id)) return json({ error: 'vidéo invalide' }, 400)
    if (vf && !/^VF-\d{4}$/.test(vf)) return json({ error: 'VF invalide' }, 400)
    if (vf) {
      const { data: f } = await svc.from('factory_fp').select('vf').eq('vf', vf).limit(1)
      if (!f?.length) return json({ error: 'vidéo de l’usine inconnue : ' + vf }, 404)
    }
    const { data: row, error } = await svc.from('tiktok_videos').update({ vf: vf || null, match_state: vf ? 'manual' : 'none' }).eq('id', id).select('id').maybeSingle()
    if (error || !row) return json({ error: 'vidéo TikTok introuvable' }, 404)
    statsCache = null
    return json({ ok: true, id, vf: vf || null })
  }

  // 3) état de connexion (sans jamais exposer le token)
  if (action === 'status') {
    const { data } = await svc.from('tiktok_accounts').select('open_id, display_name, avatar_url, scope, updated_at').order('updated_at', { ascending: false }).limit(1)
    return json({ connected: !!(data && data.length), account: data?.[0] || null })
  }

  // 3a) @ d'un compte, saisi à la main dans Factory V2 (06/10) : l'app n'a pas le scope user.info.profile (username).
  //     body { open_id, handle } ; reporté sur les autres lignes du même nom affiché (ancienne connexion Sandbox et
  //     nouvelle connexion production n'ont pas le même open_id). handle vide = effacé.
  if (action === 'handle') {
    if (req.method !== 'POST') return json({ error: 'POST requis' }, 405)
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const openId = String(body.open_id || '')
    const handle = String(body.handle || '').trim().replace(/^@+/, '')
    if (!/^[\w.:=+\/-]{4,200}$/.test(openId)) return json({ error: 'compte invalide' }, 400)
    if (handle && !/^[A-Za-z0-9._]{2,24}$/.test(handle)) return json({ error: '@ invalide : lettres, chiffres, points et _ uniquement (2 à 24)' }, 400)
    const { data: acc } = await svc.from('tiktok_accounts').select('display_name').eq('open_id', openId).maybeSingle()
    if (!acc) return json({ error: 'compte introuvable' }, 404)
    const { error } = await svc.from('tiktok_accounts').update({ handle: handle || null }).eq('open_id', openId)
    if (error) return json({ error: 'enregistrement impossible' }, 500)
    // Report sur les autres connexions du même nom, sauf si ce nom porte déjà un autre @ (deux comptes peuvent
    // avoir le même nom affiché, ex. « Axel | SaaS IA » = @ia.axel et @ia.axl)
    if (handle && acc.display_name) {
      const { data: same } = await svc.from('tiktok_accounts').select('open_id, handle').eq('display_name', acc.display_name).neq('open_id', openId)
      const others = new Set((same || []).map((r) => r.handle).filter((h) => h && h !== handle))
      if (!others.size) await svc.from('tiktok_accounts').update({ handle }).eq('display_name', acc.display_name).is('handle', null)
    }
    return json({ ok: true, handle: handle || null })
  }

  // 3b) liste des comptes connectés (pour l'UI — jamais les tokens)
  if (action === 'accounts') {
    const { data } = await svc.from('tiktok_accounts').select('open_id, display_name, handle, avatar_url, updated_at').order('updated_at', { ascending: false })
    return json({ accounts: data || [] })
  }

  // 4) upload d'une vidéo dans les BROUILLONS TikTok (inbox) d'un compte connecté
  //    body { open_id, video_url } → la vidéo tombe dans les brouillons du compte, il publie à la main.
  if (action === 'post') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const open_id = String(body.open_id || '')
    const video_url = String(body.video_url || '')
    const title = String(body.title || '').slice(0, 2200)   // légende pré-remplie (max TikTok ~2200)
    if (!open_id || !video_url) return json({ error: 'open_id et video_url requis' }, 400)
    if (!SB_URL || !video_url.startsWith(MEDIA_PREFIX) || video_url.includes('..')) return json({ error: 'video_url non autorisée' }, 400)

    const ft = await freshToken(open_id)
    if ('error' in ft) return json({ error: ft.error }, 400)
    const acc = { access_token: ft.token }

    // 06/10 : les vidéos finales font 70 à 150 Mo, au-delà des 64 Mo d'un envoi en un seul morceau. On découpe en morceaux
    // de 10 Mo (TikTok : 5 à 64 Mo par morceau, le dernier absorbe le reste), lus un par un dans le stockage (Range) :
    // jamais la vidéo entière en mémoire.
    // ⚠ l'inbox VIDÉO n'accepte QUE source_info — ajouter post_info (titre) fait échouer la livraison SILENCIEUSEMENT (init ok
    // mais la vidéo n'arrive jamais dans l'inbox). La légende est donc renvoyée pour un copier-coller côté app.
    const head = await fetch(video_url, { method: 'HEAD' })
    const size = Number(head.headers.get('content-length') || 0)
    if (!head.ok || !size) return json({ error: `vidéo introuvable (HTTP ${head.status})` }, 400)
    const CHUNK = 10_000_000
    const chunks = size < 5_000_000 ? 1 : Math.floor(size / CHUNK)
    const chunkSize = chunks === 1 ? size : CHUNK
    const init = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${acc.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: chunks } }),
    })
    const ij = await init.json().catch(() => ({}))
    if (!init.ok || (ij.error && ij.error.code && ij.error.code !== 'ok')) {
      return json({ error: (ij.error && ij.error.message) || `init HTTP ${init.status}`, code: ij.error?.code }, 400)
    }
    const publish_id = ij?.data?.publish_id
    const upload_url = ij?.data?.upload_url
    if (!upload_url) return json({ error: 'pas d\'upload_url renvoyé par TikTok', detail: ij }, 400)

    for (let k = 0; k < chunks; k++) {
      const start = k * chunkSize, end = k === chunks - 1 ? size - 1 : start + chunkSize - 1
      const part = await fetch(video_url, { headers: { Range: `bytes=${start}-${end}` } })
      if (part.status !== 206 && !(chunks === 1 && part.ok)) return json({ error: `lecture vidéo morceau ${k + 1}/${chunks} (HTTP ${part.status})` }, 400)
      const bytes = new Uint8Array(await part.arrayBuffer())
      if (bytes.length !== end - start + 1) return json({ error: `morceau ${k + 1}/${chunks} incomplet` }, 400)
      const put = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}` },
        body: bytes,
      })
      if (![200, 201, 206].includes(put.status)) {
        const t = await put.text().catch(() => '')
        return json({ error: `envoi morceau ${k + 1}/${chunks} : HTTP ${put.status} ${t.slice(0, 140)}` }, 400)
      }
    }
    return json({ ok: true, publish_id, size, caption: title, note: 'Vidéo envoyée dans les brouillons TikTok (inbox). Colle la légende dans l\'éditeur.' })
  }

  // 5) statut d'un upload (diagnostic) : { open_id, publish_id } → status + fail_reason TikTok
  if (action === 'poststatus') {
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* ignore */ }
    const open_id = String(body.open_id || '')
    const publish_id = String(body.publish_id || '')
    if (!open_id || !publish_id) return json({ error: 'open_id et publish_id requis' }, 400)
    const ft = await freshToken(open_id)
    if ('error' in ft) return json({ error: ft.error }, 400)
    const acc = { access_token: ft.token }
    const r = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${acc.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id }),
    })
    const j = await r.json().catch(() => ({}))
    return json({ http: r.status, data: j.data, error: j.error })
  }

  return json({ error: 'action inconnue' }, 400)
})
