#!/usr/bin/env node
// livrables.mjs — à partir des aperçus rendus (render.mjs), écrit :
//   <deploy>/upload.tsv          chemin local <TAB> factory-media/subtitles/<id>.mp4|.jpg
//   <deploy>/soustitres-apercus.sql   SQL IDEMPOTENT : S01-S06 complétées (meta.media/poster/source…),
//                                     S07-S19 ajoutées (ready), S20-S24 propositions (draft, meta.proposal=true)
// Jamais de DELETE ; un style déjà présent garde son statut (ON CONFLICT ne touche pas à status).
//   node tools/apercus-soustitres/livrables.mjs --apercus <dossier> --deploy <dossier>
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STYLES, PHRASE, PUB, storagePath } from './catalogue.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const AP = resolve(arg('--apercus') || 'apercus')
const DEP = resolve(arg('--deploy') || '.')
const manifest = JSON.parse(readFileSync(join(AP, 'manifest.json'), 'utf8'))
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const EXISTANTS = new Set(['S01', 'S02', 'S03', 'S04', 'S05', 'S06'])

const tsv = []
const sql = [
  '-- Sous-titres de la Creative Factory : aperçus vidéo + styles du Montage IA / Générateur + 5 propositions (26/09/2026)',
  '-- Généré par tools/apercus-soustitres/livrables.mjs. IDEMPOTENT : rejouable sans effet de bord.',
  '-- Pré-requis : les fichiers de upload.tsv sont en ligne (factory-media/subtitles/…), sinon meta.media pointe dans le vide.',
  'begin;',
  '',
]
const manquants = []
for (const st of STYLES) {
  const mp4 = join(AP, st.id + '.mp4'), jpg = join(AP, st.id + '.jpg')
  if (!manifest[st.id] || !manifest[st.id].ok || !existsSync(mp4) || !existsSync(jpg)) { manquants.push(st.id); continue }
  tsv.push(`${mp4}\t${storagePath(st.id, 'mp4')}`, `${jpg}\t${storagePath(st.id, 'jpg')}`)
  const media = PUB + storagePath(st.id, 'mp4'), poster = PUB + storagePath(st.id, 'jpg')
  const meta = {
    value: st.value, source: st.source, param: st.param,
    ...(st.also ? { also: st.also } : {}),
    media, media_type: 'video', poster, cover: poster,
    preview: { phrase: PHRASE, fond: st.opts && st.opts.slideStyle === 'word' ? 'page blanche (le style masque la vidéo)' : 'A1-3 animée (selfie-treat faible)', engine: st.engine, rendered_at: '2026-09-26' },
    ...(st.proposal ? { proposal: true } : {}),
  }
  const m = q(JSON.stringify(meta)) + '::jsonb'
  if (EXISTANTS.has(st.id)) {
    sql.push(`-- ${st.id} · ${st.label}`)
    sql.push(`update factory_bricks set label = ${q(st.label)}, meta = meta || ${m}, updated_at = now()`)
    sql.push(`  where id = ${q(st.id)} and kind = 'sous-titre';`)
  } else {
    const status = st.proposal ? 'draft' : 'ready'
    sql.push(`-- ${st.id} · ${st.label}${st.proposal ? ' · PROPOSITION (brouillon, jamais tirée)' : ''}`)
    sql.push(`insert into factory_bricks (id, kind, subject, label, meta, status)`)
    sql.push(`  values (${q(st.id)}, 'sous-titre', 'general', ${q(st.label)}, ${m}, ${q(status)})`)
    sql.push(`  on conflict (id) do update set label = excluded.label, meta = factory_bricks.meta || excluded.meta, updated_at = now()`)
    sql.push(`  where factory_bricks.kind = 'sous-titre';`)
  }
  sql.push('')
}
sql.push('-- contrôle : 19 styles prêts avec aperçu, 5 propositions en brouillon')
sql.push(`select status, count(*) as n, count(*) filter (where meta ? 'media') as avec_apercu, count(*) filter (where (meta->>'proposal')::boolean) as propositions`)
sql.push(`  from factory_bricks where kind = 'sous-titre' group by status order by status;`)
sql.push('commit;')
writeFileSync(join(DEP, 'upload.tsv'), tsv.join('\n') + '\n')
writeFileSync(join(DEP, 'soustitres-apercus.sql'), sql.join('\n') + '\n')

// planches contact (PIL) : les 5 propositions, et tous les styles existants
const PL = resolve(arg('--planches') || DEP)
const SRC = { generateur: 'Générateur', 'montage-ia': 'Montage IA', usine: 'usine', proposition: 'proposition' }
const planche = (list, file, title, cols) => {
  const j = join(PL, file.replace(/\.jpg$/, '.json'))
  writeFileSync(j, JSON.stringify(list.filter((s) => !manquants.includes(s.id)).map((s) => ({ id: s.id, label: s.label, jpg: join(AP, s.id + '.jpg'), sub: SRC[s.source] + ' · ' + s.value }))))
  execFileSync('python3', [join(HERE, 'planche.py'), j, join(PL, file), title, String(cols)], { stdio: 'inherit' })
  rmSync(j)
}
planche(STYLES.filter((s) => s.proposal), 'planche-propositions.jpg', 'Sous-titres · 5 propositions (26/09) — « Cette IA crée tes pubs en 30 secondes. »', 5)
planche(STYLES.filter((s) => !s.proposal), 'planche-styles-existants.jpg', 'Sous-titres · les 19 styles existants (Générateur, Montage IA, usine)', 7)
console.log(`upload.tsv : ${tsv.length} fichiers · SQL : ${STYLES.length - manquants.length} styles${manquants.length ? ` · ABSENTS (aperçu non rendu) : ${manquants.join(', ')}` : ''}`)
if (manquants.length) process.exitCode = 2
