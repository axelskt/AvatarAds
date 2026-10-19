#!/usr/bin/env python3
# Creative Factory — VALIDER des vidéos (« validé » = dans le STOCK COMMUN, sans redemander). usage :
#   python3 usine/lots/valider.py VF-0439 VF-0440 …        (ou un état de lot : python3 usine/lots/valider.py --lot lot-1410b)
# 16/10 (Axel : « un gros kit de production pour tout le monde ») : qc/ → stock/ (copie relue : même taille) + poster =
# IMAGE 0 de la vidéo (Axel 16/10, plus l'image à 1,5 s de qc/), factory_qc 'approved' + adresses stock/ (empreintes
# comprises), puis une mission OUVERTE dans le stock commun BloxAI (légende diffuseur « Publicité · … », recette, durée).
# Plus AUCUNE insertion directe dans le kit : la fonction kit-recharge le remplit jusqu'à J+7 depuis le stock (comptes
# d'Axel servis en premier : 12-14-16-18-20 h / 11-13-15-17-19 h, jamais deux fois la même photo ou réaction de suite,
# parlé / sans voix alternés, légende = le CTA) ; le reste part aux diffuseurs. Une vidéo = UN compte.
#   · fin : select kit_recharge_now() (recharge immédiate du kit) ; equilibrer.py n'est plus lancé : le kit ne dépasse plus
#     J+7, kit-recharge alterne déjà les formats en posant les posts, et un rééquilibrage se croiserait avec sa recharge
#     (asynchrone) ;
#   · BloxAI injoignable / pas encore en place : les vidéos restent validées dans stock/ → stock.py --pousser VF-… les y met.
# AVANT la mise en place (kit_recharge_now() absente côté AvatarAds = étape 4 du plan pas encore faite) : le kit ne se
# recharge pas depuis le stock, donc « validé = kit direct » reste l'ANCIEN chemin du 14/10 (final/ + posts intercalés après
# J+7 + equilibrer.py) ; à l'étape 5, stock.py --migrer fait passer ces posts au stock commun avec le reste du kit.
import json, os, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import *
if sys.argv[1:2] == ['--lot']: vfs = [x['vf'] for x in json.load(open(os.path.join(WORK, sys.argv[2] + '.json')))['ok']]
else: vfs = [a for a in sys.argv[1:] if a.startswith('VF-')]
vfs = [v for v in dict.fromkeys(vfs) if vf_ok(v)]
if not vfs: raise SystemExit('rien à valider')
SELQ = ("select q.template vf, q.video_url u, q.poster_url p, q.status s, coalesce(q.brick_combo,'{}'::jsonb)||jsonb_build_object('vf',q.template) c, "
        + DUREE_SQL + " d from factory_qc q where q.template in (" + ','.join("'%s'" % v for v in vfs) + ") order by q.template;")
rows = q(SELQ); KO = []
for v in sorted(set(vfs) - {r['vf'] for r in rows}): KO.append((v, 'inconnue'))
# 0) le stock commun est-il en place côté AvatarAds ? (illisible → rien n'est fait)
try: NOUVEAU = bool(q1("select to_regprocedure('public.kit_recharge_now()') is not null ok;")[0]['ok'])
except RuntimeError as e: raise SystemExit('✗ base AvatarAds illisible (%s) : rien n\'est fait' % str(e)[-160:])

