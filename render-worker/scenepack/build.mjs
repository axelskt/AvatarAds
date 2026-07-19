// build.mjs — prototype « pack de scènes éditorial » (style reels sophiene.ia)
// Génère index.html (composition HyperFrames 1080×1920) → npx hyperframes render
import { writeFileSync } from 'node:fs'

const W = 1080, H = 1920
const INK = '#16130F'
const ACC = '#C2483A'          // terracotta
const CREAM = '#F7F5E9'
const r2 = (n) => Math.round(n * 100) / 100

// ─────────────────────────────────────────────────────────────── icônes SVG
const icoClaude = (c = ACC) => `<svg viewBox="0 0 100 100" class="ic">${
  Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2
    const r1 = 12, r2_ = i % 2 ? 40 : 46
    return `<line x1="${50 + Math.cos(a) * r1}" y1="${50 + Math.sin(a) * r1}" x2="${50 + Math.cos(a) * r2_}" y2="${50 + Math.sin(a) * r2_}" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`
  }).join('')}</svg>`

const icoInsta = `<svg viewBox="0 0 100 100" class="ic"><defs><linearGradient id="ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".7" stop-color="#D62976"/><stop offset="1" stop-color="#962FBF"/></linearGradient></defs><rect x="16" y="16" width="68" height="68" rx="20" fill="none" stroke="url(#ig)" stroke-width="8"/><circle cx="50" cy="50" r="17" fill="none" stroke="url(#ig)" stroke-width="8"/><circle cx="70" cy="30" r="5" fill="url(#ig)"/></svg>`

const icoTiktok = `<svg viewBox="0 0 100 100" class="ic"><path d="M58 18v34a14 14 0 1 1-12-13.9" fill="none" stroke="#111" stroke-width="9" stroke-linecap="round"/><path d="M58 18c2 9 9 15 18 16" fill="none" stroke="#111" stroke-width="9" stroke-linecap="round"/></svg>`

const icoFb = `<svg viewBox="0 0 100 100" class="ic"><circle cx="50" cy="50" r="34" fill="#1877F2"/><path d="M56 34h7v-11h-9c-9 0-14 5-14 14v8h-8v12h8v20h12V57h9l2-12h-11v-6c0-3 1-5 4-5z" fill="#fff"/></svg>`

const icoCal = `<svg viewBox="0 0 100 100" class="ic"><rect x="18" y="24" width="64" height="58" rx="8" fill="#fff" stroke="#111" stroke-width="6"/><rect x="18" y="24" width="64" height="16" rx="8" fill="${ACC}"/><line x1="34" y1="16" x2="34" y2="30" stroke="#111" stroke-width="7" stroke-linecap="round"/><line x1="66" y1="16" x2="66" y2="30" stroke="#111" stroke-width="7" stroke-linecap="round"/><text x="50" y="70" font-size="26" font-weight="900" text-anchor="middle" fill="#111" font-family="Arial Black">17</text></svg>`

const icoUser = `<svg viewBox="0 0 100 100" class="ic"><circle cx="50" cy="38" r="16" fill="#9BB0C4"/><path d="M20 82c4-18 15-26 30-26s26 8 30 26z" fill="#9BB0C4"/></svg>`

// ─────────────────────────────────────────────────────── en-tête éditorial
const head = (eyebrow, title) => `
      <div class="hd">
        <div class="eyebrow">${eyebrow}</div>
        <h1 class="title">${title}</h1>
      </div>`

