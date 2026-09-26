// Briques kie.ai partagées (kie-proxy + reconcile-kie) — suivi normalisé des tâches, rapatriement anti-SSRF,
// détection du format, facturation liée à la tâche (25/09). La clé reste dans les secrets Supabase (KIEAI_API_KEY),
// jamais renvoyée ni journalisée.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isBlockedHost, hostResolvesInternal } from './guard.ts'

export const KIE = 'https://api.kie.ai'
export const kieKey = () => Deno.env.get('KIEAI_API_KEY') ?? ''
export const kieHeaders = () => ({ Authorization: `Bearer ${kieKey()}`, 'Content-Type': 'application/json' })
export const MAX_RESULT_BYTES = 90 * 1024 * 1024   // mémoire Edge = 256 Mo (lecture en flux, abandon au-delà)

// ── Ouverture aux clients payants (Axel 25/09/2026) : EXACTEMENT quatre usages. alias → plans autorisés (owner et
//    developer passent toujours). Tout autre alias (Veo Fast, Kling Motion Control…) reste developer seulement.
//    Plans = ceux de l'UI : « Améliorer en 4K » dès Starter ; Omni Flash image→vidéo (Express « UGC réel » + Voix native
//    du Générateur) = TOUS les plans payants depuis le 25/09 (Axel : « tout le monde y a droit pareil, Starter inclus »),
//    comme le gate fal-proxy de google/gemini-omni-flash/…/image-to-video (le carré 1:1, que kie ne fait pas). Free : non.
//    Veo 3.1 Lite (Express « Veo Standard », Axel 25/09 : « Veo Lite passe sur kie, 1080p compris ») = les mêmes plans que
//    le chemin Google (google-ai-proxy : Lite dès Starter) ; la 1080p reste Pro / Élite (KIE_VEO_1080_PLANS, comme le gate
//    « Veo 1080p » de google-ai-proxy et _exp1080Allowed de l'app). Veo Fast (veo3-fast) n'est proposé à AUCUN client dans
//    l'app (carte « Veo Fast » = test du compte developer) → fermé ici ; s'il est ouvert un jour : Pro / Élite (KIE_VEO_FAST_PLANS).
//    OmniHuman 1.5 (Axel 25/09, livré le 26/09) = Élite (Générateur + Montage IA), tirage EXACT de 5 cr × durée MESURÉE
//    côté serveur (omnihuman-bill.ts) ; repli fal (même op) côté app seulement si kie échoue sans tâche. (Le MCP
//    lipsync_video appelle kie avec sa propre clé et facture lui-même : mcp/omnihuman-kie.ts, hors KIE_OPEN.)
export const KIE_OPEN: Record<string, string[]> = {
  'nano-banana-pro': ['starter', 'pro', 'elite', 'byok'],
  'omni-flash': ['starter', 'pro', 'elite', 'byok'],
  'veo3-lite': ['starter', 'pro', 'elite', 'byok'],
  'omnihuman-1.5': ['elite'],   // Axel 25/09 : OmniHuman passe chez kie pour les clients qui l'utilisent — Élite (Générateur + Montage IA) ; repli fal côté app
}
export const KIE_VEO_1080_PLANS = ['pro', 'elite']
export const KIE_VEO_FAST_PLANS = ['pro', 'elite']
// Tarif Veo facturé au client (crédits / seconde, 25/09 : prix INCHANGÉS par rapport à Google) = CREDIT_COSTS de l'app
// (expressLitePerSec 1,5 · expressFastPerSec 3 · express1080Mult ×2) et costFor de google-ai-proxy. À changer ENSEMBLE.
// Coût kie par vidéo (4/6/8 s, pour mémoire) : Lite 720p 0,15 $ · 1080p 0,175 $ ; Fast 720p 0,30 $ · 1080p 0,325 $.
export const KIE_VEO_PER_SEC: Record<string, { '720p': number; '1080p': number }> = {
  'veo3-lite': { '720p': 1.5, '1080p': 3 },
  'veo3-fast': { '720p': 3, '1080p': 6 },
}
export function kieVeoCost(alias: string, resolution: unknown, seconds: unknown): number {
  const r = KIE_VEO_PER_SEC[alias] || KIE_VEO_PER_SEC['veo3-fast']   // alias inconnu → le plus cher (jamais sous-facturer)
  const sec = [4, 6, 8].includes(Number(seconds)) ? Number(seconds) : 8
  return Math.ceil(sec * (String(resolution) === '1080p' ? r['1080p'] : r['720p']))
}
// Usages SANS repli côté app (Axel 25/09 : Omni Flash = « kie directement, pas de fallback ») : un échec kie n'a plus de
// suite possible sur la même réservation → kie-proxy la rend PUIS la rembourse tout de suite (kie_job_bill release →
// refund, exactement une fois). Nano 4K et Veo Lite gardent leur repli Google → rendu seulement (l'app re-tire la même op).
export const KIE_NO_FALLBACK = new Set(['omni-flash'])
// Interrupteur serveur : secret KIE_CLIENTS=0 referme kie aux clients SANS redéploiement (403 AVANT tout tirage → l'app
// replie sur Google / fal). Lu à chaque requête. Défaut : ouvert. Le compte developer n'est pas concerné.
export const kieClientsOn = (): boolean => (Deno.env.get('KIE_CLIENTS') ?? '1').trim() !== '0'

