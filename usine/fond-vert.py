#!/usr/bin/env python3
# Creative Factory — VISUEL du format « FOND VERT » (Axel 21/10) : l'avatar DÉTOURÉ (segmentation de personne Apple Vision,
# usine/person-mask.swift) parle devant le RÉSULTAT d'une transformation en plein écran (Motion Control TX-M ou Omni TX-O),
# l'original dans un PETIT médaillon (338×600 à (600, 440)), le texte choc au-dessus du médaillon (build.mjs
# --medaillon 600,440,338,600 --medaillon-libre 1). Avatar à 45 %, en bas à gauche dans la zone sûre (bas à 1450, fondu de
# 120 px), il entre en glissant depuis la gauche puis, à mi-hook, se décale vers la droite et vers le haut (validé Axel).
# usage : python3 usine/fond-vert.py <prise.mp4> <TX-…> <sortie.mp4>   (sortie muette : la voix reste la prise, build.mjs)
import glob, os, shutil, subprocess, sys, tempfile

take, tx, out = sys.argv[1], sys.argv[2], sys.argv[3]
LARGE = '--large' in sys.argv   # mouvement ample (Axel 21/10, essai)
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
    ease = lambda a, d: "(1-pow(1-min(max((t-%g)/%g\\,0)\\,1)\\,3))" % (a, d)
    if LARGE:
        # Axel 21/10 (« plus de mouvement, partout où il y a des traits rouges ») : l'avatar parcourt la zone gauche / centre / bas
        # sous le médaillon — entrée par la gauche, puis haut-gauche, centre, bas-droite, retour — glissés lissés (smoothstep)
        K = [(0, -520, 586), (0.35, 30, 586), (0.27 * T, 70, 470), (0.5 * T, 300, 540), (0.75 * T, 470, 586), (T, 150, 520)]
        def path(i):
            e = '%d' % K[-1][i]
            for (t0, *a), (t1, *b) in reversed(list(zip(K, K[1:]))):
                u = 'min(max((t-%.3f)/%.3f\\,0)\\,1)' % (t0, max(0.05, t1 - t0))
                e = 'if(lt(t\\,%.3f)\\,%d+%d*(%s*%s*(3-2*%s))\\,%s)' % (t1, a[i - 1], b[i - 1] - a[i - 1], u, u, u, e)
            return e
        x, y = path(1), path(2)
    else:
        x = "if(lt(t\\,0.35)\\,-520+550*%s\\,30+150*%s)" % (ease(0, 0.35), ease(M, 0.5))
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
