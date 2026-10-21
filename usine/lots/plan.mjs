#!/usr/bin/env node
// Creative Factory — PLAN d'un lot (14/10, reconstruit dans le repo). Lit l'instantané écrit par lot.py (bricks.json,
// variantes, recettes déjà produites) et choisit les recettes. Règles d'Axel appliquées ici :
//  · jamais une recette déjà produite (Omni : photo|hook|démo ; Texte + musique : réaction|démo), refusées comprises ;
//  · démos « image → vidéo » d'abord (Omni, motion control, static ads, Express depuis le 19/10), puis Claude, Images IA seules ≤ 1 par lot (~1/10) ;
//  · jamais la démo intérieure (C-OMNI-03 / C-OMNIM-03), ni C-IMGIA-05 / C-IMGIAM-01 (supprimées) ;
//  · hook × démo compatibles (coherence.js, pairLevel ok) ; pour chaque photo, le hook le MOINS utilisé ;
//  · Texte + musique : une réaction part avec 5 démos muettes au plus (anti-shadowban) ; réactions les moins utilisées d'abord ;
//    réactions « Insomnie » (R-I-*) INCLUSES depuis le 15/10 (Axel : mélanger tous les formats) — lot.py leur donne un TI, jamais un TH,
//    et jamais une démo Images IA seule.
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
// Axel 15/10 (VF-0489 / VF-0503) : ce que l'ILLUSTRATION du hook montre doit être ce que la démo montre, pour TOUS les
// modules : avant / après Omni → démo Omni ; pubs → démo static ads ; influenceuse / avatar IA → démo Images IA.
// (règle partagée avec build.mjs : usine/illus-demo.js)
const ILLUS = JSON.parse(fs.readFileSync(join(USINE, 'illustrations.json'), 'utf8')).bricks || {}
const { illusMismatch } = await import(join(USINE, 'illus-demo.js'))
const illusOk = (h, d) => !illusMismatch(ILLUS[h], d)
const usedOmni = new Set(), usedF05 = new Set(), demoUse = {}, hookUse = {}, reactUse = {}
for (const q of X.qc) { const c = q.c || {}
  if (c.voice === 'omni' && !c.voix_off) { usedOmni.add([c.photo, c.hook, c.contenu].join('|')); if (q.s !== 'refused') hookUse[c.photo + '|' + c.hook] = (hookUse[c.photo + '|' + c.hook] || 0) + 1 }
  if (c.format === 'F05') { usedF05.add(c.reaction + '|' + c.contenu); if (q.s !== 'refused') reactUse[c.reaction] = (reactUse[c.reaction] || 0) + 1 }
  if (c.contenu) demoUse[c.contenu] = (demoUse[c.contenu] || 0) + 1 }
const ready = b => b && b.status === 'ready'
// Lot ciblé (Axel 16/10, « recettes gagnantes ») : HOOKS=H72,H24 et DEMOS=C-MCP- restreignent le choix, toutes les autres règles restent
const HOOKS = (process.env.HOOKS || '').split(',').map(s => s.trim()).filter(Boolean), DEMO_PREF = process.env.DEMOS || ''
// PHOTOS=A3-7,A3-8,… (Axel 19/10) : parlées seulement sur ces photos — les photos retirées le 18/10 (ancien cadrage, avatar trop près)
// gardent leurs variantes en base, mais un lot n'a pas à les reprendre
const PHOTOS = (process.env.PHOTOS || '').split(',').map(s => s.trim()).filter(Boolean)
const demos = B.filter(b => b.kind === 'contenu' && ready(b) && !/^C-[A-Z]+M-/.test(b.id) && b.meta?.voice !== false && b.meta?.muette !== true && !EXCLUS.has(b.id) && (!DEMO_PREF || b.id.startsWith(DEMO_PREF)))
const mdemos = B.filter(b => b.kind === 'contenu' && ready(b) && /^C-[A-Z]+M-/.test(b.id) && !EXCLUS.has(b.id)).map(b => b.id)
// Axel 21/10 (« beaucoup de vidéos OMNI… faudrait que ça soit équitable ») : les familles de démo tournent À PARTS ÉGALES dans
// un lot — Omni, static ads, motion control, Claude (MCP), Express ; Images IA seules restent ≤ 1 par lot (plus bas)
const FAM = d => /MCP/.test(d) ? 'mcp' : /OMNI/.test(d) ? 'omni' : /SADS/.test(d) ? 'sads' : /-MCM?-/.test(d) ? 'mc' : /EXP/.test(d) ? 'exp' : 'autre'
const lotUse = {}, famUse = {}
const pick = (list, n) => { const out = [], l = [...list]
  while (out.length < n && l.length) {
    l.sort((a, b) => ((lotUse[a] || 0) >= 2) - ((lotUse[b] || 0) >= 2) || ((famUse[FAM(a)] || 0) - (famUse[FAM(b)] || 0)) * 100 + ((lotUse[a] || 0) - (lotUse[b] || 0)) * 30 + (demoUse[a] || 0) - (demoUse[b] || 0) + (rnd() - 0.5) * 2)
    const d = l.shift(); out.push(d); demoUse[d] = (demoUse[d] || 0) + 1; lotUse[d] = (lotUse[d] || 0) + 1; famUse[FAM(d)] = (famUse[FAM(d)] || 0) + 1 }
  return out }
