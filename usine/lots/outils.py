#!/usr/bin/env python3
# Creative Factory — outils communs des LOTS (14/10 : remis dans le repo après la perte du scratchpad, cf. mémoire).
# Instantané des briques / variantes / recettes produites lu en base, téléchargements en cache, dépôt qc/ + factory_qc,
# empreintes. Les vidéos rendues ne restent JAMAIS en local (supprimées après dépôt).
import json, os, random, subprocess, time, urllib.request
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
B = 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media'
WORK = os.environ.get('CF_LOT_DIR') or os.path.join(os.path.expanduser('~'), 'Downloads', 'Creative Factory', 'cache', 'lots')
CACHE = os.path.join(WORK, 'cache'); OUT = os.path.join(WORK, 'out')
for d in (CACHE, OUT): os.makedirs(d, exist_ok=True)
BRICKS = os.path.join(WORK, 'bricks.json'); DONE = os.path.join(WORK, 'done.json')
def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def sh(args, **kw): return subprocess.run(args, cwd=REPO, capture_output=True, text=True, **kw)
def q(sql, js=True):
    f = os.path.join(WORK, '_q%d.sql' % os.getpid()); open(f, 'w').write(sql)
    for k in range(4):
        r = sh(['supabase', 'db', 'query', '--linked', '-f', f, '-o', 'json'])
        t = r.stdout; i = t.find('{')
        if r.returncode == 0 and i >= 0:
            o = json.loads(t[i:])
            if 'rows' in o: return o['rows'] if js else []
        time.sleep(5)
    raise RuntimeError('requête : ' + (r.stdout + r.stderr)[-400:])
def snapshot():
    """bricks.json (pour build.mjs), variantes (photo, brique) → fichier, recettes déjà produites."""
    br = q("select json_agg(json_build_object('id',id,'kind',kind,'label',label,'meta',meta,'status',status,'subject',subject)) x from factory_bricks;")[0]['x']
    json.dump(br, open(BRICKS, 'w')); json.dump([], open(DONE, 'w'))
    var = q("select avatar_id a, brick_id b, format f, video_url u from factory_variants order by created_at;")
    qc = q("select template t, status s, brick_combo c from factory_qc;")
    return {b['id']: b for b in br}, var, qc
def get(url, name):
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        tmp = p + '.%d.part' % os.getpid(); urllib.request.urlretrieve(url, tmp); os.replace(tmp, p)
    return p
def dur(f): return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.strip() or 0)
def storage_cp(src, dst, ct=None):
    for _ in range(4):
        r = sh(['supabase', 'storage', 'cp', src, 'ss:///factory-media/' + dst, '--experimental', '--linked'] + (['--content-type', ct] if ct else []))
        if r.returncode == 0 or 'Duplicate' in r.stdout + r.stderr: return True
        time.sleep(4)
    return False
# ── textes choc des vidéos sans voix (F05) : banque usine/formats.js ; TH13 supprimée, TH14 (montage) hors F05 ;
#    textes « Claude » seulement avec une démo Claude muette (C-MCPM) ──
TH_MCP = {'TH10', 'TH11', 'TH12', 'TH24', 'TH26', 'TH27', 'TH29', 'TH30', 'TH31', 'TH32'}
CS = ['CS01', 'CS02', 'CS03', 'CS05', 'CS07', 'CS08', 'CS11', 'CS17']
def pick_th(demo, prev):
    ths = ['TH%02d' % i for i in range(1, 35) if i not in (13, 14)]
    ok = [t for t in ths if t != prev and (t not in TH_MCP or demo.startswith('C-MCPM'))]
    return random.choice(ok)
# musiques énergiques (Axel 07/10 + 11/10) assez longues pour un F05
MUSIC_LEN = {'M08': 186.2, 'M14': 60.0, 'M20': 40.6, 'M21': 28.0, 'M22': 60.0, 'M23': 60.0, 'M24': 488.2}
_last_music = [None]
def f05_music(total):
    ok = [m for m, l in MUSIC_LEN.items() if l >= total + 0.5 and m != _last_music[0]] or ['M08']
    m = random.choice(ok); _last_music[0] = m; return m
