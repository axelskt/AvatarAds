#!/usr/bin/env node
// Creative Factory — BRANCHEMENT QC : après un rendu, lance qc.mjs (technique) + qc-vision.mjs (IA),
// dépose la vidéo + un poster dans factory-media, et insère une ligne dans factory_qc.
// Route finale : qc technique MANUAL → manual ; sinon vision 'doubt' → manual ; sinon auto.
// « Humain d'abord » (Axel) : status = 'pending' au début même si auto (tout passe par la file tant que le
// template n'est pas diplômé). L'insertion se fait via la clé service (SUPABASE_SERVICE_ROLE_KEY) si présente
// — sinon on IMPRIME la ligne (à insérer par Claude via le MCP / à câbler dans le render-worker).
// Usage : node usine/publish-qc.mjs <video.mp4> <template> [comboJson] [--transcript "…"]
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const [video, template, comboArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!video || !template) { console.error('usage: publish-qc.mjs <video> <template> [comboJson] [--transcript "…"]'); process.exit(2); }
const trIdx = process.argv.indexOf('--transcript');
const transcript = trIdx > -1 ? String(process.argv[trIdx+1] || '') : '';
const HERE = fileURLToPath(new URL('.', import.meta.url));   // décode l'espace de « Autre SaaS » (pas de %20)
const SB_URL = 'https://guvwgiejzkiodghywpwj.supabase.co';
const BUCKET = 'factory-media';
const pub = p => `${SB_URL}/storage/v1/object/public/${BUCKET}/${p}`;

const run = (cmd, a) => spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 27 });
const j = s => { try { return JSON.parse(s); } catch { return null; } };

// 1) QC technique
const qcR = run('node', [HERE + 'qc.mjs', video, '--json']);
const technical = j(qcR.stdout) || { route: 'manual', pass: false, error: 'qc.mjs illisible' };

// 2) QC visuel (IA) — peut être absent (pas de clé) → on n'échoue pas
const visArgs = [HERE + 'qc-vision.mjs', video, '--json'];
if (transcript) visArgs.push('--transcript', transcript);
const vR = run('node', visArgs);
const visOut = j(vR.stdout);
const vision = (visOut && visOut.verdict) ? visOut : null;   // null si bundle-only (pas de clé)

// 3) route finale
let route = 'auto';
if (technical.route === 'manual') route = 'manual';
else if (vision && vision.route === 'doubt') route = 'manual';

// 4) poster + upload
const base = basename(video).replace(/\.[^.]+$/, '');
const vPath = `qc/${base}.mp4`, pPath = `qc/${base}-poster.jpg`;
const poster = '/tmp/' + base + '-poster.jpg';
run('ffmpeg', ['-v','error','-y','-ss','1.5','-i', video, '-vframes','1','-vf','scale=540:-1', poster]);
const up = (src, dst, ct) => run('supabase', ['storage','cp', src, `ss:///${BUCKET}/${dst}`, '--content-type', ct, '--experimental']);
up(video, vPath, 'video/mp4');
up(poster, pPath, 'image/jpeg');

// 5) ligne factory_qc
const row = {
  video_url: pub(vPath), poster_url: pub(pPath), template,
  brick_combo: (comboArg && j(comboArg)) || {},
  technical, vision, route, status: 'pending',   // humain d'abord
};

const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (svc) {
  const r = await fetch(`${SB_URL}/rest/v1/factory_qc`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', apikey: svc, Authorization:`Bearer ${svc}`, Prefer:'return=representation' },
    body: JSON.stringify(row),
  });
  console.log(r.ok ? `✓ factory_qc inséré (route ${route})` : `✗ insert factory_qc ${r.status} ${(await r.text()).slice(0,140)}`);
} else {
  console.log('⚠ SUPABASE_SERVICE_ROLE_KEY absent → ligne à insérer (Claude via MCP) :');
  console.log(JSON.stringify(row));
}
