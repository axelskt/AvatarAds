#!/usr/bin/env node
// Creative Factory — détecteur de RÉPÉTITIONS entre briques (Axel : « fais attention aux répétitions »).
// Compare hook↔hook, liaison↔liaison, cta↔cta sur toutes les briques déjà découpées, et signale les
// quasi-doublons (similarité de Jaccard sur les mots). Deux CTA quasi identiques = à surveiller/varier.
// Usage : node usine/dedup-check.mjs [dossier briques]   (défaut : ~/Downloads/Creative Factory/briques audio)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const base = process.argv[2] || join(homedir(), 'Downloads', 'Creative Factory', 'briques audio');
if (!existsSync(base)) { console.error('dossier introuvable :', base); process.exit(1); }

const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const wset = s => new Set(norm(s).split(' ').filter(w=>w.length>2));            // mots ≥3 lettres (ignore les liants)
const jaccard = (a,b) => { const A=wset(a),B=wset(b); if(!A.size||!B.size) return 0;
  let inter=0; for(const x of A) if(B.has(x)) inter++; return inter/(A.size+B.size-inter); };

// 1) collecte des briques par type
const bricks = { hook:[], liaison:[], cta:[] };
for (const d of readdirSync(base)) {
  const mf = join(base, d, `${d}.manifest.json`);
  if (!existsSync(mf)) continue;
  let m; try { m = JSON.parse(readFileSync(mf,'utf8')); } catch(e){ continue; }
  for (const seg of (m.segs||[])) if (bricks[seg.kind]) bricks[seg.kind].push({ id:seg.id, cartoon:m.cartoon, text:seg.text||'' });
}

// 2) paires quasi identiques par type
const THRESH = 0.6;   // ≥60 % des mots en commun = quasi-doublon
let flagged = 0;
for (const kind of ['hook','liaison','cta']) {
  const list = bricks[kind];
  console.log(`\n=== ${kind.toUpperCase()} (${list.length} briques) ===`);
  const dupes = [];
  for (let i=0;i<list.length;i++) for (let j=i+1;j<list.length;j++) {
    const s = jaccard(list[i].text, list[j].text);
    if (s >= THRESH) dupes.push({ a:list[i], b:list[j], s });
  }
  if (!dupes.length) { console.log('  ✓ aucune répétition (>'+Math.round(THRESH*100)+'%)'); continue; }
  dupes.sort((x,y)=>y.s-x.s);
  for (const d of dupes) {
    flagged++;
    console.log(`  ⚠ ${(d.s*100).toFixed(0)}%  ${d.a.id} ↔ ${d.b.id}`);
    console.log(`      ${d.a.id}: « ${d.a.text.slice(0,80)} »`);
    console.log(`      ${d.b.id}: « ${d.b.text.slice(0,80)} »`);
  }
}
console.log(`\n${flagged? '⚠ '+flagged+' paire(s) à surveiller' : '✓ aucune répétition détectée'} — seuil ${Math.round(THRESH*100)}%.`);
