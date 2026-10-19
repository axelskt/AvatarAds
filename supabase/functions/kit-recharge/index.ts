// Recharge du kit de publication (16/10/2026, Axel : « un seul stock pour tout le monde », les comptes d'Axel servis en
// premier). Le kit garde 7 JOURS D'AVANCE : pour chaque compte Instagram, les créneaux vides entre son dernier post
// (à programmer / programmé / publié) et J+7 (heure de Paris, jour J+7 compris) sont remplis avec des vidéos du STOCK
// COMMUN BloxAI (missions « open », plus anciennes d'abord), retirées du stock (status 'kit') AVANT d'entrer dans
// factory_posts. Tout le reste du stock reste ouvert aux diffuseurs.
//  · créneaux : @avataradss à 12-14-16-18-20 h, @leoadsia à 12-16-20 h (Axel 16/10), @ialebd.axel à 11-13-15-17-19 h (comme valider.py), jamais à
//    moins d'une heure (le temps de programmer) ; un trou AVANT le dernier post n'est jamais comblé ;
//  · choix créneau par créneau, tous comptes mêlés dans l'ordre du temps : jamais la même photo (parlées) / réaction (sans
//    voix) que le post précédent du compte, de préférence en alternant parlé / sans voix, sinon la plus ancienne ; si rien
//    ne convient, le compte s'arrête là (pas de trou : la prochaine recharge repart de son dernier post) ;
//  · légende = le CTA de la vidéo (cap() de usine/lots/valider.py), combo = recette + vf (clé de jointure factory_qc) ;
//  · 17/10 (audit S-USINE-1 / BRIDGE-3, contrat 9) : de BloxAI on ne garde QUE le numéro VF. L'adresse de la vidéo et la
//    recette sont RELUES dans factory_qc (AvatarAds) : fiche « approved », adresse = exactement
//    …/object/public/factory-media/stock/<VF>_<nom>.mp4 (le fichier de CE numéro, ni final/, ni « ? # % \ ' »). Sans fiche,
//    adresse hors de cette forme, ou adresse envoyée par BloxAI différente → vidéo ignorée (signalée), jamais retirée du
//    stock ni écrite dans le kit : une base BloxAI compromise ne peut plus faire supprimer (factory-release, refaire.py) un
//    autre fichier d'AvatarAds, ni glisser du SQL dans les scripts de l'usine ;
//  · kit_withdraw est atomique côté BloxAI et ne renvoie que les vidéos vraiment retirées : seules celles-là sont écrites.
//    Une vidéo prise entre-temps par un diffuseur est remplacée au tour suivant (3 tours au plus) ; une vidéo retirée mais
//    non placée, ou dont l'écriture est refusée, est RENDUE au stock (admin_mission reopen, permis par BloxAI dans les
//    15 min qui suivent le retrait : la même recharge).
//  · 17/10 (revue) — jamais deux fois, jamais perdue :
//    - journal des retraits (factory_kit_pending) : chaque vidéo y est notée AVANT kit_withdraw, effacée une fois écrite
//      dans le kit ou rendue au stock. Ce qui reste (réponse de BloxAI perdue, fonction coupée, écriture sans réponse,
//      remise au stock en échec) est repris au début de chaque recharge suivante, après 10 min : vidéo avec un post dans
//      le kit (tout statut sauf « skipped ») → jamais rendue ; sans post → kit_return (16/10 : bx_kit_return côté BloxAI,
//      sans la limite des 15 min de admin_mission reopen, qui laissait bloquée en 'kit' une vidéo reprise la nuit
//      suivante) : une mission encore 'kit' redevient 'open', tout autre statut est laissé tel quel. La ligne du journal
//      n'est effacée que si la vidéo est de nouveau 'open' ou inconnue de BloxAI ('absent') ; sinon elle reste ;
//    - dans le doute, rien n'est rendu : une vidéo bloquée en 'kit' est reprise plus tard, un doublon (kit ET stock
//      ouvert aux diffuseurs) ne se rattrape pas ;
//    - une vidéo du stock déjà dans le kit (à programmer / programmée / publiée) est retirée du stock (kit_withdraw) ;
//    - le bail est reconfirmé juste avant l'écriture : une recharge trop longue, doublée par une autre, n'écrit rien.
// Appels : pg_cron quotidien (kit_recharge_now(), en-tête x-cron-key = secret CRON_SECRET), le kit après « N vidéos
// programmées » (session propriétaire ; 17/10 : is_owner seul, plus le plan « developer »), valider.py (« select kit_recharge_now() »). POST (ou GET) ; ?dry=1 =
// simulation : rien n'est retiré ni écrit, le plan est renvoyé. Bail de 3 min (kit_recharge_lease, migration
// 20261016200000) : deux recharges simultanées ne remplissent jamais deux fois les mêmes créneaux.
// Secrets : BLOXAI_FACTORY_KEY (= FACTORY_KEY de BloxAI, en-tête x-factory-key), BLOXAI_FACTORY_URL (facultatif),
// CRON_SECRET. La clé ne sort jamais (messages d'erreur nettoyés). verify_jwt = false (config.toml) : garde dans le code.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'

