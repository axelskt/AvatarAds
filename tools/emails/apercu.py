# Génère apercu.html : chaque e-mail rendu dans le gabarit « mixte » (voix d'Axel, mise en page légère), pour validation.
import base64, html, importlib.util, os
spec = importlib.util.spec_from_file_location('emails', os.path.join(os.path.dirname(__file__), 'emails.py'))
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)

DEMO = dict(prenom='Marius', plan='Starter', credits='74', n_veo='12')
fill = lambda s: s.format(**DEMO) if isinstance(s, str) else s

def para(p):
    if isinstance(p, tuple) and p[0] == 'liste':
        items = ''.join(f'<li style="margin:0 0 8px">{fill(x)}</li>' for x in p[1])
        return f'<ul style="margin:0 0 16px;padding-left:20px">{items}</ul>'
    return f'<p style="margin:0 0 16px">{fill(p)}</p>'

def visuel(m):
    # Image pleine largeur de la carte (484 px), arrondie, + légende discrète
    f, alt, leg = E.VISUELS[m['id']]
    # Aperçu autonome : image embarquée. À l'envoi, src = URL publique (avatarads.fr/assets/mail/…)
    src = 'data:image/jpeg;base64,' + base64.b64encode(open(os.path.join(os.path.dirname(__file__), 'images', f), 'rb').read()).decode()
    return (f'<img src="{src}" width="484" alt="{html.escape(alt)}" style="display:block;width:100%;max-width:484px;height:auto;'
            f'border:0;border-radius:12px;margin:4px 0 8px">'
            f'<p style="margin:0 0 22px;font:12.5px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8a8a93">{html.escape(leg)}</p>')

def mail(m):
    # Gabarit e-mail (tables + styles en ligne : compatible Gmail / Apple Mail / Outlook)
    # L'image se place au marqueur VISUEL (accroche → contenu → CTA) ; à défaut, après le texte
    body = ''.join(visuel(m) if p == E.VISUEL else para(p) for p in m['corps'])
    if E.VISUEL not in m['corps']: body += visuel(m)
    return f'''
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f0"><tr><td align="center" style="padding:28px 14px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">
  <tr><td style="padding:0 6px 16px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td><img src="https://avatarads.fr/apple-touch-icon.png" width="28" height="28" alt="" style="display:block;border-radius:7px"></td>
      <td style="padding-left:9px;font:800 16px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#15151a;letter-spacing:-.01em">AvatarAds</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid #e9e6e1;border-radius:18px;padding:30px 28px;font:15px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#3d3d46">
    <div style="font:800 22px/1.25 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#15151a;letter-spacing:-.02em;margin:0 0 18px">{fill(m['titre'])}</div>
    <p style="margin:0 0 16px">Salut {DEMO['prenom']},</p>
    {body}
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ff6b35;border-radius:12px">
      <a href="{m['url']}" style="display:inline-block;padding:13px 22px;font:700 15px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none">{fill(m['cta'])}</a>
    </td></tr></table>
    <p style="margin:26px 0 0;color:#3d3d46">À bientôt,<br><b style="color:#15151a">Axel</b><br><span style="color:#73737d;font-size:13px">Fondateur d’AvatarAds</span></p>
  </td></tr>
  <tr><td style="padding:16px 6px 0;text-align:center;font:12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9a9aa3">
    AvatarAds · avatarads.fr<br><a href="#" style="color:#9a9aa3">Ne plus recevoir ces e-mails</a>
  </td></tr>
 </table>
</td></tr></table>'''

def section(titre, sous, liste):
    out = [f'<h2>{titre}</h2><p class="sous">{sous}</p>']
    for m in liste:
        out.append(f'''<article>
  <div class="meta"><span class="quand">{html.escape(m["quand"])}</span>
    <div class="objet">{html.escape(fill(m["objet"]))}</div>
    <div class="pre">{html.escape(fill(m["preheader"]))}</div></div>
  <div class="mail">{mail(m)}</div>
</article>''')
    return '\n'.join(out)

page = f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aperçu des e-mails AvatarAds</title>
<style>
 body{{margin:0;background:#ecebe8;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#15151a}}
 main{{max-width:1180px;margin:0 auto;padding:28px 16px 80px}}
 h1{{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}} .intro{{color:#55555f;margin:0 0 26px;max-width:760px}}
 h2{{font-size:20px;margin:40px 0 4px}} .sous{{color:#66666f;margin:0 0 16px}}
 article{{display:grid;grid-template-columns:250px 1fr;gap:18px;align-items:start;margin:0 0 22px}}
 .meta{{position:sticky;top:16px;background:#fff;border:1px solid #e1ded8;border-radius:14px;padding:14px}}
 .quand{{display:inline-block;font-size:11.5px;font-weight:700;color:#c2410c;background:#fff1ea;border-radius:20px;padding:2px 9px;margin-bottom:8px}}
 .objet{{font-weight:750;font-size:15px}} .pre{{color:#73737d;font-size:13px;margin-top:4px}}
 .mail{{border-radius:16px;overflow:hidden;box-shadow:0 10px 30px -18px rgba(0,0,0,.35)}}
 @media(max-width:820px){{article{{grid-template-columns:1fr}} .meta{{position:static}}}}
</style></head><body><main>
<h1>Aperçu des e-mails AvatarAds</h1>
<p class="intro">Version de travail du 5 octobre, à valider avant tout envoi. Ton mixte (voix d’Axel, mise en page légère), aucun émoji dans les objets, une idée par e-mail. Chaque e-mail suit la structure d’une vidéo : accroche (titre et première phrase), contenu (l’image et le texte qui la décrit), puis un appel à l’action avant le bouton. Chaque visuel est une vraie frame de tes démos ou de tes générations, recadrée pour l’e-mail. Exemple rendu avec « Marius », plan Starter.</p>
{section("1. Prospects : inscrits gratuits, jusqu’à l’abonnement", "Huit e-mails sur deux semaines, puis une idée toutes les deux semaines. La séquence s’arrête dès l’abonnement.", E.PROSPECTS)}
{section("2. Prospects : la suite, toutes les deux semaines", "Rotation de fonctionnalités, plus une idée de saison selon le mois.", E.LONGUE)}
{section("3. Clients : prise en main", "Bienvenue, première vidéo, et une relance après 7 jours sans création. Uniquement du conseil.", E.CLIENTS)}
{section("4. Clients : l’idée de la semaine", "Une fonctionnalité par semaine, chaque e-mail annonce la suivante, puis la boucle recommence. Un e-mail tous les deux jours au plus, toutes séquences confondues.", E.ROTATION)}
</main></body></html>'''
open(os.path.join(os.path.dirname(__file__), 'apercu.html'), 'w', encoding='utf-8').write(page)
print('ok', len(E.PROSPECTS) + len(E.LONGUE) + len(E.CLIENTS) + len(E.ROTATION), 'e-mails')
