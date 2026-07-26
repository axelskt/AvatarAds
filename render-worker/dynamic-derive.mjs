// ─────────────────────────────────────────────────────────────────────────────
// #148 · DÉRIVATION AUTOMATIQUE des scènes UI du style Dynamique.
//
// L'orchestrateur (edge function) reste GÉNÉRIQUE : il produit le même plan pour
// tous les styles (captions mot-à-mot, slides `screen` résolues sur les zones
// mesurées, sections, beats). Cette couche transforme ce plan en scènes UI —
// exactement le travail fait à la main pour la VSL d'Axel, devenu déterministe :
//   · les plans d'écran « prompt » (texte tapé) → barre de prompt + zoom d'envoi
//   · les zones de choix (photo-réel, format…) → cartes `pick` sous le curseur
//   · des DÉCLENCHEURS sur les mots de la voix (patrons français de ses scripts) :
//     avatarads.fr → navigateur, « commente X » → barre de commentaire,
//     « importe/ajoute ton… » → dropzone, « supprimer les silences » → onde,
//     « un clic » → bouton, « génère la clé » → keycopy, « connecté à » → connect,
//     « millions de vues » → compteurs, « N secondes » en hook → chrono.
//
// Pourquoi ici et pas dans l'edge function : pas de redéploiement risqué (la
// grammaire stricte a déjà mis le module à l'arrêt une fois), testable en local
// contre une vraie transcription, et le serveur n'a pas à connaître les styles.
// Gated : ne s'applique QUE si plan.slideStyle === 'dynamic'.
// ─────────────────────────────────────────────────────────────────────────────

const r2 = (n) => Math.round(n * 100) / 100
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

// fenêtre de recherche : suite de mots normalisés → { start, end, i } du premier mot
function findSeq(words, pattern, from = 0) {
  const toks = pattern.split(/\s+/).map(norm).filter(Boolean)
  for (let j = from; j + toks.length <= words.length; j++) {
    if (toks.every((tk, m) => norm(words[j + m].text) === tk)) {
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

// zones de choix de l'app : (écran, zone) → la scène `pick` correspondante
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

  // ── 1 · les slides `screen` du serveur : prompt → promptbar, choix → pick ──
  const srcSlides = (plan.slides || []).slice().sort((a, b) => (a.start || 0) - (b.start || 0))
  for (const sl of srcSlides) {
    if (sl.anim !== 'screen') continue
    const a = r2(sl.start), b = r2(sl.end)
    if (sl.screenText) {
      // envoi calé sur « génère/générer » s'il est prononcé dans la foulée
      const gen = findAny(words, ['genere', 'generes', 'generer', 'génère'],
        words.findIndex((w) => w.start >= a))
      out.push({ anim: 'ui', ui: 'promptbar', text: String(sl.screenText), zoomEnd: true,
        ...(gen && gen.start > a + 1.2 && gen.start < b + 2 ? { sendAt: r2(gen.start) } : {}),
        start: a, end: b })
      claim(a, b); continue
    }
    // zone de choix connue → scène pick, sinon la capture reste telle quelle
    const zone = Object.keys(PICKS).find((z) =>
      (sl.boxX != null) && sl.screen && String(sl.screenZone || sl.zone || '').includes(z))
    // le serveur ne transmet pas le nom de zone : on la retrouve par le MOT du plan
    out.push({ ...sl, start: a, end: b })
    claim(a, b)
  }

  // ── 2 · déclencheurs sur la voix (patrons de ses scripts, haute précision) ──
  // Une scène qui déborde sur une fenêtre déjà prise est ROGNÉE, pas jetée :
  // « ajouter ton image » (24,9 s) précède le prompt Express (26,8 s) de 2 s —
  // rejeter la scène au lieu de la raccourcir faisait disparaître l'upload.
  const add = (slide, a, b) => {
    for (const w of taken) {
      if (a < w[0] && b > w[0]) b = w[0] - 0.05          // déborde sur le début d'une fenêtre
      if (a >= w[0] && a < w[1]) a = w[1] + 0.05          // commence dans une fenêtre
    }
    if (b - a < 0.8 || overlaps(a, b)) return false
    out.push({ ...slide, start: r2(a), end: r2(b) })
    claim(a, b); return true
  }

  // « N secondes/minutes » dans les 6 premières secondes → chrono
  for (let j = 0; j < words.length && words[j].start < 6; j++) {
    const v = parseInt(words[j].text.replace(/\D/g, ''), 10)
    const nx = words[j + 1] ? norm(words[j + 1].text) : ''
    if (v > 0 && v <= 120 && (nx.startsWith('second') || nx.startsWith('minute'))) {
      add({ anim: 'ui', ui: 'timer', value: String(v), unit: nx.startsWith('minute') ? 'MINUTES' : 'SECONDES' },
        Math.max(0, words[j].start - 0.15), Math.min(D, words[j + 1].end + 1.6))
      break
    }
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
    const isFinal = c.start > D - 8     // le CTA de fin garde son panneau punch (le moteur y met déjà comment)
    if (isFinal) continue
    add({ anim: 'ui', ui: 'comment', word: kw, zoom: 'soft' },
      Math.max(0, c.start - 0.1), Math.min(D, c.end + 2.6))
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

  // ── 2b · CTA final : si le serveur n'a pas émis de punch, on le synthétise
  // depuis le dernier « commente/écris X » — le moteur y greffe la barre de
  // commentaire et sa frappe tout seul
  const hasPunch = (plan.slides || []).some((s) => s.type === 'punch')
  if (!hasPunch) {
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

  // ── 3 · fusion : les dérivées remplacent les slides serveur qu'elles recouvrent ──
  const derived = out.filter((s) => s.anim === 'ui')
  const kept = (plan.slides || []).filter((sl) => {
    if (sl.anim !== 'screen' && sl.anim !== 'type') return true
    const covered = derived.some((d) => d.start < (sl.end || 0) - 0.1 && d.end > (sl.start || 0) + 0.1)
    return !covered
  })
  plan.slides = [...kept.filter((s) => !out.includes(s)), ...out.filter((s) => s.anim === 'ui' || s.type === 'punch')]
    .sort((a, b) => (a.start || 0) - (b.start || 0))
}
