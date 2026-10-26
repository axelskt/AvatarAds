# Génère supabase/functions/_shared/email-v2-data.ts depuis emails.py (textes validés par Axel le 05/10/2026)
# et copie les visuels dans assets/mail/v2/ (servis par GitHub Pages : https://avatarads.fr/assets/mail/v2/…).
# Usage : python3 tools/emails/images.py (si les visuels changent) puis python3 tools/emails/gen_ts.py
import importlib.util, json, os, re, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location('emails', os.path.join(HERE, 'emails.py'))
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
# 26/10 : version anglaise (comptes profiles.lang = 'en'), mêmes identifiants et mêmes visuels
spec_en = importlib.util.spec_from_file_location('emails_en', os.path.join(HERE, 'emails_en.py'))
EN = importlib.util.module_from_spec(spec_en); spec_en.loader.exec_module(EN)

# Les CTA de l'aperçu pointent vers #module ; l'app ouvre un module via ?start= (_applyStartTool dans app/index.html)
START = {'express': 'express', 'motion': 'motion', 'images': 'images', 'montage': 'montage',
         'generateur': 'gen', 'omni': 'omni', 'audio': 'audio', 'recharge': 'recharge'}

def url(u):
    m = re.match(r'^(https://avatarads\.fr/(?:en/)?app/)#(\w+)$', u)
    return f'{m.group(1)}?start={START[m.group(2)]}' if m else u

def para(p):
    if p == E.VISUEL: return {'visuel': True}
    if isinstance(p, tuple) and p[0] == 'liste': return {'liste': list(p[1])}
    return p

def mail(m):
    img, alt, leg = E.VISUELS[m['id']]
    # visuels fabriqués par images.py dans images/ (non suivi), sinon ceux déjà publiés dans assets/mail/v2/
    assert os.path.exists(os.path.join(HERE, 'images', img)) or os.path.exists(os.path.join(REPO, 'assets', 'mail', 'v2', img)), img
    return dict(id=m['id'], quand=m['quand'], objet=m['objet'], preheader=m['preheader'], titre=m['titre'],
                corps=[para(p) for p in m['corps']], image=img, alt=alt, legende=leg, cta=m['cta'], url=url(m['url']))

out = ['// GÉNÉRÉ par tools/emails/gen_ts.py depuis tools/emails/emails.py — ne pas éditer à la main.',
       '// Textes et visuels validés par Axel le 05/10/2026. {plan} est remplacé à l\'envoi.',
       "import type { Mail } from './email-v2.ts'", '']
for name in ('PROSPECTS', 'LONGUE', 'CLIENTS', 'ROTATION', 'ZERO'):
    data = [mail(m) for m in getattr(E, name)]
    out.append(f'export const {name}: Mail[] = ' + json.dumps(data, ensure_ascii=False, indent=1) + '\n')
def mail_en(m):
    t = EN.MAILS[m['id']]
    img = E.VISUELS[m['id']][0]
    alt, leg = EN.VISUELS[m['id']]
    return dict(id=m['id'], quand=m['quand'], objet=t['objet'], preheader=t['preheader'], titre=t['titre'],
                corps=[para(p) for p in t['corps']], image=img, alt=alt, legende=leg, cta=t['cta'], url=url(t['url']))

tous = [m for n in ('PROSPECTS', 'LONGUE', 'CLIENTS', 'ROTATION', 'ZERO') for m in getattr(E, n)]
assert set(EN.MAILS) == {m['id'] for m in tous}, 'emails_en.py : identifiants différents de emails.py'
out.append('// Version anglaise (profiles.lang = \'en\'), par identifiant : tools/emails/emails_en.py')
out.append('export const EN: Record<string, Mail> = ' + json.dumps({m['id']: mail_en(m) for m in tous}, ensure_ascii=False, indent=1) + '\n')
dst = os.path.join(REPO, 'supabase', 'functions', '_shared', 'email-v2-data.ts')
open(dst, 'w', encoding='utf-8').write('\n'.join(out))

os.makedirs(os.path.join(REPO, 'assets', 'mail', 'v2'), exist_ok=True)
used = {E.VISUELS[m['id']][0] for n in ('PROSPECTS', 'LONGUE', 'CLIENTS', 'ROTATION', 'ZERO') for m in getattr(E, n)}
for f in used:
    if os.path.exists(os.path.join(HERE, 'images', f)):
        shutil.copy2(os.path.join(HERE, 'images', f), os.path.join(REPO, 'assets', 'mail', 'v2', f))
print('ok', dst, len(used), 'visuels')
