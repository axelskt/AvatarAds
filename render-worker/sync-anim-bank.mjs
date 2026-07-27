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
