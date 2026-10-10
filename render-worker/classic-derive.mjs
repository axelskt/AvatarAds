// ─────────────────────────────────────────────────────────────────────────────
// LES CORRECTIONS DU STYLE DYNAMIQUE, PORTÉES AUX STYLES CLASSIQUES
// (apple, editorial, glass, word).
//
// Tout le travail de #146/#147 vivait derrière `slideStyle === 'dynamic'` :
// la carte des éléments d'interface, la règle « le mot affiché est le mot
// prononcé », l'ancrage des animations sur le mot qui les justifie. Les autres
// styles n'en voyaient rien — ils reproduisaient donc exactement les défauts
// qu'Axel avait fait corriger (cadre orange au milieu du vide, « SIGNENT »
// affiché pendant « …maîtrisent le réalisme », animations sans rapport).
//
// ⚠️ CE N'EST PAS UN PORTAGE DU MOTEUR. Le style Dynamique pousse des panneaux
// plein écran avec curseur et clics — c'est SON identité. Ici on ne touche qu'à
// la DONNÉE : quel visuel, à quel instant, cadré sur quoi. Le rendu classique
// (écran incliné, cadre, travelling caméra, texte tapé) existe déjà dans
// anim-pack.mjs `case 'screen'` — il ne recevait simplement jamais les
// coordonnées. On les lui donne.
// ─────────────────────────────────────────────────────────────────────────────

import { norm, findSeq, findAny, LEAD, MODULES, STEP_WORDS, GEN_OBJ, PROMPT_SAMPLE, VOICE_ANIMS } from './dynamic-derive.mjs'
import { spotOf } from './screen-spots.mjs'
import { EDITOR_ONLY } from './anim-bank.mjs'
import { ANIMS } from './anim-pack.mjs'

const r2 = (n) => Math.round(n * 100) / 100