const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const PUB = SB_URL + '/storage/v1/object/public/factory-media/'
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const FACTORY_URL = Deno.env.get('BLOXAI_FACTORY_URL') || 'https://rlkcyrldkwutyjymjcxi.supabase.co/functions/v1/factory'
const FACTORY_KEY = Deno.env.get('BLOXAI_FACTORY_KEY') || ''
const TZ = 'Europe/Paris'
// Axel 16/10 : @leoadsia plafonne (aucune vidéo au-dessus de 167 vues) → 3 posts par jour (12-16-20 h) au lieu de 5
export const HRS: Record<string, number[]> = { avataradss: [12, 14, 16, 18, 20], leoadsia: [12, 16, 20], 'ialebd.axel': [11, 13, 15, 17, 19] }
export const ACCOUNTS = Object.keys(HRS)
export const DAYS = 7                      // J+7 compris
export const LEAD_MS = 60 * 60 * 1000      // pas de créneau à moins d'une heure
const PARKED = '2090-01-01T00:00:00Z'      // posts « garés » en 2099 par un script coupé : ignorés (comme valider.py)
const ROUNDS = 3
const LEASE_S = 180
const STOCK_LIMIT = 200
const TIMEOUT_MS = 25000
const PENDING_GRACE_MS = 10 * 60 * 1000    // un retrait du journal n'est repris qu'après 10 min (plus long qu'une recharge)
const ACTIVE = ['todo', 'scheduled', 'published']   // un post du kit qui « tient » sa vidéo

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

let _svc: SupabaseClient | null = null
const svc = (): SupabaseClient => _svc ??= createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false, autoRefreshToken: false } })

function sameKey(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

async function ownerOk(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return false
  try {
    const { data: { user }, error } = await svc().auth.getUser(jwt)
    if (error || !user) return false
    const { data, error: e2 } = await svc().from('profiles').select('is_owner').eq('id', user.id).maybeSingle()
    if (e2 || !data) return false
    return data.is_owner === true   // 17/10 (contrat 10, comme l'edge bloxai) : plus le plan « developer »
  } catch { return false }
}

// ── Heure de Paris (changements d'heure compris) ──────────────────────────────────────────────────────────────────────
const PF = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
function parts(ms: number): Record<string, number> {
  const o: Record<string, number> = {}
  for (const p of PF.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return o
}
const pad = (n: number) => (n < 10 ? '0' : '') + n
// décalage de Paris sur UTC à cet instant, en minutes (+60 en hiver, +120 en été)
function offsetMin(ms: number): number {
  const p = parts(ms)
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000
}
export function parisDate(ms: number): string { const p = parts(ms); return p.year + '-' + pad(p.month) + '-' + pad(p.day) }
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
// AAAA-MM-JJ + heure pleine de Paris → instant UTC (ms)
export function parisToUtc(day: string, hour: number): number {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, hour)
  let t = guess - offsetMin(guess) * 60000
  t = guess - offsetMin(t) * 60000
  return t
}
const fr = (ms: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, ...o }).format(new Date(ms))
const dayLabel = (day: string) => fr(parisToUtc(day, 12), { weekday: 'long', day: 'numeric', month: 'long' })

// Créneaux vides d'un compte : après son dernier post (ou maintenant + 1 h), jusqu'au jour J+7 compris (Paris).
export function slotsFor(account: string, lastMs: number | null, nowMs: number): number[] {
  const from = Math.max(lastMs ?? -Infinity, nowMs + LEAD_MS)
  const end = addDays(parisDate(nowMs), DAYS)
  const out: number[] = []
  for (let day = parisDate(from); day <= end; day = addDays(day, 1)) {
    for (const h of HRS[account] || []) { const t = parisToUtc(day, h); if (t > from) out.push(t) }
  }
  return out
}

// ── Règles du kit (mêmes que valider.py / equilibrer.py) ─────────────────────────────────────────────────────────────
type Combo = Record<string, unknown>
export type Kind = 'o' | 'm'   // o = parlée (F03), m = sans voix (F05)
export const kindOf = (c?: Combo | null): Kind => (c && c.format === 'F05' ? 'm' : 'o')
// « photo » au sens du kit : la photo d'avatar (parlée) ou la réaction (sans voix)
export function unitOf(c?: Combo | null): string | null {
  const v = kindOf(c) === 'm' ? c?.reaction : c?.photo
  return typeof v === 'string' && v ? v : null
}
// légende = le CTA de la vidéo (café, CLAUDE, SITE), sans hashtag ni nom de fournisseur — port de cap() (valider.py) ;
// les jetons de la recette (cta, contenu) complètent le nom du fichier s'il ne les porte pas.
export function cap(name: string, c?: Combo | null): string {
  const s = '_' + [name, c?.cta, c?.contenu].filter((x) => typeof x === 'string' && x).join('_') + '_'
  if (s.includes('_CTA-cafe_')) return "Tu peux toi aussi faire la même chose pour seulement un café par jour. Commente « SITE » et je t'envoie le lien en privé."
  if (kindOf(c) === 'm' && (s.includes('_C-MCPM-') || s.includes('_C-MCM-') || [5, 6, 7].some((k) => s.includes('_C-OMNIM-0' + k + '_')))) {
    return "Commente « CLAUDE » et je t'envoie le lien en privé."
  }
  if (s.includes('_CTA-CLAUDE_')) return "Commente « CLAUDE » et je t'envoie le lien en privé pour faire la même chose."
  return "Écris « SITE » en commentaire et je t'envoie le tutoriel complet gratuitement pour faire la même chose."
}

