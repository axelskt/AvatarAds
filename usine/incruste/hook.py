# Essai 5 (Axel 26/10, reformulé) : mot seul = GRAND derrière la tête (taille de l'essai 2) ; groupe de mots = plus petit,
# phrase entière jusqu'au mot fort (« ça commence vraiment à devenir ») ; mot fort EN BAS, DEVANT, en vert, et à ce moment
# les 2 démos du hook arrivent ensemble (gauche par la gauche, droite par la droite).
import json, os, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

# Réglages par hook / photo (facultatif) : incruste.json = {"fps": 30, "forts": ["QUALITÉ-LÀ"],
#   "groupes": "LAISSE-MOI / 30 SECONDES / … / QUALITÉ-LÀ", "une_ligne": true, "carte": {"w": 320, "marge": 36}}
# Sans fichier : réglages validés sur H90 × A1-11.
CONF = json.load(open('incruste.json')) if os.path.exists('incruste.json') else {}
FPS = CONF.get('fps', 24)
ANTON = 'Anton.ttf'
VERT = (200, 255, 61)
BLANC = (255, 255, 255)
FORTS = set(CONF.get('forts', ['FLIPPANT']))
DEMOS = ['demo', 'demo2']

def haut_tete():
    """haut du crâne sur la 1re image (masque) : les positions validées sont calées sur A1-11 (crâne à y 459)"""
    M = np.asarray(Image.open('m2/001.png').convert('L')) > 128
    lignes = np.where(M[:, 200:880].sum(axis=1) > 40)[0]
    return int(lignes.min()) if len(lignes) else 459
DY = CONF.get('dy', haut_tete() - 459)

def ease(x): x = max(0.0, min(1.0, x)); return 1 - (1 - x) ** 3
def pop(t, t0, d=0.14):
    x = max(0.0, min(1.0, (t - t0) / d))
    return x, (1 + 0.12 * np.sin(np.pi * x)) if x < 1 else 1.0

def decoupe(mots, texte):
    """groupes écrits à la main (« A B / C / … ») ; le texte affiché est celui des groupes (accents, chiffres)"""
    groupes = [g.split() for g in texte.split('/') if g.strip()]
    if sum(map(len, groupes)) != len(mots):
        raise SystemExit('groupes : %d mots écrits pour %d mots dits' % (sum(map(len, groupes)), len(mots)))
    brut, i = [], 0
    for g in groupes:
        brut.append([(m, mots[i + j]['start'], m in FORTS) for j, m in enumerate(g)]); i += len(g)
    return brut

def phrases(mots):
    """coupure aux ponctuations et autour des mots forts ; un mot isolé (hors 1er) rejoint le groupe suivant"""
    if CONF.get('groupes'): return bornes(decoupe(mots, CONF['groupes']))
    brut, cur = [], []
    for w in mots:
        txt = w['text'].strip(',.!?;:').upper()
        if txt in FORTS:
            if cur: brut.append(cur); cur = []
            brut.append([(txt, w['start'], True)]); continue
        cur.append((txt, w['start'], False))
        if w['text'].rstrip()[-1:] in ',.!?': brut.append(cur); cur = []
    if cur: brut.append(cur)
    out = []
    for i, g in enumerate(brut):
        if out and len(out[-1]) == 1 and len(out) > 1 and not out[-1][0][2] and not g[0][2]: out[-1] = out[-1] + g
        else: out.append(g)
    return bornes(out)

def bornes(out):
    res = []
    for i, g in enumerate(out):
        debut = 0.0 if i == 0 else g[0][1] - 0.02
        fin = out[i + 1][0][1] - 0.02 if i + 1 < len(out) else 99
        res.append((debut, fin, [(m, -1.0 if i == 0 else t) for m, t, _ in g], g[0][2]))
    return res

def lignes_de(mots, une_ligne=None):
    if len(mots) <= 2 or (CONF.get('une_ligne') if une_ligne is None else une_ligne): return [mots]
    # coupe équilibrée en 2 lignes (largeur en lettres)
    n = [len(m) for m, _ in mots]; tot = sum(n) + len(n) - 1; best, k = 1e9, 1
    for i in range(1, len(mots)):
        g = sum(n[:i]) + i - 1
        if abs(tot / 2 - g) < best: best, k = abs(tot / 2 - g), i
    return [mots[:k], mots[k:]]

