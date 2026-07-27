// ─────────────────────────────────────────────────────────────────────────────
// LES CORRECTIONS DU STYLE DYNAMIQUE, PORTÉES AUX STYLES CLASSIQUES
// (apple, editorial, glass, word).
//
// Tout le travail de #146/#147 vivait derrière `slideStyle === 'dynamic'` :
// la carte des éléments d'interface, la règle « le mot affiché est le mot
// prononcé », l'ancrage des animations sur le mot qui les justifie. Les autres
// styles n'en voyaient rien — ils reproduisaient donc exactement les défauts
// qu'Axel avait fait corriger (cadre orange au milieu du vide, « SIGNENT »
// affiché pendant « …maîtrisent le réalisme », animations sans rapport).
//
// ⚠️ CE N'EST PAS UN PORTAGE DU MOTEUR. Le style Dynamique pousse des panneaux
// plein écran avec curseur et clics — c'est SON identité. Ici on ne touche qu'à
// la DONNÉE : quel visuel, à quel instant, cadré sur quoi. Le rendu classique
// (écran incliné, cadre, travelling caméra, texte tapé) existe déjà dans
// anim-pack.mjs `case 'screen'` — il ne recevait simplement jamais les
// coordonnées. On les lui donne.
// ─────────────────────────────────────────────────────────────────────────────

import { norm, findSeq, findAny, LEAD, MODULES, STEP_WORDS, GEN_OBJ, PROMPT_SAMPLE, VOICE_ANIMS } from './dynamic-derive.mjs'
import { spotOf } from './screen-spots.mjs'
import { ANIMS } from './anim-pack.mjs'

const r2 = (n) => Math.round(n * 100) / 100