// ── Facturation d'une tâche kie (RPC kie_job_bill, migration 20260925130000) : settle | release | refund, EXACTEMENT
//    une fois (verrou de ligne + garde d'état en SQL). `bill` = état APRÈS l'appel ('none' = aucune réservation liée,
//    null = erreur technique → l'appelant garde l'état connu). Best-effort : jamais d'exception.
export type KieBill = 'none' | 'drawn' | 'settled' | 'released' | 'refunded' | 'closed'
export async function kieBill(db: SupabaseClient, userId: string, rid: string, action: 'settle' | 'release' | 'refund'): Promise<{ ok: boolean; bill: KieBill | null; reason?: string }> {
  try {
    const { data, error } = await db.rpc('kie_job_bill', { p_user: userId, p_task: rid, p_action: action })
    if (error) { console.warn('[kie] kie_job_bill', action, rid, error.message); return { ok: false, bill: null, reason: 'rpc' } }
    const d = (data || {}) as { ok?: boolean; bill?: KieBill | null; reason?: string }
    return { ok: !!d.ok, bill: d.bill ?? null, reason: d.reason }
  } catch (e) { console.warn('[kie] kie_job_bill exception', action, rid, (e as Error)?.message); return { ok: false, bill: null, reason: 'rpc' } }
}

// Nom affiché dans la Bibliothèque quand le filet range une génération récupérée après coup. Compte developer SEULEMENT :
// un client ne voit jamais « kie » ni le nom du moteur (Axel 25/09) → KIE_CLIENT_LABELS + kieLibMeta (tags / style neutres).
export const KIE_CLIENT_LABELS: Record<string, string> = {
  'nano-banana-pro': 'Image 4K',
  'veo3-lite': 'Vidéo Express',
  'veo3-fast': 'Vidéo Express',
  'omni-flash': 'Vidéo',
  'omnihuman-1.5': 'Vidéo avatar',   // OmniHuman (26/09) : jamais le nom du moteur ni du fournisseur côté client
}
export const kieLabel = (alias: string, dev: boolean): string => dev ? (KIE_LABELS[alias] || 'kie.ai') : (KIE_CLIENT_LABELS[alias] || 'Génération')
// Métadonnées de la ligne Bibliothèque écrite par le filet. « Compte developer » = le PLAN du propriétaire (lu par le filet),
// jamais deviné d'après le libellé : les lignes client écrites par l'ancien kie-proxy portent « … · kie.ai » (KIE_LABELS,
// Omni / 4K ouverts plus tôt le 25/09) → pour un client, un libellé contenant « kie » est remplacé par le libellé neutre de
// l'alias ; tags / style sans nom de moteur. Developer : libellé, tags et style kie (inchangé).
export function kieLibMeta(label: string | null, alias: string | null, dev: boolean): { name: string; tags: string[]; style: string } {
  if (dev) return { name: label || KIE_LABELS[String(alias)] || 'kie.ai', tags: ['kie.ai', 'récupérée'], style: 'kie.ai' }
  const name = (label && !/kie/i.test(label)) ? label : (KIE_CLIENT_LABELS[String(alias)] || 'Génération')
  return { name, tags: ['récupérée'], style: '' }
}
export const KIE_LABELS: Record<string, string> = {
  'nano-banana-pro': 'Image 4K · kie.ai',
  'veo3-lite': 'Vidéo Veo Lite · kie.ai',
  'veo3-fast': 'Vidéo Veo Fast · kie.ai',
  'kling-2.6-mc': 'Motion Control 2.6 · kie.ai',
  'kling-3.0-mc': 'Motion Control 3.0 · kie.ai',
  'omnihuman-1.5': 'Omni Human · kie.ai',
  'omni-flash': 'Vidéo Omni Flash · kie.ai',
}

