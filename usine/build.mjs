#!/usr/bin/env node
// Creative Factory — orchestrateur de créa :
//  1) STITCH voix seule : briques trimmées à leur voix, VOIX SÉQUENTIELLES (jamais superposées),
//     raccords en SLIDE (push) — pas de fondu au noir, pas de ghosting.
//  2) SOUS-TITRES : captions-MANIFEST exactes pour les briques audio (hook/CTA) + Whisper pour la démo.
//  3) MUSIQUE (plus longue que la vidéo → coupée à la fin) duckée + BRUITAGES (whoosh+impact) sur chaque raccord.
//  4) FORMAT DE HOOK (Axel 26/09 : « tester différents formats et récolter de la data », usine/formats.js) : tiré à
//     l'assemblage (le moins testé pour ce hook, puis en tout) — sous-titres seuls, phrase choc 0-3 s + gros sous-titres
//     colorés, phrase choc + sous-titres normaux, gros sous-titres colorés seuls. Phrase choc = banque VALIDÉE TH01–TH26,
//     compatible avec la démo, placée en zone sûre TikTok/Reels JAMAIS sur un visage (usine/face-zones.mjs), visible dès la
//     frame 0. Le choix est écrit à côté de la vidéo (<out>.format.json) : usine/publish-qc.mjs le reporte dans
//     factory_qc.brick_combo.format / .texte_choc pour comparer la perf des formats. Variété à tester, pas un multiplicateur.
// Usage : node usine/build.mjs <hook.mp4> <demo.mp4> <out.mp4> [music] [hookVoice] [cta.mp4] [ctaCap] [ctaLead]
//           [--format F01…|auto] [--choc TH01…|auto] [--hook-id H74] [--demo C-OMNI-01|omni] [--tx TX-O02a,TX-O01]
//           [--avant-apres | --no-avant-apres] [--faces faces.json] [--done recettes.json] [--bricks bricks.json] [--seed n]
//   --format : F03 par défaut (Axel 29/09), auto = rotation ; un format RETIRÉ dans Production (factory_bricks kind
//   'format', statut ≠ ready) n'est jamais rendu : demandé → refus, F03 par défaut retiré → rotation parmi les autres.
//   --done = recettes déjà produites (lignes factory_qc ou leurs brick_combo), sinon lues avec SUPABASE_SERVICE_ROLE_KEY
//   (lecture seule) ; --bricks = export factory_bricks.
//   --tx / --avant-apres : déduits du nom d'un hook avant/après (assemblage « HK-O2-0ab » lu dans la bibliothèque, ancien « HK-O02a-01 ») ; --faces : boîtes imposées (sinon détectées).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync, renameSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faceZones } from './face-zones.mjs';

await import(new URL('./coherence.js', import.meta.url).href);   // assemblages HK-<groupe>-<clips> → transformations (txOfHook)
await import(new URL('./formats.js', import.meta.url).href);
const FMT = globalThis.CF_FORMATS;
const VAL_FLAGS = ['--medaillon', '--medaillon-libre', '--voice', '--format', '--choc', '--hook-id', '--demo', '--tx', '--faces', '--done', '--bricks', '--seed', '--liaison', '--broll', '--broll-after', '--hook-broll', '--subs-style', '--choc-style', '--choc-size', '--illus', '--sfx-debut', '--split', '--demo-speed'];
const BOOL_FLAGS = ['--avant-apres', '--no-avant-apres', '--incruste', '--uhd'];
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
// MUSIQUE et SOUS-TITRES au hasard (Axel 30/09 : « bien changer la musique de fond ainsi que les sous-titres… aléatoirement
// à chaque fois ») : musique « auto » = une piste VALIDÉE (jamais M04, trop sombre), --subs-style auto = contour ou boîte ;
// jamais le même choix que la vidéo précédente (fichier <cache>/dernier.json).
const BEDS = join(homedir(), 'Downloads', 'Creative Factory', 'musique', 'beds'), MUSIC_DOUCES = ['M01', 'M02', 'M03', 'M05', 'M06', 'M07', 'M15', 'M16', 'M18', 'M19'],   // Axel 07/10 : « les musiques douces je ne suis pas fan » (même liste que build-f05.mjs)
  MUSIC_OK = Array.from({ length: 25 }, (_, i) => 'M' + String(i + 1).padStart(2, '0')).filter(m => m !== 'M04' && !MUSIC_DOUCES.includes(m));
