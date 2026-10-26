#!/usr/bin/env python3
# Texte incrusté — copie usine/incruste/banque.json dans factory_bricks.meta.incruste (une fiche par hook Omni), pour que les
# lots et le tableau de bord lisent le découpage, les mots forts et les Hook démo de chaque hook. Usage : python3 usine/incruste/banque.py
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lots'))
from outils import q
B = {k: v for k, v in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'banque.json'))).items() if not k.startswith('_')}
q("update factory_bricks b set meta = coalesce(b.meta, '{}'::jsonb) || jsonb_build_object('incruste', x.v) "
  "from jsonb_each($j$" + json.dumps(B, ensure_ascii=False) + "$j$::jsonb) x(k, v) where b.id = x.k;", js=False)
n = q("select count(*) n from factory_bricks where meta ? 'incruste';")[0]['n']
print('%d hooks dans la banque, %d fiches en base' % (len(B), n))
