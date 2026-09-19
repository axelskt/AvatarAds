#!/usr/bin/env node
// Creative Factory — orchestrateur de créa :
//  1) STITCH voix seule : briques trimmées à leur voix, VOIX SÉQUENTIELLES (jamais superposées),
//     raccords en SLIDE (push) — pas de fondu au noir, pas de ghosting.
//  2) SOUS-TITRES : captions-MANIFEST exactes pour les briques audio (hook/CTA) + Whisper pour la démo.
//  3) MUSIQUE (plus longue que la vidéo → coupée à la fin) duckée + BRUITAGES (whoosh+impact) sur chaque raccord.
// Usage : node usine/build.mjs <hook.mp4> <demo.mp4> <out.mp4> [music] [hookVoice] [cta.mp4] [ctaCap] [ctaLead]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// cta = clip AVATAR (audio embarqué : l'avatar parle). ctaCap = audio d'origine (CTA28-audio.wav) pour les
// captions-manifest. ctaLead = silence de tête baké dans le clip avatar (l'avatar attend puis parle).
const [hook, demo, out, music, hookVoice, cta, ctaCap, ctaLeadArg] = process.argv.slice(2);
if (!hook || !demo || !out) { console.error('usage: build.mjs <hook> <demo> <out> [music] [hookVoice] [cta] [ctaCap] [ctaLead]'); process.exit(1); }
const CTA_LEAD = parseFloat(ctaLeadArg || '0') || 0;
const HERE = dirname(fileURLToPath(import.meta.url));
const SFX = join(HERE, '..', 'render-worker', 'assets', 'sfx');
const work = mkdtempSync(join(tmpdir(), 'build-'));
const VF = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p';
const dur = f => parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', f]).toString().trim());
const ff = args => execFileSync('ffmpeg', ['-v','error','-y', ...args], { stdio:'inherit' });

const TS = 0.40;      // durée du slide de raccord
const TRANS = 'slideleft';
// Traitement AVATAR (CTA) pour casser le côté « IA figée » : grain + tremblement selfie tenu à la main
// (dérive + micro-tremble, repris de camOrganiqueFilter du render-worker). Le hook/la démo = vraie vidéo, pas touchés.
const GRAIN = 'noise=alls=9:allf=t+u,eq=saturation=1.03:contrast=1.02';
// Tremblé main tenue « faible » (validé Axel) : vraies fréquences ~1-3 Hz, A=8px, rotation 0,4°, zoom 1,09.
const SHAKE = "scale=iw*1.09:ih*1.09:flags=lanczos,rotate='(0.4*(sin(5.7*t)+0.4*sin(11.3*t)))*PI/180':c=black,"
  + "crop=1080:1920:x='(iw-1080)/2+8*(sin(6.3*t)+0.5*sin(12.9*t+1)+0.3*sin(19.7*t))':"
  + "y='(ih-1920)/2+8*(cos(7.1*t)+0.5*sin(13.7*t+0.5)+0.25*sin(22.3*t))'";
const AV_TREAT = GRAIN + ',' + SHAKE;
const GAPH = 0.50;    // respiration après la voix du hook (phrase finie AVANT le raccord)
const AFMT = 'aformat=sample_rates=48000:channel_layouts=stereo';
const LN = 'loudnorm=I=-16:TP=-1.5';

// captions-manifest : une brique connaît ses mots (0 erreur, 0 coût)
function manifestWords(voicePath, offset) {
  try {
    const d = dirname(voicePath), base = basename(voicePath).replace(/\.[^.]+$/,'');
    for (const mf of readdirSync(d).filter(f=>f.endsWith('.manifest.json'))) {
      const m = JSON.parse(readFileSync(join(d, mf), 'utf8'));
      const seg = (m.segs||[]).find(s => s.id===base || (s.file && s.file.endsWith(basename(voicePath))));
      if (seg && Array.isArray(seg.captions)) return seg.captions.map(c => ({ text:c.t, start:c.s+offset, end:c.e+offset }));
    }
  } catch (e) {}
  return null;
}
const emitWords = (audio, offset) => { const j = join(work, 'w'+Math.round(offset*1000)+'.json');
  execFileSync('node', [join(HERE,'captions.mjs'), 'emit', audio, String(offset), j], { stdio:'inherit' });
  return JSON.parse(readFileSync(j, 'utf8')); };

// durées de brique
const vHook = hookVoice ? Math.min(dur(hookVoice), dur(hook)) : dur(hook);
const durH = (hookVoice ? vHook : dur(hook)) + GAPH;
const durD = dur(demo);
const END_MARGIN = 0.35;              // marge après le dernier mot du CTA avant de couper (pas de silence mort)
// durée CTA = lead + voix (durée du ctaCap) + marge → coupe le silence de fin du clip avatar
const durC = cta ? (ctaCap ? Math.min(dur(cta), CTA_LEAD + dur(ctaCap) + END_MARGIN) : dur(cta)) : 0;
const O1 = durH - TS;                 // démo entre ici (start du slide 1)
const O2 = durH + durD - 2*TS;        // cta entre ici (start du slide 2)

// ── 1) STITCH : slide vidéo + audio positionné (voix séquentielles) ──
const voice = join(work, 'voice.mp4');
const inputs = ['-i', hook];
let iHookA=null, iDemo, iCta=null, n=1;
if (hookVoice) { inputs.push('-i', hookVoice); iHookA=n++; }
inputs.push('-i', demo); iDemo=n++;
if (cta) { inputs.push('-i', cta); iCta=n++; }

