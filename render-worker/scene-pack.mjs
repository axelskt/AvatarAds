// scene-pack.mjs — scènes « éditorial » plein cadre + bandeau, pour build-composition.mjs
//
// Rythmes du montage (le chef d'orchestre alterne) :
//   1. PLEIN ÉCRAN  : la personne seule (zooms, b-roll)
//   2. SPLIT        : vidéo en bas + slide motion design sombre en haut  (types card/flow/checklist/compare/stat)
//   3. PLEIN CADRE  : la vidéo disparaît, une scène éditoriale crème occupe tout l'écran  ← ce fichier
//   4. BANDEAU      : la vidéo reste plein écran, un bandeau titre se pose dessus         ← ce fichier
//
// Contrat plan.json pour une scène plein cadre :
//   { layout: 'full', type: 'nodes'|'loop'|'bars'|'kpi'|'timer'|'versus'|'punch',
//     eyebrow: 'ÉTAPE 01', title: 'LES YEUX', start, end,
//     items: [{ text, t, value? }], value?: '8 750', unit?: 'ABONNÉS GAGNÉS' }
// Contrat pour un bandeau :
//   { layout: 'banner', eyebrow: '...', title: '...', accent: 'MOT', sub: '...', start, end }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = (n) => Math.round(n * 100) / 100
const up = (s) => String(s ?? '').toUpperCase()

export const CREAM = '#F7F5E9'
export const INK = '#16130F'
export const TERRA = '#C2483A'
export const GREEN = '#1FA34A'

export const FULL_TYPES = ['nodes', 'loop', 'bars', 'kpi', 'timer', 'versus', 'punch']

// ── pastille ronde : initiale du libellé (aucune dépendance à un logo externe) ──
const bead = (txt, i = 0) => {
  const ch = up(String(txt || '?').trim()[0] || '?')
  return `<div class="sp-bead"><span>${esc(ch)}</span></div>`
}

