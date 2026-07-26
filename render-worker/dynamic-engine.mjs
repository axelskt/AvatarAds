// ─────────────────────────────────────────────────────────────────────────────
// MOTEUR « DYNAMIQUE » (#147) — motion design continu type @lemosthiagoo.
//
// Ce moteur ne pose pas des scènes sur une page : il construit une CHAÎNE DE
// PANNEAUX qui se poussent les uns les autres (jamais de fondu), et chaque mot
// de la voix frappe à SON timestamp dans le panneau qui le contient. Objectif :
// ~95 % du temps animé — chaque panneau porte une dérive ambiante permanente,
// donc aucune frame n'est un aplat mort.
//
// Le plan d'entrée est LE MÊME que pour les autres styles (captions mot à mot,
// slides anim logo/screen/countup/result/punch, sections, accents) : c'est le
// rendu qui change, pas le contrat. Validé sur le test 5 s envoyé à Axel
// (montage-DYNAMIQUE-test5s.mp4) avant d'être généralisé ici.
//
// Règles seek-safe (hyperframes-animation) : timeline unique en pause, panneaux
// 2+ à opacity:0 révélés par GSAP, hard kill (tl.set autoAlpha:0) après chaque
// poussée, transforms uniquement (x/y/scale/rotation/autoAlpha/filter), aucun
// repeat infini, aucun Math.random — tout est déterministe.
// ─────────────────────────────────────────────────────────────────────────────

const r2 = (n) => Math.round(n * 100) / 100
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const DARK  = { bg: '#0D0D12', ink: '#F5F5F6', mute: '#8B8B94' }
const LIGHT = { bg: '#F5F5F7', ink: '#111114', mute: '#6E6E73' }
const ACC   = '#FF5A36'

// Largeur approx. d'un caractère en fraction de la font-size (Archivo Black est
// large). Sert à choisir une taille qui remplit le cadre SANS mesurer le DOM
// (interdit au moment du tween — on précalcule tout ici, côté Node).
const CHAR_W = 0.66
const fitSize = (text, maxW, lo = 64, hi = 200) =>
  Math.round(Math.min(hi, Math.max(lo, maxW / (CHAR_W * Math.max(1, String(text).length)))))

// ── 1 · SEGMENTATION : mots + slides → chaîne de panneaux contigus ──────────
function buildPanels(plan, D) {
  const words = (plan.captions || [])
    .filter((c) => String(c.text || '').trim())
    .map((c) => ({ text: String(c.text).trim(), start: r2(c.start), end: r2(Math.max(c.start + 0.08, c.end)), accent: !!c.accent }))
    .sort((a, b) => a.start - b.start)

  const anims = (plan.slides || [])
    .filter((s) => s.anim || s.type === 'punch')
    .map((s) => ({ kind: s.anim || 'punch', t0: r2(s.start), t1: r2(s.end ?? s.start + 2), slide: s }))
    .sort((a, b) => a.t0 - b.t0)

  const inAnim = (t) => anims.find((a) => t >= a.t0 - 0.06 && t < a.t1 - 0.06)

  // les mots pendant une slide illustrée deviennent son BANDEAU (petit défilé bas
  // de panneau) ; les autres forment les panneaux de typo cinétique
  for (const a of anims) a.strip = []
  const free = []
  for (const w of words) { const a = inAnim(w.start); if (a) a.strip.push(w); else free.push(w) }

  // phrases : coupure sur un silence > 0.45 s, ou panneau > 3.4 s, ou 7 mots
  const phrases = []
  let cur = []
  const flush = () => { if (cur.length) { phrases.push(cur); cur = [] } }
  for (const w of free) {
    const last = cur[cur.length - 1]
    if (last && (w.start - last.end > 0.45 || w.start - cur[0].start > 3.4 || cur.length >= 7)) flush()
    cur.push(w)
  }
  flush()

  const panels = [
    ...anims.map((a) => ({ kind: a.kind, t0: a.t0, t1: a.t1, slide: a.slide, strip: a.strip })),
    ...phrases.map((ws) => ({ kind: 'typo', t0: r2(Math.max(0, ws[0].start - 0.14)), t1: r2(ws[ws.length - 1].end + 0.3), words: ws })),
  ].sort((a, b) => a.t0 - b.t0)

  // chaîne CONTIGUË : chaque panneau tient jusqu'à l'arrivée du suivant — c'est la
  // poussée qui le sort, pas sa propre fin. Les micro-panneaux (<0.6 s) fusionnent.
  const out = []
  for (const p of panels) {
    const prev = out[out.length - 1]
    if (prev && p.t0 < prev.t0 + 0.6) {
      if (p.kind === 'typo' && prev.kind === 'typo') { prev.words.push(...(p.words || [])); continue }
      p.t0 = r2(prev.t0 + 0.6)
    }
    out.push(p)
  }
  if (!out.length) return out
  out[0].t0 = 0
  for (let i = 0; i < out.length; i++) out[i].t1 = r2(i < out.length - 1 ? out[i + 1].t0 : D)
  return out
}

