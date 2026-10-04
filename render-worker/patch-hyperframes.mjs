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
//
// Audit 04/10 (MONT-2) : un 2e patch, indépendant (sa propre marque), limite les
// téléchargements de la compilation aux origines AA_HF_DL_ALLOW posées par
// worker.mjs (le stockage du projet), sans redirection. Voir plus bas.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const cible = process.argv[2]
if (!cible) { console.error('usage: node patch-hyperframes.mjs <chemin de dist/cli.js>'); process.exit(1) }

const pkg = JSON.parse(readFileSync(join(dirname(cible), '..', 'package.json'), 'utf8'))
if (pkg.version !== '0.7.60') {
  console.error(`✗ hyperframes ${pkg.version} trouvé, patch écrit pour 0.7.60 — vérifier l'ancre avant de re-épingler`)
  process.exit(1)
}

let src = readFileSync(cible, 'utf8')
let modifie = false
// Une ancre doit apparaître EXACTEMENT une fois, sinon le build échoue (la CLI a changé : patch à revoir).
const unique = (texte, ancre, nom) => {
  const n = texte.split(ancre).length - 1
  if (n !== 1) { console.error(`✗ ${nom} : ancre trouvée ${n} fois (attendu : 1) — la CLI a changé, patch à revoir`); process.exit(1) }
}

// ── Patch 1 : les erreurs d'extraction se logguent avant le garde de couverture ──
const MARQUE = '[hyperframes:extract-errors]'
if (src.includes(MARQUE)) console.log('✓ patch 1 (erreurs d\'extraction) déjà appliqué')
else {
  // L'ancre : l'appel (unique) au garde de couverture, dans le pipeline de rendu.
  const ANCRE = '    assertVideoFrameCoverage(coverageReports, coverageThreshold);'
  unique(src, ANCRE, 'patch 1')
  // Sur stdout (streamée en direct dans les logs Railway), queue de 500 chars :
  // hyperframes met déjà la fin de la stderr ffmpeg dans le message, et c'est à
  // la fin que ffmpeg écrit la cause réelle.
  const LOG = `    if (extractionResult && Array.isArray(extractionResult.errors)) {
      for (const hfErr of extractionResult.errors) {
        process.stdout.write("${MARQUE} video=" + hfErr.videoId + " :: " + String(hfErr.error).replace(/\\s+/g, " ").slice(-500) + "\\n");
      }
    }
`
  src = src.replace(ANCRE, () => LOG + ANCRE)
  modifie = true
  console.log('✓ patch 1 : les erreurs d\'extraction se logguent avant le garde de couverture')
}

// ── Patch 2 (Audit 04/10, MONT-2) : téléchargements de la compilation limités au stockage du projet ──
// La compilation (côté Node, AVANT Chromium et sa CSP) télécharge toute URL https trouvée dans un src d'<img>/<video>/<audio>
// ou un url() de fond — y compris dans le TEXTE d'un sous-titre (« background:url(https://…) » sort intact de l'échappement
// HTML) — vers n'importe quel hôte : seul l'hôte littéral était contrôlé, redirections suivies (http interne compris), 300 s,
// sans plafond. Le moteur passe AA_HF_DL_ALLOW (origines permises, séparées par des virgules : l'origine Supabase du projet,
// celle des liens signés des images perso) : toute autre origine est refusée et les redirections sont interdites. Variable
// absente (rendu local) : comportement d'origine. Un téléchargement refusé n'arrête pas le rendu (la compilation garde l'URL,
// que la CSP de la page bloque) : seule une URL étrangère au projet est concernée.
const MARQUE2 = '__aaDlAutorise'
if (src.includes(MARQUE2)) console.log('✓ patch 2 (origines de téléchargement) déjà appliqué')
else {
  const ANCRE_A = 'async function downloadToTemp(url, destDir, timeoutMs = 3e5) {\n  assertPublicHttpsUrl(url);'
  const ANCRE_B = '      const response = await fetch(url, { signal: controller.signal });'
  unique(src, ANCRE_A, 'patch 2 (entrée de downloadToTemp)')
  unique(src, ANCRE_B, 'patch 2 (fetch de downloadToTemp)')
  const GARDE = `function ${MARQUE2}(url) {
  const permis = String(process.env.AA_HF_DL_ALLOW || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!permis.length) return;
  let origine = "";
  try { origine = new URL(url).origin; } catch {}
  if (!permis.includes(origine)) throw new Error("[URLDownloader] origine non autorisée par le moteur de rendu : " + origine);
}
`
  src = src.replace(ANCRE_A, () => GARDE + ANCRE_A + `\n  ${MARQUE2}(url);`)
  src = src.replace(ANCRE_B, () => '      const response = await fetch(url, { signal: controller.signal, redirect: process.env.AA_HF_DL_ALLOW ? "error" : "follow" });')
  modifie = true
  console.log('✓ patch 2 : téléchargements de la compilation limités aux origines AA_HF_DL_ALLOW, sans redirection')
}

if (modifie) writeFileSync(cible, src)
else console.log('✓ hyperframes déjà patché — rien à faire')
