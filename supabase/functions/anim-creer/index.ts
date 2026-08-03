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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// ── LE CENTRAGE NE SE DEMANDE PAS, IL SE CALCULE ───────────────────────────
// Trois versions que la consigne dit « centre sur (465, 300) » et que le modèle
// colle sa scène en haut à gauche. C'est normal : il écrit des coordonnées une
// par une, sans jamais voir le résultat. On ne le lui redemande donc plus — on
// mesure la boîte englobante de ce qu'il a écrit et on décale tout d'un bloc.
// Pur calcul sur les styles inline, déterministe, et valable aussi bien pour
// l'aperçu du navigateur que pour le rendu final.
const CADRE_W = 930, CADRE_H = 600
function recentrer(html: string): string {
  const el = [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)]
  const nb = (css: string, prop: string): number | null => {
    const m = css.match(new RegExp(prop + '\\s*:\\s*(-?[\\d.]+)px'))
    return m ? parseFloat(m[1]) : null
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const m of el) {
    const css = m[1]
    if (!/position\s*:\s*absolute/.test(css)) continue
    const l = nb(css, 'left'), t = nb(css, 'top')
    if (l === null || t === null) continue
    const w = nb(css, 'width') ?? 0, h = nb(css, 'height') ?? 0
    x0 = Math.min(x0, l); y0 = Math.min(y0, t)
    x1 = Math.max(x1, l + w); y1 = Math.max(y1, t + h)
  }
  if (!isFinite(x0) || !isFinite(y0) || x1 <= x0) return html
  const dx = Math.round((CADRE_W - (x1 - x0)) / 2 - x0)
  const dy = Math.round((CADRE_H - (y1 - y0)) / 2 - y0)
  if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return html
  // on décale CHAQUE élément positionné du même vecteur : la composition ne
  // bouge pas d'un pixel les uns par rapport aux autres, elle se recentre.
  return html.replace(/style\s*=\s*"([^"]*)"/gi, (tout, css: string) => {
    if (!/position\s*:\s*absolute/.test(css)) return tout
    const l = nb(css, 'left'), t = nb(css, 'top')
    if (l === null || t === null) return tout
    const neuf = css
      .replace(/left\s*:\s*-?[\d.]+px/, `left:${Math.round(l + dx)}px`)
      .replace(/top\s*:\s*-?[\d.]+px/, `top:${Math.round(t + dy)}px`)
    return `style="${neuf}"`
  })
}

// ── L'ANIMATION NE S'EFFACE PAS TOUTE SEULE ────────────────────────────────
// Le modèle ajoute presque toujours un fondu de sortie sur ses propres
// éléments : à 2,4 s l'écran est vide alors que la scène dure encore. Or le
// moteur fait DÉJÀ disparaître l'ensemble du panneau à la fin (inOut). Ces
// sorties-là sont donc du travail en double, et elles coupent la scène trop
// tôt. On retire les tweens qui éteignent après 1,5 s.
function tenirJusquAuBout(js: string): string {
  return js.split('\n').filter((l) => {
    if (!/autoAlpha\s*:\s*0|opacity\s*:\s*0/.test(l)) return true
    if (/fromTo/.test(l)) return true                       // c'est une entrée
    const m = l.match(/,\s*(?:__T0__\s*\+\s*)?([\d.]+)\s*\)\s*;?\s*$/)
    return !(m && parseFloat(m[1]) >= 1.5)
  }).join('\n')
}

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

VINGT ANIMATIONS DU PRODUIT — la direction artistique, en entier
Axel : « donne-lui plus de contexte, genre une vingtaine, pour qu'il voie
exactement le design et la DA qu'on attend ». Les voici : les vingt plus riches
de la banque, celles qui ont le plus de matière à l'écran.