export type Item = { vf: string, video_url: string, combo: Combo }
export type Prev = { unit: string | null, kind: Kind | null, logo?: boolean }
// 19/10 (Axel : « faudra bien tout répartir ») : vidéo à texte choc LOGOS (TH27 / TH36) — jamais deux à la suite sur un compte
export const LOGO_TH = new Set(['TH27', 'TH36'])
export const isLogo = (c?: Combo | null): boolean => !!c && typeof c.texte_choc === 'string' && LOGO_TH.has(c.texte_choc as string)
export type Pick = { account: string, at: number, item: Item }
export type Plan = { picks: Pick[], stopped: Record<string, { at: number, why: string, left: number }> }

const dec = (s: string) => { try { return decodeURIComponent(s) } catch { return '' } }
export type Ignored = { vf: string, why: string }
// Vidéos du stock (liste de BloxAI) : seul le numéro VF-0000 est gardé, une seule fois. L'adresse envoyée par BloxAI ne
// sert qu'à vérifier qu'elle est la même que celle d'AvatarAds (sent) ; rien d'autre de BloxAI n'est lu (17/10).
export function normItems(list: unknown[]): { items: { vf: string, sent: string | null }[], ignored: Ignored[] } {
  const items: { vf: string, sent: string | null }[] = [], ignored: Ignored[] = [], seen = new Set<string>()
  for (const x of list) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const vf = typeof o.vf === 'string' ? o.vf : ''
    if (!/^VF-[0-9]{4}$/.test(vf)) { ignored.push({ vf: vf.slice(0, 20) || '?', why: 'identifiant VF illisible' }); continue }
    if (seen.has(vf)) continue
    seen.add(vf)
    items.push({ vf, sent: typeof o.video_url === 'string' ? o.video_url : null })
  }
  return { items, ignored }
}
// Adresse d'une vidéo du stock commun, forme EXACTE (17/10, contrat 9) : …/factory-media/stock/<VF>_<nom>.mp4, nom en
// [A-Za-z0-9._-] — chaîne brute, sans décodage : « ? # % \\ ' », sous-dossier, autre bucket ou fichier d'un autre numéro
// sont refusés.
export function stockUrlOk(url: unknown, vf: string, pub: string = PUB): boolean {
  if (typeof url !== 'string' || !/^VF-[0-9]{4}$/.test(vf) || url.length > 400) return false
  const pre = pub + 'stock/'
  if (!url.startsWith(pre)) return false
  const name = url.slice(pre.length)
  return name.startsWith(vf + '_') && /^[A-Za-z0-9._-]+\.mp4$/.test(name) && !name.includes('..')
}
export type QcRow = { template: string, video_url: string | null, brick_combo: unknown }
// Vidéos du stock → ce que le kit écrit, RELU dans factory_qc (fiches « approved » de ces numéros) : adresse et recette
// d'AvatarAds, jamais celles de BloxAI. Sans fiche unique, adresse hors forme ou différente de celle de BloxAI → ignorée.
export function fromQc(list: { vf: string, sent: string | null }[], rows: QcRow[], pub: string = PUB): { items: Item[], ignored: Ignored[] } {
  const by = new Map<string, QcRow[]>()
  for (const r of rows || []) if (r && typeof r.template === 'string') by.set(r.template, [...(by.get(r.template) || []), r])
  const items: Item[] = [], ignored: Ignored[] = []
  for (const x of list) {
    const rs = by.get(x.vf) || []
    if (!rs.length) { ignored.push({ vf: x.vf, why: 'aucune fiche validée dans factory_qc' }); continue }
    if (rs.length > 1) { ignored.push({ vf: x.vf, why: 'plusieurs fiches validées dans factory_qc (à vérifier)' }); continue }
    const r = rs[0], url = r.video_url
    if (!stockUrlOk(url, x.vf, pub)) { ignored.push({ vf: x.vf, why: 'fiche factory_qc hors de factory-media/stock/ (' + x.vf + '_….mp4 attendu)' }); continue }
    if (x.sent != null && x.sent !== url) { ignored.push({ vf: x.vf, why: 'adresse envoyée par BloxAI différente de factory_qc (à vérifier)' }); continue }
    const combo = r.brick_combo && typeof r.brick_combo === 'object' && !Array.isArray(r.brick_combo) ? r.brick_combo as Combo : {}
    items.push({ vf: x.vf, video_url: url as string, combo })
  }
  return { items, ignored }
}
async function readQc(vfs: string[]): Promise<QcRow[]> {
  const out: QcRow[] = []
  for (let i = 0; i < vfs.length; i += 200) {
    const { data, error } = await svc().from('factory_qc').select('template, video_url, brick_combo').in('template', vfs.slice(i, i + 200)).eq('status', 'approved')
    if (error) throw new Error('lecture de factory_qc : ' + scrub(error.message))
    out.push(...((data || []) as QcRow[]))
  }
  return out
}