// ── Suivi normalisé des deux familles (market = jobs/recordInfo ; veo = veo/record-info) ──
export type KieRec = { found: boolean; transient?: boolean; account?: boolean; state: 'queue' | 'run' | 'ok' | 'fail'; urls: string[]; err: string; errType: string; param: string; meta: Record<string, unknown> }
export async function kieRecord(fam: 'mk' | 'veo', taskId: string): Promise<KieRec> {
  const path = fam === 'veo' ? '/api/v1/veo/record-info' : '/api/v1/jobs/recordInfo'
  const miss = (err: string, extra: Partial<KieRec> = {}): KieRec => ({ found: false, state: 'fail', urls: [], err, errType: 'not_found', param: '', meta: {}, ...extra })
  let r: Response, j: any
  try { r = await fetch(`${KIE}${path}?taskId=${encodeURIComponent(taskId)}`, { headers: kieHeaders(), signal: AbortSignal.timeout(20000) }) }
  catch { return miss('kie injoignable', { transient: true }) }
  try { j = await r.json() } catch { return miss('réponse kie illisible', { transient: true }) }
  const code = Number(j?.code), d = j?.data
  // `param` sert au contrôle de propriété (/render-media/<uid>/) : on neutralise d'éventuels « \/ » échappés.
  const norm = (v: unknown) => String(v || '').replace(/\\\//g, '/')
  // Panne PASSAGÈRE (on réessaie) ≠ tâche introuvable (404) ≠ échec réel (FAILED).
  // 401/402/403 = problème de COMPTE (clé, solde, droits), pas de la tâche → jamais « échouée » (sinon le filet
  // abandonnerait d'un coup toutes les tâches en attente sur une simple clé expirée) ; signalé à part (account).
  if ([401, 402, 403].includes(code) || [401, 402, 403].includes(r.status)) return miss(String(j?.msg || 'clé ou compte kie.ai refusé'), { transient: true, account: true })
  if (r.status >= 500 || [429, 433, 455, 500, 505].includes(code)) return miss(String(j?.msg || 'kie momentanément indisponible'), { transient: true })
  if (code === 200 && !d) return miss('tâche introuvable')
  if (code !== 200) {
    if (code === 404 || (code === 422 && /null|not.?found|record/i.test(String(j?.msg || '')))) return miss(String(j?.msg || 'tâche introuvable'))
    return { found: true, state: 'fail', urls: [], err: String(j?.msg || 'échec kie'), errType: String(code || 'failed'), param: '', meta: { kieCode: code } }
  }
  if (fam === 'veo') {
    const f = Number(d.successFlag)
    // Résultat = resultUrls, sinon originUrls (doc kie : rempli dès que le format n'est pas 16:9 — donc en 9:16, le format
    // d'Express). Un succès avec la seule originUrls est un LIVRABLE (jamais classé « échec » rendu → repli Google = deux
    // vidéos pour un débit). Aucune URL de résultat dans `meta` : la route résultat (règlement, bill_state) est le SEUL
    // chemin de livraison (relecture 26/09 : /status livrait originUrls, même sur une tâche remboursée).
    const list = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map((x) => String(x || '')).filter(Boolean)
      if (typeof v === 'string' && v.trim()) { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map((x) => String(x || '')).filter(Boolean) : [] } catch { return [] } }
      return []
    }
    const res = list(d.response?.resultUrls), orig = list(d.response?.originUrls)
    const urls = res.length ? res : orig
    return { found: true, state: f === 1 ? 'ok' : (f === 2 || f === 3 ? 'fail' : 'run'), urls,
      err: String(d.errorMessage || ''), errType: String(d.errorCode ?? ''), param: norm(d.paramJson),
      meta: { resolution: d.response?.resolution ?? null, origin: orig.length > 0, fallbackFlag: d.fallbackFlag ?? null } }
  }
  const st = String(d.state || '')
  let urls: string[] = []
  if (st === 'success') { try { urls = JSON.parse(d.resultJson || '{}').resultUrls || [] } catch { urls = [] } }
  return { found: true, state: st === 'success' ? 'ok' : st === 'fail' ? 'fail' : st === 'generating' ? 'run' : 'queue', urls,
    err: String(d.failMsg || ''), errType: String(d.failCode || ''), param: norm(d.param),
    meta: { model: d.model ?? null, costTime: d.costTime ?? null, creditsConsumed: d.creditsConsumed ?? null } }
}

