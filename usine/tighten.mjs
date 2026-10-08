#!/usr/bin/env node
// Creative Factory — RESSERRER une prise parlée (08/10, Axel : « y'a pas moyen de supprimer les blancs, ça fait pas naturel la
// voix »). Omni Flash laisse des blancs au milieu des phrases (0,15 à 0,45 s) qui trahissent l'IA. On les coupe dans l'image ET
// le son (jump cut, comme un créateur qui monte sa vidéo), en gardant un souffle de PAD s autour de chaque mot ; à chaque coupe,
// le cadre alterne entre 100 % et ZOOM (léger recadrage centré) pour que le raccord se lise comme un choix de montage.
// Silences mesurés sur le son (pas sur la transcription). Début et fin coupés au premier / dernier son.
//
// FIN GARDÉE (Axel 08/10 : « laisse la fin pour pas que ça coupe trop tôt, garde la fin du clip complet ») : on ne coupe
// que les blancs ENTRE les mots et avant le premier ; après le dernier mot, le clip va jusqu'au bout (la bouche se referme,
// le geste se termine). --keepend 0 pour couper aussi la fin au dernier son ; --tail S pour finir S secondes après le
// dernier son (Axel 08/10 : sur certains clips Omni l'avatar reste muet 1 à 2 s, « y'a au moins 2 secondes en trop »).
//
// DÉRUSH PROPRE (Axel 08/10 : « H78 / A3-5 faut refaire le dérush, c'est pas propre ») : entre deux mots, un « blanc » au
// seuil −12 dB commence par la FIN DU MOT qui s'éteint (−20 à −30 dB sous la voix) et ne devient vrai silence (−35 à −50)
// qu'ensuite. Couper au seuil −12 tranchait ces fins de mot et des sons faibles (« qu'avec », « gratuitement », « Claude »),
// et les micro-coupes de 0,10 s faisaient sauter l'image pour 0,02 s gagnées. Donc, DANS la prise, on ne retire que le
// vrai silence : trames à plus de DEEP (24) dB sous la voix, sur ≥ MIN (0,20) s, et jamais un passage où la transcription
// Whisper (captions.mjs emit, lancée ici si --words n'est pas donné) place le milieu d'un mot. Le seuil −12 ne sert plus
// qu'au début (avant le 1er mot) et à la fin.
//
// usage : node usine/tighten.mjs <entrée.mp4> <sortie.mp4> [--min 0.20] [--deep 24] [--pad 0.04] [--zoom 1.06]
//         [--rel 12 | --db -34] [--keepend 0 | --tail 0.4] [--words mots.json | --words none] [--cut 3.62-4.47,…]
// --cut a-b : retire EXACTEMENT ce passage (secondes de l'entrée), en plus des blancs — un mot inventé par le modèle
// (Axel 08/10, H70 : « réseaux dentés ? ») ; même raccord que les autres coupes (zoom alterné si ≥ 0,25 s).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [src, out, ...rest] = process.argv.slice(2);
if (!src || !out) { console.error('usage: tighten.mjs <entrée.mp4> <sortie.mp4> [--min 0.20] [--deep 24] [--pad 0.04] [--zoom 1.06] [--rel 12 | --db -34] [--keepend 0 | --tail 0.4] [--words mots.json | none]'); process.exit(1); }
const OPT = {}; for (let i = 0; i < rest.length; i += 2) { const v = rest[i + 1]; OPT[rest[i].replace(/^--/, '')] = Number.isFinite(+v) ? +v : v; }
const MIN = OPT.min ?? 0.20, PAD = OPT.pad ?? 0.04, ZOOM = OPT.zoom ?? 1.06, DB = OPT.db;

