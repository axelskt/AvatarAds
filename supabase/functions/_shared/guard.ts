// Garde-fous PARTAGÉS des edge functions — audit de sécurité du 05/09/2026.
//
//  • safeUpstream / safePath  : le `?path=` fourni par le client ne peut JAMAIS détourner l'hôte amont
//                               (C1/C2/C3 : `path=@evil.com/…` réécrivait l'autorité de l'URL et envoyait
//                               la clé fournisseur chez l'attaquant).
//  • authUser                 : session utilisateur obligatoire (la clé anon/publiable seule est refusée),
//                               jeton service_role = moteur de rendu (déjà vérifié par la passerelle).
//  • rateHit / hasRecentDebit : plafond serveur par utilisateur + preuve qu'un spend_credits a eu lieu
//                               juste avant un appel FACTURANT (H3 : le débit ne vivait que côté client).
//  • realIp                   : IP réelle (dernier segment de x-forwarded-for, posé par la passerelle).
//  • safeFetchHtml            : lecture d'un site utilisateur avec redirections revalidées (anti-SSRF).
//
// Toutes les fonctions à effet réseau/DB sont FAIL-OPEN sur erreur technique du limiteur (jamais bloquer
// un vrai client parce que la table de rate-limit est indisponible) et FAIL-CLOSED sur l'auth/l'URL.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// H3 : exigence de débit récent sur les appels facturants. Warn-only tant que DEBIT_ENFORCE≠'1'
// (secret Supabase) → on journalise les appels qui seraient refusés, puis on bascule sans redéploiement.
export const debitEnforce = (): boolean => (Deno.env.get('DEBIT_ENFORCE') ?? '0') === '1'   // lu à CHAQUE requête : un changement de secret s'applique sans attendre un redémarrage d'isolate
// Réservation (audit offensif 05/09) : le proxy TIRE le coût de chaque soumission sur l'op débitée (x-aa-op)
// et la RÈGLE quand la génération aboutit. RESERVE_ENFORCE=1 refuse (402) une réservation insuffisante ;
// à 0 (défaut) = MODE OMBRE : on journalise ce qu'on refuserait, sans bloquer. Le settle (op non
// remboursable une fois livrée) est TOUJOURS actif (il ne peut jamais bloquer un remboursement d'échec).
export const reserveEnforce = (): boolean => (Deno.env.get('RESERVE_ENFORCE') ?? '0') === '1'
export function opFromReq(req: Request): string { const v = (req.headers.get('x-aa-op') || '').trim(); return /^[0-9a-f-]{36}$/i.test(v) ? v : '' }
// L'en-tête x-aa-op est un simple INDICE (client). La VRAIE source = latest_open_op côté serveur → le
// settle/draw ne peut plus être contourné en omettant l'en-tête (audit #3 : refund-and-keep async).
export async function resolveOp(userId: string, req: Request): Promise<string> {
  // CRITICAL 2 (06/09) : l'indice x-aa-op N'EST PLUS pris verbatim. resolve_op ne le retient que si c'est une
  // op OUVERTE de l'utilisateur (sinon dernière op ouverte) → un id leurre/réglé/bidon ne détourne plus le
  // draw/settle, donc on ne peut plus laisser la vraie op « propre » pour la rembourser après livraison.
  const hinted = opFromReq(req)
  try { const { data } = await svc().rpc('resolve_op', { p_user: userId, p_hint: hinted || null }); return (data as string | null) || '' } catch { return '' }
}
// Tire p_cost sur la réservation. ok=false → reste insuffisant (op sous-évaluée). Fail-open sur erreur DB.
export async function drawReservation(userId: string, opId: string, cost: number): Promise<{ ok: boolean; remaining: number | null }> {
  try {
    const { data, error } = await svc().rpc('draw_reservation', { p_user: userId, p_op: opId, p_cost: Math.max(1, Math.ceil(cost)) })
    if (error) { console.warn('draw_reservation err (fail-open):', error.message); return { ok: true, remaining: null } }
    return { ok: data !== null, remaining: (data as number | null) }
  } catch { return { ok: true, remaining: null } }
}
// Rend un tirage quand l'AMONT a échoué (4xx/5xx à la soumission, ou statut FAILED au poll) : sans ça, le
// retry légitime (ex. 4K après un 503 Google, fréquent) re-tirait sur une réserve déjà à 0 → 402 sous
// RESERVE_ENFORCE=1. `cost` = ce qui avait été tiré ; 9999 = « restaure tout » (job async échoué, coût
// inconnu au poll — plafonné à `amount` par la RPC). No-op sur une op réglée/remboursée. Best-effort.
export async function releaseReservation(userId: string, req: Request, cost: number): Promise<void> {
  try {
    const opId = await resolveOp(userId, req); if (!opId) return
    await svc().rpc('release_reservation', { p_user: userId, p_op: opId, p_cost: Math.max(1, Math.ceil(cost)) })
  } catch { /* best-effort */ }
}
// Marque l'op livrée (non remboursable), idempotent. Best-effort (jamais bloquant).
export async function settleReservation(userId: string, opId: string): Promise<void> {
  try { await svc().rpc('settle_reservation', { p_user: userId, p_op: opId }) } catch { /* best-effort */ }
}
// Applique la réservation dans un proxy : tire `cost`, journalise, 402 seulement si enforce. Puis renvoie
// une fonction `settle()` à appeler quand la génération a abouti (soumission SYNC réussie, ou poll COMPLETED).
export async function applyReservation(o: { req: Request; userId: string; proxy: string; cost: number; label?: string }): Promise<Gate & { opId?: string }> {
  const opId = await resolveOp(o.userId, o.req)
  if (!opId) return { ok: true }   // aucune op ouverte (owner/dev) → billableGate a déjà géré le plancher
  const dr = await drawReservation(o.userId, opId, o.cost)
  if (!dr.ok) {
    console.warn(`[reserve] ${o.proxy} op=${opId} cost=${o.cost} ${o.label ?? ''} INSUFFISANT (enforce=${reserveEnforce()})`)
    if (reserveEnforce()) return { ok: false, status: 402, error: 'Réservation de crédits insuffisante pour cette génération.' }
  }
  return { ok: true, opId }
}

