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

ONZE ANIMATIONS DU PRODUIT — c'est le niveau à tenir, et l'ÉCART entre elles
Axel : « pourquoi que deux de mes animations, pourquoi pas toutes comme ça il
voit ce qu'on attend vraiment ? ». Les voici, choisies pour être les plus
différentes possible : une scène qui se construit, un geste qui se joue, une
comparaison, une conversation, une copie, un alignement, une courbe, un envoi,
une recherche, un anonymat, une voix. Lis-les VRAIMENT : la densité de formes,
les ombres, les rayons, les tailles, et surtout la façon dont chacune trouve un
mouvement propre à ce qu'elle raconte. Ne les copie pas — reprends ce soin, et
trouve le mouvement juste pour CE qu'on te demande.

--- timeline ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" style="left:20px;top:79px;width:168px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:191px;top:79px;width:143px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:337px;top:79px;width:155px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span><span class="an-p" style="left:495px;top:79px;width:131px;height:111px;border-radius:20px;background:rgba(17,17,17,.20);overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#11111122 0 2px,transparent 2px 38px)"></span></span>
        <span class="an-p" style="left:20px;top:223px;width:609px;height:111px;border-radius:20px;background:rgba(17,17,17,.10);overflow:hidden"><span style="position:absolute;left:12px;top:46px;width:5px;height:20px;border-radius:99px;background:#111111;opacity:.6"></span><span styl
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,stagger:0.04,ease:'power2.out'},0.05);
      tl.fromTo('#__ID__tp',{x:0},{x:()=>document.getElementById('__ID__an').getBoundingClientRect().width*0.9,duration:1.8,ease:'none'},0.35);

