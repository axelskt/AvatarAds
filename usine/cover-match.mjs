// Creative Factory — reconnaissance des reels Instagram par leur COUVERTURE, sur le serveur de l'usine (07/10, Axel : « fais-le »).
// Le relevé quotidien (edge ig-insights, part=snapshot) met en file (ig_media_match, state 'pending') les reels que la légende
// n'a pas reliés au kit ; ici, toutes les 5 minutes, chaque couverture est comparée aux empreintes de l'usine avec le MÊME code
// que TikTok (supabase/functions/_shared/cover-match.ts). Pas sur l'edge : comparer à toutes les empreintes y dépassait le budget
// CPU (« CPU Time exceeded »). Décodage de l'image par ffmpeg (déjà dans l'image Docker).
// 1er signal : le CRÉNEAU du kit. Axel programme à l'heure prévue (constaté le 07/10 : chaque reel tombe pile sur un créneau
// du kit du même compte) mais change souvent la légende. Un seul reel sur le créneau (±20 min) → la vidéo prévue, confirmée
// par la couverture quand ses images du hook existent (score ≤ 45, sinon on n'en tient pas compte) ; vidéo au poster seul
// (supprimée avant l'empreinte, couverture = image du milieu du hook) → lien « horaire ». Deux reels sur le même créneau →
// on ne tranche pas. Sans créneau : reconnaissance générale par la couverture.
// Résultat auto / horaire : ID complet + recette dans ig_media_stats, ligne du kit (factory_posts) reliée au reel → le
// dashboard affiche la recette. unsure / none : retentés par le relevé du lendemain (14 jours au plus).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverMatcher } from '../supabase/functions/_shared/cover-match.ts';
import { toGray } from '../supabase/functions/_shared/fp.ts';

const SB = process.env.SUPABASE_URL || 'https://guvwgiejzkiodghywpwj.supabase.co', KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const H = () => ({ apikey: KEY, Authorization: 'Bearer ' + KEY });

