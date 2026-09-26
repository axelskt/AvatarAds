// propositions.mjs — 5 NOUVEAUX styles de sous-titres pensés pour les hooks TikTok / Reels (26/09), en
// compositions HyperFrames (même contrat que render-worker/build-composition.mjs : #root « montage »,
// <video class="clip" src="media/base.mp4">, timeline GSAP en pause dans window.__timelines['montage'],
// uniquement autoAlpha / transforms / set → seek-safe). Ce ne sont PAS encore des styles d'un moteur :
// ce sont des maquettes animées, pour qu'Axel choisisse lesquels porter dans le render-worker.
//
//   surligneur    · mots blancs Poppins, un marqueur jaune passe SOUS chaque mot fort au moment où il est dit
//   boite-blanche · le « texte avec fond » natif de TikTok : une boîte blanche par ligne, texte noir, mot fort rouge
//   contour-xxl   · 1-2 mots géants, remplissage blanc, contour épais de couleur + ombre pleine décalée
//   aplat         · sous-titres discrets + le mot fort qui CLAQUE en capitales noires sur un bloc de couleur
//   affiche       · la phrase s'imprime en pages de 2 lignes justifiées (typo choc), un mot à la fois, sous le menton
import { fontFaceCss, SAFE } from '../../render-worker/visual-styles.mjs'

const W = 1080, H = 1920
const r2 = (n) => Math.round(n * 100) / 100
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const UP = (s) => String(s).toUpperCase()
const noPunct = (s) => String(s).replace(/[.,!?;:]+$/, '')

// ── squelette commun ─────────────────────────────────────────────────────────
function doc({ D, css, body, js, pre = '' }) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
${fontFaceCss()}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; background: #000; overflow: hidden; }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
      #base { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; object-fit: cover; display: block; }
      .clip { position: absolute; }
${css}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="montage" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
      <video id="base" class="clip" src="media/base.mp4" data-start="0" data-duration="${D}" data-track-index="1" muted playsinline></video>
${body}
    </div>
    <!-- amorce : les polices sont chargées avant la première capture -->
    <div aria-hidden="true" style="position:absolute;left:-9999px;top:-9999px;opacity:0">
      <span style="font-family:'Poppins';font-weight:800">Éàç</span><span style="font-family:'Inter';font-weight:800">Éàç</span>
      <span style="font-family:'Montserrat';font-weight:900">Éàç</span><span style="font-family:'Anton'">Éàç</span>
    </div>
    <script>
${pre}
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${js}
      tl.set({}, {}, ${D});
      window.__timelines['montage'] = tl;
    </script>
  </body>
</html>
`
}

// groupes : un nouveau groupe tous les `n` mots ou après une fin de phrase ; chaque groupe tient jusqu'au suivant
function groups(words, n, D) {
  const g = []
  for (const w of words) {
    const last = g[g.length - 1]
    if (!last || last.w.length >= n || /[.!?]$/.test(last.w[last.w.length - 1].text)) g.push({ w: [w] })
    else last.w.push(w)
  }
  g.forEach((x, i) => {
    x.a = r2(Math.max(0, x.w[0].start - 0.06))
    x.b = r2(g[i + 1] ? g[i + 1].w[0].start - 0.06 : D)
  })
  return g
}

// ── 1 · SURLIGNEUR ───────────────────────────────────────────────────────────
function surligneur({ D, words, isAccent }) {
  const G = groups(words, 4, D)
  const fs = 88
  const top = Math.round(H * 0.625)
  const css = `
      .sl { left: ${Math.round(W * 0.08)}px; width: ${Math.round(W * 0.84)}px; top: ${top}px; text-align: center; z-index: 5; }
      .sl-l { display: inline; font-family: 'Poppins', sans-serif; font-weight: 800; font-size: ${fs}px; line-height: 1.22;
        letter-spacing: -.02em; color: #fff; }
      .sl-w { position: relative; display: inline-block; margin: 0 .15em; opacity: 0;
        text-shadow: 0 4px 14px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.5); }
      .sl-w i { font-style: normal; position: relative; z-index: 2; }
      /* le marqueur : bande jaune inclinée, un peu débordante, qui se déroule de gauche à droite */
      .sl-m { position: absolute; left: -.1em; right: -.1em; top: .22em; bottom: .04em; z-index: 1;
        background: #FFE14A; border-radius: .08em .3em .12em .34em; transform: skewX(-12deg) rotate(-2.2deg) scaleX(0);
        transform-origin: 0% 50%; box-shadow: 0 6px 18px rgba(0,0,0,.28); }
      .sl-w.acc { text-shadow: none; }`
  let body = '', js = ''
  G.forEach((g, gi) => {
    body += `      <div class="clip sl" id="sl${gi}" data-start="${g.a}" data-duration="${r2(g.b - g.a)}" data-track-index="5"><span class="sl-l">`
      + g.w.map((w, k) => `<span class="sl-w${isAccent(w.text) ? ' acc' : ''}" id="sl${gi}w${k}">${isAccent(w.text) ? '<span class="sl-m"></span>' : ''}<i>${esc(w.text)}</i></span>`).join('')
      + `</span></div>\n`
    g.w.forEach((w, k) => {
      const id = `#sl${gi}w${k}`
      js += `      tl.fromTo('${id}', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.14, ease: 'power3.out' }, ${r2(w.start)});\n`
      if (isAccent(w.text)) {
        js += `      tl.fromTo('${id} .sl-m', { scaleX: 0 }, { scaleX: 1, duration: 0.24, ease: 'power2.out' }, ${r2(w.start + 0.04)});\n`
        js += `      tl.fromTo('${id} i', { color: '#FFFFFF' }, { color: '#111111', duration: 0.1, ease: 'none' }, ${r2(w.start + 0.12)});\n`
      }
    })
  })
  return doc({ D, css, body, js })
}

