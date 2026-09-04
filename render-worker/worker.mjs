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
import { buildGenSubsComposition } from './gen-subs-composition.mjs'
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
// #138 · Suivi du visage dans le temps : n vignettes d'une vidéo → gpt-4o (UNE
// requête) → [{t, cy}] avec cy = centre vertical du visage (fraction 0-1).
// null si indisponible (pas d'env, pas de visage, extraction ratée) → le crop
// fixe reprend la main.
async function suivreVisage(src) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !existsSync(src)) return null
  let dur = 0
  try {
    dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', src]).toString().trim()) || 0
  } catch (_) { return null }
  if (dur < 0.8) return null
  const n = Math.max(3, Math.min(10, Math.ceil(dur / 1.5)))
  const times = Array.from({ length: n }, (_, i) => +(0.2 + (dur - 0.5) * i / (n - 1)).toFixed(2))
  const content = [{ type: 'text', text: `These are ${n} frames sampled in chronological order from one vertical video. For EACH frame i (0-based, same order), give the vertical center of the MAIN person's face (their head) as a fraction of the frame height from 0 (top) to 1 (bottom). Reply ONLY a JSON array like [{"i":0,"cy":0.31},{"i":1,"cy":0.35}] with exactly ${n} items — use "cy":null when no clear face is visible in that frame.` }]
  const tmps = []
  try {
    for (let i = 0; i < n; i++) {
      const f = join(dirname(src), `_fs${i}-${Date.now() % 1e6}.jpg`)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(times[i]), '-i', src,
        '-frames:v', '1', '-vf', 'scale=300:-2', f])
      content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + readFileSync(f).toString('base64') } })
      tmps.push(f)
    }
    const body = { model: 'gpt-4o', max_tokens: 400, temperature: 0, messages: [{ role: 'user', content }] }
    const r = await fetch(url + '/functions/v1/openai-proxy?path=' + encodeURIComponent('/v1/chat/completions'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, apikey: key },
      body: JSON.stringify(body) })
    if (!r.ok) return null
    const d = await r.json().catch(() => ({}))
    const m = String(d?.choices?.[0]?.message?.content || '').match(/\[[\s\S]*\]/)
    if (!m) return null
    const arr = JSON.parse(m[0])
    const cys = times.map((_, i) => {
      const it = Array.isArray(arr) ? arr.find((a) => a && a.i === i) : null
      const v = it && typeof it.cy === 'number' ? it.cy : null
      return v != null && v > 0 && v < 1 ? v : null
    })
    if (!cys.some((v) => v != null)) return null
    // combler les trous par le voisin le plus proche, puis lisser (moyenne sur 3)
    for (let i = 0; i < n; i++) {
      if (cys[i] == null) {
        let l = i - 1; while (l >= 0 && cys[l] == null) l--
        let r2 = i + 1; while (r2 < n && cys[r2] == null) r2++
        cys[i] = cys[l >= 0 ? l : r2] ?? 0.34
      }
    }
    const liss = cys.map((_, i) => {
      const v = [cys[i - 1], cys[i], cys[i + 1]].filter((x) => x != null)
      return v.reduce((a, b) => a + b, 0) / v.length
    })
    return times.map((t, i) => ({ t, cy: +liss[i].toFixed(3) }))
  } catch (e) {
    console.warn('suivi visage :', e?.message || e)
    return null
  } finally {
    for (const f of tmps) { try { rmSync(f, { force: true }) } catch (_) {} }
  }
}

// Expression de pan 1080×960 : crop vertical qui SUIT le visage (cible : visage
// à 40 % de la bande), interpolation linéaire entre échantillons. Sans suivi →
// crop fixe historique (30 % du surplus).
// ⚠ ffmpeg 8 : dans un filter_complex, une expression à virgules ne passe QUE
// via les options NOMMÉES (crop=w=…:y=…) avec les virgules échappées `\,` —
// les quotes simples et la forme positionnelle cassent le parseur de graphe
// (« No such filter: '' »), vérifié empiriquement le 15/08.
// Panneau d'un split : remplit 1080×H (cover). `manual` (réglage utilisateur MC)
// impose une position verticale `pan` 0..1 (0=haut, 1=bas) + un `zoom` ≥1 ; sinon
// `samples` (suivi visage) fait un pan suiveur ; sinon cadrage fixe haut-biaisé.
function exprPanSplit(H, samples, manual) {
  H = Math.round(H / 2) * 2
  if (manual) {
    const z = Math.max(1, Math.min(3, Number(manual.zoom) || 1))
    const p = Math.min(1, Math.max(0, manual.pan != null ? Number(manual.pan) : 0.5))
    const sw = Math.round(1080 * z / 2) * 2
    const sh = Math.round(H * z / 2) * 2
    return `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=w=1080:h=${H}:x=(iw-1080)/2:y=max(0\\,min((ih-${H})*${p.toFixed(4)}\\,ih-${H})),setsar=1`
  }
  if (!samples || samples.length < 2) {
    return `scale=1080:${H}:force_original_aspect_ratio=increase,crop=w=1080:h=${H}:x=(iw-1080)/2:y=max(0\\,min((ih-${H})*0.3\\,ih-${H})),setsar=1`
  }
  const anchor = Math.round(H * 0.4)
  const seg = [`lt(t\\,${samples[0].t})*${samples[0].cy}`]
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1]
    const pente = ((b.cy - a.cy) / (b.t - a.t)).toFixed(5)
    seg.push(`gte(t\\,${a.t})*lt(t\\,${b.t})*(${a.cy}+${pente}*(t-${a.t}))`)
  }
  const fin = samples[samples.length - 1]
  seg.push(`gte(t\\,${fin.t})*${fin.cy}`)
  const y = `max(0\\,min((${seg.join('+')})*ih-${anchor}\\,ih-${H}))`
  return `scale=1080:${H}:force_original_aspect_ratio=increase,crop=w=1080:h=${H}:x=(iw-1080)/2:y=${y},setsar=1`
}

// Réglage manuel MC ou null (→ suivi auto). pan 0.5 + zoom 1 = défauts ⇒ null.
function _manOrNull(pan, zoom) {
  const hasPan = pan != null && Math.abs(Number(pan) - 0.5) > 0.01
  const hasZoom = zoom != null && Number(zoom) > 1.01
  if (!hasPan && !hasZoom) return null
  return { pan: pan != null ? Number(pan) : 0.5, zoom: zoom != null ? Number(zoom) : 1 }
}

async function composeMotionSplit(jobDir, outPath, plan) {
  const orig0 = join(jobDir, 'base.mp4')
  const motion = join(jobDir, 'assets', 'motion.mp4')
  if (!existsSync(motion)) throw new Error('clip motion manquant (assets/motion.mp4)')
  // ⚠ VIDÉO TÉLÉPHONE : une vidéo filmée à l'iPhone embarque souvent un 3e flux
  // DATA (métadonnées « mebx », codec « none ») que ffmpeg REFUSE de décoder
  // (« Decoder (codec none) not found for input stream #0:2 ») → le split
  // échouait TOUJOURS sur ces sources, d'où le repli plein écran systématique.
  // On remuxe la source en VIDÉO+AUDIO seulement (le flux data est écarté) avant
  // la composition. Copie d'abord (rapide) ; ré-encodage léger en repli.
  // ⚠ 0:a:0? (PREMIÈRE piste audio seulement) et pas 0:a? : certaines captures
  // iPhone portent une 2e piste audio codec « none » qui fait échouer la copie
  // ET le ré-encodage (même piège que le flux data — vu sur réf réelle le 28/08).
  const orig = join(jobDir, 'base-av.mp4')
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', orig0, '-map', '0:v:0', '-map', '0:a:0?',
      '-c', 'copy', '-movflags', '+faststart', orig], { stdio: 'pipe' })
  } catch (_) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', orig0, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', orig], { stdio: 'pipe' })
  }
  const mode = plan.mode === 'split-top' ? 'split-top' : 'split-bottom'
  // #MC réglages (Axel 16/08) : part du haut ajustable + recadrage manuel par
  // POSITION (position verticale + zoom). Défauts (50/50, pan .5, zoom 1) ⇒ suivi
  // visage auto conservé (#138). vstack accepte des hauteurs de panneau différentes.
  const rTop = Math.min(0.8, Math.max(0.2, Number(plan.ratioTop) || 0.5))
  const Htop = Math.max(320, Math.min(1600, Math.round(1920 * rTop / 2) * 2))
  const Hbot = 1920 - Htop
  const manTop = _manOrNull(plan.panTop, plan.zoomTop)
  const manBot = _manOrNull(plan.panBot, plan.zoomBot)
  const top = mode === 'split-top' ? 1 : 0   // split-top → motion (input 1) en haut
  const bot = mode === 'split-top' ? 0 : 1
  // suivi visage seulement pour les positions SANS réglage manuel (économie gpt-4o)
  let sO = null, sM = null
  const needO = (top === 0 && !manTop) || (bot === 0 && !manBot)
  const needM = (top === 1 && !manTop) || (bot === 1 && !manBot)
  try {
    const [a, b] = await Promise.all([
      needO ? suivreVisage(orig0) : Promise.resolve(null),
      needM ? suivreVisage(motion) : Promise.resolve(null),
    ])
    sO = a; sM = b
  } catch (e) { console.warn('suivi visages :', e?.message || e) }
  const exprTop = exprPanSplit(Htop, top === 0 ? sO : sM, manTop)
  const exprBot = exprPanSplit(Hbot, bot === 0 ? sO : sM, manBot)
  console.log(`motion-split : mode=${mode} haut=${(rTop * 100) | 0}% manTop=${!!manTop} manBot=${!!manBot}`)
  const fc = `[${top}:v]${exprTop}[t];[${bot}:v]${exprBot}[b];[t][b]vstack=inputs=2[v]`
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

