#!/usr/bin/env python3
# Creative Factory — ÉTALER des vidéos validées sur UN compte du kit, N par jour (Axel 16/10 : lot gagnant @leoadsia,
# « étale-les » = une par jour, jamais deux fois la même photo / le même hook de suite, mêlées aux autres posts).
#   python3 usine/lots/etaler.py --compte leoadsia [--par-jour 1] [--depuis 2026-10-18] [--dry] VF-0531 VF-0532 …
# Ce que ça fait (ancien « validé = kit direct » du 14/10, mais ciblé sur un compte et étalé) :
#   1) qc/ → final/ (copie relue : même taille) + poster, fiche factory_qc 'approved' (+ empreintes) ;
#   2) à partir de --depuis (défaut : le lendemain du dernier post déjà programmé du compte), chaque jour reçoit --par-jour
#      vidéo(s) neuve(s) ; les posts « à programmer » du compte gardent leur ORDRE et glissent d'autant sur la grille du
#      compte (HRS) — aucune vidéo n'est retirée du kit. Dans la journée, la place de la neuve est choisie pour ne JAMAIS
#      coller deux posts de même photo / réaction ou de même hook, puis pour alterner parlé / sans voix ;
#   3) qc/ libérée (seulement les vidéos copiées ET basculées).
# Ne marche qu'AVANT le stock commun (kit_recharge_now() absente) : après, c'est kit-recharge qui pose les posts du kit.
# Pas d'equilibrer.py ensuite : il réattribuerait les créneaux à partir de J+4 et regrouperait les neuves.
import argparse, datetime as dt, os, sys, concurrent.futures as cf
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import *

PAR, UTC = ZoneInfo('Europe/Paris'), dt.timezone.utc
HRS = {'avataradss': [12, 14, 16, 18, 20], 'leoadsia': [12, 16, 20], 'ialebd.axel': [11, 13, 15, 17, 19]}   # = valider.py / kit-recharge
ap = argparse.ArgumentParser()
ap.add_argument('--compte', required=True, choices=sorted(HRS)); ap.add_argument('--par-jour', type=int, default=1)
ap.add_argument('--depuis'); ap.add_argument('--dry', action='store_true'); ap.add_argument('vfs', nargs='+')
A = ap.parse_args()
acc, H = A.compte, HRS[A.compte]
if not 1 <= A.par_jour < len(H): raise SystemExit('--par-jour : entre 1 et %d pour %s' % (len(H) - 1, acc))
vfs = [v for v in dict.fromkeys(A.vfs) if vf_ok(v)]
if not vfs: raise SystemExit('aucune VF valide')
if q1("select to_regprocedure('public.kit_recharge_now()') is not null ok;")[0]['ok']:
    raise SystemExit('stock commun en place : le kit est posé par kit-recharge → python3 usine/lots/valider.py ' + ' '.join(vfs))

def unit(c): return (c or {}).get('reaction') if (c or {}).get('format') == 'F05' else (c or {}).get('photo')
def kind(c): return 'm' if (c or {}).get('format') == 'F05' else 'o'
def ts(s): return dt.datetime.fromisoformat(str(s).replace(' ', 'T')).astimezone(UTC)
def paris(t): return t.astimezone(PAR).strftime('%d/%m %Hh')

# ── 0) les vidéos : en revue (qc/) ou déjà validées (final/) mais jamais programmées ──
rows = q("select q.template vf, q.video_url u, q.poster_url p, q.status s, coalesce(q.brick_combo,'{}'::jsonb) c from factory_qc q "
         "where q.template = any(%s) order by q.template;" % sql_arr(vfs))
KO = [(v, 'inconnue') for v in sorted(set(vfs) - {r['vf'] for r in rows})]
deja = {r['vf'] for r in q("select combo->>'vf' vf from factory_posts where combo->>'vf' = any(%s) and status <> 'skipped';" % sql_arr(vfs))}
neuves = []
for r in rows:
    if r['vf'] in deja: KO.append((r['vf'], 'déjà dans le kit'))
    elif '/qc/' in (r['u'] or '') or (r['s'] == 'approved' and '/final/' in (r['u'] or '')): neuves.append(r)
    else: KO.append((r['vf'], 'ni en revue (qc/) ni validée dans final/ : %s' % (r['u'] or '')[-60:]))
if not neuves:
    for v, e in KO: print('✗', v, e)
    raise SystemExit('rien à étaler')

