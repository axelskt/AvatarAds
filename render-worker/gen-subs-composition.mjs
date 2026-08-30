// gen-subs-composition.mjs — composition HyperFrames pour le compose SERVEUR du Générateur.
//
// Un seul but : GRAVER les sous-titres du Générateur sur sa vidéo, EXACTEMENT
// comme l'aperçu (_cvSubs côté client), mais côté serveur — parce que le rendu
// client échouait sur Safari/iOS (WebCodecs AudioEncoder + decodeAudioData ne
// savent pas encoder l'audio d'un MP4). Ici : le fond = la vidéo (clip <video>
// que HyperFrames extrait+synchronise), par-dessus un <canvas> qui rejoue
// _cvSubs image par image, piloté par la timeline GSAP en pause (seek-safe).
// Le worker mux ENSUITE l'audio de la vidéo d'origine (ffmpeg) → son fiable
// partout. Aucun MediaRecorder/captureStream (navigateur only) n'est réutilisé.
//
// Contrat HyperFrames repris à build-composition.mjs :
//   #root[data-composition-id="montage"] · <video class="clip" src="media/base.mp4">
//   · window.__timelines['montage'] = timeline GSAP paused · GSAP depuis le CDN.
// Le canvas est piloté par onUpdate de la timeline (fire à chaque seek de frame).
//
// Polices : le look client utilise Impact / Arial Black (polices SYSTÈME du Mac)
// + Bricolage Grotesque (Google). Le conteneur n'a QUE fonts-liberation → on
// @font-face des substituts embarqués : Impact→Anton, Arial Black→Archivo Black,
// Bricolage Grotesque→sa woff2 (bundlée). Les métriques diffèrent un peu (donc
// le retour à la ligne peut varier légèrement vs l'aperçu Mac) — à aligner plus
// tard côté client (police web au lieu de système). C'est le SEUL écart connu.