// ── 2 · BOÎTE BLANCHE (texte natif TikTok) ──────────────────────────────────
function boiteBlanche({ D, words, isAccent }) {
  // 3 lignes en escalier, comme un texte posé à la main dans TikTok
  const L = [[0, 3], [3, 6], [6, 8]].map(([a, b]) => words.slice(a, b))
  const fs = 66
  const top = Math.round(H * 0.585)
  const css = `
      .bb { left: 0; width: ${W}px; top: ${top}px; text-align: center; z-index: 5; }
      .bb-l { display: block; line-height: 1; margin-top: -${Math.round(fs * 0.1)}px; }
      .bb-box { display: inline-block; background: #FFFFFF; border-radius: ${Math.round(fs * 0.24)}px; padding: ${Math.round(fs * 0.2)}px ${Math.round(fs * 0.34)}px ${Math.round(fs * 0.24)}px;
        font-family: 'Inter', sans-serif; font-weight: 800; font-size: ${fs}px; letter-spacing: -.02em; color: #121212;
        box-shadow: 0 10px 28px rgba(0,0,0,.18); transform-origin: 50% 50%; }
      .bb-box span { display: none; }
      .bb-box span.acc { color: #FE2C55; }`
  let body = `      <div class="clip bb" id="bb" data-start="${r2(Math.max(0, words[0].start - 0.06))}" data-duration="${r2(D - Math.max(0, words[0].start - 0.06))}" data-track-index="5">\n`
  let js = ''
  L.forEach((line, li) => {
    body += `        <div class="bb-l"><span class="bb-box" id="bb${li}" style="visibility:hidden">`
      + line.map((w, k) => `<span id="bb${li}w${k}"${isAccent(w.text) ? ' class="acc"' : ''}>${esc(w.text)}${k < line.length - 1 ? ' ' : ''}</span>`).join('')
      + `</span></div>\n`
    line.forEach((w, k) => {
      const t = r2(w.start)
      if (k === 0) {
        js += `      tl.set('#bb${li}', { visibility: 'visible' }, ${t});\n`
        js += `      tl.fromTo('#bb${li}', { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.16, ease: 'back.out(2.2)' }, ${t});\n`
      } else {
        js += `      tl.fromTo('#bb${li}', { scale: 1.06 }, { scale: 1, duration: 0.12, ease: 'power2.out', immediateRender: false }, ${t});\n`
      }
      js += `      tl.set('#bb${li}w${k}', { display: 'inline' }, ${t});\n`
    })
  })
  body += '      </div>\n'
  return doc({ D, css, body, js })
}

