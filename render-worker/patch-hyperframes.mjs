#!/usr/bin/env node
// patch-hyperframes.mjs — exécuté AU BUILD de l'image Railway (voir Dockerfile).
//
// Pourquoi patcher une dépendance ? Parce que la CLI hyperframes 0.7.60 AVALE
// les erreurs d'extraction vidéo. Chaque vidéo de la composition est convertie
// en frames par un ffmpeg ; quand l'un d'eux meurt (et sur Railway, avec 6
// vidéos, il en meurt un — jamais le même), l'erreur est rangée dans
// `extractionResult.errors`… qu'AUCUNE ligne de la CLI ne lit jamais. Le rendu
// continue, puis le garde de couverture constate qu'un clip n'a « capturé 0 of
// expected N frames » et abandonne — en accusant la capture, alors que la
// cause (la stderr du ffmpeg perdu) vient d'être jetée. Trois rendus perdus le
// 08/08 sans UNE ligne de diagnostic.
//
// Le patch insère l'unique log manquant : chaque entrée de
// `extractionResult.errors` sur la sortie standard, juste avant le garde.
// Les versions ultérieures de la CLI (0.7.85) ont une vraie politique d'échec
// (HF_VIDEO_EXTRACTION_FAILURE_MODE) — le jour où le pin bouge, ce patch et ce
// détour disparaissent.
//
// Garde-fous : version exigée 0.7.60 (le pin de worker.mjs), ancre exigée
// EXACTEMENT une fois, idempotent (relance = no-op). Tout écart fait échouer
// le build — mieux vaut une image qui ne construit pas qu'un patch silencieux
// qui n'est plus appliqué.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const cible = process.argv[2]
if (!cible) { console.error('usage: node patch-hyperframes.mjs <chemin de dist/cli.js>'); process.exit(1) }

const pkg = JSON.parse(readFileSync(join(dirname(cible), '..', 'package.json'), 'utf8'))
if (pkg.version !== '0.7.60') {
  console.error(`✗ hyperframes ${pkg.version} trouvé, patch écrit pour 0.7.60 — vérifier l'ancre avant de re-épingler`)
  process.exit(1)
}

const src = readFileSync(cible, 'utf8')
const MARQUE = '[hyperframes:extract-errors]'
if (src.includes(MARQUE)) { console.log('✓ hyperframes déjà patché — rien à faire'); process.exit(0) }

// L'ancre : l'appel (unique) au garde de couverture, dans le pipeline de rendu.
const ANCRE = '    assertVideoFrameCoverage(coverageReports, coverageThreshold);'
const morceaux = src.split(ANCRE)
if (morceaux.length !== 2) {
  console.error(`✗ ancre trouvée ${morceaux.length - 1} fois (attendu : 1) — la CLI a changé, patch à revoir`)
  process.exit(1)
}

// Sur stdout (streamée en direct dans les logs Railway), queue de 500 chars :
// hyperframes met déjà la fin de la stderr ffmpeg dans le message, et c'est à
// la fin que ffmpeg écrit la cause réelle.
const LOG = `    if (extractionResult && Array.isArray(extractionResult.errors)) {
      for (const hfErr of extractionResult.errors) {
        process.stdout.write("${MARQUE} video=" + hfErr.videoId + " :: " + String(hfErr.error).replace(/\\s+/g, " ").slice(-500) + "\\n");
      }
    }
`
writeFileSync(cible, morceaux[0] + LOG + ANCRE + morceaux[1])
console.log('✓ hyperframes 0.7.60 patché : les erreurs d\'extraction se logguent avant le garde de couverture')
