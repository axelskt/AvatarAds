#!/usr/bin/env python3
"""Pages de LECTURE des vidéos de démo (19/10, Axel : « pourquoi ça met Aucune vidéo indexée ? »).

Google n'indexe une vidéo que sur une page dont elle est le CONTENU PRINCIPAL (« page de lecture ») : sur l'accueil, les
10 démos sont des illustrations (« contenu complémentaire de la page ») et ne sont jamais indexées. Ici : une page par
démo (video-<slug>.html, la vidéo en haut, en grand, avec ses commandes) + fiche VideoObject, une page qui les regroupe
(videos.html) et les entrées <video:video> du sitemap. Nav, pied de page et styles = ceux des pages SEO (seo-pages.css).

usage : python3 tools/build-video-pages.py   (depuis la racine du dépôt ; réécrit les pages et le bloc vidéos du sitemap)
"""
import html, json, re, subprocess

SITE = 'https://avatarads.fr'
# slug, vidéo, affiche, titre de page, h1, description (fiche + page), page de la fonctionnalité, libellé du lien
V = [
    ('generateur', 'assets/lp/generateur-lp.mp4', 'assets/lp/generateur-lp.webp',
     'Démo du Générateur : un avatar IA qui parle avec ta voix',
     'Démo du Générateur AvatarAds : un avatar IA, ta voix, tes sous-titres',
     "Le Générateur d'AvatarAds en action : tu choisis un avatar IA, tu enregistres ou importes ta propre voix, tu choisis un style de sous-titres animés, et la vidéo face caméra est prête à publier sur TikTok, Reels ou Shorts. Aucun clonage vocal : c'est ta vraie voix.",
     '/generateur-avatar-ia.html', "Générateur d'avatar IA"),
    ('express', 'assets/lp/express-lp.mp4', 'assets/lp/express-lp.webp',
     'Démo Express : des vidéos UGC générées depuis un prompt',
     'Démo Express : un prompt, plusieurs vidéos UGC générées',
     "Express transforme un simple prompt (ou une image) en vidéos UGC verticales, au style iPhone, prêtes pour les réseaux. Dans cette démo, un seul prompt donne plusieurs vidéos différentes en quelques minutes, sans tournage ni acteur.",
     '/ugc-ia.html', 'Vidéos UGC par IA'),
    ('images-ia', 'assets/lp/images-ia-lp.mp4', 'assets/lp/images-ia-lp.webp',
     "Démo Images IA : un produit devient des dizaines de pubs",
     "Démo Images IA : un produit devient des dizaines de visuels publicitaires",
     "Avec Images IA, une seule photo de produit devient des dizaines de visuels : pubs produit façon static ads, photos UGC d'une personne qui tient le produit, formats carré, portrait ou paysage, jusqu'en 4K. La démo est lancée depuis Claude, grâce au connecteur AvatarAds.",
     '/creer-video-ia.html', 'Créer une vidéo avec l’IA'),
    ('avatar-ia', 'assets/lp/avatar-ia-lp.mp4', 'assets/lp/avatar-ia-lp.webp',
     'Démo Avatar IA : des visages IA réalistes pour tes pubs',
     'Démo Avatar IA : des visages réalistes pour présenter ton produit',
     "AvatarAds génère des visages IA réalistes (âge, style, décor au choix) qui présentent ton produit face caméra. Cette démo montre une série d'avatars créés pour des publicités, sans casting ni tournage.",
     '/generateur-avatar-ia.html', "Générateur d'avatar IA"),
    ('motion-control', 'assets/lp/motion-control-lp.mp4', 'assets/lp/motion-control-lp.webp',
     'Démo Motion Control : une image fixe qui prend vie',
     'Démo Motion Control : une image fixe animée en vidéo',
     "Motion Control anime une image fixe (un personnage, un produit) en reprenant le mouvement d'une vidéo de référence. La démo montre une photo qui se met à bouger de façon naturelle, prête pour une pub ou un contenu viral.",
     '/creer-video-ia.html', 'Créer une vidéo avec l’IA'),
    ('omni', 'assets/lp/omni-lp.mp4', 'assets/lp/omni-lp.webp',
     'Démo Omni : transformer un objet de vidéo par un prompt',
     'Démo Omni : transforme n’importe quel objet d’une vidéo par un prompt',
     "Omni modifie une vidéo existante à partir d'une simple phrase : une voiture devient une autre voiture, un décor change, un objet apparaît. La démo montre l'avant / après, image par image, en quelques secondes.",
     '/creer-video-ia.html', 'Créer une vidéo avec l’IA'),
    ('montage-ia', 'assets/lp/montage-ia-lp.mp4', 'assets/lp/montage-ia-lp.webp',
     'Démo Montage IA : la même vidéo, brute puis montée',
     'Démo Montage IA : ta vidéo brute, montée automatiquement',
     "Montage IA monte une vidéo à ta place : sous-titres, animations, zooms, visuels qui illustrent ce qui est dit, musique. La démo compare la même vidéo, brute puis montée par l'IA.",
     '/creer-video-ia.html', 'Créer une vidéo avec l’IA'),
    ('nettoyage-audio', 'assets/lp/nettoyage-audio-lp.mp4', 'assets/lp/nettoyage-audio-lp.webp',
     'Démo Nettoyage audio : un son de pro sans micro',
     'Démo Nettoyage audio : bruit, volume et silences corrigés',
     "Le nettoyage audio d'AvatarAds retire le bruit de fond, égalise le volume et coupe les silences d'un enregistrement fait au téléphone. Écoute dans la démo le son brut, puis le son nettoyé.",
     '/creer-video-ia.html', 'Créer une vidéo avec l’IA'),
    ('claude', 'assets/lp/tuto-claude.mp4', 'assets/lp/tuto-claude.webp',
     'Démo : AvatarAds connecté à Claude, deux vidéos en un prompt',
     'Démo : AvatarAds dans Claude, deux vidéos générées en un seul prompt',
     "Une fois AvatarAds connecté à Claude (connecteur MCP), tu demandes simplement tes vidéos dans la conversation. Dans cette démo, un seul prompt génère deux vidéos publicitaires, sans quitter Claude.",
     '/claude.html', 'Connecter Claude à AvatarAds'),
    ('avatars', 'assets/lp/v2/hero-cutnet.mp4', 'assets/lp/v2/anim-start-01.jpg',
     'Avatars IA générés par AvatarAds : le casting en vidéo',
     'Avatars IA générés par AvatarAds : le casting',
     "Un aperçu des avatars IA générés avec AvatarAds : des personnages réalistes, au format vertical, prêts à porter tes publicités et tes contenus UGC sur TikTok, Instagram et YouTube Shorts.",
     '/generateur-avatar-ia.html', "Générateur d'avatar IA"),
]