// ── 3 · CONTOUR XXL COULEUR ──────────────────────────────────────────────────
function contourXxl({ D, words, isAccent }) {
  // 1 à 2 mots par écran, jamais plus de 9 lettres de large
  const G = []
  for (const w of words) {
    const last = G[G.length - 1]
    const len = (x) => x.map((y) => noPunct(y.text)).join(' ').length
    if (last && last.w.length < 2 && len([...last.w, w]) <= 9 && !isAccent(w.text) && !isAccent(last.w[0].text)) last.w.push(w)
    else G.push({ w: [w] })
  }
  G.forEach((g, i) => { g.a = r2(Math.max(0, g.w[0].start - 0.04)); g.b = r2(G[i + 1] ? G[i + 1].w[0].start - 0.04 : D) })
  const COLS = ['#B8FF2E', '#FF3D9A', '#27D7F2', '#FF8A1F', '#B8FF2E', '#FF3D9A', '#27D7F2']
  const maxW = W * 0.8
  const css = `
      .cx { left: 0; width: ${W}px; top: ${Math.round(H * 0.6)}px; height: ${Math.round(H * 0.14)}px; display: flex; align-items: center; justify-content: center; z-index: 5; }
      .cx-t { display: inline-block; font-family: 'Montserrat', sans-serif; font-weight: 900; text-transform: uppercase;
        letter-spacing: -.02em; line-height: 1; color: #FFFFFF; paint-order: stroke fill; white-space: nowrap; }`
  let body = '', js = ''
  G.forEach((g, gi) => {
    const txt = g.w.map((w) => UP(noPunct(w.text))).join(' ')
    const fs = Math.round(Math.min(190, maxW / (0.74 * Math.max(3, txt.length))))
    const col = COLS[gi % COLS.length]
    const acc = g.w.some((w) => isAccent(w.text))
    const stroke = Math.round(fs * 0.19)
    const fill = acc ? col : '#FFFFFF'
    const strokeCol = acc ? '#FFFFFF' : col
    body += `      <div class="clip cx" id="cx${gi}" data-start="${g.a}" data-duration="${r2(g.b - g.a)}" data-track-index="5"><span class="cx-t" id="cx${gi}t" style="font-size:${fs}px;color:${fill};-webkit-text-stroke:${stroke}px ${strokeCol};text-shadow:${Math.round(fs * 0.06)}px ${Math.round(fs * 0.07)}px 0 #0B0B0F">${esc(txt)}</span></div>\n`
    js += `      tl.fromTo('#cx${gi}t', { scale: 0.45, rotation: ${gi % 2 ? 4 : -4}, autoAlpha: 0 }, { scale: 1, rotation: ${gi % 2 ? -1.5 : 1.5}, autoAlpha: 1, duration: 0.16, ease: 'back.out(2.6)' }, ${g.a});\n`
    js += `      tl.to('#cx${gi}t', { scale: 1.05, duration: ${r2(Math.max(0.2, g.b - g.a - 0.16))}, ease: 'sine.out' }, ${r2(g.a + 0.16)});\n`
  })
  return doc({ D, css, body, js })
}

