#!/usr/bin/env node
// Creative Factory — sous-titres brûlés via HyperFrames (ffmpeg local sans drawtext/libass).
// 3 modes :
//   emit  <audio> <offsetSec> <outWords.json>     → transcrit (Whisper large-v3 fr) et écrit les MOTS (start/end + offset)
//   burn  <video> <output> <words.json> [opts.json] → brûle des mots déjà prêts (ex. captions-manifest exactes)
//   (legacy) <video> <output> [audioBrique] [offset] [voiceStart]  → transcrit PUIS brûle (compat)
// Principe usine : une brique connaît ses mots (manifest) → 0 erreur ; seules les démos passent par Whisper.
// opts.json (FORMATS DE HOOK, usine/formats.js, écrit par build.mjs) :
//   { subs: 'normal' | 'gros-colores' | 'aucun',
//     choc: { text, end, layout } }  → phrase choc visible DÈS LA FRAME 0 (couverture TikTok, jamais blanche) jusqu'à
//     `end` s, placée par chocLayout (zone sûre, jamais sur un visage) ; les sous-titres ne commencent qu'après elle.
//   'normal' = style validé (blanc contour noir 82 px) ; 'gros-colores' = gros mots (108 px), mot fort en jaune.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

await import(new URL('./formats.js', import.meta.url).href);   // globalThis.CF_FORMATS (isStrong, bigCapSize, capsAfterChoc)
const FMT = globalThis.CF_FORMATS;
const HOT = '#FFE14A';   // mot fort des gros sous-titres colorés
const esc = t => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const EMOJI = /(\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic}|\ufe0f)*)/gu;

const LEAD = 0.12;
const bareOf = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
const brandFix = t => { const b=bareOf(t); if(/atarhat|avatarad|atarad|avatarhat|avataraad/.test(b)) return (/fr$/.test(b)||/\.?fr\b/i.test(t))?'avatarads.fr':'avatarads'; return t; };

function transcribeWords(audio, offset) {
  const work = mkdtempSync(join(tmpdir(), 'caps-tr-'));
  execFileSync('ffmpeg', ['-v','error','-y','-i', audio, '-vn','-ac','1','-ar','16000', join(work,'audio.wav')]);
  execFileSync('npx', ['--yes','hyperframes','transcribe', join(work,'audio.wav'), '-d', work, '--json','--model','large-v3','--language','fr','--timeout','300000'], { stdio:'inherit' });
  const tr = JSON.parse(readFileSync(join(work,'transcript.json'),'utf8'));
  return (Array.isArray(tr) ? tr : (tr.words||tr.segments||[]))
    .map(w => ({ text:String(w.text||w.word||'').trim(), start:+w.start + offset, end:+w.end + offset }))
    .filter(w => w.text && isFinite(w.start) && isFinite(w.end) && w.end>w.start);
}

