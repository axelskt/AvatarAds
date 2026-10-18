// BloxAI (16/10/2026, Axel : « un seul stock pour tout le monde ») : proxy du tableau de bord Creative Factory (onglet BloxAI)
// vers la fonction « factory » du projet BloxAI (rlkcyrldkwutyjymjcxi). La page ne parle qu'au projet AvatarAds (CSP) :
// c'est ICI que la clé partagée part vers BloxAI, jamais dans le navigateur.
//  GET  ?action=stats            → payload bx_factory_stats() tel quel (+ proxy_at, cached) ; cache mémoire 60 s
//                                  (&fresh=1 : relu tout de suite, après une action du tableau de bord)
//  POST { op, … }                → une action d'administration, liste blanche, champ par champ :
//       admin_publication { id, decision: refuse|validate|validate_frozen|reset, reason? }   (refuse : motif obligatoire)
//                         → { ok, pub } (16/10) : la ligne écrite par bx_admin_publication, champ par champ (statut, vues,
//                           motif, dates, repères de reseaux sous « flags ») : le message du tableau de bord part de
//                           l'état RÉEL après la décision, pas de la liste affichée avant le clic
//                         17/10 (audit AA-DASH-1, contrat 10) : un champ « views » est REFUSÉ (400), quelle que soit
//                           l'action : le nombre de vues vient du relevé de BloxAI, jamais d'un chiffre tapé (un
//                           « validate + views » sautait la garde ci-dessous et créditait n'importe quel solde)
//                         17/10 (round 5, contrat 5) : validate_frozen = « Valider avec les vues figées » : APRÈS la fin du
//                           suivi seulement, BloxAI (bx_admin_publication) valide avec SES vues figées (views_at_close, sinon
//                           les vues relevées) — aucun nombre ne part d'ici ; pour un lien retenu (pas relu dans les 48 h avant
//                           la fin, chaîne non vérifiée…) qu'un « validate » laisse retenu
//       admin_payout_paid { id, reference? }
//       admin_identity    { id, status: verified|refused, birthdate?, name?, reason? } (verified : date de naissance obligatoire,
//                                                                                     18 ans révolus, ET nom lu sur la pièce —
//                                                                                     17/10, round 5, contrat 9 : 2 à 120
//                                                                                     caractères, au moins une lettre — envoyé
//                                                                                     à factory sous « name » (p_name de
//                                                                                     bx_admin_identity = verified_name, comparé
//                                                                                     au titulaire de chaque versement) ;
//                                                                                     refused : motif obligatoire)
//                         → { ok, file_deleted } (17/10, audit BRIDGE-2) : true = copie supprimée du stockage BloxAI,
//                           false = pas supprimée (nouvel essai automatique côté BloxAI), null = BloxAI ne l'a pas dit
//       identity_url      { id }   → { url } URL signée (300 s) de la pièce d'identité, bucket privé BloxAI, hôte de
//                                     BLOXAI_FACTORY_URL seulement (17/10, audit BRIDGE-3)
//       admin_mission     { vf, decision: retire|reopen }
//       admin_payout_cancel { id, reason }   (18/10, round 7, R7-5) : « Annuler ce versement » → bx_admin_payout_cancel de
//                                            BloxAI (payout 'cancelled', motif gardé, le solde revient au diffuseur) ;
//                                            motif obligatoire ; refusé (409) si le versement n'est plus dans payouts_open
//                                            relu à l'instant (payé ou annulé sur un autre appareil : jamais un versement
//                                            payé remis au solde = payé deux fois)
//       admin_freeze      { user, on, reason }   (18/10, round 7, R7-5) : « Geler les versements » (on = true) /
//                                            « Dégeler » (on = false) d'un diffuseur → bx_admin_freeze ; user = uuid,
//                                            on = booléen ; motif obligatoire pour geler (le diffuseur le lit), facultatif
//                                            pour dégeler (bx_admin_freeze l'efface au dégel)
//  « decision » côté tableau de bord = « op » côté factory (le nom « op » est pris par l'action elle-même).
// 18/10 (round 7, R7-7) : garde de version — le tableau de bord envoie dash_version (= numéro ?v= de son cf-ui.js) dans
// chaque POST ; admin_payout_paid, admin_identity, admin_payout_cancel et admin_freeze sont refusés (409 « Recharge le
// tableau de bord ») si dash_version est absent ou < 89 : une page restée ouverte avant ces contrôles (alertes sur le
// titulaire, gel, nom lu sur la pièce…) ne peut plus payer, valider une pièce, annuler ni geler. dash_version n'est
// jamais relayé à BloxAI.
// Garde-fous (17/10, revue) vérifiés ICI sur l'état réel avant d'appeler BloxAI (refus 409 + message) :
//  · validate = « conforme » (revue 2) : BloxAI note checked_at, le lien RESTE en suivi et ses gains sont comptés à la fin
//    des tracking_days par bx_close_tracking, avec les vues figées ce jour-là (17/10 : seulement si le relevé les a relues
//    dans les 48 h avant ; sinon « En attente de vérification ») ; suivi déjà fini : validé tout de suite avec ses vues
//    figées. Toujours SANS nombre de vues (17/10 : champ « views » refusé). Accepté pour
//    tout lien « verif » présent dans to_check (18/10, round 6 : liens pas encore conformes du plus ancien au plus récent,
//    150 au plus, puis conformes retenus / signalés, 100 au plus, puis les 30 derniers refus), relu à l'instant : jamais
//    sur un refus (« reset » d'abord) ni sur un lien déjà traité ailleurs ;
//  · validate_frozen (17/10, round 5) : mêmes conditions, PLUS la fin du suivi (closes_at de BloxAI, relu à l'instant)
//    déjà passée ; fin inconnue → refusé ;
//  · admin_mission : retire seulement une vidéo « open » ; reopen seulement une vidéo « retired », jamais une vidéo du kit
//    d'Axel (post à programmer / programmé / publié, ou fichier du stock déjà libéré par factory-release).
// Propriétaire uniquement (17/10, contrat 10 : is_owner seul — le plan « developer » ne donne plus accès aux IBAN, pièces
// d'identité et versements des diffuseurs). Secrets : BLOXAI_FACTORY_KEY (= FACTORY_KEY de BloxAI, en-tête
// x-factory-key) et BLOXAI_FACTORY_URL (facultatif). La clé ne sort jamais : messages d'erreur nettoyés.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'

