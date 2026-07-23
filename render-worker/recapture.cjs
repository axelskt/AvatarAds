const puppeteer = require('/Users/axelskotnicki/node_modules/puppeteer');
const APP = 'file:///Users/axelskotnicki/Downloads/Autre%20SaaS/avatarads-membres/app/index.html'
const OUT = '/Users/axelskotnicki/Downloads/Autre SaaS/avatarads-membres/render-worker/assets/tuto'
const fs = require('fs')

// On capture l'ETAT EXACT montre par Axel : champs VIDES, « Photo Reel » selectionne,
// 9:16 selectionne. Puis on MESURE chaque zone sur la page elle-meme plutot que de
// la deviner sur l'image — c'est la seule facon d'avoir des cadres justes.
async function main () {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--allow-file-access-from-files', '--force-device-scale-factor=2'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise(r => setTimeout(r, 1800))

  const boot = () => page.evaluate(() => {
    try { currentMember = { id: 'test', email: 'demo@avatarads.fr', plan: 'elite', credits: 999999, name: 'Axel' } } catch (e) {}
    for (const id of ['loginOverlay', 'toastEl', 'setupOverlay', 'accountOverlay', 'creditsOverlay']) {
      const el = document.getElementById(id); if (el) el.style.display = 'none'
    }
  })

  // trouve un element par son TEXTE visible (les id changent, le libelle non)
  const byText = (txt, tag) => {
    const els = Array.from(document.querySelectorAll(tag || 'button,div,label,a,span'))
    const hit = els.filter((e) => (e.textContent || '').trim().toLowerCase().includes(txt.toLowerCase()))
      .filter((e) => e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().height > 14)
    return hit.length ? hit[hit.length - 1] : null
  }

  const measure = async (spec) => page.evaluate((spec, byTextSrc) => {
    const byText = eval('(' + byTextSrc + ')')
    const W = window.innerWidth, H = window.innerHeight
    const out = {}
    for (const [name, txt] of Object.entries(spec)) {
      let el = byText(txt)
      // on remonte jusqu'a la carte cliquable pour cadrer l'element entier
      while (el && el.parentElement && el.getBoundingClientRect().height < 40 &&
             el.parentElement.getBoundingClientRect().height < 200) el = el.parentElement
      if (!el) { out[name] = null; continue }
      const r = el.getBoundingClientRect()
      out[name] = [ +( (r.left + r.width / 2) / W ).toFixed(3), +( (r.top + r.height / 2) / H ).toFixed(3),
                    +( r.width / W ).toFixed(3), +( r.height / H ).toFixed(3) ]
    }
    return out
  }, spec, byText.toString())

  const rects = {}

  // ---------- IMAGES IA : Photo Reel + 9:16, champ vide ----------
  await boot()
  await page.evaluate(() => { try { nav('imagegen') } catch (e) {} })
  await new Promise(r => setTimeout(r, 1200))
  await page.evaluate(() => {
    const click = (t) => { const els = Array.from(document.querySelectorAll('button,div,label'))
      .filter((e) => (e.textContent || '').trim().startsWith(t) && e.getBoundingClientRect().height > 30)
      if (els.length) els[els.length - 1].click() }
    click('Photo Réel'); click('9:16')
    document.querySelectorAll('textarea,input[type=text]').forEach((t) => { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })) })
  })
  await new Promise(r => setTimeout(r, 900))
  await page.screenshot({ path: `${OUT}/01-imagesia.png` })
  rects['images-ia'] = await measure({
    'menu': 'Images IA', 'photo-reel': 'Photo Réel', 'pixar': 'Pixar 3D', 'fruit': 'Fruit',
    'ugc': 'UGC Réel', 'format': '9:16', 'prompt': 'Améliorer', 'generer': "Générer l'image",
  })
  console.log('✓ 01-imagesia')

  // ---------- EXPRESS : champ vide ----------
  await boot()
  await page.evaluate(() => { try { nav('express') } catch (e) {} })
  await new Promise(r => setTimeout(r, 1200))
  await page.evaluate(() => {
    document.querySelectorAll('textarea,input[type=text]').forEach((t) => { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })) })
  })
  await new Promise(r => setTimeout(r, 900))
  await page.screenshot({ path: `${OUT}/02-express.png` })
  rects['express'] = await measure({
    'menu': 'Express', 'realiste': 'Réaliste', 'cartoon': 'Cartoon 3D', 'portrait': 'Portrait',
    'duree': 'DURÉE', 'qualite': 'QUALITÉ', 'voix': 'Voix native', 'ajouter': 'Ajoute tes images',
    'prompt': 'Décris ta vidéo ET ce que', 'generer': 'Générer la vidéo',
  })
  console.log('✓ 02-express')

  fs.writeFileSync('/tmp/rects.json', JSON.stringify(rects, null, 1))
  for (const [scr, zs] of Object.entries(rects)) {
    console.log('\n' + scr)
    for (const [n, v] of Object.entries(zs)) console.log('  ' + n.padEnd(12), v ? v.join(', ') : 'NON TROUVÉ')
  }
  await browser.close()
}
main().catch((e) => { console.error('ÉCHEC:', e.message); process.exit(1) })
