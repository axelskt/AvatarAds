#!/usr/bin/env node
// Creative Factory — BRANCHEMENT QC : après un rendu, lance qc.mjs (technique) + qc-vision.mjs (IA),
// dépose la vidéo + un poster dans factory-media, et insère une ligne dans factory_qc.
// Route finale : qc technique MANUAL → manual ; cohérence de la recette ≠ 'ok' → manual ; sinon vision 'doubt' → manual ; sinon auto.
// Cohérence (Axel 25/09, usine/coherence.js = même règle que le dashboard) : toute démo peut suivre tout hook, mais une paire
// que les tags ne garantissent pas part en REVUE manuelle (Axel accepte ou refuse dans l'onglet Production) ; la raison est
// écrite dans technical.coherence.reasons. comboJson = { voice?, avatar, hook, liaison?, contenu, cta, musique?, sous_titre? }
// (IDs de briques, sauf voice). Une liaison hors de la matrice hook × liaison validée (usine/hook-liaison.js) → revue manuelle.
// voice = mode de voix de la vidéo finale : 'axel' (« Audio d'Axel » : son audio enregistré, lipsync) ou 'omni' (« Voix native
// Omni » : Omni Flash image→vidéo dit le texte du hook / de la liaison) ; absent = 'axel'. Le dashboard (onglet Production)
// compte une vidéo déjà produite par clé voice|avatar|hook|liaison (usine/coherence.js, comboKey) : démo et CTA, tirés au
// hasard, ne font pas une nouvelle vidéo — seule la déclinaison d'un top (declineTop) réutilise hook + liaison avec une
// autre démo et un autre CTA ; declineTop rend la publication d'origine À CÔTÉ ({ combo, from }) : n'écrire QUE combo.
// Clés admises dans comboJson = COMBO_KEYS de usine/coherence.js ; une autre clé ou une voix inconnue → refus AVANT tout
// rendu ni upload (le dashboard afficherait la recette en « texte libre » et ne la compterait jamais). Une voix sans le
// fichier audio (axel) ou le texte (omni) de la brique parlée → revue manuelle (comboCheck).
// Bibliothèque : --bricks <fichier.json> (export factory_bricks) sinon lue avec la clé service ; introuvable → revue manuelle.
// « Humain d'abord » (Axel) : status = 'pending' au début même si auto (tout passe par la file tant que le
// template n'est pas diplômé). L'insertion se fait via la clé service (SUPABASE_SERVICE_ROLE_KEY) si présente
// — sinon on IMPRIME la ligne (à insérer par Claude via le MCP / à câbler dans le render-worker).
// Usage : node usine/publish-qc.mjs <video.mp4> <template> [comboJson] [--transcript "…"] [--bricks bricks.json]
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const _argv = process.argv.slice(2), _valOf = (f) => { const i = _argv.indexOf(f); return i > -1 ? String(_argv[i + 1] || '') : ''; };
const [video, template, comboArg] = _argv.filter((a, i) => !a.startsWith('--') && !['--transcript', '--bricks'].includes(_argv[i - 1]));
if (!video || !template) { console.error('usage: publish-qc.mjs <video> <template> [comboJson] [--transcript "…"]'); process.exit(2); }
const transcript = _valOf('--transcript');
const bricksFile = _valOf('--bricks');
const HERE = fileURLToPath(new URL('.', import.meta.url));   // décode l'espace de « Autre SaaS » (pas de %20)
const SB_URL = 'https://guvwgiejzkiodghywpwj.supabase.co';
const BUCKET = 'factory-media';
const pub = p => `${SB_URL}/storage/v1/object/public/${BUCKET}/${p}`;

const run = (cmd, a) => spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 27 });
const j = s => { try { return JSON.parse(s); } catch { return null; } };

// 0) règle partagée avec le dashboard + contrôle de la recette AVANT tout rendu / upload
await import(new URL('./hook-liaison.js', import.meta.url).href);   // matrice hook × liaison (globalThis.CF_HOOK_LIAISON)
await import(new URL('./coherence.js', import.meta.url).href);
const COH = globalThis.CF_COHERENCE;
const combo = comboArg ? j(comboArg) : {};
if (!combo || typeof combo !== 'object' || Array.isArray(combo)) { console.error('✗ comboJson illisible : ' + String(comboArg).slice(0, 120)); process.exit(2); }
const badKeys = Object.keys(combo).filter(k => !COH.COMBO_KEYS.includes(k));
if (badKeys.length) { console.error('✗ recette refusée : clé inconnue ' + badKeys.join(', ') + ' (admises : ' + COH.COMBO_KEYS.join(', ') + ')'); process.exit(2); }
if (!COH.voiceValid(combo.voice)) { console.error('✗ recette refusée : voix « ' + combo.voice + ' » inconnue (axel ou omni)'); process.exit(2); }

// 1) QC technique
const qcR = run('node', [HERE + 'qc.mjs', video, '--json']);
const technical = j(qcR.stdout) || { route: 'manual', pass: false, error: 'qc.mjs illisible' };

// 1bis) Cohérence de la recette (hook ↔ démo ↔ liaison, voix) — même règle que le dashboard
async function loadBricks() {
  if (bricksFile) { try { return JSON.parse(readFileSync(bricksFile, 'utf8')); } catch (e) { console.warn('⚠ --bricks illisible :', e.message); return null; } }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/factory_bricks?select=id,kind,subject,label,status,meta`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
const bricks = await loadBricks();
let coherence, promise = '';
if (!bricks) coherence = { level: 'review', reasons: ['bibliothèque de briques non chargée : cohérence non vérifiée'] };
else {
  const byId = Object.fromEntries(bricks.map(b => [b.id, b]));
  const c = COH.comboCheck(combo, byId, globalThis.CF_HOOK_LIAISON || null);
  coherence = { level: c.level, reasons: c.reasons };
  if (c.hook && c.demo) {
    const say = (b) => String((b.meta && (b.meta.script || b.meta.text)) || b.label || b.id).slice(0, 240);
    promise = `le hook ${c.hook.id} dit « ${say(c.hook)} » ; la démo ${c.demo.id} montre « ${c.demo.label || c.demo.id} » (module ${COH.demoModule(c.demo)})`;
  }
}
technical.coherence = coherence;

// 2) QC visuel (IA) — peut être absent (pas de clé) → on n'échoue pas
const visArgs = [HERE + 'qc-vision.mjs', video, '--json'];
if (transcript) visArgs.push('--transcript', transcript);
if (promise) visArgs.push('--promise', promise);
const vR = run('node', visArgs);
const visOut = j(vR.stdout);
const vision = (visOut && visOut.verdict) ? visOut : null;   // null si bundle-only (pas de clé)

// 3) route finale
let route = 'auto';
if (technical.route === 'manual') route = 'manual';
else if (coherence.level !== 'ok') route = 'manual';
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
  brick_combo: combo,
  technical, vision, route, status: 'pending',   // humain d'abord
};

const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (svc) {
  const r = await fetch(`${SB_URL}/rest/v1/factory_qc`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', apikey: svc, Authorization:`Bearer ${svc}`, Prefer:'return=representation' },
    body: JSON.stringify(row),
  });
  if (coherence.level !== 'ok') console.log('↪ revue manuelle — ' + coherence.reasons.join(' · '));
  console.log(r.ok ? `✓ factory_qc inséré (route ${route})` : `✗ insert factory_qc ${r.status} ${(await r.text()).slice(0,140)}`);
} else {
  console.log('⚠ SUPABASE_SERVICE_ROLE_KEY absent → ligne à insérer (Claude via MCP) :');
  console.log(JSON.stringify(row));
}
