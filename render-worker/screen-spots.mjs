// ─────────────────────────────────────────────────────────────────────────────
// OÙ SE TROUVE CHAQUE ÉLÉMENT NOMMÉ, DANS CHAQUE CAPTURE DE L'APP.
//
// Sans cette carte, la scène `screen` posait son cadre orange à la position par
// défaut (0.5 / 0.5) : au milieu de la capture, donc sur du vide. Axel :
// « quand je dis image IA il met un rectangle sur une page noire… il ne
// sélectionne pas ce que je dis », « quand je dis décrire l'image il montre le
// format, y'a aucune logique ».
//
// Coordonnées NORMALISÉES sur l'image (centre + taille), mesurées à la main sur
// les PNG de assets/tuto (2880 × 1800). Elles sont indépendantes de la taille de
// rendu : le moteur les multiplie par la largeur du cadre de capture.
//
// Clés génériques, communes à tous les modules — la voix parle de « format », de
// « décrire », de « générer », pas de « div #promptbar » :
//   menu · style · format · duree · qualite · upload · prompt · generate · result
// Un module n'expose que ce qu'il a ; un mot sans point d'ancrage est ignoré
// (mieux vaut pas de cadre qu'un cadre au mauvais endroit).
// ─────────────────────────────────────────────────────────────────────────────

// La barre latérale est IDENTIQUE sur toutes les captures : une seule colonne,
// dix entrées à hauteur fixe. On la décrit une fois.
const menu = (y) => ({ x: 0.086, y, w: 0.157, h: 0.046 })
export const MENU_Y = {
  generateur: 0.128,
  bibliotheque: 0.175,
  imagesia: 0.223,
  enregistreur: 0.271,
  nettoyage: 0.318,
  express: 0.422,
  montageia: 0.470,
  editeur: 0.518,
  parrainage: 0.565,
  publier: 0.613,
}

export const SPOTS = {
  '01-imagesia': {
    menu:     menu(MENU_Y.imagesia),
    style:    { x: 0.240, y: 0.312, w: 0.093, h: 0.082 },   // carte « Photo Réel »
    format:   { x: 0.288, y: 0.668, w: 0.060, h: 0.078 },   // 9:16
    qualite:  { x: 0.288, y: 0.796, w: 0.208, h: 0.070 },
    upload:   { x: 0.461, y: 0.864, w: 0.084, h: 0.230 },   // image de référence
    prompt:   { x: 0.748, y: 0.812, w: 0.472, h: 0.122 },
    generate: { x: 0.899, y: 0.920, w: 0.175, h: 0.066 },   // « Générer l'image »
    result:   { x: 0.700, y: 0.392, w: 0.400, h: 0.300 },
  },
  '02-express': {
    menu:     menu(MENU_Y.express),
    style:    { x: 0.242, y: 0.272, w: 0.093, h: 0.072 },   // « Réaliste »
    format:   { x: 0.242, y: 0.498, w: 0.093, h: 0.068 },   // « Portrait 9:16 »
    duree:    { x: 0.290, y: 0.614, w: 0.208, h: 0.062 },
    qualite:  { x: 0.242, y: 0.756, w: 0.093, h: 0.058 },
    upload:   { x: 0.500, y: 0.770, w: 0.150, h: 0.243 },   // « Ajoute tes images »
    prompt:   { x: 0.784, y: 0.740, w: 0.398, h: 0.183 },
    generate: { x: 0.886, y: 0.934, w: 0.194, h: 0.066 },   // « Générer la vidéo »
    result:   { x: 0.700, y: 0.345, w: 0.560, h: 0.330 },
  },
  // Les autres captures n'exposent pour l'instant que leur entrée de menu : la
  // barre latérale est mesurée, leur intérieur ne l'est pas encore. Un mot qui
  // n'a pas d'ancrage ici ne produit simplement pas d'étape (jamais de cadre au
  // hasard). À compléter en même temps que #145 (refaire les captures).
  '03-generateur':     { menu: menu(MENU_Y.generateur) },
  '04-montageia':      { menu: menu(MENU_Y.montageia) },
  '05-bibliotheque':   { menu: menu(MENU_Y.bibliotheque) },
  '06-nettoyage-audio': { menu: menu(MENU_Y.nettoyage) },
  '07-enregistreur':   { menu: menu(MENU_Y.enregistreur) },
  '08-parrainage':     { menu: menu(MENU_Y.parrainage) },
}

export const spotOf = (screen, name) => (SPOTS[screen] || {})[name] || null