const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString());
const [W, H] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).toString().trim().split(',').map(Number);
// Silences mesurés sur le son, avec un seuil RELATIF à la voix du clip (niveau de parole = 75e centile des trames de 20 ms,
// seuil = parole − REL dB) : un seuil fixe ratait les blancs « soufflés » (−31 à −34 dB pour une voix à −20, 08/10).
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2), F = 320, nF = Math.floor(x.length / F);
const lv = Array.from({ length: nF }, (_, k) => { let e = 0; for (let i = k * F; i < (k + 1) * F; i++) e += x[i] * x[i]; return 10 * Math.log10(e / F + 1e-12); });
const sorted = [...lv].sort((a, b) => a - b), speech = sorted[Math.floor(sorted.length * 0.75)];
const TH = Number.isFinite(OPT.db) ? DB : speech - (OPT.rel ?? 12);
// mots de la prise (Whisper) : garde-fou contre les coupes à l'intérieur d'un mot
let words = [];
if (OPT.words !== 'none') {
  let wf = typeof OPT.words === 'string' ? OPT.words : null, tmp = null;
  if (!wf) {
    tmp = mkdtempSync(join(tmpdir(), 'tighten-')); const wav = join(tmp, 'a.wav'); wf = join(tmp, 'w.json');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav]);
    const here = dirname(fileURLToPath(import.meta.url));
    spawnSync(process.execPath, [join(here, 'captions.mjs'), 'emit', wav, '0', wf], { cwd: dirname(here), stdio: 'ignore' });
  }
  try { words = JSON.parse(readFileSync(wf, 'utf8')); if (words && words.words) words = words.words; } catch { words = []; }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (!Array.isArray(words) || !words.length) { console.error('transcription impossible : --words mots.json, ou --words none pour couper sans garde-fou'); process.exit(2); }
}
const runs = thr => { const r = []; let st = null;
  lv.forEach((v, k) => { if (v < thr) { if (st == null) st = k; } else if (st != null) { r.push([st * F / 16000, k * F / 16000]); st = null; } });
  if (st != null) r.push([st * F / 16000, dur]); return r; };
const DEEP = speech - (OPT.deep ?? 24);
const edge = runs(TH), lead = edge.find(([a, b]) => a === 0 && b >= 0.04), trail = edge.find(([, b]) => b >= dur - 0.001);
const inner0 = lead ? lead[1] : 0, inner1 = trail ? trail[0] : dur;
// milieu d'un mot Whisper dans la partie retirée → on n'y touche pas (Whisper étire les fins de mot : le milieu, pas les bords)
const hasWord = (a, b) => words.some(w => { const m = (w.start + w.end) / 2; return m > a + PAD && m < b - PAD; });
let refused = 0;
const inner = runs(DEEP).filter(([a, b]) => a > inner0 && b < inner1 && b - a >= MIN).filter(([a, b]) => hasWord(a, b) ? (refused++, false) : true);
const forced = String(OPT.cut ?? '').split(',').map(x => x.trim().split('-').map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite) && p[1] > p[0]);
// élargi de PAD : le segment gardé avant finit à a, le suivant reprend à b (les segments sont élargis de PAD plus bas)
const sil = [...(lead ? [lead] : []), ...inner, ...forced.map(([a, b]) => [a - PAD, b + PAD]), ...(trail ? [trail] : [])]
  .sort((x, y) => x[0] - y[0]).reduce((m, r) => { const l = m[m.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else m.push([...r]); return m; }, []);
if (forced.length) console.log(`passage(s) retiré(s) : ${forced.map(([a, b]) => a + '-' + b + ' s').join(', ')}`);
console.log(`voix ${speech.toFixed(1)} dB · ${inner.length} vrai(s) silence(s) coupé(s) dans la prise (sous ${DEEP.toFixed(1)} dB, ≥ ${MIN} s)${refused ? ` · ${refused} gardé(s) : un mot y est entendu` : ''}`);
// segments de parole = complément des silences, élargis de PAD (sans se chevaucher)
const keep = []; let t = 0;
for (const [a, b] of sil) { if (a > t) keep.push([t, a]); t = b; }
if (t < dur) keep.push([t, dur]);
const segs = keep.map(([a, b], i) => [Math.max(0, a - (i === 0 ? 0.02 : PAD)), Math.min(dur, b + PAD)]).filter(([a, b]) => b - a > 0.08);
for (let i = 1; i < segs.length; i++) if (segs[i][0] < segs[i - 1][1]) segs[i][0] = segs[i - 1][1];
if (segs.length && Number.isFinite(OPT.tail)) {   // fin = dernier son + TAIL
  let k = nF - 1; while (k > 0 && lv[k] < TH) k--;
  segs[segs.length - 1][1] = Math.min(dur, (k + 1) * F / 16000 + OPT.tail);
} else if ((OPT.keepend ?? 1) && segs.length) segs[segs.length - 1][1] = dur;   // fin du clip gardée en entier
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