def dessine(lay, t, mots, col, cap_px, bas, larg=960, une_ligne=None):
    f0 = ImageFont.truetype(ANTON, 100); cap0 = f0.getbbox('H')[3] - f0.getbbox('H')[1]
    lignes = lignes_de(mots, une_ligne)
    esp0 = f0.getlength(' ') * 1.6
    plus_large = max(sum(f0.getlength(m) for m, _ in l) + esp0 * (len(l) - 1) for l in lignes)
    size = min(100 * cap_px / cap0, 100 * larg / plus_large)
    f = ImageFont.truetype(ANTON, size); cap = cap0 * size / 100; esp = esp0 * size / 100
    pas = cap * 1.22
    for li, ligne in enumerate(lignes):
        y = bas - pas * (len(lignes) - 1 - li)
        x = (lay.width - sum(f.getlength(m) for m, _ in ligne) - esp * (len(ligne) - 1)) / 2
        for m, t0 in ligne:
            lw = f.getlength(m)
            if t >= t0 - 0.02:
                a, sc = pop(t, t0)
                img = Image.new('RGBA', (int(lw) + 60, int(size * 1.5)), (0, 0, 0, 0))
                sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
                ImageDraw.Draw(sh).text((30, size * 1.2), m, font=f, fill=(0, 0, 0, 160), anchor='ls')
                img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(max(4, size / 25))), (0, 5))
                ImageDraw.Draw(img).text((30, size * 1.2), m, font=f, fill=col + (255,), anchor='ls')
                if sc != 1.0: img = img.resize((max(1, int(img.width * sc)), max(1, int(img.height * sc))), Image.LANCZOS)
                if a < 1:
                    al = np.asarray(img).copy(); al[:, :, 3] = (al[:, :, 3] * a).astype(np.uint8); img = Image.fromarray(al)
                lay.alpha_composite(img, (int(x + lw / 2 - img.width / 2), int(y - size * 1.2 * sc)))
            x += lw + esp

CW = CONF.get('carte', {}).get('w', 340); CH = round(CW * 540 / 340); CY = 350 + DY
MARGE = CONF.get('carte', {}).get('marge', 64)
# mot seul derrière la tête : taille des capitales et px cachés sous le haut du crâne (A1-11 : 300 / 291) ; tête large ou
# mot long (« LAISSE-MOI » sur A1-6) → plus petit et plus haut, sinon il disparaît derrière le visage
# Mot seul derrière la tête : il doit rester LISIBLE (Axel 26/10 : « LAISSE-MOI », « CENSÉ », « GRATUITEMENT » à moitié
# cachés sur les photos cadrées serré). On mesure sur le masque de la 1re image la part des lettres que le crâne cacherait
# et on garde la position la plus enfoncée où ≥ 70 % du mot reste visible (A1-11 « WAOUH » : 300 / 291 comme validé).
_MS = {}
def mot_seul(m, masque='m2/001.png'):
    if 'mot_seul' in CONF: return {'cap': 300, 'chevauche': 291, **CONF['mot_seul']}
    if (m, masque) in _MS: return _MS[(m, masque)]
    M = np.asarray(Image.open(masque).convert('L')) > 128
    l = np.where(M[:, 200:880].sum(axis=1) > 40)[0]; crane = int(l.min()) if len(l) else 459
    n = len(m.replace('-', '').replace("'", ''))
    cap = 300 if n < 7 else 250 if n < 10 else 230
    f0 = ImageFont.truetype(ANTON, 100); cap0 = f0.getbbox('H')[3] - f0.getbbox('H')[1]
    size = min(100 * cap / cap0, 100 * 960 / f0.getlength(m)); f = ImageFont.truetype(ANTON, size)
    choix = {'cap': cap, 'chevauche': 45}
    for ch in (291, 220, 160, 120, 80, 45):
        t = Image.new('L', (M.shape[1], M.shape[0]), 0)
        ImageDraw.Draw(t).text(((M.shape[1] - f.getlength(m)) / 2, crane + ch), m, font=f, fill=255, anchor='ls')
        T = np.asarray(t) > 128
        if T.sum() and (T & M).sum() / T.sum() <= 0.30: choix = {'cap': cap, 'chevauche': ch}; break
    _MS[(m, masque)] = choix
    return choix
def carte(dossier, t, t_in):
    i = int((t - t_in) * 30) + 1
    try: im = Image.open('%s/%03d.png' % (dossier, max(1, i))).convert('RGB')
    except FileNotFoundError: im = Image.open('%s/090.png' % dossier).convert('RGB')
    im = im.resize((CW, int(im.height * CW / im.width)), Image.LANCZOS)
    top = int(im.height * 0.10); im = im.crop((0, top, CW, top + CH))
    m = Image.new('L', (CW, CH), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, CW - 1, CH - 1], 38, fill=255)
    c = im.convert('RGBA'); c.putalpha(m); return c