--- connect ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <div class="an-p" id="__ID__c1" style="left:50px;top:165px;width:227px;height:227px;border-radius:54px;overflow:hidden;box-shadow:0 26px 60px rgba(0,0,0,.45)">
          <img src="tuto/logo-avatarads.png" style="width:100%;height:100%;object-fit:cover;display:block"/></div>
        <div class="an-p" id="__ID__c2" style="left:372px;top:165px;width:227px;height:227px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 26px 60px rgba(0,0,0,.45))">
          <img src="tuto/logo-claude.png" style="width:100%;height:100%;object-fit:contain;display:block"/></div>
        <span id="__ID__cw" style="position:absolute;left:325px;top:279px;width:95px;height:12px;margin-left:-48px;margin-top:-6px;border-radius:99px;background:#111111;transform-origin:50% 50%"></span>
        <span id="__ID__ck" style="position:absolute;left:325px;top:279px;width:73px;height:73px;margin-left:-36px;margin-top:-36px;border-radius:50%;background:#22C55E;display:flex;align-items:center;justify-content:center;opacity:0;box-shadow:0 12px 34px rgba(34,197,94,.5)">
          <svg width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.6l5 5 10-11"/></svg></span></div>
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__c1', { xPercent: -70, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.42, ease: 'power3.out' }, 0.05);
      tl.fromTo('#__ID__c2', { xPercent: 70, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.42, ease: 'power3.out' }, 0.05);
      tl.fromTo('#__ID__cw', { scaleX: 0, autoAlpha: 0 },

--- compare ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><div class="an-p" id="__ID__c1" style="left:0;top:0;width:285px;height:100%;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20);border-radius:45px"></div><div class="an-p" id="__ID__c2" style="left:363px;top:0;width:285px;height:100%;background:#FF5A36;border-radius:45px"></div></div>
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__c1', { y: 0, autoAlpha: 0 }, { y: 24, autoAlpha: 1, duration: 0.45, ease: 'power2.out' }, 0.05);
      tl.fromTo('#__ID__c2', { y: 0, autoAlpha: 0 }, { y: -24, autoAlpha: 1, duration: 0.45, ease: 'back.out(1.6)' }, 0.2);
      tl.fromTo('#__ID__gl', { x: '-3%' }, { x: '5%', duration: 0.28, repeat: 3, yo

--- chat ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <!-- Axel : « chat pareil, on peut ajouter bruitage de clavier ». La question
             ne doit pas apparaître d'un bloc : on l'ÉCRIT, et le son de frappe se
             pose sur cet intervalle comme pour « search » et « comment ».
             (Aucun accent grave ici : ce commentaire vit DANS un template literal.) -->
        <div class="an-p" id="__ID__cq" style="left:96px;top:28px;width:500px;min-height:145px;border-radius:61px 61px 18px 61px;background:#FF5A36;display:flex;align-items:center;padding:0 41px;box-sizing:border-box">
          <span id="__ID__cqt" style="font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;font-weight:800;font-size:55px;letter-spacing:-.015em;color:#FFFFFF;line-height:1.18"><span class="an-cq2" style="opacity:0">A</span><span class="an-cq2" style="opacity:0">u</span><span class="an-cq2" style="opacity:0">d</span><span class="an-cq2" style="opacity:0">i</span><span class="an-cq2" style="opacity:0">o</span></span>
          <span id="__ID__cqc" style="width:2px;height:44px;background:#FFFFFF;border-radius:2px;margin-left:2px"></span></div>
        <div class="an-p" id="__ID__ca" style="left:52px;top:223px;width:468px;height:232px;border-radius:61px 61px 61px 18px;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20)">
          <span style="position:absolute;left:8%;top:13%;width:58px;height:58px"><svg viewBox="-28 -28 56 
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__cq',{x:60,autoAlpha:0},{x:0,autoAlpha:1,duration:0.28,ease:'back.out(1.6)'},0.05);
      tl.fromTo('#__ID__an .an-cq2',{autoAlpha:0},{autoAlpha:1,duration:0.01,stagger:0.035},0.29);
      tl.fromTo('#__ID__cqc',{autoAlpha:1},{autoAlpha:0.1,duration:0.24,repeat:4,yoyo:true},0.29);
      tl.to('#__ID__cqc

--- copy ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <div class="an-p" id="__ID__k" style="left:52px;top:28px;width:544px;height:92px;border-radius:31px;background:#FFFFFF;display:flex;align-items:center;gap:26px;padding:0 37px;box-sizing:border-box;box-shadow:0 22px 54px rgba(0,0,0,.42)">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#FF5A36" stroke-width="2.3" stroke-linecap="round"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v4"/></svg>
          <span style="font-family:'JetBrains Mono',monospace;font-size:31px;color:#141418;letter-spacing:.02em;white-space:nowrap">sk-ava-••••-7X4F</span>
        </div>
        <span id="__ID__cp" style="position:absolute;left:50%;top:145px;margin-left:-87px;width:174px;height:66px;border-radius:99px;background:#22C55E;display:flex;align-items:center;justify-content:center;gap:15px;color:#fff;font-family:'Archivo Black',sans-serif;font-size:25px;opacity:0">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.6l5 5 10-11"/></svg>COPIÉ</span>
        <div class="an-p" id="__ID__cl" style="left:213px;top:334px;width:223px;height:223px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 26px 60px rgba(0,0,0,.45));opacity:0">
          <img src="tuto/logo-claude.png" style="width:100%;height:100%;object-fit:contain;display:bloc
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__k',{y:-40,scale:0.9,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.36,ease:'back.out(1.6)'},0.05);
      tl.fromTo('#__ID__cp',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,ease:'back.out(3)',transformOrigin:'50% 50%'},0.45);
      tl.fromTo('#__ID__cl',{scale:0.72,autoAlpha:0},{scale:1,a

--- lineup ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" style="left:26px;top:410px;width:596px;height:4px;border-radius:99px;background:#111111;opacity:.35"></span><span class="an-p an-lu" id="__ID__l0" style="left:58px;top:179px;width:156px;height:200px;border-radius:22px;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20);opacity:0;overflow:visible">
          
          <span style="position:absolute;left:25px;top:80px;width:25px;height:36px;border-radius:3px;background:#111111"></span>
          <span style="position:absolute;left:44px;top:64px;width:0;height:0;border-top:34px solid transparent;border-bottom:34px solid transparent;border-right:34px solid #111111"></span>
          <span class="an-p" id="__ID__l0w1" style="left:87px;top:68px;width:22px;height:60px;border:4px solid #FF5A36;border-left:none;border-radius:0 99px 99px 0;background:transparent;opacity:0"></span>
          <span class="an-p" id="__ID__l0w2" style="left:109px;top:54px;width:28px;height:88px;border:4px solid #FF5A36;border-left:none;border-radius:0 99px 99px 0;background:transparent;opacity:0"></span>
          <span class="an-p" id="__ID__l0ck" style="left:auto;right:-8px;top:-8px;width:37px;height:37px;border-radius:50%;background:#FF5A36;opacity:0;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.25)">
            <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#fff" stroke-
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__l0', { y: 64, scale: 0.6, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(2)', transformOrigin: '50% 100%' }, 0.35);
      tl.fromTo('#__ID__l0ck', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, 0.

--- easyup ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <span class="an-p" style="left:78px;top:479px;width:492px;height:3px;border-radius:99px;background:#111111;opacity:.4"></span>
        <span class="an-p" style="left:78px;top:78px;width:3px;height:401px;border-radius:99px;background:#111111;opacity:.4"></span>
        <span class="an-p" style="left:65px;top:344px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:345px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:241px;top:479px;width:2px;height:10px;background:#111111;opacity:.35"></span><span class="an-p" style="left:65px;top:211px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:212px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:405px;top:479px;width:2px;height:10px;background:#111111;opacity:.35"></span><span class="an-p" style="left:65px;top:77px;width:13px;height:2px;background:#111111;opacity:.35"></span>
          <span class="an-p" style="left:78px;top:78px;width:492px;height:1px;background:#111111;opacity:.08"></span><span class="an-p" style="left:569px;top:479px;width:2px;height:10px;background:#111111;opacity:.35"></span>
        <svg class="an-p" style="left:0;top:0" width="648" height="557" viewBox="0 0 648 557">
          <path id="__ID__area" d="M78 455
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      (function(){ var p = document.getElementById('__ID__line');
        if (p && p.getTotalLength) { var L = p.getTotalLength();
          p.style.strokeDasharray = L + ' ' + L; p.style.strokeDashoffset = L;
          tl.to(p, { strokeDashoffset: 0, duration: 1.3, ease: 'power1.inOut' }, 0.3);
          var mv = { t: 0 }, do

--- post ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><div class="an-p an-pt" id="__ID__p0" style="left:96px;top:0;width:123px;height:123px;border-radius:34px;background:#0E0E13;display:flex;align-items:center;justify-content:center;box-shadow:0 18px 44px rgba(0,0,0,.4)">
          <svg viewBox="0 0 24 24" width="52%" height="52%"><path d="M9 18.2a2.6 2.6 0 102.6 2.6V7.4l6.4-1.6v9.1a2.6 2.6 0 102.6 2.6V2.5L9 4.9z" fill="#fff"/></svg>
          <span id="__ID__k0" style="position:absolute;right:-12px;bottom:-12px;width:52px;height:52px;border-radius:50%;background:#22C55E;display:flex;align-items:center;justify-content:center;opacity:0">
            <svg viewBox="0 0 24 24" width="62%" height="62%"><path d="M5 12.6l4.4 4.4L19 7.4" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div><div class="an-p an-pt" id="__ID__p1" style="left:263px;top:0;width:123px;height:123px;border-radius:34px;background:linear-gradient(135deg,#F9A03F,#E1306C 55%,#833AB4);display:flex;align-items:center;justify-content:center;box-shadow:0 18px 44px rgba(0,0,0,.4)">
          <svg viewBox="0 0 24 24" width="52%" height="52%"><rect x="3.6" y="5.4" width="16.8" height="13.6" rx="4.2" fill="none" stroke="#fff" stroke-width="2.1"/><circle cx="12" cy="12.2" r="3.5" fill="none" stroke="#fff" stroke-width="2.1"/></svg>
          <span id="__ID__k1" style="position:absolute;right:-12px;bottom:-12px;width:52px;height:52px;
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-pt', { y: -30, scale: 0.7, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.3, stagger: 0.09, ease: 'back.out(2)', transformOrigin: '50% 50%' }, 0.05);
      tl.fromTo('#__ID__vd', { yPercent: 45, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.34, ease: 'power3.out' }, 0.21);

--- search ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px">
        <span class="an-p" style="left:110px;top:72px;width:428px;height:84px;border-radius:25px;background:rgba(17,17,17,.10);border:2px solid rgba(17,17,17,.20);display:flex;align-items:center;padding:0 29px;box-sizing:border-box;gap:18px">
          <svg viewBox="0 0 24 24" style="width:37px;height:37px;flex:none" fill="none" stroke="rgba(17,17,17,.20)" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>
          <span id="__ID__sq" style="font-family:'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;font-weight:800;font-size:30px;color:#111111;white-space:nowrap"><span class="an-sl2" style="opacity:0">A</span><span class="an-sl2" style="opacity:0">u</span><span class="an-sl2" style="opacity:0">d</span><span class="an-sl2" style="opacity:0">i</span><span class="an-sl2" style="opacity:0">o</span></span>
          <span id="__ID__ty" style="width:3px;height:32px;border-radius:99px;background:#FF5A36"></span></span><span class="an-p an-res" id="__ID__r0" style="left:110px;top:201px;width:428px;height:60px;border-radius:17px;background:#FF5A36"></span><span class="an-p an-res" id="__ID__r1" style="left:110px;top:305px;width:377px;height:60px;border-radius:17px;background:rgba(17,17,17,.10)"></span><span class="an-p an-res" id="__ID__r2" style="left:110px;top:409px;width:325px;height:60px;border-radius:17px;background:rgba(17,17,17,
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .an-sl2', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01, stagger: 0.055 }, 0.05);
      tl.fromTo('#__ID__ty', { autoAlpha: 1 }, { autoAlpha: 0.15, duration: 0.24, repeat: 4, yoyo: true }, 0.05);
      tl.to('#__ID__ty', { autoAlpha: 0, duration: 0.12 }, 0.77);
      tl.fromTo('#__ID__an .an-res',

--- faceless ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" id="__ID__hd" style="left:212px;top:56px;width:223px;height:223px;border-radius:50%;background:#FF5A36"></span>
        <span class="an-p" id="__ID__e1" style="left:266px;top:130px;width:40px;height:40px;border-radius:50%;background:#FFFFFF"></span><span class="an-p" id="__ID__e2" style="left:342px;top:130px;width:40px;height:40px;border-radius:50%;background:#FFFFFF"></span>
        <span class="an-p" id="__ID__bd" style="left:186px;top:310px;width:277px;height:167px;border-radius:138px 138px 0 0;background:#FF5A36"></span>
        <span class="an-p" id="__ID__br" style="left:188px;top:121px;width:272px;height:58px;border-radius:13px;background:#111111"></span></div>
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__hd', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: 'back.out(2)', transformOrigin: '50% 50%' }, 0.05);
      tl.fromTo('#__ID__bd', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, ease: 'power2.out' }, 0.13);
      tl.fromTo(['#__ID__e1', '#__ID__e2'], { aut

--- voice ---
<div class="an" id="__ID__an" style="left:216px;top:288px;width:648px;height:557px"><span class="an-p" id="__ID__mic" style="left:0;top:179px;width:111px;height:167px;border-radius:99px;background:#111111"></span><span class="an-p" style="left:47px;top:345px;width:18px;height:56px;background:#111111"></span><span class="an-b w1" id="__ID__w12" style="left:58px;top:74px;width:16px;height:208px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w13" style="left:87px;top:113.5px;width:16px;height:129px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w14" style="left:116px;top:112.5px;width:16px;height:131px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w15" style="left:145px;top:74px;width:16px;height:208px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w16" style="left:174px;top:88.5px;width:16px;height:179px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w17" style="left:203px;top:143.5px;width:16px;height:69px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w18" style="left:232px;top:87px;width:16px;height:182px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w19" style="left:261px;top:74.5px;width:16px;height:207px;background:#111111;border-radius:99px"></span><span class="an-b w1" id="__ID__w110" style="left:290px;top:114.5px;width:16px;height:127px;background:#11111
JS :

      tl.fromTo('#__ID__an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0.05);
      tl.to('#__ID__an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, 2.2);
      tl.fromTo('#__ID__an .w1', { scaleY: 0.15 }, { scaleY: 1, duration: 0.5, stagger: 0.02, ease: 'back.out(2)', transformOrigin: '50% 50%' }, 0.05);
      tl.fromTo('#__ID__an .w2', { scaleY: 0.15, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.5, stagger: 0.02, ease: 'back.out(2)', transformOrigin: '50% 50%' }, 0.4

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