// Choix créneau par créneau (tous comptes, ordre du temps), dans l'ordre du stock (le plus ancien d'abord).
export function planAll(slots: Record<string, number[]>, prev: Record<string, Prev>, pool: Item[]): Plan {
  const all: { a: string, at: number, ai: number }[] = []
  ACCOUNTS.forEach((a, ai) => (slots[a] || []).forEach((at) => all.push({ a, at, ai })))
  all.sort((x, y) => x.at - y.at || x.ai - y.ai)
  const left = pool.slice(), last: Record<string, Prev> = { ...prev }, picks: Pick[] = [], stopped: Plan['stopped'] = {}
  for (const s of all) {
    if (stopped[s.a]) { stopped[s.a].left++; continue }
    const p = last[s.a] || { unit: null, kind: null }
    let i = -1
    // d'abord photo différente + type alterné + pas deux vidéos à logos de suite ; puis photo différente + pas deux logos ;
    // enfin photo différente seulement
    for (const lvl of [2, 1, 0]) {
      i = left.findIndex((it) => {
        const u = unitOf(it.combo)
        if (u && p.unit && u === p.unit) return false
        if (lvl >= 1 && p.logo && isLogo(it.combo)) return false
        return !(lvl === 2 && p.kind && kindOf(it.combo) === p.kind)
      })
      if (i >= 0) break
    }
    if (i < 0) { stopped[s.a] = { at: s.at, why: left.length ? 'même photo / réaction que le post précédent' : 'stock vide', left: 1 }; continue }
    const it = left.splice(i, 1)[0]
    picks.push({ account: s.a, at: s.at, item: it })
    last[s.a] = { unit: unitOf(it.combo), kind: kindOf(it.combo), logo: isLogo(it.combo) }
  }
  return { picks, stopped }
}

