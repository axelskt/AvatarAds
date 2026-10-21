#!/usr/bin/env python3
# Creative Factory — VISUEL du format « VOIX OFF Motion Control » (Axel 21/10) : on garde la VOIX d'une prise Omni Flash
# (hook de l'avatar) mais on ne montre pas l'avatar : le RÉSULTAT Motion Control en plein écran, l'ORIGINAL en médaillon.
# Recette du médaillon = celle des assemblages HK (assemble-hk.mjs, 18/10) : 405×720 à (520, 450) — 200 px plus bas (texte choc au-dessus, Axel 21/10) — bord 3 px blanc 92 %,
# coins 28 px, ombre douce ; plein écran en cover avec un léger zoom 1,05 → 1 sur 0,8 s. Les deux clips bouclent ENSEMBLE
# (mêmes durées) jusqu'à la fin de la voix + 1 s — le monteur (build.mjs --avant-apres) coupe au raccord.
# Paires : ~/Downloads/Vidéo/Motion Control (N = original, N.1 = résultat) — TX-M01 (1 → 1.1), TX-M02 (2 → 2.1),
# TX-M04 (4 → 4.1 ; organique seulement, jamais en pub — Axel 21/10).
# + TX-O (Omni) : 02a/02b/02c (Clio → Porsche / Bugatti / char), 06 (207 → Ferrari), 10 / 11 (intérieurs Porsche / Lambo), 12 / 12b (207 → hélico / Lambo).
# usage : python3 usine/voix-off-mc.py <prise-voix.mp4> <TX-…> <sortie.mp4>
import os, subprocess, sys, zlib

voice, tx, out = sys.argv[1], sys.argv[2], sys.argv[3]
# --med x,y,w,h : autre médaillon (format fond vert, Axel 21/10 : « bien plus petit », 338×600 à (600, 440))
MEDARG = next((sys.argv[i + 1] for i, x in enumerate(sys.argv) if x == '--med' and i + 1 < len(sys.argv)), None)
MC, OM = os.path.expanduser('~/Downloads/Vidéo/Motion Control'), os.path.expanduser('~/Downloads/Vidéo/OMNI')
# 21/10 (Axel : « lance les TX et TX-M ») : même format avec les transformations OMNI — (dossier, avant, après, départ)
PAIRS = {'TX-M01': (MC, 'VIdéo 1.mp4', 'Vidéo 1.1.mp4', 1.0), 'TX-M02': (MC, 'Vidéo 2.mp4', 'Vidéo 2.1.mp4', 1.0), 'TX-M04': (MC, 'Vidéo 4.mp4', 'Vidéo 4.1.mp4', 0.3),
         'TX-O02a': (OM, 'Vidéo 2.mp4', 'Vidéo 2.1.mp4', 2.0), 'TX-O02b': (OM, 'Vidéo 2.mp4', 'Vidéo 2.2.mp4', 2.0), 'TX-O02c': (OM, 'Vidéo 2.mp4', 'vidéo 2.3.mp4', 0.5),
         'TX-O06': (OM, 'vidéo 6.mp4', 'Vidéo 6.1.mp4', 0), 'TX-O10': (OM, 'vidéo 10.mp4', 'vidéo 10.1.mp4', 0), 'TX-O11': (OM, 'vidéo 11.mp4', 'vidéo 11.1.mp4', 0),
         'TX-O12': (OM, 'vidéo 12.mp4', 'vidéo 12.1.mp4', 0), 'TX-O12b': (OM, 'vidéo 12.mp4', 'vidéo 12.2.mp4', 0)}
