#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// RÉCOLTE LES CAPTURES DE L'APP ET LEURS ZONES, AU PIXEL PRÈS.
//
// Axel, après trois tentatives de cadrage par analyse d'image : « mal encadré,
// faut vraiment encadrer au pixel près ». Il a raison, et l'échec était
// structurel : sur une interface sombre aux boutons sombres, il n'y a pas de
// bord à retrouver. Un modèle de vision sait NOMMER un élément, pas le MESURER.
//
// L'app est la nôtre. On la charge dans Chrome, on lui demande la position
// RÉELLE de chaque bouton (getBoundingClientRect), et on prend la capture DANS
// LA MÊME PAGE, au même instant : l'image et les coordonnées ne peuvent plus
// diverger. Plus de rognage à deviner, plus de barre macOS, plus de dérive.
//
// Effet de bord : #145 (captures tuto périmées) disparaît — elles ne sont plus
// des fichiers qu'on refait à la main, elles se régénèrent.
//
//   node render-worker/harvest-screens.mjs [--out assets/tuto] [--port 8765]
//
// Sortie : <out>/<slug>.png  +  <out>/screens.json (les zones nommées).
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const OUT = join(HERE, arg('--out', 'assets/tuto'))
const PORT = arg('--port', '8765')
const BASE = `http://localhost:${PORT}/Autre%20SaaS/avatarads-membres/app/index.html`
const W = 1600, H = 900          // 16:9 : le cadrage qu'on rejoue ensuite en 9:16

// ── LES ÉCRANS À RÉCOLTER ───────────────────────────────────────────────────
// `open` s'exécute dans la page. Tout ce qui doit être visible sur la capture
// est mis en place ici — la navigation, mais aussi l'ouverture d'une modale.
// Les noms viennent des conteneurs `id="v-…"` de l'app — pas de devinette.
const SCREENS = [
  { slug: '01-imagesia',         open: `nav('imagegen')` },
  { slug: '02-express',          open: `nav('express')` },
  { slug: '03-generateur',       open: `nav('generator')` },
  { slug: '04-montageia',        open: `nav('montage')` },
  { slug: '05-bibliotheque',     open: `nav('library')` },
  { slug: '06-nettoyage-audio',  open: `nav('audioclean')` },
  { slug: '07-enregistreur',     open: `nav('recorder')` },
  { slug: '08-parrainage',       open: `nav('affiliation')` },
  { slug: '09-cartoon',          open: `nav('cartoon')` },
  { slug: '11-connecter-claude', open: `openMcpModal()` },
  // ── LES PANNEAUX AVANCÉS ────────────────────────────────────────────────
  // Les captures ci-dessus montrent les panneaux REPLIÉS. Résultat : sur « tu
  // ouvres les paramètres avancés et tu mets Podcast », la visite guidée pouvait
  // zoomer sur la LIGNE « Paramètres avancés » mais jamais montrer ce qu'il y a
  // dedans — l'écran n'existait pas dans le catalogue. On les récolte donc
  // ouverts, avec leurs zones mesurées comme les autres.
  { slug: '13-montage-avance',   open: `nav('montage'); mzAdvOpen()` },
  { slug: '14-audio-avance',     open: `nav('audioclean'); _acToggleAdv()` },
  // Motion Control (14/08) : le rail vit DANS Express — on récolte l'écran
  // avec le moteur Motion sélectionné (réf vidéo + personnage + bouton Générer).
  { slug: '15-motion-control',   open: `nav('express'); if (typeof _expSetEngine==='function') _expSetEngine('motion')` },
]

const chromeBin = () => {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome')
  if (existsSync(root)) {
    for (const v of readdirSync(root).sort().reverse()) {
      const p = join(root, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app',
        'Contents', 'MacOS', 'Google Chrome for Testing')
      if (existsSync(p)) return p
    }
  }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}

// ── un client CDP minimal : Node 22 a un WebSocket natif, rien à installer ──
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map() }
  static async attach(port) {
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const page = list.find((t) => t.type === 'page')
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl)
          await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko })
          const c = new CDP(ws)
          ws.onmessage = (e) => {
            const m = JSON.parse(e.data)
            const w = c.waiting.get(m.id)
            if (w) { c.waiting.delete(m.id); m.error ? w.ko(new Error(m.error.message)) : w.ok(m.result) }
          }
          return c
        }
      } catch (_) { /* Chrome démarre encore */ }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('Chrome injoignable sur le port de debug')
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((ok, ko) => {
      this.waiting.set(id, { ok, ko })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'erreur JS')
    return r.result.value
  }
}

