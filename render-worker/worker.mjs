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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, readdirSync, statSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ANIM_EMOJI_SET } from './anim-pack.mjs'
import { join, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildComposition } from './build-composition.mjs'
// EXIGE_GLOBAL et ANIMS voyagent avec la dérivation : la passe de finition doit
// juger une correction avec EXACTEMENT le même garde-fou que le reste de la
// chaîne, sinon elle rouvrirait par la fenêtre ce qu'on ferme à la porte.
import { deriveDynamicSlides, EXIGE_GLOBAL as EXIGE_FINITION, ANIMS as ANIMS_DISPO } from './dynamic-derive.mjs'
import { deriveClassicSlides } from './classic-derive.mjs'
import { cleLipsync, cacheLire, cacheEcrire, HEDRA_CR_SEC } from './lipsync-cache.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const r2 = (n) => Math.round(n * 100) / 100
const HYPERFRAMES = 'hyperframes@0.7.60' // épinglé : mêmes rendus dans le temps
// Sur Railway, la CLI vit DANS l'image (node_modules du worker) et y est
// PATCHÉE au build : la 0.7.60 avale les erreurs d'extraction vidéo, le patch
// (patch-hyperframes.mjs) les loggue enfin. npx n'est que le repli local — si
// on le laissait tourner sur Railway, il téléchargerait une copie NON patchée
// et on perdrait le diagnostic. Guillemets sur le chemin : celui d'Axel
// contient une espace (« Autre SaaS »).
const HF_BIN = join(HERE, 'node_modules', '.bin', 'hyperframes')
const HF_CMD = existsSync(HF_BIN) ? JSON.stringify(HF_BIN) : `npx -y ${HYPERFRAMES}`

// ── LA CADENCE DE TOUTE LA CHAÎNE ───────────────────────────────────────────
// 50, et pas 30 ni 60. Deux raisons, toutes les deux mesurées le 02/08 :
//   ① le visage. Hedra sort en 25 fps. 50 en est le double EXACT, donc chaque
//      image du lipsync est tenue deux trames, toujours — aucune image
//      inventée, aucun accroc. À 30 il faut en fabriquer une sur six, à 60 une
//      sur trois, et dans les deux cas le motif est irrégulier.
//   ② les animations. À 30 fps le moteur produit 25 images réellement
//      distinctes par seconde ; à 50 il en produit 46. Le motion design est
//      quasiment deux fois mieux échantillonné — c'est LE gain visible sur la
//      qualité perçue, et le fichier final n'est pas plus lourd (plus
//      d'images, mais plus de redondance entre elles : 36,3 Mo contre 35,9).
// Prix : +47 % de temps de rendu (1 min 23 → 2 min 01 sur un montage de 44 s).
// Le brouillon reste à 30 : il ne sert qu'à valider un placement.
const FPS = 50
const FPS_DRAFT = 30
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
const MUSIC_TARGET_LUFS = -20

// banque extensible : dépose des `assets/music/<mood>-1.mp3`, `<mood>-2.mp3`, … et ils
// entrent dans la rotation du mood (choix stable par durée de vidéo, pour varier entre vidéos)
function pickMusic(mood, seed) {
  const dir = join(HERE, 'assets', 'music')
  // BIBLIOTHÈQUE (assets/music/lib) : les instrumentaux « viraux » d'Axel, déjà
  // ROGNÉS sur leur partie dynamique (départ sur le drop, ≤90 s — cf app/index.html
  // AA_MUSIC `dyn`). On démarre donc à 0 (« commence par la partie dynamique »,
  // demande d'Axel du 11/08) ; le mix coupe à la fin de la vidéo (afade en sortie).
  // Le tirage est pseudo-aléatoire mais DÉTERMINISTE (graine = durée de la
  // vidéo) : deux rendus du même montage donnent la même musique, sinon un
  // re-rendu changerait la bande-son sans prévenir.
  try {
    const lib = readdirSync(join(dir, 'lib')).filter((f) => f.endsWith('.mp3'))
    if (lib.length) {
      const s = Math.abs(Math.round(seed * 1000))
      const f = lib.sort()[s % lib.length]
      const file = join(dir, 'lib', f)
      // clips déjà coupés au drop → on part du début, pas d'offset aléatoire
      const start = 0
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

// ── UNE COMMANDE QUI ÉCHOUE DOIT DIRE POURQUOI ──────────────────────────────
// Mesuré le 03/08 sur un job perdu : le rendu a planté et tout ce qu'on a gardé
// était « Command failed: npx -y hyperframes render … ». La vraie erreur était
// partie sur la sortie d'erreur du processus enfant, que `stdio:'inherit'`
// envoie directement dans Railway — donc hors de la trace, donc perdue.
// On garde la sortie standard en direct (la progression du rendu reste
// lisible) et on CAPTE la sortie d'erreur, pour la recracher dans la trace au
// moment où ça casse. Quarante dernières lignes : une erreur Node arrive avec
// sa pile (~10 lignes) SOUS le message — à douze lignes, la pile poussait
// parfois la cause hors du cadre.
function sh(cmd, cwd, extraEnv = {}) {
  try {
    // ── LE CACHE D'EXTRACTION D'HYPERFRAMES RESTE COUPÉ ─────────────────────
    // Il ne rapporte rien ici (le dossier de job change à chaque rendu, donc
    // jamais un hit — « cacheMisses: 6 » à chaque run) et son ramasse-miettes
    // (budget 2 Go dans /tmp) sait évincer une entrée EN PLEIN rendu. Mais le
    // couper n'a PAS éteint les « captured 0 of expected N frames » du 08/08 :
    // la vraie mécanique est au rendu visuel (voir renderJob) — une extraction
    // qui échoue est AVALÉE en silence par la CLI, et le garde de couverture
    // la déguise en clip fantôme. Sans cache on a une cause de moins, c'est
    // tout ; le patch de l'image et la relance font le reste.
    execSync(cmd, {
      cwd, stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, HYPERFRAMES_EXTRACT_CACHE_DIR: 'off', ...extraEnv },
    })
  } catch (e) {
    const err = String((e && e.stderr) || '').trim()
    if (err) console.error('✗ ' + cmd.slice(0, 90) + ' →\n' + err.split('\n').slice(-40).join('\n').slice(0, 4000))
    throw e
  }
}
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
    // Une voix ne mesure JAMAIS 0,0 LUFS ni quoi que ce soit au-dessus de
    // -5 : c'est la valeur qu'ebur128 rend quand la mesure a échoué (piste
    // vide, fichier trop court, démux raté). Le montage de prod du 30/07
    // affichait « voix brute (0.0 LUFS) → loudnorm » — un capteur cassé qui
    // envoyait TOUTES les voix, même déjà calées, vers la renormalisation
    // dynamique. Mesure invalide = capteur muet, pas une fausse lecture.
    if (!Number.isFinite(v) || v >= -5) return null
    return v
  } catch (_) { return null }
}

// ── cœur : job (dossier local) → MP4 final ──
// ── Motion Control · composition split (#34) ────────────────────────────────
// Empile l'original et le clip motion en 1080×1920 SANS passer par le montage.
// Chaque panneau : cover-crop 1080×960 biaisé vers le haut (0.3) pour garder les
// visages hauts, hors de la zone de légende/boutons TikTok. L'audio vient de
// l'original (la voix qui a piloté le mouvement). input 0 = base.mp4 (original),
// input 1 = assets/motion.mp4. mode 'split-top' = motion en haut, sinon original.
function composeMotionSplit(jobDir, outPath, plan) {
  const orig0 = join(jobDir, 'base.mp4')
  const motion = join(jobDir, 'assets', 'motion.mp4')
  if (!existsSync(motion)) throw new Error('clip motion manquant (assets/motion.mp4)')
  // ⚠ VIDÉO TÉLÉPHONE : une vidéo filmée à l'iPhone embarque souvent un 3e flux
  // DATA (métadonnées « mebx », codec « none ») que ffmpeg REFUSE de décoder
  // (« Decoder (codec none) not found for input stream #0:2 ») → le split
  // échouait TOUJOURS sur ces sources, d'où le repli plein écran systématique.
  // On remuxe la source en VIDÉO+AUDIO seulement (le flux data est écarté) avant
  // la composition. Copie d'abord (rapide) ; ré-encodage léger en repli.
  const orig = join(jobDir, 'base-av.mp4')
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', orig0, '-map', '0:v:0', '-map', '0:a?',
      '-c', 'copy', '-movflags', '+faststart', orig], { stdio: 'pipe' })
  } catch (_) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', orig0, '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', orig], { stdio: 'pipe' })
  }
  const mode = plan.mode === 'split-top' ? 'split-top' : 'split-bottom'
  const pan = 'scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:(iw-1080)/2:(ih-960)*0.3,setsar=1'
  const top = mode === 'split-top' ? 1 : 0   // split-top → motion (input 1) en haut
  const bot = mode === 'split-top' ? 0 : 1
  const fc = `[${top}:v]${pan}[t];[${bot}:v]${pan}[b];[t][b]vstack=inputs=2[v]`
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ignore_unknown', '-i', orig, '-i', motion,
      '-filter_complex', fc, '-map', '[v]', '-map', '0:a?',
      '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest',
      '-movflags', '+faststart', outPath], { stdio: 'pipe' })
  } catch (e) {
    const err = (e.stderr ? e.stderr.toString() : '') || String(e.message || e)
    throw new Error('motion-split ffmpeg : ' + err.trim().slice(-300))
  }
  console.log(`✅ motion-split (${mode}) → ${outPath}`)
}