// Tire la réserve ENTIÈRE d'une op (soumission VIDÉO : une op = une génération). Ferme « N générations pour
// un débit » : une 2e soumission sur la même op trouve réserve 0 → 402. Fail-open sur erreur DB.
export async function applyReservationFull(o: { req: Request; userId: string; proxy: string; label?: string }): Promise<Gate & { opId?: string }> {
  const opId = await resolveOp(o.userId, o.req)
  if (!opId) return { ok: true }   // owner/dev : aucune op ouverte
  try {
    const { data, error } = await svc().rpc('draw_full_reservation', { p_user: o.userId, p_op: opId })
    if (error) { console.warn('draw_full err (fail-open):', error.message); return { ok: true, opId } }
    if (data !== true) {
      console.warn(`[reserve-full] ${o.proxy} op=${opId} ${o.label ?? ''} VIDE/RÉGLÉE (enforce=${reserveEnforce()})`)
      if (reserveEnforce()) return { ok: false, status: 402, error: 'Réservation de crédits insuffisante pour cette génération.' }
    }
  } catch { /* fail-open */ }
  return { ok: true, opId }
}

// ── Libération/règlement CIBLÉS (audit 06/09) — depuis que resolve_op exige reserve>0 (anti-réutilisation),
//    une op TIRÉE (reserve 0) n'est plus retrouvable par resolveOp → la libération sur échec ne rendait plus
//    rien = SUR-DÉBIT d'une génération ratée. On rend/règle donc l'op PRÉCISE (échec synchrone) ou l'op LIÉE
//    au job fournisseur (échec asynchrone), jamais « la dernière op ouverte » (qui rouvrait le refund-and-keep).
export async function releaseOp(userId: string, opId: string | undefined, cost: number): Promise<void> {
  if (!opId) return
  try { await svc().rpc('release_reservation', { p_user: userId, p_op: opId, p_cost: Math.max(1, Math.ceil(cost)) }) } catch { /* best-effort */ }
}
export async function bindJob(userId: string, opId: string | undefined, job: string): Promise<void> {
  if (!opId || !job) return
  try { await svc().rpc('bind_reservation_job', { p_user: userId, p_op: opId, p_job: job }) } catch { /* best-effort */ }
}
export async function releaseByJob(userId: string, job: string): Promise<void> {
  if (!job) return
  try { await svc().rpc('release_by_job', { p_user: userId, p_job: job, p_cost: 9999 }) } catch { /* best-effort */ }
}
export async function settleByJob(userId: string, job: string): Promise<void> {
  if (!job) return
  try { await svc().rpc('settle_by_job', { p_user: userId, p_job: job }) } catch { /* best-effort */ }
}