const FACTORY_URL = Deno.env.get('BLOXAI_FACTORY_URL') || 'https://rlkcyrldkwutyjymjcxi.supabase.co/functions/v1/factory'
const FACTORY_KEY = Deno.env.get('BLOXAI_FACTORY_KEY') || ''
const svc = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
const TTL = 60 * 1000
const TIMEOUT_MS = 25000
const MAX_BODY = 4096
let cache: { at: number, body: Record<string, unknown> } | null = null
const ACTIVE = ['todo', 'scheduled', 'published']   // un post du kit qui « tient » sa vidéo
// 18/10 (round 7, R7-7) : version minimale du tableau de bord pour les actions d'argent et d'identité
const DASH_MIN = 89
const DASH_GUARD = ['admin_payout_paid', 'admin_identity', 'admin_payout_cancel', 'admin_freeze']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function dashOk(b: Record<string, unknown>): boolean {
  const op = typeof b.op === 'string' ? b.op : ''
  if (!DASH_GUARD.includes(op)) return true
  const v = b.dash_version
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= DASH_MIN
}
const MST: Record<string, string> = { open: 'dans le stock commun', assigned: 'en mission', done: 'publiée par un diffuseur', kit: 'passée au kit', retired: 'retirée' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function ownerOk(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return false
  try {
    const { data: { user }, error } = await svc.auth.getUser(jwt)
    if (error || !user) return false
    const { data, error: e2 } = await svc.from('profiles').select('is_owner').eq('id', user.id).maybeSingle()
    if (e2 || !data) return false
    return data.is_owner === true   // 17/10 (contrat 10) : plus le plan « developer »
  } catch { return false }
}

// Jamais la clé ni l'URL complète dans un message renvoyé au navigateur.
function scrub(s: unknown): string {
  let m = String(s ?? '').slice(0, 400)
  if (FACTORY_KEY) m = m.split(FACTORY_KEY).join('***')
  return m.replace(/(x-factory-key|apikey|authorization|bearer)\s*[:=]?\s*\S+/gi, '$1 ***').replace(/\bsb_(secret|publishable)_\S+/g, 'sb_***').slice(0, 300)
}
function factoryOk(): string | null {
  if (!FACTORY_KEY) return 'BLOXAI_FACTORY_KEY manquant (secret Supabase)'
  try {
    const u = new URL(FACTORY_URL)
    if (u.protocol !== 'https:') return 'BLOXAI_FACTORY_URL doit être en https'
  } catch { return 'BLOXAI_FACTORY_URL illisible' }
  return null
}

// Appel de la fonction factory de BloxAI (POST JSON { action, … }, en-tête x-factory-key).
async function factory(action: string, args: Record<string, unknown>): Promise<{ ok: boolean, status: number, body: any, error?: string }> {
  let r: Response
  try {
    r = await fetch(FACTORY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-factory-key': FACTORY_KEY },
      body: JSON.stringify({ action, ...args }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as Error)?.name || ''
    return { ok: false, status: 504, body: null, error: name === 'TimeoutError' || name === 'AbortError' ? 'BloxAI ne répond pas (délai dépassé)' : 'BloxAI injoignable' }
  }
  const txt = await r.text().catch(() => '')
  let body: any = null
  try { body = txt ? JSON.parse(txt) : null } catch { body = null }
  if (r.ok && body && typeof body === 'object' && !body.error) return { ok: true, status: r.status, body }
  let error: string
  if (r.status === 401 || r.status === 403) error = 'clé refusée par BloxAI (BLOXAI_FACTORY_KEY ≠ FACTORY_KEY)'
  else if (r.status === 404 && !(body && body.error)) error = 'fonction factory introuvable sur BloxAI (pas encore déployée ?)'
  else if (body && body.error) error = 'BloxAI : ' + scrub(typeof body.error === 'string' ? body.error : JSON.stringify(body.error))
  else if (r.ok) error = 'BloxAI : réponse illisible'
  else error = 'BloxAI : HTTP ' + r.status
  return { ok: false, status: r.status, body, error }
}

// Entiers positifs (identifiants bigint) : nombre ou chaîne de chiffres, jamais au-delà de 2^53.
function posId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,16}$/.test(v) ? Number(v) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : ''
}
// Date de naissance AAAA-MM-JJ réelle, entre 1900 et aujourd'hui.
function birth(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(v + 'T00:00:00Z')
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null
  if (v < '1900-01-01' || d.getTime() > Date.now()) return null
  return v
}
// 18 ans révolus à la date du jour (UTC) — 17/10 (contrat 7, art. 4.2) : le titulaire du compte est toujours un adulte ;
// BloxAI (bx_admin_identity) refuse aussi la validation d'une pièce de moins de 18 ans.
function majeur(v: string): boolean {
  const t = new Date(Date.now()), [y, m, d] = v.split('-').map(Number)
  const ty = t.getUTCFullYear(), tm = t.getUTCMonth() + 1, td = t.getUTCDate()
  return ty - y > 18 || (ty - y === 18 && (tm > m || (tm === m && td >= d)))
}
// 17/10 (round 5, contrat 9) : nom lu par Axel sur la pièce d'identité → verified_name de BloxAI. Texte seul : caractères de
// contrôle et espaces multiples ramenés à une espace, 2 à 120 caractères (jamais coupé : trop long = refusé), au moins une
// lettre (toutes écritures). Contrôles C1 et séparateurs U+2028 / U+2029 aussi ramenés à une espace (factory les refuse :
// jamais un nom que BloxAI rejetterait).
function nameOf(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 400) return null
  const n = text(v.replace(/[\u0080-\u009f\u2028\u2029]+/g, ' '), 400).replace(/\s+/g, ' ')
  return n.length >= 2 && n.length <= 120 && /\p{L}/u.test(n) ? n : null
}

