# Fabrique les visuels des e-mails (images/*.jpg) à partir des démos LP et des vraies générations AvatarAds.
# Uniquement de vraies captures : frames de vidéos ou images générées, recadrées, jamais de visuel inventé.
# Règles d'Axel (05/10) : une image différente par e-mail, jamais l'image « 10 millions » (démo Montage LP),
# l'image doit montrer le sujet de l'e-mail, aucun produit d'une vraie marque (Fenty, LV, AXE, SVR…).
import os, subprocess, tempfile
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HOME = os.path.expanduser('~')
DL = f'{HOME}/Downloads'
DEMOS = f'{DL}/Contenue LP + Connexion'
LP = f'{DL}/Autre SaaS/avatarads-membres/assets/lp'
UGC = f'{DL}/Vidéo/Vidéo UGC'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'images')
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp()

MC = f'{DEMOS}/Motion Control LP v4 (fond blanc web).mp4'
IM = f'{DEMOS}/Images IA (MCP fond clair web).mp4'
GEN = f'{DEMOS}/Générateur — vidéo complète (v1).mp4'
AU = f'{DEMOS}/Nettoyage audio LP (web).mp4'
W = 1000          # largeur des JPEG (affichés à 484 px dans la carte : nets en Retina)
GAP = 16
BG = (255, 255, 255)
ORANGE = (255, 107, 53)

def frame(video, t):
    p = os.path.join(TMP, f'{abs(hash((video, t)))}.png')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', video, '-vframes', '1', p], check=True)
    return Image.open(p).convert('RGB')

def photo(path):
    return Image.open(path).convert('RGB')

def region(img, box, pad=36, thr=26):
    """Recadre sur la zone utile : coupe la boîte, puis serre sur ce qui diffère du fond (coin haut-gauche)."""
    im = img.crop(box)
    bg = Image.new('RGB', im.size, im.getpixel((2, 2)))
    diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > thr else 0)
    bb = diff.getbbox()
    if not bb:
        return im
    x0, y0, x1, y1 = bb
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))

def cover(img, ratio, fy=0.5):
    """Recadrage au ratio largeur/hauteur demandé ; fy place la fenêtre verticalement (0 = haut)."""
    w, h = img.size
    if w / h > ratio:
        nw = int(h * ratio); x = (w - nw) // 2
        return img.crop((x, 0, x + nw, h))
    nh = int(w / ratio); y = int((h - nh) * fy)
    return img.crop((0, y, w, y + nh))

def rounded(img, r=18):
    m = Image.new('L', img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, img.width - 1, img.height - 1), r, fill=255)
    out = Image.new('RGB', img.size, BG); out.paste(img, (0, 0), m)
    return out

def font(size, weight=650):
    f = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
    try: f.set_variation_by_axes([100, 28, 400, weight])
    except Exception: pass
    return f

def pill(img, text, x=18, y=18):
    """Étiquette blanche en haut à gauche (« La photo », « Après Omni »…)."""
    d = ImageDraw.Draw(img); f = font(25)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.rounded_rectangle((x, y, x + r - l + 32, y + b - t + 22), 99, fill=(255, 255, 255), outline=(214, 211, 205), width=2)
    d.text((x + 16 - l, y + 11 - t), text, font=f, fill=(21, 21, 26))
    return img

def row(tiles):
    """Tuiles côte à côte, même hauteur, largeur totale W."""
    h0 = 1000
    tiles = [t.resize((int(t.width * h0 / t.height), h0), Image.LANCZOS) for t in tiles]
    s = (W - GAP * (len(tiles) - 1)) / sum(t.width for t in tiles)
    tiles = [t.resize((round(t.width * s), round(h0 * s)), Image.LANCZOS) for t in tiles]
    out = Image.new('RGB', (W, tiles[0].height), BG); x = 0
    for t in tiles:
        out.paste(rounded(t), (x, 0)); x += t.width + GAP
    return out