dur = lambda f: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)
D = dur(voice) + 1.0
R, W, H, X, Y = 28, 405, 720, 520, 450   # 21/10 (Axel) : médaillon 200 px plus bas que les HK → le texte choc tient en haut
if MEDARG: X, Y, W, H = map(int, MEDARG.split(',')); R = 24
# Axel 21/10 (revue fond vert) : « quand le hook est plus long que la transformation, ça met juste en boucle » → on ENCHAÎNE
# d'autres avant / après de la même famille (Motion Control ou Omni, jamais la même vidéo d'origine), à temps ÉGAL : le moins
# de paires possible pour que chacune tienne sa part sans boucler (une paire trop courte ne boucle plus qu'en dernier recours).
SRC = lambda t: t[:6]   # TX-O02a / 02b / 02c = même Clio d'origine
utile = lambda t: dur(os.path.join(PAIRS[t][0], PAIRS[t][2])) - PAIRS[t][3]
fam = sorted([t for t in PAIRS if t[:4] == tx[:4] and SRC(t) != SRC(tx)], key=lambda t: zlib.crc32((os.path.basename(out) + t).encode()))
cands = [tx]
for t in fam:
    if all(SRC(t) != SRC(u) for u in cands): cands.append(t)
U = {t: utile(t) for t in cands}
# parts égales sur la VOIX (la seconde de marge finale, coupée au raccord par build.mjs, prolonge la dernière paire)
tient = lambda n: min(U[t] for t in cands[:n]) / ((D - 1) / n)   # ≥ 1 : chaque paire tient sa part sans boucler
n = next((n for n in range(1, len(cands) + 1) if tient(n) >= 0.99), max(range(1, len(cands) + 1), key=tient))
seq = cands[:n]
PART = (D - 1) / len(seq)
# coins arrondis : alpha nul hors du rectangle aux coins de rayon R (même masque pour le médaillon et son ombre)
mask = "a='if(gt(pow(max(0,abs(X-%g)-%g),2)+pow(max(0,abs(Y-%g)-%g),2),%d),0,255)'" % (W / 2, W / 2 - R, H / 2, H / 2 - R, R * R)
def segment(t, d, dst):
    src, avant, apres, t0 = PAIRS[t]
    CX = {'TX-M01': 0.45}.get(t, 0.5)   # centre du recadrage plein écran (TX-M01 est en paysage : visage à gauche du centre)
    fc = ("[0:v]scale=1134:2016:force_original_aspect_ratio=increase:flags=lanczos,crop=1134:2016:'max(0\\,min(iw-1134\\,iw*%.2f-567))':0,"   # 21/10 : source paysage (TX-M01) ou 3:4 → plein écran d'abord
          "scale=w='trunc(1134-54*(1-pow(1-min(t/0.8\\,1)\\,3)))/2*2':h=-2:eval=frame:flags=lanczos,crop=1080:1920,setsar=1,fps=30[bg];"
          "[1:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,pad=%d:%d:3:3:color=white@0.92,format=rgba,"
          "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':%s,fps=30,split[m][m2];"
          "[m2]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.72,pad=%d:%d:60:60:color=black@0,boxblur=24:2[sh];"
          "[bg][sh]overlay=%d:%d[b1];[b1][m]overlay=%d:%d,format=yuv420p[v]"
          % (CX, W - 6, H - 6, W - 6, H - 6, W, H, mask, W + 120, H + 120, X - 60, Y - 60 + 26, X, Y))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-stream_loop', '-1', '-ss', '%.2f' % t0, '-i', os.path.join(src, apres),
                    '-stream_loop', '-1', '-ss', '%.2f' % t0, '-i', os.path.join(src, avant), '-filter_complex', fc, '-map', '[v]',
                    '-frames:v', str(round(d * 30)), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', dst], check=True)
if len(seq) == 1: segment(tx, D, out)
else:
    parts = ['%s.p%d.mp4' % (out, i) for i in range(len(seq))]
    for i, t in enumerate(seq): segment(t, PART + (1 if i == len(seq) - 1 else 0), parts[i])
    lst = out + '.txt'; open(lst, 'w').write(''.join("file '%s'\n" % os.path.abspath(p_) for p_ in parts))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', out], check=True)
    for f in parts + [lst]: os.remove(f)
print('%s : %s, %.2f s (voix %.2f s + 1 s) · build.mjs --avant-apres --medaillon %d,%d,%d,%d' % (out, ' → '.join(seq), D, D - 1, X, Y, W, H))
