# Essai 5 (Axel 26/10, reformulé) : mot seul = GRAND derrière la tête (taille de l'essai 2) ; groupe de mots = plus petit,
# phrase entière jusqu'au mot fort (« ça commence vraiment à devenir ») ; mot fort EN BAS, DEVANT, en vert, et à ce moment
# les 2 démos du hook arrivent ensemble (gauche par la gauche, droite par la droite).
import difflib, json, os, re, subprocess, unicodedata
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter
import numpy as np

# Réglages par hook / photo (facultatif) : incruste.json = {"fps": 30, "forts": ["QUALITÉ-LÀ"],
#   "groupes": "LAISSE-MOI / 30 SECONDES / … / QUALITÉ-LÀ", "une_ligne": true, "carte": {"w": 320, "marge": 36}}
# Sans fichier : réglages validés sur H90 × A1-11.
CONF = json.load(open('incruste.json')) if os.path.exists('incruste.json') else {}
FPS = CONF.get('fps', 24)
_POLICES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'polices')
ANTON = 'Anton.ttf' if os.path.exists('Anton.ttf') else os.path.join(_POLICES, 'Anton.ttf')
VERT = (200, 255, 61)
# Couleur du mot fort (Axel 26/10) : défaut = vert validé (200,255,61) à plat. « teinte » = la couleur de devinjatho, SANS
# rien changer d'autre (police, tailles, emplacements validés) : dégradé vertical mesuré sur ses vidéos + léger halo de la
# couleur. incruste.json : {"teinte": "vert"} ou {"teinte": "rouge"}.
# Recette mesurée AU PIXEL sur « DID IT! » de devinjatho (médiane du cœur des lettres, ligne par ligne) :
# liseré clair en haut, dégradé haut → bas très saturé, bord des lettres un peu plus clair, halo vert vif serré + halo
# sombre large (c'est lui qui rend le vert « foncé » et profond). Rouge = même recette (« 2 SH*TS »).
TEINTES = {
    'vert': {'liseré': (180, 251, 161), 'haut': (138, 234, 116), 'bas': (60, 214, 36), 'bord': (150, 242, 128),
             'halo': (40, 205, 40), 'ombre': (8, 60, 10), 'reflet': (228, 250, 222)},
    'rouge': {'liseré': (255, 140, 134), 'haut': (238, 70, 66), 'bas': (192, 16, 16), 'bord': (255, 110, 104),
              'halo': (225, 28, 28), 'ombre': (70, 4, 4), 'reflet': (250, 228, 226)},
    # jaune-vert validé (200,255,61) passé dans la même recette (mêmes écarts de clarté / saturation que le vert mesuré)
    'jaune': {'liseré': (236, 255, 170), 'haut': (212, 252, 118), 'bas': (166, 228, 24), 'bord': (222, 254, 140),
              'halo': (180, 232, 30), 'ombre': (48, 60, 4), 'reflet': (246, 250, 222)},
}
# Couleur À PLAT du mot fort (sans dégradé) : « jaune » = le validé (200,255,61) ; « vert » / « rouge » (Axel 26/10).
COULEURS = {'jaune': (200, 255, 61), 'vert': (64, 222, 52), 'rouge': (218, 12, 24)}   # rouge : Axel 26/10 « un rouge plus rouge » (236,38,38 tirait sur l'orange)
if CONF.get('couleur') in COULEURS and CONF.get('style', 'anton') != 'neon': VERT = COULEURS[CONF['couleur']]
TEINTE = TEINTES.get(CONF.get('teinte'))
# « neon » (police élargie + emplacements changés) : essai du 26/10 ÉCARTÉ par Axel (« je parle juste de la couleur »).
STYLE = CONF.get('style', 'anton')
if STYLE == 'neon': VERT = {'vert': (52, 235, 72), 'rouge': (242, 36, 44)}[CONF.get('couleur', 'vert')]

def police(size):
    if STYLE != 'neon': return ImageFont.truetype(ANTON, size)
    f = ImageFont.truetype('Archivo.ttf' if os.path.exists('Archivo.ttf') else os.path.join(_POLICES, 'Archivo.ttf'), size); f.set_variation_by_axes([900, 125]); return f
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

MARQUE_DEMO = None

def _norme(m):
    m = unicodedata.normalize('NFKD', m.lower()); m = ''.join(c for c in m if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]', '', m)