// ────────────────────────────────────────────────────────────────── scènes
const SCENES = [
  // 1 · bandeau titre (posé sur la face cam dans le vrai montage)
  { id: 'banner', start: 0, dur: 3.4, html: `
      <div class="bn">
        <div class="bn-eye"><span class="dot"></span> SYSTÈME COMPLET · IA + INSTAGRAM</div>
        <div class="bn-logos"><span class="lg" id="bn-l1">${icoClaude()}</span><span class="plus" id="bn-p">+</span><span class="lg" id="bn-l2">${icoInsta}</span></div>
        <div class="bn-t"><span class="w">J'AI BRANCHÉ CLAUDE</span><br><span class="w">SUR <em>INSTAGRAM</em></span></div>
        <div class="bn-sub">+10 000 abonnés en 30 jours · 100 % organique</div>
      </div>`,
    js: (t) => `
      tl.fromTo('#s0 .bn', { scale: .92, autoAlpha: 0, y: 30 }, { scale: 1, autoAlpha: 1, y: 0, duration: .42, ease: 'back.out(1.5)' }, ${t});
      tl.fromTo('#s0 .bn-eye', { autoAlpha: 0, scaleX: 1.2, transformOrigin: '50% 50%' }, { autoAlpha: 1, scaleX: 1, duration: .4, ease: 'power2.out' }, ${t + 0.18});
      tl.fromTo(['#bn-l1', '#bn-l2'], { scale: 0 }, { scale: 1, duration: .42, ease: 'back.out(2.4)', stagger: .12 }, ${t + 0.3});
      tl.fromTo('#bn-p', { scale: 0, rotate: -90 }, { scale: 1, rotate: 0, duration: .34, ease: 'back.out(3)' }, ${t + 0.46});
      tl.fromTo('#s0 .bn-t .w', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: .34, ease: 'power3.out', stagger: .1 }, ${t + 0.5});
      tl.fromTo('#s0 .bn-t em', { color: '#fff' }, { color: '#FF6B35', duration: .01 }, ${t + 0.86});
      tl.fromTo('#s0 .bn-t em', { scale: 1.18 }, { scale: 1, duration: .3, ease: 'back.out(3)' }, ${t + 0.86});
      tl.fromTo('#s0 .bn-sub', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: .3, ease: 'power2.out' }, ${t + 0.92});` },

  // 2 · schéma de nœuds
  { id: 'nodes', start: 3.4, dur: 3.4, html: `${head('ÉTAPE 01', 'LES YEUX')}
      <div class="nodes">
        <div class="nd" id="nd1"><div class="circle white">${icoClaude()}</div><div class="nd-l">CLAUDE</div></div>
        <div class="link" id="lk1"><span class="lk-d"></span><span class="lk-d r"></span></div>
        <div class="nd" id="nd2"><div class="circle black"><span class="nd-mcp">MCP</span></div><div class="nd-l">MCP</div></div>
        <div class="link" id="lk2"><span class="lk-d"></span><span class="lk-d r"></span></div>
        <div class="nd" id="nd3"><div class="circle white">${icoInsta}</div><div class="nd-l">GRAPH API</div></div>
      </div>`,
    js: (t) => `
      tl.fromTo(['#nd1 .circle', '#nd2 .circle', '#nd3 .circle'], { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: .4, ease: 'back.out(2.2)', stagger: .22 }, ${t + 0.3});
      tl.fromTo(['#lk1', '#lk2'], { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: .3, ease: 'power2.out', stagger: .22 }, ${t + 0.52});
      tl.fromTo('.nd-l', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: .28, ease: 'power2.out', stagger: .18 }, ${t + 0.62});
      tl.fromTo('#nd2 .circle', { boxShadow: '0 0 0 0 rgba(194,72,58,0)' }, { boxShadow: '0 0 0 22px rgba(194,72,58,.12)', duration: .5, ease: 'power2.out', repeat: 2, yoyo: true }, ${t + 1.1});` },

  // 3 · grille scannée + panneau de détection
  { id: 'scan', start: 6.8, dur: 4.0, html: `${head('SCRAPING AUTO', "L'IA SCRAPE<br>TA NICHE")}
      <div class="scanwrap">
        <div class="grid">
          ${Array.from({ length: 9 }, (_, i) => `<div class="gc${i === 0 || i === 4 ? ' hit' : ''}" id="gc${i}"><span class="gc-a"></span><span class="gc-b"></span><span class="gc-c"></span>${i === 0 || i === 4 ? '<span class="gc-ck">✓</span>' : ''}</div>`).join('')}
          <div class="scanline" id="scanline"></div>
        </div>
        <div class="panel">
          <div class="pn-h"><span class="pn-ic">${icoCal}</span><span class="pn-t">HOOKS<br>DÉTECTÉS</span></div>
          <div class="pn-row" id="pr0"><b>HOOK #01</b> <i>✓</i> <span>VIRAL</span></div>
          <div class="pn-row" id="pr1"><b>HOOK #02</b> <i>✓</i> <span>VIRAL</span></div>
          <div class="pn-row" id="pr2"><b>HOOK #03</b> <i>✓</i> <span>VIRAL</span></div>
        </div>
      </div>
      <div class="counter"><span class="ct-n" id="ctn">0</span><span class="ct-l">HOOKS EXTRAITS</span><span class="ct-u" id="ctu"></span></div>`,
    js: (t) => `
      tl.fromTo('.gc', { autoAlpha: 0, scale: .9 }, { autoAlpha: 1, scale: 1, duration: .26, ease: 'power2.out', stagger: .04 }, ${t + 0.25});
      tl.fromTo('#scanline', { y: 0, autoAlpha: 0 }, { y: 586, autoAlpha: 1, duration: 1.15, ease: 'none', repeat: 1 }, ${t + 0.5});
      tl.fromTo('#gc0 .gc-ck', { scale: 0 }, { scale: 1, duration: .3, ease: 'back.out(3)' }, ${t + 0.72});
      tl.fromTo('#gc4 .gc-ck', { scale: 0 }, { scale: 1, duration: .3, ease: 'back.out(3)' }, ${t + 1.05});
      tl.fromTo('.pn-h', { autoAlpha: 0, x: 24 }, { autoAlpha: 1, x: 0, duration: .3, ease: 'power2.out' }, ${t + 0.4});
      tl.fromTo(['#pr0', '#pr1', '#pr2'], { autoAlpha: 0, x: 34 }, { autoAlpha: 1, x: 0, duration: .3, ease: 'power3.out', stagger: .22 }, ${t + 0.72});
      (function(){ var o = { v: 0 }, el = document.querySelector('#ctn');
        tl.to(o, { v: 21, duration: .8, ease: 'power2.out', onUpdate: function(){ el.textContent = Math.round(o.v); } }, ${t + 1.5}); })();
      tl.fromTo('#ctn', { scale: .4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: .34, ease: 'back.out(2)' }, ${t + 1.5});
      tl.fromTo('.ct-l', { autoAlpha: 0, x: -16 }, { autoAlpha: 1, x: 0, duration: .3, ease: 'power2.out' }, ${t + 1.68});
      tl.fromTo('#ctu', { scaleX: 0, transformOrigin: '50% 50%' }, { scaleX: 1, duration: .36, ease: 'power2.out' }, ${t + 1.9});` },

  // 4 · fenêtre + prompt tapé + reveal par barre de scan
  { id: 'browser', start: 10.8, dur: 4.2, html: `${head('ÉTAPE 02', "L'ACTEUR<br>VIRTUEL")}
      <div class="prompt" id="prompt"><span class="pr-s">/</span><span id="prtxt"></span><span class="caret" id="caret"></span></div>
      <div class="win" id="win">
        <div class="win-bar"><span class="win-dot"></span><span class="win-u">avatar.gen</span><span class="win-r">GÉNÉRATION…</span></div>
        <div class="win-body"><div class="shot" id="shot"></div><div class="scanbar" id="scanbar"></div></div>
      </div>
      <div class="cap-line" id="capline">génère <em>la personne qui tient le produit</em></div>`,
    js: (t) => `
      tl.fromTo('#prompt', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: .28, ease: 'power2.out' }, ${t + 0.2});
      (function(){ var full = 'sophiene-video-prompt', o = { i: 0 }, el = document.querySelector('#prtxt');
        tl.to(o, { i: full.length, duration: .9, ease: 'none', onUpdate: function(){ el.textContent = full.slice(0, Math.round(o.i)); } }, ${t + 0.34}); })();
      tl.fromTo('#caret', { autoAlpha: 1 }, { autoAlpha: 0, duration: .28, repeat: 6, yoyo: true, ease: 'none' }, ${t + 0.34});
      tl.fromTo('#win', { autoAlpha: 0, y: 34, scale: .96 }, { autoAlpha: 1, y: 0, scale: 1, duration: .38, ease: 'back.out(1.4)' }, ${t + 1.2});
      tl.fromTo('#shot', { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 1.25, ease: 'power1.inOut' }, ${t + 1.5});
      tl.fromTo('#scanbar', { y: 0, autoAlpha: 0 }, { autoAlpha: 1, duration: .1 }, ${t + 1.5});
      tl.to('#scanbar', { y: 560, duration: 1.25, ease: 'power1.inOut' }, ${t + 1.5});
      tl.to('#scanbar', { autoAlpha: 0, duration: .18 }, ${t + 2.7});
      tl.fromTo('#capline', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: .3, ease: 'power2.out' }, ${t + 2.5});
      tl.fromTo('#capline em', { color: '${INK}' }, { color: '${ACC}', duration: .01 }, ${t + 2.8});` },

  // 5 · gros chiffre + courbe
  { id: 'kpi', start: 15.0, dur: 3.6, html: `${head('RÉSULTAT · 30 JOURS', '+10 000<br>ABONNÉS')}
      <div class="kpi">
        <div class="kpi-row"><span class="kpi-n" id="kpin">0</span><svg class="kpi-up" id="kpiup" viewBox="0 0 40 60"><path d="M20 56V10M6 24 20 8l14 16" fill="none" stroke="#1FA34A" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="kpi-l">ABONNÉS GAGNÉS</div>
      </div>
      <svg class="chart" viewBox="0 0 900 380" preserveAspectRatio="none">
        <line x1="0" y1="95" x2="900" y2="95" class="gl"/><line x1="0" y1="190" x2="900" y2="190" class="gl"/><line x1="0" y1="285" x2="900" y2="285" class="gl"/>
        <path id="area" d="M20 340 L200 300 L380 250 L560 160 L740 70 L880 30 L880 380 L20 380 Z" fill="${ACC}" opacity=".14"/>
        <path id="line" d="M20 340 L200 300 L380 250 L560 160 L740 70 L880 30" fill="none" stroke="${ACC}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle id="head" cx="20" cy="340" r="15" fill="#fff" stroke="${ACC}" stroke-width="8"/>
      </svg>`,
    js: (t) => `
      (function(){ var o = { v: 0 }, el = document.querySelector('#kpin');
        tl.to(o, { v: 8750, duration: 1.1, ease: 'power2.out', onUpdate: function(){ el.textContent = Math.round(o.v).toLocaleString('fr-FR').replace(/\\u202f|,/g, ' '); } }, ${t + 0.3}); })();
      tl.fromTo('#kpin', { scale: .5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: .42, ease: 'back.out(1.9)' }, ${t + 0.3});
      tl.fromTo('#kpiup', { scale: 0, y: 26 }, { scale: 1, y: 0, duration: .4, ease: 'back.out(3)' }, ${t + 0.75});
      tl.fromTo('.kpi-l', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: .28, ease: 'power2.out' }, ${t + 0.9});
      (function(){ var p = document.querySelector('#line'), L = 1200;
        p.style.strokeDasharray = L; tl.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: 1.15, ease: 'power2.inOut' }, ${t + 0.9}); })();
      tl.fromTo('#area', { autoAlpha: 0, scaleY: .4, transformOrigin: '50% 100%' }, { autoAlpha: 1, scaleY: 1, duration: 1.1, ease: 'power2.inOut' }, ${t + 0.95});
      tl.fromTo('#head', { attr: { cx: 20, cy: 340 } }, { attr: { cx: 880, cy: 30 }, duration: 1.15, ease: 'power2.inOut' }, ${t + 0.9});` },

  // 6 · chrono
  { id: 'timer', start: 18.6, dur: 2.8, html: `${head('LE MONTAGE', '3 JOURS <span class="ar">→</span><br>3 MINUTES')}
      <div class="tm"><div class="tm-bar" id="tmbar"></div></div>
      <div class="tm-lbl">CHRONO</div>
      <div class="tm-val" id="tmval">00:00:00</div>`,
    js: (t) => `
      tl.fromTo('.tm-bar', { scaleX: 1, transformOrigin: '50% 50%' }, { scaleX: .52, duration: 1.5, ease: 'power2.inOut' }, ${t + 0.4});
      tl.fromTo('.tm', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: .3, ease: 'back.out(1.6)' }, ${t + 0.25});
      tl.fromTo(['.tm-lbl', '.tm-val'], { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: .28, ease: 'power2.out', stagger: .08 }, ${t + 0.4});
      (function(){ var o = { v: 0 }, el = document.querySelector('#tmval'), p = function(n){ return String(Math.floor(n)).padStart(2, '0'); };
        tl.to(o, { v: 55.93, duration: 1.6, ease: 'power1.out', onUpdate: function(){ el.textContent = '00:' + p(o.v) + ':' + p((o.v % 1) * 100); } }, ${t + 0.4}); })();` },

  // 7 · boucle circulaire
  { id: 'loop', start: 21.4, dur: 3.4, html: `${head('ÉTAPE 03', 'LA BOUCLE')}
      <div class="loop">
        <svg class="lp-svg" viewBox="0 0 520 520">
          ${[0, 1, 2, 3].map((i) => {
            const a0 = -90 + i * 90 + 22, a1 = -90 + (i + 1) * 90 - 22
            const R = 190, cx = 260, cy = 260
            const x0 = cx + R * Math.cos(a0 * Math.PI / 180), y0 = cy + R * Math.sin(a0 * Math.PI / 180)
            const x1 = cx + R * Math.cos(a1 * Math.PI / 180), y1 = cy + R * Math.sin(a1 * Math.PI / 180)
            return `<path class="lp-arc" id="arc${i}" d="M${r2(x0)} ${r2(y0)} A${R} ${R} 0 0 1 ${r2(x1)} ${r2(y1)}" fill="none" stroke="${ACC}" stroke-width="6" stroke-linecap="round" marker-end="url(#ah)"/>`
          }).join('')}
          <defs><marker id="ah" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="${ACC}"/></marker></defs>
        </svg>
        <div class="lp-c" id="lpc">AUTO</div>
        <div class="lp-n n0" id="ln0"><div class="circle white sm">${icoCal}</div><span>CALENDRIER</span></div>
        <div class="lp-n n1" id="ln1"><div class="circle white sm">${icoInsta}</div><span>INSTAGRAM</span></div>
        <div class="lp-n n2" id="ln2"><div class="circle white sm">${icoFb}</div><span>FACEBOOK</span></div>
        <div class="lp-n n3" id="ln3"><div class="circle white sm">${icoTiktok}</div><span>TIKTOK</span></div>
      </div>`,
    js: (t) => `
      tl.fromTo(['#ln0 .circle', '#ln1 .circle', '#ln2 .circle', '#ln3 .circle'], { scale: 0 }, { scale: 1, duration: .36, ease: 'back.out(2.4)', stagger: .16 }, ${t + 0.25});
      tl.fromTo('.lp-n span', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: .24, ease: 'power2.out', stagger: .16 }, ${t + 0.4});
      ${[0, 1, 2, 3].map((i) => `(function(){ var p = document.querySelector('#arc${i}'), L = 300;
        p.style.strokeDasharray = L; tl.fromTo(p, { strokeDashoffset: L }, { strokeDashoffset: 0, duration: .34, ease: 'power2.out' }, ${r2(t + 0.42 + i * 0.16)}); })();`).join('\n      ')}
      tl.fromTo('#lpc', { scale: .3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: .44, ease: 'back.out(2.2)' }, ${t + 1.1});
      tl.to('#lpc', { scale: 1.06, duration: .5, ease: 'sine.inOut', repeat: 2, yoyo: true }, ${t + 1.6});` },

  // 8 · comparatif prix
  { id: 'compare', start: 24.8, dur: 3.4, html: `${head("LE PIRE, C'EST QUE…", 'ÇA REMPLACE<br>UN CM')}
      <div class="cmp">
        <div class="cc ko" id="cc1"><span class="cc-strike" id="ccs"></span><div class="circle white sm">${icoUser}</div><div class="cc-t">COMMUNITY<br>MANAGER</div><div class="cc-p">1&nbsp;500&nbsp;€</div><div class="cc-s">PAR MOIS</div></div>
        <svg class="cmp-ar" id="cmpar" viewBox="0 0 90 40"><path d="M4 20h70M60 8l16 12-16 12" fill="none" stroke="${ACC}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="cc ok" id="cc2"><div class="circle white sm">${icoClaude()}</div><div class="cc-t">TON SYSTÈME<br>CLAUDE</div><div class="cc-p ok"><span class="ap">≈</span>&nbsp;0&nbsp;€</div><div class="cc-s">PAR MOIS</div></div>
      </div>`,
    js: (t) => `
      tl.fromTo('#cc1', { autoAlpha: 0, y: 30, scale: .95 }, { autoAlpha: 1, y: 0, scale: 1, duration: .36, ease: 'back.out(1.5)' }, ${t + 0.3});
      tl.fromTo('#cc2', { autoAlpha: 0, y: 30, scale: .95 }, { autoAlpha: 1, y: 0, scale: 1, duration: .36, ease: 'back.out(1.5)' }, ${t + 0.5});
      tl.fromTo('#cmpar', { autoAlpha: 0, scaleX: 0, transformOrigin: '0% 50%' }, { autoAlpha: 1, scaleX: 1, duration: .3, ease: 'power2.out' }, ${t + 0.8});
      tl.fromTo('#ccs', { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: .3, ease: 'power3.out' }, ${t + 1.15});
      tl.fromTo('#cc2', { borderColor: 'rgba(0,0,0,.08)' }, { borderColor: '#1FA34A', duration: .3 }, ${t + 1.35});
      tl.fromTo('#cc2 .cc-p', { scale: 1.16 }, { scale: 1, duration: .34, ease: 'back.out(3)' }, ${t + 1.35});` },
]

