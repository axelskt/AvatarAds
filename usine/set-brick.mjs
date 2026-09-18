#!/usr/bin/env node
// Creative Factory — enregistre une brique MANUELLE (ex. un CTA réenregistré par Axel) dans le manifeste
// d'un cartoon : transcrit le .wav, calcule ses sous-titres (timings relatifs), et remplace/ajoute le
// segment correspondant. Sert quand Axel dépose lui-même un CTA<N>.wav dans le dossier des briques.
// Usage : node usine/set-brick.mjs <manifest.json> <kind hook|liaison|cta> <id ex CTA12-audio> <brique.wav>
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [mfPath, kind, id, wav] = process.argv.slice(2);
if (!mfPath || !kind || !id || !wav) { console.error('usage: set-brick.mjs <manifest.json> <kind> <id> <wav>'); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), 'setb-'));
const dur = parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', wav]).toString().trim());
execFileSync('ffmpeg', ['-v','error','-y','-i', wav, '-vn','-ac','1','-ar','16000', join(work,'a.wav')]);
execFileSync('npx', ['--yes','hyperframes','transcribe', join(work,'a.wav'), '-d', work, '--json','--model','large-v3','--language','fr','--timeout','300000'], { stdio:'inherit' });
const tr = JSON.parse(readFileSync(join(work,'transcript.json'),'utf8'));
let words = (Array.isArray(tr)?tr:(tr.words||[])).map(w=>({t:String(w.text||w.word||'').trim(), s:+w.start, e:+w.end})).filter(w=>w.t&&isFinite(w.s)&&isFinite(w.e));
// correction marque + « commande → Commente » (comme cut-audio)
const bareOf=t=>t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
words=words.map((w,i)=>{ let t=w.t; const b=bareOf(t), nx=words[i+1]?bareOf(words[i+1].t):'';
  if(/atarhat|avatarad|atarad|avatarhat/.test(b)) t=(/fr/.test(b)||/\.?fr\b/i.test(w.t))?'avatarads.fr':'avatarads';
  else if(b==='commande'&&['go','le','site','ia','dm'].includes(nx)) t='Commente';
  return {...w,t}; });
const text = words.map(w=>w.t).join(' ');
const captions = words.map(w=>({ t:w.t, s:+Math.max(0,w.s).toFixed(3), e:+Math.min(dur,w.e).toFixed(3) }));

let meanDb=NaN;
{ const r=spawnSync('ffmpeg',['-hide_banner','-i',wav,'-af','volumedetect','-f','null','-'],{encoding:'utf8'});
  const m=/mean_volume:\s*(-?\d+(\.\d+)?) dB/.exec((r.stderr||'')+(r.stdout||'')); if(m) meanDb=+m[1]; }

const mf = existsSync(mfPath) ? JSON.parse(readFileSync(mfPath,'utf8')) : { cartoon:null, segs:[] };
mf.segs = (mf.segs||[]).filter(s=>s.id!==id);
mf.segs.push({ id, kind, file:wav, dur:+dur.toFixed(2), text, captions, meanDb, audible:meanDb>-45, wordsOk:words.length>=2, ok:true, manual:true });
mf.segs.sort((a,b)=>({hook:0,liaison:1,cta:2}[a.kind]??3)-({hook:0,liaison:1,cta:2}[b.kind]??3));
writeFileSync(mfPath, JSON.stringify(mf,null,2));
console.log(`✓ ${id} (${kind}) → ${text.slice(0,70)}${text.length>70?'…':''}  [${dur.toFixed(1)}s, ${isFinite(meanDb)?meanDb.toFixed(0):'?'}dB]`);
