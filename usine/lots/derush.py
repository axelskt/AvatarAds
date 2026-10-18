#!/usr/bin/env python3
# Creative Factory — DÉRUSH d'une prise Omni (hook ou CTA) : resserre les blancs ENTRE les mots, retire les syllabes
# parasites, puis accélère (18/10).
# Axel 18/10 (CTA « Commente go… » : 3 blancs de 0,3-0,6 s) : « fais un dérush propre pour supprimer les silences ».
# Axel 18/10, 2e tour : blancs ramenés à 0,08 s = « ça fait robot » → on ne coupe que les blancs ≥ --min (0,30 s) et on en garde
# --garde (0,20 s, une respiration) ; et « quand tu fais un dérush mets un petit zoom léger, sinon ça fait trop brut » → un plan
# sur deux est légèrement zoomé (--zoom 1.07, centré sur le visage) : la coupe devient un recadrage voulu, pas un saut d'image.
# Un blanc = énergie < seuil (fenêtres de 20 ms) — seuil = --seuil dB, relevé à bruit de fond + 7 dB quand la pièce est
# bruyante (bureau A3-11 : fond à 42 dB, rien n'était détecté à 40). La garde est partagée de chaque côté pour ne pas manger
# une consonne douce (ch / j / f tiennent autour de 40-48 dB). Les blancs de début et de fin sont retirés de la même façon.
# --retirer a-b (répétable) : enlève un passage précis (syllabe parasite repérée au spectre, ex. A3-7·H77 « à vue » 2.60-3.11).
# --garder-blancs : ne touche pas aux blancs (seulement --retirer + début / fin).
# usage : python3 usine/lots/derush.py prise.mp4 sortie.mp4 [--vitesse 1.15] [--debut 0] [--fin 5.83] [--retirer 2.60-3.11]
#         [--garder-blancs] [--zoom 1.07] [--seuil 40] [--min 0.30] [--garde 0.20]
# Vérifier ensuite à l'oreille ET par la transcription (controle_hook.py sur la sortie) : un mot doux sous le seuil serait coupé.
import argparse, json, subprocess
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--vitesse', type=float, default=1.10)
ap.add_argument('--debut', type=float, default=0.0); ap.add_argument('--fin', type=float, default=None)
ap.add_argument('--retirer', action='append', default=[])
ap.add_argument('--garder-blancs', action='store_true')
ap.add_argument('--zoom', type=float, default=1.07)
ap.add_argument('--seuil', type=float, default=40.0); ap.add_argument('--min', type=float, default=0.30)
ap.add_argument('--garde', type=float, default=0.20)
a = ap.parse_args()

raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', a.src, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
x = np.frombuffer(raw, np.int16).astype(float); n = 320; dur = len(x) / 16000
fin = min(a.fin or dur, dur)
db = np.array([20 * np.log10(np.sqrt(np.mean(x[i:i + n] ** 2)) + 1e-9) for i in range(0, len(x) - n, n)])
seuil = max(a.seuil, float(np.percentile(db, 10)) + 7)
print('  seuil %.0f dB (fond %.0f dB)' % (seuil, np.percentile(db, 10)))
t0, t1 = int(a.debut / 0.02), int(fin / 0.02)
parle = db[t0:t1] >= seuil
# blocs de parole dans [debut, fin] ; un blanc plus court que --min reste tel quel
segs, i, cur = [], 0, None
while i < len(parle):
    if parle[i]:
        j = i
        while j < len(parle) and parle[j]: j += 1
        s, e = (t0 + i) * 0.02, (t0 + j) * 0.02
        if cur and (a.garder_blancs or s - cur[1] < a.min): cur[1] = e
        else:
            if cur: segs.append(cur)
            cur = [s, e]
        i = j
    else: i += 1
if cur: segs.append(cur)
if not segs: raise SystemExit('aucune parole au-dessus de %.0f dB' % seuil)
h = a.garde / 2
segs = [[max(a.debut, s - h), min(fin, e + h)] for s, e in segs]
for k in range(1, len(segs)):
    print('  blanc %.2f → %.2f s (%.2f s) ramené à %.2f s' % (segs[k - 1][1] - h, segs[k][0] + h, segs[k][0] - segs[k - 1][1] + a.garde, a.garde))
for r in a.retirer:                                       # passages retirés à la main (syllabe parasite)
    r0, r1 = map(float, r.split('-')); out = []
    for s, e in segs:
        if e <= r0 or s >= r1: out.append([s, e]); continue
        if s < r0: out.append([s, r0])
        if e > r1: out.append([r1, e])
    segs = out; print('  retiré %.2f → %.2f s' % (r0, r1))
segs = [g for g in segs if g[1] - g[0] > 0.04]
print('  gardé : ' + ' + '.join('%.2f-%.2f' % (s, e) for s, e in segs))

st = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', a.src], capture_output=True, text=True).stdout)['streams'][0]
W, H = st['width'], st['height']
f, labs = [], []
for k, (s, e) in enumerate(segs):
    L = e - s
    z = a.zoom if k % 2 else 1.0                          # un plan sur deux zoomé : chaque coupe change de cadre
    zf = '' if z == 1.0 else ',crop=%d:%d:%d:%d,scale=%d:%d:flags=lanczos,setsar=1' % (
        round(W / z / 2) * 2, round(H / z / 2) * 2, round((W - W / z) / 2), round((H - H / z) * 0.42), W, H)   # visage : un peu au-dessus du centre
    f.append('[0:v]trim=%.3f:%.3f,setpts=PTS-STARTPTS%s[v%d]' % (s, e, zf, k))
    f.append('[0:a]atrim=%.3f:%.3f,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.012,afade=t=out:st=%.3f:d=0.012[a%d]' % (s, e, max(0, L - 0.012), k))
    labs.append('[v%d][a%d]' % (k, k))
f.append(''.join(labs) + 'concat=n=%d:v=1:a=1[v][a]' % len(segs))
f.append('[v]setpts=PTS/%s[vx]' % a.vitesse); f.append('[a]atempo=%s[ax]' % a.vitesse)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a.src, '-filter_complex', ';'.join(f), '-map', '[vx]', '-map', '[ax]',
                '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                '-ar', '48000', '-movflags', '+faststart', a.out], check=True)
d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.out], capture_output=True, text=True).stdout)
print('%s : %.2f s (%.2f s gardées, x%s, %d plan(s) zoomé(s) x%s)' % (a.out, d, sum(e - s for s, e in segs), a.vitesse, len(segs) // 2, a.zoom))
