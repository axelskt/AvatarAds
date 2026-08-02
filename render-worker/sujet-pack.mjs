// ══════════════════════════════════════════════════════════════════════════
//  LE SUJET OUVERT — des animations pour les domaines qu'on n'a pas prévus
// ══════════════════════════════════════════════════════════════════════════
//
// Axel, 02/08 : « ça me fait peur le Montage IA, parce que si demain un mec
// vient avec un thème qui n'a rien à voir — exemple salle de sport, il parle
// d'exercices, de machines — l'IA sera bloquée et montrera des animations pas
// cohérentes du tout, et impossible de valider toutes les animations comme ça
// de chaque domaine. »
//
// Il a raison. Le constat qui débloque : ce qui change d'un métier à l'autre,
// ce n'est PAS le mouvement. Une chose apparaît, deux ou trois défilent, une
// suite s'enchaîne — ça vaut pour un coach sportif comme pour un SaaS. Ce qui
// change, c'est le SUJET. La banque fermée (soixante noms écrits pour le
// vocabulaire d'Axel) enfermait les deux ensemble, d'où le blocage.
//
// Ici on les sépare : quelques MOUVEMENTS universels, et un SUJET libre — une
// icône choisie d'après le mot réellement prononcé. Le coach dit « haltères »,
// on montre un haltère ; il dit « chrono », on montre un chronomètre.
//
// Aucun code n'est généré à la volée : le rendu reste déterministe, le style
// reste celui d'AvatarAds, et une phrase qu'on ne sait pas illustrer ne produit
// RIEN — c'est tout le sens de `sujetsDe()`, qui ne rend que ce qu'il sait
// dessiner. Un visuel neutre ne se remarque pas ; un visuel qui ment, si.
//
// Pas de mot écrit sous l'icône : règle d'Axel sur `lineup` (« jamais le mot
// écrit, je ne veux pas que tu l'écrives »). Il le dit, on le montre.

