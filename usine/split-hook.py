#!/usr/bin/env python3
# Creative Factory — VISUEL du format « SPLIT » (Axel 23/10, réf. ai.zygis) : en HAUT deux résultats « Hook démo » (HD-…)
# côte à côte sur toute la largeur, en BAS l'avatar qui dit le hook (cadré sur son visage, sans zoom), les sous-titres en
# boîtes mono à la jonction (posés par build.mjs --split). Quand les deux premiers résultats s'arrêtent, la bascule tombe à
# la fin d'une phrase (ou d'un mot) :
#   · A : deux AUTRES résultats prennent le relais (et ainsi de suite jusqu'à la fin du hook) ;
#   · B : l'avatar repasse en plein écran.
# Les deux versions sont validées (Axel 23/10) et tournent une fois sur deux (usine/lots/plan.mjs). Uniquement devant une démo
# Express (règle « Hook démo »).
# usage : python3 usine/split-hook.py <prise.mp4> <sortie.mp4> --mode A|B --res r1.mp4,r2.mp4[,r3.mp4,r4.mp4…]
#   → sortie muette (la voix reste la prise, build.mjs) + <sortie>.json { mode, switch, pairs } ; puis
#     build.mjs <sortie.mp4> <démo> <out> auto <prise.mp4> <cta> … --split <mode>:<switch>
import hashlib, json, os, subprocess, sys

take, out = sys.argv[1], sys.argv[2]
arg = lambda k, d: next((type(d)(sys.argv[i + 1]) for i, x in enumerate(sys.argv) if x == k and i + 1 < len(sys.argv)), d)
MODE = arg('--mode', 'B').upper()
RES = [r for r in arg('--res', '').split(',') if r]
if MODE not in ('A', 'B') or len(RES) < 2: sys.exit('usage : split-hook.py <prise> <sortie> --mode A|B --res r1,r2[,r3,r4…]')
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('CF_CACHE') or os.path.join(os.path.expanduser('~'), 'Downloads', 'Creative Factory', 'cache')
W, H, TOP, GAP, FPS = 1080, 1920, 880, 6, 25   # haut = 0 → 880 (deux colonnes de 537 px + 6 px), bas = 880 → 1920
COL = (W - GAP) // 2
dur = lambda f: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)

def file_key(f):   # = build.mjs / lot.py : 4 Mo du début + 4 Mo de la fin + taille
    n = os.path.getsize(f); k = min(n, 4 << 20); h = hashlib.sha1()
    with open(f, 'rb') as fh:
        h.update(fh.read(k)); fh.seek(max(0, n - k)); h.update(fh.read(k))
    h.update(str(n).encode()); return h.hexdigest()[:16]

def words(f):   # mots de la prise : cache de l'usine, sinon transcription (rangée dans le cache)
    c = os.path.join(CACHE, 'words', file_key(f) + '.json')
    if not os.path.exists(c):
        os.makedirs(os.path.dirname(c), exist_ok=True)
        subprocess.run(['node', os.path.join(HERE, 'captions.mjs'), 'emit', f, '0', c], check=True, capture_output=True)
    w = json.load(open(c)); w = w.get('words', w) if isinstance(w, dict) else w
    return [x for x in w if x.get('text', '').strip()]

T = dur(take); WS = words(take)

# ── bascule : fin du plus court des deux résultats ; on la cale sur une fin de phrase (sinon de mot) entre −0,6 s et +0,3 s
#    (au-delà de sa fin, un résultat garde sa dernière image) ; trop près de la fin du hook → pas de bascule ──
def bascule(t0, m):
    cand = [w['end'] for w in WS if t0 + m - 0.6 <= w['end'] <= t0 + m + 0.3]
    fin = [w['end'] for w in WS if t0 + m - 0.6 <= w['end'] <= t0 + m + 0.3 and w['text'].strip()[-1:] in '.!?,;:…']
    t = max(fin) if fin else max(cand) if cand else t0 + m
    return round(t, 3) if t < T - 0.6 else None