// ── BloxAI (fonction factory) ─────────────────────────────────────────────────────────────────────────────────────────
function scrub(s: unknown): string {
  let m = String(s ?? '').slice(0, 400)
  if (FACTORY_KEY) m = m.split(FACTORY_KEY).join('***')
  if (CRON_SECRET) m = m.split(CRON_SECRET).join('***')
  return m.replace(/(x-factory-key|x-cron-key|apikey|authorization|bearer)\s*[:=]?\s*\S+/gi, '$1 ***').replace(/\bsb_(secret|publishable)_\S+/g, 'sb_***').slice(0, 300)
}
function factoryOk(): string | null {
  if (!FACTORY_KEY) return 'BLOXAI_FACTORY_KEY manquant (secret Supabase)'
  try { if (new URL(FACTORY_URL).protocol !== 'https:') return 'BLOXAI_FACTORY_URL doit être en https' } catch { return 'BLOXAI_FACTORY_URL illisible' }
  return null
}
class BxError extends Error {}
async function factory(action: string, args: Record<string, unknown>): Promise<unknown> {
  let r: Response
  try {
    r = await fetch(FACTORY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-factory-key': FACTORY_KEY },
      body: JSON.stringify({ action, ...args }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const n = (e as Error)?.name || ''
    throw new BxError(n === 'TimeoutError' || n === 'AbortError' ? 'BloxAI ne répond pas (délai dépassé)' : 'BloxAI injoignable')
  }
  const txt = await r.text().catch(() => '')
  let body: any = null
  try { body = txt ? JSON.parse(txt) : null } catch { body = null }
  if (r.ok && body != null && !(typeof body === 'object' && !Array.isArray(body) && body.error)) return body
  if (r.status === 401 || r.status === 403) throw new BxError('clé refusée par BloxAI (BLOXAI_FACTORY_KEY ≠ FACTORY_KEY)')
  if (r.status === 404 && !(body && body.error)) throw new BxError('fonction factory introuvable sur BloxAI (pas encore déployée ?)')
  if (body && body.error) throw new BxError('BloxAI : ' + scrub(typeof body.error === 'string' ? body.error : JSON.stringify(body.error)))
  throw new BxError(r.ok ? 'BloxAI : réponse illisible' : 'BloxAI : HTTP ' + r.status)
}
// La liste utile d'une réponse : à la racine ou rangée sous une clé, selon la version de factory.
export function listOf(body: any, keys: string[]): unknown[] | null {
  if (Array.isArray(body)) return body
  for (const k of keys) if (Array.isArray(body?.[k])) return body[k]
  for (const k of keys) if (Array.isArray(body?.data?.[k])) return body.data[k]
  return null
}
const STOCK_KEYS = ['items', 'stock', 'missions', 'rows', 'data', 'result']
const TAKEN_KEYS = ['taken', 'withdrawn', 'items', 'missions', 'rows', 'vfs', 'data', 'result']
export function takenOf(body: unknown): Set<string> | null {
  const l = listOf(body, TAKEN_KEYS)
  if (!l) return null
  return new Set(l.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as Record<string, unknown>).vf || '') : '')).filter(Boolean))
}
// ── Journal des retraits (factory_kit_pending, migration 20261016200000) ─────────────────────────────────────────────
// Noté AVANT kit_withdraw ; effacé quand la vidéo est écrite dans le kit, rendue au stock, ou pas prise par nous.
async function journalAdd(vfs: string[]): Promise<void> {
  if (!vfs.length) return
  const at = new Date(Date.now()).toISOString()
  const { error } = await svc().from('factory_kit_pending').upsert(vfs.map((vf) => ({ vf, at })), { onConflict: 'vf' })
  if (error) throw new Error('journal des retraits indisponible (migration 20261016200000_kit_recharge appliquée ?) : ' + scrub(error.message))
}
// Effacement au mieux : une ligne restée est revérifiée par la recharge suivante (kit_return ne rend qu'une mission encore 'kit').
async function journalDrop(vfs: string[]): Promise<void> {
  if (!vfs.length) return
  try { await svc().from('factory_kit_pending').delete().in('vf', vfs) } catch { /* reprise à la recharge suivante */ }
}
// Rend des vidéos au stock (retirées mais pas écrites dans le kit) ; celles rendues sortent du journal.
async function giveBack(vfs: string[]): Promise<{ returned: string[], failed: string[] }> {
  const returned: string[] = [], failed: string[] = []
  for (const vf of vfs) {
    try { await factory('admin_mission', { vf, op: 'reopen' }); returned.push(vf) } catch { failed.push(vf) }
  }
  await journalDrop(returned)
  return { returned, failed }
}
// 16/10 — réponse de kit_return ({ ok, data: { by_vf: { 'VF-0001': 'open', … } } }) : le statut de chaque mission APRÈS la
// remise ('open', 'absent' = inconnue de BloxAI, sinon son statut inchangé). Rangée sous data.by_vf, by_vf ou data selon
// la version de factory ; null si illisible (rien n'est alors effacé du journal).
const VF_RE = /^VF-[0-9]{4}$/
export function kitReturnOf(body: any): Record<string, string> | null {
  const isMap = (c: unknown): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c)
  let m: Record<string, unknown> | null = null
  for (const c of [body?.data?.by_vf, body?.by_vf]) if (isMap(c)) { m = c; break }
  if (!m && isMap(body?.data) && Object.keys(body.data).length && Object.keys(body.data).every((k) => VF_RE.test(k))) m = body.data
  if (!m) return null
  const out: Record<string, string> = {}
  for (const [vf, v] of Object.entries(m)) {
    const s = typeof v === 'string' ? v : isMap(v) && typeof v.status === 'string' ? v.status : ''
    if (VF_RE.test(vf) && s) out[vf] = s
  }
  return out
}
// Retraits restés en suspens depuis plus de 10 min : repris AVANT tout (même kit plein). Dans le doute, la ligne reste.
type Rec = { returned: string[], kept: string[], error?: string }
async function reconcile(nowMs: number): Promise<Rec> {
  const out: Rec = { returned: [], kept: [] }
  const { data, error } = await svc().from('factory_kit_pending').select('vf')
    .lt('at', new Date(nowMs - PENDING_GRACE_MS).toISOString()).order('at').limit(100)
  if (error) { out.error = 'journal des retraits illisible : ' + scrub(error.message); return out }
  const vfs = ((data || []) as { vf: string }[]).map((x) => x.vf).filter((vf) => VF_RE.test(vf))
  if (!vfs.length) return out
  // 1) vidéo devenue un post du kit (tout statut sauf « skipped »), ou dont le fichier du stock a déjà été libéré
  //    (factory-release) : jamais rendue, elle reste 'kit' côté BloxAI ; sa ligne du journal est effacée
  const { data: ps, error: e2 } = await svc().from('factory_posts').select('vf:combo->>vf, status, video_url, video_deleted_at').in('combo->>vf', vfs)
  if (e2) { out.kept = vfs; out.error = 'lecture du kit : ' + scrub(e2.message); return out }
  const done = new Set<string>()
  for (const p of (ps || []) as { vf: string | null, status: string, video_url: string | null, video_deleted_at: string | null }[]) {
    if (p.vf && (p.status !== 'skipped' || (p.video_deleted_at && /\/factory-media\/stock\//.test(String(p.video_url || ''))))) done.add(p.vf)
  }
  const rest = vfs.filter((vf) => !done.has(vf))
  if (rest.length) {
    // 2) 16/10 — kit_return (bx_kit_return) : une mission encore 'kit' redevient 'open', sans limite de temps (admin_mission
    //    reopen la refuse 15 min après le retrait) ; une mission prise par un diffuseur, retirée par Axel ou jamais retirée
    //    est laissée telle quelle. Idempotent : rejoué sans risque à chaque recharge tant que la ligne reste.
    let by: Record<string, string> | null = null
    try { by = kitReturnOf(await factory('kit_return', { vfs: rest })) } catch (e) { out.error = (e as Error).message }
    if (!by) { out.kept = rest; out.error = out.error || 'BloxAI : réponse de la remise au stock illisible'; await journalDrop([...done]); return out }
    for (const vf of rest) {
      const s = by[vf]
      if (s === 'open') { out.returned.push(vf); done.add(vf) }   // de nouveau dans le stock commun (ou retrait jamais arrivé)
      else if (s === 'absent') done.add(vf)                       // inconnue de BloxAI : rien à rendre
      // revue 16/10 : prise par un diffuseur / publiée / retirée par Axel → plus rien à rendre (aucun post du kit, vérifié en 1) :
      // gardée, la ligne serait rejouée à chaque recharge pour toujours
      else if (s === 'assigned' || s === 'done' || s === 'retired') done.add(vf)
      else out.kept.push(vf)                                      // encore 'kit' ou absente de la réponse : gardée
    }
  }
  await journalDrop([...done])
  return out
}

// ── Résumé ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const plural = (n: number, s: string, p?: string) => n + ' ' + (n > 1 ? (p || s + 's') : s)
function summary(o: { dry: boolean, nowMs: number, slots: Record<string, number[]>, last: Record<string, number | null>, plan: Plan | null, stock: number | null }) {
  const until = addDays(parisDate(o.nowMs), DAYS)
  const accounts = ACCOUNTS.map((a) => {
    const posts = (o.plan?.picks || []).filter((p) => p.account === a)
      .map((p) => ({ at: new Date(p.at).toISOString(), vf: p.item.vf, kind: kindOf(p.item.combo) === 'm' ? 'sans voix' : 'parlée' }))
    const st = o.plan?.stopped[a]
    const slots = (o.slots[a] || []).length
    return { account: a, last: o.last[a] != null ? new Date(o.last[a] as number).toISOString() : null, slots, added: posts.length, empty: slots - posts.length,
      why: slots - posts.length > 0 ? (st ? st.why : 'stock vide') : null, posts }
  })
  const slots = accounts.reduce((s, x) => s + x.slots, 0), added = accounts.reduce((s, x) => s + x.added, 0), empty = slots - added
  let message: string
  if (!slots) message = 'Kit déjà plein jusqu’au ' + dayLabel(until) + '.'
  else if (o.dry) message = 'Simulation : ' + plural(added, 'vidéo') + ' sur ' + plural(slots, 'créneau', 'créneaux') + ' jusqu’au ' + dayLabel(until) + '.'
  else if (!added) message = (o.stock === 0 ? 'Stock commun vide : ' : 'Aucune vidéo compatible dans le stock : ') + plural(slots, 'créneau', 'créneaux') + ' à remplir.'
  else message = 'Kit rechargé : ' + plural(added, 'vidéo ajoutée', 'vidéos ajoutées') + ' jusqu’au ' + dayLabel(until)
    + (empty ? ', ' + plural(empty, 'créneau reste vide', 'créneaux restent vides') + ' (stock insuffisant).' : '.')
  return { dry: o.dry, at: new Date(o.nowMs).toISOString(), until, stock: o.stock, slots, added: o.dry ? 0 : added, planned: added, empty, accounts, message }
}

// ── Requête ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  // Corps lu AVANT toute réponse : un refus précoce sans lecture du corps fait attendre la passerelle (504 muet).
  let raw = ''
  if (req.method === 'POST') { try { raw = await req.text() } catch { raw = '' } }
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'POST attendu' }, 405)
  const isCron = !!CRON_SECRET && sameKey(req.headers.get('x-cron-key') || '', CRON_SECRET)
  if (!isCron && !(await ownerOk(req))) return json({ error: 'réservé au propriétaire' }, 401)
  let b: Record<string, unknown> = {}
  try { const p = raw ? JSON.parse(raw) : {}; if (p && typeof p === 'object' && !Array.isArray(p)) b = p } catch { /* corps facultatif */ }
  const dq = new URL(req.url).searchParams.get('dry')
  const dry = dq === '1' || dq === 'true' || b.dry === true
  const bad = factoryOk()
  if (bad) return json({ error: bad }, 500)

  let holder = ''
  if (!dry) {
    holder = crypto.randomUUID()
    const { data, error } = await svc().rpc('kit_recharge_lease', { p_holder: holder, p_seconds: LEASE_S })
    if (error) return json({ error: 'verrou de recharge indisponible (migration 20261016200000_kit_recharge appliquée ?) : ' + scrub(error.message) }, 500)
    if (data !== true) return json({ error: 'recharge déjà en cours', busy: true }, 409)
  }
  try {
    return await run(dry, holder)
  } catch (e) {
    return json({ error: e instanceof BxError ? e.message : 'recharge du kit : ' + scrub((e as Error)?.message || e) }, e instanceof BxError ? 502 : 500)
  } finally {
    if (holder) { try { await svc().rpc('kit_recharge_lease', { p_holder: holder, p_seconds: 0 }) } catch { /* le bail expire seul */ } }
  }
}