// Une action du tableau de bord → corps envoyé à factory, construit champ par champ (rien d'autre ne passe).
function buildAction(b: Record<string, unknown>): { action: string, args: Record<string, unknown> } | { error: string } {
  const op = typeof b.op === 'string' ? b.op : ''
  // 17/10 (audit AA-DASH-1, contrat 10) : jamais de nombre de vues fourni par le navigateur, même nul
  if (Object.prototype.hasOwnProperty.call(b, 'views')) return { error: 'champ « views » refusé : les vues viennent du relevé de BloxAI' }
  if (op === 'admin_publication') {
    const id = posId(b.id), d = b.decision
    if (!id) return { error: 'identifiant de publication invalide' }
    if (d !== 'refuse' && d !== 'validate' && d !== 'validate_frozen' && d !== 'reset') return { error: 'décision invalide (refuse, validate, validate_frozen ou reset)' }
    const args: Record<string, unknown> = { id, op: d }
    if (d === 'refuse') {
      const reason = text(b.reason, 300)
      if (!reason) return { error: 'motif obligatoire pour refuser' }
      args.reason = reason
    }
    return { action: op, args }
  }
  if (op === 'admin_payout_paid') {
    const id = posId(b.id)
    if (!id) return { error: 'identifiant de versement invalide' }
    const reference = text(b.reference, 120)
    return { action: op, args: reference ? { id, reference } : { id } }
  }
  if (op === 'admin_identity') {
    const id = posId(b.id), st = b.status
    if (!id) return { error: 'identifiant de pièce invalide' }
    if (st !== 'verified' && st !== 'refused') return { error: 'statut invalide (verified ou refused)' }
    if (st === 'verified') {
      const bd = birth(b.birthdate)
      if (!bd) return { error: 'date de naissance obligatoire (AAAA-MM-JJ, réelle)' }
      if (!majeur(bd)) return { error: 'moins de 18 ans : pièce impossible à valider (contrat art. 4.2), refuse-la' }
      // 17/10 (round 5, contrat 9) : nom lu sur la pièce, obligatoire (sans lui, aucun contrôle titulaire ↔ pièce possible)
      const name = nameOf(b.name)
      if (!name) return { error: 'nom lu sur la pièce obligatoire pour valider (2 à 120 caractères, au moins une lettre)' }
      return { action: op, args: { id, status: st, birthdate: bd, name } }
    }
    const reason = text(b.reason, 300)
    if (!reason) return { error: 'motif obligatoire pour refuser' }
    return { action: op, args: { id, status: st, reason } }
  }
  if (op === 'identity_url') {
    const id = posId(b.id)
    if (!id) return { error: 'identifiant de pièce invalide' }
    return { action: op, args: { id } }
  }
  if (op === 'admin_mission') {
    const vf = typeof b.vf === 'string' && /^VF-[0-9]{4}$/.test(b.vf) ? b.vf : null, d = b.decision
    if (!vf) return { error: 'VF invalide (VF-0000)' }
    if (d !== 'retire' && d !== 'reopen') return { error: 'décision invalide (retire ou reopen)' }
    return { action: op, args: { vf, op: d } }
  }
  // 18/10 (round 7, R7-5) : annuler un versement (motif obligatoire) ; geler / dégeler les versements d'un diffuseur
  if (op === 'admin_payout_cancel') {
    const id = posId(b.id)
    if (!id) return { error: 'identifiant de versement invalide' }
    const reason = text(b.reason, 300)
    if (!reason) return { error: 'motif obligatoire pour annuler un versement' }
    return { action: op, args: { id, reason } }
  }
  if (op === 'admin_freeze') {
    const user = typeof b.user === 'string' && UUID.test(b.user) ? b.user.toLowerCase() : null
    if (!user) return { error: 'diffuseur invalide (identifiant attendu)' }
    if (typeof b.on !== 'boolean') return { error: '« on » attendu : true (geler) ou false (dégeler)' }
    const reason = text(b.reason, 300)
    if (b.on && !reason) return { error: 'motif obligatoire pour geler les versements' }
    return { action: op, args: reason ? { user, on: b.on, reason } : { user, on: b.on } }
  }
  return { error: 'action refusée' }
}

