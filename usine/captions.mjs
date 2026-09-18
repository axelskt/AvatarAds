#!/usr/bin/env node
// Creative Factory — sous-titres brûlés via HyperFrames (ffmpeg local sans drawtext/libass).
// LOGIQUE PAR BRIQUE : on transcrit l'AUDIO DE LA BRIQUE (propre, ex. la démo) directement, puis on
// DÉCALE ses captions de `offset` (position de la brique dans le montage). Pas de transcription du
// stitch (évite hallucinations sur la musique + capte le début de la démo). Marque « avatarads » corrigée.
// Usage : node usine/captions.mjs <video> <output> [audioBrique] [offsetSec] [voiceStartSec]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [video, output, audioBrique, offsetArg, voiceStartArg] = process.argv.slice(2);
if (!video || !output) { console.error('usage: captions.mjs <video> <output> [audioBrique] [offsetSec] [voiceStartSec]'); process.exit(1); }
const OFFSET = parseFloat(offsetArg || '0') || 0;
const VOICE_START = Math.max(0, parseFloat(voiceStartArg || '0') || 0);
const LEAD = 0.12;

const work = mkdtempSync(join(tmpdir(), 'caps-'));
const dur = parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', video]).toString().trim());
copyFileSync(video, join(work, 'src.mp4'));

// audio à transcrire : la BRIQUE si fournie (propre, 0-based → on décale de OFFSET), sinon la vidéo
const srcAudio = audioBrique || video;
console.log('▶ transcription FR (' + (audioBrique ? 'brique' : 'vidéo') + ')…');
execFileSync('ffmpeg', ['-v','error','-y','-i', srcAudio, '-vn','-ac','1','-ar','16000', join(work,'audio.wav')]);
execFileSync('npx', ['--yes','hyperframes','transcribe', join(work,'audio.wav'), '-d', work, '--json','--model','large-v3','--language','fr','--timeout','300000'], { stdio:'inherit' });
const tr = JSON.parse(readFileSync(join(work,'transcript.json'),'utf8'));
let words = (Array.isArray(tr) ? tr : (tr.words||tr.segments||[]))
  .map(w => ({ text:String(w.text||w.word||'').trim(), start:+w.start + OFFSET, end:+w.end + OFFSET }))
  .filter(w => w.text && isFinite(w.start) && isFinite(w.end) && w.end>w.start)
  .filter(w => w.start >= VOICE_START - 0.15)
  .sort((a,b)=>a.start-b.start);

// ── correction MARQUE tolérante à la ponctuation (« atarhats.fr, » → avatarads.fr) ──
const bareOf = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
const brandFix = t => { const b=bareOf(t); if(/atarhat|avatarad|atarad|avatarhat|avataraad/.test(b)) return (/fr$/.test(b)||/\.?fr\b/i.test(t))?'avatarads.fr':'avatarads'; return t; };
{ const merged=[]; for(let i=0;i<words.length;i++){ const w=words[i], n=words[i+1];
    if(n && /^a?v?atar$/.test(bareOf(w.text)) && /^(hat|had|ad|rad|hads|aad)/.test(bareOf(n.text))){
      merged.push({ text:(/fr/.test(bareOf(n.text))||/\.fr/i.test(n.text))?'avatarads.fr':'avatarads', start:w.start, end:n.end }); i++;
    } else merged.push(w);
  } words = merged.map(w=>({ ...w, text:brandFix(w.text) })); }
console.log(`  ${words.length} mots (offset=${OFFSET}s)`);

// captions CONTINUES (pas de trou) + lead, bornées à la vidéo
const caps = words.map((w,i)=>{ const next=words[i+1];
  const s = Math.max(0, w.start - LEAD);
  const e = Math.min(dur, next ? Math.max(w.start - LEAD, next.start - LEAD) : w.end + 0.35);
  return { t:w.text.toUpperCase().replace(/[<>&"]/g,''), s, e };
}).filter(c => c.e - c.s >= 0.06);

const clipsHtml = caps.map((c,i)=>`<div class="cap clip" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}">${c.t}</div>`).join('\n      ');
const anim = caps.map((c,i)=>`tl.fromTo('#c${i}',{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:0.09,ease:'power1.out'}, ${c.s.toFixed(3)});`).join('\n      ');

const html = `<!doctype html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
 body{margin:0;background:#000}
 #root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:'Arial Black','Archivo Black',system-ui,sans-serif}
 #bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
 /* SAFE ZONE (tracé Axel) : bande basse ~330px du bas, au-dessus du clavier/dock */
 .cap{position:absolute;left:50%;bottom:330px;transform:translateX(-50%);z-index:5;
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