// Bail reconfirmé juste avant d'écrire : faux si une autre recharge a pris la main (la nôtre a dépassé ses 3 min).
async function keepLease(holder: string): Promise<boolean> {
  try {
    const { data, error } = await svc().rpc('kit_recharge_lease', { p_holder: holder, p_seconds: LEASE_S })
    return !error && data === true
  } catch { return false }
}

async function run(dry: boolean, holder: string): Promise<Response> {
  const nowMs = Date.now()
  // 0) retraits restés en suspens (journal) : repris avant tout, même si le kit est déjà plein
  const rec: Rec = dry ? { returned: [], kept: [] } : await reconcile(nowMs)
  const left = new Set<string>(rec.kept)   // vidéos encore à revérifier (journal) à la fin de cette recharge
  const tail = (o: Record<string, unknown>) => {
    const to_check = [...left]
    const out: Record<string, unknown> = { ...o, to_check }
    if (rec.returned.length || rec.kept.length || rec.error) out.reconciled = { returned: rec.returned, kept: rec.kept, ...(rec.error ? { error: rec.error } : {}) }
    if (typeof out.message === 'string') {
      if (rec.returned.length) out.message += ' ' + plural(rec.returned.length, 'vidéo', 'vidéos') + ' d’un retrait interrompu de nouveau dans le stock commun.'
      if (to_check.length) out.message += ' ' + plural(to_check.length, 'vidéo', 'vidéos') + ' à revérifier (retrait interrompu) : la prochaine recharge s’en charge.'
    }
    return out
  }
  const fail = (error: string, status: number, o: Record<string, unknown> = {}) => json(tail({ error, ...o }), status)

  // une erreur imprévue garde le bilan du journal dans la réponse (rien n’est perdu de vue)
  try {
    // 1) dernier post de chaque compte (à programmer / programmé / publié ; jamais un post garé en 2099)
    const last: Record<string, number | null> = {}, prev: Record<string, Prev> = {}, slots: Record<string, number[]> = {}
    const lasts = await Promise.all(ACCOUNTS.map((a) => svc().from('factory_posts').select('scheduled_at, combo')
      .eq('platform', 'instagram').eq('account', a).in('status', ACTIVE).lt('scheduled_at', PARKED)
      .order('scheduled_at', { ascending: false }).limit(1)))
    for (let i = 0; i < ACCOUNTS.length; i++) {
      const a = ACCOUNTS[i], r = lasts[i]
      if (r.error) throw new Error('lecture du kit : ' + r.error.message)
      const row = (r.data || [])[0] as { scheduled_at: string, combo: Combo | null } | undefined
      last[a] = row ? Date.parse(row.scheduled_at) : null
      prev[a] = row ? { unit: unitOf(row.combo), kind: kindOf(row.combo), logo: isLogo(row.combo) } : { unit: null, kind: null }
      slots[a] = slotsFor(a, last[a], nowMs)
    }
    if (!ACCOUNTS.some((a) => slots[a].length)) return json(tail({ ok: true, ...summary({ dry, nowMs, slots, last, plan: null, stock: null }), ignored: [] }))

    // 2) stock commun (plus anciennes d'abord), filtré ; une vidéo déjà dans le kit n'y entre jamais deux fois
    const sl = listOf(await factory('stock_list', { limit: STOCK_LIMIT }), STOCK_KEYS)
    if (!sl) throw new BxError('BloxAI : liste du stock illisible')
    // 17/10 (contrat 9) : de BloxAI, seul le numéro ; adresse + recette relues dans factory_qc
    const nv = normItems(sl)
    const fq = nv.items.length ? fromQc(nv.items, await readQc(nv.items.map((x) => x.vf))) : { items: [] as Item[], ignored: [] as Ignored[] }
    const all = fq.items, ignored = [...nv.ignored, ...fq.ignored], nStock = nv.items.length   // stock annoncé par BloxAI (message « vide »)
    let items = all
    const realigned: string[] = []
    if (all.length) {
      const { data, error } = await svc().from('factory_posts').select('vf:combo->>vf')
        .in('combo->>vf', all.map((x) => x.vf)).in('status', ACTIVE)
      if (error) throw new Error('lecture du kit : ' + error.message)
      const dup = [...new Set((data || []).map((x: { vf: string | null }) => x.vf).filter(Boolean) as string[])]
      if (dup.length) {
        items = all.filter((x) => !dup.includes(x.vf))
        // déjà dans le kit d'Axel MAIS encore ouverte aux diffuseurs : retirée du stock (atomique : seulement si encore « open »)
        let note = ''
        if (!dry) {
          try {
            const t = takenOf(await factory('kit_withdraw', { vfs: dup }))
            if (t) realigned.push(...dup.filter((vf) => t.has(vf)))
            else note = 'réponse du retrait illisible'
          } catch (e) { note = (e as Error).message }
        }
        for (const vf of dup) {
          ignored.push({ vf, why: dry ? 'déjà dans le kit (sera retirée du stock commun)' : realigned.includes(vf) ? 'déjà dans le kit : retirée du stock commun'
            : note ? 'déjà dans le kit, encore dans le stock commun (' + note + ')' : 'déjà dans le kit et plus « open » dans le stock commun (prise par un diffuseur ?)' })
        }
      }
    }

    if (dry) {
      const plan = planAll(slots, prev, items)
      return json(tail({ ok: true, ...summary({ dry, nowMs, slots, last, plan, stock: nStock }), ignored }))
    }

    // 3) retrait atomique : on ne garde que ce que BloxAI a vraiment retiré ; une vidéo prise entre-temps par un diffuseur
    //    est remplacée au tour suivant. reserved = vidéos retirées pour nous, dans l'ordre où elles sont entrées dans le plan
    //    (le dernier plan est ainsi reproduit à l'identique avec elles seules). Chaque demande est notée au journal AVANT.
    const reserved: Item[] = [], mine = new Set<string>(), tried = new Set<string>()
    const vfsOf = (l: Item[]) => l.map((x) => x.vf)
    for (let round = 0; round < ROUNDS; round++) {
      const pool = [...reserved, ...items.filter((x) => !mine.has(x.vf) && !tried.has(x.vf))]
      const need = planAll(slots, prev, pool).picks.map((p) => p.item).filter((x) => !mine.has(x.vf))
      if (!need.length) break
      try { await journalAdd(vfsOf(need)) } catch (e) {
        const back = reserved.length ? await giveBack(vfsOf(reserved)) : { returned: [] as string[], failed: [] as string[] }
        back.failed.forEach((vf) => left.add(vf))
        return fail((e as Error).message + ' — rien n’a été ajouté au kit', 500, { returned: back.returned })
      }
      let taken: Set<string> | null = null, why = ''
      try { taken = takenOf(await factory('kit_withdraw', { vfs: vfsOf(need) })) } catch (e) { why = (e as Error).message }
      if (!taken) {
        // réponse perdue ou illisible : ces vidéos ont PU passer en 'kit' → gardées au journal, revérifiées plus tard
        const back = reserved.length ? await giveBack(vfsOf(reserved)) : { returned: [] as string[], failed: [] as string[] }
        ;[...back.failed, ...vfsOf(need)].forEach((vf) => left.add(vf))
        return fail((why || 'BloxAI : réponse du retrait illisible') + ' — rien n’a été ajouté au kit', 502, { returned: back.returned })
      }
      for (const x of items) if (taken.has(x.vf) && need.includes(x) && !mine.has(x.vf)) { reserved.push(x); mine.add(x.vf) }
      const missed = need.filter((x) => !taken!.has(x.vf))
      for (const x of missed) tried.add(x.vf)
      await journalDrop(vfsOf(missed))   // pas prises par nous : rien à rendre
      if (!missed.length) break
    }
    const plan = planAll(slots, prev, reserved)
    const placed = new Set(plan.picks.map((p) => p.item.vf))
    const spare = vfsOf(reserved).filter((vf) => !placed.has(vf))

    // 4) écriture dans le kit (une seule insertion : tout ou rien), seulement si le bail est toujours à nous
    if (plan.picks.length) {
      if (!(await keepLease(holder))) {
        vfsOf(reserved).forEach((vf) => left.add(vf))
        return fail('recharge trop longue, une autre recharge a pris la main — rien n’a été écrit dans le kit', 500, { returned: [] })
      }
      const rows = plan.picks.map((p) => ({
        scheduled_at: new Date(p.at).toISOString(), platform: 'instagram', account: p.account, video_url: p.item.video_url,
        caption: cap(dec(p.item.video_url.split('?')[0].split('/').pop() || ''), p.item.combo),
        combo: { ...p.item.combo, vf: p.item.vf }, status: 'todo',
      }))
      const { error, status } = await svc().from('factory_posts').insert(rows)
      if (error) {
        // Refus net de la base (4xx) : rien n'est écrit. Sans réponse (coupure, délai, 5xx) : l'insertion a PU passer →
        // rien n'est rendu maintenant (un doublon kit + stock ouvert ne se rattrape pas) ; le journal la revérifie plus tard.
        if (!(status >= 400 && status < 500)) {
          vfsOf(reserved).forEach((vf) => left.add(vf))
          return fail('écriture du kit sans réponse : ' + scrub(error.message) + ' — vidéos gardées hors du stock, revérifiées par la prochaine recharge', 500, { returned: [] })
        }
        const { data: got, error: e3 } = await svc().from('factory_posts').select('vf:combo->>vf')
          .in('combo->>vf', vfsOf(reserved)).in('status', ACTIVE)
        if (e3) {   // relecture impossible : dans le doute, rien n'est rendu
          vfsOf(reserved).forEach((vf) => left.add(vf))
          return fail('écriture du kit refusée : ' + scrub(error.message) + ' — relecture impossible, vidéos gardées hors du stock, revérifiées par la prochaine recharge', 500, { returned: [] })
        }
        const inKit = new Set((got || []).map((x: { vf: string | null }) => x.vf))
        await journalDrop(vfsOf(reserved).filter((vf) => inKit.has(vf)))
        const back = await giveBack(vfsOf(reserved).filter((vf) => !inKit.has(vf)))
        back.failed.forEach((vf) => left.add(vf))
        return fail('écriture du kit refusée : ' + scrub(error.message) + ' — vidéos rendues au stock', 500, { returned: back.returned })
      }
      await journalDrop([...placed])
    }
    const back = spare.length ? await giveBack(spare) : { returned: [] as string[], failed: [] as string[] }
    back.failed.forEach((vf) => left.add(vf))
    return json(tail({ ok: true, ...summary({ dry, nowMs, slots, last, plan, stock: nStock }), ignored,
      taken_by_others: [...tried], returned: back.returned, realigned }))
  } catch (e) {
    return fail(e instanceof BxError ? e.message : 'recharge du kit : ' + scrub((e as Error)?.message || e), e instanceof BxError ? 502 : 500)
  }
}

Deno.serve(handler)
