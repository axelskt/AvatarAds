// Construit app/i18n-en.js (interface anglaise de l'app, servie sous /en/app/) depuis tools/i18n/runtime.js (le traducteur)
// et tools/i18n/app-en.json (le dictionnaire). Axel 25/10 : « traduis l'interface de l'app en anglais ».
// Usage : node tools/gen-i18n-app.mjs               (écrit app/i18n-en.js)
//         node tools/gen-i18n-app.mjs --check       (vérifie seulement qu'il est à jour ; code 1 sinon)
//         node tools/gen-i18n-app.mjs --manquants   (textes français de app/index.html absents du dictionnaire → à traduire
//                                                     dans app-en.json, ou à ranger dans « ignore »)
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = (p) => new URL(p, import.meta.url);
const dico = JSON.parse(readFileSync(url('./i18n/app-en.json'), 'utf8'));
const runtime = readFileSync(url('./i18n/runtime.js'), 'utf8');

if (process.argv.includes('--manquants')) {
  const out = join(mkdtempSync(join(tmpdir(), 'i18n-')), 'fr.json');
  execFileSync('node', [url('./i18n/extract.mjs').pathname, url('../app/index.html').pathname, out], { stdio: 'inherit' });
  const fr = JSON.parse(readFileSync(out, 'utf8'));
  const connus = new Set([...Object.keys(dico.exact), ...dico.modeles.map((m) => m[0]), ...dico.ignore]);
  const manque = [...fr.exact, ...fr.modeles].filter((t) => !connus.has(t));
  console.log(manque.length ? manque.join('\n') : 'Rien à traduire.');
  process.exit(0);
}

for (const [fr, en] of dico.modeles) {
  const n = (s) => (s.match(/\{\}/g) || []).length;
  const ix = en.match(/\{\d\}/g);
  if (ix ? ix.length !== n(fr) : n(en) !== n(fr)) throw new Error('modèle : trous différents entre « ' + fr + ' » et « ' + en + ' »');
}
const js = runtime
  .replace('/*EXACT*/{}', () => JSON.stringify(dico.exact))
  .replace('/*MODELES*/[]', () => JSON.stringify(dico.modeles));
if (js === runtime) throw new Error('marqueurs /*EXACT*/ /*MODELES*/ introuvables dans tools/i18n/runtime.js');

const cible = url('../app/i18n-en.js');
if (process.argv.includes('--check')) {
  const ok = existsSync(cible) && readFileSync(cible, 'utf8') === js;
  console.log(ok ? 'app/i18n-en.js à jour' : 'app/i18n-en.js PAS à jour — lance node tools/gen-i18n-app.mjs');
  process.exit(ok ? 0 : 1);
}
writeFileSync(cible, js);
console.log('app/i18n-en.js écrit :', Object.keys(dico.exact).length, 'textes,', dico.modeles.length, 'modèles,', Math.round(js.length / 1024), 'Ko');
