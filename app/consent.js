/* Mesure d'audience (Microsoft Clarity, projet wt9womnpnq) — chargeur partagé site + app.
   Axel 04/10 : PAS de bandeau. Clarity se charge comme avant ; un visiteur peut le refuser depuis /confidentialite.html
   (section 5 : window.AAConsent.set('denied'|'granted'), choix gardé 6 mois dans le stockage local, clé aa_consent).
   Audit 04/10 (SITE-02) : Clarity attend que l'URL ne porte plus de jeton (retour de connexion Google
   /app/#access_token=… : supabase-js n'efface le fragment qu'après son aller-retour réseau). Rien n'est chargé tant que
   le jeton est dans l'URL ; au-delà de 60 s, pas de Clarity pour cette page.
   Attributs de la balise <script> : data-clarity="off" = page qui ne charge jamais Clarity (confidentialité) ;
   data-lazy="1" = Clarity chargé après le rendu (load + idle) pour ne pas peser sur le LCP (LP).
   Audit 04/10 (relecture) : sans choix enregistré, AUCUN signal de consentement n'est envoyé à Clarity (comportement de
   HEAD) : pour les visiteurs EEE / Royaume-Uni / Suisse, Clarity fonctionne alors sans cookie (_clck/_clsk) ni suivi d'une
   session à l'autre. consentv2 « analytics granted » n'est envoyé qu'après un « Accepter » explicite.
   Événements : 'aa-consent' (detail.choice) à chaque choix, 'aa-clarity' quand Clarity est chargé. */
(function () {
  'use strict';
  var KEY = 'aa_consent', TTL = 183 * 864e5, CLARITY_ID = 'wt9womnpnq';
  var me = document.currentScript;
  var noClarity = !!(me && me.getAttribute('data-clarity') === 'off');
  var lazy = !!(me && me.getAttribute('data-lazy') === '1');
  var loaded = false;

  function lire() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && (o.a === 'granted' || o.a === 'denied') && o.t > 0 && Date.now() - o.t < TTL) return o.a;
    } catch (e) { /* stockage indisponible : pas de choix connu, donc pas de traceur */ }
    return null;
  }
  function ecrire(a) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, a: a, t: Date.now() })); } catch (e) { /* choix valable pour cette page seulement */ }
  }
  // Jetons d'authentification dans l'URL (fragment implicite Supabase/Google) : Clarity relève l'URL à son démarrage.
  function urlSensible() {
    return /(?:^|[#&?])(access_token|refresh_token|provider_token|provider_refresh_token)=/.test(String(location.hash || '') + '&' + String(location.search || ''));
  }
  function injecter() {
    if (loaded || noClarity) return;
    loaded = true;
    (function (c, l, a, r, i, t, y) { c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); }; t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i; y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(window, document, 'clarity', 'script', CLARITY_ID);
    // Audit 04/10 (relecture) : jamais de consentement déclaré à la place du visiteur — « granted » seulement s'il a accepté.
    if (lire() === 'granted') signalerAccord();
    try { window.dispatchEvent(new Event('aa-clarity')); } catch (e) { /* navigateur ancien */ }
  }
  function signalerAccord() {
    try { window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }); } catch (e) { /* API absente : sans effet */ }
  }
  function chargerClarity() {
    if (loaded || noClarity) return;
    var essais = 0;
    var tenter = function () {
      if (loaded || lire() === 'denied') return;
      if (urlSensible()) { if (++essais <= 120) setTimeout(tenter, 500); return; }
      injecter();
    };
    if (lazy) {
      var idle = function () { (window.requestIdleCallback || function (f) { setTimeout(f, 1); })(tenter); };
      if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle);
    } else tenter();
  }
  // Retrait du consentement : Clarity coupe ses cookies s'il est chargé, et on efface ses cookies du domaine.
  function couperClarity() {
    try { if (typeof window.clarity === 'function') { window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }); window.clarity('consent', false); } } catch (e) { /* rien à couper */ }
    try {
      var h = location.hostname, doms = ['', h, '.' + h.replace(/^www\./, '')];
      ['_clck', '_clsk', '_cltk'].forEach(function (n) {
        doms.forEach(function (d) { document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : ''); });
      });
    } catch (e) { /* cookies inaccessibles */ }
  }

  function choisir(a) {
    a = a === 'granted' ? 'granted' : 'denied';
    var avant = lire();
    ecrire(a);
    // Audit 04/10 (relecture) : Clarity déjà chargé par défaut → l'accord lui est signalé tout de suite (cookies autorisés).
    if (a === 'granted') { if (loaded) signalerAccord(); else chargerClarity(); }
    // Refus depuis l'état par défaut (aucun choix) : on coupe aussi, et on efface les cookies posés avant (ex. sur une page
    // sans signal, ou avant cette version) — y compris sur confidentialite.html, où Clarity n'est jamais chargé.
    else if (avant !== 'denied' || loaded) couperClarity();
    try { document.dispatchEvent(new CustomEvent('aa-consent', { detail: { choice: a } })); } catch (e) { /* navigateur ancien */ }
  }

  window.AAConsent = {
    get: lire,
    set: choisir
  };

  if (lire() !== 'denied') chargerClarity();   // pas de bandeau : chargé par défaut, sauf refus enregistré
})();