let _svc: SupabaseClient | null = null
export function svc(): SupabaseClient {
  if (!_svc) _svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  return _svc
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aa-op',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
export const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ── Validation d'un chemin client : un seul `/` de tête, aucun caractère capable de changer l'autorité
//    ou de remonter (`@`, `\`, `..`, encodages), et un allowlist strict du chemin (hors query string).
export function safePath(path: string, allow: RegExp): { ok: true; path: string } | { ok: false; reason: string } {
  const p = String(path ?? '')
  if (!p.startsWith('/') || p.startsWith('//')) return { ok: false, reason: 'path doit commencer par un seul « / »' }
  if (/[@\\\s\x00-\x1f#]|\.\.|%2f|%5c|%40|%2e/i.test(p)) return { ok: false, reason: 'caractères interdits dans path' }
  const bare = p.split('?')[0]
  if (!allow.test(bare)) return { ok: false, reason: 'chemin non autorisé' }
  return { ok: true, path: p }
}

// ── Base SANS chemin (api.openai.com, generativelanguage.googleapis.com, api.elevenlabs.io) : on valide,
//    on RÉSOUT contre la base et on exige la même origine. Impossible de détourner l'hôte.
export function safeUpstream(base: string, path: string, allow: RegExp): { ok: true; url: string } | { ok: false; reason: string } {
  const v = safePath(path, allow)
  if (!v.ok) return v
  let u: URL, b: URL
  try { u = new URL(v.path, base); b = new URL(base) } catch { return { ok: false, reason: 'path invalide' } }
  if (u.origin !== b.origin || u.username || u.password) return { ok: false, reason: 'hôte détourné' }
  return { ok: true, url: u.href }
}

// ── Rôle porté par un JWT (lecture du claim ; la passerelle a déjà vérifié la signature avec verify_jwt).
export function tokenRole(token: string): string {
  try {
    const p = token.split('.')[1]; if (!p) return ''
    const b = p.replace(/-/g, '+').replace(/_/g, '/')
    return String(JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4)))?.role || '')
  } catch { return '' }
}

export type Auth = { token: string; isService: boolean; userId: string | null }
// Session utilisateur RÉELLE exigée : la clé anon / publiable est un JWT valide pour la passerelle mais
// n'a pas d'utilisateur → refusée ici. Le moteur de rendu (service_role) passe sans profil.
export async function authUser(req: Request): Promise<Auth> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return { token: '', isService: false, userId: null }
  if (tokenRole(token) === 'service_role') return { token, isService: true, userId: null }
  try {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error } = await anon.auth.getUser()
    if (error || !user) return { token, isService: false, userId: null }
    return { token, isService: false, userId: user.id }
  } catch { return { token, isService: false, userId: null } }
}

export async function userPlan(userId: string): Promise<{ plan: string; isOwner: boolean }> {
  try {
    const { data } = await svc().from('profiles').select('plan, is_owner').eq('id', userId).maybeSingle()
    return { plan: String(data?.plan || 'free').toLowerCase(), isOwner: !!data?.is_owner }
  } catch { return { plan: 'free', isOwner: false } }
}

// ── Limiteur serveur (RPC rate_hit, service_role only). true = accepté. Fail-open sur erreur technique.
export async function rateHit(key: string, windowS: number, max: number): Promise<boolean> {
  try {
    const { data, error } = await svc().rpc('rate_hit', { p_key: key, p_window_s: windowS, p_max: max })
    if (error) { console.warn('rate_hit erreur (fail-open):', error.message); return true }
    return data !== false
  } catch { return true }
}

