# CTA « texte incrusté » (Axel 26/10) : la consigne (« COMMENTE PLAN ») DEVANT en bas, mot-clé en vert ; le reste de la phrase
# DERRIÈRE l'avatar détouré, en groupes au-dessus de la tête (même style que le hook).
import json
from PIL import Image
from hook import dessine, BLANC, VERT

FPS = 24
mots = json.load(open('cta/words.json'))
nett = lambda w: w['text'].strip(',.!?;:').upper()
# consigne = le verbe + le mot-clé qui suit
consigne = [(nett(mots[0]), -1.0), (nett(mots[1]), mots[1]['start'])]
reste = mots[2:]
# groupes de 3 mots / 16 lettres max derrière la tête
G, cur = [], []
for w in reste:
    t = nett(w)
    if cur and (len(cur) >= 3 or sum(len(m) for m, _ in cur) + len(t) > 16):
        G.append(cur); cur = []
    cur.append((t, w['start']))
if cur: G.append(cur)
bornes = [(g[0][1] - 0.02, (G[i + 1][0][1] - 0.02) if i + 1 < len(G) else 99, g) for i, g in enumerate(G)]
print('consigne', consigne, '| groupes', [' '.join(m for m, _ in g) for g in G])
n = len(__import__('os').listdir('cta/f'))
__import__('os').makedirs('cta/o', exist_ok=True)
for i in range(n):
    t = i / FPS
    fond = Image.open('cta/f/%03d.png' % (i + 1)).convert('RGBA'); W, H = fond.size
    personne = fond.copy(); personne.putalpha(Image.open('cta/m2/%03d.png' % (i + 1)).convert('L'))
    derriere = Image.new('RGBA', (W, H), (0, 0, 0, 0)); devant = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # consigne : COMMENTE (blanc) au-dessus, PLAN (vert, gros) dessous — même place que « à devenir / FLIPPANT » du hook
    dessine(devant, t, consigne[:1], BLANC, 105, 1430)
    dessine(devant, t, consigne[1:], VERT, 150, 1600)
    for a, b, g in bornes:
        if a <= t < b: dessine(derriere, t, g, BLANC, 105, 470)
    img = fond.copy(); img.alpha_composite(derriere); img.alpha_composite(personne); img.alpha_composite(devant)
    img.convert('RGB').save('cta/o/%03d.png' % (i + 1))