// ─────────────────────────────────────────── sous-titres karaoké (mot par mot)
const CAPS = [
  [0.35, "J'AI"], [0.75, 'CONNECTÉ'], [1.3, 'CLAUDE', 1], [1.85, 'À'], [2.1, 'MON'], [2.45, 'COMPTE'],
  [3.7, 'IL'], [4.0, 'VOIT'], [4.4, 'TOUT'], [4.9, 'CE'], [5.2, 'QUI'], [5.5, 'MARCHE', 1],
  [7.1, 'IL'], [7.4, 'SCRAPE'], [8.0, 'MA'], [8.3, 'NICHE', 1], [8.9, 'EN'], [9.2, 'ENTIER'],
  [11.1, 'PUIS'], [11.5, 'IL'], [11.8, 'GÉNÈRE'], [12.4, "L'ACTEUR"], [13.0, 'VIRTUEL', 1],
  [15.3, 'RÉSULTAT'], [16.0, '8 750'], [16.6, 'ABONNÉS', 1],
  [18.9, 'TROIS'], [19.3, 'JOURS'], [19.7, 'DEVIENNENT'], [20.4, '3 MINUTES', 1],
  [21.7, 'ET'], [21.95, 'ÇA'], [22.25, 'TOURNE'], [22.8, 'EN'], [23.1, 'BOUCLE', 1],
  [25.1, 'ÇA'], [25.4, 'REMPLACE'], [26.1, 'UN'], [26.4, 'CM', 1],
]
const D = 28.2

