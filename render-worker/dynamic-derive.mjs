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
        Math.max(0, words[j].start - 0.15), Math.min(D, words[j + 1].end + 1.6))
      break
    }
  }

  // « avec cette qualité-là » → la photo témoin plein écran (montrer le résultat au hook)
  {
    const hit = findSeq(words, 'cette qualite')
    if (hit) add({ anim: 'ui', ui: 'photo', screen: 'hook-qualite' },
      Math.max(0, hit.start - 0.55), Math.min(D, hit.end + 0.45))
  }

  // le site : « avatarads.fr » (ou tout mot en .fr/.com) → navigateur, zoom sur
  // le « commencer/cliquer » qui suit
  for (let j = 0; j < words.length; j++) {
    const t = norm(words[j].text)
    const isUrl = /(fr|com|io|app)$/.test(t) && (t.includes('avatarads') || String(words[j].text).includes('.'))
    if (!isUrl) continue
    const click = findAny(words, ['commencer', 'cliquer', 'clique', 'commence'], j + 1)
    const a = Math.max(0, words[j].start - 0.9)
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
      Math.max(0, c.start - 0.1), Math.min(D, c.end + 2.6))
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
        Math.max(0, hit.start - 0.35), Math.min(D, Math.min(hit.end + 0.7, cap)))
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
      Math.max(0, v.start - 0.1), Math.min(D, v.end + 2.2))
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
        Math.max(0, hit.start - 0.2), Math.min(D, hit.end + o.pad))
      break
    }
  }

  // « et voilà » → l'image RÉSULTAT plein écran (montrer le résultat, pas l'interface)
  {
    const hit = findSeq(words, 'et voila')
    if (hit) add({ anim: 'result', screen: '99-resultat' },
      Math.max(0, hit.start - 0.1), Math.min(D, hit.end + 1.55))
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
        Math.max(0, opts_[0].t - 0.2), Math.min(D, opts_[opts_.length - 1].t + 2.2))
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
      const c = findAny(words, ['commente', 'commentes', 'ecris', 'écris'], fi)
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
        for (const s of out) if ((s.end || 0) > a + 0.05) s.end = r2(Math.max(s.start + 0.8, a - 0.05))
        out.push({ type: 'punch', layout: 'full', eyebrow: 'Pour finir', title: '',
          items: [{ text: `${verb} « ${kw} »`, t: r2(Math.max(a + 0.3, last.start)) }],
          start: r2(a), end: r2(D - 0.1) })
        claim(a, D)
      }
    }
  }

  // ── 4 · fusion : le serveur s'écarte des scènes dérivées, pas l'inverse ──
  // Chaque slide serveur chevauchant une dérivée est ROGNÉ à sa partie libre ;
  // sous 0,8 s (ou coincé entre deux dérivées) il est JETÉ — une chose à l'écran.
  //
  // ⚠️ Les ANIMS GÉNÉRIQUES du pack classique (check, voice, phone, network,
  // target, toggle…) n'existent pas dans le moteur Dynamique : elles rendaient
  // des PANNEAUX VIDES de 1 à 2,5 s (vu sur l'audio Cartoon 15 — la moitié de
  // la vidéo). On les JETTE : leurs fenêtres deviennent des slams de mots-clés,
  // que le moteur génère tout seul sur les zones sans scène.
  const GENERIC_ANIMS = new Set(['check', 'voice', 'phone', 'network', 'target', 'toggle',
    'grow', 'avatar', 'list', 'type', 'steps', 'engage', 'views', 'pulse', 'wave', 'count'])
  const hasContent = (s) => !!(s.title || s.text || (s.items && s.items.length))
  const kept = []
  for (const sl of srcSlides) {
    if (consumed.has(sl)) continue
    if (GENERIC_ANIMS.has(sl.anim) && !hasContent(sl)) continue
    let a = r2(sl.start || 0), b = r2(sl.end || 0)
    for (const d of out) {
      if (b <= d.start + 0.05 || a >= d.end - 0.05) continue   // pas de contact
      const headroom = d.start - a                              // partie libre avant la scène
      const tailroom = b - d.end                                // partie libre après
      if (headroom >= tailroom) b = r2(d.start - 0.05)
      else a = r2(d.end + 0.05)
    }
    if (b - a < 0.8) continue
    if (out.some((d) => a < d.end - 0.05 && b > d.start + 0.05)) continue
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
  plan.slides = [...flat, ...out].sort((a, b) => (a.start || 0) - (b.start || 0))
}