// Motion Control « fond vidéo » (PoC 28/08) : le rendu Kling remplace le fond par un
// aplat — ici on garde la VRAIE vidéo de référence, ANIMÉE, derrière le personnage.
// Le rendu Kling est détouré en amont (fal-ai/ben/v2/video, ~0,001 $/mégapixel soit
// ~0,22 $ pour 3,5 s en 1080×1920 ; output_format:'webm' = VP9 + canal alpha), puis
// recomposé PAR-DESSUS la référence, plein cadre.
// jobDir attendu : base.mp4 = vidéo de référence (origPath), assets/matted.webm =
// personnage détouré (alpha). Repli : assets/matted.mp4 sur fond VERT uni
// (background_color:[0,255,0] côté fal) → chromakey + despill.
// ── v2 (LOT MC 28/08) · LA PERSONNE D'ORIGINE EST EFFACÉE DU FOND ─────────────
// Bug prouvé par frames (IMG_6133) : le fond v1 = la réf BRUTE → dès que les gestes
// de la personne d'origine sortent de la silhouette du personnage généré (main levée),
// ses membres réapparaissent en FANTÔME. v2 accepte deux assets OPTIONNELS :
//   assets/refmask.webm  = matte ALPHA de la RÉF (la personne d'origine, fal ben/v2)
//   assets/bgclean.jpg   = frame statique de la réf, personne DÉJÀ effacée (gpt-image)
// Là où le masque ref-personne est actif (DILATÉ ~3 % : gblur+seuil pour couvrir les
// bords), le fond est REMPLACÉ par la frame nettoyée (alphamerge+overlay — équivalent
// maskedmerge mais à couture ADOUCIE : le masque re-flouté sert d'alpha du patch).
// Les deux absents → comportement v1 inchangé ; échec ffmpeg v2 → re-tentative v1
// (on ne perd JAMAIS un rendu Kling payé pour un patch de fond).
// ⚠ ffmpeg : seul le DÉCODEUR libvpx-vp9 (forcé avant -i) livre le canal alpha d'un
// webm VP9 — le décodeur natif « vp9 » le jette silencieusement (fond noir opaque).
async function composeMotionBg(jobDir, outPath, plan) {
  const orig0 = join(jobDir, 'base.mp4')
  let matted = join(jobDir, 'assets', 'matted.webm')
  let alpha = true
  if (!existsSync(matted)) { matted = join(jobDir, 'assets', 'matted.mp4'); alpha = false }
  if (!existsSync(matted)) throw new Error('personnage détouré manquant (assets/matted.webm|.mp4)')
  const refmask = join(jobDir, 'assets', 'refmask.webm')
  const bgclean = join(jobDir, 'assets', 'bgclean.jpg')
  const patchOK = existsSync(refmask) && existsSync(bgclean)   // les DEUX, sinon v1
  // même remux anti-flux-DATA que motion-split : les vidéos iPhone embarquent un
  // flux « mebx » que ffmpeg refuse de décoder → on garde vidéo+audio seulement.
  // ⚠ 0:a:0 (PREMIÈRE piste audio seulement) et pas 0:a : certaines captures iPhone
  // portent une 2e piste audio de codec « none » qui fait échouer copie ET ré-encodage.
  const orig = join(jobDir, 'base-av.mp4')
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', orig0, '-map', '0:v:0', '-map', '0:a:0?',
      '-c', 'copy', '-movflags', '+faststart', orig], { stdio: 'pipe' })
  } catch (_) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', orig0, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', orig], { stdio: 'pipe' })
  }
  // ── LOT A · SORTIE AU RATIO EXACT DE LA RÉF ────────────────────────────────
  // Mesuré 28/08 (IMG_6133) : en character_orientation 'video', Kling suit le
  // ratio de la vidéo de réf mais sort un canvas bâtard — réf 1080×1920 →
  // rendu 1072×1920 (0,5583 vs 0,5625). La sortie est donc normalisée aux
  // dimensions EXACTES de la réf quand les deux ratios sont proches (≤5 %) :
  // ratio = celui de la réf, résolution = celle du rendu Kling (dimension
  // dominante conservée — jamais d'upscale : une réf 4K ne gonfle pas un rendu
  // 1080p). Fond ET personnage passent par le MÊME cover-crop (1072→1080 =
  // 0,4 % de crop, invisible), donc ils restent alignés au pixel. Ratios trop
  // éloignés (réf illisible, cas inattendu) → comportement v1 inchangé :
  // format du personnage détouré tel quel.
  const probeWH = (file) => {
    const d = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',')
    return { w: parseInt(d[0], 10) || 0, h: parseInt(d[1], 10) || 0 }
  }
  let W = 1080, H = 1920, mw = 0, mh = 0
  try { const m = probeWH(matted); mw = m.w; mh = m.h; if (mw && mh) { W = mw; H = mh } } catch (_) { /* probe optionnel */ }
  try {
    const r = probeWH(orig)
    if (r.w && r.h && mw && mh) {
      const ratioRef = r.w / r.h, ratioM = mw / mh
      if (Math.abs(ratioRef / ratioM - 1) <= 0.05) {
        if (ratioRef <= 1) { H = mh; W = Math.round(mh * ratioRef / 2) * 2 }
        else { W = mw; H = Math.round(mw / ratioRef / 2) * 2 }
      } else {
        console.warn(`motion-bg : ratio réf ${ratioRef.toFixed(4)} trop éloigné du rendu Kling ${ratioM.toFixed(4)} — sortie au format du rendu (v1)`)
      }
    }
  } catch (_) { /* probe réf optionnel */ }
  W = Math.round(W / 2) * 2; H = Math.round(H / 2) * 2
  // fond = référence cover-crop au format + cadence alignée ; personnage par-dessus
  // via le MÊME cover-crop (dimensions quasi identiques → crop marginal, alignement garanti)
  const key = alpha ? '' : 'colorkey=0x00FF00:0.22:0.06,despill=type=green,'
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
  // ── LOT3-A · FRAME 0 AVEC AVATAR, TOUJOURS ────────────────────────────────
  // Prouvé sur le job du 29/08 (uid f0cae49a, frames extraites) : les webm fal
  // (matted + refmask) portent un start_time=0.007 s. L'overlay (framesync) sort
  // donc la 1re frame du fond à t=0 SANS personnage (aucune frame fg ≤ 0) → la
  // frame 0 du rendu = mur seul, et c'est elle que le player ET la cover TikTok
  // affichent. Fix : setpts=PTS-STARTPTS sur CHAQUE entrée vidéo avant tout le
  // reste — la 1re frame utile de chaque flux est recalée à t=0 (même un matte
  // qui démarrerait plus tard est ramené à 0, effet « clone de la 1re frame
  // utile ») — + fps=30 partout AVANT l'overlay pour une grille commune.
  const pts0 = 'setpts=PTS-STARTPTS,fps=30,'
  // v2 : la réf, le masque ET la frame nettoyée passent par le MÊME cover-crop —
  // sinon le patch ne tombe pas sur les bons pixels. Masque : alphaextract (gris),
  // DILATATION ≈3 % de la largeur (gblur σ=20 puis seuil bas 10/255 : le halo du
  // flou devient blanc → le masque s'étend de ~1,8 σ ≈ 35 px, couvre les bords du
  // détourage), puis re-flou σ=6 = couture fondue quand il sert d'alpha au patch.
  // LOT A : le personnage passe AUSSI par ${cover} (scale/crop préservent le
  // canal alpha yuva420p de libvpx-vp9) → 1072×1920 devient 1080×1920 comme le
  // fond, l'overlay tombe plein cadre sans liseré.
  // ── LOT3-B · HALO SUR LE MUR LÀ OÙ PASSAIT LA MAIN D'ORIGINE ─────────────
  // Vu sur frames (job 29/08) : deux causes cumulées. (1) le patch bgclean
  // (gpt-image) est ~3-8 niveaux de luma PLUS CLAIR que le mur de la réf
  // (mesuré zone commune hors personne : 85,5 vs 77,7) → là où le masque passe,
  // le mur « s'allume » = la lueur qui suit la main. (2) la couture σ=6 est trop
  // franche → l'écart se lit comme un blob net. Fix : fondu plus doux (σ10) +
  // correction de luminance du patch. ⚠ testé sur pièces : ÉLARGIR la dilatation
  // (σ26/σ34) fait apparaître une bavure sombre à la frontière mur/plafond —
  // bgclean est une frame 0 STATIQUE, la caméra bouge, ses arêtes ne tombent
  // plus au même endroit → dilatation INCHANGÉE (σ20/seuil 10). ⚠ l'écart de
  // luminance est MULTIPLICATIF (mur +8, plafond blanc +3) — un offset
  // (eq=brightness) sur-corrige le plafond (tache sombre sur le blanc) ; une
  // courbe GAMMA ajustée sur la moyenne colle aux deux zones à <1/255 près →
  // eq=gamma, borné [0,85..1,18].
  const DILATE = `gblur=sigma=20,lutyuv=y='if(gt(val,10),255,0)'`
  const FEATHER = 'gblur=sigma=10'
  const fcFor = (patch, lumFix = 1) => {
    const fin = `overlay=x=(W-w)/2:y=(H-h)/2:shortest=1:format=auto,format=yuv420p[v]`
    if (!patch) return `[0:v]${pts0}${cover},setsar=1[bg];[1:v]${pts0}${key}${cover},setsar=1[fg];[bg][fg]${fin}`
    const eqPatch = Math.abs(lumFix - 1) >= 0.02 ? `,eq=gamma=${lumFix.toFixed(4)}` : ''
    return `[0:v]${pts0}${cover},setsar=1[bg0];` +
      `[2:v]${pts0}alphaextract,${cover},${DILATE},${FEATHER}[mk];` +
      `[3:v]${cover},setsar=1${eqPatch}[cl];[cl][mk]alphamerge[patch];` +
      `[bg0][patch]overlay=format=auto[bg];` +
      `[1:v]${pts0}${key}${cover},setsar=1[fg];[bg][fg]${fin}`
  }
  // Mesure de l'écart de luminance patch↔réf sur le FOND COMMUN (frame 0, pixels
  // HORS masque-personne dilaté) : moyenne pondérée par le masque inversé via
  // blend=multiply + signalstats (metadata→fichier). Best-effort : le moindre
  // échec → 0 (pas de correction), on ne bloque jamais un rendu pour ça.
  const mesureLumFix = () => {
    try {
      const statFile = (name) => join(jobDir, name)
      const yavgOf = (file) => {
        const m = readFileSync(file, 'utf8').match(/YAVG=([0-9.]+)/)
        return m ? parseFloat(m[1]) : NaN
      }
      const mInv = `[0:v]setpts=PTS-STARTPTS,alphaextract,${cover},${DILATE},negate,format=gray`
      // moyenne du masque inversé (poids total)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', refmask,
        '-filter_complex', `${mInv},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${statFile('_lum-m.txt')}[o]`,
        '-map', '[o]', '-frames:v', '1', '-f', 'null', '-'], { stdio: 'pipe' })
      // moyenne (Y×poids) de la réf puis du patch, sur la même frame 0
      const wsum = (input, extra, out) => execFileSync('ffmpeg',
        ['-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-i', refmask, ...extra, '-i', input,
          '-filter_complex', `${mInv}[m];[1:v]setpts=PTS-STARTPTS,${cover},format=gray[r];[r][m]blend=all_mode=multiply,` +
          `signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${statFile(out)}[o]`,
          '-map', '[o]', '-frames:v', '1', '-f', 'null', '-'], { stdio: 'pipe' })
      wsum(orig, [], '_lum-r.txt')
      wsum(bgclean, ['-loop', '1'], '_lum-c.txt')
      const m = yavgOf(statFile('_lum-m.txt')), r = yavgOf(statFile('_lum-r.txt')), c = yavgOf(statFile('_lum-c.txt'))
      if (!(m > 8)) return 1
      // moyennes pondérées (0..1) du fond commun : réf vs patch
      const wr = (r * 255 / m) / 255, wc = (c * 255 / m) / 255
      if (!(wr > 0.02 && wr < 0.98) || !(wc > 0.02 && wc < 0.98)) return 1
      // exposant p tel que wc^p = wr, appliqué via eq=gamma (out = in^(1/gamma)) → gamma = 1/p
      const p = Math.log(wr) / Math.log(wc)
      const fix = Math.max(0.85, Math.min(1.18, 1 / p))
      if (Math.abs(fix - 1) >= 0.02) console.log(`motion-bg : luminance patch corrigée (gamma ${fix.toFixed(3)})`)
      return fix
    } catch (e) { console.warn('motion-bg : mesure luminance patch ignorée :', e?.message || e); return 1 }
  }
  const lumFix = patchOK ? mesureLumFix() : 1
  // audio : le rendu Kling porte la voix (native/lipsync) → il prime ; plan.bgAudio
  // === 'orig' bascule sur la piste de la vidéo de référence (voix filmée)
  const audioMap = plan.bgAudio === 'orig' ? ['-map', '0:a?'] : ['-map', '1:a?']
  const run = (patch) => {
    const args = ['-v', 'error', '-y', '-ignore_unknown', '-i', orig]
    if (alpha) args.push('-c:v', 'libvpx-vp9')
    args.push('-i', matted)
    // refmask = webm VP9 alpha → même décodeur forcé ; bgclean = image en boucle
    if (patch) args.push('-c:v', 'libvpx-vp9', '-i', refmask, '-loop', '1', '-i', bgclean)
    args.push('-filter_complex', fcFor(patch, lumFix), '-map', '[v]', ...audioMap,
      '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest',
      '-movflags', '+faststart', outPath)
    execFileSync('ffmpeg', args, { stdio: 'pipe' })
  }
  let usedPatch = patchOK
  try {
    run(patchOK)
  } catch (e) {
    const err = (e.stderr ? e.stderr.toString() : '') || String(e.message || e)
    if (!patchOK) throw new Error('motion-bg ffmpeg : ' + err.trim().slice(-300))
    // le patch v2 a fait tomber ffmpeg (masque illisible, alpha absent…) → on livre
    // quand même le fond animé v1 plutôt que de perdre le rendu.
    console.warn('motion-bg v2 (patch fond) a échoué, repli v1 :', err.trim().slice(-200))
    usedPatch = false
    try {
      run(false)
    } catch (e2) {
      const err2 = (e2.stderr ? e2.stderr.toString() : '') || String(e2.message || e2)
      throw new Error('motion-bg ffmpeg : ' + err2.trim().slice(-300))
    }
  }
  console.log(`✅ motion-bg (${alpha ? 'alpha' : 'chromakey'}, ${W}×${H}, fond ${usedPatch ? 'nettoyé v2' : 'brut v1'}) → ${outPath}`)
}

// utilisateur du rendu en cours (null en --local / tests) — lu par la facturation du lipsync
let RENDER_USER = null
// ── CAMÉRA RÉALISTE du Générateur (03/09 — Axel : « faudrait l'effet de caméra qui tremble ») ──
// Un téléphone tenu à la main ne tient jamais parfaitement : dérive lente (sommes de sinus à fréquences
// incommensurables → jamais périodique à l'œil) + micro-tremblement + très légère rotation. Tout en ffmpeg
// (pas de re-rendu Chromium, ~1 s par 4 s de vidéo) : on agrandit de 8 %, on tourne un peu, on recadre une
// fenêtre qui se promène. Appliqué à la vidéo AVANT les sous-titres (eux ne tremblent pas).
// Désactivable par le plan : cameraOrganique = false. Testé le 03/09 sur avatar-seul.mp4 (voir mémoire).
function camOrganiqueFilter(W, H) {
  const rot = "(0.9*sin(0.53*t+2)+0.35*sin(1.7*t))*PI/180"
  const dx  = "18*sin(0.71*t)+9*sin(1.93*t+1)+2.5*sin(11.3*t)"
  const dy  = "14*sin(0.62*t+0.5)+7*sin(2.1*t)+2*sin(9.7*t)"
  return `scale=iw*1.08:ih*1.08:flags=lanczos,rotate='${rot}':c=black,crop=${W}:${H}:x='(iw-${W})/2+${dx}':y='(ih-${H})/2+${dy}'`
}

