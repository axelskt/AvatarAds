#!/usr/bin/env node
// Creative Factory — découpe un audio Cartoon en briques réutilisables : HOOK / LIAISON / CTA.
// Le CONTENU (le tuto appli : avatarads.fr, Images IA, Montage IA…) est JETÉ (on a déjà la brique démo).
// Précision via Whisper (large-v3 FR, mots+timestamps).
//   HOOK    = accroche + PROMESSE (« et là je vais t'apprendre à faire la même chose ») → jusqu'au bloc conceptuel.
//   LIAISON = le bloc CONCEPTUEL/générique (« c'est ce qu'on appelle un influenceur IA… rediriger ton audience ») → jusqu'au tuto appli.
//   CTA     = le close (« Des centaines de personnes… » / « Go sous la vidéo et va sur avatarads.fr… »).
// Anti-vibration : détection acoustique du VRAI début de voix (saute un blip/artefact de début d'enregistrement).
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

// 1) transcription (cache : on ne re-transcrit pas le même audio)
const cacheFile = join(outDir, `cartoon-${cartoonN}.transcript.json`);
let rawTr;
if (existsSync(cacheFile)) { rawTr = JSON.parse(readFileSync(cacheFile,'utf8')); console.log('  (transcript en cache)'); }
else {
  execFileSync('ffmpeg', ['-v','error','-y','-i', audio, '-vn','-ac','1','-ar','16000', join(work,'a.wav')]);
  execFileSync('npx', ['--yes','hyperframes','transcribe', join(work,'a.wav'), '-d', work, '--json','--model','large-v3','--language','fr','--timeout','600000'], { stdio:'inherit' });
  const tr = JSON.parse(readFileSync(join(work,'transcript.json'),'utf8'));
  rawTr = (Array.isArray(tr)?tr:(tr.words||[])).map(w=>({t:String(w.text||w.word||'').trim(), s:+w.start, e:+w.end}));
  writeFileSync(cacheFile, JSON.stringify(rawTr));
}
let words = rawTr.map(w=>({t:String(w.t||'').trim(), s:+w.s, e:+w.e}))
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
// Whisper entend « Commente » comme « commande » dans le CTA (« commande go ») → correction ciblée.
words = words.map((w,i)=>{ const b=bareOf(w.t), nx=words[i+1]?bareOf(words[i+1].t):'';
  return (b==='commande' && (nx==='go'||nx==='le')) ? { ...w, t:'Commente' } : w; });

const total = words.length ? words[words.length-1].e : 0;
const fullText = words.map(w=>w.t).join(' ');
console.log(`  ${words.length} mots · ${total.toFixed(1)}s`);

// gaps (pauses) : repérage des fins de phrase / coupes calées sur les silences
const gapAfter = i => (i<words.length-1) ? (words[i+1].s - words[i].e) : 1;
const tAt = (idx, side) => idx<=0 ? 0 : idx>=words.length ? total
  : (side==='end'
      ? (words[idx].e + Math.min(0.18, gapAfter(idx)/2))
      : (words[idx].s - Math.min(0.12, (idx>0 ? gapAfter(idx-1)/2 : 0.08))));

