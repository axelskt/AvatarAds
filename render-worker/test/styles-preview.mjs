// styles-preview.mjs — banc d'essai visuel des styles du Montage IA (#131).
// Génère un dossier par style avec la composition et un clip de fond, puis on
// vérifie chaque plan dans un navigateur en pilotant window.__timelines.montage.
//   node test/styles-preview.mjs
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildComposition } from '../build-composition.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'styles')
const BASE = join(HERE, 'job', 'base.mp4')

// Un plan qui exerce les quatre familles de scènes : split (flow, checklist,
// compare, stat, card), plein cadre (kpi, punch) et bandeau.
const plan = {
  duration: 30,
  hook: { text: 'Personne ne fait ça', start: 0.2, end: 2.6 },
  sections: [{ start: 0 }, { start: 9 }, { start: 20 }],
  zooms: [{ t: 1.2, dur: 1, cx: 0.5, cy: 0.32, scale: 1.2 }],
  captions: Array.from({ length: 30 }, (_, i) => ({
    start: i, end: i + 0.85, text: ['produit', 'vraiment', 'simple', 'et rapide', 'aujourd\'hui'][i % 5], accent: i % 7 === 3,
  })),
  slides: [
    { type: 'flow', title: 'La méthode', start: 3, end: 6.4,
      items: [{ text: 'Tu parles', t: 3.2 }, { text: 'L\'IA monte', t: 4.2 }, { text: 'Tu postes', t: 5.2 }] },
    { type: 'checklist', title: 'Inclus', start: 6.6, end: 9.4,
      items: [{ text: 'Sous-titres', t: 6.8 }, { text: 'Bruitages', t: 7.6 }, { text: 'B-roll', t: 8.4 }] },
    { layout: 'banner', eyebrow: 'Étape 02', title: 'Le montage change tout', accent: 'tout',
      sub: 'Sans toucher au logiciel', start: 9.6, end: 12.6 },
    { type: 'compare', title: 'Avant / après', start: 13, end: 16,
      items: [{ text: 'À la main', t: 13.2 }, { text: 'Avec l\'IA', t: 14.2 }] },
    { type: 'stat', title: 'Temps gagné', start: 16.2, end: 19,
      items: [{ text: '12', t: 16.5 }] },
    { layout: 'full', type: 'kpi', eyebrow: 'Résultat', title: 'Le vrai chiffre',
      value: '8750', unit: 'vues en 24 h', start: 19.4, end: 23.4, items: [{ text: '8750', t: 19.9 }] },
    { type: 'card', title: '', start: 23.8, end: 26.6,
      items: [{ text: 'Tu enregistres, c\'est monté', t: 24 }] },
    { layout: 'full', type: 'punch', eyebrow: 'Pour finir', title: '', start: 27, end: 29.6,
      items: [{ text: 'Arrête de monter à la main', t: 27.3 }] },
  ],
}

// instants représentatifs : un par famille de scène
export const SHOTS = [1.4, 5.4, 8.6, 11, 15, 17.5, 21.5, 25.2, 28.2]

const styles = ['auto', 'apple', 'glass', 'editorial', 'word']
mkdirSync(OUT, { recursive: true })
for (const st of styles) {
  const dir = join(OUT, st)
  mkdirSync(join(dir, 'media'), { recursive: true })
  if (existsSync(BASE)) copyFileSync(BASE, join(dir, 'media', 'base.mp4'))
  const fdir = join(HERE, '..', 'assets', 'fonts')
  if (existsSync(fdir)) {
    mkdirSync(join(dir, 'fonts'), { recursive: true })
    for (const f of readdirSync(fdir)) copyFileSync(join(fdir, f), join(dir, 'fonts', f))
  }
  writeFileSync(join(dir, 'index.html'), buildComposition({ ...plan, slideStyle: st }, {}))
  console.log('✓', st, '→', join(dir, 'index.html'))
}
// planche de contact : une ligne par style, une vignette par instant.
// `python3 -m http.server` dans test/styles puis /sheet.html?s=apple
writeFileSync(join(OUT, 'sheet.html'), `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Planche de contact — styles Montage IA</title>
<style>
  body { margin:0; background:#1b1b1e; font:13px system-ui,sans-serif; color:#eee; }
  h2 { margin:14px 12px 6px; font-size:15px; letter-spacing:.04em; }
  .row { display:flex; gap:10px; padding:0 12px 12px; }
  .cell { position:relative; width:270px; height:480px; overflow:hidden; border-radius:8px; background:#000; flex:0 0 auto; }
  .cell iframe { width:1080px; height:1920px; border:0; transform:scale(.25); transform-origin:0 0; }
  .cell b { position:absolute; right:4px; bottom:4px; z-index:9; background:rgba(0,0,0,.7);
    color:#fff; font:11px/1 monospace; padding:3px 5px; border-radius:4px; }
</style></head><body>
<div id="out"></div>
<script>
  // ?s=glass → une seule ligne : 25 iframes lisant chacune un MP4 1080p saturent le serveur
  const ONLY = new URLSearchParams(location.search).get('s');
  const STYLES = ONLY ? [ONLY] : ${JSON.stringify(styles)};
  const SHOTS  = ${JSON.stringify(SHOTS)};
  const out = document.getElementById('out');
  for (const st of STYLES) {
    const h = document.createElement('h2'); h.textContent = st; out.appendChild(h);
    const row = document.createElement('div'); row.className = 'row';
    for (const t of SHOTS) {
      const c = document.createElement('div'); c.className = 'cell';
      const f = document.createElement('iframe');
      f.src = st + '/index.html';
      f.onload = () => { setTimeout(() => {
        const w = f.contentWindow, tl = w.__timelines && w.__timelines.montage;
        if (tl) tl.pause(t);
        // le moteur HyperFrames n'affiche un .clip que dans sa fenêtre data-start/duration :
        // on le simule ici, sinon tous les sous-titres se superposent dans l'aperçu.
        w.document.querySelectorAll('.clip[data-start]').forEach((el) => {
          const s = parseFloat(el.dataset.start), d = parseFloat(el.dataset.duration);
          if (t < s || t >= s + d) el.style.display = 'none';
        });
      }, 400); };
      const b = document.createElement('b'); b.textContent = t + 's';
      c.appendChild(f); c.appendChild(b); row.appendChild(c);
    }
    out.appendChild(row);
  }
<\/script>
</body></html>
`)
console.log('planche :', join(OUT, 'sheet.html'), '— instants:', SHOTS.join(', '))