// ── 4 · MOT-CLÉ SUR APLAT ────────────────────────────────────────────────────
function aplat({ D, words, isAccent }) {
  // sous-titres discrets (groupes de 3) + blocs : chaque suite de mots forts consécutifs = un bloc
  const G = groups(words, 3, D)
  const blocks = []
  words.forEach((w, i) => {
    if (!isAccent(w.text)) return
    const prev = blocks[blocks.length - 1]
    if (prev && prev.last === i - 1) { prev.w.push(w); prev.last = i } else blocks.push({ w: [w], last: i })
  })
  const BG = ['#FF5A36', '#FFE14A', '#27D7F2']
  blocks.forEach((b) => { b.a = r2(b.w[0].start) })
  blocks.forEach((b, i) => {
    const nxt = blocks[i + 1]
    b.b = r2(nxt ? nxt.a - 0.02 : D)
    // un bloc s'efface après ~1,1 s si aucun autre mot fort n'arrive
    if (nxt && b.b - (b.w[b.w.length - 1].end) > 0.4) b.b = r2(Math.min(b.b, b.w[b.w.length - 1].end + 0.55))
  })
  const css = `
      .ap-sub { left: ${Math.round(W * 0.08)}px; width: ${Math.round(W * 0.84)}px; top: ${Math.round(H * 0.745)}px; text-align: center; z-index: 5;
        font-family: 'Inter', sans-serif; font-weight: 800; font-size: 56px; letter-spacing: -.02em; color: #fff;
        text-shadow: 0 3px 10px rgba(0,0,0,.6), 0 1px 2px rgba(0,0,0,.6); }
      .ap-sub span { display: inline-block; margin: 0 .12em; opacity: 0; }
      .ap-blk { left: 0; width: ${W}px; top: ${Math.round(H * 0.535)}px; height: ${Math.round(H * 0.2)}px; display: flex; align-items: center; justify-content: center; z-index: 6; }
      .ap-in { display: flex; flex-direction: column; align-items: center; padding: 18px 44px 10px; transform: rotate(-3deg);
        box-shadow: 0 22px 50px rgba(0,0,0,.35); }
      .ap-in b { display: block; font-family: 'Anton', sans-serif; font-weight: 400; text-transform: uppercase; color: #0B0B0F;
        line-height: .94; letter-spacing: .01em; }`
  let body = '', js = ''
  G.forEach((g, gi) => {
    body += `      <div class="clip ap-sub" id="as${gi}" data-start="${g.a}" data-duration="${r2(g.b - g.a)}" data-track-index="5">`
      + g.w.map((w, k) => `<span id="as${gi}w${k}"${isAccent(w.text) ? ` style="color:${BG[blocks.findIndex((b) => b.w.includes(w)) % BG.length]}"` : ''}>${esc(w.text)}</span>`).join('')
      + `</div>\n`
    g.w.forEach((w, k) => { js += `      tl.fromTo('#as${gi}w${k}', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.12, ease: 'power2.out' }, ${r2(w.start)});\n` })
  })
  blocks.forEach((b, bi) => {
    const bg = BG[bi % BG.length]
    const big = b.w.length > 1 ? 168 : 250
    body += `      <div class="clip ap-blk" id="ab${bi}" data-start="${b.a}" data-duration="${r2(b.b - b.a)}" data-track-index="6"><div class="ap-in" id="ab${bi}i" style="background:${bg}">`
      + b.w.map((w, k) => `<b id="ab${bi}w${k}" style="font-size:${k === 0 ? big : Math.round(big * 0.62)}px${k ? ';display:none' : ''}">${esc(UP(noPunct(w.text)))}</b>`).join('')
      + `</div></div>\n`
    js += `      tl.fromTo('#ab${bi}i', { scale: 1.6, rotation: -9, autoAlpha: 0 }, { scale: 1, rotation: -3, autoAlpha: 1, duration: 0.14, ease: 'power4.out' }, ${b.a});\n`
    js += `      tl.fromTo('#ab${bi}i', { x: -10 }, { x: 0, duration: 0.18, ease: 'elastic.out(1.2,0.35)', immediateRender: false }, ${r2(b.a + 0.14)});\n`
    b.w.slice(1).forEach((w, k) => {
      js += `      tl.set('#ab${bi}w${k + 1}', { display: 'block' }, ${r2(w.start)});\n`
      js += `      tl.fromTo('#ab${bi}i', { scale: 1.1 }, { scale: 1, duration: 0.14, ease: 'back.out(2)', immediateRender: false }, ${r2(w.start)});\n`
    })
  })
  return doc({ D, css, body, js })
}