def decoupe(mots, texte):
    """groupes écrits à la main (« A B / *C D / … », « * » = mot fort DEVANT) ; le texte affiché est celui des groupes.
    Les mots écrits sont ALIGNÉS sur les mots entendus (Whisper peut couper « AvatarAds » en deux ou écrire « 2026 » en
    lettres) : un mot écrit sans correspondance prend un temps interpolé entre ses voisins."""
    global MARQUE_DEMO
    groupes = []
    for g in texte.split('/'):
        g = g.strip()
        if not g: continue
        if g.startswith('>'): MARQUE_DEMO = len(groupes); g = g[1:].strip()   # « > » : les démos arrivent sur ce groupe
        groupes.append((g.lstrip('*').split(), g.startswith('*')))
    ecrits = [m for g, _ in groupes for m in g]
    t = [None] * len(ecrits)
    sm = difflib.SequenceMatcher(None, [_norme(m) for m in ecrits], [_norme(w['text']) for w in mots], autojunk=False)
    for b in sm.get_matching_blocks():
        for k in range(b.size): t[b.a + k] = mots[b.b + k]['start']
    connus = [i for i, x in enumerate(t) if x is not None]
    if len(connus) < 0.6 * len(ecrits):
        raise SystemExit('groupes : %d mots écrits sur %d retrouvés dans ce qui est dit' % (len(connus), len(ecrits)))
    for i in range(len(t)):
        if t[i] is not None: continue
        p = max((k for k in connus if k < i), default=None); n = min((k for k in connus if k > i), default=None)
        t[i] = (max(0.0, t[n] - 0.15 * (n - i)) if p is None else t[p] + 0.2 * (i - p) if n is None
                else t[p] + (t[n] - t[p]) * (i - p) / (n - p))
    brut, i = [], 0
    for g, fort in groupes:
        brut.append([(m, t[i + j], fort or m in FORTS) for j, m in enumerate(g)]); i += len(g)
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

def voile(lay):
    """style néon : bas de l'image assombri (une fois par image) pour que le halo ressorte, comme la réf."""
    if lay.info.get('voile'): return
    W, H = lay.size; a = np.clip((np.arange(H) - H * 0.55) / (H * 0.45), 0, 1) ** 1.3 * 165
    v = np.zeros((H, W, 4), np.uint8); v[:, :, 3] = a.astype(np.uint8)[:, None]
    lay.alpha_composite(Image.fromarray(v)); lay.info['voile'] = 1

