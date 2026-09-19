#!/usr/bin/env node
// Creative Factory — TRAITEMENT « selfie tenu à la main » réutilisable (Axel 20/09 : à activer sur CHAQUE
// clip Hedra, et à garder sous la main pour l'appliquer ailleurs). Casse le côté « avatar IA figé » :
//   1) GRAIN (bruit + micro contraste/saturation) → moins plastique
//   2) TREMBLEMENT main tenue « faible » VALIDÉ : vraies fréquences ~1-3 Hz (les fréquences lentes ~0,1 Hz
//      donnaient un cycle de 10-12 s = invisible sur un clip court — piège découvert le 20/09).
// build.mjs applique EXACTEMENT le même traitement au segment CTA (constantes GRAIN/SHAKE) ; ce script sert
// à traiter n'importe quel clip à part (autre module, test, etc.).
// Usage : node usine/selfie-treat.mjs <in.mp4> <out.mp4> [faible|moyen|fort]
import { execFileSync } from 'node:child_process';

const [inp, out, lvlArg] = process.argv.slice(2);
if (!inp || !out) { console.error('usage: selfie-treat.mjs <in> <out> [faible|moyen|fort]'); process.exit(1); }

const VF = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p';
const GRAIN = 'noise=alls=9:allf=t+u,eq=saturation=1.03:contrast=1.02';
// niveaux : [zoom, amplitude px, rotation °]
const LEVELS = { faible: [1.09, 8, 0.4], moyen: [1.14, 18, 0.9], fort: [1.22, 32, 1.7] };
const [s, A, R] = LEVELS[lvlArg] || LEVELS.faible;
const SHAKE = `scale=iw*${s}:ih*${s}:flags=lanczos,`
  + `rotate='(${R}*(sin(5.7*t)+0.4*sin(11.3*t)))*PI/180':c=black,`
  + `crop=1080:1920:x='(iw-1080)/2+${A}*(sin(6.3*t)+0.5*sin(12.9*t+1)+0.3*sin(19.7*t))':`
  + `y='(ih-1920)/2+${A}*(cos(7.1*t)+0.5*sin(13.7*t+0.5)+0.25*sin(22.3*t))'`;

execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', inp,
  '-vf', `${VF},${GRAIN},${SHAKE}`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'copy', out], { stdio: 'inherit' });
console.log(`OK -> ${out} (grain + tremblement « ${lvlArg && LEVELS[lvlArg] ? lvlArg : 'faible'} »)`);
