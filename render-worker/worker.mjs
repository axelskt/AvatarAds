#!/usr/bin/env node
// worker.mjs — 🎼 Renderer serveur AvatarAds (partie 4 du chef d'orchestre)
// Transforme { vidéo de base + plan de montage v0.2 + images } en MP4 final :
//   1. build-composition.mjs → composition HyperFrames (visuel : zooms, b-roll,
//      hook, sous-titres Punch) rendue en headless (Chrome + ffmpeg via la CLI)
//   2. ffmpeg → mix audio : voix de la base + SFX aux timestamps + musique duckée
//
// Modes :
//   node worker.mjs --local test/job --output out.mp4 [--draft]
//       job/ = { base.mp4, plan.json, assets/<id>.jpg|.mp4… }  (aucun réseau)
//   node worker.mjs
//       boucle : réclame les jobs 'queued' de la table render_jobs (Supabase),
//       télécharge les entrées du storage, rend, uploade le MP4, marque done.
//       Env requis (.env) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ANIM_EMOJI_SET } from './anim-pack.mjs'
import { join, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildComposition } from './build-composition.mjs'
import { deriveDynamicSlides } from './dynamic-derive.mjs'
import { deriveClassicSlides } from './classic-derive.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HYPERFRAMES = 'hyperframes@0.7.60' // épinglé : mêmes rendus dans le temps
const MUSIC_BY_MOOD = { intense: 'music-2.mp3', dynamique: 'music-1.mp3', chill: 'music-3.mp3' }
// volume par mood calibré sur la loudness mesurée de chaque piste (music-2 ≈ -5 LUFS,
// music-1 ≈ -9.5, music-3 ≈ -11) → la voix reste TOUJOURS clairement au-dessus
// Volumes revus a la baisse (~-6 dB) : la musique couvrait la voix et ecrasait les
// bruitages, qui portent bien mieux le rythme. Elle n'est plus active par defaut.
const MUSIC_VOL_BY_MOOD = { intense: 0.045, dynamique: 0.065, chill: 0.075 }
const MUSIC_VOL_EXTRA = 0.06 // repli si la sonie d'un titre est illisible
// niveau CIBLE de la musique de fond, en LUFS. La voix est calée à -14 : à -30
// le lit se sent sans jamais disputer la parole. Chaque titre de la
// bibliothèque est mesuré et ramené ici, sinon les plus forts écrasent tout.
const MUSIC_TARGET_LUFS = -30