def dessine(lay, t, mots, col, cap_px, bas, larg=960, une_ligne=None, dessin=True):
    """dessine les mots (base de la dernière ligne à `bas`) ; renvoie (haut du bloc, hauteur des capitales)"""
    lueur = STYLE == 'neon' and bas > 1200           # textes DEVANT (consigne, mots forts) : halo de leur couleur
    if lueur: larg = 1000
    f0 = police(100); cap0 = f0.getbbox('H')[3] - f0.getbbox('H')[1]
    lignes = lignes_de(mots, une_ligne)
    esp0 = f0.getlength(' ') * (1.0 if STYLE == 'neon' else 1.6)
    largeur = lambda ls: max(sum(f0.getlength(m) for m, _ in l) + esp0 * (len(l) - 1) for l in ls)
    size = min(100 * cap_px / cap0, 100 * larg / largeur(lignes))
    if lueur and len(lignes) == 1 and len(mots) >= 2 and size < 0.8 * 100 * cap_px / cap0 and une_ligne is False:
        # police élargie : un mot fort qui rétrécit trop passe sur 2 lignes (« C'ÉTAIT / AVANT »)
        n = [len(m) for m, _ in mots]; k = min(range(1, len(mots)), key=lambda i: abs(sum(n[:i]) - sum(n[i:])))
        lignes = [mots[:k], mots[k:]]; size = min(100 * cap_px / cap0, 100 * larg / largeur(lignes))
    f = police(size); cap = cap0 * size / 100; esp = esp0 * size / 100
    pas = cap * (1.14 if lueur else 1.22)
    haut = bas - pas * (len(lignes) - 1) - cap
    if not dessin: return haut, cap
    if lueur: voile(lay)
    for li, ligne in enumerate(lignes):
        y = bas - pas * (len(lignes) - 1 - li)
        x = (lay.width - sum(f.getlength(m) for m, _ in ligne) - esp * (len(ligne) - 1)) / 2
        for m, t0 in ligne:
            lw = f.getlength(m)
            if t >= t0 - 0.02:
                a, sc = pop(t, t0)
                pad = int(size * 0.5) if lueur else 30
                img = Image.new('RGBA', (int(lw) + 2 * pad, int(size * 1.2 + pad + size * 0.3)), (0, 0, 0, 0))
                base = (pad, pad + size * 0.9)
                if lueur:   # halo large + halo serré de la couleur du mot (blanc : halo discret)
                    mk = Image.new('L', img.size, 0); ImageDraw.Draw(mk).text(base, m, font=f, fill=255, anchor='ls')
                    for r, k in ((size / 4.5, 0.75 if col != BLANC else 0.30), (size / 14, 0.9 if col != BLANC else 0.35)):
                        g = Image.new('RGBA', img.size, col + (0,)); g.putalpha(mk.filter(ImageFilter.GaussianBlur(r)).point(lambda v, k=k: int(min(255, v * k * 1.6))))
                        img.alpha_composite(g)
                else:
                    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
                    ImageDraw.Draw(sh).text(base, m, font=f, fill=(0, 0, 0, 160), anchor='ls')
                    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(max(4, size / 25))), (0, 5))
                if TEINTE and (col == VERT or (col == BLANC and bas > 1200)):
                    T = TEINTE; mk = Image.new('L', img.size, 0); ImageDraw.Draw(mk).text(base, m, font=f, fill=255, anchor='ls')
                    y0, y1 = base[1] - cap, base[1]
                    k = np.clip((np.arange(img.height) - y0) / max(1, y1 - y0), 0, 1)
                    if col == VERT:
                        for c, r, fo in ((T['ombre'], size / 3.2, 0.55), (T['halo'], size / 10, 0.70)):   # halo sombre large, puis vif serré
                            g = Image.new('RGBA', img.size, c + (0,)); g.putalpha(mk.filter(ImageFilter.GaussianBlur(r)).point(lambda v, fo=fo: int(min(255, v * fo * 1.4))))
                            img.alpha_composite(g)
                        h, b, li = np.array(T['haut']), np.array(T['bas']), np.array(T['liseré'])
                        coul = h[None, :] * (1 - k[:, None]) + b[None, :] * k[:, None]
                        bande = np.clip(1 - (np.arange(img.height) - y0) / max(1.0, cap * 0.07), 0, 1)[:, None]   # liseré clair en haut
                        coul = coul * (1 - bande) + li[None, :] * bande
                    else:   # ligne blanche devant : reflet de la teinte vers le bas
                        coul = np.array((250, 250, 248))[None, :] * (1 - k[:, None]) + np.array(T['reflet'])[None, :] * k[:, None]
                    deg = (coul[:, None, :] * np.ones((1, img.width, 1))).astype(np.uint8)
                    img.alpha_composite(Image.fromarray(np.dstack([deg, np.asarray(mk)]), 'RGBA'))
                    if col == VERT:   # bord des lettres un peu plus clair (contour intérieur de ~2 px)
                        bord = ImageChops.subtract(mk, mk.filter(ImageFilter.MinFilter(5))).point(lambda v: int(v * 0.55))
                        e = Image.new('RGBA', img.size, T['bord'] + (0,)); e.putalpha(bord); img.alpha_composite(e)
                else: ImageDraw.Draw(img).text(base, m, font=f, fill=col + (255,), anchor='ls')
                if sc != 1.0: img = img.resize((max(1, int(img.width * sc)), max(1, int(img.height * sc))), Image.LANCZOS)
                if a < 1:
                    al = np.asarray(img).copy(); al[:, :, 3] = (al[:, :, 3] * a).astype(np.uint8); img = Image.fromarray(al)
                lay.alpha_composite(img, (int(x + lw / 2 - img.width / 2), int(y - base[1] * sc)))
            x += lw + esp
    return haut, cap

CW = CONF.get('carte', {}).get('w', 340); CH = round(CW * 540 / 340); CY = 350 + DY
MARGE = CONF.get('carte', {}).get('marge', 64)
# mot seul derrière la tête : taille des capitales et px cachés sous le haut du crâne (A1-11 : 300 / 291) ; tête large ou
# mot long (« LAISSE-MOI » sur A1-6) → plus petit et plus haut, sinon il disparaît derrière le visage
# Mot seul derrière la tête : il doit rester LISIBLE (Axel 26/10 : « LAISSE-MOI », « CENSÉ », « GRATUITEMENT » à moitié
# cachés sur les photos cadrées serré). On mesure sur le masque de la 1re image la part des lettres que le crâne cacherait
# et on garde la position la plus enfoncée où ≥ 80 % du mot reste visible (A1-11 « WAOUH » : 300 / 291 comme validé).
_MS = {}
def mot_seul(m, masque='m2/001.png'):
    if 'mot_seul' in CONF: return {'cap': 300, 'chevauche': 291, **CONF['mot_seul']}
    if (m, masque) in _MS: return _MS[(m, masque)]
    M = np.asarray(Image.open(masque).convert('L')) > 128
    l = np.where(M[:, 200:880].sum(axis=1) > 40)[0]; crane = int(l.min()) if len(l) else 459
    n = len(m.replace('-', '').replace("'", ''))
    cap = 300 if n < 7 else 250 if n < 10 else 230
    f0 = police(100); cap0 = f0.getbbox('H')[3] - f0.getbbox('H')[1]
    size = min(100 * cap / cap0, 100 * 960 / f0.getlength(m)); f = police(size)
    choix = {'cap': cap, 'chevauche': 45}
    for ch in (291, 220, 160, 120, 80, 45):
        t = Image.new('L', (M.shape[1], M.shape[0]), 0)
        ImageDraw.Draw(t).text(((M.shape[1] - f.getlength(m)) / 2, crane + ch), m, font=f, fill=255, anchor='ls')
        T = np.asarray(t) > 128
        if T.sum() and (T & M).sum() / T.sum() <= 0.20: choix = {'cap': cap, 'chevauche': ch}; break
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

