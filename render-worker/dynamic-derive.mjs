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

import { ANIMS as ANIMS_BRUT } from './anim-pack.mjs'
import { sujetsDe, estUneSuite } from './sujet-pack.mjs'

// ── ANIMATIONS REFUSEES PAR AXEL ────────────────────────────────────────────
// Sur la v7 (30/07/2026), animation par animation :
//   target  sur « C'est un business »        → « supprime cette animation »
//   clock   sur « ça va te prendre »         → « pareil, je n'aime pas »
//   check   sur « zéro compétence à avoir »  → « je n'aime pas l'animation »
//   versus  sur « aucune concurrence »       → « change la » (il veut deux
//           chemins : 1 personne d'un côté, 50 de l'autre — reste à créer)
//   hook    sur « début du business »        → « ne correspond pas »
// Tant qu'on ne les remplace pas par ce qu'il a demandé, elles ne doivent plus
// pouvoir etre choisies : un visuel qu'il refuse vaut moins que pas de visuel.
//   calendar sur « peu d'investissement »    → « change l'animation, elle ne
//           correspond pas » — remplacee par `lowcost` (fleche + piece)
//   free    sur « zero competence a avoir »   → « supprime cette animation
//           gratuit la »
// Ce que le chef d'orchestre demande parfois et qui n'existe pas sous ce nom :
// plutot que de jeter, on l'envoie vers la plus proche de la banque.
// Ce qu'une phrase DOIT contenir pour meriter l'animation. S'applique a tout le
// monde — mes tables comme le chef d'orchestre.
export const EXIGE_GLOBAL = {
  logo:    /logo|marque|avatarads/i,
  free:    /gratuit|offert|cadeau|sans payer|ne paie/i,
  versus:  /concurrence|concurrent|versus|contre|compar/i,
  network: /communaut|reseau|réseau|equipe|équipe|ensemble|connect/i,
  daypart: /heure|heures|temps|jour|journ|minute/i,
  lowcost: /investi|mise|depart|départ|capital|cout|coût|budget|euro|€|prix/i,
  twopaths:/concurrence|concurrent|personne|seul|autres|tout le monde|different/i,
  // …et une DURÉE dite en lettres compte comme un chiffre : « en deux minutes »
  // justifie pleinement un compteur (§0a-ter le convertit en secondes).
  countup: /\d|cent|mille|pourcent|minute|seconde|heure/i,
  // ── PAQUET 12 (#147) ──
  // Le garde-fou est la seule chose qui empêche « le visuel EST le mot » de
  // redevenir « le visuel ressemble au mot ». Chaque motif reprend le vocabulaire
  // de la phrase qu'Axel a décrite, pas le thème général : `salesphone` ne doit
  // pas tomber sur n'importe quelle mention d'argent, il lui faut la VENTE.
  // `changer ta vie` : ce n'est pas du vocabulaire de vente, et pourtant c'est
  // LA phrase pour laquelle Axel a décrit cette animation — « un téléphone qui
  // reçoit plein de notifications de vente Shopify ». Chez lui, la vie qui
  // change, ce sont les commandes qui tombent. La métaphore est assumée et
  // validée ; elle est donc écrite ici, explicitement, plutôt que subie par un
  // garde-fou trop large.
  salesphone: /vend|vente|ventes|command|achat|acheteur|client|boutique|shopify|encaiss|rapporte|revenu|chang\w*\s+(ta|ma|sa|la|ton|mon)\s+vie|\bvie\b/i,
  oneclick: /debutant|débutant|accessible|simple|facile|clic|clique|competence|compétence|connais rien|sans savoir|tout seul/i,
  tsunami: /vague|tsunami|raz|maree|marée|deferl|déferl|arrive|arrivera|vient|va tout/i,
  gaugefill: /benefic|bénéfic|pourcent|%|totalit|integralit|intégralit|tout pour|garde tout|100/i,

  // ── PAQUET 13 (02/08) — CE QUI RESTAIT SANS GARDE-FOU ─────────────────────
  // Douze animations étaient protégées, la banque en compte plus de cent. Les
  // autres se posaient partout, et le résultat s'entend dans le verdict d'Axel
  // sur le Cartoon 18 : « l'animation elle veut rien dire ». Trois mesurées ce
  // jour-là, sur le plan réel du job 5fc556af :
  //   · `render` — une BARRE DE CHARGEMENT à 6,55 s, sur le mot « dans ».
  //     Axel : « l'animation montre juste un chargement, on doit l'utiliser
  //     juste quand un audio dit le mot chargement, c'est tout. »
  //   · `result` sur « Et » (de « Et voilà, Claude est connecté ») — la phrase
  //     parle d'une LIAISON, pas d'un résultat qui s'affiche.
  //   · `chat` sur « ne », `post` sur « sur ».
  // Le motif reprend le vocabulaire de la DESCRIPTION de l'animation dans
  // anim-bank, pas son thème : c'est la description qui dit ce qu'on voit.
  render:  /charge|chargement|génère|genere|génération|generation|calcul|rend\b|rendu|export|traite|patiente|laisse tourner|en cours|progress/i,
  result:  /résultat|resultat|ça donne|ca donne|voilà ce que|voila ce que|obtiens|sortie|fini|terminé|termine|rendu final/i,
  script:  /script|texte|écris|ecris|rédige|redige|dialogue|phrase|ce que tu vas dire/i,
  // `type`, c'est du TEXTE QUI SE TAPE. Sans garde-fou il tombait sur « tu peux
  // maintenant créer n'importe quelle vidéo dans Claude » et n'y montrait que
  // trois barres grises — Axel : « ne correspond pas et ne montre rien du tout ».
  // Écarté là, le remplaçant devient `chat` : on écrit dans Claude, Claude
  // répond. C'est le geste qu'il décrit.
  type:    /écri|ecri|tape|taper|saisi|texte|nom\b|titre|prompt|mot-clé|mot cle|colle|coller/i,
  voice:   /voix|micro|audio|son\b|parle|parler|enregistr|clone vocal|voix off/i,
  // `record`, c'est un ENREGISTREMENT qui tourne — le point rouge et la forme
  // d'onde. Sans garde-fou il tombait sur « tu peux maintenant CRÉER n'importe
  // quelle vidéo dans Claude » : Axel, en le voyant — « y'a un truc
  // d'enregistrement audio quand je crée n'importe quelle vidéo dans Claude,
  // wtf ??? ». Il lui faut le vocabulaire du micro, pas celui de la création.
  record:  /enregistr|micro|dicte|dicter|capture ta voix|parle dans|voix off|podcast/i,
  connect: /connect|connecté|connecte|relie|relié|branch|intègr|integr|liaison|lie\b|communiquent/i,
  avatar:  /avatar|personnage|visage|jumeau|clone/i,
  badge:   /certifi|validé|valide|garanti|vérifi|verifi|officiel|sceau|approuv/i,
  // …et « dans CLAUDE » compte : écrire dans Claude, c'est une conversation.
  chat:    /chat|conversation|discussion|message|demande|demander|prompt|écris-lui|ecris-lui|claude|chatgpt/i,
  copy:    /copie|copier|copies|colle|coller|presse-papier|clé|cle\b/i,
  settings: /paramètre|parametre|réglage|reglage|option|configur|préférence|preference/i,
  library: /bibliothèque|bibliotheque|collection|galerie|catalogue|page|pages|dossier/i,
  post:    /poste|poster|publi|partage|partager|met en ligne|balance/i,
  product: /produit|article|boutique|catalogue|vend|vente/i,
  template: /modèle|modele|template|personnalis|préréglage|prereglage/i,
  integrations: /connecteur|intègr|integr|plugin|extension|brancher|outil externe/i,
  comment: /commentaire|commente|commande|réponds|reponds|réponse|reponse/i,
  faceless: /caméra|camera|sans visage|sans montrer|anonyme|jamais te montrer|sans toi/i,
  trend:   /tendance|croissance|monte|grimpe|explose|progress|business|décolle|decolle|chiffre/i,
}

const REDIRECTIONS = {
  // Les animations qu'Axel a refusees ne disparaissent pas : elles pointent
  // vers celle qu'il a validee pour ce moment-la. Le chef d'orchestre garde
  // donc sa fenetre ET son intention, avec le visuel qu'Axel veut.
  versus: 'twopaths',      // « aucune concurrence » → les deux chemins
  clock: 'daypart',        // « une a deux heures par jour » → le creneau
  calendar: 'daypart',
  check: 'blankfill',      // « zero competence » → la page qui se remplit
  free: 'blankfill',
  target: 'easyup',        // l'objectif atteint sans effort → la courbe douce
  hook: 'rocket',          // « le debut du business » → l'elan
  robot: 'idea', ia: 'idea', cerveau: 'idea', brain: 'idea',
  temps: 'daypart', horloge: 'daypart', calendrier: 'daypart',
  argent: 'money', cash: 'money', euro: 'money', cout: 'lowcost', budget: 'lowcost',
  graph: 'trend', graphique: 'trend', courbe: 'trend', stats: 'trend',
  facile: 'easyup', simple: 'easyup', debutant: 'easyup',
  seul: 'twopaths', different: 'twopaths', foule: 'twopaths',
  zero: 'blankfill', vide: 'blankfill', depart: 'blankfill',
}
// `steps` rejoint la liste le 02/08 : les cartes « 1 / 2 / 3 » d'une méthode
// racontent une procédure que la voix est déjà en train de raconter, et elles
// arrivent forcément décalées d'une étape ou deux. Axel : « à la place de
// l'animation step, mets l'avatar, c'est plus simple et cohérent ». Sans
// redirection, la fenêtre retombe sur le visage — exactement ce qu'il demande.
// ── LES MOTS QUI NE MONTRENT RIEN ───────────────────────────────────────────
// Ce ne sont pas des mots « faibles » : ce sont des mots qui n'ont pas d'image.
// « Pourquoi » est un mot fort dans une phrase, mais on ne peut pas le dessiner.
// Une fenêtre qui n'en contient QUE ne demande pas un visuel, elle demande un
// visage. La liste reste courte et volontairement incomplète : un seul mot
// porteur suffit à autoriser l'animation, donc une omission ne coûte rien —
// alors qu'un mot ajouté à tort coûterait une animation légitime.
const LIAISONS = new Set([
  'voici', 'voila', 'pourquoi', 'comment', 'alors', 'donc', 'mais', 'ensuite',
  'apres', 'avant', 'puis', 'aussi', 'encore', 'deja', 'juste', 'genre',
  'vraiment', 'simplement', 'surtout', 'meme', 'bref', 'enfin', 'bien',
  'cest', 'cela', 'celui', 'celle', 'ceux', 'quand', 'parce', 'pour', 'avec',
  'sans', 'dans', 'chez', 'entre', 'plus', 'moins', 'tres', 'trop', 'peut',
  'etre', 'avoir', 'faire', 'dire', 'aller', 'venir', 'vous', 'nous', 'elle',
  'ils', 'elles', 'leur', 'leurs', 'notre', 'votre', 'mon', 'ton', 'son',
  'que', 'qui', 'quoi', 'dont', 'les', 'des', 'une', 'ses', 'ces', 'tout',
  'toute', 'tous', 'toutes', 'chaque', 'autre', 'autres',
])

// + 11/08 : Axel, sur le rendu Cartoon 21 — les barres/pilules de la section
// revenus (« pour faire quelques » / « pendant que d'autres ») : « supprime ces
// 2 animations, elles sont nulles et montrent rien ». twopaths (2 pilules),
// bars2 et grow (histogrammes abstraits) → refusées. Leur créneau revient au
// visage ou à un vrai visuel. (Une vraie viz d'argent = #44, chiffre + courbe.)
const REFUSEES = new Set(['target', 'clock', 'check', 'versus', 'hook', 'calendar', 'free', 'steps', 'twopaths', 'bars2', 'grow'])
export const ANIMS = ANIMS_BRUT.filter((a) => !REFUSEES.has(a))
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
// ── L'ÉCRAN ARRIVE AVANT LE MOT ─────────────────────────────────────────────
// 0,15 s, c'était le temps qu'il faut à l'écran pour APPARAÎTRE : le spectateur
// le découvrait donc pendant le mot, jamais avant. Sur une visite guidée
// débitée vite — « Clique sur Générer la clé et tu la copies », neuf mots en
// 1,6 s — ça se lit comme un retard permanent. Axel : « faut qu'il prévoie
// avant que je le dise ». 0,32 s laisse le panneau se poser et l'oeil s'y
// installer avant que le mot tombe, sans mordre sur la phrase d'avant.
export const LEAD = 0.32

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
  // « et même LANCER UN BUSINESS » : la courbe qui monte, demandée par Axel le
  // 03/08. Elle passe avant `grow` parce qu'elle est plus haut dans la table.
  { w: ['lancer un business', 'monter un business', 'lancer son business', 'creer un business'], anim: 'easyup' },
  { w: ['fake', 'faux', 'realisme', 'realiste'],                       anim: 'compare', pad: 2.1, photo: 'hook-qualite' },
  { w: ['outils', 'outil', 'methode', 'technique', 'strategie'], anim: 'tools', pad: 2.0, assets: ['logo-avatarads'] },
  // « en quelques secondes » parle de VITESSE, pas d'un créneau horaire — via
  // clock→daypart, la grille des heures s'affichait avec « 2h » pendant que la
  // voix disait « quelques secondes » (Axel, 31/07 : « hors contexte »)
  { w: ['secondes', 'minutes', 'rapide', 'vite'],                                       anim: 'speed' },
  // « une image, une vidéo ou même un montage » : c'est une ÉNUMÉRATION de ce
  // qu'AvatarAds produit, et la banque n'avait rien pour elle — le chef posait
  // `avatar` (un personnage qui se génère), que le garde-fou écarte à juste
  // titre, et la phrase retombait sur le visage. `lineup` aligne les trois, et
  // la dérivation remplit ses lignes avec les mots forts de la fenêtre : le
  // visuel devient littéralement ce qu'il énumère.
  // « tu peux maintenant créer n'importe quelle vidéo DANS CLAUDE » : ce qu'on
  // montre, ce n'est pas le résultat, c'est le GESTE — on écrit dans Claude et
  // Claude réfléchit. Axel : « mets l'animation quand tu écris dans Claude et
  // Claude est en train de réfléchir plutôt ». Cette entrée passe AVANT
  // l'énumération ci-dessous : « dans Claude » l'emporte sur « vidéo ».
  { w: ['claude', 'chatgpt', 'demander', 'demande', 'prompt'],                           anim: 'chat' },
  { w: ['image', 'images', 'video', 'videos', 'montage', 'montages'],                    anim: 'lineup' },
  { w: ['idee', 'idees', 'creatif', 'inspiration'],                                     anim: 'idea' },
  { w: ['cible', 'objectif', 'but', 'resultat', 'resultats'],                           anim: 'target' },
  // Les deux animations decrites par Axel, cablees sur SES mots.
  { w: ['investissement', 'investir', 'mise', 'depart', 'capital'],                     anim: 'lowcost' },
  { w: ['concurrence', 'concurrent', 'concurrents', 'personne'],                        anim: 'twopaths' },
  // ── PAQUET 12 (#147) — les quatre scenes qu'il a decrites et validees ──
  // Elles passent AVANT les tables generiques ci-dessus quand les mots
  // coincident : c'est sa description qui a le dernier mot sur ses phrases.
  { w: ['ventes', 'vente', 'commandes', 'commande', 'shopify', 'boutique', 'encaisse'], anim: 'salesphone' },
  { w: ['debutant', 'debutants', 'accessible', 'clic', 'clique'],                       anim: 'oneclick' },
  { w: ['vague', 'tsunami', 'raz'],                                                     anim: 'tsunami' },
  { w: ['benefices', 'benefice', 'integralite', 'totalite'],                            anim: 'gaugefill' },
]