// ── Preuve de débit récent (RPC has_recent_debit). Fail-open sur erreur technique.
export async function hasRecentDebit(userId: string, minutes = 30): Promise<boolean> {
  try {
    const { data, error } = await svc().rpc('has_recent_debit', { p_user: userId, p_minutes: minutes })
    if (error) { console.warn('has_recent_debit erreur (fail-open):', error.message); return true }
    return data === true
  } catch { return true }
}

// ── Porte commune d'un appel FACTURANT : plafond par utilisateur + (si demandé) preuve de débit récent.
export type Gate = { ok: true } | { ok: false; status: number; error: string }
export async function billableGate(o: { userId: string; proxy: string; requireDebit: boolean; debitMinutes?: number; rateMax?: number; rateWindowS?: number; label?: string }): Promise<Gate> {
  const ok = await rateHit(`proxy:${o.proxy}:bill:${o.userId}`, o.rateWindowS ?? 600, o.rateMax ?? 30)
  if (!ok) return { ok: false, status: 429, error: 'Trop de générations en peu de temps — patiente quelques minutes.' }
  // Owner / developer : spendCreditsFor() côté client renvoie true SANS appeler la RPC → aucune réservation.
  const { plan, isOwner } = await userPlan(o.userId)
  if (isOwner || plan === 'developer') return { ok: true }
  const mins = o.debitMinutes ?? 60
  // Plancher « un débit récent existe » (le contrôle de MONTANT vit dans applyReservation, appelé par le proxy).
  if (o.requireDebit || plan === 'free') {
    const paid = await hasRecentDebit(o.userId, mins)
    if (!paid) {
      if (debitEnforce()) return { ok: false, status: 402, error: 'Aucun débit de crédits récent pour cette action.' }
      console.warn(`[debit-check warn-only] ${o.proxy} ${o.label ?? ''} user=${o.userId} : aucun débit récent`)
    }
  }
  return { ok: true }
}

// ── Plafond léger pour les appels NON facturants mais coûteux en compute (helpers, uploads, polling).
export async function helperGate(userId: string, proxy: string, max = 60, windowS = 600): Promise<Gate> {
  const ok = await rateHit(`proxy:${proxy}:help:${userId}`, windowS, max)
  return ok ? { ok: true } : { ok: false, status: 429, error: 'Trop de requêtes — patiente un instant.' }
}

// ── IP réelle : x-forwarded-for est une LISTE « client, proxy1, proxy2 » ; le client peut forger le début,
//    pas la fin (ajoutée par la passerelle). On prend donc le DERNIER segment.
export function realIp(req: Request): string {
  const direct = (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '').trim()
  if (direct) return direct
  const xff = (req.headers.get('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean)
  // Chaque saut AJOUTE l'IP de son pair : « [forgé par le client…], client-réel (ajouté par le CDN), IP-du-CDN
  // (ajoutée par la passerelle) ». MESURÉ le 05/09 : le DERNIER segment est une IP de passerelle (pool
  // 99.82.161.x, différente à chaque requête) → le vrai client est l'AVANT-DERNIER quand il y a ≥ 2 sauts.
  if (xff.length >= 2) return xff[xff.length - 2]
  return xff[0] || ''
}

// ── Anti-SSRF : hôte interdit si interne, loopback, link-local, metadata, ou IP littérale sous n'importe
//    quelle forme (dottée, IPv6, décimale, hexa, octale) — on n'accepte que des NOMS de domaine publics.
export function isBlockedHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')   // M2 (06/09) : retire crochets IPv6 ET point(s) final(aux) du FQDN (metadata.google.internal. contournait les suffixes)
  if (!h) return true
  if (!h.includes('.')) return true   // M2 (06/09) : hôte à un seul label (localhost, metadata, intranet…) = interne, jamais un FQDN public
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.arpa') || h === 'metadata.google.internal') return true
  if (h.includes(':')) return true                       // toute IPv6 littérale
  if (!/[a-z]/.test(h)) return true                      // aucune lettre = IP dottée / décimale / octale
  if (/^0x[0-9a-f]+$/.test(h)) return true               // hexa
  // M2 (06/09) : IP en notation OBFUSQUÉE — un hôte dont TOUS les labels sont hex (0x..) ou décimaux
  // est une IP (127.0.0.1 = 0x7f.1 = 2130706433 ; métadonnées = 0xa9.0xfe.0xa9.0xfe). On le bloque.
  { const labels = h.split('.'); if (labels.length && labels.every((l) => /^0x[0-9a-f]+$/.test(l) || /^[0-9]+$/.test(l))) return true }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return true
  }
  return false
}

