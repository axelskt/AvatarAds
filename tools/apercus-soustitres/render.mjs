#!/usr/bin/env node
// render.mjs — aperçus vidéo 9:16 (4,5 s) + vignette .jpg de chaque style de sous-titres, rendus EN LOCAL (gratuit)
// par le VRAI moteur du style (cf. catalogue.mjs), sur le même fond (fond.mjs) et la même phrase témoin.
//
//   node tools/apercus-soustitres/render.mjs --fond <fond.mp4> --out <dossier> [--only S03,S11] [--work <dossier>]
//
// Sorties : <out>/<id>.mp4 (1080×1920, 30 i/s, muet, faststart) · <out>/<id>.jpg (540×960) ·
//           <out>/_controle/<id>.jpg (5 images de contrôle côte à côte) · <out>/manifest.json
//
// Moteurs — aucun appel réseau payant, aucun crédit :
//   generateur : worker.mjs --local, plan { __compose:'gen-subs' } → composeGenSubs (le compose serveur du Générateur)
//   classique  : buildComposition(plan) de render-worker/build-composition.mjs, rendu par la CLI HyperFrames du worker
//   dynamique  : idem, slideStyle dynamic/slam → buildDynamicComposition ; plan.__derive posé (pas de dérivation :
//                un seul panneau visage plein cadre, la phrase témoin n'a pas à appeler d'animations)
//   usine      : usine/captions.mjs burn (le brûleur de build.mjs)
//   proposition: propositions.mjs, rendu comme le classique
// Le mot-à-mot (S01) rend 10 s et garde 1,5 → 6 s : dans ce style, les mots de la 1re phrase avant 1,6 s sont
// happés par le bloc du hook et ceux des 4 dernières secondes par le bloc CTA (build-composition.mjs) —
// la phrase témoin démarre donc à 1,9 s pour montrer le sous-titre courant du style, puis on recadre.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLES, D, WORDS, ACCENTS, isAccent } from './catalogue.mjs'
import { buildProposal } from './propositions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const RW = join(ROOT, 'render-worker')
const HF = join(RW, 'node_modules', '.bin', 'hyperframes')
const { buildComposition } = await import(join(RW, 'build-composition.mjs'))

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const FOND = resolve(arg('--fond') || '')
const OUT = resolve(arg('--out') || 'apercus')
const WORK = resolve(arg('--work') || join(OUT, '..', '_rendu'))
const ONLY = (arg('--only') || '').split(',').map((s) => s.trim()).filter(Boolean)
const POSTER_ONLY = process.argv.includes('--poster-only') // ne refait que la vignette depuis l'aperçu existant
const REUSE_RAW = process.argv.includes('--reuse-raw')     // garde le rendu brut du moteur, ne refait que le montage final
if (!existsSync(FOND)) { console.error('fond introuvable : --fond <fond.mp4> (voir fond.mjs)'); process.exit(1) }
if (!existsSync(HF)) { console.error('CLI HyperFrames du worker absente : cd render-worker && npm ci'); process.exit(1) }
mkdirSync(join(OUT, '_controle'), { recursive: true })
mkdirSync(WORK, { recursive: true })

