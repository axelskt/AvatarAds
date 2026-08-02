// ══════════════════════════════════════════════════════════════════════════
//  ANIM-SPEC — le format d'animation qu'un modèle sait écrire sans rien casser
// ══════════════════════════════════════════════════════════════════════════
//
// #38, décidé avec Axel le 02/08 : l'utilisateur génère sa propre animation
// depuis « Détails du montage », elle est sauvegardée dans SA marque, et les
// meilleures rejoignent la banque globale après validation.
//
// Tout repose sur ce fichier. La question n'était pas « est-ce qu'un modèle sait
// écrire une animation » — il sait — mais « est-ce qu'il peut le faire sans
// qu'un rendu payant parte en vrille chez un client ». Laisser un modèle écrire
// du HTML et du GSAP, c'est accepter qu'une balise mal fermée, une police
// absente ou une boucle infinie tombent dans une vidéo de 50 s que personne ne
// regarde avant l'utilisateur.
//
// Alors on ne lui fait pas écrire du code. On lui fait DÉCRIRE une scène, dans
// un vocabulaire fermé :
//
//   { nom, mots[], montre, elements[ { forme, icone|texte, x, y, w, couleur,
//                                      entree, a } ] }
//
// · `forme` ∈ carte · pastille · barre · texte · fleche · telephone   (6)
// · `icone` ∈ les 45 sujets dessinables de sujet-pack.mjs
// · `entree` ∈ monte · zoom · glisse · dessine · pulse                (5)
// · x, y, w en fraction du cadre ; `a` = instant d'entrée, de 0 à 1
//
// Le modèle ne peut donc produire QUE des scènes rendables. Pas de CSS, pas de
// balise, pas de script : des positions et des mouvements. Et `valider()` borne
// tout — coordonnées, tailles, nombre d'éléments, longueur des textes — puis
// REFUSE ce qui ne dessinerait rien. Une spec refusée n'est jamais proposée.
//
// Le texte, lui, obéit à la règle la plus ancienne du produit : il doit être
// PRONONCÉ. `valider()` reçoit la phrase et jette tout mot inventé — sans quoi
// un modèle écrirait « +300 % DE VENTES » sur une vidéo qui ne dit pas ça.

import { sujetSvg, SUJETS_CONNUS } from './sujet-pack.mjs'

export const FORMES = ['carte', 'pastille', 'barre', 'texte', 'fleche', 'telephone']
export const ENTREES = ['monte', 'zoom', 'glisse', 'dessine', 'pulse']
export const COULEURS = ['accent', 'encre', 'doux']
export const MAX_ELEMENTS = 6

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(+v) ? +v : (a + b) / 2))
const sansAccent = (x) => String(x).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

