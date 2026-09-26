#!/usr/bin/env node
// Tests de usine/coherence.js + usine/hook-liaison.js (aucune dépendance) : node usine/coherence.test.mjs
// Bibliothèque de test = la forme des vraies données du 25/09 (2 avatars, 42 hooks dont H64 alias de H63, 12 liaisons dont
// 5 génériques, 15 CTA, 14 démos dont C-CLAUDE-01 et C-IMGIA-05 retirées) : 324 paires hook × liaison → 82 + 648 = 730
// vidéos finales par mode de voix, 1 460 au total.
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
const SUBJ = { H12: ['image-ia'], H16: ['mcp-claude'], H20: ['mcp-claude', 'generique'], H25: ['montage-ia'], H48: ['generique'], H53: ['motion-control'], H63: ['motion-control'], H64: ['motion-control'], H74: ['omni'], H77: ['static-ads'] };
function library(o) {
  o = o || {};
  const rows = [
    { id: 'A1', kind: 'avatar', subject: 'generique', status: 'ready', meta: {} },
    { id: 'A2', kind: 'avatar', subject: 'generique', status: 'ready', meta: {} }];
  Object.keys(MX).filter(h => h !== 'H74v2').forEach(h => rows.push({ id: h, kind: 'hook', subject: (SUBJ[h] || ['image-ia'])[0], status: 'ready', label: 'Accroche ' + h,
    meta: { compatible_subjects: SUBJ[h] || ['image-ia'], script: 'Phrase du hook ' + h, media: SB + 'hooks/' + h + '.wav', ...(h === 'H64' ? { alias_of: 'H63' } : {}) } }));
  LIAISONS.forEach(l => rows.push({ id: l, kind: 'liaison', subject: GENERIC.includes(l) ? 'generique' : 'montage', status: 'ready', label: 'Phrase de la liaison ' + l, meta: { media: SB + 'liaisons/' + l + '.wav', modules: [] } }));
  for (let i = 1; i <= 15; i++) rows.push({ id: 'CTA-' + i, kind: 'cta', subject: 'general', status: 'ready', label: 'CTA ' + i, meta: { media: SB + 'cta/' + i + '.wav' } });
  [['C-CLAUDE-01', 'mcp-claude', 'retired'], ['C-IMGIA-01', 'image-ia'], ['C-IMGIA-02', 'image-ia'], ['C-IMGIA-03', 'image-ia'], ['C-IMGIA-04', 'image-ia'], ['C-IMGIA-05', 'image-ia', 'retired'],
    ['C-IMGIA-06', 'image-ia'], ['C-IMGIA-07', 'image-ia'], ['C-OMNI-01', 'omni'], ['C-OMNI-02', 'omni'], ['C-OMNI-03', 'omni'], ['C-OMNI-04', 'omni'], ['C-SADS-01', 'static-ads'], ['C-SADS-02', 'static-ads']]
    .forEach(([id, s, st]) => rows.push({ id, kind: 'contenu', subject: s, status: st || 'ready', label: 'Démo ' + id, meta: { media: SB + 'demos/' + id + '.mp4' } }));
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
test('capacité (vraies données) : 2 avatars × 41 hooks = 82 court, 2 × 324 paires = 648 long, 730 par mode, 1 460 au total', () => {
  const c = C.capacity(library(), [], MX);
  assert.equal(c.avatars, 2); assert.equal(c.hooks, 41); assert.equal(c.liaisons, 12); assert.equal(c.demos, 12); assert.equal(c.ctas, 15); assert.equal(c.pairs, 324);
  for (const v of ['axel', 'omni']) assert.deepEqual([c.modes[v].short, c.modes[v].long, c.modes[v].total], [82, 648, 730], v);
  assert.equal(c.total, 1460); assert.equal(c.remaining, 1460); assert.equal(c.done, 0); assert.deepEqual(c.notInMatrix, []);
});
test('capacité : démos et CTA ne font pas de nouvelle vidéo (+1 démo, +1 CTA → 1 460 inchangé)', () => {
  const c = C.capacity(library({ edit: r => r.push({ id: 'C-NEW', kind: 'contenu', subject: 'omni', status: 'ready', meta: {} }, { id: 'CTA-NEW', kind: 'cta', status: 'ready', meta: {} }) }), [], MX);
  assert.equal(c.total, 1460); assert.equal(c.demos, 13);
});
test('capacité : briques retirées exclues (C-CLAUDE-01, C-IMGIA-05) ; hook retiré → −2 court, −2 × ses liaisons', () => {
  const rows = library({ edit: r => { r.find(b => b.id === 'H32').status = 'retired'; } });
  const c = C.capacity(rows, [], MX);
  assert.equal(c.demos, 12);
  assert.equal(c.hooks, 40); assert.equal(c.modes.axel.short, 80); assert.equal(c.modes.axel.long, 2 * (324 - 3));
});
test('mode Audio d’Axel : un hook sans audio sort du mode Axel seulement ; une liaison sans audio retire ses paires du mode Axel', () => {
  const c = C.capacity(library({ edit: r => { delete r.find(b => b.id === 'H12').meta.media; r.find(b => b.id === 'L12').meta.media = SB + 'liaisons/L12.txt'; } }), [], MX);
  // H12 : 8 liaisons ; L12 : 6 hooks (dont H12, déjà compté)
  assert.equal(c.modes.axel.hooks, 40); assert.equal(c.modes.axel.pairs, 324 - 8 - 5);
  assert.equal(c.modes.omni.hooks, 41); assert.equal(c.modes.omni.pairs, 324);
});
test('mode Voix native Omni : hook = meta.script sinon label ; sans texte → hors mode Omni ; brique normalisée (b.audio) reconnue', () => {
  const c = C.capacity(library({ edit: r => { const h = r.find(b => b.id === 'H13'); delete h.meta.script; const k = r.find(b => b.id === 'H14'); delete k.meta.script; k.label = '  '; } }), [], MX);
  assert.equal(c.modes.omni.hooks, 40); assert.equal(c.modes.axel.hooks, 41);
  assert.ok(C.voiceOk({ kind: 'hook', audio: SB + 'x.wav', meta: {} }, 'axel'));
  assert.equal(C.voiceText({ kind: 'hook', label: 'L', meta: { script: 'S' } }), 'S');
  assert.equal(C.voiceText({ kind: 'liaison', label: 'L', meta: { script: 'S' } }), 'L');
});
test('hook absent de la matrice : liaisons génériques seulement (subject « generique »)', () => {
  const rows = library({ edit: r => r.push({ id: 'H99', kind: 'hook', status: 'ready', label: 'x', meta: { compatible_subjects: ['omni'], script: 's', media: SB + 'h/H99.wav' } }) });
  const c = C.capacity(rows, [], MX);
  assert.deepEqual(c.notInMatrix, ['H99']);
  assert.equal(c.pairs, 324 + 5); assert.equal(c.modes.axel.long, 2 * 329);
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
  const done = ['axel|A1|H12|L16', 'axel|A1|H12|L16', 'omni|A2|H63|', 'axel|A1|H12|', 'axel|A1|H12|C-SADS-02'.replace('C-SADS-02', '')];
  const c = C.capacity(rows, done, MX);
  assert.equal(c.done, 3); assert.equal(c.modes.axel.done, 2); assert.equal(c.modes.omni.done, 1); assert.equal(c.remaining, 1457); assert.equal(c.outside, 0);
});
test('clés hors des possibles non décomptées : avatar inconnu, liaison non validée (L12 après H25), voix inconnue, hook retiré', () => {
  const rows = library({ edit: r => { r.find(b => b.id === 'H32').status = 'retired'; } });
  const c = C.capacity(rows, ['axel|A3|H12|', 'axel|A1|H25|L12', 'tts|A1|H12|', 'axel|A1|H32|', 'axel|A1|H25|L28'], MX);
  assert.equal(c.done, 1); assert.equal(c.outside, 4);
});

// ── briques qui manquent ──
test('impact : +1 avatar 730, +1 liaison 108 (27 hooks moyens × 2 × 2), +1 hook 36 (2 × (1 + 7,9) × 2), variété 0', () => {
  const I = C.impact(C.capacity(library(), [], MX));
  assert.deepEqual([I.avatar, I.liaison, I.hook, I.variety], [730, 108, 36, 0]);
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
  assert.equal(C.comboCheck({ ...base, hook: 'H14', voice: 'omni' }, B, MX).level, 'ok');
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

const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(results.join('\n'));
console.log(fails + ' échec(s) sur ' + results.length);
process.exitCode = fails ? 1 : 0;
