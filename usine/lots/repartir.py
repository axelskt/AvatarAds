#!/usr/bin/env python3
# Creative Factory — RÉPARTIT le kit de publication (19/10, Axel : « répartis les formats proprement, genre une vidéo Omni,
# une Express, une MCP… ; quand on fera des assemblages on mettra dans une section à répartir, comme ça ceux qu'on fait
# récemment ne se retrouvent pas tout derrière ; garde que 20 vidéos dans BloxAI, le reste tu répartis dans le kit »).
#
# À lancer après chaque validation (valider.py le fait) :
#   1. « à répartir » = toutes les vidéos ENCORE « à faire » du kit (jamais celles mises en brouillon / postées : statut
#      'scheduled' / 'published', figées) + le stock commun BloxAI, moins ses BX_RESERVE plus anciennes (20 restent
#      ouvertes aux diffuseurs : BloxAI n'en propose qu'au-delà de son réglage kit_buffer = 15) ;
#   2. un avatar par compte : A3 → @avataradss, A1 → @ialebd.axel, tout le reste (A4 d'abord, A5, têtes choquées…) → @leoadsia ;
#   3. chaque file : les plus RÉCENTES d'abord (n° VF décroissant), en tournant les démos (Omni, Express, Claude/MCP,
#      Motion Control, pubs statiques, Images IA : jamais deux fois la même de suite, si possible pas dans les 2 dernières),
#      parlé / sans voix alternés, jamais deux fois la même photo / réaction ni deux textes à logos de suite ;
#   4. jours et ordre réécrits à partir du lendemain du dernier post figé (heures du kit = simple ordre, Axel poste à la main).
# Retrait du stock : journal factory_kit_pending AVANT bx_kit_withdraw (une coupure est rattrapée par kit-recharge), puis
# insertion des posts, puis effacement du journal. Rien n'est supprimé.
# usage : python3 usine/lots/repartir.py [--go] [--kit VF-0972,VF-0973]   (sans --go : plan seulement)
#   --kit : vidéos du stock commun à mettre DANS LE KIT quoi qu'il arrive (Axel 27/10 : « mets-les dans le kit si elles sont
#   validées »), même si la réserve des diffuseurs n'est pas pleine
import json, os, re, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import q, bx_q, log

GO = '--go' in sys.argv
FORCE = set(sys.argv[sys.argv.index('--kit') + 1].split(',')) if '--kit' in sys.argv else set()
PARIS = ZoneInfo('Europe/Paris')
HRS = {'avataradss': [12, 14, 16, 18, 20], 'leoadsia': [12, 16, 20], 'ialebd.axel': [11, 13, 15, 17, 19]}   # = kit-recharge
BX_RESERVE = 35
PUB = 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/factory-media/stock/'
VF_RE = re.compile(r'^VF-\d{4}$')

def avatar(c):
    if isinstance(c.get('avatar'), str) and re.match(r'^A\d+$', c['avatar']): return c['avatar']
    m = re.match(r'^(A\d+)-', str(c.get('photo') or ''))
    if m: return m.group(1)
    m = re.match(r'^R-(?:I-)?(A\d+)(?:-|$)', str(c.get('reaction') or ''))
    return m.group(1) if m else None
def account_of(c):
    a = avatar(c)
    if c.get('voix_off'): return 'leoadsia'   # Axel 21/10 : voix off sur @leoadsia (format arrêté)
    # Axel 21/10 : le fond vert suit la règle par avatar (A3 → @avataradss, A1 → @ialebd.axel, le reste → @leoadsia)
    return 'avataradss' if a == 'A3' else 'ialebd.axel' if a == 'A1' else 'leoadsia'
def kind(c): return 'm' if c.get('format') == 'F05' else 'o'
def unit(c): return c.get('reaction') if kind(c) == 'm' else c.get('photo')
def logo(c): return c.get('texte_choc') in ('TH27', 'TH36')
FAM = [('C-OMNI', 'Omni'), ('C-EXP', 'Express'), ('C-MCP', 'Claude'), ('C-CLAUDE', 'Claude'), ('C-MC', 'Motion Control'),
       ('C-SADS', 'Pubs statiques'), ('C-IMGIA', 'Images IA')]
def family(c):
    d = str(c.get('contenu') or '')
    return next((f for p, f in FAM if d.startswith(p)), d or '?')
# légende = le CTA de la vidéo (même règle que kit-recharge cap()) ; 19/10 : AIDE, MONTAGE et PLAN ont leur propre mot-clé
def cap(name, c):
    s = '_' + '_'.join(x for x in (name, c.get('cta'), c.get('contenu')) if isinstance(x, str) and x) + '_'
    if '_CTA-cafe_' in s: return "Tu peux toi aussi faire la même chose pour seulement un café par jour. Commente « SITE » et je t'envoie le lien en privé."
    if kind(c) == 'm' and ('_C-MCPM-' in s or '_C-MCM-' in s or any('_C-OMNIM-0%d_' % k in s for k in (5, 6, 7))):
        return "Commente « CLAUDE » et je t'envoie le lien en privé."
    if '_CTA-CLAUDE_' in s: return "Commente « CLAUDE » et je t'envoie le lien en privé pour faire la même chose."
    if '_CTA-AIDE_' in s: return "Commente « AIDE » et je t'envoie le lien pour tester par toi-même."
    if '_CTA-MONTAGE_' in s: return "Commente « MONTAGE » et je t'envoie tout en privé."
    if '_CTA-PLAN_' in s: return "Commente « PLAN » et je t'envoie la configuration exacte que j'utilise."
    return "Écris « SITE » en commentaire et je t'envoie le tutoriel complet gratuitement pour faire la même chose."
