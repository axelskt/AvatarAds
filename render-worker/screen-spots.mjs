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

import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
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
  '08-parrainage': /^parrainage$/, '09-cartoon': /^cartoon/,
}

const zonesOf = (screen) => (SCREENS[screen] || {}).zones || []
// `name` est conservé : c'est le seul moyen de reconnaître une entrée de MENU
// (identique sur toutes les captures) d'un champ du contenu. Sans lui, le
// rapprochement par mots cadrait la barre latérale dès que la voix prononçait
// le nom d'un module — c'est-à-dire à peu près tout le temps.
const box = (z) => (z ? { x: z.x, y: z.y, w: z.w, h: z.h, label: z.label, name: z.name } : null)

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
// LE VOCABULAIRE DE LA VOIX N'EST PAS CELUI DE L'INTERFACE. On dit « ton
// audio », l'écran écrit « Importe ta voix off · MP3 · WAV · M4A » : aucun mot
// commun, donc aucune zone trouvée, et le cadre restait sur « Ma vidéo »
// pendant qu'il parlait du son (Axel : « quand je dis "ainsi que ton audio" il
// montre "Ma vidéo" »). Ces équivalences-là sont du métier, pas de la langue :
// on les écrit une fois, elles valent pour toutes les captures.
const SYN = {
  audio: ['voix', 'off', 'mp3', 'wav', 'm4a', 'son'],
  son: ['voix', 'off', 'audio'],
  voix: ['voix', 'off', 'audio'],
  musique: ['musique', 'fond'],
  image: ['image', 'photo', 'visuel'],
  photo: ['photo', 'image', 'avatar'],
  visuel: ['image', 'photo', 'visuel'],
  video: ['video', 'clip'],
  clip: ['video', 'clip'],
  script: ['script', 'brief'],
  brief: ['script', 'brief'],
  soustitres: ['sous', 'titres'],
  legende: ['sous', 'titres'],
}
const elargir = (mots) => {
  const out = new Set(mots)
  for (const m of mots) for (const e of SYN[m] || []) out.add(e)
  return [...out]
}

// LA BARRE LATÉRALE. Elle est identique sur toutes les captures et ses libellés
// sont les noms des modules — que la voix prononce sans arrêt. Sans l'écarter,
// « ainsi que ton audio » cadrait « Nettoyage audio » dans le menu et « importe
// ton image » cadrait « Images IA » : le curseur restait dans la barre pendant
// qu'il décrivait le contenu de la page.
export const MENU_ZONES = ['images-ia', 'montage-ia-beta', 'generateur', 'bibliotheque',
  'enregistreur', 'nettoyage-audio', 'express', 'parrainage', 'cartoon', 'mon-compte']

// LES VERBES D'INTERFACE NE DISTINGUENT RIEN. « Importe ta voix off » et
// « Importe ta vidéo » commencent pareil ; la voix dit « importe » à chaque
// étape. Sur « et importe ton IMAGE », le verbe faisait gagner le champ de la
// voix off. C'est l'OBJET qui désigne la zone, pas l'action.
const VERBES = new Set(['importe', 'importer', 'ajoute', 'ajouter', 'creer', 'cree', 'selectionne',
  'selectionner', 'choisis', 'choisir', 'clique', 'cliquer', 'lance', 'lancer', 'ouvre', 'ouvrir',
  'generer', 'genere', 'modifier', 'telecharge', 'telecharger', 'commence', 'commencer'])

// Le SUJET d'un libellé : ce qui précède le premier séparateur. Les libellés
// récoltés collent le titre et son sous-titre (« Importe ta voix off · MP3 ·
// WAV · M4A — l'IA en extrait les sous-titres ») : noyé dans dix-sept mots, le
// sujet ne pesait plus rien et la zone n'était jamais retenue.
const sujet = (label) => String(label || '').split(/[·—–]|\s-\s/)[0]
// Un verbe compte MOITIÉ MOINS qu'un objet : « Importe ta voix off » et
// « Importe ta vidéo » commencent pareil, et la voix dit « importe » à chaque
// étape. Sur « et importe ton IMAGE », le verbe faisait gagner le champ de la
// voix off. C'est l'objet qui désigne la zone.
// On descend à trois lettres — « off », « mp3 », « wav » distinguent le champ de
// la voix off de « Gameplay + voix », qui partagent leur seul mot long. Les mots
// vides sont écartés nommément plutôt que par leur longueur.
const VIDES = new Set(['une', 'des', 'les', 'ton', 'ta', 'tes', 'mon', 'ma', 'mes', 'son', 'sa',
  'ses', 'aux', 'par', 'sur', 'pour', 'avec', 'sans', 'dans', 'que', 'qui', 'est', 'and', 'the'])
const motsDe = (label) => norm(sujet(label)).split(' ')
  .filter((t) => t.length >= 3 && !VIDES.has(t))
  .map((t) => ({ t, w: VERBES.has(t) ? 0.5 : 1 }))