// _cvSubs + helpers : COPIE VERBATIM du client (app/index.html). Ne PAS diverger
// sans re-synchroniser — c'est la source de vérité du pixel. Toute retouche du
// look doit se faire des deux côtés à la fois.
const CV_SUBS_SRC = String.raw`
function _splitSubLines(widths, maxW){
  const lines = [];
  let cur = [], curW = 0;
  for(let i = 0; i < widths.length; i++){
    if(cur.length > 0 && curW + widths[i] > maxW){
      lines.push(cur);
      cur = [i]; curW = widths[i];
    } else {
      cur.push(i); curW += widths[i];
    }
  }
  if(cur.length) lines.push(cur);
  return lines;
}
function _cvRoundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}
function _subTextOn(bg){
  const m = /^#([0-9a-f]{6})$/i.exec(bg||'');
  if(!m) return '#fff';
  const r=parseInt(m[1].slice(0,2),16), g=parseInt(m[1].slice(2,4),16), b=parseInt(m[1].slice(4,6),16);
  return (0.299*r + 0.587*g + 0.114*b) > 150 ? '#0A2540' : '#fff';
}
function _cvSubs(ctx, shown, activeIdx, animElapsed, W, H){
  if(!shown?.length) return;
  const sz       = Math.max(24, Math.round((cfg.subSize||72) * (H/1920) * 0.85));
  const posY     = Math.round(H * (Math.max(SAFE_ZONE.top,  Math.min(SAFE_ZONE.bottom, cfg.subPos  !== undefined ? cfg.subPos  : 70)) / 100));
  const posX     = Math.round(W * (Math.max(SAFE_ZONE.left, Math.min(SAFE_ZONE.right,  cfg.subPosX !== undefined ? cfg.subPosX : 50)) / 100));
  const scaleX   = cfg.subScaleX || 1.0;
  const c1       = subColors.c1 || '#FFE500';
  const c2       = subColors.c2 || '#ffffff';
  const strokeW  = Math.max(2, Math.round(sz / 12));
  const style    = selSubStyle || 'hormozi';
  const gap      = Math.round(sz * 0.22);
  const ANIM_DUR = 0.25;
  const t        = Math.min(1, animElapsed / ANIM_DUR);
  const maxLineW = W * 0.80;
  const lineH    = Math.round(sz * 1.38);

  let animSY = 1, animTy = 0, animOpacity = 1;
  if(animEnabled && selAnim !== 'none'){
    if(selAnim === 'pop'){
      const ease = 1 - Math.pow(1 - t, 3);
      animSY = 0.5 + 0.5 * ease;
    } else if(selAnim === 'bounce'){
      const bounce = t < 0.36 ? 7.56*t*t
        : t < 0.72 ? 7.56*(t-.54)*(t-.54)+.75
        : t < 0.9  ? 7.56*(t-.81)*(t-.81)+.9375
        :             7.56*(t-.945)*(t-.945)+.984;
      animSY = 0.3 + 0.7 * bounce;
    } else if(selAnim === 'slide'){
      animTy = (1 - (1 - Math.pow(1-t,3))) * sz * 1.5;
    } else if(selAnim === 'fade'){
      animOpacity = t;
    }
  }

  ctx.save();
  ctx.globalAlpha = animOpacity;
  if(scaleX !== 1){ ctx.translate(posX,0); ctx.scale(scaleX,1); ctx.translate(-posX,0); }
  if(animSY !== 1 || animTy !== 0){ ctx.translate(0,posY+animTy); ctx.scale(1,animSY); ctx.translate(0,-posY); }
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if(style === 'badis'){
    const font = "800 " + Math.round(sz*1.08) + "px 'Bricolage Grotesque',sans-serif";
    ctx.font = font;
    ctx.textAlign = 'left';
    const upWords = shown.map(w => (w||'').toUpperCase());
    const wordWidths = upWords.map(w => ctx.measureText(w).width + gap);
    const lines  = _splitSubLines(wordWidths, maxLineW);
    const nLines = lines.length;
    const startY = posY - ((nLines - 1) * lineH) / 2;
    lines.forEach((lineIdxs, li) => {
      const lineY = startY + li * lineH;
      const lineW = lineIdxs.reduce((a, i) => a + wordWidths[i], 0);
      let x = posX - lineW / 2;
      x = Math.max(W * 0.05, Math.min(W * 0.88 - lineW, x));
      lineIdxs.forEach(i => {
        const active = (activeIdx!==undefined && activeIdx!==null) ? (i === activeIdx) : (i===0);
        ctx.font = font;
        // « White » (sync client) — SANS fond/contour noir : mot actif = c1, autres = c2, ombre douce
        ctx.shadowColor = 'rgba(0,0,0,.38)'; ctx.shadowBlur = Math.round(sz*0.12); ctx.shadowOffsetX = 0; ctx.shadowOffsetY = Math.round(sz*0.04);
        ctx.fillStyle   = active ? c1 : c2;
        ctx.fillText(upWords[i], x, lineY);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        x += wordWidths[i];
      });
    });
  } else if(style === 'tiktok'){
    const tSz = Math.round(sz*.85);
    ctx.font = "900 " + tSz + "px 'Arial Black',Arial,sans-serif";
    const pad  = Math.round(sz * 0.15);
    const gapT = Math.round(sz * 0.15);
    const widths = shown.map(w => ctx.measureText(w).width + pad*2);
    const lines  = _splitSubLines(widths.map((w,i)=>w+gapT), maxLineW);
    const nLines = lines.length;
    const startY = posY - ((nLines-1)*lineH)/2;
    lines.forEach((lineIdxs, li)=>{
      const lineY  = startY + li * lineH;
      const lineW  = lineIdxs.reduce((a,i)=>a+widths[i]+gapT,0) - gapT;
      let x = posX - lineW/2;
      lineIdxs.forEach(i=>{
        const active = i===activeIdx;
        const bg = active ? c1 : c2;
        const ph = Math.round(sz*1.15), pw = widths[i];
        const r  = Math.round(sz*.1);
        ctx.fillStyle = bg;
        _cvRoundRect(ctx, x, lineY-ph/2, pw, ph, r);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.fillText(shown[i], x+pw/2, lineY);
        x += pw + gapT;
      });
    });
  } else if(style === 'mrbeast'){
    ctx.font = "800 " + sz + "px 'Bricolage Grotesque',sans-serif";
    const pad  = Math.round(sz * 0.12);
    const gapK = Math.round(sz * 0.10);
    const widths = shown.map(w => ctx.measureText(w).width + pad*2);
    const lines  = _splitSubLines(widths.map((w,i)=>w+gapK), maxLineW);
    const nLines = lines.length;
    const startY = posY - ((nLines-1)*lineH)/2;
    lines.forEach((lineIdxs, li)=>{
      const lineY = startY + li * lineH;
      const lineW = lineIdxs.reduce((a,i)=>a+widths[i]+gapK,0) - gapK;
      let x = posX - lineW/2;
      x = Math.max(W*0.04, Math.min(W*0.88 - lineW, x));
      lineIdxs.forEach(i=>{
        const active = (activeIdx!==undefined && activeIdx!==null) ? (i === activeIdx) : (i===0);
        const pw = widths[i];
        const ph = Math.round(sz * 1.08);
        const r  = Math.round(sz * 0.15);
        if(active){
          ctx.fillStyle = c1;
          _cvRoundRect(ctx, x, lineY-ph/2, pw, ph, r);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(0,0,0,0.3)';
          ctx.shadowBlur = 2;
          ctx.fillText(shown[i], x+pw/2, lineY);
          ctx.shadowBlur = 0;
        } else {
          ctx.lineWidth = strokeW;
          ctx.strokeStyle = '#000';
          ctx.fillStyle = c2;
          ctx.textAlign = 'center';
          ctx.strokeText(shown[i], x+pw/2, lineY);
          ctx.fillText(shown[i], x+pw/2, lineY);
        }
        x += pw + gapK;
      });
    });
  } else if(style === 'karaoke'){
    ctx.font = "800 " + sz + "px 'Bricolage Grotesque',sans-serif";
    const pad  = Math.round(sz * 0.12);
    const gapK = Math.round(sz * 0.10);
    const widths = shown.map(w => ctx.measureText(w).width + pad*2);
    const lines  = _splitSubLines(widths.map((w,i)=>w+gapK), maxLineW);
    const nLines = lines.length;
    const startY = posY - ((nLines-1)*lineH)/2;
    lines.forEach((lineIdxs, li)=>{
      const lineY = startY + li * lineH;
      const lineW = lineIdxs.reduce((a,i)=>a+widths[i]+gapK,0) - gapK;
      let x = posX - lineW/2;
      x = Math.max(W*0.04, Math.min(W*0.88 - lineW, x));
      lineIdxs.forEach(i=>{
        const active = (activeIdx!==undefined && activeIdx!==null) ? (i === activeIdx) : (i===0);
        const pw = widths[i];
        const ph = Math.round(sz * 1.08);
        const r  = Math.round(sz * 0.15);
        if(active){
          ctx.fillStyle = c1;
          _cvRoundRect(ctx, x, lineY-ph/2, pw, ph, r);
          ctx.fill();
          ctx.fillStyle = _subTextOn(c1);
          ctx.textAlign = 'center';
          ctx.fillText(shown[i], x+pw/2, lineY);
        } else {
          ctx.lineWidth = strokeW;
          ctx.strokeStyle = '#000';
          ctx.fillStyle = c2;
          ctx.textAlign = 'center';
          ctx.strokeText(shown[i], x+pw/2, lineY);
          ctx.fillText(shown[i], x+pw/2, lineY);
        }
        x += pw + gapK;
      });
    });
  } else if(style === 'iman'){
    const word = (shown[(activeIdx!==undefined && activeIdx!==null) ? activeIdx : 0] || '').toUpperCase();
    if(word){
      let psz = Math.round(sz * 1.35);
      ctx.font = "900 " + psz + "px 'Arial Black',Arial,sans-serif";
      while(psz > 24 && ctx.measureText(word).width > maxLineW){ psz -= 4; ctx.font = "900 " + psz + "px 'Arial Black',Arial,sans-serif"; }
      ctx.textAlign = 'center';
      ctx.lineWidth = Math.max(4, Math.round(psz * 0.12));
      ctx.strokeStyle = '#000';
      ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = Math.round(psz*0.16); ctx.shadowOffsetY = Math.round(psz*0.05);
      ctx.strokeText(word, posX, posY);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.fillStyle = c1;
      ctx.fillText(word, posX, posY);
    }
  } else {
    let font;
    if(style==='hormozi') font="900 " + sz + "px Impact,sans-serif";
    else if(style==='neon')   font="900 " + sz + "px Impact,sans-serif";
    else                      font="900 " + sz + "px 'Arial Black',Arial,sans-serif";
    ctx.font = font;
    ctx.textAlign = 'left';
    const widths = shown.map(w => ctx.measureText(w).width + gap);
    const lines  = _splitSubLines(widths, maxLineW);
    const nLines = lines.length;
    const startY = posY - ((nLines-1)*lineH)/2;
    lines.forEach((lineIdxs, li)=>{
      const lineY = startY + li * lineH;
      const lineW = lineIdxs.reduce((a,i)=>a+widths[i],0);
      let x = posX - lineW/2;
      x = Math.max(W*0.05, Math.min(W*0.88 - lineW, x));
      lineIdxs.forEach(i=>{
        const active = i===activeIdx;
        const color  = active ? c1 : c2;
        if(style==='neon'){
          ctx.shadowColor = color; ctx.shadowBlur = Math.round(sz*.7); ctx.fillStyle = color;
          ctx.fillText(shown[i], x, lineY);
          ctx.shadowBlur = Math.round(sz*1.4); ctx.fillText(shown[i], x, lineY);
          ctx.shadowBlur = 0;
        } else {
          ctx.lineWidth = strokeW; ctx.strokeStyle = '#000';
          ctx.strokeText(shown[i], x, lineY);
          ctx.fillStyle = color;
          ctx.fillText(shown[i], x, lineY);
        }
        x += widths[i];
      });
    });
  }
  ctx.restore();
}
`;

