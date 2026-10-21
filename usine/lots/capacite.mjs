#!/usr/bin/env node
// Creative Factory — CAPACITÉ RÉELLE de l'usine (Axel 21/10 : « mets à jour les datas en prenant en compte toutes les règles,
// combien de vidéos je peux créer actuellement, combien si je crée toutes les briques, et l'estimation de ce coût »).
// Mêmes règles que plan.mjs (les lots) — rien d'inventé ici :
//  · Omni parlée : photo ACTIVE (meta.images de l'avatar) × hook prêt, au plus CAP_HOOK (7) vidéos par photo × hook (refusées
//    exclues), une démo différente à chaque fois (jamais photo|hook|démo deux fois, refusées comprises), démo compatible
//    (pairLevel ok + illustration cohérente), H85 / H89 jamais avec une démo Omni, démo Claude (C-MCP) seulement si l'avatar a son
//    CTA-CLAUDE ;
//  · Fond vert : 7 vidéos au plus par TRANSFORMATION branchée (usine/voix-off-mc.py) et 7 par voix (photo × hook) ; H14 jamais,
//    H60 en Motion Control seulement ;
//  · Texte + musique : une réaction part avec 5 démos muettes au plus, jamais deux fois la même réaction × démo.
// « Si toutes les briques » = chaque photo active d'un avatar de la ROTATION (pas la catégorie AUTRE, avatars ponctuels) reçoit TOUS les hooks prêts (prises Omni à générer) + le CTA-CLAUDE des
// avatars qui ne l'ont pas. Coût = prises à générer × durée conseillée (omni-hook-prompt.mjs) × prix Omni Flash 1080p (kie,
// 0,07 $/s : 6 s = 0,42 $ mesuré le 24/09) × 1,25 (prises ratées refaites ou dérushées).
// usage : node capacite.mjs <dossier de travail>   (bricks.json + inventaire.json écrits par outils.snapshot) → JSON sur stdout
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'
const [W] = process.argv.slice(2)
const USINE = join(dirname(fileURLToPath(import.meta.url)), '..')
await import(join(USINE, 'hook-liaison.js')); await import(join(USINE, 'coherence.js')); const COH = globalThis.CF_COHERENCE
const { dureeConseillee } = await import(join(USINE, 'omni-hook-prompt.mjs'))
const { illusMismatch } = await import(join(USINE, 'illus-demo.js'))
const B = JSON.parse(fs.readFileSync(join(W, 'bricks.json'), 'utf8')), by = Object.fromEntries(B.map(b => [b.id, b]))
const X = JSON.parse(fs.readFileSync(join(W, 'inventaire.json'), 'utf8'))
const ILLUS = JSON.parse(fs.readFileSync(join(USINE, 'illustrations.json'), 'utf8')).bricks || {}
const CAP = 7, PRIX_S = 0.07, MARGE = 1.25, ready = b => b && b.status === 'ready'
const EXCLUS = new Set(['C-OMNI-03', 'C-OMNIM-03', 'C-IMGIA-05', 'C-IMGIAM-01'])   // = plan.mjs
const PAS_OMNI = new Set(['H85', 'H89']), FV_PAS = new Set(['H14']), FV_MC_SEUL = new Set(['H60'])
// transformations BRANCHÉES dans le fond vert (= PAIRS de usine/voix-off-mc.py)
const TX_FV = { M: ['TX-M01', 'TX-M02', 'TX-M04'], O: ['TX-O02a', 'TX-O02b', 'TX-O02c', 'TX-O06', 'TX-O10', 'TX-O11', 'TX-O12', 'TX-O12b'] }
const demos = B.filter(b => b.kind === 'contenu' && ready(b) && !/^C-[A-Z]+M-/.test(b.id) && b.meta?.voice !== false && b.meta?.muette !== true && !EXCLUS.has(b.id))
const mdemos = B.filter(b => b.kind === 'contenu' && ready(b) && /^C-[A-Z]+M-/.test(b.id) && !EXCLUS.has(b.id)).map(b => b.id)
const isHook = id => /^H\d+$/.test(id) && ready(by[id]) && by[id].kind === 'hook'

// ── photos actives : meta.images des avatars prêts (A1-9…, A3-7…, AUTRE-1…) ──
const photos = []
for (const a of B.filter(b => b.kind === 'avatar' && ready(b))) for (const u of a.meta?.images || []) photos.push({ id: basename(String(u)).replace(/\.[a-z0-9]+$/i, ''), av: a.id })
const avOf = p => p.split('-')[0]
const omniVar = new Set(X.variants.filter(v => v.f === 'omni').map(v => v.a + '|' + v.b))
const hasVar = (p, h) => omniVar.has(p + '|' + h)
const avClaude = new Set(X.variants.filter(v => v.f === 'omni' && v.b === 'CTA-CLAUDE').map(v => avOf(v.a)))
const avCta = new Set(X.variants.filter(v => v.f === 'omni' && /^CTA-/.test(v.b) && v.b !== 'CTA-CLAUDE').map(v => avOf(v.a)))

// ── ce qui est déjà produit (= plan.mjs) ──
const usedOmni = new Set(), hookUse = {}, voUse = {}, txUse = {}, reactUse = {}, usedF05 = new Set()
for (const q of X.qc) { const c = q.c || {}
  if (c.voice === 'omni' && !c.voix_off && !c.fond_vert) { usedOmni.add([c.photo, c.hook, c.contenu].join('|')); if (q.s !== 'refused') hookUse[c.photo + '|' + c.hook] = (hookUse[c.photo + '|' + c.hook] || 0) + 1 }
  if (c.fond_vert && q.s !== 'refused') { voUse[c.photo + '|' + c.hook] = (voUse[c.photo + '|' + c.hook] || 0) + 1; txUse[c.fond_vert] = (txUse[c.fond_vert] || 0) + 1 }
  if (c.format === 'F05') { usedF05.add(c.reaction + '|' + c.contenu); if (q.s !== 'refused') reactUse[c.reaction] = (reactUse[c.reaction] || 0) + 1 } }

