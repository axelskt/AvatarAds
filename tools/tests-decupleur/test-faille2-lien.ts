// Banc de l'audit Décupleur du 30/10, faille 2, côté SERVEUR : vérification du lien (lienDecupleur de
// supabase/functions/_shared/decupleur.ts, utilisée par render-job dc-fetch et par l'outil Claude decupler_video).
// Un lien de live doit être refusé dès cette vérification ; les liens d'un client honnête passent toujours. Aucun réseau.
//
//   deno run --allow-read --allow-env test-faille2-lien.ts                       → code du dépôt (APRÈS)
//   DC_SHARED=/chemin/decupleur.ts deno run --allow-read --allow-env test-faille2-lien.ts   → autre version (AVANT)
const autre = Deno.env.get('DC_SHARED')
const url = autre ? new URL('file://' + autre) : new URL('../../supabase/functions/_shared/decupleur.ts', import.meta.url)
const chemin = decodeURIComponent(url.pathname)
const { lienDecupleur } = await import(url.href)
console.log(`Module testé : ${chemin}\n`)

let ok = 0, total = 0
const verif = (cond: boolean, libelle: string, detail = '') => { total++; if (cond) ok++; console.log(`${cond ? '  ✓' : '  ✗'} ${libelle}${cond ? '' : '  → ' + detail}`) }

console.log('Liens de live : refusés dès la vérification')
for (const l of [
  'https://www.tiktok.com/@compte/live',
  'www.tiktok.com/@compte/live?lang=fr&enter_from_merge=share',
  'https://m.tiktok.com/share/live/7300000000000000000',
  'https://www.tiktok.com/@compte/LIVE/',
  'https://www.tiktok.com/@compte/%6Cive',
  'https://www.tiktok.com/@compte/%256Cive',
  'https://www.instagram.com/compte/live/',
]) { const r = lienDecupleur(l); verif(r === null, l, `accepté (${r})`) }

console.log('Liens honnêtes : toujours acceptés')
for (const l of [
  'https://www.tiktok.com/@compte/video/7300000000000000000?is_from_webapp=1&sender_device=pc',
  'vm.tiktok.com/ZMabc123/',
  'https://vt.tiktok.com/ZSe4FqkKd/',
  'tiktok.com/@compte/video/7300000000000000000',
  'https://www.tiktok.com/@livestreamer/video/7300000000000000000',
  'https://www.tiktok.com/@compte/video/7300000000000000000?ref=live',
  'https://www.instagram.com/reel/DAbc_12-x/?igsh=MWx0eHg=',
  'https://www.instagram.com/share/reel/BAabc123/',
  'https://www.instagram.com/p/C0abc/',
]) { const r = lienDecupleur(l); verif(typeof r === 'string' && r.startsWith('https://'), l, 'refusé') }

console.log(`\n${ok}/${total} vérifications OK`)
Deno.exit(ok === total ? 0 : 1)