// Téléchargement du résultat kie (anti-SSRF : https, hôte public, redirections revalidées), JAMAIS .text() sur un binaire.
export async function kieDownload(raw: string): Promise<{ buf: ArrayBuffer; ct: string; host: string } | null> {
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

// Format réel d'après la SIGNATURE des octets uniquement (jamais le content-type de l'hôte distant : un SVG ou un HTML
// ne doit jamais être rangé comme image ou vidéo). Inconnu → null.
export function kieKindOf(ct: string, buf: ArrayBuffer): { ext: string; mime: string; kind: 'image' | 'video' } | null {
  const h = new Uint8Array(buf.slice(0, 12))
  if (h[0] === 0xff && h[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg', kind: 'image' }
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return { ext: 'png', mime: 'image/png', kind: 'image' }
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57) return { ext: 'webp', mime: 'image/webp', kind: 'image' }
  if (h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) return { ext: 'mp4', mime: 'video/mp4', kind: 'video' }
  void ct
  return null
}

// Propriété d'une tâche : on relève TOUTES les URL signées de notre bucket présentes dans le `param` enregistré par kie
// (quelle que soit sa structure : champ d'entrée, tableau, JSON imbriqué…) ; il en faut au moins une, et TOUTES doivent
// venir du dossier de ce user. Sûr : kie-proxy n'accepte en entrée que des URL du dossier de l'appelant, et un tiers ne
// peut pas faire apparaître SON uid dans la tâche d'un autre (la tâche d'un autre ne contient que les URL de l'autre).
export function kieOwnedBy(param: string, uid: string, storeSign: string): boolean {
  const esc = storeSign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(esc + '([0-9a-fA-F-]{36})/', 'g')
  const owners = [...String(param || '').matchAll(re)].map((m) => m[1].toLowerCase())
  return owners.length > 0 && owners.every((o) => o === String(uid).toLowerCase())
}


// Interrupteur PROPRE à Veo (relecture 26/09) : secret KIE_VEO=0 renvoie les générations Veo des clients sur Google
// (MCP : repli direct, aucun appel kie) SANS toucher à KIE_CLIENTS — qui fermerait aussi Omni Flash, sans repli.
// Lu à chaque requête. Défaut : ouvert. Le compte developer n'est pas concerné (kie ou l'erreur).
export const kieVeoClientsOn = (): boolean => (Deno.env.get('KIE_VEO') ?? '1').trim() !== '0'