// Payload de stats : à la racine, ou rangé sous stats / data selon la version de factory.
function statsOf(body: any): Record<string, unknown> | null {
  const cands = [body, body?.stats, body?.data]
  for (const c of cands) {
    if (c && typeof c === 'object' && !Array.isArray(c) && (c.generated_at || c.stock)) return c as Record<string, unknown>
  }
  return null
}
// Ligne publications renvoyée par bx_admin_publication (factory : { ok, data: to_jsonb(ligne) }) → ce que le tableau de
// bord lit (cf-store bxPubRow), champ par champ ; jamais user_id, url, media_id ni le reste de metrics. Repères de reseaux
// (metrics) sous « flags », mêmes clés que to_check + same_account (16/10) ; une valeur reste « posée » comme pour
// bx_metric_flag de BloxAI (présente, ni null, ni false, ni vide) : objet, tableau ou texte trop long → true (détail perdu).
// 17/10 (contrat 3) : + held_since (lien « En attente de vérification » : suivi fini sans conforme d'Axel ou sans relevé des
// vues dans les 48 h avant la fin) ; la ligne porte aussi views_at_close (vues figées à la fin du suivi) et last_read_at.
// 17/10 (round 5, contrat 6) : + checked_views (vues au « conforme » d'Axel, comparées aux vues figées).
const FLAG_KEYS = ['missing_since', 'dup_of', 'too_old', 'same_account', 'yt_unverified', 'yt_channel', 'seen_views', 'published_at', 'held_since']
const PUB_ST = ['verif', 'valid', 'refus']
function flagVal(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : true
  if (typeof v === 'string') return v.length <= 64 ? v : true
  return true
}
function pubOf(body: any, id: number): Record<string, unknown> | null {
  const x = body?.data
  if (!x || typeof x !== 'object' || Array.isArray(x) || posId(x.id) !== id || !PUB_ST.includes(x.status)) return null
  const m = x.metrics && typeof x.metrics === 'object' && !Array.isArray(x.metrics) ? x.metrics : {}
  const n = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null
  const d = (v: unknown) => typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v)) ? v : null
  const flags: Record<string, unknown> = {}
  for (const k of FLAG_KEYS) if (k in m) flags[k] = flagVal(m[k])
  return { id, status: x.status, views: n(x.views), valid_views: n(x.valid_views), views_at_close: n(x.views_at_close), checked_views: n(x.checked_views), refusal_reason: text(x.refusal_reason, 300) || null,
    created_at: d(x.created_at), checked_at: d(x.checked_at), validated_at: d(x.validated_at), last_read_at: d(x.last_read_at), flags }
}
// URL signée d'une pièce : https, chemin de lecture signée du stockage, rien d'autre. 17/10 (audit BRIDGE-3) : sur l'hôte
// du projet BloxAI lui-même (celui de BLOXAI_FACTORY_URL, rlkcyrldkwutyjymjcxi.supabase.co), plus n'importe quel
// *.supabase.co.
const FACTORY_HOST = (() => { try { return new URL(FACTORY_URL).hostname } catch { return '' } })()
function signedUrl(body: any): string | null {
  const u = body?.url ?? body?.signed_url ?? body?.signedUrl ?? body?.data?.signedUrl
  if (typeof u !== 'string' || u.length > 2000) return null
  try {
    const x = new URL(u)
    if (x.protocol !== 'https:' || !FACTORY_HOST || x.hostname !== FACTORY_HOST || x.port || x.username || x.password || !x.pathname.startsWith('/storage/v1/object/sign/identity/')) return null
    return x.href
  } catch { return null }
}