// ── 5 · AFFICHE CHOC (typo empilée) ──────────────────────────────────────────
// La phrase s'imprime en « pages » de 2 lignes justifiées (chaque ligne remplit la même largeur, la taille suit),
// posées SOUS le menton : jamais sur la bouche (règle d'Axel du 22/08). La 2e ligne de chaque page est en contour.
function affiche({ D, words, isAccent }) {
  const PAGES = [[[0, 2], [2, 5]], [[5, 7], [7, 8]]].map((pg) => pg.map(([a, b]) => words.slice(a, b)))
  const width = Math.round(W * 0.66)
  // Anton capitales ≈ 0,47 em par signe (espace ≈ 0,22 em)
  const emOf = (line) => {
    const t = line.map((w) => UP(noPunct(w.text)))
    return t.reduce((a, x) => a + x.length * 0.47, 0) + (t.length - 1) * 0.22
  }
  const fsOf = (line) => Math.round(Math.min(196, width / emOf(line)))
  const bottom = Math.round(H * (1 - SAFE.bottom) - 16)
  const css = `
      .af-scrim { left: 0; top: ${Math.round(H * 0.5)}px; width: ${W}px; height: ${Math.round(H * 0.5)}px; z-index: 4;
        background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.45) 38%, rgba(0,0,0,.6) 100%); }
      .af { left: ${Math.round((W - width) / 2)}px; width: ${width}px; z-index: 5; }
      .af-l { display: flex; justify-content: center; gap: .22em; align-items: baseline; font-family: 'Anton', sans-serif; font-weight: 400;
        text-transform: uppercase; line-height: .9; letter-spacing: .005em; color: #FFFFFF; white-space: nowrap; }
      .af-l span { display: inline-block; opacity: 0; }
      .af-l span.acc { color: #FFD60A; }
      .af-l.out span:not(.acc) { color: transparent; -webkit-text-stroke: 3px #FFFFFF; }`
  let body = `      <div class="clip af-scrim" id="afs" data-start="0" data-duration="${D}" data-track-index="3"></div>\n`
  let js = `      tl.fromTo('#afs', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: 'power1.out' }, 0);\n`
  PAGES.forEach((pg, pi) => {
    const a = r2(Math.max(0, pg[0][0].start - 0.06))
    const b = r2(PAGES[pi + 1] ? PAGES[pi + 1][0][0].start - 0.04 : D)
    const sizes = pg.map(fsOf)
    const top = Math.round(bottom - sizes.reduce((x, y) => x + y * 0.9, 0))
    body += `      <div class="clip af" id="af${pi}" data-start="${a}" data-duration="${r2(b - a)}" data-track-index="5" style="top:${top}px">\n`
    pg.forEach((line, li) => {
      body += `        <div class="af-l${li === 1 ? ' out' : ''}" style="font-size:${sizes[li]}px">`
        + line.map((w, k) => `<span id="af${pi}l${li}w${k}"${isAccent(w.text) ? ' class="acc"' : ''}>${esc(UP(noPunct(w.text)))}</span>`).join('')
        + `</div>\n`
      line.forEach((w, k) => {
        js += `      tl.fromTo('#af${pi}l${li}w${k}', { autoAlpha: 0, scale: 1.35, y: -18 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.09, ease: 'power4.out', transformOrigin: '50% 90%' }, ${r2(w.start)});\n`
      })
    })
    body += '      </div>\n'
    js += `      tl.fromTo('#af${pi}', { scale: 1 }, { scale: 1.03, duration: ${r2(b - a)}, ease: 'none', transformOrigin: '50% 100%' }, ${a});\n`
  })
  // largeur réelle d'Anton mesurée au canvas (indépendant de la visibilité des clips), une fois la police chargée :
  // chaque ligne prend la taille qui remplit exactement la largeur (plafond 190 px), la page se cale sur le bas
  const pre = `
      (function () {
        var WID = ${width}, CAP = 190, BOTTOM = ${bottom};
        var cv = document.createElement('canvas').getContext('2d');
        function fit() {
          cv.font = "400 100px Anton";
          var boxes = document.querySelectorAll('.af');
          for (var i = 0; i < boxes.length; i++) {
            var lines = boxes[i].querySelectorAll('.af-l'), tot = 0;
            for (var j = 0; j < lines.length; j++) {
              var sp = lines[j].querySelectorAll('span'), w = 22 * (sp.length - 1);
              for (var k = 0; k < sp.length; k++) w += cv.measureText(sp[k].textContent).width;
              var fs = Math.min(CAP, Math.floor(100 * WID / w));
              lines[j].style.fontSize = fs + 'px'; tot += fs * 0.9;
            }
            boxes[i].style.top = Math.round(BOTTOM - tot) + 'px';
          }
        }
        fit();
        if (document.fonts && document.fonts.load) document.fonts.load("400 100px Anton").then(fit).catch(function () {});
      })();`
  return doc({ D, css, body, js, pre })
}

const BUILDERS = { surligneur, 'boite-blanche': boiteBlanche, 'contour-xxl': contourXxl, aplat, affiche }
export function buildProposal(value, ctx) {
  const b = BUILDERS[value]
  if (!b) throw new Error('proposition inconnue : ' + value)
  return b(ctx)
}
