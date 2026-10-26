#!/usr/bin/env python3
# Texte incrusté — un CTA habillé de A à Z depuis la banque (Axel 26/10) :
#   python3 usine/incruste/cta_auto.py CTA-PLAN <url du clip CTA Omni> <dossier> [--couleur x] [--teinte x]
# masque précalculé (masques.py), mots dits (captions.mjs), consigne + groupes de la banque (factory_bricks.meta.incruste),
# cta.py → <dossier>/cta-incruste.mp4 (+ <dossier>/cta/words.json : mots du clip brut, à copier dans le cache de build.mjs).
import json, os, shutil, subprocess, sys, urllib.request
ICI = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(os.path.join(ICI, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'usine', 'lots')); sys.path.insert(0, ICI)
from outils import q, log
import masques

def run(*a, **kw): subprocess.run(list(a), check=True, **kw)

def main():
    a = sys.argv[1:]
    if len(a) < 3: raise SystemExit('usage : cta_auto.py CTA URL DOSSIER [--couleur x] [--teinte x]')
    cta, url, d = a[0], a[1], os.path.abspath(a[2]); opt = dict(zip(a[3::2], a[4::2]))
    b = q("select meta->'incruste' i from factory_bricks where id = '%s';" % cta)
    banque = (b[0]['i'] if b else None) or {}
    if isinstance(banque, str): banque = json.loads(banque)
    if not banque.get('consigne'): raise SystemExit('%s absent de la banque (usine/incruste/banque.json)' % cta)
    c = os.path.join(d, 'cta'); os.makedirs(c, exist_ok=True)
    clip = os.path.join(c, 'cta.mp4')
    if not os.path.exists(clip): urllib.request.urlretrieve(url, clip)
    for s in ('f', 'o'): shutil.rmtree(os.path.join(c, s), ignore_errors=True); os.makedirs(os.path.join(c, s))
    run('ffmpeg', '-v', 'error', '-y', '-i', clip, os.path.join(c, 'f', '%03d.png'))
    if not os.path.isdir(os.path.join(c, 'm2')) or len(os.listdir(os.path.join(c, 'm2'))) != len(os.listdir(os.path.join(c, 'f'))):
        shutil.rmtree(os.path.join(c, 'm2'), ignore_errors=True); masques.pour(url, os.path.join(c, 'm2'))
    if not os.path.exists(os.path.join(c, 'words.json')):
        run('node', os.path.join(REPO, 'usine', 'captions.mjs'), 'emit', clip, '0', os.path.join(c, 'words.json'), stdout=subprocess.DEVNULL)
    fps = round(masques.fps_de(clip), 3)
    json.dump({'fps': fps, 'consigne': banque['consigne'], 'groupes': banque['groupes']}, open(os.path.join(c, 'incruste.json'), 'w'), ensure_ascii=False)
    style = {'une_ligne': True, **{k[2:]: v for k, v in opt.items() if k in ('--couleur', '--teinte')}}   # groupes sur une ligne, comme le hook
    json.dump(style, open(os.path.join(d, 'incruste.json'), 'w'), ensure_ascii=False)   # couleur lue par hook.py (importé)
    r = subprocess.run(['python3', os.path.join(ICI, 'cta.py')], cwd=d, capture_output=True, text=True)
    if r.returncode: raise SystemExit('cta.py : ' + (r.stdout + r.stderr)[-600:])
    log(cta, r.stdout.strip().splitlines()[-1][:200])
    run('ffmpeg', '-v', 'error', '-y', '-framerate', str(fps), '-i', os.path.join(c, 'o', '%03d.png'), '-i', clip, '-map', '0:v', '-map', '1:a',
        '-c:v', 'h264_videotoolbox', '-b:v', '20M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', os.path.join(d, 'cta-incruste.mp4'))
    log('→', os.path.join(d, 'cta-incruste.mp4'))

if __name__ == '__main__': main()
