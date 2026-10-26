#!/usr/bin/env python3
# Creative Factory — LANCE UN LOT (14/10, reconstruit dans le repo). usage : python3 usine/lots/lot.py <séries> <vidéos par série> [nom]
#   ex. python3 usine/lots/lot.py 5 5 lot-1410b   → 25 vidéos, ~moitié Omni parlées / moitié Texte + musique, alternées.
# Toutes les règles de rendu vivent dans l'usine (build.mjs / build-f05.mjs / formats.js / illustrations.json) :
#   · parlées : son de la 1re image chacun son tour à 0 dB, jamais deux fois le même bruitage à la suite, Kaching sur « BOUM »,
#     mac-typing sur le mot-clé du CTA, woosh 0 dB, rien sous −7 dB, musique normalisée −5 dB ; cartes du hook = RÉSULTATS seuls ;
#   · sans voix : AUCUN bruitage, musique seule ; texte choc toujours centré (axe 540) ; TH13 supprimée.
# Ici : recettes (plan.mjs), CTA cohérent avec la démo, textes choc et musiques des F05, 6 rendus à la fois (LOT_PAR), relance si le
# texte choc tombe au milieu, dépôt qc/ en 'pending' (Axel valide), numérotation VF continue, reprise possible (état).
import json, os, random, shutil, subprocess, sys, time, itertools
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
if not S and os.environ.get('LOT_PLAN'):   # Axel 27/10 : lot écrit à la main (recettes imposées, une série = un passage de rendus)
    se_ = json.load(open(os.environ['LOT_PLAN']))
    nxt = max(int(x['t'][3:]) for x in QC if x['t'] and x['t'].startswith('VF-')) + 1
    S = {'series': se_, 'next': nxt, 'serie': 0, 'ok': [], 'fail': []}; json.dump(S, open(ST, 'w'), indent=1)
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
    O = spread(P['O'] + P.get('V', []) + P.get('S', []), lambda x: x['photo']); M = spread(P['M'], lambda x: x['react']); seq = []   # 21/10 : + voix off (VOIX_OFF=n)
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
    # 21/10 (Axel) : catégorie AUTRE = une personne différente par photo → son propre CTA s'il existe, sinon le CTA d'un
    # garçon qu'on a déjà : ceux de A4 (avatar du même compte, @leoadsia) — jamais le CTA d'une AUTRE fille
    if av == 'AUTRE' and not any(fm == 'omni' and k.startswith('CTA-') and a == photo for (a, k, fm) in VAR): av = 'A4'
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
# Axel 27/10 : « dès le premier centième de seconde la voix parle » — 28 prises Omni sur 82 ont 0,15 à 1,3 s de blanc avant le
# 1er mot (H59 × AUTRE, H81 × A3-2, H48 × A3-7…). Tous les formats partent d'une copie coupée à l'attaque de la voix (0,02 s de
# souffle gardé, à l'image près), mots du cache décalés d'autant. Le texte incrusté le fait dans hook_auto.py.
sys.path.insert(0, os.path.join(REPO, 'usine', 'incruste'))
from voix import images_a_couper
def sans_blanc(h):
    fps = float(eval(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', h],
                                    capture_output=True, text=True).stdout.strip() or '25'))
    n0 = images_a_couper(h, fps)
    if not n0: return h
    out = h[:-4] + '-c%d.mp4' % n0; t0 = n0 / fps
    if not os.path.exists(out):
        tmp = out + '.%d.part.mp4' % os.getpid()
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '%.4f' % t0, '-i', h, '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', '-b:a', '192k', tmp], check=True)
        os.replace(tmp, out)
    try:
        w = json.load(open(os.path.join(WORDS, file_key(h) + '.json')))
        json.dump([dict(x, start=round(max(0.0, x['start'] - t0), 3), end=round(max(0.01, x['end'] - t0), 3)) for x in w],
                  open(os.path.join(WORDS, file_key(out) + '.json'), 'w'), ensure_ascii=False)
    except (OSError, ValueError, KeyError): pass   # pas de mots en cache : build.mjs transcrira la copie
    log('  voix à %.2f s dans %s : %d images coupées en tête' % (t0 + 0.02, os.path.basename(h), n0))
    return out
