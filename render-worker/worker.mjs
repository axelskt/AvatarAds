#!/usr/bin/env node
// worker.mjs — 🎼 Renderer serveur AvatarAds (partie 4 du chef d'orchestre)
// Transforme { vidéo de base + plan de montage v0.2 + images } en MP4 final :
//   1. build-composition.mjs → composition HyperFrames (visuel : zooms, b-roll,
//      hook, sous-titres Punch) rendue en headless (Chrome + ffmpeg via la CLI)
//   2. ffmpeg → mix audio : voix de la base + SFX aux timestamps + musique duckée
//
// Modes :
//   node worker.mjs --local test/job --output out.mp4 [--draft]
//       job/ = { base.mp4, plan.json, assets/<id>.jpg… }  (aucun réseau)
//   node worker.mjs
//       boucle : réclame les jobs 'queued' de la table render_jobs (Supabase),
//       télécharge les entrées du storage, rend, uploade le MP4, marque done.
//       Env requis (.env) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { execFileSync, execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildComposition } from './build-composition.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HYPERFRAMES = 'hyperframes@0.7.60' // épinglé : mêmes rendus dans le temps
const MUSIC_BY_MOOD = { intense: 'music-2.mp3', dynamique: 'music-1.mp3', chill: 'music-3.mp3' }
// volume par mood calibré sur la loudness mesurée de chaque piste (music-2 ≈ -5 LUFS,
// music-1 ≈ -9.5, music-3 ≈ -11) → la voix reste TOUJOURS clairement au-dessus
const MUSIC_VOL_BY_MOOD = { intense: 0.09, dynamique: 0.13, chill: 0.15 }
const MUSIC_VOL_EXTRA = 0.12 // titres ajoutés (assets/music/<mood>-N.mp3) : normalise-les à ~-14 LUFS

// banque extensible : dépose des `assets/music/<mood>-1.mp3`, `<mood>-2.mp3`, … et ils
// entrent dans la rotation du mood (choix stable par durée de vidéo, pour varier entre vidéos)
function pickMusic(mood, seed) {
  const dir = join(HERE, 'assets', 'music')
  let pool = []
  try { pool = readdirSync(dir).filter((f) => f.startsWith(mood + '-') && f.endsWith('.mp3')) } catch (_) { /* dossier absent */ }
  if (pool.length) {
    const f = pool[Math.abs(Math.floor(seed * 100)) % pool.length]
    return { file: join(dir, f), vol: MUSIC_VOL_EXTRA }
  }
  const base = MUSIC_BY_MOOD[mood]
  return base ? { file: join(dir, base), vol: MUSIC_VOL_BY_MOOD[mood] || 0.12 } : null
}
const SFX_VOL = 0.85

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? true) : null }

function sh(cmd, cwd) { execSync(cmd, { cwd, stdio: 'inherit' }) }
function ffprobe(file, entries) {
  return execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()
}