# ── 1) ordre des neuves : jamais deux fois de suite la même photo, le même hook ni la même démo (glouton, groupe le plus
#    fourni d'abord ; démo comparée aux DEUX dernières) ──
pool, ordre = list(neuves), []
while pool:
    prev = ordre[-1]['c'] if ordre else {}
    demos = [x['c'].get('contenu') for x in ordre[-2:]]
    snap = list(pool)   # pendant list.sort, CPython vide la liste : les comptes se font sur une copie
    def cle(r):
        c = r['c']; same = sum(1 for x in snap if unit(x['c']) == unit(c)); dup = sum(1 for x in snap if x['c'].get('contenu') == c.get('contenu'))
        return (unit(c) == unit(prev), c.get('hook') == prev.get('hook'), c.get('contenu') in demos, -same, -dup, r['vf'])   # démo en double : tôt, pour l'écarter de sa jumelle
    pool.sort(key=cle); ordre.append(pool.pop(0))

# ── 2) les posts « à programmer » du compte à partir de --depuis ──
last = q("select max(scheduled_at)::text t from factory_posts where account='%s' and platform='instagram' and status in ('scheduled','published') "
         "and scheduled_at<'2090-01-01';" % acc)[0]['t']
d0 = dt.date.fromisoformat(A.depuis) if A.depuis else ((ts(last).astimezone(PAR).date() + dt.timedelta(days=1)) if last else dt.datetime.now(PAR).date() + dt.timedelta(days=1))
debut = dt.datetime.combine(d0, dt.time(0), PAR).astimezone(UTC)
if last and ts(last) >= debut: raise SystemExit('✗ --depuis %s : le compte a déjà un post programmé le %s (Axel l\'a mis dans Instagram)' % (d0, paris(ts(last))))
E = q("select p.id::text, p.scheduled_at::text t, p.combo c, p.combo->>'vf' vf from factory_posts p where p.status='todo' and p.platform='instagram' "
      "and p.account='%s' and p.scheduled_at>='%s' and p.scheduled_at<'2090-01-01' order by p.scheduled_at, p.created_at;" % (acc, debut.strftime('%Y-%m-%d %H:%M:%S+00')))
avant = q("select count(*) n from factory_posts where status='todo' and platform='instagram' and account='%s' and scheduled_at<'%s';" % (acc, debut.strftime('%Y-%m-%d %H:%M:%S+00')))[0]['n']
if int(avant): raise SystemExit('✗ %s post(s) « à programmer » de %s AVANT le %s : rien n\'est fait (les ranger d\'abord)' % (avant, acc, d0))

def grille(t0, n):
    """n créneaux de la grille du compte à partir de t0 (inclus)."""
    out, t = [], t0.astimezone(PAR).replace(minute=0, second=0, microsecond=0)
    if t.astimezone(UTC) < t0: t += dt.timedelta(hours=1)
    while len(out) < n:
        if t.hour in H and t.astimezone(UTC) >= t0: out.append(t.astimezone(UTC))
        t = (t + dt.timedelta(hours=1)).astimezone(PAR)
    return out
slots = grille(debut, len(E) + len(ordre))
if E and [ts(x['t']) for x in E] != slots[:len(E)]:
    print('⚠ les posts de %s ne suivaient pas exactement la grille %s : ils y sont remis dans le même ordre' % (acc, H))

# ── 3) placement jour par jour : k créneaux par jour = par_jour neuves + (k - par_jour) posts existants ──
k, m = len(H), A.par_jour
item = lambda c, vf, neuf: {'c': c or {}, 'u': unit(c), 'h': (c or {}).get('hook'), 'd': (c or {}).get('contenu'), 'k': kind(c), 'vf': vf, 'neuf': neuf}
# les 3 derniers posts déjà programmés dans Instagram (avant --depuis) : voisins du premier jour, jamais déplacés
hist = [item(x['c'], x['vf'], False) for x in reversed(q(
    "select p.combo c, p.combo->>'vf' vf from factory_posts p where p.account='%s' and p.platform='instagram' and p.status in ('scheduled','published') "
    "and p.scheduled_at<'%s' order by p.scheduled_at desc limit 3;" % (acc, debut.strftime('%Y-%m-%d %H:%M:%S+00'))))]