// 06/10 : S14 (serif italique) retiré du tirage, Axel « pas fan » (VF-0059) ; 21/10 : S05 (pastilles rose / jaune) retiré (VF-0823)
const SUBS_OUT = ['S14', 'S05'];
const SUBS_ALL = Array.from({ length: 19 }, (_, i) => 'S' + String(i + 1).padStart(2, '0')).concat('S21').filter(s => !SUBS_OUT.includes(s));   // la banque + boîte blanche, sans les retirés
const SUBS = { contour: 'S02', boite: 'S21', bleu: 'S03', rouge: 'S07', white: 'S10', neon: 'S12' };
const LASTF = join(process.env.CF_CACHE || join(homedir(), 'Downloads', 'Creative Factory', 'cache'), 'dernier.json');
const lastPick = (() => { try { return JSON.parse(readFileSync(LASTF, 'utf8')); } catch { return {}; } })();
const draw = (list, prev) => { const l = list.filter(x => x !== prev); return (l.length ? l : list)[Math.floor(Math.random() * (l.length || list.length))]; };
// piste longue de beds/ si elle existe, sinon celle de la banque (factory-media/music), téléchargée dans le dossier temporaire
// (serveur : pas de dossier beds). Lève une erreur si la piste est introuvable.
const musicFile = id => {
  const f = (() => { try { return readdirSync(BEDS).find(n => n.startsWith(id + '_')); } catch { return null; } })();
  if (f) return join(BEDS, f);
  const p = join(tmpdir(), 'cf-' + id + '_banque.mp3');
  execFileSync('curl', ['-sfL', '-o', p, 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/music/' + id + '.mp3']);
  return p;
};
const musicAuto = music === 'auto';
// 27/10 : rendus en parallèle (lot) → ils lisaient le même dernier.json et tiraient souvent la même piste (VF-0976/77/78 en M14) :
// les 4 dernières pistes tirées (lastPick.recentes, écrit dès le tirage) sont écartées tant qu'il en reste d'autres
const recentes = Array.isArray(lastPick.recentes) ? lastPick.recentes : [];
const noter = id => { lastPick.musique = id; lastPick.recentes = [id, ...recentes.filter(x => x !== id)].slice(0, 4); };
if (musicAuto) {
  const libres = MUSIC_OK.filter(m => !recentes.includes(m));
  const id = draw(libres.length ? libres : MUSIC_OK, lastPick.musique);
  try { music = musicFile(id); } catch { console.error('✗ musique ' + id + ' introuvable'); process.exit(2); }
  noter(id); console.log('  musique tirée : ' + id);
}
// STYLE DU TEXTE CHOC (Axel 01/10) : 12 styles validés (CS06 néon retiré ; CS16 surligneur rouge, CS17 Snapchat ajoutés), tiré au hasard par défaut (--choc-style CSxx pour forcer), jamais
// le même que la vidéo précédente ; noté dans le sidecar (style_choc) → ID complet de la vidéo (…_THxx_CSxx…) et recette.
// 06/10 : CS13 (machine à écrire) et CS15 (bandeau info) retirés, Axel : « ça fait pas vraiment naturel » (VF-0033 / VF-0034).
// 06/10 (2) : surligneurs CS10 (vert) et CS16 (rouge) retirés aussi, « pas assez naturel » (VF-0049).
const CHOC_STYLES = ['CS01', 'CS02', 'CS03', 'CS05', 'CS07', 'CS08', 'CS11', 'CS17'];
if (OPT['choc-style'] && !CHOC_STYLES.includes(OPT['choc-style'])) { console.error('✗ --choc-style inconnu : ' + OPT['choc-style'] + ' (' + CHOC_STYLES.join(' ') + ')'); process.exit(2); }
const chocStyle = OPT['choc-style'] || draw(CHOC_STYLES, lastPick.style_choc);
if (OPT['subs-style'] === 'auto') { OPT['subs-style'] = draw(SUBS_ALL, lastPick.sous_titre); lastPick.sous_titre = OPT['subs-style']; console.log('  sous-titres tirés : ' + OPT['subs-style']); }
try { mkdirSync(dirname(LASTF), { recursive: true }); writeFileSync(LASTF, JSON.stringify(lastPick)); } catch { /* sans gravité */ }
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
// Axel 23/10 : SPLIT — le hook arrive DÉJÀ habillé par usine/split-hook.py (2 résultats « Hook démo » en haut, avatar en bas).
// --split A:4.08 (d'autres résultats prennent le relais à 4,08 s) ou B:4.08 (l'avatar repasse en plein écran à 4,08 s) :
// ni zoom, ni tremblement, ni phrase choc, ni illustration sur ce hook ; ses sous-titres en boîtes mono à la jonction (880 px),
// puis en bas du plein écran (1250 px) après la bascule de la version B.
const SPLIT = (() => { const m = /^([AB]):(\d+(?:\.\d+)?)$/.exec(String(OPT.split || '')); return m ? { mode: m[1], sw: +m[2] } : null; })();
if (OPT.split && !SPLIT) { console.error('--split attend A:<s> ou B:<s> (ex. B:4.08)'); process.exit(2); }
// Axel 26/10 : TEXTE INCRUSTÉ — hook et CTA arrivent DÉJÀ habillés par usine/incruste.py (sous-titres derrière l'avatar
// détouré, mot fort devant, démos du hook derrière) : ni zoom, ni tremblement, ni phrase choc, ni illustration, et aucun
// sous-titre de l'assembleur sur ces deux briques (la démo garde les siens).
const INCRUSTE = !!OPT.incruste;
let format;
// Statut des formats dans Production : avant le 07/10, seul « auto » le lisait — F03 par défaut ou un format demandé
// était rendu même retiré (formats.test.mjs, cas « tous retirés »). Sans base lisible (ni --bricks ni clé) : tous tirables.
const fmtRows = Array.isArray(bricks) ? bricks : [];
const tirable = id => FMT.eligibleFormats({ bricks: fmtRows }).some(f => f.id === id);
const defRetired = !OPT.format && !tirable('F03');
if (OPT.format === 'auto' || defRetired) {
  if (defRetired) console.warn('⚠ F03 (format par défaut) retiré dans Production → rotation parmi les formats encore actifs');
  format = FMT.pickFormat({ bricks: fmtRows, done, hook: hookId, rand });
  if (!format) { console.error('✗ aucun format tirable (tous retirés ?)'); process.exit(2); }
} else {
  OPT.format = OPT.format || 'F03';
  format = FMT.resolveFormat(OPT.format);
  if (!format || format.id !== OPT.format) { console.error('✗ format « ' + OPT.format + ' » inconnu (' + FMT.FORMATS.map(f => f.id).join(', ') + ')'); process.exit(2); }
  if (!format.renderable) { console.error('✗ format ' + format.id + ' (' + format.label + ') pas encore rendable'); process.exit(2); }
  if (!tirable(format.id)) { console.error('✗ format ' + format.id + ' retiré dans Production (statut ≠ ready) : --format auto ou un autre format'); process.exit(2); }
}
let chocForced = null;
if (FMT.hasChoc(format) && OPT.choc && OPT.choc !== 'auto') {
  chocForced = FMT.textChoc(OPT.choc);
  if (!chocForced) { console.error('✗ texte choc « ' + OPT.choc + ' » absent de la banque validée (TH01–TH34)'); process.exit(2); }
  if (chocForced.retired) { console.error('✗ texte choc ' + OPT.choc + ' supprimé par Axel le ' + chocForced.retired); process.exit(2); }
  const why = FMT.chocWhy(chocForced, demoRef, tx);
  if (why) console.warn('⚠ ' + why + ' → la vidéo partira en revue QC');
}
const facesForced = OPT.faces ? readJson(OPT.faces, '--faces') : undefined;
console.log('▶ format ' + format.id + ' « ' + format.label + ' »' + (hookId ? ' · hook ' + hookId : '') + (tx ? ' · ' + tx.join('+') : ''));
const SFX = join(HERE, '..', 'render-worker', 'assets', 'sfx');
const work = mkdtempSync(join(tmpdir(), 'build-'));
// 60 i/s (Axel 29/09 : les démos sont tournées en 60 i/s, on garde leur fluidité ; hook / CTA Hedra 25 i/s dupliqués)
const FPS = 60;
// 4K NATIVE (Axel 27/10, --uhd ou CF_UHD=1) : tout le montage en 2160×3840 — la démo 4K garde sa vraie finesse (avant : réduite
// en 1080p puis la vidéo finie agrandie), sous-titres dessinés en 4K (captions.mjs, zoom 2). Hook / CTA (prises 1080p) agrandis.
const UHD = !!(OPT.uhd || process.env.CF_UHD === '1'), WW = UHD ? 2160 : 1080, HH = UHD ? 3840 : 1920, KX = UHD ? 2 : 1;
const VF = `scale=${WW}:${HH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${WW}:${HH},fps=${FPS},setsar=1,format=yuv420p`;
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
const VENC = HW ? ['-c:v','h264_videotoolbox','-b:v',UHD ? '45M' : '20M','-maxrate',UHD ? '55M' : '26M','-bufsize',UHD ? '90M' : '40M','-profile:v','high'] : ['-c:v','libx264','-crf','20','-preset','medium'];
const fileKey = f => { const st = statSync(f), fd = openSync(f, 'r'), h = createHash('sha1'), n = Math.min(st.size, 4 << 20), b = Buffer.alloc(n);
  readSync(fd, b, 0, n, 0); h.update(b); readSync(fd, b, 0, n, Math.max(0, st.size - n)); h.update(b); closeSync(fd); h.update(String(st.size)); return h.digest('hex').slice(0, 16); };
const DEMO_SPEED = +(OPT['demo-speed'] || process.env.CF_DEMO_SPEED || 1.05);   // Axel 27/10 : 1,05x (1,08x « un peu trop rapide »)
function workingDemo(src) {
  const pr = execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','csv=p=0', src]).toString().trim().split(',');
  const [w, h] = [+pr[0], +pr[1]], fps = (() => { const [a, b] = String(pr[2] || '30/1').split('/').map(Number); return b ? a / b : a; })();
  // Axel 26/10 : toute démo AVEC son passe en accéléré (1,05x depuis le 27/10, 1,08x avant ; voix à hauteur normale, atempo) ;
  // une démo muette reste à 1x.
  // La vitesse est dans le nom du cache → la démo accélérée est retranscrite (sous-titres calés sur la nouvelle vitesse).
  const sonore = execFileSync('ffprobe', ['-v','error','-select_streams','a','-show_entries','stream=index','-of','csv=p=0', src]).toString().trim() !== '';
  const vit = sonore ? DEMO_SPEED : 1;
  if (vit === 1 && w === WW && h === HH && Math.abs(fps - FPS) < 0.02) return src;
  const out = join(CACHE, 'demos', basename(src).replace(/\.[^.]+$/, '') + '-' + fileKey(src) + '-' + FPS + 'fps' + (UHD ? '-uhd' : '') + (vit === 1 ? '' : '-x' + vit) + '.mp4');
  if (!existsSync(out)) {
    console.log('  démo : version de travail ' + WW + '×' + HH + ' ' + FPS + ' i/s (une seule fois) → ' + basename(out));
    // 19/10 : fichier temporaire PROPRE au processus — un lot rend 3 vidéos à la fois ; deux rendus qui préparaient la même
    // démo neuve (C-EXP-01, 4K) écrivaient le même .part et le second échouait au renommage (ENOENT, VF-0633 perdue)
    const tmp = out + '.' + process.pid + '.part.mp4';
    ff(['-i', src, '-vf', (vit === 1 ? '' : `setpts=PTS/${vit},`) + VF, ...(vit === 1 ? [] : ['-af', `atempo=${vit}`]), ...VENC, '-g', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', tmp]);
    if (existsSync(out)) rmSync(tmp, { force: true }); else renameSync(tmp, out);
  }
  if (vit !== 1) {   // mots déjà vérifiés de la démo à 1x → mêmes mots, temps divisés par la vitesse (pas de nouvelle transcription)
    const W = n => join(CACHE, 'words', n), cible = W(fileKey(out) + '.json'), un = out.replace('-x' + vit + '.mp4', '.mp4');
    const src1 = [W(fileKey(src) + '.json'), W('n-' + basename(un) + '.json'), existsSync(un) ? W(fileKey(un) + '.json') : ''].find(c => c && existsSync(c));
    if (!existsSync(cible) && src1) {
      const ws = JSON.parse(readFileSync(src1, 'utf8')).map(w => ({ ...w, start: +(w.start / vit).toFixed(3), end: +(w.end / vit).toFixed(3) }));
      writeFileSync(cible, JSON.stringify(ws)); console.log('  démo x' + vit + ' : mots repris de la version 1x');
    }
  }
  return out;
}

const TS = 0.25;      // durée du slide de raccord (Axel 30/09 : transition RAPIDE, « boom »)
const TRANS = 'slideleft';
// Traitement AVATAR pour casser le côté « IA figée » : grain + tremblement selfie tenu à la main
// (dérive + micro-tremble, repris de camOrganiqueFilter du render-worker). Appliqué au CTA ET, depuis le 18/10 (Axel :
// « il faut mettre l'effet de tremblement sur chaque vidéo »), au HOOK avatar ; jamais à la démo ni à un hook avant/après
// (médaillon incrusté). 31/10 : --split et --incruste arrivent déjà tremblés (split-hook.py, incruste/tremble.py) : pas de 2e couche ici.
const GRAIN = 'noise=alls=9:allf=t+u,eq=saturation=1.03:contrast=1.02';
// Tremblé main tenue « faible » (validé Axel) : vraies fréquences ~1-3 Hz, A=8px, rotation 0,4°, zoom 1,09.
const SHAKE = "scale=iw*1.09:ih*1.09:flags=lanczos,rotate='(0.4*(sin(5.7*t)+0.4*sin(11.3*t)))*PI/180':c=black,"
  + `crop=${WW}:${HH}:x='(iw-${WW})/2+${8 * KX}*(sin(6.3*t)+0.5*sin(12.9*t+1)+0.3*sin(19.7*t))':`
  + `y='(ih-${HH})/2+${8 * KX}*(cos(7.1*t)+0.5*sin(13.7*t+0.5)+0.25*sin(22.3*t))'`;
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
  let c = join(CACHE, 'words', fileKey(audio) + '.json');   // mots à l'offset 0, puis décalés
  // démo convertie : son nom porte l'empreinte de l'ORIGINAL → mots retrouvés par le nom (serveur : la conversion diffère
  // octet pour octet de celle du Mac, mais pas les mots ni leurs temps)
  const byName = join(CACHE, 'words', 'n-' + basename(audio) + '.json');
  if (!existsSync(c) && existsSync(byName)) c = byName;
  if (!existsSync(c)) execFileSync('node', [join(HERE,'captions.mjs'), 'emit', audio, '0', c], { stdio:'inherit' });
  else console.log('  mots en cache : ' + basename(audio));
  // hallucinations connues de Whisper sur du silence (« Sous-titrage Société Radio-Canada », amara.org) : jamais à l'écran
  const ws = JSON.parse(readFileSync(c, 'utf8')), ghost = /^(sous-?titr\S*|radio-canada\S*|amara\.org\S*)$/i;
  const keep = ws.filter((w, i) => !ghost.test(String(w.text || '').replace(/[.,!?]+$/, '')) && !(/^soci[ée]t[ée]/i.test(String(w.text || '')) && i > 0 && ghost.test(String(ws[i - 1].text || '').replace(/[.,!?]+$/, ''))));
  return keep.map(w => ({ ...w, start: w.start + offset, end: w.end + offset })); };

// ── VOIX (29/09) : même chaîne pour toutes les voix d'avatar (hook, liaison, CTA) → grain plus homogène d'une brique
//    à l'autre (enregistrées à des moments différents) : coupe-bas, léger creux 220 Hz, présence 3,2 kHz, compression douce.
const VCH = 'highpass=f=75,equalizer=f=220:t=q:w=1:g=-1.5,equalizer=f=3200:t=q:w=1.4:g=1.5,acompressor=threshold=-21dB:ratio=3:attack=6:release=90:makeup=1.5,' + LN;
// ── VOIX HOMOGÈNE (Axel 07/10 : « traite tous les audios avec le même traitement ») : avant VCH, chaque brique parlée
//    reçoit SA correction (meta.voice_fix, usine/voice-match.mjs) : égalisation vers le timbre moyen de toutes les briques
//    + hauteur ramenée vers la médiane (±6 %), durée inchangée → synchro labiale des clips déjà générés gardée.
//    Jamais sur une voix générée par Omni (--voice omni) : ce n'est pas la voix d'Axel.
const vfix = id => {
  if (OPT.voice === 'omni' || !id) return '';
  const b = Array.isArray(bricks) ? bricks.find(x => x && x.id === id) : null, f = b && b.meta && b.meta.voice_fix;
  if (!f || typeof f.eq !== 'string' || !/^(entry\(\d+,-?\d+(\.\d+)?\);?)+$/.test(f.eq)) return '';
  const r = Math.max(0.94, Math.min(1.06, Number(f.pitch) || 1));
  return `firequalizer=gain_entry='${f.eq}',` + (Math.abs(r - 1) > 0.002 ? `asetrate=${(48000 * r).toFixed(1)},aresample=48000,atempo=${(1 / r).toFixed(5)},` : '');
};
const bare = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
const IMG_RE = /\.(png|jpe?g|webp)$/i;
let hookWordsPre = null, hookVoiced = false, liaisonAt = null, nHookW = null;
// ── MOTS EXACTS (Axel 29/09 : « ça écrit influences d'IA alors que je dis influenceuse IA ») : chaque brique parlée a son
//    texte validé (factory_bricks.meta.transcript, sinon script / label ; CTA : usine/cta-captions.json relu à la main).
//    Les mots de Whisper gardent leurs TEMPS, mais leur TEXTE vient de ce texte, aligné mot à mot (programmation
//    dynamique) : un mot mal entendu est remplacé, un mot oublié est inséré, un mot en trop reste.
const CTA_TXT = (() => { try { return JSON.parse(readFileSync(join(HERE, 'cta-captions.json'), 'utf8')); } catch { return {}; } })();
const brickOf = id => Array.isArray(bricks) ? bricks.find(b => b && b.id === id) : null;
// CTA : ce qui est DIT (meta.transcript), pas la légende réécrite pour le post (cta-captions.json) ; seules les erreurs
// sûres de Whisper sont corrigées (on demande toujours de COMMENTER un mot-clé ; le mot-clé en capitales ; le site).
const fixCta = t => String(t || '')
  .replace(/\b[Cc]ommand[- ](go|site|guide|plan|ugc|avatar|montage|aide|ia)\b/gi, (m, k) => (m[0] === 'C' ? 'C' : 'c') + 'ommente ' + k.toUpperCase())   // « Command-Go » (VF-0013)
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
  // 06/10 (VF-0048) : les CHIFFRES comptent dans la comparaison (« Donne-moi 30 secondes » perdait son « 30 », remplacé par « moi »)
  const bareN = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  // « 10 000€ » se dit « 10 000 euros » : le symbole devient le mot (sinon « 10 000€ EUROS » à l'écran) ; idem « 3h » →
  // « 3 heures » (VF-0074 : « 3H HEURES »)
  const toks = text.replace(/[«»"“”]/g, ' ').replace(/(\d)\s*€/g, '$1 euros').replace(/(\d)\s*h\b/gi, '$1 heures').split(/\s+/).map(t => t.trim()).filter(t => t && bareN(t));
  // « Command-Go » entendu en UN mot (VF-0013) = « Commente GO » : coupé en deux avant l'alignement
  ws = ws.flatMap(w => { const m = /^command[e]?-([a-z]+)$/i.exec(String(w.text).replace(/[.,!?]/g, '')); if (!m) return [w];
    const mid = w.start + (w.end - w.start) * 0.6; return [{ ...w, text: 'Commente', end: mid }, { ...w, text: m[1].toUpperCase(), start: mid }]; });
  // noms propres que Whisper déforme trop pour être reconnus (VF-0015 : « Xfield » = Higgsfield)
  const HEARD_AS = { xfield: 'higgsfield', hixfield: 'higgsfield', higsfield: 'higgsfield', igsfield: 'higgsfield' };
  const heard = t => { const b = bareN(t), k = Object.keys(HEARD_AS).find(x => b.endsWith(x)); return k ? HEARD_AS[k] : b; };   // « qu'Xfield » aussi
  const A = ws.map(w => heard(w.text)), B = toks.map(bareN), n = A.length, m = B.length;
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
      // 30/09 : TOUS les textes de briques ont été vérifiés à l'écoute (transcription d'avance + corrections d'Axel) → un mot
      // aligné prend TOUJOURS le texte de la brique, même très différent (VF-0016 : « je te DEMANDE ça » entendu, « montre » dit)
      const ok = true;
      out.push(ok ? { ...ws[i - 1], text: toks[j - 1], _x: A[i - 1] === B[j - 1] ? 2 : 1 } : ws[i - 1]); i--; j--; }
    else if (j > 0 && (i === 0 || D[i][j] === D[i][j - 1] + 1)) { out.push({ _ins: toks[j - 1] }); j--; }   // mot du texte jamais entendu : voir plus bas
    else {
      // mot entendu absent du texte : gardé (le texte est parfois faux), SAUF un mot-outil éclair (≤ 3 lettres) =
      // invention de Whisper (VF-0007 : « Si TU t'es e-commerçant », « tu » de 30 ms). Seuil 0,05 → 0,10 s le 06/10 (textes
      // vérifiés à l'écoute) : « depuis LE Claude » (VF-0045, 80 ms), « entre LE l'avant-après » (VF-0041, 60 ms)
      // « ne » absent du texte relu = Whisper qui remet la négation à l'écrit (VF-0076 : « Je NE vais pas » pour « Je vais
      // pas », 110 ms) : jamais affiché, quelle que soit sa durée
      const w = ws[i - 1], b = bareN(w.text); if (!(b.length <= 3 && !/\d/.test(b) && w.end - w.start <= 0.10) && b !== 'ne' && b !== 'n') out.push(w); i--; }   // un nombre n'est jamais un mot-outil
  }
  out.reverse();
  // Mot du texte jamais entendu : en général PAS ajouté (les textes sont parfois faux). Exception : un mot COURT (≤ 4
  // lettres) coincé entre deux mots reconnus à l'identique = élision de Whisper (VF-0010 : « nouvelle ère IA » entendu
  // « nouvelle IA », « ère » fondu dans « nouvelle ») → remis, sur la fin du mot précédent (temps partagé au prorata).
  const res = [];
  out.forEach((w, k) => {
    if (!w._ins) { res.push(w); return; }
    const prev = res[res.length - 1], next = out[k + 1];
    // voisins reconnus (à l'identique = 2, ressemblant = 1), dont au moins un à l'identique : « nouvelle RIA » = « nouvelle ère IA »
    // 06/10 (VF-0048 : « TikTok POUSSE à fond » entendu « TikTok, ça fond ») : textes vérifiés à l'écoute → un mot de toute
    // longueur coincé entre deux mots reconnus est remis (avant : 4 lettres au plus)
    if (bareN(w._ins).length <= 14 && prev && prev._x && next && next._x && prev._x + next._x >= 3) {
      const a = Math.max(1, bareN(prev.text).length), b = Math.max(1, bareN(w._ins).length), cut = prev.start + (prev.end - prev.start) * a / (a + b), end = prev.end;
      prev.end = cut; res.push({ text: w._ins, start: cut, end, _x: 2 });
    }
  });
  const fin = res.map(({ _x, _ins, ...w }) => w);
  // « AvatarAds » entendu en DEUX mots (VF-0042 : « Avatar » + « As ») alors que le texte l'écrit en un : le morceau en trop,
  // collé à la marque, y est fondu (sinon un « AS » seul s'affichait à l'écran)
  for (let k = fin.length - 2; k >= 0; k--)
    if (bare(fin[k].text) === 'avatarads' && /^(as|ads|ad|hads|hats|hat|az|ass)$/.test(bare(fin[k + 1].text)) && fin[k + 1].start - fin[k].end < 0.15) {
      fin[k].end = fin[k + 1].end; fin.splice(k + 1, 1); }
  // un montant s'affiche en UN bloc (Axel 06/10 : « 10 », puis « 000 », puis « € » arrivaient l'un après l'autre) :
  // tranches de milliers recollées (« 10 000 ») et devise collée au nombre (« 10 000€ », « 1000€ »)
  for (let k = fin.length - 2; k >= 0; k--) {
    const a = fin[k], b = fin[k + 1], ta = String(a.text).trim(), tb = String(b.text).trim();
    const join = /^\d{1,3}$/.test(ta) && /^\d{3}\b/.test(tb) ? ta + ' ' + tb
      : /^\d[\d ]*$/.test(ta) && /^(€|euros?)([.,!?…]*)$/i.test(tb) ? ta + '€' + tb.replace(/^(€|euros?)/i, '') : null;
    if (join) { a.text = join; a.end = b.end; fin.splice(k + 1, 1); }
  }
  return fin;
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
  let fc = `[0:v]${VF}[h0];[0:a]${AFMT},${vfix(hookId || idFromFile(hk))}${VCH}[ha0];[1:a]${AFMT},${vfix(idFromFile(li))}${VCH}[la0];[1:v]${VF}[lv0];`, last = 'lv0';
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
  hookWordsPre = hW.concat(lW.map(w => ({ ...w, start: w.start + dH, end: w.end + dH }))); nHookW = hW.length;
}

// durées de brique
const vHook = hookVoice ? Math.min(dur(hookVoice), dur(hook)) : dur(hook);
// ── TIMING (Axel 30/09 : « dès qu'il s'arrête, boom, transition rapide », « l'avatar se fige, pas fluide ») ──
// Le glissement part 0,08 s après le DERNIER MOT (hook ou liaison), dure 0,25 s ; jamais d'avatar figé avant.
const hookW0 = hookWordsPre || (hookVoice ? emitWords(hookVoice, 0) : []);
// Axel 21/10 (VF-0819, A1-11 · H90 coupé sur le rire) : un son qui CONTINUE après le dernier mot (rire, souffle) n'est plus
// coupé par la transition — la fin du hook va jusqu'à ce que l'énergie retombe (fond + 7 dB pendant 0,15 s), 1,2 s au plus
const tailAfter = (f, t0) => { try {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', t0.toFixed(3), '-t', '1.4', '-i', f, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 24 });
  const a = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1), n = 320, e = [];
  for (let i = 0; i + n <= a.length; i += n) { let s2 = 0; for (let k = i; k < i + n; k++) s2 += a[k] * a[k]; e.push(20 * Math.log10(Math.sqrt(s2 / n) + 1e-9)); }
  if (!e.length) return t0;
  const thr = Math.max(40, [...e].sort((x, y) => x - y)[Math.floor(e.length * 0.1)] + 7);
  let quiet = 0; for (let i = 0; i < e.length; i++) { quiet = e[i] < thr ? quiet + 1 : 0; if (quiet >= 8) return t0 + Math.max(0, (i - 7) * 0.02); }
  return Math.min(t0 + 1.2, t0 + e.length * 0.02);
} catch { return t0; } };
const hookLastEnd0 = hookW0.length ? hookW0[hookW0.length - 1].end : vHook;
const hookLastEnd = hookVoice && !liaisonAt ? Math.min(vHook, Math.max(hookLastEnd0, tailAfter(hookVoice, hookLastEnd0))) : hookLastEnd0;
if (hookLastEnd > hookLastEnd0 + 0.1) console.log('  fin du hook prolongée de ' + (hookLastEnd - hookLastEnd0).toFixed(2) + ' s (son après le dernier mot)');
const O1pre = Math.min(dur(hook), hookLastEnd + 0.08);
const durH = O1pre + TS;
const durD = dur(demo);
// fin VISIBLE de la démo (VF-0065, 06/10) : certains exports finissent sur des images NOIRES (C-IMGIA-01 : 2, C-MCP-12 :
// 1,8 s) ; le clone de fin (tpad) figeait alors du noir pendant le glissement vers le CTA. On coupe ce noir, puis on
// prolonge la dernière vraie image.
const demoBlackTail = (() => {
  try {
    const [rate, vdur] = String(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,duration', '-of', 'csv=p=0', demo])).trim().split(',');
    const fr = rate.split('/'), fps = +fr[0] / (+fr[1] || 1) || FPS;
    const r = spawnSync('ffmpeg', ['-v', 'error', '-sseof', '-3', '-i', demo, '-an', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const y = (String(r.stdout).match(/YAVG=[0-9.]+/g) || []).map(s => +s.slice(5));
    if (!y.length) return 0;
    const th = Math.max(...y) > 300 ? 80 : 20;   // noir = 16 en 8 bits, 64 en 10 bits
    let n = 0; while (n < y.length && y[y.length - 1 - n] < th) n++;
    // la piste vidéo peut finir avant la durée du fichier (son plus long) : le noir se compte depuis la fin de la VIDÉO
    return n && n < y.length ? durD - (+vdur || durD) + (n + 0.5) / fps : 0;
  } catch { return 0; }
})();
const durDv = durD - demoBlackTail;
if (demoBlackTail) console.log('  démo : ' + demoBlackTail.toFixed(2) + ' s de noir en fin coupées (dernière vraie image prolongée)');
const END_MARGIN = 0.35;              // marge après le dernier mot du CTA avant de couper (pas de silence mort)
// durée CTA = lead + voix (durée du ctaCap) + marge → coupe le silence de fin du clip avatar
const durC = cta ? (ctaCap ? Math.min(dur(cta), CTA_LEAD + dur(ctaCap) + END_MARGIN) : dur(cta)) : 0;
const O1 = O1pre;                     // démo entre ici (start du slide 1)
// démo → CTA : même règle. Le glissement part 0,08 s après le dernier mot de la démo (jamais sur ses mots, jamais
// d'image figée), le CTA joue dès le glissement (sa voix démarre ~0,1 s dans le clip, en fin de mouvement), le son de
// la démo s'éteint pendant le glissement.
// démo SANS VOIX (C-xxM-…, meta.voice false : texte + CTA déjà incrustés) : rien à transcrire — sur son silence, Whisper
// inventait « Sous-titrage Société… » (07/10, test A3) ; elle passe en entier, sans sous-titres par-dessus.
const demoMuette = (() => { const b = brickOf(OPT.demo); const v = b && b.meta ? b.meta.voice : undefined; return /^C-[A-Z]+M-/.test(String(OPT.demo || '')) || v === false || v === 'false'; })();
const demoLastEnd = demoMuette ? durD : (() => { try { const w = emitWords(demo, 0); return w.length ? w[w.length - 1].end : durD; } catch { return durD; } })();
const L2 = Math.min(durD, Math.max(0.5, demoLastEnd + 0.08));
const O2 = O1 + L2;
const CTA_GAP = 0, CL = 0;
// ── ILLUSTRATION DU HOOK (Axel 30/09) : « --hook-broll fichier|mots » : quand le hook dit ces mots (ex. « comme ça »,
//    « créer »), le résultat arrive par la DROITE en grand, à la place de l'avatar, et repart à GAUCHE à la liaison (ou à la
//    transition vers la démo). Les sous-titres continuent dessous.
if (OPT['hook-broll']) {
  // « fichier|mots d'entrée|mots de sortie » : sans mots de sortie, elle repart à la liaison (ou à la transition)
  const [hf, trig, trigOut] = OPT['hook-broll'].split('|');
  const toksOf = t => String(t || '').split(/\s+/).map(bare).filter(Boolean);
  const findW = (toks, from) => { for (let i = from || 0; i < hookW0.length; i++) if (toks.length && toks.every((t, k) => hookW0[i + k] && bare(hookW0[i + k].text) === t)) return i; return -1; };
  const hw = hookW0, iIn = findW(toksOf(trig));
  let at = iIn >= 0 ? Math.max(0, hw[iIn].start - 0.05) : null;
  let endAt = liaisonAt != null ? liaisonAt : O1;
  if (trigOut && iIn >= 0) { const iOut = findW(toksOf(trigOut), iIn + 1); if (iOut >= 0) endAt = Math.max(at + 0.6, hw[iOut].start + 0.3); }   // la sortie (0,3 s) DÉMARRE sur ces mots
  if (at != null && endAt - at > 0.6) {
    brollEvents.push({ file: hf, at, dur: endAt - at, image: IMG_RE.test(hf), style: 'hook' });
    console.log('  illustration du hook à ' + at.toFixed(2) + ' s → ' + endAt.toFixed(2) + ' s : ' + basename(hf));
  } else console.warn('⚠ illustration du hook ignorée : « ' + trig + ' » introuvable (ou trop tard)');
}

// ── ILLUSTRATIONS AUTOMATIQUES (Axel 30/09 : « selon ce que je dis dans le hook et la liaison, une image / vidéo / static
//    doit arriver, et toujours le même mouvement / animation, avec bruitage ») : --illus auto lit usine/illustrations.json
//    (mots d'entrée / de sortie et type de média par hook et par liaison ; type « demo » = le résultat du module de la
//    démo). --illus "fichier|entrée|sortie;fichier|entrée" = liste à la main. Toutes : grande carte qui entre par la droite
//    et repart par la gauche (style 'hook'), woosh à l'entrée, glissé à la sortie.
const illusLog = [];
if (OPT.illus && !SPLIT && !INCRUSTE) {   // split : les résultats sont déjà en haut de l'écran
  const BANK = readJson(join(HERE, 'illustrations.json'), 'illustrations.json');
  // Axel 15/10 (VF-0489 / VF-0503) : l'illustration du hook doit montrer ce que la démo montre (Omni, static ads, Images IA…)
  if (OPT.illus === 'auto' && hookId && demoBrick && !avantApres) {
    const { illusMismatch } = await import(join(HERE, 'illus-demo.js'));
    const why = illusMismatch(BANK.bricks[hookId], demoBrick);
    if (why) { console.error('✗ ' + hookId + ' + ' + demoBrick.id + ' : ' + why); process.exit(4); } }
  const BR = process.env.CF_BROLL || join(CACHE, 'broll');
  const toksOf = t => String(t || '').split(/\s+/).map(bare).filter(Boolean);
  const findW = (toks, from, to) => { for (let i = from; i < to; i++) if (toks.length && toks.every((t, k) => i + k < to && bare(hookW0[i + k].text) === t)) return i; return -1; };
  const nH = nHookW != null ? nHookW : hookW0.length, liaisonId = OPT.liaison ? idFromFile(OPT.liaison) : null;
  // module de la démo : son SUJET d'abord (static-ads, omni, image-ia) — meta.module vaut « image-ia » pour les démos static ads
  // (elles passent par Images IA) et faisait tirer une pub d'un AUTRE produit (VF-0017 : pub Lune sur une démo parfum)
  let mod = demoBrick ? (demoBrick.subject || (demoBrick.meta && demoBrick.meta.module) || '') : (OPT.demo || '');
  // Axel 20/10 (VF-0754) : un module sans pool (démos Claude « mcp-claude ») prend la famille de ce que la démo MONTRE
  // (Omni, static ads, motion control, Express, Images IA) — sinon un hook « comme ça » restait sans démo
  if (demoBrick && !(BANK.demo || {})[mod]) {
    const { demoFamilies } = await import(join(HERE, 'illus-demo.js')), fam = demoFamilies(demoBrick);
    mod = ['omni', 'static-ads', 'motion-control', 'express', 'image-ia'].find(f => fam.has(f) && (BANK.demo || {})[f]) || mod; }
  const seedN =[...basename(out)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7), used = new Set(brollEvents.map(e => basename(e.file)));
  const usedBrands = new Set(brollEvents.map(e => (/(ciao|svr|parfum|axe|lune|creatine|creme)/.exec(basename(e.file)) || [])[1]).filter(Boolean));
  // média d'un type : jamais deux fois le même dans une vidéo ; rotation d'une vidéo à l'autre (graine = nom de sortie)
  const pick = type => {
    // « avatar » (genre non précisé) = le résultat de la démo si elle génère des avatars, sinon une fille
    if (type === 'avatar') type = mod === 'image-ia' ? 'demo' : 'fille';
    if (type === 'video') type = (BANK.video || {})[mod] || 'produit';
    const direct = (type === 'demo' || (type === 'pub' && mod === 'static-ads')) && BANK.demoMedia && BANK.demoMedia[OPT.demo], t = type === 'demo' ? (BANK.demo || {})[mod] : type;
    // Axel 21/10 (VF-0752 : la montre dans les DEUX paires) : un clip déjà montré dans la vidéo n'est plus repris, même
    // dans une autre paire « avant::après » — chaque moitié d'une paire compte
    const parts = f => String(f).split('::').map(x => basename(x));
    const fresh0 = f => !parts(f).some(x => used.has(x));
    const pool = (direct && direct.filter(fresh0).length ? direct : (BANK.pools || {})[t]) || [];
    let free = pool.filter(fresh0);
    if (!free.length) return null;
    // Axel 06/10 (VF-0044) : « un NOUVEAU produit à chaque mot » → jamais deux fois la même marque dans une vidéo tant
    // qu'il en reste une autre (CIAO, SVR, parfum, AXE, Lune, créatine, crème)
    const brand = f => (/(ciao|svr|parfum|axe|lune|creatine|creme)/.exec(basename(f)) || [])[1] || '';
    const fresh = free.filter(f => !brand(f) || !usedBrands.has(brand(f)));
    if (fresh.length) free = fresh;
    // filles et garçons mélangés : jamais deux avatars du même genre de suite (Axel 30/09)
    const genre = f => /garcon/.test(f) ? 'g' : /fille/.test(f) ? 'f' : '', rot = free.map((_, i) => free[(seedN + used.size + i) % free.length]);
    const ref = rot.find(f => !genre(f) || genre(f) !== pick.last) || rot[0]; parts(ref).forEach(x => used.add(x)); if (genre(ref)) pick.last = genre(ref);
    if (brand(ref)) usedBrands.add(brand(ref));
    // 13/10 : « avant::après » = deux clips montrés en deux cartes (captions.mjs, pair) ; chacun téléchargé à part
    const one = r => { if (!/^https?:/.test(r)) return join(BR, r); const f = join(work, 'illus-' + basename(r));   // média distant : copie de travail
      try { execFileSync('curl', ['-sfL', '-o', f, r]); return f; } catch { return null; } };
    if (ref.includes('::')) { const [a, b] = ref.split('::').map(one); return a && b ? a + '::' + b : null; }
    return one(ref);
  };
  const want = [];   // { file|type, in, out, from, to, endDef }
  if (OPT.illus === 'auto') {
    if (hookId && !avantApres) (BANK.bricks[hookId] || []).forEach(e => want.push({ ...e, from: 0, to: nH, endDef: liaisonAt != null ? liaisonAt : O1, src: hookId }));
    if (liaisonId) (BANK.bricks[liaisonId] || []).forEach(e => want.push({ ...e, from: nH, to: hookW0.length, endDef: O1, src: liaisonId }));
  } else OPT.illus.split(';').map(x => x.trim()).filter(Boolean).forEach(x => { const [file, i, o] = x.split('|'); want.push({ file, in: i, out: o, from: 0, to: hookW0.length, endDef: O1, src: 'manuel' }); });
  let cursor = 0;
  for (const e of want) {
    // « p » (Axel 20/10, H90) : l'illustration n'apparaît qu'une vidéo sur 1/p — tirage stable sur le nom de la sortie
    if (e.p != null && (([...basename(out) + (e.in || '')].reduce((a, c) => (a * 131 + c.charCodeAt(0)) >>> 0, 11) % 1000) / 1000) >= e.p) {
      console.log('  illustration (' + e.src + ') « ' + e.in + ' » non tirée (p = ' + e.p + ')'); continue; }
    const iIn =findW(toksOf(e.in), Math.max(e.from, cursor), e.to);
    if (iIn < 0) { console.warn('⚠ illustration ignorée (' + e.src + ') : « ' + e.in + ' » introuvable'); continue; }
    // l'avatar OUVRE toujours la vidéo (frame 0 = couverture, texte choc lisible) : jamais d'illustration avant 0,8 s
    const at = Math.max(0.8, hookW0[iIn].start - 0.05);
    let endAt = e.endDef;
    if (e.out) { const iOut = findW(toksOf(e.out), iIn + 1, e.to); if (iOut >= 0) endAt = hookW0[iOut].start + 0.3; }   // la sortie DÉMARRE sur ces mots
    endAt = Math.min(endAt, O1);
    let file = e.file || pick(e.type);
    // Axel 19/10 : « deux images, une qui arrive de la gauche, l'autre de la droite, pour arriver centrées » — une illustration
    // du HOOK tirée d'un pool (pub, avatar, fille, garçon, produit, démo…) devient une PAIRE : deux médias du même pool, deux
    // marques différentes (pick écarte la marque déjà prise), affichés comme les avant / après Omni (captions.mjs, pair).
    if (!e.file && file && !file.includes('::') && e.src === hookId) { const f2 = pick(e.type); if (f2 && !f2.includes('::')) file = file + '::' + f2; }
    // durée mini à l'écran (VF-0008 : « comme ça et attirer » ne laissait que 0,9 s à un avant / après) : 1,5 s pour une
    // image, 2,6 s pour une vidéo, dans la limite de la fin du hook / de la liaison
    if (file) endAt = Math.min(O1, Math.max(endAt, at + (IMG_RE.test(file) ? 1.5 : 2.6)));
    if (endAt - at < 0.7) { console.warn('⚠ illustration ignorée (' + e.src + ') : fenêtre trop courte (' + (endAt - at).toFixed(2) + ' s)'); continue; }
    // Axel 21/10 (VF-0625 / VF-0692 : les cartes partaient 0,5 à 1 s avant la fin) : une illustration qui va jusqu'au bout du
    // hook RESTE jusqu'au raccord — sa sortie (0,3 s) se joue PENDANT le glissement vers la démo, plus avant
    if (endAt >= O1 - 0.01) endAt = O1 + 0.3;
    const [file1, pair] = String(file || '').split('::');
    if (!file || !existsSync(file1) || (pair && !existsSync(pair))) { console.warn('⚠ illustration ignorée (' + e.src + ') : aucun média « ' + (e.type || e.file) + ' » (module de la démo : ' + (mod || 'inconnu') + ')'); continue; }
    brollEvents.push({ file: file1, pair: pair || null, at, dur: endAt - at, image: IMG_RE.test(file1), style: 'hook' });
    illusLog.push({ brique: e.src, mots: e.in, sortie: e.out || null, media: basename(file1) + (pair ? ' + ' + basename(pair) : ''), de: +at.toFixed(2), a: +endAt.toFixed(2) });
    cursor = iIn + 1;
  }
  // Axel 21/10 (VF-0752 / VF-0844 « 2-2 ») : deux illustrations dans le HOOK = le temps est partagé ÉQUITABLEMENT entre elles
  // (la seconde arrivait sur son mot et repartait presque aussitôt) — même fenêtre totale, coupée en deux moitiés égales
  { const h2 = brollEvents.filter(e => e.style === 'hook' && e.at < (liaisonAt != null ? liaisonAt : O1)).sort((a, b) => a.at - b.at);
    if (h2.length === 2) { const a0 = h2[0].at, z = Math.max(h2[0].at + h2[0].dur, h2[1].at + h2[1].dur), half = (z - a0) / 2;
      if (half >= 1.0) { h2[0].dur = half + 0.3; h2[1].at = a0 + half; h2[1].dur = z - h2[1].at; console.log('  2-2 équitable : ' + half.toFixed(2) + ' s chacune'); } } }
  // deux illustrations qui se suivent : la première repart quand la suivante arrive (jamais deux grandes cartes empilées)
  const hk = brollEvents.filter(e => e.style === 'hook').sort((a, b) => a.at - b.at);
  hk.forEach((e, i) => { const n = hk[i + 1]; if (n && e.at + e.dur > n.at + 0.3) e.dur = Math.max(0.5, n.at + 0.3 - e.at); });
  illusLog.forEach(l => console.log('  illustration (' + l.brique + ') « ' + l.mots + ' » ' + l.de.toFixed(2) + ' s → ' + l.a.toFixed(2) + ' s : ' + l.media));
  if (!illusLog.length) console.log('  aucune illustration (rien de montrable dans ce hook / cette liaison)');
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
let vf = `[0:v]${VF},tpad=stop_mode=clone:stop_duration=${(GAPH + 1).toFixed(2)},trim=0:${durH.toFixed(3)},setpts=PTS-STARTPTS,${SPLIT || INCRUSTE ? `scale=${WW}:${HH}` : `scale=w='trunc(${WW}*(1+0.07*t/${durH.toFixed(3)})/2)*2':h=-2:eval=frame:flags=bicubic,crop=${WW}:${HH}`},setsar=1${avantApres || SPLIT || INCRUSTE ? '' : ',' + AV_TREAT}[hv];[${iDemo}:v]${VF},trim=0:${durDv.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${Math.max(0.05, L2 + TS - durDv + 0.05).toFixed(3)}[dv];`;
let af = (hookVoice ? `[${iHookA}:a]${AFMT},${hookVoiced ? LN : vfix(hookId || idFromFile(hookVoice)) + VCH}[ha]` : `anullsrc=r=48000:cl=stereo,atrim=0:${vHook.toFixed(3)}[ha]`) + ';';
af += `[${iDemo}:a]${AFMT},${LN}:LRA=11,atrim=0:${(L2 + TS).toFixed(3)},afade=t=out:st=${L2.toFixed(3)}:d=${TS},adelay=${Math.round(O1*1000)}|${Math.round(O1*1000)}[da];`;
if (cta) {
  vf += `[${iCta}:v]trim=0:${durC.toFixed(3)},setpts=PTS-STARTPTS,${VF},${INCRUSTE ? GRAIN : AV_TREAT}[cv];`
      + `[hv][dv]xfade=transition=${TRANS}:duration=${TS}:offset=${O1.toFixed(3)}[vhd];`
      + `[vhd][cv]xfade=transition=${TRANS}:duration=${TS}:offset=${O2.toFixed(3)}[v]`;
  // audio EMBARQUÉ du clip avatar, TRIMMÉ à la voix (pas de silence mort) puis posé à O2
  af += `[${iCta}:a]${AFMT},${vfix(idFromFile(cta))}${VCH},atrim=0:${durC.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round((O2 + CL)*1000)}|${Math.round((O2 + CL)*1000)}[ca];`
      + `[ha][da][ca]amix=inputs=3:duration=longest:normalize=0[a]`;
} else {
  vf += `[hv][dv]xfade=transition=${TRANS}:duration=${TS}:offset=${O1.toFixed(3)}[v]`;
  af += `[ha][da]amix=inputs=2:duration=longest:normalize=0[a]`;
}
ff([...inputs, '-filter_complex', vf + ';' + af, '-map','[v]','-map','[a]',
    ...VENC,'-pix_fmt','yuv420p','-r',String(FPS),'-g',String(FPS),'-c:a','aac','-b:a','192k', voice]);   // -g 30 : images clés serrées (HyperFrames se cale dessus)
const total = dur(voice);
// 06/10 : la piste « auto » est tirée AVANT de connaître la durée de la vidéo, et les pistes de la banque (M09-M20 en local,
// toutes sur le serveur) sont souvent plus courtes → la musique repartait du début avant la fin (VF-0032 : 40,6 s pour 41,5 s ;
// VF-0033 : 21,9 s pour 28,9 s). Une piste tirée trop courte est remplacée par une autre, assez longue.
if (musicAuto && dur(music) < total + 0.5) {
  // dernier.json RELU ici : les rendus voisins du lot ont pu tirer / remplacer leur piste depuis le départ (VF-0984 / 0985 en M23)
  try { const d = JSON.parse(readFileSync(LASTF, 'utf8')); if (Array.isArray(d.recentes)) recentes.splice(0, recentes.length, ...d.recentes.filter(x => x !== lastPick.musique)); } catch { /* sans gravité */ }
  const pool = MUSIC_OK.filter(m => m !== lastPick.musique).sort(() => Math.random() - 0.5).sort((a, b) => recentes.includes(a) - recentes.includes(b));
  for (const id of pool) {
    let f; try { f = musicFile(id); } catch { continue; }
    if (dur(f) < total + 0.5) continue;
    console.log('  musique retirée : ' + id + ' (' + dur(f).toFixed(1) + ' s ; la première était trop courte)');
    music = f; noter(id); try { writeFileSync(LASTF, JSON.stringify(lastPick)); } catch { /* sans gravité */ }
    break;
  }
}
{ const vd = parseFloat(execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=duration','-of','csv=p=0', voice]).toString().trim());
  if (!(vd >= total - 0.3)) { console.error('✗ piste vidéo ' + vd.toFixed(2) + ' s < son ' + total.toFixed(2) + ' s : raccords décalés, rendu arrêté'); process.exit(3); } }

// ── 2) SOUS-TITRES : manifest (hook/CTA) + Whisper (démo) ──
const allWords = [];
const hookW = hookWordsPre || (hookVoice ? exactWords(manifestWords(hookVoice, 0) || emitWords(hookVoice, 0), textOf(hookId || idFromFile(hook))) : []);
// démo : texte relu (meta.transcript de la brique contenu, Axel 02/10 : « cloud » → Claude…) ; jamais le libellé
const demoTxt = ((brickOf(OPT.demo) || {}).meta || {}).transcript || null;
const demoW = demoMuette ? [] : exactWords(emitWords(demo, O1), demoTxt).filter(w => w.start < O2);
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
// Axel 21/10 (« Claude est écrit CLOUD ») : Whisper entend « cloud » / « clode » pour Claude — dans nos vidéos c'est TOUJOURS
// Claude (aucune vidéo ne parle du cloud) : corrigé dans le hook, la démo et le CTA, ponctuation gardée
for (const w of [...hookW, ...demoW, ...ctaW]) w.text = w.text.replace(/^(\W*)(cloud|clouds|clode|claud|clod)(\W*)$/i, (m, a, x, z) => a + (x === x.toUpperCase() ? 'CLAUDE' : 'Claude') + z);
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
    // Axel 20/10 (VF-0752 / VF-0754) : « commente, GUIDE et je te l'envoie » — la virgule après le verbe arrêtait le groupe
    // sur « commente » seul ; le mot-clé qui suit le verbe en fait TOUJOURS partie
    else { a1 = Math.min(st + 1, ctaW.length - 1); while (a1 + 1 < ctaW.length && a1 - st < 6 && !/[.!?,]$/.test(ctaW[a1].text)) a1++; }
  }
  ctaW.slice(a0, a1 + 1).forEach(w => { w.g = 'g3'; });
}
if (SPLIT) {   // 2-3 mots par boîte (≤ 18 lettres), coupure à la ponctuation et à la bascule ; jamais un groupe à cheval
  let k = 0, n = 0, len = 0;
  hookW.forEach((w, i) => {
    const t = String(w.text || '').trim(), prev = hookW[i - 1];
    const cut = i > 0 && (n >= 3 || len + t.length > 18 || /[.!?,;:…]$/.test(String(prev.text || '').trim()) || (prev.start < SPLIT.sw && w.start >= SPLIT.sw));
    if (cut) { k++; n = 0; len = 0; }
    w.g = 'sp' + k; w.sp = SPLIT.mode === 'B' && w.start >= SPLIT.sw ? 1250 : 880; n++; len += t.length + 1;
  });
  // un groupe ne finit jamais sur un petit mot (« C'EST DÉJÀ UNE » | « DINGUERIE ») : il passe au groupe suivant du même côté
  const PETIT = /^(un|une|le|la|les|l|de|des|du|d|à|a|au|aux|et|en|ce|ces|ta|ton|tes|mon|ma|mes|sa|son|ses|ton|tu|je|il|on|pour|par|sur|avec|qui|que)$/;
  for (let i = hookW.length - 2; i >= 0; i--) {
    const w = hookW[i], nx = hookW[i + 1];
    if (w.g !== nx.g && w.sp === nx.sp && hookW.filter(x => x.g === w.g).length >= 2 && PETIT.test(bare(w.text))) w.g = nx.g;
  }
}
allWords.push(...(INCRUSTE ? [] : hookW), ...demoW, ...(INCRUSTE ? [] : ctaW));
const wj = join(work, 'allWords.json'); writeFileSync(wj, JSON.stringify(allWords));
// format : phrase choc (placée hors visage, zone sûre) + style des sous-titres
const capOpts = { uhd: UHD || undefined, subs: format.subs, style: OPT['subs-style'] || 'contour', broll: brollEvents.map(e => ({ file: e.file, pair: e.pair || undefined, at: +e.at.toFixed(3), dur: +e.dur.toFixed(3), image: e.image, style: e.style || 'card' })) };
const sidecar = { incruste: INCRUSTE || undefined, format: format.id, label: format.label, subs: format.subs, texte_choc: null, texte: null, choc_end: 0, hook: hookId,
  demo: demoBrick ? demoBrick.id : (OPT.demo || null), tx, avant_apres: avantApres, faces: null, layout: null };
if (FMT.hasChoc(format) && !SPLIT && !INCRUSTE) {
  const firstIll = brollEvents.filter(e => e.style === 'hook').map(e => e.at).sort((a, b) => a - b)[0];
  // Axel 12/10 : le texte choc reste TOUT le hook (plus coupé à la 1re illustration : elle passe au centre, la phrase est en haut)
  const end = FMT.chocEnd(format, durH, total); void firstIll;
  let fz;
  if (facesForced !== undefined) fz = { faces: Array.isArray(facesForced) ? facesForced : (facesForced && facesForced.faces) || null, frames: 0, error: null, forced: true };
  else fz = faceZones(voice, 0, end, 0.5);
  // bande des sous-titres réservée (VF-0006 : le texte posé au « milieu » touchait les sous-titres) : jamais l'un sur l'autre
  // Axel 11/10 : texte choc TOUJOURS centré (le « haut-gauche » faisait décalé) ; CS11 (Anton condensé) mesuré plus étroit
  // Axel 21/10 (format voix off Motion Control) : --medaillon x,y,w,h = médaillon posé ailleurs (usine/voix-off-mc.py, plus bas) →
  // le texte choc se pose SUR le haut du médaillon (il le touche et le recouvre un peu), au lieu d'être repoussé dessous
  const MED = OPT.medaillon ? String(OPT.medaillon).split(',').map(Number) : null;
  const lay = { maxLines: OPT['medaillon-libre'] ? 2 : null, center: true, em: chocStyle === 'CS11' ? 0.78 : 1, faces: fz.faces, avantApres: avantApres && !MED, sizes: OPT['choc-size'] ? [parseInt(OPT['choc-size'], 10)] : null,
    reserved: (format.subs !== 'aucun' ? [{ x: 0, y: 1310, w: 1080, h: 200, why: 'bande des sous-titres + 60 px de marge' }] : []).concat(MED ? [OPT['medaillon-libre'] ? { x: MED[0] - 20, y: MED[1] - 20, w: MED[2] + 40, h: MED[3] + 40, why: 'fond vert : texte choc AU-DESSUS du petit médaillon (Axel 21/10)' } : { x: 0, y: 0, w: 1080, h: MED[1] + 12, why: 'voix off : le texte se pose SUR le haut du médaillon (Axel 21/10), jamais au-dessus' }] : []) };   // 11/10 (A3, VF-0109) : à 1370 le texte du milieu se collait aux sous-titres
  // tirage : d'abord une phrase qui tient LISIBLE (≥ 54 px, Axel 06/10 : 41-48 px trop petit), sinon n'importe laquelle qui tient
  const fitsOk = q => FMT.chocLayout(FMT.chocString(q), lay).level === 'ok';
  // Axel 19/10 (« aucune vidéo avec les logos en texte choc » sur 80) : un texte À LOGOS (TH27, TH36) est lisible par ses logos
  // de 200 px et plus — TH36 dessine sa phrase à 41 px par construction et le seuil de 54 px l'écartait toujours ; et parmi
  // ~35 textes tirés au hasard, TH27 ne sortait presque jamais. Démo Claude (MCP) : un texte à logos 7 FOIS SUR 10 (Axel 19/10 : « priorise les textes choc logo pour les MCP », puis « y'en a pas assez avec les logos, faut en faire plus » : 2/3 → 70 %).
  const fitsBig = q => { const l = FMT.chocLayout(FMT.chocString(q), lay); return l.level === 'ok' && (l.size >= 54 || !!q.logos); };
  const pickArgs = { demo: demoRef, tx, done, hook: hookId, rand };
  const aLogos = FMT.TEXTES_CHOC.filter(q => q.logos && !q.retired && !FMT.chocWhy(q, demoRef, tx) && fitsOk(q));
  let p = chocForced || (aLogos.length && rand() < 0.7 ? aLogos[Math.floor(rand() * aLogos.length)] : null) || FMT.pickChoc({ ...pickArgs, fits: fitsBig });
  if (!chocForced && p && !fitsBig(p)) p = FMT.pickChoc({ ...pickArgs, fits: fitsOk });
  if (!p) { console.error('✗ aucune phrase choc compatible avec la démo (' + (sidecar.demo || 'démo inconnue') + ')'); process.exit(2); }
  const text = FMT.chocString(p), layout = FMT.chocLayout(text, lay);
  const why = FMT.chocWhy(p, demoRef, tx);
  if (why) layout.reasons = layout.reasons.concat('texte choc : ' + why), layout.level = 'review';
  Object.assign(sidecar, { texte_choc: p.id, texte: text, choc_end: +end.toFixed(3), layout,
    faces: { n: fz.faces ? fz.faces.length : null, frames: fz.frames, error: fz.error || null, boxes: fz.faces, forced: !!fz.forced } });
  capOpts.choc = { text, end, layout, style: chocStyle }; sidecar.style_choc = chocStyle; lastPick.style_choc = chocStyle;
  try { writeFileSync(LASTF, JSON.stringify(lastPick)); } catch { /* sans gravité */ }
  console.log(`  phrase choc ${p.id} style ${chocStyle} (${layout.zone}, ${layout.size} px, ${layout.lines.length} ligne(s)) 0-${end.toFixed(2)} s` + (layout.level !== 'ok' ? ' ⚠ revue : ' + layout.reasons.join(' · ') : ''));
}
sidecar.combo = { format: format.id, ...(sidecar.texte_choc ? { texte_choc: sidecar.texte_choc } : {}) };
if (illusLog.length) sidecar.illustrations = illusLog;
sidecar.musique = music ? (/(M\d+)_/.exec(basename(music)) || [])[1] || basename(music) : null; sidecar.sous_titre = SUBS[OPT['subs-style'] || 'contour'] || (/^S\d{2}$/.test(OPT['subs-style']) ? OPT['subs-style'] : 'S02');
if (INCRUSTE) capOpts.fenetre = { de: +(O1 + TS).toFixed(3), a: +(cta ? O2 : 1e9).toFixed(3) };   // sous-titres de la démo seulement, hors glissements
const oj = join(work, 'capOpts.json'); writeFileSync(oj, JSON.stringify(capOpts));
const capt = join(work, 'capt.mp4');
execFileSync('node', [join(HERE,'captions.mjs'), 'burn', voice, capt, wj, oj], { stdio:'inherit', env: { ...process.env, CF_FPS: String(FPS) } });

// ── 3) MUSIQUE (plus longue que la vidéo → coupée à la fin) duckée + BRUITAGES ──
if (music && dur(music) < total) console.warn(`⚠ musique (${dur(music).toFixed(1)}s) plus courte que la vidéo (${total.toFixed(1)}s) → elle bouclera ; prends une piste plus longue.`);
const B1 = O1 + TS/2, B2 = cta ? (O2 + TS/2) : null;   // milieu des glissements
// Axel 11/10 : « tu choisis toujours les mêmes bruitages » → une famille de sons tirée PAR VIDÉO (graine = nom de sortie +
// hook + démo) : chaque vidéo garde des sons cohérents entre ses raccords, mais deux vidéos ne sonnent plus pareil.
const SFX_POOL = {
  whoosh: ['mo-whoosh-1.mp3', 'whoosh.mp3', 'woosh.mp3', 'mo-swipe-1.mp3', 'mo-swipe-2.mp3', 'ed-swish-1.mp3'],
  impact: ['mo-impact-1.mp3', 'mo-impact-2.mp3', 'mo-impact-3.mp3', 'ed-hit-1.mp3', 'ed-thud-1.mp3', 'ed-thud-2.mp3'],   // 14/10 : hit retiré (Axel)
  pop:    ['mo-pop-1.mp3', 'mo-pop-2.mp3', 'mo-pop-3.mp3', 'ed-pop-1.mp3', 'pop.mp3'],
  group:  ['ed-swish-1.mp3', 'mo-swipe-2.mp3', 'mo-tick-1.mp3', 'mo-tap-1.mp3', 'ed-click-1.mp3'],
  entree: ['woosh.mp3', 'whoosh.mp3', 'mo-whoosh-1.mp3', 'mo-swipe-1.mp3'],
  photo:  ['snap.mp3', 'mo-pop-2.mp3', 'pop.mp3'],   // Axel 14/10 : ni camera-shutter ni camera-click ; click = snap (même fichier)
  // 14/10 (Axel : « on n'entend pas le bruitage du début ») : versions debut-* au niveau maximal (pic 0 dB), jouées à 0 dB.
  // Les MONTÉES (cinematic-impact, metallic-riser, reverse-crash) restent ENTIÈRES : coupées au début de leur coup, elles
  // sonnaient « cassées » (VF-0417, VF-0444) ; les coups secs (woosh, hit, Taco bell…) démarrent sur leur attaque.
  debut:  ['debut-woosh.mp3', 'debut-whoosh.mp3', 'debut-cinematic-impact.mp3', 'debut-metallic-riser.mp3', 'debut-reverse-crash.mp3', 'debut-hit.mp3',
           'debut-tk-taco-bell.mp3', 'debut-tk-vine-boom.mp3', 'debut-tk-tindeck.mp3'],   // mo-pop-1 retiré (pas assez fort) ; kaching → « BOUM » de la démo   // Axel 14/10 : dès la 1re image (tk- = découpés de la vidéo TikTok)
  sortie: ['mo-swipe-1.mp3', 'mo-swipe-2.mp3', 'ed-swish-1.mp3'],
};
const sfxPick = (() => { let h = 2166136261; for (const c of basename(out || '') + '|' + (hookId || '') + '|' + (OPT.demo || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const pick = {}; Object.keys(SFX_POOL).forEach((k, i) => { const L = SFX_POOL[k]; pick[k] = L[(h >>> (i * 3)) % L.length]; h = Math.imul(h ^ (i + 1), 2654435761) >>> 0; }); return pick; })();
console.log('  bruitages : ' + Object.values(sfxPick).join(', '));
const wh = join(SFX, sfxPick.whoosh), imp = join(SFX, sfxPick.impact);
const dly = s => { const ms = Math.max(0, Math.round(s*1000)); return `${ms}|${ms}`; };
const sfxIn=[], sfxFilt=[], sfxLabels=[];
// Axel 14/10 : « pas de bruitage sur les formats no voice » → une vidéo sans AUCUNE voix (hook muet, démo muette, pas de
// CTA parlé) ne reçoit aucun bruitage, seulement la musique (même règle que build-f05.mjs).
const sansVoix = OPT.voice === 'muet' || (!hookVoice && demoMuette && !cta);
if (sansVoix) console.log('  format sans voix : aucun bruitage');
// Axel 14/10 : le son de la 1re image passe CHACUN SON TOUR (pas au hasard) pour qu'aucun ne soit oublié : compteur partagé
// dans le cache (verrou : 3 rendus tournent en parallèle) ; on prend le moins joué, à égalité le suivant du dernier joué —
// un son ajouté au pool part à 0 et passe donc en premier.
if (!sansVoix) {
  const RF = join(CACHE, 'sfx-debut.json'), LK = RF + '.lock', pool = SFX_POOL.debut;
  let held = false; for (let i = 0; i < 200 && !held; i++) { try { mkdirSync(LK); held = true; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); } }
  try {
    let st = { counts: {}, last: null }; try { st = { counts: {}, last: null, ...JSON.parse(readFileSync(RF, 'utf8')) }; } catch { /* premier rendu */ }
    const li = pool.indexOf(st.last), order = pool.map((f, i) => [f, (i - li - 1 + pool.length) % pool.length]);
    const forced = OPT['sfx-debut'] ? OPT['sfx-debut'].replace(/(\.mp3)?$/, '.mp3') : null;   // --sfx-debut tk-vine-boom : imposé (test)
    const pick = forced || order.sort((a, b) => (st.counts[a[0]] || 0) - (st.counts[b[0]] || 0) || a[1] - b[1])[0][0];
    st.counts[pick] = (st.counts[pick] || 0) + 1; st.last = pick; sfxPick.debut = pick;
    writeFileSync(RF + '.tmp', JSON.stringify(st)); renameSync(RF + '.tmp', RF);
    console.log('  1re image (chacun son tour) : ' + pick + ' · joué ' + st.counts[pick] + ' fois');
  } finally { if (held) rmSync(LK, { recursive: true, force: true }); }
}
// Axel 14/10 : les woosh / whoosh à 0 dB, où qu'ils jouent (transition, illustration, 1re image)
// Les sons sont d'abord mis en file (avec leur pool), puis posés par ordre de temps : Axel 14/10 « il ne faut JAMAIS mettre
// le même bruitage à la suite » → un son identique au précédent est remplacé par un autre de son pool.
const sfxQ = [];
const addSfx = (file, at, vol, tag, pool = null) => { if (sansVoix) return; sfxQ.push({ file, at, vol, tag, pool }); };
const flushSfx = () => {
  sfxQ.sort((a, b) => a.at - b.at);
  sfxQ.forEach((e, i) => { const prev = sfxQ[i - 1], next = sfxQ[i + 1];
    if (!prev || basename(prev.file) !== basename(e.file)) return;
    const alt = e.pool && SFX_POOL[e.pool].find(f => f !== basename(e.file) && f !== basename(prev.file) && (!next || f !== basename(next.file)));
    if (alt) { console.log('  bruitage répété évité : ' + basename(e.file) + ' → ' + alt); e.file = join(SFX, alt); } });
  for (const e of sfxQ) { let vol = e.vol;
    if (/(^|\/)(mo-)?w+h?oosh(-\d+)?\.mp3$/.test(e.file)) vol = '0dB'; else if (parseFloat(vol) < -7) vol = '-7dB';   // Axel 14/10 : woosh 0 dB, rien sous −7 dB
    sfxIn.push('-i', e.file); sfxFilt.push(`[SFXIDX]adelay=${dly(e.at)},volume=${vol}[${e.tag}]`); sfxLabels.push(`[${e.tag}]`); } };
addSfx(wh, B1 - 0.20, '-4dB', 'w1', 'whoosh'); addSfx(imp, B1 + 0.06, '-7dB', 'i1', 'impact');
if (cta) { addSfx(wh, B2 - 0.20, '-4dB', 'w2', 'whoosh'); addSfx(imp, B2 + 0.06, '-7dB', 'i2', 'impact'); }
// ── BRUITAGES LIÉS À L'ACTION (Axel 29/09) : jamais un son sans quelque chose à l'écran ──
{ let q = 0; const sx = f => join(SFX, f);
  addSfx(sx(sfxPick.debut), 0, '0dB', 'x' + q++, 'debut');                                                          // Axel 14/10 : un bruitage dès la première image
  // 14/10 (Axel) : plus de pop à l'apparition du texte choc (« ça sert à rien ») ; mo-pop-1 passe dans « dès la 1re image »
  // Axel 14/10 : Kaching à chaque « BOUM » dit dans la démo (« t'appuies sur Générer et boum ») — calé sur le mot
  demoW.filter(w => /^bo+u?m$/.test(bare(w.text))).forEach(w => addSfx(sx('tk-kaching.mp3'), Math.max(0, w.start - 0.02), '-5dB', 'x' + q++));
  // Axel 14/10 : dans le CTA, le MOT-CLÉ dit (SITE, CLAUDE…) → frappe clavier (mac-typing, enregistré bas d'où le gain)
  //   mot-clé = le mot de la liste qui suit (à 2 mots près) le verbe « commente / marque / écris / tape »
  ctaW.forEach((w, i) => { if (!/^(site|claude|go|avatar|guide|plan|ugc|montage|aide|ia)$/.test(bare(w.text))) return;
    if (!ctaW.slice(Math.max(0, i - 2), i).some(v => /^(comment|marque|ecri|tape)/.test(bare(v.text)) && !/^commentaire/.test(bare(v.text)))) return;
    addSfx(sx('mac-typing.mp3'), Math.max(0, w.start - 0.03), '+3dB', 'x' + q++); });
  const gs = {}; allWords.forEach(w => { if (w.g && !(w.g in gs)) gs[w.g] = w.start; });
  Object.values(gs).forEach(t => addSfx(sx(sfxPick.group), Math.max(0, t - 0.1), '-14dB', 'x' + q++, 'group'));       // groupe de sous-titres
  brollEvents.forEach(e => { addSfx(sx(sfxPick.entree), Math.max(0, e.at - 0.15), '-9dB', 'x' + q++, 'entree');            // image qui entre
    if (e.image) addSfx(sx(sfxPick.photo), e.at + 0.02, '-12dB', 'x' + q++, 'photo');
    if (e.style === 'hook') addSfx(sx(sfxPick.sortie), Math.max(0, e.at + e.dur - 0.3), '-16dB', 'x' + q++, 'sortie'); });   // … et qui repart
  // démo : clic / génération / résultat d'après les mots dits (2,5 s d'écart au moins, 5 au plus)
  const RULES = [[/^(clique|cliques|cliquer|clic|selectionne|selectionnes|choisis|appuie|appuies|tape|tapes)$/, 'mouse-click.mp3', '-10dB'],
    [/^(genere|generer|generes|lance|lances|creer|cree|crees)$/, 'magic.mp3', '-14dB'],
    [/^(voila|resultat|incroyable|regarde)$/, 'success.mp3', '-15dB']];
  void RULES;   // 29/09 : désactivés dans la démo (Axel : « bruitage nul ») ; gardés pour un futur calage sur l'image
  if (q) console.log('  bruitages liés à l\'action : ' + q); }
flushSfx();

if (music) {
  const in2 = ['-i', capt, '-stream_loop','-1','-i', music, ...sfxIn];
  let idx = 2; const sf = sfxFilt.map(f => f.replace('[SFXIDX]', `[${idx++}:a]`));
  // musique de fond : −11 dB jusqu'au 06/10, −9 dB depuis (Axel : « un peu plus fort, pas trop »), toujours baissée sous la voix.
  // 14/10 (Axel, VF-0417 : « on n'entend pas assez la musique ») : chaque piste ramenée à la même loudness (−11,5 LUFS mesurés
  // sur 60 s : les pistes vont de −8,7 à −17,9) puis +2 dB → −7 dB au lieu de −9
  const mLufs = (() => { try { const o = spawnSync('ffmpeg', ['-hide_banner', '-t', '60', '-i', music, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const m = o.match(/I:\s+(-?[\d.]+) LUFS/g); return m ? parseFloat(m[m.length - 1].replace(/[^\d.-]/g, '')) : -11.5; } catch { return -11.5; } })();
  const mGain = Math.max(-8, Math.min(8, -11.5 - mLufs)) - 5;   // 14/10 soir (Axel, VF-0417 / 0427 : « pas assez forte ») : −7 → −5 dB
  console.log(`  musique ${mLufs.toFixed(1)} LUFS → ${mGain.toFixed(1)} dB`);
  const filt =
    `[1:a]${AFMT},volume=${mGain.toFixed(1)}dB,afade=t=in:st=0:d=0.6,afade=t=out:st=${(total-0.9).toFixed(3)}:d=0.9[m];`+
    `[m][0:a]sidechaincompress=threshold=0.03:ratio=4:attack=5:release=260[mduck];`+   // 14/10 : baisse sous la voix moins forte (ratio 8 → 4)
    sf.join(';')+`;`+
    `[0:a][mduck]${sfxLabels.join('')}amix=inputs=${2+sfxLabels.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
  ff([...in2, '-filter_complex', filt, '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest', out]);
} else {
  const in2 = ['-i', capt, ...sfxIn];
  let idx = 1; const sf = sfxFilt.map(f => f.replace('[SFXIDX]', `[${idx++}:a]`));
  const filt = sf.join(';')+`;`+`[0:a]${sfxLabels.join('')}amix=inputs=${1+sfxLabels.length}:duration=first:normalize=0,alimiter=limit=0.95[a]`;
  ff([...in2, '-filter_complex', filt, '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-shortest', out]);
}
// CALAGE FINAL à −16 LUFS (VF-0010 sortait à −17,3) : mesure du mix terminé, gain d'appoint si l'écart dépasse 0,5 dB
// (son seul ré-encodé, image copiée) ; le limiteur garde les crêtes sous 0,95.
try {
  const lufsOf = f => { try { const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-map', '0:a', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }); const all = [...String(r.stderr || '').matchAll(/I:\s+(-?[0-9.]+) LUFS/g)]; return all.length ? parseFloat(all[all.length - 1][1]) : null; } catch { return null; } };
  const I = lufsOf(out);
  if (I != null && Math.abs(I + 16) > 0.5 && Math.abs(I + 16) < 8) {
    const g = (-16 - I).toFixed(2), tmp = out.replace(/\.mp4$/, '') + '.lufs.mp4';
    ff(['-i', out, '-map', '0:v', '-map', '0:a', '-c:v', 'copy', '-af', `volume=${g}dB,alimiter=limit=0.95:level=disabled`, '-c:a', 'aac', '-b:a', '192k', tmp]);
    renameSync(tmp, out);
    console.log('  niveau sonore ' + I.toFixed(1) + ' → ' + (lufsOf(out) || 0).toFixed(1) + ' LUFS (gain ' + g + ' dB)');
  } else if (I != null) console.log('  niveau sonore ' + I.toFixed(1) + ' LUFS');
} catch (e) { console.warn('⚠ calage du niveau sonore ignoré : ' + e.message); }
writeFileSync(out + '.format.json', JSON.stringify(sidecar, null, 1));
// mots affichés gardés à côté de la vidéo (relecture), puis dossier de travail supprimé : un rendu 60 i/s laissait ~500 Mo
// de fichiers temporaires, le disque s'est rempli le 30/09 (rendu refusé faute de place)
try { writeFileSync(out + '.words.json', readFileSync(join(work, 'allWords.json'))); rmSync(work, { recursive: true, force: true }); } catch { /* sans gravité */ }
console.log('OK ->', out, '('+dur(out).toFixed(2)+'s)  hook='+durH.toFixed(2)+'s démo='+durD.toFixed(2)+(cta?(' cta='+durC.toFixed(2)+'s'):'')+'  trans='+TRANS
  + '  format='+format.id+(sidecar.texte_choc ? ' choc='+sidecar.texte_choc : '')+'  → '+out+'.format.json (publish-qc.mjs le lit)');
