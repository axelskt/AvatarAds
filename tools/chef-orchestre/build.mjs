#!/usr/bin/env node
/**
 * Chef d'orchestre V0 — plan.json + scene-map → composition HyperFrames (index.html)
 *
 * Le renderer : traduit le plan de montage en composition déterministe
 * (caméra qui suit ce que dit l'audio, bordure highlight, sous-titres Punch
 * mot-à-mot, narration + SFX). Aucune logique créative ici — tout vient du plan.
 *
 * Usage : node scripts/build.mjs --plan plan.json --out index.html
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const plan = JSON.parse(readFileSync(args.plan || 'plan.json', 'utf8'));
const scene = JSON.parse(readFileSync(plan.scene, 'utf8'));
const outPath = args.out || 'index.html';

const { width: W, height: H, duration: DUR } = plan.format;
const { anticipation: LEAD, moveDuration: MOVE } = plan.style;
const PANEL = scene.panel; // 1560x878
const FOCUS_Y = Math.round(H * 0.49); // point de l'écran où on centre la cible
const panelLeft = (W - PANEL.width) / 2;
const panelTop = (H - PANEL.height) / 2;
const r2 = (n) => Math.round(n * 100) / 100;

// caméra : transformOrigin "0 0" sur #cam → pour centrer le centre C d'une cible
// à (W/2, FOCUS_Y) au zoom z : x = W/2 - panelLeft - Cx*z ; y = FOCUS_Y - panelTop - Cy*z
const camFor = (targetId) => {
  const t = scene.targets[targetId];
  const cx = t.rect.left + t.rect.width / 2;
  const cy = t.rect.top + t.rect.height / 2;
  const z = t.zoom || Math.min(2.3, Math.max(1.3, (0.72 * W) / t.rect.width));
  return { x: r2(W / 2 - panelLeft - cx * z), y: r2(FOCUS_Y - panelTop - cy * z), scale: z };
};

// mapping SFX kind → fichier local (résolu via media-use)
const SFX = {
  whoosh: { src: '.media/audio/sfx/sfx_001.mp3', dur: 0.6, volume: 0.5 },
  click: { src: '.media/audio/sfx/sfx_002.mp3', dur: 0.4, volume: 0.75 },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- clips HTML ----------
const captionDivs = plan.captions.map((c, i) => {
  const dur = r2(Math.max(0.14, c.end - c.start));
  const track = 3 + (i % 2); // alternance pour éviter les chevauchements sur une même piste
  return `      <div id="cap-${i}" class="clip cap${c.accent ? ' cap-accent' : ''}" data-start="${r2(c.start)}" data-duration="${dur}" data-track-index="${track}">${esc(c.text)}</div>`;
}).join('\n');

const audioClips = [
  `      <audio id="vo" class="clip" src="${plan.audio.narration.src}" data-start="${plan.audio.narration.start}" data-duration="${plan.audio.narration.duration}" data-track-index="5"></audio>`,
  ...plan.sfx.map((s, i) => {
    const def = SFX[s.kind];
    if (!def) return '';
    const track = 6 + (i % 2);
    return `      <audio id="sfx-${i}" class="clip" src="${def.src}" data-start="${r2(s.at)}" data-duration="${def.dur}" data-track-index="${track}" data-volume="${def.volume}"></audio>`;
  }).filter(Boolean),
].join('\n');

// ---------- timeline caméra + highlight ----------
const tlLines = [];
tlLines.push(`tl.fromTo("#tilt", { rotationY: -14, rotationX: 6 }, { rotationY: -8, rotationX: 3, duration: ${DUR}, ease: "sine.inOut" }, 0);`);
tlLines.push(`tl.fromTo("#cam", { x: 0, y: 0, scale: 0.94, opacity: 0 }, { x: 0, y: 0, scale: 1, opacity: 1, duration: 0.55, ease: "power3.out" }, 0);`);

let prevKey = 'wide';
let hlVisible = false;
let hlInit = null;
for (const seg of plan.segments) {
  const key = seg.camera === 'target' ? seg.target : 'wide';
  if (key === prevKey) continue;
  const t = r2(Math.max(0.2, seg.start - LEAD));
  if (key === 'wide') {
    tlLines.push(`tl.to("#cam", { x: 0, y: 0, scale: 1, duration: ${r2(MOVE + 0.2)}, ease: "power3.inOut" }, ${t}); // ${seg.id} : retour vue large`);
    if (hlVisible) { tlLines.push(`tl.to("#hl", { opacity: 0, duration: 0.35, ease: "power2.in" }, ${t});`); hlVisible = false; }
  } else {
    const cam = camFor(key);
    const r = scene.targets[key].rect;
    tlLines.push(`tl.to("#cam", { x: ${cam.x}, y: ${cam.y}, scale: ${cam.scale}, duration: ${MOVE}, ease: "power3.inOut" }, ${t}); // ${seg.id} : zoom ${key}`);
    if (!hlVisible) {
      hlInit = r;
      tlLines.push(`tl.fromTo("#hl", { opacity: 0, scale: 1.35, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, ${r2(t + 0.25)});`);
      hlVisible = true;
    } else {
      tlLines.push(`tl.to("#hl", { x: ${r.left}, y: ${r.top}, width: ${r.width}, height: ${r.height}, duration: ${r2(MOVE - 0.05)}, ease: "power3.inOut" }, ${t});`);
    }
    if (seg.emphasis === 'pulse') {
      const at = r2(Math.max(seg.speechEnd - 0.45, seg.start + MOVE));
      tlLines.push(`tl.to("#hl", { scale: 1.12, duration: 0.18, yoyo: true, repeat: 3, ease: "sine.inOut" }, ${at}); // ${seg.id} : pulse`);
    }
  }
  prevKey = key;
}
// pop de chaque sous-titre
plan.captions.forEach((c, i) => {
  tlLines.push(`tl.fromTo("#cap-${i}", { scale: 1.28, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.14, ease: "back.out(2.5)" }, ${r2(c.start)});`);
});
tlLines.push(`tl.fromTo("#floor", { opacity: 0.5 }, { opacity: 1, duration: ${r2(DUR / 2)}, ease: "sine.inOut" }, 0);`);
tlLines.push(`tl.to("#floor", { opacity: 0.6, duration: ${r2(DUR / 2)}, ease: "sine.inOut" }, ${r2(DUR / 2)});`);

const hlCss = hlInit || { left: 0, top: 0, width: 100, height: 40 };

const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${W}px; height: ${H}px; overflow: hidden;
        background: radial-gradient(ellipse at 50% 118%, #33150a 0%, #0d0b0e 52%, #060507 100%);
      }
      .clip { position: absolute; }

      #stage { inset: 0; perspective: 1500px; display: grid; place-items: center; }
      #cam { width: ${PANEL.width}px; height: ${PANEL.height}px; position: relative; }
      #panel {
        width: ${PANEL.width}px; height: ${PANEL.height}px;
        border-radius: 22px; overflow: hidden; position: relative;
        box-shadow: 0 90px 180px -60px rgba(0,0,0,.95),
                    0 0 130px -30px rgba(255,107,53,.55),
                    0 0 0 1px rgba(255,255,255,.08);
      }
      #panel img { width: 100%; height: 100%; display: block; }

      #hl {
        position: absolute; border: 4px solid #FF6B35; border-radius: 12px;
        box-shadow: 0 0 26px rgba(255,107,53,.75), inset 0 0 18px rgba(255,107,53,.18);
        pointer-events: none; opacity: 0;
        left: 0; top: 0; width: ${hlCss.width}px; height: ${hlCss.height}px;
      }

      #floor {
        left: 50%; bottom: 300px; width: 860px; height: 190px; transform: translateX(-50%);
        background: radial-gradient(ellipse, rgba(255,107,53,.45), transparent 70%); filter: blur(42px);
      }

      /* Sous-titres Punch : un mot à la fois, dans la safe zone */
      .cap {
        left: 0; right: 0; top: ${Math.round(H * 0.693)}px;
        text-align: center;
        font-family: 'Arial Black', 'Arial', sans-serif;
        font-weight: 900; font-size: 92px; line-height: 1.15;
        letter-spacing: 1px; color: #ffffff;
        text-shadow: 0 8px 30px rgba(0,0,0,.85), 0 2px 6px rgba(0,0,0,.9);
      }
      .cap-accent { color: #FF6B35; font-size: 104px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}" data-width="${W}" data-height="${H}">

      <div id="floor" class="clip" data-start="0" data-duration="${DUR}" data-track-index="1"></div>

      <div id="stage" class="clip" data-start="0" data-duration="${DUR}" data-track-index="2">
        <div id="tilt">
          <div id="cam">
            <div id="panel">
              <img src="${scene.image}" alt="" />
              <div id="hl"></div>
            </div>
          </div>
        </div>
      </div>

${captionDivs}

${audioClips}

    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      gsap.set("#tilt", { transformOrigin: "50% 50%" });
      gsap.set("#cam", { transformOrigin: "0 0" });
      gsap.set("#hl", { x: ${hlCss.left}, y: ${hlCss.top}, width: ${hlCss.width}, height: ${hlCss.height} });

      ${tlLines.join('\n      ')}

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

writeFileSync(outPath, html);
console.log(`composition écrite → ${outPath} (${plan.segments.length} segments, ${plan.captions.length} sous-titres, ${plan.sfx.length} sfx, ${DUR}s)`);