export async function renderJob(jobDir, outPath, { draft = false } = {}) {
  const t0 = Date.now()
  const plan = JSON.parse(readFileSync(join(jobDir, 'plan.json'), 'utf8'))

  // Motion Control (#34) : composition légère original + motion, pas de montage.
  if (plan.__compose === 'motion-split') { composeMotionSplit(jobDir, outPath, plan); return }

  const basePath = join(jobDir, 'base.mp4')
  if (!existsSync(basePath)) throw new Error('base.mp4 manquant dans ' + jobDir)

  // durée réelle de la vidéo de base = source de vérité
  const baseDur = parseFloat(ffprobe(basePath, 'format=duration')) || plan.duration || 10
  plan.duration = Math.round(Math.min(plan.duration || baseDur, baseDur) * 100) / 100

  // Une base sans piste vidéo (montage parti d'un MP3) ne mérite pas de
  // sous-couche : le worker lui fabrique un fond noir, l'empiler n'ajouterait
  // qu'un décodage pour rien. Le drapeau vit ICI, dans la portée de renderJob —
  // `baseW` est mesuré dans un bloc interne et n'y est pas visible.
  let baseAUneImage = false

  // ── 1. projet HyperFrames temporaire ──
  const proj = mkdtempSync(join(tmpdir(), 'aa-render-'))
  try {
    mkdirSync(join(proj, 'media'), { recursive: true })
    // La base arrive telle quelle du navigateur (remux instantané, souvent 540×960) :
    // c'est ICI qu'on la met au format de rendu — ffmpeg natif fait en ~2 s ce qui
    // prenait des minutes en WASM côté client. On ne touche pas à l'audio (la voix).
    const baseOut = join(proj, 'media', 'base.mp4')
    let baseW = 0, baseH = 0
    // retenu pour plus bas : une base sans image ne mérite pas de sous-couche
    try { const d = ffprobe(basePath, 'stream=width,height').split(','); baseW = parseInt(d[0], 10) || 0; baseH = parseInt(d[1], 10) || 0 } catch (_) { /* probe optionnel */ }
    baseAUneImage = baseW > 0
    if (!baseW) {
      // job AUDIO SEUL (Montage IA via MCP : pas de clip filmé) → fond noir 1080×1920,
      // les slides du plan couvrent l'écran de toute façon (style dynamic & co)
      console.log('▶ base sans piste vidéo (audio seul) → fond noir 1080×1920')
      execFileSync('ffmpeg', ['-v', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=black:s=1080x1920:r=${FPS}`, '-i', basePath,
        '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', baseOut])
    } else if (baseW === 1080 && baseH === 1920) copyFileSync(basePath, baseOut)
    else {
      console.log(`▶ base ${baseW}×${baseH} → 1080×1920 (ffmpeg natif)…`)
      try {
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', basePath,
          '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${FPS}`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
          '-c:a', 'copy', baseOut])
      } catch (e) {
        console.warn('normalisation base impossible, on garde l\'original :', e.message)
        copyFileSync(basePath, baseOut)
      }
    }

    const assetFiles = {}
    // ── LA FORME DU MÉDIA DÉCIDE DE SA PLACE ────────────────────────────
    // Un média PAYSAGE (capture d'écran, démo d'app) posé en petit médaillon
    // est illisible : Axel, en voyant sa démo AvatarAds×Claude à côté du
    // visage — « on ne voit pas le mp4, laisse dans sa forme actuelle
    // plutôt ». Un portrait (une personne qui parle) tient très bien en
    // médaillon, lui. On remonte donc les dimensions à la dérivation, qui
    // tranche entre médaillon et plein cadre.
    const assetDims = {}
    const mesure = (f) => {
      try {
        const out = String(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', f])).trim().split('x')
        const w = Number(out[0]) || 0, h = Number(out[1]) || 0
        return w && h ? { w, h } : null
      } catch (_) { return null }
    }
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
            assetDims[id] = mesure(src)
          } catch (e) {
            // clip illisible → première frame en JPEG, le rendu ne doit pas échouer
            try {
              execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-q:v', '3', join(proj, 'media', id + '.jpg')])
              assetFiles[id] = 'media/' + id + '.jpg'
              assetDims[id] = mesure(src)
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
            assetDims[id] = mesure(src)
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
          // LE VISAGE MÉRITE LE MEILLEUR ENCODEUR. Ce clip est ré-encodé une
          // fois avant compositing, puis recompressé par Instagram/TikTok :
          // chaque génération perdue se voit sur la peau. `slow` + crf 18 coûte
          // quelques secondes de rendu et tient bien mieux la recompression.
          //
          // ── POURQUOI 50 ET PAS 30 (mesuré le 02/08) ───────────────────────
          // Hedra livre du 25 fps. En visant 30, ffmpeg doit fabriquer 5 images
          // sur 30 : sur 4 s de clip, 81 images sont tenues une trame et 20
          // deux — un motif IRRÉGULIER, et c'est exactement ce que l'oeil lit
          // comme un micro-accroc sur le visage. En visant 50, chaque image
          // source est tenue exactement 2 trames, 100 fois sur 101 : la
          // cadence est un multiple entier de la source, il n'y a plus rien à
          // inventer. (60 serait PIRE que 30 : 25→60 donne 60 tenues de 2 et
          // 40 de 3, soit 40 % d'irrégularité contre 20 %.)
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(avatarDir, f),
            '-vf', `scale='min(1080,iw)':-2,fps=${FPS}`, '-an',
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-g', String(FPS),
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
        // ⚠️ l'indice d'origine se fige ICI, avant le filtre trois lignes plus
        // bas : une fenêtre jetée (clip trop court) décalait toutes les
        // suivantes d'un cran, et chacune jouait le clip lipsync de sa voisine.
        // La dérivation et le remap post-dérivation lisent `w.clip` en priorité.
        const tag = { ...w, clip: w.clip ?? i }
        const src = avatarClips['av' + i]
        if (!src) return tag
        let dur = 0
        try {
          dur = Number(String(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
            'format=duration', '-of', 'csv=p=0', join(proj, src)])).trim()) || 0
        } catch (_) { return tag }
        const end = Math.min(w.end ?? (w.start + dur), w.start + dur)
        if (end < (w.end ?? 0) - 0.05) console.log(`▶ fenêtre avatar ${i} bornée à ${end.toFixed(2)}s (durée du clip)`)
        return { ...tag, end }
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
    // ── LA PHOTO D'AVATAR, ET LE CAS OÙ IL N'Y EN A AUCUNE ────────────────────
    // Le job peut fournir `avatar.png` : c'est SON visage, celui qui s'affiche
    // quand une fenêtre avatar n'a pas de clip lipsync. Sans ce fichier le
    // moteur retombait sur `tuto/hook-qualite.png`, une photo de démo livrée
    // avec le worker — le visage d'un inconnu en plein écran sur la vidéo d'un
    // client. Et si le job n'a NI clip, NI photo, NI image dans sa base (montage
    // sur audio seul), on supprime les fenêtres avatar : la dérivation remplit
    // alors ces secondes avec des animations, ce qui vaut mieux qu'un écran noir.
    let avatarPhoto = ''
    // ── LE POOL D'AVATARS : UNE IMAGE ≠ À CHAQUE FENÊTRE (#84) ─────────────────
    // Axel (Cartoon 20) : « à 40 s l'avatar n'a pas changé, il faut qu'il
    // change ». Le job peut fournir plusieurs visages du MÊME perso :
    // `avatar.png` (le principal, celui du hook) et `avatar-1.png`,
    // `avatar-2.png`… La dérivation posée, on répartit ces images sur les
    // fenêtres qui montrent la PHOTO (pas un clip lipsync) — une différente à
    // chaque fois, jamais deux fois de suite. Une seule image = comme avant.
    const avatarPool = []
    const chargePhoto = (src, dest) => {
      try {
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src,
          '-vf', "scale='min(1080,iw)':-2", join(proj, 'media', dest)])
        return 'media/' + dest
      } catch (e) { console.warn('photo avatar illisible :', e.message); return '' }
    }
    for (const n of ['avatar.png', 'avatar.jpg', 'avatar.jpeg', 'avatar.webp']) {
      if (!existsSync(join(jobDir, n))) continue
      avatarPhoto = chargePhoto(join(jobDir, n), 'avatar.png')
      if (avatarPhoto) avatarPool.push(avatarPhoto)
      break
    }
    // images supplémentaires : avatar-1.png, avatar-2.png… à la racine du job
    // (l'app les enverra depuis « Ma marque » ; en local on les dépose à la main)
    if (avatarPhoto) {
      const extra = readdirSync(jobDir).filter((f) => /^avatar-\d+\.(png|jpe?g|webp)$/i.test(f)).sort()
      for (const f of extra) {
        const rel = chargePhoto(join(jobDir, f), f.replace(/\.(jpe?g|webp)$/i, '.png'))
        if (rel) avatarPool.push(rel)
      }
      if (avatarPool.length > 1) console.log(`▶ pool avatar : ${avatarPool.length} visages (rotation par fenêtre)`)
    }
    // ── #42 · LE LIPSYNC, SCÈNE PAR SCÈNE ────────────────────────────────────
    // Axel : « il faut qu'il appelle l'API Hedra pour le faire, et faut qu'il
    // génère scène par scène, pas tout l'audio ». L'app le fait déjà ainsi ; le
    // chemin MCP posait une image fixe. C'est ici que ça se répare, et pas dans
    // l'edge function : découper l'audio demande ffmpeg, que seul le worker a.
    // On ne génère QUE sur les fenêtres `avatarSegments` — c'est ce qui rend le
    // coût tenable (1,5 cr/s sur 12 s de visage, pas sur 50 s de vidéo).
    if (plan.__lipsync) console.log(`▶ lipsync demandé — photo ${avatarPhoto ? 'oui' : 'NON'}, clips existants ${Object.keys(avatarClips).length}, fenêtres ${(plan.avatarSegments || []).length}`)
    // #84 · LE LIPSYNC SE GÉNÈRE APRÈS LA DÉRIVATION (voir plus bas). Avant, on
    // le générait ICI sur les 7 fenêtres du chef d'orchestre — puis la dérivation
    // n'en gardait que 2 (hook + CTA) : 5 clips payés jamais montrés, et les
    // fenêtres créées par la dérivation (trou, adresse) sans clip à elles (photo
    // figée, ou clip d'une AUTRE tranche réutilisé = lèvres décalées à 40 s).
    // Axel : « il faut générer que pour les fenêtres gardées ». On attend donc que
    // la dérivation ait tranché QUELLES fenêtres montrent le visage.

    // `noFace` : vider `avatarSegments` ne suffisait pas — la dérivation en
    // recréait juste après (adresse directe, respiration, trou comblé) et chacune
    // retombait sur la photo de démo. Il faut le lui DIRE.
    const noFace = !baseW && !avatarPhoto && !Object.keys(avatarClips).length
    if (noFace && (plan.avatarSegments || []).length) {
      console.log(`▶ aucun visage disponible → ${plan.avatarSegments.length} fenêtre(s) avatar retirée(s)`)
      plan.avatarSegments = []
    }

    // ⚠️ dériver AVANT de lister les captures : la dérivation #148 ajoute des scènes
    // ui avec screen:'site-home' & co — sans ça leurs images ne sont jamais copiées
    // (l'engine re-saute la dérivation quand les scènes ui existent déjà)
    // apple partage le moteur du dynamique (cf. build-composition) : il partage
    // donc aussi sa dérivation, pas celle des styles posés sur une base.
    if (plan.slideStyle === 'dynamic' || plan.slideStyle === 'apple') {
      // assetFiles : sans lui la dérivation ne voit pas les médias de l'utilisateur
      // ── LA TRANSCRIPTION ÉCRIT CE QU'ELLE ENTEND, PAS CE QUI S'ÉCRIT ──
      // Scribe rend « Sasia » pour « SaaS IA ». Le mot part tel quel dans les
      // sous-titres, donc à l'écran, sous le visage d'Axel, avec une faute sur
      // le nom de son propre produit. On corrige AVANT la dérivation : les
      // scènes se calent alors sur le mot juste, et le sous-titre l'affiche bien.
      // Table ouverte : y ajouter chaque nom propre que la transcription rate.
      const ORTHO = [[/\bsas+ia\b/gi, 'SaaS IA'], [/\bsaas\s*ia\b/gi, 'SaaS IA'],
        [/\bavatar\s*ads\b/gi, 'AvatarAds']]
      let corr = 0
      for (const c of plan.captions || []) {
        const avant = String(c.text || '')
        let apres = avant
        for (const [re, bon] of ORTHO) apres = apres.replace(re, bon)
        if (apres !== avant) { c.text = apres; corr++ }
      }
      if (corr) console.log(`▶ orthographe : ${corr} mot(s) corrigé(s) dans les sous-titres`)
      // hasClips : la dérivation doit savoir si des clips lipsync existent déjà.
      // Sans clip (photo d'avatar, ou découpe de base.mp4), elle a le droit
      // d'avancer la première fenêtre avatar jusqu'à 0 pour garantir le hook ;
      // avec des clips, avancer la fenêtre ferait mentir les lèvres — la
      // garantie vient alors d'orchestrate, avant la génération des clips.
      try { deriveDynamicSlides(plan, { assetFiles, assetDims, noFace, hasClips: Object.keys(avatarClips).length > 0 }); plan.__derive = true } catch (e) { console.warn('dérivation:', e.message) }
      // #24 · et maintenant il RELIT sa copie, sur le montage réel
      try { await passeDeFinition(plan) } catch (e) { console.warn('finitions:', e.message) }
      // fenêtres 'G*' : un clip que la dérivation VEUT mais qu'aucun existant ne
      // couvre (« la photo figée lit comme un bug ») — généré ici, cache compris
      if (avatarPhoto) {
        try { const g = await genererFenetresG(plan, proj, jobDir, avatarClips); if (g) console.log(`▶ ${g} fenêtre(s) générée(s) après dérivation`) }
        catch (e) { console.warn('fenêtres G :', e.message) }
      }
      // ── ROTATION DES VISAGES SUR LES FENÊTRES-PHOTO (#84) ────────────────────
      // Chaque fenêtre qui montrera la PHOTO (pas un clip lipsync généré) pioche
      // l'image suivante du pool — le hook prend la 1re, la fenêtre d'après la
      // 2e, etc. Déterministe (ordre chronologique) : un re-rendu retombe sur les
      // mêmes visages. Le moteur lit `w.photo` (dynamic-engine : « photo prime »).
      if (avatarPool.length > 1) {
        const montrePhoto = (w) => !existsSync(join(proj, 'media', 'av' + w.clip + '.mp4'))
        const wins = (plan.avatarSegments || []).filter(montrePhoto)
          .sort((a, b) => (a.start || 0) - (b.start || 0))
        wins.forEach((w, k) => { w.photo = avatarPool[k % avatarPool.length] })
        if (wins.length) console.log(`▶ rotation avatar : ${wins.length} fenêtre(s)-photo sur ${avatarPool.length} visage(s)`)
      }
      // #84 · LIPSYNC ICI, APRÈS QUE LA DÉRIVATION A TRANCHÉ. Chaque fenêtre
      // gardée (hook, respiration, trou comblé, adresse, CTA) est lipsyncée sur
      // SA tranche exacte et SON image (rotation) — zéro clip gaspillé, aucune
      // scène oubliée, plus de clip décalé réutilisé. La visite guidée n'a pas de
      // fenêtre avatar : le visage ne parle donc QUE hors tutoriel.
      if (plan.__lipsync && avatarPhoto && !Object.keys(avatarClips).length) {
        try { const n = await genererLipsync(plan, proj, jobDir, avatarClips); if (n) console.log(`▶ lipsync : ${n} scène(s) générée(s) chez Hedra (fenêtres gardées)`) }
        catch (e) { console.warn('lipsync :', e.message) }
      }
    }
    // …et les styles classiques (editorial, glass, word) reçoivent les mêmes
    // corrections côté DONNÉE : captures cadrées sur l'élément nommé, mot
    // affiché = mot prononcé, animation ancrée sur le mot qui la justifie.
    else { try { deriveClassicSlides(plan) } catch (e) { console.warn('dérivation classique:', e.message) } }

    // ── PAS DE CLIP LIPSYNC ? ON DÉCOUPE SA PROPRE VIDÉO ───────────────────────
    // Sans clips, le moteur affichait `tuto/hook-qualite.png` — une photo de démo
    // livrée avec le worker, l'homme au bord de la piscine. Sur la vidéo d'un
    // client, ça met le VISAGE D'UN INCONNU en plein écran pendant sa fenêtre
    // avatar. Axel l'a vu : « tu parles de quel homme au bord de la piscine ? »
    //
    // La bonne source était là depuis le début : base.mp4 EST sa vidéo, la voix
    // qu'on entend est la sienne, et la fenêtre avatar est justement le moment où
    // il parle face caméra. On y découpe donc le morceau correspondant — même
    // instant, même personne, synchro par construction et gratuit.
    // APRES LA DERIVATION, et pas avant : c'est elle qui fixe les fenetres finales
    // (elle en ajoute, en scinde, en etire). Decoupees trop tot, les fenetres
    // etirees demandaient plus d'images que le clip n'en contenait et HyperFrames
    // refusait le rendu : « captured 72 of expected 116 frames ».
    // (…sauf sur un job AUDIO SEUL : la base y est un fond noir fabriqué, il n'y a
    //  aucun visage à découper — `baseW` vaut 0 dans ce cas.)
    let coupesDepuisBase = false
    if (baseW && !Object.keys(avatarClips).length && (plan.avatarSegments || []).length) {
      coupesDepuisBase = true
      let n = 0
      plan.avatarSegments.forEach((w, i) => {
        const a = Math.max(0, Number(w.start) || 0)
        const d = Math.max(0.4, (Number(w.end) || a) - a)
        const out = 'media/av' + i + '.mp4'
        try {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(a), '-t', String(d + 2.5),
            '-i', baseOut, '-vf', `scale='min(1080,iw)':-2,fps=${FPS}`, '-an',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', String(FPS),
            '-movflags', '+faststart', join(proj, out)])
          avatarClips['av' + i] = out
          n++
        } catch (e) { console.warn('découpe avatar depuis base.mp4 :', e.message) }
      })
      if (n) console.log(`▶ ${n} fenêtre(s) avatar découpée(s) dans sa propre vidéo`)
    }
    // UNE FENÊTRE COUPÉE EN DEUX REJOUE LE MÊME CLIP, PLUS LOIN DEDANS.
    // La dérivation peut scinder une fenêtre avatar (le hook passe du split au
    // plein cadre). Le moteur associe le clip à l'INDICE de la fenêtre : la
    // seconde moitié n'avait donc plus de clip. On lui en découpe un, à partir
    // de `clipFrom` — la voix continue, le visage aussi.
    if (!coupesDepuisBase) {
      // (inutile quand les clips viennent d'être découpés dans base.mp4 : chaque
      //  fenêtre a déjà le sien, calé sur SON début. Réappliquer `clipFrom` ici
      //  décalerait une deuxième fois.)
      const segs = plan.avatarSegments || []
      const next = {}
      segs.forEach((w, i) => {
        const from = Number(w.clipFrom || 0)
        // `w.clip` est posé par la dérivation : l'indice D'ORIGINE de la fenêtre
        // (les clips av0, av1… ont été générés dans cet ordre-là), ou -1 pour
        // une fenêtre qu'elle a créée (adresse directe, trou comblé) — aucune
        // ne doit hériter du clip d'une voisine par simple position :
        // 'av-1' n'existe pas, donc `!src` → photo d'avatar en repli.
        const srcId = 'av' + (w.clip ?? i)
        const src = avatarClips[srcId]
        if (!src) return
        if (from < 0.05) { next['av' + i] = src; return }
        const out = 'media/av' + i + '-cut.mp4'
        // ── UN RECOUPAGE NE DOIT JAMAIS SORTIR 0 FRAME (Axel, 08/08) ──────────
        // Le point de reprise `clipFrom` est calculé sur les bornes d'ORIGINE de
        // la fenêtre ; si le clip Hedra sous-jacent est plus court (tranché, pad
        // court…), `-ss from` seek au-delà de la fin → fichier VIDE, et
        // HyperFrames refuse alors TOUT le rendu (« captured 0 of expected N
        // frames » — 4 rendus perdus sur ce piège le 08/08). On borne donc le
        // point de reprise à la durée réelle (en gardant ≥0,3 s de matière), et
        // on GÈLE la dernière image (+6 s) : le clip couvre toujours son panneau.
        let srcDur = 0
        try { srcDur = parseFloat(ffprobe(join(proj, src), 'format=duration')) || 0 } catch (_) {}
        const fromSafe = srcDur > 0.4 ? Math.min(from, srcDur - 0.3) : from
        try {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(fromSafe), '-i', join(proj, src),
            '-an', '-vf', `tpad=stop_mode=clone:stop_duration=6,fps=${FPS}`,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-g', String(FPS), join(proj, out)])
          // garde-fou : si malgré tout le fichier n'a pas de frame, on repli sur
          // le clip source entier (jamais 0 frame qui casse le rendu complet)
          const okDur = (() => { try { return parseFloat(ffprobe(join(proj, out), 'format=duration')) || 0 } catch (_) { return 0 } })()
          next['av' + i] = okDur > 0.1 ? out : src
          console.log(`▶ fenêtre avatar ${i} : même clip, repris à ${fromSafe.toFixed(2)}s${okDur > 0.1 ? '' : ' (recoupage vide → clip entier en repli)'}`)
        } catch (e) { console.warn('découpe clip avatar :', e.message); next['av' + i] = src }
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
    // LES IMAGES QU'UNE ANIMATION CHARGE ELLE-MÊME. `tools` et `connect` écrivent
    // <img src="tuto/logo-…"> en dur dans leur HTML : elles ne passent donc ni par
    // `screen` ni par `assets`, et la boucle ci-dessous ne les copiait jamais. Dans
    // la vidéo finale on voyait deux tuiles vides avec l'icône d'image cassée — sur
    // TOUS les rendus, pas seulement les tests. Le besoin est ici, à côté du code
    // qui le crée, pour qu'une nouvelle animation à image ne le reperde pas.
    const ANIM_IMAGES = { tools: ['logo-avatarads', 'logo-claude'], connect: ['logo-avatarads', 'logo-claude'] }
    for (const sl of plan.slides || []) for (const n of ANIM_IMAGES[sl.anim] || []) wantedScreens.add(n)
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

    // la sous-couche n'a de sens que si la base porte VRAIMENT une image : sur un
    // montage parti d'un MP3, base.mp4 est un fond noir fabriqué ici même, et
    // l'empiler ne ferait qu'ajouter un décodage vidéo pour rien.
    // ── LA SOUS-COUCHE NE COUVRE QUE LES TROUS ────────────────────────────
    // Première version : la vidéo tournait sur TOUTE la durée, en couche 0.
    // Résultat mesuré sur le rendu suivant — plus de 18 minutes au lieu de 8 à 9.
    // Normal : 2 500 images à rendre, et sur chacune une image de vidéo en plus
    // à décoder, du début à la fin, y compris sous les panneaux qui la
    // masquent entièrement. Axel : « ne poser la vidéo que sur les intervalles
    // réellement découverts, même résultat visuel, sans décodage permanent ».
    //
    // On calcule donc ce qui est DÉJÀ couvert — slides, fenêtres avatar,
    // médias — et on ne pose la vidéo que dans le complément. Chaque trou est
    // pré-découpé par ffmpeg à son timecode, exactement comme les fenêtres
    // avatar le sont depuis le début : mécanisme éprouvé, aucun décalage
    // possible, et le moteur n'a qu'à poser un clip qui joue depuis son début.
    const fonds = []
    if (baseAUneImage && existsSync(join(proj, 'media', 'base.mp4'))) {
      // Deux passes. La première ne sert qu'à MESURER : on construit la
      // composition à vide pour que le moteur nous rende la liste de ce qu'il
      // pose vraiment — la dérivation rejette la moitié des scènes proposées,
      // et c'est elle qui décide, pas le plan d'origine.
      const trous = []
      buildComposition(plan, { assetFiles, avatarClips, avatarPhoto, trous, logoFile: '' })

      trous.forEach(([a, b], i) => {
        const out = 'media/fond' + i + '.mp4'
        try {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(a), '-t', String(r2(b - a)),
            '-i', join(proj, 'media', 'base.mp4'), '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-preset', 'veryfast', join(proj, out)])
          fonds.push({ start: a, end: b, src: out })
        } catch (e) { console.warn(`sous-couche ${a}→${b}s :`, e.message) }
      })
      if (fonds.length) console.log(`▶ sous-couche : ${fonds.length} trou(s) tapissé(s) par sa vidéo — ${fonds.map((f) => `${f.start}→${f.end}s`).join(', ')}`)
      else console.log('▶ sous-couche : aucun trou à combler, tout est déjà couvert')
    }
    writeFileSync(join(proj, 'index.html'), buildComposition(plan, { assetFiles, avatarClips, avatarPhoto, fonds, logoFile: jobLogo ? 'brand/logo' + extname(jobLogo) : '' }))

    // LES BRUITAGES DE « DÉTAILS DU MONTAGE » ONT LE DERNIER MOT. L'utilisateur
    // a construit cette liste en ÉCOUTANT le rendu précédent (supprimé, déplacé,
    // ajouté depuis la banque) — le moteur vient d'en re-décider une pendant
    // buildComposition, mais re-décider un choix explicite serait le défaire.
    if (Array.isArray(plan.userSfx)) {
      plan.sfx = plan.userSfx
        .filter((s) => s && typeof s.t === 'number' && s.kind)
        .map((s) => (typeof s.vol === 'number' ? { kind: String(s.kind), t: s.t, vol: s.vol } : { kind: String(s.kind), t: s.t }))
      console.log(`▶ bruitages utilisateur : ${plan.sfx.length} posé(s) (détails du montage)`)
    }
    writeFileSync(join(proj, 'meta.json'), JSON.stringify({ id: 'aa-montage', name: 'aa-montage', createdAt: new Date().toISOString() }))
    writeFileSync(join(proj, 'hyperframes.json'), JSON.stringify({
      $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
      paths: { blocks: 'compositions', components: 'compositions/components', assets: 'media' },
    }, null, 2))

    // ── 2. rendu visuel headless ──
    const visual = join(proj, 'visual.mp4')
    console.log(`▶ rendu visuel (${draft ? 'draft' : 'high'})…`)
    // RENDER_WORKERS : sur le Mac d'Axel, 8 workers Chrome (~256 Mo chacun) font
    // mourir la capture quand il travaille à côté — 2 suffisent et tiennent.
    // Railway garde le défaut auto.
    const wk = process.env.RENDER_WORKERS ? ` --workers ${parseInt(process.env.RENDER_WORKERS, 10) || 2}` : ''
    const fps = draft ? FPS_DRAFT : FPS
    // ── « captured 0 of expected N frames » : LE VRAI FILM (08/08) ──────────
    // Sur Railway, un montage à 6 vidéos perdait TOUJOURS exactement 1 clip à
    // l'extraction — jamais le même (av4, av1, av0…). Pas la mémoire (2 Go
    // utilisés sur 8), pas le cache d'extraction (coupé — échec identique).
    // La CLI extrait toutes les vidéos EN MÊME TEMPS (Promise.all sans borne) :
    // 6 ffmpeg en threads=auto d'un coup, le perdant de la course meurt,
    // hyperframes range son erreur dans un tableau que personne ne lit, et le
    // garde de couverture maquille ça en clip fantôme. Le Mac, lui, encaisse.
    // Trois réponses, toutes inertes en local :
    //   ① hf-ffmpeg (image Railway, branché par HYPERFRAMES_FFMPEG_PATH)
    //      plafonne les threads du DÉCODEUR — l'encodeur x264 garde ses cœurs ;
    //   ② le patch de l'image loggue les erreurs d'extraction avalées
    //      ([hyperframes:extract-errors] sur la sortie standard) — c'est LUI
    //      qui dira la cause exacte si ça retombe ;
    //   ③ le garde tombe AVANT la capture : relancer ne coûte que la
    //      compilation + l'extraction — 3 essais avant de rendre le job.
    const FFMPEG_PLAFONNE = '/usr/local/bin/hf-ffmpeg'
    const envRendu = existsSync(FFMPEG_PLAFONNE) ? { HYPERFRAMES_FFMPEG_PATH: FFMPEG_PLAFONNE } : {}
    const RENDUS_MAX = 3
    for (let essai = 1; ; essai++) {
      try {
        sh(`${HF_CMD} render --quality ${draft ? 'draft' : 'high'} --fps ${fps}${wk} --output visual.mp4`, proj, envRendu)
        break
      } catch (e) {
        const stderr = String((e && e.stderr) || '')
        const couverture = /VideoFrameCoverageError|captured \d+ of expected \d+ frames/.test(stderr)
        if (!couverture || essai >= RENDUS_MAX) throw e
        console.warn(`⟲ extraction incomplète (essai ${essai}/${RENDUS_MAX}) — on relance le rendu visuel`)
        await new Promise((r) => setTimeout(r, 4000))
      }
    }
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
      // #68 (Axel, 07/08) : la musique ENTRE — montée de 1,2 s au lieu d'un
      // fondu de 0,6 s, l'effet « la couche BGM arrive » de la réf @tians028.
      filters.push(`[${idx}:a]atrim=0:${plan.duration},asetpts=PTS-STARTPTS,volume=${pick.vol},afade=t=in:st=0:d=1.2,afade=t=out:st=${Math.max(0, plan.duration - 1.2)}:d=1.2[mus]`)
      mixIns.push('[mus]')
      idx++
      console.log(`▶ musique : ${pick.name || 'preset'} à partir de ${(pick.start || 0).toFixed(0)} s`)
    }

    for (const s of plan.sfx || []) {
      // Axel a retiré boom/impact de la banque (01/08) mais le chef d'orchestre
      // les propose encore dans ses plans : ils jouent leur jumeau gardé.
      const SFX_ALIAS = { boom: 'cinematic-impact', impact: 'hit' }
      if (SFX_ALIAS[s.kind] && !existsSync(join(HERE, 'assets', 'sfx', `${s.kind}.mp3`))) s = { ...s, kind: SFX_ALIAS[s.kind] }
      const f = join(HERE, 'assets', 'sfx', `${s.kind}.mp3`)
      if (!existsSync(f)) continue
      inputs.push('-i', f)
      const ms = Math.max(0, Math.round(s.t * 1000))
      // s.vol : le moteur dynamique baisse ses sons de ponctuation (une poussée
      // s'entend à moitié, un clic à peine) — un bruitage plein volume sur chaque
      // geste rendait la piste répétitive et écrasait la voix.
      // s.dur : « Définir la durée » (détails du montage) coupe le son à cette
      // longueur, avec un petit fondu pour ne pas claquer.
      const cut = typeof s.dur === 'number' && s.dur > 0.1
        ? `atrim=0:${s.dur},afade=t=out:st=${Math.max(0, s.dur - 0.08).toFixed(2)}:d=0.08,`
        : ''
      filters.push(`[${idx}:a]${cut}adelay=${ms}|${ms},volume=${typeof s.vol === 'number' ? s.vol : SFX_VOL}[s${idx}]`)
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

    // ── PREMIÈRE FRAME (Axel, 09/08 : « la 1re frame c'est un écran coloré ») ──
    // HyperFrames capture parfois les overlays lourds (blobs radial-gradient,
    // sous-couche) au tout premier frame, AVANT que la vidéo avatar ne peigne →
    // frame 0 = fond coloré au lieu du visage (c'est aussi la miniature du MP4).
    // Le mux fait `-c:v copy`, donc on corrige ici : on jette le frame 0 et on le
    // remplace par un clone du frame 1 (visage). Best-effort, ~1 frame de gel
    // imperceptible, audio inchangé.
    // Mesuré (09/08) : le bug salit les ~3 premiers ET derniers frames (fond
    // coloré au lieu du visage). On en jette 5 de chaque bout et on gèle le 1er/
    // dernier frame PROPRE à la place — 0,1 s de gel de chaque côté, invisible.
    try {
      const SKIP = 5
      const gel = (SKIP / fps).toFixed(3)
      const nbF = Math.round((parseFloat(ffprobe(outPath, 'format=duration')) || plan.duration) * fps)
      const ff = outPath.replace(/\.mp4$/i, '') + '-ff.mp4'
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', outPath,
        '-vf', `trim=start_frame=${SKIP}:end_frame=${nbF - SKIP},setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=${gel}:stop_mode=clone:stop_duration=${gel}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart', ff], { stdio: 'inherit' })
      renameSync(ff, outPath)
    } catch (e) { console.warn('fix 1re/derniere frame:', e.message) }

    // ── LE PLAN DÉRIVÉ, PUBLIÉ À CÔTÉ DU MP4 ────────────────────────────────
    // Le plan du chef est une PROPOSITION, la dérivation tranche : c'est donc le
    // plan APRÈS dérivation qui dit ce que la vidéo montre vraiment. L'écran
    // « Détails du montage » de l'app le lit pour lister chaque scène (anim,
    // fenêtres avatar, médias, sfx) — convention `<sortie>.derived.json`,
    // best-effort comme le poster.
    try { writeFileSync(outPath + '.derived.json', JSON.stringify(plan)) } catch (_) {}

    const outDur = parseFloat(ffprobe(outPath, 'format=duration')) || 0
    console.log(`✅ ${outPath} — ${outDur.toFixed(1)}s, rendu total ${((Date.now() - t0) / 1000).toFixed(0)}s`)
    return { outPath, duration: outDur }
  } finally {
    rmSync(proj, { recursive: true, force: true })
  }
}

// ── mode poll Supabase : réclame les jobs queued, rend, uploade ──
// ── #24 · LA PASSE DE FINITION ───────────────────────────────────────────────
// Axel : « il faut qu'il voie son travail et fasse les finitions, c'est ça qui
// manque ! » Le chef d'orchestre écrit son plan à l'aveugle : la dérivation
// déplace, remplace et refuse ensuite la moitié de ses scènes, et il ne voit
// JAMAIS le résultat. Les mêmes défauts revenaient donc d'une version à l'autre.
//
// On lui rend sa vidéo : la ligne de temps réelle, avec les mots prononcés en
// face de chaque plan. Il ne peut que remplacer une animation qui ne correspond
// pas, ou supprimer une scène qui ne montre rien. Les temps, les captures, les
// médias et le visage lui sont interdits : ce sont des règles déterministes,
// mesurées, qu'on ne rouvre pas à un modèle. On lui demande de juger le SENS —
// ce que le code ne sait pas faire.
//
// Chaque correction repasse par les garde-fous de la dérivation : une finition
// PROPOSE, elle n'impose pas. Et l'appel ne peut jamais faire échouer un
// montage — sans réponse, le plan reste tel quel.
// ── LA TRACE D'UN MONTAGE SE GARDE ───────────────────────────────────────────
// Axel, 03/08, jour du premier client : « faut garder tous les logs et qu'ils
// soient classés correctement pour collecter un max de datas et réparer /
// améliorer ». Jusqu'ici le moteur écrivait sur la sortie standard de Railway,
// qui l'efface — et que je n'ai réussi à interroger qu'une fois sur trois
// aujourd'hui. Chaque montage raté était une information perdue.
//
// Plutôt que de réécrire les cent lignes de log existantes, on les CAPTE : le
// moteur raconte déjà tout ce qu'il fait, il suffit de l'écouter et de classer.
// Chaque ligne est rangée par phase, ce qui rend les vraies questions
// interrogeables en SQL — quelles animations sont refusées le plus souvent,
// combien de fenêtres lipsync échouent, quels médias ne trouvent jamais leur
// place. C'est la matière de l'amélioration continue qu'il demande.
const PHASES = [
  [/banni|refus|écart|ecart|absent de la banque/i, 'refus'],
  [/lipsync/i, 'lipsync'],
  [/finition/i, 'finition'],
  [/média|media|broll/i, 'media'],
  [/sous-titre/i, 'soustitres'],
  [/capture|tuto|écran|ecran/i, 'tuto'],
  [/visage|avatar/i, 'visage'],
  [/rendu|render|ffmpeg|upload/i, 'rendu'],
]
function ouvrirTrace() {
  const evts = []
  const vrai = { log: console.log, warn: console.warn, error: console.error }
  const capte = (niveau) => (...a) => {
    try {
      const msg = a.map((x) => (typeof x === 'string' ? x : String(x))).join(' ')
      // 900 lignes suffisent largement pour un montage ; au-delà c'est une
      // boucle, et on préfère une trace tronquée à une ligne de 4 Mo en base.
      if (evts.length < 900) {
        const phase = (PHASES.find(([re]) => re.test(msg)) || [null, 'autre'])[1]
        evts.push({ t: Math.round(Date.now() / 1000), niveau, phase, msg: msg.slice(0, 400) })
      }
    } catch (_) { /* une trace ne casse jamais un rendu */ }
    vrai[niveau](...a)
  }
  console.log = capte('log'); console.warn = capte('warn'); console.error = capte('error')
  return {
    fermer() { console.log = vrai.log; console.warn = vrai.warn; console.error = vrai.error; return evts },
  }
}

async function passeDeFinition(plan) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  const caps = plan.captions || []
  const dit = (a, b) => caps.filter((w) => w.start < b && w.end > a).map((w) => w.text).join(' ')
  const nomDe = (s) => s.screen ? `capture ${s.screen}`
    : (s.assetId || s.overlayMedia) ? "média de l'utilisateur"
    : s.anim ? `animation ${s.anim}` : (s.type || 'carte')
  // ── IL DOIT VOIR TOUTE LA VIDÉO, PAS SEULEMENT SES ANIMATIONS ────────────
  // Axel, 03/08 : « mets-lui plus de pouvoir pour la finition ». Jusqu'ici on ne
  // lui montrait que les slides : les moments où l'on voit seulement la personne
  // parler étaient des trous dans son rapport, donc invisibles pour lui. Il ne
  // pouvait qu'enlever, jamais remarquer qu'il MANQUE quelque chose.
  // On lui donne la ligne de temps complète, visage compris. Ces fenêtres-là
  // sont les seules où il a le droit d'ajouter.
  const visages = (plan.avatarSegments || [])
    .filter((w) => typeof w.start === 'number' && (w.end - w.start) >= 1.2)
    .map((w) => ({ start: r2(w.start), end: r2(w.end), quoi: 'ton visage qui parle', dit: dit(w.start, w.end) }))
  const scenes = (plan.slides || [])
    .filter((s) => typeof s.start === 'number')
    .map((s) => ({ start: r2(s.start), end: r2(s.end), quoi: nomDe(s), dit: dit(s.start, s.end) }))
    .concat(visages)
    .sort((a, b) => a.start - b.start)
  if (scenes.length < 3) return

  const ctrl = new AbortController()
  const minuteur = setTimeout(() => ctrl.abort(), 25000)
  let rep
  try {
    const res = await fetch(`${url}/functions/v1/finitions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ scenes, anims: ANIMS_DISPO, duree: plan.duration || 0, brief: plan.__brief || '' }),
    })
    if (!res.ok) { console.warn(`\u25b6 finitions : HTTP ${res.status}`); return }
    rep = await res.json()
  } finally { clearTimeout(minuteur) }
  const corr = (rep && rep.corrections) || []
  for (const r of (rep && rep.refus) || []) console.log(`\u25b6 finition ignorée — ${r}`)
  if (!corr.length) { console.log('\u25b6 finitions : rien à reprendre'); return }

  let faites = 0
  for (const c of corr) {
    // ── L'AJOUT : une animation sur une fenêtre de visage qui l'appelle ──────
    // Le relecteur ne peut ajouter que là où l'on ne voit QUE la personne
    // parler, et seulement si le mot prononcé réclame une image. On vérifie
    // quand même trois choses avant de le suivre : la fenêtre existe, elle est
    // assez longue, et rien n'y joue déjà. Une finition propose ; elle ne passe
    // jamais devant les règles.
    if (c.action === 'ajoute') {
      const w = (plan.avatarSegments || []).find((x) => Math.abs((x.start || 0) - c.t) < 0.05)
      if (!w) { console.log(`▶ finition refusée : aucune fenêtre visage à ${c.t}s`); continue }
      if ((w.end - w.start) < 1.2) { console.log(`▶ finition refusée : fenêtre visage de ${r2(w.end - w.start)}s trop courte à ${c.t}s`); continue }
      const occupe = (plan.slides || []).some((x) => x.start < w.end - 0.15 && x.end > w.start + 0.15)
      if (occupe) { console.log(`▶ finition refusée : ${c.anim} à ${c.t}s — une scène joue déjà là`); continue }
      plan.slides = (plan.slides || []).concat([{ start: r2(w.start), end: r2(w.end), anim: c.anim, __finition: true }])
      console.log(`▶ finition : « ${c.anim} » AJOUTÉE à ${r2(w.start)}→${r2(w.end)}s — le visage seul n'illustrait pas ce qui est dit`)
      faites++
      continue
    }
    const s = (plan.slides || []).find((x) => Math.abs((x.start || 0) - c.t) < 0.05)
    // ── LES SCÈNES DE MÉDIAS DE L'USER SONT INTOUCHABLES (Axel, 11/08) ──────────
    // La passe finitions voyait « des dizaines de photos » et remplaçait le
    // `photowall` (le mur de SES photos) par un `carousel` générique → carte
    // orange + images 404. Un `photowall`/`media`/`medias`, ou toute scène dont
    // les items portent une source, montre du RÉEL (ses fichiers) : on n'y touche
    // jamais. (Le `s.assetId` ne couvrait pas le mur, dont les ids sont dans items.)
    if (!s || s.screen || s.assetId || s.overlayMedia
      || ['photowall', 'media', 'medias'].includes(String(s.anim))
      || (s.items || []).some((it) => it && it.src)) continue
    if (c.action === 'supprime') {
      // …sauf si le trou retomberait sur RIEN. Un plan retiré doit laisser la
      // place au visage ou à un voisin, jamais un vide.
      const voisin = (plan.slides || []).find((x) => x !== s && x.end > s.start - 0.6 && x.start < s.end + 0.6)
      const visage = (plan.avatarSegments || []).some((w) => w.start < s.end && w.end > s.start)
      if (!voisin && !visage) { console.log(`\u25b6 finition refusée : retirer ${nomDe(s)} à ${s.start}s creuserait un trou`); continue }
      console.log(`\u25b6 finition : ${nomDe(s)} retiré à ${s.start}s — ne montrait rien d'utile`)
      plan.slides = plan.slides.filter((x) => x !== s)
      faites++
      continue
    }
    // ── ON NE TOUCHE PAS À UNE SCÈNE QUI PORTE UN CHIFFRE VENU DE SA VOIX ────
    // « en deux minutes » produit un compteur qui affiche 120 SECONDES : la
    // valeur vient de ce qu'il DIT. Changer l'animation sous elle laisserait le
    // chiffre orphelin. Mesuré au premier essai : la passe proposait
    // countup → speed sur cette phrase précise.
    if ((s.items || []).some((it) => String((it && (it.value || it.text)) || '').trim())) {
      console.log(`\u25b6 finition refusée : ${nomDe(s)} à ${s.start}s porte un chiffre venu de sa voix`)
      continue
    }
    // le remplaçant doit passer le MÊME garde-fou que toutes les autres
    const motif = EXIGE_FINITION[c.anim]
    const phrase = dit(s.start, s.end)
    if (motif && !motif.test(phrase)) {
      console.log(`\u25b6 finition refusée : « ${c.anim} » à ${s.start}s — « ${phrase.slice(0, 34)} » ne parle pas de ça`)
      continue
    }
    if ((plan.slides || []).some((x) => x !== s && String(x.anim) === c.anim && !x.screen && !x.assetId)) {
      console.log(`\u25b6 finition refusée : « ${c.anim} » est déjà ailleurs dans la vidéo`)
      continue
    }
    console.log(`\u25b6 finition : ${s.anim} → ${c.anim} à ${s.start}s`)
    s.anim = c.anim
    faites++
  }
  console.log(`\u25b6 finitions : ${faites}/${corr.length} correction(s) appliquée(s)`)
}

