#!/usr/bin/env node
// Creative Factory — découpe un audio Cartoon en briques réutilisables : HOOK / LIAISON / CONTENU / CTA.
// Précision via Whisper (large-v3 FR, mots+timestamps). Le HOOK est ancré sur son script H<N> connu
// (alignement flou) ; le CTA est repéré par mots-clés d'appel à l'action ; coupes calées sur les PAUSES.
// Usage : node usine/cut-audio.mjs <audio> <outDir> <cartoonN> [hookScriptFile]
import { execFileSync, spawnSync } from 'node:child_process';
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
let words = (Array.isArray(tr)?tr:(tr.words||[])).map(w=>({t:String(w.text||w.word||'').trim(), s:+w.start, e:+w.end}))
  .filter(w=>w.t && isFinite(w.s) && isFinite(w.e)).sort((a,b)=>a.s-b.s);

// ── Correction MARQUE (Whisper : « avatar hats », « atarhats.fr, »…) tolérante à la ponctuation ──
const bareOf = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
const brandFix = t => { const b = bareOf(t);
  if (/atarhat|avatarad|atarad|avatarhat|avataraad/.test(b)) return (/fr$/.test(b) || /\.?fr\b/i.test(t)) ? 'avatarads.fr' : 'avatarads';
  return t; };
{ const merged=[]; for(let i=0;i<words.length;i++){ const w=words[i], n=words[i+1];
    if(n && /^a?v?atar$/.test(bareOf(w.t)) && /^(hat|had|ad|rad|hads|aad)/.test(bareOf(n.t))){
      merged.push({ t:(/fr/.test(bareOf(n.t))||/\.fr/i.test(n.t))?'avatarads.fr':'avatarads', s:w.s, e:n.e }); i++;
    } else merged.push(w);
  } words = merged.map(w=>({ ...w, t:brandFix(w.t) })); }

const total = words.length ? words[words.length-1].e : 0;
const fullText = words.map(w=>w.t).join(' ');
console.log(`  ${words.length} mots · ${total.toFixed(1)}s`);

// gaps (pauses) pour couper proprement : on cale un point de coupe sur le plus grand silence proche
const gapAfter = i => (i<words.length-1) ? (words[i+1].s - words[i].e) : 1;
// snap sur la plus GROSSE pause proche, biaisé vers l'AVANT (fin de phrase) pour ne pas déborder sur la suite
const snapToPause = (idx) => { let best=idx, bestGap=gapAfter(idx);
  for(let j=Math.max(0,idx-5);j<=Math.min(words.length-1,idx+2);j++){ if(gapAfter(j) > bestGap+0.02){ bestGap=gapAfter(j); best=j; } } return best; };

