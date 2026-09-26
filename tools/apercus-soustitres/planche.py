#!/usr/bin/env python3
"""planche.py — planche contact des vignettes de sous-titres (PIL, local, gratuit).

    python3 tools/apercus-soustitres/planche.py <liste.json> <sortie.jpg> "<titre>" [colonnes]

liste.json = [{"id": "S20", "label": "…", "jpg": "/chemin/S20.jpg", "sub": "…"}] ; chaque vignette 540×960 est
posée à 360×640 avec son identifiant et son libellé dessous.
"""
import json
import sys
import textwrap
from PIL import Image, ImageDraw, ImageFont

src, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 5
items = json.load(open(src, encoding='utf-8'))

AV = '/System/Library/Fonts/Avenir Next.ttc'
f_title = ImageFont.truetype(AV, 44, index=0)
f_id = ImageFont.truetype(AV, 30, index=8)
f_lbl = ImageFont.truetype(AV, 22, index=5)
f_sub = ImageFont.truetype(AV, 19, index=7)

TW, TH, GAP, PAD, CAP = 360, 640, 28, 48, 150
rows = (len(items) + cols - 1) // cols
W = PAD * 2 + cols * TW + (cols - 1) * GAP
H = PAD + 70 + rows * (TH + CAP) + (rows - 1) * GAP + PAD
img = Image.new('RGB', (W, H), '#101014')
d = ImageDraw.Draw(img)
d.text((PAD, PAD - 6), title, font=f_title, fill='#F5F5F6')

for i, it in enumerate(items):
    r, c = divmod(i, cols)
    x = PAD + c * (TW + GAP)
    y = PAD + 70 + r * (TH + CAP + GAP)
    th = Image.open(it['jpg']).convert('RGB').resize((TW, TH), Image.LANCZOS)
    img.paste(th, (x, y))
    d.rounded_rectangle((x, y + TH + 14, x + 72, y + TH + 52), radius=8, fill='#FF5A36')
    d.text((x + 36, y + TH + 33), it['id'], font=f_id, fill='#101014', anchor='mm')
    if it.get('sub'):
        d.text((x + 84, y + TH + 33), it['sub'], font=f_sub, fill='#9A9AA5', anchor='lm')
    lines = textwrap.wrap(it['label'], width=31)[:3]
    for k, ln in enumerate(lines):
        d.text((x, y + TH + 62 + k * 28), ln, font=f_lbl, fill='#F5F5F6')

img.save(out, quality=88)
print('planche :', out, f'{W}x{H}')
