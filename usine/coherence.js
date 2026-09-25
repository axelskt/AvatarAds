/* Creative Factory — RÈGLE DE COHÉRENCE et CAPACITÉ des vidéos finales (source UNIQUE : dashboard factory-v2 ET usine/publish-qc.mjs).
 *
 * VIDÉO FINALE DISTINCTE (décision d'Axel, 25/09 au soir) :
 *   · format court = avatar × hook ;
 *   · format long  = avatar × hook × liaison COMPATIBLE avec ce hook (matrice validée par Axel : usine/hook-liaison.js,
 *     générée par usine/gen-coherence-matrix.mjs ; un hook absent de la matrice n'a droit qu'aux liaisons génériques) ;
 *   · le tout dans 2 MODES DE VOIX comptés séparément :
 *       'axel' = « Audio d'Axel » : son audio enregistré, en lipsync → la brique parlée doit avoir un fichier audio
 *                (meta.media en .wav/.mp3/… ; côté dashboard : b.audio) ;
 *       'omni' = « Voix native Omni » : Omni Flash image→vidéo génère la voix depuis le TEXTE → hook = meta.script sinon
 *                label ; liaison = label.
 *   La DÉMO et le CTA sont tirés AU HASARD : ils ne font JAMAIS une nouvelle vidéo (même avatar + même hook (+ même liaison)
 *   avec seulement une autre démo ou un autre CTA = la même vidéo). Clé d'une vidéo = voix|avatar|hook|liaison (liaison
 *   vide pour le court), cf. videoKey / comboKey ; usine/publish-qc.mjs écrit la voix dans brick_combo.voice.
 *   Exception (règle de production, declineTop) : une publication qui revient dans le Top publications peut être DÉCLINÉE,
 *   même hook (+ même liaison) avec une autre démo ET un autre CTA.
 *
 * CHOIX DE LA DÉMO (pickDemo) : on préfère une démo dont le sujet est dans hook.meta.compatible_subjects (valeurs LITTÉRALES
 * du catalogue) ou n'importe laquelle si le hook est générique ('generique' dans ses sujets) ; sinon n'importe quelle démo,
 * et la vidéo part en REVUE QC (Axel accepte ou refuse à la main). Contrôles QC inchangés : pairLevel, liaisonOk, comboCheck.
 *
 * Bibliothèque = briques au statut 'ready' seulement (une brique 'retired' ou 'flagged' n'entre dans aucun compte) ;
 * hooks comptés sans meta.alias_of (H64 = alias de H63).
 * Chargé tel quel par le navigateur (window.CF_COHERENCE) et par node (import / require). Aucune dépendance.
 */
