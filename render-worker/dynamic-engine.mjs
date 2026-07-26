// ─────────────────────────────────────────────────────────────────────────────
// MOTEUR « DYNAMIQUE » v2 (#147) — références @saasservices17 / @lemosthiagoo.
//
// v1 refusée par Axel : trop de texte, bruitages répétitifs et mal choisis,
// synchro flottante. La v2 applique sa grammaire :
//   · UNE SEULE CHOSE à l'écran par panneau (une phrase OU une scène UI)
//   · fonds DÉGRADÉS qui respirent (jamais d'aplat mort)
//   · les phrases courtes SE TAPENT (caret), les mots-clés SLAM — c'est tout
//   · scènes UI vectorielles (ui-scenes.mjs) câblées sur ses scripts : compte,
//     clé copiée, Claude connecté, import, silences coupés, un clic, choix…
//   · SON = ACTION : clic quand ça clique, succès quand ça valide, whoosh
//     seulement quand un panneau illustré pousse — jamais deux fois pareil
//     d'affilée, volumes bas, plafonné.
//
// Seek-safe : timeline unique en pause, panneaux 2+ opacity:0 révélés par GSAP,
// hard kill après chaque poussée, transforms/autoAlpha/filter uniquement,
// repeats finis, zéro random (blobs et ondes = sinus déterministes).
// ─────────────────────────────────────────────────────────────────────────────

import { uiScene } from './ui-scenes.mjs'

const r2 = (n) => Math.round(n * 100) / 100
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const DARK  = { bg: '#0E0E13', ink: '#F5F5F6', mute: '#8B8B94', dark: true }
const LIGHT = { bg: '#FFF7F2', ink: '#141418', mute: '#6E6E73', dark: false }
const ACC   = '#FF5A36'

// halos du fond : la « respiration » des références — de GROS dégradés radiaux
// qui dérivent lentement. Déterministes (position/phase par index de panneau).
const BLOBS = {
  light: ['#FFD3BC', '#FFC0CF', '#FFE7AE'],
  dark:  ['#2E1E33', '#33201B', '#182337'],
}

const CHAR_W = 0.66
const fitSize = (text, maxW, lo = 64, hi = 160) =>
  Math.round(Math.min(hi, Math.max(lo, maxW / (CHAR_W * Math.max(1, String(text).length)))))