const capsHtml = CAPS.map(([t, w, acc], i) => {
  const end = i + 1 < CAPS.length ? CAPS[i + 1][0] : t + 0.5
  return `      <div class="clip cap${acc ? ' acc' : ''}" id="c${i}" data-start="${r2(t)}" data-duration="${r2(Math.max(0.12, end - t - 0.05))}" data-track-index="12">${w}</div>`
}).join('\n')
const capsJs = CAPS.map((c, i) => `      tl.fromTo('#c${i}', { scale: 1.16 }, { scale: 1, duration: .12, ease: 'power2.out' }, ${r2(c[0])});`).join('\n')

const scenesHtml = SCENES.map((s, i) => `      <div class="clip scene" id="s${i}" data-start="${s.start}" data-duration="${s.dur}" data-track-index="${2 + i}">${s.html}
      </div>`).join('\n')
const scenesJs = SCENES.map((s, i) => `
      tl.fromTo('#s${i}', { autoAlpha: 0 }, { autoAlpha: 1, duration: .2, ease: 'power2.out' }, ${s.start});
      tl.to('#s${i}', { autoAlpha: 0, duration: .18, ease: 'power1.in' }, ${r2(s.start + s.dur - 0.24)});
      tl.set('#s${i}', { autoAlpha: 0 }, ${r2(s.start + s.dur)});
${SCENES[i].js(s.start)}`).join('\n')
const hdJs = SCENES.filter((s) => s.html.includes('class="hd"')).map((s) => `
      tl.fromTo('#s${SCENES.indexOf(s)} .eyebrow', { autoAlpha: 0, scaleX: 1.25, transformOrigin: '50% 50%' }, { autoAlpha: 1, scaleX: 1, duration: .38, ease: 'power2.out' }, ${s.start + 0.08});
      tl.fromTo('#s${SCENES.indexOf(s)} .title', { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: .34, ease: 'power3.out' }, ${s.start + 0.18});`).join('')