// ── IP RÉSOLUE par le DNS (≠ hôte littéral) : seules les PLAGES internes comptent. isBlockedHost refuse TOUTE IP
//    littérale par conception (« aucune lettre = bloqué ») ; l'appliquer aux réponses DNS bloquait 100 % des domaines
//    publics (claude.ai, example.com…) → régression du round 3 (06/09 matin) : nouveaux clients CIMD, capture de site
//    (orchestrate/brand-memory) et images de référence MCP tous refusés. Fail-closed sur une forme inconnue.
export function isInternalIp(ip: string): boolean {
  let h = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)   // IPv4-mapped IPv6 → on juge l'IPv4
  if (mapped) h = mapped[1]
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true                      // unspecified / loopback
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true                    // fc00::/7 ULA
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true                    // fe80::/10 link-local
    if (/^::ffff:/.test(h) || /^::/.test(h)) return true             // mapped/compat non dotté (::ffff:7f00:1, ::7f00:1)
    if (/^64:ff9b:/.test(h) || /^2002:/.test(h)) return true         // NAT64, 6to4 (peuvent embarquer une IPv4 privée)
    return false
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return true
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 100 && b >= 64 && b <= 127)
}

// ── SSRF par DNS : isBlockedHost ne voit que l'hôte LITTÉRAL ; un domaine public peut résoudre vers une IP
//    interne. hostResolvesInternal résout A/AAAA et bloque si UNE ip est interne. Best-effort : si resolveDns
//    est indisponible dans le runtime, on ne bloque pas (fail-open, pas pire qu'avant). Ne couvre pas le DNS
//    rebinding (TOCTOU), mais ferme le cas d'un domaine pointant statiquement vers une IP interne/métadonnées.
export async function hostResolvesInternal(hostname: string): Promise<boolean> {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (isBlockedHost(h)) return true
  try {
    const ips: string[] = []
    for (const t of ['A', 'AAAA'] as const) { try { ips.push(...(await Deno.resolveDns(h, t))) } catch { /* type absent */ } }
    return ips.some((ip) => isInternalIp(ip))   // ⚠ PAS isBlockedHost : il refuse toute IP littérale (voir isInternalIp)
  } catch { return false }   // resolveDns indisponible → fail-open
}

// ── fetch d'une page utilisateur : redirections MANUELLES, chaque saut revalidé (protocole http(s), port
//    par défaut, hôte non bloqué). null = refusé / injoignable.
export async function safeFetchHtml(rawUrl: string, timeoutMs = 7000, maxHops = 3): Promise<Response | null> {
  let url: URL
  try { url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl) } catch { return null }
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    for (let hop = 0; hop <= maxHops; hop++) {
      if (!/^https?:$/.test(url.protocol) || url.port || url.username || url.password || isBlockedHost(url.hostname)) return null
      if (await hostResolvesInternal(url.hostname)) return null   // round3 : DNS pointant en interne
      const res = await fetch(url.href, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AvatarAds/1.0)' } })
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location'); if (!loc) return null
        try { url = new URL(loc, url) } catch { return null }
        continue
      }
      return res
    }
    return null
  } catch { return null }
  finally { clearTimeout(to) }
}

// ── Comparaison à temps constant (secrets de webhook / cron).
export function timingSafeEqual(a: string, b: string): boolean {
  const x = String(a ?? ''), y = String(b ?? '')
  if (x.length !== y.length) return false
  let r = 0
  for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return r === 0
}
