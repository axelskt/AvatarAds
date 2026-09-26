#!/usr/bin/env node
// Assemblages AVANT / APRÈS (hooks visuels HK-…, factory_recipes kind 'hook') rendus en LOCAL avec ffmpeg (gratuit).
// Les suites valides viennent de usine/coherence.js (assemblies : 2 ou 3 clips DISTINCTS d'un même groupe de
// transformations, jamais deux groupes mélangés). Recette visuelle = celle des HK du 18/09 (composition HyperFrames
// scratchpad/omni-hook-1, reproduite ici à l'identique) :
//   · 1080×1920, 30 i/s, 2,8 s par clip (84 images), muet, H.264 High yuv420p BT.709 ;
//   · plein écran = le clip en cours, object-fit cover, zoom 1,05 → 1 en 0,8 s (power2.out = cubique) à chaque clip ;
//   · médaillon 9:16 haut-droite PRÉSENT DÈS LA FRAME 0 : 446×793 à (591, 93), bord 3 px blanc 92 % (rayon 28 px),
//     ombre 0 26px 66px -18px noir 72 % ; il montre l'autre côté de l'avant / après : le clip SUIVANT pendant le 1er clip,
//     puis le clip PRÉCÉDENT (clip 2 : le 1er ; clip 3 : le 2e) ;
//   · flash blanc entre deux clips : opacité 0 → 0,72 de t−0,08 à t+0,04 (power1.in), puis → 0 jusqu'à t+0,26 (power1.out) ;
//   · chaque clip démarre à son point d'entrée du 18/09 (TRIM ci-dessous, ou meta.before.start / meta.after.start).
// Sources = originaux locaux (meta.before.file / meta.after.file : OMNI/… sous ~/Downloads, MC/… = « Vidéo et Motion
// Control/Motion Control/Vidéo qui vont ensemble ») ; --storage = les copies 720p du stockage public (meta.*.media).
// Un original HDR HLG (iPhone, BT.2020) est lu comme les autres en BT.709 SDR, sans compression de dynamique (même rendu
// que la version Omni générée à partir de lui).
//
// Usage : node usine/assemble-hk.mjs --bricks <factory_bricks.json> --out <dossier> [--src <racine>] [--only HK-O2-0a,…]
//         [--storage] [--jobs 2] [--dry] [--check] [--fresh] [--sql recettes.sql] [--tsv upload.tsv]
// Sortie : <out>/<id>.mp4 + <out>/assemblages.json (id, libellé, groupe, composants, clips, durée).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

await import(new URL('./coherence.js', import.meta.url).href);
const C = globalThis.CF_COHERENCE;

const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2), v = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  opt[k] = v;
}
if (!opt.bricks || !opt.out) { console.error('usage : node usine/assemble-hk.mjs --bricks <factory_bricks.json> --out <dossier> [--src <racine>] [--only id,…] [--storage] [--jobs 2] [--dry] [--check] [--fresh] [--sql f.sql] [--tsv f.tsv]'); process.exit(2); }

const FPS = 30, CLIP_S = 2.8, CLIP_F = 84, W = 1080, H = 1920;
const INSET = { x: 591, y: 93, w: 446, h: 793, r: 25 }, BOX = { x: 588, y: 90, w: 452, h: 799, r: 28, border: 3, color: 236 };
const SHADOW = { dy: 26, blur: 66, spread: -18, alpha: 0.72 };
const ZOOM = { from: 1.05, frames: 24 };                    // 0,8 s à 30 i/s
const FLASH = { peak: 0.72, before: 0.08, rise: 0.12, fall: 0.22 };
// Points d'entrée (s) des clips, repris du rendu du 18/09 (composition omni-hook-1) — même début pour l'avant et l'après.
const TRIM = { 'TX-O01': 0, 'TX-O02a': 2, 'TX-O02b': 2, 'TX-O03': 2.3, 'TX-M01': 1, 'TX-M02': 1, 'TX-M04': 0.3 };
const SRC = resolve(String(opt.src || join(homedir(), 'Downloads')));
const MC_DIR = 'Vidéo et Motion Control/Motion Control/Vidéo qui vont ensemble';
const OUT = resolve(String(opt.out)), TMP = join(OUT, '.hk-work');
mkdirSync(TMP, { recursive: true });

