// build-composition.mjs — plan de montage v0.2/v0.6 → composition HyperFrames (visuel uniquement)
// L'audio (voix + SFX + musique duckée) est mixé par ffmpeg dans worker.mjs.
//
// Format ALTERNÉ (le chef d'orchestre décide) :
//  - passages FULL ÉCRAN : la personne plein cadre — zooms punch, b-roll, hook badge jaune
//  - passages SPLIT : la vidéo glisse dans la moitié basse, une slide motion design
//    (flow / checklist / compare / stat / card) occupe la moitié haute ; chaque élément
//    apparaît PILE sur le mot prononcé
// La zone vidéo est animée entre les deux états (transition 0.34s) à chaque frontière.

import { scenePackCss, fullSlideHtml, fullSlideJs, bannerHtml, bannerJs, FULL_TYPES } from './scene-pack.mjs'
import {
  VSTYLES, fontFaceCss,
  styleCss, styleExtraJs, scatterStyle, wordFontSize, WORD_FIT_JS, WORD_ACCENT, wordMotif, wordMotifJs,
} from './visual-styles.mjs'
import { ANIMS, animHtml, animJs, animCss } from './anim-pack.mjs'
import { buildDynamicComposition } from './dynamic-engine.mjs'
import { uiScene } from './ui-scenes.mjs'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = (n) => Math.round(n * 100) / 100
const ACCENT = '#FFD400'   // jaune viral (flèches, checks, surlignés)
const OK = '#22c55e'
const KO = '#ef4444'