def probe(p):
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration',
                        '-of', 'json', p], capture_output=True, text=True, check=True).stdout
    j = json.loads(o); s = j['streams'][0]
    return s['width'], s['height'], float(j['format']['duration'])

def added(p):
    return subprocess.run(['git', 'log', '--format=%aI', '-1', '--', p], capture_output=True, text=True).stdout.strip() or '2026-09-05T00:00:00+02:00'

src = open('ugc-ia.html', encoding='utf-8').read()
NAV = re.search(r'<nav class="snav">[\s\S]*?</nav>', src).group(0)
FOOT = re.search(r'<footer class="sfoot">[\s\S]*?</footer>', src).group(0)
FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
e = lambda s: html.escape(s, quote=True)

def page(head_title, desc, canon, ld, body):
    return f'''<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(head_title, quote=False)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{canon}">
<meta property="og:title" content="{e(head_title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{canon}">
{FONTS}
<link rel="stylesheet" href="/assets/seo-pages.css">
<style>.vplay{{margin:22px 0 8px;border-radius:18px;overflow:hidden;background:#000;border:1px solid var(--border2)}}.vplay video{{display:block;width:100%;height:auto;max-height:78vh;margin:0 auto;background:#000}}.vlist{{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:18px}}.vlist a{{display:block;color:var(--text);text-decoration:none;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface)}}.vlist img{{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}}.vlist span{{display:block;padding:10px 12px;font-size:14px;font-weight:600;line-height:1.35}}</style>
<script type="application/ld+json">
{json.dumps(ld, ensure_ascii=False)}
</script>
</head>
<body>
{NAV}

<div class="wrap">
{body}
</div>

{FOOT}
</body>
</html>
'''

items, cards, smap = [], [], []
for slug, mp4, poster, title, h1, desc, feat, featlab in V:
    w, h, d = probe(mp4)
    url = f'{SITE}/video-{slug}.html'
    vo = {'@type': 'VideoObject', '@id': url + '#video', 'name': title, 'description': desc, 'thumbnailUrl': [f'{SITE}/{poster}'],
          'uploadDate': added(mp4), 'duration': 'PT%dS' % round(d), 'contentUrl': f'{SITE}/{mp4}', 'inLanguage': 'fr-FR',
          'width': w, 'height': h, 'publisher': {'@id': f'{SITE}/#organization'}}
    items.append((slug, title, poster, vo))
    smap.append((url, vo))
