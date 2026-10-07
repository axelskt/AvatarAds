#!/usr/bin/env node
// Creative Factory — empreinte d'une vidéo finale (07/10) pour la reconnaître sur TikTok : l'API TikTok ne donne pas le
// fichier vidéo, seulement sa COUVERTURE (Axel garde celle par défaut = la première image) et sa durée en secondes.
// Empreinte = images à 0 s, 0,5 s et 1 s (dHash 256 bits + vignette 54 × 96 en luminance) + durée. Les calculs sont dans
// supabase/functions/_shared/fp.ts, le MÊME fichier que l'edge tiktok-auth utilise sur la couverture.
// Une vidéo supprimée du stockage après programmation : son poster (<nom>-poster.jpg = première image) suffit, durée inconnue.
// 07/10 (constaté sur @avatarads) : la couverture TikTok n'est PAS la première image mais une image du hook (avant/après
// ouvert, image incrustée, 3e mot du sous-titre) → en plus, 4 images par seconde sur les 10 premières secondes
// (factory_fp_frames : vignettes 18 × 32 pour le pré-tri et 54 × 96 pour le score fin).
//
// usage : node usine/fingerprint.mjs <video_url|fichier.mp4|poster.jpg> [...]   → une ligne JSON par vidéo
//         node usine/fingerprint.mjs --sql <...> [...]                         → SQL d'upsert dans factory_fp
//         node usine/fingerprint.mjs --sql --as <video_url> <fichier local.mp4> → même chose, clé = l'URL publiée
//         (supabase db query --linked -f fichier.sql)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { fpHash, fpThumb, fpCoarse, bytesToB64 } from '../supabase/functions/_shared/fp.ts';

export const FP_TIMES = [0, 0.5, 1];
const W = 540, H = 960;   // = taille des posters du kit (scale=540:-1 sur du 1080 × 1920)

function frameGray(src, t) {
  // pas de -ss à 0 : sur une image lue en https, « -ss 0 » ne sort aucune image
  const buf = execFileSync('ffmpeg', ['-v', 'error', ...(t ? ['-ss', String(t)] : []), '-i', src, '-frames:v', '1',
    '-vf', `scale=${W}:${H}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
  if (buf.length !== W * H) throw new Error(`image ${t} s illisible (${buf.length} octets)`);
  return buf;
}
// 4 images par seconde sur les 10 premières secondes, en un seul passage ffmpeg (≈ 12 Mo lus en https, vidéo faststart)
export const DENSE_FPS = 4, DENSE_S = 10;
export function denseFrames(src) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-t', String(DENSE_S), '-i', src, '-vf', `fps=${DENSE_FPS},scale=${W}:${H}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 });
  const n = Math.floor(buf.length / (W * H)), out = [];
  for (let i = 0; i < n; i++) {
    const th = fpThumb(buf.subarray(i * W * H, (i + 1) * W * H), W, H);
    out.push({ t: +(i / DENSE_FPS).toFixed(2), coarse: bytesToB64(fpCoarse(th)), thumb: bytesToB64(th) });
  }
  return out;
}
export function fingerprint(src) {
  const img = /\.(jpe?g|png)(\?|$)/i.test(src);
  const frames = (img ? [0] : FP_TIMES).map((t) => frameGray(src, t));
  const duration = img ? null : parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString().trim());
  return { duration: duration == null ? null : +duration.toFixed(2), hashes: frames.map((g) => fpHash(g, W, H)),
    thumbs: frames.map((g) => bytesToB64(fpThumb(g, W, H))) };
}

// (chemin avec espace « Autre SaaS » : comparer des chemins, jamais une URL file:// encodée)
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let args = process.argv.slice(2);
  const sql = args[0] === '--sql'; if (sql) args = args.slice(1);
  let as = null; if (args[0] === '--as') { as = args[1]; args = args.slice(2); }
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  for (const src of args) {
    try {
      const fp = fingerprint(src);
      const url = as || src.replace(/-poster\.(jpe?g|png)$/i, '.mp4');   // clé = l'URL de la vidéo (celle de factory_posts)
      const vf = (url.match(/VF-\d{4}/) || [null])[0];
      if (sql) {
        if (fp.duration != null) {   // une vraie vidéo (pas un poster) : images du hook
          const fr = denseFrames(src);
          console.log(`delete from public.factory_fp_frames where video_url = ${q(url)};`);
          for (let i = 0; i < fr.length; i += 20) {
            console.log('insert into public.factory_fp_frames (video_url, t, coarse, thumb) values '
              + fr.slice(i, i + 20).map((f) => `(${q(url)}, ${f.t}, ${q(f.coarse)}, ${q(f.thumb)})`).join(', ') + ';');
          }
        }
        console.log(`insert into public.factory_fp (video_url, vf, duration, hashes, thumbs) values (${q(url)}, ${vf ? q(vf) : 'null'}, ${fp.duration ?? 'null'}, array[${fp.hashes.map(q).join(',')}], array[${fp.thumbs.map(q).join(',')}])`
          + ` on conflict (video_url) do update set vf = excluded.vf, duration = excluded.duration, hashes = excluded.hashes, thumbs = excluded.thumbs, updated_at = now();`);
      } else console.log(JSON.stringify({ src: url, vf, duration: fp.duration, hashes: fp.hashes, thumbs: fp.thumbs }));
    } catch (e) { console.error('✗ ' + src + ' : ' + (e.message || e)); }
  }
}
