/*
 * Creative Factory v2 · cf-ui.js · étapes 0 et 1 du plan
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
    puzzle: 'M4 4h6v3a2 2 0 1 0 4 0V4h6v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4z'
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
  var LONG = { '90j': true, '6m': true, 'all': true };   // > 30 jours : sommes des jours, pas de comptes uniques

  // ── métriques de l'onglet Compte : une couleur par métrique (maquette), la même pour la carte, la courbe et la légende ──
  var SER = [
    { k: 'followers', label: 'Abonnés', c: 'var(--cf-c-followers)', ic: IC.follow },
    { k: 'posts', label: 'Publications', c: 'var(--cf-c-posts)', ic: IC.grid },
    { k: 'watch', label: 'Visionnage moyen', c: 'var(--cf-c-watch)', ic: IC.clock, fixed: true },
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
  var SOON = {
    home: { h: 'Vue d’ensemble', date: true, step: 3,
      what: 'Alertes (token Instagram, vidéos à valider, soldes des fournisseurs) et quatre cartes résumé, lues dans le même store que les onglets.' },
    prod: { h: 'Production', step: 4,
      what: 'File de validation et revue, bibliothèque de briques, recettes de hooks, capacité de création et briques qui manquent.' },
    trackads: { h: 'TrackAds', step: 5,
      what: 'TrackAds n’est pas encore lancé (Phase 3). L’onglet affichera « — » tant qu’il n’y a pas de missions, jamais de chiffre inventé.' },
    dm: { h: 'Auto-DM Instagram', step: 2,
      what: 'Leads, « Je suis abonné », liens reçus et clics comptés en personnes uniques, entonnoir, activité et relances en lecture seule.' }
  };
  function readTab() {
    try { var t = localStorage.getItem(TAB_STORE); return TAB_KEYS.indexOf(t) >= 0 ? t : 'home'; } catch (e) { return 'home'; }
  }
  function saveTab(t) { try { localStorage.setItem(TAB_STORE, t); } catch (e) { /* navigation privée : sans importance */ } }

  // ── état d'interface (pas de données ici) ──
  var ui = { tab: readTab(), range: '30j', modal: null, lastFocus: null, recon: null, lastStatus: null, evoHidden: {}, allPosts: false, tagMsg: null, prefetched: false };

  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function setHTML(el, html) { if (el && el._cfHtml !== html) { el.innerHTML = html; el._cfHtml = html; } }

  // ── état Instagram (pastille de l'en-tête + carte compte) ──
  function tokenInfo(prim) {
    var d = prim && validDate(prim.token_expires_at);
    if (!d) return null;
    var ms = d.getTime() - Date.now();
    return { date: d, expired: ms <= 0, days: Math.max(0, Math.floor(ms / 864e5)) };
  }
  function igData() {
    var s = CF.acct.ig[ui.range];
    if (s && s.data) return s.data;
    for (var i = 0; i < CF.IG_RANGES.length; i++) { var x = CF.acct.ig[CF.IG_RANGES[i]]; if (x && x.data) return x.data; }
    return null;
  }
  function igState() {
    var A = CF.acct.accounts, S = CF.acct.ig[ui.range], D = igData(), prim = A.primary;
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
    } else if (ui.modal) {
      closeModal();
    }
    if (ui.modal) renderModal();
  }

  function renderHeader() {
    $('cfWho').textContent = CF.user ? CF.user.email : '';
    var pill = $('cfIg');
    if (CF.status !== 'ready') { pill.hidden = true; return; }
    var s = igState();
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
    setHTML(panel, ui.tab === 'compte' ? compteHTML() : soonHTML(ui.tab));
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
    var X = model(S, D, off);
    return '<section class="cf-title"><h1>Compte @' + esc(CF.PRIMARY_USERNAME) + '</h1></section>'
      + acctHTML(D)
      + insightsHTML(S, D, off, X)
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
  function model(S, D, off) {
    var MS = CF.acct.media, MD = off ? null : MS.data;
    var P = PERIOD[ui.range], per = P.per, long = !!LONG[ui.range];
    var pending = !D && !off && (S.loading || S.state === 'idle');
    var why = off ? 'compte déconnecté' : (!D && S.state === 'error' ? 'erreur de chargement' : 'non fourni par l’API Instagram');
    var M = D ? D.m : {}, E = D && !off ? D.err : {};
    var c = {};
    function card(k, v, sub, extra, o) {
      o = o || {};
      c[k] = { v: v, sub: sub, extra: extra || '', fmt: o.fmt || fInt, why: o.why || null, title: o.title || '', label: o.label || null };
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
    var pDays = D && !off ? D.flowPendingDays : 0;
    card('followers', net, 'net ' + per + ' · total ' + (fol == null ? '—' : fInt(fol)),
      netSnap != null ? 'compteur d’abonnés : ' + fInt(base.followers) + ' → ' + fInt(fol) + ' (relevé du ' + dm(ymdDate(base.day)) + ')'
        : F ? fSigned(fin) + ' ' + plural(fin, 'abonnement') + ' · ' + fSigned(-fout) + ' ' + plural(fout, 'désabonnement')
          + (pDays ? ' · hors ' + pDays + ' ' + plural(pDays, 'jour') + ' pas encore ' + plural(pDays, 'publié') + ' par Instagram' : '')
        : (fol != null ? 'total actuel : ' + fInt(fol) : ''),
      { fmt: fSigned, why: net == null ? (pend ? 'Instagram publie les abonnements avec ~2 jours de retard' : addWhy(E.follows)) : null, title: E.follows || '' });
    // Publications
    var nReel = reels ? reels.length : 0, nOther = posts ? posts.length - nReel : 0;
    card('posts', posts ? posts.length : null,
      posts && posts.length ? nReel + ' ' + plural(nReel, 'reel') + (nOther ? ' · ' + nOther + ' ' + plural(nOther, 'autre') : '') + ' ' + per : 'aucune publication ' + per,
      total != null ? 'total publié : ' + fInt(total) + (grid != null ? ' · ' + fInt(grid) + ' sur le profil' : '') : '', { why: mediaWhy });
    // Visionnage moyen = temps regardé / vues des reels publiés dans la fenêtre (chiffres à vie de chaque reel).
    var wv = 0, ww = 0;
    (reels || []).forEach(function (p) { if (p.avgWatchS != null && p.views) { wv += p.views; ww += p.avgWatchS * p.views; } });
    // Swipe < 3 s (reels_skip_rate) des mêmes reels, pondéré par les vues.
    var sv = 0, sw = 0;
    (reels || []).forEach(function (p) { if (p.skipRate != null && p.views) { sv += p.views; sw += p.skipRate * p.views; } });
    card('watch', wv ? ww / wv : null, 'temps regardé / vues · ' + nReel + ' ' + plural(nReel, 'reel') + ' ' + per,
      sv ? 'swipe < 3' + NB + 's : ' + fShare(sw / sv) : '',
      { fmt: fSec, why: reels ? (nReel ? 'visionnage non fourni pour ces reels' : 'aucun reel publié ' + per) : mediaWhy });
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
    return { c: c, pending: pending, why: why, series: series, missing: D ? D.seriesMissing : 0, per: per, long: long, off: off };
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
      var v = hid || m.v == null ? '—' : m.fmt(m.v);
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
  function repHTML(S, D, off) {
    var P = PERIOD[ui.range];
    var st = { off: off, pending: !D && !off && (S.loading || S.state === 'idle'), loadErr: !D && !off && !S.loading && S.state === 'error', long: !!LONG[ui.range] };
    var E = D ? D.err : {};
    return '<section class="cf-card"><div class="cf-card-h"><div><h2 class="cf-h2">Répartition ' + esc(P.per) + '</h2></div></div>'
      + '<div class="cf-rep">'
      + repBlock('Vues par type de contenu', D && D.viewsByType, E.viewsByType, TYPE_L, TYPE_C, st)
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
  function moduleOptions(cur) {
    var o = '<option value=""' + (cur ? '' : ' selected') + '>— non renseigné</option>';
    Object.keys(CF.MODULES || {}).forEach(function (k) {
      o += '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(CF.MODULES[k]) + '</option>';
    });
    return o;
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
  function stat(v, label, hero) {
    return '<span class="cf-st' + (hero && v != null ? ' is-hero' : '') + (v == null ? ' is-na' : '') + '"><b>' + esc(v == null ? '—' : v) + '</b> ' + esc(label) + '</span>';
  }

  // ── Top publications : les 5 plus vues de TOUTES les publications (chiffres à vie) ──
  function topList() {
    var MD = CF.acct.media.data;
    if (!MD) return [];
    var all = MD.list.filter(function (p) { return p.views != null; }).sort(function (a, b) { return b.views - a.views; });
    return ui.allPosts ? all : all.slice(0, 5);
  }
  function topHTML(off) {
    var MS = CF.acct.media, MD = off ? null : MS.data, list = topList();
    var wv = 0, ww = 0;
    if (MD) MD.list.forEach(function (p) { if (p.avgWatchS != null && p.views) { wv += p.views; ww += p.avgWatchS * p.views; } });
    var box = wv ? '<div class="cf-watchbox"><span class="cf-watchbox-ic">' + svg(IC.clock, 17) + '</span><span><b>' + esc(fSec(ww / wv)) + '</b>'
      + '<span>visionnage moyen · temps regardé / vues · all time</span></span></div>' : '';
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
    var stats = [stat(fInt(p.views), plural(p.views, 'vue'), true), stat(fInt(p.likes), plural(p.likes, 'like')), stat(fInt(p.comments), 'comm.')];
    if (p.avgWatchS != null) stats.push(stat(fSec(p.avgWatchS), 'visionnage moyen'));
    stats.push(stat(p.skipRate != null ? fShare(p.skipRate) : null, 'swipe < 3' + NB + 's'));
    return '<button type="button" class="cf-post" data-act="post" data-i="' + i + '" aria-label="Ouvrir la fiche de la publication ' + (i + 1) + '">'
      + '<span class="cf-post-rank">#' + (i + 1) + '</span>'
      + '<span class="cf-thumb">' + (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '')
      + (vid ? '<span class="cf-thumb-play">' + svg(IC.play, 10) + '</span>' : '') + '</span>'
      + '<span class="cf-post-b">'
      + '<span class="cf-post-meta">' + moduleChip(p.module) + '<span class="cf-meta">'
      + esc((d ? 'posté le ' + dmy(d) : 'date inconnue') + ' · ' + typeLabel(p.type)) + '</span></span>'
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

  // ── fiche post (modale) ──
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
    var rank = ui.modal.rank;
    ui.modal = null;
    var wrap = document.querySelector('.cf-wrap'); if (wrap) wrap.inert = false;
    $('cfModal').hidden = true;
    document.body.classList.remove('cf-lock');
    setHTML($('cfModalBody'), '');
    var f = ui.lastFocus;
    ui.lastFocus = null;
    if (f && document.body.contains(f)) f.focus();
    else { var c = document.querySelector('.cf-post[data-i="' + (rank - 1) + '"]'); if (c) c.focus(); }
  }
  function tile(label, v, why) {
    return '<div class="cf-tile"><div class="cf-tile-l">' + esc(label) + '</div>'
      + '<div class="cf-tile-v' + (v == null ? ' is-na' : '') + '">' + esc(v == null ? '—' : v) + '</div>'
      + (v == null && why ? '<div class="cf-tile-w">' + esc(why) + '</div>' : '') + '</div>';
  }
  function renderModal() {
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
      tile('likes', fInt(p.likes), 'non fourni par l’API'),
      tile('commentaires', fInt(p.comments), 'non fourni par l’API'),
      tile('enregistrements', fInt(p.saved), 'non fourni par l’API'),
      tile('partages', fInt(p.shares), 'non fourni par l’API'),
      tile('interactions', fInt(p.interactions), 'non fourni par l’API'),
      tile('visionnage moyen', fSec(p.avgWatchS), isVid ? 'non fourni par l’API' : 'pas fourni pour ce type de publication'),
      tile('engagement / vues', eng, 'vues ou interactions manquantes'),
      tile('swipe < 3' + NB + 's', p.skipRate != null ? fShare(p.skipRate) : null, isVid ? 'non fourni par l’API' : 'pas fourni pour ce type de publication'),
      tile('temps total regardé', null, 'pas encore demandé à l’API')
    ].join('');
    setHTML($('cfModalBody'),
      '<div class="cf-sheet">'
      + '<div class="cf-sheet-media">' + (thumb ? '<img src="' + esc(thumb) + '" alt="Miniature de la publication" referrerpolicy="no-referrer" decoding="async">' : '<span class="cf-sheet-none">aperçu indisponible</span>') + '</div>'
      + '<div class="cf-sheet-info">'
      + '<div class="cf-meta">#' + rank + ' en vues · ' + esc(typeLabel(p.type)) + '</div>'
      + '<h2 class="cf-h2" id="cfModalTitle">' + esc(d ? 'Publication du ' + dmy(d) : 'Publication') + '</h2>'
      + '<p class="cf-sheet-cap">' + esc(capText(p.caption)) + '</p>'
      + (link ? '<a class="cf-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">voir sur Instagram ' + svg(IC.external, 12) + '</a>' : '')
      + '<div class="cf-tiles">' + tiles + '</div>'
      + '<div class="cf-bricks"><div class="cf-over">Briques utilisées</div>'
      + '<div class="cf-bricks-na">' + moduleChip(p.module, true)
      + '<span class="cf-meta">hook, liaison et CTA : pas encore reconnus</span></div>'
      + '<label class="cf-tag"><span class="cf-lbl">Module de la vidéo</span>'
      + '<select class="cf-in cf-tag-sel" data-tag-id="' + esc(p.id) + '">' + moduleOptions(p.module) + '</select></label>'
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

    // Module d'une publication (fiche) : enregistré tout de suite, message sous le menu.
    document.addEventListener('change', function (e) {
      var sel = e.target;
      if (!sel || !sel.matches || !sel.matches('select[data-tag-id]')) return;
      var id = sel.getAttribute('data-tag-id'), v = sel.value;
      sel.disabled = true;
      CF.tagMedia(id, v).then(function (r) {
        ui.tagMsg = { id: id, ok: !r.error, text: r.error ? 'Non enregistré : ' + r.error : (v ? 'Enregistré : ' + CF.MODULES[v] : 'Module retiré') };
        sel.disabled = false;
        schedule();
      });
    });

    // Bulle de la courbe Évolution : souris et doigt (le survol ne redessine jamais le panneau).
    document.addEventListener('mousemove', function (e) {
      var plot = e.target && e.target.closest ? e.target.closest('.cf-evo-plot') : null;
      if (plot) evoHover(plot, e.clientX); else if (evoCur) evoHide();
    });
    var onTouch = function (e) {
      var t = e.touches && e.touches[0], plot = t && e.target && e.target.closest ? e.target.closest('.cf-evo-plot') : null;
      if (plot) evoHover(plot, t.clientX); else if (evoCur) evoHide();
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
        CF.refresh({ igRange: ui.tab === 'compte' ? ui.range : null });
      }
    });

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
