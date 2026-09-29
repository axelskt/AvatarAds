#!/usr/bin/env node
// Creative Factory — orchestrateur de créa :
//  1) STITCH voix seule : briques trimmées à leur voix, VOIX SÉQUENTIELLES (jamais superposées),
//     raccords en SLIDE (push) — pas de fondu au noir, pas de ghosting.
//  2) SOUS-TITRES : captions-MANIFEST exactes pour les briques audio (hook/CTA) + Whisper pour la démo.
//  3) MUSIQUE (plus longue que la vidéo → coupée à la fin) duckée + BRUITAGES (whoosh+impact) sur chaque raccord.
//  4) FORMAT DE HOOK (Axel 26/09 : « tester différents formats et récolter de la data », usine/formats.js) : tiré à
//     l'assemblage (le moins testé pour ce hook, puis en tout) — sous-titres seuls, phrase choc 0-3 s + gros sous-titres
//     colorés, phrase choc + sous-titres normaux, gros sous-titres colorés seuls. Phrase choc = banque VALIDÉE TH01–TH19,
//     compatible avec la démo, placée en zone sûre TikTok/Reels JAMAIS sur un visage (usine/face-zones.mjs), visible dès la
//     frame 0. Le choix est écrit à côté de la vidéo (<out>.format.json) : usine/publish-qc.mjs le reporte dans
//     factory_qc.brick_combo.format / .texte_choc pour comparer la perf des formats. Variété à tester, pas un multiplicateur.
// Usage : node usine/build.mjs <hook.mp4> <demo.mp4> <out.mp4> [music] [hookVoice] [cta.mp4] [ctaCap] [ctaLead]
//           [--format F01…|auto] [--choc TH01…|auto] [--hook-id H74] [--demo C-OMNI-01|omni] [--tx TX-O02a,TX-O01]
//           [--avant-apres | --no-avant-apres] [--faces faces.json] [--done recettes.json] [--bricks bricks.json] [--seed n]
//   --format : auto (défaut) = rotation ; --done = recettes déjà produites (lignes factory_qc ou leurs brick_combo), sinon
//   lues avec SUPABASE_SERVICE_ROLE_KEY (lecture seule) ; --bricks = export factory_bricks (formats retirés exclus).
//   --tx / --avant-apres : déduits du nom d'un hook avant/après (assemblage « HK-O2-0ab » lu dans la bibliothèque, ancien « HK-O02a-01 ») ; --faces : boîtes imposées (sinon détectées).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync, renameSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faceZones } from './face-zones.mjs';

await import(new URL('./coherence.js', import.meta.url).href);   // assemblages HK-<groupe>-<clips> → transformations (txOfHook)
await import(new URL('./formats.js', import.meta.url).href);
const FMT = globalThis.CF_FORMATS;
const VAL_FLAGS = ['--format', '--choc', '--hook-id', '--demo', '--tx', '--faces', '--done', '--bricks', '--seed', '--liaison', '--broll', '--broll-after', '--hook-broll', '--subs-style'];
const BOOL_FLAGS = ['--avant-apres', '--no-avant-apres'];
const ARGV = process.argv.slice(2), OPT = {}, POS = [];
for (let i = 0; i < ARGV.length; i++) {
  const a = ARGV[i];
  if (VAL_FLAGS.includes(a)) OPT[a.slice(2)] = String(ARGV[++i] ?? '');
  else if (BOOL_FLAGS.includes(a)) OPT[a.slice(2)] = true;
  else if (a.startsWith('--')) { console.error('option inconnue : ' + a); process.exit(2); }
  else POS.push(a);
}