// UN MOT QUI REVIENT PARTOUT NE DÉSIGNE RIEN. Sur l'écran Images IA, « image »
// apparaît dans cinq libellés : il ne peut pas servir à choisir entre eux, et
// c'est pourtant lui qui faisait gagner « Générer l'image · 3 cr » à chaque
// phrase contenant le mot. Le poids d'un mot est donc divisé par le nombre de
// libellés où il figure — un mot unique sur l'écran vaut une preuve, un mot
// omniprésent ne vaut presque rien. Le score est ABSOLU (une somme de preuves),
// pas une proportion : un libellé d'un seul mot n'est plus gagnant d'office.
const rarete = (screen) => {
  const n = {}
  for (const z of zonesOf(screen)) {
    const vus = new Set(motsDe(z.label).map((m) => m.t))
    for (const t of vus) n[t] = (n[t] || 0) + 1
  }
  return n
}

/** somme des preuves : ce qui est DIT et qu'on retrouve, ÉCRIT, sur la zone */
export const zoneScore = (z, said, freq) => {
  let score = 0
  for (const { t, w } of motsDe(z && z.label)) {
    if (!said.some((x) => x === t || (t.length >= 5 && x.startsWith(t)) || (x.length >= 5 && t.startsWith(x)))) continue
    score += w / ((freq && freq[t]) || 1)
  }
  return score
}

export const spotForWords = (screen, words, opts) => {
  const o = opts || {}
  const said = elargir(words.map(norm).filter((w) => w.length >= 3 && !VIDES.has(w)))
  if (!said.length) return null
  const min = typeof o.min === 'number' ? o.min : 0.55
  const freq = rarete(screen)
  let best = null, bestScore = 0
  for (const z of zonesOf(screen)) {
    if (o.sansMenu && MENU_ZONES.includes(z.name)) continue
    const score = zoneScore(z, said, freq)
    if (score > bestScore) { bestScore = score; best = z }
  }
  return bestScore >= min ? box(best) : null
}

/** Ce que la voix dit retrouve-t-il un mot du libellé de CETTE zone ? */
export const zoneDite = (z, words) => zoneScore(z, elargir(words.map(norm).filter((w) => w.length >= 3))) > 0

// Le harvest tronque les noms de zone à 40 caractères, mais le chef d'orchestre
// reconstruit parfois le slug ENTIER depuis le libellé lu à l'écran
// (« …-dit-a-voix-haute » demandé, « …-dit-a » en banque) : la zone existait,
// le tuto partait quand même en « zone inconnue » — c'est ça qui a fait
// disparaître la visite guidée Express de la v10. On tolère donc le match par
// préfixe (≥12 caractères, dans les deux sens), l'exact restant prioritaire.
export const zoneNamed = (screen, name) => {
  const zs = zonesOf(screen)
  const exact = zs.find((z) => z.name === name)
  if (exact) return box(exact)
  const n = String(name || '')
  if (n.length < 12) return box(undefined)
  return box(zs.find((z) => z.name.length >= 12
    && (n.startsWith(z.name) || z.name.startsWith(n))))
}

/** Toutes les zones d'un écran, pour l'Éditeur (correction manuelle, #159). */
export const zonesFor = (screen) => zonesOf(screen).slice()

/**
 * La taille NATIVE de la capture, en pixels.
 * Le moteur en a besoin pour poser l'image à sa vraie résolution : Chrome
 * rastérise une image à sa taille de MISE EN PAGE, pas à sa taille après
 * `transform: scale()`. Affichée sur 980 px puis agrandie 4 fois, elle était
 * donc agrandie comme un bitmap — d'où le flou qu'Axel a vu sur les zooms,
 * alors que la capture d'origine, elle, est nette.
 */
// La taille NATIVE de la capture décide du facteur K du moteur (image posée à sa
// résolution puis réduite → zoom net). `screens.json` ne porte pas toujours w/h :
// sans eux K=1, la capture 3200 px était posée sur 980 px puis zoomée ×4 → flou
// blanc sur « Images IA » / « Express » (vu le 22/08). Repli : lire l'en-tête PNG
// (IHDR : largeur/hauteur aux octets 16-24), mis en cache.
const _sizeCache = {}
const pngSize = (screen) => {
  if (_sizeCache[screen]) return _sizeCache[screen]
  try {
    const f = join(dirname(FILE), screen + '.png')
    if (!existsSync(f)) return (_sizeCache[screen] = { w: 0, h: 0 })
    const fd = openSync(f, 'r'); const b = Buffer.alloc(24); readSync(fd, b, 0, 24, 0); closeSync(fd)
    return (_sizeCache[screen] = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) })
  } catch { return (_sizeCache[screen] = { w: 0, h: 0 }) }
}
export const screenSize = (screen) => {
  const s = SCREENS[screen] || {}
  if (s.w && s.h) return { w: s.w, h: s.h }
  return pngSize(String(screen || ''))
}
