#!/usr/bin/env node
// Creative Factory — PLAN d'un lot (14/10, reconstruit dans le repo). Lit l'instantané écrit par lot.py (bricks.json,
// variantes, recettes déjà produites) et choisit les recettes. Règles d'Axel appliquées ici :
//  · jamais une recette déjà produite (Omni : photo|hook|démo ; Texte + musique : réaction|démo), refusées comprises ;
//  · démos « image → vidéo » d'abord (Omni, motion control, static ads), puis Claude, Images IA seules ≤ 1 par lot (~1/10) ;
//  · jamais la démo intérieure (C-OMNI-03 / C-OMNIM-03), ni C-IMGIA-05 / C-IMGIAM-01 (supprimées) ;
//  · hook × démo compatibles (coherence.js, pairLevel ok) ; pour chaque photo, le hook le MOINS utilisé ;
//  · Texte + musique : une réaction part avec 5 démos muettes au plus (anti-shadowban) ; réactions « Insomnie » (R-I-*)
//    exclues (format à part) ; réactions les moins utilisées d'abord.
// usage : node plan.mjs <dossier de travail> <nb Omni> <nb Texte+musique> [graine]   → JSON { O:[…], M:[…] } sur stdout
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const [W, nO = '13', nM = '12', seedArg = '1410'] = process.argv.slice(2)
const USINE = join(dirname(fileURLToPath(import.meta.url)), '..')
await import(join(USINE, 'hook-liaison.js')); await import(join(USINE, 'coherence.js')); const COH = globalThis.CF_COHERENCE
const B = JSON.parse(fs.readFileSync(join(W, 'bricks.json'), 'utf8')), by = Object.fromEntries(B.map(b => [b.id, b]))
const X = JSON.parse(fs.readFileSync(join(W, 'inventaire.json'), 'utf8'))
let seed = +seedArg || 1410; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const EXCLUS = new Set(['C-OMNI-03', 'C-OMNIM-03', 'C-IMGIA-05', 'C-IMGIAM-01'])
const usedOmni = new Set(), usedF05 = new Set(), demoUse = {}, hookUse = {}, reactUse = {}
for (const q of X.qc) { const c = q.c || {}
  if (c.voice === 'omni') { usedOmni.add([c.photo, c.hook, c.contenu].join('|')); hookUse[c.photo + '|' + c.hook] = (hookUse[c.photo + '|' + c.hook] || 0) + 1 }
  if (c.format === 'F05') { usedF05.add(c.reaction + '|' + c.contenu); if (q.s !== 'refused') reactUse[c.reaction] = (reactUse[c.reaction] || 0) + 1 }
  if (c.contenu) demoUse[c.contenu] = (demoUse[c.contenu] || 0) + 1 }
const ready = b => b && b.status === 'ready'
const demos = B.filter(b => b.kind === 'contenu' && ready(b) && !/^C-[A-Z]+M-/.test(b.id) && b.meta?.voice !== false && b.meta?.muette !== true && !EXCLUS.has(b.id))
const mdemos = B.filter(b => b.kind === 'contenu' && ready(b) && /^C-[A-Z]+M-/.test(b.id) && !EXCLUS.has(b.id)).map(b => b.id)
const PRI = d => /OMNI|-MC-|MCM|SADS/.test(d) ? 0 : /MCP/.test(d) ? 1 : 2
const lotUse = {}
const pick = (list, n) => { const out = [], l = [...list]
  while (out.length < n && l.length) {
    l.sort((a, b) => ((lotUse[a] || 0) >= 2) - ((lotUse[b] || 0) >= 2) || (PRI(a) - PRI(b)) * 100 + ((lotUse[a] || 0) - (lotUse[b] || 0)) * 30 + (demoUse[a] || 0) - (demoUse[b] || 0) + (rnd() - 0.5) * 2)
    const d = l.shift(); out.push(d); demoUse[d] = (demoUse[d] || 0) + 1; lotUse[d] = (lotUse[d] || 0) + 1 }
  return out }
const O = [], M = []
// ── Omni : une photo après l'autre (A4 / A3 alternés), le hook le moins utilisé qui a encore une démo libre ──
const vars = X.variants.filter(v => v.f === 'omni' && /^H\d+$/.test(v.b) && /^A[34]-/.test(v.a) && ready(by[v.b]))
const photos = [...new Set(vars.map(v => v.a))].sort((a, b) => (a.slice(3) - b.slice(3)) || a.localeCompare(b))
let guard = 0
while (O.length < +nO && guard++ < 80) for (const p of photos) {
  if (O.length >= +nO) break
  const hs = [...new Set(vars.filter(v => v.a === p).map(v => v.b))].sort((a, b) => (hookUse[p + '|' + a] || 0) - (hookUse[p + '|' + b] || 0) + (rnd() - 0.5) * 0.5)
  for (const h of hs) {
    const free = demos.filter(d => COH.pairLevel(by[h], d) === 'ok' && !usedOmni.has([p, h, d.id].join('|'))).map(d => d.id)
    const imgia = O.filter(o => /IMGIA/.test(o.demo)).length
    const cand = imgia >= 1 ? free.filter(d => !/IMGIA/.test(d)) : free
    if (!cand.length) continue
    const d = pick(cand, 1)[0]; usedOmni.add([p, h, d].join('|')); hookUse[p + '|' + h] = (hookUse[p + '|' + h] || 0) + 1
    O.push({ k: 'o', photo: p, hook: h, demo: d }); break
  }
}
// ── Texte + musique : réactions qui ont encore de la place (< 5 démos), les moins utilisées d'abord ──
const reacts = B.filter(b => b.kind === 'reaction' && ready(b) && !/^R-I-/.test(b.id) && b.meta?.media).map(b => b.id)
let g2 = 0
while (M.length < +nM && g2++ < 200) {
  const r = reacts.filter(x => (reactUse[x] || 0) < 5).sort((a, b) => (reactUse[a] || 0) - (reactUse[b] || 0) + (rnd() - 0.5) * 0.8)[0]
  if (!r) break
  const free = mdemos.filter(d => !usedF05.has(r + '|' + d))
  if (!free.length) { reactUse[r] = 5; continue }
  const d = pick(free, 1)[0]; usedF05.add(r + '|' + d); reactUse[r] = (reactUse[r] || 0) + 1; M.push({ k: 'm', react: r, demo: d })
}
console.log(JSON.stringify({ O, M }))