// ── Segmentation par CUES (structure Miro : HOOK → [« et là je vais… » LIAISON] → CONTENU(jeté) → CTA) ──
// Le hook s'arrête à la FIN DE SA PHRASE, juste avant le connecteur « et là je vais t'apprendre… ».
const CONNECT_RE = /(et (l[aà] )?je vais|je vais (t'|te )?(apprendre|montrer|expliquer|donner)|et je (t'|te )?explique|laisse[- ]?moi|je te (montre|donne)|et maintenant|maintenant (je|voici)|dans (cette|la) video)/i;
const CONTENT_RE = /(c'est ce qu'on appelle|pour que (ca|ça) fonctionne|commence par|premierement|ensuite|rends[- ]?toi|selectionne|clique|voici comment (faire|creer)|la premiere etape|tu as juste (a|à)|il faut d'abord|il te suffit|tape ton|va(s)? dans (l'onglet|express)|ouvre (l'onglet|le module))/i;
const CTA_RE = /(lien en bio|en bio|va(s)? sur (le site|avatarads)|sur avatarads|avatarads\.?fr|je te mets le lien|en commentaire|commente|ecris[- ]?moi|envoie[- ]?moi|abonne|teste (par|le|toi)|gratuit(ement)?|mets? le mot|sous la video|va(s)? le tester|recevoir gratuit)/i;
const findIdx = (re, from, to) => { for(let i=Math.max(0,from);i<Math.min(words.length,to);i++){ if(re.test(norm(words.slice(i,i+9).map(x=>x.t).join(' ')))) return i; } return -1; };

const connIdx = findIdx(CONNECT_RE, 2, 44);
const contIdx = findIdx(CONTENT_RE, connIdx>0?connIdx+1:2, 75);
const ctaIdx  = findIdx(CTA_RE, Math.floor(words.length*0.5), words.length);

const hookEndIdx = snapToPause(connIdx>0 ? connIdx-1 : (contIdx>0 ? contIdx-1 : Math.min(words.length-1,14)));
const liaEndIdx  = (connIdx>0) ? snapToPause(contIdx>connIdx ? contIdx-1 : hookEndIdx+8) : hookEndIdx;

const tAt = (idx, side) => idx<=0 ? 0 : idx>=words.length ? total : (side==='end'? (words[idx].e+Math.min(0.18,gapAfter(idx)/2)) : (words[idx].s - Math.min(0.12,(idx>0?gapAfter(idx-1)/2:0.08))));
const HOOK_START = Math.max(0, (words[0]?.s ?? 0) - 0.06);   // démarre au 1er mot → coupe la vibration/clic du début

// ⚠️ Axel : on ne garde QUE hook / liaison / CTA — le CONTENU est jeté (la brique contenu = la démo, déjà à part).
const segs = [];
segs.push({ id:`H${cartoonN}-audio`, kind:'hook', a:HOOK_START, b:tAt(hookEndIdx,'end') });
if (liaEndIdx>hookEndIdx) segs.push({ id:`L${cartoonN}-audio`, kind:'liaison', a:tAt(hookEndIdx+1,'start'), b:tAt(liaEndIdx,'end') });
if (ctaIdx>0) segs.push({ id:`CTA${cartoonN}-audio`, kind:'cta', a:tAt(snapToPause(ctaIdx-1)+1,'start'), b:total });

// 5) découpe ffmpeg
const manifest = [];
for (const seg of segs){
  if (seg.b - seg.a < 0.4) continue;
  const out = join(outDir, `${seg.id}.wav`);
  const segdur = seg.b - seg.a;
  // anti-vibration : highpass (coupe le rumble/clic sub-grave) + fondu in/out court aux bords
  execFileSync('ffmpeg', ['-v','error','-y','-ss', seg.a.toFixed(2), '-t', segdur.toFixed(2), '-i', audio,
    '-af', `highpass=f=65,afade=t=in:st=0:d=0.05,afade=t=out:st=${Math.max(0,segdur-0.07).toFixed(2)}:d=0.07`,
    '-ac','1','-ar','48000', out]);
  const inSeg = words.filter(w=>w.e>seg.a-0.05 && w.s<seg.b+0.05);
  const txt = inSeg.map(w=>w.t).join(' ');
  // SOUS-TITRES PORTÉS PAR LA BRIQUE : timings RELATIFS au début de la brique (réutilisables, calculés 1×).
  const captions = inSeg.map(w=>({ t:w.t, s:+Math.max(0,w.s-seg.a).toFixed(3), e:+Math.min(seg.b-seg.a, w.e-seg.a).toFixed(3) }));
  // ── VÉRIFICATION : ça s'entend ? c'est bien découpé ? ──
  let meanDb = NaN;
  { const r = spawnSync('ffmpeg', ['-hide_banner','-i', out, '-af','volumedetect','-f','null','-'], { encoding:'utf8' });
    const m = /mean_volume:\s*(-?\d+(\.\d+)?) dB/.exec((r.stderr||'')+(r.stdout||'')); if(m) meanDb=+m[1]; }
  const audible = isFinite(meanDb) && meanDb > -45;      // sinon quasi silence
  const wordsOk = inSeg.length >= (seg.kind==='cta'?2:2);
  const ok = audible && wordsOk && (seg.b-seg.a)>=0.5;
  manifest.push({ ...seg, file:out, dur:+(seg.b-seg.a).toFixed(2), text:txt, captions, meanDb, audible, wordsOk, ok });
  console.log(`  ${ok?'✓':'⚠'} ${seg.kind.padEnd(8)} ${seg.a.toFixed(1)}→${seg.b.toFixed(1)}s  ${seg.id}  (${inSeg.length} mots, ${isFinite(meanDb)?meanDb.toFixed(0):'?'}dB)  « ${txt.slice(0,60)} »`);
}
writeFileSync(join(outDir, `cartoon-${cartoonN}.manifest.json`), JSON.stringify({ cartoon:+cartoonN, total, fullText, segs:manifest }, null, 2));
console.log('OK ->', outDir);
