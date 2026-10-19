#!/usr/bin/env python3
# Creative Factory — ACCÉLÈRE les clips Omni (hooks + CTA) trop lents (Axel 19/10 : « tous les anciens clips en 1,00x : mets-les
# tous minimum en 1,10x, hook et CTA »). Pour chaque variante ACTIVE (la plus récente par photo × brique, comme lot.py) dont la
# vitesse est sous le minimum : téléchargement, accélération (image setpts + voix atempo, hauteur gardée), même encodage que
# derush.py, dépôt variants/<nom>-x110.mp4 puis NOUVELLE ligne factory_variants (elle devient la variante active). L'ancien
# fichier et son ancienne ligne restent (rien n'est supprimé).
# Vitesse d'un fichier = suffixe -xNNN (-x110, -x105…) ; sans suffixe = prise brute 1,00x (clips d'avant la règle du 16/10).
# usage : python3 usine/lots/accelerer.py [--min 1.10] [--go]   (sans --go : liste seulement)
import argparse, os, re, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import q, storage_cp, head_url, get, B, log

ap = argparse.ArgumentParser()
ap.add_argument('--min', type=float, default=1.10)
ap.add_argument('--go', action='store_true')
a = ap.parse_args()

# déjà accélérés SANS suffixe dans le nom (13/10 : CTA-CLAUDE A4 « ×1,10 ») — sinon ils passeraient à 1,21x
DEJA_110 = {'A4-1-CTA-CLAUDE-omni-v2.mp4', 'A4-3-CTA-CLAUDE-omni.mp4'}
def vitesse(url):
    if os.path.basename(url) in DEJA_110: return 1.10
    m = re.search(r'-x(\d{3})(?:-v\d+)?\.mp4$', url)
    return int(m.group(1)) / 100 if m else 1.0

latest = {}
for r in q("select avatar_id a, brick_id b, video_url u, created_at from factory_variants where format='omni' order by created_at"):
    latest[(r['a'], r['b'])] = r
lents = [(k, r, vitesse(r['u'])) for k, r in sorted(latest.items()) if vitesse(r['u']) < a.min - 1e-6]
log('%d variantes actives, %d sous x%.2f' % (len(latest), len(lents), a.min))
cible = int(round(a.min * 100))
for (av, br), r, v in lents:
    f = a.min / v
    base = os.path.basename(r['u'])[:-4]
    base = re.sub(r'-x\d{3}(-v\d+)?$', '', base)
    dst = 'variants/%s-x%d.mp4' % (base, cible)
    log('%s %s : x%.2f → x%.2f (facteur %.4f) → %s' % (av, br, v, a.min, f, dst))
    if not a.go: continue
    code, _ = head_url(B + '/' + dst)
    if code == 200: log('  déjà déposé, ligne seulement');
    else:
        with tempfile.TemporaryDirectory() as d:
            src, out = os.path.join(d, 'in.mp4'), os.path.join(d, 'out.mp4')
            subprocess.run(['curl', '-sfL', '-o', src, r['u']], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-filter_complex', '[0:v]setpts=PTS/%.6f[v];[0:a]atempo=%.6f[a]' % (f, f),
                            '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p',
                            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], check=True)
            if not storage_cp(out, dst, 'video/mp4'): log('  ✗ dépôt'); continue
            code, size = head_url(B + '/' + dst)
            if code != 200 or size != os.path.getsize(out): log('  ✗ relecture (%s, %s)' % (code, size)); continue
    q("insert into factory_variants (avatar_id, brick_id, video_url, format) values ('%s','%s','%s','omni')" % (av, br, B + '/' + dst))
    log('  ✓')