# Bloc SEUL devant (mot fort au milieu, ligne blanche seule) : un peu plus haut que le bas de la pile blanc + mot fort
# (Axel 26/10 : « CHOQUER », « LITTÉRALEMENT » un peu trop bas) ; la pile garde sa place validée (base 1600)
BAS_SEUL = 1510

def empile(G, c, D):
    """groupe blanc c suivi d'un mot fort : empilés (blanc au-dessus) seulement si le bloc reste léger — mot fort sur 1
    ligne ou blanc court (Axel 26/10 : « LITTÉRALEMENT » + « LA PLANQUE / DE CET HIVER » + démos = écran trop rempli)"""
    if c + 1 >= len(G) or c < D or G[c][3] or not G[c + 1][3]: return False
    hf, cf = dessine(None, 0, G[c + 1][2], VERT, 150, 1600, une_ligne=False, dessin=False)
    une_ligne = hf >= 1600 - cf * 1.1
    return une_ligne or sum(len(m) for m, _ in G[c][2]) <= 8

def main_avec_marque(G, D):
    """banque avec « > » : avant les démos, comme d'habitude (mot seul / groupe derrière la tête, mots forts devant) ;
    à partir du groupe D, les démos arrivent et les sous-titres continuent DEVANT, un bloc à la fois, JUSQU'À LA FIN
    (Axel 26/10 : « il n'y a pas les sous-titres jusqu'à la fin ») ; le dernier groupe tient jusqu'à la fin."""
    t_demo = G[D][0]; G[-1] = (G[-1][0], 99, G[-1][2], G[-1][3])
    os.makedirs('oE', exist_ok=True)
    n = len(os.listdir('f'))
    for i in range(n):
        t = i / FPS
        fond = Image.open('f/%03d.png' % (i + 1)).convert('RGBA'); W, H = fond.size
        personne = fond.copy(); personne.putalpha(Image.open('m2/%03d.png' % (i + 1)).convert('L'))
        derriere = Image.new('RGBA', (W, H), (0, 0, 0, 0)); devant = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        if t >= t_demo and os.path.isdir('demo'): derriere.alpha_composite(calque_demos(t, t_demo, W, H))
        if t < t_demo:
            for debut, fin, gm, fort in G[:D]:
                if not (debut <= t < min(fin, t_demo)): continue
                if fort: dessine(devant, t, gm, VERT, 150, BAS_SEUL, une_ligne=False)
                elif len(gm) == 1:
                    ms = mot_seul(gm[0][0]); dessine(derriere, t, gm, BLANC, ms['cap'], 459 + DY + ms['chevauche'])
                else: dessine(derriere, t, gm, BLANC, 105, 470 + DY)
        else:
            c = max(j for j in range(D, len(G)) if G[j][0] <= t or j == D)
            if G[c][3]:
                if empile(G, c - 1, D):   # le blanc d'avant reste au-dessus
                    hf, cf = dessine(devant, t, G[c][2], VERT, 150, 1600, une_ligne=False, dessin=False)
                    dessine(devant, t, G[c - 1][2], BLANC, 105, min(1430, hf - 0.22 * cf))
                dessine(devant, t, G[c][2], VERT, 150, 1600 if empile(G, c - 1, D) else BAS_SEUL, une_ligne=False)
            elif empile(G, c, D):         # blanc qui sera surmonté : déjà à sa place du dessus
                hf, cf = dessine(devant, t, G[c + 1][2], VERT, 150, 1600, une_ligne=False, dessin=False)
                dessine(devant, t, G[c][2], BLANC, 105, min(1430, hf - 0.22 * cf))
            else: dessine(devant, t, G[c][2], BLANC, 120, BAS_SEUL, une_ligne=False)
        img = fond.copy(); img.alpha_composite(derriere); img.alpha_composite(personne); img.alpha_composite(devant)
        img.convert('RGB').save('oE/%03d.png' % (i + 1))
    json.dump({'t_demo': round(t_demo, 3), 'dy': DY}, open('oE/meta.json', 'w'))
    print('crâne décalé de', DY, 'px | démos à', round(t_demo, 2), [(round(a, 2), ' '.join(m for m, _ in g)) for a, _, g, _ in G])

