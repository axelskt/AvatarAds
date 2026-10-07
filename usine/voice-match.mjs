#!/usr/bin/env node
// Creative Factory — VOIX HOMOGÈNE (Axel 07/10 : « le lipsync du hook et de la liaison n'a pas la même intonation » puis
// « traite tous les audios avec le même traitement, comme ça tous les audios ont le même »).
// Les briques parlées (hooks, liaisons, CTA) ont été enregistrées à des moments différents, certaines déjà traitées :
// H14 sortait à −29,5 LUFS, sourd, 129 Hz, L16 à −13,8 LUFS, brillant, 141 Hz. Ce script mesure chaque brique (à niveau
// égal) : timbre en tiers d'octave et hauteur de voix médiane, puis calcule SA correction vers la MOYENNE de toutes :
//   eq    = gains firequalizer (cible − brique, bornés à ±8 dB, ±4 dB sous 150 Hz, lissés)
//   pitch = rapport de hauteur (médiane globale / médiane de la brique, borné à ±6 %), appliqué SANS changer la durée
// Résultat écrit dans factory_bricks.meta.voice_fix ; usine/build.mjs l'applique au montage, avant la chaîne voix VCH,
// sur l'audio EMBARQUÉ des clips (variants lipsync déjà générés compris : durée identique = synchro labiale gardée).
// Une brique dont la voix s'écarte de plus de 25 % de la médiane (autre locuteur, voix off féminine) est laissée telle quelle.
//
// usage : node usine/voice-match.mjs --bricks bricks.json [--sql out.sql]
//   bricks.json = lignes factory_bricks (id, kind, status, meta) ; seules les briques prêtes hook / liaison / cta avec
//   un meta.media audio (.wav/.mp3/.m4a) sont mesurées.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const OPT = {};
for (let a = process.argv.slice(2), i = 0; i < a.length; i++) if (a[i].startsWith('--')) OPT[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
if (!OPT.bricks) { console.error('usage: voice-match.mjs --bricks bricks.json [--sql out.sql]'); process.exit(1); }

export const CF = Array.from({ length: 22 }, (_, i) => 100 * 2 ** (i / 3));   // 100 Hz → 12,7 kHz
// hauteur ±6 % au plus (Axel a validé ×1,058 à l'oreille sur H14 ; au-delà la voix sonne trafiquée) ; graves < 150 Hz
// bornés à ±4 dB (sinon on remonte le bruit de pièce)
export const EQ_MAX = 8, EQ_LOW_MAX = 4, PITCH_MAX = 0.06, OTHER_SPEAKER = 0.25;

function pcm(src, sr) {   // mono float32, niveau commun (−20 LUFS) pour comparer des timbres et non des volumes
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-af', 'loudnorm=I=-20:TP=-2', '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
}
function fft(re, im) {   // radix 2, sur place
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// Timbre : spectre moyen (Welch, trames de parole seulement) ramené en niveaux relatifs par tiers d'octave
export function bandLevels(x, sr = 48000) {
  const N = 4096, H = 2048, win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const psd = new Float64Array(N / 2 + 1); let frames = 0;
  for (let s = 0; s + N <= x.length; s += H) {
    let e = 0; for (let i = 0; i < N; i++) e += x[s + i] * x[s + i];
    if (Math.sqrt(e / N) < 0.01) continue;   // silence
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * win[i];
    fft(re, im); for (let k = 0; k <= N / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k]; frames++;
  }
  if (!frames) return null;
  let tot = 0; for (const v of psd) tot += v;
  return CF.map(c => { const lo = c / 2 ** (1 / 6), hi = c * 2 ** (1 / 6); let s = 0;
    for (let k = 0; k <= N / 2; k++) { const f = k * sr / N; if (f >= lo && f < hi) s += psd[k]; }
    return 10 * Math.log10(s / tot + 1e-12); });
}
// Hauteur : médiane des F0 par autocorrélation (trames de 40 ms, 70-300 Hz, voisées seulement)
export function medianF0(x, sr = 16000) {
  const n = 640, lo = Math.floor(sr / 300), hi = Math.floor(sr / 70), out = [];
  for (let s = 0; s + n <= x.length; s += n / 2) {
    let m = 0, e = 0; for (let i = 0; i < n; i++) m += x[s + i]; m /= n;
    for (let i = 0; i < n; i++) e += (x[s + i] - m) ** 2;
    if (Math.sqrt(e / n) < 0.02) continue;
    let best = -Infinity, bk = 0;
    for (let k = lo; k < hi; k++) { let c = 0; for (let i = 0; i + k < n; i++) c += (x[s + i] - m) * (x[s + i + k] - m); if (c > best) { best = c; bk = k; } }
    if (best > 0.3 * e) out.push(sr / bk);
  }
  if (!out.length) return null;
  out.sort((a, b) => a - b); return out[out.length >> 1];
}

const isAudio = u => /\.(wav|mp3|m4a)(\?|$)/i.test(String(u || ''));
let rows = JSON.parse(readFileSync(OPT.bricks, 'utf8')); if (rows && rows.rows) rows = rows.rows;
const voices = rows.filter(b => b && b.status === 'ready' && ['hook', 'liaison', 'cta'].includes(b.kind) && isAudio((b.meta || {}).media));
console.log(`▶ ${voices.length} briques parlées à mesurer`);
const M = [];
for (const b of voices) {
  try {
    const lv = bandLevels(pcm(b.meta.media, 48000)), f0 = medianF0(pcm(b.meta.media, 16000));
    if (lv && f0) M.push({ id: b.id, lv, f0 }); else console.warn('  ⚠ ' + b.id + ' : pas de parole mesurable');
  } catch (e) { console.warn('  ⚠ ' + b.id + ' : ' + String(e.message || e).slice(0, 120)); }
}
const f0s = M.map(m => m.f0).sort((a, b) => a - b), F0T = f0s[f0s.length >> 1];
const same = M.filter(m => Math.abs(m.f0 / F0T - 1) <= OTHER_SPEAKER), others = M.filter(m => !same.includes(m));
const target = CF.map((_, i) => same.reduce((s, m) => s + m.lv[i], 0) / same.length);
const at = new Date().toISOString().slice(0, 10), sql = [];
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
for (const m of same) {
  let g = m.lv.map((v, i) => { const lim = CF[i] < 150 ? EQ_LOW_MAX : EQ_MAX; return Math.max(-lim, Math.min(lim, target[i] - v)); });
  g = g.map((v, i) => i === 0 || i === g.length - 1 ? v : 0.25 * g[i - 1] + 0.5 * v + 0.25 * g[i + 1]);
  const pitch = Math.max(1 - PITCH_MAX, Math.min(1 + PITCH_MAX, F0T / m.f0));
  const eq = CF.map((c, i) => `entry(${Math.round(c)},${g[i].toFixed(2)})`).join(';');
  const fix = { eq, pitch: +pitch.toFixed(4), f0: Math.round(m.f0), f0_cible: Math.round(F0T), at };
  sql.push(`update public.factory_bricks set meta = meta || jsonb_build_object('voice_fix', ${q(JSON.stringify(fix))}::jsonb) where id = ${q(m.id)};`);
  console.log(`  ${m.id.padEnd(16)} F0 ${String(Math.round(m.f0)).padStart(3)} Hz → ×${pitch.toFixed(3)} · EQ ${g.filter((_, i) => i % 4 === 0).map(v => (v >= 0 ? '+' : '') + v.toFixed(1)).join(' ')} dB`);
}
for (const m of others) console.log(`  ${m.id.padEnd(16)} F0 ${Math.round(m.f0)} Hz : autre voix (> ${OTHER_SPEAKER * 100} % de ${Math.round(F0T)} Hz) → laissée telle quelle`);
console.log(`cible : F0 ${Math.round(F0T)} Hz, ${same.length} briques corrigées, ${others.length} laissées`);
if (OPT.sql) { writeFileSync(OPT.sql, sql.join('\n') + '\n'); console.log('SQL → ' + OPT.sql); }