// ── #42 · LIPSYNC SCÈNE PAR SCÈNE (Hedra Character-3) ───────────────────────
// Le worker est le seul endroit de la chaîne qui ait ffmpeg : il peut donc
// découper l'audio sur chaque fenêtre avatar, ce qu'une edge function ne sait
// pas faire. La clé Hedra ne bouge pas d'un pouce : tout passe par
// `hedra-proxy`, qui la détient déjà côté Supabase.
//
// Une scène qui échoue ne fait PAS échouer le montage : on garde la photo fixe
// pour cette fenêtre-là et on continue. Un visage figé vaut mieux qu'aucune
// vidéo livrée.
// Modèle lipsync par défaut = Hedra AVATAR (26f0fc66…), swap validé par Axel le
// 10/08 (« hedra avatar tient + la route que character 3 ») — même prix 7 cr/s,
// modèle « longform » plus récent. Character-3 = 'd1dd37a3-e39a-4854-a298-6510289f9cf2'
// (repli via env HEDRA_MODEL_ID). ⚠ la clé de cache lipsync inclut le modèle : le
// swap repart donc d'un cache vierge (normal, sortie différente).
const HEDRA_MODEL_ID = process.env.HEDRA_MODEL_ID || '26f0fc66-152b-40ab-abed-76c43df99bc8'

