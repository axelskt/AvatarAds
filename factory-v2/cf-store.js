/*
 * Creative Factory v2 · cf-store.js · étapes 0 et 1 du plan (préprod, lecture seule)
 *
 * UNE seule source par chiffre : l'interface ne lit que window.CF et se redessine sur l'événement
 * « cf-data » (detail = { ver, key }). Aucune donnée n'est gardée ailleurs (ni localStorage, ni copie).
 *
 *   CF.status  'boot' | 'auth' | 'loading' | 'ready' | 'forbidden' | 'error'
 *   CF.ver     compteur incrémenté à chaque changement du store
 *   CF.user    { id, email } de la session supabase-js (partagée avec l'app, même domaine)
 *   CF.acct    onglet Compte @avataradss
 *     .accounts  instagram-auth?action=accounts  → { state, loading, at, list, primary, error }
 *     .ig[r]     ig-insights?range=r, r ∈ 3j | 7j | 30j | 90j | 6m | all → { state, loading, at, data, error, kind }
 *                une case de cache par fenêtre, rechargée au plus toutes les 15 min ; data.series = un point par
 *                jour Instagram (courbe Évolution) ; historique incomplet → relu tout seul toutes les 4 s (8 fois max)
 *     .aud       ig-insights?part=audience → même forme ; abonnés par pays, ville, âge, genre (hors fenêtre)
 *     .media     ig-insights?part=media → même forme ; profil + toutes les publications (chiffres à vie) :
 *                publications et visionnage moyen par fenêtre, top publications
 *   CF.refresh(opts)  { gate } relance le contrôle d'accès ; sinon ne recharge que ce qui est périmé
 *                     { igRange } fenêtre Instagram à rafraîchir si périmée ; { force } ignore les 15 min
 *   CF.net     journal des appels réseau faits par le store (pour vérifier « 3 appels max, puis 0 »)
 *
 * Contrôle d'accès : 1er appel = RPC factory_access(). {error:'forbidden'} ⇒ « Accès réservé ».
 * Ses chiffres ne sont PAS gardés (formule des variantes fausse, cf. plan §3.3) : c'est une simple porte.
 * Lecture seule : CF_READONLY = true, SAUF le module d'une publication (tagMedia → RPC ig_media_tag_set, owner/dev) et
 * « Reconnecter » (igConnect) qui passe par le vrai OAuth Instagram et
 * réécrit ig_accounts en prod (voulu : renouveler le token du compte, plan étape 2).
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://guvwgiejzkiodghywpwj.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck'; // clé publishable (publique) ; jamais de clé service ici
  var FN = SUPABASE_URL + '/functions/v1/';
  var PRIMARY_USERNAME = 'avataradss';     // même compte par défaut qu'ig-insights (IG_PRIMARY_USERNAME)
  var IG_RANGES = ['3j', '7j', '30j', '90j', '6m', 'all'];   // 30 j = la fenêtre de l'app Instagram ; 3 j remplace 24 h (Instagram met ~48 h à tout compter)
  var TTL_MS = 15 * 60 * 1000;             // ~15 appels Graph par fenêtre : un chargement par fenêtre et par 15 min
  var TIMEOUT_MS = 45000;
  var SERIES_TIMEOUT_MS = 90000;           // 1er relevé d'un long historique : jusqu'à ~50 s côté serveur
  var SERIES_RETRY_MS = 4000, SERIES_RETRY_MAX = 8;

  window.CF_READONLY = true;

  function newSlot() { return { state: 'idle', loading: false, at: 0, data: null, error: null, kind: null }; }
  function newAcct() {
    return {
      accounts: { state: 'idle', loading: false, at: 0, list: [], primary: null, error: null },
      ig: { '3j': newSlot(), '7j': newSlot(), '30j': newSlot(), '90j': newSlot(), '6m': newSlot(), 'all': newSlot() },
      aud: newSlot(),
      media: newSlot()
    };
  }

  var CF = {
    status: 'boot',
    error: null,
    ver: 0,
    user: null,
    acct: newAcct(),
    oauth: null,
    net: [],
    IG_RANGES: IG_RANGES.slice(),
    TTL_MS: TTL_MS,
    PRIMARY_USERNAME: PRIMARY_USERNAME,
    refresh: refresh,
    loadAccounts: loadAccounts,
    loadInsights: loadInsights,
    loadAudience: loadAudience,
    loadMedia: loadMedia,
    prefetch: prefetch,
    tagMedia: tagMedia,
    isFresh: isFresh,
    igConnect: igConnect,
    guardWrite: guardWrite,
    auth: { signInPwd: signInPwd, sendOtp: sendOtp, verifyOtp: verifyOtp }
  };
  window.CF = CF;

  var sb = null;
  var epoch = 0;      // change à chaque changement d'utilisateur : une réponse d'avant n'écrit jamais dans le store
  var gateSeq = 0;
  var inflight = {};  // une seule requête en vol par source (accounts, ig:<fenêtre>, aud, media)
  var retries = {};   // relances automatiques d'un historique incomplet, par fenêtre
  var mediaPolls = 0; // relectures des publications pendant l'analyse des briques

  // ── utilitaires ──
  function emit(key) {
    CF.ver += 1;
    window.dispatchEvent(new CustomEvent('cf-data', { detail: { ver: CF.ver, key: key } }));
  }
  function setStatus(s, err) { CF.status = s; CF.error = err || null; emit('status'); }
  function logNet(call) {
    CF.net.push({ at: new Date().toISOString(), call: call });
    if (CF.net.length > 200) CF.net.shift();
  }
  function str(x) { return typeof x === 'string' && x ? x : null; }
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }
  function errText(e) {
    if (!e) return 'erreur inconnue';
    var m = String(e.message || e);
    return /failed to fetch|networkerror|load failed|network request failed/i.test(m) ? 'réseau indisponible' : m;
  }
  function isFresh(slot) { return !!slot && slot.state !== 'idle' && Date.now() - slot.at < TTL_MS; }
  function resetData() { epoch += 1; inflight = {}; retries = {}; mediaPolls = 0; if (typeof pre !== 'undefined') { pre.on = false; pre.queue = []; } CF.acct = newAcct(); CF.oauth = null; }

  // Garde pour les étapes suivantes (Valider, Refuser, Classer…) : tant que CF_READONLY est vrai, rien ne s'écrit.
  function guardWrite(label) {
    if (window.CF_READONLY) throw new Error('Préprod en lecture seule : « ' + label + ' » est désactivé (CF_READONLY).');
  }

  // ── session (reprise de factory.html, + onAuthStateChange) ──
  function onSession(session) {
    var u = session && session.user;
    if (!u) {
      if (CF.status === 'auth' && !CF.user) return;
      CF.user = null;
      resetData();
      setStatus('auth');
      return;
    }
    // Même utilisateur déjà chargé : simple rafraîchissement de jeton, rien à refaire.
    if (CF.user && CF.user.id === u.id && CF.status !== 'auth' && CF.status !== 'boot') return;
    if (!CF.user || CF.user.id !== u.id) resetData();
    CF.user = { id: u.id, email: u.email || '' };
    runGate();
  }

  // ── contrôle d'accès : factory_access() (RPC légère dédiée, migration 20260924150000) ──
  function runGate() {
    var my = ++gateSeq, ep = epoch;
    setStatus('loading');
    logNet('rpc factory_access');
    return Promise.resolve()
      .then(function () { return sb.rpc('factory_access'); })
      .then(function (res) {
        if (my !== gateSeq || ep !== epoch) return;
        var err = res && res.error, d = res && res.data;
        if (err) {
          var code = String(err.code || ''), st = res.status;
          if (code === '42501' || st === 403) return setStatus('forbidden');
          if (st === 401 || code === 'PGRST301' || code === 'PGRST303') {
            CF.user = null;
            resetData();
            return setStatus('auth', 'Session expirée : reconnecte-toi.');
          }
          return setStatus('error', errText(err));
        }
        if (d && typeof d === 'object' && !Array.isArray(d) && d.error) {
          return d.error === 'forbidden' ? setStatus('forbidden') : setStatus('error', 'factory_access : ' + String(d.error));
        }
        if (d == null) return setStatus('error', 'factory_access : réponse vide');
        setStatus('ready');
        loadAccounts();
      }, function (e) {
        if (my !== gateSeq || ep !== epoch) return;
        setStatus('error', errText(e));
      });
  }

  // ── appel d'une edge function avec le jeton de session (comme igAuthHeaders de factory.html) ──
  async function callFn(path, timeoutMs) {
    var r = await sb.auth.getSession();
    var tok = r && r.data && r.data.session && r.data.session.access_token;
    if (!tok) throw { kind: 'auth', message: 'session absente' };
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var tms = timeoutMs || TIMEOUT_MS;
    var tm = ctl ? setTimeout(function () { ctl.abort(); }, tms) : null;
    logNet(path);
    var resp;
    try {
      resp = await fetch(FN + path, { headers: { Authorization: 'Bearer ' + tok }, signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
    } catch (e) {
      throw { kind: 'network', message: e && e.name === 'AbortError' ? 'délai dépassé (' + Math.round(tms / 1000) + ' s)' : 'réseau indisponible' };
    } finally {
      if (tm) clearTimeout(tm);
    }
    var body = null;
    try { body = JSON.parse(await resp.text()); } catch (e) { body = null; }
    return { status: resp.status, ok: resp.ok, body: body };
  }

  // ── comptes Instagram reliés (jamais le token) ──
  function normAccount(a) {
    if (!a || typeof a !== 'object') return null;
    // Liste blanche : même si l'edge renvoyait un jour access_token, il n'entrerait jamais dans le store.
    return { ig_id: str(a.ig_id), username: str(a.username), updated_at: str(a.updated_at), token_expires_at: str(a.token_expires_at) };
  }
  function pickPrimary(list) {
    for (var i = 0; i < list.length; i++) {
      if ((list[i].username || '').toLowerCase() === PRIMARY_USERNAME) return list[i];
    }
    return null;
  }

  function loadAccounts(opts) {
    var force = !!(opts && opts.force), A = CF.acct.accounts;
    if (CF.status !== 'ready') return Promise.resolve(A);
    if (inflight.accounts) return inflight.accounts;
    if (!force && isFresh(A)) return Promise.resolve(A);
    var ep = epoch;
    A.loading = true;
    var p = (async function () {
      await null;
      var patch;
      try {
        var res = await callFn('instagram-auth?action=accounts');
        var b = res.body || {};
        if (!res.ok || b.error) throw { kind: res.status === 401 ? 'auth' : 'http', message: b.error ? String(b.error) : 'HTTP ' + res.status };
        var list = Array.isArray(b.accounts) ? b.accounts.map(normAccount).filter(Boolean) : [];
        patch = { state: 'ready', list: list, primary: pickPrimary(list), error: null };
      } catch (e) {
        patch = { state: 'error', error: errText(e) };
      }
      if (ep !== epoch) return A;
      Object.assign(A, patch, { loading: false, at: Date.now() });
      if (inflight.accounts === p) inflight.accounts = null;
      emit('accounts');
      return A;
    })();
    inflight.accounts = p;
    emit('accounts');
    return p;
  }

  // ── insights du compte, une fenêtre à la fois ──
  function ymd(x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null; }
  function normDay(p) {
    if (!p || typeof p !== 'object' || !ymd(p.d)) return null;
    return {
      d: p.d, reach: num(p.reach), views: num(p.views), engaged: num(p.accounts_engaged), inter: num(p.total_interactions),
      pviews: num(p.profile_views), links: num(p.profile_links_taps), bio: num(p.website_clicks),
      follows: num(p.follows), unfollows: num(p.unfollows)
    };
  }
  // Répartition { total, parts: {DIMENSION: n} } renvoyée par ig-insights ; null si absente ou illisible.
  function normBk(o) {
    if (!o || typeof o !== 'object' || !o.parts || typeof o.parts !== 'object') return null;
    var parts = {};
    Object.keys(o.parts).forEach(function (k) { var v = num(o.parts[k]); if (v != null) parts[k.slice(0, 80)] = v; });
    return { total: num(o.total), parts: parts };
  }
  function normInsights(b, range, at) {
    var ins = b.insights && typeof b.insights === 'object' ? b.insights : {};
    var pe = b.part_errors && typeof b.part_errors === 'object' ? b.part_errors : {};
    var since = num(b.since), until = num(b.until);
    var ser = b.series && typeof b.series === 'object' && Array.isArray(b.series.days) ? b.series : null;
    return {
      range: range,
      fetchedAt: at,
      // bornes exactes de la fenêtre demandée à l'API (secondes), sinon null ; jours Instagram (AAAA-MM-JJ, heure du Pacifique)
      since: since != null ? since * 1000 : null, until: until != null ? until * 1000 : null,
      dayFirst: ymd(b.day_first), dayLast: ymd(b.day_last),
      // courbe : un point par jour ; null = pas (encore) relevé ou refusé par l'API ce jour-là
      series: ser ? ser.days.map(normDay).filter(Boolean) : null,
      seriesMissing: ser ? (num(ser.missing) || 0) : 0,
      igId: str(b.ig_id), username: str(b.username), name: str(b.name), picture: str(b.profile_picture_url),
      followers: num(b.followers_count), follows: num(b.follows_count), media: num(b.media_count),
      basicError: str(b.basic_error),
      // valeurs de l'API pour CETTE fenêtre : directes jusqu'à 30 jours ; au-delà, somme des jours pour les métriques
      // additives (vues, interactions, vues de profil, clics) et « — » pour les comptes uniques (jamais additionnés)
      m: {
        reach: num(ins.reach), views: num(ins.views), engaged: num(ins.accounts_engaged),
        interactions: num(ins.total_interactions), profileViews: num(ins.profile_views), linkTaps: num(ins.profile_links_taps),
        bioTaps: num(b.website_clicks)
      },
      // répartitions de la même fenêtre (chacune son appel ; absente = sa raison dans err)
      flow: normBk(b.follows), flowPending: b.follows_pending === true, flowPendingDays: num(b.follows_pending_days) || 0,
      followersBase: b.followers_base && typeof b.followers_base === 'object' && num(b.followers_base.followers) != null && ymd(b.followers_base.day)
        ? { day: b.followers_base.day, followers: num(b.followers_base.followers) } : null,
      viewsByType: normBk(b.views_by_type),
      viewsByFollower: normBk(b.views_by_follower), reachByFollow: normBk(b.reach_by_follow),
      err: {
        follows: str(pe.follows), viewsByType: str(pe.views_by_type), viewsByFollower: str(pe.views_by_follower),
        reachByFollow: str(pe.reach_by_follow), bioTaps: str(pe.website_clicks),
        reach: str(pe['insights.reach']), views: str(pe['insights.views']), engaged: str(pe['insights.accounts_engaged']),
        interactions: str(pe['insights.total_interactions']), profileViews: str(pe['insights.profile_views']),
        linkTaps: str(pe['insights.profile_links_taps'])
      },
      mediaError: str(b.media_error)
    };
  }

  // La fenêtre réellement appliquée doit être celle affichée : 24 h glissantes (± 3 min), sinon N jours Instagram
  // entiers (aujourd'hui compris) ; « all » = depuis la 1re publication.
  var RANGE_DAYS = { '3j': 3, '7j': 7, '30j': 30, '90j': 90, '6m': 183 };
  function dayCount(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5) + 1; }
  function spanOk(b, range) {
    var s = num(b.since), u = num(b.until);
    if (s == null || u == null || u <= s) return false;
    if (range === '24h') return Math.abs((u - s) - 86400) <= 180;
    var f = ymd(b.day_first), l = ymd(b.day_last);
    if (!f || !l || !b.series || !Array.isArray(b.series.days)) return false;
    return range === 'all' ? dayCount(f, l) >= 1 : dayCount(f, l) === RANGE_DAYS[range];
  }
  function loadInsights(range, opts) {
    if (IG_RANGES.indexOf(range) < 0) {
      return Promise.reject(new Error('Fenêtre refusée : « ' + range + ' » (seulement 24h, 7j, 30j, 90j, 6m ou all).'));
    }
    var force = !!(opts && opts.force), key = 'ig:' + range, S = CF.acct.ig[range];
    if (CF.status !== 'ready') return Promise.resolve(S);
    if (inflight[key]) return inflight[key];
    if (!force && isFresh(S)) return Promise.resolve(S);
    var ep = epoch;
    S.loading = true;
    var p = (async function () {
      await null;
      var patch;
      try {
        var res = await callFn('ig-insights?range=' + range, SERIES_TIMEOUT_MS);
        var b = res.body || {};
        if (res.status === 400 && /aucun compte/i.test(String(b.error || ''))) {
          patch = { state: 'error', kind: 'disconnected', error: String(b.error), data: null };
        } else if (!res.ok || b.error) {
          throw { kind: res.status === 401 ? 'auth' : 'http', message: b.error ? String(b.error) : 'HTTP ' + res.status };
        } else if (b.range !== range) {
          // Garde-fou : ne jamais afficher sous « 7 j » des chiffres calculés sur une autre fenêtre.
          throw { kind: 'range', message: 'ig-insights a répondu pour « ' + b.range + ' » au lieu de « ' + range + ' »' };
        } else if (!spanOk(b, range)) {
          // Un ig-insights plus ancien que la page renvoie range=30j mais calcule 24 h, sans since/until.
          throw { kind: 'range', message: 'fenêtre non confirmée par ig-insights (fonction pas encore redéployée ?)' };
        } else {
          patch = { state: 'ready', kind: null, error: null, data: normInsights(b, range, Date.now()) };
        }
      } catch (e) {
        patch = { state: 'error', kind: e.kind || 'error', error: errText(e) };
        if (e.kind === 'auth' || e.kind === 'range') patch.data = null; // sinon on garde les chiffres précédents, datés
      }
      if (ep !== epoch) return S;
      Object.assign(S, patch, { loading: false, at: Date.now() });
      if (inflight[key] === p) delete inflight[key];
      pumpPrefetch();
      // Historique encore incomplet (1er relevé d'un long historique) : on relit la même fenêtre un peu plus tard.
      if (S.state === 'ready' && S.data && S.data.seriesMissing > 0 && (retries[range] || 0) < SERIES_RETRY_MAX) {
        retries[range] = (retries[range] || 0) + 1;
        retryWaits += 1;
        setTimeout(function () { retryWaits = Math.max(0, retryWaits - 1); if (ep === epoch) loadInsights(range, { force: true }); }, SERIES_RETRY_MS);
      }
      emit(key);
      return S;
    })();
    inflight[key] = p;
    emit(key);
    return p;
  }

  // ── audience des abonnés (hors fenêtre : ig-insights?part=audience) ──
  function normAudience(b, at) {
    var a = b.audience && typeof b.audience === 'object' ? b.audience : {};
    var er = b.audience_errors && typeof b.audience_errors === 'object' ? b.audience_errors : {};
    function list(x) {
      if (!Array.isArray(x)) return null;
      return x.map(function (p) {
        return Array.isArray(p) && typeof p[0] === 'string' && p[0] && num(p[1]) != null ? { k: p[0].slice(0, 80), v: num(p[1]) } : null;
      }).filter(Boolean);
    }
    return {
      fetchedAt: at,
      country: list(a.country), city: list(a.city), age: list(a.age), gender: list(a.gender),
      err: { country: str(er.country), city: str(er.city), age: str(er.age), gender: str(er.gender) }
    };
  }
  function loadAudience(opts) {
    var force = !!(opts && opts.force), S = CF.acct.aud;
    if (CF.status !== 'ready') return Promise.resolve(S);
    if (inflight.aud) return inflight.aud;
    if (!force && isFresh(S)) return Promise.resolve(S);
    var ep = epoch;
    S.loading = true;
    var p = (async function () {
      await null;
      var patch;
      try {
        var res = await callFn('ig-insights?part=audience');
        var b = res.body || {};
        if (res.status === 400 && /aucun compte/i.test(String(b.error || ''))) {
          patch = { state: 'error', kind: 'disconnected', error: String(b.error), data: null };
        } else if (!res.ok || b.error) {
          throw { kind: res.status === 401 ? 'auth' : 'http', message: b.error ? String(b.error) : 'HTTP ' + res.status };
        } else if (b.part !== 'audience') {
          // ig-insights pas encore redéployé : il renvoie la fenêtre 28 j au lieu de l'audience
          throw { kind: 'range', message: 'ig-insights ne connaît pas encore part=audience' };
        } else {
          patch = { state: 'ready', kind: null, error: null, data: normAudience(b, Date.now()) };
        }
      } catch (e) {
        patch = { state: 'error', kind: e.kind || 'error', error: errText(e) };
        if (e.kind === 'auth' || e.kind === 'range') patch.data = null;
      }
      if (ep !== epoch) return S;
      Object.assign(S, patch, { loading: false, at: Date.now() });
      if (inflight.aud === p) delete inflight.aud;
      pumpPrefetch();
      emit('aud');
      return S;
    })();
    inflight.aud = p;
    emit('aud');
    return p;
  }

  // ── publications (hors fenêtre : ig-insights?part=media) ──
  function normMediaItem(p) {
    if (!p || typeof p !== 'object') return null;
    var t = str(p.timestamp), ms = t ? Date.parse(t) : NaN;
    return {
      id: str(p.id), permalink: str(p.permalink), thumb: str(p.thumbnail), type: str(p.media_type),
      caption: typeof p.caption === 'string' ? p.caption : '', timestamp: t, ms: isFinite(ms) ? ms : null,
      reach: num(p.reach), views: num(p.views), likes: num(p.likes), comments: num(p.comments),
      saved: num(p.saved), shares: num(p.shares), interactions: num(p.interactions), avgWatchS: num(p.avg_watch_s),
      skipRate: num(p.skip_rate), totalWatchS: num(p.total_watch_s),
      trial: p.shared_to_feed === false,   // pas sur la grille du profil = réel d'essai (16 = 42 − 26 le 24/09)
      module: typeof p.module === 'string' && MODULES[p.module] ? p.module : null,
      analysis: normAnalysis(p.analysis)
    };
  }
  // Briques reconnues par ig-insights (transcription du reel comparée au texte des briques).
  function normAnalysis(a) {
    if (!a || typeof a !== 'object' || ['done', 'pending', 'error'].indexOf(a.status) < 0) return null;
    return {
      status: a.status, error: str(a.error), noVoice: a.no_voice === true,
      module: typeof a.module === 'string' && MODULES[a.module] ? a.module : null,
      bricks: Array.isArray(a.bricks) ? a.bricks.map(function (b) {
        return b && typeof b.id === 'string' && ['hook', 'liaison', 'cta'].indexOf(b.kind) >= 0
          ? { kind: b.kind, id: b.id.slice(0, 40), label: str(b.label) || b.id, score: num(b.score) } : null;
      }).filter(Boolean) : []
    };
  }
  function normMedia(b, at) {
    var list = Array.isArray(b.media) ? b.media.map(normMediaItem).filter(Boolean) : null;
    return {
      fetchedAt: at, username: str(b.username), followers: num(b.followers_count), mediaCount: num(b.media_count), mediaTotal: num(b.media_total),
      list: list || [], error: str(b.media_error) || (list ? null : 'liste absente de la réponse'),
      analysisPending: num(b.analysis_pending) || 0
    };
  }
  function loadMedia(opts) {
    var force = !!(opts && opts.force), S = CF.acct.media;
    if (CF.status !== 'ready') return Promise.resolve(S);
    if (inflight.media) return inflight.media;
    if (!force && isFresh(S)) return Promise.resolve(S);
    var ep = epoch;
    S.loading = true;
    var p = (async function () {
      await null;
      var patch;
      try {
        var res = await callFn('ig-insights?part=media', SERIES_TIMEOUT_MS);
        var b = res.body || {};
        if (res.status === 400 && /aucun compte/i.test(String(b.error || ''))) {
          patch = { state: 'error', kind: 'disconnected', error: String(b.error), data: null };
        } else if (!res.ok || b.error) {
          throw { kind: res.status === 401 ? 'auth' : 'http', message: b.error ? String(b.error) : 'HTTP ' + res.status };
        } else if (b.part !== 'media') {
          throw { kind: 'range', message: 'ig-insights ne connaît pas encore part=media' };
        } else {
          patch = { state: 'ready', kind: null, error: null, data: normMedia(b, Date.now()) };
        }
      } catch (e) {
        patch = { state: 'error', kind: e.kind || 'error', error: errText(e) };
        if (e.kind === 'auth' || e.kind === 'range') patch.data = null;
      }
      if (ep !== epoch) return S;
      Object.assign(S, patch, { loading: false, at: Date.now() });
      if (inflight.media === p) delete inflight.media;
      // Analyse des briques en cours côté serveur : on relit la liste dans une minute (8 fois au plus).
      if (S.state === 'ready' && S.data && S.data.analysisPending > 0 && mediaPolls < 8) {
        mediaPolls += 1;
        setTimeout(function () { if (ep === epoch) loadMedia({ force: true }); }, 60000);
      }
      pumpPrefetch();
      emit('media');
      return S;
    })();
    inflight.media = p;
    emit('media');
    return p;
  }

  // ── préchargement : une fois la fenêtre affichée prête, les autres se chargent UNE par UNE en arrière-plan →
  //    passer de 30 j à 7 j ou à All time devient instantané (cache 15 min comme le reste) ──
  var pre = { on: false, queue: [], ep: -1 };
  var retryWaits = 0;   // relectures d'historique programmées (setTimeout) : le préchargement attend qu'elles passent
  function prefetch(first) {
    if (pre.on && pre.ep === epoch) return;   // déjà lancé pour cette session : rien à refaire
    pre.on = true;
    pre.ep = epoch;
    pre.queue = IG_RANGES.filter(function (r) { return r !== first; });
    pumpPrefetch();
  }
  function pumpPrefetch() {
    if (!pre.on || pre.ep !== epoch || CF.status !== 'ready' || retryWaits > 0) return;
    for (var q = 0; q < IG_RANGES.length; q++) { if (CF.acct.ig[IG_RANGES[q]].kind === 'disconnected') { pre.queue = []; return; } }
    for (var k in inflight) { if (inflight[k] && k !== 'accounts') return; }   // une seule requête Instagram à la fois
    while (pre.queue.length) {
      var r = pre.queue.shift(), S = CF.acct.ig[r];
      if (S.kind === 'disconnected') { pre.queue = []; return; }
      if (!isFresh(S)) { setTimeout(function () { loadInsights(r); }, 300); return; }
    }
  }

  // ── module d'une publication (seule écriture du dashboard avec « Reconnecter » : action explicite du propriétaire) ──
  var MODULES = { 'motion-control': 'Motion Control', 'omni': 'Omni', 'express': 'Express', 'generateur': 'Générateur',
    'image-ia': 'Images IA', 'montage-ia': 'Montage IA', 'mcp-claude': 'MCP Claude', 'autre': 'Autre' };
  CF.MODULES = MODULES;
  async function tagMedia(id, module) {
    if (!sb || CF.status !== 'ready') return { error: 'pas prêt' };
    if (module && !MODULES[module]) return { error: 'module inconnu' };
    logNet('rpc ig_media_tag_set');
    try {
      var r = await sb.rpc('ig_media_tag_set', { p_media: String(id), p_module: module || '' });
      var d = r && r.data;
      if (r.error || !d || d.error) return { error: r.error ? errText(r.error) : (d && d.error) || 'réponse vide' };
      var M = CF.acct.media.data;
      if (M) M.list.forEach(function (p) { if (p.id === String(id)) p.module = d.module || null; });
      emit('media');
      return { ok: true };
    } catch (e) { return { error: errText(e) }; }
  }

  // ── rafraîchissement ──
  function refresh(opts) {
    opts = opts || {};
    if (!sb) { location.reload(); return Promise.resolve(); }
    if (opts.gate || CF.status === 'error') {
      if (!CF.user) {
        return sb.auth.getSession().then(function (r) { onSession(r && r.data && r.data.session); },
          function (e) { setStatus('error', errText(e)); });
      }
      return runGate();
    }
    if (CF.status !== 'ready') return Promise.resolve();
    var tasks = [loadAccounts({ force: !!opts.force })];
    if (opts.igRange) tasks.push(loadInsights(opts.igRange, { force: !!opts.force }), loadAudience({ force: !!opts.force }), loadMedia({ force: !!opts.force }));
    return Promise.all(tasks);
  }

  // ── Reconnecter (reprise d'igConnect de factory.html) ──
  // À appeler DIRECTEMENT dans le gestionnaire de clic : la popup s'ouvre avant tout await, sinon Safari la bloque.
  function igConnect() {
    var w = window.open('about:blank', 'ig_oauth', 'width=560,height=760');
    if (!w) return Promise.resolve({ ok: false, error: 'Popup bloquée : autorise les popups pour avatarads.fr puis réessaie.' });
    logNet('instagram-auth?action=authorize');
    return fetch(FN + 'instagram-auth?action=authorize')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var u = d && typeof d.authorize_url === 'string' ? d.authorize_url : '';
        if (/^https:\/\/(www\.)?instagram\.com\//.test(u)) { w.location.href = u; return { ok: true }; }
        try { w.close(); } catch (e) { /* rien */ }
        return { ok: false, error: (d && d.error) ? String(d.error) : 'URL d’autorisation absente' };
      })
      .catch(function () {
        try { w.close(); } catch (e) { /* rien */ }
        return { ok: false, error: 'réseau indisponible' };
      });
  }

  // Résultat renvoyé par ig-callback.html (postMessage + BroadcastChannel 'ig-oauth') : on relit sans recharger la page.
  var lastOauth = { key: '', t: 0 };
  function onOauth(msg) {
    if (!msg || typeof msg !== 'object' || msg.source !== 'ig-oauth') return;
    var key = (msg.ok ? '1' : '0') + '|' + String(msg.ig_id || '') + '|' + String(msg.error || '');
    if (key === lastOauth.key && Date.now() - lastOauth.t < 5000) return; // les deux canaux livrent le même message
    lastOauth = { key: key, t: Date.now() };
    CF.oauth = {
      ok: !!msg.ok,
      username: msg.ok && typeof msg.username === 'string' ? msg.username.slice(0, 60) : null,
      error: msg.ok ? null : String(msg.error || 'connexion échouée').slice(0, 200),
      at: Date.now()
    };
    if (msg.ok && CF.status === 'ready') {
      // Le compte ou son token ont changé : toutes les fenêtres en cache sont invalidées.
      IG_RANGES.forEach(function (r) { CF.acct.ig[r] = newSlot(); delete inflight['ig:' + r]; });
      CF.acct.aud = newSlot(); delete inflight.aud;
      CF.acct.media = newSlot(); delete inflight.media;
      retries = {};
      pre.on = false;   // relancé par l'onglet Compte au prochain rendu (nouveau token)
      pre.queue = [];
      emit('oauth');
      loadAccounts({ force: true });
      return;
    }
    emit('oauth');
  }

  // ── connexion (mot de passe ou code, shouldCreateUser:false) ──
  async function signInPwd(email, password) {
    if (!sb) return { error: 'supabase-js indisponible' };
    try {
      var r = await sb.auth.signInWithPassword({ email: email, password: password });
      if (r.error) return { error: r.error.message };
      onSession(r.data && r.data.session);
      return { ok: true };
    } catch (e) { return { error: errText(e) }; }
  }
  async function sendOtp(email) {
    if (!sb) return { error: 'supabase-js indisponible' };
    try {
      var r = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false } });
      return r.error ? { error: r.error.message } : { ok: true };
    } catch (e) { return { error: errText(e) }; }
  }
  async function verifyOtp(email, token) {
    if (!sb) return { error: 'supabase-js indisponible' };
    try {
      var r = await sb.auth.verifyOtp({ email: email, token: token, type: 'email' });
      if (r.error) return { error: r.error.message };
      onSession(r.data && r.data.session);
      return { ok: true };
    } catch (e) { return { error: errText(e) }; }
  }

  // ── démarrage ──
  try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch (e) { sb = null; }
  if (!sb) {
    setStatus('error', 'supabase-js n’a pas pu être chargé (réseau ou empreinte SRI).');
    return;
  }
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'INITIAL_SESSION') return; // traité par getSession() ci-dessous
    // Jamais d'appel supabase dans le rappel lui-même (verrou interne de supabase-js) : on diffère.
    setTimeout(function () { onSession(session); }, 0);
  });
  sb.auth.getSession().then(
    function (r) { onSession(r && r.data && r.data.session); },
    function (e) { setStatus('error', 'Session illisible : ' + errText(e)); }
  );
  window.addEventListener('message', function (e) { if (e.origin === location.origin) onOauth(e.data); });
  try {
    var bc = new BroadcastChannel('ig-oauth');
    bc.onmessage = function (e) { onOauth(e.data); };
  } catch (e) { /* BroadcastChannel absent : postMessage suffit */ }
})();