Regarde-les comme un directeur artistique, pas comme un développeur. Ce qu'il
faut en retirer : la DENSITÉ (une scène, c'est dix à trente éléments, pas
trois), les ombres portées longues et douces, les rayons généreux, les
épaisseurs de trait franches, les gris très clairs (#EFEFF4, #E4E4EC) qui
laissent l'orange ressortir seul, et surtout la manière dont chacune invente un
mouvement PROPRE à ce qu'elle raconte au lieu de faire apparaître des formes.

Ne les copie pas. Reprends ce niveau de soin, et trouve le mouvement juste pour
ce qu'on te demande.

--- comment ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p an-kk" id="__ID__kk0" style="left:8px;top:300px;width:56px;height:74px;border-radius:12px;background:rgba(17,17,17,.10);border:1px solid rgba(17,17,17,.20);display:flex;align-items:center;justify-content:center;font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;font-weight:600;font-size:26px;color:#111111;overflow:hidden">A<span id="__ID__kh0" style="position:absolute;inset:0;background:#FF5A36;opacity:0"></span></span><span class="an-p an-kk" id="__ID__kk1" style="left:72px;top:300px;width:56px;height:74px;border-radius:12px;background:rgba(17,17,17,.10);border:1px solid rgba(17,17,17,.20);display:flex;align-items:center;justify-content:center;font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;font-weight:600;font-size:26px;color:#111111;overflow:hidden">Z<span id="__ID__kh1" style="position:absolute;inset:0;background:#FF5A36;opacity:0"></span></span><span class="an-p an-kk" id="__ID__kk2" style="left:136px;top:300px;width:56px;height:74px;border-radius:12px;background:rgba(17,17,17,.10);border:1px solid rgba(17,17,17,.20);display:flex;align-items:center;justify-content:center;font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;font-weight:600;font-size:26px;color:#111111;overf
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-kk',{y:()=>document.getElementById('__ID__an').getBoundingClientRect().height*0.06,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,stagger:0.006,ease:'power2.out'},0.05);
      tl.fromTo('#__ID__cf',{y:-14,autoAlpha:0},{y:0,autoAlpha:1,durati

--- qr ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <span class="an-p" id="__ID__qb" style="left:38px;top:136px;width:285px;height:285px;background:#FFFFFF;border-radius:23px;overflow:hidden;padding:0"><span style="position:absolute;left:22px;top:22px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:44px;top:22px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:66px;top:22px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:88px;top:22px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:110px;top:22px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:132px;top:22px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:154px;top:22px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:22px;top:44px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:154px;top:44px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:22px;top:66px;width:22px;height:22px;background:#111111"></span><span style="position:absolute;left:66px;top:66px;width:22px;height:22px;background:#111111"></span><sp
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__qb',{scale:0.86,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(1.9)'},0.05);
      tl.fromTo('#__ID__ql',{y:0,autoAlpha:0.9},{y:()=>document.getElementById('__ID__qb').offsetHeight,autoAlpha:0.9,duration:0.5,ease:'power1.inOut'},

--- crowd ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><div class="an-p an-cw" style="left:14px;top:90px;width:62px;height:62px;opacity:0">
          <span style="position:absolute;left:25%;top:0;width:50%;height:50%;border-radius:50%;background:rgba(17,17,17,.10)"></span>
          <span style="position:absolute;left:8%;top:56%;width:84%;height:44%;border-radius:19px 19px 0 0;background:rgba(17,17,17,.10)"></span></div><div class="an-p an-cw" style="left:107px;top:90px;width:62px;height:62px;opacity:0">
          <span style="position:absolute;left:25%;top:0;width:50%;height:50%;border-radius:50%;background:rgba(17,17,17,.10)"></span>
          <span style="position:absolute;left:8%;top:56%;width:84%;height:44%;border-radius:19px 19px 0 0;background:rgba(17,17,17,.10)"></span></div><div class="an-p an-cw" style="left:200px;top:90px;width:62px;height:62px;opacity:0">
          <span style="position:absolute;left:25%;top:0;width:50%;height:50%;border-radius:50%;background:#FF5A36"></span>
          <span style="position:absolute;left:8%;top:56%;width:84%;height:44%;border-radius:19px 19px 0 0;background:#FF5A36"></span></div><div class="an-p an-cw" style="left:293px;top:90px;width:62px;height:62px;opacity:0">
          <span style="position:absolute;left:25%;top:0;width:50%;height:50%;border-radius:50
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-cw',{scale:0.4,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,stagger:{each:0.022,from:'center'},ease:'back.out(2)',transformOrigin:'50% 100%'},0.05);

--- salesphone ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><div class="an-ph" id="__ID__ph" style="left:190px;top:6px;width:268px;height:546px;border-radius:35px;background:#0B0B0D;border:6px solid #26262B;overflow:hidden;box-shadow:0 28px 60px -18px rgba(0,0,0,.45)">
        <span style="position:absolute;inset:8px;border-radius:30px;background:linear-gradient(165deg,#2A2F3A,#12141A 62%,#0B0B0D)"></span>
        <span style="position:absolute;left:50%;top:13px;transform:translateX(-50%);width:86px;height:24px;border-radius:99px;background:#000"></span>
        <span style="position:absolute;left:0;right:0;top:46px;text-align:center;font-family:Inter,Helvetica,Arial,sans-serif;font-weight:300;font-size:51px;color:#fff;letter-spacing:-.02em">9:41</span>
        <span class="an-p" id="__ID__bdg" style="left:111px;top:448px;width:46px;height:46px;border-radius:50%;background:#FF3B30;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-weight:800;font-size:26px;color:#fff">0</span>
        <span class="an-p an-sn" id="__ID__sn0" style="left:19px;top:101px;width:230px;height:58px;border-radius:17px;background:rgba(255,255,255,.94);box-shadow:0 10px 26px rgba(0,0,0,.22)">
          <span style="position:absolute;left:12px;top:13px;width:32px;height:32px;border-radius:9px;bac
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      var CNT__ID__ = {v:0};
      var SET__ID__ = (function(){ var el=document.getElementById('__ID__bdg');
        return function(){ if(el) el.textContent = Math.round(CNT__ID__.v); }; })();
      tl.fromTo('#__ID__ph',{y:()=>document.getElementById('__ID__an').get

--- music ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p"  style="left:33px;top:81px;width:583px;height:134px;border-radius:29px;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20);overflow:hidden"><span style="position:absolute;left:17px;top:57px;width:6px;height:21px;border-radius:99px;background:#111111;opacity:0.7"></span><span style="position:absolute;left:39px;top:15px;width:6px;height:104px;border-radius:99px;background:#111111;opacity:0.7"></span><span style="position:absolute;left:61px;top:51px;width:6px;height:33px;border-radius:99px;background:#111111;opacity:0.7"></span><span style="position:absolute;left:83px;top:16px;width:6px;height:103px;border-radius:99px;background:#111111;opacity:0.7"></span><span style="position:absolute;left:105px;top:45px;width:6px;height:45px;border-radius:99px;background:#111111;opacity:0.7"></span><span style="position:absolute;left:127px;top:18px;width:6px;height:99px;border-radius:99px;background:#111111;opacity:0.7"></span><span style="position:absolute;left:149px;top:39px;width:6px;height:56px;border-radius:99px;background:#111111;opacity:0.7"></span><span style="position:absolute;left:171px;top:20px;width:6px;height:95px;border-radius:99px;background:#111111;opacity:0.7"></span><span style="position:absolute;left:193px;top:3
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,stagger:0.05,ease:'power2.out'},0.05);
      tl.fromTo('#__ID__mt',{x:()=>document.getElementById('__ID__an').getBoundingClientRect().width*0.5,autoAlpha:0},{x:0,autoAlpha:1,duration:0.36,ease:

--- gaugefill ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" style="left:110px;top:56px;width:84px;height:446px;border-radius:39px;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20)"></span>
        <span class="an-p" id="__ID__gfill" style="left:110px;top:56px;width:84px;height:446px;border-radius:39px;background:#FF5A36;transform-origin:50% 100%"></span>
        <span class="an-p" style="left:74px;top:500px;width:26px;height:4px;border-radius:99px;background:#111111;opacity:.3"></span>
          <span style="position:absolute;left:0;top:485px;width:66px;text-align:right;font-family:Inter,sans-serif;font-weight:700;font-size:29px;color:#111111;opacity:.45">0</span><span class="an-p" style="left:74px;top:277px;width:26px;height:4px;border-radius:99px;background:#111111;opacity:.3"></span>
          <span style="position:absolute;left:0;top:262px;width:66px;text-align:right;font-family:Inter,sans-serif;font-weight:700;font-size:29px;color:#111111;opacity:.45">50</span><span class="an-p" style="left:74px;top:54px;width:26px;height:4px;border-radius:99px;background:#111111;opacity:.3"></span>
          <span style="position:absolute;left:0;top:39px;width:66px;text-align:right;font-family:Inter,sans-serif;font-weight:700;font-size:29px;color:#111111;opacity:.45">100</span>
   
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__gfill',{scaleY:0},{scaleY:1,duration:1.39,ease:'power1.inOut',transformOrigin:'50% 100%'},0.25);
      (function(){ var el=document.getElementById('__ID__gnum'); if(!el) return;
        var target=(el.getAttribute('data-pct')||'100 %'), n=parse

--- clipping ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <span class="an-p" style="left:33px;top:162px;width:583px;height:234px;border-radius:19px;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20);overflow:hidden"><span class="an-p an-cp" id="__ID__cp0" style="left:17px;top:50%;width:8px;height:70px;margin-top:-35px;border-radius:99px;background:#111111;opacity:0.5;transform-origin:50% 50%"></span><span class="an-p an-cp" id="__ID__cp1" style="left:36px;top:50%;width:8px;height:138px;margin-top:-69px;border-radius:99px;background:#111111;opacity:0.5;transform-origin:50% 50%"></span><span class="an-p an-cp" id="__ID__cp2" style="left:55px;top:50%;width:8px;height:106px;margin-top:-53px;border-radius:99px;background:#111111;opacity:0.5;transform-origin:50% 50%"></span><span class="an-p an-cp" id="__ID__cp3" style="left:74px;top:50%;width:8px;height:118px;margin-top:-59px;border-radius:99px;background:#111111;opacity:0.5;transform-origin:50% 50%"></span><span class="an-p an-cp" id="__ID__cp4" style="left:93px;top:50%;width:8px;height:132px;margin-top:-66px;border-radius:99px;background:#111111;opacity:0.5;transform-origin:50% 50%"></span><span class="an-p an-cp" id="__ID__cp5" style="left:112px;top:50%;width:8px;height:85px;margin-top:-43px;border-radius:99px;background:#111111;op
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-cp', { scaleY: 0.2 }, { scaleY: 1, duration: 0.3, stagger: 0.012, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an .an-cp', { scaleY: 0.55, duration: 0.34, ease: 'power2.inOut' }, 0.77);
      tl.fromTo('#__ID__cpw', { autoAlpha: 0, y

--- tsunami ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><svg class="an-p" id="__ID__svg" style="left:0;top:0" width="648" height="557" viewBox="0 0 648 557">
          <rect x="0" y="479" width="648" height="78" fill="#FF5A36" opacity=".30"/>
          <g class="an-wg" id="__ID__wg0" opacity="0" data-org="130 479">
          <path d="M0 479
          C 57 470, 98 410, 161 407
          C 210 405, 241 431, 205 446
          C 236 457, 251 470, 259 479 Z" fill="#FF5A36"/>
          <path d="M78 436
          C 114 408, 186 403, 220 429
          C 233 440, 218 446, 205 446" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity=".85"/>
        </g>
          <g class="an-wg" id="__ID__wg1" opacity="0" data-org="221 479">
          <path d="M0 479
          C 97 458, 168 308, 273 301
          C 357 296, 410 362, 348 397
          C 401 426, 428 458, 441 479 Z" fill="#FF5A36"/>
          <path d="M132 372
          C 194 303, 318 290, 375 354
          C 397 383, 370 397, 348 397" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" opacity=".85"/>
        </g>
          <g class="an-wg" id="__ID__wg2" opacity="0" data-org="324 479">
          <path d="M0 479
          C 143 438, 246 148, 402 134
          C 525 124, 603 251, 512 320
          C 590 376, 629 438, 64
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__wg0',{x:()=>document.getElementById('__ID__an').getBoundingClientRect().width*-0.16,autoAlpha:0},{x:0,autoAlpha:1,duration:0.42,ease:'power2.out'},0.05);
      tl.to('#__ID__wg0',{x:()=>document.getElementById('__ID__an').getBoundingClientRect(

--- lineup ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" style="left:26px;top:410px;width:596px;height:4px;border-radius:99px;background:#111111;opacity:.35"></span><span class="an-p an-lu" id="__ID__l0" style="left:58px;top:179px;width:156px;height:200px;border-radius:22px;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20);opacity:0;overflow:visible">
          
          <span style="position:absolute;left:25px;top:80px;width:25px;height:36px;border-radius:3px;background:#111111"></span>
          <span style="position:absolute;left:44px;top:64px;width:0;height:0;border-top:34px solid transparent;border-bottom:34px solid transparent;border-right:34px solid #111111"></span>
          <span class="an-p" id="__ID__l0w1" style="left:87px;top:68px;width:22px;height:60px;border:4px solid #FF5A36;border-left:none;border-radius:0 99px 99px 0;background:transparent;opacity:0"></span>
          <span class="an-p" id="__ID__l0w2" style="left:109px;top:54px;width:28px;height:88px;border:4px solid #FF5A36;border-left:none;border-radius:0 99px 99px 0;background:transparent;opacity:0"></span>
          <span class="an-p" id="__ID__l0ck" style="left:auto;right:-8px;top:-8px;width:37px;height:37px;border-radius:50%;background:#FF5A36;opacity:0;display:flex;align-items:center;justify-
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__l0', { y: 64, scale: 0.6, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(2)', transformOrigin: '50% 100%' }, 0.35);
      tl.fromTo('#__ID__l0ck', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0

--- timeline ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" style="left:20px;top:79px;width:168px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:191px;top:79px;width:143px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:337px;top:79px;width:155px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:495px;top:79px;width:131px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span>
        <span class="an-p" style="left:20px;top:223px;width:609px;height:111px;border-radius:20px;background:rgba(17,17,17,.10);overfl
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,stagger:0.04,ease:'power2.out'},0.05);
      tl.fromTo('#__ID__tp',{x:0},{x:()=>document.getElementById('__ID__an').getBoundingClientRect().width*0.9,duration:1.8,ease:'none'},0.35);

--- easydown ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <span class="an-p" style="left:78px;top:479px;width:492px;height:3px;border-radius:99px;background:#111111;opacity:.4"></span>
        <span class="an-p" style="left:78px;top:78px;width:3px;height:401px;border-radius:99px;background:#111111;opacity:.4"></span>
        <span class="an-p" style="left:65px;top:344px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:345px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:241px;top:479px;width:2px;height:10px;background:#111111;opacity:.35"></span><span class="an-p" style="left:65px;top:211px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:212px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:405px;top:479px;width:2px;height:10px;background:#111111;opacity:.35"></span><span class="an-p" style="left:65px;top:77px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:78px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:569px;top:479px;width:2px;height:10px;background:#111111;opacity:
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      (function(){ var p = document.getElementById('__ID__line');
        if (p && p.getTotalLength) { var L = p.getTotalLength();
          p.style.strokeDasharray = L + ' ' + L; p.style.strokeDashoffset = L;
          tl.to(p, { strokeDashoffset: 0, duration: 1.3, e

--- easyup ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <span class="an-p" style="left:78px;top:479px;width:492px;height:3px;border-radius:99px;background:#111111;opacity:.4"></span>
        <span class="an-p" style="left:78px;top:78px;width:3px;height:401px;border-radius:99px;background:#111111;opacity:.4"></span>
        <span class="an-p" style="left:65px;top:344px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:345px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:241px;top:479px;width:2px;height:10px;background:#111111;opacity:.35"></span><span class="an-p" style="left:65px;top:211px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:212px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:405px;top:479px;width:2px;height:10px;background:#111111;opacity:.35"></span><span class="an-p" style="left:65px;top:77px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:78px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:569px;top:479px;width:2px;height:10px;background:#111111;opacity:
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      (function(){ var p = document.getElementById('__ID__line');
        if (p && p.getTotalLength) { var L = p.getTotalLength();
          p.style.strokeDasharray = L + ' ' + L; p.style.strokeDashoffset = L;
          tl.to(p, { strokeDashoffset: 0, duration: 1.3, e

--- oneclick ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" id="__ID__wrap" style="left:123px;top:148px;width:402px;height:245px;perspective:1400px">
          <span class="an-p" id="__ID__lid" style="left:0;top:0;width:402px;height:245px;border-radius:11px 11px 0 0;background:#FFFFFF;border:2px solid rgba(17,17,17,.20);border-bottom:none;overflow:hidden;transform-origin:50% 100%;box-shadow:0 18px 40px -20px rgba(0,0,0,.35)">
            <span class="an-p" id="__ID__ui1" style="left:0;top:0;width:402px;height:245px">
        <span style="position:absolute;left:22px;top:22px;display:flex;gap:8px">
          <span style="width:9px;height:9px;border-radius:50%;background:#FF5F57;display:inline-block"></span><span style="width:9px;height:9px;border-radius:50%;background:#FEBC2E;display:inline-block"></span><span style="width:9px;height:9px;border-radius:50%;background:#28C840;display:inline-block"></span>
        </span>
        <span style="position:absolute;left:22px;top:64px;width:62%;height:9px;border-radius:99px;background:#111111;opacity:0.3"></span><span style="position:absolute;left:22px;top:91px;width:44%;height:9px;border-radius:99px;background:#111111;opacity:0.18"></span><span style="position:absolute;left:22px;top:118px;width:52%;height:9px;border-radius:99px;background:#111111
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__base',{scaleX:0.7,autoAlpha:0},{scaleX:1,autoAlpha:1,duration:0.28,ease:'back.out(1.6)',transformOrigin:'50% 50%'},0.05);
      tl.fromTo('#__ID__lid',{rotationX:-92,autoAlpha:0},{rotationX:0,autoAlpha:1,duration:0.62,ease:'back.out(1.1)',trans

--- voice ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" id="__ID__mic" style="left:0;top:179px;width:111px;height:167px;border-radius:99px;background:#111111"></span><span class="an-p" style="left:47px;top:345px;width:18px;height:56px;background:#111111"></span><span class="an-b w1" id="__ID__w12" style="left:58px;top:74px;width:16px;height:208px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w13" style="left:87px;top:113.5px;width:16px;height:129px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w14" style="left:116px;top:112.5px;width:16px;height:131px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w15" style="left:145px;top:74px;width:16px;height:208px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w16" style="left:174px;top:88.5px;width:16px;height:179px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w17" style="left:203px;top:143.5px;width:16px;height:69px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w18" style="left:232px;top:87px;width:16px;height:182px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w19" style="left:261px;top:74.5px;width:16px;height:207px;backg
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .w1', { scaleY: 0.15 }, { scaleY: 1, duration: 0.5, stagger: 0.02, ease: 'back.out(2)', transformOrigin: '50% 50%' }, 0.05);
      tl.fromTo('#__ID__an .w2', { scaleY: 0.15, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.5, stagger: 

--- booking ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" style="left:33px;top:0;width:107px;height:67px;border-radius:19px;background:rgba(17,17,17,.10);display:flex;align-items:center;justify-content:center">
          <span style="width:45px;height:11px;border-radius:99px;background:#111111;opacity:.42"></span></span><span class="an-p" style="left:152px;top:0;width:107px;height:67px;border-radius:19px;background:rgba(17,17,17,.10);display:flex;align-items:center;justify-content:center">
          <span style="width:45px;height:11px;border-radius:99px;background:#111111;opacity:.42"></span></span><span class="an-p" style="left:271px;top:0;width:107px;height:67px;border-radius:19px;background:rgba(17,17,17,.10);display:flex;align-items:center;justify-content:center">
          <span style="width:45px;height:11px;border-radius:99px;background:#111111;opacity:.42"></span></span><span class="an-p" style="left:390px;top:0;width:107px;height:67px;border-radius:19px;background:rgba(17,17,17,.10);display:flex;align-items:center;justify-content:center">
          <span style="width:45px;height:11px;border-radius:99px;background:#111111;opacity:.42"></span></span><span class="an-p" style="left:509px;top:0;width:107px;height:67px;border-radius:19px;background:rgba(17,17,17,.10);display:flex;al
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-p',{scale:0.86,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.012,ease:'power3.out',transformOrigin:'50% 50%'},0.05);
      tl.fromTo('#__ID__bk12',{scale:1},{scale:1.18,duration:0.3,ease:'back.out(2.6)',transformOrigin:'50% 5

--- schedule ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" style="left:26px;top:97px;width:138px;height:111px;border-radius:22px;background:rgba(17,17,17,.10);border:2px dashed rgba(17,17,17,.20)"></span>
        <span class="an-p" style="left:179px;top:97px;width:138px;height:111px;border-radius:22px;background:rgba(17,17,17,.10);border:2px dashed rgba(17,17,17,.20)"></span>
        <span class="an-p an-sc" id="__ID__sc1" style="left:179px;top:97px;width:138px;height:111px;border-radius:22px;background:#FF5A36;overflow:hidden">
          <span style="position:absolute;left:14%;top:22%;width:62%;height:9px;border-radius:99px;background:rgba(255,255,255,.9)"></span>
          <span style="position:absolute;left:14%;top:44%;width:40%;height:8px;border-radius:99px;background:rgba(255,255,255,.6)"></span>
          <span style="position:absolute;left:14%;bottom:16%;width:41px;height:18px;border-radius:99px;background:rgba(255,255,255,.24)"></span></span><span class="an-p" style="left:332px;top:97px;width:138px;height:111px;border-radius:22px;background:rgba(17,17,17,.10);border:2px dashed rgba(17,17,17,.20)"></span>
        <span class="an-p" style="left:485px;top:97px;width:138px;height:111px;border-radius:22px;background:rgba(17,17,17,.10);border:2px dashed rgba(17,17,17,.20)"></span>
  
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-p',{scale:0.88,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.02,ease:'power3.out',transformOrigin:'50% 50%'},0.05);
      tl.fromTo('#__ID__an .an-sc',{y:()=>document.getElementById('__ID__an').getBoundingClientRect().height*

--- views ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <div class="an-p" id="__ID__vw" style="left:202px;top:28px;width:245px;height:421px;border-radius:29px;overflow:hidden;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20);box-shadow:0 20px 46px rgba(0,0,0,.24)">
          <span style="position:absolute;inset:0;background:linear-gradient(150deg,rgba(255,255,255,.22),rgba(0,0,0,.30)),#FF5A36"></span>
          <span style="position:absolute;left:0;bottom:0;width:100%;height:8px;background:rgba(255,255,255,.3)">
            <span class="an-p" id="__ID__vwp" style="left:0;top:0;width:100%;height:100%;background:#FF5A36;transform-origin:0% 50%;transform:scaleX(0)"></span></span>
          <svg class="an-p" id="__ID__vwt" viewBox="0 0 24 24" style="left:50%;margin-left:-32px;top:50%;margin-top:-32px;width:64px;height:64px" fill="#FFFFFF" opacity=".9"><path d="M8 5v14l11-7z"/></svg></div>
        <span class="an-p" id="__ID__vwn" style="left:0;top:471px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:78px;color:#FF5A36;transform-origin:50% 50%">Montage</span>
        <span class="an-p" style="left:0;top:560px;width:100%;text-align:center;font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;font-weight:800;letter-spacing:.14em;font-size:
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__vw',{scale:0.9,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(1.7)'},0.05);
      tl.to('#__ID__vwt',{scale:0.7,autoAlpha:0,duration:0.24,ease:'power2.in',transformOrigin:'50% 50%'},0.35);
      tl.to('#__ID__vwp',{scaleX:1,dura

--- algorithm ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p an-ag" id="__ID__ag0" style="left:46px;top:-127px;width:170px;height:255px;border-radius:27px;background:rgba(17,17,17,.20);opacity:0.4;overflow:hidden">
          <span style="position:absolute;left:50%;margin-left:-24px;top:22%;width:48px;height:48px;border-radius:50%;background:#FFFFFF;opacity:0.3"></span>
          <span style="position:absolute;left:14%;bottom:16%;width:72%;height:9px;border-radius:99px;background:#FFFFFF;opacity:0.22"></span></span><span class="an-p an-ag" id="__ID__ag1" style="left:239px;top:-127px;width:170px;height:255px;border-radius:27px;background:rgba(17,17,17,.20);opacity:0.4;overflow:hidden">
          <span style="position:absolute;left:50%;margin-left:-24px;top:22%;width:48px;height:48px;border-radius:50%;background:#FFFFFF;opacity:0.3"></span>
          <span style="position:absolute;left:14%;bottom:16%;width:72%;height:9px;border-radius:99px;background:#FFFFFF;opacity:0.22"></span></span><span class="an-p an-ag" id="__ID__ag2" style="left:432px;top:-127px;width:170px;height:255px;border-radius:27px;background:rgba(17,17,17,.20);opacity:0.4;overflow:hidden">
          <span style="position:absolute;left:50%;margin-left:-24px;top:22%;width:48px;height:48px;border-radius:50%;background:#FFFFFF;op
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__ag4',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.2)',transformOrigin:'50% 50%'},0.05);
      tl.fromTo(['#__ID__ag1','#__ID__ag3','#__ID__ag5','#__ID__ag7'],{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:0.4,duration:

--- trendsound ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <span class="an-p" id="__ID__tsc" style="left:33px;top:33px;width:583px;height:145px;border-radius:35px;background:#FF5A36;overflow:hidden"><span class="an-p an-tw2" style="left:35px;top:58px;width:7px;height:29px;border-radius:99px;background:#FFFFFF;opacity:.85;transform-origin:50% 50%"></span><span class="an-p an-tw2" style="left:57px;top:22px;width:7px;height:101px;border-radius:99px;background:#FFFFFF;opacity:.85;transform-origin:50% 50%"></span><span class="an-p an-tw2" style="left:79px;top:49px;width:7px;height:48px;border-radius:99px;background:#FFFFFF;opacity:.85;transform-origin:50% 50%"></span><span class="an-p an-tw2" style="left:101px;top:25px;width:7px;height:96px;border-radius:99px;background:#FFFFFF;opacity:.85;transform-origin:50% 50%"></span><span class="an-p an-tw2" style="left:123px;top:40px;width:7px;height:65px;border-radius:99px;background:#FFFFFF;opacity:.85;transform-origin:50% 50%"></span><span class="an-p an-tw2" style="left:145px;top:29px;width:7px;height:87px;border-radius:99px;background:#FFFFFF;opacity:.85;transform-origin:50% 50%"></span><span class="an-p an-tw2" style="left:167px;top:33px;width:7px;height:80px;border-radius:99px;background:#FFFFFF;opacity:.85;transform-origin:50% 50%"></span><span class="
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__tsc',{y:-18,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'back.out(1.7)'},0.05);
      tl.fromTo('#__ID__an .an-tw2',{scaleY:0.25},{scaleY:1,duration:0.24,stagger:{each:0.02,yoyo:true,repeat:4},ease:'sine.inOut'},0.31);
      tl.fromTo('#__

--- deadline ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><div class="an-p" style="left:143px;top:123px;width:363px;height:312px;border-radius:18px;background:#FFFFFF;box-shadow:0 22px 54px rgba(0,0,0,.35);overflow:hidden">
        <span style="position:absolute;left:0;top:0;width:100%;height:51px;background:#FF5A36"></span><span  style="position:absolute;left:8px;top:94px;width:35px;height:31px;border-radius:8px;background:rgba(17,17,17,.10)"></span><span  style="position:absolute;left:60px;top:94px;width:35px;height:31px;border-radius:8px;background:rgba(17,17,17,.10)"></span><span  style="position:absolute;left:112px;top:94px;width:35px;height:31px;border-radius:8px;background:rgba(17,17,17,.10)"></span><span  style="position:absolute;left:164px;top:94px;width:35px;height:31px;border-radius:8px;background:rgba(17,17,17,.10)"></span><span  style="position:absolute;left:216px;top:94px;width:35px;height:31px;border-radius:8px;background:rgba(17,17,17,.10)"></span><span  style="position:absolute;left:268px;top:94px;width:35px;height:31px;border-radius:8px;background:rgba(17,17,17,.10)"></span><span  style="position:absolute;left:320px;top:94px;width:35px;height:31px;border-radius:8px;background:rgba(17,17,17,.10)"></span><span  style="position:absolute;left:8px;top:139px;width:35px;height:31px;border-rad
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-p',{y:40,autoAlpha:0},{y:0,autoAlpha:1,duration:0.4,ease:'power3.out'},0.05);
      tl.fromTo('#__ID__dl',{scale:1},{scale:1.55,duration:0.34,ease:'back.out(2.6)',transformOrigin:'50% 50%'},0.5);
      tl.to('#__ID__dl',{scale:1.35,durat

Réponds UNIQUEMENT par l'objet JSON, sans texte autour, sans balise de code.
`

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

  // ── LE QUOTA SE COMPTE EN TENTATIVES, PAS EN ANIMATIONS GARDÉES ───────────
  // Axel, 03/08 : « 2 pour starter, 5 pour pro, 8 pour élite, au-delà 1 crédit ».
  // J'avais proposé de ne facturer que les animations gardées — il m'a repris,
  // à juste titre : personne ne garderait, et la génération deviendrait
  // illimitée et gratuite. Chaque LANCEMENT compte.
  //
  // Tout se décide ici, jamais côté client : le navigateur peut mentir sur le
  // plan comme sur le compteur. Même principe que les crédits.
  const QUOTA: Record<string, number> = { starter: 2, pro: 5, elite: 8, developer: 999, byok: 999 }
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const jeton = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const sbUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jeton}` } } })
  const { data: { user } } = await sbUser.auth.getUser()
  if (!user) return json({ ok: false, erreur: 'Reconnecte-toi puis réessaie.' }, 401)

  const sbAdmin = createClient(url, srv, { auth: { persistSession: false } })
  const { data: profil } = await sbAdmin.from('profiles').select('plan').eq('id', user.id).single()
  const plan = String(profil?.plan || 'free').toLowerCase()
  const gratuites = QUOTA[plan] ?? 0

  // « ce mois-ci » = depuis le 1er du mois courant, pas 30 jours glissants :
  // c'est ce que l'utilisateur comprend quand on lui dit « 5 par mois ».
  const debutMois = new Date()
  debutMois.setUTCDate(1); debutMois.setUTCHours(0, 0, 0, 0)
  const { count } = await sbAdmin.from('anim_creations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).gte('created_at', debutMois.toISOString())
  const dejaFaites = count ?? 0
  const doitPayer = dejaFaites >= gratuites

  if (doitPayer) {
    const { error: eSpend } = await sbAdmin.rpc('spend_credits', {
      p_user: user.id, p_amount: 1, p_reason: 'création d\'animation',
    })
    if (eSpend) {
      return json({ ok: false, erreur: `Tes ${gratuites} créations gratuites du mois sont utilisées, et il te faut 1 crédit pour continuer.` }, 402)
    }
  }
  // on inscrit la tentative AVANT de générer : un échec de Claude a quand même
  // consommé le quota si on l'a facturé, et le compte doit rester juste.
  await sbAdmin.from('anim_creations').insert({ user_id: user.id, demande, facturee: doitPayer })

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

    // ── LA DEUXIÈME PASSE — c'est elle qui fait la différence ───────────────
    // Axel : « ce qui manque, c'est la boucle. Quand j'écris une animation, je
    // la rends, je la regarde, je corrige. Lui écrit à l'aveugle, une seule
    // fois. » Exactement. On lui remet donc son propre code sous les yeux avec
    // les trois questions qui comptent, et il réécrit. Ça double la latence
    // (une dizaine de secondes), ça ne change rien au prix, et c'est ce qui
    // sépare un schéma d'une animation.
    let brut = a
    try {
      const relu = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: CLAUDE_MODEL, max_tokens: 8000, output_config: { effort: 'low' },
          system: CONSIGNE,
          messages: [
            { role: 'user', content: user },
            { role: 'assistant', content: JSON.stringify(a) },
            { role: 'user', content: `Regarde ton animation comme si tu la voyais jouer sur un téléphone, et réponds-toi honnêtement :

1. L'OBJET EST-IL RECONNAISSABLE ? Si on retire la légende, est-ce qu'on identifie la chose sans hésiter ? Un disque plein n'est pas une lune, un rectangle n'est pas une machine. Si non : redessine-le avec ses vraies parties.
2. QUELQUE CHOSE SE TRANSFORME-T-IL ? Des formes qui apparaissent en fondu ne sont pas une animation. Il faut un mouvement INTERNE qui raconte le verbe — quelque chose se remplit, bascule, s'assemble, se met en marche. Si non : trouve-le.
3. LE CADRE EST-IL REMPLI ? Le sujet doit occuper au moins la moitié des 930 × 600. Si non : agrandis.
4. EST-CE AU NIVEAU DES VINGT EXEMPLES ? Même densité, mêmes ombres, mêmes rayons, mêmes épaisseurs. Si non : ajoute la matière qui manque.

Réécris l'animation en corrigeant ce que tu viens de trouver. Même format JSON, rien d'autre. Ne te contente pas de retoucher : si le dessin est faible, refais-le.` },
          ],
        }),
      })
      if (relu.ok) {
        const d2 = await relu.json()
        const t2 = String((d2?.content || []).map((c: { text?: string }) => c?.text || '').join('\n'))
        const m2 = t2.match(/\{[\s\S]*\}/)
        if (m2) {
          const a2 = JSON.parse(m2[0])
          // on ne garde la reprise que si elle est au moins aussi fournie :
          // une deuxième passe qui APPAUVRIT le dessin n'a rien corrigé.
          if (String(a2.html || '').length >= String(a.html || '').length * 0.85) brut = a2
        }
      }
    } catch (_) { /* la relecture est un bonus : sans elle, on garde le premier jet */ }

    const html = recentrer(String(brut.html || ''))
    const js = tenirJusquAuBout(String(brut.js || ''))
    const faute = verifier(html, js)
    if (faute) return json({ ok: false, erreur: `animation refusée : ${faute}` })

    const nom = String(brut.nom || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'sans-nom'
    const mots = (Array.isArray(brut.mots) ? brut.mots : []).map((x) => String(x).toLowerCase().trim())
      .filter((x) => x.length >= 3).slice(0, 8)
    return json({ ok: true, anim: { nom, mots, montre: String(brut.montre || '').slice(0, 160), html, js } })
  } catch (e) {
    return json({ ok: false, erreur: String(e).slice(0, 200) })
  }
})
