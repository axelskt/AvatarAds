// Référence d'attribution « lead Instagram → compte AvatarAds » (Axel 25/09/2026).
//  ig-go la fabrique au clic d'un lien DM VÉRIFIÉ ; l'app la renvoie UNE fois après connexion (ig-go ?action=attach),
//  qui la vérifie et relie le compte connecté au lead (table ig_lead_links, service role seulement).
//
//  Format : 1.<heure du clic en secondes, base 36>.<base64url( iv 12 o ‖ AES-256-GCM(sender_id) )>
//   - chiffrée ET authentifiée (AES-GCM) : l'identifiant Instagram du lead n'est jamais lisible côté client, ni dans
//     une URL, ni dans le stockage du navigateur ; une référence modifiée ou fabriquée échoue au déchiffrement ;
//   - l'heure du clic est en clair (le navigateur garde la plus récente sans rien déchiffrer) mais AUTHENTIFIÉE
//     (données associées), tout comme l'identifiant du projet Supabase : une référence d'un autre projet est refusée ;
//   - valable 30 jours après le clic (LEAD_REF_TTL_MS).
//  Clé : HKDF-SHA256 (sel + info dédiés) sur LEAD_REF_SECRET s'il existe, sinon sur IG_APP_SECRET (déjà présent côté
//  serveur et utilisé par _shared/iglink.ts pour signer les liens). La clé AES est DÉRIVÉE, donc séparée du HMAC des
//  liens et de la signature Meta : aucune ne permet de retrouver l'autre. Changer de secret invalide les références en
//  cours (30 jours max), jamais un paiement ni un clic.
// Aucun effet de bord au chargement du module (lu à chaque appel : les tests changent l'environnement).

export const LEAD_REF_TTL_MS = 30 * 86400_000
const SKEW_MS = 5 * 60_000                        // horloge : un clic « dans le futur » de plus de 5 min est refusé
export const SENDER_RE = /^[0-9A-Za-z_-]{3,64}$/  // identifiant Instagram (IGSID numérique en pratique)
const TOKEN_RE = /^1\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{40,300})$/

const enc = new TextEncoder()
const dec = new TextDecoder()

function secret(): string { return Deno.env.get('LEAD_REF_SECRET') || Deno.env.get('IG_APP_SECRET') || '' }
export function projectRef(): string {
  try { return new URL(Deno.env.get('SUPABASE_URL') || '').hostname.split('.')[0].toLowerCase() } catch { return '' }
}

let cached: { s: string; key: CryptoKey } | null = null
async function aesKey(s: string): Promise<CryptoKey> {
  if (cached && cached.s === s) return cached.key
  const base = await crypto.subtle.importKey('raw', enc.encode(s), 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('avatarads-lead-ref'), info: enc.encode('ig-lead-ref-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  cached = { s, key }
  return key
}
const aad = (t36: string, proj: string) => enc.encode('ig-lead-ref|1|' + t36 + '|' + proj)

function b64u(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function unb64u(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b + '='.repeat((4 - b.length % 4) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

// Fabrique la référence d'un clic vérifié. null si le serveur n'est pas configuré (aucun secret) : le clic reste
// compté, seule l'attribution manque.
export async function mintLeadRef(sender: string, clickedAtMs: number): Promise<string | null> {
  const s = secret(), proj = projectRef()
  if (!s || !proj || !SENDER_RE.test(String(sender || '')) || !Number.isFinite(clickedAtMs) || clickedAtMs <= 0) return null
  const t36 = Math.floor(clickedAtMs / 1000).toString(36)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(t36, proj) }, await aesKey(s), enc.encode(sender)))
  const buf = new Uint8Array(iv.length + ct.length)
  buf.set(iv)
  buf.set(ct, iv.length)
  return '1.' + t36 + '.' + b64u(buf)
}

export type LeadRef = { sender: string; clickedAt: number }
export type OpenedRef = { ok: true; ref: LeadRef } | { ok: false; reason: 'unconfigured' | 'format' | 'forged' | 'future' | 'expired' }

// Vérifie une référence renvoyée par le navigateur. Jamais d'exception : toute anomalie = refus avec une raison.
export async function openLeadRef(token: unknown, nowMs = Date.now()): Promise<OpenedRef> {
  const s = secret(), proj = projectRef()
  if (!s || !proj) return { ok: false, reason: 'unconfigured' }
  const m = typeof token === 'string' && token.length <= 320 ? TOKEN_RE.exec(token) : null
  if (!m) return { ok: false, reason: 'format' }
  let raw: Uint8Array
  try { raw = unb64u(m[2]) } catch { return { ok: false, reason: 'format' } }
  if (raw.length < 12 + 16 + 3) return { ok: false, reason: 'format' }
  let sender = ''
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: aad(m[1], proj) }, await aesKey(s), raw.slice(12))
    sender = dec.decode(pt)
  } catch { return { ok: false, reason: 'forged' } }   // modifiée, fabriquée, autre secret ou autre projet
  if (!SENDER_RE.test(sender)) return { ok: false, reason: 'forged' }
  const clickedAt = parseInt(m[1], 36) * 1000
  if (!Number.isFinite(clickedAt) || clickedAt <= 0) return { ok: false, reason: 'format' }
  if (clickedAt > nowMs + SKEW_MS) return { ok: false, reason: 'future' }
  if (nowMs - clickedAt > LEAD_REF_TTL_MS) return { ok: false, reason: 'expired' }
  return { ok: true, ref: { sender, clickedAt } }
}
