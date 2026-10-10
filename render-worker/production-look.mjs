// ── LE « LOOK PRODUCTION » DANS LE MONTAGE IA (Axel, 09/10) ─────────────────
// « faudra faire un peu comme dans production » : le Montage IA reprend trois
// choses déjà validées vidéo par vidéo dans Production (Creative Factory, usine/) :
//   ① les styles de sous-titres S01…S21 (sans S14)            → plan.capSkin
//   ② le texte choc sur l'accroche, 8 styles CSxx retenus       → plan.chocStyle (sur plan.hook.text)
//   ③ les musiques énergiques (les douces refusées le 07/10)   → plan.music.track
//
// LE TIRAGE EST FAIT PAR L'APPELANT (app, MCP) ET ÉCRIT DANS LE PLAN : le moteur
// n'invente rien. Un re-rendu du même plan redonne la même vidéo, et un plan
// sans ces champs (anciens montages, autres chemins de rendu) ne change pas.
//
// La CSS est celle de usine/captions.mjs, mise à l'échelle du cadre (Production
// rend en 1080 × 1920). Toute retouche d'un style se fait des deux côtés.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── ① SOUS-TITRES ────────────────────────────────────────────────────────────
// SUBS_ALL de usine/build.mjs : S01-S19 + S21, S14 (sérif italique) retiré le 06/10.
export const CAP_SKINS = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13',
  'S15', 'S16', 'S17', 'S18', 'S19', 'S21']