// ── Le pilote seek-safe : reproduit la logique de drawFrame (app/index.html
//    L23175-23223) mais SANS état monotone. La timeline HyperFrames SEEKE (frame
//    par frame, pas forcément dans l'ordre) → il faut que gi/wi ET l'horloge
//    d'animation soient DÉTERMINISTES pour un `elapsed` donné. On précalcule donc
//    le temps de DÉBUT de chaque groupe (groupStart[gi]) au lieu de mémoriser
//    « quand le groupe a changé ».
const DRIVER_SRC = String.raw`
const SAFE_ZONE = { top:13, bottom:78, left:8, right:84 };
const W = 1080, H = 1920;
const _wordGroups   = SUBS.groups || [];
const whisperWordTimestamps = SUBS.whisper || [];
const cfg           = SUBS.cfg || {};
const subColors     = SUBS.colors || {c1:'#FFE500', c2:'#ffffff'};
const selSubStyle   = SUBS.style || 'hormozi';
const selAnim       = SUBS.anim || 'none';
const animEnabled   = !!SUBS.animEnabled;
const totalDuration = SUBS.totalDuration || 1;

function _buildWordMap(groups){
  const map = [];
  groups.forEach((g, gi) => g.forEach((_, wi) => map.push({gi, wi})));
  return map;
}
const _groups     = (_wordGroups && _wordGroups.length) ? _wordGroups : [];
const _totalGroups= _groups.length;
const _wordMap    = _buildWordMap(_groups);
const _subAdvSec  = (cfg.subAdvanceMs || 0) / 1000;
const _isFixed    = (cfg.subTimingMode || 'proportionnel') === 'fixe';
const _secPerGroup= cfg.subSecPerGroup || 1.2;

// début (en elapsed) de chaque groupe — deterministe, pour l'horloge d'anim.
const _groupStart = (function(){
  const arr = new Array(_totalGroups).fill(0);
  if(whisperWordTimestamps.length > 0){
    // 1er mot de chaque groupe → son start absolu (moins l'avance), via wordMap
    for(let gi=0; gi<_totalGroups; gi++){
      const firstFlat = _wordMap.findIndex(m => m.gi === gi);
      const wt = (firstFlat >= 0 && whisperWordTimestamps[Math.min(firstFlat, whisperWordTimestamps.length-1)]) || null;
      arr[gi] = Math.max(0, (wt ? wt.start : 0) - _subAdvSec);
    }
  } else if(_isFixed){
    for(let gi=0; gi<_totalGroups; gi++) arr[gi] = Math.max(0, gi*_secPerGroup - _subAdvSec);
  } else {
    for(let gi=0; gi<_totalGroups; gi++) arr[gi] = Math.max(0, (gi/Math.max(1,_totalGroups))*totalDuration - _subAdvSec);
  }
  // Le groupe 0 est TOUJOURS affiché dès elapsed=0 (comme le client, qui pose
  // _lastGrpTime=0 à la 1re frame) → son horloge d'anim démarre à 0, même s'il
  // y a un blanc avant le 1er mot (sinon fade/pop divergeraient de l'export).
  if(arr.length) arr[0] = 0;
  return arr;
})();

function _giWi(elapsed){
  const sub = Math.max(0, elapsed + _subAdvSec);
  let gi, wi;
  if(whisperWordTimestamps.length > 0){
    const wt = sub;
    let wordIdx = whisperWordTimestamps.findIndex((w, i) =>
      wt >= w.start && (i === whisperWordTimestamps.length - 1 || wt < whisperWordTimestamps[i + 1].start));
    if(wordIdx < 0) wordIdx = wt < (whisperWordTimestamps[0] && whisperWordTimestamps[0].start || 0) ? 0 : whisperWordTimestamps.length - 1;
    const m = _wordMap[Math.min(wordIdx, _wordMap.length - 1)] || {gi:0, wi:0};
    gi = m.gi; wi = m.wi;
  } else if(_isFixed){
    gi = Math.min(_totalGroups-1, Math.floor(sub/_secPerGroup));
    const gLen = (_groups[gi]||[1]).length;
    wi = Math.min(gLen-1, Math.floor(((sub/_secPerGroup)-gi)*gLen));
  } else {
    const p = Math.min(1, sub/totalDuration), rg = p*_totalGroups;
    gi = Math.min(_totalGroups-1, Math.floor(rg));
    const gLen = (_groups[gi]||[1]).length;
    wi = Math.min(gLen-1, Math.floor((rg-gi)*gLen));
  }
  if(gi < 0) gi = 0;
  return {gi, wi};
}

const _cv  = document.getElementById('subcv');
const _ctx = _cv.getContext('2d');
let _lastElapsed = 0;
function drawSubsAt(elapsed){
  _lastElapsed = elapsed;
  _ctx.clearRect(0,0,W,H);
  if(!_totalGroups) return;
  const {gi, wi} = _giWi(elapsed);
  const animElapsed = Math.max(0, elapsed - (_groupStart[gi] || 0));
  _cvSubs(_ctx, _groups[gi] || [], wi, animElapsed, W, H);
}

// ── Timeline installée SYNCHRONE (HyperFrames doit TOUJOURS trouver
//    window.__timelines['montage'] au démarrage). Le canvas est redessiné à
//    chaque frame par DEUX voies redondantes, pour ne dépendre d'aucun détail
//    de la façon dont HyperFrames seeke :
//      ① onUpdate de la timeline (fire au seek, sauf suppressEvents) ;
//      ② une vraie tween GSAP sur un proxy {t} : au seek, GSAP INTERPOLE la
//         valeur et son propre onUpdate redessine — c'est le même mécanisme que
//         les tweens DOM du montage, qui eux se rendent bien frame par frame.
//    Idempotent : draw deux fois la même frame = pixels identiques.
window.__timelines = window.__timelines || {};
const _proxy = { t: 0 };
const tl = gsap.timeline({ paused:true, onUpdate: () => drawSubsAt(tl.time()) });
tl.to(_proxy, { t: totalDuration, duration: totalDuration, ease: 'none',
  onUpdate: () => drawSubsAt(_proxy.t) }, 0);
window.__timelines['montage'] = tl;
window.__aaDrawSubsAt = drawSubsAt; // hook de test manuel
drawSubsAt(0);

// Polices : substituts embarqués chargés AVANT que ça compte. On amorce le
// chargement (canvas ne déclenche pas @font-face tout seul), on redessine la
// frame courante quand elles sont prêtes. Un primer DOM caché force aussi
// Chromium à les charger dès le rendu initial (avant la 1re capture).
if(document.fonts && document.fonts.load){
  const _fj = [
    document.fonts.load("800 48px 'Bricolage Grotesque'"),
    document.fonts.load("900 48px 'Impact'"),
    document.fonts.load("900 48px 'Arial Black'"),
  ];
  Promise.all(_fj.map(p => p && p.catch ? p.catch(()=>{}) : p))
    .then(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : null)
    .then(() => drawSubsAt(_lastElapsed))
    .catch(() => {});
}
`;

