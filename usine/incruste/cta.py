# CTA « texte incrusté » (Axel 26/10) : la consigne (« COMMENTE PLAN ») DEVANT en bas, mot-clé en vert ; le reste de la phrase
# DERRIÈRE l'avatar détouré, en groupes au-dessus de la tête (même style que le hook).
# Réglages facultatifs dans cta/incruste.json : {"fps": 24, "consigne": "COMMENTE GUIDE",
#   "groupes": "SI TU VEUX / RECEVOIR / … / COMMENTE GUIDE / ET JE TE L'ENVOIE"} — groupes écrits à la main (texte affiché,
#   « commande » entendu par Whisper → COMMENTE), alternance mot seul / groupe ; la consigne peut être au milieu de la phrase
#   (elle apparaît quand elle est dite et reste jusqu'à la fin). Sans fichier : consigne = 2 premiers mots (CTA-PLAN).
import json, os
import numpy as np
from PIL import Image
from hook import dessine, decoupe, mot_seul, voile, BLANC, VERT, STYLE

CONF = json.load(open('cta/incruste.json')) if os.path.exists('cta/incruste.json') else {}
FPS = CONF.get('fps', 24)
mots = json.load(open('cta/words.json'))
nett = lambda w: w['text'].strip(',.!?;:').upper()

# positions calées sur le haut du crâne du CTA (même repère que le hook : A1-11 = y 459)
M = np.asarray(Image.open('cta/m2/001.png').convert('L')) > 128
lignes = np.where(M[:, 200:880].sum(axis=1) > 40)[0]
DY = CONF.get('dy', (int(lignes.min()) if len(lignes) else 459) - 459)

if CONF.get('groupes'):
    # groupes écrits (banque) ALIGNÉS sur les mots dits, comme le hook (hook.decoupe) : « commande » entendu → COMMENTE
    # affiché, « » ignorés, un mot dit non écrit (« simplement ») sauté
    cible, G, consigne = CONF['consigne'].split(), [], None
    for g in decoupe(mots, CONF['groupes']):
        gm = [(m, t) for m, t, _ in g]
        if [m for m, _ in gm] == cible: consigne = gm
        else: G.append(gm)
    if not consigne: raise SystemExit('consigne « %s » absente des groupes' % CONF['consigne'])
else:
    # consigne = le verbe + le mot-clé qui suit
    consigne = [(nett(mots[0]), -1.0), (nett(mots[1]), mots[1]['start'])]
    # groupes de 3 mots / 16 lettres max derrière la tête
    G, cur = [], []
    for w in mots[2:]:
        t = nett(w)
        if cur and (len(cur) >= 3 or sum(len(m) for m, _ in cur) + len(t) > 16):
            G.append(cur); cur = []
        cur.append((t, w['start']))
    if cur: G.append(cur)
bornes = [(g[0][1] - 0.02, (G[i + 1][0][1] - 0.02) if i + 1 < len(G) else 99, g) for i, g in enumerate(G)]
print('crâne décalé de', DY, 'px | consigne', consigne, '| groupes', [' '.join(m for m, _ in g) for g in G])
n = len(os.listdir('cta/f'))
os.makedirs('cta/o', exist_ok=True)
for i in range(n):
    t = i / FPS
    fond = Image.open('cta/f/%03d.png' % (i + 1)).convert('RGBA'); W, H = fond.size
    personne = fond.copy(); personne.putalpha(Image.open('cta/m2/%03d.png' % (i + 1)).convert('L'))
    derriere = Image.new('RGBA', (W, H), (0, 0, 0, 0)); devant = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # consigne : COMMENTE (blanc) au-dessus, PLAN (vert, gros) dessous — même place que « à devenir / FLIPPANT » du hook
    if STYLE == 'neon': voile(devant)   # style néon : bas de l'image assombri en permanence (pas de clignotement)
    if STYLE == 'neon':   # style néon : le verbe posé au-dessus du mot-clé, 80 % de sa taille
        hf, cf = dessine(devant, t, consigne[1:], VERT, 150, 1600)
        dessine(devant, t, consigne[:1], BLANC, 0.8 * cf, hf - 0.3 * cf)
    else:
        dessine(devant, t, consigne[:1], BLANC, 105, 1430)
        dessine(devant, t, consigne[1:], VERT, 150, 1600)
    for a, b, g in bornes:
        if a <= t < b:   # même règle que le hook : mot seul GRAND derrière la tête, groupe plus petit au-dessus
            if len(g) == 1:
                ms = mot_seul(g[0][0], 'cta/m2/001.png'); dessine(derriere, t, g, BLANC, ms['cap'], 459 + DY + ms['chevauche'])
            else: dessine(derriere, t, g, BLANC, 105, 470 + DY)
    img = fond.copy(); img.alpha_composite(derriere); img.alpha_composite(personne); img.alpha_composite(devant)
    img.convert('RGB').save('cta/o/%03d.png' % (i + 1))
