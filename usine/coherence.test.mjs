#!/usr/bin/env node
// Tests de usine/coherence.js + usine/hook-liaison.js (aucune dépendance) : node usine/coherence.test.mjs
// Bibliothèque de test = la forme des vraies données du 26/09 (2 avatars, 42 hooks dont H64 alias de H63, 12 liaisons dont
// 5 génériques, 15 CTA, 14 démos dont C-CLAUDE-01 et C-IMGIA-05 retirées, 7 transformations en 6 groupes).
// Règle du 26/09 (attentes mises à jour) : les hooks avant / après (H19, H53, H57, H63, H74 ; H64 alias) sortent des 2 modes
// lipsync → 36 hooks, 302 paires → 72 + 604 = 676 vidéos finales par mode (1 352) ; mode Avant / après = 18 assemblages
// → 48 courts + 432 longs = 480 ; total 1 832 (au lieu de 1 460).
import assert from 'node:assert/strict';

await import(new URL('./hook-liaison.js', import.meta.url).href);
await import(new URL('./coherence.js', import.meta.url).href);
const MX = globalThis.CF_HOOK_LIAISON, C = globalThis.CF_COHERENCE;

const results = [];
function test(name, fn) {
  try { fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ' · ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const SB = 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/';
const GENERIC = ['L15', 'L16', 'L19', 'L48', 'L70'];
const LIAISONS = ['L12', 'L15', 'L16', 'L19', 'L28', 'L30', 'L32', 'L33', 'L34', 'L48', 'L58', 'L70'];
const SUBJ = { H12: ['image-ia'], H16: ['mcp-claude'], H19: ['image-ia', 'express', 'omni', 'motion-control'], H20: ['mcp-claude', 'generique'], H25: ['montage-ia'], H48: ['generique'],
  H53: ['motion-control'], H57: ['motion-control'], H63: ['motion-control'], H64: ['motion-control'], H74: ['omni'], H77: ['static-ads'] };
// meta réelles du 26/09 : hooks avant / après (jamais en lipsync) et hooks à incrustation obligatoire
const AA = { H19: 1, H53: 1, H57: 1, H63: 1, H64: 1, H74: 1 }, OVERLAY = { H14: 'fille', H23: 'fille', H60: 'fille' };
const MEDIA = SB + 'transformations/';
// transformations (factory_bricks kind 'transformation', meta.group = un même original filmé) — libellés corrigés le 26/09
const TX = [
  ['TX-M01', 'motion-control', 'M1', 'Homme → Femme (cuisine)', 'original homme', 'personnage femme', 'TX-M01-avant.mp4'],
  ['TX-M02', 'motion-control', 'M2', 'Homme → Femme (Spider-Man)', 'original homme', 'personnage femme', 'TX-M02-avant.mp4'],
  ['TX-M04', 'motion-control', 'M4', 'Homme → Femme (veste)', 'original homme', 'personnage femme', 'TX-M04-avant.mp4'],
  ['TX-O01', 'omni', 'O1', 'Audi → Lamborghini Urus', 'Audi A3', 'Lamborghini Urus', 'TX-O01-avant.mp4'],
  ['TX-O02a', 'omni', 'O2', 'Clio → Porsche 911', 'Renault Clio', 'Porsche 911 GT3', 'TX-O02-avant.mp4'],
  ['TX-O02b', 'omni', 'O2', 'Clio → Bugatti Chiron', 'Renault Clio', 'Bugatti Chiron', 'TX-O02-avant.mp4'],
  ['TX-O03', 'omni', 'O3', 'Bracelet fitness → Patek Philippe', 'Bracelet fitness', 'Patek Philippe Nautilus', 'TX-O03-avant.mp4']];
// les 16 recettes HK du 18/09 (ancien format : 2 transformations entières, toujours de 2 groupes différents)
const OLD_HK = { 'HK-M01-02': ['TX-M01', 'TX-M02'], 'HK-M01-04': ['TX-M01', 'TX-M04'], 'HK-M02-01': ['TX-M02', 'TX-M01'], 'HK-M02-04': ['TX-M02', 'TX-M04'],
  'HK-M04-01': ['TX-M04', 'TX-M01'], 'HK-M04-02': ['TX-M04', 'TX-M02'], 'HK-O01-02a': ['TX-O01', 'TX-O02a'], 'HK-O01-02b': ['TX-O01', 'TX-O02b'], 'HK-O01-03': ['TX-O01', 'TX-O03'],
  'HK-O02a-01': ['TX-O02a', 'TX-O01'], 'HK-O02a-03': ['TX-O02a', 'TX-O03'], 'HK-O02b-01': ['TX-O02b', 'TX-O01'], 'HK-O02b-03': ['TX-O02b', 'TX-O03'], 'HK-O03-01': ['TX-O03', 'TX-O01'],
  'HK-O03-02a': ['TX-O03', 'TX-O02a'], 'HK-O03-02b': ['TX-O03', 'TX-O02b'] };
// Jeu de test FIGÉ sur les hooks du 26/09 (les attentes de capacité en dépendent) : les hooks ajoutés le 28/09 (H59,
// H78-H86) sont dans la matrice mais pas dans cette bibliothèque de test.
const NEW_2809 = new Set(['H59', 'H78', 'H79', 'H80', 'H81', 'H82', 'H83', 'H84', 'H85', 'H86']);
const HOOKS_2609 = Object.keys(MX).filter(h => h !== 'H74v2' && !NEW_2809.has(h));
function library(o) {
  o = o || {};
  const rows = [
    { id: 'A1', kind: 'avatar', subject: 'generique', status: 'ready', meta: {} },
    { id: 'A2', kind: 'avatar', subject: 'generique', status: 'ready', meta: {} }];
  HOOKS_2609.forEach(h => rows.push({ id: h, kind: 'hook', subject: (SUBJ[h] || ['image-ia'])[0], status: 'ready', label: 'Accroche ' + h,
    meta: { compatible_subjects: SUBJ[h] || ['image-ia'], script: 'Phrase du hook ' + h, media: SB + 'hooks/' + h + '.wav', ...(h === 'H64' ? { alias_of: 'H63' } : {}),
      ...(AA[h] ? { lipsync: false, hook_mode: 'avant-apres' } : { lipsync: true }), ...(OVERLAY[h] ? { overlay_required: OVERLAY[h] } : {}) } }));
  LIAISONS.forEach(l => rows.push({ id: l, kind: 'liaison', subject: GENERIC.includes(l) ? 'generique' : 'montage', status: 'ready', label: 'Phrase de la liaison ' + l, meta: { media: SB + 'liaisons/' + l + '.wav', modules: [] } }));
  for (let i = 1; i <= 15; i++) rows.push({ id: 'CTA-' + i, kind: 'cta', subject: 'general', status: 'ready', label: 'CTA ' + i, meta: { media: SB + 'cta/' + i + '.wav' } });
  [['C-CLAUDE-01', 'mcp-claude', 'retired'], ['C-IMGIA-01', 'image-ia'], ['C-IMGIA-02', 'image-ia'], ['C-IMGIA-03', 'image-ia'], ['C-IMGIA-04', 'image-ia'], ['C-IMGIA-05', 'image-ia', 'retired'],
    ['C-IMGIA-06', 'image-ia'], ['C-IMGIA-07', 'image-ia'], ['C-OMNI-01', 'omni'], ['C-OMNI-02', 'omni'], ['C-OMNI-03', 'omni'], ['C-OMNI-04', 'omni'], ['C-SADS-01', 'static-ads'], ['C-SADS-02', 'static-ads']]
    .forEach(([id, s, st]) => rows.push({ id, kind: 'contenu', subject: s, status: st || 'ready', label: 'Démo ' + id, meta: { media: SB + 'demos/' + id + '.mp4' } }));
  TX.forEach(([id, s, g, label, bl, al, bf]) => rows.push({ id, kind: 'transformation', subject: s, status: 'ready', label,
    meta: { group: g, ratio: '9:16', before: { label: bl, media: MEDIA + bf }, after: { label: al, media: MEDIA + id + '-apres.mp4' } } }));
  (o.edit || (() => {}))(rows);
  return rows;
}
const byIdOf = rows => Object.fromEntries(rows.map(b => [b.id, b]));
const seq = (...xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };

// ── matrice ──
C.setPhotosPerAvatar(1);   // tests historiques : 1 photo par avatar (le test « photos par avatar » passe à 3)

test('matrice : 53 hooks (H74v2 tel quel ; + H59, H78-H86 le 28/09), « L33/L35 » = L33, 406 paires (validées par Axel le 28/09)', () => {
  assert.equal(Object.keys(MX).length, 53);
  assert.ok(Array.isArray(MX.H74v2));
  assert.deepEqual([...MX.H32], ['L16', 'L32', 'L34']);
  assert.ok(MX.H14.includes('L33') && !Object.values(MX).some(ls => ls.includes('L33/L35')));
  assert.equal(Object.values(MX).reduce((a, ls) => a + ls.length, 0), 406);
  assert.equal(HOOKS_2609.reduce((a, h) => a + MX[h].length, 0) + MX.H74v2.length, 332);   // matrice du 26/09 inchangée
  assert.ok(Object.isFrozen(MX) && Object.isFrozen(MX.H12));
});
test('matrice : génériques ❌ appliqués (L15 absent après H25, L19 absent après H32 seulement)', () => {
  assert.ok(!MX.H25.includes('L15') && MX.H14.includes('L15'));
  assert.ok(!MX.H32.includes('L19') && Object.keys(MX).filter(h => h !== 'H32').every(h => MX[h].includes('L19')));
});

// ── capacité ──
test('capacité (vraies données, règles du 26-27/09) : 2 avatars × 36 hooks lipsync = 72 court, 2 × 302 paires = 604 long, 676 par mode ; + 35 avant / après publiables (7 transformations × palier 1 = 5 ; 1 560 combinaisons) = 1 387', () => {
  const c = C.capacity(library(), [], MX);
  assert.equal(c.avatars, 2); assert.equal(c.hooks, 41); assert.equal(c.lipsyncHooks, 36); assert.equal(c.liaisons, 12); assert.equal(c.demos, 12); assert.equal(c.ctas, 15); assert.equal(c.pairs, 324);
  for (const v of ['axel', 'omni']) assert.deepEqual([c.modes[v].hooks, c.modes[v].pairs, c.modes[v].short, c.modes[v].long, c.modes[v].total], [36, 302, 72, 604, 676], v);
  assert.deepEqual([c.modes.aa.combos.short, c.modes.aa.combos.long, c.modes.aa.combos.total], [156, 1404, 1560]);
  assert.equal(c.modes.aa.publiable, 35); assert.equal(c.modes.aa.total, 35); assert.equal(c.modes.aa.transfos.length, 7);
  assert.equal(c.lipsyncTotal, 1352); assert.equal(c.total, 1387); assert.equal(c.remaining, 1387);
  assert.equal(c.declinaisons.total, 1352 * 3 + 35); assert.equal(c.done, 0); assert.deepEqual(c.notInMatrix, []);
  assert.deepEqual(c.voices, ['axel', 'omni']); assert.deepEqual(c.modeKeys, ['axel', 'omni', 'aa', 'muet']); assert.equal(c.modes.muet.total, 0); assert.equal(c.avantApres, c.modes.aa);
});
test('capacité : démos et CTA ne font pas de nouvelle vidéo (+1 démo, +1 CTA → 1 387 inchangé)', () => {
  const c = C.capacity(library({ edit: r => r.push({ id: 'C-NEW', kind: 'contenu', subject: 'omni', status: 'ready', meta: {} }, { id: 'CTA-NEW', kind: 'cta', status: 'ready', meta: {} }) }), [], MX);
  assert.equal(c.total, 1387); assert.equal(c.demos, 13);
});
test('capacité : briques retirées exclues (C-CLAUDE-01, C-IMGIA-05) ; hook lipsync retiré → −2 court, −2 × ses liaisons', () => {
  const rows = library({ edit: r => { r.find(b => b.id === 'H32').status = 'retired'; } });
  const c = C.capacity(rows, [], MX);
  assert.equal(c.demos, 12);
  assert.equal(c.hooks, 40); assert.equal(c.modes.axel.short, 70); assert.equal(c.modes.axel.long, 2 * (302 - 3));
});
test('mode Audio d’Axel : un hook sans audio sort du mode Axel seulement ; une liaison sans audio retire ses paires du mode Axel', () => {
  const c = C.capacity(library({ edit: r => { delete r.find(b => b.id === 'H12').meta.media; r.find(b => b.id === 'L12').meta.media = SB + 'liaisons/L12.txt'; } }), [], MX);
  // H12 : 8 liaisons ; L12 : 6 hooks lipsync (dont H12, déjà compté), aucun hook avant / après
  assert.equal(c.modes.axel.hooks, 35); assert.equal(c.modes.axel.pairs, 302 - 8 - 5);
  assert.equal(c.modes.omni.hooks, 36); assert.equal(c.modes.omni.pairs, 302); assert.equal(c.modes.aa.total, 35);
});
test('mode Voix native Omni : hook = meta.script sinon label ; sans texte → hors mode Omni ; brique normalisée (b.audio) reconnue', () => {
  const c = C.capacity(library({ edit: r => { const h = r.find(b => b.id === 'H13'); delete h.meta.script; const k = r.find(b => b.id === 'H14'); delete k.meta.script; k.label = '  '; } }), [], MX);
  assert.equal(c.modes.omni.hooks, 35); assert.equal(c.modes.axel.hooks, 36);   // H13 garde son label, H14 n'a plus de texte
  assert.ok(C.voiceOk({ kind: 'hook', audio: SB + 'x.wav', meta: {} }, 'axel'));
  assert.equal(C.voiceText({ kind: 'hook', label: 'L', meta: { script: 'S' } }), 'S');
  assert.equal(C.voiceText({ kind: 'liaison', label: 'L', meta: { script: 'S' } }), 'L');
});
test('hook absent de la matrice : liaisons génériques seulement (subject « generique »)', () => {
  const rows = library({ edit: r => r.push({ id: 'H99', kind: 'hook', status: 'ready', label: 'x', meta: { compatible_subjects: ['omni'], script: 's', media: SB + 'h/H99.wav' } }) });
  const c = C.capacity(rows, [], MX);
  assert.deepEqual(c.notInMatrix, ['H99']);
  assert.equal(c.pairs, 324 + 5); assert.equal(c.modes.axel.long, 2 * (302 + 5));
  assert.deepEqual(C.liaisonsFor(byIdOf(rows).H99, rows.filter(b => b.kind === 'liaison'), MX).map(l => l.id), GENERIC);
});

test('sans matrice (null) : chaque hook n’a que les 5 liaisons génériques', () => {
  const c = C.capacity(library(), [], null);
  assert.equal(c.pairs, 41 * 5); assert.equal(c.notInMatrix.length, 41); assert.equal(c.matrix, false);
});

// ── vidéos déjà produites ──
test('clés déjà produites : voix|avatar|hook|liaison, voix « axel » par défaut, alias H64 → H63, doublon compté une fois', () => {
  const rows = library(), B = byIdOf(rows);
  assert.equal(C.comboKey({ avatar: 'A1', hook: 'H12', liaison: 'L16', contenu: 'C-SADS-02', cta: 'CTA-1' }, B), 'axel|A1|H12|L16');
  assert.equal(C.comboKey({ voice: 'omni', avatar: 'A2', hook: 'H64', contenu: 'C-OMNI-01' }, B), 'omni|A2|H63|');
  assert.equal(C.comboKey({ cta: 'avatar + CTA28', demo: 'visite guidée OMNI 1' }, B), null);
  assert.equal(C.videoKey('omni', 'A1', 'H12', ''), 'omni|A1|H12|');
  // règle du 26/09 : 'omni|A2|H63|' (hook avant / après en lipsync) n'est plus une vidéo possible → hors des possibles
  const done = ['axel|A1|H12|L16', 'axel|A1|H12|L16', 'omni|A2|H12|', 'axel|A1|H12|', 'axel|A1|H12|C-SADS-02'.replace('C-SADS-02', ''), 'omni|A2|H63|'];
  const c = C.capacity(rows, done, MX);
  assert.equal(c.done, 3); assert.equal(c.modes.axel.done, 2); assert.equal(c.modes.omni.done, 1); assert.equal(c.remaining, 1384); assert.equal(c.outside, 1);
});
test('clés hors des possibles non décomptées : avatar inconnu, liaison non validée (L12 après H25), voix inconnue, hook retiré', () => {
  const rows = library({ edit: r => { r.find(b => b.id === 'H32').status = 'retired'; } });
  const c = C.capacity(rows, ['axel|A3|H12|', 'axel|A1|H25|L12', 'tts|A1|H12|', 'axel|A1|H32|', 'axel|A1|H25|L28'], MX);
  assert.equal(c.done, 1); assert.equal(c.outside, 4);
});

// ── briques qui manquent ──
test('impact : +1 avatar 676 (lipsync ; l’avant / après est borné par les paliers des transformations), +1 liaison 101 (2 × 2 × 302 / 12), +1 hook 38, variété 0', () => {
  const I = C.impact(C.capacity(library(), [], MX));
  assert.deepEqual([I.avatar, I.liaison, I.hook, I.variety], [676, 101, 38, 0]);
  assert.deepEqual(I.aa, { avatar: 0, liaison: 0 });
  assert.equal(I.avgHooksPerLiaison, 27);
});

// ── choix de la démo ──
test('pickDemo : démo au sujet cité préférée (H74 → omni), tirage au hasard parmi elles ; démo retirée jamais tirée', () => {
  const rows = library(), B = byIdOf(rows), demos = rows.filter(b => b.kind === 'contenu');
  const a = C.pickDemo(B.H74, demos, seq(0)), b = C.pickDemo(B.H74, demos, seq(0.99));
  assert.equal(a.level, 'ok'); assert.equal(a.demo.id, 'C-OMNI-01'); assert.equal(b.demo.id, 'C-OMNI-04'); assert.equal(a.preferred, 4);
  for (let i = 0; i < 50; i++) assert.notEqual(C.pickDemo(B.H16, demos, Math.random).demo.status, 'retired');
});
test('pickDemo : hook générique → toute démo « ok » ; aucune démo au sujet cité (H25 montage-ia, H16 mcp-claude retirée) → revue QC avec raison', () => {
  const rows = library(), B = byIdOf(rows), demos = rows.filter(b => b.kind === 'contenu');
  assert.equal(C.pickDemo(B.H48, demos, seq(0.5)).level, 'ok');
  const r = C.pickDemo(B.H25, demos, seq(0));
  assert.equal(r.level, 'review'); assert.equal(r.preferred, 0); assert.match(r.why, /^H25 \(montage-ia\) ne cite pas le sujet de C-IMGIA-01 \(image-ia\)$/);
  assert.equal(C.pickDemo(B.H16, demos, seq(0)).level, 'review');
});

// ── déclinaison d'un top ──
test('declineTop : même voix, avatar, hook et liaison ; AUTRE démo et AUTRE CTA ; même clé vidéo', () => {
  const rows = library();
  const top = { voice: 'omni', avatar: 'A2', hook: 'H74', liaison: 'L48', contenu: 'C-OMNI-01', cta: 'CTA-1', musique: 'M03' };
  const r = C.declineTop(top, rows, { rand: seq(0), from: 'VF-0101' });
  assert.equal(r.level, 'ok');
  assert.deepEqual({ ...r.combo, contenu: undefined, cta: undefined }, { voice: 'omni', avatar: 'A2', hook: 'H74', liaison: 'L48', contenu: undefined, cta: undefined, musique: 'M03' });
  // la publication d'origine est rendue À CÔTÉ de la recette, jamais dedans (clés de brick_combo = COMBO_KEYS seulement)
  assert.equal(r.from, 'VF-0101'); assert.ok(Object.keys(r.combo).every(k => C.COMBO_KEYS.includes(k)));
  assert.equal(C.comboCheck(r.combo, byIdOf(rows), MX).reasons.some(x => /clé inconnue/.test(x)), false);
  assert.equal(r.combo.contenu, 'C-OMNI-02'); assert.equal(r.combo.cta, 'CTA-2');
  assert.equal(r.key, C.comboKey(top, byIdOf(rows)));
});
test('declineTop : une seule démo prête → impossible (raison), alias résolu (H64 → H63)', () => {
  const rows = library({ edit: r => r.forEach(b => { if (b.kind === 'contenu' && b.id !== 'C-OMNI-01') b.status = 'retired'; }) });
  const r = C.declineTop({ avatar: 'A1', hook: 'H64', contenu: 'C-OMNI-01', cta: 'CTA-1' }, rows, { rand: seq(0) });
  assert.equal(r.combo, null); assert.deepEqual(r.reasons, ['aucune autre démo prête']);
  const ok = C.declineTop({ avatar: 'A1', hook: 'H64', contenu: 'C-SADS-01', cta: 'CTA-1' }, library(), { rand: seq(0) });
  assert.equal(ok.combo.hook, 'H63'); assert.equal(ok.combo.voice, 'axel'); assert.equal(ok.level, 'review');
});

// ── contrôle QC (inchangé) + matrice ──
test('comboCheck : paire hors tags → revue ; avec la matrice, liaison non validée après ce hook → revue avec raison', () => {
  const B = byIdOf(library());
  const a = C.comboCheck({ avatar: 'A1', hook: 'H12', contenu: 'C-SADS-02', cta: 'CTA-1' }, B);
  assert.equal(a.level, 'review'); assert.match(a.reasons[0], /^cohérence à vérifier : H12 \(image-ia\) ne cite pas le sujet de C-SADS-02 \(static-ads\)$/);
  const b = C.comboCheck({ avatar: 'A1', hook: 'H12', liaison: 'L28', contenu: 'C-IMGIA-01', cta: 'CTA-1' }, B, MX);
  assert.equal(b.level, 'review'); assert.equal(b.reasons[b.reasons.length - 1], 'liaison L28 non validée après H12 (matrice hook × liaison)');
  assert.equal(C.comboCheck({ avatar: 'A1', hook: 'H12', liaison: 'L28', contenu: 'C-IMGIA-01' }, B, null).reasons.some(x => /matrice/.test(x)), false);   // sans matrice (null) : règle d'avant
  const c = C.comboCheck({ avatar: 'A1', hook: 'H12', liaison: 'L16', contenu: 'C-IMGIA-01', cta: 'CTA-1' }, B, MX);
  assert.equal(c.level, 'ok');
  const d = C.comboCheck({ avatar: 'A1', hook: 'H12', contenu: 'C-CLAUDE-01' }, B);
  assert.ok(d.reasons.includes('C-CLAUDE-01 n’est pas prête (retirée)'));
});
test('comboCheck : voix inconnue, hook sans audio (Audio d’Axel) ou sans texte (Omni), clé inconnue → revue avec raison', () => {
  const rows = library({ edit: r => { delete r.find(b => b.id === 'H14').meta.media; const k = r.find(b => b.id === 'H13'); delete k.meta.script; k.label = ''; } }), B = byIdOf(rows);
  const base = { avatar: 'A1', hook: 'H12', contenu: 'C-IMGIA-01', cta: 'CTA-1' };
  assert.equal(C.comboCheck(base, B, MX).level, 'ok');
  const a = C.comboCheck({ ...base, voice: 'tts' }, B, MX);
  assert.equal(a.level, 'review'); assert.ok(a.reasons.includes('voix « tts » inconnue (axel ou omni)'));
  assert.equal(C.comboCheck({ ...base, voice: 'Omni' }, B, MX).level, 'review');
  const b = C.comboCheck({ ...base, hook: 'H14' }, B, MX);
  assert.ok(b.reasons.includes('hook H14 sans fichier audio (Audio d’Axel)'));
  assert.deepEqual(C.comboCheck({ ...base, hook: 'H14', voice: 'omni' }, B, MX).reasons, ['hook H14 : incrustation d’une image d’avatar fille obligatoire, à vérifier']);   // 26/09 : H14 toujours en revue (incrustation)
  assert.ok(C.comboCheck({ ...base, hook: 'H13', voice: 'omni' }, B, MX).reasons.includes('hook H13 sans texte à dire (Voix native Omni)'));
  const c = C.comboCheck({ ...base, declined_from: '17800000000000001' }, B, MX);
  assert.equal(c.level, 'review'); assert.match(c.reasons[0], /^clé inconnue dans la recette : declined_from/);
});
test('comboCheck : liaison hors du module de la démo (paire ok) ≠ paire à revoir', () => {
  const rows = library({ edit: r => { r.find(b => b.id === 'L33').meta.modules = ['montage-ia', 'mcp-claude']; } }), B = byIdOf(rows);
  assert.ok(C.comboCheck({ avatar: 'A1', hook: 'H14', liaison: 'L33', contenu: 'C-IMGIA-01' }, B, MX).reasons.includes('liaison L33 hors du module de la démo C-IMGIA-01 (image-ia)'));
  assert.ok(C.comboCheck({ avatar: 'A1', hook: 'H14', liaison: 'L33', contenu: 'C-OMNI-01' }, B, MX).reasons.includes('liaison L33 non générique sur une paire à revoir'));
});
test('capacité : clés venues de la base jamais lues sur le prototype (« __proto__ », « constructor ») ; voix inconnue hors des possibles', () => {
  const c = C.capacity(library(), ['__proto__|A1|toString|name', 'axel|A1|constructor|name', 'axel|toString|H12|', 'Omni|A1|H12|'], MX);
  assert.equal(c.done, 0); assert.equal(c.outside, 4); assert.equal(({}).done, undefined); assert.equal(Object.prototype.done, undefined);
  assert.equal(C.comboKey({ avatar: 'A1', hook: 'constructor' }, {}), 'axel|A1|constructor|');
});
test('pickDemo (format long) : préfère une démo que la liaison accepte (module), sinon revue QC avec la raison de la liaison', () => {
  const rows = library({ edit: r => { r.find(b => b.id === 'L12').meta.modules = ['omni']; } }), B = byIdOf(rows), demos = rows.filter(b => b.kind === 'contenu');
  assert.equal(C.pickDemo(B.H20, demos, seq(0)).demo.id, 'C-IMGIA-01');   // sans liaison : toutes les démos (hook générique)
  const a = C.pickDemo(B.H20, demos, seq(0), [], B.L12);
  assert.equal(a.demo.id, 'C-OMNI-01'); assert.equal(a.level, 'ok'); assert.equal(a.preferred, 4);
  const b = C.pickDemo(B.H12, demos, seq(0), [], B.L12);   // H12 image-ia : aucune démo image-ia n'est dans le module de L12
  assert.equal(b.level, 'review'); assert.equal(b.demo.id, 'C-IMGIA-01'); assert.equal(b.why, 'liaison L12 hors du module de la démo C-IMGIA-01 (image-ia)');
  assert.equal(C.pickDemo(B.H12, demos, seq(0), [], B.L16).level, 'ok');   // liaison générique
});

// ── hooks avant / après, assemblages, capacité avant / après (règle d'Axel du 26/09) ──
const IDS18 = ['HK-M1-0a', 'HK-M1-a0', 'HK-M2-0a', 'HK-M2-a0', 'HK-M4-0a', 'HK-M4-a0', 'HK-O1-0a', 'HK-O1-a0',
  'HK-O2-0a', 'HK-O2-0b', 'HK-O2-a0', 'HK-O2-ab', 'HK-O2-b0', 'HK-O2-ba', 'HK-O2-0ab', 'HK-O2-0ba', 'HK-O3-0a', 'HK-O3-a0'];
const groupOf = (rows, id) => byIdOf(rows)[id].meta.group;
test('avant / après : H19, H53, H57, H63, H74 (H64 alias) sortent des 2 modes lipsync ; lipsync:false OU hook_mode suffit ; H14/H23/H60 comptés et signalés (incrustation)', () => {
  const c = C.capacity(library(), [], MX);
  assert.deepEqual(c.aaHooks, ['H19', 'H53', 'H57', 'H63', 'H74']);
  const onlyMode = C.capacity(library({ edit: r => { delete r.find(b => b.id === 'H19').meta.lipsync; r.find(b => b.id === 'H74').meta.hook_mode = null; } }), [], MX);
  assert.deepEqual(onlyMode.aaHooks, ['H19', 'H53', 'H57', 'H63', 'H74']);
  const back = C.capacity(library({ edit: r => { const h = r.find(b => b.id === 'H57'); h.meta.lipsync = true; delete h.meta.hook_mode; } }), [], MX);
  assert.equal(back.modes.axel.hooks, 37); assert.equal(back.modes.axel.pairs, 302 + 3);   // H57 redevenu lipsync : +1 hook, +3 paires
  assert.deepEqual(c.overlayRequired, { count: 3, hooks: ['H14', 'H23', 'H60'], kinds: { fille: 3 }, videos: { axel: 62, omni: 62 } });   // 2 × (3 + 8 + 9 + 11)
  assert.ok(C.isAvantApres({ meta: { lipsync: false } }) && C.isAvantApres({ meta: { hook_mode: 'avant-apres' } }) && !C.isAvantApres({ meta: { lipsync: true } }));
});
test('blocs (27/09) : un bloc = une version en plein écran + l’original ou une autre version en médaillon (jamais l’original en plein écran) ; hook visuel = 1 à 3 blocs d’originaux différents du même module → 63 (Omni 48, Motion Control 15)', () => {
  const rows = library(), A = C.assemblies(rows);
  assert.equal(A.length, 63);
  const per = {}; A.forEach(a => { per[a.module] = (per[a.module] || 0) + 1; }); assert.deepEqual(per, { 'motion-control': 15, omni: 48 });
  assert.deepEqual(A.filter(a => a.blocks.length === 1).map(a => a.id).sort(), ['HK-M1-0a', 'HK-M2-0a', 'HK-M4-0a', 'HK-O1-0a', 'HK-O2-0a', 'HK-O2-0b', 'HK-O2-ab', 'HK-O2-ba', 'HK-O3-0a']);
  for (const a of A) for (let i = 1; i < a.clips.length; i += 2) assert.equal(a.clips[i].clip, 'after', a.id + ' : l’original jamais en plein écran');
  // 1 bloc : IDs du 26/09 inchangés (2 clips)
  const x = A.find(a => a.id === 'HK-O2-0b');
  assert.deepEqual(x.components, [{ slot: 'A', brick_id: 'TX-O02b', clip: 'before' }, { slot: 'B', brick_id: 'TX-O02b', clip: 'after' }]);
  assert.ok(!A.some(a => a.id === 'HK-O2-b0' || a.id === 'HK-O1-a0'), 'jamais l’original en plein écran');
  assert.equal(A.find(a => a.id === 'HK-O2-ab').label, 'Porsche 911 GT3 → Bugatti Chiron');
  assert.equal(A.find(a => a.id === 'HK-M2-0a').label, 'original homme → personnage femme (Spider-Man)');
  // plusieurs blocs : Clio → Bugatti puis bracelet → Patek
  const y = A.find(a => a.id === 'HK-O2-0b+O3-0a');
  assert.ok(y); assert.deepEqual(y.blocks, ['O2-0b', 'O3-0a']); assert.equal(y.components.length, 4);
  assert.equal(y.label, 'Renault Clio → Bugatti Chiron · puis · Bracelet fitness → Patek Philippe Nautilus');
  for (const a of A) {
    const gs = a.blocks.map(b => b.split('-')[0]);
    assert.equal(new Set(gs).size, gs.length, a.id + ' : deux blocs du même original');
    assert.ok(a.blocks.length >= 1 && a.blocks.length <= 3, a.id);
    const mods = new Set(a.components.map(c => rows.find(r => r.id === c.brick_id).subject)); assert.equal(mods.size, 1, a.id + ' : modules mélangés');
    for (let i = 0; i < a.components.length; i += 2) {
      assert.equal(groupOf(rows, a.components[i].brick_id), groupOf(rows, a.components[i + 1].brick_id), a.id + ' : bloc mélangé');
      assert.notEqual(a.clips[i].key, a.clips[i + 1].key, a.id);
    }
  }
  assert.ok(!A.some(a => a.id === 'HK-O2-0ab'), 'plus de suite de 3 clips d’un même original');
  assert.ok(C.assemblyCheck({ components: A.find(a => a.id === 'HK-O2-0b+O3-0a').components }, rows).valid);
  assert.equal(C.assemblyCheck({ components: A[A.length - 1].components }, rows).id, A[A.length - 1].id);
  assert.deepEqual(C.assemblies(library()).map(a => a.id), A.map(a => a.id));   // fonction pure
  const noB = C.assemblies(library({ edit: r => { r.find(b => b.id === 'TX-O02b').status = 'retired'; } }));
  assert.equal(noB.length, 30);
});
test('assemblyCheck (blocs) : anciennes recettes du 18/09 et suites de 3 clips d’un même original invalides ; cas invalides expliqués', () => {
  const rows = library();
  for (const [id, tx] of Object.entries(OLD_HK)) {
    const r = C.assemblyCheck({ id, components: tx.map((b, i) => ({ slot: 'AB'[i], brick_id: b })) }, rows);
    assert.equal(r.valid, false, id); assert.equal(r.legacy, true);
  }
  const bad = comps => C.assemblyCheck({ components: comps.map(([b, c], i) => ({ slot: 'ABCDEFG'[i], brick_id: b, clip: c })) }, rows).reasons;
  assert.deepEqual(bad([['TX-O03', 'after'], ['TX-O01', 'after']]), ['bloc 1 : mélange O3 et O1 (un bloc = un seul original filmé)']);
  assert.deepEqual(bad([['TX-O01', 'after'], ['TX-O01', 'before']]), ['bloc 1 : l’original n’est jamais en plein écran (toujours en médaillon)']);
  assert.deepEqual(bad([['TX-O02a', 'before'], ['TX-O02b', 'before']]), ['bloc 1 : même clip deux fois']);
  assert.deepEqual(bad([['TX-O02a', 'before'], ['TX-O02a', 'after'], ['TX-O02b', 'after']]), ['un bloc = 2 clips (avant → après d’un même original)']);
  assert.deepEqual(bad([['TX-O02a', 'before'], ['TX-O02a', 'after'], ['TX-O02a', 'after'], ['TX-O02b', 'after']]), ['deux blocs du même original (O2)']);
  assert.deepEqual(bad([['TX-O01', 'before'], ['TX-O01', 'after'], ['TX-M01', 'before'], ['TX-M01', 'after']]), ['mélange les modules omni et motion-control (Omni avec Omni, Motion Control avec Motion Control)']);
  assert.deepEqual(bad([['TX-O02a', 'avant'], ['TX-O02a', 'after']]), ['clip « avant » inconnu pour TX-O02a (before ou after)']);
});
test('paliers (27/09) : par TRANSFORMATION (plein écran ou médaillon) : 5 vidéos ; > 2 500 vues → 10 ; > 10 000 → 15 ; publiables = Σ plafonds', () => {
  const rows = library();
  assert.deepEqual([C.palierOf(0).max, C.palierOf(2500).max, C.palierOf(2501).max, C.palierOf(10000).max, C.palierOf(10001).max, C.palierOf(1e6).max], [5, 5, 10, 10, 15, 15]);
  assert.deepEqual(C.transfosOf('HK-O2-0b', rows), ['TX-O02b']);                     // la Clio (original) ne compte pas
  assert.deepEqual(C.transfosOf('HK-O2-ab+O1-0a', rows), ['TX-O02a', 'TX-O02b', 'TX-O01']);   // la Porsche en médaillon compte
  const five = [{ assemblage: 'HK-O2-0b' }, { assemblage: 'HK-O2-ab' }, { assemblage: 'HK-O2-ba' }, { assemblage: 'HK-O2-0b+O1-0a' }, { assemblage: 'HK-O3-0a+O2-0b' }];
  const r = C.palierCheck({ assemblage: 'HK-O2-ab' }, five, {}, rows);   // la Bugatti est déjà dans 5 vidéos
  assert.equal(r.ok, false); assert.deepEqual(r.reasons, ['transformation TX-O02b déjà dans 5 vidéos (palier 1 : 5 max)']);
  assert.equal(C.palierCheck({ assemblage: 'HK-O2-0a' }, five, {}, rows).ok, true);   // la Porsche : 2 vidéos
  assert.equal(C.palierCheck({ assemblage: 'HK-O2-ab' }, five, { 'TX-O02b': 3000 }, rows).ok, true);
  assert.equal(C.palierCheck({ voice: 'axel', avatar: 'A1', hook: 'H12' }, five, {}, rows).ok, true);   // hors avant / après : pas de palier
  const c2 = C.capacity(rows, [], MX, { vues: { 'TX-O02b': 3000, 'TX-O01': 20000 } });
  assert.equal(c2.modes.aa.publiable, 5 * 5 + 10 + 15);
});
test('capacité avant / après (blocs) : par module, court = hooks visuels × hooks avant / après ayant un audio ; long = hooks visuels × liaisons compatibles × avatars', () => {
  const c = C.capacity(library(), [], MX), g = {};
  c.modes.aa.groups.forEach(x => { g[x.module] = [x.assemblies, x.hooks.join(','), x.short, x.long]; });
  assert.deepEqual(g, { 'motion-control': [15, 'H19,H53,H57,H63', 60, 540], omni: [48, 'H19,H74', 96, 864] });
  // motion-control : 15 × (5 + 4 + 3 + 6) liaisons × 2 avatars = 540 ; omni : 48 × (5 + 4) × 2 = 864
  assert.deepEqual([c.modes.aa.hooks, c.modes.aa.assemblies, c.modes.aa.short, c.modes.aa.long], [5, 63, 156, 1404]);
  const noAudio = C.capacity(library({ edit: r => { delete r.find(b => b.id === 'H74').meta.media; } }), [], MX);
  assert.deepEqual([noAudio.modes.aa.short, noAudio.modes.aa.long], [108, 1020]);
  const one = C.capacity(library({ edit: r => { r.find(b => b.id === 'A2').status = 'retired'; } }), [], MX);
  assert.deepEqual([one.modes.aa.short, one.modes.aa.long], [156, 702]);   // le court avant / après n'a pas d'avatar
});
test('clés avant / après : aa|avatar|hook|liaison|assemblage (avatar vide en court) ; anciennes clés inchangées ; hors des possibles non décomptées', () => {
  const rows = library(), B = byIdOf(rows);
  assert.equal(C.videoKey('axel', 'A1', 'H12', 'L16'), 'axel|A1|H12|L16');
  assert.equal(C.videoKey('aa', 'A1', 'H74', '', 'HK-O2-0b+O3-0a'), 'aa||H74||HK-O2-0b+O3-0a');
  assert.equal(C.videoKey('axel', 'A1', 'H74', 'L16', 'HK-O2-0b+O3-0a'), 'aa|A1|H74|L16|HK-O2-0b+O3-0a');
  assert.equal(C.comboKey({ voice: 'axel', avatar: 'A2', hook: 'H74', assemblage: 'HK-O2-0b+O3-0a', contenu: 'C-OMNI-01', cta: 'CTA-1' }, B), 'aa||H74||HK-O2-0b+O3-0a');
  assert.equal(C.comboKey({ hook: 'H64', liaison: 'L16', avatar: 'A1', assemblage: 'HK-M1-0a' }, B), 'aa|A1|H63|L16|HK-M1-0a');
  assert.equal(C.comboKey({ hook: 'H74', assemblage: 'HK-O1-0a' }, B), 'aa||H74||HK-O1-0a');   // court : avatar facultatif
  assert.equal(C.comboKey({ voice: 'omni', hook: 'H74', assemblage: 'HK-O1-0a' }, B), 'omni||H74||HK-O1-0a');
  assert.equal(C.comboKey({ avatar: 'A1', hook: 'H12' }, B), 'axel|A1|H12|'); assert.equal(C.comboKey({ hook: 'H12' }, B), null);
  const ok = ['aa||H74||HK-O2-0b+O3-0a', 'aa||H74||HK-O2-0b+O3-0a', 'aa|A1|H74|L16|HK-O2-0b+O3-0a', 'aa|A2|H63|L48|HK-M4-0a', 'axel|A1|H12|'];
  const out = ['aa||H53||HK-O2-0b+O3-0a', 'aa|A1|H74||HK-O2-0b+O3-0a', 'aa||H74|L16|HK-O2-0b+O3-0a', 'aa|A1|H74|L12|HK-O2-0b+O3-0a', 'aa||H74||HK-O01-02a', 'omni||H74||HK-O1-0a', 'aa||H12||HK-O1-0a', 'aa|A3|H74|L16|HK-O1-0a'];
  const c = C.capacity(rows, ok.concat(out), MX);
  assert.equal(c.modes.aa.done, 3); assert.equal(c.modes.axel.done, 1); assert.equal(c.done, 4); assert.equal(c.outside, out.length); assert.equal(c.remaining, 1387 - 4);
  assert.equal(c.modes.aa.remaining, 35 - 3);
});
test('comboCheck incrustation : H14 / H23 / H60 en lipsync → toujours revue (image d’avatar fille à incruster) ; autres hooks inchangés', () => {
  const rows = library(), B = byIdOf(rows);
  ['H14', 'H23', 'H60'].forEach(h => {
    assert.equal(C.overlayRequired(B[h]), 'fille', h);
    ['axel', 'omni'].forEach(v => {
      const r = C.comboCheck({ voice: v, avatar: 'A1', hook: h, contenu: 'C-IMGIA-01', cta: 'CTA-1' }, B, MX);
      assert.equal(r.level, 'review', h + ' ' + v);
      assert.ok(r.reasons.includes('hook ' + h + ' : incrustation d’une image d’avatar fille obligatoire, à vérifier'), h + ' ' + v + ' ' + r.reasons.join(' ; '));
    });
  });
  assert.equal(C.comboCheck({ voice: 'axel', avatar: 'A1', hook: 'H12', contenu: 'C-IMGIA-01', cta: 'CTA-1' }, B, MX).reasons.some(x => /incrustation/.test(x)), false);
});
test('comboCheck avant / après : hook avant / après sans assemblage → revue ; assemblage inconnu, hook lipsync, mauvais module, Voix native Omni → revue ; recette valide → ok', () => {
  const rows = library(), B = byIdOf(rows), base = { voice: 'axel', avatar: 'A1', hook: 'H74', contenu: 'C-OMNI-01', cta: 'CTA-1' };
  assert.ok(C.COMBO_KEYS.includes('assemblage'));
  assert.deepEqual(C.comboCheck({ ...base, assemblage: 'HK-O2-0b+O3-0a' }, B, MX).reasons, []);
  assert.deepEqual(C.comboCheck({ ...base, assemblage: 'HK-O2-0b+O3-0a', liaison: 'L16' }, B, MX).reasons, []);
  assert.ok(C.comboCheck(base, B, MX).reasons.includes('hook H74 avant / après : jamais en lipsync (voix off sur un assemblage HK)'));
  assert.ok(C.comboCheck({ ...base, assemblage: 'HK-O01-02a' }, B, MX).reasons.includes('assemblage HK-O01-02a inconnu (suite de clips d’un seul groupe de transformations)'));
  assert.ok(C.comboCheck({ ...base, hook: 'H12', contenu: 'C-IMGIA-01', assemblage: 'HK-O2-0a' }, B, MX).reasons.includes('hook H12 lipsync sur un assemblage avant / après (hooks avant / après seulement)'));
  assert.ok(C.comboCheck({ ...base, hook: 'H53', contenu: 'C-OMNI-01', assemblage: 'HK-O2-0a' }, B, MX).reasons.includes('hook H53 hors du module de HK-O2-0a (omni)'));
  assert.ok(C.comboCheck({ ...base, voice: 'omni', assemblage: 'HK-O2-0a' }, B, MX).reasons.includes('pas de Voix native Omni sur un hook avant / après (voix off d’Axel)'));
  const d = C.declineTop({ ...base, assemblage: 'HK-O2-0b+O3-0a' }, rows, { rand: seq(0) });
  assert.equal(d.combo.assemblage, 'HK-O2-0b+O3-0a'); assert.equal(d.key, 'aa||H74||HK-O2-0b+O3-0a');
});

test('déclinaisons : 3 versions au plus par vidéo de base, chacune avec une autre démo, musique, sous-titres et format', () => {
  const B = byIdOf(library());
  const v = (c, m, s, f) => ({ voice: 'axel', avatar: 'A1', hook: 'H12', contenu: c, musique: m, sous_titre: s, format: f, cta: 'CTA-1' });
  const ex = [v('C-IMGIA-01', 'M01', 'S01', 'F01'), v('C-IMGIA-02', 'M02', 'S02', 'F02')];
  assert.equal(C.DECLINAISONS_MAX, 3);
  const ok = C.declinaisonCheck(v('C-IMGIA-03', 'M03', 'S03', 'F03'), ex, B);
  assert.equal(ok.ok, true); assert.equal(ok.n, 2);
  assert.equal(C.declinaisonCheck(v('C-IMGIA-01', 'M03', 'S03', 'F03'), ex, B).ok, false);   // même démo
  assert.equal(C.declinaisonCheck(v('C-IMGIA-03', 'M03', 'S01', 'F03'), ex, B).ok, false);   // mêmes sous-titres
  const full = ex.concat([v('C-IMGIA-03', 'M03', 'S03', 'F03')]);
  assert.ok(C.declinaisonCheck(v('C-IMGIA-04', 'M04', 'S04', 'F04'), full, B).reasons.some(r => /plafond 3/.test(r)));
  assert.equal(C.declinaisonCheck({ ...v('C-IMGIA-01', 'M01', 'S01', 'F01'), avatar: 'A2' }, full, B).ok, true);   // autre base
});

test('photos par avatar : 3 photos différentes par avatar et par brique parlée → ×3 vidéos ; photos distinctes rangées #1..#3, 4e hors des possibles', () => {
  const rows = library(); C.setPhotosPerAvatar(3);
  try {
    const c = C.capacity(rows, [], MX);
    assert.equal(c.photosPerAvatar, 3); assert.equal(c.avatarSlots, c.avatars * 3);
    assert.equal(c.modes.axel.short, 3 * 72); assert.equal(c.modes.axel.long, 3 * 604);
    const B = byIdOf(rows), k = (ph) => C.comboKey({ voice: 'axel', avatar: 'A1', photo: ph, hook: 'H12', contenu: 'C-IMGIA-01', cta: 'CTA-1' }, B);
    assert.equal(k('A1-7'), 'axel|A1-7|H12|');
    assert.deepEqual(C.slotKeys([k('A1-7'), k('A1-2'), k('A1-7'), k('A1-1'), k('A1-4')]), ['axel|A1#1|H12|', 'axel|A1#2|H12|', 'axel|A1#1|H12|', 'axel|A1#3|H12|', null]);
    const d = C.capacity(rows, [k('A1-7'), k('A1-2'), k('A1-1'), k('A1-4')], MX);
    assert.equal(d.modes.axel.done, 3); assert.equal(d.outside, 1);
  } finally { C.setPhotosPerAvatar(1); }
});

test('Texte + musique réel (Axel 07/10) : 5 démos au plus par réaction — capacité réactions × min(5, démos), 6e démo refusée', () => {
  const rows = [{ id: 'R-F1', kind: 'reaction', status: 'ready', meta: {} }, { id: 'R-H3', kind: 'reaction', status: 'ready', meta: {} },
    ...Array.from({ length: 7 }, (_, i) => ({ id: 'C-OMNIM-0' + (i + 1), kind: 'contenu', status: 'ready', subject: 'omni', meta: { voice: false } }))];
  assert.equal(C.REACTION_DEMOS_MAX, 5);
  assert.equal(C.capacity(rows, [], MX).modes.muet.total, 2 * 5);   // 2 réactions × min(5, 7 démos)
  const ex = [1, 2, 3, 4, 5].map(i => ({ voice: 'muet', hook: 'TH01', reaction: 'R-F1', contenu: 'C-OMNIM-0' + i }));
  assert.equal(C.reactionCheck('R-F1', 'C-OMNIM-03', ex), '');                         // démo déjà montée avec R-F1 : ok
  assert.match(C.reactionCheck('R-F1', 'C-OMNIM-06', ex), /5 au plus par réaction/);   // 6e démo : refus
  assert.equal(C.reactionCheck('R-H3', 'C-OMNIM-06', ex), '');                         // autre réaction : libre
  const keys = ex.concat([{ voice: 'muet', hook: 'TH01', reaction: 'R-F1', contenu: 'C-OMNIM-06' }]).map(x => C.comboKey(x, {}));
  assert.equal(C.capacity(rows, keys, MX).modes.muet.done, 5);                        // la 6e ne compte pas dans la capacité
});
test('Texte + musique : texte choc (TH) × emplacements photo, format court seulement ; clé muet|A1#n|TH|; hook parlé refusé ; liaison refusée', () => {
  const th = (id, sub) => ({ id, kind: 'texte-choc', subject: sub, label: 'phrase ' + id, status: 'ready', meta: { text: 'phrase', compatible_subjects: [sub] } });
  const rows = library().concat([th('TH01', 'generique'), th('TH13', 'omni')]), B = byIdOf(rows);
  C.setPhotosPerAvatar(3);
  try {
    const c = C.capacity(rows, [], MX);
    assert.equal(c.modes.muet.short, 2 * 3 * 2); assert.equal(c.modes.muet.long, 0);
    const k = C.comboKey({ voice: 'muet', avatar: 'A1', photo: 'A1-4', hook: 'TH01', contenu: 'C-IMGIA-01' }, B);
    assert.equal(k, 'muet|A1-4|TH01|');
    assert.equal(C.capacity(rows, [k], MX).modes.muet.done, 1);
  } finally { C.setPhotosPerAvatar(1); }
  assert.deepEqual(C.comboCheck({ voice: 'muet', avatar: 'A1', hook: 'TH01', contenu: 'C-IMGIA-01' }, B, MX).reasons, []);
  assert.ok(C.comboCheck({ voice: 'muet', avatar: 'A1', hook: 'H12', contenu: 'C-IMGIA-01' }, B, MX).reasons.some(r => /texte choc/.test(r)));
  assert.ok(C.comboCheck({ voice: 'muet', avatar: 'A1', hook: 'TH01', liaison: 'L16', contenu: 'C-IMGIA-01' }, B, MX).reasons.some(r => /pas de liaison/.test(r)));
  assert.ok(C.comboCheck({ voice: 'axel', avatar: 'A1', hook: 'TH01', contenu: 'C-IMGIA-01' }, B, MX).reasons.some(r => /Texte \+ musique seulement/.test(r)));
});

test('voix autorisées (Axel 28/09) : meta.voices = [omni] → jamais en lipsync (axel), toujours en voix native ; sans voices = inchangé', () => {
  const h = { id: 'HV', kind: 'hook', status: 'ready', label: 'Texte du hook', meta: { media: 'https://x.test/hooks/HV.wav', script: 'Texte du hook', voices: ['omni'] } };
  assert.equal(C.voiceOk(h, 'axel'), false);
  assert.equal(C.voiceOk(h, 'omni'), true);
  assert.deepEqual(C.voicesAllowed(h), ['omni']);
  const h2 = { ...h, meta: { media: h.meta.media, script: h.meta.script } };
  assert.equal(C.voiceOk(h2, 'axel'), true);
  assert.equal(C.voicesAllowed(h2), null);
});

test('hook aux deux modes (Axel 28/09 : H63) : avant / après + lipsync explicite → dans les deux listes, lipsync et assemblage acceptés', () => {
  const lib = C.library([
    { id: 'A1', kind: 'avatar', status: 'ready', meta: {} },
    { id: 'HD', kind: 'hook', status: 'ready', label: 'Texte', meta: { media: 'https://x.test/hooks/HD.wav', script: 'Texte', hook_mode: 'avant-apres', lipsync: true } },
    { id: 'HA', kind: 'hook', status: 'ready', label: 'Texte', meta: { media: 'https://x.test/hooks/HA.wav', script: 'Texte', hook_mode: 'avant-apres' } },
  ]);
  assert.deepEqual(lib.lipsyncHooks.map(h => h.id), ['HD']);
  assert.deepEqual(lib.aaHooks.map(h => h.id).sort(), ['HA', 'HD']);
  assert.ok(C.isLipsyncHook({ meta: { hook_mode: 'avant-apres', lipsync: true } }) && !C.isLipsyncHook({ meta: { hook_mode: 'avant-apres' } }) && !C.isLipsyncHook({ meta: { lipsync: false } }) && C.isLipsyncHook({ meta: {} }));
});

test('démo MCP (Axel 02/10) : meta.features filtre les hooks qui citent un module (H76 pubs produit → démo avec static-ads)', () => {
  const H76 = { id: 'H76', meta: { compatible_subjects: ['mcp-claude', 'static-ads'] } }, H24 = { id: 'H24', meta: { compatible_subjects: ['mcp-claude'] } };
  const exp = { id: 'C-MCP-01', subject: 'mcp-claude', meta: { features: ['express', 'image-ia'] } };
  const sta = { id: 'C-MCP-04', subject: 'mcp-claude', meta: { features: ['static-ads'] } };
  assert.equal(C.pairLevel(H76, exp), 'review');
  assert.equal(C.pairLevel(H76, sta), 'ok');
  assert.equal(C.pairLevel(H24, exp), 'ok');
  assert.equal(C.pairLevel({ id: 'X', meta: { compatible_subjects: ['image-ia'] } }, { id: 'C-IMGIA-02', subject: 'image-ia', meta: {} }), 'ok');
});

const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(results.join('\n'));
console.log(fails + ' échec(s) sur ' + results.length);
process.exitCode = fails ? 1 : 0;
