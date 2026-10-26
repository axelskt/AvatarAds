#!/usr/bin/env python3
# Texte incrusté — MASQUES D'AVATAR calculés UNE fois par clip Omni (Axel 26/10 : « on ne peut pas détourer toutes les briques
# Omni Flash ? on gagnerait du temps sur chaque montage »). Un masque = vidéo en niveaux de gris, même cadence et même
# nombre d'images que le clip, rangée dans factory-media/masques/<nom du clip>-masque.mp4.
#   python3 usine/incruste/masques.py --tout            détoure tous les clips Omni (hooks + CTA) qui n'ont pas encore leur masque
#   python3 usine/incruste/masques.py --pour <url> m2   récupère le masque d'un clip dans le dossier m2/ (001.png, 002.png…),
#                                                       et le calcule + le dépose s'il manque encore
# Détourage : rembg isnet-general-use sur une image réduite à 540×960 (~0,8 s / image) — la qualité validée sur les 5 essais.
import glob, json, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lots'))
from outils import B, q, storage_cp, log

def nom(url): return os.path.basename(url).rsplit('.', 1)[0]
def url_masque(url): return '%s/masques/%s-masque.mp4' % (B, nom(url))

def existe(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=20) as r: return r.status == 200
    except Exception: return False

_SESSION = None
def detoure(dossier_f, dossier_m):
    global _SESSION
    from rembg import new_session, remove
    from PIL import Image
    if _SESSION is None: _SESSION = new_session('isnet-general-use')
    os.makedirs(dossier_m, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(dossier_f, '*.png'))):
        out = os.path.join(dossier_m, os.path.basename(f))
        if os.path.exists(out): continue
        im = Image.open(f).convert('RGB')
        remove(im.resize((540, 960)), session=_SESSION, only_mask=True).resize(im.size, Image.BILINEAR).save(out)

def fps_de(f):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', f],
                       capture_output=True, text=True).stdout.strip() or '24/1'
    a, b = r.split('/'); return float(a) / float(b or 1)

def calcule(url):
    """télécharge le clip, le détoure, dépose le masque ; renvoie l'URL du masque (le clip et les images sont supprimés)"""
    t0 = time.time(); tmp = tempfile.mkdtemp(prefix='masque-')
    try:
        clip = os.path.join(tmp, 'clip.mp4'); urllib.request.urlretrieve(url, clip)
        os.makedirs(os.path.join(tmp, 'f'))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', clip, os.path.join(tmp, 'f', '%03d.png')], check=True)
        detoure(os.path.join(tmp, 'f'), os.path.join(tmp, 'm'))
        out = os.path.join(tmp, nom(url) + '-masque.mp4')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '%g' % fps_de(clip), '-i', os.path.join(tmp, 'm', '%03d.png'),
                        '-c:v', 'libx264', '-crf', '8', '-preset', 'slow', '-pix_fmt', 'gray', out], check=True)
        if not storage_cp(out, 'masques/' + os.path.basename(out), 'video/mp4'): raise RuntimeError('dépôt du masque')
        log('masque', nom(url), '%d images, %.0f s' % (len(os.listdir(os.path.join(tmp, 'm'))), time.time() - t0))
        return url_masque(url)
    finally: shutil.rmtree(tmp, ignore_errors=True)

def pour(url, dossier_m):
    """masque d'un clip → dossier_m/001.png… (le calcule et le dépose s'il n'existe pas encore)"""
    m = url_masque(url)
    if not existe(m): calcule(url)
    os.makedirs(dossier_m, exist_ok=True)
    tmp = tempfile.mktemp(suffix='.mp4'); urllib.request.urlretrieve(m, tmp)
    try: subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, os.path.join(dossier_m, '%03d.png')], check=True)
    finally: os.remove(tmp)

if __name__ == '__main__':
    if sys.argv[1:2] == ['--pour']: pour(sys.argv[2], sys.argv[3]); sys.exit()
    if sys.argv[1:2] != ['--tout']: raise SystemExit('usage : --tout | --pour <url> <dossier>')
    rows = q("select avatar_id, brick_id, video_url from factory_variants where format = 'omni' "
             "and brick_id not ilike '%GRILLE%' order by (brick_id like 'CTA%'), avatar_id, brick_id;")
    a_faire = [r for r in rows if not existe(url_masque(r['video_url']))]
    log('%d clips Omni, %d masques à calculer' % (len(rows), len(a_faire)))
    for i, r in enumerate(a_faire, 1):
        try: calcule(r['video_url']); log('  %d / %d' % (i, len(a_faire)))
        except Exception as e: log('  ✗', r['avatar_id'], r['brick_id'], str(e)[-200:])
    log('fini')
