#!/usr/bin/env node
// Creative Factory — CONTRÔLE QUALITÉ TECHNIQUE (déterministe, 0 IA).
// Analyse un MP4 rendu et route : 'auto' (tout OK → passe à la QC visuelle) ou 'manual' (un test dur rate → file humaine).
// Checks (spec Axel) : résolution/fps · durée hors bornes · audio absent/saturé · silence anormal ·
//   frame noire · frame figée · musique coupée net à la fin.
// Usage : node usine/qc.mjs <video.mp4> [--json]
import { spawnSync } from 'node:child_process';

const [video, ...rest] = process.argv.slice(2);
const JSON_OUT = rest.includes('--json');
if (!video) { console.error('usage: qc.mjs <video.mp4> [--json]'); process.exit(2); }

// bornes attendues d'un short OMNI (ajustables)
const CFG = { w: 1080, h: 1920, fps: 30, durMin: 8, durMax: 90,
  clipMaxDb: -0.5, silentMeanDb: -50, blackMinS: 0.30, freezeMinS: 1.5, silenceMinS: 2.0, endFadeTolDb: 3 };

// spawnSync : capture stdout ET stderr (ffmpeg écrit blackdetect/volumedetect/etc. sur stderr, même à l'exit 0).
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 27 }); return (r.stdout || '') + (r.stderr || ''); };
const probe = a => sh('ffprobe', ['-v','error', ...a]).trim();

const checks = [];
const add = (name, ok, severity, detail) => checks.push({ name, ok, severity, detail });

// ── ffprobe : dimensions / fps / durée / présence audio ──
const dims = probe(['-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','csv=p=0', video]).split(',');
const W = +dims[0], H = +dims[1];
const fr = (dims[2]||'0/1').split('/'); const FPS = Math.round((+fr[0]) / (+fr[1] || 1));
const DUR = parseFloat(probe(['-show_entries','format=duration','-of','csv=p=0', video])) || 0;
const hasAudio = probe(['-select_streams','a:0','-show_entries','stream=codec_type','-of','csv=p=0', video]).includes('audio');

add('resolution', W===CFG.w && H===CFG.h, 'hard', `${W}x${H} (attendu ${CFG.w}x${CFG.h})`);
add('fps', Math.abs(FPS-CFG.fps)<=1, 'hard', `${FPS} fps (attendu ${CFG.fps})`);
add('duree', DUR>=CFG.durMin && DUR<=CFG.durMax, 'hard', `${DUR.toFixed(2)}s (bornes ${CFG.durMin}-${CFG.durMax}s)`);
add('audio_present', hasAudio, 'hard', hasAudio ? 'piste audio OK' : 'AUCUNE piste audio');

// ── ffmpeg 1 passe : blackdetect + freezedetect (vidéo) · silencedetect + volumedetect (audio) ──
const log = sh('ffmpeg', ['-hide_banner','-nostats','-i', video,
  '-vf', `blackdetect=d=${CFG.blackMinS}:pic_th=0.98,freezedetect=n=-60dB:d=${CFG.freezeMinS}`,
  '-af', `silencedetect=n=-45dB:d=${CFG.silenceMinS},volumedetect`,
  '-f','null','-']);

const mMax = /max_volume:\s*(-?[\d.]+) dB/.exec(log); const maxDb = mMax ? +mMax[1] : null;
const mMean = /mean_volume:\s*(-?[\d.]+) dB/.exec(log); const meanDb = mMean ? +mMean[1] : null;
add('audio_non_sature', maxDb!==null && maxDb <= CFG.clipMaxDb, 'hard', `max ${maxDb ?? '?'} dB (limite ${CFG.clipMaxDb})`);
add('audio_non_muet', meanDb!==null && meanDb > CFG.silentMeanDb, 'hard', `moyen ${meanDb ?? '?'} dB`);

const blacks = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => (+m[2]-+m[1]));
add('pas_de_frame_noire', blacks.length===0, 'hard', blacks.length ? `${blacks.length} segment(s) noir(s), max ${Math.max(...blacks).toFixed(2)}s` : 'aucune');

const freezes = [...log.matchAll(/freeze_start:\s*([\d.]+)[\s\S]*?freeze_end:\s*([\d.]+)/g)].map(m => (+m[2]-+m[1]));
add('pas_de_frame_figee', freezes.length===0, 'hard', freezes.length ? `${freezes.length} gel(s) > ${CFG.freezeMinS}s (max ${Math.max(...freezes).toFixed(2)}s)` : 'aucun');

const sils = [...log.matchAll(/silence_start:\s*(-?[\d.]+)[\s\S]*?silence_duration:\s*([\d.]+)/g)].map(m => +m[2]);
add('pas_de_silence_anormal', sils.length===0, 'hard', sils.length ? `${sils.length} silence(s) > ${CFG.silenceMinS}s (max ${Math.max(...sils).toFixed(2)}s)` : 'aucun');

// ── musique coupée net à la fin : la fin doit être PLUS BASSE que le milieu (preuve d'un fade) ──
const seg = (ss, t) => { const l = sh('ffmpeg', ['-hide_banner','-nostats','-ss', String(ss), '-t', String(t), '-i', video, '-af','volumedetect','-f','null','-']); const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(l); return m ? +m[1] : null; };
const midDb = DUR>2 ? seg(DUR/2, 0.5) : null;
const endDb = DUR>1 ? seg(Math.max(0, DUR-0.4), 0.4) : null;
const fadeOk = (midDb!==null && endDb!==null) ? (endDb <= midDb + CFG.endFadeTolDb) : true;   // la fin ne doit pas être aussi/plus forte que le milieu
add('fin_pas_coupee_net', fadeOk, 'soft', `fin ${endDb ?? '?'} dB vs milieu ${midDb ?? '?'} dB`);

const hardFails = checks.filter(c => c.severity==='hard' && !c.ok);
const softFails = checks.filter(c => c.severity==='soft' && !c.ok);
const route = (hardFails.length || softFails.length) ? 'manual' : 'auto';
const result = { video, route, pass: route==='auto', hard_fails: hardFails.map(c=>c.name), soft_fails: softFails.map(c=>c.name), checks };

if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); }
else {
  console.log(`QC ${video}`);
  for (const c of checks) console.log(`  ${c.ok?'✓':'✗'} [${c.severity}] ${c.name} — ${c.detail}`);
  console.log(`→ ROUTE : ${route.toUpperCase()}${route==='manual' ? ' (' + [...hardFails,...softFails].map(c=>c.name).join(', ') + ')' : ''}`);
}
process.exit(route==='auto' ? 0 : 1);
