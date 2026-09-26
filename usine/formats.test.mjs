#!/usr/bin/env node
// Tests de usine/formats.js (formats de hook à tester, Axel 26/09) + refus d'options de build.mjs / publish-qc.mjs (avant tout
// rendu ni upload) : node usine/formats.test.mjs. Aucune dépendance, aucun réseau, aucune écriture hors du dossier temporaire.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

await import(new URL('./formats.js', import.meta.url).href);
const F = globalThis.CF_FORMATS;
const HERE = dirname(fileURLToPath(import.meta.url));
const { mergeFaces } = await import(new URL('./face-zones.mjs', import.meta.url).href);

const results = [];
function test(name, fn) {
  try { fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ' · ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
const seq = (...xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };
const inter = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
const px = f => ({ x: f[0] * 1080, y: f[1] * 1920, w: f[2] * 1080, h: f[3] * 1920 });
const DEMO = { omni: { id: 'C-OMNI-01', kind: 'contenu', subject: 'omni', meta: {} }, claude: { id: 'C-CLAUDE-02', kind: 'contenu', subject: 'mcp-claude', meta: {} },
  sads: { id: 'C-SADS-01', kind: 'contenu', subject: 'static-ads', meta: { module: 'image-ia' } } };

// ── formats ──
test('5 formats F01…F05 : F01 = l’actuel, F02/F03 = phrase choc 3 s, F04 = gros colorés seuls, F05 = modélisé non rendable', () => {
  assert.deepEqual(F.FORMATS.map(f => f.id), ['F01', 'F02', 'F03', 'F04', 'F05']);
  const by = Object.fromEntries(F.FORMATS.map(f => [f.id, f]));
  assert.deepEqual([by.F01.choc, by.F01.subs, by.F01.renderable], [0, 'normal', true]);
  assert.deepEqual([by.F02.choc, by.F02.chocS, by.F02.subs], ['fixe', 3, 'gros-colores']);
  assert.deepEqual([by.F03.choc, by.F03.chocS, by.F03.subs], ['fixe', 3, 'normal']);
  assert.deepEqual([by.F04.choc, by.F04.subs], [0, 'gros-colores']);
  assert.deepEqual([by.F05.choc, by.F05.subs, by.F05.voice, by.F05.renderable, by.F05.needs], ['hook', 'aucun', false, false, ['reaction-muette', 'demo-muette']]);
  assert.equal(new Set(F.FORMATS.map(f => f.value)).size, 5);
  F.FORMATS.forEach(f => assert.ok(f.label && f.description && !/\p{Extended_Pictographic}/u.test(f.label + f.description), f.id + ' libellé sans émoji'));
});
test('resolveFormat : par id ou par valeur ; inconnu / clés du prototype → null', () => {
  assert.equal(F.resolveFormat('F02').id, 'F02');
  assert.equal(F.resolveFormat('choc-gros-colores').id, 'F02');
  assert.equal(F.resolveFormat(' F03 ').id, 'F03');
  ['F09', '', '__proto__', 'constructor', 'toString', null, 3].forEach(x => assert.equal(F.resolveFormat(x), null, String(x)));
});
test('chocEnd : fixe = 3 s bornées à la vidéo ; hook = durée du hook ; sans phrase = 0', () => {
  assert.equal(F.chocEnd(F.resolveFormat('F02'), 5.1, 20), 3);
  assert.equal(F.chocEnd(F.resolveFormat('F03'), 5.1, 2.5), 2.5);
  assert.equal(F.chocEnd(F.resolveFormat('F05'), 3.4, 20), 3.4);
  assert.equal(F.chocEnd(F.resolveFormat('F01'), 5.1, 20), 0);
});

// ── banque de phrases choc ──
test('banque : 19 phrases TH01…TH19, modules connus, TH13 exige TX-O02a', () => {
  assert.deepEqual(F.TEXTES_CHOC.map(p => p.id), Array.from({ length: 19 }, (_, i) => 'TH' + String(i + 1).padStart(2, '0')));
  F.TEXTES_CHOC.forEach(p => assert.ok(['generique', 'mcp-claude', 'omni', 'montage-ia'].includes(p.module), p.id));
  assert.deepEqual(F.TEXTES_CHOC.filter(p => p.module !== 'generique').map(p => p.id), ['TH10', 'TH11', 'TH12', 'TH13', 'TH14']);
  assert.equal(F.textChoc('TH13').tx, 'TX-O02a');
  assert.equal(F.textChoc('TH20'), null); assert.equal(F.textChoc('__proto__'), null);
});
const BANK = join(homedir(), 'Downloads', 'Creative Factory', 'banque-phrases-hook.md');
test('banque = copie EXACTE des phrases validées par Axel (banque-phrases-hook.md, section VALIDÉES)' + (existsSync(BANK) ? '' : ' — fichier absent, contrôle sauté'), () => {
  if (!existsSync(BANK)) return;
  const md = readFileSync(BANK, 'utf8'), sec = md.split(/^## /m).find(x => /^VALIDÉES/.test(x));
  assert.ok(sec, 'section VALIDÉES');
  const lines = sec.split('\n').filter(l => /^TH\d{2} /.test(l));
  assert.equal(lines.length, 19);
  lines.forEach(l => {
    const m = /^(TH\d{2}) (.+?)\s{2,}\((.+)\)\s*$/.exec(l);
    assert.ok(m, l);
    assert.equal(F.chocString(F.textChoc(m[1])), m[2].trim(), m[1]);
  });
  assert.ok(!F.TEXTES_CHOC.some(p => sec.indexOf(p.text) < 0), 'aucune phrase hors de la section VALIDÉES');
});
test('chocWhy : générique = toute démo ; module = sa démo seulement (meta.module d’abord) ; TH13 = démo omni + TX-O02a dans le hook', () => {
  assert.equal(F.chocWhy(F.textChoc('TH05'), DEMO.claude, null), '');
  assert.equal(F.chocWhy(F.textChoc('TH10'), DEMO.claude, null), '');
  assert.match(F.chocWhy(F.textChoc('TH10'), DEMO.omni, null), /ne va qu’avec une démo mcp-claude/);
  assert.match(F.chocWhy(F.textChoc('TH14'), DEMO.sads, null), /\(démo : image-ia\)/);
  assert.match(F.chocWhy(F.textChoc('TH13'), DEMO.omni, null), /exige la transformation TX-O02a.*non renseignée/);
  assert.match(F.chocWhy(F.textChoc('TH13'), DEMO.omni, ['TX-O01', 'TX-O03']), /exige la transformation TX-O02a/);
  assert.equal(F.chocWhy(F.textChoc('TH13'), DEMO.omni, ['TX-O02a', 'TX-O01']), '');
  assert.equal(F.chocWhy(F.textChoc('TH13'), 'omni', ['TX-O02a']), '');
  assert.match(F.chocWhy(null, DEMO.omni), /inconnue/);
});
test('txOfHook / isAvantApres : nom d’un hook avant/après → ses transformations ; autre nom → null', () => {
  assert.deepEqual(F.txOfHook('/x/rendus hooks/HK-O02a-01.mp4'), ['TX-O02a', 'TX-O01']);
  assert.deepEqual(F.txOfHook('HK-O01-02b'), ['TX-O01', 'TX-O02b']);
  assert.deepEqual(F.txOfHook('HK-M01-02.mp4'), ['TX-M01', 'TX-M02']);
  ['H74.mp4', 'HK-X1', 'avatar-HK.mp4', '', null].forEach(n => assert.equal(F.txOfHook(n), null, String(n)));
  assert.equal(F.isAvantApres('HK-M04-01.mp4'), true); assert.equal(F.isAvantApres('H57-A1.mp4'), false);
});

// ── rotation (A/B) ──
test('eligibleFormats : rendables seulement ; F05 jamais (pas rendable) ; format retiré en base exclu ; format absent de la base exclu', () => {
  assert.deepEqual(F.eligibleFormats().map(f => f.id), ['F01', 'F02', 'F03', 'F04']);
  assert.deepEqual(F.eligibleFormats({ ctx: { have: ['reaction-muette', 'demo-muette'] } }).map(f => f.id), ['F01', 'F02', 'F03', 'F04']);
  assert.deepEqual(F.eligibleFormats({ includeDraft: true, ctx: { have: ['reaction-muette', 'demo-muette'] } }).map(f => f.id), ['F01', 'F02', 'F03', 'F04', 'F05']);
  assert.deepEqual(F.eligibleFormats({ includeDraft: true, ctx: { have: ['reaction-muette'] } }).map(f => f.id), ['F01', 'F02', 'F03', 'F04']);
  const rows = ['F01', 'F02', 'F03', 'F04'].map(id => ({ id, kind: 'format', status: id === 'F03' ? 'retired' : 'ready' })).concat([{ id: 'H12', kind: 'hook', status: 'ready' }]);
  assert.deepEqual(F.eligibleFormats({ bricks: rows }).map(f => f.id), ['F01', 'F02', 'F04']);
  assert.deepEqual(F.eligibleFormats({ bricks: [{ id: 'H12', kind: 'hook', status: 'ready' }] }).map(f => f.id), ['F01', 'F02', 'F03', 'F04']);
});
test('pickFormat : le moins testé pour CE hook, puis le moins testé en tout, puis au hasard', () => {
  const done = [{ hook: 'H74', format: 'F01' }, { hook: 'H74', format: 'F01' }, { hook: 'H74', format: 'F02' }, { hook: 'H12', format: 'F03' }, { hook: 'H12', format: 'F03' }];
  assert.equal(F.pickFormat({ done, hook: 'H74', rand: () => 0 }).id, 'F04');       // F03/F04 à 0 pour H74 ; F03 déjà 2× ailleurs
  assert.equal(F.pickFormat({ done, hook: 'H99', rand: () => 0 }).id, 'F04');       // nouveau hook : F04 jamais testé
  assert.equal(F.pickFormat({ done: [], hook: 'H1', rand: () => 0.99 }).id, 'F04');
  assert.equal(F.pickFormat({ done: [], hook: 'H1', rand: () => 0 }).id, 'F01');
  assert.equal(F.pickFormat({ done: [{ hook: 'H1', format: 'F09' }, null, 'x'], hook: 'H1', rand: () => 0 }).id, 'F01');
});
test('pickFormat en série : 12 vidéos sur 3 hooks → chaque format 3 fois, chaque hook voit les 4 formats', () => {
  const done = [], r = seq(0.7, 0.1, 0.4, 0.9, 0.3, 0.6, 0.2, 0.8, 0.5, 0.05, 0.95, 0.35);
  for (let i = 0; i < 12; i++) { const hook = ['H12', 'H74', 'H20'][i % 3]; done.push({ hook, format: F.pickFormat({ done, hook, rand: r }).id }); }
  const n = {}; done.forEach(c => { n[c.format] = (n[c.format] || 0) + 1; });
  assert.deepEqual(n, { F01: 3, F02: 3, F03: 3, F04: 3 });
  ['H12', 'H74', 'H20'].forEach(h => assert.equal(new Set(done.filter(c => c.hook === h).map(c => c.format)).size, 4, h));
});
test('pickChoc : phrases compatibles avec la démo, la moins utilisée d’abord, préférence aux phrases qui tiennent (fits)', () => {
  const ids = new Set(); for (let i = 0; i < 40; i++) ids.add(F.pickChoc({ demo: DEMO.omni, rand: () => i / 40 }).id);
  assert.ok(![...ids].some(id => ['TH10', 'TH11', 'TH12', 'TH13', 'TH14'].includes(id)), [...ids].join(','));
  assert.equal(ids.size, 14);
  const idsTx = new Set(); for (let i = 0; i < 60; i++) idsTx.add(F.pickChoc({ demo: DEMO.omni, tx: ['TX-O02a', 'TX-O01'], rand: () => i / 60 }).id);
  assert.ok(idsTx.has('TH13'));
  const done = F.TEXTES_CHOC.filter(p => p.module === 'generique' && p.id !== 'TH18').map(p => ({ hook: 'H74', texte_choc: p.id }));
  assert.equal(F.pickChoc({ demo: DEMO.omni, done, hook: 'H74', rand: () => 0 }).id, 'TH18');
  assert.equal(F.pickChoc({ demo: DEMO.claude, rand: () => 0, fits: p => p.id === 'TH11' }).id, 'TH11');
  assert.ok(F.pickChoc({ demo: DEMO.claude, rand: () => 0, fits: () => false }));           // rien ne tient → quand même une phrase (revue)
  assert.equal(F.pickChoc({ demo: DEMO.omni, exclude: F.TEXTES_CHOC.map(p => p.id) }), null);
});

// ── recette (factory_qc.brick_combo) ──
test('comboFormatCheck : F02 + TH05 ok ; format sans phrase / phrase sans format / F01 + phrase / inconnu / F05 / TH99 = refus', () => {
  assert.deepEqual(F.comboFormatCheck({ format: 'F02', texte_choc: 'TH05' }, DEMO.omni).errors, []);
  assert.deepEqual(F.comboFormatCheck({ format: 'F01' }).errors, []);
  assert.deepEqual(F.comboFormatCheck({}).errors, []);
  const e = c => F.comboFormatCheck(c).errors.join(' | ');
  assert.match(e({ format: 'F03' }), /F03 sans texte choc/);
  assert.match(e({ texte_choc: 'TH05' }), /sans format/);
  assert.match(e({ format: 'F01', texte_choc: 'TH05' }), /F01 qui n’en a pas/);
  assert.match(e({ format: 'F09' }), /format « F09 » inconnu/);
  assert.match(e({ format: 'choc-gros-colores', texte_choc: 'TH05' }), /inconnu/);            // l'id seulement, jamais la valeur
  assert.match(e({ format: 'F05', texte_choc: 'TH05' }), /pas encore rendable/);
  assert.match(e({ format: 'F02', texte_choc: 'TH99' }), /absent de la banque validée/);
  assert.match(e({ format: '__proto__' }), /inconnu/);
});
test('comboFormatCheck : phrase d’un autre module que la démo = revue (raison), pas un refus', () => {
  const c = F.comboFormatCheck({ format: 'F02', texte_choc: 'TH10' }, DEMO.omni);
  assert.deepEqual(c.errors, []);
  assert.equal(c.reasons.length, 1); assert.match(c.reasons[0], /^texte choc : TH10 \(mcp-claude\)/);
  assert.deepEqual(F.comboFormatCheck({ format: 'F02', texte_choc: 'TH10' }).reasons, []);   // démo non fournie : pas jugée ici
});
test('mergeFormatMeta : format du rendu recopié dans la recette ; valeur contraire = erreur ; clés hors format ignorées', () => {
  const m = F.mergeFormatMeta({ avatar: 'A1', hook: 'H74' }, { combo: { format: 'F03', texte_choc: 'TH13', hook: 'H99' } });
  assert.deepEqual(m, { combo: { avatar: 'A1', hook: 'H74', format: 'F03', texte_choc: 'TH13' }, errors: [] });
  assert.deepEqual(F.mergeFormatMeta({ format: 'F03' }, { combo: { format: 'F03' } }).errors, []);
  assert.match(F.mergeFormatMeta({ format: 'F01' }, { combo: { format: 'F02', texte_choc: 'TH05' } }).errors[0], /format « F01 » ≠ « F02 » rendu/);
  assert.deepEqual(F.mergeFormatMeta({ hook: 'H1' }, null), { combo: { hook: 'H1' }, errors: [] });
});
test('formatReview : ok si phrase compatible et placement ok ; revue si placement sur un visage, démo introuvable, fichier du rendu absent', () => {
  const meta = { tx: ['TX-O02a', 'TX-O01'], layout: { zone: 'haut-gauche', size: 50, level: 'ok', reasons: [] } };
  const ok = F.formatReview({ format: 'F03', texte_choc: 'TH13', contenu: 'C-OMNI-01' }, DEMO.omni, meta);
  assert.deepEqual([ok.format, ok.texte_choc, ok.zone, ok.size, ok.level, ok.reasons], ['F03', 'TH13', 'haut-gauche', 50, 'ok', []]);
  const face = F.formatReview({ format: 'F02', texte_choc: 'TH05' }, DEMO.omni, { layout: { level: 'review', reasons: ['texte choc sur un visage : aucune zone libre dans la zone sûre'] } });
  assert.deepEqual([face.level, face.reasons], ['review', ['texte choc sur un visage : aucune zone libre dans la zone sûre']]);
  assert.match(F.formatReview({ format: 'F02', texte_choc: 'TH05', contenu: 'C-X' }, '', meta).reasons.join(), /démo C-X introuvable/);
  assert.match(F.formatReview({ format: 'F02', texte_choc: 'TH05' }, DEMO.omni, null).reasons.join(), /placement inconnu/);
  assert.match(F.formatReview({ format: 'F03', texte_choc: 'TH13' }, DEMO.omni, { layout: meta.layout }).reasons.join(), /exige la transformation TX-O02a/);
  assert.deepEqual(F.formatReview({ format: 'F04' }, DEMO.omni, null).reasons, []);          // sans phrase : rien à placer
  assert.equal(F.formatReview({ avatar: 'A1' }, DEMO.omni, null), null);
});

// ── placement de la phrase choc ──
const ALL_TEXTS = F.TEXTES_CHOC.map(F.chocString);
function checkBox(L, text, extra) {
  assert.equal(L.lines.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '), 'mots conservés');
  assert.ok(L.lines.length >= 1 && L.lines.length <= 6, 'lignes ' + L.lines.length);
  assert.ok(L.x >= 0 && L.x + L.w <= 1080 && L.y >= 220 && L.y + L.h <= 1450, 'dans la zone sûre ' + JSON.stringify([L.x, L.y, L.w, L.h]));
  F.UI_RESERVED.concat(extra || []).forEach(r => assert.ok(!inter(L, r), 'chevauche ' + (r.why || 'visage')));
  assert.ok(L.lines.every(l => F.textEm(l) * L.size <= L.maxW + 1), 'lignes dans la boîte');
  assert.ok(L.size >= 41 && L.size <= 62);
}
test('chocLayout sans visage : EN HAUT (y = 230), zone sûre TikTok/Reels, 19 phrases, niveau ok', () => {
  ALL_TEXTS.forEach(t => { const L = F.chocLayout(t, { faces: [] }); checkBox(L, t); assert.equal(L.zone, 'haut'); assert.equal(L.y, 230); assert.equal(L.level, 'ok'); });
});
test('chocLayout hook avant/après : jamais sur le médaillon « avant » (en haut à gauche ou sous le médaillon)', () => {
  ALL_TEXTS.forEach(t => { const L = F.chocLayout(t, { faces: [], avantApres: true }); checkBox(L, t, [F.INSET_AVANT_APRES]); assert.equal(L.level, 'ok'); assert.ok(['haut-gauche', 'milieu'].includes(L.zone)); });
  assert.equal(F.chocLayout(F.chocString(F.textChoc('TH13')), { faces: [], avantApres: true }).zone, 'haut-gauche');
});
const FACES = {
  selfie: [[0.3, 0.2, 0.4, 0.22]],                                                              // visage d'avatar au tiers haut
  hkM0102: [[0.475, 0.1394, 0.4836, 0.219], [-0.1304, 0.2411, 0.7975, 0.3876], [0.5155, 0.4549, 0.3241, 0.1823]],   // détecté sur HK-M01-02, 0-3 s
  bas: [[0.3, 0.55, 0.4, 0.2]]
};
test('chocLayout : JAMAIS sur un visage (visage élargi : front, cheveux) — selfie, hook HK-M01-02 réel, visage en bas', () => {
  Object.entries(FACES).forEach(([k, faces]) => ALL_TEXTS.forEach(t => {
    const L = F.chocLayout(t, { faces, avantApres: k === 'hkM0102' });
    checkBox(L, t, faces.map(px).concat(k === 'hkM0102' ? [F.INSET_AVANT_APRES] : []));
    assert.equal(L.level, 'ok', k + ' ' + t);
  }));
  assert.equal(F.chocLayout(ALL_TEXTS[1], { faces: FACES.bas }).zone, 'haut');
  assert.equal(F.chocLayout(ALL_TEXTS[1], { faces: FACES.selfie }).zone, 'milieu');
});
test('chocLayout : aucune place hors visage → moindre recouvrement + revue ; visages inconnus (null) → revue', () => {
  const L = F.chocLayout(ALL_TEXTS[0], { faces: [[0, 0.05, 1, 0.72]] });
  assert.equal(L.level, 'review'); assert.match(L.reasons.join(), /sur un visage/);
  F.UI_RESERVED.forEach(r => assert.ok(!inter(L, r)));
  const U = F.chocLayout(ALL_TEXTS[0], {});
  assert.equal(U.level, 'review'); assert.match(U.reasons.join(), /visages non vérifiés/);
});
test('wrap : l’emoji ne reste jamais seul sur sa ligne', () => {
  F.TEXTES_CHOC.forEach(p => [62, 50, 41].forEach(size => {
    const L = F.wrap(F.chocString(p).split(/\s+/), size, 400);
    if (L) assert.ok(L.every(l => l.replace(/\p{Extended_Pictographic}|‍|️/gu, '').trim().length > 0), p.id + ' ' + size + ' ' + L.join(' / '));
  }));
});
test('mergeFaces (face-zones.mjs) : un même visage vu sur plusieurs images = une boîte englobante ; deux visages distincts gardés', () => {
  const m = mergeFaces([[0.1, 0.1, 0.2, 0.2, 0.9], [0.12, 0.11, 0.2, 0.2, 0.8], [0.6, 0.1, 0.2, 0.1, 0.9]]);
  assert.deepEqual(m, [[0.1, 0.1, 0.22, 0.21], [0.6, 0.1, 0.2, 0.1]]);
});

// ── sous-titres ──
test('capsAfterChoc : sous-titres coupés pendant la phrase choc (finis avant = retirés, à cheval = commencent à la fin)', () => {
  const caps = [{ t: 'A', s: 0, e: 1 }, { t: 'B', s: 2.8, e: 3.3 }, { t: 'C', s: 3.3, e: 3.6 }, { t: 'D', s: 2.9, e: 3.04 }];
  assert.deepEqual(F.capsAfterChoc(caps, 3), [{ t: 'B', s: 3, e: 3.3 }, { t: 'C', s: 3.3, e: 3.6 }]);
  assert.deepEqual(F.capsAfterChoc(caps, 0), caps);
});
test('gros sous-titres colorés : mot fort (marque, chiffre, mot choc, mot long) en couleur ; petits mots en blanc', () => {
  ['INTERDIT', 'EUROPE', 'Claude', '30', '8 000', '1000€', 'TRANSFORMER', 'avatarads.fr', 'dinguerie', 'personnage'].forEach(w => assert.equal(F.isStrong(w), true, w));
  ['le', 'TE', 'MONTRER', 'maintenant', 'littéralement', "N'IMPORTE", 'COMMENCER,', 'tellement', 'peut-être', '', '...'].forEach(w => assert.equal(F.isStrong(w), false, w));
});
test('bigCapSize : 108 px par défaut, réduit pour tenir dans 960 px, jamais sous 56', () => {
  assert.equal(F.bigCapSize('IA', 960), 108);
  const s = F.bigCapSize('AVATARADS.FR', 960); assert.ok(s < 108 && s >= 56, String(s));
  assert.equal(F.bigCapSize('ANTICONSTITUTIONNELLEMENTXXXXXXXX', 960), 56);
});

// ── garde-fous des scripts (sortie AVANT tout rendu, upload ou écriture en base) ──
const tmp = mkdtempSync(join(tmpdir(), 'fmt-test-'));
const noNet = { ...process.env, PATH: dirname(process.execPath), SUPABASE_SERVICE_ROLE_KEY: '' };   // ni ffmpeg ni supabase : rien ne peut partir
const bricksF = join(tmp, 'bricks.json'); writeFileSync(bricksF, '[]');
const node = (args) => spawnSync(process.execPath, args, { encoding: 'utf8', env: noNet, timeout: 30000 });
test('build.mjs : format inconnu, F05 pas rendable, phrase hors banque, option inconnue → refus (code 2) avant tout rendu', () => {
  const B = [join(HERE, 'build.mjs'), join(tmp, 'h.mp4'), join(tmp, 'd.mp4'), join(tmp, 'o.mp4'), '--bricks', bricksF, '--done', bricksF];
  let r = node([...B, '--format', 'F09']); assert.equal(r.status, 2, r.stderr); assert.match(r.stderr, /format « F09 » inconnu/);
  r = node([...B, '--format', 'F05']); assert.equal(r.status, 2); assert.match(r.stderr, /F05 .* pas encore rendable/);
  r = node([...B, '--format', 'F02', '--choc', 'TH99']); assert.equal(r.status, 2); assert.match(r.stderr, /TH99.* absent de la banque validée/);
  r = node([...B, '--formt', 'F02']); assert.equal(r.status, 2); assert.match(r.stderr, /option inconnue : --formt/);
  const retired = join(tmp, 'retired.json');
  writeFileSync(retired, JSON.stringify(['F01', 'F02', 'F03', 'F04', 'F05'].map(id => ({ id, kind: 'format', status: 'retired' }))));
  r = node([join(HERE, 'build.mjs'), join(tmp, 'h.mp4'), join(tmp, 'd.mp4'), join(tmp, 'o.mp4'), '--bricks', retired, '--done', bricksF]);
  assert.equal(r.status, 2); assert.match(r.stderr, /aucun format tirable/);
  assert.ok(!existsSync(join(tmp, 'o.mp4')) && !existsSync(join(tmp, 'o.mp4.format.json')));
});
test('publish-qc.mjs : format inconnu / F05 / phrase sans format / désaccord avec le rendu / clé inconnue → refus (code 2) avant QC ni upload', () => {
  const V = join(tmp, 'v.mp4'), P = join(HERE, 'publish-qc.mjs');
  const run = (combo, extra) => node([P, V, 'omni', JSON.stringify(combo), '--bricks', bricksF, ...(extra || [])]);
  let r = run({ avatar: 'A1', hook: 'H74', format: 'F09' }); assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, /format « F09 » inconnu/);
  r = run({ avatar: 'A1', hook: 'H74', format: 'F05', texte_choc: 'TH05' }); assert.equal(r.status, 2); assert.match(r.stderr, /pas encore rendable/);
  r = run({ avatar: 'A1', hook: 'H74', texte_choc: 'TH05' }); assert.equal(r.status, 2); assert.match(r.stderr, /sans format/);
  r = run({ avatar: 'A1', hook: 'H74', formats: 'F02' }); assert.equal(r.status, 2); assert.match(r.stderr, /clé inconnue formats .*format, texte_choc/);
  const meta = join(tmp, 'meta.json'); writeFileSync(meta, JSON.stringify({ combo: { format: 'F02', texte_choc: 'TH05' } }));
  r = run({ avatar: 'A1', hook: 'H74', format: 'F01' }, ['--format-meta', meta]); assert.equal(r.status, 2); assert.match(r.stderr, /format « F01 » ≠ « F02 » rendu/);
  writeFileSync(V + '.format.json', JSON.stringify({ combo: { format: 'F03', texte_choc: 'TH99' } }));   // lu tout seul à côté de la vidéo
  r = run({ avatar: 'A1', hook: 'H74' }); assert.equal(r.status, 2); assert.match(r.stderr, /TH99.* absent de la banque validée/);
});

console.log(results.join('\n'));
const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - fails}/${results.length} OK`);
process.exit(fails ? 1 : 0);