// Axel 21/10 : H85 (« attirer des clients sur ton site ») et H89 (« 100 réels Instagram par heure ») ne vont pas avec une démo Omni
const PAS_OMNI = new Set(['H85', 'H89'])
const O = [], M = []
// ── Omni : une photo après l'autre (A4 / A3 alternés), le hook le moins utilisé qui a encore une démo libre ──
// 20/10 (Axel) : A1 ouvert (compte @ialebd.axel). Une démo Claude (C-MCP) demande un CTA-CLAUDE de l'avatar (lot.py cta_for) :
// un avatar sans ce CTA (A1 pour l'instant) ne reçoit pas de démo Claude.
const avClaude = new Set(X.variants.filter(v => v.f === 'omni' && v.b === 'CTA-CLAUDE').map(v => v.a.split('-')[0]))
const vars = X.variants.filter(v => v.f === 'omni' && /^H\d+$/.test(v.b) && /^A[134]-/.test(v.a) && ready(by[v.b]) && (!HOOKS.length || HOOKS.includes(v.b)) && (!PHOTOS.length || PHOTOS.includes(v.a)))
const photos = [...new Set(vars.map(v => v.a))].sort((a, b) => (a.slice(3) - b.slice(3)) || a.localeCompare(b))
// Axel 20/10 (A3-11 · H88 vu 16 fois, A4-1 · H20 18 fois) : une même photo ne garde pas le même hook plus de CAP_HOOK fois
// (validées + en revue, refusées exclues) — au-delà, le tirage passe à un autre hook / une autre photo
const CAP_HOOK = +(process.env.CAP_HOOK || 7)
let guard = 0
while (O.length < +nO && guard++ < 80) for (const p of photos) {
  if (O.length >= +nO) break
  const hs = [...new Set(vars.filter(v => v.a === p).map(v => v.b))].filter(h => (hookUse[p + '|' + h] || 0) < CAP_HOOK).sort((a, b) => (hookUse[p + '|' + a] || 0) - (hookUse[p + '|' + b] || 0) + (rnd() - 0.5) * 0.5)
  for (const h of hs) {
    const free = demos.filter(d => COH.pairLevel(by[h], d) === 'ok' && illusOk(h, d) && !(PAS_OMNI.has(h) && /OMNI/.test(d.id + ' ' + (d.label || ''))) && !usedOmni.has([p, h, d.id].join('|')) && (avClaude.has(p.split('-')[0]) || !/^C-MCP/.test(d.id))).map(d => d.id)
    const imgia = O.filter(o => /IMGIA/.test(o.demo)).length
    const cand = imgia >= 1 ? free.filter(d => !/IMGIA/.test(d)) : free
    if (!cand.length) continue
    const d = pick(cand, 1)[0]; usedOmni.add([p, h, d].join('|')); hookUse[p + '|' + h] = (hookUse[p + '|' + h] || 0) + 1
    O.push({ k: 'o', photo: p, hook: h, demo: d }); break
  }
}
// ── Texte + musique : réactions qui ont encore de la place (< 5 démos), les moins utilisées d'abord ──
const reacts = B.filter(b => b.kind === 'reaction' && ready(b) && b.meta?.media).map(b => b.id)
let g2 = 0
while (M.length < +nM && g2++ < 200) {
  const r = reacts.filter(x => (reactUse[x] || 0) < 5).sort((a, b) => (reactUse[a] || 0) - (reactUse[b] || 0) + (rnd() - 0.5) * 0.8)[0]
  if (!r) break
  const free = mdemos.filter(d => !usedF05.has(r + '|' + d) && !(/^R-I-/.test(r) && /IMGIAM/.test(d)))
  if (!free.length) { reactUse[r] = 5; continue }
  const d = pick(free, 1)[0]; usedF05.add(r + '|' + d); reactUse[r] = (reactUse[r] || 0) + 1; M.push({ k: 'm', react: r, demo: d })
}
// ── Voix off (Axel 21/10) : la VOIX d'une prise Omni, à l'image le résultat d'une transformation en plein écran + l'original en
//    médaillon (usine/voix-off-mc.py), puis la démo du même module et le CTA. Motion Control (TX-M → C-MC-01) et Omni (TX-O →
//    une démo Omni) en alternance. Plafonds : 7 fois max par VOIX (photo × hook) dans ce format — compté à part des parlées —
//    et 7 fois max par TRANSFORMATION en plein écran. ──
const V = [], NVO = +(process.env.VOIX_OFF || 0)
if (NVO) {
  const voUse = {}, txUse = {}
  const voDone = new Set()   // jamais deux fois la même voix sur la même transformation
  for (const q of X.qc) { const c = q.c || {}; if (c.voix_off) voDone.add([c.photo, c.hook, c.voix_off].join('|')); if (c.voix_off && q.s !== 'refused') { voUse[c.photo + '|' + c.hook] = (voUse[c.photo + '|' + c.hook] || 0) + 1; txUse[c.voix_off] = (txUse[c.voix_off] || 0) + 1 } }
  const FAMS = [{ tx: ['TX-M01', 'TX-M02', 'TX-M04'], demos: ['C-MC-01'] },
    { tx: ['TX-O02a', 'TX-O02b', 'TX-O02c', 'TX-O06', 'TX-O10', 'TX-O11', 'TX-O12', 'TX-O12b'], demos: demos.filter(d => /^C-OMNI-/.test(d.id)).map(d => d.id) }]
  let f = 0, guardV = 0
  while (V.length < NVO && guardV++ < NVO * 4) {
    const F = FAMS[f++ % FAMS.length]
    const tx = F.tx.filter(t => (txUse[t] || 0) < CAP_HOOK).sort((a, b) => (txUse[a] || 0) - (txUse[b] || 0))[0]
    if (!tx) continue
    const demo = F.demos.sort((a, b) => (demoUse[a] || 0) - (demoUse[b] || 0))[0]
    if (!demo || !by[demo]) continue
    const cand = vars.filter(v => COH.pairLevel(by[v.b], by[demo]) === 'ok' && (voUse[v.a + '|' + v.b] || 0) < CAP_HOOK && !voDone.has([v.a, v.b, tx].join('|')) && !V.some(x => x.photo === v.a && x.hook === v.b))
      .sort((a, b) => (voUse[a.a + '|' + a.b] || 0) - (voUse[b.a + '|' + b.b] || 0) + (rnd() - 0.5) * 0.8)[0]
    if (!cand) continue
    V.push({ k: 'v', photo: cand.a, hook: cand.b, demo, tx })
    txUse[tx] = (txUse[tx] || 0) + 1; voUse[cand.a + '|' + cand.b] = (voUse[cand.a + '|' + cand.b] || 0) + 1; demoUse[demo] = (demoUse[demo] || 0) + 1
  }
}
console.log(JSON.stringify({ O, M, V }))
