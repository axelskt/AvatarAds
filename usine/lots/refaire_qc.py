#!/usr/bin/env python3
# Creative Factory — REFAIRE une vidéo PARLÉE encore dans la file de revue (pending), sous le MÊME numéro : même photo, même
# hook (sa variante ACTUELLE, ex. accélérée), même démo, même CTA, même texte choc, règles du jour. L'ancienne version
# (fichiers qc/, ligne factory_qc, empreintes) est retirée une fois la nouvelle rendue.
# 17/10 (audit S-USINE-1) : numéros filtrés (VF-0000), chaque valeur collée dans le SQL ÉCHAPPÉE (lit), et l'adresse de
# l'ancienne version doit être EXACTEMENT factory-media/qc/<ce VF>_<nom>.mp4 avant toute requête ou suppression.
# usage : python3 usine/lots/refaire_qc.py VF-0444 [VF-0462 …] [--sfx-debut debut-cinematic-impact]
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import *
def lit(v): return "'" + str(v).replace("'", "''") + "'"   # littéral SQL échappé (17/10)
def url_ok(u, vf, dossiers=('qc',)):
    """adresse publique factory-media/<dossier>/<vf>_<nom>.mp4, chaîne brute (ni ? # % \\ ' ni sous-dossier)."""
    return isinstance(u, str) and vf_ok(vf) and '..' not in u and bool(
        re.fullmatch(re.escape(B) + '/(' + '|'.join(dossiers) + ')/' + re.escape(vf) + r'_[A-Za-z0-9._-]+\.mp4', u))
args = sys.argv[1:]; sfx = None
if '--sfx-debut' in args:
    i = args.index('--sfx-debut'); sfx = args[i + 1] if i + 1 < len(args) else ''; del args[i:i + 2]
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', sfx): raise SystemExit('--sfx-debut : nom de son illisible')
vfs = []
for a in args:
    if not vf_ok(a): log('✗', repr(a)[:40], 'argument ignoré : VF-0000 attendu')
    elif a not in vfs: vfs.append(a)
if not vfs: raise SystemExit('usage : python3 usine/lots/refaire_qc.py VF-0444 [VF-0462 …] [--sfx-debut debut-cinematic-impact]')
bricks, VARS, _ = snapshot()
VAR = {(v['a'], v['b'], v['f']): os.path.basename(v['u'])[:-4] for v in VARS}
rows = q("select template vf, status, video_url u, brick_combo c, technical->'format'->>'texte_choc' th from factory_qc where template = any(%s);" % sql_arr(vfs))
env = dict(os.environ, PRODUCER_BROWSER_GPU_MODE='hardware')
for r in rows:
    c, vf = r['c'] or {}, r['vf']
    if c.get('format') == 'F05' or r['status'] != 'pending': log('✗', vf, 'pas une vidéo parlée en attente'); continue
    if not url_ok(r['u'], vf): log('✗', vf, 'adresse hors de factory-media/qc/%s_….mp4 : rien refait, rien supprimé (à vérifier)' % vf); continue
    photo, hook, demo = c['photo'], c['hook'], c['contenu']
    hf = VAR[(photo, hook, 'omni')]; cf = c.get('cta_file') or VAR[(photo, c['cta'], 'omni')]
    h = get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4'); cfile = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
    d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
    out = os.path.join(OUT, 'refaire_%s.mp4' % vf)
    cmd = ['node', 'usine/build.mjs', h, d, out, 'auto', h, cfile, '--voice', 'omni', '--format', 'F03', '--illus', 'auto', '--subs-style', 'auto',
           '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE] + (['--choc', r['th']] if r['th'] and r['th'] != 'TH13' else []) + (['--sfx-debut', sfx] if sfx else [])
    p = sh(cmd, env=env)
    if p.returncode or not os.path.exists(out): log('✗ rendu', vf, (p.stdout + p.stderr)[-300:]); continue
    old = os.path.basename(r['u'])[:-4]
    q("begin;delete from factory_fp_frames where video_url=%s;delete from factory_fp where video_url=%s;delete from factory_qc where template=%s;commit;" % (lit(r['u']), lit(r['u']), lit(vf)), js=False)
    sh(['supabase', 'storage', 'rm', 'ss:///factory-media/qc/' + old + '.mp4', 'ss:///factory-media/qc/' + old + '-poster.jpg', '--experimental', '--linked', '--yes'])
    j = dict(kind='o', photo=photo, hook=hook, demo=demo, cta=c['cta'], cf=cf, out=out)
    name, T, zone = publish(j, vf)
    log('✓', vf, name, T, zone, '(hook %s)' % hf)
