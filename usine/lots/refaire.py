#!/usr/bin/env python3
# Creative Factory — REFAIRE EN PLACE des vidéos déjà dans le kit (à programmer), avec les règles du jour. La vidéo du post
# est remplacée, le créneau ne bouge pas, l'ancien fichier n'est supprimé qu'APRÈS la mise à jour vérifiée de la base.
#   · Texte + musique (F05) : même réaction, même démo (sa version actuelle), même musique, même style, même texte choc sauf
#     s'il est supprimé.
#   · parlée (F03, 15/10) : même photo, même hook et même CTA dans leur variante ACTUELLE (ex. hook accéléré A3-2 H18 x1,10),
#     même démo, même musique, mêmes sous-titres, même texte choc et même style.
# usage : python3 usine/lots/refaire.py VF-0316 VF-0322 …
import json, os, sys, random, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import *
vfs = sys.argv[1:]
bricks, VARS, _ = snapshot()
VAR = {(v['a'], v['b'], v['f']): os.path.basename(v['u'])[:-4] for v in VARS}
BEDS = os.path.join(os.path.expanduser('~'), 'Downloads', 'Creative Factory', 'musique', 'beds')
def music_file(m):   # même piste que build.mjs : beds/ si elle y est, sinon la banque (nom « Mxx_… » : build.mjs en lit l'id)
    try: f = next((n for n in sorted(os.listdir(BEDS)) if n.startswith(m + '_')), None)
    except OSError: f = None
    return os.path.join(BEDS, f) if f else get('%s/music/%s.mp3' % (B, m), '%s_banque.mp3' % m)
env = dict(os.environ, PRODUCER_BROWSER_GPU_MODE='hardware')
rows = q("select q.template vf, q.brick_combo c, q.technical->'format'->>'texte_choc' th, q.video_url qu, p.id::text pid, p.video_url pu from factory_qc q "
         "left join factory_posts p on p.combo->>'vf'=q.template and p.status='todo' where q.template in (%s);" % ','.join("'%s'" % v for v in vfs))
RETIRES = {'TH13'}
for r in rows:
    c = r['c']; vf = r['vf']; stamp = time.strftime('%m%d%H%M')
    if not r['pid']: log('✗', vf, 'plus dans le kit à programmer (déjà programmée ou publiée) : on n’y touche pas'); continue
    if c.get('format') == 'F05':
        react, demo, m, cs = c['reaction'], c['contenu'], c['musique'], c['style_choc']
        th = c['texte_choc'] if c['texte_choc'] not in RETIRES else pick_th(demo, c['texte_choc'])
        rm = bricks[react]['meta']; H = float(rm.get('duration_s') or 3)
        rf = get(rm['media'], os.path.basename(rm['media'])); dm = bricks[demo]['meta']['media']; df = get(dm, os.path.basename(dm))
        name = '%s_F05_%s_%s_%s_%s_%s-r%s' % (vf, react, demo, m, th, cs, stamp); out = os.path.join(OUT, name + '.mp4')
        p = sh(['node', 'usine/build-f05.mjs', rf, df, out, m, '--choc', th, '--choc-style', cs, '--hook-s', '%g' % H, '--reaction', react, '--demo', demo])
        if p.returncode or not os.path.exists(out): log('✗', vf, (p.stdout + p.stderr)[-200:]); continue
        patch = {'texte_choc': th, 'hook': th}
    else:
        photo, hook, demo = c['photo'], c['hook'], c['contenu']
        hf = VAR[(photo, hook, 'omni')]; cf = c.get('cta_file') or VAR[(photo, c['cta'], 'omni')]
        h = get('%s/variants/%s.mp4' % (B, hf), hf + '.mp4'); cfile = get('%s/variants/%s.mp4' % (B, cf), cf + '.mp4')
        d = get(bricks[demo]['meta']['media'], os.path.basename(bricks[demo]['meta']['media']))
        th = r['th'] if r['th'] and r['th'] not in RETIRES else None
        tmp = os.path.join(OUT, 'refaire_%s.mp4' % vf)
        cmd = ['node', 'usine/build.mjs', h, d, tmp, music_file(c['musique']) if c.get('musique') else 'auto', h, cfile, '--voice', 'omni', '--format', 'F03',
               '--illus', 'auto', '--subs-style', c.get('sous_titre') or 'auto', '--hook-id', hook, '--demo', demo, '--bricks', BRICKS, '--done', DONE] \
              + (['--choc', th] if th else []) + (['--choc-style', c['style_choc']] if c.get('style_choc') else [])
        p = sh(cmd, env=env)
        if p.returncode or not os.path.exists(tmp): log('✗ rendu', vf, (p.stdout + p.stderr)[-300:]); continue
        fj = json.load(open(tmp + '.format.json'))
        name = '%s_%s_%s_%s_%s_%s_%s_%s_%s-r%s' % (vf, photo, hook, demo, c['cta'], fj.get('musique') or 'M00', fj.get('sous_titre'), fj.get('texte_choc'), fj.get('style_choc'), stamp)
        out = os.path.join(OUT, name + '.mp4'); os.replace(tmp, out)
        for x in (tmp + '.format.json', tmp + '.words.json'):
            try: os.remove(x)
            except OSError: pass
        patch = {'musique': fj.get('musique'), 'sous_titre': fj.get('sous_titre'), 'style_choc': fj.get('style_choc'), 'cta_file': cf}
    poster = out[:-4] + '-poster.jpg'; sh(['ffmpeg', '-v', 'error', '-y', '-ss', '1.5', '-i', out, '-vframes', '1', '-vf', 'scale=540:-1', poster])
    if not (storage_cp(out, 'final/' + name + '.mp4', 'video/mp4') and storage_cp(poster, 'final/' + name + '-poster.jpg', 'image/jpeg')): log('✗', vf, 'dépôt'); continue
    nu, npu = '%s/final/%s.mp4' % (B, name), '%s/final/%s-poster.jpg' % (B, name); old = r['pu'] or r['qu']; pj = json.dumps(patch).replace("'", "''")
    q("begin;delete from factory_fp_frames where video_url='%s';delete from factory_fp where video_url='%s';update factory_qc set video_url='%s', poster_url='%s', "
      "brick_combo=brick_combo||'%s'::jsonb where template='%s';update factory_posts set video_url='%s', combo=combo||'%s'::jsonb "
      "where combo->>'vf'='%s' and status='todo';commit;" % (old, old, nu, npu, pj, vf, nu, pj, vf), js=False)
    ok = q("select count(*) n from factory_posts where combo->>'vf'='%s' and status='todo' and video_url='%s';" % (vf, nu))[0]['n']
    if not ok: log('✗', vf, 'base non mise à jour — ancien fichier GARDÉ'); continue
    f = sh(['node', 'usine/fingerprint.mjs', '--sql', '--as', nu, out])
    if f.returncode == 0 and f.stdout.strip(): q(f.stdout, js=False)
    if old and '/final/' in old and old != nu:
        ob = old.split('/final/')[1]; sh(['supabase', 'storage', 'rm', 'ss:///factory-media/final/' + ob, 'ss:///factory-media/final/' + ob[:-4] + '-poster.jpg', '--experimental', '--linked', '--yes'])
    for x in (out, poster, out + '.format.json'):
        try: os.remove(x)
        except OSError: pass
    log('✓', vf, '→', name)
