#!/usr/bin/env python3
# Creative Factory — DONNÉES DE LA CARTE DES BRIQUES (19/10, Axel : « une grande map, chaque point relié selon la matrice »).
# Un seul JSON : nodes (briques), links (liens réels, mêmes règles que l'usine), regles (texte de chaque type de lien) et
# videos (historique de toutes les vidéos produites, recette + statistiques Instagram si publiée).
#   · photos : actuelles (meta.images) = 'ready' ; anciennes (meta.images_retirees) = 'ancienne' — leurs briques (hooks, CTA,
#     liaisons déjà générés) restent UTILISABLES (Axel 19/10) ;
#   · vues : dernière mesure de chaque média Instagram relié à une recette (ig_media_stats.combo), comptée pour chaque brique
#     de sa recette — y compris une vidéo absente de factory_qc.
# usage : python3 usine/lots/carte.py sortie.json
import json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import q

USINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MOD = {'mcp-claude': 'Claude (MCP)', 'omni': 'Omni', 'image-ia': 'Images IA', 'static-ads': 'Pubs statiques', 'motion-control': 'Motion Control',
       'express': 'Express', 'montage-ia': 'Montage IA', 'nettoyage-audio': 'Nettoyage audio', 'generique': 'Générique (toutes démos)'}
REGLES = {
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
    'format': 'brique utilisée par ce format de vidéo',
    'habillage': 'habillage tiré au hasard dans ce format',
    'video': "vidéo produite : 'recette' pointe vers les briques utilisées ; 'publication' = statistiques Instagram réelles si publiée"}
KEYS = ('voice', 'format', 'avatar', 'photo', 'hook', 'liaison', 'contenu', 'cta', 'texte_choc', 'style_choc', 'musique', 'sous_titre', 'reaction', 'assemblage')

br = {b['id']: b for b in q("select id, kind, status, subject, label, meta from factory_bricks")}
var = q("select avatar_id a, brick_id b from factory_variants")
qc = q("select template vf, status, refusal_reason, created_at::text cree, poster_url, video_url, brick_combo c from factory_qc where template like 'VF-%' order by template")
stats = q("select distinct on (media_id) media_id, combo, account, posted_at::text publie, permalink, views, reach, likes, comments, shares, saved, avg_watch_s "
          "from ig_media_stats order by media_id, day desc")
MX = {h: re.findall(r'"(L\d+)"', ls) for h, ls in re.findall(r'"(H\w+)":\s*\[([^\]]*)\]', open(os.path.join(USINE, 'hook-liaison.js'), encoding='utf-8').read())}
LOGOS = set(re.findall(r"id: '(TH\d+)'[^}]*logos:", open(os.path.join(USINE, 'formats.js'), encoding='utf-8').read()))

nodes, links, seen = {}, [], set()
def N(i, kind, label, **kw):
    d = {'id': i, 'kind': kind, 'label': label}; d.update({k: v for k, v in kw.items() if v not in (None, '', [])}); nodes[i] = d
def L(a, b, t):
    if a in nodes and b in nodes and (a, b, t) not in seen: seen.add((a, b, t)); links.append({'source': a, 'target': b, 'type': t})

for m, l in MOD.items(): N('M:' + m, 'module', l)
N('F:parlee', 'format', 'Vidéo parlée (hook → liaison → démo → CTA)'); N('F:muette', 'format', 'Texte + musique (réaction → texte choc → démo muette)')
for b in br.values():
    m = b['meta'] or {}; k = b['kind']; st = b['status']
    if k == 'avatar':
        N(b['id'], 'avatar', b['label'], status=st, image=m.get('cover'))
        th = {os.path.basename(u).rsplit('.', 1)[0]: u for u in (m.get('thumbs') or []) + (m.get('thumbs_retirees') or [])}
        for u, etat in [(u, 'ready') for u in (m.get('images') or [])] + [(u, 'ancienne') for u in (m.get('images_retirees') or [])]:
            pid = os.path.basename(u).rsplit('.', 1)[0]
            if pid in nodes: continue
            N(pid, 'photo', '%s · %s' % (pid, ((m.get('decors') or {}).get(pid, '') or '').split(' (')[0]), status=etat, image=th.get(pid, u))
            L(b['id'], pid, 'avatar-photo')
    elif st != 'ready' and not (k == 'texte-choc' and st == 'draft'): continue
    elif k == 'hook': N(b['id'], 'hook', m.get('transcript') or m.get('script') or b['label'], status=st, compatible=m.get('compatible_subjects'))
    elif k == 'liaison': N(b['id'], 'liaison', m.get('transcript') or b['label'], status=st, generique=b['subject'] == 'generique')
    elif k == 'contenu':
        N(b['id'], 'demo_muette' if m.get('muette') or re.match(r'^C-[A-Z]+M-', b['id']) else 'demo', b['label'], status=st, module=m.get('module') or b['subject'], media=m.get('media'))
    elif k == 'cta': N(b['id'], 'cta', m.get('transcript') or m.get('script') or b['label'], keyword=m.get('keyword'), status=st)
    elif k == 'texte-choc': N(b['id'], 'texte_choc', m.get('text') or b['label'], status=st, logos=b['id'] in LOGOS, compatible=m.get('compatible_subjects'))
    elif k in ('style-choc', 'musique', 'sous-titre', 'transformation', 'reaction'):
        N(b['id'], k.replace('-', '_'), b['label'], status=st, image=m.get('cover') or m.get('poster'), media=m.get('media'), module=b['subject'])