// ── 1 · SEGMENTATION : slides + phrases → chaîne contiguë ───────────────────
function buildPanels(plan, D) {
  const words = (plan.captions || [])
    .filter((c) => String(c.text || '').trim())
    .map((c) => ({ text: String(c.text).trim(), start: r2(c.start), end: r2(Math.max(c.start + 0.08, c.end)), accent: !!c.accent }))
    .sort((a, b) => a.start - b.start)

  const anims = (plan.slides || [])
    .filter((s) => s.anim || s.type === 'punch')
    .map((s) => ({ kind: s.anim === 'ui' ? 'ui' : (s.anim || 'punch'), t0: r2(s.start), t1: r2(s.end ?? s.start + 2), slide: s }))
    .sort((a, b) => a.t0 - b.t0)

  const inAnim = (t) => anims.some((a) => t >= a.t0 - 0.06 && t < a.t1 - 0.06)
  const free = words.filter((w) => !inAnim(w.start))

  // découpe en phrases : au silence, ou À LA PONCTUATION dès que la clause est
  // assez longue — jamais en plein milieu d'une proposition (les « phrases
  // coupées où on ne comprend rien » venaient des caps bruts 8 mots / 3.4 s)
  const phrases = []
  let cur = []
  const flush = () => { if (cur.length) { phrases.push(cur); cur = [] } }
  const endsClause = (w) => /[.,!?…]$/.test(w.text)
  for (const w of free) {
    const last = cur[cur.length - 1]
    if (last && (
      w.start - last.end > 0.55 ||
      (endsClause(last) && cur.length >= 4) ||
      w.start - cur[0].start > 4.2 ||
      cur.length >= 10
    )) flush()
    cur.push(w)
  }
  flush()

  // SEULES les phrases avec un mot-clé deviennent un panneau. Les phrases de
  // liaison tapées à l'écran étaient exactement « les trucs typiques » qu'Axel a
  // refusés (7 captures) : la voix les porte, la scène précédente respire, point.
  const panels = [
    ...anims.map((a) => ({ kind: a.kind, t0: a.t0, t1: a.t1, slide: a.slide })),
    ...phrases
      .filter((ws) => ws.some((w) => w.accent || w.text.length >= 11))
      .map((ws) => ({ kind: 'typo', t0: r2(Math.max(0, ws[0].start - 0.12)), t1: r2(ws[ws.length - 1].end + 0.3), words: ws })),
  ].sort((a, b) => a.t0 - b.t0)

  const out = []
  for (const p of panels) {
    const prev = out[out.length - 1]
    if (prev && p.t0 < prev.t0 + 0.6) {
      if (p.kind === 'typo' && prev.kind === 'typo') { prev.words.push(...(p.words || [])); continue }
      // une phrase coincée contre une scène : on ne la JETTE plus (ça amputait la
      // fin des phrases) — on la garde si elle a de la matière et de la place
      if (p.kind === 'typo' && ((p.words || []).length <= 2 || p.t1 - (prev.t0 + 0.6) < 0.5)) continue
      p.t0 = r2(prev.t0 + 0.6)
    }
    out.push(p)
  }
  if (!out.length) return out
  out[0].t0 = 0
  for (let i = 0; i < out.length; i++) out[i].t1 = r2(i < out.length - 1 ? out[i + 1].t0 : D)

  // FUSION des scènes courtes voisines : deux panneaux de <1.35 s qui se poussent
  // à la chaîne, « on n'a même pas le temps de voir que ça change déjà » (Axel).
  // Elles partagent désormais UN panneau (même fond) avec un relais interne doux.
  const merged = []
  const shortish = (x) => (x.t1 - x.t0) < 1.35 && (x.kind === 'ui' || x.kind === 'screen')
  for (const p of out) {
    const prev = merged[merged.length - 1]
    if (prev && shortish(p) && (prev.kind === 'multi' || shortish(prev)) && p.t1 - (prev.kind === 'multi' ? prev.subs[0].t0 : prev.t0) < 4.2) {
      if (prev.kind !== 'multi') merged[merged.length - 1] = { kind: 'multi', t0: prev.t0, t1: p.t1, subs: [prev, p] }
      else { prev.subs.push(p); prev.t1 = p.t1 }
      continue
    }
    merged.push(p)
  }
  return merged
}

// ── 2 · CONTENU D'UN PANNEAU TYPO : une seule déclaration ───────────────────
// Accent présent → LE mot en slam (et rien d'autre, ou 2 mots de contexte au-
// dessus). Pas d'accent → la phrase courte se TAPE au centre, caret orange.
function typoContent(id, p, tone, liveT0) {
  const ws = p.words
  const accIdx = ws.findIndex((w) => w.accent || w.text.length >= 11)
  if (accIdx < 0) return { html: '', js: '', sfx: [] }   // sans mot-clé, pas de texte
  const acc = ws[accIdx]
  // le VERBE juste avant (1 mot max) + LE MOT — jamais de fragment de fin de
  // phrase en dessous (« et je » orphelin = incompréhensible, retour d'Axel)
  const before = accIdx > 0 ? ws[accIdx - 1].text : ''
  const fz = fitSize(acc.text, 900, 84, 168)
  const tAt = Math.max(liveT0, acc.start)
  const html = `<div class="stack">
      ${before ? `<div id="${id}b4" style="font-size:54px;font-weight:600;color:${tone.mute};opacity:0">${esc(before)}</div>` : ''}
      <div class="disp" id="${id}acc" style="font-size:${fz}px;color:${tone.ink};opacity:0;white-space:nowrap">${esc(acc.text)}</div>
    </div>`
  let js = ''
  if (before) js += `\n  tl.fromTo('#${id}b4',{y:-46,opacity:0},{y:0,opacity:1,duration:0.32,ease:'power3.out'},${r2(Math.max(liveT0, ws[accIdx - 1].start))});`
  js += `\n  tl.fromTo('#${id}acc',{scale:1.5,opacity:0,filter:'blur(14px)'},{scale:1,opacity:1,filter:'blur(0px)',duration:0.42,ease:'power4.out'},${r2(tAt)});`
  js += `\n  tl.to('#${id}acc',{scale:1.05,duration:${r2(Math.max(0.3, p.t1 - tAt - 0.45))},ease:'none'},${r2(tAt + 0.42)});`
  return { html, js, sfx: [{ kind: 'snap', t: r2(tAt), vol: 0.45 }] }
}