// mots (start/end absolus) → captions continues + lead + fix marque → HTML → rendu
function burn(video, output, words, opts = {}) {
  output = resolve(output);   // HyperFrames rend depuis le dossier de travail : un chemin relatif y atterrirait
  const subs = ['normal', 'gros-colores', 'aucun'].includes(opts.subs) ? opts.subs : 'normal';
  const choc = opts.choc && opts.choc.text && opts.choc.layout && opts.choc.end > 0 ? opts.choc : null;
  const work = mkdtempSync(join(tmpdir(), 'caps-'));
  const dur = parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', video]).toString().trim());
  copyFileSync(video, join(work, 'src.mp4'));
  words = words.slice().sort((a,b)=>a.start-b.start);
  // fusion « avatar »+« ads » puis fix marque
  { const merged=[]; for(let i=0;i<words.length;i++){ const w=words[i], n=words[i+1];
      if(n && /^a?v?atar$/.test(bareOf(w.text)) && /^(hat|had|ad|rad|hads|aad)/.test(bareOf(n.text))){
        merged.push({ text:(/fr/.test(bareOf(n.text))||/\.fr/i.test(n.text))?'avatarads.fr':'avatarads', start:w.start, end:n.end }); i++;
      } else merged.push(w);
    } words = merged.map(w=>({ ...w, text:brandFix(w.text) })); }
  // captions continues (pas de trou) + lead, bornées à la vidéo
  let caps = words.map((w,i)=>{ const next=words[i+1];
    const s = Math.max(0, w.start - LEAD);
    const e = Math.min(dur, next ? Math.max(w.start - LEAD, next.start - LEAD) : w.end + 0.35);
    return { t:w.text.toUpperCase().replace(/[<>&"]/g,''), s, e };
  }).filter(c => c.e - c.s >= 0.06);
  // phrase choc : les sous-titres commencent APRÈS elle (jamais les deux à la fois) ; « aucun » = pas de sous-titres
  if (choc) caps = FMT.capsAfterChoc(caps, Math.min(choc.end, dur));
  if (subs === 'aucun') caps = [];
  // hook : frame 0 jamais vide (couverture TikTok) — sans phrase choc, le 1er mot, s'il tombe dans les 0,3 premières s, est là dès 0
  if (!choc && caps.length && caps[0].s < 0.3) caps[0] = { ...caps[0], s: 0 };
  const big = subs === 'gros-colores';

  // frame 0 jamais blanche : un mot qui démarre à 0 est posé tel quel (pas de fondu depuis l'invisible)
  const clipsHtml = caps.map((c,i)=>{
    const cls = 'cap clip' + (big ? ' big' + (FMT.isStrong(c.t) ? ' hot' : '') : '');
    const st = big ? ` style="font-size:${FMT.bigCapSize(c.t, 960)}px"` : '';
    return `<div class="${cls}" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}"${st}>${c.t}</div>`;
  }).join('\n      ');
  const anim = caps.map((c,i)=> c.s < 0.02 ? `tl.set('#c${i}',{autoAlpha:1,y:0,scale:1}, 0);`
    : big ? `tl.fromTo('#c${i}',{autoAlpha:0,scale:0.82},{autoAlpha:1,scale:1,duration:0.1,ease:'back.out(2.2)'}, ${c.s.toFixed(3)});`
    : `tl.fromTo('#c${i}',{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:0.09,ease:'power1.out'}, ${c.s.toFixed(3)});`).join('\n      ');
  let chocHtml = '', chocAnim = '';
  if (choc) {
    const L = choc.layout, end = Math.min(choc.end, dur);
    const line = l => esc(l).replace(EMOJI, '<span class="em">$1</span>');
    chocHtml = `<div class="choc clip" id="choc" data-start="0" data-duration="${end.toFixed(3)}" data-maxw="${L.maxW}" style="left:${L.x}px;top:${L.y}px;width:${L.w}px;`
      + `--jc:${L.align === 'left' ? 'flex-start' : 'center'};font-size:${L.size}px;line-height:${L.lineH}px;--px:${L.padX}px;--py:${L.padY}px">`
      + L.lines.map(l => `<div class="cl"><span>${line(l)}</span></div>`).join('') + `</div>`;
    // visible pleine opacité dès 0 (couverture) ; sortie courte juste avant la fin
    chocAnim = `tl.set('#choc',{autoAlpha:1,scale:1}, 0);\n      tl.to('#choc',{autoAlpha:0,scale:0.96,duration:0.16,ease:'power1.in'}, ${Math.max(0, end - 0.16).toFixed(3)});`;
  }
  const html = `<!doctype html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
 body{margin:0;background:#000}
 #root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:'Arial Black','Archivo Black',system-ui,sans-serif}
 #bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
 /* SAFE ZONE (tracé Axel) : bande basse ~430px du bas (remontée) ; PLEINE LARGEUR + text-align:center */
 .cap{position:absolute;left:0;right:0;bottom:430px;z-index:5;text-align:center;
   font-weight:900;font-size:82px;letter-spacing:.005em;color:#fff;text-transform:uppercase;
   -webkit-text-stroke:8px #000;paint-order:stroke fill;
   text-shadow:0 5px 16px rgba(0,0,0,.5);white-space:nowrap;line-height:1}
 /* gros sous-titres colorés : même bande basse, mot fort en jaune */
 .cap.big{bottom:440px;font-size:108px;-webkit-text-stroke:11px #000;text-shadow:0 6px 18px rgba(0,0,0,.55)}
 .cap.big.hot{color:${HOT}}
 /* phrase choc : texte « natif » TikTok, bandeau blanc par ligne, placée par chocLayout (zone sûre, hors visage) */
 .choc{position:absolute;z-index:6;font-family:'Inter',sans-serif;font-weight:700;color:#111;transform-origin:50% 50%}
 .choc .cl{display:flex;justify-content:var(--jc,center);margin:0}
 .choc .cl>span{display:inline-block;background:#fff;border-radius:14px;padding:var(--py) var(--px);white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.18)}
 /* emoji : Noto Color Emoji (police Google, embarquée par HyperFrames) — JAMAIS Apple Color Emoji (183 Mo embarqués → rendu à court de mémoire) */
 .choc .em{font-family:'Noto Color Emoji',sans-serif;font-weight:400}
</style></head><body>
 <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${dur.toFixed(3)}">
   <video id="bg" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" muted playsinline></video>
   <audio id="au" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" data-volume="1"></audio>
      ${clipsHtml}
      ${chocHtml}
 </div>
 <script>
   // filet de sécurité : une ligne de la phrase choc plus large que prévu → police réduite (jamais hors de sa boîte),
   // mesurée une fois les polices chargées (toujours depuis la taille prévue)
   (function(){ const c=document.getElementById('choc'); if(!c) return; const max=+c.dataset.maxw||0, fs0=parseFloat(c.style.fontSize), lh0=parseFloat(c.style.lineHeight);
     const fit=()=>{ c.style.fontSize=fs0+'px'; c.style.lineHeight=lh0+'px'; let w=0;
       c.querySelectorAll('.cl>span').forEach(s=>{ w=Math.max(w, s.getBoundingClientRect().width); });
       const pad=parseFloat(getComputedStyle(c).getPropertyValue('--px'))*2||0;
       if(max && w-pad>max){ const k=max/(w-pad); c.style.fontSize=(fs0*k).toFixed(1)+'px'; c.style.lineHeight=(lh0*k).toFixed(1)+'px'; } };
     if(document.fonts && document.fonts.ready) document.fonts.ready.then(fit); else fit(); })();
   const tl = gsap.timeline({ paused:true });
   ${chocAnim}
   ${anim}
   if(!tl.getChildren().length) tl.to({},{duration:${dur.toFixed(3)}});
   window.__timelines['main'] = tl;
 </script>
</body></html>`;
  writeFileSync(join(work,'index.html'), html);
  console.log(`▶ rendu sous-titres (${caps.length} captions, style ${subs}${choc ? ', phrase choc 0-' + Math.min(choc.end, dur).toFixed(2) + ' s' : ''})…`);
  execFileSync('npx', ['--yes','hyperframes','render','--output', output], { cwd: work, stdio:'inherit', env:{...process.env, PRODUCER_BROWSER_GPU_MODE:'hardware'} });
  console.log('OK ->', output);
}

// ── CLI ──
const argv = process.argv.slice(2);
const mode = (argv[0]==='emit'||argv[0]==='burn') ? argv.shift() : 'legacy';
if (mode === 'emit') {
  const [audio, offsetArg, outJson] = argv;
  if (!audio || !outJson) { console.error('usage: captions.mjs emit <audio> <offsetSec> <out.json>'); process.exit(1); }
  console.log('▶ transcription FR (émission mots)…');
  const words = transcribeWords(audio, parseFloat(offsetArg||'0')||0);
  writeFileSync(outJson, JSON.stringify(words));
  console.log(`  ${words.length} mots -> ${outJson}`);
} else if (mode === 'burn') {
  const [video, output, wordsJson, optsJson] = argv;
  if (!video || !output || !wordsJson) { console.error('usage: captions.mjs burn <video> <output> <words.json> [opts.json]'); process.exit(1); }
  burn(video, output, JSON.parse(readFileSync(wordsJson,'utf8')), optsJson ? JSON.parse(readFileSync(optsJson,'utf8')) : {});
} else {
  const [video, output, audioBrique, offsetArg, voiceStartArg] = argv;
  if (!video || !output) { console.error('usage: captions.mjs <video> <output> [audioBrique] [offset] [voiceStart]'); process.exit(1); }
  const OFFSET = parseFloat(offsetArg||'0')||0, VS = Math.max(0, parseFloat(voiceStartArg||'0')||0);
  console.log('▶ transcription FR (' + (audioBrique ? 'brique' : 'vidéo') + ')…');
  const words = transcribeWords(audioBrique || video, OFFSET).filter(w => w.start >= VS - 0.15);
  burn(video, output, words);
}
