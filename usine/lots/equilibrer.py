#!/usr/bin/env python3
# Creative Factory — ÉQUILIBRER le kit Instagram (Axel 14/10 : « faut mixer un max, ne pas avoir qu'un seul format »).
# À partir d'une date (par défaut J+4 : Axel programme ~3 jours à l'avance), les posts « à programmer » sont réattribués aux
# MÊMES créneaux (heures et comptes inchangés) pour que chaque compte alterne vidéos parlées / sans voix chaque jour, dans la
# proportion globale, sans jamais deux fois la même photo (parlées) ou réaction (sans voix) de suite sur un compte.
# Une seule transaction. usage : python3 usine/lots/equilibrer.py [AAAA-MM-JJ] [--dry]
import json, os, sys, datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import q
PAR = ZoneInfo('Europe/Paris')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DEB = args[0] if args else (dt.datetime.now(PAR) + dt.timedelta(days=4)).date().isoformat()
P = q("select id::text, account, scheduled_at::text t, (scheduled_at at time zone 'Europe/Paris')::date::text d, combo from factory_posts "
      "where status='todo' and platform='instagram' and (scheduled_at at time zone 'Europe/Paris')::date >= '%s' and scheduled_at < '2090-01-01' order by scheduled_at, account;" % DEB)
if not P: raise SystemExit('rien à équilibrer après le ' + DEB)
kind = lambda c: 'm' if (c or {}).get('format') == 'F05' else 'o'
unit = lambda c: (c or {}).get('reaction') if kind(c) == 'm' else (c or {}).get('photo')
slots = [(x['t'], x['account'], x['d']) for x in P]                 # créneaux gardés tels quels
Q = {'o': [x for x in P if kind(x['combo']) == 'o'], 'm': [x for x in P if kind(x['combo']) == 'm']}
ratio = len(Q['o']) / len(P)
last, day, out, cnt = {}, {}, [], {}
for t, a, d in slots:                                               # créneaux dans l'ordre du temps, tous comptes
    k_prev = last.get(a, (None, None))[0]
    st = day.setdefault((a, d), {'o': 0, 'm': 0})
    n = st['o'] + st['m'] + 1
    # type voulu : alterner avec le post précédent du compte, en suivant la proportion globale sur la journée
    rest = len(Q['o']) / max(1, len(Q['o']) + len(Q['m']))       # proportion de ce qui RESTE : aucun format épuisé avant la fin
    ca = cnt.setdefault(a, {'o': 0, 'm': 0}); na = ca['o'] + ca['m'] + 1
    def score(k):   # écart à la proportion (compte et journée) + pénalité si même type que le post d'avant
        o = ca['o'] + (k == 'o'); od = st['o'] + (k == 'o')
        return abs(o / na - rest) + 0.5 * abs(od / n - rest) + (0.05 if k == k_prev else 0) + (9 if not Q[k] else 0)
    want = min(('o', 'm'), key=score)
    order = [want, 'm' if want == 'o' else 'o']
    pick = None
    for k in order:
        for i, x in enumerate(Q[k][:40]):                           # garde l'ordre d'origine (au plus près de son créneau)
            if unit(x['combo']) != last.get(a, (None, None))[1]: pick = Q[k].pop(i); break
        if pick: break
    if not pick:
        k = order[0] if Q[order[0]] else order[1]; pick = Q[k].pop(0)
    st[kind(pick['combo'])] += 1; cnt[a][kind(pick['combo'])] += 1; last[a] = (kind(pick['combo']), unit(pick['combo'])); out.append((pick, t, a))
# résumé
res = {}
for p, t, a in out:
    d = dt.datetime.fromisoformat(t.replace(' ', 'T')).astimezone(PAR).date().isoformat(); r = res.setdefault((a, d), [0, 0]); r[0 if kind(p['combo']) == 'o' else 1] += 1
bad = [(a, d, v) for (a, d), v in res.items() if v[0] + v[1] >= 4 and (v[0] == 0 or v[1] == 0)]
print('posts réattribués : %d (du %s) · parlées %.0f %% · journées à un seul format : %d' % (len(out), DEB, ratio * 100, len(bad)))
moved = [(p, t, a) for p, t, a in out if p['t'] != t or p['account'] != a]
for b_ in bad: print('   un seul format :', b_)
seqs = {}
for p_, t_, a_ in sorted(out, key=lambda x: (x[2], x[1])): seqs.setdefault(a_, []).append(p_)
for a_, L in seqs.items():
    run = best = 1; same = 0
    for i in range(1, len(L)):
        run = run + 1 if kind(L[i]['combo']) == kind(L[i-1]['combo']) else 1; best = max(best, run)
        same += unit(L[i]['combo']) == unit(L[i-1]['combo'])
    print('   @%s : plus longue suite d\'un même format = %d · même photo/réaction de suite = %d' % (a_, best, same))
if '--dry' in sys.argv:
    for (a, d), v in sorted(res.items())[:6]: print('  ', a, d, '%d parlées / %d sans voix' % tuple(v))
    raise SystemExit
sql = 'begin;'
for i, (p, t, a) in enumerate(moved): sql += "update factory_posts set scheduled_at='2099-01-01'::timestamptz + interval '%d minutes' where id='%s';" % (i, p['id'])
for p, t, a in moved: sql += "update factory_posts set scheduled_at='%s', account='%s' where id='%s';" % (t, a, p['id'])
q(sql + 'commit;', js=False)
print('déplacés : %d' % len(moved))