// capture d'app : ENTIÈRE et CENTRÉE (Axel : « les frames sont coupées, on doit
// bien voir la page ») — elle tient dans la largeur, la caméra ne fait qu'un
// léger travelling vers la zone nommée, sans jamais sortir du cadre
function screenContent(id, s, tone, liveT0, t1, W) {
  const file = s.screen ? 'tuto/' + s.screen + '.png' : ''
  const dur = r2(t1 - liveT0)
  const cw = 980, ch = Math.round(cw / 1.6)
  const cx = Math.round((W - cw) / 2), cy = 620
  const z = Math.min(1.45, Math.max(1.1, (s.screenZoom || 1.6) * 0.75))
  const cl = (v) => Math.min(1 - 1 / (2 * z), Math.max(1 / (2 * z), v ?? 0.5))
  const tx = r2((0.5 - cl(s.screenX)) * z * cw), ty = r2((0.5 - cl(s.screenY)) * z * ch)
  const bw = Math.round((s.boxW || 0.2) * cw * 1.08), bh = Math.round((s.boxH || 0.1) * ch * 1.3)
  const bx = Math.round((s.boxX || 0.5) * cw - bw / 2), by = Math.round((s.boxY || 0.5) * ch - bh / 2)
  const html = `
        <div id="${id}cw" style="position:absolute;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;opacity:0">
          <div style="position:absolute;inset:0;border-radius:26px;overflow:hidden;box-shadow:0 46px 120px rgba(13,13,18,.4)">
            <div id="${id}ci" style="position:absolute;inset:0">
              <img src="${file}" style="position:absolute;left:0;top:0;width:${cw}px;height:${ch}px" />
              <div id="${id}bx" style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;border:4px solid ${ACC};border-radius:14px;opacity:0"></div>
            </div>
          </div>
        </div>`
  const js = `
  tl.fromTo('#${id}cw',{y:220,opacity:0,scale:0.94},{y:0,opacity:1,scale:1,duration:0.48,ease:'power3.out'},${liveT0});
  tl.fromTo('#${id}ci',{scale:1,x:0,y:0},{scale:${z},x:${tx},y:${ty},duration:${r2(Math.max(0.5, dur * 0.65))},ease:'power2.inOut'},${r2(liveT0 + 0.35)});
  tl.fromTo('#${id}bx',{scale:1.5,opacity:0},{scale:1,opacity:1,duration:0.36,ease:'back.out(1.6)'},${r2(liveT0 + 0.55)});
  tl.to('#${id}cw',{y:-20,duration:${r2(Math.max(0.4, dur - 0.5))},ease:'none'},${r2(liveT0 + 0.5)});`
  return { html, js, sfx: [{ kind: 'mouse-click', t: r2(liveT0 + 0.55), vol: 0.7 }] }
}

