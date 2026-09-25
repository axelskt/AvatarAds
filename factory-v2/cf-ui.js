/*
 * Creative Factory v2 · cf-ui.js · étapes 0 à 3 du plan (Auto-DM et Accueil : Axel 25/09)
 * Rendu seulement : lit window.CF (cf-store.js), se redessine sur « cf-data ». Aucun chiffre calculé ailleurs.
 * Règles d'affichage : « 0 » = mesuré et nul · « — » + raison courte = pas de source · jamais additionner
 * reach ni comptes engagés · tout texte venu d'Instagram passe par esc() · aucun emoji (icônes SVG).
 * Seule clé localStorage : « cf-dashboard-tab » (onglet actif).
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
    insta: 'M3 3h18v18H3zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01'
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
    prod: { h: 'Production', step: 4,
      what: 'File de validation et revue, bibliothèque de briques, recettes de hooks, capacité de création et briques qui manquent.' },
    trackads: { h: 'TrackAds', step: 5,
      what: 'TrackAds n’est pas encore lancé (Phase 3). L’onglet affichera « — » tant qu’il n’y a pas de missions, jamais de chiffre inventé.' }
  };
  function readTab() {
    try { var t = localStorage.getItem(TAB_STORE); return TAB_KEYS.indexOf(t) >= 0 ? t : 'home'; } catch (e) { return 'home'; }
  }
  function saveTab(t) { try { localStorage.setItem(TAB_STORE, t); } catch (e) { /* navigation privée : sans importance */ } }

  // ── état d'interface (pas de données ici) ──
  var ui = { tab: readTab(), range: '30j', modal: null, lastFocus: null, recon: null, lastStatus: null, evoHidden: {}, allPosts: false, tagMsg: null, prefetched: false,
    // Auto-DM : période, séries masquées, filtre / recherche des leads, listes dépliées
    dmRange: '30j', dmHidden: {}, dmFilter: 'all', dmQuery: '', dmAllLeads: false, dmAllPosts: false };

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
      if (A.state === 'ready' && !prim) return { tone: 'err', pill: 'Instagram déconnecté', line: 'aucun compte @' + CF.PRIMARY_USERNAME + ' relié' };
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

  function render() {
    var st = CF.status;
    show('cfBoot', st === 'boot' || st === 'loading');
    var bm = $('cfBootMsg');
    if (bm) bm.textContent = st === 'loading' ? 'Vérification de l’accès…' : 'Chargement…';
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
    var a = document.activeElement, keep = a && a.id === 'cfDmQ' ? { s: a.selectionStart, e: a.selectionEnd } : null;
    setHTML(panel, ui.tab === 'compte' ? compteHTML() : ui.tab === 'dm' ? dmHTML() : ui.tab === 'home' ? homeHTML() : soonHTML(ui.tab));
    var q = keep && $('cfDmQ');
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
  // cases du store (un appel par source, partagé avec les onglets). TrackAds et paiements : « — », Phase 3 pas construite.
  function ensureHome() {
    if (CF.status !== 'ready') return;
    CF.loadAccounts();
    CF.loadInsights(HOME_RANGE);
    CF.loadMedia();
    CF.loadDm(HOME_DM);
    CF.loadProd();
    CF.loadProviders();
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
  // d'exemple, aucune alerte TrackAds (pas encore branché : dit dans la ligne des sources).
  var BILLING = { hedra: 'https://www.hedra.com/app/settings/billing', fal: 'https://fal.ai/dashboard/billing', elevenlabs: 'https://elevenlabs.io/app/subscription' };
  var LVL_ORDER = { danger: 0, warn: 1 };
  var TAB_NAME = { prod: 'Production', trackads: 'TrackAds', dm: 'Auto-DM', compte: 'Insight' };
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
    function add(lvl, title, sub, o) { o = o || {}; out.push({ lvl: lvl, title: title, sub: sub || '', tab: o.tab || null, ext: o.ext || null, retry: o.retry || null }); }
    var A = CF.acct.accounts, S = CF.acct.ig[HOME_RANGE], M = CF.acct.media, DS = CF.dm[HOME_DM], PS = CF.prod, V = CF.prov;
    var u = '@' + CF.PRIMARY_USERNAME, kept = function (x, what) { return x ? ' · ' + what + ' du ' + hm(new Date(x.fetchedAt)) + ' conservés' : ''; };
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
      if (Z.qc.refused) {
        var lr = Z.qc.lastRefused;
        add('warn', Z.qc.refused + ' ' + plural(Z.qc.refused, 'vidéo refusée', 'vidéos refusées') + ' en QC',
          (lr && lr.at ? 'Dernier refus le ' + dmy(new Date(lr.at)) : 'Refus') + (lr && lr.template ? ' · ' + lr.template : '') + ' · raison notée : '
          + (lr && lr.reason ? '« ' + lr.reason + ' »' : 'aucune') + '. À reprendre ; le classement des refus arrive avec l’onglet Production.', { tab: 'prod' });
      }
      if (Z.bricks.flagged) add('warn', Z.bricks.flagged + ' ' + plural(Z.bricks.flagged, 'brique signalée', 'briques signalées'), 'Statut « signalée » dans la bibliothèque de briques : à revoir avant de l’utiliser.', { tab: 'prod' });
    }
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
      { k: 'prov', l: 'soldes fournisseurs', S: CF.prov, part: !!(V && V.list.some(function (p) { return p.error || p.unconfirmed; })) }
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
      + '<div class="cf-hig is-' + ig.tone + '" data-ig="' + ig.key + '"><span class="cf-dot" aria-hidden="true"></span><span>' + esc(ig.line) + '</span></div></section>'
      + homeAlertsHTML(alerts, src)
      + homePayHTML()
      + '<section class="cf-hsum" aria-labelledby="cfHsT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfHsT">Résumé des onglets</h2>'
      + '<span class="cf-meta">' + esc('chiffres sur 30' + NB + 'j, la période par défaut des onglets : ce sont les mêmes que dans chaque onglet') + '</span></div></div>'
      + '<div class="cf-hcards">' + homeProdCard() + homeTrackCard() + homeDmCard(Y) + homeIgCard(X, off) + '</div></section>';
  }

  function homeAlertsHTML(alerts, src) {
    var wait = src.filter(function (x) { return x.st === 'wait'; }), n = alerts.length;
    var rows = alerts.map(function (a) {
      var go = a.tab ? '<button type="button" class="cf-alert-go" data-act="home-go" data-tab="' + a.tab + '">' + esc(TAB_NAME[a.tab]) + svg(IC.arrow, 12) + '</button>'
        : a.retry ? '<button type="button" class="cf-alert-go" data-act="home-retry" data-src="' + a.retry + '">Réessayer' + svg(IC.refresh, 12) + '</button>'
        : a.ext ? '<a class="cf-alert-go" href="' + esc(a.ext) + '" target="_blank" rel="noopener noreferrer">Recharger' + svg(IC.external, 12) + '</a>' : '';
      return '<div class="cf-alert is-' + a.lvl + '"><span class="cf-alert-ic">' + svg(a.lvl === 'danger' ? IC.alert : IC.clock, 15) + '</span>'
        + '<span class="cf-alert-t"><b>' + esc(a.title) + '</b><span>' + esc(a.sub) + '</span></span>' + go + '</div>';
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
      + (probs.length ? ' · ' + probs.join(' · ') + ' (voir les alertes)' : '')
      + ' · pas encore surveillé : TrackAds (missions échouées, demandes de paiement), Phase 3 pas encore branchée.';
    return '<section class="cf-card" aria-labelledby="cfAlT"><div class="cf-alerts-h"><h2 class="cf-h2" id="cfAlT">À surveiller</h2><span class="cf-badge" data-alerts="' + n + '">'
      + (wait.length && !n ? '…' : n) + '</span></div>'
      + '<div class="cf-alerts">' + rows + tail + '</div><div class="cf-hsrc">' + esc(foot) + '</div></section>';
  }

  // Paiements TrackAds : Phase 3 pas encore construite → « — », jamais les montants de la maquette.
  function homePayHTML() {
    return '<section class="cf-card" aria-labelledby="cfPayT"><div class="cf-card-h"><div><h2 class="cf-h2" id="cfPayT">Demandes de paiement <span class="cf-badge">—</span></h2>'
      + '<span class="cf-meta">' + esc('users TrackAds · 0,50' + NB + '€ / 1' + NB + '000 vues') + '</span></div>'
      + '<div class="cf-pay-ks"><div class="cf-pay-k"><b>—</b><span>Solde non demandé</span></div><div class="cf-pay-k"><b>—</b><span>À verser (demandes en attente)</span></div></div></div>'
      + '<div class="cf-empty-s cf-dashed" data-pay="none">— · pas encore branché : TrackAds (Phase 3) n’est pas lancé, aucune demande de paiement à lire.</div></section>';
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

  // Production : ce que factory_bricks / factory_recipes / factory_qc contiennent vraiment. Le futur onglet Production
  // (étape 4) lira ce même modèle.
  var BRICK_ORDER = ['hook', 'liaison', 'cta', 'contenu', 'transformation', 'avatar', 'musique', 'sous-titre', 'autre'];
  var KIND_PL = { hook: ['hook', 'hooks'], liaison: ['liaison', 'liaisons'], cta: ['CTA', 'CTA'], contenu: ['contenu', 'contenus'],
    transformation: ['transformation', 'transformations'], avatar: ['avatar', 'avatars'], musique: ['musique', 'musiques'],
    'sous-titre': ['style de sous-titres', 'styles de sous-titres'], autre: ['autre', 'autres'] };
  function prodModel() {
    var S = CF.prod, D = S.data;
    return { S: S, D: D, pending: !D && (S.loading || S.state === 'idle'),
      why: D ? '' : S.kind === 'forbidden' ? 'lecture refusée par la base' : S.kind === 'missing' ? 'table introuvable' : S.state === 'error' ? 'erreur de chargement' : '' };
  }
  function homeProdCard() {
    var Z = prodModel(), D = Z.D;
    function st(k, label, get, o) {
      if (Z.pending) return hstat(k, '…', label, 'chargement', o);
      if (!D) return hstat(k, '—', label, Z.why, o);
      var r = get(D);
      return hstat(k, fInt(r.v), label, r.sub, o);
    }
    var stats = [
      st('bricks', 'Briques prêtes', function (d) {
        var B = d.bricks, nk = Object.keys(B.byKind).length;
        return { v: B.ready, sub: (nk ? nk + ' ' + plural(nk, 'type') : 'aucune brique') + (B.lastAt ? ' · dernière ajoutée le ' + dm(new Date(B.lastAt)) : '') + (B.retired ? ' · ' + B.retired + ' ' + plural(B.retired, 'retirée') : '') };
      }, { acc: true }),
      st('recipes', 'Recettes terminées', function (d) {
        var R = d.recipes, busy = R.inProgress + R.pending;
        return { v: R.done, sub: (R.lastAt ? 'dernière le ' + dm(new Date(R.lastAt)) : 'aucune terminée') + (busy ? ' · ' + busy + ' en cours ou en attente' : '') };
      }),
      st('qc-pending', 'À valider', function (d) { return { v: d.qc.pending, sub: 'file QC' }; }),
      st('qc-refused', 'Refusées en QC', function (d) { return { v: d.qc.refused, sub: d.qc.refused ? 'à reprendre' : 'aucun refus' }; })
    ];
    var kinds = D ? BRICK_ORDER.filter(function (k) { return D.bricks.byKind[k]; }).map(function (k) {
      var n = D.bricks.byKind[k];
      return '<span class="cf-chip" data-kind="' + k + '"><b>' + esc(fInt(n)) + '</b>' + esc(plural(n, KIND_PL[k][0], KIND_PL[k][1])) + '</span>';
    }).join('') : '';
    var extra = (kinds ? '<div class="cf-hkinds" role="group" aria-label="Briques prêtes par type">' + kinds + '</div>' : '')
      + '<div class="cf-hnote">Montages prêts, stock et variantes : — · pas encore branchés (onglet Production, étape 4).</div>';
    return hcard('prod', 'Production', IC.layers, 'état actuel', stats, extra);
  }
  function homeTrackCard() {
    var why = 'pas encore branché';
    return hcard('trackads', 'TrackAds', IC.reach, '30' + NB + 'j', [
      hstat('views', '—', 'Vues gagnées · 30' + NB + 'j', why), hstat('active', '—', 'Users actifs', why),
      hstat('missions', '—', 'Missions en cours', why), hstat('solde', '—', 'Solde non demandé', why)
    ], '<div class="cf-hnote">TrackAds (Phase 3) n’est pas encore lancé : aucune mission, vue ni paiement à lire.</div>');
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
    return hcard('compte', 'Insight Instagram', IC.insta, '30' + NB + 'j', [
      fol, one('views', 'Vues', c.views, X.per), watch, one('engaged', 'Comptes engagés', c.engaged, X.per)
    ], homeTopHTML(off));
  }
  // Top post = le n° 1 du « Top publications » de l'onglet Insight (vues à vie), même liste, même tri.
  function homeTopHTML(off) {
    var MS = CF.acct.media, MD = off ? null : MS.data, top = MD ? topAll()[0] : null;
    if (off || MS.kind === 'disconnected') return emptyLine('—', 'top post : compte déconnecté');
    if (!MD) {
      return MS.state === 'error' ? emptyLine('—', 'top post : ' + (MS.error || 'publications indisponibles'))
        : '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement du top post…</div>';
    }
    if (!top) return emptyLine('—', MD.error ? 'top post : liste des publications indisponible' : 'top post : aucune publication avec des vues');
    var vid = videoId(top), thumb = safeUrl(top.thumb);
    var inner = '<span class="cf-thumb">' + (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '')
      + (isVideo(top) ? '<span class="cf-thumb-play">' + svg(IC.play, 10) + '</span>' : '') + '</span>'
      + '<span class="cf-htop-b"><span class="cf-meta">' + esc('top post · n° 1 du Top publications · ' + fInt(top.views) + ' ' + plural(top.views, 'vue') + ' à vie') + '</span>'
      + '<span class="cf-htop-cap">' + esc(capText(top.caption)) + '</span>'
      + '<span class="cf-htop-id">' + (vid ? '<span class="cf-vid">' + esc(vid) + '</span>' : '<span class="cf-chip is-muted">vidéo non reconnue</span>') + '</span></span>';
    return top.id ? '<button type="button" class="cf-htop" data-act="home-top" data-pid="' + esc(top.id) + '" aria-label="Ouvrir la fiche du top post">' + inner + '<span class="cf-post-go">' + svg(IC.chevron, 16) + '</span></button>'
      : '<div class="cf-htop is-static">' + inner + '</div>';
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

  // ── onglet Compte @avataradss ──
  function compteHTML() {
    var S = CF.acct.ig[ui.range], D = S.data, off = S.kind === 'disconnected';
    var X = model(S, D, off, ui.range);
    return '<section class="cf-title"><h1>Insight Instagram</h1></section>'
      + acctHTML(D)
      + insightsHTML(S, D, off, X)
      + goalsHTML(X)
      + topHTML(off)
      + audienceHTML(D, off)
      + repHTML(S, D, off);
  }

  function acctHTML(D) {
    var A = CF.acct.accounts, prim = A.primary, st = igState();
    var uname = (prim && prim.username) || (D && D.username) || CF.PRIMARY_USERNAME;
    var pic = D ? safeUrl(D.picture) : '';
    var tok = tokenInfo(prim);
    var tokTxt = tok ? 'token valide jusqu’au ' + dmy(tok.date) + ' (' + tok.days + NB + 'j)' : 'token valide jusqu’au —';
    var off = CF.acct.ig[ui.range].kind === 'disconnected';
    var notes = [];
    if (!tok) notes.push('date d’expiration pas encore exposée par instagram-auth');
    if (A.state === 'error') notes.push('comptes reliés : ' + A.error);
    var msg = reconMsg();
    return '<section class="cf-acct">'
      + '<span class="cf-avatar">' + (pic ? '<img src="' + esc(pic) + '" alt="" referrerpolicy="no-referrer" decoding="async">' : '') + '<span class="cf-avatar-i" aria-hidden="true">AA</span></span>'
      + '<div class="cf-acct-main">'
      + '<div class="cf-acct-name">' + IG_GLYPH + '<span>@' + esc(uname) + '</span></div>'
      + '<div class="cf-acct-state is-' + st.tone + '"><span class="cf-dot" aria-hidden="true"></span><span>' + esc(st.line) + (off || (tok && tok.expired) ? '' : ' · ' + esc(tokTxt)) + '</span></div>'
      + (notes.length ? '<div class="cf-acct-why">' + esc(notes.join(' · ')) + '</div>' : '')
      + (A.state === 'error' ? '<button type="button" class="cf-link-btn" data-act="retry-accounts">Réessayer</button>' : '')
      + '</div>'
      + '<button type="button" class="cf-btn" data-act="reconnect">' + svg(IC.refresh, 14) + '<span>Reconnecter</span></button>'
      + msg
      + '</section>';
  }

  // Résultat de « Reconnecter » (carte compte des onglets Insight et Auto-DM).
  function reconMsg() {
    var msg = '', oa = CF.oauth;
    if (oa && Date.now() - oa.at < 10 * 60 * 1000 && (!ui.recon || oa.at >= ui.recon.at)) {
      msg = !oa.ok
        ? '<div class="cf-acct-msg is-err">Reconnexion échouée : ' + esc(oa.error) + '</div>'
        : (oa.username && oa.username.toLowerCase() !== CF.PRIMARY_USERNAME)
          ? '<div class="cf-acct-msg is-err">@' + esc(oa.username) + ' relié, mais le tableau de bord lit @' + esc(CF.PRIMARY_USERNAME) + ' : son token n’a pas changé.</div>'
          : '<div class="cf-acct-msg is-ok">Reconnexion réussie' + (oa.username ? ' : @' + esc(oa.username) : '') + '.'
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
      return banner('err', IC.alert, '<b>Instagram déconnecté</b> · reconnecte @' + esc(CF.PRIMARY_USERNAME) + ' avec le bouton « Reconnecter ». Les chiffres Instagram passent à « — ».');
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
    if (off) msg = 'Instagram déconnecté : reconnecte @' + CF.PRIMARY_USERNAME + ' pour voir les courbes.';
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
  // Toutes les publications qui ont des vues, triées : la seule liste du Top publications (et du top post de l'Accueil).
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
    return '<section class="cf-title"><h1>Auto-DM Instagram</h1></section>'
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
    var st = dmAcctState(), prim = CF.acct.accounts.primary, A = CF.acct.accounts;
    var uname = (prim && prim.username) || CF.PRIMARY_USERNAME;
    var notes = [];
    if (D) notes.push(D.lastAt ? 'dernier évènement Auto-DM ' + ago(D.lastAt) : 'aucun évènement Auto-DM enregistré');
    if (D) notes.push(!D.cron ? 'relance automatique : état du cron illisible' : D.cron.active ? 'relance automatique active (' + cronTxt(D.cron.schedule) + ')' : 'relance automatique : cron INACTIF');
    return '<section class="cf-acct">'
      + '<span class="cf-avatar"><span class="cf-avatar-i" aria-hidden="true">AA</span></span>'
      + '<div class="cf-acct-main">'
      + '<div class="cf-acct-name">' + IG_GLYPH + '<span>@' + esc(uname) + '</span></div>'
      + '<div class="cf-acct-state is-' + st.tone + '"><span class="cf-dot" aria-hidden="true"></span><span>' + esc(st.line) + '</span></div>'
      + (notes.length ? '<div class="cf-acct-why">' + esc(notes.join(' · ')) + '</div>' : '')
      + (A.state === 'error' ? '<button type="button" class="cf-link-btn" data-act="retry-accounts">Réessayer</button>' : '')
      + '</div>'
      + '<button type="button" class="cf-btn" data-act="reconnect">' + svg(IC.refresh, 14) + '<span>Reconnecter</span></button>'
      + reconMsg()
      + '</section>'
      + (st.pause ? banner('err', IC.alert, '<b>Auto-DM en pause</b> · Instagram ' + esc(st.pause) + ' : les nouveaux commentaires ne reçoivent plus de DM. Reconnecte @'
        + esc(CF.PRIMARY_USERNAME) + '. Les chiffres ci-dessous viennent de notre base et restent justes.') : '')
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
      return !!hit;
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
  function openBrick(id) {
    if (!ui.modal || !id) return;
    ui.modal.brick = id;
    renderModal();
    $('cfModalBody').scrollTop = 0;
    var bk = document.querySelector('#cfModalBody [data-act="brick-back"]'); if (bk) bk.focus();
  }
  function brickBack() {
    if (!ui.modal) return;
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
  function brickSheetHTML(id) {
    var U = brickUses(id), b = U.info || { id: id, kind: '', label: id }, uses = U.uses;
    var views = uses.map(function (p) { return p.views || 0; }), tot = views.reduce(function (a, x) { return a + x; }, 0);
    var avg = uses.length ? tot / uses.length : null, max = Math.max.apply(null, views.concat([1]));
    var back = '<button type="button" class="cf-back" data-act="brick-back">' + svg('M15 18l-6-6 6-6', 14) + 'Publication' + (ui.modal.rank ? ' #' + ui.modal.rank : '') + '</button>';
    var sub = [KIND_L[b.kind] || 'brique', b.keyword ? 'mot-clé ' + b.keyword : '', b.subject ? 'sujet ' + (CF.MODULES && CF.MODULES[b.subject] || b.subject) : ''].filter(Boolean).join(' · ');
    var trend = '';
    if (uses.length >= 2 && views[0] > 0) {
      var ch = (views[views.length - 1] - views[0]) / views[0] * 100;
      trend = '<span class="cf-bs-trend' + (ch < 0 ? ' is-down' : '') + '">' + (ch >= 0 ? '+' : '−') + fDec(Math.abs(ch), 0) + NB + '% entre la 1re et la dernière</span>';
    }
    var chart = uses.length ? '<div class="cf-bs-chart"><div class="cf-bs-chart-h"><span class="cf-over">Vues par publication</span>' + trend + '</div>'
      + '<div class="cf-bs-bars">' + (uses.length > 1 ? '<span class="cf-bs-avg" style="bottom:' + (avg / max * 100).toFixed(1) + '%"></span>' : '')
      + uses.map(function (p) {
        var d = validDate(p.timestamp);
        return '<span class="cf-bs-bar' + (p.views < avg ? ' is-low' : '') + '" style="height:' + Math.max(2, (p.views || 0) / max * 100).toFixed(1) + '%" title="' + esc((d ? dm(d) + ' · ' : '') + fInt(p.views) + ' vues') + '"></span>';
      }).join('') + '</div>'
      + '<div class="cf-bs-x"><span>' + esc(validDate(uses[0].timestamp) ? dm(validDate(uses[0].timestamp)) : '') + '</span><span>' + esc(uses.length > 1 && validDate(uses[uses.length - 1].timestamp) ? dm(validDate(uses[uses.length - 1].timestamp)) : '') + '</span></div>'
      + (uses.length > 1 ? '<div class="cf-meta">– – moyenne ' + esc(fInt(Math.round(avg))) + ' vues</div>' : '') + '</div>' : '';
    var rows = uses.slice().reverse().map(function (p) {
      var d = validDate(p.timestamp), r = rankOf(p);
      return '<button type="button" class="cf-bs-row" data-act="brick-post" data-pid="' + esc(p.id) + '"><span class="cf-meta">' + esc(d ? dm(d) : '—') + '</span>'
        + (r ? '<span class="cf-chip is-brick">#' + r + '</span>' : '') + reelChip(p)
        + '<span class="cf-bs-cap">' + esc(capText(p.caption)) + '</span><b>' + esc(fInt(p.views) || '—') + ' vues</b></button>';
    }).join('');
    return '<div class="cf-bsheet">' + back
      + '<h2 class="cf-h2 cf-bs-title" id="cfModalTitle">' + esc(b.id) + '</h2><div class="cf-meta">' + esc(sub) + '</div>'
      + '<div class="cf-sheet cf-bs-grid">'
      + '<div class="cf-bs-media"><div class="cf-sheet-media cf-bs-ph"><span class="cf-sheet-none">' + svg(IC.play, 18) + '<br>audio · ' + esc(b.id) + '</span></div>'
      + (b.audio ? '<audio controls preload="none" src="' + esc(b.audio) + '"></audio>' : '<span class="cf-meta">audio indisponible</span>') + '</div>'
      + '<div class="cf-sheet-info">'
      + '<div class="cf-bs-text"><span class="cf-lbl">Texte prononcé</span>' + esc(b.text || b.label || '—') + '</div>'
      + (b.keyword ? '<div><span class="cf-over">Mot-clé DM</span> <span class="cf-chip is-mod">' + esc(b.keyword) + '</span></div>' : '')
      + '<div class="cf-over">Historique d’utilisation · ' + uses.length + ' ' + plural(uses.length, 'publication') + ' Instagram reconnue' + (uses.length >= 2 ? 's' : '') + '</div>'
      + '<div class="cf-tiles cf-bs-tiles">' + tile('vues totales', fInt(tot), '') + tile('vues par publication', avg != null ? fInt(Math.round(avg)) : null, '') + tile('utilisée dans', uses.length + ' ' + plural(uses.length, 'vidéo'), '') + '</div>'
      + chart + '<div class="cf-bs-list">' + rows + '</div>'
      + '</div></div></div>';
  }

  function renderModal() {
    var box = document.querySelector('.cf-modal-box'); if (box) box.classList.toggle('is-wide', !!(ui.modal && ui.modal.brick));
    if (ui.modal.brick) { setHTML($('cfModalBody'), brickSheetHTML(ui.modal.brick)); return; }
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
  function reconnect() {
    var at = Date.now();
    CF.igConnect().then(function (r) { // igConnect ouvre la popup avant tout await
      ui.recon = r.ok
        ? { ok: true, at: at, text: 'Fenêtre Instagram ouverte : termine la connexion, les chiffres seront relus ici.' }
        : { ok: false, at: at, text: 'Reconnexion impossible : ' + r.error };
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
      else if (act === 'retry-ig') CF.loadInsights(ui.range, { force: true });
      else if (act === 'retry-accounts') CF.loadAccounts({ force: true });
      else if (act === 'retry-aud') CF.loadAudience({ force: true });
      else if (act === 'retry-media') CF.loadMedia({ force: true });
      else if (act === 'all-posts') { ui.allPosts = !ui.allPosts; render(); }
      else if (act === 'evo-toggle') { var k = el.getAttribute('data-k'); if (EVO_KEYS.indexOf(k) >= 0) { ui.evoHidden[k] = !ui.evoHidden[k]; evoHide(); render(); } }
      else if (act === 'reconnect') reconnect(); // la popup s'ouvre dans ce clic (Safari)
      else if (act === 'post') openPost(parseInt(el.getAttribute('data-i'), 10), el);
      else if (act === 'modal-close') closeModal();
      else if (act === 'tag-set') setTag(el);
      else if (act === 'brick-open') openBrick(el.getAttribute('data-bid'));
      else if (act === 'brick-back') brickBack();
      else if (act === 'brick-post') brickPost(el.getAttribute('data-pid'));
      else if (act === 'dm-range') setDmRange(el.getAttribute('data-range'));
      else if (act === 'dm-toggle') { var dk = el.getAttribute('data-k'); if (DMS.some(function (d) { return d.k === dk && !d.none; })) { ui.dmHidden[dk] = !ui.dmHidden[dk]; evoHide(); render(); } }
      else if (act === 'retry-dm') CF.loadDm(ui.dmRange, { force: true });
      else if (act === 'dm-filter') { ui.dmFilter = el.getAttribute('data-f'); ui.dmAllLeads = false; render(); }
      else if (act === 'dm-all-leads') { ui.dmAllLeads = !ui.dmAllLeads; render(); }
      else if (act === 'dm-all-posts') { ui.dmAllPosts = !ui.dmAllPosts; render(); }
      else if (act === 'dm-post') openPostById(el.getAttribute('data-pid'), el);
      else if (act === 'home-go') homeGo(el.getAttribute('data-tab'));
      else if (act === 'home-top') openPostById(el.getAttribute('data-pid'), el);
      else if (act === 'home-retry') { var src = el.getAttribute('data-src'); if (src === 'prod') CF.loadProd({ force: true }); else if (src === 'prov') CF.loadProviders({ force: true }); }
      else if (act === 'otp-send') sendOtp();
      else if (act === 'otp-back') { show('cfLoginOtp', false); show('cfLoginPwd', true); loginMsg(''); }
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
    });

    // Bulle des courbes (Évolution du Compte, Activité de l'Auto-DM) : souris et doigt, sans redessiner le panneau.
    var hover = function (plot, x) { if (plot.getAttribute('data-chart') === 'dm') dmHover(plot, x); else evoHover(plot, x); };
    document.addEventListener('mousemove', function (e) {
      var plot = e.target && e.target.closest ? e.target.closest('.cf-evo-plot') : null;
      if (plot) hover(plot, e.clientX); else if (evoCur || dmCur) evoHide();
    });
    var onTouch = function (e) {
      var t = e.touches && e.touches[0], plot = t && e.target && e.target.closest ? e.target.closest('.cf-evo-plot') : null;
      if (plot) hover(plot, t.clientX); else if (evoCur || dmCur) evoHide();
    };
    document.addEventListener('touchstart', onTouch, { passive: true });
    document.addEventListener('touchmove', onTouch, { passive: true });

    $('cfModal').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.modal) closeModal(); });

    // Image Instagram expirée ou bloquée : on garde le fond neutre, pas d'icône cassée.
    document.addEventListener('error', function (e) {
      var t = e.target;
      if (t && t.tagName === 'IMG' && t.closest && t.closest('.cf-thumb, .cf-avatar, .cf-sheet-media')) t.classList.add('is-broken');
    }, true);

    // Retour sur l'onglet du navigateur : ne relit que ce qui a plus de 15 min.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && CF.status === 'ready') {
        CF.refresh({ igRange: ui.tab === 'compte' ? ui.range : null, dmRange: ui.tab === 'dm' ? ui.dmRange : null,
          home: ui.tab === 'home' ? { ig: HOME_RANGE, dm: HOME_DM } : null });
      }
    });
    // Auto-DM et Production : notre base, relue toutes les 2 min tant que l'onglet (ou l'Accueil) est affiché
    // (le store ignore si c'est encore frais).
    setInterval(function () {
      if (CF.status !== 'ready' || document.visibilityState !== 'visible') return;
      if (ui.tab === 'dm') CF.loadDm(ui.dmRange);
      else if (ui.tab === 'home') { CF.loadDm(HOME_DM); CF.loadProd(); }
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
