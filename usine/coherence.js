/* Creative Factory — RÈGLE DE COHÉRENCE et CAPACITÉ des vidéos finales (source UNIQUE : dashboard factory-v2 ET usine/publish-qc.mjs).
 *
 * VIDÉO FINALE DISTINCTE (décision d'Axel, 25/09 au soir) :
 *   · format court = avatar × hook ;
 *   · format long  = avatar × hook × liaison COMPATIBLE avec ce hook (matrice validée par Axel : usine/hook-liaison.js,
 *     générée par usine/gen-coherence-matrix.mjs ; un hook absent de la matrice n'a droit qu'aux liaisons génériques) ;
 *   · le tout dans 2 MODES DE VOIX comptés séparément :
 *       'axel' = « Audio d'Axel » : son audio enregistré, en lipsync → la brique parlée doit avoir un fichier audio
 *                (meta.media en .wav/.mp3/… ; côté dashboard : b.audio) ;
 *       'omni' = « Voix native Omni » : Omni Flash image→vidéo génère la voix depuis le TEXTE → hook = meta.script sinon
 *                label ; liaison = label.
 *   La DÉMO et le CTA sont tirés AU HASARD : ils ne font JAMAIS une nouvelle vidéo (même avatar + même hook (+ même liaison)
 *   avec seulement une autre démo ou un autre CTA = la même vidéo). Clé d'une vidéo = voix|avatar|hook|liaison (liaison
 *   vide pour le court), cf. videoKey / comboKey ; usine/publish-qc.mjs écrit la voix dans brick_combo.voice.
 *   Exception (règle de production, declineTop) : une publication qui revient dans le Top publications peut être DÉCLINÉE,
 *   même hook (+ même liaison) avec une autre démo ET un autre CTA.
 *
 * CHOIX DE LA DÉMO (pickDemo) : on préfère une démo dont le sujet est dans hook.meta.compatible_subjects (valeurs LITTÉRALES
 * du catalogue) ou n'importe laquelle si le hook est générique ('generique' dans ses sujets) ; sinon n'importe quelle démo,
 * et la vidéo part en REVUE QC (Axel accepte ou refuse à la main). Contrôles QC inchangés : pairLevel, liaisonOk, comboCheck.
 *
 * HOOKS AVANT / APRÈS (Axel, 26/09) : un hook meta.lipsync === false ou meta.hook_mode === 'avant-apres' (H19, H53, H57,
 * H63, H64, H74) n'est JAMAIS en lipsync : il sort des 2 modes ci-dessus et forme un 3e mode 'aa' « Avant / après » = voix
 * off d'Axel sur un ASSEMBLAGE visuel (factory_recipes HK-…). Assemblage = suite de 2 ou 3 clips DISTINCTS d'un même GROUPE
 * de transformations (meta.group = un même original filmé) : l'original (meta.before) et chaque version (meta.after) ;
 * 2 clips dans tous les sens, 3 clips seulement en partant de l'original ; jamais deux groupes mélangés (assemblies,
 * assemblyCheck). Court 'aa' = assemblage × hook avant/après du module du groupe (pas d'avatar) ; long = court × liaison
 * compatible × avatar (la liaison est dite par un avatar). Clé : aa|avatar|hook|liaison|assemblage (avatar vide en court).
 * Hooks meta.overlay_required (H14, H23, H60) : lipsync seulement avec une incrustation ; comptés, signalés (overlay).
 *
 * Bibliothèque = briques au statut 'ready' seulement (une brique 'retired' ou 'flagged' n'entre dans aucun compte) ;
 * hooks comptés sans meta.alias_of (H64 = alias de H63).
 * Chargé tel quel par le navigateur (window.CF_COHERENCE) et par node (import / require). Aucune dépendance.
 */