const bricks = JSON.parse(readFileSync(String(opt.bricks), 'utf8'));
const byId = Object.fromEntries(bricks.map(b => [b.id, b]));
let list = C.assemblies(bricks);
if (opt.only) { const only = String(opt.only).split(','); list = list.filter(a => only.includes(a.id)); }
if (!list.length) { console.error('aucun assemblage à rendre'); process.exit(1); }

// ── sources ──
function localPath(file) {
  const f = String(file || '');
  if (f.startsWith('MC/')) return join(SRC, MC_DIR, f.slice(3));
  return join(SRC, f);
}
async function sourceOf(clip) {
  const m = (byId[clip.brick_id] && byId[clip.brick_id].meta && byId[clip.brick_id].meta[clip.clip]) || {};
  const start = typeof m.start === 'number' ? m.start : (TRIM[clip.brick_id] ?? 0);
  if (!opt.storage) {
    const p = localPath(m.file);
    if (!m.file || !existsSync(p)) throw new Error(clip.brick_id + ' ' + clip.clip + ' : original introuvable (' + p + ') — --src ou --storage');
    return { path: p, start };
  }
  const url = String(m.media || '');
  if (!/^https:\/\//.test(url)) throw new Error(clip.brick_id + ' ' + clip.clip + ' : pas de média public');
  const p = join(TMP, url.split('/').pop());
  if (!existsSync(p)) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' : HTTP ' + r.status); await pipeline(Readable.fromWeb(r.body), createWriteStream(p)); }
  return { path: p, start };
}
const probeCache = {};
function colorOf(p) {
  if (probeCache[p]) return probeCache[p];
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_transfer,color_primaries', '-of', 'json', p], { encoding: 'utf8' });
  const s = (JSON.parse(r.stdout || '{}').streams || [{}])[0] || {};
  const bt2020 = /bt2020/.test(s.color_space || '') || /bt2020/.test(s.color_primaries || '') || /arib-std-b67|smpte2084/.test(s.color_transfer || '');
  return (probeCache[p] = { matrix: bt2020 ? 'bt2020' : 'bt709', hdr: /arib-std-b67|smpte2084/.test(s.color_transfer || '') });
}

