// extraire-app.mjs — lit les VRAIES fonctions du Nettoyage audio dans app/index.html.
//
// Le banc de parité ne doit pas comparer le worker à une copie de lui-même : il
// va chercher le code dans le fichier que les clients exécutent, tel quel, et le
// rejoue dans Node. Si quelqu'un modifie la chaîne voix de l'app sans reporter la
// modification dans render-worker/voice-chain.mjs, le banc casse.
//
// Extraction par appariement d'accolades, en sautant chaînes et commentaires
// (les fonctions visées n'utilisent pas de littéral regex).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
export const APP_HTML = join(ICI, '..', '..', '..', 'app', 'index.html')
export const APP_RNNOISE_DIR = join(ICI, '..', '..', '..', 'assets', 'lib', 'rnnoise')

let _src = null
export function sourceApp() {
  if (_src == null) _src = readFileSync(APP_HTML, 'utf8')
  return _src
}

// position de l'accolade fermante qui répond à celle ouverte en `ouv`
export function accoladeFermante(src, ouv) {
  let prof = 0
  for (let i = ouv; i < src.length; i++) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { const f = src.indexOf('\n', i); i = f < 0 ? src.length : f; continue }
    if (c === '/' && d === '*') { const f = src.indexOf('*/', i + 2); i = f < 0 ? src.length : f + 1; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++ }
      i = j; continue
    }
    if (c === '{') prof++
    else if (c === '}') { prof--; if (prof === 0) return i }
  }
  throw new Error('accolade non refermée à partir de ' + ouv)
}

// source complète d'une déclaration `function nom(` / `async function nom(`
export function extraireFonction(src, nom) {
  const re = new RegExp(`(^|\\n)((?:export )?(?:async )?function ${nom}\\()`)
  const m = re.exec(src)
  if (!m) throw new Error(`fonction ${nom} introuvable`)
  const debut = m.index + m[1].length
  // la première accolade APRÈS la liste de paramètres (les valeurs par défaut n'en ont pas ici)
  const finParams = parenFermante(src, src.indexOf('(', debut))
  const ouv = src.indexOf('{', finParams)
  return src.slice(debut, accoladeFermante(src, ouv) + 1)
}

function parenFermante(src, ouv) {
  let prof = 0
  for (let i = ouv; i < src.length; i++) {
    if (src[i] === '(') prof++
    else if (src[i] === ')') { prof--; if (prof === 0) return i }
  }
  throw new Error('parenthèse non refermée')
}

// source d'une déclaration `const nom = { … }` (objet littéral sur plusieurs lignes)
export function extraireObjet(src, entete) {
  const i = src.indexOf(entete)
  if (i < 0) throw new Error(`${entete} introuvable`)
  const ouv = src.indexOf('{', i + entete.length)
  return src.slice(i, accoladeFermante(src, ouv) + 1) + ';'
}

// une ligne simple (`let _acVoicePreset = 'off';`)
export function extraireLigne(src, re) {
  const m = re.exec(src)
  if (!m) throw new Error(`ligne ${re} introuvable`)
  return m[0]
}

// Code sans commentaires ni blancs : sert à vérifier qu'une fonction portée est
// restée identique à celle de l'app (seul le code compte, pas la mise en forme).
export function codeNormalise(fnSrc) {
  let out = ''
  for (let i = 0; i < fnSrc.length; i++) {
    const c = fnSrc[i], d = fnSrc[i + 1]
    if (c === '/' && d === '/') { const f = fnSrc.indexOf('\n', i); i = f < 0 ? fnSrc.length : f - 1; continue }
    if (c === '/' && d === '*') { const f = fnSrc.indexOf('*/', i + 2); i = f < 0 ? fnSrc.length : f + 1; continue }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < fnSrc.length && fnSrc[j] !== c) { if (fnSrc[j] === '\\') j++; j++ }
      out += fnSrc.slice(i, j + 1).replace(/"/g, "'"); i = j; continue
    }
    out += c
  }
  return out
    .replace(/^export /, '')
    .replace(/\s+/g, '')
    .replace(/;/g, '')
}
