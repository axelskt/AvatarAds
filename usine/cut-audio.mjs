#!/usr/bin/env node
// Creative Factory — découpe un audio Cartoon en briques réutilisables : HOOK / LIAISON / CONTENU / CTA.
// Précision via Whisper (large-v3 FR, mots+timestamps). Le HOOK est ancré sur son script H<N> connu
// (alignement flou) ; le CTA est repéré par mots-clés d'appel à l'action ; coupes calées sur les PAUSES.
// Usage : node usine/cut-audio.mjs <audio> <outDir> <cartoonN> [hookScriptFile]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [audio, outDir, cartoonN, hookScriptFile] = process.argv.slice(2);
if (!audio || !outDir || !cartoonN) { console.error('usage: cut-audio.mjs <audio> <outDir> <cartoonN> [hookScriptFile]'); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'cut-'));
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

// 1) transcription
execFileSync('ffmpeg', ['-v','error','-y','-i', audio, '-vn','-ac','1','-ar','16000', join(work,'a.wav')]);
execFileSync('npx', ['--yes','hyperframes','transcribe', join(work,'a.wav'), '-d', work, '--json','--model','large-v3','--language','fr','--timeout','600000'], { stdio:'inherit' });
const tr = JSON.parse(readFileSync(join(work,'transcript.json'),'utf8'));
const words = (Array.isArray(tr)?tr:(tr.words||[])).map(w=>({t:String(w.text||w.word||'').trim(), s:+w.start, e:+w.end}))
  .filter(w=>w.t && isFinite(w.s) && isFinite(w.e)).sort((a,b)=>a.s-b.s);
const total = words.length ? words[words.length-1].e : 0;
const fullText = words.map(w=>w.t).join(' ');
console.log(`  ${words.length} mots · ${total.toFixed(1)}s`);

// gaps (pauses) pour couper proprement : on cale un point de coupe sur le plus grand silence proche
const gapAfter = i => (i<words.length-1) ? (words[i+1].s - words[i].e) : 1;
const snapToPause = (idx) => { let best=idx; for(let j=Math.max(0,idx-3);j<=Math.min(words.length-1,idx+3);j++){ if(gapAfter(j)>gapAfter(best)) best=j; } return best; };

// 2) HOOK : aligner la fin du script H<N> sur le transcript (flou)
let hookEndIdx = Math.min(words.length-1, 18); // repli : ~18 premiers mots
if (hookScriptFile && existsSync(hookScriptFile)) {
  const hookTokens = norm(readFileSync(hookScriptFile,'utf8')).split(' ').filter(Boolean);
  const wn = words.map(w=>norm(w.t));
  // fenêtre glissante : position i où wn[i..] recouvre le plus de tokens du hook (dans l'ordre)
  let bestI=hookEndIdx, bestScore=-1;
  for (let i=Math.floor(hookTokens.length*0.5); i<Math.min(wn.length, hookTokens.length*2.2); i++){
    let hi=0, score=0;
    for (let k=0;k<=i && hi<hookTokens.length;k++){ if(wn[k]===hookTokens[hi]){ hi++; score++; } }
    if (score>=bestScore){ bestScore=score; bestI=i; }
  }
  if (bestScore >= Math.max(3, hookTokens.length*0.4)) hookEndIdx = bestI;
}
hookEndIdx = snapToPause(hookEndIdx);

// 3) CTA : chercher un appel à l'action dans le dernier tiers
const CTA_RE = /(lien en bio|en bio|va(s)? sur (le site|avatarads)|sur avatarads|avatarads\.?fr|le lien|je te mets le lien|en commentaire|commente|ecris[- ]?moi|envoie[- ]?moi|abonne|clique|teste|essaie|tu peux tester|gratuit|dispo|mets? le mot)/i;
let ctaStartIdx = -1;
for (let i=Math.floor(words.length*0.6); i<words.length; i++){
  const windowTxt = words.slice(i, Math.min(words.length, i+10)).map(w=>w.t).join(' ');
  if (CTA_RE.test(norm(windowTxt))) { ctaStartIdx = i; break; }
}
if (ctaStartIdx < 0) ctaStartIdx = words.length; // pas de CTA détecté
else ctaStartIdx = snapToPause(ctaStartIdx-1)+1;