seq, ie, nv, alertes = [], 0, list(ordre), []
FEN = 3   # fenêtre de voisinage (posts de chaque côté)
def score(avant_, apres_, it):
    """(dur, mou) pour `it` posé entre avant_ (du plus proche au plus loin) et apres_ (idem).
    dur : voisin IMMÉDIAT de même photo / réaction ou de même hook. mou : deux neuves collées (même lot = même famille
    d'intro), même hook / photo / démo à moins de FEN posts (plus c'est près, plus ça coûte), deux parlés collés."""
    dur = mou = 0
    for cote in (avant_, apres_):
        for dist, x in enumerate(cote[:FEN], 1):
            w = FEN + 1 - dist
            if dist == 1:
                dur += (x['u'] == it['u']) + bool(x['h'] and x['h'] == it['h'])
                mou += 8 * x['neuf'] + 2 * (x['k'] == it['k'])
            mou += w * (3 * bool(x['h'] and x['h'] == it['h']) + 2 * (x['u'] == it['u']) + 3 * bool(x['d'] and x['d'] == it['d']) + 2 * x['neuf'])
    # revue 16/10 : la neuve ne doit pas allonger une SUITE de même format (parlé / sans voix) au-delà de 3 — avant, seul
    # le voisin immédiat comptait et des suites de 4-5 parlées apparaissaient alors qu'un placement à 3 existait
    run = 1
    for cote in (avant_, apres_):
        for x in cote:
            if x['k'] != it['k']: break
            run += 1
    mou += 10 * max(0, run - 3) + (1 if run == 3 else 0)
    return dur, mou
heure_prec = None
while nv:
    jour = [item(x['c'], x['vf'], False) | {'id': x['id']} for x in E[ie:ie + (k - m)]]; ie += len(jour)
    a_venir = [item(x['c'], x['vf'], False) for x in E[ie:ie + FEN]]
    for _ in range(m):
        if not nv: break
        r = nv.pop(0); it = item(r['c'], r['vf'], True) | {'row': r}; best = None
        for s in range(len(jour) + 1):
            avant_ = (hist + seq + jour[:s])[::-1]; apres_ = jour[s:] + a_venir
            d_, m_ = score(avant_, apres_, it)
            m_ += 1 if s == heure_prec else 0   # varier l'heure d'un jour à l'autre
            if best is None or (d_, m_) < best[0]: best = ((d_, m_), s)
        if best[0][0]: alertes.append('%s : voisin de même photo / hook inévitable' % r['vf'])
        jour.insert(best[1], it); heure_prec = best[1]
    seq += jour
seq += [item(x['c'], x['vf'], False) | {'id': x['id']} for x in E[ie:]]
# revue 16/10 : le choix jour par jour ne voit pas le lendemain (suite de 4 parlés forcée le jour d'après). Avec une neuve
# par jour et peu de jours, on essaie TOUTES les places (k^n, ex. 3^11 = 177 147) et on garde le meilleur coût global :
# règles dures d'abord (voisin même photo / hook), puis le reste du score, puis l'heure qui varie d'un jour à l'autre.
if m == 1 and len(ordre) and k ** len(ordre) <= 400000:
    import itertools
    nn = len(ordre); E_it = [item(x['c'], x['vf'], False) | {'id': x['id']} for x in E]
    neufs = [x for x in seq if x['neuf']]          # même ordre des neuves que le glouton
    queue = E_it[nn * (k - 1): nn * (k - 1) + FEN]
    def construit(pos):
        out = []
        for d_, s in enumerate(pos):
            j = E_it[d_ * (k - 1):(d_ + 1) * (k - 1)]; out += j[:s] + [neufs[d_]] + j[s:]
        return out
    def cout(pos):
        sq = hist + construit(pos) + queue; dur = mou = 0
        for i_, x in enumerate(sq):
            if not x['neuf']: continue
            d_, m_ = score(sq[:i_][::-1], sq[i_ + 1:], x); dur += d_; mou += m_
        mou += sum(1 for a_, b_ in zip(pos, pos[1:]) if a_ == b_)
        return (dur, mou)
    best = min(itertools.product(range(k), repeat=nn), key=cout)   # optimum exact : jamais pire que le glouton
    seq = construit(best) + E_it[nn * (k - 1):]
assert len(seq) == len(E) + len(ordre) and sum(1 for x in seq if x['neuf']) == len(ordre)
assert [x['id'] for x in seq if not x['neuf']] == [x['id'] for x in E]   # ordre des posts existants inchangé, aucun perdu
for x, s_ in zip(seq, slots): x['slot'] = s_

# contrôle de la suite complète (posts déjà dans Instagram compris) : voisins identiques (photo / hook) ou deux neuves collées,
# suites de plus de 3 posts du même format qui touchent une neuve ; les paires déjà dans la file sont signalées à part
tout = hist + seq
for i, x in enumerate(tout):
    y = tout[i + 1] if i + 1 < len(tout) else None
    if not y: continue
    if x['neuf'] or y['neuf']:
        if y['u'] == x['u'] or (y['h'] and y['h'] == x['h']): alertes.append('%s colle %s (%s / %s)' % (x['vf'], y['vf'], y['u'], y['h']))
        if x['neuf'] and y['neuf']: alertes.append('%s colle %s (deux du même lot)' % (x['vf'], y['vf']))
    elif y['u'] == x['u']: alertes.append('déjà dans la file (pas causé par l\'étalement) : %s puis %s, même photo / réaction %s' % (x['vf'], y['vf'], x['u']))