const BOX_SKINS = ['S03', 'S05', 'S07', 'S21']
export const capSkinOf = (plan) => (plan && CAP_SKINS.includes(plan.capSkin) ? plan.capSkin : null)
export const isBoxSkin = (id) => BOX_SKINS.includes(id)
// Lisibles sur une scène plein cadre CRÈME (fond clair) : boîtes et contours noirs épais. Les styles blancs sans
// contour, les néons et les ombres seules (S04, S09, S10, S12, S13, S17) y disparaissent → ancien rendu « crème ».
const SKINS_SUR_CREME = ['S01', 'S02', 'S03', 'S05', 'S06', 'S07', 'S08', 'S11', 'S15', 'S16', 'S18', 'S19', 'S21']
export const skinLisibleSurCreme = (id) => SKINS_SUR_CREME.includes(id)
// jamais de ponctuation à l'écran (Axel 30/09, règle Production) ; le point d'un domaine reste
export const capSkinText = (t) => String(t || '').replace(/^[.,!?;:…()'’«»"-]+|[.,!?;:…()«»"]+$/g, '').trim()

export function capSkinCss(W) {
  const k = W / 1080
  const p = (v) => Math.round(v * k * 10) / 10 + 'px'
  // --fs = taille du style ; --fk = réduction d'un mot long (data-long, comme le .cap de base)
  return `
      .cap.sk { --fs: ${p(82)}; font-family: 'Arial Black', 'Archivo Black', sans-serif; font-weight: 900;
        font-size: calc(var(--fs) * var(--fk, 1)); line-height: 1.05; letter-spacing: .005em; color: #fff;
        text-transform: uppercase; -webkit-text-stroke: ${p(8)} #000; paint-order: stroke fill;
        text-shadow: 0 ${p(5)} ${p(16)} rgba(0,0,0,.5); }
      .cap.sk::before { display: none; }
      .cap.sk[data-long] { --fk: .72; }
      .cap.sk.bx { --fs: ${p(66)}; -webkit-text-stroke: 0; text-shadow: none; color: #111; line-height: 1.3; }
      .cap.sk.bx .bw { background: #fff; border-radius: ${p(16)}; padding: ${p(6)} ${p(20)} ${p(8)};
        box-shadow: 0 ${p(8)} ${p(24)} rgba(0,0,0,.28); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
      .cap.sk-S03.bx, .cap.sk-S05.bx, .cap.sk-S07.bx { color: #fff; }
      .cap.sk-S03.bx .bw { background: #1d6bff; }
      .cap.sk-S07.bx .bw { background: #e11d2e; }
      .cap.sk-S05.bx .bw { background: #ff2d8a; border-radius: ${p(40)}; }
      .cap.sk-S01 { --fs: ${p(96)}; font-family: 'Anton', sans-serif; font-weight: 400; letter-spacing: .02em; -webkit-text-stroke: ${p(5)} #000; }
      .cap.sk-S04 { color: #e9fff0; -webkit-text-stroke: ${p(2)} #0b2a14; text-shadow: 0 0 ${p(16)} #39ff88, 0 0 ${p(40)} #8a4dff, 0 ${p(4)} ${p(12)} rgba(0,0,0,.5); }
      .cap.sk-S06 { --fs: ${p(98)}; font-family: 'Anton', sans-serif; font-weight: 400; color: #ffe600; -webkit-text-stroke: ${p(7)} #000; }
      .cap.sk-S08 { --fs: ${p(98)}; -webkit-text-stroke: ${p(10)} #000; }
      .cap.sk-S09 { --fs: ${p(74)}; font-family: 'Inter', sans-serif; font-weight: 800; text-transform: none; -webkit-text-stroke: 0; text-shadow: 0 ${p(3)} ${p(16)} rgba(0,0,0,.8); }
      .cap.sk-S10 { -webkit-text-stroke: 0; text-shadow: 0 ${p(4)} ${p(18)} rgba(0,0,0,.75), 0 ${p(1)} ${p(3)} rgba(0,0,0,.6); }
      .cap.sk-S11 { --fs: ${p(96)}; color: #ff6a1a; -webkit-text-stroke: ${p(9)} #000; }
      .cap.sk-S12 { -webkit-text-stroke: ${p(3)} #2a0a1c; text-shadow: 0 0 ${p(18)} #ff3da6, 0 0 ${p(42)} rgba(255,61,166,.75), 0 ${p(4)} ${p(14)} rgba(0,0,0,.5); }
      .cap.sk-S13 { --fs: ${p(64)}; font-family: 'Inter', sans-serif; font-weight: 600; text-transform: none; -webkit-text-stroke: 0; letter-spacing: 0; text-shadow: 0 ${p(2)} ${p(12)} rgba(0,0,0,.85); }
      .cap.sk-S15 { -webkit-text-stroke: ${p(6)} #000; text-shadow: ${p(5)} ${p(6)} 0 #ff6a1a; }
      .cap.sk-S16 { color: #ffe600; -webkit-text-stroke: ${p(6)} #000; text-shadow: ${p(5)} ${p(6)} 0 #000; }
      .cap.sk-S17 { -webkit-text-stroke: 0; text-shadow: 0 0 ${p(14)} #ff1a1a, 0 0 ${p(38)} rgba(255,26,26,.85), 0 ${p(3)} ${p(10)} rgba(0,0,0,.6); }
      .cap.sk-S18 { --fs: ${p(96)}; font-family: 'Anton', sans-serif; font-weight: 400; color: #ffd24a; -webkit-text-stroke: ${p(5)} #7a0c0c; text-shadow: 0 ${p(5)} 0 #b3121a, 0 ${p(8)} ${p(18)} rgba(0,0,0,.5); }
      .cap.sk-S19 { font-family: 'Montserrat', sans-serif; font-weight: 900; color: #ffe600; -webkit-text-stroke: ${p(7)} #000; }`
}

// ── ② TEXTE CHOC ─────────────────────────────────────────────────────────────
// Les 8 styles encore au tirage dans usine/build.mjs (CHOC_STYLES, 06/10).
export const CHOC_STYLES = ['CS01', 'CS02', 'CS03', 'CS05', 'CS07', 'CS08', 'CS11', 'CS17']
export const chocStyleOf = (plan) => (plan && CHOC_STYLES.includes(plan.chocStyle) ? plan.chocStyle : null)
const EMOJI = /(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️)*)/gu
// un titre affiché SANS le texte choc ne garde pas ses emojis : le conteneur de rendu
// n'a pas de police emoji, ils sortiraient en carrés vides
export const sansEmoji = (t) => String(t || '').replace(EMOJI, '').replace(/[‍️]/g, '').replace(/\s{2,}/g, ' ').trim()
const escHtml = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))

