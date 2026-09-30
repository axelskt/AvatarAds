#!/usr/bin/env node
// Creative Factory — TRANSCRIPTION D'AVANCE de toutes les briques (Axel 30/09 : « faire toute la transcription pour chaque
// vidéo d'un coup, on gagnera du temps »). Pour chaque fichier (liste « nom|url » sur l'entrée standard) : téléchargé dans un
// dossier temporaire, mots Whisper rangés dans le cache (même clé que build.mjs), fichier supprimé aussitôt. Déjà en cache →
// sauté. Usage : node usine/pre-transcribe.mjs < liste.txt
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, statSync, openSync, readSync, closeSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = process.env.CF_CACHE || join(homedir(), 'Downloads', 'Creative Factory', 'cache');
mkdirSync(join(CACHE, 'words'), { recursive: true });
// = fileKey de build.mjs (4 Mo du début + 4 Mo de la fin + taille)
const fileKey = f => { const st = statSync(f), fd = openSync(f, 'r'), h = createHash('sha1'), n = Math.min(st.size, 4 << 20), b = Buffer.alloc(n);
  readSync(fd, b, 0, n, 0); h.update(b); readSync(fd, b, 0, n, Math.max(0, st.size - n)); h.update(b); closeSync(fd); h.update(String(st.size)); return h.digest('hex').slice(0, 16); };
const lines = readFileSync(0, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
const work = mkdtempSync(join(tmpdir(), 'pretr-'));
let done = 0, skip = 0, fail = 0; const t0 = Date.now();
for (const [i, l] of lines.entries()) {
  const [name, url] = l.split('|'); const f = join(work, name.replace(/[^A-Za-z0-9._-]/g, '_') + '.mp4');
  try {
    execFileSync('curl', ['-sfL', '-o', f, url]);
    const c = join(CACHE, 'words', fileKey(f) + '.json');
    if (existsSync(c)) { skip++; }
    else { execFileSync('node', [join(HERE, 'captions.mjs'), 'emit', f, '0', c], { stdio: 'ignore' }); done++; }
  } catch (e) { fail++; console.log('✗ ' + name + ' : ' + String(e.message).slice(0, 120)); }
  rmSync(f, { force: true });
  console.log(`[${i + 1}/${lines.length}] ${name} · transcrits ${done} · déjà en cache ${skip} · échecs ${fail} · ${Math.round((Date.now() - t0) / 60000)} min`);
}
rmSync(work, { recursive: true, force: true });
