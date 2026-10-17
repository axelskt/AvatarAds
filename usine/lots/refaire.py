#!/usr/bin/env python3
# Creative Factory — REFAIRE EN PLACE des vidéos déjà dans le kit (à programmer), avec les règles du jour. La vidéo du post
# est remplacée, le créneau ne bouge pas, l'ancien fichier n'est supprimé qu'APRÈS la mise à jour vérifiée de la base.
#   · Texte + musique (F05) : même réaction, même démo (sa version actuelle), même musique, même style, même texte choc sauf
#     s'il est supprimé ou réservé à d'autres démos (meta.demos).
#   · parlée (F03, 15/10) : même photo, même hook et même CTA dans leur variante ACTUELLE (ex. hook accéléré A3-2 H18 x1,10),
#     même démo, même musique, mêmes sous-titres, même texte choc et même style.
#   · 16/10 (stock commun) : un post du kit venu du stock (factory-media/stock/) reste dans stock/ — la mission BloxAI
#     (partie au kit) reçoit la nouvelle adresse ; l'ancien fichier du stock n'est supprimé que si aucun diffuseur ne l'a —
#     et JAMAIS quand BloxAI est illisible. Poster d'une vidéo du stock = son image 0 (Axel 16/10), comme stock.py / valider.py.
#   · 17/10 (audit S-USINE-1) : l'adresse de la vidéo du post peut venir de BloxAI (kit-recharge) → chaque valeur collée
#     dans le SQL est ÉCHAPPÉE (lit), les numéros d'abord filtrés (VF-0000), et l'adresse remplacée doit être EXACTEMENT
#     factory-media/stock|final/<ce VF>_<nom>.mp4 AVANT toute requête ou suppression : sinon le post est laissé tel quel
#     (jamais de SQL glissé dans une adresse, jamais le fichier d'un autre numéro supprimé).
# usage : python3 usine/lots/refaire.py VF-0316 VF-0322 …
import json, os, re, sys, random, subprocess, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import *
def lit(v): return "'" + str(v).replace("'", "''") + "'"   # littéral SQL échappé (17/10)
NOM_OK = re.compile(r'[A-Za-z0-9._-]+')
def url_ok(u, vf, dossiers=('stock', 'final')):
    """adresse publique factory-media/<dossier>/<vf>_<nom>.mp4, chaîne brute (ni ? # % \\ ' ni sous-dossier)."""
    return isinstance(u, str) and vf_ok(vf) and '..' not in u and bool(
        re.fullmatch(re.escape(B) + '/(' + '|'.join(dossiers) + ')/' + re.escape(vf) + r'_[A-Za-z0-9._-]+\.mp4', u))
vfs = []
for a in sys.argv[1:]:
    if not vf_ok(a): log('✗', repr(a)[:40], 'argument ignoré : VF-0000 attendu')
    elif a not in vfs: vfs.append(a)
if not vfs: raise SystemExit('usage : python3 usine/lots/refaire.py VF-0316 VF-0322 …')
bricks, VARS, _ = snapshot()
VAR = {(v['a'], v['b'], v['f']): os.path.basename(v['u'])[:-4] for v in VARS}
BEDS = os.path.join(os.path.expanduser('~'), 'Downloads', 'Creative Factory', 'musique', 'beds')
def music_file(m):   # même piste que build.mjs : beds/ si elle y est, sinon la banque (nom « Mxx_… » : build.mjs en lit l'id)
    try: f = next((n for n in sorted(os.listdir(BEDS)) if n.startswith(m + '_')), None)
    except OSError: f = None
    return os.path.join(BEDS, f) if f else get('%s/music/%s.mp3' % (B, m), '%s_banque.mp3' % m)
env = dict(os.environ, PRODUCER_BROWSER_GPU_MODE='hardware')
rows = q("select q.template vf, q.brick_combo c, q.technical->'format'->>'texte_choc' th, q.video_url qu, p.id::text pid, p.video_url pu from factory_qc q "
         "left join factory_posts p on p.combo->>'vf'=q.template and p.status='todo' where q.template = any(%s);" % sql_arr(vfs))
