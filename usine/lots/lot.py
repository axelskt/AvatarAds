#!/usr/bin/env python3
# Creative Factory — LANCE UN LOT (14/10, reconstruit dans le repo). usage : python3 usine/lots/lot.py <séries> <vidéos par série> [nom]
#   ex. python3 usine/lots/lot.py 5 5 lot-1410b   → 25 vidéos, ~moitié Omni parlées / moitié Texte + musique, alternées.
# Toutes les règles de rendu vivent dans l'usine (build.mjs / build-f05.mjs / formats.js / illustrations.json) :
#   · parlées : son de la 1re image chacun son tour à 0 dB, jamais deux fois le même bruitage à la suite, Kaching sur « BOUM »,
#     mac-typing sur le mot-clé du CTA, woosh 0 dB, rien sous −7 dB, musique normalisée −5 dB ; cartes du hook = RÉSULTATS seuls ;
#   · sans voix : AUCUN bruitage, musique seule ; texte choc toujours centré (axe 540) ; TH13 supprimée.
# Ici : recettes (plan.mjs), CTA cohérent avec la démo, textes choc et musiques des F05, 3 rendus à la fois, relance si le
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
    n = NS * NV; nM = n // 2
    # on demande tout ce qui existe des deux côtés, puis moitié / moitié ; le côté qui manque est complété par l'autre (Axel 15/10)
    P = json.loads(subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'plan.mjs'), WORK, str(n), str(n), str(sum(map(ord, NOM)))],
                                  capture_output=True, text=True, check=True).stdout)
    P['M'] = P['M'][:min(len(P['M']), max(nM, n - len(P['O'])))]; P['O'] = P['O'][:n - len(P['M'])]
    def spread(items, key):   # jamais deux fois la même photo / réaction de suite
        g = {}
        for x in items: g.setdefault(key(x), []).append(x)
        out = []
        while any(g.values()):
            for k in sorted(g, key=lambda k: -len(g[k])):
                if g[k]: out.append(g[k].pop(0))
        return out
    O = spread(P['O'], lambda x: x['photo']); M = spread(P['M'], lambda x: x['react']); seq = []
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
# ── CTA : démo Claude → CTA-CLAUDE ; sinon le CTA « site » (ou « café ») de la photo, à défaut d'une photo du même avatar ──
rot = {}
def cta_for(photo, demo):
    av = photo.split('-')[0]; claude = demo.startswith('C-MCP')
    kinds = ['CTA-CLAUDE'] if claude else ['CTA-SITE-tuto', 'CTA-cafe']
    own = [(k, VAR[(photo, k, 'omni')]) for k in kinds if (photo, k, 'omni') in VAR]
    pool = own or [(k, f) for (a, k, fm), f in VAR.items() if fm == 'omni' and k in kinds and a.split('-')[0] == av]
    if not pool: raise RuntimeError('aucun CTA pour ' + photo)
    i = rot.get((photo, claude), 0); rot[(photo, claude)] = i + 1
    return pool[i % len(pool)]
prev_th = [None]
def prep(it, tag):
    if it['k'] == 'o':
        photo, hook, demo = it['photo'], it['hook'], it['demo']
        hf = VAR[(photo, hook, 'omni')]; cta, cf = cta_for(photo, demo)
        h = get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4'); c = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
        d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
        out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag))
        cmd = ['node', 'usine/build.mjs', h, d, out, 'auto', h, c, '--voice', 'omni', '--format', 'F03', '--illus', 'auto', '--subs-style', 'auto',
               '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE]
        return dict(kind='o', photo=photo, hook=hook, demo=demo, cta=cta, cf=cf, out=out, cmd=cmd, it=it)
    react, demo = it['react'], it['demo']
    rm = bricks[react]['meta']; H = float(rm.get('duration_s') or 3)
    r = get(rm['media'], os.path.basename(rm['media'])); d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
    m = f05_music(H + dur(d)); th = (pick_ti if react.startswith('R-I-') else pick_th)(demo, prev_th[0]); prev_th[0] = th; cs = random.choice(CS)
    out = os.path.join(OUT, '%s_%s.mp4' % (NOM, tag))
    cmd = ['node', 'usine/build-f05.mjs', r, d, out, m, '--choc', th, '--choc-style', cs, '--hook-s', '%g' % H, '--reaction', react, '--demo', demo, '--done', DONE]
    return dict(kind='m', react=react, demo=demo, music=m, th=th, cs=cs, out=out, cmd=cmd, it=it)
env = dict(os.environ, PRODUCER_BROWSER_GPU_MODE='hardware')
# les fichiers partagés (démos, réactions) d'une série sont téléchargés AVANT de lancer les rendus en parallèle
for si in range(S['serie'], len(S['series'])):
    t0 = time.time(); todo = [(it, 0) for it in S['series'][si]]
    while todo:
        batch, todo = todo[:3], todo[3:]; js = []
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
            try: os.remove(j['out'] + '.log')
            except OSError: pass
        save()
    S['serie'] = si + 1; save(); log('— série %d/%d en %.0f s' % (si + 1, len(S['series']), time.time() - t0))
with open(os.path.join(WORK, NOM + '-liens.txt'), 'w') as f:
    for x in S['ok']: f.write('%s %s/qc/%s.mp4\n' % (x['vf'], B, x['name']))
log('FIN %s : %d OK, %d échecs' % (NOM, len(S['ok']), len(S['fail'])))