// cta = clip AVATAR (audio embarqué : l'avatar parle). ctaCap = audio d'origine (CTA28-audio.wav) pour les
// captions-manifest. ctaLead = silence de tête baké dans le clip avatar (l'avatar attend puis parle).
let [hook, demoSrc, out, music, hookVoice, cta, ctaCap, ctaLeadArg] = POS;
let demo = demoSrc;
if (!hook || !demoSrc || !out) { console.error('usage: build.mjs <hook> <demo> <out> [music] [hookVoice] [cta] [ctaCap] [ctaLead] [--format …]'); process.exit(1); }
const CTA_LEAD = parseFloat(ctaLeadArg || '0') || 0;
const HERE = dirname(fileURLToPath(import.meta.url));
const SB_URL = 'https://guvwgiejzkiodghywpwj.supabase.co';
const readJson = (f, what) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.error('✗ ' + what + ' illisible : ' + e.message); process.exit(2); } };
async function readTable(path) {   // lecture seule (clé service) ; null si absente ou en échec
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  try { const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); return r.ok ? await r.json() : null; } catch { return null; }
}
// ── 0) FORMAT : choisi AVANT tout rendu (une erreur d'option ne coûte rien) ──
const bricks = OPT.bricks ? readJson(OPT.bricks, '--bricks') : await readTable('factory_bricks?select=id,kind,subject,label,status,meta');
const doneRows = OPT.done ? readJson(OPT.done, '--done') : (await readTable('factory_qc?select=brick_combo')) || [];
const done = (Array.isArray(doneRows) ? doneRows : []).map(r => (r && r.brick_combo && typeof r.brick_combo === 'object') ? r.brick_combo : r).filter(c => c && typeof c === 'object');
const rand = (() => { if (!OPT.seed) return Math.random; let a = (parseInt(OPT.seed, 10) || 1) >>> 0;   // mulberry32
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const hookId = OPT['hook-id'] || ((/^(H\d+[a-z0-9]*?)(?:-audio)?\.[a-z0-9]+$/i.exec(basename(hookVoice || '')) || [])[1]) || null;
const demoBrick = OPT.demo && Array.isArray(bricks) ? bricks.find(b => b && b.id === OPT.demo) || null : null;
const demoRef = demoBrick || OPT.demo || '';   // brique (module = meta.module sinon sujet) ou nom de module ; vide = inconnu
const tx = OPT.tx ? OPT.tx.split(',').map(x => x.trim()).filter(Boolean) : FMT.txOfHook(basename(hook), Array.isArray(bricks) ? bricks : null);
const avantApres = OPT['no-avant-apres'] ? false : OPT['avant-apres'] ? true : FMT.isAvantApres(basename(hook));
let format;
if (OPT.format === 'auto') {
  format = FMT.pickFormat({ bricks: Array.isArray(bricks) ? bricks : [], done, hook: hookId, rand });
  if (!format) { console.error('✗ aucun format tirable (tous retirés ?)'); process.exit(2); }
} else {
  OPT.format = OPT.format || 'F03';
  format = FMT.resolveFormat(OPT.format);
  if (!format || format.id !== OPT.format) { console.error('✗ format « ' + OPT.format + ' » inconnu (' + FMT.FORMATS.map(f => f.id).join(', ') + ')'); process.exit(2); }
  if (!format.renderable) { console.error('✗ format ' + format.id + ' (' + format.label + ') pas encore rendable'); process.exit(2); }
}
let chocForced = null;
if (FMT.hasChoc(format) && OPT.choc && OPT.choc !== 'auto') {
  chocForced = FMT.textChoc(OPT.choc);
  if (!chocForced) { console.error('✗ texte choc « ' + OPT.choc + ' » absent de la banque validée (TH01–TH19)'); process.exit(2); }
  const why = FMT.chocWhy(chocForced, demoRef, tx);
  if (why) console.warn('⚠ ' + why + ' → la vidéo partira en revue QC');
}
const facesForced = OPT.faces ? readJson(OPT.faces, '--faces') : undefined;
console.log('▶ format ' + format.id + ' « ' + format.label + ' »' + (hookId ? ' · hook ' + hookId : '') + (tx ? ' · ' + tx.join('+') : ''));
const SFX = join(HERE, '..', 'render-worker', 'assets', 'sfx');
const work = mkdtempSync(join(tmpdir(), 'build-'));
// 60 i/s (Axel 29/09 : les démos sont tournées en 60 i/s, on garde leur fluidité ; hook / CTA Hedra 25 i/s dupliqués)
const FPS = 60;
const VF = `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=${FPS},setsar=1,format=yuv420p`;
const dur = f => parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', f]).toString().trim());
const ff = args => execFileSync('ffmpeg', ['-v','error','-y', ...args], { stdio:'inherit' });
// ── VITESSE (29/09) : ce qui ne change pas d'une vidéo à l'autre n'est calculé qu'UNE fois ──
//  • démo : version de travail 1080×1920 30 i/s mise en cache (les sources font 190 Mo en 4K 60 i/s : les décoder à
//    chaque montage prenait ~5 min) ;
//  • mots Whisper d'une brique : mis en cache par empreinte du fichier (plus de transcription au 2e montage) ;
//  • encodage : VideoToolbox (matériel du Mac), repli libx264 si indisponible.
const CACHE = process.env.CF_CACHE || join(homedir(), 'Downloads', 'Creative Factory', 'cache');
mkdirSync(join(CACHE, 'demos'), { recursive: true }); mkdirSync(join(CACHE, 'words'), { recursive: true });
let HW = true;
try { execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=black:s=64x64:d=0.1','-c:v','h264_videotoolbox','-f','null','-'], { stdio:'ignore' }); } catch { HW = false; }
const VENC = HW ? ['-c:v','h264_videotoolbox','-b:v','20M','-maxrate','26M','-bufsize','40M','-profile:v','high'] : ['-c:v','libx264','-crf','20','-preset','medium'];
const fileKey = f => { const st = statSync(f), fd = openSync(f, 'r'), h = createHash('sha1'), n = Math.min(st.size, 4 << 20), b = Buffer.alloc(n);
  readSync(fd, b, 0, n, 0); h.update(b); readSync(fd, b, 0, n, Math.max(0, st.size - n)); h.update(b); closeSync(fd); h.update(String(st.size)); return h.digest('hex').slice(0, 16); };
function workingDemo(src) {
  const pr = execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','csv=p=0', src]).toString().trim().split(',');
  const [w, h] = [+pr[0], +pr[1]], fps = (() => { const [a, b] = String(pr[2] || '30/1').split('/').map(Number); return b ? a / b : a; })();
  if (w === 1080 && h === 1920 && Math.abs(fps - FPS) < 0.02) return src;
  const out = join(CACHE, 'demos', basename(src).replace(/\.[^.]+$/, '') + '-' + fileKey(src) + '-' + FPS + 'fps.mp4');
  if (!existsSync(out)) {
    console.log('  démo : version de travail 1080×1920 ' + FPS + ' i/s (une seule fois) → ' + basename(out));
    const tmp = out + '.part.mp4';
    ff(['-i', src, '-vf', VF, ...VENC, '-g', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', tmp]);
    renameSync(tmp, out);
  }
  return out;
}

const TS = 0.25;      // durée du slide de raccord (Axel 30/09 : transition RAPIDE, « boom »)
const TRANS = 'slideleft';
// Traitement AVATAR (CTA) pour casser le côté « IA figée » : grain + tremblement selfie tenu à la main
// (dérive + micro-tremble, repris de camOrganiqueFilter du render-worker). Le hook/la démo = vraie vidéo, pas touchés.
const GRAIN = 'noise=alls=9:allf=t+u,eq=saturation=1.03:contrast=1.02';
// Tremblé main tenue « faible » (validé Axel) : vraies fréquences ~1-3 Hz, A=8px, rotation 0,4°, zoom 1,09.
const SHAKE = "scale=iw*1.09:ih*1.09:flags=lanczos,rotate='(0.4*(sin(5.7*t)+0.4*sin(11.3*t)))*PI/180':c=black,"
  + "crop=1080:1920:x='(iw-1080)/2+8*(sin(6.3*t)+0.5*sin(12.9*t+1)+0.3*sin(19.7*t))':"
  + "y='(ih-1920)/2+8*(cos(7.1*t)+0.5*sin(13.7*t+0.5)+0.25*sin(22.3*t))'";
const AV_TREAT = GRAIN + ',' + SHAKE;
const GAPH = 0.50;    // respiration après la voix du hook (phrase finie AVANT le raccord)
const AFMT = 'aformat=sample_rates=48000:channel_layouts=stereo';
const LN = 'loudnorm=I=-16:TP=-1.5';

demo = workingDemo(demoSrc);

// captions-manifest : une brique connaît ses mots (0 erreur, 0 coût)
function manifestWords(voicePath, offset) {
  try {
    const d = dirname(voicePath), base = basename(voicePath).replace(/\.[^.]+$/,'');
    for (const mf of readdirSync(d).filter(f=>f.endsWith('.manifest.json'))) {
      const m = JSON.parse(readFileSync(join(d, mf), 'utf8'));
      const seg = (m.segs||[]).find(s => s.id===base || (s.file && s.file.endsWith(basename(voicePath))));
      if (seg && Array.isArray(seg.captions)) return seg.captions.map(c => ({ text:c.t, start:c.s+offset, end:c.e+offset }));
    }
  } catch (e) {}
  return null;
}
const emitWords = (audio, offset) => {
  const c = join(CACHE, 'words', fileKey(audio) + '.json');   // mots à l'offset 0, puis décalés
  if (!existsSync(c)) execFileSync('node', [join(HERE,'captions.mjs'), 'emit', audio, '0', c], { stdio:'inherit' });
  else console.log('  mots en cache : ' + basename(audio));
  return JSON.parse(readFileSync(c, 'utf8')).map(w => ({ ...w, start: w.start + offset, end: w.end + offset })); };

// ── VOIX (29/09) : même chaîne pour toutes les voix d'avatar (hook, liaison, CTA) → grain plus homogène d'une brique
//    à l'autre (enregistrées à des moments différents) : coupe-bas, léger creux 220 Hz, présence 3,2 kHz, compression douce.
const VCH = 'highpass=f=75,equalizer=f=220:t=q:w=1:g=-1.5,equalizer=f=3200:t=q:w=1.4:g=1.5,acompressor=threshold=-21dB:ratio=3:attack=6:release=90:makeup=1.5,' + LN;
const bare = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
const IMG_RE = /\.(png|jpe?g|webp)$/i;
let hookWordsPre = null, hookVoiced = false, liaisonAt = null;
// ── MOTS EXACTS (Axel 29/09 : « ça écrit influences d'IA alors que je dis influenceuse IA ») : chaque brique parlée a son
//    texte validé (factory_bricks.meta.transcript, sinon script / label ; CTA : usine/cta-captions.json relu à la main).
//    Les mots de Whisper gardent leurs TEMPS, mais leur TEXTE vient de ce texte, aligné mot à mot (programmation
//    dynamique) : un mot mal entendu est remplacé, un mot oublié est inséré, un mot en trop reste.
const CTA_TXT = (() => { try { return JSON.parse(readFileSync(join(HERE, 'cta-captions.json'), 'utf8')); } catch { return {}; } })();
const brickOf = id => Array.isArray(bricks) ? bricks.find(b => b && b.id === id) : null;
// CTA : ce qui est DIT (meta.transcript), pas la légende réécrite pour le post (cta-captions.json) ; seules les erreurs
// sûres de Whisper sont corrigées (on demande toujours de COMMENTER un mot-clé ; le mot-clé en capitales ; le site).
const fixCta = t => String(t || '')
  .replace(/\b[Cc]ommand(e|es|ez)\b/g, (m) => (m[0] === 'C' ? 'C' : 'c') + 'ommente')
  .replace(/\b(Marque|marque|Écris|écris|Commente|commente|Tape|tape)[- ]cite\b/g, '$1 SITE').replace(/\bcite\b/g, 'SITE')
  .replace(/\bcommente hier\b/gi, m => m.replace(/hier/i, 'IA'))
  .replace(/(ommente|arque|cris|ape)\s+(site|go|avatar|guide|plan|ugc|montage|aide|ia)\b/gi, (m, v, k) => m.slice(0, m.length - k.length) + k.toUpperCase())
  // « Avatar Ads » dit en deux mots reste en deux mots (les sous-titres les fusionnent en AVATARADS) : sinon l'alignement
  // laisse un « Ads » en trop
  .replace(/\bavataradis\.fr\b|\bavatarhads\.fr\b|\bavatar ?h?ads\.fr\b/gi, 'avatarads.fr');
const textOf = id => { if (!id) return null; const b = brickOf(id), m = b && b.meta || {};
  if (/^CTA/.test(id)) return m.transcript ? fixCta(m.transcript) : (CTA_TXT[id] || null);
  const t = m.transcript || m.script || (b && b.label) || null;
  // le nom de la marque mal transcrit (« Avatar Hasse », « Avatar Hats »…) → AvatarAds
  // (en DEUX mots : les sous-titres fusionnent « Avatar » + « Ads » ; un seul mot laisserait un « Ads » en trop)
  return t ? t.replace(/\bavatar[ -]?(hasse|hass|hats|hat|had|hads|haz)\b/gi, 'Avatar Ads') : null; };
const idFromFile = f => { const m = /-(H\d+|L\d+|CTA-[A-Za-z-]+?)(?:-v\d+)?\.(?:mp4|mov)$/i.exec(basename(f || '')); return m ? m[1] : null; };
function exactWords(ws, text) {
  if (!text || !ws.length) return ws;
  const toks = text.replace(/[«»"“”]/g, ' ').split(/\s+/).map(t => t.trim()).filter(t => t && bare(t));
  const A = ws.map(w => bare(w.text)), B = toks.map(bare), n = A.length, m = B.length;
  // ressemblance = 1 − distance d'édition / longueur (« dia »≈« ia », « influences »≈« influenceuses », « montre »≠« demande »)
  const sim = (a, b) => { if (a === b) return 1; const L = Math.max(a.length, b.length); if (!L) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return 1 - prev[b.length] / L; };
  const D = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => i + j));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1.6 - sim(A[i - 1], B[j - 1])));
  const out = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1.6 - sim(A[i - 1], B[j - 1]))) {
      // même mot ou mot RESSEMBLANT → le texte de la brique (orthographe, ponctuation) ; mot très différent → ce qui est DIT
      const ok = A[i - 1] === B[j - 1] || sim(A[i - 1], B[j - 1]) >= 0.6;
      out.push(ok ? { ...ws[i - 1], text: toks[j - 1] } : ws[i - 1]); i--; j--; }
    else if (j > 0 && (i === 0 || D[i][j] === D[i][j - 1] + 1)) { j--; }   // mot du texte jamais entendu : pas ajouté (textes parfois faux)
    else { out.push(ws[i - 1]); i--; }
  }
  return out.reverse();
}
const brollEvents = [];
// ── LIAISON (format long) gérée ici : hook + liaison collés (coupe franche, même photo), voix traitées séparément par
//    la même chaîne ; B-roll (vidéo / image) posé sur la liaison après « regarde ça » (--broll a.mp4,b.png ; déclencheur
//    --broll-after, défaut regarde|voici|voilà) : l'image montre ce que la voix annonce, la voix continue dessous.
if (OPT.liaison) {
  const hk = hook, li = OPT.liaison, dH = dur(hk), dL = dur(li);
  const hW = exactWords(emitWords(hk, 0), textOf(hookId || idFromFile(hk))), lW = exactWords(emitWords(li, 0), textOf(idFromFile(li)));
  const re = new RegExp('^(' + (OPT['broll-after'] || 'regarde|regardez|voici|voila') + ')$');
  const files = OPT.broll ? OPT.broll.split(',').map(x => x.trim()).filter(Boolean) : [];
  let t0 = null;
  for (let i = 0; i < lW.length; i++) if (re.test(bare(lW[i].text))) { const nx = lW[i + 1] && /^(ca|cela)$/.test(bare(lW[i + 1].text)) ? lW[i + 1] : lW[i]; t0 = nx.end + 0.05; break; }
  const ins = ['-i', hk, '-i', li];
  let fc = `[0:v]${VF}[h0];[0:a]${AFMT},${VCH}[ha0];[1:a]${AFMT},${VCH}[la0];[1:v]${VF}[lv0];`, last = 'lv0';
  if (files.length && t0 != null && t0 < dL - 0.6) {
    // Axel 29/09 : l'illustration n'est PAS plein écran : carte arrondie centrée sur le visage (posée par captions.mjs)
    const seg = (dL - t0) / files.length;
    // chaque carte reste jusqu'à la fin de la liaison : la 2e arrive à droite, la 1re se pousse à gauche (Axel 30/09)
    files.forEach((f, k) => brollEvents.push({ file: f, at: dH + t0 + k * seg, dur: (dL - t0) - k * seg, image: IMG_RE.test(f) }));
    console.log('  B-roll (carte) sur la liaison à ' + t0.toFixed(2) + ' s : ' + files.map(f => basename(f)).join(' + '));
  } else if (files.length) console.warn('⚠ B-roll ignoré : « regarde ça » introuvable dans la liaison');
  fc += `[h0][ha0][${last}][la0]concat=n=2:v=1:a=1[v][a]`;
  const hl = join(work, 'hook-liaison.mp4');
  ff([...ins, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', ...VENC, '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-t', (dH + dL).toFixed(3), hl]);
  hook = hl; hookVoice = hl; hookVoiced = true; liaisonAt = dH;
  hookWordsPre = hW.concat(lW.map(w => ({ ...w, start: w.start + dH, end: w.end + dH })));
}

// durées de brique
const vHook = hookVoice ? Math.min(dur(hookVoice), dur(hook)) : dur(hook);
// ── TIMING (Axel 30/09 : « dès qu'il s'arrête, boom, transition rapide », « l'avatar se fige, pas fluide ») ──
// Le glissement part 0,08 s après le DERNIER MOT (hook ou liaison), dure 0,25 s ; jamais d'avatar figé avant.
const hookW0 = hookWordsPre || (hookVoice ? emitWords(hookVoice, 0) : []);
const hookLastEnd = hookW0.length ? hookW0[hookW0.length - 1].end : vHook;
const O1pre = Math.min(dur(hook), hookLastEnd + 0.08);
const durH = O1pre + TS;
const durD = dur(demo);
const END_MARGIN = 0.35;              // marge après le dernier mot du CTA avant de couper (pas de silence mort)
// durée CTA = lead + voix (durée du ctaCap) + marge → coupe le silence de fin du clip avatar
const durC = cta ? (ctaCap ? Math.min(dur(cta), CTA_LEAD + dur(ctaCap) + END_MARGIN) : dur(cta)) : 0;
const O1 = O1pre;                     // démo entre ici (start du slide 1)
// démo → CTA : même règle. Le glissement part 0,08 s après le dernier mot de la démo (jamais sur ses mots, jamais
// d'image figée), le CTA joue dès le glissement (sa voix démarre ~0,1 s dans le clip, en fin de mouvement), le son de
// la démo s'éteint pendant le glissement.
const demoLastEnd = (() => { try { const w = emitWords(demo, 0); return w.length ? w[w.length - 1].end : durD; } catch { return durD; } })();
const L2 = Math.min(durD, Math.max(0.5, demoLastEnd + 0.08));
const O2 = O1 + L2;
const CTA_GAP = 0, CL = 0;
// ── ILLUSTRATION DU HOOK (Axel 30/09) : « --hook-broll fichier|mots » : quand le hook dit ces mots (ex. « comme ça »,
//    « créer »), le résultat arrive par la DROITE en grand, à la place de l'avatar, et repart à GAUCHE à la liaison (ou à la
//    transition vers la démo). Les sous-titres continuent dessous.
if (OPT['hook-broll']) {
  const [hf, trig] = OPT['hook-broll'].split('|');
  const toks = String(trig || '').split(/\s+/).map(bare).filter(Boolean);
  const hw = hookW0, endAt = liaisonAt != null ? liaisonAt : O1;
  let at = null;
  for (let i = 0; i < hw.length && at == null; i++) if (toks.length && toks.every((t, k) => hw[i + k] && bare(hw[i + k].text) === t)) at = Math.max(0, hw[i].start - 0.05);
  if (at != null && endAt - at > 0.6) {
    brollEvents.push({ file: hf, at, dur: endAt - at, image: IMG_RE.test(hf), style: 'hook' });
    console.log('  illustration du hook à ' + at.toFixed(2) + ' s → ' + endAt.toFixed(2) + ' s : ' + basename(hf));
  } else console.warn('⚠ illustration du hook ignorée : « ' + trig + ' » introuvable (ou trop tard)');
}

// ── 1) STITCH : slide vidéo + audio positionné (voix séquentielles) ──
const voice = join(work, 'voice.mp4');
const inputs = ['-i', hook];
let iHookA=null, iDemo, iCta=null, n=1;
if (hookVoice) { inputs.push('-i', hookVoice); iHookA=n++; }
inputs.push('-i', demo); iDemo=n++;
if (cta) { inputs.push('-i', cta); iCta=n++; }

// démo prolongée sur sa dernière image : le glissement vers le CTA se fait APRÈS la fin de la démo, jamais sur ses mots
// hook : léger zoom avant continu (1,00 → 1,07) pour le rendre plus vivant (Axel 29/09)
let vf = `[0:v]${VF},tpad=stop_mode=clone:stop_duration=${(GAPH + 1).toFixed(2)},trim=0:${durH.toFixed(3)},setpts=PTS-STARTPTS,scale=w='trunc(1080*(1+0.07*t/${durH.toFixed(3)})/2)*2':h=-2:eval=frame:flags=bicubic,crop=1080:1920,setsar=1[hv];[${iDemo}:v]${VF},tpad=stop_mode=clone:stop_duration=${Math.max(0.05, L2 + TS - durD + 0.05).toFixed(3)}[dv];`;
let af = (hookVoice ? `[${iHookA}:a]${AFMT},${hookVoiced ? LN : VCH}[ha]` : `anullsrc=r=48000:cl=stereo,atrim=0:${vHook.toFixed(3)}[ha]`) + ';';
af += `[${iDemo}:a]${AFMT},${LN}:LRA=11,atrim=0:${(L2 + TS).toFixed(3)},afade=t=out:st=${L2.toFixed(3)}:d=${TS},adelay=${Math.round(O1*1000)}|${Math.round(O1*1000)}[da];`;
if (cta) {
  vf += `[${iCta}:v]trim=0:${durC.toFixed(3)},setpts=PTS-STARTPTS,${VF},${AV_TREAT}[cv];`
      + `[hv][dv]xfade=transition=${TRANS}:duration=${TS}:offset=${O1.toFixed(3)}[vhd];`
      + `[vhd][cv]xfade=transition=${TRANS}:duration=${TS}:offset=${O2.toFixed(3)}[v]`;
  // audio EMBARQUÉ du clip avatar, TRIMMÉ à la voix (pas de silence mort) puis posé à O2
  af += `[${iCta}:a]${AFMT},${VCH},atrim=0:${durC.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round((O2 + CL)*1000)}|${Math.round((O2 + CL)*1000)}[ca];`
      + `[ha][da][ca]amix=inputs=3:duration=longest:normalize=0[a]`;
} else {
  vf += `[hv][dv]xfade=transition=${TRANS}:duration=${TS}:offset=${O1.toFixed(3)}[v]`;
  af += `[ha][da]amix=inputs=2:duration=longest:normalize=0[a]`;
}
ff([...inputs, '-filter_complex', vf + ';' + af, '-map','[v]','-map','[a]',
    ...VENC,'-pix_fmt','yuv420p','-r',String(FPS),'-g',String(FPS),'-c:a','aac','-b:a','192k', voice]);   // -g 30 : images clés serrées (HyperFrames se cale dessus)
const total = dur(voice);
{ const vd = parseFloat(execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=duration','-of','csv=p=0', voice]).toString().trim());
  if (!(vd >= total - 0.3)) { console.error('✗ piste vidéo ' + vd.toFixed(2) + ' s < son ' + total.toFixed(2) + ' s : raccords décalés, rendu arrêté'); process.exit(3); } }

// ── 2) SOUS-TITRES : manifest (hook/CTA) + Whisper (démo) ──
const allWords = [];
const hookW = hookWordsPre || (hookVoice ? exactWords(manifestWords(hookVoice, 0) || emitWords(hookVoice, 0), textOf(hookId || idFromFile(hook))) : []);
const demoW = emitWords(demo, O1).filter(w => w.start < O2);
const ctaW = cta ? exactWords((ctaCap ? manifestWords(ctaCap, O2 + CL + CTA_LEAD) : null) || emitWords(cta, O2 + CL), textOf(idFromFile(cta))) : [];
// ── GROUPES DE SOUS-TITRES (Axel 29/09) : mot à mot partout SAUF aux moments clés, où la phrase s'affiche en bloc :
//    la dernière phrase avant chaque transition (fin du hook / de la liaison, fin de la démo) et le début du CTA
//    jusqu'au mot « commentaire » (ex. « MARQUE SITE EN COMMENTAIRE »), puis retour au mot à mot.
const ENDP = /[.!?…]$/;
function groupLast(ws, tag) {
  if (ws.length < 2) return;
  let k = ws.length - 1;
  while (k > 0 && ws.length - k < 6 && !ENDP.test(ws[k - 1].text)) k--;
  if (ws.length - k < 2) k = Math.max(0, ws.length - 3);
  ws.slice(k).forEach(w => { w.g = tag; });
}
groupLast(hookW, 'g1'); groupLast(demoW, 'g2');
// Whisper entend « commande » pour « commente » et « cite » pour « SITE » dans les CTA : corrigés (le mot à l'écran doit
// être celui qu'on demande d'écrire)
const KW = /^(site|go|avatar|guide|plan|ugc|montage|aide|ia)$/;
ctaW.forEach((w, i) => { const b = bare(w.text), nx = ctaW[i + 1] ? bare(ctaW[i + 1].text) : '';
  if (/^command(e|es|ez)?$/.test(b) && (KW.test(nx) || nx === 'cite' || nx === 'simplement')) w.text = w.text.replace(/command/i, m => m[0] === 'C' ? 'Comment' : 'comment');
  if (b === 'cite' && i > 0 && /^(commente|comment|marque|ecris|tape|commande)/.test(bare(ctaW[i - 1].text))) w.text = 'SITE' + (/[.,!?]$/.test(w.text) ? w.text.slice(-1) : ''); });
// groupe du CTA = la consigne : du verbe (commente / marque / écris) jusqu'à « commentaire » s'il suit de près, sinon
// verbe + mot-clé (« COMMENTE SITE ») ; sans consigne, les 4 premiers mots
if (ctaW.length > 1) {
  const st = ctaW.findIndex(w => /^(comment|marque|ecri|tape)/.test(bare(w.text)) && !/^commentaire/.test(bare(w.text)));
  let a0 = 0, a1 = Math.min(3, ctaW.length - 1);
  if (st >= 0) {
    a0 = st; a1 = Math.min(st + 1, ctaW.length - 1);
    const c = ctaW.findIndex((w, i) => i > st && i <= st + 5 && /^commentaire/.test(bare(w.text)));
    if (c > 0) a1 = c;
    else { a1 = st; while (a1 + 1 < ctaW.length && a1 - st < 6 && !/[.!?,]$/.test(ctaW[a1].text)) a1++; }
  }
  ctaW.slice(a0, a1 + 1).forEach(w => { w.g = 'g3'; });
}
allWords.push(...hookW, ...demoW, ...ctaW);
const wj = join(work, 'allWords.json'); writeFileSync(wj, JSON.stringify(allWords));
// format : phrase choc (placée hors visage, zone sûre) + style des sous-titres
const capOpts = { subs: format.subs, style: OPT['subs-style'] || 'contour', broll: brollEvents.map(e => ({ file: e.file, at: +e.at.toFixed(3), dur: +e.dur.toFixed(3), image: e.image, style: e.style || 'card' })) };
const sidecar = { format: format.id, label: format.label, subs: format.subs, texte_choc: null, texte: null, choc_end: 0, hook: hookId,
  demo: demoBrick ? demoBrick.id : (OPT.demo || null), tx, avant_apres: avantApres, faces: null, layout: null };
if (FMT.hasChoc(format)) {
  const end = FMT.chocEnd(format, durH, total);
  let fz;
  if (facesForced !== undefined) fz = { faces: Array.isArray(facesForced) ? facesForced : (facesForced && facesForced.faces) || null, frames: 0, error: null, forced: true };
  else fz = faceZones(voice, 0, end, 0.5);
  const lay = { faces: fz.faces, avantApres };
  const p = chocForced || FMT.pickChoc({ demo: demoRef, tx, done, hook: hookId, rand, fits: q => FMT.chocLayout(FMT.chocString(q), lay).level === 'ok' });
  if (!p) { console.error('✗ aucune phrase choc compatible avec la démo (' + (sidecar.demo || 'démo inconnue') + ')'); process.exit(2); }
  const text = FMT.chocString(p), layout = FMT.chocLayout(text, lay);
  const why = FMT.chocWhy(p, demoRef, tx);
  if (why) layout.reasons = layout.reasons.concat('texte choc : ' + why), layout.level = 'review';
  Object.assign(sidecar, { texte_choc: p.id, texte: text, choc_end: +end.toFixed(3), layout,
    faces: { n: fz.faces ? fz.faces.length : null, frames: fz.frames, error: fz.error || null, boxes: fz.faces, forced: !!fz.forced } });
  capOpts.choc = { text, end, layout };
  console.log(`  phrase choc ${p.id} (${layout.zone}, ${layout.size} px, ${layout.lines.length} ligne(s)) 0-${end.toFixed(2)} s` + (layout.level !== 'ok' ? ' ⚠ revue : ' + layout.reasons.join(' · ') : ''));
}
sidecar.combo = { format: format.id, ...(sidecar.texte_choc ? { texte_choc: sidecar.texte_choc } : {}) };
const oj = join(work, 'capOpts.json'); writeFileSync(oj, JSON.stringify(capOpts));
const capt = join(work, 'capt.mp4');
execFileSync('node', [join(HERE,'captions.mjs'), 'burn', voice, capt, wj, oj], { stdio:'inherit', env: { ...process.env, CF_FPS: String(FPS) } });

// ── 3) MUSIQUE (plus longue que la vidéo → coupée à la fin) duckée + BRUITAGES ──
if (music && dur(music) < total) console.warn(`⚠ musique (${dur(music).toFixed(1)}s) plus courte que la vidéo (${total.toFixed(1)}s) → elle bouclera ; prends une piste plus longue.`);
const B1 = O1 + TS/2, B2 = cta ? (O2 + TS/2) : null;   // milieu des glissements
const wh = join(SFX,'mo-whoosh-1.mp3'), imp = join(SFX,'mo-impact-2.mp3');
const dly = s => { const ms = Math.max(0, Math.round(s*1000)); return `${ms}|${ms}`; };
const sfxIn=[], sfxFilt=[], sfxLabels=[];
const addSfx = (file, at, vol, tag) => { sfxIn.push('-i', file); sfxFilt.push(`[SFXIDX]adelay=${dly(at)},volume=${vol}[${tag}]`); sfxLabels.push(`[${tag}]`); };
addSfx(wh, B1 - 0.20, '-4dB', 'w1'); addSfx(imp, B1 + 0.06, '-7dB', 'i1');
if (cta) { addSfx(wh, B2 - 0.20, '-4dB', 'w2'); addSfx(imp, B2 + 0.06, '-7dB', 'i2'); }
// ── BRUITAGES LIÉS À L'ACTION (Axel 29/09) : jamais un son sans quelque chose à l'écran ──
{ let q = 0; const sx = f => join(SFX, f);
  if (sidecar.texte_choc) addSfx(sx('mo-pop-1.mp3'), 0.02, '-12dB', 'x' + q++);                              // texte du hook qui apparaît
  const gs = {}; allWords.forEach(w => { if (w.g && !(w.g in gs)) gs[w.g] = w.start; });
  Object.values(gs).forEach(t => addSfx(sx('ed-swish-1.mp3'), Math.max(0, t - 0.1), '-14dB', 'x' + q++));       // groupe de sous-titres
  brollEvents.forEach(e => { addSfx(sx('woosh.mp3'), Math.max(0, e.at - 0.15), '-9dB', 'x' + q++);            // image qui entre
    if (e.image) addSfx(sx('camera-shutter.mp3'), e.at + 0.02, '-12dB', 'x' + q++); });
  // démo : clic / génération / résultat d'après les mots dits (2,5 s d'écart au moins, 5 au plus)
  const RULES = [[/^(clique|cliques|cliquer|clic|selectionne|selectionnes|choisis|appuie|appuies|tape|tapes)$/, 'mouse-click.mp3', '-10dB'],
    [/^(genere|generer|generes|lance|lances|creer|cree|crees)$/, 'magic.mp3', '-14dB'],
    [/^(voila|resultat|incroyable|regarde)$/, 'success.mp3', '-15dB']];
  void RULES;   // 29/09 : désactivés dans la démo (Axel : « bruitage nul ») ; gardés pour un futur calage sur l'image
  if (q) console.log('  bruitages liés à l\'action : ' + q); }

if (music) {
  const in2 = ['-i', capt, '-stream_loop','-1','-i', music, ...sfxIn];
  let idx = 2; const sf = sfxFilt.map(f => f.replace('[SFXIDX]', `[${idx++}:a]`));
  const filt =
    `[1:a]${AFMT},volume=-11dB,afade=t=in:st=0:d=0.6,afade=t=out:st=${(total-0.9).toFixed(3)}:d=0.9[m];`+
    `[m][0:a]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=260[mduck];`+
    sf.join(';')+`;`+
    `[0:a][mduck]${sfxLabels.join('')}amix=inputs=${2+sfxLabels.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
  ff([...in2, '-filter_complex', filt, '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest', out]);
} else {
  const in2 = ['-i', capt, ...sfxIn];
  let idx = 1; const sf = sfxFilt.map(f => f.replace('[SFXIDX]', `[${idx++}:a]`));
  const filt = sf.join(';')+`;`+`[0:a]${sfxLabels.join('')}amix=inputs=${1+sfxLabels.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
  ff([...in2, '-filter_complex', filt, '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest', out]);
}
writeFileSync(out + '.format.json', JSON.stringify(sidecar, null, 1));
// mots affichés gardés à côté de la vidéo (relecture), puis dossier de travail supprimé : un rendu 60 i/s laissait ~500 Mo
// de fichiers temporaires, le disque s'est rempli le 30/09 (rendu refusé faute de place)
try { writeFileSync(out + '.words.json', readFileSync(join(work, 'allWords.json'))); rmSync(work, { recursive: true, force: true }); } catch { /* sans gravité */ }
console.log('OK ->', out, '('+dur(out).toFixed(2)+'s)  hook='+durH.toFixed(2)+'s démo='+durD.toFixed(2)+(cta?(' cta='+durC.toFixed(2)+'s'):'')+'  trans='+TRANS
  + '  format='+format.id+(sidecar.texte_choc ? ' choc='+sidecar.texte_choc : '')+'  → '+out+'.format.json (publish-qc.mjs le lit)');
