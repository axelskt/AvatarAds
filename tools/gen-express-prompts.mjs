// Recopie le prompt Express « UGC réel » Omni Flash de l'APP (app/index.html = SOURCE UNIQUE) vers le MCP
// (supabase/functions/_shared/express-prompts.ts). Axel 01/10 : « le MCP doit être prompté pareil que dans l'app ».
// Le code de l'app est EXTRAIT tel quel (fonctions _exp*, verrous _EXP_*, style ugc, enveloppe « CLEAN SHOT ») puis
// rejoué avec les réglages du MCP : style ugc, voix native, moteur Omni (image → vidéo).
// Exporte expressOmniPrompt (photo → vidéo, Omni Flash), expressVeoPrompt (sans photo, Veo Lite) expressImagePrompt (photo de départ générée),
// IMG_REALISM_SUFFIX (images), omniEditPrompt (module Omni) et motionControlPrompt (Motion Control).
// Usage : node tools/gen-express-prompts.mjs            (écrit le fichier)
//         node tools/gen-express-prompts.mjs --check    (vérifie seulement qu'il est à jour ; code 1 sinon)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const app = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
function fn(name) {
  const m = app.match(new RegExp('\\nfunction ' + name + '\\([a-z, ]*\\)\\s*\\{[\\s\\S]*?\\n\\}\\n'));   // (p) ou (p, seg) — _expSpeechLock prend la passe d'une vidéo prolongée (04/10)
  const one = app.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\)\\{[^\\n]*\\}\\n'));
  const r = one || m;
  if (!r) throw new Error('fonction introuvable dans app/index.html : ' + name);
  return r[0].trim();
}
function cst(name) {
  const m = app.match(new RegExp('\\nconst ' + name + '\\s*=\\s*([\'"`])([\\s\\S]*?)\\1\\s*;'));
  if (!m) throw new Error('constante introuvable dans app/index.html : ' + name);
  return m[2].replace(/\\'/g, "'");   // apostrophes échappées du JS de l'app → texte propre
}
function ugcStyle() {
  const m = app.match(/\{ id:'ugc',[^\n]*?prompt:'((?:[^'\\]|\\.)*)'/);
  if (!m) throw new Error("style 'ugc' introuvable dans EXP_STYLES");
  return m[1].replace(/\\'/g, "'");
}
function stmt(re, what) { const m = app.match(re); if (!m) throw new Error(what + ' introuvable dans app/index.html'); return m[0]; }

const FNS = ['_expQuotedLine', '_expCommentKeyword', '_expWantsScenes', '_expEnvLock', '_expSpeechLock', '_expSelfieCue'].map(fn);
const LOCKS = ['_EXP_TEXLOCK', '_EXP_TEXLOCK_OMNI', '_EXP_IDLOCK', '_EXP_HOLDLOCK', '_EXP_ENERGYLOCK', '_EXP_PRODUCTLOCK', '_EXP_FRENCH', '_EXP_FRENCH_END', '_EXP_PIXEL_LOCK', '_EXP_PRODUCT_VIDEO_LOCK'];
const imgP = stmt(/const imgPrompt = prompt \+ ', ' \+ styleMeta\.prompt[^\n]*;/, 'prompt image de départ');
// Depuis le 04/10 (extensions Veo), l'app assemble le prompt par PASSE (_mkAnim) ; le MCP rejoue la passe unique (seg null).
const anim = stmt(/const _mkAnim = [\s\S]*?_EXP_FRENCH_END\);/, 'assemblage _mkAnim') + '\n  const animPrompt = _mkAnim(prompt, null)';
const wrap = stmt(/const _omniPrompt = _EXP_FRENCH \+ _EXP_PIXEL_LOCK \+ _EXP_PRODUCT_VIDEO_LOCK \+ "CLEAN SHOT[^\n]*;/, 'enveloppe _omniPrompt');
for (const k of ['_expSelfieCue()', '_expEnvLock(pr)', '_expSpeechLock(pr, seg)', '_EXP_TEXLOCK_OMNI', '_EXP_PRODUCTLOCK']) if (!anim.includes(k)) throw new Error('assemblage : ' + k + ' absent');
// ── Omni (édition vidéo par prompt) et Motion Control : MÊMES prompts que l'app (Axel 02/10, outils MCP edit_video / motion_control)
const omniFn = fn('_omniBuildPrompt');
const omniLogo = stmt(/const _OMNI_LOGO_FIDELITY = (true|false);/, 'kill-switch _OMNI_LOGO_FIDELITY');
// les constantes du prompt Motion Control vivent DANS _mcGenerate : chacune extraite telle quelle (fin = « ; » en fin de ligne,
// les « ; » à l'intérieur des phrases sont suivis d'un espace, pas d'un saut de ligne)
const MC = ['_mcMotion', '_mcBgTxt', '_mcCamTxt', '_mcRealTxt', '_mcGestTxt', '_mcSafeTxt', '_mcId'].map(k => stmt(new RegExp('const ' + k + ' = [\\s\\S]*?;[ \\t]*\\n'), 'prompt Motion Control ' + k).trim());
if (!/window\._mcPrompt \|\|/.test(MC[0])) throw new Error('_mcMotion : instruction utilisateur (window._mcPrompt) absente');

const ts = `// @ts-nocheck — GÉNÉRÉ par tools/gen-express-prompts.mjs depuis app/index.html — ne pas éditer à la main.
// Prompt Express Omni Flash « UGC réel » de l'app, rejoué à l'identique pour le MCP (style ugc, voix native, Omni).
const window = { _expStyle: 'ugc', _expVoice: 'native', _expVeoModel: 'omni' }
${FNS.join('\n')}
${LOCKS.map(k => `const ${k} = ${JSON.stringify(cst(k))}`).join('\n')}
const styleMeta = { prompt: ${JSON.stringify(ugcStyle())} }
// Omni Flash image → vidéo (photo de départ) : assemblage Express + enveloppe « CLEAN SHOT » de _expOmniImageToVideo.
export function expressOmniPrompt(prompt: string): string {
  window._expVeoModel = 'omni'; const _isOmni = true
  ${anim}
  return (function (prompt) { ${wrap} return _omniPrompt })(animPrompt)
}
// Photo de départ générée quand il n'y a pas d'image (Express : prompt + style ugc + « no text… »), texte de l'app.
export function expressImagePrompt(prompt: string): string {
  ${imgP}
  return imgPrompt
}
// Qualité HAUTE = palier « 4K » de l'app (Axel 02/10) : image Premium puis Nano Banana Pro 4K avec CES consignes, mot pour mot.
export const IMG_REALISM_EDIT = ${JSON.stringify(cst('_IMG_REALISM_EDIT'))}
export const IMG_TEXT_FIDELITY = ${JSON.stringify(cst('_IMG_TEXT_FIDELITY'))}
export const NB_MODEL = ${JSON.stringify(cst('_NB_MODEL'))}
// Images de PERSONNE réalistes : bloc réalisme de l'app (photo amateur + tenue correcte SFW), mot pour mot.
export const IMG_REALISM_SUFFIX = ${JSON.stringify(cst('_IMG_REALISM_SUFFIX'))}
// OMNI — édition vidéo par prompt (module Omni de l'app) : _omniBuildPrompt mot pour mot, kill-switch logo compris.
${omniLogo}
export ${omniFn.replace(/^function _omniBuildPrompt\(p\)/, 'function omniEditPrompt(p: string): string')}
// MOTION CONTROL (module de l'app) : instruction de mouvement (celle de l'utilisateur, sinon celle de l'app) + verrous
// identité / geste / cadrage / décor / caméra / réalisme, tronqué à 2 400 caractères comme dans _mcGenerate.
export function motionControlPrompt(o: { instruction?: string; camFollow?: boolean; keepVidBg?: boolean }): string {
  const window = { _mcPrompt: String(o.instruction || '').trim(), _mcCamFollow: o.camFollow !== false, _mcKeepVidBg: !!o.keepVidBg }
  ${MC.join('\n  ')}
  return (_mcMotion + _mcId).slice(0, 2400)
}
// Veo 3.1 Lite (sans photo) : même assemblage Express que l'app, moteur Veo (verrou de fin de parole compris).
export function expressVeoPrompt(prompt: string): string {
  window._expVeoModel = 'lite'; const _isOmni = false
  ${anim}
  return animPrompt
}
`;
const OUT = new URL('../supabase/functions/_shared/express-prompts.ts', import.meta.url);
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== ts) { console.error('✗ _shared/express-prompts.ts pas à jour : node tools/gen-express-prompts.mjs'); process.exit(1); }
  console.log('✓ express-prompts à jour');
} else { writeFileSync(OUT, ts); console.log('✓ écrit supabase/functions/_shared/express-prompts.ts'); }