// ── Compose SERVEUR du Générateur (__compose:'gen-subs') ─────────────────────
// GRAVE les sous-titres sur la vidéo générée EXACTEMENT comme l'aperçu client
// (_cvSubs porté verbatim dans gen-subs-composition.mjs, rendu par HyperFrames
// dans Chromium), puis MUX l'audio de la vidéo D'ORIGINE avec ffmpeg. Raison
// d'être : le rendu client échouait sur Safari/iOS (WebCodecs AudioEncoder +
// decodeAudioData ne savent pas encoder l'audio d'un conteneur MP4) → vidéo
// muette ou « trop petite ». Côté serveur, ffmpeg copie/réencode l'audio sans
// problème → son fiable PARTOUT. Aucun crédit ici : la vidéo est déjà payée à
// la génération (comme composeVideo côté client, qui est gratuit).
// jobDir attendu : base.mp4 = vidéo du Générateur ; plan.subs = données sous-titres.
async function composeGenSubs(jobDir, outPath, plan) {
  const orig = join(jobDir, 'base.mp4')
  if (!existsSync(orig)) throw new Error('base.mp4 manquant (compose gen-subs)')
  const W = 1080, H = 1920
  const baseDur = parseFloat(ffprobe(orig, 'format=duration')) || Number(plan.duration) || 5
  // #dur-fix (Axel 30/08) : la VRAIE durée de la vidéo uploadée (ffprobe base.mp4) FAIT FOI, POINT.
  // Avant : D = min(plan.duration, baseDur) → quand le client renvoyait 15 s par défaut (élément
  // #hedraVideo pas prêt → duration NaN), une vidéo de 50 s+ était TRONQUÉE à 15 s. On ignore
  // désormais le hint client pour la longueur du rendu : base.mp4 EST la vidéo, sa durée = la cible.
  const D = Math.round(baseDur * 100) / 100
  plan.duration = D
  plan.subs = plan.subs || {}
  if (!Number(plan.subs.totalDuration)) plan.subs.totalDuration = D

  // #vitesse (Axel 30/08) : on rend au fps EXACT de la SOURCE, pas à 50 en dur. Hedra sort en 25 →
  // rendre 54 s à 50 fps = 2700 frames capturées une à une dans Chromium (~2× plus long) pour une
  // vidéo qui n'a que 25 images/s de contenu → AUCUN gain. Mais si la source est en 30/50/60, on
  // respecte SON fps (ni sur- ni sous-échantillonnage). Plancher 24, plafond 60 (garde-fou anti-aberration).
  let genFps = 25
  try {
    const rfr = ffprobe(orig, 'stream=r_frame_rate').split('\n').map((s) => s.trim()).find((s) => /^\d+\/\d+$/.test(s))
    if (rfr) { const [n, d] = rfr.split('/').map(Number); if (n > 0 && d > 0) genFps = Math.round(n / d) }
  } catch (_) {}
  genFps = Math.min(60, Math.max(24, genFps || 25))
  console.log(`▶ gen-subs : rendu à ${genFps} fps (source), durée ${D}s`)

  // ── CHEMIN RAPIDE : « uniquement vidéo » (aucun sous-titre à graver) ─────────
  // Pas besoin d'HyperFrames (qui re-rend chaque frame dans Chromium, ~1-2 min) :
  // on normalise 1080×1920 + on GARDE l'audio de la vidéo d'origine + faststart
  // TikTok, en UN SEUL ffmpeg (~10-30 s). Le but ici est seulement le SON fiable
  // (le rendu client est muet sur Safari). Dès qu'il y a des sous-titres → chemin
  // HyperFrames complet ci-dessous.
  const _hasSubs = Array.isArray(plan.subs.groups) && plan.subs.groups.length > 0
  if (!_hasSubs) {
    // DIAGNOSTIC (retours Axel « pas de son ») : dit clairement si la vidéo SOURCE
    // porte une piste audio. Si NON → il n'y a rien à conserver (source muette).
    let _streamsDbg = ''
    try { _streamsDbg = ffprobe(orig, 'stream=index,codec_type,codec_name').replace(/\n/g, ' | ') } catch (_) {}
    const baseHasAudioF = ffprobe(orig, 'stream=codec_type').split('\n').some((l) => l.trim() === 'audio')
    console.log(`▶ gen-subs source AUDIO = ${baseHasAudioF ? 'OUI' : 'NON (source muette)'} · streams: ${_streamsDbg}`)
    // #vitesse (02/09) : si la source est DÉJÀ du h264 yuv420p en 1080×1920 (sortie Hedra 1080p), on la
    // recopie telle quelle (-c:v copy) : plus de ré-encodage d'une vidéo qu'on ne modifie pas → ~2× plus
    // rapide, aucune perte. Sinon (720p, autre codec) : normalisation encodée comme avant.
    let _copyOk = false
    try {
      const pv = ffprobe(orig, 'stream=codec_name,width,height,pix_fmt').split('\n').map((l) => l.trim()).filter(Boolean)
      _copyOk = pv.some((l) => /(^|,)h264(,|$)/.test(l) && /(^|,)1080(,|$)/.test(l) && /(^|,)1920(,|$)/.test(l) && /(^|,)yuv420p(,|$)/.test(l))
    } catch (_) { _copyOk = false }
    const camOn = plan.cameraOrganique !== false      // #cam-realiste (03/09) : caméra « à la main » par défaut
    const argsF = ['-v', 'error', '-y', '-i', orig]
    if (_copyOk && !camOn) {
      argsF.push('-c:v', 'copy')
    } else {
      const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${genFps}` + (camOn ? ',' + camOrganiqueFilter(W, H) : '')
      argsF.push('-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p')
    }
    if (baseHasAudioF) argsF.push('-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2')
    else argsF.push('-an')
    argsF.push('-t', String(D), '-movflags', '+faststart', outPath)
    execFileSync('ffmpeg', argsF, { stdio: 'pipe' })
    console.log(`✅ gen-subs RAPIDE (${(_copyOk && !camOn) ? 'copie h264 sans ré-encodage' : 'normalisation encodée'}${camOn ? ' + caméra réaliste' : ''} · audio + faststart, ${D}s) → ${outPath}`)
    return
  }

  const proj = mkdtempSync(join(tmpdir(), 'aa-gensubs-'))
  try {
    mkdirSync(join(proj, 'media'), { recursive: true })

    // 1. base normalisée 1080×1920 @ FPS, SANS audio → clip <video> propre à
    //    extraire (fps=50 comme partout ; l'audio viendra de l'original au mux).
    const camOnC = plan.cameraOrganique !== false      // #cam-realiste : la vidéo tremble, pas les sous-titres
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', orig,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${genFps}` + (camOnC ? ',' + camOrganiqueFilter(W, H) : ''),
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', join(proj, 'media', 'base.mp4')])

    // 2. polices embarquées (substituts des polices SYSTÈME du client : le
    //    conteneur n'a que fonts-liberation) — cf. gen-subs-composition.mjs.
    const fontsSrc = join(HERE, 'assets', 'fonts')
    if (existsSync(fontsSrc)) {
      mkdirSync(join(proj, 'fonts'), { recursive: true })
      for (const f of readdirSync(fontsSrc)) copyFileSync(join(fontsSrc, f), join(proj, 'fonts', f))
    }

    // 3. composition HyperFrames + métas
    writeFileSync(join(proj, 'index.html'), buildGenSubsComposition(plan))
    writeFileSync(join(proj, 'meta.json'), JSON.stringify({ id: 'aa-gensubs', name: 'aa-gensubs', createdAt: new Date().toISOString() }))
    writeFileSync(join(proj, 'hyperframes.json'), JSON.stringify({
      $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
      paths: { blocks: 'compositions', components: 'compositions/components', assets: 'media' },
    }, null, 2))

    // 4. rendu visuel headless — mêmes garde-fous que le montage (hf-ffmpeg qui
    //    plafonne les threads du décodeur + 3 tentatives sur extraction incomplète).
    const wk = process.env.RENDER_WORKERS ? ` --workers ${parseInt(process.env.RENDER_WORKERS, 10) || 2}` : ''
    const FFMPEG_PLAFONNE = '/usr/local/bin/hf-ffmpeg'
    const envRendu = existsSync(FFMPEG_PLAFONNE) ? { HYPERFRAMES_FFMPEG_PATH: FFMPEG_PLAFONNE } : {}
    const visual = join(proj, 'visual.mp4')
    for (let essai = 1; ; essai++) {
      try {
        sh(`${HF_CMD} render --quality high --fps ${genFps}${wk} --output visual.mp4`, proj, envRendu)
        break
      } catch (e) {
        const stderr = String((e && e.stderr) || '')
        const couverture = /VideoFrameCoverageError|captured \d+ of expected \d+ frames/.test(stderr)
        if (!couverture || essai >= 3) throw e
        console.warn(`⟲ gen-subs : extraction incomplète (essai ${essai}/3) — on relance`)
        await new Promise((r) => setTimeout(r, 4000))
      }
    }
    if (!existsSync(visual)) throw new Error('gen-subs : rendu visuel échoué (visual.mp4 absent)')

    // 5. mux : vidéo (sous-titres gravés) + AUDIO de la vidéo d'origine.
    //    -map 1:a:0? = PREMIÈRE piste audio seulement (une source réimportée peut
    //    porter une 2e piste « none » qui ferait échouer — même piège iPhone que
    //    motion-split). +faststart obligatoire (sinon les apps mobiles refusent).
    const baseHasAudio = ffprobe(orig, 'stream=codec_type').split('\n').some((l) => l.trim() === 'audio')
    if (baseHasAudio) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', visual, '-i', orig,
        '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-t', String(D), '-movflags', '+faststart', outPath], { stdio: 'pipe' })
    } else {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', visual,
        '-map', '0:v:0', '-c:v', 'copy', '-an',
        '-t', String(D), '-movflags', '+faststart', outPath], { stdio: 'pipe' })
    }
    console.log(`✅ gen-subs (sous-titres gravés + audio d'origine, ${D}s) → ${outPath}`)
  } finally {
    try { rmSync(proj, { recursive: true, force: true }) } catch (_) { /* nettoyage best-effort */ }
  }
}

