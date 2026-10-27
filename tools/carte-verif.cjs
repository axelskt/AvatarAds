/* Carte des briques : chaque nouvelle brique est-elle présente ET reliée ? (Axel 27/10 : « à chaque ajout, mets à jour la carte »)
   1) données en direct (RPC owner rejouée dans une transaction annulée) :
      UID=$(supabase db query --linked -o csv "select id from profiles where is_owner limit 1" | sed -n 2p)
      supabase db query --linked -o json "begin; select set_config('request.jwt.claims', json_build_object('sub','$UID')::text, true); select factory_carte_data() as d; rollback;" > /tmp/carte.json
   2) node tools/carte-verif.cjs /tmp/carte.json H93 CTA-ADS-lien …   (sans ID : liste les briques isolées par famille) */
const fs = require('fs'), path = require('path');
global.window = {}; global.document = {}; global.performance = { now: () => 0 };
eval(fs.readFileSync(path.join(__dirname, '../factory-v2/cf-carte.js'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).rows[0].d;
const g = window.CFCarte.build(raw, {});
const ids = process.argv.slice(3);
if (ids.length) for (const id of ids) {
  const n = g.nodes.find((x) => x.id === id), ls = g.links.filter((l) => l.source === id || l.target === id);
  console.log(id.padEnd(16), n ? n.kind : 'ABSENT', ls.length + ' lien(s)', [...new Set(ls.map((l) => l.type))].join(', '));
} else {
  const deg = {}; g.links.forEach((l) => { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
  const by = {}; g.nodes.forEach((n) => { if (!deg[n.id]) (by[n.kind] = by[n.kind] || []).push(n.id); });
  Object.keys(by).forEach((k) => console.log(k.padEnd(14), 'isolées :', by[k].join(' ')));
}