// ── 3 · GÉNÉRATION ──────────────────────────────────────────────────────────
export function buildDynamicComposition(plan, opts = {}) {
  const W = opts.width || 1080
  const H = opts.height || 1920
  const D = r2(Math.max(1, plan.duration))
  const logoFile = opts.logoFile || ''
  const panels = buildPanels(plan, D)
  const PUSH = 0.42
  const DIRS = ['right', 'bottom', 'right', 'top']

  let html = ''
  let js = ''
  const sfxAdd = []
  const kbAdd = []
  let lastWhoosh = 0, whooshFlip = false

  panels.forEach((p, i) => {
    const tone = i % 2 === 0 ? DARK : LIGHT
    const blobs = i % 2 === 0 ? BLOBS.dark : BLOBS.light
    const id = 'pn' + i
    const t0 = p.t0, t1 = p.t1, dur = r2(t1 - t0)
    const liveT0 = i === 0 ? 0.05 : r2(t0 + 0.12)

    // — fond : 3 halos radiaux qui dérivent (phases décalées par index, sinus figé)
    let inner = ''
    let pjs = ''
    const ph = (k) => ((i * 3 + k) % 5) - 2      // -2..2 : variation déterministe
    for (let k = 0; k < 3; k++) {
      const bx = [W * 0.15, W * 0.85, W * 0.5][k] + ph(k) * 60
      const by = [H * 0.22, H * 0.55, H * 0.9][k] + ph(k) * 90
      const sz = [1500, 1300, 1600][k]
      inner += `<div id="${id}g${k}" style="position:absolute;left:${Math.round(bx - sz / 2)}px;top:${Math.round(by - sz / 2)}px;width:${sz}px;height:${sz}px;background:radial-gradient(circle,${blobs[k]}${tone === DARK ? 'CC' : ''} 0%,transparent 62%);"></div>`
      pjs += `\n  tl.fromTo('#${id}g${k}',{x:${ph(k) * 40},y:${ph(k) * 30},scale:1},{x:${-ph(k) * 60 - 30},y:${ph(k) * -70 + 20},scale:1.12,duration:${r2(dur + PUSH + 0.3)},ease:'sine.inOut'},${t0});`
    }

    // — contenu par type
    if (p.kind === 'typo') {
      const c = typoContent(id, p, tone, liveT0)
      inner += c.html; pjs += c.js; sfxAdd.push(...c.sfx)

    } else if (p.kind === 'ui') {
      const sc = uiScene(p.slide.ui, id, liveT0, t1, tone, p.slide)
      if (sc) {
        inner += sc.html; pjs += sc.js
        sfxAdd.push(...(sc.sfx || []))
        kbAdd.push(...(sc.keyboard || []))
      }

    } else if (p.kind === 'countup') {
      const s = p.slide, val = parseInt(String(s.value || '0').replace(/\D/g, ''), 10) || 0
      inner += `<div class="stack">
        <div class="disp" id="${id}n" style="font-size:330px;color:${tone.ink};opacity:0">0</div>
        <div id="${id}u" style="font-family:'JetBrains Mono',monospace;font-size:44px;letter-spacing:.3em;color:${ACC};opacity:0">${esc(s.unit || '')}</div></div>`
      pjs += `
  var ${id}v = { n: 0 };
  tl.fromTo('#${id}n',{scale:0.8,opacity:0},{scale:1.12,opacity:1,duration:${r2(Math.min(1.2, dur - 0.6))},ease:'power2.out'},${liveT0});
  tl.to(${id}v,{n:${val},duration:${r2(Math.min(1.2, dur - 0.6))},ease:'power2.out',onUpdate:function(){var el=document.getElementById('${id}n');if(el)el.textContent=String(Math.round(${id}v.n));}},${liveT0});
  tl.fromTo('#${id}u',{y:50,opacity:0},{y:0,opacity:1,duration:0.34,ease:'circ.out'},${r2(liveT0 + 0.4)});
  tl.to('#${id}n',{scale:1.18,duration:${r2(Math.max(0.3, dur - 1.4))},ease:'none'},${r2(liveT0 + Math.min(1.2, dur - 0.6))});`

    } else if (p.kind === 'logo') {
      const s = p.slide, mark = s.title || 'avatarads.fr'
      const fz = 178
      const tw = Math.round(fz * CHAR_W * mark.length)
      const logoImg = logoFile ? `<img id="${id}lg" src="${logoFile}" style="position:absolute;left:${(W - 150) / 2}px;top:600px;width:150px;height:150px;border-radius:34px;opacity:0" />` : ''
      inner += logoImg + `
        <div class="disp" id="${id}mk" style="position:absolute;left:0;top:${logoFile ? 880 : 850}px;white-space:nowrap;font-size:${fz}px;color:${tone.ink};opacity:0">${esc(mark)}</div>
        <div id="${id}un" style="position:absolute;left:120px;top:${logoFile ? 1130 : 1100}px;width:${W - 240}px;height:14px;background:${ACC}"></div>`
      if (logoFile) pjs += `\n  tl.fromTo('#${id}lg',{scale:0,opacity:0,rotation:-12},{scale:1,opacity:1,rotation:0,duration:0.5,ease:'back.out(1.7)'},${r2(liveT0 + 0.05)});`
      pjs += `
  tl.fromTo('#${id}mk',{x:${Math.round(W * 0.85)},opacity:0,filter:'blur(12px)'},{x:${Math.round(W * 0.28)},opacity:1,filter:'blur(0px)',duration:0.44,ease:'power3.out'},${r2(liveT0 + 0.05)});
  tl.to('#${id}mk',{x:${Math.round(W - tw - W * 0.26)},duration:${r2(Math.max(0.4, dur - 0.6))},ease:'none'},${r2(liveT0 + 0.55)});
  tl.fromTo('#${id}un',{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:0.34,ease:'power3.inOut'},${r2(liveT0 + 0.36)});`

    } else if (p.kind === 'screen') {
      const sc = screenContent(id, p.slide, tone, liveT0, t1, W)
      inner += sc.html; pjs += sc.js; sfxAdd.push(...sc.sfx)

    } else if (p.kind === 'multi') {
      // plusieurs actions courtes dans UN panneau : relais interne doux (l'ancien
      // contenu monte et s'efface, le nouveau monte à sa place) au lieu d'une
      // poussée plein cadre toutes les secondes
      p.subs.forEach((sub, k) => {
        const sid = id + 's' + k
        const subLive = k === 0 ? liveT0 : r2(sub.t0 + 0.06)
        const sc = sub.kind === 'screen'
          ? screenContent(sid, sub.slide, tone, subLive, sub.t1, W)
          : uiScene(sub.slide.ui, sid, subLive, sub.t1, tone, sub.slide)
        if (!sc) return
        inner += `<div id="${sid}wr" style="position:absolute;inset:0;${k > 0 ? 'opacity:0' : ''}">${sc.html}</div>`
        pjs += sc.js
        sfxAdd.push(...(sc.sfx || [])); kbAdd.push(...(sc.keyboard || []))
        if (k > 0) {
          pjs += `
  tl.to('#${id}s${k - 1}wr',{y:-140,autoAlpha:0,duration:0.3,ease:'power2.inOut'},${r2(sub.t0 - 0.06)});
  tl.fromTo('#${sid}wr',{y:150,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'power3.out'},${r2(sub.t0)});`
        }
      })

    } else if (p.kind === 'result') {
      const s = p.slide
      const sc = uiScene('phone', id, liveT0, t1, tone, s)
      if (sc) { inner += sc.html; pjs += sc.js }

    } else if (p.kind === 'punch') {
      // CTA redessiné : le verbe en haut, LE MOT à taper en géant, et la barre de
      // commentaire TikTok qui le tape puis l'envoie — on montre le geste demandé
      const s = p.slide
      const txt = (s.items && s.items[0] && s.items[0].text) || s.title || ''
      const tAt = Math.max(liveT0, (s.items && s.items[0] && s.items[0].t) || liveT0)
      const m = txt.match(/^(\S+)\s+(.+)$/)                   // « Commente » + « Avatar »
      const verb = m ? m[1] : '', word = m ? m[2] : txt
      const kw = word.replace(/[«»\s]/g, '') || 'Avatar'
      const fz = fitSize(word, W - 170, 84, 150)
      inner += `
        <div id="${id}vb" style="position:absolute;left:0;right:0;top:640px;text-align:center;font-size:56px;font-weight:600;color:${tone.mute};opacity:0">${esc(verb)}</div>
        <div class="disp" id="${id}tx" style="position:absolute;left:0;right:0;top:730px;text-align:center;font-size:${fz}px;color:${tone.ink};line-height:1.06;opacity:0">${esc(word)}</div>`
      pjs += `
  tl.fromTo('#${id}vb',{y:-40,opacity:0},{y:0,opacity:1,duration:0.32,ease:'power3.out'},${r2(Math.max(liveT0, tAt - 0.15))});
  tl.fromTo('#${id}tx',{scale:1.5,opacity:0,filter:'blur(14px)'},{scale:1,opacity:1,filter:'blur(0px)',duration:0.48,ease:'power4.out'},${r2(tAt)});
  tl.to('#${id}tx',{scale:1.04,duration:${r2(Math.max(0.4, (t1 - tAt - 0.5) / 2))},ease:'sine.inOut',yoyo:true,repeat:1},${r2(tAt + 0.55)});`
      const sc = uiScene('comment', id, r2(tAt + 0.45), t1, tone, { word: kw })
      if (sc) { inner += sc.html; pjs += sc.js; sfxAdd.push(...(sc.sfx || [])) }
      sfxAdd.push({ kind: 'pop', t: r2(tAt), vol: 0.6 })
    }

    html += `\n  <div id="${id}" class="pnl" style="z-index:${i + 1};background:${tone.bg};${i > 0 ? 'opacity:0' : ''}"><div class="pin" id="${id}in">${inner}</div></div>`

    // — poussée : direction alternée, l'entrant arrive légèrement flouté par sa
    //   vitesse et se pose ; whoosh SEULEMENT sur les panneaux illustrés, en
    //   alternant deux échantillons, à volume discret, jamais deux en <2.5s
    if (i > 0) {
      const dir = DIRS[(i - 1) % DIRS.length]
      const from = dir === 'right' ? { x: W } : dir === 'bottom' ? { y: H } : dir === 'top' ? { y: -H } : { x: -W }
      const to = dir === 'right' ? { x: -W } : dir === 'bottom' ? { y: -H } : dir === 'top' ? { y: H } : { x: W }
      js += `
  tl.set('#${id}',{opacity:1},${t0});
  tl.fromTo('#${id}',${JSON.stringify(from)},{x:0,y:0,duration:${PUSH},ease:'power2.inOut'},${t0});
  tl.fromTo('#${id}in',{filter:'blur(7px)'},{filter:'blur(0px)',duration:${r2(PUSH + 0.1)},ease:'power2.out'},${t0});
  tl.to('#pn${i - 1}',{${Object.entries(to).map(([k, v]) => `${k}:${v}`).join(',')},duration:${PUSH},ease:'power2.inOut'},${t0});
  tl.set('#pn${i - 1}',{autoAlpha:0},${r2(t0 + PUSH + 0.04)});`
      if (p.kind !== 'typo' && t0 - lastWhoosh > 2.5) {
        sfxAdd.push({ kind: whooshFlip ? 'woosh' : 'whoosh', t: r2(Math.max(0, t0 - 0.05)), vol: 0.42 })
        lastWhoosh = t0; whooshFlip = !whooshFlip
      }
    }
    js += pjs
  })

  // — piste sonore finale : tri, anti-répétition (même son < 2s : on saute),
  //   anti-collision (deux sons < 0.22s : le premier gagne), plafond global
  const lastByKind = {}
  let lastT = -9
  const sfxOut = []
  // un CLIC peut légitimement se répéter vite (deux choix à 1s d'écart) ; c'est
  // le whoosh répété qui lasse — fenêtres anti-répétition par famille
  const minGap = (k) => (k === 'mouse-click' ? 0.6 : k === 'whoosh' || k === 'woosh' ? 2.5 : 2)
  // LE BON SON POUR LA SCÈNE (chaque scène déclare le sien : clic pour un bouton,
  // ding pour un envoi, obturateur pour une photo, tic-tac pour le chrono…) — et
  // si le même son devait rejouer trop vite, on le remplace par son jumeau au
  // lieu de marteler l'identique (retour d'Axel : « varier, pas toujours le même »)
  // fenêtre d'ÉCHANGE (2.4s) : le même son qui reviendrait vite devient son jumeau,
  // puis le jumeau du jumeau — quatre clics de suite deviennent clic/click/obturateur.
  // fenêtre de COUPE (minGap) : en dessous, on saute carrément.
  const TWIN = { 'mouse-click': 'click', click: 'camera-click', 'camera-click': 'mouse-click', pop: 'snap', snap: 'pop', ding: 'success', success: 'ding' }
  for (const s of sfxAdd.sort((a, b) => a.t - b.t)) {
    for (let k = 0; k < 2 && lastByKind[s.kind] != null && s.t - lastByKind[s.kind] < 2.4 && TWIN[s.kind]; k++) s.kind = TWIN[s.kind]
    if (lastByKind[s.kind] != null && s.t - lastByKind[s.kind] < minGap(s.kind)) continue
    if (s.t - lastT < 0.2) continue
    lastByKind[s.kind] = s.t; lastT = s.t
    sfxOut.push(s)
    if (sfxOut.length >= 22) break
  }
  plan.sfx = sfxOut
  if (kbAdd.length) plan.keyboard = [...(plan.keyboard || []), ...kbAdd]

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
           justify-content:center; align-items:center; gap:34px; padding:0 70px; box-sizing:border-box; }
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
