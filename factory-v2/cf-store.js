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
 *     .ig[r]     ig-insights?range=r, r ∈ 24h | 7j | 30j → { state, loading, at, data, error, kind }
 *                une case de cache par fenêtre, rechargée au plus toutes les 15 min
 *     .aud       ig-insights?part=audience → même forme ; abonnés par pays, ville, âge, genre (hors fenêtre)
 *   CF.refresh(opts)  { gate } relance le contrôle d'accès ; sinon ne recharge que ce qui est périmé
 *                     { igRange } fenêtre Instagram à rafraîchir si périmée ; { force } ignore les 15 min
 *   CF.net     journal des appels réseau faits par le store (pour vérifier « 3 appels max, puis 0 »)
 *
 * Contrôle d'accès : 1er appel = RPC factory_access(). {error:'forbidden'} ⇒ « Accès réservé ».
 * Ses chiffres ne sont PAS gardés (formule des variantes fausse, cf. plan §3.3) : c'est une simple porte.
 * Lecture seule : CF_READONLY = true, SAUF « Reconnecter » (igConnect) qui passe par le vrai OAuth Instagram et
 * réécrit ig_accounts en prod (voulu : renouveler le token du compte, plan étape 2).
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://guvwgiejzkiodghywpwj.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_Y8a0bHB-noCva13tLH26zQ_DjKC29Ck'; // clé publishable (publique) ; jamais de clé service ici
  var FN = SUPABASE_URL + '/functions/v1/';
  var PRIMARY_USERNAME = 'avataradss';     // même compte par défaut qu'ig-insights (IG_PRIMARY_USERNAME)
  var IG_RANGES = ['24h', '7j', '30j'];    // 30 j = la fenêtre de l'app Instagram ; ig-insights : toute autre valeur retombe EN SILENCE sur 24 h
  var TTL_MS = 15 * 60 * 1000;             // ~15 appels Graph par fenêtre : un chargement par fenêtre et par 15 min
  var TIMEOUT_MS = 45000;

  window.CF_READONLY = true;

  function newSlot() { return { state: 'idle', loading: false, at: 0, data: null, error: null, kind: null }; }
  function newAcct() {
    return {
      accounts: { state: 'idle', loading: false, at: 0, list: [], primary: null, error: null },
      ig: { '24h': newSlot(), '7j': newSlot(), '30j': newSlot() },
      aud: newSlot()
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
    isFresh: isFresh,
    igConnect: igConnect,
    guardWrite: guardWrite,
    auth: { signInPwd: signInPwd, sendOtp: sendOtp, verifyOtp: verifyOtp }
  };
  window.CF = CF;

  var sb = null;
  var epoch = 0;      // change à chaque changement d'utilisateur : une réponse d'avant n'écrit jamais dans le store
  var gateSeq = 0;
  var inflight = {};  // une seule requête en vol par source (accounts, ig:24h, ig:7j, ig:30j, aud)

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
  function resetData() { epoch += 1; inflight = {}; CF.acct = newAcct(); CF.oauth = null; }

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
  async function callFn(path) {
    var r = await sb.auth.getSession();
    var tok = r && r.data && r.data.session && r.data.session.access_token;
    if (!tok) throw { kind: 'auth', message: 'session absente' };
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var tm = ctl ? setTimeout(function () { ctl.abort(); }, TIMEOUT_MS) : null;
    logNet(path);
    var resp;
    try {
      resp = await fetch(FN + path, { headers: { Authorization: 'Bearer ' + tok }, signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
    } catch (e) {
      throw { kind: 'network', message: e && e.name === 'AbortError' ? 'délai dépassé (45 s)' : 'réseau indisponible' };
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
  function normPost(p) {
    if (!p || typeof p !== 'object') return null;
    return {
      id: str(p.id), permalink: str(p.permalink), thumb: str(p.thumbnail), type: str(p.media_type),
      caption: typeof p.caption === 'string' ? p.caption : '', timestamp: str(p.timestamp),
      reach: num(p.reach), views: num(p.views), likes: num(p.likes), comments: num(p.comments),
      saved: num(p.saved), shares: num(p.shares), interactions: num(p.interactions), avgWatchS: num(p.avg_watch_s)
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
    var posts = Array.isArray(b.top_posts) ? b.top_posts : null;
    var pe = b.part_errors && typeof b.part_errors === 'object' ? b.part_errors : {};
    var since = num(b.since), until = num(b.until);
    return {
      range: range,
      fetchedAt: at,
      // bornes exactes de la fenêtre demandée à l'API (secondes), sinon null
      since: since != null ? since * 1000 : null, until: until != null ? until * 1000 : null,
      igId: str(b.ig_id), username: str(b.username), name: str(b.name), picture: str(b.profile_picture_url),
      followers: num(b.followers_count), follows: num(b.follows_count), media: num(b.media_count),
      basicError: str(b.basic_error),
      // valeur directe de l'API pour CETTE fenêtre (since/until) : jamais additionnée, jamais déduite d'une autre fenêtre
      m: {
        reach: num(ins.reach), views: num(ins.views), engaged: num(ins.accounts_engaged),
        interactions: num(ins.total_interactions), profileViews: num(ins.profile_views), linkTaps: num(ins.profile_links_taps),
        bioTaps: num(b.website_clicks)
      },
      // répartitions de la même fenêtre (chacune son appel ; absente = sa raison dans err)
      flow: normBk(b.follows), viewsByType: normBk(b.views_by_type),
      viewsByFollower: normBk(b.views_by_follower), reachByFollow: normBk(b.reach_by_follow),
      err: {
        follows: str(pe.follows), viewsByType: str(pe.views_by_type), viewsByFollower: str(pe.views_by_follower),
        reachByFollow: str(pe.reach_by_follow), bioTaps: str(pe.website_clicks)
      },
      // ig-insights : 5 meilleures (en vues) des 12 derniers médias, chiffres à vie de chaque publication
      posts: posts ? posts.slice(0, 5).map(normPost).filter(Boolean) : [],
      postsError: str(b.top_posts_error) || str(b.media_error) || (posts ? null : 'liste absente de la réponse')
    };
  }

  // La fenêtre réellement demandée à l'API doit couvrir la durée affichée (± 3 min : 30 j = 30 j − 60 s).
  var RANGE_DAYS = { '24h': 1, '7j': 7, '30j': 30 };
  function spanOk(b, range) {
    var s = num(b.since), u = num(b.until);
    return s != null && u != null && Math.abs((u - s) - RANGE_DAYS[range] * 86400) <= 180;
  }
  function loadInsights(range, opts) {
    if (IG_RANGES.indexOf(range) < 0) {
      return Promise.reject(new Error('Fenêtre refusée : « ' + range + ' » (seulement 24h, 7j ou 30j).'));
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
        var res = await callFn('ig-insights?range=' + range);
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
      emit('aud');
      return S;
    })();
    inflight.aud = p;
    emit('aud');
    return p;
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
    if (opts.igRange) tasks.push(loadInsights(opts.igRange, { force: !!opts.force }), loadAudience({ force: !!opts.force }));
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