// ── Omni parlée ──
const freeDemos = (p, h, claudeOk) => demos.filter(d => COH.pairLevel(by[h], d) === 'ok' && !illusMismatch(ILLUS[h], d) && !(PAS_OMNI.has(h) && /OMNI/.test(d.id + ' ' + (d.label || '')))
  && !usedOmni.has([p, h, d.id].join('|')) && (claudeOk || !/^C-MCP/.test(d.id))).length
const hooks = B.filter(b => isHook(b.id)).map(b => b.id)
let omniNow = 0, omniAll = 0, prises = 0, coutPrises = 0, pairesNow = 0, pairesAll = 0
const parAvatar = {}
for (const { id: p, av } of photos) {
  if (!avCta.has(av)) continue   // pas un seul CTA parlé pour cet avatar : aucune vidéo ne peut finir
  const A = parAvatar[av] = parAvatar[av] || { photos: 0, now: 0, all: 0, prises: 0 }; A.photos += 1
  for (const h of hooks) {
    const v = by[h].meta?.voices; if (Array.isArray(v) && v.length && !v.includes('omni')) continue
    const left = Math.max(0, CAP - (hookUse[p + '|' + h] || 0))
    if (hasVar(p, h)) { const n = Math.min(left, freeDemos(p, h, avClaude.has(av))); omniNow += n; A.now += n; if (n) pairesNow += 1 }
    const nAll = av === 'AUTRE' && !hasVar(p, h) ? 0 : Math.min(left, freeDemos(p, h, true)); omniAll += nAll; A.all += nAll; if (nAll) pairesAll += 1
    if (!hasVar(p, h) && nAll) { prises += 1; A.prises += 1; coutPrises += dureeConseillee(by[h].meta?.transcript || by[h].meta?.script || by[h].label || '') * PRIX_S }
  }
}
// CTA-CLAUDE manquants (un par avatar, sur une de ses photos)
const ctaClaude = [...new Set(photos.map(x => x.av))].filter(a => a !== 'AUTRE' && avCta.has(a) && !avClaude.has(a))
const lc = by['CTA-CLAUDE']?.meta?.transcript || ''
prises += ctaClaude.length; coutPrises += ctaClaude.length * dureeConseillee(lc) * PRIX_S

// ── Fond vert ──
const fvVoices = fam => {   // places restantes côté VOIX pour une famille (M = Motion Control → C-MC-01, O = démos Omni)
  let n = 0
  for (const { id: p } of photos) for (const h of hooks) {
    if (!hasVar(p, h) || FV_PAS.has(h) || (FV_MC_SEUL.has(h) && fam !== 'M') || (fam === 'O' && PAS_OMNI.has(h))) continue
    const ok = fam === 'M' ? COH.pairLevel(by[h], by['C-MC-01']) === 'ok' : demos.some(d => /^C-OMNI-/.test(d.id) && COH.pairLevel(by[h], d) === 'ok')
    if (ok) n += Math.max(0, CAP - (voUse[p + '|' + h] || 0))
  }
  return n
}
const txLeft = fam => TX_FV[fam].reduce((s, t) => s + Math.max(0, CAP - (txUse[t] || 0)), 0)
const fv = { M: Math.min(txLeft('M'), fvVoices('M')), O: Math.min(txLeft('O'), fvVoices('O')) }
const branchees = new Set([...TX_FV.M, ...TX_FV.O])
const txNonBranchees = B.filter(b => b.kind === 'transformation' && ready(b) && !branchees.has(b.id)).map(b => b.id)

// ── Texte + musique ──
const reacts = B.filter(b => b.kind === 'reaction' && ready(b) && b.meta?.media && !b.meta?.parlee).map(b => b.id)   // 21/10 : tête choquée PARLÉE = autre format
let f05 = 0
for (const r of reacts) f05 += Math.min(Math.max(0, 5 - (reactUse[r] || 0)), mdemos.filter(d => !usedF05.has(r + '|' + d) && !(/^R-I-/.test(r) && /IMGIAM/.test(d))).length)

// vidéos déjà générées (validées + en revue, refusées exclues), par format
const gen = { omni: 0, fond_vert: 0, texte_musique: 0 }
for (const q of X.qc) { const c = q.c || {}; if (q.s === 'refused') continue
  if (c.fond_vert) gen.fond_vert += 1; else if (c.format === 'F05') gen.texte_musique += 1; else if (c.voice === 'omni' && !c.voix_off) gen.omni += 1 }
const now = { omni: omniNow, fond_vert: fv.M + fv.O, texte_musique: f05 }
const all = { omni: omniAll, fond_vert: fv.M + fv.O, texte_musique: f05 }
const sum = o => Object.values(o).reduce((a, b) => a + b, 0)
console.log(JSON.stringify({
  now: { ...now, total: sum(now) }, all: { ...all, total: sum(all) }, gen: { ...gen, total: sum(gen) },
  prises: { n: prises, cout_usd: Math.round(coutPrises * MARGE * 100) / 100, prix_s: PRIX_S, marge: MARGE, cta_claude: ctaClaude },
  fond_vert: { motion_control: fv.M, omni: fv.O, tx_restantes: { M: txLeft('M'), O: txLeft('O') }, tx_non_branchees: txNonBranchees },
  par_avatar: parAvatar, photos: photos.length, hooks: hooks.length, paires: { now: pairesNow, all: pairesAll }, cap: CAP
}))
