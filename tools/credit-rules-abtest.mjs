// A/B test v2 — reproduit le code déployé + la NOUVELLE règle « achetés dépensés EN PREMIER »
const boughtLeft = (p) => Math.min(p.bought_credits || 0, p.credits_remaining || 0);
// spend_credits : achetés d'abord, puis le plan ; l'opération mémorise la part achetée (bought_part)
function spend(p, n) {
  if ((p.credits_remaining||0) < n) return { p, ok:false };
  const bought_part = Math.min(p.bought_credits||0, n);
  return { p: { ...p, credits_remaining: p.credits_remaining - n, bought_credits: Math.max(0, (p.bought_credits||0) - n) }, ok:true, op:{ amount:n, bought_part } };
}
// refund_credits : rend le montant ET la part achetée
function refund(p, op) { return { ...p, credits_remaining: p.credits_remaining + op.amount, bought_credits: (p.bought_credits||0) + op.bought_part }; }
function renew(p, planCredits) { const b = boughtLeft(p); const planLeft = Math.max(0, p.credits_remaining - b); return { ...p, credits_remaining: Math.min(planLeft + planCredits, 2*planCredits) + b, bought_credits: b }; }
function deactivate(p) { const k = boughtLeft(p); return { ...p, plan:'free', credits_remaining:k, bought_credits:k }; }
const line = (t, v) => console.log('  ' + t.padEnd(58) + '→ ' + v);
const fmt = p => `${p.credits_remaining} (plan ${p.credits_remaining - p.bought_credits} + achetés ${p.bought_credits})`;

console.log('\n=== A) ACHETÉS DÉPENSÉS EN PREMIER (Pro 550 + pack 300) ===');
let p = { plan:'pro', credits_remaining:850, bought_credits:300 };
line('Départ', fmt(p));
let r = spend(p, 100); p = r.p; line('Dépense 100', fmt(p) + '   ← les 100 sortent des ACHETÉS');
r = spend(p, 250); p = r.p; line('Dépense 250', fmt(p) + '   ← 200 achetés + 50 du plan');
r = spend(p, 200); p = r.p; line('Dépense 200', fmt(p) + '   ← tout sur le plan (plus d\'achetés)');
console.log('\n=== B) REMBOURSEMENT (génération ratée) — rend aussi la part achetée ===');
let q = { plan:'pro', credits_remaining:850, bought_credits:300 };
let sp = spend(q, 350); line('Dépense 350 (300 achetés + 50 plan)', fmt(sp.p));
let back = refund(sp.p, sp.op); line('Remboursement de l\'opération', fmt(back) + '   ← identique au départ');
console.log('\n=== C) RENOUVELLEMENT après consommation (report plafonné 2×) ===');
let c = { plan:'pro', credits_remaining:120, bought_credits:0 };
line('Fin de mois : reste 120 (plan)', fmt(c)); c = renew(c, 550); line('Renouvellement min(120+550, 1100)', fmt(c));
let c2 = { plan:'pro', credits_remaining:1400, bought_credits:300 };
line('Fin de mois : 1100 plan + 300 achetés', fmt(c2)); c2 = renew(c2, 550); line('Renouvellement : plan plafonné, achetés intacts', fmt(c2));
console.log('\n=== D) Pro jamais dépensé : 600 → 1100 → 1100 ===');
let d = { plan:'pro', credits_remaining:600, bought_credits:0 };
d = renew(d, 550); line('Mois 2', fmt(d)); d = renew(d, 550); line('Mois 3 (surplus du mois 1 perdu)', fmt(d));
console.log('\n=== E) SOLDE INSUFFISANT ===');
let e = { plan:'pro', credits_remaining:30, bought_credits:0 };
line('30 restants, dépense 45', spend(e, 45).ok ? 'ACCEPTÉ ✗' : 'REFUSÉ (ok:false, rien débité) ✓');
console.log('\n=== F) RETOUR EN FREE — garde uniquement les achetés ===');
line('ax.quiivix 1378 plan + 0 achetés', fmt(deactivate({ plan:'elite', credits_remaining:1378, bought_credits:0 })));
line('membre 800 dont 300 achetés', fmt(deactivate({ plan:'pro', credits_remaining:800, bought_credits:300 })));
console.log('');