def calque_demos(t, t_in, W, H):
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for k, dossier in enumerate(DEMOS):
        cote = 'g' if k == 0 else 'd'
        cible = MARGE if cote == 'g' else W - MARGE - CW
        depart = -CW - 20 if cote == 'g' else W + 20
        p = ease((t - t_in) / 0.35)
        x = depart + (cible - depart) * p
        c = carte(dossier, t, t_in)
        rot = (1 - p) * (-8 if cote == 'g' else 8)
        if abs(rot) > 0.05: c = c.rotate(rot, resample=Image.BICUBIC, expand=True)
        sm = Image.new('L', (W, H), 0); sm.paste(c.split()[3], (int(x), CY + 14))
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sh.putalpha(sm.filter(ImageFilter.GaussianBlur(20)).point(lambda v: int(v * 0.4)))
        lay.alpha_composite(sh); lay.alpha_composite(c, (int(x), CY))
    return lay

def main():
    G = phrases(json.load(open('words.json')))
    # Axel 26/10 : les 2 derniers mots avant le mot fort (« à devenir ») passent DEVANT en bas, juste au-dessus du mot fort ;
    # les démos arrivent à ce moment-là (dès la fin de « vraiment »)
    # Axel 26/10 : plusieurs mots forts possibles (« AVATAR IA » … « QUALITÉ-LÀ ») : chacun DEVANT en vert pendant son
    # tour ; le DERNIER tient jusqu'à la fin, précédé de ses 2 mots (devant aussi) et des démos
    k = max(i for i, g in enumerate(G) if g[3])
    G = G[:k + 1]; G[k] = (G[k][0], 99, G[k][2], True)
    debut, fin, gm, _ = G[k - 1]
    pre = None
    if len(gm) >= 3:
        G[k - 1] = (debut, gm[-2][1] - 0.02, gm[:-2], False)
        pre = (gm[-2][1] - 0.02, G[k + 1][0] if k + 1 < len(G) else 99, gm[-2:])
    elif CONF.get('groupes'):            # groupe déjà écrit à la main (« AVEC CETTE ») : il passe devant tel quel
        pre = (debut, 99, gm); G.pop(k - 1); k -= 1
    t_demo = pre[0] if pre else G[k][0]
    subprocess.run(['mkdir', '-p', 'oE'])
    n = len(subprocess.run(['ls', 'f'], capture_output=True, text=True).stdout.split())
    for i in range(n):
        t = i / FPS
        fond = Image.open('f/%03d.png' % (i + 1)).convert('RGBA'); W, H = fond.size
        personne = fond.copy(); personne.putalpha(Image.open('m2/%03d.png' % (i + 1)).convert('L'))
        derriere = Image.new('RGBA', (W, H), (0, 0, 0, 0)); devant = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        if t >= t_demo: derriere.alpha_composite(calque_demos(t, t_demo, W, H))   # démos DERRIÈRE l'avatar
        if pre and pre[0] <= t < pre[1]: dessine(devant, t, pre[2], BLANC, 105, 1430)   # « À DEVENIR » au-dessus du mot fort
        for debut, fin, gm, fort in G:
            if not (debut <= t < fin): continue
            if fort: dessine(devant, t, gm, VERT, 150, 1600, une_ligne=False)   # mot fort long (« 100 RÉELS INSTAGRAM ») : 2 lignes, pas rétréci
            elif t >= t_demo: continue                                              # Axel 26/10 : rien après le mot fort
            elif len(gm) == 1:
                ms = mot_seul(gm[0][0]); dessine(derriere, t, gm, BLANC, ms['cap'], 459 + DY + ms['chevauche'])
            else: dessine(derriere, t, gm, BLANC, 105, 470 + DY)
        img = fond.copy(); img.alpha_composite(derriere); img.alpha_composite(personne); img.alpha_composite(devant)
        img.convert('RGB').save('oE/%03d.png' % (i + 1))
    json.dump({'t_demo': round(t_demo, 3), 'dy': DY}, open('oE/meta.json', 'w'))   # woosh à l'arrivée des démos
    print('crâne décalé de', DY, 'px | démos à', round(t_demo, 2), [(round(a, 2), ' '.join(m for m, _ in g)) for a, _, g, _ in G], pre and ' '.join(m for m, _ in pre[2]))
if __name__ == "__main__": main()
