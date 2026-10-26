#!/usr/bin/env python3
# Creative Factory — outils communs des LOTS (14/10 : remis dans le repo après la perte du scratchpad, cf. mémoire).
# Instantané des briques / variantes / recettes produites lu en base, téléchargements en cache, dépôt qc/ + factory_qc,
# empreintes. Les vidéos rendues ne restent JAMAIS en local (supprimées après dépôt).
import json, os, random, shutil, subprocess, threading, time, urllib.request
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
B = 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media'
WORK = os.environ.get('CF_LOT_DIR') or os.path.join(os.path.expanduser('~'), 'Downloads', 'Creative Factory', 'cache', 'lots')
CACHE = os.path.join(WORK, 'cache'); OUT = os.path.join(WORK, 'out')
for d in (CACHE, OUT): os.makedirs(d, exist_ok=True)
BRICKS = os.path.join(WORK, 'bricks.json'); DONE = os.path.join(WORK, 'done.json')
def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)
def sh(args, **kw): return subprocess.run(args, cwd=REPO, capture_output=True, text=True, **kw)
# 16/10 : transferts et requêtes BORNÉS dans le temps — un « supabase storage cp » ou un « db query » bloqué figeait un lot
# (une nuit de --migrer --go) sans fin ; au-delà du délai le processus est tué et c'est un échec ordinaire, donc réessayé.
D_REQ, D_CP, D_RM = 180, 900, 120   # secondes : requête SQL · dépôt d'un fichier (90 Mo) · suppression
class _Delai: returncode = 124; stdout = ''; stderr = 'délai dépassé'
def sh_borne(args, delai, **kw):
    try: return sh(args, timeout=delai, **kw)
    except subprocess.TimeoutExpired: return _Delai()
def q(sql, js=True):
    f = os.path.join(WORK, '_q%d.sql' % os.getpid()); open(f, 'w').write(sql)
    for k in range(4):
        r = sh_borne(['supabase', 'db', 'query', '--linked', '-f', f, '-o', 'json'], D_REQ)
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
    """téléchargement en cache, lu par morceaux avec un délai (60 s sans octet → exception) ; jamais de fichier tronqué en cache."""
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        tmp = p + '.%d.%d.part' % (os.getpid(), threading.get_ident())
        try:
            with urllib.request.urlopen(url, timeout=60) as r, open(tmp, 'wb') as f:
                n = int(r.headers.get('Content-Length') or -1); shutil.copyfileobj(r, f, 1 << 20)
            if n >= 0 and os.path.getsize(tmp) != n: raise IOError('téléchargement tronqué : ' + url[-80:])
            os.replace(tmp, p)
        finally:
            try: os.remove(tmp)
            except OSError: pass
    return p
def dur(f): return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.strip() or 0)
def storage_cp(src, dst, ct=None):
    for _ in range(4):
        r = sh_borne(['supabase', 'storage', 'cp', src, 'ss:///factory-media/' + dst, '--experimental', '--linked'] + (['--content-type', ct] if ct else []), D_CP)
        if r.returncode == 0 or 'Duplicate' in r.stdout + r.stderr: return True
        time.sleep(4)
    return False
def storage_rm(paths):
    """supprime des objets factory-media ('ss:///factory-media/…'), borné dans le temps ; True si le CLI a répondu sans erreur
    (l'appelant RELIT toujours l'absence avant d'en tirer une conclusion)."""
    return bool(paths) and sh_borne(['supabase', 'storage', 'rm', *paths, '--experimental', '--linked', '--yes'], D_RM).returncode == 0
# ── textes choc des vidéos sans voix (F05) : banque usine/formats.js ; TH13 supprimée, TH14 (montage) hors F05 ;
#    textes « Claude » seulement avec une démo Claude muette (C-MCPM) ──
TH_MCP = {'TH10', 'TH11', 'TH12', 'TH24', 'TH26', 'TH27', 'TH29', 'TH30', 'TH31', 'TH32', 'TH36', 'TH37'}   # TH36 cheat code (18/10) ; TH37 (21/10)
CS = ['CS01', 'CS02', 'CS03', 'CS05', 'CS07', 'CS08', 'CS11', 'CS17']
def pick_th(demo, prev):
    ths = ['TH%02d' % i for i in range(1, 35) if i not in (13, 14)] + ['TH36', 'TH37']   # TH35 = format scotch seulement
    ok = [t for t in ths if t != prev and (t not in TH_MCP or demo.startswith('C-MCPM'))]
    return random.choice(ok)
