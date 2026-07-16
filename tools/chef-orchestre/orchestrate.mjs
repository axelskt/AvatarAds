#!/usr/bin/env node
/**
 * Chef d'orchestre V0 (local) — transcript + script + scene-map → plan.json
 *
 * Rôle : produire le PLAN DE MONTAGE à partir de ce que dit l'audio.
 *  - le script fournit le TEXTE exact (sous-titres fiables) ;
 *  - la transcription Whisper fournit le TIMING mot-à-mot (alignement forcé) ;
 *  - la scene-map décrit les cibles zoomables de l'écran (rect + mots-clés).
 *
 * En production, cette étape devient une edge function Supabase : Claude
 * (ANTHROPIC_API_KEY) reçoit transcript + scene-map + assets utilisateur et
 * émet le même plan.json (même schéma, version "0.1").
 *
 * Usage :
 *   node scripts/orchestrate.mjs \
 *     --script script/script.json \
 *     --transcript assets/vo/transcript.json \
 *     --scene scene-maps/express.json \
 *     --audio assets/vo/narration.wav \
 *     --out plan.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ---------- CLI args ----------
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const need = (k, def) => args[k] || def || (() => { throw new Error(`--${k} manquant`); })();
const scriptPath = need('script', 'script/script.json');
const transcriptPath = need('transcript', 'assets/vo/transcript.json');
const scenePath = need('scene', 'scene-maps/express.json');
const audioPath = need('audio', 'assets/vo/narration.wav');
const outPath = need('out', 'plan.json');

const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
const audioDuration = parseFloat(
  execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`).toString().trim()
);

// ---------- normalisation ----------
const norm = (w) => w
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '');

const lev = (a, b) => {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
};
const sim = (a, b) => {
  if (!a.length && !b.length) return 1;
  const d = lev(a, b);
  return 1 - d / Math.max(a.length, b.length);
};

// ---------- 1. aplatir le script en mots (avec id de ligne) ----------
const scriptWords = [];
script.lines.forEach((line, li) => {
  const words = line.text.split(/\s+/).map((w) => w.trim()).filter((w) => /[\p{L}\p{N}]/u.test(w));
  words.forEach((w) => scriptWords.push({ text: w, key: norm(w), lineIndex: li }));
});
const tWords = transcript.map((w) => ({ ...w, key: norm(w.text) })).filter((w) => w.key.length > 0);

// ---------- 2. alignement forcé (Needleman-Wunsch mots script ↔ mots transcript) ----------
const GAP = -0.45;
const S = scriptWords.length, T = tWords.length;
const dp = Array.from({ length: S + 1 }, () => new Float64Array(T + 1));
const bt = Array.from({ length: S + 1 }, () => new Uint8Array(T + 1)); // 1=diag 2=up(gap transcript) 3=left(gap script)
for (let i = 1; i <= S; i++) { dp[i][0] = i * GAP; bt[i][0] = 2; }
for (let j = 1; j <= T; j++) { dp[0][j] = j * GAP; bt[0][j] = 3; }
for (let i = 1; i <= S; i++) {
  for (let j = 1; j <= T; j++) {
    const match = dp[i - 1][j - 1] + (sim(scriptWords[i - 1].key, tWords[j - 1].key) * 2 - 1); // [-1..1]
    const up = dp[i - 1][j] + GAP;
    const left = dp[i][j - 1] + GAP;
    if (match >= up && match >= left) { dp[i][j] = match; bt[i][j] = 1; }
    else if (up >= left) { dp[i][j] = up; bt[i][j] = 2; }
    else { dp[i][j] = left; bt[i][j] = 3; }
  }
}
// backtrack : pour chaque mot du script, le mot transcript apparié (ou null)
let i = S, j = T;
while (i > 0 || j > 0) {
  const move = bt[i][j];
  if (move === 1) { scriptWords[i - 1].t = tWords[j - 1]; i--; j--; }
  else if (move === 2) { i--; }
  else { j--; }
}

// ---------- 3. timing par mot (interpolation pour les non-appariés) ----------
scriptWords.forEach((w, idx) => {
  if (w.t) { w.start = w.t.start; w.end = w.t.end; w.matched = true; }
  else { w.matched = false; w.idx = idx; }
});
// interpolation proportionnelle à la longueur entre voisins appariés
for (let a = 0; a < scriptWords.length; a++) {
  if (scriptWords[a].matched) continue;
  let lo = a - 1; while (lo >= 0 && !scriptWords[lo].matched) lo--;
  let hi = a + 1; while (hi < scriptWords.length && !scriptWords[hi].matched) hi++;
  const t0 = lo >= 0 ? scriptWords[lo].end : 0;
  const t1 = hi < scriptWords.length ? scriptWords[hi].start : audioDuration;
  const span = scriptWords.slice(lo + 1, hi);
  const totalChars = span.reduce((s, w) => s + w.key.length, 0) || 1;
  let cursor = t0;
  for (const w of span) {
    const d = (t1 - t0) * (w.key.length / totalChars);
    w.start = cursor; w.end = cursor + d; cursor += d;
  }
}
// monotonie + durée minimale d'affichage
for (let a = 0; a < scriptWords.length; a++) {
  const w = scriptWords[a];
  if (a > 0) w.start = Math.max(w.start, scriptWords[a - 1].end);
  w.end = Math.max(w.end, w.start + 0.14);
  if (a < scriptWords.length - 1) w.end = Math.min(w.end, Math.max(w.start + 0.14, scriptWords[a + 1].start + 0.06));
}

// ---------- 4. bornes de chaque ligne + choix de la cible (mots-clés scene-map) ----------
const lines = script.lines.map((line, li) => {
  const words = scriptWords.filter((w) => w.lineIndex === li);
  const keys = words.map((w) => w.key);
  let best = null, bestScore = 0;
  for (const [tid, target] of Object.entries(scene.targets)) {
    let score = 0;
    for (const kw of target.keywords) {
      for (const k of keys) if (k === kw || sim(k, kw) >= 0.8) score++;
    }
    if (score > bestScore) { bestScore = score; best = tid; }
  }
  return {
    ...line,
    start: words[0].start,
    end: words[words.length - 1].end,
    target: best,
    camera: best ? 'target' : 'wide',
    words,
  };
});

// ---------- 5. segments caméra + SFX ----------
const style = { anticipation: 0.15, moveDuration: 0.5, tailSeconds: 0.6 };
const duration = Math.round((audioDuration + style.tailSeconds) * 10) / 10;
const segments = [];
const sfx = [];
lines.forEach((line, li) => {
  const start = li === 0 ? 0 : lines[li].start;
  const end = li < lines.length - 1 ? lines[li + 1].start : duration;
  const seg = {
    id: line.id,
    role: line.role,
    camera: line.camera,
    target: line.target,
    start: Math.round(start * 100) / 100,
    end: Math.round(end * 100) / 100,
    speechStart: Math.round(line.start * 100) / 100,
    speechEnd: Math.round(line.end * 100) / 100,
  };
  if (line.emphasis) seg.emphasis = line.emphasis;
  segments.push(seg);
});
// whoosh à chaque changement de caméra, clic sur l'emphase
for (let s = 1; s < segments.length; s++) {
  const prev = segments[s - 1], cur = segments[s];
  const moved = prev.camera !== cur.camera || prev.target !== cur.target;
  if (moved) sfx.push({ kind: 'whoosh', at: Math.round(Math.max(0, cur.start - style.anticipation) * 100) / 100 });
  if (cur.emphasis === 'pulse') sfx.push({ kind: 'click', at: Math.round(Math.max(cur.speechEnd - 0.45, cur.speechStart) * 100) / 100 });
}

// ---------- 6. sous-titres mot-à-mot (texte exact du script, timing aligné) ----------
const accentKeys = new Set();
for (const line of lines) {
  if (!line.target) continue;
  for (const kw of scene.targets[line.target].keywords) accentKeys.add(kw);
}
const captions = scriptWords.map((w) => ({
  text: w.text.replace(/[«»"']/g, '').replace(/[.,!?;:…]+$/, '').toUpperCase(),
  start: Math.round(w.start * 100) / 100,
  end: Math.round(w.end * 100) / 100,
  accent: [...accentKeys].some((kw) => w.key === kw || sim(w.key, kw) >= 0.8),
}));

// ---------- 7. plan.json ----------
const plan = {
  version: '0.1',
  generator: 'orchestrate.mjs v0 (heuristique locale — en prod : Claude via edge function)',
  format: { width: 1080, height: 1920, fps: 30, duration },
  scene: scenePath,
  audio: { narration: { src: audioPath, start: 0, duration: Math.round(audioDuration * 1000) / 1000 } },
  style,
  segments,
  captions,
  sfx,
  diagnostics: {
    scriptWords: S,
    transcriptWords: T,
    matched: scriptWords.filter((w) => w.matched).length,
    interpolated: scriptWords.filter((w) => !w.matched).length,
  },
};
writeFileSync(outPath, JSON.stringify(plan, null, 2));
console.log(`plan.json écrit → ${outPath}`);
console.log(`  durée ${duration}s · ${segments.length} segments · ${captions.length} sous-titres · ${sfx.length} sfx`);
console.log(`  alignement : ${plan.diagnostics.matched}/${S} mots appariés, ${plan.diagnostics.interpolated} interpolés`);
for (const s of segments) {
  console.log(`  [${s.start.toFixed(2)}→${s.end.toFixed(2)}] ${s.id} · caméra=${s.camera}${s.target ? ':' + s.target : ''}${s.emphasis ? ' · ' + s.emphasis : ''}`);
}
