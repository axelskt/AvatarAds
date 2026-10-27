/*
 * Creative Factory — CARTE DES BRIQUES (27/10, Axel : « la carte des briques à ajouter dans Production », maquette
 * « Carte des briques.dc.html » + README du zip « Creative Factory Auto-DM Dashboard-2 »).
 * Graphe de toutes les briques Omni Flash (avatars, photos, hooks, liaisons, démos, CTA, habillage…) et de leurs liens, sur un
 * seul <canvas> 2D : 5 vues animées (Constellation, Parcours, Orbites, Amas, Îles), 5 animations de câbles, survol, recherche,
 * panneau de détail (brique ou vidéo). Logique reprise telle quelle de la maquette (§5 du README) ; restes de prototypes non
 * portés (§9 : frise, rejouer, mode automatique, mode chemin, filtres avatar / prêts / période / compte, taille = vues, chaleur,
 * légende) — seul pathFor() reste, pour « N vidéos possibles » d'un hook.
 * Données : construites dans le navigateur avec les MÊMES règles que usine/lots/carte.py (--omni --sans A2), à partir de la
 * RPC factory_carte_data() (migration 20261027130000) et de la matrice hook → liaison (usine/hook-liaison.js).
 * Mise à jour du 27/10 par rapport à l'export du 19/10 : famille « Hook démo » (HD-…, résultats montrés dans l'accroche des
 * formats Sous-titres en arrière-plan et Split, reliés aux hooks par la banque meta.incruste.hook_demos) ; les deux carrefours
 * génériques « Vidéo parlée » / « Texte + musique » sont remplacés par les VRAIS formats (factory_formats, format de chaque
 * vidéo = factory_format_de), reliés aux briques réellement utilisées dans leurs vidéos.
 *   CFCarte.build(raw, matrix) → { regles, nodes, links, videos }
 *   CFCarte.create()           → { el, setData(d), setLoading(texte), destroy() }
 */