async function hedraProxy(chemin, init = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return fetch(`${url}/functions/v1/hedra-proxy?path=${encodeURIComponent(chemin)}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, apikey: key, ...(init.headers || {}) },
  })
}

async function hedraAsset(type, nom, buf, mime) {
  const r1 = await hedraProxy('/assets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nom, type }),
  })
  if (!r1.ok) return null
  const a = await r1.json().catch(() => ({}))
  if (!a.id) return null
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: mime }), nom)
  const r2 = await hedraProxy(`/assets/${a.id}/upload`, { method: 'POST', body: fd })
  return r2.ok ? a.id : null
}

// ── UNE FENÊTRE TROP LONGUE SE DÉCOUPE AVANT D'ÊTRE ENVOYÉE ─────────────────
// Mesuré le 03/08 sur un montage de 50 s : le chef d'orchestre n'avait proposé
// QU'UNE fenêtre avatar, de 0 à 50,4 s. Deux conséquences, toutes les deux
// visibles par Axel :
//   ① Hedra n'en a rendu qu'un fragment — « le lipsync n'est présent que dans
//      le hook ». Le reste de la fenêtre retombait sur la photo fixe.
//   ② elle est partie SEULE, donc aucun parallélisme : 6 min 19 d'attente sur
//      les 15 minutes du montage, pour un seul clip.
// On tranche donc les fenêtres au-delà de 15 s. Chaque tranche devient une
// fenêtre à part entière — le moteur les rend l'une après l'autre, bord à bord,
// donc le spectateur ne voit aucune coupure — et les quatre premières partent
// ensemble. Le visage parle du début à la fin, et l'attente est divisée.
const LIPSYNC_MAX = 15
function trancherFenetres(plan) {
  const segs = plan.avatarSegments || []
  if (!segs.length) return 0
  const out = []
  let coupes = 0
  for (const w of segs) {
    const d = (w.end || 0) - (w.start || 0)
    if (d <= LIPSYNC_MAX + 2) { out.push(w); continue }
    const n = Math.ceil(d / LIPSYNC_MAX)
    const pas = d / n
    for (let i = 0; i < n; i++) {
      out.push({ ...w, start: r2(w.start + i * pas), end: r2(i === n - 1 ? w.end : w.start + (i + 1) * pas) })
    }
    coupes++
    console.log(`▶ fenêtre avatar ${r2(w.start)}→${r2(w.end)}s (${r2(d)}s) tranchée en ${n} — Hedra ne rend pas d'un bloc au-delà de ${LIPSYNC_MAX}s`)
  }
  if (coupes) plan.avatarSegments = out
  return coupes
}