// ── 2 · TYPO CINÉTIQUE : lignes contrastées (mots-clés géants) ──────────────
// Un accent = sa propre ligne, énorme (jusqu'à 5-6× les mots de liaison) : c'est
// LE contraste d'échelle des références. Les liaisons se groupent par 3 max.
function typoLines(ws) {
  // GARANTIE de contraste : si la phrase n'a aucun accent, on promeut son mot le
  // plus long — un panneau typo sans mot géant retombe dans le rendu « mot à mot »
  // plat qu'Axel a explicitement refusé.
  if (!ws.some((w) => w.accent || w.text.length >= 11)) {
    // le PREMIER mot substantiel, pas le plus long : promu en fin de phrase, le
    // panneau resterait vide en attendant son slam
    const pick = ws.find((w) => w.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 5)
      || ws.reduce((a, b) => (b.text.length > a.text.length ? b : a), ws[0])
    pick.accent = true
  }
  const lines = []
  let smalls = []
  const flush = () => { if (smalls.length) { lines.push({ big: false, words: smalls }); smalls = [] } }
  for (const w of ws) {
    if (w.accent || w.text.length >= 11) { flush(); lines.push({ big: true, words: [w] }) }
    else { smalls.push(w); if (smalls.length >= 3) flush() }
  }
  flush()
  return lines.slice(0, 5)
}