// ── calques fixes (générés une fois) : ombre, masque arrondi du médaillon, bord ──
const n2 = x => Number(x.toFixed(3));
function cov(cx, cy, hw, hh, r) {   // couverture anti-crénelée d'un rectangle arrondi (distance signée au centre du pixel)
  const qx = `(abs(X+0.5-${n2(cx)})-${n2(hw - r)})`, qy = `(abs(Y+0.5-${n2(cy)})-${n2(hh - r)})`;
  return `clip(0.5-(hypot(max(${qx},0),max(${qy},0))+min(max(${qx},${qy}),0)-${r}),0,1)`;
}
function ff(argv, label) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error((label || 'ffmpeg') + ' : ' + (r.stderr || '').slice(-1500));
}
function layers() {
  const dir = join(TMP, 'layers'); mkdirSync(dir, { recursive: true });
  const L = { shadow: join(dir, 'shadow.png'), mask: join(dir, 'mask.png'), border: join(dir, 'border.png') };
  if (!opt.fresh && Object.values(L).every(f => existsSync(f))) return L;   // déjà générés (--fresh pour les refaire)
  const s = SHADOW, sx = BOX.x - s.spread, sy = BOX.y + s.dy - s.spread, sw = BOX.w + 2 * s.spread, sh = BOX.h + 2 * s.spread, sr = Math.max(0, BOX.r + s.spread);
  const boxCov = cov(BOX.x + BOX.w / 2, BOX.y + BOX.h / 2, BOX.w / 2, BOX.h / 2, BOX.r);
  // ombre CSS : flou gaussien σ = blur / 2, peinte seulement hors de la boîte
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1,format=gray`, '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1,format=gray`,
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=1,format=rgba`, '-filter_complex',
    `[0:v]geq=lum='255*${cov(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, sr)}',gblur=sigma=${s.blur / 2}:steps=6[b];` +
    `[1:v]geq=lum='255*(1-${boxCov})'[hole];[b][hole]blend=all_expr='A*B/255*${s.alpha}'[a];[2:v][a]alphamerge,format=rgba`,
    '-frames:v', '1', L.shadow], 'ombre');
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${INSET.w}x${INSET.h}:d=1,format=gray`, '-vf',
    `geq=lum='255*${cov(INSET.w / 2, INSET.h / 2, INSET.w / 2, INSET.h / 2, INSET.r)}'`, '-frames:v', '1', L.mask], 'masque');
  const c = BOX.color, b = BOX.border;
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${BOX.w}x${BOX.h}:d=1,format=rgba`, '-vf',
    `geq=r='${c}':g='${c}':b='${c}':a='255*clip(${cov(BOX.w / 2, BOX.h / 2, BOX.w / 2, BOX.h / 2, BOX.r)}-${cov(BOX.w / 2, BOX.h / 2, BOX.w / 2 - b, BOX.h / 2 - b, BOX.r - b)},0,1)'`,
    '-frames:v', '1', L.border], 'bord');
  return L;
}

// ── graphe ffmpeg d'un assemblage ──
function norm(i, src, w, h) {
  const c = colorOf(src.path);
  return `[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos:` +
    `in_color_matrix=${c.matrix}:out_color_matrix=bt709:in_range=auto:out_range=tv,crop=${w}:${h},setsar=1,format=yuv420p,` +
    `tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${CLIP_F},setpts=PTS-STARTPTS`;
}
function flashExpr(bounds) {
  const f = FLASH;
  return bounds.map(b => `between(t,${n2(b - f.before)},${n2(b - f.before + f.rise)})*${f.peak}*pow((t-${n2(b - f.before)})/${f.rise},2)` +
    `+gt(t,${n2(b - f.before + f.rise)})*lte(t,${n2(b - f.before + f.rise + f.fall)})*${f.peak}*pow(1-(t-${n2(b - f.before + f.rise)})/${f.fall},2)`).join('+');
}
function run(argv, label) {
  return new Promise((ok, ko) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...argv], { stdio: ['ignore', 'ignore', 'pipe'] }); let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => (code === 0 ? ok() : ko(new Error(label + ' : ffmpeg ' + code + ' ' + err.slice(-1500)))));
  });
}
// Un clip (84 images) : plein écran zoomé + ombre + médaillon arrondi + bord → intermédiaire sans perte ; puis les clips
// sont mis bout à bout avec le flash et encodés une seule fois (un clip à la fois : pas de file d'images en mémoire).
async function render(asm, L) {
  const clips = asm.clips, N = clips.length, srcs = [];
  for (const c of clips) srcs.push(await sourceOf(c));
  const inset = k => (k === 0 ? 1 : k - 1);   // médaillon : clip suivant pendant le 1er, puis le précédent
  const out = join(OUT, asm.id + '.mp4'), parts = clips.map((_, k) => join(TMP, asm.id + '-' + k + '.mkv'));
  const z = `${n2(ZOOM.from - 1)}*pow(max(0,1-on/${ZOOM.frames}),3)`;
  const layer = f => ['-loop', '1', '-framerate', String(FPS), '-t', String(CLIP_S), '-i', f];
  const seg = k => {
    const m = srcs[k], s = srcs[inset(k)];
    const g = [`${norm(3, m, 2 * W, 2 * H)},zoompan=z='1+${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${W}x${H}:fps=${FPS}[m]`,
      `${norm(4, s, W, H)},scale=${INSET.w}:${INSET.h}:flags=lanczos,format=yuva420p[ia]`,
      `[1:v]format=gray,trim=end_frame=${CLIP_F},setpts=PTS-STARTPTS[mk]`, `[ia][mk]alphamerge[i]`,
      `[0:v]trim=end_frame=${CLIP_F},setpts=PTS-STARTPTS[sh]`, `[2:v]trim=end_frame=${CLIP_F},setpts=PTS-STARTPTS[bd]`,
      `[m][sh]overlay=0:0:format=yuv420[a]`, `[a][i]overlay=${INSET.x}:${INSET.y}:format=yuv420[b]`,
      `[b][bd]overlay=${BOX.x}:${BOX.y}:format=yuv420,trim=end_frame=${CLIP_F},setpts=PTS-STARTPTS,format=yuv420p[out]`];
    return [...layer(L.shadow), ...layer(L.mask), ...layer(L.border),
      '-ss', String(m.start), '-t', String(CLIP_S + 0.6), '-i', m.path, '-ss', String(s.start), '-t', String(CLIP_S + 0.6), '-i', s.path,
      '-filter_complex', g.join(';'), '-map', '[out]', '-an', '-frames:v', String(CLIP_F), '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', parts[k]];
  };
  const bounds = clips.slice(1).map((_, k) => CLIP_S * (k + 1)), O = flashExpr(bounds);
  const en = bounds.map(b => `between(t,${n2(b - FLASH.before - 0.02)},${n2(b - FLASH.before + FLASH.rise + FLASH.fall + 0.02)})`).join('+');
  // flash = fondu vers le blanc d'opacité O(t) : Y' = Y·(1−O) + 235·O (eq : contraste 1−O, luminosité 107/256·O),
  // U' = U·(1−O) + 128·O (saturation 1−O) — une table par image, pas de calcul par pixel
  const fin = [...parts.flatMap(p => ['-i', p]), '-filter_complex',
    `${parts.map((_, k) => `[${k}:v]`).join('')}concat=n=${N}:v=1:a=0,setpts=N/${FPS}/TB,` +
    `eq=eval=frame:contrast='1-(${O})':brightness='${n2(107 / 256)}*(${O})':saturation='1-(${O})':enable='${en}',` +
    `format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709[out]`,
    '-map', '[out]', '-an', '-r', String(FPS), '-frames:v', String(CLIP_F * N),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart',
    '-metadata', 'comment=' + asm.id + ' · ' + asm.label, out];
  if (opt.dry) { clips.forEach((_, k) => console.log('ffmpeg ' + seg(k).map(a => (/[\s;'()]/.test(a) ? JSON.stringify(a) : a)).join(' '))); console.log('ffmpeg ' + fin.join(' ')); return null; }
  for (let k = 0; k < N; k++) await run(seg(k), asm.id + ' clip ' + (k + 1));
  await run(fin, asm.id + ' assemblage');
  parts.forEach(p => { try { unlinkSync(p); } catch (e) { /* déjà supprimé */ } });
  return out;
}

// ── contrôle : nombre d'images, durée, première image ni noire ni blanche ──
function check(file, n) {
  const pr = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate,pix_fmt:format=duration',
    '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(pr.stdout || '{}'), st = (j.streams || [{}])[0], dur = Number((j.format || {}).duration);
  const sg = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'select=eq(n\\,0),signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
  const yavg = Number((/YAVG=([\d.]+)/.exec(sg.stdout || '') || [])[1]);
  const frames = Number(st.nb_read_frames), okF = frames === CLIP_F * n, okD = Math.abs(dur - CLIP_S * n) < 0.05, ok0 = yavg > 24 && yavg < 225;
  return { frames, duration: dur, size: st.width + 'x' + st.height, fps: st.r_frame_rate, firstFrameY: yavg, ok: okF && okD && ok0 && st.width === W && st.height === H };
}

const L = layers(), jobs = Math.max(1, Number(opt.jobs) || 2), report = [];
let next = 0, failed = 0;
async function worker() {
  while (next < list.length) {
    const a = list[next++], t0 = Date.now();
    try {
      const f = opt.check ? join(OUT, a.id + '.mp4') : await render(a, L);   // --check : contrôle les rendus existants
      if (!f) continue;
      const c = check(f, a.clips.length);
      report.push({ id: a.id, label: a.label, group: a.group, module: a.module, components: a.components, clips: a.clips.map(x => ({ key: x.key, brick_id: x.brick_id, clip: x.clip, label: x.label })), ...c });
      console.log((c.ok ? 'OK   ' : 'FAIL ') + a.id + ' · ' + a.label + ' · ' + c.frames + ' images · ' + c.duration.toFixed(2) + ' s · Y0 ' + c.firstFrameY.toFixed(1) + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
      if (!c.ok) failed += 1;
    } catch (e) { failed += 1; console.log('FAIL ' + a.id + ' · ' + String(e.message || e).split('\n')[0]); }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
if (!opt.dry) {
  report.sort((a, b) => list.findIndex(x => x.id === a.id) - list.findIndex(x => x.id === b.id));
  writeFileSync(join(OUT, 'assemblages.json'), JSON.stringify(report, null, 1));
  console.log((list.length - failed) + '/' + list.length + ' assemblages ' + (opt.check ? 'contrôlés' : 'rendus') + ' → ' + OUT);
  // --sql <fichier> : recettes factory_recipes (upsert idempotent, statut 'done') des rendus valides ; --tsv <fichier> :
  // lignes « chemin local <TAB> factory-media/assemblages/<id>.mp4 » à envoyer (chemins nouveaux : le stockage n'écrase pas)
  const good = report.filter(r => r.ok), q = x => "'" + String(x).replace(/'/g, "''") + "'";
  const PUB = 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/assemblages/';
  if (opt.sql && good.length) {
    const rows = good.map(r => '  (' + [q(r.id), q('hook'), q(r.module), q(JSON.stringify(r.components)) + '::jsonb',
      q(JSON.stringify({ format: W + 'x' + H, fps: FPS, clip_s: CLIP_S, inset: 'clip suivant pendant le 1er, puis le précédent', flash: true })) + '::jsonb',
      q('done'), q(PUB + r.id + '.mp4'),
      q(JSON.stringify({ label: r.label, group: r.group, module: r.module, code: r.id.split('-').pop(), clips: r.clips, duration_s: Number(r.duration.toFixed(2)),
        frames: r.frames, rule: 'assemblage avant / après : clips distincts d’un seul groupe (Axel, 26/09)' })) + '::jsonb'].join(', ') + ')');
    writeFileSync(String(opt.sql), '-- ' + good.length + ' assemblages avant / après (usine/assemble-hk.mjs) — upsert idempotent\n' +
      'insert into public.factory_recipes (id, kind, subject, components, params, status, render_url, meta) values\n' + rows.join(',\n') +
      '\n-- rejouable : un assemblage retiré (status « retired ») le reste ; les notes de meta sont gardées ; jamais sur une autre kind\n' +
      'on conflict (id) do update set subject = excluded.subject, components = excluded.components, params = excluded.params,\n' +
      '  status = case when factory_recipes.status = \'retired\' then factory_recipes.status else excluded.status end,\n' +
      '  render_url = excluded.render_url, meta = factory_recipes.meta || excluded.meta, updated_at = now()\n' +
      '  where factory_recipes.kind = \'hook\';\n');
    console.log('SQL → ' + opt.sql);
  }
  if (opt.tsv && good.length) {
    writeFileSync(String(opt.tsv), good.map(r => join(OUT, r.id + '.mp4') + '\tfactory-media/assemblages/' + r.id + '.mp4').join('\n') + '\n');
    console.log('envois → ' + opt.tsv);
  }
}
process.exitCode = failed ? 1 : 0;
