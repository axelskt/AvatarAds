#!/usr/bin/env python3
# Creative Factory — LANCE UN LOT (14/10, reconstruit dans le repo). usage : python3 usine/lots/lot.py <séries> <vidéos par série> [nom]
#   ex. python3 usine/lots/lot.py 5 5 lot-1410b   → 25 vidéos, ~moitié Omni parlées / moitié Texte + musique, alternées.
# Toutes les règles de rendu vivent dans l'usine (build.mjs / build-f05.mjs / formats.js / illustrations.json) :
#   · parlées : son de la 1re image chacun son tour à 0 dB, jamais deux fois le même bruitage à la suite, Kaching sur « BOUM »,
#     mac-typing sur le mot-clé du CTA, woosh 0 dB, rien sous −7 dB, musique normalisée −5 dB ; cartes du hook = RÉSULTATS seuls ;
#   · sans voix : AUCUN bruitage, musique seule ; texte choc toujours centré (axe 540) ; TH13 supprimée.
# Ici : recettes (plan.mjs), CTA cohérent avec la démo, textes choc et musiques des F05, 6 rendus à la fois (LOT_PAR), relance si le
# texte choc tombe au milieu, dépôt qc/ en 'pending' (Axel valide), numérotation VF continue, reprise possible (état).
import json, os, random, subprocess, sys, time, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import *
NS, NV = int(sys.argv[1]) if len(sys.argv) > 1 else 5, int(sys.argv[2]) if len(sys.argv) > 2 else 5
NOM = sys.argv[3] if len(sys.argv) > 3 else 'lot-' + time.strftime('%d%m-%H%M')
ST = os.path.join(WORK, NOM + '.json')
S = json.load(open(ST)) if os.path.exists(ST) else None
random.seed(sum(map(ord, NOM)))
bricks, VARS, QC = snapshot()
json.dump({'qc': [{'t': x['t'], 's': x['s'], 'c': x['c']} for x in QC], 'variants': VARS}, open(os.path.join(WORK, 'inventaire.json'), 'w'))
VAR = {}
for v in VARS: VAR[(v['a'], v['b'], v['f'])] = os.path.basename(v['u'])[:-4]   # trié par date : la plus récente gagne
if not S:
    n = NS * NV; nM = 0 if os.environ.get('OMNI_SEUL') else n // 2   # OMNI_SEUL=1 : lot ciblé sans Texte + musique (16/10)
    # on demande tout ce qui existe des deux côtés, puis moitié / moitié ; le côté qui manque est complété par l'autre (Axel 15/10)
    P = json.loads(subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'plan.mjs'), WORK, str(n), str(n), str(sum(map(ord, NOM)))],
                                  capture_output=True, text=True, check=True).stdout)
    P['M'] = [] if os.environ.get('OMNI_SEUL') else P['M'][:min(len(P['M']), max(nM, n - len(P['O'])))]; P['O'] = P['O'][:n - len(P['M'])]
    def spread(items, key):   # jamais deux fois la même photo / réaction de suite
        g = {}
        for x in items: g.setdefault(key(x), []).append(x)
        out = []
        while any(g.values()):
            for k in sorted(g, key=lambda k: -len(g[k])):
                if g[k]: out.append(g[k].pop(0))
        return out
    O = spread(P['O'] + P.get('V', []), lambda x: x['photo']); M = spread(P['M'], lambda x: x['react']); seq = []   # 21/10 : + voix off (VOIX_OFF=n)
    while O or M:
        if M: seq.append(M.pop(0))
        if O: seq.append(O.pop(0))
    nxt = max(int(x['t'][3:]) for x in QC if x['t'] and x['t'].startswith('VF-')) + 1
    S = {'series': [seq[i:i + NV] for i in range(0, len(seq), NV)], 'next': nxt, 'serie': 0, 'ok': [], 'fail': []}
    if os.environ.get('DRY'):   # essai à blanc : le plan seulement
        for i, se in enumerate(S['series']): print(i + 1, [x.get('photo') or x.get('react') for x in se], [(x.get('hook') or '') + ' ' + x['demo'] for x in se])
        print('premier numéro : VF-%04d' % nxt); raise SystemExit
    json.dump(S, open(ST, 'w'), indent=1)
