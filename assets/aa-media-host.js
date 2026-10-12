/* Médias (vidéos, images, téléchargements de fichiers) servis par le domaine STOCKAGE de Supabase
   (guvwgiejzkiodghywpwj.storage.supabase.co) au lieu du domaine de l'API (guvwgiejzkiodghywpwj.supabase.co).
   12/10 (Axel : « Se connecter » bloqué, « Load failed » sur Creative Factory) : dans Safari, un onglet qui charge beaucoup de
   vidéos / vignettes occupait la connexion au domaine de l'API ; la connexion, les lectures de la base et les fonctions
   d'un autre onglet attendaient derrière, sans jamais partir. Deux domaines = deux connexions séparées : les fichiers lourds
   ne bloquent plus jamais l'authentification ni la base.
   Réécrit uniquement les lectures de fichiers (/storage/v1/object/public|sign/… et /storage/v1/render/…) :
   - attributs src / poster (posés en JS ou par innerHTML : setters + observateur du DOM) ;
   - fetch GET / HEAD (téléchargements, conversions en base64).
   Les envois (upload), la base, l'authentification et les fonctions restent sur le domaine de l'API. */
(function () {
  var API = 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/';
  var STO = 'https://guvwgiejzkiodghywpwj.storage.supabase.co/storage/v1/';
  var RE = /^https:\/\/guvwgiejzkiodghywpwj\.supabase\.co\/storage\/v1\/(object\/(public|sign)\/|render\/)/;
  function mv(u) { return typeof u === 'string' && RE.test(u) ? STO + u.slice(API.length) : u; }
  window.aaMediaUrl = mv;
  function hook(proto, prop) {
    var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set: function (v) { d.set.call(this, mv(v)); } });
  }
  try {
    hook(HTMLMediaElement.prototype, 'src'); hook(HTMLImageElement.prototype, 'src'); hook(HTMLSourceElement.prototype, 'src');
    hook(HTMLVideoElement.prototype, 'poster');
    var sa = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, v) { return sa.call(this, n, (n === 'src' || n === 'poster') ? mv(v) : v); };
  } catch (e) { /* navigateur exotique : on garde le domaine de l'API */ }
  // innerHTML / balises du HTML : attributs déjà posés → corrigés dès l'insertion
  function fix(el) {
    if (!el || el.nodeType !== 1) return;
    ['src', 'poster'].forEach(function (a) { var v = el.getAttribute && el.getAttribute(a); if (v && RE.test(v)) sa.call(el, a, mv(v)); });
    if (el.querySelectorAll) el.querySelectorAll('[src^="' + API + '"],[poster^="' + API + '"]').forEach(function (c) {
      ['src', 'poster'].forEach(function (a) { var v = c.getAttribute(a); if (v && RE.test(v)) sa.call(c, a, mv(v)); });
    });
  }
  try {
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'attributes') fix(m.target); else m.addedNodes.forEach(fix);
      });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'poster'] });
  } catch (e) { /* pas d'observateur : setters seulement */ }
  // téléchargements de fichiers en fetch (GET / HEAD seulement)
  var f0 = window.fetch;
  if (f0) window.fetch = function (input, init) {
    try {
      var m = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (m === 'GET' || m === 'HEAD') {
        if (typeof input === 'string') input = mv(input);
        else if (input && input.url && RE.test(input.url)) input = new Request(mv(input.url), input);
      }
    } catch (e) { /* on laisse passer tel quel */ }
    return f0.call(this, input, init);
  };
})();