def fit(img, ratio, bg):
    """Place l'image entière au centre d'un cadre au ratio demandé (fond de la démo autour)."""
    w, h = img.size
    W2, H2 = (w, round(w / ratio)) if w / h > ratio else (round(h * ratio), h)
    W2, H2 = int(W2 * 1.08), int(H2 * 1.08)
    out = Image.new('RGB', (W2, H2), bg); out.paste(img, ((W2 - w) // 2, (H2 - h) // 2))
    return out

def grid(tiles, cols=2, ratio=1.0, fys=None):
    """Grille de vignettes au même ratio (cols colonnes), largeur totale W."""
    fys = fys or [.3] * len(tiles)
    tw = (W - GAP * (cols - 1)) // cols; th = round(tw / ratio); rows = (len(tiles) + cols - 1) // cols
    out = Image.new('RGB', (W, rows * th + (rows - 1) * GAP), BG)
    for i, (t, fy) in enumerate(zip(tiles, fys)):
        out.paste(rounded(cover(t, ratio, fy).resize((tw, th), Image.LANCZOS)), ((i % cols) * (tw + GAP), (i // cols) * (th + GAP)))
    return out

def pair(before, after, l1, l2, ratio=3/4, fy=(.3, .3)):
    """Avant → après : deux images au même ratio, étiquetées, flèche orange entre les deux (comme dans l'app)."""
    tw = (W - GAP) // 2; th = round(tw / ratio)
    a = pill(cover(before, ratio, fy[0]).resize((tw, th), Image.LANCZOS), l1)
    b = pill(cover(after, ratio, fy[1]).resize((tw, th), Image.LANCZOS), l2)
    out = row([a, b]); d = ImageDraw.Draw(out)
    cx, cy, r = W // 2, out.height // 2, 34
    d.ellipse((cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6), fill=BG)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=ORANGE)
    d.line((cx - 13, cy, cx + 12, cy), fill=BG, width=6)
    d.line((cx + 1, cy - 12, cx + 13, cy), fill=BG, width=6); d.line((cx + 1, cy + 12, cx + 13, cy), fill=BG, width=6)
    return out

def blur(img, *boxes):
    """Floute des zones (plaques d'immatriculation)."""
    out = img.copy()
    for b in boxes:
        out.paste(img.crop(b).filter(ImageFilter.GaussianBlur(18)), b[:2])
    return out

def save(img, name):
    if img.width > W:
        img = img.resize((W, round(img.height * W / img.width)), Image.LANCZOS)
    p = os.path.join(OUT, name)
    img.save(p, 'JPEG', quality=80, optimize=True, progressive=True)
    print(f'{name:28s} {img.width}x{img.height}  {os.path.getsize(p) // 1024} Ko')

# --- Sources (une image = un e-mail ; jamais deux fois la même frame ni le même avatar en vedette) ----------
# Duos photo → vidéo Express : la photo générée et la vidéo qu'Express en a tirée
lune_photo = photo(f'{DL}/Image IA /Fille/avatarads-image-8.png')
lune_video = frame(f'{UGC}/Femme/avatarads-express-2 copie.mp4', 1.5)
villa_photo = photo(f'{DL}/Image IA /Fille/image-1786915135887.jpg')
villa_video = frame(f'{UGC}/Femme/mcp-J-ai-ete-creee.mp4', 2.0)      # générée depuis Claude (MCP)
# Vidéos UGC avec produit (produits sans marque réelle)
ugc_sdb = frame(f'{UGC}/Femme/avatarads-express.mov', 2.2)            # salle de bain, soin
ugc_ciao = frame(f'{UGC}/Femme/vido ciao.mp4', 2.2)                   # canette Ciao (marque de démo)
ugc_creme = frame(f'{UGC}/Homme/Montage-IA 2.mp4', 2.2)               # crème
# Montage IA : trois moments d'un vrai montage (Cartoon 21, validé)
C21 = f'{DL}/Contenue AvatarAds/Cartoon 21/montage-v18-dynamic-VALIDE.mp4'
mont_hook, mont_timer, mont_photos = frame(C21, 0.3), frame(C21, 3.9), frame(C21, 16.8)
# Omni (tests d'Axel) : la Clio devient un tank (plaques floutées), la Peugeot devient un hélicoptère
clio = blur(frame(f'{DL}/Vidéo/OMNI/Vidéo 2.mp4', 1.0), (700, 840, 985, 1025), (705, 395, 800, 465), (995, 145, 1080, 210))
tank = blur(frame(f'{DL}/Vidéo/OMNI/vidéo 2.3.mp4', 1.0), (630, 735, 885, 855), (965, 145, 1065, 215), (480, 135, 620, 205))
peugeot = frame(f'{DL}/Vidéo/OMNI/vidéo 12.mp4', 2.0)
helico = frame(f'{DL}/Vidéo/OMNI/vidéo 12.1.mp4', 2.0)
# UGC avec produit (vraies générations ; logos de marques visibles, choix d'Axel le 05/10)
ugc_lune2 = frame(f'{UGC}/Femme/avatarads-express copie 2.mp4', 2.0)
ugc_svrw = frame(f'{UGC}/Femme/avatarads-2.mp4', 2.0)
ugc_lvw = frame(f'{UGC}/Femme/avatarads-4.mp4', 2.0)
ugc_axew = frame(f'{UGC}/Femme/avatarads-5.mp4', 2.0)
ugc_axem = frame(f'{UGC}/Homme/avatarads-3.mp4', 2.0)
ugc_svrm = frame(f'{UGC}/Homme/avatarads.mp4', 2.0)
# Montage IA : un audio → une vidéo montée ; une vidéo brute → la même après montage (même avatar, même pièce)
audio_card = region(frame(AU, 7.6), (330, 270, 1590, 820))
audio_in = fit(audio_card, 3/4, audio_card.getpixel((4, 4)))
monte_1m = frame(f'{DL}/Contenue AvatarAds/Cartoon 12/vidéo 1M.mp4', 3.0)      # « elle n'existe pas. »
brute = frame(f'{UGC}/Homme/Avatar IA 1.mp4', 2.0)
monte_split = frame(f'{DL}/Contenue AvatarAds/Cartoon 15/montage-CARTOON15-slam-TOM-final.mp4', 7.0)  # split : animation « LEUR SECRET » + avatar
# Omni : la Clio devient une Bugatti (plaques floutées)
clio_b = blur(frame(f'{DL}/Vidéo/OMNI/Vidéo 2.mp4', 2.0), (930, 1180, 1080, 1370))
bugatti = blur(frame(f'{DL}/Vidéo/OMNI/Vidéo 2.2.mp4', 2.0), (1040, 1180, 1080, 1400))
imgia_ugc = region(frame(f'{DEMOS}/Image IA LP (web 1080p).mp4', 5.2), (300, 150, 1620, 930))
# Abonnés à 0 crédit : 2 créateurs UGC + 1 visuel produit, 3 produits différents (Axel 06/10), utilisés nulle part ailleurs
z_parfum = frame(f'{UGC}/Homme/avatarads-6.mp4', 2.0)                                   # créateur + parfum
z_serum = photo(f'{DL}/Image IA /Fille/avatarads-ugc-serum-autobronzant-1a478391.png')  # créatrice + sérum autobronzant
z_canette = region(frame(IM, 13.86), (470, 220, 910, 860), pad=0)                       # visuel produit « Ton boost naturel »
# Démos LP
influ4 = region(frame(IM, 22.26), (60, 200, 1800, 870))                   # 4 influenceurs UGC
ads_campagne = region(frame(IM, 14.4), (110, 225, 1420, 870))            # « Attention, la saison arrive »
ads_offre = region(frame(IM, 12.4), (290, 215, 1620, 880))               # 5 raisons / 17 h / offre limitée
mc_ui = region(frame(MC, 2.75), (200, 150, 1700, 1000))                   # déposer → déposer → générer
mc_inset = frame(MC, 7.05)                                               # référence + résultat
mc_split = frame(MC, 12.0)                                               # même geste, deux personnages
gen_avatar = region(frame(GEN, 7.0), (740, 250, 1170, 820), pad=0)
gen_rec = region(frame(GEN, 15.4), (360, 30, 1550, 850), pad=0)
audio = region(frame(AU, 13.8), (160, 260, 1740, 810))
ciao_video = frame(f'{DL}/W CRÉA/NO MUSIC NO SOUS-TITRES/avatarads-express-4.mp4', 4.0)

# --- Visuels par e-mail --------------------------------------------------------------------
save(pair(lune_photo, lune_video, 'La photo', 'La vidéo Express', fy=(.25, .3)), 'photo-video-lune.jpg')  # p0
save(influ4, 'claude-influenceurs.jpg')                                   # p2
save(pair(clio, tank, 'Avant', 'Après Omni', fy=(.2, .2)), 'omni-tank.jpg')                          # p1
save(row([cover(ugc_sdb, 2/3, .3), cover(ugc_ciao, 2/3, .35), cover(ugc_creme, 2/3, .3)]), 'ugc-produits.jpg')  # p3
save(row([cover(mont_hook, 9/16), cover(mont_timer, 9/16), cover(mont_photos, 9/16)]), 'montage-moments.jpg')  # p4
save(mc_split, 'motion-control-geste.jpg')                                # p5
save(ads_campagne, 'campagne-visuels.jpg')                                # p6
save(mc_ui, 'trois-gestes.jpg')                                           # p7
save(pair(peugeot, helico, 'Avant', 'Après Omni', fy=(.5, .5)), 'omni-helicoptere.jpg')                # l1
save(row([gen_avatar, gen_rec]), 'generateur-voix.jpg')                   # l2
save(audio, 'audio-avant-apres.jpg')                                      # l3
save(ads_offre, 'saison-offre.jpg')                                       # l4
save(pair(villa_photo, villa_video, 'La photo', 'La vidéo', fy=(.25, .25)), 'photo-video-villa.jpg')    # c0
save(grid([ciao_video, ugc_lune2, ugc_svrw, ugc_axem], cols=2, ratio=1, fys=[.25, .3, .3, .3]), 'ugc-premiere-video.jpg')  # c1
save(pair(audio_in, monte_1m, 'Ton audio', 'La vidéo montée', fy=(.5, .4)), 'montage-audio-video.jpg')  # c2 (relance)
# Idée de la semaine (rotation w1 → w5)
save(mc_inset, 'motion-control-reference.jpg')                            # w1 Motion Control
save(pair(clio_b, bugatti, 'Avant', 'Après Omni', fy=(.45, .45)), 'omni-bugatti.jpg')                  # w2 Omni
save(row([cover(ugc_lvw, 2/3, .3), cover(ugc_axew, 2/3, .3), cover(ugc_svrm, 2/3, .3)]), 'ugc-createurs.jpg')  # w3 Express
save(pair(brute, monte_split, 'Vidéo brute', 'Après Montage IA', ratio=9/16), 'montage-brute-split.jpg')  # w4 Montage IA
save(imgia_ugc, 'imagesia-createurs.jpg')                                # w5 Images IA
save(row([cover(z_parfum, 2/3, .15), cover(z_serum, 2/3, .3), cover(z_canette, 2/3, 0)]), 'credits-trio.jpg')  # z0 (0 crédit)
