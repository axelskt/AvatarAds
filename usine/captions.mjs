#!/usr/bin/env node
// Creative Factory — sous-titres brûlés via HyperFrames (ffmpeg local sans drawtext/libass).
// Transcrit l'audio (Whisper FR) puis compose vidéo + captions mot-à-mot (style Anton capitales) et rend.
// Usage : node usine/captions.mjs <input.mp4> <output.mp4>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: captions.mjs <input.mp4> <output.mp4>'); process.exit(1); }

const work = mkdtempSync(join(tmpdir(), 'caps-'));
const dur = parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', input]).toString().trim());
copyFileSync(input, join(work, 'src.mp4'));

// 1) audio + transcription Whisper (multilingue)
console.log('▶ transcription…');
execFileSync('ffmpeg', ['-v','error','-y','-i', input, '-vn','-ac','1','-ar','16000', join(work,'audio.wav')]);
// FR : les modèles *.en sont anglais-only → large-v3 (multilingue) + --language fr.
execFileSync('npx', ['--yes','hyperframes','transcribe', join(work,'audio.wav'), '-d', work, '--json','--model','large-v3','--language','fr','--timeout','300000'], { stdio:'inherit' });
const tr = JSON.parse(readFileSync(join(work,'transcript.json'),'utf8'));
const words = (Array.isArray(tr) ? tr : (tr.words||tr.segments||[]))
  .map(w => ({ text:String(w.text||w.word||'').trim(), start:+w.start, end:+w.end }))
  .filter(w => w.text && isFinite(w.start) && isFinite(w.end) && w.end>w.start);
console.log(`  ${words.length} mots`);

// 2) captions mot-à-mot (min 0.18s, clampées à la durée)
const caps = words.map(w => ({ t:w.text.toUpperCase().replace(/[<>&"]/g,''), s:Math.max(0,w.start), e:Math.min(dur, Math.max(w.start+0.18, w.end)) }));

const clipsHtml = caps.map((c,i)=>`<div class="cap clip" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}">${c.t}</div>`).join('\n      ');
const pops = caps.map((c,i)=>`tl.fromTo('#c${i}',{scale:0.82,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.14,ease:'back.out(2)'}, ${c.s.toFixed(3)});`).join('\n      ');

const html = `<!doctype html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
 body{margin:0;background:#000}
 #root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:'Arial Black','Archivo Black',system-ui,sans-serif}
 #bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
 .cap{position:absolute;left:50%;bottom:430px;transform:translateX(-50%);z-index:5;
   font-weight:900;font-size:96px;letter-spacing:.01em;color:#fff;text-transform:uppercase;
   -webkit-text-stroke:9px #000;paint-order:stroke fill;
   text-shadow:0 6px 18px rgba(0,0,0,.55);white-space:nowrap;text-align:center;line-height:1}
</style></head><body>
 <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${dur.toFixed(3)}">
   <video id="bg" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" muted playsinline></video>
   <audio id="au" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" data-volume="1"></audio>
      ${clipsHtml}
 </div>
 <script>
   const tl = gsap.timeline({ paused:true });
   gsap.set('.cap',{xPercent:-50});
   ${pops}
   if(!tl.getChildren().length) tl.to({},{duration:${dur.toFixed(3)}});
   window.__timelines['main'] = tl;
 </script>
</body></html>`;
writeFileSync(join(work,'index.html'), html);

// 3) rendu HyperFrames
console.log('▶ rendu sous-titres…');
execFileSync('npx', ['--yes','hyperframes','render','--output', output], { cwd: work, stdio:'inherit', env:{...process.env, PRODUCER_BROWSER_GPU_MODE:'hardware'} });
console.log('OK ->', output);
