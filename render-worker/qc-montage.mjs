// ── CONTRÔLE QUALITÉ D'UN MONTAGE LIVRÉ (audit 10/10, repris d'usine/qc.mjs) ─────────────────────────────────
// Déterministe, ~0,4 s : ce qu'un œil verrait tout de suite et qu'aucun statut vert ne dit. Écran noir (≥ 0,3 s),
// son absent, muet ou saturé, durée ou résolution inattendues. Le résultat part dans la trace du job (console) :
// il ne bloque jamais une livraison — il rend les défauts VISIBLES au lieu de les découvrir chez un client.
import { spawnSync } from 'node:child_process'

export function qcMontage(video, { dureeVoulue = 0 } = {}) {
  const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 27 }); return (r.stdout || '') + (r.stderr || '') }
  const probe = (a) => sh('ffprobe', ['-v', 'error', ...a]).trim()
  const defauts = []
  const dims = probe(['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video]).split(',')
  const W = +dims[0], H = +dims[1]
  const DUR = parseFloat(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', video])) || 0
  const audio = probe(['-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', video]).includes('audio')
  if (W !== 1080 || H !== 1920) defauts.push(`résolution ${W}x${H}`)
  if (dureeVoulue && Math.abs(DUR - dureeVoulue) > 0.6) defauts.push(`durée ${DUR.toFixed(2)} s pour ${dureeVoulue} s prévues`)
  if (!audio) defauts.push('aucune piste audio')
  const log = sh('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-vf', 'blackdetect=d=0.3:pic_th=0.98', '-af', 'volumedetect', '-f', 'null', '-'])
  const noirs = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(1)}→${(+m[2]).toFixed(1)} s`)
  if (noirs.length) defauts.push(`écran noir ${noirs.join(', ')}`)
  const mMax = /max_volume:\s*(-?[\d.]+) dB/.exec(log), mMean = /mean_volume:\s*(-?[\d.]+) dB/.exec(log)
  if (audio && mMax && +mMax[1] > -0.2) defauts.push(`son saturé (crête ${mMax[1]} dB)`)
  if (audio && mMean && +mMean[1] < -50) defauts.push(`son quasi muet (moyenne ${mMean[1]} dB)`)
  return { ok: !defauts.length, duree: Math.round(DUR * 100) / 100, defauts }
}
