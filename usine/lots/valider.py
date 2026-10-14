#!/usr/bin/env python3
# Creative Factory — VALIDER des vidéos (« validé » = dans le kit, sans redemander). usage :
#   python3 usine/lots/valider.py VF-0439 VF-0440 …        (ou un état de lot : python3 usine/lots/valider.py --lot lot-1410b)
# qc/ → final/ (copie vérifiée), factory_qc 'approved', puis programmation Instagram :
#   · comptes : avataradss + leoadsia à 12-14-16-18-20 h, ialebd.axel à 11-13-15-17-19 h (heure de Paris), 5 par jour ;
#   · les vidéos sont réparties sur les comptes et INTERCALÉES dans la fin du kit (jamais avant J+7 : Axel programme à
#     l'avance), jamais deux fois la même photo / réaction de suite, et de préférence en alternant parlé / sans voix ;
#   · les posts existants décalés le sont dans UNE transaction (avant : une coupure laissait des posts en 2099) ;
#   · légende = le CTA de la vidéo (café, CLAUDE, SITE), sans hashtag ni nom de fournisseur.
import json, os, sys, datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import *
PAR, UTC = ZoneInfo('Europe/Paris'), dt.timezone.utc
HRS = {'avataradss': [12, 14, 16, 18, 20], 'leoadsia': [12, 14, 16, 18, 20], 'ialebd.axel': [11, 13, 15, 17, 19]}
if sys.argv[1:2] == ['--lot']: vfs = [x['vf'] for x in json.load(open(os.path.join(WORK, sys.argv[2] + '.json')))['ok']]
else: vfs = [a for a in sys.argv[1:] if a.startswith('VF-')]
if not vfs: raise SystemExit('rien à valider')
rows = q("select template vf, video_url u, poster_url p, status s, brick_combo c from factory_qc where template in (%s);" % ','.join("'%s'" % v for v in vfs))
rows = [r for r in rows if r['s'] != 'approved' or '/qc/' in r['u']]
if not rows: raise SystemExit('déjà validées')
def unit(r):   # « photo » au sens du kit : la photo d'avatar (parlée) ou la réaction (sans voix)
    c = r['c'] or {}; return c.get('reaction') if c.get('format') == 'F05' else c.get('photo')
def kind(c): return 'm' if (c or {}).get('format') == 'F05' else 'o'
def cap(name, c):
    if '_CTA-cafe_' in name: return "Tu peux toi aussi faire la même chose pour seulement un café par jour. Commente « SITE » et je t'envoie le lien en privé."
    if (c or {}).get('format') == 'F05' and ('_C-MCPM-' in name or '_C-MCM-' in name or any('_C-OMNIM-%02d_' % k in name for k in (5, 6, 7))):
        return "Commente « CLAUDE » et je t'envoie le lien en privé."
    if '_CTA-CLAUDE_' in name: return "Commente « CLAUDE » et je t'envoie le lien en privé pour faire la même chose."
    return "Écris « SITE » en commentaire et je t'envoie le tutoriel complet gratuitement pour faire la même chose."
# 1) qc/ → final/
for r in rows:
    if '/qc/' not in r['u']: continue
    for u in (r['u'], r['p']):
        if not u or '/qc/' not in u: continue
        base = u.split('/qc/')[1]; tmp = os.path.join(CACHE, '_val_' + base)
        get(u, '_val_' + base)
        if not storage_cp(tmp, 'final/' + base, 'video/mp4' if base.endswith('.mp4') else 'image/jpeg'): raise SystemExit('copie final/ ' + base)
        os.remove(tmp)
vl = ','.join("'%s'" % r['vf'] for r in rows)
q("begin;update factory_fp_frames set video_url=replace(video_url,'/qc/','/final/') where video_url in (select video_url from factory_qc where template in (%s));"
  "update factory_fp set video_url=replace(video_url,'/qc/','/final/') where video_url in (select video_url from factory_qc where template in (%s));"
  "update factory_qc set status='approved', video_url=replace(video_url,'/qc/','/final/'), poster_url=replace(poster_url,'/qc/','/final/') where template in (%s);commit;" % (vl, vl, vl), js=False)
rows = q("select template vf, video_url u, brick_combo c from factory_qc where template in (%s) order by template;" % vl)
# 2) programmation
CUT = (dt.datetime.now(PAR) + dt.timedelta(days=7)).date().isoformat()
last = {a: (q("select max(scheduled_at)::text t from factory_posts where status='todo' and platform='instagram' and account='%s' and scheduled_at<'2090-01-01';" % a)[0]['t'] or '') for a in HRS}
accs = sorted(HRS, key=lambda a: last[a]); per = {a: [] for a in HRS}
for i, r in enumerate(rows): per[accs[i % len(accs)]].append(r)
out = []
for a, new in per.items():
    if not new: continue
    E = q("select p.id::text, p.scheduled_at::text t, coalesce(p.combo->>'photo',p.combo->>'reaction') pr, p.combo->>'format' f from factory_posts p where p.status='todo' and p.platform='instagram' "
          "and p.account='%s' and p.scheduled_at>='%s' and p.scheduled_at<'2090-01-01' order by p.scheduled_at;" % (a, CUT))
    slots = [dt.datetime.fromisoformat(x['t'].replace(' ', 'T')).astimezone(UTC) for x in E]
    if not slots:   # pas de post après J+7 : on part du dernier créneau du compte (ou de J+7)
        t0 = dt.datetime.fromisoformat(last[a].replace(' ', 'T')).astimezone(UTC) if last[a] else dt.datetime.combine(dt.date.fromisoformat(CUT), dt.time(0), PAR).astimezone(UTC)
        slots = []; t = t0
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
        name = os.path.basename(x['u'])
        sql += ("insert into factory_posts (scheduled_at, platform, account, video_url, caption, combo, status) select '%s'::timestamptz,'instagram','%s',q.video_url,'%s',"
                "q.brick_combo||jsonb_build_object('vf',q.template),'todo' from factory_qc q where q.template='%s';" % (s_.strftime('%Y-%m-%d %H:%M:%S+00'), a, cap(name, x['c']).replace("'", "''"), x['vf']))
        out.append((a, s_, x['vf']))
    q('begin;' + sql + 'commit;', js=False)
# 3) qc/ libérée
rm = []
for r in rows:
    b = os.path.basename(r['u'])[:-4]; rm += ['ss:///factory-media/qc/' + b + '.mp4', 'ss:///factory-media/qc/' + b + '-poster.jpg']
sh(['supabase', 'storage', 'rm', *rm, '--experimental', '--linked', '--yes'])
for a, s_, x in sorted(out): print(a, s_.astimezone(PAR).strftime('%d/%m %Hh%M'), x)
