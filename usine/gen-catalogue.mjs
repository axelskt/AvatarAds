#!/usr/bin/env node
// Creative Factory — génère le CATALOGUE D'ASSEMBLAGE depuis la matrice de cohérence.
// Pour chaque hook : combo COURT (H+démo+CTA) + combos LONGS (H+liaison+démo+CTA).
// CTA = universel (se marie avec tous les hooks). Démo = choisie selon le module du hook (à mapper).
import { hooks, compatLiaisons } from './gen-coherence-matrix.mjs';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const BASE = '/Users/axelskotnicki/Downloads/Creative Factory/briques audio';
const dirs = readdirSync(BASE).filter(d => d.startsWith('cartoon-'));
let cta = [], liaB = [], hookB = [];
for (const d of dirs) { let m; try { m = JSON.parse(readFileSync(`${BASE}/${d}/${d}.manifest.json`, 'utf8')); } catch { continue; }
  for (const s of (m.segs || [])) { const r = { id: s.id.replace('-audio',''), dur: +s.dur || 0 };
    if (s.kind === 'cta') cta.push(r); else if (s.kind === 'liaison') liaB.push(r); else if (s.kind === 'hook') hookB.push(r); } }
const sum = a => a.reduce((t, x) => t + x.dur, 0);
let totalLong = 0;
let md = `# Catalogue d'assemblage\n\n`;
md += `Deux formats par vidéo : **court** \`hook + démo + CTA\` · **long** \`hook + liaison + démo + CTA\`.\n`;
md += `**CTA = universel** (chaque CTA se marie avec chaque hook). **Démo** = choisie selon le module du hook (mapping à faire).\n\n`;
md += `Briques dispo : **${hookB.length} hooks** · **${liaB.length} liaisons** (12 distinctes) · **${cta.length} CTA**.\n\n`;
md += `## Combos par hook (liaisons compatibles)\n\n| Hook | Court | Longs | Liaisons compatibles |\n|---|:-:|:-:|---|\n`;
for (const [id] of hooks) { const L = compatLiaisons(id); totalLong += L.length;
  md += `| **H${id}** | 1 | ${L.length} | ${L.join(', ') || '—'} |\n`; }
md += `\n**Total structurel** : ${hooks.length} courts + ${totalLong} longs = **${hooks.length + totalLong} combos** (avant multiplication par avatar × CTA × démo × type de variante).\n`;
writeFileSync('usine/catalogue-assemblage.md', md);
console.log(`catalogue: ${hooks.length} courts + ${totalLong} longs = ${hooks.length + totalLong} combos`);
