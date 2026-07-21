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

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = (n) => Math.round(n * 100) / 100
const ACCENT = '#FFD400'   // jaune viral (flèches, checks, surlignés)
const OK = '#22c55e'
const KO = '#ef4444'

export function buildComposition(plan, opts = {}) {
  const W = opts.width || 1080
  const H = opts.height || 1920
  const D = r2(Math.max(1, plan.duration))
  const assetFiles = opts.assetFiles || {} // { assetId: 'media/img1.jpg' }

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
  const allSlides = (plan.slides || []).filter((s) => s && typeof s.start === 'number')
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
  const slides = wordMode ? allSlides
    : allSlides.filter((s) => !isFull(s) && !isBanner(s) && Array.isArray(s.items) && s.items.length)
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
  const rawBroll = (plan.broll || []).filter((b) => assetFiles[b.assetId])
    .slice().sort((a, b) => a.start - b.start)
  if (wordMode && rawBroll.length) {
    const busy = [...slides.filter((sl) => sl.anim).map((sl) => sl.start)].sort((a, b) => a - b)
    rawBroll.forEach((b, i) => {
      const nextVisual = Math.min(
        rawBroll[i + 1] ? rawBroll[i + 1].start : D,
        busy.find((t) => t > b.start) ?? D,
      )
      b.end = Math.min(Math.max(b.end, Math.min(b.start + 4, nextVisual - 0.2)), D - 0.1)
    })
  }
  const brolls = rawBroll.map((b, i) => ({
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
  const caps = (plan.captions || []).map((c, i) => {
    const cream = inFullScene(r2(c.start) + 0.05)
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
      <div class="clip broll" id="${b.id}" data-start="${b.start}" data-duration="${b.dur}" data-track-index="3">
        <div class="broll-card">${b.isVid
          ? `<video id="${b.id}v" class="clip" src="${esc(b.src)}" data-start="${b.start}" data-duration="${b.dur}" data-track-index="3" muted playsinline></video>`
          : `<img src="${esc(b.src)}" alt="" />`}</div>
      </div>`).join('')

  const hookHtml = hook ? `
      <div class="clip" id="hook" data-start="${hook.start}" data-duration="${hook.dur}" data-track-index="4">
        <div class="hook-box">${esc(hook.text)}</div>
      </div>` : ''

  const capsHtml = caps.map((c, i) => (wordMode
    ? `
      <div class="clip cap" id="${c.id}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="5"><span style="font-size:${wordFontSize(c.text, W, H)}px${c.accent ? `;color:${WORD_ACCENT}` : ''}">${esc(c.text)}</span></div>`
    : `
      <div class="clip cap${capStyleCls}${c.accent ? ' accent' : ''}${c.cream ? ' oncream' : ''}" id="${c.id}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="5" data-text="${esc(c.text)}" style="top:${c.top}px">${esc(c.text)}</div>`)).join('')

  // ── scènes plein cadre + bandeaux (scene-pack.mjs) ──
  const fullHtml = fullDefs.map((s) => `
      <div class="clip fslide" id="${s.id}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="10">${fullSlideHtml(s, W, H, vs)}</div>`).join('')
  const bannersHtml = bannerDefs.map((s) => `
      <div class="clip fbanner" id="${s.id}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="11">${bannerHtml(s, vs)}</div>`).join('')
  const fullJs = fullDefs.map((s) => fullSlideJs(s, H)).join('')
  const bannersJs = bannerDefs.map((s) => bannerJs(s)).join('')

  // ── slides motion design (zone haute pendant les périodes split) ──────────
  const slideDefs = slides.map((s, i) => {
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
    if (s.anim) return animHtml(s.anim, s, W, H, vs)
    // Une scène sans animation ET sans motif EXPLICITEMENT demandé n'affiche RIEN :
    // le motif déduit du type mettait des formes abstraites partout, qui ne montrent
    // rien et ne correspondent à aucun mot de l'audio. Le mot se suffit.
    if (wordMode) return s.motif ? wordMotif(s, si, W, H) : ''
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

  const brollJs = brolls.map((b) => `
      tl.fromTo('#${b.id}', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.18, ease: 'power1.out' }, ${b.start});
      tl.fromTo('#${b.id} .broll-card', { scale: 0.82, rotation: -4, y: 26, autoAlpha: 0 },
        { scale: 1, rotation: -1.5, y: 0, autoAlpha: 1, duration: 0.34, ease: 'back.out(1.7)' }, ${b.start});
      tl.to('#${b.id} .broll-card', { scale: 1.04, duration: ${r2(Math.max(0.3, b.dur - 0.34))}, ease: 'none' }, ${r2(b.start + 0.34)});
      tl.to('#${b.id}', { autoAlpha: 0, duration: 0.16, ease: 'power1.in' }, ${r2(b.start + b.dur - 0.16)});`
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

  const capsJs = caps.map((c) => (wordMode ? `
      tl.fromTo('#${c.id}', { scale: 0.72 }, { scale: 1, duration: ${r2(Math.min(0.16, c.dur))}, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, ${c.start});` : `
      tl.fromTo('#${c.id}', { scale: 1.14 }, { scale: 1, duration: ${r2(Math.min(0.12, c.dur))}, ease: 'power2.out', transformOrigin: '50% 50%' }, ${c.start});`)
  ).join('')

  const animJsAll = slideDefs.filter((s) => s.anim).map((s) => animJs(s.anim, s, r2)).join('')
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
      tl.fromTo('#${c.id}', { scale: 0.75, autoAlpha: 0, rotation: -4 }, { scale: 1, autoAlpha: 1, rotation: -1.5, duration: 0.3, ease: 'back.out(2.2)' }, ${t});`
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

      /* Hook : badge jaune en haut, passages full écran (safe zone) */
      #hook { left: 6%; right: 6%; top: 13.5%; display: flex; justify-content: center; z-index: 7; }
      .hook-box {
        background: ${ACCENT}; color: #111; text-align: center;
        font: 900 ${Math.round(H * 0.027)}px/1.25 "Arial Black", Arial, sans-serif;
        letter-spacing: .5px; padding: ${Math.round(H * 0.01)}px ${Math.round(H * 0.016)}px;
        border-radius: ${Math.round(H * 0.007)}px; box-shadow: 0 10px 34px rgba(0,0,0,.45);
      }

      /* Sous-titres Punch : un mot, énorme, blanc (ou orange accent), gros contour noir */
      .cap {
        left: 4%; right: 4%;
        text-align: center; color: #fff;
        font: 900 ${subSize}px/1.1 "Arial Black", Arial, sans-serif;
        letter-spacing: 1px; will-change: transform; z-index: 8;
      }
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
${slideDefs.some((s) => s.anim) ? animCss(W, H) : ''}
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
${slidesHtml}
${fullHtml}
${bannersHtml}
${hookHtml}
${capsHtml}
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
${slidesJs}
${fullJs}
${bannersJs}
${hookJs}
${capsJs}
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