export function deriveClassicSlides(plan, opts = {}) {
  // dynamique ET apple ont leur propre dérivation (même moteur)
  if (!plan || plan.slideStyle === 'dynamic' || plan.slideStyle === 'apple') return
  const words = (plan.captions || [])
    .filter((c) => String(c.text || '').trim())
    .map((c) => ({ text: String(c.text).trim(), start: r2(c.start), end: r2(c.end) }))
    .sort((a, b) => a.start - b.start)
  // Musique sans voix : aucune scène du chef, mais le CTA en bloc (§5) se pose quand même sur ses mots
  if (!words.length || (!(plan.slides || []).length && !plan.sansVoix)) return

  const slides = plan.slides || []
  const D = r2(plan.duration || (words[words.length - 1].end + 0.5))

  // ── 0 · UN MÉDIA FOURNI EST TOUJOURS PLACÉ (règle d'Axel 02/08, déjà tenue par le moteur dynamique) ───────────
  // En Auto, un fichier choisi que le chef n'avait pas mis au plan n'apparaissait jamais. On le pose sur la 1re mention
  // d'un mot de son NOM (après l'accroche), sinon dans le premier creux sans média après l'accroche, 2,3 s.
  {
    const files = opts.assetFiles || {}
    const auPlan = new Set((plan.broll || []).map((b) => b.assetId))
    const hookFin = r2(Number(plan.hook && plan.hook.end) || 0)
    const mots = (id) => String(id || '').split(/[^a-zA-Z0-9À-ſ]+/).map((x) => norm(x))
      .filter((x) => x.length > 3 && !/^(media|image|photo|video|capture|ecran|screenshot|img|\d+)$/.test(x))
    const occupe = (a, b) => (plan.broll || []).some((x) => a < (x.end || 0) - 0.1 && b > (x.start || 0) + 0.1)
    let poses = 0
    for (const id of Object.keys(files)) {
      if (auPlan.has(id) || /^avatar(-\d+)?$/.test(id)) continue
      const m = mots(id)
      const w = m.length ? words.find((x) => x.start >= hookFin && m.some((t) => { const n = norm(x.text); return n === t || (t.length >= 5 && n.startsWith(t)) || (n.length >= 5 && t.startsWith(n)) })) : null
      let a = w ? r2(Math.max(hookFin, w.start - LEAD)) : null
      if (a === null) { a = r2(Math.max(hookFin + 0.3, 3)); while (a < D - 3 && occupe(a, a + 2.3)) a = r2(a + 0.5) }
      if (a >= D - 2) continue
      ;(plan.broll = plan.broll || []).push({ assetId: id, start: a, end: r2(Math.min(D - 0.5, a + 2.3)), __force: true })
      poses++
    }
    if (poses) console.log(`▶ ${poses} média(s) de l'utilisateur absent(s) du plan → posé(s) d'office`)
  }
  // mots prononcés dans une fenêtre (avec la même anticipation que le dynamique :
  // un visuel arrive juste AVANT son mot)
  const inWin = (a, b) => words.filter((w) => w.start >= a - LEAD - 0.3 && w.start <= b + 0.2)

  // ── 1 · FILET DE SÉCURITÉ SUR LE CADRAGE DES CAPTURES ──────────────────────
  // ⚠️ L'orchestrateur résout DÉJÀ ces coordonnées pour le chemin classique, et
  // bien : vérifié sur Cartoon 15, ses cadres tombent à 0,01 près sur ceux que
  // j'ai mesurés à la main dans screen-spots.mjs (format 9:16 : lui 0.288/0.666,
  // la carte 0.288/0.668). Ce bloc ne sert donc QUE de repli — quand un plan
  // arrive sans cadre, on le calcule depuis la carte plutôt que de laisser
  // boxW à 0 (aucun cadre dessiné, caméra plantée au centre).
  // C'est le style Dynamique qui, lui, ignore ces coordonnées serveur et
  // reconstruit tout depuis la carte : d'où son besoin de screen-spots.mjs.
  let framed = 0
  for (const sl of slides) {
    if (sl.anim !== 'screen' || !sl.screen) continue
    if (typeof sl.boxX === 'number' && sl.boxW > 0) continue   // déjà résolu en amont
    const a = r2(sl.start || 0), b = r2(sl.end ?? (sl.start || 0) + 2)
    const said = inWin(a, b)

    // quels éléments la voix désigne-t-elle pendant ce plan ?
    const found = []
    for (const w of said) {
      const n = norm(w.text)
      const sw = STEP_WORDS.find((x) => x.w.includes(n) && !found.some((f) => f.spot === x.spot))
      if (!sw) continue
      if (sw.spot === 'generate') {
        const nx = words[words.indexOf(w) + 1]
        if (!nx || !GEN_OBJ.includes(norm(nx.text))) continue   // « générer DES millions » ≠ un clic
      }
      const sp = spotOf(sl.screen, sw.spot)
      if (sp) found.push({ spot: sw.spot, sp, t: w.start })
    }
    // rien de nommé → au moins l'entrée de menu du module, s'il est cité
    if (!found.length) {
      const m = MODULES.find((x) => x.screen === sl.screen)
      const cited = m && m.pat.some((p) => said.some((w) => norm(w.text).includes(norm(p.split(' ')[0]))))
      const menu = spotOf(sl.screen, 'menu')
      if (cited && menu) found.push({ spot: 'menu', sp: menu, t: a })
    }
    if (!found.length) continue

    found.sort((x, y) => x.t - y.t)
    const f1 = found[0], f2 = found[1]
    Object.assign(sl, {
      screenX: f1.sp.x, screenY: f1.sp.y,
      boxX: f1.sp.x, boxY: f1.sp.y, boxW: f1.sp.w, boxH: f1.sp.h,
      screenZoom: sl.screenZoom || 1.6,
    })
    // deux cibles dans le même plan → la caméra descend de l'une à l'autre
    if (f2) Object.assign(sl, {
      screenX2: f2.sp.x, screenY2: f2.sp.y,
      boxX2: f2.sp.x, boxY2: f2.sp.y, boxW2: f2.sp.w, boxH2: f2.sp.h,
    })
    // le champ de prompt se TAPE (le rendu a déjà le caret et le masque)
    if (!sl.screenText && found.some((x) => x.spot === 'prompt')) {
      sl.screenText = PROMPT_SAMPLE[sl.screen] || ''
    }
    framed++
  }

  // ── 2 · UN MOT AFFICHÉ EST UN MOT PRONONCÉ ─────────────────────────────────
  // L'orchestrateur pose ses cartes de texte sur des fenêtres approximatives :
  // « SIGNENT » restait à l'écran pendant « …ceux qui maîtrisent le réalisme ».
  const said = (txt, a, b) => {
    const toks = String(txt || '').split(/[\s,/·]+/).map(norm).filter((t) => t.length >= 4)
    if (!toks.length) return null
    for (const w of inWin(a, b)) {
      const n = norm(w.text)
      if (toks.some((t) => n === t || (t.length >= 5 && n.startsWith(t)) || (n.length >= 5 && t.startsWith(n)))) return w
    }
    return null
  }
  // Axel, après un premier essai où je me contentais de corriger QUEL mot
  // s'affichait : « la règle un mot affiché c'est non, on priorise les
  // animations plutôt que les séquences où y'a 1 mot au hasard ». Corriger le
  // mot ne suffisait pas — un plan qui ne montre qu'un mot ne montre rien.
  // Ordre de préférence, donc : (1) une animation ancrée sur ce qui est dit,
  // (2) à défaut, la carte SI ses mots sont réellement prononcés, (3) sinon rien.
  // SEULEMENT CE QUI EXISTE DANS LA BANQUE (audit 10/10) : la table des voix
  // garde des anims retirées (money, grow, compare). Réancrer dessus écrasait une
  // scène valide, que build-composition jetait ensuite — un trou à la place. Et
  // sur la vidéo d'un client, une anim de marque (editorOnly) serait retirée au
  // filtre final : même trou.
  const VOIX = VOICE_ANIMS.filter((v) => ANIMS.includes(v.anim)
    && !(plan.__marqueAvatarAds === false && EDITOR_ONLY.has(v.anim)))
  const anchorFor = (a, b) => VOIX.find((v) => words.some((w) =>
    v.w.includes(norm(w.text)) && w.start >= a - LEAD - 0.2 && w.start <= b - 0.25))
  let recut = 0, dropped = 0, toAnim = 0
  const kept = []
  for (const sl of slides) {
    const its = (sl.items || []).filter((it) => it && it.text)
    const isText = (!sl.anim || sl.anim === '') && (its.length || sl.title)
    if (!isText) { kept.push(sl); continue }
    const a = r2(sl.start || 0), b = r2(sl.end ?? (sl.start || 0) + 2)

    // (1) une animation illustre-t-elle ce qui est dit ici ? elle passe devant.
    //     Seul le CTA final est protégé : lui, son mot EST le message.
    const isFinalCta = sl.cta || b > D - 3.5
    const v = anchorFor(a, b)
    if (v && !isFinalCta) {
      sl.anim = v.anim
      sl.items = []; sl.title = ''
      if (v.photo) sl.photo = v.photo
      if (v.photo || v.assets) sl.assets = v.assets || [v.photo]
      toAnim++; kept.push(sl); continue
    }

    // (2) pas d'animation : la carte ne survit que si la voix dit ses mots
    const cand = its.map((it) => ({ it, w: said(it.text, a, b) })).filter((x) => x.w)
    if (its.length && !cand.length) { dropped++; continue }
    if (!its.length && sl.title && !said(sl.title, a, b)) { dropped++; continue }
    if (cand.length) {
      const best = cand.sort((x, y) => x.w.start - y.w.start)[0]
      if (best.it !== its[0]) recut++
      sl.items = [{ ...best.it, t: r2(best.w.start) }]          // le mot qui claque est celui qu'on entend
      sl.title = best.it.text
    }
    kept.push(sl)
  }

  // ── 3 · L'ANIMATION EST LE MOT ─────────────────────────────────────────────
  // anim-pack est déjà partagé : dès qu'on met la BONNE anim sur la bonne
  // fenêtre, les styles classiques héritent de sign / tools / post / du
  // comparatif fake-réel sur un vrai visage, exactement comme le dynamique.
  let reanim = 0
  // une scène « décorative » = une animation sans texte, et JAMAIS une capture
  // (`screen` appartient à ANIMS : sans ce filtre, réancrer écrasait une démo
  // d'interface — cadre, zoom et texte tapé compris)
  const decorative = (s) => s.anim && s.anim !== 'screen' && s.anim !== 'ui'
    && ANIMS.includes(s.anim) && !(s.items || []).length && !s.title && !s.screen
  // un déclencheur ne compte que s'il tombe VRAIMENT dans le plan : au bord, le
  // visuel arrive une seconde et demie avant le mot qu'il illustre
  const triggerIn = (a, b) => (forms) => words.find((w) =>
    forms.includes(norm(w.text)) && w.start >= a - LEAD - 0.2 && w.start <= b - 0.25)
  const used = new Set()                    // une animation ne se répète pas d'un plan à l'autre
  for (const sl of kept) {
    if (!decorative(sl)) continue
    const a = r2(sl.start || 0), b = r2(sl.end ?? (sl.start || 0) + 2)
    const has = triggerIn(a, b)
    const v = VOIX.find((x) => !used.has(x.anim) && has(x.w))
    if (!v) continue
    used.add(v.anim)
    if (v.anim === sl.anim) continue
    sl.anim = v.anim
    if (v.photo) sl.photo = v.photo
    if (v.photo || v.assets) sl.assets = v.assets || [v.photo]
    reanim++
  }

  // « poster sur les réseaux » a sa propre animation (c'est une locution, pas un
  // mot isolé — elle n'a pas sa place dans la table générale)
  if (!used.has('post')) {
    const hit = findSeq(words, 'poster sur les reseaux') || findSeq(words, 'sur les reseaux')
    if (hit) {
      const sl = kept.find((s) => decorative(s)
        && hit.start >= (s.start || 0) - LEAD - 0.2 && hit.start <= (s.end ?? 0) - 0.25)
      if (sl && sl.anim !== 'post') { sl.anim = 'post'; used.add('post'); reanim++ }
    }
  }

  // la marque AvatarAds reste chez AvatarAds (audit 10/10) : sur la vidéo d'un client, ni logos ni captures de l'app
  let fin = plan.__marqueAvatarAds === false
    ? kept.filter((s) => s && (s.user || (!s.screen && !EDITOR_ONLY.has(String(s.anim || '')))))
    : kept
  const estUser = (s) => s && (s.user || s.assetId || ['media', 'medias', 'photowall'].includes(String(s.anim || '')))
  const word = plan.slideStyle === 'word'

  // ── 4 · L'ACCROCHE APPARTIENT AU VISAGE (audit 10/10) ─────────────────────
  // « L'avatar ouvre toujours » : en Auto, des cartes plein cadre (dashboard à
  // 0,72 s, réseau à 2,4 s) recouvraient le visage pendant l'accroche, et le
  // texte choc se posait sur elles. Comme dans Production, l'accroche = le
  // visage + le texte choc. Une scène qui commence dedans démarre à la fin de
  // l'accroche si elle a encore de quoi vivre (≥ 1 s), sinon elle s'efface.
  // Ses médias à lui ne bougent pas. (Mot par mot n'a pas de visage.)
  // Style Musique : la réaction (0 → 3 s) est TOUJOURS le visage seul, même sans texte choc ni fenêtre avatar
  // déclarée, et ses médias à lui en sortent aussi (recette F05 : la réaction, puis la démo).
  const musique = plan.slideStyle === 'musique'
  const hookEnd = r2(Number(plan.hook && (plan.hook.text || musique) ? plan.hook.end : 0) || 0)
  if (musique && hookEnd > 0.5) {
    // un média fourni est toujours placé : il est DÉCALÉ après la réaction (2,3 s au moins), jamais retiré
    for (const b of plan.broll || []) {
      if ((b.start || 0) >= hookEnd - 0.05) continue
      b.start = r2(hookEnd + 0.02)
      b.end = r2(Math.min(Math.max(1, (Number(plan.duration) || 0) - 0.5), Math.max(b.end || 0, b.start + 2.3)))
    }
    plan.broll = (plan.broll || []).filter((b) => (b.end || 0) - (b.start || 0) >= 0.8)
  }
  if (!word && hookEnd > 0.5 && ((plan.avatarSegments || []).length || musique)) {
    let decales = 0, retires = 0
    fin = fin.filter((sl) => {
      if ((estUser(sl) && !musique) || (sl.start || 0) >= hookEnd - 0.05) return true
      if ((sl.end || 0) - hookEnd >= 1.0) { sl.start = r2(hookEnd + 0.02); decales++; return true }
      retires++; return false
    })
    if (decales || retires) console.log(`▶ accroche ${hookEnd}s au visage : ${decales} scène(s) décalée(s) après, ${retires} retirée(s)`)
  }

  // ── 5 · LE CTA EN BLOC (audit 10/10) ──────────────────────────────────────
  // En Auto, « commente AIDE » défilait mot à mot : le mot à commenter restait
  // 0,16 s dans une pastille. Comme le moteur dynamique, la fin pose la zone de
  // commentaire où LE MOT se tape (anim keyword) — la consigne reste lisible.
  // (Mot par mot a son propre CTA : la phrase entière, construite au rendu.)
  if (!word && !fin.some((sl) => sl.cta || (String(sl.anim) === 'keyword' && (sl.end || 0) > D - 3))) {
    // « commencer » : la transcription a rendu deux fois « Commente IA » ainsi — il
    // ne compte que suivi d'une livraison (« et je t'envoie… »), voir LIVRAISON
    const TRIG = ['commente', 'commentes', 'commenter', 'commentez', 'comment', 'ecris', 'commande', 'commandes', 'tape', 'tapes', 'tapez', 'commencer']
    const SKIP = new Set(['des', 'un', 'une', 'le', 'la', 'les', 'de', 'du', 'en', 'ton', 'ta', 'tes', 'mon', 'ma', 'mes', 'moi', 'nous', 'vous', 'ce', 'cette', 'ces'])
    // mots ENTIERS (avec l'élision collée par norm : « tenvoie », « lacces ») — « clients » contenait « lien » (relecture 10/10)
    const LIVRAISON = /(^|[^a-z])(?:[tlmjs]|qu)?(envoi\w*|recoi\w*|recevoir|repond\w*|message\w*|dm|prive\w*|liens?|bio|commentaires?|methode|acces)(?![a-z])/
    const nettoie = (t) => String(t || '').replace(/[«»".,!?]/g, '').trim()
    let cta = null
    for (let i = words.length - 1; i >= 0 && !cta; i--) {
      const w = words[i]
      if (w.start < D - 10) break
      const trig = norm(nettoie(w.text))
      if (!TRIG.includes(trig)) continue
      let k = i + 1
      while (k < words.length && SKIP.has(norm(nettoie(words[k].text)))) k++
      if (k - i > 2 || !words[k]) continue
      const kw = nettoie(words[k].text)
      if (!kw || kw.length > 14 || SKIP.has(norm(kw))) continue
      // la promesse se lit APRÈS le mot à commenter (« comment recevoir tes clients » n'est pas un CTA) ; « commencer »
      // exige une vraie livraison et jamais « pour / de commencer » (relecture 10/10)
      const suite = words.slice(k + 1, k + 9).map((x) => norm(x.text)).join(' ')
      if (trig === 'commencer') {
        const avant = i > 0 ? norm(nettoie(words[i - 1].text)) : ''
        if (/^(pour|de|d|a|avant|par|bien|et)$/.test(avant) || !/envoi|envoie|en prive|en dm\b|par message/.test(suite)) continue
      } else if (!/^comment(e|es|er|ez)$|^commande/.test(trig) && !LIVRAISON.test(suite)) continue
      cta = { w, kw: (norm(kw) === 'cite' ? 'SITE' : kw).toLocaleUpperCase('fr-FR') }
    }
    if (cta) {
      let a = r2(Math.max(cta.w.start - 0.1, D - 5))
      // ses médias passent devant, CHACUN POUR SOI : ses scènes (slides user) et ses médias (plan.broll, sous la carte
      // plein cadre) qui finissent avant D − 1,2 repoussent le CTA ; seul celui qui court jusqu'au bout est rogné
      const medias = [...fin.filter(estUser), ...(plan.broll || [])]
      const finUser = Math.max(0, ...medias.filter((m) => (m.end || 0) > a + 0.05 && (m.end || 0) <= D - 1.2).map((m) => m.end || 0))
      if (finUser) a = r2(Math.max(a, finUser + 0.02))
      for (const b of plan.broll || []) if ((b.end || 0) > a + 0.05 && (b.start || 0) < a - 0.8) b.end = r2(a - 0.02)
      fin = fin.filter((sl) => {
        if ((sl.end || 0) <= a + 0.05) return true
        if ((sl.start || 0) < a - 0.8) { sl.end = r2(a - 0.02); return true }
        return estUser(sl)
      })
      // le visage d'une fenêtre qui court sous la carte n'est pas vu : elle s'arrête au CTA (un lipsync généré après la
      // dérivation n'est alors pas payé pour rien)
      // (seules les fenêtres de QUEUE sont retirées : les clips lipsync sont rangés par indice, av0, av1…)
      const segs = plan.avatarSegments || []
      while (segs.length && (segs[segs.length - 1].start || 0) >= a - 0.8) segs.pop()
      for (const w of segs) if ((w.end || 0) > a + 0.05 && (w.start || 0) < a - 0.8) w.end = r2(a)
      fin.push({ anim: 'keyword', cta: true, layout: 'full', items: [{ text: cta.kw, t: r2(Math.max(a + 0.25, cta.w.start)) }],
        start: a, end: r2(Math.max(a + 1.2, D - 0.05)) })
      console.log(`▶ CTA en bloc : « ${cta.kw} » à commenter (${a}→${r2(D - 0.05)}s)`)
    }
  }

  // ── 6 · PAS DE FLASH DU VISAGE ENTRE DEUX SCÈNES (audit 10/10) ────────────
  // Deux scènes plein cadre séparées de 0,3 s laissaient revenir le visage le
  // temps d'un clignement (effet stroboscope). Sous 0,5 s, la première tient
  // jusqu'à la suivante ; au-delà, le visage revient pour de bon.
  {
    const pleins = fin.filter((sl) => sl.layout === 'full').sort((x, y) => x.start - y.start)
    for (let i = 0; i + 1 < pleins.length; i++) {
      const g = r2(pleins[i + 1].start - (pleins[i].end || 0))
      if (g > 0 && g < 0.5) pleins[i].end = r2(pleins[i + 1].start)
    }
  }
  plan.slides = fin.sort((x, y) => (x.start || 0) - (y.start || 0))
  if (framed || dropped || recut || reanim || toAnim) {
    console.log(`▶ style ${plan.slideStyle || 'auto'} : ${toAnim} carte(s) de texte remplacée(s) par une animation · `
      + `${dropped} carte(s) hors-sujet retirée(s) · ${recut} slam(s) recalé(s) · `
      + `${reanim} animation(s) réancrée(s) · ${framed} capture(s) cadrée(s) en repli`)
  }
}