// 4) LIAISON : connecteur court juste après le hook
const LIA_RE = /(et je (t'|te )?explique|laisse[- ]?moi|je vais te montrer|regarde|voici comment|suis[- ]?moi|je t'explique exactement|dans (cette|la) video|reste jusqu)/i;
let liaisonEndIdx = hookEndIdx;
{
  const windowTxt = words.slice(hookEndIdx+1, Math.min(ctaStartIdx, hookEndIdx+14)).map(w=>w.t).join(' ');
  if (LIA_RE.test(norm(windowTxt))) {
    // fin de la phrase de liaison = première pause nette après le hook (dans les 14 mots)
    let end=hookEndIdx+1; for(let j=hookEndIdx+1;j<Math.min(ctaStartIdx,hookEndIdx+14);j++){ if(gapAfter(j)>0.28){ end=j; break; } end=j; }
    liaisonEndIdx = end;
  }
}

// bornes temporelles
const tAt = (idx, side) => idx<=0 ? 0 : idx>=words.length ? total : (side==='end'? (words[idx].e+gapAfter(idx)/2) : (words[idx].s - Math.min(0.15,(idx>0?gapAfter(idx-1)/2:0.1))));
const segs = [];
segs.push({ id:`H${cartoonN}-audio`, kind:'hook',   a:0,                         b:tAt(hookEndIdx,'end') });
if (liaisonEndIdx>hookEndIdx) segs.push({ id:`L${cartoonN}`, kind:'liaison', a:tAt(hookEndIdx+1,'start'), b:tAt(liaisonEndIdx,'end') });
segs.push({ id:`C${cartoonN}-audio`, kind:'contenu', a:tAt((liaisonEndIdx>hookEndIdx?liaisonEndIdx:hookEndIdx)+1,'start'), b: ctaStartIdx<words.length? tAt(ctaStartIdx-1,'end'):total });
if (ctaStartIdx<words.length) segs.push({ id:`CTA${cartoonN}-audio`, kind:'cta', a:tAt(ctaStartIdx,'start'), b:total });

// 5) découpe ffmpeg
const manifest = [];
for (const seg of segs){
  if (seg.b - seg.a < 0.4) continue;
  const out = join(outDir, `${seg.id}.wav`);
  execFileSync('ffmpeg', ['-v','error','-y','-i', audio, '-ss', seg.a.toFixed(2), '-to', seg.b.toFixed(2), '-ac','1','-ar','48000', out]);
  const inSeg = words.filter(w=>w.e>seg.a-0.05 && w.s<seg.b+0.05);
  const txt = inSeg.map(w=>w.t).join(' ');
  // SOUS-TITRES PORTÉS PAR LA BRIQUE : timings RELATIFS au début de la brique (réutilisables, calculés 1×).
  const captions = inSeg.map(w=>({ t:w.t, s:+Math.max(0,w.s-seg.a).toFixed(3), e:+Math.min(seg.b-seg.a, w.e-seg.a).toFixed(3) }));
  manifest.push({ ...seg, file:out, dur:+(seg.b-seg.a).toFixed(2), text:txt, captions });
  console.log(`  ✂ ${seg.kind.padEnd(8)} ${seg.a.toFixed(1)}→${seg.b.toFixed(1)}s  ${seg.id}`);
}
writeFileSync(join(outDir, `cartoon-${cartoonN}.manifest.json`), JSON.stringify({ cartoon:+cartoonN, total, fullText, segs:manifest }, null, 2));
console.log('OK ->', outDir);