prev_th = [None]
# Axel 26/10 : format TEXTE INCRUSTÉ (usine/incruste) sur ~7,3 vidéos Omni parlées sur 10 (INCRUSTE_PART), quand le hook ET le
# CTA sont dans la banque (factory_bricks.meta.incruste) ; les 6 couleurs du mot fort tournent (à plat / dégradé « DID IT! »)
# pour comparer les vues — la moins utilisée du lot d'abord. Clips Omni seulement (jamais Character-3).
PART_INC = float(os.environ.get('INCRUSTE_PART', '0.73'))
STYLES_INC = ['jaune', 'vert', 'rouge', 'degrade-jaune', 'degrade-vert', 'degrade-rouge']
USE_INC = {k: 0 for k in STYLES_INC}
def incruste(photo, hook, demo, cta, cf, tag, style=None):
    """hook + CTA habillés (hook_auto.py / cta_auto.py), mots vérifiés copiés dans le cache de build.mjs ; None si hors banque.
    style imposé (lot écrit à la main) : toujours en texte incrusté, dans cette couleur"""
    if not ((bricks.get(hook) or {}).get('meta') or {}).get('incruste') or not ((bricks.get(cta) or {}).get('meta') or {}).get('incruste'): return None
    if not style and random.random() >= PART_INC: return None
    st = style or min(STYLES_INC, key=lambda k: (USE_INC[k], random.random())); USE_INC[st] = USE_INC.get(st, 0) + 1
    opt = ['--teinte', st[8:]] if st.startswith('degrade-') else ['--couleur', st]
    d_ = os.path.join(OUT, '%s_%s-inc' % (NOM, tag))
    subprocess.run(['python3', 'usine/incruste/hook_auto.py', hook, photo, d_] + opt, cwd=REPO, check=True, capture_output=True)
    subprocess.run(['python3', 'usine/incruste/cta_auto.py', cta, '%s/variants/%s.mp4' % (B, cf), d_] + opt, cwd=REPO, check=True, capture_output=True)
    hi, ci = os.path.join(d_, 'hook-incruste.mp4'), os.path.join(d_, 'cta-incruste.mp4')
    for src, dst in ((os.path.join(d_, 'words.json'), hi), (os.path.join(d_, 'cta', 'words.json'), ci)):   # Whisper rate la fin d'un clip habillé
        shutil.copy(src, os.path.join(WORDS, file_key(dst) + '.json'))
    hd = ((bricks[hook]['meta']['incruste']) or {}).get('hook_demos') or []
    return dict(d=d_, hook=hi, cta=ci, style=st, hd=hd)
