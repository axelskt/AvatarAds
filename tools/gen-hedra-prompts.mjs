// Génère les trois modules du prompt lipsync Hedra Character-3 (app JS, edge TS, render-worker ESM) depuis
// shared/hedra-prompts.json — SOURCE UNIQUE (Axel 27/09 : Character-3 + le prompt validé sur l'usine, partout).
// Usage : node tools/gen-hedra-prompts.mjs            (écrit les 3 fichiers)
//         node tools/gen-hedra-prompts.mjs --check    (vérifie seulement que les 3 fichiers sont à jour ; code 1 sinon)
// Refuse d'écrire si le prompt dépasse maxLen ou n'est pas en ASCII imprimable (anglais).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SRC = new URL('../shared/hedra-prompts.json', import.meta.url);
const src = JSON.parse(readFileSync(SRC, 'utf8'));
const MAX = Number(src.maxLen);
const P = src.prompt;
if (!(MAX > 0)) throw new Error('maxLen invalide : ' + src.maxLen);
if (typeof P !== 'string' || !P.trim()) throw new Error('prompt manquant');
if (P.length > MAX) throw new Error(`prompt : ${P.length} caractères > ${MAX}`);
if (!/^[\x20-\x7e]+$/.test(P)) throw new Error('prompt : caractère non ASCII (le prompt part en anglais, sans accent ni guillemet typographique)');

const head = (target) => `// GÉNÉRÉ par tools/gen-hedra-prompts.mjs depuis shared/hedra-prompts.json — ne pas éditer à la main (${target}).
// Prompt lipsync Hedra Character-3 (version ${src.version}), validé par Axel sur les hooks de l'usine : même prompt partout.`;

const ts = `${head('edge functions')}
export const HEDRA_SLUG_DEFAUT = 'hedra-character-3'
export const HEDRA_PROMPT_VERSION = '${src.version}'
export const HEDRA_PROMPT = ${JSON.stringify(P)}
`;
const mjs = `${head('render-worker')}
export const HEDRA_SLUG_DEFAUT = 'hedra-character-3'
export const HEDRA_PROMPT_VERSION = '${src.version}'
export const HEDRA_PROMPT = ${JSON.stringify(P)}
`;
const js = `${head('app')}
// window.AA_HEDRA_PROMPT / AA_HEDRA_PROMPT_VERSION.
window.AA_HEDRA_PROMPT = ${JSON.stringify(P)};
window.AA_HEDRA_PROMPT_VERSION = '${src.version}';
`;
const OUT = [
  ['../app/hedra-prompts.js', js],
  ['../supabase/functions/_shared/hedra-prompts.ts', ts],
  ['../render-worker/hedra-prompts.mjs', mjs],
];
if (process.argv.includes('--check')) {
  const stale = OUT.filter(([p, c]) => { const u = new URL(p, import.meta.url); return !existsSync(u) || readFileSync(u, 'utf8') !== c; }).map(([p]) => p);
  if (stale.length) { console.error('À régénérer (node tools/gen-hedra-prompts.mjs) :', stale.join(', ')); process.exit(1); }
  console.log('OK : les 3 modules sont à jour (' + src.version + ')');
} else {
  for (const [p, c] of OUT) writeFileSync(new URL(p, import.meta.url), c);
  console.log('OK : prompt', P.length, 'caractères →', OUT.map(([p]) => p.slice(3)).join(' + '));
}
