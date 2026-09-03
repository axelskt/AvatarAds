// Génère les deux modules (edge TS + app JS) depuis shared/static-ads-bank.json — source unique.
// Usage : node tools/gen-static-ads-bank.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const bank = JSON.parse(readFileSync(new URL('../shared/static-ads-bank.json', import.meta.url), 'utf8'));
const data = JSON.stringify(bank.formats, null, 1);
const helper = `
// Remplit un gabarit : {KEY} ou {KEY|exemple}. Valeur fournie → texte EXACT entre guillemets ;
// absente → consigne « écris une ligne dans l'esprit de … » (le modèle invente, adapté au produit).
function fillStaticAdTemplate(tpl, v) {
  const q = (s) => '"' + String(s).replace(/["\\n]+/g, ' ').trim() + '"';
  return tpl.replace(/\\{([A-Z_]+)(?:\\|([^}]*))?\\}/g, (_m, key, ex) => {
    const val = v[key];
    if (key === 'BULLETS') {
      const arr = Array.isArray(val) ? val.map((s) => String(s).trim()).filter(Boolean) : (val ? [String(val)] : []);
      if (arr.length) return arr.map(q).join(', ');
      return ex ? 'short French lines in the spirit of « ' + ex.split(';').join(' / ') + ' », adapted to the product (write them yourself, correct spelling)' : 'short French benefit lines adapted to the product';
    }
    if (val !== undefined && val !== null && String(val).trim()) return q(val);
    if (key === 'PRODUCT') return 'the product';
    if (key === 'BRAND') return 'the brand name exactly as written on the product';
    if (ex) return 'a short French line in the spirit of « ' + ex + ' », adapted to the product (write it yourself, correct spelling)';
    return 'a short French line adapted to the product';
  });
}
function pickStaticAdFormat(formats, wanted, seed) {
  const w = String(wanted || '').trim().toLowerCase();
  if (w && w !== 'random' && w !== 'aléatoire' && w !== 'aleatoire') {
    const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
    const hit = formats.find((f) => f.id === w || norm(f.name) === norm(w)) || formats.find((f) => norm(f.name).includes(norm(w)) || f.id.includes(norm(w).replace(/\\s+/g, '-')));
    if (hit) return hit;
  }
  const n = formats.length;
  const i = (typeof seed === 'number' && isFinite(seed)) ? Math.abs(Math.floor(seed)) % n : Math.floor(Math.random() * n);
  return formats[i];
}
const STATIC_AD_COMMON = ' All on-image text is in FRENCH, spelled exactly, legible and never truncated; no other text, no watermark, no fake logos, no gibberish. Every headline, list item and caption must make sense for THIS product and its real category — never invent ingredients, certifications, figures or benefits the product does not have; keep lines short and plausible. The concept stated at the start must be readable at a glance. Photorealistic rendering unless the format says illustration; correct proportions; the product must be recognisable and its label readable.';`;
const helperTs = helper.replace("const q = (s) =>", "const q = (s: unknown) =>").replace("const norm = (s) =>", "const norm = (s: unknown) =>").replace("(_m, key, ex) =>", "(_m: string, key: string, ex?: string) =>").replace("const val = v[key];", "const val = v[key] as unknown;");
const ts = `// GÉNÉRÉ par tools/gen-static-ads-bank.mjs depuis shared/static-ads-bank.json — ne pas éditer à la main.
// Banque de ${bank.formats.length} formats de static ads (${bank.version}).
export type StaticAdFormat = { id: string; name: string; family: string; ratio: string; person: boolean; prompt: string }
export const STATIC_AD_FORMATS: StaticAdFormat[] = ${data} as StaticAdFormat[]
${helperTs.replace(/^function fillStaticAdTemplate\(tpl, v\)/m, 'export function fillStaticAdTemplate(tpl: string, v: Record<string, unknown>): string').replace(/^function pickStaticAdFormat\(formats, wanted, seed\)/m, 'export function pickStaticAdFormat(formats: StaticAdFormat[], wanted?: unknown, seed?: number): StaticAdFormat').replace(/^const STATIC_AD_COMMON/m, 'export const STATIC_AD_COMMON')}
`;
const js = `// GÉNÉRÉ par tools/gen-static-ads-bank.mjs depuis shared/static-ads-bank.json — ne pas éditer à la main.
// Banque de ${bank.formats.length} formats de static ads (${bank.version}) — window.AA_STATIC_ADS / AA_STATIC_ADS_FILL / AA_STATIC_ADS_PICK / AA_STATIC_ADS_COMMON.
(function(){
const STATIC_AD_FORMATS = ${data};
${helper}
window.AA_STATIC_ADS = STATIC_AD_FORMATS; window.AA_STATIC_ADS_FILL = fillStaticAdTemplate; window.AA_STATIC_ADS_PICK = pickStaticAdFormat; window.AA_STATIC_ADS_COMMON = STATIC_AD_COMMON;
})();
`;
writeFileSync(new URL('../supabase/functions/mcp/static-ads-bank.ts', import.meta.url), ts);
writeFileSync(new URL('../app/static-ads-bank.js', import.meta.url), js);
console.log('OK :', bank.formats.length, 'formats → supabase/functions/mcp/static-ads-bank.ts + app/static-ads-bank.js');
