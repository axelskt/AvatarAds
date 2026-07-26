// Refait les captures d'interface du Montage IA (assets/tuto/*.png).
//
// Ces PNG sont ce que la vidéo AFFICHE quand l'audio nomme un module
// (`{anim:'screen', screen:'01-imagesia'}`) : une capture périmée = un tuto qui
// montre une app qui n'existe plus. À relancer dès que l'UI bouge :
//
//   node test/capture-tuto.mjs
//
// L'app est un fichier statique unique ; on n'a donc pas besoin de se connecter :
// on injecte un membre de test dans la LET-BINDING `currentMember` (jamais
// `window.currentMember` : le monolithe déclare `let currentMember`, une
// propriété de window ne serait pas la même variable) puis on appelle nav().

// puppeteer n'est pas une dépendance du worker : on emprunte celui qu'hyperframes
// a déjà installé dans le cache npx (même Chrome que celui qui rend les vidéos).
import { createRequire } from 'node:module'
import { globSync } from 'node:fs'
const require_ = createRequire(import.meta.url)
const PUPPET = globSync(process.env.HOME + '/.npm/_npx/*/node_modules/puppeteer/package.json')[0]
if (!PUPPET) throw new Error("puppeteer introuvable — lance `npx hyperframes@0.7.60 doctor` une fois pour l'installer")
const mod = require_(dirname(PUPPET))
const puppeteer = mod.default || mod

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')          // la racine du dépôt
const OUT  = join(HERE, '..', 'assets', 'tuto')

// 1440x900 en densité 2 → des PNG 2880x1800, comme les captures d'origine.
const VW = 1440, VH = 900, SCALE = 2

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2' }

// Un membre developer avec des crédits : c'est l'état sous lequel Axel filme.
const MEMBER = {
  id: 'tuto-capture', email: 'axel@iamanager.fr', plan: 'developer', is_owner: true,
  credits_remaining: 999999, images_used: 0, images_quota: 19998, videos_used: 0,
  quota_reset_date: '2026-08-26',
}

const SHOTS = [
  { file: '01-imagesia',        view: 'imagegen' },
  { file: '02-express',         view: 'express'  },
  { file: '03-generateur',      view: 'generator'},
  { file: '04-montageia',       view: 'montage'  },
  { file: '05-bibliotheque',    view: 'library'  },
  { file: '06-nettoyage-audio', view: 'audioclean' },
  { file: '07-enregistreur',    view: 'recorder' },
  { file: '08-parrainage',      view: 'affiliation' },
]

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/') p = '/app/index.html'
    const buf = await readFile(join(ROOT, p))
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' })
    res.end(buf)
  } catch { res.writeHead(404); res.end('nope') }
})

await new Promise((r) => server.listen(0, r))
const port = server.address().port
console.log(`▶ serveur local sur http://localhost:${port}`)

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: SCALE })
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page]', m.text()) })

await page.goto(`http://localhost:${port}/app/index.html`, { waitUntil: 'networkidle2' })

// On passe par enterApp() — la vraie porte d'entrée de l'app : elle pose
// `currentMember`, masque #loginOverlay et monte la barre membre. Certaines de ses
// sous-tâches tapent Supabase et échouent hors ligne : sans le try, l'écran de
// connexion resterait par-dessus et on capturerait le login (déjà arrivé).
const entered = await page.evaluate((m) => {
  // enterApp() salue l'arrivant par un toast qui vient se poser PILE sur le bouton
  // « Générer » — le point que le montage encadre le plus souvent. On le muselle.
  toast = () => {}                                     // eslint-disable-line no-undef
  try { enterApp(m) } catch (e) { /* les appels réseau échouent, l'UI est déjà montée */ }  // eslint-disable-line no-undef
  const ov = document.getElementById('loginOverlay')
  if (ov) ov.style.display = 'none'
  return ov ? getComputedStyle(ov).display : 'absent'
}, MEMBER)
if (entered !== 'none') throw new Error(`l'écran de connexion est resté visible (display=${entered})`)

for (const { file, view } of SHOTS) {
  const ok = await page.evaluate((v) => {
    try { nav(v); return true } catch (e) { return String(e.message) }   // eslint-disable-line no-undef
  }, view)
  if (ok !== true) { console.log(`  ✗ ${file} : nav('${view}') → ${ok}`); continue }
  await new Promise(r => setTimeout(r, 700))                        // les entrées animées se posent
  await page.screenshot({ path: join(OUT, file + '.png') })
  console.log(`  ✓ ${file}.png   (vue ${view})`)
}

await browser.close()
server.close()
console.log('▶ terminé —', OUT)
