#!/usr/bin/env node
// Creative Factory — QC VISUEL (IA vision). Échantillonne des frames + (option) la transcription et
// demande à un modèle vision « le visuel colle aux mots ? un glitch ? » → score de confiance.
// Technique OK + confiance haute → 'ok' (candidat auto) ; doute/glitch → 'doubt' (file manuelle).
//
// Modèle : gpt-4o-mini vision. Clé : OPENAI_API_KEY (env) en direct, OU passe par l'openai-proxy si
// OPENAI_PROXY_URL + un token owner (SUPA_TOKEN) sont fournis (le render-worker a l'un ou l'autre).
// Sans clé/token → émet juste le bundle (frames b64 + transcript) pour analyse (Claude fait le vision QC
// à la main quand c'est moi qui tourne l'usine).
// --promise "…" (25/09) : ce que le HOOK annonce et ce que la DÉMO montre (publish-qc le construit depuis la recette) →
// le modèle juge aussi « la démo tient-elle la promesse du hook ? » ; non → 'doubt' (revue manuelle d'Axel).
// Usage : node usine/qc-vision.mjs <video.mp4> [--transcript "texte"] [--promise "texte"] [--json] [--frames N]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const video = args[0];
if (!video || video.startsWith('--')) { console.error('usage: qc-vision.mjs <video.mp4> [--transcript "…"] [--json] [--frames N]'); process.exit(2); }
const JSON_OUT = args.includes('--json');
const N = Math.max(2, Math.min(6, parseInt(args[(args.indexOf('--frames')+1)] || '4') || 4));
const transcript = args.includes('--transcript') ? String(args[args.indexOf('--transcript')+1] || '') : '';
const promise = args.includes('--promise') ? String(args[args.indexOf('--promise')+1] || '') : '';

const dur = parseFloat(spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', video], {encoding:'utf8'}).stdout.trim()) || 0;
const work = mkdtempSync(join(tmpdir(), 'qcv-'));
// N frames réparties (on évite les bords extrêmes)
const frames = [];
for (let i = 0; i < N; i++) {
  const t = dur * (i + 1) / (N + 1);
  const f = join(work, `f${i}.jpg`);
  spawnSync('ffmpeg', ['-v','error','-y','-ss', t.toFixed(2), '-i', video, '-vframes','1','-vf','scale=512:-1', f]);
  try { frames.push({ t: +t.toFixed(2), b64: readFileSync(f).toString('base64') }); } catch {}
}

const PROMPT = `Tu es un contrôleur qualité de vidéos pub short-form (format 9:16, avatar/transformation + sous-titres brûlés).
On te donne ${frames.length} frames échantillonnées${transcript ? ' + la transcription' : ''}. Juge SÉVÈREMENT :
- glitch/artefact visible (visage déformé, mains fusionnées, texte de sous-titre illisible/déborde/coupé, frame noire/blanche, doublon d'image) ?
- le visuel est-il cohérent avec ce qui est dit ${transcript ? '(transcription fournie)' : '(sinon juge la cohérence interne)'} ?
- qualité globale « prête à poster » ?
${promise ? '- la démo montrée tient-elle la promesse du hook (le spectateur voit-il ce que le hook annonce) ?\nContexte de la recette : ' + promise.slice(0, 600) : ''}
${transcript ? 'Transcription : "' + transcript.slice(0, 1200) + '"' : ''}
Réponds UNIQUEMENT en JSON : {"glitch":bool,"matches_words":bool,"quality_ok":bool,${promise ? '"promise_kept":bool,' : ''}"confidence":0..1,"notes":"court"}`;

async function callOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  const proxy = process.env.OPENAI_PROXY_URL, tok = process.env.SUPA_TOKEN;
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: [
      { type: 'text', text: PROMPT },
      ...frames.map(f => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${f.b64}`, detail: 'low' } })),
    ] }],
    max_tokens: 300, temperature: 0,
  };
  let url, headers;
  if (proxy && tok) { url = `${proxy}?path=/v1/chat/completions`; headers = { 'Content-Type':'application/json', Authorization:`Bearer ${tok}` }; }
  else if (key) { url = 'https://api.openai.com/v1/chat/completions'; headers = { 'Content-Type':'application/json', Authorization:`Bearer ${key}` }; }
  else return null;
  const r = await fetch(url, { method:'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`vision HTTP ${r.status} ${(await r.text()).slice(0,120)}`);
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content || '';
  const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('réponse vision non-JSON');
  return JSON.parse(m[0]);
}

const out = (v) => { try { rmSync(work, { recursive:true, force:true }); } catch {} return v; };

try {
  const verdict = await callOpenAI();
  if (!verdict) {
    // pas de clé : on émet le bundle (Claude / un humain juge)
    const bundle = { video, frames: frames.map(f => ({ t: f.t, jpg_b64: f.b64.slice(0, 24) + '…' })), transcript, note: 'OPENAI_API_KEY/proxy absent → bundle émis, pas d\'appel vision' };
    console.log(JSON.stringify(out(bundle), null, JSON_OUT ? 2 : 0));
    process.exit(3);
  }
  const bad = verdict.glitch || verdict.quality_ok === false || (transcript && verdict.matches_words === false) || (promise && verdict.promise_kept === false);
  const conf = Number(verdict.confidence) || 0;
  const route = (!bad && conf >= 0.75) ? 'ok' : 'doubt';
  const res = out({ video, route, verdict });
  if (JSON_OUT) console.log(JSON.stringify(res, null, 2));
  else { console.log(`QC visuel ${video}`); console.log('  ' + JSON.stringify(verdict)); console.log(`→ ${route.toUpperCase()} (confiance ${conf})`); }
  process.exit(route === 'ok' ? 0 : 1);
} catch (e) { out(); console.error('QC visuel échec :', e.message); process.exit(2); }