def esc(s): return str(s).replace("'", "''")

def order(items, prev):
    """items triés plus récents d'abord ; prev = dernier post figé {unit, kind, logo, fam} ; renvoie l'ordre de publication.
    Axel 21/10 (« trier correctement pour que le contenu soit varié à chaque fois ») : plus de « premier qui passe » (les
    familles rares partaient au début, la fin de file n'était plus qu'Omni + Claude, 3 parlées d'affilée) — chaque pas prend la
    vidéo au meilleur score : jamais la même photo / réaction de suite, pas la même famille que la précédente (ni, si possible,
    que les 2 dernières), pas 3 parlées / sans voix d'affilée, pas deux textes à logos de suite ; les familles et formats
    ABONDANTS sont étalés en proportion de ce qui reste, les plus récentes restent devant à score égal."""
    from collections import Counter
    left, out, last = list(items), [], [prev] if prev else []
    while left:
        p = last[-1] if last else {}
        fams2, kinds2 = [x.get('fam') for x in last[-2:]], [x.get('kind') for x in last[-2:]]
        fc, kc, L = Counter(family(it['combo']) for it in left), Counter(kind(it['combo']) for it in left), len(left)
        def score(ki):
            k, it = ki; c = it['combo']; f, kd = family(c), kind(c); s = 0.0
            if p.get('unit') and unit(c) == p['unit']: s += 1000
            if f == p.get('fam'): s += 300
            elif f in fams2: s += 80
            if p.get('logo') and logo(c): s += 60
            if len(kinds2) == 2 and kinds2[0] == kinds2[1] == kd: s += 120
            s -= 400 * fc[f] / L + 60 * kc[kd] / L - 0.3 * k
            return s
        i = min(enumerate(left), key=score)[0]
        it = left.pop(i); c = it['combo']; out.append(it)
        last.append({'unit': unit(c), 'kind': kind(c), 'logo': logo(c), 'fam': family(c)})
    return out

def slots(account, after, n):
    out, d = [], after.astimezone(PARIS).date()
    while len(out) < n:
        for h in HRS[account]:
            t = datetime(d.year, d.month, d.day, h, tzinfo=PARIS)
            if t > after and len(out) < n: out.append(t)
        d += timedelta(days=1)
    return out

def ts_of(v):   # '2026-10-20 18:00:00+00' (CLI) → datetime UTC
    v = str(v).replace(' ', 'T')
    if re.search(r'[+-]\d\d$', v): v += ':00'
    return datetime.fromisoformat(v).astimezone(timezone.utc)

# ── 1) ce qui est figé (brouillon / posté) et ce qui reste « à faire » ──
now = datetime.now(timezone.utc)
frozen = {a: None for a in HRS}
for r in q("select account, max(scheduled_at) t from factory_posts where platform='instagram' and status in ('scheduled','published') "
           "and scheduled_at < '2090-01-01' group by 1"):
    if r['account'] in frozen: frozen[r['account']] = ts_of(r['t'])
prevs = {}
for a in HRS:
    r = q("select combo from factory_posts where platform='instagram' and account='%s' and status in ('scheduled','published') "
          "and scheduled_at < '2090-01-01' order by scheduled_at desc limit 1" % a)
    if r:
        c = r[0]['combo'] or {}
        prevs[a] = {'unit': unit(c), 'kind': kind(c), 'logo': logo(c), 'fam': family(c)}
todo = q("select id, account, combo, video_url from factory_posts where platform='instagram' and status='todo' and scheduled_at < '2090-01-01' "
         "and video_deleted_at is null")
held = [{'id': r['id'], 'vf': (r['combo'] or {}).get('vf'), 'combo': r['combo'] or {}, 'video_url': r['video_url']} for r in todo]
held = [h for h in held if h['vf'] and VF_RE.match(h['vf'])]
log('kit : %d vidéos « à faire » à répartir' % len(held))

