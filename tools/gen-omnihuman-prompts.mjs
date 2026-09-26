// Génère les trois modules du prompt OmniHuman 1.5 (app JS, edge TS, render-worker ESM) depuis shared/omnihuman-prompts.json
// — SOURCE UNIQUE (Axel 25/09 : OmniHuman passe chez kie pour les clients ; kie limite le prompt à 300 caractères).
// Usage : node tools/gen-omnihuman-prompts.mjs            (écrit les 3 fichiers)
//         node tools/gen-omnihuman-prompts.mjs --check    (vérifie seulement que les 3 fichiers sont à jour ; code 1 sinon)
// Refuse d'écrire si un prompt dépasse maxLen, n'est pas en ASCII imprimable (anglais), ou si une variante manque.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SRC = new URL('../shared/omnihuman-prompts.json', import.meta.url);
const src = JSON.parse(readFileSync(SRC, 'utf8'));
const MAX = Number(src.maxLen);
const KEYS = ['standard_mains', 'standard_sans_mains', 'courte', 'vivante_mains', 'vivante_sans_mains'];
if (!(MAX > 0 && MAX <= 300)) throw new Error('maxLen invalide (1..300, limite kie) : ' + src.maxLen);
for (const k of KEYS) {
  const p = src.prompts && src.prompts[k];
  if (typeof p !== 'string' || !p.trim()) throw new Error('prompt manquant : ' + k);
  if (p.length > MAX) throw new Error(`prompt ${k} : ${p.length} caractères > ${MAX}`);
  if (!/^[\x20-\x7e]+$/.test(p)) throw new Error(`prompt ${k} : caractère non ASCII (le prompt part en anglais, sans accent ni guillemet typographique)`);
}
const extra = Object.keys(src.prompts).filter((k) => !KEYS.includes(k));
if (extra.length) throw new Error('variante inconnue : ' + extra.join(', '));

const data = JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, src.prompts[k]])), null, 1);
// Choix de la variante — MÊME code dans les trois cibles (généré ici, jamais recopié à la main).
//   hands : les mains sont DANS la photo (détection de l'app) ; sans détection → false (on ne les invente pas).
//   level : 'still' (figé) | 'gestures' (défaut) | 'alive' (vivant) ; role : 'hook' | 'cta' | autre.
const helperJs = `
function omnihumanPrompt(o) {
  o = o || {};
  const P = OMNIHUMAN_PROMPTS, hands = o.hands === true;
  if (o.level === 'still') return P.courte;
  if (o.level === 'alive' && (o.role === 'hook' || o.role === 'cta')) return hands ? P.vivante_mains : P.vivante_sans_mains;
  return hands ? P.standard_mains : P.standard_sans_mains;
}
// Coupe tout prompt (surcharge du compte propriétaire, plan.lipsyncPrompt…) à OMNIHUMAN_PROMPT_MAX : kie refuse au-delà.
// Coupe sur le dernier espace quand il reste au moins 60 % du texte (pas de mot tronqué), sinon net.
function clampOmnihumanPrompt(s) {
  const t = String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  if (t.length <= OMNIHUMAN_PROMPT_MAX) return t;
  let c = t.slice(0, OMNIHUMAN_PROMPT_MAX);
  const sp = c.lastIndexOf(' ');
  if (sp >= OMNIHUMAN_PROMPT_MAX * 0.6) c = c.slice(0, sp);
  return c.trim();
}`;
const head = (target) => `// GÉNÉRÉ par tools/gen-omnihuman-prompts.mjs depuis shared/omnihuman-prompts.json — ne pas éditer à la main (${target}).
// Prompt OmniHuman 1.5 (version ${src.version}) : anglais, ${MAX} caractères maximum (limite kie). ${src.choix}`;

const ts = `${head('edge functions')}
export type OmnihumanPromptKey = ${KEYS.map((k) => `'${k}'`).join(' | ')}
export const OMNIHUMAN_PROMPT_MAX = ${MAX}
export const OMNIHUMAN_PROMPTS_VERSION = '${src.version}'
export const OMNIHUMAN_PROMPTS: Record<OmnihumanPromptKey, string> = ${data}
${helperJs
  .replace('function omnihumanPrompt(o) {\n  o = o || {};', "export function omnihumanPrompt(o: { hands?: boolean; level?: string; role?: string } = {}): string {")
  .replace('function clampOmnihumanPrompt(s) {', 'export function clampOmnihumanPrompt(s: unknown): string {')}
`;
const mjs = `${head('render-worker')}
export const OMNIHUMAN_PROMPT_MAX = ${MAX}
export const OMNIHUMAN_PROMPTS_VERSION = '${src.version}'
export const OMNIHUMAN_PROMPTS = Object.freeze(${data})
${helperJs.replace('function omnihumanPrompt(o)', 'export function omnihumanPrompt(o)').replace('function clampOmnihumanPrompt(s)', 'export function clampOmnihumanPrompt(s)')}
`;
const js = `${head('app')}
// window.AA_OMNIHUMAN_PROMPTS / AA_OMNIHUMAN_PROMPT({ hands, level, role }) / AA_OMNIHUMAN_CLAMP(texte) / AA_OMNIHUMAN_MAX.
(function(){
const OMNIHUMAN_PROMPT_MAX = ${MAX};
const OMNIHUMAN_PROMPTS = Object.freeze(${data});
${helperJs}
window.AA_OMNIHUMAN_PROMPTS = OMNIHUMAN_PROMPTS; window.AA_OMNIHUMAN_PROMPT = omnihumanPrompt; window.AA_OMNIHUMAN_CLAMP = clampOmnihumanPrompt;
window.AA_OMNIHUMAN_MAX = OMNIHUMAN_PROMPT_MAX; window.AA_OMNIHUMAN_VERSION = '${src.version}';
})();
`;
const OUT = [
  ['../app/omnihuman-prompts.js', js],
  ['../supabase/functions/_shared/omnihuman-prompts.ts', ts],
  ['../render-worker/omnihuman-prompts.mjs', mjs],
];
if (process.argv.includes('--check')) {
  const stale = OUT.filter(([p, c]) => { const u = new URL(p, import.meta.url); return !existsSync(u) || readFileSync(u, 'utf8') !== c; }).map(([p]) => p);
  if (stale.length) { console.error('À régénérer (node tools/gen-omnihuman-prompts.mjs) :', stale.join(', ')); process.exit(1); }
  console.log('OK : les 3 modules sont à jour (' + src.version + ')');
} else {
  for (const [p, c] of OUT) writeFileSync(new URL(p, import.meta.url), c);
  console.log('OK :', KEYS.length, 'prompts ≤', MAX, 'caractères →', OUT.map(([p]) => p.slice(3)).join(' + '));
}