const r2 = (n) => Math.round(n * 100) / 100
const TMAX = 600000 // 10 min par rendu, jamais plus
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: TMAX, maxBuffer: 64 * 1024 * 1024, ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} → ${r.status ?? r.signal}\n${String(r.stderr || '').slice(-2000)}\n${String(r.stdout || '').slice(-1500)}`)
  return r.stdout
}
const ff = (args) => run('ffmpeg', ['-v', 'error', '-y', ...args])
const cutFond = (dst, dur) => ff(['-i', FOND, '-t', String(dur), '-an', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', dst])
const words = (shift = 0) => WORDS.map((w) => ({ ...w, start: r2(w.start + shift), end: r2(w.end + shift) }))

function hfProject(dir, html, fondDur) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'media'), { recursive: true })
  mkdirSync(join(dir, 'fonts'), { recursive: true })
  for (const f of readdirSync(join(RW, 'assets', 'fonts'))) copyFileSync(join(RW, 'assets', 'fonts', f), join(dir, 'fonts', f))
  cutFond(join(dir, 'media', 'base.mp4'), fondDur)
  writeFileSync(join(dir, 'index.html'), html)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: 'aa-apercu', name: 'aa-apercu', createdAt: new Date().toISOString() }))
  writeFileSync(join(dir, 'hyperframes.json'), JSON.stringify({
    $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
    paths: { blocks: 'compositions', components: 'compositions/components', assets: 'media' },
  }, null, 2))
}
function hfRender(dir, out) {
  // mêmes réglages que le worker sur le Mac d'Axel : 2 workers Chrome (RENDER_WORKERS=2), 3 essais sur extraction incomplète
  for (let essai = 1; ; essai++) {
    try { run(HF, ['render', '--quality', 'high', '--fps', '30', '--workers', '2', '--output', out], { cwd: dir }); return }
    catch (e) {
      if (!/VideoFrameCoverageError|captured \d+ of expected \d+ frames/.test(e.message) || essai >= 3) throw e
      console.warn(`  ⟲ extraction incomplète (essai ${essai}/3)`)
    }
  }
}

// ── Générateur : couleurs et réglages lus dans l'app (source unique) ──
const APP = readFileSync(join(ROOT, 'app', 'index.html'), 'utf8')
const SUB_COLORS = (() => {
  const m = APP.match(/const SUB_STYLE_COLORS = (\{[\s\S]*?\n\});/)
  if (!m) throw new Error('SUB_STYLE_COLORS introuvable dans app/index.html')
  return Function('return ' + m[1])()
})()
const APP_CFG = (() => {
  const m = APP.match(/const cfg = \{([\s\S]*?)\n\};/)
  const num = (k, d) => { const x = m && m[1].match(new RegExp(k + ':\\s*([\\d.]+)')); return x ? Number(x[1]) : d }
  const str = (k, d) => { const x = m && m[1].match(new RegExp(k + ":\\s*'([^']+)'")); return x ? x[1] : d }
  return { subSize: num('subSize', 72), subPos: num('subPos', 75), subWpg: num('subWpg', 2), subTimingMode: str('subTimingMode', 'proportionnel'),
    subAdvanceMs: num('subAdvanceMs', 300), subSecPerGroup: num('subSecPerGroup', 1.2) }
})()
// découpe du Générateur : _renderWordChips → capitales sans ponctuation, groupes de subWpg mots
const genClean = (w) => w.toUpperCase().replace(/[.,!?;:"«»]/g, '').trim()

function renderGenerateur(st, dir, raw) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  cutFond(join(dir, 'base.mp4'), D)
  const flat = WORDS.map((w) => genClean(w.text))
  const groups = []
  for (let i = 0; i < flat.length; i += APP_CFG.subWpg) groups.push(flat.slice(i, i + APP_CFG.subWpg))
  const col = SUB_COLORS[st.value]
  if (!col) throw new Error('couleurs inconnues pour ' + st.value)
  const plan = { __compose: 'gen-subs', duration: D, cameraOrganique: false,
    subs: { groups, whisper: WORDS.map((w, i) => ({ word: flat[i], start: w.start, end: w.end })),
      cfg: { subSize: APP_CFG.subSize, subPos: APP_CFG.subPos, subWpg: APP_CFG.subWpg, subTimingMode: APP_CFG.subTimingMode,
        subAdvanceMs: APP_CFG.subAdvanceMs, subSecPerGroup: APP_CFG.subSecPerGroup },
      colors: { c1: col.c1, c2: col.c2 }, style: st.value, anim: 'none', animEnabled: false, totalDuration: D } }
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 1))
  run('node', [join(RW, 'worker.mjs'), '--local', dir, '--output', raw], { cwd: RW, env: { ...process.env, RENDER_WORKERS: '2', PUPPETEER_SKIP_DOWNLOAD: '1' } })
}

function renderClassique(st, dir, raw) {
  const o = st.opts || {}
  const RD = o.render || D
  const caps = words(o.shift || 0).map((w) => ({ ...w, accent: isAccent(w.text) }))
  const plan = { duration: RD, captions: caps, accents: ACCENTS, capStyle: o.capStyle || 'punch', slideStyle: o.slideStyle || 'auto',
    sections: [], slides: [], zooms: [], broll: [], sfx: [] }
  if (o.slideStyle === 'word') plan.hook = { start: 0, end: 0, text: '' }
  const html = buildComposition(plan, { assetFiles: {}, avatarClips: {}, avatarPhoto: null, fonds: [], maskSil: '', logoFile: '' })
  hfProject(dir, html, RD + 0.4)
  hfRender(dir, raw)
}

function renderDynamique(st, dir, raw) {
  const o = st.opts || {}
  const caps = words().map((w) => ({ ...w, accent: isAccent(w.text) }))
  const plan = { duration: D, slideStyle: o.slideStyle, captions: caps, accents: ACCENTS, subtitles: true, __derive: true,
    cameraOrganique: false, slides: [], sections: [], sfx: [], avatarSegments: [{ start: 0, end: D }],
    hook: o.hook ? { start: 0, end: D, text: '' } : { start: 0, end: 0, text: '' } }
  if (o.hookStyle) plan.hookStyle = o.hookStyle
  const html = buildComposition(plan, { assetFiles: {}, avatarClips: { av0: 'media/av0.mp4' }, avatarPhoto: 'media/still.jpg', logoFile: '' })
  hfProject(dir, html, D + 0.4)
  copyFileSync(join(dir, 'media', 'base.mp4'), join(dir, 'media', 'av0.mp4'))
  ff(['-i', join(dir, 'media', 'base.mp4'), '-frames:v', '1', '-q:v', '2', join(dir, 'media', 'still.jpg')])
  hfRender(dir, raw)
}

function renderUsine(st, dir, raw) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  // captions.mjs pose un <audio src="src.mp4"> (la voix de l'usine) : sans piste son HyperFrames refuse la composition
  // → le fond reçoit un silence AAC, comme une vraie vidéo de l'usine porte la voix
  ff(['-i', FOND, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(D), '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', join(dir, 'base.mp4')])
  writeFileSync(join(dir, 'words.json'), JSON.stringify(WORDS))
  run('node', [join(ROOT, 'usine', 'captions.mjs'), 'burn', join(dir, 'base.mp4'), raw, join(dir, 'words.json')], { cwd: dir })
}

function renderProposition(st, dir, raw) {
  hfProject(dir, buildProposal(st.value, { D, words: words(), isAccent }), D + 0.4)
  hfRender(dir, raw)
}

const ENGINES = { generateur: renderGenerateur, classique: renderClassique, dynamique: renderDynamique, usine: renderUsine, proposition: renderProposition }
const manifest = existsSync(join(OUT, 'manifest.json')) ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) : {}
const CHECK = [0.6, 1.4, 2.4, 3.3, 4.2]
for (const st of STYLES) {
  if (ONLY.length && !ONLY.includes(st.id)) continue
  const dir = join(WORK, st.id)
  const raw = join(WORK, st.id + '-raw.mp4')
  const t0 = Date.now()
  const mp4 = join(OUT, st.id + '.mp4'), jpg = join(OUT, st.id + '.jpg')
  if (POSTER_ONLY) {
    if (!existsSync(mp4)) { console.error(`  ✗ ${st.id} : aperçu absent`); continue }
    ff(['-ss', String(st.poster), '-i', mp4, '-frames:v', '1', '-vf', 'scale=540:960:flags=lanczos', '-q:v', '3', jpg])
    console.log(`  ✓ vignette ${jpg} (${st.poster} s)`)
    continue
  }
  console.log(`▶ ${st.id} · ${st.label} · moteur ${st.engine}`)
  try {
    if (!(REUSE_RAW && existsSync(raw))) ENGINES[st.engine](st, dir, raw)
    const cut = (st.opts && st.opts.cut) || 0
    ff(['-ss', String(cut), '-i', raw, '-t', String(D), '-vf', 'scale=1080:1920:flags=lanczos:out_range=tv,fps=30,format=yuv420p', '-an',
      // le compose du Générateur sort en yuvj420p (pleine plage) : on normalise tout en yuv420p plage « tv », le format standard du web
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart', mp4])
    ff(['-ss', String(st.poster), '-i', mp4, '-frames:v', '1', '-vf', 'scale=540:960:flags=lanczos', '-q:v', '3', jpg])
    const ins = CHECK.flatMap((t) => ['-ss', String(t), '-i', mp4])
    ff([...ins, '-filter_complex', CHECK.map((_, i) => `[${i}:v]trim=end_frame=1,scale=216:384[f${i}]`).join(';') + ';' + CHECK.map((_, i) => `[f${i}]`).join('') + `hstack=${CHECK.length}`,
      '-frames:v', '1', '-q:v', '3', join(OUT, '_controle', st.id + '.jpg')])
    const dur = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).trim())
    manifest[st.id] = { ok: true, engine: st.engine, duration: dur, seconds: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }
    console.log(`  ✓ ${mp4} (${dur.toFixed(2)} s, ${manifest[st.id].seconds} s de rendu)`)
  } catch (e) {
    manifest[st.id] = { ok: false, engine: st.engine, error: String(e.message).slice(0, 1500), at: new Date().toISOString() }
    console.error(`  ✗ ${st.id} : ${String(e.message).slice(0, 600)}`)
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1))
}
