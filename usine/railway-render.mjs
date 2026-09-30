#!/usr/bin/env node
// Creative Factory — RENDU SUR RAILWAY (test du 30/09, Axel : « on teste sur Railway pour voir si on peut aller plus vite »).
// Petit serveur HTTP : POST /render (en-tête x-factory-key) avec une recette → télécharge les briques (bucket public
// factory-media), lance usine/build.mjs, dépose la vidéo + son poster dans factory-media/final/ sous son ID complet, et
// rend le temps mesuré. GET /job/<id> = état. Plusieurs rendus en parallèle (FACTORY_MAX, défaut 2).
// Recette : { vf, photo, hook, liaison?, demo, cta, choc?, music? ('auto'), subs? ('auto') }
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, statSync, createWriteStream } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SB = process.env.SUPABASE_URL || 'https://guvwgiejzkiodghywpwj.supabase.co', KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PUB = SB + '/storage/v1/object/public/factory-media/', SECRET = process.env.FACTORY_KEY || '';
const MAX = Math.max(1, parseInt(process.env.FACTORY_MAX || '1', 10)), CACHE = process.env.CF_CACHE || '/tmp/cf-cache';
const ID = x => typeof x === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(x) ? x : null;

async function dl(url, file) {
  const r = await fetch(url); if (!r.ok) throw new Error('téléchargement ' + r.status + ' ' + url.split('/').slice(-2).join('/'));
  await new Promise((ok, ko) => { const w = createWriteStream(file); w.on('finish', ok); w.on('error', ko); (async () => { for await (const c of r.body) w.write(c); w.end(); })().catch(ko); });
  return file;
}
// cache : mots (dans l'image, usine/words-cache) + médias d'illustration (archive du bucket), posés une fois au démarrage
async function prepare() {
  mkdirSync(join(CACHE, 'words'), { recursive: true }); mkdirSync(join(CACHE, 'demos'), { recursive: true });
  try { execFileSync('sh', ['-c', `cp ${JSON.stringify(join(HERE, 'words-cache'))}/*.json ${JSON.stringify(join(CACHE, 'words'))}/`]); } catch { /* aucun mot en cache */ }
  if (!existsSync(join(CACHE, 'broll'))) { const t = join(tmpdir(), 'broll.tgz'); await dl(PUB + 'cache/broll.tgz', t); execFileSync('tar', ['-xzf', t, '-C', CACHE]); rmSync(t, { force: true }); }
}
async function upload(file, path, type) {
  const r = await fetch(SB + '/storage/v1/object/factory-media/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, apikey: KEY, 'Content-Type': type, 'x-upsert': 'true' }, body: readFileSync(file) });
  if (!r.ok) throw new Error('dépôt ' + r.status + ' ' + (await r.text()).slice(0, 120));
}
async function run(job) {
  const r = job.recipe, W = join(tmpdir(), 'cf-' + job.id); mkdirSync(W, { recursive: true });
  const t0 = Date.now(), T = {};
  try {
    const v = b => dl(PUB + 'variants/' + r.photo + '-' + b + '.mp4', join(W, r.photo + '-' + b + '.mp4'));
    const [hook, cta, demo, liaison] = await Promise.all([v(r.hook), v(r.cta), dl(PUB + 'demos/' + r.demo + '.mp4', join(W, r.demo + '.mp4')), r.liaison ? v(r.liaison) : null]);
    T.telechargement = (Date.now() - t0) / 1000;
    const out = join(W, r.vf + '.mp4');
    const args = [join(HERE, 'build.mjs'), hook, demo, out, r.music || 'auto', hook, cta, '--hook-id', r.hook, '--demo', r.demo, '--illus', 'auto', '--subs-style', r.subs || 'auto'];
    if (liaison) args.push('--liaison', liaison);
    if (r.choc) args.push('--choc', r.choc);
    let log = '';
    const code = await new Promise(ok => { const p = spawn('node', args, { env: { ...process.env, CF_CACHE: CACHE }, stdio: ['ignore', 'pipe', 'pipe'] });
      const on = d => { log += d; if (log.length > 400000) log = log.slice(-200000); job.last = String(d).split('\n').filter(Boolean).pop() || job.last; };
      p.stdout.on('data', on); p.stderr.on('data', on); p.on('close', ok); });
    job.log = log.split('\n').filter(l => /illustration|phrase choc|musique tirée|sous-titres tirés|niveau sonore|⚠|✗|OK ->|mots ->|mots en cache|Error|error/.test(l) && !/Capturing/.test(l)).slice(-40).map(l => l.slice(0, 300));
    if (code !== 0 || !existsSync(out)) { job.tail = log.split('\n').filter(l => l.trim() && !/Capturing|Streaming frame|█|░/.test(l)).slice(-45).map(l => l.slice(0, 400)); throw new Error('build.mjs a échoué (code ' + code + ')'); }
    T.rendu = (Date.now() - t0) / 1000 - T.telechargement;
    const f = JSON.parse(readFileSync(out + '.format.json', 'utf8'));
    const tx = (f.illustrations || []).map(i => (/(HK-[A-Za-z0-9-]+)\.mp4$/.exec(i.media) || [])[1]).filter((x, i, a) => x && a.indexOf(x) === i);
    const name = [r.vf, r.photo, r.hook, r.liaison, r.demo, r.cta, f.musique, f.sous_titre, f.texte_choc, ...tx].filter(Boolean).join('_');
    const poster = join(W, 'poster.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '0', '-i', out, '-frames:v', '1', '-vf', 'scale=540:-1', '-q:v', '3', poster]);
    await upload(out, 'final/' + name + '.mp4', 'video/mp4'); await upload(poster, 'final/' + name + '-poster.jpg', 'image/jpeg');
    T.depot = (Date.now() - t0) / 1000 - T.telechargement - T.rendu;
    Object.assign(job, { status: 'done', name, machine: process.env.RAILWAY_REPLICA_ID || '', url: PUB + 'final/' + name + '.mp4', sidecar: f, words: JSON.parse(readFileSync(out + '.words.json', 'utf8')).map(w => w.text).join(' '), size: statSync(out).size });
  } catch (e) { Object.assign(job, { status: 'failed', error: String(e.message || e).slice(0, 400) }); }
  job.seconds = Object.fromEntries(Object.entries({ ...T, total: (Date.now() - t0) / 1000 }).map(([k, x]) => [k, Math.round(x)]));
  try { rmSync(W, { recursive: true, force: true }); rmSync(join(tmpdir(), 'hyperframes-extract-cache-' + (process.getuid ? process.getuid() : '')), { recursive: true, force: true }); } catch { /* sans gravité */ }
}
// ── FILE D'ATTENTE DANS SUPABASE (table factory_render_jobs) : chaque machine prend UN rendu à la fois ──
const REST = SB + '/rest/v1/factory_render_jobs', H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const ME = (process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || randomUUID()).slice(0, 40);
const db = async (q, init) => { const r = await fetch(REST + q, { ...init, headers: { ...H, ...(init && init.headers) } }); if (!r.ok) throw new Error('base ' + r.status + ' ' + (await r.text()).slice(0, 160)); return r.status === 204 ? null : r.json(); };
async function claim() {
  const c = await db('?status=eq.queued&select=id&order=created_at.asc&limit=3');
  for (const x of c) {
    const got = await db('?id=eq.' + x.id + '&status=eq.queued', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'running', worker: ME, started_at: new Date().toISOString() }) });
    if (got && got.length) return got[0];
  }
  return null;
}
let busy = 0;
async function loop() {
  if (busy >= MAX || !(await ready) || !KEY) return;
  busy++;   // réservé AVANT la prise (sinon deux tours prenaient chacun un rendu : 2 vidéos sur une machine → ffmpeg tué, mémoire)
  let row = null; try { row = await claim(); } catch (e) { console.error('file :', e.message); }
  if (!row) { busy--; return; }
  const job = { id: row.id, recipe: row.recipe };
  try {
    await run(job);
    const { status, error, ...rest } = job; delete rest.recipe; delete rest.id;
    await db('?id=eq.' + row.id, { method: 'PATCH', body: JSON.stringify({ status: status || 'failed', error: error || null, result: rest, finished_at: new Date().toISOString() }) });
  } catch (e) {
    try { await db('?id=eq.' + row.id, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: String(e.message || e).slice(0, 400), finished_at: new Date().toISOString() }) }); } catch { /* base injoignable */ }
  }
  busy--; setImmediate(loop);
}
setInterval(loop, 4000);

