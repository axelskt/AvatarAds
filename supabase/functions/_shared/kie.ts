// Briques kie.ai partagées (kie-proxy + reconcile-kie) — suivi normalisé des tâches, rapatriement anti-SSRF,
// détection du format, facturation liée à la tâche (25/09). La clé reste dans les secrets Supabase (KIEAI_API_KEY),
// jamais renvoyée ni journalisée.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isBlockedHost, hostResolvesInternal } from './guard.ts'

export const KIE = 'https://api.kie.ai'
export const kieKey = () => Deno.env.get('KIEAI_API_KEY') ?? ''
export const kieHeaders = () => ({ Authorization: `Bearer ${kieKey()}`, 'Content-Type': 'application/json' })
export const MAX_RESULT_BYTES = 90 * 1024 * 1024   // mémoire Edge = 256 Mo (lecture en flux, abandon au-delà)

// ── Ouverture aux clients payants (Axel 25/09/2026) : EXACTEMENT deux usages. alias → plans autorisés (owner et
//    developer passent toujours). Tout autre alias (Veo, Kling Motion Control, OmniHuman…) reste developer seulement.
//    Plans = ceux de l'UI : « Améliorer en 4K » dès Starter ; Omni Flash image→vidéo (Express « UGC réel » + Voix native
//    du Générateur) = TOUS les plans payants depuis le 25/09 (Axel : « tout le monde y a droit pareil, Starter inclus »),
//    comme le gate fal-proxy de google/gemini-omni-flash/…/image-to-video (le carré 1:1, que kie ne fait pas). Free : non.
export const KIE_OPEN: Record<string, string[]> = {
  'nano-banana-pro': ['starter', 'pro', 'elite', 'byok'],
  'omni-flash': ['starter', 'pro', 'elite', 'byok'],
  'omnihuman-1.5': ['elite'],   // Axel 25/09 : OmniHuman passe chez kie pour les clients qui l'utilisent — Élite (Générateur + Montage IA) ; repli fal côté app
}
// Usages SANS repli côté app (Axel 25/09 : Omni Flash = « kie directement, pas de fallback ») : un échec kie n'a plus de
// suite possible sur la même réservation → kie-proxy la rend PUIS la rembourse tout de suite (kie_job_bill release →
// refund, exactement une fois). Nano 4K garde son repli Google → rendu seulement (l'app re-tire la même op).
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

// Nom affiché dans la Bibliothèque quand le filet range une génération récupérée après coup.
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
    const urls = Array.isArray(d.response?.resultUrls) ? d.response.resultUrls : []
    return { found: true, state: f === 1 ? 'ok' : (f === 2 || f === 3 ? 'fail' : 'run'), urls,
      err: String(d.errorMessage || ''), errType: String(d.errorCode ?? ''), param: norm(d.paramJson),
      meta: { resolution: d.response?.resolution ?? null, originUrls: d.response?.originUrls ?? null, fallbackFlag: d.fallbackFlag ?? null } }
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