export function buildComposition(plan, opts = {}) {
  // « Dynamique » (#147) est un moteur à part : chaîne de panneaux qui se poussent,
  // pas des scènes posées sur une base. Il émet son propre document complet.
  // APPLE PASSE PAR LE MÊME MOTEUR. Il vivait ici, en scènes posées sur la base :
  // captures minuscules et inclinées, un mot en bas de page. Axel, en comparant à
  // la v18 : « c'est pas du tout le rendu que je veux, je veux que le modèle
  // ressemble principalement à la v18 ». Apple devient donc une PEAU du moteur
  // dynamique (deux tons clairs qui alternent, accent iOS, Inter 800 au lieu
  // d'Archivo Black) — même composition, même montée en puissance.
  if (plan.slideStyle === 'dynamic' || plan.slideStyle === 'apple') return buildDynamicComposition(plan, opts)
  const W = opts.width || 1080
  const H = opts.height || 1920
  const D = r2(Math.max(1, plan.duration))
  const assetFiles = opts.assetFiles || {} // { assetId: 'media/img1.jpg' }
  // Chemin du logo de marque DANS LE PROJET, fourni par le worker uniquement si le job
  // en contenait un. Vide = l'animation `logo` ne rend rien (cf. anim-pack.mjs).
  const logoFile = opts.logoFile || ''

  // #131 · style visuel choisi dans les Paramètres avancés — posé en classe sur <body>,
  // il repeint slides, scènes plein cadre, bandeaux et sous-titres (visual-styles.mjs).
  const vs = VSTYLES.includes(plan.slideStyle) ? plan.slideStyle : ''
  // « Mot par mot » : AUCUN clip. La vidéo source n'apparaît jamais, l'écran est blanc
  // du début à la fin, le sous-titre EST le visuel (un mot énorme au centre) et des
  // formes animées illustrent chaque section. C'est un mode de rendu à part entière.
  const wordMode = vs === 'word'
  // Le verre, lui, a besoin que la vidéo reste plein écran SOUS les cartes : sinon
  // backdrop-filter n'a que du noir à réfracter.
  const overlay = wordMode || vs === 'glass'
  // Apple, Éditorial blanc et Mot par mot écrivent en casse normale : les capitales
  // cassent la typo fine des deux premiers et, pour le troisième, la référence garde
  // la ponctuation et la casse d'origine (« une stratégie. »).
  const softCase = vs === 'apple' || vs === 'editorial' || vs === 'word'
  const CASE = (s) => (softCase ? String(s ?? '') : String(s ?? '').toUpperCase())

  // 3 familles de scènes : SPLIT (slide sombre en haut + vidéo en bas), PLEIN CADRE
  // (scène éditoriale crème, la vidéo disparaît) et BANDEAU (carte posée sur la vidéo).
  const isFull = (s) => s.layout === 'full' || (!s.layout && FULL_TYPES.includes(s.type))
  const isBanner = (s) => s.layout === 'banner' || s.type === 'banner'
  // Une animation retirée de la banque est bannie pour TOUS les styles : un vieux
  // plan qui la porte encore perd l'anim, et la scène disparaît si c'était sa
  // seule matière — jamais de carte vide à la place (même garde que la dérivation).
  const allSlides = (plan.slides || [])
    .filter((s) => s && typeof s.start === 'number')
    .flatMap((s) => {
      if (!s.anim || ANIMS.includes(s.anim)) return [s]
      const substance = s.screen || s.title || s.text || s.value
        || (Array.isArray(s.items) && s.items.length)
      console.log(`▶ « ${s.anim} » n'est plus dans la banque → ${substance ? 'animation retirée, le contenu reste' : 'scène écartée'} (${s.start}s)`)
      return substance ? [{ ...s, anim: '' }] : []
    })
  const withIds = (list, p) => list.map((s, i) => ({
    ...s,
    id: p + i,
    dur: r2(Math.max(0.6, (s.end ?? s.start + 1.5) - s.start)),
    start: r2(s.start),
    items: (s.items || []).map((it, j) => ({ ...it, id: `${p}${i}i${j}`, text: String(it.text || ''), t: r2(it.t ?? s.start) })),
  }))
  // En « mot par mot » il n'y a plus ni scène plein cadre ni bandeau : TOUTE section
  // devient un motif de formes sur la page blanche, sinon le montage aurait des trous
  // sans la moindre animation.
  const fullDefs = wordMode ? [] : withIds(allSlides.filter(isFull), 'fs')
  const bannerDefs = wordMode ? [] : withIds(allSlides.filter(isBanner), 'fb')
  // Une scène ILLUSTRÉE (anim : le logo, une capture encadrée, le résultat) n'a pas
  // d'items texte — c'est son image qui parle. Le filtre « il faut des items » la
  // jetait donc en silence dans tous les styles sauf mot-à-mot : le plan demandait
  // le logo sur « avatarads.fr » et l'écran sur « Images IA », le rendu ne montrait
  // que le gameplay. On garde toute scène qui porte une anim.
  const slides = wordMode ? allSlides
    : allSlides.filter((s) => !isFull(s) && !isBanner(s)
        && (s.anim || (Array.isArray(s.items) && s.items.length)))
  const SLIDE_H = Math.round(H * 0.45)
  const VIDEO_H = H - SLIDE_H
  const TR = 0.34 // durée de la transition full <-> split

  // cadrage vertical en split : centre du visage estimé par l'analyse (fallback : cy médian des zooms)
  const zoomCys = (plan.zooms || []).map((z) => z.cy).filter((v) => typeof v === 'number').sort((a, b) => a - b)
  const faceCy = (plan.face && typeof plan.face.cy === 'number') ? plan.face.cy
    : (zoomCys.length ? zoomCys[Math.floor(zoomCys.length / 2)] : 0.3)
  const objPos = Math.round(Math.min(0.9, Math.max(0.1, faceCy)) * 100)

  // périodes split = slides fusionnées (gap <= 0.8s : on reste en split entre deux slides)
  const periods = []
  for (const s of [...slides].sort((a, b) => a.start - b.start)) {
    const st = r2(s.start), en = r2(Math.max(s.end, s.start + 0.6))
    const last = periods[periods.length - 1]
    if (last && st - last.end <= 0.8) { last.end = Math.max(last.end, en); last.members.push(s) }
    else periods.push({ start: st, end: en, members: [s] })
  }
  const inSplit = (t) => periods.some((p) => t >= p.start && t < p.end)

  // cadrage vidéo pendant les slides : plein cadre (tall) ou bande cinéma 16:9 (wide)
  const WIDE_H = Math.round(W * 9 / 16)
  const WIDE_TOP = Math.round((VIDEO_H - WIDE_H) / 2)

  // ── b-roll : carte flottante — image fixe, ou clip vidéo qui JOUE (#111) ──
  // Sur une page blanche, un écran vide trop longtemps donne une vidéo pauvre. Le chef
  // d'orchestre reste prudent (il applique sa règle b-roll habituelle de 1,5 à 3,5 s,
  // pensée pour du b-roll POSÉ SUR une vidéo). En mode page blanche, on étire donc
  // chaque visuel jusqu'au suivant — plafonné à 4 s pour qu'il ne s'installe pas.
  // ZÉRO IMAGE EN MOT-À-MOT. Les captures fournies sont des vignettes de landing page
  // (440-600 px) : étirées sur une carte de 820 px elles sont floues, et surtout elles
  // ne montrent rien — un écran d'application ne se lit pas en 2 s. Ce style n'affiche
  // donc QUE des animations. Les autres styles gardent le b-roll.
  // ⚠️ pas de `wordMode ? [] :` ici — ce ternaire jetait TOUTES les images
  // utilisateur en mode « Mot par mot », alors que le style en fait son visuel
  // principal (tout le bloc wordMode ci-dessous — fenêtres, moments forts — était
  // du code mort). Vu par Axel : sa photo n'apparaissait jamais, remplacée par
  // les animations génériques.
  const rawBroll = (plan.broll || []).filter((b) => assetFiles[b.assetId])
    .slice().sort((a, b) => a.start - b.start)
  if (wordMode && rawBroll.length) {
    // Une IMAGE utilisateur prime sur une animation générique : quand les deux
    // tombent sur le même passage, l'animation recouvrait la photo (vu par Axel :
    // le picto « avatar » s'affichait à la place de sa photo Bali). La règle du
    // style : les images sont le visuel principal, les formes animées ne comblent
    // que ce qui reste — on retire donc les scènes animées recouvertes.
    for (let i = slides.length - 1; i >= 0; i--) {
      const sl = slides[i]
      if (sl.anim && rawBroll.some((b) => sl.start < b.end && sl.end > b.start)) slides.splice(i, 1)
    }
    const busy = [...slides.filter((sl) => sl.anim).map((sl) => sl.start)].sort((a, b) => a - b)
    rawBroll.forEach((b, i) => {
      const nextVisual = Math.min(
        rawBroll[i + 1] ? rawBroll[i + 1].start : D,
        busy.find((t) => t > b.start) ?? D,
      )
      // plancher 2.5s / plafond 3s (etait 4/4.2) : « reste trop longtemps » — Axel.
      // Une carte plus courte suit mieux la voix ; le plancher evite juste le flash.
      b.end = Math.min(Math.max(b.end, Math.min(b.start + 2.5, nextVisual - 0.2)), D - 0.1)
      if (b.end - b.start > 3) b.end = r2(b.start + 3)
    })
  }
  // MOMENTS FORTS (#135) : deux fois dans la video, l'image passe au centre, plus
  // grande, en montant depuis le bas — puis disparait. Ca casse le rythme d'une page
  // blanche ou tout se ressemble. On prend les deux visuels les plus longs, espaces.
  const heroIds = new Set()
  // scènes UI du script mot-à-mot (timer, navigateur, grille, photo qui vole) —
  // remplies par le bloc wordScript ci-dessous, rendues comme des clips pleins cadre
  const wordUi = []
  // « moments forts » desactives en mode word : l'image plein centre recouvrait le
  // sous-titre — or ici le mot EST le contenu (Axel : « la photo cache les
  // sous-titres, on ne voit pas le CTA »). La carte standard se pose au-dessus de
  // la bande du mot : image ET texte restent lisibles.

  // ── MOT-À-MOT v4 (Axel, 15/08 : « ne mets pas d'animations, garde comme
  // avant — le problème c'est la SYNCHRO ») : plus aucun remplissage (beats,
  // filet, re-parutions) — le contenu du chef seulement, ancré PILE sur les
  // mots. Le LEAD de 0,32 s (le cadre AVANT le mot, cf. visite guidée) vaut
  // pour les médias ET les écrans du tuto : ils étaient systématiquement en
  // retard d'un souffle, posés sur la fin du mot au lieu de l'annoncer.
  if (wordMode) {
    const normW = (x) => String(x || '').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
    const capsW = (plan.captions || []).filter((c) => String(c.text || '').trim())
    const LEAD_W = 0.32
    // ── SCRIPT A→Z (Axel, 15/08 : « de 4,5 s à 6,3 je veux ça, à 7,2 jusqu'à
    // 9,1 ça, puis enchaîne l'animation de ça ») : quand le brief arrive
    // seconde par seconde (plan.wordScript), il REMPLACE toute la génération
    // automatique — médias, animations, écrans, scènes UI, aux fenêtres
    // exactes. Les temps du script sont FINAUX (le LEAD y est déjà compté).
    const wordScript = Array.isArray(plan.wordScript)
      ? plan.wordScript.filter((w) => w && typeof w.start === 'number' && (w.end ?? 0) > w.start)
      : []
    if (wordScript.length) {
      slides.length = 0
      rawBroll.length = 0
      let nUi = 0
      for (const w of wordScript) {
        const start = r2(w.start), end = r2(w.end)
        if (w.kind === 'media' && assetFiles[w.asset]) {
          const idx = rawBroll.length
          rawBroll.push({ assetId: w.asset, start, end })
          if (w.hero) heroIds.add(idx)
          plan.sfx = [...(plan.sfx || []), { kind: w.hero ? 'mo-swipe-2' : 'mo-pop-2', t: start, vol: 0.5 }]
        } else if (w.kind === 'anim' && ANIMS.includes(w.anim)) {
          slides.push({ type: 'card', anim: w.anim, start, end,
            items: w.value ? [{ t: start, text: String(w.value) }] : [] })
          plan.sfx = [...(plan.sfx || []), { kind: 'mo-pop-3', t: r2(start + 0.1), vol: 0.5 }]
        } else if (w.kind === 'screen' && w.screen) {
          slides.push({ type: 'card', anim: 'screen', start, end, screen: String(w.screen),
            screenText: String(w.screenText || ''),
            screenZoom: w.screenZoom, screenX: w.screenX, screenY: w.screenY,
            screenZoom2: w.screenZoom2, screenX2: w.screenX2, screenY2: w.screenY2,
            boxX: w.boxX, boxY: w.boxY, boxW: w.boxW, boxH: w.boxH,
            boxX2: w.boxX2, boxY2: w.boxY2, boxW2: w.boxW2, boxH2: w.boxH2, items: [] })
        } else if (w.kind === 'ui') {
          // les scènes vectorielles du moteur dynamique (timer, navigateur+LP…)
          // jouent aussi sur la page blanche — même contrat { html, js, sfx }
          const id = 'wu' + (nUi++)
          const sc = uiScene(String(w.ui), id, start, end,
            { dark: false, ink: '#141418', mute: '#8A8A93' }, w)
          if (sc) {
            wordUi.push({ id, start, dur: r2(end - start), html: sc.html, js: sc.js })
            for (const f of sc.sfx || []) plan.sfx = [...(plan.sfx || []), f]
            for (const k of sc.keyboard || []) plan.keyboard = [...(plan.keyboard || []), k]
          }
        } else if (w.kind === 'grid') {
          // « genre 6 alignées, 3 en haut et 3 en bas » — la grille de SES photos
          const files = (w.assets || []).map((a) => assetFiles[a]).filter(Boolean).slice(0, 6)
          if (files.length >= 2) {
            const id = 'wu' + (nUi++)
            const cols = 3
            const gx = Math.round(W * 0.045)
            const gw = Math.round((W * 0.9 - gx * (cols - 1)) / cols)
            const gh = Math.round(gw * 1.32)
            const gy = Math.round(H * 0.115)
            const html = files.map((f, k) => {
              const cx = Math.round(W * 0.05 + (k % cols) * (gw + gx))
              const cy = Math.round(gy + Math.floor(k / cols) * (gh + gx))
              return `<div id="${id}g${k}" style="position:absolute;left:${cx}px;top:${cy}px;width:${gw}px;height:${gh}px;border-radius:${Math.round(W * 0.022)}px;overflow:hidden;box-shadow:0 ${Math.round(H * 0.012)}px ${Math.round(H * 0.03)}px rgba(13,13,18,.22);opacity:0"><img src="${esc(f)}" style="width:100%;height:100%;object-fit:cover"/></div>`
            }).join('')
            const js = files.map((f, k) => `
  tl.fromTo('#${id}g${k}',{scale:0.6,autoAlpha:0,y:40},{scale:1,autoAlpha:1,y:0,duration:0.3,ease:'back.out(1.9)'},${r2(start + 0.08 + k * 0.11)});
  tl.to('#${id}g${k}',{y:${k % 2 ? -10 : -16},duration:${r2(Math.max(0.4, end - start - 0.5))},ease:'none'},${r2(start + 0.38 + k * 0.11)});`).join('')
            wordUi.push({ id, start, dur: r2(end - start), html, js })
            plan.sfx = [...(plan.sfx || []),
              { kind: 'mo-pop-2', t: r2(start + 0.1), vol: 0.55 },
              { kind: 'mo-pop-1', t: r2(start + 0.45), vol: 0.4 }]
          }
        } else if (w.kind === 'fly' && w.screen && assetFiles[w.asset]) {
          // « une photo de l'influenceuse en animation qui va dans Ajoute tes
          // images » : la capture s'installe, la photo pop puis VOLE dans la zone
          const id = 'wu' + (nUi++)
          const SW = 1000, SX = 40, SY = Math.round(H * 0.30)
          const SH = Math.round(SW * (1800 / 2880))   // captures harvest 2880×1800
          const zx = w.zoneX ?? 0.5, zy = w.zoneY ?? 0.5
          const zw = w.zoneW ?? 0.2, zh = w.zoneH ?? 0.2
          const zpx = SX + zx * SW, zpy = SY + zy * SH
          const pw = Math.round(W * 0.42), ph = Math.round(pw * 1.4)
          const p0x = Math.round((W - pw) / 2), p0y = Math.round(H * 0.50)
          const tFly = r2(start + 0.75)
          const html = `
      <div id="${id}scr" style="position:absolute;left:${SX}px;top:${SY}px;width:${SW}px;height:${SH}px;border-radius:26px;overflow:hidden;box-shadow:0 40px 110px rgba(13,13,18,.30);opacity:0"><img src="tuto/${esc(w.screen)}.png" style="position:absolute;left:0;top:0;width:100%;height:auto"/></div>
      <span id="${id}ring" style="position:absolute;left:${Math.round(zpx - zw * SW / 2)}px;top:${Math.round(zpy - zh * SH / 2)}px;width:${Math.round(zw * SW)}px;height:${Math.round(zh * SH)}px;border:5px solid #FF5A36;border-radius:18px;opacity:0"></span>
      <div id="${id}ph" style="position:absolute;left:${p0x}px;top:${p0y}px;width:${pw}px;height:${ph}px;border-radius:22px;overflow:hidden;box-shadow:0 34px 90px rgba(13,13,18,.35);opacity:0"><img src="${esc(assetFiles[w.asset])}" style="width:100%;height:100%;object-fit:cover"/></div>`
          const js = `
  tl.fromTo('#${id}scr',{y:120,autoAlpha:0},{y:0,autoAlpha:1,duration:0.4,ease:'power3.out'},${start});
  tl.fromTo('#${id}ph',{scale:0.7,autoAlpha:0,y:60},{scale:1,autoAlpha:1,y:0,duration:0.32,ease:'back.out(1.8)'},${r2(start + 0.18)});
  tl.to('#${id}ph',{x:${Math.round(zpx - (p0x + pw / 2))},y:${Math.round(zpy - (p0y + ph / 2))},scale:${r2(Math.min((zw * SW) / pw, (zh * SH) / ph) * 0.92)},duration:0.55,ease:'power2.inOut'},${tFly});
  tl.fromTo('#${id}ring',{scale:0.85,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.22,ease:'back.out(2)'},${r2(tFly + 0.42)});
  tl.to('#${id}ring',{autoAlpha:0,duration:0.2},${r2(end - 0.32)});`
          wordUi.push({ id, start, dur: r2(end - start), html, js })
          plan.sfx = [...(plan.sfx || []),
            { kind: 'mo-swipe-1', t: tFly, vol: 0.5 },
            { kind: 'mo-tap-1', t: r2(tFly + 0.5), vol: 0.6 }]
        }
      }
      console.log(`▶ mot-à-mot SCRIPTÉ : ${wordScript.length} fenêtres (${rawBroll.length} médias, ${slides.filter((s) => s.anim === 'screen').length} écrans, ${slides.filter((s) => s.anim !== 'screen').length} anims, ${wordUi.length} scènes UI)`)
    }
    if (!wordScript.length) {
    for (const b of rawBroll) b.start = r2(Math.max(0, b.start - LEAD_W))
    for (const sl of slides) {
      if (sl.anim === 'screen') sl.start = r2(Math.max(0, sl.start - LEAD_W))
    }
    // ── CADENCE 3 s (Axel, 15/08 soir : « une animation / un média / une
    // visite guidée toutes les 3 secondes pour dynamiser — là c'est fade ») :
    // chaque creux visuel de plus de 3 s se remplit, dans l'ordre : un beat du
    // chef sur SON mot → un mot sans ambiguïté du filet local → une re-parution
    // de ses médias (carte ↔ plein centre une fois sur deux).
    {
      const ctaZone = ((plan.sections || []).filter((x) => x.role === 'cta' || x.role === 'outro')
        .sort((a, b) => b.start - a.start)[0] || {}).start ?? (D - 5)
      const posees = new Set(slides.map((sl) => sl.anim).filter(Boolean))
      const beatsLibres = []
      for (const b of (plan.beats || [])) {
        const a = String(b.anim || '')
        const k = normW(b.word)
        if (!ANIMS.includes(a) || posees.has(a) || k.length < 3) continue
        const c = capsW.find((c2) => normW(c2.text).startsWith(k))
        if (!c || c.start > ctaZone - 1.4) continue
        beatsLibres.push({ t: r2(c.start), anim: a, value: b.value ? String(b.value) : '' })
        posees.add(a)
      }
      const NET = [
        ['scroll', 'phone'], ['defil', 'phone'], ['tiktok', 'phone'], ['reels', 'phone'], ['feed', 'phone'],
        ['courbe', 'easyup'], ['croiss', 'easyup'], ['augment', 'easyup'], ['simple', 'easyup'], ['facile', 'easyup'],
        ['resultat', 'results'], ['vue', 'views'], ['abonn', 'network'], ['communaut', 'network'], ['audience', 'network'],
        ['voix', 'voice'], ['micro', 'voice'], ['audio', 'voice'],
        ['ecri', 'type'], ['redig', 'type'], ['script', 'type'], ['prompt', 'type'],
        ['clic', 'oneclick'], ['bouton', 'oneclick'],
        ['rapid', 'speed'], ['vite', 'speed'],
        ['idee', 'idea'], ['secret', 'idea'], ['method', 'idea'], ['astuce', 'idea'],
        ['photo', 'avatar'], ['avatar', 'avatar'], ['personnage', 'avatar'], ['influenceu', 'avatar'],
        ['visage', 'faceless'], ['anonym', 'faceless'],
        ['import', 'upload'], ['televers', 'upload'],
        ['lance', 'rocket'], ['viral', 'rocket'], ['explos', 'rocket'],
      ]
      const vis = [
        ...slides.filter((sl) => sl.anim).map((sl) => [sl.start, r2(sl.end ?? sl.start + 2)]),
        ...rawBroll.map((b) => [b.start, b.end]),
      ].sort((x, y) => x[0] - y[0])
      const creux = []
      let curseur = Math.min(2.2, D)
      for (const [a, b] of vis) { if (a - curseur > 3.0) creux.push([curseur, a]); curseur = Math.max(curseur, b) }
      if (ctaZone - curseur > 3.0) creux.push([curseur, ctaZone])
      let flip = 0, mIdx = 0, nBeats = 0, nNet = 0, nMedias = 0
      const assetsIds = [...new Set(rawBroll.map((b) => b.assetId))]
      for (const [a, b] of creux) {
        for (let t = a + 0.6; t + 1.3 < b; t += 3.0) {
          const beat = beatsLibres.find((x) => x.t >= t - 0.4 && x.t + 1.3 < b)
          if (beat) {
            beatsLibres.splice(beatsLibres.indexOf(beat), 1)
            slides.push({ type: 'card', anim: beat.anim, start: r2(beat.t), end: r2(Math.min(b - 0.1, beat.t + 2.4)),
              items: beat.value ? [{ t: 0, text: beat.value }] : [] })
            plan.sfx = [...(plan.sfx || []), { kind: 'mo-pop-3', t: r2(beat.t + 0.1), vol: 0.5 }]
            t = beat.t; nBeats++
            continue
          }
          const hitNet = (() => {
            for (const c2 of capsW) {
              if (c2.start < t - 0.4 || c2.start + 1.3 > b || c2.start > ctaZone - 1.3) continue
              const k = normW(c2.text); if (k.length < 3) continue
              for (const [stem, an] of NET) {
                if (k.startsWith(stem) && ANIMS.includes(an) && !posees.has(an)) return { t: r2(c2.start), anim: an }
              }
            }
            return null
          })()
          if (hitNet) {
            posees.add(hitNet.anim)
            slides.push({ type: 'card', anim: hitNet.anim, start: hitNet.t, end: r2(Math.min(b - 0.1, hitNet.t + 2.4)), items: [] })
            plan.sfx = [...(plan.sfx || []), { kind: 'mo-pop-3', t: r2(hitNet.t + 0.1), vol: 0.45 }]
            t = hitNet.t; nNet++
            continue
          }
          if (!assetsIds.length) continue
          const fin = r2(Math.min(b - 0.1, t + 2.4))
          if (fin - t < 1.2) continue
          const idxB = rawBroll.length
          rawBroll.push({ assetId: assetsIds[mIdx % assetsIds.length], start: r2(t), end: fin })
          if (flip % 2 === 1) heroIds.add(idxB)
          plan.sfx = [...(plan.sfx || []), { kind: flip % 2 ? 'mo-swipe-2' : 'mo-pop-2', t: r2(t), vol: 0.5 }]
          flip++; mIdx++; nMedias++
        }
      }
      if (nBeats || nNet || nMedias) console.log(`▶ cadence mot-à-mot v5 (3 s) : ${nBeats} beat(s) + ${nNet} filet + ${nMedias} média(s)`)
    }
    // LE TEXTE TAPÉ vit dans plan.tuto (champ text) mais la conversion
    // tuto→slide d'orchestrate l'égare en word (screenText '') : la frappe ne
    // s'affichait jamais. On le raccroche à SA capture — même écran, et le mot
    // d'ancrage du tuto prononcé dans la fenêtre de la slide.
    for (const sl of slides) {
      if (sl.anim !== 'screen' || sl.screenText) continue
      const tu = (plan.tuto || []).find((t) => String(t.screen) === String(sl.screen)
        && String(t.text || '').trim()
        && capsW.some((c2) => normW(c2.text).startsWith(normW(t.word))
          && c2.start >= sl.start - 0.6 && c2.start <= (sl.end ?? sl.start + 3)))
      if (tu) { sl.screenText = String(tu.text); console.log(`▶ mot-à-mot : frappe « ${tu.text} » raccrochée à ${sl.screen} (${sl.start}s)`) }
    }
    }   // fin du mode automatique (sans wordScript)
    // le SON du geste #91 : la souris glisse sur l'écran puis CLIQUE la zone,
    // et la frappe dans le champ S'ENTEND (fenêtre clavier calée sur le typing
    // du pack : départ t0+1,05, durée bornée comme lui).
    for (const sl of slides) {
      if (sl.anim !== 'screen') continue
      plan.sfx = [...(plan.sfx || []),
        { kind: 'mo-swipe-1', t: r2(sl.start + 0.45), vol: 0.4 },
        { kind: 'mo-tap-1', t: r2(sl.start + 0.98), vol: 0.6 }]
      if (sl.screenText) {
        const durS = (sl.end ?? sl.start + 2.5) - sl.start
        const durK = r2(Math.max(0.9, Math.min(durS - 1.7, String(sl.screenText).length * 0.045)))
        plan.keyboard = [...(plan.keyboard || []), { t: r2(sl.start + 1.05), dur: durK }]
      }
    }
  }
  const brolls = rawBroll.map((b, i) => ({
    hero: heroIds.has(i),
    id: 'broll' + i,
    src: assetFiles[b.assetId],
    isVid: /\.(mp4|mov|webm|m4v)$/i.test(assetFiles[b.assetId]),
    start: r2(b.start),
    dur: r2(Math.max(0.4, b.end - b.start)),
  }))

  // ── #119 lipsync segmenté : scènes AVATAR générées séparément (1 à 6 selon le chef
  // d'orchestre) et assemblées ici — l'avatar ne s'affiche QUE sur ses fenêtres, le
  // reste du temps c'est le gameplay (#base). opts.avatarClips = { 'av0':'media/av0.mp4' }.
  // format 'portrait' = plein écran (hors slides) ; 'paysage' = moitié basse PENDANT
  // une slide (bande cinéma sous la slide — le clip suit le cadrage #videoFit).
  // Sans avatarSegments/avatarClips → comportement inchangé (base = vidéo continue). ──
  const avatarClips = opts.avatarClips || {}
  const avatarSegs = (plan.avatarSegments || [])
    .map((s, i) => ({ id: 'av' + i, src: avatarClips['av' + i] || avatarClips[i] || null,
      format: s.format === 'paysage' ? 'paysage' : 'portrait',
      start: r2(s.start), end: r2(Math.max(s.end, s.start + 0.3)) }))
    .filter((s) => s.src)
    .sort((a, b) => a.start - b.start)
    .map((s) => ({ ...s, dur: r2(Math.max(0.3, s.end - s.start)) }))

  // une scène paysage sous une slide → cadrage bande cinéma 16:9 forcé (letterbox propre)
  for (const s of slides) {
    if (avatarSegs.some((a) => a.format === 'paysage' && a.start < s.end && a.end > s.start)) s.wide = true
  }

  // ── transitions entre sections (#111) : flash lumineux bref sur les frontières
  // internes — sauf celles déjà marquées par une entrée/sortie de split (le morph
  // de la zone vidéo est la transition à ces endroits-là) ──
  const secBounds = [...new Set((plan.sections || []).slice(1).map((s) => r2(s.start)))]
    .filter((t) => t > 0.5 && t < D - 0.5)
    .filter((t) => !periods.some((p) => Math.abs(t - p.start) < 0.5 || Math.abs(t - p.end) < 0.5))

  const inHero = (t) => rawBroll.some((b, i) => heroIds.has(i) && t >= b.start - 0.15 && t < b.end + 0.05)

  // CTA DE FIN : le défilement mot par mot dilue l'appel à l'action. Sur la dernière
  // section (rôle « cta », sinon les 4 dernières secondes), on affiche la phrase
  // ENTIÈRE d'un coup — elle reste à l'écran, on a le temps de la lire et d'agir.
  const ctaSec = (plan.sections || []).filter((x) => x.role === 'cta' || x.role === 'outro')
    .sort((a, b) => b.start - a.start)[0]
  // Le CTA est UNE PHRASE, pas une tranche de temps. Le chef d'orchestre place la
  // frontière de section au jugé — sur un test il a ouvert « appel à l'action » à
  // 26,2 s alors que le vrai CTA démarrait à 28,5 s, et le bloc avalait la phrase
  // précédente (« … est extrêmement simple pour les débutants »), ce qui casse la
  // fin. On recale donc sur la DERNIÈRE PHRASE réellement prononcée : le point final
  // qui précède le CTA est un repère objectif, valable quel que soit l'audio.
  const lastSentenceStart = (() => {
    const caps = (plan.captions || []).filter((c) => String(c.text || '').trim())
    for (let i = caps.length - 1; i > 0; i--) {
      if (/[.!?]$/.test(String(caps[i - 1].text).trim())) return r2(caps[i].start)
    }
    return null
  })()
  const ctaFloor = ctaSec ? Math.max(ctaSec.start, D - 6) : D - 4
  const ctaStart = wordMode
    ? r2(lastSentenceStart !== null ? Math.max(ctaFloor, lastSentenceStart) : ctaFloor)
    : Infinity
  // chaque mot garde SON timestamp : la phrase s'écrit sur la voix, mot après mot,
  // et les mots déjà dits RESTENT à l'écran — au lieu de se remplacer.
  const ctaWords = wordMode
    ? (plan.captions || []).filter((c) => c.start >= ctaStart)
      .map((c, i) => ({ id: 'ctw' + i, text: String(c.text || ''), t: r2(c.start), accent: !!c.accent }))
      .filter((w) => w.text)
    : []
  // LE MOT-CLÉ DU CTA EN ORANGE. Le chef d'orchestre remplit `accents` avec les mots
  // forts du script mais oublie le CTA — sur un test il avait accentué « viral »,
  // « visage », « scripts »… et rien dans « Marque prêt en commentaire ». Or c'est LE
  // mot que le spectateur doit retenir puisqu'il doit l'écrire.
  // Repli déterministe : le mot juste après le verbe d'action, c'est-à-dire le premier
  // mot porteur qui suit le premier. « Marque PRÊT en commentaire », « Écris TEST en
  // commentaire », « Commente OUI » — la forme est toujours verbe + jeton à écrire.
  if (ctaWords.length > 1 && !ctaWords.some((w) => w.accent)) {
    const CTA_STOP = new Set(['en', 'si', 'tu', 'te', 'la', 'le', 'les', 'un', 'une', 'de', 'du', 'des',
      'pour', 'dans', 'et', 'ou', 'a', 'à', 'ce', 'que', 'qui', 'veux', 'avoir', 'me', 'moi', 'y'])
    const bare = (t) => String(t).toLowerCase().replace(/[^a-zà-ÿ]/g, '')
    const key = ctaWords.slice(1).find((w) => { const b = bare(w.text); return b.length > 1 && !CTA_STOP.has(b) })
    if (key) key.accent = true
  }
  const hasCta = wordMode && ctaWords.length >= 3

  // ── HOOK MOT-À-MOT v2 (Axel, 15/08 : « le hook ne retient pas assez
  // l'attention — reprends l'écriture du hook d'anim', plusieurs mots comme au
  // CTA, une animation de bas en haut pour chaque mot, une transition sur le
  // mot important, des bruitages ») : pendant l'accroche les mots s'ACCUMULENT
  // en Anton dégradé or (la palette hk1 validée), chaque mot MONTE depuis le
  // bas à son instant, les mots forts claquent plus gros en dégradé rouge avec
  // un pop — et tout le bloc s'efface d'un souffle à la fin du hook.
  // le bloc court jusqu'à la FIN DE LA PHRASE du hook, pas jusqu'au hook.end du
  // chef (3,5 s coupait « secondes top chrono. » en plein vol)
  let hookCapEndW = r2(plan.hook?.end ?? Math.min(4, D))
  for (const c of (plan.captions || [])) {
    const t = String(c.text || '').trim()
    if (!t || c.start < hookCapEndW - 0.05) continue
    if (c.start > hookCapEndW + 1.6) break
    hookCapEndW = r2(Math.max(hookCapEndW, c.end))
    if (/[.!?]$/.test(t)) break
  }
  const hookWords = wordMode
    ? (plan.captions || []).filter((c) => String(c.text || '').trim() && c.start < hookCapEndW)
      .map((c, i) => ({ id: 'whk' + i, text: String(c.text).trim(), t: r2(c.start), accent: !!c.accent }))
    : []
  const hasWordHook = hookWords.length >= 3
  if (hasWordHook) {
    for (const w of hookWords) {
      if (w.accent) plan.sfx = [...(plan.sfx || []), { kind: 'mo-pop-2', t: w.t, vol: 0.55 }]
    }
    plan.sfx = [...(plan.sfx || []), { kind: 'mo-whoosh-1', t: r2(Math.max(0, hookCapEndW - 0.22)), vol: 0.45 }]
  }

  // ── sous-titres Punch : top par mot selon le mode actif à son timestamp ──
  const subSize = Math.round(H * 0.052)
  const subStroke = Math.max(4, Math.round(subSize * 0.16))
  const capTopFull = Math.round(H * 0.72) - Math.round(subSize * 0.75)
  const capTopSplit = SLIDE_H + Math.round(VIDEO_H * 0.62) - Math.round(subSize * 0.75)
  // pendant une scène plein cadre, les sous-titres passent sur fond clair (ombre au lieu du contour)
  const inFullScene = (t) => fullDefs.some((f) => t >= f.start && t < f.start + f.dur)
  const capTopCream = Math.round(H * 0.74)
  // style de sous-titres choisi par l'utilisateur (Parametres avances) ; 'punch' = defaut
  // historique. 'st-auto' = l'utilisateur n'a rien imposé → le style visuel peut habiller
  // les sous-titres (typo fine Apple, sérif éditorial…) sans écraser un choix explicite.
  const capStyleCls = ['neon', 'minimal'].includes(plan.capStyle) ? ' st-' + plan.capStyle : ' st-auto'
  // ── EMOJIS 3D (#135) ────────────────────────────────────────────────────────
  // Le geste de la reference (Thinks) : l'emoji REMPLACE le mot, il ne s'ajoute pas.
  // Un seul element a l'ecran, au meme endroit — c'est ce qui rend la lecture
  // instantanee. D'ou le filtre sur les sous-titres pendant sa fenetre.
  const emojiDefs = wordMode
    ? slides.filter((s) => s.emoji).map((s, i) => ({
      id: 'emo' + i,
      file: 'emoji/' + s.emoji + '.png',
      start: r2(s.start),
      dur: r2(Math.min(1.5, Math.max(0.7, s.end - s.start))),
    }))
      // le CTA de fin affiche une phrase entière : un emoji par-dessus la recouvre
      .filter((e) => !(hasCta && e.start + e.dur > ctaStart))
      .sort((a, b) => a.start - b.start)
    : []
  const inEmoji = (t) => emojiDefs.some((e) => t >= e.start - 0.05 && t < e.start + e.dur)

  // MODE PAGE (#135) : quand la base n'est pas une vraie prise de vue mais un aplat
  // clair — la vidéo devient une page sur laquelle tout est dessiné, comme les
  // références d'Axel (@dade.zs, @beingmayy), qui n'ont aucun plan filmé. Le
  // sous-titre y est ENCRE : le blanc-sur-blanc du mode vidéo y est illisible.
  const pageMode = !!plan.pageMode

  const caps = (plan.captions || []).map((c, i) => {
    const cream = pageMode || inFullScene(r2(c.start) + 0.05)
    return {
      id: 'cap' + i,
      text: CASE(c.text),
      start: r2(c.start),
      dur: r2(Math.max(0.1, c.end - c.start)),
      accent: !!c.accent,
      cream,
      top: cream ? capTopCream : (!overlay && inSplit(r2(c.start) + 0.05) ? capTopSplit : capTopFull),
    }
  }).filter((c) => c.text)
    // MOMENT FORT : l'image occupe toute la zone sûre — le sous-titre est retiré,
    // pas déplacé. C'est une respiration visuelle, l'image se suffit.
    .filter((c) => !(wordMode && inHero(r2(c.start) + 0.05)))
    // l'emoji PREND la place du mot : jamais les deux ensemble
    .filter((c) => !inEmoji(r2(c.start) + 0.05))
    // les mots du CTA sont remplacés par la phrase entière
    .filter((c) => !(hasCta && c.start >= ctaStart))
    // …et ceux du hook par le bloc accumulé façon hk15 (hook mot-à-mot v2)
    .filter((c) => !(hasWordHook && c.start < hookCapEndW))


  // anti-doublon : un BANDEAU qui recouvre le hook affiche deja la meme phrase en plus gros
  const _nk = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3)
  const hookHiddenByBanner = !!(plan.hook && plan.hook.text) && bannerDefs.some((b) => {
    if (!(b.start < (plan.hook.end ?? 3) && b.start + b.dur > (plan.hook.start || 0))) return false
    const a = _nk(plan.hook.text), c = _nk(b.title)
    return a.length ? a.filter((w) => c.includes(w)).length / a.length >= 0.5 : false
  })
  const hookUnderWordPanel = wordMode && inSplit(r2(plan.hook?.start || 0) + 0.05)

  // Le badge hook est en haut (13,5 %) et au-dessus de tout (z 7) : la zone slides
  // (0 → 45 %), les bandeaux (14,5 %) et les scènes plein cadre tombent PILE dessous.
  // Si le chef d'orchestre ouvre une scène pendant que le hook est encore là, les deux
  // textes se superposent et se cachent l'un l'autre. On coupe donc le hook juste avant
  // la première scène qui empiète — et s'il ne reste presque rien, on ne l'affiche pas.
  const hookStart = r2(plan.hook?.start || 0)
  const hookWanted = r2(Math.max(0.8, (plan.hook?.end ?? 3) - hookStart))
  const sceneStarts = [...slides, ...bannerDefs, ...fullDefs]
    .map((x) => r2(x.start)).filter((t) => t > hookStart).sort((a, b) => a - b)
  const firstClash = sceneStarts.find((t) => t < hookStart + hookWanted)
  const hookDur = firstClash === undefined ? hookWanted : r2(firstClash - 0.15 - hookStart)

  const hook = plan.hook && plan.hook.text && !hookHiddenByBanner && !hookUnderWordPanel && hookDur >= 0.6 ? {
    text: CASE(plan.hook.text),
    start: hookStart,
    dur: hookDur,
  } : null

  // clip vidéo b-roll : classe "clip" + data-start/duration → le moteur le seek
  // frame par frame (il joue depuis son début pendant sa fenêtre, comme #base)
  const brollHtml = brolls.map((b) => `
      <div class="clip broll${b.hero ? ' hero' : ''}${wordMode && hasWordHook && b.start < hookCapEndW ? ' hkm' : ''}" id="${b.id}" data-start="${b.start}" data-duration="${b.dur}" data-track-index="3">
        <div class="broll-card">${b.isVid
          ? `<video id="${b.id}v" class="clip" src="${esc(b.src)}" data-start="${b.start}" data-duration="${b.dur}" data-track-index="3" muted playsinline></video>`
          : `<img src="${esc(b.src)}" alt="" />`}</div>
      </div>`).join('')

  const hookHtml = hook ? `
      <div class="clip" id="hook" data-start="${hook.start}" data-duration="${hook.dur}" data-track-index="4">
        <div class="hook-box">${esc(hook.text)}</div>
      </div>` : ''

  // le hook se lit PHRASE PAR PHRASE (19 mots d'un bloc débordaient sur le
  // chrono) : chaque phrase s'accumule puis cède la place à la suivante
  const whkPhr = []
  {
    let cur = []
    for (const w of hookWords) {
      cur.push(w)
      if (/[.!?,]$/.test(w.text) && cur.length >= 3) { whkPhr.push(cur); cur = [] }
    }
    if (cur.length) { if (cur.length < 3 && whkPhr.length) whkPhr[whkPhr.length - 1].push(...cur); else whkPhr.push(cur) }
  }
  const whkHtml = hasWordHook ? whkPhr.map((ph, k) => {
    const a = r2(Math.max(0, ph[0].t - 0.05))
    const b = r2(k + 1 < whkPhr.length ? whkPhr[k + 1][0].t - 0.04 : hookCapEndW)
    return `
      <div class="clip whk" data-start="${a}" data-duration="${r2(Math.max(0.3, b - a))}" data-track-index="7"><span class="whk-in" id="whkIn${k}">${ph.map((w) => `<i class="whk-w" id="${w.id}">${esc(w.text)}</i>`).join(' ')}</span></div>`
  }).join('') : ''
  const whkJs = hasWordHook ? whkPhr.map((ph, k) => {
    const b = r2(k + 1 < whkPhr.length ? whkPhr[k + 1][0].t - 0.04 : hookCapEndW)
    return ph.map((w) => (w.accent ? `
      tl.fromTo('#${w.id}', { yPercent: 84, autoAlpha: 0, scale: 1.3 }, { yPercent: 0, autoAlpha: 1, scale: 1, duration: 0.2, ease: 'back.out(1.8)', transformOrigin: '50% 100%' }, ${w.t});
      tl.set('#${w.id}', { attr: { class: 'whk-w acc' } }, ${r2(w.t + 0.06)});` : `
      tl.fromTo('#${w.id}', { yPercent: 70, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.2, ease: 'power3.out', transformOrigin: '50% 100%' }, ${w.t});`)).join('') + `
      tl.to('#whkIn${k}', { autoAlpha: 0, y: -30, duration: 0.18, ease: 'power2.in' }, ${r2(Math.max(0.2, b - 0.2))});`
  }).join('') : ''

  // scènes UI du script mot-à-mot : un clip plein cadre par scène, fondu aux bornes,
  // JS isolé (une erreur dans une scène ne casse pas la timeline — même règle que les anims)
  const wordUiHtml = wordUi.map((u) => `
      <div class="clip wui" id="${u.id}" data-start="${u.start}" data-duration="${u.dur}" data-track-index="12">${u.html}</div>`).join('')
  const wordUiJs = wordUi.map((u) => `
      tl.fromTo('#${u.id}',{autoAlpha:0},{autoAlpha:1,duration:0.16,ease:'power1.out'},${u.start});
      tl.to('#${u.id}',{autoAlpha:0,duration:0.18,ease:'power1.in'},${r2(u.start + u.dur - 0.2)});
      try {${u.js}
      } catch (e) { console.error('scène ${u.id} ignorée:', e && e.message) }`).join('')

  // ── #68 « RAW vs EDITED » : LES SOUS-TITRES DU HOOK SONT PLUS GROS ─────────
  // (Axel, 07/08, réf TikTok @tians028 : « ils jouent sur les sous-titres en
  // gros ».) +28 % sur les mots prononcés pendant l'accroche, taille normale
  // ensuite — c'est le CONTRASTE qui fait claquer l'ouverture.
  const hookCapEnd = r2(plan.hook?.end ?? Math.min(4, D))
  const capsHtml = caps.map((c, i) => (wordMode
    ? `
      <div class="clip cap" id="${c.id}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="5"><span style="font-size:${Math.round(wordFontSize(c.text, W, H) * (c.start < hookCapEnd ? 1.28 : 1))}px${c.accent ? `;color:${WORD_ACCENT}` : ''}">${esc(c.text)}</span></div>`
    : `
      <div class="clip cap${capStyleCls}${c.accent ? ' accent' : ''}${c.cream ? ' oncream' : ''}"${
    String(c.text || '').length >= 11 ? ' data-long' : ''} id="${c.id}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="5" data-text="${esc(c.text)}" style="top:${c.top}px">${esc(c.text)}</div>`)).join('')

  const emojiHtml = emojiDefs.map((e) => `
      <div class="clip emo" id="${e.id}" data-start="${e.start}" data-duration="${e.dur}" data-track-index="5"><img src="${e.file}" alt="" /></div>`).join('')

  // ── scènes plein cadre + bandeaux (scene-pack.mjs) ──
  // UNE SCÈNE PLEIN CADRE QUI PORTE UNE ANIMATION EST RENDUE PAR L'ANIMATION.
  // Le chef d'orchestre pose TOUTES ses scènes animées et toutes ses captures
  // d'application en `layout: 'full'`. Elles partaient donc dans scene-pack, dont
  // bodyHtml ne connaît que ses propres types (nodes, bars, kpi…) : une `card`
  // animée y tombait dans le `default: punch`, et comme la règle « une animation
  // plutôt qu'un mot au hasard » lui avait vidé ses items, elle ne rendait
  // RIEN. D'où le style apple entièrement vide — que des sous-titres sur blanc,
  // pas une animation, pas une capture. Le moteur dynamique, lui, n'était pas
  // touché : il a sa propre dérivation et ne passe jamais par ici.
  // `.fslide` est en inset:0, donc plein écran : les coordonnées W×H du pack
  // d'animations tombent juste, sans transform de rattrapage.
  const animFull = (s) => ANIMS.includes(s.anim)
  const withFiles = (s) => ({ ...s, logoFile, screenFile: s.screen ? 'tuto/' + s.screen + '.png' : '' })
  const fullHtml = fullDefs.map((s) => `
      <div class="clip fslide" id="${s.id}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="10">${
    animFull(s) ? animHtml(s.anim, withFiles(s), W, H, vs) : fullSlideHtml(s, W, H, vs)}</div>`).join('')
  const bannersHtml = bannerDefs.map((s) => `
      <div class="clip fbanner" id="${s.id}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="11">${bannerHtml(s, vs)}</div>`).join('')
  // fullSlideJs anime les éléments de scene-pack (barres, nœuds, compteurs) : il
  // n'a rien à animer ici. On garde son fondu d'entrée/sortie — c'est lui qui
  // fait apparaître et disparaître la scène — et le pack fait le reste.
  const fullFadeJs = (s) => {
    const t0 = r2(s.start), end = r2(s.start + s.dur)
    return `
      tl.fromTo('#${s.id}', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.22, ease: 'power2.out' }, ${t0});
      tl.to('#${s.id}', { autoAlpha: 0, duration: 0.2, ease: 'power1.in' }, ${r2(end - 0.24)});
      tl.set('#${s.id}', { autoAlpha: 0 }, ${end});`
  }
  const fullJs = fullDefs.map((s) => (animFull(s)
    ? fullFadeJs(s) + `
      try {${animJs(s.anim, withFiles(s), r2)}
      } catch (e) { console.error('animation ${s.anim} ignoree:', e && e.message) }`
    : fullSlideJs(s, H))).join('')
  const bannersJs = bannerDefs.map((s) => bannerJs(s)).join('')

  // ── slides motion design (zone haute pendant les périodes split) ──────────
  const isEmojiOnly = (s) => s.emoji && !s.anim && !(s.items && s.items.length) && !s.title
  const slideDefs = slides.filter((s) => !isEmojiOnly(s)).map((s, i) => {
    // en « mot par mot » une section peut être un bandeau, donc sans items
    const its = Array.isArray(s.items) ? s.items : []
    return {
      id: 's' + i,
      wide: !!s.wide,
      // une card = une punchline ; si le plan y met plusieurs items, on bascule en flow
      type: (s.type === 'card' && its.length > 1) ? 'flow' : s.type,
      // #131 · le chef d'orchestre choisit l'animation SELON L'AUDIO ; sans choix
      // explicite, resolveMotif() la déduit du type de scène.
      motif: s.motif,
      // #135 · animation demandée par le chef d'orchestre (prioritaire sur le motif)
      anim: ANIMS.includes(s.anim) ? s.anim : '',
      // #135 · mode presentation 3D : la capture du tuto et son cadrage. Ces champs
      // etaient perdus ici (slideDefs reconstruit l'objet), donc l'animation `screen`
      // ne recevait aucun fichier et ne rendait rien.
      screen: String(s.screen || ''),
      screenText: String(s.screenText || ''),
      // #135 · le compteur qui defile lit sa cible ici (chiffre pris dans l'audio)
      value: String(s.value || ''),
      unit: String(s.unit || ''),
      screenZoom: typeof s.screenZoom === 'number' ? s.screenZoom : undefined,
      screenX: typeof s.screenX === 'number' ? s.screenX : undefined,
      screenY: typeof s.screenY === 'number' ? s.screenY : undefined,
      boxX: typeof s.boxX === 'number' ? s.boxX : undefined,
      boxY: typeof s.boxY === 'number' ? s.boxY : undefined,
      boxW: typeof s.boxW === 'number' ? s.boxW : undefined,
      boxH: typeof s.boxH === 'number' ? s.boxH : undefined,
      screenX2: typeof s.screenX2 === 'number' ? s.screenX2 : undefined,
      screenY2: typeof s.screenY2 === 'number' ? s.screenY2 : undefined,
      screenZoom2: typeof s.screenZoom2 === 'number' ? s.screenZoom2 : undefined,
      boxX2: typeof s.boxX2 === 'number' ? s.boxX2 : undefined,
      boxY2: typeof s.boxY2 === 'number' ? s.boxY2 : undefined,
      boxW2: typeof s.boxW2 === 'number' ? s.boxW2 : undefined,
      boxH2: typeof s.boxH2 === 'number' ? s.boxH2 : undefined,
      title: String(s.title || ''),
      start: r2(s.start),
      dur: r2(Math.max(0.6, (s.end ?? s.start + 1.5) - s.start)),
      items: its.map((it, j) => ({ id: `s${i}i${j}`, text: String(it.text || ''), t: r2(it.t ?? s.start) })),
    }
  })

  // « Éditorial blanc » : les cartes ne sont pas alignées au cordeau — légère rotation,
  // décalage, et une sur quatre en arrière-plan (flou de profondeur de champ). Le tirage
  // est SEEDÉ sur le timestamp : le même plan redonne exactement la même mise en page,
  // condition sine qua non d'un rendu frame par frame reproductible.
  const scat = (s, j, o) => scatterStyle(vs, Math.round(s.start * 1000) + j * 97, o)

  const slideBody = (s, si) => {
    // une animation fabriquée l'emporte : elle montre le concept, là où une capture
    // d'interface ou une forme abstraite n'illustre rien
    if (s.anim) {
      // 15/08 soir (Axel) : « une animation / un média / une visite guidée
      // toutes les 3 secondes pour dynamiser » — les animations de banque
      // reviennent en mot-à-mot, agrandies ×1.18 pour une vraie présence
      // (l'écran du tuto garde son cadrage large).
      const ah = animHtml(s.anim, { ...s, logoFile, screenFile: s.screen ? 'tuto/' + s.screen + '.png' : '' }, W, H, vs)
      return (wordMode && ah && s.anim !== 'screen')
        ? `<div style="position:absolute;inset:0;transform:scale(1.18);transform-origin:50% 28%">${ah}</div>` : ah
    }
    // Une scène sans animation ET sans motif EXPLICITEMENT demandé n'affiche RIEN :
    // le motif déduit du type mettait des formes abstraites partout, qui ne montrent
    // rien et ne correspondent à aucun mot de l'audio. Le mot se suffit.
    // Pas de MOTIF en mot-à-mot : des carrés de couleur qui apparaissent ne montrent
    // rien, et c'est le reproche qu'Axel fait depuis le premier rendu. Ici seule une
    // vraie animation illustre — le reste laisse la page blanche, ce qui vaut mieux
    // qu'une forme décorative sans rapport avec ce qui est dit. Les motifs restent
    // en service sur les autres styles page blanche (editorial).
    if (wordMode) return ''
    const title = s.title ? `<div class="sl-title">${esc(s.title)}</div>` : ''
    if (s.type === 'flow') {
      return `${title}<div class="sl-flow">${s.items.map((it, j) => `${j > 0 ? `
        <svg class="fl-arrow" id="${it.id}a" viewBox="0 0 64 28"><path d="M2 14 H48 M38 4 L50 14 L38 24" stroke="${ACCENT}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
        <div class="fl-step" id="${it.id}"${scat(s, j)}>${esc(it.text)}</div>`).join('')}</div>`
    }
    if (s.type === 'checklist') {
      return `${title}<div class="sl-list">${s.items.map((it, j) => `
        <div class="ck-row" id="${it.id}"${scat(s, j)}>
          <div class="ck-box"><svg viewBox="0 0 24 24"><path d="M4 12.5 L10 18.5 L20 6.5" stroke="${ACCENT}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div class="ck-txt">${esc(it.text)}</div>
        </div>`).join('')}</div>`
    }
    if (s.type === 'compare') {
      const a = s.items[0], b = s.items[1] || { id: s.id + 'ib', text: '' }
      return `${title}<div class="sl-cmp">
        <div class="cmp-card ok" id="${a.id}"${scat(s, 0, { blur: false })}><div class="cmp-badge ok">✓</div><div class="cmp-lbl ok">${esc(a.text)}</div></div>
        <div class="cmp-card ko" id="${b.id}"${scat(s, 1, { blur: false })}><div class="cmp-badge ko">✕</div><div class="cmp-lbl ko">${esc(b.text)}</div></div>
      </div>`
    }
    if (s.type === 'stat') {
      const v = s.items[0]
      return `<div class="sl-stat">
        <div class="st-ticks">${'<span></span>'.repeat(5)}</div>
        <div class="st-val" id="${v.id}">${esc(v.text)}</div>
        ${s.title ? `<div class="st-lbl">${esc(s.title)}</div>` : ''}
      </div>`
    }
    // card : punchline surlignée
    const c = s.items[0]
    return `${title}<div class="sl-cardwrap"><div class="sl-card" id="${c.id}">${esc(c.text)}</div></div>`
  }

  const slidesHtml = slideDefs.map((s, si) => `
      <div class="clip slide" id="${s.id}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="6">${slideBody(s, si)}</div>`).join('')

  // ── timeline GSAP ─────────────────────────────────────────────────────────
  // transitions full <-> split : la zone vidéo glisse, la zone slides apparaît ;
  // le cadrage interne (#videoFit) alterne plein cadre / bande 16:9 selon chaque slide
  const fitTall = `{ top: 0, height: ${VIDEO_H}, duration: ${TR}, ease: 'power3.inOut' }`
  const fitWide = `{ top: ${WIDE_TOP}, height: ${WIDE_H}, duration: ${TR}, ease: 'power3.inOut' }`
  // « Mot par mot » : pas de split — le panneau recouvre TOUT l'écran (z-index 5), la
  // vidéo reste intacte dessous et réapparaît dès que le panneau s'efface.
  const layoutJs = wordMode ? `
      tl.set('#slidezone', { autoAlpha: 1 }, 0);` : overlay ? periods.map((p) => `
      tl.to('#slidezone', { autoAlpha: 1, duration: 0.1, ease: 'power1.out' }, ${r2(Math.max(0, p.start - 0.08))});
      tl.to('#slidezone', { autoAlpha: 0, duration: 0.1, ease: 'power1.in' }, ${r2(Math.max(0, p.end - 0.1))});`).join('')
    : periods.map((p) => {
    const tIn = r2(Math.max(0, p.start - TR))
    const tOut = r2(Math.min(D - 0.05, p.end - 0.02))
    let js = `
      tl.to('#videozone', { top: ${SLIDE_H}, height: ${VIDEO_H}, duration: ${TR}, ease: 'power3.inOut' }, ${tIn});
      tl.to('#videoFit', ${p.members[0].wide ? fitWide : fitTall}, ${tIn});
      tl.to('#slidezone', { autoAlpha: 1, duration: ${r2(TR * 0.85)}, ease: 'power2.out' }, ${tIn});`
    for (let i = 1; i < p.members.length; i++) {
      if (!!p.members[i].wide !== !!p.members[i - 1].wide) {
        js += `
      tl.to('#videoFit', ${p.members[i].wide ? fitWide : fitTall}, ${r2(Math.max(tIn + TR, p.members[i].start - 0.22))});`
      }
    }
    js += `
      tl.to('#videozone', { top: 0, height: ${H}, duration: ${TR}, ease: 'power3.inOut' }, ${tOut});
      tl.to('#videoFit', { top: 0, height: ${H}, duration: ${TR}, ease: 'power3.inOut' }, ${tOut});
      tl.to('#slidezone', { autoAlpha: 0, duration: ${r2(TR * 0.8)}, ease: 'power1.in' }, ${tOut});`
    return js
  }).join('')

  const zoomJs = (plan.zooms || []).map((z) => {
    const t = r2(z.t), dur = r2(Math.max(0.4, z.dur || 1))
    const cx = r2((z.cx ?? 0.5) * 100), cy = r2((z.cy ?? 0.35) * 100)
    const scale = r2(Math.min(2, Math.max(1.05, z.scale || 1.25)))
    const up = r2(dur * 0.32), hold = r2(dur * 0.28), down = r2(dur * 0.4)
    return `
      tl.set('#zoomInner', { transformOrigin: '${cx}% ${cy}%' }, ${t});
      tl.to('#zoomInner', { scale: ${scale}, duration: ${up}, ease: 'power2.out' }, ${t});
      tl.to('#zoomInner', { scale: 1, duration: ${down}, ease: 'power2.inOut' }, ${r2(t + up + hold)});`
  }).join('')

  const brollJs = brolls.map((b) => (b.hero ? `
      tl.fromTo('#${b.id}', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power1.out' }, ${b.start});
      tl.fromTo('#${b.id} .broll-card', { y: ${Math.round(H * 0.16)}, scale: 0.82, autoAlpha: 0 },
        { y: 0, scale: 1, autoAlpha: 1, duration: 0.28, ease: 'power4.out' }, ${b.start});
      tl.to('#${b.id} .broll-card', { scale: 1.04, duration: ${r2(Math.max(0.4, b.dur - 0.5))}, ease: 'none' }, ${r2(b.start + 0.28)});
      tl.to('#${b.id}', { autoAlpha: 0, duration: 0.22, ease: 'power2.in' }, ${r2(b.start + b.dur - 0.24)});` : `
      tl.fromTo('#${b.id}', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.18, ease: 'power1.out' }, ${b.start});
      tl.fromTo('#${b.id} .broll-card', { scale: 0.82, rotation: -4, y: 26, autoAlpha: 0 },
        { scale: 1, rotation: -1.5, y: 0, autoAlpha: 1, duration: 0.34, ease: 'back.out(1.7)' }, ${b.start});
      tl.to('#${b.id} .broll-card', { scale: 1.04, duration: ${r2(Math.max(0.3, b.dur - 0.34))}, ease: 'none' }, ${r2(b.start + 0.34)});
      tl.to('#${b.id}', { autoAlpha: 0, duration: 0.16, ease: 'power1.in' }, ${r2(b.start + b.dur - 0.16)});`)
  ).join('')

  const hookJs = hook ? `
      tl.fromTo('#hook .hook-box', { scale: 1.25, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.28, ease: 'back.out(2.2)' }, ${r2(hook.start + 0.05)});` : ''

  const flashJs = secBounds.map((t) => `
      tl.fromTo('#flash', { autoAlpha: 0 }, { autoAlpha: 0.55, duration: 0.09, ease: 'power2.out' }, ${r2(Math.max(0, t - 0.04))});
      tl.to('#flash', { autoAlpha: 0, duration: 0.2, ease: 'power2.in' }, ${r2(t + 0.05)});`).join('')

  // #119 · scènes avatar : visibles (au-dessus du gameplay) seulement sur leur fenêtre,
  // fondu court aux bornes (les coupures entre scènes tombent hors slides → invisibles)
  const avatarJs = avatarSegs.map((a) => `
      tl.fromTo('#${a.id}', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12, ease: 'power1.out' }, ${a.start});
      tl.to('#${a.id}', { autoAlpha: 0, duration: 0.12, ease: 'power1.in' }, ${r2(a.start + a.dur - 0.12)});`).join('')

  // AMPLITUDE DU MOUVEMENT — la règle est : si on remarque le mouvement plus que le
  // mot, le mouvement est trop grand. Le rebond passe donc de back.out(2.6) à 1.8 et
  // le départ de 0.72 à 0.86 : l'œil enregistre l'apparition sans quitter le texte
  // pour regarder l'effet. Le TIMING, lui, ne bouge pas — c'est lui qui fait le
  // travail (le mot arrive avec la voix, le cerveau n'a rien à réconcilier).
  // 15/08 (Axel) : « pour word garde comme avant — les animations de
  // sous-titres, je les veux uniquement sur anim', pas sur word ». Le mot-à-mot
  // reprend son pop sobre ; les slams par importance vivent dans le moteur
  // dynamic (sous-titres animés, réf ssstik 1786369405912).
  const capsJs = caps.map((c) => (wordMode ? `
      tl.fromTo('#${c.id}', { scale: 0.86 }, { scale: 1, duration: ${r2(Math.min(0.16, c.dur))}, ease: 'back.out(1.8)', transformOrigin: '50% 50%' }, ${c.start});` : `
      tl.fromTo('#${c.id}', { scale: 1.09 }, { scale: 1, duration: ${r2(Math.min(0.12, c.dur))}, ease: 'power2.out', transformOrigin: '50% 50%' }, ${c.start});`)
  ).join('')

  // L'emoji s'inscrit d'un quart de tour, pas d'un tour complet : à -430° on suivait
  // la toupie au lieu de lire le symbole, et l'entrée depuis scale 0.2 ajoutait une
  // deuxième distance à parcourir. Même logique que pour les mots — moins d'ampleur,
  // même lisibilité.
  const emojiJs = emojiDefs.map((e) => `
      tl.fromTo('#${e.id} img', { scale: 0.55, autoAlpha: 0, rotation: -25 }, { scale: 1, autoAlpha: 1, rotation: 0, duration: 0.42, ease: 'back.out(1.5)', transformOrigin: '50% 50%' }, ${e.start});
      tl.to('#${e.id} img', { scale: 1.05, duration: ${r2(Math.max(0.3, e.dur - 0.56))}, ease: 'sine.inOut' }, ${r2(e.start + 0.42)});
      tl.to('#${e.id} img', { scale: 0.82, autoAlpha: 0, rotation: 10, duration: 0.14, ease: 'power2.in' }, ${r2(e.start + e.dur - 0.14)});`).join('')
  // CHAQUE ANIMATION EST ISOLEE. Une seule erreur dans le JS d'une animation cassait
  // TOUTE la timeline : les tweens suivants n'etaient jamais ajoutes (leurs elements
  // restaient visibles, figes) et les precedents restaient bloques a opacity 0 par le
  // fromTo deja applique. Resultat : une video sans aucune animation, sans le moindre
  // message d'erreur. Un try/catch par animation rend ce scenario impossible.
  const animJsAll = emojiJs + slideDefs.filter((s) => s.anim)
    .map((s) => `\n      try {${animJs(s.anim, { ...s, screenFile: s.screen ? 'tuto/' + s.screen + '.png' : '' }, r2)}\n      } catch (e) { console.error('animation ${s.anim} ignoree:', e && e.message) }`)
    .join('')
  const slidesJs = animJsAll + (wordMode ? slideDefs.filter((s) => !s.anim && s.motif).map((s, si) => wordMotifJs(s, si, r2)).join('') : slideDefs.filter((s) => !s.anim).map((s) => {
    const end = r2(s.start + s.dur)
    let js = `
      tl.fromTo('#${s.id}', { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.22, ease: 'power2.out' }, ${s.start});
      tl.to('#${s.id}', { autoAlpha: 0, y: -14, duration: 0.16, ease: 'power1.in' }, ${r2(Math.max(s.start, end - 0.18))});`
    if (s.type === 'flow') {
      s.items.forEach((it, j) => {
        const t = r2(Math.max(it.t, s.start + 0.08))
        if (j > 0) js += `
      tl.fromTo('#${it.id}a', { scaleX: 0, autoAlpha: 0, transformOrigin: '0% 50%' }, { scaleX: 1, autoAlpha: 1, duration: 0.18, ease: 'power2.out' }, ${r2(Math.max(s.start + 0.05, t - 0.14))});`
        js += `
      tl.fromTo('#${it.id}', { autoAlpha: 0, y: 14, scale: 0.92 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.26, ease: 'back.out(1.8)' }, ${t});`
      })
    } else if (s.type === 'checklist') {
      s.items.forEach((it) => {
        const t = r2(Math.max(it.t, s.start + 0.08))
        js += `
      tl.fromTo('#${it.id}', { autoAlpha: 0, x: -22 }, { autoAlpha: 1, x: 0, duration: 0.22, ease: 'power2.out' }, ${t});
      tl.fromTo('#${it.id} .ck-box svg', { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.24, ease: 'back.out(2.6)' }, ${r2(t + 0.08)});`
      })
    } else if (s.type === 'compare') {
      s.items.slice(0, 2).forEach((it) => {
        const t = r2(Math.max(it.t, s.start + 0.08))
        js += `
      tl.fromTo('#${it.id}', { autoAlpha: 0, y: 20, scale: 0.94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.28, ease: 'back.out(1.6)' }, ${t});`
      })
    } else if (s.type === 'stat') {
      const v = s.items[0]
      const t = r2(Math.max(v.t, s.start + 0.08))
      js += `
      tl.fromTo('#${s.id} .st-ticks span', { autoAlpha: 0, scaleX: 0 }, { autoAlpha: 1, scaleX: 1, duration: 0.14, stagger: 0.05, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(Math.max(s.start + 0.05, t - 0.2))});
      tl.fromTo('#${v.id}', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: 'back.out(2)' }, ${t});`
      if (/^\d{1,6}$/.test(v.text.trim())) {
        js += `
      (function(){ var o = { v: 0 }, el = document.querySelector('#${v.id}'), N = ${parseInt(v.text.trim(), 10)};
      tl.to(o, { v: N, duration: 0.6, ease: 'power2.out', onUpdate: function(){ el.textContent = Math.round(o.v); } }, ${t}); })();`
      }
      if (s.title) js += `
      tl.fromTo('#${s.id} .st-lbl', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.22, ease: 'power2.out' }, ${r2(t + 0.14)});`
    } else { // card
      const c = s.items[0]
      const t = r2(Math.max(c.t, s.start + 0.08))
      js += `
      tl.fromTo('#${c.id}', { scale: 0.88, autoAlpha: 0, rotation: -3 }, { scale: 1, autoAlpha: 1, rotation: -1.5, duration: 0.3, ease: 'back.out(1.6)' }, ${t});`
    }
    if (s.title) js += `
      tl.fromTo('#${s.id} .sl-title', { autoAlpha: 0 }, { autoAlpha: 0.6, duration: 0.2, ease: 'power1.out' }, ${r2(s.start + 0.05)});`
    return js
  }).join(''))

  const fz = (k) => Math.round(SLIDE_H * k) // tailles relatives à la zone slides
  const slideCss = slides.length ? `
      #slidezone {
        left: 0; top: 0; width: ${W}px; height: ${SLIDE_H}px; background: #0d0d0f;
        background-image: radial-gradient(rgba(255,255,255,.045) 1.5px, transparent 1.5px);
        background-size: ${Math.round(W * 0.026)}px ${Math.round(W * 0.026)}px;
        will-change: opacity; z-index: 1;
      }
      #slidezone::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: ${ACCENT}; }

      .slide { left: 4%; right: 4%; top: 0; height: ${SLIDE_H}px; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: ${fz(0.03)}px; will-change: transform, opacity; z-index: 3;
        font-family: "Arial Black", Arial, sans-serif; padding-top: ${fz(0.06)}px; }
      .sl-title { position: absolute; top: ${fz(0.055)}px; left: 0; right: 0; text-align: center;
        font-weight: 700; font-size: ${fz(0.038)}px; color: rgba(255,255,255,.6); letter-spacing: 4px; }

      .sl-flow { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: ${fz(0.022)}px; max-width: 100%; }
      .fl-step { background: #1a1a1f; border: 1px solid rgba(255,255,255,.09); color: #fff; text-align: center;
        font-weight: 900; font-size: ${fz(0.042)}px; line-height: 1.2; letter-spacing: .5px;
        padding: ${fz(0.032)}px ${fz(0.036)}px; border-radius: ${fz(0.028)}px; max-width: ${Math.round(W * 0.26)}px;
        box-shadow: 0 12px 30px rgba(0,0,0,.4); will-change: transform, opacity; }
      .fl-arrow { width: ${fz(0.085)}px; height: auto; flex: 0 0 auto; will-change: transform, opacity; }

      .sl-list { display: flex; flex-direction: column; gap: ${fz(0.038)}px; align-items: flex-start; }
      .ck-row { display: flex; align-items: center; gap: ${fz(0.032)}px; will-change: transform, opacity; }
      .ck-box { width: ${fz(0.085)}px; height: ${fz(0.085)}px; background: #1a1a1f; border: 1px solid rgba(255,255,255,.1);
        border-radius: ${fz(0.02)}px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
      .ck-box svg { width: 62%; height: 62%; will-change: transform; }
      .ck-txt { color: #fff; font-weight: 900; font-size: ${fz(0.052)}px; letter-spacing: .5px; }

      .sl-cmp { display: flex; gap: ${fz(0.035)}px; width: 100%; justify-content: center; }
      .cmp-card { width: 42%; border-radius: ${fz(0.03)}px; padding: ${fz(0.045)}px ${fz(0.03)}px;
        display: flex; flex-direction: column; align-items: center; gap: ${fz(0.03)}px; will-change: transform, opacity; }
      .cmp-card.ok { background: rgba(34,197,94,.07); border: 2px solid ${OK}; }
      .cmp-card.ko { background: rgba(239,68,68,.06); border: 2px solid ${KO}; }
      .cmp-badge { width: ${fz(0.1)}px; height: ${fz(0.1)}px; border-radius: 50%; display: flex; align-items: center;
        justify-content: center; font-weight: 900; font-size: ${fz(0.05)}px; }
      .cmp-badge.ok { background: ${OK}; color: #04170a; }
      .cmp-badge.ko { background: rgba(239,68,68,.16); color: ${KO}; }
      .cmp-lbl { font-weight: 900; font-size: ${fz(0.04)}px; text-align: center; letter-spacing: .5px; line-height: 1.25; }
      .cmp-lbl.ok { color: ${OK}; } .cmp-lbl.ko { color: ${KO}; }

      .sl-stat { display: flex; flex-direction: column; align-items: center; gap: ${fz(0.02)}px; }
      .st-ticks { display: flex; gap: ${fz(0.016)}px; }
      .st-ticks span { width: ${fz(0.06)}px; height: ${fz(0.014)}px; background: ${ACCENT}; border-radius: 99px;
        display: block; will-change: transform, opacity; }
      .st-val { color: #fff; font-weight: 900; font-size: ${fz(0.3)}px; line-height: 1; will-change: transform, opacity;
        text-shadow: 0 14px 44px rgba(0,0,0,.5); }
      .st-lbl { color: ${ACCENT}; font-weight: 900; font-size: ${fz(0.05)}px; letter-spacing: 3px; will-change: transform, opacity; }

      .sl-cardwrap { display: flex; align-items: center; justify-content: center; }
      .sl-card { background: ${ACCENT}; color: #111; font-weight: 900; font-size: ${fz(0.062)}px; line-height: 1.2;
        text-align: center; padding: ${fz(0.035)}px ${fz(0.05)}px; border-radius: ${fz(0.018)}px;
        box-shadow: 0 16px 44px rgba(0,0,0,.5); max-width: 88%; will-change: transform, opacity; }` : ''

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0d0d0f; }
      .clip { position: absolute; }

      /* zone vidéo : plein écran par défaut, animée vers la moitié basse pendant les slides */
      #videozone { left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; z-index: 2; background: #000; }
      #videoFit { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
      #zoomInner { position: absolute; inset: 0; will-change: transform; }
      #base { width: 100%; height: 100%; object-fit: cover; object-position: 50% ${objPos}%; display: block; }
      /* #119 · scène avatar : recouvre le gameplay pendant sa fenêtre (même cadrage, suit le zoom) */
      .avatar-seg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
        object-position: 50% ${objPos}%; display: block; will-change: opacity; }

      /* b-roll « carte flottante » : la vidéo reste visible derrière, assombrie ;
         l'image pop dans une carte arrondie avec ombre (look viral moderne) */
      .broll { inset: 0; z-index: 4; background: rgba(8,8,10,.55); display: flex;
        align-items: center; justify-content: center; }
      .broll-card { max-width: 82%; max-height: 56%; border-radius: ${Math.round(H * 0.018)}px;
        overflow: hidden; border: 1.5px solid rgba(255,255,255,.14);
        box-shadow: 0 30px 80px rgba(0,0,0,.65), 0 6px 22px rgba(0,0,0,.4);
        will-change: transform, opacity; }
      .broll-card img, .broll-card video { max-width: 100%; max-height: ${Math.round(H * 0.56)}px;
        display: block; object-fit: contain; will-change: transform; }
      /* le <video> b-roll porte la classe "clip" (sync moteur) mais doit rester
         dans le flux de la carte, pas en absolu comme les autres clips */
      .broll-card video { position: relative; }

      /* transition de section : flash lumineux plein écran (au-dessus de tout) */
      #flash { inset: 0; z-index: 9; background: #fff; pointer-events: none; }

      /* scènes UI du script mot-à-mot (timer, navigateur, grille, vol de photo) */
      .wui { inset: 0; z-index: 4; }
      .wui .disp { font-family: 'Archivo Black', 'Arial Black', sans-serif; font-weight: 400; letter-spacing: -.01em; }
      .wui .stack { position: absolute; left: 0; right: 0; top: 30%; display: flex; flex-direction: column; align-items: center; }

      /* Hook : badge jaune en haut, passages full écran (safe zone) */
      #hook { left: 6%; right: 6%; top: 13.5%; display: flex; justify-content: center; z-index: 7; }
      .hook-box {
        background: ${ACCENT}; color: #111; text-align: center;
        font: 900 ${Math.round(H * 0.027)}px/1.25 "Arial Black", Arial, sans-serif;
        letter-spacing: .5px; padding: ${Math.round(H * 0.01)}px ${Math.round(H * 0.016)}px;
        border-radius: ${Math.round(H * 0.007)}px; box-shadow: 0 10px 34px rgba(0,0,0,.45);
      }

      /* HOOK MOT-À-MOT v2 : accumulation Anton, dégradé or hk1, accents rouges */
      .whk { left: 5%; right: 5%; top: 0; height: ${H}px; display: flex; align-items: flex-end;
        justify-content: center; padding-bottom: ${Math.round(H * 0.235)}px; z-index: 6; pointer-events: none; }
      .whk-in { text-align: center; font-family: 'Anton', 'Arial Black', sans-serif; font-weight: 400;
        text-transform: uppercase; font-size: ${Math.round(H * 0.05)}px; line-height: 1.08;
        letter-spacing: .012em; max-width: 100%; }
      /* v4 (Axel, capture hk15 : « non je veux comme ça ») : le hook néon du
         dynamic porté tel quel — BLANC à ombre franche (tient sur la page
         blanche), le mot fort s'ALLUME en rouge flou juste après son arrivée,
         MÊME taille (c'est le néon qui fait l'emphase, pas la taille). */
      .whk-w { display: inline-block; opacity: 0; padding: 0.04em ${Math.round(W * 0.004)}px;
        color: #FFFFFF;
        text-shadow: 0 ${Math.round(H * 0.004)}px ${Math.round(H * 0.012)}px rgba(0,0,0,.62),
          0 ${Math.round(H * 0.0012)}px ${Math.round(H * 0.004)}px rgba(0,0,0,.5);
        will-change: transform, opacity; }
      .whk-w.acc { color: #FFFFFF;
        text-shadow: 0 0 ${Math.round(H * 0.009)}px rgba(255,40,60,1), 0 0 ${Math.round(H * 0.024)}px rgba(255,16,44,1),
          0 0 ${Math.round(H * 0.05)}px rgba(235,0,40,.9), 0 0 ${Math.round(H * 0.09)}px rgba(210,0,38,.62),
          0 0 ${Math.round(H * 0.13)}px rgba(185,0,34,.4); }
      /* la photo du hook vit EN HAUT, réduite — les mots ne la touchent jamais */
      .broll.hkm { align-items: flex-start; padding-top: ${Math.round(H * 0.055)}px; background: transparent; }
      .broll.hkm .broll-card, .broll.hkm .broll-card img { max-height: ${Math.round(H * 0.42)}px; }

      /* Sous-titres Punch : un mot, énorme, blanc (ou orange accent), gros contour noir */
      .cap {
        left: 4%; right: 4%;
        text-align: center; color: #fff;
        font: 900 ${subSize}px/1.1 "Arial Black", Arial, sans-serif;
        letter-spacing: 1px; will-change: transform; z-index: 8;
        /* UN MOT LONG NE DOIT JAMAIS ÊTRE COUPÉ. « avatarads.fr » sortait du cadre
           et s'affichait « atarads.fr » : le domaine de la marque, amputé, au
           moment précis du CTA. Le mot rétrécit maintenant pour tenir — c'est
           toujours mieux que de perdre des lettres. */
        white-space: normal; overflow-wrap: anywhere;
      }
      .cap[data-long] { font-size: ${Math.round(subSize * 0.72)}px; letter-spacing: 0; }
      /* sur une scène plein cadre (fond crème) : ombre portée au lieu du contour noir */
      /* variantes demandees dans « Parametres avances » (plan.capStyle) */
      .cap.st-neon { color: #FFFFFF; text-shadow: 0 0 12px #FF2FD0, 0 0 26px #7A2BFF, 0 3px 0 rgba(0,0,0,.5); }
      .cap.st-neon::before { -webkit-text-stroke-color: #2A0B3F; }
      .cap.st-neon.accent { color: #7CF6FF; text-shadow: 0 0 14px #00E5FF, 0 0 30px #0066FF; }
      .cap.st-minimal { font-weight: 600; letter-spacing: .01em; text-shadow: 0 2px 10px rgba(0,0,0,.55); }
      .cap.st-minimal::before { display: none; }
      .cap.oncream { color: #FFFDF7; text-shadow: 0 8px 0 rgba(20,16,12,.22), 0 14px 34px rgba(20,16,12,.30); }
      .cap.oncream::before { display: none; }
      .cap.oncream.accent { color: #C2483A; text-shadow: 0 8px 0 rgba(20,16,12,.18); }
      .cap::before {
        content: attr(data-text); position: absolute; left: 0; right: 0; top: 0;
        -webkit-text-stroke: ${subStroke * 2}px rgba(0,0,0,.92); z-index: -1;
      }
      .cap.accent { color: #FF6B35; }
${slideCss}
${(fullDefs.length || bannerDefs.length) ? scenePackCss(W, H) : ''}
${vs ? fontFaceCss() + styleCss(vs, W, H, SLIDE_H) : ''}
${(slideDefs.some((s) => s.anim) || fullDefs.some(animFull)) ? animCss(W, H) : ''}
    </style>
  </head>
  <body${vs ? ` class="vs-${vs}"` : ''}>
    <div id="root" data-composition-id="montage" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
${slides.length ? `      <div id="slidezone" class="clip" data-start="0" data-duration="${D}" data-track-index="1"></div>
` : ''}      <div id="videozone" class="clip" data-start="0" data-duration="${D}" data-track-index="2">
        <div id="videoFit">
          <div id="zoomInner">
            <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
              <filter id="glassEdge" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="7" result="n"/>
                <feDisplacementMap in="SourceGraphic" in2="n" scale="${plan.slideStyle === 'glass' ? 8 : 0}" xChannelSelector="R" yChannelSelector="G"/>
              </filter>
            </defs></svg>
            <video id="base" class="clip" src="media/base.mp4" data-start="0" data-duration="${D}" data-track-index="2" muted playsinline></video>
${avatarSegs.map((a) => `            <video id="${a.id}" class="clip avatar-seg" src="${esc(a.src)}" data-start="${a.start}" data-duration="${a.dur}" data-track-index="9" muted playsinline></video>`).join('\n')}
          </div>
        </div>
      </div>
${brollHtml}
${wordUiHtml}
${slidesHtml}
${fullHtml}
${bannersHtml}
${hookHtml}
${whkHtml}
${capsHtml}${emojiHtml}${hasCta ? `
      <div class="clip ctablk" id="ctablk" data-start="${ctaStart}" data-duration="${r2(D - ctaStart)}" data-track-index="6"><span>${ctaWords.map((w) => `<i id="${w.id}"${w.accent ? ` style="color:${WORD_ACCENT}"` : ''}>${esc(w.text)}</i>`).join(' ')}</span></div>` : ''}
${secBounds.length ? `      <div id="flash" class="clip" data-start="0" data-duration="${D}" data-track-index="8"></div>
` : ''}    </div>

    <script>
${wordMode ? WORD_FIT_JS + '\n' : ''}      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.set('#zoomInner', { scale: 1 }, 0);
${slides.length ? `      tl.set('#slidezone', { autoAlpha: 0 }, 0);
` : ''}${secBounds.length ? `      tl.set('#flash', { autoAlpha: 0 }, 0);
` : ''}${avatarSegs.map((a) => `      tl.set('#${a.id}', { autoAlpha: 0 }, 0);`).join('\n')}
${layoutJs}
${zoomJs}
${brollJs}
${wordUiJs}
${slidesJs}
${fullJs}
${bannersJs}
${hookJs}
${whkJs}
${capsJs}${hasCta ? `
${ctaWords.map((w) => `
      tl.set('#${w.id}', { autoAlpha: 0 }, 0);
      tl.fromTo('#${w.id}', { autoAlpha: 0, y: 10, scale: 0.94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, ease: 'back.out(1.7)', transformOrigin: '50% 50%' }, ${r2(Math.max(ctaStart, w.t))});`).join('')}
      tl.to('#ctablk span', { scale: 1.04, duration: ${r2(Math.max(0.6, D - ctaStart - 0.4))}, ease: 'sine.inOut' }, ${r2(ctaStart + 0.3)});` : ''}
${flashJs}
${avatarJs}
${vs ? styleExtraJs(vs, r2, { slides: slideDefs, fulls: fullDefs, banners: bannerDefs }) : ''}
      tl.set({}, {}, ${D}); // borne la durée de la timeline
      window.__timelines['montage'] = tl;
    </script>
  </body>
</html>
`
}
