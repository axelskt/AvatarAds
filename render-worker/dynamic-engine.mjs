// ─────────────────────────────────────────────────────────────────────────────
// MOTEUR « DYNAMIQUE » v2 (#147) — références @saasservices17 / @lemosthiagoo.
//
// v1 refusée par Axel : trop de texte, bruitages répétitifs et mal choisis,
// synchro flottante. La v2 applique sa grammaire :
//   · UNE SEULE CHOSE à l'écran par panneau (une phrase OU une scène UI)
//   · fonds DÉGRADÉS qui respirent (jamais d'aplat mort)
//   · les phrases courtes SE TAPENT (caret), les mots-clés SLAM — c'est tout
//   · scènes UI vectorielles (ui-scenes.mjs) câblées sur ses scripts : compte,
//     clé copiée, Claude connecté, import, silences coupés, un clic, choix…
//   · SON = ACTION : clic quand ça clique, succès quand ça valide, whoosh
//     seulement quand un panneau illustré pousse — jamais deux fois pareil
//     d'affilée, volumes bas, plafonné.
//
// Seek-safe : timeline unique en pause, panneaux 2+ opacity:0 révélés par GSAP,
// hard kill après chaque poussée, transforms/autoAlpha/filter uniquement,
// repeats finis, zéro random (blobs et ondes = sinus déterministes).
// ─────────────────────────────────────────────────────────────────────────────

import { uiScene } from './ui-scenes.mjs'
import { screenSize } from './screen-spots.mjs'
import { SAFE, fontFaceCss } from './visual-styles.mjs'
import { deriveDynamicSlides } from './dynamic-derive.mjs'
import { animHtml, animJs, animCss, ANIMS } from './anim-pack.mjs'

const r2 = (n) => Math.round(n * 100) / 100
// ── DURÉE D'UN CLIP VIDÉO : SUR LA GRILLE 0,1 s, ARRONDIE VERS LE BAS ──────
// Le garde de couverture d'HyperFrames compte `ceil(durée × fps)` images
// attendues, mais l'extracteur ffmpeg en émet `floor` : sur une fenêtre de
// 0,54 s à 30 i/s ça fait 16 capturées pour 17 attendues → 94,1 % < 95 % et
// TOUT le rendu est refusé (vécu le 08/08, quatre rendus perdus). 0,1 s est
// un multiple exact de 1/30 ET de 1/50 : calée dessus, la durée donne le même
// compte des deux côtés. On perd au plus 0,09 s de clip — la dernière image
// tient l'écran, invisible à l'œil.
const dvid = (s) => Math.max(0.1, Math.floor((s + 1e-6) * 10) / 10)
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const DARK  = { bg: '#0E0E13', ink: '#F5F5F6', mute: '#8B8B94', dark: true }
const LIGHT = { bg: '#FFF7F2', ink: '#141418', mute: '#6E6E73', dark: false }
const ACC   = '#FF5A36'

// ── APPLE ────────────────────────────────────────────────────────────────────
// Axel, en voyant le style apple rendu par le chemin classique : « c'est pas du
// tout le rendu que je veux, je veux que le modèle ressemble principalement à la
// v18 ». Apple n'est donc PAS un autre moteur : c'est CE moteur, habillé clair.
// Même composition — panneaux plein écran qui se poussent, captures pilotées au
// clic, animations ancrées sur le mot — mais deux tons clairs qui alternent au
// lieu du noir/crème, sur la palette iOS de sa référence (@beingmayy).
const AP_A  = { bg: '#F2F2F7', ink: '#1D1D1F', mute: '#6E6E73', dark: false }
const AP_B  = { bg: '#FFFFFF', ink: '#1D1D1F', mute: '#86868B', dark: false }
const isApple = (plan) => plan.slideStyle === 'apple'

// halos du fond : la « respiration » des références — de GROS dégradés radiaux
// qui dérivent lentement. Déterministes (position/phase par index de panneau).
const BLOBS = {
  light: ['#FFD3BC', '#FFC0CF', '#FFE7AE'],
  dark:  ['#2E1E33', '#33201B', '#182337'],
  // apple : les dégradés iOS — bleu, violet, rose — beaucoup plus lavés, sinon
  // ils tachent un fond blanc au lieu de le faire respirer.
  ap_a:  ['#D7E6FF', '#E4DAFF', '#FFDCE8'],
  ap_b:  ['#DCEBFF', '#FFE2D5', '#E2F0FF'],
}

const CHAR_W = 0.66
const fitSize = (text, maxW, lo = 64, hi = 160) =>
  Math.round(Math.min(hi, Math.max(lo, maxW / (CHAR_W * Math.max(1, String(text).length)))))

// ── 1 · SEGMENTATION : slides + phrases → chaîne contiguë ───────────────────
function buildPanels(plan, D) {
  const words = (plan.captions || [])
    .filter((c) => String(c.text || '').trim())
    .map((c) => ({ text: String(c.text).trim(), start: r2(c.start), end: r2(Math.max(c.start + 0.08, c.end)), accent: !!c.accent }))
    .sort((a, b) => a.start - b.start)

  const anims = [
    ...(plan.slides || [])
      .filter((s) => s.anim || s.type === 'punch')
      .map((s) => ({ kind: s.anim === 'ui' ? 'ui' : (s.anim || 'punch'), t0: r2(s.start), t1: r2(s.end ?? s.start + 2), slide: s })),
    // LES PANNEAUX A CONTENU (checklist, kpi, banner, carte titree) — ils
    // n'etaient pas rendus du tout : leurs fenetres partaient au mode typo, des
    // mots geants nus qu'Axel bannit (« peu d'investissement » plein ecran,
    // 31/07). Ils deviennent des panneaux a part entiere, et leurs mots ne sont
    // plus « libres » pour la typo.
    ...(plan.slides || [])
      .filter((s) => !s.anim && s.type !== 'punch' && (s.title || (s.items || []).some((it) => String(it.text || '').trim())))
      .map((s) => ({ kind: 'content', t0: r2(s.start), t1: r2(s.end ?? s.start + 2), slide: s })),
    // #149 · fenêtres AVATAR : le visage plein écran entre les animations
    ...(plan.avatarSegments || [])
      .map((s, i) => ({ kind: 'avclip', t0: r2(s.start), t1: r2(s.end ?? s.start + 4), slide: { i, duo: s.duo, insets: s.insets, photo: s.photo } })),
  ].sort((a, b) => a.t0 - b.t0)

  const inAnim = (t) => anims.some((a) => t >= a.t0 - 0.06 && t < a.t1 - 0.06)
  const free = words.filter((w) => !inAnim(w.start))

  // découpe en phrases : au silence, ou À LA PONCTUATION dès que la clause est
  // assez longue — jamais en plein milieu d'une proposition (les « phrases
  // coupées où on ne comprend rien » venaient des caps bruts 8 mots / 3.4 s)
  const phrases = []
  let cur = []
  const flush = () => { if (cur.length) { phrases.push(cur); cur = [] } }
  const endsClause = (w) => /[.,!?…]$/.test(w.text)
  for (const w of free) {
    const last = cur[cur.length - 1]
    if (last && (
      w.start - last.end > 0.55 ||
      (endsClause(last) && cur.length >= 4) ||
      w.start - cur[0].start > 4.2 ||
      cur.length >= 10
    )) flush()
    cur.push(w)
  }
  flush()

  // SEULES les phrases avec un mot-clé deviennent un panneau. Les phrases de
  // liaison tapées à l'écran étaient exactement « les trucs typiques » qu'Axel a
  // refusés (7 captures) : la voix les porte, la scène précédente respire, point.
  // Retour d'Axel (31/07, style apple) : « non, pas de mots sur une page !!!
  // only animation » — vu sur « ton produit. » plein écran. En apple, AUCUN
  // panneau typo : les fenêtres libres reviennent à la scène précédente qui
  // respire (animations, visage). Le mode dynamic garde ses slams — c'est lui.
  const panels = [
    ...anims.map((a) => ({ kind: a.kind, t0: a.t0, t1: a.t1, slide: a.slide })),
    ...(isApple(plan) ? [] : phrases
      .filter((ws) => ws.some((w) => w.accent || w.text.length >= 11))
      .map((ws) => ({ kind: 'typo', t0: r2(Math.max(0, ws[0].start - 0.12)), t1: r2(ws[ws.length - 1].end + 0.3), words: ws }))),
  ].sort((a, b) => a.t0 - b.t0)

  const out = []
  for (const p of panels) {
    const prev = out[out.length - 1]
    if (prev && p.t0 < prev.t0 + 0.6) {
      if (p.kind === 'typo' && prev.kind === 'typo') { prev.words.push(...(p.words || [])); continue }
      // une phrase coincée contre une scène : on ne la JETTE plus (ça amputait la
      // fin des phrases) — on la garde si elle a de la matière et de la place
      if (p.kind === 'typo' && ((p.words || []).length <= 2 || p.t1 - (prev.t0 + 0.6) < 0.5)) continue
      p.t0 = r2(prev.t0 + 0.6)
    }
    out.push(p)
  }
  if (!out.length) return out
  out[0].t0 = 0
  for (let i = 0; i < out.length; i++) out[i].t1 = r2(i < out.length - 1 ? out[i + 1].t0 : D)

  // FUSION des scènes courtes voisines : deux panneaux de <1.35 s qui se poussent
  // à la chaîne, « on n'a même pas le temps de voir que ça change déjà » (Axel).
  // Elles partagent désormais UN panneau (même fond) avec un relais interne doux.
  const merged = []
  const shortish = (x) => (x.t1 - x.t0) < 1.35 && (x.kind === 'ui' || x.kind === 'screen')
  for (const p of out) {
    const prev = merged[merged.length - 1]
    if (prev && shortish(p) && (prev.kind === 'multi' || shortish(prev)) && p.t1 - (prev.kind === 'multi' ? prev.subs[0].t0 : prev.t0) < 4.2) {
      if (prev.kind !== 'multi') merged[merged.length - 1] = { kind: 'multi', t0: prev.t0, t1: p.t1, subs: [prev, p] }
      else { prev.subs.push(p); prev.t1 = p.t1 }
      continue
    }
    merged.push(p)
  }
  return merged
}

