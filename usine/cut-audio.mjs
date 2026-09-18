#!/usr/bin/env node
// Creative Factory — découpe un audio Cartoon en briques réutilisables : HOOK / LIAISON / CTA.
// Le CONTENU (le tuto appli : avatarads.fr, Images IA, Montage IA…) est JETÉ (on a déjà la brique démo).
// Précision via Whisper (large-v3 FR, mots+timestamps).
//   HOOK    = accroche + PROMESSE (« et là je vais t'apprendre à faire la même chose ») → jusqu'au bloc conceptuel.
//   LIAISON = le bloc CONCEPTUEL/générique (« c'est ce qu'on appelle un influenceur IA… rediriger ton audience ») → jusqu'au tuto appli.
//   CTA     = le close (« Des centaines de personnes… » / « Go sous la vidéo et va sur avatarads.fr… »).
// Anti-vibration : détection acoustique du VRAI début de voix (saute un blip/artefact de début d'enregistrement).
// Usage : node usine/cut-audio.mjs <audio> <outDir> <cartoonN> [parts] [briefFile]
//   parts    = liste des briques à produire, ex. "hook" ou "hook,cta" (défaut : hook,liaison,cta)
//   briefFile= JSON {hook, liaison, cta} : textes EXACTS fournis par Axel → mode TEXTE-ANCRÉ (aligne
//              chaque texte sur la transcription au lieu des marqueurs). Une clé absente = brique non produite.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [audio, outDir, cartoonN, partsArg, briefFile] = process.argv.slice(2);
if (!audio || !outDir || !cartoonN) { console.error('usage: cut-audio.mjs <audio> <outDir> <cartoonN> [parts] [briefFile]'); process.exit(1); }
const KEEP = new Set((partsArg && partsArg!=='all' ? partsArg : 'hook,liaison,cta').split(',').map(s=>s.trim()).filter(Boolean));
const brief = (briefFile && existsSync(briefFile)) ? JSON.parse(readFileSync(briefFile,'utf8')) : null;
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
  if (/atarhat|avatarad|atarad|avatarhat|avataraad|avataha|atahad|avataads/.test(b)) return (/fr$/.test(b) || /\.?fr\b/i.test(t)) ? 'avatarads.fr' : 'avatarads';
  return t; };
{ const merged=[]; for(let i=0;i<words.length;i++){ const w=words[i], n=words[i+1];
    if(n && /^a?v?atar$/.test(bareOf(w.t)) && /^(hat|had|ad|rad|hads|aad)/.test(bareOf(n.t))){
      merged.push({ t:(/fr/.test(bareOf(n.t))||/\.fr/i.test(n.t))?'avatarads.fr':'avatarads', s:w.s, e:n.e }); i++;
    } else merged.push(w);
  } words = merged.map(w=>({ ...w, t:brandFix(w.t) })); }
// Whisper entend « Commente » comme « commande » dans le CTA (« commande go ») → correction ciblée.
words = words.map((w,i)=>{ const b=bareOf(w.t), nx=words[i+1]?bareOf(words[i+1].t):'';
  return ((b==='commande'||b==='commence') && (nx==='go'||nx==='le'||nx==='site'||nx==='ia'||nx==='dm'||nx==='ce')) ? { ...w, t:'Commente' } : w; });