def ancien_kit(neuves):
    """AVANT l'étape 4 : l'ancien « validé = kit direct » du 14/10, à l'identique — qc/ → final/ (copie relue), factory_qc
    'approved', posts INTERCALÉS dans la fin du kit (jamais avant J+7 : Axel programme à l'avance ; jamais deux fois la même
    photo / réaction de suite, de préférence en alternant parlé / sans voix ; posts décalés dans UNE transaction ; légende =
    le CTA), puis equilibrer.py (pas encore de kit-recharge avec qui se croiser)."""
    import datetime as dt
    from zoneinfo import ZoneInfo
    PAR, UTC = ZoneInfo('Europe/Paris'), dt.timezone.utc
    # Axel 16/10 : @leoadsia plafonne (aucune vidéo au-dessus de 167 vues) → 3 posts par jour au lieu de 5
    HRS = {'avataradss': [12, 14, 16, 18, 20], 'leoadsia': [12, 16, 20], 'ialebd.axel': [11, 13, 15, 17, 19]}
    def unit(r):   # « photo » au sens du kit : la photo d'avatar (parlée) ou la réaction (sans voix)
        c = r['c'] or {}; return c.get('reaction') if c.get('format') == 'F05' else c.get('photo')
    def kind(c): return 'm' if (c or {}).get('format') == 'F05' else 'o'
    def copier_final(r):
        try:
            for u, ct in ((r['u'], 'video/mp4'), (r['p'], 'image/jpeg')):
                if not u or '/qc/' not in u: continue
                if ct == 'image/jpeg' and head_url(u)[0] == 404: log('⚠', r['vf'], 'poster absent de qc/'); continue
                if not copie_verifiee(u, 'final/' + u.split('/qc/')[1], ct): return False
            return True
        except Exception as e: log('✗', r['vf'], str(e)[-160:]); return False
    # 1) qc/ → final/
    with cf.ThreadPoolExecutor(3) as ex: res = list(ex.map(copier_final, neuves))
    for r, g in zip(neuves, res):
        if not g: KO.append((r['vf'], 'copie final/ ratée : reste dans la file de revue (qc/), relancer'))
    ok = [r for r, g in zip(neuves, res) if g]
    if not ok: return
    vl = ','.join("'%s'" % r['vf'] for r in ok)
    q("begin;update factory_fp_frames set video_url=replace(video_url,'/qc/','/final/') where video_url in (select video_url from factory_qc where template in (%s) and strpos(video_url,'/qc/')>0);"
      "update factory_fp set video_url=replace(video_url,'/qc/','/final/') where video_url in (select video_url from factory_qc where template in (%s) and strpos(video_url,'/qc/')>0);"
      "update factory_qc set status='approved', video_url=replace(video_url,'/qc/','/final/'), poster_url=replace(poster_url,'/qc/','/final/') "
      "where template in (%s) and strpos(video_url,'/qc/')>0;commit;" % (vl, vl, vl), js=False)
    rows = q("select template vf, video_url u, brick_combo c from factory_qc where template in (%s) and status='approved' and strpos(video_url,'/final/')>0 order by template;" % vl)
    for v in sorted({r['vf'] for r in ok} - {r['vf'] for r in rows}): KO.append((v, 'fiche non basculée vers final/ : reste dans la file de revue, relancer'))
    if not rows: return
    # 2) programmation
    CUT = (dt.datetime.now(PAR) + dt.timedelta(days=7)).date().isoformat()
    last = {a: (q("select max(scheduled_at)::text t from factory_posts where status='todo' and platform='instagram' and account='%s' and scheduled_at<'2090-01-01';" % a)[0]['t'] or '') for a in HRS}
    accs = sorted(HRS, key=lambda a: last[a]); per = {a: [] for a in HRS}
    for i, r in enumerate(rows): per[accs[i % len(accs)]].append(r)
    out = []
    for a, new in per.items():
        if not new: continue
        # 16/10 (revue) : les posts posés par etaler.py (note « étalé … », ex. le lot gagnant @leoadsia à 1 par jour) ne
        # bougent jamais → on n'intercale qu'APRÈS le dernier d'entre eux sur ce compte
        fx = q("select max(scheduled_at)::text t from factory_posts where status='todo' and platform='instagram' and account='%s' "
               "and note like 'étalé%%' and scheduled_at<'2090-01-01';" % a)[0]['t']
        borne = ("p.scheduled_at>'%s'" % fx) if fx and fx[:10] >= CUT else ("p.scheduled_at>='%s'" % CUT)
        E = q("select p.id::text, p.scheduled_at::text t, coalesce(p.combo->>'photo',p.combo->>'reaction') pr, p.combo->>'format' f from factory_posts p where p.status='todo' and p.platform='instagram' "
              "and p.account='%s' and %s and p.scheduled_at<'2090-01-01' order by p.scheduled_at;" % (a, borne))
        slots = [dt.datetime.fromisoformat(x['t'].replace(' ', 'T')).astimezone(UTC) for x in E]
        seq = [('E', {'pr': x['pr'], 'k': 'm' if x['f'] == 'F05' else 'o', **x}) for x in E]
        for r in new:
            pr, k = unit(r), kind(r['c']); pos = None
            def nb(i): return None if i < 0 or i >= len(seq) else (seq[i][1]['pr'], seq[i][1]['k'])
            for strict in (True, False):   # d'abord photo différente ET type alterné, sinon photo différente seulement
                for i in range(len(seq), -1, -1):
                    pv, nx = nb(i - 1), nb(i)
                    if (pv and pv[0] == pr) or (nx and nx[0] == pr): continue
                    if strict and ((pv and pv[1] == k) or (nx and nx[1] == k)): continue
                    pos = i; break
                if pos is not None: break
            if pos is None: pos = len(seq)
            seq.insert(pos, ('N', {'pr': pr, 'k': k, **r}))
        # pas de post après J+7 : on part du dernier créneau du compte (ou de J+7)
        t = slots[-1] if slots else (dt.datetime.fromisoformat(last[a].replace(' ', 'T')).astimezone(UTC) if last[a] else dt.datetime.combine(dt.date.fromisoformat(CUT), dt.time(0), PAR).astimezone(UTC))
        while len(slots) < len(seq):
            while True:
                t += dt.timedelta(hours=1)
                if t.astimezone(PAR).hour in HRS[a] and t.astimezone(PAR).date().isoformat() >= CUT: break
            slots.append(t)
        sql = ''; moved = [(x, s_) for (kd, x), s_ in zip(seq, slots) if kd == 'E' and dt.datetime.fromisoformat(x['t'].replace(' ', 'T')).astimezone(UTC) != s_]
        for n_, (x, s_) in enumerate(moved): sql += "update factory_posts set scheduled_at='2099-01-01'::timestamptz + interval '%d minutes' where id='%s';" % (n_, x['id'])
        for x, s_ in moved: sql += "update factory_posts set scheduled_at='%s' where id='%s';" % (s_.strftime('%Y-%m-%d %H:%M:%S+00'), x['id']); out.append((a, s_, '(décalé) ' + (x['pr'] or '')))
        for (kd, x), s_ in zip(seq, slots):
            if kd != 'N': continue
            sql += ("insert into factory_posts (scheduled_at, platform, account, video_url, caption, combo, status) select '%s'::timestamptz,'instagram','%s',q.video_url,'%s',"
                    "q.brick_combo||jsonb_build_object('vf',q.template),'todo' from factory_qc q where q.template='%s';"
                    % (s_.strftime('%Y-%m-%d %H:%M:%S+00'), a, legende_kit(os.path.basename(x['u']), x['c']).replace("'", "''"), x['vf']))
            out.append((a, s_, x['vf']))
        q('begin;' + sql + 'commit;', js=False)
    # 3) qc/ libérée (seulement les vidéos dont la copie final/ est relue ET la fiche basculée)
    rm = []
    for r in rows:
        b = os.path.basename(r['u'])[:-4]; rm += ['ss:///factory-media/qc/' + b + '.mp4', 'ss:///factory-media/qc/' + b + '-poster.jpg']
    storage_rm(rm)
    for a, s_, x in sorted(out): print(a, s_.astimezone(PAR).strftime('%d/%m %Hh%M'), x)
    # 4) Axel 14/10 : « mixer un max, jamais un seul format » → rééquilibrage du kit à partir de J+4 (mêmes créneaux)
    r = sh_borne(['python3', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'equilibrer.py')], 600)
    print(r.stdout.strip().splitlines()[0] if r.stdout.strip() else r.stderr[-300:])

