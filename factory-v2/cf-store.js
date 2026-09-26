/*
 * Creative Factory v2 · cf-store.js · étapes 0 à 3 du plan (préprod, lecture seule)
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
 *   CF.dm[r]   onglet Auto-DM (étape 2, Axel 25/09) : RPC ig_dm_stats_v2(p_range), r ∈ 24h | 7j | 30j | 90j | all
 *              → { state, loading, at, data, error, kind } ; notre base (pas Instagram) : relue au plus toutes les 2 min.
 *              Personnes uniques (commentaire → « Je suis abonné » → lien → clic → devenu user → payant), relance en
 *              lecture seule, leads = pseudo + état seulement (jamais d'identifiant Instagram) ; attribution
 *              (f.users, f.paid, attr.existing / existingPaid) = totaux seulement, null tant que la RPC ne les rend pas
 *   CF.prod    Accueil (étape 3) et onglet Production (étape 4, 25/09) : factory_bricks / factory_recipes / factory_qc lues en
 *              SELECT (RLS owner/dev, colonnes et clés de meta utiles seulement, listes blanches) + RPC factory_prod_stats()
 *              (variantes et missions : tables sans policy) → { state, loading, at, data, error, kind } ; relue au plus toutes
 *              les 2 min. data.stats a son propre état : une RPC absente ne casse pas le reste (« — » + raison).
 *   CF.prov    Accueil : niveau des soldes fournisseurs (provider-watch, vue utilisateur : ok / low, jamais le montant)
 *              → { state, loading, at, data: { list: [{ id, label, level, at, error, unconfirmed }] }, error } ; relu au plus
 *              toutes les 15 min. error = solde non lu / jamais lu / relevé périmé ; unconfirmed = « ok » sans readable
 *   CF.refresh(opts)  { gate } relance le contrôle d'accès ; sinon ne recharge que ce qui est périmé
 *                     { igRange } fenêtre Instagram à rafraîchir si périmée ; { dmRange } période Auto-DM ;
 *                     { home: { ig, dm } } tout ce que lit l'Accueil ; { prod } l'onglet Production ; { force } ignore les 15 min
 *   CF.net     journal des appels réseau faits par le store (pour vérifier « 3 appels max, puis 0 »)
 *
 * Contrôle d'accès : 1er appel = RPC factory_access(). {error:'forbidden'} ⇒ « Accès réservé ».
 * Ses chiffres ne sont PAS gardés (formule des variantes fausse, cf. plan §3.3) : c'est une simple porte.
 * Lecture seule : CF_READONLY = true, SAUF le module d'une publication (tagMedia → RPC ig_media_tag_set, owner/dev),
 * « Reconnecter » (igConnect) qui passe par le vrai OAuth Instagram et
 * réécrit ig_accounts en prod (voulu : renouveler le token du compte, plan étape 2), et la revue QC (étape 4) :
 * qcApprove / qcRefuse / qcClassify = UPDATE de factory_qc SEULEMENT, colonnes status, refusal_reason, reviewed_at et
 * classified_at SEULEMENT (qcGuard), une ligne à la fois ; chaque écriture vérifie l'erreur ET qu'une ligne a bien changé.
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
  var DM_RANGES = ['24h', '7j', '30j', '90j', 'all'];   // Auto-DM : nos propres horodatages, donc 24 h possible (Axel 25/09)
  var DM_TTL_MS = 2 * 60 * 1000;           // RPC légère sur notre base : on peut relire souvent
  var PROD_TTL_MS = 2 * 60 * 1000;         // factory_* : notre base aussi
  var PROD_MAX = 2000;                     // lignes lues par table (114 briques le 25/09) ; au-delà : « liste tronquée », jamais un faux total

  window.CF_READONLY = true;

  function newSlot() { return { state: 'idle', loading: false, at: 0, data: null, error: null, kind: null }; }
  function newDm() { var o = {}; DM_RANGES.forEach(function (r) { o[r] = newSlot(); }); return o; }
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
    dm: newDm(),
    prod: newSlot(),
    prov: newSlot(),
    oauth: null,
    net: [],
    IG_RANGES: IG_RANGES.slice(),
    DM_RANGES: DM_RANGES.slice(),
    TTL_MS: TTL_MS,
    DM_TTL_MS: DM_TTL_MS,
    PROD_TTL_MS: PROD_TTL_MS,
    PRIMARY_USERNAME: PRIMARY_USERNAME,
    refresh: refresh,
    loadAccounts: loadAccounts,
    loadInsights: loadInsights,
    loadAudience: loadAudience,
    loadMedia: loadMedia,
    loadDm: loadDm,
    loadProd: loadProd,
    loadProviders: loadProviders,
    prefetch: prefetch,
    tagMedia: tagMedia,
    qcApprove: function (id) { return qcWrite('approve', id); },
    qcRefuse: function (id, reason) { return qcWrite('refuse', id, reason); },
    qcClassify: function (id) { return qcWrite('classify', id); },
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
  function isFresh(slot, ttl) { return !!slot && slot.state !== 'idle' && Date.now() - slot.at < (ttl || TTL_MS); }
  function resetData() { epoch += 1; inflight = {}; retries = {}; mediaPolls = 0; if (typeof pre !== 'undefined') { pre.on = false; pre.queue = []; } CF.acct = newAcct(); CF.dm = newDm(); CF.prod = newSlot(); CF.prov = newSlot(); CF.oauth = null; }

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
      skipRate: num(p.skip_rate), totalWatchS: num(p.total_watch_s), durationS: num(p.duration_s), durationManual: p.duration_src === 'manual',
      trial: p.shared_to_feed === false,   // pas sur la grille du profil = réel d'essai (16 = 42 − 26 le 24/09)
      module: typeof p.module === 'string' && MODULES[p.module] ? p.module : null,
      analysis: normAnalysis(p.analysis)
    };
  }
  // Audio d'une brique : seulement depuis notre bucket public factory-media (lu par <audio>, CSP media-src).
  function brickAudio(u) {
    var pre = SUPABASE_URL + '/storage/v1/object/public/factory-media/';
    return typeof u === 'string' && u.indexOf(pre) === 0 && !/[\s"'<>]/.test(u) ? u : null;
  }
  // Briques reconnues par ig-insights (transcription du reel comparée au texte des briques).
  function normAnalysis(a) {
    if (!a || typeof a !== 'object' || ['done', 'pending', 'error'].indexOf(a.status) < 0) return null;
    return {
      status: a.status, error: str(a.error), noVoice: a.no_voice === true,
      module: typeof a.module === 'string' && MODULES[a.module] ? a.module : null,
      bricks: Array.isArray(a.bricks) ? a.bricks.map(function (b) {
        return b && typeof b.id === 'string' && ['hook', 'liaison', 'cta'].indexOf(b.kind) >= 0
          ? { kind: b.kind, id: b.id.slice(0, 40), label: str(b.label) || b.id, score: num(b.score),
              text: str(b.text), audio: brickAudio(b.audio), subject: str(b.subject), keyword: str(b.keyword) } : null;
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

  // ── Auto-DM (étape 2, Axel 25/09) : RPC ig_dm_stats_v2, owner/dev seulement, une case par période ──
  // Liste blanche de ce qui entre dans le store : compteurs entiers ≥ 0 (sinon null → « — »), pseudo Instagram
  // conforme (lettres, chiffres, point, tiret bas, 30 car.), jamais d'identifiant de personne.
  function cnt(x) { return typeof x === 'number' && isFinite(x) && x >= 0 ? Math.round(x) : null; }
  function ms(x) { var t = typeof x === 'string' ? Date.parse(x) : NaN; return isFinite(t) ? t : null; }
  function igName(x) { return typeof x === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(x) ? x : null; }
  function mediaId(x) { return typeof x === 'string' && /^[0-9]{5,30}$/.test(x) ? x : null; }
  var DM_REL = { done: 'done', planned: 'planned', missed: 'missed' };
  function normDm(b, range, at) {
    var f = b.funnel && typeof b.funnel === 'object' ? b.funnel : {}, r = b.relance && typeof b.relance === 'object' ? b.relance : {};
    var cr = b.relance_cron && typeof b.relance_cron === 'object' ? b.relance_cron : null;
    var at2 = b.attribution && typeof b.attribution === 'object' ? b.attribution : {};
    // users = « Devenus users » (compte AvatarAds créé après le clic, table ig_lead_links) : null tant que la RPC ne le
    // renvoie pas (migration 20260925171600 pas encore appliquée) → « — » + raison, jamais 0 inventé.
    function steps(o) { return { commented: cnt(o.commented), tapped: cnt(o.tapped), linked: cnt(o.linked), clicked: cnt(o.clicked), users: cnt(o.users) }; }
    var fs = steps(f);
    fs.paid = fs.users == null ? null : cnt(f.paid);
    return {
      range: range, fetchedAt: at, step: ['hour', 'day', 'week', 'month'].indexOf(b.step) >= 0 ? b.step : null,
      since: ms(b.since), until: ms(b.until), firstAt: ms(b.first_event_at), lastAt: ms(b.last_event_at),
      f: fs,
      // comptes AvatarAds DÉJÀ existants au clic (pas des users) et, parmi eux, passés payants après le clic : totaux seulement
      attr: { existing: fs.users == null ? null : cnt(at2.existing), existingPaid: fs.users == null ? null : cnt(at2.existing_paid) },
      rel: { unclicked: cnt(r.unclicked), done: cnt(r.done), doneUnclicked: cnt(r.done_unclicked), doneClicked: cnt(r.done_clicked),
        planned: cnt(r.planned), missed: cnt(r.missed) },
      cron: cr ? { active: cr.active === true, schedule: str(cr.schedule) ? cr.schedule.slice(0, 40) : null } : null,
      late: cnt(b.late) || 0, comments: cnt(b.comments),
      series: Array.isArray(b.series) ? b.series.map(function (p) {
        if (!p || typeof p !== 'object' || ms(p.t) == null) return null;
        var s = steps(p);
        return { t: ms(p.t), d: ymd(p.d), h: cnt(p.h), commented: s.commented, tapped: s.tapped, linked: s.linked, clicked: s.clicked,
          users: fs.users == null ? null : s.users };
      }).filter(Boolean) : [],
      posts: Array.isArray(b.by_media) ? b.by_media.map(function (p) {
        var id = p && mediaId(p.media_id);
        if (!id) return null;
        var s = steps(p); s.id = id;
        return s;
      }).filter(Boolean) : [],
      heat: Array.isArray(b.heat) ? b.heat.map(function (c) {
        return Array.isArray(c) && cnt(c[0]) >= 1 && cnt(c[0]) <= 7 && cnt(c[1]) != null && cnt(c[1]) <= 23 && cnt(c[2]) != null ? { dow: cnt(c[0]), h: cnt(c[1]), n: cnt(c[2]) } : null;
      }).filter(Boolean) : [],
      leadsTotal: cnt(b.leads_total),
      leads: Array.isArray(b.leads) ? b.leads.map(function (l) {
        if (!l || typeof l !== 'object' || ms(l.at) == null) return null;
        return { u: igName(l.username), at: ms(l.at), tapped: l.tapped === true, linked: l.linked === true, clicked: l.clicked === true,
          rel: typeof l.relance === 'string' && Object.prototype.hasOwnProperty.call(DM_REL, l.relance) ? DM_REL[l.relance] : null };
      }).filter(Boolean).slice(0, 200) : []
    };
  }
  function loadDm(range, opts) {
    if (DM_RANGES.indexOf(range) < 0) return Promise.reject(new Error('Période Auto-DM refusée : « ' + range + ' »'));
    var force = !!(opts && opts.force), key = 'dm:' + range, S = CF.dm[range];
    if (CF.status !== 'ready') return Promise.resolve(S);
    if (inflight[key]) return inflight[key];
    if (!force && isFresh(S, DM_TTL_MS)) return Promise.resolve(S);
    var ep = epoch;
    S.loading = true;
    var p = (async function () {
      await null;
      var patch;
      logNet('rpc ig_dm_stats_v2 ' + range);
      try {
        var res = await sb.rpc('ig_dm_stats_v2', { p_range: range });
        var err = res && res.error, d = res && res.data, code = err ? String(err.code || '') : '';
        if (err && (code === 'PGRST202' || res.status === 404)) {
          throw { kind: 'missing', message: 'la fonction ig_dm_stats_v2 n’est pas encore en base (migration 20260925124500 à appliquer)' };
        } else if (err && (code === '42501' || res.status === 403)) {
          throw { kind: 'forbidden', message: 'lecture refusée par la base (réservée owner / plan developer)' };
        } else if (err && (res.status === 401 || code === 'PGRST301' || code === 'PGRST303')) {
          throw { kind: 'auth', message: 'session expirée : reconnecte-toi' };
        } else if (err) {
          throw { kind: 'http', message: errText(err) };
        } else if (!d || typeof d !== 'object' || Array.isArray(d)) {
          throw { kind: 'http', message: 'réponse vide' };
        } else if (d.error) {
          throw d.error === 'forbidden' ? { kind: 'forbidden', message: 'réservé au propriétaire (owner / plan developer)' }
            : { kind: 'range', message: 'ig_dm_stats_v2 : ' + String(d.error).slice(0, 120) };
        } else if (d.range !== range) {
          // Garde-fou, comme ig-insights : jamais des chiffres d'une autre période sous « 7 j ».
          throw { kind: 'range', message: 'ig_dm_stats_v2 a répondu pour « ' + String(d.range).slice(0, 12) + ' » au lieu de « ' + range + ' »' };
        } else {
          patch = { state: 'ready', kind: null, error: null, data: normDm(d, range, Date.now()) };
        }
      } catch (e) {
        patch = { state: 'error', kind: e.kind || 'error', error: errText(e) };
        if (e.kind && e.kind !== 'http' && e.kind !== 'error') patch.data = null;   // réseau ou 500 : on garde les chiffres précédents, datés
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

  // ── Production (Accueil étape 3, onglet Production étape 4) : factory_bricks, factory_recipes, factory_qc en SELECT
  //    (RLS owner/dev) + RPC factory_prod_stats() (variantes, missions). Clés de meta choisies une par une (jamais tout
  //    meta : transcript, fichiers locaux…), puis passées en liste blanche. Statuts en liste blanche (migrations
  //    20260918150000 et factory_qc_status_check) ; un statut inconnu est compté à part, jamais rangé dans « prêt ».
  var BRICK_KINDS = ['hook', 'liaison', 'cta', 'contenu', 'transformation', 'avatar', 'musique', 'sous-titre'];
  var BRICK_SEL = ['id', 'kind', 'subject', 'label', 'status', 'created_at', 'updated_at',
    'm_subjects:meta->compatible_subjects', 'm_modules:meta->modules', 'm_alias:meta->>alias_of', 'm_module:meta->>module',
    'm_variant:meta->>variant', 'm_media:meta->>media', 'm_media_type:meta->>media_type', 'm_keyword:meta->>keyword',
    'm_script:meta->>script', 'm_transcript:meta->>transcript', 'm_value:meta->>value', 'm_group:meta->>group',
    'm_duration:meta->duration_s', 'm_cover:meta->>cover', 'm_before:meta->before', 'm_after:meta->after'].join(',');
  var QC_SEL = ['id', 'status', 'template', 'route', 'video_url', 'poster_url', 'brick_combo', 'refusal_reason', 'created_at', 'reviewed_at',
    't_route:technical->>route', 't_pass:technical->pass', 't_hard:technical->hard_fails', 't_soft:technical->soft_fails',
    't_err:technical->>error', 't_coh:technical->coherence', 'v_route:vision->>route', 'v_verdict:vision->verdict'].join(',');
  function rowId(x) { return typeof x === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(x) ? x : null; }
  function qcId(x) { return typeof x === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(x) ? x : null; }
  function txt(x, n) { return typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : null; }
  function sArr(x, n, len) {
    return Array.isArray(x) ? x.filter(function (v) { return typeof v === 'string' && v.trim(); }).map(function (v) { return v.trim().slice(0, len || 40); }).slice(0, n || 40) : [];
  }
  // Fichier de NOTRE stockage public (seul hôte permis par la CSP media-src) : bucket/…/nom.ext, jamais le seul préfixe
  // d'un dossier ni un chemin local. Sinon null, et fileWhy dit pourquoi (affiché « fichier manquant · … »).
  var SB_PUB = SUPABASE_URL + '/storage/v1/object/public/';
  var AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg)$/i, VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i, IMG_EXT = /\.(png|jpe?g|webp)$/i;
  function pubFile(u, extRe) {
    if (typeof u !== 'string' || u.indexOf(SB_PUB) !== 0 || /[\s"'<>\\]/.test(u)) return null;
    var p = u.slice(SB_PUB.length).split(/[?#]/)[0];
    if (!/^[a-z0-9_-]+\/(?:[^/]+\/)*[^/]+\.[a-z0-9]{2,5}$/i.test(p)) return null;
    return extRe && !extRe.test(p) ? null : u;
  }
  function fileWhy(u, extRe) {
    if (typeof u !== 'string' || !u.trim()) return 'aucun fichier';
    if (u.indexOf(SB_PUB) !== 0) return /^https?:/i.test(u) ? 'fichier hors du stockage factory-media' : 'fichier local, pas en ligne';
    if (pubFile(u)) return extRe && !pubFile(u, extRe) ? 'format de fichier inattendu' : null;
    return 'lien vers un dossier, pas vers un fichier';
  }
  // avant / après d'une transformation : libellé + vidéo de NOTRE stockage (meta.before.media / meta.after.media)
  function side(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    var raw = txt(o.media, 400);
    return { label: txt(o.label, 80), file: txt(o.file, 200), video: pubFile(raw, VIDEO_EXT), why: raw ? fileWhy(raw, VIDEO_EXT) : 'pas encore en ligne' };
  }
  function normBrick(b) {
    var id = rowId(b && b.id);
    if (!id) return null;
    var media = txt(b.m_media, 400), cover = txt(b.m_cover, 400);
    return {
      id: id, kind: BRICK_KINDS.indexOf(b.kind) >= 0 ? b.kind : 'autre', subject: txt(b.subject, 40), label: txt(b.label, 200),
      status: txt(b.status, 20), created: ms(b.created_at), updated: ms(b.updated_at),
      // même forme que factory_bricks.meta pour usine/coherence.js (compatible_subjects, alias_of, modules, module)
      meta: { compatible_subjects: sArr(b.m_subjects), modules: sArr(b.m_modules), alias_of: rowId(b.m_alias), module: txt(b.m_module, 40),
        variant: txt(b.m_variant, 40), keyword: txt(b.m_keyword, 40), script: txt(b.m_script, 600), transcript: txt(b.m_transcript, 600),
        value: txt(b.m_value, 60), group: txt(b.m_group, 20), duration: num(b.m_duration), mediaType: txt(b.m_media_type, 20),
        before: side(b.m_before), after: side(b.m_after) },
      audio: pubFile(media, AUDIO_EXT), video: pubFile(media, VIDEO_EXT), image: pubFile(cover || media, IMG_EXT),
      hasMedia: !!(media || cover), mediaWhy: fileWhy(cover || media)
    };
  }
  var REC_ST = { done: 'done', in_progress: 'in_progress', pending: 'pending' };
  function normRecipe(r) {
    var id = rowId(r && r.id);
    if (!id) return null;
    var raw = txt(r.render_url, 400);
    return {
      id: id, kind: txt(r.kind, 20), subject: txt(r.subject, 40), status: REC_ST[r.status] || 'other',
      comps: Array.isArray(r.components) ? r.components.map(function (c) {
        return c && typeof c === 'object' && rowId(c.brick_id) ? { slot: txt(c.slot, 4) || '', id: rowId(c.brick_id) } : null;
      }).filter(Boolean).slice(0, 12) : [],
      render: pubFile(raw, VIDEO_EXT), renderWhy: raw ? fileWhy(raw, VIDEO_EXT) : 'aucun lien de rendu',
      created: ms(r.created_at), updated: ms(r.updated_at)
    };
  }
  // Recette d'une vidéo finale : nouveau format (usine/publish-qc.mjs) = IDs de briques sous des clés connues ; tout le
  // reste (ex. l'ancien refus « Test » : { cta: 'avatar + CTA28', demo: 'visite guidée OMNI 1', … }) = texte libre, affiché
  // tel quel et jamais compté comme une vidéo produite.
  // voice = mode de voix de la vidéo finale ('axel' par défaut, 'omni' : usine/publish-qc.mjs, usine/coherence.js comboKey)
  var COMBO_KEYS = ['voice', 'avatar', 'hook', 'liaison', 'contenu', 'cta', 'musique', 'sous_titre'];
  // format de hook testé (F01…) et phrase choc (TH01…) : usine/formats.js, écrits par publish-qc.mjs (26/09) ; gardés À PART
  // (q.format, q.texteChoc) : ce ne sont pas des briques de la vidéo, jamais dans sa clé voix|avatar|hook|liaison.
  var COMBO_FMT = { format: /^F[0-9]{2}$/, texte_choc: /^TH[0-9]{2}$/ };
  function normCombo(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ids: null, legacy: null, fmt: null };
    var keys = Object.keys(c), ids = {}, fmt = {}, ok = keys.length > 0;
    keys.forEach(function (k) {
      if (c[k] == null || c[k] === '') return;
      if (Object.prototype.hasOwnProperty.call(COMBO_FMT, k)) { if (typeof c[k] === 'string' && COMBO_FMT[k].test(c[k])) fmt[k] = c[k]; else ok = false; return; }
      if (COMBO_KEYS.indexOf(k) < 0 || !rowId(c[k])) ok = false; else ids[k] = c[k];
    });
    if (ok && Object.keys(ids).length) return { ids: ids, legacy: null, fmt: fmt };
    return { ids: null, legacy: keys.slice(0, 10).map(function (k) {
      var v = c[k]; return [String(k).slice(0, 30), typeof v === 'string' ? v.slice(0, 120) : v == null ? '' : JSON.stringify(v).slice(0, 120)];
    }), fmt: null };
  }
  function normCoh(o) {
    if (!o || typeof o !== 'object') return null;
    var lv = o.level === 'ok' || o.level === 'review' ? o.level : null;
    return lv ? { level: lv, reasons: sArr(o.reasons, 12, 300) } : null;
  }
  function normVerdict(v) {
    if (!v || typeof v !== 'object') return null;
    var b = function (x) { return typeof x === 'boolean' ? x : null; }, c = num(v.confidence);
    return { glitch: b(v.glitch), qualityOk: b(v.quality_ok), matches: b(v.matches_words), confidence: c != null && c >= 0 && c <= 1 ? c : null, notes: txt(v.notes, 300) };
  }
  var QC_ST = { pending: 'pending', approved: 'approved', refused: 'refused' };
  function normQc(q) {
    var id = qcId(q && q.id);
    if (!id) return null;
    var cb = normCombo(q.brick_combo), rawV = txt(q.video_url, 400);
    var r = function (x) { return x === 'auto' || x === 'manual' ? x : null; };
    return {
      id: id, status: QC_ST[q.status] || 'other', template: txt(q.template, 40), route: r(q.route),
      video: pubFile(rawV, VIDEO_EXT), videoWhy: rawV ? fileWhy(rawV, VIDEO_EXT) : 'aucune vidéo', poster: pubFile(txt(q.poster_url, 400), IMG_EXT),
      combo: cb.ids, legacy: cb.legacy, format: cb.fmt && cb.fmt.format || null, texteChoc: cb.fmt && cb.fmt.texte_choc || null,
      tech: { route: r(q.t_route), pass: typeof q.t_pass === 'boolean' ? q.t_pass : null, hard: sArr(q.t_hard, 20, 80), soft: sArr(q.t_soft, 20, 80), error: txt(q.t_err, 200) },
      coh: normCoh(q.t_coh),
      vis: q.v_route || q.v_verdict ? { route: q.v_route === 'ok' || q.v_route === 'doubt' ? q.v_route : null, verdict: normVerdict(q.v_verdict) } : null,
      reason: txt(q.refusal_reason, 500), created: ms(q.created_at), reviewed: ms(q.reviewed_at), classified: ms(q.classified_at)
    };
  }
  function restFail(res, what) {
    var err = res && res.error, code = err ? String(err.code || '') : '';
    if (!err) return null;
    if (code === '42P01' || code === 'PGRST205' || res.status === 404) return { kind: 'missing', message: 'table ' + what + ' introuvable' };
    if (code === '42501' || res.status === 403) return { kind: 'forbidden', message: 'lecture de ' + what + ' refusée par la base' };
    if (res.status === 401 || code === 'PGRST301' || code === 'PGRST303') return { kind: 'auth', message: 'session expirée : reconnecte-toi' };
    return { kind: 'http', message: what + ' : ' + errText(err) };
  }
  function restRows(res, what) {
    var f = restFail(res, what);
    if (f) throw f;
    if (!res || !Array.isArray(res.data)) throw { kind: 'http', message: what + ' : réponse vide' };
    if (typeof res.count === 'number' && res.count > res.data.length) throw { kind: 'http', message: what + ' : liste tronquée (' + res.data.length + ' / ' + res.count + ')' };
    return res.data;
  }
  // factory_prod_stats() : son propre état (la migration 20260925210000 peut ne pas être appliquée) ; jamais un faux 0.
  function normStats(res) {
    var err = res && res.error, d = res && res.data, code = err ? String(err.code || '') : '';
    var fail = function (kind, message) { return { state: 'error', kind: kind, error: message, rows: null, pairsTotal: null, pairs: [], missions: null }; };
    if (err && (code === 'PGRST202' || res.status === 404)) return fail('missing', 'la fonction factory_prod_stats n’est pas encore en base (migration 20260925210000 à appliquer)');
    if (err && (code === '42501' || res.status === 403)) return fail('forbidden', 'lecture refusée par la base (réservée owner / plan developer)');
    if (err) return fail('http', 'factory_prod_stats : ' + errText(err));
    if (!d || typeof d !== 'object' || Array.isArray(d)) return fail('http', 'factory_prod_stats : réponse vide');
    if (d.error) return d.error === 'forbidden' ? fail('forbidden', 'réservé au propriétaire (owner / plan developer)') : fail('http', 'factory_prod_stats : ' + String(d.error).slice(0, 120));
    var v = d.variants && typeof d.variants === 'object' ? d.variants : {}, m = d.missions && typeof d.missions === 'object' ? d.missions : null;
    var pairs = Array.isArray(v.pairs) ? v.pairs.map(function (p) { return Array.isArray(p) && rowId(p[0]) && rowId(p[1]) ? [p[0], p[1]] : null; }).filter(Boolean) : [];
    var byStatus = {};
    if (m && m.by_status && typeof m.by_status === 'object') Object.keys(m.by_status).slice(0, 20).forEach(function (k) { var n = cnt(m.by_status[k]); if (n != null) byStatus[k.slice(0, 30)] = n; });
    if (cnt(v.rows) == null || cnt(v.pairs_total) == null) return fail('http', 'factory_prod_stats : variantes illisibles');
    return { state: 'ready', kind: null, error: null, rows: cnt(v.rows), pairsTotal: cnt(v.pairs_total), pairs: pairs,
      missions: m && cnt(m.total) != null ? { total: cnt(m.total), byStatus: byStatus } : null };
  }
  function normProd(rb, rr, rq, stats, at, classifyMissing) {
    var B = { total: rb.length, ready: 0, flagged: 0, retired: 0, other: 0, byKind: {}, lastAt: null, lastKind: null, list: rb.map(normBrick).filter(Boolean) };
    rb.forEach(function (b) {
      var k = b && BRICK_KINDS.indexOf(b.kind) >= 0 ? b.kind : 'autre', st = b && b.status, t = ms(b && b.created_at);
      if (st === 'ready') { B.ready += 1; B.byKind[k] = (B.byKind[k] || 0) + 1; }
      else if (st === 'flagged') B.flagged += 1;
      else if (st === 'retired') B.retired += 1;
      else B.other += 1;
      if (t != null && (B.lastAt == null || t > B.lastAt)) { B.lastAt = t; B.lastKind = k; }
    });
    var R = { total: rr.length, done: 0, inProgress: 0, pending: 0, other: 0, lastAt: null, lastId: null, list: rr.map(normRecipe).filter(Boolean) };
    rr.forEach(function (r) {
      var st = r && r.status, t = ms(r && (r.updated_at || r.created_at));
      if (st === 'done') {
        R.done += 1;
        if (t != null && (R.lastAt == null || t > R.lastAt)) { R.lastAt = t; R.lastId = rowId(r.id); }
      } else if (st === 'in_progress') R.inProgress += 1;
      else if (st === 'pending') R.pending += 1;
      else R.other += 1;
    });
    var Q = { total: rq.length, pending: 0, approved: 0, refused: 0, unclassified: 0, other: 0, lastRefused: null, classifyMissing: !!classifyMissing, list: rq.map(normQc).filter(Boolean) };
    rq.forEach(function (q) {
      var st = q && q.status;
      if (st === 'pending') Q.pending += 1;
      else if (st === 'approved') Q.approved += 1;
      else if (st === 'refused') {
        Q.refused += 1;
        if (ms(q.classified_at) != null) return;   // classé : plus « à classer », plus dans l'alerte de l'Accueil (maquette §13)
        Q.unclassified += 1;
        var t = ms(q.reviewed_at) || ms(q.created_at);
        if (!Q.lastRefused || (t != null && t > (Q.lastRefused.at || 0))) {
          Q.lastRefused = { at: t, reason: typeof q.refusal_reason === 'string' && q.refusal_reason.trim() ? q.refusal_reason.trim().slice(0, 160) : null,
            template: typeof q.template === 'string' && /^[a-z0-9-]{1,40}$/.test(q.template) ? q.template : null };
        }
      } else Q.other += 1;
    });
    return { fetchedAt: at, bricks: B, recipes: R, qc: Q, stats: stats };
  }
  function qcQuery(withClassified) {
    return sb.from('factory_qc').select(QC_SEL + (withClassified ? ',classified_at' : ''), { count: 'exact' }).order('created_at', { ascending: false }).limit(PROD_MAX);
  }
  function noClassifiedCol(res) {
    var e = res && res.error;
    return !!e && /classified_at/.test(String(e.message || '') + ' ' + String(e.details || '')) && (String(e.code || '') === '42703' || res.status === 400);
  }
  function loadProd(opts) {
    var force = !!(opts && opts.force), S = CF.prod;
    if (CF.status !== 'ready') return Promise.resolve(S);
    // Relecture forcée (après une écriture QC) pendant une lecture déjà en vol : on attend celle-ci puis on relit.
    if (inflight.prod) return force ? inflight.prod.then(function () { return loadProd({ force: true }); }) : inflight.prod;
    if (!force && isFresh(S, PROD_TTL_MS)) return Promise.resolve(S);
    var ep = epoch;
    S.loading = true;
    var p = (async function () {
      await null;
      var patch;
      logNet('rest factory_bricks, factory_recipes, factory_qc + rpc factory_prod_stats');
      try {
        var r = await Promise.all([
          sb.from('factory_bricks').select(BRICK_SEL, { count: 'exact' }).order('id', { ascending: true }).limit(PROD_MAX),
          sb.from('factory_recipes').select('id,kind,subject,components,status,render_url,created_at,updated_at', { count: 'exact' }).limit(PROD_MAX),
          qcQuery(true),
          Promise.resolve().then(function () { return sb.rpc('factory_prod_stats'); }).catch(function (e) { return { error: { message: errText(e) } }; })
        ]);
        var rq = r[2], missing = false;
        if (noClassifiedCol(rq)) {   // migration 20260925210000 pas encore appliquée : tout est lu, « Classer » attend la colonne
          missing = true;
          logNet('rest factory_qc (sans classified_at)');
          rq = await qcQuery(false);
        }
        patch = { state: 'ready', kind: null, error: null,
          data: normProd(restRows(r[0], 'factory_bricks'), restRows(r[1], 'factory_recipes'), restRows(rq, 'factory_qc'), normStats(r[3]), Date.now(), missing) };
      } catch (e) {
        patch = { state: 'error', kind: e.kind || 'error', error: errText(e) };
        if (e.kind && e.kind !== 'http' && e.kind !== 'error') patch.data = null;   // réseau ou 500 : chiffres précédents gardés, datés
      }
      if (ep !== epoch) return S;
      Object.assign(S, patch, { loading: false, at: Date.now() });
      if (inflight.prod === p) delete inflight.prod;
      emit('prod');
      return S;
    })();
    inflight.prod = p;
    emit('prod');
    return p;
  }

  // ── revue QC (étape 4) : SEULE exception d'écriture de l'onglet Production, aussi étroite que possible ──
  // Table factory_qc seulement, une ligne (id), colonnes de QC_COLS seulement. La ligne doit encore être dans l'état
  // attendu (à valider pour Valider / Refuser, refusée non classée pour Classer) : sinon 0 ligne modifiée → erreur, jamais
  // un faux succès (la RLS filtre sans erreur, d'où le .select() qui compte les lignes réellement écrites).
  var QC_COLS = { status: 1, refusal_reason: 1, reviewed_at: 1, classified_at: 1 };
  function qcGuard(patch) {
    Object.keys(patch).forEach(function (k) { if (!QC_COLS[k]) throw new Error('écriture refusée : colonne « ' + k + ' » hors revue QC'); });
  }
  async function qcWrite(act, id, reason) {
    if (!sb || CF.status !== 'ready') return { error: 'tableau de bord pas prêt' };
    if (!qcId(id)) return { error: 'identifiant de vidéo invalide' };
    var now = new Date().toISOString(), patch;
    if (act === 'approve') patch = { status: 'approved', reviewed_at: now };
    else if (act === 'refuse') {
      var why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
      if (!why) return { error: 'motif obligatoire pour refuser' };
      patch = { status: 'refused', refusal_reason: why, reviewed_at: now };
    } else if (act === 'classify') {
      if (CF.prod.data && CF.prod.data.qc.classifyMissing) return { error: 'colonne classified_at absente : migration 20260925210000 à appliquer' };
      patch = { classified_at: now };
    } else return { error: 'action refusée' };
    try { qcGuard(patch); } catch (e) { return { error: e.message }; }
    logNet('update factory_qc ' + act);
    var res;
    try {
      var q = sb.from('factory_qc').update(patch).eq('id', id);
      q = act === 'classify' ? q.eq('status', 'refused').is('classified_at', null) : q.eq('status', 'pending');
      res = await q.select('id');
    } catch (e) { return { error: errText(e) }; }
    var f = res && res.error ? restFail(res, 'factory_qc') : null;
    if (f) return { error: f.kind === 'forbidden' ? 'écriture refusée par la base' : f.message };
    if (!res || !Array.isArray(res.data) || res.data.length !== 1) {
      return { error: 'rien n’a été enregistré : vidéo déjà revue ailleurs, ou écriture refusée par la base' };
    }
    await loadProd({ force: true });   // la file relue ; son éventuel échec s'affiche dans l'onglet, l'écriture, elle, est faite
    return { ok: true };
  }

  // ── soldes fournisseurs (Accueil) : provider-watch, vue utilisateur { provider, ok, level, at } ──
  // Même appel que l'app avant de débiter un membre (#hedra-gate). Hedra d'abord : si l'état mémorisé a plus de 20 min,
  // provider-watch relit alors TOUS les soldes une seule fois ; fal, ElevenLabs et kie lisent ensuite l'état frais.
  // kie.ai ajouté le 25/09 : Omni Flash passe par kie SANS repli — un solde à zéro fait échouer toutes les vidéos Omni.
  var PROVIDERS = [{ id: 'hedra', label: 'Hedra' }, { id: 'fal', label: 'fal.ai' }, { id: 'elevenlabs', label: 'ElevenLabs' }, { id: 'kie', label: 'kie.ai' }];
  var PROV_LEVEL = { ok: 'ok', low: 'low', crit: 'crit' };
  // provider-watch range un solde qu'il n'a PAS pu lire (clé refusée, fournisseur en 500) en level 'ok' : « ok » seul
  // ne prouve rien. On exige donc un relevé daté, récent, et readable === true (champ ajouté le 25/09). Sans ce champ
  // (version en ligne pas encore redéployée), un « ok » reste NON CONFIRMÉ : jamais compté comme solde vérifié.
  // 'low' / 'crit' n'existent que si le solde a été lu : ils sont toujours confirmés.
  var PROV_STALE_MS = 13 * 3600e3;   // relevé à la demande si > 20 min, et cron toutes les 12 h : au-delà de 13 h, les deux ont échoué
  async function oneProvider(pv) {
    var out = { id: pv.id, label: pv.label, level: null, at: null, error: null, unconfirmed: false };
    try {
      var res = await callFn('provider-watch?provider=' + pv.id);
      var b = res.body || {}, at = ms(b.at);
      if (!res.ok || b.error) out.error = b.error ? String(b.error).slice(0, 120) : 'HTTP ' + res.status;
      else if (b.provider !== pv.id) out.error = 'réponse pour un autre fournisseur';
      else if (!PROV_LEVEL[b.level]) out.error = 'niveau illisible';
      else if (at == null) out.error = 'aucun relevé enregistré : solde jamais lu';
      else if (b.readable === false) out.error = 'solde non lu au dernier relevé (clé refusée ou fournisseur indisponible)';
      else if (Date.now() - at > PROV_STALE_MS) { out.error = 'dernier relevé périmé (plus de 13 h)'; out.at = at; }
      else {
        out.level = PROV_LEVEL[b.level];
        out.at = at;
        out.unconfirmed = b.readable !== true && out.level === 'ok';
      }
    } catch (e) { out.error = errText(e); }
    return out;
  }
  function loadProviders(opts) {
    var force = !!(opts && opts.force), S = CF.prov;
    if (CF.status !== 'ready') return Promise.resolve(S);
    if (inflight.prov) return inflight.prov;
    if (!force && isFresh(S)) return Promise.resolve(S);
    var ep = epoch;
    S.loading = true;
    var p = (async function () {
      await null;
      var first = await oneProvider(PROVIDERS[0]);
      var rest = await Promise.all(PROVIDERS.slice(1).map(oneProvider));
      var list = [first].concat(rest), patch;
      if (list.every(function (x) { return x.error; })) patch = { state: 'error', kind: 'http', error: 'provider-watch : ' + first.error };
      else patch = { state: 'ready', kind: null, error: null, data: { fetchedAt: Date.now(), list: list } };
      if (ep !== epoch) return S;
      Object.assign(S, patch, { loading: false, at: Date.now() });
      if (inflight.prov === p) delete inflight.prov;
      emit('prov');
      return S;
    })();
    inflight.prov = p;
    emit('prov');
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
    for (var k in inflight) { if (inflight[k] && k !== 'accounts' && k !== 'prod' && k !== 'prov' && k.indexOf('dm:') !== 0) return; }   // une seule requête Instagram à la fois (Auto-DM, Production et soldes ne sont pas Instagram)
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
    if (opts.dmRange) tasks.push(loadDm(opts.dmRange, { force: !!opts.force }), loadMedia({ force: !!opts.force }));
    if (opts.home) tasks.push(loadInsights(opts.home.ig, { force: !!opts.force }), loadMedia({ force: !!opts.force }), loadDm(opts.home.dm, { force: !!opts.force }),
      loadProd({ force: !!opts.force }), loadProviders({ force: !!opts.force }));
    // onglet Production : notre base + le rythme de publication (reels par jour sur 30 j, mêmes cases que l'Accueil)
    if (opts.prod) tasks.push(loadProd({ force: !!opts.force }), loadInsights('30j', { force: !!opts.force }), loadMedia({ force: !!opts.force }));
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