// ── cœur : job (dossier local) → MP4 final ──
export async function renderJob(jobDir, outPath, { draft = false } = {}) {
  const t0 = Date.now()
  const plan = JSON.parse(readFileSync(join(jobDir, 'plan.json'), 'utf8'))
  const basePath = join(jobDir, 'base.mp4')
  if (!existsSync(basePath)) throw new Error('base.mp4 manquant dans ' + jobDir)

  // durée réelle de la vidéo de base = source de vérité
  const baseDur = parseFloat(ffprobe(basePath, 'format=duration')) || plan.duration || 10
  plan.duration = Math.round(Math.min(plan.duration || baseDur, baseDur) * 100) / 100

  // ── 1. projet HyperFrames temporaire ──
  const proj = mkdtempSync(join(tmpdir(), 'aa-render-'))
  try {
    mkdirSync(join(proj, 'media'), { recursive: true })
    copyFileSync(basePath, join(proj, 'media', 'base.mp4'))

    const assetFiles = {}
    const assetsDir = join(jobDir, 'assets')
    if (existsSync(assetsDir)) {
      for (const f of readdirSync(assetsDir)) {
        const id = f.replace(/\.[^.]+$/, '')
        copyFileSync(join(assetsDir, f), join(proj, 'media', f))
        assetFiles[id] = 'media/' + f
      }
    }

    writeFileSync(join(proj, 'index.html'), buildComposition(plan, { assetFiles }))
    writeFileSync(join(proj, 'meta.json'), JSON.stringify({ id: 'aa-montage', name: 'aa-montage', createdAt: new Date().toISOString() }))
    writeFileSync(join(proj, 'hyperframes.json'), JSON.stringify({
      $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
      paths: { blocks: 'compositions', components: 'compositions/components', assets: 'media' },
    }, null, 2))

    // ── 2. rendu visuel headless ──
    const visual = join(proj, 'visual.mp4')
    console.log(`▶ rendu visuel (${draft ? 'draft' : 'high'})…`)
    sh(`npx -y ${HYPERFRAMES} render --quality ${draft ? 'draft' : 'high'} --output visual.mp4`, proj)
    if (!existsSync(visual)) throw new Error('rendu visuel échoué (visual.mp4 absent)')

    // ── 3. mix audio ffmpeg : voix + SFX (adelay) + musique duckée en boucle ──
    const inputs = ['-i', visual, '-i', basePath]
    const filters = []
    const mixIns = []
    let idx = 2

    filters.push(`[1:a]apad=whole_dur=${plan.duration}[voice]`)
    mixIns.push('[voice]')

    const mood = plan.music && plan.music.mood
    const pick = mood ? pickMusic(mood, plan.duration || 1) : null
    if (pick && existsSync(pick.file)) {
      inputs.push('-stream_loop', '-1', '-i', pick.file)
      filters.push(`[${idx}:a]atrim=0:${plan.duration},volume=${pick.vol},afade=t=out:st=${Math.max(0, plan.duration - 0.8)}:d=0.8[mus]`)
      mixIns.push('[mus]')
      idx++
    }

    for (const s of plan.sfx || []) {
      const f = join(HERE, 'assets', 'sfx', `${s.kind}.mp3`)
      if (!existsSync(f)) continue
      inputs.push('-i', f)
      const ms = Math.max(0, Math.round(s.t * 1000))
      filters.push(`[${idx}:a]adelay=${ms}|${ms},volume=${SFX_VOL}[s${idx}]`)
      mixIns.push(`[s${idx}]`)
      idx++
    }

    filters.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=first:normalize=0[aout]`)
    console.log(`▶ mix audio (${mixIns.length} pistes)…`)
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-t', String(plan.duration),
      outPath,
    ], { stdio: 'inherit' })

    const outDur = parseFloat(ffprobe(outPath, 'format=duration')) || 0
    console.log(`✅ ${outPath} — ${outDur.toFixed(1)}s, rendu total ${((Date.now() - t0) / 1000).toFixed(0)}s`)
    return { outPath, duration: outDur }
  } finally {
    rmSync(proj, { recursive: true, force: true })
  }
}

// ── mode poll Supabase : réclame les jobs queued, rend, uploade ──
async function pollLoop() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants (.env)'); process.exit(1) }
  const sb = createClient(url, key, { auth: { persistSession: false } })
  console.log('🎼 render-worker en écoute (poll 5 s)…')

  for (;;) {
    try {
      const { data: jobs } = await sb.from('render_jobs').select('*').eq('status', 'queued')
        .order('created_at').limit(1)
      const job = jobs && jobs[0]
      if (!job) { await new Promise((r) => setTimeout(r, 5000)); continue }

      // claim atomique : queued → rendering (un seul worker gagne)
      const { data: claimed } = await sb.from('render_jobs')
        .update({ status: 'rendering', updated_at: new Date().toISOString(), attempts: (job.attempts || 0) + 1 })
        .eq('id', job.id).eq('status', 'queued').select('id')
      if (!claimed || !claimed.length) continue

      console.log('▶ job', job.id)
      const jobDir = mkdtempSync(join(tmpdir(), 'aa-job-'))
      try {
        const dl = async (path, dest) => {
          const { data, error } = await sb.storage.from('render-media').download(path)
          if (error) throw new Error('download ' + path + ': ' + error.message)
          writeFileSync(dest, Buffer.from(await data.arrayBuffer()))
        }
        await dl(job.input_video, join(jobDir, 'base.mp4'))
        writeFileSync(join(jobDir, 'plan.json'), JSON.stringify(job.plan))
        mkdirSync(join(jobDir, 'assets'), { recursive: true })
        for (const a of job.assets || []) await dl(a.path, join(jobDir, 'assets', a.id + '.jpg'))

        const out = join(jobDir, 'final.mp4')
        await renderJob(jobDir, out)

        const outKey = `${job.user_id}/${job.id}.mp4`
        const { error: upErr } = await sb.storage.from('render-media')
          .upload(outKey, readFileSync(out), { contentType: 'video/mp4', upsert: true })
        if (upErr) throw new Error('upload: ' + upErr.message)
        const outputUrl = `${url}/storage/v1/object/public/render-media/${outKey}`
        await sb.from('render_jobs').update({ status: 'done', output_url: outputUrl, updated_at: new Date().toISOString() }).eq('id', job.id)
        console.log('✅ job', job.id, '→', outputUrl)
      } catch (e) {
        console.error('✗ job', job.id, e.message)
        await sb.from('render_jobs').update({ status: 'failed', error: String(e.message || e).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', job.id)
      } finally {
        rmSync(jobDir, { recursive: true, force: true })
      }
    } catch (e) {
      console.error('poll error:', e.message)
      await new Promise((r) => setTimeout(r, 8000))
    }
  }
}

// ── entrée ──
const localDir = flag('--local')
if (localDir) {
  const out = resolve(flag('--output') || 'final.mp4')
  renderJob(resolve(localDir), out, { draft: !!flag('--draft') })
    .catch((e) => { console.error('✗', e.message); process.exit(1) })
} else {
  pollLoop()
}
