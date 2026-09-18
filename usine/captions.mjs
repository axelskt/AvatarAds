#!/usr/bin/env node
// Creative Factory — sous-titres brûlés via HyperFrames (ffmpeg local sans drawtext/libass).
// Transcrit l'audio (Whisper FR), NE SOUS-TITRE QUE là où on parle (voiceStart), captions CONTINUES
// (pas de trous), léger lead (anti-retard), SAFE ZONE relevée. À lancer sur la version VOIX SEULE
// (avant musique) pour éviter les hallucinations de Whisper sur la musique.
// Usage : node usine/captions.mjs <input.mp4> <output.mp4> [voiceStartSec]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [input, output, voiceStartArg] = process.argv.slice(2);
if (!input || !output) { console.error('usage: captions.mjs <input.mp4> <output.mp4> [voiceStartSec]'); process.exit(1); }
const VOICE_START = Math.max(0, parseFloat(voiceStartArg || '0') || 0);
const LEAD = 0.12;   // les captions apparaissent 120 ms AVANT le mot (anti-retard ressenti)

const work = mkdtempSync(join(tmpdir(), 'caps-'));
const dur = parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', input]).toString().trim());
copyFileSync(input, join(work, 'src.mp4'));

console.log('▶ transcription FR…');
execFileSync('ffmpeg', ['-v','error','-y','-i', input, '-vn','-ac','1','-ar','16000', join(work,'audio.wav')]);
execFileSync('npx', ['--yes','hyperframes','transcribe', join(work,'audio.wav'), '-d', work, '--json','--model','large-v3','--language','fr','--timeout','300000'], { stdio:'inherit' });
const tr = JSON.parse(readFileSync(join(work,'transcript.json'),'utf8'));
let words = (Array.isArray(tr) ? tr : (tr.words||tr.segments||[]))
  .map(w => ({ text:String(w.text||w.word||'').trim(), start:+w.start, end:+w.end }))
  .filter(w => w.text && isFinite(w.start) && isFinite(w.end) && w.end>w.start)
  // NE GARDER que la zone parlée (après le hook muet) → aucun sous-titre là où il n'y a pas de voix
  .filter(w => w.start >= VOICE_START - 0.15)
  .sort((a,b)=>a.start-b.start);
console.log(`  ${words.length} mots (voiceStart=${VOICE_START}s)`);

// captions CONTINUES : chaque mot reste affiché jusqu'au mot suivant (pas de trou/flicker),
// avec un léger lead. Fenêtre bornée à [VOICE_START, dur].
const caps = words.map((w,i)=>{
  const next = words[i+1];
  const s = Math.max(VOICE_START, w.start - LEAD);
  const e = Math.min(dur, next ? Math.max(w.start - LEAD, next.start - LEAD) : w.end + 0.35);
  return { t:w.text.toUpperCase().replace(/[<>&"]/g,''), s, e };
}).filter(c => c.e - c.s >= 0.06);

const clipsHtml = caps.map((c,i)=>`<div class="cap clip" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}">${c.t}</div>`).join('\n      ');
// fondu court, pas de rebond → fluide
const anim = caps.map((c,i)=>`tl.fromTo('#c${i}',{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:0.09,ease:'power1.out'}, ${c.s.toFixed(3)});`).join('\n      ');

const html = `<!doctype html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
 body{margin:0;background:#000}
 #root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:'Arial Black','Archivo Black',system-ui,sans-serif}
 #bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
 /* SAFE ZONE : ~40% depuis le bas, jamais collé au bord/UI ; un seul mot à la fois (continu) */
 .cap{position:absolute;left:50%;bottom:760px;transform:translateX(-50%);z-index:5;
   max-width:900px;font-weight:900;font-size:82px;letter-spacing:.005em;color:#fff;text-transform:uppercase;
   -webkit-text-stroke:8px #000;paint-order:stroke fill;
   text-shadow:0 5px 16px rgba(0,0,0,.5);white-space:nowrap;text-align:center;line-height:1}
</style></head><body>
 <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${dur.toFixed(3)}">
   <video id="bg" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" muted playsinline></video>
   <audio id="au" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" data-volume="1"></audio>
      ${clipsHtml}
 </div>
 <script>
   const tl = gsap.timeline({ paused:true });
   gsap.set('.cap',{xPercent:-50});
   ${anim}
   if(!tl.getChildren().length) tl.to({},{duration:${dur.toFixed(3)}});
   window.__timelines['main'] = tl;
 </script>
</body></html>`;
writeFileSync(join(work,'index.html'), html);

console.log('▶ rendu sous-titres…');
execFileSync('npx', ['--yes','hyperframes','render','--output', output], { cwd: work, stdio:'inherit', env:{...process.env, PRODUCER_BROWSER_GPU_MODE:'hardware'} });
console.log('OK ->', output);
