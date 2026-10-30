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
  // relecture du 30/10 : contournements de l'ancienne règle (coupe sur ?/# avant décodage, « / » ou fin exigés après « live »)
  // — le VRAI yt-dlp (extracteurs par défaut) les envoie tous à tiktok:live, qui prend « @compte/live » comme préfixe
  'https://www.tiktok.com/@compte/live%3Fx',
  'https://www.tiktok.com/@compte/live;x',
  'https://www.tiktok.com/@compte/live.',
  'https://www.tiktok.com/@compte/live%23',
  'https://www.tiktok.com/@compte/lively',
  'https://www.tiktok.com/@compte/live_2',
  'https://www.tiktok.com/@compte/live%3Fx?a=%zz',
  'https://www.tiktok.com/@compte/%2525256Cive%3F',
  'https://www.instagram.com/compte/live;x',
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
  'https://www.tiktok.com/@live.musique/video/7300000000000000000',
  'https://www.tiktok.com/@compte/video/7300000000000000000?ref=%2Flive%3Fx',
  'https://www.instagram.com/live.musique/reel/DAbc12/',
  'https://www.instagram.com/livenation/reel/DAbc12/',
  'https://www.instagram.com/reel/liveAbc12/',
]) { const r = lienDecupleur(l); verif(typeof r === 'string' && r.startsWith('https://'), l, 'refusé') }

console.log(`\n${ok}/${total} vérifications OK`)
Deno.exit(ok === total ? 0 : 1)