let vf = `[0:v]trim=0:${durH.toFixed(3)},setpts=PTS-STARTPTS,${VF}[hv];[${iDemo}:v]${VF}[dv];`;
let af = (hookVoice ? `[${iHookA}:a]${AFMT},${LN}[ha]` : `anullsrc=r=48000:cl=stereo,atrim=0:${vHook.toFixed(3)}[ha]`) + ';';
af += `[${iDemo}:a]${AFMT},${LN}:LRA=11,adelay=${Math.round(O1*1000)}|${Math.round(O1*1000)}[da];`;
if (cta) {
  vf += `[${iCta}:v]trim=0:${durC.toFixed(3)},setpts=PTS-STARTPTS,${VF},${AV_TREAT}[cv];`
      + `[hv][dv]xfade=transition=${TRANS}:duration=${TS}:offset=${O1.toFixed(3)}[vhd];`
      + `[vhd][cv]xfade=transition=${TRANS}:duration=${TS}:offset=${O2.toFixed(3)}[v]`;
  // audio EMBARQUÉ du clip avatar, TRIMMÉ à la voix (pas de silence mort) puis posé à O2
  af += `[${iCta}:a]${AFMT},${LN},atrim=0:${durC.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round(O2*1000)}|${Math.round(O2*1000)}[ca];`
      + `[ha][da][ca]amix=inputs=3:duration=longest:normalize=0[a]`;
} else {
  vf += `[hv][dv]xfade=transition=${TRANS}:duration=${TS}:offset=${O1.toFixed(3)}[v]`;
  af += `[ha][da]amix=inputs=2:duration=longest:normalize=0[a]`;
}
ff([...inputs, '-filter_complex', vf + ';' + af, '-map','[v]','-map','[a]',
    '-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-r','30','-c:a','aac','-b:a','192k', voice]);
const total = dur(voice);

// ── 2) SOUS-TITRES : manifest (hook/CTA) + Whisper (démo) ──
const allWords = [];
{ const hw = hookVoice ? manifestWords(hookVoice, 0) : null;
  allWords.push(...(hw || (hookVoice ? emitWords(hookVoice, 0) : []))); }
allWords.push(...emitWords(demo, O1));
if (cta) { const cw = ctaCap ? manifestWords(ctaCap, O2 + CTA_LEAD) : null;
  allWords.push(...(cw || emitWords(cta, O2))); }
const wj = join(work, 'allWords.json'); writeFileSync(wj, JSON.stringify(allWords));
const capt = join(work, 'capt.mp4');
execFileSync('node', [join(HERE,'captions.mjs'), 'burn', voice, capt, wj], { stdio:'inherit' });

// ── 3) MUSIQUE (plus longue que la vidéo → coupée à la fin) duckée + BRUITAGES ──
if (music && dur(music) < total) console.warn(`⚠ musique (${dur(music).toFixed(1)}s) plus courte que la vidéo (${total.toFixed(1)}s) → elle bouclera ; prends une piste plus longue.`);
const B1 = O1 + TS/2, B2 = cta ? (O2 + TS/2) : null;
const wh = join(SFX,'mo-whoosh-1.mp3'), imp = join(SFX,'mo-impact-2.mp3');
const dly = s => { const ms = Math.max(0, Math.round(s*1000)); return `${ms}|${ms}`; };
const sfxIn=[], sfxFilt=[], sfxLabels=[];
const addSfx = (file, at, vol, tag) => { sfxIn.push('-i', file); sfxFilt.push(`[SFXIDX]adelay=${dly(at)},volume=${vol}[${tag}]`); sfxLabels.push(`[${tag}]`); };
addSfx(wh, B1 - 0.20, '-4dB', 'w1'); addSfx(imp, B1 + 0.06, '-7dB', 'i1');
if (cta) { addSfx(wh, B2 - 0.20, '-4dB', 'w2'); addSfx(imp, B2 + 0.06, '-7dB', 'i2'); }

if (music) {
  const in2 = ['-i', capt, '-stream_loop','-1','-i', music, ...sfxIn];
  let idx = 2; const sf = sfxFilt.map(f => f.replace('[SFXIDX]', `[${idx++}:a]`));
  const filt =
    `[1:a]${AFMT},volume=-11dB,afade=t=in:st=0:d=0.6,afade=t=out:st=${(total-0.9).toFixed(3)}:d=0.9[m];`+
    `[m][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=260[mduck];`+
    sf.join(';')+`;`+
    `[0:a][mduck]${sfxLabels.join('')}amix=inputs=${2+sfxLabels.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
  ff([...in2, '-filter_complex', filt, '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest', out]);
} else {
  const in2 = ['-i', capt, ...sfxIn];
  let idx = 1; const sf = sfxFilt.map(f => f.replace('[SFXIDX]', `[${idx++}:a]`));
  const filt = sf.join(';')+`;`+`[0:a]${sfxLabels.join('')}amix=inputs=${1+sfxLabels.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
  ff([...in2, '-filter_complex', filt, '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest', out]);
}
console.log('OK ->', out, '('+dur(out).toFixed(2)+'s)  hook='+durH.toFixed(2)+'s démo='+durD.toFixed(2)+(cta?(' cta='+durC.toFixed(2)+'s'):'')+'  trans='+TRANS);
