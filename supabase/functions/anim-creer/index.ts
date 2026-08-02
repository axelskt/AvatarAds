// ── #38 · L'UTILISATEUR CRÉE SON ANIMATION ───────────────────────────────────
//
// Axel, 02/08 : « l'user appuie sur un bouton créer une animation, il arrive sur
// une zone de texte, l'IA crée et après lui propose l'animation ; s'il la garde
// elle est enregistrée et il peut l'utiliser directement et plus tard, puisqu'elle
// sera enregistrée dans "Ma marque" ».
//
// Et sur la méthode, après un premier essai raté à base de formes composables :
// « je veux une animation comme les 150 autres, pas une pauvre pastille » —
// « toi tu les crées comment les animations là ? »
//
// Réponse honnête : je les écris en HTML + GSAP, dans anim-pack.mjs. Une
// fonction qui renvoie du balisage positionné en absolu, une autre qui renvoie
// des lignes de timeline. Rien qu'un modèle ne sache reproduire. Ce qui rend les
// 164 bonnes, ce n'est pas la façon de les écrire, c'est la BOUCLE : je rends,
// je regarde, je corrige, Axel valide. Le parcours ci-dessus reproduit cette
// boucle avec l'utilisateur comme relecteur — et c'est ÇA, la sécurité, pas
// l'interdiction d'écrire du code.
//
// Le modèle écrit donc la vraie animation. Ce qu'on encadre, c'est ce que ce
// code a le droit de TOUCHER : pas de script, pas de réseau, pas de minuteur,
// pas d'URL, rien qui sorte du cadre. `verifier()` rejette avant même que
// l'aperçu soit joué — l'utilisateur ne voit jamais une animation dangereuse,
// et l'aperçu tourne dans une iframe isolée, côté navigateur, gratuitement.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-sonnet-5'

