#!/usr/bin/env python3
# Creative Factory — VISUEL du format « FOND VERT » (Axel 21/10) : l'avatar DÉTOURÉ (segmentation de personne Apple Vision,
# usine/person-mask.swift) parle devant le RÉSULTAT d'une transformation en plein écran (Motion Control TX-M ou Omni TX-O),
# l'original dans un PETIT médaillon (338×600 à (600, 440)), le texte choc au-dessus du médaillon (build.mjs
# --medaillon 600,440,338,600 --medaillon-libre 1). Avatar à 45 %, en bas à gauche dans la zone sûre (bas à 1450, fondu de
# 120 px), présent dès la 1re image, puis à mi-hook un petit décalage vers la droite et vers le haut (validé Axel 21/10).
# usage : python3 usine/fond-vert.py <prise.mp4> <TX-…> <sortie.mp4>   (sortie muette : la voix reste la prise, build.mjs)
import glob, os, shutil, subprocess, sys, tempfile

take, tx, out = sys.argv[1], sys.argv[2], sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(os.path.expanduser('~/Downloads/Creative Factory/cache'), 'bin', 'person-mask')
if not os.path.exists(BIN):
    os.makedirs(os.path.dirname(BIN), exist_ok=True)
    subprocess.run(['swiftc', '-O', os.path.join(HERE, 'person-mask.swift'), '-o', BIN], check=True)
dur = lambda f: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)
T = dur(take); M = max(0.6, T * 0.45)   # instant du déplacement (mi-hook)
W = tempfile.mkdtemp(prefix='fondvert-')
try:
    bg = os.path.join(W, 'bg.mp4')
    subprocess.run(['python3', os.path.join(HERE, 'voix-off-mc.py'), take, tx, bg, '--med', '600,440,338,600'], check=True, capture_output=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', take, '-vf', 'fps=25', os.path.join(W, '%04d.png')], check=True)
    subprocess.run([BIN] + sorted(glob.glob(os.path.join(W, '[0-9][0-9][0-9][0-9].png'))), check=True, capture_output=True)
    # Axel 21/10 (version retenue) : l'avatar est LÀ dès la 1re image (en bas à gauche), puis UN petit déplacement à mi-hook
    # (vers la droite et vers le haut, 0,5 s, lissé) — pas de grand parcours ; ensuite il reste fixe jusqu'à la fin.
    ease = lambda a, d: "(1-pow(1-min(max((t-%g)/%g\\,0)\\,1)\\,3))" % (a, d)
    x = "30+120*%s" % ease(M, 0.5)
    y = "1450-h-60*%s" % ease(M, 0.5)
    fc = ("[0:v]fps=25,setsar=1[bg];[2:v]format=gray,boxblur=2:1,geq=lum='lum(X,Y)*min(1,(H-Y)/120)'[m];"
          "[1:v][m]alphamerge,scale=486:864,tpad=stop_mode=clone:stop_duration=1[av];"
          "[bg][av]overlay=x='%s':y='%s':eval=frame:shortest=1,format=yuv420p[v]" % (x, y))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', bg, '-framerate', '25', '-i', os.path.join(W, '%04d.png'), '-framerate', '25',
                    '-i', os.path.join(W, '%04d-m.png'), '-filter_complex', fc, '-map', '[v]', '-t', '%.2f' % (T + 1), '-an',
                    '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '25', out], check=True)
    print('%s : %s, %.2f s · build.mjs --avant-apres --medaillon 600,440,338,600 --medaillon-libre 1' % (out, tx, T + 1))
finally:
    shutil.rmtree(W, ignore_errors=True)