// Mini-client PostgREST : juste ce que cover-match.ts utilise (select, eq, in, not, is, order, limit, range), « thenable »
// comme supabase-js ({ data, error }).
function from(table) {
  const q = { sel: '*', p: [], order: [], range: null };
  const enc = v => encodeURIComponent(String(v));
  const api = {
    select(c) { q.sel = String(c).replace(/\s+/g, ''); return api; },
    eq(k, v) { q.p.push(`${k}=eq.${enc(v)}`); return api; },
    in(k, arr) { q.p.push(`${k}=in.(${arr.map(v => enc(typeof v === 'number' ? v : '"' + String(v).replace(/"/g, '\\"') + '"')).join(',')})`); return api; },
    not(k, op, v) { q.p.push(`${k}=not.${op}.${enc(v)}`); return api; },
    is(k, v) { q.p.push(`${k}=is.${enc(v)}`); return api; },
    order(k) { q.order.push(k); return api; },
    limit(n) { q.p.push('limit=' + n); return api; },
    range(a, b) { q.range = [a, b]; return api; },
    then(ok, ko) { return run().then(ok, ko); },
  };
  async function run() {
    const url = `${SB}/rest/v1/${table}?select=${enc(q.sel)}${q.p.length ? '&' + q.p.join('&') : ''}${q.order.length ? '&order=' + q.order.join(',') : ''}`;
    const h = H(); if (q.range) { h['Range-Unit'] = 'items'; h.Range = `${q.range[0]}-${q.range[1]}`; }
    try {
      const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(30000) });
      if (!r.ok) return { data: null, error: { message: r.status + ' ' + (await r.text()).slice(0, 160) } };
      return { data: await r.json(), error: null };
    } catch (e) { return { data: null, error: { message: String(e.message || e).slice(0, 160) } }; }
  }
  return api;
}
async function patch(table, filter, body) {
  const r = await fetch(`${SB}/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: { ...H(), 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(table + ' ' + r.status + ' ' + (await r.text()).slice(0, 160));
}

// JPEG / WebP / PNG → RGBA brut par ffmpeg (taille d'origine)
async function decode(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'igcov-')), f = join(dir, 'c');
  try {
    writeFileSync(f, bytes);
    const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);
    if (!w || !h) return null;
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
    if (raw.length !== w * h * 4) return null;
    const rgba = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
    return { w, h, gray: toGray(rgba, w * h), rgba };
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}

const { matchCover, scoreVf } = coverMatcher({ from }, decode);
const enc = v => encodeURIComponent(String(v));

// Un passage : jusqu'à `max` reels en file. Renvoie le bilan (journal Railway).
export async function igCoverTick(max = 4) {
  if (!KEY) return { erreur: 'SUPABASE_SERVICE_ROLE_KEY absente' };
  const { data, error } = await from('ig_media_match').select('media_id,account,thumb,caption,posted_at').eq('state', 'pending').order('updated_at').limit(max);
  if (error) return { erreur: error.message };
  const out = [];
  for (const p of data || []) {
    const id = String(p.media_id), done = o => patch('ig_media_match', 'media_id=eq.' + enc(id), { ...o, updated_at: new Date().toISOString() });
    try {
      const r = await fetch(String(p.thumb), { signal: AbortSignal.timeout(10000) });
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const bytes = r.ok && type.startsWith('image/') ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array(0);
      if (!bytes.length || bytes.length > 5_000_000) { await done({ state: 'none' }); out.push({ id, etat: 'couverture illisible (' + r.status + ')' }); continue; }
      let m = null;
      const t = Date.parse(p.posted_at || ''), iso = x => new Date(x).toISOString();
      if (isFinite(t)) {
        const win = `account=eq.${enc(p.account)}&scheduled_at=gte.${enc(iso(t - 20 * 60e3))}&scheduled_at=lte.${enc(iso(t + 20 * 60e3))}`;
        const r1 = await fetch(`${SB}/rest/v1/factory_posts?select=video_url,scheduled_at&platform=eq.instagram&video_url=not.is.null&${win}&order=scheduled_at`, { headers: H(), signal: AbortSignal.timeout(30000) });
        const slots = r1.ok ? await r1.json() : [];
        const s0 = slots.find(x => /VF-\d+/.test(x.video_url || ''));
        if (s0) {
          const ts = Date.parse(s0.scheduled_at);
          const r2 = await fetch(`${SB}/rest/v1/ig_media_stats?select=media_id&account=eq.${enc(p.account)}&posted_at=gte.${enc(iso(ts - 20 * 60e3))}&posted_at=lte.${enc(iso(ts + 20 * 60e3))}`, { headers: H(), signal: AbortSignal.timeout(30000) });
          const same = new Set((r2.ok ? await r2.json() : []).map(x => String(x.media_id)));
          const vf = s0.video_url.match(/VF-\d+/)[0];
          if (same.size <= 1) {
            const sv = await scoreVf(bytes, vf);
            if (sv && sv.frames && sv.score <= 18) m = { vf, state: 'auto', score: sv.score, candidates: [{ vf, score: sv.score }] };
            else if (sv && (!sv.frames || sv.score <= 45)) m = { vf, state: 'horaire', score: sv.score, candidates: [{ vf, score: sv.score }] };
          } else m = { vf: null, state: 'unsure', score: null, candidates: [{ vf, score: null }] };   // 2 reels sur le même créneau
        }
      }
      if (!m) m = await matchCover(bytes, null, String(p.caption || ''));
      if (!m) { await done({ state: 'none' }); out.push({ id, etat: 'décodage impossible' }); continue; }
      let vfFull = null;
      if ((m.state === 'auto' || m.state === 'horaire') && m.vf) {
        const { data: f } = await from('factory_fp').select('video_url').eq('vf', m.vf).limit(1);
        const url = f && f[0] && f[0].video_url ? String(f[0].video_url) : null;
        vfFull = url ? (url.split('/final/')[1] || '').replace(/\.mp4$/, '') || m.vf : m.vf;
        let combo = null;
        if (url) {
          const { data: q } = await from('factory_qc').select('brick_combo').eq('video_url', url).limit(1);
          if (q && q[0] && q[0].brick_combo) combo = { ...q[0].brick_combo, id_complet: vfFull };
          await patch('factory_posts', `platform=eq.instagram&account=eq.${enc(p.account)}&video_url=eq.${enc(url)}&media_id=is.null`,
            { media_id: id, status: 'published', done_at: new Date().toISOString() });
        }
        await patch('ig_media_stats', 'media_id=eq.' + enc(id), { vf: vfFull, combo });
      }
      await done({ state: m.state, vf: vfFull, score: m.score, candidates: m.candidates });
      out.push({ id, etat: m.state, vf: vfFull, score: m.score });
    } catch (e) {
      await done({ state: 'none' }).catch(() => {});
      out.push({ id, erreur: String(e.message || e).slice(0, 120) });
    }
  }
  return { traites: out.length, resultats: out };
}