const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${CREAM};
        font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: ${INK}; }
      .clip { position: absolute; }
      #bg { position: absolute; inset: 0; background:
        radial-gradient(1200px 900px at 50% 18%, #FCFBF3 0%, ${CREAM} 60%, #F0EDDD 100%); }
      .spec { position: absolute; border-radius: 50%; background: rgba(194,72,58,.16); }

      .scene { inset: 0; will-change: opacity; }
      .hd { position: absolute; left: 60px; right: 60px; top: 118px; text-align: center; }
      .eyebrow { font: 700 30px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 11px;
        color: ${ACC}; text-transform: uppercase; }
      .title { font: 900 96px/0.94 "Archivo Black", "Archivo Black", Arial, sans-serif; letter-spacing: -2px;
        margin-top: 26px; text-transform: uppercase; text-shadow: 0 5px 0 rgba(0,0,0,.05); }
      .title .ar { color: ${ACC}; }
      .ic { width: 100%; height: 100%; display: block; }

      .circle { width: 168px; height: 168px; border-radius: 50%; background: #fff; display: flex;
        align-items: center; justify-content: center; padding: 34px; box-shadow: 0 16px 40px rgba(20,16,12,.10); }
      .circle.black { background: #14110E; }
      .circle.sm { width: 138px; height: 138px; padding: 26px; }
      .nd-mcp { font: 900 34px/1 "Archivo Black", Arial; color: #fff; letter-spacing: 1px; }

      /* 1 · bandeau */
      .bn { position: absolute; left: 34px; right: 34px; top: 300px; background: #100E0C; border: 3px solid rgba(255,107,53,.55);
        border-radius: 34px; padding: 46px 40px 52px; text-align: center; box-shadow: 0 30px 80px rgba(0,0,0,.28); }
      .bn-eye { font: 700 27px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 9px; color: #FF6B35; }
      .bn-eye .dot { display: inline-block; width: 13px; height: 13px; border-radius: 50%; background: #FF6B35; margin-right: 12px; vertical-align: 2px; }
      .bn-logos { display: flex; align-items: center; justify-content: center; gap: 34px; margin: 34px 0 28px; }
      .bn-logos .lg { width: 128px; height: 128px; border-radius: 50%; background: #fff; padding: 24px; display: block; }
      .bn-logos .plus { font: 900 62px/1 "Archivo Black", Arial; color: #fff; }
      .bn-t { font: 900 74px/1.05 "Archivo Black", Arial; color: #fff; letter-spacing: -2px; }
      .bn-t em { font-style: normal; display: inline-block; }
      .bn-sub { margin-top: 26px; font: 700 38px/1.3 Inter, Arial; color: rgba(255,255,255,.92); }

      /* 2 · nœuds */
      .nodes { position: absolute; left: 40px; right: 40px; top: 760px; display: flex; align-items: center; justify-content: center; }
      .nd { width: 220px; text-align: center; }
      .nd .circle { margin: 0 auto; }
      .nd-l { margin-top: 26px; font: 900 30px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 4px; }
      .link { position: relative; height: 5px; flex: 1; background: ${ACC}; max-width: 190px; will-change: transform; }
      .lk-d { position: absolute; left: -9px; top: -7px; width: 19px; height: 19px; border-radius: 50%; background: #fff; border: 4px solid ${ACC}; }
      .lk-d.r { left: auto; right: -9px; }

      /* 3 · scan */
      .scanwrap { position: absolute; left: 44px; right: 44px; top: 700px; display: flex; gap: 40px; }
      .grid { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; width: 500px; height: 586px; }
      .gc { position: relative; height: 182px; border-radius: 20px; background: linear-gradient(180deg,#B9BBB0,#A7A99E); overflow: hidden; }
      .gc.hit { outline: 5px solid ${ACC}; outline-offset: -5px; }
      .gc-a { position: absolute; left: 20px; top: 20px; width: 44px; height: 44px; border-radius: 50%; background: rgba(255,255,255,.72); }
      .gc-b { position: absolute; left: 20px; bottom: 46px; width: 74%; height: 15px; border-radius: 9px; background: rgba(255,255,255,.6); }
      .gc-c { position: absolute; left: 20px; bottom: 22px; width: 46%; height: 15px; border-radius: 9px; background: rgba(255,255,255,.42); }
      .gc-ck { position: absolute; right: 14px; top: 14px; width: 46px; height: 46px; border-radius: 50%; background: ${ACC};
        color: #fff; font: 900 26px/46px Arial; text-align: center; }
      .scanline { position: absolute; left: -14px; right: -14px; height: 6px; background: ${ACC};
        box-shadow: 0 0 34px 8px rgba(194,72,58,.55); border-radius: 9px; }
      .panel { flex: 1; padding-top: 8px; }
      .pn-h { display: flex; align-items: center; gap: 20px; }
      .pn-ic { width: 78px; height: 78px; display: block; }
      .pn-t { font: 900 40px/1.12 "Archivo Black", Arial; letter-spacing: 1px; }
      .pn-row { margin-top: 22px; background: #fff; border-radius: 16px; padding: 24px 26px; display: flex; align-items: center;
        gap: 14px; box-shadow: 0 12px 30px rgba(20,16,12,.08); font: 900 32px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 2px; }
      .pn-row i { color: #1FA34A; font-style: normal; }
      .pn-row span { margin-left: auto; color: #8E8B82; font-size: 26px; letter-spacing: 3px; }
      .counter { position: absolute; left: 0; right: 0; top: 1276px; text-align: center; }
      .ct-n { font: 900 104px/1 "Archivo Black", Arial; color: ${ACC}; letter-spacing: -3px; }
      .ct-l { font: 900 36px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 6px; margin-left: 20px; }
      .ct-u { display: block; width: 300px; height: 7px; background: ${ACC}; border-radius: 9px; margin: 20px auto 0; }

      /* 4 · fenêtre + prompt */
      .prompt { position: absolute; left: 50%; transform: translateX(-50%); top: 460px; background: #14110E; color: #fff;
        border-radius: 18px; padding: 22px 34px; font: 700 38px/1 "JetBrains Mono", ui-monospace, monospace;
        letter-spacing: 1px; box-shadow: 0 18px 44px rgba(20,16,12,.22); white-space: nowrap; }
      .prompt .pr-s { color: ${ACC}; }
      .caret { display: inline-block; width: 16px; height: 38px; background: ${ACC}; vertical-align: -6px; margin-left: 4px; }
      .win { position: absolute; left: 120px; right: 120px; top: 600px; background: #fff; border-radius: 26px; overflow: hidden;
        box-shadow: 0 34px 90px rgba(20,16,12,.20); }
      .win-bar { display: flex; align-items: center; gap: 16px; padding: 22px 28px; border-bottom: 2px solid rgba(20,16,12,.06); }
      .win-dot { width: 18px; height: 18px; border-radius: 50%; background: ${ACC}; }
      .win-u { font: 700 30px/1 "JetBrains Mono", ui-monospace, monospace; color: #8E8B82; }
      .win-r { margin-left: auto; font: 700 26px/1 "JetBrains Mono", ui-monospace, monospace; color: #7A5CD6; letter-spacing: 2px; }
      .win-body { position: relative; height: 560px; background: #EFECE0; overflow: hidden; }
      .shot { position: absolute; inset: 0; background:
        radial-gradient(300px 300px at 50% 44%, #E8C9B0 0%, #D9AE90 55%, #B98E72 100%),
        linear-gradient(180deg, #F2F0EA, #D8D4C6); }
      .shot::after { content: ''; position: absolute; left: 50%; top: 52%; transform: translate(-50%,-50%);
        width: 300px; height: 380px; border-radius: 150px 150px 40px 40px; background: rgba(90,62,44,.35); filter: blur(2px); }
      .scanbar { position: absolute; left: 0; right: 0; height: 20px; background: linear-gradient(90deg,#9B7CF0,#6D4CD6);
        box-shadow: 0 0 60px 14px rgba(123,92,214,.6); }
      .cap-line { position: absolute; left: 60px; right: 60px; top: 1300px; text-align: center;
        font: 900 46px/1.25 "Archivo Black", Arial; letter-spacing: -1px; }
      .cap-line em { font-style: normal; }

      /* 5 · kpi */
      .kpi { position: absolute; left: 0; right: 0; top: 480px; text-align: center; }
      .kpi-row { display: flex; align-items: center; justify-content: center; gap: 28px; }
      .kpi-n { font: 900 200px/1 "Archivo Black", Arial; letter-spacing: -6px; }
      .kpi-up { width: 62px; height: 92px; }
      .kpi-l { margin-top: 18px; font: 900 40px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 8px; color: #6F6C64; }
      .chart { position: absolute; left: 40px; right: 40px; top: 880px; width: 1000px; height: 470px; }
      .chart .gl { stroke: rgba(20,16,12,.10); stroke-width: 2; }

      /* 6 · chrono */
      .tm { position: absolute; left: 0; right: 0; top: 700px; display: flex; justify-content: center; }
      .tm-bar { width: 620px; height: 190px; border-radius: 26px; background: #D0685C; box-shadow: 0 20px 50px rgba(194,72,58,.28); }
      .tm-lbl { position: absolute; left: 0; right: 0; top: 1140px; text-align: center;
        font: 700 34px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 12px; color: #6F6C64; }
      .tm-val { position: absolute; left: 0; right: 0; top: 1200px; text-align: center;
        font: 900 116px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 2px; }

      /* 7 · boucle */
      .loop { position: absolute; left: 50%; transform: translateX(-50%); top: 580px; width: 800px; height: 800px; }
      .lp-svg { position: absolute; left: 140px; top: 140px; width: 520px; height: 520px; }
      .lp-c { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
        font: 900 92px/1 "Archivo Black", Arial; letter-spacing: -2px; }
      .lp-n { position: absolute; width: 220px; text-align: center; left: 50%; top: 50%; }
      .lp-n .circle { margin: 0 auto; }
      .lp-n span { display: block; margin-top: 14px; font: 900 26px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 3px; }
      .lp-n.n0 { transform: translate(-50%, -430px); }
      .lp-n.n1 { transform: translate(180px, -110px); }
      .lp-n.n2 { transform: translate(-50%, 210px); }
      .lp-n.n3 { transform: translate(-400px, -110px); }

      /* 8 · comparatif */
      .cmp { position: absolute; left: 40px; right: 40px; top: 720px; display: flex; align-items: center; justify-content: center; gap: 24px; }
      .cc { position: relative; width: 430px; background: #fff; border: 4px solid rgba(0,0,0,.08); border-radius: 34px;
        padding: 44px 28px 40px; text-align: center; box-shadow: 0 24px 60px rgba(20,16,12,.12); }
      .cc .circle { margin: 0 auto 26px; }
      .cc-t { font: 900 34px/1.25 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 3px; }
      .cc-p { margin-top: 40px; font: 900 76px/1 "Archivo Black", Arial; letter-spacing: -2px; }
      .cc-p.ok { color: #1FA34A; }
      .cc-p .ap { font-size: 54px; }
      .cc-s { margin-top: 14px; font: 700 28px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 6px; color: #8E8B82; }
      .cc-strike { position: absolute; left: 38px; top: 62px; width: 215px; height: 14px; border-radius: 9px;
        background: ${ACC}; transform: rotate(52deg); transform-origin: 0% 50%; z-index: 3; }
      .cmp-ar { width: 96px; height: 44px; flex: 0 0 auto; }

      /* sous-titres karaoké */
      .cap { left: 4%; right: 4%; top: 1466px; text-align: center; color: #FFFDF7;
        font: 900 118px/1 "Archivo Black", Arial; letter-spacing: -1px; z-index: 9;
        text-shadow: 0 8px 0 rgba(20,16,12,.22), 0 14px 34px rgba(20,16,12,.30); will-change: transform; }
      .cap.acc { color: ${ACC}; text-shadow: 0 8px 0 rgba(20,16,12,.18); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="scenepack" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
      <div id="bg" class="clip" data-start="0" data-duration="${D}" data-track-index="0">
        ${[[90, 520, 22], [960, 640, 14], [140, 1180, 16], [900, 1320, 20], [60, 880, 12], [1010, 980, 10]]
          .map(([x, y, r]) => `<span class="spec" style="left:${x}px;top:${y}px;width:${r}px;height:${r}px"></span>`).join('')}
      </div>
${scenesHtml}
${capsHtml}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${SCENES.map((s, i) => `      tl.set('#s${i}', { autoAlpha: 0 }, 0);`).join('\n')}
${scenesJs}
${hdJs}
${capsJs}
      tl.set({}, {}, ${D});
      window.__timelines['scenepack'] = tl;
    </script>
  </body>
</html>
`

writeFileSync(new URL('./index.html', import.meta.url), html)
console.log('✅ index.html écrit —', SCENES.length, 'scènes,', D, 's')