def publish(j, vf):
    """vidéo rendue → qc/ + ligne factory_qc 'pending' + empreinte ; renvoie (nom, durée, zone du texte choc)."""
    fj = json.load(open(j['out'] + '.format.json'))
    if j['kind'] == 'o':
        name = '%s_%s_%s_%s_%s_%s_%s_%s_%s' % (vf, j['photo'], j['hook'], j['demo'], j['cta'], fj.get('musique') or 'M00', fj.get('sous_titre'), fj.get('texte_choc'), fj.get('style_choc'))
    else:
        name = '%s_F05_%s_%s_%s_%s_%s' % (vf, j['react'], j['demo'], j['music'], j['th'], j['cs'])
    final = os.path.join(OUT, name + '.mp4'); os.replace(j['out'], final); os.replace(j['out'] + '.format.json', final + '.format.json')
    if os.path.exists(j['out'] + '.words.json'): os.replace(j['out'] + '.words.json', final + '.words.json')
    T = dur(final)
    if j['kind'] == 'o':
        combo = {'voice': 'omni', 'avatar': j['photo'].split('-')[0], 'photo': j['photo'], 'hook': j['hook'], 'contenu': j['demo'], 'cta': j['cta'],
                 'musique': fj.get('musique'), 'sous_titre': fj.get('sous_titre')}
        r = sh(['node', 'usine/publish-qc.mjs', final, vf, json.dumps(combo), '--bricks', BRICKS])
        line = [l for l in r.stdout.splitlines() + r.stderr.splitlines() if l.startswith('{"video_url')]
        if not line: raise RuntimeError('publish-qc : ' + (r.stdout + r.stderr)[-300:])
        row = json.loads(line[0]); row['brick_combo']['style_choc'] = fj.get('style_choc'); row['brick_combo']['cta_file'] = j['cf']
        if j.get('pair'): row['brick_combo']['illus_pair'] = j['pair']
    else:
        poster = final[:-4] + '-poster.jpg'
        sh(['ffmpeg', '-v', 'error', '-y', '-ss', '1.5', '-i', final, '-vframes', '1', '-vf', 'scale=540:-1', poster])
        if not (storage_cp(final, 'qc/' + name + '.mp4', 'video/mp4') and storage_cp(poster, 'qc/' + name + '-poster.jpg', 'image/jpeg')): raise RuntimeError('dépôt qc/')
        tech = json.loads(sh(['node', 'usine/qc.mjs', final, '--json']).stdout or '{}'); tech['format'] = {'format': 'F05', 'zone': (fj.get('layout') or {}).get('zone'), 'size': (fj.get('layout') or {}).get('size'), 'texte_choc': j['th']}
        row = {'video_url': '%s/qc/%s.mp4' % (B, name), 'poster_url': '%s/qc/%s-poster.jpg' % (B, name), 'template': vf,
               'brick_combo': {'hook': j['th'], 'voice': 'muet', 'format': 'F05', 'contenu': j['demo'], 'musique': j['music'], 'reaction': j['react'], 'style_choc': j['cs'], 'texte_choc': j['th']},
               'technical': tech, 'vision': None, 'route': 'manual', 'status': 'pending'}
        os.remove(poster)
    q("insert into factory_qc (video_url,poster_url,template,brick_combo,technical,vision,route,status) select video_url,poster_url,template,brick_combo,technical,vision,route,status "
      "from jsonb_populate_recordset(null::factory_qc, $j$" + json.dumps([row]) + "$j$::jsonb);", js=False)
    r = sh(['node', 'usine/fingerprint.mjs', '--sql', '--as', row['video_url'], final])
    if r.returncode == 0 and r.stdout.strip(): q(r.stdout, js=False)
    for f in (final, final + '.format.json', final + '.words.json'):
        try: os.remove(f)
        except OSError: pass
    return name, round(T, 1), ((fj.get('layout') or {}).get('zone') or '')