(function (root, factory) {
  // node : dans un dépôt en "type": "module" ce fichier est un module ES ; on expose donc TOUJOURS l'objet global
  // (import('./coherence.js') puis globalThis.CF_COHERENCE), et module.exports quand il est chargé en CommonJS.
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.CF_COHERENCE = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var VOICES = ['axel', 'omni'];
  var VOICE_LABEL = { axel: 'Audio d’Axel', omni: 'Voix native Omni' };
  var AUDIO_RE = /\.(wav|mp3|m4a|aac|ogg)(?:[?#].*)?$/i;

  function meta(b) { return (b && b.meta && typeof b.meta === 'object') ? b.meta : {}; }
  function ready(b) { return !!b && (b.status == null || b.status === 'ready'); }
  function hookSubjects(h) { var s = meta(h).compatible_subjects; return Array.isArray(s) ? s.map(String) : []; }
  function isGenericHook(h) { return hookSubjects(h).indexOf('generique') >= 0; }
  function isGenericLiaison(l) { return !!l && l.subject === 'generique'; }
  // Module d'une démo : meta.module (static ads = module Image IA) sinon son sujet.
  function demoModule(d) { return String(meta(d).module || (d && d.subject) || ''); }
  function str(x) { return typeof x === 'string' && x.trim() ? x.trim() : ''; }

  // ── modes de voix ──
  // Audio enregistré : b.audio (brique normalisée du dashboard) ou meta.media vers un fichier audio (ligne factory_bricks).
  function hasAudio(b) {
    if (!b) return false;
    if (str(b.audio)) return true;
    var m = str(meta(b).media);
    return !!m && AUDIO_RE.test(m);
  }
  // Texte que dit Omni : hook = meta.script sinon label ; liaison (et le reste) = label.
  function voiceText(b) {
    if (!b) return '';
    return (b.kind === 'hook' ? str(meta(b).script) : '') || str(b.label);
  }
  function voiceOk(b, voice) { return voice === 'omni' ? !!voiceText(b) : voice === 'axel' ? hasAudio(b) : false; }

  // ── paires hook × démo (QC) ──
  function pairLevel(hook, demo) {
    if (!hook || !demo) return 'review';
    if (isGenericHook(hook)) return 'ok';
    return hookSubjects(hook).indexOf(String(demo.subject || '')) >= 0 ? 'ok' : 'review';
  }
  function pairWhy(hook, demo) {
    if (pairLevel(hook, demo) === 'ok') return '';
    var s = hookSubjects(hook);
    return (hook && hook.id || '?') + ' (' + (s.length ? s.join(', ') : 'aucun sujet') + ') ne cite pas le sujet de '
      + (demo && demo.id || '?') + ' (' + (demo && demo.subject || '?') + ')';
  }
  function liaisonOk(liaison, hook, demo) {
    if (!liaison) return true;                              // format court : hook + démo + CTA
    if (isGenericLiaison(liaison)) return true;
    if (pairLevel(hook, demo) !== 'ok') return false;       // paire à revoir : liaison générique seulement
    var mods = meta(liaison).modules;
    return Array.isArray(mods) && mods.indexOf(demoModule(demo)) >= 0;
  }

  // ── matrice hook × liaison (usine/hook-liaison.js) ──
  // matrice passée en paramètre ; undefined = celle chargée globalement (usine/hook-liaison.js) ; null = aucune matrice.
  function matrixOf(matrix) { return matrix && typeof matrix === 'object' ? matrix : matrix === undefined ? (root && root.CF_HOOK_LIAISON) || null : null; }
  function inMatrix(hookId, matrix) { var M = matrixOf(matrix); return !!M && Object.prototype.hasOwnProperty.call(M, hookId) && Array.isArray(M[hookId]); }
  // Liaisons (briques) qui peuvent suivre ce hook : celles de la matrice ; hook absent de la matrice → génériques seulement.
  function liaisonsFor(hook, liaisons, matrix) {
    if (!hook) return [];
    var M = matrixOf(matrix), ids = inMatrix(hook.id, M) ? M[hook.id] : null;
    return (liaisons || []).filter(function (l) { return ids ? ids.indexOf(l.id) >= 0 : isGenericLiaison(l); });
  }
  function liaisonCompatible(liaison, hook, matrix, liaisons) {
    if (!liaison) return true;
    var M = matrixOf(matrix);
    if (inMatrix(hook && hook.id, M)) return M[hook.id].indexOf(liaison.id) >= 0;
    return isGenericLiaison(liaison);
  }

  // Bibliothèque exploitable, depuis les lignes factory_bricks (ou les briques normalisées du dashboard).
  function library(bricks) {
    var L = { avatars: [], hooks: [], liaisons: [], ctas: [], demos: [], aliases: {} };
    (bricks || []).forEach(function (b) {
      if (!b) return;
      if (b.kind === 'hook' && meta(b).alias_of) L.aliases[b.id] = String(meta(b).alias_of);
      if (!ready(b)) return;
      if (b.kind === 'avatar') L.avatars.push(b);
      else if (b.kind === 'hook' && !meta(b).alias_of) L.hooks.push(b);
      else if (b.kind === 'liaison') L.liaisons.push(b);
      else if (b.kind === 'cta') L.ctas.push(b);
      else if (b.kind === 'contenu') L.demos.push(b);
    });
    return L;
  }

  // Clé d'une vidéo finale : voix|avatar|hook|liaison (liaison vide = format court).
  function videoKey(voice, avatar, hook, liaison) {
    return [VOICES.indexOf(voice) >= 0 ? voice : 'axel', avatar, hook, liaison].map(function (x) { return String(x || ''); }).join('|');
  }
  // Clé d'une recette factory_qc au nouveau format (brick_combo) : voix 'axel' par défaut, hook alias → son original.
  // null si la recette n'a ni avatar ni hook (ancien format, texte libre : jamais compté).
  function comboKey(combo, byId) {
    if (!combo || typeof combo !== 'object' || !combo.avatar || !combo.hook) return null;
    var hb = byId && byId[combo.hook], h = hb && meta(hb).alias_of ? String(meta(hb).alias_of) : combo.hook;
    var v = combo.voice == null || combo.voice === '' ? 'axel' : String(combo.voice);   // voix inconnue : clé hors des possibles
    return [v, combo.avatar, h, combo.liaison || ''].map(function (x) { return String(x || ''); }).join('|');
  }
  // Ancienne clé (avatar × hook × démo) : gardée pour les scripts qui la lisent encore ; la capacité ne l'utilise plus.
  function tripleKey(avatar, hook, demo) { return [avatar, hook, demo].map(function (x) { return String(x || ''); }).join('|'); }

  // Capacité de création : vidéos finales possibles par mode de voix (court = avatar × hook, long = avatar × paires
  // hook × liaison compatibles), et ce qu'il en reste une fois retirées celles déjà produites.
  // done = clés videoKey / comboKey déjà rendues (tout statut QC confondu) ; une clé hors des possibles (brique retirée,
  // liaison non validée après ce hook, voix sans audio…) n'est pas décomptée : elle est rendue dans `outside`.
  function capacity(bricks, done, matrix) {
    var L = library(bricks), A = L.avatars.length, M = matrixOf(matrix);
    var av = {}, hk = {}, modes = {}, possible = {}, pairsAll = 0, notInMatrix = [];
    L.avatars.forEach(function (a) { av[a.id] = 1; });
    L.hooks.forEach(function (h) {
      var ls = liaisonsFor(h, L.liaisons, M);
      hk[h.id] = ls;
      pairsAll += ls.length;
      if (!inMatrix(h.id, M)) notInMatrix.push(h.id);
    });
    VOICES.forEach(function (v) {
      var H = 0, P = 0, set = {};
      L.hooks.forEach(function (h) {
        if (!voiceOk(h, v)) return;
        H += 1; set[h.id] = { '': 1 };
        hk[h.id].forEach(function (l) { if (voiceOk(l, v)) { P += 1; set[h.id][l.id] = 1; } });
      });
      possible[v] = set;
      modes[v] = { voice: v, label: VOICE_LABEL[v], hooks: H, pairs: P, short: A * H, long: A * P, total: A * (H + P), done: 0, remaining: 0 };
    });
    var seen = {}, outside = 0;
    (done || []).forEach(function (k) {
      if (!k || seen[k]) return;
      seen[k] = 1;
      var p = String(k).split('|'), v = p[0], s = possible[v], set = s && s[p[2]];
      if (p.length === 4 && av[p[1]] && set && set[p[3]]) modes[v].done += 1; else outside += 1;
    });
    var total = 0, doneN = 0;
    VOICES.forEach(function (v) { var m = modes[v]; m.remaining = Math.max(0, m.total - m.done); total += m.total; doneN += m.done; });
    return { avatars: A, hooks: L.hooks.length, liaisons: L.liaisons.length, demos: L.demos.length, ctas: L.ctas.length,
      genericLiaisons: L.liaisons.filter(isGenericLiaison).length, pairs: pairsAll, matrix: !!M, notInMatrix: notInMatrix,
      modes: modes, voices: VOICES.slice(), total: total, done: doneN, remaining: Math.max(0, total - doneN), outside: outside };
  }

  // Impact d'une brique de plus, en vidéos finales (Briques qui manquent). Estimations aux moyennes de la bibliothèque :
  //   +1 avatar  = Σ voix (hooks + paires hook × liaison) ;
  //   +1 hook    = Σ voix avatars × (1 + liaisons compatibles moyennes par hook) ;
  //   +1 liaison = Σ voix avatars × hooks compatibles moyens par liaison ;
  //   +1 démo / CTA / musique / sous-titres = variété (tirés au hasard) : +0 vidéo.
  function impact(cap) {
    var A = cap.avatars, out = { avatar: 0, hook: 0, liaison: 0, variety: 0, avgLiaisonsPerHook: 0, avgHooksPerLiaison: 0 };
    VOICES.forEach(function (v) {
      var m = cap.modes[v];
      out.avatar += m.hooks + m.pairs;
      out.hook += A * (1 + (m.hooks ? m.pairs / m.hooks : 0));
      out.liaison += A * (cap.liaisons ? m.pairs / cap.liaisons : 0);
    });
    out.avgLiaisonsPerHook = cap.hooks ? cap.pairs / cap.hooks : 0;
    out.avgHooksPerLiaison = cap.liaisons ? cap.pairs / cap.liaisons : 0;
    out.hook = Math.round(out.hook); out.liaison = Math.round(out.liaison);
    return out;
  }

  function pick(list, rand) {
    if (!list.length) return null;
    var r = typeof rand === 'function' ? rand() : Math.random();
    return list[Math.min(list.length - 1, Math.max(0, Math.floor(r * list.length)))];
  }
  // Démo tirée au hasard pour un hook : parmi les démos compatibles (sujet cité, ou hook générique) s'il y en a, sinon
  // parmi toutes → level 'review' (la vidéo ira en revue QC). exclude = IDs à éviter (déclinaison d'un top).
  function pickDemo(hook, demos, rand, exclude) {
    var ex = exclude || [], pool = (demos || []).filter(function (d) { return ready(d) && ex.indexOf(d.id) < 0; });
    var pref = pool.filter(function (d) { return pairLevel(hook, d) === 'ok'; });
    var d = pick(pref.length ? pref : pool, rand);
    return d ? { demo: d, level: pref.length ? 'ok' : 'review', why: pref.length ? '' : pairWhy(hook, d), preferred: pref.length } : null;
  }
  function pickCta(ctas, rand, exclude) {
    var ex = exclude || [], pool = (ctas || []).filter(function (c) { return ready(c) && ex.indexOf(c.id) < 0; });
    return pick(pool, rand);
  }

  // Déclinaison d'une publication du Top : MÊME voix, même avatar, même hook (+ même liaison), avec une AUTRE démo et un
  // AUTRE CTA (seule exception à « démo et CTA ne font pas une nouvelle vidéo »). Renvoie la nouvelle recette + son niveau
  // de cohérence (la démo reste choisie par pickDemo), ou { combo: null, reasons } si la bibliothèque ne le permet pas.
  function declineTop(combo, bricks, opts) {
    opts = opts || {};
    var L = library(bricks), byId = {}, reasons = [];
    (bricks || []).forEach(function (b) { if (b) byId[b.id] = b; });
    var c = combo || {}, hid = c.hook && byId[c.hook] && meta(byId[c.hook]).alias_of ? String(meta(byId[c.hook]).alias_of) : c.hook;
    var hook = hid ? byId[hid] : null;
    if (!hook || !ready(hook)) reasons.push('hook ' + (c.hook || '?') + ' absent de la bibliothèque');
    var d = hook ? pickDemo(hook, L.demos, opts.rand, c.contenu ? [c.contenu] : []) : null;
    if (hook && !d) reasons.push('aucune autre démo prête');
    var cta = pickCta(L.ctas, opts.rand, c.cta ? [c.cta] : []);
    if (!cta) reasons.push('aucun autre CTA prêt');
    if (reasons.length) return { combo: null, level: null, reasons: reasons };
    var out = { voice: c.voice === 'omni' ? 'omni' : 'axel', avatar: c.avatar, hook: hid, contenu: d.demo.id, cta: cta.id, declined_from: opts.from || null };
    if (c.liaison) out.liaison = c.liaison;
    ['musique', 'sous_titre'].forEach(function (k) { if (c[k]) out[k] = c[k]; });
    return { combo: out, level: d.level, reasons: d.level === 'ok' ? [] : ['cohérence à vérifier : ' + d.why], key: comboKey(out, byId) };
  }

  // Contrôle d'une recette avant QC (usine/publish-qc.mjs). combo = { voice?, avatar, hook, liaison?, contenu, cta } (IDs) ;
  // byId = factory_bricks indexées par id ; matrix (facultatif) = usine/hook-liaison.js. level 'ok' | 'review' ;
  // reasons = pourquoi la vidéo va en revue manuelle.
  function comboCheck(combo, byId, matrix) {
    combo = combo || {}; byId = byId || {};
    var get = function (k) { return combo[k] ? byId[combo[k]] : null; };
    var hook = get('hook'), demo = get('contenu'), liaison = get('liaison'), reasons = [];
    ['hook', 'contenu'].forEach(function (k) {
      if (!combo[k]) reasons.push('recette sans ' + (k === 'contenu' ? 'démo' : k));
      else if (!byId[combo[k]]) reasons.push(combo[k] + ' introuvable dans la bibliothèque');
      else if (!ready(byId[combo[k]])) reasons.push(combo[k] + ' n’est pas prête (statut ' + byId[combo[k]].status + ')');
    });
    if (combo.liaison && !liaison) reasons.push(combo.liaison + ' introuvable dans la bibliothèque');
    if (hook && demo) {
      if (pairLevel(hook, demo) !== 'ok') reasons.push('cohérence à vérifier : ' + pairWhy(hook, demo));
      if (liaison && !liaisonOk(liaison, hook, demo)) reasons.push('liaison ' + liaison.id + ' non générique sur une paire à revoir');
    }
    var M = matrixOf(matrix);
    if (M && hook && liaison) {
      var h = meta(hook).alias_of && byId[meta(hook).alias_of] ? byId[meta(hook).alias_of] : hook;
      if (!liaisonCompatible(liaison, h, M)) reasons.push('liaison ' + liaison.id + ' non validée après ' + h.id + ' (matrice hook × liaison)');
    }
    return { level: reasons.length ? 'review' : 'ok', reasons: reasons, hook: hook, demo: demo, liaison: liaison };
  }

  return { VOICES: VOICES, VOICE_LABEL: VOICE_LABEL,
    pairLevel: pairLevel, pairWhy: pairWhy, liaisonOk: liaisonOk, library: library, capacity: capacity, impact: impact, comboCheck: comboCheck,
    liaisonsFor: liaisonsFor, liaisonCompatible: liaisonCompatible, inMatrix: inMatrix, hasAudio: hasAudio, voiceText: voiceText, voiceOk: voiceOk,
    videoKey: videoKey, comboKey: comboKey, tripleKey: tripleKey, pickDemo: pickDemo, pickCta: pickCta, declineTop: declineTop,
    hookSubjects: hookSubjects, isGenericHook: isGenericHook, isGenericLiaison: isGenericLiaison, demoModule: demoModule };
});