def save(): json.dump(S, open(ST, 'w'), indent=1)
log('%s : %d séries, %d vidéos, à partir de VF-%04d' % (NOM, len(S['series']), sum(map(len, S['series'])), S['next']))
# ── CTA : démo Claude → CTA-CLAUDE ; sinon on ALTERNE tous les autres CTA prêts qui ont une version Omni de l'avatar (AIDE,
#    MONTAGE, PLAN, SITE, café… — Axel 18/10 : diversifier les CTA), celui de la photo d'abord, à défaut celui d'une autre photo
#    du même avatar (Axel 18/10 : « peu importe si le hook et le CTA ne sont pas la même photo »). Rotation sur tout le lot. ──
rot = {}
KUSE, LKUSE = {}, {}
for x in QC:
    c_ = x['c'] or {}
    if x['s'] != 'refused' and c_.get('voice') == 'omni' and c_.get('cta') and c_.get('photo'):
        KUSE[(c_['photo'].split('-')[0], c_['cta'])] = KUSE.get((c_['photo'].split('-')[0], c_['cta']), 0) + 1
def cta_for(photo, demo):
    av = photo.split('-')[0]; claude = demo.startswith('C-MCP')
    # 21/10 : catégorie AUTRE = une PERSONNE différente par photo → son CTA à elle seulement (jamais celui d'une autre photo)
    omni = [(a, k, f) for (a, k, fm), f in VAR.items() if fm == 'omni' and k.startswith('CTA-') and a.split('-')[0] == av and (av != 'AUTRE' or a == photo)
            and (bricks.get(k) or {}).get('status') == 'ready' and (k == 'CTA-CLAUDE') == claude]
    kinds = sorted({k for a, k, f in omni})
    if not kinds: raise RuntimeError('aucun CTA pour ' + photo)
    i = rot.get(claude, 0); rot[claude] = i + 1
    # Axel 21/10 (« répartis correctement les CTA ») : le TYPE de CTA le moins utilisé jusqu'ici pour cet avatar (validées + en
    # revue + ce lot), au lieu de repartir du premier de la liste à chaque lot
    # rotation DANS le lot d'abord (LKUSE), l'usage global ne départage qu'ensuite — sinon un CTA tout neuf sortait en boucle
    k = min(kinds, key=lambda kk: (LKUSE.get((av, kk), 0), KUSE.get((av, kk), 0), kinds.index(kk)))
    KUSE[(av, k)] = KUSE.get((av, k), 0) + 1; LKUSE[(av, k)] = LKUSE.get((av, k), 0) + 1
    pool = [(k, f) for a, kk, f in omni if kk == k and a == photo] or [(k, f) for a, kk, f in omni if kk == k]
    return pool[(i // len(kinds)) % len(pool)]
# 21/10 : la voix accélérée est un NOUVEAU fichier → build.mjs relançait Whisper (6 en parallèle : whisper-cli plantait sur
# Metal). Ses mots = ceux, déjà en cache, de la prise d'origine, temps divisés par la vitesse (même clé que build.mjs fileKey).
WORDS = os.path.join(os.path.dirname(WORK), 'words')
def file_key(f):
    import hashlib
    n = os.path.getsize(f); k = min(n, 4 << 20); h = hashlib.sha1()
    with open(f, 'rb') as fh:
        h.update(fh.read(k)); fh.seek(max(0, n - k)); h.update(fh.read(k))
    h.update(str(n).encode()); return h.hexdigest()[:16]
def mots_acceleres(src, dst, v):
    try:
        w = json.load(open(os.path.join(WORDS, file_key(src) + '.json')))
        json.dump([dict(x, start=round(x['start'] / v, 3), end=round(x['end'] / v, 3)) for x in w], open(os.path.join(WORDS, file_key(dst) + '.json'), 'w'), ensure_ascii=False)
    except (OSError, ValueError, KeyError): pass   # pas de mots en cache pour la prise : build.mjs transcrira
prev_th = [None]
# Axel 21/10 (revue fond vert : « il parle trop lentement ») : prises accélérées EN PLUS de leur ×1,10 dans le format fond vert
VIT_FV = {('A3-10', 'H23'): 1.15, ('A3-11', 'H74'): 1.15}
def prep(it, tag):
    if it['k'] == 'o':
        photo, hook, demo = it['photo'], it['hook'], it['demo']
        hf = VAR[(photo, hook, 'omni')]; hv = None
        # CTA imposé (lot manuel, Axel 21/10 : AUTRE-1 n'a que son CTA café) — sinon rotation habituelle
        cta, cf = (it['cta'], VAR[(photo, it['cta'], 'omni')]) if it.get('cta') else cta_for(photo, demo)
        # Axel 20/10 : H89 = hook « grille qui se multiplie » 7 fois sur 10 (coin ou centre, usine/grille-hook.py), sinon la prise normale
        g = [k for k in ('H89-GRILLE', 'H89-GRILLE-C') if (photo, k, 'omni') in VAR] if hook == 'H89' else []
        if g and random.random() < 0.7: hv = random.choice(g); hf = VAR[(photo, hv, 'omni')]
        h = get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4'); c = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
        d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
        out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag))
        cmd = ['node', 'usine/build.mjs', h, d, out, 'auto', h, c, '--voice', 'omni', '--format', 'F03', '--illus', 'auto', '--subs-style', 'auto',
               '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE]
        return dict(kind='o', photo=photo, hook=hook, demo=demo, cta=cta, cf=cf, out=out, cmd=cmd, it=it, hf_var=hv)
    if it['k'] == 'v':   # Axel 21/10 : voix off Motion Control (usine/voix-off-mc.py), même photo / hook / CTA qu'une parlée
        photo, hook, demo, tx = it['photo'], it['hook'], it['demo'], it['tx']
        hf = VAR[(photo, hook, 'omni')]; cta, cf = cta_for(photo, demo)
        h = get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4'); c = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
        d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
        out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag)); vis = out[:-4] + '-vo.mp4'; hv = out[:-4] + '-voix.mp4'
        # Axel 21/10 (VF-0854 « il parle trop lentement ») : la voix est accélérée ×1,10 (hauteur gardée) dans ce format
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', h, '-filter_complex', '[0:v]setpts=PTS/1.10[v];[0:a]atempo=1.10[a]', '-map', '[v]', '-map', '[a]',
                        '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', hv], check=True)
        mots_acceleres(h, hv, 1.10)
        subprocess.run(['python3', 'usine/voix-off-mc.py', hv, tx, vis], cwd=REPO, check=True, capture_output=True)
        cmd = ['node', 'usine/build.mjs', vis, d, out, 'auto', hv, c, '--voice', 'omni', '--format', 'F03', '--avant-apres', '--medaillon', '520,450,405,720',
               '--subs-style', 'auto', '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE]
        return dict(kind='o', photo=photo, hook=hook, demo=demo, cta=cta, cf=cf, out=out, cmd=cmd, it=it, vo=tx, vis=vis, hv=hv)
    if it['k'] == 'f':   # Axel 21/10 : FOND VERT (usine/fond-vert.py) — avatar détouré devant la transformation, voix d'origine
        photo, hook, demo, tx = it['photo'], it['hook'], it['demo'], it['tx']
        hf = VAR[(photo, hook, 'omni')]; cta, cf = cta_for(photo, demo)
        h = get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4'); c = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
        d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
        out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag)); vis = out[:-4] + '-fv.mp4'
        v_ = VIT_FV.get((photo, hook))
        if v_:   # prise trop lente dans ce format : accélérée en plus (hauteur gardée), mots repris du cache
            hv = out[:-4] + '-voix.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', h, '-filter_complex', '[0:v]setpts=PTS/%g[v];[0:a]atempo=%g[a]' % (v_, v_), '-map', '[v]', '-map', '[a]',
                            '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', hv], check=True)
            mots_acceleres(h, hv, v_); h = hv
        subprocess.run(['python3', 'usine/fond-vert.py', h, tx, vis], cwd=REPO, check=True, capture_output=True)
        cmd = ['node', 'usine/build.mjs', vis, d, out, 'auto', h, c, '--voice', 'omni', '--format', 'F03', '--avant-apres', '--medaillon', '600,440,338,600',
               '--medaillon-libre', '1', '--subs-style', 'auto', '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE]
        return dict(kind='o', photo=photo, hook=hook, demo=demo, cta=cta, cf=cf, out=out, cmd=cmd, it=it, fv=tx, vis=vis, hv=h if v_ else None)
    react, demo = it['react'], it['demo']
    rm = bricks[react]['meta']; H = float(rm.get('duration_s') or 3)
    r = get(rm['media'], os.path.basename(rm['media'])); d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
    m = f05_music(H + dur(d)); th = (pick_ti if react.startswith('R-I-') else pick_th)(demo, prev_th[0]); prev_th[0] = th; cs = random.choice(CS)
    out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag))
    cmd = ['node', 'usine/build-f05.mjs', r, d, out, m, '--choc', th, '--choc-style', cs, '--hook-s', '%g' % H, '--reaction', react, '--demo', demo, '--done', DONE]
    return dict(kind='m', react=react, demo=demo, music=m, th=th, cs=cs, out=out, cmd=cmd, it=it)