# Format Insomnie (R-I-*) : un TI, jamais un TH. TI01 supprimé ; TI02 = démos Express seulement ; TI03 = démos MCP seulement.
TI02_DEMOS = ('C-MCPM-01', 'C-MCPM-03', 'C-MCPM-04', 'C-MCPM-05', 'C-MCPM-06')
def pick_ti(demo, prev):
    ok = [t for t in ['TI%02d' % i for i in range(2, 10)] if t != prev
          and (t != 'TI02' or demo in TI02_DEMOS) and (t != 'TI03' or demo.startswith('C-MCPM'))]
    return random.choice(ok)
# musiques énergiques (Axel 07/10 + 11/10) assez longues pour un F05
MUSIC_LEN = {'M08': 186.2, 'M14': 60.0, 'M20': 40.6, 'M21': 28.0, 'M22': 60.0, 'M23': 60.0, 'M24': 488.2, 'M25': 113.6,
             'M26': 60.4, 'M27': 30.0}   # 17/10 : Tesla electro mix, Vyzee — Sophie
_last_music = [None]
def f05_music(total):
    ok = [m for m, l in MUSIC_LEN.items() if l >= total + 0.5 and m != _last_music[0]] or ['M08']
    m = random.choice(ok); _last_music[0] = m; return m
def publish(j, vf):
    """vidéo rendue → qc/ + ligne factory_qc 'pending' + empreinte ; renvoie (nom, durée, zone du texte choc)."""
    fj = json.load(open(j['out'] + '.format.json'))
    if j['kind'] == 'o':
        name = '%s_%s_%s_%s_%s_%s_%s_%s_%s' % (vf, j['photo'], j['hook'], j['demo'], j['cta'], fj.get('musique') or 'M00', fj.get('sous_titre'), fj.get('texte_choc') or ('SPLIT' if j.get('split') else 'INCRUSTE' if j.get('incruste') else None), fj.get('style_choc') or j.get('split') or (j.get('incruste') or '').upper().replace('DEGRADE-', 'DG') or None)
    else:
        name = '%s_F05_%s_%s_%s_%s_%s' % (vf, j['react'], j['demo'], j['music'], j['th'], j['cs'])
    final = os.path.join(OUT, name + '.mp4'); os.replace(j['out'], final); os.replace(j['out'] + '.format.json', final + '.format.json')
    if os.path.exists(j['out'] + '.words.json'): os.replace(j['out'] + '.words.json', final + '.words.json')
    T = dur(final)
    if os.environ.get('LOT_4K'):   # Axel 27/10 : livré en 4K (agrandi lanczos à la toute fin, 42 Mbit/s, même son)
        k4 = final[:-4] + '-4k.mp4'
        sh(['ffmpeg', '-v', 'error', '-y', '-i', final, '-vf', 'scale=2160:3840:flags=lanczos', '-c:v', 'h264_videotoolbox', '-b:v', '42M', '-maxrate', '50M',
            '-bufsize', '80M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', k4])
        if not os.path.exists(k4): raise RuntimeError('agrandissement 4K')
        os.replace(k4, final)
    if j['kind'] == 'o':
        combo = {'voice': 'omni', 'avatar': j['photo'].split('-')[0], 'photo': j['photo'], 'hook': j['hook'], 'contenu': j['demo'], 'cta': j['cta'],
                 'musique': fj.get('musique'), 'sous_titre': fj.get('sous_titre')}
        r = sh(['node', 'usine/publish-qc.mjs', final, vf, json.dumps(combo), '--bricks', BRICKS])
        line = [l for l in r.stdout.splitlines() + r.stderr.splitlines() if l.startswith('{"video_url')]
        if not line: raise RuntimeError('publish-qc : ' + (r.stdout + r.stderr)[-300:])
        row = json.loads(line[0]); row['brick_combo']['style_choc'] = fj.get('style_choc'); row['brick_combo']['cta_file'] = j['cf']
        if j.get('pair'): row['brick_combo']['illus_pair'] = j['pair']
        if j.get('hf_var'): row['brick_combo']['hook_variant'] = j['hf_var']   # 20/10 : H89-GRILLE / H89-GRILLE-C
        if j.get('vo'): row['brick_combo']['voix_off'] = j['vo']   # 21/10 : format voix off Motion Control (TX-M…)
        if j.get('fv'): row['brick_combo']['fond_vert'] = j['fv']   # 21/10 : format fond vert (avatar détouré devant TX-…)
        if j.get('incruste'):   # 26/10 : texte incrusté (F-AP-INCRUSTE) — couleur du mot fort + Hook démo de la banque
            row['brick_combo'].update(incruste=True, incruste_style=j['incruste'], hook_demos=j.get('hd') or [], demo_vitesse=1.08)
        if j.get('split'):   # 23/10 : format split (A / B) et résultats « Hook démo » montrés en haut
            row['brick_combo']['split'] = j['split']; row['brick_combo']['hook_demos'] = j.get('hd') or []
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
# ── STOCK COMMUN (16/10, Axel : « un gros kit de production pour tout le monde ») : une vidéo validée part sur UN seul
#    compte, jamais deux — un des 3 comptes Instagram d'Axel (le kit, servi en premier : 7 jours d'avance, rechargé par la
#    fonction kit-recharge) OU un diffuseur BloxAI (une mission). Fichiers : factory-media/stock/<nom>.mp4 + <nom>-poster.jpg.
#    BloxAI est un AUTRE projet Supabase, joint seulement par le CLI (jamais de clé dans le code). ──
BLOX = os.environ.get('BLOXAI_DIR') or os.path.join(os.path.dirname(REPO), 'bloxai-site')
if not os.path.isdir(BLOX):   # dépôt lancé depuis une copie (scratchpad) : le site BloxAI est à sa place habituelle
    BLOX = os.path.join(os.path.expanduser('~'), 'Downloads', 'Autre SaaS', 'bloxai-site')