// ── LES FENÊTRES 'G*' : UN CLIP GÉNÉRÉ APRÈS LA DÉRIVATION ──────────────────
// La dérivation peut créer une fenêtre qu'AUCUN clip existant ne couvre (le
// trou de 38 s : la photo figée « lisait comme un bug » — Axel). Elle la marque
// clip:'G0' ; on la génère ici, APRÈS dérivation, même quand les clips du job
// sont fournis — même cache par contenu que le reste : payé UNE fois.
async function genererFenetresG(plan, proj, jobDir, avatarClips) {
  const fen = (plan.avatarSegments || []).filter((w) => /^G\d+$/.test(String(w.clip)))
  if (!fen.length) return 0
  if (!existsSync(join(proj, 'media', 'avatar.png'))) { console.warn('fenêtres G : pas de photo avatar'); return 0 }
  const voix = existsSync(join(jobDir, 'voice.wav')) ? join(jobDir, 'voice.wav') : join(jobDir, 'base.mp4')
  if (!existsSync(voix)) return 0
  const photo = readFileSync(join(proj, 'media', 'avatar.png'))
  let imageId = null, faits = 0
  for (const w of fen) {
    // Hedra refuse sous 3,24 s : on étire l'audio vers la droite, le clip sera
    // recoupé à la fenêtre de toute façon (freeze-pad au recoupage)
    const dur = Math.max(3.3, w.end - w.start)
    const mp3 = join(proj, `ls-${w.clip}.mp3`)
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(w.start), '-t', String(dur),
        '-i', voix, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', mp3])
    } catch (e) { console.warn(`fenêtre ${w.clip} : découpe impossible`); continue }
    const audioBuf = readFileSync(mp3)
    const cle = cleLipsync(photo, audioBuf, '9:16', HEDRA_MODEL_ID)
    const out = join(proj, 'media', 'av' + w.clip + '.mp4')
    let clip = await cacheLire(cle)
    if (clip) console.log(`♻︎ fenêtre ${w.clip} : ${r2(w.start)}→${r2(w.end)}s reprise du cache — ${Math.round(dur * HEDRA_CR_SEC)} crédits économisés`)
    else {
      if (!imageId) imageId = await hedraAsset('image', 'avatar.png', photo, 'image/png')
      if (!imageId) { console.warn('fenêtres G : upload de la photo refusé'); break }
      const audioId = await hedraAsset('audio', `voice-${w.clip}.mp3`, audioBuf, 'audio/mpeg')
      if (!audioId) { console.warn(`fenêtre ${w.clip} : upload audio refusé`); continue }
      const gen = await hedraProxy('/generations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'video', ai_model_id: HEDRA_MODEL_ID, audio_id: audioId, start_keyframe_id: imageId,
          generated_video_inputs: {
            text_prompt: 'A charismatic person speaking straight to camera, highly expressive and animated UGC influencer style — big natural smiles, raised eyebrows, visible enthusiasm and emotion, lively dynamic facial expressions, natural head tilts and movement, expressive hand gestures while speaking, high energy confident delivery, engaging and magnetic, direct eye contact, precise accurate lip-sync with mouth movements exactly matching the audio',
            aspect_ratio: '9:16', character_orientation: 'video', resolution: '1080p',
          },
        }),
      })
      if (!gen.ok) { console.warn(`fenêtre ${w.clip} : Hedra ${gen.status}`); continue }
      const g = await gen.json().catch(() => ({}))
      if (!g.id) { console.warn(`fenêtre ${w.clip} : pas d'identifiant`); continue }
      let url = ''
      for (let k = 0; k < 90; k++) {
        await new Promise((r) => setTimeout(r, 4000))
        const st = await hedraProxy(`/generations/${g.id}/status`, { method: 'GET' })
        if (!st.ok) continue
        const d2 = await st.json().catch(() => ({}))
        const s = String(d2.status || '').toLowerCase()
        if (s === 'complete' || s === 'completed' || s === 'succeeded') { url = d2.url || d2.video_url || d2.output_url || ''; break }
        if (s === 'error' || s === 'failed') { console.warn(`fenêtre ${w.clip} : ${d2.error || 'échec Hedra'}`); break }
      }
      if (!url) { console.warn(`fenêtre ${w.clip} : pas de vidéo`); continue }
      const res = await fetch(url)
      if (!res.ok) { console.warn(`fenêtre ${w.clip} : téléchargement ${res.status}`); continue }
      clip = Buffer.from(await res.arrayBuffer())
      await cacheEcrire(cle, clip, dur)
      console.log(`▶ fenêtre ${w.clip} : ${r2(w.start)}→${r2(w.end)}s générée — ${Math.round(dur * HEDRA_CR_SEC)} crédits`)
    }
    writeFileSync(out, clip)
    // même moulinette 50 i/s que partout : les octets bruts ne vont jamais au rendu
    const brut = out.replace(/\.mp4$/, '-brut.mp4')
    try {
      renameSync(out, brut)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', brut,
        '-vf', `scale='min(1080,iw)':-2,fps=${FPS}`, '-an',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-g', String(FPS),
        '-movflags', '+faststart', out])
      rmSync(brut)
    } catch (e) { console.warn(`normalisation ${w.clip} :`, e.message); try { if (!existsSync(out) && existsSync(brut)) renameSync(brut, out) } catch (_) {} }
    avatarClips['av' + w.clip] = 'media/av' + w.clip + '.mp4'
    faits++
  }
  return faits
}

