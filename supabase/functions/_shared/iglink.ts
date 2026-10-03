// Lien tracké Auto-DM (avatarads.fr/r.html → ig-go) — audit sécurité du 23/09/2026.
//  - Destinations en liste blanche (avatarads.fr, trackads.fr) : plus de redirection ouverte
//    qui permettrait de faire du phishing avec notre domaine.
//  - Signature HMAC de (u, ig) : seul un lien réellement envoyé par nos DM peut enregistrer un clic
//    (sinon n'importe qui gonfle le CTR et annule la relance, qui exclut les leads ayant cliqué).
// Clé : le secret de l'app Instagram (déjà présent côté serveur), avec un préfixe dédié.
// Audit 02/10 : la signature porte la DATE D'ÉMISSION du lien, valable 30 jours (LINK_TTL_MS).
//  s = <émission en secondes, base 36>.<HMAC('ig-link-v2|' u|ig|émission), 16 o, base64url>
//  (le « . » et la base 36 passent tels quels dans l'URL ; r.html relaie s sans le lire).
//  Liens v1 (signés SANS date, envoyés du 23/09 jusqu'au déploiement de ce correctif) : encore acceptés jusqu'au
//  LEGACY_V1_UNTIL ; ig-go vérifie en plus que ce lead a bien reçu un lien de ce compte il y a 30 jours au plus.
// Secret lu à chaque appel (aucun effet de bord au chargement : les tests changent l'environnement).
export const LINK_BASE = 'https://avatarads.fr/r.html'
export const DEFAULT_DEST = 'https://avatarads.fr'
const ALLOWED_HOSTS = ['avatarads.fr', 'trackads.fr']
export const LINK_TTL_MS = 30 * 86400_000
// ≈ 30 j après la mise en service du format daté (03/10/2026) + une semaine de marge de déploiement. Passé cette
// date, plus aucun lien v1 n'est accepté (le code v1 pourra alors être retiré).
export const LEGACY_V1_UNTIL = Date.parse('2026-11-10T00:00:00Z')
const SKEW_MS = 5 * 60_000                       // horloge : une émission « dans le futur » de plus de 5 min est refusée
const V2_RE = /^([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})$/
const V1_RE = /^[A-Za-z0-9_-]{22}$/

const secret = () => Deno.env.get('IG_APP_SECRET') || ''

export function safeDest(to: string | null | undefined): string {
  try {
    const t = new URL(String(to || ''))
    const h = t.hostname.toLowerCase()
    if (t.protocol === 'https:' && ALLOWED_HOSTS.some((a) => h === a || h.endsWith('.' + a))) return t.href
  } catch { /* URL invalide → destination par défaut */ }
  return DEFAULT_DEST
}

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)))
  let s = ''
  for (const b of sig.slice(0, 16)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sameStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)   // temps constant
  return d === 0
}

// Signature datée (v2). `now` : pour les tests seulement.
export async function signClick(u: string, ig: string, now = Date.now()): Promise<string> {
  const t36 = Math.floor(now / 1000).toString(36)
  return t36 + '.' + await hmac('ig-link-v2|' + u + '|' + ig + '|' + t36)
}

export type ClickCheck =
  | { ok: true; legacy: boolean }
  | { ok: false; reason: 'unconfigured' | 'missing' | 'format' | 'signature' | 'expired' | 'future' | 'legacy_closed' }

// Vérifie la signature s d'un clic (u = lead, ig = compte qui a envoyé le lien). legacy = lien v1 sans date :
// l'appelant doit alors vérifier lui-même qu'il a été envoyé il y a 30 jours au plus (ig-go : ig_dm_log).
export async function checkClick(u: string, ig: string, s: string, now = Date.now()): Promise<ClickCheck> {
  if (!secret()) return { ok: false, reason: 'unconfigured' }
  if (!u || !s) return { ok: false, reason: 'missing' }
  const m = V2_RE.exec(s)
  if (m) {
    const t = parseInt(m[1], 36) * 1000
    if (!(t > 0)) return { ok: false, reason: 'format' }
    if (t - now > SKEW_MS) return { ok: false, reason: 'future' }
    if (now - t > LINK_TTL_MS) return { ok: false, reason: 'expired' }
    const expected = await hmac('ig-link-v2|' + u + '|' + ig + '|' + m[1])
    return sameStr(expected, m[2]) ? { ok: true, legacy: false } : { ok: false, reason: 'signature' }
  }
  if (V1_RE.test(s)) {
    if (now >= LEGACY_V1_UNTIL) return { ok: false, reason: 'legacy_closed' }
    const expected = await hmac('ig-link-v1|' + u + '|' + ig)
    return sameStr(expected, s) ? { ok: true, legacy: true } : { ok: false, reason: 'signature' }
  }
  return { ok: false, reason: 'format' }
}

export async function trackedLink(ig: string, u: string, dest: string): Promise<string> {
  const s = await signClick(u, ig)
  return LINK_BASE + '?u=' + encodeURIComponent(u) + '&ig=' + encodeURIComponent(ig)
    + '&s=' + encodeURIComponent(s) + '&to=' + encodeURIComponent(safeDest(dest))
}
