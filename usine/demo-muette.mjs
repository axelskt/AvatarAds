#!/usr/bin/env node
// Creative Factory — version SANS VOIX d'une démo (07/10, Axel : « démo app sans voix » pour le format F05 texte + musique).
// Part d'une démo filmée AVEC voix (ex. C-OMNI-01) : la voix est retirée et remplacée par du texte à l'écran, au style des
// démos MCP muettes qu'Axel monte dans CapCut (C-MCPM-xx) :
//   step  → consigne courte, gros texte blanc cerné de noir, au centre-bas (« Va sur AvatarAds.fr », « Clique sur Omni »)
//   punch → encadré noir, texte blanc, au moment du résultat (« BOOM ! Transformation 🤯 »)
//   cta   → encadré noir en bas, jusqu'à la fin (« Commente "SITE" et je t'envoie le lien 📩 », mot-clé de l'auto-DM)
// Les consignes se calent sur la transcription de la voix (captions.mjs emit) : chaque étape apparaît quand elle est dite.
// Emojis = images Apple (comme captions.mjs). Sortie 1080 × 1920, 60 i/s, piste son SILENCIEUSE (la musique est posée
// par build-f05.mjs), faststart.
//
// usage : node usine/demo-muette.mjs <demo-avec-voix.mp4> <cartes.json> <sortie.mp4>
//   cartes.json = [{ "start": 0, "end": 3.6, "text": "Va sur AvatarAds.fr", "style": "step" }, …]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [src, cardsFile, out] = process.argv.slice(2);
if (!src || !cardsFile || !out) { console.error('usage: demo-muette.mjs <demo.mp4> <cartes.json> <sortie.mp4>'); process.exit(1); }
const HF = process.env.CF_HF_BIN || 'npx', HF_PRE = process.env.CF_HF_BIN ? [] : ['--yes', 'hyperframes'];
const FPS = 60;
const esc = t => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const EMOJI = /(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️)*)/gu;
const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString());
const cards = JSON.parse(readFileSync(cardsFile, 'utf8')).filter(c => c && c.text && c.end > c.start).map(c => ({ ...c, end: Math.min(c.end, dur) }));
const work = mkdtempSync(join(tmpdir(), 'demo-muette-'));

// 1) vidéo de fond : 1080 × 1920, 60 i/s, SANS le son (la voix disparaît ici)
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-an', '-vf', `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=${FPS},format=yuv420p`,
  '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', join(work, 'src.mp4')]);

// 2) emojis Apple (repli police Noto si le téléchargement échoue)
const appleEmoji = e => {
  const cps = [...e].map(c => c.codePointAt(0).toString(16));
  for (const n of [cps.join('-'), cps.filter(c => c !== 'fe0f').join('-')]) {
    const f = 'emj-' + n + '.png';
    try { execFileSync('curl', ['-sf', '-o', join(work, f), 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/' + n + '.png']); return f; } catch { /* nom suivant */ }
  }
  return null;
};
const line = t => esc(t).replace(EMOJI, m => { const f = appleEmoji(m); return f ? `<img class="emj" src="${f}" alt="">` : `<span class="em">${m}</span>`; });
const html = cards.map((c, i) => `<div class="card ${c.style || 'step'} clip" id="c${i}" data-start="${c.start.toFixed(3)}" data-duration="${(c.end - c.start).toFixed(3)}">`
  + String(c.text).split('\n').map(l => `<div class="l"><span>${line(l)}</span></div>`).join('') + `</div>`).join('\n   ');
const anim = cards.map((c, i) => `tl.fromTo('#c${i}',{autoAlpha:0,scale:0.86},{autoAlpha:1,scale:1,duration:0.16,ease:'back.out(2)'}, ${c.start.toFixed(3)});`).join('\n   ');

writeFileSync(join(work, 'index.html'), `<!doctype html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
 body{margin:0;background:#000}
 #root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000}
 #bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
 .card{position:absolute;left:60px;right:60px;z-index:5;text-align:center;transform-origin:50% 50%}
 .card .l{display:block;margin:0}
 .emj{height:1.05em;width:auto;vertical-align:-0.18em;margin-left:.12em}
 .em{font-family:'Noto Color Emoji',sans-serif}
 /* consigne : comme les démos MCP muettes (blanc cerné de noir, centre-bas) */
 .step{top:1130px;font-family:'Montserrat','Arial Black',sans-serif;font-weight:900;font-size:66px;line-height:1.12;color:#fff;
   -webkit-text-stroke:9px #000;paint-order:stroke fill;text-shadow:0 4px 14px rgba(0,0,0,.45)}
 /* encadrés noirs : résultat et CTA */
 .punch,.cta{font-family:'Inter','Arial',sans-serif;font-weight:800;color:#fff}
 .punch .l>span,.cta .l>span{display:inline-block;background:#111;border-radius:16px;padding:10px 24px;box-shadow:0 6px 18px rgba(0,0,0,.35)}
 .punch .l:not(:first-child)>span,.cta .l:not(:first-child)>span{margin-top:-6px}
 .punch{top:1250px;font-size:56px;line-height:1.18}
 .cta{top:1470px;font-size:42px;line-height:1.2}
</style></head><body>
 <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${dur.toFixed(3)}">
   <video id="bg" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" muted playsinline></video>
   ${html}
 </div>
 <script>
   const tl = gsap.timeline({ paused:true });
   ${anim}
   if(!tl.getChildren().length) tl.to({},{duration:${dur.toFixed(3)}});
   window.__timelines['main'] = tl;
 </script>
</body></html>`);

// 3) rendu HyperFrames, puis piste son silencieuse + faststart
const raw = join(work, 'raw.mp4');
execFileSync(HF, [...HF_PRE, 'render', '--output', raw, '--fps', String(FPS), '--quality', 'delivery', '--video-frame-format', 'jpg', '--workers', String(process.env.CF_WORKERS || 2), '--no-low-memory-mode'],
  { cwd: work, stdio: 'inherit', env: { ...process.env, ...(process.platform === 'darwin' ? { PRODUCER_BROWSER_GPU_MODE: 'hardware' } : {}) } });
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
  '-shortest', '-movflags', '+faststart', out]);
try { rmSync(work, { recursive: true, force: true }); const uid = typeof process.getuid === 'function' ? process.getuid() : ''; rmSync(join(tmpdir(), 'hyperframes-extract-cache-' + uid), { recursive: true, force: true }); } catch { /* sans gravité */ }
console.log(`OK -> ${out} (${dur.toFixed(2)} s, ${cards.length} cartes, sans voix)`);