if not NOUVEAU:
    print('stock commun pas encore en place côté AvatarAds (kit_recharge_now() absente) : validé = kit direct, ANCIEN chemin '
          '(final/ + kit) ; stock.py --migrer les passera au stock commun à l\'étape 5')
    for r in rows:
        if r['vf'] in {v for v, _ in KO}: continue
        if '/stock/' in (r['u'] or ''): KO.append((r['vf'], 'déjà validée dans stock/ : python3 usine/lots/stock.py --pousser %s une fois le stock commun en place' % r['vf']))
        elif '/qc/' not in (r['u'] or ''): KO.append((r['vf'], 'déjà validée' if r['s'] == 'approved' else 'fichier hors qc/ : rien à valider'))
    ancien_kit([r for r in rows if '/qc/' in (r['u'] or '')])
    for v, e in KO: print('✗', v, e)
    sys.exit(1 if KO else 0)

for r in rows:
    if r['s'] == 'approved' and '/final/' in (r['u'] or ''): KO.append((r['vf'], 'déjà validée dans l\'ancien kit (final/) → python3 usine/lots/stock.py --pousser ' + r['vf']))
    elif '/qc/' not in (r['u'] or '') and '/stock/' not in (r['u'] or ''): KO.append((r['vf'], 'fichier hors qc/ : rien à valider'))