// ─────────────────────────────────────────────────────────────────── CSS
export function scenePackCss(W, H) {
  return `
      /* ══ rythme 3 · scène éditoriale plein cadre (fond crème) ══ */
      .fslide { inset: 0; background:
        radial-gradient(${Math.round(W * 1.1)}px ${Math.round(H * 0.47)}px at 50% 18%, #FCFBF3 0%, ${CREAM} 60%, #F0EDDD 100%);
        z-index: 7; will-change: opacity; color: ${INK}; }
      .fs-spec { position: absolute; border-radius: 50%; background: rgba(194,72,58,.16); }
      .fs-hd { position: absolute; left: 60px; right: 60px; top: ${Math.round(H * 0.062)}px; text-align: center; }
      .fs-eye { font: 700 ${Math.round(H * 0.0156)}px/1 "JetBrains Mono", ui-monospace, monospace;
        letter-spacing: 11px; color: ${TERRA}; text-transform: uppercase; will-change: transform, opacity; }
      .fs-t { font: 900 ${Math.round(H * 0.05)}px/0.94 "Archivo Black", "Arial Black", Arial, sans-serif;
        letter-spacing: -2px; margin-top: 26px; text-transform: uppercase;
        text-shadow: 0 5px 0 rgba(0,0,0,.05); will-change: transform, opacity; }
      .fs-t .ar { color: ${TERRA}; }
      .fs-body { position: absolute; left: 40px; right: 40px; top: ${Math.round(H * 0.3)}px;
        bottom: ${Math.round(H * 0.26)}px; display: flex; flex-direction: column;
        align-items: center; justify-content: center; }

      .sp-bead { width: 152px; height: 152px; border-radius: 50%; background: #fff; display: flex;
        align-items: center; justify-content: center; box-shadow: 0 16px 40px rgba(20,16,12,.10); flex: 0 0 auto; }
      .sp-bead span { font: 900 56px/1 "Archivo Black", Arial; color: ${TERRA}; }
      .sp-lbl { margin-top: 20px; font: 900 26px/1.2 "JetBrains Mono", ui-monospace, monospace;
        letter-spacing: 3px; text-align: center; }

      /* nodes — chaîne d'étapes reliées */
      .sp-nodes { display: flex; align-items: flex-start; justify-content: center; width: 100%; }
      .sp-nd { width: 230px; text-align: center; }
      .sp-nd .sp-bead { margin: 0 auto; }
      .sp-nd.dark .sp-bead { background: ${INK}; }
      .sp-nd.dark .sp-bead span { color: #fff; font-size: 34px; }
      .sp-link { position: relative; height: 5px; flex: 1; max-width: 170px; background: ${TERRA};
        margin-top: 74px; will-change: transform; }
      .sp-link::before, .sp-link::after { content: ''; position: absolute; top: -7px; width: 19px; height: 19px;
        border-radius: 50%; background: #fff; border: 4px solid ${TERRA}; }
      .sp-link::before { left: -9px; } .sp-link::after { right: -9px; }

      /* loop — boucle circulaire */
      .sp-loop { position: relative; width: 780px; height: 780px; }
      .sp-loop svg { position: absolute; left: 130px; top: 130px; width: 520px; height: 520px; }
      .sp-loop .sp-c { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
        font: 900 ${Math.round(H * 0.046)}px/1 "Archivo Black", Arial; letter-spacing: -2px; will-change: transform, opacity; }
      .sp-loop .sp-n { position: absolute; left: 50%; top: 50%; width: 220px; margin-left: -110px; text-align: center; }
      .sp-loop .sp-bead { width: 132px; height: 132px; margin: 0 auto; }
      .sp-loop .sp-bead span { font-size: 46px; }
      .sp-loop .sp-lbl { margin-top: 14px; font-size: 24px; }

      /* bars — histogramme */
      .sp-bars { display: flex; align-items: flex-end; justify-content: center; gap: 34px; height: 560px; width: 100%; }
      .sp-bar { width: 132px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
      .sp-bv { font: 900 40px/1 "Archivo Black", Arial; margin-bottom: 16px; will-change: transform, opacity; }
      .sp-bf { width: 100%; border-radius: 18px 18px 6px 6px; background: #D9D6C6; will-change: transform;
        transform-origin: 50% 100%; }
      .sp-bar.hi .sp-bf { background: ${TERRA}; }
      .sp-bar.hi .sp-bv { color: ${TERRA}; }
      .sp-bl { margin-top: 20px; font: 700 24px/1.2 "JetBrains Mono", ui-monospace, monospace;
        letter-spacing: 2px; text-align: center; color: #6F6C64; }

      /* kpi — gros chiffre + courbe */
      .sp-kpi { text-align: center; width: 100%; }
      .sp-kn { font: 900 ${Math.round(H * 0.104)}px/1 "Archivo Black", Arial; letter-spacing: -6px;
        display: inline-block; will-change: transform, opacity; }
      .sp-kup { width: 60px; height: 90px; margin-left: 24px; will-change: transform, opacity; }
      .sp-kl { margin-top: 18px; font: 900 38px/1 "JetBrains Mono", ui-monospace, monospace;
        letter-spacing: 8px; color: #6F6C64; will-change: transform, opacity; }
      .sp-chart { width: 100%; height: 400px; margin-top: 40px; }
      .sp-chart .gl { stroke: rgba(20,16,12,.10); stroke-width: 2; }

      /* timer — chrono */
      .sp-tm { width: 620px; height: 190px; border-radius: 26px; background: #D0685C;
        box-shadow: 0 20px 50px rgba(194,72,58,.28); will-change: transform; }
      .sp-tl { margin-top: 90px; font: 700 32px/1 "JetBrains Mono", ui-monospace, monospace;
        letter-spacing: 12px; color: #6F6C64; }
      .sp-tv { margin-top: 14px; font: 900 ${Math.round(H * 0.06)}px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 2px; }

      /* versus — deux cartes comparées */
      .sp-vs { display: flex; align-items: center; justify-content: center; gap: 24px; width: 100%; }
      .sp-cc { position: relative; width: 430px; background: #fff; border: 4px solid rgba(0,0,0,.08);
        border-radius: 34px; padding: 44px 28px 40px; text-align: center; box-shadow: 0 24px 60px rgba(20,16,12,.12);
        will-change: transform, opacity; }
      .sp-cc .sp-bead { width: 132px; height: 132px; margin: 0 auto 26px; }
      .sp-cc .sp-bead span { font-size: 46px; }
      .sp-ct { font: 900 32px/1.25 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 3px; }
      .sp-cp { margin-top: 40px; font: 900 72px/1 "Archivo Black", Arial; letter-spacing: -2px; }
      .sp-cc.ok .sp-cp { color: ${GREEN}; }
      .sp-cs { margin-top: 14px; font: 700 26px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 6px; color: #8E8B82; }
      .sp-strike { position: absolute; left: 38px; top: 62px; width: 215px; height: 14px; border-radius: 9px;
        background: ${TERRA}; transform: rotate(52deg); transform-origin: 0% 50%; z-index: 3; will-change: transform; }
      .sp-var { width: 96px; height: 44px; flex: 0 0 auto; will-change: transform, opacity; }

      /* punch — une phrase, énorme */
      .sp-punch { font: 900 ${Math.round(H * 0.062)}px/1.06 "Archivo Black", Arial; letter-spacing: -2px;
        text-align: center; text-transform: uppercase; max-width: 92%; will-change: transform, opacity; }
      .sp-punch em { font-style: normal; color: ${TERRA}; }

      /* ══ rythme 4 · bandeau posé sur la vidéo plein écran ══ */
      .fbanner { left: 34px; right: 34px; top: ${Math.round(H * 0.145)}px; background: #100E0C;
        border: 3px solid rgba(255,107,53,.55); border-radius: 34px; padding: 40px 36px 46px; text-align: center;
        box-shadow: 0 30px 80px rgba(0,0,0,.45); z-index: 7; will-change: transform, opacity; }
      .fb-eye { font: 700 25px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 9px; color: #FF6B35;
        will-change: transform, opacity; }
      .fb-t { margin-top: 26px; font: 900 ${Math.round(H * 0.039)}px/1.05 "Archivo Black", Arial;
        color: #fff; letter-spacing: -2px; }
      .fb-t em { font-style: normal; color: #FF6B35; display: inline-block; will-change: transform; }
      .fb-sub { margin-top: 24px; font: 700 34px/1.3 Inter, "Helvetica Neue", Arial; color: rgba(255,255,255,.92);
        will-change: transform, opacity; }`
}