def main():
    G = phrases(json.load(open('words.json')))
    if MARQUE_DEMO is not None: return main_avec_marque(G, MARQUE_DEMO)
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
    if pre:
        hf0, cf0 = dessine(None, 0, G[k][2], VERT, 150, 1600, une_ligne=False, dessin=False)
        leger_final = hf0 >= 1600 - cf0 * 1.1 or sum(len(m) for m, _ in pre[2]) <= 8
    else: leger_final = False
    subprocess.run(['mkdir', '-p', 'oE'])
    n = len(subprocess.run(['ls', 'f'], capture_output=True, text=True).stdout.split())
    for i in range(n):
        t = i / FPS
        fond = Image.open('f/%03d.png' % (i + 1)).convert('RGBA'); W, H = fond.size
        personne = fond.copy(); personne.putalpha(Image.open('m2/%03d.png' % (i + 1)).convert('L'))
        derriere = Image.new('RGBA', (W, H), (0, 0, 0, 0)); devant = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        if STYLE == 'neon': voile(devant)   # bas de l'image assombri en permanence (pas de clignotement)
        if t >= t_demo and os.path.isdir('demo'): derriere.alpha_composite(calque_demos(t, t_demo, W, H))   # hook sans Hook démo : pas de cartes   # démos DERRIÈRE l'avatar
        if pre and pre[0] <= t < pre[1]:   # « À DEVENIR » au-dessus du mot fort
            if STYLE == 'neon':   # posé juste au-dessus du bloc du dernier mot fort (1 ou 2 lignes), 80 % de sa taille
                hf, cf = dessine(devant, t, G[k][2], VERT, 150, 1600, une_ligne=False, dessin=False)
                dessine(devant, t, pre[2], BLANC, 0.8 * cf, hf - 0.3 * cf)
            else:   # posé au-dessus du dernier mot fort ; s'il tient sur 2 lignes (« 1000 EUROS / PAR JOUR »), il remonte —
                    # et un blanc long sur un mot fort de 2 lignes (« LITTÉRALEMENT » / « LA PLANQUE DE CET HIVER ») s'efface
                    # quand le mot fort arrive (Axel 26/10 : écran trop rempli)
                hf, cf = dessine(devant, t, G[k][2], VERT, 150, 1600, une_ligne=False, dessin=False)
                leger = hf >= 1600 - cf * 1.1 or sum(len(m) for m, _ in pre[2]) <= 8
                if leger: dessine(devant, t, pre[2], BLANC, 105, min(1430, hf - 0.22 * cf))
                elif t < G[k][0]: dessine(devant, t, pre[2], BLANC, 120, BAS_SEUL, une_ligne=False)   # seul, avant le mot fort
        for debut, fin, gm, fort in G:
            if not (debut <= t < fin): continue
            if fort:   # mot fort long (« 100 RÉELS INSTAGRAM ») : 2 lignes, pas rétréci ; seul → un peu plus haut
                final_empile = gm is G[k][2] and pre is not None and (STYLE == 'neon' or leger_final)
                dessine(devant, t, gm, VERT, 150, 1600 if final_empile else BAS_SEUL, une_ligne=False)
            elif t >= t_demo: continue                                              # Axel 26/10 : rien après le mot fort
            elif len(gm) == 1:
                ms = mot_seul(gm[0][0]); dessine(derriere, t, gm, BLANC, ms['cap'], 459 + DY + ms['chevauche'])
            else: dessine(derriere, t, gm, BLANC, 105, 470 + DY)
        img = fond.copy(); img.alpha_composite(derriere); img.alpha_composite(personne); img.alpha_composite(devant)
        img.convert('RGB').save('oE/%03d.png' % (i + 1))
    json.dump({'t_demo': round(t_demo, 3), 'dy': DY}, open('oE/meta.json', 'w'))   # woosh à l'arrivée des démos
    print('crâne décalé de', DY, 'px | démos à', round(t_demo, 2), [(round(a, 2), ' '.join(m for m, _ in g)) for a, _, g, _ in G], pre and ' '.join(m for m, _ in pre[2]))
if __name__ == "__main__": main()