const total = words.length ? words[words.length-1].e : 0;
const fullText = words.map(w=>w.t).join(' ');
const fileDur = parseFloat(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0', audio]).toString().trim()) || total;
console.log(`  ${words.length} mots · ${total.toFixed(1)}s`);

// ── MASTERING VOIX « Podcast » (réplique de _acMasterVoice de l'app, preset podcast) ──
// highpass 78 + EQ (dé-boue 400/-4.2, présence 175/+1.4, air 3400/+6.8) + compresseur + loudnorm -14.8.
const MASTER = 'highpass=f=78:width_type=q:width=0.7'
  + ',equalizer=f=400:width_type=q:width=0.95:g=-4.2'
  + ',equalizer=f=175:width_type=q:width=0.8:g=1.4'
  + ',highshelf=f=3400:g=6.8'
  + ',acompressor=threshold=-25dB:ratio=4.8:attack=3:release=110'
  + ',loudnorm=I=-14.8:TP=-1.5:LRA=11';

// gaps (pauses) : repérage des fins de phrase / coupes calées sur les silences
const gapAfter = i => (i<words.length-1) ? (words[i+1].s - words[i].e) : 1;
const tAt = (idx, side) => idx<=0 ? 0 : idx>=words.length ? total
  : (side==='end'
      // marge de fin : ≥120 ms de traîne (Whisper marque souvent la fin du mot TÔT ; on capte la traîne
      // du dernier mot — « manière », « marché » — même sans blanc, le mot suivant est fondu).
      ? (words[idx].e + Math.max(0.15, Math.min(0.26, gapAfter(idx)*0.9)))
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
// TUTO = début du tuto appli (= fin de la liaison, début du CONTENU jeté).
// ⚠️ Axel : « maintenant pour créer ton influenceur IA » NE doit PAS rester dans la liaison (ça empiète
//    sur la démo) → on ancre sur la transition « maintenant … » ET sur la 1re instruction concrète.
const TUTO_RE = /(maintenant,? (pour (creer|faire|bien)|voici|on va|je vais te (montrer|expliquer)|rends|va |il (te )?faut|c est parti|creons|on cree|suis)|(et |alors |donc )?pour (faire ca|creer ton|creer un|animer|finir|bien commencer|commencer)|pour commencer|commenc(er|ez|ons)|la premiere etape|commence par (creer|te rendre|par aller|aller|choisir ton|selectionner|te connecter)|cree(r| toi)? (un |ton )?compte|connecte ?toi|rends ?toi (dans|sur)|tu vas (te rendre|aller (dans|sur)|cliquer|ouvrir|ajouter|selectionner|importer|decrire|generer)|(va|vas|rends|rendez) (sur|dans) (le site|avatarads|l app|l onglet)|ouvre (l onglet|le module|l application)|va(s)? dans l onglet|sur avatarads|dans l onglet (images|montage)|selectionne (photos|le format|l onglet)|clique sur (commencer|le bouton|creer))/i;
// Close/CTA — openers de close variés (« Des centaines… », « Si tu veux… », « Tu veux la méthode… »)
const CLOSE_OPENER_RE = /^(des centaines|des milliers|si tu veux (la|le|ca|ce|reussir|avoir|faire|toi)|tu veux (la|le|ce|recevoir|avoir|apprendre|reussir|obtenir|savoir))/i;
const CTA_IMP_RE = /^(go|commente|commande|marque|clique|va |vas |teste|abonne|rends|ecris|envoie|mets|recois|recupere|profite|rejoins|telecharge|inscris)/i;

const are = re => new RegExp('^(?:'+re.source+')', re.flags.replace('g',''));
const win = (i,n=6) => norm(words.slice(i, i+n).map(x=>x.t).join(' '));
const findIdx = (re, from, to) => { const a=are(re); for(let i=Math.max(0,from);i<Math.min(words.length,to);i++){ if(a.test(win(i))) return i; } return -1; };

// ── ALIGNEMENT TEXTE (mode texte-ancré) : trouve dans la transcription où un texte fourni commence/finit ──
// ⚠️ un mot Whisper avec apostrophe/trait (« c'est » → « c est ») donne DEUX tokens après norm() → on
//    aplatit tous les mots en tokens individuels (flatToks) avec la correspondance vers l'index de MOT.
const flatToks = [], tokToWord = [];
words.forEach((w,wi)=>{ for(const tk of norm(w.t).split(' ').filter(Boolean)){ flatToks.push(tk); tokToWord.push(wi); } });
const asToks = s => norm(s).split(' ').filter(Boolean);
// fenêtre (ensemble de mots) qui contient le PLUS de mots de `pat` — tolérante aux insertions/omissions
// (l'audio « Écris CE site » vs texte « écris site », « 1000€ » vs « 1000 euros »). Renvoie [i, i+W[.
function bestWindow(pat){ const pset=new Set(pat), W=pat.length+3; let best=-1, bestSc=0;
  for(let i=0;i<flatToks.length;i++){ let sc=0; const seen=new Set();
    for(let j=i;j<Math.min(flatToks.length,i+W);j++){ if(pset.has(flatToks[j])&&!seen.has(flatToks[j])){ sc++; seen.add(flatToks[j]); } }
    if(sc>bestSc){ bestSc=sc; best=i; } }
  return (best>=0 && bestSc>=Math.max(2, Math.ceil(pat.length*0.5))) ? { best, W, pset } : null;
}
const like = (a,b) => a===b || (a.length>=5 && b.startsWith(a.slice(0,5))) || (b.length>=5 && a.startsWith(b.slice(0,5)));  // flou : commente≈commence, écris≈écrit
const alignStart = text => { const head=asToks(text).slice(0, Math.min(6,asToks(text).length)); const r=bestWindow(head); if(!r) return -1;
  const lim=Math.min(flatToks.length, r.best+r.W);
  for(let j=r.best;j<lim;j++){ if(like(flatToks[j],head[0])) return tokToWord[j]; }     // le 1er MOT du texte (flou : commente≈commence), pas un mot commun (« en »)
  for(let j=r.best;j<lim;j++){ if(r.pset.has(flatToks[j])) return tokToWord[j]; } return -1; };  // repli : 1er mot du motif
// alignEnd TOLÉRANT AUX INSERTIONS (l'audio « 1000€ par jour » n'a pas le mot « euros » du texte) :
// on cherche la fenêtre qui contient le plus de mots de la fin du texte, puis le DERNIER mot du motif qui y figure.
const alignEnd = text => { const t=asToks(text); const tail=t.slice(-Math.min(6,t.length));
  const pset=new Set(tail), W=tail.length+3; let best=-1, bestSc=0;
  for(let i=0;i<flatToks.length;i++){ let sc=0; const seen=new Set();
    for(let j=i;j<Math.min(flatToks.length,i+W);j++){ if(pset.has(flatToks[j])&&!seen.has(flatToks[j])){ sc++; seen.add(flatToks[j]); } }
    if(sc>bestSc){ bestSc=sc; best=i; } }
  if(best<0 || bestSc<Math.max(2, Math.ceil(tail.length*0.5))) return -1;
  let last=best; for(let j=best;j<Math.min(flatToks.length,best+W);j++){ if(pset.has(flatToks[j])) last=j; }
  return tokToWord[last]; };

// recule un index jusqu'à la 1re VRAIE pause avant lui ; s'il n'y en a pas dans la fenêtre, on reste sur place
const sentStartBefore = (idx, maxBack=8) => { for(let j=idx-1;j>=Math.max(0,idx-maxBack);j--){ if(gapAfter(j)>0.28) return j+1; } return idx; };

// ── repères AUDIO (calculés AVANT le hook : concept / tuto / CTA peuvent tous borner un hook seul) ──
const conceptIdx = findIdx(CONCEPT_RE, 3, Math.max(6, Math.floor(words.length*0.6)));
const earlyTuto  = findIdx(TUTO_RE, 4, Math.floor(words.length*0.96));   // 1er repère tuto, où qu'il soit

// CTA (repère AUDIO) : 1) opener de close ; 2) sinon ancrage sur le close + remontée à l'impératif.
let ctaIdx = -1;
{ const a=are(CLOSE_OPENER_RE);
  for(let i=Math.floor(words.length*0.4);i<words.length;i++){
    const sStart=(i===0)||gapAfter(i-1)>0.25; if(sStart && a.test(win(i,4))){ ctaIdx=i; break; } } }
if (ctaIdx<0){
  const CTA_CUE=/(sous la video|commente|commande (go|site|le|ia)|marque (go|aide|site|ia|le)|va sur avatarads|teste par toi|mets le mot|lien en bio|je t envoie|je te l envoie|en prive)/i;
  const ca=are(CTA_CUE); let cue=-1;
  for(let i=Math.floor(words.length*0.4);i<words.length;i++){ if(ca.test(win(i,3))) cue=i; }   // dernière occurrence
  if(cue>0){
    const IMP=/^(go|commente|commande|clique|mets|abonne|ecris|envoie|rejoins|teste|profite|recois|recupere|va |vas |tu veux)/i;
    const ia=are(IMP); let st=cue;
    for(let j=cue;j>=Math.max(0,cue-9);j--){ if(ia.test(win(j,2))) st=j; }   // 1er impératif de la fenêtre du close
    ctaIdx=st;                                                                // l'impératif EST le début (pas de recalage)
  }
}
if (ctaIdx<0){ const a=are(CTA_IMP_RE);
  for(let i=Math.floor(words.length*0.5);i<words.length;i++){
    const sStart=(i===0)||gapAfter(i-1)>0.28; if(sStart && a.test(win(i,3))) ctaIdx=i; } } // on garde la DERNIÈRE

// close PRÉCOCE : un impératif de CTA en début de phrase tôt dans l'audio (ex. C14 : « Commente avatar… »
// à 3,8 s) borne aussi le hook — le CTA « de fin » (2ᵉ moitié) le raterait.
let earlyClose = -1;
{ const EC=/^(commente|commande|clique|abonne|ecris|envoie|rejoins|teste par|rends ?toi|va sur (le site|avatarads)|inscris|telecharge)/i;
  const ea=are(EC);
  for(let i=3;i<Math.floor(words.length*0.6);i++){ if(gapAfter(i-1)>0.15 && ea.test(win(i,2))){ earlyClose=i; break; } } }

// début de liaison depuis le texte fourni (sert AUSSI à borner le hook — plus robuste que la fin du texte hook,
// souvent idéalisée : « prête à poster depuis un prompt » ≠ audio « en tapant un prompt »).
const liaStartBrief = (brief && typeof brief.liaison==='string') ? alignStart(brief.liaison) : -1;

// ── HOOK end : (a) début de liaison −1 si connu ; (b) sinon fin du texte hook ; (c) sinon 1re borne audio. ──
let hookEndIdx;
if (liaStartBrief>0) hookEndIdx = liaStartBrief-1;                                  // le hook finit où la liaison commence
else if (brief && brief.hook){ const he=alignEnd(brief.hook); hookEndIdx = he>0 ? he : Math.min(words.length-1,14); }
else { const cands=[conceptIdx, earlyTuto, earlyClose, ctaIdx].filter(x=>x>2);
  hookEndIdx = cands.length ? Math.min(...cands)-1 : Math.min(words.length-1,14); }

// ── LIAISON : du hook au TUTO appli. Bornée par le texte fourni (Axel s'arrête souvent AVANT le tuto),
//    sinon par le repère TUTO audio. wantLiaison : oui sauf si brief la désactive (« liaison:false »). ──
const wantLiaison = brief ? (brief.liaison!==false) : (conceptIdx>0);
let liaStartIdx = liaStartBrief>0 ? liaStartBrief : hookEndIdx+1;
const tutoRaw = findIdx(TUTO_RE, Math.max(liaStartIdx+1, 4), Math.floor(words.length*0.96));
let tutoIdx = tutoRaw>liaStartIdx ? sentStartBefore(tutoRaw) : -1;   // recalé au début de la phrase du tuto
if (tutoIdx>0 && tutoIdx<=liaStartIdx) tutoIdx = tutoRaw;            // sécurité : jamais avant le début de liaison
// fin de liaison : si Axel a fourni le texte, on RESPECTE sa fin (alignEnd) — même si elle contient un
// mot qui ressemble à un début de tuto (« pour faire ça » du C30). Sinon repère TUTO audio.
let liaEndIdx = tutoIdx>liaStartIdx ? tutoIdx-1 : -1;
if (brief && typeof brief.liaison==='string'){ const le=alignEnd(brief.liaison); if (le>liaStartIdx) liaEndIdx=le; }
let liaSeg = null;
if (wantLiaison && liaEndIdx>liaStartIdx){
  const la=tAt(liaStartIdx,'start'), lb=tAt(liaEndIdx,'end');
  if ((lb-la)>=0.6 && (lb-la)<=45) liaSeg={ a:la, b:lb };
}

// bornes finales. CTA : démarre sur le texte fourni s'il s'aligne (ex. C19 « Et si je te disais… », qui
// ne commence PAS par un impératif), sinon sur le repère audio ; fin = dernier mot + marge (anti-clipping).
let hookB=hookEndIdx, liaB=liaSeg, ctaStartB=ctaIdx;
if (brief && typeof brief.cta==='string'){ const cs=alignStart(brief.cta); if(cs>=0) ctaStartB=cs; }
let ctaEndB = fileDur;   // Axel : le CTA va JUSQU'À LA FIN du fichier (ne pas le recouper avant la fin)

// ⚠️ Axel : on ne garde QUE hook / liaison / CTA (le CONTENU tuto appli est jeté) ; `parts` filtre encore.
const segs = [];
if (KEEP.has('hook'))                 segs.push({ id:`H${cartoonN}-audio`,   kind:'hook',    a:HOOK_START,           b:tAt(hookB,'end') });
if (KEEP.has('liaison') && liaB)      segs.push({ id:`L${cartoonN}-audio`,   kind:'liaison', a:liaB.a,               b:liaB.b });
if (KEEP.has('cta') && ctaStartB>0)   segs.push({ id:`CTA${cartoonN}-audio`, kind:'cta',     a:tAt(ctaStartB,'start'), b:ctaEndB });

// découpe ffmpeg + vérification
const manifest = [];
for (const seg of segs){
  if (seg.b - seg.a < 0.4) continue;
  const out = join(outDir, `${seg.id}.wav`);
  const segdur = seg.b - seg.a;
  // highpass léger + fondus courts (le vrai anti-vibration est le calage du début sur la voix)
  execFileSync('ffmpeg', ['-v','error','-y','-ss', seg.a.toFixed(3), '-t', segdur.toFixed(3), '-i', audio,
    '-af', `${MASTER},afade=t=in:st=0:d=0.03,afade=t=out:st=${Math.max(0,segdur-0.06).toFixed(3)}:d=0.06`,
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
// FUSION : on garde les segments existants NON regénérés (ex. CTA manuel réenregistré par Axel, ou une
// brique dont le kind n'est pas dans `parts`) → un re-cut partiel ne perd plus les briques manuelles.
const mfFile = join(outDir, `cartoon-${cartoonN}.manifest.json`);
let prevSegs = [];
if (existsSync(mfFile)) { try { prevSegs = JSON.parse(readFileSync(mfFile,'utf8')).segs || []; } catch(e){} }
const kept = prevSegs.filter(s => !KEEP.has(s.kind));
const allSegs = [...kept, ...manifest].sort((a,b)=>({hook:0,liaison:1,cta:2}[a.kind]??3)-({hook:0,liaison:1,cta:2}[b.kind]??3));
writeFileSync(mfFile, JSON.stringify({ cartoon:+cartoonN, total, fullText, segs:allSegs }, null, 2));
console.log('OK ->', outDir);
