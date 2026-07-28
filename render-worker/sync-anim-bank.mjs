#!/usr/bin/env node
// Recopie la banque d'animations (anim-bank.mjs) dans l'edge function
// orchestrate. Les deux listes avaient divergé en silence : `sign`, `tools`,
// `post` et `screen` existaient côté rendu mais pas côté serveur, donc le
// modèle ne pouvait pas les demander — sur « les bons outils » il proposait un
// interrupteur. Ce script rend la divergence impossible.
//
//   node render-worker/sync-anim-bank.mjs          → écrit
//   node render-worker/sync-anim-bank.mjs --check  → sort en erreur si désync
//
// Les deux zones remplacées sont délimitées par des marqueurs dans
// orchestrate/index.ts. Ne les enlève pas.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BANK, ANIM_NAMES, bankPrompt } from './anim-bank.mjs'

// GARDE-FOU. Le bloc genere atterrit DANS UN TEMPLATE LITERAL de l'orchestrateur
// (`const styleBlock = ` ... `). Un backtick dans une description ferme donc la
// chaine en plein milieu et l'edge function ne parse plus — c'est arrive avec
// « `tools` ne fait que les poser », et ca casse le Montage IA en entier.
// Une occurrence de ` ou de ${ arrete la synchro ici, avant d'ecrire.
function assertNoBackticks(bank) {
  const bad = bank.filter((b) => /[`]|\$\{/.test(b.desc)).map((b) => b.name)
  if (bad.length) {
    console.error('✗ description(s) avec un backtick ou ${ : ' + bad.join(', '))
    console.error('  Le bloc va dans un template literal : remplace par « » ou des guillemets.')
    process.exit(1)
  }
}

assertNoBackticks(BANK)

const HERE = dirname(fileURLToPath(import.meta.url))
const TARGET = join(HERE, '..', 'supabase', 'functions', 'orchestrate', 'index.ts')

const between = (src, tag, body) => {
  const open = `// <<< ANIM-BANK:${tag} — genere par render-worker/sync-anim-bank.mjs, ne pas editer >>>`
  const close = `// <<< /ANIM-BANK:${tag} >>>`
  const i = src.indexOf(open), j = src.indexOf(close)
  if (i < 0 || j < 0) throw new Error(`marqueur ANIM-BANK:${tag} absent de ${TARGET}`)
  return src.slice(0, i + open.length) + '\n' + body + '\n' + src.slice(j)
}

// la liste JS, en lignes de 8 pour rester lisible dans un diff
const rows = []
for (let i = 0; i < ANIM_NAMES.length; i += 8) {
  rows.push('  ' + ANIM_NAMES.slice(i, i + 8).map((n) => `'${n}'`).join(', ') + ',')
}
const listBody = 'const ANIMS = [\n' + rows.join('\n').replace(/,$/, '') + '\n]'

const src = readFileSync(TARGET, 'utf8')
let out = between(src, 'LIST', listBody)
out = between(out, 'PROMPT', bankPrompt())

if (process.argv.includes('--check')) {
  if (out !== src) {
    console.error(`✗ orchestrate/index.ts est désynchronisé de la banque (${BANK.length} animations).`)
    console.error('  Lance : node render-worker/sync-anim-bank.mjs')
    process.exit(1)
  }
  console.log(`✓ banque synchronisée (${BANK.length} animations)`)
} else if (out === src) {
  console.log(`✓ déjà à jour (${BANK.length} animations)`)
} else {
  writeFileSync(TARGET, out)
  console.log(`✓ orchestrate/index.ts mis à jour — ${BANK.length} animations`)
}

// ── GARDE-FOU : pas d'accent grave dans anim-pack non plus ───────────────────
// Le HTML des animations vit dans des template literals. Un accent grave écrit
// dans un COMMENTAIRE à l'intérieur du gabarit ferme la chaîne et casse tout le
// fichier — c'est arrivé deux fois : dans une description de banque, puis dans un
// commentaire HTML de `chat`. Le contrôle de la banque ne suffisait donc pas.
{
  const src = readFileSync(join(HERE, 'anim-pack.mjs'), 'utf8').split('\n')
  const fautes = []
  let dansGabarit = false
  src.forEach((l, i) => {
    // suivi grossier mais suffisant : une ligne qui ouvre `return box(` entre dans
    // un gabarit, une ligne qui le referme en sort.
    if (/return box\(`/.test(l)) dansGabarit = true
    if (dansGabarit && /`\)$/.test(l.trim())) { dansGabarit = false; return }
    if (dansGabarit && /<!--/.test(l) && l.includes('`')) fautes.push((i + 1) + ' : ' + l.trim().slice(0, 80))
  })
  if (fautes.length) {
    console.error('✗ accent grave dans un commentaire HTML de gabarit — il ferme la chaîne :')
    for (const f of fautes) console.error('   ' + f)
    process.exit(1)
  }
}
