#!/usr/bin/env python3
# Creative Factory — CONTRÔLE d'une prise Omni (hook ou CTA) avant de l'accélérer et de l'enregistrer (18/10).
# Whisper masque les faux départs (« j'te… je te montre ça ») et allonge le dernier mot : on croise donc
#   1) la transcription entière (mots répétés côte à côte),
#   2) l'énergie audio par 20 ms (début / fin réels de la parole, pauses > 0,25 s),
#   3) une transcription des DEUX moitiés à chaque pause : le total de mots doit rester le même (sinon mot en trop ou coupé),
#   4) 19/10 (A1-13 H87 : « j'ai, j'ai » collés dans la même syllabe, invisibles aux 3 contrôles ci-dessus et au spectrogramme) :
#      une transcription VERBATIM (whisper-cli large-v3 amorcé sur des hésitations) qui garde les mots doublés, horodatés.
# usage : python3 usine/lots/controle_hook.py prise.mp4 [prise2.mp4 …]
# sortie : transcription, début / fin conseillés pour la coupe (début − 0,12 s, fin + 0,15 s), pauses et contrôle par moitiés.
import json, os, re, subprocess, sys, tempfile
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import REPO

def mots(src, t0=None, t1=None):
    with tempfile.TemporaryDirectory() as d:
        wav, js = os.path.join(d, 'a.wav'), os.path.join(d, 'w.json')
        cmd = ['ffmpeg', '-v', 'error', '-y'] + (['-ss', str(t0)] if t0 else []) + ['-i', src] + (['-t', str(t1)] if t1 else []) + ['-vn', '-ac', '1', '-ar', '16000', wav]
        subprocess.run(cmd, check=True)
        subprocess.run(['node', os.path.join(REPO, 'usine', 'captions.mjs'), 'emit', wav, '0', js], capture_output=True)
        return json.load(open(js)) if os.path.exists(js) else []

MODEL = os.path.expanduser('~/.cache/hyperframes/whisper/models/ggml-large-v3.bin')
AMORCE = "Euh, je, je vais, j'ai, j'ai trouvé, euh, genre, tu vois."   # amorce : whisper recopie alors les doublons
def verbatim(src):
    """[(début, fin, mot)] mot à mot, doublons gardés ; [] si whisper-cli ou le modèle manquent."""
    if not os.path.exists(MODEL): return []
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, 'a.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav], check=True)
        try: out = subprocess.run(['whisper-cli', '-m', MODEL, '-f', wav, '-l', 'fr', '-ml', '1', '-sow', '--prompt', AMORCE, '-np'],
                                  capture_output=True, text=True, timeout=300).stdout
        except (OSError, subprocess.TimeoutExpired): return []
    ts = lambda h: sum(float(x) * m for x, m in zip(h.split(':'), (3600, 60, 1)))
    return [(ts(m.group(1)), ts(m.group(2)), m.group(3).strip()) for m in re.finditer(r'\[(\S+) --> (\S+)\][ \t]+(\S[^\n]*)', out)]

def controle(src):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
    a = np.frombuffer(raw, np.int16).astype(float); n = 320; dur = len(a) / 16000
    r = np.array([20 * np.log10(np.sqrt(np.mean(a[i:i + n] ** 2)) + 1e-9) for i in range(0, len(a) - n, n)])
    sp = r > 52; idx = np.where(sp)[0]
    w = mots(src); t = [re.sub(r'\W', '', x['text'].lower()) for x in w]
    rep = [t[i] for i in range(1, len(t)) if t[i] and t[i] == t[i - 1]]
    pauses, i = [], idx[0] if len(idx) else 0
    while len(idx) and i < idx[-1]:
        if not sp[i]:
            j = i
            while j < len(sp) and not sp[j]: j += 1
            if (j - i) * 0.02 >= 0.25: pauses.append(round((i + j) * 0.01, 2))
            i = j
        else: i += 1
    deb = max(0.0, min(idx[0] * 0.02 if len(idx) else 0, w[0]['start'] if w else 9) - 0.12)
    fin = min(dur, (idx[-1] + 1) * 0.02 + 0.15) if len(idx) else dur
    print('\n%s  (%.2f s)' % (os.path.basename(src), dur))
    print('  texte   :', ' '.join(x['text'] for x in w))
    print('  %d mots · répétitions : %s · coupe conseillée %.2f → %.2f s · pauses : %s' % (len(w), rep or 'aucune', deb, fin, pauses or 'aucune'))
    vb = verbatim(src)
    if vb:
        tv = [re.sub(r'\W', '', m.lower()) for _, _, m in vb]
        dbl = ['%s @%.2f' % (vb[i][2], vb[i][0]) for i in range(1, len(tv)) if tv[i] and tv[i] == tv[i - 1]]
        print('  verbatim:', ' '.join(m for _, _, m in vb))
        print('  doublons verbatim :', dbl or 'aucun', ('  ⚠ couper le doublon (garder le 1er, retirer le 2e jusqu’au mot suivant)' if dbl else ''))
    for c in pauses:
        g, d = mots(src, None, c), mots(src, c, None)
        flag = '' if len(g) + len(d) == len(w) else '  ⚠ %d mots au lieu de %d' % (len(g) + len(d), len(w))
        print('    @%.2f  …%s | %s…%s' % (c, ' '.join(x['text'] for x in g[-3:]), ' '.join(x['text'] for x in d[:3]), flag))

for s in sys.argv[1:]: controle(s)