// Chiffres BloxAI : cache de 60 s, ou relus tout de suite quand une décision dépend d'un statut qui bouge.
async function stats(fresh: boolean): Promise<{ st: Record<string, any> } | { error: string }> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return { st: cache.body }
  const r = await factory('stats', {})
  if (!r.ok) return { error: r.error || 'BloxAI illisible' }
  const st = statsOf(r.body)
  if (!st) return { error: 'BloxAI : statistiques illisibles (contrat bx_factory_stats)' }
  cache = { at: Date.now(), body: st }
  return { st }
}

// Refus si la décision ne correspond pas à l'état réel (409), ou si cet état est illisible (502) ; null = on peut appeler BloxAI.
type No = { error: string, status: number } | null
async function guard(action: string, g: Record<string, unknown>): Promise<No> {
  const no = (error: string): No => ({ error, status: 409 })
  if (action === 'admin_publication' && (g.op === 'validate' || g.op === 'validate_frozen')) {   // 17/10 : toujours (plus de « views » qui la sautait)
    // statut relu à l'instant : un refus fait sur un autre appareil, ou un lien déjà marqué conforme, ne doit pas être
    // repris par un « Valider » parti d'une liste vieille de 60 s (valider un refus le remettrait en suivi)
    const s = await stats(true)
    if ('error' in s) return { error: s.error, status: 502 }
    const row = (Array.isArray(s.st.to_check) ? s.st.to_check : []).find((x: any) => posId(x?.publication_id) === g.id)
    if (!row) return no('publication absente de la liste à vérifier (déjà vérifiée, validée ou refusée ?) : actualise le tableau de bord')
    if (row.status === 'refus') return no('publication refusée : « Remettre à vérifier » d’abord')
    if (row.status !== 'verif') return no('publication déjà ' + (row.status === 'valid' ? 'validée' : 'traitée'))
    // 17/10 (round 5, contrat 5) : vues figées = seulement après la fin du suivi (BloxAI le revérifie aussi)
    if (g.op === 'validate_frozen') {
      const end = typeof row.closes_at === 'string' ? Date.parse(row.closes_at) : NaN
      if (!Number.isFinite(end)) return no('fin du suivi inconnue : « Valider avec les vues figées » impossible, actualise le tableau de bord')
      if (end > Date.now()) return no('suivi des vues pas encore terminé : « Valider avec les vues figées » seulement après la fin du suivi')
    }
    return null
  }
  if (action === 'admin_mission') {
    const vf = String(g.vf), s = await stats(true)   // statut relu à l'instant : il bouge (diffuseurs, kit)
    if ('error' in s) return { error: s.error, status: 502 }
    const st = s.st.by_vf && typeof s.st.by_vf === 'object' ? s.st.by_vf[vf]?.status : undefined
    if (typeof st !== 'string') return no(vf + ' absente du stock commun BloxAI')
    if (g.op === 'retire' && st !== 'open') return no(vf + ' : seule une vidéo encore dans le stock commun peut être retirée (statut : ' + (MST[st] || st) + ')')
    if (g.op === 'reopen') {
      if (st !== 'retired') return no(vf + ' : seule une vidéo retirée à la main peut être remise dans le stock (statut : ' + (MST[st] || st) + ')')
      const { data, error } = await svc.from('factory_posts').select('status, video_url, video_deleted_at').eq('combo->>vf', vf)
      if (error) return { error: 'lecture du kit impossible : ' + scrub(error.message), status: 502 }
      const rows = (data || []) as { status: string, video_url: string | null, video_deleted_at: string | null }[]
      if (rows.some((p) => ACTIVE.includes(p.status))) return no(vf + ' est dans le kit d’Axel : jamais remise dans le stock commun')
      if (rows.some((p) => p.video_deleted_at && /\/factory-media\/stock\//.test(String(p.video_url || '')))) return no(vf + ' : fichier du stock déjà libéré, impossible de la remettre dans le stock')
    }
  }
  // 18/10 (round 7, R7-5) : annuler seulement un versement encore ouvert (payouts_open relu à l'instant) — un versement
  // marqué payé sur un autre appareil, puis « annulé » depuis une liste vieille de 60 s, rendrait l'argent au solde : payé
  // deux fois. BloxAI (bx_admin_payout_cancel) le revérifie aussi.
  if (action === 'admin_payout_cancel') {
    const s = await stats(true)
    if ('error' in s) return { error: s.error, status: 502 }
    const open = s.st.money && typeof s.st.money === 'object' && Array.isArray(s.st.money.payouts_open) ? s.st.money.payouts_open : []
    const row = open.find((x: any) => posId(x?.id) === g.id)
    if (!row) return no('versement absent des versements à faire (déjà payé ou annulé ?) : actualise le tableau de bord')
    if (row.status !== 'requested' && row.status !== 'pending') return no('versement ' + (row.status === 'paid' ? 'déjà payé' : row.status === 'cancelled' ? 'déjà annulé' : 'pas annulable') + ' : actualise le tableau de bord')
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  // Corps lu AVANT toute réponse : un refus précoce sans lecture du corps fait attendre la passerelle (504 muet).
  let raw = ''
  if (req.method === 'POST') { try { raw = await req.text() } catch { raw = '' } }
  if (!(await ownerOk(req))) return json({ error: 'réservé au propriétaire' }, 401)
  const bad = factoryOk()
  if (bad) return json({ error: bad }, 500)

  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    if ((q.get('action') || 'stats') !== 'stats') return json({ error: 'action refusée' }, 400)
    const fresh = q.get('fresh') === '1'
    if (!fresh && cache && Date.now() - cache.at < TTL) return json({ ...cache.body, proxy_at: new Date(cache.at).toISOString(), cached: true })
    const s = await stats(true)
    if ('error' in s) return json({ error: s.error }, 502)
    return json({ ...s.st, proxy_at: new Date(cache!.at).toISOString(), cached: false })
  }

  if (req.method !== 'POST') return json({ error: 'GET ou POST attendu' }, 405)
  if (raw.length > MAX_BODY) return json({ error: 'corps trop gros' }, 413)
  let b: Record<string, unknown>
  try {
    const p = JSON.parse(raw || '{}')
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('objet attendu')
    b = p as Record<string, unknown>
  } catch { return json({ error: 'JSON invalide' }, 400) }
  // 18/10 (round 7, R7-7) : page d'avant la version 89 (ou sans dash_version) → rien d'argent ni d'identité
  if (!dashOk(b)) return json({ error: 'Recharge le tableau de bord' }, 409)
  const built = buildAction(b)
  if ('error' in built) return json({ error: built.error }, 400)
  const refused = await guard(built.action, built.args)
  if (refused) return json({ error: refused.error }, refused.status)

  const r = await factory(built.action, built.args)
  if (!r.ok) return json({ error: r.error }, r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403 && r.status !== 404 ? 400 : 502)
  if (built.action === 'identity_url') {
    const url = signedUrl(r.body)
    if (!url) return json({ error: 'BloxAI : URL signée absente ou refusée' }, 502)
    return json({ ok: true, url })
  }
  // Une décision change les chiffres : la prochaine lecture repart de BloxAI.
  cache = null
  if (built.action === 'admin_publication') return json({ ok: true, pub: pubOf(r.body, built.args.id as number) })
  // 17/10 (audit BRIDGE-2, contrat 6) : la décision est enregistrée ; la copie de la pièce l'est-elle aussi ? (factory :
  // { ok, file_deleted, data }) — jamais « supprimée » par défaut
  if (built.action === 'admin_identity') {
    const fd = r.body?.file_deleted ?? r.body?.data?.file_deleted
    return json({ ok: true, file_deleted: fd === true ? true : fd === false ? false : null })
  }
  return json({ ok: true })
})
