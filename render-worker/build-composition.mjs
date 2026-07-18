// build-composition.mjs — plan de montage v0.2/v0.6 → composition HyperFrames (visuel uniquement)
// L'audio (voix + SFX + musique duckée) est mixé par ffmpeg dans worker.mjs.
//
// Format ALTERNÉ (le chef d'orchestre décide) :
//  - passages FULL ÉCRAN : la personne plein cadre — zooms punch, b-roll, hook badge jaune
//  - passages SPLIT : la vidéo glisse dans la moitié basse, une slide motion design
//    (flow / checklist / compare / stat / card) occupe la moitié haute ; chaque élément
//    apparaît PILE sur le mot prononcé
// La zone vidéo est animée entre les deux états (transition 0.34s) à chaque frontière.

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

  const slides = (plan.slides || []).filter((s) => Array.isArray(s.items) && s.items.length)
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

  // ── b-roll : images plein écran (cover), Ken Burns léger — passages full uniquement ──
  const brolls = (plan.broll || []).filter((b) => assetFiles[b.assetId]).map((b, i) => ({
    id: 'broll' + i,
    src: assetFiles[b.assetId],
    start: r2(b.start),
    dur: r2(Math.max(0.4, b.end - b.start)),
  }))

  // ── sous-titres Punch : top par mot selon le mode actif à son timestamp ──
  const subSize = Math.round(H * 0.052)
  const subStroke = Math.max(4, Math.round(subSize * 0.16))
  const capTopFull = Math.round(H * 0.72) - Math.round(subSize * 0.75)
  const capTopSplit = SLIDE_H + Math.round(VIDEO_H * 0.62) - Math.round(subSize * 0.75)
  const caps = (plan.captions || []).map((c, i) => ({
    id: 'cap' + i,
    text: String(c.text || '').toUpperCase(),
    start: r2(c.start),
    dur: r2(Math.max(0.1, c.end - c.start)),
    accent: !!c.accent,
    top: inSplit(r2(c.start) + 0.05) ? capTopSplit : capTopFull,
  })).filter((c) => c.text)

  const hook = plan.hook && plan.hook.text ? {
    text: String(plan.hook.text).toUpperCase(),
    start: r2(plan.hook.start || 0),
    dur: r2(Math.max(0.8, (plan.hook.end ?? 3) - (plan.hook.start || 0))),
  } : null

  const brollHtml = brolls.map((b) => `
      <div class="clip broll" id="${b.id}" data-start="${b.start}" data-duration="${b.dur}" data-track-index="3">
        <div class="broll-card"><img src="${esc(b.src)}" alt="" /></div>
      </div>`).join('')

  const hookHtml = hook ? `
      <div class="clip" id="hook" data-start="${hook.start}" data-duration="${hook.dur}" data-track-index="4">
        <div class="hook-box">${esc(hook.text)}</div>
      </div>` : ''

  const capsHtml = caps.map((c) => `
      <div class="clip cap${c.accent ? ' accent' : ''}" id="${c.id}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="5" data-text="${esc(c.text)}" style="top:${c.top}px">${esc(c.text)}</div>`).join('')

  // ── slides motion design (zone haute pendant les périodes split) ──────────
  const slideDefs = slides.map((s, i) => ({
    id: 's' + i,
    wide: !!s.wide,
    // une card = une punchline ; si le plan y met plusieurs items, on bascule en flow
    type: (s.type === 'card' && s.items.length > 1) ? 'flow' : s.type,
    title: String(s.title || ''),
    start: r2(s.start),
    dur: r2(Math.max(0.6, s.end - s.start)),
    items: s.items.map((it, j) => ({ id: `s${i}i${j}`, text: String(it.text || ''), t: r2(it.t) })),
  }))

  const slideBody = (s) => {
    const title = s.title ? `<div class="sl-title">${esc(s.title)}</div>` : ''
    if (s.type === 'flow') {
      return `${title}<div class="sl-flow">${s.items.map((it, j) => `${j > 0 ? `
        <svg class="fl-arrow" id="${it.id}a" viewBox="0 0 64 28"><path d="M2 14 H48 M38 4 L50 14 L38 24" stroke="${ACCENT}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
        <div class="fl-step" id="${it.id}">${esc(it.text)}</div>`).join('')}</div>`
    }
    if (s.type === 'checklist') {
      return `${title}<div class="sl-list">${s.items.map((it) => `
        <div class="ck-row" id="${it.id}">
          <div class="ck-box"><svg viewBox="0 0 24 24"><path d="M4 12.5 L10 18.5 L20 6.5" stroke="${ACCENT}" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div class="ck-txt">${esc(it.text)}</div>
        </div>`).join('')}</div>`
    }
    if (s.type === 'compare') {
      const a = s.items[0], b = s.items[1] || { id: s.id + 'ib', text: '' }
      return `${title}<div class="sl-cmp">
        <div class="cmp-card ok" id="${a.id}"><div class="cmp-badge ok">✓</div><div class="cmp-lbl ok">${esc(a.text)}</div></div>
        <div class="cmp-card ko" id="${b.id}"><div class="cmp-badge ko">✕</div><div class="cmp-lbl ko">${esc(b.text)}</div></div>
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

  const slidesHtml = slideDefs.map((s) => `
      <div class="clip slide" id="${s.id}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="6">${slideBody(s)}</div>`).join('')

  // ── timeline GSAP ─────────────────────────────────────────────────────────
  // transitions full <-> split : la zone vidéo glisse, la zone slides apparaît ;
  // le cadrage interne (#videoFit) alterne plein cadre / bande 16:9 selon chaque slide
  const fitTall = `{ top: 0, height: ${VIDEO_H}, duration: ${TR}, ease: 'power3.inOut' }`
  const fitWide = `{ top: ${WIDE_TOP}, height: ${WIDE_H}, duration: ${TR}, ease: 'power3.inOut' }`
  const layoutJs = periods.map((p) => {
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

  const capsJs = caps.map((c) => `
      tl.fromTo('#${c.id}', { scale: 1.14 }, { scale: 1, duration: ${r2(Math.min(0.12, c.dur))}, ease: 'power2.out', transformOrigin: '50% 50%' }, ${c.start});`
  ).join('')

  const slidesJs = slideDefs.map((s) => {
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
  }).join('')

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

      /* b-roll « carte flottante » : la vidéo reste visible derrière, assombrie ;
         l'image pop dans une carte arrondie avec ombre (look viral moderne) */
      .broll { inset: 0; z-index: 4; background: rgba(8,8,10,.55); display: flex;
        align-items: center; justify-content: center; }
      .broll-card { max-width: 82%; max-height: 56%; border-radius: ${Math.round(H * 0.018)}px;
        overflow: hidden; border: 1.5px solid rgba(255,255,255,.14);
        box-shadow: 0 30px 80px rgba(0,0,0,.65), 0 6px 22px rgba(0,0,0,.4);
        will-change: transform, opacity; }
      .broll-card img { max-width: 100%; max-height: ${Math.round(H * 0.56)}px; display: block;
        object-fit: contain; will-change: transform; }

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
        letter-spacing: 1px; will-change: transform; z-index: 6;
      }
      .cap::before {
        content: attr(data-text); position: absolute; left: 0; right: 0; top: 0;
        -webkit-text-stroke: ${subStroke * 2}px rgba(0,0,0,.92); z-index: -1;
      }
      .cap.accent { color: #FF6B35; }
${slideCss}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="montage" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
${slides.length ? `      <div id="slidezone" class="clip" data-start="0" data-duration="${D}" data-track-index="1"></div>
` : ''}      <div id="videozone" class="clip" data-start="0" data-duration="${D}" data-track-index="2">
        <div id="videoFit">
          <div id="zoomInner">
            <video id="base" class="clip" src="media/base.mp4" data-start="0" data-duration="${D}" data-track-index="2" muted playsinline></video>
          </div>
        </div>
      </div>
${brollHtml}
${slidesHtml}
${hookHtml}
${capsHtml}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.set('#zoomInner', { scale: 1 }, 0);
${slides.length ? `      tl.set('#slidezone', { autoAlpha: 0 }, 0);
` : ''}${layoutJs}
${zoomJs}
${brollJs}
${slidesJs}
${hookJs}
${capsJs}
      tl.set({}, {}, ${D}); // borne la durée de la timeline
      window.__timelines['montage'] = tl;
    </script>
  </body>
</html>
`
}