// ── CE QUE LE CODE GÉNÉRÉ N'A PAS LE DROIT DE FAIRE ─────────────────────────
// La liste est courte et volontairement brutale : une animation dessine, elle
// ne charge rien, ne mesure rien, ne sort pas de son cadre. Tout ce qui pourrait
// atteindre le réseau, le document ou l'horloge est refusé — pas assaini,
// REFUSÉ : une animation à moitié sûre n'existe pas.
const INTERDITS: [RegExp, string][] = [
  [/<script|<\/script|<iframe|<object|<embed|<link|<meta/i, 'balise interdite'],
  [/\bon[a-z]+\s*=/i, 'attribut événementiel'],
  // ⚠ l'espace de noms SVG (http://www.w3.org/2000/svg) est légitime et ne
  // charge rien : il est retiré avant le test, sinon toute animation avec du SVG
  // était refusée — mesuré au premier essai réel.
  [/https?:\/\//i, 'URL externe'],
  [/\bsrc\s*=|\bhref\s*=\s*["']?(?!#)/i, 'ressource externe'],
  [/\bfetch\b|XMLHttpRequest|WebSocket|EventSource|navigator\.|localStorage|sessionStorage|indexedDB|document\.cookie/i, 'accès interdit'],
  [/\bsetTimeout\b|\bsetInterval\b|requestAnimationFrame|\bDate\b|Math\.random/i, 'minuteur ou hasard'],
  [/\beval\b|Function\s*\(|import\s|require\s*\(|\bwindow\b|\bglobalThis\b|__proto__|constructor\s*\[/i, 'échappatoire'],
  [/position\s*:\s*fixed|z-index\s*:\s*9{4,}/i, 'sort de son cadre'],
]

function verifier(html: string, js: string): string | null {
  const tout = `${html}\n${js}`
    .replace(/xmlns(:\w+)?\s*=\s*["']https?:\/\/www\.w3\.org\/[^"']*["']/gi, '')
  for (const [re, quoi] of INTERDITS) if (re.test(tout)) return quoi
  if (html.length > 9000 || js.length > 5000) return 'trop long'
  if (!/<(div|span|svg|p)\b/i.test(html)) return 'ne dessine rien'
  // le balisage doit être équilibré, sinon il casse la page qui l'accueille
  const ouv = (html.match(/<(div|span|svg|g|p)\b/gi) || []).length
  const fer = (html.match(/<\/(div|span|svg|g|p)>/gi) || []).length
  if (ouv !== fer) return 'balises non refermées'
  return null
}

const CONSIGNE = `Tu écris UNE animation de motion design pour une vidéo verticale 9:16, dans le style d'AvatarAds : fond clair, formes simples, beaucoup d'air, orange #FF5A36 comme unique couleur d'accent, encre #141418, gris doux #EFEFF4, bordures #E4E4EC.

Tu écris exactement comme les 164 animations du produit : du HTML positionné en absolu (des div, des span, du SVG au trait) et des lignes de timeline GSAP. Rien d'autre.

CADRE DE TRAVAIL
· Tu dessines dans une zone de 930 × 600 pixels. L'origine (0,0) est en haut à gauche.
· Chaque élément porte un id qui COMMENCE par __ID__ (il sera préfixé au montage) : id="__ID__a", id="__ID__b"…
· Chaque élément a la classe "an-p" et un style inline avec position:absolute, left, top, width, height.
· L'animation dure environ 2,4 s. Dans le JS, les temps sont RELATIFS : écris __T0__ + 0.3 pour « 0,3 s après le début ».

CE QUE TU ÉCRIS
{ "nom": "...", "mots": ["..."], "montre": "...", "html": "...", "js": "..." }
· nom    : minuscules et tirets, trois mots maximum
· mots   : les mots prononcés qui doivent déclencher cette animation dans un montage
· montre : ce qu'on voit bouger, en une phrase
· html   : le balisage, sur une seule chaîne
· js     : les lignes GSAP, une par ligne, de la forme
           tl.fromTo('#__ID__a', { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.6)' }, __T0__ + 0.1);

INTERDITS ABSOLUS (l'animation est jetée sans être montrée)
· aucune balise script, iframe, link, meta · aucun attribut onclick et compagnie
· aucune URL, aucune image externe, aucune police externe (utilise Inter, Helvetica, Arial)
· aucun fetch, aucun setTimeout, aucun Date, aucun Math.random
· aucun position:fixed

CE QUI FAIT UNE BONNE ANIMATION ICI
· Elle MONTRE la chose dont on parle : un objet reconnaissable qui bouge, pas une icône posée sur un fond.
· Elle raconte en trois temps : quelque chose arrive, quelque chose se passe, quelque chose se conclut.
· Le texte est rare et court. S'il y en a, il vient des mots de l'utilisateur, jamais d'un chiffre inventé.
· Les formes sont grandes : on la regarde sur un téléphone, en scrollant.

Réponds UNIQUEMENT par l'objet JSON, sans texte autour, sans balise de code.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  const anthKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!anthKey) return json({ ok: false, erreur: 'ANTHROPIC_API_KEY manquante' }, 500)

  let body: { demande?: string; phrase?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON invalide' }, 400) }

  const demande = String(body.demande || '').trim().slice(0, 400)
  if (demande.length < 4) return json({ error: 'Décris ce que tu veux voir.' }, 400)
  const phrase = String(body.phrase || '').trim().slice(0, 300)

  const user = `Ce que je veux voir : ${demande}`
    + (phrase ? `\n\nLa phrase prononcée à ce moment-là : « ${phrase} »` : '')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        // effort bas : sans ça le modèle dépense son budget en délibération et
        // n'émet plus rien — mesuré au premier essai, « réponse illisible ».
        output_config: { effort: 'low' },
        system: CONSIGNE,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) return json({ ok: false, erreur: `Claude ${res.status}` })
    const data = await res.json()
    const texte = String((data?.content || []).map((c: { text?: string }) => c?.text || '').join('\n'))
    const m = texte.match(/\{[\s\S]*\}/)
    if (!m) return json({ ok: false, erreur: 'réponse illisible', brut: texte.slice(0, 500), stop: data?.stop_reason })
    let a: Record<string, unknown>
    try { a = JSON.parse(m[0]) } catch { return json({ ok: false, erreur: 'JSON illisible' }) }

    const html = String(a.html || '')
    const js = String(a.js || '')
    const faute = verifier(html, js)
    if (faute) return json({ ok: false, erreur: `animation refusée : ${faute}` })

    const nom = String(a.nom || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'sans-nom'
    const mots = (Array.isArray(a.mots) ? a.mots : []).map((x) => String(x).toLowerCase().trim())
      .filter((x) => x.length >= 3).slice(0, 8)
    return json({ ok: true, anim: { nom, mots, montre: String(a.montre || '').slice(0, 160), html, js } })
  } catch (e) {
    return json({ ok: false, erreur: String(e).slice(0, 200) })
  }
})