BX_REF = 'rlkcyrldkwutyjymjcxi'
LEGENDE_BX = 'Publicité · Vidéo créée avec AvatarAds. Teste-le sur avatarads.fr'   # légende proposée au diffuseur (mention pub)
def vf_ok(v): return isinstance(v, str) and len(v) == 7 and v.startswith('VF-') and v[3:].isdigit()
def sql_arr(vals, typ='text'):
    """array['a','b']::text[] (valeurs échappées) — pour les listes de VF / d'adresses / d'id dans les requêtes."""
    return 'array[%s]::%s[]' % (','.join("'%s'" % str(v).replace("'", "''") for v in vals), typ)
# durée (s) d'une vidéo validée (alias q = factory_qc) : empreinte factory_fp, sinon le contrôle « duree » de qc.mjs
DUREE_SQL = ("coalesce((select f.duration from factory_fp f where f.video_url=q.video_url limit 1)::numeric, substring(jsonb_path_query_first(q.technical, "
             "'$.checks[*] ? (@.name == \"duree\").detail') #>> '{}' from '^([0-9.]+)s')::numeric)")
def _cli_q(sql, extra, cwd, tag, tries=4):
    """supabase db query -o json → lignes. Une erreur SQL (fonction absente, exception) n'est pas réessayée : seulement les coupures."""
    f = os.path.join(WORK, '_%s_%d.sql' % (tag, os.getpid())); open(f, 'w').write(sql); err = ''
    try:
        for k in range(tries):
            try: r = subprocess.run(['supabase', 'db', 'query', '--linked', *extra, '-f', f, '-o', 'json'], cwd=cwd, capture_output=True, text=True, timeout=D_REQ)
            except subprocess.TimeoutExpired: r = _Delai()   # coupure : réessayée comme les autres
            t = r.stdout; i = t.find('{')
            if r.returncode == 0 and i >= 0:
                o = json.JSONDecoder().raw_decode(t, i)[0]
                if 'rows' in o: return o['rows']
            err = (r.stdout + r.stderr).strip()
            if 'Failed to run sql query' in err: break
            if k < tries - 1: time.sleep(5)
    finally:
        try: os.remove(f)
        except OSError: pass
    raise RuntimeError('requête : ' + err[-400:])
def q1(sql):
    """comme q() (AvatarAds) mais une erreur SQL remonte tout de suite (RuntimeError), sans 4 essais."""
    return _cli_q(sql, [], REPO, 'q1')
def bx_q(sql):
    """requête sur la base BloxAI (rlkcyrldkwutyjymjcxi) par le CLI, dossier bloxai-site — même format que q()."""
    return _cli_q(sql, ['--project-ref', BX_REF, '--workdir', BLOX], BLOX, 'bx')
def bx_pret():
    """ce qui existe côté BloxAI (la migration « missions » peut ne pas être appliquée) : {missions, settings, assignments, push}."""
    try:
        return bx_q("select to_regclass('public.missions') is not null missions, to_regclass('public.settings') is not null settings, "
                    "to_regclass('public.assignments') is not null assignments, to_regprocedure('public.bx_push_missions(jsonb)') is not null push;")[0]
    except RuntimeError as e: return {'missions': False, 'settings': False, 'assignments': False, 'push': False, 'erreur': str(e)[-200:]}
