#!/usr/bin/env python3
"""Banque des « textes choc » du Décupleur → render-worker/assets/dc-textes/NN.png + textes.json.

Les textes sont PRÉ-RENDUS en PNG transparents (Bricolage Grotesque 800, blanc, contour et ombre noirs, comme la maquette)
puis posés sur la vidéo par le moteur avec le filtre `overlay` : aucune dépendance à drawtext / freetype côté serveur.
Largeur de référence 1080 px (le moteur met à l'échelle de la vidéo). Relancer après avoir changé la liste :
    python3 tools/decupleur/textes-choc.py   (fontTools + Pillow + brotli)
"""
import io, json, os, sys
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
POLICE = os.path.join(RACINE, 'render-worker', 'assets', 'fonts', 'BricolageGrotesque-800-latin.woff2')
SORTIE = os.path.join(RACINE, 'render-worker', 'assets', 'dc-textes')
TEXTES = [
    "ATTENDS LA FIN",
    "REGARDE JUSQU’À LA FIN",
    "PERSONNE NE PARLE DE ÇA",
    "TU DOIS VOIR ÇA",
    "LA FIN VA TE CHOQUER",
    "TU NE VAS PAS Y CROIRE",
    "REGARDE BIEN",
    "ÇA CHANGE TOUT",
    "SAUVEGARDE CETTE VIDÉO",
    "ON NE T’A JAMAIS DIT ÇA",
    "C’EST TROP FORT",
    "INCROYABLE",
]
LARGEUR, TAILLE, MARGE, LIGNE_MAX = 1080, 66, 36, 900


def police():
    f = TTFont(POLICE)          # woff2 → TTF en mémoire (Pillow ne lit pas le woff2)
    f.flavor = None
    buf = io.BytesIO(); f.save(buf); buf.seek(0)
    return ImageFont.truetype(buf, TAILLE)


def lignes(txt, fnt, d):
    # une ligne si elle tient ; sinon DEUX lignes équilibrées (jamais un mot orphelin seul en dessous)
    if d.textlength(txt, font=fnt) <= LIGNE_MAX: return [txt]
    mots = txt.split()
    coupes = [(' '.join(mots[:k]), ' '.join(mots[k:])) for k in range(1, len(mots))]
    return list(min(coupes, key=lambda c: max(d.textlength(c[0], font=fnt), d.textlength(c[1], font=fnt))))


def rendre(txt, fnt):
    tmp = ImageDraw.Draw(Image.new('L', (1, 1)))
    ls = lignes(txt, fnt, tmp)
    asc, desc = fnt.getmetrics()
    pas = int((asc + desc) * 1.02)
    H = MARGE * 2 + pas * len(ls)
    calque = Image.new('RGBA', (LARGEUR, H), (0, 0, 0, 0))
    ombre = Image.new('RGBA', (LARGEUR, H), (0, 0, 0, 0))
    dc, do = ImageDraw.Draw(calque), ImageDraw.Draw(ombre)
    for i, l in enumerate(ls):
        w = tmp.textlength(l, font=fnt)
        x, y = (LARGEUR - w) / 2, MARGE + i * pas
        do.text((x, y + 4), l, font=fnt, fill=(0, 0, 0, 205), stroke_width=6, stroke_fill=(0, 0, 0, 205))
        dc.text((x, y), l, font=fnt, fill=(255, 255, 255, 255), stroke_width=4, stroke_fill=(0, 0, 0, 255))
    ombre = ombre.filter(ImageFilter.GaussianBlur(7))
    img = Image.alpha_composite(ombre, calque)
    bb = img.getbbox()
    return img.crop((0, max(0, bb[1] - 8), LARGEUR, min(H, bb[3] + 8)))


def main():
    os.makedirs(SORTIE, exist_ok=True)
    fnt = police()
    liste = []
    for k, t in enumerate(TEXTES, 1):
        nom = '%02d.png' % k
        rendre(t, fnt).save(os.path.join(SORTIE, nom), optimize=True)
        liste.append({'fichier': nom, 'texte': t})
    with open(os.path.join(SORTIE, 'textes.json'), 'w', encoding='utf-8') as f:
        json.dump(liste, f, ensure_ascii=False, indent=1)
    print(len(liste), 'textes →', SORTIE)


if __name__ == '__main__':
    sys.exit(main())