(function () {
  'use strict';

  // ── règles de la carte (usine/lots/carte.py) ──
  var MOD = { 'mcp-claude': 'Claude (MCP)', 'omni': 'Omni', 'image-ia': 'Images IA', 'static-ads': 'Pubs statiques', 'motion-control': 'Motion Control',
    'express': 'Express', 'montage-ia': 'Montage IA', 'nettoyage-audio': 'Nettoyage audio', 'generique': 'Générique (toutes démos)' };
  var REGLES = {
    'avatar-photo': "l'avatar et ses photos ; 'ready' = photo actuelle, 'ancienne' = ancienne photo dont les briques déjà générées restent utilisables",
    'photo-hook': 'cette photo a une vraie vidéo de ce hook (dit par cet avatar dans ce décor)',
    'photo-liaison': 'cette photo a une vraie vidéo de cette liaison',
    'photo-cta': 'cette photo a une vraie vidéo de ce CTA',
    'hook-liaison': 'matrice validée par Axel : cette liaison peut suivre ce hook (format long)',
    'hook-module': 'ce hook va avec les démos de ce module (Générique = toutes)',
    'demo-module': 'module montré par la démo',
    'module-cta': 'CTA de fin : démo Claude (MCP) → CTA-CLAUDE ; autres démos → AIDE, MONTAGE, PLAN, SITE, café en rotation',
    'choc-module': 'texte choc compatible avec les démos de ce module (Générique = toutes) ; logos=true → texte à logos, prioritaire 2 fois sur 3 sur les démos Claude',
    'transfo-module': 'transformation avant/après de ce module',
    'format': 'brique utilisée dans au moins une vidéo de ce format',
    'habillage': 'habillage utilisé dans au moins une vidéo de ce format',
    'hook-hookdemo': 'résultat de l’app montré dans l’accroche de ce hook (banque des formats Sous-titres en arrière-plan et Split)',
    'liaison-module': 'déduit de la matrice : cette liaison suit un hook compatible avec ce module, elle précède donc ses démos',
    'reaction-demo': 'cette réaction a déjà été montée avec cette démo muette (au moins une vidéo non refusée)',
    'video-brique': 'brique utilisée dans cette vidéo assemblée'
  };
  var KEYS = ['voice', 'format', 'avatar', 'photo', 'hook', 'hook_demos', 'liaison', 'contenu', 'cta', 'texte_choc', 'style_choc', 'musique', 'sous_titre', 'reaction', 'assemblage'];
  var PARLEE = { 'Avatar qui parle': 1, 'Ta voix + avatar': 1, 'Transformation vidéo': 1 };   // famille de format → bande « Vidéo parlée » (sinon « Texte + musique »)
  var SANS = { A2: 1 };                 // Axel 19/10 : rien d'A2 sur la carte
  var LOGOS = { TH27: 1, TH36: 1 };     // textes choc à logos (usine/formats.js : logos: true / 'cheat')
  var base = function (u) { return String(u).split('/').pop().replace(/\.[^.]*$/, ''); };

  function build(raw, matrix) {
    raw = raw || {};
    var hors = function (ph) { return !!ph && !!SANS[String(ph).split('-')[0]]; };
    var br = (raw.bricks || []).filter(function (b) { return !(b.kind === 'avatar' && SANS[b.id]); });
    var variants = (raw.variants || []).map(function (v) { return { a: v[0], b: v[1], f: v[2] }; }).filter(function (v) { return !hors(v.a) && v.f === 'omni'; });
    var avecClip = {}; variants.forEach(function (v) { avecClip[v.a] = 1; });
    var nodes = {}, order = [], links = [], seen = {};
    var N = function (id, kind, label, kw) {
      var d = { id: id, kind: kind, label: label };
      Object.keys(kw || {}).forEach(function (k) { var v = kw[k]; if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) d[k] = v; });
      if (!nodes[id]) order.push(id);
      nodes[id] = d;
    };
    var L = function (a, b, t) { var k = a + '|' + b + '|' + t; if (nodes[a] && nodes[b] && !seen[k]) { seen[k] = 1; links.push({ source: a, target: b, type: t }); } };
    Object.keys(MOD).forEach(function (m) { N('M:' + m, 'module', MOD[m]); });
    br.forEach(function (b) {
      var m = b.meta || {}, k = b.kind, st = b.status;
      if (k === 'avatar') {
        N(b.id, 'avatar', b.label, { status: st, image: m.cover });
        var th = {}; (m.thumbs || []).concat(m.thumbs_retirees || []).forEach(function (u) { th[base(u)] = u; });
        (m.images || []).map(function (u) { return [u, 'ready']; }).concat((m.images_retirees || []).map(function (u) { return [u, 'ancienne']; })).forEach(function (x) {
          var pid = base(x[0]);
          if (nodes[pid] || (x[1] === 'ancienne' && !avecClip[pid])) return;
          N(pid, 'photo', pid + ' · ' + String(((m.decors || {})[pid]) || '').split(' (')[0], { status: x[1], image: th[pid] || x[0] });
          L(b.id, pid, 'avatar-photo');
        });
        return;
      }
      if (st !== 'ready' && !(k === 'texte-choc' && st === 'draft')) return;
      if (k === 'hook') N(b.id, 'hook', m.transcript || m.script || b.label, { status: st, compatible: m.compatible_subjects, hookDemos: m.hook_demos });
      else if (k === 'hook-demo') N(b.id, 'hook_demo', b.label, { status: st, media: m.media, image: m.poster || m.cover });
      else if (k === 'liaison') N(b.id, 'liaison', m.transcript || b.label, { status: st, generique: b.subject === 'generique' });
      else if (k === 'contenu') N(b.id, m.muette || /^C-[A-Z]+M-/.test(b.id) ? 'demo_muette' : 'demo', b.label, { status: st, module: m.module || b.subject, media: m.media });
      else if (k === 'cta') N(b.id, 'cta', m.transcript || m.script || b.label, { keyword: m.keyword, status: st });
      else if (k === 'texte-choc') N(b.id, 'texte_choc', m.text || b.label, { status: st, logos: !!LOGOS[b.id], compatible: m.compatible_subjects });
      else if (['style-choc', 'musique', 'sous-titre', 'transformation', 'reaction'].indexOf(k) >= 0)
        N(b.id, k.replace('-', '_'), b.label, { status: st, image: m.cover || m.poster, media: m.media, module: b.subject });
    });
    variants.forEach(function (v) { L(v.a, v.b, /^H/.test(v.b) ? 'photo-hook' : /^CTA/.test(v.b) ? 'photo-cta' : /^L/.test(v.b) ? 'photo-liaison' : 'photo-brique'); });
    Object.keys(matrix || {}).forEach(function (h) { (matrix[h] || []).forEach(function (l) { L(h, l, 'hook-liaison'); }); });
    order.slice().forEach(function (i) {
      var n = nodes[i], k = n.kind;
      if (k === 'hook') { (n.compatible || ['generique']).forEach(function (s) { L(i, 'M:' + s, 'hook-module'); }); (n.hookDemos || []).forEach(function (hd) { L(i, hd, 'hook-hookdemo'); }); }
      else if (k === 'demo' || k === 'demo_muette') L(i, 'M:' + (n.module || 'generique'), 'demo-module');
      else if (k === 'texte_choc') (n.compatible || ['generique']).forEach(function (s) { L(i, 'M:' + s, 'choc-module'); });
      else if (k === 'transformation') L(i, 'M:' + (n.module || 'omni'), 'transfo-module');
    });
    L('M:mcp-claude', 'CTA-CLAUDE', 'module-cta');
    ['CTA-AIDE', 'CTA-MONTAGE', 'CTA-PLAN', 'CTA-SITE-tuto', 'CTA-cafe'].forEach(function (c) { Object.keys(MOD).forEach(function (m) { if (m !== 'mcp-claude') L('M:' + m, c, 'module-cta'); }); });
    // historique + statistiques (une statistique avec recette mais sans numéro VF compte quand même : clé IG-<média>)
    var pick = function (c) { var o = {}; Object.keys(c || {}).forEach(function (k) { if (KEYS.indexOf(k) >= 0 && c[k] && !(Array.isArray(c[k]) && !c[k].length)) o[k] = c[k]; }); return o; };
    var ids = function (c) { var u = {}; Object.keys(c).forEach(function (k) { if (k !== 'voice' && k !== 'format') [].concat(c[k]).forEach(function (x) { if (typeof x === 'string') u[x] = 1; }); }); return Object.keys(u); };
    var FMT = {}; (raw.formats || []).forEach(function (f) { if (f && f.id) FMT[f.id] = f; });
    var fmtUse = {};   // format → briques utilisées dans au moins une de ses vidéos (refusées exclues)
    var garde = function (c) { return !hors(c.photo || c.avatar) && c.voice !== 'axel'; };
    var use = {}, vues = {}, npub = {}, videos = [], byvf = {};
    var ST = { approved: 'validée', pending: 'en revue', refused: 'refusée' };
    var anc = {}, reac = {};   // anc : briques des vidéos écartées (voix d'Axel ou A2) ; reac : réaction → démos montées ensemble
    (raw.qc || []).forEach(function (r) {
      var c = pick(r.combo);
      if (!garde(c)) { if (r.status !== 'refused') ids(c).forEach(function (b) { anc[b] = (anc[b] || 0) + 1; }); return; }
      if (r.status !== 'refused' && typeof c.reaction === 'string' && typeof c.contenu === 'string') (reac[c.reaction] = reac[c.reaction] || {})[c.contenu] = 1;
      var v = { vf: r.vf, date: String(r.created_at || '').replace('T', ' ').slice(0, 16), statut: ST[r.status] || r.status, recette: c, affiche: r.poster_url, video: r.video_url, fmt: FMT[r.format] ? r.format : null };
      if (r.refusal_reason) v.raison_refus = r.refusal_reason;
      if (r.status !== 'refused') {
        ids(c).forEach(function (b) { use[b] = (use[b] || 0) + 1; });
        if (v.fmt) { var fu = fmtUse[v.fmt] = fmtUse[v.fmt] || {}; ids(c).forEach(function (b) { fu[b] = 1; }); }
      }
      videos.push(v); byvf[v.vf] = v;
    });
    var pub = {};
    (raw.stats || []).forEach(function (s) { var c = s.combo || {}; if (Object.keys(c).length) pub[c.vf || 'IG-' + s.media_id] = s; });
    Object.keys(pub).forEach(function (vf) {
      var s = pub[vf], c = pick(s.combo);
      if (!garde(c)) return;
      var p = { compte: s.account, publiee_le: String(s.posted_at || '').replace('T', ' ').slice(0, 16), lien: s.permalink, vues: s.views, portee: s.reach, likes: s.likes,
        commentaires: s.comments, partages: s.shares, enregistrements: s.saved, visionnage_moyen_s: s.avg_watch_s };
      if (byvf[vf]) byvf[vf].publication = p;
      else videos.push({ vf: vf, date: p.publiee_le, statut: 'publiée', recette: c, publication: p });
      ids(c).forEach(function (b) { vues[b] = (vues[b] || 0) + (s.views || 0); npub[b] = (npub[b] || 0) + 1; });
    });
    // carrefours « format » (Axel 27/10 : « avoir tous les formats, les 15 ») : tous les formats actifs ou en test, plus un format
    // arrêté qui a encore des vidéos sur la carte ; reliés aux briques de leurs vidéos (un format sans vidéo reste seul)
    (raw.formats || []).filter(function (F) { return F && F.id && (F.statut !== 'arrete' || fmtUse[F.id]); }).forEach(function (F) {
      var f = F.id; N('F:' + f, 'format', F.nom || f, { famille: F.famille, band: PARLEE[F.famille] ? 'parlee' : 'muette', statutFmt: F.statut });
      Object.keys(fmtUse[f] || {}).forEach(function (b) { var n = nodes[b]; if (n && n.kind !== 'avatar' && n.kind !== 'photo') L(b, 'F:' + f, ['musique', 'style_choc', 'sous_titre'].indexOf(n.kind) >= 0 ? 'habillage' : 'format'); });
    });
    // Axel 27/10 : « pourquoi les réactions ne sont pas reliées à leurs démos ? » → lien tiré des vidéos déjà montées
    Object.keys(reac).forEach(function (r) { Object.keys(reac[r]).forEach(function (d) { L(r, d, 'reaction-demo'); }); });
    var out = order.map(function (i) { return nodes[i]; });
    out.forEach(function (n) { if (use[n.id]) n.videos = use[n.id]; else if (anc[n.id]) n.anciennes = anc[n.id]; if (npub[n.id]) { n.publiees = npub[n.id]; n.vues = vues[n.id]; } });
    return { regles: REGLES, nodes: out, links: links, videos: videos.sort(function (a, b) { return a.vf < b.vf ? -1 : a.vf > b.vf ? 1 : 0; }), nonRelies: raw.non_relies || null, at: raw.at || null };
  }

  // ── constantes de la maquette (couleurs, épaisseurs, positions) ──
  var MF = "ui-monospace,'SF Mono',Menlo,monospace", SF = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,sans-serif";
  var ACC = '#FF6B35', ACC2 = '#FF8A5B';
  var FAM = [['avatar', 'Avatar', '#D9798F'], ['photo', 'Photo', '#EDB3C1'], ['hook', 'Hook', '#E9AE45'], ['hook_demo', 'Hook démo', '#E0866A'], ['liaison', 'Liaison', '#8DBF95'],
    ['demo', 'Démo', '#5E9BD6'], ['demo_muette', 'Démo muette', '#9CC2EA'], ['cta', 'CTA', '#A97FD1'], ['texte_choc', 'Texte choc', '#4FB3A9'],
    ['style_choc', 'Style choc', '#93D3CB'], ['musique', 'Musique', '#7C8BD6'], ['sous_titre', 'Sous-titres', '#B5BCE8'],
    ['transformation', 'Transformation', '#C29C6E'], ['reaction', 'Réaction', '#9AA86A'], ['video', 'Vidéo', '#6E655C'], ['hub', 'Carrefours', '#2F2A26']];
  var FAMC = {}, FAML = {}; FAM.forEach(function (f) { FAMC[f[0]] = f[2]; FAML[f[0]] = f[1]; });
  var KIND_LBL = Object.assign({}, FAML, { module: 'Module', format: 'Format' });
  var famOf = function (k) { return k === 'module' || k === 'format' ? 'hub' : k; };
  var LT = { 'avatar-photo': ['Avatar → photo', 1.6], 'photo-hook': ['Photo → hook', 1.5], 'photo-cta': ['Photo → CTA', 1.5],
    'hook-liaison': ['Hook → liaison', 0.55], 'hook-module': ['Hook → module', 0.9], 'hook-hookdemo': ['Hook → hook démo', 0.9], 'liaison-module': ['Liaison → module', 0.75], 'demo-module': ['Démo → module', 1.3],
    'transfo-module': ['Transformation → module', 1.3], 'module-cta': ['Module → CTA', 1.1], 'choc-module': ['Texte choc → module', 0.8],
    'format': ['Brique → format', 0.5], 'habillage': ['Habillage → format', 0.65], 'reaction-demo': ['Réaction → démo', 0.9], 'video-brique': ['Vidéo → brique', 0.45] };
  var LT_ORDER = Object.keys(LT);
  var IDLE_A = { 'avatar-photo': .4, 'photo-hook': .36, 'photo-cta': .36, 'hook-liaison': .07, 'hook-module': .2, 'hook-hookdemo': .22, 'liaison-module': .16, 'demo-module': .3, 'transfo-module': .3, 'module-cta': .26, 'choc-module': .16, 'format': .045, 'habillage': .08, 'reaction-demo': .22, 'video-brique': .018 };
  var MOD_ORDER = ['M:mcp-claude', 'M:omni', 'M:image-ia', 'M:motion-control', 'M:express', 'M:static-ads', 'M:montage-ia', 'M:nettoyage-audio', 'M:generique'];
  var FAM_ORDER = ['hub', 'avatar', 'photo', 'hook', 'hook_demo', 'liaison', 'demo', 'demo_muette', 'transformation', 'cta', 'texte_choc', 'style_choc', 'musique', 'sous_titre', 'reaction', 'video'];
  var TH = {
    light: { bg: '#F6F4F1', card: '#FFFFFF', line: 'rgba(0,0,0,.08)', ink: '#1b1814', muted: '#8A857E', soft: '#F4F0EA', soft2: '#FAF8F5', hub: '#2F2A26', tip: '#1b1814', tipInk: '#FFFFFF', tipMuted: '#b8afa3', title: '#a39b91' },
    dark: { bg: '#121014', card: '#1C191F', line: 'rgba(255,255,255,.09)', ink: '#F1ECE6', muted: '#8A857E', soft: '#262229', soft2: '#221E25', hub: '#EDE6DC', tip: '#F1ECE6', tipInk: '#1C191F', tipMuted: '#6f6860', title: '#6f6860' }
  };
  var ANCH = { avatar: [-1120, -40], hook: [-680, -30], hook_demo: [-760, -480], liaison: [-360, -480], cta: [600, -480], texte_choc: [390, 480], musique: [-730, 510], style_choc: [-420, 610], sous_titre: [-110, 550], reaction: [980, 330] };
  var HUB_POS = { 'M:mcp-claude': [-110, -170], 'M:omni': [200, -260], 'M:image-ia': [420, -40], 'M:motion-control': [200, 190], 'M:express': [-130, 130], 'M:static-ads': [480, 210], 'M:montage-ia': [580, -200], 'M:nettoyage-audio': [-60, -390], 'M:generique': [150, -30] };
  var FMT_POS = { parlee: [-470, 330], muette: [800, 120] };   // formats : une colonne par bande, près de l'ancien carrefour de la maquette
  var COLS_TOP = [['fmt:parlee', 'Format'], ['avatar', 'Avatar'], ['photo', 'Photo'], ['hook', 'Hook'], ['hook_demo', 'Hook démo'], ['liaison', 'Liaison'], ['module', 'Module'], ['demo', 'Démo'], ['cta', 'CTA']];
  var COLS_BOT = [['fmt:muette', 'Format'], ['reaction', 'Réaction'], ['texte_choc', 'Texte choc'], ['demo_muette', 'Démo muette'], ['musique', 'Musique'], ['style_choc', 'Style'], ['sous_titre', 'Sous-titres'], ['transformation', 'Transformation']];
  var VIEWS = [['constellation', 'Constellation', 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4'],
    ['parcours', 'Parcours', 'M4 5v14M12 5v14M20 5v14M4 9l8 6M12 9l8 6'],
    ['orbites', 'Orbites', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22z'],
    ['amas', 'Amas', 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    ['iles', 'Îles', 'M3 17c2-1 4-1 6 0s4 1 6 0 4-1 6 0M6 13c0-3 2-6 5-6s5 2 5 5']];
  var ANIMS = [['flux', 'Flux'], ['fibre', 'Fibre'], ['cometes', 'Comètes'], ['courant', 'Courant'], ['relais', 'A → Z']];
  var SCOL = { 'validée': '#3FA27A', 'refusée': '#E0554B', 'en revue': '#E9AE45', 'publiée': '#FF6B35' };
  var VST = { 'publiée': 0, 'validée': 1, 'en revue': 2, 'refusée': 3 };   // ordre des vidéos sur la carte (refusées en dernier)
  var FILM = 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4';
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var eio = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var h01 = function (s) { var h = 2166136261, str = String(s); for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
  var bz = function (a, b, c, d, t) { var u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  var nat = function (a, b) { return String(a).localeCompare(String(b), 'fr', { numeric: true }); };
  var fmt = function (n) { return Number(n || 0).toLocaleString('fr-FR'); };
  var plw = function (n, s, p) { return Math.abs(n) <= 1 ? s : (p || s + 's'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // médias : seulement nos adresses https (stockage Supabase), sinon rien
  var safeSrc = function (u) { return typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.supabase\.co\//i.test(u) && !/["'<>\s]/.test(u) ? u : null; };
  var safeLink = function (u) { return typeof u === 'string' && /^https:\/\/(www\.)?instagram\.com\//i.test(u) && !/["'<>\s]/.test(u) ? u : null; };
  var ico = function (d, s) { return '<svg width="' + (s || 15) + '" height="' + (s || 15) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>'; };

  function Carte() {
    this.state = { theme: 'light', showTitles: true, vids: false, anim: 'flux', view: null, sel: null, selVid: null, q: '', qOpen: false, vidSort: 'date', vidAll: false, speed: 1, w: 1200 };
    this.cam = { x: 0, y: 0, k: 0.4 }; this.camT = { x: 0, y: 0, k: 0.4 };
    this.W = 0; this.H = 0; this.dirty = true; this.ptrs = new Map(); this.imgs = {};
    this.el = document.createElement('div');
    this.el.className = 'cfc';
    this.el.innerHTML = this.shellHTML();
    this.canvas = this.el.querySelector('.cfc-canvas'); this.area = this.el.querySelector('.cfc-area');
    this.ctx = this.canvas.getContext('2d');
    this.bind();
    this.alive = true;
    var self = this;
    this.loopFn = function () { if (!self.alive) return; self.raf = requestAnimationFrame(self.loopFn); self.tick(performance.now()); };
    this.raf = requestAnimationFrame(this.loopFn);
    this.applyTheme();
    this.renderUI();
  }
  var P = Carte.prototype;

  // ── coquille DOM (barre d'outils, canvas, zoom, panneau) ──
  P.shellHTML = function () {
    return '<div class="cfc-bar">'
      + '<div class="cfc-search"><div class="cfc-q">' + ico('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35') + '<input type="search" class="cfc-qin" placeholder="Rechercher un ID ou un texte (H88, agences…)" aria-label="Rechercher une brique ou une vidéo" autocomplete="off"></div><div class="cfc-res" hidden></div></div>'
      + '<div class="cfc-seg cfc-views" role="group" aria-label="Vue">' + VIEWS.map(function (v) { return '<button type="button" data-cfc="view" data-k="' + v[0] + '">' + ico(v[2], 14) + v[1] + '</button>'; }).join('') + '</div>'
      + '<button type="button" class="cfc-btn cfc-titles" data-cfc="titles" title="Afficher ou cacher les titres"></button>'
      + '<button type="button" class="cfc-btn cfc-vidsbtn" data-cfc="vids" title="Afficher les vidéos déjà assemblées et leurs briques"></button>'
      + '<div class="cfc-seg cfc-anims" role="group" aria-label="Animation des câbles" title="Style d’animation des câbles">' + ANIMS.map(function (a) { return '<button type="button" data-cfc="anim" data-k="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>'
      + '<button type="button" class="cfc-btn cfc-ico cfc-theme" data-cfc="theme" title="Thème clair / sombre"></button>'
      + '<div class="cfc-counts"></div></div>'
      + '<div class="cfc-area"><canvas class="cfc-canvas" role="img" aria-label="Carte des briques"></canvas><div class="cfc-load">Chargement des briques…</div>'
      + '<div class="cfc-zoom"><button type="button" data-cfc="zin" title="Zoomer">' + ico('M12 5v14M5 12h14') + '</button><button type="button" data-cfc="zout" title="Dézoomer">' + ico('M5 12h14') + '</button>'
      + '<button type="button" data-cfc="fit" title="Recentrer">' + ico('M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4M12 12h.01') + '</button></div>'
      + '<aside class="cfc-panel" aria-label="Détail"><div class="cfc-ph"></div><div class="cfc-pb"></div></aside></div>';
  };
  P.bind = function () {
    var self = this, c = this.canvas, qin = this.el.querySelector('.cfc-qin');
    this.ro = new ResizeObserver(function () { requestAnimationFrame(function () { if (self.alive) self.resize(); }); });
    this.ro.observe(this.area);
    this.wheel = function (e) { self.onWheel(e); }; c.addEventListener('wheel', this.wheel, { passive: false });
    c.addEventListener('pointerdown', function (e) { self.onDown(e); }); c.addEventListener('pointermove', function (e) { self.onMove(e); });
    c.addEventListener('pointerup', function (e) { self.onUp(e); }); c.addEventListener('pointercancel', function (e) { self.onUp(e); });
    c.addEventListener('pointerleave', function () { self.mouse = null; self.hoverN = null; self.hoverL = null; self.dirty = true; });
    qin.addEventListener('input', function () { self.setState({ q: qin.value, qOpen: !!qin.value }); });
    qin.addEventListener('focus', function () { if (self.state.q) self.setState({ qOpen: true }); });
    qin.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && self.results && self.results[0]) { e.preventDefault(); self.results[0].go(); }
      if (e.key === 'Escape') self.setState({ qOpen: false });
    });
    this.key = function (e) {
      if (e.key !== 'Escape' || !self.el.isConnected) return;
      if (self.state.qOpen) self.setState({ qOpen: false });
      else if (self.state.sel || self.state.selVid) self.setState({ sel: null, selVid: null });
    };
    window.addEventListener('keydown', this.key);
    this.el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-cfc]') : null;
      if (!b || !self.el.contains(b)) return;
      var a = b.getAttribute('data-cfc'), k = b.getAttribute('data-k');
      if (a === 'view') self.setState({ view: k });
      else if (a === 'anim') self.setState({ anim: k });
      else if (a === 'titles') self.setState({ showTitles: !self.state.showTitles });
      else if (a === 'vids') self.toggleVids();
      else if (a === 'theme') self.setState({ theme: self.state.theme === 'light' ? 'dark' : 'light' });
      else if (a === 'zin') self.zoomBy(1.35);
      else if (a === 'zout') self.zoomBy(1 / 1.35);
      else if (a === 'fit') { self.userCam = false; self.fitTo(null, false); }
      else if (a === 'res') { var r = self.results && self.results[+k]; if (r) r.go(); }
      else if (a === 'node') self.selectNode(k, true);
      else if (a === 'vid') self.selectVid(k);
      else if (a === 'close') self.setState({ sel: null, selVid: null });
      else if (a === 'center') { var n = self.state.sel && self.g && self.g.byId[self.state.sel]; if (n) self.zoomTo(n); }
      else if (a === 'sort') self.setState({ vidSort: k });
      else if (a === 'more') self.setState({ vidAll: true });
      else if (a === 'speed') { self.state.speed = +k; var v = self.el.querySelector('.cfc-pb video'); if (v) v.playbackRate = +k; self.renderUI(true); }
    });
    // clic hors de la recherche : la liste se ferme
    document.addEventListener('pointerdown', this.outside = function (e) { if (self.state.qOpen && !self.el.querySelector('.cfc-search').contains(e.target)) self.setState({ qOpen: false }); });
  };
  P.destroy = function () {
    this.alive = false; cancelAnimationFrame(this.raf); if (this.ro) this.ro.disconnect();
    window.removeEventListener('keydown', this.key); document.removeEventListener('pointerdown', this.outside);
  };
  P.setState = function (patch) {
    var prev = this.state; this.state = Object.assign({}, prev, patch);
    this.afterUpdate(prev);
    this.renderUI();
  };
  P.curView = function () { return this.state.view || (this.state.w < 760 ? 'parcours' : 'constellation'); };
  P.applyTheme = function () {
    var T = TH[this.state.theme], el = this.el;
    [['bg', T.bg], ['card', T.card], ['line', T.line], ['ink', T.ink], ['muted', T.muted], ['soft', T.soft], ['soft2', T.soft2]].forEach(function (x) { el.style.setProperty('--cb-' + x[0], x[1]); });
    el.classList.toggle('is-dark', this.state.theme === 'dark');
  };
  P.setLoading = function (t) { var l = this.el.querySelector('.cfc-load'); l.textContent = t || ''; l.hidden = !t; };
  P.setData = function (d) {
    this.data = d; this.build(d); this.setLoading('');
    if (this.W) this.start();
    this.renderUI();
  };
  P.afterUpdate = function (ps) {
    var s = this.state;
    if (ps.theme !== s.theme) this.applyTheme();
    if (ps.selVid !== s.selVid) {
      var v = s.selVid && this.V ? this.V.byVf[s.selVid] : null;
      this.vidP = v ? { nodes: new Set(v.ids), links: new Set(this.V.vlinks[v.vf]) } : null;
      if (v && this.g) this.fitTo(v.ids.map(function (id) { return this.g.byId[id]; }, this).filter(Boolean), false);
    }
    if (this.g && this.W && this.needStart) this.start();
    if (this.g && !this.needStart && this.appliedView !== this.curView()) this.retarget(this.curView());
    if (this.pendingZoom && this.g) { var n = this.g.byId[this.pendingZoom]; this.pendingZoom = null; if (n) this.zoomTo(n); }
    if ((!!(ps.sel || ps.selVid)) !== (!!(s.sel || s.selVid)) && !this.userCam && !s.sel && !s.selVid) this.fitTo(null, false);
    this.dirty = true;
  };
  // bouton « Vidéos » : on reconstruit le graphe avec ou sans les nœuds vidéo, chaque brique part de sa position actuelle
  // et chaque vidéo sort de sa démo (ou du centre de la vue)
  P.toggleVids = function () {
    this.state.vids = !this.state.vids; this.hoverN = null; this.hoverL = null;
    if (!this.data) { this.renderUI(); return; }
    var old = {}; if (this.g && !this.needStart) this.g.nodes.forEach(function (n) { old[n.id] = [n.x, n.y]; });
    var wasStarted = this.g && !this.needStart && this.W;
    this.build(this.data);
    if (this.state.sel && !this.g.byId[this.state.sel]) this.state.sel = null;
    if (this.state.selVid) { var v = this.V.byVf[this.state.selVid]; this.vidP = v ? { nodes: new Set(v.ids), links: new Set(this.V.vlinks[v.vf]) } : null; }
    if (wasStarted) {
      this.needStart = false; var view = this.curView(), G = this.g; this.targetsFor(view);
      G.nodes.forEach(function (n) {
        var o = old[n.id];
        if (!o && n.kind === 'video') { var dl = G.adj[n.id].filter(function (l) { return l.t.kind === 'demo' || l.t.kind === 'demo_muette'; })[0], src = dl && old[dl.t.id]; o = src || [n.tx, n.ty]; }
        if (!o) o = [n.tx, n.ty];
        n.x = o[0]; n.y = o[1]; n.ap = 1;
      });
      this.retarget(view);
    } else if (this.W) this.start();
    this.renderUI();
  };
  P.resize = function () {
    var r = this.area.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width || !r.height) return;   // onglet caché : rien à mesurer
    var first = !this.W; this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr)); this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    var w = Math.round(this.el.getBoundingClientRect().width);
    if (Math.abs(w - this.state.w) > 2) { this.state.w = w; this.renderUI(); }
    if (this.g && this.needStart) this.start(); else if (this.g && (first || !this.userCam)) this.fitTo(null, true);
    this.dirty = true;
  };

  // ── graphe (maquette : build) ──
  P.build = function (d) {
    var nodes = d.nodes.map(function (n) { return Object.assign({}, n, { fam: famOf(n.kind), hs: 1, x: 0, y: 0, ap: 0 }); });
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var links = d.links.filter(function (l) { return byId[l.source] && byId[l.target]; }).map(function (l) {
      return { type: l.type, s: byId[l.source], t: byId[l.target], ph: h01(l.source + '>' + l.target), sg: h01(l.target + '<' + l.source) < .5 ? -1 : 1 };
    });
    // §5.1 : lien déduit liaison → module (la liaison suit un hook compatible avec ce module)
    var hm = {}; links.forEach(function (l) { if (l.type === 'hook-module') (hm[l.s.id] = hm[l.s.id] || new Set()).add(l.t.id); });
    var lm = {}; links.forEach(function (l) { if (l.type === 'hook-liaison' && hm[l.s.id]) hm[l.s.id].forEach(function (m) { (lm[l.t.id] = lm[l.t.id] || new Set()).add(m); }); });
    Object.keys(lm).forEach(function (lid) { lm[lid].forEach(function (mid) { if (byId[lid] && byId[mid]) links.push({ type: 'liaison-module', s: byId[lid], t: byId[mid], ph: h01(lid + '>' + mid), sg: h01(mid + '<' + lid) < .5 ? -1 : 1 }); }); });
    // bouton « Vidéos » (Axel 27/10 : « voir toutes les vidéos déjà créées et les briques associées ») : un nœud par vidéo assemblée,
    // relié à chaque brique de sa recette et à son format
    if (this.state.vids) (d.videos || []).forEach(function (v) {
      var R = v.recette || {}, id = 'V:' + v.vf, dm = byId[R.contenu], fn = v.fmt && byId['F:' + v.fmt];
      var n = { id: id, kind: 'video', label: [fn ? fn.label : null, v.statut, String(v.date || '').slice(0, 10).split('-').reverse().join('/')].filter(Boolean).join(' · '),
        vf: v.vf, statut: v.statut, mod: dm && dm.module, fmtId: fn ? fn.id : null, views: v.publication ? (+v.publication.vues || 0) : 0, fam: 'video', hs: 1, x: 0, y: 0, ap: 0 };
      nodes.push(n); byId[id] = n;
      var seenB = {};
      Object.keys(R).forEach(function (k) { if (k === 'voice' || k === 'format') return; [].concat(R[k]).forEach(function (b) { if (typeof b === 'string' && byId[b] && !seenB[b]) { seenB[b] = 1; links.push({ type: 'video-brique', s: n, t: byId[b], ph: h01(id + '>' + b), sg: h01(b + '<' + id) < .5 ? -1 : 1 }); } }); });
      if (fn) links.push({ type: 'video-brique', s: n, t: fn, ph: h01(id + '>F'), sg: 1 });
    });
    var adj = {}; nodes.forEach(function (n) { adj[n.id] = []; }); links.forEach(function (l) { adj[l.s.id].push(l); adj[l.t.id].push(l); });
    nodes.forEach(function (n) {
      n.deg = adj[n.id].length;
      n.r = n.kind === 'module' ? 8 + Math.min(8, Math.sqrt(n.deg) * 0.8) : n.kind === 'format' ? 13 : n.kind === 'avatar' ? 10 + Math.min(9, Math.sqrt(n.videos || 0) * 0.5)
        : n.kind === 'video' ? (n.statut === 'refusée' ? 2.6 : 3.4 + Math.min(5, Math.sqrt(n.views) / 25)) : 3.8 + Math.min(11, 1.25 * Math.sqrt(n.videos || 0));
      n.ph = h01(n.id + '#'); n.short = n.kind === 'module' || n.kind === 'format' ? n.label : n.kind === 'video' ? n.vf : n.id;
      n.color = n.kind === 'video' ? SCOL[n.statut] || FAMC.video : FAMC[n.fam]; n.vis = true;
      // brique sans vidéo sur la carte : jamais utilisée, ou seulement dans d'anciennes vidéos (ta voix ou A2, écartées de la carte)
      n.unused = n.fam !== 'hub' && ['avatar', 'photo', 'video'].indexOf(n.kind) < 0 && !n.videos;
    });
    links.forEach(function (l) { l.vis = true; });
    this.g = { nodes: nodes, links: links, byId: byId, adj: adj }; this.regles = d.regles || {};
    var vids = (d.videos || []).map(function (v) {
      var R = v.recette || {}, ids = new Set();
      Object.keys(R).forEach(function (k) { if (k === 'voice' || k === 'format') return; [].concat(R[k]).forEach(function (id) { if (byId[id]) ids.add(id); }); });
      var dm = byId[R.contenu]; if (dm && dm.module && byId['M:' + dm.module]) ids.add('M:' + dm.module);
      if (v.fmt && byId['F:' + v.fmt]) ids.add('F:' + v.fmt);
      if (byId['V:' + v.vf]) ids.add('V:' + v.vf);
      return Object.assign({}, v, { t: Date.parse(String(v.date).replace(' ', 'T')), ids: Array.from(ids), views: v.publication ? (+v.publication.vues || 0) : 0 });
    }).filter(function (v) { return !isNaN(v.t); }).sort(function (a, b) { return a.t - b.t; });
    var vlinks = {}, nodeVids = {}, byVf = {};
    vids.forEach(function (v) {
      var S = new Set(v.ids); vlinks[v.vf] = links.filter(function (l) { return S.has(l.s.id) && S.has(l.t.id); });
      v.ids.forEach(function (id) { (nodeVids[id] = nodeVids[id] || []).push(v); }); byVf[v.vf] = v;
    });
    this.V = { vids: vids, vlinks: vlinks, nodeVids: nodeVids, byVf: byVf };
    this.layoutConst(); this.layoutParc(); this.layoutOrb(); this.layoutClu(); this.layoutIles(); this.needStart = true;
  };
  var vidOrder = function (a, b) { return (VST[a.statut] - VST[b.statut]) || String(a.fmtId || '~').localeCompare(String(b.fmtId || '~')) || nat(a.vf, b.vf); };
  P.layoutConst = function () {
    var G = this.g, ga = Math.PI * (3 - Math.sqrt(5)), placed = new Set();
    var put = function (n, x, y, fixed) { n.cx = x; n.cy = y; n.ax = x; n.ay = y; n.fixed = !!fixed; placed.add(n.id); };
    var spiral = function (list, cx, cy, r0, s) { list.forEach(function (n, i) { var a = i * ga + 0.4, rr = r0 + s * Math.sqrt(i + 0.5); put(n, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9); n.cl0 = [cx, cy]; }); };
    var extra = 0;
    G.nodes.filter(function (n) { return n.kind === 'module'; }).forEach(function (n) { var p = HUB_POS[n.id] || [150 + Math.cos(extra) * 480, -30 + Math.sin(extra++) * 360]; put(n, p[0], p[1], true); n.cl0 = p; });
    ['parlee', 'muette'].forEach(function (bd) {
      var fs = G.nodes.filter(function (n) { return n.kind === 'format' && (n.band || 'parlee') === bd; }), c0 = FMT_POS[bd];
      // une colonne par bande (étiquettes en pilule sous chaque format : jamais l'une sur l'autre)
      fs.forEach(function (n, i) { var p = [c0[0], c0[1] + (i - (fs.length - 1) / 2) * 62]; put(n, p[0], p[1], true); n.cl0 = c0; });
    });
    var avs = G.nodes.filter(function (n) { return n.kind === 'avatar'; }).sort(function (a, b) { return nat(a.id, b.id); });
    avs.forEach(function (a, i) { put(a, ANCH.avatar[0] + (i % 2 ? 46 : -46), ANCH.avatar[1] + (i - (avs.length - 1) / 2) * 170); a.cl0 = ANCH.avatar; });
    avs.forEach(function (a) {
      var ph = G.adj[a.id].filter(function (l) { return l.type === 'avatar-photo'; }).map(function (l) { return l.t; }).sort(function (x, y) { return nat(x.id, y.id); });
      ph.forEach(function (p, j) { var ang = -Math.PI / 2 + (j / Math.max(1, ph.length)) * Math.PI * 2, rr = a.r + 24 + p.r; put(p, a.cx + Math.cos(ang) * rr, a.cy + Math.sin(ang) * rr); p.cl0 = [a.cx, a.cy]; });
    });
    var ORD = { demo: 0, demo_muette: 1, transformation: 2 };
    G.nodes.filter(function (n) { return n.kind === 'module'; }).forEach(function (m) {
      var kids = G.adj[m.id].filter(function (l) { return (l.type === 'demo-module' || l.type === 'transfo-module') && l.t === m; }).map(function (l) { return l.s; }).filter(function (k) { return !placed.has(k.id); });
      kids.sort(function (a, b) { return (ORD[a.kind] - ORD[b.kind]) || ((b.videos || 0) - (a.videos || 0)) || nat(a.id, b.id); });
      spiral(kids, m.cx, m.cy, m.r + 14, 12.5);
    });
    Object.keys(ANCH).forEach(function (k) {
      if (k === 'avatar') return;
      var list = G.nodes.filter(function (n) { return n.kind === k && !placed.has(n.id); }).sort(function (a, b) { return ((b.videos || 0) - (a.videos || 0)) || nat(a.id, b.id); });
      spiral(list, ANCH[k][0], ANCH[k][1], 0, 14.5);
    });
    // vidéos : un tournesol à droite (publiées au centre, refusées au bord) ; hors du calcul de chevauchement (trop nombreuses)
    var vids = G.nodes.filter(function (n) { return n.kind === 'video'; }).sort(vidOrder);
    vids.forEach(function (n, i) { var a = i * ga, rr = 11 * Math.sqrt(i + 0.5); put(n, 1700 + Math.cos(a) * rr, 20 + Math.sin(a) * rr); n.cl0 = [1700, 20]; });
    spiral(G.nodes.filter(function (n) { return !placed.has(n.id); }), 0, 760, 0, 14);
    var Nn = G.nodes.filter(function (n) { return n.kind !== 'video'; });
    for (var it = 0; it < 110; it++) {
      for (var i = 0; i < Nn.length; i++) {
        var a = Nn[i];
        for (var j = i + 1; j < Nn.length; j++) {
          var b = Nn[j], dx = b.cx - a.cx, dy = b.cy - a.cy, mn = a.r + b.r + 5;
          if (Math.abs(dx) > mn || Math.abs(dy) > mn) continue;
          var d2 = dx * dx + dy * dy; if (d2 >= mn * mn) continue;
          var dd = Math.sqrt(d2) || 0.01, push = (mn - dd) / 2, ux = dx / dd, uy = dy / dd;
          if (a.fixed && b.fixed) continue;
          if (a.fixed) { b.cx += ux * push * 2; b.cy += uy * push * 2; } else if (b.fixed) { a.cx -= ux * push * 2; a.cy -= uy * push * 2; } else { a.cx -= ux * push; a.cy -= uy * push; b.cx += ux * push; b.cy += uy * push; }
        }
      }
      Nn.forEach(function (n) { if (!n.fixed) { n.cx += (n.ax - n.cx) * 0.03; n.cy += (n.ay - n.cy) * 0.03; } });
    }
    var titles = [];
    ['avatar', 'hook', 'hook_demo', 'liaison', 'cta', 'texte_choc', 'musique', 'style_choc', 'sous_titre', 'reaction', 'video'].forEach(function (k) {
      var Lst = G.nodes.filter(function (n) { return n.kind === k || (k === 'avatar' && n.kind === 'photo'); }); if (!Lst.length) return;
      var cx = Lst.reduce(function (s, n) { return s + n.cx; }, 0) / Lst.length, my = Math.min.apply(null, Lst.map(function (n) { return n.cy - n.r; }));
      titles.push({ x: cx, y: my - 20, label: (FAML[k] + (k === 'avatar' ? 's & photos' : k === 'musique' || k === 'sous_titre' || k === 'style_choc' ? '' : 's')).toUpperCase(), n: Lst.length });
    });
    var MN = Nn.filter(function (n) { return n.kind === 'module' || ['demo', 'demo_muette', 'transformation'].indexOf(n.kind) >= 0; });
    if (MN.length) titles.push({ x: MN.reduce(function (s, n) { return s + n.cx; }, 0) / MN.length, y: Math.min.apply(null, MN.map(function (n) { return n.cy - n.r; })) - 20, label: 'MODULES & DÉMOS', n: MN.length });
    this.titlesC = titles;
  };
  P.layoutParc = function () {
    var G = this.g, colW = 270, x0 = -((COLS_TOP.length - 1) * colW) / 2, heads = [];
    var midx = function (id) { var i = MOD_ORDER.indexOf(id); return i < 0 ? 99 : i; };
    var minMod = function (n) { return Math.min.apply(null, (n.compatible || ['zz']).map(function (c) { return midx('M:' + c); })); };
    var sorters = {
      photo: function (a, b) { return nat(a.id, b.id); },
      hook: function (a, b) { return (minMod(a) - minMod(b)) || nat(a.id, b.id); },
      liaison: function (a, b) { return ((b.generique ? 1 : 0) - (a.generique ? 1 : 0)) || nat(a.id, b.id); },
      module: function (a, b) { return midx(a.id) - midx(b.id); },
      demo: function (a, b) { return (midx('M:' + a.module) - midx('M:' + b.module)) || nat(a.id, b.id); },
      texte_choc: function (a, b) { return ((b.logos ? 1 : 0) - (a.logos ? 1 : 0)) || (minMod(a) - minMod(b)) || nat(a.id, b.id); }
    };
    sorters.demo_muette = sorters.demo; sorters.transformation = sorters.demo;
    var colOf = function (key) {
      var list = key.indexOf('fmt:') === 0 ? G.nodes.filter(function (n) { return n.kind === 'format' && (n.band || 'parlee') === key.slice(4); })
        : G.nodes.filter(function (n) { return n.kind === key; }).sort(sorters[key] || function (a, b) { return nat(a.id, b.id); });
      var gaps = list.map(function (n) { return n.kind === 'module' || n.kind === 'format' ? 64 : Math.max(11, Math.min(n.r, 9) * 2 + 4); });
      return { list: list, gaps: gaps, tot: gaps.reduce(function (a, b) { return a + b; }, 0) };
    };
    var maxTot = function (cols) { return Math.max.apply(null, cols.map(function (c) { return colOf(c[0]).tot; }).concat([0])); };
    var band = function (cols, cy, bi) {
      var tops = [];
      cols.forEach(function (c, ci) {
        var label = c[1], C = colOf(c[0]), list = C.list, gaps = C.gaps, tot = C.tot;
        var y = cy - tot / 2, x = x0 + ci * colW;
        list.forEach(function (n, i) { n.px = x; n.py = y + gaps[i] / 2; y += gaps[i]; });
        tops.push(cy - tot / 2); heads.push({ x: x, label: label.toUpperCase(), n: list.length, band: bi });
      });
      var hy = Math.min.apply(null, tops) - 44; heads.filter(function (h) { return h.band === bi; }).forEach(function (h) { h.y = hy; });
      return hy;
    };
    // 27/10 : la bande du bas se pose sous la PLUS HAUTE colonne du haut (hooks, hook démo et formats l'ont allongée)
    var h1 = maxTot(COLS_TOP), h2 = maxTot(COLS_BOT), cy1 = -430, cy2 = Math.max(470, cy1 + h1 / 2 + 300 + h2 / 2);
    var t1 = band(COLS_TOP, cy1, 0), t2 = band(COLS_BOT, cy2, 1);
    var vids = G.nodes.filter(function (n) { return n.kind === 'video'; }).sort(vidOrder);
    if (vids.length) {   // grille de vidéos après la colonne CTA (colonne par colonne, dans l'ordre statut → format)
      var rows = Math.max(20, Math.ceil(Math.sqrt(vids.length * 2.2))), gx = 15, gy = 14, vx = x0 + COLS_TOP.length * colW + 20, vy = cy1 - (rows - 1) * gy / 2;
      vids.forEach(function (n, i) { n.px = vx + Math.floor(i / rows) * gx; n.py = vy + (i % rows) * gy; });
      heads.push({ x: vx + (Math.ceil(vids.length / rows) - 1) * gx / 2, y: Math.min(t1, vy - 44), label: 'VIDÉOS', n: vids.length, band: 0 });
    }
    this.headsP = heads;
    this.bandsP = [{ x: x0 - 40, yh: t1, label: 'Vidéo parlée', sub: 'photo → hook → liaison → démo → CTA' }, { x: x0 - 40, yh: t2, label: 'Texte + musique · habillage', sub: 'réaction → texte choc → démo muette + musique' }];
  };
  P.layoutOrb = function () {
    var G = this.g;
    // 27/10 : les 15 formats ont leur propre anneau au centre, assez large pour que leurs noms ne se recouvrent pas
    var RINGS = [['Formats', function (n) { return n.kind === 'format'; }], ['Avatars & photos', function (n) { return n.kind === 'avatar' || n.kind === 'photo'; }], ['Hooks', function (n) { return n.kind === 'hook' || n.kind === 'hook_demo'; }],
      ['Liaisons', function (n) { return n.kind === 'liaison'; }], ['Modules & démos', function (n) { return n.kind === 'module' || ['demo', 'demo_muette', 'transformation'].indexOf(n.kind) >= 0; }],
      ['CTA', function (n) { return n.kind === 'cta'; }], ['Habillage', function (n) { return ['texte_choc', 'style_choc', 'musique', 'sous_titre', 'reaction'].indexOf(n.kind) >= 0; }],
      ['Vidéos', function (n) { return n.kind === 'video'; }]];
    var midx = function (id) { var i = MOD_ORDER.indexOf(id); return i < 0 ? 99 : i; };
    var modOf = function (n) { return n.kind === 'module' ? midx(n.id) : n.module ? midx('M:' + n.module) : Math.min.apply(null, [99].concat((G.adj[n.id] || []).map(function (l) { var o = l.s === n ? l.t : l.s; return o.kind === 'module' ? midx(o.id) : 99; }))); };
    var done = new Set(), titles = [], r = 0;
    RINGS.forEach(function (R, ri) {
      var list = G.nodes.filter(function (n) { return !done.has(n.id) && R[1](n); }); if (!list.length) return; list.forEach(function (n) { done.add(n.id); });
      if (list[0].kind === 'video') list.sort(vidOrder); else list.sort(function (a, b) { return modOf(a) - modOf(b) || FAM_ORDER.indexOf(a.fam) - FAM_ORDER.indexOf(b.fam) || String(a.id).localeCompare(String(b.id)); });
      var wOf = function (n) { return n.kind === 'video' ? 7 : n.kind === 'format' ? 170 : Math.max(16, (n.r || 6) * 2 + 6); }, tot = list.reduce(function (a, n) { return a + wOf(n); }, 0), need = tot / (2 * Math.PI);
      r = ri === 0 ? Math.max(90, need) : Math.max(r + 150, need);
      var acc = 0;
      list.forEach(function (n) { var w = wOf(n), a = -Math.PI / 2 + (acc + w / 2) / tot * 2 * Math.PI; acc += w; var rr = r + (n.kind === 'module' ? -40 : 0); n.ox = Math.cos(a) * rr; n.oy = Math.sin(a) * rr; });
      titles.push({ x: 0, y: -r - 22, label: R[0].toUpperCase(), n: list.length });
    });
    G.nodes.forEach(function (n) { if (n.ox == null) { n.ox = n.cx; n.oy = n.cy; } });
    this.titlesO = titles;
  };
  P.layoutClu = function () {
    var G = this.g, mods = G.nodes.filter(function (n) { return n.kind === 'module'; }).sort(function (a, b) { return MOD_ORDER.indexOf(a.id) - MOD_ORDER.indexOf(b.id); }), home = {};
    G.nodes.forEach(function (n) {
      if (n.kind === 'module') return;
      if (n.kind === 'video') { home[n.id] = n.mod && G.byId['M:' + n.mod] ? 'M:' + n.mod : '__commun'; return; }
      var m = n.module ? G.byId['M:' + n.module] : null;
      if (!m) {
        var cnt = {}; (G.adj[n.id] || []).forEach(function (l) { var o = l.s === n ? l.t : l.s; if (o.kind === 'module') cnt[o.id] = (cnt[o.id] || 0) + 1; });
        var best = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
        if (best && ['hook', 'liaison', 'cta', 'demo', 'demo_muette', 'transformation'].indexOf(n.kind) >= 0) m = G.byId[best];
      }
      home[n.id] = m ? m.id : '__commun';
    });
    var groups = mods.map(function (m) { return [m.id, m.short || m.label]; }).concat([['__commun', 'Commun à tous']]), ga = Math.PI * (3 - Math.sqrt(5)), titles = [];
    // briques en spirale autour du module, vidéos en couronne autour des briques ; la grille s'agrandit avec le plus gros amas
    var parts = groups.map(function (g) {
      var mem = G.nodes.filter(function (n) { return home[n.id] === g[0]; }), br = mem.filter(function (n) { return n.kind !== 'video'; }), vv = mem.filter(function (n) { return n.kind === 'video'; }).sort(vidOrder);
      br.sort(function (a, b) { return FAM_ORDER.indexOf(a.fam) - FAM_ORDER.indexOf(b.fam) || (b.r || 0) - (a.r || 0); });
      var Rb = 34 + 15 * Math.sqrt(br.length + 0.5);
      return { br: br, vv: vv, Rb: Rb, R: vv.length ? Math.sqrt((Rb + 14) * (Rb + 14) + 85 * vv.length) : Rb };
    });
    var Rmax = Math.max.apply(null, parts.map(function (q) { return q.R; }).concat([0]));
    var cols = Math.ceil(Math.sqrt(groups.length * 1.6)), cellW = Math.max(560, 2 * Rmax + 110), cellH = Math.max(520, 2 * Rmax + 90);
    groups.forEach(function (g, gi) {
      var q = parts[gi], cx = (gi % cols - (cols - 1) / 2) * cellW, cy = (Math.floor(gi / cols) - (Math.ceil(groups.length / cols) - 1) / 2) * cellH;
      var hub = G.byId[g[0]]; if (hub) { hub.gx = cx; hub.gy = cy; }
      q.br.forEach(function (n, i) { var a = i * ga, rr = 34 + 15 * Math.sqrt(i + 0.5); n.gx = cx + Math.cos(a) * rr; n.gy = cy + Math.sin(a) * rr; });
      q.vv.forEach(function (n, i) { var a = i * ga, rr = Math.sqrt((q.Rb + 14) * (q.Rb + 14) + 85 * (i + 0.5)); n.gx = cx + Math.cos(a) * rr; n.gy = cy + Math.sin(a) * rr; });
      titles.push({ x: cx, y: cy - q.R - 22, label: String(g[1]).toUpperCase(), n: q.br.length + q.vv.length });
    });
    G.nodes.forEach(function (n) { if (n.gx == null) { n.gx = n.cx; n.gy = n.cy; } });
    this.titlesG = titles;
  };
  P.layoutIles = function () {
    var G = this.g, ga = Math.PI * (3 - Math.sqrt(5));
    var CONT = [
      ['Terres des avatars', function (n) { return n.kind === 'avatar' || n.kind === 'photo'; }, -1050, -120, 1.25, 0.9],
      ['Archipel des hooks', function (n) { return n.kind === 'hook' || n.kind === 'hook_demo'; }, -380, -330, 1.5, 0.75],
      ['Isthme des liaisons', function (n) { return n.kind === 'liaison'; }, -300, 260, 1.6, 0.6],
      ['Continent des modules', function (n) { return n.kind === 'module' || ['demo', 'demo_muette', 'transformation'].indexOf(n.kind) >= 0 || n.fam === 'hub'; }, 260, 40, 1.1, 1.1],
      ['Côte des CTA', function (n) { return n.kind === 'cta'; }, 860, -300, 1.2, 0.85],
      ['Îles de l’habillage', function (n) { return ['texte_choc', 'style_choc', 'musique', 'sous_titre', 'reaction'].indexOf(n.kind) >= 0; }, 900, 420, 1.45, 0.7],
      ['Archipel des vidéos', function (n) { return n.kind === 'video'; }, 1950, 60, 0.9, 1.15, 11]];
    var done = new Set(), titles = [], lands = [];
    CONT.forEach(function (C, ci) {
      var cx = C[2], cy = C[3], ax = C[4], ay = C[5];
      var list = G.nodes.filter(function (n) { return !done.has(n.id) && C[1](n); }).sort(function (a, b) { return (b.kind === 'module') - (a.kind === 'module') || (b.r || 0) - (a.r || 0); });
      if (!list.length) return; list.forEach(function (n) { done.add(n.id); });
      if (list[0].kind === 'video') list.sort(vidOrder);
      var sp = C[6] || 19, pts = [];
      list.forEach(function (n, i) { var a = i * ga + ci, rr = sp * Math.sqrt(i + 0.6), wob = 1 + 0.18 * Math.sin(a * 3 + ci * 1.7) + 0.1 * Math.sin(a * 5 + ci); n.ix = cx + Math.cos(a) * rr * ax * wob; n.iy = cy + Math.sin(a) * rr * ay * wob; pts.push([n.ix, n.iy]); });
      var R = sp * Math.sqrt(list.length + 0.6);
      lands.push({ pts: pts }); titles.push({ x: cx, y: cy - R * ay * 1.18 - 34, label: C[0].toUpperCase(), n: list.length });
    });
    G.nodes.forEach(function (n) { if (n.ix == null) { n.ix = n.cx; n.iy = n.cy; } });
    this.titlesI = titles; this.landsI = lands;
  };
  P.targetsFor = function (view) {
    var K = { parcours: ['px', 'py'], orbites: ['ox', 'oy'], amas: ['gx', 'gy'], iles: ['ix', 'iy'] }[view] || ['cx', 'cy'];
    this.g.nodes.forEach(function (n) { n.tx = n[K[0]]; n.ty = n[K[1]]; });
    this.titlesCur = view === 'orbites' ? this.titlesO : view === 'amas' ? this.titlesG : view === 'iles' ? this.titlesI : this.titlesC;
  };
  P.start = function () {
    if (!this.W) return;
    this.needStart = false; var view = this.curView(); this.appliedView = view; this.targetsFor(view);
    var G = this.g, now = performance.now(), rank = {};
    G.nodes.forEach(function (n) {
      var fi = FAM_ORDER.indexOf(n.fam), ri = rank[n.fam] = (rank[n.fam] || 0) + 1;
      var c = view === 'parcours' ? [n.px, n.py - 60] : view === 'orbites' ? [n.ox * 0.25, n.oy * 0.25] : view === 'amas' ? [n.gx, n.gy - 40] : view === 'iles' ? [n.ix, n.iy - 50] : (n.cl0 || [n.cx, n.cy]);
      n.fx = c[0]; n.fy = c[1]; n.x = n.fx; n.y = n.fy; n.dl = fi * 85 + Math.min(320, ri * 4); n.ap = 0;
    });
    G.links.forEach(function (l) { l.dl = Math.max(l.s.dl, l.t.dl) + 520 + l.ph * 420; });
    this.entry = true; this.t0 = now; this.pv = view === 'parcours' ? 1 : 0; this.pvFrom = this.pv; this.pvTo = this.pv; this.mv = view === 'iles' ? 1 : 0; this.mvFrom = this.mv; this.mvTo = this.mv;
    this.fitTo(null, true);
  };
  P.retarget = function (view) {
    this.appliedView = view; var now = performance.now();
    this.g.nodes.forEach(function (n) { n.fx = n.x; n.fy = n.y; n.dl = h01(n.id) * 140; });
    this.targetsFor(view); this.entry = false; this.t0 = now; this.pvFrom = this.pv; this.pvTo = view === 'parcours' ? 1 : 0; this.mvFrom = this.mv || 0; this.mvTo = view === 'iles' ? 1 : 0;
    this.fitTo(null, false);
  };
  // §5.2 : chemins d'un hook — « vidéos possibles » = Σ démos max(1, liaisons) × CTA du module de la démo
  P.pathFor = function (hid) {
    var G = this.g, h = G.byId[hid]; if (!h) return null;
    var out = function (t) { return G.adj[hid].filter(function (l) { return l.type === t && l.s === h; }); };
    var lL = out('hook-liaison'), lM = out('hook-module');
    var generic = lM.some(function (l) { return l.t.id === 'M:generique'; });
    var demoMods = new Set(G.links.filter(function (l) { return l.type === 'demo-module' && l.s.kind === 'demo'; }).map(function (l) { return l.t.id; }));
    var mods = new Set(lM.map(function (l) { return l.t.id; })); if (generic) demoMods.forEach(function (m) { mods.add(m); });
    var nodes = new Set([hid].concat(lL.map(function (l) { return l.t.id; })).concat(Array.from(mods)));
    G.adj[hid].forEach(function (l) { if (l.type === 'photo-hook' && l.t === h) nodes.add(l.s.id); });
    var demos = [], ctaBy = {};
    mods.forEach(function (m) {
      ctaBy[m] = G.adj[m].filter(function (l) { return l.type === 'module-cta' && l.s.id === m; });
      G.adj[m].forEach(function (l) { if (l.type === 'demo-module' && l.t.id === m && l.s.kind === 'demo') demos.push(l.s); });
    });
    var nL = lL.length, ctas = new Set(), count = 0;
    demos.forEach(function (dn) {
      var ml = G.adj[dn.id].filter(function (l) { return l.type === 'demo-module' && l.s === dn; })[0], m = ml && ml.t, c = m ? ctaBy[m.id].length : 0;
      if (m) ctaBy[m.id].forEach(function (l) { ctas.add(l.t.id); });
      count += Math.max(1, nL) * c;
    });
    var modLabels = Array.from(mods).filter(function (m) { return demoMods.has(m); }).map(function (m) { return G.byId[m].label; });
    return { nL: nL, nD: demos.length, nC: ctas.size, count: count, modLabels: modLabels, generic: generic, nPh: Array.from(nodes).filter(function (id) { return G.byId[id].kind === 'photo'; }).length };
  };
  P.nbr = function (n) { var s = new Set([n.id]); this.g.adj[n.id].forEach(function (l) { if (l.vis) { s.add(l.s.id); s.add(l.t.id); } }); return s; };

  // ── caméra ──
  P.boundsOf = function (list) { var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; list.forEach(function (n) { if (!n) return; x0 = Math.min(x0, n.tx - n.r - 30); x1 = Math.max(x1, n.tx + n.r + 60); y0 = Math.min(y0, n.ty - n.r - 50); y1 = Math.max(y1, n.ty + n.r + 30); }); return [x0, y0, x1, y1]; };
  P.panelW = function () { return (this.state.sel || this.state.selVid) && this.state.w >= 760 ? 352 : 0; };
  P.fitTo = function (list, now) {
    if (!this.g || !this.W) return;
    var Lst = list || this.g.nodes.filter(function (n) { return n.vis; }); if (!Lst.length) return;
    var b = this.boundsOf(Lst), pw = this.panelW(), mob = this.state.w < 760;
    var W = this.W - pw, H = this.H - (mob && this.state.sel ? this.H * 0.45 : 0), pad = mob ? 16 : 40;
    var k = clamp(Math.min((W - pad * 2) / Math.max(1, b[2] - b[0]), (H - pad * 2 - 30) / Math.max(1, b[3] - b[1])), 0.08, 2.2);
    var t = { k: k, x: W / 2 - ((b[0] + b[2]) / 2) * k, y: (H + 30) / 2 - ((b[1] + b[3]) / 2) * k };
    this.camT = t; if (now) this.cam = Object.assign({}, t); this.dirty = true;
  };
  P.zoomTo = function (n) {
    var mob = this.state.w < 760, k = clamp(Math.max(this.camT.k, 1.5), 0.08, 3.2), pw = this.panelW();
    var cx = (this.W - pw) / 2, cy = mob ? this.H * 0.28 : this.H / 2;
    this.camT = { k: k, x: cx - n.tx * k, y: cy - n.ty * k }; this.dirty = true;
  };
  P.zoomBy = function (f) { var k = clamp(this.camT.k * f, 0.08, 6), cx = this.W / 2, cy = this.H / 2, wx = (cx - this.camT.x) / this.camT.k, wy = (cy - this.camT.y) / this.camT.k; this.camT = { k: k, x: cx - wx * k, y: cy - wy * k }; this.dirty = true; };
  P.local = function (e) { var r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  P.onWheel = function (e) {
    e.preventDefault();
    var p = this.local(e), c = this.cam, k = clamp(c.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 0.08, 6), wx = (p.x - c.x) / c.k, wy = (p.y - c.y) / c.k;
    this.cam = { k: k, x: p.x - wx * k, y: p.y - wy * k }; this.camT = Object.assign({}, this.cam); this.userCam = true; this.dirty = true;
  };
  P.onDown = function (e) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch (er) { /* rien */ }
    var p = this.local(e); this.ptrs.set(e.pointerId, p);
    if (this.state.qOpen) this.setState({ qOpen: false });
    if (this.ptrs.size === 1) this.drag = { x: p.x, y: p.y, cx: this.cam.x, cy: this.cam.y, moved: 0 };
    else if (this.ptrs.size === 2) { var ab = Array.from(this.ptrs.values()), a = ab[0], b = ab[1]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: this.cam.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: this.cam.x, cy: this.cam.y }; this.drag = null; }
  };
  P.onMove = function (e) {
    var p = this.local(e);
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
    if (this.pinch && this.ptrs.size === 2) {
      var ab = Array.from(this.ptrs.values()), a = ab[0], b = ab[1], Pn = this.pinch, k = clamp(Pn.k * (Math.hypot(a.x - b.x, a.y - b.y) / Pn.d), 0.08, 6);
      var wx = (Pn.mx - Pn.cx) / Pn.k, wy = (Pn.my - Pn.cy) / Pn.k, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.cam = { k: k, x: mx - wx * k, y: my - wy * k }; this.camT = Object.assign({}, this.cam); this.userCam = true; this.dirty = true; return;
    }
    if (this.drag) {
      var dx = p.x - this.drag.x, dy = p.y - this.drag.y; this.drag.moved = Math.max(this.drag.moved, Math.hypot(dx, dy));
      if (this.drag.moved > 4) { this.cam.x = this.drag.cx + dx; this.cam.y = this.drag.cy + dy; this.camT = Object.assign({}, this.cam); this.userCam = true; this.canvas.style.cursor = 'grabbing'; this.dirty = true; }
      return;
    }
    this.mouse = p; this.mouseDirty = true;
  };
  P.onUp = function (e) {
    var wasDrag = this.drag, single = this.ptrs.size === 1; this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (wasDrag && single && wasDrag.moved <= 4 && e.type === 'pointerup') this.click(this.local(e));
    this.drag = null; this.canvas.style.cursor = this.hoverN ? 'pointer' : 'grab';
  };
  P.hitNode = function (p) {
    var G = this.g, c = this.cam, kN = Math.pow(c.k, 0.75);
    for (var i = G.nodes.length - 1; i >= 0; i--) {
      var n = G.nodes[i]; if (!n.vis || n.ap < 0.5) continue;
      var x = n.x * c.k + c.x, y = n.y * c.k + c.y, r = Math.max(1.6, n.r * kN * n.hs) + 4;
      if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) <= r * r) return n;
    }
    return null;
  };
  // courbe d'un lien : bézier cubique ≈ quadratique décalée de 16 % ; Parcours : tangentes horizontales ; Îles : arcs relevés
  P.cps = function (a, b, x1, y1, x2, y2, sg) {
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, off = 0.16 * sg, qx = mx - dy * off, qy = my + dx * off;
    var c1x = x1 + (qx - x1) * 2 / 3, c1y = y1 + (qy - y1) * 2 / 3, c2x = x2 + (qx - x2) * 2 / 3, c2y = y2 + (qy - y2) * 2 / 3;
    var h = dx * 0.5, p1x = x1 + h, p1y = y1, p2x = x2 - h, p2y = y2, v = this.pv;
    var r = [c1x + (p1x - c1x) * v, c1y + (p1y - c1y) * v, c2x + (p2x - c2x) * v, c2y + (p2y - c2y) * v];
    var m = this.mv || 0;
    if (m > 0.001) { var lift = Math.min(260, Math.hypot(dx, dy) * 0.34), a1x = x1 + dx / 3, a1y = y1 + dy / 3 - lift, a2x = x2 - dx / 3, a2y = y2 - dy / 3 - lift; r = [r[0] + (a1x - r[0]) * m, r[1] + (a1y - r[1]) * m, r[2] + (a2x - r[2]) * m, r[3] + (a2y - r[3]) * m]; }
    return r;
  };
  P.hitLink = function (p) {
    var G = this.g, c = this.cam, best = null, bd = 36;
    for (var li = 0; li < G.links.length; li++) {
      var l = G.links[li]; if (!l.vis) continue;
      var x1 = l.s.x * c.k + c.x, y1 = l.s.y * c.k + c.y, x2 = l.t.x * c.k + c.x, y2 = l.t.y * c.k + c.y;
      if (p.x < Math.min(x1, x2) - 40 || p.x > Math.max(x1, x2) + 40 || p.y < Math.min(y1, y2) - 60 || p.y > Math.max(y1, y2) + 60) continue;
      var q = this.cps(l.s, l.t, x1, y1, x2, y2, l.sg);
      for (var i = 1; i < 12; i++) { var t = i / 12, x = bz(x1, q[0], q[2], x2, t), y = bz(y1, q[1], q[3], y2, t), dd = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y); if (dd < bd) { bd = dd; best = l; } }
    }
    return best;
  };
  P.click = function (p) {
    var n = this.hitNode(p);
    if (!n) { if (this.state.sel || this.state.selVid) this.setState({ sel: null, selVid: null }); return; }
    if (n.kind === 'video') { this.selectVid(n.vf); return; }
    this.setState({ sel: n.id, selVid: null, vidAll: false });
  };
  P.selectNode = function (id, zoom) {
    var n = this.g && this.g.byId[id]; if (!n) return;
    if (zoom) this.pendingZoom = id;
    this.setState({ sel: id, qOpen: false, selVid: null, vidAll: false });
  };
  P.selectVid = function (vf) { this.setState({ selVid: vf, sel: null, qOpen: false }); };

  // ── animation ──
  P.tick = function (now) {
    if (!this.g || !this.W || this.needStart || !this.el.isConnected) return;
    this.step(now);
    this.draw(performance.now()); this.dirty = false;   // les câbles s'animent toujours : rendu continu
  };
  P.step = function (now) {
    var G = this.g, tt = now - this.t0, self = this;
    this._wob = this.pv < 0.5 ? 1.3 : 0;
    this.P = this.vidP || null;
    G.nodes.forEach(function (n) {
      var p = clamp((tt - n.dl) / 900, 0, 1), e = eio(p); n.x = n.fx + (n.tx - n.fx) * e; n.y = n.fy + (n.ty - n.fy) * e;
      n.ap = self.entry ? clamp((tt - n.dl) / 380, 0, 1) : 1;
    });
    var pp = clamp(tt / 900, 0, 1); this.pv = this.pvFrom + (this.pvTo - this.pvFrom) * eio(pp); this.mv = (this.mvFrom || 0) + ((this.mvTo || 0) - (this.mvFrom || 0)) * eio(pp);
    if (this.entry && tt > 2600) this.entry = false;
    var c = this.cam, t = this.camT, dk = t.k - c.k, dx = t.x - c.x, dy = t.y - c.y;
    if (Math.abs(dk) > 1e-4 || Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) { c.k += dk * 0.16; c.x += dx * 0.16; c.y += dy * 0.16; } else { c.k = t.k; c.x = t.x; c.y = t.y; }
    if (this.mouseDirty && this.mouse && !this.drag) {
      this.mouseDirty = false; var hn = this.hitNode(this.mouse), hl = hn ? null : this.hitLink(this.mouse);
      if (hn !== this.hoverN || hl !== this.hoverL) { this.hoverN = hn; this.hoverL = hl; this.canvas.style.cursor = hn ? 'pointer' : 'grab'; }
    }
    var sel = this.state.sel ? G.byId[this.state.sel] : null;
    this.center = this.P ? null : (this.hoverN || sel);
    this.F = this.P ? this.P.nodes : this.center ? this.nbr(this.center) : null;
    var F = this.F, center = this.center, hov = this.hoverN;
    G.nodes.forEach(function (n) { var tg = n === hov ? 1.45 : (n === sel ? 1.25 : (F && center && F.has(n.id) ? 1.1 : 1)); n.hs = Math.abs(tg - n.hs) > 0.005 ? n.hs + (tg - n.hs) * 0.22 : tg; });
  };
  P.img = function (url) {
    var self = this, im = this.imgs[url];
    if (!im) { im = new Image(); im.decoding = 'async'; im.onerror = function () { self.imgs[url] = { complete: false }; }; im.onload = function () { self.dirty = true; }; im.src = url; this.imgs[url] = im; }
    return im.complete && im.naturalWidth ? im : null;
  };
  P.draw = function (now) {
    var self = this, ctx = this.ctx, G = this.g, T = TH[this.state.theme], c = this.cam, W = this.W, H = this.H, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var wob = this._wob || 0;
    var S = function (n) { return [n.x * c.k + c.x + Math.sin(now / 1900 + n.ph * 6.283) * wob, n.y * c.k + c.y + Math.cos(now / 2300 + n.ph * 6.283) * wob]; };
    var kN = Math.pow(c.k, 0.75), tt = now - this.t0, F = this.F, Pp = this.P, center = this.center, dark = this.state.theme === 'dark', showT = this.state.showTitles, fade = 1;
    ctx.lineCap = 'round';
    var tA = 1 - this.pv, tB = this.pv, mvA = this.mv || 0;
    if (mvA > 0.01 && this.landsI) {   // Îles : océan, quadrillage, terres, côtes, hauts-fonds
      var OC = dark ? '#1A1D20' : '#EAEEEF', LAND = dark ? '#2B2722' : '#F3EDE3', COAST = dark ? '#3D3630' : '#DCD1C1';
      ctx.globalAlpha = mvA; ctx.fillStyle = OC; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = dark ? 'rgba(255,255,255,.06)' : 'rgba(40,70,90,.09)'; ctx.lineWidth = 1; ctx.beginPath();
      for (var gy = -900; gy <= 900; gy += 150) { var yy = gy * c.k + c.y; ctx.moveTo(0, yy); ctx.lineTo(W, yy); }
      for (var gx = -1800; gx <= 1800; gx += 200) { ctx.moveTo(gx * c.k + c.x, -900 * c.k + c.y); ctx.quadraticCurveTo((gx * 1.12) * c.k + c.x, c.y, gx * c.k + c.x, 900 * c.k + c.y); }
      ctx.stroke();
      var rad = function (rr, col) { ctx.fillStyle = col; self.landsI.forEach(function (ld) { ctx.beginPath(); ld.pts.forEach(function (pt, i) { var sx = pt[0] * c.k + c.x, sy = pt[1] * c.k + c.y, q = rr * (0.85 + 0.3 * ((i * 37) % 10) / 10) * c.k; ctx.moveTo(sx + q, sy); ctx.arc(sx, sy, q, 0, 6.283); }); ctx.fill(); }); };
      ctx.globalAlpha = mvA; rad(36, COAST); rad(31, LAND);
      ctx.globalAlpha = mvA * 0.5; ctx.strokeStyle = COAST; ctx.setLineDash([3, 5]);
      this.landsI.forEach(function (ld) { ctx.beginPath(); ld.pts.forEach(function (pt, i) { if (i % 7) return; var sx = pt[0] * c.k + c.x, sy = pt[1] * c.k + c.y, q = 50 * c.k; ctx.moveTo(sx + q, sy); ctx.arc(sx, sy, q, 0, 6.283); }); ctx.stroke(); });
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    ctx.font = '600 10px ' + MF; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; try { ctx.letterSpacing = '1.4px'; } catch (e) { /* rien */ }
    if (showT && tA > 0.02 && (this.titlesCur || this.titlesC)) { ctx.fillStyle = T.title; (this.titlesCur || this.titlesC).forEach(function (t) { ctx.globalAlpha = tA * (F ? 0.3 : 0.95) * (self.entry ? clamp(tt / 900, 0, 1) : 1); ctx.fillText(t.label + '  ' + t.n, t.x * c.k + c.x, t.y * c.k + c.y); }); }
    if (showT && tB > 0.02 && this.headsP) {
      ctx.fillStyle = T.title; var colPx = 270 * c.k;
      // en-tête de colonne seulement s'il tient dans la largeur de la colonne (sinon les titres se chevauchent)
      this.headsP.forEach(function (h) { var txt = h.label + '  ' + h.n; if (ctx.measureText(txt).width > colPx - 10) txt = h.label; if (ctx.measureText(txt).width > colPx - 10) return; ctx.globalAlpha = tB * (F ? 0.4 : 1); ctx.fillText(txt, h.x * c.k + c.x, h.y * c.k + c.y); });
      ctx.textAlign = 'left';
      // titre de bande : 18 px au-dessus des en-têtes de colonnes, quel que soit le zoom
      this.bandsP.forEach(function (b) { var by = b.yh * c.k + c.y - 18; ctx.globalAlpha = tB * 0.95; ctx.fillStyle = T.ink; ctx.font = '700 11px ' + MF; ctx.fillText(b.label.toUpperCase(), b.x * c.k + c.x, by); if (colPx > 70) { var w = ctx.measureText(b.label.toUpperCase()).width; ctx.fillStyle = T.muted; ctx.font = '500 10.5px ' + MF; ctx.fillText('  ' + b.sub, b.x * c.k + c.x + w, by); } });
    }
    try { ctx.letterSpacing = '0px'; } catch (e) { /* rien */ }
    var hl = function (l) { return Pp ? Pp.links.has(l) : center ? (l.s === center || l.t === center) : false; };
    var groups = {}, hot = [];
    G.links.forEach(function (l) {
      if (!l.vis || l.s.ap <= 0.02 || l.t.ap <= 0.02) return;
      var pr = self.entry ? clamp((tt - l.dl) / 650, 0, 1) : 1; if (pr <= 0) return;
      if (hl(l)) hot.push([l, pr]); else { var key = l.type + '|' + (l.type === 'video-brique' ? FAMC.video : l.s.fam === 'hub' ? l.t.color : l.s.color); (groups[key] = groups[key] || []).push([l, pr]); }
    });
    var off = function (x1, y1, x2, y2) { return Math.max(x1, x2) < -50 || Math.min(x1, x2) > W + 50 || Math.max(y1, y2) < -50 || Math.min(y1, y2) > H + 50; };
    var path = function (l, pr) {
      var a1 = S(l.s), a2 = S(l.t), x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1];
      if (off(x1, y1, x2, y2)) return;
      var q = self.cps(l.s, l.t, x1, y1, x2, y2, l.sg), a = q[0], b = q[1], cc = q[2], d = q[3];
      ctx.moveTo(x1, y1);
      if (pr >= 1) { ctx.bezierCurveTo(a, b, cc, d, x2, y2); return; }
      var t = pr, ab = [x1 + (a - x1) * t, y1 + (b - y1) * t], bc = [a + (cc - a) * t, b + (d - b) * t], cd = [cc + (x2 - cc) * t, d + (y2 - d) * t];
      var abc = [ab[0] + (bc[0] - ab[0]) * t, ab[1] + (bc[1] - ab[1]) * t], bcd = [bc[0] + (cd[0] - bc[0]) * t, bc[1] + (cd[1] - bc[1]) * t];
      var e = [abc[0] + (bcd[0] - abc[0]) * t, abc[1] + (bcd[1] - abc[1]) * t];
      ctx.bezierCurveTo(ab[0], ab[1], abc[0], abc[1], e[0], e[1]);
    };
    var lwS = clamp(Math.pow(c.k, 0.4), 0.55, 1.7), dimK = Pp ? 1 : center ? fade : 0;
    var TI = { 'hook-liaison': 0, 'hook-module': 1, 'choc-module': 2, 'format': 3, 'habillage': 4, 'liaison-module': 1 }, st = this.state.anim || 'flux', TAU = 6.283;
    Object.keys(groups).forEach(function (key) {
      var arr = groups[key], sp = key.split('|'), type = sp[0], col = sp[1], baseA = (IDLE_A[type] || 0.15) * (dark ? 1.25 : 1.1), lw = (LT[type] ? LT[type][1] : 0.6) * lwS;
      ctx.setLineDash([]); ctx.strokeStyle = col; ctx.globalAlpha = baseA + (0.028 - baseA) * dimK; ctx.lineWidth = lw;
      ctx.beginPath(); arr.forEach(function (x) { path(x[0], x[1]); }); if (st !== 'relais' || type === 'video-brique') ctx.stroke();
      var vis = 1 - 0.9 * dimK;
      if (type === 'video-brique') {
        ctx.setLineDash([3, 13]); ctx.lineDashOffset = -((now / 24) % 16); ctx.globalAlpha = 0.07 * vis; ctx.lineWidth = lw * 1.3 + 0.3; ctx.stroke(); ctx.setLineDash([]); return;
      }
      if (st === 'courant') {
        ctx.setLineDash([]); ctx.strokeStyle = col; ctx.globalAlpha = Math.min(0.5, baseA * 1.6) * vis; ctx.lineWidth = lw * 2.6 + 1.2; ctx.stroke();
        var fl = 0.7 + 0.3 * Math.abs(Math.sin(now / 160 + (TI[type] || 0) * 1.3));
        ctx.setLineDash([5, 55]); ctx.lineDashOffset = -((now / 10 + (TI[type] || 0) * 13) % 60); ctx.strokeStyle = dark ? '#fff' : col; ctx.globalAlpha = Math.min(1, baseA * 4 + 0.35) * vis * fl; ctx.lineWidth = lw * 1.1 + 1.3; ctx.stroke(); ctx.setLineDash([]); return;
      }
      if (st === 'relais') {   // A → Z : pas de câble fixe, des traits lumineux toujours de gauche à droite
        var PER = 150, pos = now / 7 + (TI[type] || 0) * 23, A0 = Math.min(1, baseA * 4 + 0.4) * vis;
        ctx.beginPath();
        arr.forEach(function (x) {
          var l = x[0], a1 = S(l.s), a2 = S(l.t), x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1]; if (off(x1, y1, x2, y2)) return;
          var q = self.cps(l.s, l.t, x1, y1, x2, y2, l.sg);
          if (x1 <= x2) { ctx.moveTo(x1, y1); ctx.bezierCurveTo(q[0], q[1], q[2], q[3], x2, y2); } else { ctx.moveTo(x2, y2); ctx.bezierCurveTo(q[2], q[3], q[0], q[1], x1, y1); }
        });
        [[96, 0.1, lw * 2.4 + 2.6], [60, 0.24, lw * 1.9 + 1.8], [30, 0.55, lw * 1.5 + 1.3], [9, 1, lw * 1.2 + 1.5]].forEach(function (z, qi) {
          ctx.setLineDash([z[0], PER - z[0]]); ctx.lineDashOffset = z[0] - (pos % PER); ctx.strokeStyle = qi === 3 && dark ? '#fff' : col; ctx.globalAlpha = A0 * z[1]; ctx.lineWidth = z[2]; ctx.stroke();
        });
        ctx.setLineDash([]); ctx.globalAlpha = 1; return;
      }
      var aK = Math.min(1, baseA * 3 + 0.2) * vis; if (aK < 0.03) return;
      if (dark || st === 'fibre' || st === 'cometes') ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      if (st === 'fibre') {
        ctx.setLineDash([]); ctx.strokeStyle = col; ctx.globalAlpha = aK * 0.35; ctx.lineWidth = lw * 1.2 + 0.3; ctx.stroke();
        var tips = [];
        arr.forEach(function (x) { var l = x[0], a2 = S(l.t); if (a2[0] < -20 || a2[0] > W + 20 || a2[1] < -20 || a2[1] > H + 20) return; tips.push([a2[0], a2[1], 0.5 + 0.5 * Math.sin(now / 650 + l.ph * TAU * 3)]); });
        ctx.fillStyle = col; tips.forEach(function (p) { ctx.globalAlpha = aK * 0.22 * p[2]; ctx.beginPath(); ctx.arc(p[0], p[1], 5.5 + 3 * p[2], 0, TAU); ctx.fill(); });
        ctx.fillStyle = dark ? '#fff' : col; tips.forEach(function (p) { ctx.globalAlpha = aK * (0.45 + 0.55 * p[2]); ctx.beginPath(); ctx.arc(p[0], p[1], 1.4 + 1.1 * p[2], 0, TAU); ctx.fill(); });
      } else if (st === 'cometes') {
        ctx.setLineDash([]); ctx.strokeStyle = col; ctx.globalAlpha = aK * 0.18; ctx.lineWidth = lw; ctx.stroke();
        arr.forEach(function (x) {
          var l = x[0], pr = x[1], a1 = S(l.s), a2 = S(l.t), x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1]; if (off(x1, y1, x2, y2)) return;
          var q = self.cps(l.s, l.t, x1, y1, x2, y2, l.sg), per = 2600 + l.ph * 2600, h0 = ((now + l.ph * per * 7) % (per * 1.6)) / per; if (h0 > Math.min(1, pr)) return;
          for (var k = 0; k < 9; k++) { var t = h0 - k * 0.022; if (t < 0) break; var px = bz(x1, q[0], q[2], x2, t), py = bz(y1, q[1], q[3], y2, t), f = 1 - k / 9; ctx.fillStyle = k ? col : (dark ? '#fff' : col); ctx.globalAlpha = aK * (k ? 0.55 * f * f : 1); ctx.beginPath(); ctx.arc(px, py, (k ? 1.1 + 1.6 * f : 2.6) * Math.max(0.8, lw * 0.9), 0, TAU); ctx.fill(); }
          var hx = bz(x1, q[0], q[2], x2, h0), hy = bz(y1, q[1], q[3], y2, h0); ctx.fillStyle = col; ctx.globalAlpha = aK * 0.25; ctx.beginPath(); ctx.arc(hx, hy, 7, 0, TAU); ctx.fill();
        });
      } else {   // Flux
        arr.forEach(function (x) {
          var l = x[0], pr = x[1], a1 = S(l.s), a2 = S(l.t); if (off(a1[0], a1[1], a2[0], a2[1])) return;
          ctx.setLineDash([7, 9]); ctx.lineDashOffset = -((now / (14 + (TI[type] || 0) * 3) + l.ph * 40) % 16);
          ctx.beginPath(); path(l, pr); ctx.strokeStyle = col; ctx.globalAlpha = aK * 0.55; ctx.lineWidth = lw * 1.6 + 0.6; ctx.stroke();
        });
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]);
    });
    ctx.setLineDash([]);
    var pts = [];
    hot.forEach(function (x) {
      var l = x[0], pr = x[1]; if (pr <= 0) return;
      var col = Pp ? ACC : (l.s === center ? (l.t.fam === 'hub' ? l.s.color : l.t.color) : (l.s.fam === 'hub' ? l.t.color : l.s.color)) || ACC, lw = (LT[l.type] ? LT[l.type][1] : 0.6) * lwS * 1.9 + (Pp ? 0.4 : 0);
      ctx.shadowColor = col; ctx.shadowBlur = dark ? 12 : 5; ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); path(l, pr); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.setLineDash([6, 10]); ctx.lineDashOffset = -((now / 16) % 16); ctx.globalAlpha = dark ? 0.85 : 0.75; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(0.8, lw * 0.55); ctx.stroke(); ctx.setLineDash([]);
      if (pr >= 1) pts.push([l, col]);
    });
    ctx.shadowBlur = 0;
    if (pts.length) {
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      var lim = pts.length > 400 ? 1 : 2;
      pts.forEach(function (x, idx) {
        if (idx > 600) return;
        var l = x[0], col = x[1], rev = Pp && l.type === 'demo-module', a1 = S(l.s), a2 = S(l.t), q = self.cps(l.s, l.t, a1[0], a1[1], a2[0], a2[1], l.sg);
        for (var j = 0; j < lim; j++) {
          var t = ((now / 1700) + l.ph + j / lim) % 1; if (rev) t = 1 - t;
          var px = bz(a1[0], q[0], q[2], a2[0], t), py = bz(a1[1], q[1], q[3], a2[1], t);
          ctx.globalAlpha = 0.22; ctx.fillStyle = Pp ? ACC2 : col; ctx.beginPath(); ctx.arc(px, py, 4.2, 0, 6.283); ctx.fill();
          ctx.globalAlpha = 0.95; ctx.fillStyle = dark ? '#fff' : (Pp ? ACC : col); ctx.beginPath(); ctx.arc(px, py, 1.7, 0, 6.283); ctx.fill();
        }
      });
      ctx.globalCompositeOperation = 'source-over';
    }
    var sel = this.state.sel, order = F ? G.nodes.filter(function (n) { return !F.has(n.id); }).concat(G.nodes.filter(function (n) { return F.has(n.id); })) : G.nodes;
    var labels = [];
    order.forEach(function (n) {
      if (!n.vis || n.ap <= 0) return;
      var p = S(n), x = p[0], y = p[1], rs = Math.max(1.5, n.r * kN * n.hs * (self.entry ? 0.4 + 0.6 * n.ap : 1));
      if (x < -rs - 60 || x > W + rs + 60 || y < -rs - 30 || y > H + rs + 30) return;
      var inF = !F || F.has(n.id), al = n.ap * (inF ? 1 : 0.15) * (n.unused && !(F && inF && center) ? 0.45 : 1), hub = n.fam === 'hub';
      ctx.globalAlpha = al;
      if (F && inF && center) { ctx.shadowColor = hub ? (dark ? '#fff' : T.hub) : n.color; ctx.shadowBlur = dark ? 16 : 8; }
      ctx.fillStyle = hub ? T.hub : n.color; ctx.beginPath(); ctx.arc(x, y, rs, 0, 6.283); ctx.fill(); ctx.shadowBlur = 0;
      var im = n.image && rs >= 7 && (n.kind === 'avatar' || n.kind === 'photo') ? self.img(n.image) : null;
      if (im) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, rs - 1.2, 0, 6.283); ctx.clip(); var s = Math.max((rs * 2) / im.naturalWidth, (rs * 2) / im.naturalHeight); ctx.drawImage(im, x - im.naturalWidth * s / 2, y - im.naturalHeight * s / 2, im.naturalWidth * s, im.naturalHeight * s); ctx.restore(); }
      ctx.lineWidth = hub ? 2 : 1.1; ctx.strokeStyle = T.card; ctx.beginPath(); ctx.arc(x, y, rs, 0, 6.283); ctx.stroke();
      if (hub) { ctx.globalAlpha = al * 0.35; ctx.strokeStyle = T.hub; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rs + 3.5, 0, 6.283); ctx.stroke(); if (n.kind === 'format') { ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y, rs + 7, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); } ctx.globalAlpha = al; }
      if (n.status === 'ancienne') { ctx.setLineDash([2, 3]); ctx.strokeStyle = n.color || T.muted; ctx.globalAlpha = Math.min(1, al) * 0.55; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rs + 2.6, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      if (n.unused) { ctx.setLineDash([1.5, 2.5]); ctx.strokeStyle = T.muted; ctx.globalAlpha = Math.min(1, al * 1.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rs + 2.4, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = al; }
      if (n.status === 'draft') { ctx.setLineDash([3, 3]); ctx.strokeStyle = T.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, rs + 3, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
      if (n.logos) { var brr = Math.max(4.5, rs * 0.42), bx = x + rs * 0.78, by = y - rs * 0.78, qq = brr * 0.36; ctx.fillStyle = ACC; ctx.beginPath(); ctx.arc(bx, by, brr, 0, 6.283); ctx.fill(); ctx.strokeStyle = T.card; ctx.lineWidth = 1.2; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect(bx - qq - qq * 0.25, by - qq - qq * 0.25, qq, qq); ctx.fillRect(bx + qq * 0.25, by - qq - qq * 0.25, qq, qq); ctx.fillRect(bx - qq - qq * 0.25, by + qq * 0.25, qq, qq); ctx.fillRect(bx + qq * 0.25, by + qq * 0.25, qq, qq); }
      if (n === center) { var pu = (now % 1500) / 1500; ctx.globalAlpha = (1 - pu) * 0.7; ctx.strokeStyle = hub ? T.hub : n.color; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, rs + 3 + pu * 20, 0, 6.283); ctx.stroke(); ctx.globalAlpha = al; }
      if (n.id === sel) { ctx.globalAlpha = 1; ctx.strokeStyle = ACC; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, rs + 4, 0, 6.283); ctx.stroke(); }
      var parc = self.pv > 0.5;
      if (hub) { if (showT || (F && inF && (center || F.size <= 40))) labels.push([n, x, y, rs, al, true]); }
      else if (parc ? (n === self.hoverN || n === center || (F && inF && (center ? F.size <= 60 : F.size <= 30))) : ((F && inF && (F.size <= 70 || n === center)) || rs >= 9.5 || n === self.hoverN)) labels.push([n, x, y, rs, al, false]);
    });
    // 27/10 : une étiquette qui en recouvrirait une autre n'est pas dessinée (survol et sélection d'abord, puis modules, puis formats)
    var rank = function (z) { var n = z[0]; return n === self.hoverN || n === center || n.id === sel ? 0 : self.F && self.F.has(n.id) ? 1 : n.kind === 'module' ? 2 : n.kind === 'format' ? 3 : 4; };
    labels.sort(function (a, b) { return rank(a) - rank(b); });
    var boxes = [], free = function (x0, y0, w, h) {
      for (var i = 0; i < boxes.length; i++) { var q = boxes[i]; if (x0 < q[0] + q[2] && x0 + w > q[0] && y0 < q[1] + q[3] && y0 + h > q[1]) return false; }
      boxes.push([x0, y0, w, h]); return true;
    };
    labels.forEach(function (z) {
      var n = z[0], x = z[1], y = z[2], rs = z[3], al = z[4], hub = z[5];
      if (hub && self.pv > 0.5) {   // Parcours : nom à gauche du carrefour (module ou format)
        ctx.font = '650 10.5px ' + SF; var tw = ctx.measureText(n.short).width; if (!free(x - rs - 7 - tw, y - 7, tw, 14)) return;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.globalAlpha = Math.max(0.35, al); ctx.fillStyle = T.ink; ctx.fillText(n.short, x - rs - 7, y);
      } else if (hub) {
        ctx.font = '650 11px ' + SF; var txt = n.short, w = ctx.measureText(txt).width + 14, yy = y + rs + (n.kind === 'format' ? 11 : 6);
        if (!free(x - w / 2, yy, w, 19)) return;
        ctx.globalAlpha = Math.max(0.35, al); ctx.fillStyle = T.card; ctx.strokeStyle = T.line; ctx.lineWidth = 1;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, yy, w, 19, 9.5); else ctx.rect(x - w / 2, yy, w, 19); ctx.fill(); ctx.stroke();
        ctx.fillStyle = T.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, yy + 10);
      } else {
        ctx.font = '500 10px ' + MF; if (!free(x + rs + 4, y - 6, ctx.measureText(n.short).width, 12)) return;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.globalAlpha = al;
        ctx.fillStyle = self.F && self.F.has(n.id) ? T.ink : T.muted; ctx.fillText(n.short, x + rs + 4, y);
      }
    });
    ctx.textBaseline = 'alphabetic';
    if (this.mouse && (this.hoverN || this.hoverL)) this.tooltip(ctx, T, this.hoverN, this.hoverL, this.mouse);
  };
  P.wrap = function (ctx, text, maxW, maxL) {
    var words = String(text || '').split(/\s+/), out = [], line = '';
    for (var i = 0; i < words.length; i++) { var t = line ? line + ' ' + words[i] : words[i]; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = words[i]; if (out.length === maxL) break; } else line = t; }
    if (out.length < maxL && line) out.push(line); else if (out.length === maxL && line) out[maxL - 1] = out[maxL - 1].replace(/[\s,.;:]*$/, '') + '…';
    return out;
  };
  P.tooltip = function (ctx, T, n, l, m) {
    var lines = [], self = this;
    if (n) {
      lines.push(['700 12px ' + MF, T.tipInk, n.short + '   ' + (KIND_LBL[n.kind] || '').toUpperCase()]);
      if (n.kind !== 'module') { ctx.font = '400 12px ' + SF; this.wrap(ctx, n.label, 260, 3).forEach(function (t) { lines.push(['400 12px ' + SF, T.tipInk, t]); }); }
      if (n.kind === 'video') lines.push(['400 10.5px ' + MF, T.tipMuted, [(n.deg - (n.fmtId ? 1 : 0)) + ' ' + plw(n.deg, 'brique'), n.views ? fmt(n.views) + ' vues' : 'non publiée', 'clique pour la voir'].join(' · ')]);
      else lines.push(['400 10.5px ' + MF, T.tipMuted, [n.videos ? fmt(n.videos) + ' ' + plw(n.videos, 'vidéo produite', 'vidéos produites') : null, n.deg + ' ' + plw(n.deg, 'lien'), n.keyword ? 'mot-clé ' + n.keyword : null].filter(Boolean).join(' · ')]);
      if (n.unused) lines.push(['600 10.5px ' + MF, T.tipMuted, n.anciennes ? 'plus utilisée · ' + fmt(n.anciennes) + ' ' + plw(n.anciennes, 'ancienne vidéo', 'anciennes vidéos') + ' (ta voix ou A2)' : 'jamais utilisée dans une vidéo']);
    } else if (l) {
      lines.push(['700 12px ' + SF, T.tipInk, (LT[l.type] || [l.type])[0]]);
      lines.push(['400 10.5px ' + MF, T.tipMuted, l.s.short + ' → ' + l.t.short]);
      ctx.font = '400 11.5px ' + SF; this.wrap(ctx, this.regles[l.type] || '', 260, 4).forEach(function (t) { lines.push(['400 11.5px ' + SF, T.tipInk, t]); });
    }
    var w = 0; lines.forEach(function (z) { ctx.font = z[0]; w = Math.max(w, ctx.measureText(z[2]).width); });
    var bw = w + 22, bh = lines.length * 17 + 14, x = m.x + 16, y = m.y + 16;
    if (x + bw > self.W - 8) x = m.x - bw - 12; if (y + bh > self.H - 8) y = m.y - bh - 12;
    ctx.globalAlpha = 0.96; ctx.fillStyle = T.tip; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 10); else ctx.rect(x, y, bw, bh); ctx.fill(); ctx.globalAlpha = 1;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; lines.forEach(function (z, i) { ctx.font = z[0]; ctx.fillStyle = z[1]; ctx.fillText(z[2], x + 11, y + 14 + i * 17); });
  };

  // ── interface (barre, recherche, panneau) ──
  P.renderUI = function (keepPanel) {
    var s = this.state, G = this.g, T = TH[s.theme], view = this.curView(), self = this, el = this.el;
    el.querySelectorAll('[data-cfc="view"]').forEach(function (b) { var on = b.getAttribute('data-k') === view; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
    el.querySelectorAll('[data-cfc="anim"]').forEach(function (b) { var on = b.getAttribute('data-k') === s.anim; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
    var tb = el.querySelector('.cfc-titles');
    tb.innerHTML = (s.showTitles ? ico('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z')
      : ico('M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2')) + 'Titres';
    tb.classList.toggle('is-off', !s.showTitles);
    var vb = el.querySelector('.cfc-vidsbtn'), nv = this.data && this.data.videos ? this.data.videos.length : 0;
    vb.innerHTML = ico(FILM) + 'Vidéos' + (nv ? '<em>' + fmt(nv) + '</em>' : ''); vb.classList.toggle('is-on', !!s.vids); vb.classList.toggle('is-off', !s.vids); vb.setAttribute('aria-pressed', !!s.vids);
    el.querySelector('.cfc-theme').innerHTML = s.theme === 'light' ? ico('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', 16)
      : ico('M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4', 16);
    el.querySelector('.cfc-counts').textContent = G ? fmt(G.nodes.length) + ' ' + plw(G.nodes.length, 'nœud') + ' · ' + fmt(G.links.length) + ' ' + plw(G.links.length, 'lien') + ' ' + plw(G.links.length, 'visible') : '';
    // recherche : ID exact, début d'ID, ID qui contient, puis texte ; « vf… » cherche dans les vidéos
    var qq = norm(s.q).trim(), res = [];
    if (G && qq) {
      if (this.V && /^vf/.test(qq)) res = this.V.vids.filter(function (v) { return norm(v.vf).indexOf(qq) >= 0; }).slice(0, 7).map(function (v) {
        return { id: v.vf, fam: 'Vidéo', snippet: v.statut + (v.publication ? ' · ' + fmt(v.views) + ' vues · @' + v.publication.compte : ' · non publiée'), color: SCOL[v.statut] || T.muted, go: function () { self.el.querySelector('.cfc-qin').value = ''; self.state.q = ''; self.selectVid(v.vf); } };
      });
      else res = G.nodes.filter(function (n) { return n.kind !== 'video'; }).map(function (n) { var id = norm(n.id), lb = norm(n.label), sc = id === qq ? 0 : id.indexOf(qq) === 0 ? 1 : id.indexOf(qq) >= 0 ? 2 : lb.indexOf(qq) >= 0 ? 3 : 9; return [sc, n]; })
        .filter(function (x) { return x[0] < 9; }).sort(function (a, b) { return a[0] - b[0] || nat(a[1].id, b[1].id); }).slice(0, 7)
        .map(function (x) { var n = x[1]; return { id: n.short, fam: KIND_LBL[n.kind] || n.kind, snippet: n.label, color: n.fam === 'hub' ? T.hub : n.color, go: function () { self.selectNode(n.id, true); } }; });
    }
    this.results = res;
    var box = el.querySelector('.cfc-res');
    box.hidden = !(s.qOpen && qq);
    box.innerHTML = res.length ? res.map(function (r, i) {
      return '<button type="button" data-cfc="res" data-k="' + i + '"><i style="background:' + r.color + '"></i><span><span><b>' + esc(r.id) + '</b><em>' + esc(r.fam) + '</em></span><span class="cfc-snip">' + esc(r.snippet) + '</span></span></button>';
    }).join('') : '<div class="cfc-none">Aucune brique ne correspond.</div>';
    // panneau
    var n = G && s.sel ? G.byId[s.sel] : null, v = s.selVid && this.V ? this.V.byVf[s.selVid] : null, open = !!n || !!v;
    var panel = el.querySelector('.cfc-panel');
    panel.classList.toggle('is-open', open);
    el.classList.toggle('is-panel', open);
    var key = open ? (v ? 'v:' + v.vf : 'n:' + n.id) + '|' + s.vidSort + '|' + s.vidAll + '|' + s.theme : '';
    if (keepPanel || key === this.panelKey) {
      el.querySelectorAll('.cfc-pb [data-cfc="speed"]').forEach(function (b) { b.classList.toggle('is-on', +b.getAttribute('data-k') === s.speed); });
      return;
    }
    this.panelKey = key;
    if (!open) return;
    var hd = v ? this.vidHead(v, T) : this.nodeHead(n, T);
    panel.querySelector('.cfc-ph').innerHTML = hd + '<button type="button" class="cfc-pbtn" data-cfc="center" title="Centrer sur la carte"' + (v ? ' hidden' : '') + '>' + ico('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 14) + '</button>'
      + '<button type="button" class="cfc-pbtn" data-cfc="close" title="Fermer">' + ico('M18 6 6 18M6 6l12 12', 14) + '</button>';
    panel.querySelector('.cfc-pb').innerHTML = v ? this.vidBody(v, T) : this.nodeBody(n, T);
    panel.querySelector('.cfc-pb').scrollTop = 0;
    var vid = panel.querySelector('.cfc-pb video'); if (vid) vid.playbackRate = s.speed;
  };
  var pill = function (txt, bg, fg) { return '<span class="cfc-st" style="background:' + bg + ';color:' + fg + '">' + esc(txt) + '</span>'; };
  var speedsHTML = function (s) {
    return '<div class="cfc-speeds"><span>vitesse de l’aperçu</span>' + [0.9, 1, 1.1, 1.25].map(function (x) { return '<button type="button" data-cfc="speed" data-k="' + x + '" class="' + (s.speed === x ? 'is-on' : '') + '">x' + x.toFixed(2).replace('.', ',') + '</button>'; }).join('') + '</div>';
  };
  var statsHTML = function (L) { return '<div class="cfc-stats">' + L.map(function (x) { return '<div><b>' + esc(x.value) + '</b><span>' + esc(x.label) + '</span></div>'; }).join('') + '</div>'; };
  var chip = function (id, label, color, title, act) { return '<button type="button" class="cfc-chip" data-cfc="' + (act || 'node') + '" data-k="' + esc(id) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '><i style="background:' + color + '"></i>' + esc(label) + '</button>'; };
  P.nodeHead = function (n, T) {
    var ST = { ready: ['prêt', 'oklch(0.94 0.05 155)', 'oklch(0.42 0.1 155)'], draft: ['brouillon', 'oklch(0.95 0.06 85)', 'oklch(0.45 0.1 70)'], retired: ['retiré', T.soft, T.muted], ancienne: ['ancienne photo · utilisable', T.soft, T.ink] };
    var st = n.fam === 'hub' ? ['carrefour', T.soft, T.muted] : ST[n.status] || ['—', T.soft, T.muted];
    return '<i class="cfc-dot" style="background:' + (n.fam === 'hub' ? T.hub : n.color) + '"></i><span class="cfc-fam">' + esc(KIND_LBL[n.kind] || n.kind) + '</span>' + pill(st[0], st[1], st[2]);
  };
  P.nodeBody = function (n, T) {
    var G = this.g, s = this.state, h = '';
    h += '<div class="cfc-id">' + esc(n.fam === 'hub' ? n.short : n.id) + '</div>' + (n.kind === 'format' ? '<div class="cfc-short">' + esc((n.famille || '') + (n.statutFmt && n.statutFmt !== 'actif' ? ' · ' + (n.statutFmt === 'test' ? 'en test' : 'arrêté') : '')) + '</div>' : '');
    var textKinds = ['hook', 'hook_demo', 'liaison', 'cta', 'texte_choc', 'reaction', 'demo', 'demo_muette', 'transformation', 'musique', 'sous_titre', 'style_choc', 'photo', 'avatar'];
    if (textKinds.indexOf(n.kind) >= 0 && n.label && n.label !== n.id) h += '<div class="cfc-text">' + esc(['hook', 'liaison', 'cta', 'texte_choc'].indexOf(n.kind) >= 0 ? '« ' + n.label + ' »' : n.label) + '</div>';
    var badges = [];
    if (n.keyword) badges.push(['mot-clé · ' + n.keyword, 'rgba(169,127,209,.16)', '#7c4fae']);
    if (n.logos) badges.push(['texte à logos', 'rgba(255,107,53,.12)', '#e5541f']);
    if (n.generique) badges.push(['liaison générique', T.soft, T.ink]);
    if (n.unused) badges.push([n.anciennes ? 'plus utilisée · ' + fmt(n.anciennes) + ' ' + plw(n.anciennes, 'ancienne vidéo', 'anciennes vidéos') + ' avec ta voix ou A2' : 'jamais utilisée dans une vidéo', T.soft, T.muted]);
    if (n.module && G.byId['M:' + n.module]) badges.push(['module · ' + G.byId['M:' + n.module].label, T.soft, T.ink]);
    (n.compatible || []).forEach(function (cm) { var m = G.byId['M:' + cm]; badges.push(['compatible · ' + (m ? m.label : cm), T.soft, T.ink]); });
    if (badges.length) h += '<div class="cfc-badges">' + badges.map(function (b) { return pill(b[0], b[1], b[2]); }).join('') + '</div>';
    var media = safeSrc(n.media), image = safeSrc(n.image), vid = media && /\.(mp4|webm|mov)(\?|$)/i.test(media), aud = media && /\.(mp3|wav|m4a|ogg)(\?|$)/i.test(media);
    var ar = n.kind === 'style_choc' ? '16 / 10' : n.kind === 'avatar' ? '1 / 1' : '9 / 16', fw = s.w < 760 ? '150px' : n.kind === 'style_choc' ? '220px' : '190px';
    if (vid) h += '<div class="cfc-media"><div class="cfc-frame" style="width:' + fw + ';aspect-ratio:' + ar + '"><video src="' + media + '"' + (image ? ' poster="' + image + '"' : '') + ' controls playsinline loop preload="metadata"></video></div>' + speedsHTML(s) + '</div>';
    else if (image) h += '<div class="cfc-media"><div class="cfc-frame" style="width:' + fw + ';aspect-ratio:' + ar + '"><img src="' + image + '" alt="" style="object-fit:' + (n.kind === 'style_choc' ? 'contain' : 'cover') + '"></div></div>';
    if (aud) h += '<audio class="cfc-audio" src="' + media + '" controls preload="metadata"></audio>';
    // vidéos de la brique (12, puis 120), vues totales / moyennes, meilleures combinaisons
    var V = this.V, all = n.fam !== 'hub' && V ? V.nodeVids[n.id] || [] : [], pub = all.filter(function (x) { return x.publication; }), tot = pub.reduce(function (a, x) { return a + x.views; }, 0);
    var stats = [];
    if (n.fam !== 'hub') stats.push({ label: plw(n.videos || 0, 'vidéo produite', 'vidéos produites'), value: n.videos != null ? fmt(n.videos) : '—' });
    if ((n.kind === 'avatar' || n.kind === 'photo') && n.publiees != null) { stats.push({ label: plw(n.publiees, 'publiée', 'publiées'), value: fmt(n.publiees) }); stats.push({ label: 'vues', value: n.vues != null ? fmt(n.vues) : '—' }); }
    stats.push({ label: plw(n.deg, 'lien'), value: fmt(n.deg) });
    if (n.fam === 'hub') { var by = {}; G.adj[n.id].forEach(function (l) { var o = l.s === n ? l.t : l.s; by[o.fam] = (by[o.fam] || 0) + 1; }); FAM.forEach(function (f) { if (by[f[0]]) stats.push({ label: f[1].toLowerCase(), value: fmt(by[f[0]]) }); }); }
    if (n.fam !== 'hub') { stats.push({ label: 'vues totales', value: pub.length ? fmt(tot) : '—' }); stats.push({ label: 'vues moyennes', value: pub.length ? fmt(Math.round(tot / pub.length)) : '—' }); }
    h += statsHTML(stats);
    if (all.length) {
      var byV = s.vidSort === 'vues', srt = all.slice().sort(function (a, b) { return byV ? (b.views - a.views || b.t - a.t) : b.t - a.t; }), lim = s.vidAll ? 120 : 12;
      h += '<div class="cfc-sec"><div class="cfc-sec-h"><span class="cfc-over">Vidéos</span><span class="cfc-meta">' + esc(fmt(all.length) + ' · ' + fmt(pub.length) + ' ' + plw(pub.length, 'publiée')) + '</span>'
        + '<div class="cfc-mini"><button type="button" data-cfc="sort" data-k="date" class="' + (!byV ? 'is-on' : '') + '">Date</button><button type="button" data-cfc="sort" data-k="vues" class="' + (byV ? 'is-on' : '') + '">Vues</button></div></div>'
        + '<div class="cfc-vids">' + srt.slice(0, lim).map(function (x) {
          var aff = safeSrc(x.affiche);
          return '<button type="button" data-cfc="vid" data-k="' + esc(x.vf) + '">' + (aff ? '<img src="' + aff + '" alt="" loading="lazy">' : '<span class="cfc-noimg"></span>')
            + '<span class="cfc-vcap"><i style="background:' + (SCOL[x.statut] || T.muted) + '"></i>' + esc(x.vf) + '</span><span class="cfc-meta">' + esc(x.publication ? fmt(x.views) + ' vues' : x.statut) + '</span></button>';
        }).join('') + '</div>'
        + (srt.length > lim ? '<button type="button" class="cfc-more" data-cfc="more">' + esc('Voir ' + (srt.length > 120 ? 'les 120 premières' : 'les ' + fmt(srt.length))) + '</button>' : '') + '</div>';
      var pm = {}; pub.forEach(function (x) { x.ids.forEach(function (id) { if (id === n.id || id.indexOf(':') >= 0) return; var o = pm[id] || (pm[id] = { v: 0, c: 0 }); o.v += x.views; o.c++; }); });
      var combos = Object.keys(pm).filter(function (id) { return pm[id].v > 0; }).sort(function (a, b) { return pm[b].v - pm[a].v; }).slice(0, 6);
      if (combos.length) h += '<div class="cfc-sec"><span class="cfc-over">Meilleures combinaisons</span><span class="cfc-rule">briques qui ont fait le plus de vues avec celle-ci</span>'
        + combos.map(function (id) { var m = G.byId[id]; return '<button type="button" class="cfc-combo" data-cfc="node" data-k="' + esc(id) + '"' + (m ? ' title="' + esc(m.label) + '"' : '') + '><i style="background:' + (m ? m.color : T.muted) + '"></i><b>' + esc(m ? m.short : id) + '</b><span>' + esc(fmt(pm[id].v) + ' vues · ' + pm[id].c + ' ' + plw(pm[id].c, 'vidéo')) + '</span></button>'; }).join('') + '</div>';
    }
    if (n.kind === 'hook') {
      var Pt = this.pathFor(n.id);
      if (Pt) h += '<div class="cfc-poss"><div><b>' + esc(fmt(Pt.count)) + '</b><span>' + esc(plw(Pt.count, 'vidéo possible', 'vidéos possibles')) + '</span></div>'
        + '<div class="cfc-meta">' + esc(fmt(Pt.nL) + ' ' + plw(Pt.nL, 'liaison') + ' × ' + fmt(Pt.nD) + ' ' + plw(Pt.nD, 'démo compatible', 'démos compatibles') + (Pt.modLabels.length ? ' (' + Pt.modLabels.join(', ') + ')' : '') + ' × CTA de fin du module · tourné sur ' + fmt(Pt.nPh) + ' ' + plw(Pt.nPh, 'photo') + ' · sans compter l’habillage') + '</div></div>';
    }
    var gm = {}; G.adj[n.id].forEach(function (l) { (gm[l.type] = gm[l.type] || []).push(l.s === n ? l.t : l.s); });
    LT_ORDER.filter(function (t) { return gm[t]; }).forEach(function (t) {
      h += '<div class="cfc-sec"><div class="cfc-sec-h"><span class="cfc-over">' + esc(LT[t][0]) + '</span><span class="cfc-meta">' + gm[t].length + '</span></div><span class="cfc-rule">' + esc(self_regle(this, t)) + '</span>'
        + '<div class="cfc-chips">' + gm[t].sort(function (a, b) { return nat(a.id, b.id); }).map(function (o) { return chip(o.id, o.short, o.fam === 'hub' ? T.hub : o.color, o.label); }).join('') + '</div></div>';
    }, this);
    return h;
  };
  function self_regle(c, t) { return c.regles[t] || ''; }
  P.vidHead = function (v, T) {
    var SC = { 'validée': ['validée', 'oklch(0.94 0.05 155)', 'oklch(0.42 0.1 155)'], 'refusée': ['refusée', 'oklch(0.95 0.04 25)', 'oklch(0.5 0.14 25)'], 'en revue': ['en revue', 'oklch(0.95 0.06 85)', 'oklch(0.45 0.1 70)'] }, st = SC[v.statut] || [v.statut, T.soft, T.muted];
    return '<i class="cfc-dot" style="background:' + (SCOL[v.statut] || T.muted) + '"></i><span class="cfc-fam">Vidéo</span>' + pill(st[0], st[1], st[2]);
  };
  P.vidBody = function (v, T) {
    var G = this.g, s = this.state, Pb = v.publication, h = '<div class="cfc-id">' + esc(v.vf) + '</div>';
    if (v.raison_refus) h += '<div class="cfc-text">' + esc('Raison du refus : ' + v.raison_refus) + '</div>';
    var dt = function (x) { var d = new Date(String(x).replace(' ', 'T')); return isNaN(d) ? String(x) : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
    var fn = v.fmt && G.byId['F:' + v.fmt];
    h += '<div class="cfc-badges">' + (fn ? pill('format · ' + fn.label, T.soft, T.ink) : '') + pill('produite le ' + dt(v.date), T.soft, T.ink) + (Pb ? pill('@' + Pb.compte + ' · ' + dt(Pb.publiee_le), 'rgba(255,107,53,.12)', '#e5541f') : pill('non publiée', T.soft, T.muted)) + '</div>';
    var src = safeSrc(v.video), aff = safeSrc(v.affiche), fw = s.w < 760 ? '150px' : '200px';
    if (src) h += '<div class="cfc-media"><div class="cfc-frame" style="width:' + fw + ';aspect-ratio:9 / 16"><video src="' + src + '"' + (aff ? ' poster="' + aff + '"' : '') + ' controls playsinline loop preload="none"></video></div>' + speedsHTML(s) + '</div>';
    else if (aff) h += '<div class="cfc-media"><div class="cfc-frame" style="width:' + fw + ';aspect-ratio:9 / 16"><img src="' + aff + '" alt=""></div></div>';
    var stats = Pb ? [['vues', Pb.vues], ['portée', Pb.portee], ['likes', Pb.likes], ['commentaires', Pb.commentaires], ['partages', Pb.partages], ['enregistrements', Pb.enregistrements]].map(function (x) { return { label: x[0], value: x[1] == null ? '—' : fmt(x[1]) }; })
      .concat([{ label: 'visionnage moyen', value: Pb.visionnage_moyen_s != null ? String(Pb.visionnage_moyen_s).replace('.', ',') + ' s' : '—' }]) : [{ label: 'vues', value: '—' }];
    h += statsHTML(stats);
    var lk = Pb && safeLink(Pb.lien); if (lk) h += '<a class="cfc-link" href="' + lk + '" target="_blank" rel="noopener">Voir la publication' + ico('M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 12) + '</a>';
    var ROLE = [['avatar', 'Avatar'], ['photo', 'Photo'], ['hook', 'Hook'], ['hook_demos', 'Hook démo'], ['liaison', 'Liaison'], ['contenu', 'Démo'], ['assemblage', 'Assemblage'], ['cta', 'CTA'], ['reaction', 'Réaction'], ['texte_choc', 'Texte choc'], ['style_choc', 'Style choc'], ['musique', 'Musique'], ['sous_titre', 'Sous-titres']], R = v.recette || {};
    var items = []; ROLE.forEach(function (x) { [].concat(R[x[0]] || []).forEach(function (id) { if (typeof id === 'string') items.push([x[1], id]); }); });
    h += '<div class="cfc-sec"><div class="cfc-sec-h"><span class="cfc-over">Recette</span><span class="cfc-meta">' + items.length + '</span></div><span class="cfc-rule">tracée en orange sur la carte · clique une brique pour l’ouvrir</span><div class="cfc-chips">'
      + items.map(function (x) { var id = x[1], n = G.byId[id]; return n ? chip(id, x[0] + ' · ' + id, n.fam === 'hub' ? T.hub : n.color, n.label) : '<span class="cfc-chip is-off" title="brique absente de la carte"><i></i>' + esc(x[0] + ' · ' + id) + '</span>'; }).join('') + '</div></div>';
    return h;
  };

  window.CFCarte = { build: build, create: function () { var c = new Carte(); return { el: c.el, setData: function (d) { c.setData(d); }, setLoading: function (t) { c.setLoading(t); }, destroy: function () { c.destroy(); }, ready: function () { return !!c.g; } }; } };
})();
