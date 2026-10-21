#!/usr/bin/env python3
# Creative Factory — RECALCULE la capacité réelle de l'usine (capacite.mjs, règles des lots) et l'écrit dans
# factory_capacite (lue par le tableau de bord, onglet Production). Axel 21/10. Lancé à la fin de valider.py et de lot.py ;
# à la main : python3 usine/lots/capacite.py
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outils import snapshot, q, log, WORK

def recalculer():
    b, v, qc = snapshot()
    json.dump({'qc': [{'t': x['t'], 's': x['s'], 'c': x['c']} for x in qc], 'variants': v}, open(os.path.join(WORK, 'inventaire.json'), 'w'))
    r = subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'capacite.mjs'), WORK], capture_output=True, text=True, check=True)
    d = json.loads(r.stdout)
    s = json.dumps(d, ensure_ascii=False)
    assert '$cap$' not in s
    q("insert into factory_capacite (id, data, computed_at) values ('usine', $cap$%s$cap$::jsonb, now()) "
      "on conflict (id) do update set data = excluded.data, computed_at = excluded.computed_at returning id;" % s, js=False)
    log('capacité : %d possibles maintenant (Omni %d · fond vert %d · texte + musique %d) · %d si toutes les briques (%d prises ≈ %s $)'
        % (d['now']['total'], d['now']['omni'], d['now']['fond_vert'], d['now']['texte_musique'], d['all']['total'], d['prises']['n'], d['prises']['cout_usd']))
    return d

if __name__ == '__main__':
    recalculer()