// largeurs approchées (em) — copie de usine/formats.js (Inter 700) ; le filet de sécurité
// du navigateur (chocFitJs) rattrape l'écart avec la vraie police
function charEm(ch) {
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ch)) return 1.2
  if (ch === ' ') return 0.27
  if ('il.,:;!|\'’'.includes(ch)) return 0.28
  if ('ftrj'.includes(ch)) return 0.4
  if ('mw'.includes(ch)) return 0.88
  if ('MW'.includes(ch)) return 0.95
  if (/[A-ZÀ-ÖØ-Þ]/.test(ch)) return 0.7
  if (/[0-9]/.test(ch)) return 0.62
  if (ch === '…' || ch === '?') return 0.6
  return 0.58
}
const textEm = (s) => Array.from(s).reduce((n, c) => n + charEm(c), 0) * 1.03
// coupe en lignes (glouton puis équilibré) ; un emoji ne reste jamais seul sur sa ligne
function wrap(words, size, maxW) {
  words = words.reduce((acc, w) => {
    if (acc.length && !w.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}‍️]/gu, '').trim()) acc[acc.length - 1] += ' ' + w
    else acc.push(w)
    return acc
  }, [])
  const greedy = (limit) => {
    const lines = []
    let cur = ''
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w
      if (cur && textEm(t) * size > limit) { lines.push(cur); cur = w } else cur = t
    }
    if (cur) lines.push(cur)
    return lines
  }
  const lines = greedy(maxW)
  if (lines.some((l) => textEm(l) * size > maxW)) return null
  let lo = maxW * 0.5, hi = maxW
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2, t = greedy(mid)
    if (t.length === lines.length && !t.some((l) => textEm(l) * size > mid + 1)) hi = mid; else lo = mid
  }
  return greedy(hi)
}

// Placement : EN HAUT de la zone sûre TikTok / Reels (x 90 → 930, sous la barre du
// haut à 230 px), à l'endroit du titre d'accroche — au-dessus de la tête. Production
// évite les visages avec une détection macOS absente du serveur : on borne donc la
// hauteur (2 lignes en taille lisible, sinon 3) pour rester au-dessus du visage.
const SIZES = [78, 72, 66, 60, 54, 48, 44, 41]
export function chocLayout(text, W, H) {
  const k = Math.min(W / 1080, H / 1920)
  const left = Math.round(90 * W / 1080), right = Math.round(930 * W / 1080)
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  for (const [maxL, sizes] of [[2, SIZES.filter((s) => s >= 54)], [3, SIZES]]) {
    for (const s0 of sizes) {
      const size = Math.round(s0 * k), padX = Math.round(size * 0.42), padY = Math.round(size * 0.12), lineH = Math.round(size * 1.2)
      const lines = wrap(words, size, right - left - 2 * padX)
      if (!lines || lines.length > maxL) continue
      const tw = Math.max(...lines.map((l) => textEm(l) * size))
      const w = Math.min(right - left, Math.ceil(tw * 1.06) + 2 * padX)
      return { x: Math.round((left + right) / 2 - w / 2), y: Math.round(230 * H / 1920), w, size, lineH, padX, padY, lines, maxW: w - 2 * padX }
    }
  }
  return null
}

export function chocCss(W, H) {
  const k = Math.min(W / 1080, H / 1920)
  const p = (v) => Math.round(v * k * 10) / 10 + 'px'
  return `
      .choc { position: absolute; z-index: 75; font-family: 'Inter', sans-serif; font-weight: 700; color: #111; transform-origin: 50% 50%; }
      .choc .cl { display: flex; justify-content: center; margin: 0; }
      .choc .cl > span { display: inline-block; background: #fff; border-radius: ${p(14)}; padding: var(--py) var(--px); white-space: nowrap; box-shadow: 0 ${p(4)} ${p(14)} rgba(0,0,0,.18); }
      .choc .emj { height: 1.08em; width: auto; vertical-align: -0.2em; margin-left: .12em; }
      .cs-CS02 .cl > span { background: #111; color: #fff; }
      .cs-CS03 .cl > span { background: #E8261C; color: #fff; font-weight: 800; }
      .cs-CS05 { font-family: 'Montserrat', sans-serif; font-weight: 900; color: #fff; }
      .cs-CS05 .cl > span { background: none; box-shadow: none; -webkit-text-stroke: .14em #000; paint-order: stroke fill; padding: 0 .1em; }
      .cs-CS07 { color: #fff; font-weight: 800; }
      .cs-CS07 .cl > span { background: rgba(255,255,255,.22); border: ${p(2)} solid rgba(255,255,255,.45); backdrop-filter: blur(${p(18)}); -webkit-backdrop-filter: blur(${p(18)}); text-shadow: 0 ${p(2)} ${p(8)} rgba(0,0,0,.35); }
      .cs-CS08 { color: #fff; font-weight: 600; }
      .cs-CS08 .cl > span { background: #0A84FF; border-radius: .62em; }
      .cs-CS08 .cl:last-child > span { border-bottom-right-radius: .12em; }
      .cs-CS11 { font-family: 'Anton', sans-serif; font-weight: 400; color: #fff; letter-spacing: .01em; text-transform: uppercase; }
      .cs-CS11 .cl > span { background: none; box-shadow: none; text-shadow: .07em .07em 0 #000; }
      .cs-CS17 { left: 0 !important; width: ${W}px !important; background: rgba(0,0,0,.6); color: #fff; font-family: 'Inter', sans-serif; font-weight: 500;
        font-size: ${p(58)} !important; line-height: ${p(72)} !important; padding: ${p(14)} ${p(40)}; box-sizing: border-box; text-align: center; }
      .cs-CS17 .cl { display: inline; }
      .cs-CS17 .cl > span { display: inline; background: none; box-shadow: none; border-radius: 0; padding: 0; white-space: normal; }
      .cs-CS17 .cl:not(:last-child) > span::after { content: ' '; }`
}

