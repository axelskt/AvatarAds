/* Creative Factory — RÈGLE DE COHÉRENCE des vidéos finales (source UNIQUE : dashboard factory-v2 ET usine/publish-qc.mjs).
 *
 * Décision d'Axel (25/09) : une démo doit pouvoir passer avec CHAQUE hook, au besoin par une liaison générique. Ce que les
 * tags ne garantissent pas n'est jamais écarté : la vidéo part en REVUE QC et Axel l'accepte ou la refuse à la main.
 *   · 'ok'     : le sujet de la démo est dans hook.meta.compatible_subjects (valeurs LITTÉRALES du catalogue), ou le hook est
 *                générique ('generique' dans ses sujets). Liaisons possibles : génériques + celles dont meta.modules couvre
 *                le module de la démo.
 *   · 'review' : sinon. Liaison GÉNÉRIQUE seulement (subject 'generique') ou aucune ; la vidéo va en revue manuelle au QC.
 * Vidéo DISTINCTE = avatar × hook × démo. Liaison, CTA, musique et sous-titres tournent pour la variété mais ne font pas
 * une nouvelle vidéo (anti-doublon, plan §3.5 : même hook + même avatar = quasi-clone).
 * Hooks comptés = kind 'hook', status 'ready', sans meta.alias_of (H64 = alias de H63).
 * Chargé tel quel par le navigateur (window.CF_COHERENCE) et par node (require). Aucune dépendance.
 */
(function (root, factory) {
  // node : le dépôt est en "type": "module" → ce fichier y est un module ES ; on expose donc TOUJOURS l'objet global
  // (import('./coherence.js') puis globalThis.CF_COHERENCE), et module.exports quand il est chargé en CommonJS.
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.CF_COHERENCE = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function meta(b) { return (b && b.meta && typeof b.meta === 'object') ? b.meta : {}; }
  function ready(b) { return !!b && (b.status == null || b.status === 'ready'); }
  function hookSubjects(h) { var s = meta(h).compatible_subjects; return Array.isArray(s) ? s.map(String) : []; }
  function isGenericHook(h) { return hookSubjects(h).indexOf('generique') >= 0; }
  function isGenericLiaison(l) { return !!l && l.subject === 'generique'; }
  // Module d'une démo : meta.module (static ads = module Image IA) sinon son sujet.
  function demoModule(d) { return String(meta(d).module || (d && d.subject) || ''); }

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

  // Bibliothèque exploitable, depuis les lignes factory_bricks.
  function library(bricks) {
    var L = { avatars: [], hooks: [], liaisons: [], ctas: [], demos: [] };
    (bricks || []).forEach(function (b) {
      if (!ready(b)) return;
      if (b.kind === 'avatar') L.avatars.push(b);
      else if (b.kind === 'hook' && !meta(b).alias_of) L.hooks.push(b);
      else if (b.kind === 'liaison') L.liaisons.push(b);
      else if (b.kind === 'cta') L.ctas.push(b);
      else if (b.kind === 'contenu') L.demos.push(b);
    });
    return L;
  }
  function tripleKey(avatar, hook, demo) { return [avatar, hook, demo].map(function (x) { return String(x || ''); }).join('|'); }

  // Capacité : vidéos distinctes possibles (avatar × hook × démo), cohérentes d'office vs à revoir au QC, et ce qu'il en
  // reste une fois retirées celles déjà produites (`done` = clés tripleKey déjà rendues, tout statut QC confondu).
  function capacity(bricks, done) {
    var L = library(bricks), A = L.avatars.length, ok = 0, review = 0, bySubject = {};
    L.hooks.forEach(function (h) {
      L.demos.forEach(function (d) {
        var lv = pairLevel(h, d);
        if (lv === 'ok') ok++; else review++;
        var k = String(d.subject || '?'); bySubject[k] = bySubject[k] || { demos: 0, ok: 0, review: 0 };
        bySubject[k][lv]++;
      });
    });
    L.demos.forEach(function (d) { var k = String(d.subject || '?'); bySubject[k] = bySubject[k] || { demos: 0, ok: 0, review: 0 }; bySubject[k].demos++; });
    var doneSet = {}, doneN = 0;
    (done || []).forEach(function (k) { if (k && !doneSet[k]) { doneSet[k] = 1; doneN++; } });
    var total = A * L.hooks.length * L.demos.length;
    return { avatars: A, hooks: L.hooks.length, demos: L.demos.length, liaisons: L.liaisons.length, ctas: L.ctas.length,
      genericLiaisons: L.liaisons.filter(isGenericLiaison).length,
      pairs: ok + review, pairsOk: ok, pairsReview: review,
      total: total, ok: A * ok, review: A * review, done: Math.min(doneN, total), remaining: Math.max(0, total - doneN),
      bySubject: bySubject };
  }

  // Contrôle d'une recette avant QC (usine/publish-qc.mjs). combo = { avatar, hook, liaison?, contenu, cta } (IDs) ;
  // byId = factory_bricks indexées par id. level 'ok' | 'review' ; reasons = pourquoi la vidéo va en revue manuelle.
  function comboCheck(combo, byId) {
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
    return { level: reasons.length ? 'review' : 'ok', reasons: reasons, hook: hook, demo: demo, liaison: liaison };
  }

  return { pairLevel: pairLevel, pairWhy: pairWhy, liaisonOk: liaisonOk, library: library, capacity: capacity, comboCheck: comboCheck,
    tripleKey: tripleKey, hookSubjects: hookSubjects, isGenericHook: isGenericHook, isGenericLiaison: isGenericLiaison, demoModule: demoModule };
});