pairs, t0, i = [], 0.0, 0
while True:
    a, b = RES[i % len(RES)], RES[(i + 1) % len(RES)]
    sw = bascule(t0, min(dur(a), dur(b)))
    pairs.append({'a': a, 'b': b, 'from': t0, 'to': sw if sw else T + 1})
    if not sw or MODE == 'B': break
    t0, i = sw, i + 2
    if i >= 2 * 8: pairs[-1]['to'] = T + 1; break
SW = pairs[0]['to'] if pairs[0]['to'] <= T else None

# ── cadrage du bas : sans zoom (Axel 23/10 : « dézoome-le »), le haut de la tête juste sous les sous-titres de la jonction ──
fz = json.loads(subprocess.run(['node', os.path.join(HERE, 'face-zones.mjs'), take, '0', '%.2f' % min(T, 6), '1'], capture_output=True, text=True).stdout or '{}')
boxes = fz.get('faces') or []
if boxes:
    ys = sorted(bx[1] * H for bx in boxes); hs = sorted(bx[3] * H for bx in boxes)   # boîtes [x, y, l, h] normalisées
    tete = ys[len(ys) // 2] - 0.45 * hs[len(hs) // 2]   # haut des cheveux ≈ haut du visage − 45 % de sa hauteur
    Y0 = int(min(max(tete - 70, 0), H - (H - TOP)))
else:
    Y0 = 330   # visage inconnu : cadrage moyen des prises Omni (validé sur A3-7 · H17 : 310)

fc, ins = [], ['-i', take]
fc.append('color=c=black:s=%dx%d:r=%d:d=%.3f[bg]' % (W, H, FPS, T + 1))
fc.append(('[0:v]fps=%d,setsar=1,split=2[tk1][tk2];[tk1]crop=%d:%d:0:%d[bas];[tk2]scale=%d:%d[plein]' % (FPS, W, H - TOP, Y0, W, H)) if MODE == 'B' and SW
          else '[0:v]fps=%d,setsar=1,crop=%d:%d:0:%d[bas]' % (FPS, W, H - TOP, Y0))
cur = 'bg'
for k, p in enumerate(pairs):
    for j, (src, x) in enumerate(((p['a'], 0), (p['b'], COL + GAP))):
        n = len(ins) // 2; ins += ['-i', src]; d = p['to'] - p['from']
        fc.append('[%d:v]fps=%d,trim=0:%.3f,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=%.3f,scale=%d:-2:flags=lanczos,crop=%d:%d:0:20,setsar=1,'
                  'tpad=start_duration=%.3f[r%d%d]' % (n, FPS, d, d + 1, COL, COL, TOP, p['from'], k, j))
        nxt = 'o%d%d' % (k, j)
        fc.append("[%s][r%d%d]overlay=%d:0:enable='between(t,%.3f,%.3f)'[%s]" % (cur, k, j, x, p['from'], p['to'] - 0.001, nxt)); cur = nxt
fc.append('[%s][bas]overlay=0:%d[sp]' % (cur, TOP))
if MODE == 'B' and SW:   # plein écran après la bascule
    fc.append("[sp][plein]overlay=0:0:enable='gte(t,%.3f)'[v]" % SW)
else:
    fc.append('[sp]null[v]')
subprocess.run(['ffmpeg', '-v', 'error', '-y'] + ins + ['-filter_complex', ';'.join(fc), '-map', '[v]', '-t', '%.3f' % (T + 1), '-an',
                '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', str(FPS), out], check=True)
info = {'mode': MODE, 'switch': SW, 'crop_y': Y0, 'pairs': [{**p, 'a': os.path.basename(p['a']), 'b': os.path.basename(p['b'])} for p in pairs]}
json.dump(info, open(out[:-4] + '.json', 'w'), indent=1)
print('%s : split %s, bascule %s, cadrage y=%d · build.mjs --split %s:%s' % (out, MODE, SW, Y0, MODE, SW if SW else '%.3f' % (T + 1)))
