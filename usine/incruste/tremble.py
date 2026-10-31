# Axel 31/10 : le tremblement sur CHAQUE vidéo, texte incrusté compris. Mêmes courbes que SHAKE de build.mjs (zoom 1,09,
# rotation 0,4°, 8 px), appliquées à la prise ET à son masque AVANT l'habillage : le texte reste fixe, le crâne est mesuré
# après le tremblement (hook.py / cta.py lisent m2/001.png), et le détourage reste calé sur l'image.
import math, os
from PIL import Image

def matrice(t, W, H):
    k = W / 1080
    a = math.radians(0.4 * (math.sin(5.7 * t) + 0.4 * math.sin(11.3 * t)))
    dx = 8 * k * (math.sin(6.3 * t) + 0.5 * math.sin(12.9 * t + 1) + 0.3 * math.sin(19.7 * t))
    dy = 8 * k * (math.cos(7.1 * t) + 0.5 * math.sin(13.7 * t + 0.5) + 0.25 * math.sin(22.3 * t))
    c, s, cx, cy = math.cos(a) / 1.09, math.sin(a) / 1.09, W / 2, H / 2
    return (c, -s, c * (dx - cx) - s * (dy - cy) + cx, s, c, s * (dx - cx) + c * (dy - cy) + cy)   # image de sortie → prise

def dossiers(f, m2, fps):
    """remplace f/NNN.png et m2/NNN.png par leur version tremblée (m2/ peut être fait de liens vers le cache : on écrit à la place du lien)."""
    for nom in sorted(os.listdir(f)):
        if not nom.endswith('.png'): continue
        i = int(nom[:-4]) - 1
        for dos in (f, m2):
            p = os.path.join(dos, nom); im = Image.open(p); im.load()
            sortie = im.transform(im.size, Image.AFFINE, matrice(i / fps, *im.size), resample=Image.BICUBIC)
            if os.path.islink(p): os.remove(p)
            sortie.save(p)
