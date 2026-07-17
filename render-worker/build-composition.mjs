// build-composition.mjs — plan de montage v0.2 → composition HyperFrames (visuel uniquement)
// L'audio (voix + SFX + musique duckée) est mixé par ffmpeg dans worker.mjs : la
// composition rend la vidéo de base MUTED + zooms punch + b-roll + hook + sous-titres
// Punch mot-à-mot, à l'identique du rendu de l'Éditeur de l'app.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = (n) => Math.round(n * 100) / 100

export function buildComposition(plan, opts = {}) {
  const W = opts.width || 1080
  const H = opts.height || 1920
  const D = r2(Math.max(1, plan.duration))
  const assetFiles = opts.assetFiles || {} // { assetId: 'media/img1.jpg' }

  // ── b-roll : images plein écran (cover) avec Ken Burns léger ──
  const brolls = (plan.broll || []).filter((b) => assetFiles[b.assetId]).map((b, i) => ({
    id: 'broll' + i,
    src: assetFiles[b.assetId],
    start: r2(b.start),
    dur: r2(Math.max(0.4, b.end - b.start)),
  }))

  // ── sous-titres : un mot à la fois, style Punch (accents orange) ──
  const caps = (plan.captions || []).map((c, i) => ({
    id: 'cap' + i,
    text: String(c.text || '').toUpperCase(),
    start: r2(c.start),
    dur: r2(Math.max(0.1, c.end - c.start)),
    accent: !!c.accent,
  })).filter((c) => c.text)

  const hook = plan.hook && plan.hook.text ? {
    text: String(plan.hook.text).toUpperCase(),
    start: r2(plan.hook.start || 0),
    dur: r2(Math.max(0.8, (plan.hook.end ?? 3) - (plan.hook.start || 0))),
  } : null

  const subSize = Math.round(H * 0.055)
  const subStroke = Math.max(4, Math.round(subSize * 0.16))

  const brollHtml = brolls.map((b) => `
      <div class="clip broll" id="${b.id}" data-start="${b.start}" data-duration="${b.dur}" data-track-index="3">
        <img src="${esc(b.src)}" alt="" />
      </div>`).join('')

  const hookHtml = hook ? `
      <div class="clip" id="hook" data-start="${hook.start}" data-duration="${hook.dur}" data-track-index="4">
        <div class="hook-box">${esc(hook.text)}</div>
      </div>` : ''

  const capsHtml = caps.map((c) => `
      <div class="clip cap${c.accent ? ' accent' : ''}" id="${c.id}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="5" data-text="${esc(c.text)}">${esc(c.text)}</div>`).join('')

  // ── timeline GSAP : zooms punch (scale, transform-only → lint-safe) + pops ──
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
      tl.fromTo('#${b.id}', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16, ease: 'power1.out' }, ${b.start});
      tl.fromTo('#${b.id} img', { scale: 1.07 }, { scale: 1.0, duration: ${b.dur}, ease: 'none' }, ${b.start});
      tl.to('#${b.id}', { autoAlpha: 0, duration: 0.14, ease: 'power1.in' }, ${r2(b.start + b.dur - 0.14)});`
  ).join('')

  const hookJs = hook ? `
      tl.fromTo('#hook .hook-box', { scale: 1.25, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.28, ease: 'back.out(2.2)' }, ${r2(hook.start + 0.05)});` : ''

  const capsJs = caps.map((c) => `
      tl.fromTo('#${c.id}', { scale: 1.14 }, { scale: 1, duration: ${r2(Math.min(0.12, c.dur))}, ease: 'power2.out', transformOrigin: '50% 50%' }, ${c.start});`
  ).join('')

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
      .clip { position: absolute; }

      #stage { inset: 0; overflow: hidden; }
      #zoomInner { position: absolute; inset: 0; will-change: transform; }
      #base { width: 100%; height: 100%; object-fit: cover; display: block; }

      .broll { inset: 0; overflow: hidden; }
      .broll img { width: 100%; height: 100%; object-fit: cover; display: block; will-change: transform; }

      /* Hook : bandeau orange en haut (safe zone : sous les 13% du haut) */
      #hook { left: 6%; right: 6%; top: 14.5%; display: flex; justify-content: center; }
      .hook-box {
        background: rgba(255,107,53,.95); color: #fff; text-align: center;
        font: 800 ${Math.round(H * 0.028)}px/1.25 "Arial Black", Arial, sans-serif;
        letter-spacing: .3px; padding: ${Math.round(H * 0.011)}px ${Math.round(H * 0.016)}px;
        border-radius: ${Math.round(H * 0.011)}px; box-shadow: 0 10px 34px rgba(0,0,0,.35);
      }

      /* Sous-titres Punch : un mot, énorme, blanc (ou orange accent), gros contour noir */
      .cap {
        left: 4%; right: 4%; top: ${Math.round(H * 0.72) - Math.round(subSize * 0.75)}px;
        text-align: center; color: #fff;
        font: 900 ${subSize}px/1.1 "Arial Black", Arial, sans-serif;
        letter-spacing: 1px; will-change: transform; z-index: 6;
      }
      .cap::before {
        content: attr(data-text); position: absolute; left: 0; right: 0; top: 0;
        -webkit-text-stroke: ${subStroke * 2}px rgba(0,0,0,.92); z-index: -1;
      }
      .cap.accent { color: #FF6B35; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="montage" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
      <div id="stage" class="clip" data-start="0" data-duration="${D}" data-track-index="1">
        <div id="zoomInner">
          <video id="base" class="clip" src="media/base.mp4" data-start="0" data-duration="${D}" data-track-index="1" muted playsinline></video>
        </div>
      </div>
${brollHtml}
${hookHtml}
${capsHtml}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.set('#zoomInner', { scale: 1 }, 0);
${zoomJs}
${brollJs}
${hookJs}
${capsJs}
      tl.set({}, {}, ${D}); // borne la durée de la timeline
      window.__timelines['montage'] = tl;
    </script>
  </body>
</html>
`
}
