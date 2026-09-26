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
function library(o) {
  o = o || {};
  const rows = [
    { id: 'A1', kind: 'avatar', subject: 'generique', status: 'ready', meta: {} },
    { id: 'A2', kind: 'avatar', subject: 'generique', status: 'ready', meta: {} }];
  Object.keys(MX).filter(h => h !== 'H74v2').forEach(h => rows.push({ id: h, kind: 'hook', subject: (SUBJ[h] || ['image-ia'])[0], status: 'ready', label: 'Accroche ' + h,
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
test('matrice : 43 hooks (H74v2 tel quel), « L33/L35 » = L33, 332 paires dont 324 pour les hooks en base', () => {
  assert.equal(Object.keys(MX).length, 43);
  assert.ok(Array.isArray(MX.H74v2));
  assert.deepEqual([...MX.H32], ['L16', 'L32', 'L34']);
  assert.ok(MX.H14.includes('L33') && !Object.values(MX).some(ls => ls.includes('L33/L35')));
  assert.equal(Object.values(MX).reduce((a, ls) => a + ls.length, 0), 332);
  assert.ok(Object.isFrozen(MX) && Object.isFrozen(MX.H12));
});
test('matrice : génériques ❌ appliqués (L15 absent après H25, L19 absent après H32 seulement)', () => {
  assert.ok(!MX.H25.includes('L15') && MX.H14.includes('L15'));
  assert.ok(!MX.H32.includes('L19') && Object.keys(MX).filter(h => h !== 'H32').every(h => MX[h].includes('L19')));
});

// ── capacité ──
test('capacité (vraies données, règle du 26/09) : 2 avatars × 36 hooks lipsync = 72 court, 2 × 302 paires = 604 long, 676 par mode ; + 480 avant / après = 1 832', () => {
  const c = C.capacity(library(), [], MX);
  assert.equal(c.avatars, 2); assert.equal(c.hooks, 41); assert.equal(c.lipsyncHooks, 36); assert.equal(c.liaisons, 12); assert.equal(c.demos, 12); assert.equal(c.ctas, 15); assert.equal(c.pairs, 324);
  for (const v of ['axel', 'omni']) assert.deepEqual([c.modes[v].hooks, c.modes[v].pairs, c.modes[v].short, c.modes[v].long, c.modes[v].total], [36, 302, 72, 604, 676], v);
  assert.deepEqual([c.modes.aa.short, c.modes.aa.long, c.modes.aa.total], [48, 432, 480]);
  assert.equal(c.lipsyncTotal, 1352); assert.equal(c.total, 1832); assert.equal(c.remaining, 1832); assert.equal(c.done, 0); assert.deepEqual(c.notInMatrix, []);
  assert.deepEqual(c.voices, ['axel', 'omni']); assert.deepEqual(c.modeKeys, ['axel', 'omni', 'aa']); assert.equal(c.avantApres, c.modes.aa);
});
test('capacité : démos et CTA ne font pas de nouvelle vidéo (+1 démo, +1 CTA → 1 832 inchangé)', () => {
  const c = C.capacity(library({ edit: r => r.push({ id: 'C-NEW', kind: 'contenu', subject: 'omni', status: 'ready', meta: {} }, { id: 'CTA-NEW', kind: 'cta', status: 'ready', meta: {} }) }), [], MX);
  assert.equal(c.total, 1832); assert.equal(c.demos, 13);
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
  assert.equal(c.modes.omni.hooks, 36); assert.equal(c.modes.omni.pairs, 302); assert.equal(c.modes.aa.total, 480);
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
  assert.equal(c.done, 3); assert.equal(c.modes.axel.done, 2); assert.equal(c.modes.omni.done, 1); assert.equal(c.remaining, 1829); assert.equal(c.outside, 1);
});
test('clés hors des possibles non décomptées : avatar inconnu, liaison non validée (L12 après H25), voix inconnue, hook retiré', () => {
  const rows = library({ edit: r => { r.find(b => b.id === 'H32').status = 'retired'; } });
  const c = C.capacity(rows, ['axel|A3|H12|', 'axel|A1|H25|L12', 'tts|A1|H12|', 'axel|A1|H32|', 'axel|A1|H25|L28'], MX);
  assert.equal(c.done, 1); assert.equal(c.outside, 4);
});

// ── briques qui manquent ──
test('impact : +1 avatar 892 (676 lipsync + 216 longs avant / après), +1 liaison 137 (2 × 2 × 302 / 12 + 432 / 12), +1 hook 38 (2 × (1 + 302 / 36) × 2), variété 0', () => {
  const I = C.impact(C.capacity(library(), [], MX));
  assert.deepEqual([I.avatar, I.liaison, I.hook, I.variety], [892, 137, 38, 0]);
  assert.deepEqual(I.aa, { avatar: 216, liaison: 36 });
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
test('assemblages : 18 exactement (M1, M2, M4, O1, O3 → 2 chacun ; O2 → 8), IDs stables, composants [{slot, brick_id, clip}], libellés', () => {
  const rows = library(), A = C.assemblies(rows);
  assert.deepEqual(A.map(a => a.id), IDS18);
  const per = {}; A.forEach(a => { per[a.group] = (per[a.group] || 0) + 1; });
  assert.deepEqual(per, { M1: 2, M2: 2, M4: 2, O1: 2, O2: 8, O3: 2 });
  const x = A.find(a => a.id === 'HK-O2-0ab');
  assert.deepEqual(x.components, [{ slot: 'A', brick_id: 'TX-O02a', clip: 'before' }, { slot: 'B', brick_id: 'TX-O02a', clip: 'after' }, { slot: 'C', brick_id: 'TX-O02b', clip: 'after' }]);
  assert.equal(x.label, 'Renault Clio → Porsche 911 GT3 → Bugatti Chiron'); assert.equal(x.module, 'omni'); assert.equal(x.code, '0ab');
  assert.equal(A.find(a => a.id === 'HK-O2-ba').label, 'Bugatti Chiron → Porsche 911 GT3');
  assert.equal(A.find(a => a.id === 'HK-O1-a0').label, 'Lamborghini Urus → Audi A3');
  assert.equal(A.find(a => a.id === 'HK-M2-0a').label, 'original homme → personnage femme (Spider-Man)');
  assert.deepEqual(A.find(a => a.id === 'HK-O2-b0').components, [{ slot: 'A', brick_id: 'TX-O02b', clip: 'after' }, { slot: 'B', brick_id: 'TX-O02b', clip: 'before' }]);
  assert.deepEqual(A.find(a => a.id === 'HK-O2-0ab').clips.map(c => c.media.replace(MEDIA, '')), ['TX-O02-avant.mp4', 'TX-O02a-apres.mp4', 'TX-O02b-apres.mp4']);
  assert.deepEqual(C.assemblies(library()).map(a => a.id), IDS18);   // fonction pure : même entrée, même sortie
});
test('assemblages : jamais deux groupes mélangés, clips distincts, 3 clips seulement depuis l’original ; transformation retirée → ses suites disparaissent', () => {
  const rows = library(), A = C.assemblies(rows);
  for (const a of A) {
    assert.equal(new Set(a.components.map(c => groupOf(rows, c.brick_id))).size, 1, a.id);
    const keys = a.clips.map(c => c.key); assert.equal(new Set(keys).size, keys.length, a.id);
    assert.ok(a.components.length === 2 || (a.components.length === 3 && a.components[0].clip === 'before'), a.id);
    assert.ok(C.assemblyCheck({ id: a.id, components: a.components }, rows).valid, a.id);
    assert.equal(C.assemblyCheck({ components: a.components }, rows).id, a.id);
  }
  const noB = C.assemblies(library({ edit: r => { r.find(b => b.id === 'TX-O02b').status = 'retired'; } }));
  assert.equal(noB.length, 12); assert.deepEqual(noB.filter(a => a.group === 'O2').map(a => a.id), ['HK-O2-0a', 'HK-O2-a0']);
});
test('assemblyCheck : les 16 recettes HK du 18/09 sont invalides (groupes mélangés) ; cas invalides du nouveau format expliqués', () => {
  const rows = library();
  for (const [id, tx] of Object.entries(OLD_HK)) {
    const r = C.assemblyCheck({ id, components: tx.map((b, i) => ({ slot: 'AB'[i], brick_id: b })) }, rows);
    assert.equal(r.valid, false, id); assert.equal(r.legacy, true); assert.match(r.reasons[0], /^mélange les groupes [MO]\d et [MO]\d \(un assemblage = un seul original filmé\)$/, id);
  }
  assert.equal(C.assemblyCheck({ components: [{ slot: 'A', brick_id: 'TX-O02a' }] }, rows).id, 'HK-O2-0a');   // ancien format, 1 transformation = original → version
  const bad = comps => C.assemblyCheck({ components: comps.map(([b, c], i) => ({ slot: 'ABCD'[i], brick_id: b, clip: c })) }, rows).reasons;
  assert.deepEqual(bad([['TX-O03', 'after'], ['TX-O01', 'after']]), ['mélange les groupes O3 et O1 (un assemblage = un seul original filmé)']);
  assert.deepEqual(bad([['TX-O02a', 'before'], ['TX-O02b', 'before']]), ['clip répété (l’original)']);
  assert.deepEqual(bad([['TX-O02a', 'after'], ['TX-O02b', 'after'], ['TX-O02a', 'before']]), ['une suite de 3 clips part de l’original']);
  assert.deepEqual(bad([['TX-O02a', 'avant'], ['TX-O02a', 'after']]), ['clip « avant » inconnu pour TX-O02a (before ou after)']);
  assert.deepEqual(bad([['TX-O01', 'after']]), ['au moins 2 clips']);
  assert.deepEqual(C.assemblyCheck({ components: [{ slot: 'A', brick_id: 'TX-M01', clip: 'before' }, { slot: 'B', brick_id: 'TX-M01', clip: 'after' }] },
    library({ edit: r => { r.find(b => b.id === 'TX-M01').status = 'retired'; } })).reasons, ['TX-M01 n’est pas prête (retirée)', 'TX-M01 n’est pas prête (retirée)']);
});
test('capacité avant / après : court = Σ groupes assemblages × hooks du module ayant un audio ; long = court × liaisons compatibles avec audio × avatars', () => {
  const c = C.capacity(library(), [], MX), g = {};
  c.modes.aa.groups.forEach(x => { g[x.group] = [x.module, x.assemblies, x.hooks.join(','), x.short, x.long]; });
  assert.deepEqual(g, {
    M1: ['motion-control', 2, 'H19,H53,H57,H63', 8, 72], M2: ['motion-control', 2, 'H19,H53,H57,H63', 8, 72], M4: ['motion-control', 2, 'H19,H53,H57,H63', 8, 72],
    O1: ['omni', 2, 'H19,H74', 4, 36], O2: ['omni', 8, 'H19,H74', 16, 144], O3: ['omni', 2, 'H19,H74', 4, 36] });
  // motion-control : 2 × (5 + 4 + 3 + 6) liaisons × 2 avatars = 72 ; omni O2 : 8 × (5 + 4) × 2 = 144
  assert.deepEqual([c.modes.aa.hooks, c.modes.aa.assemblies, c.modes.aa.short, c.modes.aa.long], [5, 18, 48, 432]);
  const noAudio = C.capacity(library({ edit: r => { delete r.find(b => b.id === 'H74').meta.media; } }), [], MX);
  assert.deepEqual([noAudio.modes.aa.short, noAudio.modes.aa.long], [48 - 12, 432 - 12 * 4 * 2]);   // H74 sans audio : −12 assemblages omni
  const one = C.capacity(library({ edit: r => { r.find(b => b.id === 'A2').status = 'retired'; } }), [], MX);
  assert.deepEqual([one.modes.aa.short, one.modes.aa.long], [48, 216]);   // le court avant / après n'a pas d'avatar
});
test('clés avant / après : aa|avatar|hook|liaison|assemblage (avatar vide en court) ; anciennes clés inchangées ; hors des possibles non décomptées', () => {
  const rows = library(), B = byIdOf(rows);
  assert.equal(C.videoKey('axel', 'A1', 'H12', 'L16'), 'axel|A1|H12|L16');
  assert.equal(C.videoKey('aa', 'A1', 'H74', '', 'HK-O2-0ab'), 'aa||H74||HK-O2-0ab');
  assert.equal(C.videoKey('axel', 'A1', 'H74', 'L16', 'HK-O2-0ab'), 'aa|A1|H74|L16|HK-O2-0ab');
  assert.equal(C.comboKey({ voice: 'axel', avatar: 'A2', hook: 'H74', assemblage: 'HK-O2-0ab', contenu: 'C-OMNI-01', cta: 'CTA-1' }, B), 'aa||H74||HK-O2-0ab');
  assert.equal(C.comboKey({ hook: 'H64', liaison: 'L16', avatar: 'A1', assemblage: 'HK-M1-0a' }, B), 'aa|A1|H63|L16|HK-M1-0a');
  assert.equal(C.comboKey({ hook: 'H74', assemblage: 'HK-O1-0a' }, B), 'aa||H74||HK-O1-0a');   // court : avatar facultatif
  assert.equal(C.comboKey({ voice: 'omni', hook: 'H74', assemblage: 'HK-O1-0a' }, B), 'omni||H74||HK-O1-0a');
  assert.equal(C.comboKey({ avatar: 'A1', hook: 'H12' }, B), 'axel|A1|H12|'); assert.equal(C.comboKey({ hook: 'H12' }, B), null);
  const ok = ['aa||H74||HK-O2-0ab', 'aa||H74||HK-O2-0ab', 'aa|A1|H74|L16|HK-O2-0ab', 'aa|A2|H63|L48|HK-M4-a0', 'axel|A1|H12|'];
  const out = ['aa||H53||HK-O2-0ab', 'aa|A1|H74||HK-O2-0ab', 'aa||H74|L16|HK-O2-0ab', 'aa|A1|H74|L12|HK-O2-0ab', 'aa||H74||HK-O01-02a', 'omni||H74||HK-O1-0a', 'aa||H12||HK-O1-0a', 'aa|A3|H74|L16|HK-O1-0a'];
  const c = C.capacity(rows, ok.concat(out), MX);
  assert.equal(c.modes.aa.done, 3); assert.equal(c.modes.axel.done, 1); assert.equal(c.done, 4); assert.equal(c.outside, out.length); assert.equal(c.remaining, 1832 - 4);
  assert.equal(c.modes.aa.remaining, 480 - 3);
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
  assert.deepEqual(C.comboCheck({ ...base, assemblage: 'HK-O2-0ab' }, B, MX).reasons, []);
  assert.deepEqual(C.comboCheck({ ...base, assemblage: 'HK-O2-0ab', liaison: 'L16' }, B, MX).reasons, []);
  assert.ok(C.comboCheck(base, B, MX).reasons.includes('hook H74 avant / après : jamais en lipsync (voix off sur un assemblage HK)'));
  assert.ok(C.comboCheck({ ...base, assemblage: 'HK-O01-02a' }, B, MX).reasons.includes('assemblage HK-O01-02a inconnu (suite de clips d’un seul groupe de transformations)'));
  assert.ok(C.comboCheck({ ...base, hook: 'H12', contenu: 'C-IMGIA-01', assemblage: 'HK-O2-0a' }, B, MX).reasons.includes('hook H12 lipsync sur un assemblage avant / après (hooks avant / après seulement)'));
  assert.ok(C.comboCheck({ ...base, hook: 'H53', contenu: 'C-OMNI-01', assemblage: 'HK-O2-0a' }, B, MX).reasons.includes('hook H53 hors du module de HK-O2-0a (omni)'));
  assert.ok(C.comboCheck({ ...base, voice: 'omni', assemblage: 'HK-O2-0a' }, B, MX).reasons.includes('pas de Voix native Omni sur un hook avant / après (voix off d’Axel)'));
  const d = C.declineTop({ ...base, assemblage: 'HK-O2-0ab' }, rows, { rand: seq(0) });
  assert.equal(d.combo.assemblage, 'HK-O2-0ab'); assert.equal(d.key, 'aa||H74||HK-O2-0ab');
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

const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(results.join('\n'));
console.log(fails + ' échec(s) sur ' + results.length);
process.exitCode = fails ? 1 : 0;
