#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// APPRENDRE AU CHEF D'ORCHESTRE À ÉCRIRE UNE VISITE GUIDÉE.
//
// Axel : « il ne sait pas proposer de visite guidée, il faut lui apprendre ».
// Le champ existait déjà (`tuto` : mot | écran | zone), mais on ne lui déclarait
// que DEUX écrans avec une poignée de zones inventées à la main. Il ne pouvait
// pas décrire un parcours qu'on ne lui avait pas dessiné — d'où les animations
// génériques sur « connecter », « la clé », « les paramètres ».
//
// Ce script écrit dans son prompt le CATALOGUE RÉEL des écrans, produit par
// harvest-screens.mjs : chaque écran, chaque zone, avec son libellé lu à
// l'écran. C'est lui qui choisit ensuite, et surtout c'est lui qui SYNCHRONISE
// — il a la transcription minutée sous les yeux, moi je ne fais que reconnaître
// des mots-clés.
//
//   node render-worker/sync-screen-catalog.mjs [--check]
//
// La barre latérale est identique sur tous les écrans de l'app : elle est
// déclarée UNE fois. Sans ça, 80 % du catalogue n'était que sa répétition.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCREENS = JSON.parse(readFileSync(join(HERE, 'assets', 'tuto', 'screens.json'), 'utf8'))
const TARGET = join(HERE, '..', 'supabase', 'functions', 'orchestrate', 'index.ts')

// Ce qu'on ne propose jamais : le chrome de l'app (crédits, avatar, déconnexion).
// Personne ne dit « et là tu cliques sur ton avatar en haut à droite ».
const SKIP = /^(credits|credits-\d|a|btn-quiet(-\d)?|\d+-img|report-bug)$/

const zonesOf = (slug) => (SCREENS[slug]?.zones || []).filter((z) => !SKIP.test(z.name))

// la barre latérale : les zones communes à (presque) tous les écrans
const counts = new Map()
const slugs = Object.keys(SCREENS)
for (const s of slugs) for (const z of zonesOf(s)) counts.set(z.name, (counts.get(z.name) || 0) + 1)
// Un seuil relatif au NOMBRE TOTAL d'écrans cassait dès qu'on ajoutait des
// captures d'une autre app (Claude) : la barre latérale d'AvatarAds n'y est pas,
// donc plus rien n'était « partagé ». Le critère est absolu : une zone présente
// sur au moins six écrans est de la navigation.
const shared = new Set([...counts].filter(([, n]) => n >= 6).map(([n]) => n))

const label = (slug, name) => (SCREENS[slug].zones.find((z) => z.name === name) || {}).label || ''
const firstWith = (name) => slugs.find((s) => zonesOf(s).some((z) => z.name === name))

const lines = []
if (shared.size) {
  lines.push('    NAVIGATION (la meme barre laterale sur TOUS les ecrans de l\'app) :')
  lines.push('      ' + [...shared].map((n) => n).join(' | '))
}
for (const slug of slugs.sort()) {
  const own = zonesOf(slug).filter((z) => !shared.has(z.name))
  if (!own.length) continue
  lines.push(`    ${slug}`)
  // le libellé compte autant que le nom : c'est lui que la voix prononce
  for (const z of own) lines.push(`      ${z.name.padEnd(30)} « ${z.label} »`)
}
const body = lines.join('\n')

// ── et les COORDONNÉES, qui vivaient elles aussi en dur côté serveur ────────
// Une deuxième copie de la carte mesurée à la main : mêmes défauts, même
// péremption. Elle sort de la même source que tout le reste.
const r3 = (n) => Math.round(n * 1000) / 1000
const zoneLines = []
for (const slug of slugs.sort()) {
  const zs = zonesOf(slug)
  if (!zs.length) continue
  const inner = zs.map((z) => `'${z.name}': [${r3(z.x)}, ${r3(z.y)}, ${r3(z.w)}, ${r3(z.h)}]`).join(', ')
  zoneLines.push(`  '${slug}': { ${inner} },`)
}
const zonesBody = 'const TUTO: Record<string, Record<string, number[]>> = {\n'
  + zoneLines.join('\n') + '\n}\n'
  // le catalogue donne déjà les vrais identifiants d'écran : la table de
  // correspondance devient l'identité, on garde juste les deux anciens alias
  + "const TUTO_FILE: Record<string, string> = new Proxy(\n"
  + "  { 'images-ia': '01-imagesia', 'express': '02-express' },\n"
  + "  { get: (t, k: string) => t[k] ?? (TUTO[k] ? k : '') },\n) as Record<string, string>"

const patch = (src, tag, text) => {
  const open = `// <<< ${tag} — genere par render-worker/sync-screen-catalog.mjs, ne pas editer >>>`
  const close = `// <<< /${tag} >>>`
  const i = src.indexOf(open), j = src.indexOf(close)
  if (i < 0 || j < 0) { console.error('✗ marqueurs', tag, 'absents de', TARGET); process.exit(1) }
  return src.slice(0, i + open.length) + '\n' + text + '\n' + src.slice(j)
}
const src = readFileSync(TARGET, 'utf8')
let out = patch(src, 'SCREEN-CATALOG', body)
out = patch(out, 'SCREEN-ZONES', zonesBody)

if (process.argv.includes('--check')) {
  if (out !== src) { console.error('✗ catalogue desynchronise — lance sync-screen-catalog.mjs'); process.exit(1) }
  console.log(`✓ catalogue synchronise (${slugs.length} ecrans)`)
} else if (out === src) {
  console.log(`✓ deja a jour (${slugs.length} ecrans)`)
} else {
  writeFileSync(TARGET, out)
  console.log(`✓ ${slugs.length} ecrans, ${body.length} caracteres — ${shared.size} zones de navigation partagees`)
}