// ── 3 · GÉNÉRATION ──────────────────────────────────────────────────────────
export function buildDynamicComposition(plan, opts = {}) {
  const W = opts.width || 1080
  const H = opts.height || 1920
  const D = r2(Math.max(1, plan.duration))
  const logoFile = opts.logoFile || ''
  const panels = buildPanels(plan, D)
  const PUSH = 0.34                          // durée d'une poussée
  const DIRS = ['right', 'bottom', 'right', 'top']  // d'où ENTRE le panneau suivant

  const sectionLabel = (t) => {
    const s = (plan.sections || []).find((x) => t >= x.start - 0.05 && t < x.end)
    return s && s.label ? String(s.label).toUpperCase() : ''
  }

  let html = ''
  let js = ''
  const sfxAdd = []

  panels.forEach((p, i) => {
    const tone = i % 2 === 0 ? DARK : LIGHT
    const id = 'pn' + i
    const t0 = p.t0, t1 = p.t1, dur = r2(t1 - t0)
    const liveT0 = i === 0 ? 0 : r2(t0 + PUSH * 0.4)   // le contenu attaque pendant la poussée

    // — enveloppe du panneau (z-index croissant : le suivant recouvre en poussant)
    const edge = tone === LIGHT ? `<div style="position:absolute;left:0;top:0;width:22px;height:${H}px;background:${ACC}"></div>` : ''
    let inner = ''
    let pjs = ''

    // chip de section : chaque panneau se présente (rythme + repère)
    const lbl = sectionLabel(t0 + 0.1)
    if (lbl) {
      inner += `<div id="${id}lb" style="position:absolute;left:84px;top:300px;font-family:'JetBrains Mono',monospace;font-size:32px;letter-spacing:.24em;color:${ACC};opacity:0">${esc(lbl)}</div>`
      pjs += `\n  tl.fromTo('#${id}lb',{x:-140,opacity:0},{x:0,opacity:1,duration:0.36,ease:'expo.out'},${r2(liveT0 + 0.04)});`
    }

    if (p.kind === 'typo') {
      // ── panneau typo cinétique ──
      const lines = typoLines(p.words)
      const stack = []
      lines.forEach((ln, li) => {
        if (ln.big) {
          const w = ln.words[0]
          const fz = fitSize(w.text, W - 150, 84, 208)
          stack.push(`<div class="disp" id="${id}L${li}" style="font-size:${fz}px;color:${tone.ink};opacity:0;white-space:nowrap">${esc(w.text)}</div>`)
          // slam : échelle + flou, attaque dure — puis il ne se fige jamais (dérive propre)
          pjs += `\n  tl.fromTo('#${id}L${li}',{scale:1.6,opacity:0,filter:'blur(16px)'},{scale:1,opacity:1,filter:'blur(0px)',duration:0.44,ease:'power4.out'},${r2(Math.max(liveT0, w.start))});`
          pjs += `\n  tl.to('#${id}L${li}',{scale:1.05,duration:${r2(Math.max(0.3, t1 - w.start - 0.4))},ease:'none'},${r2(Math.max(liveT0, w.start) + 0.44)});`
        } else {
          const spans = ln.words.map((w, wi) => `<span id="${id}L${li}w${wi}" style="display:inline-block;margin:0 11px;opacity:0">${esc(w.text)}</span>`).join('')
          stack.push(`<div style="font-size:56px;font-weight:600;color:${tone.mute}">${spans}</div>`)
          // snap latéral, direction alternée par ligne — un mot = un temps voix
          const sx = li % 2 === 0 ? -240 : 240
          ln.words.forEach((w, wi) => {
            pjs += `\n  tl.fromTo('#${id}L${li}w${wi}',{x:${sx},opacity:0},{x:0,opacity:1,duration:0.3,ease:'expo.out'},${r2(Math.max(liveT0, w.start))});`
          })
        }
      })
      inner += `<div class="stack" id="${id}st">${stack.join('')}</div>`

    } else if (p.kind === 'countup') {
      // ── chiffre géant qui compte (proxy déterministe, jamais de random) ──
      const s = p.slide, val = parseInt(String(s.value || '0').replace(/\D/g, ''), 10) || 0
      inner += `<div class="stack">
        <div class="disp" id="${id}n" style="font-size:340px;color:${tone.ink};opacity:0">0</div>
        <div id="${id}u" style="font-family:'JetBrains Mono',monospace;font-size:44px;letter-spacing:.3em;color:${ACC};opacity:0">${esc(s.unit || '')}</div></div>`
      pjs += `
  var ${id}v = { n: 0 };
  tl.fromTo('#${id}n',{scale:0.8,opacity:0},{scale:1.14,opacity:1,duration:${r2(Math.min(1.2, dur - 0.6))},ease:'power2.out'},${liveT0});
  tl.to(${id}v,{n:${val},duration:${r2(Math.min(1.2, dur - 0.6))},ease:'power2.out',onUpdate:function(){var el=document.getElementById('${id}n');if(el)el.textContent=String(Math.round(${id}v.n));}},${liveT0});
  tl.fromTo('#${id}u',{y:50,opacity:0},{y:0,opacity:1,duration:0.34,ease:'circ.out'},${r2(liveT0 + 0.4)});
  tl.to('#${id}n',{scale:1.2,duration:${r2(Math.max(0.3, dur - 1.4))},ease:'none'},${r2(liveT0 + Math.min(1.2, dur - 0.6))});`
      sfxAdd.push({ kind: 'pop', t: r2(liveT0 + Math.min(1.2, dur - 0.6)) })

    } else if (p.kind === 'logo') {
      // ── wordmark géant qui TRAVERSE le cadre (la marque = le mouvement) ──
      const s = p.slide, mark = s.title || 'avatarads.fr'
      const fz = 186
      const tw = Math.round(fz * CHAR_W * mark.length)
      const xIn = Math.round(W * 0.3), xOut = Math.round(W - tw - W * 0.28)
      const logoImg = logoFile ? `<img id="${id}lg" src="${logoFile}" style="position:absolute;left:${(W - 150) / 2}px;top:560px;width:150px;height:150px;border-radius:34px;opacity:0" />` : ''
      inner += logoImg + `
        <div id="${id}tag" style="position:absolute;left:0;right:0;top:${logoFile ? 760 : 660}px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:36px;letter-spacing:.28em;color:${ACC};opacity:0">${esc((s.eyebrow || 'LE SITE').toUpperCase())}</div>
        <div class="disp" id="${id}mk" style="position:absolute;left:0;top:${logoFile ? 900 : 840}px;white-space:nowrap;font-size:${fz}px;color:${tone.ink};opacity:0">${esc(mark)}</div>
        <div id="${id}un" style="position:absolute;left:120px;top:${logoFile ? 1160 : 1100}px;width:${W - 240}px;height:16px;background:${ACC}"></div>`
      if (logoFile) pjs += `\n  tl.fromTo('#${id}lg',{scale:0,opacity:0,rotation:-12},{scale:1,opacity:1,rotation:0,duration:0.5,ease:'back.out(1.7)'},${r2(liveT0 + 0.05)});`
      pjs += `
  tl.fromTo('#${id}tag',{y:44,opacity:0},{y:0,opacity:1,duration:0.3,ease:'power3.out'},${r2(liveT0 + 0.16)});
  tl.fromTo('#${id}mk',{x:${Math.round(W * 0.85)},opacity:0,filter:'blur(14px)'},{x:${xIn},opacity:1,filter:'blur(0px)',duration:0.42,ease:'power3.out'},${r2(liveT0 + 0.06)});
  tl.to('#${id}mk',{x:${xOut},duration:${r2(Math.max(0.4, dur - 0.55))},ease:'none'},${r2(liveT0 + 0.5)});
  tl.fromTo('#${id}un',{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:0.34,ease:'power3.inOut'},${r2(liveT0 + 0.34)});`

    } else if (p.kind === 'screen') {
      // ── capture UI : carte qui glisse + caméra vers la zone nommée ──
      const s = p.slide
      const file = s.screen ? 'tuto/' + s.screen + '.png' : ''
      const cw = 1560, ch = Math.round(cw / 1.6)                 // captures 2880×1800
      const cx = Math.round((W - cw) / 2), cy = 470
      const z = Math.min(2.4, Math.max(1.2, s.screenZoom || 1.6))
      // même garde-fou que le fix anim-pack : la caméra ne sort pas de l'image
      const cl = (v) => Math.min(1 - 1 / (2 * z), Math.max(1 / (2 * z), v ?? 0.5))
      const tx = r2((0.5 - cl(s.screenX)) * z * cw), ty = r2((0.5 - cl(s.screenY)) * z * ch)
      const bw = Math.round((s.boxW || 0.2) * cw * 1.08), bh = Math.round((s.boxH || 0.1) * ch * 1.3)
      const bx = Math.round((s.boxX || 0.5) * cw - bw / 2), by = Math.round((s.boxY || 0.5) * ch - bh / 2)
      const chars = String(s.screenText || '')
      inner += `
        <div id="${id}cw" style="position:absolute;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;opacity:0">
          <div id="${id}cc" style="position:absolute;inset:0;border-radius:30px;overflow:hidden;box-shadow:0 50px 130px rgba(0,0,0,.35)">
            <div id="${id}ci" style="position:absolute;inset:0">
              <img src="${file}" style="position:absolute;left:0;top:0;width:${cw}px;height:${ch}px" />
              <div id="${id}bx" style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;border:5px solid ${ACC};border-radius:16px;opacity:0"></div>
            </div>
          </div>
        </div>` +
        (chars ? `<div id="${id}tp" style="position:absolute;left:130px;top:${cy + ch - 200}px;width:${W - 260}px;min-height:120px;background:${tone === DARK ? '#1A1A21' : '#FFFFFF'};border:2px solid ${tone === DARK ? '#2A2A33' : '#E3E3E8'};border-radius:26px;padding:30px 36px;box-sizing:border-box;font-size:37px;font-weight:500;line-height:1.4;color:${tone.ink};opacity:0">${chars.split('').map((c, ci) => `<span id="${id}ch${ci}" style="opacity:0">${esc(c)}</span>`).join('')}<span id="${id}cr" style="display:inline-block;width:4px;height:40px;background:${ACC};vertical-align:-6px"></span></div>` : '')
      pjs += `
  tl.fromTo('#${id}cw',{x:${Math.round(W * 0.7)},opacity:0,rotation:2},{x:0,opacity:1,rotation:0,duration:0.5,ease:'power3.out'},${liveT0});
  tl.fromTo('#${id}ci',{scale:1.02,x:0,y:0},{scale:${z},x:${tx},y:${ty},duration:${r2(Math.max(0.6, dur * 0.55))},ease:'power2.inOut'},${r2(liveT0 + 0.4)});
  tl.fromTo('#${id}bx',{scale:1.5,opacity:0},{scale:1,opacity:1,duration:0.4,ease:'back.out(1.6)'},${r2(liveT0 + 0.62)});
  tl.to('#${id}cw',{y:-26,duration:${r2(Math.max(0.4, dur - 0.5))},ease:'none'},${r2(liveT0 + 0.5)});`
      sfxAdd.push({ kind: 'click', t: r2(liveT0 + 0.62) })
      if (chars) {
        const tA = liveT0 + 0.55, tB = Math.max(tA + 0.8, t1 - 0.5)
        const step = r2((tB - tA) / Math.max(1, chars.length))
        pjs += `\n  tl.fromTo('#${id}tp',{y:60,opacity:0},{y:0,opacity:1,duration:0.36,ease:'power3.out'},${r2(tA - 0.1)});`
        chars.split('').forEach((c, ci) => { pjs += `\n  tl.set('#${id}ch${ci}',{opacity:1},${r2(tA + step * ci)});` })
      }

    } else if (p.kind === 'result') {
      // ── le RÉSULTAT : tirage photo + flash — la récompense ──
      const s = p.slide
      const file = s.screen ? 'tuto/' + s.screen + '.png' : ''
      const pw = 620, ph = 930
      inner += `
        <div id="${id}ph" style="position:absolute;left:${(W - pw) / 2}px;top:400px;width:${pw}px;height:${ph}px;background:#fff;border-radius:22px;padding:20px 20px 90px;box-sizing:border-box;box-shadow:0 60px 140px rgba(0,0,0,.4);opacity:0">
          <img src="${file}" style="width:100%;height:100%;object-fit:cover;border-radius:10px" />
          <div id="${id}ck" style="position:absolute;right:-28px;top:-28px;width:96px;height:96px;border-radius:50%;background:${ACC};display:flex;align-items:center;justify-content:center;opacity:0">
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
        </div>
        <div id="${id}fl" style="position:absolute;inset:0;background:#fff;opacity:0"></div>`
      pjs += `
  tl.fromTo('#${id}ph',{y:${H * 0.5},rotation:-7,opacity:0},{y:0,rotation:-3,opacity:1,duration:0.55,ease:'power4.out'},${liveT0});
  tl.fromTo('#${id}fl',{opacity:0},{opacity:0.85,duration:0.07,ease:'power1.in'},${r2(liveT0 + 0.5)});
  tl.to('#${id}fl',{opacity:0,duration:0.3,ease:'power2.out'},${r2(liveT0 + 0.57)});
  tl.fromTo('#${id}ck',{scale:0,opacity:0},{scale:1,opacity:1,duration:0.4,ease:'back.out(2)'},${r2(liveT0 + 0.66)});
  tl.to('#${id}ph',{rotation:-1.5,y:-24,duration:${r2(Math.max(0.4, dur - 0.7))},ease:'none'},${r2(liveT0 + 0.6)});`
      sfxAdd.push({ kind: 'flash', t: r2(liveT0 + 0.5) })

    } else if (p.kind === 'punch') {
      // ── phrase finale : slam + soulignement + respiration jusqu'au bout ──
      const s = p.slide
      const txt = (s.items && s.items[0] && s.items[0].text) || s.title || ''
      const tAt = Math.max(liveT0, (s.items && s.items[0] && s.items[0].t) || liveT0)
      const fz = fitSize(txt, W - 170, 66, 150)
      inner += `<div class="stack">
        <div id="${id}ey" style="font-family:'JetBrains Mono',monospace;font-size:34px;letter-spacing:.28em;color:${ACC};opacity:0">${esc((s.eyebrow || '').toUpperCase())}</div>
        <div class="disp" id="${id}tx" style="font-size:${fz}px;color:${tone.ink};text-align:center;line-height:1.06;opacity:0;max-width:${W - 140}px">${esc(txt)}</div>
        <div id="${id}un" style="width:420px;height:14px;background:${ACC}"></div></div>`
      const holdS = r2(tAt + 0.8), cycle = 1.4
      const reps = Math.max(0, Math.floor((t1 - holdS) / cycle) - 1)
      pjs += `
  tl.fromTo('#${id}ey',{y:40,opacity:0},{y:0,opacity:1,duration:0.3,ease:'power3.out'},${r2(liveT0 + 0.06)});
  tl.fromTo('#${id}tx',{scale:1.55,opacity:0,filter:'blur(16px)'},{scale:1,opacity:1,filter:'blur(0px)',duration:0.5,ease:'power4.out'},${r2(tAt)});
  tl.fromTo('#${id}un',{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:0.4,ease:'power3.inOut'},${r2(tAt + 0.34)});
  tl.to('#${id}tx',{scale:1.03,duration:${r2(cycle / 2)},ease:'sine.inOut',yoyo:true,repeat:${reps}},${holdS});`
      sfxAdd.push({ kind: 'pop', t: r2(tAt) })
    }

    // ── bandeau voix pendant les panneaux illustrés : le mot courant, en petit ──
    if (p.strip && p.strip.length) {
      // un mot DÉJÀ prononcé quand le panneau arrive est sauté — le clamper sur
      // liveT0 empilait deux mots au même instant (doublon fantôme vu au rendu)
      const strip = p.strip.filter((w) => w.end > liveT0 + 0.05)
      const spans = strip.map((w, wi) => `<span id="${id}sw${wi}" style="position:absolute;left:0;right:0;text-align:center;opacity:0">${esc(w.text)}</span>`).join('')
      inner += `<div style="position:absolute;left:0;right:0;top:${H - 430}px;height:70px;font-size:47px;font-weight:600;color:${tone.mute}">${spans}</div>`
      strip.forEach((w, wi) => {
        const tIn = Math.max(liveT0, w.start)
        const tOut = wi < strip.length - 1 ? Math.max(tIn + 0.1, strip[wi + 1].start) : Math.min(t1, w.end + 0.6)
        // l'entrée DOIT finir avant le set(opacity 0) : si le set tombe pendant le
        // tween, la fin du tween re-allume le mot qui reste alors collé à l'écran
        // (c'était le tas de mots fantômes superposés en bas des panneaux)
        const din = r2(Math.min(0.14, Math.max(0.06, tOut - tIn - 0.02)))
        pjs += `\n  tl.fromTo('#${id}sw${wi}',{y:26,opacity:0},{y:0,opacity:${w.accent ? 1 : 0.85},duration:${din},ease:'power2.out'},${r2(tIn)});`
        pjs += `\n  tl.set('#${id}sw${wi}',{opacity:0},${r2(tOut)});`
      })
    }

    // ── dérive ambiante : le panneau respire tant qu'il vit (jamais immobile) ──
    const drift = i % 2 === 0 ? { s: 1.045, y: -28 } : { s: 1.04, y: 22 }
    pjs += `\n  tl.fromTo('#${id}in',{scale:1,y:0},{scale:${drift.s},y:${drift.y},duration:${r2(Math.max(0.5, dur + PUSH))},ease:'none'},${t0});`

    html += `\n  <div id="${id}" class="pnl" style="z-index:${i + 1};background:${tone.bg};${i > 0 ? 'opacity:0' : ''}"><div class="pin" id="${id}in">${edge}${inner}</div></div>`

    // ── la POUSSÉE : le panneau entre et éjecte le précédent (jamais de fondu) ──
    if (i > 0) {
      const dir = DIRS[(i - 1) % DIRS.length]
      const from = dir === 'right' ? { x: W } : dir === 'bottom' ? { y: H } : dir === 'top' ? { y: -H } : { x: -W }
      const to = dir === 'right' ? { x: -W } : dir === 'bottom' ? { y: -H } : dir === 'top' ? { y: H } : { x: W }
      js += `
  tl.set('#${id}',{opacity:1},${t0});
  tl.fromTo('#${id}',${JSON.stringify(from)},{x:0,y:0,duration:${PUSH},ease:'power3.inOut'},${t0});
  tl.to('#pn${i - 1}',{${Object.entries(to).map(([k, v]) => `${k}:${v}`).join(',')},duration:${PUSH},ease:'power3.inOut'},${t0});
  tl.set('#pn${i - 1}',{autoAlpha:0},${r2(t0 + PUSH + 0.04)});`
      sfxAdd.push({ kind: 'whoosh', t: r2(Math.max(0, t0 - 0.06)) })
    }
    js += pjs
  })

  // bruitages du moteur → mixés par le worker (kind → assets/sfx/<kind>.mp3)
  plan.sfx = [...(plan.sfx || []).filter((x) => x && typeof x.t === 'number' && x.kind !== 'whoosh'), ...sfxAdd]
    .sort((a, b) => a.t - b.t)

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  body { margin:0; width:${W}px; height:${H}px; overflow:hidden; background:${DARK.bg}; font-family:'Inter',sans-serif; }
  .pnl { position:absolute; top:0; left:0; width:${W}px; height:${H}px; overflow:hidden; }
  .pin { position:absolute; inset:0; }
  .disp { font-family:'Archivo Black',sans-serif; letter-spacing:-.01em; }
  .stack { position:absolute; left:0; right:0; top:0; bottom:0; display:flex; flex-direction:column;
           justify-content:center; align-items:center; gap:30px; padding:0 70px; box-sizing:border-box; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-width="${W}" data-height="${H}" data-start="0" data-duration="${D}">${html}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${js}
window.__timelines['main'] = tl;
</script>
</body>
</html>`
}
