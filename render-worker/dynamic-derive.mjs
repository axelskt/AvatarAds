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
import { spotOf } from './screen-spots.mjs'

// L'avatar de la marque : une seule image pour le hook, les fenêtres visage et
// « ton premier avatar ». La remplacer dans assets/tuto suffit à changer l'avatar
// partout (Axel : « mets cet avatar dans le hook et comme avatar principal »).
const AVATAR_MAIN = 'hook-qualite'
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
  const eq = (n, tk) => n === tk || (tk.length >= 5 && n.startsWith(tk))
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
]
// mot prononcé → élément de l'interface (positions dans screen-spots.mjs)
export const STEP_WORDS = [
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
  if (plan.slideStyle !== 'dynamic') return
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
  const add = (slide, a, b) => {
    for (const w of taken) {
      if (a < w[0] && b > w[0]) b = w[0] - 0.05          // déborde sur le début d'une fenêtre
      if (a >= w[0] && a < w[1]) a = w[1] + 0.05          // commence dans une fenêtre
    }
    if (b - a < 0.8 || overlaps(a, b)) return null
    const s = { ...slide, start: r2(a), end: r2(b) }
    out.push(s)
    claim(a, b); return s
  }

  // ── 1 · LA VOIX D'ABORD : les déclencheurs haute précision de ses scripts ──

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

  // le site : « avatarads.fr » (ou tout mot en .fr/.com) → navigateur, zoom sur
  // le « commencer/cliquer » qui suit
  for (let j = 0; j < words.length; j++) {
    const t = norm(words[j].text)
    const isUrl = /(fr|com|io|app)$/.test(t) && (t.includes('avatarads') || String(words[j].text).includes('.'))
    if (!isUrl) continue
    const click = findAny(words, ['commencer', 'cliquer', 'clique', 'commence'], j + 1)
    const a = Math.max(0, words[j].start - LEAD)
    const b = click ? Math.min(D, click.end + 1.1) : Math.min(D, words[j].end + 3.2)
    add({ anim: 'ui', ui: 'browser', url: 'avatarads.fr', screen: 'site-home',
      zoomX: 0.885, zoomY: 0.146, zoomTo: 3.0, ...(click ? { zoomAt: r2(click.start) } : {}) }, a, b)
    break
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
  {
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
  {
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
    { pat: ['claude est connecte', 'est connecte a'], ui: 'connect', pad: 2.6 },
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
      const kw = w ? String(w.text).replace(/[«»".,!?]/g, '').trim() : ''
      if (kw && kw.length <= 14) {
        const verb = norm(words[last.i].text).startsWith('ecris') ? 'Écris' : 'Commente'
        const a = Math.max(last.start - 0.1, D - 6)
        // le CTA final est PRIORITAIRE : toute scène qui déborde dessus est rognée
        // (les compteurs de vues s'arrêtent quand le punch arrive, pas l'inverse)
        for (let i = out.length - 1; i >= 0; i--) {
          const s = out[i]
          if ((s.end || 0) <= a + 0.05) continue
          s.end = r2(a - 0.05)
          if (s.end - s.start < 0.8) out.splice(i, 1)   // trop court : il dégage
        }
        out.push({ type: 'punch', cta: true, layout: 'full', eyebrow: 'Pour finir', title: '',
          items: [{ text: `${verb} « ${kw} »`, t: r2(Math.max(a + 0.3, last.start)) }],
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
  if ((plan.avatarSegments || []).length) {
    const MAXW = 6.5
    let budget = D * 0.4
    const clamped = []
    for (const w of plan.avatarSegments.slice().sort((a, b) => a.start - b.start)) {
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
      clamped.push({ start: a, end: b })
      claim(a, b)
      budget -= b - a
    }
    plan.avatarSegments = clamped
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

  const kept = []
  const blockers = [...out, ...avWinsAll]
  for (const sl of srcSlides) {
    if (consumed.has(sl)) continue
    if (sl.anim && !RENDERABLE.has(sl.anim) && !hasContent(sl)) continue
    // anim serveur SANS texte et non ancrée sur un mot → un slam dira mieux
    // ce qui est dit (« les animations n'ont aucun rapport avec ce que je dis »)
    if (sl.anim && sl.anim !== 'ui' && sl.anim !== 'screen' && !hasContent(sl)) continue
    let a = r2(sl.start || 0), b = r2(sl.end || 0)
    for (const d of blockers) {
      if (b <= d.start + 0.05 || a >= d.end - 0.05) continue   // pas de contact
      const headroom = d.start - a                              // partie libre avant la scène
      const tailroom = b - d.end                                // partie libre après
      if (headroom >= tailroom) b = r2(d.start - 0.05)
      else a = r2(d.end + 0.05)
    }
    if (b - a < 0.8) continue
    if (blockers.some((d) => a < d.end - 0.05 && b > d.start + 0.05)) continue

    let slide = { ...sl, start: a, end: b }
    // carte purement textuelle (pas d'animation à rendre) → elle doit coller
    if (!sl.anim || sl.anim === '') {
      const its = (sl.items || []).filter((it) => it && it.text)
      const cand = its.map((it) => ({ it, w: said(it.text, a, b) })).filter((x) => x.w)
      if (its.length && !cand.length) continue                  // aucun de ses mots n'est dit : elle dégage
      if (!its.length && sl.title && !said(sl.title, a, b)) continue
      if (cand.length) {
        const best = cand.sort((x, y) => x.w.start - y.w.start)[0]
        slide.items = [{ ...best.it, t: r2(best.w.start) }]      // le slam tombe PILE sur le mot
        slide.title = best.it.text
        // …et le panneau ne s'ouvre pas une seconde AVANT le mot : sinon on
        // regarde un fond vide en attendant que le texte arrive
        slide.start = r2(Math.max(slide.start, Math.min(best.w.start - 0.45, slide.end - 0.85)))
      }
    }
    kept.push(slide)
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
  plan.slides = merged
}
