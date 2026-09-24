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
    { k: '24h', label: '24' + NB + 'h', per: 'sur 24' + NB + 'h', days: 1, live: true },
    { k: '7j', label: '7' + NB + 'j', per: 'sur 7' + NB + 'j', days: 7, live: true },
    { k: '30j', label: '30' + NB + 'j', per: 'sur 30' + NB + 'j', days: 30, live: true }, // la fenêtre de l'app Instagram
    { k: '90j', label: '90' + NB + 'j', live: false },
    { k: '6m', label: '6' + NB + 'mois', live: false },
    { k: 'all', label: 'All time', live: false }
  ];
  var PERIOD = {};
  PERIODS.forEach(function (p) { PERIOD[p.k] = p; });

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
  var ui = { tab: readTab(), range: '30j', modal: null, lastFocus: null, recon: null, lastStatus: null };

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
    return '<section class="cf-title"><h1>Compte @' + esc(CF.PRIMARY_USERNAME) + '</h1></section>'
      + acctHTML(D)
      + insightsHTML(S, D, off)
      + splitHTML(S, D, off)
      + evolutionHTML()
      + topHTML(S, D, off)
      + audienceHTML(D, off);
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
    var P = PERIOD[ui.range];
    var until = D ? new Date(D.until != null ? D.until : D.fetchedAt) : new Date();
    var since = D && D.since != null ? new Date(D.since) : new Date(until.getTime() - P.days * 864e5);
    var range = P.k === '24h'
      ? dm(since) + ' ' + hm(since) + ' → ' + dm(until) + ' ' + hm(until)
      : dm(since) + ' → ' + dmy(until);
    var when = D ? ' · relevé à ' + hm(until) + (S.state === 'error' ? ' (actualisation échouée)' : '') : '';
    return '<span class="cf-over">Période sélectionnée</span> ' + esc(range + when);
  }

  function insightsHTML(S, D, off) {
    var seg = PERIODS.map(function (p) {
      if (!p.live) {
        return '<button type="button" class="cf-seg-b" disabled title="historique pas encore relevé">' + esc(p.label) + '</button>';
      }
      var on = p.k === ui.range;
      return '<button type="button" class="cf-seg-b' + (on ? ' is-on' : '') + '" data-act="range" data-range="' + p.k + '" aria-pressed="' + on + '">' + esc(p.label) + '</button>';
    }).join('');
    return '<section class="cf-sec" aria-labelledby="cfInsT">'
      + '<div class="cf-sec-h"><div><h2 class="cf-h2" id="cfInsT">Insights du compte</h2>'
      + '<div class="cf-meta">@' + esc(CF.PRIMARY_USERNAME) + ' · instagram graph · valeur directe par période</div></div>'
      + '<div class="cf-seg" role="group" aria-label="Période">' + seg + '</div></div>'
      + '<div class="cf-per">' + periodLine(S, D) + '</div>'
      + '<div class="cf-note">' + svg(IC.info, 12) + '<span>90' + NB + 'j, 6' + NB + 'mois et All time : historique pas encore relevé.</span></div>'
      + slotBanner(S, D)
      + '<div class="cf-kpis">' + kpiCards(S, D, off) + '</div>'
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
        + (D ? 'Actualisation ' : 'Chargement des insights ') + esc(P.per) + '…</div>';
    }
    return '';
  }
  function banner(tone, icon, html, action) {
    return '<div class="cf-banner is-' + tone + '" role="status"><span class="cf-banner-ic">' + svg(icon, 16) + '</span><span class="cf-banner-t">' + html + '</span>' + (action || '') + '</div>';
  }

  function kpiCards(S, D, off) {
    var per = PERIOD[ui.range].per;
    var pending = !D && !off && (S.loading || S.state === 'idle');
    var why = off ? 'compte déconnecté' : (!D && S.state === 'error' ? 'erreur de chargement' : 'non fourni par l’API Instagram');
    var M = D ? D.m : {};
    function card(label, icon, kind, value, sub, extra, opt) {
      var v, s, na = false;
      opt = opt || {};
      if (pending) { v = '…'; s = 'chargement'; }
      else if (value == null) { v = '—'; s = opt.why || why; na = true; }
      else { v = (opt.fmt || fInt)(value); s = sub; }
      return '<div class="cf-kpi' + (kind ? ' is-' + kind : '') + '">'
        + '<div class="cf-kpi-h"><span class="cf-kpi-ic">' + svg(icon, 15) + '</span><span class="cf-kpi-l">' + esc(label) + '</span></div>'
        + '<div class="cf-kpi-v' + (na ? ' is-na' : '') + '">' + esc(v) + '</div>'
        + '<div class="cf-kpi-s">' + esc(s) + '</div>'
        + (extra ? '<div class="cf-kpi-x">' + esc(extra) + '</div>' : '')
        + '</div>';
    }
    var reach = M.reach, views = M.views, eng = M.engaged, inter = M.interactions, pv = M.profileViews, taps = M.linkTaps, bio = M.bioTaps;
    var engPct = fPct(eng, reach), bioPct = fPct(bio, pv);
    var vpr = views != null && reach ? views / reach : null;
    var ipe = inter != null && eng ? inter / eng : null;
    var E = D && !off ? D.err : {};
    // follows_and_unfollows : FOLLOWER = abonnements, NON_FOLLOWER = désabonnements (ou comptes supprimés)
    var F = D && !off ? D.flow : null, fin = F ? (F.parts.FOLLOWER || 0) : null, fout = F ? (F.parts.NON_FOLLOWER || 0) : null;
    var follow = F
      ? card('Abonnés', IC.follow, 'static', fin - fout, 'net ' + per + ' · total ' + (D.followers == null ? '—' : fInt(D.followers)),
          fSigned(fin) + ' ' + plural(fin, 'abonnement') + ' · ' + fSigned(-fout) + ' ' + plural(fout, 'désabonnement'), { fmt: fSigned })
      : card('Abonnés', IC.follow, 'static', D ? D.followers : null, 'total actuel',
          pending ? '' : 'net ' + per + ' : — · ' + (E.follows ? 'refusé par l’API : ' + E.follows : D ? 'non fourni par l’API Instagram' : why));
    return [
      follow,
      card('Publications', IC.grid, 'static', D ? D.media : null, 'total publié'),
      card('Comptes engagés', IC.users, 'hero', eng, engPct ? engPct + ' du reach · ' + per : per),
      card('Reach', IC.reach, '', reach, 'comptes uniques touchés · ' + per),
      card('Vues', IC.eye, '', views, vpr != null ? fDec(vpr, 2) + ' ' + plural(vpr, 'vue') + ' par compte touché' : per),
      card('Interactions', IC.heart, '', inter, ipe != null ? fDec(ipe, 1) + ' par compte engagé' : per),
      card('Vues de profil', IC.user, '', pv, per),
      // website_clicks = le lien en bio (absent de la doc actuelle : souvent refusé) ; profile_links_taps = les boutons
      // de contact (appel, e-mail, itinéraire…). Sans website_clicks, la carte montre les boutons, sous leur vrai nom.
      bio != null
        ? card('Clics lien en bio', IC.link, '', bio, bio === 0 ? 'aucun clic ' + per : bioPct ? bioPct + ' des vues de profil' : per,
            'boutons de contact : ' + (taps == null ? '—' : fInt(taps)))
        : card('Clics boutons de contact', IC.link, '', taps, taps === 0 ? 'aucun clic ' + per : fPct(taps, pv) ? fPct(taps, pv) + ' des vues de profil' : per,
            pending ? '' : 'lien en bio : — · ' + (E.bioTaps ? 'non fourni par l’API Instagram (' + E.bioTaps + ')' : 'non fourni par l’API Instagram'))
    ].join('');
  }

  // ── répartitions de la fenêtre : vues par type de contenu, abonnés / non-abonnés ──
  var TYPE_L = { REEL: 'Reels', REELS: 'Reels', POST: 'Publications', FEED: 'Publications', CAROUSEL_CONTAINER: 'Carrousels', STORY: 'Stories', AD: 'Publicités' };
  var FOL_L = { FOLLOWER: 'Abonnés', NON_FOLLOWER: 'Non-abonnés', UNKNOWN: 'Inconnu' };
  // Barres en % de la SOMME des parts (pas du total de la carte : une répartition peut ne pas retomber pile dessus).
  function barsHTML(rows, opt) {
    opt = opt || {};
    var sum = rows.reduce(function (a, r) { return a + r.v; }, 0);
    if (!rows.length || !sum) return '<div class="cf-empty-s">' + esc(opt.zero || 'Aucune donnée sur la période.') + '</div>';
    return '<div class="cf-bars">' + rows.map(function (r) {
      var pct = r.v / sum * 100;
      return '<div class="cf-bar"><span class="cf-bar-l" title="' + esc(r.l) + '">' + esc(r.l) + '</span>'
        + '<span class="cf-bar-t" aria-hidden="true"><span style="width:' + Math.max(pct, pct > 0 ? 1.5 : 0).toFixed(1) + '%"></span></span>'
        + '<span class="cf-bar-v">' + esc((pct > 0 && pct < 0.05 ? '< 0,1' : fDec(pct, pct < 10 && pct > 0 ? 1 : 0)) + NB + '%') + (opt.counts ? '<i>' + esc(fInt(r.v)) + '</i>' : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function bkRows(bk, labels) {
    return Object.keys(bk.parts).map(function (k) { return { l: labels[k] || k.toLowerCase(), v: bk.parts[k] }; })
      .sort(function (a, b) { return b.v - a.v; });
  }
  function bkBlock(title, bk, err, labels, pending, off, loadErr) {
    var body;
    if (off) body = emptyLine('—', 'compte déconnecté');
    else if (loadErr) body = emptyLine('—', 'erreur de chargement');
    else if (pending) body = '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement…</div>';
    else if (!bk) body = emptyLine('—', err ? 'refusé par l’API Instagram : ' + err : 'non fourni par l’API Instagram');
    else body = barsHTML(bkRows(bk, labels), { counts: true });
    return '<div class="cf-split-b"><div class="cf-over">' + esc(title) + '</div>' + body + '</div>';
  }
  function splitHTML(S, D, off) {
    var P = PERIOD[ui.range], pending = !D && !off && (S.loading || S.state === 'idle');
    var E = D ? D.err : {}, le = !D && !off && !S.loading && S.state === 'error';
    return '<section class="cf-card"><div class="cf-card-h"><div><h2 class="cf-h2">Répartition ' + esc(P.per) + '</h2>'
      + '<div class="cf-meta">vues par type de contenu · abonnés et non-abonnés · même période que les insights</div></div></div>'
      + '<div class="cf-split">'
      + bkBlock('Vues par type de contenu', D && D.viewsByType, E.viewsByType, TYPE_L, pending, off, le)
      + bkBlock('Vues · abonnés / non-abonnés', D && D.viewsByFollower, E.viewsByFollower, FOL_L, pending, off, le)
      + bkBlock('Reach · abonnés / non-abonnés', D && D.reachByFollow, E.reachByFollow, FOL_L, pending, off, le)
      + '</div></section>';
  }

  function evolutionHTML() {
    return '<section class="cf-card"><div class="cf-card-h"><h2 class="cf-h2">Évolution</h2></div>'
      + '<div class="cf-empty">' + svg(IC.chart, 20) + '<div><b>Courbe disponible après le premier relevé quotidien.</b>'
      + '<span>L’API Instagram ne renvoie qu’un total par période ; aucun relevé jour par jour n’est encore stocké.</span></div></div></section>';
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

  function topHTML(S, D, off) {
    var head = '<div class="cf-card-h"><div><h2 class="cf-h2">Top publications parmi les 12 dernières</h2>'
      + '<div class="cf-meta">triées par vues · chiffres à vie de chaque publication, indépendants de la période</div></div></div>';
    var body;
    if (off) body = emptyLine('—', 'compte déconnecté');
    else if (!D) body = (S.loading || S.state === 'idle') ? '<div class="cf-status"><span class="cf-spin" aria-hidden="true"></span>Chargement des publications…</div>' : emptyLine('—', S.error || 'indisponible');
    else if (!D.posts.length && D.postsError) body = emptyLine('—', 'liste des publications indisponible : ' + D.postsError);
    else if (!D.posts.length) body = '<div class="cf-empty-s">Aucune publication pour l’instant.</div>';
    else body = '<div class="cf-posts">' + D.posts.map(postRowHTML).join('') + '</div>';
    return '<section class="cf-card">' + head + body + '</section>';
  }

  function postRowHTML(p, i) {
    var thumb = safeUrl(p.thumb), d = validDate(p.timestamp), vid = isVideo(p);
    var stats = [stat(fInt(p.views), plural(p.views, 'vue'), true), stat(fInt(p.likes), plural(p.likes, 'like')), stat(fInt(p.comments), 'comm.')];
    if (p.avgWatchS != null) stats.push(stat(fSec(p.avgWatchS), 'visionnage moyen'));
    stats.push(stat(null, 'swipe < 3' + NB + 's'));
    return '<button type="button" class="cf-post" data-act="post" data-i="' + i + '" aria-label="Ouvrir la fiche de la publication ' + (i + 1) + '">'
      + '<span class="cf-post-rank">#' + (i + 1) + '</span>'
      + '<span class="cf-thumb">' + (thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '')
      + (vid ? '<span class="cf-thumb-play">' + svg(IC.play, 10) + '</span>' : '') + '</span>'
      + '<span class="cf-post-b">'
      + '<span class="cf-post-meta"><span class="cf-chip is-muted">vidéo non reconnue</span><span class="cf-meta">'
      + esc((d ? 'posté le ' + dmy(d) : 'date inconnue') + ' · ' + typeLabel(p.type)) + '</span></span>'
      + '<span class="cf-post-cap">' + esc(capText(p.caption)) + '</span>'
      + '<span class="cf-post-stats">' + stats.join('') + '</span>'
      + '</span>'
      + '<span class="cf-post-go">' + svg(IC.chevron, 16) + '</span>'
      + '</button>';
  }

  var AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  var GENDER_L = { M: 'Hommes', F: 'Femmes', U: 'Non précisé' };
  var regionName = (function () {
    var dn = null;
    try { dn = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch (e) { dn = null; }
    return function (code) { try { return (dn && /^[A-Z]{2}$/.test(code) && dn.of(code)) || code; } catch (e) { return code; } };
  })();
  // Les N premiers + « Autres » (le reste des 45 valeurs renvoyées par Instagram).
  function topRows(list, n, label) {
    var rows = list.slice(0, n).map(function (x) { return { l: label(x.k), v: x.v }; });
    var rest = list.slice(n).reduce(function (a, x) { return a + x.v; }, 0);
    if (rest > 0) rows.push({ l: 'Autres', v: rest });
    return rows;
  }
  function audBlock(title, list, err, rowsOf) {
    var body = list ? barsHTML(rowsOf(list), { zero: 'Aucune donnée.' })
      : emptyLine('—', err ? 'refusé par l’API Instagram : ' + err : 'non fourni par l’API Instagram');
    return '<div class="cf-split-b"><div class="cf-over">' + esc(title) + '</div>' + body + '</div>';
  }
  function audienceHTML(D, off) {
    var A = CF.acct.aud, X = A.data, f = D && !off ? D.followers : null;
    var head = '<div class="cf-card-h"><div><h2 class="cf-h2">Audience</h2>'
      + '<div class="cf-meta">abonnés actuels @' + esc(CF.PRIMARY_USERNAME) + ' · données Instagram · en % des 45 premières valeurs</div></div>'
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
        + '<div class="cf-split cf-aud">'
        + audBlock('Pays', X.country, X.err.country, function (l) { return topRows(l, 5, regionName); })
        + audBlock('Villes principales', X.city, X.err.city, function (l) { return topRows(l, 5, function (k) { return k.split(',')[0]; }); })
        + audBlock('Âge', X.age, X.err.age, function (l) {
            return l.slice().sort(function (a, b) {
              var ia = AGE_ORDER.indexOf(a.k), ib = AGE_ORDER.indexOf(b.k);
              return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            }).map(function (x) { return { l: x.k, v: x.v }; });
          })
        + audBlock('Genre', X.gender, X.err.gender, function (l) { return l.map(function (x) { return { l: GENDER_L[x.k] || x.k, v: x.v }; }); })
        + '</div>';
    }
    return '<section class="cf-card">' + head + body + '</section>';
  }
  function emptyLine(v, why) {
    return '<div class="cf-na-line"><span class="cf-na-v">' + esc(v) + '</span><span>' + esc(why) + '</span></div>';
  }

  // ── fiche post (modale) ──
  function openPost(i, trigger) {
    var D = CF.acct.ig[ui.range].data;
    if (!D || !D.posts[i]) return;
    ui.modal = { post: D.posts[i], rank: i + 1 };
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
      tile('swipe < 3' + NB + 's', null, 'pas encore demandé à l’API'),
      tile('temps total regardé', null, 'pas encore demandé à l’API')
    ].join('');
    setHTML($('cfModalBody'),
      '<div class="cf-sheet">'
      + '<div class="cf-sheet-media">' + (thumb ? '<img src="' + esc(thumb) + '" alt="Miniature de la publication" referrerpolicy="no-referrer" decoding="async">' : '<span class="cf-sheet-none">aperçu indisponible</span>') + '</div>'
      + '<div class="cf-sheet-info">'
      + '<div class="cf-meta">#' + rank + ' en vues · parmi les 12 dernières · ' + esc(typeLabel(p.type)) + '</div>'
      + '<h2 class="cf-h2" id="cfModalTitle">' + esc(d ? 'Publication du ' + dmy(d) : 'Publication') + '</h2>'
      + '<p class="cf-sheet-cap">' + esc(capText(p.caption)) + '</p>'
      + (link ? '<a class="cf-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">voir sur Instagram ' + svg(IC.external, 12) + '</a>' : '')
      + '<div class="cf-tiles">' + tiles + '</div>'
      + '<div class="cf-bricks"><div class="cf-over">Briques utilisées</div>'
      + '<div class="cf-bricks-na"><span class="cf-chip is-muted">' + svg(IC.puzzle, 12) + 'vidéo non reconnue · briques inconnues</span>'
      + '<span class="cf-meta">le lien publication → vidéo finale n’est pas encore enregistré</span></div></div>'
      + '<p class="cf-meta">Chiffres à vie de la publication, lus en direct sur Instagram.</p>'
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