const ready = prepare().then(() => true).catch(e => { console.error('préparation :', e.message); return false; });
http.createServer(async (req, res) => {
  const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') return send(200, { ok: await ready, machine: ME, cpus: cpus().length, max: MAX, busy });
  if (!SECRET || req.headers['x-factory-key'] !== SECRET) return send(401, { error: 'clé' });
  if (req.method === 'POST' && u.pathname === '/render') {
    let b = ''; for await (const c of req) { b += c; if (b.length > 20000) return send(413, { error: 'trop gros' }); }
    let r; try { r = JSON.parse(b); } catch { return send(400, { error: 'json' }); }
    const rec = { vf: ID(r.vf), photo: ID(r.photo), hook: ID(r.hook), liaison: ID(r.liaison), demo: ID(r.demo), cta: ID(r.cta), choc: ID(r.choc), music: ID(r.music), subs: ID(r.subs) };
    if (!rec.vf || !rec.photo || !rec.hook || !rec.demo || !rec.cta) return send(400, { error: 'recette incomplète' });
    try { const row = await db('', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ recipe: rec }) }); return send(202, { job: row[0].id }); }
    catch (e) { return send(503, { error: String(e.message).slice(0, 160) }); }
  }
  const m = /^\/job\/([0-9a-f-]{36})$/.exec(u.pathname);
  if (m) { try { const row = await db('?id=eq.' + m[1] + '&select=*'); if (row.length) return send(200, row[0]); } catch (e) { return send(503, { error: String(e.message).slice(0, 160) }); } }
  send(404, { error: 'inconnu' });
}).listen(process.env.PORT || 8080, () => console.log('factory-render prêt · ' + cpus().length + ' cœurs · ' + Math.round(totalmem() / 1e9) + ' Go · ' + MAX + ' rendu(s) par machine'));
