#!/usr/bin/env node
// Creative Factory — format F05 « Texte + musique » (Axel 06/10) : une RÉACTION muette (tête choquée, Omni Flash
// image → vidéo, 3 s) avec un texte choc pendant toute la réaction, un glissement de 0,25 s (whoosh + impact) vers une
// DÉMO MUETTE déjà montée (texte + CTA « Commente CLAUDE » incrustés), et de la musique seule. Aucune voix, aucun
// sous-titre. Placement du texte choc = celui de l'usine (formats.js : zone sûre, jamais sur un visage).
//
// usage : node usine/build-f05.mjs REACTION.mp4 DEMO.mp4 OUT.mp4 Mxx|musique.mp3 --choc THxx --choc-style CSxx
//                                  [--reaction R-F1] [--demo C-MCPM-07] [--hook-s 3] [--done recettes.json]
// Règle Axel 07/10 (anti-shadowban) : une réaction part avec 5 démos muettes au plus. Avec --reaction et --demo, les
// recettes déjà produites (--done, sinon factory_qc lue avec SUPABASE_SERVICE_ROLE_KEY) sont contrôlées AVANT le rendu.
// Écrit OUT.mp4.format.json (format F05, réaction, démo, musique, texte choc, style) pour le kit / la QC.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faceZones } from './face-zones.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
await import(new URL('./formats.js', import.meta.url).href);
await import(new URL('./coherence.js', import.meta.url).href);
const FMT = globalThis.CF_FORMATS, COH = globalThis.CF_COHERENCE;
const SFX = join(HERE, '..', 'render-worker', 'assets', 'sfx');
const BEDS = join(homedir(), 'Downloads', 'Creative Factory', 'musique', 'beds');
const FPS = 60, TS = 0.25;

const pos = [], OPT = {};
for (let a = process.argv.slice(2), i = 0; i < a.length; i++) {
  if (a[i].startsWith('--')) OPT[a[i].slice(2)] = a[++i]; else pos.push(a[i]);
}
const [reaction, demo, out, musicArg] = pos;
if (!reaction || !demo || !out || !musicArg || !OPT.choc || !OPT['choc-style']) {
  console.error('usage: build-f05.mjs REACTION.mp4 DEMO.mp4 OUT.mp4 Mxx|musique.mp3 --choc THxx --choc-style CSxx [--reaction R-x] [--demo C-MCPM-xx]');
  process.exit(1);
}
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const dur = f => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
let HW = true;
try { execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1', '-c:v', 'h264_videotoolbox', '-f', 'null', '-'], { stdio: 'ignore' }); } catch { HW = false; }
const VENC = HW ? ['-c:v', 'h264_videotoolbox', '-b:v', '20M', '-maxrate', '26M', '-bufsize', '40M', '-profile:v', 'high'] : ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium'];
const VF = `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=${FPS},setsar=1,format=yuv420p`;
const work = mkdtempSync(join(tmpdir(), 'f05-'));

// texte choc : banque validée + règle de cohérence avec la démo (chocWhy)
const p = FMT.textChoc(OPT.choc);
if (!p) { console.error('✗ texte choc inconnu : ' + OPT.choc); process.exit(2); }
// 5 démos au plus par réaction (Axel 07/10) — recettes refusées en QC ignorées
if (OPT.reaction && OPT.demo) {
  let rows = null;
  if (OPT.done) { try { rows = JSON.parse(readFileSync(OPT.done, 'utf8')); } catch (e) { console.error('✗ --done illisible : ' + e.message); process.exit(2); } }
  else if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try { const r = await fetch('https://guvwgiejzkiodghywpwj.supabase.co/rest/v1/factory_qc?select=status,brick_combo', { headers: { apikey: key, Authorization: `Bearer ${key}` } }); rows = r.ok ? await r.json() : null; } catch { rows = null; }
  }
  if (!Array.isArray(rows)) console.warn('⚠ recettes existantes illisibles (ni --done ni clé) : règle des 5 démos par réaction NON contrôlée');
  else {
    const combos = rows.filter(r => !(r && r.status === 'rejected')).map(r => (r && r.brick_combo) || r).filter(c => c && typeof c === 'object');
    const why = COH.reactionCheck(OPT.reaction, OPT.demo, combos);
    if (why) { console.error('✗ ' + why); process.exit(2); }
  }
}
const text = FMT.chocString(p);

// ── 1) réaction : les 3 premières secondes, muette (piste silencieuse : le rendu HyperFrames attend un son) ──
const H = Math.min(parseFloat(OPT['hook-s'] || '3') || 3, dur(reaction));
const hook = join(work, 'hook.mp4');
ff(['-i', reaction, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', H.toFixed(3), '-map', '0:v', '-map', '1:a', '-vf', VF,
  '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-shortest', hook]);
const fz = faceZones(hook, 0, H, 0.5);
const layout = FMT.chocLayout(text, { faces: fz.faces, avantApres: false, sizes: null, reserved: [], center: true })   // Axel 07/10 : texte toujours centré;
console.log(`  phrase choc ${OPT.choc} style ${OPT['choc-style']} (${layout.zone}, ${layout.size} px, ${layout.lines.length} ligne(s)) 0-${H.toFixed(2)} s`
  + (layout.size < 54 ? ' ⚠ moins de 54 px' : '') + (layout.level !== 'ok' ? ' ⚠ revue : ' + layout.reasons.join(' · ') : ''));