# Axel 21/10 (revue fond vert : « il parle trop lentement ») : prises accélérées EN PLUS de leur ×1,10 dans le format fond vert
VIT_FV = {('A3-10', 'H23'): 1.15, ('A3-11', 'H74'): 1.15}
def prep(it, tag):
    if it['k'] == 'o':
        photo, hook, demo = it['photo'], it['hook'], it['demo']
        hf = VAR[(photo, hook, 'omni')]; hv = None
        # CTA imposé (lot manuel, Axel 21/10 : AUTRE-1 n'a que son CTA café) — sinon rotation habituelle
        # (cta_photo : CTA d'une autre photo du même avatar, ex. CTA-CLAUDE de A1-13 sous un hook A1-14)
        cta, cf = (it['cta'], VAR[(it.get('cta_photo') or photo, it['cta'], 'omni')]) if it.get('cta') else cta_for(photo, demo)
        # Axel 20/10 : H89 = hook « grille qui se multiplie » 7 fois sur 10 (coin ou centre, usine/grille-hook.py), sinon la prise normale
        inc = incruste(photo, hook, demo, cta, cf, tag, it['style']) if it.get('style') else None if it.get('cta') else incruste(photo, hook, demo, cta, cf, tag)
        if inc:   # texte incrusté : hook et CTA habillés, pas de grille, pas de texte choc ni d'illustration
            d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
            out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag))
            cmd = ['node', 'usine/build.mjs', inc['hook'], d, out, 'auto', inc['hook'], inc['cta'], '--voice', 'omni', '--format', 'F01', '--incruste',
                   '--subs-style', 'auto', '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE]
            return dict(kind='o', photo=photo, hook=hook, demo=demo, cta=cta, cf=cf, out=out, cmd=cmd, it=it, incruste=inc['style'], hd=inc['hd'], incdir=inc['d'])
        g = [k for k in ('H89-GRILLE', 'H89-GRILLE-C') if (photo, k, 'omni') in VAR] if hook == 'H89' else []
        if g and random.random() < 0.7: hv = random.choice(g); hf = VAR[(photo, hv, 'omni')]
        h = sans_blanc(get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4')); c = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
        d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
        out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag))
        cmd = ['node', 'usine/build.mjs', h, d, out, 'auto', h, c, '--voice', 'omni', '--format', 'F03', '--illus', 'auto', '--subs-style', 'auto',
               '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE]
        return dict(kind='o', photo=photo, hook=hook, demo=demo, cta=cta, cf=cf, out=out, cmd=cmd, it=it, hf_var=hv)
    if it['k'] == 's':   # Axel 23/10 : SPLIT (usine/split-hook.py) — 2 résultats « Hook démo » en haut, l'avatar en bas, démo Express
        photo, hook, demo, mode = it['photo'], it['hook'], it['demo'], it.get('mode', 'B')
        hf = VAR[(photo, hook, 'omni')]; cta, cf = cta_for(photo, demo)
        h = sans_blanc(get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4')); c = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
        d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
        out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag)); vis = out[:-4] + '-split.mp4'
        hds = sorted(x for x, b in bricks.items() if b.get('kind') == 'hook-demo' and b.get('status') == 'ready' and (b.get('meta') or {}).get('media'))
        hd = random.sample(hds, min(6, len(hds)))   # 3 paires au plus (version A : relais)
        res = {get(bricks[x]['meta']['media'], os.path.basename(bricks[x]['meta']['media'])): x for x in hd}
        subprocess.run(['python3', 'usine/split-hook.py', h, vis, '--mode', mode, '--res', ','.join(res)], cwd=REPO, check=True, capture_output=True)
        info = json.load(open(vis[:-4] + '.json')); sw = info['switch'] if info['switch'] else dur(h) + 1
        by_name = {os.path.basename(f): x for f, x in res.items()}
        used = [by_name.get(p_[k_]) for p_ in info['pairs'] for k_ in ('a', 'b')]
        cmd = ['node', 'usine/build.mjs', vis, d, out, 'auto', h, c, '--voice', 'omni', '--format', 'F03', '--split', '%s:%.3f' % (mode, sw),
               '--subs-style', 'auto', '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE]
        return dict(kind='o', photo=photo, hook=hook, demo=demo, cta=cta, cf=cf, out=out, cmd=cmd, it=it, split=mode, hd=used, vis=vis, visj=vis[:-4] + '.json')
    if it['k'] == 'v':   # Axel 21/10 : voix off Motion Control (usine/voix-off-mc.py), même photo / hook / CTA qu'une parlée
        photo, hook, demo, tx = it['photo'], it['hook'], it['demo'], it['tx']
        hf = VAR[(photo, hook, 'omni')]; cta, cf = cta_for(photo, demo)
        h = sans_blanc(get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4')); c = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
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
        h = sans_blanc(get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4')); c = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
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
        ps = []
        for j in js:   # 27/10 : départs décalés de 3 s, chaque rendu voit la musique tirée par le précédent (dernier.json)
            if ps: time.sleep(3)
            ps.append((j, subprocess.Popen(j['cmd'], cwd=REPO, env=env, stdout=open(j['out'] + '.log', 'w'), stderr=subprocess.STDOUT)))
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
            if j.get('incdir'): shutil.rmtree(j['incdir'], ignore_errors=True)   # images du texte incrusté
            for x_ in (j['out'] + '.log', j.get('vis'), j.get('hv'), j.get('visj')):
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

