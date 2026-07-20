// Supabase Edge Function — 🧠 Mémoire de marque (#124)
//
// Une fiche persistante par utilisateur : ce qu'il fait, son produit, ses
// fonctionnalités, ses chiffres, ses réseaux, son ton, son CTA. Le chef
// d'orchestre (orchestrate) la reçoit à CHAQUE montage → l'user ne retape
// plus son contexte, et les slides sont justes dès la 1re vidéo.
//
// La lecture/écriture « simple » se fait côté client (RLS + privilèges
// colonne sur public.brand_memory). Cette fonction ne sert qu'aux deux
// opérations qui demandent Claude :
//
//   POST { action:'from_site', website }                → 1er remplissage depuis le site
//   POST { action:'learn', brief?, transcript?, website? } → enrichissement après un montage
//
// Règle absolue des deux : on n'INVENTE rien. On ne garde que ce qui est
// écrit sur le site / dit dans l'audio / donné dans le brief. Et on ne
// supprime jamais ce que l'utilisateur a écrit lui-même dans sa fiche.
//
// Auth : JWT utilisateur. Toutes les écritures passent par le client
// porteur de son token → RLS appliquée (impossible d'écrire chez un autre).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CLAUDE_MODEL = 'claude-sonnet-5'
const SITE_TTL_MS = 14 * 24 * 3600 * 1000 // le site est re-crawlé au plus 1× / 2 semaines
const MAX_SUMMARY = 1400

// ---------- scrape du site (même extraction que orchestrate) ----------
async function fetchSite(url: string): Promise<string> {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url)
    if (!/^https?:$/.test(u.protocol)) return ''
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return ''
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 7000)
    const res = await fetch(u.href, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AvatarAds/1.0)' } })
    clearTimeout(to)
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return ''
    const html = (await res.text()).slice(0, 400_000)
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] || '').trim()
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
    return [title && 'TITRE: ' + title, desc && 'DESCRIPTION: ' + desc, body && 'CONTENU: ' + body]
      .filter(Boolean).join('\n').slice(0, 5800)
  } catch (_) { return '' }
}

// ---------- schéma de la fiche ----------
// Volontairement PLAT (aucun tableau d'objets) : un tableau d'objets fait
// exploser la grammaire du mode json_schema strict (déjà rencontré sur le plan).
const MEMORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'business', 'produit', 'features', 'chiffres', 'audience', 'offres', 'reseaux', 'ton', 'cta', 'interdits'],
  properties: {
    summary: { type: 'string', description: 'La fiche en texte suivi, 6 lignes max, lisible par l\'utilisateur. C\'est ce que le monteur IA lira.' },
    business: { type: 'string', description: 'Ce que fait cette personne/entreprise, en 1 phrase.' },
    produit: { type: 'string', description: 'Le produit ou service principal.' },
    features: { type: 'array', items: { type: 'string' }, description: 'Fonctionnalités / bénéfices concrets, formulés courts.' },
    chiffres: { type: 'array', items: { type: 'string' }, description: 'Chiffres EXACTS trouvés (prix, délais, stats). Format "libellé|valeur".' },
    audience: { type: 'string', description: 'À qui il s\'adresse.' },
    offres: { type: 'string', description: 'Forfaits / prix, tels qu\'affichés.' },
    reseaux: { type: 'array', items: { type: 'string' }, description: 'Format "plateforme|@handle ou url".' },
    ton: { type: 'string', description: 'Ton de communication (ex : punchy, tutoiement, direct).' },
    cta: { type: 'string', description: 'Appel à l\'action habituel (ex : "lien en bio").' },
    interdits: { type: 'array', items: { type: 'string' }, description: 'Ce qu\'il ne faut jamais afficher/promettre.' },
  },
}

const SYSTEM = `Tu construis la FICHE DE MARQUE d'un utilisateur d'AvatarAds (outil de montage video IA).
Cette fiche sera relue a chaque nouvelle video pour que le monteur IA connaisse deja son business.

REGLES ABSOLUES :
1. Tu n'INVENTES RIEN. Chaque element vient du site, du brief ou de ce qui est dit dans l'audio. Aucun chiffre, aucune promesse, aucune fonctionnalite devinee.
2. Tu ne SUPPRIMES JAMAIS une information deja presente dans la fiche existante — surtout si elle a ete ecrite par l'utilisateur. Tu completes, tu precises, tu fusionnes les doublons.
3. En cas de contradiction entre la fiche existante et la nouvelle source, la NOUVELLE source gagne (le business evolue), mais tu gardes l'ancienne formulation si elle est plus precise.
4. Champ inconnu = chaine vide ou liste vide. Jamais de "N/A", jamais de remplissage.
5. "summary" est lu par un humain ET par le monteur : concret, sans marketing creux, 6 lignes maximum, langue de l'utilisateur.`