export function deriveClassicSlides(plan) {
  if (!plan || plan.slideStyle === 'dynamic') return          // le dynamique a sa propre dérivation
  const words = (plan.captions || [])
    .filter((c) => String(c.text || '').trim())
    .map((c) => ({ text: String(c.text).trim(), start: r2(c.start), end: r2(c.end) }))
    .sort((a, b) => a.start - b.start)
  if (!words.length || !(plan.slides || []).length) return

  const slides = plan.slides
  const D = r2(plan.duration || (words[words.length - 1].end + 0.5))
  // mots prononcés dans une fenêtre (avec la même anticipation que le dynamique :
  // un visuel arrive juste AVANT son mot)
  const inWin = (a, b) => words.filter((w) => w.start >= a - LEAD - 0.3 && w.start <= b + 0.2)

  // ── 1 · FILET DE SÉCURITÉ SUR LE CADRAGE DES CAPTURES ──────────────────────
  // ⚠️ L'orchestrateur résout DÉJÀ ces coordonnées pour le chemin classique, et
  // bien : vérifié sur Cartoon 15, ses cadres tombent à 0,01 près sur ceux que
  // j'ai mesurés à la main dans screen-spots.mjs (format 9:16 : lui 0.288/0.666,
  // la carte 0.288/0.668). Ce bloc ne sert donc QUE de repli — quand un plan
  // arrive sans cadre, on le calcule depuis la carte plutôt que de laisser
  // boxW à 0 (aucun cadre dessiné, caméra plantée au centre).
  // C'est le style Dynamique qui, lui, ignore ces coordonnées serveur et
  // reconstruit tout depuis la carte : d'où son besoin de screen-spots.mjs.
  let framed = 0
  for (const sl of slides) {
    if (sl.anim !== 'screen' || !sl.screen) continue
    if (typeof sl.boxX === 'number' && sl.boxW > 0) continue   // déjà résolu en amont
    const a = r2(sl.start || 0), b = r2(sl.end ?? (sl.start || 0) + 2)
    const said = inWin(a, b)

    // quels éléments la voix désigne-t-elle pendant ce plan ?
    const found = []
    for (const w of said) {
      const n = norm(w.text)
      const sw = STEP_WORDS.find((x) => x.w.includes(n) && !found.some((f) => f.spot === x.spot))
      if (!sw) continue
      if (sw.spot === 'generate') {
        const nx = words[words.indexOf(w) + 1]
        if (!nx || !GEN_OBJ.includes(norm(nx.text))) continue   // « générer DES millions » ≠ un clic
      }
      const sp = spotOf(sl.screen, sw.spot)
      if (sp) found.push({ spot: sw.spot, sp, t: w.start })
    }
    // rien de nommé → au moins l'entrée de menu du module, s'il est cité
    if (!found.length) {
      const m = MODULES.find((x) => x.screen === sl.screen)
      const cited = m && m.pat.some((p) => said.some((w) => norm(w.text).includes(norm(p.split(' ')[0]))))
      const menu = spotOf(sl.screen, 'menu')
      if (cited && menu) found.push({ spot: 'menu', sp: menu, t: a })
    }
    if (!found.length) continue

    found.sort((x, y) => x.t - y.t)
    const f1 = found[0], f2 = found[1]
    Object.assign(sl, {
      screenX: f1.sp.x, screenY: f1.sp.y,
      boxX: f1.sp.x, boxY: f1.sp.y, boxW: f1.sp.w, boxH: f1.sp.h,
      screenZoom: sl.screenZoom || 1.6,
    })
    // deux cibles dans le même plan → la caméra descend de l'une à l'autre
    if (f2) Object.assign(sl, {
      screenX2: f2.sp.x, screenY2: f2.sp.y,
      boxX2: f2.sp.x, boxY2: f2.sp.y, boxW2: f2.sp.w, boxH2: f2.sp.h,
    })
    // le champ de prompt se TAPE (le rendu a déjà le caret et le masque)
    if (!sl.screenText && found.some((x) => x.spot === 'prompt')) {
      sl.screenText = PROMPT_SAMPLE[sl.screen] || ''
    }
    framed++
  }

  // ── 2 · UN MOT AFFICHÉ EST UN MOT PRONONCÉ ─────────────────────────────────
  // L'orchestrateur pose ses cartes de texte sur des fenêtres approximatives :
  // « SIGNENT » restait à l'écran pendant « …ceux qui maîtrisent le réalisme ».
  const said = (txt, a, b) => {
    const toks = String(txt || '').split(/[\s,/·]+/).map(norm).filter((t) => t.length >= 4)
    if (!toks.length) return null
    for (const w of inWin(a, b)) {
      const n = norm(w.text)
      if (toks.some((t) => n === t || (t.length >= 5 && n.startsWith(t)) || (n.length >= 5 && t.startsWith(n)))) return w
    }
    return null
  }
  // Axel, après un premier essai où je me contentais de corriger QUEL mot
  // s'affichait : « la règle un mot affiché c'est non, on priorise les
  // animations plutôt que les séquences où y'a 1 mot au hasard ». Corriger le
  // mot ne suffisait pas — un plan qui ne montre qu'un mot ne montre rien.
  // Ordre de préférence, donc : (1) une animation ancrée sur ce qui est dit,
  // (2) à défaut, la carte SI ses mots sont réellement prononcés, (3) sinon rien.
  const anchorFor = (a, b) => VOICE_ANIMS.find((v) => words.some((w) =>
    v.w.includes(norm(w.text)) && w.start >= a - LEAD - 0.2 && w.start <= b - 0.25))
  let recut = 0, dropped = 0, toAnim = 0
  const kept = []
  for (const sl of slides) {
    const its = (sl.items || []).filter((it) => it && it.text)
    const isText = (!sl.anim || sl.anim === '') && (its.length || sl.title)
    if (!isText) { kept.push(sl); continue }
    const a = r2(sl.start || 0), b = r2(sl.end ?? (sl.start || 0) + 2)

    // (1) une animation illustre-t-elle ce qui est dit ici ? elle passe devant.
    //     Seul le CTA final est protégé : lui, son mot EST le message.
    const isFinalCta = sl.cta || b > D - 3.5
    const v = anchorFor(a, b)
    if (v && !isFinalCta) {
      sl.anim = v.anim
      sl.items = []; sl.title = ''
      if (v.photo) sl.photo = v.photo
      if (v.photo || v.assets) sl.assets = v.assets || [v.photo]
      toAnim++; kept.push(sl); continue
    }

    // (2) pas d'animation : la carte ne survit que si la voix dit ses mots
    const cand = its.map((it) => ({ it, w: said(it.text, a, b) })).filter((x) => x.w)
    if (its.length && !cand.length) { dropped++; continue }
    if (!its.length && sl.title && !said(sl.title, a, b)) { dropped++; continue }
    if (cand.length) {
      const best = cand.sort((x, y) => x.w.start - y.w.start)[0]
      if (best.it !== its[0]) recut++
      sl.items = [{ ...best.it, t: r2(best.w.start) }]          // le mot qui claque est celui qu'on entend
      sl.title = best.it.text
    }
    kept.push(sl)
  }

  // ── 3 · L'ANIMATION EST LE MOT ─────────────────────────────────────────────
  // anim-pack est déjà partagé : dès qu'on met la BONNE anim sur la bonne
  // fenêtre, les styles classiques héritent de sign / tools / post / du
  // comparatif fake-réel sur un vrai visage, exactement comme le dynamique.
  let reanim = 0
  // une scène « décorative » = une animation sans texte, et JAMAIS une capture
  // (`screen` appartient à ANIMS : sans ce filtre, réancrer écrasait une démo
  // d'interface — cadre, zoom et texte tapé compris)
  const decorative = (s) => s.anim && s.anim !== 'screen' && s.anim !== 'ui'
    && ANIMS.includes(s.anim) && !(s.items || []).length && !s.title && !s.screen
  // un déclencheur ne compte que s'il tombe VRAIMENT dans le plan : au bord, le
  // visuel arrive une seconde et demie avant le mot qu'il illustre
  const triggerIn = (a, b) => (forms) => words.find((w) =>
    forms.includes(norm(w.text)) && w.start >= a - LEAD - 0.2 && w.start <= b - 0.25)
  const used = new Set()                    // une animation ne se répète pas d'un plan à l'autre
  for (const sl of kept) {
    if (!decorative(sl)) continue
    const a = r2(sl.start || 0), b = r2(sl.end ?? (sl.start || 0) + 2)
    const has = triggerIn(a, b)
    const v = VOICE_ANIMS.find((x) => !used.has(x.anim) && has(x.w))
    if (!v) continue
    used.add(v.anim)
    if (v.anim === sl.anim) continue
    sl.anim = v.anim
    if (v.photo) sl.photo = v.photo
    if (v.photo || v.assets) sl.assets = v.assets || [v.photo]
    reanim++
  }

  // « poster sur les réseaux » a sa propre animation (c'est une locution, pas un
  // mot isolé — elle n'a pas sa place dans la table générale)
  if (!used.has('post')) {
    const hit = findSeq(words, 'poster sur les reseaux') || findSeq(words, 'sur les reseaux')
    if (hit) {
      const sl = kept.find((s) => decorative(s)
        && hit.start >= (s.start || 0) - LEAD - 0.2 && hit.start <= (s.end ?? 0) - 0.25)
      if (sl && sl.anim !== 'post') { sl.anim = 'post'; used.add('post'); reanim++ }
    }
  }

  plan.slides = kept
  if (framed || dropped || recut || reanim || toAnim) {
    console.log(`▶ style ${plan.slideStyle || 'auto'} : ${toAnim} carte(s) de texte remplacée(s) par une animation · `
      + `${dropped} carte(s) hors-sujet retirée(s) · ${recut} slam(s) recalé(s) · `
      + `${reanim} animation(s) réancrée(s) · ${framed} capture(s) cadrée(s) en repli`)
  }
}
