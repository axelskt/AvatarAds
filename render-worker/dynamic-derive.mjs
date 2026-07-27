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

const r2 = (n) => Math.round(n * 100) / 100
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

// fenêtre de recherche : suite de mots normalisés → { start, end, i } du premier mot.
// Un token long (≥5) matche aussi en PRÉFIXE : « qualité-là. » (→ qualitela)
// doit répondre au motif « qualite » — les suffixes collés ne cassent pas la détection.
function findSeq(words, pattern, from = 0) {
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
function findAny(words, forms, from = 0) {
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
const LEAD = 0.15

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
  const add = (slide, a, b) => {
    for (const w of taken) {
      if (a < w[0] && b > w[0]) b = w[0] - 0.05          // déborde sur le début d'une fenêtre
      if (a >= w[0] && a < w[1]) a = w[1] + 0.05          // commence dans une fenêtre
    }
    if (b - a < 0.8 || overlaps(a, b)) return false
    out.push({ ...slide, start: r2(a), end: r2(b) })
    claim(a, b); return true
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

  // « sélectionne Photo Réel(le) / Pixar / format » → cartes de choix sous le curseur
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

  // ── LE MODULE NOMMÉ EST À L'ÉCRAN (#146) ──
  // « tu vas aller dans Images IA » → la capture d'Images IA, pas la page
  // d'accueil. Axel : « quand je dis tu vas aller dans image IA la frame doit
  // changer sur image IA, là il reste sur la LP ».
  {
    const MODULES = [
      { pat: ['image ia', 'images ia'], screen: '01-imagesia' },
      { pat: ['express'],               screen: '02-express' },
      { pat: ['generateur'],            screen: '03-generateur' },
      { pat: ['montage ia'],            screen: '04-montageia' },
      { pat: ['bibliotheque'],          screen: '05-bibliotheque' },
      { pat: ['nettoyage audio'],       screen: '06-nettoyage-audio' },
      { pat: ['enregistreur'],          screen: '07-enregistreur' },
      { pat: ['parrainage'],            screen: '08-parrainage' },
    ]
    for (const m of MODULES) {
      let hit = null
      for (const p of m.pat) { hit = findSeq(words, p); if (hit) break }
      if (!hit) continue
      add({ anim: 'screen', screen: m.screen, screenZoom: 1.5, screenX: 0.5, screenY: 0.4 },
        Math.max(0, hit.start - LEAD), Math.min(D, hit.end + 2.2))
    }
  }

  // « ton premier avatar » → on MONTRE l'avatar obtenu (Axel : « mets l'image
  // de Léna plutôt »), pas une carte de texte
  {
    const hit = findSeq(words, 'premier avatar') || findSeq(words, 'ton avatar')
    if (hit) add({ anim: 'ui', ui: 'photo', screen: 'lena' },
      Math.max(0, hit.start - LEAD), Math.min(D, hit.end + 1.8))
  }

  // ── L'ANIMATION EST LE MOT (#146) ──
  // L'orchestrateur choisissait l'animation « au feeling » : on se retrouvait
  // avec une cible pendant qu'il parle de pros, un interrupteur sur « outils ».
  // Ici chaque animation est ancrée sur un mot qui la JUSTIFIE. Les anims
  // serveur non ancrées sont écartées plus bas (§4) — mieux vaut un slam.
  {
    const VOICE_ANIMS = [
      { w: ['marque', 'marques', 'client', 'clients', 'communaute', 'audience', 'abonnes'], anim: 'network' },
      { w: ['euros', 'argent', 'contrat', 'contrats', 'prix', 'paye', 'payer', 'gagner'],   anim: 'money' },
      { w: ['vues', 'millions', 'viral', 'virale', 'croissance', 'grandir'],                anim: 'grow' },
      { w: ['fake', 'faux', 'realisme', 'realiste', 'qualite'],                             anim: 'compare' },
      { w: ['outils', 'outil', 'methode', 'technique', 'strategie'],                        anim: 'steps' },
      { w: ['secondes', 'minutes', 'rapide', 'vite'],                                       anim: 'clock' },
      { w: ['idee', 'idees', 'creatif', 'inspiration'],                                     anim: 'idea' },
      { w: ['cible', 'objectif', 'but', 'resultat', 'resultats'],                           anim: 'target' },
    ]
    for (const v of VOICE_ANIMS) {
      const hit = findAny(words, v.w)
      if (!hit) continue
      add({ anim: v.anim }, Math.max(0, hit.start - LEAD), Math.min(D, hit.end + 1.7))
    }
  }

  // « poster sur les réseaux » → l'animation des réseaux (il ne se passait rien)
  {
    const hit = findSeq(words, 'poster sur les reseaux') || findSeq(words, 'sur les reseaux')
      || findAny(words, ['poster', 'publier'])
    if (hit) add({ anim: 'engage' }, Math.max(0, hit.start - LEAD), Math.min(D, hit.end + 1.9))
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

  // « et voilà » → l'image RÉSULTAT plein écran (montrer le résultat, pas l'interface)
  {
    const hit = findSeq(words, 'et voila')
    if (hit) add({ anim: 'result', screen: '99-resultat' },
      Math.max(0, hit.start - LEAD), Math.min(D, hit.end + 1.55))
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
  if (!(plan.avatarSegments || []).length) {
    const busy = out.map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0])
    const freeGaps = []
    let cur = 0
    for (const [a, b] of busy) { if (a - cur >= 2.6) freeGaps.push([cur, a]); cur = Math.max(cur, b) }
    if (D - cur >= 2.6) freeGaps.push([cur, D])
    const avWins = []
    const takeGap = (pred, maxLen) => {
      const g = freeGaps.filter(pred).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0]
      if (!g) return null
      const w = { start: r2(g[0]), end: r2(Math.min(g[1], g[0] + maxLen)) }
      g[0] = w.end + 0.05
      if (g[1] - g[0] < 2.6) freeGaps.splice(freeGaps.indexOf(g), 1)
      return w
    }
    // 3 à 4 fenêtres (« 3-4 vidéos de l'avatar ») : hook, deux temps forts, avant-CTA
    const slots = [
      (g) => g[0] < 1.5,                                 // le hook : visage direct
      (g) => g[0] > D * 0.22 && g[0] < D * 0.5,
      (g) => g[0] >= D * 0.45 && g[0] < D * 0.75,
      (g) => g[1] > D - 13 && g[0] > D * 0.6,            // avant le CTA
    ]
    for (const pred of slots) {
      if (avWins.length >= 4) break
      const w = takeGap(pred, 6.5)
      if (w) avWins.push(w)
    }
    plan.avatarSegments = avWins.sort((a, b) => a.start - b.start)
    for (const w of avWins) claim(w.start, w.end)
  }
  const avWinsAll = plan.avatarSegments || []

  // ── 4 · fusion : le serveur s'écarte des scènes dérivées, pas l'inverse ──
  // Chaque slide serveur chevauchant une dérivée est ROGNÉ à sa partie libre ;
  // sous 0,8 s (ou coincé entre deux dérivées) il est JETÉ — une chose à l'écran.
  //
  // Le moteur rend désormais le PACK D'ANIMATIONS en plein panneau (« des
  // animations plutôt que des mots » — Axel). On ne jette que les anims que
  // le moteur ne sait vraiment pas rendre (panneau vide garanti sinon).
  const RENDERABLE = new Set([...ANIMS, 'ui', 'screen', 'result', 'countup', 'logo', ''])
  const hasContent = (s) => !!(s.title || s.text || (s.items && s.items.length))
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
    kept.push(a === sl.start && b === sl.end ? { ...sl } : { ...sl, start: a, end: b })
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