env = dict(os.environ, PRODUCER_BROWSER_GPU_MODE='hardware')
# 19/10 (Axel : « tu peux en faire 6 en même temps ») : rendus simultanés, 6 par défaut (avant 3) — LOT_PAR=3 pour revenir
PAR = max(1, int(os.environ.get('LOT_PAR', '6')))
# les fichiers partagés (démos, réactions) d'une série sont téléchargés AVANT de lancer les rendus en parallèle
for si in range(S['serie'], len(S['series'])):
    t0 = time.time(); todo = [(it, 0) for it in S['series'][si]]
    while todo:
        batch, todo = todo[:PAR], todo[PAR:]; js = []
        for k, (it, tries) in enumerate(batch):
            try: j = prep(it, 's%d_%d_%d' % (si + 1, k, tries)); j['tries'] = tries; js.append(j)
            except Exception as e: log('✗ préparation', it, e); S['fail'].append({'it': it, 'err': str(e)[:200]})
        ps = [(j, subprocess.Popen(j['cmd'], cwd=REPO, env=env, stdout=open(j['out'] + '.log', 'w'), stderr=subprocess.STDOUT)) for j in js]
        for j, p in ps:
            p.wait()
            if p.returncode or not os.path.exists(j['out']):
                log('✗ rendu', j['it'], open(j['out'] + '.log').read()[-300:].replace('\n', ' | ')); S['fail'].append({'it': j['it'], 'err': 'rendu'}); continue
            z = (json.load(open(j['out'] + '.format.json')).get('layout') or {}).get('zone') if os.path.exists(j['out'] + '.format.json') else None
            if j['kind'] == 'o' and z == 'milieu' and j['tries'] < 2:
                log('… texte choc au milieu, relance', j['it']); todo.append((j['it'], j['tries'] + 1)); os.remove(j['out']); continue
            vf = 'VF-%04d' % S['next']
            try:
                name, T, zone = publish(j, vf); S['next'] += 1
                S['ok'].append({'vf': vf, 'name': name, 'serie': si + 1}); log('✓', name, T, zone)
            except Exception as e: log('✗ dépôt', j['it'], e); S['fail'].append({'it': j['it'], 'err': str(e)[:300]})
            for x_ in (j['out'] + '.log', j.get('vis'), j.get('hv')):
                try:
                    if x_: os.remove(x_)
                except OSError: pass
        save()
    S['serie'] = si + 1; save(); log('— série %d/%d en %.0f s' % (si + 1, len(S['series']), time.time() - t0))
with open(os.path.join(WORK, NOM + '-liens.txt'), 'w') as f:
    for x in S['ok']: f.write('%s %s/qc/%s.mp4\n' % (x['vf'], B, x['name']))
log('FIN %s : %d OK, %d échecs' % (NOM, len(S['ok']), len(S['fail'])))
# Axel 21/10 : capacité réelle recalculée pour le tableau de bord (factory_capacite) — un échec ne bloque rien
try:
    from capacite import recalculer; recalculer()
except Exception as e: print('capacité non recalculée :', str(e)[:200])

