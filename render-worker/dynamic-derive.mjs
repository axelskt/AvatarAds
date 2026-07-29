// ─────────────────────────────────────────────────────────────────────────────
// #148 · DÉRIVATION AUTOMATIQUE des scènes UI du style Dynamique.
//
// L'orchestrateur (edge function) reste GÉNÉRIQUE : il produit le même plan pour
// tous les styles (captions mot-à-mot, slides `screen` résolues sur les zones
// mesurées, sections, beats). Cette couche transforme ce plan en scènes UI —
// exactement le travail fait à la main pour la VSL d'Axel, devenu déterministe :
//   · les plans d'écran « prompt » (texte tapé) → barre de prompt + zoom d'envoi
//   · des DÉCLENCHEURS sur les mots de la voix (patrons français de ses scripts) :
//     avatarads.fr → navigateur, « commente X » → barre de commentaire,
//     « importe/ajoute ton… » → dropzone, « supprimer les silences » → onde,
//     « un clic » → bouton, « génère la clé » → keycopy, « connecté à » → connect,
//     « millions de vues » → compteurs, « N secondes » en hook → chrono.
//
// ⚠️ PRIORITÉ INVERSÉE (#148b, appris sur le premier vrai plan orchestrateur) :
// les scènes dérivées de la VOIX sont la colonne vertébrale — ce sont les slides
// serveur (type/target/network/steps/flow…) qui se rognent autour, jamais
// l'inverse. L'ancienne version rognait les scènes UI contre un plan dense →
// chrono/prompt/upload rejetés + chevauchements + panneaux vides. Règle d'or du
// style : UNE chose à l'écran ; tout slide serveur réduit sous 0,8 s est jeté.
//
// Pourquoi ici et pas dans l'edge function : pas de redéploiement risqué (la
// grammaire stricte a déjà mis le module à l'arrêt une fois), testable en local
// contre une vraie transcription, et le serveur n'a pas à connaître les styles.
// Gated : ne s'applique QUE si plan.slideStyle === 'dynamic'.
// ─────────────────────────────────────────────────────────────────────────────

import { ANIMS } from './anim-pack.mjs'
import { spotOf, spotForWords, zoneNamed, zoneDite, MENU_ZONES } from './screen-spots.mjs'

// L'avatar de la marque : une seule image pour le hook, les fenêtres visage et
// « ton premier avatar ». La remplacer dans assets/tuto suffit à changer l'avatar
// partout (Axel : « mets cet avatar dans le hook et comme avatar principal »).
const AVATAR_MAIN = 'hook-qualite'
// La page d'accueil de l'app : celle qu'on voit avant d'avoir cliqué où que ce soit.
const ACCUEIL = '03-generateur'
// …à ne pas confondre avec l'avatar OBTENU : « et là tu obtiens ton premier
// avatar » montre le résultat d'Images IA, pas le visage qui parle depuis le
// hook. Deux images distinctes, deux rôles distincts.
const AVATAR_RESULT = 'lena'

const r2 = (n) => Math.round(n * 100) / 100
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

// fenêtre de recherche : suite de mots normalisés → { start, end, i } du premier mot.
// Un token long (≥5) matche aussi en PRÉFIXE : « qualité-là. » (→ qualitela)
// doit répondre au motif « qualite » — les suffixes collés ne cassent pas la détection.
export function findSeq(words, pattern, from = 0) {
  const toks = pattern.split(/\s+/).map(norm).filter(Boolean)
  // LE PRÉFIXE NE SUFFIT PAS. Axel : « quand je dis formation il va dans le
  // format ». `"formation".startsWith("format")` est vrai — le plan de visite
  // guidée demandé sur « format » s'accrochait donc à « formation », prononcé
  // dix-sept secondes plus tôt, et toute la visite partait en décalage. Le
  // piège est général : « compte » attrape « compteur », « image » attrape
  // « imaginer », « vue » attrape « vueltas ».
  // On n'accepte plus qu'une VRAIE FLEXION en fin de mot — pluriel, féminin,
  // conjugaison. « formats » passe, « formation » non. Se contenter de « deux
  // caractères de plus » ne suffisait pas : « compteur » = « compte » + « ur »
  // passait encore. La liste ci-dessous est fermée, donc sans surprise.
  const FLEX = ['', 's', 'e', 'es', 'x', 'nt', 'z', 'r', 'ee', 'ees', 'ent']
  const eq = (n, tk) => n === tk ||
    (tk.length >= 5 && n.startsWith(tk) && FLEX.includes(n.slice(tk.length)))
  for (let j = from; j + toks.length <= words.length; j++) {
    if (toks.every((tk, m) => eq(norm(words[j + m].text), tk))) {
      return { start: words[j].start, end: words[j + toks.length - 1].end, i: j }
    }
  }
  return null
}
// premier mot (parmi plusieurs formes) après `from`
export function findAny(words, forms, from = 0) {
  for (let j = from; j < words.length; j++) {
    const n = norm(words[j].text)
    if (forms.some((f) => n === norm(f))) return { start: words[j].start, end: words[j].end, i: j }
  }
  return null
}

// LE MOT DU CTA EST LE SEUL QUE LE SPECTATEUR VA TAPER : il doit être écrit
// juste. Or la transcription rend un SON, pas une orthographe — « écris SITE en
// commentaire » revient en « cite ». Le contresens est fatal : personne ne
// commente « CITE ». On corrige donc les homophones dont une seule graphie se
// commente. La liste est courte et le restera : elle ne sert qu'aux mots-clés
// d'appel à l'action, pas au reste du script.
// (La correction durable viendra de la mémoire de marque, qui garde son CTA
// habituel — ici on n'a que la transcription sous la main.)
const CTA_HOMOPHONES = { cite: 'SITE', cit: 'SITE', cites: 'SITE' }
const ctaWord = (w) => CTA_HOMOPHONES[norm(w)] || w

// « trente secondes » se dit en LETTRES dans les scripts — parseInt n'y voit rien
const FR_NUMS = { un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 }
const numOf = (t) => {
  const d = parseInt(String(t).replace(/\D/g, ''), 10)
  if (d > 0) return d
  return FR_NUMS[norm(t)] || 0
}

// zones de choix de l'app : mot prononcé → cartes `pick` correspondantes
const PICKS = {
  'photo-reel': { choices: ['Photo réaliste', 'Pixar 3D', 'UGC réel'], sel: 0 },
  pixar: { choices: ['Photo réaliste', 'Pixar 3D', 'UGC réel'], sel: 1 },
  ugc: { choices: ['Photo réaliste', 'Pixar 3D', 'UGC réel'], sel: 2 },
  fruit: { choices: ['Photo réaliste', 'Fruit', 'Mascotte'], sel: 1 },
  realiste: { choices: ['Réaliste', 'Cartoon 3D'], sel: 0 },
  cartoon: { choices: ['Réaliste', 'Cartoon 3D'], sel: 1 },
  format: { choices: ['1:1', '9:16', '16:9'], sel: 1, ratio: true },
  portrait: { choices: ['Portrait 9:16', 'Paysage 16:9'], sel: 0, ratio: true },
}

// SYNCHRO : un visuel doit arriver juste AVANT le mot qu'il illustre — 0,15 s,
// le temps que l'œil l'attrape. Au-delà il tombe sur le mot de liaison d'avant
// (Axel : les scènes démarraient sur « dans », « le », « et », « qu'à »).
export const LEAD = 0.15

// ── LE VOCABULAIRE PARTAGÉ ──────────────────────────────────────────────────
// Ces tables décrivent CE QUE LA VOIX DÉSIGNE, pas comment on le dessine : elles
// valent donc pour le style Dynamique comme pour les styles classiques (apple,
// editorial, glass), qui les consomment via classic-derive.mjs.
export const MODULES = [
  { pat: ['image ia', 'images ia'], screen: '01-imagesia' },
  { pat: ['express'],               screen: '02-express' },
  { pat: ['generateur'],            screen: '03-generateur' },
  { pat: ['montage ia'],            screen: '04-montageia' },
  { pat: ['bibliotheque'],          screen: '05-bibliotheque' },
  { pat: ['nettoyage audio'],       screen: '06-nettoyage-audio' },
  { pat: ['enregistreur'],          screen: '07-enregistreur' },
  { pat: ['parrainage'],            screen: '08-parrainage' },
  // #129 · le tuto « connecter le MCP » : deux écrans de plus, récoltés comme
  // les autres. « mon compte tout en bas » puis « connecter Cloud » — Scribe
  // transcrit systématiquement « Claude » en « Cloud », donc les deux formes.
  { pat: ['mon compte'],            screen: '10-mon-compte' },
  { pat: ['connecter cloud', 'connecter claude', 'connecte claude'], screen: '11-connecter-claude' },
]
// mot prononcé → élément de l'interface (positions dans screen-spots.mjs)
export const STEP_WORDS = [
  { spot: 'cle',      w: ['cle', 'generer', 'genere', 'copie', 'copies'] },
  { spot: 'connect',  w: ['connecteurs', 'connecteur', 'connecter', 'connecte'] },
  { spot: 'style',    w: ['photo', 'reelle', 'reel', 'realiste', 'pixar', 'cartoon', 'ugc', 'mascotte', 'style', 'studio'] },
  { spot: 'format',   w: ['format', 'portrait', 'paysage', 'vertical', 'horizontal'] },
  { spot: 'duree',    w: ['duree'] },
  { spot: 'qualite',  w: ['qualite', 'premium'] },
  { spot: 'upload',   w: ['ajouter', 'ajoute', 'importer', 'importe', 'reference'] },
  { spot: 'prompt',   w: ['decrire', 'decris', 'ecrire', 'ecris', 'prompt', 'description'] },
  { spot: 'generate', w: ['genere', 'generes', 'generer', 'lance', 'lancer'] },
]
// « générer » n'est un clic sur le bouton que s'il porte sur un objet de
// l'app (« génère L'IMAGE ») — pas dans « générer DES millions de vues ».
export const GEN_OBJ = ['image', 'limage', 'video', 'lavideo', 'animation', 'lanimation', 'la', 'le', 'ma', 'ta', 'ton']
// ce qui se tape dans le champ quand la voix ne cite rien : la propre
// suggestion de l'app, donc un prompt crédible plutôt qu'un texte inventé
export const PROMPT_SAMPLE = {
  '01-imagesia': 'Entrepreneur en studio moderne, face caméra',
  '02-express': 'Il présente son outil face caméra, ton punchy',
}
// mot prononcé → animation qui l'ILLUSTRE. `pad` = combien de temps elle tient
// l'écran après le mot (une clause longue a besoin de plus qu'un mot isolé).
export const VOICE_ANIMS = [
  { w: ['signent', 'signe', 'signer', 'contrat', 'contrats'],                           anim: 'sign', pad: 2.4 },
  { w: ['marque', 'marques', 'client', 'clients', 'communaute', 'audience', 'abonnes'], anim: 'network' },
  { w: ['euros', 'argent', 'prix', 'paye', 'payer', 'gagner'],                          anim: 'money' },
  { w: ['vues', 'millions', 'viral', 'virale', 'croissance', 'grandir'],                anim: 'grow' },
  { w: ['fake', 'faux', 'realisme', 'realiste'],                       anim: 'compare', pad: 2.1, photo: 'hook-qualite' },
  { w: ['outils', 'outil', 'methode', 'technique', 'strategie'], anim: 'tools', pad: 2.0, assets: ['logo-avatarads'] },
  { w: ['secondes', 'minutes', 'rapide', 'vite'],                                       anim: 'clock' },
  { w: ['idee', 'idees', 'creatif', 'inspiration'],                                     anim: 'idea' },
  { w: ['cible', 'objectif', 'but', 'resultat', 'resultats'],                           anim: 'target' },
]

