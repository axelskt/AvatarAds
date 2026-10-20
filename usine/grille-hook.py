#!/usr/bin/env python3
# Creative Factory — HOOK « GRILLE QUI SE MULTIPLIE » (Axel 20/10, H89 « je ne sais pas comment c'est légal, mais je fais
# plus de 100 réels Instagram par heure comme ça ») : juste après le mot de départ, l'écran passe à 4, 16, 64 puis 256
# vidéos (une étape toutes les 0,5 s, un « snap » à chaque étape). L'avatar d'origine est la SEULE tuile qui parle ; les
# autres sont des vidéos différentes et muettes (vidéos UGC du dossier broll + hooks Omni des autres photos), réutilisées
# avec des départs décalés sur la couche à 256 pour qu'aucune tuile voisine ne soit identique au même moment.
#   --place coin    : l'avatar est la première tuile (haut-gauche)            (format validé 20/10)
#   --place centre  : l'avatar est posé au CENTRE de la grille à chaque étage (Axel 20/10)
#   --retour 4.22   : à ce temps (« comme ça »), retour à la vue plein écran de l'avatar
# usage : python3 usine/grille-hook.py hook.mp4 sortie.mp4 --t0 1.22 [--pas 0.5] [--place coin|centre] [--retour 4.22]
# Les tuiles sont préparées dans un dossier de travail temporaire (rien n'est gardé en local, sortie comprise si on la dépose).
import argparse, glob, os, random, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument('hook'); ap.add_argument('out')
ap.add_argument('--t0', type=float, required=True)
ap.add_argument('--pas', type=float, default=0.5)
ap.add_argument('--place', choices=['coin', 'centre'], default='coin')
ap.add_argument('--retour', type=float, default=None)
ap.add_argument('--graine', type=int, default=256)
a = ap.parse_args()

CF = os.path.expanduser('~/Downloads/Creative Factory')
SFX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'render-worker', 'assets', 'sfx', 'snap.mp3')
ff = lambda *x: subprocess.run(['ffmpeg', '-v', 'error', '-y', *x], check=True)
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.hook], capture_output=True, text=True).stdout)
NIV = [(4, 2), (16, 4), (64, 8)]            # étages composés ici (n, colonnes) ; 256 = 4 quadrants 8×8 préparés à part
T = [a.t0 + i * a.pas for i in range(4)]   # début des étages 4, 16, 64, 256
FIN = min(a.retour, dur) if a.retour else dur
D = FIN - a.t0 + 0.2

# ── sources : vidéos UGC + un hook par photo×hook (jamais le hook de départ lui-même) ──
base = os.path.basename(a.hook).split('-omni')[0]
br = sorted(glob.glob(os.path.join(CF, 'cache', 'broll', '*.mp4')))
seen, hk = set(), []
for f in sorted(glob.glob(os.path.join(CF, 'cache', 'lots', 'cache', 'A*-H*-omni*.mp4'))):
    k = os.path.basename(f).split('-omni')[0]
    if k != base and k not in seen: seen.add(k); hk.append(f)
src = br + hk; random.seed(a.graine); random.shuffle(src); N = len(src)

W = tempfile.mkdtemp(prefix='grille-')
def prep(arg):   # tuile grande (540×960, 3 premiers étages) et petite (67×119 bordée, couche 256)
    i, f = arg
    ff('-stream_loop', '-1', '-i', f, '-t', '9', '-an', '-vf', 'scale=540:960:force_original_aspect_ratio=increase,crop=540:960,fps=24',
       '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', os.path.join(W, 'g%03d.mp4' % i))
    ff('-stream_loop', '-1', '-i', f, '-t', '9', '-an', '-vf', 'scale=65:117:force_original_aspect_ratio=increase,crop=65:117,pad=67:119:1:1:black,fps=24',
       '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', os.path.join(W, 'p%03d.mp4' % i))
with ThreadPoolExecutor(8) as ex: list(ex.map(prep, enumerate(src)))