// ── le récolteur, injecté dans la page ──────────────────────────────────────
const HARVEST = `
window.__harvest = (view) => {
  const W = innerWidth, H = innerHeight
  const slug = s => (s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)
  const sel = 'button,a[href],input,select,textarea,[onclick],[role="button"],[role="tab"]'
  const out = [], seen = new Set()
  for (const el of document.querySelectorAll(sel)) {
    if (!el.offsetParent) continue
    const r = el.getBoundingClientRect()
    if (r.width < 12 || r.height < 12) continue
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue
    // RÉELLEMENT VISIBLE, pas seulement présent dans le DOM. Le menu latéral
    // reste \`offsetParent\` sous une modale : sans ce test on récoltait des
    // zones invisibles sur la capture, donc des cadres posés sur du vide.
    const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2)
    if (!hit || (hit !== el && !el.contains(hit) && !hit.contains(el))) continue
    // innerText et pas textContent : textContent concatene sans separateur et
    // collait le titre a son sous-titre (« Photo Reelrealiste »). innerText
    // respecte la mise en page, on garde la coupure comme un separateur lisible.
    const raw = el.getAttribute('aria-label') || el.value || el.placeholder || el.innerText || el.textContent || ''
    const label = String(raw).split(/\\n+/).map(t=>t.trim()).filter(Boolean).join(' · ').replace(/\\s+/g,' ').trim().slice(0,60)
    let name = slug(label) || slug(el.id) || slug((el.className||'').split(' ')[0])
    if (!name) continue
    let n = name, i = 2; while (seen.has(n)) n = name + '-' + (i++)
    seen.add(n)
    out.push({ name: n, label,
      x: +((r.left + r.width/2)/W).toFixed(4), y: +((r.top + r.height/2)/H).toFixed(4),
      w: +(r.width/W).toFixed(4), h: +(r.height/H).toFixed(4) })
  }
  return { view, W, H, zones: out }
}; 'ok'`

const MEMBER = `enterApp({ id:'f0cae49a-e610-4721-862a-5c4afca6d7eb', email:'axel@iamanager.fr',
  plan:'elite', credits_remaining:2200, credits_total:2200, first_name:'axel',
  is_owner:true, images_used:0, videos_used:0 }); 'ok'`

const main = async () => {
  mkdirSync(OUT, { recursive: true })
  const port = 9333
  // un profil laissé par un run précédent verrouille le port de debug et Chrome
  // démarre sans jamais exposer de cible : on repart toujours d'un profil vierge
  const profile = '/tmp/harvest-profile'
  rmSync(profile, { recursive: true, force: true })
  const chrome = spawn(chromeBin(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    // sans ça, macOS demande le mot de passe du trousseau au démarrage (Chrome
    // croit devoir déchiffrer des identifiants enregistrés). On n'en a aucun :
    // il charge localhost, lit des positions, capture, et on le tue.
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--window-size=${W},${H}`,
    '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' })

  try {
    const cdp = await CDP.attach(port)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })

    // On REPART du fichier existant : les captures d'une AUTRE application (les
  // ecrans de Claude, fournis a la main) n'ont pas de DOM a lire ici. Repartir
  // d'un objet vide les effacait a chaque recolte — et avec elles la visite
  // guidee du tuto « Connecter Claude ».
  const all = existsSync(join(OUT, 'screens.json'))
    ? JSON.parse(readFileSync(join(OUT, 'screens.json'), 'utf8')) : {}
    for (const s of SCREENS) {
      await cdp.send('Page.navigate', { url: BASE })
      await new Promise((r) => setTimeout(r, 1400))     // le temps que le script de l'app tourne
      await cdp.eval(HARVEST)
      try { await cdp.eval(MEMBER) } catch (e) { console.warn('  entrée dans l\'app :', e.message) }
      await new Promise((r) => setTimeout(r, 350))
      try { await cdp.eval(s.open) } catch (e) { console.warn(`  ${s.slug} : ${e.message}`); continue }
      await new Promise((r) => setTimeout(r, 700))      // ouverture + animations

      // le toast « Bienvenue <prénom> · Plan <x> » posé par enterApp() (3 s) tombait
      // dans la capture (Axel, 22/08 : « je ne veux pas voir le bienvenue axel plan
      // elite ») → masqué juste avant la prise de vue, ainsi que tout toast en cours.
      try { await cdp.eval(`(()=>{ const t=document.getElementById('toastEl'); if(t){ t.classList.remove('show'); t.style.display='none' } return 'ok' })()`) } catch (_) { /* pas de toast */ }
      await new Promise((r) => setTimeout(r, 120))
      const h = await cdp.eval(`__harvest(${JSON.stringify(s.slug)})`)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(OUT, s.slug + '.png'), Buffer.from(shot.data, 'base64'))
      all[s.slug] = { zones: h.zones }
      console.log(`✓ ${s.slug.padEnd(20)} ${String(h.zones.length).padStart(3)} zones`)
    }
    writeFileSync(join(OUT, 'screens.json'), JSON.stringify(all, null, 1))
    console.log(`\n→ ${OUT}/screens.json`)
  } finally {
    chrome.kill()
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