// ── LA VALIDATION ─────────────────────────────────────────────────────────
// Elle ne corrige pas « au mieux » : elle borne ce qui se borne, et REFUSE le
// reste. Une spec à moitié juste produirait une scène à moitié fausse, et c'est
// exactement ce qu'on cherche à ne plus livrer.
export function valider(brut, { phrase = '', style = 'apple' } = {}) {
  const err = (m) => ({ ok: false, erreur: m })
  if (!brut || typeof brut !== 'object') return err('spec absente')

  const nom = String(brut.nom || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32)
  if (nom.length < 3) return err('nom manquant ou trop court')

  const mots = (Array.isArray(brut.mots) ? brut.mots : [])
    .map((m) => String(m || '').trim().toLowerCase()).filter((m) => m.length >= 3).slice(0, 8)
  if (!mots.length) return err('aucun mot déclencheur')

  const src = Array.isArray(brut.elements) ? brut.elements : []
  if (!src.length) return err('aucun élément à dessiner')
  if (src.length > MAX_ELEMENTS) return err(`${src.length} éléments, ${MAX_ELEMENTS} au maximum`)

  // les mots réellement prononcés, pour juger les textes
  const dits = new Set(String(phrase).split(/\s+/).map(sansAccent).filter(Boolean))

  const elements = []
  const rejets = []
  for (const [i, e] of src.entries()) {
    if (!e || typeof e !== 'object') { rejets.push(`élément ${i + 1} illisible`); continue }
    const forme = String(e.forme || '').toLowerCase()
    if (!FORMES.includes(forme)) { rejets.push(`« ${forme} » n'est pas une forme`); continue }

    const el = {
      forme,
      x: clamp(e.x, 0.06, 0.94),
      y: clamp(e.y, 0.06, 0.94),
      w: clamp(e.w, 0.08, 0.9),
      couleur: COULEURS.includes(String(e.couleur)) ? String(e.couleur) : 'accent',
      entree: ENTREES.includes(String(e.entree)) ? String(e.entree) : 'monte',
      a: clamp(e.a, 0, 0.85),
    }

    if (forme === 'texte') {
      // ── LE TEXTE VIENT DE SA BOUCHE, TOUJOURS ────────────────────────────
      // C'est la règle la plus ancienne du produit et la plus violée par un
      // modèle : sans elle il écrit « +300 % DE VENTES » sur une vidéo qui ne
      // dit rien de tel. Chaque mot affiché doit avoir été prononcé (les
      // chiffres et les mots de deux lettres passent : « 3 », « et »).
      const t = String(e.texte || '').trim().slice(0, 28)
      if (!t) { rejets.push(`élément ${i + 1} : texte vide`); continue }
      const inventes = t.split(/\s+/).filter((m) => {
        const n = sansAccent(m)
        return n.length > 2 && !/^\d+$/.test(n) && !dits.has(n)
      })
      if (inventes.length) { rejets.push(`« ${t} » : ${inventes.join(', ')} n'est pas prononcé`); continue }
      el.texte = t
    } else if (forme === 'carte' || forme === 'pastille') {
      const ic = String(e.icone || '').toLowerCase()
      if (!SUJETS_CONNUS.includes(ic)) { rejets.push(`« ${ic} » n'est pas un sujet dessinable`); continue }
      el.icone = ic
    }
    elements.push(el)
  }

  if (!elements.length) return err(`rien de dessinable (${rejets.join(' · ')})`)
  // ── UNE SCÈNE QUI NE MONTRE RIEN N'EST PAS UNE SCÈNE ────────────────────
  // Du texte tout seul, c'est une carte de texte — précisément ce qu'Axel a
  // interdit (« je ne veux pas de texte uniquement, animations »). Il faut au
  // moins une forme qui DESSINE.
  if (!elements.some((e) => e.forme !== 'texte')) return err('du texte seul, aucune forme dessinée')

  return {
    ok: true,
    rejets,
    spec: {
      nom, mots, style,
      montre: String(brut.montre || '').slice(0, 140),
      elements,
    },
  }
}

// ── LE RENDU ──────────────────────────────────────────────────────────────
// Déterministe, sans surprise : chaque forme a un dessin fixe, chaque entrée a
// une courbe fixe. Le modèle a choisi QUOI et OÙ, jamais COMMENT.
export function specHtml(spec, f, P, id) {
  const els = (spec && spec.elements) || []
  if (!els.length) return ''
  const teinte = (c) => c === 'encre' ? P.ink : c === 'doux' ? P.mute : P.acc
  let h = ''
  for (const [k, e] of els.entries()) {
    const w = Math.round(f.w * e.w)
    const cx = Math.round(f.w * e.x), cy = Math.round(f.h * e.y)
    const pos = (ww, hh) => `position:absolute;left:${Math.round(cx - ww / 2)}px;top:${Math.round(cy - hh / 2)}px;width:${ww}px;height:${hh}px`
    const eid = `${id}x${k}`

    if (e.forme === 'carte') {
      const d = Math.min(w, Math.round(f.h * 0.8))
      h += `<div class="an-p" id="${eid}" style="${pos(d, d)};border-radius:${Math.round(d * 0.26)}px;background:${P.soft};`
        + `border:2px solid ${P.line};display:flex;align-items:center;justify-content:center;`
        + `box-shadow:0 20px 44px -18px rgba(0,0,0,.28)">${sujetSvg(e.icone, Math.round(d * 0.5), teinte(e.couleur), 1.7)}</div>`
    } else if (e.forme === 'pastille') {
      const d = Math.min(w, Math.round(f.h * 0.55))
      h += `<div class="an-p" id="${eid}" style="${pos(d, d)};border-radius:50%;background:${teinte(e.couleur)};`
        + `display:flex;align-items:center;justify-content:center">${sujetSvg(e.icone, Math.round(d * 0.5), '#fff', 2)}</div>`
    } else if (e.forme === 'barre') {
      const hh = Math.max(10, Math.round(f.h * 0.055))
      h += `<div class="an-p" id="${eid}" style="${pos(w, hh)};border-radius:99px;background:${teinte(e.couleur)}"></div>`
    } else if (e.forme === 'texte') {
      const fs = Math.max(26, Math.min(Math.round(f.h * 0.14), Math.round(w / (0.54 * Math.max(4, e.texte.length)))))
      h += `<div class="an-p" id="${eid}" style="${pos(w, Math.round(fs * 1.3))};display:flex;align-items:center;`
        + `justify-content:center;font-family:'Inter',Helvetica,Arial,sans-serif;font-weight:800;`
        + `font-size:${fs}px;letter-spacing:-.02em;color:${teinte(e.couleur)};white-space:nowrap">${esc(e.texte)}</div>`
    } else if (e.forme === 'fleche') {
      const hh = Math.round(w * 0.42)
      h += `<svg class="an-p" id="${eid}" style="${pos(w, hh)}" viewBox="0 0 24 10" fill="none" stroke="${teinte(e.couleur)}"`
        + ` stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h19M15.5 1.2 20.8 5l-5.3 3.8"/></svg>`
    } else if (e.forme === 'telephone') {
      const ww = Math.min(w, Math.round(f.h * 0.44)), hh = Math.round(ww * 2.02)
      h += `<div class="an-p" id="${eid}" style="${pos(ww, hh)};border-radius:${Math.round(ww * 0.16)}px;`
        + `background:${P.soft};border:3px solid ${P.line};box-shadow:0 24px 50px -20px rgba(0,0,0,.32)"></div>`
    }
  }
  return h
}