writeFileSync(join(work, 'w.json'), '[]');
writeFileSync(join(work, 'o.json'), JSON.stringify({ subs: 'aucun', choc: { text, end: H, layout, style: OPT['choc-style'] } }));
const hookC = join(work, 'hookC.mp4');
execFileSync('node', [join(HERE, 'captions.mjs'), 'burn', hook, hookC, join(work, 'w.json'), join(work, 'o.json')],
  { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CF_FPS: String(FPS) } });

// ── 2) démo muette : noir de fin coupé (même règle que build.mjs, VF-0065) ──
const durD = dur(demo);
const tail = (() => {
  try {
    const [rate, vdur] = String(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,duration', '-of', 'csv=p=0', demo])).trim().split(',');
    const fr = rate.split('/'), fps = +fr[0] / (+fr[1] || 1) || FPS;
    const r = spawnSync('ffmpeg', ['-v', 'error', '-sseof', '-3', '-i', demo, '-an', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const y = (String(r.stdout).match(/YAVG=[0-9.]+/g) || []).map(s => +s.slice(5));
    if (!y.length) return 0;
    const th = Math.max(...y) > 300 ? 80 : 20;
    let n = 0; while (n < y.length && y[y.length - 1 - n] < th) n++;
    return n && n < y.length ? durD - (+vdur || durD) + (n + 0.5) / fps : 0;
  } catch { return 0; }
})();
const D = durD - tail;
if (tail) console.log('  démo : ' + tail.toFixed(2) + ' s de noir en fin coupées');
const O = H - TS, total = O + D;

// ── 3) musique : piste complète de beds/ sinon banque ; jamais plus courte que la vidéo ──
let music = musicArg, musicId = (musicArg.match(/M\d\d/) || [''])[0];
if (/^M\d\d$/.test(musicArg)) {
  const f = (() => { try { return readdirSync(BEDS).find(n => n.startsWith(musicArg + '_')); } catch { return null; } })();
  if (f) music = join(BEDS, f);
  else { music = join(work, musicArg + '.mp3'); execFileSync('curl', ['-sfL', '-o', music, 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/music/' + musicArg + '.mp3']); }
}
// Axel 07/10 : PAS de musique douce sur ce format (la musique est le seul son). Énergiques mesurées : M08 M10 M13 M14 M20.
const DOUCES = ['M01', 'M02', 'M03', 'M05', 'M06', 'M07', 'M15', 'M16', 'M18', 'M19'];
if (DOUCES.includes(musicId)) { console.error(`✗ ${musicId} = musique douce, refusée pour F05 (énergiques : M08 M10 M13 M14 M20)`); process.exit(3); }
if (dur(music) < total + 0.3) { console.error(`✗ musique ${musicId || music} trop courte (${dur(music).toFixed(1)} s pour ${total.toFixed(1)} s)`); process.exit(3); }

// ── 4) montage : glissement 0,25 s (comme build.mjs), musique seule à −16 LUFS, pop + whoosh + impact ──
const AF = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
const ms = s => { const v = Math.max(0, Math.round(s * 1000)); return `${v}|${v}`; };
const fc =
  `[0:v]${VF},setpts=PTS-STARTPTS,settb=AVTB[h];[1:v]${VF},trim=0:${D.toFixed(3)},setpts=PTS-STARTPTS,settb=AVTB[d];` +
  `[h][d]xfade=transition=slideleft:duration=${TS}:offset=${O.toFixed(3)}[v];` +
  `[2:a]${AF},atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.3,afade=t=out:st=${(total - 1).toFixed(3)}:d=1[m];` +
  `[3:a]${AF},adelay=${ms(0.02)},volume=-12dB[p];[4:a]${AF},adelay=${ms(O + TS / 2 - 0.2)},volume=-4dB[w];[5:a]${AF},adelay=${ms(O + TS / 2 + 0.06)},volume=-7dB[i];` +
  `[m][p][w][i]amix=inputs=4:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95[a]`;
ff(['-i', hookC, '-i', demo, '-i', music, '-i', join(SFX, 'mo-pop-1.mp3'), '-i', join(SFX, 'mo-whoosh-1.mp3'), '-i', join(SFX, 'mo-impact-2.mp3'),
  '-filter_complex', fc, '-map', '[v]', '-map', '[a]', ...VENC, '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(3), '-movflags', '+faststart', out]);

const side = { format: 'F05', label: 'Texte + musique', reaction: OPT.reaction || null, demo: OPT.demo || null, musique: musicId || null,
  texte_choc: OPT.choc, style_choc: OPT['choc-style'], texte: text, choc_end: +H.toFixed(3), layout, duree: +total.toFixed(2),
  combo: { format: 'F05', texte_choc: OPT.choc } };
writeFileSync(out + '.format.json', JSON.stringify(side, null, 1));
rmSync(work, { recursive: true, force: true });
console.log(`OK -> ${out} (${total.toFixed(2)} s) réaction ${H.toFixed(2)} s + démo ${D.toFixed(2)} s · ${musicId} · ${OPT.choc}/${OPT['choc-style']}`);
