#!/usr/bin/env node
// Creative Factory — RESSERRER une prise parlée (08/10, Axel : « y'a pas moyen de supprimer les blancs, ça fait pas naturel la
// voix »). Omni Flash laisse des blancs au milieu des phrases (0,15 à 0,45 s) qui trahissent l'IA. On les coupe dans l'image ET
// le son (jump cut, comme un créateur qui monte sa vidéo), en gardant un souffle de PAD s autour de chaque mot ; à chaque coupe,
// le cadre alterne entre 100 % et ZOOM (léger recadrage centré) pour que le raccord se lise comme un choix de montage.
// Silences mesurés sur le son (pas sur la transcription). Début et fin coupés au premier / dernier son.
//
// FIN GARDÉE (Axel 08/10 : « laisse la fin pour pas que ça coupe trop tôt, garde la fin du clip complet ») : on ne coupe
// que les blancs ENTRE les mots et avant le premier ; après le dernier mot, le clip va jusqu'au bout (la bouche se referme,
// le geste se termine). --keepend 0 pour couper aussi la fin au dernier son.
//
// usage : node usine/tighten.mjs <entrée.mp4> <sortie.mp4> [--min 0.10] [--pad 0.04] [--zoom 1.06] [--rel 12 | --db -34] [--keepend 0]
import { execFileSync, spawnSync } from 'node:child_process';

const [src, out, ...rest] = process.argv.slice(2);
if (!src || !out) { console.error('usage: tighten.mjs <entrée.mp4> <sortie.mp4> [--min 0.10] [--pad 0.04] [--zoom 1.06] [--rel 12 | --db -34] [--keepend 0]'); process.exit(1); }
const OPT = {}; for (let i = 0; i < rest.length; i += 2) OPT[rest[i].replace(/^--/, '')] = parseFloat(rest[i + 1]);
const MIN = OPT.min ?? 0.10, PAD = OPT.pad ?? 0.04, ZOOM = OPT.zoom ?? 1.06, DB = OPT.db;

const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString());
const [W, H] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).toString().trim().split(',').map(Number);
// Silences mesurés sur le son, avec un seuil RELATIF à la voix du clip (niveau de parole = 75e centile des trames de 20 ms,
// seuil = parole − REL dB) : un seuil fixe ratait les blancs « soufflés » (−31 à −34 dB pour une voix à −20, 08/10).
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2), F = 320, nF = Math.floor(x.length / F);
const lv = Array.from({ length: nF }, (_, k) => { let e = 0; for (let i = k * F; i < (k + 1) * F; i++) e += x[i] * x[i]; return 10 * Math.log10(e / F + 1e-12); });
const sorted = [...lv].sort((a, b) => a - b), speech = sorted[Math.floor(sorted.length * 0.75)];
const TH = Number.isFinite(OPT.db) ? DB : speech - (OPT.rel ?? 12);
const sil = []; let st = null;
lv.forEach((v, k) => { if (v < TH) { if (st == null) st = k; } else if (st != null) { if ((k - st) * F / 16000 >= MIN) sil.push([st * F / 16000, k * F / 16000]); st = null; } });
if (st != null) sil.push([st * F / 16000, dur]);
console.log(`voix ${speech.toFixed(1)} dB · seuil ${TH.toFixed(1)} dB · ${sil.length} silence(s) ≥ ${MIN} s`);
// segments de parole = complément des silences, élargis de PAD (sans se chevaucher)
const keep = []; let t = 0;
for (const [a, b] of sil) { if (a > t) keep.push([t, a]); t = b; }
if (t < dur) keep.push([t, dur]);
const segs = keep.map(([a, b], i) => [Math.max(0, a - (i === 0 ? 0.02 : PAD)), Math.min(dur, b + PAD)]).filter(([a, b]) => b - a > 0.08);
for (let i = 1; i < segs.length; i++) if (segs[i][0] < segs[i - 1][1]) segs[i][0] = segs[i - 1][1];
if ((OPT.keepend ?? 1) && segs.length) segs[segs.length - 1][1] = dur;   // fin du clip gardée en entier
const cut = segs.reduce((s, [a, b]) => s + (b - a), 0);
console.log(`${segs.length} morceau(x) de parole · ${dur.toFixed(2)} s → ${cut.toFixed(2)} s (${(dur - cut).toFixed(2)} s de blancs retirés)`);
if (segs.length <= 1 && dur - cut < 0.08) { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-c', 'copy', out]); process.exit(0); }

const zw = Math.round(W / ZOOM / 2) * 2, zh = Math.round(H / ZOOM / 2) * 2;
// le cadrage ne change qu'aux VRAIES coupes (≥ ZOOM_GAP s retirées) : 8 micro-coupes en 6 s qui zooment chacune = image
// qui saute sans arrêt ; une micro-coupe (0,1 s de moins) ne se voit pas, la tête n'a presque pas bougé
const ZOOM_GAP = OPT.zoomgap ?? 0.25;
let fc = '', cat = '', zoomed = false;
segs.forEach(([a, b], i) => {
  if (i > 0 && a - segs[i - 1][1] >= ZOOM_GAP) zoomed = !zoomed;
  const zoom = zoomed ? `,crop=${zw}:${zh},scale=${W}:${H}:flags=lanczos` : '';
  fc += `[0:v]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=PTS-STARTPTS${zoom},setsar=1[v${i}];`;
  fc += `[0:a]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, b - a - 0.012).toFixed(3)}:d=0.012[a${i}];`;
  cat += `[v${i}][a${i}]`;
});
fc += `${cat}concat=n=${segs.length}:v=1:a=1[v][a]`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
console.log('OK -> ' + out);