def bx_missions(vfs):
    """{vf: statut} des missions BloxAI de ces VF (la table missions doit exister)."""
    vfs = sorted({v for v in vfs if vf_ok(v)}); out = {}
    for i in range(0, len(vfs), 400):
        for r in bx_q("select vf, status s from public.missions where vf = any(%s);" % sql_arr(vfs[i:i + 400])): out[r['vf']] = r['s']
    return out
def bx_pousser(items):
    """items = [{vf, video_url, poster_url, caption, combo, duration_s, source_post_id}] → missions OUVERTES dans le stock
    commun (bx_push_missions : une VF déjà présente n'est pas touchée). Renvoie {vf: statut} RELU après coup."""
    items = [x for x in items if vf_ok(x.get('vf'))]
    if not items: return {}
    js = json.dumps(items)
    if '$j$' in js: raise RuntimeError('mission illisible ($j$)')
    for i in range(0, len(items), 50):
        bx_q("select public.bx_push_missions($j$" + json.dumps(items[i:i + 50]) + "$j$::jsonb) n;")
    return bx_missions([x['vf'] for x in items])
def head_url(url):
    """(code HTTP, taille) d'un fichier public, sans le cache du CDN ; 404 si absent (Supabase répond 400 pour un objet absent)."""
    u = url + ('&' if '?' in url else '?') + 'cb=%d' % time.time_ns(); c = 0
    for _ in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(u, method='HEAD'), timeout=30)
            return r.status, int(r.headers.get('Content-Length') or -1)
        except urllib.error.HTTPError as e:
            if e.code in (400, 404): return 404, -1
            c = e.code
        except Exception: c = 0
        time.sleep(2)
    return c, -1
def copie_verifiee(src, dst, ct):
    """copie le fichier public src (URL factory-media) vers le chemin dst (ex. 'stock/<nom>.mp4') et la VÉRIFIE : même taille
    relue sur l'adresse publique. Déjà là avec la même taille → rien à refaire ; source déjà supprimée mais copie présente → bon.
    Renvoie True seulement si dst est complet. Ne supprime JAMAIS la source."""
    dst_url = '%s/%s' % (B, dst); cs, ts = head_url(src); cd, td = head_url(dst_url)
    if cd == 200 and td > 0 and (cs == 404 or td == ts): return True
    if cs != 200 or ts <= 0: return False
    if cd == 200:   # copie incomplète ou ancienne : remplacée (la source est là)
        storage_rm(['ss:///factory-media/' + dst])
    name = '_cp_%d_%s' % (os.getpid(), os.path.basename(dst)); p = os.path.join(CACHE, name)
    try:
        for _ in range(2):
            try: get(src, name)
            except Exception: pass
            if os.path.exists(p) and os.path.getsize(p) == ts: break
            if os.path.exists(p): os.remove(p)
        else: return False
        if not storage_cp(p, dst, ct): return False
    finally:
        try: os.remove(p)
        except OSError: pass
    cd, td = head_url(dst_url)
    return cd == 200 and td == ts