others = lambda me: ''.join(f'<a href="/video-{s}.html"><img src="/{p}" alt="" loading="lazy" width="320" height="180"><span>{e(t)}</span></a>' for s, t, p, _ in items if s != me)
for slug, mp4, poster, title, h1, desc, feat, featlab in V:
    url = f'{SITE}/video-{slug}.html'; vo = next(v for s, *_, v in items if s == slug)
    ld = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'WebPage', '@id': url + '#page', 'url': url, 'name': title, 'inLanguage': 'fr-FR', 'isPartOf': {'@id': f'{SITE}/#website'},
         'primaryImageOfPage': f'{SITE}/{poster}', 'mainEntity': {'@id': url + '#video'}},
        vo,
        {'@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Accueil', 'item': f'{SITE}/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Vidéos', 'item': f'{SITE}/videos.html'},
            {'@type': 'ListItem', 'position': 3, 'name': title, 'item': url}]}]}
    body = f'''  <div class="crumb"><a href="/">Accueil</a> › <a href="/videos.html">Vidéos</a> › {e(title.split(':')[0].strip())}</div>
  <h1 style="margin-top:22px;font-size:clamp(26px,4vw,40px);line-height:1.15;letter-spacing:-.02em">{html.escape(h1, quote=False)}</h1>
  <div class="vplay"><video controls playsinline preload="metadata" poster="/{poster}" width="{vo['width']}" height="{vo['height']}" src="/{mp4}" title="{e(title)}"></video></div>
  <p class="lead" style="margin:14px 0 0">{e(desc)}</p>
  <div class="hero-cta" style="justify-content:flex-start"><a class="btn-primary" href="/app/">Essayer AvatarAds →</a><a class="btn-ghost" href="{feat}">{e(featlab)}</a></div>
  <section>
    <h2>Les autres démos</h2>
    <div class="vlist">{others(slug)}</div>
  </section>'''
    open(f'video-{slug}.html', 'w', encoding='utf-8').write(page(title + ' | AvatarAds' if len(title) < 52 else title, desc, url, ld, body))

hub = f'{SITE}/videos.html'
ld = {'@context': 'https://schema.org', '@graph': [
    {'@type': 'CollectionPage', '@id': hub + '#page', 'url': hub, 'name': 'Démos vidéo AvatarAds', 'inLanguage': 'fr-FR', 'isPartOf': {'@id': f'{SITE}/#website'}},
    {'@type': 'ItemList', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'url': f'{SITE}/video-{s}.html', 'name': t} for i, (s, t, _, _) in enumerate(items)]}]}
body = '''  <div class="crumb"><a href="/">Accueil</a> › Vidéos</div>
  <header class="shero" style="text-align:left;padding-top:30px">
    <span class="eyebrow">Démos</span>
    <h1>Toutes les démos vidéo d'AvatarAds</h1>
    <p class="lead" style="margin:0">Chaque fonctionnalité en vidéo : Générateur, Express, Images IA, Motion Control, Omni, Montage IA, nettoyage audio et AvatarAds dans Claude.</p>
  </header>
  <section><div class="vlist">''' + others('') + '''</div></section>'''
open('videos.html', 'w', encoding='utf-8').write(page("Démos vidéo d'AvatarAds : toutes les fonctionnalités", "Toutes les démos vidéo d'AvatarAds : Générateur, Express, Images IA, Motion Control, Omni, Montage IA, nettoyage audio et le connecteur Claude.", hub, ld, body))

# sitemap : bloc vidéos régénéré entre deux marqueurs (+ espace de noms vidéo)
sm = open('sitemap.xml', encoding='utf-8').read()
if 'xmlns:video=' not in sm:
    sm = sm.replace('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
                    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">')
x = lambda s: html.escape(s, quote=False)
blk = ['  <!-- vidéos : généré par tools/build-video-pages.py -->',
       f'  <url>\n    <loc>{hub}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>']
for url, vo in smap:
    blk.append(f'''  <url>
    <loc>{url}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
    <video:video>
      <video:thumbnail_loc>{vo['thumbnailUrl'][0]}</video:thumbnail_loc>
      <video:title>{x(vo['name'])}</video:title>
      <video:description>{x(vo['description'])}</video:description>
      <video:content_loc>{vo['contentUrl']}</video:content_loc>
      <video:duration>{vo['duration'][2:-1]}</video:duration>
      <video:publication_date>{vo['uploadDate']}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>
  </url>''')
blk.append('  <!-- /vidéos -->')
sm = re.sub(r'\s*<!-- vidéos : généré[\s\S]*?<!-- /vidéos -->', '', sm)
sm = sm.replace('</urlset>', '\n'.join(blk) + '\n</urlset>')
open('sitemap.xml', 'w', encoding='utf-8').write(sm)
print('%d pages vidéo + videos.html + sitemap' % len(items))