// Emojis APPLE (Axel 30/09 : « bien prendre ceux d'Apple ») — mêmes images que Production
// (emoji-datasource-apple, 64 px), téléchargées par le WORKER dans le projet : la page
// rendue ne sort jamais (CSP). Échec réseau → l'emoji est simplement retiré.
const EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/'
export function preparerEmojisChoc(plan, proj) {
  const out = {}
  if (!chocStyleOf(plan)) return out
  const txt = String((plan.hook && plan.hook.text) || '')
  const found = [...new Set(txt.match(EMOJI) || [])].slice(0, 4)
  if (!found.length) return out
  mkdirSync(join(proj, 'emoji-choc'), { recursive: true })
  for (const e of found) {
    const cps = [...e].map((c) => c.codePointAt(0).toString(16))
    for (const n of [cps.join('-'), cps.filter((c) => c !== 'fe0f').join('-')]) {
      if (!/^[0-9a-f-]{2,60}$/.test(n)) continue
      const rel = 'emoji-choc/' + n + '.png'
      try {
        execFileSync('curl', ['-sfL', '--max-time', '8', '--max-filesize', '400000', '-o', join(proj, rel), EMOJI_CDN + n + '.png'], { stdio: 'ignore' })
        if (statSync(join(proj, rel)).size > 100) { out[e] = rel; break }
      } catch (_) { /* nom suivant */ }
    }
  }
  return out
}

// Le bloc à poser dans la composition (le wrapper .clip porte le temps, l'intérieur
// est animé : « the framework alone controls .clip visibility »). Rend null si la
// phrase ne tient pas — l'appelant garde alors son titre habituel.
export function chocBloc(plan, { W, H, start, dur, id = 'hkChoc' }) {
  const cs = chocStyleOf(plan)
  const text = String((plan.hook && plan.hook.text) || '').trim()
  if (!cs || !text || !(dur >= 0.6)) return null
  const emo = plan._chocEmoji || {}
  // un emoji non téléchargé disparaît (pas de carré vide) ; la mise en page est faite sur le texte affiché
  const affiche = text.replace(EMOJI, (m) => (emo[m] ? m : '')).replace(/\s{2,}/g, ' ').trim()
  const L = chocLayout(affiche, W, H)
  if (!L) return null
  const line = (l) => escHtml(l).replace(EMOJI, (m) => (emo[m] ? `<img class="emj" src="${emo[m]}" alt="">` : ''))
  const html = `
      <div class="clip" id="${id}" data-start="${start}" data-duration="${dur}" data-track-index="16" style="position:absolute;inset:0;z-index:75;pointer-events:none">
        <div class="choc cs-${cs}" id="${id}In" data-maxw="${L.maxW}" style="left:${L.x}px;top:${L.y}px;width:${L.w}px;font-size:${L.size}px;line-height:${L.lineH}px;--px:${L.padX}px;--py:${L.padY}px">${
  L.lines.map((l) => `<div class="cl"><span>${line(l)}</span></div>`).join('')}</div>
      </div>`
  // visible pleine opacité dès son début (frame 0 = couverture TikTok, jamais blanche) ;
  // sortie courte juste avant la fin — exactement l'entrée / sortie de Production
  const end = Math.round((start + dur) * 100) / 100
  const js = `
      tl.set('#${id}In', { autoAlpha: 1, scale: 1 }, ${start});
      tl.to('#${id}In', { autoAlpha: 0, scale: 0.96, duration: 0.16, ease: 'power1.in' }, ${Math.max(start, Math.round((end - 0.16) * 100) / 100)});`
  // filet : une ligne plus large que prévu (vraie police ≠ estimation) → police réduite,
  // mesurée une fois les polices chargées, toujours depuis la taille prévue
  const fitJs = `
    (function(){ const c=document.getElementById('${id}In'); if(!c || c.classList.contains('cs-CS17')) return;
      const max=+c.dataset.maxw||0, fs0=parseFloat(c.style.fontSize), lh0=parseFloat(c.style.lineHeight);
      const fit=()=>{ c.style.fontSize=fs0+'px'; c.style.lineHeight=lh0+'px'; let w=0;
        c.querySelectorAll('.cl>span').forEach(s=>{ w=Math.max(w, s.getBoundingClientRect().width); });
        const pad=parseFloat(getComputedStyle(c).getPropertyValue('--px'))*2||0;
        if(max && w-pad>max){ const k=max/(w-pad); c.style.fontSize=(fs0*k).toFixed(1)+'px'; c.style.lineHeight=(lh0*k).toFixed(1)+'px'; } };
      if(document.fonts && document.fonts.ready) document.fonts.ready.then(fit); else fit(); })();`
  return { html, js, fitJs, layout: L, style: cs, sfx: { kind: 'mo-pop-1', t: Math.round((start + 0.02) * 100) / 100, vol: 0.25 } }
}

