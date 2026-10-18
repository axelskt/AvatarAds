/*
 * Creative Factory v2 · cf-ui.js · étapes 0 à 4 du plan (Auto-DM, Accueil et Production : Axel 25/09)
 * Rendu seulement : lit window.CF (cf-store.js), se redessine sur « cf-data ». Aucun chiffre calculé ailleurs.
 * Règles d'affichage : « 0 » = mesuré et nul · « — » + raison courte = pas de source · jamais additionner
 * reach ni comptes engagés · tout texte venu d'Instagram passe par esc() · aucun emoji (icônes SVG).
 * Clés localStorage : « cf-dashboard-tab » (onglet actif), « cf_net ».
 * 16/10 : onglet BloxAI (ex-TrackAds, clé interne 'trackads' gardée pour l'onglet mémorisé) = stock commun, missions,
 * diffuseurs, vérifications, pièces d'identité et versements, lus dans CF.bx ; tout texte venu de BloxAI passe par esc().
 */
(function () {
  'use strict';

  var CF = window.CF;
  var $ = function (id) { return document.getElementById(id); };
  if (!CF) {
    var bm = $('cfBootMsg');
    if (bm) bm.textContent = 'Erreur de chargement : cf-store.js absent. Recharge la page.';
    return;
  }

  // ── échappement et URL sûres ──
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 18/10 (round 7, R7-10) : nom (diffuseur, compte, titulaire…) écrit dans une fenêtre window.prompt / window.confirm —
  // tout espace ou caractère de contrôle (C0, C1, U+00A0, U+2028, U+2029, et les marques d'écriture bidirectionnelle ou
  // invisibles) → une espace, espaces multiples réduits, bords coupés, 40 caractères au plus (le Nom choisi : même
  // nettoyage que bx_user_name de BloxAI ; max = 120 pour un nom légal ou un titulaire, jamais tronqué en dessous) :
  // un nom ne peut ni écrire de fausses lignes (« ATTENTION … ») ni retourner le texte d'une fenêtre de décision
  function dlgName(s, max) {
    return String(s == null ? '' : s).replace(/[\s\u0000-\u001f\u007f-\u009f\u00a0\u2028\u2029\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]+/g, ' ')
      .replace(/^ +| +$/g, '').slice(0, max || 40).replace(/ +$/, '');
  }
  function safeUrl(u, hostRe) {
    if (typeof u !== 'string' || !u) return '';
    try {
      var x = new URL(u);
      if (x.protocol !== 'https:') return '';
      if (hostRe && !hostRe.test(x.hostname)) return '';
      return x.href;
    } catch (e) { return ''; }
  }
  var IG_HOST = /(^|\.)instagram\.com$/i;
  // Médias de la Production : seulement notre stockage Supabase (CSP media-src), déjà filtrés par le store, revérifiés ici.
  var SB_HOST = /^guvwgiejzkiodghywpwj\.supabase\.co$/;
  function mediaSrc(u) { return safeUrl(u, SB_HOST); }
  // Vignette d'une image de NOTRE stockage (photos d'avatar ≈ 8 Mo en 4K) : transformation d'image Supabase (render/image) ;
  // carrée (w × w, recadrée) ou entière (w de large, proportions gardées : hauteur 2w en « contain » — sans hauteur, Supabase
  // garde la hauteur d'origine). Si elle échoue, l'image d'origine (data-full, écouteur 'error' plus bas)
  var PUB_P = '/storage/v1/object/public/', REND_P = '/storage/v1/render/image/public/';
  // 07/10 : miniature JPEG déjà rangée dans le stockage (photo d'avatar → meta.thumbs) : prise telle quelle, sans render/image
  var THUMB_OF = Object.create(null);
  function noteThumbs(b) {
    var im = b && b.meta && b.meta.images || [], th = b && b.meta && b.meta.thumbs || [];
    im.forEach(function (u, i) { var t = mediaSrc(th[i]); if (t && mediaSrc(u)) THUMB_OF[mediaSrc(u)] = t; });
  }
  function thumbSrc(u, w, sq) {
    u = mediaSrc(u);
    if (u && THUMB_OF[u]) return THUMB_OF[u];
    if (!u || u.indexOf(PUB_P) < 0 || !/\.(png|jpe?g|webp)$/i.test(u.split(/[?#]/)[0])) return u;
    return u.split(/[?#]/)[0].replace(PUB_P, REND_P) + '?width=' + w + '&height=' + (sq ? w : 2 * w) + '&resize=' + (sq ? 'cover' : 'contain') + '&quality=75';
  }
  function thumbImg(u, w, attrs, sq) {
    var t = thumbSrc(u, w, sq), f = mediaSrc(u);
    return '<img src="' + esc(t) + '"' + (t !== f ? ' data-full="' + esc(f) + '"' : '') + ' ' + (attrs || '') + '>';
  }

  // ── formats (fr-FR, espace insécable avant les unités) ──
  var NB = '\u00a0';
  function fInt(n) { return n == null ? null : Math.round(n).toLocaleString('fr-FR'); }
  function fDec(n, d) { return n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fPct(a, b) { return a == null || b == null || !b ? null : fDec(a / b * 100, 1) + NB + '%'; }
  function fSec(s) { return s == null ? null : fDec(s, 1) + NB + 's'; }
  var MINUS = '\u2212';
  function fDur(s) {
    if (s == null) return null;
    var m = Math.round(s / 60);
    return s < 60 ? Math.round(s) + NB + 's' : m < 60 ? m + NB + 'min' : Math.floor(m / 60) + NB + 'h' + NB + p2(m % 60) + NB + 'min';
  }
  function fSigned(n) { return n > 0 ? '+' + fInt(n) : n < 0 ? MINUS + fInt(-n) : '0'; }
  function p2(n) { return String(n).padStart(2, '0'); }
  function dmy(d) { return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function dm(d) { return p2(d.getDate()) + '/' + p2(d.getMonth() + 1); }
  function hm(d) { return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function plural(n, s, p) { return n != null && Math.abs(n) >= 2 ? (p || s + 's') : s; }
  function validDate(s) { if (!s) return null; var d = new Date(s); return isNaN(d.getTime()) ? null : d; }
  function longDate(d) {
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ── icônes (trait 2, bouts arrondis) ──
  var IC = {
    follow: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    reach: 'M22 12h-4l-3 9L9 3l-3 9H2',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    refresh: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
    alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    chart: 'M3 3v18h18M7 15l4-4 3 3 6-7',
    play: 'M6 4l14 8-14 8z',
    chevron: 'M9 6l6 6-6 6',
    external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
    puzzle: 'M4 4h6v3a2 2 0 1 0 4 0V4h6v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4z',
    cal: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
    chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    skip: 'M13 19l9-7-9-7zM2 19l9-7-9-7z',
    save: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
    click: 'M9 9l5 12 1.8-5.2L21 14zM7.2 2.2 8 5.1M5.1 8l-2.9-.8M14 4.1 12 6.2M6.2 12l-2.1 2',
    userOk: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11l2 2 4-4',
    pct: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    down: 'M12 5v14M19 12l-7 7-7-7',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    check: 'M5 12l5 5L20 7',
    layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    insta: 'M3 3h18v18H3zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01',
    // Production (étape 4)
    qc: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11M9 11l3 3L22 4',
    zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
    video: 'M23 7l-7 5 7 5zM1 5h15v14H1z',
    cursor: 'M3 3l7.07 17 2.51-7.39L20 10.07z',
    music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    captions: 'M3 5h18v14H3zM7 15h4M13 15h4M7 11h10',
    swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
    mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
    film: 'M4 3h16v18H4zM8 3v18M16 3v18M4 8h4M4 16h4M16 8h4M16 16h4',
    wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',   // pipeline (maquette)
    reel: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM7 3v18M17 3v18M3 12h18',
    // tuiles de la Bibliothèque : pictogrammes de la maquette (LIB_IC), à part pour ne pas changer les autres usages
    demo: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 8l6 4-6 4z',
    ctaPtr: 'M9 9l5 12 1.8-5.2L21 14 9 9z',
    subs: 'M3 5h18v14H3zM7 13h4M13 13h4M7 16h10',
    swap2: 'M4 7h13l-3-3M20 17H7l3 3',
    tiktok: 'M9 12a4 4 0 1 0 4 4V4c.5 2.5 2.5 4 5 4'   // Audit 02/10 : comptes TikTok (même tracé que la tuile Réseaux)
  };
  function svg(path, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + path + '"/></svg>';
  }
  var IG_GLYPH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';

  // ── une seule table des périodes ──
  var PERIODS = [
    { k: '3j', label: '3' + NB + 'j', per: 'sur 3' + NB + 'j', evo: '3' + NB + 'j' },   // remplace 24 h : Instagram met ~48 h à tout compter
    { k: '7j', label: '7' + NB + 'j', per: 'sur 7' + NB + 'j', evo: '7' + NB + 'j' },
    { k: '30j', label: '30' + NB + 'j', per: 'sur 30' + NB + 'j', evo: '30' + NB + 'j' },
    { k: '90j', label: '90' + NB + 'j', per: 'sur 90' + NB + 'j', evo: '90' + NB + 'j' },
    { k: '6m', label: '6' + NB + 'mois', per: 'sur 6' + NB + 'mois', evo: '6' + NB + 'mois' },
    { k: 'all', label: 'All time', per: 'depuis la 1re publication', evo: 'all time' }
  ];
  var PERIOD = {};
  PERIODS.forEach(function (p) { PERIOD[p.k] = p; });
  var LONG = { '90j': true, '6m': true, 'all': true };
  // Objectifs d'Axel (24/09) : 5 reels par jour, et sur CHAQUE reel swipe < 3 s ≤ 30 %, like ≥ 5 %, save ≥ 5 %,
  // share ≥ 1 % (rapportés aux vues). Les cartes montrent la moyenne des reels de la période, chaque reel compte pareil.
  var GOALS = [
    { k: 'perDay', label: 'Reels par jour', ic: 'cal', target: 5 },
    // visionnage : objectif = part de la vidéo regardée (40 % : 12 s sur une vidéo de 30 s)
    { k: 'watch', label: 'Visionnage moyen', ic: 'clock', target: 40, sec: true, f: 'avgWatchS', of: ' de la vidéo' },
    { k: 'skip', label: 'Swipe < 3' + NB + 's', ic: 'skip', target: 30, max: true, pct: true, f: 'skipRate' },
    { k: 'like', label: 'Like rate', ic: 'heart', target: 5, pct: true, f: 'likes', u: ['like', 'likes'] },
    { k: 'comment', label: 'Comment rate', ic: 'chat', target: 5, pct: true, f: 'comments', u: ['comm.', 'comm.'] },
    { k: 'save', label: 'Save rate', ic: 'save', target: 5, pct: true, f: 'saved', u: ['save', 'saves'] },
    { k: 'share', label: 'Share rate', ic: 'send', target: 1, pct: true, f: 'shares', u: ['share', 'shares'] }
  ];
  var GOAL = {};
  GOALS.forEach(function (g) { GOAL[g.k] = g; });
  // Taux d'un reel pour un objectif (en %), null si la donnée manque.
  function rateOf(p, g) {
    if (g.k === 'skip') return p.skipRate != null ? p.skipRate : null;
    if (g.k === 'watch') return p.avgWatchS != null ? p.avgWatchS : null;   // secondes (la cible, elle, porte sur retentionOf)
    var v = p[g.f];
    return v != null && p.views ? v / p.views * 100 : null;
  }
  // Part de la vidéo regardée (%), si la durée est connue.
  function retentionOf(p) { return p.avgWatchS != null && p.durationS ? p.avgWatchS / p.durationS * 100 : null; }
  // Valeur d'un reel comparée à la cible : taux (%) ou, pour le visionnage, part de la vidéo regardée.
  function scoreOf(p, g) { return g.k === 'watch' ? retentionOf(p) : rateOf(p, g); }
  function goalOk(g, v) { return v != null && g.target != null && (g.max ? v <= g.target : v >= g.target); }
  function fSec0(s) { return Math.round(s) + NB + 's'; }
  // Durée moyenne des reels qui ont un visionnage moyen ET une durée connue (mesurée à la transcription).
  function meanDur(R) {
    var d = R.filter(function (p) { return p.avgWatchS != null && p.durationS; }).map(function (p) { return p.durationS; });
    return d.length ? d.reduce(function (a, b) { return a + b; }, 0) / d.length : null;
  }
  function goalTxt(g) { return g.target == null ? 'objectif à définir' : 'objectif ' + (g.max ? '≤ ' : '≥ ') + g.target + NB + '%' + (g.of || ''); }
  function fRate(v) { return v == null ? null : fDec(v, v < 10 ? 1 : 0) + NB + '%'; }   // > 30 jours : sommes des jours, pas de comptes uniques

  // ── métriques de l'onglet Compte : une couleur par métrique (maquette), la même pour la carte, la courbe et la légende ──
  var SER = [
    { k: 'followers', label: 'Abonnés', c: 'var(--cf-c-followers)', ic: IC.follow },
    { k: 'posts', label: 'Publications', c: 'var(--cf-c-posts)', ic: IC.grid },
    { k: 'engaged', label: 'Comptes engagés', c: 'var(--cf-c-engaged)', ic: IC.users, hero: true },
    { k: 'reach', label: 'Reach', c: 'var(--cf-c-reach)', ic: IC.reach },
    { k: 'views', label: 'Vues', c: 'var(--cf-c-views)', ic: IC.eye },
    { k: 'inter', label: 'Interactions', c: 'var(--cf-c-inter)', ic: IC.heart },
    { k: 'pviews', label: 'Vues de profil', c: 'var(--cf-c-pviews)', ic: IC.user },
    { k: 'clicks', label: 'Clics lien en bio', c: 'var(--cf-c-clicks)', ic: IC.link }
  ];
  var SERC = {};
  SER.forEach(function (s) { SERC[s.k] = s.c; });
  var EVO_KEYS = ['followers', 'posts', 'engaged', 'reach', 'views', 'inter', 'pviews', 'clicks'];
  var UNIQUE = { reach: true, engaged: true };   // comptes uniques : jamais additionnés (pas de cumul)

  // Jours Instagram = jours calendaires à l'heure du Pacifique (les mêmes que ceux d'ig-insights).
  var PT_FMT = (function () {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }); } catch (e) { return null; }
  })();
  function ptDay(ms) { return PT_FMT ? PT_FMT.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10); }
  function ymdDate(s) { return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12); }
  function nDays(a, b) { return Math.round((ymdDate(b) - ymdDate(a)) / 864e5) + 1; }
  function fK(v) { return v >= 1e6 ? (v / 1e6) + NB + 'M' : v >= 1e3 ? (v / 1e3) + 'k' : String(v); }
  function fShare(pct) { return (pct > 0 && pct < 0.05 ? '<' + NB + '0,1' : fDec(pct, pct < 10 && pct > 0 ? 1 : 0)) + NB + '%'; }

  // ── onglets ──
  var TAB_KEYS = ['home', 'prod', 'trackads', 'dm', 'compte'];
  var TAB_STORE = 'cf-dashboard-tab';
  // Accueil : UNE période pour tous ses chiffres, la période par défaut des onglets Insight et Auto-DM (30 j).
  var HOME_RANGE = '30j', HOME_DM = '30j';
  var SOON = {
    trackads: { h: 'BloxAI', step: 5,
      what: 'L’onglet BloxAI n’a pas pu être affiché. Il affiche « — » tant que BloxAI ne répond pas, jamais de chiffre inventé.' }
  };
  function readTab() {
    try { var t = localStorage.getItem(TAB_STORE); return TAB_KEYS.indexOf(t) >= 0 ? t : 'home'; } catch (e) { return 'home'; }
  }
  function saveTab(t) { try { localStorage.setItem(TAB_STORE, t); } catch (e) { /* navigation privée : sans importance */ } }

  // ── état d'interface (pas de données ici) ──
  var ui = { tab: readTab(), range: '30j', modal: null, lastFocus: null, recon: null, tkRecon: null, lastStatus: null, evoHidden: {}, allPosts: false, tagMsg: null, prefetched: false,
    // Auto-DM : période, séries masquées, filtre / recherche des leads, listes dépliées
    dmRange: '30j', dmHidden: {}, dmFilter: 'all', dmQuery: '', dmAllLeads: false, dmAllPosts: false,
    // Production : liste QC dépliée, types des sélecteurs, onglet interne des briques, recherche, écritures « Classer » en cours
    prodList: null, perfKind: 'hook', perfKindLow: 'hook', freshKind: 'hook', brTab: 'lib', libKind: null, libQuery: '', recFilter: 'all', recAll: false, qcBusy: {}, qcMsg: null,
    // Pipeline (Fabrication) : étape ouverte ('gen' | 'ready'), tuile / avatar / module choisis, période de la courbe des montages
    pipeStage: null, pipeVar: null, pipeAv: null, pipeMod: null, pipePer: '7j',
    // BloxAI (16/10, ex-TrackAds) : tri du classement, listes dépliées, actions en cours (clé → 1), dernier message
    bx: { sort: 'fiab', allRank: false, allCheck: false, busy: {}, msg: null,
      // 18/10 (round 7, R7-16) : aperçus des pièces de l'Accueil (id → { state, url, kind, at, error }) et dernières décisions
      // (image détruite ou non, selon la réponse réelle de BloxAI)
      idPrev: {}, idDone: [] } };

  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function setHTML(el, html) { if (el && el._cfHtml !== html) { el.innerHTML = html; el._cfHtml = html; } }

  // ── état Instagram (pastille de l'en-tête + carte compte) ──
  function tokenInfo(prim) {
    var d = prim && validDate(prim.token_expires_at);
    if (!d) return null;
    var ms = d.getTime() - Date.now();
    return { date: d, expired: ms <= 0, days: Math.max(0, Math.floor(ms / 864e5)) };
  }
  // Fenêtre Instagram de référence : celle de l'onglet Insight, ou 30 j sur l'Accueil (période par défaut des onglets).
  function igRangeNow() { return ui.tab === 'home' ? HOME_RANGE : ui.range; }
  function igData(range) {
    var s = CF.acct.ig[range || igRangeNow()];
    if (s && s.data) return s.data;
    for (var i = 0; i < CF.IG_RANGES.length; i++) { var x = CF.acct.ig[CF.IG_RANGES[i]]; if (x && x.data) return x.data; }
    return null;
  }
  function igState(range) {
    var A = CF.acct.accounts, S = CF.acct.ig[range || igRangeNow()], D = igData(range), prim = A.primary;
    var u = '@' + ((prim && prim.username) || (D && D.username) || CF.PRIMARY_USERNAME);
    var tok = tokenInfo(prim);
    if (S.kind === 'disconnected') return { tone: 'err', pill: 'Instagram déconnecté', line: 'déconnecté · aucun token lisible par ig-insights' };
    if (tok && tok.expired) return { tone: 'err', pill: u + ' · token expiré', line: 'token expiré le ' + dmy(tok.date) };
    if (D && D.basicError) return { tone: 'err', pill: u + ' · lecture refusée', line: 'Instagram refuse la lecture du profil' };
    if (!D) {
      if (A.state === 'ready' && !prim) return { tone: 'err', pill: 'Instagram déconnecté', line: 'aucun compte @' + selName() + ' relié' };
      if (A.state === 'error') return { tone: 'mute', pill: 'Instagram · —', line: 'comptes indisponibles' };
      if (A.state === 'idle') return { tone: 'mute', pill: 'Instagram…', line: 'chargement' };
    }
    if (tok && tok.days < 7) return { tone: 'warn', pill: u + ' · token ' + tok.days + NB + 'j', line: 'connecté' };
    if (D) return { tone: 'ok', pill: u + (tok ? ' · token ' + tok.days + NB + 'j' : ' · connecté'), line: 'connecté' };
    return { tone: 'mute', pill: u + ' · relié', line: 'compte relié · token pas encore vérifié' };
  }

  // ── rendu général ──
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    Promise.resolve().then(function () { queued = false; render(); });
  }

  // 07/10 : sous le rond, l'étape du démarrage + son temps + la requête en attente ; « Réessayer » après 6 s. Relu chaque
  // seconde tant que le démarrage dure (bootTick).
  var bootTick = null;
  function bootInfo(st) {
    var on = st === 'boot' || st === 'loading', B = CF.boot, el = $('cfBootInfo'), bt = $('cfBootActs');
    if (!on) { if (bootTick) { clearInterval(bootTick); bootTick = null; } if (el) el.hidden = true; if (bt) bt.hidden = true; return; }
    if (!bootTick) bootTick = setInterval(function () { if (CF.status === 'boot' || CF.status === 'loading') bootInfo(CF.status); }, 1000);
    var now = Date.now(), sec = function (ms) { return fDec(ms / 1000, 1) + NB + 's'; };
    var txt = B.step + ' depuis ' + sec(now - B.stepAt) + ' · total ' + sec(now - B.t0);
    if (B.net) txt += ' · en attente du serveur : ' + B.net.path + ' (' + sec(now - B.net.at) + ')';
    if (el) { el.textContent = txt; el.hidden = now - B.t0 < 1500; }
    if (bt) bt.hidden = now - B.t0 < 6000;
  }
  function render() {
    var st = CF.status;
    if (st === 'ready') syncSel();
    show('cfBoot', st === 'boot' || st === 'loading');
    var bm = $('cfBootMsg');
    if (bm) bm.textContent = st === 'loading' ? 'Vérification de l’accès…' : 'Chargement…';
    bootInfo(st);
    show('cfLogin', st === 'auth');
    if (st === 'auth' && ui.lastStatus !== 'auth') {
      show('cfLoginPwd', true);
      show('cfLoginOtp', false);
      $('cfLoginMsg').textContent = CF.error || '';
    }
    show('cfDenied', st === 'forbidden');
    $('cfDeniedWho').textContent = CF.user ? CF.user.email : '';
    show('cfError', st === 'error');
    $('cfErrMsg').textContent = CF.error || '';
    show('cfApp', st === 'ready');
    ui.lastStatus = st;
    renderHeader();
    if (st === 'ready') {
      renderTabs();
      renderPanel();
      if (ui.tab === 'compte') ensureCompte();
      else if (ui.tab === 'dm') ensureDm();
      else if (ui.tab === 'home') ensureHome();
      else if (ui.tab === 'prod') ensureProd();
      else if (ui.tab === 'trackads') ensureBx();
    } else if (ui.modal) {
      closeModal();
    }
    if (ui.modal) renderModal();
  }

  function renderHeader() {
    $('cfWho').textContent = CF.user ? CF.user.email : '';
    var pill = $('cfIg');
    if (CF.status !== 'ready') { pill.hidden = true; return; }
    var s = ui.tab === 'home' ? homeIg() : igState();
    pill.hidden = false;
    pill.className = 'cf-pill is-' + s.tone;
    pill.title = 'Instagram : ' + s.line;
    setHTML(pill, '<span class="cf-dot" aria-hidden="true"></span><span>' + esc(s.pill) + '</span>');
  }

  function renderTabs() {
    var btns = document.querySelectorAll('.cf-tab');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-tab') === ui.tab;
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
      btns[i].tabIndex = on ? 0 : -1;
    }
  }

  function renderPanel() {
    var panel = $('cfPanel');
    panel.setAttribute('aria-labelledby', 'cfTab-' + ui.tab);
    // Recherche des leads : le panneau est redessiné à chaque frappe, on rend le focus et le curseur au champ.
    var a = document.activeElement, keep = a && (a.id === 'cfDmQ' || a.id === 'cfLibQ') ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
    setHTML(panel, ui.tab === 'compte' ? compteHTML() : ui.tab === 'dm' ? dmHTML() : ui.tab === 'home' ? homeHTML() : ui.tab === 'prod' ? prodHTML() : ui.tab === 'trackads' ? bxHTML() : soonHTML(ui.tab));
    var q = keep && $(keep.id);
    if (q && q !== document.activeElement) { q.focus(); try { q.setSelectionRange(keep.s, keep.e); } catch (e) { /* type search */ } }
  }

  // Charge ce que l'onglet Compte affiche. Le store ne fait rien si la case est fraîche (< 15 min) ou déjà en vol.
  function ensureCompte() {
    if (CF.status !== 'ready') return;
    CF.loadAccounts();
    CF.loadInsights(ui.range);
    CF.loadAudience();
    CF.loadMedia();
    // Les autres périodes se chargent ensuite en arrière-plan, une par une : changer de période devient instantané.
    CF.prefetch(ui.range);   // idempotent (une fois par session, relancé après reconnexion)
  }
  // Onglet Auto-DM : notre base (RPC, 2 min) + les publications Instagram pour les miniatures (même cache que Compte).
  function ensureDm() {
    if (CF.status !== 'ready') return;
    CF.loadAccounts();
    CF.loadDm(ui.dmRange);
    CF.loadMedia();
  }

  // ══ Accueil (étape 3, Axel 25/09) : « Qu'est-ce qui demande mon attention aujourd'hui ? Qui dois-je payer ? » ══
  // Aucun chiffre n'est recalculé ici : chaque valeur vient du modèle de son onglet (model + goalValue pour Insight,
  // dmModel pour l'Auto-DM, prodModel pour la Production) sur la période par défaut des onglets (30 j), et des MÊMES
  // cases du store (un appel par source, partagé avec les onglets). BloxAI (16/10) : carte, versements et alertes depuis CF.bx.
  function ensureHome() {
    if (CF.status !== 'ready') return;
    CF.loadAccounts();
    CF.loadInsights(HOME_RANGE);
    CF.loadMedia();
    CF.loadDm(HOME_DM);
    CF.loadProd();
    CF.loadProviders();
    CF.loadYt();
    CF.loadTts();   // 07/10 : statistiques TikTok (section et carte Réseaux)
    CF.loadBx();    // 16/10 : BloxAI (carte, versements à faire, alertes)
    bxIdPrevLoad(); // 18/10 (round 7, R7-16) : aperçus des pièces d'identité à vérifier (URL signées de 300 s)
    if (ui.netRange && ui.netRange !== HOME_RANGE) CF.loadInsights(ui.netRange);
  }

  // État Instagram de l'Accueil : la pastille de l'en-tête et la ligne sous le titre lisent cette seule fonction.
  function homeIg() {
    var A = CF.acct.accounts, prim = A.primary, tok = tokenInfo(prim), S = CF.acct.ig[HOME_RANGE], M = CF.acct.media;
    var u = '@' + ((prim && prim.username) || CF.PRIMARY_USERNAME);
    if (S.kind === 'disconnected' || M.kind === 'disconnected' || (A.state === 'ready' && !prim)) {
      return { key: 'off', tone: 'err', pill: 'Instagram déconnecté', line: 'Instagram déconnecté · auto-DM en pause' };
    }
    if (tok && tok.expired) return { key: 'expired', tone: 'err', tok: tok, pill: u + ' · token expiré', line: u + ' · token expiré le ' + dmy(tok.date) + ' · auto-DM en pause' };
    // Profil illisible (ex. token invalidé par un changement de mot de passe : ig-insights répond 200 + basic_error) :
    // même pastille rouge que les onglets Insight et Auto-DM (igState), jamais « connecté · auto-DM actif ».
    if (S.data && S.data.basicError) {
      return { key: 'refused', tone: 'err', tok: tok, err: S.data.basicError, pill: u + ' · lecture refusée', line: u + ' · Instagram refuse la lecture du profil · auto-DM à vérifier' };
    }
    if (!prim) {
      return A.state === 'error' ? { key: 'unknown', tone: 'mute', pill: 'Instagram · —', line: 'Instagram · comptes reliés illisibles : ' + A.error }
        : { key: 'loading', tone: 'mute', pill: 'Instagram…', line: 'Instagram · chargement…' };
    }
    var soon = !!tok && tok.days < 7;
    return { key: soon ? 'soon' : 'ok', tone: soon ? 'warn' : 'ok', tok: tok,
      pill: u + (tok ? ' · token ' + tok.days + NB + 'j' : ' · connecté'),
      line: u + ' · connecté · auto-DM actif · ' + (tok ? 'token expire le ' + dm(tok.date) + ' (' + tok.days + NB + 'j)' : 'date d’expiration du token pas encore exposée par instagram-auth') };
  }

  // Alertes RÉELLES seulement, calculées depuis les cases du store. danger puis warn (maquette §14) ; aucune alerte
  // d'exemple. BloxAI (16/10) : missions échouées en 24 h, publications à vérifier, pièces d'identité, versements, stock bas.
  var BILLING = { hedra: 'https://www.hedra.com/app/settings/billing', fal: 'https://fal.ai/dashboard/billing', elevenlabs: 'https://elevenlabs.io/app/subscription', kie: 'https://kie.ai/billing' };
  var LVL_ORDER = { danger: 0, warn: 1 };
  var TAB_NAME = { prod: 'Production', trackads: 'BloxAI', dm: 'Auto-DM', compte: 'Insight' };
  // Métriques de la fenêtre 30 j refusées par Instagram (part_errors d'ig-insights, normalisées dans D.err), sous les
  // libellés de l'onglet Insight qui les affiche. Celles de l'Accueil d'abord. reach_by_follow n'est affiché nulle part :
  // son refus ne rend aucun chiffre faux, il n'est donc pas compté.
  var IG_PART = [['views', 'vues'], ['engaged', 'comptes engagés'], ['follows', 'abonnements / désabonnements'], ['reach', 'reach'],
    ['interactions', 'interactions'], ['profileViews', 'vues de profil'], ['bioTaps', 'clics lien en bio'], ['linkTaps', 'clics boutons de contact'],
    ['viewsByType', 'vues par type de contenu'], ['viewsByFollower', 'vues · abonnés / non-abonnés']];
  function igRefused(D) {
    var E = (D && D.err) || {};
    return IG_PART.filter(function (x) { return E[x[0]]; }).map(function (x) { return { l: x[1], why: E[x[0]] }; });
  }
  // Étapes que ig_dm_stats_v2 n'a pas renvoyées (dmModel les affiche « — » · non renvoyé par ig_dm_stats_v2).
  // Une étape facultative (opt : « Devenus users ») absente = « pas de source » (DM_NOSRC, migration d'attribution pas
  // encore appliquée), pas un chiffre manquant : ni alerte, ni source « incomplète » (même règle que dmModel.none).
  function dmMissing(D) { return D ? DMS.filter(function (s) { return !s.opt && D.f[s.k] == null; }) : []; }
  function clip(s) { s = String(s || ''); return s.length > 160 ? s.slice(0, 159) + '…' : s; }
  function homeAlerts(ig) {
    var out = [];
    function add(lvl, title, sub, o) { o = o || {}; out.push({ lvl: lvl, title: title, sub: sub || '', tab: o.tab || null, ext: o.ext || null, retry: o.retry || null, tk: !!o.tk, list: o.list || null }); }
    var A = CF.acct.accounts, S = CF.acct.ig[HOME_RANGE], M = CF.acct.media, DS = CF.dm[HOME_DM], PS = CF.prod, V = CF.prov;
    var u = '@' + selName(), kept = function (x, what) { return x ? ' · ' + what + ' du ' + hm(new Date(x.fetchedAt)) + ' conservés' : ''; };
    // Instagram : trois états pilotés par le token (maquette §14)
    if (ig.key === 'off') add('danger', 'Instagram déconnecté · reconnecte ' + u, 'L’auto-DM est en pause tant que le compte n’est pas reconnecté. Les chiffres Instagram passent à « — » ; ceux de l’Auto-DM (notre base) restent justes.', { tab: 'dm' });
    else if (ig.key === 'expired') add('danger', 'Token Instagram expiré', 'Expiré le ' + dmy(ig.tok.date) + ' : l’auto-DM est en pause. Reconnecte ' + u + '.', { tab: 'dm' });
    // → onglet Insight : même pastille, même ligne rouge sur la carte compte, la raison complète et « Reconnecter »
    else if (ig.key === 'refused') add('danger', 'Instagram refuse la lecture du profil · reconnecte ' + u, 'ig-insights : ' + clip(ig.err)
      + ' · l’auto-DM envoie avec ce même token : tant que la lecture est refusée, ses envois ne sont pas garantis.', { tab: 'compte' });
    else if (ig.key === 'soon') add('warn', 'Token Instagram : ' + (ig.tok.days < 1 ? 'expire dans moins d’un jour' : 'expire dans ' + ig.tok.days + ' ' + plural(ig.tok.days, 'jour')), 'Le ' + dmy(ig.tok.date) + ' · reconnecte ' + u + ' pour ne pas couper l’auto-DM.', { tab: 'dm' });
    if (A.state === 'error') add('warn', 'Comptes Instagram reliés illisibles', 'instagram-auth : ' + A.error, { tab: 'dm' });
    if (ig.key !== 'off') {
      if (S.state === 'error') add('warn', 'Insights Instagram · 30' + NB + 'j non chargés', S.error + kept(S.data, 'chiffres'), { tab: 'compte' });
      else if (S.data && ig.key !== 'refused' && ig.key !== 'expired') {   // profil refusé ou token expiré : l'alerte rouge en est la cause
        var ref = igRefused(S.data);
        if (ref.length) {
          add('warn', 'Instagram refuse ' + ref.length + ' ' + plural(ref.length, 'métrique') + ' · 30' + NB + 'j', ref.map(function (x) { return x.l; }).join(', ')
            + ' · ex. ' + ref[0].l + ' : ' + clip(ref[0].why) + ' · détail dans l’onglet Insight.', { tab: 'compte' });
        }
      }
      if (M.state === 'error') add('warn', 'Publications Instagram non chargées', M.error + kept(M.data, 'chiffres'), { tab: 'compte' });
      else if (M.data && M.data.error) add('warn', 'Publications Instagram non chargées', 'ig-insights : ' + M.data.error, { tab: 'compte' });
      var bad = M.data ? M.data.list.filter(function (p) { return p.analysis && p.analysis.status === 'error'; }) : [];
      if (bad.length) {
        var d0 = validDate(bad[0].timestamp);
        add('warn', bad.length + ' ' + plural(bad.length, 'analyse') + ' des briques en erreur', 'Briques non reconnues dans ' + plural(bad.length, 'cette vidéo', 'ces vidéos')
          + ' · ex. publication ' + (d0 ? 'du ' + dmy(d0) : 'sans date') + ' : ' + (bad[0].analysis.error || 'erreur inconnue') + '.', { tab: 'compte' });
      }
    }
    // Auto-DM (notre base : juste même si Instagram est déconnecté)
    if (DS.state === 'error') add('warn', 'Auto-DM : chiffres indisponibles', DS.error + kept(DS.data, 'chiffres'), { tab: 'dm' });
    if (DS.data) {
      if (!DS.data.cron) add('warn', 'Relance automatique : état illisible', 'ig_dm_stats_v2 ne renvoie pas l’état du cron ig-followup-hourly.', { tab: 'dm' });
      else if (!DS.data.cron.active) add('warn', 'Relance automatique arrêtée', 'Le cron ig-followup-hourly est inactif : plus aucune relance ne part.', { tab: 'dm' });
      var miss = DS.state === 'error' ? [] : dmMissing(DS.data);
      if (miss.length) {
        add('warn', 'Auto-DM : ' + miss.length + ' ' + plural(miss.length, 'chiffre') + ' non ' + plural(miss.length, 'renvoyé'), 'ig_dm_stats_v2 ne renvoie pas : '
          + miss.map(function (s) { return s.label; }).join(', ') + ' · les cartes concernées (et les taux qui en dépendent) affichent « — ».', { tab: 'dm' });
      }
    }
    // Production (factory_qc, factory_bricks)
    if (PS.state === 'error') add('warn', 'Production : lecture impossible', PS.error + kept(PS.data, 'chiffres'), { retry: 'prod' });
    var Z = PS.data;
    if (Z) {
      if (Z.qc.pending) add('warn', Z.qc.pending + ' ' + plural(Z.qc.pending, 'vidéo') + ' à valider', 'File QC : ouvre la revue pour approuver ou refuser.', { tab: 'prod' });
      if (Z.qc.unclassified) {   // refus pas encore classés seulement (maquette §13) : « Classer » dans l'onglet Production
        var lr = Z.qc.lastRefused, nU = Z.qc.unclassified;
        add('warn', nU + ' ' + plural(nU, 'vidéo refusée', 'vidéos refusées') + ' à classer',
          (lr && lr.at ? 'Dernier refus le ' + dmy(new Date(lr.at)) : 'Refus') + (lr && lr.template ? ' · ' + lr.template : '') + ' · raison notée : '
          + (lr && lr.reason ? '« ' + lr.reason + ' »' : 'aucune') + '. ' + (Z.qc.classifyMissing ? '« Classer » attend la migration 20260925210000 (colonne classified_at).'
            : plural(nU, 'Reprends-la puis classe-la', 'Reprends-les puis classe-les') + ' dans l’onglet Production.'), { tab: 'prod' });
      }
      if (Z.bricks.flagged) add('warn', Z.bricks.flagged + ' ' + plural(Z.bricks.flagged, 'brique signalée', 'briques signalées'), 'Statut « signalée » dans la bibliothèque de briques : à revoir avant de l’utiliser.', { tab: 'prod' });
    }
    // BloxAI (16/10) : ce qui attend une décision d'Axel (vérifier, payer) et ce qui bloque les diffuseurs (stock)
    var BS = CF.bx, BD = BS.data;
    if (BS.state === 'error') add('warn', 'BloxAI : chiffres indisponibles', BS.error + kept(BD, 'chiffres'), { retry: 'bx' });
    if (BD) {
      var e24 = BD.asg.d24.expired, a24 = BD.asg.d24.abandoned;
      if (e24) add('warn', e24 + ' ' + plural(e24, 'mission échouée', 'missions échouées') + ' en 24' + NB + 'h', 'Délai de 24' + NB + 'h dépassé sans liens collés : '
        + plural(e24, 'la vidéo est revenue', 'les vidéos sont revenues') + ' dans le stock commun' + (a24 ? ' · ' + a24 + ' ' + plural(a24, 'abandon') + ' en plus' : '')
        + '.' + (BD.settings.pauseHours != null && BD.settings.pauseFailures != null && BD.settings.pauseWindowDays != null
          ? ' Pause de ' + fInt(BD.settings.pauseHours) + NB + 'h après ' + fInt(BD.settings.pauseFailures) + ' échecs en ' + fInt(BD.settings.pauseWindowDays) + NB + 'j.' : ''), { tab: 'trackads' });
      var nChk = bxToCheckN(BD);
      // 17/10 (contrat 3) : plus rien n'est validé ni refusé sans Axel — un lien sans « Valider » passe « En attente de vérification »
      if (nChk) add('warn', nChk + ' ' + plural(nChk, 'publication') + ' à vérifier', 'Liens collés par les diffuseurs : ouvre-les dans l’onglet BloxAI, vérifie la vidéo et la mention Publicité, puis Valider (conforme : gains comptés à la fin des '
        + bxTrackDays(BD) + NB + 'jours de suivi) ou Refuser (motif). Rien n’est validé ni refusé sans toi : sans décision, le lien passe « En attente de vérification » à la fin du suivi.', { tab: 'trackads' });
      var nHeld = bxHeldN(BD);
      if (nHeld) add('warn', nHeld + ' ' + plural(nHeld, 'publication') + ' en attente de vérification', 'Suivi terminé sans « Valider », ou vues pas relues dans les 48' + NB + 'h avant la fin : aucun gain tant que tu n’as pas décidé (Valider avec les vues figées, ou Refuser).', { tab: 'trackads' });
      if (BD.identityUndeleted) add('warn', BD.identityUndeleted + ' ' + plural(BD.identityUndeleted, 'copie de pièce d’identité', 'copies de pièces d’identité') + ' pas encore supprimée' + (BD.identityUndeleted > 1 ? 's' : ''), 'Décision prise mais fichier encore dans le stockage BloxAI : nouvel essai automatique ; s’il persiste, supprime-le à la main (contrat art. 4.4 : 7 jours au plus).', { tab: 'trackads' });
      var nId = BD.identity ? BD.identity.length : 0;
      if (nId) add('warn', nId + ' ' + plural(nId, 'pièce d’identité', 'pièces d’identité') + ' à vérifier', 'Âge et identité, à la main, avant le premier versement : Voir, compare avec le nom légal déclaré à la 1re acceptation des conditions, puis Valider (date de naissance et nom lus sur la pièce) ou Refuser.', { tab: 'trackads' });
      var PO = BD.money.payouts || [];
      if (PO.length) {
        var due = PO.reduce(function (a, x) { return a + x.amount; }, 0);
        var chg = PO.filter(function (x) { return x.detailsChanged; }).length;
        // 17/10 (round 5, contrats 2 et 9) : titulaire ≠ nom vérifié sur la pièce, aucun nom vérifié, coordonnées modifiées récemment
        var nDiff = PO.filter(function (x) { return bxNameCheck(x) === 'diff'; }).length, nNone = PO.filter(function (x) { return bxNameCheck(x) === 'none'; }).length;
        var nRec = PO.filter(function (x) { return !!bxRecent(x); }).length;
        // 18/10 (round 6) : depuis le dernier versement payé, quel que soit le délai de 72 h (R1a) ; nom vérifié ≠ nom légal
        // déclaré à la 1re acceptation des conditions (R2) ; titulaire partiel (R4)
        var cntP = function (k) { return PO.filter(function (x) { var h = bxPaidHist(x); return !!(h && h[k]); }).length; };
        var nPaidChg = cntP('changed'), nDest = cntP('dest'), nFirst = cntP('first');
        var nPart = PO.filter(function (x) { return bxNameCheck(x) === 'partial'; }).length, nDecl = PO.filter(function (x) { return bxDeclCheck(x) === 'diff'; }).length;
        var nFrz = PO.filter(function (x) { return x.payFrozen; }).length;
        add('warn', PO.length + ' ' + plural(PO.length, 'versement') + ' à faire · ' + fEur(due), 'Envoie le virement à la destination FIGÉE à la demande (PayPal ou IBAN dans l’onglet BloxAI), puis « Marquer payé ».'
          + (chg ? ' ' + chg + ' ' + plural(chg, 'diffuseur a', 'diffuseurs ont') + ' changé de coordonnées depuis : vérifie avant de payer.' : '')
          + (nRec ? ' ' + nRec + ' ' + plural(nRec, 'versement') + ' avec des coordonnées modifiées récemment (moins de 72' + NB + 'h) : confirme avec le diffuseur par un autre canal.' : '')
          + (nDest ? ' ' + nDest + ' ' + plural(nDest, 'versement') + ' vers une destination différente du dernier versement payé : ne paie pas sans avoir confirmé avec le diffuseur.' : '')
          + (nPaidChg ? ' ' + nPaidChg + ' ' + plural(nPaidChg, 'versement') + ' avec coordonnées, mot de passe ou adresse e-mail changés depuis le dernier versement payé : vérifie avant de payer.' : '')
          + (nFirst ? ' ' + nFirst + ' ' + plural(nFirst, 'premier versement', 'premiers versements') + ' à un diffuseur : vérifie la pièce et le titulaire.' : '')
          + (nDiff ? ' ' + nDiff + ' ' + plural(nDiff, 'titulaire différent', 'titulaires différents') + ' du nom vérifié sur la pièce d’identité : ne paie pas sans vérifier.' : '')
          + (nPart ? ' ' + nPart + ' ' + plural(nPart, 'titulaire partiel', 'titulaires partiels') + ' (des prénoms ne correspondent pas) : vérifie que c’est bien le diffuseur.' : '')
          + (nDecl ? ' ' + nDecl + ' ' + plural(nDecl, 'nom vérifié différent', 'noms vérifiés différents') + ' du nom légal déclaré à la 1re acceptation des conditions : pièce d’une autre personne ?' : '')
          + (nNone ? ' ' + nNone + ' ' + plural(nNone, 'versement') + ' sans nom vérifié sur la pièce d’identité.' : '')
          // 18/10 (round 7, R7-5) : versement ouvert d'un diffuseur dont Axel a gelé les versements
          + (nFrz ? ' ' + nFrz + ' ' + plural(nFrz, 'versement') + ' d’un diffuseur aux versements gelés : ne paie pas sans avoir levé le doute (Annuler ce versement, ou Dégeler).' : ''), { tab: 'trackads' });
      }
      // 17/10 (round 5, contrat 2) : versements reportés par BloxAI (coordonnées ou mot de passe changés depuis moins de 72 h)
      // 18/10 (round 7, R7-5) : diffuseurs GELÉS (BX_FROZEN) à part : ce n'est pas un délai, rien ne repart sans « Dégeler »
      var DFall = BD.money.deferred || [], DF = DFall.filter(function (d) { return !bxDefFrozen(d); }), DFz = DFall.filter(bxDefFrozen);
      if (DFz.length) add('warn', DFz.length + ' ' + plural(DFz.length, 'diffuseur aux versements gelés', 'diffuseurs aux versements gelés') + ' · ' + fEur(DFz.reduce(function (a, d) { return a + (d.balance || 0); }, 0)) + ' en attente',
        'Gelés par toi : BloxAI ne crée aucun versement tant que tu ne les dégèles pas (motif et « Dégeler » dans l’onglet BloxAI).', { tab: 'trackads' });
      if (DF.length) add('warn', DF.length + ' ' + plural(DF.length, 'versement reporté', 'versements reportés') + ' · coordonnées modifiées récemment', 'Coordonnées de versement, pièce d’identité, nom légal, mot de passe ou adresse e-mail changés depuis moins de 72' + NB + 'h : BloxAI ne crée aucun versement avant la fin du délai (session volée ?). Si ce n’était pas le diffuseur, préviens-le par un autre canal (détail dans l’onglet BloxAI).', { tab: 'trackads' });
      // Kit ↔ stock commun (17/10, revue) : une vidéo part sur UN seul compte. Comparé à ce que le kit tient (posts à
      // programmer / programmés / publiés) : jamais d'action « Remettre » sur une vidéo passée au kit (fichier peut-être libéré).
      var KV = PS.data ? PS.data.qc.kitVfs : null;
      if (KV) {
        var orphan = [], twice = [];
        Object.keys(BD.byVf).forEach(function (vf) {
          var e = BD.byVf[vf];
          if (e.status === 'kit' && !KV.vfs[vf] && (KV.complete || (e.created != null && KV.oldest != null && e.created >= KV.oldest))) orphan.push(vf);
          else if (KV.vfs[vf] && (e.status === 'open' || e.status === 'assigned' || e.status === 'done')) twice.push(vf);
        });
        var few = function (l) { return l.slice(0, 6).join(', ') + (l.length > 6 ? '…' : ''); };
        if (twice.length) add('danger', twice.length + ' ' + plural(twice.length, 'vidéo') + ' à la fois dans le kit et chez les diffuseurs', few(twice)
          + ' : ' + plural(twice.length, 'elle est', 'elles sont') + ' aussi dans le stock commun, en mission ou publiée' + (twice.length > 1 ? 's' : '') + ' par un diffuseur. Une vidéo encore ouverte est retirée du stock à la prochaine recharge du kit ; une vidéo prise ou publiée par un diffuseur : ne programme pas son post.', { tab: 'trackads' });
        if (orphan.length) add('warn', orphan.length + ' ' + plural(orphan.length, 'vidéo sortie', 'vidéos sorties') + ' du stock commun sans post dans le kit', few(orphan)
          + ' : retrait interrompu. La prochaine recharge du kit (au plus tard celle de la nuit) ' + plural(orphan.length, 'la remet', 'les remet') + ' dans le stock commun. Si l’alerte reste après la nuit, ' + plural(orphan.length, 'cette vidéo est bloquée', 'ces vidéos sont bloquées') + ' : à vérifier.', { tab: 'trackads' });
      }
      var K = BD.stock, kb = BD.settings.kitBuffer;
      if (K.open === 0) add('danger', 'Stock commun vide', 'Plus aucune vidéo validée en attente : ni le kit ni les diffuseurs ne peuvent être servis. Valide de nouvelles vidéos.', { tab: 'prod' });
      else if (K.available === 0) add('warn', 'Plus de mission pour les diffuseurs', fInt(K.open) + ' ' + plural(K.open, 'vidéo') + ' en stock, toutes gardées pour le kit (réserve de ' + (kb == null ? '—' : fInt(kb)) + ') : les diffuseurs voient « Plus de vidéo disponible ».', { tab: 'trackads' });
      else if (K.available != null && K.available < 5) add('warn', 'Stock des diffuseurs bas · ' + K.available + ' ' + plural(K.available, 'mission'), 'Au-delà de la réserve du kit (' + (kb == null ? '—' : fInt(kb)) + ') : valide de nouvelles vidéos pour ne pas bloquer les diffuseurs.', { tab: 'trackads' });
      // 18/10 (round 7, R7-6) : alertes e-mail de BloxAI aux diffuseurs (moyen de paiement, mot de passe, e-mail modifiés)
      // pas parties sur 7 jours (notif_log : refus de Resend, clé absente, limite) : le diffuseur n'a pas été prévenu
      var NF = BD.notif;
      if (NF && NF.count7) add('warn', NF.count7 + ' ' + plural(NF.count7, 'alerte e-mail non envoyée', 'alertes e-mail non envoyées') + ' aux diffuseurs · 7' + NB + 'j',
        'BloxAI n’a pas pu prévenir ' + plural(NF.count7, 'ce diffuseur', 'ces diffuseurs') + ' d’un changement sur son compte : préviens-' + plural(NF.count7, 'le', 'les')
        + ' par un autre canal avant tout versement, puis vérifie la clé et le quota Resend de BloxAI.' + (!NF.last.length ? '' : NF.count7 > NF.last.length ? ' Les ' + NF.last.length + ' derniers :' : ' Détail :'),
        { list: NF.last.map(bxNotifLine) });
      var bxMiss = bxMissing(BD);
      if (bxMiss.length) add('warn', 'BloxAI : ' + bxMiss.length + ' ' + plural(bxMiss.length, 'donnée') + ' non ' + plural(bxMiss.length, 'renvoyée'), bxMiss.join(', ') + ' · les cartes concernées affichent « — ».', { tab: 'trackads' });
    }
    // 07/10 (Axel) : plus de brouillons TikTok (publication à la main) → plus d'alerte « comptes TikTok »
    // Soldes fournisseurs (provider-watch : ok / bas, jamais le montant)
    if (V.state === 'error') add('warn', 'Soldes fournisseurs illisibles', V.error + ' · réessaie dans un instant.', { retry: 'prov' });
    if (V.data) {
      var unc = [];
      V.data.list.forEach(function (p) {
        if (p.error) add('warn', 'Solde ' + p.label + ' illisible', 'provider-watch : ' + p.error, { retry: 'prov' });
        else if (p.level !== 'ok') {
          add(p.level === 'crit' ? 'danger' : 'warn', 'Solde ' + p.label + ' bas', (p.id === 'elevenlabs' ? 'Moins de 5' + NB + '% du quota de caractères du mois' : 'Moins de 5' + NB + '$')
            + (p.at ? ' · relevé ' + ago(p.at) : '') + ' : recharge avant d’être à zéro, sinon les générations échouent.', { ext: BILLING[p.id] });
        } else if (p.unconfirmed) unc.push(p.label);
      });
      // « ok » sans readable (provider-watch en ligne pas encore redéployé) : un solde illisible répond « ok » aussi.
      if (unc.length) {
        add('warn', 'Soldes non confirmés : ' + unc.join(', '), 'provider-watch répond « ok » sans dire si le solde a été lu (une clé refusée répond « ok » aussi)'
          + ' · redéploie provider-watch (champ readable) pour le vérifier.');
      }
    }
    return out.sort(function (a, b) { return LVL_ORDER[a.lvl] - LVL_ORDER[b.lvl]; });
  }

  // Sources lues par l'Accueil. « Rien à signaler » n'apparaît que lorsque TOUTES ont répondu, sans alerte.
  // Une source qui a répondu EN PARTIE (métriques refusées, profil illisible, étape Auto-DM absente, solde non lu ou non
  // confirmé) est « incomplète » : jamais comptée dans les sources vérifiées (chacune a son alerte).
  function homeSources(ig) {
    var off = ig.key === 'off', S = CF.acct.ig[HOME_RANGE], DS = CF.dm[HOME_DM], V = CF.prov.data;
    return [
      { k: 'accounts', l: 'comptes Instagram', S: CF.acct.accounts },
      { k: 'ig', l: 'insights 30' + NB + 'j', S: S, off: off, part: !!(S.data && (S.data.basicError || igRefused(S.data).length)) },
      { k: 'media', l: 'publications', S: CF.acct.media, off: off },
      { k: 'dm', l: 'Auto-DM 30' + NB + 'j', S: DS, part: !!(DS.data && (!DS.data.cron || dmMissing(DS.data).length)) },
      { k: 'prod', l: 'production', S: CF.prod },
      { k: 'prov', l: 'soldes fournisseurs', S: CF.prov, part: !!(V && V.list.some(function (p) { return p.error || p.unconfirmed; })) },
      { k: 'bx', l: 'BloxAI', S: CF.bx, part: !!(CF.bx.data && bxMissing(CF.bx.data).length) }
    ].map(function (x) {
      // une source qui répond « liste en erreur » (publications : media_error) n'est pas « vérifiée »
      var bad = x.S.state === 'error' || !!(x.S.data && x.S.data.error);
      return { k: x.k, l: x.l, st: x.off ? 'off' : x.S.state === 'idle' ? 'wait' : bad ? 'err' : x.part ? 'part' : 'ok' };
    });
  }

  function homeHTML() {
    var ig = homeIg(), alerts = homeAlerts(ig), src = homeSources(ig);
    var S = CF.acct.ig[HOME_RANGE], off = S.kind === 'disconnected', X = model(S, S.data, off, HOME_RANGE);
    var DS = CF.dm[HOME_DM], Y = dmModel(DS, DS.data, HOME_DM);
    return '<section class="cf-title"><h1>Vue d’ensemble</h1><div class="cf-sub">' + esc(longDate(new Date())) + '</div>'
      + '</section>'
      + homeIdHTML()   // 18/10 (round 7, R7-16) : pièces d'identité à vérifier, en tête quand il y en a
      + homeAlertsHTML(alerts, src)
      + homePayHTML()
      + '<section class="cf-hsum" aria-labelledby="cfHsT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfHsT">Résumé des onglets</h2></div></div>'
      + '<div class="cf-hcards">' + homeProdCard() + homeTrackCard() + homeDmCard(Y) + homeIgCard(X, off) + '</div></section>'
      + homeNetHTML()
      + ttsHTML()   // 07/10 : statistiques TikTok (comptes reliés avec les scopes de stats)
      // Kit de publication (29/09) : page à part, pensée pour programmer à la main dans l'app Instagram.
      + '<section class="cf-card cf-kit" aria-labelledby="cfKitT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfKitT">Kit de publication</h2>'
      + '<div class="cf-dim">Vidéos à envoyer en AirDrop, légendes à copier, heures de programmation · 5 @avataradss + 3 @leoadsia + 3 @ialebd.axel par jour</div></div>'
      + '<a class="cf-btn is-dark" href="factory-kit.html" style="text-decoration:none">Ouvrir le kit</a></div></section>';
  }

  function homeAlertsHTML(alerts, src) {
    var wait = src.filter(function (x) { return x.st === 'wait'; }), n = alerts.length;
    var rows = alerts.map(function (a) {
      var go = a.tab ? '<button type="button" class="cf-alert-go" data-act="home-go" data-tab="' + a.tab + '">' + esc(TAB_NAME[a.tab]) + svg(IC.arrow, 12) + '</button>'
        : a.tk ? '<button type="button" class="cf-alert-go" data-act="tk-goto">Comptes TikTok' + svg(IC.arrow, 12) + '</button>'
        : a.retry ? '<button type="button" class="cf-alert-go" data-act="home-retry" data-src="' + a.retry + '">Réessayer' + svg(IC.refresh, 12) + '</button>'
        : a.ext ? '<a class="cf-alert-go" href="' + esc(a.ext) + '" target="_blank" rel="noopener noreferrer">Recharger' + svg(IC.external, 12) + '</a>' : '';
      return '<div class="cf-alert is-' + a.lvl + '"><span class="cf-alert-ic">' + svg(a.lvl === 'danger' ? IC.alert : IC.clock, 15) + '</span>'
        + '<span class="cf-alert-t"><b>' + esc(a.title) + '</b><span>' + esc(a.sub) + '</span>'
        // 18/10 (round 7, R7-6) : détail ligne par ligne (échecs d'envoi des alertes e-mail)
        + (a.list && a.list.length ? '<ul class="cf-alert-list">' + a.list.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '') + '</span>' + go + '</div>';
    }).join('');
    var tail = '';
    if (wait.length) tail = '<div class="cf-status" role="status"><span class="cf-spin" aria-hidden="true"></span>' + esc('Chargement… · ' + wait.map(function (x) { return x.l; }).join(', ')) + '</div>';
    else if (!n && src.every(function (x) { return x.st === 'ok' || x.st === 'off'; })) {
      tail = '<div class="cf-alert is-ok"><span class="cf-alert-ic">' + svg(IC.check, 15) + '</span><span class="cf-alert-t"><b>Rien à signaler</b>'
        + '<span>Toutes les sources ont répondu, aucune alerte.</span></span></div>';
    }
    var names = function (st) { return src.filter(function (x) { return x.st === st; }).map(function (x) { return x.l; }); };
    var okL = src.filter(function (x) { return x.st === 'ok' || x.st === 'off'; }).map(function (x) { return x.l + (x.st === 'off' ? ' (déconnecté)' : ''); });
    var partL = names('part'), errL = names('err'), probs = [];
    if (partL.length) probs.push('incomplètes : ' + partL.join(', '));
    if (errL.length) probs.push('en erreur : ' + errL.join(', '));
    var V = CF.prov.data, pAt = V ? Math.max.apply(null, V.list.map(function (p) { return p.at || 0; })) : 0;
    var provOk = src.some(function (x) { return x.k === 'prov' && x.st === 'ok'; });
    var foot = 'Sources vérifiées : ' + (okL.length ? okL.join(' · ') : '—') + (pAt && provOk ? ' (soldes relevés ' + ago(pAt) + ' par provider-watch)' : '')
      + (probs.length ? ' · ' + probs.join(' · ') + ' (voir les alertes)' : '');
    return '<section class="cf-card" aria-labelledby="cfAlT"><div class="cf-alerts-h"><h2 class="cf-h2" id="cfAlT">À surveiller</h2><span class="cf-badge" data-alerts="' + n + '">'
      + (wait.length && !n ? '…' : n) + '</span></div>'
      + '<div class="cf-alerts">' + rows + tail + '</div><div class="cf-hsrc">' + esc(foot) + '</div></section>';
  }

  // Versements BloxAI (16/10) : « Qui dois-je payer ? » — versements ouverts (demandés ou en attente) et solde non versé, lus
  // dans CF.bx ; le détail (PayPal / IBAN) et « Marquer payé » sont dans l'onglet BloxAI.
  function homePayHTML() {
    var B = bxModel(), D = B.D, P = D ? D.money.payouts : null, n = P ? P.length : null;
    var due = P ? P.reduce(function (a, x) { return a + x.amount; }, 0) : null;
    var v = function (c) { return B.pending ? '…' : c == null ? '—' : fEur(c); };
    var k = function (c, l) { return '<div class="cf-pay-k"><b class="' + (c ? 'is-v' : '') + '">' + esc(v(c)) + '</b><span>' + esc(l) + '</span></div>'; };
    var body;
    if (B.pending) body = spin('Chargement des versements BloxAI…');
    else if (!D) body = emptyLine('—', B.why);
    else if (!P) body = emptyLine('—', 'versements non renvoyés par BloxAI');
    else if (!n) body = '<div class="cf-empty-s cf-dashed" data-pay="none">Aucun versement à faire.</div>';
    else {
      body = '<div class="cf-bx-list">' + P.slice(0, 5).map(function (x) {
        return '<div class="cf-bx-row is-pay"><span class="cf-bx-main"><b>' + esc((x.name || 'diffuseur') + ' · ' + fEur(x.amount)) + '</b>'
          + '<span class="cf-meta">' + esc([BX_KIND[x.kind] || 'versement', x.period ? 'période du ' + dmy(ymdDate(x.period)) : '', BX_METHOD[x.method] || 'moyen de paiement non renseigné'].filter(Boolean).join(' · ')) + '</span></span>'
          + '<span class="cf-bx-chips"><span class="cf-qchip ' + (x.status === 'requested' ? 'is-pend' : '') + '">' + esc(BX_PAY_ST[x.status] || 'statut inconnu') + '</span>'
          // 17/10 (round 5) : à vérifier avant de payer (détail dans l'onglet BloxAI)
          + (x.payFrozen ? '<span class="cf-qchip is-flag is-ko" data-frozen="1">' + svg(IC.alert, 11) + 'Versements gelés</span>' : '')   // 18/10 (round 7, R7-5)
          + (bxRecent(x) ? '<span class="cf-qchip is-flag is-warn">' + svg(IC.alert, 11) + 'Modifiées récemment</span>' : '')
          + (bxNameCheck(x) === 'diff' ? '<span class="cf-qchip is-flag is-ko">' + svg(IC.alert, 11) + 'Titulaire ≠ pièce</span>' : '')
          // 18/10 (round 6) : R4 titulaire partiel, R2 pièce ≠ nom déclaré, R1a depuis le dernier versement payé
          + (bxNameCheck(x) === 'partial' ? '<span class="cf-qchip is-flag is-warn">' + svg(IC.alert, 11) + 'Titulaire partiel</span>' : '')
          + (bxDeclCheck(x) === 'diff' ? '<span class="cf-qchip is-flag is-ko">' + svg(IC.alert, 11) + 'Pièce ≠ nom déclaré</span>' : '')
          + (function (h) {   // même ordre que la ligne de l'onglet BloxAI
            return !h ? '' : (h.dest ? '<span class="cf-qchip is-flag is-ko">' + svg(IC.alert, 11) + 'Destination différente</span>' : '')
              + (h.changed ? '<span class="cf-qchip is-flag is-warn">' + svg(IC.alert, 11) + 'Changées depuis le dernier versement</span>' : '')
              + (h.first ? '<span class="cf-qchip is-flag is-warn">' + svg(IC.alert, 11) + '1er versement</span>' : '');
          })(bxPaidHist(x)) + '</span></div>';
      }).join('') + '</div>' + (n > 5 ? '<div class="cf-meta">' + esc('+ ' + (n - 5) + ' ' + plural(n - 5, 'autre') + ' dans l’onglet BloxAI') + '</div>' : '')
        + '<button type="button" class="cf-btn is-sm cf-bx-go" data-act="home-go" data-tab="trackads">Payer depuis l’onglet BloxAI' + svg(IC.arrow, 12) + '</button>';
    }
    var rate = !D ? (B.pending ? 'chargement' : 'tarif indisponible') : D.settings.rateCentsPer1000 != null ? fEur(D.settings.rateCentsPer1000) + ' / 1' + NB + '000 vues validées' : 'tarif non renvoyé';
    return '<section class="cf-card" aria-labelledby="cfPayT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfPayT">Versements à faire <span class="cf-badge">' + esc(B.pending ? '…' : n == null ? '—' : String(n)) + '</span></h2>'
      + '<span class="cf-meta">' + esc('diffuseurs BloxAI · ' + rate) + '</span></div>'
      + '<div class="cf-pay-ks">' + k(D ? D.money.unpaid : null, 'Solde non versé (gains validés − versements)') + k(due, 'À verser (versements ouverts)') + '</div></div>'
      + body + '</section>';
  }

  // ── cartes résumé : 4 chiffres par onglet, repris de son modèle ──
  function hstat(k, v, label, sub, o) {
    o = o || {};
    return '<div class="cf-hstat" data-h="' + k + '"><span class="cf-hstat-v' + (v === '—' ? ' is-na' : o.acc ? ' is-acc' : '') + '">' + esc(v)
      + (o.small && v !== '—' && v !== '…' ? '<small>' + esc(o.small) + '</small>' : '') + '</span>'
      + '<span class="cf-hstat-l">' + esc(label) + '</span><span class="cf-hstat-s">' + esc(sub || '') + '</span></div>';
  }
  function hcard(k, title, icon, per, stats, extra) {
    return '<section class="cf-card cf-hcard" data-card="' + k + '" aria-labelledby="cfHc-' + k + '"><div class="cf-hcard-h"><span class="cf-hcard-ic">' + svg(icon, 18) + '</span>'
      + '<h3 class="cf-h2" id="cfHc-' + k + '">' + esc(title) + '</h3>' + (per ? '<span class="cf-hcard-per">' + esc(per) + '</span>' : '') + '</div>'
      + '<div class="cf-hstats">' + stats.join('') + '</div>' + (extra || '')
      + '<button type="button" class="cf-btn is-dark cf-hgo" data-act="home-go" data-tab="' + k + '">Ouvrir le dashboard' + svg(IC.arrow, 13) + '</button></section>';
  }

  // Production : lit prodModel(), LE modèle de l'onglet Production (vidéos à générer, jours de contenu : mêmes chiffres).
  var KIND_PL = { hook: ['hook', 'hooks'], liaison: ['liaison', 'liaisons'], cta: ['CTA', 'CTA'], contenu: ['contenu', 'contenus'],
    transformation: ['transformation', 'transformations'], avatar: ['avatar', 'avatars'], musique: ['musique', 'musiques'],
    'sous-titre': ['style de sous-titres', 'styles de sous-titres'], 'texte-choc': ['texte choc', 'textes choc'], 'style-choc': ['style de texte choc', 'styles de texte choc'], autre: ['autre', 'autres'] };
  function homeProdCard() {
    var M = prodModel(), D = M.D;
    function na(k, label, o) { return M.pending ? hstat(k, '…', label, 'chargement', o) : hstat(k, '—', label, M.why, o); }
    var gen = !D ? na('togen', 'Vidéos à générer')
      : !M.cap ? hstat('togen', '—', 'Vidéos à générer', M.ruleShort)
        : hstat('togen', fInt(M.cap.remaining), 'Vidéos à générer', M.genSub);
    // places de la maquette (01-accueil) : [En stock (orange) | Jours de contenu] [À valider | Vidéos à générer]
    var stock = !D ? na('stock', 'En stock', { acc: true }) : hstat('stock', M.stock == null ? (M.stockWait ? '…' : '—') : fInt(M.stock), 'En stock', M.stockSub, { acc: true });
    var pend = !D ? na('qc-pending', 'À valider') : hstat('qc-pending', fInt(D.qc.pending), 'À valider', 'file QC');
    var days = hstat('days', M.days.txt, 'Jours de contenu', M.days.sub);
    return hcard('prod', 'Production', IC.layers, 'état actuel', [stock, days, pend, gen], '');
  }
  function homeTrackCard() {
    // BloxAI (16/10) : mêmes chiffres que l'onglet BloxAI (CF.bx) ; « — » + raison tant que BloxAI ne répond pas
    var B = bxModel(), D = B.D, per = '30' + NB + 'j';
    var na = function (k, label, o) { return B.pending ? hstat(k, '…', label, 'chargement', o) : hstat(k, '—', label, B.why, o); };
    if (!D) return hcard('trackads', 'BloxAI', IC.reach, per, [na('views', 'Vues · 30' + NB + 'j', { acc: true }), na('active', 'Diffuseurs actifs'), na('missions', 'Missions en cours'), na('solde', 'Solde non versé')], '');
    var v30 = D.series ? D.series.slice(-30).reduce(function (a, x) { return x.views == null ? a : a + x.views; }, 0) : null;
    var nPay = D.money.payouts ? D.money.payouts.length : null;
    return hcard('trackads', 'BloxAI', IC.reach, per, [
      v30 == null ? hstat('views', '—', 'Vues · 30' + NB + 'j', 'série 30' + NB + 'j non renvoyée', { acc: true }) : hstat('views', fInt(v30), 'Vues · 30' + NB + 'j', 'publications des diffuseurs', { acc: true }),
      hstat('active', bxN(D.users.active7), 'Diffuseurs actifs', D.users.active7 == null ? BX_NR : 'sur 7' + NB + 'j · ' + bxN(D.users.total) + ' ' + plural(D.users.total, 'inscrit')),
      hstat('missions', bxN(D.asg.active), 'Missions en cours', D.asg.active == null ? BX_NR : '24' + NB + 'h pour publier · ' + bxN(bxToCheckN(D)) + ' à vérifier'),
      hstat('solde', D.money.unpaid == null ? '—' : fEur(D.money.unpaid), 'Solde non versé', D.money.unpaid == null ? BX_NR : nPay == null ? 'versements non renvoyés' : nPay + ' ' + plural(nPay, 'versement') + ' à faire')
    ], '');
  }
  function homeDmCard(Y) {
    var L = {}; DMS.forEach(function (d) { L[d.k] = d.label; });
    var v = function (k) { var m = Y.c[k]; return Y.pending ? '…' : m.v == null ? '—' : fInt(m.v); };
    var s = function (k, txt) { var m = Y.c[k]; return Y.pending ? 'chargement' : m.v == null ? m.why : txt; };
    var ctr = Y.rates.filter(function (r) { return r.k === 'ctr'; })[0];
    return hcard('dm', 'Auto-DM Instagram', IC.chat, '30' + NB + 'j', [
      hstat('leads', v('commented'), L.commented, s('commented', 'personnes uniques · ' + Y.P.per), { acc: true }),
      hstat('clicks', v('clicked'), L.clicked, s('clicked', Y.P.per)),
      hstat('ctr', Y.pending ? '…' : ctr.v == null ? '—' : fP1(ctr.v), ctr.label, Y.pending ? 'chargement' : ctr.v == null ? ctr.na : ctr.sub),
      // attribution (25/09) : même chiffre que la carte « Devenus users » de l'onglet Auto-DM ; « — » tant que la RPC ne le rend pas
      hstat('users', Y.noSrc ? '—' : v('users'), L.users, Y.noSrc ? DM_NOSRC : s('users', 'compte créé après le clic · ' + Y.P.per))
    ], '');
  }
  function homeIgCard(X, off) {
    var c = X.c, W = goalValue(X, GOAL.watch);
    function one(k, label, m, sub, o) {
      if (X.pending) return hstat(k, '…', label, 'chargement', o);
      return m.v == null ? hstat(k, '—', label, m.why || X.why, o) : hstat(k, fInt(m.v), label, sub, o);
    }
    var fol = X.pending ? hstat('followers', '…', 'Abonnés', 'chargement', { acc: true })
      : X.fol == null ? hstat('followers', '—', 'Abonnés', off ? 'compte déconnecté' : X.why, { acc: true })
        : hstat('followers', fInt(X.fol), 'Abonnés', 'total actuel · ' + (X.net == null ? 'net —' : fSigned(X.net) + ' net ' + X.per), { acc: true });
    var watch = W.loading ? hstat('watch', '…', 'Visionnage moyen', 'chargement')
      : W.v == null ? hstat('watch', '—', 'Visionnage moyen', W.na)
        : hstat('watch', W.val, 'Visionnage moyen', (W.sub ? W.sub + ' · ' : '') + 'reels publiés ' + X.per, { small: W.dur ? ' / ' + fSec0(W.dur) : '' });
    // Axel 25/09 : pas de « 30 j » en en-tête ni de top post ; « Likes » (total + like rate + objectif) remplace « Comptes engagés »
    return hcard('compte', 'Insight Instagram', IC.insta, '', [
      fol, one('views', 'Vues', c.views, X.per), watch, homeLikeStat(X)
    ], '');
  }
  // ── Réseaux (29/09, Axel) : YouTube + Instagram (tous nos comptes) + TikTok (07/10 : comptes reliés pour les stats), cochables ──
  // Chiffres : abonnés, vidéos, vues, likes, commentaires, chacun avec son % et l'objectif en vert / rouge. Vidéos, vues,
  // likes et commentaires = vidéos PUBLIÉES dans la période (stats à vie de chaque vidéo) ; abonnés = total actuel, et
  // sur la courbe le gain par jour (Instagram : historique Insights ; YouTube : relevé quotidien social_daily).
  var NET_PF = [
    { k: 'yt', label: 'YouTube', c: '#e0342b', ic: 'M22 8.5a3 3 0 0 0-2.1-2.1C18 6 12 6 12 6s-6 0-7.9.4A3 3 0 0 0 2 8.5 31 31 0 0 0 2 12a31 31 0 0 0 .1 3.5 3 3 0 0 0 2 2.1c1.9.4 7.9.4 7.9.4s6 0 7.9-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.1-3.5zM10 15V9l5 3z' },
    { k: 'ig', label: 'Instagram', c: 'var(--cf-c-reach)', ic: IC.insta },
    { k: 'tt', label: 'TikTok', c: '#1b1814', ic: 'M9 12a4 4 0 1 0 4 4V4c.5 2.5 2.5 4 5 4' }
  ];
  var NET_SER = [
    { k: 'subs', label: 'Abonnés', c: 'var(--cf-c-followers)', ic: IC.follow },
    { k: 'videos', label: 'Vidéos', c: 'var(--cf-c-posts)', ic: IC.grid },
    { k: 'views', label: 'Vues', c: 'var(--cf-c-views)', ic: IC.eye },
    { k: 'likes', label: 'Likes', c: 'var(--cf-c-reach)', ic: IC.heart },
    { k: 'comments', label: 'Commentaires', c: 'var(--cf-c-inter)', ic: IC.chat }
  ];
  // Objectifs : croissance abonnés ≥ 5 % sur la période, 5 vidéos / jour, 1 000 vues / vidéo, like rate et comment rate
  // = les objectifs de l'onglet Insight (GOAL.like, GOAL.comment).
  var NET_GOAL = { subs: 5, videosPerDay: 5, viewsPerVideo: 1000 };
  var NET_ALL_FROM = new Date(2026, 6, 15).getTime();   // « All time » = depuis le 15/07/2026
  var NET_RANGES = [['7j', '7' + NB + 'j', 7], ['30j', '30' + NB + 'j', 30], ['90j', '90' + NB + 'j', 90], ['all', 'All time', null]];
  function netSel() {
    var d = { yt: true, ig: true, tt: true };
    try { var v = JSON.parse(localStorage.getItem('cf_net') || 'null'); if (v && (v.yt || v.ig || v.tt)) d = { yt: !!v.yt, ig: !!v.ig, tt: v.tt == null ? true : !!v.tt }; } catch (e) { /* stockage bloqué */ }
    return d;
  }
  // Comptes TikTok lisibles (07/10) : ceux dont le profil a répondu (un compte en erreur n'additionne rien).
  function ttLive() { var D = CF.tts.data; return D ? D.accounts.filter(function (a) { return !a.error; }) : []; }
  function netToggle(k) {
    var s = netSel(); if (k !== 'yt' && k !== 'ig' && k !== 'tt') return;
    s[k] = !s[k]; if (!s.yt && !s.ig && !s.tt) return;   // au moins un réseau reste affiché
    try { localStorage.setItem('cf_net', JSON.stringify(s)); } catch (e) { /* */ }
    schedule();
  }
  function netRange() { return ui.netRange || '30j'; }
  function netModel() {
    var R = netRange(), days = NET_RANGES.filter(function (r) { return r[0] === R; })[0][2], sel = netSel();
    var now = Date.now(), from = days ? now - days * 864e5 : NET_ALL_FROM;
    var Y = CF.yt, M = CF.acct.media, I = CF.acct.ig[R], ytD = sel.yt ? Y.data : null, igM = sel.ig && M.data ? M.data : null, igD = sel.ig ? I.data : null;
    var T = CF.tts, ttA = sel.tt ? ttLive() : [];
    var pend = (sel.yt && !Y.data && Y.state !== 'error') || (sel.ig && !M.data && M.state !== 'error') || (sel.tt && !T.data && T.state !== 'error');
    var err = [sel.yt && Y.state === 'error' && !Y.data ? 'YouTube : ' + Y.error : '', sel.ig && M.state === 'error' && !M.data ? 'Instagram : ' + M.error : '',
      sel.tt && T.state === 'error' && !T.data ? 'TikTok : ' + T.error : ''].filter(Boolean).join(' · ');
    var vids = [];
    if (ytD) ytD.videos.forEach(function (v) { var ms = Date.parse(v.published_at || ''); if (isFinite(ms)) vids.push({ pf: 'yt', ms: ms, views: v.views, likes: v.likes, comments: v.comments, thumb: v.thumb, url: v.id ? 'https://youtube.com/shorts/' + v.id : null }); });
    // 07/10 (Axel) : Instagram et TikTok = vidéos CONFIRMÉES de l'usine seulement (classement, vidéos, vues, likes,
    // commentaires, courbe). Instagram : reel rattaché à sa ligne du kit (recette) ; TikTok : reconnue ou reliée à la main.
    if (igM) igM.list.forEach(function (p) { if ((p.type === 'REELS' || p.type === 'VIDEO') && p.ms != null && p.recipe) vids.push({ pf: 'ig', ms: p.ms, views: p.views, likes: p.likes, comments: p.comments, thumb: p.thumb, url: p.permalink, vf: p.recipe.vf, rid: p.recipe.id || p.recipe.vf }); });
    ttA.forEach(function (a) { a.videos.forEach(function (v) { if (v.ms != null && v.recipe && v.recipe.vf && (v.recipe.state === 'auto' || v.recipe.state === 'manual')) vids.push({ pf: 'tt', ms: v.ms, views: v.views, likes: v.likes, comments: v.comments, thumb: v.thumb, url: v.url, who: a.username ? '@' + a.username : null, vf: v.recipe.vf, rid: v.recipe.file || v.recipe.vf }); }); });
    vids.sort(function (a, b) { return b.ms - a.ms; });
    var inP = vids.filter(function (v) { return v.ms >= from; });
    var sum = function (k) { return inP.reduce(function (a, v) { return a + (v[k] || 0); }, 0); };
    var views = sum('views'), likes = sum('likes'), comments = sum('comments');
    // abonnés : total actuel + gain sur la période (Instagram : net des Insights ; YouTube : écart entre relevés)
    var subs = 0, subsOk = false, gain = 0, gainOk = false;
    if (ytD && ytD.channel.subscribers != null) {
      subs += ytD.channel.subscribers; subsOk = true;
      var H = ytD.history.filter(function (h) { return h.subscribers != null; }), h0 = H.filter(function (h) { return ymdDate(h.day).getTime() >= from; })[0];
      if (h0 && H.length > 1 && h0 !== H[H.length - 1]) { gain += H[H.length - 1].subscribers - h0.subscribers; gainOk = true; }
    }
    // TikTok (07/10) : abonnés actuels de chaque compte + écart entre relevés quotidiens (social_daily, écrit par tiktok-auth)
    var ttH = T.data ? T.data.history : [];
    ttA.forEach(function (a) {
      if (a.followers == null) return;
      subs += a.followers; subsOk = true;
      var H = ttH.filter(function (h) { return h.account === a.username && h.subscribers != null; }), h0 = H.filter(function (h) { return ymdDate(h.day).getTime() >= from; })[0];
      if (h0 && H.length > 1 && h0 !== H[H.length - 1]) { gain += H[H.length - 1].subscribers - h0.subscribers; gainOk = true; }
    });
    // 07/10 (Axel : « — abonnés » sur Instagram en All time) : le total d'abonnés est une valeur ACTUELLE, la même quelle
    // que soit la période → repli sur la fenêtre de l'Accueil (30 j, toujours chargée) ; le gain, lui, reste celui de la période
    var igNow = sel.ig ? [igD, CF.acct.ig[HOME_RANGE].data].filter(function (d) { return d && d.followers != null; })[0] : null;
    if (igNow && !(igD && igD.followers != null)) { subs += igNow.followers; subsOk = true; }
    if (sel.ig && igD && igD.followers != null) {
      subs += igD.followers; subsOk = true;
      var net = igD.followersBase ? igD.followers - igD.followersBase.followers : (igD.flow ? (igD.flow.parts.FOLLOWER || 0) - (igD.flow.parts.NON_FOLLOWER || 0) : null);
      if (net != null) { gain += net; gainOk = true; }
    }
    // courbe : un point par jour (période), par date de publication ; abonnés = gain du jour
    var nD = days || Math.max(30, Math.ceil((now - NET_ALL_FROM) / 864e5) + 1);
    var labels = [], idx = {};
    for (var i = nD - 1; i >= 0; i--) { var d = new Date(now - i * 864e5), key = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); idx[key] = labels.length; labels.push(key); }
    var zero = function () { return labels.map(function () { return 0; }); };
    var S = { labels: labels, videos: zero(), views: zero(), likes: zero(), comments: zero(), subs: labels.map(function () { return null; }) };
    inP.concat(days ? [] : []).forEach(function (v) {
      var d = new Date(v.ms), key = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), j = idx[key];
      if (j == null) return;
      S.videos[j] += 1; S.views[j] += v.views || 0; S.likes[j] += v.likes || 0; S.comments[j] += v.comments || 0;
    });
    if (igD && igD.series) igD.series.forEach(function (x) { var j = idx[x.d]; if (j != null && x.follows != null) S.subs[j] = (S.subs[j] || 0) + x.follows - (x.unfollows || 0); });
    if (ytD) { var HH = ytD.history; for (var k = 1; k < HH.length; k++) { var jj = idx[HH[k].day]; if (jj != null && HH[k].subscribers != null && HH[k - 1].subscribers != null) S.subs[jj] = (S.subs[jj] || 0) + HH[k].subscribers - HH[k - 1].subscribers; } }
    ttA.forEach(function (a) {
      var TH = ttH.filter(function (h) { return h.account === a.username && h.subscribers != null; });
      for (var q = 1; q < TH.length; q++) { var tj = idx[TH[q].day]; if (tj != null) S.subs[tj] = (S.subs[tj] || 0) + TH[q].subscribers - TH[q - 1].subscribers; }
    });
    var nDays = days || nD, perDay = inP.length / nDays, vpv = inP.length ? views / inP.length : null;
    var growth = gainOk && subs - gain > 0 ? gain / (subs - gain) * 100 : null;
    return { R: R, days: days, sel: sel, pend: pend, err: err, vids: vids, inP: inP, S: S,
      c: {
        subs: { v: subsOk ? subs : null, rate: growth, rateTxt: growth == null ? 'croissance : relevé en cours' : (growth >= 0 ? '+' : '') + fDec(growth, 1) + NB + '% sur la période', goal: '≥ +' + NET_GOAL.subs + NB + '%', ok: growth == null ? null : growth >= NET_GOAL.subs, lg: gainOk ? gain : null },
        videos: { v: inP.length, rate: perDay * 100 / NET_GOAL.videosPerDay, rateTxt: fDec(perDay, 1) + ' / jour · ' + fDec(perDay * 100 / NET_GOAL.videosPerDay, 0) + NB + '% de l’objectif', goal: NET_GOAL.videosPerDay + ' / jour', ok: perDay >= NET_GOAL.videosPerDay },
        views: { v: views, rateTxt: vpv == null ? 'aucune vidéo sur la période' : fInt(vpv) + ' vues / vidéo · ' + fDec(vpv / NET_GOAL.viewsPerVideo * 100, 0) + NB + '% de l’objectif', goal: '≥ ' + fInt(NET_GOAL.viewsPerVideo) + ' / vidéo', ok: vpv == null ? null : vpv >= NET_GOAL.viewsPerVideo },
        likes: { v: likes, rateTxt: views ? fDec(likes / views * 100, 1) + NB + '% des vues' : '—', goal: '≥ ' + GOAL.like.target + NB + '%', ok: views ? likes / views * 100 >= GOAL.like.target : null },
        comments: { v: comments, rateTxt: views ? fDec(comments / views * 100, 1) + NB + '% des vues' : '—', goal: '≥ ' + GOAL.comment.target + NB + '%', ok: views ? comments / views * 100 >= GOAL.comment.target : null }
      } };
  }
  function igFollowersNow() {
    var L = [CF.acct.ig[netRange()].data, CF.acct.ig[HOME_RANGE].data].filter(function (d) { return d && d.followers != null; });
    return L.length ? L[0].followers : null;
  }
  function netPfHTML(M) {
    var Y = CF.yt.data, ig = CF.acct.accounts.own || [];
    var tt = ttLive();
    return '<div class="cf-icards cf-acards cf-net-pf">' + NET_PF.map(function (p) {
      // TikTok sans compte relié pour les stats : carte inerte qui renvoie vers « Statistiques TikTok »
      if (p.k === 'tt' && !tt.length) return '<div class="cf-icard cf-acard is-none" style="--c:' + p.c + '"><span class="cf-icard-h"><span class="cf-icard-tile">' + svg(p.ic, 14) + '</span><span class="cf-icard-l">' + p.label + '</span></span>'
        + '<span class="cf-icard-v is-na">' + (CF.tts.loading && !CF.tts.data ? '…' : '—') + '</span><span class="cf-icard-s">'
        + (CF.tts.state === 'error' ? 'stats illisibles' : CF.tts.data ? 'aucun compte relié pour les stats' : 'chargement') + '</span></div>';
      var on = !!M.sel[p.k], sub = p.k === 'yt' ? (Y ? Y.channel.handle : '@ialebdaxel')
        : p.k === 'tt' ? tt.map(function (a) { return a.username ? '@' + a.username : a.name || 'compte TikTok'; }).join(' · ')
        : ig.map(function (a) { return '@' + a.username; }).join(' · ') || '@avataradss · @leoadsia';
      var ttSubs = tt.filter(function (a) { return a.followers != null; });
      var subs = p.k === 'yt' ? (Y ? Y.channel.subscribers : null)
        : p.k === 'tt' ? (ttSubs.length ? ttSubs.reduce(function (s, a) { return s + a.followers; }, 0) : null)
        : igFollowersNow();   // 07/10 : total actuel, repli sur la fenêtre de l'Accueil
      return '<div class="cf-icard cf-acard' + (on ? ' is-on' : ' is-off') + '" style="--c:' + p.c + '">'
        + '<button type="button" class="cf-acard-hit" data-act="net-pf" data-k="' + p.k + '" aria-pressed="' + on + '" aria-label="' + esc(p.label + (on ? ' affiché' : ' masqué')) + '"></button>'
        + '<span class="cf-icard-h"><span class="cf-icard-tile">' + svg(p.ic, 14) + '</span><span class="cf-icard-l">' + p.label + '</span>'
        + '<span class="cf-icard-ck" aria-hidden="true">' + (on ? svg('M5 12l5 5L20 7', 10) : '') + '</span></span>'
        + '<span class="cf-icard-v' + (subs == null ? ' is-na' : '') + '">' + esc(subs == null ? '—' : fInt(subs)) + '<span class="cf-acard-unit">abonnés</span></span>'
        + '<span class="cf-icard-s cf-acard-s">' + esc(sub) + '</span></div>';
    }).join('') + '</div>';
  }
  function netCardsHTML(M) {
    return '<div class="cf-icards cf-net-cards">' + NET_SER.map(function (s) {
      var m = M.c[s.k], on = !(ui.netHidden || {})[s.k];
      var v = M.pend ? '…' : m.v == null ? '—' : fInt(m.v);
      var goal = m.ok == null ? '<span class="cf-goal-t">objectif ' + esc(m.goal) + '</span>' : '<span class="cf-goal-t ' + (m.ok ? 'is-ok' : 'is-ko') + '">objectif ' + esc(m.goal) + '</span>';
      return '<button type="button" class="cf-icard ' + (on ? 'is-on' : 'is-off') + '" style="--c:' + s.c + '" data-act="net-ser" data-k="' + s.k + '" aria-pressed="' + on + '">'
        + '<span class="cf-icard-h"><span class="cf-icard-tile">' + svg(s.ic, 14) + '</span><span class="cf-icard-l">' + esc(s.label) + '</span>'
        + '<span class="cf-icard-ck" aria-hidden="true">' + (on ? svg('M5 12l5 5L20 7', 10) : '') + '</span></span>'
        + '<span class="cf-icard-v' + (m.v == null && !M.pend ? ' is-na' : '') + '">' + esc(v) + '</span>'
        + '<span class="cf-icard-s">' + esc(M.pend ? 'chargement' : m.rateTxt) + '</span>'
        + '<span class="cf-icard-x">' + goal + '</span></button>';
    }).join('') + '</div>';
  }
  function netChartHTML(M) {
    var S = M.S, n = S.labels.length, hid = ui.netHidden || {}, act = NET_SER.filter(function (s) { return !hid[s.k]; });
    var max = 1;
    act.forEach(function (s) { S[s.k].forEach(function (v) { if (v != null && Math.abs(v) > max) max = Math.abs(v); }); });
    var top = Math.max(2, Math.ceil(Math.log10(max + 1)));
    var Yf = function (v) { return 300 - (Math.log10(Math.max(0, v) + 1) / top) * 290; };
    var Xp = function (i) { return n > 1 ? i / (n - 1) * 1000 : 500; };
    var paths = act.map(function (s) {
      var d = '', pen = false;
      S[s.k].forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? ' L' : ' M') + Xp(i).toFixed(1) + ',' + Yf(v).toFixed(1); pen = true; });
      return d ? '<path d="' + d.trim() + '" style="stroke:' + s.c + '" fill="none" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' : '';
    }).join('');
    var ticks = []; for (var e = 0; e <= top; e++) { var tv = e ? Math.pow(10, e) : 0; ticks.push({ label: e ? fK(tv) : '0', top: Yf(tv) / 3 }); }
    var y = ticks.map(function (t) { return '<span style="top:' + t.top.toFixed(2) + '%">' + esc(t.label) + '</span>'; }).join('');
    var grid = ticks.map(function (t, i) { return '<i class="cf-evo-grid' + (i ? '' : ' is-zero') + '" style="top:' + t.top.toFixed(2) + '%"></i>'; }).join('');
    var xi = [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(3 * (n - 1) / 4), n - 1].filter(function (v, i, a) { return a.indexOf(v) === i; });
    var xl = xi.map(function (i) { return '<span>' + esc(dm(ymdDate(S.labels[i]))) + '</span>'; }).join('');
    var lg = NET_SER.map(function (s) {
      var m = M.c[s.k], v = s.k === 'subs' ? (m.lg == null ? '—' : fSigned(m.lg)) : (m.v == null ? '—' : fInt(m.v));
      return '<div class="cf-evo-lg' + (hid[s.k] ? ' is-off' : '') + '"><span class="cf-sq" style="background:' + s.c + '"></span><b>' + esc(v) + '</b><span>' + esc(s.k === 'subs' ? 'Abonnés (gain)' : s.label) + '</span></div>';
    }).join('');
    var P = NET_RANGES.filter(function (r) { return r[0] === M.R; })[0];
    netCur = { S: S, n: n, act: act, Y: Yf };
    return '<div class="cf-evo"><div class="cf-evo-h"><h3 class="cf-h2">Évolution · ' + esc(P[1]) + '</h3></div>'
      + '<div class="cf-evo-body"><div class="cf-evo-y" aria-hidden="true">' + y + '</div><div class="cf-evo-main">'
      + '<div class="cf-evo-plot" data-chart="net" role="img" aria-label="Vidéos publiées par jour, échelle logarithmique">' + grid
      + '<svg class="cf-evo-svg" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + paths + '</svg>'
      + '<div class="cf-evo-hover" hidden></div></div>'
      + '<div class="cf-evo-x" aria-hidden="true">' + xl + '</div>'
      + '<div class="cf-meta cf-evo-note">un point par jour · vidéos, vues, likes et commentaires des vidéos publiées ce jour-là · abonnés : gain du jour · échelle logarithmique</div>'
      + '</div><div class="cf-evo-legend"><div class="cf-over">total période</div>' + lg + '</div></div></div>';
  }
  // Bulle de survol de la courbe Réseaux : valeur du jour + cumul depuis le début de la période.
  var netCur = null;
  function netHover(plot, clientX) {
    var ch = netCur;
    if (!ch || ch.n < 1) return;
    var r = plot.getBoundingClientRect();
    if (!r.width) return;
    var i = Math.max(0, Math.min(ch.n - 1, ch.n > 1 ? Math.round((clientX - r.left) / r.width * (ch.n - 1)) : 0));
    var box = plot.querySelector('.cf-evo-hover');
    if (!box || (box._i === i && !box.hidden)) return;
    box._i = i;
    var x = ch.n > 1 ? i / (ch.n - 1) * 100 : 50, dots = '', rows = '';
    ch.act.forEach(function (s) {
      var arr = ch.S[s.k], v = arr[i], cum = 0;
      for (var q = 0; q <= i; q++) cum += arr[q] || 0;
      var fmtV = function (n) { return s.k === 'subs' ? fSigned(n) : fInt(n); };
      if (v != null) dots += '<span class="cf-evo-dot" style="left:' + x + '%;top:' + (ch.Y(v) / 3).toFixed(2) + '%;background:' + s.c + '"></span>';
      rows += '<div class="cf-evo-tr"><span><span class="cf-sq" style="background:' + s.c + '"></span>' + esc(s.label) + '</span><span>' + esc(v == null ? '—' : fmtV(v)) + '</span><b>' + esc(fmtV(cum)) + '</b></div>';
    });
    var d = ymdDate(ch.S.labels[i]);
    box.innerHTML = '<span class="cf-evo-vl" style="left:' + x + '%"></span>' + dots
      + '<div class="cf-evo-tip"><div class="cf-evo-tr is-h"><span>' + esc(d.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ' + dm(d)) + '</span><span>jour</span><span>cumul</span></div>' + rows + '</div>';
    box.hidden = false;
    var tip = box.querySelector('.cf-evo-tip'), W = r.width, w = tip.offsetWidth, px = x / 100 * W;
    tip.style.left = Math.max(0, Math.min(W - w, px + 12 + w <= W ? px + 12 : px - 12 - w)) + 'px';
  }
  // Les vidéos de la période classées par vues : les plus performantes à gauche, les moins performantes à droite.
  function netVerdictHTML(M) {
    var L = M.inP.filter(function (v) { return v.views != null; }).slice().sort(function (a, b) { return b.views - a.views; });
    if (!L.length) return '<div class="cf-empty-s cf-dashed">Aucune vidéo publiée sur la période.</div>';
    var half = Math.ceil(L.length / 2), n = Math.min(ui.netN || 5, half), top = L.slice(0, n), low = L.slice(-n).reverse();
    function row(v, i) {
      var pf = NET_PF.filter(function (p) { return p.k === v.pf; })[0], th = safeUrl(v.thumb || ''), u = safeUrl(v.url || '');
      var rate = v.views ? fDec((v.likes || 0) / v.views * 100, 1) + NB + '% likes' : '';
      return '<div class="cf-net-v"><span class="cf-net-rk">#' + (i + 1) + '</span>'
        + (th ? '<img class="cf-net-th" src="' + esc(th) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '<span class="cf-net-th"></span>')
        // 07/10 (Axel) : ID complet de la recette à côté des vues (Instagram et TikTok = vidéos de l'usine)
        + '<span class="cf-net-b"><span class="cf-net-top"><b>' + esc(fInt(v.views)) + ' vues</b>' + (v.rid ? '<span class="cf-net-id" title="' + esc(v.rid) + '">' + esc(v.rid) + '</span>' : '') + '</span><span class="cf-meta">' + esc([(v.likes == null ? '—' : fInt(v.likes)) + ' likes', (v.comments == null ? '—' : fInt(v.comments)) + ' comm.', rate].filter(Boolean).join(' · ')) + '</span>'
        + '<span class="cf-net-pfb" style="--c:' + pf.c + '">' + svg(pf.ic, 12) + esc(pf.label + (v.who ? ' ' + v.who : '') + ' · ' + dm(new Date(v.ms))) + '</span></span>'
        + (u ? '<a class="cf-net-go" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir la vidéo">' + svg(IC.arrow, 13) + '</a>' : '')
        + '</div>';
    }
    return '<div class="cf-net-cols"><div class="cf-net-col"><div class="cf-over is-ok">les plus performantes</div>' + top.map(row).join('') + '</div>'
      + '<div class="cf-net-col"><div class="cf-over is-ko">les moins performantes</div>' + low.map(row).join('') + '</div>'
      + (n < half ? '<button type="button" class="cf-btn is-sm cf-net-more" data-act="net-more">Voir plus</button>' : '') + '</div>';
  }
  function homeNetHTML() {
    var M = netModel();
    var seg = NET_RANGES.map(function (r) { var on = r[0] === M.R; return '<button type="button" class="cf-seg-b' + (on ? ' is-on' : '') + '" data-act="net-range" data-k="' + r[0] + '" aria-pressed="' + on + '">' + esc(r[1]) + '</button>'; }).join('');
    return '<section class="cf-card cf-net" aria-labelledby="cfNetT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfNetT">Réseaux</h2>'
      + '<span class="cf-meta">coche les réseaux à additionner · Instagram et TikTok : vidéos de l’usine seulement (abonnés : comptes entiers)</span></div>'
      + '<div class="cf-seg" role="group" aria-label="Période">' + seg + '</div></div>'
      + (M.err ? '<div class="cf-empty-s">' + esc(M.err) + '</div>' : '')
      + netPfHTML(M) + netCardsHTML(M) + netChartHTML(M) + netVerdictHTML(M) + '</section>';
  }
  // Likes des reels publiés sur la période + like rate moyen (le MÊME calcul que la carte Objectif « Like rate » de l'onglet
  // Insight : goalValue) + l'objectif, vert s'il est atteint, rouge sinon.
  function homeLikeStat(X) {
    var g = GOAL.like, G = goalValue(X, g), R = X.reels;
    if (X.pending || G.loading) return hstat('likes', '…', 'Likes', 'chargement');
    var L = R ? R.filter(function (p) { return p.likes != null; }) : [];
    if (!L.length) return hstat('likes', '—', 'Likes', G.na || (X.off ? 'compte déconnecté' : 'likes non fournis'));
    var tot = L.reduce(function (a, p) { return a + p.likes; }, 0), ok = goalOk(g, G.v);
    return '<div class="cf-hstat" data-h="likes"><span class="cf-hstat-v">' + esc(fInt(tot))
      + (G.v != null ? '<small>' + esc(' · ' + G.val) + '</small>' : '') + '</span><span class="cf-hstat-l">Likes</span>'
      + '<span class="cf-hstat-s">' + (G.v != null ? '<span class="cf-goal-t ' + (ok ? 'is-ok' : 'is-ko') + '">' + esc(goalTxt(g)) + '</span> · ' : '')
      + esc(L.length + ' ' + plural(L.length, 'reel') + ' ' + X.per) + '</span></div>';
  }
  // ══ Comptes TikTok (Audit 02/10 : app TikTok passée en production le 03/10) ══
  // Liste de CF.tk (colonnes sans secret de tiktok_accounts, état du jeton calculé par le store), « Connecter un compte
  // TikTok » (OAuth, popup ouverte dans le clic) et « Reconnecter » par compte à traiter. Jamais un jeton à l'écran.
  var TK_ST = { valid: ['valide', 'is-ok'], reconnect: ['à reconnecter', 'is-warn'], expired: ['expiré', 'is-ko'], replaced: ['remplacé', ''] };
  function tkName(a) { return a.handle ? '@' + a.handle : a.name || 'compte …' + a.openId.slice(-4); }
  function tkWhy(a) {
    if (a.state === 'replaced') return 'ancienne connexion, compte reconnecté le ' + dmy(new Date(a.replacedAt)) + ' : plus utilisée pour les brouillons';
    if (a.state === 'expired') return 'jeton de rafraîchissement expiré le ' + dmy(new Date(a.refreshExp)) + ' : les brouillons échouent, reconnecte ce compte';
    if (a.state === 'reconnect') {
      return a.reason === 'scope' ? 'autorisation « envoi de vidéos » non accordée : reconnecte en acceptant toutes les autorisations'
        : 'relié avec l’app TikTok de test (Sandbox), avant le passage en production du ' + dmy(new Date(CF.TK_PROD_SINCE)) + ' : jeton refusé, reconnecte ce compte';
    }
    if (a.reason === 'soon') return 'à reconnecter avant le ' + dmy(new Date(a.refreshExp)) + ' (fin du jeton de rafraîchissement)';
    return 'jeton renouvelé tout seul à chaque envoi' + (a.refreshExp != null ? ' · reconnexion à prévoir avant le ' + dmy(new Date(a.refreshExp)) : '');
  }
  function tkRowHTML(a) {
    var st = TK_ST[a.state] || ['—', ''], pic = safeUrl(a.avatar || ''), when = a.updated != null ? new Date(a.updated) : null;
    var soon = a.state === 'valid' && a.reason === 'soon', act = a.state === 'reconnect' || a.state === 'expired' || soon;
    return '<div class="cf-tk-row' + (a.state === 'replaced' ? ' is-old' : '') + '" data-tk="' + esc(a.state) + '">'
      + '<span class="cf-tk-pic" aria-hidden="true">' + svg(IC.tiktok, 16) + (pic ? '<img src="' + esc(pic) + '" alt="" referrerpolicy="no-referrer" decoding="async" loading="lazy">' : '') + '</span>'
      + '<span class="cf-tk-main"><b>' + esc(tkName(a)) + '</b><span class="cf-meta">' + esc((a.handle && a.name ? a.name + ' · ' : '') + 'identifiant …' + a.openId.slice(-4) + (when ? ' · relié le ' + dmy(when) + ' à ' + hm(when) : ''))
        + ' · <button type="button" class="cf-link-btn" data-act="tk-handle" data-k="' + esc(a.openId) + '">' + (a.handle ? 'modifier le @' : 'ajouter le @') + '</button></span></span>'
      + '<span class="cf-tk-st"><span class="cf-tk-chips"><span class="cf-qchip ' + st[1] + '">' + esc(st[0]) + '</span>'
      + (a.own ? '' : '<span class="cf-qchip">hors de nos comptes</span>') + '</span>'
      + '<span class="cf-tk-why' + (soon ? ' is-warn' : '') + '">' + esc(tkWhy(a)) + '</span></span>'
      + (act ? '<button type="button" class="cf-btn is-sm cf-tk-btn" data-act="tk-connect" data-k="' + esc(a.name || '') + '">' + svg(IC.refresh, 13) + 'Reconnecter</button>' : '')
      + (a.state === 'valid' ? '<button type="button" class="cf-btn is-sm cf-tk-btn" data-act="tk-test" data-k="' + esc(a.openId) + '"' + (ui.tkBusy ? ' disabled' : '') + '>' + svg(IC.tiktok, 13) + 'Tester un brouillon</button>' : '')
      + '</div>';
  }
  // Message de la dernière connexion : fenêtre ouverte, échec, compte relié (et lequel : TikTok relie le compte ouvert
  // dans le navigateur, pas forcément celui qu'on voulait reconnecter).
  function tkMsg() {
    var oa = CF.tkOauth, r = ui.tkRecon, D = CF.tk.data;
    if (oa && Date.now() - oa.at < 10 * 60 * 1000 && (!r || oa.at >= r.at)) {
      if (!oa.ok) return '<div class="cf-acct-msg is-err">Connexion TikTok échouée : ' + esc(oa.error) + '</div>';
      var a = D && oa.openId ? D.list.filter(function (x) { return x.openId === oa.openId; })[0] : null;
      var norm = function (s) { return String(s || '').toLowerCase().replace(/\s*\|\s*/g, '|').replace(/\s+/g, ' ').trim(); };   // = tkNorm du store
      if (a && r && r.who && a.name && norm(r.who) !== norm(a.name)) {
        return '<div class="cf-acct-msg is-err">' + esc('« ' + a.name + ' » a été relié au lieu de « ' + r.who + ' » (compte ouvert dans TikTok). Déconnecte-toi de TikTok, ou passe par une fenêtre privée, puis reconnecte « ' + r.who + ' ».') + '</div>';
      }
      if (a && !a.own) return '<div class="cf-acct-msg is-err">' + esc('« ' + tkName(a) + ' » relié, mais ce nom ne fait pas partie de nos comptes TikTok (' + CF.TK_OWN_NAMES.join(', ') + ').') + '</div>';
      return '<div class="cf-acct-msg is-ok">' + esc('Compte TikTok relié' + (a ? ' : « ' + tkName(a) + ' »' : '') + '.' + (CF.tk.loading || !a ? ' Relecture de la liste…' : '')) + '</div>';
    }
    return r ? '<div class="cf-acct-msg' + (r.ok ? '' : ' is-err') + '">' + esc(r.text)
      + (r.caption ? '<div class="cf-meta" style="margin-top:6px;white-space:pre-wrap">' + esc(r.caption) + '</div><button type="button" class="cf-link-btn" data-act="tk-copy">' + (r.copied ? 'Légende copiée' : 'Copier la légende') + '</button>' : '')
      + '</div>' : '';
  }
  function tkHTML() {
    var S = CF.tk, D = S.data, L = D ? D.list : [];
    var live = L.filter(function (a) { return a.state !== 'replaced'; }), ok = live.filter(function (a) { return a.state === 'valid'; }).length;
    var sub = D ? (live.length ? 'comptes prêts pour les brouillons : ' + ok + ' / ' + live.length : 'aucun compte relié')
      : S.state === 'error' ? 'liste illisible' : 'chargement…';
    var body = '';
    if (S.state === 'error') {
      body += '<div class="cf-acct-msg is-err">Comptes TikTok illisibles : ' + esc(S.error) + (D ? esc(' · liste du ' + hm(new Date(D.fetchedAt)) + ' conservée') : '')
        + ' <button type="button" class="cf-link-btn" data-act="retry-tk">Réessayer</button></div>';
    }
    if (!D && S.state !== 'error') body += '<div class="cf-status" role="status"><span class="cf-spin" aria-hidden="true"></span>Chargement des comptes TikTok…</div>';
    else if (D && !L.length) body += '<div class="cf-empty-s cf-dashed">Aucun compte TikTok relié : clique « Connecter un compte TikTok ».</div>';
    else if (D) body += '<div class="cf-tk-list">' + L.map(tkRowHTML).join('') + '</div>' + (D.capped ? '<div class="cf-meta">liste limitée aux 100 connexions les plus récentes</div>' : '');
    return '<section class="cf-card cf-tk" id="cfTkSec" aria-labelledby="cfTkT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfTkT">Comptes TikTok</h2>'
      + '<div class="cf-dim">' + esc('Brouillons TikTok (anti-shadowban) · ' + sub) + '</div></div>'
      + '<button type="button" class="cf-btn is-dark" data-act="tk-connect" data-k="">' + svg(IC.tiktok, 14) + 'Connecter un compte TikTok</button></div>'
      + tkMsg() + body + '</section>';   // 07/10 (Axel) : plus de texte d'aide sous la liste
  }
  // ══ Statistiques TikTok (07/10) ══
  // Comptes reliés avec les scopes de stats (user.info.profile : le @ ; user.info.stats : abonnés, likes, nombre de vidéos ;
  // video.list : vues, likes, commentaires et partages de chaque vidéo). Tant que la revue TikTok de ces scopes n'est pas
  // passée, la connexion se fait avec l'app de test (Sandbox) : seuls les comptes ajoutés comme utilisateurs test peuvent
  // l'autoriser. Ces comptes ne servent jamais aux brouillons (table à part). Jamais de jeton à l'écran.
  function ttsMsg() {
    var oa = CF.ttsOauth, r = ui.ttsRecon;
    if (oa && Date.now() - oa.at < 10 * 60 * 1000 && (!r || oa.at >= r.at)) {
      return oa.ok ? '<div class="cf-acct-msg is-ok">' + esc('Statistiques TikTok reliées.' + (CF.tts.loading ? ' Lecture des chiffres…' : '')) + '</div>'
        : '<div class="cf-acct-msg is-err">' + esc('Connexion TikTok (stats) échouée : ' + oa.error) + '</div>';
    }
    return r ? '<div class="cf-acct-msg' + (r.ok ? '' : ' is-err') + '">' + esc(r.text) + '</div>' : '';
  }
  var TT_HOST = /(^|\.)tiktok\.com$/i;
  var TT_SHARE = 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13';
  function ttsK(v) { return v >= 1e6 ? fDec(v / 1e6, 1) + NB + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'k' : v >= 1e3 ? fDec(v / 1e3, 1) + 'k' : String(v); }
  function ttsVidHTML(v) {
    var th = safeUrl(v.thumb || ''), u = safeUrl(v.url || '', TT_HOST);
    // jamais de loading="lazy" ici : l'Accueil se redessine à chaque donnée reçue et Safari relançait l'attente à chaque fois
    var inner = (th ? '<img src="' + esc(th) + '" alt="" decoding="async" referrerpolicy="no-referrer">' : '<span class="cf-tts-ph">' + svg(IC.tiktok, 18) + '</span>')
      + '<span class="cf-tts-vv">' + svg(IC.eye, 11) + esc(v.views == null ? '—' : ttsK(v.views)) + '</span>';
    var st = [['likes', IC.heart, v.likes], ['commentaires', IC.chat, v.comments], ['partages', TT_SHARE, v.shares]].map(function (x) {
      return '<span title="' + esc(x[0]) + '">' + svg(x[1], 11) + esc(x[2] == null ? '—' : ttsK(x[2])) + '</span>';
    }).join('');
    return '<div class="cf-tts-v">' + (u ? '<a class="cf-tts-cov" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir la vidéo sur TikTok">' + inner + '</a>' : '<span class="cf-tts-cov">' + inner + '</span>')
      + '<span class="cf-tts-st" aria-label="' + esc([(v.likes == null ? '—' : fInt(v.likes)) + ' likes', (v.comments == null ? '—' : fInt(v.comments)) + ' commentaires', (v.shares == null ? '—' : fInt(v.shares)) + ' partages'].join(', ')) + '">' + st + '</span>'
      + (v.ms != null ? '<span class="cf-meta">' + esc(dm(new Date(v.ms))) + '</span>' : '') + ttsRecipeHTML(v) + '</div>';
  }
  // Recette de la vidéo TikTok (07/10) : vidéo de l'usine reconnue par sa couverture (première image), ou 2-3 propositions
  // à départager d'un clic (posters côte à côte), ou « hors usine » (ancienne vidéo, autre montage).
  function ttsRecipeHTML(v) {
    var R = v.recipe;
    if (!R) return '<span class="cf-tts-rc is-wait">rapprochement en cours</span>';
    // « relier… » (07/10) : taper le VF à la main — vidéo supprimée du stockage (poster seul) ou reconnaissance à corriger
    var relink = '<button type="button" class="cf-link-btn cf-tts-relink" data-act="tts-relink" data-id="' + esc(v.id) + '"' + (ui.ttsBusy ? ' disabled' : '') + '>'
      + (R.state === 'none' ? 'relier…' : 'corriger') + '</button>';
    if (R.state === 'none') return '<span class="cf-tts-rcl"><span class="cf-tts-rc is-none" title="Couverture différente de toutes les vidéos de l’usine">hors usine</span>' + relink + '</span>';
    if (R.vf) {
      var why = R.state === 'auto' ? 'reconnue par sa couverture' + (R.score != null ? ' (écart ' + fDec(R.score, 1) + ')' : '') : 'choisie à la main';
      return '<span class="cf-tts-rcl"><span class="cf-tts-rc is-ok" title="' + esc((R.file || R.vf) + ' · ' + why) + '">' + svg(IC.check, 11) + esc(R.vf) + '</span>' + relink + '</span>';
    }
    return '<span class="cf-tts-rc is-warn">à vérifier : laquelle ?</span><span class="cf-tts-cands">' + R.candidates.map(function (c) {
      var po = safeUrl(c.poster || '');
      return '<button type="button" class="cf-tts-cand" data-act="tts-link" data-id="' + esc(v.id) + '" data-vf="' + esc(c.vf) + '"'
        + ' title="' + esc((c.file || c.vf) + ' · écart ' + (c.score == null ? '—' : fDec(c.score, 1))) + '"' + (ui.ttsBusy ? ' disabled' : '') + '>'
        + (po ? '<img src="' + esc(po) + '" alt="" decoding="async">' : '') + '<span>' + esc(c.vf) + '</span></button>';
    }).join('') + '<button type="button" class="cf-tts-cand is-none" data-act="tts-link" data-id="' + esc(v.id) + '" data-vf=""' + (ui.ttsBusy ? ' disabled' : '') + '>aucune</button></span>';
  }
  function ttsRelink(id) {
    var v = window.prompt('Numéro de la vidéo de l’usine (ex. VF-0026 ou 26). Vide = pas une vidéo de l’usine.', '');
    if (v == null) return;
    v = String(v).trim().toUpperCase().replace(/^VF-?/, '');
    if (v && !/^\d{1,4}$/.test(v)) { ui.ttsRecon = { ok: false, at: Date.now(), text: 'Numéro invalide : tape par exemple VF-0026 ou 26.' }; schedule(); return; }
    ttsLink(id, v ? 'VF-' + ('000' + v).slice(-4) : '');
  }
  function ttsLink(id, vf) {
    ui.ttsBusy = true; schedule();
    CF.ttLink(id, vf).then(function (r) {
      ui.ttsBusy = false;
      if (!r.ok) ui.ttsRecon = { ok: false, at: Date.now(), text: 'Rattachement impossible : ' + r.error };
      schedule();
    });
  }
  function ttsAcctHTML(a) {
    var pic = safeUrl(a.avatar || ''), name = a.username ? '@' + a.username : a.name || 'compte TikTok';
    var nums = a.error ? '' : '<span class="cf-tts-nums">'
      + [['abonnés', a.followers], ['likes', a.likes], ['vidéos', a.videoCount], ['abonnements', a.following]].map(function (x) {
        return '<span><b>' + esc(x[1] == null ? '—' : fInt(x[1])) + '</b>' + esc(x[0]) + '</span>';
      }).join('') + '</span>';
    var vids = a.videos.slice(0, 6);
    return '<div class="cf-tts-acct"><div class="cf-tk-row">'
      + '<span class="cf-tk-pic" aria-hidden="true">' + svg(IC.tiktok, 16) + (pic ? '<img src="' + esc(pic) + '" alt="" referrerpolicy="no-referrer" decoding="async">' : '') + '</span>'
      + '<span class="cf-tk-main"><b>' + esc(name) + '</b><span class="cf-meta">' + esc((a.username && a.name ? a.name + ' · ' : '') + (a.env === 'sandbox' ? 'app de test (Sandbox)' : 'app en production')) + '</span></span>'
      + (a.error ? '<span class="cf-tk-st"><span class="cf-qchip is-ko">illisible</span><span class="cf-tk-why">' + esc(a.error) + '</span></span>' : nums)
      + (a.error ? '<button type="button" class="cf-btn is-sm cf-tk-btn" data-act="tts-connect">' + svg(IC.refresh, 13) + 'Reconnecter</button>' : '')
      + '</div>'
      + (a.error ? '' : a.videosError ? '<div class="cf-meta">' + esc(a.videosError) + '</div>'
        : vids.length ? '<div class="cf-tts-vids">' + vids.map(ttsVidHTML).join('') + '</div>'
        : '<div class="cf-empty-s cf-dashed">Aucune vidéo publique sur ce compte.</div>')
      + '</div>';
  }
  function ttsHTML() {
    var S = CF.tts, D = S.data, L = D ? D.accounts : [];
    var sub = D ? (L.length ? L.length + ' ' + plural(L.length, 'compte relié', 'comptes reliés') + ' · lu à ' + hm(new Date(D.fetchedAt)) : 'aucun compte relié')
      : S.state === 'error' ? 'stats illisibles' : 'chargement…';
    var body = '';
    if (S.state === 'error') {
      body += '<div class="cf-acct-msg is-err">Statistiques TikTok illisibles : ' + esc(S.error) + (D ? esc(' · chiffres de ' + hm(new Date(D.fetchedAt)) + ' conservés') : '')
        + ' <button type="button" class="cf-link-btn" data-act="retry-tts">Réessayer</button></div>';
    }
    if (!D && S.state !== 'error') body += '<div class="cf-status" role="status"><span class="cf-spin" aria-hidden="true"></span>Lecture des statistiques TikTok…</div>';
    else if (D && !L.length) body += '<div class="cf-empty-s cf-dashed">Aucun compte relié pour les stats : clique « Connecter pour les stats ».</div>';
    else if (D) body += '<div class="cf-tk-list">' + L.map(ttsAcctHTML).join('') + '</div>';
    return '<section class="cf-card cf-tk cf-tts" id="cfTtsSec" aria-labelledby="cfTtsT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfTtsT">Statistiques TikTok</h2>'
      + '<div class="cf-dim">' + esc('@, abonnés, likes et vues de chaque vidéo · ' + sub) + '</div></div>'
      + '<div class="cf-tts-acts">' + (D && L.length ? '<button type="button" class="cf-btn is-sm" data-act="retry-tts"' + (S.loading ? ' disabled' : '') + '>' + svg(IC.refresh, 13) + 'Actualiser</button>' : '')
      + '<button type="button" class="cf-btn is-dark" data-act="tts-connect">' + svg(IC.tiktok, 14) + 'Connecter pour les stats</button></div></div>'
      + ttsMsg() + body + '</section>';   // 07/10 (Axel) : plus de texte d'aide sous la liste
  }
  function ttsStart() {
    var at = Date.now();
    CF.tkConnect('sandbox').then(function (r) {   // la popup s'ouvre avant tout await
      ui.ttsRecon = r.ok ? { ok: true, at: at, text: 'Fenêtre TikTok ouverte : connecte-toi avec le compte à relier, puis autorise AvatarAds. Les chiffres s’affichent tout seuls.' }
        : { ok: false, at: at, text: 'Connexion TikTok impossible : ' + r.error };
      schedule();
    });
  }
  // @ saisi à la main (06/10) : l'app TikTok ne donne que le nom affiché, pas le @
  function tkHandle(openId) {
    var a = (CF.tk.data ? CF.tk.data.list : []).filter(function (x) { return x.openId === openId; })[0];
    if (!a) return;
    var v = window.prompt('@ TikTok de « ' + (dlgName(a.name) || 'ce compte') + ' » (vide pour l’effacer) :', a.handle ? '@' + a.handle : '@');   // 18/10 (R7-10)
    if (v === null) return;
    v = String(v).trim().replace(/^@+/, '');
    if (v && !/^[A-Za-z0-9._]{2,24}$/.test(v)) { ui.tkRecon = { ok: false, at: Date.now(), text: '@ invalide : lettres, chiffres, points et _ uniquement (2 à 24).' }; schedule(); return; }
    CF.tkSetHandle(openId, v).then(function (r) {
      ui.tkRecon = r.ok ? { ok: true, at: Date.now(), text: v ? '@' + v + ' enregistré pour « ' + (a.name || 'ce compte') + ' ».' : '@ effacé.' }
        : { ok: false, at: Date.now(), text: 'Enregistrement du @ impossible : ' + r.error };
      schedule();
    });
  }
  // Test « brouillon TikTok » (06/10) : prochaine vidéo du kit → brouillons du compte, légende à copier-coller
  function tkTest(openId) {
    var a = (CF.tk.data ? CF.tk.data.list : []).filter(function (x) { return x.openId === openId; })[0];
    if (!a || ui.tkBusy) return;
    if (!window.confirm('Envoyer la prochaine vidéo du kit dans les brouillons TikTok de ' + dlgName(tkName(a)) + ' ?')) return;   // 18/10 (R7-10)
    ui.tkBusy = true;
    ui.tkRecon = { ok: true, at: Date.now(), text: 'Préparation de l’envoi vers ' + tkName(a) + '…' }; schedule();
    CF.tkSendTest(openId, function (t) { ui.tkRecon = { ok: true, at: Date.now(), text: t }; schedule(); }).then(function (r) {
      ui.tkBusy = false;
      ui.tkRecon = r.ok
        ? { ok: true, at: Date.now(), caption: r.caption, text: 'Vidéo livrée dans les brouillons de ' + tkName(a) + ' (' + r.mb + ' Mo). Ouvre TikTok : notification « Ton contenu de AvatarAds est prêt », touche-la, puis colle la légende :' }
        : { ok: false, at: Date.now(), text: 'Brouillon TikTok non livré : ' + r.error };
      schedule();
    });
  }
  function tkStart(who) {
    var at = Date.now();
    who = String(who || '').slice(0, 80);
    CF.tkConnect().then(function (r) {   // tkConnect ouvre la popup avant tout await
      ui.tkRecon = r.ok
        ? { ok: true, at: at, who: who || null, text: who
          ? 'Fenêtre TikTok ouverte : connecte-toi avec « ' + who + ' » (pas un autre compte), puis autorise AvatarAds. La liste se met à jour toute seule.'
          : 'Fenêtre TikTok ouverte : connecte-toi avec le compte à relier, puis autorise AvatarAds. La liste se met à jour toute seule.' }
        : { ok: false, at: at, who: who || null, text: 'Connexion TikTok impossible : ' + r.error };
      schedule();
    });
  }

  // Carte ou alerte de l'Accueil → l'onglet, sur la MÊME période que la carte (30 j) : on y retrouve les mêmes chiffres.
  function homeGo(k) {
    if (TAB_KEYS.indexOf(k) < 0 || k === 'home') return;
    if (k === 'compte' && ui.range !== HOME_RANGE) { ui.range = HOME_RANGE; evoHide(); }
    if (k === 'dm' && ui.dmRange !== HOME_DM) { ui.dmRange = HOME_DM; ui.dmAllLeads = false; ui.dmAllPosts = false; dmHide(); }
    setTab(k);
    try { window.scrollTo(0, 0); } catch (e) { /* rien */ }
    var b = $('cfTab-' + k);
    if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
  }

  // ══ Production (étape 4, Axel 25/09) ══════════════════════════════════════════════════════════════════════════════
  // UN modèle, prodModel(), lu par l'onglet Production ET la carte Production de l'Accueil (vidéos à générer, jours de
  // contenu, variantes, file QC…) : jamais deux calculs du même chiffre. La règle de cohérence vient d'usine/coherence.js
  // (window.CF_COHERENCE), source unique partagée avec usine/publish-qc.mjs. Rythme de publication = « Reels par jour »
  // sur 30 j de l'onglet Insight (goalValue), rien n'est recalculé à côté.
  var COH = window.CF_COHERENCE || null;
  var MX = window.CF_HOOK_LIAISON || null;   // matrice hook × liaison validée par Axel (usine/hook-liaison.js, générée)
  var PK = [   // les 8 types de la bibliothèque (maquette §13), dans l'ordre de la maquette
    { k: 'hook', t: 'Hook', ic: 'zap', sub: 'hooks' },
    { k: 'liaison', t: 'Liaison', ic: 'link', sub: 'phrases de liaison' },
    { k: 'contenu', t: 'Contenu / Démo', ic: 'demo', sub: 'démos avec la voix d’Axel' },
    { k: 'demo-muette', t: 'Démo sans voix', ic: 'demo', sub: 'texte + CTA incrustés · Texte + musique' },   // 08/10 (Axel : « range correctement les démos no voice »)
    { k: 'cta', t: 'CTA', ic: 'ctaPtr', sub: 'CTA canoniques' },
    { k: 'musique', t: 'Musique', ic: 'music', sub: 'pistes' },
    { k: 'sous-titre', t: 'Sous-titres', ic: 'subs', sub: 'styles' },
    { k: 'transformation', t: 'Transformation', ic: 'swap2', sub: 'transformations' },
    { k: 'avatar', t: 'Avatar', ic: 'user', sub: 'avatars' },
    { k: 'texte-choc', t: 'Texte choc', ic: 'zap', sub: 'phrases choc · Texte + musique' },   // Axel 27/09 (TH01…)
    { k: 'style-choc', t: 'Style texte choc', ic: 'subs', sub: 'styles tirés au hasard' },   // Axel 01/10 (CS01…)
    { k: 'reaction', t: 'Tête choquée', ic: 'user', sub: 'réactions muettes · Texte + musique' },   // Axel 07/10 (R-F1…, Omni Flash 3 s)
    { k: 'insomnie', t: 'Insomnie', ic: 'user', sub: 'n’arrive pas à dormir · Texte + musique' },   // Axel 12/10 (R-I-…, 4 s, au lit yeux fermés)
    { k: 'texte-insomnie', t: 'Texte insomnie', ic: 'zap', sub: '« Tu essaies de dormir mais tu repenses à… »' }   // Axel 12/10 (TI01…), jamais mélangé aux TH
  ];
  var PKM = {};
  PK.forEach(function (x) { PKM[x.k] = x; });
  // case de la bibliothèque d'une brique : une démo SANS voix (C-xxM-…, meta.voice false) a la sienne, à côté des démos parlées
  // 13/10 (Axel : « mettre la première frame pour chaque contenu ») : Safari laisse un lecteur NOIR tant que la vidéo n'est
  // pas lancée ; le fragment #t=0.001 lui fait décoder et afficher la 1re image (sans rien télécharger de plus que preload=metadata).
  function vFirst(u) { u = String(u || ''); return u && u.indexOf('#') < 0 ? u + '#t=0.001' : u; }
  function tileKind(b) {
    if (b.meta && b.meta.format === 'insomnie') return b.kind === 'texte-choc' ? 'texte-insomnie' : 'insomnie';   // format Insomnie (12/10) : son propre onglet
    return b.kind === 'contenu' && (/^C-[A-Z]+M-/.test(String(b.id || '')) || (b.meta && (b.meta.voice === false || b.meta.muette === true))) ? 'demo-muette' : b.kind; }
  // Sélecteurs des briques plus / moins performantes et de la fraîcheur (maquette). Seules les briques PARLÉES (hook,
  // liaison, CTA) sont reconnues dans l'audio des reels : les autres ne sont « pas encore mesurables ».
  var PERF_KINDS = [['hook', 'Hooks'], ['avatar', 'Avatars'], ['cta', 'CTA'], ['liaison', 'Liaisons'], ['contenu', 'Démos'], ['musique', 'Musiques'], ['sous-titre', 'Sous-titres'], ['style-choc', 'Styles choc']];
  var HEARD = { hook: 1, liaison: 1, cta: 1 };
  var FEM = { liaison: 1, musique: 1, contenu: 1 };   // « Démos les plus performantes »
  var NOT_YET = 'pas encore mesurable';   // briques non parlées : pas reconnues dans l'audio des reels (arrivera avec les productions)
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  // Axel 13/10 : « "audio d'Axel" on peut oublier, pas fan de Character-3 pour créer le contenu » → hors des vidéos possibles,
  // du stock à générer et des briques qui manquent (usine/coherence.js, opts.offVoices). Les vidéos déjà faites restent en base.
  var OFF_VOICES = ['axel'];
  var VOICE_SHORT = { axel: 'audio d’Axel', omni: 'voix Omni', aa: 'avant / après', muet: 'texte + musique' };
  // modes de la capacité (usine/coherence.js) : Audio d'Axel, Voix native Omni, Avant / après (3e mode, 26/09)
  // 'muet' (Texte + musique, 27/09) : affiché dès qu'au moins un texte choc est prêt
  function capModes(c) { return (c.modeKeys || c.voices).filter(function (k) { return k !== 'muet' || (c.modes.muet && c.modes.muet.total > 0); }); }
  // hooks lipsync (sans les hooks avant / après, jamais en lipsync) ; ancienne règle sans lipsyncHooks : tous les hooks
  function lipHooks(L) { return L.lipsyncHooks || L.hooks; }
  function fDays(v) { return v < 1 ? '<' + NB + '1' + NB + 'j' : '≈' + NB + fInt(v) + NB + 'j'; }
  function shorten(s, n) { s = String(s || ''); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…'; }
  // 18/10 (round 7, R7-15) : l'ancien sujet « trackads » (module renommé BloxAI le 15/10) s'affiche « bloxai » ; la valeur
  // en base ne change pas (identifiant du catalogue)
  function subjName(s) { return s === 'generique' ? 'générique' : s === 'general' ? 'général' : s === 'trackads' ? 'bloxai' : s; }   // un seul nom par module : l'ID du catalogue (maquette §14)
  function live(b) { return !!b && b.status !== 'retired'; }   // brique retirée : exclue partout (tuiles, listes, capacité, performance)
  function isAlias(b) { return !!(b && b.meta && b.meta.alias_of); }   // H64 = alias de H63 : jamais compté comme un hook de plus
  // proposition de style (sous-titres S20–S24 : brouillon, meta.proposal) : montrée à part, jamais comptée comme prête
  function isProposal(b) { return !!(b && b.meta && b.meta.proposal && b.status !== 'ready'); }
  // photos d'un avatar (meta.images, A1-1…A1-8) ; sinon son portrait seul
  // Vidéos qui utilisent un texte choc (recettes factory_qc, tous formats et statuts) ; null tant que la Production n'est pas lue
  function chocUses(id) { var D = CF.prod && CF.prod.data; return D && D.qc ? D.qc.list.filter(function (q) { return q.texteChoc === id; }).length : null; }
  function avPhotos(b) {
    noteThumbs(b);
    var im = (b && b.meta && b.meta.images || []).map(mediaSrc).filter(Boolean);
    return im.length ? im : b && mediaSrc(b.image) ? [mediaSrc(b.image)] : [];
  }
  function stFr(st) { return COH && COH.statusFr ? COH.statusFr(st) : 'statut inconnu'; }   // jamais le statut brut anglais
  function fRate2(v) { return fDec(v, v >= 10 ? 0 : v >= 1 ? 1 : 2); }

  var pmCache = { ver: -1, m: null };
  function prodModel() {
    if (pmCache.ver === CF.ver && pmCache.m) return pmCache.m;
    var S = CF.prod, D = S.data;
    var M = { S: S, D: D, pending: !D && (S.loading || S.state === 'idle'), cap: null, byId: {},
      why: D ? '' : S.kind === 'forbidden' ? 'lecture refusée par la base' : S.kind === 'missing' ? 'table introuvable' : S.state === 'error' ? 'erreur de chargement' : '',
      // règle (usine/coherence.js) et matrice hook × liaison (usine/hook-liaison.js) : sans elles, jamais un faux chiffre
      ruleShort: !COH ? 'règle de cohérence absente' : !MX ? 'matrice hook × liaison absente' : '',
      ruleWhy: !COH ? 'règle de cohérence absente (usine/coherence.js non chargé)' : !MX ? 'matrice hook × liaison absente (usine/hook-liaison.js non chargé)' : '' };
    if (D) D.bricks.list.forEach(function (b) { M.byId[b.id] = b; });
    if (D && COH && MX) {
      // Vidéos finales (usine/coherence.js, décision d'Axel du 25/09) : court = avatar × hook, long = avatar × hook ×
      // liaison compatible, dans 2 voix (Audio d'Axel, Voix native Omni). Déjà produites = clés voix|avatar|hook|liaison des
      // lignes QC au NOUVEAU format (tout statut ; hook alias → son original) ; démo et CTA ne font pas une nouvelle vidéo.
      var L = COH.library(D.bricks.list), A = L.avatars.length, keys = [], seen = [];
      D.qc.list.forEach(function (q) {
        var k = q.combo ? COH.comboKey(q.combo, M.byId) : null;
        if (!k) return;
        keys.push(k);
        if (q.status !== 'pending') seen.push(k);
      });
      var cap = COH.capacity(D.bricks.list, keys, MX, { demoRequired: true, offVoices: OFF_VOICES });   // 07/10 : module sans démo (motion-control) hors du stock avant / après
      M.L = L; M.cap = cap;
      // générées = clés dont au moins une vidéo est déjà revue (approuvée ou refusée) ; en QC = clés rendues dont AUCUNE
      // vidéo n'est encore revue (un top décliné en QC ne fait pas disparaître sa version approuvée) ; générées + en QC = done
      M.capGen = seen.length ? COH.capacity(D.bricks.list, seen, MX, { demoRequired: true, offVoices: OFF_VOICES }).done : 0;
      M.capPending = cap.done - M.capGen;
      M.genSub = capModes(cap).map(function (v) { return fInt(cap.modes[v].remaining) + ' ' + VOICE_SHORT[v]; }).join(' · ');   // Accueil ET onglet
      // Variantes lipsync (pipeline) : 1 avatar × 1 brique parlée (hooks sans alias + liaisons + CTA) ; générées = factory_prod_stats
      // dictionnaires sans prototype : une paire venue de la base (« constructor », « __proto__ ») ne lit jamais Object.prototype
      var spoken = Object.create(null), avs = Object.create(null), St = D.stats, gen = null, out = 0, byBrick = Object.create(null), vwhy = '';
      lipHooks(L).concat(L.liaisons, L.ctas).forEach(function (b) { spoken[b.id] = 1; });   // hooks avant / après : jamais de lipsync
      var lipAv = avatarsFor(L, 'axel'); A = lipAv.length;   // 08/10 : avatars Omni seulement (A3) hors des variantes lipsync
      lipAv.forEach(function (a) { avs[a.id] = 1; });
      var avOf = function (id) { var p = COH.photoParent ? COH.photoParent(id) : id; return avs[id] ? id : avs[p] ? p : null; };
      if (St && St.state === 'ready' && St.pairsTotal > St.pairs.length) vwhy = 'variantes : liste tronquée par factory_prod_stats';
      else if (St && St.state === 'ready') {
        gen = 0;
        St.pairs.forEach(function (p) {
          if (avOf(p[0]) && spoken[p[1]]) { gen += 1; (byBrick[p[1]] = byBrick[p[1]] || []).push(p[0]); } else out += 1;
        });
      } else if (St) vwhy = St.kind === 'missing' ? 'factory_prod_stats pas encore en base (migration 20260925210000)' : St.kind === 'forbidden' ? 'lecture refusée par la base' : St.error;
      var nSpoken = lipHooks(L).length + L.liaisons.length + L.ctas.length;
      M.vars = { A: A, spoken: nSpoken, possible: A * (COH.PHOTOS_PAR_AVATAR || 1) * nSpoken, gen: gen, out: out, byBrick: byBrick, why: vwhy, St: St };
      M.miss = missModel(M);
    }
    // Rythme de publication : MES reels par jour sur 30 j (le « Reels par jour » de l'onglet Insight, goalValue) + les posts
    // par jour des diffuseurs BloxAI (missions envoyées, série 30 j ; bx = null tant que BloxAI ne la rend pas).
    var S30 = CF.acct.ig[HOME_RANGE], off = S30.kind === 'disconnected' || CF.acct.media.kind === 'disconnected';
    var BXS = CF.bx, BXD = BXS.data, ser = BXD && BXD.series ? BXD.series.slice(-30) : null;
    var bxPerDay = ser && ser.length ? ser.reduce(function (a, x) { return a + (x.submitted || 0); }, 0) / 30 : null;
    var G = goalValue(model(S30, S30.data, off, HOME_RANGE), GOAL.perDay);
    M.rate = { v: G.v == null ? null : G.v + (bxPerDay || 0), bx: bxPerDay, n: G.n, loading: !!G.loading, na: G.na, off: off };
    // 16/10 (Axel : « un seul stock pour tout le monde ») : stock = missions « open » du stock commun BloxAI + vidéos du kit
    // encore à programmer (factory_posts « todo »). Une des deux sources illisible → « — » + raison : l'ancien calcul
    // (approuvées non programmées) compterait aussi les vidéos déjà données aux diffuseurs.
    var bxOpen = BXD ? BXD.stock.open : null, kitT = D ? D.qc.kitTodo : null;
    M.stock = null; M.stockParts = null; M.stockWait = false; M.stockWhy = '';
    if (D && bxOpen != null && kitT != null) { M.stock = bxOpen + kitT; M.stockParts = { open: bxOpen, kit: kitT }; }
    else if (D && kitT == null) M.stockWhy = 'kit illisible (factory_posts)';
    else if (D && !BXD && (BXS.loading || BXS.state === 'idle')) M.stockWait = true;
    else if (D) M.stockWhy = !BXD ? 'stock commun BloxAI illisible' + (BXS.error ? ' : ' + BXS.error : '') : 'stock commun non renvoyé par BloxAI';
    M.stockSub = M.stockParts ? fInt(M.stockParts.open) + ' stock commun + ' + fInt(M.stockParts.kit) + ' kit à programmer' : M.stockWait ? 'chargement' : M.stockWhy;
    M.toGen = M.cap ? M.cap.remaining : null;
    // production / jour = vidéos finales rendues (lignes factory_qc) par jour sur 30 j
    M.prodDay = D ? D.qc.list.filter(function (q) { return q.created != null && Date.now() - q.created <= 30 * 864e5; }).length / 30 : null;
    // Jours de contenu (Axel 29/09 : simple) = vidéos PRÊTES (en stock) ÷ l'objectif de 5 posts / jour. Les vidéos seulement
    // « possibles » n'entrent plus dedans : elles donnaient des milliers de jours qui ne veulent rien dire.
    // 13/10 (Axel) : besoin = le VRAI rythme Instagram (reels publiés, nos comptes, moyenne des 7 derniers jours ; rpc factory_ig_rhythm) ; repli sur l'objectif de 5 / jour
    // tant que rien n'est publié. Sert aux jours de contenu, au besoin / jour et aux jours possibles.
    var ig7 = D && D.qc.ig7 && D.qc.ig7.perDay > 0 ? D.qc.ig7 : null;
    M.need = ig7 ? { v: ig7.perDay, real: true, n: ig7.n } : { v: GOAL.perDay.target, real: false, n: null };
    var d = { v: null, txt: '—', sub: '', wait: false }, goalDay = M.need.v;
    if (M.pending) { d.txt = '…'; d.sub = 'chargement'; d.wait = true; }
    else if (!D) d.sub = M.why;
    else if (M.stock == null) { d.txt = M.stockWait ? '…' : '—'; d.sub = M.stockSub; d.wait = M.stockWait; }
    else { d.v = M.stock / goalDay; d.txt = M.stock ? fDays(d.v) : '0' + NB + 'j'; d.sub = 'vidéos prêtes ÷ ' + fRate2(goalDay) + ' posts' + NB + '/' + NB + 'jour' + (M.need.real ? ' (Instagram, 7' + NB + 'j)' : ''); }
    M.days = d;
    pmCache = { ver: CF.ver, m: M };
    return M;
  }

  // Briques qui manquent, par impact en VIDÉOS FINALES (usine/coherence.js, impact) : +1 avatar, +1 liaison, +1 hook ;
  // démo, CTA et musique sont tirés au hasard : de la variété, +0 vidéo. Au plus 4 lignes (maquette).
  function missModel(M) {
    var c = M.cap, I = COH.impact(c), A = c.avatars, V = c.voices.length;
    if (!c.avatars && !c.hooks && !c.liaisons) return { rows: [], empty: true };
    // sous-titres courts comme la maquette (« 1 variante par avatar »), jamais la formule : A et V restent dans le chiffre
    var per = V > 1 ? ', par avatar et par voix' : ' par avatar', nL = Math.round(I.avgLiaisonsPerHook), nH = Math.round(I.avgHooksPerLiaison);
    var rows = [
      { k: 'avatar', t: '+1 avatar', gain: I.avatar, sub: 'se combine avec les ' + c.lipsyncHooks + ' ' + plural(c.lipsyncHooks, 'hook parlé', 'hooks parlés') + ' et les ' + c.liaisons + ' ' + plural(c.liaisons, 'liaison') + (V > 1 ? ', en ' + V + NB + 'voix' : '') + (c.modes && c.modes.aa && c.modes.aa.total ? ', + l’avant / après' : '') },
      { k: 'liaison', t: '+1 liaison', gain: I.liaison, sub: 's’enchaîne avec ≈' + NB + nH + ' ' + plural(nH, 'hook') + per },
      { k: 'hook', t: '+1 hook', gain: I.hook, sub: '1 format court + ≈' + NB + nL + ' ' + plural(nL, 'long', 'longs') + per }
    ];
    // 13/10 (Axel : « mets à jour les suggestions ») : la brique la moins chère, une tête choquée (photo + 3-4 s de vidéo
    // muette), ajoute ses propres vidéos Texte + musique (une par démo muette, plafond REACTION_DEMOS_MAX = 5)
    var mu = c.modes.muet;
    if (mu && mu.demos) rows.push({ k: 'reaction', t: '+1 tête choquée', gain: Math.min(5, mu.demos), sub: 'réaction muette de 3-4 s + texte choc + démo sans voix · aucune voix ni lipsync à générer' });
    rows.sort(function (a, b) { return b.gain - a.gain; });
    rows.push({ k: 'variety', t: '+1 démo, CTA ou musique', gain: 0, sub: 'tirés au hasard : de la variété, pas une nouvelle vidéo' });
    return { rows: rows, empty: false };
  }

  // Briques reconnues dans l'audio des reels Instagram (même liste que l'onglet Insight) : utilisations, vues, dernière date.
  var biCache = { ver: -1, v: null };
  function brickIndex() {
    if (biCache.ver === CF.ver && biCache.v) return biCache.v;
    var MD = CF.acct.media.data, by = {}, postsV = {}, byId = prodModel().byId;
    (MD ? MD.list : []).forEach(function (p) {
      var a = p.analysis;
      if (!a || a.status !== 'done' || !a.bricks.length) return;
      var seen = {}, kinds = {};
      a.bricks.forEach(function (b) {
        var fb = Object.prototype.hasOwnProperty.call(byId, b.id) ? byId[b.id] : null, id = isAlias(fb) ? fb.meta.alias_of : b.id;   // alias → son original
        if (Object.prototype.hasOwnProperty.call(seen, id)) return;
        seen[id] = 1; kinds[b.kind] = 1;
        var r = Object.prototype.hasOwnProperty.call(by, id) ? by[id] : (by[id] = { id: id, kind: b.kind, n: 0, nv: 0, views: 0, last: null });
        r.n += 1;
        if (p.ms != null && (r.last == null || p.ms > r.last)) r.last = p.ms;
        if (p.views != null) { r.nv += 1; r.views += p.views; }
      });
      if (p.views != null) Object.keys(kinds).forEach(function (k) { postsV[k] = (postsV[k] || 0) + 1; });
    });
    biCache = { ver: CF.ver, v: { by: by, postsV: postsV } };
    return biCache.v;
  }
  function mediaState() {
    var MS = CF.acct.media, MD = MS.data;
    if (MS.kind === 'disconnected' || CF.acct.ig[HOME_RANGE].kind === 'disconnected') return { st: 'off', why: 'compte Instagram déconnecté' };
    if (!MD) return MS.loading || MS.state === 'idle' ? { st: 'wait' } : { st: 'err', why: 'publications indisponibles : ' + (MS.error || 'erreur') };
    if (MD.error && !MD.list.length) return { st: 'err', why: 'publications indisponibles : ' + MD.error };
    return { st: 'ok', MD: MD };
  }
  function spin(t) { return '<div class="cf-status" role="status"><span class="cf-spin" aria-hidden="true"></span>' + esc(t) + '</div>'; }

  function ensureProd() {
    if (CF.status !== 'ready') return;
    CF.loadAccounts();
    CF.loadProd();
    CF.loadBx();   // 16/10 : stock = missions « open » du stock commun BloxAI + kit à programmer
    CF.loadInsights(HOME_RANGE);   // rythme de publication : mêmes cases que l'Accueil (cache 15 min)
    CF.loadMedia();
  }

  function phead(n, t, sub) {
    return '<div class="cf-phead"><span class="cf-pnum">' + n + '</span><h2 class="cf-ph2">' + esc(t) + '</h2>' + (sub ? '<span class="cf-meta">' + esc(sub) + '</span>' : '') + '</div>';
  }
  function chead(t, sub, right) {
    return '<div class="cf-card-h"><div><h3 class="cf-h2">' + esc(t) + '</h3>' + (sub ? '<span class="cf-meta">' + esc(sub) + '</span>' : '') + '</div>' + (right || '') + '</div>';
  }
  function naBody(M) { return M.pending ? spin('Chargement de la production…') : emptyLine('—', M.why || M.ruleWhy); }

  function prodHTML() {
    var M = prodModel();
    return '<div class="cf-prod">' + prodTitleHTML(M) + prodBannerHTML(M)
      + phead('01', 'Vue d’ensemble', 'vidéos possibles · contenu posté · stock · briques manquantes')
      + '<div class="cf-prow2 is-a">' + capHTML(M) + postedHTML() + '</div>'
      + '<div class="cf-prow2 is-b">' + stockHTML(M) + missHTML(M) + '</div>'
      + phead('02', 'Fabrication', '')
      + pipeHTML(M) + qcFileHTML(M)
      + '<div class="cf-prow2 is-b">' + perfCardHTML('top') + perfCardHTML('low') + '</div>'
      + phead('03', 'Briques', 'bibliothèque · assemblages · fraîcheur')
      + bricksTabHTML(M) + '</div>';
  }

  function prodTitleHTML(M) {
    var Q = M.D && M.D.qc, n = Q ? Q.pending : null, k = Q ? Q.unclassified : 0;
    var t = M.pending ? '…' : n == null ? '— · file QC illisible' : n ? fInt(n) + ' ' + plural(n, 'vidéo') + ' à valider' : 'Rien à valider';
    var sub = !Q ? (M.pending ? 'chargement' : M.why) : k ? '' : Q.refused ? 'aucun refus à classer' : 'aucun refus';
    var subH = Q && k ? '<button type="button" class="cf-qcbox-k" data-act="qc-list" data-l="refused">' + esc(fInt(k) + ' ' + plural(k, 'refusée') + ' à classer') + '</button>' : esc(sub);
    // bouton orange toujours présent (maquette) : la revue s'il y a des vidéos à valider, sinon les refus à classer,
    // sinon la file de validation (jamais une revue vide)
    var go = n ? 'data-act="qc-open"' : k ? 'data-act="qc-list" data-l="refused"' : 'data-act="qc-goto"';
    return '<section class="cf-title cf-ptitle"><h1>Production</h1>'
      + '<div class="cf-qcbox' + (n ? ' is-on' : '') + '"><span class="cf-qcbox-ic">' + svg(IC.qc, 18) + '</span>'
      + '<span class="cf-qcbox-t"><b data-qc-n="' + (n == null ? '' : n) + '">' + esc(t) + '</b><span>' + subH + '</span></span>'
      + '<button type="button" class="cf-btn is-acc" ' + go + '>Ouvrir la revue</button></div></section>';
  }
  function prodBannerHTML(M) {
    var S = M.S, D = M.D, out = '', retry = '<button type="button" class="cf-btn is-sm" data-act="retry-prod">Réessayer</button>';
    if (S.state === 'error') out += banner('err', IC.alert, '<b>Production : lecture impossible</b> · ' + esc(S.error) + (D ? ' · chiffres du ' + esc(hm(new Date(D.fetchedAt))) + ' conservés' : ''), retry);
    else if (S.loading && D) out += spin('Actualisation de la production…');
    if (!COH) out += banner('err', IC.alert, '<b>Règle de cohérence absente</b> · usine/coherence.js n’a pas été chargé : vidéos possibles, à générer et jours de contenu restent à « — ».');
    else if (!MX) out += banner('err', IC.alert, '<b>Matrice hook × liaison absente</b> · usine/hook-liaison.js n’a pas été chargé : vidéos possibles, à générer et jours de contenu restent à « — ».');
    if (D && D.stats && D.stats.state !== 'ready') out += banner('warn', IC.alert, '<b>Variantes et missions : —</b> · ' + esc(D.stats.error) + '.', retry);
    if (D && D.qc.classifyMissing && D.qc.refused) out += banner('warn', IC.alert, '<b>« Classer » indisponible</b> · la colonne factory_qc.classified_at n’existe pas encore (migration 20260925210000 à appliquer) : les refus restent « à classer ».');
    return out;
  }

  // ── 01 · Capacité de création : vidéos finales générées / possibles (jauge de la maquette) + les 4 nombres par voix ──
  function capHTML(M) {
    var head = chead('Vidéos possibles', 'avec les briques qu’on a aujourd’hui');
    if (!M.cap) return '<section class="cf-card cf-cap" data-block="cap">' + head + naBody(M) + '</section>';
    var c = M.cap, gen = M.capGen, pct = c.total ? gen / c.total * 100 : null;
    var arc = 'M10 62 A50 50 0 0 1 110 62';
    var gauge = '<div class="cf-gauge"><svg viewBox="0 0 120 68" aria-hidden="true" focusable="false"><path d="' + arc + '" class="cf-gauge-bg"/>'
      + (pct > 0 ? '<path d="' + arc + '" class="cf-gauge-fg" pathLength="100" stroke-dasharray="' + pct.toFixed(1) + ' 100"/>' : '') + '</svg>'
      + '<b class="cf-gauge-v">' + esc(fInt(c.total)) + '</b></div>'
      + '<div class="cf-gauge-l">vidéos finales possibles · <b>' + esc(fInt(gen)) + '</b> déjà ' + plural(gen, 'générée') + '</div>';
    // une ligne par format, un seul nombre (court + long, ou vidéos publiables pour l'avant / après)
    var DESC = { axel: 'tes audios en lipsync', omni: 'voix générée par Omni', aa: 'transformations avant / après', muet: 'texte à l’écran + musique, sans voix' };
    var modes = '<div class="cf-capmodes">' + capModes(c).map(function (v) {
      var m = c.modes[v], d = DESC[v] || (/omni/i.test(m.label) ? DESC.omni : /axel/i.test(m.label) ? DESC.axel : /musique/i.test(m.label) ? DESC.muet : '');
      return '<div class="cf-capmode" data-mode-k="' + v + '"><span class="cf-capmodes-n"><i class="is-' + v + '"></i>' + esc(v === 'omni' ? 'Omni' : m.label)
        + (d ? '<span class="cf-meta"> · ' + esc(d) + '</span>' : '') + '</span><span class="cf-capmode-v"><b>' + esc(fInt(m.total)) + '</b></span></div>';
    }).join('') + '</div>';
    return '<section class="cf-card cf-cap" data-block="cap">' + head + gauge + modes + '</section>';
  }

  // ── 01 · Contenu posté : nos reels par mois (publications Instagram déjà chargées) ; BloxAI = missions publiées par les diffuseurs ──
  function postedHTML() {
    var ms = mediaState(), months = [], total = null, bxDone = CF.bx.data ? CF.bx.data.stock.done : null;
    if (ms.st === 'ok') {
      var reels = ms.MD.list.filter(function (p) { return (p.type === 'REELS' || p.type === 'VIDEO') && p.ms != null; });
      total = reels.length;
      if (reels.length) {
        var now = new Date(), first = new Date(Math.min.apply(null, reels.map(function (p) { return p.ms; })));
        var y = first.getFullYear(), m = first.getMonth(), ny = now.getFullYear(), nm = now.getMonth();
        if ((ny - y) * 12 + (nm - m) > 11) { y = ny - (nm < 11 ? 1 : 0); m = (nm + 1) % 12; }
        while (y < ny || (y === ny && m <= nm)) { months.push({ y: y, m: m, n: 0 }); m += 1; if (m > 11) { m = 0; y += 1; } }
        reels.forEach(function (p) { var d = new Date(p.ms); months.forEach(function (x) { if (x.y === d.getFullYear() && x.m === d.getMonth()) x.n += 1; }); });
      }
    }
    var right = '<div class="cf-ptot"><span><b>' + esc(total == null ? '—' : fInt(total)) + '</b><span><i class="cf-pl is-aa"></i>AvatarAds</span></span>'
      + '<span><b' + (bxDone == null ? ' class="is-na"' : '') + ' title="' + esc(bxDone == null ? bxWhyShort() : 'missions publiées par les diffuseurs BloxAI') + '">' + esc(bxDone == null ? (CF.bx.loading && !CF.bx.data ? '…' : '—') : fInt(bxDone)) + '</b><span><i class="cf-pl is-ta"></i>BloxAI</span></span></div>';
    var body;
    if (ms.st === 'wait') body = spin('Chargement des publications…');
    else if (ms.st !== 'ok') body = emptyLine('—', ms.why);
    else if (!total) body = '<div class="cf-empty-s">Aucun reel publié pour l’instant.</div>';
    else {
      var n = months.length, max = Math.max.apply(null, months.map(function (x) { return x.n; }).concat([1]));
      var X = function (i) { return n > 1 ? i / (n - 1) * 100 : 50; }, Y = function (v) { return 8 + (1 - v / max) * 84; };
      var d = months.map(function (x, i) { return (i ? 'L' : 'M') + (X(i) * 10).toFixed(1) + ',' + (Y(x.n) * 2).toFixed(1); }).join(' ');
      var one = months.every(function (x) { return x.y === months[0].y; });
      body = '<div class="cf-pchart" role="img" aria-label="' + esc('Reels publiés par mois sur @' + selName()) + '">'
        + '<span class="cf-pgrid-l"></span><span class="cf-pgrid-l"></span><span class="cf-pgrid-l is-base"></span>'
        + '<svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="' + d + '" fill="none" stroke="var(--cf-ink)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>'
        + months.map(function (x, i) {
          var pos = 'left:' + X(i).toFixed(2) + '%;top:' + Y(x.n).toFixed(2) + '%';
          return '<span class="cf-pdot" style="' + pos + '"></span><span class="cf-pval' + (n > 1 && i === 0 ? ' is-first' : n > 1 && i === n - 1 ? ' is-last' : '') + '" style="' + pos + '">' + x.n + '</span>';
        }).join('') + '</div>'
        + '<div class="cf-px">' + months.map(function (x, i) {
          return '<span class="' + (n > 6 && (n - 1 - i) % 2 ? 'is-alt' : '') + '">' + esc(MONTHS[x.m] + (one ? '' : ' ' + String(x.y).slice(2))) + '</span>';
        }).join('') + '</div>';
    }
    return '<section class="cf-card cf-posted" data-block="posted">' + chead('Contenu posté', 'reels publiés par mois', right) + body + '</section>';
  }

  // ── 01 · Prévision de stock : une seule durée, « Jours de contenu », la même que l'Accueil ──
  function stockHTML(M) {
    var head = chead('Prévision de stock');
    var D = M.D, d = M.days;
    function tile(k, v, l, s, cls) {
      return '<div class="cf-stile' + (cls ? ' ' + cls : '') + '" data-s="' + k + '"><b class="' + (v === '—' ? 'is-na' : '') + '">' + esc(v) + '</b><span class="cf-stile-l">' + esc(l) + '</span><span class="cf-stile-s">' + esc(s) + '</span></div>';
    }
    var wait = M.pending ? '…' : null;
    var tiles = tile('stock', wait || (!D || M.stock == null ? (M.stockWait ? '…' : '—') : fInt(M.stock)), 'En stock', D ? M.stockSub : M.why, 'is-acc')
      + tile('days', d.txt, 'Jours de contenu', d.sub, d.v != null && d.v < 2 ? 'is-err' : '');
    var need = M.need ? M.need.v : GOAL.perDay.target, pd = M.prodDay;   // 13/10 : rythme Instagram réel (7 j), sinon l'objectif   // besoin = l'objectif de publication (5 / jour)
    var bar = need && pd != null ? Math.min(100, pd / need * 100) : 0;
    var flow = '<div class="cf-sflow"><div class="cf-sflow-l"><span>besoin' + NB + '/' + NB + 'jour · ' + esc(need == null ? '—' : fRate2(need) + ' ' + plural(need, 'vidéo') + (M.need && M.need.real ? ' · moyenne Instagram 7' + NB + 'j' : ' · objectif')) + '</span>'
      + '<span>production' + NB + '/' + NB + 'jour · ' + esc(pd == null ? '—' : fRate2(pd) + ' ' + plural(pd, 'vidéo')) + '</span></div>'
      + '<div class="cf-sflow-b"><i class="' + (need != null && pd != null && pd >= need ? 'is-ok' : '') + '" style="width:' + bar.toFixed(1) + '%"></i></div>'
      + (need != null && pd != null ? (pd >= need ? '<div class="cf-sflow-m is-ok">La production suit le rythme de publication.</div>'
        : '<div class="cf-sflow-m">' + esc('Il manque ' + fRate2(need - pd) + ' ' + plural(need - pd, 'vidéo') + ' par jour.') + '</div>') : '') + '</div>';
    // briques restantes à générer (clips pas encore faits, par format) · jours de contenu si tout le possible était généré
    var G = genVideos(M), NAME = { hook: 'Hooks', liaison: 'Liaisons', cta: 'CTA', 'texte-choc': 'Textes choc' }, left = [];
    if (G) Object.keys(G.kinds).forEach(function (k) { G.kinds[k].forEach(function (x) { var r = x.total - x.done; if (r > 0) left.push({ t: NAME[k] + ' · ' + FMT_SHORT[x.f], r: r }); }); });
    left.sort(function (a, b) { return b.r - a.r; });
    var sumLeft = left.reduce(function (a, x) { return a + x.r; }, 0);
    var todo = '<div class="cf-stile cf-stodo" data-s="left"><b class="' + (G ? '' : 'is-na') + '">' + esc(G ? fInt(sumLeft) : (wait || '—')) + '</b><span class="cf-stile-l">Briques restantes à générer</span><span class="cf-stile-s">clips parlés pas encore faits (hook, CTA, liaison × chaque photo d’avatar), nécessaires pour monter toutes les vidéos possibles</span>'
      + (G ? (left.length ? '<span class="cf-stodo-l">' + left.map(function (x) { return '<span><span>' + esc(x.t) + '</span><b>' + esc(fInt(x.r)) + '</b></span>'; }).join('') + '</span>' : '<span class="cf-stile-s">tout est généré</span>') : '<span class="cf-stile-s">' + esc(M.why || 'chargement') + '</span>') + '</div>';
    var pd2 = M.cap && need ? M.cap.total / need : null;
    // objectif (Axel 29/09) : 1 an de contenu d'avance ; au-delà, on produit et on poste (et on recrute des posteurs)
    var mo = pd2 == null ? null : pd2 / 30.4, okY = mo != null && mo >= 12;
    var poss = '<div class="cf-stile" data-s="possible"><b class="' + (mo == null ? 'is-na' : '') + '">' + esc(wait || (pd2 == null ? '—' : fDays(pd2))) + '</b><span class="cf-stile-l">Jours de contenu possibles</span>'
      + '<span class="cf-stile-s">' + (mo == null ? esc(M.why || '') : esc(fInt(M.cap.total) + ' vidéos possibles ÷ ' + fRate2(need) + ' posts / jour, une fois toutes les briques générées') + '<br>≈' + NB + esc(fDec(mo, 0)) + NB + 'mois · <span class="cf-goal-t ' + (okY ? 'is-ok' : 'is-ko') + '">objectif 12' + NB + 'mois</span>') + '</span></div>';
    return '<section class="cf-card cf-stock" data-block="stock">' + head + '<div class="cf-stiles is-2">' + tiles + '</div>' + flow
      + '<div class="cf-stiles is-2 cf-stiles-b">' + todo + poss + '</div></section>';
  }

  // ── 01 · Briques qui manquent, classées par impact (vidéos finales) ──
  function missHTML(M) {
    var head = chead('Briques qui manquent', 'classées par impact · nouvelles vidéos possibles');
    if (!M.cap) return '<section class="cf-card cf-miss" data-block="miss">' + head + naBody(M) + '</section>';
    var X = M.miss;
    if (X.empty) return '<section class="cf-card cf-miss" data-block="miss">' + head + '<div class="cf-mlist"><div class="cf-mrow" data-m="none"><span class="cf-mbody"><b>Rien à calculer pour l’instant</b>'
      + '<span class="cf-msub">se remplit dès que la bibliothèque contient des briques</span></span></div></div></section>';
    var max = Math.max.apply(null, X.rows.map(function (r) { return r.gain; }).concat([1]));
    return '<section class="cf-card cf-miss" data-block="miss">' + head + '<div class="cf-mlist">' + X.rows.map(function (r, i) {
      return '<div class="cf-mrow' + (i === 0 && r.gain ? ' is-top' : '') + '" data-m="' + esc(r.k) + '"><span class="cf-mrank">#' + (i + 1) + '</span>'
        + '<span class="cf-mbody"><b>' + esc(r.t) + '</b><span class="cf-msub">' + esc(r.sub) + '</span>'
        + '<span class="cf-mbar"><i style="width:' + (r.gain ? r.gain / max * 100 : 0).toFixed(1) + '%"></i></span></span>'
        + '<span class="cf-mgain"><b>+' + esc(fInt(r.gain)) + '</b><span>' + plural(r.gain, 'vidéo') + '</span></span></div>';
    }).join('') + '</div></section>';
  }

  // ── 02 · Pipeline de production (maquette « Pipeline ») : 2 étapes cliquables, le panneau de l'étape ouverte s'affiche
  //    sous les deux (01 = les vidéos finales de la jauge, 02 = montages prêts = vidéos approuvées au QC). Vraies données
  //    seulement : factory_qc (rendues, approuvées), factory_prod_stats (variantes par avatar) ; « — » + raison sinon.
  function pipeHTML(M) {
    var D = M.D, c = M.cap, open = ui.pipeStage;
    montCur = null;   // reposée par le panneau « Montages prêts » s'il est ouvert
    function step(k, n, ic, v, l, s, pct, col) {
      var on = open === k;
      return '<button type="button" class="cf-pstep' + (on ? ' is-on' : '') + '" data-act="pipe-stage" data-k="' + k + '" aria-expanded="' + on + '"' + (on ? ' aria-controls="cfPipeStage"' : '') + '>'
        + '<span class="cf-pstep-t"><span class="cf-pstep-n">' + n + '</span><span class="cf-pstep-ic">' + svg(IC[ic], 14) + '</span></span>'
        + '<b class="' + (v === '—' ? 'is-na' : '') + '">' + esc(v) + '</b><span class="cf-pstep-b"><span class="cf-pstep-l">' + esc(l) + '</span><span class="cf-pstep-s">' + esc(s) + '</span></span>'
        + '<span class="cf-pstep-bar"><i class="' + col + '" style="width:' + (pct || 0).toFixed(1) + '%"></i></span></button>';
    }
    var wait = M.pending ? '…' : null;
    var gen = c ? M.capGen : null, ready = D ? D.qc.approved : null;
    var genS = c ? 'sur ' + fInt(c.total) + ' ' + plural(c.total, 'possible') : (M.why || M.ruleShort);
    // barres de la maquette : racine de la valeur rapportée à la plus grande étape
    var mx = Math.max(1, gen || 0, ready || 0), sq = function (v) { return v ? Math.max(3, Math.sqrt(v / mx) * 100) : 0; };
    var stage = open === 'gen' ? stageGenHTML(M) : open === 'ready' ? stageReadyHTML(M) : '';
    return '<section class="cf-card cf-pipe-c" data-block="pipe">' + chead('Pipeline de production')
      + '<div class="cf-pipe">' + step('gen', '01', 'wand', wait || (gen != null ? fInt(gen) : '—'), 'Vidéos générées', genS, sq(gen), 'is-1')
      + step('ready', '02', 'reel', wait || (D ? fInt(ready) : '—'), 'Montages prêts', D ? 'approuvés au QC' : M.why, sq(ready), 'is-2') + '</div>'
      + (stage ? '<div class="cf-stage" id="cfPipeStage" data-stage="' + open + '">' + stage + '</div>' : '') + '</section>';
  }
  // en-tête du panneau d'une étape : titre, description courte, fermeture (maquette)
  function stageHead(t, d) {
    return '<div class="cf-stage-h"><div class="cf-stage-tt"><h4 class="cf-stage-t">' + esc(t) + '</h4>' + (d ? '<p class="cf-stage-d">' + esc(d) + '</p>' : '') + '</div>'
      + '<button type="button" class="cf-stage-x" data-act="pipe-close" aria-label="Fermer le panneau"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
  }
  function stageChips(label, chips) {
    return '<div class="cf-schips-w"><div class="cf-over">' + esc(label) + '</div><div class="cf-schips">' + chips.join('') + '</div></div>';
  }
  function pctOf(v, tot) { return tot ? fDec(v / tot * 100, 1) + NB + '%' : '—'; }
  var VOICE_CHIP = { axel: 'Axel', omni: 'Omni', aa: 'avant / après', muet: 'texte + musique' };
  // clé d'une vidéo finale (voix|avatar|hook|liaison) → « A1 × H14 × L16 · Axel » ; avant / après
  // (aa|avatar|hook|liaison|assemblage) → « HK-O2-0a × H19 · avant / après », « A1 × HK-O2-0a × H19 × L16 · avant / après »
  function keyLabel(k) {
    var p = String(k).split('|');
    if (p.length === 5) return (p[1] ? p[1] + ' × ' : '') + p[4] + ' × ' + p[2] + (p[3] ? ' × ' + p[3] : '') + ' · ' + (VOICE_CHIP[p[0]] || p[0]);
    return p[1] + ' × ' + p[2] + (p[3] ? ' × ' + p[3] : '') + ' · ' + (VOICE_CHIP[p[0]] || p[0]);
  }
  function qcWhenMs(q) { return q.reviewed != null ? q.reviewed : q.created != null ? q.created : 0; }

  // Vidéos finales rangées par clé (usine/coherence.js) : possibles énumérés comme capacity() (voix → avatar → hook →
  // liaison compatible), vidéos de factory_qc au nouveau format rangées sous leur clé. générées = au moins une vidéo revue
  // (approuvée ou refusée), en QC = aucune encore revue, à générer = aucune vidéo : mêmes comptes que la jauge.
  var vfCache = { ver: -1, v: null };
  function vfModel(M) {
    if (vfCache.ver === CF.ver && vfCache.v) return vfCache.v;
    var D = M.D, L = M.L;
    if (!D || !L || !M.cap) return null;
    var poss = [], inPoss = Object.create(null), byKey = Object.create(null);
    var add = function (k) { if (!inPoss[k]) { inPoss[k] = 1; poss.push(k); } };
    // photos par avatar (Axel 27/09) : chaque avatar = PHOTOS_PAR_AVATAR emplacements « A1#1 », « A1#2 »… (usine/coherence.js)
    var NP = COH.PHOTOS_PAR_AVATAR || 1, slots = [];
    L.avatars.forEach(function (a) { for (var s = 1; s <= NP; s++) slots.push(NP > 1 ? a.id + '#' + s : a.id); });
    COH.VOICES.forEach(function (v) {
      var okAv = Object.create(null); avatarsFor(L, v).forEach(function (a) { okAv[a.id] = 1; });
      slots.forEach(function (aid) {
        if (!okAv[String(aid).split('#')[0]]) return;   // 08/10 : A3 n'a pas d'emplacement lipsync
        lipHooks(L).forEach(function (h) {
          if (!COH.voiceOk(h, v)) return;
          add(COH.videoKey(v, aid, h.id, ''));
          COH.liaisonsFor(h, L.liaisons, MX).forEach(function (l) {
            if (COH.voiceOk(l, v)) add(COH.videoKey(v, aid, h.id, l.id));
          });
        });
      });
    });
    // Avant / après (comme capacity) : court = assemblage × hook avant / après du module (voix off d'Axel, audio requis),
    // long = × liaison compatible avec audio × avatar ; clé aa|avatar|hook|liaison|assemblage
    if (COH.assemblies && L.aaHooks) {
      COH.assemblies(D.bricks.list).forEach(function (asm) {
        L.aaHooks.forEach(function (h) {
          if (!COH.hasAudio(h) || !COH.hookFitsModule(h, asm.module)) return;
          add(COH.videoKey('aa', '', h.id, '', asm.id));
          COH.liaisonsFor(h, L.liaisons, MX).forEach(function (l) {
            if (!COH.hasAudio(l)) return;
            slots.forEach(function (aid) { add(COH.videoKey('aa', aid, h.id, l.id, asm.id)); });
          });
        });
      });
    }
    var qs = D.qc.list.slice().sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    var sk = COH.slotKeys ? COH.slotKeys(qs.map(function (q) { return q.combo ? COH.comboKey(q.combo, M.byId) : null; })) : null;
    qs.forEach(function (q, i) {
      var k0 = q.combo ? COH.comboKey(q.combo, M.byId) : null, k = sk ? sk[i] : k0;
      if (k && NP === 1 && /#\d+/.test(String(k).split('|')[1] || '')) k = k0;
      if (!k || !inPoss[k]) return;   // hors des possibles : déjà signalé sous la jauge, jamais listé ici
      (byKey[k] = byKey[k] || []).push(q);
    });
    var gen = [], pend = [], best = Object.create(null), last = Object.create(null);
    Object.keys(byKey).forEach(function (k) {
      var rows = byKey[k], rank = { approved: 3, pending: 2, refused: 1 };
      rows.sort(function (a, b) { return (rank[b.status] || 0) - (rank[a.status] || 0) || qcWhenMs(b) - qcWhenMs(a); });
      best[k] = rows[0];
      last[k] = Math.max.apply(null, rows.map(qcWhenMs));
      (rows.some(function (q) { return q.status !== 'pending'; }) ? gen : pend).push(k);
    });
    var recent = function (a, b) { return last[b] - last[a] || (a < b ? -1 : 1); };
    gen.sort(recent); pend.sort(recent);
    var rest = poss.filter(function (k) { return !byKey[k]; }), n = poss.length;
    // avant / après (27/09) : on ne PUBLIE que dans la limite des paliers des transformations (capacity : modes.aa.total) ;
    // le reste des combinaisons n'est pas « à générer »
    var aaM = M.cap.modes && M.cap.modes.aa;
    if (aaM && aaM.publiable != null) {
      var isAA = function (k) { return k.indexOf('aa|') === 0; };
      var made = gen.concat(pend).filter(isAA).length, room = Math.max(0, aaM.total - made), keep = 0;
      rest = rest.filter(function (k) { if (!isAA(k)) return true; keep += 1; return keep <= room; });
      n = gen.length + pend.length + rest.length;
    }
    vfCache = { ver: CF.ver, v: { gen: gen, pend: pend, rest: rest, best: best, n: n } };
    return vfCache.v;
  }

  // ── panneau 01 · Vidéos générées : barre générées / en QC / à générer, 3 tuiles (clic = la liste des vidéos), variantes
  //    lipsync par avatar (factory_prod_stats, clic = les briques parlées sans variante) ──
  function stageGenHTML(M) {
    var c = M.cap;
    if (!c) return stageHead('Vidéos générées', '') + naBody(M);
    var V = vfModel(M), g = M.capGen, p = M.capPending, r = c.remaining, tot = c.total, A = c.avatars;
    var head = stageHead('Vidéos générées · ' + fInt(g) + ' / ' + fInt(tot), (c.modeKeys || []).map(function (k) {
      var m = c.modes[k]; return m && m.total ? (m.label || k) + ' ' + fInt(m.total) : '';
    }).filter(Boolean).join(' · '));
    var segs = [[g, 'is-gen'], [p, 'is-pd'], [r, 'is-rest']].filter(function (x) { return x[0] > 0; }).map(function (x) {
      return '<i class="' + x[1] + '" style="width:max(3px, ' + (x[0] / Math.max(1, tot) * 100).toFixed(2) + '%)"></i>';
    }).join('');
    var tiles = [['gen', plural(g, 'générée'), g, 'is-gen'], ['pend', 'en QC', p, 'is-pd'], ['rest', 'à générer', r, 'is-rest']].map(function (x) {
      var on = ui.pipeVar === x[0];
      return '<button type="button" class="cf-stile2' + (on ? ' is-on' : '') + '" data-act="pipe-var" data-k="' + x[0] + '" aria-pressed="' + on + '">'
        + '<span class="cf-stile2-l"><i class="' + x[3] + '"></i>' + esc(x[1]) + '</span><b>' + esc(fInt(x[2])) + '</b>'
        + '<span class="cf-stile2-s">' + esc(pctOf(x[2], tot) + ' des ' + fInt(tot) + ' ' + plural(tot, 'possible')) + '</span></button>';
    }).join('');
    // variantes lipsync par avatar (1 avatar × 1 brique parlée : hooks sans alias, liaisons, CTA), factory_prod_stats
    var Vr = M.vars, L = M.L, avH;
    if (!Vr || Vr.gen == null) avH = emptyLine('—', (Vr && Vr.why) || 'variantes indisponibles');
    else {
      var spoken = lipHooks(L).concat(L.liaisons, L.ctas).map(function (b) { return b.id; }), has = Object.create(null);
      Vr.St.pairs.forEach(function (x) { has[x[0] + '|' + x[1]] = 1; });
      avH = '<div class="cf-sav">' + avatarsFor(L, 'axel').map(function (a) {
        var miss = spoken.filter(function (id) { return !has[a.id + '|' + id]; }).length, done = spoken.length - miss, on = ui.pipeAv === a.id;
        var pc = spoken.length ? done / spoken.length * 100 : 0;
        return '<button type="button" class="cf-savt' + (on ? ' is-on' : '') + '" data-act="pipe-av" data-k="' + esc(a.id) + '" aria-pressed="' + on + '">'
          + '<span class="cf-savt-h"><span class="cf-savt-id"><span class="cf-savt-ic">' + svg(IC.user, 13) + '</span><b>' + esc(a.id) + '</b></span><span class="cf-savt-p">' + Math.round(pc) + NB + '%</span></span>'
          + '<span class="cf-savt-v"><b>' + esc(fInt(done)) + '</b><span> / ' + esc(fInt(spoken.length)) + '</span></span>'
          + '<span class="cf-savt-bar"><i style="width:' + pc.toFixed(1) + '%"></i></span>'
          + '<span class="cf-savt-m">' + esc(miss + ' ' + plural(miss, 'brique parlée manquante', 'briques parlées manquantes')) + '</span></button>';
      }).join('') + '</div>'
        + (Vr.out ? '<div class="cf-meta">' + esc(Vr.out + ' ' + plural(Vr.out, 'variante') + ' hors bibliothèque') + '</div>' : '');
    }
    var LIM = 90, chips = '';
    if (ui.pipeVar && V) {
      var list = V[ui.pipeVar] || [], rest = ui.pipeVar === 'rest';
      chips = list.length ? stageChips(({ gen: 'vidéos générées', pend: 'vidéos en QC', rest: 'vidéos à générer' })[ui.pipeVar] + ' · ' + fInt(list.length)
        + (list.length > LIM ? ' · ' + LIM + ' premières' : ''),
        list.slice(0, LIM).map(function (k) {
          // générée / en QC : la vidéo se lit (fiche vidéo finale) ; à générer : la fiche du hook (maquette)
          return rest ? '<button type="button" class="cf-schip" data-act="brick-open" data-bid="' + esc(String(k).split('|')[2]) + '">' + esc(keyLabel(k)) + '</button>'
            : '<button type="button" class="cf-schip" data-act="vf-open" data-qid="' + esc(V.best[k].id) + '">' + esc(keyLabel(k)) + '</button>';
        })) : '<div class="cf-empty-s">Aucune vidéo dans cette liste.</div>';
    } else if (ui.pipeAv && Vr && Vr.gen != null) {
      var sp = lipHooks(L).concat(L.liaisons, L.ctas).map(function (b) { return b.id; }), hv = Object.create(null);
      Vr.St.pairs.forEach(function (x) { hv[x[0] + '|' + x[1]] = 1; });
      var mi = sp.filter(function (id) { return !hv[ui.pipeAv + '|' + id]; });
      chips = mi.length ? stageChips('avatar ' + ui.pipeAv + ' · ' + mi.length + ' ' + plural(mi.length, 'brique parlée', 'briques parlées') + ' sans variante',
        mi.map(function (id) { return '<button type="button" class="cf-schip" data-act="brick-open" data-bid="' + esc(id) + '">' + esc(id) + '</button>'; }))
        : '<div class="cf-empty-s">Toutes les briques parlées ont une variante avec ' + esc(ui.pipeAv) + '.</div>';
    }
    return head + '<div class="cf-sseg" aria-hidden="true">' + segs + '</div><div class="cf-stiles2">' + tiles + '</div>'
      + '<div class="cf-over">variantes par avatar</div>' + avH + chips;
  }

  // ── panneau 02 · Montages prêts : approuvés par période (courbe de la maquette) et pris en mission BloxAI (16/10 : série
  //    30 j de BloxAI pour 7 j / 30 j, compteur 24 h, total des missions prises au-delà), par module (clic = les vidéos en stock) ──
  var MONT_PER = [['24h', '24' + NB + 'h'], ['7j', '7' + NB + 'j'], ['30j', '30' + NB + 'j'], ['6m', '6' + NB + 'mois'], ['all', 'All time']];
  function montSeries(list, per) {
    var now = new Date(), B = [], labels = [], unit, perL, i;
    var dated = list.filter(function (q) { return q.reviewed != null; });
    if (per === '24h') {
      var h0 = new Date(now.getTime()); h0.setMinutes(0, 0, 0);
      for (i = 23; i >= 0; i--) { var s = h0.getTime() - i * 3600e3; B.push([s, s + 3600e3]); labels.push(new Date(s).getHours() + NB + 'h'); }
      unit = 'heure'; perL = 'sur 24' + NB + 'h';
    } else if (per === '7j' || per === '30j') {
      var n = per === '7j' ? 7 : 30;
      for (i = n - 1; i >= 0; i--) {
        var sd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), ed = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
        B.push([sd.getTime(), ed.getTime()]); labels.push(dm(sd));
      }
      unit = 'jour'; perL = 'sur ' + n + NB + 'j';
    } else {
      var nm = 6;
      if (per === 'all') {
        var f = new Date(dated.length ? Math.min.apply(null, dated.map(function (q) { return q.reviewed; })) : now.getTime());
        nm = Math.max(1, (now.getFullYear() - f.getFullYear()) * 12 + now.getMonth() - f.getMonth() + 1);
      }
      var y0 = new Date(now.getFullYear(), now.getMonth() - nm + 1, 1).getFullYear(), multi = y0 !== now.getFullYear();
      for (i = nm - 1; i >= 0; i--) {
        var sm = new Date(now.getFullYear(), now.getMonth() - i, 1), em = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        B.push([sm.getTime(), em.getTime()]); labels.push(MONTHS[sm.getMonth()] + (multi ? ' ' + String(sm.getFullYear()).slice(2) : ''));
      }
      unit = 'mois'; perL = per === 'all' ? 'depuis la 1re approbation' : 'sur 6' + NB + 'mois';
    }
    var r = B.map(function (b) { return dated.filter(function (q) { return q.reviewed >= b[0] && q.reviewed < b[1]; }).length; });
    return { r: r, labels: labels, unit: unit, perL: perL, n: B.length, undated: list.length - dated.length };
  }
  var montCur = null;   // courbe des montages affichée, lue par la bulle de survol (sans redessiner le panneau)
  function stageReadyHTML(M) {
    var D = M.D, Q = D && D.qc;
    var head = stageHead('Montages prêts' + (Q ? ' · ' + fInt(Q.approved) : ''), 'Vidéos finales approuvées au QC, prêtes à être postées par AvatarAds ou téléchargées en mission.');
    if (!Q) return head + naBody(M);
    var appr = Q.list.filter(function (q) { return q.status === 'approved'; });
    if (!appr.length) return head + '<div class="cf-stage-e">Aucun montage approuvé pour l’instant.</div>';
    var per = ui.pipePer, S = montSeries(appr, per), NP = S.n, sum = S.r.reduce(function (a, x) { return a + x; }, 0);
    function kpi(cls, l, v, s) {
      return '<div class="cf-mkpi"><span class="cf-mkpi-l"><i class="' + cls + '"></i>' + esc(l) + '</span><b class="' + (v === '—' ? 'is-na' : '') + '">' + esc(v) + '</b><span class="cf-mkpi-s">' + esc(s) + '</span></div>';
    }
    var dl = bxTaken(per);   // missions BloxAI prises sur la période (null + raison si BloxAI ne le dit pas)
    var kpis = '<div class="cf-mkpis">' + kpi('is-appr', 'approuvés', fInt(sum), fDec(sum / NP, 1) + ' par ' + S.unit + ' · ' + S.perL
      + (S.undated ? ' · ' + S.undated + ' sans date d’approbation' : ''))
      + kpi('is-dl', 'pris en mission', dl.v == null ? '—' : fInt(dl.v), dl.v == null ? dl.why : dl.sub)
      + kpi('is-gap', 'écart', dl.v == null ? '—' : fGap(sum - dl.v), 'approuvés − pris en mission') + '</div>';
    // courbe (maquette) : viewBox 1000 × 150, max × 1,2, valeurs affichées jusqu'à 14 points
    var cmx = Math.max(2, Math.max.apply(null, S.r.concat(dl.per || []))) * 1.2;
    var X = function (k) { return NP > 1 ? k / (NP - 1) * 1000 : 500; }, Y = function (v) { return 150 - v / cmx * 150; };
    var d = S.r.map(function (v, k) { return (k ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ');
    var showV = NP <= 14;
    var dlPath = dl.per ? dl.per.map(function (v, k) { return (k ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ') : '';
    var dots = S.r.map(function (v, k) {
      var pos = 'left:' + (X(k) / 10).toFixed(2) + '%;top:' + (Y(v) / 1.5).toFixed(2) + '%';
      return '<span class="cf-mdot' + (NP > 14 ? ' is-sm' : '') + '" data-i="' + k + '" style="' + pos + '"></span>' + (showV ? '<span class="cf-mval" style="' + pos + '">' + v + '</span>' : '');
    }).join('');
    var pick = NP <= 7 ? S.r.map(function (_, k) { return k; }) : [0, Math.round((NP - 1) / 4), Math.round((NP - 1) / 2), Math.round(3 * (NP - 1) / 4), NP - 1].filter(function (k, j, a) { return a.indexOf(k) === j; });
    var seg = '<div class="cf-mper" role="group" aria-label="Période">' + MONT_PER.map(function (x) {
      var on = x[0] === per;
      return '<button type="button" class="cf-mper-b' + (on ? ' is-on' : '') + '" data-act="pipe-per" data-k="' + x[0] + '" aria-pressed="' + on + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    montCur = { n: NP, r: S.r.slice(), dl: dl.per ? dl.per.slice() : null, labels: S.labels.slice(), hot: false };
    var chart = '<div class="cf-mchart"><div class="cf-mchart-h"><span class="cf-mchart-t">' + esc('Montages approuvés' + (dl.per ? ' et pris en mission' : '') + ' · par ' + S.unit) + '</span>' + seg + '</div>'
      + '<div class="cf-mplot" role="img" aria-label="' + esc('Montages approuvés par ' + S.unit + ' ' + S.perL + ' : ' + fInt(sum)) + '">'
      + '<div class="cf-mgrid" aria-hidden="true"><i></i><i></i><i></i></div>'
      + '<svg viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
      + (dlPath ? '<path d="' + dlPath + '" fill="none" stroke="var(--cf-ok)" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' : '')
      + '<path d="' + d + '" fill="none" stroke="#ff6b35" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>'
      + dots + '<div class="cf-mhover" hidden></div></div>'
      + '<div class="cf-mx">' + pick.map(function (k) { return '<span>' + esc(S.labels[k]) + '</span>'; }).join('') + '</div></div>';
    // par module (modèle de rendu de la vidéo, comme la file QC) : vidéos en stock
    var mods = Object.create(null), keys = [];
    appr.forEach(function (q) { var m = q.template || 'modèle inconnu'; if (!mods[m]) { mods[m] = []; keys.push(m); } mods[m].push(q); });
    keys.sort(function (a, b) { return mods[b].length - mods[a].length || (a < b ? -1 : 1); });
    var mmax = Math.max.apply(null, keys.map(function (k) { return mods[k].length; }).concat([1]));
    if (ui.pipeMod && !mods[ui.pipeMod]) ui.pipeMod = null;
    var rows = '<div class="cf-over">modules</div><div class="cf-srows">' + keys.map(function (k) {
      var n = mods[k].length, on = ui.pipeMod === k;
      return '<button type="button" class="cf-srow' + (on ? ' is-on' : '') + '" data-act="pipe-mod" data-k="' + esc(k) + '" aria-pressed="' + on + '"><span class="cf-srow-l">' + esc(k) + '</span>'
        + '<span class="cf-srow-b"><i style="width:' + Math.max(2, n / mmax * 100).toFixed(1) + '%"></i></span><b>' + esc(fInt(n)) + '</b></button>';
    }).join('') + '</div>';
    var chips = '';
    if (ui.pipeMod) {
      var L0 = mods[ui.pipeMod].slice().sort(function (a, b) { return qcWhenMs(b) - qcWhenMs(a); });
      chips = stageChips('en stock · ' + ui.pipeMod, L0.map(function (q) {
        return '<button type="button" class="cf-schip" data-act="vf-open" data-qid="' + esc(q.id) + '">' + esc(vfName(q) + (q.combo ? ' · ' + (VOICE_CHIP[q.combo.assemblage && !q.combo.voice ? 'aa' : q.combo.voice || 'axel'] || 'voix ?') : '') + (q.reviewed != null ? ' · ' + dm(new Date(q.reviewed)) : '')) + '</button>';
      }));
    }
    return head + kpis + chart + rows + chips;
  }
  // bulle de la courbe des montages : la case survolée (maquette : une case par point)
  function montHover(plot, clientX) {
    var ch = montCur;
    if (!ch || !plot) return;
    var rc = plot.getBoundingClientRect();
    if (!rc.width) return;
    var i = Math.max(0, Math.min(ch.n - 1, Math.floor((clientX - rc.left) / rc.width * ch.n)));
    var box = plot.querySelector('.cf-mhover');
    if (!box || (box._i === i && !box.hidden)) return;
    box._i = i;
    var x = ch.n > 1 ? i / (ch.n - 1) * 100 : 50;
    box.innerHTML = '<span class="cf-mvl" style="left:' + x.toFixed(2) + '%"></span><div class="cf-mtip" style="left:' + x.toFixed(2) + '%;transform:translateX(' + (i > ch.n / 2 ? 'calc(-100% - 12px)' : '12px') + ')">'
      + '<span class="cf-mtip-d">' + esc(ch.labels[i]) + '</span>'
      + '<span class="cf-mtip-r"><span><i class="is-appr"></i>approuvés</span><b>' + esc(fInt(ch.r[i])) + '</b></span>'
      + '<span class="cf-mtip-r"><span><i class="is-dl"></i>pris en mission</span><b>' + esc(ch.dl ? fInt(ch.dl[i]) : '—') + '</b></span>'
      + '<span class="cf-mtip-r is-gap"><span>écart</span><b>' + esc(ch.dl ? fGap(ch.r[i] - ch.dl[i]) : '—') + '</b></span></div>';
    box.hidden = false;
    ch.hot = true;
    [].forEach.call(plot.querySelectorAll('.cf-mdot'), function (dt) { dt.classList.toggle('is-hot', dt.getAttribute('data-i') === String(i)); });
  }
  function montHide() {
    if (montCur) montCur.hot = false;
    [].forEach.call(document.querySelectorAll('.cf-mhover'), function (b) { b.hidden = true; b._i = null; });
    [].forEach.call(document.querySelectorAll('.cf-mdot.is-hot'), function (dt) { dt.classList.remove('is-hot'); });
  }

  // ── fiche d'une vidéo finale (maquette : fenêtre 560 px, lecteur 9:16 sur fond sombre, composants cliquables) ──
  var COMBO_ORDER = ['avatar', 'assemblage', 'hook', 'liaison', 'contenu', 'cta', 'musique', 'sous_titre'];
  function vfName(q) {
    if (!q.combo) return 'recette libre';
    return [q.combo.photo || q.combo.avatar, q.combo.assemblage, q.combo.hook, q.combo.liaison].filter(Boolean).join(' × ') || 'recette sans avatar ni hook';
  }
  function vfVoice(q) {
    var v = q.combo && q.combo.voice;
    if (q.combo && q.combo.assemblage && (v == null || v === 'axel')) return 'Avant / après';   // voix off d'Axel sur un assemblage
    return !q.combo ? '' : v == null || v === 'axel' ? 'Audio d’Axel' : v === 'omni' ? 'Omni' : 'voix inconnue « ' + v + ' »';
  }
  function openVf(qid, trigger) {
    if (!qid || !CF.prod.data) return;
    // 16/10 : bloc « Diffusion » de la fiche (Instagram, TikTok, BloxAI) : mêmes cases du store que l'Accueil (caches 5-15 min)
    CF.loadBx(); CF.loadTts(); CF.loadMedia();
    if (ui.modal) { ui.modal = { vf: qid }; renderModal(); return; }
    openModal({ vf: qid }, trigger);
  }
  function vfSheetHTML(qid) {
    var D = CF.prod.data, q = D ? D.qc.list.filter(function (x) { return x.id === qid; })[0] : null;
    if (!q) return '<div class="cf-vf"><div class="cf-vf-h"><h2 class="cf-vf-t" id="cfModalTitle">Vidéo finale</h2><span class="cf-meta">introuvable dans la file QC (relue entre-temps)</span></div></div>';
    var ST = { pending: 'à valider', approved: 'approuvée · en stock', refused: 'refusée' };
    var meta = ['Vidéo finale', q.template || 'modèle inconnu', ST[q.status] || 'statut inconnu', vfVoice(q)].filter(Boolean).join(' · ');
    var hist = [[qcWhen(q.created, 'rendue'), '']];
    if (q.status === 'approved') hist.push([qcWhen(q.reviewed, 'approuvée'), 'is-ok']);
    else if (q.status === 'refused') { hist.push([qcWhen(q.reviewed, 'refusée'), 'is-ko']); if (q.classified != null) hist.push([qcWhen(q.classified, 'classée'), '']); }
    else if (q.status === 'pending') hist.push(['à valider', 'is-pend']);
    var histH = '<div class="cf-vf-hist">' + hist.map(function (x, i) {
      return (i ? '<span class="cf-vf-arr" aria-hidden="true">' + svg(IC.arrow, 12) + '</span>' : '') + '<span class="cf-vf-hc ' + x[1] + '">' + esc(x[0]) + '</span>';
    }).join('') + '</div>';
    var vsrc = mediaSrc(q.video), psrc = mediaSrc(q.poster);
    var media = '<div class="cf-vf-stage"><div class="cf-vf-frame cf-mbox' + (vsrc ? '' : ' is-broken') + '">'
      + (vsrc ? '<video controls playsinline preload="metadata" src="' + esc(psrc ? vsrc : vFirst(vsrc)) + '"' + (psrc ? ' poster="' + esc(psrc) + '"' : '') + '></video><span class="cf-vmsg">vidéo illisible (fichier introuvable ou refusé)</span>'
        : '<span class="cf-vmsg is-on">vidéo introuvable · ' + esc(q.videoWhy || 'aucune vidéo') + '</span>') + '</div></div>';
    var LB = { avatar: 'avatar', assemblage: 'assemblage', hook: 'hook', liaison: 'liaison', contenu: 'démo', cta: 'CTA', musique: 'musique', sous_titre: 'sous-titres' };
    var comps = q.combo ? '<div class="cf-vf-chips">' + COMBO_ORDER.filter(function (k) { return q.combo[k]; }).map(function (k) {
      return '<button type="button" class="cf-vf-chip" data-act="' + (k === 'assemblage' ? 'asm-open" data-rid="' : 'brick-open" data-bid="') + esc(q.combo[k]) + '" title="' + esc(LB[k]) + '">' + esc(q.combo[k]) + '</button>';
    }).join('') + '</div>'
      : q.legacy && q.legacy.length ? '<span class="cf-meta">' + esc('recette (ancien format, texte libre) : ' + q.legacy.map(function (x) { return x[0] + ' : ' + x[1]; }).join(' · ')) + '</span>'
        : '<span class="cf-meta">recette non renseignée</span>';
    return '<div class="cf-vf" data-qid="' + esc(q.id) + '"><div class="cf-vf-h"><h2 class="cf-vf-t" id="cfModalTitle">' + esc(vfName(q)) + '</h2><span class="cf-meta">' + esc(meta) + '</span>' + histH
      + (q.status === 'refused' ? '<span class="cf-vf-why">' + esc(q.reason ? 'motif : « ' + q.reason + ' »' : 'motif : aucun') + '</span>' : '')
      + (q.status === 'pending' ? '<button type="button" class="cf-btn is-sm cf-vf-rev" data-act="qc-open" data-qid="' + esc(q.id) + '">Ouvrir la revue</button>' : '') + '</div>'
      + media + '<div class="cf-over">Composants</div>' + comps
      // Diffusion (16/10) : rempli à part (renderModal) pour que l'arrivée des chiffres ne recrée jamais le lecteur vidéo
      + '<div class="cf-vf-diff" aria-live="polite"></div></div>';
  }

  function comboChips(q) {
    if (q.combo) {
      var L = { avatar: 'avatar', assemblage: 'assemblage', hook: 'hook', liaison: 'liaison', contenu: 'démo', cta: 'CTA', musique: 'musique', sous_titre: 'sous-titres' };
      return '<span class="cf-combo">' + COMBO_ORDER.filter(function (k) { return q.combo[k]; }).map(function (k) {
        return '<button type="button" class="cf-chip is-brick is-btn" data-act="' + (k === 'assemblage' ? 'asm-open" data-rid="' : 'brick-open" data-bid="') + esc(q.combo[k]) + '" title="' + esc(L[k]) + '">' + esc(q.combo[k]) + '</button>';
      }).join('<span class="cf-plus" aria-hidden="true">+</span>') + (q.combo.voice === 'omni' ? '<span class="cf-chip is-mod">voix Omni</span>'
        : q.combo.voice && q.combo.voice !== 'axel' ? '<span class="cf-chip is-mod is-bad">' + esc('voix inconnue « ' + q.combo.voice + ' »') + '</span>' : '') + '</span>';
    }
    if (q.legacy && q.legacy.length) {
      return '<span class="cf-meta">recette (ancien format, texte libre) : ' + esc(q.legacy.map(function (x) { return x[0] + ' : ' + x[1]; }).join(' · ')) + '</span>';
    }
    return '<span class="cf-meta">recette non renseignée</span>';
  }
  // raison de usine/coherence.js sans son préfixe (le titre de l'encadré le dit déjà)
  function cohWhy(x) {   // (raisons déjà écrites en base avant le 26/09 : statut anglais traduit à l'affichage)
    return String(x).replace(/^cohérence à vérifier : /, '').replace(/\(statut (retired|flagged|draft)\)/g, function (m, s) { return '(' + stFr(s) + ')'; });
  }
  function qcWhen(t, what) { return t != null ? what + ' le ' + dmy(new Date(t)) : what + ' : date inconnue'; }
  function qcFileHTML(M) {
    var D = M.D, Q = D && D.qc;
    var head = chead('File de validation', 'revue QC des vidéos rendues');
    if (!Q) return '<section class="cf-card cf-qcf" id="cfQcFile">' + head + naBody(M) + '</section>';
    var open = ui.prodList;
    function tile(k, n, l, cls) {
      var on = open === k;
      return '<button type="button" class="cf-qtile ' + cls + (on ? ' is-open' : '') + '" data-act="qc-list" data-l="' + k + '" aria-expanded="' + on + '">'
        + '<span class="cf-qtile-t"><b>' + esc(fInt(n)) + '</b>' + svg(IC.chevron, 12) + '</span><span class="cf-qtile-l">' + esc(l) + '</span></button>';
    }
    var dec = Q.approved + Q.refused, rate = dec ? Q.approved / dec * 100 : null;
    var bar = '<div class="cf-qbar" aria-hidden="true">' + (dec ? (Q.approved ? '<i class="is-ok" style="width:' + (Q.approved / dec * 100).toFixed(2) + '%"></i>' : '') + (Q.refused ? '<i class="is-ko" style="width:' + (Q.refused / dec * 100).toFixed(2) + '%"></i>' : '') : '') + '</div>';
    var list = '';
    if (open) {
      var rows = Q.list.filter(function (q) { return q.status === open; });
      if (open === 'pending') rows.sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
      var title = { pending: 'Vidéos à valider', approved: 'Vidéos approuvées', refused: 'Refusées · à classer d’abord' }[open];
      if (open === 'refused') rows.sort(function (a, b) { return (a.classified ? 1 : 0) - (b.classified ? 1 : 0) || (b.reviewed || 0) - (a.reviewed || 0); });
      list = '<div class="cf-qlist-w"><div class="cf-over">' + esc(title) + '</div>' + (rows.length ? '<div class="cf-qlist">' + rows.map(function (q) { return qcRowHTML(q, Q); }).join('') + '</div>'
        : '<div class="cf-empty-s">Aucune vidéo dans cette liste.</div>') + '</div>';
    }
    var msg = ui.qcMsg ? '<div class="cf-acct-msg is-' + (ui.qcMsg.ok ? 'ok' : 'err') + '" role="' + (ui.qcMsg.ok ? 'status' : 'alert') + '">' + esc(ui.qcMsg.text) + '</div>' : '';
    return '<section class="cf-card cf-qcf" id="cfQcFile" data-block="qc">' + head
      + '<div class="cf-qtiles">' + tile('pending', Q.pending, 'à valider', 'is-pend') + tile('approved', Q.approved, plural(Q.approved, 'approuvée'), 'is-ok') + tile('refused', Q.refused, plural(Q.refused, 'refusée'), 'is-ko') + '</div>'
      + '<div class="cf-qrate">' + bar + '<div class="cf-meta" data-rate>' + esc('taux d’approbation · ' + (rate == null ? '— (aucune vidéo revue)' : fDec(rate, 1) + NB + '%' + ' · ' + Q.approved + ' / ' + dec + ' ' + plural(dec, 'revue'))) + '</div></div>'
      + msg + list + '</section>';
  }
  function qcRowHTML(q, Q) {
    var st = q.status, chip = '', act = '';
    if (st === 'pending') { chip = '<span class="cf-qchip is-pend">à valider</span>'; act = '<button type="button" class="cf-btn is-sm" data-act="qc-open" data-qid="' + esc(q.id) + '">Revoir</button>'; }
    else if (st === 'approved') chip = '<span class="cf-qchip is-ok">approuvée</span>';
    else if (st === 'refused') {
      if (q.classified != null) chip = '<span class="cf-qchip">classée le ' + esc(dm(new Date(q.classified))) + '</span>';
      else {
        chip = '<span class="cf-qchip is-ko">à classer</span>';
        var busy = !!ui.qcBusy[q.id];
        act = Q.classifyMissing ? '<span class="cf-meta">« Classer » : migration à appliquer</span>'
          : '<button type="button" class="cf-btn is-dark is-sm" data-act="qc-classify" data-qid="' + esc(q.id) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Enregistrement…' : 'Classer') + '</button>';
      }
    }
    // approuvée / refusée : la vidéo se lit aussi (fiche vidéo finale, lecture seule) ; à valider : « Revoir » (revue QC)
    if (st === 'approved' || st === 'refused') act = '<span class="cf-qrow-a"><button type="button" class="cf-btn is-sm" data-act="vf-open" data-qid="' + esc(q.id) + '">' + svg(IC.play, 11) + 'voir</button>' + act + '</span>';
    var when = st === 'pending' ? qcWhen(q.created, 'rendue') : qcWhen(q.reviewed != null ? q.reviewed : q.created, st === 'approved' ? 'approuvée' : 'refusée');
    return '<div class="cf-qrow" data-qid="' + esc(q.id) + '"><div class="cf-qrow-h"><span class="cf-meta">' + esc((q.template || 'modèle inconnu') + ' · ' + when
      + (st === 'pending' && q.route ? ' · QC technique ' + (q.route === 'manual' ? 'manuel' : 'auto') : '')) + '</span>' + chip + '</div>'
      + '<div class="cf-qrow-b">' + comboChips(q) + act + '</div>'
      + (st === 'refused' ? '<div class="cf-qrow-r">' + esc(q.reason ? 'motif : « ' + q.reason + ' »' : 'motif : aucun') + '</div>' : '')
      + (st === 'pending' && q.coh && q.coh.level === 'review' ? '<div class="cf-qrow-r is-coh">' + esc('cohérence à vérifier : ' + (q.coh.reasons[0] ? cohWhy(q.coh.reasons[0]) : 'hors tags')) + '</div>' : '')
      + '</div>';
  }

  // ── 02 · Briques les plus / moins performantes (reels Instagram dont les briques sont reconnues) : 2 cartes, chacune
  //    son sélecteur (maquette). Moitié haute / moitié basse d'un même type : jamais la même brique dans les deux listes.
  // Types des cartes de performance : ceux de la maquette, + Format dès qu'une recette factory_qc porte brick_combo.format
  // (jamais un onglet vide). La fraîcheur garde la liste des briques (un format n'est pas une brique).
  function perfKinds() {
    // onglet Formats seulement quand un format est mesurable (lien publication ↔ vidéo QC, HEARD.format) : jamais vide
    var D = CF.prod.data, fmt = !!(HEARD.format && D && D.qc.list.some(function (q) { return q.format; }));
    return fmt ? PERF_KINDS.concat([['format', 'Formats']]) : PERF_KINDS;
  }
  function perfSeg(act, cur, side, kinds) {
    return '<div class="cf-seg cf-pseg" role="group" aria-label="Type de brique">' + (kinds || PERF_KINDS).map(function (x) {
      var on = x[0] === cur;
      return '<button type="button" class="cf-seg-b' + (on ? ' is-on' : '') + '" data-act="' + act + '" data-k="' + x[0] + '"' + (side ? ' data-side="' + side + '"' : '') + ' aria-pressed="' + on + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
  }
  function perfRanks(k) {
    var ms = mediaState();
    if (!HEARD[k]) return { why: NOT_YET };
    if (ms.st === 'wait') return { why: 'wait' };
    if (ms.st !== 'ok') return { why: ms.why };
    var I = brickIndex(), n = I.postsV[k] || 0, byId = prodModel().byId;
    if (n < 3) return { why: 'Pas assez de données : ' + n + ' ' + plural(n, 'publication') + ' avec ' + plural(2, KIND_PL[k][0], KIND_PL[k][1]) + ' reconnu' + (k === 'liaison' ? 'es' : 's') + ' (3 minimum)' };
    // total = somme des vues des publications où la brique est reconnue, n = ces publications (vues lues) ; classement et barre
    // sur le total, le chiffre en gras (Axel 26/09 : « 1 000 vues / 2 publications · ≈500 vues moyennes »)
    var rows = Object.keys(I.by).map(function (id) { return I.by[id]; }).filter(function (r) { return r.kind === k && r.nv > 0 && (!byId[r.id] || live(byId[r.id])); })
      .map(function (r) { return { id: r.id, views: r.views, avg: r.views / r.nv, nv: r.nv }; }).sort(function (a, b) { return b.views - a.views || b.avg - a.avg || (a.id < b.id ? -1 : 1); });
    var half = Math.ceil(rows.length / 2);
    return { top: rows.slice(0, Math.min(6, half)), low: rows.slice(half).reverse().slice(0, 6) };
  }
  // « 1 000 vues / 2 publications · ≈500 vues moyennes » (espaces fines des milliers, singulier sous 2)
  function perfLine(r) {
    var avg = Math.round(r.avg);
    return { tot: fInt(r.views) + ' ' + plural(r.views, 'vue'), rest: '/ ' + fInt(r.nv) + ' ' + plural(r.nv, 'publication') + (r.nv > 1 ? ' · ≈' + fInt(avg) + ' ' + plural(avg, 'vue moyenne', 'vues moyennes') : '') };
  }
  function perfCardHTML(side) {
    var kinds = perfKinds(), best = side !== 'low';
    var k = best ? ui.perfKind : ui.perfKindLow;
    if (!kinds.some(function (x) { return x[0] === k; })) k = 'hook';   // Format disparu à la relecture : retour aux hooks
    var name = kinds.filter(function (x) { return x[0] === k; })[0][1];
    var R = perfRanks(k), list = best ? R.top : R.low, body;
    if (R.why === 'wait') body = spin('Chargement des publications…');
    else if (R.why) body = emptyLine('—', R.why);
    else if (!list.length) body = emptyLine('—', 'pas assez de briques différentes pour comparer');
    else {
      var mx = Math.max.apply(null, list.map(function (r) { return r.views; }).concat([1]));
      body = '<div class="cf-perf">' + list.map(function (r, i) {
        var t = perfLine(r);
        return '<div class="cf-prow" data-perf="' + esc(t.tot + ' ' + t.rest) + '"><span class="cf-mrank' + (i === 0 ? ' is-acc' : '') + '">#' + (i + 1) + '</span>'
          + '<button type="button" class="cf-pid" data-act="brick-open" data-bid="' + esc(r.id) + '">' + esc(r.id) + '</button>'
          + '<span class="cf-pbar' + (best ? '' : ' is-low') + '"><i style="width:' + Math.max(4, r.views / mx * 100).toFixed(1) + '%"></i></span>'
          + '<b class="cf-pv">' + esc(t.tot) + '</b><span class="cf-pn">' + esc(t.rest) + '</span></div>';
      }).join('') + '</div>';
    }
    var title = name + ' les ' + (best ? 'plus' : 'moins') + ' performant' + (FEM[k] ? 'es' : 's');
    return '<section class="cf-card cf-perf-c" data-block="perf" data-side="' + (best ? 'top' : 'low') + '">'
      + chead(title, best ? 'vues totales des vidéos qui les utilisent' : 'à remplacer ou retravailler')
      + perfSeg('perf-kind', k, best ? 'top' : 'low', kinds) + body
      + '<div class="cf-pfoot">vues totales / publications · ≈ vues moyennes</div></section>';
  }

  // Vidéos d'une brique par FORMAT (Axel 27/09) : brique parlée → Audio d'Axel + Voix native Omni ; texte choc → Texte +
  // musique ; chaque format = PHOTOS_PAR_AVATAR emplacements par avatar, remplis par les vidéos de factory_variants (photo
  // réelle A1-2…, plus ancienne d'abord) sinon « en attente d'être créée ». Hook avant / après : aucun avatar (voix off).
  var FMT_ORDER = { spoken: ['omni'], 'texte-choc': ['muet'] };   // 13/10 : plus d'Audio d'Axel (OFF_VOICES)
  // 08/10 (Axel : « on ne générera pas d'autre lipsync avec A3 ») : avatars qui ont des emplacements dans ce format
  // (meta.voices de la brique avatar, usine/coherence.js avatarVoiceOk) — A3 = Omni seulement
  function avatarsFor(L, f) { return L.avatars.filter(function (a) { return !COH || !COH.avatarVoiceOk || COH.avatarVoiceOk(a, f); }); }
  var FMT_NAME = { axel: 'Audio d’Axel', omni: 'Omni', muet: 'Texte + musique' };
  var FMT_SHORT = { axel: 'lipsync', omni: 'Omni', muet: 'texte + musique' };
  // Texte choc (TH…) : la phrase telle qu'elle passe à l'écran, émoji de fin compris (meta.full, sinon texte + meta.emoji).
  // Exception voulue à « aucun emoji » : c'est le CONTENU de la brique (Axel 27/09), jamais une icône d'interface.
  function thText(m, label) { return m.full || ((m.text || label || '') + (m.emoji ? ' ' + m.emoji : '')); }
  // Vidéos GÉNÉRÉES / POSSIBLES (Axel 27/09 : « Hook X généré / X possibles ») : mêmes emplacements que la fiche
  // (fmtVideosHTML : PHOTOS_PAR_AVATAR par avatar et par format), mêmes briques que la capacité — hooks parlés (sans alias ni
  // avant / après), liaisons, CTA → lipsync + voix native ; textes choc → Texte + musique. Sans factory_prod_stats : null.
  function genVideos(M) {
    var St = M && M.vars && M.vars.St, L = M && M.L;
    if (!St || St.state !== 'ready' || !L || !COH) return null;
    var NP = COH.PHOTOS_PAR_AVATAR || 3, A = L.avatars.length, avs = Object.create(null), per = Object.create(null), by = Object.create(null), kindOf = Object.create(null);
    // 07/10 (Axel) : un texte choc n'a pas d'emplacements à remplir (pas de limite) → hors de ce calcul ; sa fiche montre combien de fois il a servi
    var sets = { hook: lipHooks(L), liaison: L.liaisons, cta: L.ctas };
    var fmtsOf = function (k) { return k === 'texte-choc' ? FMT_ORDER['texte-choc'] : FMT_ORDER.spoken; };
    // 28/09 : voix autorisées par brique (meta.voices, ex. H19 / H74 = voix native uniquement) → formats de CETTE brique
    var fmtsFor = function (k, b) { var al = COH.voicesAllowed ? COH.voicesAllowed(b) : null, f = fmtsOf(k); return al ? f.filter(function (x) { return al.indexOf(x) >= 0; }) : f; };
    L.avatars.forEach(function (a) { avs[a.id] = a; });
    Object.keys(sets).forEach(function (k) { sets[k].forEach(function (b) { kindOf[b.id] = k; by[b.id] = { fmts: fmtsFor(k, b) }; }); });
    (St.videos || []).forEach(function (x) {
      var k = kindOf[x.brick];
      if (!k || by[x.brick].fmts.indexOf(x.format) < 0 || !mediaSrc(x.url)) return;
      var a = COH.photoParent ? COH.photoParent(x.photo) : x.photo, key = x.brick + '|' + x.format + '|' + a;
      if (!avs[a] || (COH.avatarVoiceOk && !COH.avatarVoiceOk(avs[a], x.format)) || (per[key] = (per[key] || 0) + 1) > NP) return;
      by[x.brick][x.format] = (by[x.brick][x.format] || 0) + 1;
    });
    var kinds = {};
    Object.keys(sets).forEach(function (k) {
      kinds[k] = fmtsOf(k).map(function (f) {
        return { f: f, done: sets[k].reduce(function (t, b) { return t + (by[b.id][f] || 0); }, 0),
          total: sets[k].filter(function (b) { return by[b.id].fmts.indexOf(f) >= 0; }).length * avatarsFor(L, f).length * NP };
      });
    });
    return { by: by, kinds: kinds, slot: A * NP };
  }
  function fmtVideosHTML(M, b) {
    var St = M && M.vars && M.vars.St, L = M && M.L;
    if (!St || St.state !== 'ready' || !L) return '';
    if (b.kind === 'hook' && COH && M.byId && M.byId[b.id] && (COH.isLipsyncHook ? !COH.isLipsyncHook(M.byId[b.id]) : COH.isAvantApres && COH.isAvantApres(M.byId[b.id]))) return '';   // 28/09 : un hook aux deux modes (H63) garde ses formats lipsync
    var fmts = b.kind === 'texte-choc' ? FMT_ORDER['texte-choc'] : FMT_ORDER.spoken, NP = COH && COH.PHOTOS_PAR_AVATAR || 3;
    { var al = COH && COH.voicesAllowed && M.byId && M.byId[b.id] ? COH.voicesAllowed(M.byId[b.id]) : null; if (al) fmts = fmts.filter(function (f) { return al.indexOf(f) >= 0; }); }   // 28/09 : voix autorisées
    var vids = (St.videos || []).filter(function (x) { return x.brick === b.id; });
    return '<div class="cf-bsf">' + fmts.map(function (f) {
      var avF = avatarsFor(L, f), fv = vids.filter(function (x) { return x.format === f; }), done = 0, total = avF.length * NP;
      var cells = avF.map(function (a) {
        var mine = fv.filter(function (x) { return (COH.photoParent ? COH.photoParent(x.photo) : x.photo) === a.id; }).slice(0, NP), out = [];
        for (var i = 0; i < NP; i++) {
          var x = mine[i], src = x && mediaSrc(x.url);
          if (src) { done += 1; out.push('<figure class="cf-bsf-v"><video controls playsinline preload="metadata" src="' + esc(vFirst(src)) + '"></video><figcaption><span class="cf-chip is-mod">' + esc(x.photo) + '</span></figcaption></figure>'); }
          else out.push('<div class="cf-bsf-v is-wait"><span>' + esc(a.id) + ' · photo ' + (i + 1) + '</span><b>en attente d’être créée</b></div>');
        }
        return out.join('');
      }).join('');
      return '<section class="cf-bsf-f"><h4 class="cf-bs-cap-t">' + esc(FMT_NAME[f]) + ' · ' + done + ' / ' + total + '</h4><div class="cf-bsf-g">' + cells + '</div></section>';
    }).join('') + '</div>';
  }

  // ── 03 · Briques : Bibliothèque · Assemblages (recettes de hooks) · Fraîcheur ──
  function bricksTabHTML(M) {
    var tabs = [['lib', 'Bibliothèque'], ['rec', 'Assemblages'], ['fresh', 'Fraîcheur']];
    var seg = '<div class="cf-btabs" role="group" aria-label="Briques">' + tabs.map(function (x) {
      var on = x[0] === ui.brTab;
      return '<button type="button" class="cf-btab' + (on ? ' is-on' : '') + '" data-act="br-tab" data-k="' + x[0] + '" aria-pressed="' + on + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    var body = !M.D ? naBody(M) : ui.brTab === 'rec' ? recipesHTML(M) : ui.brTab === 'fresh' ? freshHTML(M) : libHTML(M);
    var cls = ui.brTab === 'rec' && M.D ? ' cf-asm' : ui.brTab === 'lib' ? ' cf-lib' : '';
    return '<div class="cf-bricks">' + seg + '<section class="cf-card' + cls + '" data-block="bricks-' + ui.brTab + '">' + body + '</section></div>';
  }
  function libHTML(M) {
    var D = M.D, list = D.bricks.list.filter(live), cnt = {}, flagged = {};
    PK.forEach(function (x) { cnt[x.k] = 0; });
    var props = {}, photos = 0;
    list.forEach(function (b) {
      var tk = tileKind(b);
      if (cnt[tk] == null || isAlias(b)) return;
      if (b.status === 'ready') { cnt[tk] += 1; if (b.kind === 'avatar') photos += avPhotos(b).length; }
      else if (isProposal(b)) props[tk] = (props[tk] || 0) + 1;   // proposition (brouillon) : à part, jamais « prête »
      else flagged[tk] = (flagged[tk] || 0) + 1;
    });
    var max = Math.max.apply(null, PK.map(function (x) { return cnt[x.k]; }).concat([1]));
    var G = genVideos(M);
    var alias = list.filter(function (b) { return b.kind === 'hook' && b.status === 'ready' && b.meta.alias_of; }).length;
    var gen = list.filter(function (b) { return b.kind === 'liaison' && b.status === 'ready' && b.subject === 'generique'; }).length;
    var tiles = PK.map(function (x) {
      var n = cnt[x.k], on = ui.libKind === x.k;
      var sub = x.k === 'hook' ? n + ' ' + plural(n, 'hook unique', 'hooks uniques') + (alias ? ' · ' + alias + ' alias' : '')
        : x.k === 'liaison' ? x.sub + (gen ? ' · ' + gen + ' ' + plural(gen, 'générique') : '')
          : x.k === 'avatar' ? n + ' ' + plural(n, 'avatar') + ' · ' + photos + ' ' + plural(photos, 'photo') : x.sub;
      if (props[x.k]) sub += ' · ' + props[x.k] + ' ' + plural(props[x.k], 'proposition');
      if (flagged[x.k]) sub += ' · ' + flagged[x.k] + ' hors service';
      return '<button type="button" class="cf-ltile' + (on ? ' is-on' : '') + '" data-act="lib-kind" data-k="' + x.k + '" aria-pressed="' + on + '">'
        + '<span class="cf-ltile-h"><span>' + esc(x.t) + '</span>' + svg(IC[x.ic], 16) + '</span><b>' + esc(fInt(n)) + '</b>'
        + '<span class="cf-lbar"><i style="width:' + (n ? n / max * 100 : 0).toFixed(1) + '%"></i></span><span class="cf-ltile-s">' + esc(sub) + '</span>'
        + (G && G.kinds[x.k] ? '<span class="cf-ltile-g" title="vidéos générées / possibles (' + esc(fInt(G.slot)) + ' par brique et par format)"><span class="cf-ltile-gh">Vidéos générées</span>'
          + G.kinds[x.k].map(function (v) { return '<span><span class="cf-gn">' + esc(fInt(v.done)) + '</span> / ' + esc(fInt(v.total)) + ' ' + esc(FMT_SHORT[v.f]) + '</span>'; }).join('') + '</span>' : '')
        + '</button>';
    }).join('');
    var grid = '';
    if (ui.libKind) {
      var q = ui.libQuery.trim().toLowerCase(), K = PKM[ui.libKind];
      // grille = briques uniques (la maquette ne liste pas les alias) ; un alias reste trouvable par la recherche
      var all = list.filter(function (b) { return tileKind(b) === ui.libKind && !isAlias(b); });
      var hit = list.filter(function (b) { return tileKind(b) === ui.libKind && (!isAlias(b) || q); }).filter(function (b) {
        return !q || [b.id, b.label, b.meta.script, b.meta.transcript, b.meta.keyword, b.subject].some(function (s) { return s && s.toLowerCase().indexOf(q) >= 0; });
      });
      // propositions (sous-titres en brouillon, meta.proposal) : à part, sous la grille, jamais comptées comme prêtes
      var main = hit.filter(function (b) { return !isProposal(b); }), prop = hit.filter(isProposal), nMain = all.filter(function (b) { return !isProposal(b); }).length;
      grid = '<div class="cf-lgrid-w"><div class="cf-lgrid-h"><h3 class="cf-h2">' + esc(K.t) + ' <span class="cf-badge">' + esc(fInt(nMain)) + '</span></h3>'
        + '<label class="cf-search"><span class="cf-sr">Rechercher un ID ou un texte</span>' + svg(IC.search, 14) + '<input id="cfLibQ" type="search" placeholder="Rechercher un ID ou un texte" value="' + esc(ui.libQuery) + '" autocomplete="off"></label></div>'
        + (main.length ? '<div class="cf-lgrid">' + main.map(function (b) { return libItemHTML(b, G); }).join('') + '</div>' : !prop.length ? '<div class="cf-empty-s">' + esc(all.length ? 'Aucune brique ne correspond à « ' + ui.libQuery.trim() + ' ».' : 'Aucune brique de ce type pour l’instant.') + '</div>' : '')
        + (prop.length ? '<div class="cf-over cf-lprop-h">Propositions · ' + prop.length + '</div><div class="cf-lgrid is-prop">' + prop.map(function (b) { return libItemHTML(b, G); }).join('') + '</div>' : '') + '</div>';
    }
    return '<div class="cf-ltiles">' + tiles + '</div>' + grid;
  }
  function libItemHTML(b, G) {
    var m = b.meta, tag = '', gv = G && G.by[b.id];
    if (b.kind === 'hook') tag = m.alias_of ? 'alias de ' + m.alias_of : m.compatible_subjects.indexOf('generique') >= 0 ? 'générique' : m.compatible_subjects.length + ' ' + plural(m.compatible_subjects.length, 'sujet');
    else if (b.kind === 'liaison') tag = b.subject === 'generique' ? 'générique' : m.modules.length + ' ' + plural(m.modules.length, 'module');
    else if (b.kind === 'cta') tag = m.keyword ? 'mot-clé ' + m.keyword : 'sans mot-clé';
    else if (b.kind === 'contenu') tag = subjName(b.subject || '?');
    else if (b.kind === 'texte-choc') { var nC = chocUses(b.id); tag = nC == null ? '' : 'utilisé ' + fInt(nC) + NB + 'fois'; }
    // moteur lu dans meta.engine (07/10 : R-H3…R-H9 = vraies vidéos selfie d'Axel, pas de l'IA) ; ancien repli sur le libellé
    else if (b.kind === 'reaction' && m.format === 'insomnie') tag = 'Au lit, yeux fermés · ' + (m.duration || 4) + ' s';
    else if (b.kind === 'reaction') tag = (m.engine === 'video-reelle' ? 'Vidéo réelle' : m.engine === 'veo-lite' || /veo/i.test(b.label || '') ? 'Veo Lite (test)' : 'Omni Flash') + ' · ' + (m.duration || 3) + ' s';   // 13/10 : durée réelle (R-LIT = 4 s)
    else if (b.kind === 'transformation') tag = subjName(b.subject || '?');
    else if (b.kind === 'avatar') { var np = avPhotos(b).length; tag = np + ' ' + plural(np, 'photo'); }
    if (isProposal(b)) tag = 'proposition';
    else if (b.status !== 'ready') tag = stFr(b.status) + (tag ? ' · ' + tag : '');
    var text = b.kind === 'texte-choc' ? thText(m, b.label) : m.transcript || m.script || b.label || (m.value ? 'style ' + m.value : '');
    // avatar : toutes ses photos en vignettes (la photo = le décor, pas une vidéo de plus)
    var ph = b.kind === 'avatar' ? avPhotos(b) : [];
    return '<button type="button" class="cf-litem' + (b.status !== 'ready' && !isProposal(b) ? ' is-off' : '') + (isProposal(b) ? ' is-prop' : '') + '" data-act="brick-open" data-bid="' + esc(b.id) + '">'
      + '<span class="cf-litem-h"><b>' + esc(b.id) + '</b><span class="cf-litem-m">' + esc(tag) + '</span></span>'
      + (ph.length ? '<span class="cf-litem-ph">' + ph.map(function (u, i) { var nm = (String(u).split(/[?#]/)[0].match(/\/([A-Za-z0-9]+-\d+)\.(?:jpe?g|png|webp)$/i) || [])[1] || ''; return thumbImg(u, 96, 'alt="' + esc(nm) + '" title="' + esc(nm) + '" loading="lazy" decoding="async" data-i="' + i + '"', true); }).join('') + '</span>' : '')
      + '<span class="cf-litem-t">' + esc(shorten(text, 96) || '—') + '</span>'
      + (gv ? '<span class="cf-litem-g">' + gv.fmts.map(function (f) {
        var d = gv[f] || 0;
        return '<span class="' + (d >= G.slot ? 'is-full' : d ? 'is-part' : '') + '">' + esc(FMT_SHORT[f]) + ' <span class="cf-gn">' + d + '</span>/' + G.slot + '</span>';
      }).join('') + '</span>' : '') + '</button>';
  }
  // Assemblages = recettes de hooks visuels (factory_recipes : TX-A → TX-B), présentées comme la liste « Assemblages » de la
  // maquette : barre des statuts, filtres, tableau, 8 lignes puis « Afficher les N assemblages ».
  var REC_ST = { done: ['terminé', 'is-ok'], in_progress: ['en cours', 'is-pend'], pending: ['à faire', ''], other: ['statut inconnu', 'is-ko'], retired: ['retirés', 'is-off'] };
  var REC_LIM = 8;
  // Clips d'un assemblage en clair (« Renault Clio → Porsche 911 GT3 ») : meta.clips de la recette, sinon le côté avant /
  // après de chaque transformation (components[].clip), sinon (ancien format) la transformation entière.
  function recClips(r) {
    var byId = prodModel().byId;
    if (r.clips.length) return r.clips.map(function (c) { return { id: c.id, t: c.label || c.id }; });
    return r.comps.map(function (c) {
      var tx = Object.prototype.hasOwnProperty.call(byId, c.id) ? byId[c.id] : null, m = tx ? tx.meta : {};
      var sd = c.clip === 'before' ? m.before : c.clip === 'after' ? m.after : null;
      return { id: c.id, t: (sd && sd.label) || (tx && tx.label) || c.id };
    });
  }
  function recCheck(r) { return COH && COH.assemblyCheck ? COH.assemblyCheck(r, CF.prod.data ? CF.prod.data.bricks.list : []) : null; }
  function clipChips(r, cls) {
    var cl = recClips(r);
    return cl.length ? cl.map(function (c) {
      return '<button type="button" class="' + cls + '" data-act="brick-open" data-bid="' + esc(c.id) + '" title="' + esc(c.id) + '">' + esc(c.t) + '</button>';
    }).join('<span class="cf-arrow" aria-hidden="true">' + svg(IC.arrow, 12) + '</span>') : '<span class="cf-meta">aucun composant</span>';
  }
  function recipesHTML(M) {
    var All = M.D.recipes.list.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    // recettes retirées (règle du 26/09) : jamais dans « Tous » ni dans le compteur, filtre « retirés » à part
    var R = All.filter(function (r) { return r.status !== 'retired'; }), nRet = All.length - R.length;
    var head = '<div class="cf-asm-h"><h3 class="cf-h2">Assemblages <span class="cf-badge">' + R.length + '</span></h3>';
    if (!All.length) return head + '</div><div class="cf-asm-empty"><span class="cf-asm-empty-ic">' + svg(IC.layers, 22) + '</span><b>Aucun assemblage pour l’instant</b><span>Aucune recette pour l’instant.</span></div>';
    var by = {};
    All.forEach(function (r) { by[r.status] = (by[r.status] || 0) + 1; });
    var order = ['done', 'in_progress', 'pending', 'other'].filter(function (s) { return by[s]; });
    var f = ui.recFilter && by[ui.recFilter] ? ui.recFilter : 'all';
    var segs = '<div class="cf-asm-bar" aria-hidden="true">' + order.map(function (s) { return '<i class="' + (REC_ST[s][1] || 'is-todo') + '" style="width:' + (by[s] / Math.max(1, R.length) * 100).toFixed(2) + '%"></i>'; }).join('') + '</div>';
    var chip = function (s) {
      return '<button type="button" class="cf-asm-chip' + (f === s ? ' is-on' : '') + '" data-act="rec-filter" data-k="' + s + '" aria-pressed="' + (f === s) + '"><i class="' + (REC_ST[s][1] || 'is-todo') + '"></i>' + esc(REC_ST[s][0]) + '<span>' + by[s] + '</span></button>';
    };
    var chips = '<div class="cf-asm-chips"><button type="button" class="cf-asm-chip' + (f === 'all' ? ' is-on' : '') + '" data-act="rec-filter" data-k="all" aria-pressed="' + (f === 'all') + '">Actifs<span>' + R.length + '</span></button>'
      + order.map(chip).join('') + (nRet ? chip('retired') : '') + '</div>';
    var rows = (f === 'all' ? R : All.filter(function (r) { return r.status === f; })), vis = ui.recAll ? rows : rows.slice(0, REC_LIM);
    var sig = function (r) { return recClips(r).map(function (c) { return c.t; }).join('>'); }, dup = Object.create(null);
    rows.forEach(function (r) { var k = sig(r); dup[k] = (dup[k] || 0) + 1; });
    var body = vis.map(function (r) {
      var st = REC_ST[r.status] || REC_ST.other, sc = dup[sig(r)] > 1 ? (/\(([^()]+)\)\s*$/.exec(r.label || '') || [])[1] : '';
      return '<div class="cf-arow" data-rid="' + esc(r.id) + '"><span class="cf-arow-id"><button type="button" class="cf-vid is-btn" data-act="asm-open" data-rid="' + esc(r.id) + '">' + esc(r.id) + '</button></span><span class="cf-arow-m">' + esc(subjName(r.subject || '—')) + '</span><span class="cf-combo">'
        + clipChips(r, 'cf-chip is-brick is-btn') + (sc ? '<span class="cf-arow-sc">' + esc(sc) + '</span>' : '')
        + '</span><span><span class="cf-qchip ' + st[1] + '">' + esc(r.status === 'retired' ? 'retiré' : st[0]) + '</span></span><span class="cf-arow-r">'
        + (r.render ? '<button type="button" class="cf-btn is-sm" data-act="rec-play" data-rid="' + esc(r.id) + '">' + svg(IC.play, 11) + 'voir</button>'
          : '<span class="cf-meta" title="' + esc(r.renderWhy || '') + '">rendu introuvable</span>') + '</span></div>';
    }).join('');
    var missing = rows.filter(function (r) { return !r.render; });
    return head + segs + chips + '</div>'
      + '<div class="cf-arow is-head" aria-hidden="true"><span>ID assemblage</span><span>Module</span><span>Composants</span><span>Statut</span><span class="cf-arow-r">Rendu</span></div>'
      + '<div class="cf-alist">' + body + '</div>'
      + (rows.length > REC_LIM ? '<button type="button" class="cf-asm-more" data-act="rec-all">' + esc(ui.recAll ? 'Afficher moins' : 'Afficher les ' + rows.length + ' assemblages') + '</button>' : '')
      + (missing.length ? '<div class="cf-asm-note cf-meta">' + esc(missing.length + ' ' + plural(missing.length, 'rendu introuvable', 'rendus introuvables') + ' : ' + missing[0].renderWhy + (missing.length > 1 ? ' (ex. ' + missing[0].id + ')' : '')) + '</div>' : '');
  }
  // Fiche d'un assemblage (même fenêtre que la fiche vidéo finale) : lecteur du rendu, composants en clair, module, statut
  function asmSheetHTML(rid) {
    var D = CF.prod.data, r = D ? D.recipes.list.filter(function (x) { return x.id === rid; })[0] : null;
    if (!r) return '<div class="cf-vf">' + underBack('asm-back') + '<div class="cf-vf-h"><h2 class="cf-vf-t" id="cfModalTitle">' + esc(rid || 'Assemblage') + '</h2><span class="cf-meta">introuvable (relu entre-temps)</span></div></div>';
    var st = REC_ST[r.status] || REC_ST.other, ck = r.status === 'retired' ? null : recCheck(r);
    var meta = ['Assemblage', subjName(r.subject || '—'), r.group ? 'groupe ' + r.group : '', r.status === 'retired' ? 'retiré' : st[0],
      r.duration != null ? fDec(r.duration, 1) + NB + 's' : ''].filter(Boolean).join(' · ');
    var cl = recClips(r), line = r.label || cl.map(function (c) { return c.t; }).join(' → ');
    var v = mediaSrc(r.render);
    var media = '<div class="cf-vf-stage"><div class="cf-vf-frame cf-mbox' + (v ? '' : ' is-broken') + '">'
      + (v ? '<video controls playsinline preload="metadata" src="' + esc(vFirst(v)) + '"></video><span class="cf-vmsg">rendu illisible (fichier introuvable ou refusé)</span>'
        : '<span class="cf-vmsg is-on">rendu introuvable · ' + esc(r.renderWhy || 'aucun lien') + '</span>') + '</div></div>';
    return '<div class="cf-vf cf-asmf" data-rid="' + esc(r.id) + '">' + underBack('asm-back') + '<div class="cf-vf-h"><h2 class="cf-vf-t" id="cfModalTitle">' + esc(r.id) + '</h2><span class="cf-meta">' + esc(meta) + '</span>'
      + (line ? '<span class="cf-asmf-l">' + esc(line) + '</span>' : '')
      + (ck && !ck.valid && ck.reasons.length ? '<span class="cf-vf-why">' + esc('à revoir : ' + ck.reasons.join(' · ')) + '</span>' : '') + '</div>'
      + media + '<div class="cf-over">Composants</div><div class="cf-vf-chips">' + clipChips(r, 'cf-vf-chip') + '</div></div>';
  }
  function openAsm(rid, trigger) {
    if (!rid || !CF.prod.data) return;
    // fenêtre déjà ouverte (revue QC, fiche vidéo finale) : l'assemblage se pose par-dessus, comme une brique ; la revue
    // (position, motif en cours) reste dans ui.modal et le focus d'origine (ui.lastFocus) n'est pas touché
    if (ui.modal && (ui.modal.qc || ui.modal.vf)) {
      ui.modal.asm = rid; ui.modal.brick = null;
      renderModal();
      $('cfModalBody').scrollTop = 0;
      var bk = document.querySelector('#cfModalBody [data-act="asm-back"]'); if (bk) bk.focus();
      return;
    }
    openModal({ asm: rid }, trigger);
  }
  function asmBack() {
    if (!ui.modal || !ui.modal.asm || !(ui.modal.qc || ui.modal.vf)) return;
    var rid = ui.modal.asm; ui.modal.asm = null;
    renderModal();
    var b = [].slice.call(document.querySelectorAll('#cfModalBody [data-act="asm-open"]')).filter(function (x) { return x.getAttribute('data-rid') === rid; })[0];
    if (b) b.focus();
  }
  // Bouton retour vers la fenêtre d'en dessous (revue QC ou fiche vidéo finale), '' si l'élément est seul
  function underBack(act) {
    var M = ui.modal, label = M.qc ? 'Revue QC' : M.vf ? vfTitle(M.vf) : '';
    return label ? '<button type="button" class="cf-back" data-act="' + act + '">' + svg('M15 18l-6-6 6-6', 14) + esc(label) + '</button>' : '';
  }
  function vfTitle(qid) {
    var D = CF.prod.data, q = D ? D.qc.list.filter(function (x) { return x.id === qid; })[0] : null;
    return q ? vfName(q) : 'Vidéo finale';
  }
  function freshHTML(M) {
    var k = ui.freshKind;
    var head = chead('Fraîcheur des briques', 'dernière utilisation reconnue dans un reel') + perfSeg('fresh-kind', k);
    if (!HEARD[k]) return head + emptyLine('—', NOT_YET);
    var ms = mediaState();
    if (ms.st === 'wait') return head + spin('Chargement des publications…');
    if (ms.st !== 'ok') return head + emptyLine('—', ms.why);
    var I = brickIndex(), all = M.D.bricks.list.filter(function (b) { return b.kind === k && b.status === 'ready' && !isAlias(b); });
    var never = all.filter(function (b) { return !I.by[b.id]; }), used = all.filter(function (b) { return I.by[b.id]; })
      .sort(function (a, b) { return (I.by[a.id].last || 0) - (I.by[b.id].last || 0); });
    if (!all.length) return head + '<div class="cf-empty-s">' + esc('Aucun' + (k === 'liaison' ? 'e ' : ' ') + KIND_PL[k][0] + ' dans la bibliothèque pour l’instant.') + '</div>';
    var box = never.length ? '<div class="cf-fnever"><b>' + esc(never.length + ' ' + plural(never.length, KIND_PL[k][0], KIND_PL[k][1]) + ' jamais ' + plural(never.length, 'utilisé' + (k === 'liaison' ? 'e' : ''), 'utilisé' + (k === 'liaison' ? 'es' : 's'))) + '</b>'
      + '<div class="cf-fchips-w">' + never.map(function (b) { return '<button type="button" class="cf-chip is-brick is-btn" data-act="brick-open" data-bid="' + esc(b.id) + '">' + esc(b.id) + '</button>'; }).join('') + '</div></div>'
      : '<div class="cf-meta">' + esc(k === 'liaison' ? 'aucune liaison jamais utilisée' : 'aucun ' + KIND_PL[k][0] + ' jamais utilisé') + '</div>';
    var rows = used.map(function (b) {
      var r = I.by[b.id], old = r.last != null && Date.now() - r.last > 30 * 864e5;
      return '<div class="cf-frow"><button type="button" class="cf-pid" data-act="brick-open" data-bid="' + esc(b.id) + '">' + esc(b.id) + '</button>'
        + '<span class="cf-frow-b"><b>' + esc(r.last != null ? ago(r.last) : 'date inconnue') + '</b><span class="cf-meta">' + esc(r.n + ' ' + plural(r.n, 'publication') + ' · ' + (r.nv ? fInt(r.views) + ' ' + plural(r.views, 'vue') : 'vues —')) + '</span></span>'
        + '<span class="cf-qchip ' + (old ? 'is-pend' : 'is-ok') + '">' + (old ? 'à réutiliser' : 'récente') + '</span></div>';
    }).join('');
    return head + box + (used.length ? '<div class="cf-over">Déjà ' + esc(plural(used.length, 'utilisée', 'utilisées')) + ' · les plus anciennes d’abord</div><div class="cf-flist">' + rows + '</div>' : '');
  }

  // ── revue QC (modale) : une vidéo à la fois ; la suivante ne s'affiche qu'après un enregistrement RÉUSSI ──
  function qcOpen(startId, trigger) {
    var D = CF.prod.data;
    if (!D) return;
    var list = D.qc.list.filter(function (q) { return q.status === 'pending'; }).sort(function (a, b) { return (a.created || 0) - (b.created || 0); });
    if (!list.length) return;
    var items = {};
    list.forEach(function (q) { items[q.id] = q; });   // instantané : une relecture de la file ne change pas la vidéo à l'écran
    var ids = list.map(function (q) { return q.id; }), i = startId ? Math.max(0, ids.indexOf(startId)) : 0;
    openModal({ qc: { ids: ids, items: items, i: i, done: {}, busy: null, msg: null, refusing: false, reason: '' } }, trigger);
  }
  function openModal(state, trigger) {
    ui.modal = state;
    ui.lastFocus = trigger || null;
    renderModal();
    var wrap = document.querySelector('.cf-wrap'); if (wrap) wrap.inert = true;
    $('cfModal').hidden = false;
    document.body.classList.add('cf-lock');
    $('cfModalClose').focus();
  }
  function renderQcModal() {
    var R = ui.modal.qc, id = R.ids[R.i], q = id ? R.items[id] : null, body = $('cfModalBody');
    if (!q) { setHTML(body, qcDoneHTML(R)); return; }
    var cur = body.querySelector('.cf-qc');
    if (!cur || cur.getAttribute('data-qid') !== id) {   // lecteur recréé seulement quand la vidéo change (jamais au milieu d'une lecture)
      setHTML(body, qcShellHTML(R, q));
      var v = body.querySelector('video');
      if (v && v.play) { try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () { /* lecture auto refusée : le bouton suffit */ }); } catch (e) { /* rien */ } }
    }
    // relecture de fond (toutes les 2 min, retour sur l'onglet) pendant qu'on tape le motif : le champ garde le focus et
    // la sélection, jamais une frappe perdue
    var a = document.activeElement, keep = a && a.id === 'cfQcReason' ? { s: a.selectionStart, e: a.selectionEnd } : null;
    setHTML(body.querySelector('.cf-qc-side'), qcSideHTML(R, q));
    var ta = keep && $('cfQcReason');
    if (ta && document.activeElement !== ta) { try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); } try { ta.setSelectionRange(keep.s, keep.e); } catch (e) { /* rien */ } }
  }
  function qcShellHTML(R, q) {
    var n = R.ids.length, pos = R.i + 1;
    var vsrc = mediaSrc(q.video), psrc = mediaSrc(q.poster);
    var media = vsrc ? '<video class="cf-qc-vid" controls playsinline preload="metadata" src="' + esc(psrc ? vsrc : vFirst(vsrc)) + '"' + (psrc ? ' poster="' + esc(psrc) + '"' : '') + '></video>'
      + '<span class="cf-vmsg">vidéo illisible (fichier introuvable ou refusé)</span>'
      : '<span class="cf-vmsg is-on">vidéo introuvable · ' + esc(q.videoWhy || 'aucune vidéo') + '</span>';
    return '<div class="cf-qc" data-qid="' + esc(q.id) + '"><div class="cf-qc-top"><h2 class="cf-h2" id="cfModalTitle">Revue QC</h2>'
      + '<span class="cf-meta">' + esc(pos + ' / ' + n + ' · ' + plural(n, 'vidéo') + ' à valider') + '</span></div>'
      + '<div class="cf-qc-grid"><div class="cf-qc-stage cf-mbox' + (vsrc ? '' : ' is-broken') + '">' + media + '</div><div class="cf-qc-side"></div></div></div>';
  }
  function qcSideHTML(R, q) {
    var coh = q.coh, recalc = false;
    if (!coh && q.combo && COH && CF.prod.data) {   // ligne sans technical.coherence : même règle, recalculée ici (dit comme tel)
      var byId = prodModel().byId, r = COH.comboCheck(q.combo, byId);
      coh = { level: r.level, reasons: r.reasons }; recalc = true;
    }
    var cohH = coh ? '<div class="cf-qc-coh is-' + coh.level + '"><b>' + (coh.level === 'ok' ? 'Cohérence : ok' : 'Cohérence à vérifier') + (recalc ? '<span class="cf-meta"> · recalculée ici</span>' : '') + '</b>'
      + (coh.reasons.length ? '<ul>' + coh.reasons.map(function (x) { return '<li>' + esc(cohWhy(x)) + '</li>'; }).join('') + '</ul>' : '<span>paire hook × démo couverte par les tags</span>') + '</div>'
      : '<div class="cf-qc-coh"><b>Cohérence : —</b><span>' + esc(q.combo ? 'règle de cohérence indisponible' : 'recette au format libre : cohérence non vérifiable') + '</span></div>';
    var T = q.tech, tech = T.error ? 'erreur : ' + T.error
      : (T.route || q.route ? (T.route || q.route) === 'manual' ? 'manuel' : 'auto' : '—')
        + (T.hard.length ? ' · échecs : ' + T.hard.join(', ') : '') + (T.soft.length ? ' · alertes : ' + T.soft.join(', ') : '')
        + (!T.hard.length && !T.soft.length && T.pass === true ? ' · tous les contrôles passés' : '');
    var V = q.vis, vis = !V ? 'non lancé (pas de clé IA)' : (V.route === 'doubt' ? 'doute' : V.route === 'ok' ? 'ok' : '—')
      + (V.verdict ? (V.verdict.confidence != null ? ' · confiance ' + fDec(V.verdict.confidence * 100, 0) + NB + '%' : '')
        + (V.verdict.glitch ? ' · glitch repéré' : '') + (V.verdict.qualityOk === false ? ' · qualité insuffisante' : '') + (V.verdict.matches === false ? ' · image ≠ texte' : '')
        + (V.verdict.notes ? ' · « ' + V.verdict.notes + ' »' : '') : '');
    var busy = !!R.busy, dis = busy ? ' disabled' : '';
    var acts = R.refusing
      ? '<label class="cf-lbl" for="cfQcReason">Motif du refus (obligatoire)</label><textarea id="cfQcReason" class="cf-in cf-qc-reason" maxlength="500" placeholder="Ce qu’il faut corriger"' + dis + '>' + esc(R.reason) + '</textarea>'
        + '<div class="cf-qc-acts"><button type="button" class="cf-btn" data-act="qc-refuse-cancel"' + dis + '>Annuler</button>'
        + '<button type="button" class="cf-btn is-ko" data-act="qc-refuse-ok"' + (busy || !R.reason.trim() ? ' disabled' : '') + '>' + (R.busy === 'refuse' ? 'Enregistrement…' : 'Refuser et noter') + '</button></div>'
      : '<div class="cf-qc-acts"><button type="button" class="cf-btn is-ko" data-act="qc-refuse"' + dis + '>' + svg('M18 6 6 18M6 6l12 12', 14) + 'Refuser</button>'
        + '<button type="button" class="cf-btn is-okb" data-act="qc-approve"' + dis + '>' + svg(IC.check, 14) + (R.busy === 'approve' ? 'Enregistrement…' : 'Valider') + '</button></div>';
    return '<div class="cf-meta">' + esc((q.template || 'modèle inconnu') + ' · ' + qcWhen(q.created, 'rendue') + (q.created != null ? ' à ' + hm(new Date(q.created)) : '')) + '</div>'
      + '<span class="cf-qchip ' + (q.route === 'manual' ? 'is-pend' : 'is-ok') + '">' + esc(q.route === 'manual' ? 'revue manuelle' : q.route === 'auto' ? 'route auto' : 'route inconnue') + '</span>'
      + cohH
      + '<div class="cf-over">Recette</div>' + comboChips(q)
      + '<div class="cf-qc-kv"><span class="cf-over">Contrôle technique</span><span>' + esc(tech) + '</span></div>'
      + '<div class="cf-qc-kv"><span class="cf-over">Contrôle visuel (IA)</span><span>' + esc(vis) + '</span></div>'
      + acts + (R.msg ? '<div class="cf-acct-msg is-err" role="alert">' + esc(R.msg) + '</div>' : '');
  }
  function qcDoneHTML(R) {
    var ok = 0, ko = 0;
    Object.keys(R.done).forEach(function (k) { if (R.done[k] === 'approve') ok += 1; else ko += 1; });
    return '<div class="cf-qc-done"><span class="cf-qc-done-ic">' + svg(IC.check, 26) + '</span><h2 class="cf-h2" id="cfModalTitle">Tout est passé en revue</h2>'
      + '<p class="cf-meta">' + esc(ok + ' ' + plural(ok, 'validée') + ' · ' + ko + ' ' + plural(ko, 'refusée') + ' dans cette revue') + '</p>'
      + '<button type="button" class="cf-btn is-dark" data-act="modal-close">Retour à la production</button></div>';
  }
  function qcDo(act) {
    var R = ui.modal && ui.modal.qc;
    if (!R || R.busy) return;
    var id = R.ids[R.i];
    if (!id) return;
    if (act === 'refuse' && !R.reason.trim()) { R.msg = 'Motif obligatoire : écris ce qu’il faut corriger.'; renderModal(); return; }
    R.busy = act; R.msg = null;
    renderModal();
    (act === 'approve' ? CF.qcApprove(id) : CF.qcRefuse(id, R.reason)).then(function (r) {
      if (!ui.modal || ui.modal.qc !== R) return;   // revue fermée entre-temps
      R.busy = null;
      if (r && r.ok) { R.done[id] = act; R.refusing = false; R.reason = ''; R.msg = null; R.i += 1; }
      else R.msg = 'Non enregistré : ' + ((r && r.error) || 'erreur inconnue') + '. La vidéo reste à valider.';
      renderModal();
      var f = document.querySelector('#cfModalBody [data-act="qc-approve"]') || document.querySelector('#cfModalBody [data-act="modal-close"]') || document.querySelector('#cfModalBody #cfQcReason');
      if (f) f.focus();
    }, function (e) {
      if (!ui.modal || ui.modal.qc !== R) return;
      R.busy = null; R.msg = 'Non enregistré : ' + ((e && e.message) || 'erreur inconnue') + '. La vidéo reste à valider.';
      renderModal();
    });
  }
  function qcClassify(id) {
    if (!id || ui.qcBusy[id]) return;
    ui.qcBusy[id] = 1; ui.qcMsg = null;
    render();
    CF.qcClassify(id).then(function (r) {
      delete ui.qcBusy[id];
      ui.qcMsg = r && r.ok ? { ok: true, text: 'Refus classé.' } : { ok: false, text: 'Non classé : ' + ((r && r.error) || 'erreur inconnue') };
      render();
    });
  }
  function recPlay(rid, trigger) {
    var D = CF.prod.data, r = D && D.recipes.list.filter(function (x) { return x.id === rid; })[0];
    if (!r || !mediaSrc(r.render)) return;
    openModal({ video: { url: mediaSrc(r.render), title: r.id, sub: 'assemblage · ' + subjName(r.subject || '—') + ' · ' + recClips(r).map(function (c) { return c.t; }).join(' → ') } }, trigger);
  }
  function videoModalHTML(v) {
    return '<div class="cf-vsheet"><h2 class="cf-h2" id="cfModalTitle">' + esc(v.title) + '</h2><div class="cf-meta">' + esc(v.sub) + '</div>'
      + '<div class="cf-vbox cf-mbox"><video class="cf-rvid" controls playsinline preload="metadata" src="' + esc(vFirst(v.url)) + '"></video><span class="cf-vmsg">rendu introuvable (fichier illisible)</span></div></div>';
  }

  // ══ BloxAI (16/10/2026, ex-TrackAds ; Axel : « un seul stock pour tout le monde ») ═════════════════════════════════
  // Lit CF.bx (edge bloxai → fonction factory de BloxAI, payload bx_factory_stats) : stock commun et kit, cycle des missions
  // (24 h pour publier ET coller les liens), séries 30 j, diffuseurs (classement), à vérifier, pièces d'identité,
  // versements. « 0 » = mesuré et nul ; « — » + raison = BloxAI ne le dit pas. Chaque action est un clic explicite (motif
  // ou confirmation) envoyé par CF.bxAdmin ; les chiffres sont relus juste après. Tout texte venu de BloxAI passe par esc().
  var BX_NR = 'non renvoyé par BloxAI';
  var BX_KIND = { monthly: 'versement mensuel', mid_month: 'versement du 15', request: 'demande (palier Elite)' };
  var BX_METHOD = { paypal: 'PayPal', iban: 'virement IBAN' };
  var BX_PAY_ST = { requested: 'demandé', pending: 'à verser', paid: 'payé', cancelled: 'annulé' };
  var BX_MST = { open: ['dans le stock commun', 'is-pend'], assigned: ['en mission', 'is-pend'], done: ['publiée par un diffuseur', 'is-ok'],
    kit: ['passée au kit', 'is-ok'], retired: ['retirée du stock', 'is-ko'] };
  var BX_AST = { active: ['en cours', 'is-pend'], submitted: ['liens envoyés', 'is-ok'], abandoned: ['abandonnée', 'is-ko'], expired: ['échouée · 24 h dépassées', 'is-ko'] };
  var BX_PST = { verif: ['en suivi', 'is-pend'], valid: ['validée', 'is-ok'], refus: ['refusée', 'is-ko'] };
  var BX_NET = { instagram: ['Instagram', /(^|\.)instagram\.com$/i], tiktok: ['TikTok', /(^|\.)tiktok\.com$/i], youtube: ['YouTube', /(^|\.)(youtube\.com|youtu\.be)$/i] };
  var BX_SORT = [['fiab', 'Fiabilité'], ['vues', 'Vues'], ['rapid', 'Rapidité']];
  var BX_LIST_MAX = 15, BX_RANK_MAX = 20;
  // Courbe des missions : 3 séries, palette catégorielle validée (validate_palette.js, toutes paires, CVD ΔE ≥ 9) ; une
  // échelle par graphique (vues à part, jamais deux axes) ; légende avec totaux + bulle : jamais la couleur seule.
  var BX_SER = [{ k: 'claimed', l: 'prises', c: '#2a78d6' }, { k: 'lost', l: 'échouées ou abandonnées', c: '#eb6834' }, { k: 'submitted', l: 'envoyées', c: '#1baf7a' }];
  var bxCharts = {}, bxHot = false;

  function ensureBx() {
    if (CF.status !== 'ready') return;
    CF.loadBx();
    CF.loadProd();   // kit à programmer (factory_posts) et fiches des vidéos finales (VF)
  }
  function fEur(c) { return c == null ? null : fDec(c / 100, 2) + NB + '€'; }
  function bxN(v) { return v == null ? '—' : fInt(v); }
  function fGap(n) { return n < 0 ? MINUS + fInt(-n) : fInt(n); }   // écart négatif : vrai signe moins
  function fHours(h) { return h == null ? null : h < 1 ? Math.max(1, Math.round(h * 60)) + NB + 'min' : fDec(h, h < 10 ? 1 : 0) + NB + 'h'; }
  function bxWhyShort() {
    var S = CF.bx;
    if (S.kind === 'missing') return 'fonction bloxai pas encore déployée';
    if (S.kind === 'auth') return 'session expirée : reconnecte-toi';
    if (S.state === 'error') return 'BloxAI illisible : ' + S.error;
    return S.loading || S.state === 'idle' ? 'chargement' : 'BloxAI illisible';
  }
  function bxModel() {
    var S = CF.bx, D = S.data;
    return { S: S, D: D, pending: !D && (S.loading || S.state === 'idle'), why: D ? '' : bxWhyShort() };
  }
  // Parties du contrat bx_factory_stats absentes de la réponse (chacune affiche « — » là où elle sert)
  function bxMissing(D) {
    var out = [];
    var chk = function (o, keys, label) { if (keys.some(function (k) { return o[k] == null; })) out.push(label); };
    chk(D.stock, ['open', 'available', 'assigned', 'done', 'kit', 'retired'], 'stock');
    chk(D.asg, ['active', 'submitted', 'abandoned', 'expired'], 'missions');
    chk(D.pub, ['verif', 'valid', 'refus', 'views'], 'publications');
    chk(D.users, ['total', 'active7'], 'diffuseurs');
    chk(D.money, ['unpaid'], 'solde');
    if (!D.money.payouts) out.push('versements');
    if (!D.identity) out.push('pièces d’identité');
    if (!D.toCheck) out.push('liste à vérifier');
    if (!D.ranking) out.push('classement');
    if (!D.series) out.push('série 30' + NB + 'j');
    return out;
  }
  // Jour de Paris (AAAA-MM-JJ) d'un instant : les jours de la série BloxAI
  var PARIS_DAY = (function () {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }); } catch (e) { return null; }
  })();
  function parisDay(t) { return PARIS_DAY ? PARIS_DAY.format(new Date(t)) : new Date(t).toISOString().slice(0, 10); }
  // Missions BloxAI prises sur une période des « Montages prêts » (Production) : 24 h = compteur de BloxAI, 7 / 30 j = série
  // 30 j (un point par jour, aligné sur la courbe), au-delà = toutes les missions prises depuis le lancement (16/10).
  function bxTaken(per) {
    var D = CF.bx.data;
    if (!D) return { v: null, why: bxWhyShort(), per: null };
    var A = D.asg;
    if (per === '24h') return A.d24.claimed == null ? { v: null, why: BX_NR, per: null } : { v: A.d24.claimed, sub: 'missions BloxAI · 24' + NB + 'h', per: null };
    if (per === '7j' || per === '30j') {
      if (!D.series || !D.series.length) return { v: null, why: 'série 30' + NB + 'j ' + BX_NR, per: null };
      var n = per === '7j' ? 7 : 30, by = Object.create(null), now = new Date(), arr = [];
      D.series.forEach(function (x) { by[x.day] = x.claimed; });
      for (var i = n - 1; i >= 0; i--) {
        var k = parisDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12).getTime());
        arr.push(by[k] == null ? 0 : by[k]);   // jour absent de la série = aucune mission prise ce jour-là
      }
      return { v: arr.reduce(function (a, x) { return a + x; }, 0), sub: 'missions BloxAI · sur ' + n + NB + 'j', per: arr };
    }
    var t = [A.active, A.submitted, A.abandoned, A.expired];
    if (t.some(function (x) { return x == null; })) return { v: null, why: BX_NR, per: null };
    return { v: t.reduce(function (a, x) { return a + x; }, 0), sub: 'missions BloxAI prises depuis le lancement', per: null };
  }
  // Fiche d'une vidéo finale depuis un VF (factory_qc.template = « VF-0001 »)
  var vfMapCache = { ver: -1, m: null };
  function vfQid(vf) {
    if (vfMapCache.ver !== CF.ver || !vfMapCache.m) {
      var m = Object.create(null), PD = CF.prod.data;
      if (PD) PD.qc.list.forEach(function (q) { if (q.template && !m[q.template]) m[q.template] = q.id; });
      vfMapCache = { ver: CF.ver, m: m };
    }
    return vf ? vfMapCache.m[vf] || null : null;
  }
  function bxVfChip(vf) {
    if (!vf) return '<span class="cf-chip is-muted">VF inconnue</span>';
    var q = vfQid(vf);
    return q ? '<button type="button" class="cf-chip is-brick is-btn" data-act="vf-open" data-qid="' + esc(q) + '" title="Fiche de la vidéo">' + esc(vf) + '</button>'
      : '<span class="cf-chip">' + esc(vf) + '</span>';
  }
  function bxNetIc(n) { return n === 'instagram' ? IG_GLYPH : svg(n === 'tiktok' ? IC.tiktok : IC.video, 14); }
  function bxTile(k, v, l, s, cls) {
    return '<div class="cf-stile' + (cls ? ' ' + cls : '') + '" data-s="' + k + '"><b class="' + (v === '—' ? 'is-na' : '') + '">' + esc(v) + '</b><span class="cf-stile-l">' + esc(l) + '</span><span class="cf-stile-s">' + esc(s) + '</span></div>';
  }
  function bxKpi(k, l, v, s) {
    return '<div class="cf-mkpi" data-k="' + k + '"><span class="cf-mkpi-l">' + esc(l) + '</span><b class="' + (v === '—' ? 'is-na' : '') + '">' + esc(v) + '</b><span class="cf-mkpi-s">' + esc(s) + '</span></div>';
  }
  // only (18/10, round 7) : filtre facultatif (l'Accueil n'affiche que les messages des pièces d'identité)
  function bxMsgHTML(only) {
    var m = ui.bx.msg;
    if (!m || Date.now() - m.at >= 10 * 60 * 1000 || (only && !only(m))) return '';
    return '<div class="cf-acct-msg' + (m.ok ? ' is-ok' : ' is-err') + '" role="status">' + esc(m.text)
      + (/Recharge le tableau de bord/.test(m.text || '') ? ' <button type="button" class="cf-link-btn" data-act="page-reload">Recharger la page</button>' : '') + '</div>';
  }
  function bxDis(k) { return ui.bx.busy[k] ? ' disabled' : ''; }
  // en-tête de carte avec le compteur dans le titre (comme « Versements à faire » de l'Accueil) et un contrôle à droite
  // ── Suivi des vues (17/10, revue 2) : « Valider » = CONFORME, côté BloxAI (checked_at) : le lien sort de « À vérifier »
  // mais reste en suivi ; ses gains sont comptés à la fin des tracking_days (30 j) par bx_close_tracking, avec les vues
  // figées ce jour-là (views_at_close).
  // 17/10 (audit, contrat 3) : AUCUNE décision d'argent sans Axel. bx_close_tracking ne refuse JAMAIS tout seul et ne
  // valide QUE les liens conformes dont les vues ont été relues dans les 48 h avant la fin du suivi ; tout autre lien au
  // suivi fini reste « verif » avec metrics.held_since : « En attente de vérification », aucun gain tant qu'Axel n'a pas
  // décidé (Valider → vues figées, ou Refuser). Les signaux du relevé (vidéo introuvable, doublon, publiée avant la mission,
  // même compte, chaîne YouTube non vérifiée) ne sont qu'une INFORMATION ; close_refusal = motif proposé pour un refus.
  function bxTrackDays(D) { return D && D.settings && D.settings.trackingDays != null ? D.settings.trackingDays : 30; }   // défaut = celui de BloxAI
  // fin du suivi : closes_at de BloxAI, sinon date du lien + tracking_days ; inconnue → null
  function bxTrackEnd(x, D) { return !x ? null : x.closes != null ? x.closes : x.created != null ? x.created + bxTrackDays(D) * 864e5 : null; }
  function bxTracking(x, D) { var e = bxTrackEnd(x, D); return e == null || Date.now() < e; }
  // liens « à vérifier » : en suivi et pas encore regardés (total exact de BloxAI ; ancienne version sans « unchecked » : verif)
  function bxToCheckN(D) {
    if (!D) return null;
    return D.pub.unchecked != null ? D.pub.unchecked : D.pub.verif;
  }
  // 17/10 (contrat 3) : liens « En attente de vérification » (total de BloxAI s'il le renvoie, sinon ceux de la liste)
  function bxHeld(x) { return !!(x && x.status === 'verif' && x.flags && x.flags.held); }
  function bxHeldN(D) {
    if (!D) return null;
    if (D.pub.held != null) return D.pub.held;
    return D.toCheck ? D.toCheck.filter(bxHeld).length : null;
  }
  // 17/10 (round 5, contrat 5) : pourquoi BloxAI retient le lien (hold_reason, écrit pour le diffuseur) → phrase pour Axel.
  // Texte inconnu (nouvelle version de BloxAI) : affiché tel quel. Ordre = celui de bx_hold_reason (repère d'abord).
  // 18/10 (round 6, R3) : nouvelle raison 'engagement' de bx_hold_reason (code seul ou phrase française) : très peu de
  // j'aime et de commentaires pour les vues, ou presque toutes les vues en un seul jour. Testée EN PREMIER (sa phrase peut
  // parler de « vues achetées », qui sinon donnerait la hausse depuis le « conforme ») ; 3e élément = clé (cf. bxHoldKey).
  // 18/10 (round 7, R7-3) : raison EXACTE 'views_dropped' de bx_hold_reason (avant 'engagement') : 2 lectures de suite sous
  // 80 % du maximum relevé → phrase du contrat ; testée en premier (« vues achetées » sinon pris par d'autres motifs).
  // R7-1 : 'engagement' couvre aussi « plus de 10 fois les abonnés du compte en vues dès le 1er jour » (20 000 vues et plus)
  var BX_HOLD_DROP = 'Vues retirées par le réseau : la vidéo a perdu plus de 20' + NB + '% de ses vues — vues achetées probables';
  var BX_HOLD = [
    [/views.?dropped|vues retirees|perdu plus de 20/, BX_HOLD_DROP, 'drop'],
    [/engagement|j.aime|likes|commentaire|un seul jour|en un jour|abonnes/, 'Engagement anormal : très peu de j’aime et de commentaires pour ces vues, presque toutes les vues en un seul jour, ou plus de 10 fois les abonnés du compte en vues dès le 1er jour — vues achetées possibles', 'eng'],
    [/supprim|archiv|privee/, 'vidéo supprimée, archivée ou rendue privée pendant le suivi'],
    [/doublon/, 'doublon d’un autre lien (même vidéo)'],
    [/avant la mission/, 'vidéo publiée avant la prise de la mission'],
    [/meme chaine|chaine youtube a deja|par chaine/, 'autre lien de la mission sur la même chaîne YouTube : un seul lien payé par chaîne'],
    [/un seul lien|meme compte|deja un lien/, 'autre lien de la mission sur le même compte : un seul lien payé par compte'],
    [/youtube|chaine/, 'chaîne YouTube pas vérifiée par le diffuseur : rien ne prouve que la vidéo est la sienne'],
    [/relue|relu |48 ?h/, 'vues pas relues sur le compte du diffuseur dans les 48' + NB + 'h avant la fin (compte déconnecté, accès retiré ou vidéo hors de portée du relevé)'],
    [/achet|hausse|multipli|suspect|gonfl|explos|x ?5|×/, 'vues en très forte hausse depuis ton « conforme » (vues achetées ?)'],
    [/pas encore verifiee|pas encore marquee/, 'pas encore marquée conforme par toi']
  ];
  function bxHoldText(r) {
    var s = String(r || ''), n = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (var i = 0; i < BX_HOLD.length; i++) if (BX_HOLD[i][0].test(n)) return BX_HOLD[i][1];
    return s;
  }
  // 18/10 (round 6, R3) : clé du motif ('eng' = engagement anormal), null sinon. Un motif d'engagement est montré même
  // pendant le suivi (les autres motifs n'y disent rien d'utile : la relecture des 48 h n'a pas encore eu lieu)
  // 18/10 (round 7, R7-3) : 'drop' (vues retirées par le réseau) aussi, pendant le suivi comme après
  function bxHoldLive(r) { var k = bxHoldKey(r); return k === 'eng' || k === 'drop'; }
  function bxHoldKey(r) {
    if (!r) return null;
    var n = String(r).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (var i = 0; i < BX_HOLD.length; i++) if (BX_HOLD[i][0].test(n)) return BX_HOLD[i][2] || null;
    return null;
  }
  // 18/10 (round 6, R3) : engagement relevé sur la vidéo — j'aime, commentaires, partages (part des vues), plus forte hausse
  // de vues sur un seul jour (part des vues). '' = rien de renvoyé par BloxAI. Aucun verdict ici : c'est bx_hold_reason
  // (raison 'engagement') qui retient le lien ; ces chiffres servent à Axel pour décider.
  function bxPct(v) { var p = v * 100; return fDec(p, p < 1 ? 2 : p < 10 ? 1 : 0) + NB + '%'; }
  function bxEngText(x) {
    var vv = x.viewsAtClose != null ? x.viewsAtClose : x.views, parts = [];
    if (x.likes != null) parts.push(fInt(x.likes) + ' j’aime');
    if (x.comments != null) parts.push(fInt(x.comments) + ' ' + plural(x.comments, 'commentaire'));
    if (x.shares != null) parts.push(fInt(x.shares) + ' ' + plural(x.shares, 'partage'));
    var s = parts.join(' · ');
    if (x.likes != null && x.comments != null && vv) s += ' (' + bxPct((x.likes + x.comments) / vv) + ' de j’aime + commentaires pour ' + fInt(vv) + ' ' + plural(vv, 'vue') + ')';
    if (x.maxDayGain != null) s += (s ? ' · ' : '') + 'plus forte hausse sur un jour : ' + fInt(x.maxDayGain) + ' ' + plural(x.maxDayGain, 'vue')
      + (vv ? ' (' + bxPct(Math.min(x.maxDayGain, vv) / vv) + ' des vues)' : '');
    // 18/10 (round 7, R7-2) : j'aime, commentaires, partages figés à la fin du suivi (engagement_at_close)
    if (x.engFrozen && parts.length) s += ' · j’aime, commentaires et partages figés à la fin du suivi';
    return s;
  }
  // 18/10 (round 7, R7-1) : vues du 1er relevé quotidien et abonnés du compte connecté de ce lien ('' = rien de renvoyé) ;
  // plus de 10 fois les abonnés dès le 1er jour = vues achetées possibles (bx_engagement_odd, à partir de 20 000 vues)
  function bxAudOdd(x) { return x.firstDayViews != null && x.followers != null && x.followers > 0 && x.firstDayViews > 10 * x.followers; }
  function bxAudText(x) {
    var parts = [];
    if (x.firstDayViews != null) parts.push('vues du 1er jour : ' + fInt(x.firstDayViews));
    if (x.followers != null) parts.push('compte de ' + fInt(x.followers) + ' ' + plural(x.followers, 'abonné'));
    else if (x.firstDayViews != null) parts.push('abonnés du compte inconnus');
    var s = parts.join(' · ');
    if (x.firstDayViews != null && x.followers) {
      var r = x.firstDayViews / x.followers;
      s += ' (' + fDec(r, r < 10 ? 1 : 0) + ' fois ses abonnés dès le 1er jour' + (bxAudOdd(x) ? ' : plus de 10 fois, vues achetées possibles' : '') + ')';
    }
    return s;
  }
  // 18/10 (round 7, R7-3) : vues retirées par le réseau (views = maximum relevé, last_views = dernière lecture réelle)
  function bxDropText(x) {
    var v = x.views, l = x.lastViews;
    return 'la vidéo a perdu plus de 20' + NB + '% de ses vues sur 2 lectures de suite' + (v != null && l != null ? ' (maximum relevé ' + fInt(v) + ', dernière lecture ' + fInt(l)
      + (v > 0 && l < v ? ', ' + MINUS + bxPct((v - l) / v) : '') + ')' : '');
  }
  // 17/10 (round 5, contrat 6) : vues au « conforme » d'Axel (checked_views) → vues figées à la fin du suivi (ou actuelles
  // pendant le suivi) ; même seuil que bx_hold_reason : plus de 5 fois ET plus de 100 000 vues de plus = hausse suspecte
  function bxJump(x) {
    var c = x.checkedViews, v = x.viewsAtClose != null ? x.viewsAtClose : x.views;
    return x.checked != null && c != null && v != null && v > Math.max(c * 5, c + 100000);
  }
  // Signaux du relevé des vues (reseaux de BloxAI) en puces lisibles : [texte, classe, détail], dans l'ordre de BloxAI
  // (le premier donne le motif proposé pour un refus). 16/10 : même ordre partout (BloxAI, app des diffuseurs, ce tableau
  // de bord) : missing_since > dup_of > too_old > same_account > yt_unverified. 17/10 : information, jamais un refus automatique.
  function bxFlagChips(x) {
    var F = x.flags || {}, out = [];
    if (F.missing) out.push(['Vidéo introuvable', 'is-ko', (F.missingSince != null ? 'introuvable depuis le ' + dmy(new Date(F.missingSince)) : 'introuvable au dernier relevé') + ' (supprimée, archivée ou privée)']);
    if (F.dup) out.push(['Doublon', 'is-ko', F.dupOf ? 'même vidéo que le lien n° ' + F.dupOf + ', qui seul compte' : 'même vidéo qu’un autre lien, qui seul compte']);
    if (F.tooOld) out.push(['Publiée avant la mission', 'is-ko', (F.publishedAt != null ? 'publiée le ' + dmy(new Date(F.publishedAt)) + ' à ' + hm(new Date(F.publishedAt)) : 'publiée') + ', avant la prise de la mission']);
    // 16/10 : same_account = la base a refusé de rattacher ce lien au compte où reseaux a trouvé sa vidéo (un lien par
    // compte et par mission) : 2e vidéo de la même mission sur ce compte, seul l'autre lien compte
    if (F.sameAccount) out.push(['Même compte', 'is-ko', '2e vidéo de la mission sur ce compte : ' + (F.sameAccountOf ? 'seul le lien n° ' + F.sameAccountOf + ' compte' : 'seul l’autre lien compte')]);
    if (F.ytUnverified) out.push(['Chaîne YouTube non vérifiée', 'is-warn', 'vidéo sur une chaîne que le diffuseur n’a pas déclarée' + (F.ytChannel ? ' (' + F.ytChannel + ')' : '')]);
    if (x.viewsDropped) out.push(['Vues retirées', 'is-ko', bxDropText(x)]);   // 18/10 (round 7, R7-3)
    return out;
  }
  function bxFlagged(x) { return bxFlagChips(x).length > 0; }
  // 17/10 (contrat 3) : motif PROPOSÉ pour un refus d'Axel (pré-rempli dans « Refuser ») : celui de BloxAI (close_refusal)
  // s'il le renvoie, sinon le 1er signal ; jamais appliqué tout seul
  function bxMotif(x) {
    if (!x || x.status !== 'verif') return null;
    if (x.closeRefusal) return x.closeRefusal;
    var fl = bxFlagChips(x);
    return fl.length ? fl[0][0] + ' : ' + fl[0][2] : null;
  }
  function bxHead(t, sub, n, right) {
    return '<div class="cf-card-h"><div><h3 class="cf-h2">' + esc(t) + (n === undefined ? '' : ' <span class="cf-badge">' + esc(n == null ? '—' : String(n)) + '</span>') + '</h3>'
      + (sub ? '<span class="cf-meta">' + esc(sub) + '</span>' : '') + '</div>' + (right || '') + '</div>';
  }

  function bxHTML() {
    var B = bxModel(), D = B.D, S = B.S;
    var sub = D ? 'Stock commun · missions · diffuseurs · versements · relevé BloxAI ' + ago(D.generatedAt || D.fetchedAt) : longDate(new Date());
    var head = '<section class="cf-title cf-bx-title"><div><h1>BloxAI</h1><div class="cf-sub">' + esc(sub) + '</div></div>'
      + '<button type="button" class="cf-btn is-sm" data-act="bx-refresh"' + (S.loading ? ' disabled' : '') + '>' + svg(IC.refresh, 13) + (S.loading ? 'Lecture…' : 'Actualiser') + '</button></section>';
    var top = '';
    if (S.state === 'error' && D) top += banner('err', IC.alert, '<b>BloxAI : lecture impossible</b> · ' + esc(S.error) + ' · chiffres de ' + esc(hm(new Date(D.fetchedAt))) + ' conservés');
    else if (S.loading && D) top += spin('Actualisation de BloxAI…');
    if (D) { var miss = bxMissing(D); if (miss.length) top += banner('warn', IC.alert, '<b>Données absentes : ' + esc(miss.join(', ')) + '</b> · ' + esc(BX_NR + ' : les cartes concernées affichent « — ».')); }
    top += bxMsgHTML();
    if (!D) {
      return '<div class="cf-prod cf-bx">' + head + top + (B.pending ? spin('Chargement de BloxAI…')
        : '<section class="cf-card">' + emptyLine('—', B.why) + '<button type="button" class="cf-btn is-sm cf-bx-go" data-act="bx-refresh">' + svg(IC.refresh, 13) + 'Réessayer</button></section>') + '</div>';
    }
    return '<div class="cf-prod cf-bx">' + head + top
      + phead('01', 'Stock commun', 'une vidéo validée part sur un seul compte : kit d’Axel ou diffuseur') + bxStockHTML(D)
      + phead('02', 'Missions', '24' + NB + 'h pour publier et coller les liens') + bxCycleHTML(D) + bxSeriesHTML(D)
      + phead('03', 'À vérifier', 'liens collés par les diffuseurs') + bxCheckHTML(D)
      + phead('04', 'Diffuseurs', 'inscriptions · classement') + bxUsersHTML(D) + bxRankHTML(D)
      + phead('05', 'Paiements', 'pièces d’identité · versements') + '<div class="cf-prow2 is-b">' + bxIdHTML(D) + bxPayHTML(D) + '</div>'
      + '</div>';
  }

  // ── 01 · stock commun (missions BloxAI) et kit (factory_posts « à faire ») ──
  function bxStockHTML(D) {
    var K = D.stock, St = D.settings, PS = CF.prod, PD = PS.data, kitT = PD ? PD.qc.kitTodo : null;
    var kitV = PD ? (kitT == null ? '—' : fInt(kitT)) : (PS.loading || PS.state === 'idle' ? '…' : '—');
    var kitF = PD ? PD.qc.kitFar : null;
    var kitS = PD ? (kitT == null ? 'kit illisible (factory_posts)' : 'posts « à faire » des comptes Instagram' + (kitF ? ' · dont ' + fInt(kitF) + ' au-delà de J+7' : ''))
      : PS.state === 'error' ? 'production illisible : ' + PS.error : 'chargement de la production';
    var tiles = '<div class="cf-stiles">'
      + bxTile('open', bxN(K.open), 'Stock commun', K.open == null ? BX_NR : 'vidéos validées en attente' + (St.kitBuffer == null ? '' : ' · dont ' + fInt(Math.min(K.open, St.kitBuffer)) + ' en réserve pour le kit'), 'is-acc')
      + bxTile('avail', bxN(K.available), 'Ouvertes aux diffuseurs', K.available == null ? BX_NR : 'au-delà de la réserve du kit (' + bxN(St.kitBuffer) + ')', K.available === 0 ? 'is-err' : '')
      + bxTile('kit', kitV, 'Kit à programmer', kitS, '')
      + bxTile('assigned', bxN(K.assigned), 'En mission', K.assigned == null ? BX_NR : 'prises · 24' + NB + 'h pour publier', '')
      + bxTile('done', bxN(K.done), 'Publiées par les diffuseurs', K.done == null ? BX_NR : 'missions terminées (liens envoyés)', '')
      + bxTile('kitTotal', bxN(K.kit), 'Passées au kit', K.kit == null ? BX_NR : 'retirées du stock pour les comptes d’Axel (total)', '')
      + bxTile('retired', bxN(K.retired), 'Retirées', K.retired == null ? BX_NR : 'sorties du stock à la main', '')
      + '</div>';
    var rules = [St.kitBuffer != null ? 'réserve du kit ' + fInt(St.kitBuffer) + ' ' + plural(St.kitBuffer, 'vidéo') : null,
      St.deadlineH != null ? 'délai ' + fDec(St.deadlineH, 0) + NB + 'h' : null,
      St.cooldownMin != null ? fDec(St.cooldownMin, 0) + NB + 'min entre deux missions' : null,
      St.pauseFailures != null && St.pauseWindowDays != null && St.pauseHours != null ? 'pause de ' + fDec(St.pauseHours, 0) + NB + 'h après ' + St.pauseFailures + ' échecs en ' + St.pauseWindowDays + NB + 'j' : null,
      St.trackingDays != null ? 'vues suivies ' + St.trackingDays + NB + 'j' : null,
      St.rateCentsPer1000 != null ? fEur(St.rateCentsPer1000) + ' / 1' + NB + '000 vues validées' : null,
      St.payoutMinCents != null ? 'versement dès ' + fEur(St.payoutMinCents) : null].filter(Boolean);
    return '<section class="cf-card" data-block="bx-stock">' + chead('Stock commun et kit', 'comptes d’Axel servis en premier : le kit garde 7 jours d’avance, le reste est ouvert aux diffuseurs') + tiles
      + '<div class="cf-meta">' + esc('Réglages BloxAI : ' + (rules.length ? rules.join(' · ') : '—')) + '</div></section>';
  }

  // ── 02 · cycle des missions + publications des diffuseurs ──
  function bxCycleHTML(D) {
    var A = D.asg, P = D.pub, d24 = A.d24;
    var fin = A.submitted != null && A.expired != null && A.abandoned != null ? A.submitted + A.expired + A.abandoned : null;
    var flow = '<ol class="cf-bx-flow">' + [['01', 'Prise', 'par un diffuseur'], ['02', 'En cours', '24' + NB + 'h pour publier et coller les liens'],
      ['03', 'En suivi', 'liens collés · vues suivies ' + bxTrackDays(D) + NB + 'j · refus possible'], ['04', 'Validée ou refusée', 'par toi seulement : conforme et vues relues dans les 48' + NB + 'h avant la fin → validée avec ses vues ; sinon en attente de vérification']].map(function (x) {
      return '<li><span class="cf-pnum">' + x[0] + '</span><b>' + esc(x[1]) + '</b><span>' + esc(x[2]) + '</span></li>';
    }).join('') + '</ol><div class="cf-meta">Échouée (24' + NB + 'h dépassées) ou abandonnée : la vidéo revient tout de suite dans le stock, jamais re-proposée au même diffuseur.</div>';
    var k = '<div class="cf-mkpis">'
      + bxKpi('active', 'En cours', bxN(A.active), A.active == null ? BX_NR : (A.downloadedActive == null ? '' : 'dont ' + fInt(A.downloadedActive) + ' ' + plural(A.downloadedActive, 'téléchargée') + ' · ') + '24' + NB + 'h pour publier')
      + bxKpi('submitted', 'Envoyées', bxN(A.submitted), A.submitted == null ? BX_NR : 'liens collés à temps')
      + bxKpi('verif', 'En suivi', bxN(P.verif), P.verif == null ? BX_NR : 'publications · ' + bxN(bxToCheckN(D)) + ' à vérifier')
      + bxKpi('valid', 'Validées', bxN(P.valid), P.valid == null ? BX_NR : 'publications · vues comptées')
      + bxKpi('refus', 'Refusées', bxN(P.refus), P.refus == null ? BX_NR : 'publications refusées (motif)')
      + bxKpi('expired', 'Échouées', bxN(A.expired), A.expired == null ? BX_NR : 'délai de 24' + NB + 'h dépassé')
      + bxKpi('abandoned', 'Abandonnées', bxN(A.abandoned), A.abandoned == null ? BX_NR : 'rendues par le diffuseur')
      + bxKpi('rate', 'Réussite', fin ? fPct(A.submitted, fin) : '—', fin == null ? BX_NR : fin ? 'envoyées ÷ missions terminées' : 'aucune mission terminée')
      + '</div>';
    var d = [[d24.claimed, 'prise', 'prises'], [d24.submitted, 'envoyée', 'envoyées'], [d24.expired, 'échouée', 'échouées'], [d24.abandoned, 'abandonnée', 'abandonnées']];
    var last = 'Dernières 24' + NB + 'h : ' + d.map(function (x) { return x[0] == null ? '— ' + x[2] : fInt(x[0]) + ' ' + plural(x[0], x[1], x[2]); }).join(' · ');
    var eng = '<div class="cf-mkpis">' + [['views', 'Vues', P.views], ['validViews', 'Vues validées', P.validViews], ['likes', 'Likes', P.likes], ['comments', 'Commentaires', P.comments],
      ['shares', 'Partages', P.shares], ['saves', 'Enregistrements', P.saves]].map(function (x) {
      return bxKpi(x[0], x[1], bxN(x[2]), x[2] == null ? BX_NR : x[0] === 'validViews' ? 'comptées dans les gains' : 'toutes publications');
    }).join('') + '</div>';
    return '<section class="cf-card" data-block="bx-cycle">' + chead('Cycle des missions', 'mission = 24' + NB + 'h pour publier ET coller les liens') + flow + k
      + '<div class="cf-meta">' + esc(last) + '</div></section>'
      + '<section class="cf-card" data-block="bx-pubs">' + chead('Publications des diffuseurs', 'vues relues sur Instagram, TikTok et YouTube') + eng + '</section>';
  }

  // ── 02 · séries 30 j : missions par jour (lignes) et vues par jour (barres), une échelle chacune ──
  function bxXLabels(days, n) {
    return '<div class="cf-mx">' + [0, Math.round((n - 1) / 2), n - 1].filter(function (k, j, a) { return a.indexOf(k) === j; })
      .map(function (k) { return '<span>' + esc(dm(ymdDate(days[k]))) + '</span>'; }).join('') + '</div>';
  }
  function bxBars(key, title, days, vals, unit) {
    var n = days.length, known = vals.filter(function (v) { return v != null; });
    var tot = known.reduce(function (a, v) { return a + v; }, 0), mx = Math.max(1, Math.max.apply(null, known.concat([0])));
    bxCharts[key] = { n: n, days: days, bars: true, rows: [{ l: unit[1], c: 'var(--cf-accent)', v: vals }] };
    return '<div class="cf-mchart"><div class="cf-mchart-h"><span class="cf-mchart-t">' + esc(title) + '</span><span class="cf-meta">' + esc(known.length ? fInt(tot) + ' ' + plural(tot, unit[0], unit[1]) + ' sur ' + n + NB + 'j' : BX_NR) + '</span></div>'
      + '<div class="cf-mplot cf-bxplot is-bars" data-bx="' + key + '" role="img" aria-label="' + esc(title + ' : ' + fInt(tot) + ' ' + plural(tot, unit[0], unit[1]) + ' sur ' + n + ' jours, maximum ' + fInt(mx) + ' par jour') + '">'
      + '<span class="cf-bx-ymax" aria-hidden="true">' + esc(fInt(mx)) + '</span>'
      + '<div class="cf-bx-bars" aria-hidden="true">' + vals.map(function (v) {
        return '<i' + (v == null ? ' class="is-na"' : '') + ' style="height:' + (v ? Math.max(2, v / mx * 100) : 0).toFixed(1) + '%"></i>';
      }).join('') + '</div><div class="cf-bxhover" hidden></div></div>' + bxXLabels(days, n) + '</div>';
  }
  function bxSeriesHTML(D) {
    var ser = D.series, head = chead('Sur 30 jours', 'jours de Paris · survole une courbe pour le détail du jour');
    if (!ser) return '<section class="cf-card" data-block="bx-series">' + head + emptyLine('—', 'série 30' + NB + 'j ' + BX_NR) + '</section>';
    if (!ser.length) return '<section class="cf-card" data-block="bx-series">' + head + '<div class="cf-empty-s">Aucun jour dans la série.</div></section>';
    var n = ser.length, days = ser.map(function (x) { return x.day; });
    var z = function (v) { return v == null ? 0 : v; };
    var vals = { claimed: ser.map(function (x) { return z(x.claimed); }), submitted: ser.map(function (x) { return z(x.submitted); }),
      lost: ser.map(function (x) { return z(x.expired) + z(x.abandoned); }) };
    var tot = function (k) { return vals[k].reduce(function (a, x) { return a + x; }, 0); };
    var top = Math.max(1, Math.max.apply(null, vals.claimed.concat(vals.submitted, vals.lost))), mx = top * 1.15;
    var X = function (i) { return n > 1 ? i / (n - 1) * 1000 : 500; }, Y = function (v) { return 150 - v / mx * 150; };
    var paths = BX_SER.map(function (s2) {
      return '<path d="' + vals[s2.k].map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ')
        + '" fill="none" stroke="' + s2.c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>';
    }).join('');
    bxCharts.miss = { n: n, days: days, bars: false, rows: [
      { l: 'prises', c: BX_SER[0].c, v: vals.claimed }, { l: 'envoyées', c: BX_SER[2].c, v: vals.submitted },
      { l: 'échouées ou abandonnées', c: BX_SER[1].c, v: vals.lost },
      { l: '· échouées', sub: true, v: ser.map(function (x) { return x.expired; }) }, { l: '· abandonnées', sub: true, v: ser.map(function (x) { return x.abandoned; }) }] };
    var legend = '<div class="cf-bx-leg">' + BX_SER.map(function (s2) {
      return '<span><i style="background:' + s2.c + '"></i>' + esc(s2.l) + ' <b>' + esc(fInt(tot(s2.k))) + '</b></span>';
    }).join('') + '</div>';
    var miss = '<div class="cf-mchart"><div class="cf-mchart-h"><span class="cf-mchart-t">Missions par jour</span></div>' + legend
      + '<div class="cf-mplot cf-bxplot" data-bx="miss" role="img" aria-label="' + esc('Missions par jour sur ' + n + ' jours : ' + fInt(tot('claimed')) + ' prises, ' + fInt(tot('submitted')) + ' envoyées, ' + fInt(tot('lost')) + ' échouées ou abandonnées') + '">'
      + '<span class="cf-bx-ymax" aria-hidden="true">' + esc(fInt(top)) + '</span><div class="cf-mgrid" aria-hidden="true"><i></i><i></i><i></i></div>'
      + '<svg viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + paths + '</svg><div class="cf-bxhover" hidden></div></div>'
      + bxXLabels(days, n) + '</div>';
    return '<section class="cf-card" data-block="bx-series">' + head + '<div class="cf-bx-charts">' + miss
      + bxBars('views', 'Vues par jour', days, ser.map(function (x) { return x.views; }), ['vue', 'vues']) + '</div></section>';
  }
  // bulle d'une courbe BloxAI : le jour survolé (souris ou doigt), sans redessiner le panneau
  function bxHover(plot, clientX) {
    var ch = bxCharts[plot.getAttribute('data-bx')];
    if (!ch || !ch.n) return;
    var rc = plot.getBoundingClientRect();
    if (!rc.width) return;
    var f = Math.max(0, Math.min(1, (clientX - rc.left) / rc.width));
    var i = ch.bars ? Math.min(ch.n - 1, Math.floor(f * ch.n)) : Math.round(f * (ch.n - 1));
    var box = plot.querySelector('.cf-bxhover');
    if (!box || (box._i === i && !box.hidden)) return;
    box._i = i;
    var x = ch.bars ? (i + 0.5) / ch.n * 100 : ch.n > 1 ? i / (ch.n - 1) * 100 : 50;
    box.innerHTML = '<span class="cf-mvl" style="left:' + x.toFixed(2) + '%"></span><div class="cf-mtip" style="left:' + x.toFixed(2) + '%;transform:translateX(' + (i > ch.n / 2 ? 'calc(-100% - 12px)' : '12px') + ')">'
      + '<span class="cf-mtip-d">' + esc(dmy(ymdDate(ch.days[i]))) + '</span>'
      + ch.rows.map(function (r) {
        var v = r.v[i];
        return '<span class="cf-mtip-r' + (r.sub ? ' is-gap' : '') + '"><span>' + (r.c ? '<i style="background:' + r.c + '"></i>' : '') + esc(r.l) + '</span><b>' + esc(v == null ? '—' : fInt(v)) + '</b></span>';
      }).join('') + '</div>';
    box.hidden = false;
    bxHot = true;
  }
  function bxHide() {
    bxHot = false;
    [].forEach.call(document.querySelectorAll('.cf-bxhover'), function (b) { b.hidden = true; b._i = null; });
  }

  // ── 03 · à vérifier : liens en attente de vérification, puis en suivi pas encore regardés (du plus ancien au plus récent),
  //    puis les derniers refus ──
  function bxCheckRow(x, D) {
    var net = BX_NET[x.network], u = safeUrl(x.url || '', net[1]), k = 'pub:' + x.id, dis = bxDis(k);
    var t = x.created != null ? new Date(x.created) : null, end = bxTrackEnd(x, D), live = bxTracking(x, D);
    var verif = x.status === 'verif', checked = verif && x.checked != null, held = bxHeld(x), fl = verif ? bxFlagChips(x) : [], F = x.flags || {}, mot = bxMotif(x);
    var st = !verif ? BX_PST[x.status] || ['statut inconnu', '']
      : held ? ['En attente de vérification', 'is-pend'] : checked ? (live ? ['conforme · en suivi', 'is-ok'] : ['conforme · suivi terminé', 'is-ok'])
        : live ? ['à vérifier · en suivi', 'is-pend'] : ['à vérifier · suivi terminé', 'is-pend'];
    var dEnd = end != null ? dmy(new Date(end)) : '';
    // 17/10 (round 5) : après la fin du suivi, « Valider avec les vues figées » (validate_frozen : aucun chiffre envoyé) ;
    // caché seulement pour un lien conforme que BloxAI validera au prochain passage (aucun motif de retenue)
    var frozenOk = verif && !live && end != null && (held || !checked || !!x.holdReason);
    var jump = verif && bxJump(x);
    var info = [x.name || 'diffuseur', t ? 'collé le ' + dmy(t) + ' à ' + hm(t) : 'date inconnue',
      x.views == null ? '— vue' : fInt(x.views) + ' ' + plural(x.views, 'vue'), x.status === 'valid' && x.validViews != null ? fInt(x.validViews) + ' ' + plural(x.validViews, 'validée') : '',
      // 18/10 (round 7, R7-3) : dernière lecture réelle quand elle est sous le maximum relevé (vues retirées ?)
      verif && x.lastViews != null && x.views != null && x.lastViews < x.views ? 'dernière lecture : ' + fInt(x.lastViews) + ' ' + plural(x.lastViews, 'vue') : '',
      verif && x.checkedViews != null ? fInt(x.checkedViews) + ' ' + plural(x.checkedViews, 'vue') + ' au « conforme »' : '',
      verif && !live && x.viewsAtClose != null ? fInt(x.viewsAtClose) + ' ' + plural(x.viewsAtClose, 'vue figée', 'vues figées') + ' à la fin du suivi' : '',
      fl.length && F.seenViews != null ? fInt(F.seenViews) + ' ' + plural(F.seenViews, 'vue relevée', 'vues relevées') + ' sur la vidéo' : '',
      verif && x.lastRead != null ? 'vues relues le ' + dmy(new Date(x.lastRead)) + ' à ' + hm(new Date(x.lastRead)) : '',
      // 17/10 (round 5, contrat 3) : dernière lecture faite au plus tard à la fin du suivi (celle qui compte pour les 48 h)
      verif && !live && x.readAtClose != null && x.readAtClose !== x.lastRead ? 'dernière lecture avant la fin du suivi le ' + dmy(new Date(x.readAtClose)) + ' à ' + hm(new Date(x.readAtClose)) : '',
      !verif ? '' : held ? 'en attente de vérification' + (F.heldSince != null ? ' depuis le ' + dmy(new Date(F.heldSince)) : '') + ' : aucun gain tant que tu n’as pas décidé'
        : end == null ? 'date du lien inconnue : vues encore suivies'
        : live ? (checked ? 'gains comptés à la fin du suivi le ' + dEnd + ' si ses vues sont relues dans les 48' + NB + 'h avant' : 'fin du suivi le ' + dEnd + ' : sans « Valider », en attente de vérification')
        : checked ? 'suivi terminé le ' + dEnd + ' : validée au prochain passage avec ses vues figées si elles ont été relues dans les 48' + NB + 'h avant, sinon en attente de vérification'
        : 'suivi terminé le ' + dEnd + ' : en attente de ta décision'].filter(Boolean).join(' · ');
    // signal du relevé : à vérifier par Axel, jamais un refus automatique (motif proposé, pré-rempli dans « Refuser »)
    var cons = verif && fl.length ? 'signal à vérifier : rien n’est refusé automatiquement, à toi de décider' + (mot ? ' · motif proposé : « ' + mot + ' »' : '') : '';
    // 18/10 (round 6, R3) : engagement (j'aime, commentaires, partages, plus forte hausse sur un jour) ; motif de retenue
    // « engagement anormal » montré aussi pendant le suivi (les autres motifs : seulement après la fin)
    var eng = verif ? bxEngText(x) : '', showHold = verif && x.holdReason && (!live || bxHoldLive(x.holdReason)), aud = verif ? bxAudText(x) : '';
    var acts = u ? '<a class="cf-btn is-sm" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + svg(IC.external, 12) + 'Ouvrir</a>' : '<span class="cf-meta">lien illisible</span>';
    if (verif) {
      acts += '<button type="button" class="cf-btn is-sm is-ko" data-act="bx-pub-ko" data-id="' + esc(x.id) + '"' + dis + '>Refuser</button>'
        + (frozenOk ? '<button type="button" class="cf-btn is-sm is-okb" data-act="bx-pub-frozen" data-id="' + esc(x.id) + '"' + dis
          + ' title="Suivi terminé : ses vues figées à la fin du suivi (chiffre de BloxAI) comptent tout de suite dans les gains">' + svg(IC.check, 12) + (ui.bx.busy[k] ? 'Enregistrement…' : 'Valider avec les vues figées') + '</button>'
        : !live || (checked && !held) ? '' : '<button type="button" class="cf-btn is-sm is-okb" data-act="bx-pub-ok" data-id="' + esc(x.id) + '"' + dis
          + ' title="Conforme : la vidéo sort de « À vérifier » ; ses gains seront comptés à la fin du suivi">' + svg(IC.check, 12) + (ui.bx.busy[k] ? 'Enregistrement…' : 'Valider') + '</button>');
    } else if (x.status === 'refus') {
      acts += '<button type="button" class="cf-btn is-sm" data-act="bx-pub-reset" data-id="' + esc(x.id) + '"' + dis + '>' + (ui.bx.busy[k] ? 'Enregistrement…' : 'Remettre à vérifier') + '</button>';
    }
    // chaîne YouTube non déclarée : lien direct pour la regarder (identifiant déjà filtré dans cf-store.js)
    var ch = fl.length && F.ytUnverified && F.ytChannel ? safeUrl('https://www.youtube.com/channel/' + F.ytChannel, BX_NET.youtube[1]) : '';
    return '<div class="cf-bx-row" data-pub="' + esc(x.id) + '"' + (fl.length ? ' data-flagged="1"' : '') + (held ? ' data-held="1"' : '') + '><span class="cf-bx-ic" aria-hidden="true">' + bxNetIc(x.network) + '</span>'
      + '<span class="cf-bx-main"><span class="cf-bx-l1">' + bxVfChip(x.vf) + '<b>' + esc(net[0]) + '</b><span class="cf-qchip ' + st[1] + '">' + esc(st[0]) + '</span>'
      + fl.map(function (f) { return '<span class="cf-qchip is-flag ' + f[1] + '" title="' + esc(f[2]) + '">' + svg(IC.alert, 11) + esc(f[0]) + '</span>'; }).join('') + '</span>'
      + '<span class="cf-meta">' + esc(info) + '</span>'
      + (eng ? '<span class="cf-meta" data-eng="1">' + esc('engagement : ' + eng) + '</span>' : '')
      // 18/10 (round 7, R7-1) : vues du 1er jour et abonnés du compte (orange au-delà de 10 fois les abonnés)
      + (aud ? '<span class="' + (bxAudOdd(x) ? 'cf-bx-why is-warn' : 'cf-meta') + '" data-aud="1">' + esc('audience : ' + aud) + '</span>' : '')
      + (fl.length ? '<span class="cf-bx-why is-warn">' + esc(fl.map(function (f) { return f[0] + ' : ' + f[2]; }).join(' · '))
        + (ch ? ' · <a class="cf-link" href="' + esc(ch) + '" target="_blank" rel="noopener noreferrer">voir la chaîne' + svg(IC.external, 11) + '</a>' : '') + '</span>' : '')
      // 17/10 (round 5) : motif de retenue de BloxAI après la fin du suivi (pendant le suivi, il ne dit rien d'utile : la
      // relecture des 48 h n'a pas encore eu lieu) ; hausse anormale des vues depuis le « conforme »
      + (showHold ? '<span class="cf-bx-why is-warn" data-hold="1"' + (bxHoldKey(x.holdReason) === 'eng' ? ' data-hold-eng="1"' : bxHoldKey(x.holdReason) === 'drop' ? ' data-hold-drop="1"' : '') + ' title="' + esc('BloxAI : ' + x.holdReason) + '">' + esc('retenue par BloxAI : ' + bxHoldText(x.holdReason)) + '</span>' : '')
      + (jump ? '<span class="cf-bx-why is-warn" data-jump="1">' + esc('vues au « conforme » : ' + fInt(x.checkedViews) + ' → ' + fInt(x.viewsAtClose != null ? x.viewsAtClose : x.views)
        + (x.viewsAtClose != null ? ' figées à la fin du suivi' : ' aujourd’hui') + ' : hausse de plus de 5 fois et de plus de 100' + NB + '000 vues, vues achetées ? Vérifie les statistiques natives avant de valider') + '</span>' : '')
      + (cons ? '<span class="cf-bx-why">' + esc('→ ' + cons) + '</span>' : '')
      + (x.status === 'refus' ? '<span class="cf-bx-why">' + esc(x.reason ? 'motif : « ' + x.reason + ' »' : 'motif : aucun') + '</span>' : '') + '</span>'
      + '<span class="cf-bx-acts">' + acts + '</span></div>';
  }
  function bxCheckHTML(D) {
    var L = D.toCheck, nV = L ? bxToCheckN(D) : null, td = bxTrackDays(D), nH = bxHeldN(D);
    var sub = 'ouvre le lien, vérifie la vidéo et la mention Publicité : Valider (conforme : la vidéo sort de la liste, ses gains seront comptés à la fin des '
      + td + NB + 'jours de suivi) ou Refuser (motif visible par le diffuseur). Rien n’est validé ni refusé sans toi : sans « Valider », ou sans vues relues dans les 48' + NB + 'h avant la fin, le lien passe « En attente de vérification »'
      + ' ; suivi fini : « Valider avec les vues figées » (chiffre de BloxAI, rien de tapé) ou Refuser';
    if (!L) return '<section class="cf-card" data-block="bx-check">' + bxHead('À vérifier', sub, nV) + emptyLine('—', 'liste ' + BX_NR) + '</section>';
    // ordre : en attente de vérification d'abord (gains bloqués), puis l'ordre de BloxAI — à vérifier du plus ancien au plus
    // récent, (déjà conformes, s'il y en a), puis les derniers refus
    var rank = function (x) { return x.status !== 'verif' ? 3 : bxHeld(x) ? 0 : x.checked != null ? 2 : 1; };
    var sorted = L.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) { return rank(a.x) - rank(b.x) || a.i - b.i; }).map(function (o) { return o.x; });
    var nList = sorted.filter(function (x) { return rank(x) === 1; }).length, nFlag = sorted.filter(function (x) { return rank(x) <= 1 && bxFlagged(x); }).length;
    if (nH) sub += ' · ' + nH + ' en attente de vérification (aucun gain sans ta décision)';
    if (nFlag) sub += ' · ' + nFlag + ' ' + plural(nFlag, 'lien signalé', 'liens signalés') + ' par le relevé des vues (à vérifier : jamais de refus automatique)';
    if (nV != null && nV > nList) sub += ' · les ' + nList + ' plus ' + plural(nList, 'ancien', 'anciens') + ' affichés sur ' + fInt(nV);
    var head = bxHead('À vérifier', sub, nV);
    if (!L.length) return '<section class="cf-card" data-block="bx-check">' + head + '<div class="cf-empty-s cf-dashed">Aucune publication à vérifier.</div></section>';
    var shown = ui.bx.allCheck ? sorted : sorted.slice(0, BX_LIST_MAX);
    return '<section class="cf-card" data-block="bx-check">' + head + '<div class="cf-bx-list">' + shown.map(function (x) { return bxCheckRow(x, D); }).join('') + '</div>'
      + (sorted.length > BX_LIST_MAX ? '<button type="button" class="cf-link-btn" data-act="bx-all-check">' + esc(ui.bx.allCheck ? 'Réduire la liste' : 'Voir les ' + sorted.length + ' publications') + '</button>' : '')
      + '</section>';
  }

  // ── 04 · diffuseurs : inscriptions et classement ──
  function bxUsersHTML(D) {
    var U = D.users, sg = U.signups;
    var tiles = '<div class="cf-stiles">'
      + bxTile('total', bxN(U.total), 'Inscrits', U.total == null ? BX_NR : 'comptes BloxAI', 'is-acc')
      + bxTile('onboarded', bxN(U.onboarded), 'Profil terminé', U.onboarded == null ? BX_NR : 'peuvent demander une mission', '')
      + bxTile('active7', bxN(U.active7), 'Actifs · 7' + NB + 'j', U.active7 == null ? BX_NR : 'ont pris une mission', '')
      + bxTile('ig', bxN(U.ig), 'Instagram relié', U.ig == null ? BX_NR : 'connexion directe', '')
      + bxTile('tt', bxN(U.tt), 'TikTok relié', U.tt == null ? BX_NR : 'connexion directe', '')
      + bxTile('paused', bxN(U.paused), 'En pause', U.paused == null ? BX_NR : 'après trop d’échecs en 7' + NB + 'j', U.paused ? 'is-err' : '')
      + '</div>';
    var chart = !sg ? emptyLine('—', 'inscriptions par jour ' + BX_NR) : !sg.length ? '<div class="cf-empty-s">Aucune inscription sur 30' + NB + 'j.</div>'
      : bxBars('signups', 'Inscriptions par jour', sg.map(function (x) { return x.day; }), sg.map(function (x) { return x.n; }), ['inscription', 'inscriptions']);
    return '<section class="cf-card" data-block="bx-users">' + chead('Diffuseurs', 'comptes BloxAI · connexions Instagram et TikTok') + tiles + chart + '</section>';
  }
  function bxRankRow(x, i) {
    var hs = [x.ig ? 'IG @' + x.ig : '', x.tt ? 'TikTok @' + x.tt : ''].filter(Boolean).join(' · ') || 'aucun compte relié';
    var pause = x.pausedUntil != null && x.pausedUntil > Date.now() ? '<span class="cf-qchip is-ko">' + esc('en pause jusqu’au ' + dm(new Date(x.pausedUntil)) + ' à ' + hm(new Date(x.pausedUntil))) + '</span>' : '';
    var m = function (k, v, l) { return '<span class="cf-bx-rk-m" data-m="' + k + '"><b class="' + (v === '—' ? 'is-na' : '') + '">' + esc(v) + '</b><span>' + esc(l) + '</span></span>'; };
    var mis = [[x.claimed, 'prise', 'prises'], [x.submitted, 'envoyée', 'envoyées'], [x.expired, 'échouée', 'échouées'], [x.abandoned, 'abandonnée', 'abandonnées']]
      .map(function (y) { return y[0] == null ? '— ' + y[2] : fInt(y[0]) + ' ' + plural(y[0], y[1], y[2]); }).join(' · ');
    return '<div class="cf-bx-rk"><span class="cf-bx-rk-n">' + (i + 1) + '</span>'
      + '<span class="cf-bx-main"><b>' + esc(x.name || 'diffuseur') + '</b><span class="cf-meta">' + esc(hs) + '</span><span class="cf-meta">' + esc(mis) + '</span>' + pause + '</span>'
      + m('fiab', x.reliability == null ? '—' : fDec(x.reliability * 100, 0) + NB + '%', 'fiabilité')
      + m('vues', bxN(x.views), x.validViews == null ? 'vues' : 'vues · ' + fInt(x.validViews) + ' validées')
      + m('vpp', x.vpp == null ? '—' : fInt(x.vpp), 'vues / publication')
      + m('rapid', x.medianH == null ? '—' : fHours(x.medianH), 'délai médian') + '</div>';
  }
  function bxRankHTML(D) {
    var R = D.ranking, srt = ui.bx.sort;
    var seg = '<div class="cf-seg" role="group" aria-label="Tri du classement">' + BX_SORT.map(function (x) {
      var on = x[0] === srt;
      return '<button type="button" class="cf-seg-b' + (on ? ' is-on' : '') + '" data-act="bx-sort" data-k="' + x[0] + '" aria-pressed="' + on + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    var head = chead('Classement des diffuseurs', 'fiabilité = envoyées ÷ (envoyées + échouées + abandonnées) · rapidité = délai médian entre la prise et l’envoi', seg);
    if (!R) return '<section class="cf-card" data-block="bx-rank">' + head + emptyLine('—', 'classement ' + BX_NR) + '</section>';
    if (!R.length) return '<section class="cf-card" data-block="bx-rank">' + head + '<div class="cf-empty-s cf-dashed">Aucun diffuseur n’a encore pris de mission.</div></section>';
    var nn = function (v, dflt) { return v == null ? dflt : v; };
    var L = R.slice().sort(function (a, b) {
      if (srt === 'vues') return nn(b.views, -1) - nn(a.views, -1);
      if (srt === 'rapid') return nn(a.medianH, Infinity) - nn(b.medianH, Infinity) || nn(b.reliability, -1) - nn(a.reliability, -1);
      return nn(b.reliability, -1) - nn(a.reliability, -1) || nn(b.views, -1) - nn(a.views, -1);
    });
    var shown = ui.bx.allRank ? L : L.slice(0, BX_RANK_MAX);
    return '<section class="cf-card" data-block="bx-rank">' + head + '<div class="cf-bx-list">' + shown.map(bxRankRow).join('') + '</div>'
      + (L.length > BX_RANK_MAX ? '<button type="button" class="cf-link-btn" data-act="bx-all-rank">' + esc(ui.bx.allRank ? 'Réduire le classement' : 'Voir les ' + L.length + ' diffuseurs') + '</button>' : '')
      + '</section>';
  }

  // ── 05 · pièces d'identité (avant le premier versement) et versements ──
  function bxIdHTML(D) {
    var L = D.identity;
    var head = bxHead('Pièces d’identité', 'âge (18 ans révolus) et identité vérifiés à la main avant le premier versement · pièce comparée au nom légal déclaré à la 1re acceptation des conditions · nom lu sur la pièce comparé au titulaire de chaque versement · copie supprimée après la décision', L ? L.length : null)
      + (D.identityUndeleted ? '<div class="cf-bx-why is-warn">' + esc(D.identityUndeleted + ' ' + plural(D.identityUndeleted, 'copie déjà décidée', 'copies déjà décidées') + ' encore dans le stockage BloxAI : nouvel essai automatique') + '</div>' : '');
    if (!L) return '<section class="cf-card" data-block="bx-id">' + head + emptyLine('—', 'pièces d’identité ' + BX_NR) + '</section>';
    if (!L.length) return '<section class="cf-card" data-block="bx-id">' + head + '<div class="cf-empty-s cf-dashed">Aucune pièce à vérifier.</div></section>';
    return '<section class="cf-card" data-block="bx-id">' + head + '<div class="cf-bx-list">' + L.map(function (x) {
      var k = 'id:' + x.id, dis = bxDis(k), kv = bxDis('idv:' + x.id), t = x.created != null ? new Date(x.created) : null;
      // 18/10 (round 6, R2) : nom légal déclaré à la 1re acceptation des conditions (non modifiable) et nom déclaré actuel,
      // à comparer avec la pièce avant « Valider »
      return '<div class="cf-bx-row is-id" data-idrow="' + esc(x.id) + '"><span class="cf-bx-main"><b>' + esc(x.name || 'diffuseur') + '</b>'
        + '<span class="cf-meta">' + esc([x.email || 'e-mail inconnu', t ? 'déposée le ' + dmy(t) + ' à ' + hm(t) : 'date inconnue'].join(' · ')) + '</span>'
        + bxDeclLines(x) + '</span>'
        + '<span class="cf-bx-acts"><button type="button" class="cf-btn is-sm" data-act="bx-id-view" data-id="' + esc(x.id) + '"' + kv + '>' + svg(IC.eye, 12) + (ui.bx.busy['idv:' + x.id] ? 'Ouverture…' : 'Voir') + '</button>'
        + '<button type="button" class="cf-btn is-sm is-ko" data-act="bx-id-ko" data-id="' + esc(x.id) + '"' + dis + '>Refuser</button>'
        + '<button type="button" class="cf-btn is-sm is-okb" data-act="bx-id-ok" data-id="' + esc(x.id) + '"' + dis + '>' + svg(IC.check, 12) + (ui.bx.busy[k] ? 'Enregistrement…' : 'Valider') + '</button></span></div>';
    }).join('') + '</div></section>';
  }
  // nom légal déclaré à la 1re acceptation, nom déclaré actuel, nom réécrit depuis (onglet BloxAI et Accueil, 18/10)
  function bxDeclLines(x) {
    var dm = bxDeclMoved(x);
    return (x.declaredKnown ? (x.declaredFirst ? '<span class="cf-bx-how" data-decl-first="1">' + esc('nom légal déclaré à la 1re acceptation des conditions : ' + x.declaredFirst) + '</span>'
        + '<span class="cf-bx-how" data-decl-cur="1">' + esc('nom déclaré actuel : ' + (x.declaredCurrent || '—')) + '</span>'
      : '<span class="cf-bx-why is-warn" data-decl-first="0">aucun nom légal déclaré à l’acceptation des conditions : compare la pièce avec le diffuseur</span>') : '')
      + (dm ? '<span class="cf-bx-why is-warn" data-decl-moved="1">' + esc(dm + ' : la pièce doit être au nom de la 1re acceptation') + '</span>' : '');
  }

  // ── 18/10 (round 7, R7-16) : Accueil — « Pièces d'identité à vérifier » en tête, avec l'aperçu de l'image ──
  // Aperçu = URL signée de 300 s demandée à BloxAI (op identity_url, la même que « Voir ») pour les BX_PREV_MAX premières
  // pièces ; redemandée après 4 min (l'image déjà affichée reste en attendant). Oubliée dès la décision (bxIdAfter : image
  // détruite côté BloxAI). PDF / HEIC : pas d'aperçu dans la page (« Ouvrir »). Valider / Refuser = bxIdDecide, mêmes
  // contrôles que l'onglet BloxAI (date de naissance, 18 ans, nom lu, comparaison au nom de la 1re acceptation).
  var BX_PREV_MAX = 6, BX_PREV_TTL = 240000;
  function bxIdPrevKind(u) {
    var path = '';
    try { path = new URL(u).pathname.toLowerCase(); } catch (e) { /* rien */ }
    return /\.pdf$/.test(path) ? 'pdf' : /\.(heic|heif)$/.test(path) ? 'heic' : 'img';
  }
  function bxIdPrevGet(id, keep) {
    var e = { state: 'loading', url: keep && keep.url || null, kind: keep && keep.kind || null, at: Date.now() };
    ui.bx.idPrev[id] = e;
    CF.bxIdentityUrl(id).then(function (r) {
      if (ui.bx.idPrev[id] !== e) return;   // décision prise entre-temps : rien n'est gardé
      ui.bx.idPrev[id] = r && r.ok ? { state: 'ok', url: r.url, kind: bxIdPrevKind(r.url), at: Date.now() } : { state: 'err', error: (r && r.error) || 'erreur inconnue', at: Date.now() };
      schedule();
    });
  }
  function bxIdPrevLoad() {
    var D = CF.bx.data, L = D && D.identity ? D.identity.slice(0, BX_PREV_MAX) : [], P = ui.bx.idPrev, on = {};
    L.forEach(function (x) { on[x.id] = 1; });
    Object.keys(P).forEach(function (id) { if (!on[id]) delete P[id]; });   // pièce décidée ou sortie de la liste : URL oubliée
    L.forEach(function (x) {
      var e = P[x.id];
      if (e && (e.state !== 'ok' || Date.now() - e.at < BX_PREV_TTL)) return;   // en cours, en erreur (« Réessayer ») ou encore fraîche
      bxIdPrevGet(x.id, e);
    });
  }
  function homeIdRow(x) {
    var k = 'id:' + x.id, dis = bxDis(k), kv = bxDis('idv:' + x.id), t = x.created != null ? new Date(x.created) : null, P = ui.bx.idPrev[x.id], who = x.name || 'diffuseur', prev;
    if (P && P.url && P.kind === 'img' && (P.state === 'ok' || P.state === 'loading')) prev = '<img class="cf-idh-img" src="' + esc(P.url) + '" alt="' + esc('Pièce d’identité de ' + who) + '" data-idimg="' + esc(x.id) + '" referrerpolicy="no-referrer" decoding="async">';
    else if (P && P.url && (P.state === 'ok' || P.state === 'loading')) prev = '<div class="cf-idh-ph" data-prev="' + P.kind + '">' + svg(IC.eye, 18) + esc((P.kind === 'pdf' ? 'Pièce en PDF' : 'Photo HEIC') + ' : pas d’aperçu dans la page, ouvre-la') + '</div>';
    else if (P && (P.state === 'err' || P.state === 'imgerr')) prev = '<div class="cf-idh-ph is-err" data-prev="' + P.state + '">' + esc(P.state === 'err' ? 'Aperçu indisponible : ' + P.error : 'Aperçu illisible (lien expiré ou format non affiché)')
      + '<button type="button" class="cf-link-btn" data-act="bx-id-prev" data-id="' + esc(x.id) + '">Réessayer</button></div>';
    else prev = '<div class="cf-idh-ph" data-prev="loading"><span class="cf-spin" aria-hidden="true"></span>Chargement de l’aperçu…</div>';
    return '<div class="cf-idh-row" data-hid="' + esc(x.id) + '"><div class="cf-idh-prev">' + prev + '</div>'
      + '<div class="cf-bx-main"><b>' + esc(who) + '</b><span class="cf-meta">' + esc([x.email || 'e-mail inconnu', t ? 'déposée le ' + dmy(t) + ' à ' + hm(t) : 'date inconnue'].join(' · ')) + '</span>'
      + bxDeclLines(x)
      + '<span class="cf-bx-acts cf-idh-acts"><button type="button" class="cf-btn is-sm" data-act="bx-id-view" data-id="' + esc(x.id) + '"' + kv + '>' + svg(IC.external, 12) + (ui.bx.busy['idv:' + x.id] ? 'Ouverture…' : 'Ouvrir en grand') + '</button>'
      + '<button type="button" class="cf-btn is-sm is-ko" data-act="bx-id-ko" data-id="' + esc(x.id) + '"' + dis + '>Refuser</button>'
      + '<button type="button" class="cf-btn is-sm is-okb" data-act="bx-id-ok" data-id="' + esc(x.id) + '"' + dis + '>' + svg(IC.check, 12) + (ui.bx.busy[k] ? 'Enregistrement…' : 'Valider') + '</button></span></div></div>';
  }
  function homeIdHTML() {
    var D = CF.bx.data, L = D && D.identity ? D.identity : [], now = Date.now();
    var done = (ui.bx.idDone || []).filter(function (d) { return now - d.at < 10 * 60 * 1000; });
    // messages des pièces seulement : refus de l'edge (dont « Recharge le tableau de bord »), date ou nom invalides…
    var msg = bxMsgHTML(function (m) { return !!(m.k && /^idv?:/.test(m.k) && (m.fail || m.say)); });
    if (!L.length && !done.length && !msg) return '';
    var n = L.length;
    var doneH = done.length ? '<div class="cf-idh-done">' + done.map(function (d) {
      var ok = d.fd === true;
      return '<div class="cf-idh-done-r ' + (ok ? 'is-ok' : 'is-warn') + '" data-done="' + esc(d.id) + '" data-fd="' + (d.fd === true ? '1' : d.fd === false ? '0' : 'na') + '">' + svg(ok ? IC.check : IC.alert, 13)
        + '<span>' + esc(d.head + ' · ' + (ok ? 'image détruite' : d.fd === false ? 'image pas encore détruite : suppression en attente, nouvel essai automatique côté BloxAI (vérifie qu’elle disparaît)'
          : 'destruction de l’image non confirmée par BloxAI : vérifie que la copie a disparu')) + '</span></div>';
    }).join('') + '</div>' : '';
    return '<section class="cf-card cf-idh" data-block="home-id" aria-labelledby="cfIdhT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfIdhT">Pièces d’identité à vérifier <span class="cf-badge">' + n + '</span></h2>'
      + '<span class="cf-meta">' + esc('âge (18 ans révolus) et identité, à la main, avant le premier versement : compare la pièce avec le nom légal déclaré à la 1re acceptation des conditions, puis Valider (date de naissance et nom lus sur la pièce) ou Refuser (motif). L’image est détruite dès ta décision.') + '</span></div></div>'
      + msg + doneH
      + (n ? '<div class="cf-idh-list">' + L.slice(0, BX_PREV_MAX).map(homeIdRow).join('') + '</div>'
        + (n > BX_PREV_MAX ? '<button type="button" class="cf-link-btn" data-act="home-go" data-tab="trackads">' + esc('+ ' + (n - BX_PREV_MAX) + ' ' + plural(n - BX_PREV_MAX, 'autre pièce', 'autres pièces') + ' dans l’onglet BloxAI') + '</button>' : '')
        : '<div class="cf-empty-s cf-dashed">Plus aucune pièce à vérifier.</div>')
      + '</section>';
  }
  function bxIban(s) { return String(s).replace(/(.{4})(?=.)/g, '$1 '); }
  function bxPayHTML(D) {
    var M = D.money, P = M.payouts;
    var k = function (c, l) { return '<div class="cf-pay-k"><b class="' + (c ? 'is-v' : '') + '">' + esc(c == null ? '—' : fEur(c)) + '</b><span>' + esc(l) + '</span></div>'; };
    var head = bxHead('Versements', 'le 1er du mois · le 15 pour les paliers Pro et Elite · Elite : à la demande', P ? P.length : null)
      + '<div class="cf-pay-ks cf-bx-payks">' + k(M.validated, 'Gains validés') + k(M.paid, 'Déjà versé') + k(M.unpaid, 'Solde non versé') + '</div>';
    if (!P) return '<section class="cf-card" data-block="bx-pay">' + head + emptyLine('—', 'versements ' + BX_NR) + '</section>';
    var defer = bxDeferHTML(M.deferred);
    if (!P.length) return '<section class="cf-card" data-block="bx-pay">' + head + '<div class="cf-empty-s cf-dashed">Aucun versement à faire.</div>' + defer + '</section>';   // defer : reportés et gelés (18/10)
    return '<section class="cf-card" data-block="bx-pay">' + head + '<div class="cf-bx-list">' + P.map(function (x) {
      var kk = 'pay:' + x.id, dis = bxDis(kk), t = x.created != null ? new Date(x.created) : null;
      var how = bxPayDest(x) || (x.method === 'paypal' ? 'PayPal · e-mail PayPal absent' : x.method === 'iban' ? 'IBAN absent' : null);
      // 17/10 (round 5, contrats 2 et 9) : nom vérifié sur la pièce à côté du titulaire, coordonnées modifiées récemment
      var nc = bxNameCheck(x), rc = bxRecent(x);
      // 18/10 (round 6) : depuis le dernier versement payé (R1a), nom légal déclaré (R2), titulaire partiel (R4)
      var ph = bxPaidHist(x), pt = bxPaidTexts(x), dc = bxDeclCheck(x), dm = bxDeclMoved(x);
      var chip = function (c, t) { return '<span class="cf-qchip is-flag ' + c + '">' + svg(IC.alert, 11) + esc(t) + '</span>'; };
      // 18/10 (round 7, R7-5) : « Annuler ce versement » (ouvert seulement) et « Geler les versements » / « Dégeler » ; seulement
      // quand BloxAI envoie le gel (freezeKnown : sa version connaît bx_admin_payout_cancel et bx_admin_freeze)
      var canCancel = x.freezeKnown && (x.status === 'requested' || x.status === 'pending');
      return '<div class="cf-bx-row is-pay" data-pay="' + esc(x.id) + '"' + (x.payFrozen ? ' data-frozen="1"' : '') + (nc === 'diff' ? ' data-name-diff="1"' : '') + (rc ? ' data-recent="1"' : '')
        + (ph && ph.first ? ' data-first="1"' : '') + (ph && ph.changed ? ' data-paid-changed="1"' : '') + (ph && ph.dest ? ' data-dest-diff="1"' : '') + (dc ? ' data-decl="' + dc + '"' : '')
        + '><span class="cf-bx-main"><span class="cf-bx-l1"><b>' + esc((x.name || 'diffuseur') + ' · ' + fEur(x.amount)) + '</b>'
        + '<span class="cf-qchip ' + (x.status === 'requested' ? 'is-pend' : '') + '">' + esc(BX_PAY_ST[x.status] || 'statut inconnu') + '</span>'
        + (x.payFrozen ? chip('is-ko', 'Versements gelés') : '')
        + (x.detailsChanged ? '<span class="cf-qchip is-flag is-warn">' + svg(IC.alert, 11) + 'Coordonnées modifiées</span>' : '')
        + (rc ? '<span class="cf-qchip is-flag is-warn">' + svg(IC.alert, 11) + 'Modifiées récemment</span>' : '')
        + (nc === 'diff' ? '<span class="cf-qchip is-flag is-ko">' + svg(IC.alert, 11) + 'Titulaire ≠ pièce</span>' : '')
        + (nc === 'partial' ? chip('is-warn', 'Titulaire partiel') : '')
        + (dc === 'diff' ? chip('is-ko', 'Pièce ≠ nom déclaré') : '')
        + (ph && ph.dest ? chip('is-ko', 'Destination différente') : '')
        + (ph && ph.changed ? chip('is-warn', 'Changées depuis le dernier versement') : '')
        + (ph && ph.first ? chip('is-warn', '1er versement') : '') + '</span>'
        + '<span class="cf-meta">' + esc([BX_KIND[x.kind] || 'versement', x.period ? 'période du ' + dmy(ymdDate(x.period)) : '', t ? 'créé le ' + dmy(t) : '', x.email || ''].filter(Boolean).join(' · ')) + '</span>'
        + (x.payFrozen ? '<span class="cf-bx-why" data-frozen-t="1">' + esc(bxFrozenText(x) + ' ; ne paie pas ce versement sans avoir levé le doute (Annuler ce versement, ou Dégeler)') + '</span>' : '')
        + (how ? '<span class="cf-bx-how">' + esc((x.frozen ? 'figée à la demande · ' : 'profil actuel (non figé) · ') + how) + '</span>' : '<span class="cf-bx-why is-warn">moyen de paiement non renseigné : à demander au diffuseur</span>')
        + '<span class="' + (nc === 'ok' || nc === 'paypal' ? 'cf-bx-how' : 'cf-bx-why is-warn') + '" data-name="' + nc + '">' + esc(bxNameText(x)) + '</span>'
        + (dc && dc !== 'nover' ? '<span class="' + (dc === 'ok' ? 'cf-bx-how' : 'cf-bx-why' + (dc === 'none' ? ' is-warn' : '')) + '" data-decl-t="1">' + esc(bxDeclText(x)) + '</span>' : '')
        + (dm ? '<span class="cf-bx-why is-warn" data-decl-moved="1">' + esc(dm) + '</span>' : '')
        + (x.detailsChanged ? '<span class="cf-bx-why is-warn">' + esc('le diffuseur a changé ses coordonnées après la demande : paie la destination figée ci-dessus (ou vérifie avec lui avant)') + '</span>' : '')
        + (rc ? '<span class="cf-bx-why is-warn">' + esc(bxRecentText(rc) + ' : ' + bxCoolEnd(rc) + ' ; paie la destination figée ci-dessus, en cas de doute confirme avec le diffuseur par un autre canal') + '</span>' : '')
        + pt.map(function (p) { return '<span class="cf-bx-why' + (p[0] === 'dest' ? '' : ' is-warn') + '" data-paid="' + p[0] + '">' + esc(p[1]) + '</span>'; }).join('') + '</span>'
        + '<span class="cf-bx-acts">' + bxFreezeBtn(x)
        + (canCancel ? '<button type="button" class="cf-btn is-sm is-ko" data-act="bx-pay-cancel" data-id="' + esc(x.id) + '"' + dis + '>' + (ui.bx.busy[kk] === 'admin_payout_cancel' ? 'Annulation…' : 'Annuler ce versement') + '</button>' : '')
        + '<button type="button" class="cf-btn is-sm is-okb" data-act="bx-pay" data-id="' + esc(x.id) + '"' + dis + '>' + svg(IC.check, 12) + (ui.bx.busy[kk] === 'admin_payout_paid' ? 'Enregistrement…' : 'Marquer payé') + '</button></span></div>';
    }).join('') + '</div>' + defer + '</section>';
  }
  // 17/10 (round 5, contrat 2) : diffuseurs dont le versement est REPORTÉ (BX_COOLDOWN : coordonnées de versement ou mot de
  // passe changés depuis moins de 72 h) — rien à payer pour l'instant, BloxAI le crée au premier passage après le délai.
  // Session volée ? Axel peut prévenir le diffuseur par un autre canal avant.
  // 18/10 (round 7, R7-5) : gel des versements par Axel — un diffuseur gelé n'a JAMAIS de versement créé (BX_FROZEN) ; ses
  // lignes de payouts_deferred sont montrées à part (bxFrozenHTML), avec « Dégeler »
  function bxDefFrozen(d) { return !!(d && (d.payFrozen || d.reason === 'BX_FROZEN')); }
  function bxFrozenText(x) { return 'versements gelés par toi' + (x.payFrozenReason ? ' (motif : « ' + x.payFrozenReason + ' »)' : '') + ' : BloxAI ne crée plus aucun versement pour ce diffuseur'; }
  function bxFreezeBtn(x) {
    if (!x || !x.freezeKnown || !x.userId) return '';
    var fk = 'frz:' + x.userId;
    return '<button type="button" class="cf-btn is-sm' + (x.payFrozen ? '' : ' is-ko') + '" data-act="bx-freeze" data-uid="' + esc(x.userId) + '" data-on="' + (x.payFrozen ? '0' : '1') + '"' + bxDis(fk) + '>'
      + (ui.bx.busy[fk] ? 'Enregistrement…' : x.payFrozen ? 'Dégeler' : 'Geler les versements') + '</button>';
  }
  function bxFrozenHTML(L) {
    if (!L || !L.length) return '';
    return '<div class="cf-bx-sub" data-block="bx-frozen"><span class="cf-meta"><b>' + esc(L.length + ' ' + plural(L.length, 'diffuseur aux versements gelés', 'diffuseurs aux versements gelés')) + '</b>'
      + esc(' · aucun versement créé tant que tu ne dégèles pas') + '</span><div class="cf-bx-list">' + L.map(function (d) {
        return '<div class="cf-bx-row is-pay is-defer" data-frozen-user="' + esc(d.userId) + '"><span class="cf-bx-main"><span class="cf-bx-l1"><b>' + esc((d.name || 'diffuseur') + (d.balance != null ? ' · solde ' + fEur(d.balance) : '')) + '</b>'
          + '<span class="cf-qchip is-flag is-ko">' + svg(IC.alert, 11) + 'Versements gelés</span></span>'
          + (d.email ? '<span class="cf-meta">' + esc(d.email) + '</span>' : '')
          + '<span class="cf-bx-why">' + esc(bxFrozenText(d)) + '</span>'
          + '<span class="cf-bx-how">' + esc(d.verifiedName ? 'nom vérifié sur la pièce : ' + d.verifiedName : 'aucun nom vérifié sur la pièce d’identité') + '</span></span>'
          + (d.freezeKnown ? '<span class="cf-bx-acts">' + bxFreezeBtn(Object.assign({}, d, { payFrozen: true })) + '</span>' : '') + '</div>';
      }).join('') + '</div></div>';
  }
  function bxDeferHTML(LL) {
    var L = (LL || []).filter(function (d) { return !bxDefFrozen(d); }), F = bxFrozenHTML((LL || []).filter(bxDefFrozen));
    if (!L.length) return F;
    return F + '<div class="cf-bx-sub" data-block="bx-defer"><span class="cf-meta"><b>' + esc(L.length + ' ' + plural(L.length, 'versement reporté', 'versements reportés')) + '</b>'
      + esc(' · coordonnées modifiées récemment : aucun versement créé avant la fin du délai de sécurité') + '</span><div class="cf-bx-list">' + L.map(function (d) {
        var rc = bxRecent(d) || (d.cooldownUntil != null ? { at: null, pwd: false, until: d.cooldownUntil } : null);
        return '<div class="cf-bx-row is-pay is-defer" data-defer="' + esc(d.userId) + '"><span class="cf-bx-main"><span class="cf-bx-l1"><b>' + esc((d.name || 'diffuseur') + (d.balance != null ? ' · solde ' + fEur(d.balance) : '')) + '</b>'
          + '<span class="cf-qchip is-pend">Reporté</span><span class="cf-qchip is-flag is-warn">' + svg(IC.alert, 11) + 'Modifiées récemment</span></span>'
          + (d.email ? '<span class="cf-meta">' + esc(d.email) + '</span>' : '')
          + '<span class="cf-bx-why is-warn">' + esc((rc ? bxRecentText(rc) + ' : ' + bxCoolEnd(rc) : 'coordonnées modifiées récemment : versement reporté par BloxAI') + ' ; si ce n’était pas le diffuseur, préviens-le par un autre canal') + '</span>'
          + '<span class="cf-bx-how">' + esc(d.verifiedName ? 'nom vérifié sur la pièce : ' + d.verifiedName : 'aucun nom vérifié sur la pièce d’identité') + '</span></span>'
          + (d.freezeKnown ? '<span class="cf-bx-acts">' + bxFreezeBtn(d) + '</span>' : '') + '</div>';   // 18/10 (round 7) : geler aussi un diffuseur reporté
      }).join('') + '</div></div>';
  }

  // ── fiche d'une vidéo finale : bloc « Diffusion » (Instagram, TikTok, BloxAI) ──
  function bxDiffRow(ic, name, body) {
    return '<div class="cf-bx-drow"><span class="cf-bx-dn">' + ic + '<b>' + esc(name) + '</b></span><div class="cf-bx-db">' + body + '</div></div>';
  }
  // somme des valeurs connues ; « ≥ » quand une publication n'a pas ce chiffre (jamais un total présenté comme complet)
  function bxSum(L, k) {
    var x = L.filter(function (p) { return p[k] != null; });
    return x.length ? (x.length < L.length ? '≥' + NB : '') + fInt(x.reduce(function (a, p) { return a + p[k]; }, 0)) : '—';
  }
  function vfIgRow(vf) {
    var ms = mediaState(), nm = 'Instagram';
    if (ms.st === 'wait') return bxDiffRow(IG_GLYPH, nm, '<span class="cf-meta">chargement des publications…</span>');
    if (ms.st !== 'ok') return bxDiffRow(IG_GLYPH, nm, '<span class="cf-meta">' + esc('— · ' + ms.why) + '</span>');
    var L = ms.MD.list.filter(function (p) { return p.recipe && String(p.recipe.vf || '').split('_')[0] === vf; });
    if (!L.length) return bxDiffRow(IG_GLYPH, nm, '<span class="cf-meta">' + esc('aucune publication reconnue sur @' + selName()) + '</span>');
    var v = bxSum(L, 'views'), lk = bxSum(L, 'likes');
    var links = L.slice(0, 4).map(function (p) {
      var u = safeUrl(p.permalink, IG_HOST), d = p.ms != null ? dm(new Date(p.ms)) : 'sans date';
      return u ? '<a class="cf-link" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(d + ' · ' + bxN(p.views) + ' vues') + svg(IC.external, 11) + '</a>' : '<span class="cf-meta">' + esc(d) + '</span>';
    }).join('');
    return bxDiffRow(IG_GLYPH, nm, '<span class="cf-bx-dv"><b>' + esc(v) + '</b> vues · ' + esc(lk) + ' likes · ' + esc(L.length + ' ' + plural(L.length, 'publication')) + '</span><span class="cf-bx-dl">' + links + '</span>');
  }
  function vfTtRow(vf) {
    var S = CF.tts, D = S.data, nm = 'TikTok', ic = svg(IC.tiktok, 14);
    if (!D) return bxDiffRow(ic, nm, '<span class="cf-meta">' + esc(S.state === 'error' ? '— · stats TikTok illisibles : ' + S.error : 'chargement des stats TikTok…') + '</span>');
    var L = [];
    D.accounts.forEach(function (a) { a.videos.forEach(function (v) { if (v.recipe && v.recipe.vf === vf) L.push({ v: v, a: a }); }); });
    if (!L.length) return bxDiffRow(ic, nm, '<span class="cf-meta">' + esc(D.accounts.length ? 'aucune vidéo reconnue sur les comptes reliés' : '— · aucun compte TikTok relié pour les stats') + '</span>');
    var V = L.map(function (x) { return x.v; }), v = bxSum(V, 'views'), lk = bxSum(V, 'likes');
    var links = L.slice(0, 4).map(function (x) {
      var u = safeUrl(x.v.url || '', BX_NET.tiktok[1]), d = (x.a.username ? '@' + x.a.username + ' · ' : '') + (x.v.ms != null ? dm(new Date(x.v.ms)) : 'sans date');
      return u ? '<a class="cf-link" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(d + ' · ' + bxN(x.v.views) + ' vues') + svg(IC.external, 11) + '</a>' : '<span class="cf-meta">' + esc(d) + '</span>';
    }).join('');
    return bxDiffRow(ic, nm, '<span class="cf-bx-dv"><b>' + esc(v) + '</b> vues · ' + esc(lk) + ' likes · ' + esc(L.length + ' ' + plural(L.length, 'vidéo')) + '</span><span class="cf-bx-dl">' + links + '</span>');
  }
  function vfBxRow(vf) {
    var B = bxModel(), D = B.D, nm = 'BloxAI', ic = svg(IC.reach, 14);
    if (!D) return bxDiffRow(ic, nm, '<span class="cf-meta">' + esc(B.pending ? 'chargement de BloxAI…' : '— · ' + B.why) + '</span>');
    var E = D.byVf[vf];
    if (!E) return bxDiffRow(ic, nm, '<span class="cf-meta">pas dans le stock commun BloxAI (kit d’Axel, ou vidéo pas encore poussée)</span>');
    var st = BX_MST[E.status] || ['statut inconnu', ''], k = 'vf:' + vf, dis = bxDis(k), KV = CF.prod.data ? CF.prod.data.qc.kitVfs : null;
    // retire : seulement « open » ; reopen : seulement « retired » et jamais une vidéo du kit d'Axel (revérifié par le proxy)
    var act = E.status === 'open' ? '<button type="button" class="cf-btn is-sm is-ko" data-act="bx-mission" data-vf="' + esc(vf) + '" data-d="retire"' + dis + '>' + (ui.bx.busy[k] ? 'Enregistrement…' : 'Retirer du stock') + '</button>'
      : E.status === 'retired' && !(KV && KV.vfs[vf]) ? '<button type="button" class="cf-btn is-sm" data-act="bx-mission" data-vf="' + esc(vf) + '" data-d="reopen"' + dis + '>' + (ui.bx.busy[k] ? 'Enregistrement…' : 'Remettre dans le stock') + '</button>' : '';
    // passée au kit mais sans post dans le kit (retrait interrompu) : jamais « Remettre » ici (fichier peut-être libéré),
    // la recharge suivante du kit la reprend (journal des retraits)
    var orphan = E.status === 'kit' && KV && !KV.vfs[vf] && (KV.complete || (E.created != null && KV.oldest != null && E.created >= KV.oldest));
    if (orphan) act = '<span class="cf-meta">' + esc('aucun post dans le kit : retrait interrompu, repris par la prochaine recharge du kit (sinon, à vérifier)') + '</span>';
    var asg = E.assignments.slice(0, 8).map(function (a) {
      var s2 = BX_AST[a.status] || ['statut inconnu', ''], when = a.assigned != null ? 'prise le ' + dm(new Date(a.assigned)) + ' à ' + hm(new Date(a.assigned)) : 'date inconnue';
      var end = a.submitted != null ? 'envoyée le ' + dm(new Date(a.submitted)) : a.ended != null ? 'fin le ' + dm(new Date(a.ended)) : a.status === 'active' && a.deadline != null ? 'échéance ' + dm(new Date(a.deadline)) + ' à ' + hm(new Date(a.deadline)) : '';
      return '<span class="cf-bx-dli"><span class="cf-qchip ' + s2[1] + '">' + esc(s2[0]) + '</span>' + esc([a.name || 'diffuseur', when, end].filter(Boolean).join(' · ')) + '</span>';
    }).join('');
    var pubs = E.publications.slice(0, 8).map(function (p) {
      var n2 = BX_NET[p.network], u = safeUrl(p.url || '', n2[1]), s3 = BX_PST[p.status] || ['statut inconnu', ''];
      var txt = n2[0] + ' · ' + bxN(p.views) + ' vues' + (p.status === 'valid' && p.validViews != null ? ' · ' + fInt(p.validViews) + ' validées' : '');
      return '<span class="cf-bx-dli"><span class="cf-qchip ' + s3[1] + '">' + esc(s3[0]) + '</span>'
        + (u ? '<a class="cf-link" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + svg(IC.external, 11) + '</a>' : esc(txt)) + '</span>';
    }).join('');
    return bxDiffRow(ic, nm, '<span class="cf-bx-l1"><span class="cf-qchip ' + st[1] + '">' + esc(st[0]) + '</span>' + (E.missionId ? '<span class="cf-meta">mission n° ' + esc(E.missionId) + '</span>' : '') + act + '</span>'
      + (asg ? '<span class="cf-bx-dlist">' + asg + '</span>' : '<span class="cf-meta">jamais prise par un diffuseur</span>')
      + (pubs ? '<span class="cf-bx-dlist">' + pubs + '</span>' : ''));
  }
  function vfDiffHTML(qid) {
    var D = CF.prod.data, q = D ? D.qc.list.filter(function (x) { return x.id === qid; })[0] : null;
    if (!q) return '';
    var vf = q.template && /^VF-\d{4}$/.test(q.template) ? q.template : null, head = '<div class="cf-over">Diffusion</div>';
    if (!vf) return head + '<span class="cf-meta">numéro de vidéo finale (VF-0000) absent : diffusion non rattachable</span>';
    return head + '<div class="cf-bx-diff">' + vfIgRow(vf) + vfTtRow(vf) + vfBxRow(vf) + '</div>' + bxMsgHTML();
  }

  // ── actions d'administration (clic explicite → CF.bxAdmin → chiffres relus) ──
  // okText : texte, ou fonction (réponse) → texte (16/10 : message d'une décision sur un lien tiré de la ligne renvoyée)
  // 17/10 : okText peut aussi renvoyer { text, ok:false } (décision enregistrée MAIS à surveiller : copie de pièce pas supprimée)
  // 18/10 (round 7) : busy[k] = l'action en cours (libellé du bouton) ; le message garde sa clé k (l'Accueil n'affiche que
  // ceux des pièces d'identité) ; refus 409 « Recharge le tableau de bord » de l'edge (R7-7, page d'avant la version 89) :
  // expliqué, avec un bouton « Recharger la page »
  function bxRun(k, payload, okText) {
    if (ui.bx.busy[k]) return;
    ui.bx.busy[k] = (payload && payload.op) || 1; ui.bx.msg = null;
    schedule();
    CF.bxAdmin(payload).then(function (r) {
      delete ui.bx.busy[k];
      var t = r && r.ok ? (typeof okText === 'function' ? okText(r) : okText) : null, er = (r && r.error) || 'erreur inconnue';
      ui.bx.msg = r && r.ok ? (t && typeof t === 'object' ? { ok: t.ok !== false, text: t.text, at: Date.now(), k: k } : { ok: true, text: t, at: Date.now(), k: k })
        : { ok: false, fail: true, k: k, at: Date.now(), text: 'Non enregistré : ' + er + (/^Recharge le tableau de bord/.test(er) ? ' (cette page est d’une version plus ancienne que celle que BloxAI accepte pour l’argent et les pièces d’identité : rien n’a été fait)' : '') };
      schedule();
    });
  }
  // Message après une décision sur un lien, d'après la ligne que BloxAI vient d'écrire (r.pub, cf-store bxPubRow) et non
  // d'après la liste affichée avant le clic (16/10 : un signal apparu depuis sur un lien au suivi fini → « Valider » le
  // refuse ; l'ancien message disait « validée »). null = ligne absente (edge bloxai d'avant le 16/10) : texte d'avant le clic.
  function bxPubDone(p, d, who, x, D) {
    if (!p) return null;
    var fl = bxFlagChips(p), sig = fl.map(function (f) { return f[0]; }).join(', ');
    if (p.status === 'refus') {
      var mot = p.reason ? ' · motif : « ' + p.reason + ' »' : '';
      return d === 'refuse' ? 'Publication refusée : ' + who + mot + '.'
        : 'Décision enregistrée : ' + who + ' refusée' + (fl.length ? ' (signal du relevé des vues : ' + sig + ')' : '') + mot + ', 0 vue validée.';
    }
    if (p.status === 'valid') {
      // 17/10 (round 5) : « Valider avec les vues figées » → le dit aussi dans le message
      return 'Publication validée' + (d === 'validate_frozen' ? ' avec ses vues figées' : '') + ' : ' + who + (p.validViews != null ? ' · ' + fInt(p.validViews) + ' ' + plural(p.validViews, 'vue validée', 'vues validées') : '') + '.';
    }
    // toujours en suivi : conforme (checked_at), en attente de vérification, ou remise à vérifier ; fin du suivi = closes_at
    // de la liste, sinon date du lien. 17/10 (contrat 3) : un signal n'entraîne jamais de refus automatique.
    var end = bxTrackEnd({ closes: x.closes, created: p.created != null ? p.created : x.created }, D), day = end != null ? ' (' + dmy(new Date(end)) + ')' : '';
    if (p.flags && p.flags.held) return 'Publication toujours en attente de vérification : ' + who + '. Aucun gain tant que BloxAI ne l’a pas validée : actualise, puis réessaie ou refuse.';
    var risk = fl.length ? ' Signalée par le relevé des vues (' + sig + ') : à revérifier avant la fin du suivi, rien n’est refusé automatiquement.' : '';
    if (p.checked != null) return 'Publication conforme : ' + who + '. Sortie de « À vérifier » ; gains comptés à la fin du suivi' + day + ' si ses vues sont relues dans les 48' + NB + 'h avant.' + risk;
    return 'Publication remise à vérifier : ' + who + '.' + (fl.length ? ' Signalée par le relevé des vues : ' + sig + ' (à vérifier : jamais de refus automatique).' : '');
  }
  function bxFind(list, id) { return (list || []).filter(function (x) { return x.id === id; })[0] || null; }
  // 18/10 (round 6, R3) : lignes « Engagement » des fenêtres « Valider » / « Valider avec les vues figées » ; noHold = motif
  // de retenue déjà écrit dans la fenêtre (vues figées)
  function bxEngLines(x, noHold) {
    var e = bxEngText(x), h = !noHold && bxHoldLive(x.holdReason) ? '\nRetenue par BloxAI : ' + bxHoldText(x.holdReason) + '.' : '';
    // 18/10 (round 7, R7-1 / R7-3) : vues du 1er jour, abonnés du compte ; vues retirées par le réseau
    var a = bxAudText(x), r7 = (a ? '\nAudience : ' + a + '.' : '') + (x.viewsDropped ? '\nVues retirées par le réseau : ' + bxDropText(x) + '.' : '');
    // BloxAI d'avant le round 6 (aucune clé d'engagement) : pas de ligne ; clés présentes mais vides : « non relevé »
    if (!x.engKnown && !e) return h || r7 ? '\n' + r7 + h : '';
    return '\n\nEngagement : ' + (e || 'non relevé par BloxAI (j’aime, commentaires, partages et hausse sur un jour inconnus)') + '.' + r7 + h;
  }
  function bxAsk(text, dflt) { var v = window.prompt(text, dflt || ''); return v == null ? null : String(v).trim(); }
  function bxSay(ok, text, k) { ui.bx.msg = { ok: ok, text: text, at: Date.now(), k: k || null, say: true }; schedule(); }
  // 18/10 (round 7, R7-10) : copie d'une ligne BloxAI dont TOUS les noms sont nettoyés pour une fenêtre (dlgName) : Nom du
  // diffuseur 40 caractères ; noms légaux, nom lu, titulaire, PayPal, motif de gel : retours à la ligne et contrôles
  // ramenés à une espace. Les contrôles (titulaire ≠ pièce, destination…) donnent le même résultat (comparaison mot à mot).
  function bxDlg(x) {
    if (!x) return x;
    var c = Object.assign({}, x), L = function (v) { return typeof v === 'string' ? dlgName(v, 120) || null : v; };
    if (typeof x.name === 'string') c.name = dlgName(x.name) || null;
    ['verifiedName', 'ibanHolder', 'declaredFirst', 'declaredCurrent', 'paypal', 'email'].forEach(function (k) { c[k] = L(x[k]); });
    ['lastPaid', 'destRaw'].forEach(function (k) { if (x[k]) c[k] = Object.assign({}, x[k], { holder: L(x[k].holder), paypal: L(x[k].paypal), iban: L(x[k].iban) }); });
    if (typeof x.payFrozenReason === 'string') c.payFrozenReason = dlgName(x.payFrozenReason, 300);
    return c;
  }
  function bxPubDecide(id, d) {
    var D = CF.bx.data, x = D && bxFind(D.toCheck, id);
    if (!x) return;
    var who = (x.vf || 'vidéo') + ' · ' + BX_NET[x.network][0] + ' · ' + (dlgName(x.name) || 'diffuseur');   // 18/10 (R7-10)
    if (d === 'refuse') {
      var why = bxAsk('Refuser la publication ' + who + '.\nMotif (le diffuseur le verra) :', bxMotif(x) || '');
      if (why == null) return;
      if (!why) { bxSay(false, 'Motif obligatoire pour refuser.'); return; }
      bxRun('pub:' + id, { op: 'admin_publication', id: id, decision: 'refuse', reason: why.slice(0, 300) }, function (r) {
        return bxPubDone(r.pub, 'refuse', who, x, D) || 'Publication refusée : ' + who + '.';
      });
    } else if (d === 'validate') {
      // Valider = conforme (checked_at côté BloxAI) : un lien en suivi pas encore regardé, ou un lien « En attente de
      // vérification » (17/10 : suivi fini, gains bloqués jusqu'à cette décision) ; un refus se « Remet à vérifier »
      // 17/10 (round 5) : suivi fini → toujours « Valider avec les vues figées » (un « validate » simple laisserait retenu un
      // lien pas relu dans les 48 h avant la fin)
      if (x.status === 'verif' && bxTrackEnd(x, D) != null && !bxTracking(x, D)) { bxPubDecide(id, 'validate_frozen'); return; }
      if (x.status !== 'verif' || (x.checked != null && !bxHeld(x))) { bxSay(false, 'Publication ' + who + ' déjà ' + (x.status === 'refus' ? 'refusée : « Remettre à vérifier » d’abord.' : 'traitée.')); return; }
      var td = bxTrackDays(D), end = bxTrackEnd(x, D), live = bxTracking(x, D), fl = bxFlagChips(x);
      var day = end != null ? ' (le ' + dmy(new Date(end)) + ')' : '', vv = x.viewsAtClose != null ? x.viewsAtClose : x.views;
      var q = 'Valider la publication ' + who + ' ?\n'
        + (live ? 'Conforme : la vidéo sort de « À vérifier » ; ses gains seront comptés à la fin des ' + td + ' jours' + day + ', avec ses vues de ce jour-là, si le relevé a pu les relire dans les 48 h avant (sinon : en attente de vérification).'
          : 'Suivi des vues terminé : ses ' + (vv == null ? '' : fInt(vv) + ' ') + 'vues figées à la fin du suivi comptent tout de suite dans les gains du diffuseur.')
        + (fl.length ? '\n\nAttention, signalé par le relevé des vues : ' + fl.map(function (f) { return f[0] + ' (' + f[2] + ')'; }).join(' ; ') + '.'
          + ' Rien n’est refusé automatiquement : vérifie ce signal avant de valider (sinon, Refuser).' : '')
        // 18/10 (round 6, R3) : engagement de la vidéo (vues achetées ?) et motif « engagement anormal » de BloxAI
        + bxEngLines(x);
      if (!window.confirm(q)) return;
      // texte d'avant le clic : seulement si l'edge ne renvoie pas la ligne écrite (sinon bxPubDone, l'état réel)
      var before = live
        ? 'Publication conforme : ' + who + '. Sortie de « À vérifier » ; gains comptés à la fin du suivi' + (end != null ? ' (' + dmy(new Date(end)) + ')' : '') + ' si ses vues sont relues dans les 48' + NB + 'h avant.'
        : 'Publication validée : ' + who + '.';
      bxRun('pub:' + id, { op: 'admin_publication', id: id, decision: 'validate' }, function (r) { return bxPubDone(r.pub, 'validate', who, x, D) || before; });
    } else if (d === 'validate_frozen') {
      // 17/10 (round 5, contrat 5) : après la fin du suivi seulement, BloxAI valide avec SES vues figées (views_at_close,
      // sinon les vues du dernier relevé) : aucun chiffre ne part d'ici. Pour un lien retenu (pas relu dans les 48 h avant
      // la fin, chaîne non vérifiée, signal…) : Axel a vérifié lui-même (statistiques natives du diffuseur, contrat 7.4).
      var end2 = bxTrackEnd(x, D);
      if (x.status !== 'verif' || end2 == null || bxTracking(x, D)) { bxSay(false, 'Publication ' + who + ' : « Valider avec les vues figées » seulement après la fin du suivi, sur un lien encore à vérifier.'); return; }
      var fl2 = bxFlagChips(x), vf2 = x.viewsAtClose != null ? x.viewsAtClose : x.views;
      var q2 = 'Valider la publication ' + who + ' avec ses vues figées ?\n'
        + 'Suivi des vues terminé : ses ' + (vf2 == null ? '' : fInt(vf2) + ' ') + 'vues figées à la fin du suivi comptent tout de suite dans les gains du diffuseur.'
        + ' Fin du suivi le ' + dmy(new Date(end2)) + ' ; le chiffre est celui de BloxAI, rien n’est tapé ici.'
        + (x.holdReason ? '\n\nRetenue par BloxAI : ' + bxHoldText(x.holdReason) + '.' : '')
        + (x.checkedViews != null ? '\nVues au « conforme » : ' + fInt(x.checkedViews) + (bxJump(x) ? ', hausse anormale depuis : vues achetées ?' : '') + '.' : '')
        + (fl2.length ? '\n\nAttention, signalé par le relevé des vues : ' + fl2.map(function (f) { return f[0] + ' (' + f[2] + ')'; }).join(' ; ') + '.' : '')
        + bxEngLines(x, true)   // 18/10 (round 6, R3) : le motif de retenue est déjà au-dessus
        + '\n\nValide seulement si tu as vérifié la vidéo et ses vues (statistiques natives du diffuseur au besoin, contrat art. 7.4). Sinon, Refuser.';
      if (!window.confirm(q2)) return;
      bxRun('pub:' + id, { op: 'admin_publication', id: id, decision: 'validate_frozen' }, function (r) {
        return bxPubDone(r.pub, 'validate_frozen', who, x, D) || 'Publication validée avec ses vues figées : ' + who + '.';
      });
    } else if (d === 'reset') {
      if (!window.confirm('Remettre la publication ' + who + ' en vérification ?')) return;
      bxRun('pub:' + id, { op: 'admin_publication', id: id, decision: 'reset' }, function (r) {
        return bxPubDone(r.pub, 'reset', who, x, D) || 'Publication remise à vérifier : ' + who + '.';
      });
    }
  }
  // 17/10 (contrat 5) : destination du versement telle que figée à sa création (jamais le profil modifié depuis)
  function bxPayDest(x) {
    return x.method === 'paypal' ? (x.paypal ? 'PayPal · ' + x.paypal : null)
      : x.method === 'iban' ? (x.iban ? 'IBAN · ' + (x.ibanHolder ? x.ibanHolder + ' · ' : '') + bxIban(x.iban) : null) : null;
  }
  // 17/10 (round 5, contrat 2) : coordonnées de versement (payout_updated_at ; 18/10 : aussi dépôt d'une pièce ou nom légal
  // changé) ou mot de passe (password_changed_at) changés
  // il y a moins de 72 h → « coordonnées modifiées récemment » (BloxAI ne crée alors aucun versement : BX_COOLDOWN).
  // Fin du délai : cooldown_until de BloxAI quand il le renvoie (null = aucun délai en cours), sinon le changement le plus
  // récent + payout_cooldown_hours (72 h par défaut). Renvoie { at, pwd, until } ou null.
  // 18/10 (round 7, R7-4) : changement d'adresse e-mail (email_changed_at) compté aussi — à égalité, l'ordre reste
  // coordonnées, mot de passe, e-mail. Renvoie { at, pwd, mail, until } ou null.
  function bxRecent(x) {
    var now = Date.now(), D = CF.bx && CF.bx.data, last = null;
    var h = D && D.settings && D.settings.payoutCooldownH != null && D.settings.payoutCooldownH > 0 ? D.settings.payoutCooldownH : 72;
    [[x.payoutUpdated, ''], [x.passwordChanged, 'pwd'], [x.emailChanged, 'mail']].forEach(function (z) { if (z[0] != null && (!last || z[0] > last.at)) last = { at: z[0], what: z[1] }; });
    var until = x.cooldownKnown ? x.cooldownUntil : last ? last.at + h * 3600e3 : null;
    if (until == null || until <= now) return null;
    return { at: last ? last.at : null, pwd: !!last && last.what === 'pwd', mail: !!last && last.what === 'mail', until: until };
  }
  function bxRecentText(c) {
    var d = c.at != null ? new Date(c.at) : null;
    return 'coordonnées modifiées récemment (' + (d ? (c.pwd ? 'mot de passe changé' : c.mail ? 'adresse e-mail changée' : 'coordonnées de versement, pièce ou nom légal changés') + ' le ' + dmy(d) + ' à ' + hm(d)
      : 'coordonnées, mot de passe ou adresse e-mail changés') + ')';
  }
  function bxCoolEnd(c) { var u = new Date(c.until); return 'BloxAI ne crée aucun nouveau versement avant le ' + dmy(u) + ' à ' + hm(u); }
  // 17/10 (round 5, contrat 9) : nom lu par Axel sur la pièce vérifiée (verified_name) ↔ titulaire de l'IBAN figé.
  // Comparaison sans accents, casse, ponctuation ni ordre des mots. 'ok' | 'diff' | 'none' (aucun nom vérifié) |
  // 'paypal' (pas de titulaire à comparer : nom PayPal à vérifier chez PayPal)
  // 17/10 (round 5) : toutes écritures (lettres et chiffres Unicode), civilités (M., Mme, Mlle, Mr…) ignorées ; titulaire
  // sans ses autres prénoms = même personne (au moins 2 mots, TOUS lus sur la pièce : rien d'inventé ne passe) ; les deux
  // noms restent affichés
  var BX_CIVIL = { m: 1, mme: 1, mlle: 1, mr: 1, mrs: 1, ms: 1, monsieur: 1, madame: 1, mademoiselle: 1 };
  function bxNameWords(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')
      .filter(function (w) { return w && !BX_CIVIL[w]; }).sort();
  }
  // 18/10 (round 6, R4) : 'ok' SEULEMENT si les mots sont exactement les mêmes (même multiensemble, sans accents, casse,
  // ponctuation, civilités ni ordre) ; titulaire qui n'a qu'une PARTIE des mots de la pièce → 'partial' (orange : un parent
  // qui porte un des prénoms du diffuseur passait « ok » : « MARTIN Lucas Paul » / « Paul Martin », « Jean-Pierre Dupont » /
  // « Jean Dupont », « Marie Claire Durand » / « Claire Durand ») ; sinon 'diff'.
  function bxNameSame(a, b) { var x = bxNameWords(a), y = bxNameWords(b); return x.length > 0 && x.join(' ') === y.join(' '); }
  function bxNameCheck(x) {
    var vn = bxNameWords(x.verifiedName);
    if (!vn.length) return 'none';
    if (x.method !== 'iban') return 'paypal';
    var ho = bxNameWords(x.ibanHolder);
    if (!ho.length) return 'diff';
    if (ho.join(' ') === vn.join(' ')) return 'ok';
    var left = vn.slice();
    return ho.every(function (w) { var i = left.indexOf(w); if (i < 0) return false; left.splice(i, 1); return true; }) ? 'partial' : 'diff';
  }
  function bxNameText(x) {
    var c = bxNameCheck(x);
    if (c === 'ok') return 'titulaire = nom vérifié sur la pièce d’identité';
    if (c === 'partial') return 'Titulaire partiel : des prénoms ne correspondent pas (' + x.ibanHolder + ' ≠ ' + x.verifiedName + ') — vérifie que c’est bien le diffuseur';
    if (c === 'paypal') return 'nom vérifié sur la pièce : ' + x.verifiedName + ' (vérifie que le compte PayPal est à ce nom avant d’envoyer)';
    if (c === 'none') return 'aucun nom vérifié sur la pièce d’identité : vérifie le titulaire avant de payer';
    return 'titulaire « ' + (x.ibanHolder || '—') + ' » ≠ nom vérifié sur la pièce « ' + x.verifiedName + ' » : BloxAI ne verse rien à un tiers (contrat art. 9.2), vérifie avant de payer';
  }
  // 18/10 (round 6, R2) : nom vérifié sur la pièce ↔ nom légal déclaré à la 1re acceptation des conditions (non modifiable :
  // un voleur de session qui fait valider SA pièce ne peut pas le réécrire). null = BloxAI ne l'envoie pas (ancienne
  // version : rien d'affiché) ; 'nover' = aucun nom vérifié (déjà signalé) ; 'none' = aucun nom déclaré ; 'ok' = mêmes
  // mots (sans accents, casse ni ordre) ; 'diff' = autre chose (même un prénom en plus ou en moins : à vérifier).
  function bxDeclCheck(x) {
    if (!x.declaredKnown) return null;
    if (!bxNameWords(x.verifiedName).length) return 'nover';
    if (!bxNameWords(x.declaredFirst).length) return 'none';
    return bxNameSame(x.verifiedName, x.declaredFirst) ? 'ok' : 'diff';
  }
  function bxDeclText(x) {
    var c = bxDeclCheck(x);
    if (c === 'ok') return 'nom vérifié = nom légal déclaré à la 1re acceptation des conditions';
    if (c === 'none') return 'aucun nom légal déclaré à la 1re acceptation des conditions : compare la pièce avec le diffuseur avant de payer';
    if (c === 'diff') return 'nom vérifié sur la pièce « ' + x.verifiedName + ' » ≠ nom légal déclaré à la 1re acceptation des conditions « ' + x.declaredFirst + ' » : pièce d’une autre personne ? Vérifie avant de payer';
    return '';
  }
  // nom déclaré modifié depuis la 1re acceptation des conditions (texte, '' sinon)
  function bxDeclMoved(x) {
    return x.declaredFirst && x.declaredCurrent && !bxNameSame(x.declaredFirst, x.declaredCurrent)
      ? 'nom déclaré modifié depuis la 1re acceptation des conditions : « ' + x.declaredCurrent + ' » (1re acceptation : « ' + x.declaredFirst + ' »)' : '';
  }
  // 18/10 (round 6, R1a) : comparaison avec le DERNIER VERSEMENT PAYÉ, quel que soit l'état du délai de 72 h (le voleur de
  // session attend la fin du délai : plus aucun « modifiées récemment » quand le versement apparaît). Destination
  // normalisée : IBAN sans espaces en majuscules (+ titulaire, mots sans accents ni casse), PayPal en minuscules.
  function bxDestKey(d) {
    if (!d || !d.method) return null;
    if (d.method === 'paypal') return 'paypal:' + String(d.paypal || '').trim().toLowerCase();
    return 'iban:' + String(d.iban || '').replace(/\s+/g, '').toUpperCase() + '|' + bxNameWords(d.holder).join(' ');
  }
  function bxDestShow(d) {
    return d.method === 'paypal' ? 'PayPal · ' + (d.paypal || '—')
      : 'IBAN · ' + (d.holder ? d.holder + ' · ' : '') + bxIban(String(d.iban || '—').replace(/\s+/g, '').toUpperCase());
  }
  // { first, changed, dest, destUnknown } ou null (BloxAI sans last_paid_at : rien d'affiché, jamais « premier versement »
  // à tort). first = aucun versement payé avant ; changed = coordonnées ou mot de passe changés depuis le dernier payé ;
  // dest = destination ≠ celle du dernier payé ; destUnknown = dernier payé sans destination figée (versement ancien)
  function bxPaidHist(x) {
    if (!x.paidKnown) return null;
    if (x.lastPaidAt == null) return { first: true, changed: false, dest: false, destUnknown: false };
    var a = bxDestKey(x.destRaw), b = bxDestKey(x.lastPaid);
    return { first: false, changed: !!x.changedSincePaid, dest: !!(a && b && a !== b), destUnknown: !b };
  }
  // quoi a changé à changed_at : mot de passe, ou payout_updated_at (18/10 : BloxAI le pose aussi au dépôt d'une pièce
  // d'identité et quand le nom légal change : « coordonnées de versement, pièce ou nom légal changés ») ; changed_at = le plus récent
  function bxChangedWhat(x) {
    return x.changedAt == null ? '' : x.passwordChanged === x.changedAt ? 'mot de passe changé' : x.payoutUpdated === x.changedAt ? 'coordonnées de versement, pièce ou nom légal changés'
      : x.emailChanged === x.changedAt ? 'adresse e-mail changée' : '';   // 18/10 (round 7, R7-4)
  }
  function bxAtText(t) { var d = new Date(t); return dmy(d) + ' à ' + hm(d); }
  // phrases pour la ligne de versement, l'Accueil et « Marquer payé » (tableau de textes, vide = rien à signaler)
  function bxPaidTexts(x) {
    var h = bxPaidHist(x), out = [];
    if (!h) return out;
    var what = bxChangedWhat(x);
    if (h.first) {
      out.push(['first', 'Premier versement à ce diffuseur : vérifie la pièce et le titulaire'
        + (x.changedAt != null ? ' (' + (what || 'coordonnées, mot de passe ou adresse e-mail changés') + ' le ' + bxAtText(x.changedAt) + ')' : '')]);
      return out;
    }
    var paid = ' (le ' + dmy(new Date(x.lastPaidAt)) + ')';
    if (h.changed) out.push(['changed', 'Coordonnées, mot de passe ou adresse e-mail changés ' + (x.changedAt != null ? 'le ' + bxAtText(x.changedAt) + ' ' : '')
      + 'depuis le dernier versement payé' + paid + (what ? ' : ' + what : '') + ' ; en cas de doute, confirme avec le diffuseur par un autre canal']);
    if (h.dest) out.push(['dest', 'Destination différente du dernier versement payé' + paid + ' : ' + bxDestShow(x.lastPaid)]);
    else if (h.destUnknown) out.push(['destUnknown', 'Destination du dernier versement payé' + paid + ' inconnue (versement d’avant le gel des destinations) : vérifie que c’est bien le compte du diffuseur']);
    return out;
  }
  function bxPayPaid(id) {
    var D = CF.bx.data, x = D && bxDlg(bxFind(D.money.payouts, id));   // 18/10 (R7-10) : noms nettoyés pour la fenêtre
    if (!x) return;
    var dest = bxPayDest(x), nc = bxNameCheck(x), rc = bxRecent(x), dc = bxDeclCheck(x), dm = bxDeclMoved(x);
    // 18/10 (round 6) : titulaire partiel (R4), nom légal déclaré à la 1re acceptation (R2), depuis le dernier versement
    // payé — premier versement, coordonnées ou mot de passe changés, destination différente — quel que soit le délai (R1a)
    var paid = bxPaidTexts(x).map(function (p) { return (p[0] === 'dest' ? 'ATTENTION : ' : 'Attention : ') + p[1] + '.\n'; }).join('');
    // 18/10 (round 7, R7-5) : BloxAI ne bloque pas « Marquer payé » d'un versement d'un diffuseur GELÉ (créé avant le gel) :
    // confirmation explicite d'abord ; Annuler → rien
    if (x.payFrozen && !window.confirm('Diffuseur gelé : les versements de ' + (x.name || 'ce diffuseur') + ' sont gelés' + (x.payFrozenReason ? ' (motif : ' + x.payFrozenReason + ')' : '')
      + '.\nCe versement de ' + fEur(x.amount) + ' a été créé avant le gel. Le marquer payé quand même ?\n(Sinon : Annuler, puis « Annuler ce versement » ou « Dégeler ».)')) return;
    var ref = bxAsk('Versement de ' + fEur(x.amount) + ' à ' + (x.name || 'ce diffuseur') + ' envoyé ?\n'
      + (dest ? 'Destination' + (x.frozen ? ' figée à la demande' : '') + ' : ' + dest + '\n' : '')
      // 18/10 (round 7, R7-5) : versements du diffuseur gelés par Axel
      + (x.payFrozen ? 'ATTENTION : les versements de ce diffuseur sont GELÉS' + (x.payFrozenReason ? ' (motif : ' + x.payFrozenReason + ')' : '') + ' : ne paie pas sans avoir levé le doute (sinon : Annuler ce versement).\n' : '')
      + (x.verifiedName ? 'Nom vérifié sur la pièce d’identité : ' + x.verifiedName + '\n' : '')
      + (nc === 'diff' ? 'ATTENTION : le titulaire (' + (x.ibanHolder || '—') + ') ne correspond pas au nom vérifié sur la pièce (' + x.verifiedName + '). BloxAI ne verse rien à un tiers (contrat art. 9.2) : ne paie pas sans avoir vérifié.\n'
        : nc === 'partial' ? 'Attention : ' + bxNameText(x) + ' (contrat art. 9.2 : rien à un tiers).\n'
        : nc === 'none' ? 'Attention : aucun nom vérifié sur la pièce d’identité de ce diffuseur, vérifie le titulaire avant de payer.\n' : '')
      + (x.declaredFirst ? 'Nom légal déclaré à la 1re acceptation des conditions : ' + x.declaredFirst + '\n' : '')
      + (dc === 'diff' ? 'ATTENTION : le nom vérifié sur la pièce (' + x.verifiedName + ') ne correspond pas au nom légal déclaré à la 1re acceptation des conditions (' + x.declaredFirst + ') : pièce d’une autre personne ? Ne paie pas sans avoir vérifié.\n'
        : dc === 'none' ? 'Attention : aucun nom légal déclaré à la 1re acceptation des conditions.\n' : '')
      + (dm ? 'Attention : ' + dm + '.\n' : '')
      + (x.detailsChanged ? 'Attention : le diffuseur a changé ses coordonnées depuis la demande, paie bien la destination ci-dessus.\n' : '')
      + (rc ? 'Attention : ' + bxRecentText(rc) + '. Paie la destination figée ci-dessus ; en cas de doute, confirme avec le diffuseur par un autre canal.\n' : '')
      + paid
      + 'Référence du virement (facultatif), puis OK :');
    if (ref == null) return;
    bxRun('pay:' + id, { op: 'admin_payout_paid', id: id, reference: ref.slice(0, 120) }, 'Versement de ' + fEur(x.amount) + ' marqué payé (' + (x.name || 'diffuseur') + ').');
  }
  // 18/10 (round 7, R7-5) : « Annuler ce versement » — motif obligatoire PUIS confirmation ; BloxAI passe le versement en
  // 'cancelled' (motif gardé) et le montant revient au solde du diffuseur (rien n'est envoyé). Sans gel, BloxAI en recréera
  // un au prochain passage : la confirmation le dit.
  function bxPayCancel(id) {
    var D = CF.bx.data, x = D && bxDlg(bxFind(D.money.payouts, id));
    if (!x) return;
    var who = x.name || 'ce diffuseur', dest = bxPayDest(x), K = 'pay:' + id;
    if (x.status !== 'requested' && x.status !== 'pending') { bxSay(false, 'Versement de ' + fEur(x.amount) + ' à ' + who + ' : seul un versement encore à faire peut être annulé.', K); return; }
    var why = bxAsk('Annuler le versement de ' + fEur(x.amount) + ' à ' + who + ' ?\n' + (dest ? 'Destination figée : ' + dest + '\n' : '')
      + 'Rien n’est envoyé : le montant revient au solde du diffuseur.\nMotif (obligatoire, gardé avec le versement ; le diffuseur le verra) :');
    if (why == null) return;
    if (!why) { bxSay(false, 'Motif obligatoire pour annuler un versement.', K); return; }
    if (!window.confirm('Confirmer l’annulation du versement de ' + fEur(x.amount) + ' à ' + who + ' ?\nMotif : ' + dlgName(why, 300) + '\n'
      + (x.payFrozen ? 'Ses versements restent gelés : aucun nouveau versement tant que tu ne les dégèles pas.' : 'Le montant revient à son solde : BloxAI créera un nouveau versement au prochain passage, sauf si tu gèles ses versements.'))) return;
    bxRun(K, { op: 'admin_payout_cancel', id: id, reason: why.slice(0, 300) }, 'Versement de ' + fEur(x.amount) + ' à ' + who + ' annulé : le montant revient à son solde.'
      + (x.payFrozen ? '' : ' Pour qu’aucun nouveau versement ne soit créé, gèle ses versements.'));
  }
  // 18/10 (round 7, R7-5) : « Geler les versements » (motif obligatoire, lisible par le diffuseur sur son profil) / « Dégeler »
  // (confirmation : bx_admin_freeze efface le motif au dégel) — gelé : BloxAI ne crée plus aucun versement (BX_FROZEN) ; ses
  // gains restent comptés (versement de la période créé après le dégel) ; les versements déjà ouverts restent à annuler à part
  function bxFreeze(uid, on) {
    var D = CF.bx.data, M = D ? D.money : null;
    var row = M ? (M.payouts || []).filter(function (x) { return x.userId === uid; })[0] || (M.deferred || []).filter(function (x) { return x.userId === uid; })[0] : null;
    if (!row || !row.freezeKnown) return;
    var x = bxDlg(row), who = x.name || 'ce diffuseur', K = 'frz:' + uid, open = (M.payouts || []).filter(function (p) { return p.userId === uid && (p.status === 'requested' || p.status === 'pending'); });
    if (!on) {
      if (!window.confirm('Dégeler les versements de ' + who + ' ?' + (x.payFrozenReason ? '\nGelés pour : ' + x.payFrozenReason : '') + '\nBloxAI pourra de nouveau créer ses versements (au prochain passage).')) return;
      bxRun(K, { op: 'admin_freeze', user: uid, on: false }, 'Versements de ' + who + ' dégelés : BloxAI pourra de nouveau créer ses versements.');
      return;
    }
    var why = bxAsk('Geler les versements de ' + who + ' ?\nBloxAI ne créera plus aucun versement pour ce diffuseur tant que tu ne les dégèles pas (ses gains restent comptés).'
      + (open.length ? '\n' + open.length + ' ' + plural(open.length, 'versement déjà ouvert', 'versements déjà ouverts') + ' : à annuler à part (« Annuler ce versement »), sinon ' + plural(open.length, 'il reste', 'ils restent') + ' à payer.' : '')
      + '\nMotif (obligatoire ; le diffuseur le verra sur son profil) :', 'Vérification en cours');
    if (why == null) return;
    if (!why) { bxSay(false, 'Motif obligatoire pour geler les versements.', K); return; }
    bxRun(K, { op: 'admin_freeze', user: uid, on: true, reason: why.slice(0, 300) }, 'Versements de ' + who + ' gelés : BloxAI ne crée plus aucun versement pour ce diffuseur.');
  }
  // 18/10 (round 7, R7-6) : une ligne par alerte e-mail non partie (date, alerte, diffuseur, cause)
  // reason = texte français de la fonction notif (affiché tel quel) ; type parfois null (alerte non reconnue) ; status = code HTTP
  var BX_NOTIF_T = { payout_changed: 'moyen de paiement modifié', password_changed: 'mot de passe modifié', email_changed: 'adresse e-mail modifiée' };
  function bxNotifLine(f) {
    var why = f.status === 503 ? 'clé Resend absente (503)' : f.status === 429 ? 'limite d’envoi atteinte (429)' : f.status != null ? 'HTTP ' + f.status : '';
    return [f.at != null ? dmy(new Date(f.at)) + ' à ' + hm(new Date(f.at)) : 'date inconnue', f.type ? 'alerte « ' + (BX_NOTIF_T[f.type] || f.type) + ' »' : 'alerte',
      f.name || 'diffuseur', f.reason || '', why].filter(Boolean).join(' · ');
  }
  // Date de naissance JJ/MM/AAAA (ou AAAA-MM-JJ) → AAAA-MM-JJ, date réelle entre 1900 et aujourd'hui, sinon null
  function bxBirth(v) {
    var m = /^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{4})$/.exec(v), iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    var y = m ? +m[3] : iso ? +iso[1] : 0, mo = m ? +m[2] : iso ? +iso[2] : 0, d = m ? +m[1] : iso ? +iso[3] : 0;
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (!y || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || y < 1900 || t.getTime() > Date.now()) return null;
    return y + '-' + p2(mo) + '-' + p2(d);
  }
  function bxIdDecide(id, d) {
    var D = CF.bx.data, x = D && bxDlg(bxFind(D.identity, id));   // 18/10 (R7-10) : noms nettoyés pour les fenêtres
    if (!x) return;
    var who = x.name || 'ce diffuseur', K = 'id:' + id;
    if (d === 'verified') {
      // 18/10 (round 6, R2) : les deux noms déclarés, à comparer avec la pièce AVANT de valider (un voleur de session peut
      // envoyer SA pièce ; le nom de la 1re acceptation des conditions, lui, ne se réécrit pas)
      var decl = !x.declaredKnown ? ''
        : x.declaredFirst ? 'Nom légal déclaré à la 1re acceptation des conditions : ' + x.declaredFirst + '\nNom déclaré actuel : ' + (x.declaredCurrent || '—')
          + (x.declaredCurrent && !bxNameSame(x.declaredFirst, x.declaredCurrent) ? ' (modifié depuis la 1re acceptation)' : '')
          + '\nCompare ces noms avec la pièce : si elle est au nom d’une autre personne, Annuler puis Refuser.\n'
        : 'Aucun nom légal déclaré à l’acceptation des conditions : compare la pièce avec le diffuseur avant de valider.\n';
      var v = bxAsk('Valider la pièce d’identité de ' + who + '.\n' + decl + 'Date de naissance lue sur la pièce (JJ/MM/AAAA) :');
      if (v == null) return;
      var iso = bxBirth(v);
      if (!iso) { bxSay(false, 'Date de naissance invalide : tape par exemple 21/03/2004.', K); return; }
      // 17/10 (contrat 7, art. 4.2) : le titulaire du compte est toujours un adulte — validation refusée sous 18 ans (BloxAI
      // et l'edge la refusent aussi) ; âge révolu au jour près
      var b = iso.split('-').map(Number), n = new Date(), age = n.getFullYear() - b[0] - ((n.getMonth() + 1 < b[1] || (n.getMonth() + 1 === b[1] && n.getDate() < b[2])) ? 1 : 0);
      if (age < 18) { bxSay(false, 'Pièce de ' + who + ' : ' + age + ' ans. Moins de 18 ans : validation impossible (contrat art. 4.2, un mineur participe seulement via le compte d’un adulte). Refuse-la avec ce motif.', K); return; }
      // 17/10 (round 5, contrat 9) : nom lu sur la pièce (verified_name), comparé au titulaire de l'IBAN avant chaque
      // versement ; obligatoire pour valider (l'edge bloxai le refuse aussi sans nom)
      var nm = bxAsk('Valider la pièce d’identité de ' + who + ' (' + age + ' ans).\nNom et prénom(s) lus sur la pièce, tels qu’écrits (comparés au titulaire de l’IBAN avant chaque versement) :'
        + (x.declaredFirst ? '\n(nom légal déclaré à la 1re acceptation des conditions : ' + x.declaredFirst + ')' : ''));
      if (nm == null) return;
      nm = nm.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();   // 17/10 : mêmes caractères écartés que factory
      if (nm.length < 2 || nm.length > 120 || !/\p{L}/u.test(nm)) { bxSay(false, 'Nom lu sur la pièce obligatoire pour valider (2 à 120 caractères), par exemple : Léa Martin.', K); return; }
      // 18/10 (round 6, R2) : nom lu ≠ nom légal de la 1re acceptation (sans accents, casse ni ordre des mots) → confirmation
      if (x.declaredFirst && !bxNameSame(nm, x.declaredFirst)
        && !window.confirm('ATTENTION : le nom lu sur la pièce (' + nm + ') ne correspond pas au nom légal déclaré à la 1re acceptation des conditions (' + x.declaredFirst + ').\n'
          + 'Pièce d’une autre personne (session volée ?) : dans le doute, Annuler puis Refuser la pièce. Un prénom en plus ou en moins sur la pièce peut être normal : vérifie.\n\nValider quand même ?')) return;
      bxRun(K, { op: 'admin_identity', id: id, status: 'verified', birthdate: iso, name: nm }, bxIdAfter(id, 'Pièce validée pour ' + who + ' (' + age + ' ans)'));
    } else {
      var why = bxAsk('Refuser la pièce d’identité de ' + who + '.\nMotif (le diffuseur le verra) :');
      if (why == null) return;
      if (!why) { bxSay(false, 'Motif obligatoire pour refuser.', K); return; }
      bxRun(K, { op: 'admin_identity', id: id, status: 'refused', reason: why.slice(0, 300) }, bxIdAfter(id, 'Pièce refusée pour ' + who));
    }
  }
  // 17/10 (contrat 6) : la copie de la pièce est-elle vraiment supprimée ? false / inconnu → avertissement, jamais « supprimée »
  // 18/10 (round 7, R7-16) : « image détruite » seulement quand BloxAI le confirme (file_deleted === true : fichier supprimé
  // du stockage identity et file_deleted_at posé par factory dans la même opération)
  function bxIdDone(head, r) {
    if (r.fileDeleted === true) return head + ' · image détruite (copie supprimée du stockage BloxAI).';
    if (r.fileDeleted === false) return { ok: false, text: head + ', mais l’image n’est PAS encore détruite : suppression en attente, nouvel essai automatique côté BloxAI. Vérifie qu’elle disparaît (contrat art. 4.4 : 7 jours au plus).' };
    return { ok: false, text: head + ' · destruction de l’image non confirmée par BloxAI : vérifie que la copie a bien disparu.' };
  }
  // 18/10 (round 7, R7-16) : après la décision — aperçu oublié tout de suite (plus aucune URL de la pièce gardée), décision
  // notée pour le bloc de l'Accueil (10 min) avec la réponse réelle de BloxAI sur la destruction de l'image
  function bxIdAfter(id, head) {
    return function (r) {
      delete ui.bx.idPrev[id];
      ui.bx.idDone = [{ id: id, head: head, fd: r.fileDeleted, at: Date.now() }].concat((ui.bx.idDone || []).filter(function (d) { return d.id !== id; })).slice(0, 10);
      return bxIdDone(head, r);
    };
  }
  // Voir une pièce : l'onglet s'ouvre DANS le clic (Safari bloque window.open après un await), puis l'URL signée (300 s) y est chargée
  function bxIdView(id) {
    var k = 'idv:' + id;
    if (ui.bx.busy[k]) return;
    var w = window.open('about:blank', '_blank');
    if (!w) { bxSay(false, 'Popup bloquée : autorise les popups pour avatarads.fr puis réessaie.', k); return; }
    try { w.opener = null; } catch (e) { /* rien */ }
    ui.bx.busy[k] = 1; ui.bx.msg = null; schedule();
    CF.bxIdentityUrl(id).then(function (r) {
      delete ui.bx.busy[k];
      if (r && r.ok) { try { w.location.replace(r.url); } catch (e) { w.location.href = r.url; } }
      else { try { w.close(); } catch (e) { /* rien */ } bxSay(false, 'Pièce illisible : ' + ((r && r.error) || 'erreur inconnue'), k); }
      schedule();
    });
  }
  function bxMission(vf, d) {
    if (!/^VF-\d{4}$/.test(vf || '') || (d !== 'retire' && d !== 'reopen')) return;
    // retire : seulement une vidéo encore « open » ; reopen : seulement une vidéo retirée à la main, jamais une vidéo du kit
    // (son fichier du stock peut déjà être libéré par factory-release). Le proxy bloxai revérifie sur l'état relu à l'instant.
    var E = CF.bx.data && CF.bx.data.byVf[vf], KV = CF.prod.data ? CF.prod.data.qc.kitVfs : null;
    if (!E || E.status !== (d === 'retire' ? 'open' : 'retired')) { bxSay(false, vf + ' : action impossible dans son état actuel, actualise BloxAI.'); return; }
    if (d === 'reopen' && KV && KV.vfs[vf]) { bxSay(false, vf + ' est dans le kit d’Axel : jamais remise dans le stock commun.'); return; }
    if (!window.confirm(d === 'retire' ? 'Retirer ' + vf + ' du stock commun ?\nElle ne sera plus proposée, ni au kit ni aux diffuseurs.' : 'Remettre ' + vf + ' dans le stock commun ?')) return;
    bxRun('vf:' + vf, { op: 'admin_mission', vf: vf, decision: d }, d === 'retire' ? vf + ' retirée du stock commun.' : vf + ' remise dans le stock commun.');
  }

  // ── onglets pas encore branchés ──
  function soonHTML(k) {
    var s = SOON[k];
    return '<section class="cf-title"><h1>' + esc(s.h) + '</h1>'
      + (s.date ? '<div class="cf-sub">' + esc(longDate(new Date())) + '</div>' : '') + '</section>'
      + '<section class="cf-card cf-soon"><span class="cf-soon-ic">' + svg(IC.clock, 18) + '</span>'
      + '<div class="cf-soon-b"><div class="cf-soon-t">Bientôt branché · étape ' + s.step + ' du plan</div>'
      + '<p>' + esc(s.what) + '</p>'
      + '<p class="cf-dim">Rien n’est affiché ici tant que la source n’est pas branchée : pas de chiffre d’exemple.</p></div></section>';
  }

  // ── sélection du compte Instagram (Axel 28/09 : un compte par avatar) ──
  // Pseudo(s) affiché(s) : « avataradss », « leoadsia » ou « avataradss + @leoadsia » pour « Les deux ».
  function selName() { var p = CF.acct.accounts.primary; return (p && p.username) || CF.PRIMARY_USERNAME; }
  // Un bouton par compte, qu'on active ou désactive (Axel 28/09) : les deux actifs = chiffres additionnés (CF.igSel 'all'),
  // un seul = ce compte uniquement. Le dernier compte actif ne se désactive pas (jamais un tableau vide).
  // Affiché seulement quand au moins deux de nos comptes sont reliés.
  function selIds() {
    var own = CF.acct.accounts.own || [];
    return CF.igSel === 'all' ? own.map(function (a) { return a.ig_id; }) : String(CF.igSel).split(',').filter(Boolean);
  }
  function toggleAcct(id) {
    var own = CF.acct.accounts.own || [], cur = selIds(), next;
    // 06/10 : n'importe quel sous-ensemble des 3 comptes (« id1,id2 »), dans l'ordre des cartes
    next = own.map(function (a) { return a.ig_id; }).filter(function (x) { return x === id ? cur.indexOf(id) < 0 : cur.indexOf(x) >= 0; });
    if (!next.length) return false;
    return CF.setIgSel(next.length >= own.length ? 'all' : next.join(','));
  }
  // Cartes de compte (Axel 28/09) : une par avatar sur toute la largeur (@avataradss à gauche, @leoadsia à droite), au
  // style des cartes de chiffres. Toucher une carte la coche / décoche : les deux cochées = chiffres additionnés, une seule
  // = ce compte uniquement ; la dernière cochée ne se décoche pas. Compte à nous pas encore relié : carte en pointillés +
  // « Connecter @x ». « Reconnecter » seulement sur un compte au token expiré ou qui expire sous 7 jours (ou refusé par
  // Instagram quand il est seul affiché). Insight et Auto-DM ; l'Accueil affiche toujours les deux comptes.
  var ACCT_C = ['var(--cf-accent)', 'var(--cf-c-posts)', 'var(--cf-c-inter)'];
  var ACCT_AV = { avataradss: 'A1', leoadsia: 'A2', 'ialebd.axel': 'A1 + A2' };
  function igSelHTML(broken) {
    var A = CF.acct.accounts, own = A.own || [], on = selIds();
    if (A.state !== 'ready' && !own.length) return '';
    return '<section class="cf-accts" aria-label="Comptes Instagram affichés"><div class="cf-icards cf-acards">' + CF.OWN_USERNAMES.map(function (u, i) {
      var a = own.filter(function (x) { return String(x.username || '').toLowerCase() === u; })[0];
      var c = ACCT_C[i % ACCT_C.length], av = ACCT_AV[u] ? 'avatar ' + ACCT_AV[u] : '';
      if (!a) {
        return '<div class="cf-icard cf-acard is-none" style="--c:' + c + '">'
          + '<span class="cf-icard-h"><span class="cf-icard-tile">' + svg(IC.insta, 14) + '</span><span class="cf-icard-l">@' + esc(u) + '</span></span>'
          + '<span class="cf-icard-v is-na">—</span><span class="cf-icard-s">pas encore relié' + (av ? ' · ' + esc(av) : '') + '</span>'
          + '<button type="button" class="cf-btn is-sm cf-acard-btn" data-act="connect-acct" data-k="' + esc(u) + '" title="' + esc('Ouvre Instagram : connecte-toi avec @' + u + ' avant de valider') + '">' + svg(IC.insta, 13) + '<span>Connecter<span class="cf-acard-u"> @' + esc(u) + '</span></span></button>'
          + '</div>';
      }
      var o = on.indexOf(a.ig_id) >= 0, last = o && on.length === 1, st = CF.acctStats[a.ig_id] || {}, tok = tokenInfo(a);
      var pic = safeUrl(st.picture || (CF.igSel === a.ig_id ? profilePic() : '') || '');
      var tone = !tok ? '' : tok.expired ? ' is-err' : tok.days < 7 ? ' is-warn' : '';
      var bad = !!tone || (broken && CF.igSel === a.ig_id);
      var extra = [av, st.media != null ? fInt(st.media) + ' ' + plural(st.media, 'publication') : ''].filter(Boolean).join(' · ');
      var tokTxt = tok ? (tok.expired ? 'token expiré le ' + dmy(tok.date) : 'token ' + tok.days + NB + 'j') : '';
      return '<div class="cf-icard cf-acard' + (o ? ' is-on' : ' is-off') + '" style="--c:' + c + '">'
        + '<button type="button" class="cf-acard-hit" data-act="ig-sel" data-k="' + esc(a.ig_id) + '" aria-pressed="' + o + '"'
        + ' aria-label="' + esc('@' + a.username + (o ? ' affiché' : ' masqué')) + '" title="' + esc(last ? 'Au moins un compte reste affiché' : (o ? 'Retirer' : 'Ajouter') + ' @' + a.username + ' des chiffres') + '"></button>'
        + '<span class="cf-icard-h"><span class="cf-icard-tile cf-acard-pic">' + (pic ? '<img src="' + esc(pic) + '" alt="" referrerpolicy="no-referrer" decoding="async">' : svg(IC.insta, 14)) + '</span>'
        + '<span class="cf-icard-l">@' + esc(a.username) + '</span>'
        + '<span class="cf-icard-ck" aria-hidden="true">' + (o ? svg('M5 12l5 5L20 7', 10) : '') + '</span></span>'
        + '<span class="cf-icard-v' + (st.followers == null ? ' is-na' : '') + '">' + esc(st.followers == null ? '—' : fInt(st.followers)) + '<span class="cf-acard-unit">abonnés</span></span>'
        + '<span class="cf-icard-s cf-acard-s">' + esc(extra) + (tokTxt ? (extra ? ' · ' : '') + '<b class="cf-acard-tok' + tone + '">' + esc(tokTxt) + '</b>' : '') + '</span>'
        + (bad ? '<button type="button" class="cf-btn is-sm cf-acard-btn" data-act="connect-acct" data-k="' + esc(u) + '">' + svg(IC.refresh, 13) + '<span>Reconnecter</span></button>' : '')
        + '</div>';
    }).join('') + '</div></section>';
  }
  // Insight / Auto-DM : l'Accueil affiche toujours les deux comptes ; les deux onglets reprennent le choix mémorisé.
  function syncSel() {
    var want = ui.tab === 'home' ? 'all' : (CF.igPick() || 'all');
    if (want !== CF.igSel) CF.setIgSel(want, { temp: ui.tab === 'home' });
  }
  function titleSel(h) { return '<section class="cf-title"><h1>' + esc(h) + '</h1></section>'; }

  // Photo du profil : celle des insights ou, à défaut, celle des publications (onglet Auto-DM ouvert en premier).
  function profilePic() {
    var D = igData(), M = CF.acct.media.data;
    return safeUrl((D && D.picture) || (M && M.picture) || '');
  }

  // ── onglet Compte (compte(s) sélectionné(s)) ──
  function compteHTML() {
    var S = CF.acct.ig[ui.range], D = S.data, off = S.kind === 'disconnected';
    var X = model(S, D, off, ui.range);
    return titleSel('Insight Instagram')
      + acctHTML(D)
      + insightsHTML(S, D, off, X)
      + goalsHTML(X)
      + topHTML(off)
      + audienceHTML(D, off)
      + repHTML(S, D, off);
  }

  function acctHTML(D) {
    var A = CF.acct.accounts, st = igState();
    return igSelHTML(st.tone === 'err' || CF.acct.ig[ui.range].kind === 'disconnected')
      + (A.state === 'error' ? '<div class="cf-acct-why">comptes reliés : ' + esc(A.error) + ' <button type="button" class="cf-link-btn" data-act="retry-accounts">Réessayer</button></div>' : '')
      + reconMsg();
  }

  // Résultat de « Reconnecter » (carte compte des onglets Insight et Auto-DM).
  function reconMsg() {
    var msg = '', oa = CF.oauth;
    if (oa && Date.now() - oa.at < 10 * 60 * 1000 && (!ui.recon || oa.at >= ui.recon.at)) {
      msg = !oa.ok
        ? '<div class="cf-acct-msg is-err">Reconnexion échouée : ' + esc(oa.error) + '</div>'
        : (oa.username && CF.OWN_USERNAMES.indexOf(oa.username.toLowerCase()) < 0)
          ? '<div class="cf-acct-msg is-err">@' + esc(oa.username) + ' relié, mais ce n’est pas un de nos comptes (@' + esc(CF.OWN_USERNAMES.join(', @')) + ') : le tableau de bord ne l’affiche pas.</div>'
          : '<div class="cf-acct-msg is-ok">Connexion réussie' + (oa.username ? ' : @' + esc(oa.username) : '') + '.'
            + (CF.acct.accounts.loading || CF.acct.ig[ui.range].loading ? ' Relecture en cours…' : ' Chiffres relus.') + '</div>';
    } else if (ui.recon) {
      msg = '<div class="cf-acct-msg is-' + (ui.recon.ok ? 'info' : 'err') + '">' + esc(ui.recon.text) + '</div>';
    }
    return msg;
  }

  function periodLine(S, D) {
    var P = PERIOD[ui.range], txt;
    if (D && D.dayFirst && D.dayLast) {
      var n = nDays(D.dayFirst, D.dayLast);
      txt = dm(ymdDate(D.dayFirst)) + ' → ' + dmy(ymdDate(D.dayLast)) + ' · ' + n + ' ' + plural(n, 'jour') + ' Instagram, aujourd’hui compris'
        + (ui.range === 'all' ? ' · depuis la 1re publication' : '');
    } else if (D && D.since != null && D.until != null) {
      var s0 = new Date(D.since), u0 = new Date(D.until);
      txt = dm(s0) + ' ' + hm(s0) + ' → ' + dm(u0) + ' ' + hm(u0);
    } else {
      txt = P.per;
    }
    var when = D ? ' · relevé à ' + hm(new Date(D.fetchedAt)) + (S.state === 'error' ? ' (actualisation échouée)' : '') : '';
    return '<span class="cf-over">Période sélectionnée</span> ' + esc(txt + when);
  }

  function insightsHTML(S, D, off, X) {
    var seg = PERIODS.map(function (p) {
      var on = p.k === ui.range;
      return '<button type="button" class="cf-seg-b' + (on ? ' is-on' : '') + '" data-act="range" data-range="' + p.k + '" aria-pressed="' + on + '">' + esc(p.label) + '</button>';
    }).join('');
    return '<section class="cf-sec" aria-labelledby="cfInsT">'
      + '<div class="cf-sec-h"><div><h2 class="cf-h2" id="cfInsT">Insights du compte</h2></div>'
      + '<div class="cf-seg" role="group" aria-label="Période">' + seg + '</div></div>'
      + '<div class="cf-per">' + periodLine(S, D) + '</div>'
      + slotBanner(S, D)
      + '<div class="cf-icards">' + cardsHTML(X) + '</div>'
      + evoHTML(S, D, off, X)
      + '</section>';
  }

  // ── Objectifs (maquette d'Axel) : moyenne des reels de la période, barre = chemin vers l'objectif ──
  // Valeur d'un objectif sur la période du modèle X, calculée à UN seul endroit : la section Objectifs et la carte
  // Insight de l'Accueil lisent cette fonction (jamais deux calculs du même chiffre).
  function goalValue(X, g) {
    var R = X.reels, v = null, n = 0, sub = null, na = null;
    if (g.k === 'perDay') {
      if (R && X.nDays) { v = R.length / X.nDays; n = R.length; }
      sub = R ? n + ' ' + plural(n, 'reel') + ' ' + X.per : null;
    } else if (R) {
      var vals = R.map(function (p) { return rateOf(p, g); }).filter(function (x) { return x != null; });
      n = vals.length;
      v = n ? vals.reduce(function (a, b) { return a + b; }, 0) / n : null;
      // « moyenne de 14 reels · 1/14 atteint » (l'objectif est dans le titre de la carte)
      var scored = R.filter(function (p) { return scoreOf(p, g) != null; }), hit = scored.filter(function (p) { return goalOk(g, scoreOf(p, g)); }).length;
      sub = n ? 'moyenne de ' + n + ' ' + plural(n, 'reel') + (g.target != null && scored.length ? ' · ' + hit + '/' + scored.length + ' ' + plural(hit, 'atteint') : '') : '';
      if (!n) na = R.length ? 'non fourni pour ces reels' : 'aucun reel publié ' + X.per;
    }
    if (v == null && !na) na = X.off ? 'compte déconnecté' : (R ? 'aucun reel publié ' + X.per : X.mediaWhy);
    var dur = g.k === 'watch' && R && v != null ? meanDur(R) : null;   // « sur combien » : durée moyenne des mêmes reels
    var sc = g.k === 'watch' ? (dur ? v / dur * 100 : null) : v;       // ce qui est comparé à la cible
    if (dur) sub = fDec(sc, 0) + NB + '% regardé';
    return { v: v, n: n, sub: sub, na: na, dur: dur, sc: sc, val: v == null ? '—' : g.pct ? fRate(v) : g.sec ? fSec(v) : fDec(v, 1),
      loading: X.pending || (!R && !X.off && CF.acct.media.state !== 'error' && !(CF.acct.media.data)) };
  }
  function goalsHTML(X) {
    var cards = GOALS.map(function (g) {
      var G = goalValue(X, g), loading = G.loading, v = G.v, sub = G.sub, na = G.na, dur = G.dur, sc = G.sc;
      var ok = goalOk(g, sc), fill = sc == null || g.target == null ? 0 : g.max ? (sc <= g.target ? 1 : g.target / sc) : Math.min(1, sc / g.target);
      var val = loading ? '…' : G.val;
      var tgt = g.target == null ? '' : 'objectif ' + (g.k === 'perDay' ? g.target + ' / jour' : (g.max ? '≤ ' : '≥ ') + g.target + NB + '%');
      return '<div class="cf-goal' + (ok ? ' is-ok' : '') + '" data-goal="' + g.k + '">'
        + '<span class="cf-goal-tile">' + svg(IC[g.ic], 16) + '</span>'
        + '<span class="cf-goal-l">' + esc(g.label) + (tgt ? '<span class="cf-goal-sep" aria-hidden="true">|</span><span class="cf-goal-t'
          + (loading || sc == null ? '' : ok ? ' is-ok' : ' is-ko') + '">' + esc(tgt) + '</span>' : '') + '</span>'
        + '<span class="cf-goal-v' + (v == null && !loading ? ' is-na' : '') + '">' + esc(val) + (dur && !loading ? '<small> / ' + esc(fSec0(dur)) + '</small>' : '') + '</span>'
        + '<span class="cf-goal-bar' + (g.target == null ? ' is-none' : '') + '"><i style="width:' + (loading ? 0 : Math.round(fill * 1000) / 10) + '%"></i></span>'
        + (loading || v == null || sub ? '<span class="cf-goal-s">' + esc(loading ? 'chargement' : v == null ? na : sub) + '</span>' : '') + '</div>';
    }).join('');
    return '<section class="cf-card"><div class="cf-card-h"><div><h2 class="cf-h2">Objectifs · ' + esc(PERIOD[X.range].evo) + '</h2></div></div>'
      + '<div class="cf-goals">' + cards + '</div></section>';
  }

  function slotBanner(S, D) {
    var P = PERIOD[ui.range];
    if (S.kind === 'disconnected') {
      return banner('err', IC.alert, '<b>Instagram déconnecté</b> · reconnecte @' + esc(selName()) + ' avec le bouton « Reconnecter ». Les chiffres Instagram passent à « — ».');
    }
    if (S.state === 'error') {
      return banner('err', IC.alert, '<b>Erreur de chargement</b> · ' + esc(S.error)
        + (D ? ' · chiffres du ' + esc(hm(new Date(D.fetchedAt))) + ' conservés' : ''), '<button type="button" class="cf-btn is-sm" data-act="retry-ig">Réessayer</button>');
    }
    if (D && D.basicError) {
      return banner('warn', IC.alert, '<b>Instagram refuse la lecture du profil</b> · ' + esc(D.basicError));
    }
    if (S.loading) {
      return '<div class="cf-status" role="status"><span class="cf-spin" aria-hidden="true"></span>'
        + (D ? 'Actualisation ' : 'Chargement des insights ') + esc(P.per) + '…'
        + (LONG[ui.range] && !D ? ' Premier relevé de l’historique : jusqu’à une minute.' : '') + '</div>';
    }
    return '';
  }
  function banner(tone, icon, html, action) {
    return '<div class="cf-banner is-' + tone + '" role="status"><span class="cf-banner-ic">' + svg(icon, 16) + '</span><span class="cf-banner-t">' + html + '</span>' + (action || '') + '</div>';
  }

  // Tout ce que l'onglet Compte affiche pour la fenêtre active, calculé à UN seul endroit : les cartes, la courbe et
  // sa légende lisent ce modèle (jamais deux calculs du même chiffre).
  function model(S, D, off, range) {
    range = range || ui.range;
    var MS = CF.acct.media, MD = off ? null : MS.data;
    var P = PERIOD[range], per = P.per, long = !!LONG[range];
    var pending = !D && !off && (S.loading || S.state === 'idle');
    var why = off ? 'compte déconnecté' : (!D && S.state === 'error' ? 'erreur de chargement' : 'non fourni par l’API Instagram');
    var M = D ? D.m : {}, E = D && !off ? D.err : {};
    var c = {};
    function card(k, v, sub, extra, o) {
      o = o || {};
      c[k] = { v: v, sub: sub, extra: extra || '', fmt: o.fmt || fInt, why: o.why || null, title: o.title || '', label: o.label || null,
        lgV: 'lgV' in o ? o.lgV : v, lgFmt: o.lgFmt || o.fmt || fInt };
    }
    // Comptes uniques : « — » avec la raison (au-delà des 90 jours que garde Instagram, ou refus de l'API).
    function uniqWhy(err) { return err ? (/^Instagram ne garde/.test(err) ? err : 'refusé par l’API : ' + err) : null; }
    function addWhy(err) { return err ? (/^historique en cours/.test(err) ? err : 'refusé par l’API : ' + err) : null; }

    // Publications de la fenêtre (horodatage dans [since, until]) et leurs reels.
    var posts = null, reels = null;
    var mediaOk = MD && !(MD.error && !MD.list.length);   // liste en erreur et vide → « — », jamais un faux 0
    var total = mediaOk ? (MD.mediaTotal != null ? MD.mediaTotal : MD.list.length) : (D && !off ? D.media : null);
    var grid = MD && MD.mediaCount != null && total != null && MD.mediaCount !== total ? MD.mediaCount : null;
    if (D && mediaOk && D.since != null && D.until != null) {
      posts = MD.list.filter(function (p) { return p.ms != null && p.ms >= D.since && p.ms <= D.until; });
      reels = posts.filter(function (p) { return p.type === 'REELS' || p.type === 'VIDEO'; });
    }
    var mediaWhy = MD && !mediaOk ? 'publications indisponibles : ' + MD.error
      : MS.state === 'error' && !MD ? 'publications indisponibles : ' + MS.error : (MD || off ? why : 'chargement des publications');

    // Abonnés : net de la période (follows_and_unfollows : FOLLOWER = abonnements, NON_FOLLOWER = désabonnements).
    // Net exact = compteur d'abonnés d'aujourd'hui − celui relevé la veille du 1er jour (dès qu'on l'a relevé) ;
    // sinon follows_and_unfollows, qu'Instagram publie avec ~2 jours de retard.
    var F = D && !off ? D.flow : null, fin = F ? (F.parts.FOLLOWER || 0) : null, fout = F ? (F.parts.NON_FOLLOWER || 0) : null;
    var fol = D && !off ? D.followers : null, base = D && !off ? D.followersBase : null;
    var netSnap = base && fol != null ? fol - base.followers : null;
    var net = netSnap != null ? netSnap : (F ? fin - fout : null);
    var pend = D && !off && D.flowPending;
    var flowTxt = F ? fSigned(fin) + ' ' + plural(fin, 'abonnement') + ' · ' + fSigned(-fout) + ' ' + plural(fout, 'désabonnement') : '';
    if (range === 'all' && fol != null) {
      // Instagram ne compte les abonnements qu'à l'intérieur de la fenêtre : les abonnés d'avant la 1re publication n'y
      // sont pas. All time = le total, le net de la fenêtre en dessous (la légende de la courbe garde le net).
      card('followers', fol, 'abonnés au total' + (net != null ? ' · ' + fSigned(net) + ' net ' + per : ''), flowTxt,
        { label: 'Abonnés', lgV: net, lgFmt: fSigned });
    } else {
      card('followers', net, 'net ' + per + ' · total ' + (fol == null ? '—' : fInt(fol)),
        netSnap != null ? 'compteur d’abonnés : ' + fInt(base.followers) + ' → ' + fInt(fol) + ' (relevé du ' + dm(ymdDate(base.day)) + ')'
          : F ? flowTxt : (fol != null ? 'total actuel : ' + fInt(fol) : ''),
        { fmt: fSigned, why: net == null ? (pend ? 'Instagram publie les abonnements avec ~2 jours de retard' : addWhy(E.follows)) : null, title: E.follows || '' });
    }
    // Publications
    var nReel = reels ? reels.length : 0, nOther = posts ? posts.length - nReel : 0;
    card('posts', posts ? posts.length : null,
      posts && posts.length ? nReel + ' ' + plural(nReel, 'reel') + (nOther ? ' · ' + nOther + ' ' + plural(nOther, 'autre') : '') + ' ' + per : 'aucune publication ' + per,
      total != null ? 'total publié : ' + fInt(total) + (grid != null ? ' · ' + fInt(grid) + ' sur le profil' : '') : '', { why: mediaWhy });
    // Visionnage moyen et swipe < 3 s : en-tête du Top publications (all time), plus dans les cartes.
    // Comptes uniques
    var reach = M.reach, eng = M.engaged;
    card('engaged', eng, fPct(eng, reach) ? fPct(eng, reach) + ' du reach · ' + per : per, '', { why: eng == null ? uniqWhy(E.engaged) : null, title: E.engaged || '' });
    card('reach', reach, 'comptes uniques touchés · ' + per, '', { why: reach == null ? uniqWhy(E.reach) : null, title: E.reach || '' });
    // Métriques additives
    var views = M.views, inter = M.interactions, pv = M.profileViews;
    var vpr = views != null && reach ? views / reach : null, ipe = inter != null && eng ? inter / eng : null;
    card('views', views, vpr != null ? fDec(vpr, 2) + ' ' + plural(vpr, 'vue') + ' par compte touché' : per, '', { why: addWhy(E.views), title: E.views || '' });
    card('inter', inter, ipe != null ? fDec(ipe, 1) + ' par compte engagé' : per, '', { why: addWhy(E.interactions), title: E.interactions || '' });
    card('pviews', pv, fPct(pv, reach) ? fPct(pv, reach) + ' du reach' : per, '', { why: addWhy(E.profileViews), title: E.profileViews || '' });
    // Clics : le lien en bio (website_clicks) ; sinon les boutons de contact (profile_links_taps), sous leur vrai nom.
    var bio = M.bioTaps, taps = M.linkTaps, useBio = bio != null, clicks = useBio ? bio : taps;
    card('clicks', clicks, clicks === 0 ? 'aucun clic ' + per : (fPct(clicks, pv) ? fPct(clicks, pv) + ' des vues de profil' : per),
      useBio ? 'boutons de contact : ' + (taps == null ? '—' : fInt(taps)) : (D ? 'lien en bio : — · ' + (E.bioTaps ? addWhy(E.bioTaps) : 'non fourni par l’API Instagram') : ''),
      { why: addWhy(useBio ? null : (E.linkTaps || E.bioTaps)), label: useBio || !D ? null : 'Clics boutons de contact' });

    // Courbe : une valeur par jour Instagram (null = pas encore relevé, ou refusé ce jour-là → trait interrompu).
    var days = D && !off && D.series && D.series.length ? D.series : null, series = null;
    if (days) {
      var perDay = {};
      if (mediaOk) MD.list.forEach(function (p) { if (p.ms != null) { var d = ptDay(p.ms); perDay[d] = (perDay[d] || 0) + 1; } });
      var col = function (k) { return days.map(function (x) { return x[k]; }); };
      series = {
        labels: col('d'), followers: col('follows'), unfollows: col('unfollows'),
        posts: mediaOk ? days.map(function (x) { return perDay[x.d] || 0; }) : days.map(function () { return null; }),
        engaged: col('engaged'), reach: col('reach'), views: col('views'), inter: col('inter'), pviews: col('pviews'),
        clicks: days.map(function (x) { return useBio ? x.bio : x.links; })
      };
    }
    var nDays = D && D.dayFirst && D.dayLast ? Math.round((ymdDate(D.dayLast) - ymdDate(D.dayFirst)) / 864e5) + 1 : null;
    return { c: c, pending: pending, why: why, series: series, missing: D ? D.seriesMissing : 0, per: per, long: long, off: off,
      reels: reels, nDays: nDays, mediaWhy: mediaWhy, range: range, fol: fol, net: net };
  }

  // Cartes de la maquette : une couleur par métrique ; toucher une carte affiche / masque sa courbe.
  function cardsHTML(X) {
    return SER.map(function (s) {
      var m = X.c[s.k], label = m.label || s.label, on = !s.fixed && !ui.evoHidden[s.k];
      var v, sub, na = false;
      if (X.pending) { v = '…'; sub = 'chargement'; }
      else if (m.v == null) { v = '—'; sub = m.why || X.why; na = true; }
      else { v = m.fmt(m.v); sub = m.sub; }
      var cls = 'cf-icard' + (s.fixed ? ' is-fixed' : (on ? ' is-on' : ' is-off')) + (s.hero ? ' is-hero' : '');
      var inner = '<span class="cf-icard-h"><span class="cf-icard-tile">' + svg(s.ic, 14) + '</span><span class="cf-icard-l">' + esc(label) + '</span>'
        + (s.fixed ? '' : '<span class="cf-icard-ck" aria-hidden="true">' + (on ? svg('M5 12l5 5L20 7', 10) : '') + '</span>') + '</span>'
        + '<span class="cf-icard-v' + (na ? ' is-na' : '') + '">' + esc(v) + '</span>'
        + '<span class="cf-icard-s">' + esc(sub) + '</span>'
        + (m.extra && !X.pending ? '<span class="cf-icard-x">' + esc(m.extra) + '</span>' : '');
      var attrs = ' style="--c:' + s.c + '"' + (m.title ? ' title="' + esc(m.title) + '"' : '');
      return s.fixed
        ? '<div class="' + cls + '"' + attrs + '>' + inner + '</div>'
        : '<button type="button" class="' + cls + '"' + attrs + ' data-act="evo-toggle" data-k="' + s.k + '" aria-pressed="' + on + '">' + inner + '</button>';
    }).join('');
  }

  // ── Évolution : courbes jour par jour, échelle logarithmique (maquette) ──
  var evoCur = null;   // modèle de la courbe affichée, lu par la bulle de survol (sans redessiner le panneau)
  function chartModel(X) {
    var s = X.series, n = s.labels.length;
    var act = EVO_KEYS.filter(function (k) { return !ui.evoHidden[k]; });
    var max = 1;
    act.forEach(function (k) {
      (s[k] || []).forEach(function (v) { if (v != null && v > max) max = v; });
      if (k === 'followers') s.unfollows.forEach(function (v) { if (v != null && v > max) max = v; });
    });
    var top = Math.max(2, Math.ceil(Math.log10(max + 1)));
    var Y = function (v) { return 300 - (Math.log10(v + 1) / top) * 290; };
    var Xp = function (i) { return n > 1 ? i / (n - 1) * 1000 : 500; };
    var path = function (arr) {
      var d = '', pen = false;
      arr.forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? ' L' : ' M') + Xp(i).toFixed(1) + ',' + Y(v).toFixed(1);
        pen = true;
      });
      return d.trim();
    };
    var lines = act.map(function (k) { return { k: k, d: path(s[k]) }; });
    if (act.indexOf('followers') >= 0) lines.push({ k: 'followers', d: path(s.unfollows), dash: true });
    var ticks = [];
    for (var e = 0; e <= top; e++) { var tv = e ? Math.pow(10, e) : 0; ticks.push({ label: e ? fK(tv) : '0', top: Y(tv) / 3 }); }
    return { n: n, s: s, act: act, lines: lines, ticks: ticks, Y: Y, c: X.c };
  }
  function evoHTML(S, D, off, X) {
    var P = PERIOD[ui.range];
    var miss = X.missing > 0 ? '<span class="cf-meta">historique en cours de relevé · ' + X.missing + ' ' + plural(X.missing, 'jour') + ' manquant' + (X.missing > 1 ? 's' : '') + ', relu automatiquement</span>' : '';
    var head = '<div class="cf-evo-h"><h3 class="cf-h2">Évolution · ' + esc(P.evo) + '</h3>' + miss + '</div>';
    var msg = '';
    if (off) msg = 'Instagram déconnecté : reconnecte @' + selName() + ' pour voir les courbes.';
    else if (!D && S.state === 'error') msg = 'Courbe indisponible : ' + (S.error || 'erreur de chargement') + '.';
    else if (D && !X.series) msg = 'Courbe indisponible pour cette période.';
    if (msg) { evoCur = null; return '<div class="cf-evo">' + head + '<div class="cf-evo-msg">' + esc(msg) + '</div></div>'; }
    if (!D) { evoCur = null; return '<div class="cf-evo">' + head + '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement de la courbe…</div></div>'; }
    var ch = chartModel(X);
    evoCur = ch;
    var y = ch.ticks.map(function (t) { return '<span style="top:' + t.top.toFixed(2) + '%">' + esc(t.label) + '</span>'; }).join('');
    var grid = ch.ticks.map(function (t, i) { return '<i class="cf-evo-grid' + (i ? '' : ' is-zero') + '" style="top:' + t.top.toFixed(2) + '%"></i>'; }).join('');
    var paths = ch.lines.map(function (l) {
      return l.d ? '<path d="' + l.d + '" style="stroke:' + SERC[l.k] + '"' + (l.dash ? ' stroke-dasharray="5 5"' : '') + ' fill="none" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' : '';
    }).join('');
    var n = ch.n, idx = [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(3 * (n - 1) / 4), n - 1]
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    var xl = idx.map(function (i) { return '<span>' + esc(dm(ymdDate(ch.s.labels[i]))) + '</span>'; }).join('');
    var lg = EVO_KEYS.map(function (k) {
      var m = X.c[k], hid = !!ui.evoHidden[k];
      var v = hid || m.lgV == null ? '—' : m.lgFmt(m.lgV);
      var lab = k === 'followers' ? 'Abonnés (net)' : (m.label || SER.filter(function (s) { return s.k === k; })[0].label);
      return '<div class="cf-evo-lg' + (hid ? ' is-off' : '') + '"><span class="cf-sq" style="background:' + SERC[k] + '"></span><b>' + esc(v) + '</b><span>' + esc(lab) + '</span></div>';
    }).join('');
    return '<div class="cf-evo">' + head
      + '<div class="cf-evo-body">'
      + '<div class="cf-evo-y" aria-hidden="true">' + y + '</div>'
      + '<div class="cf-evo-main">'
      + '<div class="cf-evo-plot" role="img" aria-label="' + esc('Courbes jour par jour ' + X.per + ', échelle logarithmique') + '">' + grid
      + '<svg class="cf-evo-svg" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + paths + '</svg>'
      + '<div class="cf-evo-hover" hidden></div></div>'
      + '<div class="cf-evo-x" aria-hidden="true">' + xl + '</div>'
      + '<div class="cf-meta cf-evo-note">un point par jour Instagram · trait plein : abonnements, pointillé : désabonnements · échelle logarithmique</div>'
      + '</div>'
      + '<div class="cf-evo-legend"><div class="cf-over">total période</div>' + lg + '</div>'
      + '</div></div>';
  }
  // Bulle de survol : valeur du jour + cumul depuis le début de la période (jamais pour reach / comptes engagés).
  function evoHover(plot, clientX) {
    var ch = evoCur;
    if (!ch || ch.n < 1 || !plot) return;
    var r = plot.getBoundingClientRect();
    if (!r.width) return;
    var i = ch.n > 1 ? Math.round((clientX - r.left) / r.width * (ch.n - 1)) : 0;
    i = Math.max(0, Math.min(ch.n - 1, i));
    var box = plot.querySelector('.cf-evo-hover');
    if (!box || (box._i === i && !box.hidden)) return;
    box._i = i;
    var x = ch.n > 1 ? i / (ch.n - 1) * 100 : 50;
    var dots = '', rows = '';
    EVO_KEYS.forEach(function (k) {
      if (ch.act.indexOf(k) < 0) return;
      var arr = ch.s[k], v = arr[i], day, cum;
      if (k === 'followers') {
        var u = ch.s.unfollows[i], net = v != null && u != null ? v - u : null, acc = 0, ok = true;
        for (var j = 0; j <= i; j++) { if (ch.s.followers[j] == null || ch.s.unfollows[j] == null) { ok = false; break; } acc += ch.s.followers[j] - ch.s.unfollows[j]; }
        day = net == null ? '—' : fSigned(net) + ' (' + fSigned(v) + ' / ' + fSigned(-u) + ')';
        cum = ok ? fSigned(acc) : '—';
      } else {
        day = v == null ? '—' : fInt(v);
        if (UNIQUE[k]) cum = '—';
        else { var s2 = 0, ok2 = true; for (var q = 0; q <= i; q++) { if (arr[q] == null) { ok2 = false; break; } s2 += arr[q]; } cum = ok2 ? fInt(s2) : '—'; }
      }
      if (v != null) dots += '<span class="cf-evo-dot" style="left:' + x + '%;top:' + (ch.Y(v) / 3).toFixed(2) + '%;background:' + SERC[k] + '"></span>';
      var lab = k === 'followers' ? 'Abonnés' : (ch.c[k].label || SER.filter(function (s) { return s.k === k; })[0].label);
      rows += '<div class="cf-evo-tr"><span><span class="cf-sq" style="background:' + SERC[k] + '"></span>' + esc(lab) + '</span><span>' + esc(day) + '</span><b>' + esc(cum) + '</b></div>';
    });
    var d = ymdDate(ch.s.labels[i]);
    var date = d.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ' + dm(d);
    box.innerHTML = '<span class="cf-evo-vl" style="left:' + x + '%"></span>' + dots
      + '<div class="cf-evo-tip"><div class="cf-evo-tr is-h"><span>' + esc(date) + '</span><span>jour</span><span>cumul</span></div>' + rows + '</div>';
    box.hidden = false;
    // La bulle reste DANS la courbe (jamais de défilement horizontal sur mobile).
    var tip = box.querySelector('.cf-evo-tip'), W = r.width, w = tip.offsetWidth, px = x / 100 * W;
    var left = px + 12 + w <= W ? px + 12 : px - 12 - w;
    tip.style.left = Math.max(0, Math.min(W - w, left)) + 'px';
  }
  function evoHide() {
    var boxes = document.querySelectorAll('.cf-evo-hover');
    for (var k = 0; k < boxes.length; k++) { boxes[k].hidden = true; boxes[k]._i = null; }
  }

  // ── Répartition (même graphique que « Genre » dans la maquette : barre empilée + légende) ──
  var TYPE_L = { REEL: 'Reels', REELS: 'Reels', POST: 'Publications', FEED: 'Publications', CAROUSEL_CONTAINER: 'Carrousels', STORY: 'Stories', AD: 'Publicités' };
  var TYPE_C = { REEL: 'var(--cf-c-views)', REELS: 'var(--cf-c-views)', POST: 'var(--cf-c-posts)', FEED: 'var(--cf-c-posts)', CAROUSEL_CONTAINER: 'var(--cf-c-pviews)', STORY: 'var(--cf-c-reach)', AD: 'var(--cf-c-clicks)' };
  var FOL_L = { FOLLOWER: 'Abonnés', NON_FOLLOWER: 'Non-abonnés', UNKNOWN: 'Inconnu' };
  var FOL_C = { FOLLOWER: 'var(--cf-c-followers)', NON_FOLLOWER: 'var(--cf-c-views)', UNKNOWN: 'var(--cf-c-other)' };
  // Parts en % de la SOMME des parts (pas du total de la carte : une répartition peut ne pas retomber pile dessus).
  function stackHTML(rows, counts) {
    var sum = rows.reduce(function (a, r) { return a + r.v; }, 0);
    if (!rows.length || !sum) return '<div class="cf-empty-s">Aucune donnée sur la période.</div>';
    var bar = '<div class="cf-stack" aria-hidden="true">' + rows.map(function (r) {
      return r.v > 0 ? '<span style="width:' + (r.v / sum * 100).toFixed(2) + '%;background:' + r.c + '"></span>' : '';
    }).join('') + '</div>';
    var lg = rows.map(function (r) {
      return '<div class="cf-stack-r"><span class="cf-stack-k"><span class="cf-sq" style="background:' + r.c + '"></span>' + esc(r.l) + '</span>'
        + '<span class="cf-stack-v"><b>' + esc(fShare(r.v / sum * 100)) + '</b>' + (counts ? '<i>' + esc(fInt(r.v)) + '</i>' : '') + '</span></div>';
    }).join('');
    return bar + '<div class="cf-stack-l">' + lg + '</div>';
  }
  function bkRows(bk, labels, colors) {
    return Object.keys(bk.parts).map(function (k) { return { l: labels[k] || k.toLowerCase(), v: bk.parts[k], c: colors[k] || 'var(--cf-c-other)' }; })
      .sort(function (a, b) { return b.v - a.v; });
  }
  function repBlock(title, bk, err, labels, colors, st) {
    var body;
    if (st.off) body = emptyLine('—', 'compte déconnecté');
    else if (st.loadErr) body = emptyLine('—', 'erreur de chargement');
    else if (st.pending) body = '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement…</div>';
    else if (!bk) body = emptyLine('—', err ? 'refusé par l’API Instagram : ' + err : 'non fourni par l’API Instagram');
    else body = stackHTML(bkRows(bk, labels, colors), true);
    return '<div class="cf-rep-b"><div class="cf-over">' + esc(title) + '</div>' + body + '</div>';
  }
  // « Publications » toujours listées, à 0 tant qu'aucune publication (hors reels) n'a de vues (demande d'Axel, 25/09).
  function withPosts(bk) {
    if (!bk || 'POST' in bk.parts || 'FEED' in bk.parts) return bk;
    var parts = {}; Object.keys(bk.parts).forEach(function (k) { parts[k] = bk.parts[k]; });
    parts.POST = 0;
    return { breakdown: bk.breakdown, total: bk.total, parts: parts };
  }
  function repHTML(S, D, off) {
    var P = PERIOD[ui.range];
    var st = { off: off, pending: !D && !off && (S.loading || S.state === 'idle'), loadErr: !D && !off && !S.loading && S.state === 'error', long: !!LONG[ui.range] };
    var E = D ? D.err : {};
    return '<section class="cf-card"><div class="cf-card-h"><div><h2 class="cf-h2">Répartition ' + esc(P.per) + '</h2></div></div>'
      + '<div class="cf-rep">'
      + repBlock('Vues par type de contenu', withPosts(D && D.viewsByType), E.viewsByType, TYPE_L, TYPE_C, st)
      + repBlock('Vues · abonnés / non-abonnés', D && D.viewsByFollower, E.viewsByFollower, FOL_L, FOL_C, st)
      + '</div></section>';
  }

  // Module de la vidéo (saisi par le propriétaire, en attendant la reconnaissance automatique des vidéos postées).
  function moduleChip(m, withIcon) {
    var lab = m && CF.MODULES && CF.MODULES[m];
    return lab
      ? '<span class="cf-chip is-mod">' + (withIcon ? svg(IC.puzzle, 12) : '') + esc(lab) + '</span>'
      : '<span class="cf-chip is-muted">' + (withIcon ? svg(IC.puzzle, 12) : '') + 'vidéo non reconnue</span>';
  }
  // Module affiché : celui saisi à la main, sinon celui déduit du hook reconnu.
  function effModule(p) { return p.module || (p.analysis && p.analysis.module) || null; }
  function reelChip(p) {
    if (p.type !== 'REELS' && p.type !== 'VIDEO') return '';
    return p.trial ? '<span class="cf-chip is-trial">réel d’essai</span>' : '<span class="cf-chip">réel</span>';
  }
  var KIND_L = { hook: 'hook', liaison: 'liaison', cta: 'CTA' };
  function bricksChips(p) {
    var a = p.analysis;
    if (!a) return '';
    if (a.status === 'pending') return '<span class="cf-chip is-muted">briques : analyse en cours…</span>';
    if (a.status === 'error') return '';
    if (a.noVoice) return '<span class="cf-chip is-muted">sans voix</span>';
    return a.bricks.map(function (b) { return '<span class="cf-chip is-brick" title="' + esc(KIND_L[b.kind] + ' · ' + b.label) + '">' + esc(b.id) + '</span>'; }).join('');
  }
  // Pastilles du module : la saisie à la main (sinon « détecté » sur celui déduit du hook) ; re-toucher la pastille active la retire.
  function moduleChoices(p) {
    var cur = p.module, auto = !cur && p.analysis && p.analysis.module;
    return Object.keys(CF.MODULES || {}).map(function (k) {
      var on = k === cur, det = k === auto;
      return '<button type="button" class="cf-mod' + (on ? ' is-on' : det ? ' is-det' : '') + '" role="radio" aria-checked="' + on + '" data-act="tag-set" data-tag-id="' + esc(p.id) + '" data-mod="' + esc(on ? '' : k) + '">'
        + (on ? svg('M5 12l5 5L20 7', 11) : '') + esc(CF.MODULES[k]) + (det ? '<span class="cf-mod-d">détecté</span>' : '') + '</button>';
    }).join('');
  }
  function typeLabel(t) {
    var T = { REELS: 'reel', FEED: 'publication', STORY: 'story', VIDEO: 'vidéo', IMAGE: 'image', CAROUSEL_ALBUM: 'carrousel' };
    return t ? (T[t] || t.toLowerCase()) : 'type inconnu';
  }
  function capText(c) {
    if (!c) return '(sans légende)';
    return c.length >= 90 ? c.replace(/\s+\S*$/, '') + '…' : c; // ig-insights coupe la légende à 90 caractères
  }
  function isVideo(p) { return p.type === 'REELS' || p.type === 'VIDEO' || p.avgWatchS != null; }
  function rateStat(p, g) {
    var v = rateOf(p, g);
    return '<span class="cf-st is-rate' + (v == null ? ' is-na' : goalOk(g, v) ? ' is-ok' : ' is-ko') + '" title="' + esc(goalTxt(g)) + '"><b class="cf-st-r">'
      + esc(v == null ? '—' : fRate(v)) + '</b> swipe < 3' + NB + 's</span>';
  }
  // « 74 likes 2,2 % » : le nombre et son taux (÷ vues), le taux coloré selon l'objectif.
  function countRate(p, g, vid) {
    var c = p[g.f], v = vid ? rateOf(p, g) : null;
    return '<span class="cf-st is-rate' + (c == null ? ' is-na' : v == null || g.target == null ? '' : goalOk(g, v) ? ' is-ok' : ' is-ko') + '" title="' + esc(goalTxt(g)) + '"><b>'
      + esc(c == null ? '—' : fInt(c)) + '</b> ' + esc(c != null && Math.abs(c) >= 2 ? g.u[1] : g.u[0]) + (v != null ? ' <b class="cf-st-r">' + esc(fRate(v)) + '</b>' : '') + '</span>';
  }
  // « 8,3 s / 28 s visionnage 30 % » : part de la vidéo regardée, colorée selon l'objectif (40 %).
  function watchStat(p) {
    var r = retentionOf(p);
    return '<span class="cf-st is-rate' + (r == null ? '' : goalOk(GOAL.watch, r) ? ' is-ok' : ' is-ko') + '" title="' + esc(goalTxt(GOAL.watch)) + '"><b>'
      + esc(fSec(p.avgWatchS) + (p.durationS ? ' / ' + fSec0(p.durationS) : '')) + '</b> visionnage' + (r != null ? ' <b class="cf-st-r">' + esc(fRate(r)) + '</b>' : '') + '</span>';
  }
  function stat(v, label, hero) {
    return '<span class="cf-st' + (hero && v != null ? ' is-hero' : '') + (v == null ? ' is-na' : '') + '"><b>' + esc(v == null ? '—' : v) + '</b> ' + esc(label) + '</span>';
  }

  // ── Top publications : les 5 plus vues de TOUTES les publications (chiffres à vie) ──
  // Toutes les publications qui ont des vues, triées : la seule liste du Top publications.
  function topAll() {
    var MD = CF.acct.media.data;
    if (!MD) return [];
    return MD.list.filter(function (p) { return p.views != null; }).sort(function (a, b) { return b.views - a.views; });
  }
  function topList() {
    var all = topAll();
    return ui.allPosts ? all : all.slice(0, 5);
  }
  function topHTML(off) {
    var MS = CF.acct.media, MD = off ? null : MS.data, list = topList();
    // Visionnage moyen et swipe < 3 s : dans la section Objectifs (moyenne des reels de la période).
    var box = '';
    var head = '<div class="cf-card-h"><div><h2 class="cf-h2">' + (ui.allPosts ? 'Toutes les publications' : 'Top publications') + '</h2></div>' + box + '</div>';
    var nAll = MD ? MD.list.filter(function (p) { return p.views != null; }).length : 0;
    var more = nAll > 5 ? '<button type="button" class="cf-btn is-sm cf-more" data-act="all-posts">'
      + esc(ui.allPosts ? 'Afficher seulement le top 5' : 'Afficher les ' + nAll + ' publications') + '</button>' : '';
    var body;
    if (off || MS.kind === 'disconnected') body = emptyLine('—', 'compte déconnecté');
    else if (!MD) body = (MS.loading || MS.state === 'idle') ? '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement des publications…</div>'
      : '<div class="cf-na-line"><span class="cf-na-v">—</span><span>' + esc(MS.error || 'indisponible') + '</span><button type="button" class="cf-link-btn" data-act="retry-media">Réessayer</button></div>';
    else if (!list.length && MD.error) body = emptyLine('—', 'liste des publications indisponible : ' + MD.error);
    else if (!list.length) body = '<div class="cf-empty-s">Aucune publication pour l’instant.</div>';
    else body = '<div class="cf-posts">' + list.map(postRowHTML).join('') + '</div>' + more;
    return '<section class="cf-card">' + head + body + '</section>';
  }

  function postRowHTML(p, i) {
    var thumb = safeUrl(p.thumb), d = validDate(p.timestamp), vid = isVideo(p);
    var stats = [stat(fInt(p.views), plural(p.views, 'vue'), true)];
    ['like', 'comment', 'save', 'share'].forEach(function (k) { stats.push(countRate(p, GOAL[k], vid)); });
    if (vid) stats.push(rateStat(p, GOAL.skip));
    if (p.avgWatchS != null) stats.push(watchStat(p));
    return '<button type="button" class="cf-post" data-act="post" data-i="' + i + '" aria-label="Ouvrir la fiche de la publication ' + (i + 1) + '">'
      + '<span class="cf-post-rank">#' + (i + 1) + '</span>'
      + '<span class="cf-thumb">' + (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '')
      + (vid ? '<span class="cf-thumb-play">' + svg(IC.play, 10) + '</span>' : '') + '</span>'
      + '<span class="cf-post-b">'
      + '<span class="cf-post-meta">' + reelChip(p) + moduleChip(effModule(p)) + bricksChips(p) + '<span class="cf-meta">'
      + esc((d ? 'posté le ' + dmy(d) : 'date inconnue') + (reelChip(p) ? '' : ' · ' + typeLabel(p.type))) + '</span></span>'
      + '<span class="cf-post-cap">' + esc(capText(p.caption)) + '</span>'
      + '<span class="cf-post-stats">' + stats.join('') + '</span>'
      + '</span>'
      + '<span class="cf-post-go">' + svg(IC.chevron, 16) + '</span>'
      + '</button>';
  }

  // ── Audience (maquette : barres pays / villes, colonnes d'âge, barre empilée du genre) ──
  var AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  var GENDER = [['M', 'Hommes', 'var(--cf-c-followers)'], ['F', 'Femmes', 'var(--cf-c-views)'], ['U', 'Non précisé', 'var(--cf-c-other)']];
  var regionName = (function () {
    var dn = null;
    try { dn = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch (e) { dn = null; }
    return function (code) { try { return (dn && /^[A-Z]{2}$/.test(code) && dn.of(code)) || code; } catch (e) { return code; } };
  })();
  function sumOf(list) { return list.reduce(function (a, x) { return a + x.v; }, 0); }
  // Les N premiers + « Autres » (le reste des 45 valeurs renvoyées par Instagram).
  function topRows(list, n, label) {
    var rows = list.slice(0, n).map(function (x) { return { l: label(x.k), v: x.v }; });
    var rest = list.slice(n).reduce(function (a, x) { return a + x.v; }, 0);
    if (rest > 0) rows.push({ l: 'Autres', v: rest });
    return rows;
  }
  function audNa(title, err) {
    return '<div class="cf-aud-b"><div class="cf-over">' + esc(title) + '</div>' + emptyLine('—', err ? 'refusé par l’API Instagram : ' + err : 'non fourni par l’API Instagram') + '</div>';
  }
  function audBars(title, list, err, rows, soft) {
    if (!list) return audNa(title, err);
    var sum = sumOf(list);
    if (!sum) return '<div class="cf-aud-b"><div class="cf-over">' + esc(title) + '</div><div class="cf-empty-s">Aucune donnée.</div></div>';
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }));
    return '<div class="cf-aud-b' + (soft ? ' is-soft' : '') + '"><div class="cf-over">' + esc(title) + '</div>' + rows.map(function (r) {
      return '<div class="cf-hbar"><span class="cf-hbar-l" title="' + esc(r.l) + '">' + esc(r.l) + '</span>'
        + '<span class="cf-hbar-t" aria-hidden="true"><span style="width:' + (r.v / max * 100).toFixed(1) + '%"></span></span>'
        + '<span class="cf-hbar-v">' + esc(fShare(r.v / sum * 100)) + '</span></div>';
    }).join('') + '</div>';
  }
  function audAges(list, err) {
    if (!list) return audNa('Âge', err);
    var rows = list.slice().sort(function (a, b) {
      var ia = AGE_ORDER.indexOf(a.k), ib = AGE_ORDER.indexOf(b.k);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var sum = sumOf(rows), max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([0]));
    if (!sum) return '<div class="cf-aud-b"><div class="cf-over">Âge</div><div class="cf-empty-s">Aucune donnée.</div></div>';
    return '<div class="cf-aud-b"><div class="cf-over">Âge</div>'
      + '<div class="cf-cols">' + rows.map(function (r) {
        return '<div class="cf-col' + (r.v === max ? ' is-max' : '') + '"><span>' + esc(fShare(r.v / sum * 100)) + '</span>'
          + '<i style="height:calc(' + (r.v / max * 100).toFixed(1) + '% - 18px)"></i></div>';
      }).join('') + '</div>'
      + '<div class="cf-cols-x">' + rows.map(function (r) { return '<span>' + esc(r.k) + '</span>'; }).join('') + '</div></div>';
  }
  function audGender(list, err) {
    if (!list) return audNa('Genre', err);
    var byK = {};
    list.forEach(function (x) { byK[x.k] = (byK[x.k] || 0) + x.v; });
    var rows = GENDER.filter(function (g) { return byK[g[0]] != null; }).map(function (g) { return { l: g[1], v: byK[g[0]], c: g[2] }; });
    Object.keys(byK).forEach(function (k) { if (!GENDER.some(function (g) { return g[0] === k; })) rows.push({ l: k, v: byK[k], c: 'var(--cf-c-other)' }); });
    return '<div class="cf-aud-b"><div class="cf-over">Genre</div>' + stackHTML(rows, false) + '</div>';
  }
  function audienceHTML(D, off) {
    var A = CF.acct.aud, X = A.data, f = D && !off ? D.followers : null;
    var head = '<div class="cf-card-h"><div><h2 class="cf-h2">Audience</h2></div>'
      + (X && !off ? '<div class="cf-meta">relevé à ' + esc(hm(new Date(X.fetchedAt))) + '</div>' : '') + '</div>';
    var body;
    if (off || A.kind === 'disconnected') body = emptyLine('—', 'compte déconnecté');
    else if (!X && (A.loading || A.state === 'idle')) body = '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement de l’audience…</div>';
    else if (!X) body = '<div class="cf-na-line"><span class="cf-na-v">—</span><span>' + esc(A.error || 'indisponible')
      + (f != null && f < 100 ? ' · il faut au moins 100 abonnés (' + fInt(f) + ' aujourd’hui)' : '') + '</span>'
      + '<button type="button" class="cf-link-btn" data-act="retry-aud">Réessayer</button></div>';
    else {
      body = (A.state === 'error' ? banner('err', IC.alert, '<b>Actualisation échouée</b> · ' + esc(A.error) + ' · chiffres du ' + esc(hm(new Date(X.fetchedAt))) + ' conservés',
          '<button type="button" class="cf-btn is-sm" data-act="retry-aud">Réessayer</button>') : '')
        + '<div class="cf-aud">'
        + audBars('Pays', X.country, X.err.country, X.country ? topRows(X.country, 5, regionName) : [], false)
        + audBars('Villes principales', X.city, X.err.city, X.city ? topRows(X.city, 5, function (k) { return k.split(',')[0]; }) : [], true)
        + audAges(X.age, X.err.age)
        + audGender(X.gender, X.err.gender)
        + '</div>';
    }
    return '<section class="cf-card">' + head + body + '</section>';
  }
  function emptyLine(v, why) {
    return '<div class="cf-na-line"><span class="cf-na-v">' + esc(v) + '</span><span>' + esc(why) + '</span></div>';
  }

  // ── onglet Auto-DM Instagram (étape 2, Axel 25/09) : RPC ig_dm_stats_v2, PERSONNES UNIQUES ──
  // commentaire mot-clé → a tapé « Je suis abonné » → lien reçu → clic. Une personne compte une fois dans la période,
  // rattachée à son 1er commentaire de la période : cartes, courbe, légende, taux, funnel et leads donnent le même total.
  // Relance : faite par le backend (ig-followup), affichée en lecture seule. Aucun bouton d'écriture ici.
  var DM_PERIODS = [
    { k: '24h', label: '24' + NB + 'h', per: 'sur 24' + NB + 'h', step: 'hour' },
    { k: '7j', label: '7' + NB + 'j', per: 'sur 7' + NB + 'j', step: 'day' },
    { k: '30j', label: '30' + NB + 'j', per: 'sur 30' + NB + 'j', step: 'day' },
    { k: '90j', label: '90' + NB + 'j', per: 'sur 90' + NB + 'j', step: 'week' },
    { k: 'all', label: 'All time', per: 'depuis le lancement', step: 'month' }
  ];
  var DM_PERIOD = {};
  DM_PERIODS.forEach(function (p) { DM_PERIOD[p.k] = p; });
  var DM_STEP = { hour: 'par heure', day: 'par jour', week: 'par semaine', month: 'par mois' };
  var DM_STEP_H = { hour: 'heure', day: 'jour', week: 'semaine', month: 'mois' };
  // UNE table de libellés et de couleurs pour les cartes, la courbe, la légende et la bulle (maquette).
  var DMS = [
    { k: 'commented', label: 'Leads', c: 'var(--cf-dm-leads)', ic: IC.users },
    { k: 'tapped', label: 'Je suis abonné', c: 'var(--cf-dm-tap)', ic: IC.send },
    { k: 'linked', label: 'Liens reçus', c: 'var(--cf-dm-link)', ic: IC.link },
    { k: 'clicked', label: 'Clics lien DM', c: 'var(--cf-dm-click)', ic: IC.click },
    { k: 'users', label: 'Devenus users', c: 'var(--cf-dm-users)', ic: IC.userOk, opt: true }
  ];
  // « Devenus users » (attribution, Axel 25/09) : compte AvatarAds CRÉÉ APRÈS le clic sur le lien DM (ig_lead_links).
  // opt = source facultative : tant que ig_dm_stats_v2 ne renvoie pas users (migration pas appliquée), carte figée « — ».
  var DM_NOSRC = 'pas de source : l’attribution lead Instagram → compte AvatarAds n’est pas encore en base';
  var DOW = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  // Heure de Paris (celle des groupes de la RPC), quel que soit le fuseau du navigateur.
  var PARIS = (function () {
    try { return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return null; }
  })();
  function paris(t) {
    var d = new Date(t);
    if (!PARIS) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), H: d.getHours(), M: d.getMinutes() };
    var o = {};
    PARIS.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, H: +o.hour % 24, M: +o.minute };
  }
  function pDm(x) { return p2(x.d) + '/' + p2(x.m); }
  function pDmy(x) { return pDm(x) + '/' + x.y; }
  function pHm(x) { return p2(x.H) + ':' + p2(x.M); }
  function ago(t) {
    var s = (Date.now() - t) / 1000;
    if (s < 60) return 'à l’instant';
    if (s < 3600) return 'il y a ' + Math.floor(s / 60) + NB + 'min';
    if (s < 86400) return 'il y a ' + Math.floor(s / 3600) + NB + 'h';
    var d = Math.floor(s / 86400);
    return d < 60 ? 'il y a ' + d + NB + 'j' : 'le ' + pDmy(paris(t));
  }
  function fP1(v) { return fDec(v, 1) + NB + '%'; }
  function cronTxt(s) { var m = /^(\d{1,2}) \* \* \* \*$/.exec(s || ''); return m ? 'toutes les heures à :' + p2(+m[1]) : (s || 'horaire inconnu'); }

  function dmWhy(S) {
    return S.kind === 'missing' ? 'fonction ig_dm_stats_v2 pas encore en base' : S.kind === 'forbidden' ? 'accès refusé par la base' : 'erreur de chargement';
  }
  // Tout ce que l'onglet Auto-DM affiche pour la période active, calculé à UN seul endroit.
  function dmModel(S, D, range) {
    var P = DM_PERIOD[range || ui.dmRange];
    var pending = !D && (S.loading || S.state === 'idle');
    var why = D ? 'non renvoyé par ig_dm_stats_v2' : S.state === 'error' ? dmWhy(S) : '';
    var F = D ? D.f : { commented: null, tapped: null, linked: null, clicked: null, users: null, paid: null };
    var R = D ? D.rel : {};
    var A = D && D.attr ? D.attr : { existing: null, existingPaid: null };
    // Source de l'attribution absente (RPC d'avant la migration users) → cartes « Devenus users » / « Leads → users » figées.
    var noSrc = !!D && F.users == null;
    var none = {};
    DMS.forEach(function (s) { none[s.k] = !!s.opt && noSrc; });
    var c = {};
    DMS.forEach(function (s) {
      c[s.k] = none[s.k] ? { v: null, why: DM_NOSRC, spark: null }
        : { v: F[s.k], why: why, spark: D && D.series.length ? D.series.map(function (p) { return p[s.k]; }) : null };
    });
    function pct(a, b) { return a == null || b == null || !b ? null : a / b * 100; }
    function zero(b, what) { return b === 0 ? 'aucun ' + what + ' ' + P.per : why; }
    var unc = F.linked != null && F.clicked != null ? F.linked - F.clicked : null;
    var blocked = F.tapped != null && F.linked != null ? Math.max(0, F.tapped - F.linked) : null;
    var paidTxt = F.paid == null ? '' : ' · dont ' + fInt(F.paid) + ' ' + plural(F.paid, 'payant');
    var rates = [
      { k: 'conv', label: 'Taux de conversion', ic: IC.pct, v: pct(F.linked, F.commented), sub: 'liens reçus / leads · ' + P.per, na: zero(F.commented, 'lead') },
      { k: 'ctr', label: 'CTR', ic: IC.target, v: pct(F.clicked, F.linked), sub: 'clics / liens reçus · ' + P.per, na: zero(F.linked, 'lien reçu') },
      { k: 'users', label: 'Leads → users', ic: IC.userOk, v: noSrc ? null : pct(F.users, F.commented), none: noSrc,
        sub: 'users / leads · ' + P.per + paidTxt, na: noSrc ? DM_NOSRC : zero(F.commented, 'lead') },
      { k: 'unclicked', label: 'Lien reçu, pas cliqué', ic: IC.link, v: pct(unc, F.linked), na: zero(F.linked, 'lien reçu'),
        sub: unc == null ? '' : unc + ' ' + plural(unc, 'personne') + ' sans clic · dont ' + (R.doneUnclicked == null ? '—' : R.doneUnclicked) + ' ' + plural(R.doneUnclicked, 'relancée') + ' · ' + P.per }
    ];
    return { P: P, D: D, S: S, pending: pending, why: why, F: F, R: R, A: A, c: c, none: none, noSrc: noSrc, paidTxt: paidTxt,
      rates: rates, unc: unc, blocked: blocked, pct: pct, step: (D && D.step) || P.step, range: range || ui.dmRange };
  }

  function dmHTML() {
    var S = CF.dm[ui.dmRange], D = S.data, X = dmModel(S, D, ui.dmRange);
    return titleSel('Auto-DM Instagram')
      + dmAcctHTML(D)
      + dmActivityHTML(X)
      + dmRatesHTML(X)
      + dmFunnelHTML(X)
      + dmPostsHTML(X)
      + dmHeatHTML(X)
      + dmLeadsHTML(X);
  }

  // Carte compte : l'auto-DM tourne avec le token d'ig_accounts ; sans lui, il est en pause (nos chiffres restent justes).
  function dmAcctState() {
    var A = CF.acct.accounts, prim = A.primary, tok = tokenInfo(prim);
    if (A.state === 'idle') return { tone: 'mute', line: 'chargement' };
    if (A.state === 'error' && !prim) return { tone: 'mute', line: 'comptes indisponibles : ' + A.error };
    if (!prim) return { tone: 'err', line: 'déconnecté · auto-DM en pause', pause: 'déconnecté' };
    if (tok && tok.expired) return { tone: 'err', line: 'token expiré le ' + dmy(tok.date) + ' · auto-DM en pause', pause: 'token expiré' };
    if (tok) return { tone: tok.days < 7 ? 'warn' : 'ok', line: 'connecté · token valide jusqu’au ' + dmy(tok.date) + ' (' + tok.days + NB + 'j)' };
    return { tone: 'ok', line: 'connecté · date d’expiration du token pas encore exposée par instagram-auth' };
  }
  function dmAcctHTML(D) {
    var st = dmAcctState(), A = CF.acct.accounts;
    var notes = [];
    if (D && !D.cron) notes.push('relance automatique : état du cron illisible');
    if (A.state === 'error') notes.push('comptes reliés : ' + A.error);
    return igSelHTML(!!st.pause)
      + (notes.length ? '<div class="cf-acct-why cf-acct2-notes">' + esc(notes.join(' · ')) + '</div>' : '')
      + reconMsg()
      + (st.pause ? banner('err', IC.alert, '<b>Auto-DM en pause</b> · Instagram ' + esc(st.pause) + ' : les nouveaux commentaires ne reçoivent plus de DM. Reconnecte @'
        + esc(selName()) + '. Les chiffres ci-dessous viennent de notre base et restent justes.') : '')
      + (D && D.cron && !D.cron.active ? banner('warn', IC.alert, '<b>Relance automatique arrêtée</b> · le cron ig-followup-hourly est inactif : plus aucune relance ne part.') : '');
  }

  function dmPeriodLine(S, D) {
    var P = DM_PERIOD[ui.dmRange], txt = P.per;
    if (D && D.since != null && D.until != null) {
      var a = paris(D.since), b = paris(D.until), n = { '7j': 7, '30j': 30, '90j': 90 }[ui.dmRange];
      if (ui.dmRange === '24h') txt = pDm(a) + ' ' + pHm(a) + ' → ' + pDm(b) + ' ' + pHm(b) + ' · 24' + NB + 'h glissantes';
      else if (ui.dmRange === 'all') txt = 'depuis le ' + pDmy(a) + (D.firstAt ? ' · 1er évènement le ' + pDmy(paris(D.firstAt)) : ' · aucun évènement');
      else txt = pDm(a) + ' → ' + pDmy(b) + ' · ' + n + ' jours, aujourd’hui compris' + (ui.dmRange === '90j' ? ' · par tranches de 7 jours' : '');
    }
    var when = D ? ' · heure de Paris · relevé à ' + hm(new Date(D.fetchedAt)) + (S.state === 'error' ? ' (actualisation échouée)' : '') : '';
    return '<span class="cf-over">Période sélectionnée</span> ' + esc(txt + when);
  }
  function dmBanner(S, D) {
    var retry = '<button type="button" class="cf-btn is-sm" data-act="retry-dm">Réessayer</button>';
    if (S.state === 'error') {
      if (S.kind === 'missing') return banner('warn', IC.alert, '<b>Auto-DM pas encore branché</b> · ' + esc(S.error) + '. Les chiffres restent à « — » en attendant.', retry);
      if (S.kind === 'forbidden') return banner('err', IC.alert, '<b>Accès refusé</b> · ' + esc(S.error));
      return banner('err', IC.alert, '<b>Erreur de chargement</b> · ' + esc(S.error) + (D ? ' · chiffres du ' + esc(hm(new Date(D.fetchedAt))) + ' conservés' : ''), retry);
    }
    if (S.loading) return '<div class="cf-status" role="status"><span class="cf-spin" aria-hidden="true"></span>' + (D ? 'Actualisation ' : 'Chargement de l’Auto-DM ') + esc(DM_PERIOD[ui.dmRange].per) + '…</div>';
    return '';
  }

  function dmActivityHTML(X) {
    var seg = DM_PERIODS.map(function (p) {
      var on = p.k === ui.dmRange;
      return '<button type="button" class="cf-seg-b' + (on ? ' is-on' : '') + '" data-act="dm-range" data-range="' + p.k + '" aria-pressed="' + on + '">' + esc(p.label) + '</button>';
    }).join('');
    return '<section class="cf-sec" aria-labelledby="cfDmT">'
      + '<div class="cf-sec-h"><div><h2 class="cf-h2" id="cfDmT">Activité · ' + esc(DM_STEP[X.step]) + '</h2></div>'
      + '<div class="cf-seg" role="group" aria-label="Période">' + seg + '</div></div>'
      + '<div class="cf-per">' + dmPeriodLine(X.S, X.D) + '</div>'
      + dmBanner(X.S, X.D)
      + '<div class="cf-icards cf-dcards">' + dmCardsHTML(X) + '</div>'
      + dmChartHTML(X)
      + '</section>';
  }
  function sparkSvg(arr) {
    var n = arr.length, max = Math.max.apply(null, arr.map(function (v) { return v || 0; }).concat([1]));
    var y = function (v) { return (22 - (v || 0) / max * 20).toFixed(1); };
    var d = n === 1 ? 'M0,' + y(arr[0]) + ' L100,' + y(arr[0])
      : arr.map(function (v, i) { return (i ? 'L' : 'M') + (i / (n - 1) * 100).toFixed(1) + ',' + y(v); }).join(' ');
    return '<svg class="cf-icard-sp" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="' + d
      + '" fill="none" stroke="var(--c)" stroke-width="1.75" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  }
  function dmCardsHTML(X) {
    return DMS.map(function (s) {
      var none = X.none[s.k], m = X.c[s.k], on = !none && !ui.dmHidden[s.k], v, sub, na = false;
      if (none) { v = '—'; sub = m.why; na = true; }
      else if (X.pending) { v = '…'; sub = 'chargement'; }
      else if (m.v == null) { v = '—'; sub = m.why; na = true; }
      else { v = fInt(m.v); sub = X.P.per + (s.k === 'users' ? X.paidTxt : ''); }
      var sp = !none && !X.pending && m.v != null && m.spark ? sparkSvg(m.spark) : '';
      var cls = 'cf-icard' + (none ? ' is-fixed is-none' : on ? ' is-on' : ' is-off');
      var inner = '<span class="cf-icard-h"><span class="cf-icard-tile">' + svg(s.ic, 14) + '</span><span class="cf-icard-l">' + esc(s.label) + '</span>'
        + (none ? '' : '<span class="cf-icard-ck" aria-hidden="true">' + (on ? svg('M5 12l5 5L20 7', 10) : '') + '</span>') + '</span>'
        + '<span class="cf-icard-v' + (na ? ' is-na' : '') + '">' + esc(v) + '</span>' + sp
        + '<span class="cf-icard-s">' + esc(sub) + '</span>';
      var attrs = ' style="--c:' + s.c + '" data-k="' + s.k + '"';
      return none ? '<div class="' + cls + '"' + attrs + '>' + inner + '</div>'
        : '<button type="button" class="' + cls + '"' + attrs + ' data-act="dm-toggle" aria-pressed="' + on + '">' + inner + '</button>';
    }).join('');
  }

  // ── courbe Activité : échelle linéaire, un point par groupe, total de la période à droite ──
  var dmCur = null;
  function niceTop(v) {
    for (var e = 1; e < 1e9; e *= 10) {
      var b = [2, 4, 6, 8, 10];
      for (var i = 0; i < b.length; i++) if (b[i] * e >= Math.max(4, v)) return b[i] * e;
    }
    return v;
  }
  function dmXLabel(p, step) {
    if (step === 'hour') return p.h != null ? p.h + NB + 'h' : '';
    if (!p.d) return '';
    var d = ymdDate(p.d);
    return step === 'month' ? d.toLocaleDateString('fr-FR', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2) : dm(d);
  }
  function dmTipLabel(s, i, step, until) {
    var p = s[i];
    if (!p.d) return '';
    var d = ymdDate(p.d), wd = d.toLocaleDateString('fr-FR', { weekday: 'short' });
    if (step === 'hour') return wd + ' ' + dm(d) + ' · ' + p.h + NB + 'h–' + ((p.h + 1) % 24) + NB + 'h';
    if (step === 'month') return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    if (step === 'week') {
      var e = s[i + 1] && s[i + 1].d ? new Date(ymdDate(s[i + 1].d).getTime() - 864e5) : (until != null ? (function (x) { return new Date(x.y, x.m - 1, x.d, 12); })(paris(until)) : d);
      return 'du ' + dm(d) + ' au ' + dm(e);
    }
    return wd + ' ' + dm(d);
  }
  function dmChartHTML(X) {
    var D = X.D, S = X.S;
    var what = X.noSrc ? 'Leads, « Je suis abonné », liens et clics' : 'Leads, « Je suis abonné », liens, clics et users';
    var head = '<div class="cf-evo-h"><h3 class="cf-h2">' + esc(what) + ' · ' + esc(DM_STEP[X.step]) + '</h3></div>';
    if (!D) {
      dmCur = null;
      return '<div class="cf-evo">' + head + (S.state === 'error' && !S.loading ? '<div class="cf-evo-msg">' + esc('Courbe indisponible : ' + X.why + '.') + '</div>'
        : '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement de la courbe…</div>') + '</div>';
    }
    var s = D.series, n = s.length;
    if (!n) { dmCur = null; return '<div class="cf-evo">' + head + '<div class="cf-evo-msg">Courbe indisponible pour cette période.</div></div>'; }
    var act = DMS.filter(function (d) { return !X.none[d.k] && !ui.dmHidden[d.k]; }).map(function (d) { return d.k; });
    var max = 0;
    act.forEach(function (k) { s.forEach(function (p) { if (p[k] > max) max = p[k]; }); });
    var top = niceTop(max);
    var Y = function (v) { return 296 - (v || 0) / top * 284; };
    var Xp = function (i) { return n > 1 ? i / (n - 1) * 1000 : 500; };
    var col = {}; DMS.forEach(function (d) { col[d.k] = d.c; });
    var paths = act.map(function (k) {
      var d = s.map(function (p, i) { return (i ? ' L' : 'M') + Xp(i).toFixed(1) + ',' + Y(p[k]).toFixed(1); }).join('');
      return '<path d="' + d + '" style="stroke:' + col[k] + '" fill="none" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>';
    }).join('');
    var dots = n <= 31 ? act.map(function (k) {
      return s.map(function (p, i) { return '<span class="cf-dm-pt" style="left:' + (n > 1 ? i / (n - 1) * 100 : 50).toFixed(2) + '%;top:' + (Y(p[k]) / 3).toFixed(2) + '%;background:' + col[k] + '"></span>'; }).join('');
    }).join('') : '';
    var ticks = [0, top / 2, top];
    var yl = ticks.map(function (t) { return '<span style="top:' + (Y(t) / 3).toFixed(2) + '%">' + esc(fInt(t)) + '</span>'; }).join('');
    var grid = ticks.map(function (t, i) { return '<i class="cf-evo-grid' + (i ? '' : ' is-zero') + '" style="top:' + (Y(t) / 3).toFixed(2) + '%"></i>'; }).join('');
    var idx = [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(3 * (n - 1) / 4), n - 1].filter(function (v, i, a) { return a.indexOf(v) === i; });
    var xl = idx.map(function (i) { return '<span>' + esc(dmXLabel(s[i], X.step)) + '</span>'; }).join('');
    var lg = DMS.map(function (d) {
      var m = X.c[d.k], hid = !X.none[d.k] && !!ui.dmHidden[d.k];
      return '<div class="cf-evo-lg' + (hid || X.none[d.k] ? ' is-off' : '') + '"><span class="cf-sq" style="background:' + d.c + '"></span><b>' + esc(m.v == null ? '—' : fInt(m.v)) + '</b><span>' + esc(d.label) + '</span></div>';
    }).join('');
    var empty = X.F.commented === 0 ? '<div class="cf-dm-empty"><b>Aucune activité sur la période</b><span>se remplit au premier commentaire mot-clé</span></div>' : '';
    dmCur = { n: n, s: s, act: act, Y: Y, step: X.step, until: D.until, col: col };
    return '<div class="cf-evo">' + head
      + '<div class="cf-evo-body">'
      + '<div class="cf-evo-y" aria-hidden="true">' + yl + '</div>'
      + '<div class="cf-evo-main">'
      + '<div class="cf-evo-plot" data-chart="dm" role="img" aria-label="' + esc(what + ' ' + DM_STEP[X.step] + ', ' + X.P.per) + '">' + grid
      + '<svg class="cf-evo-svg" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + paths + '</svg>'
      + dots + empty + '<div class="cf-evo-hover" hidden></div></div>'
      + '<div class="cf-evo-x" aria-hidden="true">' + xl + '</div>'
      + '<div class="cf-meta cf-evo-note">heure de Paris · toucher une carte affiche / masque sa courbe</div>'
      + '</div>'
      + '<div class="cf-evo-legend"><div class="cf-over">total période</div>' + lg + '</div>'
      + '</div></div>';
  }
  // Bulle : valeurs du groupe + cumul depuis le début de la période (additif : une personne n'est que dans un groupe).
  function dmHover(plot, clientX) {
    var ch = dmCur;
    if (!ch || ch.n < 1 || !plot) return;
    var r = plot.getBoundingClientRect();
    if (!r.width) return;
    var i = ch.n > 1 ? Math.round((clientX - r.left) / r.width * (ch.n - 1)) : 0;
    i = Math.max(0, Math.min(ch.n - 1, i));
    var box = plot.querySelector('.cf-evo-hover');
    if (!box || (box._i === i && !box.hidden)) return;
    box._i = i;
    var x = ch.n > 1 ? i / (ch.n - 1) * 100 : 50, dots = '', rows = '';
    DMS.forEach(function (d) {
      if (ch.act.indexOf(d.k) < 0) return;
      var v = ch.s[i][d.k], cum = 0, ok = true;
      for (var j = 0; j <= i; j++) { if (ch.s[j][d.k] == null) { ok = false; break; } cum += ch.s[j][d.k]; }
      if (v != null) dots += '<span class="cf-evo-dot" style="left:' + x + '%;top:' + (ch.Y(v) / 3).toFixed(2) + '%;background:' + d.c + '"></span>';
      rows += '<div class="cf-evo-tr"><span><span class="cf-sq" style="background:' + d.c + '"></span>' + esc(d.label) + '</span><span>' + esc(v == null ? '—' : fInt(v)) + '</span><b>' + esc(ok ? fInt(cum) : '—') + '</b></div>';
    });
    box.innerHTML = '<span class="cf-evo-vl" style="left:' + x + '%"></span>' + dots
      + '<div class="cf-evo-tip"><div class="cf-evo-tr is-h"><span>' + esc(dmTipLabel(ch.s, i, ch.step, ch.until)) + '</span><span>' + esc(DM_STEP_H[ch.step]) + '</span><span>cumul</span></div>' + rows + '</div>';
    box.hidden = false;
    var tip = box.querySelector('.cf-evo-tip'), W = r.width, w = tip.offsetWidth, px = x / 100 * W;
    var left = px + 12 + w <= W ? px + 12 : px - 12 - w;
    tip.style.left = Math.max(0, Math.min(W - w, left)) + 'px';
  }

  // ── taux de la période (barres : flex none + hauteur mini, jamais écrasées) ──
  function dmRatesHTML(X) {
    return '<section class="cf-rates" aria-label="' + esc('Taux ' + X.P.per) + '">' + X.rates.map(function (r) {
      var v = X.pending ? '…' : r.v == null ? '—' : fP1(r.v);
      var sub = X.pending ? 'chargement' : r.v == null ? r.na : r.sub;
      var fill = r.v == null || X.pending ? 0 : Math.max(0, Math.min(100, r.v));
      return '<div class="cf-rate" data-rate="' + r.k + '"><span class="cf-rate-h"><span class="cf-rate-ic">' + svg(r.ic, 14) + '</span><span class="cf-rate-l">' + esc(r.label) + '</span></span>'
        + '<span class="cf-rate-v' + (v === '—' ? ' is-na' : '') + '">' + esc(v) + '</span>'
        + '<span class="cf-rate-bar' + (r.none ? ' is-none' : '') + '"><i style="width:' + fill.toFixed(1) + '%"></i></span>'
        + '<span class="cf-rate-s">' + esc(sub) + '</span></div>';
    }).join('') + '</section>';
  }

  // ── funnel en personnes uniques + relance (lecture seule) ──
  function dmFunnelHTML(X) {
    var F = X.F, R = X.R, P = X.P, pct = X.pct, top = F.commented;
    var val = function (v) { return X.pending ? '…' : v == null ? '—' : fInt(v); };
    var rt = function (v) { return v == null ? '—' : fP1(v); };
    var rr = function (v, suffix) { return v == null ? '—' : fP1(v) + suffix; };
    var steps = [
      { l: 'Commentaire mot-clé', s: 'personnes uniques', v: F.commented },
      { l: 'A tapé « Je suis abonné »', s: 'bouton du 1er DM', v: F.tapped, r: rr(pct(F.tapped, F.commented), ' des leads') },
      { l: 'Lien reçu', s: 'abonnement vérifié', v: F.linked,
        r: rt(pct(F.linked, F.tapped)) + (X.blocked ? ' · ' + X.blocked + ' ' + plural(X.blocked, 'bloquée') + ' : pas encore ' + plural(X.blocked, 'abonnée') : '') },
      { l: 'Clic sur le lien', s: 'lien tracké ouvert', v: F.clicked, r: rr(pct(F.clicked, F.linked), ' CTR') },
      { l: 'Devenu user AvatarAds', s: 'compte créé après le clic', v: F.users, none: X.noSrc,
        r: X.noSrc ? '— · ' + DM_NOSRC : rr(pct(F.users, F.clicked), ' des clics') + X.paidTxt }
    ];
    var rows = steps.map(function (st, i) {
      var w = !st.none && st.v && top ? Math.max(1.5, st.v / top * 100) : 0;
      return (i ? '<div class="cf-fun-r"><span class="cf-fun-ar">' + svg(IC.down, 12) + '</span><span class="cf-fun-rt">' + esc(X.pending ? '…' : st.r) + '</span></div>' : '')
        + '<div class="cf-fun-s l' + (i + 1) + (st.none ? ' is-none' : '') + '"><div class="cf-fun-h"><span class="cf-fun-l"><b>' + esc(st.l) + '</b> <span class="cf-meta">' + esc(st.s) + '</span></span>'
        + '<b class="cf-fun-v' + (st.v == null && !X.pending ? ' is-na' : '') + '">' + esc(st.none ? '—' : val(st.v)) + '</b></div>'
        + '<div class="cf-fun-bar"><i style="width:' + w.toFixed(1) + '%"></i></div></div>';
    }).join('');
    var hit = pct(F.clicked, F.commented);
    var headR = '<div class="cf-fun-kpi"><b>' + esc(X.pending ? '…' : rt(hit)) + '</b><span>' + esc(hit == null && !X.pending && top === 0 ? 'aucun lead ' + P.per : 'des leads ont cliqué') + '</span></div>';
    var tile = function (label, v, sub) {
      return '<div class="cf-tile"><div class="cf-tile-l">' + esc(label) + '</div><div class="cf-tile-v' + (v == null ? ' is-na' : '') + '">' + esc(X.pending ? '…' : v == null ? '—' : fInt(v)) + '</div>'
        + (sub ? '<div class="cf-tile-w">' + esc(sub) + '</div>' : '') + '</div>';
    };
    var rel = '<div class="cf-dmrel"><div class="cf-over">Relance automatique · lecture seule</div>'
      + '<div class="cf-tiles cf-dmrel-t">'
      + tile('lien reçu, pas cliqué', X.unc, '')
      + tile('relancées', R.done, R.doneClicked ? 'dont ' + R.doneClicked + ' ' + plural(R.doneClicked, 'a', 'ont') + ' cliqué après' : '')
      + tile('relance prévue', R.planned, 'lien de moins de 22' + NB + 'h')
      + tile('sans relance', R.missed, 'fenêtre passée ou déjà relancée avant')
      + '</div></div>';
    return '<section class="cf-card"><div class="cf-card-h"><div><h2 class="cf-h2">Funnel de conversion</h2>'
      + '<span class="cf-meta">' + esc('commentaire → « Je suis abonné » → lien reçu → clic' + (X.noSrc ? '' : ' → compte créé') + ' · personnes uniques · ' + P.per) + '</span></div>' + headR + '</div>'
      + (X.D && X.D.late ? '<div class="cf-meta">' + esc('+ ' + X.D.late + ' ' + plural(X.D.late, 'personne') + ' ' + plural(X.D.late, 'a', 'ont') + ' tapé le bouton pendant la période après un commentaire plus ancien : comptée' + (X.D.late > 1 ? 's' : '') + ' dans la période de ce commentaire') + '</div>' : '')
      + '<div class="cf-fun">' + rows + '</div>' + dmExistingNote(X) + rel + '</section>';
  }
  // Comptes AvatarAds DÉJÀ existants au clic : jamais comptés en « Devenus users » ; leur passage payant après le clic
  // est montré à part (distinct des nouveaux users payants). Totaux seulement.
  function dmExistingNote(X) {
    var A = X.A, n = A.existing, k = A.existingPaid;
    if (X.pending || X.noSrc || !n) return '';
    return '<div class="cf-meta cf-dm-exist">' + esc('+ ' + fInt(n) + ' ' + plural(n, 'compte AvatarAds déjà existant', 'comptes AvatarAds déjà existants')
      + ' au clic (' + plural(n, 'pas compté', 'pas comptés') + ' en users) · ' + fInt(k || 0) + ' ' + plural(k, 'passé payant', 'passés payants') + ' après le clic') + '</div>';
  }

  // ── performance par post (miniature et légende : liste des publications d'ig-insights, même cache que Compte) ──
  function dmPostsHTML(X) {
    var D = X.D, P = X.P;
    var head = '<div class="cf-card-h"><div><h2 class="cf-h2">Performance par post</h2><span class="cf-meta">'
      + esc('leads par publication · ' + P.per + ' · une personne qui commente deux posts compte dans chacun') + '</span></div></div>';
    var body;
    if (X.pending) body = '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement…</div>';
    else if (!D) body = emptyLine('—', X.why);
    else if (!D.posts.length) body = '<div class="cf-empty-s cf-dashed">Aucun post avec mot-clé ' + esc(P.per) + '.</div>';
    else {
      var MS = CF.acct.media, MD = MS.data, byId = {};
      if (MD) MD.list.forEach(function (p) { if (p.id) byId[p.id] = p; });
      var maxL = Math.max.apply(null, D.posts.map(function (r) { return r.commented || 0; }).concat([1]));
      var list = ui.dmAllPosts ? D.posts : D.posts.slice(0, 8);
      body = '<div class="cf-dmposts">' + list.map(function (r, i) { return dmPostRow(r, i, byId[r.id], maxL, MS); }).join('') + '</div>'
        + (D.posts.length > 8 ? '<button type="button" class="cf-btn is-sm cf-more" data-act="dm-all-posts">' + esc(ui.dmAllPosts ? 'Afficher seulement les 8 premiers' : 'Afficher les ' + D.posts.length + ' publications') + '</button>' : '');
    }
    return '<section class="cf-card">' + head + body + '</section>';
  }
  function dmPostRow(r, i, p, maxL, MS) {
    var thumb = p ? safeUrl(p.thumb) : '', d = p ? validDate(p.timestamp) : null, vid = p ? videoId(p) : null;
    var meta = p ? (d ? 'posté le ' + dmy(d) : 'date inconnue')
      : MS.loading || MS.state === 'idle' ? 'chargement de l’aperçu…'
        : 'aperçu indisponible · ' + (MS.kind === 'disconnected' ? 'Instagram déconnecté' : MS.data ? 'absente de la liste Instagram' : (MS.error || 'publications non chargées'));
    var n = function (v) { return v == null ? '—' : fInt(v); };
    var inner = '<span class="cf-post-rank">' + (i + 1) + '</span>'
      + '<span class="cf-thumb">' + (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '')
      + (p && isVideo(p) ? '<span class="cf-thumb-play">' + svg(IC.play, 10) + '</span>' : '') + '</span>'
      + '<span class="cf-dmpost-b"><span class="cf-dmpost-id"><b class="' + (vid ? 'cf-vid' : 'cf-dmpost-nr') + '">' + esc(vid || (p ? 'vidéo non reconnue' : 'publication Instagram')) + '</b>'
      + '<span class="cf-meta">' + esc(meta) + '</span></span>'
      + (p ? '<span class="cf-dmpost-cap">' + esc(capText(p.caption)) + '</span>' : '') + '</span>'
      + '<span class="cf-dmpost-m">'
      + '<span class="cf-dmpost-k is-leads"><span class="cf-over">leads</span><span class="cf-dmpost-kv"><span class="cf-dmpost-lb" aria-hidden="true"><i style="width:' + ((r.commented || 0) / maxL * 100).toFixed(1) + '%"></i></span><b>' + n(r.commented) + '</b></span></span>'
      + '<span class="cf-dmpost-k"><span class="cf-over">liens</span><b>' + n(r.linked) + '</b></span>'
      + '<span class="cf-dmpost-k"><span class="cf-over">clics</span><b>' + n(r.clicked) + '</b></span>'
      + '<span class="cf-dmpost-k"><span class="cf-over">CTR</span><b>' + esc(r.linked ? fDec(r.clicked / r.linked * 100, 0) + NB + '%' : '—') + '</b></span>'
      + '</span>';
    return p ? '<button type="button" class="cf-dmpost" data-act="dm-post" data-pid="' + esc(r.id) + '" aria-label="' + esc('Ouvrir la fiche de la publication ' + (i + 1)) + '">' + inner + '</button>'
      : '<div class="cf-dmpost is-static">' + inner + '</div>';
  }

  // ── meilleures heures : commentaires mot-clé par jour × heure (heure de Paris), 5 niveaux ──
  function dmHeatHTML(X) {
    var D = X.D, P = X.P;
    var lvls = [0, 1, 2, 3, 4].map(function (l) { return '<i class="l' + l + '"></i>'; }).join('');
    var head = '<div class="cf-card-h"><div><h2 class="cf-h2">Meilleures heures</h2><span class="cf-meta">' + esc('commentaires mot-clé par jour et par heure · ' + P.per + ' · heure de Paris') + '</span></div>'
      + '<div class="cf-heat-lg" aria-hidden="true"><span>moins</span>' + lvls + '<span>plus</span></div></div>';
    var body;
    if (X.pending) body = '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement…</div>';
    else if (!D) body = emptyLine('—', X.why);
    else if (!D.heat.length) body = '<div class="cf-empty-s cf-dashed">Pas encore de commentaire ' + esc(P.per) + '.</div>';
    else {
      var M = {}, max = 0;
      D.heat.forEach(function (c) { M[c.dow + ':' + c.h] = c.n; if (c.n > max) max = c.n; });
      var lvl = function (n) { return !n ? 0 : n / max <= 0.25 ? 1 : n / max <= 0.5 ? 2 : n / max <= 0.75 ? 3 : 4; };
      var hx = '<div class="cf-heat-r is-x" aria-hidden="true"><span></span>';
      for (var h = 0; h < 24; h++) hx += '<span>' + (h % 3 ? '' : h) + '</span>';
      hx += '</div>';
      var rows = DOW.map(function (dn, di) {
        var cells = '';
        for (var hh = 0; hh < 24; hh++) {
          var v = M[(di + 1) + ':' + hh] || 0;
          cells += '<i class="l' + lvl(v) + '" title="' + esc(dn + ' ' + hh + NB + 'h · ' + v + ' ' + plural(v, 'commentaire')) + '"></i>';
        }
        return '<div class="cf-heat-r"><span class="cf-heat-d">' + esc(dn) + '</span>' + cells + '</div>';
      }).join('');
      var best = D.heat.slice().sort(function (a, b) { return b.n - a.n || a.dow - b.dow || a.h - b.h; }).slice(0, 3);
      var chips = best.map(function (c, i) {
        return '<span class="cf-heat-b"><b>#' + (i + 1) + '</b> ' + esc(DOW[c.dow - 1] + ' ' + c.h + NB + 'h – ' + ((c.h + 1) % 24) + NB + 'h') + ' <span class="cf-meta">' + esc(c.n + ' comm.') + '</span></span>';
      }).join('');
      body = '<div class="cf-heat" role="img" aria-label="' + esc('Carte de chaleur des commentaires mot-clé ' + P.per + ', meilleur créneau : ' + DOW[best[0].dow - 1] + ' ' + best[0].h + ' h') + '">' + hx + rows + '</div>'
        + '<div class="cf-heat-best">' + chips + '</div>';
    }
    return '<section class="cf-card">' + head + body + '</section>';
  }

  // ── leads récents : pseudo + étape seulement (la RPC ne renvoie rien d'autre) ──
  var DM_FILTERS = [
    ['all', 'Tous', function () { return true; }],
    ['clicked', 'Cliqué', function (l) { return l.clicked; }],
    ['linked', 'Lien reçu', function (l) { return l.linked; }],
    ['blocked', 'Pas encore abonné', function (l) { return l.tapped && !l.linked; }],
    ['planned', 'Relance prévue', function (l) { return l.rel === 'planned'; }],
    ['done', 'Relancé', function (l) { return l.rel === 'done'; }]
  ];
  function dmLeadsHTML(X) {
    var D = X.D, P = X.P, L = D ? D.leads : [];
    var q = ui.dmQuery.trim().replace(/^@/, '').toLowerCase();
    var F = DM_FILTERS.filter(function (f) { return f[0] === ui.dmFilter; })[0] || DM_FILTERS[0];
    var hitQ = function (l) { return !q || (l.u || '').toLowerCase().indexOf(q) >= 0; };
    var shownAll = L.filter(function (l) { return F[2](l) && hitQ(l); });
    var shown = ui.dmAllLeads ? shownAll : shownAll.slice(0, 8);
    var total = D ? D.leadsTotal : null;
    var badge = X.pending ? '…' : total == null ? '—' : (shownAll.length !== L.length ? fInt(shownAll.length) + ' / ' : '') + fInt(total);
    var head = '<div class="cf-card-h"><div><h2 class="cf-h2">Leads récents <span class="cf-badge">' + esc(badge) + '</span></h2>'
      + '<span class="cf-meta">' + esc(P.per + ' · pseudo Instagram et étape seulement' + (total != null && total > L.length ? ' · les ' + L.length + ' plus récents' : '')) + '</span></div>'
      + '<label class="cf-search">' + svg(IC.search, 14) + '<input id="cfDmQ" type="search" value="' + esc(ui.dmQuery) + '" placeholder="Rechercher un @pseudo" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Rechercher un lead par pseudo"></label></div>';
    var chips = '<div class="cf-fchips" role="group" aria-label="Filtrer les leads">' + DM_FILTERS.map(function (f) {
      var on = f[0] === F[0], nb = L.filter(function (l) { return f[2](l) && hitQ(l); }).length;
      return '<button type="button" class="cf-fchip' + (on ? ' is-on' : '') + '" data-act="dm-filter" data-f="' + f[0] + '" aria-pressed="' + on + '">' + esc(f[1]) + ' <span>' + (D ? nb : '…') + '</span></button>';
    }).join('') + '</div>';
    var body;
    if (X.pending) body = '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement des leads…</div>';
    else if (!D) body = emptyLine('—', X.why);
    else if (!L.length) body = '<div class="cf-dm-none"><span class="cf-soon-ic">' + svg(IC.chat, 18) + '</span><b>Aucun lead ' + esc(P.per) + '</b>'
      + '<span>Dès qu’une personne commente un mot-clé sous une publication, elle reçoit le DM et apparaît ici.</span></div>';
    else if (!shownAll.length) body = '<div class="cf-empty-s">Aucun lead ne correspond' + (q ? ' à « ' + esc(ui.dmQuery.trim()) + ' »' : '') + '.</div>';
    else body = '<div class="cf-leads">' + shown.map(dmLeadRow).join('') + '</div>'
      + (shownAll.length > 8 ? '<button type="button" class="cf-btn is-sm cf-more" data-act="dm-all-leads">' + esc(ui.dmAllLeads ? 'Afficher seulement les 8 premiers' : 'Afficher les ' + shownAll.length + ' leads') + '</button>' : '');
    return '<section class="cf-card">' + head + (D && L.length ? chips : '') + body + '</section>';
  }
  function dmLeadRow(l) {
    var ini = l.u ? (l.u.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '@') : '?';
    var chips = [];
    if (!l.tapped) chips.push('<span class="cf-lchip">a commenté</span>');
    else if (!l.linked) chips.push('<span class="cf-lchip is-block">pas encore abonné</span>');
    if (l.linked) chips.push('<span class="cf-lchip is-link">lien reçu</span>');
    if (l.clicked) chips.push('<span class="cf-lchip is-click">cliqué</span>');
    if (l.rel === 'planned') chips.push('<span class="cf-lchip is-plan" title="le backend relance 12 à 22 h après le lien">relance prévue</span>');
    else if (l.rel === 'done') chips.push('<span class="cf-lchip is-done">relancé</span>');
    else if (l.rel === 'missed') chips.push('<span class="cf-lchip is-muted" title="fenêtre de 12 à 22 h passée, ou déjà relancé / cliqué avant">pas de relance</span>');
    var st = [true, l.tapped, l.linked, l.clicked], names = ['commentaire', 'bouton tapé', 'lien reçu', 'clic'];
    var path = st.map(function (on, i) { return (i ? '<i class="' + (on ? 'is-on' : '') + '"></i>' : '') + '<b class="' + (on ? 'is-on' : '') + '"></b>'; }).join('');
    var reached = names.filter(function (n, i) { return st[i]; }).join(', ');
    var t = paris(l.at);
    return '<div class="cf-lead"><span class="cf-lead-av" aria-hidden="true">' + esc(ini) + '</span>'
      + '<span class="cf-lead-u' + (l.u ? '' : ' is-na') + '">' + esc(l.u ? '@' + l.u : 'pseudo inconnu') + '</span>'
      + '<span class="cf-lead-st">' + chips.join('') + '</span>'
      + '<span class="cf-lead-path" role="img" aria-label="' + esc('Parcours : ' + reached) + '">' + path + '</span>'
      + '<span class="cf-lead-at" title="' + esc('1er commentaire de la période le ' + pDmy(t) + ' à ' + pHm(t) + ' (Paris)') + '">' + esc(ago(l.at)) + '</span></div>';
  }

  // ── fiche post (modale) ──
  function openPostById(pid, trigger) {
    var MD = CF.acct.media.data, p = MD && MD.list.filter(function (x) { return x.id === pid; })[0];
    if (!p) return;
    ui.modal = { post: p, rank: rankOf(p), pid: pid };
    ui.lastFocus = trigger || null;
    renderModal();
    var wrap = document.querySelector('.cf-wrap'); if (wrap) wrap.inert = true;
    $('cfModal').hidden = false;
    document.body.classList.add('cf-lock');
    $('cfModalClose').focus();
  }
  function openPost(i, trigger) {
    var list = topList();
    if (!list[i]) return;
    ui.modal = { post: list[i], rank: i + 1 };
    ui.lastFocus = trigger || null;
    renderModal();
    var wrap = document.querySelector('.cf-wrap'); if (wrap) wrap.inert = true;   // Tab reste dans la fiche
    $('cfModal').hidden = false;
    document.body.classList.add('cf-lock');
    $('cfModalClose').focus();
  }
  function closeModal() {
    if (!ui.modal) return;
    var rank = ui.modal.rank, pid = ui.modal.pid;
    ui.modal = null;
    var wrap = document.querySelector('.cf-wrap'); if (wrap) wrap.inert = false;
    $('cfModal').hidden = true;
    document.body.classList.remove('cf-lock');
    setHTML($('cfModalBody'), '');
    var f = ui.lastFocus;
    ui.lastFocus = null;
    if (f && document.body.contains(f)) f.focus();
    else {
      var c = pid ? document.querySelector('.cf-dmpost[data-pid="' + pid + '"]') : document.querySelector('.cf-post[data-i="' + (rank - 1) + '"]');
      if (c) c.focus();
    }
  }
  function bricksDetail(p) {
    var a = p.analysis;
    if (!a) return '';
    if (a.status === 'pending') return '<div class="cf-meta">briques : transcription en cours, la fiche se met à jour toute seule</div>';
    if (a.status === 'error') return '<div class="cf-meta">briques : analyse impossible · ' + esc(a.error || '') + '</div>';
    if (a.noVoice) return '<div class="cf-meta">vidéo sans voix (musique seule) : aucune brique parlée à reconnaître, choisis le module à la main</div>';
    if (!a.bricks.length) return '<div class="cf-meta">aucune brique reconnue dans l’audio de cette vidéo</div>';
    return '<div class="cf-brick-ids">' + a.bricks.map(function (b, i) {
      return (i ? '<span class="cf-plus" aria-hidden="true">+</span>' : '') + '<button type="button" class="cf-chip is-brick is-btn" data-act="brick-open" data-bid="' + esc(b.id) + '" title="'
        + esc(KIND_L[b.kind] + ' · ' + b.label) + '">' + esc(b.id) + '</button>';
    }).join('') + '</div>';
  }

  // « likes 74 · 2,2 % » : le nombre et son taux (÷ vues), coloré selon l'objectif.
  function tileRate(label, p, g, vid) {
    var c = p[g.f], v = vid ? rateOf(p, g) : null;
    return '<div class="cf-tile"><div class="cf-tile-l">' + esc(label + (vid ? ' · ' + goalTxt(g) : '')) + '</div>'
      + '<div class="cf-tile-v' + (c == null ? ' is-na' : '') + '">' + esc(c == null ? '—' : fInt(c))
      + (v != null ? ' <span class="cf-tile-r' + (g.target == null ? '' : goalOk(g, v) ? ' is-ok' : ' is-ko') + '">' + esc(fRate(v)) + '</span>' : '') + '</div>'
      + (c == null ? '<div class="cf-tile-w">non fourni par l’API</div>' : '') + '</div>';
  }
  function tileWatch(p, vid) {
    var r = retentionOf(p);
    if (p.avgWatchS == null) return tile('visionnage moyen', null, vid ? 'non fourni par l’API' : 'pas fourni pour ce type de publication');
    return '<div class="cf-tile"><div class="cf-tile-l">' + esc('visionnage moyen · ' + goalTxt(GOAL.watch)) + '</div>'
      + '<div class="cf-tile-v">' + esc(fSec(p.avgWatchS) + (p.durationS ? ' / ' + fSec0(p.durationS) : ''))
      + (r != null ? ' <span class="cf-tile-r ' + (goalOk(GOAL.watch, r) ? 'is-ok' : 'is-ko') + '">' + esc(fRate(r)) + '</span>' : '') + '</div>'
      + '</div>';
  }
  function tile(label, v, why) {
    return '<div class="cf-tile"><div class="cf-tile-l">' + esc(label) + '</div>'
      + '<div class="cf-tile-v' + (v == null ? ' is-na' : '') + '">' + esc(v == null ? '—' : v) + '</div>'
      + (v == null && why ? '<div class="cf-tile-w">' + esc(why) + '</div>' : '') + '</div>';
  }
  // ── fiche d'une brique (maquette Claude Design) : ses publications Instagram reconnues, vues, courbe ──
  // ID complet d'une vidéo = sa recette (plan §3.2) : ses briques reconnues, hook → liaison → CTA.
  function videoId(p) {
    var a = p.analysis;
    if (!a || a.status !== 'done' || !a.bricks.length) return null;
    var order = { hook: 0, liaison: 1, cta: 2 };
    return a.bricks.slice().sort(function (x, y) { return order[x.kind] - order[y.kind]; }).map(function (b) { return b.id; }).join(' · ');
  }
  function brickUses(id) {
    var MD = CF.acct.media.data, info = null;
    var uses = (MD ? MD.list : []).filter(function (p) {
      var hit = p.analysis && p.analysis.status === 'done' && p.analysis.bricks.filter(function (b) { return b.id === id; })[0];
      if (hit && !info) info = hit;
      // recette du kit (toutes les briques : musique, sous-titres, avatar, démo, texte choc, transformation…)
      // Axel 30/09 : « ignore les anciens reels, on le fait à partir de maintenant » → seuls les reels reliés au kit comptent
      return !!(p.recipe && p.recipe.ids.indexOf(id) >= 0);
    }).sort(function (a, b) { return (a.ms || 0) - (b.ms || 0); });
    return { info: info, uses: uses };
  }
  function rankOf(p) {
    var MD = CF.acct.media.data; if (!MD) return null;
    var all = MD.list.filter(function (x) { return x.views != null; }).sort(function (a, b) { return b.views - a.views; });
    var i = all.indexOf(p); return i >= 0 ? i + 1 : null;
  }
  // Module d'une publication : enregistré tout de suite, message sous les pastilles.
  function setTag(el) {
    var id = el.getAttribute('data-tag-id'), v = el.getAttribute('data-mod') || '';
    [].forEach.call(document.querySelectorAll('#cfModalBody .cf-mod'), function (b) { b.disabled = true; });
    CF.tagMedia(id, v).then(function (r) {
      ui.tagMsg = { id: id, ok: !r.error, text: r.error ? 'Non enregistré : ' + r.error : (v ? 'Enregistré : ' + CF.MODULES[v] : 'Module retiré') };
      schedule();
      setTimeout(function () { var b = document.querySelector('#cfModalBody .cf-mod[data-tag-id="' + id + '"].is-on') || document.querySelector('#cfModalBody .cf-mod'); if (b) b.focus(); }, 0);
    });
  }
  function openBrick(id, trigger) {
    if (!id) return;
    if (CF.acct.media.state !== 'ready' && !CF.acct.media.loading) CF.loadMedia().then(function () { if (ui.modal && ui.modal.brick === id) renderModal(); });   // publications : pour l'historique de la brique
    if (!ui.modal) { openModal({ brick: id, solo: true }, trigger); return; }   // depuis l'onglet Production : la fiche seule
    ui.modal.brick = id; ui.modal.avImg = null;
    renderModal();
    $('cfModalBody').scrollTop = 0;
    var bk = document.querySelector('#cfModalBody [data-act="brick-back"]'); if (bk) bk.focus();
  }
  function brickBack() {
    if (!ui.modal || ui.modal.solo) return;
    var id = ui.modal.brick; ui.modal.brick = null;
    renderModal();
    var b = [].slice.call(document.querySelectorAll('#cfModalBody [data-bid]')).filter(function (x) { return x.getAttribute('data-bid') === id; })[0];
    if (b) b.focus();
  }
  function brickPost(pid) {
    var MD = CF.acct.media.data, p = MD && MD.list.filter(function (x) { return x.id === pid; })[0];
    if (!p) return;
    ui.modal = { post: p, rank: rankOf(p), pid: ui.modal.pid };   // pid : ouverte depuis l'Auto-DM
    renderModal();
    $('cfModalBody').scrollTop = 0;
    var t = $('cfModalTitle'); if (t) { t.tabIndex = -1; t.focus(); }
  }
  var SHEET_KIND = { hook: 'Hook', liaison: 'Liaison', cta: 'CTA', contenu: 'Contenu / Démo', musique: 'Musique', 'sous-titre': 'Sous-titres', transformation: 'Transformation', avatar: 'Avatar', format: 'Format de hook', 'texte-choc': 'Texte choc', 'style-choc': 'Style de texte choc', reaction: 'Tête choquée' };
  function fMmss(v) { var t = Math.round(v); return p2(Math.floor(t / 60)) + ':' + p2(t % 60); }
  var PLAY_P = 'M7 4l13 8-13 8z', PAUSE_P = 'M6 4h4v16H6zM14 4h4v16h-4z';
  function glyph(p, s) { return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="' + p + '"/></svg>'; }
  // Lecteur audio de la maquette (fiche brique) : bouton rond, piste, durée ; l'<audio> reste caché (jamais la barre grise
  // du navigateur). top = grand lecteur pleine largeur (musique), sinon la tuile 200 px sous la colonne de gauche.
  function aplayHTML(src, dur, top) {
    return '<div class="cf-aplay cf-mbox' + (top ? ' is-top' : '') + '">'
      + '<button type="button" class="cf-aplay-b" data-act="aplay" aria-label="Lire l’audio">' + glyph(PLAY_P, top ? 12 : 10) + '</button>'
      + (top ? '<span class="cf-aplay-c">00:00</span>' : '')
      + '<span class="cf-aplay-t"><i></i></span><span class="cf-aplay-d">' + (dur != null ? fMmss(dur) : '--:--') + '</span>'
      + '<audio preload="metadata" src="' + esc(src) + '"></audio><span class="cf-vmsg">audio illisible</span></div>';
  }
  function aplayState(a) {
    var box = a && a.closest ? a.closest('.cf-aplay') : null;
    if (!box) return;
    var b = box.querySelector('.cf-aplay-b'), on = !a.paused && !a.ended, d = isFinite(a.duration) && a.duration > 0 ? a.duration : null;
    if (b && b.getAttribute('data-on') !== String(on)) {
      b.setAttribute('data-on', String(on)); b.innerHTML = glyph(on ? PAUSE_P : PLAY_P, box.classList.contains('is-top') ? 12 : 10);
      b.setAttribute('aria-label', on ? 'Mettre l’audio en pause' : 'Lire l’audio');
    }
    var i = box.querySelector('.cf-aplay-t i'); if (i) i.style.width = (d ? Math.min(100, a.currentTime / d * 100) : 0).toFixed(1) + '%';
    var c = box.querySelector('.cf-aplay-c'); if (c) c.textContent = fMmss(a.currentTime || 0);
    var t = box.querySelector('.cf-aplay-d'); if (t && d) t.textContent = fMmss(d);
  }
  function aplayToggle(btn) {
    var box = btn.closest('.cf-aplay'), a = box && box.querySelector('audio');
    if (!a) return;
    if (a.paused || a.ended) {
      [].forEach.call(document.querySelectorAll('#cfModalBody audio'), function (x) { if (x !== a && !x.paused) x.pause(); });
      try { var pr = a.play(); if (pr && pr.catch) pr.catch(function () { box.classList.add('is-broken'); }); } catch (e) { box.classList.add('is-broken'); }
    } else a.pause();
  }
  // Fiche d'une brique (maquette Claude Design 11, 27, 28) : sa ligne factory_bricks (fichier, texte, mot-clé) quand la
  // Production est chargée, et ses publications Instagram reconnues (vues, courbe). Jamais de lecteur cassé : un fichier
  // absent = « fichier manquant ».
  function brickSheetHTML(id) {
    var U = brickUses(id), info = U.info, uses = U.uses, M = prodModel(), fb = Object.prototype.hasOwnProperty.call(M.byId, id) ? M.byId[id] : null, m = fb ? fb.meta : {};
    var kind = (fb && fb.kind) || (info && info.kind) || '';
    var b = { id: id, kind: kind, label: (fb && fb.label) || (info && info.label) || id, text: m.transcript || m.script || (info && info.text) || null,
      keyword: m.keyword || (info && info.keyword) || null, subject: (fb && fb.subject) || (info && info.subject) || null,
      audio: (fb && fb.audio) || (info && info.audio) || null };
    var heard = true, spoken = !!SPOKEN_V[kind];   // 30/09 : toute brique se mesure par la recette du reel (kit de publication)
    var views = uses.map(function (p) { return p.views || 0; }), tot = views.reduce(function (a, x) { return a + x; }, 0);
    var avg = uses.length ? tot / uses.length : null, max = Math.max.apply(null, views.concat([1]));
    var back = ui.modal.post ? '<button type="button" class="cf-back" data-act="brick-back">' + svg('M15 18l-6-6 6-6', 14) + 'Publication' + (ui.modal.rank ? ' #' + ui.modal.rank : '') + '</button>'
      : ui.modal.asm ? '<button type="button" class="cf-back" data-act="brick-back">' + svg('M15 18l-6-6 6-6', 14) + esc(ui.modal.asm) + '</button>'
        : underBack('brick-back');
    var photos = b.kind === 'avatar' && fb ? avPhotos(fb) : [], prop = isProposal(fb);
    var sub = [SHEET_KIND[b.kind] || 'Brique', photos.length > 1 ? photos.length + ' photos' : '', prop ? 'proposition' : '',
      b.kind === 'sous-titre' && m.value ? 'style ' + m.value : '', m.duration != null ? 'durée ' + fMmss(m.duration) : '', b.keyword ? 'mot-clé ' + b.keyword : '',
      b.subject && b.kind !== 'sous-titre' ? 'sujet ' + ((CF.MODULES && CF.MODULES[b.subject]) || subjName(b.subject)) : '', fb && fb.status && fb.status !== 'ready' && !prop ? stFr(fb.status) : ''].filter(Boolean).join(' · ');
    var miss = function (what) { return '<span class="cf-meta cf-bs-miss">' + esc(what + ' · fichier manquant' + (fb && fb.hasMedia && fb.mediaWhy ? ' (' + fb.mediaWhy + ')' : '')) + '</span>'; };
    var ph = function (t) { return '<div class="cf-sheet-media cf-bs-ph"><span class="cf-sheet-none">' + svg(IC.play, 18) + '<br>' + esc(t) + '</span></div>'; };
    var asrc = mediaSrc(b.audio);
    // colonne de gauche (200 px, maquette) selon le type ; la musique a son lecteur pleine largeur au-dessus
    var top = '', media = null, chocUseLine = '';
    if (b.kind === 'contenu' || b.kind === 'reaction') {   // réaction (07/10) : même lecteur que la démo
      var vpo = fb && (mediaSrc(fb.poster) || mediaSrc(fb.image));   // affiche si la brique en a une, sinon 1re image (13/10)
      media = fb && mediaSrc(fb.video) ? '<div class="cf-sheet-media cf-mbox"><video controls playsinline preload="metadata" src="' + esc(vpo ? mediaSrc(fb.video) : vFirst(mediaSrc(fb.video))) + '"' + (vpo ? ' poster="' + esc(vpo) + '"' : '') + '></video><span class="cf-vmsg">vidéo illisible</span></div>'
        : ph('démo · ' + b.id) + miss('vidéo de démo');
    } else if (b.kind === 'avatar') {
      // toutes les photos de l'avatar : la grande (couverture par défaut) + les vignettes, un clic l'affiche en grand
      var cov = fb && mediaSrc(fb.image), sel = ui.modal.avImg != null && photos[ui.modal.avImg] ? ui.modal.avImg : Math.max(0, photos.indexOf(cov));
      // 07/10 (Axel) : chaque photo porte son nom de la bibliothèque (A1-1, A1-2…), celui des recettes et des vidéos
      var pn = function (u) { var m0 = String(u || '').split(/[?#]/)[0].match(/\/([A-Za-z0-9]+-\d+)\.(?:jpe?g|png|webp)$/i); return m0 ? m0[1] : ''; };
      var tagS = 'position:absolute;left:6px;top:6px;background:rgba(0,0,0,.62);color:#fff;font:600 11px/1 var(--cf-mono, monospace);padding:4px 6px;border-radius:6px';
      media = photos.length ? '<div class="cf-sheet-media is-portrait">' + thumbImg(photos[sel], 800, 'alt="' + esc('Photo ' + (pn(photos[sel]) || sel + 1) + ' de ' + b.id) + '" decoding="async"') + (pn(photos[sel]) ? '<span style="' + tagS + '">' + esc(pn(photos[sel])) + '</span>' : '') + '</div>'
        + (photos.length > 1 ? '<div class="cf-avgrid">' + photos.map(function (u, i) {
          var nm = pn(u);
          return '<button type="button" class="cf-avth' + (i === sel ? ' is-on' : '') + '" data-act="av-img" data-i="' + i + '" aria-pressed="' + (i === sel) + '" aria-label="' + esc(nm || 'Photo ' + (i + 1)) + '" title="' + esc(nm) + '" style="position:relative">' + thumbImg(u, 160, 'alt="" loading="lazy" decoding="async"', true)
            + (nm ? '<span style="position:absolute;left:2px;bottom:2px;background:rgba(0,0,0,.62);color:#fff;font:600 9px/1 var(--cf-mono, monospace);padding:2px 3px;border-radius:4px">' + esc(nm) + '</span>' : '') + '</button>';
        }).join('') + '</div>' : '')
        : ph('avatar · ' + b.id) + miss('portrait');
    } else if (b.kind === 'transformation') {
      // avant / après en vidéo (maquette 28-fiche-transformation) : deux lecteurs 9:16 côte à côte, légende dessous
      var ab = function (sd, t) {
        var v = sd && mediaSrc(sd.video);
        return '<figure class="cf-bs-abf" data-ab="' + (t === 'avant' ? 'before' : 'after') + '"><span class="cf-bs-abv cf-mbox' + (v ? '' : ' is-broken') + (t === 'après' ? ' is-after' : '') + '">'
          + (v ? '<video autoplay muted loop playsinline preload="auto" src="' + esc(v) + '"' + (sd.label ? ' aria-label="' + esc(t + ' : ' + sd.label) + '"' : '') + '></video>' : '')
          + '<span class="cf-vmsg' + (v ? '' : ' is-on') + '">' + esc(v ? 'vidéo illisible' : 'fichier manquant' + (sd && sd.why ? ' · ' + sd.why : '')) + '</span></span>'
          + '<figcaption>' + t + '</figcaption></figure>';
      };
      media = '<div class="cf-bs-ab">' + ab(m.before, 'avant') + ab(m.after, 'après') + '</div>';
      if ((m.before && m.before.label) || (m.after && m.after.label)) b.label = ((m.before && m.before.label) || '—') + ' → ' + ((m.after && m.after.label) || '—');
    } else if (b.kind === 'style-choc') {
      // style du texte choc (CSxx, 01/10) : vignette d'aperçu (meta.cover)
      var cp = fb && (mediaSrc(fb.poster) || mediaSrc(fb.image));
      media = cp ? '<div class="cf-sheet-media"><img src="' + esc(cp) + '" alt="' + esc('Aperçu du style ' + b.id) + '" decoding="async"></div>' : ph('style · ' + b.id);
    } else if (b.kind === 'sous-titre') {
      // aperçu vidéo du style (meta.media) et sa vignette (meta.poster / cover)
      var sv = fb && mediaSrc(fb.video), sp = fb && (mediaSrc(fb.poster) || mediaSrc(fb.image));
      media = sv ? '<div class="cf-sheet-media cf-mbox"><video controls playsinline preload="metadata" src="' + esc(sp ? sv : vFirst(sv)) + '"' + (sp ? ' poster="' + esc(sp) + '"' : '') + '></video><span class="cf-vmsg">vidéo illisible</span></div>'
        : sp ? '<div class="cf-sheet-media"><img src="' + esc(sp) + '" alt="' + esc('Aperçu du style ' + b.id) + '" decoding="async"></div>'
          : ph('style · ' + (m.value || b.id)) + (fb && fb.hasMedia ? miss('aperçu') : '<span class="cf-meta">aperçu du style : pas encore en ligne</span>');
    } else if (b.kind === 'texte-choc') {
      // texte choc (TH…) : aucune limite (Axel 07/10) → nombre de vidéos qui l'ont déjà utilisé (recettes QC, tous formats)
      // aperçu de la phrase telle qu'à l'écran (pastilles blanches, style natif) ; le compte d'utilisation passe à droite
      var phr = thText(m, b.label), wl = [], cur = '';
      phr.split(/\s+/).forEach(function (w) { if (cur && (cur + ' ' + w).length > 18) { wl.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
      if (cur) wl.push(cur);
      media = '<div class="cf-sheet-media" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px">'
        + wl.map(function (l) { return '<span style="background:#fff;color:#111;font-weight:700;font-size:13px;line-height:1.25;padding:3px 8px;border-radius:7px;text-align:center">' + esc(l) + '</span>'; }).join('') + '</div>';
      var nU = chocUses(b.id);
      chocUseLine = '<div class="cf-meta" style="margin:8px 0 2px">' + esc(nU == null ? 'Utilisation : production pas encore chargée' : 'Utilisé dans ' + fInt(nU) + NB + plural(nU, 'vidéo générée', 'vidéos générées') + ' · pas de limite') + '</div>';
    } else if (spoken) {
      // brique parlée : vidéos par avatar (factory_prod_stats), puis la tuile audio de la maquette et sa légende
      media = '';
      var V = M.vars, avs = V && V.byBrick[b.id] || [];
      media += fmtVideosHTML(M, b);
      media += asrc ? aplayHTML(asrc, m.duration, false) : fb ? miss('audio') : '<span class="cf-meta">audio indisponible</span>';
      // légende de la maquette ; sans la Production chargée (fiche ouverte depuis Insight) : rien d'inventé sur les vidéos
      var capT = !V ? (asrc ? 'audio' : '') : V.gen == null ? 'audio · vidéos par avatar : — (' + V.why + ')' : avs.length ? 'audio' : 'audio seul · aucune vidéo générée';
      if (capT) media += '<span class="cf-bs-cap-t">' + esc(capT) + '</span>';
    } else {
      top = asrc ? aplayHTML(asrc, m.duration, true) : fb ? '<div>' + miss(b.kind === 'musique' ? 'piste' : 'audio') + '</div>' : '<span class="cf-meta">audio indisponible</span>';
    }
    var text = kind === 'texte-choc' ? thText(m, b.label) : spoken ? (b.text || (fb ? 'texte pas encore saisi' : b.label)) : b.label && b.label !== b.id ? b.label + (m.variant ? ' · ' + (m.variant === 'ugc-reel' ? 'UGC réel' : m.variant) : '') : '';
    var textBox = text ? '<div class="cf-bs-text' + (spoken && !b.text && fb ? ' is-na' : '') + '">' + esc(text) + '</div>' : '';
    var trend = '';
    if (uses.length >= 2 && views[0] > 0) {
      var ch = (views[views.length - 1] - views[0]) / views[0] * 100;
      trend = '<span class="cf-bs-trend' + (ch < 0 ? ' is-down' : '') + '">' + svg(ch < 0 ? 'M22 17l-8.5-8.5-5 5L2 7M16 17h6v-6' : 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6', 12)
        + (ch >= 0 ? '+' : MINUS) + fDec(Math.abs(ch), 0) + NB + '% entre la 1re et la dernière</span>';
    }
    var many = uses.length > 8;
    var chart = uses.length ? '<div class="cf-bs-chart"><div class="cf-bs-chart-h"><span class="cf-over">Vues par publication</span>' + trend + '</div>'
      + '<div class="cf-bs-bars">' + (uses.length > 1 ? '<span class="cf-bs-avg" style="bottom:calc((100% - 14px) * ' + (avg / max).toFixed(3) + ')"></span>' : '')
      + uses.map(function (p) {
        var d = validDate(p.timestamp);
        return '<span class="cf-bs-barw" title="' + esc((d ? dm(d) + ' · ' : '') + fInt(p.views || 0) + ' vues') + '"><span class="cf-bs-bar' + ((p.views || 0) < avg ? ' is-low' : '') + '" style="height:' + Math.max(2, (p.views || 0) / max * 100).toFixed(1) + '%">'
          + (many ? '' : '<span class="cf-bs-bv">' + esc(fInt(p.views || 0)) + '</span>') + '</span></span>';
      }).join('') + '</div>'
      + '<div class="cf-bs-x' + (many ? ' is-ends' : '') + '">' + (many ? [uses[0], uses[uses.length - 1]] : uses).map(function (p) { var d = validDate(p.timestamp); return '<span>' + esc(d ? dm(d) : '') + '</span>'; }).join('') + '</div>'
      + (uses.length > 1 ? '<span class="cf-bs-avgl">- - moyenne ' + esc(fInt(Math.round(avg))) + ' vues</span>' : '') + '</div>' : '';
    var rows = uses.slice().reverse().map(function (p) {
      var d = validDate(p.timestamp), r = rankOf(p);
      return '<button type="button" class="cf-bs-row" data-act="brick-post" data-pid="' + esc(p.id) + '"><span class="cf-bs-d">' + esc(d ? dm(d) : '—') + '</span>'
        + (r ? '<span class="cf-chip is-brick">#' + r + '</span>' : '') + reelChip(p)
        + '<span class="cf-bs-cap' + (p.recipe && p.recipe.id ? ' is-id' : '') + '"' + (p.recipe && p.recipe.id ? ' title="' + esc(capText(p.caption)) + '"' : '') + '>' + esc(p.recipe && p.recipe.id ? p.recipe.id : capText(p.caption)) + '</span>'
        + '<span class="cf-meta">' + esc([p.likes != null ? fInt(p.likes) + NB + 'j’aime' : '', p.comments != null ? fInt(p.comments) + NB + 'com.' : '', p.shares != null ? fInt(p.shares) + NB + 'partages' : ''].filter(Boolean).join(' · ')) + '</span>'
        + '<b>' + esc(fInt(p.views) || '—') + ' vues</b></button>';
    }).join('');
    // avatar : détail PAR PHOTO (A1-6, A1-8…) — reels, vues totales, vues par reel, meilleure d'abord
    var byPhoto = '';
    if (b.kind === 'avatar' && uses.length) {
      var ph2 = {}; uses.forEach(function (p) { var k = (p.recipe && p.recipe.photo) || 'photo inconnue'; (ph2[k] = ph2[k] || []).push(p); });
      byPhoto = '<div class="cf-bs-photos"><div class="cf-over">Par photo</div>' + Object.keys(ph2).map(function (k) {
        var l = ph2[k], tv = l.reduce(function (a, p) { return a + (p.views || 0); }, 0), tl = l.reduce(function (a, p) { return a + (p.likes || 0); }, 0), tc = l.reduce(function (a, p) { return a + (p.comments || 0); }, 0);
        return { k: k, n: l.length, tv: tv, avg: tv / l.length, tl: tl, tc: tc };
      }).sort(function (a, c) { return c.avg - a.avg; }).map(function (x) {
        return '<div class="cf-bs-prow"><span class="cf-chip is-brick">' + esc(x.k) + '</span><span class="cf-meta">' + esc(x.n + NB + plural(x.n, 'reel') + ' · ' + fInt(x.tv) + NB + 'vues · ' + fInt(x.tl) + NB + 'j’aime · ' + fInt(x.tc) + NB + 'com.') + '</span><b>' + esc(fInt(Math.round(x.avg))) + ' vues / reel</b></div>';
      }).join('') + '</div>';
    }
    var st = function (v, l) { return '<div class="cf-bs-st"><b>' + esc(v == null ? '—' : v) + '</b><span>' + esc(l) + '</span></div>'; };
    var hist = !heard ? '<div class="cf-bs-none">Pas encore mesurable dans les reels.</div>'
      : !uses.length ? '<div class="cf-bs-none">Pas encore dans un reel publié.</div>'
        : '<div class="cf-bs-use"><div class="cf-over">Historique d’utilisation · ' + uses.length + ' ' + plural(uses.length, 'publication') + ' Instagram reconnue' + (uses.length >= 2 ? 's' : '') + ' (kit de publication)</div>'
          + '<div class="cf-bs-sts">' + st(fInt(tot), 'vues totales') + st(avg != null ? fInt(Math.round(avg)) : null, 'vues par publication') + st(uses.length + ' ' + plural(uses.length, 'vidéo'), 'utilisée dans') + '</div>'
          + chart + byPhoto + '<div class="cf-bs-list">' + rows + '</div></div>';
    var kw = b.keyword ? '<div class="cf-bs-tags"><span class="cf-over">Mot-clé DM</span><span class="cf-bs-tag">' + esc(b.keyword) + '</span></div>' : '';
    return '<div class="cf-bsheet">' + back
      + '<div class="cf-bs-head"><h2 class="cf-h2 cf-bs-title" id="cfModalTitle">' + esc(b.id) + '</h2><div class="cf-meta">' + esc(sub) + '</div></div>'
      + top
      + '<div class="cf-bs-grid">'
      + (media != null ? '<div class="cf-bs-media">' + media + '</div>' : '')
      + '<div class="cf-sheet-info">' + textBox + chocUseLine + kw + hist + '</div></div></div>';
  }
  var SPOKEN_V = { hook: 1, liaison: 1, cta: 1 };

  function renderModal() {
    // grande fenêtre : revue QC, et fiche brique ouverte depuis une publication (Insight, inchangé) ; depuis l'onglet
    // Production, la fiche brique garde les 760 px de la maquette (11, 27, 28-fiche-transformation)
    // (depuis la revue QC, la fiche garde la largeur de la revue : la fenêtre ne saute pas deux fois)
    // (un assemblage ouvert depuis la revue QC se pose par-dessus comme une brique : même largeur que la revue)
    var over = !!(ui.modal && (ui.modal.brick || (ui.modal.asm && (ui.modal.qc || ui.modal.vf))));
    var box = document.querySelector('.cf-modal-box'), wide = !!(ui.modal && (over ? ui.modal.post || ui.modal.qc || (ui.modal.brick && ui.tab !== 'prod') : ui.modal.qc));
    if (box) {
      box.classList.toggle('is-wide', wide);
      // fiche brique / rendu vidéo de la Production : fenêtre de la maquette (padding 22, fermeture 32 px alignée sur le titre,
      // centrée aussi sur téléphone)
      var sheet = !!(ui.modal && !wide && (ui.modal.brick || ui.modal.video || ui.modal.vf || ui.modal.asm));
      box.classList.toggle('is-sheet', sheet);
      box.classList.toggle('is-vf', !!(ui.modal && !wide && (ui.modal.vf || ui.modal.asm) && !ui.modal.brick));   // fiche vidéo finale / assemblage : 560 px (maquette)
      $('cfModal').classList.toggle('is-center', sheet);
    }
    if (ui.modal.brick) { setHTML($('cfModalBody'), brickSheetHTML(ui.modal.brick)); return; }
    if (ui.modal.asm) { setHTML($('cfModalBody'), asmSheetHTML(ui.modal.asm)); return; }
    if (ui.modal.qc) { renderQcModal(); return; }
    if (ui.modal.video) { setHTML($('cfModalBody'), videoModalHTML(ui.modal.video)); return; }
    if (ui.modal.vf) {
      var vb = $('cfModalBody');
      setHTML(vb, vfSheetHTML(ui.modal.vf));
      var vd = vb.querySelector('.cf-vf-diff');
      if (vd) setHTML(vd, vfDiffHTML(ui.modal.vf));
      return;
    }
    var cur = CF.acct.media.data && CF.acct.media.data.list.filter(function (x) { return x.id === ui.modal.post.id; })[0];
    if (cur) ui.modal.post = cur;   // la liste a pu être relue : jamais un module périmé dans la fiche
    var p = ui.modal.post, rank = ui.modal.rank;
    var thumb = safeUrl(p.thumb), link = safeUrl(p.permalink, IG_HOST), d = validDate(p.timestamp);
    var isVid = isVideo(p);
    var four = p.likes != null && p.comments != null && p.saved != null && p.shares != null;
    var eng = four ? fPct(p.likes + p.comments + p.saved + p.shares, p.views) : null;
    var tiles = [
      tile('vues', fInt(p.views), 'non fourni par l’API'),
      tile('reach', fInt(p.reach), 'non fourni par l’API'),
      tileRate('likes', p, GOAL.like, isVid),
      tileRate('commentaires', p, GOAL.comment, isVid),
      tileRate('enregistrements', p, GOAL.save, isVid),
      tileRate('partages', p, GOAL.share, isVid),
      tile('interactions', fInt(p.interactions), 'non fourni par l’API'),
      tileWatch(p, isVid),
      tile('engagement / vues', eng, 'vues ou interactions manquantes'),
      tile('swipe < 3' + NB + 's', p.skipRate != null ? fShare(p.skipRate) : null, isVid ? 'non fourni par l’API' : 'pas fourni pour ce type de publication'),
      tile('temps total regardé', fDur(p.totalWatchS), isVid ? 'non fourni par l’API' : 'pas fourni pour ce type de publication')
    ].join('');
    setHTML($('cfModalBody'),
      '<div class="cf-sheet">'
      + '<div class="cf-sheet-media">' + (thumb ? '<img src="' + esc(thumb) + '" alt="Miniature de la publication" referrerpolicy="no-referrer" decoding="async">' : '<span class="cf-sheet-none">aperçu indisponible</span>') + '</div>'
      + '<div class="cf-sheet-info">'
      + '<div class="cf-meta">' + (rank ? '#' + rank + ' en vues · ' : '') + esc(p.trial ? 'réel d’essai (pas sur la grille du profil)' : typeLabel(p.type)) + '</div>'
      + '<h2 class="cf-h2" id="cfModalTitle">' + (videoId(p) ? '<span class="cf-vid">' + esc(videoId(p)) + '</span>' + (d ? '<span class="cf-vid-d">' + esc(dmy(d)) + '</span>' : '')
        : esc(d ? 'Publication du ' + dmy(d) : 'Publication')) + '</h2>'
      + '<p class="cf-sheet-cap">' + esc(capText(p.caption)) + '</p>'
      + (link ? '<a class="cf-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">voir sur Instagram ' + svg(IC.external, 12) + '</a>' : '')
      + '<div class="cf-tiles">' + tiles + '</div>'
      + '<div class="cf-bricks"><div class="cf-over">Briques utilisées</div>'
      + '<div class="cf-bricks-na">' + moduleChip(effModule(p), true) + (p.module ? '' : (p.analysis && p.analysis.module ? '<span class="cf-meta">module déduit du hook</span>' : '')) + '</div>'
      + bricksDetail(p)
      + '<div class="cf-tag"><div class="cf-over" id="cfTagL">Module de la vidéo</div>'
      + '<div class="cf-tag-chips" role="radiogroup" aria-labelledby="cfTagL">' + moduleChoices(p) + '</div></div>'
      + (ui.tagMsg && ui.tagMsg.id === p.id ? '<div class="cf-acct-msg is-' + (ui.tagMsg.ok ? 'ok' : 'err') + '">' + esc(ui.tagMsg.text) + '</div>' : '')
      + '</div>'
      + '</div></div>');
  }

  // ── actions ──
  function setTab(k) {
    if (TAB_KEYS.indexOf(k) < 0 || k === ui.tab) return;
    ui.tab = k;
    saveTab(k);
    render();
  }
  function setDmRange(k) {
    if (CF.DM_RANGES.indexOf(k) < 0 || k === ui.dmRange) return;
    ui.dmRange = k;
    ui.dmAllLeads = false;
    ui.dmAllPosts = false;
    dmHide();
    render();
  }
  function dmHide() { dmCur = null; evoHide(); }
  function setRange(k) {
    if (CF.IG_RANGES.indexOf(k) < 0 || k === ui.range) return; // 90 j, 6 mois, All time : jamais envoyés
    ui.range = k;
    render();
  }
  function reconnect(who) {
    var at = Date.now();
    CF.igConnect().then(function (r) { // igConnect ouvre la popup avant tout await
      ui.recon = r.ok
        ? { ok: true, at: at, text: who
          ? 'Fenêtre Instagram ouverte : connecte-toi avec @' + who + ' (pas un autre compte), puis valide. Les chiffres seront relus ici.'
          : 'Fenêtre Instagram ouverte : termine la connexion, les chiffres seront relus ici.' }
        : { ok: false, at: at, text: (who ? 'Connexion impossible : ' : 'Reconnexion impossible : ') + r.error };
      schedule();
    });
  }

  function loginMsg(t) { $('cfLoginMsg').textContent = t; }
  function busy(form, on) {
    var b = form.querySelectorAll('button');
    for (var i = 0; i < b.length; i++) b[i].disabled = on;
  }

  function bind() {
    window.addEventListener('cf-data', schedule);

    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el || el.disabled) return;
      var act = el.getAttribute('data-act');
      if (act === 'tab') setTab(el.getAttribute('data-tab'));
      else if (act === 'range') setRange(el.getAttribute('data-range'));
      else if (act === 'retry') CF.refresh({ gate: true });
      else if (act === 'boot-retry') location.reload();   // 07/10 : démarrage trop long → on recharge la page
      else if (act === 'relogin') CF.relogin();   // 07/10 (Axel) : session de ce navigateur effacée → formulaire e-mail + mot de passe
      else if (act === 'retry-ig') CF.loadInsights(ui.range, { force: true });
      else if (act === 'retry-accounts') CF.loadAccounts({ force: true });
      else if (act === 'retry-aud') CF.loadAudience({ force: true });
      else if (act === 'retry-media') CF.loadMedia({ force: true });
      else if (act === 'all-posts') { ui.allPosts = !ui.allPosts; render(); }
      else if (act === 'evo-toggle') { var k = el.getAttribute('data-k'); if (EVO_KEYS.indexOf(k) >= 0) { ui.evoHidden[k] = !ui.evoHidden[k]; evoHide(); render(); } }
      else if (act === 'reconnect') reconnect(); // la popup s'ouvre dans ce clic (Safari)
      else if (act === 'connect-acct') reconnect(el.getAttribute('data-k'));
      else if (act === 'post') openPost(parseInt(el.getAttribute('data-i'), 10), el);
      else if (act === 'modal-close') closeModal();
      else if (act === 'tag-set') setTag(el);
      else if (act === 'brick-open') openBrick(el.getAttribute('data-bid'), el);
      else if (act === 'brick-back') brickBack();
      else if (act === 'brick-post') brickPost(el.getAttribute('data-pid'));
      else if (act === 'dm-range') setDmRange(el.getAttribute('data-range'));
      else if (act === 'ig-sel') { if (toggleAcct(el.getAttribute('data-k'))) { ui.allPosts = false; ui.dmAllLeads = false; ui.dmAllPosts = false; dmHide(); render(); } }
      else if (act === 'dm-toggle') { var dk = el.getAttribute('data-k'); if (DMS.some(function (d) { return d.k === dk && !d.none; })) { ui.dmHidden[dk] = !ui.dmHidden[dk]; evoHide(); render(); } }
      else if (act === 'retry-dm') CF.loadDm(ui.dmRange, { force: true });
      else if (act === 'dm-filter') { ui.dmFilter = el.getAttribute('data-f'); ui.dmAllLeads = false; render(); }
      else if (act === 'dm-all-leads') { ui.dmAllLeads = !ui.dmAllLeads; render(); }
      else if (act === 'dm-all-posts') { ui.dmAllPosts = !ui.dmAllPosts; render(); }
      else if (act === 'dm-post') openPostById(el.getAttribute('data-pid'), el);
      else if (act === 'home-go') homeGo(el.getAttribute('data-tab'));
      else if (act === 'net-pf') netToggle(el.getAttribute('data-k'));
      else if (act === 'net-range') { ui.netRange = el.getAttribute('data-k'); if (ui.netRange !== HOME_RANGE) CF.loadInsights(ui.netRange); schedule(); }
      else if (act === 'net-ser') { ui.netHidden = ui.netHidden || {}; var nk = el.getAttribute('data-k'); ui.netHidden[nk] = !ui.netHidden[nk]; schedule(); }
      else if (act === 'net-more') { ui.netN = (ui.netN || 5) + 10; schedule(); }
      // ── onglet BloxAI (16/10) : lecture, tri, listes, décisions d'administration (motif ou confirmation dans le clic) ──
      else if (act === 'bx-refresh') CF.loadBx({ force: true, fresh: true });
      else if (act === 'bx-sort') { var bs = el.getAttribute('data-k'); if (BX_SORT.some(function (x) { return x[0] === bs; })) { ui.bx.sort = bs; render(); } }
      else if (act === 'bx-all-rank') { ui.bx.allRank = !ui.bx.allRank; render(); }
      else if (act === 'bx-all-check') { ui.bx.allCheck = !ui.bx.allCheck; render(); }
      else if (act === 'bx-pub-ok') bxPubDecide(el.getAttribute('data-id'), 'validate');
      else if (act === 'bx-pub-frozen') bxPubDecide(el.getAttribute('data-id'), 'validate_frozen');
      else if (act === 'bx-pub-ko') bxPubDecide(el.getAttribute('data-id'), 'refuse');
      else if (act === 'bx-pub-reset') bxPubDecide(el.getAttribute('data-id'), 'reset');
      else if (act === 'bx-pay') bxPayPaid(el.getAttribute('data-id'));
      else if (act === 'bx-id-view') bxIdView(el.getAttribute('data-id'));   // l'onglet s'ouvre dans ce clic (Safari)
      else if (act === 'bx-id-ok') bxIdDecide(el.getAttribute('data-id'), 'verified');
      else if (act === 'bx-id-ko') bxIdDecide(el.getAttribute('data-id'), 'refused');
      // 18/10 (round 7) : aperçu d'une pièce à redemander, annuler un versement, geler / dégeler, page à recharger (R7-7)
      else if (act === 'bx-id-prev') { var pid = el.getAttribute('data-id'); if (CF.bx.data && bxFind(CF.bx.data.identity, pid)) { bxIdPrevGet(pid); schedule(); } }
      else if (act === 'bx-pay-cancel') bxPayCancel(el.getAttribute('data-id'));
      else if (act === 'bx-freeze') bxFreeze(el.getAttribute('data-uid'), el.getAttribute('data-on') === '1');
      else if (act === 'page-reload') location.reload();
      else if (act === 'bx-mission') bxMission(el.getAttribute('data-vf'), el.getAttribute('data-d'));
      else if (act === 'home-retry') { var src = el.getAttribute('data-src'); if (src === 'prod') CF.loadProd({ force: true }); else if (src === 'prov') CF.loadProviders({ force: true }); else if (src === 'tk') CF.loadTk({ force: true }); else if (src === 'bx') CF.loadBx({ force: true }); }
      // ── comptes TikTok (Audit 02/10) ──
      else if (act === 'tk-connect') tkStart(el.getAttribute('data-k'));   // la popup s'ouvre dans ce clic (Safari)
      else if (act === 'tk-handle') tkHandle(el.getAttribute('data-k'));
      else if (act === 'tk-test') tkTest(el.getAttribute('data-k'));
      else if (act === 'tk-copy' && ui.tkRecon && ui.tkRecon.caption) {
        navigator.clipboard.writeText(ui.tkRecon.caption).then(function () { ui.tkRecon.copied = true; schedule(); }, function () { /* presse-papiers refusé */ });
      }
      else if (act === 'retry-tk') CF.loadTk({ force: true });
      else if (act === 'tts-connect') ttsStart();   // 07/10 : connexion « stats » (Sandbox), popup ouverte dans ce clic
      else if (act === 'retry-tts') CF.loadTts({ force: true });
      else if (act === 'tts-link') ttsLink(el.getAttribute('data-id'), el.getAttribute('data-vf'));   // 07/10 : vidéo TikTok → vidéo de l'usine
      else if (act === 'tts-relink') ttsRelink(el.getAttribute('data-id'));
      else if (act === 'tk-goto') { var tg = $('cfTkSec'); if (tg && tg.scrollIntoView) tg.scrollIntoView({ block: 'start' }); }
      // ── onglet Production ──
      else if (act === 'retry-prod') CF.loadProd({ force: true });
      else if (act === 'qc-open') qcOpen(el.getAttribute('data-qid'), el);
      else if (act === 'qc-approve') qcDo('approve');
      else if (act === 'qc-refuse') { if (ui.modal && ui.modal.qc && !ui.modal.qc.busy) { ui.modal.qc.refusing = true; ui.modal.qc.msg = null; renderModal(); var ta = $('cfQcReason'); if (ta) ta.focus(); } }
      else if (act === 'qc-refuse-cancel') { if (ui.modal && ui.modal.qc && !ui.modal.qc.busy) { ui.modal.qc.refusing = false; ui.modal.qc.msg = null; renderModal(); var rb = document.querySelector('#cfModalBody [data-act="qc-refuse"]'); if (rb) rb.focus(); } }
      else if (act === 'qc-refuse-ok') qcDo('refuse');
      else if (act === 'qc-classify') qcClassify(el.getAttribute('data-qid'));
      else if (act === 'qc-goto') { var qg = $('cfQcFile'); if (qg && qg.scrollIntoView) qg.scrollIntoView({ block: 'start' }); }
      else if (act === 'aplay') aplayToggle(el);
      else if (act === 'qc-list') {
        var l = el.getAttribute('data-l');
        if (['pending', 'approved', 'refused'].indexOf(l) >= 0) {
          var fromTitle = !el.classList.contains('cf-qtile');
          ui.prodList = fromTitle ? l : (ui.prodList === l ? null : l); ui.qcMsg = null; render();
          if (fromTitle) { var qf = $('cfQcFile'); if (qf && qf.scrollIntoView) qf.scrollIntoView({ block: 'start' }); }
        }
      }
      else if (act === 'perf-kind') { if (perfKinds().some(function (x) { return x[0] === el.getAttribute('data-k'); })) { if (el.getAttribute('data-side') === 'low') ui.perfKindLow = el.getAttribute('data-k'); else ui.perfKind = el.getAttribute('data-k'); render(); } }
      else if (act === 'rec-filter') { if (['all', 'done', 'in_progress', 'pending', 'other', 'retired'].indexOf(el.getAttribute('data-k')) >= 0) { ui.recFilter = el.getAttribute('data-k'); render(); } }
      else if (act === 'asm-open') openAsm(el.getAttribute('data-rid'), el);
      else if (act === 'asm-back') asmBack();
      else if (act === 'av-img') { var ai = parseInt(el.getAttribute('data-i'), 10); if (ui.modal && ui.modal.brick && ai >= 0 && ai < 40) { ui.modal.avImg = ai; renderModal(); var ab = document.querySelector('#cfModalBody [data-act="av-img"][data-i="' + ai + '"]'); if (ab) ab.focus(); } }
      else if (act === 'rec-all') { ui.recAll = !ui.recAll; render(); }
      else if (act === 'fresh-kind') { if (PERF_KINDS.some(function (x) { return x[0] === el.getAttribute('data-k'); })) { ui.freshKind = el.getAttribute('data-k'); render(); } }
      else if (act === 'br-tab') { if (['lib', 'rec', 'fresh'].indexOf(el.getAttribute('data-k')) >= 0) { ui.brTab = el.getAttribute('data-k'); render(); } }
      else if (act === 'lib-kind') { var lk = el.getAttribute('data-k'); if (PKM[lk]) { ui.libKind = ui.libKind === lk ? null : lk; ui.libQuery = ''; render(); } }
      else if (act === 'rec-play') recPlay(el.getAttribute('data-rid'), el);
      // pipeline (Fabrication) : étape, tuile, avatar, module, période ; fiche d'une vidéo finale (lecture seule)
      else if (act === 'pipe-stage') { var pk = el.getAttribute('data-k'); if (pk === 'gen' || pk === 'ready') { ui.pipeStage = ui.pipeStage === pk ? null : pk; ui.pipeVar = null; ui.pipeAv = null; ui.pipeMod = null; montHide(); render(); } }
      else if (act === 'pipe-close') { var ps = ui.pipeStage; ui.pipeStage = null; ui.pipeVar = null; ui.pipeAv = null; ui.pipeMod = null; montHide(); render(); var pb = document.querySelector('[data-act="pipe-stage"][data-k="' + ps + '"]'); if (pb) pb.focus(); }
      else if (act === 'pipe-var') { var pv = el.getAttribute('data-k'); if (['gen', 'pend', 'rest'].indexOf(pv) >= 0) { ui.pipeVar = ui.pipeVar === pv ? null : pv; ui.pipeAv = null; render(); } }
      else if (act === 'pipe-av') { var pa = el.getAttribute('data-k'), PM = prodModel(); if (PM.L && PM.L.avatars.some(function (a) { return a.id === pa; })) { ui.pipeAv = ui.pipeAv === pa ? null : pa; ui.pipeVar = null; render(); } }
      else if (act === 'pipe-mod') { var pm = el.getAttribute('data-k'); ui.pipeMod = ui.pipeMod === pm ? null : pm; render(); }
      else if (act === 'pipe-per') { var pp = el.getAttribute('data-k'); if (MONT_PER.some(function (x) { return x[0] === pp; })) { ui.pipePer = pp; montHide(); render(); } }
      else if (act === 'vf-open') openVf(el.getAttribute('data-qid'), el);
      else if (act === 'otp-send') sendOtp();
      else if (act === 'otp-back') { show('cfLoginOtp', false); show('cfLoginPwd', true); loginMsg(''); }
    });
    // Clavier : un sélecteur (étape, tuile, avatar, module, période, type…) re-rendu par render() garde le focus. Avant le
    // clic (capture), on note le bouton qui a le focus ; après (le rendu est synchrone), s'il a disparu et que le focus est
    // tombé sur <body>, on le rend au bouton équivalent du nouveau DOM (mêmes data-act / data-k / data-side…).
    var FOCUS_KEYS = ['data-act', 'data-k', 'data-side', 'data-tab', 'data-range', 'data-i', 'data-bid', 'data-rid', 'data-qid', 'data-id', 'data-vf'], keepFocus = null;
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      keepFocus = el && document.activeElement === el ? { el: el, sel: FOCUS_KEYS.filter(function (a) { return el.hasAttribute(a); }).map(function (a) {
        return '[' + a + '="' + String(el.getAttribute(a)).replace(/["\\]/g, '\\$&') + '"]';
      }).join('') } : null;
    }, true);
    document.addEventListener('click', function () {
      var k = keepFocus; keepFocus = null;
      if (!k || document.body.contains(k.el)) return;
      var a = document.activeElement;
      if (a && a !== document.body && a !== document.documentElement) return;
      var n = document.querySelector(k.sel); if (n) n.focus();
    });

    // flèches gauche / droite dans la barre d'onglets
    $('cfTabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = TAB_KEYS.indexOf(ui.tab), n = TAB_KEYS.length;
      var k = TAB_KEYS[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
      setTab(k);
      var b = $('cfTab-' + k);
      if (b) b.focus();
      e.preventDefault();
    });


    // Recherche des leads Auto-DM : filtre à la frappe (le focus est rendu au champ par renderPanel).
    document.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'cfDmQ') { ui.dmQuery = String(e.target.value || '').slice(0, 40); ui.dmAllLeads = false; render(); }
      else if (e.target && e.target.id === 'cfLibQ') { ui.libQuery = String(e.target.value || '').slice(0, 40); render(); }
      else if (e.target && e.target.id === 'cfQcReason' && ui.modal && ui.modal.qc) {
        // motif du refus : gardé dans l'état de la revue, bouton activé sans redessiner (le champ garde le focus)
        ui.modal.qc.reason = String(e.target.value || '').slice(0, 500);
        var ok = document.querySelector('#cfModalBody [data-act="qc-refuse-ok"]');
        if (ok) ok.disabled = !!ui.modal.qc.busy || !ui.modal.qc.reason.trim();
      }
    });

    // Bulle des courbes (Évolution du Compte, Activité de l'Auto-DM) : souris et doigt, sans redessiner le panneau.
    var hover = function (plot, x) { var t = plot.getAttribute('data-chart'); if (t === 'dm') dmHover(plot, x); else if (t === 'net') netHover(plot, x); else evoHover(plot, x); };
    document.addEventListener('mousemove', function (e) {
      var plot = e.target && e.target.closest ? e.target.closest('.cf-evo-plot') : null;
      if (plot) hover(plot, e.clientX); else if (evoCur || dmCur) evoHide();
      var mp = e.target && e.target.closest ? e.target.closest('.cf-mplot:not(.cf-bxplot)') : null;   // courbe des montages (pipeline)
      if (mp) montHover(mp, e.clientX); else if (montCur && montCur.hot) montHide();
      var bp = e.target && e.target.closest ? e.target.closest('.cf-bxplot') : null;   // courbes BloxAI (16/10)
      if (bp) bxHover(bp, e.clientX); else if (bxHot) bxHide();
    });
    var onTouch = function (e) {
      var t = e.touches && e.touches[0], plot = t && e.target && e.target.closest ? e.target.closest('.cf-evo-plot') : null;
      if (plot) hover(plot, t.clientX); else if (evoCur || dmCur) evoHide();
      var mp = t && e.target && e.target.closest ? e.target.closest('.cf-mplot:not(.cf-bxplot)') : null;
      if (mp) montHover(mp, t.clientX); else if (montCur && montCur.hot) montHide();
      var bp = t && e.target && e.target.closest ? e.target.closest('.cf-bxplot') : null;
      if (bp) bxHover(bp, t.clientX); else if (bxHot) bxHide();
    };
    document.addEventListener('touchstart', onTouch, { passive: true });
    document.addEventListener('touchmove', onTouch, { passive: true });

    $('cfModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.modal) closeModal(); });

    // Lecteur audio des fiches (maquette) : bouton, piste et durée suivent l'<audio> caché (événements média, capturés).
    ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { if (e.target && e.target.tagName === 'AUDIO') aplayState(e.target); }, true);
    });

    // Image Instagram expirée ou bloquée : on garde le fond neutre, pas d'icône cassée.
    document.addEventListener('error', function (e) {
      var t = e.target;
      // vignette (render/image) refusée : l'image d'origine, une seule fois
      if (t && t.tagName === 'IMG' && t.getAttribute('data-full')) { var full = t.getAttribute('data-full'); t.removeAttribute('data-full'); t.src = full; return; }
      if (t && t.tagName === 'IMG' && t.closest && t.closest('.cf-thumb, .cf-avatar, .cf-sheet-media, .cf-tk-pic')) t.classList.add('is-broken');
      // 18/10 (round 7, R7-16) : aperçu d'une pièce illisible (lien expiré, format) → message + « Réessayer », jamais une image cassée
      if (t && t.tagName === 'IMG' && t.hasAttribute && t.hasAttribute('data-idimg')) {
        var iid = t.getAttribute('data-idimg'), ip = ui.bx.idPrev[iid];
        if (ip && ip.url && t.getAttribute('src') === ip.url) { ui.bx.idPrev[iid] = { state: 'imgerr', at: Date.now() }; schedule(); }
      }
      // vidéo / audio introuvable (rendu, démo, revue QC) : message à la place du lecteur, jamais un lecteur cassé
      if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO') && t.closest && t.closest('.cf-mbox')) t.closest('.cf-mbox').classList.add('is-broken');
    }, true);

    // Retour sur l'onglet du navigateur : ne relit que ce qui a plus de 15 min.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && CF.status === 'ready') {
        CF.refresh({ igRange: ui.tab === 'compte' ? ui.range : null, dmRange: ui.tab === 'dm' ? ui.dmRange : null,
          home: ui.tab === 'home' ? { ig: HOME_RANGE, dm: HOME_DM } : null, prod: ui.tab === 'prod',
          bx: ui.tab === 'trackads' || ui.tab === 'home' || ui.tab === 'prod' });
      }
    });
    // Auto-DM et Production : notre base, relue toutes les 2 min tant que l'onglet (ou l'Accueil) est affiché
    // (le store ignore si c'est encore frais).
    setInterval(function () {
      if (CF.status !== 'ready' || document.visibilityState !== 'visible') return;
      if (ui.tab === 'dm') CF.loadDm(ui.dmRange);
      else if (ui.tab === 'home') { CF.loadDm(HOME_DM); CF.loadProd(); }
      else if (ui.tab === 'prod' && !(ui.modal && ui.modal.qc && ui.modal.qc.busy)) CF.loadProd();
    }, CF.DM_TTL_MS || 120000);

    $('cfLoginPwd').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.currentTarget, email = $('cfEmail').value.trim(), pwd = $('cfPwd').value;
      if (!email || !pwd) { loginMsg('E-mail et mot de passe requis.'); return; }
      loginMsg('Connexion…');
      busy(form, true);
      CF.auth.signInPwd(email, pwd).then(function (r) {
        busy(form, false);
        loginMsg(r.error ? r.error : '');
        if (!r.error) $('cfPwd').value = '';
      });
    });
    $('cfLoginOtp').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.currentTarget, email = $('cfEmail').value.trim(), code = $('cfOtp').value.trim();
      if (!code) { loginMsg('Entre le code reçu par e-mail.'); return; }
      loginMsg('Vérification…');
      busy(form, true);
      CF.auth.verifyOtp(email, code).then(function (r) {
        busy(form, false);
        loginMsg(r.error ? r.error : '');
        if (!r.error) $('cfOtp').value = '';
      });
    });
  }

  function sendOtp() {
    var email = $('cfEmail').value.trim();
    if (!email) { loginMsg('Entre ton e-mail.'); return; }
    loginMsg('Envoi du code…');
    CF.auth.sendOtp(email).then(function (r) {
      if (r.error) { loginMsg(r.error); return; }
      show('cfLoginPwd', false);
      show('cfLoginOtp', true);
      loginMsg('Code envoyé : vérifie tes e-mails.');
      $('cfOtp').focus();
    });
  }

  bind();
  render();
})();
