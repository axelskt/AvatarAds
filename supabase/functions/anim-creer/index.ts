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

CE QUI FAIT UNE BONNE ANIMATION ICI — et c'est là que presque tout se joue

1. TU DESSINES L'OBJET, TU NE LE SYMBOLISES PAS.
   Une machine de musculation, c'est un montant, un siège, un bras de levier et
   une pile de poids qui monte. Pas un rectangle avec une étiquette « machine ».
   Un micro, c'est une capsule, une grille, un pied. Prends le temps de le
   construire avec 6 à 15 formes : c'est ce qui sépare une vraie animation d'un
   schéma. Sers-toi des bordures arrondies, des ombres douces, des dégradés.

2. QUELQUE CHOSE DOIT SE TRANSFORMER, PAS SEULEMENT APPARAÎTRE.
   Une forme qui arrive en fondu n'est pas une animation, c'est une apparition.
   Ce qu'on veut voir : une barre qui se remplit, un curseur qui traverse et
   clique, un objet qui se plie, une pile qui monte cran par cran, deux éléments
   qui se rejoignent, un compteur qui grimpe, une onde qui ondule. Il faut un
   MOUVEMENT INTERNE, entre 1 s et 2 s, qui raconte l'action du verbe.

3. LE CADRE EST REMPLI, ET LA SCÈNE EST CENTRÉE SUR (465, 300).
   C'est le centre exact de la zone. Avant d'écrire, calcule la largeur et la
   hauteur totales de ta composition, puis place-la pour que son milieu tombe
   sur ce point : une scène collée en haut à gauche laisse les deux tiers de
   l'écran vides, et sur un téléphone ça ne se rattrape pas. Vise 700 à 850 px
   de large et 350 à 500 px de haut pour l'ensemble.

4. TROIS TEMPS, PAS UN.
   0 à 0,5 s : le décor arrive. 0,5 à 1,8 s : l'action se produit — c'est le
   coeur. 1,8 à 2,4 s : la conclusion (une coche, un compteur qui s'arrête, une
   pièce qui se pose).

5. LE TEXTE EST RARE.
   Au plus deux mots, et seulement s'ils viennent de la phrase prononcée. Jamais
   un chiffre inventé. Une animation qui a besoin d'être légendée a raté.

Ordre de grandeur : les animations du produit font 4 à 7 ko de HTML et 8 à 20
tweens. Si tu écris moins de 2 ko ou moins de 6 tweens, c'est que tu as fait un
schéma, pas une animation — recommence en dessinant vraiment l'objet.

DEUX ANIMATIONS DU PRODUIT, EN ENTIER — c'est le niveau à tenir
Axel : « faut qu'il ait accès aux 164 animations pour qu'il voie le style ».
Lis-les vraiment : la densité des formes, les ombres, les rayons, les tailles,
la façon dont le mouvement raconte l'action. Écris au même niveau. Ne les copie
pas — c'est le SOIN qu'on te demande de reprendre, pas le dessin.

--- EXEMPLE : timeline ---
HTML :
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" style="left:20px;top:79px;width:168px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:191px;top:79px;width:143px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:337px;top:79px;width:155px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:495px;top:79px;width:131px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span>
        <span class="an-p" style="left:20px;top:223px;width:609px;height:111px;border-radius:20px;background:rgba(17,17,17,.10);overflow:hidden"><span style="position:absolute;left:12px;top:46px;width:5px;height:20px;border-radius:99px;background:#111111;opacity:.6"></span><span style="position:absolute;left:31px;top:12px;width:5px;height:87px;border-radius:99px;background:#111111;opacity:.6"></span><span style="position:absolute;left:50px;top:44px;width:5px;height:24px;border-radius:99px;background:#111111;opacity:.6"></span><span style="position:absolute;left:69px;top:13px;width:5px;height:86px;border-radius:99px;background:#111111;opacity:.6"></span><span style="position:absolute;left:88px;top:42px;width:5px;height:28px;border-radius:99px;background:#111111;opacity:.6"></span><span style="position:absolute;left:107px;top:13px;width:5px;height:86px;border-radius:99px;background:#111111;opacity:.6"></span><span style="position:absolute;left:126px;top:40px;width:5px;height:32px;border-radius:99px;background:#111111;opacity:.6"></span><span style="position:absolute;left:145px;top:13px;width:5px;height:85px;border-radius:99px;background:#111111;opacity:.6"></span><spa

JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, __T0__ + 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,stagger:0.04,ease:'power2.out'},__T0__ + 0.05);
      tl.fromTo('#__ID__tp',{x:0},{x:()=>document.getElementById('__ID__an').getBoundingClientRect().width*0.9,duration:1.8,ease:'none'},0.35);

--- EXEMPLE : connect ---
HTML :
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <div class="an-p" id="__ID__c1" style="left:50px;top:165px;width:227px;height:227px;border-radius:54px;overflow:hidden;box-shadow:0 26px 60px rgba(0,0,0,.45)">
          <img src="tuto/logo-avatarads.png" style="width:100%;height:100%;object-fit:cover;display:block"/></div>
        <div class="an-p" id="__ID__c2" style="left:372px;top:165px;width:227px;height:227px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 26px 60px rgba(0,0,0,.45))">
          <img src="tuto/logo-claude.png" style="width:100%;height:100%;object-fit:contain;display:block"/></div>
        <span id="__ID__cw" style="position:absolute;left:325px;top:279px;width:95px;height:12px;margin-left:-48px;margin-top:-6px;border-radius:99px;background:#111111;transform-origin:50% 50%"></span>
        <span id="__ID__ck" style="position:absolute;left:325px;top:279px;width:73px;height:73px;margin-left:-36px;margin-top:-36px;border-radius:50%;background:#22C55E;display:flex;align-items:center;justify-content:center;opacity:0;box-shadow:0 12px 34px rgba(34,197,94,.5)">
          <svg width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.6l5 5 10-11"/></svg></span></div>

JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, __T0__ + 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__c1', { xPercent: -70, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.42, ease: 'power3.out' }, __T0__ + 0.05);
      tl.fromTo('#__ID__c2', { xPercent: 70, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.42, ease: 'power3.out' }, __T0__ + 0.05);
      tl.fromTo('#__ID__cw', { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.22, ease: 'power2.out' }, 0.43);
      tl.to(['#__ID__c1', '#__ID__c2'], { x: 0, duration: 0.14, ease: 'power2.in' }, 0.61);
      tl.fromTo('#__ID__ck', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration:

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