export function specJs(spec, id, t0, r2) {
  const els = (spec && spec.elements) || []
  const dur = Math.max(0.9, Number(spec && spec.dur) || 2.4)
  let js = ''
  for (const [k, e] of els.entries()) {
    const eid = `#${id}x${k}`
    const t = r2(t0 + e.a * dur * 0.62)
    if (e.entree === 'zoom') {
      js += `\n      tl.fromTo('${eid}', { scale: 0.55, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.42, ease: 'back.out(1.8)', transformOrigin: '50% 50%' }, ${t});`
    } else if (e.entree === 'glisse') {
      js += `\n      tl.fromTo('${eid}', { x: -60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.38, ease: 'power3.out' }, ${t});`
    } else if (e.entree === 'dessine') {
      js += `\n      tl.fromTo('${eid}', { scaleX: 0.05, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.4, ease: 'power2.out', transformOrigin: '0% 50%' }, ${t});`
    } else if (e.entree === 'pulse') {
      js += `\n      tl.fromTo('${eid}', { scale: 0.85, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, ease: 'power2.out', transformOrigin: '50% 50%' }, ${t});`
      js += `\n      tl.to('${eid}', { scale: 1.08, duration: 0.4, ease: 'sine.inOut', yoyo: true, repeat: 1, transformOrigin: '50% 50%' }, ${r2(t + 0.42)});`
    } else {
      js += `\n      tl.fromTo('${eid}', { y: 52, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.6)' }, ${t});`
    }
  }
  return js
}

// Le catalogue que le modèle lit pour écrire une spec. Il vit ICI, à côté du
// code qui la valide : une liste dans un prompt et une liste dans le code
// finissent toujours par diverger.
export const CATALOGUE_SPEC = `Une animation se DÉCRIT, elle ne s'écrit pas en code. Format JSON :
{ "nom": "...", "mots": ["..."], "montre": "...", "elements": [ ... ] }

· nom     : un mot, minuscules et tirets ("haltere-series")
· mots    : les mots prononcés qui doivent déclencher cette animation
· montre  : ce qu'on VOIT bouger, en une phrase
· elements: de 1 à ${MAX_ELEMENTS} formes, chacune :
    forme  : ${FORMES.join(' · ')}
    icone  : (formes carte et pastille) un sujet parmi : ${SUJETS_CONNUS.join(', ')}
    texte  : (forme texte) UNIQUEMENT des mots réellement prononcés
    x, y   : le CENTRE de la forme, en fraction du cadre (0 = gauche/haut, 1 = droite/bas)
    w      : sa largeur, en fraction du cadre
    couleur: ${COULEURS.join(' · ')}
    entree : ${ENTREES.join(' · ')}
    a      : quand elle entre, de 0 (tout de suite) à 0.85 (à la fin)

RÈGLES
· Il faut AU MOINS une forme qui dessine : du texte seul est refusé.
· Chaque mot affiché doit être prononcé dans la phrase, sinon la spec est jetée.
· Les formes ne se chevauchent pas : écarte-les d'au moins 0.12 en x ou en y.
· Montre le SUJET dont on parle, pas une idée voisine.`
