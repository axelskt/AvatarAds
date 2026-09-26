/* Creative Factory — FORMATS DE HOOK À TESTER (Axel 26/09 : « tester différents formats et récolter de la data »).
 *
 * Un format = la façon de présenter les 3 premières secondes et les sous-titres d'une vidéo finale. C'est de la VARIÉTÉ à
 * tester, PAS un multiplicateur de capacité : la clé d'une vidéo reste voix|avatar|hook|liaison (usine/coherence.js) ; le
 * format est tiré à l'assemblage (pickFormat, rotation équilibrée) puis ENREGISTRÉ dans factory_qc.brick_combo.format (et la
 * phrase dans brick_combo.texte_choc) par usine/publish-qc.mjs, pour que la perf puisse comparer les formats.
 *
 *   F01 Sous-titres seuls                          l'actuel (sous-titres blancs contour noir, 82 px, bas de l'écran)
 *   F02 Texte choc 3 s + gros sous-titres colorés  phrase choc en haut de 0 à 3 s, puis gros sous-titres, mot fort en jaune
 *   F03 Texte choc 3 s + sous-titres normaux       phrase choc en haut de 0 à 3 s, puis les sous-titres de F01
 *   F04 Gros sous-titres colorés                   pas de phrase choc ; gros sous-titres, mot fort en jaune (isole l'effet
 *                                                  des sous-titres : F01/F02/F03/F04 = plan 2 × 2 phrase choc × style)
 *   F05 Texte + musique                            hook UGC muet (tête choquée) + phrase, démo muette, musique seule, pas de
 *                                                  voix : MODÉLISÉ, pas encore rendu (attend les démos muettes d'Axel)
 *
 * Phrases choc = banque TH01–TH19 VALIDÉE par Axel (~/Downloads/Creative Factory/banque-phrases-hook.md) : copiée ici telle
 * quelle, jamais inventée (usine/formats.test.mjs vérifie la copie). Générique = toute démo ; sinon seulement la démo de son
 * module (règle de la banque) ; TH13 (« ma Clio en Porsche ») seulement si le hook visuel montre TX-O02a.
 *
 * Placement de la phrase (chocLayout) : zone sûre TikTok/Reels (ni la barre du haut, ni les icônes de droite, ni la légende
 * du bas), JAMAIS sur un visage (boîtes détectées sur les images 0-3 s du hook, usine/face-zones.mjs) ni sur le médaillon
 * « avant » d'un hook avant/après ; visible dès la frame 0 (règle « hook : frame 0 jamais blanche »).
 * Chargé tel quel par le navigateur (window.CF_FORMATS) et par node (import puis globalThis.CF_FORMATS). Aucune dépendance.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.CF_FORMATS = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  // ── formats ──
  // choc : 0 = pas de phrase ; 'fixe' = phrase de 0 à chocS ; 'hook' = phrase pendant tout le hook (F05).
  // subs : 'normal' (style actuel) | 'gros-colores' | 'aucun'. needs : ce que le format exige de la recette (F05).
  var FORMATS = [
    { id: 'F01', value: 'sous-titres', label: 'Sous-titres seuls', choc: 0, chocS: 0, subs: 'normal', voice: true, renderable: true,
      description: 'Sous-titres blancs seuls (l’actuel)' },
    { id: 'F02', value: 'choc-gros-colores', label: 'Texte choc 3 s + gros sous-titres colorés', choc: 'fixe', chocS: 3, subs: 'gros-colores', voice: true, renderable: true,
      description: 'Phrase choc en haut de 0 à 3 s, puis gros sous-titres, mot fort en jaune' },
    { id: 'F03', value: 'choc-sous-titres', label: 'Texte choc 3 s + sous-titres normaux', choc: 'fixe', chocS: 3, subs: 'normal', voice: true, renderable: true,
      description: 'Phrase choc en haut de 0 à 3 s, puis sous-titres blancs' },
    { id: 'F04', value: 'gros-colores', label: 'Gros sous-titres colorés', choc: 0, chocS: 0, subs: 'gros-colores', voice: true, renderable: true,
      description: 'Gros sous-titres, mot fort en jaune, sans phrase choc' },
    { id: 'F05', value: 'texte-musique', label: 'Texte + musique', choc: 'hook', chocS: 0, subs: 'aucun', voice: false, renderable: false,
      needs: ['reaction-muette', 'demo-muette'],
      description: 'Hook UGC muet tête choquée + phrase, démo muette, musique seule' }
  ];
  var BY_ID = Object.create(null);
  FORMATS.forEach(function (f) { BY_ID[f.id] = f; BY_ID[f.value] = f; });
  function resolveFormat(x) { return typeof x === 'string' && has(BY_ID, x.trim()) ? BY_ID[x.trim()] : null; }
  function hasChoc(f) { return !!(f && f.choc); }
  // Clés que publish-qc.mjs ajoute à brick_combo (en plus de usine/coherence.js COMBO_KEYS).
  var COMBO_KEYS = ['format', 'texte_choc'];

  // ── banque de phrases choc (VALIDÉES par Axel le 26/09 — copie exacte, cf. en-tête) ──
  // module : 'generique' (toute démo) | module de la démo (usine/coherence.js demoModule) ; tx : transformation exigée.
  var TEXTES_CHOC = [
    { id: 'TH01', text: 'Je pourrais littéralement embrasser le propriétaire de l\'entreprise qui m\'a montré ça', emoji: '🤯', module: 'generique' },
    { id: 'TH02', text: 'Ça devrait être interdit de montrer ça', emoji: '😶', module: 'generique' },
    { id: 'TH03', text: 'Ok là c\'est officiel, l\'IA est allée trop loin', emoji: '😳', module: 'generique' },
    { id: 'TH04', text: 'Les agences vont détester que je montre ça', emoji: '😅', module: 'generique' },
    { id: 'TH05', text: 'Mon cerveau a buggé la première fois que j\'ai vu ça', emoji: '🫠', module: 'generique' },
    { id: 'TH06', text: 'Ce site va faire perdre leur boulot à pas mal de monde', emoji: '😬', module: 'generique' },
    { id: 'TH07', text: 'Je suis obligé de supprimer cette vidéo dans 24 heures', emoji: '😳', module: 'generique' },
    { id: 'TH08', text: 'Nan vraiment, l\'IA c\'est trop ce qu\'elle fait maintenant', emoji: '😳', module: 'generique' },
    { id: 'TH09', text: 'Je pourrais littéralement embrasser la personne qui m\'a montré ça', emoji: '🤯', module: 'generique' },
    { id: 'TH10', text: 'C\'est une dinguerie ce que Claude peut faire maintenant', emoji: '🤯', module: 'mcp-claude' },
    { id: 'TH11', text: 'Claude peut maintenant faire des vidéos et personne n\'en parle', emoji: '🤯', module: 'mcp-claude' },
    { id: 'TH12', text: 'J\'ai demandé à Claude de me faire une pub… regarde le résultat', emoji: '😳', module: 'mcp-claude' },
    { id: 'TH13', text: 'J\'ai transformé ma Clio en Porsche en une phrase', emoji: '🚗🤯', module: 'omni', tx: 'TX-O02a' },
    { id: 'TH14', text: 'J\'ai monté cette vidéo en 2 clics. Sans monteur', emoji: '🤯', module: 'montage-ia' },
    { id: 'TH15', text: 'Non mais c\'est quoi ce truc ??', emoji: '😱', module: 'generique' },
    { id: 'TH16', text: 'Attends… on peut faire quoi maintenant ????', emoji: '😳', module: 'generique' },
    { id: 'TH17', text: 'Comment c\'est possible ça ??', emoji: '😱', module: 'generique' },
    { id: 'TH18', text: 'J\'ai dû regarder 5 fois pour y croire', emoji: '🤯', module: 'generique' },
    { id: 'TH19', text: 'Ça, c\'est pas censé être possible', emoji: '😳', module: 'generique' }
  ];
  var TH = Object.create(null);
  TEXTES_CHOC.forEach(function (p) { TH[p.id] = p; });
  function textChoc(id) { return typeof id === 'string' && has(TH, id) ? TH[id] : null; }
  function chocString(p) { return p ? p.text + (p.emoji ? ' ' + p.emoji : '') : ''; }

  function meta(b) { return (b && b.meta && typeof b.meta === 'object') ? b.meta : {}; }
  function demoModuleOf(d) { return typeof d === 'string' ? d : String(meta(d).module || (d && d.subject) || ''); }
  // Pourquoi une phrase ne va pas avec cette démo / ce hook visuel ('' = elle va). tx = transformations du hook visuel
  // (ex. ['TX-O02a','TX-O01'] pour HK-O02a-01) ; null = inconnues.
  function chocWhy(p, demo, tx) {
    if (!p) return 'phrase choc inconnue';
    var mod = demoModuleOf(demo);
    if (p.module !== 'generique' && p.module !== mod) return p.id + ' (' + p.module + ') ne va qu’avec une démo ' + p.module + ' (démo : ' + (mod || '?') + ')';
    if (p.tx && !(Array.isArray(tx) && tx.indexOf(p.tx) >= 0)) return p.id + ' exige la transformation ' + p.tx + ' dans le hook visuel' + (Array.isArray(tx) ? '' : ' (non renseignée)');
    return '';
  }

  // ── rotation équilibrée (A/B) ──
  function count(done, key, val, hook) {
    var n = 0;
    (done || []).forEach(function (c) { if (c && c[key] === val && (hook == null || c.hook === hook)) n += 1; });
    return n;
  }
  function pickBalanced(list, key, done, hook, rand) {
    if (!list.length) return null;
    var best = [], bh = Infinity, bg = Infinity;
    list.forEach(function (x) {
      var h = hook ? count(done, key, x.id, hook) : 0, g = count(done, key, x.id, null);
      if (h < bh || (h === bh && g < bg)) { best = [x]; bh = h; bg = g; } else if (h === bh && g === bg) best.push(x);
    });
    var r = typeof rand === 'function' ? rand() : Math.random();
    return best[Math.min(best.length - 1, Math.max(0, Math.floor(r * best.length)))];
  }
  // Formats tirables : rendables, dont la recette a ce qu'ils exigent (ctx.have = ['reaction-muette', …]) et, si la base
  // en connaît (lignes factory_bricks kind 'format'), au statut 'ready' (Axel retire un format en passant son statut à 'retired').
  function eligibleFormats(opts) {
    opts = opts || {};
    var have = (opts.ctx && opts.ctx.have) || [], rows = (opts.bricks || []).filter(function (b) { return b && b.kind === 'format'; });
    var st = Object.create(null); rows.forEach(function (b) { st[b.id] = b.status == null ? 'ready' : b.status; });
    return FORMATS.filter(function (f) {
      if (!f.renderable && !opts.includeDraft) return false;
      if ((f.needs || []).some(function (n) { return have.indexOf(n) < 0; })) return false;
      return rows.length ? st[f.id] === 'ready' : true;
    });
  }
  // Format de la prochaine vidéo : le moins testé pour CE hook, puis le moins testé en tout, puis au hasard.
  // done = recettes déjà produites (factory_qc.brick_combo), hook = id du hook de la vidéo à assembler.
  function pickFormat(opts) {
    opts = opts || {};
    return pickBalanced(eligibleFormats(opts), 'format', opts.done, opts.hook || null, opts.rand);
  }
  // Phrase choc : compatible avec la démo (et le hook visuel), la moins utilisée pour ce hook puis en tout.
  // opts.fits(p) (facultatif) : la phrase tient-elle à l'écran sans toucher un visage ? On tire d'abord parmi celles qui
  // tiennent ; si aucune ne tient, parmi toutes (la vidéo partira en revue QC, cf. chocLayout).
  function pickChoc(opts) {
    opts = opts || {};
    var ex = opts.exclude || [];
    var ok = TEXTES_CHOC.filter(function (p) { return ex.indexOf(p.id) < 0 && !chocWhy(p, opts.demo, opts.tx || null); });
    if (typeof opts.fits === 'function') { var fit = ok.filter(function (p) { return opts.fits(p); }); if (fit.length) ok = fit; }
    return pickBalanced(ok, 'texte_choc', opts.done, opts.hook || null, opts.rand);
  }
  // Fin de la phrase choc (s) : 'fixe' = chocS (bornée à la vidéo) ; 'hook' = tout le hook ; sinon 0.
  function chocEnd(f, hookDur, total) {
    if (!f || !f.choc) return 0;
    var e = f.choc === 'hook' ? +hookDur || 0 : f.chocS;
    return total > 0 ? Math.min(e, total) : e;
  }
  // Transformations montrées par un hook visuel avant/après d'après son nom (usine/transformations-omni.md).
  // Assemblage actuel « HK-<groupe>-<clips> » (factory_recipes, usine/coherence.js assemblies) : « HK-O2-0ab.mp4 » →
  // ['TX-O02a', 'TX-O02b'] ; lu dans la bibliothèque (bricks + CF_COHERENCE chargé), sinon null (inconnues : TH13 part en revue).
  // Ancien nom du 18/09 : « HK-O02a-01 » → ['TX-O02a', 'TX-O01'] ; « HK-M01-02.mp4 » → ['TX-M01', 'TX-M02']. Autre nom → null.
  var RE_HK_OLD = /(?:^|[\\/])HK-([MO])([0-9]{2}[a-z]?)-([0-9]{2}[a-z]?)(?:[-_.]|$)/;
  var RE_HK_ASM = /(?:^|[\\/])(HK-([MO][0-9]{1,2})-([0a-z]{2,3}))(?:[-_.]|$)/;
  function txOfHook(name, bricks) {
    var s = String(name || ''), m = RE_HK_OLD.exec(s);
    if (m) return ['TX-' + m[1] + m[2], 'TX-' + m[1] + m[3]];
    m = RE_HK_ASM.exec(s);
    var C = root.CF_COHERENCE;
    if (!m || !Array.isArray(bricks) || !C || typeof C.assemblies !== 'function') return null;
    var a = C.assemblies(bricks).filter(function (x) { return x.id === m[1]; })[0];
    if (!a) return null;
    var out = [];
    a.components.forEach(function (c) { if (c && c.brick_id && out.indexOf(c.brick_id) < 0) out.push(c.brick_id); });
    return out.length ? out : null;
  }
  // Hook visuel avant/après (médaillon « avant » à protéger) : ancien nom ou assemblage HK-<groupe>-<clips>, bibliothèque ou non.
  function isAvantApres(name) { var s = String(name || ''); return RE_HK_OLD.test(s) || RE_HK_ASM.test(s); }

  // Contrôle des clés format de la recette (usine/publish-qc.mjs). errors = recette refusée ; reasons = revue manuelle.
  function comboFormatCheck(combo, demo, tx) {
    combo = combo || {};
    var errors = [], reasons = [], f = null;
    if (combo.format != null && combo.format !== '') {
      f = resolveFormat(combo.format);
      if (!f || f.id !== combo.format) errors.push('format « ' + String(combo.format).slice(0, 30) + ' » inconnu (' + FORMATS.map(function (x) { return x.id; }).join(', ') + ')');
      else if (!f.renderable) errors.push('format ' + f.id + ' (' + f.label + ') pas encore rendable');
    }
    if (combo.texte_choc != null && combo.texte_choc !== '') {
      var p = textChoc(combo.texte_choc);
      if (!p) errors.push('texte choc « ' + String(combo.texte_choc).slice(0, 30) + ' » absent de la banque validée (TH01–TH19)');
      else if (f && !hasChoc(f)) errors.push('texte choc ' + p.id + ' sur le format ' + f.id + ' qui n’en a pas');
      else if (!f) errors.push('texte choc ' + p.id + ' sans format');
      else if (demo !== undefined) { var w = chocWhy(p, demo, tx); if (w) reasons.push('texte choc : ' + w); }
    } else if (f && hasChoc(f)) errors.push('format ' + f.id + ' sans texte choc (texte_choc)');
    return { format: f, errors: errors, reasons: reasons };
  }

  // Recopie dans la recette le format choisi au rendu (build.mjs écrit <video>.format.json, meta.combo = { format, texte_choc }).
  // Une valeur déjà dans la recette et différente de celle rendue = erreur (refus : la recette mentirait sur la vidéo).
  function mergeFormatMeta(combo, meta) {
    var out = {}, errors = [], mc = meta && meta.combo && typeof meta.combo === 'object' ? meta.combo : {};
    Object.keys(combo || {}).forEach(function (k) { out[k] = combo[k]; });
    COMBO_KEYS.forEach(function (k) {
      var v = has(mc, k) ? mc[k] : null;
      if (v == null || v === '') return;
      if (out[k] != null && out[k] !== '' && out[k] !== v) errors.push(k + ' « ' + String(out[k]).slice(0, 30) + ' » ≠ « ' + String(v).slice(0, 30) + ' » rendu');
      else out[k] = v;
    });
    return { combo: out, errors: errors };
  }
  // Revue QC du format (usine/publish-qc.mjs) : phrase ↔ démo (module, transformation du hook visuel) et placement rendu.
  // demo = brique démo | '' (démo citée mais introuvable) | undefined (pas de démo) ; meta = <video>.format.json (ou null).
  // null si la recette n'a pas de format ; sinon { format, label, texte_choc, zone, size, level 'ok' | 'review', reasons, errors }.
  function formatReview(combo, demo, meta) {
    combo = combo || {};
    var fc = comboFormatCheck(combo, demo, meta && Array.isArray(meta.tx) ? meta.tx : null);
    if (!fc.format) return fc.errors.length ? { format: null, errors: fc.errors, reasons: [], level: 'review' } : null;
    var lay = meta && meta.layout && typeof meta.layout === 'object' ? meta.layout : null, why = fc.reasons.slice();
    function add(r) { var t = /^texte choc\b/.test(String(r)) ? String(r) : 'texte choc : ' + r; if (why.indexOf(t) < 0) why.push(t); }
    if (hasChoc(fc.format)) {
      if (demo === '') add('démo ' + String(combo.contenu || '?').slice(0, 40) + ' introuvable, compatibilité non vérifiée');
      if (!lay) add('placement inconnu (pas de fichier du rendu)');
      else if (lay.level !== 'ok') (Array.isArray(lay.reasons) && lay.reasons.length ? lay.reasons : ['placement à vérifier']).forEach(add);
    }
    return { format: fc.format.id, label: fc.format.label, texte_choc: combo.texte_choc || null, zone: lay && lay.zone || null, size: lay && lay.size || null,
      level: why.length || fc.errors.length ? 'review' : 'ok', reasons: why, errors: fc.errors };
  }

  // ── placement de la phrase choc ──
  var CANVAS = { w: 1080, h: 1920 };
  // Zone sûre TikTok / Reels (canevas 1080 × 1920) : ce que l'interface de l'appli recouvre.
  var UI_RESERVED = [
    { x: 0, y: 0, w: 1080, h: 220, why: 'barre du haut TikTok / Reels' },
    { x: 940, y: 620, w: 140, h: 900, why: 'icônes à droite' },
    { x: 0, y: 1450, w: 1080, h: 470, why: 'légende et pseudo en bas' }
  ];
  // Médaillon « avant » des hooks avant/après (gabarit usine/transformations-omni.md : bord mesuré 588–1039 × 90–888) + marge.
  var INSET_AVANT_APRES = { x: 566, y: 68, w: 496, h: 842, why: 'médaillon « avant » du hook avant/après' };
  var TOP_MIN = 230, BOTTOM_MAX = 1440, HAUT_MAX = 780;   // centre de la phrase au-dessus de HAUT_MAX = « en haut »
  var SIZES = [62, 56, 50, 45, 41];
  // largeur approchée d'un caractère (em) — police de la phrase : Inter 700 ; filet de sécurité à l'affichage (fit).
  function charEm(ch) {
    if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ch)) return 1.2;
    if (' '.indexOf(ch) >= 0) return 0.27;
    if ('il.,:;!|\'’'.indexOf(ch) >= 0) return 0.28;
    if ('ftrj'.indexOf(ch) >= 0) return 0.4;
    if ('mw'.indexOf(ch) >= 0) return 0.88;
    if ('MW'.indexOf(ch) >= 0) return 0.95;
    if (/[A-ZÀ-ÖØ-Þ]/.test(ch)) return 0.7;
    if (/[0-9]/.test(ch)) return 0.62;
    if (ch === '…' || ch === '?') return 0.6;
    return 0.58;
  }
  function textEm(s) { var n = 0; Array.from(s).forEach(function (c) { n += charEm(c); }); return n * 1.03; }
  // Coupe en lignes (glouton puis équilibré) ; l'emoji ne reste jamais seul sur sa ligne.
  function wrap(words, size, maxW) {
    // un emoji seul reste collé au mot d'avant (jamais seul sur sa ligne)
    words = (words || []).reduce(function (acc, w) {
      if (acc.length && !w.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u200d\ufe0f]/gu, '').trim()) acc[acc.length - 1] += ' ' + w; else acc.push(w);
      return acc;
    }, []);
    function greedy(limit) {
      var lines = [], cur = '';
      words.forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (cur && textEm(t) * size > limit) { lines.push(cur); cur = w; } else cur = t;
      });
      if (cur) lines.push(cur);
      var n = lines.length;
      if (n > 1 && textEm(lines[n - 1].replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim()) === 0) {
        var prev = lines[n - 2].split(' '), moved = prev.pop();
        if (prev.length) { lines[n - 2] = prev.join(' '); lines[n - 1] = moved + ' ' + lines[n - 1]; }
      }
      return lines;
    }
    var lines = greedy(maxW);
    if (lines.some(function (l) { return textEm(l) * size > maxW; })) return null;   // un mot trop long pour la colonne
    var lo = maxW * 0.5, hi = maxW;                                                  // équilibre : plus étroit, même nb de lignes
    for (var i = 0; i < 12; i++) { var mid = (lo + hi) / 2, t = greedy(mid); if (t.length === lines.length && !t.some(function (l) { return textEm(l) * size > mid + 1; })) hi = mid; else lo = mid; }
    return greedy(hi);
  }
  function inter(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }
  // Boîtes de visage normalisées [x, y, w, h] (origine haut-gauche) → px ; « large » = + front / cheveux et joues.
  function faceRects(faces, wide) {
    return (faces || []).filter(function (f) { return Array.isArray(f) && f.length >= 4; }).map(function (f) {
      var x = f[0] * CANVAS.w, y = f[1] * CANVAS.h, w = f[2] * CANVAS.w, h = f[3] * CANVAS.h;
      return wide ? { x: x - 0.15 * w, y: y - 0.35 * h, w: w * 1.3, h: h * 1.5, why: 'visage' } : { x: x, y: y, w: w, h: h, why: 'visage' };
    });
  }
  // Place la phrase. o = { faces: [[x,y,w,h]…] normalisées | null (inconnues), avantApres: bool, reserved: [rects px] }.
  // Rend { zone, x, y, w, h, size, lineH, padX, padY, lines, align, maxW, level 'ok' | 'review', reasons }.
  function chocLayout(text, o) {
    o = o || {};
    var words = String(text || '').trim().split(/\s+/).filter(Boolean);
    var fixed = UI_RESERVED.concat(o.avantApres ? [INSET_AVANT_APRES] : []).concat(o.reserved || []);
    var wide = faceRects(o.faces, true), core = faceRects(o.faces, false);
    // colonnes : pleine largeur centrée ; à gauche d'un obstacle du haut (médaillon, visage à droite)
    var leftEdge = CANVAS.w;
    fixed.concat(wide).forEach(function (r) { if (r.y < HAUT_MAX && r.y + r.h > TOP_MIN && r.x > CANVAS.w * 0.4) leftEdge = Math.min(leftEdge, r.x); });
    var cols = [{ zone: 'haut', align: 'center', left: 90, right: 930, top: true },
      { zone: 'haut-gauche', align: 'left', left: 70, right: Math.min(CANVAS.w - 70, leftEdge - 24), top: true },
      { zone: 'milieu', align: 'center', left: 150, right: 930, top: false }];
    function box(col, size) {
      var colW = col.right - col.left;
      if (colW < 360) return null;
      var padX = Math.round(size * 0.42), padY = Math.round(size * 0.12), lineH = Math.round(size * 1.2);
      var lines = wrap(words, size, colW - 2 * padX);
      if (!lines || lines.length > 6) return null;
      var tw = 0; lines.forEach(function (l) { tw = Math.max(tw, textEm(l) * size); });
      var w = Math.min(colW, Math.ceil(tw * 1.06) + 2 * padX), h = lines.length * (lineH + 2 * padY);
      var x = col.align === 'center' ? Math.round((col.left + col.right) / 2 - w / 2) : col.left;
      return { x: x, w: w, h: h, size: size, lineH: lineH, padX: padX, padY: padY, lines: lines, maxW: w - 2 * padX };
    }
    function scan(col, size, maxLines, obstacles) {
      var b = box(col, size);
      if (!b || b.lines.length > maxLines) return null;
      var y0 = col.top ? TOP_MIN : HAUT_MAX - 40, y1 = col.top ? HAUT_MAX - b.h / 2 : BOTTOM_MAX - b.h;
      for (var y = y0; y <= y1; y += 10) {
        var r = { x: b.x, y: y, w: b.w, h: b.h };
        if (!obstacles.some(function (ob) { return inter(r, ob) > 0; })) return Object.assign(b, { y: y, zone: col.zone, align: col.align });
      }
      return null;
    }
    // Ordre de préférence : EN HAUT (pleine largeur, sinon à gauche d'un obstacle) en 4 lignes au plus, la plus grande taille
    // d'abord ; sinon au MILIEU (sous le visage / le médaillon) ; en dernier recours jusqu'à 6 lignes. Chaque fois d'abord
    // sans toucher le visage élargi (front, cheveux), puis sans toucher le visage lui-même.
    var TIERS = [{ zones: ['haut', 'haut-gauche'], maxLines: 4 }, { zones: ['milieu'], maxLines: 4 }, { zones: ['haut', 'haut-gauche', 'milieu'], maxLines: 6 }];
    var reasons = [], hit = null;
    [wide, core].some(function (faces) {
      var obstacles = fixed.concat(faces);
      return TIERS.some(function (t) {
        return SIZES.some(function (size) {
          return cols.some(function (c) { if (t.zones.indexOf(c.zone) < 0) return false; hit = scan(c, size, t.maxLines, obstacles); return !!hit; });
        });
      });
    });
    if (!hit) {                                            // aucun endroit libre : moindre recouvrement du visage → revue QC
      var bestA = Infinity;
      cols.forEach(function (c) {
        var b0 = box(c, SIZES[SIZES.length - 1]);
        if (!b0) return;
        var y0 = c.top ? TOP_MIN : HAUT_MAX - 40, y1 = c.top ? HAUT_MAX - b0.h / 2 : BOTTOM_MAX - b0.h;
        for (var y = y0; y <= y1; y += 10) {
          var r = { x: b0.x, y: y, w: b0.w, h: b0.h };
          if (fixed.some(function (ob) { return inter(r, ob) > 0; })) continue;
          var a = 0; core.forEach(function (f) { a += inter(r, f); });
          if (a < bestA) { bestA = a; hit = Object.assign({}, b0, { y: y, zone: c.zone, align: c.align }); }
        }
      });
      if (!hit) { hit = Object.assign(box(cols[0], SIZES[SIZES.length - 1]) || { x: 90, w: 840, h: 300, size: 45, lineH: 54, padX: 19, padY: 5, lines: words, maxW: 800 }, { y: TOP_MIN, zone: 'haut', align: 'center' }); }
      reasons.push('texte choc sur un visage : aucune zone libre dans la zone sûre');
    }
    if (o.faces == null) reasons.push('visages non vérifiés (détection indisponible)');
    return Object.assign(hit, { level: reasons.length ? 'review' : 'ok', reasons: reasons });
  }

  // ── gros sous-titres colorés : mot fort ──
  var STRONG = ['IA', 'AI', 'CLAUDE', 'AVATARADS', 'AVATARADS.FR', 'GRATUIT', 'GRATUITE', 'INTERDIT', 'INTERDITE', 'ARGENT', 'VIRAL', 'VIRALE', 'VIRALES', 'VIRAUX',
    'MILLIONS', 'MILLIERS', 'SECONDES', 'MINUTES', 'DINGUERIE', 'DEBILE', 'FOU', 'FOLLE', 'JAMAIS', 'PERSONNE', 'SEUL', 'EUROPE', 'LUXE', '4K', 'FAKE', 'TRICHE',
    'PROMPT', 'MONTAGE', 'TRANSFORMER', 'REMPLACER', 'VISAGE', 'AVATAR', 'AVATARS', 'INFLUENCEUSE', 'INFLUENCEUSES', 'TIKTOK', 'ROI', 'CLIENTS', 'VUES', 'PUB', 'PUBS',
    'VIDEO', 'VIDEOS', 'PORSCHE', 'LAMBORGHINI', 'BUGATTI', 'PATEK', 'CAPCUT', 'MAGIQUE', 'INCROYABLE', 'SECRET', 'CHOQUE', 'IMPOSSIBLE'];
  // mots longs mais faibles (jamais en couleur)
  var WEAK = ['MAINTENANT', 'COMMENT', 'VRAIMENT', 'POURQUOI', 'QUELQUE', 'QUELQUES', 'QUELQU\'UN', 'TOUJOURS', 'SEULEMENT', 'SIMPLEMENT', 'LAISSE-MOI',
    'AUJOURD\'HUI', 'N\'IMPORTE', 'PROCHAINES', 'PROCHAINE', 'LITTERALEMENT', 'COMMENCER', 'TELLEMENT', 'ENSUITE', 'D\'ABORD', 'EXEMPLE', 'BEAUCOUP',
    'PEUT-ETRE', 'PENDANT', 'DERRIERE', 'PREMIERE', 'PREMIER', 'DERNIERE', 'DERNIER', 'REGARDER', 'MONTRER', 'EXPLIQUER', 'EXACTEMENT', 'ABSOLUMENT',
    'CERTAINEMENT', 'PERSONNELLEMENT', 'CELLE-CI', 'CELUI-CI', 'D\'AILLEURS', 'MOI-MEME', 'TOI-MEME', 'VOUDRAIS', 'POURRAIS'];
  function bare(w) { return String(w || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9'’.$€%-]/g, '').replace(/’/g, '\'').replace(/^[.'-]+|[.'-]+$/g, ''); }
  function isStrong(w) {
    var b = bare(w);
    if (!b) return false;
    if (/[0-9€$%]/.test(b)) return true;
    if (STRONG.indexOf(b) >= 0) return true;
    if (WEAK.indexOf(b) >= 0) return false;
    return b.replace(/[^A-Z]/g, '').length >= 8;
  }
  // taille d'un gros sous-titre (Arial Black capitales) pour tenir dans maxW px ; base 108 px
  function capEm(ch) {
    if ('MW'.indexOf(ch) >= 0) return 1.0;
    if (ch === 'I') return 0.39;
    if (' .,:;!\''.indexOf(ch) >= 0) return 0.33;
    if (/[0-9€$]/.test(ch)) return 0.67;
    return 0.8;
  }
  function bigCapSize(word, maxW, base) {
    base = base || 108; maxW = maxW || 900;
    var em = 0; Array.from(String(word || '').toUpperCase()).forEach(function (c) { em += capEm(c); });
    return em ? Math.max(56, Math.min(base, Math.floor(maxW / em))) : base;
  }
  // Coupe les sous-titres pendant la phrase choc : une caption finie avant chocEnd disparaît, une caption à cheval commence à chocEnd.
  function capsAfterChoc(caps, chocEnd) {
    if (!(chocEnd > 0)) return caps.slice();
    return caps.filter(function (c) { return c.e > chocEnd + 0.06; }).map(function (c) { return c.s < chocEnd ? Object.assign({}, c, { s: chocEnd }) : c; });
  }

  return { FORMATS: FORMATS, TEXTES_CHOC: TEXTES_CHOC, COMBO_KEYS: COMBO_KEYS, CANVAS: CANVAS, UI_RESERVED: UI_RESERVED, INSET_AVANT_APRES: INSET_AVANT_APRES,
    resolveFormat: resolveFormat, hasChoc: hasChoc, textChoc: textChoc, chocString: chocString, chocWhy: chocWhy, eligibleFormats: eligibleFormats,
    pickFormat: pickFormat, pickChoc: pickChoc, chocEnd: chocEnd, txOfHook: txOfHook, isAvantApres: isAvantApres, comboFormatCheck: comboFormatCheck,
    mergeFormatMeta: mergeFormatMeta, formatReview: formatReview,
    chocLayout: chocLayout, wrap: wrap, textEm: textEm,
    isStrong: isStrong, bigCapSize: bigCapSize, capsAfterChoc: capsAfterChoc };
});
