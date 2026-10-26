#!/usr/bin/env python3
# Texte incrusté — un HOOK habillé de A à Z depuis la banque (Axel 26/10), sans rien écrire à la main :
#   python3 usine/incruste/hook_auto.py H23 A1-10 <dossier> [--couleur jaune|vert|rouge] [--teinte jaune|vert|rouge]
# 1. clip Omni de la photo (factory_variants format omni) ; 2. masque précalculé (masques.py, calculé et déposé s'il manque) ;
# 3. mots dits (captions.mjs, Whisper local) ; 4. les 2 Hook démo de la banque (factory_bricks.meta.incruste) ;
# 5. incruste.json (découpage + mots forts de la banque, couleur) ; 6. hook.py ; 7. MP4 avec le woosh à l'arrivée des démos.
# Sortie : <dossier>/hook-incruste.mp4 (+ words.json : mots VÉRIFIÉS du clip brut, à copier dans le cache de build.mjs).
import json, os, shutil, subprocess, sys, urllib.request
ICI = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(os.path.join(ICI, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'usine', 'lots')); sys.path.insert(0, ICI)
from outils import q, log
import masques

def run(*a, **kw): subprocess.run(list(a), check=True, **kw)
def fps_de(f): return masques.fps_de(f)

def main():
    a = sys.argv[1:]
    if len(a) < 3: raise SystemExit('usage : hook_auto.py HOOK PHOTO DOSSIER [--couleur x] [--teinte x]')
    hook, photo, d = a[0], a[1], os.path.abspath(a[2]); opt = dict(zip(a[3::2], a[4::2]))
    os.makedirs(d, exist_ok=True)
    v = q("select video_url from factory_variants where format = 'omni' and brick_id = '%s' and avatar_id = '%s';" % (hook, photo))
    if not v: raise SystemExit('pas de clip Omni %s × %s' % (hook, photo))
    url = v[0]['video_url']
    b = q("select meta->'incruste' i from factory_bricks where id = '%s';" % hook)
    banque = (b[0]['i'] if b else None) or {}
    if isinstance(banque, str): banque = json.loads(banque)
    if not banque.get('groupes'): raise SystemExit('%s absent de la banque (usine/incruste/banque.json)' % hook)
    clip = os.path.join(d, 'hook.mp4')
    if not os.path.exists(clip): urllib.request.urlretrieve(url, clip)
    for s in ('f', 'oE'): shutil.rmtree(os.path.join(d, s), ignore_errors=True); os.makedirs(os.path.join(d, s))
    run('ffmpeg', '-v', 'error', '-y', '-i', clip, os.path.join(d, 'f', '%03d.png'))
    if not os.path.isdir(os.path.join(d, 'm2')) or len(os.listdir(os.path.join(d, 'm2'))) != len(os.listdir(os.path.join(d, 'f'))):
        shutil.rmtree(os.path.join(d, 'm2'), ignore_errors=True); masques.pour(url, os.path.join(d, 'm2'))
    if not os.path.exists(os.path.join(d, 'words.json')):
        run('node', os.path.join(REPO, 'usine', 'captions.mjs'), 'emit', clip, '0', os.path.join(d, 'words.json'), stdout=subprocess.DEVNULL)
    # Hook démo de la banque (aucun : pas de cartes)
    for k, nom in enumerate(['demo', 'demo2']):
        shutil.rmtree(os.path.join(d, nom), ignore_errors=True)
        hd = (banque.get('hook_demos') or [])[k:k + 1]
        if not hd: continue
        m = q("select meta->>'media' m from factory_bricks where id = '%s';" % hd[0])[0]['m']
        src = os.path.join(d, hd[0] + '.mp4')
        if not os.path.exists(src): urllib.request.urlretrieve(m, src)
        os.makedirs(os.path.join(d, nom))
        run('ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', 'fps=30,scale=720:-2', '-t', '6', os.path.join(d, nom, '%03d.png'))
    conf = {'fps': round(fps_de(clip), 3), 'groupes': banque['groupes'], 'une_ligne': True, 'carte': {'w': 320, 'marge': 36}}
    if opt.get('--couleur'): conf['couleur'] = opt['--couleur']
    if opt.get('--teinte'): conf['teinte'] = opt['--teinte']
    json.dump(conf, open(os.path.join(d, 'incruste.json'), 'w'), ensure_ascii=False)
    r = subprocess.run(['python3', os.path.join(ICI, 'hook.py')], cwd=d, capture_output=True, text=True)
    if r.returncode: raise SystemExit('hook.py : ' + (r.stdout + r.stderr)[-600:])
    log(hook, photo, r.stdout.strip().splitlines()[-1][:220])
    t = json.load(open(os.path.join(d, 'oE', 'meta.json')))['t_demo']
    son = ['-i', os.path.join(REPO, 'render-worker', 'assets', 'sfx', 'debut-woosh.mp3')]
    filtre = ('[2:a]volume=-4dB,adelay=%d|%d[w];[1:a][w]amix=inputs=2:normalize=0[a]' % (t * 1000, t * 1000)) if os.path.isdir(os.path.join(d, 'demo')) else '[1:a]anull[a]'
    run('ffmpeg', '-v', 'error', '-y', '-framerate', str(conf['fps']), '-i', os.path.join(d, 'oE', '%03d.png'), '-i', clip, *son,
        '-filter_complex', filtre, '-map', '0:v', '-map', '[a]', '-c:v', 'h264_videotoolbox', '-b:v', '20M', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-shortest', os.path.join(d, 'hook-incruste.mp4'))
    log('→', os.path.join(d, 'hook-incruste.mp4'))

if __name__ == '__main__': main()
