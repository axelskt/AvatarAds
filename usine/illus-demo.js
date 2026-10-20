// Creative Factory — l'illustration du hook doit montrer ce que la démo montre (Axel 15/10, VF-0489 / VF-0503 : H78 montrait
// un avant / après Omni avant une démo static ads). Utilisé par lots/plan.mjs (on ne propose plus) et build.mjs (on refuse).
// Familles d'une démo : d'après son id et son libellé (« Démo MCP · Static ads + Images IA + Express »…).
export function demoFamilies(d) {
  const id = String(d && d.id || ''), lab = String(d && d.label || ''), f = new Set();
  if (/SADS/.test(id)) { f.add('static-ads'); return f; }               // une démo static ads ne montre que des pubs
  if (/OMNI/.test(id) || /\bOmni\b/.test(lab)) f.add('omni');
  if (/^C-MCM?-/.test(id) || /motion control/i.test(lab)) f.add('motion-control');
  if (/IMGIA/.test(id) || /images? ia/i.test(lab.replace(/^Démo Image IA · Static ads.*/i, ''))) f.add('image-ia');
  if (/static ads|pub produit/i.test(lab)) f.add('static-ads');
  if (/express/i.test(lab)) f.add('express');
  return f;
}
// type d'illustration → famille que la démo doit montrer ; « demo » / « video » suivent déjà la démo
export const ILLUS_NEEDS = { omni: 'omni', voiture: 'omni', montre: 'omni', pub: 'static-ads', fille: 'image-ia', avatar: 'image-ia', garcon: 'image-ia' };
// liste d'illustrations d'un hook + brique démo → raison du refus, ou '' si cohérent
export function illusMismatch(list, d) {
  const f = demoFamilies(d);
  for (const e of list || []) { const need = ILLUS_NEEDS[e && e.type]; if (need && !f.has(need)) return 'l\'illustration « ' + e.type + ' » (« ' + e.in + ' ») demande une démo ' + need;
    // Axel 20/10 (VF-0754) : « demo » = montrer la démo dans le hook → la démo doit avoir quelque chose de montrable
    if (e && e.type === 'demo' && !e.p && !['omni', 'static-ads', 'motion-control', 'express', 'image-ia'].some(x => f.has(x))) return 'l\'illustration « demo » (« ' + e.in + ' ») demande une démo montrable'; }
  return '';
}
