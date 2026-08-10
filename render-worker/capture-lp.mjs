// Capture la LP live (avatarads.fr) → assets/tuto/site-home.png, et mesure les
// zones « Commencer » / « Se connecter » pour le zoom de la scène navigateur.
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'assets', 'tuto')
const URL_LP = process.argv[2] || 'https://avatarads.fr'
const W = 1440, H = 900   // 16:10 → ×2 = 2880×1800 (le format attendu par la scène navigateur)
const chromeBin = () => {
  const root = join(homedir(), '.cache', 'puppeteer', 'chrome')
  if (existsSync(root)) for (const v of readdirSync(root).sort().reverse()) {
    const p = join(root, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    if (existsSync(p)) return p
  }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map() }
  static async attach(port) {
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const page = list.find((t) => t.type === 'page')
        if (page) { const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko }); const c = new CDP(ws); ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = c.waiting.get(m.id); if (w) { c.waiting.delete(m.id); m.error ? w.ko(new Error(m.error.message)) : w.ok(m.result) } }; return c }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('Chrome injoignable')
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((ok, ko) => { this.waiting.set(id, { ok, ko }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.result?.description || 'eval'); return r.result?.value }
}
const MEASURE = `(() => {
  const W = window.innerWidth, H = window.innerHeight;
  const find = (txt) => { const els = [...document.querySelectorAll('a,button')].filter(x => (x.textContent||'').trim().toLowerCase().replace(/[^a-zà-ÿ ]/g,'').includes(txt)); let best=null; for(const e of els){ const r=e.getBoundingClientRect(); if(r.top<0||r.top>H||r.width<8) continue; if(!best||r.top<best.top) best={left:r.left,top:r.top,width:r.width,height:r.height}; } if(!best) return null; const r=best; return { x:+((r.left+r.width/2)/W).toFixed(4), y:+((r.top+r.height/2)/H).toFixed(4), w:+(r.width/W).toFixed(4), h:+(r.height/H).toFixed(4) }; };
  return { commencer: find('commencer'), connecter: find('se connecter') || find('connecter') };
})()`
async function main() {
  mkdirSync(OUT, { recursive: true })
  const port = 9334, profile = '/tmp/lp-profile'
  const chrome = spawn(chromeBin(), ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--window-size=${W},${H}`, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' })
  try {
    const cdp = await CDP.attach(port)
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
    await cdp.send('Page.navigate', { url: URL_LP })
    await new Promise((r) => setTimeout(r, 3200))   // chargement + police + anim d'entrée
    let zones = null; try { zones = await cdp.eval(MEASURE) } catch (e) { console.warn('mesure zones :', e.message) }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'site-home.png'), Buffer.from(shot.data, 'base64'))
    console.log('✓ site-home.png capturé (' + URL_LP + ')')
    console.log('ZONES:', JSON.stringify(zones))
    // enregistre les zones dans screens.json pour zoneNamed('site-home', …)
    const sj = join(OUT, 'screens.json')
    const all = existsSync(sj) ? JSON.parse(readFileSync(sj, 'utf8')) : {}
    const z = []
    if (zones?.commencer) z.push({ name: 'commencer', ...zones.commencer })
    if (zones?.connecter) z.push({ name: 'se-connecter', ...zones.connecter })
    if (z.length) { all['site-home'] = { zones: z }; writeFileSync(sj, JSON.stringify(all, null, 1)); console.log('→ zones site-home ajoutées à screens.json') }
  } finally { chrome.kill() }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1) })
