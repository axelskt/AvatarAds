#!/usr/bin/env python3
# Creative Factory — REFAIRE EN PLACE des vidéos Texte + musique déjà dans le kit (même réaction, même démo — sa version
# actuelle —, même musique, même style, même texte choc sauf s'il est supprimé), avec les règles du jour. La vidéo du post est
# remplacée, le créneau ne bouge pas, l'ancien fichier n'est supprimé qu'APRÈS la mise à jour vérifiée de la base.
# usage : python3 usine/lots/refaire.py VF-0316 VF-0322 …
import json, os, sys, random, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import *
vfs = sys.argv[1:]
bricks, _, _ = snapshot()
rows = q("select q.template vf, q.brick_combo c, q.video_url qu, p.id::text pid, p.video_url pu from factory_qc q left join factory_posts p on p.combo->>'vf'=q.template and p.status='todo' "
         "where q.template in (%s);" % ','.join("'%s'" % v for v in vfs))
RETIRES = {'TH13'}
for r in rows:
    c = r['c']; vf = r['vf']
    if c.get('format') != 'F05': log('✗', vf, 'parlée : à refaire via lot.py (recette identique)'); continue
    react, demo, m, cs = c['reaction'], c['contenu'], c['musique'], c['style_choc']
    th = c['texte_choc'] if c['texte_choc'] not in RETIRES else pick_th(demo, c['texte_choc'])
    rm = bricks[react]['meta']; H = float(rm.get('duration_s') or 3)
    rf = get(rm['media'], os.path.basename(rm['media'])); dm = bricks[demo]['meta']['media']; df = get(dm, os.path.basename(dm))
    name = '%s_F05_%s_%s_%s_%s_%s-r%s' % (vf, react, demo, m, th, cs, time.strftime('%m%d%H%M')); out = os.path.join(OUT, name + '.mp4')
    p = sh(['node', 'usine/build-f05.mjs', rf, df, out, m, '--choc', th, '--choc-style', cs, '--hook-s', '%g' % H, '--reaction', react, '--demo', demo])
    if p.returncode or not os.path.exists(out): log('✗', vf, (p.stdout + p.stderr)[-200:]); continue
    poster = out[:-4] + '-poster.jpg'; sh(['ffmpeg', '-v', 'error', '-y', '-ss', '1.5', '-i', out, '-vframes', '1', '-vf', 'scale=540:-1', poster])
    if not (storage_cp(out, 'final/' + name + '.mp4', 'video/mp4') and storage_cp(poster, 'final/' + name + '-poster.jpg', 'image/jpeg')): log('✗', vf, 'dépôt'); continue
    nu, npu = '%s/final/%s.mp4' % (B, name), '%s/final/%s-poster.jpg' % (B, name); old = r['pu'] or r['qu']
    q("begin;delete from factory_fp_frames where video_url='%s';delete from factory_fp where video_url='%s';update factory_qc set video_url='%s', poster_url='%s', "
      "brick_combo=brick_combo||jsonb_build_object('texte_choc','%s','hook','%s') where template='%s';update factory_posts set video_url='%s', combo=combo||jsonb_build_object('texte_choc','%s','hook','%s') "
      "where combo->>'vf'='%s' and status='todo';commit;" % (old, old, nu, npu, th, th, vf, nu, th, th, vf), js=False)
    ok = q("select count(*) n from factory_posts where combo->>'vf'='%s' and status='todo' and video_url='%s';" % (vf, nu))[0]['n']
    if r['pid'] and not ok: log('✗', vf, 'base non mise à jour — ancien fichier GARDÉ'); continue
    f = sh(['node', 'usine/fingerprint.mjs', '--sql', '--as', nu, out])
    if f.returncode == 0 and f.stdout.strip(): q(f.stdout, js=False)
    if old and '/final/' in old and old != nu:
        ob = old.split('/final/')[1]; sh(['supabase', 'storage', 'rm', 'ss:///factory-media/final/' + ob, 'ss:///factory-media/final/' + ob[:-4] + '-poster.jpg', '--experimental', '--linked', '--yes'])
    for x in (out, poster, out + '.format.json'):
        try: os.remove(x)
        except OSError: pass
    log('✓', vf, '→', name)
