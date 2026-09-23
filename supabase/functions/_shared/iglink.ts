// Lien tracké Auto-DM (avatarads.fr/r.html → ig-go) — audit sécurité du 23/09/2026.
//  - Destinations en liste blanche (avatarads.fr, trackads.fr) : plus de redirection ouverte
//    qui permettrait de faire du phishing avec notre domaine.
//  - Signature HMAC de (u, ig) : seul un lien réellement envoyé par nos DM peut enregistrer un clic
//    (sinon n'importe qui gonfle le CTR et annule la relance, qui exclut les leads ayant cliqué).
// Clé : le secret de l'app Instagram (déjà présent côté serveur), avec un préfixe dédié.
const LINK_SECRET = Deno.env.get('IG_APP_SECRET') || ''
export const LINK_BASE = 'https://avatarads.fr/r.html'
export const DEFAULT_DEST = 'https://avatarads.fr'
const ALLOWED_HOSTS = ['avatarads.fr', 'trackads.fr']

export function safeDest(to: string | null | undefined): string {
  try {
    const t = new URL(String(to || ''))
    const h = t.hostname.toLowerCase()
    if (t.protocol === 'https:' && ALLOWED_HOSTS.some((a) => h === a || h.endsWith('.' + a))) return t.href
  } catch { /* URL invalide → destination par défaut */ }
  return DEFAULT_DEST
}

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(LINK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('ig-link-v1|' + msg)))
  let s = ''
  for (const b of sig.slice(0, 16)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function signClick(u: string, ig: string): Promise<string> {
  return hmac(u + '|' + ig)
}

export async function verifyClick(u: string, ig: string, s: string): Promise<boolean> {
  if (!LINK_SECRET || !u || !s) return false
  const expected = await signClick(u, ig)
  if (expected.length !== s.length) return false
  let d = 0
  for (let i = 0; i < s.length; i++) d |= expected.charCodeAt(i) ^ s.charCodeAt(i)   // temps constant
  return d === 0
}

export async function trackedLink(ig: string, u: string, dest: string): Promise<string> {
  const s = await signClick(u, ig)
  return LINK_BASE + '?u=' + encodeURIComponent(u) + '&ig=' + encodeURIComponent(ig)
    + '&s=' + s + '&to=' + encodeURIComponent(safeDest(dest))
}
