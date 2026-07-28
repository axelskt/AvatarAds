// ─────────────────────────────────────────────────────────────────────────────
// OÙ SE TROUVE CHAQUE ÉLÉMENT NOMMÉ, DANS CHAQUE CAPTURE.
//
// Sans cette carte, la scène `screen` posait son cadre à la position par défaut
// (0.5 / 0.5) : au milieu de la capture, donc sur du vide. Axel : « quand je dis
// image IA il met un rectangle sur une page noire… il ne sélectionne pas ce que
// je dis ».
//
// ⚠️ CETTE CARTE N'EST PLUS ÉCRITE À LA MAIN. Elle l'a été, et elle avait deux
// défauts mortels : elle ne valait que pour AvatarAds, et elle se périmait à
// chaque changement d'interface (#145). Les coordonnées viennent maintenant de
// `assets/tuto/screens.json`, produit par `harvest-screens.mjs` qui lit la
// position RÉELLE de chaque bouton dans le DOM de l'app et prend la capture dans
// la même page — l'image et les cadres ne peuvent plus diverger.
// Pour régénérer : `node render-worker/harvest-screens.mjs`.
//
// DEUX FAÇONS DE VISER, et c'est la seconde qui compte pour l'avenir :
//   · spotOf(écran, 'generate')       — un rôle SÉMANTIQUE, pour nos propres
//     scripts (« il génère l'image ») ;
//   · spotForWords(écran, mots)       — les mots PRONONCÉS confrontés aux
//     libellés lus à l'écran. Générique : ça marche sur les captures de
//     n'importe quel utilisateur, sans qu'on ait rien à déclarer.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = join(HERE, 'assets', 'tuto', 'screens.json')

/** @type {Record<string, { zones: {name:string,label:string,x:number,y:number,w:number,h:number}[] }>} */
export const SCREENS = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// ── LES RÔLES SÉMANTIQUES ───────────────────────────────────────────────────
// La voix parle de « format », de « décrire », de « générer » — pas de
// « bouton-generer-l-image ». Chaque rôle est une liste de motifs cherchés dans
// le LIBELLÉ de la zone, du plus précis au plus large. Le premier qui répond
// gagne ; aucun ne répond → pas de cadre (mieux vaut rien qu'un cadre au hasard).
const ROLES = {
  style:    [/photo reel/, /^realiste/, /pixar/, /^ugc/, /mascotte/, /^studio$/, /^fruit$/],
  format:   [/^9 16$/, /portrait/, /paysage/, /^1 1$/, /^16 9$/],
  duree:    [/duree/, /^\d+ ?s$/],
  qualite:  [/720p/, /1080p/, /premium/, /^4k$/, /qualite/],
  upload:   [/ajoute tes images/, /ajouter/, /importe/, /image de reference/, /depuis la bibliotheque/],
  prompt:   [/decris/, /ecris/, /prompt/, /que tu veux/, /ton script/],
  generate: [/generer l image/, /generer la video/, /^generer/, /creer ma video/, /^commencer$/],
  cle:      [/generer ma cle/, /^copie ta cle/, /^ma cle/],
  connect:  [/connecteurs/, /connecter claude/, /ouvrir claude/],
  compte:   [/^mon compte$/],
  result:   [/telecharger/, /enregistrer dans la bibliotheque/, /utiliser en avatar/],
}

// `menu` ne se résout pas par motif : c'est l'entrée QUI CORRESPOND À L'ÉCRAN.
// Une liste de motifs renvoyait « Générateur » sur la capture d'Images IA —
// le premier motif de la liste gagnait, pas le bon.
const MENU_LABEL = {
  '01-imagesia': /^images ia$/, '02-express': /^express$/, '03-generateur': /^generateur$/,
  '04-montageia': /^montage ia/, '05-bibliotheque': /^bibliotheque$/,
  '06-nettoyage-audio': /^nettoyage audio$/, '07-enregistreur': /^enregistreur$/,
  '08-parrainage': /^parrainage$/, '09-cartoon': /^cartoon/, '10-mon-compte': /^mon compte$/,
}

const zonesOf = (screen) => (SCREENS[screen] || {}).zones || []
const box = (z) => (z ? { x: z.x, y: z.y, w: z.w, h: z.h, label: z.label } : null)

/** Le rôle sémantique → la zone qui l'incarne sur cet écran. */
export const spotOf = (screen, role) => {
  if (role === 'menu') {
    const p = MENU_LABEL[screen]
    return p ? box(zonesOf(screen).find((z) => p.test(norm(z.label)))) : null
  }
  const pats = ROLES[role]
  if (!pats) return null
  const zs = zonesOf(screen)
  for (const p of pats) {
    const hit = zs.find((z) => p.test(norm(z.label)))
    if (hit) return box(hit)
  }
  return null
}

/**
 * LES MOTS PRONONCÉS → LA ZONE QU'ILS DÉSIGNENT.
 * C'est le chemin générique, celui qui vaut pour les captures de n'importe quel
 * utilisateur : on ne déclare rien, on compare ce qu'il DIT à ce qui est ÉCRIT
 * sur son écran. « tu vas dans connecter Claude » trouve le libellé « Connecter
 * Claude » sans qu'on ait eu à prévoir ce module.
 * Un seul mot commun ne suffit pas : « la » ou « ton » ferait n'importe quoi.
 */
export const spotForWords = (screen, words) => {
  const said = words.map(norm).filter((w) => w.length >= 4)
  if (!said.length) return null
  let best = null, bestScore = 0
  for (const z of zonesOf(screen)) {
    const toks = norm(z.label).split(' ').filter((t) => t.length >= 4)
    if (!toks.length) continue
    let hits = 0
    for (const t of toks) if (said.some((w) => w === t || (t.length >= 5 && w.startsWith(t)) || (w.length >= 5 && t.startsWith(w)))) hits++
    // proportion du libellé retrouvée dans la voix — un libellé court et
    // entièrement prononcé bat un libellé long à moitié reconnu
    const score = hits / toks.length
    if (hits && score > bestScore) { bestScore = score; best = z }
  }
  return bestScore >= 0.5 ? box(best) : null
}

/** Une zone par son NOM exact — c'est ainsi que le chef d'orchestre la désigne. */
export const zoneNamed = (screen, name) => box(zonesOf(screen).find((z) => z.name === name))

/** Toutes les zones d'un écran, pour l'Éditeur (correction manuelle, #159). */
export const zonesFor = (screen) => zonesOf(screen).slice()
