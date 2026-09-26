#!/usr/bin/env node
// Creative Factory — ZONES DE VISAGE d'un hook (texte choc jamais sur un visage, usine/formats.js chocLayout).
// Extrait une image toutes les `step` s entre `from` et `to` (ffmpeg), détecte les visages (Vision via usine/face-zones.swift,
// compilé une fois dans le dossier temporaire) et rend TOUTES les boîtes vues (normalisées, origine haut-gauche) : le texte
// doit éviter chaque position du visage pendant qu'il est affiché.
// Hors macOS / sans swiftc / échec : faces = null (inconnues) → chocLayout passe la vidéo en revue QC, jamais d'échec du rendu.
// Usage : node usine/face-zones.mjs <video> [from] [to] [step]   → JSON { faces, frames, error }
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'face-zones.swift');
export const MIN_CONFIDENCE = 0.5;

function detector() {
  if (platform() !== 'darwin' || !existsSync(SRC)) return null;
  const h = createHash('sha1').update(readFileSync(SRC)).digest('hex').slice(0, 12);
  const dir = join(tmpdir(), 'usine-face-zones'), bin = join(dir, 'face-zones-' + h);
  if (existsSync(bin)) return bin;
  mkdirSync(dir, { recursive: true });
  const r = spawnSync('swiftc', ['-O', SRC, '-o', bin], { encoding: 'utf8', timeout: 180000 });
  return r.status === 0 && existsSync(bin) ? bin : null;
}

// Fusion : boîtes qui se recouvrent à plus de 50 % (même visage d'une image à l'autre) → rectangle englobant.
export function mergeFaces(list) {
  const out = [];
  for (const f of list) {
    const hit = out.find(g => {
      const w = Math.min(f[0] + f[2], g[0] + g[2]) - Math.max(f[0], g[0]), hh = Math.min(f[1] + f[3], g[1] + g[3]) - Math.max(f[1], g[1]);
      return w > 0 && hh > 0 && (w * hh) / Math.min(f[2] * f[3], g[2] * g[3]) > 0.5;
    });
    if (hit) {
      const x = Math.min(hit[0], f[0]), y = Math.min(hit[1], f[1]);
      hit[2] = Math.max(hit[0] + hit[2], f[0] + f[2]) - x; hit[3] = Math.max(hit[1] + hit[3], f[1] + f[3]) - y; hit[0] = x; hit[1] = y;
    } else out.push(f.slice(0, 4));
  }
  return out.map(f => f.map(v => Math.round(v * 10000) / 10000));
}

export function faceZones(video, from = 0, to = 3, step = 0.5) {
  const bin = detector();
  if (!bin) return { faces: null, frames: 0, error: 'détection indisponible (macOS + swiftc requis)' };
  const work = mkdtempSync(join(tmpdir(), 'faces-'));
  const times = [];
  for (let t = Math.max(0, from); t <= to + 1e-6; t += step) times.push(Math.round(t * 1000) / 1000);
  const files = [];
  for (const [i, t] of times.entries()) {
    const f = join(work, 'f' + String(i).padStart(3, '0') + '.jpg');
    try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-q:v', '3', f]); } catch { continue; }
    if (existsSync(f)) files.push(f);
  }
  if (!files.length) return { faces: null, frames: 0, error: 'aucune image extraite' };
  const r = spawnSync(bin, files, { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) return { faces: null, frames: files.length, error: 'détecteur en échec' };
  const all = [];
  let bad = 0;
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    let o; try { o = JSON.parse(line); } catch { bad += 1; continue; }
    if (o.error) { bad += 1; continue; }
    (o.faces || []).filter(f => f[4] == null || f[4] >= MIN_CONFIDENCE).forEach(f => all.push(f));
  }
  if (bad === files.length) return { faces: null, frames: files.length, error: 'images illisibles' };
  return { faces: mergeFaces(all), frames: files.length - bad, error: null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [video, from, to, step] = process.argv.slice(2);
  if (!video) { console.error('usage: face-zones.mjs <video> [from] [to] [step]'); process.exit(2); }
  console.log(JSON.stringify(faceZones(video, +(from || 0), +(to || 3), +(step || 0.5))));
}
