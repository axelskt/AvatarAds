// Supabase Edge Function — 🧠 Mémoire de marque (#124)
//
// Une fiche persistante par utilisateur, volontairement MINIMALE : une
// description de son activité + la liste de ses fonctionnalités principales.
// Le chef d'orchestre la reçoit à CHAQUE montage → l'user ne retape plus son
// contexte, et les slides emploient ses vrais noms dès la 1re vidéo.
// Le reste (prix, ton, réseaux, CTA) n'aide pas à monter une vidéo : on ne le
// collecte pas.
//
// La lecture/écriture « simple » se fait côté client (RLS + privilèges
// colonne sur public.brand_memory). Cette fonction ne sert qu'aux deux
// opérations qui demandent Claude :
//
//   POST { action:'from_site', website }                → 1er remplissage depuis le site
//   POST { action:'learn', brief?, transcript?, website?, images? } → enrichissement après un montage
//
// ⚠️ RISQUE PUBLICITAIRE : les chiffres de preuve sociale d'un site (« +40K
// utilisateurs », « 4,9/5 ») sont invérifiables et font rejeter les pubs Meta et
// TikTok Ads. On ne les collecte pas du tout.
//
// #125 — les CAPTURES D'ÉCRAN comptent autant que le site : une app derrière un
// écran de connexion n'expose rien publiquement, donc les visuels que l'utilisateur
// fournit pour son montage sont souvent la seule source fiable sur ses vraies
// fonctionnalités.
//
// Règle absolue : on n'INVENTE rien. On ne garde que ce qui est écrit sur le site /
// visible sur les captures / dit dans l'audio / donné dans le brief. Et on ne
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
  required: ['summary', 'features'],
  properties: {
    summary: { type: 'string', description: 'La description de son activité : simple, efficace, factuelle. 4 lignes maximum. C\'est ce que le monteur lit en premier.' },
    features: { type: 'array', items: { type: 'string' }, description: 'Ses fonctionnalités / offres PRINCIPALES, celles mises en avant partout (titre, hero, navigation, tarifs). Le nom tel qu\'il l\'emploie, court. Pas les détails secondaires.' },
  },
}

const SYSTEM = `Tu construis la FICHE DE MARQUE d'un utilisateur d'AvatarAds (outil de montage video IA).
Elle est relue a chaque nouvelle video pour que le monteur sache de quoi il parle. Elle tient en DEUX choses : une description, et la liste de ses fonctionnalites principales.

REGLES ABSOLUES :
1. Tu n'INVENTES RIEN. Tout vient du site, des captures, du brief ou de ce qui est dit dans l'audio.
2. Tu ne SUPPRIMES JAMAIS ce qui est deja dans la fiche — surtout si l'utilisateur l'a ecrit lui-meme. Tu completes et tu fusionnes les doublons.
3. En cas de contradiction, la NOUVELLE source gagne (le business evolue), mais tu gardes la formulation la plus precise.
4. Rien a dire = chaine vide ou liste vide. Jamais de \"N/A\", jamais de remplissage.
5. Si on te donne des CAPTURES D'ECRAN de son produit : c'est souvent la seule source fiable, une app derriere un ecran de connexion n'expose rien publiquement. Lis les VRAIS libelles affiches. Ne devine jamais ce qu'il y a derriere un bouton que tu ne vois pas.
6. Tu ne collectes AUCUN chiffre de preuve sociale (\"+40K utilisateurs\", \"+2 milliards de vues\", \"4,9/5\"). Ils sont invérifiables : affiches dans une video ils font REJETER les publicites sur Meta Ads et TikTok Ads. Ils n'ont rien a faire dans la fiche.
7. Tu ne collectes pas non plus les prix, le ton, les reseaux sociaux ni le call-to-action : ca n'aide pas a monter une video et ca encombre.
8. \"summary\" est lu par un humain ET par le monteur : concret, sans marketing creux, 4 lignes maximum, dans la langue de l'utilisateur.`

async function callClaude(userBlock: string, images: { media: string; b64: string }[] = []): Promise<Record<string, unknown> | null> {
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
      messages: [{ role: 'user', content: [
        ...images.flatMap((im) => ([
          { type: 'text', text: 'Capture d\'ecran de son produit (lis les VRAIS libelles affiches) :' },
          { type: 'image', source: { type: 'base64', media_type: im.media, data: im.b64 } },
        ])),
        { type: 'text', text: userBlock },
      ] }],
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
    // captures d'ecran : les visuels que l'utilisateur a fournis pour son montage.
    // Pour une app derriere un login, c'est la seule facon de connaitre ses vraies
    // fonctionnalites — le site public ne les montre pas.
    const images = (Array.isArray(body.images) ? body.images : []).slice(0, 4)
      .map((im: { media?: string; b64?: string }) => ({ media: String(im?.media || 'image/jpeg'), b64: String(im?.b64 || '') }))
      .filter((im: { b64: string }) => im.b64.length > 100 && im.b64.length < 1_400_000)

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

    if (action === 'from_site' && !siteCtx && !brief && !images.length) {
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

    if (images.length) parts.push('Des captures de son produit sont jointes ci-dessus : sers-t\'en pour ses vrais noms de fonctionnalites et de forfaits.')
    const out = await callClaude(parts.join('\n\n---\n\n'), images)
    if (!out) return json({ error: 'Réponse illisible du modèle' }, 502)

    const facts = { features: arr(out.features, 12) }
    const summary = str(out.summary, MAX_SUMMARY)

    const row: Record<string, unknown> = { user_id: user.id, summary, facts }
    if (website) row.site_url = website
    if (siteFresh) { row.site_cache = siteCtx.slice(0, 5800); row.site_fetched_at = new Date().toISOString() }

    const { error: upErr } = await sb.from('brand_memory').upsert(row, { onConflict: 'user_id' })
    if (upErr) return json({ error: 'Enregistrement : ' + upErr.message }, 500)

    return json({ ok: true, summary, facts, site_used: !!siteCtx, images_used: images.length })
  } catch (err) {
    console.error('brand-memory error:', err)
    return json({ error: String((err as Error)?.message || err).slice(0, 300) }, 500)
  }
})