// ────────────────────────────────────────────────────────────── HTML corps
function bodyHtml(s, W, H) {
  const it = s.items || []
  switch (s.type) {
    case 'nodes': {
      const n = it.slice(0, 4)
      return `<div class="sp-nodes">${n.map((x, i) => `${i > 0 ? `<div class="sp-link" id="${s.id}k${i}"></div>` : ''}
        <div class="sp-nd${i === 1 && n.length === 3 ? ' dark' : ''}" id="${x.id}">${bead(x.text, i)}<div class="sp-lbl">${esc(up(x.text))}</div></div>`).join('')}</div>`
    }
    case 'loop': {
      const n = it.slice(0, 4)
      const R = 190, cx = 260, cy = 260, N = Math.max(2, n.length)
      const arcs = n.map((_, i) => {
        const a0 = -90 + (i / N) * 360 + 24, a1 = -90 + ((i + 1) / N) * 360 - 24
        const p = (a) => [r2(cx + R * Math.cos(a * Math.PI / 180)), r2(cy + R * Math.sin(a * Math.PI / 180))]
        const [x0, y0] = p(a0), [x1, y1] = p(a1)
        return `<path class="sp-arc" id="${s.id}a${i}" d="M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}" fill="none" stroke="${TERRA}" stroke-width="6" stroke-linecap="round" marker-end="url(#sp-ah)"/>`
      }).join('')
      const pos = n.map((_, i) => {
        const a = (-90 + (i / N) * 360) * Math.PI / 180
        return [Math.round(Math.cos(a) * 300), Math.round(Math.sin(a) * 300)]
      })
      return `<div class="sp-loop">
        <svg viewBox="0 0 520 520"><defs><marker id="sp-ah" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="${TERRA}"/></marker></defs>${arcs}</svg>
        <div class="sp-c" id="${s.id}c">${esc(up(s.center || 'AUTO'))}</div>
        ${n.map((x, i) => `<div class="sp-n" id="${x.id}" style="transform:translate(${pos[i][0]}px,${pos[i][1] - 66}px)">${bead(x.text, i)}<div class="sp-lbl">${esc(up(x.text))}</div></div>`).join('')}
      </div>`
    }
    case 'bars': {
      const n = it.slice(0, 5)
      const nums = n.map((x) => parseFloat(String(x.value ?? x.text).replace(/[^\d.]/g, '')) || 0)
      const max = Math.max(1, ...nums)
      return `<div class="sp-bars">${n.map((x, i) => `
        <div class="sp-bar${i === nums.indexOf(max) ? ' hi' : ''}" id="${x.id}">
          <div class="sp-bv">${esc(x.value ?? x.text)}</div>
          <div class="sp-bf" style="height:${Math.round(18 + (nums[i] / max) * 78)}%"></div>
          <div class="sp-bl">${esc(up(x.label || x.text))}</div>
        </div>`).join('')}</div>`
    }
    case 'kpi': {
      const v = it[0] || { id: s.id + 'i0', text: s.value || '0' }
      return `<div class="sp-kpi">
        <div><span class="sp-kn" id="${v.id}">${esc(s.value || v.text)}</span><svg class="sp-kup" id="${s.id}up" viewBox="0 0 40 60"><path d="M20 56V10M6 24 20 8l14 16" fill="none" stroke="${GREEN}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="sp-kl">${esc(up(s.unit || v.text || ''))}</div>
        <svg class="sp-chart" viewBox="0 0 900 380" preserveAspectRatio="none">
          <line x1="0" y1="95" x2="900" y2="95" class="gl"/><line x1="0" y1="190" x2="900" y2="190" class="gl"/><line x1="0" y1="285" x2="900" y2="285" class="gl"/>
          <path id="${s.id}ar" d="M20 340 L200 300 L380 250 L560 160 L740 70 L880 30 L880 380 L20 380 Z" fill="${TERRA}" opacity=".14"/>
          <path id="${s.id}ln" d="M20 340 L200 300 L380 250 L560 160 L740 70 L880 30" fill="none" stroke="${TERRA}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
          <circle id="${s.id}hd" cx="20" cy="340" r="15" fill="#fff" stroke="${TERRA}" stroke-width="8"/>
        </svg>
      </div>`
    }
    case 'timer':
      return `<div class="sp-tm" id="${s.id}bar"></div>
        <div class="sp-tl" id="${s.id}tl">${esc(up(s.unit || 'CHRONO'))}</div>
        <div class="sp-tv" id="${s.id}tv">00:00:00</div>`
    case 'versus': {
      const a = it[0] || { id: s.id + 'i0', text: '' }
      const b = it[1] || { id: s.id + 'i1', text: '' }
      return `<div class="sp-vs">
        <div class="sp-cc ko" id="${a.id}"><span class="sp-strike" id="${s.id}st"></span>${bead(a.text)}<div class="sp-ct">${esc(up(a.text))}</div><div class="sp-cp">${esc(a.value || '')}</div><div class="sp-cs">${esc(up(a.label || ''))}</div></div>
        <svg class="sp-var" id="${s.id}ar" viewBox="0 0 90 40"><path d="M4 20h70M60 8l16 12-16 12" fill="none" stroke="${TERRA}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="sp-cc ok" id="${b.id}">${bead(b.text)}<div class="sp-ct">${esc(up(b.text))}</div><div class="sp-cp">${esc(b.value || '')}</div><div class="sp-cs">${esc(up(b.label || ''))}</div></div>
      </div>`
    }
    default: { // punch
      const v = it[0] || { id: s.id + 'i0', text: s.title || '' }
      return `<div class="sp-punch" id="${v.id}">${esc(up(v.text))}</div>`
    }
  }
}

