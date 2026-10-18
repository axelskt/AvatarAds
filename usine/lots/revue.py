#!/usr/bin/env python3
# Creative Factory — PAGE DE REVUE d'un ou plusieurs lots (19/10, Axel : « envoie les vidéos quand c'est fini »).
# Une page HTML autonome : chaque vidéo de la file de revue (factory_qc, en attente) avec son affiche (image 0), sa légende
# (VF, photo, hook et sa phrase, démo, CTA, durée) et le lecteur qui ne charge la vidéo qu'au clic. Rien n'est validé ici :
# la validation reste « validé VF-… » (valider.py) ou le tableau de bord.
# usage : python3 usine/lots/revue.py VF-0542 VF-0631 sortie.html   (bornes incluses)
import html, json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import q

a, b, out = sys.argv[1], sys.argv[2], sys.argv[3]
rows = q("select template, status, video_url, poster_url, brick_combo, technical from factory_qc where template between '%s' and '%s' order by template" % (a, b))
hooks = {r['id']: (r['meta'] or {}).get('transcript') or (r['meta'] or {}).get('script') or r['label'] for r in q("select id, label, meta from factory_bricks where kind='hook'")}
def duree(t):
    for c in ((t or {}).get('checks') or []):
        if c.get('name') == 'duree': return (c.get('detail') or '').split(' ')[0]
    return ''
cards = []
for r in rows:
    c = r['brick_combo'] or {}
    if c.get('format') == 'F05':
        titre = 'Texte + musique · réaction %s' % c.get('reaction', '?')
        sous = 'démo %s · musique %s' % (c.get('contenu', '?'), c.get('musique', '?'))
    else:
        titre = '%s · %s' % (c.get('photo', '?'), c.get('hook', '?'))
        sous = 'démo %s · %s' % (c.get('contenu', '?'), c.get('cta', '?'))
    phrase = hooks.get(c.get('hook'), '') if c.get('hook') else ''
    st = {'pending': 'en revue', 'approved': 'validée', 'refused': 'refusée'}.get(r['status'], r['status'])
    cards.append('<figure><div class="v"><video controls preload="none" playsinline poster="%s" src="%s"></video></div>'
                 '<figcaption><b>%s</b> <span class="st">%s · %s</span><br>%s<br><small>%s</small>%s</figcaption></figure>' % (
                     html.escape(r['poster_url'] or ''), html.escape(r['video_url'] or ''), html.escape(r['template']), html.escape(st),
                     html.escape(duree(r['technical'])), html.escape(titre), html.escape(sous),
                     ('<br><i>« %s »</i>' % html.escape(phrase)) if phrase else ''))
page = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revue %s → %s</title><style>
:root{--bg:#f6f4f1;--card:#fff;--ink:#141013;--sub:#6b665f;--line:rgba(0,0,0,.1);--acc:#ff6b35}
@media (prefers-color-scheme:dark){:root{--bg:#121014;--card:#1c191f;--ink:#f3f0ec;--sub:#a7a39e;--line:rgba(255,255,255,.12)}}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,system-ui,sans-serif;padding:20px 16px}
h1{font-size:20px;margin:0 0 4px}p.n{color:var(--sub);margin:0 0 18px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.v{aspect-ratio:9/16;background:#000}.v video{width:100%%;height:100%%;display:block;object-fit:contain}
figcaption{padding:10px 12px 12px;font-size:13px}figcaption small{color:var(--sub)}figcaption i{color:var(--sub);font-size:12px}
.st{color:var(--acc);font-size:12px}
</style></head><body><h1>Revue %s → %s</h1><p class="n">%d vidéos · la vidéo se charge au clic sur lecture</p><main>%s</main></body></html>""" % (
    a, b, a, b, len(cards), '\n'.join(cards))
open(out, 'w', encoding='utf-8').write(page)
print('%s : %d vidéos (%s → %s)' % (out, len(cards), a, b))