i = 0
while i < len(tout):
    j = i
    while j + 1 < len(tout) and tout[j + 1]['k'] == tout[i]['k']: j += 1
    if j - i + 1 > 3 and any(x['neuf'] for x in tout[i:j + 1]):
        alertes.append('suite de %d posts %s de suite autour de %s' % (j - i + 1, 'parlés' if tout[i]['k'] == 'o' else 'sans voix', ' '.join(x['vf'] for x in tout[i:j + 1] if x['neuf'])))
    i = j + 1
print('%s : %d posts à programmer à partir du %s, %d neuves (%d par jour) → fin du kit %s' % (acc, len(E), d0.strftime('%d/%m'), len(ordre), m, paris(seq[-1]['slot'])))
for i, x in enumerate(tout):
    if x['neuf']:
        p, n_ = (tout[i - 1] if i else None), (tout[i + 1] if i + 1 < len(tout) else None)
        print('  %s  %s  %s %s %s   | avant : %s %s %s · après : %s %s %s' % (paris(x['slot']), x['vf'], x['u'], x['h'], x['d'],
              p and p['u'], p and p['h'], p and p['d'], n_ and n_['u'], n_ and n_['h'], n_ and n_['d']))
for a in dict.fromkeys(alertes): print('⚠', a)
for v, e in KO: print('✗', v, e)
if A.dry: raise SystemExit(0)

# ── 4) qc/ → final/ (copie relue) + fiches approuvées ──
def copier_final(r):
    if '/qc/' not in (r['u'] or ''): return True   # déjà validée dans final/
    try:
        for u, ct in ((r['u'], 'video/mp4'), (r['p'], 'image/jpeg')):
            if not u or '/qc/' not in u: continue
            if ct == 'image/jpeg' and head_url(u)[0] == 404: log('⚠', r['vf'], 'poster absent de qc/'); continue
            if not copie_verifiee(u, 'final/' + u.split('/qc/')[1], ct): return False
        return True
    except Exception as e: log('✗', r['vf'], str(e)[-160:]); return False
with cf.ThreadPoolExecutor(3) as ex: res = dict(zip([r['vf'] for r in ordre], ex.map(copier_final, ordre)))
rates = [v for v, g in res.items() if not g]
if rates: raise SystemExit('✗ copie final/ ratée pour %s : rien n\'est programmé (les vidéos restent en revue), relancer' % ' '.join(rates))
vl = sql_arr([r['vf'] for r in ordre])
q("begin;update factory_fp_frames set video_url=replace(video_url,'/qc/','/final/') where video_url in (select video_url from factory_qc where template = any(%s) and strpos(video_url,'/qc/')>0);"
  "update factory_fp set video_url=replace(video_url,'/qc/','/final/') where video_url in (select video_url from factory_qc where template = any(%s) and strpos(video_url,'/qc/')>0);"
  "update factory_qc set status='approved', reviewed_at=coalesce(reviewed_at, now()), video_url=replace(video_url,'/qc/','/final/'), poster_url=replace(poster_url,'/qc/','/final/') "
  "where template = any(%s) and strpos(video_url,'/qc/')>0;commit;" % (vl, vl, vl), js=False)
fin = {r['vf']: r for r in q("select template vf, video_url u from factory_qc where template = any(%s) and status='approved' and strpos(video_url,'/final/')>0;" % vl)}
if set(fin) != {r['vf'] for r in ordre}: raise SystemExit('✗ fiches non basculées vers final/ : %s — rien n\'est programmé' % ' '.join(sorted({r['vf'] for r in ordre} - set(fin))))

# ── 5) programmation : une transaction (posts existants d'abord garés en 2099, puis posés ; neuves insérées) ──
# revue 16/10 : le kit a été lu AVANT les copies (~1,2 Go) → relu ici ; s'il a bougé (Axel a coché « programmées », un autre
# script a écrit), on s'arrête sans rien écrire (les vidéos restent validées dans final/, relancer suffit).
E2 = q("select p.id::text, p.scheduled_at::text t from factory_posts p where p.status='todo' and p.platform='instagram' and p.account='%s' "
       "and p.scheduled_at>='%s' and p.scheduled_at<'2090-01-01' order by p.scheduled_at, p.created_at;" % (acc, debut.strftime('%Y-%m-%d %H:%M:%S+00')))