// Le pop du texte choc, une seule fois : la composition est construite DEUX fois
// quand la base a une image (passe de mesure puis passe finale).
export function ajouterSfxChoc(plan, sfx) {
  const l = Array.isArray(plan.sfx) ? plan.sfx : []
  if (!l.some((x) => x && x.kind === sfx.kind && Math.abs((+x.t || 0) - sfx.t) < 0.05)) plan.sfx = [...l, sfx]
}

// ── ③ MUSIQUE ────────────────────────────────────────────────────────────────
// MUSIC_OK de usine/build.mjs : M01-M20 sans M04 ni les douces (M01-03, 05-07, 15, 16,
// 18, 19 — Axel 07/10 : « les musiques douces je ne suis pas fan »). Durées mesurées
// sur le bucket public factory-media/music (09/10) : la règle de Production est
// « jamais plus courte que la vidéo » — une piste trop courte n'est pas bouclée, on
// en prend une autre assez longue.
export const PROD_MUSIC = { M08: 186.2, M09: 14.9, M10: 26.4, M11: 17.9, M12: 21.8, M13: 30.9, M14: 60.0, M17: 14.2, M20: 40.5 }
export function choisirMusiqueProduction(track, duration) {
  const need = (Number(duration) || 0) + 0.5
  const ok = Object.keys(PROD_MUSIC).filter((id) => PROD_MUSIC[id] >= need)
  if (!ok.length) return null
  if (ok.includes(track)) return track
  // demandée trop courte (ou inconnue) : une autre assez longue, choix STABLE pour ce morceau demandé
  const h = Array.from(String(track || '')).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  return ok[h % ok.length]
}
// Fichier local de la piste (cache disque du worker) — URL construite depuis un id de la
// liste fermée ci-dessus, jamais depuis une valeur libre du plan.
export function fichierMusiqueProduction(id, supabaseUrl) {
  if (!Object.prototype.hasOwnProperty.call(PROD_MUSIC, id)) return null
  const dir = join(tmpdir(), 'aa-music-prod')
  const f = join(dir, id + '.mp3')
  try { if (existsSync(f) && statSync(f).size > 50000) return f } catch (_) { /* on retélécharge */ }
  let base = 'https://guvwgiejzkiodghywpwj.supabase.co'
  try { const u = new URL(String(supabaseUrl || '')); if (u.protocol === 'https:') base = u.origin } catch (_) { /* défaut */ }
  try {
    mkdirSync(dir, { recursive: true })
    const tmp = f + '.part'
    execFileSync('curl', ['-sfL', '--max-time', '60', '--max-filesize', '15000000', '-o', tmp,
      base + '/storage/v1/object/public/factory-media/music/' + id + '.mp3'], { stdio: 'ignore' })
    if (statSync(tmp).size < 50000) { rmSync(tmp, { force: true }); return null }
    renameSync(tmp, f)
    return f
  } catch (_) { return null }
}