async function genererLipsync(plan, proj, jobDir, avatarClips) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return 0
  trancherFenetres(plan)
  const segs = (plan.avatarSegments || []).filter((w) => (w.end - w.start) >= 1)
  if (!segs.length) return 0
  // #84 · répartir les visages du pool sur les scènes (rotation) : chaque fenêtre
  // parle sur une image TOM différente. On lit le pool sur le disque (media/
  // avatar.png + avatar-1.png…) pour ne pas dépendre de l'ordre d'appel.
  {
    const pool = ['media/avatar.png']
    for (let n = 1; n <= 8; n++) if (existsSync(join(proj, 'media', 'avatar-' + n + '.png'))) pool.push('media/avatar-' + n + '.png')
    if (pool.length > 1) {
      segs.slice().sort((a, b) => (a.start || 0) - (b.start || 0)).forEach((w, k) => { if (!w.photo) w.photo = pool[k % pool.length] })
      console.log(`▶ lipsync : ${segs.length} scène(s) réparties sur ${pool.length} visage(s) (rotation)`)
    }
  }
  const voix = existsSync(join(jobDir, 'voice.wav')) ? join(jobDir, 'voice.wav') : join(jobDir, 'base.mp4')
  if (!existsSync(voix)) return 0

  const photoDefaut = readFileSync(join(proj, 'media', 'avatar.png'))
  const imageIdDefaut = await hedraAsset('image', 'avatar.png', photoDefaut, 'image/png')
  if (!imageIdDefaut) { console.warn('lipsync : upload de la photo refusé'); return 0 }
  // #84 · ROTATION DANS LE LIPSYNC : chaque fenêtre parle sur SON image (w.photo,
  // posée avant l'appel). Upload-cachée par chemin → 3 visages = 3 uploads, pas
  // un par scène. Sans w.photo (ou fichier absent) : la photo par défaut.
  const idParPhoto = new Map()
  const photoDe = async (w) => {
    const rel = String(w.photo || '')
    const abs = rel ? join(proj, rel) : ''
    if (!abs || !existsSync(abs)) return { buf: photoDefaut, id: imageIdDefaut }
    if (!idParPhoto.has(rel)) {
      const buf = readFileSync(abs)
      const id = await hedraAsset('image', rel.split('/').pop(), buf, 'image/png')
      idParPhoto.set(rel, id ? { buf, id } : { buf: photoDefaut, id: imageIdDefaut })
    }
    return idParPhoto.get(rel)
  }

  // ── LES OCTETS BRUTS D'HEDRA NE VONT JAMAIS DIRECTEMENT AU RENDU ──────────
  // Les clips fournis par l'app (jobDir/avatar) passent tous par un ré-encodage
  // 50 i/s avant compositing — depuis des mois, sans un raté. Ce chemin-ci
  // (génération + cache) écrivait les octets Hedra TELS QUELS (25 i/s), et
  // c'est sur EUX, et eux seuls, que l'extracteur d'HyperFrames plantait sur
  // Railway (« captured 0 of expected N frames », l'entrée du clip disparaît
  // de l'extraction — 4 rendus perdus le 08/08 avant de trouver ça). Même
  // moulinette pour tout le monde : mêmes réglages que le chargeur jobDir.
  function normaliserClipAvatar(nom) {
    const fini = join(proj, 'media', nom)
    const brut = join(proj, 'media', nom.replace(/\.mp4$/, '-brut.mp4'))
    try {
      renameSync(fini, brut)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', brut,
        '-vf', `scale='min(1080,iw)':-2,fps=${FPS}`, '-an',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-g', String(FPS),
        '-movflags', '+faststart', fini])
      rmSync(brut)
    } catch (e) {
      console.warn(`normalisation clip avatar ${nom} :`, e.message)
      try { if (!existsSync(fini) && existsSync(brut)) renameSync(brut, fini) } catch (_) {}
    }
  }

  // ── TOUTES LES SCÈNES EN MÊME TEMPS ──────────────────────────────────────
  // Axel : « on peut pas faire tourner plusieurs clips d'un coup pour aller plus
  // vite avec Hedra ? ça nous ferait gagner beaucoup de temps ». Oui — et c'est
  // le gain le plus net de la chaîne : une par une, 4 ou 5 scènes à 1-3 min font
  // 10 à 15 minutes ; lancées ensemble, on attend le clip le plus long.
  // Plafond à 4 pour ne pas se faire limiter par l'API, et surtout pour ne pas
  // saturer un conteneur qui rend déjà une vidéo à côté.
  const PARALLELE = 4
  let faits = 0
  let depense = 0, economie = 0   // crédits Hedra, pour que la facture soit lisible dans la trace
  // ⚠ l'indice DOIT être celui du tableau plan.avatarSegments : le moteur mappe
  // les clips par `av${indexDuTableau}` (dynamic-engine). Nommer par l'indice
  // FILTRÉ décalait les clips d'une fenêtre dès qu'une était écartée.
  const file = (plan.avatarSegments || []).map((w, i) => ({ w, i })).filter((t) => (t.w.end - t.w.start) >= 1)
  const equipes = Array.from({ length: Math.min(PARALLELE, file.length) }, async () => {
    for (;;) {
      const t = file.shift()
      if (!t) return
      // ── UN ÉCHEC DE LIPSYNC DOIT SE VOIR ────────────────────────────────
      // Axel : « le lipsync n'est pas fait partout ». Impossible de savoir
      // pourquoi : chaque scène qui échouait le faisait en silence, et le
      // montage sortait avec une photo figée sans qu'une ligne ne le dise.
      // On journalise donc CHAQUE scène — réussie ou non, avec sa raison — et
      // on retente une fois : la plupart des refus d'Hedra sont transitoires
      // (file d'attente, expiration de l'upload), pas structurels.
      let ok = false, pourquoi = ''
      // #92b (Axel, 11/08 : « le hook n'est pas lipsync alors que le CTA si ») —
      // Hedra rate parfois une scène en transitoire (« pas de vidéo » : file
      // d'attente, upload expiré). On retente jusqu'à 3 fois avec une courte
      // pause : un visage FIGÉ pendant que les autres parlent se voit tout de
      // suite, surtout sur le HOOK qui ouvre la vidéo.
      for (let essai = 1; essai <= 3 && !ok; essai++) {
        try { ok = await uneScene(t.w, t.i) } catch (e) { pourquoi = e.message }
        if (!ok && essai < 3) {
          console.warn(`↻ lipsync scène ${t.i} (${r2(t.w.start)}→${r2(t.w.end)}s, ${t.w.format || 'portrait'}) : essai ${essai}/3 manqué${pourquoi ? ' — ' + pourquoi : ''}, on retente`)
          await new Promise((r) => setTimeout(r, 4000))
        }
      }
      // #84 · le clip est nommé par l'INDICE DE TABLEAU (t.i) ; on aligne
      // `w.clip` dessus pour que le remap post-découpe (`'av'+(w.clip ?? i)`) le
      // retrouve. Sans ça, une fenêtre créée par la dérivation (clip:-1 : trou,
      // adresse) cherchait `av-1` → visage FIGÉ (Axel : « pas de lipsync à 4-6 s
      // ni à 40 s »).
      if (ok) { t.w.clip = t.i; faits++; console.log(`✓ lipsync scène ${t.i} : ${r2(t.w.start)}→${r2(t.w.end)}s (${t.w.format || 'portrait'})`) }
      else console.warn(`✗ lipsync scène ${t.i} ABANDONNÉE : ${r2(t.w.start)}→${r2(t.w.end)}s (${t.w.format || 'portrait'})${pourquoi ? ' — ' + pourquoi : ''} → la photo restera figée sur cette fenêtre`)
    }
  })

  async function uneScene(w, i) {
    // #84 · l'image de CETTE fenêtre (rotation) — la clé de cache et le keyframe
    // Hedra en découlent : chaque visage parle sur la bonne photo.
    const { buf: photo, id: imageId } = await photoDe(w)
    // ── HEDRA REFUSE EN DESSOUS DE 3,24 s ────────────────────────────────────
    // Contrainte mesurée et documentée. On étire la tranche vers la DROITE si
    // la vidéo le permet : le clip sera de toute façon recoupé à la fenêtre.
    const dur = Math.max(3.3, w.end - w.start)
    const mp3 = join(proj, `ls${i}.mp3`)
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(w.start), '-t', String(dur),
        '-i', voix, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', mp3])
    } catch (e) { console.warn(`lipsync scène ${i} : découpe impossible`); return false }

    // ── LE CACHE PASSE AVANT LA CAISSE ──────────────────────────────────────
    // Découper l'audio est gratuit et local ; c'est seulement APRÈS qu'on sait
    // quels octets partent chez Hedra, donc c'est ici — et pas plus haut — que
    // la clé peut être calculée. Un hit rend la scène instantanée ET gratuite.
    const ratio = String(w.format) === 'paysage' ? '16:9' : '9:16'
    const audioBuf = readFileSync(mp3)
    const cle = cleLipsync(photo, audioBuf, ratio, HEDRA_MODEL_ID)
    const cout = Math.round(dur * HEDRA_CR_SEC)
    const dejaPaye = await cacheLire(cle)
    if (dejaPaye) {
      writeFileSync(join(proj, 'media', `av${i}.mp4`), dejaPaye)
      normaliserClipAvatar(`av${i}.mp4`)
      avatarClips['av' + i] = 'media/av' + i + '.mp4'
      economie += cout
      console.log(`♻︎ lipsync scène ${i} : ${r2(w.start)}→${r2(w.end)}s repris du cache — ${cout} crédits économisés`)
      return true
    }

    const audioId = await hedraAsset('audio', `voice${i}.mp3`, audioBuf, 'audio/mpeg')
    if (!audioId) { console.warn(`lipsync scène ${i} : upload audio refusé`); return false }

    const gen = await hedraProxy('/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'video', ai_model_id: HEDRA_MODEL_ID, audio_id: audioId,
        start_keyframe_id: imageId,
        generated_video_inputs: {
          text_prompt: 'A person talking naturally to camera, UGC style, authentic, direct gaze, precise accurate lip-sync, mouth movements matching the audio',
          aspect_ratio: String(w.format) === 'paysage' ? '16:9' : '9:16',
          character_orientation: 'video', resolution: '1080p',
        },
      }),
    })
    if (!gen.ok) { console.warn(`lipsync scène ${i} : Hedra ${gen.status}`); return false }
    const g = await gen.json().catch(() => ({}))
    if (!g.id) { console.warn(`lipsync scène ${i} : pas d'identifiant`); return false }

    // polling — Character-3 rend en 1 à 3 min pour une scène courte
    let url = ''
    for (let k = 0; k < 90; k++) {
      await new Promise((r) => setTimeout(r, 4000))
      const st = await hedraProxy(`/generations/${g.id}/status`, { method: 'GET' })
      if (!st.ok) continue
      const d = await st.json().catch(() => ({}))
      const s = String(d.status || '').toLowerCase()
      if (s === 'complete' || s === 'completed' || s === 'succeeded') { url = d.url || d.video_url || d.output_url || ''; break }
      if (s === 'error' || s === 'failed') { console.warn(`lipsync scène ${i} : ${d.error || 'échec Hedra'}`); break }
    }
    if (!url) { console.warn(`lipsync scène ${i} : pas de vidéo`); return false }

    const res = await fetch(url)
    if (!res.ok) { console.warn(`lipsync scène ${i} : téléchargement ${res.status}`); return false }
    const out = join(proj, 'media', `av${i}.mp4`)
    const clip = Buffer.from(await res.arrayBuffer())
    writeFileSync(out, clip)
    // Payé une fois : on range les octets BRUTS au cache AVANT de normaliser —
    // la normalisation dépend du fps de rendu, le cache doit rester neutre.
    await cacheEcrire(cle, clip, dur)
    normaliserClipAvatar(`av${i}.mp4`)
    avatarClips['av' + i] = 'media/av' + i + '.mp4'
    depense += cout
    console.log(`▶ lipsync scène ${i} : ${r2(w.start)}→${r2(w.end)}s (${w.format || 'portrait'}) — ${cout} crédits`)
    return true
  }

  console.log(`▶ lipsync : ${segs.length} scène(s) lancée(s) en parallèle (${PARALLELE} à la fois)`)
  await Promise.all(equipes)
  console.log(`▶ lipsync : ${depense} crédit(s) Hedra dépensé(s)${economie ? `, ${economie} économisé(s) par le cache` : ''}`)

  // ── LE CLIP DOIT COUVRIR SON PANNEAU (#149) ──────────────────────────────────
  // dynamic-engine rend chaque clip avatar JUSQU'AU panneau suivant (contiguïté),
  // pas jusqu'à w.end. Depuis #149 les fenêtres à clip survivent toutes ; si un
  // petit trou non remplissable (< 1,25 s) suit une fenêtre, son panneau déborde
  // la durée du clip et HyperFrames refuse (« captured X of expected Y frames »).
  // On GÈLE donc la dernière image en fin de chaque clip : le panneau a toujours
  // de la matière ; le gel n'apparaît que si le panneau dépasse vraiment le clip
  // (bref en pratique, et infiniment mieux qu'un rendu qui plante). Au passage on
  // passe ces clips (Hedra 25 fps bruts) en 50 fps comme l'autre chemin (#36 fps).
  for (const k of Object.keys(avatarClips)) {
    const f = join(proj, avatarClips[k])
    if (!existsSync(f)) continue
    const tmp = f.replace(/\.mp4$/i, '.pad.mp4')
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f,
        '-vf', `tpad=stop_mode=clone:stop_duration=6,scale='min(1080,iw)':-2,fps=${FPS}`, '-an',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-g', String(FPS),
        '-movflags', '+faststart', tmp])
      copyFileSync(tmp, f); rmSync(tmp, { force: true })
    } catch (e) { console.warn(`gel de fin de clip ${k} ignoré :`, e.message) }
  }
  return faits
}