# ── 2) stock commun : tout sauf les BX_RESERVE plus anciennes ──
op = bx_q("select vf from missions where status='open' order by vf")
op = [r['vf'] for r in op if VF_RE.match(r['vf'] or '')]
inkit = {h['vf'] for h in held} | {r['vf'] for r in q("select combo->>'vf' vf from factory_posts where status in ('todo','scheduled','published') and combo ? 'vf'")}
# Axel 21/10 : le format voix off Motion Control part sur @leoadsia (pas aux diffuseurs) → toujours repris du stock
vo = {r['template'] for i in range(0, len(op), 200) for r in q("select template from factory_qc where template in ('%s') and (brick_combo ? 'voix_off' or brick_combo ? 'fond_vert')" % "','".join(op[i:i + 200]))} if op else set()
# 21/10 : la réserve des diffuseurs se compte HORS fond vert / voix off (sinon ces vidéos, les plus récentes, la remplissaient et
# les diffuseurs ne gardaient plus rien)
nvo = [vf for vf in op if vf not in vo]
take = [vf for vf in op if (vf in vo or vf in FORCE or vf in nvo[:max(0, len(nvo) - BX_RESERVE)]) and vf not in inkit][::-1]
if FORCE - set(op) - inkit: log('⚠ hors stock commun (pas ouvertes dans BloxAI) : ' + ' '.join(sorted(FORCE - set(op) - inkit)))
log('stock BloxAI : %d ouvertes, %d gardées pour les diffuseurs, %d à prendre' % (len(op), len(op) - len(take), len(take)))
qc = {}
for i in range(0, len(take), 200):
    part = take[i:i + 200]
    for r in q("select template, video_url, brick_combo from factory_qc where status='approved' and template in ('%s')" % "','".join(part)):
        u = str(r['video_url'] or '')
        if u.startswith(PUB + r['template'] + '_') and re.match(r'^[A-Za-z0-9._-]+\.mp4$', u[len(PUB):]): qc[r['template']] = r
skip = [vf for vf in take if vf not in qc]
if skip: log('%d vidéo(s) sans fiche validée ou hors stock/ : laissées dans BloxAI (%s…)' % (len(skip), ', '.join(skip[:5])))
new = [{'id': None, 'vf': vf, 'combo': dict(qc[vf]['brick_combo'] or {}, vf=vf), 'video_url': qc[vf]['video_url']} for vf in take if vf in qc]

# ── 3) répartition par compte ──
plan = {}
for a in HRS:
    items = sorted([x for x in held + new if account_of(x['combo']) == a], key=lambda x: x['vf'], reverse=True)
    if not items: plan[a] = []; continue
    start = max(frozen[a] or now, now + timedelta(hours=1))
    seq = order(items, prevs.get(a))
    plan[a] = list(zip(slots(a, start, len(seq)), seq))
for a in HRS:
    P = plan[a]
    if not P: log('@%s : rien à répartir' % a); continue
    fams = [family(x['combo']) + ('·muet' if kind(x['combo']) == 'm' else '') for _, x in P[:12]]
    log('@%s : %d posts du %s au %s (%d nouveaux) · début : %s' % (a, len(P), P[0][0].strftime('%d/%m'), P[-1][0].strftime('%d/%m'),
        sum(1 for _, x in P if not x['id']), ' / '.join(fams)))
if not GO:
    log('plan seulement (ajoute --go pour écrire)'); sys.exit(0)

# ── 4) écriture : retrait atomique des nouvelles, insertion, puis réordonnancement des « à faire » ──
want = [x['vf'] for a in HRS for _, x in plan[a] if not x['id']]
taken = set()
for i in range(0, len(want), 200):
    part = want[i:i + 200]
    q("insert into factory_kit_pending (vf, at) values %s on conflict (vf) do update set at = excluded.at" % ','.join("('%s', now())" % v for v in part))
    r = bx_q("select public.bx_kit_withdraw(array['%s']::text[]) r" % "','".join(part))
    got = r[0]['r'] if r else []
    if isinstance(got, str): got = json.loads(got)
    taken |= {g['vf'] for g in got}
    missed = [v for v in part if v not in taken]
    if missed: q("delete from factory_kit_pending where vf in ('%s')" % "','".join(missed))
log('retirées du stock : %d / %d' % (len(taken), len(want)))
rows, upd = [], []
for a in HRS:
    for t, x in plan[a]:
        ts = t.astimezone(timezone.utc).isoformat()
        name = x['video_url'].split('?')[0].split('/')[-1]
        if x['id']: upd.append("('%s'::uuid, '%s'::timestamptz, '%s', '%s')" % (x['id'], ts, a, esc(cap(name, x['combo']))))
        elif x['vf'] in taken:
            rows.append("('%s', 'instagram', '%s', '%s', '%s', '%s'::jsonb, 'todo')" % (ts, a, esc(x['video_url']), esc(cap(name, x['combo'])), esc(json.dumps(x['combo'], ensure_ascii=False))))
for i in range(0, len(rows), 100):
    q("insert into factory_posts (scheduled_at, platform, account, video_url, caption, combo, status) values " + ','.join(rows[i:i + 100]))
if taken: q("delete from factory_kit_pending where vf in ('%s')" % "','".join(taken))
for i in range(0, len(upd), 150):
    q("update factory_posts p set scheduled_at = v.t, account = v.a, caption = v.c from (values %s) v(id, t, a, c) "
      "where p.id = v.id and p.status = 'todo'" % ','.join(upd[i:i + 150]))
log('kit : %d nouveaux posts, %d posts « à faire » réordonnés' % (len(rows), len(upd)))