// banque extensible : dépose des `assets/music/<mood>-1.mp3`, `<mood>-2.mp3`, … et ils
// entrent dans la rotation du mood (choix stable par durée de vidéo, pour varier entre vidéos)
function pickMusic(mood, seed) {
  const dir = join(HERE, 'assets', 'music')
  // BIBLIOTHÈQUE (assets/music/lib) : les instrumentaux sans parole d'Axel. Ce
  // sont des morceaux ENTIERS de 2 à 5 min — on ne veut donc pas toujours leur
  // intro. On tire un morceau ET un point de départ quelconque dans le morceau,
  // et le mix coupe à la fin de la vidéo (afade en sortie, déjà en place).
  // Le tirage est pseudo-aléatoire mais DÉTERMINISTE (graine = durée de la
  // vidéo) : deux rendus du même montage donnent la même musique, sinon un
  // re-rendu changerait la bande-son sans prévenir.
  try {
    const lib = readdirSync(join(dir, 'lib')).filter((f) => f.endsWith('.mp3'))
    if (lib.length) {
      const s = Math.abs(Math.round(seed * 1000))
      const f = lib.sort()[s % lib.length]
      const file = join(dir, 'lib', f)
      let dur = 0
      try { dur = parseFloat(ffprobe(file, 'format=duration')) || 0 } catch (_) { /* durée inconnue */ }
      // on démarre n'importe où, mais en gardant de quoi couvrir la vidéo sans
      // reboucler : au pire on repart du début
      const room = Math.max(0, dur - (seed + 2))
      const start = room > 1 ? Math.round((((s * 7919) % 9973) / 9973) * room * 100) / 100 : 0
      // NIVEAU MESURÉ, pas un volume au jugé. Les 8 titres vont de -8,3 à
      // -14,3 LUFS : à volume fixe, l'un passerait 6 dB au-dessus de l'autre.
      // On mesure et on ramène chacun à MUSIC_TARGET_LUFS — un lit constant,
      // toujours à la même distance sous la voix (elle est à -14 LUFS).
      const lufs = loudnessOf(file)
      const vol = lufs == null ? MUSIC_VOL_EXTRA
        : Math.min(0.5, Math.max(0.02, Math.pow(10, (MUSIC_TARGET_LUFS - lufs) / 20)))
      return { file, vol: Math.round(vol * 1000) / 1000, start, name: f.replace(/\.mp3$/, ''), lufs }
    }
  } catch (_) { /* pas de bibliothèque */ }
  let pool = []
  try { pool = readdirSync(dir).filter((f) => f.startsWith(mood + '-') && f.endsWith('.mp3')) } catch (_) { /* dossier absent */ }
  if (pool.length) {
    const f = pool[Math.abs(Math.floor(seed * 100)) % pool.length]
    return { file: join(dir, f), vol: MUSIC_VOL_EXTRA, start: 0 }
  }
  const base = MUSIC_BY_MOOD[mood]
  return base ? { file: join(dir, base), vol: MUSIC_VOL_BY_MOOD[mood] || 0.12, start: 0 } : null
}
const SFX_VOL = 0.85
// largeur minimale d'une image de b-roll : la carte fait 76 % de 1080 px ≈ 820 px.
// En dessous, l'image est agrandie donc floue — on préfère ne pas l'afficher.
const MIN_IMAGE_W = 700
// 🎭 LITS MUSICAUX (#125) — des extraits de 9-11 s posés à UN moment précis, pas bouclés
// sur toute la vidéo comme la musique de fond. Un bruitage ponctue un mot, un lit
// accompagne un passage. Volume bas : ils passent SOUS la voix, jamais devant.
const BED_VOL = 0.34
const BEDS = ['grave', 'tension', 'montee']

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? true) : null }

function sh(cmd, cwd) { execSync(cmd, { cwd, stdio: 'inherit' }) }
function ffprobe(file, entries) {
  return execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()
}