export function deriveDynamicSlides(plan, opts = {}) {
  // apple partage ce moteur (cf. build-composition) : sans lui ouvrir la porte
  // ici, il recevait le plan BRUT — 19 panneaux au lieu de 14, captures non
  // pilotées, animations non ancrées. La peau était claire, la matière non.
  if (plan.slideStyle !== 'dynamic' && plan.slideStyle !== 'apple') return
  const words = (plan.captions || [])
    .filter((c) => String(c.text || '').trim())
    .map((c) => ({ text: String(c.text).trim(), start: r2(c.start), end: r2(c.end) }))
    .sort((a, b) => a.start - b.start)
  if (!words.length) return
  const D = r2(plan.duration || (words[words.length - 1].end + 0.5))
  const out = []
  const taken = []        // fenêtres occupées, pour ne jamais superposer deux scènes
  const overlaps = (a, b) => taken.some((w) => a < w[1] - 0.05 && b > w[0] + 0.05)
  const claim = (a, b) => { taken.push([a, b]) }
  const consumed = new Set() // slides serveur transformées (promptbar…) → à retirer

  // Une scène qui déborde sur une fenêtre déjà prise est ROGNÉE, pas jetée —
  // mais seulement contre les AUTRES scènes dérivées (la voix prime le serveur).
  // Renvoie la scène RÉELLEMENT posée (fenêtre déjà rognée) ou null : l'appelant
  // peut ainsi recaler son contenu — les étapes d'une démo qui tomberaient hors
  // du panneau sont écartées au lieu de s'afficher dans le vide.
  // la fenêtre RÉELLEMENT disponible pour [a,b] — celle qu'`add` retiendra.
  // L'appelant peut ainsi juger de la place AVANT de poser (une animation
  // rognée à 0,9 s ne vaut pas la peine d'être posée).
  const fit = (a, b) => {
    for (const w of taken) {
      if (a < w[0] && b > w[0]) b = w[0] - 0.05
      if (a >= w[0] && a < w[1]) a = w[1] + 0.05
    }
    return [a, b]
  }
  // UNE ANIMATION QUI DURE MOINS D'UNE SECONDE N'EST PAS UNE SCÈNE, C'EST UN
  // FLASH : elle n'a le temps ni d'entrer (0,2 s), ni de jouer, ni de sortir
  // (0,18 s) — on voit un objet immobile apparaître et disparaître. Axel, sur
  // l'horloge de « en deux minutes », rognée à 0,9 s par la scène suivante :
  // « je ne suis pas fan, supprime ». Ce n'est pas le chronomètre le problème,
  // c'est le clignement. Les captures et les scènes UI, elles, restent lisibles
  // court : elles montrent quelque chose d'immobile.
  const isAnimPanel = (s) => Boolean(s.anim) && s.anim !== 'ui' && s.anim !== 'screen' && s.anim !== 'result'
  const add = (slide, a, b) => {
    ;[a, b] = fit(a, b)
    // SON MEDIA A DROIT AU FLASH. Une enumeration — « homme, femme, coach
    // sportif » — laisse 0,4 s par mot : au plancher commun, les deux dernieres
    // photos disparaissaient et l'enumeration retombait sur du texte. Une photo
    // vue 0,4 s sur SON mot vaut mieux qu'une photo juste, jetee.
    const floor = slide.anim === 'media' ? 0.35 : isAnimPanel(slide) ? 1.25 : 0.8
    if (b - a < floor) {
      if (isAnimPanel(slide) && b - a > 0.2) console.log(`▶ ${slide.anim} écarté : ${r2(b - a)}s, trop court pour être vu`)
      return null
    }
    if (overlaps(a, b)) return null
    const s = { ...slide, start: r2(a), end: r2(b) }
    out.push(s)
    claim(a, b); return s
  }

  // ── 0 · LE CHEF D'ORCHESTRE PASSE EN PREMIER ────────────────────────────────
  // Il était purement et simplement ignoré. §4 contenait une ligne qui jetait
  // TOUTE animation serveur sans texte — or une scène d'animation n'a JAMAIS de
  // texte, c'est son principe : l'animation EST le visuel. Cent pour cent de ses
  // propositions tombaient là. Ensuite mes tables de mots-clés (§1) réservaient
  // les fenêtres restantes. Mesuré sur Cartoon 15 : 0 de ses 18 scènes dans la
  // vidéo finale, tout venait de listes écrites à la main pour le vocabulaire
  // d'AvatarAds. Sur l'audio d'une autre marque, ces listes ne trouvent rien.
  //
  // Il choisit maintenant, et mes tables ne comblent plus que ce qu'il a laissé
  // vide. C'est ce qui rend le montage indépendant du vocabulaire : lui LIT la
  // phrase, une liste de mots-clés ne fait que la reconnaître.
  //
  // Les captures (`screen`) et les scènes d'interface (`ui`) restent pour §1/§2 :
  // le moteur dynamique les rejoue au clic, avec curseur et cadrage — une version
  // strictement plus riche de ce que le serveur sait exprimer.
  const consumedByPlan = new Set()
  let placeServerText = () => {}
  let placeServerAnims = () => {}
  let placeLocalAnims = () => {}

  // ── 0 · LE HOOK EST UN VISAGE ───────────────────────────────────────────────
  // Une vidéo face caméra s'ouvre sur celui qui parle, pas sur une forme. La
  // fenêtre avatar du début était calculée en §3b, DANS LES ZONES LIBRES : les
  // animations du chef d'orchestre l'occupaient déjà et le hook sautait — Axel,
  // sur Cartoon 16 : « le hook je le vois plutôt en split screen avec Alex en
  // bas ». Elle est donc réservée en premier, avant tout le reste.
  let hookWin = null
  {
    const s0 = (plan.avatarSegments || [])[0]
    if (s0 && (s0.start || 0) < 0.6) {
      const a = r2(s0.start || 0)
      const b = r2(Math.min(s0.end ?? a + 4, a + 6.5, D))
      if (b - a >= 1.2) { hookWin = { start: a, end: b }; claim(a, b) }
    }
  }

  // ── 0a · LES MÉDIAS DE L'UTILISATEUR PASSENT AVANT TOUT ─────────────────────
  // Le moteur dynamique ignorait purement et simplement `plan.broll` : ses
  // images et ses vidéos n'entraient JAMAIS dans ce style (le b-roll vidéo de
  // #111 n'avait été branché que sur le chemin classique). Axel, sur Cartoon 16 :
  // « quand je parle de la qualité image / vidéo, ajoute cette vidéo en fond ».
  // Sa vidéo montre le résultat ; aucune animation fabriquée ne fait mieux que
  // ça. Elle passe donc devant, y compris devant le chef d'orchestre.
  {
    const files = opts.assetFiles || {}
    let n = 0, med = 0
    // ── UNE ÉNUMÉRATION = UN PANNEAU, PAS TROIS ────────────────────────────────
    // « Homme, femme, coach sportif » : trois mots en 1,3 s. Une photo par mot
    // donnerait des panneaux de 0,3 s — plus courts que la transition elle-même
    // (0,42 s), donc jamais vus, et le moteur les écartait un par un. La bonne
    // lecture d'une énumération, c'est de TOUT montrer en même temps et
    // d'allumer chaque photo sur SON mot. Le visuel reste le mot, et il tient.
    const brut = (plan.broll || []).slice().sort((a, c) => (a.start || 0) - (c.start || 0))
      .filter((b) => files[b.assetId])
    const paquets = []
    for (const b of brut) {
      const p = paquets[paquets.length - 1]
      if (p && b.start - p[0].start < 2.5 && b.start - p[p.length - 1].start < 1.2) p.push(b)
      else paquets.push([b])
    }
    for (const grp of paquets) {
      if (grp.length < 2) continue
      // LE PANNEAU S'OUVRE AVANT LE PREMIER MOT. La transition de ce moteur dure
      // 0,42 s : ouvert PILE sur « Homme », le panneau glisse encore quand le mot
      // est déjà passé, et les trois allumages arrivaient un demi-temps en retard.
      // Il entre donc pendant le silence qui précède, et le premier mot tombe sur
      // un panneau déjà en place.
      const a = r2(Math.max(0, grp[0].start - 0.6))
      const e = r2(Math.max(grp[grp.length - 1].end, a + 2.2))
      const items = grp.map((b) => ({ src: files[b.assetId], assetId: b.assetId, t: r2(b.start) }))
      if (add({ anim: 'medias', items, count: items.length }, a, e)) {
        for (const b of grp) b.__pose = true
        n += grp.length
        console.log(`▶ énumération : ${grp.length} photos sur un seul panneau (${a}→${e}s)`)
      }
    }
    for (const b of brut) {
      if (b.__pose) continue
      const src = files[b.assetId]
      if (!src) continue
      const a = r2(b.start || 0), e = r2(b.end ?? a + 3)
      // EN MÉDAILLON SUR LE VISAGE, PAS À LA PLACE DU VISAGE. Quand son média
      // tombe pendant une fenêtre avatar — le hook, typiquement — le poser en
      // panneau coupe la personne qui parle, et il se faisait de toute façon
      // repousser APRÈS la fenêtre : sa vidéo d'influenceuse arrivait 2 s après
      // la phrase qui la nomme. Axel : « tu gardes l'avatar principal qui parle
      // et tu ajoutes la vidéo en plus petit ». Elle s'accroche donc à la
      // fenêtre au lieu de lui disputer l'écran.
      const hote = (hookWin && a < hookWin.end - 0.3 && e > hookWin.start + 0.3) ? hookWin
        : (plan.avatarSegments || []).find((w) => a < (w.end || 0) - 0.3 && e > (w.start || 0) + 0.3)
      if (hote) {
        ;(hote.insets = hote.insets || []).push({ src, assetId: b.assetId, start: a, end: r2(Math.min(e, hote.end)) })
        med++
        continue
      }
      if (add({ anim: 'media', src, assetId: b.assetId, hero: !!b.hero }, a, e)) n++
    }
    if (n) console.log(`▶ ${n} média(s) de l'utilisateur posé(s) en fond`)
    if (med) console.log(`▶ ${med} média(s) en médaillon sur l'avatar qui parle`)
  }

  // ── 0b · QUAND IL S'ADRESSE À TOI, ON MONTRE LE VISAGE ──────────────────────
  // (AVANT les phrases fortes ci-dessous : « maintenant, pour créer ton
  //  influenceur IA » suit immédiatement « ton lien bio », et l'animation du
  //  lien débordait sur l'annonce. La fenêtre du visage se réserve donc en
  //  premier, l'animation prend ce qui reste devant elle.)
  // Axel, sur cette vidéo : « "produit physique, coaching, formation, c'est toi
  // qui vois" → je dois voir mon avatar principal », et « quand je dis
  // "maintenant pour créer ton influenceur IA", l'avatar principal doit
  // apparaître ». Les deux ont la même forme : la voix ne DÉSIGNE plus rien
  // qu'on puisse montrer — elle rend la main au spectateur, ou elle annonce la
  // suite. Toute illustration y est arbitraire (l'écran affichait une fiche
  // produit à 39 € pendant qu'il énumérait des métiers). Un visage, lui, est
  // toujours juste sur une adresse directe : c'est le moment de respirer.
  const adresses = []
  {
    // ces tournures ferment une énumération ou ouvrent un chapitre
    const FERME = [['cest', 'toi', 'qui', 'vois'], ['cest', 'comme', 'tu', 'veux'],
      ['a', 'toi', 'de', 'voir'], ['peu', 'importe'], ['cest', 'toi', 'qui', 'decides']]
    const OUVRE = [['maintenant'], ['desormais'], ['place', 'a'], ['on', 'passe', 'a']]
    const n = (w) => norm(String(w && w.text || ''))
    const suite = (i, seq) => seq.every((tk, k) => words[i + k] && n(words[i + k]) === tk)
    for (let i = 0; i < words.length; i++) {
      for (const seq of FERME) {
        if (!suite(i, seq)) continue
        // …et on remonte au DÉBUT de la phrase qu'elle conclut : l'énumération
        // entière est le moment, pas ses trois derniers mots.
        let a = i
        for (let k = i - 1; k >= 0 && i - k < 14; k--) {
          if (/[.!?]$/.test(String(words[k].text)) || words[k + 1].start - words[k].end > 0.34) break
          a = k
        }
        const deb = Math.max(0, words[a].start - 0.15)
        const fin = Math.min(D, words[i + seq.length - 1].end + 0.35)
        if (fin - deb >= 1.2) adresses.push([deb, Math.min(fin, deb + 6.5)])
        break
      }
      for (const seq of OUVRE) {
        if (!suite(i, seq) || i < 3) continue
        // …jusqu'à la fin de la proposition qu'elle ouvre (la virgule suivante)
        let e = i
        for (let k = i + 1; k < words.length && k - i < 12; k++) {
          e = k
          if (/[,.!?]$/.test(String(words[k].text))) break
        }
        const deb = Math.max(0, words[i].start - 0.2)
        const fin = Math.min(D, words[e].end + 0.3)
        if (fin - deb >= 1.2) adresses.push([deb, Math.min(fin, deb + 6.5)])
        break
      }
    }
    let n2 = 0
    for (const [a, b] of adresses.sort((x, y) => x[0] - y[0])) {
      if (overlaps(a, b)) continue
      ;(plan.avatarSegments = plan.avatarSegments || []).push({ start: r2(a), end: r2(b), adresse: true })
      claim(a, b); n2++
    }
    if (n2) console.log(`▶ ${n2} adresse(s) directe(s) : le visage reprend l'écran`)
  }


  // ── 0a-bis · « LE LIEN EN BIO » EST UNE PHRASE, PAS UNE DEVINETTE ───────────
  // Le chef d'orchestre posait ici un ENTONNOIR — trois barres chiffrées
  // 1000 / 240 / 38 qu'Axel n'a pas comprises (« c'est quoi ça, on comprend
  // rien ») — et, deux phrases plus tôt, une simple carte de texte
  // « AJOUTE UN LIEN ». Or la voix dit exactement ce qu'il faut montrer :
  // « ajouter un lien dans ta bio », puis « rediriger cette audience vers ton
  // lien bio ». Une phrase aussi explicite bat n'importe quelle interprétation,
  // donc elle réserve sa fenêtre avant tout le monde. Deux occurrences = deux
  // animations différentes : le profil et son lien, puis le doigt qui appuie
  // dessus (« mets le deuxième lien en bio que tu as créé »).
  {
    const n = (w) => norm(String(w && w.text || ''))
    const SUITES = [['lien', 'dans', 'ta', 'bio'], ['lien', 'dans', 'la', 'bio'], ['lien', 'en', 'bio'],
      ['lien', 'bio'], ['lien', 'dans', 'ma', 'bio'], ['lien', 'de', 'la', 'bio']]
    const vus = []
    for (let i = 0; i < words.length; i++) {
      const seq = SUITES.find((q) => q.every((tk, k) => words[i + k] && n(words[i + k]) === tk))
      if (!seq) continue
      if (vus.length && i - vus[vus.length - 1] < 6) continue     // même mention, deux fois
      vus.push(i)
      const fin = words[i + seq.length - 1]
      const a = Math.max(0, words[i].start - LEAD - 1.6)
      const b = Math.min(D, fin.end + 1.9)
      const quoi = vus.length % 2 === 1 ? 'bio' : 'linkbio'
      if (add({ anim: quoi }, a, b)) console.log(`▶ « ${seq.join(' ')} » → animation ${quoi} (${r2(a)}s)`)
      i += seq.length
    }
  }

  {
    // certaines animations ont besoin d'un visuel : le comparatif veut un vrai
    // visage, `tools` veut le logo. Le serveur ne connaît pas ces fichiers.
    const NEEDS = {}
    for (const v of VOICE_ANIMS) {
      if (v.photo || v.assets) NEEDS[v.anim] = { ...(v.photo ? { photo: v.photo } : {}), assets: v.assets || [v.photo] }
    }
    const srv = (plan.slides || []).slice().sort((a, b) => (a.start || 0) - (b.start || 0))
    const isAnim = (sl) => {
      const an = String(sl.anim || '')
      return an && an !== 'screen' && an !== 'ui' && ANIMS.includes(an)
    }
    // TOUTES SES ANIMATIONS, SANS EXCEPTION. Axel : « je veux 100 % de ses
    // scènes ». Elles passent avant ses propres cartes de section — de longues
    // bannières héritées du mode classique, dont une seule couvre parfois 12 s
    // et cinq animations. Sur un écran qui ne montre qu'une chose à la fois,
    // c'est l'animation qui gagne.
    //
    // MAIS APRÈS LES DÉMOS D'INTERFACE (§1). Le partage est net : le chef
    // d'orchestre sait proposer une ANIMATION, il ne sait pas proposer une
    // visite guidée de l'app — curseur, cadre sur le bouton nommé, texte tapé.
    // Sur Cartoon 16 il posait `network` sur « connecter » et `lock` sur
    // « la clé », là où Axel voulait l'écran : « il faut qu'il aille sur
    // AvatarAds montrer connecter Claude ». Une vraie capture bat une forme.
    // SA VISITE GUIDÉE FAIT FOI. Dès qu'il a écrit un parcours (`tuto`), ses
    // captures sont posées AVANT mes tables : c'est lui qui a lu la phrase et
    // qui dispose des minutages, mes MODULES ne font que reconnaître des mots.
    // Sans ça, ses 6 captures du tuto MCP se faisaient manger par mes visites
    // guidées locales — 4 sur 6 absorbées.
    // SA VISITE GUIDÉE, REJOUÉE AU CLIC. Le serveur pose une capture par étape,
    // sans `steps` : le moteur affichait donc l'écran ENTIER, en petit. Axel :
    // « il faut faire les zooms ». On reconstruit les étapes depuis `plan.tuto`
    // — chacune calée sur l'instant EXACT où le mot est prononcé, ce qui règle
    // la synchro en même temps que le cadrage.
    // « ET TU COPIES CETTE CLÉ » → la clé se copie et S'ENVOLE VERS L'AUTRE OUTIL.
    // La visite guidée y cadrait le bouton « Ouvrir Claude → Connecteurs » : un
    // bouton ne dit pas qu'on EMPORTE quelque chose, et Axel : « quand je dis tu
    // copies cette clé, tu peux faire une animation, ça fait la transition avec
    // Claude ». Posée AVANT la visite guidée, elle lui prend la fenêtre.
    {
      const c = findAny(words, ['copies', 'copie', 'copier', 'copie-la', 'recuperes', 'recupere'], 0)
      const obj = c ? words.slice(c.i + 1, c.i + 4).map((w) => norm(w.text)) : []
      if (c && obj.some((w) => ['cle', 'clef', 'lien', 'token', 'url', 'adresse', 'code'].includes(w))) {
        // elle tient l'écran jusqu'à la PROCHAINE ÉTAPE de la visite guidée :
        // entre les deux, la voix dit « puis tu vas te rendre dans… » — c'est
        // exactement le trajet vers l'autre outil que l'animation raconte.
        // …et elle rend la main juste avant, sans mordre sur son amorce. On prend
        // la PLUS PROCHE des étapes suivantes : parcourir la liste dans l'ordre
        // tombait sur « Cloud », qui revient plus loin dans « les paramètres
        // Cloud » — l'animation s'étirait alors par-dessus le zoom d'après.
        let stop = D
        for (const t of plan.tuto || []) {
          const w = String(t.word || '')
          const h = findSeq(words, w, c.i + 1) || findAny(words, [w], c.i + 1)
          if (h && h.start > c.end + 0.8) stop = Math.min(stop, h.start - LEAD - 0.12)
        }
        if (add({ anim: 'copy', assets: ['logo-claude'] }, Math.max(0, c.start - LEAD), Math.min(D, stop, c.end + 3))) {
          console.log(`▶ la clé se copie et part vers l'autre outil (${r2(c.start)}s)`)
        }
      }
    }

    const guided = (plan.tuto || []).length >= 2
    let placedScreens = 0
    if (guided) {
      for (const sl of srv) if (sl.anim === 'screen') consumedByPlan.add(sl)   // les siennes cèdent la place
      // ON CLIQUE D'ABORD. Axel : « le premier screen doit être en bas sur
      // "mon compte" ». Quand la voix nomme une entrée de la barre latérale et
      // que le parcours saute directement au contenu, on rétablit le clic : sans
      // lui le spectateur est téléporté et ne saura pas où trouver le bouton.
      const tuto = plan.tuto.slice()
      {
        // Certaines entrées ne sont PAS dans la barre latérale : « Connecter
        // Claude » vit au fond de la modale Mon compte. Axel : « il arrive déjà
        // sur la page donc ne montre pas où aller ». Elles ont donc leur propre
        // capture, et c'est elle qu'on montre avant d'ouvrir l'écran.
        const NAV = [['mon compte', 'mon-compte'], ['images ia', 'images-ia'], ['express', 'express'],
          ['montage ia', 'montage-ia-beta'], ['bibliotheque', 'bibliotheque'], ['generateur', 'generateur'],
          ['connecter claude', 'connecter-claude', '12-connecter-claude-entree'],
          ['connect cloud', 'connecter-claude', '12-connecter-claude-entree'],
          ['connect claude', 'connecter-claude', '12-connecter-claude-entree']]
        for (const [phrase, zone, ownScreen] of NAV) {
          const hit = findSeq(words, phrase)
          if (!hit || tuto.some((t) => t.zone === zone)) continue
          const after = tuto.find((t) => {
            const h = findSeq(words, String(t.word || '')) || findAny(words, [String(t.word || '')])
            return h && h.start > hit.start
          })
          if (!after) continue
          // l'entrée de menu se montre sur l'écran où elle se trouve : la barre
          // latérale est la même sur toutes les captures de l'app, mais une
          // entrée enfouie dans une modale a la sienne.
          const host = ownScreen || '01-imagesia'
          if (!zoneNamed(host, zone)) continue
          tuto.splice(tuto.indexOf(after), 0, { word: phrase, screen: host, zone, text: '' })
          console.log(`▶ clic rétabli sur « ${phrase} » avant l'ouverture de l'écran`)
        }
      }

      // chaque étape retrouve son mot dans la transcription.
      //
      // ⚠ CHRONOLOGIQUEMENT. Une visite guidée se déroule dans l'ordre, et un
      // mot d'interface se répète : « Ajouter » est dit à 24,4 s (le bouton de
      // la liste) PUIS à 33,1 s (celui du formulaire). Sans curseur, les deux
      // étapes se calaient sur la première occurrence — la seconde tombait hors
      // de son panneau et disparaissait, laissant trois secondes de vide.
      // Le repli global reste, pour un mot qu'on n'aurait pas trouvé plus loin.
      //
      // La transcription écrit aussi ce qu'elle entend : « Connect » pour
      // « connecteurs ». On accepte donc qu'un des deux mots soit le préfixe de
      // l'autre, à partir de cinq lettres — sans quoi l'étape est perdue.
      const like = (w, from) => {
        const tk = norm(w)
        if (tk.length < 5) return null
        for (let j = from; j < words.length; j++) {
          const n = norm(words[j].text)
          if (n.length >= 5 && (n.startsWith(tk) || tk.startsWith(n))) return { start: words[j].start, end: words[j].end, i: j }
        }
        return null
      }
      const steps = []
      let cur = 0, dernierMot = -1
      for (const t of tuto) {
        const zone = zoneNamed(t.screen, t.zone)
        if (!zone) continue
        const w = String(t.word || '')
        const hit = findSeq(words, w, cur) || findAny(words, [w], cur) || like(w, cur)
          || findSeq(words, w) || findAny(words, [w]) || like(w, 0)
        if (!hit) continue
        // DEUX CADRES SUR DEUX MOTS COLLÉS, C'EST UN CADRE DE TROP. Le plan
        // demandait « Image » puis « IA » — deux mots d'un même nom d'onglet —
        // et la caméra sautait aussitôt ailleurs, sur une zone qui n'avait rien
        // à voir (Axel : « pourquoi il montre "Génération" alors que je ne
        // parle pas de génération ? »). Le premier des deux suffit.
        if (dernierMot >= 0 && hit.i - dernierMot <= 1) continue
        dernierMot = hit.i
        if (hit.i >= cur) cur = hit.i + 1
        // UN ZOOM SE JUSTIFIE PAR CE QUI EST DIT.
        // Sur « tu vas aller dans Connecter Claude », il proposait un cadre sur
        // le bouton « Commencer » de la 3ᵉ carte — Axel : « le moment où je dis
        // tu vas générer la clé affiche l'étape 3 alors qu'elle est censée
        // montrer l'étape 1 ». Ce mot-là NOMME L'ÉCRAN, il ne désigne aucun
        // bouton : on arrive, on regarde la page entière, et on plongera au
        // bouton suivant. On confronte donc les mots prononcés autour du repère
        // aux libellés lus à l'écran : si un AUTRE élément correspond mieux,
        // c'est lui ; si rien ne correspond et que le libellé proposé n'a aucun
        // mot en commun avec la phrase, on garde l'écran sans zoom.
        const said = words.slice(Math.max(0, hit.i - 2), hit.i + 4).map((x) => x.text)
        // ── LE CADRE DOIT ÊTRE JUSTIFIÉ PAR CE QUI EST DIT ────────────────────
        // Axel : « pourquoi il montre encadré "Génération" alors que je ne parle
        // pas de génération ? ». Le plan avait proposé cette zone sur le mot
        // « IA », et on la posait sans jamais vérifier. Trois cas, dans l'ordre :
        //  1. la voix désigne clairement une AUTRE zone → c'est elle ;
        //  2. le libellé du plan se retrouve dans la phrase → on le garde ;
        //  3. ni l'un ni l'autre → AUCUN cadre. L'écran entier reste vrai ; un
        //     encadré qui contredit la voix, non.
        // Une étape qui TAPE garde toujours sa cible : elle désigne un champ.
        // Un libellé sans mot exploitable (« 9:16 ») échappe au test 2 : on ne
        // peut pas le juger, on fait confiance au plan.
        const estNav = (z) => MENU_ZONES.includes(String(z && z.name || ''))
        // …sur une fenêtre SERRÉE. Avec six mots, « le format neuf seize » lisait
        // déjà « puis décris simplement » et se faisait remplacer par le champ de
        // description : le cadre partait une phrase trop loin.
        // …et elle S'ARRÊTE À LA FIN DE LA PHRASE. « le format neuf seize. Puis
        // décris… » : sans cette coupure, le cadre du format se faisait remplacer
        // par le champ de description, une phrase trop tôt.
        const proche = []
        for (let k = Math.max(0, hit.i - 1); k < Math.min(words.length, hit.i + 3); k++) {
          if (k > hit.i && /[.!?]$/.test(String(words[k - 1].text))) break
          proche.push(words[k].text)
        }
        const alt = spotForWords(t.screen, proche, { sansMenu: true, min: 0.55 })
        // LE PLAN GARDE SA ZONE PAR DÉFAUT : c'est lui qui a lu la phrase. On ne
        // la remplace que si la voix en désigne clairement une autre.
        let spot = zone
        if (alt && alt.label !== zone.label && !estNav(zone)) spot = alt
        // ON CLIQUE DEPUIS LA PAGE OÙ L'ON EST. Un cadre sur « Images IA » posé
        // sur la capture DE la page Images IA montre un bouton déjà ouvert : on
        // est arrivé avant d'avoir cliqué. Axel : « ça serait mieux qu'il zoome
        // sur Images IA depuis le Générateur ». Le Générateur est la page
        // d'accueil de l'app : c'est de là qu'on part, et l'écran d'après montre
        // la destination — le trajet devient lisible.
        let ecran = t.screen
        if (spot && MENU_ZONES.includes(String(spot.name || '')) && ecran !== ACCUEIL
          && zoneNamed(ACCUEIL, spot.name)) {
          ecran = ACCUEIL
          spot = zoneNamed(ACCUEIL, spot.name)
        }
        steps.push({ screen: ecran, t: r2(Math.max(0, hit.start - LEAD)), end: hit.end,
          spot, ...(t.text ? { type: String(t.text) } : {}) })
      }
      // ── CE QU'IL NOMME PENDANT LA CAPTURE OBTIENT SON CADRE ─────────────────
      // Axel : « quand je dis "ainsi que ton audio", il montre "Ma vidéo" ». Le
      // plan n'avait pas prévu d'étape pour « audio » : la caméra restait donc
      // sur le champ précédent pendant qu'il parlait d'autre chose. Ici on relit
      // la transcription entre deux étapes : dès qu'un mot désigne clairement un
      // élément de l'écran affiché, il obtient son propre cadre. C'est la même
      // règle que partout ailleurs — le visuel EST le mot — appliquée aux
      // champs de l'interface.
      steps.sort((a, b) => a.t - b.t)
      {
        let ajouts = 0
        for (let k = 0; k < steps.length; k++) {
          const st = steps[k], suiv = steps[k + 1]
          if (suiv && suiv.screen !== st.screen) continue
          const borne = suiv ? suiv.t : st.end + 2.6
          for (let j = 0; j < words.length; j++) {
            const w = words[j]
            if (w.start <= st.end + 0.15 || w.start >= borne - 0.5) continue
            // LE CADRE TOMBE SUR LE MOT QUI LE JUSTIFIE, PAS SUR SON VOISIN.
            // En cherchant sur une fenêtre de quatre mots, le cadre s'ancrait au
            // PREMIER de la fenêtre : « ainsi que ton audio » encadrait le champ
            // de la voix off dès « ainsi », presque une seconde avant le mot.
            // On teste donc le mot SEUL d'abord ; la fenêtre ne sert que de repli
            // pour les libellés qui demandent deux mots (« mot par mot »).
            let z = spotForWords(st.screen, [w.text], { sansMenu: true, min: 1.2 })
            if (!z) {
              const duo = words.slice(j, j + 2).map((x) => x.text)
              z = spotForWords(st.screen, duo, { sansMenu: true, min: 1.6 })
            }
            if (!z || (st.spot && z.label === st.spot.label)) continue
            if (steps.some((o) => Math.abs(o.t - (w.start - LEAD)) < 0.8)) continue
            steps.push({ screen: st.screen, t: r2(Math.max(0, w.start - LEAD)), end: w.end, spot: z })
            ajouts++
            break                                  // un cadre par intervalle suffit
          }
        }
        if (ajouts) { steps.sort((a, b) => a.t - b.t); console.log(`▶ ${ajouts} cadre(s) ajouté(s) sur ce qu'il nomme`) }
      }
      // on regroupe les étapes CONSÉCUTIVES sur le même écran : un panneau par
      // écran visité, la caméra s'y déplace d'un élément à l'autre
      let i = 0
      while (i < steps.length) {
        let j = i
        while (j + 1 < steps.length && steps[j + 1].screen === steps[i].screen) j++
        const a = r2(Math.max(0, steps[i].t - 0.05))
        const b = r2(Math.min(D, steps[j].end + (steps[j].type ? 1.6 : 0.9)))
        const sl = add({ anim: 'screen', screen: steps[i].screen }, a, b)
        if (sl) {
          // UNE ÉTAPE RECALÉE VAUT MIEUX QU'UNE ÉTAPE PERDUE. `add` peut décaler
          // le début du panneau (la scène précédente occupe encore la place) :
          // les étapes situées avant ce nouveau début étaient purement jetées,
          // et l'écran restait figé pendant que la voix décrivait des clics.
          // Elles sont désormais ramenées au bord du panneau, dans l'ordre.
          // LE CADRE ATTEND QUE L'ÉCRAN SOIT ARRIVÉ. Les panneaux se poussent en
          // 0,42 s : un zoom programmé à l'ouverture se jouait pendant que la
          // capture glissait encore, et on ne voyait pas le clic (« il zoome sur
          // Images IA » — mais trop tôt pour être lu). Le premier cadre tombe
          // donc à la fin de la poussée ; les suivants gardent leur mot.
          let borne = r2(sl.start + 0.42)
          sl.steps = steps.slice(i, j + 1)
            .filter((st) => st.t < sl.end - 0.25)
            .map(({ t, spot, type }) => {
              const tt = Math.max(t, borne)
              borne = r2(tt + 0.35)
              return { t: r2(Math.min(tt, sl.end - 0.3)), spot, ...(type ? { type } : {}) }
            })
            .filter((st) => st.t < sl.end - 0.25)
          if (sl.steps.length) placedScreens++
        }
        i = j + 1
      }
      if (placedScreens) console.log(`▶ visite guidée : ${placedScreens} écran(s), ${steps.length} étape(s) au clic`)
    }

    // « TU VAS ALLER SUR AVATARADS.FR » EST UNE NAVIGATION, PAS UN LOGO.
    // Le chef d'orchestre y posait son animation `logo` — un grand mot au
    // milieu de l'écran. Axel : « quand je dis tu vas aller sur AvatarAds, tu
    // dois aller sur internet avec le bruit de clavier, avec la LP qui s'affiche
    // après ». Le navigateur qui tape l'adresse et charge la page montre le
    // geste ; le logo ne montre qu'un nom. Il passe donc devant.
    //
    // Ce qui déclenche la scène, c'est LE GESTE ANNONCÉ (« tu vas aller sur… »),
    // pas la forme du mot : la transcription entend « AvatarAds », jamais
    // « avatarads.fr » — le « point F R » se perd dans le mot précédent. Chercher
    // un nom de domaine ne trouvait donc rien. On lit le verbe, puis on prend ce
    // qui suit « sur » : ça vaut pour « rends-toi sur Canva » comme pour nous.
    // …et « CRÉER TON COMPTE SUR X » est aussi une navigation. Axel : « au lieu
    // de montrer "écris avatarads.fr", mets une page qui cherche et va sur le
    // site, avec le bruit du clavier, et après ça affiche la LP — la visite
    // guidée doit commencer d'ici ». Sans ces verbes, la seule occurrence
    // reconnue était le « va sur avatarads.fr » de la toute fin, que la carte
    // de CTA mange : le navigateur ne jouait jamais.
    const GO = ['aller', 'va', 'vas', 'rends', 'rendre', 'rendez', 'direction', 'connecte',
      'creer', 'cree', 'crees', 'inscris', 'inscrire', 'commence', 'commencer', 'compte']
    for (let j = 1; j < words.length - 1; j++) {
      if (norm(words[j].text) !== 'sur') continue
      const verb = words.slice(Math.max(0, j - 3), j).findIndex((w) => GO.includes(norm(w.text)))
      if (verb < 0) continue
      const from = words[Math.max(0, j - 3) + verb]      // « tu VAS aller sur… »
      const site = words[j + 1]
      if (!site || norm(site.text).length < 3) continue
      let a = Math.max(0, from.start - LEAD)
      // la scène s'arrête net avant la phrase suivante : après « AvatarAds » il
      // enchaîne sur le compte, et le navigateur n'a plus rien à raconter
      const next = words.find((w) => w.start > site.end + 0.35)
      const b = Math.min(D, next ? next.start - LEAD : site.end + 3.2, site.end + 3.2)
      // …et elle PREND le blanc qui la précède (jusqu'à 1,3 s). Les panneaux se
      // poussent l'un l'autre : un trou n'affiche pas du vide, il laisse la scène
      // d'avant s'attarder — la vidéo de la fille débordait ainsi sur « pour
      // commencer ». Ici le navigateur s'ouvre dès l'écran libre, et l'adresse a
      // le temps de se taper : la page arrive PILE sur le nom prononcé.
      const [fa] = fit(Math.max(0, a - 1.3), b)
      if (fa < a - 0.05) a = fa
      // le zoom se cale sur « clique sur commencer » — mais SEULEMENT si ce mot
      // tombe dans la scène. Ici « pour commencer » est dit AVANT l'adresse : le
      // zoom partait alors à 16,5 s, hors du panneau, et ne jouait jamais.
      // PAS DE ZOOM SUR LE BOUTON DE LA PAGE D'ACCUEIL. Il zoomait sur
      // « Commencer » : un troisième plan serré dans une scène qui en a déjà
      // deux (l'adresse qui se tape, la page qui arrive), et qui vole la place
      // du vrai geste suivant — le clic sur Images IA dans l'app. Axel :
      // « annule ce zoom ». La page s'affiche en entier, et la visite guidée
      // prend le relais sur l'écran d'après.
      if (add({ anim: 'ui', ui: 'browser', url: 'avatarads.fr', screen: 'site-home' }, a, b)) {
        console.log(`▶ navigateur : l'adresse se tape puis la page s'affiche (${r2(a)}→${r2(b)}s)`)
      }
      break
    }

    let placedAnim = 0
    placeServerAnims = () => {
      for (const sl of srv) {
        if (!isAnim(sl) || consumedByPlan.has(sl)) continue
        const an = String(sl.anim)
        const a = r2(sl.start || 0), b = r2(sl.end ?? a + 1.8)
        // une carte titrée qui porte AUSSI une animation : le titre saute, l'anim reste
        if (add({ ...sl, title: '', text: '', items: [], ...(NEEDS[an] || {}) }, a, b)) {
          consumedByPlan.add(sl); placedAnim++
        }
      }
    }
    // SES CARTES DE TEXTE PASSENT APRÈS LES DÉMOS D'INTERFACE (§1/§2). Posées ici,
    // elles réservaient les fenêtres des visites guidées de l'app : sur Cartoon 15,
    // les cinq captures cliquées d'Images IA et d'Express disparaissaient au profit
    // de deux cartes « IMAGE IA » et « EXPRESS ». Or une démo au clic — curseur,
    // cadre, texte tapé — montre infiniment plus qu'un mot posé sur un fond.
    placeServerText = () => {
      let n = 0
      for (const sl of srv) {
        if (consumedByPlan.has(sl) || isAnim(sl)) continue
        if (sl.anim === 'screen' || sl.anim === 'ui') continue
        const its = (sl.items || []).filter((it) => it && it.text)
        if (!its.length && !sl.title) continue
        const a = r2(sl.start || 0), b = r2(sl.end ?? a + 1.5)
        if (add(sl, a, b)) { consumedByPlan.add(sl); n++ }
      }
      const tot = srv.length, anims = srv.filter(isAnim).length
      console.log(`▶ chef d'orchestre : ${placedAnim}/${anims} animations + ${n} carte(s) de texte`
        + ` = ${placedAnim + n}/${tot} de ses scènes posées`)
    }
  }

  // ── 1 · LES TABLES LOCALES : elles ne comblent plus que les trous ────────────
  // Déclencheurs haute précision, écrits pour les scripts d'Axel. Ils gardent
  // leur valeur (ils connaissent les modules d'AvatarAds, ce que le serveur
  // ignore) mais ils ne PASSENT PLUS DEVANT : `add()` refuse toute fenêtre déjà
  // réservée ci-dessus.

  // « N secondes/minutes » dans les 6 premières secondes → chrono (chiffres OU lettres)
  for (let j = 0; j < words.length && words[j].start < 6; j++) {
    const v = numOf(words[j].text)
    const nx = words[j + 1] ? norm(words[j + 1].text) : ''
    if (v > 0 && v <= 120 && (nx.startsWith('second') || nx.startsWith('minute'))) {
      add({ anim: 'ui', ui: 'timer', value: String(v), unit: nx.startsWith('minute') ? 'MINUTES' : 'SECONDES' },
        Math.max(0, words[j].start - LEAD), Math.min(D, words[j + 1].end + 1.6))
      break
    }
  }

  // « avec cette qualité-là » → la photo témoin plein écran (montrer le résultat au hook)
  {
    const hit = findSeq(words, 'cette qualite')
    if (hit) add({ anim: 'ui', ui: 'photo', screen: 'hook-qualite' },
      Math.max(0, hit.start - LEAD), Math.min(D, hit.end + 0.45))
  }

  // (la scène navigateur est posée en §0 : voir placeBrowser)

  // « TU N'AS PLUS QU'À ÉCRIRE CE QUE TU VEUX » → on VOIT quelque chose s'écrire.
  // Axel : « là on doit voir quelque chose qui est écrit dans Claude… avec le
  // bruitage clavier ». La phrase décrit un geste ; la montrer, c'est la barre de
  // prompt qui se remplit lettre par lettre (le clavier vient avec la scène).
  // Le texte tapé n'est pas inventé : on reprend l'objet que la voix annonce
  // juste après (« et Claude te SORT LA VIDÉO ») — ça vaut pour n'importe quelle
  // marque, sans table de mots-clés.
  {
    const trig = findSeq(words, 'plus qua ecrire') || findSeq(words, 'qua ecrire')
      || findSeq(words, 'plus qua demander') || findSeq(words, 'qua demander')
    if (trig) {
      const give = findAny(words, ['sort', 'sortir', 'donne', 'genere', 'renvoie', 'envoie', 'fabrique', 'cree'], trig.i + 1)
      let obj = ''
      if (give) {
        const tail = words.slice(give.i + 1, give.i + 4).map((w) => String(w.text).replace(/[.,;:!?»«]/g, ''))
        const art = tail.findIndex((w) => ['la', 'le', 'les', 'ta', 'ton', 'tes', 'une', 'un'].includes(norm(w)))
        if (art >= 0 && tail[art + 1]) obj = (tail[art] + ' ' + tail[art + 1]).toLowerCase()
      }
      const text = obj ? `Génère-moi ${obj}` : 'Génère-moi ça'
      // dans QUOI on écrit : si l'assistant est nommé dans la phrase, son champ
      // porte sa marque (la transcription écrit « Cloud » pour Claude)
      const near = words.slice(Math.max(0, trig.i - 4), trig.i + 12).map((w) => norm(w.text))
      const mark = near.some((w) => w.startsWith('claud') || w === 'cloud') ? 'claude' : ''
      const a = Math.max(0, trig.start - 0.4)
      add({ anim: 'ui', ui: 'promptbar', text, ...(mark ? { mark } : {}), ...(give ? { sendAt: r2(give.start) } : {}) },
        a, Math.min(D, (give ? give.end : trig.end) + 1.6))
    }
  }

  // « CLAUDE EST CONNECTÉ À AVATARADS » → les deux logos qui se branchent.
  // C'est le moment de bascule du tuto : la liaison est faite. Le chef
  // d'orchestre y mettait un `lock` (un cadenas) — le geste n'y était pas.
  {
    for (let j = 1; j < words.length - 1; j++) {
      if (!norm(words[j].text).startsWith('connect')) continue
      const nx = norm(words[j + 1].text)
      if (nx !== 'a' && nx !== 'avec' && nx !== 'au') continue
      // le sujet ouvre la phrase : « [Claude] [est] [connecté] à … »
      const k = Math.max(0, j - 2)
      const last = words[Math.min(words.length - 1, j + 3)]
      const after = words.find((w) => w.start > last.end + 0.05)
      if (add({ anim: 'connect', assets: ['logo-avatarads', 'logo-claude'] }, Math.max(0, words[k].start - LEAD),
        Math.min(D, after ? after.start - 0.1 : last.end + 0.5, last.end + 0.5))) {
        console.log(`▶ les deux logos se branchent (${r2(words[k].start)}s)`)
      }
      break
    }
  }

  // CTA « commente/écris X » : le mot cité devient la barre de commentaire
  let from = 0
  for (let k = 0; k < 3; k++) {
    const c = findAny(words, ['commente', 'commentes', 'ecris', 'écris', 'commenter'], from)
    if (!c) break
    from = c.i + 1
    const w = words[c.i + 1]
    if (!w) break
    const kw = String(w.text).replace(/[«»".,!?]/g, '').trim()
    if (!kw || kw.length > 14) continue
    const isFinal = c.start > D - 8     // le CTA de fin a son propre panneau punch (§ 3)
    if (isFinal) continue
    add({ anim: 'ui', ui: 'comment', word: kw, zoom: 'soft' },
      Math.max(0, c.start - LEAD), Math.min(D, c.end + 2.6))
  }

  // « et voilà » → l'image RÉSULTAT plein écran. Posée AVANT les démos : c'est
  // elle qui borne la fin d'une démo, pas l'inverse (« quand tu génères l'image,
  // fais une animation de clic puis MONTRE le résultat », Axel).
  {
    const hit = findSeq(words, 'et voila') || findSeq(words, 'et la')
    if (hit) {
      // …mais elle rend la main dès qu'il enchaîne (« t'as plus qu'à POSTER ») :
      // sinon le résultat mange l'animation des plateformes qui vient après
      const nxt = findAny(words, ['poster', 'publier', 'partager'], hit.i + 1)
      add({ anim: 'result', screen: '99-resultat' }, Math.max(0, hit.start - 0.3),
        Math.min(D, Math.min(hit.end + 1.9, nxt ? nxt.start - 0.2 : Infinity)))
    }
  }

  // ── LA CAPTURE EST PILOTÉE, PAS CONTEMPLÉE (#146) ──
  // « tu vas aller dans Images IA, sélectionner Photo Réelle, le format que tu
  // veux, décrire l'image, générer » = CINQ gestes sur la MÊME page. On produit
  // donc une démo : la capture du module, et un clic au bon endroit à chaque mot.
  // Avant, le cadre orange se posait au centre par défaut — sur du vide.
  if (!(plan.tuto || []).length) {
    // mes visites guidées locales ne servent QUE de repli : si le chef
    // d'orchestre a décrit le parcours, deux versions du même tuto se
    // disputeraient les mêmes secondes.
    const hits = []
    for (const m of MODULES) {
      let hit = null
      for (const p of m.pat) { hit = findSeq(words, p); if (hit) break }
      if (hit) hits.push({ ...hit, screen: m.screen })
    }
    hits.sort((a, b) => a.start - b.start)
    hits.forEach((h, hi) => {
      const stopI = hi + 1 < hits.length ? hits[hi + 1].i : words.length
      const steps = []
      const menuSpot = spotOf(h.screen, 'menu')
      if (menuSpot) steps.push({ t: r2(Math.max(0, h.start - LEAD)), spot: menuSpot })
      const used = new Set(['menu'])
      let lastEnd = h.end
      for (let j = h.i + 1; j < stopI && words[j].start < h.start + 8; j++) {
        const n = norm(words[j].text)
        const sw = STEP_WORDS.find((x) => !used.has(x.spot) && x.w.includes(n))
        if (!sw) continue
        if (sw.spot === 'generate' && !GEN_OBJ.includes(words[j + 1] ? norm(words[j + 1].text) : '')) continue
        const sp = spotOf(h.screen, sw.spot)
        if (!sp) continue
        used.add(sw.spot)
        steps.push({ t: r2(Math.max(0, words[j].start - LEAD)), spot: sp,
          ...(sw.spot === 'prompt' ? { type: PROMPT_SAMPLE[h.screen] || 'Décris ce que tu veux…' } : {}) })
        lastEnd = words[j + 1] ? words[j + 1].end : words[j].end
        if (sw.spot === 'generate') { lastEnd = words[j + 1] ? words[j + 1].end : words[j].end; break }
      }
      if (!steps.length) return
      const a = Math.max(0, steps[0].t - 0.05)
      const b = Math.min(D, Math.min(lastEnd + 0.85, h.start + 9))
      const sl = add({ anim: 'screen', screen: h.screen }, a, b)
      // une étape hors du panneau posé (fenêtre rognée) ne s'affiche pas
      if (sl) sl.steps = steps.filter((st) => st.t >= sl.start - 0.02 && st.t < sl.end - 0.3)
    })
  }

  // « ton premier avatar » → on MONTRE l'avatar OBTENU (le résultat d'Images IA),
  // pas une carte de texte ni le visage du hook. APRÈS la démo : il arrive quand
  // le clic sur « Générer » a eu lieu, il ne mange pas la fin du parcours.
  {
    const hit = findSeq(words, 'premier avatar') || findSeq(words, 'ton avatar')
    if (hit) add({ anim: 'ui', ui: 'photo', screen: AVATAR_RESULT, assets: [AVATAR_RESULT] },
      Math.max(0, hit.start - LEAD), Math.min(D, hit.end + 1.8))
  }

  // « sélectionne Photo Réel(le) / Pixar / format » → cartes de choix sous le
  // curseur. Après les démos : quand la vraie capture montre déjà le geste, la
  // carte abstraite ne sert plus à rien et sa fenêtre est déjà prise.
  {
    const zones = [
      { pat: ['photo reelle', 'photo reel', 'photo realiste'], k: 'photo-reel' },
      { pat: ['pixar'], k: 'pixar' },
      { pat: ['format'], k: 'format' },
      { pat: ['portrait'], k: 'portrait' },
    ]
    // les choix s'enchaînent souvent (« Photo Réel, le format… ») : chaque pick
    // s'arrête au début du suivant pour que les DEUX vivent (v5 en avait deux)
    const hits = []
    for (const z of zones) {
      let hit = null
      for (const p of z.pat) { hit = findSeq(words, p); if (hit) break }
      if (hit) hits.push({ ...hit, k: z.k })
    }
    hits.sort((a, b) => a.start - b.start)
    for (let h = 0; h < hits.length; h++) {
      const hit = hits[h]
      const cfg = PICKS[hit.k]
      const cap = h + 1 < hits.length ? hits[h + 1].start - 0.41 : Infinity
      add({ anim: 'ui', ui: 'pick', choices: cfg.choices, sel: cfg.sel,
        ...(cfg.ratio ? { ratio: true } : {}), pickAt: r2(hit.end + 0.15) },
        Math.max(0, hit.start - LEAD), Math.min(D, Math.min(hit.end + 0.7, cap)))
    }
  }

  // « décrire l'image / j'ai mis que je voulais … » → la barre de prompt TAPE ce qui
  // est DIT (le visuel EST le mot), envoi calé sur « tu génères »
  {
    const trig = findAny(words, ['decrire', 'decris'], 0)
    if (trig) {
      // dernier marqueur de citation dans les ~14 mots qui suivent le verbe
      let qi = -1
      for (let j = trig.i; j < Math.min(trig.i + 14, words.length); j++) {
        if (['voulais', 'veux', 'genre', 'mis'].includes(norm(words[j].text))) qi = j
      }
      const gen = findAny(words, ['genere', 'generes', 'generer'], trig.i + 1)
      if (qi >= 0 && qi + 1 < words.length) {
        const stopI = Math.min(gen ? gen.i : qi + 19, words.length)
        const toks = []
        for (let j = qi + 1; j < stopI && toks.length < 18; j++) {
          if (toks.length && words[j].start - words[j - 1].end > 0.9) break // fin de phrase
          toks.push(String(words[j].text))
        }
        // queue propre : liaisons et ponctuation ne se tapent pas dans un prompt
        while (toks.length && ['puis', 'ensuite', 'et', 'tu', 'alors', 'donc', 'la'].includes(norm(toks[toks.length - 1]))) toks.pop()
        const text = toks.join(' ').replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '')
        if (toks.length >= 3) {
          add({ anim: 'ui', ui: 'promptbar', zoomEnd: true, text,
            ...(gen ? { sendAt: r2(gen.start) } : {}) },
            Math.max(0, trig.start - 0.25),
            Math.min(D, gen ? gen.end + 1.3 : words[Math.max(qi + toks.length, qi + 1)].end + 1.5))
        }
      }
    }
  }

  // ── L'ANIMATION EST LE MOT (#146) ──
  // L'orchestrateur choisissait l'animation « au feeling » : on se retrouvait
  // avec une cible pendant qu'il parle de pros, un interrupteur sur « outils ».
  // Ici chaque animation est ancrée sur un mot qui la JUSTIFIE. Les anims
  // serveur non ancrées sont écartées plus bas (§4) — mieux vaut un slam.
  // …mais elles ne comblent que ce que le chef d'orchestre a laissé vide : c'est
  // LUI qui choisit les animations, mes tables ne sont qu'un filet (cf. §0).
  placeLocalAnims = () => {
    for (const v of VOICE_ANIMS) {
      const hit = findAny(words, v.w)
      if (!hit) continue
      add({ anim: v.anim, ...(v.photo ? { photo: v.photo } : {}),
        ...(v.photo || v.assets ? { assets: v.assets || [v.photo] } : {}) },
        Math.max(0, hit.start - LEAD), Math.min(D, hit.end + (v.pad || 1.7)))
    }
  }

  // « poster sur les réseaux » → les PLATEFORMES qui reçoivent la vidéo. Avant :
  // des bulles de commentaire et des cœurs — Axel : « tu montres une animation
  // de message… aucun rapport ».
  {
    const hit = findSeq(words, 'poster sur les reseaux') || findSeq(words, 'sur les reseaux')
      || findAny(words, ['poster', 'publier'])
    if (hit) add({ anim: 'post' }, Math.max(0, hit.start - LEAD), Math.min(D, hit.end + 2.0))
  }

  // import de fichier : « importe/ajoute ton/tes audio|image|vidéo|fichier|clip »
  from = 0
  for (let k = 0; k < 3; k++) {
    const v = findAny(words, ['importe', 'importer', 'ajoute', 'ajouter'], from)
    if (!v) break
    from = v.i + 1
    const win = words.slice(v.i + 1, v.i + 4).map((w) => norm(w.text)).join(' ')
    const m = win.match(/audio|image|video|fichier|clip|photo/)
    if (!m) continue
    add({ anim: 'ui', ui: 'upload', file: /image|photo/.test(m[0]) ? 'image' : 'audio' },
      Math.max(0, v.start - LEAD), Math.min(D, v.end + 2.2))
  }

  // les scènes une-phrase : motif → scène directe
  const ONESHOT = [
    { pat: ['supprimer les silences', 'supprime les silences'], ui: 'silencecut', pad: 3.4 },
    { pat: ['en un clic', 'un seul clic'], ui: 'oneclick', pad: 2.2 },
    { pat: ['genere la cle', 'generer la cle', 'génère la clé'], ui: 'keycopy', pad: 3.0 },
    // (« X est connecté à Y » → animation `connect`, plus haut : les VRAIS logos)
    { pat: ['millions de vues', 'des millions de vue'], ui: 'views', pad: 1.6, value: '2400000' },
  ]
  for (const o of ONESHOT) {
    for (const p of o.pat) {
      const hit = findSeq(words, p)
      if (!hit) continue
      add({ anim: 'ui', ui: o.ui, ...(o.value ? { value: o.value } : {}) },
        Math.max(0, hit.start - LEAD), Math.min(D, hit.end + o.pad))
      break
    }
  }

  // « style / sous-titres / musique / images » énumérés → pills d'options
  {
    const opts_ = []
    const seen = {}
    for (const w of words) {
      const n = norm(w.text)
      const lab = n.startsWith('style') ? 'Style' : n.startsWith('soustitre') || n === 'soustitres' ? 'Sous-titres'
        : n.startsWith('musique') ? 'Musique' : n.startsWith('image') ? 'Images' : ''
      if (lab && !seen[lab]) { seen[lab] = w.start; opts_.push({ lab, t: w.start }) }
    }
    if (opts_.length >= 3 && opts_[opts_.length - 1].t - opts_[0].t < 8) {
      add({ anim: 'ui', ui: 'options', options: opts_.map((o) => o.lab).slice(0, 4),
        itemAt: opts_.map((o) => r2(o.t)).slice(0, 4) },
        Math.max(0, opts_[0].t - LEAD), Math.min(D, opts_[opts_.length - 1].t + 2.2))
    }
  }

  // ── 2 · les slides `screen` à texte tapé du serveur → barre de prompt ──
  const srcSlides = (plan.slides || []).slice().sort((a, b) => (a.start || 0) - (b.start || 0))
  for (const sl of srcSlides) {
    if (sl.anim !== 'screen' || !sl.screenText) continue
    const a = r2(sl.start), b = r2(sl.end)
    // envoi calé sur « génère/générer » s'il est prononcé dans la foulée
    const gen = findAny(words, ['genere', 'generes', 'generer', 'génère'],
      words.findIndex((w) => w.start >= a))
    if (add({ anim: 'ui', ui: 'promptbar', text: String(sl.screenText), zoomEnd: true,
      ...(gen && gen.start > a + 1.2 && gen.start < b + 2 ? { sendAt: r2(gen.start) } : {}) }, a, b)) {
      consumed.add(sl)
    }
  }

  // L'ORDRE DE PRIORITÉ, une fois les démos d'interface posées :
  //   1. ce que le chef d'orchestre a choisi (il lit la phrase)
  //   2. mes tables de mots-clés (elles ne font que reconnaître)
  //   3. ses cartes de texte, dans ce qu'il reste
  placeServerAnims()
  placeLocalAnims()
  placeServerText()

  // ── 3 · CTA final : si aucun punch serveur ne COUVRE la fin, on le synthétise
  // depuis le dernier « commente/écris X » — le moteur y greffe la barre de
  // commentaire et sa frappe tout seul
  const hasEndPunch = (plan.slides || []).some((s) => s.type === 'punch' && (s.end || 0) > D - 3)
  if (!hasEndPunch) {
    let last = null, fi = 0
    for (;;) {
      // « commande » : Scribe transcrit souvent « commente » ainsi — sans ça le
      // CTA final n'était pas détecté du tout (« le CTA pas ouf », Axel)
      const c = findAny(words, ['commente', 'commentes', 'ecris', 'écris', 'commande', 'commandes'], fi)
      if (!c) break
      last = c; fi = c.i + 1
    }
    if (last && last.start > D - 10) {
      const w = words[last.i + 1]
      const kw = ctaWord(w ? String(w.text).replace(/[«»".,!?]/g, '').trim() : '')
      if (kw && kw.length <= 14) {
        const verb = norm(words[last.i].text).startsWith('ecris') ? 'Écris' : 'Commente'
        // LE MOT À COMMENTER EST TOUJOURS EN CAPITALES. C'est une consigne qu'on
        // donne au spectateur : elle doit se lire d'un coup d'œil et se recopier
        // sans hésiter sur la casse (Axel : « faut que ça soit toujours en
        // majuscule le mot »).
        const KW = kw.toLocaleUpperCase('fr-FR')
        const a = Math.max(last.start - 0.1, D - 5)
        // LE CTA GARDE LA FIN. J'avais essayé de le faire céder pour atteindre
        // 100 % des scènes du chef d'orchestre ; Axel, en voyant le résultat :
        // « CTA à revoir, là y'a besoin de texte pour le CTA pour mettre le mot,
        // comme on avait fait dans v18 ». Le mot à commenter EST l'appel à
        // l'action — c'est le seul endroit de la vidéo où le texte prime sur
        // l'animation. La règle des 100 % vaut donc pour le CORPS de la vidéo,
        // pas pour ses cinq dernières secondes.
        for (let i = out.length - 1; i >= 0; i--) {
          const s = out[i]
          if ((s.end || 0) <= a + 0.05) continue
          s.end = r2(a - 0.05)
          if (s.end - s.start < 0.8) out.splice(i, 1)   // trop court : il dégage
        }
        // …ET L'ADRESSE, AVEC LE LOGO. Axel : « dans le CTA quand je dis
        // avatarads.fr tu ajoutes le logo AvatarAds ». Il dit DEUX choses dans
        // ces cinq secondes — commente le mot, et va sur le site. La carte n'en
        // montrait qu'une : l'adresse prononcée n'existait nulle part à l'écran.
        const dom = words.slice(last.i, last.i + 14)
          // on ne retire que la ponctuation de FIN : un nettoyage global mangeait
          // le point du domaine (« avatarads.fr » → « avataradsfr »)
          .map((w2) => String(w2.text).trim().replace(/^[«"']+|[«»"',!?]+$|\.$/g, ''))
          .find((t) => /^[\w-]+\.(fr|com|io|net|co|app|ai|shop|store|org)$/i.test(t))
        out.push({ type: 'punch', cta: true, layout: 'full', eyebrow: 'Pour finir', title: '',
          ...(dom ? { site: dom.toLowerCase() } : {}),
          items: [{ text: `${verb} « ${KW} »`, t: r2(Math.max(a + 0.3, last.start)) }],
          start: r2(a), end: r2(D - 0.1) })
        claim(a, D)
      }
    }
  }

  // ── 3b · FENÊTRES AVATAR (#149) : le visage porte le hook, un moment fort et
  // l'avant-CTA — 3 fenêtres posées dans les ZONES LIBRES (jamais sur une scène).
  // Les clips lipsync (av0.mp4…) sont fournis par l'app/MCP ; sans clip, le
  // moteur affiche la photo avatar avec un zoom lent — le visage tient l'écran.
  // Les fenêtres venues de l'orchestrateur peuvent couvrir 15-30 s d'un coup
  // (héritage du mode classique où l'avatar EST la vidéo). En Dynamique le
  // visage est une RESPIRATION : 6,5 s max par fenêtre, 40 % du temps au total.
  const adresses2 = (plan.avatarSegments || []).filter((w) => w.adresse)
  if ((plan.avatarSegments || []).length) {
    plan.avatarSegments = plan.avatarSegments.filter((w) => !w.adresse)
    const MAXW = 6.5
    let budget = D * 0.4
    // la fenêtre du hook a déjà été réservée en §0 : on la garde telle quelle
    const clamped = hookWin ? [hookWin] : []
    if (hookWin) budget -= hookWin.end - hookWin.start
    for (const w of plan.avatarSegments.slice().sort((a, b) => a.start - b.start)) {
      if (hookWin && (w.start || 0) < 0.6) continue
      if (budget <= 1) break
      let a = r2(w.start)
      let b = r2(Math.min(w.end ?? w.start + MAXW, w.start + MAXW, w.start + budget))
      // le visage ne passe JAMAIS par-dessus une scène déjà posée : il se
      // décale ou se raccourcit (sinon l'avatar recouvrait le navigateur)
      for (const t of taken) {
        if (a < t[0] && b > t[0]) b = r2(t[0] - 0.05)
        if (a >= t[0] && a < t[1]) a = r2(t[1] + 0.05)
      }
      if (b - a < 1.5 || overlaps(a, b)) continue
      // …avec ses médaillons : sans `...w` la fenêtre était recréée à vide et le
      // média accroché en §0a disparaissait sans un mot.
      clamped.push({ ...w, start: a, end: b })
      budget += 0   // (les fenêtres d'adresse de §0b sont déjà réservées)
      claim(a, b)
      budget -= b - a
    }
    // LES ADRESSES DIRECTES DE §0b SURVIVENT. Elles ont déjà réservé leur place
    // avant tout le monde ; les repasser dans le rognage ci-dessus les faisait
    // tomber sur leur propre réservation (`overlaps`) et disparaître.
    plan.avatarSegments = [...clamped, ...adresses2].sort((x, y) => x.start - y.start)
  }
  // …et s'il n'en reste presque rien (l'orchestrateur n'en propose souvent QU'UNE,
  // le hook), on complète dans les trous libres : « 3-4 vidéos de l'avatar »
  // demandées pour #149. Un visage vaut mieux qu'un mot seul à l'écran.
  const avCovered = (plan.avatarSegments || []).reduce((n, w) => n + (w.end - w.start), 0)
  if (avCovered < D * 0.18) {
    const busy = [...out.map((s) => [s.start, s.end]), ...(plan.avatarSegments || []).map((w) => [w.start, w.end])]
      .sort((a, b) => a[0] - b[0])
    const freeGaps = []
    let cur = 0
    for (const [a, b] of busy) { if (a - cur >= 2.6) freeGaps.push([cur, a]); cur = Math.max(cur, b) }
    if (D - cur >= 2.6) freeGaps.push([cur, D])
    // Les plus GRANDS trous d'abord, espacés d'au moins 6 s pour que le visage
    // revienne ponctuer la vidéo au lieu de se coller à lui-même. (Les créneaux
    // fixes d'avant rataient un trou de 4,3 s pour 0,16 s d'écart au seuil.)
    const avWins = []
    let room = D * 0.4 - avCovered                       // 40 % de visage au maximum
    const placed = (plan.avatarSegments || []).map((w) => w.start)
    for (const g of freeGaps.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))) {
      if (avWins.length + (plan.avatarSegments || []).length >= 4 || room < 1.6) break
      if (g[1] - g[0] < 2.0) continue
      if (placed.some((t) => Math.abs(t - g[0]) < 6)) continue
      const len = Math.min(4.5, room, g[1] - g[0])
      avWins.push({ start: r2(g[0]), end: r2(g[0] + len) })
      placed.push(g[0]); room -= len
    }
    // FUSION, pas remplacement : la fenêtre du hook venue du plan reste
    plan.avatarSegments = [...(plan.avatarSegments || []), ...avWins].sort((a, b) => a.start - b.start)
    for (const w of avWins) claim(w.start, w.end)
  }
  const avWinsAll = plan.avatarSegments || []

  // ── 3c · PAS DE MOT SEUL ENTRE DEUX ANIMATIONS ──
  // Un trou de 0,6 s entre deux scènes devient un panneau de texte : un mot
  // apparaît, disparaît, ne montre rien. Axel : « priorise les animations à la
  // place des sous-titres seuls qui ne veulent rien dire, qui ne montrent rien ».
  // La scène en cours tient donc l'écran jusqu'à la suivante quand le trou est
  // trop court pour qu'une phrase entière y tienne.
  {
    const chain = [...out, ...avWinsAll].sort((a, b) => (a.start || 0) - (b.start || 0))
    for (let i = 0; i < chain.length - 1; i++) {
      // …sauf une vidéo de l'utilisateur : sa fin est un point du script, pas un
      // réglage. Axel : « la vidéo de la fille doit s'arrêter quand je dis j'ai
      // juste créé cette vidéo ». L'étirer de quelques dixièmes la fait déborder
      // sur la phrase suivante, celle qui ouvre le tutoriel.
      if (chain[i].anim === 'media') continue
      const gap = (chain[i + 1].start || 0) - (chain[i].end || 0)
      if (gap > 0 && gap < 1.6) chain[i].end = r2((chain[i + 1].start || 0) - 0.02)
    }
    const last = chain[chain.length - 1]
    if (last && D - (last.end || 0) > 0 && D - (last.end || 0) < 1.2) last.end = r2(D)
  }

  // ── 4 · fusion : le serveur s'écarte des scènes dérivées, pas l'inverse ──
  // Chaque slide serveur chevauchant une dérivée est ROGNÉ à sa partie libre ;
  // sous 0,8 s (ou coincé entre deux dérivées) il est JETÉ — une chose à l'écran.
  //
  // Le moteur rend désormais le PACK D'ANIMATIONS en plein panneau (« des
  // animations plutôt que des mots » — Axel). On ne jette que les anims que
  // le moteur ne sait vraiment pas rendre (panneau vide garanti sinon).
  const RENDERABLE = new Set([...ANIMS, 'ui', 'screen', 'result', 'countup', 'logo', ''])
  const hasContent = (s) => !!(s.title || s.text || (s.items && s.items.length))

  // UN MOT AFFICHÉ EST UN MOT PRONONCÉ. L'orchestrateur pose ses cartes de texte
  // sur des fenêtres approximatives : « SIGNENT » restait à l'écran pendant
  // « …ceux qui maîtrisent le réalisme ». On ne garde donc l'item que si la voix
  // le dit VRAIMENT dans la fenêtre — et on recale le slam sur ce mot exact.
  const wordsIn = (a, b) => words.filter((w) => w.start >= a - 0.45 && w.start <= b + 0.25)
  const said = (txt, a, b) => {
    const toks = String(txt || '').split(/[\s,/·]+/).map(norm).filter((t) => t.length >= 4)
    if (!toks.length) return null
    for (const w of wordsIn(a, b)) {
      const n = norm(w.text)
      if (toks.some((t) => n === t || (t.length >= 5 && n.startsWith(t)) || (n.length >= 5 && t.startsWith(n)))) return w
    }
    return null
  }

  // ── UN MOT SEUL À L'ÉCRAN DOIT PORTER QUELQUE CHOSE ────────────────────────
  // Axel, deux fois : « les mots comme "entièrement" tout seul non ! » puis
  // « "vont" ». La réduction plus bas ramène une carte de texte à UN item —
  // celui qui est réellement prononcé. Quand ce mot est un adverbe, un
  // auxiliaire ou une préposition, l'écran affiche un mot creux en très gros :
  // ni image, ni information, et on a perdu une seconde de vidéo. Le trou vaut
  // mieux : la scène voisine s'étire dessus (§3c).
  const CREUX = new Set([
    'vont', 'vais', 'allez', 'allons', 'fait', 'faire', 'fais', 'font', 'peux', 'peut', 'pouvez',
    'veux', 'veut', 'voulez', 'suis', 'sont', 'etes', 'etre', 'avoir', 'avez', 'avons',
    'cette', 'celui', 'celle', 'ceux', 'celles', 'autre', 'autres', 'meme', 'memes',
    'tout', 'toute', 'tous', 'toutes', 'plus', 'moins', 'tres', 'bien', 'juste', 'aussi',
    'encore', 'deja', 'apres', 'avant', 'pour', 'avec', 'sans', 'dans', 'chez', 'vers',
    'depuis', 'pendant', 'quand', 'comme', 'donc', 'alors', 'ensuite', 'puis', 'enfin',
    'importe', 'peu', 'beaucoup', 'assez', 'trop', 'quelque', 'quelques', 'chaque',
  ])
  const motPlein = (txt) => {
    const mots = String(txt || '').trim().split(/[\s,/·]+/).filter(Boolean)
    if (mots.length !== 1) return true              // deux mots ou plus : c'est une idée
    const n = norm(mots[0])
    if (/\d/.test(n)) return true                   // un chiffre porte toujours
    if (n.length < 4) return false                  // « et », « ton », « son »…
    if (/ment$/.test(n)) return false               // entierement, simplement, vraiment…
    return !CREUX.has(n)
  }

  const kept = []
  const blockers = [...out, ...avWinsAll]
  let dropUnrenderable = 0, dropCollide = 0, dropUnsaid = 0, dropCreux = 0
  for (const sl of srcSlides) {
    if (consumed.has(sl) || consumedByPlan.has(sl)) continue
    if (sl.anim && !RENDERABLE.has(sl.anim) && !hasContent(sl)) { dropUnrenderable++; continue }
    // ⚠️ ICI se trouvait la ligne qui jetait TOUTE animation serveur sans texte.
    // Comme une scène d'animation n'en a jamais — l'animation EST le visuel —
    // elle supprimait la totalité des propositions du chef d'orchestre, et mes
    // tables locales fabriquaient la vidéo entière. Ces scènes sont maintenant
    // posées en premier, en §0.
    let a = r2(sl.start || 0), b = r2(sl.end || 0)
    for (const d of blockers) {
      if (b <= d.start + 0.05 || a >= d.end - 0.05) continue   // pas de contact
      const headroom = d.start - a                              // partie libre avant la scène
      const tailroom = b - d.end                                // partie libre après
      if (headroom >= tailroom) b = r2(d.start - 0.05)
      else a = r2(d.end + 0.05)
    }
    // même plancher qu'en §0 : rognée par ses voisines, une animation revenait
    // ici en clignotement de 0,9 s — c'est par ce chemin que l'horloge des
    // « deux minutes » réapparaissait après avoir été écartée plus haut.
    if (b - a < (isAnimPanel(sl) ? 1.25 : 0.8)) { dropCollide++; continue }
    if (blockers.some((d) => a < d.end - 0.05 && b > d.start + 0.05)) { dropCollide++; continue }

    let slide = { ...sl, start: a, end: b }
    // carte purement textuelle (pas d'animation à rendre) → elle doit coller
    if (!sl.anim || sl.anim === '') {
      const its = (sl.items || []).filter((it) => it && it.text)
      const cand = its.map((it) => ({ it, w: said(it.text, a, b) })).filter((x) => x.w)
      if (its.length && !cand.length) { dropUnsaid++; continue }  // aucun de ses mots n'est dit : elle dégage
      if (!its.length && sl.title && !said(sl.title, a, b)) { dropUnsaid++; continue }
      if (!its.length && sl.title && !motPlein(sl.title)) { dropCreux++; continue }
      if (cand.length) {
        // le mot retenu doit PORTER quelque chose — sinon la carte dégage
        const utiles = cand.filter((x) => motPlein(x.it.text))
        if (!utiles.length) { dropCreux++; continue }
        const best = utiles.sort((x, y) => x.w.start - y.w.start)[0]
        slide.items = [{ ...best.it, t: r2(best.w.start) }]      // le slam tombe PILE sur le mot
        slide.title = best.it.text
        // …et le panneau ne s'ouvre pas une seconde AVANT le mot : sinon on
        // regarde un fond vide en attendant que le texte arrive
        slide.start = r2(Math.max(slide.start, Math.min(best.w.start - 0.45, slide.end - 0.85)))
      }
    }
    kept.push(slide)
  }
  // JOURNAL. Ces rejets étaient silencieux : un plan entièrement jeté ressemblait
  // à un plan appliqué. Maintenant chaque scène écartée dit pourquoi.
  if (dropUnrenderable || dropCollide || dropUnsaid || dropCreux) {
    console.log(`▶ scènes serveur écartées : ${dropUnrenderable} non rendables · `
      + `${dropCollide} en collision · ${dropUnsaid} dont aucun mot n'est prononcé · `
      + `${dropCreux} réduites à un mot creux`)
  }

  // ── 4b · les slides serveur se chevauchent aussi ENTRE EUX (card posée sur
  // list, checklist sur type…) : hérité du mode classique où les cartes flottent
  // sur la vidéo. En dynamic, UNE chose à l'écran — le contenu TITRÉ gagne sur
  // l'animation anonyme, le perdant est rogné (jeté sous 0,8 s).
  const strong = (s) => !!(s.title || s.text || (s.items && s.items.length))
  kept.sort((a, b) => (a.start || 0) - (b.start || 0))
  const flat = []
  for (const sl of kept) {
    const last = flat[flat.length - 1]
    if (!last || (sl.start || 0) >= (last.end || 0) - 0.05) { flat.push(sl); continue }
    if (strong(sl) && !strong(last)) {
      last.end = r2(Math.max(last.start + 0.05, sl.start - 0.05))
      if (last.end - last.start < 0.8) flat.pop()
      flat.push(sl)
    } else {
      const a = r2((last.end || 0) + 0.05)
      if ((sl.end || 0) - a >= 0.8) flat.push({ ...sl, start: a })
      // sinon : jeté — le précédent occupe déjà l'écran
    }
  }
  // ── 4c · ANTI-RÉPÉTITION : la même capture affichée 3 fois d'affilée (vu sur
  // Cartoon 15 : 01-imagesia à 21,7 / 25,0 / 26,2 s) donne l'impression que la
  // vidéo tourne en rond. Deux voisins qui montrent la MÊME chose n'en font
  // qu'un, plus long — une idée = un plan.
  const merged = []
  for (const sl of [...flat, ...out].sort((a, b) => (a.start || 0) - (b.start || 0))) {
    const prev = merged[merged.length - 1]
    const same = prev && (
      (sl.screen && prev.screen === sl.screen) ||
      (!sl.screen && !prev.screen && sl.anim && prev.anim === sl.anim && sl.ui === prev.ui)
    )
    if (same && (sl.start || 0) - (prev.end || 0) < 2.2) { prev.end = Math.max(prev.end, sl.end); continue }
    merged.push(sl)
  }
  // ── 5 · LE HOOK EN SPLIT ────────────────────────────────────────────────────
  // Axel : « le hook je le vois plutôt en split screen avec Alex en bas et le
  // logo Claude qui pop », puis « quand je dis "je t'explique à la fin de la
  // vidéo", revenir en format 9:16 jusqu'à la vidéo ». Le split dit le SUJET
  // (l'outil dont il parle) en même temps que QUI parle, sans une ligne de
  // texte ; dès qu'il passe à l'annonce, le visage reprend tout l'écran.
  {
    const BRANDS = ['claude', 'chatgpt', 'gpt', 'midjourney', 'canva', 'notion', 'figma',
      'veo', 'sora', 'runway', 'elevenlabs', 'capcut', 'shopify', 'stripe', 'zapier', 'n8n']
    const segs = plan.avatarSegments || []
    const first = segs[0]
    if (first && (first.start || 0) < 0.6 && !first.duo) {
      const early = words.filter((w) => w.start < Math.min(4, first.end ?? 4))
      const hit = early.find((w) => BRANDS.includes(norm(w.text)))
      if (hit) {
        // le retour au plein cadre : le moment où il ARRÊTE de parler de l'outil
        // pour s'adresser au spectateur
        const back = words.find((w) => w.start > hit.end
          && ['texplique', 'jexplique', 'montre', 'apprends', 'regarde', 'suis'].includes(norm(w.text)))
        const cut = r2(Math.min(first.end ?? 4, back ? Math.max(back.start - 0.35, hit.end + 0.8) : hit.end + 2.2))
        const brand = String(hit.text).replace(/[.,!?«»"]/g, '').trim()
        // une vidéo de marque déclarée `hook` remplace la pastille dessinée
        const hk = (plan.broll || []).find((b) => b.hook && (opts.assetFiles || {})[b.assetId])
        const src = hk ? (opts.assetFiles || {})[hk.assetId] : ''
        if (cut > (first.start || 0) + 0.8) {
          // Le split crée DEUX fenêtres à partir d'UNE seule : la seconde doit
          // rejouer LE MÊME clip lipsync, à partir de la seconde où on l'a
          // coupé. Sans `clip`/`clipFrom`, elle cherchait un « av1 » qui
          // n'existe pas et retombait sur la photo fixe — le visage cessait de
          // parler pile au milieu du hook.
          segs.splice(0, 1,
            { ...first, end: cut, duo: { brand, ...(src ? { src } : {}) }, clip: 0, clipFrom: 0 },
            ...((first.end ?? 0) - cut > 0.6
              ? [{ ...first, start: cut, clip: 0, clipFrom: r2(cut - (first.start || 0)) }] : []))
          console.log(`▶ hook en split : ${brand} + visage jusqu'à ${cut}s, puis plein cadre`)
        }
      }
    }
  }

  // BILAN RÉEL, pas le bilan de bonne volonté. §0 peut « poser » une scène qu'un
  // traitement ultérieur reprend (le CTA final rogne tout ce qui déborde sur lui).
  // On compte donc ce qui ARRIVE dans la vidéo, en repartant des scènes d'origine.
  {
    const key = (s) => `${s.anim || ''}|${s.screen || ''}`
    const want = srcSlides.filter((s) => s.anim && s.anim !== 'ui')
    const got = new Set(merged.map(key))
    const lost = want.filter((s) => !got.has(key(s)))
    console.log(`▶ au final : ${want.length - lost.length}/${want.length} des scènes du chef d'orchestre dans la vidéo`
      + (lost.length ? ` · absorbées : ${lost.map((s) => `${s.anim}@${s.start}s`).join(', ')}` : ''))
  }
  plan.slides = merged
}