(function (root, factory) {
  // node : dans un dépôt en "type": "module" ce fichier est un module ES ; on expose donc TOUJOURS l'objet global
  // (import('./coherence.js') puis globalThis.CF_COHERENCE), et module.exports quand il est chargé en CommonJS.
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.CF_COHERENCE = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var VOICES = ['axel', 'omni'];                                // modes lipsync (inchangés)
  var VOICE_LABEL = { axel: 'Audio d’Axel', omni: 'Voix native Omni' };
  var MODES = ['axel', 'omni', 'aa'];                           // + 'aa' = Avant / après (voix off sur un assemblage)
  var MODE_LABEL = { axel: 'Audio d’Axel', omni: 'Voix native Omni', aa: 'Avant / après' };
  var AUDIO_RE = /\.(wav|mp3|m4a|aac|ogg)(?:[?#].*)?$/i;
  // Clés admises dans une recette (factory_qc.brick_combo, écrite par usine/publish-qc.mjs) : IDs de briques, sauf voice ;
  // assemblage = ID d'une recette HK (vidéo avant / après). Toute autre clé rend la recette illisible pour le dashboard
  // (affichée « texte libre », jamais comptée) → refusée.
  var COMBO_KEYS = ['voice', 'avatar', 'hook', 'liaison', 'contenu', 'cta', 'musique', 'sous_titre', 'assemblage'];
  var STATUS_FR = { ready: 'prête', retired: 'retirée', flagged: 'signalée', draft: 'brouillon' };
  // Clés venues de la base (brick_combo) : jamais lues sur le prototype d'un objet (« __proto__ », « constructor »…).
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function dict() { return Object.create(null); }
  function statusFr(st) { return has(STATUS_FR, st) ? STATUS_FR[st] : 'statut inconnu'; }

  function meta(b) { return (b && b.meta && typeof b.meta === 'object') ? b.meta : {}; }
  function ready(b) { return !!b && (b.status == null || b.status === 'ready'); }
  function hookSubjects(h) { var s = meta(h).compatible_subjects; return Array.isArray(s) ? s.map(String) : []; }
  function isGenericHook(h) { return hookSubjects(h).indexOf('generique') >= 0; }
  function isGenericLiaison(l) { return !!l && l.subject === 'generique'; }
  // Module d'une démo : meta.module (static ads = module Image IA) sinon son sujet.
  function demoModule(d) { return String(meta(d).module || (d && d.subject) || ''); }
  function str(x) { return typeof x === 'string' && x.trim() ? x.trim() : ''; }

  // ── modes de voix ──
  // Audio enregistré : b.audio (brique normalisée du dashboard) ou meta.media vers un fichier audio (ligne factory_bricks).
  function hasAudio(b) {
    if (!b) return false;
    if (str(b.audio)) return true;
    var m = str(meta(b).media);
    return !!m && AUDIO_RE.test(m);
  }
  // Texte que dit Omni : hook = meta.script sinon label ; liaison (et le reste) = label.
  function voiceText(b) {
    if (!b) return '';
    return (b.kind === 'hook' ? str(meta(b).script) : '') || str(b.label);
  }
  function voiceOk(b, voice) { return voice === 'omni' ? !!voiceText(b) : voice === 'axel' ? hasAudio(b) : false; }
  // Hook avant / après (Motion Control / Omni) : jamais en lipsync, dit en voix off sur son assemblage visuel.
  function isAvantApres(h) { var m = meta(h); return m.lipsync === false || m.hook_mode === 'avant-apres'; }
  // Hook lipsync seulement avec une image incrustée (meta.overlay_required, ex. 'fille') ; '' sinon.
  function overlayRequired(h) { return str(meta(h).overlay_required); }
  // Un hook (avant / après) peut habiller un assemblage de ce module (motion-control / omni) : sujet, sujet cité ou générique.
  function hookFitsModule(h, module) {
    return !!h && !!module && (String(h.subject || '') === module || hookSubjects(h).indexOf(module) >= 0 || isGenericHook(h));
  }

  // ── assemblages avant / après (factory_recipes kind 'hook', id HK-…) ──
  // Groupes de transformations : un groupe = un même original filmé (meta.group, sinon la brique seule). Clips du groupe :
  // '0' = l'original (meta.before, commun à toutes les versions) et une lettre par version (meta.after), a, b, c… dans
  // l'ordre des IDs TX (O2 : TX-O02a → a = Porsche, TX-O02b → b = Bugatti). Seules les transformations 'ready' comptent.
  var LETTERS = 'abcdefghijklmnopqrstuvwxyz';
  function scene(label) { var m = /\(([^()]+)\)\s*$/.exec(String(label || '')); return m ? m[1].trim() : ''; }
  function txGroups(bricks) {
    var by = dict(), order = [];
    (bricks || []).forEach(function (b) {
      if (!b || b.kind !== 'transformation' || !ready(b)) return;
      var g = str(meta(b).group) || String(b.id);
      if (!has(by, g)) { by[g] = []; order.push(g); }
      by[g].push(b);
    });
    return order.sort().map(function (g) {
      var tx = by[g].slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }), first = tx[0], bf = meta(first).before || {};
      var versions = tx.slice(0, LETTERS.length).map(function (t, i) {
        var af = meta(t).after || {};
        return { key: LETTERS[i], brick_id: t.id, clip: 'after', label: str(af.label) || t.id, media: str(af.media), file: str(af.file) };
      });
      return { group: g, module: String(first.subject || ''), scene: scene(first.label), tx: tx.map(function (t) { return t.id; }),
        original: { key: '0', brick_id: first.id, clip: 'before', label: str(bf.label) || 'original', media: str(bf.media), file: str(bf.file) },
        versions: versions };
    });
  }
  // Suites valides d'un groupe : 2 clips distincts dans tous les sens ; 3 clips distincts en partant de l'original
  // (groupe à ≥ 2 versions). k versions → (k+1)·k + k·(k−1) assemblages (1 version : 2 ; 2 versions : 8).
  function groupSequences(G) {
    var keys = ['0'].concat(G.versions.map(function (v) { return v.key; })), out = [];
    keys.forEach(function (x) { keys.forEach(function (y) { if (x !== y) out.push([x, y]); }); });
    G.versions.forEach(function (x) { G.versions.forEach(function (y) { if (x !== y) out.push(['0', x.key, y.key]); }); });
    return out;
  }
  function makeAssembly(G, seq) {
    var byKey = dict();
    byKey['0'] = G.original;
    G.versions.forEach(function (v) { byKey[v.key] = v; });
    var clips = seq.map(function (k, i) {
      var c = byKey[k];
      if (k !== '0') return { key: k, brick_id: c.brick_id, clip: 'after', label: c.label, media: c.media };
      // l'original est rattaché à la version voisine dans la suite (la suivante, sinon la précédente)
      var nb = seq[i + 1] && seq[i + 1] !== '0' ? seq[i + 1] : seq[i - 1];
      return { key: '0', brick_id: nb && has(byKey, nb) ? byKey[nb].brick_id : c.brick_id, clip: 'before', label: c.label, media: c.media };
    });
    var label = clips.map(function (c) { return c.label; }).join(' → ') + (G.scene ? ' (' + G.scene + ')' : '');
    return { id: 'HK-' + G.group + '-' + seq.join(''), group: G.group, module: G.module, code: seq.join(''), label: label,
      components: clips.map(function (c, i) { return { slot: LETTERS[i].toUpperCase(), brick_id: c.brick_id, clip: c.clip }; }),
      clips: clips };
  }
  // Tous les assemblages valides (fonction pure) : groupes dans l'ordre de leur nom, 2 clips puis 3 clips.
  function assemblies(bricks) {
    var out = [];
    txGroups(bricks).forEach(function (G) { groupSequences(G).forEach(function (s) { out.push(makeAssembly(G, s)); }); });
    return out;
  }
  // Contrôle d'une recette factory_recipes existante : { valid, reasons, group, module, code, id (ID canonique), label, legacy }.
  // Format actuel : components [{slot, brick_id, clip:'before'|'after'}]. Ancien format (sans clip, 18/09) : chaque
  // composant = une transformation entière (avant → après) ; deux transformations = deux groupes mélangés ou l'original répété.
  function assemblyCheck(recipe, bricks) {
    var comps = recipe && Array.isArray(recipe.components) ? recipe.components : [], reasons = [], byTx = dict(), groups = [], seq = [];
    (bricks || []).forEach(function (b) { if (b && b.kind === 'transformation') byTx[b.id] = b; });
    var legacy = comps.length > 0 && comps.every(function (c) { return c && c.clip == null; });
    var G = dict();
    txGroups(bricks).forEach(function (g) { G[g.group] = g; });
    comps.forEach(function (c) {
      var id = c && c.brick_id, b = id && has(byTx, id) ? byTx[id] : null;
      if (!b) { reasons.push((id || '?') + ' n’est pas une transformation de la bibliothèque'); return; }
      if (!ready(b)) { reasons.push(id + ' n’est pas prête (' + statusFr(b.status) + ')'); return; }
      var g = str(meta(b).group) || String(b.id), gg = has(G, g) ? G[g] : null;
      if (groups.indexOf(g) < 0) groups.push(g);
      var v = gg ? gg.versions.filter(function (x) { return x.brick_id === id; })[0] : null;
      if (legacy) { seq.push('0', v ? v.key : '?'); return; }
      if (c.clip === 'before') seq.push('0');
      else if (c.clip === 'after') seq.push(v ? v.key : '?');
      else reasons.push('clip « ' + String(c.clip).slice(0, 20) + ' » inconnu pour ' + id + ' (before ou after)');
    });
    if (comps.length < (legacy ? 1 : 2)) reasons.push('au moins 2 clips');
    if (groups.length > 1) reasons.push('mélange les groupes ' + groups.join(' et ') + ' (un assemblage = un seul original filmé)');
    else {
      var dup = seq.filter(function (k, i) { return seq.indexOf(k) !== i; });
      if (dup.length) reasons.push('clip répété (' + (dup[0] === '0' ? 'l’original' : 'la version ' + dup[0]) + ')');
      if (seq.length > 3) reasons.push('au plus 3 clips');
      else if (seq.length === 3 && seq[0] !== '0') reasons.push('une suite de 3 clips part de l’original');
    }
    var ok = !reasons.length && groups.length === 1 && has(G, groups[0]);
    var asm = ok ? makeAssembly(G[groups[0]], seq) : null;
    return { valid: ok, reasons: reasons, legacy: legacy, group: groups.length === 1 ? groups[0] : null, module: asm ? asm.module : null,
      code: asm ? asm.code : null, id: asm ? asm.id : null, label: asm ? asm.label : null };
  }

  // ── paires hook × démo (QC) ──
  function pairLevel(hook, demo) {
    if (!hook || !demo) return 'review';
    if (isGenericHook(hook)) return 'ok';
    return hookSubjects(hook).indexOf(String(demo.subject || '')) >= 0 ? 'ok' : 'review';
  }
  function pairWhy(hook, demo) {
    if (pairLevel(hook, demo) === 'ok') return '';
    var s = hookSubjects(hook);
    return (hook && hook.id || '?') + ' (' + (s.length ? s.join(', ') : 'aucun sujet') + ') ne cite pas le sujet de '
      + (demo && demo.id || '?') + ' (' + (demo && demo.subject || '?') + ')';
  }
  function liaisonOk(liaison, hook, demo) {
    if (!liaison) return true;                              // format court : hook + démo + CTA
    if (isGenericLiaison(liaison)) return true;
    if (pairLevel(hook, demo) !== 'ok') return false;       // paire à revoir : liaison générique seulement
    var mods = meta(liaison).modules;
    return Array.isArray(mods) && mods.indexOf(demoModule(demo)) >= 0;
  }

  // ── matrice hook × liaison (usine/hook-liaison.js) ──
  // matrice passée en paramètre ; undefined = celle chargée globalement (usine/hook-liaison.js) ; null = aucune matrice.
  function matrixOf(matrix) { return matrix && typeof matrix === 'object' ? matrix : matrix === undefined ? (root && root.CF_HOOK_LIAISON) || null : null; }
  function inMatrix(hookId, matrix) { var M = matrixOf(matrix); return !!M && Object.prototype.hasOwnProperty.call(M, hookId) && Array.isArray(M[hookId]); }
  // Liaisons (briques) qui peuvent suivre ce hook : celles de la matrice ; hook absent de la matrice → génériques seulement.
  function liaisonsFor(hook, liaisons, matrix) {
    if (!hook) return [];
    var M = matrixOf(matrix), ids = inMatrix(hook.id, M) ? M[hook.id] : null;
    return (liaisons || []).filter(function (l) { return ids ? ids.indexOf(l.id) >= 0 : isGenericLiaison(l); });
  }
  function liaisonCompatible(liaison, hook, matrix, liaisons) {
    if (!liaison) return true;
    var M = matrixOf(matrix);
    if (inMatrix(hook && hook.id, M)) return M[hook.id].indexOf(liaison.id) >= 0;
    return isGenericLiaison(liaison);
  }

  // Bibliothèque exploitable, depuis les lignes factory_bricks (ou les briques normalisées du dashboard).
  // hooks = tous les hooks sans alias ; lipsyncHooks = sans les hooks avant / après ; aaHooks = les hooks avant / après.
  function library(bricks) {
    var L = { avatars: [], hooks: [], lipsyncHooks: [], aaHooks: [], liaisons: [], ctas: [], demos: [], aliases: {} };
    (bricks || []).forEach(function (b) {
      if (!b) return;
      if (b.kind === 'hook' && meta(b).alias_of) L.aliases[b.id] = String(meta(b).alias_of);
      if (!ready(b)) return;
      if (b.kind === 'avatar') L.avatars.push(b);
      else if (b.kind === 'hook' && !meta(b).alias_of) { L.hooks.push(b); (isAvantApres(b) ? L.aaHooks : L.lipsyncHooks).push(b); }
      else if (b.kind === 'liaison') L.liaisons.push(b);
      else if (b.kind === 'cta') L.ctas.push(b);
      else if (b.kind === 'contenu') L.demos.push(b);
    });
    return L;
  }

  // Clé d'une vidéo finale : voix|avatar|hook|liaison (liaison vide = format court) — 4 champs, sens inchangé.
  // Avec un assemblage (5e argument, ou voix 'aa') : aa|avatar|hook|liaison|assemblage — avatar vide en format court
  // (le hook avant / après n'a pas d'avatar ; en long, l'avatar dit la liaison).
  function videoKey(voice, avatar, hook, liaison, assemblage) {
    if (assemblage || voice === 'aa') return aaKey(voice, avatar, hook, liaison, assemblage);
    return [VOICES.indexOf(voice) >= 0 ? voice : 'axel', avatar, hook, liaison].map(function (x) { return String(x || ''); }).join('|');
  }
  function aaKey(voice, avatar, hook, liaison, assemblage) {
    var v = voice == null || voice === '' || voice === 'axel' || voice === 'aa' ? 'aa' : String(voice);   // autre voix → hors des possibles
    return [v, liaison ? avatar : '', hook, liaison, assemblage].map(function (x) { return String(x || ''); }).join('|');
  }
  // Clé d'une recette factory_qc au nouveau format (brick_combo) : voix 'axel' par défaut, hook alias → son original.
  // null si la recette n'a ni avatar ni hook (ancien format, texte libre : jamais compté). Une voix inconnue (« tts »,
  // « Omni »…) garde sa valeur : la clé tombe hors des possibles (capacity → outside), jamais comptée dans un mode.
  // Recette avec assemblage (vidéo avant / après, voix 'axel' ou absente) : clé aa|avatar|hook|liaison|assemblage, avatar
  // facultatif en format court. Les recettes sans assemblage gardent exactement leur clé d'avant.
  function comboKey(combo, byId) {
    if (!combo || typeof combo !== 'object' || !combo.hook) return null;
    var hb = has(byId, combo.hook) ? byId[combo.hook] : null, h = hb && meta(hb).alias_of ? String(meta(hb).alias_of) : combo.hook;
    if (combo.assemblage) return aaKey(combo.voice, combo.avatar, h, combo.liaison, combo.assemblage);
    if (!combo.avatar) return null;
    var v = combo.voice == null || combo.voice === '' ? 'axel' : String(combo.voice);
    return [v, combo.avatar, h, combo.liaison || ''].map(function (x) { return String(x || ''); }).join('|');
  }
  // Déclinaisons (Axel 26/09) : une vidéo de base (même clé comboKey = même avatar, hook, liaison, voix ou assemblage) peut
  // sortir en DECLINAISONS_MAX versions au plus ; chaque version change la démo, la musique, les sous-titres ET le format
  // (champs contenu, musique, sous_titre, format de brick_combo). Les versions d'une même base se publient espacées dans le
  // temps (planificateur de publication). existing = brick_combo des vidéos déjà rendues (statut refusé exclu par l'appelant).
  var DECLINAISONS_MAX = 3, DECLI_FIELDS = ['contenu', 'musique', 'sous_titre', 'format'];
  function declinaisonCheck(combo, existing, byId) {
    var k = comboKey(combo, byId), reasons = [];
    if (!k) return { ok: true, key: null, n: 0, max: DECLINAISONS_MAX, reasons: reasons };
    var same = (existing || []).filter(function (e) { return e && comboKey(e, byId) === k; });
    if (same.length >= DECLINAISONS_MAX) reasons.push('déjà ' + same.length + ' versions de ' + k + ' (plafond ' + DECLINAISONS_MAX + ')');
    DECLI_FIELDS.forEach(function (f) {
      if (!combo[f]) return;
      var dup = same.filter(function (e) { return e[f] && String(e[f]) === String(combo[f]); });
      if (dup.length) reasons.push(f + ' ' + combo[f] + ' déjà utilisé(e) dans une autre version de ' + k);
    });
    return { ok: !reasons.length, key: k, n: same.length, max: DECLINAISONS_MAX, reasons: reasons };
  }
  function voiceValid(v) { return v == null || v === '' || VOICES.indexOf(v) >= 0; }
  // Ancienne clé (avatar × hook × démo) : gardée pour les scripts qui la lisent encore ; la capacité ne l'utilise plus.
  function tripleKey(avatar, hook, demo) { return [avatar, hook, demo].map(function (x) { return String(x || ''); }).join('|'); }

  // Capacité de création : vidéos finales possibles par mode de voix (court = avatar × hook, long = avatar × paires
  // hook × liaison compatibles), et ce qu'il en reste une fois retirées celles déjà produites.
  // done = clés videoKey / comboKey déjà rendues (tout statut QC confondu) ; une clé hors des possibles (brique retirée,
  // liaison non validée après ce hook, voix sans audio…) n'est pas décomptée : elle est rendue dans `outside`.
  //
  // Modes lipsync (axel, omni) : les hooks avant / après en sont exclus (jamais en lipsync). Mode 'aa' « Avant / après »
  // (voix off d'Axel : le hook doit avoir son audio ; pas de Voix native Omni) : par groupe de transformations,
  //   court = assemblages valides du groupe × hooks avant / après du module du groupe ;
  //   long  = Σ hooks (assemblages × liaisons compatibles avec audio × avatars).
  // total = axel + omni + aa (vidéos finales possibles). Forme du résultat : usine/README.md et usine/coherence.test.mjs.
  function capacity(bricks, done, matrix) {
    var L = library(bricks), A = L.avatars.length, M = matrixOf(matrix);
    var av = dict(), hk = dict(), modes = dict(), possible = dict(), pairsAll = 0, notInMatrix = [];
    L.avatars.forEach(function (a) { av[a.id] = 1; });
    L.hooks.forEach(function (h) {
      var ls = liaisonsFor(h, L.liaisons, M);
      hk[h.id] = ls;
      pairsAll += ls.length;
      if (!inMatrix(h.id, M)) notInMatrix.push(h.id);
    });
    // hooks lipsync à incrustation obligatoire (meta.overlay_required) : comptés normalement, signalés à part
    var ov = { count: 0, hooks: [], kinds: {}, videos: {} };
    L.lipsyncHooks.forEach(function (h) { var o = overlayRequired(h); if (o) { ov.count += 1; ov.hooks.push(h.id); ov.kinds[o] = (ov.kinds[o] || 0) + 1; } });
    VOICES.forEach(function (v) {
      var H = 0, P = 0, set = dict(), ovN = 0;
      L.lipsyncHooks.forEach(function (h) {
        if (!voiceOk(h, v)) return;
        var p0 = P;
        H += 1; set[h.id] = dict(); set[h.id][''] = 1;
        hk[h.id].forEach(function (l) { if (voiceOk(l, v)) { P += 1; set[h.id][l.id] = 1; } });
        if (overlayRequired(h)) ovN += A * (1 + P - p0);
      });
      possible[v] = set;
      ov.videos[v] = ovN;
      modes[v] = { voice: v, label: VOICE_LABEL[v], hooks: H, pairs: P, short: A * H, long: A * P, total: A * (H + P), done: 0, remaining: 0 };
    });
    // ── Avant / après ──
    var asm = assemblies(bricks), gs = [], aaSet = dict(), aaH = dict(), aaS = 0, aaL = 0, aaP = 0;
    txGroups(bricks).forEach(function (G) {
      var ids = asm.filter(function (a) { return a.group === G.group; }).map(function (a) { return a.id; }), n = ids.length;
      var hs = L.aaHooks.filter(function (h) { return hasAudio(h) && hookFitsModule(h, G.module); }), s = n * hs.length, l = 0;
      hs.forEach(function (h) {
        var ls = hk[h.id].filter(function (x) { return hasAudio(x); });
        l += n * ls.length * A; aaH[h.id] = 1;
        ids.forEach(function (id) {
          var k = id + '|' + h.id;
          aaSet[k] = dict(); aaSet[k][''] = 1;
          ls.forEach(function (x) { aaSet[k][x.id] = 1; });
        });
      });
      aaS += s; aaL += l;
      gs.push({ group: G.group, module: G.module, assemblies: n, hooks: hs.map(function (h) { return h.id; }), short: s, long: l });
    });
    modes.aa = { voice: 'aa', label: MODE_LABEL.aa, hooks: Object.keys(aaH).length, assemblies: asm.length, groups: gs,
      short: aaS, long: aaL, total: aaS + aaL, done: 0, remaining: 0 };
    var seen = dict(), outside = 0;
    (done || []).forEach(function (k) {
      if (!k || seen[k]) return;
      seen[k] = 1;
      var p = String(k).split('|'), v = p[0];
      if (p.length === 5 && v === 'aa') {   // aa|avatar|hook|liaison|assemblage (avatar vide en court)
        var e = has(aaSet, p[4] + '|' + p[2]) ? aaSet[p[4] + '|' + p[2]] : null;
        if (e && has(e, p[3]) && (p[3] ? has(av, p[1]) : p[1] === '')) modes.aa.done += 1; else outside += 1;
        return;
      }
      var s = VOICES.indexOf(v) >= 0 ? possible[v] : null, set = s && has(s, p[2]) ? s[p[2]] : null;
      if (p.length === 4 && has(av, p[1]) && set && has(set, p[3])) modes[v].done += 1; else outside += 1;
    });
    var total = 0, doneN = 0;
    MODES.forEach(function (v) { var m = modes[v]; m.remaining = Math.max(0, m.total - m.done); total += m.total; doneN += m.done; });
    return { avatars: A, hooks: L.hooks.length, lipsyncHooks: L.lipsyncHooks.length, aaHooks: L.aaHooks.map(function (h) { return h.id; }),
      liaisons: L.liaisons.length, demos: L.demos.length, ctas: L.ctas.length,
      genericLiaisons: L.liaisons.filter(isGenericLiaison).length, pairs: pairsAll, matrix: !!M, notInMatrix: notInMatrix,
      overlayRequired: ov, modes: modes, voices: VOICES.slice(), modeKeys: MODES.slice(), avantApres: modes.aa,
      lipsyncTotal: modes.axel.total + modes.omni.total, total: total, done: doneN, remaining: Math.max(0, total - doneN), outside: outside,
      declinaisons: { max: DECLINAISONS_MAX, total: total * DECLINAISONS_MAX } };
  }

  // Impact d'une brique de plus, en vidéos finales (Briques qui manquent). Estimations aux moyennes de la bibliothèque :
  //   +1 avatar  = Σ voix (hooks + paires hook × liaison) + les longs avant / après d'un avatar ;
  //   +1 hook    = Σ voix avatars × (1 + liaisons compatibles moyennes par hook) (un hook lipsync) ;
  //   +1 liaison = Σ voix avatars × hooks compatibles moyens par liaison + longs avant / après moyens par liaison ;
  //   +1 démo / CTA / musique / sous-titres = variété (tirés au hasard) : +0 vidéo.
  function impact(cap) {
    var A = cap.avatars, out = { avatar: 0, hook: 0, liaison: 0, variety: 0, avgLiaisonsPerHook: 0, avgHooksPerLiaison: 0, aa: { avatar: 0, liaison: 0 } };
    VOICES.forEach(function (v) {
      var m = cap.modes[v];
      out.avatar += m.hooks + m.pairs;
      out.hook += A * (1 + (m.hooks ? m.pairs / m.hooks : 0));
      out.liaison += A * (cap.liaisons ? m.pairs / cap.liaisons : 0);
    });
    var aa = cap.modes.aa;
    if (aa && A) { out.aa.avatar = aa.long / A; out.aa.liaison = cap.liaisons ? aa.long / cap.liaisons : 0; out.avatar += out.aa.avatar; out.liaison += out.aa.liaison; }
    out.avgLiaisonsPerHook = cap.hooks ? cap.pairs / cap.hooks : 0;
    out.avgHooksPerLiaison = cap.liaisons ? cap.pairs / cap.liaisons : 0;
    out.avatar = Math.round(out.avatar); out.hook = Math.round(out.hook); out.liaison = Math.round(out.liaison);
    out.aa.avatar = Math.round(out.aa.avatar); out.aa.liaison = Math.round(out.aa.liaison);
    return out;
  }

  function pick(list, rand) {
    if (!list.length) return null;
    var r = typeof rand === 'function' ? rand() : Math.random();
    return list[Math.min(list.length - 1, Math.max(0, Math.floor(r * list.length)))];
  }
  // Démo tirée au hasard pour un hook (+ sa liaison, format long) : parmi les démos qui passent le contrôle QC (sujet cité
  // ou hook générique, ET liaison acceptée par liaisonOk) s'il y en a → level 'ok' ; sinon parmi celles au sujet cité (la
  // liaison part en revue), sinon parmi toutes → level 'review' (la vidéo ira en revue QC). exclude = IDs à éviter.
  function liaisonWhy(liaison, hook, demo) {
    return pairLevel(hook, demo) === 'ok'
      ? 'liaison ' + liaison.id + ' hors du module de la démo ' + demo.id + ' (' + (demoModule(demo) || '?') + ')'
      : 'liaison ' + liaison.id + ' non générique sur une paire à revoir';
  }
  function pickDemo(hook, demos, rand, exclude, liaison) {
    var ex = exclude || [], pool = (demos || []).filter(function (d) { return ready(d) && ex.indexOf(d.id) < 0; });
    var pref = pool.filter(function (d) { return pairLevel(hook, d) === 'ok'; });
    var best = pref.filter(function (d) { return liaisonOk(liaison || null, hook, d); });
    var d = pick(best.length ? best : pref.length ? pref : pool, rand);
    if (!d) return null;
    var why = best.length ? '' : pref.length ? liaisonWhy(liaison, hook, d) : pairWhy(hook, d);
    return { demo: d, level: best.length ? 'ok' : 'review', why: why, preferred: best.length };
  }
  function pickCta(ctas, rand, exclude) {
    var ex = exclude || [], pool = (ctas || []).filter(function (c) { return ready(c) && ex.indexOf(c.id) < 0; });
    return pick(pool, rand);
  }

  // Déclinaison d'une publication du Top : MÊME voix, même avatar, même hook (+ même liaison), avec une AUTRE démo et un
  // AUTRE CTA (seule exception à « démo et CTA ne font pas une nouvelle vidéo »). Renvoie la nouvelle recette + son niveau
  // de cohérence (la démo reste choisie par pickDemo), ou { combo: null, reasons } si la bibliothèque ne le permet pas.
  function declineTop(combo, bricks, opts) {
    opts = opts || {};
    var L = library(bricks), byId = dict(), reasons = [];
    (bricks || []).forEach(function (b) { if (b) byId[b.id] = b; });
    var c = combo || {}, hid = c.hook && byId[c.hook] && meta(byId[c.hook]).alias_of ? String(meta(byId[c.hook]).alias_of) : c.hook;
    var hook = hid && has(byId, hid) ? byId[hid] : null, liaison = c.liaison && has(byId, c.liaison) ? byId[c.liaison] : null;
    if (!hook || !ready(hook)) reasons.push('hook ' + (c.hook || '?') + ' absent de la bibliothèque');
    var d = hook ? pickDemo(hook, L.demos, opts.rand, c.contenu ? [c.contenu] : [], liaison) : null;
    if (hook && !d) reasons.push('aucune autre démo prête');
    var cta = pickCta(L.ctas, opts.rand, c.cta ? [c.cta] : []);
    if (!cta) reasons.push('aucun autre CTA prêt');
    if (reasons.length) return { combo: null, level: null, reasons: reasons };
    // combo = recette à écrire telle quelle dans brick_combo (clés COMBO_KEYS seulement) ; la publication d'origine est
    // rendue À CÔTÉ (from), jamais dans la recette : une clé inconnue la rendrait illisible pour le dashboard.
    var out = { voice: c.voice === 'omni' ? 'omni' : 'axel', avatar: c.avatar, hook: hid, contenu: d.demo.id, cta: cta.id };
    if (c.liaison) out.liaison = c.liaison;
    if (c.assemblage) out.assemblage = c.assemblage;   // vidéo avant / après : même assemblage
    ['musique', 'sous_titre'].forEach(function (k) { if (c[k]) out[k] = c[k]; });
    return { combo: out, from: opts.from || null, level: d.level, reasons: d.level === 'ok' ? [] : ['cohérence à vérifier : ' + d.why], key: comboKey(out, byId) };
  }

  // Contrôle d'une recette avant QC (usine/publish-qc.mjs). combo = { voice?, avatar, hook, liaison?, contenu, cta } (IDs) ;
  // byId = factory_bricks indexées par id ; matrix (facultatif) = usine/hook-liaison.js. level 'ok' | 'review' ;
  // reasons = pourquoi la vidéo va en revue manuelle.
  // Contrôle aussi la voix (inconnue, ou brique parlée sans audio / sans texte pour ce mode), les clés de la recette et la
  // règle avant / après (combo.assemblage = ID d'un assemblage HK valide ; hook avant / après jamais sans assemblage).
  function comboCheck(combo, byId, matrix) {
    combo = combo || {}; byId = byId || {};
    var get = function (k) { return combo[k] && has(byId, combo[k]) ? byId[combo[k]] : null; };
    var hook = get('hook'), demo = get('contenu'), liaison = get('liaison'), reasons = [];
    ['hook', 'contenu'].forEach(function (k) {
      if (!combo[k]) reasons.push('recette sans ' + (k === 'contenu' ? 'démo' : k));
      else if (!has(byId, combo[k])) reasons.push(combo[k] + ' introuvable dans la bibliothèque');
      else if (!ready(byId[combo[k]])) reasons.push(combo[k] + ' n’est pas prête (' + statusFr(byId[combo[k]].status) + ')');
    });
    if (combo.liaison && !liaison) reasons.push(combo.liaison + ' introuvable dans la bibliothèque');
    else if (liaison && !ready(liaison)) reasons.push(liaison.id + ' n’est pas prête (' + statusFr(liaison.status) + ')');
    if (hook && demo) {
      if (pairLevel(hook, demo) !== 'ok') reasons.push('cohérence à vérifier : ' + pairWhy(hook, demo));
      if (liaison && !liaisonOk(liaison, hook, demo)) reasons.push(liaisonWhy(liaison, hook, demo));
    }
    // voix : 'axel' (défaut) = la brique parlée a son fichier audio ; 'omni' = elle a un texte à dire (usine : voiceOk)
    if (!voiceValid(combo.voice)) reasons.push('voix « ' + String(combo.voice).slice(0, 30) + ' » inconnue (axel ou omni)');
    else {
      var v = combo.voice || 'axel', need = v === 'omni' ? 'sans texte à dire (Voix native Omni)' : 'sans fichier audio (Audio d’Axel)';
      if (hook && !voiceOk(hook, v)) reasons.push('hook ' + hook.id + ' ' + need);
      if (liaison && !voiceOk(liaison, v)) reasons.push('liaison ' + liaison.id + ' ' + need);
    }
    // avant / après : un hook avant / après n'est jamais en lipsync ; avec un assemblage, il faut un assemblage valide
    // (un seul groupe), un hook avant / après du module de ce groupe et la voix off d'Axel (pas de Voix native Omni)
    if (combo.assemblage) {
      var asm = assemblies(Object.keys(byId).map(function (k) { return byId[k]; })).filter(function (a) { return a.id === combo.assemblage; })[0];
      if (!asm) reasons.push('assemblage ' + String(combo.assemblage).slice(0, 40) + ' inconnu (suite de clips d’un seul groupe de transformations)');
      if (hook && !isAvantApres(hook)) reasons.push('hook ' + hook.id + ' lipsync sur un assemblage avant / après (hooks avant / après seulement)');
      else if (hook && asm && !hookFitsModule(hook, asm.module)) reasons.push('hook ' + hook.id + ' hors du module de ' + asm.id + ' (' + asm.module + ')');
      if (combo.voice === 'omni') reasons.push('pas de Voix native Omni sur un hook avant / après (voix off d’Axel)');
      if (combo.liaison && !combo.avatar) reasons.push('format long sans avatar (la liaison est dite par un avatar)');
    } else if (hook && isAvantApres(hook)) reasons.push('hook ' + hook.id + ' avant / après : jamais en lipsync (voix off sur un assemblage HK)');
    // H14 / H23 / H60 (meta.overlay_required) : lipsync seulement avec une image d'avatar en incrustation → toujours revue manuelle
    else if (hook && overlayRequired(hook)) reasons.push('hook ' + hook.id + ' : incrustation d’une image d’avatar ' + overlayRequired(hook) + ' obligatoire, à vérifier');
    var extra = Object.keys(combo).filter(function (k) { return COMBO_KEYS.indexOf(k) < 0; });
    if (extra.length) reasons.push('clé inconnue dans la recette : ' + extra.join(', ') + ' (admises : ' + COMBO_KEYS.join(', ') + ')');
    var M = matrixOf(matrix);
    if (M && hook && liaison) {
      var h = meta(hook).alias_of && has(byId, meta(hook).alias_of) ? byId[meta(hook).alias_of] : hook;
      if (!liaisonCompatible(liaison, h, M)) reasons.push('liaison ' + liaison.id + ' non validée après ' + h.id + ' (matrice hook × liaison)');
    }
    return { level: reasons.length ? 'review' : 'ok', reasons: reasons, hook: hook, demo: demo, liaison: liaison };
  }

  return { VOICES: VOICES, VOICE_LABEL: VOICE_LABEL, MODES: MODES, MODE_LABEL: MODE_LABEL, COMBO_KEYS: COMBO_KEYS,
    isAvantApres: isAvantApres, overlayRequired: overlayRequired, hookFitsModule: hookFitsModule,
    txGroups: txGroups, assemblies: assemblies, assemblyCheck: assemblyCheck, statusFr: statusFr, voiceValid: voiceValid, liaisonWhy: liaisonWhy,
    pairLevel: pairLevel, pairWhy: pairWhy, liaisonOk: liaisonOk, library: library, capacity: capacity, impact: impact, comboCheck: comboCheck,
    liaisonsFor: liaisonsFor, liaisonCompatible: liaisonCompatible, inMatrix: inMatrix, hasAudio: hasAudio, voiceText: voiceText, voiceOk: voiceOk,
    videoKey: videoKey, comboKey: comboKey, DECLINAISONS_MAX: DECLINAISONS_MAX, declinaisonCheck: declinaisonCheck, tripleKey: tripleKey, pickDemo: pickDemo, pickCta: pickCta, declineTop: declineTop,
    hookSubjects: hookSubjects, isGenericHook: isGenericHook, isGenericLiaison: isGenericLiaison, demoModule: demoModule };
});
