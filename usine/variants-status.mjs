#!/usr/bin/env node
// Creative Factory — dashboard.
//  Génération (coût)  = avatar × type × brique.   (arrière-plan = tag de variété réparti sur les briques, PAS un facteur)
//  Assemblage (gratuit) = avatar × combos(hook×[liaison|court]) × démos.  CTA = aléatoire (pas un facteur).
//  Missions = vidéos postées.
import { readFileSync, readdirSync } from 'node:fs';
import { hooks, compatLiaisons } from './gen-coherence-matrix.mjs';
const REG = JSON.parse(readFileSync(new URL('./variants-registry.json', import.meta.url), 'utf8'));
const BASE = '/Users/axelskotnicki/Downloads/Creative Factory/briques audio';
const bricks = [];
for (const d of readdirSync(BASE).filter(x => x.startsWith('cartoon-'))) { let m; try { m = JSON.parse(readFileSync(`${BASE}/${d}/${d}.manifest.json`, 'utf8')); } catch { continue; }
  for (const s of (m.segs || [])) if (['hook','liaison','cta'].includes(s.kind)) bricks.push({ id: s.id.replace('-audio',''), kind: s.kind }); }
const nH = bricks.filter(b=>b.kind==='hook').length, nL = bricks.filter(b=>b.kind==='liaison').length, nCTA = bricks.filter(b=>b.kind==='cta').length;
const B = bricks.length, T = REG.variantTypes.length, D = REG.demos.length || 1;
const combos = hooks.reduce((t,[id]) => t + compatLiaisons(id).length + 1, 0);   // Σ (liaisons compat + court) = 375

const A = REG.avatars.length;
const genPossible = A * B * T;          // arrière-plan = réparti sur les briques, pas un facteur
const asmPossible = A * combos * D;
const genCreees = new Set(REG.created.filter(c=>c.videoId).map(c=>`${c.avatarId}|${c.type}|${c.brickId}`)).size;
const asmCreees = REG.assembled.filter(a=>a.videoId).length;

console.log(`Avatars ${A} · Démos ${REG.demos.length} · Briques ${B} (${nH}H/${nL}L/${nCTA}CTA) · Types ${T} · Combos ${combos}`);
console.log('');
console.log('① VARIANTES AVATAR (génération = le coût)  [avatar × type × brique · arrière-plan = variété, pas un facteur]');
console.log(`   possibles : ${genPossible.toLocaleString()}`);
console.log(`   créées    : ${genCreees.toLocaleString()}`);
console.log(`   NON CRÉÉES: ${(genPossible - genCreees).toLocaleString()}`);
console.log('');
console.log('② VARIANTES ASSEMBLÉES (vidéos)  [avatar × combos × démos ; CTA + arrière-plan = variété]');
console.log(`   possibles : ${asmPossible.toLocaleString()}`);
console.log(`   créées    : ${asmCreees.toLocaleString()}`);
console.log('');
console.log(`③ MISSIONS réalisées (postées) : ${REG.missions.length.toLocaleString()}`);