async function pollLoop() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants (.env)'); process.exit(1) }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // ── UN MOTEUR QUI S'ARRÊTE REND SON JOB À LA FILE ─────────────────────────
  // Mesuré trois fois aujourd'hui, dont une sur un rendu d'Axel en cours : un
  // déploiement Railway redémarre le conteneur, le worker meurt au milieu de
  // son travail, et le job reste marqué « rendering » pour l'éternité. L'écran
  // d'Axel affichait 96 % sur un rendu qui n'existait plus.
  //
  // Je m'étais promis deux fois de ne pas déployer pendant un rendu. La
  // promesse n'a pas tenu — et c'est normal : une règle qui dépend de la
  // vigilance de quelqu'un finit toujours par céder. On corrige donc le
  // système, pas l'intention.
  //
  // Railway envoie SIGTERM avant de couper. On l'écoute, on remet le job en
  // file d'attente — pas en échec : le travail n'a pas raté, il a été
  // interrompu — et le conteneur suivant le reprend depuis le début. Pour
  // l'utilisateur, un déploiement ne coûte plus qu'un peu d'attente.
  let jobEnCours = null
  let extinction = false
  const rendreLaMain = async (sig) => {
    if (extinction) return
    extinction = true
    if (jobEnCours) {
      try {
        await sb.from('render_jobs')
          .update({ status: 'queued', updated_at: new Date().toISOString() })
          .eq('id', jobEnCours).eq('status', 'rendering')
        console.log(`↩ ${sig} : job ${jobEnCours} remis en file — le prochain moteur le reprend`)
      } catch (e) { console.warn(`↩ ${sig} : impossible de libérer le job —`, e.message) }
    } else {
      console.log(`↩ ${sig} : aucun job en cours, arrêt propre`)
    }
    process.exit(0)
  }
  process.on('SIGTERM', () => { rendreLaMain('SIGTERM') })
  process.on('SIGINT', () => { rendreLaMain('SIGINT') })
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

      jobEnCours = job.id
      const trace = ouvrirTrace()
      const tDebut = Date.now()
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
          // l'asset d'id « avatar » est LA photo d'avatar : elle se cherche à la
          // racine du job (avatar.png), pas dans assets/ — sans elle un montage
          // lancé hors app (MCP) était toujours sans visage
          if (a.id === 'avatar') { await dl(a.path, join(jobDir, 'avatar.png')); continue }
          // #84 · les visages du POOL (avatar-1, avatar-2…) : eux aussi à la
          // racine, en avatar-1.png… — le worker les répartit sur les fenêtres.
          if (/^avatar-\d+$/.test(String(a.id))) { await dl(a.path, join(jobDir, a.id + '.' + ext)); continue }
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

        // ── LE STOCKAGE PLAFONNE À 50 Mo ────────────────────────────────────
        // Un montage de 65 s en qualité haute pèse 46 à 48 Mo — on frôlait la
        // limite à chaque rendu, et le premier montage chargé en photos l'a
        // franchie : « upload: The object exceeded the maximum allowed size »,
        // vidéo perdue après trois minutes de travail. Au-delà du seuil on
        // ré-encode à un débit qui RENTRE (la vidéo reste en 1080×1920 ; les
        // réseaux ré-encodent de toute façon derrière). Perdre 20 % de débit
        // vaut mieux que perdre le montage.
        // #2 (Axel 11/08) : jusqu'à 40 s = PLEINE qualité (crf 18, AUCUN ré-encodage),
        // plafond relevé à 48 Mo (2 Mo de marge sous la limite Supabase Free de 50 Mo).
        // Au-delà de 40 s → 44 Mo comme avant, ré-encodage au débit qui rentre.
        const durF = (() => { try { return parseFloat(ffprobe(out, 'format=duration')) || 60 } catch (_) { return 60 } })()
        const MAX_UP = (durF <= 40 ? 48 : 44) * 1024 * 1024
        let outFinal = out
        if (statSync(out).size > MAX_UP) {
          const dur = durF
          const kbps = Math.max(1500, Math.floor((MAX_UP * 8) / dur / 1000) - 160)
          const petit = out.replace(/\.mp4$/i, '') + '-web.mp4'
          console.log(`▶ ${(statSync(out).size / 1048576).toFixed(1)} Mo > limite : ré-encodage à ${kbps} kbit/s`)
          try {
            // MESURÉ, PAS SUPPOSÉ (02/08) : à taille égale, un 2 passes en
            // `slow` donne le MÊME SSIM que ce 1 passe (0,99795 vs 0,99800) et
            // coûte 30 s de rendu. À ce débit l'encodeur n'est pas affamé — la
            // répartition intelligente ne sert à rien. On garde le simple.
            execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', out,
              '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', kbps + 'k',
              '-maxrate', Math.round(kbps * 1.3) + 'k', '-bufsize', Math.round(kbps * 2) + 'k',
              '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
              '-movflags', '+faststart', petit], { stdio: 'inherit' })
            outFinal = petit
            console.log(`▶ compressé → ${(statSync(petit).size / 1048576).toFixed(1)} Mo`)
          } catch (e) { console.warn('compression:', e.message) }
        }
        const outKey = `${job.user_id}/${job.id}.mp4`
        const { error: upErr } = await sb.storage.from('render-media')
          .upload(outKey, readFileSync(outFinal), { contentType: 'video/mp4', upsert: true })
        if (upErr) throw new Error('upload: ' + upErr.message)
        // ── LE POSTER DU MONTAGE (31/07, « comme Higgsfield ») ────────────────
        // Une frame à 0,6 s, 640 px, posée A CÔTÉ du MP4 sous une clé de
        // CONVENTION (`<clé>.poster.jpg`) — aucune migration. Le MCP la
        // réhéberge en public et le fil de conversation peut enfin AFFICHER le
        // montage (bloc image + markdown) au lieu d'un simple lien. Seul étage
        // de la chaîne à avoir ffmpeg : c'est donc ici qu'elle se fabrique.
        // Best-effort : un poster raté ne fait jamais échouer une livraison.
        try {
          const poster = out.replace(/\.mp4$/i, '') + '.poster.jpg'
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '0.6', '-i', out,
            '-vframes', '1', '-vf', 'scale=640:-2', '-q:v', '4', poster])
          await sb.storage.from('render-media')
            .upload(outKey + '.poster.jpg', readFileSync(poster), { contentType: 'image/jpeg', upsert: true })
        } catch (e) { console.warn('poster:', e.message) }
        // le plan dérivé suit le MP4 (écran « Détails du montage ») — best-effort
        try {
          if (existsSync(out + '.derived.json')) await sb.storage.from('render-media')
            .upload(outKey + '.derived.json', readFileSync(out + '.derived.json'), { contentType: 'application/json', upsert: true })
        } catch (e) { console.warn('derived:', e.message) }
        // bucket privé : on stocke le PATH ; l'edge render-job signe l'URL à la demande
        console.log(`✅ job ${job.id} → ${outKey} (${Math.round((Date.now() - tDebut) / 1000)}s)`)
        await sb.from('render_jobs').update({ status: 'done', output_url: outKey, trace: trace.fermer(), updated_at: new Date().toISOString() }).eq('id', job.id)
      } catch (e) {
        console.error('✗ job', job.id, e.message)
        await sb.from('render_jobs').update({ status: 'failed', error: String(e.message || e).slice(0, 300), trace: trace.fermer(), updated_at: new Date().toISOString() }).eq('id', job.id)
      } finally {
        jobEnCours = null
        // la console reprend sa forme normale même si l'écriture a échoué :
        // un collecteur laissé branché contaminerait le job suivant.
        try { trace.fermer() } catch (_) {}
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