last2 = q("select max(scheduled_at)::text t from factory_posts where account='%s' and platform='instagram' and status in ('scheduled','published') "
          "and scheduled_at<'2090-01-01';" % acc)[0]['t']
if [(x['id'], ts(x['t'])) for x in E2] != [(x['id'], ts(x['t'])) for x in E] or last2 != last:
    raise SystemExit('✗ le kit de %s a changé pendant les copies : rien n\'est programmé (vidéos validées dans final/) — relancer le même ordre' % acc)
ids = [x['id'] for x in seq if not x['neuf']]
deb_sql = debut.strftime('%Y-%m-%d %H:%M:%S+00')
# garde DANS la transaction : tous les posts déplacés sont encore « à programmer » et rien n'a été programmé dans Instagram
# depuis --depuis ; sinon exception → rollback, rien n'est écrit
sql = ("do $g$ begin if (select count(*) from factory_posts where id = any(%s) and status='todo') <> %d "
       "or exists (select 1 from factory_posts where account='%s' and platform='instagram' and status in ('scheduled','published') and scheduled_at>='%s' and scheduled_at<'2090-01-01') "
       "then raise exception 'ETALER_KIT_CHANGE'; end if; end $g$;" % (sql_arr(ids, 'uuid'), len(ids), acc, deb_sql))
for n_, i_ in enumerate(ids):
    sql += "update factory_posts set scheduled_at='2099-01-01'::timestamptz + interval '%d minutes' where id='%s' and status='todo';" % (n_, i_)
NOTE = 'étalé %s %s' % (acc, dt.datetime.now(PAR).strftime('%d/%m'))   # equilibrer.py ne déplace jamais ces posts
for x in seq:
    t = x['slot'].strftime('%Y-%m-%d %H:%M:%S+00')
    if not x['neuf']: sql += "update factory_posts set scheduled_at='%s' where id='%s' and status='todo';" % (t, x['id']); continue
    r = x['row']; leg = legende_kit(os.path.basename(fin[r['vf']]['u']), r['c']).replace("'", "''")
    # revue 16/10 : jamais deux fois la même VF dans le kit (renvoi de la requête après un commit dont la réponse s'est perdue)
    sql += ("insert into factory_posts (scheduled_at, platform, account, video_url, caption, combo, status, note) select '%s'::timestamptz,'instagram','%s',q.video_url,'%s',"
            "q.brick_combo||jsonb_build_object('vf',q.template),'todo','%s' from factory_qc q where q.template='%s' and q.status='approved' "
            "and not exists (select 1 from factory_posts p where p.combo->>'vf'=q.template and p.status<>'skipped');" % (t, acc, leg, NOTE, r['vf']))
try: q1('begin;' + sql + 'commit;')
except RuntimeError as e:
    raise SystemExit('✗ programmation refusée (%s) : rien n\'est écrit — vérifier le kit puis relancer' % ('le kit a changé' if 'ETALER_KIT_CHANGE' in str(e) else str(e)[-200:]))

# ── 6) relecture : chaque post à sa place, rien de parqué en 2099 ──
P = q("select p.id::text, p.scheduled_at::text t, p.combo->>'vf' vf from factory_posts p where p.status='todo' and p.platform='instagram' and p.account='%s' "
      "and p.scheduled_at>='%s' order by p.scheduled_at;" % (acc, debut.strftime('%Y-%m-%d %H:%M:%S+00')))
ok = len(P) == len(seq) and all((x['neuf'] and p['vf'] == x['vf']) or (not x['neuf'] and p['id'] == x['id']) for p, x in zip(P, seq)) \
    and all(ts(p['t']) == x['slot'] for p, x in zip(P, seq))
print('relecture du kit :', 'OK' if ok else '✗ ÉCART — vérifier factory_posts (%d lus / %d attendus)' % (len(P), len(seq)))

# ── 7) qc/ libérée (copie final/ relue ET fiche basculée) — chemins tirés de la fiche final/, donc aussi après une reprise
#    (revue 16/10 : une relance après un arrêt entre 4 et 7 laissait ~1,2 Go dans qc/) ──
rm = []
for r in ordre:
    u = fin[r['vf']]['u']; c_, t_ = head_url(u)
    if c_ != 200 or t_ <= 0: continue   # copie final/ illisible : on garde qc/
    b = os.path.basename(u)[:-4]; rm += ['ss:///factory-media/qc/' + b + '.mp4', 'ss:///factory-media/qc/' + b + '-poster.jpg']
if rm and ok: storage_rm(rm)
sys.exit(0 if ok and not KO else 1)