export async function renderJob(jobDir, outPath, { draft = false, userId = null } = {}) {
  RENDER_USER = userId || null
  const t0 = Date.now()
  const plan = JSON.parse(readFileSync(join(jobDir, 'plan.json'), 'utf8'))

  // Motion Control (#34) : composition légère original + motion, pas de montage.
  if (plan.__compose === 'motion-split') { await composeMotionSplit(jobDir, outPath, plan); return }
  // Motion Control « fond vidéo » : personnage détouré par-dessus la référence animée.
  if (plan.__compose === 'motion-bg') { await composeMotionBg(jobDir, outPath, plan); return }
  // Générateur : grave les sous-titres (aperçu _cvSubs) sur la vidéo + mux audio d'origine.
  if (plan.__compose === 'gen-subs') { await composeGenSubs(jobDir, outPath, plan); return }

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
          // même marge tpad que la découpe : le moteur fait jouer le clip +0,45 s
          // pendant la poussée du panneau suivant — sans réserve, le garde
          // HyperFrames refuse (« captured 104 of expected 112 frames »)
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(avatarDir, f),
            '-vf', `scale='min(1080,iw)':-2,tpad=stop_mode=clone:stop_duration=1.2,fps=${FPS}`, '-an',
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

    // ── CORRECTION LEXICALE DES SOUS-TITRES (fautes de transcription Whisper FR) ──
    // Corrigé AVANT la dérivation : la visite guidée et les accents retombent alors
    // sur les bons mots (« Photo Réel » était transcrit « Photo Riel » → l'étape
    // photo-reel-realiste était introuvable et sautait ; Axel 23/08). On ne touche
    // qu'aux termes MÉTIER sans ambiguïté — jamais un mot français courant.
    {
      const FIX = [
        [/\bRielle\b/g, 'Réelle'], [/\brielle\b/g, 'réelle'],
        [/\bRiel\b/g, 'Réel'], [/\briel\b/g, 'réel'],
        [/\bavatar ?ads\b/gi, 'AvatarAds'], [/\bhedra\b/gi, 'Hedra'],
        [/\bveo\b/gi, 'Veo'], [/\bseedance\b/gi, 'Seedance'],
      ]
      let n = 0
      for (const c of plan.captions || []) {
        const av = String(c.text || '')
        for (const [re, to] of FIX) c.text = String(c.text || '').replace(re, to)
        if (c.text !== av) n++
      }
      if (n) console.log(`▶ ${n} sous-titre(s) corrigé(s) (lexique métier)`)
    }
    // ⚠️ dériver AVANT de lister les captures : la dérivation #148 ajoute des scènes
    // ui avec screen:'site-home' & co — sans ça leurs images ne sont jamais copiées
    // (l'engine re-saute la dérivation quand les scènes ui existent déjà)
    // apple partage le moteur du dynamique (cf. build-composition) : il partage
    // donc aussi sa dérivation, pas celle des styles posés sur une base.
    if (plan.slideStyle === 'dynamic' || plan.slideStyle === 'apple' || plan.slideStyle === 'slam') {
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
      // ── PASSE SLAM : ce que le chef produit pour ce style, traduit pour le moteur ──
      // (validé avec Axel le 22/08). La dérive classique ne résout pas les médias de
      // l'utilisateur ; on le fait ici pour les animations qui en portent.
      if (plan.slideStyle === 'slam') {
        // le chef écrit l'id de l'asset dans `text` (grammaire en lignes), parfois en MAJUSCULES
        const byId = {}; for (const k of Object.keys(assetFiles)) byId[k.toLowerCase()] = assetFiles[k]
        const src = (it) => (it && it.src) || byId[String((it && (it.assetId || it.text)) || '').trim().toLowerCase()] || ''
        let grilles = 0, medias = 0
        // LA GRILLE 3×3 AU HOOK EST IMPOSÉE dès 6 médias (le chef l'oublie une fois sur deux,
        // Axel la veut à chaque fois) : vidéos et images alternées, 0 → 2,3 s, avant tout.
        const ids = Object.keys(assetFiles)
        const vids = ids.filter((k) => /\.(mp4|mov|webm|m4v)$/i.test(assetFiles[k])), imgs = ids.filter((k) => !vids.includes(k))
        if (ids.length >= 6 && !(plan.slides || []).some((sl) => sl.anim === 'photowall' && sl.start < 1)) {
          const ordre = []
          for (let k = 0; ordre.length < Math.min(9, ids.length) && k < 9; k++) { const pick = (k % 2 === 0 ? vids : imgs).shift() || vids.shift() || imgs.shift(); if (pick) ordre.push(pick) }
          const hookEnd = r2(Math.min(2.3, (plan.avatarSegments || [])[0]?.end || 2.3))
          plan.slides = (plan.slides || []).filter((sl) => !(sl.start < hookEnd - 0.2 && sl.anim !== 'screen'))
          plan.slides.unshift({ anim: 'photowall', grid: '3x3', start: 0, end: hookEnd, items: ordre.map((k) => ({ assetId: k, src: assetFiles[k] })), count: ordre.length, __slamGrid: true })
          const w0 = (plan.avatarSegments || []).slice().sort((a, b) => a.start - b.start)[0]
          if (w0 && w0.start < hookEnd) w0.start = hookEnd   // l'avatar reprend après la grille
          console.log(`▶ slam : grille 3×3 imposée au hook (0→${hookEnd}s, ${ordre.length} médias)`)
        }
        for (const sl of plan.slides || []) {
          if (sl.anim === 'photowall' || sl.anim === 'post' || sl.anim === 'medias') {
            const items = (sl.items || []).map((it) => ({ ...it, src: src(it) })).filter((it) => it.src)
            medias += items.length
            sl.items = items
            if (sl.anim === 'photowall') { if (String(sl.motif || '').includes('3x3') || items.length >= 9) sl.grid = '3x3'; grilles++ }
            if (sl.anim === 'post') sl.items = items.slice(0, 3)
          }
          // un compteur SANS title est « décoratif » pour la dérive classique (réancré) → on le verrouille
          if (sl.anim === 'countup' && !sl.title) sl.title = String(sl.unit || sl.value || 'COMPTEUR').toUpperCase()
        }
        // règles avatar slam : 4 apparitions max (3 plein cadre + 1 split) ; au-delà on garde
        // le hook, le dernier (CTA) et les 2 plus longs entre les deux.
        const segs = (plan.avatarSegments || []).slice().sort((a, b) => a.start - b.start)
        if (segs.length > 4) {
          const first = segs[0], last = segs[segs.length - 1]
          const mid = segs.slice(1, -1).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 2)
          plan.avatarSegments = [first, ...mid, last].sort((a, b) => a.start - b.start)
          console.log(`▶ slam : ${segs.length} fenêtres avatar → 4 gardées (hook, 2 plus longues, CTA)`)
        }
        // LE SPLIT (1 seul) : la fenêtre avatar qui suit le hook devient « visage en bas +
        // carte en haut » avec l'animation qui la chevauche ou la suit à < 0,5 s. La carte
        // monte dans le split et disparaît du flux (sinon elle jouerait deux fois).
        const segs2 = (plan.avatarSegments || []).slice().sort((a, b) => a.start - b.start)
        const cand = segs2.find((w, k) => k > 0 && !w.split && (w.end - w.start) >= 2.5)
        if (cand) {
          // une anim à ITEMS (lineup, checklist, list…) sans items rend VIDE → inéligible au split
          const AVEC_ITEMS = new Set(['lineup', 'checklist', 'list', 'medias', 'photowall', 'carousel', 'podium'])
          const ok = (sl) => sl.anim && sl.anim !== 'screen' && sl.anim !== 'ui' && sl.anim !== 'photowall' && sl.anim !== 'result'
            && !(AVEC_ITEMS.has(sl.anim) && !(sl.items || []).length)
          const anim = (plan.slides || []).find((sl) => ok(sl) && sl.start < cand.end - 0.3 && sl.end > cand.start + 0.3)
            || (plan.slides || []).find((sl) => ok(sl) && Math.abs(sl.start - cand.end) < 0.5)
          if (anim) {
            cand.split = { slide: { ...anim, eyebrow: anim.eyebrow || '', title: anim.title || '' } }
            cand.end = r2(Math.max(cand.end, anim.end))
            plan.slides = plan.slides.filter((sl) => sl !== anim)
            console.log(`▶ slam : split « ${anim.anim} » sur la fenêtre avatar ${r2(cand.start)}→${r2(cand.end)}s`)
          }
        }
        // deux fenêtres avatar consécutives = même photo (même visage, même décor)
        segs2.forEach((w, k) => { if (k > 0 && w.start - segs2[k - 1].end < 0.6 && segs2[k - 1].photo) w.photo = segs2[k - 1].photo })
        // UN SPLIT NE DURE PAS PLUS QUE SA CARTE (Axel : « LEUR SECRET qui reste vide ») : la
        // dérive étirait la fenêtre (6,3→13,3 s) alors que l'anim du haut finit à 9,6 s → 4 s
        // d'en-tête sur du vide. On borne la fenêtre à la fin de la carte (+0,3 s) ; le reste
        // du créneau retourne au flux (cartes plein cadre / trous comblés plus bas).
        for (const w of plan.avatarSegments || []) {
          const sl = w.split && w.split.slide
          if (!sl || !sl.end) continue
          const finCarte = r2(Math.min(w.end, Math.max(sl.end, sl.start + 2.2) + 0.3))
          if (w.end - finCarte > 0.8) { console.log(`▶ slam : split borné à sa carte (${w.end}→${finCarte}s, « ${sl.anim} »)`); w.end = finCarte; if (w.clipUntil && w.clipUntil > finCarte) w.clipUntil = finCarte }
        }
        // LE CTA = L'ORATEUR (Axel : « le CTA montre la photo de l'avatar… ») : la dernière
        // fenêtre reprend la photo du HOOK (même visage qui ouvre et ferme), jamais une image
        // du pool qui tombe là par rotation.
        {
          const ord = (plan.avatarSegments || []).slice().sort((a, b) => a.start - b.start)
          if (ord.length >= 2) { const last = ord[ord.length - 1]; last.photo = ord[0].photo || 'media/avatar.png'; last.__cta = true }
        }
        // (2) en slam tout est PORTRAIT 9:16 : un format « paysage » du chef (avatar pendant une
        //     slide) n'a pas de sens ici — le visage est plein cadre ou en split, jamais en 16:9.
        for (const w of plan.avatarSegments || []) if (w.format === 'paysage') w.format = 'portrait'
        // (3) l'anim « result » (mockup téléphone du résultat) prend la photo avatar par défaut →
        //     on lui donne un média de l'utilisateur (une image) : le résultat, c'est SA création.
        const firstImg = Object.keys(assetFiles).find((k) => !/\.(mp4|mov|webm|m4v)$/i.test(assetFiles[k]))
        for (const sl of plan.slides || []) if (sl.anim === 'result' && !sl.userFile && !sl.src && firstImg) { sl.userFile = assetFiles[firstImg]; sl.src = assetFiles[firstImg]; sl.assetId = firstImg }
        // (4) le DERNIER plan est l'avatar (CTA) : une carte qui démarre après le début de la
        //     dernière fenêtre avatar et finit à la fin de la vidéo est retirée (« script » vide vu
        //     à 40 s) — le visage porte le CTA.
        const lastW = segs2[segs2.length - 1]
        if (lastW) plan.slides = (plan.slides || []).filter((sl) => !(sl.start > lastW.start + 0.5 && sl.end >= lastW.end - 0.5 && !sl.__slamGrid))
        // LA DERNIÈRE FENÊTRE VA JUSQU'AU BOUT : le moteur tient le visage jusqu'à la fin de
        // la vidéo (contiguïté), mais le lipsync n'était généré que sur la fenêtre notée
        // (37→38,8 s) → visage FIGÉ sur le dernier mot. Si rien ne suit, la fenêtre = D.
        {
          const D = r2(Number(plan.duration) || 0)
          const ord = (plan.avatarSegments || []).slice().sort((a, b) => a.start - b.start)
          const last = ord[ord.length - 1]
          if (D && last && !(plan.slides || []).some((sl) => sl.start >= last.end - 0.2 && sl.end > last.end + 0.3) && D - last.end > 0.3 && D - last.end < 8) {
            console.log(`▶ slam : dernière fenêtre avatar étendue ${last.end}→${D}s (rien ne la suit)`); last.end = D
          }
        }
        // (00) LE NAVIGATEUR N'ARRIVE PAS TROP TÔT : la dérive l'ouvre dès le début de la phrase
        //      (« Et pour faire ça de la bonne manière, tu vas te rendre sur avatarads.fr » → 2,5 s
        //      avant l'adresse) et écrase l'animation d'avant (`tools` réduit à 1,3 s). La frappe
        //      dure ~1,6 s : ouvrir 1,9 s avant le mot suffit pour que la LP arrive pile dessus.
        //      Le temps rendu revient au plan précédent (slide ou fenêtre visage).
        for (const sl of plan.slides || []) {
          if (sl.anim !== 'ui' || sl.ui !== 'browser') continue
          const url = (plan.captions || []).find((c) => c.start > sl.start && c.start < sl.end && /avatarads|\.(fr|com|io|ai)\b/i.test(String(c.text)))
          if (!url) continue
          const nv = r2(url.start - 1.9)
          if (nv - sl.start < 0.5) continue
          const avant = sl.start
          const prevS = (plan.slides || []).find((x) => x !== sl && Math.abs(x.end - avant) < 0.12)
          const prevW = (plan.avatarSegments || []).find((w) => Math.abs(w.end - avant) < 0.12)
          if (prevS) prevS.end = r2(nv - 0.02); else if (prevW && !prevW.split) prevW.end = r2(nv - 0.02)
          sl.start = nv
          console.log(`▶ slam : navigateur ouvert à ${nv}s au lieu de ${avant}s (1,9 s avant « ${url.text} ») — ${prevS ? `« ${prevS.anim} »` : prevW ? 'le visage' : 'rien'} garde ${r2(nv - avant)}s de plus`)
        }
        // (0) LA VISITE GUIDÉE NE S'INTERROMPT PAS PAR UNE ANIMATION ABSTRAITE (Axel 23/08 :
        //     « pourquoi il montre un contrat alors qu'on est sur la visite guidée ? »). Entre le
        //     premier écran (navigateur) et le dernier écran du tuto, seules les scènes CONCRÈTES
        //     vivent : captures, médias de l'utilisateur, résultat, compteur. Tout le reste (scène
        //     du mot, `form`, `sign`…) dégage — le trou est comblé juste après par l'écran précédent.
        {
          const slides = plan.slides || []
          const isTour = (sl) => sl.anim === 'ui' || (sl.anim === 'screen' && sl.screen)
          const tour = slides.filter(isTour).sort((a, b) => a.start - b.start)
          if (tour.length >= 2) {
            const t0 = tour[0].start, t1 = tour[tour.length - 1].end
            const concret = (sl) => isTour(sl) || sl.assetId || sl.src || sl.userFile
              || ['photowall', 'media', 'medias', 'result', 'countup'].includes(String(sl.anim))
              || (sl.items || []).some((it) => it && it.src)
            const jetes = slides.filter((sl) => sl.start >= t0 - 0.05 && sl.end <= t1 + 0.05 && !concret(sl))
            if (jetes.length) {
              plan.slides = slides.filter((sl) => !jetes.includes(sl))
              console.log(`▶ slam : visite guidée ${r2(t0)}→${r2(t1)}s — ${jetes.map((x) => `« ${x.anim} » à ${x.start}s`).join(', ')} retirée(s) (pas d'animation abstraite au milieu des écrans)`)
            }
          }
        }
        // (1) ZÉRO TROU : tout vide de plus de 0,8 s entre deux plans (slides + fenêtres avatar)
        //     est comblé en ÉTIRANT le plan précédent (une carte qui tient = mieux qu'un fond nu).
        {
          const occ = [...(plan.slides || []).map((sl) => ({ o: sl, a: sl.start, b: sl.end })),
                       ...(plan.avatarSegments || []).map((w) => ({ o: w, a: w.start, b: w.end }))].sort((x, y) => x.a - y.a)
          let fin = 0, bouches = 0
          for (const it of occ) {
            if (it.a - fin > 0.8 && fin > 0) {
              const prev = occ.find((x) => x.b === fin)
              // un SPLIT ne s'étire pas (sa carte finirait avant lui → en-tête sur du vide,
              // « LEUR SECRET qui reste vide ») : le trou après un split devient une fenêtre
              // VISAGE plein cadre (même photo), qui a toujours du contenu.
              if (prev && prev.o.split) {
                const w = { start: r2(fin), end: r2(it.a - 0.05), clip: -1, photo: prev.o.photo, __trou: true }
                ;(plan.avatarSegments = plan.avatarSegments || []).push(w); bouches++
              } else if (prev) { prev.o.end = r2(it.a - 0.05); prev.b = prev.o.end; bouches++ }
            }
            fin = Math.max(fin, it.b)
          }
          if (bouches) console.log(`▶ slam : ${bouches} trou(s) comblé(s) en étirant le plan précédent`)
        }
        // (1b) LE NAVIGATEUR CLIQUE « COMMENCER » QUAND IL LE DIT : s'il a été étiré sur la phrase
        //      « cliquer sur Commencer », le zoom et le clic se calent sur le mot (sinon la scène
        //      zoome 1,2 s avant sa fin, loin de la voix). LEAD 0,35 s : le cadre précède le mot.
        for (const sl of plan.slides || []) {
          if (sl.anim !== 'ui' || sl.ui !== 'browser' || sl.zoomAt) continue
          const mot = (plan.captions || []).find((c) => c.start > sl.start + 1.5 && c.start < sl.end - 0.4
            && /^(commencer|commence|inscri|connect|connexion|compte)/i.test(String(c.text).replace(/[«»"']/g, '')))
          if (!mot) continue
          sl.zoomAt = r2(Math.max(sl.start + 1.9, mot.start - 0.35)); sl.clickAt = r2(Math.min(sl.end - 0.35, mot.start + 0.45))
          console.log(`▶ slam : navigateur — zoom ${sl.zoomAt}s + clic ${sl.clickAt}s sur « ${mot.text} »`)
        }
        // (5) ACCENTS : le chef n'en marque que ~10 ; le jaune doit claquer sur TOUS les mots
        //     forts (Axel : « le jaune n'y est pas »). On complète avec les mots-clés du script :
        //     noms propres / URL, chiffres, mots ≥ 7 lettres hors mots-outils — plafonné à 22.
        {
          const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?;:«»()"']/g, '')
          const STOP = new Set(['vraiment', 'ensuite', 'maintenant', 'plusieurs', 'quelque', 'quelques', 'beaucoup', 'toujours', 'pendant', 'comment', 'pourquoi', 'parce', 'simplement', 'justement', 'également', 'egalement', 'aujourd', 'certains', 'certaines', 'personne', 'personnes', 'manière', 'maniere', 'exactement', 'complètement', 'completement', 'tellement', 'seulement', 'finalement'])
          const have = new Set((plan.accents || []).map(norm))
          const extra = []
          for (const c of plan.captions || []) {
            const raw = String(c.text || '').trim(), n = norm(raw)
            if (!n || have.has(n)) continue
            const fort = /\d/.test(n) || /\.(fr|com|ai|io)$/.test(n) || (/^[A-ZÀ-Ý]/.test(raw) && n.length >= 4 && !/^(bon|mais|et|tu|pour|ceux|ils|ça|ca|si|on|la|le|les|une|un|des|de|du|ce|cette|ces|au|aux|en|je|te|se|ne|il|elle|nous|vous)$/.test(n)) || (n.length >= 7 && !STOP.has(n) && !/(ment|ent|ont|ais|ait|aient|ions|iez)$/.test(n))
            if (fort) { have.add(n); extra.push(raw) }
          }
          if (extra.length) { plan.accents = [...(plan.accents || []), ...extra].slice(0, 22); console.log(`▶ slam : ${extra.length} accent(s) ajouté(s) → ${plan.accents.length} mots forts`) }
        }
        // (1) COUNTUP SANS VALEUR : le chef a mis « DE VUES » dans center et rien dans value →
        //     « 0+ ». On déduit le nombre des mots dits autour (« millions » → 1 000 000,
        //     « milliers » → 1 000, un chiffre prononcé → lui) et on garantit 2 s d'écran.
        for (const sl of plan.slides || []) {
          if (sl.anim !== 'countup') continue
          const hasNum = /\d/.test(String(sl.value || '') + String(sl.center || ''))
          if (!hasNum) {
            const around = (plan.captions || []).filter((c) => c.start >= sl.start - 2.5 && c.start <= sl.end + 1.5).map((c) => String(c.text).toLowerCase()).join(' ')
            const m = around.match(/(\d[\d\s.]*)/)
            sl.value = m ? m[1].replace(/[\s.]/g, '') : /million/.test(around) ? '1000000' : /millier/.test(around) ? '1000' : /cent/.test(around) ? '100' : '10'
            if (!sl.unit) sl.unit = String(sl.center || sl.title || '').replace(/DES MILLIONS|MILLIONS|MILLIERS/i, '').trim() || 'VUES'
            sl.center = ''
          }
          if (sl.end - sl.start < 2) sl.end = r2(sl.start + 2)
        }
        // (hook) AVATAR PLEIN CADRE GARANTI après la grille : la dérive recoupe les fenêtres
        //        à sa manière et a avalé celle du hook (2,3→6 s → rien). Règle slam : la 1re
        //        fenêtre avatar couvre la fin de la grille → la fin de la 1re phrase (≥ 1,2 s).
        {
          const segsH = (plan.avatarSegments || []).slice().sort((a, b) => a.start - b.start)
          const grid = (plan.slides || []).find((sl) => sl.anim === 'photowall' && sl.start < 1)
          const gEnd = grid ? grid.end : 0
          const finPhrase = (() => { const c = (plan.captions || []).find((x) => x.start > gEnd + 1.0 && /[.!?]$/.test(String(x.text))); return c ? r2(c.end + 0.15) : r2(gEnd + 2.5) })()
          const first = segsH[0]
          if (!first || first.start > gEnd + 0.8 || first.end < gEnd + 1.2) {
            const w = { start: gEnd, end: Math.min(finPhrase, gEnd + 4.5), clip: -1, photo: first && first.photo, __slamHook: true }
            // la dérive a pu poser une anim sur ce créneau → elle recule
            for (const sl of plan.slides || []) if (sl !== grid && sl.start < w.end - 0.2 && sl.end > w.start + 0.2 && sl.anim !== 'screen') sl.start = r2(Math.max(sl.start, w.end))
            plan.slides = (plan.slides || []).filter((sl) => sl.end - sl.start > 0.4)
            plan.avatarSegments = [w, ...(plan.avatarSegments || []).filter((x) => x !== first || x.start >= w.end)].sort((a, b) => a.start - b.start)
            console.log(`▶ slam : hook avatar plein cadre rétabli ${w.start}→${w.end}s (après la grille)`)
          }
        }
        // (millions) la dérive remplace notre countup par ses « views » (compteurs sociaux à
        //           chiffres inventés : 61 450) — en slam le chiffre affiché est celui qui est DIT.
        for (const sl of plan.slides || []) {
          if (sl.anim !== 'views') continue
          const around = (plan.captions || []).filter((c) => c.start >= sl.start - 2 && c.start <= sl.end + 1.5).map((c) => String(c.text).toLowerCase()).join(' ')
          if (/million|millier|\d/.test(around)) {
            const m = around.match(/(\d[\d\s.]*)/)
            Object.assign(sl, { anim: 'countup', title: /million/.test(around) ? 'DES MILLIONS DE VUES' : 'LE RÉSULTAT', value: m ? m[1].replace(/[\s.]/g, '') : /million/.test(around) ? '1000000' : '1000', unit: /vue/.test(around) ? 'DE VUES' : '', items: [], center: '' })
            if (sl.end - sl.start < 2) sl.end = r2(sl.start + 2)
            console.log(`▶ slam : « views » → countup ${sl.value} (le chiffre DIT)`)
          }
        }
        // (result) après la dérive, le mockup « résultat » doit montrer UN MÉDIA DE L'UTILISATEUR
        //          (pas la capture 99-resultat) : c'est SA création qu'on voit.
        for (const sl of plan.slides || []) if (sl.anim === 'result' && firstImg) { sl.userFile = assetFiles[firstImg]; sl.src = assetFiles[firstImg]; sl.screen = '' }
        // …et AUCUNE image de DÉMO du worker (lena / hook-qualite / 99-resultat) ne s'affiche dans un
        // montage utilisateur : la dérive pose « la photo de Léna » sur « ton premier avatar » —
        // en slam c'est SA création qu'on montre (1re image fournie), sinon la scène saute.
        const DEMO = /^(lena|hook-qualite|99-resultat)$/
        plan.slides = (plan.slides || []).filter((sl) => {
          const demo = DEMO.test(String(sl.screen || '')) || (sl.assets || []).some((a) => DEMO.test(String(a)))
          if (!demo) return true
          if (!firstImg) { console.log(`▶ slam : scène démo « ${sl.screen || (sl.assets || [])[0]} » retirée (aucune image utilisateur)`); return false }
          Object.assign(sl, { anim: 'result', ui: undefined, screen: '', assets: [], userFile: assetFiles[firstImg], src: assetFiles[firstImg], assetId: firstImg })
          console.log(`▶ slam : scène démo → résultat avec l'image de l'utilisateur (${firstImg})`)
          return true
        })
        // (hook) la slide « hook » du chef chevauche la grille → elle saute (la grille + les
        //        sous-titres rouges SONT le hook), sinon « panneau sans contenu → visage ».
        plan.slides = (plan.slides || []).filter((sl) => !(sl.anim === 'hook' || sl.type === 'hook'))
        plan.splitPersistant = true   // pas de carte typo plein cadre : l'emphase vit dans la bande
        if (grilles || medias) console.log(`▶ slam : ${grilles} grille(s), ${medias} média(s) résolus`)
      }
      // fenêtres 'G*' : un clip que la dérivation VEUT mais qu'aucun existant ne
      // couvre (« la photo figée lit comme un bug ») — généré ici, cache compris
      if (avatarPhoto) {
        try { const g = await genererFenetresG(plan, proj, jobDir, avatarClips); if (g) console.log(`▶ ${g} fenêtre(s) générée(s) après dérivation`) }
        catch (e) { console.warn('fenêtres G :', e.message) }
      }
      // #136 · CADRAGE FACE-AWARE DU SPLIT (Axel 15/08 : « l'avatar est beaucoup
      // trop bas, mets-le beaucoup plus haut, dans la safe zone au centre ») :
      // la position du visage varie d'un clip à l'autre — un biais fixe coupe le
      // crâne sur l'un et noie le visage sur l'autre. Même détection que le
      // Motion Control (#120) : une frame, gpt-4o, une box → object-position.
      for (const w of (plan.avatarSegments || [])) {
        if (!w.split) continue
        try {
          const p = await cadrageVisageSplit(w, proj, avatarClips, plan.slideStyle === 'slam' ? 'cheveux' : 'centre')
          if (p != null) { w.faceP = p; console.log(`▶ #136 : visage du split calé (object-position ${Math.round(p * 100)}%)`) }
          else console.log(`▶ #136 : visage du split NON détecté (${r2(w.start)}→${r2(w.end)}s) → biais par défaut`)
        } catch (e) { console.warn('cadrage face-aware :', e.message) }
      }
      // ── CAMÉRA RÉALISTE : SELFIE OU PAS ? (Axel 23/08) ────────────────────────
      // Une photo tenue à bout de bras reçoit la caméra organique du moteur (dérive +
      // micro-tremblement) ; un plan trépied (bureau, micro) non. Une question à la
      // vision par photo, pas par fenêtre — puis chaque fenêtre hérite de sa photo.
      if (plan.cameraOrganique !== false) {
        const verdicts = new Map()
        for (const w of (plan.avatarSegments || [])) {
          const rel = String(w.photo || 'media/avatar.png')
          if (!verdicts.has(rel)) {
            let v = false
            try { v = await estSelfie(join(proj, rel)) } catch (e) { console.warn('selfie ? :', e.message) }
            verdicts.set(rel, v)
            console.log(`▶ caméra : ${rel.split('/').pop()} = ${v ? 'SELFIE → caméra organique' : 'plan posé → caméra fixe'}`)
          }
          if (verdicts.get(rel)) w.selfie = true
        }
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
        // slam : le CTA (dernière fenêtre) garde le visage du HOOK, et deux fenêtres qui se
        // suivent gardent la même photo — la rotation ne passe pas devant ces deux règles.
        if (plan.slideStyle === 'slam' && wins.length >= 2) {
          wins[wins.length - 1].photo = wins[0].photo
          wins.forEach((w, k) => { if (k > 0 && w.start - wins[k - 1].end < 0.6) w.photo = wins[k - 1].photo })
        }
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

    // ── LIPSYNC POUR SLAM (et tout style hors dynamic/apple) ─────────────────────
    // La génération Hedra ne dépend PAS de la dérivation : seulement des fenêtres
    // `avatarSegments`, de `avatar.png` et de `__lipsync`. Le bloc lipsync du gate
    // dynamic/apple ne tourne donc pas pour slam — on le rappelle ici. Chaque
    // fenêtre parle sur SA photo (rotation déjà posée dans le plan) ; celles
    // marquées `noLipsync` (résultat, voix d'un autre genre) restent figées.
    if (plan.slideStyle !== 'dynamic' && plan.slideStyle !== 'apple' && plan.slideStyle !== 'slam'
        && plan.__lipsync && avatarPhoto && !Object.keys(avatarClips).length) {
      try { const n = await genererLipsync(plan, proj, jobDir, avatarClips); if (n) console.log(`▶ lipsync : ${n} scène(s) générée(s) chez Hedra (${plan.slideStyle})`) }
      catch (e) { console.warn('lipsync:', e.message) }
    }

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
          // tpad court (1,2 s, le temps d'une poussée) : le +6 s gelait le visage
          // sur toute fin de fenêtre plus longue que sa matière — depuis le 15/08
          // la dérivation borne les fenêtres à la matière (MATIERE), le gel long
          // n'a plus de raison d'exister, et un résidu ≤1,2 s reste discret.
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(fromSafe), '-i', join(proj, src),
            '-an', '-vf', `tpad=stop_mode=clone:stop_duration=1.2,fps=${FPS}`,
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
    // le SCRIPT mot-à-mot référence ses propres captures (écrans, vol de photo),
    // et sa scène navigateur charge la LP — aucune n'est dans plan.slides
    for (const w of plan.wordScript || []) {
      if (w && w.screen) wantedScreens.add(String(w.screen))
      if (w && w.kind === 'ui' && w.ui === 'browser') wantedScreens.add(String(w.screen || 'site-home'))
    }
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
    // LES SLIDES DE SPLIT (avatarSegments[].split.slide) vivent HORS plan.slides : leurs
    // `screen` / `assets` / `photo` (ex. compare avec un visage) n'étaient jamais copiés →
    // carte vide (deux rectangles) à l'écran. Même collecte que pour plan.slides.
    for (const w of plan.avatarSegments || []) {
      const sl = w && w.split && w.split.slide
      if (!sl) continue
      if (sl.screen) wantedScreens.add(String(sl.screen))
      if (sl.photo) wantedScreens.add(String(sl.photo))
      for (const a of sl.assets || []) wantedScreens.add(String(a))
      for (const n of ANIM_IMAGES[sl.anim] || []) wantedScreens.add(n)
    }
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

    // Transitions de section (film burn / glitch) RÉSERVÉES AU COMPTE DEV/OWNER
    // pour la phase de test (Axel 24/08) — sinon toutes les coupes retombent sur
    // le flash (comportement historique). Même garde-fou que le MIX lipsync.
    // Transitions de section : OUVERTES À TOUS (validées par Axel le 24/08 —
    // Flash / Film Burn / Glitch RGB / Mask Glitch). Le gate owner de la phase de
    // test a été retiré : `section.transition` s'applique désormais pour tout le monde
    // (opt-in — n'affecte que les sections qui en demandent une explicitement).

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
    // PLAN_DUMP=<fichier> : écrit le plan FINAL (après dérivation + finitions + passes de
    // style) — c'est lui qu'on rend, pas celui du chef. Indispensable pour comprendre
    // « pourquoi ce visuel à 14 s » sans relire 3 000 lignes de dérivation.
    if (process.env.PLAN_DUMP) { try { writeFileSync(process.env.PLAN_DUMP, JSON.stringify(plan, null, 1)) } catch {} }

    // ── Mask Glitch : silhouette blanche de l'avatar, détourée par le worker. Si une
    // section demande 'maskglitch' ET qu'on a une photo d'avatar, on la détoure
    // (hyperframes remove-background) et on la teinte en blanc (alpha conservé) → le
    // moteur l'illumine à la frontière puis révèle le plan suivant. Échec (binaire
    // absent, modèle non téléchargé…) = maskSil vide → repli glitch RGB (moteur).
    let maskSil = ''
    try {
      const wantsMask = (plan.sections || []).some((s) => s && String(s.transition || '').toLowerCase() === 'maskglitch')
      const avatarPng = join(proj, 'media', 'avatar.png')
      if (wantsMask && existsSync(avatarPng)) {
        const cut = join(proj, 'media', '_masksil_cut.png')
        execFileSync(HF_BIN, ['remove-background', avatarPng, '-o', cut], { stdio: 'ignore', timeout: 180000 })
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', cut, '-vf', 'format=rgba,lutrgb=r=255:g=255:b=255', join(proj, 'media', 'masksil.png')])
        maskSil = 'media/masksil.png'
        console.log('▶ Mask Glitch : silhouette avatar détourée (media/masksil.png)')
      }
    } catch (e) { console.warn('Mask Glitch : détourage impossible →', String(e && e.message || e).slice(0, 120), '(repli glitch)') }

    writeFileSync(join(proj, 'index.html'), buildComposition(plan, { assetFiles, avatarClips, avatarPhoto, fonds, maskSil, logoFile: jobLogo ? 'brand/logo' + extname(jobLogo) : '' }))

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

    // #montage-audio (04/09) : piste audio optionnelle de l'utilisateur (musique / bruitages),
    // téléchargée par l'intake sous `plan.userAudio`. Jouée une fois depuis le début, alignée sur
    // la vidéo, avec un fondu de sortie. ADDITIVE : absente si l'utilisateur n'en fournit pas → mix inchangé.
    const userAudioPath = plan.userAudio ? join(jobDir, plan.userAudio) : null
    if (userAudioPath && existsSync(userAudioPath)) {
      inputs.push('-i', userAudioPath)
      filters.push(`[${idx}:a]atrim=0:${plan.duration},asetpts=PTS-STARTPTS,volume=${plan.userAudioVol || 0.7},afade=t=out:st=${Math.max(0, plan.duration - 0.8)}:d=0.8[usr]`)
      mixIns.push('[usr]')
      idx++
      console.log('▶ audio utilisateur (musique/bruitages) ajouté au mix')
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
    // ── LE VISUEL EST LE MOT : UNE ANIMATION QUE LA VOIX NOMME NE SE REMPLACE PAS ──
    // Mesuré (Cartoon 15, 23/08) : « ils ont appris à utiliser les bons OUTILS » →
    // la passe a remplacé `tools` (les logos) par `quality` (une carte 4K) — Axel :
    // « l'animation ne correspond pas ». Si la phrase contient le mot même de
    // l'animation en place, elle est juste : on la garde.
    const JUSTIFIE = { tools: /outil|stack|logiciel/i, connect: /connect|reli|branch|intégr|integr/i,
      sign: /contrat|sign|deal/i, post: /post|publi|réseau|reseau/i, upload: /upload|ajout|import|glisse/i,
      rocket: /lanc|décoll|decoll|boost/i, chat: /message|discut|chat|écri|ecri/i, countup: /million|millier|\d/,
      compare: /avant|après|apres|versus|contre|fake|faux|vrai/i, checklist: /étape|etape|liste|check/i,
      quality: /qualité|qualite|4k|net|flou/i, speed: /vite|rapide|seconde|minute/i, views: /vue|vues|million/i }
    if (JUSTIFIE[s.anim] && JUSTIFIE[s.anim].test(phrase)) {
      console.log(`\u25b6 finition refusée : « ${s.anim} » à ${s.start}s est justifiée par le mot (« ${phrase.slice(0, 34)} »)`)
      continue
    }
    // ── UNE FINITION NE PEUT PAS INVENTER UNE CAPTURE ─────────────────────────
    // `screen` / `ui` / `result` exigent un fichier que la passe n'a pas : le
    // remplaçant serait jeté en §4 (« aucune capture à montrer ») ou rendrait un
    // cadre générique — le « contrat » vu en pleine visite guidée.
    if (['screen', 'ui', 'result', 'photowall', 'media', 'medias'].includes(String(c.anim))) {
      console.log(`\u25b6 finition refusée : « ${c.anim} » à ${s.start}s exige une capture ou un média que la passe n'a pas`)
      continue
    }
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

// ── API Hedra v3 (dev) via le proxy : /v3/files → /v3/models/<slug> → /v3/jobs ──
// Le lipsync du worker tourne sur Hedra AVATAR (validé Axel 10/08). Tout média = {source,url}.
const HEDRA_SLUG = process.env.HEDRA_SLUG || 'hedra-avatar'
let _hupSeq = 0
async function hedraV3Upload(buf, mime, nom) {
  // Hedra v3 = max 30 Mo/image ; une photo HD en PNG (sans perte) dépasse. On la réduit via
  // ffmpeg en JPEG ≤2560px (assez pour 720p/1080p). Compteur = pas de collision entre scènes // //
  // parallèles (PARALLELE=4).
  if (String(mime).startsWith('image/') && buf.length > 25000000) {
    try {
      const tin = join(tmpdir(), 'hup-' + process.pid + '-' + (_hupSeq++) + '.png')
      const tout = tin + '.jpg'
      writeFileSync(tin, buf)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tin, '-vf', "scale='min(3072,iw)':-2", '-q:v', '2', tout])
      buf = readFileSync(tout); mime = 'image/jpeg'
      try { rmSync(tin, { force: true }); rmSync(tout, { force: true }) } catch (_) {}
    } catch (e) { console.warn('shrink image worker:', e.message) }
  }
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: mime }), nom)
  const r = await hedraProxy('/v3/files', { method: 'POST', body: fd })
  if (!r.ok) return null
  const j = await r.json().catch(() => ({}))
  return j && j.url ? { source: 'url', url: j.url } : null
}
async function hedraV3Submit(slug, input) {
  const r = await hedraProxy('/v3/models/' + slug, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  })
  if (!r.ok) { try { console.warn('hedra v3 submit', r.status, (await r.text()).slice(0, 160)) } catch (_) {} return null }
  const j = await r.json().catch(() => ({}))
  return j.job_id || j.id || null
}
async function hedraV3Poll(jobId, maxTries = 90) {
  for (let k = 0; k < maxTries; k++) {
    await new Promise((r) => setTimeout(r, 4000))
    const st = await hedraProxy('/v3/jobs/' + jobId + '/status', { method: 'GET' })
    if (!st.ok) continue
    const d = await st.json().catch(() => ({}))
    const s = String(d.status || '').toUpperCase()
    if (s === 'FAILED') return null
    if (s === 'COMPLETED') {
      const rr = await hedraProxy('/v3/jobs/' + jobId, { method: 'GET' })
      if (!rr.ok) return null
      const rd = await rr.json().catch(() => ({}))
      const out = (rd.outputs || []).find((o) => o && o.url) || (rd.outputs || [])[0]
      return out && out.url ? out.url : null
    }
  }
  return null
}

// ── OMNIHUMAN 1.5 (ByteDance via fal) DANS LE LIPSYNC SERVEUR (Axel 23/08) ──────
// Sélecteur plan.lipsyncModel : 'hedra' (défaut, 5× moins cher) | 'omnihuman' | 'mix'
// (Omni sur le PREMIER groupe continu — le hook, là où l'attention se joue — Hedra
// ensuite). fal veut des URL publiques : la photo (JPEG ≤ 5 Mo, sinon file_too_large)
// et l'audio passent par render-media (URL signées 1 h), et la file fal s'interroge sur
// l'espace du FOURNISSEUR (/fal-ai/bytedance/requests/<id>), pas sur le chemin du modèle.
const OMNI_PATH = '/fal-ai/bytedance/omnihuman/v1.5'
const OMNI_QUEUE = '/fal-ai/bytedance'
// Hedra expose le MÊME modèle au MÊME prix (16 ¢/s, 720p ou 1080p), avec le contrat de
// Hedra Avatar (prompt/aspect_ratio/resolution/start_image/audio) : une seule facture, un
// seul proxy, pas de fichier temporaire. On passe par Hedra d'abord ; fal reste le secours
// (chemin validé le 23/08) si Hedra refuse — ou si plan.omniVia === 'fal'.
const HEDRA_OMNI_SLUG = process.env.HEDRA_OMNI_SLUG || 'omnihuman-15'
// ── FACTURATION DU LIPSYNC (23/08) ─────────────────────────────────────────────────
// Le montage MCP ne débitait AUCUNE seconde de visage (8 cr plan+rendu seulement) alors
// que Hedra coûte ~0,063 $/s et Omni 0,16 $/s. Débit ICI, au moment exact de la
// génération : secondes réelles, jamais sur un cache hit, remboursé si la scène échoue.
// RPC service `mcp_spend_credits` (SECURITY DEFINER) — le worker est côté serveur.
const LIPSYNC_CR_SEC = { hedra: 2, omnihuman: 5 }     // barème 23/08 : Hedra 2 cr/s (coût 1080p 0,063 $/s), Omni 5 cr/s
async function rpcCredits(nom, n) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const r = await fetch(`${url}/rest/v1/rpc/${nom}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, apikey: key }, body: JSON.stringify({ p_user: RENDER_USER, p_secs: n }) })
  if (!r.ok) return null
  return r.json().catch(() => null)
}
async function debiterLipsync(secs, modele) {
  const n = Math.ceil(secs * (LIPSYNC_CR_SEC[modele] || LIPSYNC_CR_SEC.hedra))
  if (!RENDER_USER) return { ok: true, n, local: true }            // --local / tests : rien à débiter
  const bal = await rpcCredits('mcp_spend_credits', n)
  if (bal === null) return { ok: false, n, pourquoi: 'débit impossible (RPC)' }
  if (bal === -1) return { ok: false, n, pourquoi: `crédits insuffisants (${n} cr pour ${r2(secs)} s de ${modele})` }
  return { ok: true, n }
}
async function rembourserLipsync(n) { if (RENDER_USER && n > 0) await rpcCredits('mcp_refund_credits', n).catch(() => {}) }
// MIX (Omni+Hedra) = compte dev/owner seulement pour le moment (Axel 23/08). Local (pas de user) = dev = autorisé.
async function estOwner(userId) {
  if (!userId) return true
  try {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
    const r = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_owner`, { headers: { Authorization: 'Bearer ' + key, apikey: key } })
    const d = await r.json().catch(() => [])
    return Array.isArray(d) && d[0] && d[0].is_owner === true
  } catch (_) { return false }
}
async function storageSupprimer(chemins) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  try { await fetch(`${url}/storage/v1/object/render-media`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, apikey: key }, body: JSON.stringify({ prefixes: chemins }) }) } catch (_) {}
}
const OMNI_CR_SEC = LIPSYNC_CR_SEC.omnihuman
const PROMPT_OMNI = 'A person talking directly to camera in a candid selfie video, natural and authentic. Precise lip-sync: the mouth shapes match every syllable and pause of the audio exactly, clear articulation, visible teeth and tongue when the sounds call for it. Expressive, lively face: genuine smiles, raised eyebrows, emotion in the eyes, natural blinks and small head movements. Natural hand gestures that illustrate what is said, hands anatomically correct with five fingers. Keep the framing close to the original photo, static background, no camera movement.'
async function falProxy(path, init = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return fetch(`${url}/functions/v1/fal-proxy?path=${encodeURIComponent(path)}`, {
    ...init, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, apikey: key, ...(init.headers || {}) } })
}
async function storageDepotSigne(chemin, buf, mime) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const up = await fetch(`${url}/storage/v1/object/render-media/${chemin}`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': mime, 'x-upsert': 'true' }, body: buf })
  if (!up.ok) throw new Error(`dépôt ${chemin} : HTTP ${up.status}`)
  const sg = await fetch(`${url}/storage/v1/object/sign/render-media/${chemin}`, { method: 'POST', headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) })
  const d = await sg.json().catch(() => ({}))
  if (!d.signedURL) throw new Error(`URL signée ${chemin} indisponible`)
  return `${url}/storage/v1${d.signedURL}`
}
// photo → JPEG ≤ 5 Mo (fal refuse au-delà ; un PNG HD pèse 8 Mo)
function jpegPourFal(buf, tmpDir) {
  const src = join(tmpDir, `fal-src-${Date.now()}.png`), out = src.replace(/\.png$/, '.jpg')
  writeFileSync(src, buf)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-q:v', '2', out])
  const j = readFileSync(out); try { rmSync(src); rmSync(out) } catch (_) {}
  return j
}
// Omni par fal : fichiers temporaires déposés puis SUPPRIMÉS une fois le clip récupéré
async function omniViaFal(photoBuf, audioBuf, prompt, tmpDir, tag) {
  const jpg = jpegPourFal(photoBuf, tmpDir)
  const base = `omni-tmp/${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const fichiers = [base + '.jpg', base + '.wav']
  const imageUrl = await storageDepotSigne(fichiers[0], jpg, 'image/jpeg')
  const audioUrl = await storageDepotSigne(fichiers[1], audioBuf, 'audio/wav')
  try {
    // crochet de TEST (jamais en prod) : LIPSYNC_TEST_REQ=<request_id fal déjà terminé> → on ne
    // soumet rien (0 $), on rejoue le poll/téléchargement/cache/compositing sur ce clip.
    if (process.env.LIPSYNC_TEST_REQ) { console.log(`▶ Omni : TEST — requête ${process.env.LIPSYNC_TEST_REQ} réutilisée, rien soumis`); return await omniPoll(process.env.LIPSYNC_TEST_REQ) }
    const sub = await falProxy(OMNI_PATH, { method: 'POST', body: JSON.stringify({ image_url: imageUrl, audio_url: audioUrl, resolution: '1080p', prompt }) })
    if (!sub.ok) throw new Error(`Omni (fal) submit HTTP ${sub.status} ${(await sub.text()).slice(0, 120)}`)
    const sd = await sub.json().catch(() => ({}))
    const reqId = sd.request_id || sd.requestId
    if (!reqId) throw new Error('Omni (fal) : pas de request_id')
    return await omniPoll(reqId)
  } finally { await storageSupprimer(fichiers) }
}
// Omni par Hedra (même contrat que Hedra Avatar) ; fal en secours
async function omniGenerer(photoBuf, audioBuf, prompt, tmpDir, tag, hedraImg, ratio) {
  if (String(process.env.LIPSYNC_TEST_REQ || '')) return omniViaFal(photoBuf, audioBuf, prompt, tmpDir, tag)
  if (hedraImg && tmpDir && !/^fal$/i.test(String(process.env.OMNI_VIA || ''))) {
    try {
      const audioUp = await hedraV3Upload(audioBuf, 'audio/wav', `${tag}.wav`)
      if (!audioUp) throw new Error('upload audio refusé')
      const jobId = await hedraV3Submit(HEDRA_OMNI_SLUG, { prompt, aspect_ratio: ratio, resolution: '1080p', start_image: hedraImg, audio: audioUp })
      if (!jobId) throw new Error('submit refusé')
      const url = await hedraV3Poll(jobId, 110)
      if (!url) throw new Error('pas de vidéo')
      console.log(`▶ Omni : généré chez Hedra (${HEDRA_OMNI_SLUG})`)
      return url
    } catch (e) { console.warn(`▶ Omni chez Hedra a échoué (${e.message}) → secours fal`) }
  }
  return omniViaFal(photoBuf, audioBuf, prompt, tmpDir, tag)
}
async function omniPoll(reqId, maxTries = 90) {
  for (let k = 0; k < maxTries; k++) {
    await new Promise((r) => setTimeout(r, 5000))
    const st = await falProxy(`${OMNI_QUEUE}/requests/${reqId}/status`, { method: 'GET' })
    if (!st.ok) continue
    const d = await st.json().catch(() => ({}))
    const s = String(d.status || '').toUpperCase()
    if (s === 'IN_QUEUE' || s === 'IN_PROGRESS') continue
    if (s !== 'COMPLETED') throw new Error(`Omni ${s}${d.error ? ' : ' + String(d.error).slice(0, 80) : ''}`)
    const rr = await falProxy(`${OMNI_QUEUE}/requests/${reqId}`, { method: 'GET' })
    const rd = await rr.json().catch(() => ({}))
    const url = rd?.video?.url || rd?.video_url
    // une requête COMPLETED peut porter une ERREUR (file_too_large…) : on la remonte telle quelle
    if (!url) throw new Error('Omni : ' + (rd?.detail ? JSON.stringify(rd.detail).slice(0, 140) : 'URL de vidéo introuvable'))
    return url
  }
  throw new Error('Omni : timeout (> 7 min)')
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

// #136 · position verticale du crop (0..1) pour la moitié basse du split : on
// détecte le visage sur UNE frame (clip lipsync sinon photo) et on vise le
// cadrage standard — centre du visage à 32 % de la bande visible (la même
// règle que le cadrage auto du Motion Control). null = détection impossible,
// le moteur garde son biais par défaut.
async function cadrageVisageSplit(w, proj, avatarClips, regle = 'centre') {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const clipRel = Number.isInteger(w.clip) && w.clip >= 0 ? avatarClips['av' + w.clip] : null
  let src = clipRel && existsSync(join(proj, clipRel)) ? join(proj, clipRel) : null
  const isVid = !!src
  if (!src) {
    const ph = String(w.photo || '')
    // la photo par défaut vit dans media/ (pool à une seule image : la rotation ne pose
    // pas w.photo, et `proj/avatar.png` n'existe pas → la détection rendait null en silence)
    src = ph && existsSync(join(proj, ph)) ? join(proj, ph)
      : existsSync(join(proj, 'media', 'avatar.png')) ? join(proj, 'media', 'avatar.png')
      : existsSync(join(proj, 'avatar.png')) ? join(proj, 'avatar.png') : null
  }
  if (!src) return null
  const frame = join(proj, '_split-face.jpg')
  execFileSync('ffmpeg', isVid
    ? ['-v', 'error', '-y', '-ss', '0.6', '-i', src, '-frames:v', '1', '-vf', 'scale=560:-2', frame]
    : ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', 'scale=560:-2', frame])
  const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).toString().trim().split(',').map(Number)
  const [vw, vh] = dims.length >= 2 && dims[0] > 0 ? dims : [1080, 1920]
  const b64 = 'data:image/jpeg;base64,' + readFileSync(frame).toString('base64')
  try { rmSync(frame, { force: true }) } catch (_) {}
  const body = { model: 'gpt-4o', max_tokens: 80, temperature: 0, messages: [{ role: 'user', content: [
    { type: 'text', text: 'Give ONLY a compact JSON object with keys x, y, w, h = the bounding box of the MAIN person face and head as fractions from 0 to 1 (x,y = top-left corner, w,h = width and height). Example: {"x":0.42,"y":0.30,"w":0.16,"h":0.20}. If there is no clear human face, output {"none":true}. Output JSON only, no other text.' },
    { type: 'image_url', image_url: { url: b64 } } ] }] }
  const r = await fetch(url + '/functions/v1/openai-proxy?path=' + encodeURIComponent('/v1/chat/completions'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, apikey: key },
    body: JSON.stringify(body) })
  if (!r.ok) return null
  const d = await r.json().catch(() => ({}))
  const m = String(d?.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  const j = JSON.parse(m[0])
  if (j.none || typeof j.y !== 'number' || typeof j.h !== 'number') return null
  // bande visible = cover de la source dans une moitié 1080×960
  const bandFrac = Math.min(1, (vw / vh) / (1080 / 960))
  if (bandFrac >= 0.999) return null
  // slam (Axel 23/08 : « il faut que les cheveux touchent et arrivent au séparateur ») :
  // le HAUT de la tête affleure le bord haut de la bande — 1 % d'air, jamais de crâne coupé.
  if (regle === 'cheveux') return Math.max(0, Math.min(1, (Math.max(0, j.y - 0.01)) / (1 - bandFrac)))
  const fy = Math.max(0, Math.min(1, j.y + j.h / 2))
  return Math.max(0, Math.min(1, (fy - 0.32 * bandFrac) / (1 - bandFrac)))
}

// « Est-ce un selfie ? » — gpt-4o (openai-proxy), une vignette 560 px, réponse JSON.
// Dans le doute (proxy KO, réponse illisible) : NON — une caméra fixe ne gêne jamais,
// un tremblement sur un plan trépied se voit.
async function estSelfie(photoAbs) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !existsSync(photoAbs)) return false
  const frame = photoAbs.replace(/\.[a-z0-9]+$/i, '') + '_selfie.jpg'
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', photoAbs, '-frames:v', '1', '-vf', 'scale=560:-2', frame])
  const b64 = 'data:image/jpeg;base64,' + readFileSync(frame).toString('base64')
  try { rmSync(frame, { force: true }) } catch (_) {}
  const body = { model: 'gpt-4o', max_tokens: 40, temperature: 0, messages: [{ role: 'user', content: [
    { type: 'text', text: 'Is this photo a SELFIE — taken by the subject themselves with a phone held at arm\'s length (close-up, slightly low or high angle, arm or shoulder reaching toward the camera)? Answer ONLY a compact JSON object {"selfie": true} or {"selfie": false}.' },
    { type: 'image_url', image_url: { url: b64 } } ] }] }
  const r = await fetch(url + '/functions/v1/openai-proxy?path=' + encodeURIComponent('/v1/chat/completions'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, apikey: key },
    body: JSON.stringify(body) })
  if (!r.ok) return false
  const d = await r.json().catch(() => ({}))
  const m = String(d?.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/)
  if (!m) return false
  try { return JSON.parse(m[0]).selfie === true } catch (_) { return false }
}

async function genererFenetresG(plan, proj, jobDir, avatarClips) {
  const fen = (plan.avatarSegments || []).filter((w) => /^G\d+$/.test(String(w.clip)))
  if (!fen.length) return 0
  if (!existsSync(join(proj, 'media', 'avatar.png'))) { console.warn('fenêtres G : pas de photo avatar'); return 0 }
  const voix = existsSync(join(jobDir, 'voice.wav')) ? join(jobDir, 'voice.wav') : join(jobDir, 'base.mp4')
  if (!existsSync(voix)) return 0
  const photo = readFileSync(join(proj, 'media', 'avatar.png'))
  let startImg = null, faits = 0
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
    const cle = cleLipsync(photo, audioBuf, '9:16', HEDRA_SLUG)
    const out = join(proj, 'media', 'av' + w.clip + '.mp4')
    let clip = await cacheLire(cle)
    if (clip) console.log(`♻︎ fenêtre ${w.clip} : ${r2(w.start)}→${r2(w.end)}s reprise du cache — ${Math.round(dur * HEDRA_CR_SEC)} crédits économisés`)
    else {
      if (!startImg) startImg = await hedraV3Upload(photo, 'image/png', 'avatar.png')
      if (!startImg) { console.warn('fenêtres G : upload de la photo refusé'); break }
      const audioUp = await hedraV3Upload(audioBuf, 'audio/mpeg', `voice-${w.clip}.mp3`)
      if (!audioUp) { console.warn(`fenêtre ${w.clip} : upload audio refusé`); continue }
      const jobId = await hedraV3Submit(HEDRA_SLUG, {
        prompt: 'A charismatic person speaking straight to camera, highly expressive and animated UGC influencer style — big natural smiles, raised eyebrows, visible enthusiasm and emotion, lively dynamic facial expressions, natural head tilts and movement, expressive hand gestures while speaking, high energy confident delivery, engaging and magnetic, direct eye contact, precise accurate lip-sync with mouth movements exactly matching the audio',
        aspect_ratio: '9:16', resolution: '1080p', start_image: startImg, audio: audioUp,
      })
      if (!jobId) { console.warn(`fenêtre ${w.clip} : Hedra submit refusé`); continue }
      const url = await hedraV3Poll(jobId)
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
  // MIX réservé au compte dev/owner pour le moment : sinon on retombe sur Hedra (le défaut).
  if (String(plan.lipsyncModel || '').toLowerCase() === 'mix' && !(await estOwner(RENDER_USER))) {
    console.log('▶ lipsync : mode mix réservé au compte dev → repli hedra'); plan.lipsyncModel = 'hedra'
  }
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

  // ── LA PHOTO PART AU RATIO DE SORTIE (Axel 23/08, mesuré) ──────────────────────
  // Hedra IGNORE aspect_ratio et rend au ratio de la photo : TOM en 2:3 → clip 1084×1624,
  // agrandi de 18 % au compositing plein cadre (1080×1920) = mollesse gratuite. On recadre
  // donc la photo au ratio demandé (9:16 portrait, 16:9 paysage) AVANT l'envoi — centré,
  // sans rien déformer — et Hedra sort du 1080×1920 natif. Le recadrage est mis en cache
  // par (photo, ratio) ; la clé du cache lipsync porte la photo recadrée.
  const cadres = new Map()
  function cadrerPourHedra(absPath, ratio) {
    const k = absPath + '|' + ratio
    if (cadres.has(k)) return cadres.get(k)
    let buf = readFileSync(absPath)
    try {
      const [iw, ih] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', absPath]).toString().trim().split(',').map(Number)
      const cible = ratio === '16:9' ? 16 / 9 : 9 / 16
      if (iw > 0 && ih > 0 && Math.abs(iw / ih - cible) > 0.02) {
        const out = absPath.replace(/\.[a-z0-9]+$/i, '') + (ratio === '16:9' ? '-169' : '-916') + '.png'
        const crop = iw / ih > cible ? `crop=ih*${cible.toFixed(5)}:ih` : `crop=iw:iw/${cible.toFixed(5)}`
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', absPath, '-vf', crop, '-frames:v', '1', out])
        buf = readFileSync(out)
        console.log(`▶ lipsync : photo ${absPath.split('/').pop()} recadrée en ${ratio} (${iw}×${ih} → sortie Hedra native)`)
      }
    } catch (e) { console.warn('recadrage photo Hedra :', e.message) }
    cadres.set(k, buf)
    return buf
  }
  const photoDefaut = cadrerPourHedra(join(proj, 'media', 'avatar.png'), '9:16')
  const imgDefaut = await hedraV3Upload(photoDefaut, 'image/png', 'avatar.png')
  if (!imgDefaut) { console.warn('lipsync : upload de la photo refusé'); return 0 }
  // #84 · ROTATION DANS LE LIPSYNC : chaque fenêtre parle sur SON image (w.photo,
  // posée avant l'appel). Upload-cachée par chemin → 3 visages = 3 uploads, pas
  // un par scène. Sans w.photo (ou fichier absent) : la photo par défaut.
  const imgParPhoto = new Map()
  const photoDe = async (w) => {
    const ratio = String(w.format) === 'paysage' ? '16:9' : '9:16'
    const rel = String(w.photo || '')
    const abs = rel ? join(proj, rel) : ''
    if (!abs || !existsSync(abs)) {
      if (ratio === '9:16') return { buf: photoDefaut, img: imgDefaut }
      const k0 = 'media/avatar.png|' + ratio
      if (!imgParPhoto.has(k0)) { const buf = cadrerPourHedra(join(proj, 'media', 'avatar.png'), ratio); const img = await hedraV3Upload(buf, 'image/png', 'avatar-169.png'); imgParPhoto.set(k0, img ? { buf, img } : { buf: photoDefaut, img: imgDefaut }) }
      return imgParPhoto.get(k0)
    }
    const k = rel + '|' + ratio
    if (!imgParPhoto.has(k)) {
      const buf = cadrerPourHedra(abs, ratio)
      const img = await hedraV3Upload(buf, 'image/png', rel.split('/').pop())
      imgParPhoto.set(k, img ? { buf, img } : { buf: photoDefaut, img: imgDefaut })
    }
    return imgParPhoto.get(k)
  }

  // ── LES OCTETS BRUTS D'HEDRA NE VONT JAMAIS DIRECTEMENT AU RENDU ──────────
  // Les clips fournis par l'app (jobDir/avatar) passent tous par un ré-encodage
  // 50 i/s avant compositing — depuis des mois, sans un raté. Ce chemin-ci
  // (génération + cache) écrivait les octets Hedra TELS QUELS (25 i/s), et
  // c'est sur EUX, et eux seuls, que l'extracteur d'HyperFrames plantait sur
  // Railway (« captured 0 of expected N frames », l'entrée du clip disparaît
  // de l'extraction — 4 rendus perdus le 08/08 avant de trouver ça). Même
  // moulinette pour tout le monde : mêmes réglages que le chargeur jobDir.
  // ── LOOK « FILM » SUR L'AVATAR (Axel 23/08 : grain + étalonnage) ───────────────
  // Un clip IA sort lisse et un peu lavé : un contraste légèrement relevé, une
  // saturation à peine retenue, un grain luma TEMPOREL fin (jamais de neige), une
  // vignette douce et une pointe de netteté lui rendent une texture de capteur — et
  // l'unifient avec les cartes. Défaut en slam ; plan.lookFilm true/false force.
  const lookFilm = plan.lookFilm === true || (plan.lookFilm !== false && plan.slideStyle === 'slam')
  const FILM_VF = 'eq=contrast=1.05:saturation=0.92:gamma=0.99,unsharp=3:3:0.35:3:3:0,noise=c0s=6:c0f=t+u,vignette=angle=PI/5.2'
  if (lookFilm) console.log('▶ avatar : look film (grain + étalonnage)')
  // 25 → 50 i/s par INTERPOLATION (mouvement compensé) plutôt que par doublage de frames :
  // la bouche et les mains gagnent en fluidité. ~10× temps réel en CPU → défaut pour Omni
  // (on a payé la qualité), opt-in pour Hedra via plan.fluide50 (true = tous, false = aucun).
  const fluide = (modele) => plan.fluide50 === true || (plan.fluide50 !== false && modele === 'omnihuman')
  function normaliserClipAvatar(nom, modele = 'hedra') {
    const fini = join(proj, 'media', nom)
    const brut = join(proj, 'media', nom.replace(/\.mp4$/, '-brut.mp4'))
    try {
      renameSync(fini, brut)
      let srcFps = 0
      try { const [a, b] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', brut]).toString().trim().split('/').map(Number); srcFps = b ? a / b : a } catch (_) {}
      const cadence = fluide(modele) && srcFps > 0 && srcFps < FPS - 5
        ? `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1` : `fps=${FPS}`
      if (cadence.startsWith('minterpolate')) console.log(`▶ ${nom} : ${Math.round(srcFps)} → ${FPS} i/s par interpolation`)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', brut,
        '-vf', `scale='min(1080,iw)':-2,${cadence}${lookFilm ? ',' + FILM_VF : ''}`, '-an',
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
  let file0 = (plan.avatarSegments || []).map((w, i) => ({ w, i })).filter((t) => (t.w.end - t.w.start) >= 1 && !t.w.noLipsync)
  if (process.env.LIPSYNC_TEST_REQ) { file0 = file0.slice().sort((a, b) => a.w.start - b.w.start).slice(0, 1); console.log('▶ lipsync : TEST — première fenêtre seulement') }
  // ── DES FENÊTRES QUI SE SUIVENT SUR LE MÊME VISAGE = UN SEUL CLIP (Axel 23/08) ──
  // Hook plein cadre → split → plein cadre : trois fenêtres collées (2,3→6,3→9,9→13,3 s)
  // sur la même photo. Générées séparément, chacune REPART de la pose de la photo :
  // trois redémarrages visibles. Une seule génération couvrant la suite, découpée
  // ensuite par fenêtre, garde le mouvement continu — même coût (Hedra facture la
  // seconde), un seul upload, et un seul clip au cache. Plafond : LIPSYNC_MAX + 2.
  const file = []
  for (const t of file0.slice().sort((a, b) => a.w.start - b.w.start)) {
    const g = file[file.length - 1]
    if (g && t.w.start - g.w.end < 0.15 && String(t.w.photo || '') === String(g.w.photo || '')
      && String(t.w.format || 'portrait') === String(g.w.format || 'portrait')
      && (t.w.end - g.w.start) <= LIPSYNC_MAX + 2) {
      g.parts.push(t); g.w = { ...g.w, end: t.w.end }
    } else file.push({ w: { ...t.w }, i: t.i, parts: [t] })
  }
  for (const g of file) if (g.parts.length > 1) console.log(`▶ lipsync : fenêtres ${g.parts.map((x) => x.i).join('+')} (${r2(g.w.start)}→${r2(g.w.end)}s) générées en UN clip continu`)
  // modèle d'un groupe : surcharge de fenêtre > plan ; 'mix' = Omni sur le PREMIER groupe
  // continu (le hook), Hedra sur les autres
  const modeleDe = (g, idx) => {
    const m = String(g.parts[0].w.lipsyncModel || plan.lipsyncModel || 'hedra').toLowerCase()
    if (m === 'mix') return idx === 0 ? 'omnihuman' : 'hedra'
    return m === 'omnihuman' || m === 'omni' ? 'omnihuman' : 'hedra'
  }
  const file0idx = new Map(file.map((g, k) => [g, k]))
  console.log(`▶ lipsync : modèle ${String(plan.lipsyncModel || 'hedra')} → ${file.map((g, k) => `${g.parts.map((x) => x.i).join('+')}=${modeleDe(g, k)}`).join(' · ')}`)
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
        try { ok = await uneScene(t.w, t.i, t.parts, modeleDe(t, file0idx.get(t))) } catch (e) { pourquoi = e.message }
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
      // le clip généré ici commence PILE au début de la fenêtre : un `clipAt`/`clipUntil`
      // hérité de la dérivation (calé sur un clip d'origine qui n'existe pas) laissait la
      // PHOTO figée jusqu'à 9,58 s dans le split (Axel 23/08 : « le lipsync du split n'est pas fait »)
      if (ok) { for (const pt of t.parts) { pt.w.clip = pt.i; delete pt.w.clipAt; delete pt.w.clipUntil; pt.w.clipFrom = 0; faits++ }; console.log(`✓ lipsync scène ${t.parts.map((x) => x.i).join('+')} : ${r2(t.w.start)}→${r2(t.w.end)}s (${t.w.format || 'portrait'})`) }
      else console.warn(`✗ lipsync scène ${t.i} ABANDONNÉE : ${r2(t.w.start)}→${r2(t.w.end)}s (${t.w.format || 'portrait'})${pourquoi ? ' — ' + pourquoi : ''} → la photo restera figée sur cette fenêtre`)
    }
  })

  // ── EXPRESSION ET MAINS (Axel 23/08 : « de l'expression sur son visage, et qu'il parle
  //    avec les mains ») : en slam (ou plan.lipsyncExpressif) le prompt demande un jeu de
  //    visage vivant et des gestes — clé de cache distincte des clips sobres.
  const expressif = plan.lipsyncExpressif === true || (plan.lipsyncExpressif !== false && plan.slideStyle === 'slam')
  const PROMPT_SOBRE = 'A person talking naturally to camera, UGC style, authentic, direct gaze, precise accurate lip-sync, mouth movements matching the audio'
  const PROMPT_EXPRESSIF = 'A charismatic person speaking straight to camera, highly expressive and animated UGC influencer style — big natural smiles, raised eyebrows, visible enthusiasm and emotion, lively dynamic facial expressions, natural head tilts and movement, expressive hand gestures while speaking, high energy confident delivery, engaging and magnetic, direct eye contact, precise accurate lip-sync with mouth movements exactly matching the audio'
  if (expressif) console.log('▶ lipsync : prompt EXPRESSIF (visage vivant + gestes des mains)')
  // découpe d'un clip de GROUPE en un clip par fenêtre (décalage = début de la fenêtre
  // dans le groupe ; +0,3 s de matière, le moteur coupe au panneau)
  function decouperParties(groupClip, w, parts, modele = 'hedra') {
    for (const pt of parts) {
      const out = join(proj, 'media', `av${pt.i}.mp4`)
      if (parts.length === 1) { if (groupClip !== out) copyFileSync(groupClip, out) }
      else {
        const from = Math.max(0, pt.w.start - w.start), d = (pt.w.end - pt.w.start) + 0.3
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(r2(from)), '-t', String(r2(d)), '-i', groupClip, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', String(FPS), '-movflags', '+faststart', out])
      }
      normaliserClipAvatar(`av${pt.i}.mp4`, modele)
      avatarClips['av' + pt.i] = 'media/av' + pt.i + '.mp4'
    }
  }

  async function uneScene(w, i, parts = [{ w, i }], modele = 'hedra') {
    // #84 · l'image de CETTE fenêtre (rotation) — la clé de cache et le keyframe
    // Hedra en découlent : chaque visage parle sur la bonne photo.
    const { buf: photo, img: startImg } = await photoDe(w)
    const omni = modele === 'omnihuman'
    // ── HEDRA REFUSE EN DESSOUS DE 3,24 s ────────────────────────────────────
    // Contrainte mesurée et documentée. On étire la tranche vers la DROITE si
    // la vidéo le permet : le clip sera de toute façon recoupé à la fenêtre.
    const dur = Math.max(3.3, w.end - w.start)
    const mp3 = join(proj, `ls${i}.mp3`)
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(w.start), '-t', String(dur),
        '-i', voix, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', mp3])
    } catch (e) { console.warn(`lipsync scène ${i} : découpe impossible`); return false }
    // Omni reçoit du WAV (format validé chez fal et Hedra) — la clé de cache reste sur le mp3
    let wavBuf = null
    if (omni) { const wav = join(proj, `ls${i}.wav`); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp3, '-ac', '1', '-ar', '44100', wav]); wavBuf = readFileSync(wav) }

    // ── LE CACHE PASSE AVANT LA CAISSE ──────────────────────────────────────
    // Découper l'audio est gratuit et local ; c'est seulement APRÈS qu'on sait
    // quels octets partent chez Hedra, donc c'est ici — et pas plus haut — que
    // la clé peut être calculée. Un hit rend la scène instantanée ET gratuite.
    const ratio = String(w.format) === 'paysage' ? '16:9' : '9:16'
    const audioBuf = readFileSync(mp3)
    const cle = cleLipsync(photo, audioBuf, ratio, omni ? 'omnihuman-1.5' : HEDRA_SLUG, omni ? '' : expressif ? 'expressif' : '')
    const cout = Math.round(dur * (omni ? OMNI_CR_SEC : HEDRA_CR_SEC))
    const dejaPaye = await cacheLire(cle)
    if (dejaPaye) {
      const grp = join(proj, 'media', `grp${i}.mp4`)
      writeFileSync(grp, dejaPaye)
      decouperParties(grp, w, parts, modele)
      economie += cout
      console.log(`♻︎ lipsync scène ${i} : ${r2(w.start)}→${r2(w.end)}s repris du cache — ${cout} crédits économisés`)
      return true
    }

    // ── DÉBIT AVANT L'APPEL FOURNISSEUR (jamais sur un cache hit, remboursé si échec) ──
    const facture = await debiterLipsync(dur, modele)
    if (!facture.ok) { console.warn(`✗ lipsync scène ${i} : ${facture.pourquoi} → la photo reste`); return false }
    if (!facture.local) console.log(`▶ lipsync scène ${i} : ${facture.n} crédit(s) débités (${modele}, ${r2(dur)} s)`)
    let url = null
    try {
    if (omni) {
      // OmniHuman : photo recadrée (même ratio de sortie) → Hedra (secours fal)
      url = await omniGenerer(photo, wavBuf || audioBuf, String(plan.lipsyncPrompt || PROMPT_OMNI), join(proj, 'media'), `s${i}`, startImg, ratio)
    } else {
      const audioUp = await hedraV3Upload(audioBuf, 'audio/mpeg', `voice${i}.mp3`)
      if (!audioUp) { console.warn(`lipsync scène ${i} : upload audio refusé`); return false }
      const jobId = await hedraV3Submit(HEDRA_SLUG, {
        prompt: expressif ? PROMPT_EXPRESSIF : PROMPT_SOBRE,
        aspect_ratio: String(w.format) === 'paysage' ? '16:9' : '9:16',
        resolution: '1080p', start_image: startImg, audio: audioUp,
      })
      if (!jobId) { console.warn(`lipsync scène ${i} : Hedra submit refusé`); return false }
      // polling — Avatar rend en 1 à 3 min pour une scène courte
      url = await hedraV3Poll(jobId)
    }
    } catch (e) { await rembourserLipsync(facture.local ? 0 : facture.n); throw e }
    if (!url) { await rembourserLipsync(facture.local ? 0 : facture.n); console.warn(`lipsync scène ${i} : pas de vidéo (crédits remboursés)`); return false }

    const res = await fetch(url)
    if (!res.ok) { await rembourserLipsync(facture.local ? 0 : facture.n); console.warn(`lipsync scène ${i} : téléchargement ${res.status} (crédits remboursés)`); return false }
    const grp = join(proj, 'media', `grp${i}.mp4`)
    const clip = Buffer.from(await res.arrayBuffer())
    writeFileSync(grp, clip)
    // Payé une fois : on range les octets BRUTS au cache AVANT de normaliser —
    // la normalisation dépend du fps de rendu, le cache doit rester neutre.
    await cacheEcrire(cle, clip, dur)
    decouperParties(grp, w, parts, modele)
    depense += cout
    console.log(`▶ lipsync scène ${i} : ${r2(w.start)}→${r2(w.end)}s (${w.format || 'portrait'}, ${modele}) — ${cout} crédits`)
    return true
  }

  console.log(`▶ lipsync : ${segs.length} scène(s) lancée(s) en parallèle (${PARALLELE} à la fois)`)
  await Promise.all(equipes)
  console.log(`▶ lipsync : ${depense} crédit(s) dépensé(s)${economie ? `, ${economie} économisé(s) par le cache` : ''}`)

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
      if (!job) { await new Promise((r) => setTimeout(r, 2000)); continue }   // #vitesse (02/09) : 5 s → 2 s de latence de prise

      // claim atomique : queued → rendering (un seul worker gagne)
      const { data: claimed } = await sb.from('render_jobs')
        .update({ status: 'rendering', updated_at: new Date().toISOString(), attempts: (job.attempts || 0) + 1 })
        .eq('id', job.id).eq('status', 'queued').select('id')
      if (!claimed || !claimed.length) continue

      jobEnCours = job.id

      // ── DÉCLENCHEUR « ANIMS BLANCHES » ────────────────────────────────────
      // Un job dont le plan porte __batchBlank ne rend pas un montage : il
      // (re)génère les aperçus d'anims blanches pour l'éditeur, puis se marque
      // terminé. Inséré à la main (SQL : render_jobs {status:'queued',
      // plan:{__batchBlank:true}}). Idempotent — upsert dans le bucket public.
      if (job.plan && job.plan.__batchBlank) {
        try {
          await batchBlankPreviews({ list: job.plan.anims || null, draft: job.plan.draft !== false, style: job.plan.style || 'auto', prefix: job.plan.prefix || 'blank' })
          await sb.from('render_jobs').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', job.id)
          console.log('✓ batch anims blanches terminé')
        } catch (e) {
          console.error('✗ batch anims blanches :', e.message)
          await sb.from('render_jobs').update({ status: 'failed', error: String(e.message || e).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', job.id)
        }
        jobEnCours = null
        continue
      }

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
        // #montage-audio : son optionnel fourni par l'utilisateur (musique / bruitages) → mixé au montage
        if (job.plan && job.plan.userAudioPath) {
          try {
            const aext = (String(job.plan.userAudioPath).match(/\.(\w{2,4})$/) || [])[1] || 'mp3'
            await dl(job.plan.userAudioPath, join(jobDir, 'useraudio.' + aext))
            job.plan.userAudio = 'useraudio.' + aext
          } catch (e) { console.warn('audio utilisateur non téléchargé:', e && e.message) }
        }
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
        await renderJob(jobDir, out, { userId: job.user_id || null })

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
        // 23/08 — PLAN PRO : la limite du projet est passée à 500 Mo (config storage
        // `fileSizeLimit`, réglée via l'API de management). Plus AUCUN montage n'est
        // dégradé : pleine qualité quelle que soit la durée, le ré-encodage ne reste
        // qu'en filet de sécurité sous le nouveau plafond (480 Mo).
        const durF = (() => { try { return parseFloat(ffprobe(out, 'format=duration')) || 60 } catch (_) { return 60 } })()
        const MAX_UP = 480 * 1024 * 1024
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

// ══ BATCH « ANIMS BLANCHES » POUR L'ÉDITEUR ═══════════════════════════════════
// L'éditeur pose des animations que l'utilisateur remplit LUI-MÊME : il lui faut
// donc les mêmes anims que le Montage IA mais SANS le texte/logo d'exemple (« Un »,
// « Deux », les logos codés). On rend ici chaque anim « à personnaliser » en mode
// _blank (cf. anim-pack.mjs : txt()/imgSlot() renvoient vide) sur le MÊME fond de
// scène plein-cadre que les aperçus normaux, puis on la range dans le bucket PUBLIC
// `anim-previews/blank/<nom>.mp4` (l'éditeur, statique, la lit sans clé).
//
// Déclenché à la main : `node render-worker/worker.mjs --batch-blank`
//   --only <nom>       une seule anim (test)
//   --anims a,b,c      liste explicite
//   --draft            rendu rapide 30 fps (défaut : draft, ces aperçus n'ont pas
//                      besoin du 50 fps ; c'est du muet 540×960 comme les aperçus)
// Rien à faire côté Axel une fois lancé : ça rend + ça pousse tout seul.
const BLANK_ANIMS = [
  // les 48 anims « à contenu » du Montage IA (texte que l'utilisateur remplace)
  'type', 'upload', 'funnel', 'flow', 'quality', 'free', 'trend', 'hook', 'profile',
  'invoice', 'thumb', 'pay', 'sales', 'upgrade', 'discount', 'keyword', 'product',
  'cart', 'portfolio', 'pnl', 'mrr', 'churn', 'onboarding', 'property', 'weight',
  'quote', 'script', 'trendsound', 'loop', 'clipping', 'retake', 'preview', 'spike',
  'brandeal', 'mediakit', 'inventory', 'stoploss', 'orderbook', 'deploy', 'uptime',
  'leads', 'share', 'views', 'linkbio', 'salesphone', 'gaugefill', 'lineup', 'daypart',
  // + les anims à IMAGES (logos personnalisables via imgSlot)
  'tools', 'connect', 'copy',
]

async function batchBlankPreviews({ list = null, draft = true, style = 'auto', prefix = 'blank' } = {}) {
  const SUPA = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPA || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants — impossible de pousser les aperçus')
  if (!Array.isArray(list) || !list.length) list = BLANK_ANIMS
  // `style` : 'auto' = fond clair (legacy) ; 'slam' = fond SOMBRE à carreaux (façon
  // Cartoon 15). `prefix` range chaque variante dans son dossier du bucket public.

  // fond de base commun : noir 1080×1920 muet 1,8 s (la scène plein-cadre le couvre).
  const baseSrc = join(tmpdir(), 'aa-blank-base.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=30',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', '1.8', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', baseSrc])

  const done = []
  const failed = []
  for (const anim of list) {
    const job = mkdtempSync(join(tmpdir(), 'aa-blank-'))
    try {
      copyFileSync(baseSrc, join(job, 'base.mp4'))
      // plan minimal : UNE scène plein-cadre = l'anim, en mode blanc. La variante
      // « dark » reste sur le moteur LEGACY (auto) — qui SAIT rendre une anim
      // plein-cadre isolée (le moteur dynamique la rend noire) — et pose _blankDark :
      // contenu clair + fond sombre à carreaux (.fslide.blankdark).
      const dark = style === 'dark' || style === 'slam'
      writeFileSync(join(job, 'plan.json'), JSON.stringify({
        slideStyle: 'auto', duration: 1.8,
        slides: [{ id: 'a0', anim, layout: 'full', start: 0, end: 1.8, _blank: true, _blankDark: dark, items: [] }],
        sections: [{ start: 0, end: 1.8 }], captions: [], beats: [], broll: [], avatarSegments: [], tuto: [], sfx: [],
      }))
      const out1080 = join(job, 'out.mp4')
      console.log(`▶ anim blanche « ${anim} »…`)
      await renderJob(job, out1080, { draft, userId: null })
      // aperçu final : 540×960, muet, faststart (même format que anim-previews/).
      const out540 = join(job, 'blank.mp4')
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', out1080,
        '-vf', 'scale=540:960:flags=lanczos', '-an', '-c:v', 'libx264',
        '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', out540])
      // poster (dernière frame stabilisée) pour l'affiche avant lecture
      const poster = join(job, 'blank.jpg')
      try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.6', '-i', out540, '-vframes', '1', '-q:v', '4', poster]) } catch (_) { /* poster optionnel */ }
      // upload bucket PUBLIC anim-previews/blank/<nom>.mp4 (+ .jpg)
      const push = async (buf, path, mime) => {
        const r = await fetch(`${SUPA}/storage/v1/object/anim-previews/${path}`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + KEY, apikey: KEY, 'Content-Type': mime, 'x-upsert': 'true' }, body: buf,
        })
        if (!r.ok) throw new Error(`upload ${path} → HTTP ${r.status} ${await r.text().catch(() => '')}`)
      }
      await push(readFileSync(out540), `${prefix}/${anim}.mp4`, 'video/mp4')
      // le poster est un CONFORT (affiche avant lecture) — jamais fatal : un échec
      // dessus ne doit pas faire rater l'anim (le .mp4 est déjà en place)
      if (existsSync(poster)) { try { await push(readFileSync(poster), `${prefix}/${anim}.jpg`, 'image/jpeg') } catch (pe) { console.warn(`  poster ${anim} ignoré : ${pe.message}`) } }
      done.push(anim)
      console.log(`  ✓ ${anim} poussée`)
    } catch (e) {
      failed.push(anim)
      console.error(`  ✗ ${anim} : ${e.message}`)
    } finally {
      try { rmSync(job, { recursive: true, force: true }) } catch (_) { /* nettoyage */ }
    }
  }
  // manifeste : la liste des anims qui ONT une version dans ce dossier. On la
  // construit depuis le CONTENU RÉEL du bucket (pas seulement ce run) → un
  // re-rendu partiel n'efface plus les autres.
  let manifest = done
  try {
    const lr = await fetch(`${SUPA}/storage/v1/object/list/anim-previews`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + KEY, apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `${prefix}/`, limit: 1000 }),
    })
    if (lr.ok) {
      const objs = await lr.json()
      const names = (Array.isArray(objs) ? objs : []).map((o) => o && o.name).filter((n) => n && n.endsWith('.mp4')).map((n) => n.replace(/\.mp4$/, ''))
      if (names.length) manifest = [...new Set([...names, ...done])]
    }
  } catch (_) { /* liste optionnelle : on retombe sur `done` */ }
  try {
    await fetch(`${SUPA}/storage/v1/object/anim-previews/${prefix}/index.json`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + KEY, apikey: KEY, 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify(manifest),
    })
  } catch (e) { console.error(`manifeste ${prefix}/index.json :`, e.message) }
  console.log(`\n═══ ${done.length}/${list.length} anims « ${prefix} » poussées${failed.length ? ` · échecs : ${failed.join(', ')}` : ''}`)
  console.log(`Public : ${SUPA}/storage/v1/object/public/anim-previews/${prefix}/<nom>.mp4`)
}

// ── entrée ──
const localDir = flag('--local')
if (flag('--batch-blank') != null) {
  const only = flag('--only'), override = flag('--anims')
  let list = null
  if (typeof only === 'string') list = [only]
  else if (typeof override === 'string') list = override.split(',').map((s) => s.trim()).filter(Boolean)
  const style = typeof flag('--style') === 'string' ? flag('--style') : 'auto'
  const prefix = typeof flag('--prefix') === 'string' ? flag('--prefix') : (style === 'slam' ? 'blank-dark' : 'blank')
  batchBlankPreviews({ list, draft: flag('--draft') != null ? !!flag('--draft') : true, style, prefix })
    .then(() => process.exit(0))
    .catch((e) => { console.error('✗', e.message); process.exit(1) })
} else if (localDir) {
  const out = resolve(flag('--output') || 'final.mp4')
  renderJob(resolve(localDir), out, { draft: !!flag('--draft') })
    .catch((e) => { console.error('✗', e.message); process.exit(1) })
} else {
  // ── KEEP-WARM DU CONNECTEUR MCP ───────────────────────────────────────────
  // « Impossible de joindre AvatarAds » sur les premières requêtes après une
  // période calme : le démarrage à froid de l'edge function dépasse le timeout
  // du client claude.ai (constaté : la requête tombe sur un isolate booté à
  // l'instant, répond en ~1,9 s côté serveur mais claude.ai a déjà lâché). Toutes
  // les 4 min ne suffisait pas (les isolates recyclent entre deux bursts). Le
  // worker tourne 24/7 sur Railway → on garde un PETIT POOL chaud : 3 GET
  // concurrents (route sans clé, quasi gratuite) toutes les 45 s, + un au démarrage.
  if (process.env.SUPABASE_URL) {
    const warm = () => { for (let i = 0; i < 3; i++) fetch(process.env.SUPABASE_URL + '/functions/v1/mcp').catch(() => {}) }
    setInterval(warm, 45000)
    warm()
  }
  pollLoop()
}