export function deriveDynamicSlides(plan, opts = {}) {
  // ── AUCUN VISAGE DISPONIBLE ? ALORS ON N'EN RÉCLAME PAS ───────────────────
  // Le worker vide `plan.avatarSegments` quand le job n'a ni clip lipsync, ni
  // photo, ni base vidéo — mais la dérivation en RECRÉAIT juste après, sans
  // savoir qu'il n'y a personne à montrer : une adresse directe (§0b), une
  // respiration (§3b), un trou comblé (§3b-bis). Chacune de ces fenêtres
  // retombait sur `tuto/hook-qualite.png`, la photo de démo — un inconnu au
  // bord d'une piscine en plein écran, ce qu'Axel a déjà vu et refusé. Les
  // fenêtres qui restaient vides, elles, donnaient l'écran nu à 18 s.
  const noFace = !!opts.noFace
  // apple partage ce moteur (cf. build-composition) : sans lui ouvrir la porte
  // ici, il recevait le plan BRUT — 19 panneaux au lieu de 14, captures non
  // pilotées, animations non ancrées. La peau était claire, la matière non.
  if (plan.slideStyle !== 'dynamic' && plan.slideStyle !== 'apple') return
  // ── UN BÉGAIEMENT NE S'ÉCRIT PAS DEUX FOIS ──────────────────────────────────
  // La transcription garde les répétitions de la voix : « il te reste plus qu'à,
  // qu'à demander » sort DEUX légendes « qu'à » collées (Axel, Cartoon 20, 27 s :
  // « je dis 2 fois qu'à, supprime-en 1 »). On fusionne deux légendes IDENTIQUES
  // qui se suivent de près QUAND le mot est une élision (qu', d', l', j'…) ou
  // très court : un vrai « très très » (mot plein, sans apostrophe, ≥3 lettres)
  // n'est jamais touché. La seconde disparaît, la première tient jusqu'au bout.
  if (Array.isArray(plan.captions) && plan.captions.length > 1) {
    const norm2 = (t) => String(t || '').toLowerCase().replace(/[.,!?…«»"]/g, '').trim()
    const nettoye = [plan.captions[0]]
    let retires = 0
    for (let i = 1; i < plan.captions.length; i++) {
      const cur = plan.captions[i], prev = nettoye[nettoye.length - 1]
      const nm = norm2(cur.text)
      const meme = nm && nm === norm2(prev.text)
      const colle = (cur.start - (prev.end ?? cur.start)) < 0.5
      const faible = /['']/.test(nm) || nm.length <= 2
      if (meme && colle && faible) { prev.end = cur.end ?? prev.end; retires++; continue }
      nettoye.push(cur)
    }
    if (retires) { plan.captions = nettoye; console.log(`▶ ${retires} bégaiement(s) de sous-titre fusionné(s)`) }
  }
  // ── CHAQUE FENÊTRE D'ORIGINE GARDE SON CLIP ────────────────────────────────
  // L'app génère les clips lipsync av0, av1… AVANT cette dérivation, un par
  // fenêtre du plan d'orchestrate, et le worker les remappe ensuite PAR INDICE
  // (`w.clip ?? i`). Or cette dérivation supprime, scinde et INSÈRE des
  // fenêtres (adresses directes, trous comblés) : au premier décalage, chaque
  // fenêtre jouait le clip de sa voisine — un visage dont les lèvres disent
  // les mots d'un autre passage. On fige donc ici l'indice d'origine sur
  // chaque fenêtre du plan ; toute fenêtre créée par la dérivation portera
  // `clip: -1` (« aucun clip ne m'appartient » → photo d'avatar en repli).
  ;(plan.avatarSegments || []).forEach((w, i) => { if (w.clip == null) w.clip = i })
  // le worker sait s'il a des clips lipsync sous la main ; le moteur (appel de
  // repli depuis dynamic-engine) le déduit de ses propres options.
  const hasClips = opts.hasClips ?? Object.keys(opts.avatarClips || {}).length > 0
  // ── LES BORNES D'ORIGINE, FIGÉES AVANT TOUTE RETOUCHE (retours d'Axel 07/08) ──
  // La dérivation supprime, déplace et scinde les fenêtres du plan — mais les
  // clips Hedra, eux, ont été générés sur les BORNES D'ORIGINE : c'est la seule
  // vérité pour savoir quelles secondes de voix un clip sait prononcer. Deux
  // usages plus bas : une fenêtre créée par la dérivation (adresse §0b, trou
  // comblé §3b-bis) peut REPRENDRE le clip payé qu'elle recouvre au lieu de la
  // photo figée (Axel : « à 13 s le lipsync manque » — le clip av1 existait,
  // la fenêtre d'adresse l'avait jeté), et une fenêtre dont le début glisse
  // doit savoir de COMBIEN pour que les lèvres restent vraies (clipFrom).
  const fenetresSources = (plan.avatarSegments || [])
    .filter((w) => Number.isInteger(w.clip) && w.clip >= 0 && !w.adresse && !w.comble)
    .map((w) => ({ start: r2(w.start || 0), end: r2(w.end ?? w.start ?? 0), clip: w.clip }))
  // La fenêtre créée [a,b] peut-elle porter un clip payé ? Oui si son début
  // coïncide avec celui d'une fenêtre d'origine (±0,3 s : au-delà, le clip
  // prononce d'autres mots et les lèvres mentiraient), et si elle ne déborde
  // pas la matière du clip de plus de 2,5 s (marge du tpad/padding Hedra —
  // au-delà on garde la photo : un visage gelé en plein mot est pire).
  const clipPourFenetre = (a, b) => {
    if (!hasClips) return null
    const s = fenetresSources.find((w) => Math.abs((w.start || 0) - a) <= 0.3 && b > w.start + 0.4)
    if (!s) return null
    if (b > s.end + 2.5) return null
    return s
  }
  const words = (plan.captions || [])
    .filter((c) => String(c.text || '').trim())
    .map((c) => ({ text: String(c.text).trim(), start: r2(c.start), end: r2(c.end) }))
    .sort((a, b) => a.start - b.start)
  if (!words.length) return
  const D = r2(plan.duration || (words[words.length - 1].end + 0.5))
  const out = []
  const taken = []        // fenêtres occupées, pour ne jamais superposer deux scènes
  const overlaps = (a, b) => taken.some((w) => a < w[1] - 0.05 && b > w[0] + 0.05)
  // DERIVE_DEBUG=1 : journalise chaque réservation avec sa ligne d'appel.
  // C'est l'instrument qui a permis de trouver la réservation fantôme du 31/07
  // — l'ordre de réservation décide de tout ici, et il est invisible sans ça.
  const claim = (a, b) => {
    if (process.env.DERIVE_DEBUG) {
      const site = (new Error().stack.split('\n')[2] || '').trim().replace(/.*dynamic-derive\.mjs/, 'derive')
      console.log(`CLAIM ${r2(a).toFixed(2).padStart(6)} → ${r2(b).toFixed(2).padStart(6)}  ${site}`)
    }
    taken.push([a, b])
  }
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
  // ── UNE ANIMATION NE SE VOIT QU'UNE FOIS ─────────────────────────────────
  // Règle d'Axel (02/08). Trois familles y échappent, parce que ce ne sont pas
  // des illustrations : les médias de l'utilisateur (il en a autant qu'il veut),
  // les captures d'écran (une visite guidée montre plusieurs fois la même app)
  // et les panneaux de repli, qui ne racontent rien de particulier.
  // `sujet` est répétable : ce n'est pas UNE animation mais une famille dont le
  // contenu change à chaque fois. Son unicité se joue sur les sujets dessinés
  // (`sujetsPoses`), pas sur son nom.
  const REPETABLES = new Set(['media', 'screen', 'ui', 'result', 'punch', 'blankfill', 'sujet'])
  // ⚠ On ne compte que ce qui est RÉELLEMENT joué comme animation : une scène
  // qui porte une capture ou un média affiche l'image, pas l'animation restée
  // dans son champ `anim`. Sans ce filtre, un `chat` résiduel sur l'écran de
  // résultat (33 s) interdisait la vraie bulle de chat à 4,7 s.
  // ── « ET VOILÀ, CLAUDE EST CONNECTÉ À AVATARADS » ────────────────────────
  // Le plan de récompense de toute la démonstration. Axel, deux fois : « quand
  // je dis "et voilà Claude est connecté à AvatarAds", ça serait bien de
  // remettre les 2 logos ensemble avec la coche plutôt qu'un chat avec Claude ».
  // `connect` a le droit de sortir une seconde fois : c'est la seule animation
  // qui MONTRE la connexion, et ce moment-là ne se raconte pas autrement.
  const estLaConnexion = (a, b) => {
    const dit = (plan.captions || []).filter((w) => w.start < b && w.end > a).map((w) => w.text).join(' ')
    return /(est|sont|maintenant)\s+connect/i.test(dit) || /et voil[àa].{0,24}connect/i.test(dit)
  }
  const dejaVue = (n) => Boolean(n) && !REPETABLES.has(String(n))
    && out.some((s) => String(s.anim) === String(n) && !s.screen && !s.assetId && !(s.items || []).length)
  // Cherche, dans les mots réellement prononcés, une animation encore inédite
  // qui passe son propre garde-fou. Sert au refus d'un garde-fou comme au refus
  // d'un doublon : dans les deux cas, on remplace — on ne creuse pas un trou.
  const chercheRemplacant = (dit, exclu) => {
    const dur = norm(dit)
    for (const e of VOICE_ANIMS) {
      if (!(e.w || []).some((m) => dur.includes(norm(m)))) continue
      const cand = String(e.anim || '')
      if (!cand || cand === exclu || REFUSEES.has(cand) || !ANIMS.includes(cand)) continue
      if (EXIGE_GLOBAL[cand] && !EXIGE_GLOBAL[cand].test(dit)) continue
      if (dejaVue(cand)) continue
      return cand
    }
    return null
  }
  // La PHRASE qui entoure une fenêtre — bornée aux points, pas à 1,5 s. Deux
  // décisions en ont besoin : le sujet d'une phrase (« demander à Claude ») et
  // les scènes à sujet ouvert, qui lisent les mots pour choisir leurs icônes.
  const phraseDe = (a, b) => {
    const cs = plan.captions || []
    let i0 = cs.findIndex((w) => w.end > (a + b) / 2)
    if (i0 < 0) return ''
    while (i0 > 0 && !/[.!?]$/.test(String(cs[i0 - 1].text || ''))) i0--
    let i1 = i0
    while (i1 < cs.length - 1 && !/[.!?]$/.test(String(cs[i1].text || ''))) i1++
    return cs.slice(i0, i1 + 1).map((w) => w.text).join(' ')
  }
  // ── QUAND LA BANQUE NE SAIT RIEN DIRE, LE MOT LE DIT ───────────────────────
  // Axel : « si demain un mec vient avec un thème qui n'a rien à voir — salle de
  // sport, exercices, machines — l'IA sera bloquée et montrera des animations
  // pas cohérentes ». La banque est écrite pour SON vocabulaire ; ailleurs, tous
  // ces « aucun remplaçant » deviennent du visage muet ou, pire, une animation
  // qui ment. Ici on fabrique une scène à partir des mots réellement prononcés :
  // deux ou trois sujets dessinés, dans l'ordre où il les dit. Si on ne sait
  // dessiner AUCUN de ses mots, on ne rend rien — un visuel faux serait pire.
  const sujetsPoses = []
  // ── DANS UNE FENÊTRE À CLIP RÉEL, LE REPLI C'EST LE VISAGE, PAS LE MOT ─────
  // Règle d'Axel : « si tu as un trou tu mets ton avatar principal, ça dynamise
  // et c'est clean ». Une scène du mot posée DANS une fenêtre qui porte un clip
  // lipsync recouvrait l'avatar d'un dégradé quasi nu — les « blancs » des 04 et
  // 05/08. Ici on renonce : la fenêtre reste à l'avatar qui parle. Hors fenêtre
  // à clip, la scène du mot garde toute sa valeur (domaines hors banque).
  const dansClipReel = (a, b) => hasClips && (plan.avatarSegments || []).some((w) =>
    Number.isInteger(w.clip) && w.clip >= 0 && !w.adresse &&
    a < (w.end || 0) - 0.2 && b > (w.start || 0) + 0.2)
  const sceneDuMot = (a, b) => {
    if (dansClipReel(a, b)) return null
    const ph = phraseDe(a, b)
    const su = sujetsDe(ph, 3)
    if (!su.length) return null
    // « pas deux fois la même animation » vaut ICI pour les ICÔNES : un
    // calendrier vu deux fois dans la même vidéo, c'est le même tic. On retire
    // donc les sujets déjà montrés, et on renonce s'il ne reste rien d'inédit.
    const neufs = su.filter((x) => !sujetsPoses.includes(x.sujet))
    if (!neufs.length) return null
    for (const x of neufs) sujetsPoses.push(x.sujet)
    su.length = 0
    su.push(...neufs)
    return { anim: 'sujet', sujets: su, motion: su.length > 1 && estUneSuite(ph) ? 'flow' : 'cascade' }
  }
  const add = (slide, a, b) => {
    // Le filtre doit etre ICI, au seul passage obligé : filtrer la liste ANIMS
    // ne bloquait que mes tables de mots-clés, et les scènes proposées par le
    // chef d'orchestre repassaient devant (clock revenait à 13,8 s).
    // Refusee par Axel ? On ne jette pas : on remplace par celle qu'il a validee
    // pour ce moment-la. Le refus ne doit pas coûter la fenêtre — sinon le trou
    // retombe sur le visage, ce qu'il reproche depuis le debut.
    let nom = String(slide && slide.anim || '')
    // la fenêtre du MOT, telle que l'appelant la donne — avant que fit() et
    // l'étirement ne la déplacent. Les deux gardes plus bas en ont besoin.
    const a0 = a, b0 = b
    let contexte = false   // choix dicté par le sujet de la phrase : il passe devant le garde-fou
    // ── PARLER À CLAUDE, ÇA SE MONTRE PAR LA CONVERSATION ───────────────────
    // « Tu peux maintenant créer n'importe quelle vidéo directement dans
    // Claude » : le chef posait `export` (une icône MP4). Axel : « l'animation
    // quand je dis créer n'importe quelle vidéo dans Claude ne correspond pas
    // et ne montre rien du tout — mets l'animation quand tu écris dans Claude
    // et Claude est en train de réfléchir plutôt ». La phrase ne parle pas d'un
    // fichier, elle parle d'une DEMANDE faite à Claude. Le sujet gagne sur
    // l'objet.
    // ⚠ Jamais sur une scène qui porte une IMAGE : un média de l'utilisateur a
    // bien un champ `anim`, et sans cette exclusion la photo de la fille s'est
    // fait réécrire en `chat` — elle est repassée en médaillon sur la bulle au
    // lieu d'être plein cadre. Ses médias ne se remplacent pas.
    if (isAnimPanel(slide) && !slide.user && !slide.screen && !slide.assetId && !(slide.items || []).length
      && !['media', 'medias', 'chat', 'connect', 'copy', 'type', 'script'].includes(nom)) {
      // …et on lit la PHRASE ENTIÈRE, pas la fenêtre. « créer » et « Claude »
      // sont aux deux bouts de « tu peux maintenant créer n'importe quelle
      // vidéo directement dans Claude » : une fenêtre de 1,5 s n'en voit
      // qu'un des deux, et le sujet de la phrase échappait au test.
      const dit0 = (() => {
        const cs = plan.captions || []
        let i0 = cs.findIndex((w) => w.end > (a + b) / 2)
        if (i0 < 0) return ''
        while (i0 > 0 && !/[.!?]$/.test(String(cs[i0 - 1].text || ''))) i0--
        let i1 = i0
        while (i1 < cs.length - 1 && !/[.!?]$/.test(String(cs[i1].text || ''))) i1++
        return cs.slice(i0, i1 + 1).map((w) => w.text).join(' ')
      })()
      if (/claude/i.test(dit0) && /(cr[ée]er|cr[ée]e|demande|demander|[ée]cri|prompt)/i.test(dit0)) {
        // Si la conversation est DÉJÀ ouverte juste avant, on ne pose pas une
        // deuxième bulle : on laisse la première courir jusqu'au bout de la
        // phrase. Une phrase = une idée = un panneau.
        const ouverte = out.filter((s) => String(s.anim) === 'chat' && !s.screen)
          .find((s) => s.end >= a - 0.6 && s.end <= b)
        // …MAIS JAMAIS AU-DELÀ DE SA PHRASE. Sans cette borne, la bulle s'est
        // étirée de 3,37 à 10,35 s et a avalé la photo de la fille en médaillon,
        // alors qu'Axel la veut plein cadre sur « regarde ça ». Une idée finit
        // avec sa phrase.
        const finDeLaPhrase = (() => {
          const cs = plan.captions || []
          const i = cs.findIndex((w) => w.end > (ouverte ? ouverte.start : a))
          if (i < 0) return b
          for (let k = i; k < cs.length; k++) if (/[.!?]$/.test(String(cs[k].text || ''))) return cs[k].end
          return b
        })()
        if (ouverte && b > finDeLaPhrase + 0.1) {
          if (process.env.DERIVE_DEBUG) console.log(`chat non étiré : ${r2(b)} dépasse la phrase (${r2(finDeLaPhrase)})`)
        } else if (ouverte) {
          const k = taken.findIndex((w) => Math.abs(w[0] - ouverte.start) < 0.01 && Math.abs(w[1] - ouverte.end) < 0.01)
          console.log(`▶ ${nom} absorbé : la conversation avec Claude continue jusqu'à ${r2(b)}s`)
          if (k >= 0) taken[k] = [ouverte.start, b]
          ouverte.end = r2(b)
          return null
        }
        // …ou juste APRÈS : la même phrase peut arriver ici en deux morceaux, et
        // le second était posé le premier. On ouvre alors la bulle plus tôt au
        // lieu d'en poser une seconde.
        const suivante = out.filter((s) => String(s.anim) === 'chat' && !s.screen)
          .find((s) => s.start <= b + 0.6 && s.start >= a)
        if (suivante) {
          const na = r2(Math.min(a, suivante.start))
          if (!taken.some((w) => na < w[1] - 0.05 && suivante.start > w[0] + 0.05
            && !(Math.abs(w[0] - suivante.start) < 0.01))) {
            const k = taken.findIndex((w) => Math.abs(w[0] - suivante.start) < 0.01 && Math.abs(w[1] - suivante.end) < 0.01)
            console.log(`▶ ${nom} absorbé : la conversation avec Claude s'ouvre dès ${na}s`)
            if (k >= 0) taken[k] = [na, suivante.end]
            suivante.start = na
          }
          return null
        }
        if (!dejaVue('chat')) {
          console.log(`▶ ${nom} → chat : « ${dit0.slice(0, 40)} » demande quelque chose À Claude`)
          slide = { ...slide, anim: 'chat' }
          nom = 'chat'
          // Ce choix vient du SUJET de la phrase, pas d'un mot-clé : le garde-fou
          // de `chat` (qui exige d'entendre « Claude » dans la fenêtre) le
          // rejetait aussitôt — « quelle vidéo directement dans » ne le contient
          // pas, alors que la phrase entière parle bien de demander à Claude.
          contexte = true
        }
      }
    }
    // ── LE GARDE-FOU VAUT AUSSI POUR LE CHEF D'ORCHESTRE ────────────────────
    // « le visuel EST le mot » : une animation ne se pose que si la phrase
    // prononcee pendant sa fenetre parle vraiment de son sujet. Ce controle ne
    // s'appliquait qu'a mes tables de mots-cles. Resultat mesure : sur « le
    // SaaS IA peut changer ta vie », le chef d'orchestre posait `logo` — et
    // l'ecran affichait « avatarads.fr » pendant qu'Axel dit « SaaS IA ».
    // Sa proposition n'est pas au-dessus de la regle.
    if (EXIGE_GLOBAL[nom] && !slide.user && !contexte) {
      // …mais un CHOIX EXPLICITE de l'écran « Détails du montage » passe : Axel
      // a remplacé target par lineup et la garde le lui jetait (« j'ai mis
      // lineup mais ça n'a pas marché », 01/08). L'utilisateur a vu sa vidéo et
      // a tranché — le garde-fou vaut pour les propositions, pas pour lui.
      const dansFenetre = (plan.captions || []).filter((w) => w.start < b && w.end > a)
      const dit = dansFenetre.map((w) => w.text).join(' ')
      if (!EXIGE_GLOBAL[nom].test(dit)) {
        // ── UN REFUS NE DOIT PAS CREUSER UN TROU ──────────────────────────
        // Les garde-fous écartent l'animation qui ne correspond pas — c'est
        // leur travail — mais ils ne mettaient RIEN à la place, et la fenêtre
        // retombait sur le visage. Mesuré sur le Cartoon 18 : le chef proposait
        // `avatar` sur « créer une IMAGE, une vidéo ou même un montage » ; le
        // garde-fou l'a écarté (la phrase ne parle pas d'avatar, il avait
        // raison) et ces 4,5 s sont devenues du visage muet. Axel : « pourquoi
        // y'a pas d'animation à […] ? mets-en une ».
        // On cherche donc un REMPLAÇANT dans les mots réellement prononcés, via
        // la même table que les tables locales. Il doit passer son propre
        // garde-fou : on remplace une erreur, on n'en fabrique pas une autre.
        const remp = chercheRemplacant(dit, nom)
        if (!remp) {
          // …et si la banque ne sait rien proposer, on dessine ce qu'il dit.
          const sc = sceneDuMot(a, b)
          if (sc) {
            console.log(`▶ ${nom} écarté sur « ${dit.slice(0, 30)} » → scène du mot : ${sc.sujets.map((x) => x.mot).join(' · ')}`)
            slide = { ...slide, ...sc }
            nom = 'sujet'
            contexte = true
          }
        }
        if (remp) {
          console.log(`▶ ${nom} écarté sur « ${dit.slice(0, 34)} » → remplacé par ${remp}`)
          slide = { ...slide, anim: remp }
          nom = remp
        } else if (nom !== 'sujet') {
          console.log(`▶ ${nom} écarté : « ${dit.slice(0, 42)} » ne parle pas de ça (aucun remplaçant)`)
          return null
        }
      }
      // ── ET ON SE CALE SUR LE MOT QUI VIENT DE LA JUSTIFIER ────────────────
      // Le chef d'orchestre donne à ses scènes des bornes qu'il ESTIME depuis
      // la transcription ; elles tombent à côté. Mesuré sur le Cartoon 18 :
      // `render` s'ouvrait sur « dans », `result` sur « Et », `post` sur
      // « sur » — des mots vides, alors que le mot qui justifie l'animation
      // était deux ou trois mots plus loin. L'écart au mot le plus proche
      // était pourtant de 20 ms : ce n'était pas un décalage de temps, c'était
      // le mauvais mot. Axel : « la synchronisation n'est toujours pas
      // parfaite, faut vraiment être parfait de ce côté. »
      //
      // On vient de tester chaque mot de la fenêtre ; on sait donc lequel a
      // déclenché. La scène commence sur LUI (0,12 s d'avance, comme les
      // beats), à condition qu'il reste assez de place derrière.
      // ⚠ `nom` a pu changer juste au-dessus (substitution) et le remplaçant
      // n'a pas forcément de garde-fou : sans ce test, `.test` de `undefined`
      // fait tomber toute la dérivation.
      const motif = EXIGE_GLOBAL[nom]
      const declencheur = motif ? dansFenetre.find((w) => motif.test(w.text)) : null
      if (declencheur) {
        const na = r2(Math.max(a, declencheur.start - 0.12))
        if (na > a + 0.08 && b - na >= 1.25 && !overlaps(na, b)) {
          console.log(`▶ ${nom} recalé sur « ${declencheur.text} » : ${a}s → ${na}s`)
          a = na
        }
      } else {
        // ── UN PLAN CHANGE SUR UN MOT, JAMAIS AU MILIEU ─────────────────────
        // Axel, 03/08 : « je dis "et voici pourquoi" et à ce moment-là ça
        // devrait changer de frame, pourquoi ça n'a pas changé ? »
        //
        // Le recalage ci-dessus ne s'appliquait qu'aux animations portant un
        // mot OBLIGATOIRE déclaré. Toutes les autres — la majorité — gardaient
        // le temps approximatif du chef d'orchestre, qui raisonne en phrases et
        // arrondit. Une scène pouvait donc démarrer à 7,63 s quand le mot qui
        // la justifie commence à 7,50 : treize centièmes de décalage, invisibles
        // sur le papier, mais l'œil les voit comme un montage mou.
        //
        // On aligne donc TOUTE scène sur le début du mot le plus proche, dans
        // une fenêtre de ±0,35 s — au-delà, ce n'est plus un arrondi, c'est un
        // autre moment, et on ne touche à rien. Les 0,12 s d'avance sont les
        // mêmes que pour les beats : l'image doit être là quand le mot tombe,
        // pas après.
        let meilleur = null, ecart = 0.36
        for (const w of words) {
          const d = Math.abs(w.start - a)
          if (d < ecart) { ecart = d; meilleur = w }
          if (w.start > a + 0.4) break
        }
        if (meilleur) {
          const na = r2(Math.max(0, meilleur.start - 0.12))
          if (Math.abs(na - a) > 0.04 && b - na >= 1.25 && !overlaps(na, b)) {
            console.log(`▶ ${nom} aligné sur « ${meilleur.text} » : ${a}s → ${na}s (${r2(Math.abs(na - a))}s de décalage rattrapé)`)
            a = na
          }
        }
      }
    }
    // ── LA PORTE UNIQUE : UNE BANNIE NE PASSE PAS, ET NE SE REMPLACE PAS ────
    // Axel, 03/08 : « toujours aussi [l'animation de l'écran 4] qu'était censé
    // être bannie ». C'était `calendar` — une grille de calendrier —, bannie
    // depuis des semaines. J'avais retiré la substitution dans la boucle du
    // chef d'orchestre, mais PAS ici : cette porte-ci la remplaçait encore par
    // « la plus proche », et quand aucune proche n'existait, elle la laissait
    // simplement passer telle quelle. C'est par là que `steps`, `calendar` et
    // `clock` sont entrées dans le montage de 15:51.
    //
    // Deux leçons, écrites pour la prochaine fois : un filtre posé ailleurs que
    // sur le passage obligé ne filtre rien, et un `else` qui laisse passer par
    // défaut est un trou, pas un garde-fou. Ici on refuse, sans remplacement —
    // la fenêtre revient au visage (§3b-bis) ou aux scènes voisines (§3c).
    if (REFUSEES.has(nom)) {
      console.log(`▶ « ${nom} » bannie : refusée à ${r2(a)}s — la fenêtre revient au visage`)
      return null
    }
    // ── UNE PHRASE DE LIAISON NE SE DESSINE PAS ─────────────────────────────
    // Axel, 03/08 : « "et voici pourquoi", les transitions comme ça faudrait
    // qu'elles soient mises en avatar par défaut puisqu'elles ne racontent rien,
    // aucune animation ne peut imager ça ».
    //
    // C'est le principe qui manquait. Jusqu'ici le moteur cherchait un visuel
    // pour CHAQUE fenêtre, y compris celles où la voix ne nomme rien : « et
    // voici pourquoi », « du coup », « alors voilà ». Il finissait par poser la
    // moins mauvaise animation — donc une animation au hasard, exactement ce
    // qu'il reproche depuis deux jours.
    //
    // Une fenêtre qui ne contient QUE des mots de liaison n'a pas de visuel à
    // trouver : elle a un visage à montrer. On refuse, et §3b-bis la rend à
    // l'avatar. Le refus est journalisé pour qu'on puisse mesurer combien de
    // fenêtres partent ainsi.
    //
    // Le test est volontairement strict : il suffit d'UN mot porteur — un nom,
    // un verbe d'action, un chiffre — pour que l'animation reste autorisée. On
    // ne refuse que le vide.
    if (!slide.user && !slide.screen && !slide.assetId && !(slide.items || []).length) {
      const dedans = words.filter((w) => w.start >= a0 - 0.2 && w.start <= b0 + 0.1)
      const porteur = dedans.some((w) => {
        const n = norm(w.text)
        return n.length >= 4 && !LIAISONS.has(n)
      })
      if (dedans.length && !porteur) {
        console.log(`▶ ${nom} refusée à ${r2(a)}s : « ${dedans.map((w) => w.text).join(' ')} » ne nomme rien — la fenêtre revient au visage`)
        return null
      }
    }
    // ── UNE CAPTURE SANS FICHIER N'EST PAS UNE SCÈNE ────────────────────────
    // `screen` et `result` sont dans la banque (le chef a le droit de les
    // demander), mais ce ne sont pas des animations : ce sont des IMAGES. Le
    // chef les propose aussi en beat, sans capture — mesuré sur Cartoon 18 :
    // `screen@Regarde` a rendu 1,65 s de carte cadrée sur une image cassée
    // (src vide), et le `result` du chef 3,15 s de téléphone noir. Un panneau
    // qui encadre du vide est pire que pas de panneau : rien d'autre ne peut
    // prendre la fenêtre.
    if (String(slide.anim) === 'screen' && !slide.screen) {
      console.log('▶ screen écarté : aucune capture à montrer')
      return null
    }
    if (String(slide.anim) === 'result' && !slide.screen && !slide.userFile) {
      console.log('▶ result écarté : ni capture ni résultat utilisateur à montrer')
      return null
    }
    ;[a, b] = slide.user ? [a, b] : fit(a, b)   // la fenêtre d'un choix explicite ne bouge pas
    // SON MEDIA A DROIT AU FLASH. Une enumeration — « homme, femme, coach
    // sportif » — laisse 0,4 s par mot : au plancher commun, les deux dernieres
    // photos disparaissaient et l'enumeration retombait sur du texte. Une photo
    // vue 0,4 s sur SON mot vaut mieux qu'une photo juste, jetee.
    const floor = slide.anim === 'media' ? 0.35 : isAnimPanel(slide) ? 1.25 : 0.8
    // ── ON ÉTIRE AVANT DE JETER ────────────────────────────────────────────
    // Mesuré sur Cartoon 17 : 16 idées sur 23 « sans place », rejetées à 0,28 s,
    // 0,71 s, 0,83 s, 0,94 s… Le mot dure ce qu'il dure ; exiger 1,25 s sur le
    // mot seul revenait à tout jeter, et le trou retombait sur le visage —
    // Axel : « on voit beaucoup trop l'avatar principal et pas assez les
    // animations ». L'animation garde son ancrage sur le mot et grandit dans le
    // temps LIBRE autour (donc pris au visage, jamais à un autre panneau).
    if (b - a < floor && isAnimPanel(slide)) {
      const PAS = 0.05
      let na = a, nb = b
      for (let k = 0; k < 80 && nb - na < floor; k++) {
        const apres = r2(nb + PAS)
        if (!overlaps(nb, apres)) { nb = apres; continue }
        const avant = r2(Math.max(0, na - PAS))
        if (avant < na && !overlaps(avant, na)) { na = avant; continue }
        break
      }
      if (nb - na >= floor) { a = na; b = nb }
    }
    if (b - a < floor) {
      if (isAnimPanel(slide) && b - a > 0.2) console.log(`▶ ${slide.anim} écarté : ${r2(b - a)}s même après étirement`)
      return null
    }
    // ── SEPT CENTIÈMES NE VALENT PAS UNE SCÈNE PERDUE ───────────────────────
    // Deux idées qui se suivent de près se recouvrent d'un cheveu : `rocket`
    // sur « sortir » finissait à 4,25 s et `type` sur « créer » commençait à
    // 4,18 s — 0,07 s de chevauchement, et l'animation entière était jetée.
    // Mesuré sur le Cartoon 18 : c'est ce qui laissait « tu peux maintenant
    // créer n'importe quelle vidéo directement dans Claude » sans le moindre
    // visuel. Quand la gêne est au BORD et qu'il reste de quoi faire une
    // scène, on décale au lieu de renoncer.
    if (overlaps(a, b)) {
      let na = a
      for (const w of taken) {
        if (a < w[1] - 0.05 && b > w[0] + 0.05 && w[1] > na && w[1] - a <= 0.7) na = r2(w[1] + 0.02)
      }
      if (na > a && b - na >= floor && !overlaps(na, b)) {
        console.log(`▶ ${nom} décalé de ${r2(na - a)}s pour libérer le bord (${a}→${na}s)`)
        a = na
      } else {
        // ── LA SCÈNE D'AVANT PEUT SE POUSSER, SI ELLE SURVIT ────────────────
        // Deux idées trop rapprochées : la première prenait tout et la seconde
        // n'existait jamais. Mesuré — « lancer un BUSINESS sans jamais passer
        // devant une CAMÉRA » : `grow` occupait 44,48→46,27 et `faceless` se
        // retrouvait avec 0,91 s, sous le plancher. Axel, quatre fois de
        // suite : « sans jamais passer devant une caméra, toujours pas ».
        // On propose donc à l'animation qui gêne de se rogner — mais seulement
        // si elle garde de quoi exister ET si la nouvelle en profite vraiment.
        // Personne n'est sacrifié : soit les deux tiennent, soit rien ne bouge.
        const gene = out.filter((s) => a < s.end - 0.05 && b > s.start + 0.05)
        const seul = gene.length === 1 ? gene[0] : null
        if (seul && isAnimPanel(seul) && !seul.user && !seul.assetId && !seul.screen
          && seul.start < a && seul.end > a) {
          const finSeul = r2(a - 0.05)
          if (finSeul - seul.start >= floor && b - a >= floor) {
            const k = taken.findIndex((w) => Math.abs(w[0] - seul.start) < 0.01 && Math.abs(w[1] - seul.end) < 0.01)
            console.log(`▶ ${seul.anim || seul.type} rogné (${seul.end}→${finSeul}s) pour que ${nom} tombe sur son mot`)
            if (k >= 0) taken[k] = [seul.start, finSeul]
            seul.end = finSeul
          } else return null
        } else return null
      }
    }
    // ── DEUX GARDES NÉES DE LA RÉSERVATION FANTÔME DU 31/07 ─────────────────
    // Le chef d'orchestre donnait easyup DEUX fois : une slide (17,88→21,38) et
    // un beat sur « zéro ». L'ancre du beat étant couverte par son jumeau,
    // fit() le délogeait et l'étirement le faisait grandir ENTIÈREMENT hors de
    // son mot — posé à 21,43→22,72, pile sur « cent pourcents des bénéfices »,
    // en volant la fenêtre que gaugefill (demandé avec « 100% ») venait chercher
    // sur SON mot. Même maladie mesurée sur salesphone (3,52→4,79 contre la
    // carte 4,74→6,02) et tsunami (8,25→9,53 contre 9,48→11,25).
    if (isAnimPanel(slide) && !slide.user) {
      // 1 · JAMAIS DEUX FOIS LA MÊME ANIMATION DANS LA VIDÉO. La garde ne valait
      //     que pour deux poses DOS À DOS (0,6 s) : sur la v12, `chat` est
      //     quand même sorti QUATRE fois — à 3,4 s, 6,1 s, 18,2 s et 33 s. Axel :
      //     « la vidéo est chelou, il met l'animation chat avec Claude, après un
      //     écran MP4, après il remet le chat avec Claude, ça va pas […] ajoute
      //     une règle genre pas 2 fois la même animation dans la même vidéo ».
      //     Revue une seconde fois, une animation n'illustre plus, elle meuble.
      //     Comme pour un garde-fou, on cherche d'abord une inédite qui colle
      //     aux mots prononcés : un doublon refusé ne doit pas rendre la fenêtre
      //     au visage.
      if (nom !== 'connect' && !slide.screen && !slide.assetId && estLaConnexion(a, b)) {
        console.log(`▶ ${nom} → connect à ${r2(a)}s : « est connecté à » se montre par les deux logos et la coche`)
        slide = { ...slide, anim: 'connect', assets: ['logo-avatarads', 'logo-claude'] }
        nom = 'connect'
        contexte = true
      }
      if (nom && dejaVue(nom) && !(nom === 'connect' && estLaConnexion(a, b))) {
        const dit2 = (plan.captions || []).filter((w) => w.start < b && w.end > a).map((w) => w.text).join(' ')
        const remp2 = chercheRemplacant(dit2, nom)
        if (remp2) {
          console.log(`▶ ${nom} déjà vue → remplacée par ${remp2} à ${r2(a)}s`)
          slide = { ...slide, anim: remp2 }
          nom = remp2
        } else {
          // la banque est à court : on dessine les mots de la phrase.
          const sc = sceneDuMot(a, b)
          if (!sc) {
            console.log(`▶ ${nom} écarté : déjà vue à ${r2((out.find((s) => String(s.anim) === nom) || {}).start)}s (aucune inédite pour « ${dit2.slice(0, 30)} »)`)
            return null
          }
          console.log(`▶ ${nom} déjà vue → scène du mot à ${r2(a)}s : ${sc.sujets.map((x) => x.mot).join(' · ')}`)
          slide = { ...slide, ...sc }
          nom = 'sujet'
        }
      }
      // 2 · L'ANCRE RESTE DANS LA FENÊTRE. L'étirement est fait pour grandir
      //     AUTOUR du mot ; quand fit() a tout rogné, il grandissait à côté, et
      //     l'animation s'affichait sur les mots de quelqu'un d'autre — « le
      //     visuel EST le mot » interdit exactement ça.
      const m0 = (a0 + b0) / 2
      if (m0 < a - 0.1 || m0 > b + 0.1) {
        if (process.env.DERIVE_DEBUG) console.log(`REJET hors-ancre ${nom} ${r2(a).toFixed(2)}→${r2(b).toFixed(2)} (mot à ${r2(m0)})`)
        return null
      }
    }
    const s = { ...slide, start: r2(a), end: r2(b) }
    out.push(s)
    if (process.env.DERIVE_DEBUG) console.log(`POSE  ${r2(a).toFixed(2).padStart(6)} → ${r2(b).toFixed(2).padStart(6)}  ${s.type || 'card'} ${s.anim || ''} ${(s.title || '').slice(0, 28)}`)
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

  // ── LES CHOIX DE L'ÉCRAN « DÉTAILS DU MONTAGE » PASSENT EN PREMIER ─────────
  // L'utilisateur a déjà VU sa vidéo et a tranché : ce qu'il a remplacé est posé
  // tel quel (plan.userSlides), ce qu'il a supprimé devient une fenêtre de
  // VISAGE (plan.userBans — sa règle : « supprimer = l'avatar principal reprend
  // l'écran »). Réservé avant tout le reste : rien ne déloge un choix explicite.
  {
    let nu = 0, nb = 0
    for (const u of plan.userSlides || []) {
      const a = r2(u.start || 0), b = r2(u.end ?? a + 1.5)
      // un MÉDIA ajouté depuis « Détails du montage » arrive avec son assetId :
      // on résout le fichier local ici (le moteur lit slide.src, pas l'id)
      if (u.anim === 'media' && u.assetId && (opts.assetFiles || {})[u.assetId]) u.src = (opts.assetFiles || {})[u.assetId]
      // media EN COUCHE (« le média se pose dessus, sans supprimer le module »)
      // → jamais une scène à part : attaché à la fin à ce qui occupe la fenêtre
      if (u.layer && u.anim === 'media' && u.src) { (plan.__mediaLayers = plan.__mediaLayers || []).push({ src: u.src, assetId: u.assetId, pos: u.pos, start: a, end: b }); continue }
      // ── LE CHEF D'ORCHESTRE PERSONNALISE SON CHOIX ──────────────────────────
      // Une animation choisie dans la banque arrive NUE (pas d'items, pas de
      // valeur) : lineup rendait une étagère vide pendant qu'Axel dit « produit
      // physique, coaching, formation ». On la remplit avec CE QUI EST DIT dans
      // sa fenêtre — la valeur = le nombre prononcé, les items = les mots forts,
      // chacun sur SON instant (it.t absolu, la convention du pack).
      if (u.anim && u.anim !== 'media') {
        const caps = (plan.captions || []).filter((c) => c.start >= a - 0.05 && c.start < b)
        if (!/\d/.test(String(u.value || ''))) {
          const num = caps.map((c) => String(c.text)).find((t) => /\d/.test(t))
          if (num) { u.value = num.replace(/[^\d]/g, ''); u.unit = u.unit || '' }
        }
        // des items PRÉSENTS sont un choix (même vides : « rien d'écrit » est
        // une décision de l'utilisateur) — on ne remplit que l'ABSENCE
        if (!(u.items || []).length) {
          const clean = (t) => String(t).replace(/[.,!?…«»]/g, '')
          const forts = caps.filter((c) => c.accent || clean(c.text).length >= 5)
          u.items = (forts.length ? forts : caps).slice(0, 4)
            .map((c) => ({ t: r2(c.start), text: clean(c.text), label: '', value: '' }))
        }
      }
      if (b - a >= 0.6 && add({ ...u, user: true }, a, b)) nu++
    }
    for (const u of plan.userBans || []) {
      const a = r2(u.start || 0), b = r2(u.end ?? a + 1)
      if (b - a < 0.6 || overlaps(a, b)) continue
      // clip: -1 — fenêtre née ici, aucun clip lipsync ne lui appartient (le
      // worker mappe les clips par indice : sans cette marque, elle volait
      // celui de la fenêtre suivante et les lèvres disaient d'autres mots)
      // …SAUF si elle recouvre une fenêtre du plan qui portait un clip et que
      // les débuts coïncident : le clip payé dit exactement ces mots-là, on le
      // REPREND au lieu de figer la photo (Axel 07/08, « à 13 s le lipsync
      // manque » — même mécanique ici que pour les adresses de §0b).
      const src = clipPourFenetre(a, b)
      ;(plan.avatarSegments = plan.avatarSegments || []).push({ start: a, end: b, adresse: true, clip: src ? src.clip : -1 })
      claim(a, b); nb++
    }
    if (nu || nb) console.log(`▶ choix utilisateur : ${nu} remplacement(s) posé(s) · ${nb} suppression(s) rendue(s) au visage`)
  }

  // ── LE RÉSULTAT MONTRÉ EST LE SIEN ──────────────────────────────────────────
  // Un asset utilisateur dont l'id dit « resultat » remplace la capture de démo
  // 99-resultat dans les scènes result : montrer le résultat d'un AUTRE serait
  // faux — et le texte tapé dans la visite guidée décrit SON image (retour
  // d'Axel 31/07 : « ce qui est écrit doit correspondre au résultat que tu
  // montres après »).
  {
    const rk = Object.keys(opts.assetFiles || {}).find((k) => /result/i.test(k))
    if (rk) for (const sl of plan.slides || []) if (sl.anim === 'result') sl.userFile = (opts.assetFiles || {})[rk]
  }

  // ── 0 · LE HOOK EST UN VISAGE ───────────────────────────────────────────────
  // Une vidéo face caméra s'ouvre sur celui qui parle, pas sur une forme. La
  // fenêtre avatar du début était calculée en §3b, DANS LES ZONES LIBRES : les
  // animations du chef d'orchestre l'occupaient déjà et le hook sautait — Axel,
  // sur Cartoon 16 : « le hook je le vois plutôt en split screen avec Alex en
  // bas ». Elle est donc réservée en premier, avant tout le reste.
  // ── LE HOOK DURE 3 À 4 SECONDES, PAS SIX ET DEMIE ─────────────────────────
  // Axel (02/08) : « "tu peux maintenant créer n'importe quelle vidéo dans
  // Claude" ce n'est plus le hook, le hook c'est 3-4 sec, là il aurait fallu
  // une animation ». La réservation montait jusqu'à 6,5 s : elle avalait la
  // phrase suivante, et aucune animation ne pouvait s'y poser puisque la
  // fenêtre était déjà prise. Le visage garde l'ouverture — sa règle tient —
  // mais il la garde le temps d'une ouverture.
  const HOOK_MAX = 4.2
  let hookWin = null
  {
    const segs = (plan.avatarSegments || []).slice().sort((a, b) => (a.start || 0) - (b.start || 0))
    const s0 = segs[0]
    if (s0 && (s0.start || 0) < 0.6) {
      const a = r2(s0.start || 0)
      // ── UN VRAI CLIP JOUE SA DURÉE, PAS SIX SECONDES ET DEMIE ──────────────
      // Fenêtre à clip lipsync réel (w.clip ≥ 0, bornée à la durée du clip par
      // le worker) : la rogner à 6,5 s fige l'avatar et laisse un dégradé nu
      // derrière (Axel 05/08 : « le lipsync n'est pas fait dans toute la
      // vidéo »). Le clip DIT ces secondes-là — on le laisse parler (plafond
      // 12 s, même garde anti-fenêtre-géante qu'en §2b). Le contenu réel qui
      // tombe dedans passe devant : médaillon §0a, ou réservation déjà posée
      // (on s'arrête au premier bord pris). Sans clip, le plafond 4,2 s tient.
      const clipReel = hasClips && Number.isInteger(s0.clip) && s0.clip >= 0
      const plafond = clipReel ? 12 : (hasClips ? 6.5 : HOOK_MAX)
      let b = r2(Math.min(s0.end ?? a + 4, a + plafond, D))
      for (const t of taken) if (a < t[0] && b > t[0]) b = r2(t[0] - 0.05)
      // sans clip lipsync, on rogne AUSSI la fenêtre elle-même : sinon elle
      // continue de s'afficher jusqu'à 6,5 s et la place reste occupée.
      if (!hasClips && (s0.end ?? 0) > b) s0.end = b
      if (b - a >= 1.2) { hookWin = { start: a, end: b }; claim(a, b) }
    } else if (!noFace && !hasClips) {
      // ── LE FILET DU CHEMIN PHOTO (MCP) ──────────────────────────────────────
      // RÈGLE NON NÉGOCIABLE d'Axel : « l'avatar principal doit TOUJOURS être
      // dans le hook ». Mesuré sur Cartoon 18 (02/08) : le chef d'orchestre a
      // donné UNE fenêtre géante 4,24 → 48,42 s — elle commence après 0,6 s,
      // donc la réservation ci-dessus ne s'armait pas, et la vidéo s'ouvrait
      // sur une carte `zoompunch` vide au lieu de son visage. Ici il n'y a PAS
      // de clip lipsync (photo d'avatar en zoom lent, ou découpe de sa propre
      // vidéo) : avancer la fenêtre à 0 ne désynchronise rien. On étire donc
      // la première fenêtre jusqu'au début — et s'il n'y en a aucune, on en
      // crée une (`clip: -1` : aucun clip ne lui appartient, photo en repli).
      const retard = s0 ? r2(s0.start || 0) : null
      if (s0) s0.start = 0
      else (plan.avatarSegments = plan.avatarSegments || []).push({ start: 0, end: r2(Math.min(4, D)), clip: -1 })
      const w0 = s0 || plan.avatarSegments[plan.avatarSegments.length - 1]
      const b = r2(Math.min(w0.end ?? 4, HOOK_MAX, D))
      if ((w0.end ?? 0) > b) w0.end = b
      if (b >= 1.2) {
        hookWin = { start: 0, end: b }
        claim(0, b)
        console.log(`▶ hook : l'avatar principal ramené à l'ouverture (0→${b}s — le chef le faisait entrer ${retard === null ? 'jamais' : 'à ' + retard + 's'})`)
      }
    } else if (s0 && hasClips) {
      // Avec des clips lipsync déjà générés, on ne peut PAS avancer la fenêtre :
      // le clip couvre d'autres mots, les lèvres mentiraient. La vraie garantie
      // est en amont (orchestrate force une fenêtre qui couvre le début, AVANT
      // la génération des clips) — si on passe ici, c'est un plan d'avant le
      // correctif : on le dit au lieu de le taire.
      console.warn(`⚠ hook sans visage : première fenêtre avatar à ${r2(s0.start || 0)}s et clips lipsync déjà générés — plan d'orchestrate antérieur au correctif`)
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
    // ── LE NOM DU MÉDIA MATCHE MÊME AU PLURIEL / FLÉCHI (Axel, 11/08) ──────────
    // « influenceuse IA » nommait la photo, mais la voix dit « influenceuseS » :
    // l'égalité stricte échouait et un graphe gagnait le créneau à la place de
    // l'image de la fille. On aligne donc le matching du nom sur celui des anims
    // (§2b) : égalité, OU le mot dit commence par le mot du nom (≥5 lettres), OU
    // l'inverse — jamais une sous-chaîne libre (le piège « IA » dans « SasIA »).
    // …ET MÊME DERRIÈRE UNE ÉLISION (14/08) : « d'influenceuses » se normalise en
    // « dinfluenceuses » — le d' collé faisait rater la 1re mention (10,3 s) et la
    // photo partait s'ancrer sur « influenceuse » à 14,3 s, en plein mur. On essaie
    // donc AUSSI la forme sans la consonne d'élision (d/l/j/m/n/s/t/c + voyelle).
    const matchNom = (mots, nw) => {
      const sansElision = /^[dljmnstc][aeiouy]/.test(nw) ? nw.slice(1) : ''
      return mots.some((m) => [nw, sansElision].some((f) => f &&
        (f === m || (m.length >= 5 && f.startsWith(m)) || (f.length >= 5 && m.startsWith(f)))))
    }
    // ⚠ DÉCOUPER AVANT DE NORMALISER (14/08) : norm() mange AUSSI les espaces et
    // tirets — norm('influenceuse-ia-femme-brune') donnait UN token géant
    // « influenceuseiafemmebrune », que seul le singulier exact « influenceuse »
    // matchait par préfixe. La photo s'ancrait donc à 14,3 s (en plein mur) au
    // lieu de 10,3 s « d'influenceuses ». On découpe le nom d'abord, on
    // normalise chaque morceau ensuite.
    const motsDuNom = (id) => String(id || '').split(/[^a-zA-Z0-9À-ſ]+/)
      .map((x) => norm(x)).filter((x) => x.length > 3)
    // ── UN MÉDIA FOURNI EST TOUJOURS PLACÉ. LE CHEF CHOISIT L'INSTANT ─────────
    // Règle d'Axel (02/08) : « les médias que l'user envoie doivent être placés
    // à 100 %, le chef d'orchestre choisit juste le moment le plus propice ».
    // Trois montages de suite l'ont prouvée nécessaire : avec exactement le
    // même brief, le chef a repris la démo AvatarAds×Claude deux fois puis l'a
    // oubliée la troisième — « sur la vidéo il n'y a plus le mp4 dans le hook ».
    // Un fichier qu'on a pris la peine de fournir ne peut pas dépendre de
    // l'humeur d'un modèle. S'il manque au plan, on lui fabrique un moment.
    {
      const auPlan = new Set((plan.broll || []).map((b) => b.assetId))
      for (const id of Object.keys(files)) {
        if (auPlan.has(id)) continue
        // Son NOM dit ce qu'il montre : c'est aussi ce qui indique QUAND.
        const mots = motsDuNom(id)
        let quand = null
        if (/hook|intro|debut/.test(norm(id))) {
          quand = [0.4, Math.min(4.2, D)]                 // le hook : dès l'ouverture
        } else {
          // le premier moment où la voix prononce un des mots de son nom — de
          // préférence HORS accroche (≥ 5 s) : ancré dans le hook, le média se
          // rend en médaillon minuscule alors que sa mention décrite plus loin
          // lui donne le plein cadre (la brune sur « d'influenceuses », 10,3 s).
          const w = words.find((x) => (x.start || 0) >= 5 && matchNom(mots, norm(x.text)))
            || words.find((x) => matchNom(mots, norm(x.text)))
          // +2,3 s et pas plus : à +2,8 la fenêtre avalait le créneau de la
          // capture suivante (« génère une photo » à 12,64 s, écran Images IA).
          if (w) quand = [r2(Math.max(0, w.start - LEAD)), r2(Math.min(D, w.start + 2.3))]
        }
        if (!quand || quand[1] - quand[0] < 1.2) continue
        ;(plan.broll = plan.broll || []).push({ start: quand[0], end: quand[1], assetId: id, __force: true })
        console.log(`▶ média « ${id} » absent du plan du chef → placé d'office (${quand[0]}→${quand[1]}s)`)
      }
    }
    // ── UN MÉDIA VA SUR SA PREMIÈRE MENTION, PAS SUR LA DERNIÈRE ─────────────
    // Axel, 03/08 : « pourquoi le mp4 Claude × AvatarAds se retrouve là ????? »
    // Son fichier `demo-avatarads-connecte-a-claude.mp4` était posé à 33,9 s, sur
    // un « à AvatarAds » de fin, alors qu'il prononce « Claude » et « AvatarAds »
    // dès l'ouverture. Le chef d'orchestre l'avait bien placé — la règle du
    // placement d'office ne se déclenche donc pas — mais il avait choisi la
    // DERNIÈRE occurrence du mot au lieu de la première.
    //
    // Or un média répond à une attente : il doit arriver quand le spectateur se
    // demande « à quoi ça ressemble ? », c'est-à-dire au moment où le sujet est
    // ANNONCÉ. Trente secondes plus tard, la question est passée et l'image
    // ressemble à un cheveu sur la soupe.
    //
    // On ne déplace que si l'écart est franc (plus de 4 s) et que la première
    // mention porte un mot du NOM du fichier — jamais sur une coïncidence de
    // mot court, d'où le filtre à plus de 3 lettres déjà appliqué plus haut.
    {
      const files2 = opts.assetFiles || {}
      for (const b of plan.broll || []) {
        if (!files2[b.assetId] || b.hook || b.__force) continue
        const mots = motsDuNom(b.assetId)
        if (!mots.length) continue
        const prem = (plan.captions || []).find((w) => matchNom(mots, norm(String(w.text || ''))))
        if (!prem) continue
        const cible = r2(Math.max(0, prem.start - LEAD))
        const ecart = (b.start || 0) - cible
        // Une VIDÉO nommée se cale sur son mot dans les DEUX sens : une démo ne
        // vit qu'à son moment (« danser » à 20 s, pas sur « danses » à 9,7 s si le
        // chef s'est trompé d'occurrence). Une image, elle, ne remonte que si
        // elle est en retard — la déplacer en avant casserait les doubles poses
        // voulues (solo + mur).
        const estVid = /\.(mp4|mov|webm|m4v)$/i.test(String(files2[b.assetId] || ''))
        if (estVid ? Math.abs(ecart) <= 4 : ecart <= 4) continue
        const duree = Math.max(1.4, (b.end || 0) - (b.start || 0))
        console.log(`▶ média « ${b.assetId} » recalé sur sa 1re mention « ${prem.text} » : ${r2(b.start)}s → ${cible}s (écart ${r2(ecart)}s)`)
        b.start = cible
        b.end = r2(Math.min(D, cible + duree))
      }
    }

    // ── UN MÉDIA NOMMÉ NE RESTE PAS PETIT DANS LE HOOK S'IL EST DÉCRIT PLUS TARD ──
    // Axel : « je veux VOIR l'image de la fille » (11/08), « l'image de la fille
    // en MOYEN avec l'avatar qui parle derrière » (05/08). Le chef pose souvent
    // la photo sur la PREMIÈRE mention de son sujet — qui tombe dans le hook
    // (« faire des influenceuses IA », 1,3 s), où elle se rend en tout petit
    // médaillon de coin (règle Léna du 31/07 : dans l'accroche elle reste petite).
    // Or ce même sujet est re-nommé plus loin, là où il le DÉCRIT (« génère une
    // photo de ton influenceuse… des photos d'elle », 14 s), et là elle mérite
    // le MOYEN centré. On la déplace donc du hook vers sa première mention
    // ≥ 5 s : le hook garde son avatar plein cadre, la photo arrive quand on la
    // décrit. Jamais pour un média marqué hook (l'user l'a voulu dans l'accroche).
    {
      const caps = plan.captions || []
      for (const b of plan.broll || []) {
        if (!files[b.assetId] || b.hook || b.__force) continue
        if ((b.start || 0) >= 5) continue                 // déjà hors accroche → il se rendra en moyen tel quel
        const mots = motsDuNom(b.assetId)
        if (!mots.length) continue
        const tard = caps.find((w) => (w.start || 0) >= 5 && matchNom(mots, norm(String(w.text || ''))))
        if (!tard) continue
        const duree = Math.max(1.6, (b.end || 0) - (b.start || 0))
        const a2 = r2(Math.max(5, (tard.start || 0) - LEAD))
        console.log(`▶ média « ${b.assetId} » sorti du hook (${r2(b.start)}s, petit) → sa mention décrite « ${tard.text} » à ${a2}s (moyen, avatar derrière)`)
        b.start = a2
        b.end = r2(Math.min(D, a2 + duree))
      }
    }

    // ── UNE ÉNUMÉRATION = UN PANNEAU, PAS TROIS ────────────────────────────────
    // « Homme, femme, coach sportif » : trois mots en 1,3 s. Une photo par mot
    // donnerait des panneaux de 0,3 s — plus courts que la transition elle-même
    // (0,42 s), donc jamais vus, et le moteur les écartait un par un. La bonne
    // lecture d'une énumération, c'est de TOUT montrer en même temps et
    // d'allumer chaque photo sur SON mot. Le visuel reste le mot, et il tient.
    // ── « REGARDE ÇA » EST L'ORDRE D'AFFICHER, PAS L'ANNONCE ────────────────
    // Quand la voix DÉSIGNE quelque chose, l'image doit déjà être là : le
    // spectateur suit le doigt, pas la légende. Mesuré sur la v12 — Axel dit
    // « Regarde ça » à 6,32 s et la photo n'arrivait qu'à 7,50 s, sur
    // « qualité » ; entre les deux il regardait une bulle de chat. Lui :
    // « quand je dis "regarde ça" faudrait que l'image de la fille soit déjà
    // là ». On remonte donc le média jusqu'au mot qui le désigne, quand il
    // tombe dans les deux secondes qui précèdent.
    {
      const DESIGNE = /^(regarde|regardez|regardes|voil[àa]|voici|tiens|mate|matez|check)[.,!?]*$/i
      for (const b of plan.broll || []) {
        if (!files[b.assetId] || b.hook) continue
        const cue = (plan.captions || []).filter((w) => w.start < b.start && w.start >= b.start - 2)
          .find((w) => DESIGNE.test(String(w.text || '').trim()))
        if (!cue) continue
        const na = r2(Math.max(0, cue.start - 0.12))
        if (na >= b.start - 0.15) continue
        console.log(`▶ média avancé sur « ${cue.text} » : ${r2(b.start)}s → ${na}s (la voix le désigne)`)
        b.start = na
        if (b.end < na + 1.4) b.end = r2(na + 1.4)
      }
    }
    // ── UN MÉDIA NOMMÉ PAR LA VOIX A DROIT À SON PANNEAU (chef-proof) ─────────
    // Le chef change d'avis d'un run à l'autre : sur v7 il a mis les 7 médias en
    // MÉDAILLON → plus de brune plein cadre sur « influenceuses IA » (10,3 s), et
    // la vidéo « danser » repêchée en couche sur un écran à 21 s au lieu de plein
    // cadre sur son mot (20,06 s). Garantie de dérivation : le média HÉROS
    // (influenceus|brune|hero) et toute VIDÉO nommée obtiennent une entrée broll
    // sur leur 1re mention ≥ 5 s s'ils n'en ont pas déjà une hors accroche —
    // quoi que le chef ait décidé.
    {
      const estVid2 = (id) => /\.(mp4|mov|webm|m4v)$/i.test(String(files[id] || ''))
      for (const id of Object.keys(files)) {
        if (id === 'avatar' || /^avatar-\d+$/.test(id)) continue
        const hero = /influenceus|brune|hero/i.test(id)
        if (!hero && !estVid2(id)) continue
        if ((plan.broll || []).some((b) => b.assetId === id && (b.start || 0) >= 4.5)) continue
        const mots = motsDuNom(id)
        if (!mots.length) continue
        const w = (plan.captions || []).find((c) => (c.start || 0) >= 5 && matchNom(mots, norm(String(c.text || ''))))
        if (!w) continue
        const a2 = r2(Math.max(5, (w.start || 0) - LEAD))
        const e2 = r2(Math.min(D, a2 + (estVid2(id) ? 1.6 : 2.9)))
        ;(plan.broll = plan.broll || []).push({ assetId: id, start: a2, end: e2 })
        console.log(`▶ média « ${id} » : panneau garanti sur « ${w.text} » (${a2}→${e2}s) — le chef l'avait laissé sans place`)
      }
    }
    // ── « GÉNÈRE UNE PHOTO (D'IDENTITÉ) DE TON X » → LA PHOTO DE X, SEULE ─────
    // Axel (14/08) : « là l'image de la fille seule aurait dû apparaître, et
    // juste après l'animation avec les autres images — c'est plus cohérent ».
    // La voix annonce un RÉSULTAT (« génère une photo d'identité de ton
    // influenceuse ») : on montre le résultat — la photo du héros plein cadre —
    // pas une capture d'app. Deuxième apparition assumée : la première dit le
    // sujet (« danses TikTok d'influenceuses »), celle-ci montre ce que l'outil
    // produit. Le mur (« dizaines de photos ») enchaîne juste derrière.
    {
      const hero2 = Object.keys(files).find((id) =>
        /influenceus|brune|hero/i.test(id) && !/\.(mp4|mov|webm|m4v)$/i.test(String(files[id] || '')))
      if (hero2) {
        const iGen = words.findIndex((w2, i2) => /^(gener|genere|cree|crees)/.test(norm(w2.text))
          && words.slice(i2 + 1, i2 + 5).some((x) => norm(x.text).startsWith('photo'))
          && words.slice(i2 + 1, i2 + 8).some((x) => matchNom(motsDuNom(hero2), norm(x.text))))
        if (iGen >= 0) {
          const aG = r2(Math.max(0, words[iGen].start - LEAD))
          // la PREMIÈRE apparition du héros (posée bien avant, sur son sujet) se
          // rogne pour laisser la place au résultat — sans ça elle « occupait »
          // déjà l'instant et cette règle ne posait jamais rien.
          const chev = (plan.broll || []).find((b) => b.assetId === hero2
            && (b.start || 0) < aG - 2 && (b.end || 0) > aG - 0.05)
          if (chev) chev.end = r2(Math.max((chev.start || 0) + 0.9, aG - 0.05))
          const dejaLa = (plan.broll || []).some((b) => b.assetId === hero2
            && Math.abs((b.start || 0) - aG) < 1.2)
          if (!dejaLa) {
            const eG = r2(Math.min(D, aG + 2.4))
            ;(plan.broll = plan.broll || []).push({ assetId: hero2, start: aG, end: eG })
            console.log(`▶ « ${words[iGen].text} une photo… » → la photo « ${hero2} » seule (${aG}→${eG}s), le résultat avant le mur`)
          }
        }
      }
    }
    const brut = (plan.broll || []).slice().sort((a, c) => (a.start || 0) - (c.start || 0))
      .filter((b) => files[b.assetId])
    // ── « DES DIZAINES DE PHOTOS D'ELLE » = UN MUR DE PHOTOS (Axel, 11/08) ──────
    // Quand il annonce l'ABONDANCE (« crée des dizaines de photos d'elle »), une
    // seule image ne la dit pas. On rassemble TOUS les médias fournis en un mur :
    // l'image en grand en haut, la grille de clichés en dessous (moteur
    // `photowall`). Le visuel EST le mot « dizaines ». Déclenché seulement s'il a
    // fourni assez de photos (≥3) et sur la phrase qui parle de plusieurs photos.
    {
      // le mur ne prend que des IMAGES : une vidéo (ex. l'influenceuse qui danse)
      // se place à part, sur son propre mot (« danser ton influenceuse »).
      const estImg = (b) => !/\.(mp4|mov|webm|m4v)$/i.test(String(files[b.assetId] || ''))
      const dispo = brut.filter((b) => !b.__pose && estImg(b))
      if (dispo.length >= 3) {
        const caps = plan.captions || []
        const cue = caps.find((w, i) => {
          const t = norm(String(w.text || ''))
          if (!(t === 'photos' || t === 'photo' || t.startsWith('dizaine'))) return false
          const autour = caps.slice(Math.max(0, i - 2), i + 3).map((x) => norm(x.text))
          return autour.some((x) => x.startsWith('dizaine')) && autour.some((x) => x === 'photos' || x === 'photo')
        })
        if (cue) {
          const a = r2(Math.max(0, cue.start - 0.5)), e = r2(Math.min(D, cue.start + 2.6))
          // le média du SUJET (nom « influenceuse »/« brune »/« hero ») devient le
          // HÉRO du mur (en grand en haut) ; les autres remplissent la grille.
          const estHero = (b) => /influenceus|brune|hero/i.test(String(b.assetId || ''))
          const ordered = dispo.slice().sort((x, y) =>
            (estHero(x) ? 0 : 1) - (estHero(y) ? 0 : 1) || (x.start || 0) - (y.start || 0))
          // un même asset posé deux fois (la brune : sujet PUIS résultat) ne
          // rentre qu'UNE fois au mur — sinon la grille la montrait en double.
          const vusMur = new Set()
          const items = ordered.filter((b) => !vusMur.has(b.assetId) && vusMur.add(b.assetId))
            .map((b) => ({ src: files[b.assetId], assetId: b.assetId }))
          if (add({ anim: 'photowall', items, count: items.length }, a, e)) {
            // Le HÉRO garde sa place EN SOLO ailleurs (Axel, 11/08 : « d'abord la
            // fille en grand quand je dis "danses TikTok d'influenceuses IA", PUIS
            // toutes ses photos au mur ») : seule la grille est consommée par le
            // mur. Le héro apparaît donc 2 fois — en solo sur son mot, puis en
            // grand dans le mur.
            for (const b of dispo) { if (!estHero(b)) b.__pose = true }
            med += Math.max(1, items.length - 1)
            console.log(`▶ mur de photos : ${items.length} clichés sur « ${cue.text} » (${a}→${e}s) — le héro garde sa place solo`)
          }
        }
      }
    }
    const paquets = []
    for (const b of brut) {
      if (b.__pose) continue
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
      // Retour d'Axel (31/07, en voyant le split rendu) : « le hook je le vois
      // avec mon avatar principal en FULL écran et l'influenceuse en plus
      // petit ». Le média de hook n'est donc PLUS réservé au split : il tombe
      // dans la mécanique générale ci-dessous, qui l'accroche en MÉDAILLON sur
      // la fenêtre du hook. Le split 50/50 ne reste que pour les MARQUES (§5).
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
      // ── UN PAYSAGE NE TIENT PAS EN MÉDAILLON ──────────────────────────────
      // Le médaillon fait environ un tiers de la largeur. Un portrait (une
      // personne qui parle) y reste parfaitement lisible — c'est ce qu'Axel
      // avait demandé le 31/07 : « tu gardes l'avatar principal qui parle et tu
      // ajoutes la vidéo en plus petit ». Une capture d'écran 16:9, elle,
      // devient illisible : sa démo AvatarAds×Claude réduite au tiers, il n'a
      // plus rien vu — « on ne voit pas le mp4, laisse dans sa forme actuelle
      // plutôt » (02/08). La forme du fichier décide donc, pas une règle fixe.
      const dim = (opts.assetDims || {})[b.assetId]
      const ratio = dim && dim.h ? dim.w / dim.h : 0
      const hote = (hookWin && a < hookWin.end - 0.3 && e > hookWin.start + 0.3) ? hookWin
        : (plan.avatarSegments || []).find((w) => a < (w.end || 0) - 0.3 && e > (w.start || 0) + 0.3)
      if (hote) {
        // `prominent` : passé l'accroche (5 s), le média qu'il MONTRE se rend
        // en MOYEN centré, l'avatar qui parle derrière (Axel 05/08 : « l'image
        // de la fille en moyen avec l'avatar qui parle derrière »). Dans
        // l'accroche, il reste petit en coin (règle Léna du 31/07).
        ;(hote.insets = hote.insets || []).push({ src, assetId: b.assetId, ratio,
          start: a, end: r2(Math.min(e, hote.end)), prominent: a >= 5 })
        // …et on note qu'il DÉPEND de cette fenêtre : plus bas, les fenêtres
        // avatar sont rebâties sous contrainte de budget et de collisions, et
        // celle-ci peut très bien ne pas survivre. Le repêchage de la §4 s'en
        // sert pour ne jamais perdre le média en route.
        b.__inset = true
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
    // « si tu veux … » en TÊTE de phrase = une adresse directe au spectateur
    // (le CTA de sortie : « si tu veux la méthode complète, écris Avatar »).
    // Axel (Cartoon 20) : « y'aurait pu avoir mon avatar quand je dis "si tu
    // veux la méthode complète" ». Le garde `tete` la limite aux débuts de
    // proposition — jamais un « si tu veux » au milieu d'une instruction.
    const OUVRE = [['maintenant'], ['desormais'], ['place', 'a'], ['on', 'passe', 'a'], ['si', 'tu', 'veux']]
    const n = (w) => norm(String(w && w.text || ''))
    const suite = (i, seq) => seq.every((tk, k) => words[i + k] && n(words[i + k]) === tk)
    for (let i = 0; i < words.length; i++) {
      for (const seq of FERME) {
        if (!suite(i, seq)) continue
        // …et on remonte au début de la PROPOSITION qu'elle conclut — plus au
        // début de la phrase entière. Retour d'Axel (31/07) : « produit
        // physique, coaching, formation → j'aurais voulu une animation » —
        // l'énumération AVANT l'adresse a droit à son visuel, le visage ne
        // prend que l'adresse elle-même. La virgule arrête donc la remontée.
        let a = i
        for (let k = i - 1; k >= 0 && i - k < 14; k--) {
          if (/[.!?,]$/.test(String(words[k].text)) || words[k + 1].start - words[k].end > 0.34) break
          a = k
        }
        const deb = Math.max(0, words[a].start - 0.15)
        const fin = Math.min(D, words[i + seq.length - 1].end + 0.35)
        if (fin - deb >= 1.2) adresses.push([deb, Math.min(fin, deb + 6.5)])
        break
      }
      for (const seq of OUVRE) {
        if (!suite(i, seq) || i < 3) continue
        // ── « MAINTENANT » N'OUVRE PAS TOUJOURS UN CHAPITRE ─────────────────
        // La règle a été écrite pour « MAINTENANT, pour créer ton influenceur
        // IA » : une annonce, où la voix ne désigne rien qu'on puisse montrer.
        // Mais dans « tu peux MAINTENANT créer n'importe quelle vidéo
        // directement dans Claude », c'est un adverbe au milieu d'une phrase —
        // et cette phrase nomme des choses très concrètes. Elle réservait
        // pourtant 3 s de visage muet, et le `type` du chef n'avait plus de
        // place. Axel : « pourquoi y'a pas d'animations à "tu peux maintenant
        // créer des vidéos directement dans Claude" ? mets-en une ».
        // Un ouvreur de chapitre est en TÊTE de proposition : au plus un mot
        // après une ponctuation ou un silence (« Bon maintenant, … »).
        let tete = false
        for (let k = 1; k <= 2 && i - k >= 0; k++) {
          const p = words[i - k]
          if (/[.!?,]$/.test(String(p.text)) || (words[i - k + 1].start - p.end) > 0.25) { tete = true; break }
        }
        if (!tete) continue
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
      if (noFace) break                       // pas de visage à rendre l'écran à
      if (overlaps(a, b)) continue
      // clip: -1 : fenêtre créée par la dérivation, pas de clip lipsync à elle.
      // ── …SAUF QUAND ELLE RECOUVRE UNE FENÊTRE À CLIP DU PLAN (Axel, 07/08) ──
      // Mesuré sur le montage 3df63a0d : l'adresse « Pour maintenant faire… »
      // (12,2→13,65 s) recouvrait la fenêtre 12,2→13,46 du plan, qui portait le
      // clip av1 DÉJÀ PAYÉ chez Hedra. Cette fenêtre-là mourait plus bas sur le
      // claim de l'adresse (§2b puis §3b), et l'écran montrait la photo figée
      // pendant que la voix parle — « à 13 s le lipsync manque ». Quand les
      // débuts coïncident (±0,3 s), le clip prononce exactement ces mots :
      // l'adresse le REPREND. Si le début ne coïncide pas, on garde la photo —
      // des lèvres qui disent d'autres mots seraient pires qu'une image fixe.
      const src = clipPourFenetre(r2(a), r2(b))
      ;(plan.avatarSegments = plan.avatarSegments || []).push({ start: r2(a), end: r2(b), adresse: true, clip: src ? src.clip : -1 })
      if (src) console.log(`▶ adresse directe ${r2(a)}→${r2(b)}s : elle reprend le clip lipsync av${src.clip} (même début, mêmes mots)`)
      claim(a, b); n2++
    }
    if (n2) console.log(`▶ ${n2} adresse(s) directe(s) : le visage reprend l'écran`)
  }


  // ── 0a-ter · « GÉNÉRER DES VUES » : LE COMPTEUR GRIMPE ──────────────────────
  // Axel : « quand je dis "tes vidéos vont générer des vues", mets une animation
  // en mode de 200 à 100 000 vues rapidement ». La phrase annonce une AUDIENCE
  // QUI MONTE — c'est le mouvement qu'il faut montrer, pas un chiffre posé.
  // Elle réserve sa place avant l'animation du lien en bio, qui commence juste
  // avant et débordait dessus.
  {
    const n = (w) => norm(String(w && w.text || ''))
    const SUITES = [['generer', 'des', 'vues'], ['faire', 'des', 'vues'], ['generer', 'de', 'la', 'vue'],
      ['des', 'vues'], ['de', 'la', 'vue'], ['des', 'millions', 'de', 'vues']]
    for (let i = 0; i < words.length; i++) {
      const seq = SUITES.find((q) => q.every((tk, k) => words[i + k] && n(words[i + k]) === tk))
      if (!seq) continue
      const fin = words[i + seq.length - 1]
      const a = Math.max(0, words[i].start - LEAD - 0.9)
      // …et elle rend la main vite : la phrase suivante (« vers ton lien bio »)
      // a droit à son animation. Une fenêtre trop généreuse ici l'effaçait.
      const b = Math.min(D, fin.end + 1.2)
      // les valeurs ne sont pas des résultats annoncés : c'est l'ordre de grandeur
      // d'une vidéo qui décolle. Si la voix cite un nombre, le chef d'orchestre
      // pose son propre `countup` et celui-ci n'a plus lieu d'être.
      // …et on N'ABANDONNE PAS à la première occurrence. « des millions de vues »
      // est aussi dit dans l'accroche, sur la fenêtre du visage : le compteur y
      // était refusé, et le `break` faisait rater celui de « générer des vues »,
      // trois phrases plus loin. On continue jusqu'à en poser un.
      if (add({ anim: 'views', items: [{ text: '100 000' }, { text: '200' }] }, a, b)) {
        console.log(`▶ « ${seq.join(' ')} » → le compteur de vues grimpe (${r2(a)}s)`)
        break
      }
    }
  }

  // ── 0a-ter · UNE DURÉE DITE EN LETTRES DEVIENT UN COMPTEUR ─────────────────
  // « J'ai créé cette vidéo en DEUX MINUTES » : le chiffre est le sujet de la
  // phrase, et c'est ce qui impressionne. Le compteur `countup` existait, mais
  // son garde-fou exige un chiffre écrit — « deux minutes » n'en contient pas,
  // donc rien ne se posait. Axel : « deux minutes, faut le traduire avec un
  // compteur de genre 120 secondes ». On convertit donc la durée parlée en
  // SECONDES : c'est l'unité qui rend la vitesse tangible (120 impressionne,
  // 2 non).
  // C'est LE chemin canonique du chrono (le bloc « N secondes → chrono » d'en
  // aval a été fusionné ici) : il rend le CAMEMBERT redessiné par Axel
  // (ui:'timer' — disque orange qui suit l'aiguille, « 30 » + « sec »), jamais
  // le vieux compteur nu. Et quand le nombre est dit DANS l'accroche (« en
  // trente secondes top chrono »), on COUPE le hook pile sur lui : l'avatar
  // ouvre, puis cède au chrono calé sur la phrase — sinon la fenêtre visage
  // (au-dessus des panneaux) le couvrait et le chrono surgissait en retard,
  // le « décalé » pointé par Axel sur v6 ET v7.
  {
    const UNITES = { seconde: 1, secondes: 1, minute: 60, minutes: 60, heure: 3600, heures: 3600 }
    for (let i = 1; i < words.length; i++) {
      const u = UNITES[norm(words[i].text)]
      if (!u) continue
      const n = numOf(words[i - 1].text)
      if (!n) continue
      const sec = n * u
      if (sec < 5 || sec > 86400) continue          // ni une pincée, ni une éternité
      const a = r2(Math.max(0, words[i - 1].start - LEAD))
      // fin de la fenêtre : on avale la suite contiguë (« top chrono », trou
      // ≤ 0,35 s) et on S'ARRÊTE à la ponctuation de fin de phrase.
      let k = i, finPhrase = words[i].end || a
      while (words[k + 1] && !/[.!?]$/.test(String(words[k].text || ''))
        && (words[k + 1].start - (words[k].end || 0)) <= 0.35
        && words[k + 1].start < words[i - 1].start + 2.2) { k++; finPhrase = words[k].end || finPhrase }
      const b = r2(Math.min(D, finPhrase + 0.7))
      if (b - a < 1.25) continue
      // le nombre tombe dans la fenêtre du hook → on coupe le hook pile là
      // (bornes réelles = hookWin, PAS seulement plan.hook.end : v7 avait
      // hook.end=2,9 mais une fenêtre visage 0→3,93 qui couvrait le chrono).
      const finFenetreHook = Math.max((plan.hook && plan.hook.end) || 0, hookWin ? hookWin.end : 0)
      if (words[i - 1].start < finFenetreHook && a >= 1.3) {
        if (plan.hook && plan.hook.end > a) plan.hook.end = a
        const seg0c = (plan.avatarSegments || []).find((w) => (w.start || 0) < 0.6)
        if (seg0c && (seg0c.end || 0) > a) seg0c.end = a
        if (hookWin && hookWin.end > a) hookWin.end = a
        const hkT = taken.find((w) => w[0] < 0.3 && w[1] > 1.2)
        if (hkT && hkT[1] > a) hkT[1] = a
        console.log(`▶ hook coupé sur « ${words[i - 1].text} » à ${a}s → le chrono joue en synchro`)
      }
      if (add({ anim: 'ui', ui: 'timer', value: String(sec), unit: 'SECONDES' }, a, b)) {
        console.log(`▶ « ${words[i - 1].text} ${words[i].text} » → chrono ${sec} SECONDES (${a}→${b}s)`)
      }
    }
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
      // Retour d'Axel (31/07) : « quand je dis "tu peux ajouter sous-titres
      // etc", montre les Paramètres avancés ». La ligne REPLIÉE de 04-montageia
      // ne montre rien — la MODALE ouverte (13-montage-avance) montre les vrais
      // réglages (sous-titres, style visuel, musique). La zone 'mot-par-mot'
      // sert d'ancre valide ; si la voix ne la justifie pas, la mécanique
      // standard garde l'écran ENTIER sans cadre — c'est exactement ce qu'on veut.
      // ── PARLER À CLAUDE SE RÉSERVE AUSSI, ET C'EST LE PREMIER QUI GAGNE ────
      // Axel, sur la v16 : « il n'a pas mis chat parce qu'il l'a mis à 36
      // secondes ». Exact : la règle « jamais deux fois la même animation » a
      // donné la bulle au SECOND moment, et « créer n'importe quelle vidéo
      // directement dans Claude » — celui qui la mérite le plus — est retombé
      // sur une icône MP4. Une règle d'unicité doit servir le premier arrivé.
      {
        const cs = plan.captions || []
        let k = -1
        for (let i = 0; i < cs.length; i++) {
          if (!/^claude/i.test(String(cs[i].text || ''))) continue
          const avant = cs.slice(Math.max(0, i - 9), i).map((w) => w.text).join(' ')
          if (!/(cr[ée]er|cr[ée]e|demande|[ée]cri|prompt)/i.test(avant)) continue
          k = i; break
        }
        if (k > 0) {
          let d0 = k
          for (let m = k - 1; m >= 0 && k - m < 9; m--) {
            if (/[.!?]$/.test(String(cs[m].text || ''))) break
            d0 = m
          }
          const deb = r2(Math.max(0, cs[d0].start - LEAD))
          const fin = r2(Math.min(D, cs[k].end + 0.1))
          if (fin - deb >= 1.2 && add({ anim: 'chat' }, deb, fin)) {
            console.log(`▶ « demander à Claude » : la conversation réservée (${deb}→${fin}s)`)
          }
        }
      }

      // ── « ET VOILÀ, CLAUDE EST CONNECTÉ À AVATARADS » SE RÉSERVE D'ABORD ───
      // Ce plan doit être posé AVANT la visite guidée : sinon la dernière
      // capture s'étire par-dessus et il n'existe jamais (mesuré sur la v14 —
      // l'écran « connecteur personnalisé » couvrait toute la phrase). Une
      // capture n'a plus rien à montrer une fois son bouton cliqué ; cette
      // phrase-là, si : c'est la récompense de tout le tutoriel.
      {
        const cs = plan.captions || []
        const k = cs.findIndex((w, i) => /^connect/i.test(String(w.text || ''))
          && i > 0 && /^(est|sont|maintenant)$/i.test(String(cs[i - 1].text || '')))
        if (k > 0) {
          const deb = r2(Math.max(0, cs[Math.max(0, k - 2)].start - 0.1))
          let fin = r2(Math.min(D, cs[k].end + 1.6))
          for (let m = k; m < cs.length && m - k < 8; m++) {
            if (/[.!?]$/.test(String(cs[m].text || ''))) { fin = r2(Math.min(fin, cs[m].end + 0.15)); break }
          }
          if (fin - deb >= 1.2 && add({ anim: 'connect', assets: ['logo-avatarads', 'logo-claude'] }, deb, fin)) {
            console.log(`▶ « est connecté » : les deux logos et la coche réservés (${deb}→${fin}s)`)
          }
        }
      }

      const tuto = plan.tuto.map((t, i, arr) => {
        if (/parametres-avances/.test(String(t.zone || ''))) return { ...t, screen: '13-montage-avance', zone: 'mot-par-mot' }
        // zone:'menu' = « clique sur l'onglet <screen> ». La vraie zone est
        // l'entrée de BARRE LATÉRALE, montrée depuis l'écran où l'on se trouve
        // (l'accueil pour la première étape). Sans cette résolution, l'étape
        // partait en « zone inconnue » — et l'onglet Montage IA, dernière étape
        // du plan, n'était jamais montré (la mécanique NAV exige une étape
        // suivante, qu'une fin de visite n'a pas).
        if (String(t.zone) === 'menu') {
          const prev = arr.slice(0, i).map((x) => String(x.screen || '')).reverse().find((s) => /^\d\d-/.test(s))
          return { ...t, zone: String(t.screen || ''), screen: prev || ACCUEIL }
        }
        return t
      })
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
          // ON SAIT DÉJÀ OÙ. `hit` vient d'être trouvé au bon endroit ; laisser la
          // boucle principale rechercher le mot une deuxième fois lui faisait
          // attraper une AUTRE occurrence — « connecter claude » cadré à 35,8 s
          // au lieu de 17,9 s. Et comme la visite est chronologique, ce saut en
          // avant a fait rejeter les 8 étapes suivantes d'un coup : toute la
          // partie Claude du tutoriel a disparu de la vidéo. On fige l'index.
          tuto.splice(tuto.indexOf(after), 0, { word: phrase, screen: host, zone, text: '', at: hit })
          console.log(`▶ clic rétabli sur « ${phrase} » avant l'ouverture de l'écran (${r2(hit.start)}s)`)
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
      // POURQUOI UNE ÉTAPE DISPARAÎT, ÇA DOIT SE LIRE. Les 4 écrans de la visite
      // Claude ont été jetés ICI, en silence, pendant que le plan les prévoyait :
      // la vidéo montrait 13 s de visage à la place du tutoriel, et rien dans les
      // logs ne le disait. Un rejet muet est un rejet qu'on ne corrige jamais.
      const jetees = []
      // ── UNE VISITE GUIDÉE NE COMMENCE PAS DANS L'ACCROCHE ───────────────────
      // Mesuré sur la v12 : la 1ʳᵉ étape cherchait « Claude » depuis le mot 0 et
      // tombait sur celui de l'ACCROCHE (2,5 s — « AvatarAds connecté à Claude
      // vient de sortir »). L'écran qui montre le bouton « Connecter Claude »
      // partait donc à 2,3 s, se faisait écraser par le visage du hook, et
      // n'existait plus nulle part. Axel, deux fois : « il manque l'étape où il
      // montre le bouton Connecter Claude dans le menu AvatarAds ».
      // Le tutoriel, c'est la section de PREUVE : on démarre la recherche là, et
      // à défaut juste après l'accroche. Les occurrences d'avant appartiennent
      // au discours, pas au mode d'emploi.
      let cur = 0, dernierMot = -1
      {
        const preuve = (plan.sections || []).find((x) => String(x.role) === 'preuve')
        let t0Tuto = preuve ? preuve.start : (plan.hook && plan.hook.end) || 0
        // ── LA SECTION « PREUVE » N'EST PAS TOUJOURS LE TUTORIEL (Axel, 07/08) ──
        // Sur le montage 3df63a0d, le chef a étiqueté « preuve » le RÉSULTAT
        // (« et voilà, Claude est connecté », 32,08 s) — le mode d'emploi, lui,
        // vit de 16 à 32 s dans une section « benefice ». Démarrer la recherche
        // à 32,08 s cassait TOUT le curseur chronologique : chaque mot d'étape,
        // introuvable après 32 s, retombait sur le repli global-depuis-zéro, et
        // le dernier « Ajouter » (« valide en cliquant sur Ajouter », 31,5 s)
        // se calait sur le premier (24,5 s) — d'où le cadre sur le bas de la
        // modale (Annuler/Ajouter) pendant que la voix dit « Ajouter un
        // connecteur personnalisé », et deux écrans du parcours écrasés à zéro
        // seconde d'écran. On VÉRIFIE donc : si les premiers mots du parcours se
        // trouvent APRÈS l'accroche mais AVANT la section preuve, le tutoriel
        // commence là — et c'est de là qu'on part.
        if (preuve && t0Tuto > 0.5) {
          const finHook2 = (plan.hook && plan.hook.end) || 0
          const jHook = Math.max(0, words.findIndex((w) => w.start >= finHook2))
          let avant = 0
          for (const t of tuto.slice(0, 3)) {
            const w = String(t.word || '')
            const h = findSeq(words, w, jHook) || findAny(words, [w], jHook) || like(w, jHook)
            if (h && h.start < t0Tuto - 0.5) avant++
          }
          if (avant >= 2) {
            console.log(`▶ visite guidée : le parcours commence AVANT la section preuve (${r2(t0Tuto)}s) → recherche depuis la fin de l'accroche`)
            t0Tuto = finHook2
          }
        }
        if (t0Tuto > 0.5) {
          const j = words.findIndex((w) => w.start >= t0Tuto - 0.2)
          if (j > 0) {
            cur = j
            console.log(`▶ visite guidée : recherche à partir de ${r2(t0Tuto)}s, pas depuis le début`)
          }
        }
      }
      // ── SUR L'ÉCRAN « CONNECTER CLAUDE », SEULE LA CARTE 1 SE CADRE ────────
      // Cet écran d'AvatarAds présente TROIS cartes : « 1 · Copie ta clé »,
      // « 2 · Ouvre les Connecteurs », « 3 · Génère ». Les cartes 2 et 3 ne
      // sont pas des gestes à faire ICI : elles annoncent ce qui se passe
      // ENSUITE, dans Claude — et la visite guidée montre déjà les vrais
      // écrans de Claude pour ça. Les encadrer, c'était illustrer deux fois la
      // même étape et surtout prendre du retard : le cadre restait sur la
      // carte 2 pendant qu'Axel disait « rends-toi dans les paramètres de
      // Claude ». Lui, en voyant le rendu : « seul le step 1 doit être encadré,
      // jamais le 2 ou le 3 […] ça désynchronise tout puisque je parle d'aller
      // dans les paramètres Claude et je suis encore sur l'écran de copier la
      // clé ».
      const ZONES_INTERDITES = {
        '11-connecter-claude': ['ouvrir-claude-connecteurs', 'commencer'],
      }
      // ── L'ÉCRAN AU PRÉNOM N'EXISTE PLUS, ET ON NE LE REGRETTE PAS ─────────
      // `10-mon-compte` capturait le HAUT de la modale : le prénom d'Axel en
      // clair, son téléphone, son e-mail — et pas le bouton « Connecter
      // Claude », qui est plus bas. Axel : « supprime cette capture où y'a mon
      // prénom, elle sert à rien, c'est toi qui a dû la mettre, dans site j'ai
      // fait exprès de ne pas la mettre pour pas de confusion ». Elle est donc
      // retirée de la banque.
      // ⚠️ Mais un chef d'orchestre déjà en vol peut encore la demander (son
      // prompt est mis en cache), et la première fois que je l'ai supprimée la
      // visite s'est ouverte sur 3,3 s de vide. On ne jette donc pas l'étape :
      // on la renvoie sur `12-connecter-claude-entree`, qui est LA MÊME modale
      // déroulée — et qui, elle, contient le bouton dont il parle.
      const ECRANS_REMPLACES = {
        '10-mon-compte': { screen: '12-connecter-claude-entree', zone: 'connecter-claude' },
      }
      // ── « CRÉER TON COMPTE SUR AVATARADS » N'EST PAS UNE ÉTAPE DE L'APP ────
      // C'est une NAVIGATION : on n'est pas encore dedans. La visite guidée
      // s'ancrait pourtant sur ce premier « compte » et posait l'onglet Mon
      // compte, volant la fenêtre au navigateur qui devait montrer la page
      // d'accueil. Axel : « quand je dis "commence par créer ton compte sur
      // AvatarAds", ça montre l'onglet Mon compte alors que ça devrait montrer
      // la LP — c'est qu'après, quand je dis "ouvre Mon compte", qu'il doit
      // mettre cette scène en visite guidée. »
      // On repère donc les mots pris par une phrase de navigation, et la visite
      // guidée cherche son mot APRÈS eux.
      const motsNav = new Set()
      {
        const GO_NAV = ['aller', 'va', 'vas', 'rends', 'rendre', 'direction', 'creer', 'cree',
          'crees', 'inscris', 'inscrire', 'commence', 'commencer', 'compte']
        for (let j = 1; j < words.length - 1; j++) {
          if (norm(words[j].text) !== 'sur') continue
          const d = Math.max(0, j - 3)
          if (!words.slice(d, j).some((w) => GO_NAV.includes(norm(w.text)))) continue
          for (let k = d; k <= j + 1 && k < words.length; k++) motsNav.add(k)
        }
      }
      for (let t of tuto) {
        const remp = ECRANS_REMPLACES[String(t.screen)]
        if (remp) {
          console.log(`▶ visite guidée : ${t.screen} retiré → ${remp.screen}/${remp.zone}`)
          t = { ...t, screen: remp.screen, zone: remp.zone }
        }
        if ((ZONES_INTERDITES[String(t.screen)] || []).includes(String(t.zone))) {
          jetees.push(`${t.screen}/${t.zone} : cette carte annonce la suite, elle ne se cadre pas ici`)
          continue
        }
        // ── « JUSQU'À CONNECTER CLAUDE » MONTRE LE BOUTON, PAS LE MENU ──────
        // Le chef ancrait cette étape sur l'entrée « Mon compte » de la barre
        // latérale : on voyait le menu surligné pendant qu'Axel dit « descends
        // tout en bas jusqu'à Connecter Claude », et le bouton dont il parle
        // n'apparaissait nulle part. Axel, deux fois : « il manque l'étape où il
        // montre le bouton Connecter Claude dans le menu AvatarAds ».
        // Cette phrase-là désigne UN écran précis : la modale déroulée.
        if (/^(claude|connecter|connect)/i.test(String(t.word || ''))
          && String(t.screen) !== '12-connecter-claude-entree'
          && /^(mon-compte|axel|menu|compte)/i.test(String(t.zone || ''))) {
          console.log(`▶ visite guidée : « ${t.word} » → 12-connecter-claude-entree (c'est le BOUTON qu'il nomme, pas le menu)`)
          t = { ...t, screen: '12-connecter-claude-entree', zone: 'connecter-claude' }
        }
        const zone = zoneNamed(t.screen, t.zone)
        if (!zone) { jetees.push(`${t.screen}/${t.zone} : zone inconnue de la capture`); continue }
        const w = String(t.word || '')
        let hit = t.at || findSeq(words, w, cur) || findAny(words, [w], cur) || like(w, cur)
          || findSeq(words, w) || findAny(words, [w]) || like(w, 0)
        // …et si ce mot appartient à la phrase de navigation, on prend
        // l'occurrence SUIVANTE : « créer ton compte sur X » revient à la LP,
        // « ouvre Mon compte » à la visite guidée.
        if (hit && !t.at && motsNav.has(hit.i)) {
          const apres = findAny(words, [w], hit.i + 1) || like(w, hit.i + 1)
          if (apres) {
            console.log(`▶ visite guidée : « ${w} » à ${r2(hit.start)}s appartient à la navigation → on prend celui de ${r2(apres.start)}s`)
            hit = apres
          }
        }
        // ── UN ÉCRAN D'APP NE S'ANCRE PAS SUR UNE PHRASE D'ARGENT ──────────────
        // « génèrent des dizaines de milliers d'euros » parle des AUTRES qui
        // gagnent de l'argent, pas de la fonction « génère une photo » d'AvatarAds.
        // Mesuré (Cartoon 21) : le mot « génère » de l'étape Images IA matchait
        // « génèrent » (7,7 s, section revenus) AVANT « génère une photo » (12,6 s),
        // et la capture Images IA tombait sur « milliers d'euros » (Axel, deux
        // fois : « je dis milliers d'euros et il montre Images IA »). Si le repère
        // est collé à un terme d'argent, on prend l'occurrence suivante — la vraie.
        if (hit && !t.at) {
          const ctx = words.slice(hit.i, hit.i + 6).map((x) => norm(x.text))
          if (ctx.some((x) => /(euro|millier|dollar|argent|centime|balle)/.test(x))) {
            const apres = findSeq(words, w, hit.i + 1) || findAny(words, [w], hit.i + 1) || like(w, hit.i + 1)
            if (apres) {
              console.log(`▶ visite guidée : « ${w} » à ${r2(hit.start)}s est dans une phrase d'argent → on prend celui de ${r2(apres.start)}s`)
              hit = apres
            }
          }
        }
        if (!hit) { jetees.push(`${t.screen}/${t.zone} : « ${w} » introuvable dans la transcription`); continue }
        // DEUX CADRES SUR DEUX MOTS COLLÉS, C'EST UN CADRE DE TROP. Le plan
        // demandait « Image » puis « IA » — deux mots d'un même nom d'onglet —
        // et la caméra sautait aussitôt ailleurs, sur une zone qui n'avait rien
        // à voir (Axel : « pourquoi il montre "Génération" alors que je ne
        // parle pas de génération ? »). Le premier des deux suffit.
        // ⚠ EN AVANÇANT SEULEMENT. Écrite `hit.i - dernierMot <= 1`, la condition
        // était vraie pour tout écart NÉGATIF — donc pour toute étape trouvée
        // AVANT la précédente. Une seule étape mal calée en fin de script
        // (dernierMot = 152) suffisait à faire rejeter les huit suivantes, qui
        // étaient pourtant aux index 84 à 137. Un écart négatif ne veut pas dire
        // « collé », il veut dire « à l'envers » : ça se traite autrement.
        if (dernierMot >= 0 && hit.i > dernierMot && hit.i - dernierMot <= 1) {
          jetees.push(`${t.screen}/${t.zone} : « ${w} » colle au mot de l'étape précédente`)
          continue
        }
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
        // ── …ET ELLE NE REMONTE PAS SUR LA PHRASE D'AVANT (Axel, 07/08) ──────
        // « Donne-lui le nom AvatarAds. COLLE la clé… » : le mot d'avant
        // (« AvatarAds. ») clôt la phrase PRÉCÉDENTE — celle du champ du nom.
        // Inclus dans la fenêtre, il gagnait le rapprochement (le libellé du
        // champ est littéralement « AvatarAds ») et le cadre restait sur la
        // première section pendant que la voix dit « colle la clé » — Axel
        // voulait la DEUXIÈME section, le champ où se colle la clé. La coupure
        // de phrase vaut donc aussi vers l'arrière.
        const proche = []
        for (let k = Math.max(0, hit.i - 1); k < Math.min(words.length, hit.i + 3); k++) {
          if (k > hit.i && /[.!?]$/.test(String(words[k - 1].text))) break
          if (k < hit.i && /[.!?]$/.test(String(words[k].text))) continue
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
        // ── ON SE CALE SUR LE PREMIER MOT DU LIBELLÉ, PAS SUR LE DERNIER ────
        // Le chef d'orchestre donne UN mot déclencheur par étape, et il choisit
        // souvent le nom (« clé ») alors que la phrase commence par le verbe :
        // « Clique sur GÉNÉRER la clé ». Mesuré sur le Cartoon 18 : il dit
        // « Générer » à 19,74 s, le cadre arrivait à 20,48 s — trois quarts de
        // seconde de retard, sur une phrase débitée en une seconde et demie.
        // Axel : « faut qu'il prévoie avant que je le dise […] parce que je le
        // dis rapidement, du coup ce n'est pas synchronisé ».
        // Le libellé du bouton, lui, est connu (« Générer ma clé ») : on cherche
        // donc, juste avant le mot du chef, le premier mot de ce libellé
        // réellement prononcé, et on part de LUI.
        let anc = hit.start
        const lib = String((spot && spot.label) || '').toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
        // ⚠ « Générer ma clé » ne laisse QU'UN mot utile après avoir écarté les
        // outils (« ma ») et les mots trop courts — exiger deux mots revenait à
        // ne jamais recaler l'étape la plus mal calée du tuto. Un seul suffit :
        // c'est lui qui ouvre la phrase.
        const motsLib = lib.split(/[^a-z0-9]+/).filter((x) => x.length > 3)
        if (motsLib.length >= 1) {
          const norm = (x) => String(x).toLowerCase().normalize('NFD')
            .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
          // fenêtre courte AVANT le mot du chef : on ne remonte pas à une autre
          // phrase, juste au début de celle-ci
          for (const w of words) {
            if (w.start >= hit.start || w.start < hit.start - 2.2) continue
            if (motsLib.includes(norm(w.text))) { anc = w.start; break }
          }
          if (anc < hit.start - 0.05) {
            console.log(`▶ visite guidée : « ${spot.label} » calé sur le début de la phrase (${r2(anc)}s au lieu de ${r2(hit.start)}s)`)
          }
        }
        steps.push({ screen: ecran, t: r2(Math.max(0, anc - LEAD)), end: hit.end,
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
            // le rattrapage n'a pas le droit d'aller chercher une zone
            // interdite — sinon la carte 2 revient par la fenêtre
            if ((ZONES_INTERDITES[String(st.screen)] || []).includes(String(z.name || ''))) continue
            // 0,8 s d'écart minimum, c'était refuser de suivre quelqu'un qui
            // parle vite : « Générer la clé ET TU LA COPIES » enchaîne deux
            // gestes en 0,66 s, et le second était jeté — l'écran restait figé
            // sur le premier pendant qu'Axel décrivait le suivant. Ce ne sont
            // pas deux panneaux mais deux positions de caméra sur le MÊME
            // écran : elles peuvent s'enchaîner vite. Axel : « genre au mot à
            // mot parce que je le dis rapidement ».
            if (steps.some((o) => Math.abs(o.t - (w.start - LEAD)) < 0.45)) continue
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
        // …et un écran CÈDE LA PLACE dès que la première étape du suivant
        // arrive : le clic-menu gardait 0,9 s après son mot et repoussait
        // l'écran d'après DERRIÈRE le mot qu'il illustre (« Photo réelle »
        // encadrée 0,6 s après avoir été dite — retour d'Axel, 31/07)
        const b = r2(Math.min(D, steps[j].end + (steps[j].type ? 1.6 : 0.9),
          j + 1 < steps.length ? steps[j + 1].t - 0.05 : Infinity))
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
      // les écrans du plan ont TOUS été absorbés plus haut : ce qui n'a pas été
      // reposé ici est perdu pour de bon. On le dit, avec la raison.
      if (jetees.length) {
        console.log(`▶ visite guidée — ${jetees.length} étape(s) du plan JETÉE(S) :`)
        for (const j of jetees) console.log(`    · ${j}`)
      }
      const demandes = (plan.tuto || []).length
      if (demandes && placedScreens < demandes / 2) {
        console.log(`⚠ visite guidée incomplète : ${placedScreens} écran(s) posé(s) pour ${demandes} étape(s) demandée(s) — le tutoriel sera creux`)
      }
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
    // « UTILISE AVATARADS » EST AUSSI UNE NAVIGATION (Axel, 14/08 : « quand je
    // dis utilise AvatarAds il aurait fallu montrer la LP avec avatarads.fr qui
    // s'écrit dans la barre »). Pas de « sur » dans cette tournure — le verbe
    // porte seul le geste, le mot d'après doit ressembler à un NOM de produit
    // (la marque, ou une majuscule ≥ 4 lettres — jamais un article).
    const UTILISE = ['utilise', 'utiliser', 'utilises', 'ouvre', 'ouvrez', 'lance', 'teste', 'essaie', 'essaye']
    for (let j = 1; j < words.length - 1; j++) {
      const wj = norm(words[j].text)
      let from = null, site = null
      if (wj === 'sur') {
        const verb = words.slice(Math.max(0, j - 3), j).findIndex((w) => GO.includes(norm(w.text)))
        if (verb < 0) continue
        from = words[Math.max(0, j - 3) + verb]          // « tu VAS aller sur… »
        site = words[j + 1]
      } else if (UTILISE.includes(wj)) {
        const nx2 = words[j + 1]
        const brut2 = String((nx2 && nx2.text) || '').replace(/[.,!?;:«»"']/g, '')
        if (nx2 && (/avatarads/i.test(brut2) || (/^[A-ZÀ-Ü]/.test(brut2) && norm(brut2).length >= 4))) {
          from = words[j]; site = nx2
        }
      }
      if (!from || !site || norm(site.text).length < 3) continue
      let a = Math.max(0, from.start - LEAD)
      // la scène s'arrête net avant la phrase suivante : après « AvatarAds » il
      // enchaîne sur le compte, et le navigateur n'a plus rien à raconter
      const next = words.find((w) => w.start > site.end + 0.35)
      let b = Math.min(D, next ? next.start - LEAD : site.end + 3.2, site.end + 3.2)
      // …et elle PREND le blanc qui la précède (jusqu'à 1,3 s). Les panneaux se
      // poussent l'un l'autre : un trou n'affiche pas du vide, il laisse la scène
      // d'avant s'attarder — la vidéo de la fille débordait ainsi sur « pour
      // commencer ». Ici le navigateur s'ouvre dès l'écran libre, et l'adresse a
      // le temps de se taper : la page arrive PILE sur le nom prononcé.
      const [fa] = fit(Math.max(0, a - 1.3), b)
      if (fa < a - 0.05) a = fa
      // …mais JAMAIS par-dessus une réservation posée entre le blanc saisi et le
      // mot : la brune (10→12,3 s) vivait là et le navigateur reculé à 9,7 s se
      // faisait rejeter en bloc. Dans ce cas l'adresse se tape sur son mot.
      if (taken.some((w) => w[0] > a + 0.05 && w[0] < (from.start - LEAD) - 0.05)) a = Math.max(0, from.start - LEAD)
      // le zoom se cale sur « clique sur commencer » — mais SEULEMENT si ce mot
      // tombe dans la scène. Ici « pour commencer » est dit AVANT l'adresse : le
      // zoom partait alors à 16,5 s, hors du panneau, et ne jouait jamais.
      // ── LE NAVIGATEUR OWN « CRÉER TON COMPTE SUR AVATARADS.FR » ────────────
      // Axel (Cartoon 20, 10/08) REVIENT sur sa demande d'avant (« annule ce
      // zoom ») : « à 8 s il aurait dû ZOOMER sur la LP sur Commencer / Se
      // connecter ». Le zoom existe dans la scène (cible re-calée sur la
      // nouvelle capture 2880×1800), mais un écran de la visite guidée se posait
      // DANS la fenêtre du navigateur (« Mon compte » dès 7,8 s) et le coupait
      // avant le zoom — d'où « il n'a pas zoomé » ET « Mon compte trop tôt ». On
      // rend donc au navigateur TOUTE sa fenêtre : tout écran/scène déjà posé
      // dedans est repoussé APRÈS elle (« ouvre Mon compte » vient ensuite), ou
      // retiré s'il y tenait entier.
      for (let k = out.length - 1; k >= 0; k--) {
        const s2 = out[k]
        if (!(s2.screen || s2.ui)) continue
        if ((s2.start || 0) >= b - 0.1 || (s2.end || 0) <= a + 0.1) continue
        const ki = taken.findIndex((w) => Math.abs(w[0] - (s2.start || 0)) < 0.06 && Math.abs(w[1] - (s2.end || 0)) < 0.06)
        if (ki >= 0) taken.splice(ki, 1)
        if ((s2.end || 0) > b + 0.3) { s2.start = r2(b); claim(s2.start, s2.end); console.log(`▶ navigateur : « ${s2.screen || s2.ui} » repoussé à ${r2(b)}s (il volait la fenêtre du site)`) }
        else { out.splice(k, 1); console.log(`▶ navigateur : « ${s2.screen || s2.ui} » retiré (dans la fenêtre du site)`) }
      }
      // …et un panneau MÉDIA qui déborde sur le début du navigateur se ROGNE
      // (jamais retiré : ses secondes plein cadre restent). Sans ça, la brune
      // (10→12,3 s) tenait la fenêtre et le add() du navigateur échouait —
      // « Utilise AvatarAds » (11,3 s) ne montrait jamais le site (Axel, 14/08).
      for (const s2 of out) {
        if (!s2.assetId || (s2.start || 0) >= a - 0.1 || (s2.end || 0) <= a + 0.1) continue
        if ((a - (s2.start || 0)) < 0.9) continue        // il ne resterait rien à voir
        const ki2 = taken.findIndex((w) => Math.abs(w[0] - (s2.start || 0)) < 0.06 && Math.abs(w[1] - (s2.end || 0)) < 0.06)
        if (ki2 >= 0) taken[ki2] = [taken[ki2][0], r2(a - 0.02)]
        console.log(`▶ navigateur : média « ${s2.assetId} » rogné ${r2(s2.end)}→${r2(a - 0.02)}s (le site prend la suite)`)
        s2.end = r2(a - 0.02)
      }
      // …et il se BORNE avant la réservation suivante (la photo-résultat à
      // 12,3 s) : sans ça, add() rejetait toute la scène pour 0,3 s de trop.
      {
        const suivant = taken.filter((w) => w[0] > a + 0.2 && w[0] < b - 0.05).sort((x, y) => x[0] - y[0])[0]
        if (suivant && (suivant[0] - 0.05 - a) >= 1.1) b = r2(suivant[0] - 0.05)
      }
      if (add({ anim: 'ui', ui: 'browser', url: 'avatarads.fr', screen: 'site-home' }, a, b)) {
        console.log(`▶ navigateur : l'adresse se tape, la LP arrive, puis zoom sur « Commencer » (${r2(a)}→${r2(b)}s)`)
      }
      break
    }

    let placedAnim = 0
    placeServerAnims = () => {
      for (const sl of srv) {
        if (!isAnim(sl) || consumedByPlan.has(sl)) continue
        const an = String(sl.anim)
        const a = r2(sl.start || 0), b = r2(sl.end ?? a + 1.8)
        // LE CONTENU DATÉ BAT L'ANIMATION ANONYME (retour d'Axel 31/07 :
        // « produit physique, coaching, formation → j'aurais voulu une
        // animation » — la carte dont les items s'allument SUR leurs mots EST
        // cette animation, et la fiche générique qui la recouvrait la tuait).
        // Le rival ne compte que s'il est POSABLE : sa fenêtre encore libre.
        const rival = srv.find((s2) => s2 !== sl && !isAnim(s2) && s2.anim !== 'screen' && s2.anim !== 'ui'
          && !consumedByPlan.has(s2)
          && (s2.items || []).some((it) => it && it.text && Number(it.t) > 0)
          && !overlaps(r2(s2.start || 0), r2(s2.end ?? (s2.start || 0) + 1.5))
          && Math.min(b, s2.end ?? 0) - Math.max(a, s2.start ?? 0) > (b - a) * 0.6)
        if (rival) {
          console.log(`▶ ${an} s'efface devant « ${String(rival.title || '').slice(0, 34)} » : ses items claquent sur leurs mots`)
          // …et la carte prend la fenêtre TOUT DE SUITE : laissée pour plus
          // tard, les tables de beats re-posaient la même anim au mot près et
          // re-bloquaient la carte qu'on vient de défendre
          const ra = r2(rival.start || 0), rbPlan = r2(rival.end ?? ra + 1.5)
          const rlast = Math.max(0, ...(rival.items || []).map((it) => Number(it && it.t) || 0))
          const rb = r2(Math.min(D, Math.max(rbPlan, rlast + 0.4)))
          // Retour d'Axel (31/07, v2 puis v3) : « sans forcément écrire
          // "formation" "coaching" — l'animation ajoute UN truc », puis « la
          // MONTAGE COMPLET non ! je veux des animations, je ne veux pas que tu
          // l'écrives ». Toute énumération datée (card OU checklist) devient
          // l'anim `lineup` : un visuel par terme prononcé, zéro mot écrit —
          // le visuel de chaque carte se choisit d'après le terme (colis,
          // personne, cours, calque, son, transition…).
          const pose = ['card', 'checklist'].includes(String(rival.type))
            ? { ...rival, anim: 'lineup', title: '', motif: '' } : rival
          if (add(pose, ra, rb) || (rb > rbPlan && add(pose, ra, rbPlan))) consumedByPlan.add(rival)
          continue
        }
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
        // même règle qu'en §4 (retour d'Axel 31/07) : en apple, une page-titre
        // sans matière (banner sans items) ne se pose pas — only animation
        if (plan.slideStyle === 'apple' && String(sl.type) === 'banner'
          && !(sl.items || []).some((it) => String(it.text || '').trim())) continue
        const its = (sl.items || []).filter((it) => it && it.text)
        if (!its.length && !sl.title) continue
        const a = r2(sl.start || 0), b = r2(sl.end ?? a + 1.5)
        // la carte vit jusqu'à son DERNIER item : « formation » est daté à
        // 15,1 s mais le chef fermait la carte à 14,8 — le mot claquait avant
        // d'être dit. On tente la fenêtre étendue, sinon celle du plan.
        const lastT = Math.max(0, ...its.map((it) => Number(it.t) || 0))
        const b2 = r2(Math.min(D, Math.max(b, lastT + 0.4)))
        // en apple, une énumération datée ne s'ÉCRIT pas : elle devient lineup
        // (mêmes retours d'Axel que dans placeServerAnims)
        const dated = its.filter((it) => Number(it.t) > 0)
        const pose2 = (plan.slideStyle === 'apple' && ['card', 'checklist'].includes(String(sl.type)) && dated.length >= 2)
          ? { ...sl, anim: 'lineup', title: '', motif: '' } : sl
        if (add(pose2, a, b2) || (b2 > b && add(pose2, a, b))) { consumedByPlan.add(sl); n++ }
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

  // (le chrono « N secondes » vit en §0a-ter : camembert ui:'timer' + coupe du
  //  hook sur le mot-nombre — fusionné là-bas pour qu'un seul chemin existe ;
  //  avant la fusion, l'ancien compteur nu de §0a-ter réservait la fenêtre en
  //  premier et ce bloc-ci ne se posait jamais — le « 27 SECONDES » plat de v7.)

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
    // ⚠ « ET LA » N'EST PAS UNE PHRASE, C'EST DU BRUIT. Ce repli se déclenchait
    // sur « et LA vraie vague arrivera » — n'importe quelle phrase française le
    // contient — et posait l'écran de démo `99-resultat` : une vidéo d'un AUTRE
    // homme, en dur dans les assets, sur une vidéo qu'Axel publie sous son
    // visage. Deux fautes d'un coup : un visuel qui ne dit pas le mot, et un
    // média qui n'est pas le sien. On exige la vraie formule de clôture.
    const hit = findSeq(words, 'et voila')
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
  // ── 2c · CHAQUE IDÉE NOMMÉE A SON ANIMATION ────────────────────────────────
  // Axel : « je dis 6 bénéfices après le "voici pourquoi" et y'a 3 animations…
  // qui ne correspondent même pas ». Le chef d'orchestre propose UN `beat` par
  // idée — 26 sur cet audio — mais ne les traduit qu'en 13 slides, et cette
  // dérivation ne lisait que les slides. Résultat : une énumération de sept
  // bénéfices tenait en trois panneaux longs, et le visage bouchait le reste.
  //
  // ── LE CHEF D'ORCHESTRE SERT AVANT MES TABLES ────────────────────────────
  // Mesure sur Cartoon 17 : 3 de ses 13 scenes arrivaient dans la video, dont
  // 5 « en collision » — c'est-a-dire ecrasees parce que la passe des beats
  // ci-dessous avait deja reserve la fenetre. Axel paie une analyse de son
  // audio dont on jetait les trois quarts, et ce qu'il voyait a l'ecran etait
  // mes tables de mots-cles ecrites a la main, pas les choix du modele.
  // Il passe donc EN PREMIER. Mes tables ne servent plus qu'a boucher ce qu'il
  // n'a pas couvert. L'ordre de reservation decide de tout dans ce moteur.

  // ── 2b · LES FENÊTRES QUI PARLENT SONT RÉSERVÉES AVANT LE CONTENU (#149) ──────
  // hasClips → chaque fenêtre du plan (w.clip ≥ 0) porte un clip Hedra. §3b ne les
  // réservait qu'APRÈS placeServerAnims : les slides qui chevauchent 32→50 s
  // prenaient le créneau, §3b jetait la fenêtre (overlaps) et le clip av2/av3
  // partait à la poubelle → des « blancs » à l'écran (Axel, 04/08 : « un clip
  // d'avatar à CHAQUE fenêtre »). On la réserve donc ICI ; le contenu se rogne
  // dans les TROUS entre ces fenêtres. Le hook (§0) garde son claim ; les fenêtres
  // SANS clip (respiration) gardent le plafond 6,5 s / 40 % de §3b.
  if (hasClips) {
    for (const w of plan.avatarSegments || []) {
      if (w.adresse || !Number.isInteger(w.clip) || w.clip < 0) continue
      const a = r2(w.start || 0), b = r2(w.end ?? a)
      if (b - a < 0.6 || b - a > 12) continue   // trop court = flash ; trop long = fenêtre géante héritée → §3b la borne
      if (overlaps(a, b)) continue              // le hook ou un choix explicite tient déjà ce créneau
      w.__clipLocked = true
      claim(a, b)
    }
  }

  placeServerAnims()

  // On repasse donc sur les beats AVANT de poser les fenêtres avatar : chaque
  // mot-clé réellement prononcé, qui trouve une place libre, reçoit SON
  // animation SUR SON MOT. Le visage ne récupère plus que ce qui reste — c'est
  // l'inverse de ce qui se passait.
  {
    let curB = 0, posB = 0, sautB = 0
    // ⚠ LA BORNE SE CALCULE SUR **TOUTES** LES IDEES, pas seulement sur celles
    // qu'on sait animer. En ne gardant que les beats rendables, une idee dont
    // l'animation n'existe pas (« robot » sur « l'IA ») disparaissait aussi du
    // calcul de fin : l'animation precedente s'etirait par-dessus elle.
    const tousLesBeats = (plan.beats || []).filter((b) => b && String(b.word || '').trim())
    // ── L'ANIMATION DOIT ÊTRE JUSTIFIÉE PAR LA PHRASE, PAS PAR UN MOT ─────────
    // Mesuré sur un vrai script : `free` (le badge GRATUIT) tombait sur « zéro »
    // dans « clairement ZÉRO COMPÉTENCE à avoir » — rien à voir avec un prix.
    // `network` (les points qui se relient) tombait sur « débutants ». `countup`
    // tombait sur « argent » sans le moindre chiffre à afficher. Axel, trois
    // fois : « les animations ne correspondent pas du tout ».
    // Le mot déclencheur ne suffit donc plus : certaines animations exigent que
    // la PHRASE porte leur sujet. Faute de quoi on ne pose rien — le visage
    // reprendra la place, et lui au moins ne raconte rien de faux.
    const EXIGE = {
      free:    /gratuit|gratuite|offert|cadeau|sans payer|zero euro|0 ?€|ne paie|payer/i,
      countup: /\d/,                                  // un compteur sans chiffre ne compte rien
      invoice: /investi|budget|cout|coût|facture|depense|dépense|euro|€|prix/i,
      logo:    /logo|marque/i,
      versus:  /concurrence|concurrent|versus|contre|comparé|comparaison|difference|différence/i,
      network: /communaut|reseau|réseau|equipe|équipe|ensemble|connect|relie|relié/i,
      lowcost:  /investi|mise|depart|départ|capital|cout|coût|budget|euro|€/i,
      twopaths: /concurrence|concurrent|personne|seul|autres|tout le monde/i,
    }
    const phraseAutour = (i) => words.slice(Math.max(0, i - 5), i + 8).map((w) => w.text).join(' ')
    // `screen` et `result` sont dans la banque mais un BEAT n'apporte aucune
    // capture : les tenter ici ne produit que des cadres vides (garde d'add(),
    // mesuré sur Cartoon 18). On ne gaspille pas leur mot — il reste au visage.
    const CAPTURES = new Set(['screen', 'result'])
    const beats = tousLesBeats.filter((b) => ANIMS.includes(String(b.anim || '')) && !CAPTURES.has(String(b.anim || '')))
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i]
      const mot = String(b.word || '').trim()
      if (!mot) continue
      // ⚠ MOT ENTIER, PAS SOUS-CHAÎNE. « IA » se trouvait DANS « SasIA » : la
      // recherche renvoyait la phrase du début et l'animation partait 16 s trop
      // tôt, sur un tout autre sujet.
      const norme = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
      const cible = norme(mot)
      let hit = null
      for (let k = curB; k < words.length; k++) {
        if (norme(words[k].text) === cible) { hit = { start: words[k].start, end: words[k].end, i: k }; break }
      }
      if (!hit) hit = findSeq(words, mot, curB)          // repli : expression de plusieurs mots
      if (!hit) { sautB++; continue }
      // ── L'ACCROCHE APPARTIENT AU VISAGE, PAS AUX ANIMATIONS ────────────────
      // Le hook est tenu par l'avatar (règle non négociable d'Axel). Une idée
      // ancrée sur un mot de l'accroche ne peut donc pas s'y poser : fit() la
      // pousse APRÈS, et elle atterrit sur des mots qui n'ont rien à voir.
      // Mesuré sur la v12 : le beat `chat` visait « Claude » à 2,5 s (dans
      // « AvatarAds connecté à Claude vient de sortir ») ; repoussé, il s'est
      // affiché de 3,37 à 4,70 s sur « tu peux maintenant créer » — pendant que
      // le vrai « dans Claude » de 6,02 s, lui, n'avait rien. Quand le mot est
      // redit plus loin, c'est là que l'idée doit vivre.
      const finHook = (plan.hook && plan.hook.end) || 0
      if (finHook > 0.5 && hit.start < finHook) {
        let apres = null
        for (let k = hit.i + 1; k < words.length; k++) {
          if (norme(words[k].text) === cible) { apres = { start: words[k].start, end: words[k].end, i: k }; break }
        }
        if (apres) {
          console.log(`▶ ${b.anim} : « ${mot} » à ${r2(hit.start)}s est dans l'accroche → on prend celui de ${r2(apres.start)}s`)
          hit = apres
        }
      }
      curB = hit.i + 1
      // le sujet de l'animation doit exister dans la phrase, sinon on ne pose rien
      const exige = EXIGE[String(b.anim)]
      if (exige && !exige.test(phraseAutour(hit.i) + ' ' + String(b.value || ''))) {
        console.log(`▶ ${b.anim} écarté sur « ${mot} » : la phrase ne parle pas de ça`)
        sautB++; continue
      }
      // la fenêtre s'arrête au mot du beat SUIVANT : une idée ne déborde jamais
      // sur la suivante, sinon on lit « zéro compétence » sur l'animation de
      // l'investissement.
      // UNE ANIMATION MEURT QUAND SON IDEE MEURT. Elle demarrait bien sur son
      // mot, mais tenait 2,4 s : le calendrier de « par jour » restait a l'ecran
      // pendant « peu d'investissement de depart », `free` pendant « cent pour
      // cent des benefices ». Axel : « les animations ne correspondent pas du
      // tout ». Elles correspondaient une demi-seconde, puis mentaient deux.
      let fin = D
      const iTous = tousLesBeats.indexOf(b)
      for (let j = iTous + 1; j < tousLesBeats.length; j++) {
        const w2 = String(tousLesBeats[j].word || '')
        const h2 = findSeq(words, w2, curB) || findAny(words, [w2], curB)
        if (h2 && h2.start > hit.start) { fin = h2.start - 0.05; break }
      }
      let a = r2(Math.max(0, hit.start - 0.12))
      // ── LA SCÈNE TIENT JUSQU'AU BOUT DE LA PHRASE ─────────────────────────
      // Le plafond de 1,9 s coupait au milieu d'une proposition : « créer
      // n'importe quelle vidéo directement dans | Claude » — le mot qui donne
      // son sens à l'image tombait 0,2 s APRÈS la fin de la fenêtre, et le
      // choix d'animation se faisait donc sans lui. On laisse la scène courir
      // jusqu'à la ponctuation suivante (2,6 s au maximum), toujours bornée
      // par l'idée d'après : elle ne peut pas déborder sur la suivante.
      // ⚠ …MAIS JAMAIS JUSQU'AU MOT DE L'IDÉE SUIVANTE. « lancer un business
      // SANS JAMAIS PASSER DEVANT UNE CAMÉRA » est UNE phrase : en la laissant
      // courir jusqu'au point, `grow` (sur « business ») avalait « caméra » et
      // `faceless` n'avait plus de place — Axel, deux fois : « sans jamais
      // passer devant une caméra, toujours pas ». On borne donc par le premier
      // mot déclencheur d'un beat suivant, quel qu'il soit.
      let stopBeat = D
      for (const o of tousLesBeats) {
        const m2 = norme(String(o.word || ''))
        if (!m2) continue
        for (let k = hit.i + 1; k < words.length; k++) {
          if (norme(words[k].text) !== m2) continue
          if (words[k].start > hit.start && words[k].start < stopBeat) stopBeat = words[k].start - 0.05
          break
        }
      }
      let finPhrase = Math.min(fin, stopBeat)
      for (let k = hit.i; k < words.length && k - hit.i < 10; k++) {
        if (words[k].end - hit.start > 2.6) break
        if (/[.!?]$/.test(String(words[k].text))) { finPhrase = Math.min(finPhrase, words[k].end + 0.12); break }
      }
      const bb = r2(Math.min(D, finPhrase, a + 2.6))
      // ── QUAND LE MOT ARRIVE EN FIN DE PHRASE, ON REMONTE À LA PHRASE ───────
      // Le mot déclencheur est souvent le DERNIER de sa proposition : « sans
      // jamais passer devant une CAMÉRA », « à partir d'un AUDIO ». La fenêtre
      // part alors du mot et bute aussitôt sur l'idée suivante — mesuré :
      // `faceless écarté : 0,91 s même après étirement`, et Axel voyait un
      // graphique de croissance à la place. Or l'animation illustre TOUTE la
      // proposition, pas sa dernière syllabe : on peut donc l'ouvrir dès son
      // début. On ne remonte QUE si la fenêtre est trop courte autrement, et
      // jamais au-delà de la ponctuation précédente ni de 2 s.
      if (bb - a < 1.25) {
        let deb = hit.i
        for (let k = hit.i - 1; k >= 0 && hit.i - k < 9; k--) {
          if (/[.!?,]$/.test(String(words[k].text))) break
          if (words[k + 1].start - words[k].end > 0.32) break
          if (hit.start - words[k].start > 2.0) break
          deb = k
        }
        const na = r2(Math.max(0, words[deb].start - 0.12))
        if (na < a && bb - na >= 1.25 && !overlaps(na, bb)) {
          console.log(`▶ ${b.anim} : « ${mot} » clôt sa phrase → ouvert dès « ${words[deb].text} » (${na}s au lieu de ${a}s)`)
          a = na
        }
      }
      if (bb - a < 1.25) { sautB++; continue }   // sous 1,25 s c'est un flash, pas une scène
      if (add({ anim: b.anim, value: b.value || '', items: b.value ? [{ t: 0, text: String(b.value) }] : [] }, a, bb)) posB++
    }
    if (posB) console.log(`▶ ${posB} idée(s) du script animée(s) sur leur mot` + (sautB ? ` · ${sautB} sans place` : ''))
  }

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
  // #149 — fenêtres à clip verrouillées en §2b : intouchables, hors du plafond de
  // respiration (sinon `overlaps` les jetterait sur leur PROPRE claim).
  const lockedClips = (plan.avatarSegments || []).filter((w) => w.__clipLocked)
  if ((plan.avatarSegments || []).length) {
    plan.avatarSegments = plan.avatarSegments.filter((w) => !w.adresse && !w.__clipLocked)
    const MAXW = 6.5
    let budget = D * 0.4
    // la fenêtre du hook a déjà été réservée en §0 : on garde ses BORNES, mais
    // pas au prix de ce que le plan y avait accroché. `hookWin` est un objet nu
    // {start, end} : le poser tel quel effaçait la photo d'avatar ET le médaillon
    // de la fenêtre 0 — l'animation qu'Axel avait fournie pour le hook
    // disparaissait sans un mot, et le split de marque reprenait la main avec sa
    // pastille dessinée. On fusionne : bornes de §0, contenu du plan.
    const seg0 = (plan.avatarSegments || []).find((w) => (w.start || 0) < 0.6)
    const clamped = hookWin ? [{ ...(seg0 || {}), ...hookWin }] : []
    if (hookWin) budget -= hookWin.end - hookWin.start
    for (const w of plan.avatarSegments.slice().sort((a, b) => a.start - b.start)) {
      if (hookWin && (w.start || 0) < 0.6) continue
      if (budget <= 1) break
      let a = r2(w.start)
      let b = r2(Math.min(w.end ?? w.start + MAXW, w.start + MAXW, w.start + budget))
      // le visage ne passe JAMAIS par-dessus une scène déjà posée : il se
      // décale ou se raccourcit (sinon l'avatar recouvrait le navigateur).
      // #149b — en cas de chevauchement, garder le PLUS GRAND côté libre : la
      // fenêtre 32,08→38,06 s chevauchait le « connect » (32,42→34,21) de 0,3 s
      // à gauche ; l'ancien code coupait à droite du chevauchement (b=32,37,
      // fenêtre morte) alors que 34,26→38,06 était libre — 3,8 s d'avatar
      // jetées, remplacées par un dégradé nu.
      for (const t of taken) {
        if (b <= t[0] + 0.05 || a >= t[1] - 0.05) continue
        if (t[0] - a >= b - t[1]) b = r2(t[0] - 0.05)
        else a = r2(t[1] + 0.05)
      }
      if (b - a < 1.5 || overlaps(a, b)) continue
      // …avec ses médaillons : sans `...w` la fenêtre était recréée à vide et le
      // média accroché en §0a disparaissait sans un mot.
      // ── LE DÉBUT GLISSE ? LE CLIP GLISSE D'AUTANT (Axel, 07/08) ────────────
      // Le rognage ci-dessus peut pousser le début à droite (la fenêtre
      // 32,08→38,06 devenait 36,4→38,06 derrière le « connect » et la bulle
      // chat). Sans décalage, le clip av2 rejouait depuis SON début : à 36,4 s
      // les lèvres prononçaient les mots de 32,1 s — un visage qui dit autre
      // chose que la voix. `clipFrom` dit au worker où recouper le clip ; les
      // lèvres retombent sur leurs mots.
      const glisse = Number.isInteger(w.clip) && w.clip >= 0 && a > r2(w.start || 0) + 0.05
      // ── UN TROU SE REMPLIT PAR LE VISAGE (Axel, 08/08) ────────────────────
      // « à 37 s y'a un blanc qui dure très longtemps » : ce blanc, c'est la
      // fenêtre avatar glissée qu'une garde « stabilité » écartait quand elle
      // devenait courte. La garde visait le mauvais coupable : les rendus ne
      // tombaient pas sur CE clip mais sur les octets Hedra bruts jamais
      // normalisés (voir normaliserClipAvatar dans worker.mjs) et sur le compte
      // d'images attendu/capturé d'HyperFrames (voir dvid dans le moteur). Les
      // deux sont réglés à la racine : la fenêtre courte reprend sa place —
      // l'avatar parle dans les creux entre les animations, comme demandé.
      clamped.push({ ...w, start: a, end: b,
        ...(glisse ? { clipFrom: r2((Number(w.clipFrom) || 0) + a - (w.start || 0)) } : {}) })
      if (glisse) console.log(`▶ fenêtre avatar av${w.clip} décalée à ${a}s → le clip reprend à ${r2(a - (w.start || 0))}s dedans (lèvres synchrones)`)
      budget += 0   // (les fenêtres d'adresse de §0b sont déjà réservées)
      claim(a, b)
      budget -= b - a
    }
    // LES ADRESSES DIRECTES DE §0b SURVIVENT. Elles ont déjà réservé leur place
    // avant tout le monde ; les repasser dans le rognage ci-dessus les faisait
    // tomber sur leur propre réservation (`overlaps`) et disparaître.
    plan.avatarSegments = [...clamped, ...lockedClips, ...adresses2].sort((x, y) => x.start - y.start)
  }

  // …et s'il n'en reste presque rien (l'orchestrateur n'en propose souvent QU'UNE,
  // le hook), on complète dans les trous libres : « 3-4 vidéos de l'avatar »
  // demandées pour #149. Un visage vaut mieux qu'un mot seul à l'écran.
  // ── 3a-bis · CE QU'IL DIT, ON LE DESSINE ────────────────────────────────────
  // La banque est écrite pour le vocabulaire d'AvatarAds. Chez un coach sportif,
  // un restaurateur ou un artisan, presque toutes ses animations sont refusées à
  // juste titre — et la vidéo devient un plan-séquence de visage. Axel : « l'IA
  // sera bloquée et montrera des animations pas cohérentes du tout, et
  // impossible de valider toutes les animations comme ça de chaque domaine ».
  // Avant de rendre les creux au visage, on regarde donc si la PHRASE qu'on y
  // entend contient des choses qu'on sait dessiner. Si oui, on les montre, dans
  // l'ordre où il les dit. Si non, on ne fabrique rien : le visage reprend.
  {
    const finHook = (plan.hook && plan.hook.end) || 0
    const occupe = [...out.map((s) => [s.start, s.end]), ...(plan.avatarSegments || []).map((w) => [w.start, w.end])]
      .sort((a, b) => a[0] - b[0])
    const creux = []
    let c0 = 0
    for (const [a, b] of occupe) { if (a - c0 >= 1.8) creux.push([c0, a]); c0 = Math.max(c0, b) }
    if (D - c0 >= 1.8) creux.push([c0, D])
    let n = 0
    for (const [a, b] of creux) {
      if (n >= 4) break
      if (b <= finHook + 0.2) continue                 // l'accroche appartient au visage
      // on découpe le creux à la phrase : une scène par idée, jamais à cheval
      const cs = (plan.captions || []).filter((w) => w.start >= a - 0.1 && w.end <= b + 0.1)
      if (!cs.length) continue
      let d0 = Math.max(a, cs[0].start - LEAD)
      for (let k = 0; k < cs.length && n < 4; k++) {
        const finPhrase = /[.!?]$/.test(String(cs[k].text || '')) || k === cs.length - 1
        if (!finPhrase) continue
        const d1 = Math.min(b, cs[k].end + 0.1)
        if (d1 - d0 >= 1.6) {
          const sc = sceneDuMot(d0, d1)
          if (sc && add(sc, d0, d1)) {
            n++
            console.log(`▶ scène du mot (${r2(d0)}→${r2(d1)}s) : ${sc.sujets.map((x) => x.mot).join(' · ')}`)
          }
        }
        d0 = Math.min(b, cs[k].end + 0.02)
      }
    }
    if (n) console.log(`▶ ${n} scène(s) dessinée(s) à partir des mots prononcés (hors banque)`)
  }

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
      if (noFace) break                       // aucune respiration à réserver
      if (avWins.length + (plan.avatarSegments || []).length >= 4 || room < 1.6) break
      if (g[1] - g[0] < 2.0) continue
      if (placed.some((t) => Math.abs(t - g[0]) < 6)) continue
      const len = Math.min(4.5, room, g[1] - g[0])
      // clip: -1 : respiration ajoutée ici, pas de clip lipsync à elle
      avWins.push({ start: r2(g[0]), end: r2(g[0] + len), clip: -1 })
      placed.push(g[0]); room -= len
    }
    // FUSION, pas remplacement : la fenêtre du hook venue du plan reste
    plan.avatarSegments = [...(plan.avatarSegments || []), ...avWins].sort((a, b) => a.start - b.start)
    for (const w of avWins) claim(w.start, w.end)
  }
  const avWinsAll = plan.avatarSegments || []

  // ── 3b-bis · UN TROU SE REMPLIT PAR LE VISAGE ───────────────────────────────
  // Axel : « limite si tu as un trou tu mets ton avatar principal, ça dynamise et
  // c'est clean ». Le plafond de §3b (40 % de visage, 4 fenêtres) protégeait le
  // rythme, mais il laissait passer des creux : la scène d'avant s'y étirait, ou
  // l'écran restait sur un fond vide. Un visage n'est jamais faux — c'est bien
  // l'animation hors sujet qui l'est. On passe donc une dernière fois sur ce qui
  // reste et on y met la personne qui parle, sans plafond.
  {
    // ── UNE COQUILLE VIDE CÈDE AU VISAGE (Cartoon 20, 10/08) ────────────────
    // Le chef pose parfois une carte `money`/`blankfill`/sans-type qui n'a NI
    // valeur, NI items, NI capture, NI média, NI sujets dessinés : elle ne
    // montre rien. Sur Cartoon 20 une carte `money` nue tenait 4,25→6,16 s
    // juste après le hook — le « blanc » qu'Axel a filmé. Un panneau qui
    // encadre du vide est pire que pas de panneau : on la retire ICI, AVANT le
    // calcul des creux, et on libère son créneau (`taken`) pour que le trou
    // retombe sur le visage (règle 2). Les cartes à matière ne sont jamais
    // touchées : c'est le VIDE qu'on refuse, pas le contenu.
    if (!noFace) {
      const coquilleVide = (s) => {
        const nm = String(s.anim || '')
        if (s.screen || s.assetId || s.src || s.user || (s.items || []).length ||
            s.value || s.title || (s.sujets || []).length) return false
        return nm === 'money' || nm === 'blankfill' || nm === ''
      }
      // ── LES CARTES 100 % TEXTE CÈDENT AUSSI AU VISAGE (Axel, 11/08) ─────────
      // « les animations où y'a du texte comme ça à bannir » — les cartes
      // eyebrow + GROS TITRE + pastille (« PEU / BEAUCOUP », « LE SECRET:
      // EXPRESS ») ne montrent AUCUNE action : ce sont les mots redits en géant,
      // exactement ce que la règle #6 refuse (« si ça tient sur une image fixe,
      // ça n'entre pas »). Elles passent par le rendu `content` de l'engine
      // (slide sans `anim`, avec titre/items). On les retire comme les coquilles
      // vides — le visage reprend (règle #2). On ÉPARGNE la vraie matière : un
      // KPI chiffré réellement dit (règle #3/#44), une énumération de ≥2 lignes
      // datées qui claquent chacune sur leur mot, une capture, un média, ou une
      // vraie animation de la banque.
      const coquilleTexte = (s) => {
        if (s.anim || s.type === 'punch' || s.cta) return false
        if (s.screen || s.assetId || s.src || s.user || s.overlayMedia || s.ui) return false
        if ((s.start || 0) > D - 4) return false            // le CTA de fin garde son texte (le mot à commenter)
        const its = (s.items || []).filter((it) => it && String(it.text || '').trim())
        const num = String(s.value ?? s.center ?? (its[0] && its[0].text) ?? '')
        if (s.type === 'kpi' && /\d/.test(num)) return false // SEUL un chiffre réellement dit se garde (règle #3/#44)
        // Tout le reste est du texte design qui ne montre AUCUNE action : l'eyebrow
        // (« COMPARAISON », « SECRET »), le gros titre, les pastilles « QUELQUES
        // EUROS »/« MILLIERS D'EUROS ». Axel l'a pointé DEUX fois sur la même carte
        // comparaison (11/08). L'ancienne exemption « ≥2 lignes datées » la laissait
        // passer — supprimée : une énumération de texte tient sur une image fixe,
        // donc règle #6, elle cède au visage (ou à une vraie anim comme bars2).
        return !!(s.title || its.length || s.eyebrow)
      }
      for (let i = out.length - 1; i >= 0; i--) {
        const s = out[i]
        if (!coquilleVide(s) && !coquilleTexte(s)) continue
        const k = taken.findIndex((w) => Math.abs(w[0] - s.start) < 0.06 && Math.abs(w[1] - s.end) < 0.06)
        if (k >= 0) taken.splice(k, 1)
        console.log(`▶ carte texte « ${(s.title || s.anim || '—')} » ${r2(s.start)}→${r2(s.end)}s retirée → le visage reprend`)
        out.splice(i, 1)
      }
      // ── #88 · JAMAIS PLUS DE 3 ANIMATIONS D'AFFILÉE SANS LE VISAGE ──────────
      // Axel : « des fois y'a beaucoup trop d'animations à la chaîne… après la
      // 3ème animation il y a OBLIGATOIREMENT l'avatar ». Sur le montage de test
      // du 11/08, le milieu (5→23 s) enchaînait 5-6 anims sans un seul visage.
      // On casse donc toute série de 4 anims ABSTRAITES consécutives en libérant
      // la 4ᵉ : son créneau redevient un trou que la passe ci-dessous (§3b-bis)
      // comble par le visage — avec toute sa logique de reprise de clip payé.
      // Les captures, médias et le CTA NE COMPTENT PAS dans la série (ce sont de
      // vrais plans qu'Axel veut voir) et remettent le compteur à zéro. On
      // n'évince que si le créneau libéré peut porter un visage (≥ 1,2 s).
      {
        const abstraite = (s) => !s.screen && !s.assetId && !s.src && !s.user &&
          !s.overlayMedia && !s.ui && String(s.anim) !== 'media' && s.type !== 'punch' && !s.cta
        let serie = 0
        for (const s of out.slice().sort((a, b) => (a.start || 0) - (b.start || 0))) {
          if (!abstraite(s)) { serie = 0; continue }
          serie++
          // ≥ 1,4 s : le remplissage §3b-bis borne le trou à (fin − 0,05) et exige
          // ≥ SEUIL (1,2 s) de visage — en deçà, on laisserait un fond nu.
          if (serie >= 4 && (s.end - s.start) >= 1.4) {
            const j = out.indexOf(s)
            if (j < 0) continue
            const k = taken.findIndex((w) => Math.abs(w[0] - s.start) < 0.06 && Math.abs(w[1] - s.end) < 0.06)
            if (k >= 0) taken.splice(k, 1)
            out.splice(j, 1)
            console.log(`▶ #88 : 4ᵉ animation d'affilée « ${s.anim || s.title || '—'} » ${r2(s.start)}→${r2(s.end)}s → rendue au visage`)
            serie = 0
          }
        }
      }
    }
    const bornes = [...out.map((s) => [s.start, s.end]), ...(plan.avatarSegments || []).map((w) => [w.start, w.end])]
      .sort((a, b) => a[0] - b[0])
    // 1,2 s est le seuil du VISAGE : en dessous, le montrer puis le retirer fait
    // un clignotement. Sans visage, il n'y a rien à faire clignoter et le trou
    // reste à l'écran — 0,97 s et 0,83 s de fond nu sur le rendu du 30/07. Le
    // seuil descend donc à 0,3 s quand c'est la scène voisine qui reprend.
    const SEUIL = noFace ? 0.3 : 1.2
    const creux = []
    let cur = 0
    for (const [a, b] of bornes) { if (a - cur >= SEUIL) creux.push([cur, a]); cur = Math.max(cur, b) }
    if (D - cur >= SEUIL) creux.push([cur, D])
    let n = 0, etires = 0, animes = 0
    for (const [a, b] of creux) {
      const d = Math.min(b - 0.05, a + 6.5)
      if (d - a < SEUIL || overlaps(a, d)) continue
      // Sans visage, la hiérarchie d'Axel est : UNE ANIMATION d'abord, la scène
      // voisine ensuite. Lui, sur le rendu du 31/07 (les mots géants « et
      // entreprendre » seuls à l'écran pendant l'intro) : « les mots comme ça
      // tout seul sont bannis, il faut mettre une animation ou l'avatar
      // principal à la place — pas d'avatar ? mets une animation ». On repêche
      // donc les beats du chef d'orchestre dont le mot tombe dans le creux :
      // c'est SON idée pour ce moment-là, elle avait juste perdu la fenêtre.
      // add() garde tous ses gardes-fous (banque, garde sémantique, doublons).
      if (noFace) {
        const fin = r2(b - 0.05)
        let pose = null
        for (const bt of (plan.beats || [])) {
          // même règle qu'en §2c : un beat `screen`/`result` n'a pas de capture,
          // il rendrait un cadre vide — add() le refuserait de toute façon.
          if (['screen', 'result'].includes(String(bt.anim || ''))) continue
          const cible = norm(String(bt.word || '').trim())
          if (!cible) continue
          let hit = null
          for (const w of words) {
            if (w.start < a - 0.05 || w.end > d + 0.3) continue
            const nw = norm(w.text)
            // « argent » doit trouver « l'argent » : l'élision colle l'article au
            // mot (l', d', qu'…). Égalité stricte OU le mot en fin de forme, avec
            // au plus deux lettres devant — jamais une sous-chaîne libre (le
            // piège « IA » dans « SasIA » est documenté plus haut).
            if (nw === cible || (nw.endsWith(cible) && nw.length - cible.length <= 2)) { hit = w; break }
          }
          if (!hit) continue
          pose = add({ anim: bt.anim, value: bt.value || '', items: bt.value ? [{ t: 0, text: String(bt.value) }] : [] },
            r2(Math.max(a + 0.02, hit.start - 0.12)), r2(Math.min(d, hit.end + 1.5)))
          if (process.env.DERIVE_DEBUG && !pose) console.log(`TROU  beat ${bt.anim} refusé sur « ${bt.word} » à ${r2(hit.start)}`)
          if (pose) break
        }
        if (pose) {
          // l'animation prend le creux entier : un sous-trou redeviendrait des
          // mots géants, exactement ce qu'on vient d'interdire
          if (pose.start > a + 0.1 && !overlaps(r2(a), pose.start)) { claim(r2(a), pose.start); pose.start = r2(a) }
          if (pose.end < fin - 0.1 && !overlaps(pose.end, fin)) { claim(pose.end, fin); pose.end = fin }
          animes++
          continue
        }
        const avant = out.filter((s) => s.end <= a + 0.06).sort((x, y) => y.end - x.end)[0]
        const apres = out.filter((s) => s.start >= b - 0.06).sort((x, y) => x.start - y.start)[0]
        if (avant) { avant.end = fin; claim(a, fin); etires++ }
        else if (apres) { apres.start = r2(a); claim(a, fin); etires++ }
        continue
      }
      // clip: -1 : fenêtre créée par la dérivation, pas de clip lipsync à elle.
      // ── LE TROU QUI RECOUVRE UN CLIP PAYÉ LE FAIT PARLER (Axel, 07/08) ─────
      // Mesuré sur le montage 3df63a0d : le trou 38,06→39,76 s montrait la photo
      // figée alors que le clip av3 (39,12→46,78, payé chez Hedra) commence en
      // plein dedans — « à 39 s le lipsync n'est pas fait ». Les animations qui
      // ont pris le reste de la fenêtre av3 (lineup, cards — validées) restent :
      // ici on ne récupère QUE la part du trou où un clip sait parler. Le trou
      // se scinde donc à la frontière du clip : photo avant (même visage, il
      // attend), clip lipsync après (il parle). Jamais de clip décalé : la
      // partie adoptée démarre PILE au début de la fenêtre d'origine, ou dedans
      // avec `clipFrom` — les lèvres disent toujours leurs mots.
      let adopte = null
      if (hasClips) {
        adopte = fenetresSources.find((s) =>
          Math.max(a, s.start) < Math.min(d, s.end) - 0.5)
      }
      if (adopte && adopte.start <= a + 0.05 && a - adopte.start < (adopte.end - adopte.start) - 0.4) {
        // le trou entier est DANS la fenêtre d'origine, et il reste de la voix
        // à cet endroit du clip : une seule fenêtre, recoupée dedans
        ;(plan.avatarSegments = plan.avatarSegments || []).push(
          { start: r2(a), end: r2(d), comble: true, clip: adopte.clip, clipFrom: r2(Math.max(0, a - adopte.start)) })
        console.log(`▶ trou ${r2(a)}→${r2(d)}s : le clip av${adopte.clip} reprend la parole (repris à ${r2(Math.max(0, a - adopte.start))}s dedans)`)
      } else if (adopte && adopte.start > a + 0.05 && d - adopte.start >= 0.55 && adopte.start - a >= 0.3) {
        // le clip commence AU MILIEU du trou : photo jusqu'à son début (même
        // visage, continuité assurée), puis le clip parle — c'est le cas du
        // trou de 38,06 s, où av3 démarre à 39,12 s
        // La v4 mettait la PHOTO en attendant le clip — et Axel a lu la photo
        // figée comme un bug : « à 38 s le lipsync n'est pas fait sur
        // l'avatar ». Un visage à l'écran DOIT parler : la fenêtre devient UNE
        // SEULE scène à générer (clip 'G*') ; le worker paie une fois chez
        // Hedra, le cache par contenu garde pour toutes les relances.
        const gid = 'G' + (plan._prochainG = (plan._prochainG || 0) + 1, plan._prochainG - 1)
        ;(plan.avatarSegments = plan.avatarSegments || []).push(
          { start: r2(a), end: r2(d), comble: true, clip: gid })
        console.log(`▶ trou ${r2(a)}→${r2(d)}s : clip lipsync À GÉNÉRER (${gid}) — un visage à l'écran doit parler`)
      } else {
        ;(plan.avatarSegments = plan.avatarSegments || []).push({ start: r2(a), end: r2(d), comble: true, clip: -1 })
      }
      claim(a, d); n++
    }
    if (n) {
      plan.avatarSegments.sort((x, y) => x.start - y.start)
      console.log(`▶ ${n} trou(s) comblé(s) par le visage`)
    }
    if (animes) console.log(`▶ ${animes} trou(s) comblé(s) par une animation du chef d'orchestre (aucun visage)`)
    if (etires) console.log(`▶ ${etires} trou(s) rendu(s) à la scène voisine (aucun visage disponible)`)
  }

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
      if (!(gap > 0 && gap < 1.6)) continue
      // UNE ANIMATION NE SURVIT PAS À SON IDÉE. Cette passe collait chaque scène
      // à la suivante pour éviter les trous — au prix d'un visuel qui MENT : le
      // calendrier de « par jour » restait 1 s de plus sur « peu d'investissement
      // de départ », `free` débordait sur « cent pour cent des bénéfices ».
      // Axel : « les animations ne correspondent pas du tout ». Un panneau animé
      // ne s'étire donc que de 0,35 s ; au-delà, mieux vaut le trou — il sera
      // comblé par le visage, qui lui ne raconte rien de faux.
      //
      // ── …MAIS UN TROU TROP COURT POUR UN VISAGE NE DOIT PAS RESTER NU ──────
      // (Axel, 07/08 : « petit trou à 46,5 s ».) Mesuré sur le montage 3df63a0d :
      // la card `faceless` s'arrêtait à 46,37 s, le punch arrivait à 46,74 s —
      // 0,37 s de dégradé nu, trop court pour §3b-bis (seuil visage 1,2 s), déjà
      // passé de toute façon. Deux issues, dans l'ordre :
      //   1. si la PHRASE continue sur le reliquat (aucune fin de phrase entre
      //      les deux), l'animation ne ment pas en tenant jusqu'au suivant — le
      //      plafond de 0,35 s ne protégeait rien ici, on va jusqu'au bout ;
      //   2. sinon, la scène SUIVANTE avance son entrée sur le reliquat — sauf
      //      une fenêtre à clip (les lèvres glisseraient) ou un média (sa
      //      fenêtre est un point du script).
      const cible = r2((chain[i + 1].start || 0) - 0.02)
      if (!isAnimPanel(chain[i])) { chain[i].end = cible; continue }
      const fin0 = r2(chain[i].end || 0)
      let fin1 = r2(Math.min(cible, fin0 + 0.35))
      const reliquat = r2(cible - fin1)
      if (reliquat > 0.05 && reliquat < 0.8) {
        const phraseCoupe = words.some((w) => w.end > fin0 - 0.3 && w.end < cible - 0.12 && /[.!?]$/.test(String(w.text)))
        if (!phraseCoupe) fin1 = cible
        else {
          const nxt = chain[i + 1]
          const clipReel2 = Number.isInteger(nxt.clip) && nxt.clip >= 0
          if (!clipReel2 && nxt.anim !== 'media') nxt.start = r2(fin1 + 0.02)
        }
      }
      chain[i].end = fin1
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

  // ── JAMAIS UN MOT TOUT SEUL À L'ÉCRAN ──────────────────────────────────────
  // Règle d'Axel, donnée et redonnée : « jamais un mot tout seul ».
  //
  // Le code n'en appliquait que la moitié. Il tenait une liste de mots CREUX
  // (« vont », « entièrement », les prépositions) et ne refusait QUE ceux-là :
  // un mot plein isolé — « bénéfices », « débutants » — passait sans problème.
  // Or ce n'est pas la vacuité du mot qui gêne, c'est l'isolement : un substantif
  // seul en très gros ne montre rien de plus qu'un adverbe seul. La liste était
  // aussi un puits sans fond, à rallonger à chaque rendu raté.
  //
  // Un mot seul est donc refusé, quel qu'il soit. Une seule exception, et elle
  // vient d'une autre de ses règles : UN CHIFFRE PORTE UNE INFORMATION. « 100 % »,
  // « 2,1M » disent quelque chose que la voix vient d'annoncer — c'est tout le
  // principe de `countup`. Le reste dégage, et la scène voisine s'étire sur le
  // trou (§3c) : un trou vaut mieux qu'un mot posé là pour meubler.
  const motPlein = (txt) => {
    const mots = String(txt || '').trim().split(/[\s,/·]+/).filter(Boolean)
    if (mots.length >= 2) return true               // deux mots ou plus : c'est une idée
    if (!mots.length) return false
    return /\d/.test(norm(mots[0]))                 // seul un chiffre survit isolé
  }

  const kept = []
  const blockers = [...out, ...avWinsAll]
  let dropUnrenderable = 0, dropCollide = 0, dropUnsaid = 0, dropCreux = 0, dropPages = 0
  for (let sl of srcSlides) {
    if (consumed.has(sl) || consumedByPlan.has(sl)) continue
    // Retour d'Axel (31/07, style apple) : « "détermine ton identité" — non,
    // pas de mots sur une page !!! only animation ». En apple, une page-titre
    // sans matière (type banner : un titre, pas d'items) n'existe plus — sa
    // fenêtre revient aux animations, aux beats ou au visage. Les panneaux à
    // CONTENU (items datés, kpi, checklist) restent : eux portent de la matière.
    if (plan.slideStyle === 'apple' && String(sl.type) === 'banner'
      && !(sl.items || []).some((it) => String(it.text || '').trim())) { dropPages++; continue }
    // ── UNE ANIMATION BANNIE RESTE BANNIE, MÊME AVEC DU TEXTE DESSUS ─────────
    // Axel, 03/08 : « il met des animations qu'on est censé avoir supprimé ».
    // Vérifié sur son montage : `target` et `check` posées, toutes deux dans
    // REFUSEES depuis des semaines.
    //
    // REFUSEES ne filtrait que le CATALOGUE proposé au chef d'orchestre — une
    // interdiction à l'entrée, sans videur à la porte. Et le seul contrôle au
    // placement était `!RENDERABLE.has(anim) && !hasContent(sl)` : une animation
    // bannie qui portait du texte passait par le `&& !hasContent`. C'est
    // exactement par là qu'elles sont entrées.
    //
    // On ne jette pas la scène pour autant : son CONTENU peut être bon (une
    // checklist, un chiffre). On lui retire seulement son animation interdite et
    // on la laisse redevenir un panneau de texte ; si elle est vide, les règles
    // qui suivent l'écarteront comme n'importe quelle scène creuse.
    if (sl.anim && REFUSEES.has(String(sl.anim))) {
      console.log(`▶ « ${sl.anim} » est bannie (REFUSEES) → animation retirée à ${r2(sl.start)}s${hasContent(sl) ? ', le contenu reste' : ', scène vide'}`)
      sl = { ...sl, anim: '' }
    }
    if (sl.anim && !RENDERABLE.has(sl.anim) && !hasContent(sl)) {
      // On jetait en silence : impossible de savoir CE QU'IL DEMANDE. Axel :
      // « on peut toujours créer l'animation qu'il veut si elle est pertinente
      // ou on la redirige vers la plus proche ». Encore faut-il connaître le
      // nom. On le journalise, et on tente une redirection par synonyme.
      // ── ON NE REMPLACE PLUS PAR « LA PLUS PROCHE » ──────────────────────
      // Axel, 03/08 : « il met des animations au hasard même si ça ne
      // correspond pas », puis : « non, il ne faut pas prendre la plus proche
      // dans le catalogue ».
      //
      // La redirection partait d'une bonne intention — ne pas perdre la fenêtre
      // quand le chef demande une animation absente. Mais « la plus proche »
      // n'est proche que dans une table écrite à la main : `check` devenait
      // `blankfill`, `zero` devenait `blankfill`, `free` aussi. Trois idées
      // différentes finissaient sur le même visuel, qui n'en disait aucune. Un
      // à-peu-près répété devient du hasard.
      //
      // Une animation demandée qui n'existe pas est donc simplement abandonnée.
      // La fenêtre n'est pas perdue pour autant : §3b-bis la rend au VISAGE, et
      // les scènes voisines s'étirent dessus (§3c). Un plan sur la personne qui
      // parle vaut mieux qu'un visuel qui ne veut rien dire — c'est vrai pour le
      // spectateur, et c'est ce qu'Axel demande depuis le début.
      //
      // On garde la trace du nom demandé : c'est la matière de #37, la file des
      // animations à créer.
      const voulu = String(sl.anim)
      {
        console.log(`▶ « ${voulu} » demandé par le chef d'orchestre : absent de la banque → fenêtre rendue au visage (aucune substitution)`)
        dropUnrenderable++; continue
      }
    }
    // même garde qu'en add() : une capture sans fichier repassait par ICI quand
    // placeServerAnims l'avait refusée — et le cadre vide revenait par la
    // fenêtre après être sorti par la porte.
    if ((sl.anim === 'screen' && !sl.screen) || (sl.anim === 'result' && !sl.screen && !sl.userFile)) {
      console.log(`▶ ${sl.anim} écarté (§4) : aucune capture à montrer`)
      dropUnrenderable++; continue
    }
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
  if (dropUnrenderable || dropCollide || dropUnsaid || dropCreux || dropPages) {
    console.log(`▶ scènes serveur écartées : ${dropUnrenderable} non rendables · `
      + `${dropCollide} en collision · ${dropUnsaid} dont aucun mot n'est prononcé · `
      + `${dropCreux} réduites à un mot seul`
      + (dropPages ? ` · ${dropPages} page(s)-titre (apple : only animation)` : ''))
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
      if ((sl.end || 0) - a >= 0.8) { flat.push({ ...sl, start: a }); continue }
      // ── AVANT DE JETER, ON DEMANDE À CELUI D'AVANT DE SE POUSSER ──────────
      // La règle « le premier arrivé garde l'écran » condamnait la seconde
      // scène même quand elle était calée sur SON mot et que la première avait
      // déjà eu son temps. Mesuré sur le Cartoon 18 : `grow` (sur « business »)
      // débordait sur « sans jamais passer devant une caméra », `faceless` se
      // retrouvait à 0,73 s et disparaissait — Axel, trois fois de suite :
      // « sans jamais passer devant une caméra, toujours pas ».
      // On rogne donc le précédent, à condition qu'il lui reste de quoi
      // exister. Personne n'est jeté tant que les deux peuvent tenir.
      const finLast = r2(Math.max(last.start + 0.05, (sl.start || 0) - 0.05))
      if (finLast - last.start >= 0.8 && (sl.end || 0) - (sl.start || 0) >= 0.8) {
        console.log(`▶ ${last.anim || last.type} rogné (${last.end}→${finLast}s) pour laisser ${sl.anim || sl.type} tomber sur son mot`)
        last.end = finLast
        flat.push(sl)
        continue
      }
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
      // ⚠ deux scènes à SUJET OUVERT portent le même nom d'animation mais ne
      // montrent pas la même chose : les fusionner faisait disparaître les
      // icônes de la seconde (mesuré sur le banc « salle de sport » — « séries,
      // finition, machines » avalées par « programme, séances »).
      (!sl.screen && !prev.screen && sl.anim && prev.anim === sl.anim && sl.ui === prev.ui
        && !(sl.anim === 'sujet' || prev.anim === 'sujet'))
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
    // SON MÉDIA DANS LE HOOK PASSE AVANT LE SPLIT DE MARQUE. Quand la fenêtre
    // porte déjà un médaillon — l'animation qu'il a fabriquée — le split coupait
    // l'écran en deux et affichait une pastille DESSINÉE à la place. Axel :
    // « au début tu mets un écran 9:16 avec l'avatar principal, puis l'animation
    // en plus petit ». Visage plein cadre + son animation en médaillon : c'est
    // exactement ce que le médaillon fait, et le split le lui interdisait.
    // …et JAMAIS quand le média de hook est déjà en médaillon sur la fenêtre
    // (retour d'Axel 31/07 : avatar plein écran + influenceuse en petit — le
    // split couperait exactement ce qu'il demande de garder entier)
    if (first && (first.start || 0) < 0.6 && !first.duo && !(first.insets || []).length
      && !(hookWin && (hookWin.insets || []).length)) {
      const early = words.filter((w) => w.start < Math.min(4, first.end ?? 4))
      const hit = early.find((w) => BRANDS.includes(norm(w.text)))
      if (hit) {
        // le retour au plein cadre : le moment où il ARRÊTE de parler de l'outil
        // pour s'adresser au spectateur
        const back = words.find((w) => w.start > hit.end
          && ['texplique', 'jexplique', 'montre', 'apprends', 'regarde', 'suis'].includes(norm(w.text)))
        const cut = r2(Math.min(first.end ?? 4, back ? Math.max(back.start - 0.35, hit.end + 0.8) : hit.end + 2.2))
        const brand = String(hit.text).replace(/[.,!?«»"]/g, '').trim()
        // une vidéo (ou image) de marque déclarée `hook` remplace la pastille dessinée
        const hk = (plan.broll || []).find((b) => b.hook && (opts.assetFiles || {})[b.assetId])
        const src = hk ? (opts.assetFiles || {})[hk.assetId] : ''
        if (cut > (first.start || 0) + 0.8) {
          // Le split crée DEUX fenêtres à partir d'UNE seule : la seconde doit
          // rejouer LE MÊME clip lipsync, à partir de la seconde où on l'a
          // coupé. Sans `clip`/`clipFrom`, elle cherchait un « av1 » qui
          // n'existe pas et retombait sur la photo fixe — le visage cessait de
          // parler pile au milieu du hook.
          segs.splice(0, 1,
            // `first.clip ?? 0` et plus `0` en dur : la fenêtre d'origine porte
            // désormais son indice de clip — le split doit rejouer LE SIEN,
            // pas systématiquement av0 (faux dès que le hook n'est pas la
            // première fenêtre du plan d'orchestrate).
            { ...first, end: cut, duo: { brand, ...(src ? { src } : {}) }, clip: first.clip ?? 0, clipFrom: 0 },
            ...((first.end ?? 0) - cut > 0.6
              ? [{ ...first, start: cut, clip: first.clip ?? 0, clipFrom: r2(cut - (first.start || 0)) }] : []))
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

  // ── LES COUCHES MÉDIA S'ATTACHENT À LEUR HÔTE ──────────────────────────────
  // Un panneau qui couvre la fenêtre reçoit slide.overlayMedia ; sinon c'est
  // l'avatar qui la porte (le médaillon existant fait déjà le travail).
  for (const L of plan.__mediaLayers || []) {
    const host = (plan.slides || []).find((sl) => sl.start <= L.start + 0.05 && sl.end >= L.start + 0.3)
    if (host) { host.overlayMedia = { src: L.src, pos: L.pos, start: L.start, end: L.end }; continue }
    const seg = (plan.avatarSegments || []).find((sg) => sg.start <= L.start + 0.05 && sg.end >= L.start + 0.3)
    if (seg) (seg.insets = seg.insets || []).push({ src: L.src, assetId: L.assetId, start: L.start, end: Math.min(L.end, seg.end) })
  }
  delete plan.__mediaLayers

  // ── CE QU'ON N'A PAS LE TEMPS DE VOIR NE DOIT PAS ÊTRE À L'ÉCRAN ───────────
  // Une animation a besoin d'entrer (0,2 s), de jouer, puis de sortir (0,18 s).
  // Sous 1,1 s il ne reste rien à jouer : on voit un objet apparaître et
  // disparaître, à moitié dessiné. Axel, à 34 s du Cartoon 18 : « il met une
  // animation incomplète qui ne sert à rien puisqu'elle reste 1 seconde, on a
  // même pas le temps de la voir ». Les plancher existants s'appliquent à la
  // POSE ; ceux-ci sont des scènes rognées APRÈS coup par un voisin. On fait
  // donc le ménage à la toute fin, une fois toutes les bornes figées.
  // Les captures et les médias échappent à la règle : une image reste lisible
  // en une seconde, c'est le mouvement qui ne l'est pas.
  {
    const avant = (plan.slides || []).length
    plan.slides = (plan.slides || []).filter((s) => {
      const d = (s.end || 0) - (s.start || 0)
      if (d >= 1.1) return true
      if (s.screen || s.assetId || s.overlayMedia || String(s.anim) === 'media' || s.ui) return true
      console.log(`▶ ${s.anim || s.type} écarté : ${r2(d)}s à l'écran, rogné par son voisin — on ne le verrait pas`)
      return false
    })
    if (plan.slides.length !== avant) console.log(`▶ ${avant - plan.slides.length} scène(s) trop courte(s) retirée(s)`)
  }

  // ── UNE CAPTURE REND LA MAIN QUAND SON DERNIER GESTE EST FAIT ─────────────
  // Axel, sur la v16 : « il encadre toujours l'étape 2 pour "copie la clé",
  // rends-toi ensuite dans les paramètres de Claude — il est encore resté bloqué
  // sur "ouvre les Connecteurs", donc ce n'est pas synchronisé ».
  // Une capture s'étirait jusqu'à la scène suivante, cadre figé sur le dernier
  // bouton cliqué. Une fois le geste fait, elle n'a plus rien à dire : elle
  // s'arrête une demi-seconde après, et ce qui suit reprend la fenêtre. Le filet
  // à creux, juste en dessous, ne laissera pas de vide derrière elle.
  {
    let rendues = 0
    for (const sc of plan.slides || []) {
      const pas = (sc.steps || []).map((x) => Number(x.t) || 0).filter(Boolean)
      if (!sc.screen || !pas.length) continue
      const fin = r2(Math.max(...pas) + 0.75)
      if (fin >= sc.end - 0.15 || fin - sc.start < 1.1) continue
      sc.end = fin
      rendues++
    }
    if (rendues) console.log(`▶ ${rendues} capture(s) rendue(s) après leur dernier geste (au lieu de tenir jusqu'à la scène suivante)`)
  }

  // ── UN VISAGE EN PAYSAGE SANS SLIDE AU-DESSUS, C'EST UN ÉCRAN VIDE ────────
  // Le format « paysage » place la personne dans la moitié BASSE, sous une
  // slide — c'est une bande cinéma, pas un plan. Quand la slide qui devait
  // l'accompagner a été refusée en cours de route, il reste une bande de visage
  // sous un grand vide, et la dérivation, elle, comptait cette fenêtre comme
  // occupée : aucun filet ne pouvait voir le trou. Sans slide au-dessus, la
  // fenêtre repasse en portrait — le visage prend tout l'écran, et il n'y a
  // plus rien à combler.
  {
    let redressees = 0
    for (const w of plan.avatarSegments || []) {
      if (String(w.format) !== 'paysage') continue
      const dessus = (plan.slides || []).some((s) => s.start < w.end - 0.15 && s.end > w.start + 0.15)
      if (dessus) continue
      w.format = 'portrait'
      redressees++
    }
    if (redressees) console.log(`▶ ${redressees} fenêtre(s) avatar en paysage sans slide → repassées en portrait`)
  }

  // ── LE DERNIER FILET : PLUS AUCUN CREUX DE PLUS D'UNE SECONDE ─────────────
  // §3b-bis remplit déjà les trous par le visage, mais il tourne AVANT la fusion
  // des voisins, le rognage des scènes trop courtes et le ménage final : chacun
  // peut rouvrir un creux derrière lui. Mesuré sur la v15 : 3,2 s de fond nu
  // entre 34,4 s et 37,6 s, sur « il ne te reste plus qu'à lui demander de créer
  // une image, une vidéo ou même un montage » — Axel : « entre 34 et 37 secondes
  // y'a un écran blanc, l'animation n'a pas marché ».
  // On repasse donc en TOUT DERNIER, une fois les bornes définitives, et on
  // étire la scène d'avant (ou celle d'après) pour recouvrir. Un plan qui dure
  // un peu trop n'a jamais choqué personne ; un fond vide, si.
  {
    const bornes = [
      ...(plan.slides || []).map((s) => [s.start, s.end, s]),
      ...(plan.avatarSegments || []).map((w) => [w.start, w.end, w]),
    ].filter((x) => typeof x[0] === 'number' && typeof x[1] === 'number').sort((a, b) => a[0] - b[0])
    // 0,15 s : sur un job AUDIO SEUL il n'y a pas de vidéo de base derrière —
    // le moindre creux montre le dégradé nu. Le 0,35 d'avant laissait passer le
    // trou de ~0,3 s à 10 s de la v9 (Axel : « y'a toujours cette espace vide à
    // 10 secondes »). Et on étire la scène d'avant JUSQUE DANS la suivante
    // (+0,45 s = la durée de la poussée) : bornes seulement contiguës, le
    // sortant était déjà caché pendant que l'entrant glissait → dégradé visible
    // quand même. Un léger chevauchement, la poussée le recouvre proprement.
    const CREUX = 0.15
    let cur = 0, bouches = 0
    for (const [a, , ] of bornes) {
      if (a - cur >= CREUX) {
        const avant = bornes.filter((x) => x[1] <= cur + 0.06).sort((x, y) => y[1] - x[1])[0]
        const apres = bornes.find((x) => x[0] >= a - 0.06)
        if (avant) { avant[2].end = r2(Math.min(D, a + 0.45)); bouches++ }
        else if (apres) { apres[2].start = r2(cur); bouches++ }
      }
      cur = Math.max(cur, bornes.filter((x) => x[0] <= a).reduce((m, x) => Math.max(m, x[1]), cur))
    }
    const dernier = bornes[bornes.length - 1]
    if (dernier && D - dernier[1] >= CREUX) { dernier[2].end = r2(D); bouches++ }
    if (bouches) console.log(`▶ ${bouches} creux bouché(s) par la scène voisine (seuil ${CREUX}s)`)
  }

  // ── AUCUN MÉDIA DE L'UTILISATEUR NE DISPARAÎT EN SILENCE ────────────────────
  // Un média accroché en médaillon (§0a) ne vit pas par lui-même : il est
  // suspendu à une fenêtre avatar. Or ces fenêtres sont ensuite rebâties deux
  // fois — sous contrainte de budget et de collisions, puis par le split de
  // marque — et quand l'hôte saute, le média saute avec, sans une ligne de log.
  //
  // MESURÉ SUR CARTOON 18 (02/08). Le chef n'avait donné QU'UNE fenêtre avatar,
  // de 4,24 à 48,42 s. Les deux médias d'Axel s'y sont accrochés, puis elle a
  // été rognée à 6,5 s : leurs médaillons, posés à 0,98 s et 8,44 s, sont
  // tombés hors cadre. Les deux fichiers étaient dans le plan, aucun des deux
  // n'était à l'écran — le cadre s'affichait noir. Un montage qui perd les
  // fichiers qu'on lui a donnés est pire qu'un montage sans eux : rien ne dit
  // qu'il faut recommencer.
  //
  // Le repêchage est ICI, tout à la fin, et pas près de §0a : c'est le seul
  // point où plus aucune étape ne peut défaire le travail. Il réutilise les
  // deux accroches de `__mediaLayers` juste au-dessus — couche sur le panneau
  // qui couvre l'instant, sinon médaillon sur l'avatar.
  {
    const vus = new Set()
    for (const s of plan.slides || []) {
      if (s.assetId) vus.add(s.assetId)
      if (s.overlayMedia && s.overlayMedia.assetId) vus.add(s.overlayMedia.assetId)
      for (const i of s.items || []) if (i.assetId) vus.add(i.assetId)
    }
    // ── ÊTRE ACCROCHÉ NE SUFFIT PAS : IL FAUT ÊTRE DANS LE CADRE ────────────
    // Un médaillon vit sur une fenêtre avatar. Quand cette fenêtre est rognée
    // (budget, collisions, split), l'objet inset SURVIT au rognage — mais ses
    // bornes tombent hors de la fenêtre, et le moteur ne dessine rien.
    // Mesuré : la photo « meilleure qualité » était accrochée à 8,44→11,5 s sur
    // une fenêtre ramenée à 0→6,53 s. Comptée présente, jamais affichée.
    // On ne considère donc « vu » qu'un médaillon RÉELLEMENT dans sa fenêtre,
    // et le repêchage plus bas s'occupe des autres.
    for (const w of plan.avatarSegments || []) {
      const gardes = []
      for (const i of w.insets || []) {
        const dedans = Math.min(i.end, w.end) - Math.max(i.start, w.start)
        if (dedans >= 0.3) { vus.add(i.assetId); gardes.push(i) }
        else console.warn(`⚠ médaillon « ${i.assetId} » hors de sa fenêtre (${i.start}→${i.end} vs ${w.start}→${w.end}) — repêché`)
      }
      if (gardes.length !== (w.insets || []).length) w.insets = gardes
    }

    for (const b of plan.broll || []) {
      if (vus.has(b.assetId)) continue
      const src = (opts.assetFiles || {})[b.assetId]
      if (!src) continue   // fichier absent : rien à repêcher, le worker l'a déjà signalé
      const a = r2(b.start || 0), e = r2(Math.max(b.end ?? a + 3, a + 1.2))
      // …mais jamais par-dessus une couche déjà posée : un panneau ne porte
      // qu'UN overlayMedia — deux médias perdus au même instant, et le second
      // effaçait le premier en silence. L'hôte suivant (ou la fenêtre avatar)
      // prend le relais.
      // Un paysage ne se pose ni en couche ni en médaillon : il lui faut
      // l'écran entier, sinon on ne lit rien (même arbitrage qu'en §0a).
      const dimR = (opts.assetDims || {})[b.assetId]
      const ratioR = dimR && dimR.h ? dimR.w / dimR.h : 0
      // ── LA PHOTO PREND L'ÉCRAN, L'ANIMATION CÈDE ──────────────────────────
      // Poser le média en COUCHE sur une animation laisse celle-ci tourner
      // derrière : Axel, en voyant sa photo par-dessus le `lineup` — « pourquoi
      // cette animation est là aussi derrière la fille ??? ». Une photo de
      // résultat est une preuve : elle se regarde seule. On essaie donc d'abord
      // de lui donner tout l'écran, en délogeant l'animation qui l'occupait —
      // une animation fabriquée ne vaut pas le fichier qu'Axel a fourni.
      {
        const vire = []
        for (let i = out.length - 1; i >= 0; i--) {
          const s = out[i]
          if (!(a < s.end - 0.05 && e > s.start + 0.05)) continue
          if (s.user || s.assetId || s.overlayMedia || String(s.anim) === 'media') continue
          if (s.screen || String(s.anim) === 'ui') continue      // la visite guidée ne cède pas
          vire.push({ s, i })
        }
        if (vire.length) {
          for (const { s, i } of vire) {
            out.splice(i, 1)
            const k = taken.findIndex((w) => Math.abs(w[0] - s.start) < 0.01 && Math.abs(w[1] - s.end) < 0.01)
            if (k >= 0) taken.splice(k, 1)
          }
          if (add({ anim: 'media', src, assetId: b.assetId, hero: !!b.hero, user: true }, a, e)) {
            console.log(`▶ média « ${b.assetId} » en PLEIN CADRE (${a}→${e}s) — ${vire.map((v) => v.s.anim || v.s.type).join(', ')} lui cède la place`)
            continue
          }
          // ça n'a pas pris : on rend leur place aux animations délogées
          for (const { s } of vire) { out.push(s); claim(s.start, s.end) }
          out.sort((x, y) => x.start - y.start)
        }
      }

      // ── ON PREND LE PANNEAU QUI RECOUVRE LE PLUS, PAS CELUI QUI COMMENCE ───
      // Chercher un panneau qui COMMENCE avant le média laissait tomber le cas
      // le plus courant : le média démarre une fraction de seconde avant le
      // panneau. Mesuré — la photo « meilleure qualité » à 7,20→9,78 s, la
      // fenêtre avatar finissant à 7,48 s (0,28 s de recouvrement, trop peu
      // pour l'héberger) et `quality` ne commençant qu'à 7,50 s. Aucun hôte,
      // photo perdue, et `quality` a pris toute la place : « la photo de la
      // fille a disparu ». On classe donc par RECOUVREMENT réel.
      let hote = null, meilleur = 0
      for (const sl of plan.slides || []) {
        if (sl.overlayMedia) continue
        const rec = Math.min(e, sl.end) - Math.max(a, sl.start)
        if (rec > meilleur && rec >= 0.6) { meilleur = rec; hote = sl }
      }
      if (hote) {
        // la couche vit DANS son hôte, jamais avant lui : sinon elle est
        // demandée à un instant où le panneau n'existe pas encore
        const oa = r2(Math.max(a, hote.start)), ob = r2(Math.min(e, hote.end))
        hote.overlayMedia = { src, assetId: b.assetId, ratio: ratioR, start: oa, end: ob }
        console.log(`▶ média « ${b.assetId} » repêché : posé en couche sur ${hote.anim || hote.type} (${oa}→${ob}s)`)
        continue
      }
      const seg = (plan.avatarSegments || []).find((w) => a < (w.end || 0) - 0.3 && e > (w.start || 0) + 0.3)
      if (seg) {
        ;(seg.insets = seg.insets || []).push({ src, assetId: b.assetId, ratio: ratioR,
          start: r2(Math.max(a, seg.start)), end: r2(Math.min(e, seg.end)), prominent: a >= 5 })
        console.log(`▶ média « ${b.assetId} » repêché : médaillon sur l'avatar (${seg.start}→${seg.end}s)`)
        continue
      }
      console.warn(`⚠ média « ${b.assetId} » PERDU : ni panneau ni fenêtre avatar à ${a}s`)
    }
  }
}