// sonie intégrée d'un fichier (LUFS) — sert à savoir combien il MANQUE, plutôt
// que de laisser loudnorm re-traiter une voix déjà masterisée par l'app.
function loudnessOf(file) {
  try {
    const r = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-i', file, '-map', '0:a:0',
      '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' })
    const hits = [...String(r.stderr || '').matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)]
    const v = hits.length ? parseFloat(hits[hits.length - 1][1]) : NaN
    return Number.isFinite(v) ? v : null
  } catch (_) { return null }
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
    // La base arrive telle quelle du navigateur (remux instantané, souvent 540×960) :
    // c'est ICI qu'on la met au format de rendu — ffmpeg natif fait en ~2 s ce qui
    // prenait des minutes en WASM côté client. On ne touche pas à l'audio (la voix).
    const baseOut = join(proj, 'media', 'base.mp4')
    let baseW = 0, baseH = 0
    try { const d = ffprobe(basePath, 'stream=width,height').split(','); baseW = parseInt(d[0], 10) || 0; baseH = parseInt(d[1], 10) || 0 } catch (_) { /* probe optionnel */ }
    if (!baseW) {
      // job AUDIO SEUL (Montage IA via MCP : pas de clip filmé) → fond noir 1080×1920,
      // les slides du plan couvrent l'écran de toute façon (style dynamic & co)
      console.log('▶ base sans piste vidéo (audio seul) → fond noir 1080×1920')
      execFileSync('ffmpeg', ['-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=30', '-i', basePath,
        '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', baseOut])
    } else if (baseW === 1080 && baseH === 1920) copyFileSync(basePath, baseOut)
    else {
      console.log(`▶ base ${baseW}×${baseH} → 1080×1920 (ffmpeg natif)…`)
      try {
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', basePath,
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
          '-c:a', 'copy', baseOut])
      } catch (e) {
        console.warn('normalisation base impossible, on garde l\'original :', e.message)
        copyFileSync(basePath, baseOut)
      }
    }

    const assetFiles = {}
    const assetsDir = join(jobDir, 'assets')
    if (existsSync(assetsDir)) {
      for (const f of readdirSync(assetsDir)) {
        const id = f.replace(/\.[^.]+$/, '')
        const src = join(assetsDir, f)
        if (/\.(mp4|mov|webm|m4v)$/i.test(f)) {
          // b-roll VIDÉO (#111) : normalise en H.264 muet ≤1280px — décodage garanti
          // dans le rendu headless (les .mov iPhone sont souvent en HEVC)
          try {
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src,
              '-vf', "scale='min(1280,iw)':-2", '-an',
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
              '-movflags', '+faststart', join(proj, 'media', id + '.mp4')])
            assetFiles[id] = 'media/' + id + '.mp4'
          } catch (e) {
            // clip illisible → première frame en JPEG, le rendu ne doit pas échouer
            try {
              execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-q:v', '3', join(proj, 'media', id + '.jpg')])
              assetFiles[id] = 'media/' + id + '.jpg'
            } catch (_) { console.warn('asset b-roll ignoré (illisible):', f) }
          }
        } else {
          // GARDE-FOU RÉSOLUTION. La carte d'image occupe 76 % de la largeur, soit
          // ~820 px sur du 1080. Une image plus petite que ça est ÉTIRÉE, donc floue —
          // c'est ce qu'Axel a vu sur l'avatar en 480 px de large. On l'écarte plutôt
          // que de livrer du flou : une image illisible ne montre rien de toute façon.
          let wpx = 0
          try {
            wpx = Number(String(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
              '-show_entries', 'stream=width', '-of', 'csv=p=0', src])).trim()) || 0
          } catch (_) { wpx = 0 }
          if (wpx && wpx < MIN_IMAGE_W) {
            console.warn(`asset ignoré (trop basse résolution : ${wpx}px < ${MIN_IMAGE_W}px, serait flou) :`, f)
          } else {
            copyFileSync(src, join(proj, 'media', f))
            assetFiles[id] = 'media/' + f
          }
        }
      }
    }

    // #119 · scènes avatar (lipsync segmenté) : clips av0.mp4, av1.mp4… dans jobDir/avatar,
    // ordonnés comme plan.avatarSegments → normalisés + passés au renderer (opts.avatarClips)
    const avatarClips = {}
    const avatarDir = join(jobDir, 'avatar')
    if (existsSync(avatarDir)) {
      for (const f of readdirSync(avatarDir).filter((f) => /\.(mp4|mov|webm|m4v)$/i.test(f)).sort()) {
        const id = f.replace(/\.[^.]+$/, '') // 'av0', 'av1'…
        try {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(avatarDir, f),
            '-vf', "scale='min(1080,iw)':-2,fps=30", '-an',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '30',
            '-movflags', '+faststart', join(proj, 'media', id + '.mp4')])
          avatarClips[id] = 'media/' + id + '.mp4'
        } catch (e) { console.warn('scène avatar ignorée (illisible):', f, e.message) }
      }
    }

    // UNE FENÊTRE AVATAR NE DURE PAS PLUS LONGTEMPS QUE SON CLIP. Le plan décrit
    // les moments où le visage parle ; le clip lipsync, lui, fait la durée qu'il
    // fait. Quand la fenêtre est plus longue, le moteur de rendu compte des
    // images qui n'existent pas et refuse le rendu :
    //   « Video "pn0av" captured 97 of expected 195 frames … aborting render ».
    // On borne donc chaque segment sur la durée réelle du clip correspondant.
    if ((plan.avatarSegments || []).length && Object.keys(avatarClips).length) {
      plan.avatarSegments = plan.avatarSegments.map((w, i) => {
        const src = avatarClips['av' + i]
        if (!src) return w
        let dur = 0
        try {
          dur = Number(String(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
            'format=duration', '-of', 'csv=p=0', join(proj, src)])).trim()) || 0
        } catch (_) { return w }
        const end = Math.min(w.end ?? (w.start + dur), w.start + dur)
        if (end < (w.end ?? 0) - 0.05) console.log(`▶ fenêtre avatar ${i} bornée à ${end.toFixed(2)}s (durée du clip)`)
        return { ...w, end }
      }).filter((w) => (w.end - w.start) >= 0.6)
    }

    // polices embarquées (#131) : les styles visuels les référencent en 'fonts/*.woff2'.
    // Copiées dans le projet plutôt que servies par un CDN — un rendu ne doit jamais
    // dépendre du réseau pour sa typographie.
    // logo de marque pour l'animation `logo` (#135), copié comme les polices
    // Le logo vient du JOB, donc de la marque de l'utilisateur — jamais d'un fichier
    // livre avec le worker. Un test sur l'audio d'une autre marque a affiche le logo
    // AvatarAds quand la voix disait « thinks.fr » : un logo code en dur est faux
    // pour tout le monde sauf nous. Sans logo fourni, l'animation ne rend rien.
    const jobLogo = ['brand-logo.png', 'brand-logo.jpg', 'logo.png']
      .map((n) => join(jobDir, n)).find((f) => existsSync(f))
    if (jobLogo) {
      mkdirSync(join(proj, 'brand'), { recursive: true })
      copyFileSync(jobLogo, join(proj, 'brand', 'logo' + extname(jobLogo)))
    }

    // emojis 3D (#135) : on ne copie QUE ceux que le plan utilise — la banque en
    // compte 84, inutile d'en embarquer 84 dans chaque rendu.
    const wanted = new Set((plan.slides || []).map((sl) => sl.emoji).filter(Boolean))
    // les scènes d'emojis 3D (money, rocket, check…) tirent leurs propres fichiers
    for (const sl of plan.slides || []) {
      for (const e of ANIM_EMOJI_SET[sl.anim] || []) wanted.add(e)
    }
    if (wanted.size) {
      mkdirSync(join(proj, 'emoji'), { recursive: true })
      for (const name of wanted) {
        const f = join(HERE, 'assets', 'emoji', name + '.png')
        if (existsSync(f)) copyFileSync(f, join(proj, 'emoji', name + '.png'))
      }
    }

    // captures du tuto pour le mode presentation 3D (#135)
    // ⚠️ dériver AVANT de lister les captures : la dérivation #148 ajoute des scènes
    // ui avec screen:'site-home' & co — sans ça leurs images ne sont jamais copiées
    // (l'engine re-saute la dérivation quand les scènes ui existent déjà)
    // apple partage le moteur du dynamique (cf. build-composition) : il partage
    // donc aussi sa dérivation, pas celle des styles posés sur une base.
    if (plan.slideStyle === 'dynamic' || plan.slideStyle === 'apple') {
      // assetFiles : sans lui la dérivation ne voit pas les médias de l'utilisateur
      try { deriveDynamicSlides(plan, { assetFiles }) } catch (e) { console.warn('dérivation:', e.message) }
    }
    // …et les styles classiques (editorial, glass, word) reçoivent les mêmes
    // corrections côté DONNÉE : captures cadrées sur l'élément nommé, mot
    // affiché = mot prononcé, animation ancrée sur le mot qui la justifie.
    else { try { deriveClassicSlides(plan) } catch (e) { console.warn('dérivation classique:', e.message) } }
    // UNE FENÊTRE COUPÉE EN DEUX REJOUE LE MÊME CLIP, PLUS LOIN DEDANS.
    // La dérivation peut scinder une fenêtre avatar (le hook passe du split au
    // plein cadre). Le moteur associe le clip à l'INDICE de la fenêtre : la
    // seconde moitié n'avait donc plus de clip. On lui en découpe un, à partir
    // de `clipFrom` — la voix continue, le visage aussi.
    {
      const segs = plan.avatarSegments || []
      const next = {}
      segs.forEach((w, i) => {
        const from = Number(w.clipFrom || 0)
        const srcId = 'av' + (w.clip ?? i)
        const src = avatarClips[srcId]
        if (!src) return
        if (from < 0.05) { next['av' + i] = src; return }
        const out = 'media/av' + i + '-cut.mp4'
        try {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(from), '-i', join(proj, src),
            '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', join(proj, out)])
          next['av' + i] = out
          console.log(`▶ fenêtre avatar ${i} : même clip, repris à ${from.toFixed(2)}s`)
        } catch (e) { console.warn('découpe clip avatar :', e.message) }
      })
      for (const k of Object.keys(avatarClips)) delete avatarClips[k]
      Object.assign(avatarClips, next)
    }

    const wantedScreens = new Set((plan.slides || []).map((sl) => sl.screen).filter(Boolean))
    // une animation peut avoir besoin d'images (le visage du comparatif fake/réel,
    // le logo dans « les bons outils ») : elles le déclarent dans `assets`
    for (const sl of plan.slides || []) for (const a of sl.assets || []) wantedScreens.add(a)
    // #149 · fenêtres avatar SANS clips lipsync → la photo avatar sert de fallback
    if ((plan.avatarSegments || []).length && !existsSync(join(jobDir, 'avatar'))) wantedScreens.add('hook-qualite')
    if (wantedScreens.size) {
      mkdirSync(join(proj, 'tuto'), { recursive: true })
      for (const name of wantedScreens) {
        const f = join(HERE, 'assets', 'tuto', name + '.png')
        if (existsSync(f)) copyFileSync(f, join(proj, 'tuto', name + '.png'))
      }
    }

    const fontsSrc = join(HERE, 'assets', 'fonts')
    if (existsSync(fontsSrc)) {
      mkdirSync(join(proj, 'fonts'), { recursive: true })
      for (const f of readdirSync(fontsSrc)) copyFileSync(join(fontsSrc, f), join(proj, 'fonts', f))
    }

    // DERNIER MOT SUR LES BRUITAGES. Le serveur verrouille deja chaque son sur un
    // visuel, mais il ne sait pas que le rendu vient d'ECARTER des images trop
    // basse resolution : leur son restait alors seul sur un ecran fixe — le
    // « bruitage sans animation » qu'Axel entend. On refait donc le calcul ici,
    // avec la liste reelle de ce qui sera affiche.
    {
      const shown = [
        ...(plan.broll || []).filter((b) => assetFiles[b.assetId]).map((b) => b.start),
        ...(plan.slides || []).filter((sl) => sl.emoji || sl.anim || (sl.items || []).length || sl.title)
          .map((sl) => sl.start),
      ].filter((t) => typeof t === 'number')
      const before = (plan.sfx || []).length
      plan.sfx = shown.length
        ? (plan.sfx || []).filter((x) => shown.some((e) => Math.abs(e - x.t) <= 0.35))
        : []
      if (before !== plan.sfx.length) {
        console.log(`▶ ${before - plan.sfx.length} bruitage(s) retiré(s) : plus aucun visuel à cet instant`)
      }
    }

    writeFileSync(join(proj, 'index.html'), buildComposition(plan, { assetFiles, avatarClips, logoFile: jobLogo ? 'brand/logo' + extname(jobLogo) : '' }))
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
    // voix = piste audio de base.mp4 ; #119 en lipsync segmenté le gameplay peut être
    // muet → on saute la voix (le mix continue avec SFX/musique) plutôt que de planter
    const baseHasAudio = !!ffprobe(basePath, 'stream=codec_type').split('\n').some((l) => l.trim() === 'audio')
    const inputs = ['-i', visual, '-i', basePath]
    const filters = []
    const mixIns = []
    let idx = 2

    if (baseHasAudio) {
      // LA VOIX EST NORMALISÉE SEULE, et pas dans le mix : un loudnorm sur le
      // mélange rabaissait TOUT dès qu'on ajoutait un bruitage.
      //
      // …mais on ne la re-comprime pas non plus. Le nettoyage audio de l'app la
      // livre déjà masterisée (EQ + compresseur + limiteur, -14 LUFS) ; repasser
      // loudnorm par-dessus lui reprenait ~3 dB à chaque rendu — la vidéo sortait
      // à -17,6 LUFS, plus faible que le reste du fil, et les bruitages semblaient
      // avoir disparu avec elle. On MESURE donc sa sonie et on applique le gain
      // statique qui manque, sans toucher à sa dynamique.
      //
      // Une source BRUTE (dictaphone, clip filmé sans nettoyage) reste confiée à
      // loudnorm : elle a besoin d'être recalée en dynamique, pas seulement en
      // gain. Le raccourci ne s'applique qu'à une voix déjà dans la cible (±2,5 dB).
      const lufs = loudnessOf(basePath)
      const gain = lufs == null ? null : -14 - lufs
      if (gain != null && Math.abs(gain) <= 2.5) {
        console.log(`▶ voix déjà masterisée (${lufs.toFixed(1)} LUFS) → gain ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB, pas de re-compression`)
        filters.push(`[1:a]apad=whole_dur=${plan.duration}${Math.abs(gain) > 0.2 ? `,volume=${gain.toFixed(2)}dB` : ''}[voice]`)
      } else {
        if (lufs != null) console.log(`▶ voix brute (${lufs.toFixed(1)} LUFS) → loudnorm`)
        filters.push(`[1:a]apad=whole_dur=${plan.duration},loudnorm=I=-14:TP=-2:LRA=9[voice]`)
      }
      mixIns.push('[voice]')
    }

    const mood = plan.music && plan.music.mood
    const pick = mood ? pickMusic(mood, plan.duration || 1) : null
    if (pick && existsSync(pick.file)) {
      // départ QUELCONQUE dans le morceau (pick.start) : ce sont des titres
      // entiers, on ne veut pas toujours entendre la même intro. -ss avant -i
      // fait le saut au décodage ; la boucle couvre le cas où le reste du
      // morceau serait plus court que la vidéo, et l'afade coupe à la fin.
      if (pick.start > 0) inputs.push('-ss', String(pick.start))
      inputs.push('-stream_loop', '-1', '-i', pick.file)
      filters.push(`[${idx}:a]atrim=0:${plan.duration},asetpts=PTS-STARTPTS,volume=${pick.vol},afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, plan.duration - 1.2)}:d=1.2[mus]`)
      mixIns.push('[mus]')
      idx++
      console.log(`▶ musique : ${pick.name || 'preset'} à partir de ${(pick.start || 0).toFixed(0)} s`)
    }

    for (const s of plan.sfx || []) {
      const f = join(HERE, 'assets', 'sfx', `${s.kind}.mp3`)
      if (!existsSync(f)) continue
      inputs.push('-i', f)
      const ms = Math.max(0, Math.round(s.t * 1000))
      // s.vol : le moteur dynamique baisse ses sons de ponctuation (une poussée
      // s'entend à moitié, un clic à peine) — un bruitage plein volume sur chaque
      // geste rendait la piste répétitive et écrasait la voix.
      filters.push(`[${idx}:a]adelay=${ms}|${ms},volume=${typeof s.vol === 'number' ? s.vol : SFX_VOL}[s${idx}]`)
      mixIns.push(`[s${idx}]`)
      idx++
    }

    // SON DE FRAPPE sous l'animation `type` : le texte s'écrit tout seul à l'écran,
    // on entend le clavier. Il est lié à l'ANIMATION, pas au plafond de 3 bruitages
    // de ponctuation — c'est une texture qui accompagne une image, pas un coup qui
    // souligne un instant. Le fichier mac-typing est enregistré bas (moyenne −33 dB,
    // pics à −3,9) : à moitié volume il disparaissait sous la voix, d'où le gain.
    // clavier explicite : le plan peut demander une frappe a un instant precis
    // (quand il DICTE son prompt a l'ecran), independamment de l'animation `type`.
    const kbSpots = [
      ...(plan.keyboard || []).map((k) => ({ start: k.t, end: k.t + (k.dur || 1.6) })),
      ...(plan.slides || []).filter((sl) => sl.anim === 'type').map((sl) => ({ start: sl.start, end: sl.end })),
  // BRUIT DU CLAVIER quand le texte s'ecrit dans le champ de l'app (Axel : « le
  // bruit du clavier doit se mettre et le texte doit s'ecrire dans la zone de
  // texte d'avatarads en meme temps que l'audio »).
  ...(plan.slides || []).filter((sl) => sl.anim === 'screen' && sl.screenText).map((sl) => ({ start: sl.start + 0.6, end: Math.min(sl.end - 0.2, sl.start + 0.6 + String(sl.screenText).length * 0.045) })),
    ]
    if (kbSpots.length) console.log('⌨️  frappes clavier :', kbSpots.map((k) => k.start.toFixed(1) + '-' + k.end.toFixed(1)).join(' · '))
    for (const sl of kbSpots) {
      const f = join(HERE, 'assets', 'sfx', 'mac-typing.mp3')
      if (!existsSync(f)) continue
      // PAS DE PLAFOND. Il y en avait un à 2,6 s, hérité de l'époque où la frappe
      // n'était pas bouclée : sur un prompt de 7 s le son s'arrêtait au tiers et
      // le texte continuait de s'écrire en silence (c'est ce qu'Axel entendait
      // entre 15 s et 22 s). La boucle gère maintenant n'importe quelle durée.
      const dur = Math.max(0.6, (sl.end - sl.start) - 0.15)
      const ms = Math.max(0, Math.round((sl.start + 0.15) * 1000))
      inputs.push('-stream_loop', '-1', '-i', f)
      // 0.3 et pas SFX_VOL×1.1 : à ~0.94 le lit de frappe pesait dans le loudnorm
      // global qui BAISSAIT toute la piste — la voix d'Axel « se dégradait » à
      // chaque passage tapé. La frappe est une texture, pas un premier plan.
      // aloop AVANT atrim : le fichier de frappe est plus court que la plupart des
      // passages tapés, donc sans boucle le son s'arrêtait au bout de 2 s pendant
      // que le texte continuait de s'écrire (« le bruitage du clavier doit rester
      // tout le long », Axel). aloop=-1 le répète, atrim coupe à la bonne durée.
      filters.push(`[${idx}:a]aloop=loop=-1:size=2e9,atrim=0:${dur.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=out:st=${Math.max(0, dur - 0.12).toFixed(2)}:d=0.12,adelay=${ms}|${ms},volume=0.45[kb${idx}]`)
      mixIns.push(`[kb${idx}]`)
      idx++
    }

    // lits musicaux : posés à leur instant, coupés à la fin de la vidéo, fondus en sortie
    for (const b of plan.beds || []) {
      if (!BEDS.includes(b.name)) continue
      const f = join(HERE, 'assets', 'music', `bed-${b.name}.mp3`)
      if (!existsSync(f)) continue
      const at = Math.max(0, Math.min(b.t || 0, plan.duration - 0.5))
      const room = plan.duration - at            // ce qu'il reste de vidéo après le point de pose
      if (room < 1) continue
      inputs.push('-i', f)
      const ms = Math.round(at * 1000)
      filters.push(`[${idx}:a]atrim=0:${room.toFixed(2)},asetpts=PTS-STARTPTS,volume=${BED_VOL},afade=t=out:st=${Math.max(0, room - 0.7).toFixed(2)}:d=0.7,adelay=${ms}|${ms}[b${idx}]`)
      mixIns.push(`[b${idx}]`)
      idx++
    }

    if (!mixIns.length) {
      // aucune piste audio (base muet + ni musique ni SFX) → vidéo seule
      console.log('▶ aucun audio à mixer → vidéo seule')
      // +faststart : sans lui l'atome moov reste en FIN de fichier, et les apps
      // mobiles (YouTube, Instagram) refusent d'importer — « Impossible d'exporter
      // la vidéo ». Toutes les vidéos sortaient ainsi.
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', visual, '-map', '0:v',
        '-c:v', 'copy', '-an', '-t', String(plan.duration),
        '-movflags', '+faststart', outPath], { stdio: 'inherit' })
    } else {
      // NORMALISATION DE SONIE. Un rendu sortait a -22,3 LUFS quand les plateformes
      // calent sur -14 : la video s'entend deux fois moins fort que celle d'avant dans
      // le fil, et le spectateur scrolle au lieu de monter le son. loudnorm ramene la
      // sonie integree a -14 LUFS avec un vrai pic a -1,5 dBTP (pas d'ecretage).
      // Sortie en STEREO : une piste mono est repliee au centre par certains lecteurs.
      // Plus de loudnorm sur le MIX (c'est lui qui faisait plonger la voix sous les
      // bruitages) : la voix arrive déjà à -14 LUFS, les bruitages sont posés à
      // leur volume, et un simple limiteur retient les crêtes sans toucher aux
      // niveaux relatifs. La sonie plateforme est donc portée par la voix seule.
      filters.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=first:normalize=0,alimiter=limit=0.89:level=disabled,aformat=channel_layouts=stereo[aout]`)
      console.log(`▶ mix audio (${mixIns.length} pistes)…`)
      execFileSync('ffmpeg', [
        '-v', 'error', '-y', ...inputs,
        '-filter_complex', filters.join(';'),
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-t', String(plan.duration),
        // métadonnées en TÊTE : indispensable pour l'import mobile (cf. ci-dessus)
        '-movflags', '+faststart',
        outPath,
      ], { stdio: 'inherit' })
    }

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
        for (const a of job.assets || []) {
          // extension du chemin (as-x.jpg / as-x.mp4) — les b-roll peuvent être des clips
          const ext = (String(a.path).match(/\.(\w{2,4})$/) || [])[1] || 'jpg'
          await dl(a.path, join(jobDir, 'assets', a.id + '.' + ext))
        }
        // #119 · scènes avatar : téléchargées comme av0.mp4, av1.mp4… (ordre = plan.avatarSegments)
        const avClips = job.avatar_clips || []
        if (avClips.length) {
          mkdirSync(join(jobDir, 'avatar'), { recursive: true })
          for (let i = 0; i < avClips.length; i++) await dl(avClips[i], join(jobDir, 'avatar', 'av' + i + '.mp4'))
        }

        const out = join(jobDir, 'final.mp4')
        await renderJob(jobDir, out)

        const outKey = `${job.user_id}/${job.id}.mp4`
        const { error: upErr } = await sb.storage.from('render-media')
          .upload(outKey, readFileSync(out), { contentType: 'video/mp4', upsert: true })
        if (upErr) throw new Error('upload: ' + upErr.message)
        // bucket privé : on stocke le PATH ; l'edge render-job signe l'URL à la demande
        await sb.from('render_jobs').update({ status: 'done', output_url: outKey, updated_at: new Date().toISOString() }).eq('id', job.id)
        console.log('✅ job', job.id, '→', outKey)
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