// ── 2 · CONTENU D'UN PANNEAU TYPO : une seule déclaration ───────────────────
// Accent présent → LE mot en slam (et rien d'autre, ou 2 mots de contexte au-
// dessus). Pas d'accent → la phrase courte se TAPE au centre, caret orange.
function typoContent(id, p, tone, liveT0, avecSubs) {
  // ── LE SLAM RÉPÉTAIT LA BANDE DE SOUS-TITRES ─────────────────────────────
  // Axel, 03/08 : « il met toujours le texte comme ça, faut bannir ça » — un
  // mot en très gros au centre, pendant que la bande écrivait le même mot en
  // bas au même instant. « business » géant sur « un business sans ».
  //
  // Le slam avait un sens quand la bande n'existait pas : il PORTAIT la phrase.
  // Depuis que les sous-titres mot-à-mot sont là en permanence, il ne fait plus
  // que la redire, deux fois plus gros. Deux écritures du même mot au même
  // instant, ce n'est pas de l'emphase, c'est du bruit — et ça mange une
  // fenêtre qui pourrait montrer le visage.
  //
  // On rend donc la scène vide quand les sous-titres tournent : la règle
  // « jamais de panneau typo nu » qui suit s'en charge, la fenêtre revient au
  // visage ou à la scène voisine.
  if (avecSubs) return { html: '', js: '', sfx: [] }
  const ws = p.words
  // Mots que la voix porte déjà et qui ne VEULENT RIEN DIRE à l'écran — Axel :
  // « "sélectionner" écrit en sous-titres ne sert à rien », « "finir
  // l'animation" pareil inutile ». Un slam doit être un mot qu'on retient.
  const WEAK = new Set(['selectionner', 'selectionne', 'finir', 'aller', 'faire', 'mettre',
    'obtenir', 'obtiens', 'vouloir', 'veux', 'donner', 'prendre', 'passer', 'commencer',
    'continuer', 'utiliser', 'cliquer', 'ensuite', 'apres', 'maintenant', 'vraiment',
    'simplement', 'juste', 'genre', 'sinon', 'aussi', 'meme', 'toujours', 'quelque',
    'quelques', 'plusieurs', 'beaucoup', 'pendant', 'depuis', 'chaque'])
  const clean = (t) => String(t).replace(/[«»"'.,!?…()]/g, '')
  const strong = (w) => {
    const n = clean(w.text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return n.length >= 5 && !WEAK.has(n)
  }
  let accIdx = ws.findIndex((w) => (w.accent || w.text.length >= 11) && strong(w))
  // JAMAIS de panneau typo NU (vu sur Cartoon 15 : blobs vides pendant 1-2 s) —
  // sans accent, le mot le plus CHARGÉ de la phrase fait le slam
  if (accIdx < 0) {
    let best = -1, bestLen = 4
    for (let i = 0; i < ws.length; i++) {
      if (!strong(ws[i])) continue
      const L = clean(ws[i].text).length
      if (L > bestLen) { best = i; bestLen = L }
    }
    accIdx = best
  }
  if (accIdx < 0) return { html: '', js: '', sfx: [] }   // purs mots de liaison : la scène d'avant respire
  const acc = ws[accIdx]
  // le VERBE juste avant (1 mot max) + LE MOT — jamais de fragment de fin de
  // phrase en dessous (« et je » orphelin = incompréhensible, retour d'Axel)
  const before = accIdx > 0 ? ws[accIdx - 1].text : ''
  const fz = fitSize(acc.text, 900, 84, 168)
  const tAt = Math.max(liveT0, acc.start)
  const html = `<div class="stack">
      ${before ? `<div id="${id}b4" style="font-size:54px;font-weight:600;color:${tone.mute};opacity:0">${esc(before)}</div>` : ''}
      <div class="disp" id="${id}acc" style="font-size:${fz}px;color:${tone.ink};opacity:0;white-space:nowrap">${esc(acc.text)}</div>
    </div>`
  let js = ''
  // le petit mot gris n'arrive jamais SEUL plus de 0,9 s avant le slam (écran
  // « sont » perdu au milieu du vide = exactement ce qu'Axel a refusé)
  const b4At = before ? r2(Math.max(liveT0,
    acc.start - ws[accIdx - 1].start > 0.9 ? acc.start - 0.45 : ws[accIdx - 1].start)) : 0
  if (before) js += `\n  tl.fromTo('#${id}b4',{y:-46,opacity:0},{y:0,opacity:1,duration:0.32,ease:'power3.out'},${b4At});`
  js += `\n  tl.fromTo('#${id}acc',{scale:1.5,opacity:0,filter:'blur(14px)'},{scale:1,opacity:1,filter:'blur(0px)',duration:0.42,ease:'power4.out'},${r2(tAt)});`
  js += `\n  tl.to('#${id}acc',{scale:1.05,duration:${r2(Math.max(0.3, p.t1 - tAt - 0.45))},ease:'none'},${r2(tAt + 0.42)});`
  return { html, js, sfx: [{ kind: 'mo-pop-3', t: r2(tAt), vol: 0.45 }] }
}

// LA CAPTURE EST PILOTÉE, PAS CONTEMPLÉE.
//
// Avant : la capture s'affichait, la caméra dérivait vaguement et un cadre orange
// se posait au CENTRE par défaut — donc sur du vide. Axel : « quand je dis image
// IA il met un rectangle sur une page noire… il ne sélectionne pas ce que je
// dis », « quand je dis décrire l'image il montre le format, y'a aucune logique ».
//
// Maintenant la scène reçoit des ÉTAPES (`s.steps`), une par chose nommée dans la
// voix, avec la position mesurée de l'élément (screen-spots.mjs). À chaque étape :
// la caméra va dessus, le curseur arrive, il clique, le cadre se pose PILE sur
// l'élément. Le prompt, lui, se tape dans son champ. C'est une démo, pas une
// image fixe — et tout est calé sur le mot prononcé.
function screenContent(id, s, tone, liveT0, t1, W) {
  const file = s.screen ? 'tuto/' + s.screen + '.png' : ''
  const dur = r2(t1 - liveT0)
  const cw = 980, ch = Math.round(cw / 1.6)
  const cx = Math.round((W - cw) / 2), cy = 620
  // ── POURQUOI L'IMAGE EST POSÉE EN GRAND PUIS RÉDUITE ────────────────────────
  // Chrome rastérise une image à sa taille de MISE EN PAGE, pas à sa taille une
  // fois `transform: scale()` appliqué. En la posant sur 980 px puis en zoomant
  // ×4, on agrandissait donc un bitmap de 980 px — exactement comme un zoom
  // numérique sur une photo. Axel : « ce n'est pas hyper pixel, ça réduit la
  // qualité de la vidéo ». Vérifié : la même région découpée dans la capture
  // d'origine et affichée à la même taille est parfaitement nette.
  // On pose donc l'image à sa RÉSOLUTION NATIVE et on la fait tenir dans le
  // cadre par le transform : au repos on RÉDUIT (jamais de flou), et au zoom on
  // revient vers l'échelle 1:1 — le texte de l'interface reste net.
  const src = screenSize(s.screen)
  const K = src.w && src.w > cw ? src.w / cw : 1     // combien de fois la capture dépasse le cadre
  const iw = Math.round(cw * K), ih = Math.round(ch * K)
  const steps = (s.steps || []).filter((st) => st && st.spot).sort((a, b) => a.t - b.t)

  // — cadrage d'une étape : ON ZOOME SUR L'ÉLÉMENT.
  //   Axel : « dommage qu'à chaque fois ce ne soit pas un zoom plutôt sur la zone
  //   que dit l'audio, fais plutôt ça ». On voyait la capture presque entière avec
  //   un petit cadre orange au milieu : sur un téléphone, le bouton visé fait
  //   trois millimètres et le spectateur cherche. L'élément occupe maintenant les
  //   deux tiers de la largeur visible — c'est LUI le plan, la capture n'est plus
  //   que son décor. La caméra reste dans l'image (jamais de bord vide).
  const shot = (sp) => {
    // …MAIS ON DOIT ENCORE RECONNAITRE L'APP. À 0,66 de largeur utile, un bouton
    // étroit poussait le zoom à 3,8× : on ne voyait plus qu'une carte blanche
    // flottante. Axel : « c'est quoi ça le Générer la clé, ce n'est pas le bouton
    // sur AvatarAds ». Le vrai bouton, cadré si serré, ne ressemble plus à rien.
    // L'élément occupe donc la moitié de la largeur, plafond à 3,2× : on le voit,
    // et on voit l'écran autour — c'est ce qui prouve que c'est bien SON outil.
    const z = Math.min(3.2, Math.max(1.5, 0.5 / Math.max(0.04, sp.w)))
    const cl = (v, span) => Math.min(1 - span, Math.max(span, v))
    const px = cl(sp.x, 1 / (2 * z)), py = cl(sp.y, 1 / (2 * z))
    // l'échelle RÉELLEMENT appliquée : le zoom demandé, divisé par le facteur
    // d'agrandissement de l'image (elle est posée K fois trop grande)
    return { z, s: r2(z / K), tx: r2(-(px - 0.5) * cw * z), ty: r2(-(py - 0.5) * ch * z),
      // où l'élément apparaît À L'ÉCRAN une fois la caméra posée (pour le curseur)
      sx: r2(cw / 2 + (sp.x - px) * cw * z), sy: r2(ch / 2 + (sp.y - py) * ch * z) }
  }

  let boxes = '', js2 = ''
  const sfx = []
  if (steps.length) {
    const first = shot(steps[0].spot)
    steps.forEach((st, k) => {
      const sp = st.spot
      const sh = shot(sp)
      // ⚠️ LES CADRES VIVENT DANS L'IMAGE, DONC DANS SON REPÈRE.
      // Depuis que l'image est posée à sa résolution NATIVE (iw × ih) et réduite
      // par le transform, un cadre calculé sur la taille du cadre visible (cw)
      // se retrouvait K fois trop petit, tassé dans le coin haut-gauche — le
      // « bug en haut à gauche » vu par Axel sur la v16.
      const bw = Math.round(sp.w * iw), bh = Math.round(sp.h * ih)
      const bx = Math.round(sp.x * iw - bw / 2), by = Math.round(sp.y * ih - bh / 2)
      // épaisseurs : ce qui compte est l'échelle VUE à l'écran (sh.s), pas le zoom
      const bd = Math.max(2, Math.round(6 / Math.max(0.2, sh.s)))
      const tIn = r2(Math.max(liveT0, st.t))
      // le clic se produit À L'ARRIVÉE de la caméra, pas pendant le voyage
      const tHit = r2(k ? tIn : Math.min(t1 - 0.2, Math.max(liveT0 + 0.45, tIn - 0.08) + 0.62))
      const tOut = r2(Math.min(t1 - 0.05, k + 1 < steps.length ? Math.max(tIn + 0.35, steps[k + 1].t - 0.22) : t1))
      // Le texte tapé doit avoir la taille du texte DE L'APP, pas celle du cadre :
      // calé sur la hauteur du champ il sortait de la boîte et se superposait au
      // placeholder de la capture (« ici sur le screen ça ne fait pas très beau »).
      // Il est donc dimensionné sur la largeur de la capture — la même échelle que
      // l'interface — et un fond opaque masque le texte d'origine avant d'écrire.
      const fs = Math.max(8, Math.round(iw * 0.0115))
      const padX = Math.round(fs * 1.1)
      const tall = bh > fs * 3.4                          // vraie zone de texte → on écrit en HAUT
      const maxW = Math.max(20, bw - padX * 2 - bd * 2)
      const tw = Math.min(maxW, Math.round(String(st.type || '').length * fs * 0.52))
      // #91 (Axel, 11/08) : PLUS D'ENCADRÉ ORANGE — « les encadrements orange
      // faudrait éviter, juste mettre un zoom avec l'icône de la souris ». Le
      // cadre accent ET le voile sombre autour disparaissent : le zoom isole
      // déjà l'élément (il occupe les 2/3 du cadre), le curseur et l'onde de clic
      // le désignent. Le conteneur ne survit (transparent) QUE pour héberger la
      // frappe clavier (masque + texte + caret) quand l'étape écrit dans un champ.
      boxes += `<div id="${id}b${k}" style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;opacity:0">` +
        (st.type
          ? `<div id="${id}m${k}" style="position:absolute;inset:0;border-radius:${Math.max(4, Math.round(12 / Math.max(0.2, sh.s)))}px;background:#0F0F16;opacity:0"></div>` +
            `<div id="${id}t${k}" style="position:absolute;left:${padX}px;${tall ? `top:${Math.round(fs * 1.1)}px` : 'top:50%;transform:translateY(-50%)'};` +
            `width:0;overflow:hidden;white-space:nowrap;font-size:${fs}px;line-height:1.25;color:#EDEDF2;font-family:'Inter',sans-serif">${esc(st.type)}</div>` +
            `<div id="${id}c${k}" style="position:absolute;left:${padX}px;${tall ? `top:${Math.round(fs * 1.1)}px` : `top:50%;margin-top:${-Math.round(fs * 0.6)}px`};` +
            `width:${Math.max(1, Math.round(fs * 0.09))}px;height:${Math.round(fs * 1.2)}px;background:${ACC};opacity:0"></div>`
          : '') +
        `</div>`
      // ── LA CAMÉRA DOIT MONTRER LE CHEMIN, PAS LE POINT D'ARRIVÉE ───────────
      // Axel : « quand je dis "dans mon compte tout en bas", il montre direct le
      // menu et ne zoome pas sur mon compte tout en bas ». Le zoom était déjà
      // terminé quand le mot tombait : on atterrissait sur la cible sans avoir
      // vu d'où on venait, donc sans comprendre OÙ ALLER.
      // Sur la PREMIÈRE étape d'un écran, l'écran entier tient donc l'affiche
      // une vraie demi-seconde, puis la caméra DESCEND sur l'élément PENDANT
      // qu'il le nomme — le trajet est le message. Les étapes suivantes, elles,
      // restent anticipées : on est déjà dans la page, on suit juste le curseur.
      js2 += `\n  tl.to('#${id}ci',{scale:${sh.s},x:${sh.tx},y:${sh.ty},duration:${k ? 0.46 : 0.78},ease:'power2.inOut'},${r2(k ? Math.max(liveT0, tIn - 0.34) : Math.max(liveT0 + 0.45, tIn - 0.08))});`
      js2 += `\n  tl.fromTo('#${id}b${k}',{scale:1.35,opacity:0},{scale:1,opacity:1,duration:0.3,ease:'back.out(1.8)'},${tHit});`
      js2 += `\n  tl.to('#${id}b${k}',{opacity:0,duration:0.22,ease:'power1.in'},${tOut});`
      if (st.type) {
        const td = r2(Math.max(0.5, Math.min(1.5, tOut - tIn - 0.25)))
        js2 += `\n  tl.to('#${id}m${k}',{opacity:1,duration:0.16,ease:'power1.out'},${r2(tIn + 0.06)});`
        js2 += `\n  tl.to('#${id}t${k}',{width:${tw},duration:${td},ease:'none'},${r2(tIn + 0.16)});`
        js2 += `\n  tl.to('#${id}c${k}',{opacity:1,duration:0.1},${r2(tIn + 0.16)});`
        js2 += `\n  tl.to('#${id}c${k}',{x:${tw},duration:${td},ease:'none'},${r2(tIn + 0.16)});`
        js2 += `\n  tl.to('#${id}c${k}',{opacity:0.15,duration:0.28,repeat:3,yoyo:true,ease:'steps(1)'},${r2(tIn + 0.16 + td)});`
      }
      // curseur : il VA sur l'élément puis appuie — le geste que la voix décrit
      js2 += `\n  tl.to('#${id}cu',{x:${sh.sx},y:${sh.sy},duration:${k ? 0.34 : 0.6},ease:'power2.inOut'},${r2(k ? Math.max(liveT0, tIn - 0.3) : Math.max(liveT0 + 0.45, tIn - 0.08))});`
      js2 += `\n  tl.to('#${id}cu',{scale:0.82,duration:0.09,ease:'power2.in'},${tHit});`
      js2 += `\n  tl.to('#${id}cu',{scale:1,duration:0.16,ease:'back.out(3)'},${r2(tHit + 0.09)});`
      js2 += `\n  tl.fromTo('#${id}rp${k}',{scale:0.3,opacity:0.55},{scale:2.2,opacity:0,duration:0.5,ease:'power2.out'},${tHit});`
      sfx.push({ kind: st.type ? 'mo-pop-1' : 'mo-tap-1', t: r2(tHit), vol: 0.8 })
    })
    // les ondes de clic vivent hors de l'image zoomée : taille constante
    const ripples = steps.map((_, k) =>
      `<div id="${id}rp${k}" style="position:absolute;left:-46px;top:-46px;width:92px;height:92px;border-radius:50%;background:${ACC};opacity:0"></div>`).join('')
    // ON ARRIVE SUR L'ÉCRAN ENTIER, PUIS ON PLONGE. Démarrer déjà zoomé sur un
    // bouton téléporte : on ne sait pas dans quelle page on est. La capture entre
    // en grand — on reconnaît l'écran — et la caméra plonge sur le premier
    // élément quand la voix le nomme.
    const t0z = r2(Math.max(liveT0 + 0.12, steps[0].t - 0.42))
    js2 = `
  tl.fromTo('#${id}cw',{y:200,opacity:0,scale:0.95},{y:0,opacity:1,scale:1,duration:0.44,ease:'power3.out'},${liveT0});
  tl.set('#${id}ci',{scale:${r2(1 / K)},x:0,y:0},${liveT0});
  tl.set('#${id}cu',{x:${first.sx},y:${r2(first.sy + 180)}},${liveT0});
  tl.fromTo('#${id}cu',{opacity:0},{opacity:1,duration:0.2},${r2(Math.max(liveT0 + 0.2, t0z + 0.2))});` + js2
    const html = `
        <div id="${id}cw" style="position:absolute;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;opacity:0">
          <div style="position:absolute;inset:0;border-radius:26px;overflow:hidden;box-shadow:0 46px 120px rgba(13,13,18,.45)">
            <div id="${id}ci" style="position:absolute;left:${Math.round((cw - iw) / 2)}px;top:${Math.round((ch - ih) / 2)}px;width:${iw}px;height:${ih}px">
              <img src="${file}" style="position:absolute;left:0;top:0;width:${iw}px;height:${ih}px" />
              ${boxes}
            </div>
            <div id="${id}cu" style="position:absolute;left:0;top:0;width:0;height:0;opacity:0">
              ${ripples}
              <svg viewBox="0 0 24 24" width="52" height="52" style="position:absolute;left:-4px;top:-2px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.55))">
                <path d="M5 2l14 9.2-6.4 1.1L15 19.6l-2.9 1.2-2.5-6.6L5 18.6z" fill="#FFFFFF" stroke="#141418" stroke-width="1.2"/></svg>
            </div>
          </div>
        </div>`
    return { html, js: js2, sfx }
  }

  // — pas d'étapes : ancien comportement (léger travelling, pas de cadre au hasard)
  const z = Math.min(1.45, Math.max(1.1, (s.screenZoom || 1.6) * 0.75))
  const cl = (v) => Math.min(1 - 1 / (2 * z), Math.max(1 / (2 * z), v ?? 0.5))
  const tx = r2((0.5 - cl(s.screenX)) * z * cw), ty = r2((0.5 - cl(s.screenY)) * z * ch)
  const html = `
        <div id="${id}cw" style="position:absolute;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;opacity:0">
          <div style="position:absolute;inset:0;border-radius:26px;overflow:hidden;box-shadow:0 46px 120px rgba(13,13,18,.4)">
            <div id="${id}ci" style="position:absolute;inset:0">
              <img src="${file}" style="position:absolute;left:0;top:0;width:${cw}px;height:${ch}px" />
            </div>
          </div>
        </div>`
  const js = `
  tl.fromTo('#${id}cw',{y:220,opacity:0,scale:0.94},{y:0,opacity:1,scale:1,duration:0.48,ease:'power3.out'},${liveT0});
  tl.fromTo('#${id}ci',{scale:1,x:0,y:0},{scale:${z},x:${tx},y:${ty},duration:${r2(Math.max(0.5, dur * 0.65))},ease:'power2.inOut'},${r2(liveT0 + 0.35)});
  tl.to('#${id}cw',{y:-20,duration:${r2(Math.max(0.4, dur - 0.5))},ease:'none'},${r2(liveT0 + 0.5)});`
  return { html, js, sfx: [{ kind: 'mo-swipe-1', t: r2(liveT0 + 0.1), vol: 0.5 }] }
}

// ── 3 · GÉNÉRATION ──────────────────────────────────────────────────────────
export function buildDynamicComposition(plan, opts = {}) {
  // Les sous-titres tournent-ils sur cette vidéo ? Le slam en dépend : il ne
  // doit exister que là où la bande n'écrit rien. (Défini ICI, dans la fonction
  // qui appelle typoContent — la première version était dans buildPanels, une
  // autre portée : le module se chargeait sans broncher et chaque rendu aurait
  // planté sur un ReferenceError.)
  const subsActifs = !!(plan.captions && plan.captions.length && plan.subtitles !== false)
  const W = opts.width || 1080
  const H = opts.height || 1920
  const D = r2(Math.max(1, plan.duration))
  const logoFile = opts.logoFile || ''
  // LA PHOTO D'AVATAR VIENT DU JOB. Elle était en dur : `tuto/hook-qualite.png`,
  // une photo de démo livrée avec le worker (un homme au bord d'une piscine). Sur
  // la vidéo d'un client, elle mettait le visage d'un INCONNU en plein écran dès
  // qu'une fenêtre avatar n'avait pas de clip lipsync. Le job fournit maintenant
  // la sienne (`avatar.png`) ; la photo de démo ne sert plus qu'aux essais locaux.
  const avatarStill = opts.avatarPhoto || 'tuto/hook-qualite.png'
  // #148 : un plan venu de l'orchestrateur n'a AUCUNE scène ui (le serveur reste
  // générique) — on les dérive ici depuis la voix. Un plan écrit à la main qui en
  // contient déjà garde la priorité, la dérivation ne s'exécute pas.
  // UNE SEULE DÉRIVATION. Le test « aucune scène ui » se trompait quand la
  // dérivation du worker n'en avait produit AUCUNE qui survive : elle repartait
  // ici de zéro, sur un plan déjà transformé. Deux passes = deux résultats, et
  // surtout les images demandées par la seconde (la capture du site dans le
  // navigateur) n'étaient plus copiées — page blanche, 404 dans la console.
  // Le worker pose maintenant une marque explicite.
  if (!plan.__derive && !(plan.slides || []).some((s) => s.anim === 'ui')) deriveDynamicSlides(plan, opts)
  const panels = buildPanels(plan, D)
  const PUSH = 0.42
  const DIRS = ['right', 'bottom', 'right', 'top']

  let html = ''
  let js = ''
  const sfxAdd = []
  const kbAdd = []
  let lastWhoosh = 0, whooshFlip = false

  // LE RISER, UNE SEULE FOIS PAR VIDÉO (Axel 09/08 : « le metallic riser est
  // pas mal, faudrait le mettre plus souvent — mais max 1 fois »).
  // #90 (Axel, 11/08) : « les bruitages reverse-crash / cinematic-impact /
  // metallic-riser, y'en a un qui doit être joué APRÈS le hook, pas au milieu ».
  // Le hook, c'est l'avatar qui ouvre (§0) ; la PREMIÈRE poussée de panneau
  // illustré qui le suit est LA transition forte de la vidéo — le riser monte
  // ~1,4 s avant (pendant la fin du hook) et culmine sur la coupe vers le
  // contenu. Avant, il tombait aux 55 % de la vidéo, en plein milieu.
  const iRiser = (() => {
    if (D < 18) return -1
    for (let i = 1; i < panels.length; i++) {
      const p = panels[i]
      if (p.kind === 'typo' || p.kind === 'avclip') continue
      return i
    }
    return -1
  })()

  const ap = isApple(plan)
  panels.forEach((p, i) => {
    // apple garde l'alternance (c'est elle qui donne le rythme d'un panneau à
    // l'autre) mais entre deux CLAIRS : gris iOS puis blanc.
    // un MÉDIA de l'utilisateur est toujours posé sur un fond CLAIR : Axel voulait
    // « la vidéo posée, qui ne prend pas tout l'écran, avec un fond blanc
    // derrière ». Sur un panneau sombre la carte se fondait dans le fond.
    const media = p.kind === 'media' || p.kind === 'medias'
    const tone = media ? (ap ? AP_B : LIGHT) : ap ? (i % 2 === 0 ? AP_A : AP_B) : (i % 2 === 0 ? DARK : LIGHT)
    const blobs = media ? (ap ? BLOBS.ap_b : BLOBS.light)
      : ap ? (i % 2 === 0 ? BLOBS.ap_a : BLOBS.ap_b) : (i % 2 === 0 ? BLOBS.dark : BLOBS.light)
    const id = 'pn' + i
    const t0 = p.t0, t1 = p.t1, dur = r2(t1 - t0)
    const liveT0 = i === 0 ? 0.05 : r2(t0 + 0.12)

    // — fond : 3 halos radiaux qui dérivent (phases décalées par index, sinus figé)
    let inner = ''
    let pjs = ''
    const ph = (k) => ((i * 3 + k) % 5) - 2      // -2..2 : variation déterministe
    for (let k = 0; k < 3; k++) {
      const bx = [W * 0.15, W * 0.85, W * 0.5][k] + ph(k) * 60
      const by = [H * 0.22, H * 0.55, H * 0.9][k] + ph(k) * 90
      const sz = [1500, 1300, 1600][k]
      inner += `<div id="${id}g${k}" style="position:absolute;left:${Math.round(bx - sz / 2)}px;top:${Math.round(by - sz / 2)}px;width:${sz}px;height:${sz}px;background:radial-gradient(circle,${blobs[k]}${tone === DARK ? 'CC' : ''} 0%,transparent 62%);"></div>`
      pjs += `\n  tl.fromTo('#${id}g${k}',{x:${ph(k) * 40},y:${ph(k) * 30},scale:1},{x:${-ph(k) * 60 - 30},y:${ph(k) * -70 + 20},scale:1.12,duration:${r2(dur + PUSH + 0.3)},ease:'sine.inOut'},${t0});`
    }

    // — contenu par type
    if (p.kind === 'typo') {
      const c = typoContent(id, p, tone, liveT0, subsActifs)
      inner += c.html; pjs += c.js; sfxAdd.push(...c.sfx)

    } else if (p.kind === 'ui') {
      const sc = uiScene(p.slide.ui, id, liveT0, t1, tone, p.slide)
      if (sc) {
        inner += sc.html; pjs += sc.js
        sfxAdd.push(...(sc.sfx || []))
        kbAdd.push(...(sc.keyboard || []))
      }

    } else if (p.kind === 'countup') {
      // ⚠ LE MOTEUR A SA PROPRE BRANCHE COMPTEUR, ET ELLE NE LISAIT QUE `value`.
      // Le chef d'orchestre range parfois le nombre dans `center` et un libellé
      // dans `value` (« 100 » / « % DE BENEFIC ») : le compteur partait alors de
      // 0 vers 0, et l'écran affichait un gros 0 pendant qu'Axel disait « cent
      // pour cent des bénéfices ». Un chiffre faux est pire que pas de chiffre.
      // J'ai d'abord corrigé la même faute dans anim-pack — sans effet, parce
      // que cette branche-ci passe AVANT et court-circuite le pack.
      const s = p.slide
      const source = [s.value, s.center, s.title, (s.items || [])[0] && (s.items || [])[0].text]
        .map((x) => String(x == null ? '' : x)).find((x) => /\d/.test(x)) || '0'
      const val = parseInt(source.replace(/\D/g, ''), 10) || 0
      // ── LA TAILLE DÉPEND DU NOMBRE DE CHIFFRES ──────────────────────────
      // Axel, trois fois : « 10000 ne respecte toujours pas la safezone ».
      // 330 px en dur : trois chiffres tenaient, cinq débordaient de chaque
      // côté. J'ai corrigé la même faute dans anim-pack ce matin — sans effet,
      // parce que c'est CETTE branche qui rend le compteur, et le commentaire
      // juste au-dessus le disait déjà. Deuxième fois que ce piège se referme.
      // On borne par la largeur : ~0,78 em par chiffre en graisse display, et
      // 72 % du cadre, soit 14 % de marge de chaque côté. La borne ne fait que
      // réduire — « 100 » garde exactement ses 330 px.
      const nCar = Math.max(1, String(val).length) * 1.28   // +séparateurs de milliers
      const fzN = Math.min(330, Math.round((W * 0.72) / (nCar * 0.78)))
      inner += `<div class="stack">
        <div class="disp" id="${id}n" style="font-size:${fzN}px;color:${tone.ink};opacity:0">0</div>
        <div id="${id}u" style="font-family:'JetBrains Mono',monospace;font-size:44px;letter-spacing:.3em;color:${ACC};opacity:0">${esc(s.unit || '')}</div></div>`
      pjs += `
  var ${id}v = { n: 0 };
  tl.fromTo('#${id}n',{scale:0.8,opacity:0},{scale:1.12,opacity:1,duration:${r2(Math.min(1.2, dur - 0.6))},ease:'power2.out'},${liveT0});
  tl.to(${id}v,{n:${val},duration:${r2(Math.min(1.2, dur - 0.6))},ease:'power2.out',onUpdate:function(){var el=document.getElementById('${id}n');if(el)el.textContent=String(Math.round(${id}v.n));}},${liveT0});
  tl.fromTo('#${id}u',{y:50,opacity:0},{y:0,opacity:1,duration:0.34,ease:'circ.out'},${r2(liveT0 + 0.4)});
  tl.to('#${id}n',{scale:1.18,duration:${r2(Math.max(0.3, dur - 1.4))},ease:'none'},${r2(liveT0 + Math.min(1.2, dur - 0.6))});`

    } else if (p.kind === 'logo') {
      const s = p.slide, mark = s.title || 'avatarads.fr'
      const fz = 178
      const tw = Math.round(fz * CHAR_W * mark.length)
      const logoImg = logoFile ? `<img id="${id}lg" src="${logoFile}" style="position:absolute;left:${(W - 150) / 2}px;top:600px;width:150px;height:150px;border-radius:34px;opacity:0" />` : ''
      inner += logoImg + `
        <div class="disp" id="${id}mk" style="position:absolute;left:0;top:${logoFile ? 880 : 850}px;white-space:nowrap;font-size:${fz}px;color:${tone.ink};opacity:0">${esc(mark)}</div>
        <div id="${id}un" style="position:absolute;left:120px;top:${logoFile ? 1130 : 1100}px;width:${W - 240}px;height:14px;background:${ACC}"></div>`
      if (logoFile) pjs += `\n  tl.fromTo('#${id}lg',{scale:0,opacity:0,rotation:-12},{scale:1,opacity:1,rotation:0,duration:0.5,ease:'back.out(1.7)'},${r2(liveT0 + 0.05)});`
      pjs += `
  tl.fromTo('#${id}mk',{x:${Math.round(W * 0.85)},opacity:0,filter:'blur(12px)'},{x:${Math.round(W * 0.28)},opacity:1,filter:'blur(0px)',duration:0.44,ease:'power3.out'},${r2(liveT0 + 0.05)});
  tl.to('#${id}mk',{x:${Math.round(W - tw - W * 0.26)},duration:${r2(Math.max(0.4, dur - 0.6))},ease:'none'},${r2(liveT0 + 0.55)});
  tl.fromTo('#${id}un',{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:0.34,ease:'power3.inOut'},${r2(liveT0 + 0.36)});`

    } else if (p.kind === 'screen') {
      const sc = screenContent(id, p.slide, tone, liveT0, t1, W)
      inner += sc.html; pjs += sc.js; sfxAdd.push(...sc.sfx)

    } else if (p.kind === 'multi') {
      // plusieurs actions courtes dans UN panneau : relais interne doux (l'ancien
      // contenu monte et s'efface, le nouveau monte à sa place) au lieu d'une
      // poussée plein cadre toutes les secondes
      p.subs.forEach((sub, k) => {
        const sid = id + 's' + k
        const subLive = k === 0 ? liveT0 : r2(sub.t0 + 0.06)
        const sc = sub.kind === 'screen'
          ? screenContent(sid, sub.slide, tone, subLive, sub.t1, W)
          : uiScene(sub.slide.ui, sid, subLive, sub.t1, tone, sub.slide)
        if (!sc) return
        inner += `<div id="${sid}wr" style="position:absolute;inset:0;${k > 0 ? 'opacity:0' : ''}">${sc.html}</div>`
        pjs += sc.js
        sfxAdd.push(...(sc.sfx || [])); kbAdd.push(...(sc.keyboard || []))
        if (k > 0) {
          pjs += `
  tl.to('#${id}s${k - 1}wr',{y:-140,autoAlpha:0,duration:0.3,ease:'power2.inOut'},${r2(sub.t0 - 0.06)});
  tl.fromTo('#${sid}wr',{y:150,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'power3.out'},${r2(sub.t0)});`
        }
      })

    } else if (p.kind === 'result') {
      const s = p.slide
      const sc = uiScene('phone', id, liveT0, t1, tone, s)
      if (sc) { inner += sc.html; pjs += sc.js }

    } else if (p.kind === 'medias') {
      // L'ÉNUMÉRATION EN PHOTOS. « Homme, femme, coach sportif » : les trois
      // cartes sont là dès l'ouverture, en gris et rétrécies, et chacune se
      // COLORE ET GRANDIT sur SON mot. On lit l'énumération entière d'un coup
      // d'œil et on voit quand même le mot prononcé — ce qu'un panneau par mot
      // ne pouvait pas faire à 0,3 s d'intervalle.
      const its = (p.slide.items || []).slice(0, 4)
      const n = its.length || 1
      const gap = Math.round(W * 0.025)
      const cw = Math.round((W * 0.9 - gap * (n - 1)) / n)
      const ch = Math.round(cw * 16 / 9)
      const x0 = Math.round((W - (cw * n + gap * (n - 1))) / 2)
      const cy = Math.round((H - ch) / 2)
      its.forEach((it, k) => {
        const cid = id + 'ms' + k
        const cx = x0 + k * (cw + gap)
        const vid = /\.(mp4|mov|webm|m4v)$/i.test(String(it.src || ''))
        const corps = vid
          ? `<video class="clip" src="${esc(it.src)}" data-start="${liveT0}" data-duration="${dvid(t1 - liveT0)}" data-track-index="${8 + k}" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`
          : `<img src="${esc(it.src)}" style="width:100%;height:100%;object-fit:cover;display:block"/>`
        inner += `<div class="an-p" id="${cid}" style="left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw * 0.12)}px;overflow:hidden;box-shadow:0 26px 60px -18px rgba(0,0,0,.5)">${corps}</div>`
        // arrivée en cascade à l'ouverture du panneau…
        pjs += `\n  tl.fromTo('#${cid}',{yPercent:14,scale:0.9,autoAlpha:0},{yPercent:0,scale:0.88,autoAlpha:1,duration:0.34,ease:'power3.out',transformOrigin:'50% 50%'},${r2(liveT0 + k * 0.07)});`
        pjs += `\n  tl.set('#${cid}',{filter:'grayscale(1) brightness(1.06)'},${liveT0});`
        // …puis SON mot : elle passe en couleur et prend la place
        const tw = Math.max(liveT0 + 0.1, Math.min(r2(it.t || liveT0), t1 - 0.2))
        pjs += `\n  tl.to('#${cid}',{scale:1.1,filter:'grayscale(0) brightness(1)',duration:0.26,ease:'back.out(2)',transformOrigin:'50% 50%'},${tw});`
        pjs += `\n  tl.to('#${cid}',{scale:0.96,duration:0.3,ease:'power2.out',transformOrigin:'50% 50%'},${r2(tw + 0.34)});`
        sfxAdd.push({ kind: 'mo-pop-2', t: tw, vol: 0.5 })
        // LA DERNIÈRE PHOTO EMPORTE L'ÉCRAN. Axel : « zoom sur la dernière image,
        // celle du coach sportif, pour faire la transition, ça peut être cool ».
        // Elle grandit jusqu'à couvrir le cadre pendant que les autres s'effacent :
        // l'énumération se termine sur une image, pas sur un fondu.
        if (k === its.length - 1) {
          const t2 = r2(Math.max(tw + 0.5, t1 - 0.85))
          pjs += `\n  tl.to('#${cid}',{scale:${r2(Math.max(H / ch, W / cw) * 1.06)},duration:0.8,ease:'power2.in',transformOrigin:'50% 50%'},${t2});`
          pjs += `\n  tl.to('#${cid}',{borderRadius:0,duration:0.5,ease:'power2.in'},${t2});`
          sfxAdd.push({ kind: 'mo-whoosh-1', t: t2, vol: 0.5 })
        } else {
          pjs += `\n  tl.to('#${cid}',{autoAlpha:0,scale:0.86,duration:0.34,ease:'power2.in',transformOrigin:'50% 50%'},${r2(Math.max(tw + 0.5, t1 - 0.8))});`
        }
      })

    } else if (p.kind === 'photowall') {
      // « CRÉE DES DIZAINES DE PHOTOS D'ELLE » (Axel, 11/08) : un MUR de photos —
      // l'image en grand en haut, puis une grille de clichés en dessous, chacun
      // qui se pose en cascade avec un déclic d'obturateur. On MONTRE l'abondance :
      // « des dizaines de photos » ne se dit pas en texte, ça se voit.
      const its = (p.slide.items || []).filter((it) => it && it.src)
      const mk = (src, x, y, w, h, rad) => {
        const vid = /\.(mp4|mov|webm|m4v)$/i.test(String(src || ''))
        const body = vid
          ? `<video class="clip" src="${esc(src)}" data-start="${liveT0}" data-duration="${dvid(t1 - liveT0)}" data-track-index="12" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`
          : `<img src="${esc(src)}" style="width:100%;height:100%;object-fit:cover;display:block"/>`
        return { x, y, w, h, rad, body }
      }
      const cells = []
      const hero = its[0]
      if (hero) cells.push({ ...mk(hero.src, Math.round((W - 540) / 2), 92, 540, 675, 30), hero: true })
      const gw = 319, gh = 319, gap = 18, x0 = Math.round((W - (gw * 3 + gap * 2)) / 2), gy0 = 796
      its.slice(1, 7).forEach((it, k) => {
        const col = k % 3, row = Math.floor(k / 3)
        cells.push(mk(it.src, x0 + col * (gw + gap), gy0 + row * (gh + gap), gw, gh, 20))
      })
      cells.forEach((c, k) => {
        const cid = id + 'pw' + k
        inner += `<div class="an-p" id="${cid}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;border-radius:${c.rad}px;overflow:hidden;box-shadow:0 30px 70px -20px rgba(0,0,0,.4),0 0 0 1px rgba(0,0,0,.06)">${c.body}</div>`
        const t = c.hero ? liveT0 : r2(liveT0 + 0.34 + (k - 1) * 0.09)
        pjs += `\n  tl.fromTo('#${cid}',{yPercent:12,scale:${c.hero ? 0.92 : 0.8},autoAlpha:0},{yPercent:0,scale:1,autoAlpha:1,duration:${c.hero ? 0.42 : 0.3},ease:'back.out(1.6)',transformOrigin:'50% 50%'},${t});`
        sfxAdd.push({ kind: 'camera-shutter', t: r2(t + 0.02), vol: c.hero ? 0.6 : 0.4 })
      })

    } else if (p.kind === 'media') {
      // LE MÉDIA DE L'UTILISATEUR, POSÉ SUR LA PAGE. Ce style n'en affichait
      // aucun : `plan.broll` n'était lu que par le chemin classique. Je l'avais
      // d'abord mis plein cadre ; Axel : « la vidéo de la fille je la vois
      // plutôt posée, qui ne prend pas tout l'écran, avec un fond blanc
      // derrière ». Une carte flottante à coins ronds, avec son ombre portée :
      // on voit que c'est un RÉSULTAT montré, pas la vidéo elle-même.
      const src = String(p.slide.src || '')
      const vid = /\.(mp4|mov|webm|m4v)$/i.test(src)
      // POSITION LIBRE (« Détails du montage ») : l'utilisateur a posé sa carte
      // où il veut dans le cadre — pos {x,y,w} en fractions, x/y = centre.
      // Sans pos : la carte centrée historique.
      const pos = p.slide.pos && typeof p.slide.pos === 'object' ? p.slide.pos : null
      const cw = Math.round(W * (pos && pos.w ? Math.min(0.95, Math.max(0.18, Number(pos.w))) : 0.74))
      const ch = Math.round(cw * 16 / 9)
      const cx = pos && pos.x != null
        ? Math.round(Math.min(W - cw, Math.max(0, Number(pos.x) * W - cw / 2)))
        : Math.round((W - cw) / 2)
      const cy = pos && pos.y != null
        ? Math.round(Math.min(H - ch, Math.max(0, Number(pos.y) * H - ch / 2)))
        : Math.round((H - ch) / 2)
      const rad = Math.round(cw * 0.075)
      const card = (body) => `<div class="an-p" id="${id}md" style="left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${rad}px;overflow:hidden;box-shadow:0 40px 90px -20px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.06)">${body}</div>`
      if (vid) {
        inner += card(`<video id="${id}mv" class="clip" src="${esc(src)}" data-start="${liveT0}" data-duration="${dvid(t1 - liveT0)}" data-track-index="8" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`)
      } else {
        inner += card(`<img src="${esc(src)}" style="width:100%;height:100%;object-fit:cover;display:block"/>`)
      }
      // elle ARRIVE : sans ça la carte est déjà là quand le panneau s'ouvre
      pjs += `\n  tl.fromTo('#${id}md',{yPercent:8,scale:0.94,autoAlpha:0},{yPercent:0,scale:1,autoAlpha:1,duration:0.42,ease:'back.out(1.5)',transformOrigin:'50% 50%'},${liveT0});`
      sfxAdd.push({ kind: 'mo-pop-2', t: r2(liveT0 + 0.05), vol: 0.55 })

    } else if (p.kind === 'avclip') {
      // #149 · le VISAGE plein écran : clip lipsync si fourni (muet, calé sur la
      // voix qui continue), sinon la photo avatar en zoom lent — « les viewers
      // ont un visuel de visage », le panneau tient l'écran sans texte
      const src = (opts.avatarClips || {})['av' + p.slide.i]
      const duo = p.slide.duo
      if (duo) {
        // HOOK v3 (Axel, 09/08, réf @tians028) : « la vidéo AvatarAds×Claude
        // cache le visage — réduis-la et mets-la en haut, au niveau des
        // cheveux ». L'avatar prend donc TOUT le cadre (c'est lui qui porte le
        // hook), et la vidéo de marque devient une carte réduite posée en haut :
        // on voit le sujet ET celui qui parle, sans sacrifier le visage.
        const bot = src
          ? `<video id="${id}av" class="clip" src="${esc(src)}" data-start="${liveT0}" data-duration="${dvid(t1 - liveT0)}" data-track-index="9" muted playsinline style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover"></video>`
          : `<div id="${id}av" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;background:url('${esc(avatarStill)}') center 38%/cover"></div>`
        inner += bot
        const cw = Math.round(W * 0.64), ch = Math.round(cw * 9 / 16)
        const cx2 = Math.round((W - cw) / 2), cy = Math.round(H * 0.05)
        const rd = Math.round(cw * 0.055)
        // Axel 09/08 : « mets-la que 2 secondes ». btOut est calculé AVANT le
        // markup : la fenêtre du clip vidéo doit s'arrêter à la sortie de la
        // carte — hyperframes composite les .clip par leur data-duration, en
        // couche indépendante : un autoAlpha GSAP sur le div parent ne cache
        // PAS la vidéo (c'est pour ça que la carte v6/v7 restait collée à
        // l'écran jusqu'à la fin du hook malgré le tween de sortie).
        const btOut = r2(Math.min(liveT0 + 2.35, t1 - 0.4))
        if (duo.src && /\.(png|jpe?g|webp)(\?|$)/i.test(duo.src)) {
          inner += `<div class="an-p" id="${id}bt" style="left:${cx2}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${rd}px;overflow:hidden;background:#000 url('${esc(duo.src)}') center/cover;box-shadow:0 26px 60px rgba(0,0,0,.55)"></div>`
        } else if (duo.src) {
          inner += `<div class="an-p" id="${id}bt" style="left:${cx2}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${rd}px;overflow:hidden;background:#000;box-shadow:0 26px 60px rgba(0,0,0,.55)">
            <video class="clip" src="${esc(duo.src)}" data-start="${liveT0}" data-duration="${dvid(btOut - liveT0)}" data-track-index="7" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video></div>`
        } else {
          inner += `<div class="an-p" id="${id}bt" style="left:${cx2}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${rd}px;background:#F0EEE6;display:flex;align-items:center;justify-content:center;box-shadow:0 26px 60px rgba(0,0,0,.55)">
            <span style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(cw * 0.13)}px;color:#D97757;letter-spacing:-.02em">${esc(duo.brand)}</span></div>`
        }
        // la carte TOMBE du haut, respire un instant… et COUPE SEC à la fin de
        // la fenêtre de sa vidéo (cut assumé, comme la réf) : le cadre fond en
        // 0,14 s pour finir à alpha 0 PILE à l'instant où la couche vidéo se
        // coupe — jamais de cadre noir orphelin, jamais de vidéo qui flotte.
        const tCut = r2(liveT0 + dvid(btOut - liveT0))
        pjs += `\n  tl.fromTo('#${id}bt',{y:-${Math.round(ch * 1.3)},autoAlpha:0},{y:0,autoAlpha:1,duration:0.5,ease:'back.out(1.6)'},${r2(liveT0 + 0.1)});`
        pjs += `\n  tl.to('#${id}bt',{scale:1.04,duration:${r2(Math.max(0.5, tCut - liveT0 - 0.85))},ease:'sine.inOut',transformOrigin:'50% 0%'},${r2(liveT0 + 0.7)});`
        pjs += `\n  tl.to('#${id}bt',{autoAlpha:0,scale:1.07,duration:0.14,ease:'power1.in',transformOrigin:'50% 0%'},${r2(tCut - 0.14)});`
        sfxAdd.push({ kind: 'mo-impact-1', t: r2(liveT0 + 0.14), vol: 0.7 })
        sfxAdd.push({ kind: 'mo-swipe-1', t: r2(tCut - 0.1), vol: 0.35 })
        // la montée qui déboule sur le premier punch de zoom (réf : BGM & SFX)
        sfxAdd.push({ kind: 'mo-riser-1', t: r2(liveT0 + 2.3), vol: 0.3 })
      } else if (src) {
        // CADRAGE DE LA PHOTO, INTACT. J'avais recadré serré pour cacher une main
        // ratée par le lipsync — mauvaise réponse : ça masquait aussi les gestes,
        // et Axel les veut (« ça animé c'était bien, ça rajoute un truc de parler
        // avec les mains »). Le défaut se corrige à la source, dans le prompt
        // Hedra (mcp/index.ts) ; ici on rend l'image telle qu'il l'a composée.
        inner += `<video id="${id}av" class="clip" src="${esc(src)}" data-start="${liveT0}" data-duration="${dvid(t1 - liveT0)}" data-track-index="9" muted playsinline style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover"></video>`
      } else {
        // UNE PHOTO PAR FENÊTRE, PAS UNE POUR TOUTE LA VIDÉO. Axel : « 2 avatars
        // principaux différents ». Le hook et le CTA sont deux moments distincts ;
        // le même visage figé aux deux bouts donne l'impression d'un seul plan
        // recollé. `photo` sur le segment prime, `avatarStill` reste le défaut.
        const still = String(p.slide.photo || '') || avatarStill
        inner += `<div id="${id}av" style="position:absolute;left:-3%;top:-3%;width:106%;height:106%;background:url('${esc(still)}') center/cover"></div>`
        pjs += `\n  tl.fromTo('#${id}av',{scale:1},{scale:1.07,duration:${r2(Math.max(0.8, t1 - liveT0))},ease:'none'},${liveT0});`
      }

      // ── #68 « RAW vs EDITED » : LE HOOK BOUGE (Axel, 07/08) ────────────────
      // Réf TikTok @tians028 : pendant l'accroche, la caméra respire — zoom-in
      // et zoom-out alternés toutes les ~1,5 s sur le clip qui parle, un whoosh
      // discret sur le premier. UNIQUEMENT le panneau qui ouvre la vidéo
      // (t0 < 0,6 s) : le reste du montage garde son calme, c'est le contraste
      // qui claque. Temps absolus sur la timeline → seek-safe, comme le reste.
      // v2 (retour d'Axel, 08/08 soir, réf QuickTime) : « je veux l'effet de
      // zoom la première seconde, la 2e seconde il revient normal avec les
      // sous-titres voyants, avec toujours une dynamique de zoom sur l'avatar
      // toutes les 3 secondes ». Donc : on OUVRE déjà zoomé (1.14), retour au
      // calme à ~1,2 s, puis un punch de respiration toutes les 3 s.
      if (p.t0 < 0.6 && src) {
        pjs += `\n  tl.fromTo('#${id}av',{scale:1.14},{scale:1.14,duration:0.9,ease:'none',transformOrigin:'50% 30%'},${liveT0});`
        pjs += `\n  tl.to('#${id}av',{scale:1.0,duration:0.55,ease:'power2.inOut',transformOrigin:'50% 30%'},${r2(liveT0 + 0.9)});`
        sfxAdd.push({ kind: 'mo-whoosh-1', t: r2(liveT0 + 0.92), vol: 0.4 })
        let zt = r2(liveT0 + 3.4)
        while (zt < t1 - 0.9) {
          pjs += `\n  tl.to('#${id}av',{scale:1.09,duration:0.3,ease:'power3.out',transformOrigin:'50% 30%'},${zt});`
          pjs += `\n  tl.to('#${id}av',{scale:1.0,duration:0.5,ease:'power2.inOut',transformOrigin:'50% 30%'},${r2(zt + 0.55)});`
          sfxAdd.push({ kind: 'mo-whoosh-1', t: zt, vol: 0.3 })
          zt = r2(zt + 3.0)
        }
      } else if (p.t0 < 12 && src) {
        // la suite du hook (le plein cadre après le split) garde la même
        // respiration : un punch toutes les 3 s, jamais d'écran statique
        let zt = r2(liveT0 + 1.6)
        while (zt < t1 - 0.9) {
          pjs += `\n  tl.to('#${id}av',{scale:1.08,duration:0.3,ease:'power3.out',transformOrigin:'50% 30%'},${zt});`
          pjs += `\n  tl.to('#${id}av',{scale:1.0,duration:0.5,ease:'power2.inOut',transformOrigin:'50% 30%'},${r2(zt + 0.55)});`
          zt = r2(zt + 3.0)
        }
      }

      // ── #68 (suite) : LA NOTIFICATION QUAND LE SCRIPT LA NOMME ─────────────
      // Réf @tians028 : la bannière iOS tombe pile quand la voix dit « tu reçois
      // une notification / un message / une vente ». Axel : « mais qui
      // corresponde à son script… je ne dis pas que l'effet notifications faut
      // le mettre à chaque fois ». Donc : DÉTECTION stricte dans les mots du
      // hook (les 12 premières secondes), une seule bannière, jamais de chiffre
      // inventé (le libellé reste générique — la règle « le chiffre vient de ce
      // qui est DIT » s'applique aussi ici).
      if (p.t0 < 12) {
        const NOTIF = [
          [/notification|notif\b/i, 'Nouvelle notification'],
          [/message/i, 'Nouveau message'],
          [/abonn[ée]/i, 'Nouvel abonné'],
          [/\bvente/i, 'Nouvelle vente'],
          [/commande/i, 'Nouvelle commande'],
          [/\blikes?\b/i, 'Nouveau like'],
        ]
        let hit = null
        for (const c of plan.captions || []) {
          const cs = Number(c.start) || 0
          if (cs < liveT0 - 0.05 || cs > t1 - 0.9 || cs > 12) continue
          for (const [re, lib] of NOTIF) { if (re.test(String(c.text || ''))) { hit = { t: cs, lib }; break } }
          if (hit) break
        }
        if (hit) {
          const nid = id + 'ntf'
          const nw = Math.round(W * 0.86), nx = Math.round((W - nw) / 2)
          const tN = r2(Math.max(liveT0 + 0.25, hit.t - 0.1))
          inner += `<div id="${nid}" style="position:absolute;left:${nx}px;top:${Math.round(H * 0.045)}px;width:${nw}px;display:flex;align-items:center;gap:${Math.round(nw * 0.032)}px;padding:${Math.round(nw * 0.036)}px ${Math.round(nw * 0.042)}px;border-radius:${Math.round(nw * 0.062)}px;background:rgba(22,22,26,.92);backdrop-filter:blur(14px);box-shadow:0 24px 60px rgba(0,0,0,.5);opacity:0;z-index:9">
            <span style="width:${Math.round(nw * 0.115)}px;height:${Math.round(nw * 0.115)}px;border-radius:${Math.round(nw * 0.028)}px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#FF5A1F,#FF8A50)">
              <svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg></span>
            <span style="display:flex;flex-direction:column;gap:2px;min-width:0">
              <span style="font-family:'Inter',sans-serif;font-weight:700;font-size:${Math.round(nw * 0.048)}px;color:#fff;line-height:1.15">${esc(hit.lib)}</span>
              <span style="font-family:'Inter',sans-serif;font-weight:500;font-size:${Math.round(nw * 0.038)}px;color:rgba(255,255,255,.55)">AvatarAds · à l'instant</span></span></div>`
          pjs += `\n  tl.fromTo('#${nid}',{y:-140,autoAlpha:0},{y:0,autoAlpha:1,duration:0.5,ease:'back.out(1.7)'},${tN});`
          pjs += `\n  tl.to('#${nid}',{y:-140,autoAlpha:0,duration:0.4,ease:'power2.in'},${r2(Math.min(t1 - 0.35, tN + 2.4))});`
          sfxAdd.push({ kind: 'message-tone', t: r2(tN + 0.08), vol: 0.85 })
        }
      }

      // ── LE MÉDAILLON : SON MÉDIA POSÉ SUR L'AVATAR QUI PARLE ────────────────
      // Axel, sur sa vidéo d'influenceuse : « tu vas garder l'avatar principal qui
      // parle et tu vas ajouter la vidéo que je t'envoie, tu la mets en plus
      // petit ». Le média volait la fenêtre entière — on perdait le visage qui
      // porte le hook. Ici il devient une carte flottante en haut, l'avatar
      // continue de parler dessous : on voit CE DONT il parle ET qui le dit.
      for (const [k, ins] of (p.slide.insets || []).entries()) {
        // LE MÉDAILLON PREND LA FORME DE SON MÉDIA. La carte était portrait en
        // dur : une animation 16:9 (les deux logos côte à côte) s'y retrouvait
        // recadrée au centre, donc amputée de ses deux logos — exactement ce
        // qu'elle avait à montrer. `ratio` = largeur/hauteur de la source.
        const rat = Number(ins.ratio) > 0 ? Number(ins.ratio) : 9 / 16
        // ── UN PAYSAGE NE SE MET PAS DANS UN COIN ─────────────────────────
        // À 42 % de large, un 16:9 fait 454×255 px sur du 1080 : une capture
        // d'app y est illisible. Axel, en voyant sa démo AvatarAds×Claude à
        // côté du visage — « on ne voit pas le mp4, laisse dans sa forme
        // actuelle plutôt ». Un portrait, lui, reste très lisible en coin :
        // c'est ce qu'il avait demandé le 31/07 pour l'influenceuse.
        // Donc la forme décide : portrait au coin, paysage en BANDE pleine
        // largeur, posée haut. Le visage reste visible dessous dans les deux
        // cas — la règle « l'avatar ouvre toujours » n'est pas entamée.
        const large = rat > 1.15
        // MOYEN ET CENTRÉ quand le média est ce qu'il MONTRE (« regarde ça,
        // c'est je pense la meilleure qualité ») : Axel 05/08 veut « l'image en
        // moyen avec l'avatar qui parle derrière ». Le coin 42 % reste pour le
        // média d'accompagnement de l'accroche (Léna, 31/07).
        const prom = !large && ins.prominent
        const iw = Math.round(W * (large ? 0.92 : prom ? 0.56 : 0.42))
        const ih = Math.round(iw / rat)
        const ix = large || prom ? Math.round((W - iw) / 2) : Math.round(W - iw - W * 0.06)
        const iy = prom ? Math.round((H - ih) / 2) : Math.round(H * (large ? 0.13 : 0.11))
        const iid = id + 'in' + k
        const a = Math.max(liveT0, r2(ins.start))
        let b = Math.min(t1, r2(ins.end))
        // LE MÉDAILLON DE L'ACCROCHE NE S'INCRUSTE PAS (Axel 09/08 : « mets-la
        // que 2 secondes ») : sur le hook, la carte entre, se lit, et rend le
        // visage avant la 3e seconde. C'était ELLE qui restait collée en haut
        // tout le hook — pas le duo, que ce plan n'a même pas. Les médaillons
        // des autres fenêtres gardent leur durée.
        if (p.t0 < 0.6) b = Math.min(b, r2(a + 2.1))
        if (b - a < 0.3) continue
        const isVid = /\.(mp4|mov|webm|m4v)$/i.test(String(ins.src || ''))
        const corps = isVid
          ? `<video id="${iid}v" class="clip" src="${esc(ins.src)}" data-start="${a}" data-duration="${dvid(b - a)}" data-track-index="8" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`
          : `<img src="${esc(ins.src)}" style="width:100%;height:100%;object-fit:cover;display:block"/>`
        inner += `<div class="an-p" id="${iid}" style="left:${ix}px;top:${iy}px;width:${iw}px;height:${ih}px;border-radius:${Math.round(iw * 0.1)}px;overflow:hidden;box-shadow:0 30px 70px -14px rgba(0,0,0,.55),0 0 0 3px rgba(255,255,255,.85)">${corps}</div>`
        pjs += `\n  tl.fromTo('#${iid}',{scale:0.6,rotation:-6,autoAlpha:0},{scale:1,rotation:0,autoAlpha:1,duration:0.42,ease:'back.out(1.7)',transformOrigin:'50% 50%'},${a});`
        pjs += `\n  tl.to('#${iid}',{scale:0.7,autoAlpha:0,duration:0.26,ease:'power2.in',transformOrigin:'50% 50%'},${r2(b - 0.26)});`
        sfxAdd.push({ kind: 'mo-pop-2', t: r2(a + 0.05), vol: 0.5 })
        // sa sortie en cours de fenêtre s'entend aussi (départ visible = son)
        if (b < t1 - 0.35) sfxAdd.push({ kind: 'mo-swipe-1', t: r2(b - 0.24), vol: 0.35 })
      }

    } else if (p.kind !== 'punch' && ANIMS.includes(p.kind)) {
      // PACK D'ANIMATIONS SÉMANTIQUES (#147 — « des animations plutôt que des
      // mots ») : le plan a choisi une anim qui ILLUSTRE la phrase (network,
      // target, grow, money…). Plein panneau, palette adaptée au tone, temps
      // absolus — le pack est déjà seek-safe.
      // LA VIGNETTE D'UNE VIDÉO, C'EST SON VISAGE. Les animations qui montrent
      // « sa » vidéo (le compteur de vues, le profil) tombaient sur un dégradé
      // orange faute d'image : un rectangle plein, illisible. La photo d'avatar
      // du job fait une vraie miniature — c'est SA vidéo qu'on regarde monter.
      const s = { ...p.slide, id, start: liveT0, dur: Math.max(0.8, t1 - liveT0),
        logoFile: p.slide.logoFile || (['views', 'linkbio', 'bio', 'post'].includes(p.kind) ? avatarStill : '') }
      const ah = animHtml(p.kind, s, W, H, ap ? 'apple' : tone.dark ? 'dynamic' : 'word')
      if (ah) {
        // frame() du pack vise le haut (au-dessus des sous-titres du mode
        // classique) : ici pas de sous-titres → on recentre et on grossit
        inner += `<div style="position:absolute;inset:0;transform:translateY(${Math.round(H * 0.17)}px) scale(1.22);transform-origin:50% 38%">${ah}</div>`
        pjs += animJs(p.kind, s, r2)
        // SON = ACTION, aussi pour les animations : elles arrivaient en SILENCE
        // (« y'a même plus de bruitage », Axel). Chacune sonne comme ce qu'elle
        // montre — un tampon claque, un post part, un compteur monte.
        const AN_SFX = { sign: ['mo-impact-1', 0.75, 0.95], tools: ['mo-pop-2', 0.6, 0.15],
          post: ['mo-swipe-1', 0.6, 0.6], compare: ['mo-impact-3', 0.6, 0.2],
          grow: ['mo-riser-1', 0.5, 0.15], money: ['mo-pop-1', 0.6, 0.2],
          network: ['mo-pop-2', 0.55, 0.2], clock: ['mo-tick-1', 0.5, 0.15],
          target: ['mo-impact-1', 0.6, 0.25], idea: ['mo-pop-3', 0.6, 0.2] }
        const a = AN_SFX[p.kind] || ['mo-pop-3', 0.5, 0.15]
        sfxAdd.push({ kind: a[0], t: r2(liveT0 + a[2]), vol: a[1] })
        if (p.kind === 'post') sfxAdd.push({ kind: 'mo-pop-1', t: r2(liveT0 + 1.05), vol: 0.65 })
      }

    } else if (p.kind === 'content') {
      // LA MATIERE AU LIEU DES MOTS GEANTS : eyebrow, titre, chiffre (kpi),
      // lignes cochees — chaque ligne apparait SUR son mot quand le plan donne
      // son timing (it.t), sinon en cascade. C'est le rendu qui manquait aux
      // slides serveur gardees par la derivation.
      const s = p.slide
      const ACC = ap ? '#FF5A36' : '#FF6B35'
      const parts = String(s.title || '').split(/\s*\/\s*/).filter(Boolean)
      let y = 520
      let html = ''
      if (s.eyebrow) {
        html += `<div id="${id}eb" style="position:absolute;left:0;right:0;top:${y}px;text-align:center;font-size:34px;font-weight:600;letter-spacing:.24em;color:${tone.mute};opacity:0">${esc(String(s.eyebrow).toUpperCase())}</div>`
        y += 84
      }
      if (parts.length) {
        const fz = fitSize(parts.reduce((a2, b2) => a2.length > b2.length ? a2 : b2, ''), W - 180, 58, 104)
        html += `<div class="disp" id="${id}ti" style="position:absolute;left:70px;right:70px;top:${y}px;text-align:center;font-size:${fz}px;line-height:1.1;color:${tone.ink};opacity:0">${parts.map((l) => esc(l)).join('<br>')}</div>`
        y += Math.round(fz * 1.16 * parts.length) + 46
      }
      const lignes = (s.items || []).filter((it) => String(it.text || '').trim())
      if (s.type === 'kpi') {
        const it0 = lignes[0] || {}
        const val = String(it0.text || (String(s.center || '') + String(s.value || '')) || '').trim()
        const lab = String(it0.label || s.sub || '').trim()
        if (val) {
          html += `<div class="disp" id="${id}kp" style="position:absolute;left:0;right:0;top:${y}px;text-align:center;font-size:186px;color:${ACC};opacity:0">${esc(val)}</div>`
          y += 216
        }
        if (lab) {
          html += `<div id="${id}kl" style="position:absolute;left:0;right:0;top:${y}px;text-align:center;font-size:44px;font-weight:600;letter-spacing:.12em;color:${tone.mute};opacity:0">${esc(lab.toUpperCase())}</div>`
        }
        pjs += `
  tl.fromTo('#${id}kp',{scale:0.6,opacity:0},{scale:1,opacity:1,duration:0.4,ease:'back.out(1.8)',transformOrigin:'50% 50%'},${r2(liveT0 + 0.3)});
  tl.fromTo('#${id}kl',{y:14,opacity:0},{y:0,opacity:1,duration:0.28,ease:'power3.out'},${r2(liveT0 + 0.5)});`
        sfxAdd.push({ kind: 'mo-pop-1', t: r2(liveT0 + 0.32), vol: 0.6 })
      } else {
        lignes.forEach((it, i2) => {
          const ty = y + i2 * 104
          html += `<div class="an-p" id="${id}l${i2}" style="left:150px;right:150px;top:${ty}px;height:84px;border-radius:22px;background:${ap ? 'rgba(17,17,17,.05)' : 'rgba(255,255,255,.08)'};opacity:0;display:flex;align-items:center;gap:22px;padding:0 30px">
            <span style="width:40px;height:40px;border-radius:50%;background:${ACC};flex:0 0 auto;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5L19 7"/></svg></span>
            <span style="font-size:40px;font-weight:700;color:${tone.ink};letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(String(it.text))}</span></div>`
          // la ligne claque SUR son mot quand le plan donne le timing — jamais
          // avant le debut du panneau, jamais apres sa fin
          const tAt = r2(Math.min(Math.max(liveT0 + 0.25 + i2 * 0.14, Number(it.t) || 0), t1 - 0.4))
          pjs += `
  tl.fromTo('#${id}l${i2}',{x:-36,opacity:0},{x:0,opacity:1,duration:0.3,ease:'power3.out'},${tAt});`
          sfxAdd.push({ kind: 'mo-pop-2', t: r2(tAt + 0.04), vol: 0.42 })
        })
      }
      inner += html
      pjs += `
  tl.fromTo('#${id}eb',{y:-18,opacity:0},{y:0,opacity:1,duration:0.3,ease:'power3.out'},${r2(liveT0 + 0.05)});
  tl.fromTo('#${id}ti',{y:20,opacity:0,filter:'blur(8px)'},{y:0,opacity:1,filter:'blur(0px)',duration:0.42,ease:'power4.out'},${r2(liveT0 + 0.15)});`

    } else if (p.kind === 'punch') {
      // CTA : le verbe en haut, LE MOT à taper en géant, et la barre de
      // commentaire TikTok qui le tape puis l'envoie — on montre le geste demandé.
      // ⚠️ La barre de commentaire n'apparaît QUE sur le VRAI CTA (slide.cta).
      // Les cartes `punch` de l'orchestrateur (« CONTRATS À MILLIERS D'EUROS »)
      // passaient par ici et se retrouvaient présentées comme un commentaire —
      // Axel : « SIGNENT est présenté comme le mettre en commentaire alors que
      // ce n'est pas l'objectif ».
      const s = p.slide
      const isCta = !!s.cta
      const txt = (s.items && s.items[0] && s.items[0].text) || s.title || ''
      const tAt = Math.max(liveT0, (s.items && s.items[0] && s.items[0].t) || liveT0)
      const m = txt.match(/^(\S+)\s+(.+)$/)                   // « Commente » + « Avatar »
      const verb = m ? m[1] : '', word = m ? m[2] : txt
      const kw = word.replace(/[«»\s]/g, '') || 'Avatar'
      const fz = fitSize(word, W - 170, 84, 150)
      inner += `
        <div id="${id}vb" style="position:absolute;left:0;right:0;top:640px;text-align:center;font-size:56px;font-weight:600;color:${tone.mute};opacity:0">${esc(verb)}</div>
        <div class="disp" id="${id}tx" style="position:absolute;left:0;right:0;top:730px;text-align:center;font-size:${fz}px;color:${tone.ink};line-height:1.06;opacity:0">${esc(word)}</div>`
      pjs += `
  tl.fromTo('#${id}vb',{y:-40,opacity:0},{y:0,opacity:1,duration:0.32,ease:'power3.out'},${r2(Math.max(liveT0, tAt - 0.15))});
  tl.fromTo('#${id}tx',{scale:1.5,opacity:0,filter:'blur(14px)'},{scale:1,opacity:1,filter:'blur(0px)',duration:0.48,ease:'power4.out'},${r2(tAt)});
  tl.to('#${id}tx',{scale:1.04,duration:${r2(Math.max(0.4, (t1 - tAt - 0.5) / 2))},ease:'sine.inOut',yoyo:true,repeat:1},${r2(tAt + 0.55)});`
      if (isCta) {
        const sc = uiScene('comment', id, r2(tAt + 0.45), t1, tone, { word: kw, zoom: 'in' })
        // …et sa frappe : sans ce kbAdd, le mot du CTA s'écrivait en silence
        if (sc) { inner += sc.html; pjs += sc.js; sfxAdd.push(...(sc.sfx || [])); kbAdd.push(...(sc.keyboard || [])) }
        // L'ADRESSE PRONONCÉE, AVEC LE LOGO. Il dit deux choses dans le CTA :
        // commente le mot, et va sur le site. Seul le mot était à l'écran.
        if (s.site) {
          const ls = Math.round(H * 0.052)
          inner += `<div class="an-p" id="${id}st" style="left:0;top:${Math.round(H * 0.205)}px;width:${W}px;display:flex;align-items:center;justify-content:center;gap:${Math.round(ls * 0.34)}px">
            ${logoFile ? `<img src="${esc(logoFile)}" style="height:${ls}px;width:auto;display:block"/>` : ''}
            <span style="font-family:'Archivo Black',sans-serif;font-size:${ls}px;color:${tone.ink};letter-spacing:-.02em">${esc(s.site)}</span></div>`
          pjs += `\n  tl.fromTo('#${id}st',{y:${Math.round(H * 0.03)},autoAlpha:0},{y:0,autoAlpha:1,duration:0.42,ease:'back.out(1.5)'},${r2(Math.min(t1 - 0.5, tAt + 0.8))});`
        }
      }
      sfxAdd.push({ kind: 'mo-impact-2', t: r2(tAt), vol: 0.6 })
    }

    // LA COUCHE MÉDIA POSÉE PAR-DESSUS (détails du montage : « le média se
    // pose juste dessus, sans supprimer le module ») — carte flottante avec
    // son arrivée, au-dessus du contenu du panneau.
    // ── LA PASTILLE « CLAUDE » A ÉTÉ RETIRÉE ────────────────────────────────
    // Elle avait été demandée le 02/08 (« à chaque fois que je dis Claude je veux
    // voir le logo »), puis retirée le même soir en la voyant à l'écran : « en
    // vrai le logo Claude est inutile, on ne comprend pas pourquoi il est là,
    // supprime-le ». Un logo qui se pose sans raison lisible sur une animation
    // qui parle d'autre chose ne dit rien — la conversation avec Claude, elle,
    // se montre par l'animation `chat`, et la connexion par `connect`.
    if (p.slide && p.slide.overlayMedia) {
      // ── LE MÉDIA PREND LE CADRE, IL NE SE POSE PAS DEVANT UNE ANIMATION ─────
      // La couche avait été pensée pour « ne pas supprimer le module en dessous ».
      // À l'écran, ça donne des morceaux d'animation qui dépassent de part et
      // d'autre de la photo — Axel, sur la v14 : « y'a une animation juste
      // derrière ici… ». On efface donc ce que l'animation avait dessiné : sa
      // photo EST le visuel de ce moment, rien ne doit la concurrencer.
      // (Les captures d'écran et les scènes UI gardent leur contenu : là, le
      // média est un vrai médaillon posé sur une interface qu'on montre.)
      if (!p.slide.screen && !p.slide.ui && String(p.kind) !== 'ui') {
        inner = ''
        pjs = ''
      }
      const om = p.slide.overlayMedia
      const pos2 = om.pos || { x: 0.5, y: 0.5, w: 0.5 }
      const cw2 = Math.round(W * Math.min(0.92, Math.max(0.18, Number(pos2.w) || 0.5)))
      const ch2 = Math.round(cw2 * 16 / 9)
      const cx2 = Math.round(Math.min(W - cw2, Math.max(0, Number(pos2.x) * W - cw2 / 2)))
      const cy2 = Math.round(Math.min(H - ch2, Math.max(0, Number(pos2.y) * H - ch2 / 2)))
      const vid2 = /\.(mp4|mov|webm|m4v)$/i.test(String(om.src || ''))
      const t0m = r2(Math.max(liveT0, om.start != null ? om.start : liveT0))
      const t1m = r2(Math.min(t1, om.end != null ? om.end : t1))
      const corps2 = vid2
        ? `<video class="clip" src="${esc(om.src)}" data-start="${t0m}" data-duration="${dvid(Math.max(0.4, t1m - t0m))}" data-track-index="11" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`
        : `<img src="${esc(om.src)}" style="width:100%;height:100%;object-fit:cover;display:block"/>`
      inner += `<div class="an-p" id="${id}om" style="left:${cx2}px;top:${cy2}px;width:${cw2}px;height:${ch2}px;border-radius:${Math.round(cw2 * 0.08)}px;overflow:hidden;box-shadow:0 34px 80px -22px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.08);z-index:9">${corps2}</div>`
      pjs += `\n  tl.fromTo('#${id}om',{yPercent:8,scale:0.92,autoAlpha:0},{yPercent:0,scale:1,autoAlpha:1,duration:0.42,ease:'back.out(1.5)',transformOrigin:'50% 50%'},${t0m});`
      if (t1m < t1 - 0.35) pjs += `\n  tl.to('#${id}om',{scale:0.94,autoAlpha:0,duration:0.3,ease:'power2.in',transformOrigin:'50% 50%'},${r2(t1m - 0.3)});`
      // une PHOTO qui se pose fait clic d'obturateur, une vidéo fait pop —
      // le son raconte ce qui vient d'apparaître (Axel 09/08)
      sfxAdd.push({ kind: vid2 ? 'mo-pop-2' : 'camera-shutter', t: r2(t0m + 0.05), vol: 0.5 })
    }
    // ── UNE CAPTURE SOMBRE A BESOIN D'UN FOND CLAIR ────────────────────────
    // Axel, 03/08, trois fois : « y'a des écrans blancs, des écrans noirs, faut
    // régler ça ». Mesuré sur deux de ses montages : 19 % puis 22 % de la vidéo
    // avec un écran quasi noir — et CHAQUE plage correspond à une capture de
    // son app. Mesuré aussi sur les fichiers sources : ses captures d'interface
    // sont sombres à 87-99,8 %, sans un seul pixel clair.
    //
    // Sur un fond sombre, une capture sombre ne se distingue de rien : l'écran
    // paraît vide. Sur un fond clair, la même capture devient un OBJET qu'on
    // regarde — on voit ses bords, on comprend que c'est un écran d'application.
    // C'est déjà le principe retenu pour les médias de l'utilisateur (« toujours
    // posé sur un fond clair »), il manquait aux captures.
    //
    // On n'éclaircit pas la capture — ce serait la trahir. On change ce qu'il y
    // a autour.
    const fondPanneau = p.kind === 'screen' && !isApple(plan) ? '#F2F1EE' : tone.bg
    html += `\n  <div id="${id}" class="pnl" style="z-index:${i + 1};background:${fondPanneau};${i > 0 ? 'opacity:0' : ''}"><div class="pin" id="${id}in">${inner}</div></div>`

    // — poussée : direction alternée, l'entrant arrive légèrement flouté par sa
    //   vitesse et se pose ; whoosh SEULEMENT sur les panneaux illustrés, en
    //   alternant deux échantillons, à volume discret, jamais deux en <2.5s
    if (i > 0) {
      const dir = DIRS[(i - 1) % DIRS.length]
      const from = dir === 'right' ? { x: W } : dir === 'bottom' ? { y: H } : dir === 'top' ? { y: -H } : { x: -W }
      const to = dir === 'right' ? { x: -W } : dir === 'bottom' ? { y: -H } : dir === 'top' ? { y: H } : { x: W }
      js += `
  tl.set('#${id}',{opacity:1},${t0});
  tl.fromTo('#${id}',${JSON.stringify(from)},{x:0,y:0,duration:${PUSH},ease:'power2.inOut'},${t0});
  tl.fromTo('#${id}in',{filter:'blur(7px)'},{filter:'blur(0px)',duration:${r2(PUSH + 0.1)},ease:'power2.out'},${t0});
  tl.to('#pn${i - 1}',{${Object.entries(to).map(([k, v]) => `${k}:${v}`).join(',')},duration:${PUSH},ease:'power2.inOut'},${t0});
  tl.set('#pn${i - 1}',{autoAlpha:0},${r2(t0 + PUSH + 0.04)});`
      // Axel 09/08 : « toujours un bruitage quand on met une photo/une vidéo ou
      // qu'on passe à une autre frame dans la visite guidée » — pour les MÉDIAS
      // et les ÉCRANS du tuto le son est SYSTÉMATIQUE (le TWIN varie
      // l'échantillon si deux poussées se suivent) ; les autres panneaux
      // gardent la retenue des 2,5 s.
      const pousseForte = p.kind === 'media' || p.kind === 'screen'
      if (p.kind !== 'typo' && (pousseForte || t0 - lastWhoosh > 2.5)) {
        sfxAdd.push({ kind: whooshFlip ? 'mo-swipe-2' : 'mo-whoosh-1', t: r2(Math.max(0, t0 - 0.05)), vol: 0.55 })
        lastWhoosh = t0; whooshFlip = !whooshFlip
      }
      if (i === iRiser && p.t0 > 2.5) {
        // culmine sur la coupe hook → contenu (#90) ; la montée occupe la fin du hook
        sfxAdd.push({ kind: 'metallic-riser', t: r2(Math.max(0, p.t0 - 1.45)), vol: 0.5 })
      }
    }
    js += pjs
  })

  // — piste sonore finale : tri, anti-répétition (même son < 2s : on saute),
  //   anti-collision (deux sons < 0.22s : le premier gagne), plafond global
  const lastByKind = {}
  let lastT = -9
  const sfxOut = []
  // un CLIC peut légitimement se répéter vite (deux choix à 1s d'écart) ; c'est
  // le whoosh répété qui lasse — fenêtres anti-répétition par famille
  const minGap = (k) => (k === 'mo-tap-1' ? 0.6 : k === 'mo-swipe-1' ? 0.9 : k === 'mo-whoosh-1' || k === 'mo-swipe-2' ? 2.2 : 2)
  // LE BON SON POUR LA SCÈNE (chaque scène déclare le sien : clic pour un bouton,
  // ding pour un envoi, obturateur pour une photo, tic-tac pour le chrono…) — et
  // si le même son devait rejouer trop vite, on le remplace par son jumeau au
  // lieu de marteler l'identique (retour d'Axel : « varier, pas toujours le même »)
  // fenêtre d'ÉCHANGE (2.4s) : le même son qui reviendrait vite devient son jumeau,
  // puis le jumeau du jumeau — quatre clics de suite deviennent clic/click/obturateur.
  // fenêtre de COUPE (minGap) : en dessous, on saute carrément.
  const TWIN = { 'mo-tap-1':'mo-pop-3', 'mo-pop-3':'mo-tick-1', 'mo-tick-1':'mo-tap-1', 'mo-pop-1':'mo-pop-2', 'mo-pop-2':'mo-pop-1', 'mo-impact-1':'mo-impact-2', 'mo-impact-2':'mo-impact-3', 'mo-whoosh-1':'mo-swipe-2', 'mo-swipe-2':'mo-swipe-1', 'mo-swipe-1':'mo-whoosh-1', 'camera-shutter':'camera-click', 'camera-click':'mo-pop-2' }
  for (const s of sfxAdd.sort((a, b) => a.t - b.t)) {
    for (let k = 0; k < 2 && lastByKind[s.kind] != null && s.t - lastByKind[s.kind] < 2.4 && TWIN[s.kind]; k++) s.kind = TWIN[s.kind]
    if (lastByKind[s.kind] != null && s.t - lastByKind[s.kind] < minGap(s.kind)) continue
    if (s.t - lastT < 0.2) continue
    lastByKind[s.kind] = s.t; lastT = s.t
    sfxOut.push(s)
    if (sfxOut.length >= 34) break
  }
  plan.sfx = sfxOut
  if (kbAdd.length) plan.keyboard = [...(plan.keyboard || []), ...kbAdd]

  // ── LES SOUS-TITRES ─────────────────────────────────────────────────────────
  // Ce style n'en affichait aucun : les panneaux PORTENT le texte, donc doubler
  // la voix aurait fait deux lectures concurrentes. Mais sur les réseaux la
  // majorité regarde sans le son, et une capture d'interface ne remplace pas la
  // phrase. On les pose donc en bas, DANS LA ZONE SÛRE (au-dessus du bandeau
  // TikTok/Reels), par groupes de trois mots — assez gros pour se lire d'un
  // coup d'œil sur un téléphone, avec le mot prononcé en accent.
  // Ils s'effacent quand un panneau écrit déjà le mot à l'écran : deux fois la
  // même chose au même instant, c'est du bruit.
  let capHtml = ''
  if (plan.captions && plan.captions.length && plan.subtitles !== false) {
    const mots = plan.captions.filter((c) => String(c.text || '').trim())
      .map((c) => ({ text: String(c.text).trim(), start: r2(c.start), end: r2(Math.max(c.start + 0.12, c.end)) }))
      .sort((a, b) => a.start - b.start)
    // groupes de 3 mots, coupés sur la ponctuation : on lit une respiration.
    // SUR LE HOOK (Axel 09/08, choix du style 5) : des PHRASES — « c'est
    // littéralement une dinguerie » affichée en entier, puis « avatarads
    // connecté à claude » sur sa propre frame. Jusqu'à 4 mots, et seule une
    // vraie fin de phrase (.!? ou une pause) coupe — pas la virgule.
    const hookPre = r2(plan.hook?.end ?? Math.min(4, D))
    const grp = []
    for (const w of mots) {
      const g = grp[grp.length - 1]
      const dansHook = w.start < hookPre
      const dernier = g && g.mots[g.mots.length - 1]
      const coupe = !g || g.mots.length >= (dansHook ? 4 : 3)
        || (dernier && (dansHook ? /[.!?]$/ : /[.!?,]$/).test(dernier.text))
        || (dernier && w.start - dernier.end > 0.45)
      if (coupe) grp.push({ mots: [w] })
      else g.mots.push(w)
    }
    const fs = Math.round(H * 0.036)
    const bas = Math.round(H * (1 - SAFE.bottom) - fs * 2.1)
    const encre = '#FFFFFF'                       // sur pastille sombre, toujours blanc
    // DEUX GROUPES NE SE CHEVAUCHENT JAMAIS. Avec une marge avant ET après, deux
    // blocs restaient affichés en même temps et les phrases se superposaient,
    // illisibles (« que|ton|audio »). Chaque groupe s'arrête où le suivant
    // commence.
    grp.forEach((g, i) => {
      g.a = r2(Math.max(i ? grp[i - 1].b + 0.01 : 0, g.mots[0].start - 0.08))
      const suiv = grp[i + 1]
      g.b = r2(Math.min(D, g.mots[g.mots.length - 1].end + 0.16,
        suiv ? suiv.mots[0].start - 0.04 : D))
    })
    // ── QUAND LA SOURCE PORTE DÉJÀ SES SOUS-TITRES ──────────────────────────
    // `subsSurPanneaux` vient d'orchestrate : la vidéo d'origine a des
    // sous-titres incrustés. On ne double donc PAS ceux qu'on voit déjà — mais
    // sur les scènes où un panneau couvre l'image, les siens ont disparu avec
    // elle, et c'est là qu'il faut prendre le relais. On ne garde que ces
    // groupes-là ; sur le visage, sa propre incrustation suffit.
    const surPanneauSeulement = plan.subsSurPanneaux === true
    if (surPanneauSeulement) {
      const avant = grp.length
      for (let i = grp.length - 1; i >= 0; i--) {
        const mid = (grp[i].a + grp[i].b) / 2
        // ⚠ `find` retournait le PREMIER panneau couvrant l'instant. Or la
        // fenêtre visage d'Axel s'étend sur toute la vidéo (0 → 19,55 s) : son
        // panneau gagnait toujours, même quand une animation jouait par-dessus,
        // et le filtre concluait « on voit sa vidéo » partout. Résultat : plus
        // aucun sous-titre, y compris sous le compteur — son « gros blanc » de
        // 13 à 16 s.
        // La bonne question n'est pas « quel panneau vient en premier » mais
        // « EST-CE QU'UN panneau couvre l'image à cet instant ». D'où le some().
        const couvre = panels.some((p) => mid >= p.t0 && mid < p.t1
          && p.kind !== 'avclip' && p.kind !== 'media')
        if (!couvre) grp.splice(i, 1)
      }
      console.log(`▶ sous-titres déjà incrustés dans la source : ${grp.length}/${avant} groupes gardés (uniquement sous les panneaux)`)
    }
    // LE HOOK A SES SOUS-TITRES À LUI (réf @tians028, Axel 09/08) : « un
    // montage de sous-titres qui attire vraiment l'œil dès le début ». Sur
    // l'accroche, la pastille disparaît : texte NU, énorme, en capitales, avec
    // un halo — posé au tiers bas, sur le visage plein cadre.
    const hookFin = r2(plan.hook?.end ?? Math.min(4, D))
    const hautHook = Math.round(H * 0.60)
    // 5 palettes de sous-titres hook — `plan.hookStyle` 1..5. hk1 (or + rouge,
    // la réf validée) est le défaut ; hk2..hk5 sont les variantes couleur.
    const hs = Math.min(15, Math.max(1, Number(plan.hookStyle) || 15))
    // les mots que l'orchestrateur a marqués comme FORTS prennent la couleur
    // (rouge dégradé réf) — « essaye de mettre de la couleur » sur le style 5
    const normAcc = (t) => String(t).toLowerCase().replace(/[.,!?;:«»()"']/g, '')
    const ACCFORTS = new Set((plan.accents || []).map(normAcc))
    // ── SOUS-TITRES HOOK UNIQUEMENT (Axel 12/08 : « garde ceux du hook juste ») ──
    // Opt-in via `plan.subtitlesHookOnly` (marqueur [SUBSHOOK] du brief, posé par le
    // MCP). On ne garde que les groupes dont le début tombe DANS le hook ; après le
    // hook, plus de bandeau — la vidéo se lit par les visuels (panneaux, médias,
    // captures). Filtré ici, avant de générer HTML + timeline, pour ne rien animer
    // qu'on n'affiche pas.
    if (plan.subtitlesHookOnly === true) {
      const avant = grp.length
      for (let i = grp.length - 1; i >= 0; i--) { if (grp[i].a >= hookFin) grp.splice(i, 1) }
      console.log(`▶ sous-titres hook uniquement : ${grp.length}/${avant} groupe(s) gardé(s)`)
    }
    capHtml = grp.map((g, i) => {
      const a = g.a
      const b = Math.max(a + 0.2, g.b)
      g.hook = a < hookFin
      // « c'est tout le temps les mêmes sous-titres » (Axel, 31/07) : en apple,
      // la pastille S'ADAPTE au panneau qu'elle survole — claire sur les
      // panneaux clairs (animations, cartes, captures), sombre sur le visage
      // et les médias plein cadre. Le style respire au rythme des plans.
      const mid = (a + b) / 2
      const pan = panels.find((p) => mid >= p.t0 && mid < p.t1)
      g.sombre = !ap || !pan || pan.kind === 'avclip'
      const dedans = g.mots.map((w, k) =>
        `<span class="dc-w${g.hook && ACCFORTS.has(normAcc(w.text)) ? ' acc' : ''}" data-t="${r2(w.start)}">${esc(w.text)}</span>`).join(' ')
      return `<div class="clip dyncap" id="dc${i}" data-start="${a}" data-duration="${r2(Math.max(0.2, b - a))}" data-track-index="14"
        style="top:${g.hook ? hautHook : bas}px"><span class="dc-p${g.hook ? ` dc-hook hk${hs}` : (g.sombre ? '' : ' dc-clair')}" id="dp${i}">${dedans}</span></div>`
    }).join('\n')
    // le mot en cours passe en accent — écrit image par image, pas d'onUpdate
    for (const [i, g] of grp.entries()) {
      const a = g.a
      if (g.hook) {
        // RÉF @tians028 : chaque mot CLAQUE à l'instant où il est prononcé et
        // s'empile (accumulation). Le mot en cours porte la classe `on`, les
        // mots passés la perdent — les couleurs/dégradés vivent dans le CSS des
        // styles hk1..hk5 (un dégradé ne se tweene pas, une classe se pose).
        const base = (k) => `dc-w${ACCFORTS.has(normAcc(g.mots[k].text)) ? ' acc' : ''}`
        g.mots.forEach((w, k) => {
          const sel = `'#dc${i} .dc-w:nth-child(${k + 1})'`
          js += `\n  tl.fromTo(${sel},{autoAlpha:0,scale:1.4},{autoAlpha:1,scale:1,duration:0.14,ease:'back.out(2.4)',transformOrigin:'50% 80%'},${r2(w.start)});`
          js += `\n  tl.set(${sel},{attr:{class:'${base(k)} on'}},${r2(w.start)});`
          // Le mot fort s'allume en rouge flou 0,16 s après son apparition (à peine
          // un flash blanc, PAS de délai qui attend la fin du mot / le mot suivant —
          // Axel : « pas le petit temps avant que la bordure rouge apparaisse »).
          const finMot = r2(w.start + 0.06)
          js += `\n  tl.set(${sel},{attr:{class:'${base(k)}'}},${finMot});`
        })
        continue
      }
      const enc = g.sombre ? encre : '#17171C'
      const accW = g.sombre ? '#FF8A5B' : '#E8500A'
      g.mots.forEach((w, k) => {
        js += `\n  tl.set('#dc${i} .dc-w:nth-child(${k + 1})', { color: '${accW}' }, ${r2(w.start)});`
        if (k) js += `\n  tl.set('#dc${i} .dc-w:nth-child(${k})', { color: '${enc}' }, ${r2(w.start)});`
      })
      js += `\n  tl.fromTo('#dp${i}', { autoAlpha: 0, y: 12, scale: 0.94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.2, ease: 'back.out(2)', transformOrigin: '50% 100%' }, ${a});`
    }
    console.log(`▶ sous-titres : ${grp.length} groupes de mots`)
  }

  // ── LE TITRE DU HOOK, AU-DESSUS DE LA TÊTE (réf makeugc_ai, Axel 13/08) ─────
  // « dans le hook, au-dessus de la tête de l'avatar, une phrase type qui
  // représente ce que dit l'audio » — comme « How to copy winning ads (using
  // AI) ». plan.hook.text EST cette phrase (le chef d'orchestre l'écrit depuis
  // l'audio) : on la pose en haut du cadre, blanc massif + ombre portée, pendant
  // toute l'accroche. Track 15 : au-dessus des sous-titres du hook (posés à 60 %),
  // les deux coexistent comme dans la réf (titre en haut, mots animés plus bas).
  let hookTitleHtml = ''
  {
    const tTitre = String((plan.hook && plan.hook.text) || '').trim()
    const finH = r2((plan.hook && plan.hook.end) || 0)
    if (tTitre && finH >= 1) {
      // ⚠ CONTRAT HYPERFRAMES : « the framework alone controls .clip visibility »
      // — un tween autoAlpha sur la RACINE .clip se bat avec le framework et le
      // titre n'apparaît jamais (mesuré sur v7 : construit, logué, invisible).
      // Comme les sous-titres (#dp intérieurs), on anime le WRAPPER intérieur.
      hookTitleHtml = `<div class="clip" id="hkTitle" data-start="0" data-duration="${finH}" data-track-index="15"><span id="hkTitleIn" style="display:block">${esc(tTitre)}</span></div>`
      js += `\n  tl.fromTo('#hkTitleIn',{autoAlpha:0,scale:1.16,y:-12},{autoAlpha:1,scale:1,y:0,duration:0.3,ease:'back.out(1.9)',transformOrigin:'50% 0%'},0.06);`
      console.log(`▶ titre du hook : « ${tTitre} » (0→${finH}s)`)
    }
  }

  // ── LA VIDÉO EN SOUS-COUCHE : PLUS JAMAIS D'APLAT ────────────────────────
  // Axel, 03/08 : « on met une sous-couche qui est la vidéo originale pour
  // éviter les blancs, sauf si le blanc est fait exprès pour une transition ».
  //
  // Vérifié : la vidéo n'apparaissait QUE dans des panneaux — fenêtres avatar,
  // médias. Tout instant qu'aucun panneau ne couvrait montrait l'aplat de fond
  // du <body>. La dérivation comble bien les trous (§3b-bis rend au visage, §3c
  // étire les voisines), mais elle y arrive par des règles : il suffit qu'une
  // d'elles échoue pour qu'un aplat traverse la vidéo finale.
  //
  // Une sous-couche permanente change la nature du problème : ce n'est plus une
  // règle de plus à faire tenir, c'est un filet. Ce qui n'est couvert par rien
  // montre sa vidéo, à sa seconde, en mouvement. Les panneaux ont leur propre
  // fond et la recouvrent exactement comme avant — rien d'existant ne change.
  //
  // track-index 0 : la couche la plus basse. Muette, puisque la voix vient du
  // mixage audio final. Absente si le job n'a pas de base filmée (montage à
  // partir d'un MP3 : le worker fabrique alors un fond noir, inutile à empiler).
  // Un clip par trou, pré-découpé au bon timecode par le worker — donc chacun
  // joue depuis son propre début, sans décalage à gérer ici. Couche 0 : sous
  // tout le reste. Muets : la voix vient du mixage audio final.
  // ── LES TROUS SE MESURENT SUR CE QUI EST POSÉ, PAS SUR CE QUI EST PROPOSÉ ──
  // Axel, 03/08 : « y'a des blancs partout ». Ma première version calculait la
  // couverture côté worker, sur `plan.slides` — les scènes PROPOSÉES par le chef
  // d'orchestre. Or la dérivation en rejette la moitié : sur son montage,
  // « 9/18 des scènes dans la vidéo ». Le calcul voyait donc une vidéo pleine
  // là où le rendu avait neuf trous, et concluait « rien à combler ».
  // Seul cet endroit-ci connaît la vérité : `panels` est la liste de ce qui sera
  // RÉELLEMENT à l'écran. On la publie pour que le worker découpe les bons
  // intervalles, en deux passes — une pour mesurer, une pour rendre.
  if (Array.isArray(opts.trous)) {
    const couvert = panels
      .filter((p) => p && typeof p.t0 === 'number' && p.t1 > p.t0)
      .map((p) => [Math.max(0, p.t0), Math.min(D, p.t1)])
      .sort((a, b) => a[0] - b[0])
    const fusion = []
    for (const [a, b] of couvert) {
      const last = fusion[fusion.length - 1]
      if (last && a <= last[1] + 0.04) last[1] = Math.max(last[1], b)
      else fusion.push([a, b])
    }
    let t = 0
    for (const [a, b] of fusion) { if (a - t > 0.25) opts.trous.push([r2(t), r2(a)]); t = Math.max(t, b) }
    if (D - t > 0.25) opts.trous.push([r2(t), r2(D)])
  }

  const sousCouche = (opts.fonds || [])
    .map((f) => `<video class="clip" src="${esc(f.src)}" data-start="${r2(f.start)}" data-duration="${r2((f.end ?? f.start) - f.start)}" data-track-index="0" muted playsinline style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover"></video>`)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  /* Sans ces @font-face, 'Inter' et 'Archivo Black' retombaient sur Liberation
     Sans (conteneur) / Helvetica (Mac) : le moteur dynamique n'injectait pas les
     polices embarquées que les autres styles chargent déjà. Les sous-titres du
     hook n'avaient jamais leur vraie graisse. */
  ${fontFaceCss()}
  body { margin:0; width:${W}px; height:${H}px; overflow:hidden; background:${ap ? AP_A.bg : DARK.bg}; font-family:'Inter',sans-serif; }
  .pnl { position:absolute; top:0; left:0; width:${W}px; height:${H}px; overflow:hidden; }
  ${animCss(W, H)}
  .pin { position:absolute; inset:0; }
  /* le mot affiché : Archivo Black tape fort, c'est l'identité du dynamique.
     Apple n'écrit jamais aussi gras — SF Pro Display, donc Inter 800 très serré. */
  .disp { font-family:${ap ? `'Inter',sans-serif; font-weight:800; letter-spacing:-.035em`
    : `'Archivo Black',sans-serif; letter-spacing:-.01em`}; }
  .stack { position:absolute; left:0; right:0; top:0; bottom:0; display:flex; flex-direction:column;
           justify-content:center; align-items:center; gap:34px; padding:0 70px; box-sizing:border-box; }
  /* SOUS-TITRES — une PASTILLE sombre, texte blanc, mot en cours en accent.
     Le halo seul manquait de tenue : sur un fond clair il bavait, sur une photo
     il se noyait. Une pastille pleine se pose sur n'importe quel arrière-plan,
     assume sa présence, et laisse le mot prononcé ressortir vraiment. */
  .dyncap { position:absolute; left:0; width:${W}px; text-align:center;
    z-index:60; pointer-events:none; }
  .dc-p { display:inline-block; max-width:${Math.round(W * 0.84)}px;
    padding:${Math.round(H * 0.014)}px ${Math.round(H * 0.024)}px ${Math.round(H * 0.017)}px;
    border-radius:${Math.round(H * 0.019)}px;
    background:rgba(16,16,20,.9); box-shadow:0 ${Math.round(H * 0.008)}px ${Math.round(H * 0.026)}px rgba(0,0,0,.3);
    font-family:'Inter',sans-serif; font-weight:800; letter-spacing:-.022em;
    font-size:${Math.round(H * 0.036)}px; line-height:1.24; color:#FFFFFF;
    text-wrap:balance; }
  /* apple : sur un panneau CLAIR, la pastille s'inverse — blanche, texte encre,
     comme une bulle iOS. La sombre reste pour le visage et les médias. */
  .dc-clair { background:rgba(255,255,255,.94); color:#17171C;
    box-shadow:0 ${Math.round(H * 0.006)}px ${Math.round(H * 0.022)}px rgba(20,20,28,.16); }
  /* HOOK (réf @tians028, crop d'Axel : « NEVER POST / CONTENT AGAIN ») : Anton
     embarquée, capitales condensées, lignes SERRÉES, PAS de contour — la réf
     n'en a pas : des DÉGRADÉS verticaux et une ombre douce. Le mot en cours
     porte la classe « on » (posée par GSAP mot à mot), le style hk1..hk5
     décide des couleurs. */
  .dc-hook { background:transparent; box-shadow:none;
    font-family:'Anton','Archivo Black',sans-serif; font-weight:400;
    font-size:${Math.round(H * 0.058)}px; text-transform:uppercase;
    letter-spacing:.012em; line-height:0.97; max-width:${Math.round(W * 0.84)}px; }
  /* chaque mot du hook naît invisible : GSAP le fait claquer à SON instant */
  .dc-hook .dc-w { opacity:0; padding:0 ${Math.round(W * 0.003)}px; }
  /* 5 PALETTES (Axel 09/08 : « fais 5 hooks avec différentes couleurs, je te dis
     lequel je préfère »). MÊME mise en page validée — phrases entières, mot
     prononcé qui FLASHE en blanc, mots FORTS (.acc, placés APRÈS .on pour qu'ils
     restent colorés dès l'apparition). Seule la couleur change d'un style à
     l'autre. Une ombre portée garde le texte lisible sur fond clair. */
  ${(() => {
    const s = Math.round(H * 0.0035), m = Math.round(H * 0.007), g = Math.round(H * 0.009)
    const ombre = `drop-shadow(0 ${s}px ${m}px rgba(0,0,0,.6))`
    const clip = '-webkit-background-clip:text; background-clip:text; color:transparent;'
    // {n, base, acc, glow} — base = dégradé des mots posés, acc = mot fort, glow = teinte du flash blanc
    // Axel a gardé la couleur OR + ROUGE (hk1) mais veut voir 5 TRAITEMENTS de
    // dégradé différents dessus. Même identité colorée partout, seule la façon
    // dont le dégradé se pose change (classique, métal brossé, bi-ton franc,
    // glossy à reflet blanc, profond premium). glow chaud commun.
    const P = [
      { n: 1, nom: 'CLASSIQUE', base: '#FFEFAE 6%,#F6CE67 46%,#E5A233 94%', acc: '#FF6A57 6%,#EF2A1D 48%,#9E120B 94%', glow: '255,220,140' },
      { n: 2, nom: 'MÉTAL',     base: '#FFF6D8 0%,#F3CE73 34%,#FFFFFF 50%,#E7AC3B 64%,#B2720F 100%', acc: '#FF9A7A 0%,#F0463A 40%,#FFE0D6 51%,#C6180F 64%,#750B05 100%', glow: '255,220,140' },
      { n: 3, nom: 'BI-TON',    base: '#FFDC6E 0%,#FFDC6E 49%,#E4881C 51%,#E4881C 100%', acc: '#FF5A45 0%,#FF5A45 49%,#AE1008 51%,#AE1008 100%', glow: '255,220,140' },
      { n: 4, nom: 'GLOSSY',    base: '#FFFFFF 0%,#FFE79A 28%,#F1BF49 60%,#CE8A20 100%', acc: '#FFE7E0 0%,#FF6A54 30%,#E42417 62%,#8A0B06 100%', glow: '255,225,150' },
      { n: 5, nom: 'PROFOND',   base: '#F7DA86 0%,#E4A93A 46%,#A96E17 100%', acc: '#F1503C 0%,#BE160E 50%,#640904 100%', glow: '255,215,130' },
    ]
    return P.map((p) => `/* hk${p.n} — ${p.nom} */
  .hk${p.n} .dc-w { background:linear-gradient(180deg,${p.base}); ${clip} filter:${ombre}; }
  .hk${p.n} .dc-w.on { background:none; color:#FFFFFF;
    text-shadow:0 0 ${Math.round(H * 0.011)}px rgba(${p.glow},.9), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.011)}px rgba(0,0,0,.7); filter:none; }
  .hk${p.n} .dc-w.acc { background:linear-gradient(180deg,${p.acc}); ${clip} text-shadow:none;
    filter:drop-shadow(0 0 ${g}px rgba(${p.glow},.55)) drop-shadow(0 ${s}px ${m}px rgba(0,0,0,.55)); }`).join('\n  ')
  })()}
  /* hk6 — NÉON ARRONDI (réf Axel : « COMMENT TE LANCER AUJOURD'HUI ») : police
     bulle Baloo 2, remplissage rose clair, halo NÉON rouge, trait rouge dessous.
     Pas de dégradé — un vrai panneau lumineux. Monochrome comme la réf : le mot
     prononcé passe en blanc pur (le néon s'intensifie), sans accent séparé. */
  .dc-hook.hk6 { font-family:'Baloo 2','Anton',sans-serif; letter-spacing:.004em;
    border-bottom:${Math.max(2, Math.round(H * 0.0045))}px solid rgba(255,60,60,.9);
    padding-bottom:${Math.round(H * 0.008)}px; }
  .hk6 .dc-w, .hk6 .dc-w.acc { color:#FFCED2;
    -webkit-text-stroke:${Math.max(1, Math.round(H * 0.0012))}px rgba(150,12,12,.6);
    text-shadow:0 0 ${Math.round(H * 0.004)}px #FF5555, 0 0 ${Math.round(H * 0.012)}px #FF2323,
      0 0 ${Math.round(H * 0.023)}px #E31616, 0 0 ${Math.round(H * 0.04)}px #B00000; }
  .hk6 .dc-w.on { color:#FFFFFF; -webkit-text-stroke:0;
    text-shadow:0 0 ${Math.round(H * 0.005)}px #FFFFFF, 0 0 ${Math.round(H * 0.014)}px #FF6A6A,
      0 0 ${Math.round(H * 0.027)}px #FF2323, 0 0 ${Math.round(H * 0.046)}px #C40000; }
  /* hk7 — MONTSERRAT noir, blanc à gros contour noir, mot fort + prononcé JAUNE
     (le classique viral CapCut : lisible sur n'importe quel fond) */
  .dc-hook.hk7 { font-family:'Montserrat','Anton',sans-serif; font-weight:900; letter-spacing:-.012em; }
  .hk7 .dc-w { color:#FFFFFF; -webkit-text-stroke:${Math.max(4, Math.round(H * 0.0058))}px #0E0E0E;
    paint-order:stroke fill; text-shadow:0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.01)}px rgba(0,0,0,.55); }
  .hk7 .dc-w.acc { color:#FFD400; }
  .hk7 .dc-w.on { color:#FFD400; text-shadow:0 0 ${Math.round(H * 0.012)}px rgba(255,205,0,.7); }
  /* hk8 — BEBAS NEUE grand condensé, blanc, mot fort en CYAN→bleu */
  .dc-hook.hk8 { font-family:'Bebas Neue',sans-serif; font-weight:400; letter-spacing:.03em;
    font-size:${Math.round(H * 0.07)}px; }
  .hk8 .dc-w { color:#FFFFFF; text-shadow:0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.013)}px rgba(0,0,0,.75); }
  .hk8 .dc-w.acc { background:linear-gradient(180deg,#8FF0FF 6%,#39B7FF 50%,#1470E6 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent; text-shadow:none;
    filter:drop-shadow(0 ${Math.round(H * 0.003)}px ${Math.round(H * 0.008)}px rgba(0,0,0,.5)); }
  .hk8 .dc-w.on { color:#FFFFFF; text-shadow:0 0 ${Math.round(H * 0.012)}px rgba(120,220,255,.85), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.011)}px rgba(0,0,0,.6); }
  /* hk9 — POPPINS gras, blanc, mot fort en MAGENTA→violet */
  .dc-hook.hk9 { font-family:'Poppins','Anton',sans-serif; font-weight:800; letter-spacing:-.015em; }
  .hk9 .dc-w { color:#FFFFFF; text-shadow:0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.013)}px rgba(0,0,0,.7); }
  .hk9 .dc-w.acc { background:linear-gradient(180deg,#FFA8F0 6%,#E84DD6 48%,#8A2BE2 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent; text-shadow:none;
    filter:drop-shadow(0 ${Math.round(H * 0.003)}px ${Math.round(H * 0.008)}px rgba(0,0,0,.5)); }
  .hk9 .dc-w.on { color:#FFFFFF; text-shadow:0 0 ${Math.round(H * 0.012)}px rgba(240,150,255,.85), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.011)}px rgba(0,0,0,.6); }
  /* hk10 — MONTSERRAT noir, dégradé VERT→teal, mot fort en BLANC */
  .dc-hook.hk10 { font-family:'Montserrat','Anton',sans-serif; font-weight:900; letter-spacing:-.012em; }
  .hk10 .dc-w { background:linear-gradient(180deg,#B9FFD9 6%,#37E39B 50%,#0DA271 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 ${Math.round(H * 0.0035)}px ${Math.round(H * 0.008)}px rgba(0,0,0,.6)); }
  .hk10 .dc-w.acc, .hk10 .dc-w.on { background:none; color:#FFFFFF;
    text-shadow:0 0 ${Math.round(H * 0.011)}px rgba(180,255,220,.85), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.011)}px rgba(0,0,0,.7); filter:none; }
  /* hk11-13 — POPPINS EN COULEUR (Axel aime la police Poppins mais la veut
     colorée). Dégradé de base coloré + mot fort contrasté + flash blanc. */
  .dc-hook.hk11, .dc-hook.hk12, .dc-hook.hk13 { font-family:'Poppins','Anton',sans-serif; font-weight:800; letter-spacing:-.015em; }
  /* hk11 — violet→rose, accent JAUNE */
  .hk11 .dc-w { background:linear-gradient(180deg,#DBAcFF 6%,#B15CFF 48%,#E13CC0 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 ${Math.round(H * 0.0035)}px ${Math.round(H * 0.007)}px rgba(0,0,0,.6)); }
  .hk11 .dc-w.acc { background:linear-gradient(180deg,#FFF0A8 6%,#FFD23A 50%,#F5A800 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 0 ${Math.round(H * 0.008)}px rgba(255,210,60,.55)) drop-shadow(0 ${Math.round(H * 0.0035)}px ${Math.round(H * 0.007)}px rgba(0,0,0,.5)); }
  .hk11 .dc-w.on { background:none; color:#FFFFFF;
    text-shadow:0 0 ${Math.round(H * 0.011)}px rgba(235,185,255,.9), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.011)}px rgba(0,0,0,.6); filter:none; }
  /* hk12 — bleu→cyan, accent ORANGE */
  .hk12 .dc-w { background:linear-gradient(180deg,#A8E9FF 6%,#3FA9FF 48%,#2C63F0 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 ${Math.round(H * 0.0035)}px ${Math.round(H * 0.007)}px rgba(0,0,0,.6)); }
  .hk12 .dc-w.acc { background:linear-gradient(180deg,#FFD8A8 6%,#FF9A3A 50%,#F5600F 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 0 ${Math.round(H * 0.008)}px rgba(255,150,60,.55)) drop-shadow(0 ${Math.round(H * 0.0035)}px ${Math.round(H * 0.007)}px rgba(0,0,0,.5)); }
  .hk12 .dc-w.on { background:none; color:#FFFFFF;
    text-shadow:0 0 ${Math.round(H * 0.011)}px rgba(150,220,255,.9), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.011)}px rgba(0,0,0,.6); filter:none; }
  /* hk13 — rose→orange (sunset), accent CYAN */
  .hk13 .dc-w { background:linear-gradient(180deg,#FFC4E0 6%,#FF6EA8 46%,#FF7A3C 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 ${Math.round(H * 0.0035)}px ${Math.round(H * 0.007)}px rgba(0,0,0,.6)); }
  .hk13 .dc-w.acc { background:linear-gradient(180deg,#C8FBFF 6%,#4EE0F0 50%,#12A6C8 96%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 0 ${Math.round(H * 0.008)}px rgba(90,225,240,.55)) drop-shadow(0 ${Math.round(H * 0.0035)}px ${Math.round(H * 0.007)}px rgba(0,0,0,.5)); }
  .hk13 .dc-w.on { background:none; color:#FFFFFF;
    text-shadow:0 0 ${Math.round(H * 0.011)}px rgba(255,190,220,.9), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.011)}px rgba(0,0,0,.6); filter:none; }
  /* hk14 — BLANC + ROUGE (Axel : « 2 couleurs max, pro, blanc par défaut, rouge
     différenciant »). Anton, base blanche à ombre nette, mots FORTS (.acc) en
     rouge plein, mot prononcé qui garde le blanc mais s'épaissit d'une lueur. */
  .hk14 .dc-w { color:#FFFFFF;
    text-shadow:0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.013)}px rgba(0,0,0,.72), 0 0 ${Math.round(H * 0.004)}px rgba(0,0,0,.5); }
  .hk14 .dc-w.acc { color:#FF2E36;
    text-shadow:0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.013)}px rgba(0,0,0,.6), 0 0 ${Math.round(H * 0.012)}px rgba(255,46,54,.5); }
  .hk14 .dc-w.on { color:#FFFFFF;
    text-shadow:0 0 ${Math.round(H * 0.012)}px rgba(255,255,255,.75), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.013)}px rgba(0,0,0,.7); }
  /* hk15 — le mot fort s'allume en NÉON ROUGE FLOU DÈS QU'IL EST DIT (Axel : « le
     flou après, pas de délai »). Ordre base→acc→on : pendant qu'il est dit le mot
     porte .on (dernier) → BLANC ; à sa fin il retombe sur .acc → clair + halo rouge
     flou (immédiat, pas au mot suivant). Pas de fond, pas de noir. */
  .hk15 .dc-w { color:#FFFFFF;
    text-shadow:0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.012)}px rgba(0,0,0,.5); }
  .hk15 .dc-w.acc { color:#FFFFFF;
    text-shadow:0 0 ${Math.round(H * 0.009)}px rgba(255,40,60,1), 0 0 ${Math.round(H * 0.024)}px rgba(255,16,44,1), 0 0 ${Math.round(H * 0.05)}px rgba(235,0,40,.9), 0 0 ${Math.round(H * 0.09)}px rgba(210,0,38,.62), 0 0 ${Math.round(H * 0.13)}px rgba(185,0,34,.4); }
  .hk15 .dc-w.on { color:#FFFFFF;
    text-shadow:0 0 ${Math.round(H * 0.012)}px rgba(255,255,255,.85), 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.012)}px rgba(0,0,0,.5); }
  .dc-w { display:inline-block; }
  /* titre du hook — blanc massif au-dessus de la tête, ombre franche (réf
     makeugc_ai). Pas de transform en CSS : GSAP anime scale/y et l'écraserait. */
  /* z-index 70 OBLIGATOIRE : les panneaux portent z-index:i+1 et les sous-titres
     z-index:60 — l'ordre DOM ne suffit pas, un élément sans z-index peint SOUS
     tout panneau (le titre de v8 était construit mais invisible, 2e leçon après
     le tween-racine de v7 : « layering = CSS z-index, pas track-index »). */
  #hkTitle { position:absolute; z-index:70; left:${Math.round(W * 0.05)}px; width:${Math.round(W * 0.9)}px; top:${Math.round(H * 0.082)}px;
    font-family:'Archivo Black',sans-serif; font-size:${Math.round(H * 0.037)}px; line-height:1.18; text-align:center;
    color:#FFFFFF; letter-spacing:-.01em;
    text-shadow:0 ${Math.round(H * 0.0023)}px ${Math.round(H * 0.009)}px rgba(0,0,0,.92), 0 ${Math.round(H * 0.006)}px ${Math.round(H * 0.018)}px rgba(0,0,0,.6); }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-width="${W}" data-height="${H}" data-start="0" data-duration="${D}">${sousCouche}${html}
${capHtml}
${hookTitleHtml}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${js}
window.__timelines['main'] = tl;
</script>
</body>
</html>`
}