RETIRES = {'TH13'}
for r in rows:
    c = r['c']; vf = r['vf']; stamp = time.strftime('%m%d%H%M')
    if not r['pid']: log('✗', vf, 'plus dans le kit à programmer (déjà programmée ou publiée) : on n’y touche pas'); continue
    old = r['pu'] or r['qu']   # vidéo remplacée — vérifiée AVANT tout rendu, requête ou suppression (17/10)
    if not vf_ok(vf) or not url_ok(old, vf):
        log('✗', vf, 'adresse de la vidéo hors de factory-media/stock|final/%s_….mp4 : rien refait, rien supprimé (à vérifier)' % vf); continue
    if c.get('format') == 'F05':
        react, demo, m, cs = c['reaction'], c['contenu'], c['musique'], c['style_choc']
        th = c['texte_choc']; dl = ((bricks.get(th) or {}).get('meta') or {}).get('demos')
        if th in RETIRES: th = pick_th(demo, th)
        elif dl and demo not in dl:   # texte réservé à d'autres démos (15/10 : TI02 parle d'UGC → démos Express seulement)
            th = random.choice([b for b, x in bricks.items() if b[:2] == th[:2] and b != th and x.get('status') == 'ready'
                                and demo in (((x.get('meta') or {}).get('demos')) or [demo])])
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
    if not (NOM_OK.fullmatch(name) and name.startswith(vf + '_')):
        log('✗', vf, 'nom de fichier illisible (%s) : rien déposé, base et ancien fichier inchangés' % name[:80])
        for x in (out, out + '.format.json'):
            try: os.remove(x)
            except OSError: pass
        continue
    dos = 'stock' if '/stock/' in old else 'final'   # même dossier que la vidéo remplacée
    poster = out[:-4] + '-poster.jpg'
    if dos == 'stock': poster_image0(out, poster)
    else: sh(['ffmpeg', '-v', 'error', '-y', '-ss', '1.5', '-i', out, '-vframes', '1', '-vf', 'scale=540:-1', poster])
    if not (os.path.exists(poster) and storage_cp(out, dos + '/' + name + '.mp4', 'video/mp4') and storage_cp(poster, dos + '/' + name + '-poster.jpg', 'image/jpeg')): log('✗', vf, 'dépôt'); continue
    nu, npu = '%s/%s/%s.mp4' % (B, dos, name), '%s/%s/%s-poster.jpg' % (B, dos, name); pj = json.dumps(patch)
    if head_url(nu) != (200, os.path.getsize(out)) or head_url(npu) != (200, os.path.getsize(poster)):   # dépôt RELU avant de toucher à la base
        log('✗', vf, 'dépôt non relu (taille) — base et ancien fichier inchangés'); continue
    q("begin;delete from factory_fp_frames where video_url=%s;delete from factory_fp where video_url=%s;update factory_qc set video_url=%s, poster_url=%s, "
      "brick_combo=brick_combo||%s::jsonb where template=%s;update factory_posts set video_url=%s, combo=combo||%s::jsonb "
      "where combo->>'vf'=%s and status='todo';commit;" % (lit(old), lit(old), lit(nu), lit(npu), lit(pj), lit(vf), lit(nu), lit(pj), lit(vf)), js=False)
    ok = q("select count(*) n from factory_posts where combo->>'vf'=%s and status='todo' and video_url=%s;" % (lit(vf), lit(nu)))[0]['n']
    if not ok: log('✗', vf, 'base non mise à jour — ancien fichier GARDÉ'); continue
    f = sh(['node', 'usine/fingerprint.mjs', '--sql', '--as', nu, out])
    if f.returncode == 0 and f.stdout.strip(): q(f.stdout, js=False)
    garde = False
    if dos == 'stock':   # mission BloxAI de la vidéo : nouvelle adresse si elle est partie au kit ; prise par un diffuseur → ancien fichier gardé
        try:
            bx = bx_pret()
            if bx.get('erreur'): garde = True; log('⚠', vf, 'BloxAI illisible (%s) : ancien fichier du stock GARDÉ' % bx['erreur'][-80:])
            elif bx.get('missions'):
                st = bx_missions([vf]).get(vf); garde = st in ('open', 'assigned', 'done')
                if st == 'kit': bx_q("update public.missions set video_url=%s, poster_url=%s, updated_at=now() where vf=%s and status='kit';" % (lit(nu), lit(npu), lit(vf)))
                if garde: log('⚠', vf, 'mission BloxAI « %s » : ancien fichier du stock GARDÉ' % st)
        except RuntimeError as e: garde = True; log('⚠', vf, 'BloxAI illisible (%s) : ancien fichier du stock GARDÉ' % str(e)[-80:])
    for d_ in ('/final/', '/stock/'):
        if d_ in old and old != nu and not (garde and d_ == '/stock/') and url_ok(old, vf):   # revérifiée : <vf>_<nom>.mp4 de CE numéro
            ob = old.split(d_)[1]; storage_rm(['ss:///factory-media' + d_ + ob, 'ss:///factory-media' + d_ + ob[:-4] + '-poster.jpg'])
    for x in (out, poster, out + '.format.json'):
        try: os.remove(x)
        except OSError: pass
    log('✓', vf, '→', name)