# 1) qc/ → stock/ : vidéo (copie relue) + poster tiré de son IMAGE 0 (relu) ; la vidéo reste dans la file de revue si ça rate
def copier(r):
    try: e = vers_stock(r['u'], r['u'].split('/qc/')[1][:-4])
    except Exception as x: e = str(x)[-160:]
    if e: log('✗', r['vf'], e)
    return not e
neuves = [r for r in rows if '/qc/' in (r['u'] or '')]
with cf.ThreadPoolExecutor(3) as ex: res = list(ex.map(copier, neuves))
ok = [r for r, g in zip(neuves, res) if g]
for r, g in zip(neuves, res):
    if not g: KO.append((r['vf'], 'copie stock/ ratée : reste dans la file de revue (qc/), relancer'))
if ok:
    vl = ','.join("'%s'" % r['vf'] for r in ok)
    q("begin;update factory_fp_frames set video_url=replace(video_url,'/qc/','/stock/') where video_url in (select video_url from factory_qc where template in (%s) and strpos(video_url,'/qc/')>0);"
      "update factory_fp set video_url=replace(video_url,'/qc/','/stock/') where video_url in (select video_url from factory_qc where template in (%s) and strpos(video_url,'/qc/')>0);"
      "update factory_qc set status='approved', video_url=replace(video_url,'/qc/','/stock/'), poster_url=replace(left(video_url,-4),'/qc/','/stock/')||'-poster.jpg' "
      "where template in (%s) and strpos(video_url,'/qc/')>0;commit;" % (vl, vl, vl), js=False)
rows = q(SELQ)
st = [r for r in rows if r['s'] == 'approved' and '/stock/' in (r['u'] or '')]
# 2) stock commun : une mission ouverte par vidéo (déjà présente → inchangée : bx_push_missions ne double jamais)
ms = {}; bx = bx_pret()
if st and not (bx.get('missions') and bx.get('push')):
    KO.append((' '.join(r['vf'] for r in st), 'validées dans stock/ mais stock commun BloxAI pas encore en place%s → python3 usine/lots/stock.py --pousser %s'
               % (' (' + bx['erreur'][-120:] + ')' if bx.get('erreur') else '', ' '.join(r['vf'] for r in st))))
elif st:
    try:
        ms = bx_pousser([{'vf': r['vf'], 'video_url': r['u'], 'poster_url': r['u'][:-4] + '-poster.jpg', 'caption': LEGENDE_BX, 'combo': r['c'],
                          'duration_s': round(float(r['d']), 2) if r['d'] not in (None, '') else None, 'source_post_id': None} for r in st])
    except RuntimeError as e: KO.append((' '.join(r['vf'] for r in st), 'BloxAI a refusé les missions (%s) → python3 usine/lots/stock.py --pousser …' % str(e)[-160:]))
    for r in st:
        if r['vf'] in ms: print(r['vf'], '→ stock commun', '(mission ouverte)' if ms[r['vf']] == 'open' else '(déjà : %s)' % ms[r['vf']])
        elif ms: KO.append((r['vf'], 'mission absente dans BloxAI → python3 usine/lots/stock.py --pousser ' + r['vf']))
# 3) qc/ libérée (seulement les vidéos dont la copie stock/ ET le poster sont relus ET la fiche basculée)
fait = {r['vf'] for r in st}; rm = []
for r in ok:
    if r['vf'] not in fait: continue
    b = r['u'].split('/qc/')[1][:-4]; rm += ['ss:///factory-media/qc/' + b + '.mp4', 'ss:///factory-media/qc/' + b + '-poster.jpg']
if rm: storage_rm(rm)
# 4) 19/10 (Axel : « ceux qu'on fait récemment ne doivent pas se retrouver tout derrière ») : le kit est RÉPARTI de nouveau
#    (repartir.py : les nouvelles vidéos passent devant, démos tournées, 20 vidéos laissées aux diffuseurs BloxAI)
if any(s == 'open' for s in ms.values()):
    r = sh_borne(['python3', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'repartir.py'), '--go'], 900)
    print((r.stdout or '') + (r.stderr or '')[-400:])
for v, e in KO: print('✗', v, e)
sys.exit(1 if KO else 0)