// ── LES SUJETS ────────────────────────────────────────────────────────────
// Icônes au trait sur une grille 24, bouts arrondis : le même langage
// graphique que le reste du pack, lisibles à 200 px comme à 500.
// Chaque entrée = [nom, tracé, motif des mots qui la déclenchent].
// L'ordre compte : le premier motif qui accroche gagne, donc le spécifique
// (« haltère ») passe avant le générique (« matériel »).
const SUJETS = [
  // — corps, sport, santé
  ['haltere', 'M4 9v6M7 6.5v11M17 6.5v11M20 9v6M7 12h10', /halt[eè]re|muscu|fonte|dumbbell|barre|poids/i],
  ['coeur', 'M12 20.5s-7.5-4.7-7.5-9.7A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.5 2.8c0 5-7.5 9.7-7.5 9.7z', /coeur|cœur|cardio|pouls|sant[ée]|battement|souffle/i],
  ['flamme', 'M12 22c3.9 0 6.4-2.7 6.4-6.1 0-4.7-4.4-6.2-3.7-11.6-2.9 1.6-4.9 4.3-4.9 7.1 0 1.4-1 2-1.8 1.2-.6-.6-.9-1.6-.9-2.6-1.5 2-1.6 3.6-1.6 5.9C5.5 19.3 8 22 12 22z', /calorie|br[uû]l|intensit|[ée]nergie|cramer|chaud/i],
  ['chrono', 'M12 21.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 13V9M9.5 2.5h5M19 6l-1.6 1.6', /chrono|minuteur|s[ée]rie|r[ée]p[ée]tition|tempo|dur[ée]e|repos/i],
  ['goutte', 'M12 21a6.2 6.2 0 0 0 6.2-6.2C18.2 10.6 12 3 12 3S5.8 10.6 5.8 14.8A6.2 6.2 0 0 0 12 21z', /hydrat|boire|sueur|transpir|goutte|liquide|eau/i],
  // couverts, pas une assiette vide : deux cercles concentriques donnaient
  // exactement la même image que `cible` (vu sur la planche des 45 sujets).
  ['assiette', 'M5 2.5v7a3 3 0 0 0 6 0v-7M8 9.5v12M17.5 2.5c-1.6 0-2.7 2.2-2.7 5.8s2.7 5 2.7 5v8.2', /assiette|repas|manger|nutri|alimenta|prot[ée]ine|r[ée]gime|recette|plat/i],
  // — lieux, déplacements
  ['maison', 'M3 11 12 3l9 8M6 10.2V20h12v-9.8', /maison|domicile|logement|immobilier|appart|chez toi|chez soi/i],
  ['boutique', 'M3.2 8 5 4h14l1.8 4M3.2 8h17.6v12H3.2zM9 20v-6h6v6', /boutique|magasin|shop|commerce|salle|club|studio|local|agence/i],
  ['voiture', 'M4.5 16h15M6 16l1.6-6.5h8.8L18 16M4.5 16v3h3v-3M16.5 16v3h3v-3', /voiture|auto|v[ée]hicule|conduire|trajet|route/i],
  ['valise', 'M3.5 8h17v12h-17zM9 8V4.8h6V8', /valise|voyage|bagage|d[ée]placement|vacances/i],
  ['planete', 'M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19zM2.5 12h19M12 2.5c2.6 2.7 4 5.9 4 9.5s-1.4 6.8-4 9.5c-2.6-2.7-4-5.9-4-9.5s1.4-6.8 4-9.5z', /international|pays|global|plan[eè]te|partout|monde entier/i],
  ['plante', 'M12 21v-8M12 13c0-4.2 3.2-7.2 7.4-7.2 0 4.2-3.2 7.2-7.4 7.2zM12 15.2c0-4.2-3.2-6.4-7.4-6.4 0 4.2 3.2 6.4 7.4 6.4z', /plante|jardin|nature|[ée]colo|bio|pousse|graine/i],
  // — argent
  ['billet', 'M2.5 6.5h19v11h-19zM12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z', /argent|euro|prix|tarif|payer|paiement|co[uû]t|budget|facture|revenu|salaire|marge/i],
  ['carte', 'M2.5 6h19v12h-19zM2.5 10h19M5.5 15h4', /carte bancaire|abonnement|pr[ée]l[eè]vement|mensualit/i],
  ['graphique', 'M3 20.5h18M7 17.5v-5M12 17.5V7M17 17.5v-8.5', /r[ée]sultat|croissance|progress|statistique|courbe|augment|performance|vente|conversion/i],
  ['cadeau', 'M3.5 11h17v9.5h-17zM3.5 7.2h17V11h-17zM12 7.2v13.3M12 7.2S9.6 7.2 8.6 6.2a2 2 0 1 1 3.4-2M12 7.2s2.4 0 3.4-1a2 2 0 1 0-3.4-2', /cadeau|offert|gratuit|bonus|surprise|r[ée]compense|promo/i],
  // — gens
  ['personne', 'M12 11.8a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.2 21c0-4 3.5-6 7.8-6s7.8 2 7.8 6', /client|utilisateur|abonn[ée]|[ée]l[eè]ve|patient|adh[ée]rent|coach|prof|profil|d[ée]butant/i],
  ['groupe', 'M9 11a3.4 3.4 0 1 0 0-6.8A3.4 3.4 0 0 0 9 11zM2 20.5c0-3.4 3-5 7-5s7 1.6 7 5M17 5.4a3.4 3.4 0 0 1 0 6.4M18 15.4c2.4.6 4 2.1 4 4.7', /[ée]quipe|groupe|communaut|audience|collectif|ensemble|abonn[ée]s/i],
  ['message', 'M4 4.5h16v11.5H8.5L4 20.5z', /message|commentaire|discussion|r[ée]pondre|question|[ée]change/i],
  ['enveloppe', 'M2.5 5.5h19v13h-19zM2.5 6.4l9.5 6.8 9.5-6.8', /mail|e-?mail|newsletter|courrier|inscription/i],
  ['etoile', 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z', /avis|note|[ée]toile|meilleur|premium|excellence|r[ée]put/i],
  // — temps
  ['horloge', 'M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19zM12 6.5V12l3.5 2.2', /heure|matin|soir|midi|attendre|horaire|minute/i],
  ['calendrier', 'M3.5 6h17v14.5h-17zM3.5 10.5h17M8.5 3.2v4.4M15.5 3.2v4.4', /jour|semaine|mois|planning|agenda|calendrier|s[ée]ance|rendez|cr[ée]neau/i],
  // — outils, tech
  ['telephone', 'M7 2.5h10v19H7zM10.2 18.6h3.6', /t[ée]l[ée]phone|mobile|smartphone|portable|application|appli/i],
  ['ordinateur', 'M3 5h18v11.5H3zM1.5 20h21', /ordinateur|logiciel|site|web|plateforme|tableau de bord/i],
  ['ecran', 'M2.5 4.5h19v12.5h-19zM8.5 21h7M12 17v4', /[ée]cran|t[ée]l[ée]vision|diffus|affich|projection/i],
  ['ampoule', 'M9.4 18.5h5.2M10.4 21.2h3.2M12 3.2A5.9 5.9 0 0 0 8.2 13.6v2.2h7.6v-2.2A5.9 5.9 0 0 0 12 3.2z', /id[ée]e|astuce|conseil|comprendre|apprendre|d[ée]couvrir|secret|cl[ée] du/i],
  ['engrenage', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.2 13.4a7.6 7.6 0 0 0 0-2.8l1.9-1.4-1.9-3.2-2.2.9a7.6 7.6 0 0 0-2.4-1.4L14.2 3H9.8l-.4 2.5A7.6 7.6 0 0 0 7 6.9l-2.2-.9L2.9 9.2l1.9 1.4a7.6 7.6 0 0 0 0 2.8l-1.9 1.4 1.9 3.2 2.2-.9a7.6 7.6 0 0 0 2.4 1.4l.4 2.5h4.4l.4-2.5a7.6 7.6 0 0 0 2.4-1.4l2.2.9 1.9-3.2z', /r[ée]glage|param[eè]tre|machine|appareil|moteur|syst[eè]me|configuration|automat/i],
  ['outil', 'M9.6 9.6a4.6 4.6 0 0 1 6.2-4.3l-3.1 3.1 2.3 2.3 3.1-3.1a4.6 4.6 0 0 1-5.7 5.8L5.9 20.9 3.3 18.3z', /outil|mat[ée]riel|[ée]quipement|installer|r[ée]parer|monter|bricol/i],
  ['cadenas', 'M5 11h14v10.2H5zM8 11V7.2a4 4 0 0 1 8 0V11', /s[ée]curit|prot[ée]g|priv[ée]|confidentiel|acc[eè]s|mot de passe|verrou/i],
  ['loupe', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.4-4.4', /chercher|recherche|trouver|analyser|examiner|rep[ée]rer|diagnostic/i],
  ['eclair', 'M13.2 2.5 4.5 14.2h6.4l-1 7.3 8.7-11.7h-6.4z', /rapide|instantan|imm[ée]diat|puissance|boost|acc[ée]l[ée]r|[ée]clair|explos/i],
  ['nuage', 'M6.6 19a4.5 4.5 0 0 1 .3-9 6 6 0 0 1 11.3 1.6A3.9 3.9 0 0 1 17.5 19z', /cloud|nuage|en ligne|sauvegarde|stockage|serveur/i],
  ['document', 'M6 3h8l4.2 4.2V21H6zM14 3v4.4h4.2', /document|fichier|contrat|papier|dossier|rapport|fiche|devis/i],
  ['livre', 'M4 4h6.6a3.4 3.4 0 0 1 2 3v13a2.6 2.6 0 0 0-2-1.3H4zM20 4h-6.6a3.4 3.4 0 0 0-2 3v13a2.6 2.6 0 0 1 2-1.3H20z', /livre|formation|cours|module|ebook|manuel|guide|programme/i],
  // — création, média
  ['camera', 'M3 6.5h11.5v11H3zM14.5 10.5 21 7.4v9.2l-6.5-3.1', /vid[ée]o|film|tourner|cam[ée]ra|clip|reel|short|tournage/i],
  ['photo', 'M3 5.2h18v13.6H3zM8.2 10.4a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM3 15.6l5.2-4.2 4.1 3.1 3.1-2.1 5.6 5', /photo|image|visuel|clich[ée]|miniature|illustration/i],
  ['micro', 'M12 3.2a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM6.2 11.2a5.8 5.8 0 0 0 11.6 0M12 17v3.8M9.2 20.8h5.6', /micro|voix|podcast|enregistr|audio|parler/i],
  ['musique', 'M9 18V5.2l11-2v12.6M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 15.8a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', /musique|chanson|playlist|rythme|instrumental|son de/i],
  ['pinceau', 'M12.2 3.2 18.8 9.8l-7.2 7.2-6.6-6.6zM5 16.6l-2 5 5-2', /design|dessin|cr[ée]atif|couleur|peindre|charte|graphis/i],
  // — abstraits
  ['cible', 'M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19zM12 16.8a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6zM12 13.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z', /objectif|but|cible|viser|atteindre|challenge|d[ée]fi/i],
  ['fusee', 'M12 2.2s5 3.1 5 10c0 3-1.5 5-1.5 5h-7S7 15.2 7 12.2c0-6.9 5-10 5-10zM12 11.3a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM9.2 17.4 7 21.8l3.2-1.1M14.8 17.4 17 21.8l-3.2-1.1', /lancer|d[ée]marrer|d[ée]buter|d[ée]collage|se lancer|progresser|passer au niveau/i],
  // ⚠ bornes de mot : sans elles « finition » déclenchait la coche (mesuré sur
  // le banc « salle de sport »). Un préfixe n'est pas un sens.
  ['coche', 'M4.5 12.8 9.5 18 20 6.5', /^(valid|termin|fini[es]?$|r[ée]ussi|coch[ée]|accompli)/i],
  ['croix', 'M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5', /erreur|faux|interdit|[ée]viter|probl[eè]me|arr[eê]ter|blessure/i],
  ['envoi', 'M21.5 2.8 2.5 10.2l7 3 3 7z', /envoyer|publier|poster|partager|diffuser|transmettre/i],
]

export const sujetSvg = (nom, taille, couleur, epaisseur = 1.7) => {
  const e = SUJETS.find((x) => x[0] === nom)
  if (!e) return ''
  return `<svg viewBox="0 0 24 24" width="${taille}" height="${taille}" fill="none" stroke="${couleur}"`
    + ` stroke-width="${epaisseur}" stroke-linecap="round" stroke-linejoin="round"><path d="${e[1]}"/></svg>`
}

// Le mot prononcé → le sujet à dessiner. `null` quand on ne sait pas, et c'est
// volontaire : une phrase qu'on ne sait pas illustrer ne doit pas être
// fabriquée, elle doit rester au visage ou au média.
export const sujetPour = (mot) => {
  const t = String(mot || '')
  if (t.length < 3) return null
  for (const [nom, , re] of SUJETS) if (re.test(t)) return nom
  return null
}

// Les mots qui ne portent aucune image : on ne les regarde même pas.
const VIDES = new Set(('le la les un une des du de d au aux et ou mais donc or ni car que qui quoi dont'
  + ' je tu il elle on nous vous ils elles me te se lui leur y en ce cet cette ces mon ton son ma ta sa mes tes ses'
  + ' notre votre leurs pour par avec sans sous sur dans chez vers entre apres avant pendant depuis'
  + ' etre avoir faire aller pouvoir vouloir devoir dire voir savoir venir falloir prendre mettre'
  + ' est sont etait sera ai as a ont avez avons plus moins tres trop peu bien mal deja encore jamais toujours'
  + ' tout toute tous toutes meme aussi alors puis ensuite enfin voila comme si quand parce'
  + ' oui non pas ne rien vraiment genre truc chose fois autre autres').split(/\s+/))

const sansAccent = (x) => String(x).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

// Lit une phrase et en tire les sujets DESSINABLES, dans l'ordre où ils sont
// prononcés, sans doublon. Rend [] si la phrase ne donne rien à voir.
export function sujetsDe(phrase, max = 3) {
  const out = []
  for (const brut of String(phrase || '').split(/\s+/)) {
    const m = sansAccent(brut)
    if (!m || VIDES.has(m)) continue
    const s = sujetPour(brut)
    if (!s || out.some((x) => x.sujet === s)) continue
    out.push({ sujet: s, mot: brut.replace(/[.,!?;:»«]+$/, ''), t: null })
    if (out.length >= max) break
  }
  return out
}

// Une phrase qui décrit une SUITE se montre avec des flèches, pas en vrac.
export const estUneSuite = (phrase) => /\b(d.abord|ensuite|puis|apr[eè]s [cç]a|enfin|[ée]tape|premi[eè]re?ment|deuxi[eè]me)\b/i
  .test(String(phrase || ''))

// ── LES MOUVEMENTS ────────────────────────────────────────────────────────
// Trois seulement, et c'est assez : ils sont universels. `reveal` pose UNE
// chose, `cascade` en fait défiler deux à trois, `flow` les enchaîne avec des
// flèches quand la phrase décrit une suite. Le reste de la banque garde ses
// animations dédiées ; celles-ci ne servent qu'aux phrases qu'aucune ne sait
// illustrer — c'est-à-dire, chez un client d'un autre métier, la plupart.

export function sujetHtml(s, f, P, id) {
  const sujets = (s.sujets || []).filter((x) => x && x.sujet).slice(0, 3)
  if (!sujets.length) return ''
  const n = sujets.length
  const flow = n > 1 && String(s.motion) === 'flow'
  const carte = (k, d, x, y, ic) => `<div class="an-p" id="${id}s${k}" style="left:${x}px;top:${y}px;width:${d}px;height:${d}px;`
    + `border-radius:${Math.round(d * 0.26)}px;background:${P.soft};border:2px solid ${P.line};`
    + `display:flex;align-items:center;justify-content:center;box-shadow:0 20px 44px -18px rgba(0,0,0,.28)">`
    + sujetSvg(ic, Math.round(d * 0.5), P.acc, 1.7) + '</div>'

  if (n === 1) {
    const d = Math.round(Math.min(f.w * 0.56, f.h * 0.86))
    return carte(0, d, Math.round((f.w - d) / 2), Math.round((f.h - d) / 2), sujets[0].sujet)
  }
  const gap = Math.round(f.w * (flow ? 0.075 : 0.05))
  const d = Math.min(Math.round((f.w - gap * (n - 1)) / n), Math.round(f.h * 0.82))
  const x0 = Math.round((f.w - (d * n + gap * (n - 1))) / 2)
  const y = Math.round((f.h - d) / 2)
  let h = sujets.map((x, k) => carte(k, d, x0 + k * (d + gap), y, x.sujet)).join('')
  if (flow) {
    // la flèche se dessine entre deux cartes : c'est elle qui dit « puis ».
    for (let k = 0; k < n - 1; k++) {
      const ax = x0 + (k + 1) * d + k * gap
      const ay = y + Math.round(d / 2) - Math.round(gap * 0.4)
      h += `<svg class="an-p" id="${id}f${k}" style="left:${ax}px;top:${ay}px;width:${gap}px;height:${Math.round(gap * 0.8)}px" `
        + `viewBox="0 0 24 20" fill="none" stroke="${P.mute}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">`
        + '<path d="M2 10h18M14.5 4.8 20.5 10l-6 5.2"/></svg>'
    }
  }
  return h
}

export function sujetJs(s, id, t0, r2) {
  const n = Math.min(3, (s.sujets || []).filter((x) => x && x.sujet).length)
  if (!n) return ''
  let js = ''
  if (n === 1) {
    js += `\n      tl.fromTo('#${id}s0', { scale: 0.62, rotation: -7, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.46, ease: 'back.out(1.9)', transformOrigin: '50% 50%' }, ${t0});`
    js += `\n      tl.to('#${id}s0', { scale: 1.06, duration: 0.5, ease: 'sine.inOut', yoyo: true, repeat: 1, transformOrigin: '50% 50%' }, ${r2(t0 + 0.55)});`
    return js
  }
  for (let k = 0; k < n; k++) {
    js += `\n      tl.fromTo('#${id}s${k}', { y: 56, scale: 0.8, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.7)', transformOrigin: '50% 50%' }, ${r2(t0 + k * 0.22)});`
  }
  if (String(s.motion) === 'flow') {
    for (let k = 0; k < n - 1; k++) {
      js += `\n      tl.fromTo('#${id}f${k}', { scaleX: 0.2, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.26, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(t0 + k * 0.22 + 0.3)});`
    }
  }
  // le dernier sujet pulse : c'est là que la phrase tombe.
  js += `\n      tl.to('#${id}s${n - 1}', { scale: 1.08, duration: 0.42, ease: 'sine.inOut', yoyo: true, repeat: 1, transformOrigin: '50% 50%' }, ${r2(t0 + (n - 1) * 0.22 + 0.42)});`
  return js
}

export const SUJETS_CONNUS = SUJETS.map((x) => x[0])