def poster_image0(mp4, jpg):
    """poster d'une vidéo du stock = son IMAGE 0 (Axel 16/10 : plus l'image à 1,5 s), 720 px de large, tiré du MP4 local."""
    r = sh_borne(['ffmpeg', '-v', 'error', '-y', '-i', mp4, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', jpg], 120)
    return r.returncode == 0 and os.path.exists(jpg) and os.path.getsize(jpg) > 0
def vers_stock(src, nom):
    """vidéo src (URL publique factory-media : final/, qc/ ou déjà stock/) → stock/<nom>.mp4 (copie RELUE : même taille) +
    stock/<nom>-poster.jpg = IMAGE 0 du MP4 téléchargé (relu : même taille ; l'ancien poster à 1,5 s n'est plus copié).
    Vidéo et poster déjà là → rien n'est refait (reprise). Ne supprime JAMAIS la source. '' si tout est en place dans stock/,
    sinon la raison de l'échec (réessayable)."""
    dv, dp = '%s/stock/%s.mp4' % (B, nom), '%s/stock/%s-poster.jpg' % (B, nom)
    cs, tsrc = head_url(src); cd, td = head_url(dv)
    v_ok = cd == 200 and td > 0 and (cs == 404 or td == tsrc)
    p_la = head_url(dp)[0] == 200
    if v_ok and p_la: return ''
    if not v_ok and (cs != 200 or tsrc <= 0): return 'copie de la vidéo (source absente)' if cs == 404 else 'copie de la vidéo (source illisible : HTTP %s)' % cs
    lien, taille = (dv, td) if v_ok else (src, tsrc)   # le poster se tire de la copie stock/ déjà relue, sinon de la source
    tag = '_st_%d_%d_%s' % (os.getpid(), threading.get_ident(), nom)
    mp4, jpg = os.path.join(CACHE, tag + '.mp4'), os.path.join(CACHE, tag + '-poster.jpg')
    try:
        for _ in range(2):
            try: get(lien, tag + '.mp4')
            except Exception: pass
            if os.path.exists(mp4) and os.path.getsize(mp4) == taille: break
            if os.path.exists(mp4): os.remove(mp4)
        else: return 'copie de la vidéo (téléchargement)'
        if not v_ok:
            if cd == 200: storage_rm(['ss:///factory-media/stock/%s.mp4' % nom])   # copie incomplète / ancienne : remplacée (la source est là)
            if not storage_cp(mp4, 'stock/%s.mp4' % nom, 'video/mp4'): return 'copie de la vidéo (dépôt)'
            c2, t2 = head_url(dv)
            if not (c2 == 200 and t2 == taille): return 'copie de la vidéo (relue : taille différente)'
        if not poster_image0(mp4, jpg): return 'poster (image 0) : ffmpeg'
        if p_la: storage_rm(['ss:///factory-media/stock/%s-poster.jpg' % nom])   # poster d'une copie remplacée : refait
        if not storage_cp(jpg, 'stock/%s-poster.jpg' % nom, 'image/jpeg'): return 'poster (dépôt)'
        c3, t3 = head_url(dp)
        if not (c3 == 200 and t3 == os.path.getsize(jpg)): return 'poster (relu : taille différente)'
        return ''
    finally:
        for f in (mp4, jpg):
            try: os.remove(f)
            except OSError: pass
def limite_kit(jours=7):
    """fin du kit d'Axel (7 jours d'avance) : minuit, heure de Paris, à la fin du jour J+7. Un post « à programmer » à partir
    de là appartient au stock commun ; kit-recharge remplit le kit jusque-là."""
    import datetime as _dt
    from zoneinfo import ZoneInfo as _ZI
    par = _ZI('Europe/Paris'); d = _dt.datetime.now(par).date() + _dt.timedelta(days=jours + 1)
    return _dt.datetime.combine(d, _dt.time(0), par)
def legende_kit(name, c):
    """légende du kit d'Axel = le CTA de la vidéo (café, CLAUDE, SITE), sans hashtag ni nom de fournisseur. Règle d'avant le
    16/10 (valider.py), reprise par la fonction kit-recharge qui pose maintenant les posts du kit."""
    if '_CTA-cafe_' in name: return "Tu peux toi aussi faire la même chose pour seulement un café par jour. Commente « SITE » et je t'envoie le lien en privé."
    if (c or {}).get('format') == 'F05' and ('_C-MCPM-' in name or '_C-MCM-' in name or any('_C-OMNIM-%02d_' % k in name for k in (5, 6, 7))):
        return "Commente « CLAUDE » et je t'envoie le lien en privé."
    if '_CTA-CLAUDE_' in name: return "Commente « CLAUDE » et je t'envoie le lien en privé pour faire la même chose."
    return "Écris « SITE » en commentaire et je t'envoie le tutoriel complet gratuitement pour faire la même chose."
def kit_recharge():
    """recharge immédiate du kit d'Axel : select kit_recharge_now() (AvatarAds → fonction kit-recharge). Tolère son absence."""
    try:
        if not q1("select to_regprocedure('public.kit_recharge_now()') is not null ok;")[0]['ok']:
            return 'kit : kit_recharge_now() absente (migration AvatarAds pas encore appliquée) — rechargé au prochain passage quotidien'
        if q1("select public.kit_recharge_now() r;")[0].get('r') is None:   # null = clé cron absente du coffre : rien n'est appelé
            return 'kit : recharge NON lancée (clé cron absente du coffre Vault) — à corriger côté AvatarAds'
        return 'kit : recharge demandée (kit-recharge remplit jusqu\'à J+7 depuis le stock commun)'
    except RuntimeError as e: return 'kit : recharge impossible (%s) — elle se fera au passage quotidien' % str(e)[-160:]
