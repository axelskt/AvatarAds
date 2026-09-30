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
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
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
  // B-roll en CARTE (Axel 29/09 : « pas en plein écran ») : image / vidéo arrondie, bordure blanche, centrée sur le visage,
  // arrive en pop et repart en fondu ; la voix continue dessous (vidéo muette)
  const broll = (Array.isArray(opts.broll) ? opts.broll : []).filter(b => b && b.file && b.dur > 0.2).map((b, k) => {
    const ext = (b.file.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0].toLowerCase(), name = 'broll' + k + ext;
    copyFileSync(b.file, join(work, name));
    // carte au format du média (plus de bandes blanches autour d'une image) : largeur 460, hauteur ≤ 760
    let ar = 9 / 16; try { const [w, h] = execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0', b.file]).toString().trim().split(',').map(Number); if (w && h) ar = w / h; } catch {}
    const W = b.style === 'hook' ? 720 : 460, H = Math.min(b.style === 'hook' ? 1040 : 760, Math.round(W / ar));
    return { ...b, name, k, W, H };
  });
  words = words.slice().sort((a,b)=>a.start-b.start);
  // fusion « avatar »+« ads » puis fix marque
  { const merged=[]; for(let i=0;i<words.length;i++){ const w=words[i], n=words[i+1];
      if(n && /^a?v?atar$/.test(bareOf(w.text)) && /^(hat|had|ad|rad|hads|aad)/.test(bareOf(n.text))){
        merged.push({ text:(/fr/.test(bareOf(n.text))||/\.fr/i.test(n.text))?'avatarads.fr':'avatarads', start:w.start, end:n.end }); i++;
      } else merged.push(w);
    } words = merged.map(w=>({ ...w, text:brandFix(w.text) })); }
  // captions continues (pas de trou) + lead, bornées à la vidéo
  // mot à mot, SAUF les mots marqués d'un groupe (w.g, posé par build.mjs) : la phrase s'affiche alors en bloc, chaque mot
  // s'allume quand il est dit (Axel 29/09 : groupes aux moments clés, puis retour au mot à mot)
  // jamais de ponctuation à l'écran (Axel 30/09) : on retire . , ! ? ; : … en début / fin de mot (le point d'un domaine reste)
  const clean = t => t.toUpperCase().replace(/[<>&"«»“”]/g,'').replace(/^[.,!?;:…()'’-]+|[.,!?;:…()]+$/g,'').trim();
  let caps = [];
  for (let i = 0; i < words.length; ) {
    const w = words[i];
    if (w.g) {
      let j = i; while (j < words.length && words[j].g === w.g) j++;
      const grp = words.slice(i, j), next = words[j];
      const s = Math.max(0, w.start - LEAD), e = Math.min(dur, next ? Math.max(s + 0.3, next.start - LEAD) : grp[grp.length - 1].end + 0.45);
      caps.push({ grp: grp.map(x => ({ t: clean(x.text), s: Math.max(0, x.start - LEAD) })), t: grp.map(x => clean(x.text)).join(' '), s, e });
      i = j; continue;
    }
    const next = words[i + 1], s = Math.max(0, w.start - LEAD);
    const e = Math.min(dur, next ? Math.max(s, next.start - LEAD) : w.end + 0.35);
    caps.push({ t: clean(w.text), s, e }); i++;
  }
  caps = caps.filter(c => c.e - c.s >= 0.06 && (c.grp || c.t));   // un « isolé devient vide : jamais de sous-titre vide
  // 29/09 (Axel : « il y a le texte mais pas de sous-titres ») : les sous-titres tournent AUSSI pendant la phrase choc
  // (elle est en haut, eux en bas) ; « aucun » = pas de sous-titres
  if (subs === 'aucun') caps = [];
  // hook : frame 0 jamais vide (couverture TikTok) — sans phrase choc, le 1er mot, s'il tombe dans les 0,3 premières s, est là dès 0
  if (!choc && caps.length && caps[0].s < 0.3) caps[0] = { ...caps[0], s: 0 };
  const big = subs === 'gros-colores';

  // frame 0 jamais blanche : un mot qui démarre à 0 est posé tel quel (pas de fondu depuis l'invisible)
  const box = opts.style === 'boite';
  const clipsHtml = caps.map((c,i)=>{
    if (c.grp && box) return `<div class="cap clip grp bx" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}">`
      + c.grp.map((x, k) => `<span class="gw" id="c${i}w${k}">${x.t}</span>`).join(' ') + `</div>`;
    if (box && !c.grp) return `<div class="cap clip bx" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}"><span class="bw">${c.t}</span></div>`;
    if (c.grp) return `<div class="cap clip grp" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}">`
      + c.grp.map((x, k) => `<span class="gw" id="c${i}w${k}">${x.t}</span>`).join(' ') + `</div>`;
    const cls = 'cap clip' + (big ? ' big' + (FMT.isStrong(c.t) ? ' hot' : '') : '');
    const st = big ? ` style="font-size:${FMT.bigCapSize(c.t, 960)}px"` : '';
    return `<div class="${cls}" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}"${st}>${c.t}</div>`;
  }).join('\n      ');
  const anim = caps.map((c,i)=> c.grp
    // groupe (Axel 29/09) : les mots arrivent UN PAR UN quand ils sont dits, chacun monte du bas et se pose, et la phrase
    // se construit ; elle reste entière jusqu'au mot suivant le groupe
    ? `tl.set('#c${i}',{autoAlpha:1}, ${c.s.toFixed(3)});`
      + c.grp.map((x, k) => `tl.fromTo('#c${i}w${k}',{opacity:0,y:46},{opacity:1,y:0,duration:0.24,ease:'power3.out'}, ${Math.max(c.s, x.s).toFixed(3)});`).join('')
    : c.s < 0.02 ? `tl.set('#c${i}',{autoAlpha:1,y:0,scale:1}, 0);`
    : big ? `tl.fromTo('#c${i}',{autoAlpha:0,scale:0.82},{autoAlpha:1,scale:1,duration:0.1,ease:'back.out(2.2)'}, ${c.s.toFixed(3)});`
    : `tl.fromTo('#c${i}',{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:0.09,ease:'power1.out'}, ${c.s.toFixed(3)});`).join('\n      ');
  let chocHtml = '', chocAnim = '';
  if (choc) {
    const L = choc.layout, end = Math.min(choc.end, dur);
    // emojis APPLE (Axel 30/09 : « bien prendre ceux d'Apple ») : image officielle (emoji-datasource-apple, 64 px) posée
    // dans le texte ; si le téléchargement échoue, repli sur la police Noto
    const appleEmoji = e => {
      const cps = [...e].map(c => c.codePointAt(0).toString(16)), names = [cps.join('-'), cps.filter(c => c !== 'fe0f').join('-')];
      for (const n of names) {
        const f = 'emj-' + n + '.png';
        try { execFileSync('curl', ['-sf', '-o', join(work, f), 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/' + n + '.png']); return f; } catch { /* nom suivant */ }
      }
      return null;
    };
    const line = l => esc(l).replace(EMOJI, m => { const f = appleEmoji(m); return f ? `<img class="emj" src="${f}" alt="">` : `<span class="em">${m}</span>`; });
    chocHtml = `<div class="choc clip" id="choc" data-start="0" data-duration="${end.toFixed(3)}" data-maxw="${L.maxW}" style="left:${L.x}px;top:${L.y}px;width:${L.w}px;`
      + `--jc:${L.align === 'left' ? 'flex-start' : 'center'};font-size:${L.size}px;line-height:${L.lineH}px;--px:${L.padX}px;--py:${L.padY}px">`
      + L.lines.map(l => `<div class="cl"><span>${line(l)}</span></div>`).join('') + `</div>`;
    // visible pleine opacité dès 0 (couverture) ; sortie courte juste avant la fin
    chocAnim = `tl.set('#choc',{autoAlpha:1,scale:1}, 0);\n      tl.to('#choc',{autoAlpha:0,scale:0.96,duration:0.16,ease:'power1.in'}, ${Math.max(0, end - 0.16).toFixed(3)});`;
  }
  const cardStyle = b => `style="left:${540 - b.W / 2}px;top:${Math.round(800 - b.H / 2)}px;width:${b.W}px;height:${b.H}px"`;
  const brollHtml = broll.map(b => b.image
    ? `<img class="broll clip" id="br${b.k}" src="${b.name}" data-start="${b.at.toFixed(3)}" data-duration="${b.dur.toFixed(3)}" ${cardStyle(b)} alt="">`
    : `<video class="broll clip" id="br${b.k}" src="${b.name}" data-start="${b.at.toFixed(3)}" data-duration="${b.dur.toFixed(3)}" ${cardStyle(b)} muted playsinline></video>`).join('\n      ');
  // 1re carte : pop au centre ; chaque carte suivante arrive par la droite pendant que la précédente se pousse à gauche
  // (les deux restent à l'écran, côte à côte) ; toutes repartent ensemble à la fin
  const brollAnim = broll.map((b, i) => {
    // illustration du hook : entre par la droite, repart par la gauche
    if (b.style === 'hook') return `tl.fromTo('#br${b.k}',{autoAlpha:1,x:1100},{x:0,duration:0.34,ease:'power3.out'}, ${b.at.toFixed(3)});`
      + `tl.to('#br${b.k}',{x:-1100,duration:0.3,ease:'power3.in'}, ${Math.max(b.at + 0.4, b.at + b.dur - 0.3).toFixed(3)});`;
    const prevs = broll.slice(0, i).filter(x => x.style !== 'hook');
    let a = !prevs.length
      ? `tl.fromTo('#br${b.k}',{autoAlpha:0,scale:0.7,y:40},{autoAlpha:1,scale:1,y:0,duration:0.28,ease:'back.out(1.8)'}, ${b.at.toFixed(3)});`
      : `tl.fromTo('#br${b.k}',{autoAlpha:0,x:560,scale:0.82},{autoAlpha:1,x:250,scale:0.82,duration:0.38,ease:'power3.out'}, ${b.at.toFixed(3)});`
        + `tl.to('#br${prevs[prevs.length - 1].k}',{x:-250,scale:0.82,duration:0.38,ease:'power3.inOut'}, ${b.at.toFixed(3)});`;
    a += `tl.to('#br${b.k}',{autoAlpha:0,scale:0.78,duration:0.18,ease:'power1.in'}, ${Math.max(b.at, b.at + b.dur - 0.18).toFixed(3)});`;
    return a;
  }).join('\n   ');
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
 /* groupe de sous-titres (moments clés) : la phrase en bloc sur 2-3 lignes, chaque mot s'allume quand il est dit */
 .broll{position:absolute;z-index:4;object-fit:cover;border-radius:34px;border:5px solid #fff;box-shadow:0 22px 60px rgba(0,0,0,.45);background:transparent}
 .cap.grp{left:70px;right:70px;white-space:normal;font-size:76px;line-height:1.1;-webkit-text-stroke:8px #000}
 .cap.grp .gw{display:inline-block;opacity:0}
 /* style « boite » : texte noir sur pastille blanche arrondie, sans contour */
 .cap.bx{-webkit-text-stroke:0;text-shadow:none;color:#111;font-size:66px}
 .cap.bx .bw,.cap.bx.grp .gw{background:#fff;border-radius:16px;padding:6px 20px 8px;box-shadow:0 8px 24px rgba(0,0,0,.28);line-height:1.15}
 .cap.bx.grp{font-size:62px;line-height:1.45}
 .cap.bx.grp .gw{margin:0 2px}
 .cap.big.hot{color:${HOT}}
 /* phrase choc : texte « natif » TikTok, bandeau blanc par ligne, placée par chocLayout (zone sûre, hors visage) */
 .choc{position:absolute;z-index:6;font-family:'Inter',sans-serif;font-weight:700;color:#111;transform-origin:50% 50%}
 .choc .cl{display:flex;justify-content:var(--jc,center);margin:0}
 .choc .cl>span{display:inline-block;background:#fff;border-radius:14px;padding:var(--py) var(--px);white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.18)}
 /* emoji : Noto Color Emoji (police Google, embarquée par HyperFrames) — JAMAIS Apple Color Emoji (183 Mo embarqués → rendu à court de mémoire) */
 .choc .em{font-family:'Noto Color Emoji',sans-serif;font-weight:400}
 .choc .emj{height:1.08em;width:auto;vertical-align:-0.2em;margin-left:.12em}
</style></head><body>
 <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${dur.toFixed(3)}">
   <video id="bg" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" muted playsinline></video>
   <audio id="au" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" data-volume="1"></audio>
      ${brollHtml}
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
   ${brollAnim}
   ${anim}
   if(!tl.getChildren().length) tl.to({},{duration:${dur.toFixed(3)}});
   window.__timelines['main'] = tl;
 </script>
</body></html>`;
  writeFileSync(join(work,'index.html'), html);
  console.log(`▶ rendu sous-titres (${caps.length} captions, style ${subs}${choc ? ', phrase choc 0-' + Math.min(choc.end, dur).toFixed(2) + ' s' : ''})…`);
  // fps de la vidéo source (build.mjs passe CF_FPS=60) ; images de fond extraites en jpg (plus rapide que png, sans perte visible)
  execFileSync('npx', ['--yes','hyperframes','render','--output', output, '--fps', String(process.env.CF_FPS || 30), '--quality', 'delivery', '--video-frame-format', 'jpg', '--workers', String(process.env.CF_WORKERS || 2), '--no-low-memory-mode'], { cwd: work, stdio:'inherit', env:{...process.env, PRODUCER_BROWSER_GPU_MODE:'hardware'} });
  console.log('OK ->', output);
  try { rmSync(work, { recursive: true, force: true }); } catch { /* sans gravité */ }
  // cache d'extraction d'images de HyperFrames (≈ 1 Go par rendu 60 i/s, jamais vidé : 5 Go après 5 vidéos le 30/09) :
  // il ne sert qu'à re-rendre la MÊME source → supprimé après chaque rendu (disque d'Axel)
  try { const uid = typeof process.getuid === 'function' ? process.getuid() : ''; rmSync(join(tmpdir(), 'hyperframes-extract-cache-' + uid), { recursive: true, force: true }); } catch { /* sans gravité */ }
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
