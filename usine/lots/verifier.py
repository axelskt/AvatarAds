#!/usr/bin/env python3
# Creative Factory — CONTRÔLE du kit : chaque post programmé a-t-il une vidéo accessible, une adresse bien formée, un créneau
# réel (pas un post « parqué » en 2099 par une programmation interrompue) ? usage : python3 usine/lots/verifier.py
import json, os, sys, urllib.request, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import q
R = q("select combo->>'vf' vf, account, platform, scheduled_at::text t, video_url u from factory_posts where status='todo';")
def head(r):
    if not (r['u'] or '').startswith('https://'): return r, 'adresse invalide'
    for _ in range(3):
        try: return r, urllib.request.urlopen(urllib.request.Request(r['u'], method='HEAD'), timeout=30).status
        except Exception as e: c = getattr(e, 'code', str(e)[:40])
    return r, c
with cf.ThreadPoolExecutor(8) as ex: res = list(ex.map(head, R))
bad = [(r['vf'], r['account'], r['t'][:16], c) for r, c in res if c != 200]
park = [(r['vf'], r['account'], r['t'][:16]) for r in R if r['t'] >= '2090']
print('posts programmés : %d · vidéo absente / adresse invalide : %d · posts parqués en 2099 : %d' % (len(R), len(bad), len(park)))
for b in bad + park: print('  ', b)
sys.exit(1 if bad or park else 0)
