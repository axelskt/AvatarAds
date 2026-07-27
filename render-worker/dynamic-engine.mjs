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
import { deriveDynamicSlides } from './dynamic-derive.mjs'
import { animHtml, animJs, animCss, ANIMS } from './anim-pack.mjs'

const r2 = (n) => Math.round(n * 100) / 100
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
    // #149 · fenêtres AVATAR : le visage plein écran entre les animations
    ...(plan.avatarSegments || [])
      .map((s, i) => ({ kind: 'avclip', t0: r2(s.start), t1: r2(s.end ?? s.start + 4), slide: { i, duo: s.duo } })),
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
  const panels = [
    ...anims.map((a) => ({ kind: a.kind, t0: a.t0, t1: a.t1, slide: a.slide })),
    ...phrases
      .filter((ws) => ws.some((w) => w.accent || w.text.length >= 11))
      .map((ws) => ({ kind: 'typo', t0: r2(Math.max(0, ws[0].start - 0.12)), t1: r2(ws[ws.length - 1].end + 0.3), words: ws })),
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
function typoContent(id, p, tone, liveT0) {
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
  const steps = (s.steps || []).filter((st) => st && st.spot).sort((a, b) => a.t - b.t)

  // — cadrage d'une étape : l'élément occupe ~42 % de la largeur visible, et la
  //   caméra reste toujours à l'intérieur de l'image (jamais de bord vide)
  const shot = (sp) => {
    const z = Math.min(3.1, Math.max(1.35, 0.42 / Math.max(0.04, sp.w)))
    const cl = (v, span) => Math.min(1 - span, Math.max(span, v))
    const px = cl(sp.x, 1 / (2 * z)), py = cl(sp.y, 1 / (2 * z))
    return { z, tx: r2(-(px - 0.5) * cw * z), ty: r2(-(py - 0.5) * ch * z),
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
      const bw = Math.round(sp.w * cw), bh = Math.round(sp.h * ch)
      const bx = Math.round(sp.x * cw - bw / 2), by = Math.round(sp.y * ch - bh / 2)
      const bd = Math.max(2, Math.round(6 / sh.z))
      const tIn = r2(Math.max(liveT0, st.t))
      const tOut = r2(Math.min(t1 - 0.05, k + 1 < steps.length ? Math.max(tIn + 0.35, steps[k + 1].t - 0.22) : t1))
      // Le texte tapé doit avoir la taille du texte DE L'APP, pas celle du cadre :
      // calé sur la hauteur du champ il sortait de la boîte et se superposait au
      // placeholder de la capture (« ici sur le screen ça ne fait pas très beau »).
      // Il est donc dimensionné sur la largeur de la capture — la même échelle que
      // l'interface — et un fond opaque masque le texte d'origine avant d'écrire.
      const fs = Math.max(8, Math.round(cw * 0.0115))
      const padX = Math.round(fs * 1.1)
      const tall = bh > fs * 3.4                          // vraie zone de texte → on écrit en HAUT
      const maxW = Math.max(20, bw - padX * 2 - bd * 2)
      const tw = Math.min(maxW, Math.round(String(st.type || '').length * fs * 0.52))
      boxes += `<div id="${id}b${k}" style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;` +
        `border:${bd}px solid ${ACC};border-radius:${Math.max(6, Math.round(16 / sh.z))}px;` +
        `box-shadow:0 0 0 ${Math.round(600 / sh.z)}px rgba(10,10,14,.42);opacity:0">` +
        (st.type
          ? `<div id="${id}m${k}" style="position:absolute;inset:0;border-radius:${Math.max(4, Math.round(12 / sh.z))}px;background:#0F0F16;opacity:0"></div>` +
            `<div id="${id}t${k}" style="position:absolute;left:${padX}px;${tall ? `top:${Math.round(fs * 1.1)}px` : 'top:50%;transform:translateY(-50%)'};` +
            `width:0;overflow:hidden;white-space:nowrap;font-size:${fs}px;line-height:1.25;color:#EDEDF2;font-family:'Inter',sans-serif">${esc(st.type)}</div>` +
            `<div id="${id}c${k}" style="position:absolute;left:${padX}px;${tall ? `top:${Math.round(fs * 1.1)}px` : `top:50%;margin-top:${-Math.round(fs * 0.6)}px`};` +
            `width:${Math.max(1, Math.round(fs * 0.09))}px;height:${Math.round(fs * 1.2)}px;background:${ACC};opacity:0"></div>`
          : '') +
        `</div>`
      // caméra : elle part vers l'étape juste avant que le mot tombe
      if (k > 0) {
        js2 += `\n  tl.to('#${id}ci',{scale:${sh.z},x:${sh.tx},y:${sh.ty},duration:0.46,ease:'power2.inOut'},${r2(Math.max(liveT0, tIn - 0.34))});`
      }
      js2 += `\n  tl.fromTo('#${id}b${k}',{scale:1.35,opacity:0},{scale:1,opacity:1,duration:0.3,ease:'back.out(1.8)'},${tIn});`
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
      js2 += `\n  tl.to('#${id}cu',{x:${sh.sx},y:${sh.sy},duration:0.34,ease:'power2.inOut'},${r2(Math.max(liveT0, tIn - 0.3))});`
      js2 += `\n  tl.to('#${id}cu',{scale:0.82,duration:0.09,ease:'power2.in'},${tIn});`
      js2 += `\n  tl.to('#${id}cu',{scale:1,duration:0.16,ease:'back.out(3)'},${r2(tIn + 0.09)});`
      js2 += `\n  tl.fromTo('#${id}rp${k}',{scale:0.3,opacity:0.55},{scale:2.2,opacity:0,duration:0.5,ease:'power2.out'},${tIn});`
      sfx.push({ kind: st.type ? 'mo-pop-1' : 'mo-tap-1', t: r2(tIn), vol: 0.8 })
    })
    // les ondes de clic vivent hors de l'image zoomée : taille constante
    const ripples = steps.map((_, k) =>
      `<div id="${id}rp${k}" style="position:absolute;left:-46px;top:-46px;width:92px;height:92px;border-radius:50%;background:${ACC};opacity:0"></div>`).join('')
    js2 = `
  tl.fromTo('#${id}cw',{y:200,opacity:0,scale:0.95},{y:0,opacity:1,scale:1,duration:0.44,ease:'power3.out'},${liveT0});
  tl.set('#${id}ci',{scale:${first.z},x:${first.tx},y:${first.ty}},${liveT0});
  tl.set('#${id}cu',{x:${first.sx},y:${r2(first.sy + 180)}},${liveT0});
  tl.fromTo('#${id}cu',{opacity:0},{opacity:1,duration:0.2},${r2(liveT0 + 0.2)});` + js2
    const html = `
        <div id="${id}cw" style="position:absolute;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;opacity:0">
          <div style="position:absolute;inset:0;border-radius:26px;overflow:hidden;box-shadow:0 46px 120px rgba(13,13,18,.45)">
            <div id="${id}ci" style="position:absolute;inset:0">
              <img src="${file}" style="position:absolute;left:0;top:0;width:${cw}px;height:${ch}px" />
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
  const W = opts.width || 1080
  const H = opts.height || 1920
  const D = r2(Math.max(1, plan.duration))
  const logoFile = opts.logoFile || ''
  // #148 : un plan venu de l'orchestrateur n'a AUCUNE scène ui (le serveur reste
  // générique) — on les dérive ici depuis la voix. Un plan écrit à la main qui en
  // contient déjà garde la priorité, la dérivation ne s'exécute pas.
  if (!(plan.slides || []).some((s) => s.anim === 'ui')) deriveDynamicSlides(plan, opts)
  const panels = buildPanels(plan, D)
  const PUSH = 0.42
  const DIRS = ['right', 'bottom', 'right', 'top']

  let html = ''
  let js = ''
  const sfxAdd = []
  const kbAdd = []
  let lastWhoosh = 0, whooshFlip = false

  const ap = isApple(plan)
  panels.forEach((p, i) => {
    // apple garde l'alternance (c'est elle qui donne le rythme d'un panneau à
    // l'autre) mais entre deux CLAIRS : gris iOS puis blanc.
    // un MÉDIA de l'utilisateur est toujours posé sur un fond CLAIR : Axel voulait
    // « la vidéo posée, qui ne prend pas tout l'écran, avec un fond blanc
    // derrière ». Sur un panneau sombre la carte se fondait dans le fond.
    const media = p.kind === 'media'
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
      const c = typoContent(id, p, tone, liveT0)
      inner += c.html; pjs += c.js; sfxAdd.push(...c.sfx)

    } else if (p.kind === 'ui') {
      const sc = uiScene(p.slide.ui, id, liveT0, t1, tone, p.slide)
      if (sc) {
        inner += sc.html; pjs += sc.js
        sfxAdd.push(...(sc.sfx || []))
        kbAdd.push(...(sc.keyboard || []))
      }

    } else if (p.kind === 'countup') {
      const s = p.slide, val = parseInt(String(s.value || '0').replace(/\D/g, ''), 10) || 0
      inner += `<div class="stack">
        <div class="disp" id="${id}n" style="font-size:330px;color:${tone.ink};opacity:0">0</div>
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

    } else if (p.kind === 'media') {
      // LE MÉDIA DE L'UTILISATEUR, POSÉ SUR LA PAGE. Ce style n'en affichait
      // aucun : `plan.broll` n'était lu que par le chemin classique. Je l'avais
      // d'abord mis plein cadre ; Axel : « la vidéo de la fille je la vois
      // plutôt posée, qui ne prend pas tout l'écran, avec un fond blanc
      // derrière ». Une carte flottante à coins ronds, avec son ombre portée :
      // on voit que c'est un RÉSULTAT montré, pas la vidéo elle-même.
      const src = String(p.slide.src || '')
      const vid = /\.(mp4|mov|webm|m4v)$/i.test(src)
      const cw = Math.round(W * 0.74), ch = Math.round(cw * 16 / 9)
      const cx = Math.round((W - cw) / 2), cy = Math.round((H - ch) / 2)
      const rad = Math.round(cw * 0.075)
      const card = (body) => `<div class="an-p" id="${id}md" style="left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${rad}px;overflow:hidden;box-shadow:0 40px 90px -20px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.06)">${body}</div>`
      if (vid) {
        inner += card(`<video id="${id}mv" class="clip" src="${esc(src)}" data-start="${liveT0}" data-duration="${r2(t1 - liveT0)}" data-track-index="8" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`)
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
        // HOOK EN SPLIT (Axel : « le hook je le vois plutôt en split screen avec
        // Alex en bas et le logo Claude qui pop »). L'outil dont il parle occupe
        // la moitié haute, son visage la moitié basse — on comprend le sujet ET
        // qui parle en une seconde, sans une ligne de texte.
        const half = Math.round(H / 2)
        const tw = Math.round(W * 0.46), tr = Math.round(tw * 0.24)
        const tx = Math.round((W - tw) / 2), ty = Math.round((half - tw) / 2)
        inner += `<div style="position:absolute;left:0;top:0;width:${W}px;height:${half}px;background:${tone.dark ? '#17171C' : '#F0EEE6'}"></div>
        <div class="an-p" id="${id}bt" style="left:${tx}px;top:${ty}px;width:${tw}px;height:${tw}px;border-radius:${tr}px;background:#F0EEE6;display:flex;align-items:center;justify-content:center;box-shadow:0 30px 70px rgba(0,0,0,.4)">
          <span style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(tw * 0.24)}px;color:#D97757;letter-spacing:-.02em">${esc(duo.brand)}</span></div>`
        const bot = src
          ? `<video id="${id}av" class="clip" src="${esc(src)}" data-start="${liveT0}" data-duration="${r2(t1 - liveT0)}" data-track-index="9" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block"></video>`
          : `<div style="width:100%;height:100%;background:url('tuto/hook-qualite.png') center 22%/cover"></div>`
        inner += `<div style="position:absolute;left:0;top:${half}px;width:${W}px;height:${half}px;overflow:hidden">${bot}</div>`
        // le logo POP : c'est lui l'information du hook
        pjs += `\n  tl.fromTo('#${id}bt',{scale:0.2,rotation:-12,autoAlpha:0},{scale:1,rotation:0,autoAlpha:1,duration:0.5,ease:'back.out(2.2)',transformOrigin:'50% 50%'},${r2(liveT0 + 0.12)});`
        pjs += `\n  tl.to('#${id}bt',{scale:1.05,duration:${r2(Math.max(0.6, t1 - liveT0 - 0.7))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(liveT0 + 0.62)});`
        sfxAdd.push({ kind: 'mo-impact-1', t: r2(liveT0 + 0.14), vol: 0.7 })
      } else if (src) {
        // CADRAGE DE LA PHOTO, INTACT. J'avais recadré serré pour cacher une main
        // ratée par le lipsync — mauvaise réponse : ça masquait aussi les gestes,
        // et Axel les veut (« ça animé c'était bien, ça rajoute un truc de parler
        // avec les mains »). Le défaut se corrige à la source, dans le prompt
        // Hedra (mcp/index.ts) ; ici on rend l'image telle qu'il l'a composée.
        inner += `<video id="${id}av" class="clip" src="${esc(src)}" data-start="${liveT0}" data-duration="${r2(t1 - liveT0)}" data-track-index="9" muted playsinline style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover"></video>`
      } else {
        inner += `<div id="${id}av" style="position:absolute;left:-3%;top:-3%;width:106%;height:106%;background:url('tuto/hook-qualite.png') center/cover"></div>`
        pjs += `\n  tl.fromTo('#${id}av',{scale:1},{scale:1.07,duration:${r2(Math.max(0.8, t1 - liveT0))},ease:'none'},${liveT0});`
      }

    } else if (p.kind !== 'punch' && ANIMS.includes(p.kind)) {
      // PACK D'ANIMATIONS SÉMANTIQUES (#147 — « des animations plutôt que des
      // mots ») : le plan a choisi une anim qui ILLUSTRE la phrase (network,
      // target, grow, money…). Plein panneau, palette adaptée au tone, temps
      // absolus — le pack est déjà seek-safe.
      const s = { ...p.slide, id, start: liveT0, dur: Math.max(0.8, t1 - liveT0) }
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
      }
      sfxAdd.push({ kind: 'mo-impact-2', t: r2(tAt), vol: 0.6 })
    }

    html += `\n  <div id="${id}" class="pnl" style="z-index:${i + 1};background:${tone.bg};${i > 0 ? 'opacity:0' : ''}"><div class="pin" id="${id}in">${inner}</div></div>`

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
      if (p.kind !== 'typo' && t0 - lastWhoosh > 2.5) {
        sfxAdd.push({ kind: whooshFlip ? 'mo-swipe-2' : 'mo-whoosh-1', t: r2(Math.max(0, t0 - 0.05)), vol: 0.55 })
        lastWhoosh = t0; whooshFlip = !whooshFlip
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
  const minGap = (k) => (k === 'mo-tap-1' ? 0.6 : k === 'mo-whoosh-1' || k === 'mo-swipe-2' ? 2.2 : 2)
  // LE BON SON POUR LA SCÈNE (chaque scène déclare le sien : clic pour un bouton,
  // ding pour un envoi, obturateur pour une photo, tic-tac pour le chrono…) — et
  // si le même son devait rejouer trop vite, on le remplace par son jumeau au
  // lieu de marteler l'identique (retour d'Axel : « varier, pas toujours le même »)
  // fenêtre d'ÉCHANGE (2.4s) : le même son qui reviendrait vite devient son jumeau,
  // puis le jumeau du jumeau — quatre clics de suite deviennent clic/click/obturateur.
  // fenêtre de COUPE (minGap) : en dessous, on saute carrément.
  const TWIN = { 'mo-tap-1':'mo-pop-3', 'mo-pop-3':'mo-tick-1', 'mo-tick-1':'mo-tap-1', 'mo-pop-1':'mo-pop-2', 'mo-pop-2':'mo-pop-1', 'mo-impact-1':'mo-impact-2', 'mo-impact-2':'mo-impact-3' }
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

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
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
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-width="${W}" data-height="${H}" data-start="0" data-duration="${D}">${html}
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