export function fullSlideHtml(s, W, H) {
  const hd = (s.eyebrow || s.title)
    ? `<div class="fs-hd">${s.eyebrow ? `<div class="fs-eye">${esc(up(s.eyebrow))}</div>` : ''}${s.title ? `<div class="fs-t">${esc(up(s.title)).replace(/ \/ /g, '<br>')}</div>` : ''}</div>`
    : ''
  const specs = [[90, 520, 22], [960, 640, 14], [140, 1180, 16], [900, 1320, 20], [60, 880, 12], [1010, 980, 10]]
    .map(([x, y, r]) => `<span class="fs-spec" style="left:${Math.round(x / 1080 * W)}px;top:${Math.round(y / 1920 * H)}px;width:${r}px;height:${r}px"></span>`).join('')
  return `${specs}${hd}<div class="fs-body">${bodyHtml(s, W, H)}</div>`
}

export function bannerHtml(s) {
  return `<div class="fb-eye">${esc(up(s.eyebrow || ''))}</div>
        <div class="fb-t">${esc(up(s.title || '')).replace(/ \/ /g, '<br>').replace(esc(up(s.accent || ' ')), `<em id="${s.id}em">${esc(up(s.accent || ''))}</em>`)}</div>
        ${s.sub ? `<div class="fb-sub">${esc(s.sub)}</div>` : ''}`
}