for v in var:
    b = v['b']; L(v['a'], b, 'photo-hook' if b.startswith('H') else 'photo-cta' if b.startswith('CTA') else 'photo-liaison' if b.startswith('L') else 'photo-brique')
for h, ls in MX.items():
    for l in ls: L(h, l, 'hook-liaison')
for i, n in list(nodes.items()):
    k = n['kind']
    if k == 'hook':
        for s in (n.get('compatible') or ['generique']): L(i, 'M:' + s, 'hook-module')
        L(i, 'F:parlee', 'format')
    elif k in ('demo', 'demo_muette'): L(i, 'M:' + n.get('module', 'generique'), 'demo-module'); L(i, 'F:muette' if k == 'demo_muette' else 'F:parlee', 'format')
    elif k == 'texte_choc':
        for s in (n.get('compatible') or ['generique']): L(i, 'M:' + s, 'choc-module')
    elif k == 'transformation': L(i, 'M:' + n.get('module', 'omni'), 'transfo-module')
    elif k == 'reaction': L(i, 'F:muette', 'format')
    elif k in ('musique', 'style_choc'): L(i, 'F:parlee', 'habillage'); L(i, 'F:muette', 'habillage')
    elif k == 'sous_titre': L(i, 'F:parlee', 'habillage')
L('M:mcp-claude', 'CTA-CLAUDE', 'module-cta')
for c in ('CTA-AIDE', 'CTA-MONTAGE', 'CTA-PLAN', 'CTA-SITE-tuto', 'CTA-cafe'):
    for m in MOD:
        if m != 'mcp-claude': L('M:' + m, c, 'module-cta')

# historique + statistiques
pub = {}
for s in stats:   # clé = numéro VF ; une statistique avec recette mais sans numéro compte quand même (clé = média)
    c = s['combo'] or {}
    if c: pub[c.get('vf') or 'IG-' + str(s['media_id'])] = s
use, vues, npub = collections.Counter(), collections.Counter(), collections.Counter()
videos = []
for r in qc:
    c = {k: v for k, v in (r['c'] or {}).items() if k in KEYS and v}
    v = {'vf': r['vf'], 'date': (r['cree'] or '')[:16], 'statut': {'approved': 'validée', 'pending': 'en revue', 'refused': 'refusée'}.get(r['status'], r['status']),
         'recette': c, 'affiche': r['poster_url'], 'video': r['video_url']}
    if r['refusal_reason']: v['raison_refus'] = r['refusal_reason']
    if r['status'] != 'refused':
        for b in set(c.values()): use[b] += 1
    videos.append(v)
byvf = {v['vf']: v for v in videos}
for vf, s in pub.items():
    c = {k: x for k, x in (s['combo'] or {}).items() if k in KEYS and x}
    p = {'compte': s['account'], 'publiee_le': (s['publie'] or '')[:16], 'lien': s['permalink'], 'vues': s['views'], 'portee': s['reach'], 'likes': s['likes'],
         'commentaires': s['comments'], 'partages': s['shares'], 'enregistrements': s['saved'], 'visionnage_moyen_s': s['avg_watch_s']}
    if vf in byvf: byvf[vf]['publication'] = p
    else: videos.append({'vf': vf, 'date': p['publiee_le'], 'statut': 'publiée', 'recette': c, 'publication': p})
    for b in set(c.values()): vues[b] += s['views'] or 0; npub[b] += 1
for n in nodes.values():
    i = n['id']
    if n['kind'] == 'avatar':
        ph = [l['target'] for l in links if l['type'] == 'avatar-photo' and l['source'] == i]
        n['photos_actuelles'] = sum(1 for x in ph if nodes[x]['status'] == 'ready'); n['photos_anciennes'] = sum(1 for x in ph if nodes[x]['status'] == 'ancienne')
    if use[i]: n['videos'] = use[i]
    if npub[i]: n['publiees'] = npub[i]; n['vues'] = vues[i]
nonrelies = [s for s in stats if not s['combo']]   # posts Instagram dont on ne connaît pas la recette
out = {'genere_le': q("select now()::text t")[0]['t'][:16], 'regles': REGLES, 'nodes': list(nodes.values()), 'links': links, 'videos': sorted(videos, key=lambda v: v['vf']),
       'publications_non_reliees': {'nombre': len(nonrelies), 'vues': sum(s['views'] or 0 for s in nonrelies),
                                    'par_compte': dict(collections.Counter(s['account'] for s in nonrelies))}}
json.dump(out, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('%s : %d briques, %d liens, %d vidéos (%d publiées reliées), %d publications non reliées' % (
    sys.argv[1], len(nodes), len(links), len(videos), sum(1 for v in videos if 'publication' in v), len(nonrelies)))
