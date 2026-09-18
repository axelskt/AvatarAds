#!/usr/bin/env node
// Creative Factory — orchestrateur de créa (ordre correct) :
//  1) STITCH voix seule (hook [+voix off] + démo [+CTA])   -> pas de musique => Whisper ne peut pas halluciner
//  2) SOUS-TITRES sur la zone PARLÉE uniquement (captions.mjs, voiceStart = durée hook)
//  3) MUSIQUE duckée + BRUITAGES en transition
// Usage : node usine/build.mjs <hook.mp4> <demo.mp4> <out.mp4> [music.mp3] [hookVoice.wav] [cta.mp4]
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [hook, demo, out, music, hookVoice, cta] = process.argv.slice(2);
if (!hook || !demo || !out) { console.error('usage: build.mjs <hook> <demo> <out> [music] [hookVoice] [cta]'); process.exit(1); }
const HERE = dirname(fileURLToPath(import.meta.url));
const SFX = join(HERE, '..', 'render-worker', 'assets', 'sfx');
const work = mkdtempSync(join(tmpdir(), 'build-'));
const VF = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1';
const dur = f => parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', f]).toString().trim());
const ff = args => execFileSync('ffmpeg', ['-v','error','-y', ...args], { stdio:'inherit' });
const hookDur = dur(hook);

// ── 1) STITCH voix seule ──
const voice = join(work, 'voice.mp4');
const hookAudio = (hookVoice) ? ['-i', hookVoice] : ['-f','lavfi','-t', String(hookDur), '-i','anullsrc=r=48000:cl=stereo'];
const hookAFilt = (hookVoice) ? '[1:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5[ha]' : '[1:a]anull[ha]';
if (cta) {
  ff(['-i', hook, ...hookAudio, '-i', demo, '-i', cta, '-filter_complex',
     `[0:v]${VF}[hv];[2:v]${VF}[dv];[3:v]${VF}[cv];${hookAFilt};`+
     `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[da];`+
     `[3:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5[ca];`+
     `[hv][ha][dv][da][cv][ca]concat=n=3:v=1:a=1[v][a]`,
     '-map','[v]','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-r','30','-c:a','aac','-b:a','192k', voice]);
} else {
  ff(['-i', hook, ...hookAudio, '-i', demo, '-filter_complex',
     `[0:v]${VF}[hv];[2:v]${VF}[dv];${hookAFilt};`+
     `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[da];`+
     `[hv][ha][dv][da]concat=n=2:v=1:a=1[v][a]`,
     '-map','[v]','-map','[a]','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-r','30','-c:a','aac','-b:a','192k', voice]);
}
// ── 2) SOUS-TITRES PAR BRIQUE : on transcrit la DÉMO directement (audio propre → capte le début,
//    pas de musique), puis on décale ses captions de la durée du hook (hook muet = pas de captions). ──
const capt = join(work, 'capt.mp4');
execFileSync('node', [join(HERE, 'captions.mjs'), voice, capt, demo, String(hookDur), '0'], { stdio:'inherit' });

// ── 3) MUSIQUE duckée + BRUITAGES ──
const tMid = Math.round(hookDur/2*1000), tCut = Math.round(hookDur*1000);
const wh = join(SFX,'whoosh.mp3'), imp = join(SFX,'mo-impact-2.mp3');
if (music) {
  ff(['-i', capt, '-stream_loop','-1','-i', music, '-i', wh, '-i', imp, '-filter_complex',
     `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=-9dB[m];`+
     `[m][0:a]sidechaincompress=threshold=0.02:ratio=6:attack=5:release=250[mduck];`+
     `[2:a]adelay=${tMid}|${tMid},volume=-4dB[s1];`+
     `[3:a]adelay=${tCut}|${tCut},volume=-6dB[s2];`+
     `[0:a][mduck][s1][s2]amix=inputs=4:duration=first:normalize=0,alimiter=limit=0.95[a]`,
     '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest', out]);
} else {
  ff(['-i', capt, '-i', wh, '-i', imp, '-filter_complex',
     `[1:a]adelay=${tMid}|${tMid},volume=-4dB[s1];[2:a]adelay=${tCut}|${tCut},volume=-6dB[s2];`+
     `[0:a][s1][s2]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.95[a]`,
     '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest', out]);
}
console.log('OK ->', out, '('+dur(out)+'s)');