function esc(s){ return String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

// plan.subs = { groups:[[..]], whisper:[{word,start,end}]|null, cfg:{...},
//   colors:{c1,c2}, style, anim, animEnabled, totalDuration }
export function buildGenSubsComposition(plan, opts = {}) {
  const W = 1080, H = 1920;
  const D = Math.max(0.1, Number(plan.duration) || Number(plan.subs?.totalDuration) || 1);
  const subs = plan.subs || {};
  // totalDuration porté sur la durée réelle du rendu (source de vérité = plan.duration)
  const subsPayload = Object.assign({}, subs, { totalDuration: Number(subs.totalDuration) || D });
  const subsJson = JSON.stringify(subsPayload);

  const fontFace = `
    @font-face{font-family:'Bricolage Grotesque';font-style:normal;font-weight:800;font-display:block;src:url('fonts/BricolageGrotesque-800-latin.woff2') format('woff2');}
    /* substituts embarqués des polices SYSTÈME du client (le conteneur n'a que Liberation) */
    @font-face{font-family:'Impact';font-style:normal;font-weight:400 900;font-display:block;src:url('fonts/Anton-400-latin.woff2') format('woff2');}
    @font-face{font-family:'Arial Black';font-style:normal;font-weight:400 900;font-display:block;src:url('fonts/ArchivoBlack-400-latin.woff2') format('woff2');}
  `;

  return `<!doctype html><html lang="fr"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"><\/script>
<style>
  ${fontFace}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;background:#000;overflow:hidden}
  #root{position:relative;width:${W}px;height:${H}px;background:#000;overflow:hidden}
  #videozone{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;z-index:1;background:#000}
  #base{position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover;display:block}
  #subcv{position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:5;pointer-events:none}
</style>
</head><body>
  <div id="root" data-composition-id="montage" data-start="0" data-duration="${D}" data-width="${W}" data-height="${H}">
    <div id="videozone" class="clip" data-start="0" data-duration="${D}" data-track-index="2">
      <video id="base" class="clip" src="media/base.mp4" data-start="0" data-duration="${D}" data-track-index="2" muted playsinline></video>
    </div>
    <canvas id="subcv" width="${W}" height="${H}"></canvas>
  </div>
  <!-- primer polices : force Chromium à charger les woff2 dès le rendu initial (avant la 1re capture) -->
  <div aria-hidden="true" style="position:absolute;left:-9999px;top:-9999px;opacity:0;pointer-events:none">
    <span style="font:800 40px 'Bricolage Grotesque'">Éàçùî</span>
    <span style="font:900 40px 'Impact'">Éàçùî</span>
    <span style="font:900 40px 'Arial Black'">Éàçùî</span>
  </div>
  <script>
    const SUBS = ${subsJson};
    ${CV_SUBS_SRC}
    ${DRIVER_SRC}
  <\/script>
</body></html>`;
}