# tuile k d'un étage : en mode coin, la tuile 0 est l'avatar ; en mode centre, toutes les tuiles sont des sources (l'avatar est posé par-dessus)
AV0 = a.place == 'coin'
def source(k): return (k - (1 if AV0 else 0)) % N, ((k - (1 if AV0 else 0)) // N) * 2.3

# ── couche 256 : 4 quadrants 8×8 de tuiles 67×119 (temps 0 = t0) ──
for q in range(4):
    args, fc = [], []
    for j in range(64):
        k = q * 64 + j
        if AV0 and k == 0:
            args += ['-ss', '%.3f' % a.t0, '-i', a.hook]
            fc.append('[%d:v]scale=65:117:force_original_aspect_ratio=increase,crop=65:117,pad=67:119:1:1:black,fps=24,setsar=1[t%d]' % (j, j))
        else:
            s, off = source(k); args += ['-ss', '%.2f' % off, '-i', os.path.join(W, 'p%03d.mp4' % s)]
            fc.append('[%d:v]setsar=1,setpts=PTS-STARTPTS[t%d]' % (j, j))
    fc.append(''.join('[t%d]' % j for j in range(64)) + 'xstack=inputs=64:grid=8x8[v]')
    ff(*args, '-filter_complex', ';'.join(fc), '-map', '[v]', '-t', '%.2f' % D, '-an', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '24', os.path.join(W, 'Q%d.mp4' % q))
g256 = os.path.join(W, 'g256.mp4')
ff('-ss', '%.3f' % a.t0, '-i', a.hook, *sum([['-i', os.path.join(W, 'Q%d.mp4' % q)] for q in range(4)], []), '-filter_complex',
   '[0:v]scale=1080:1920,boxblur=30:3,eq=brightness=-0.25,setsar=1[bg];[1:v][2:v][3:v][4:v]xstack=inputs=4:grid=2x2[g];[bg][g]overlay=(W-w)/2:(H-h)/2:shortest=1[v]',
   '-map', '[v]', '-t', '%.2f' % D, '-an', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '24', g256)

# ── montage : plein écran → 4 → 16 → 64 → 256 (→ plein écran au retour) ──
NT = 64 - (1 if AV0 else 0)                 # tuiles « sources » utilisées par l'étage 64
inputs = ['-i', a.hook] + sum([['-i', os.path.join(W, 'g%03d.mp4' % (k % N))] for k in range(NT)], []) + ['-i', g256, '-i', SFX]
GI, SI = NT + 1, NT + 2
uses = {k: sum(1 for n, c in NIV if n - (1 if AV0 else 0) > k) for k in range(NT)}
fc = ['[0:v]split=%d[base][fin]%s[bgsrc]' % (len(NIV) + 3 + len(NIV), ''.join('[a%d]' % i for i in range(len(NIV))) + ''.join('[m%d]' % i for i in range(len(NIV)))),
      '[bgsrc]scale=1080:1920,boxblur=30:3,eq=brightness=-0.25,split=%d%s' % (len(NIV), ''.join('[bg%d]' % i for i in range(len(NIV))))]
for k in range(NT):
    if uses[k]: fc.append('[%d:v]setpts=PTS+%.3f/TB,split=%d%s' % (k + 1, a.t0, uses[k], ''.join('[u%d_%d]' % (k, j) for j in range(uses[k]))))
cnt = {k: 0 for k in range(NT)}
for i, (n, c) in enumerate(NIV):
    tw = 1080 // c; th = tw * 16 // 9; g = max(1, 8 // c); tiles = []
    for p in range(n):
        if AV0 and p == 0:
            fc.append('[a%d]scale=%d:%d,pad=%d:%d:%d:%d:black[q%d_0]' % (i, tw-2*g, th-2*g, tw, th, g, g, i)); tiles.append('[q%d_0]' % i)
        else:
            k = p - (1 if AV0 else 0); lab = '[u%d_%d]' % (k, cnt[k]); cnt[k] += 1
            fc.append('%sscale=%d:%d,pad=%d:%d:%d:%d:black[q%d_%d]' % (lab, tw-2*g, th-2*g, tw, th, g, g, i, p)); tiles.append('[q%d_%d]' % (i, p))
    if not AV0: fc.append('[a%d]nullsink' % i)
    fc.append('%sxstack=inputs=%d:grid=%dx%d[gr%d]' % (''.join(tiles), n, c, c, i))
    fc.append('[bg%d][gr%d]overlay=(W-w)/2:(H-h)/2:eof_action=pass[L%d]' % (i, i, i))
fc.append('[%d:v]setpts=PTS+%.3f/TB[L3]' % (GI, a.t0))
# mode centre : l'avatar (son, image d'origine) posé au centre, à la taille d'une tuile de l'étage
TAILLES = [(540, 960, 4), (270, 480, 2), (135, 240, 1), (67, 119, 1)]
for i in range(len(NIV)): fc.append('[m%d]nullsink' % i)
if not AV0:
    fc.append('[fin]split=2[fin0][mc]')
    fc.append('[mc]split=4%s' % ''.join('[mv%d]' % i for i in range(4)))
    for i, (w, h, g) in enumerate(TAILLES):
        fc.append('[mv%d]scale=%d:%d,pad=%d:%d:%d:%d:black[av%d]' % (i, w-2*g, h-2*g, w, h, g, g, i))
        lab = 'L%d' % i
        fc.append('[%s][av%d]overlay=(W-w)/2:(H-h)/2:eof_action=pass[C%d]' % (lab, i, i))
    LAB = ['C0', 'C1', 'C2', 'C3']; FINLAB = 'fin0'
else:
    LAB = ['L0', 'L1', 'L2', 'L3']; FINLAB = 'fin'
segs = [('base', 0, a.t0)] + [(LAB[i], T[i], T[i + 1] if i < 3 else FIN) for i in range(4)]
if a.retour and a.retour < dur: segs.append((FINLAB, a.retour, dur))
else: fc.append('[%s]nullsink' % FINLAB)
outs = []
for j, (lab, s, e) in enumerate(segs):
    fc.append('[%s]trim=%.3f:%.3f,setpts=PTS-STARTPTS,setsar=1[c%d]' % (lab, s, e, j)); outs.append('[c%d]' % j)
fc.append('%sconcat=n=%d:v=1:a=0[v]' % (''.join(outs), len(outs)))
snaps = T + ([a.retour] if a.retour and a.retour < dur else [])
fc.append('[%d:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=%d%s' % (SI, len(snaps), ''.join('[k%d]' % i for i in range(len(snaps)))))
for i, t in enumerate(snaps): fc.append('[k%d]volume=0.5,adelay=%d|%d[p%d]' % (i, int(t * 1000), int(t * 1000), i))
fc.append('[0:a]aformat=sample_rates=48000:channel_layouts=stereo[voix];[voix]%samix=inputs=%d:duration=first:normalize=0[a]' % (''.join('[p%d]' % i for i in range(len(snaps))), len(snaps) + 1))
fcf = os.path.join(W, 'fc.txt'); open(fcf, 'w').write(';'.join(fc))
ff(*inputs, '-filter_complex_script', fcf, '-map', '[v]', '-map', '[a]', '-t', '%.3f' % dur, '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '24',
   '-c:a', 'aac', '-b:a', '192k', a.out)
subprocess.run(['rm', '-rf', W])
print('%s : grille %s, étages à %s%s' % (a.out, a.place, ', '.join('%.2f' % t for t in T), (', retour plein écran à %.2f' % a.retour) if a.retour else ''))