// ── ANTI-VIBRATION : vrai début de voix ──
// Un artefact de début d'enregistrement (clic/souffle/reliquat de débruitage) précède parfois la voix,
// séparé d'elle par un court silence. Whisper l'accroche au 1er mot (voire hallucine « Sous-titrage… »).
// On mesure le RMS par 20 ms et on saute un « blip » court (<250 ms) suivi d'un vrai silence (≥40 ms).
function rmsWindows(audioFile, dur, winMs=20){
  const n = Math.round(16000*winMs/1000);
  const r = spawnSync('ffmpeg', ['-hide_banner','-ss','0','-t', String(dur), '-i', audioFile,
    '-af', `aresample=16000,asetnsamples=n=${n}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    '-f','null','-'], { encoding:'utf8' });
  const out = (r.stderr||'')+(r.stdout||''); const vals=[]; const re=/RMS_level=(-?\d+(?:\.\d+)?|-?inf|nan)/g; let m;
  while((m=re.exec(out))) vals.push(/inf|nan/.test(m[1]) ? -120 : parseFloat(m[1]));
  return vals;
}
// ⚠️ transcrire un clip TROP COURT (<0,5s) fait halluciner Whisper (« sous-titrage… ») même sur de la voix.
// Test fiable : transcrire un clip LONG (1,4s) depuis le point candidat `t`, et regarder si ça COMMENCE
// par le 1er mot attendu du hook. Si oui → la tête avant `t` était un artefact (on coupe). Sinon → voix (on garde).
function leadIsArtifact(audioFile, t, firstWord){
  try {
    const clip = join(work,'lead.wav'), ldir = join(work,'lead');
    execFileSync('ffmpeg', ['-v','error','-y','-ss', t.toFixed(3), '-t','1.40', '-i', audioFile, '-ac','1','-ar','16000', clip]);
    execFileSync('npx', ['--yes','hyperframes','transcribe', clip, '-d', ldir, '--json','--model','large-v3','--language','fr','--timeout','120000'], { stdio:'ignore' });
    const lt = JSON.parse(readFileSync(join(ldir,'transcript.json'),'utf8'));
    const arr = Array.isArray(lt)?lt:(lt.words||[]);
    const a = norm(arr[0]?.text||arr[0]?.word||'').replace(/ /g,'');
    const b = norm(firstWord||'').replace(/ /g,'');
    if(!a||!b) return false;
    const match = a===b || (b.length>=3 && a.startsWith(b.slice(0,3))) || (a.length>=3 && b.startsWith(a.slice(0,3)));
    console.log(`  · après ${t.toFixed(2)}s → « ${a} » (attendu « ${b} ») → ${match?'tête = ARTEFACT (coupée)':'tête = VOIX (gardée)'}`);
    return match;
  } catch(e){ return false; }                                   // en cas de doute : on NE coupe PAS la voix
}
function hookOnset(audioFile, hint){
  const winMs=20, THR=-42, SIL=-50, MAXSHIFT=0.6;
  const rms = rmsWindows(audioFile, Math.max(0.5, (hint||0)+0.6), winMs);
  const clean = Math.max(0, (hint ?? 0) - 0.04);
  if(rms.length<3) return clean;
  const runs=[]; let s=-1;
  for(let i=0;i<rms.length;i++){ if(rms[i]>THR){ if(s<0)s=i; } else { if(s>=0){runs.push([s,i-1]); s=-1;} } }
  if(s>=0) runs.push([s,rms.length-1]);
  if(!runs.length) return clean;
  let pick=0, skipped=false;
  for(let k=0;k<runs.length;k++){
    const [a,b]=runs[k]; const lenMs=(b-a+1)*winMs;
    if(k+1<runs.length){                                        // vrai silence entre ce run et le suivant ?
      const gs=b+1, ge=runs[k+1][0]-1; let sil=0;
      for(let j=gs;j<=ge;j++){ if(rms[j]<SIL) sil++; }
      if(lenMs<250 && sil>=2){ skipped=true; continue; }        // candidat blip court + silence → on remonte
    }
    pick=k; break;
  }
  if(!skipped) return clean;                                     // pas de tête isolée → début propre
  let t = runs[pick][0]*winMs/1000 - 0.02;
  if(t>MAXSHIFT || t<=clean+0.03) return clean;                 // garde-fou
  // ⚠️ acoustiquement un mot et un artefact sont identiques → on transcrit APRÈS `t` pour trancher.
  return leadIsArtifact(audioFile, t, words[0]?.t) ? t : clean; // artefact → on saute ; voix → on garde
}
const HOOK_START = hookOnset(audio, words[0]?.s ?? 0);

// ── Segmentation (structure Miro) ──
// ⚠️ patterns au format NORMALISÉ : norm() met en minuscules, retire accents, remplace apostrophes/traits par ESPACE.
// La PROMESSE fait partie du hook (Axel) — elle n'est PAS une borne.
// CONCEPT = début du bloc conceptuel (= fin du hook, début de la liaison).
const CONCEPT_RE = /(c est ce qu?e? ?(l ?)?on appelle|et c est (comme ca|ce qu on)|pour que (ca|cela) fonctionne|il (te )?faut d abord)/i;
// TUTO = 1re ÉTAPE CONCRÈTE du tuto appli (= fin de la liaison, début du CONTENU jeté).
// ⚠️ la transition « maintenant pour créer ton influenceur IA » reste DANS la liaison (Axel) →
//    on n'ancre PAS sur « maintenant », mais sur la 1re instruction concrète (compte / onglet / avatarads.fr).
const TUTO_RE = /(commence par (creer|te rendre|par aller|aller|choisir ton|selectionner|te connecter)|cree(r| toi)? (un |ton )?compte|connecte ?toi|rends ?toi (dans|sur)|(va|vas|rends|rendez) (sur|dans) (le site|avatarads|l app|l onglet)|ouvre (l onglet|le module|l application)|va(s)? dans l onglet|sur avatarads|dans l onglet (images|montage)|selectionne (photos|le format|l onglet))/i;
// Close/CTA
const CLOSE_OPENER_RE = /^(des centaines|des milliers|si tu veux (la|le|ca|ce|reussir|avoir|faire|toi))/i;
const CTA_IMP_RE = /^(go|commente|clique|va |vas |teste|abonne|rends|ecris|envoie|mets|recois|recupere|profite|rejoins|telecharge|inscris)/i;

const are = re => new RegExp('^(?:'+re.source+')', re.flags.replace('g',''));
const win = (i,n=6) => norm(words.slice(i, i+n).map(x=>x.t).join(' '));
const findIdx = (re, from, to) => { const a=are(re); for(let i=Math.max(0,from);i<Math.min(words.length,to);i++){ if(a.test(win(i))) return i; } return -1; };

const conceptIdx = findIdx(CONCEPT_RE, 3, Math.max(6, Math.floor(words.length*0.6)));
const hookEndIdx = conceptIdx>0 ? conceptIdx-1 : Math.min(words.length-1, 14);
const tutoIdx    = conceptIdx>0 ? findIdx(TUTO_RE, conceptIdx+2, Math.max(conceptIdx+3, Math.floor(words.length*0.92))) : -1;
// LIAISON = bloc conceptuel entre le hook et le tuto appli (souvent long ; jusqu'à 40 s).
let liaSeg = null;
if (conceptIdx>0 && tutoIdx>conceptIdx+1){
  const la=tAt(conceptIdx,'start'), lb=tAt(tutoIdx-1,'end');
  if ((lb-la)>=0.6 && (lb-la)<=40) liaSeg={ a:la, b:lb, from:conceptIdx, to:tutoIdx-1 };
}

// CTA : 1) opener de close explicite (Des centaines / si tu veux) ; 2) sinon on ancre sur le close
//       (« … sous la vidéo et va sur avatarads.fr … ») et on remonte à l'impératif de début de phrase ;
//       3) repli : dernière phrase impérative.
let ctaIdx = -1;
{ const a=are(CLOSE_OPENER_RE);
  for(let i=Math.floor(words.length*0.5);i<words.length;i++){
    const sStart=(i===0)||gapAfter(i-1)>0.25; if(sStart && a.test(win(i,4))){ ctaIdx=i; break; } } }
if (ctaIdx<0){
  const CTA_CUE=/(sous la video|commente|commande go|va sur avatarads|teste par toi|mets le mot|lien en bio)/i;
  const ca=are(CTA_CUE); let cue=-1;
  for(let i=Math.floor(words.length*0.5);i<words.length;i++){ if(ca.test(win(i,3))) cue=i; }   // dernière occurrence
  if(cue>0){
    const IMP=/^(go|commente|commande|clique|mets|abonne|ecris|envoie|rejoins|teste|profite|recois|recupere|va |vas )/i;
    const ia=are(IMP); let st=cue;
    for(let j=cue;j>=Math.max(0,cue-9);j--){ if(ia.test(win(j,2))) st=j; }   // 1er impératif de la fenêtre du close
    ctaIdx=st;
  }
}
if (ctaIdx<0){ const a=are(CTA_IMP_RE);
  for(let i=Math.floor(words.length*0.5);i<words.length;i++){
    const sStart=(i===0)||gapAfter(i-1)>0.28; if(sStart && a.test(win(i,3))) ctaIdx=i; } } // on garde la DERNIÈRE

// ⚠️ Axel : on ne garde QUE hook / liaison / CTA — le CONTENU (tuto appli) est jeté.
const segs = [];
segs.push({ id:`H${cartoonN}-audio`, kind:'hook', a:HOOK_START, b:tAt(hookEndIdx,'end') });
if (liaSeg) segs.push({ id:`L${cartoonN}-audio`, kind:'liaison', a:liaSeg.a, b:liaSeg.b });
if (ctaIdx>0) segs.push({ id:`CTA${cartoonN}-audio`, kind:'cta', a:tAt(ctaIdx,'start'), b:total });

// découpe ffmpeg + vérification
const manifest = [];
for (const seg of segs){
  if (seg.b - seg.a < 0.4) continue;
  const out = join(outDir, `${seg.id}.wav`);
  const segdur = seg.b - seg.a;
  // highpass léger + fondus courts (le vrai anti-vibration est le calage du début sur la voix)
  execFileSync('ffmpeg', ['-v','error','-y','-ss', seg.a.toFixed(3), '-t', segdur.toFixed(3), '-i', audio,
    '-af', `highpass=f=70,afade=t=in:st=0:d=0.03,afade=t=out:st=${Math.max(0,segdur-0.07).toFixed(3)}:d=0.07`,
    '-ac','1','-ar','48000', out]);
  const inSeg = words.filter(w=>{ const mid=(w.s+w.e)/2; return mid>=seg.a-0.02 && mid<=seg.b+0.02; }); // 1 mot = 1 segment (milieu)
  const txt = inSeg.map(w=>w.t).join(' ');
  const captions = inSeg.map(w=>({ t:w.t, s:+Math.max(0,w.s-seg.a).toFixed(3), e:+Math.min(seg.b-seg.a, w.e-seg.a).toFixed(3) }));
  let meanDb = NaN;
  { const r = spawnSync('ffmpeg', ['-hide_banner','-i', out, '-af','volumedetect','-f','null','-'], { encoding:'utf8' });
    const m = /mean_volume:\s*(-?\d+(\.\d+)?) dB/.exec((r.stderr||'')+(r.stdout||'')); if(m) meanDb=+m[1]; }
  const audible = isFinite(meanDb) && meanDb > -45;
  const wordsOk = inSeg.length >= 2;
  const ok = audible && wordsOk && (seg.b-seg.a)>=0.5;
  manifest.push({ ...seg, file:out, dur:+(seg.b-seg.a).toFixed(2), text:txt, captions, meanDb, audible, wordsOk, ok });
  console.log(`  ${ok?'✓':'⚠'} ${seg.kind.padEnd(8)} ${seg.a.toFixed(2)}→${seg.b.toFixed(2)}s (${(seg.b-seg.a).toFixed(1)}s)  ${seg.id}  (${inSeg.length} mots, ${isFinite(meanDb)?meanDb.toFixed(0):'?'}dB)  « ${txt.slice(0,60)}${txt.length>60?'…':''} »`);
}
writeFileSync(join(outDir, `cartoon-${cartoonN}.manifest.json`), JSON.stringify({ cartoon:+cartoonN, total, fullText, segs:manifest }, null, 2));
console.log('OK ->', outDir);