async function callClaude(userBlock: string): Promise<Record<string, unknown> | null> {
  const anthKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!anthKey) throw new Error('ANTHROPIC_API_KEY absente')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      output_config: { format: { type: 'json_schema', schema: MEMORY_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: userBlock }] }],
    }),
  })
  if (!res.ok) throw new Error('Claude ' + res.status + ' ' + (await res.text()).slice(0, 200))
  const data = await res.json()
  const txt = (data.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('')
  try { return JSON.parse(txt) } catch (_) { return null }
}

const arr = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).map((x) => String(x || '').trim().slice(0, 160)).filter(Boolean).slice(0, max)
const str = (v: unknown, max: number) => String(v || '').trim().slice(0, max)

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Unauthorized — token manquant' }, 401)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: { user }, error: authErr } = await sb.auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized — session invalide ou expirée' }, 401)

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '').trim()
    if (action !== 'from_site' && action !== 'learn') return json({ error: 'action inconnue' }, 400)

    // fiche actuelle (RLS : forcément la sienne)
    const { data: cur } = await sb.from('brand_memory').select('*').eq('user_id', user.id).maybeSingle()
    if (action === 'learn' && cur && cur.auto_learn === false) return json({ ok: true, skipped: 'auto_learn désactivé' })

    const website = str(body.website, 300) || str(cur?.site_url, 300)
    const brief = str(body.brief, 900)
    const transcript = str(body.transcript, 3000)

    // site : cache 14 jours (le crawl coûte ~1 s à chaque montage sinon)
    let siteCtx = ''
    let siteFresh = false
    const cacheAge = cur?.site_fetched_at ? Date.now() - new Date(cur.site_fetched_at).getTime() : Infinity
    const sameSite = !!cur?.site_url && !!website && cur.site_url === website
    if (sameSite && cur?.site_cache && cacheAge < SITE_TTL_MS && action === 'learn') {
      siteCtx = cur.site_cache
    } else if (website) {
      siteCtx = await fetchSite(website)
      siteFresh = !!siteCtx
    }

    if (action === 'from_site' && !siteCtx && !brief) {
      return json({ error: 'Rien à lire : site injoignable et aucun brief fourni.' }, 422)
    }

    const parts: string[] = []
    if (cur?.summary || cur?.facts) {
      parts.push('FICHE EXISTANTE (à compléter, jamais à vider) :\n' + JSON.stringify({ summary: cur?.summary || '', ...(cur?.facts || {}) }, null, 1))
    } else {
      parts.push('FICHE EXISTANTE : aucune (premier remplissage).')
    }
    if (siteCtx) parts.push('SITE WEB DE L\'UTILISATEUR (' + website + ') :\n' + siteCtx)
    if (brief) parts.push('BRIEF QU\'IL VIENT D\'ECRIRE :\n' + brief)
    if (transcript) parts.push('CE QU\'IL DIT DANS SA DERNIERE VIDEO (transcription) :\n' + transcript)
    parts.push(action === 'from_site'
      ? 'Construis la fiche a partir du site.'
      : 'Mets a jour la fiche avec ce que cette nouvelle video/brief revele de neuf. Si rien de neuf, renvoie la fiche telle quelle.')

    const out = await callClaude(parts.join('\n\n---\n\n'))
    if (!out) return json({ error: 'Réponse illisible du modèle' }, 502)

    const facts = {
      business: str(out.business, 400),
      produit: str(out.produit, 300),
      features: arr(out.features, 12),
      chiffres: arr(out.chiffres, 10),
      audience: str(out.audience, 250),
      offres: str(out.offres, 400),
      reseaux: arr(out.reseaux, 8),
      ton: str(out.ton, 200),
      cta: str(out.cta, 160),
      interdits: arr(out.interdits, 8),
    }
    const summary = str(out.summary, MAX_SUMMARY)

    const row: Record<string, unknown> = { user_id: user.id, summary, facts }
    if (website) row.site_url = website
    if (siteFresh) { row.site_cache = siteCtx.slice(0, 5800); row.site_fetched_at = new Date().toISOString() }

    const { error: upErr } = await sb.from('brand_memory').upsert(row, { onConflict: 'user_id' })
    if (upErr) return json({ error: 'Enregistrement : ' + upErr.message }, 500)

    return json({ ok: true, summary, facts, site_used: !!siteCtx })
  } catch (err) {
    console.error('brand-memory error:', err)
    return json({ error: String((err as Error)?.message || err).slice(0, 300) }, 500)
  }
})