// ─────────────────────────────────────────────────────────────── timeline
export function fullSlideJs(s, H) {
  const t0 = r2(s.start), end = r2(s.start + s.dur)
  const at = (x) => r2(Math.max(t0 + 0.05, Math.min(end - 0.25, x)))
  const it = s.items || []
  let js = `
      tl.fromTo('#${s.id}', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.22, ease: 'power2.out' }, ${t0});
      tl.to('#${s.id}', { autoAlpha: 0, duration: 0.2, ease: 'power1.in' }, ${r2(end - 0.24)});
      tl.set('#${s.id}', { autoAlpha: 0 }, ${end});`
  if (s.eyebrow) js += `
      tl.fromTo('#${s.id} .fs-eye', { autoAlpha: 0, scaleX: 1.25, transformOrigin: '50% 50%' }, { autoAlpha: 1, scaleX: 1, duration: 0.36, ease: 'power2.out' }, ${at(t0 + 0.08)});`
  if (s.title) js += `
      tl.fromTo('#${s.id} .fs-t', { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.32, ease: 'power3.out' }, ${at(t0 + 0.18)});`

  switch (s.type) {
    case 'nodes':
      it.slice(0, 4).forEach((x, i) => {
        js += `
      tl.fromTo('#${x.id} .sp-bead', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(2.2)' }, ${at(x.t)});
      tl.fromTo('#${x.id} .sp-lbl', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.26, ease: 'power2.out' }, ${at(x.t + 0.14)});`
        if (i > 0) js += `
      tl.fromTo('#${s.id}k${i}', { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: 0.28, ease: 'power2.out' }, ${at(x.t - 0.16)});`
      })
      break
    case 'loop':
      it.slice(0, 4).forEach((x, i) => {
        js += `
      tl.fromTo('#${x.id} .sp-bead', { scale: 0 }, { scale: 1, duration: 0.34, ease: 'back.out(2.4)' }, ${at(x.t)});
      tl.fromTo('#${x.id} .sp-lbl', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.22, ease: 'power2.out' }, ${at(x.t + 0.12)});
      (function(){ var p = document.querySelector('#${s.id}a${i}'); if (p) { p.style.strokeDasharray = 300;
        tl.fromTo(p, { strokeDashoffset: 300 }, { strokeDashoffset: 0, duration: 0.32, ease: 'power2.out' }, ${at(x.t + 0.14)}); } })();`
      })
      js += `
      tl.fromTo('#${s.id}c', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.42, ease: 'back.out(2.2)' }, ${at((it[it.length - 1] || { t: t0 }).t + 0.3)});`
      break
    case 'bars':
      it.slice(0, 5).forEach((x) => {
        js += `
      tl.fromTo('#${x.id} .sp-bf', { scaleY: 0 }, { scaleY: 1, duration: 0.42, ease: 'power3.out' }, ${at(x.t)});
      tl.fromTo('#${x.id} .sp-bv', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.28, ease: 'back.out(2)' }, ${at(x.t + 0.16)});
      tl.fromTo('#${x.id} .sp-bl', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.24, ease: 'power2.out' }, ${at(x.t + 0.1)});`
      })
      break
    case 'kpi': {
      const v = it[0] || { id: s.id + 'i0', text: s.value || '0' }
      const t = at(v.t ?? t0 + 0.3)
      const num = parseInt(String(s.value || v.text).replace(/[^\d]/g, ''), 10)
      js += `
      tl.fromTo('#${v.id}', { scale: 0.5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.42, ease: 'back.out(1.9)' }, ${t});
      tl.fromTo('#${s.id}up', { scale: 0, y: 26 }, { scale: 1, y: 0, duration: 0.4, ease: 'back.out(3)' }, ${at(t + 0.45)});
      tl.fromTo('#${s.id} .sp-kl', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.28, ease: 'power2.out' }, ${at(t + 0.55)});
      (function(){ var p = document.querySelector('#${s.id}ln'); if (p) { p.style.strokeDasharray = 1200;
        tl.fromTo(p, { strokeDashoffset: 1200 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut' }, ${at(t + 0.6)}); } })();
      tl.fromTo('#${s.id}ar', { autoAlpha: 0, scaleY: 0.4, transformOrigin: '50% 100%' }, { autoAlpha: 1, scaleY: 1, duration: 1.05, ease: 'power2.inOut' }, ${at(t + 0.62)});
      tl.fromTo('#${s.id}hd', { attr: { cx: 20, cy: 340 } }, { attr: { cx: 880, cy: 30 }, duration: 1.1, ease: 'power2.inOut' }, ${at(t + 0.6)});`
      if (Number.isFinite(num) && num > 0) js += `
      (function(){ var o = { v: 0 }, el = document.querySelector('#${v.id}');
        tl.to(o, { v: ${num}, duration: 1, ease: 'power2.out', onUpdate: function(){ el.textContent = Math.round(o.v).toLocaleString('fr-FR').replace(/\\u202f|,/g, ' '); } }, ${t}); })();`
      break
    }
    case 'timer': {
      const t = at(t0 + 0.35)
      const secs = Math.max(1, Math.min(99, parseInt(String(s.value || '55').replace(/[^\d]/g, ''), 10) || 55))
      js += `
      tl.fromTo('#${s.id}bar', { autoAlpha: 0, y: 20, scaleX: 1 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'back.out(1.6)' }, ${at(t - 0.1)});
      tl.to('#${s.id}bar', { scaleX: 0.52, duration: 1.4, ease: 'power2.inOut' }, ${t});
      tl.fromTo(['#${s.id}tl', '#${s.id}tv'], { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.26, ease: 'power2.out', stagger: 0.08 }, ${t});
      (function(){ var o = { v: 0 }, el = document.querySelector('#${s.id}tv'), p = function(n){ return String(Math.floor(n)).padStart(2, '0'); };
        tl.to(o, { v: ${secs}.93, duration: 1.5, ease: 'power1.out', onUpdate: function(){ el.textContent = '00:' + p(o.v) + ':' + p((o.v % 1) * 100); } }, ${t}); })();`
      break
    }
    case 'versus': {
      const a = it[0], b = it[1]
      if (a) js += `
      tl.fromTo('#${a.id}', { autoAlpha: 0, y: 30, scale: 0.95 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.36, ease: 'back.out(1.5)' }, ${at(a.t)});
      tl.fromTo('#${s.id}st', { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: 0.3, ease: 'power3.out' }, ${at(a.t + 0.7)});`
      if (b) js += `
      tl.fromTo('#${b.id}', { autoAlpha: 0, y: 30, scale: 0.95 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.36, ease: 'back.out(1.5)' }, ${at(b.t)});
      tl.fromTo('#${s.id}ar', { autoAlpha: 0, scaleX: 0, transformOrigin: '0% 50%' }, { autoAlpha: 1, scaleX: 1, duration: 0.28, ease: 'power2.out' }, ${at(b.t + 0.2)});
      tl.fromTo('#${b.id}', { borderColor: 'rgba(0,0,0,.08)' }, { borderColor: '${GREEN}', duration: 0.3 }, ${at(b.t + 0.75)});
      tl.fromTo('#${b.id} .sp-cp', { scale: 1.16 }, { scale: 1, duration: 0.32, ease: 'back.out(3)' }, ${at(b.t + 0.75)});`
      break
    }
    default: {
      const v = it[0] || { id: s.id + 'i0', t: t0 + 0.3 }
      js += `
      tl.fromTo('#${v.id}', { scale: 0.8, autoAlpha: 0, y: 20 }, { scale: 1, autoAlpha: 1, y: 0, duration: 0.36, ease: 'back.out(2)' }, ${at(v.t)});`
    }
  }
  return js
}

export function bannerJs(s) {
  const t0 = r2(s.start), end = r2(s.start + s.dur)
  return `
      tl.fromTo('#${s.id}', { autoAlpha: 0, y: 30, scale: 0.94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: 'back.out(1.5)' }, ${t0});
      tl.fromTo('#${s.id} .fb-eye', { autoAlpha: 0, scaleX: 1.2, transformOrigin: '50% 50%' }, { autoAlpha: 1, scaleX: 1, duration: 0.36, ease: 'power2.out' }, ${r2(t0 + 0.18)});
      tl.fromTo('#${s.id} .fb-sub', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out' }, ${r2(t0 + 0.42)});
      ${s.accent ? `tl.fromTo('#${s.id}em', { scale: 1.18 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, ${r2(t0 + 0.5)});` : ''}
      tl.to('#${s.id}', { autoAlpha: 0, y: -18, duration: 0.24, ease: 'power1.in' }, ${r2(end - 0.28)});
      tl.set('#${s.id}', { autoAlpha: 0 }, ${end});`
}
