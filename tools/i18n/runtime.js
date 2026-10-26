/* GÉNÉRÉ par tools/gen-i18n-app.mjs (tools/i18n/runtime.js + tools/i18n/app-en.json) — ne pas éditer à la main.
   25/10 (Axel) : l'app anglaise /en/app/ est la MÊME app que /app/ ; ce script, chargé seulement sous /en/ (petit chargeur dans
   le <head> de app/index.html), traduit le texte affiché au fil du DOM : nœuds de texte + attributs lus (placeholder, title,
   aria-label, alt, data-tip, label), boîtes alert/confirm/prompt, dates et nombres. Il ne touche jamais à ce que l'utilisateur
   écrit (champs, zones éditables) ni aux zones marquées data-no-i18n (mots des sous-titres, relus par le code).
   Recherche : texte exact → modèle « a {} b » → morceaux (préfixe/suffixe connu, nombre + mot, découpe sur « — » / « · »). */
(function () {
  'use strict';
  if (location.pathname.indexOf('/en/') !== 0 || window.__aaI18n) return;
  var EXACT = /*EXACT*/{};
  var MODELES = /*MODELES*/[];

  var has = Object.prototype.hasOwnProperty;
  var norm = function (s) { return String(s).replace(/[\s   ]+/g, ' ').trim(); };
  var LETTRE = /[A-Za-zÀ-ÿ]/;
  var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  // modèles → regex ancrées, du plus précis (texte fixe le plus long) au plus vague. Avant la regex, filtre rapide sur le
  // texte sans espaces : il doit commencer par le début fixe du modèle, finir par sa fin fixe et contenir ses mots.
  var sansEsp = function (s) { return s.replace(/ /g, ''); };
  var MOD = MODELES.map(function (m) {
    var parts = m[0].split('{}').map(function (p) { return p.trim(); });
    var src = '^' + parts.map(function (p) { return esc(p).replace(/ /g, '\\s*'); }).join('\\s*(.+?)\\s*') + '$';
    var mots = parts.slice(1, -1).join(' ').split(' ').filter(function (w) { return w.length > 2; }).map(sansEsp);
    return { re: new RegExp(src), en: m[1], n: parts.join('').length, deb: sansEsp(parts[0]), fin: sansEsp(parts[parts.length - 1]), mots: mots };
  }).sort(function (a, b) { return b.n - a.n; });

  function remplir(en, g, d) {
    var i = 0;
    return en.replace(/\{(\d?)\}/g, function (_, n) {
      var v = g[n ? +n - 1 : i++];
      if (v == null) return '';
      if (/^\d+,\d+$/.test(v)) return v.replace(',', '.');   // « 1,67 » → « 1.67 »
      var t = tr(v, d + 1);
      return t != null ? t : v;
    });
  }
  function modele(k, d) {
    var ks = sansEsp(k);
    suivant: for (var i = 0; i < MOD.length; i++) {
      var m = MOD[i];
      if (ks.lastIndexOf(m.deb, 0) !== 0 || (m.fin && ks.slice(-m.fin.length) !== m.fin)) continue;
      for (var j = 0; j < m.mots.length; j++) if (ks.indexOf(m.mots[j]) < 0) continue suivant;
      var g = m.re.exec(k);
      if (g) return remplir(m.en, g.slice(1), d);
    }
    return null;
  }

  var SEP = /[:—–(·,|]/g, NOMBRE = /^[^\sA-Za-zÀ-ÿ]*\d[^\sA-Za-zÀ-ÿ]*$/;
  function morceaux(k, d) {
    var m, t, i, best = -1;
    // « Rendu échoué : » + détail
    SEP.lastIndex = 0;
    while ((m = SEP.exec(k))) if (has.call(EXACT, k.slice(0, m.index + 1).trim())) best = m.index + 1;
    if (best > 0) {
      var reste = k.slice(best), rt = reste.trim();
      t = rt ? tr(rt, d + 1) : '';
      return EXACT[k.slice(0, best).trim()] + (rt ? (/^\s/.test(reste) ? ' ' : '') + (t != null ? t : rt) : '');
    }
    // détail + « — réessaie »
    SEP.lastIndex = 0;
    while ((m = SEP.exec(k))) {
      var fin = k.slice(m.index).trim();
      if (m.index > 0 && has.call(EXACT, fin)) {
        var tete = k.slice(0, m.index), tt = tete.trim();
        t = tr(tt, d + 1);
        return (t != null ? t : tt) + (/\s$/.test(tete) ? ' ' : '') + EXACT[fin];
      }
    }
    // « 12 crédits » / « Étape 2 » / « ✗ non connecté »
    var mots = k.split(' ');
    if (mots.length > 1 && !/[\dA-Za-zÀ-ÿ]/.test(mots[0]) && (t = tr(mots.slice(1).join(' '), d + 1)) != null) return mots[0] + ' ' + t;
    if (mots.length > 1 && NOMBRE.test(mots[0]) && (t = tr(mots.slice(1).join(' '), d + 1)) != null) return mots[0] + ' ' + t;
    if (mots.length > 1 && NOMBRE.test(mots[mots.length - 1]) && (t = tr(mots.slice(0, -1).join(' '), d + 1)) != null) return t + ' ' + mots[mots.length - 1];
    // « A — B » / « A · B » : chaque morceau
    var bouts = k.split(/(\s+[—·]\s+)/);
    if (bouts.length > 1) {
      var change = false;
      for (i = 0; i < bouts.length; i += 2) { t = tr(bouts[i], d + 1); if (t != null) { bouts[i] = t; change = true; } }
      if (change) return bouts.join('');
    }
    return null;
  }

  // prix : « 49,99€ » → « €49.99 », « 1 368€ » → « €1,368 », « 20,83€/mois » → « €20.83/month »
  var PRIX = /^(\d[\d ]*)(?:,(\d+))?\s?€(?:\/(mois|an|jour))?$/, PERIODE = { mois: '/month', an: '/year', jour: '/day' };
  function prix(k) {
    var m = PRIX.exec(k);
    if (!m) return null;
    return '€' + m[1].replace(/ /g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[2] ? '.' + m[2] : '') + (m[3] ? PERIODE[m[3]] : '');
  }

  var cache = new Map();
  function tr(s, d) {
    d = d || 0;
    var k = norm(s);
    if (!k) return null;
    if (k.indexOf('€') >= 0) { var p = prix(k); if (p) return p; }
    if (!LETTRE.test(k)) return null;
    if (has.call(EXACT, k)) return EXACT[k];
    var cle = d + '|' + k;
    if (cache.has(cle)) return cache.get(cle);
    var r = modele(k, d);
    if (r == null && d < 3) r = morceaux(k, d);
    if (cache.size > 8000) cache.clear();
    cache.set(cle, r);
    return r;
  }

  // ── DOM ──
  var SAUTE = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  var TEXTE_NON = { TEXTAREA: 1, CODE: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'data-tooltip', 'label'];
  // idées de prompt animées (18/10) : leur script écrit lui-même le placeholder, en anglais sous /en/
  var SANS_PH = { imgPrompt: 1, expPrompt: 1, mExpPrompt: 1, omniPrompt: 1, mtBrief: 1 };
  var ecrit = new WeakMap(), ecritA = new WeakMap();

  function texteExclu(el, memo) {
    if (memo && memo.has(el)) return memo.get(el);
    var r = false;
    if (!el || el.nodeType !== 1) r = false;
    else if (el.isContentEditable || SAUTE[el.nodeName] || TEXTE_NON[el.nodeName] || el.hasAttribute('data-no-i18n') || el.getAttribute('translate') === 'no') r = true;
    else r = texteExclu(el.parentNode, memo);
    if (memo) memo.set(el, r);
    return r;
  }
  function texte(n) {
    var v = n.nodeValue;
    if (!v || ecrit.get(n) === v) return;
    var t = tr(v);
    if (t == null || t === norm(v)) return;
    var nv = v.match(/^\s*/)[0] + t + v.match(/\s*$/)[0];
    ecrit.set(n, nv);
    n.nodeValue = nv;
  }
  function attr(el, a) {
    if (a === 'placeholder' && SANS_PH[el.id]) return;
    var v = el.getAttribute(a);
    if (!v) return;
    var w = ecritA.get(el);
    if (w && w[a] === v) return;
    var t = tr(v);
    if (t == null || t === norm(v)) return;
    if (!w) ecritA.set(el, (w = {}));
    w[a] = t;
    el.setAttribute(a, t);
  }
  function attrs(el) { for (var i = 0; i < ATTRS.length; i++) if (el.hasAttribute(ATTRS[i])) attr(el, ATTRS[i]); }
  var FILTRE = { acceptNode: function (n) { return n.nodeType === 1 && SAUTE[n.nodeName] ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } };
  function arbre(root) {
    if (root.nodeType === 3) { if (!texteExclu(root.parentNode)) texte(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SAUTE[root.nodeName]) return; attrs(root); }
    var memo = new Map(), w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTRE), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { if (!texteExclu(n.parentNode, memo)) texte(n); }
      else attrs(n);
    }
  }

  var mo = new MutationObserver(function (recs) {
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i], t = r.target;
      if (r.type === 'childList') { for (var j = 0; j < r.addedNodes.length; j++) if (r.addedNodes[j].isConnected) arbre(r.addedNodes[j]); }
      else if (r.type === 'characterData') { if (t.isConnected && !texteExclu(t.parentNode)) texte(t); }
      else if (r.type === 'attributes') attr(t, r.attributeName);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.documentElement.lang = 'en';
  arbre(document.documentElement);
  document.addEventListener('DOMContentLoaded', function () { arbre(document.documentElement); });

  // ── boîtes du navigateur ──
  ['alert', 'confirm', 'prompt'].forEach(function (f) {
    var o = window[f];
    if (typeof o !== 'function') return;
    window[f] = function (msg) {
      var a = [].slice.call(arguments);
      if (typeof msg === 'string') a[0] = msg.split('\n').map(function (l) { var t = tr(l); return t != null ? l.match(/^\s*/)[0] + t : l; }).join('\n');
      return o.apply(window, a);
    };
  });

  // ── dates et nombres : l'app écrit « fr-FR » en dur → anglais (jour/mois, 24 h) ──
  function loc(l) { return typeof l === 'string' && /^fr\b/i.test(l) ? 'en-GB' : Array.isArray(l) ? l.map(loc) : l; }
  [[Date.prototype, ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']], [Number.prototype, ['toLocaleString']]].forEach(function (p) {
    p[1].forEach(function (f) {
      var o = p[0][f];
      p[0][f] = function (l, opt) { return o.call(this, loc(l), opt); };
    });
  });

  window.__aaI18n = { tr: function (s) { var t = tr(s); return t != null ? t : s; } };
})();
