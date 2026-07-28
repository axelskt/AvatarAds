// anim-pack.mjs — #135 · animations fabriquées à la demande du chef d'orchestre.
//
// Une capture d'écran ne montre pas un CONCEPT : le bouton « Split Screen » ne dit
// pas à quoi ressemble un split screen. Ces animations, elles, montrent l'idée —
// et coûtent zéro crédit, se rendent instantanément et sont déterministes.
//
// Le chef d'orchestre écrit `anim: "split"` sur une scène quand il estime qu'une
// animation illustre mieux que n'importe quelle image. Elle prend alors toute la
// zone visuelle, au-dessus de la bande du sous-titre.

import { SAFE, SAFE_CENTERED_W, WORD_SHAPES, SANS } from './visual-styles.mjs'

// Emojis 3D utilisés par les scènes ci-dessous — exporté pour que le worker n'embarque
// dans le projet de rendu que les fichiers réellement nécessaires.
export const ANIM_EMOJI_SET = {
  money: ['money_bag', 'coin', 'dollar_banknote'],
  idea: ['light_bulb', 'brain'],
  target: ['direct_hit'],
  lock: ['locked', 'key'],
  search: ['magnifying_glass_tilted_left', 'eyes'],
  rocket: ['rocket', 'fire'],
  network: ['busts_in_silhouette', 'link'],
  check: ['check_mark_button', 'hundred_points'],
}

// La liste vient de anim-bank.mjs, seule source de vérité : cette constante
// avait divergé de celle de l'orchestrateur (sign/tools/post ajoutées ici,
// jamais déclarées là-bas — le modèle ne pouvait donc pas les demander).
export { ANIM_NAMES as ANIMS } from './anim-bank.mjs'
import { ANIM_NAMES as ANIMS } from './anim-bank.mjs'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Palette : sombre sur clair pour les styles page blanche, l'inverse sinon.
export function animPalette(vs) {
  const light = vs === 'word' || vs === 'apple' || vs === 'editorial'
  return {
    ink: light ? '#111111' : '#FFFFFF',
    soft: light ? 'rgba(17,17,17,.10)' : 'rgba(255,255,255,.14)',
    line: light ? 'rgba(17,17,17,.20)' : 'rgba(255,255,255,.28)',
    // apple gardait le bleu iOS — mais l'accent de la marque est orange, et
    // TOUTES les captures d'application le sont : deux animations sur trois
    // viraient au bleu à côté d'un cadre de sélection orange. La signature Apple
    // vient des fonds clairs, des dégradés et de la typo, pas de son bleu.
    acc: vs === 'apple' ? '#FF5A36' : vs === 'editorial' ? '#111111' : WORD_SHAPES[0],
    acc2: vs === 'apple' ? '#6E6E73' : WORD_SHAPES[1],
  }
}

// Cadre de travail : centré, dans la zone sûre, au-dessus du sous-titre.
// LE SOLEIL DE CLAUDE, DESSINÉ — pour les PETITES tailles uniquement (la barre
// de prompt, 46 px : le lettrage du vrai logo y serait illisible). Les tuiles,
// elles, portent le vrai fichier `tuto/logo-claude.png` fourni par Axel.
// Onze lames effilées qui convergent au centre,
// bouts arrondis — sa marque, pas le mot « Claude » écrit en gras. Partagé avec
// les scènes UI (la barre de prompt le porte, pour qu'on reconnaisse SON champ).
// Un disque au centre en ferait une marguerite : les lames partent du point.
export const claudeBurst = (size = '58%', color = '#D97757') => {
  const rays = Array.from({ length: 11 }, (_, k) =>
    `<path d="M0 2.2 L-2.6 22.8 A2.6 2.6 0 0 0 2.6 22.8 Z" transform="rotate(${((360 / 11) * k).toFixed(1)})"/>`).join('')
  return `<svg viewBox="-28 -28 56 56" width="${size}" height="${size}" fill="${color}">${rays}</svg>`
}

function frame(W, H) {
  const w = Math.round(W * SAFE_CENTERED_W)
  // borné à 44 % de la hauteur : en dessous commence la bande du sous-titre
  const y = Math.round(H * (SAFE.top + 0.03))
  const h = Math.round(H * 0.44) - y
  return { w, h, x: Math.round((W - w) / 2), y }
}

export function animHtml(name, s, W, H, vs) {
  const P = animPalette(vs)
  const f = frame(W, H)
  const id = s.id
  const box = (inner) => `<div class="an" id="${id}an" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px">${inner}</div>`
  const items = (s.items || []).map((it) => String(it.text || '')).filter(Boolean)

  switch (name) {
    case 'split': {
      // Un vrai écran vertical qui se coupe en deux, avec deux contenus distincts :
      // deux rectangles qui glissent ne montrent pas un split screen, ils le suggèrent.
      const pw = Math.round(f.h * 0.54), ph = f.h, px = Math.round((f.w - pw) / 2)
      const half = Math.round((ph - 10) / 2), r = Math.round(pw * 0.13)
      const head = (top, col) => `<span style="position:absolute;left:${Math.round(pw * 0.16)}px;top:${top}px;width:${Math.round(pw * 0.24)}px;height:${Math.round(pw * 0.24)}px;border-radius:50%;background:${col}"></span>`
      const lines = (top, col, n) => Array.from({ length: n }, (_, k) =>
        `<span style="position:absolute;left:${Math.round(pw * 0.16)}px;top:${top + k * Math.round(pw * 0.14)}px;width:${Math.round(pw * (0.56 - k * 0.12))}px;height:${Math.round(pw * 0.06)}px;border-radius:99px;background:${col}"></span>`).join('')
      return box(`<div class="an-ph" id="${id}ph" style="left:${px}px;top:0;width:${pw}px;height:${ph}px;border:3px solid ${P.line};border-radius:${r}px;overflow:hidden">
        <span class="an-p" id="${id}p1" style="left:0;top:0;width:100%;height:${half}px;background:${P.acc}">${head(Math.round(half * 0.22), 'rgba(255,255,255,.75)')}${lines(Math.round(half * 0.62), 'rgba(255,255,255,.6)', 2)}</span>
        <span class="an-p" id="${id}p2" style="left:0;top:${half + 10}px;width:100%;height:${half}px;background:${P.soft}">${head(Math.round(half * 0.22), P.line)}${lines(Math.round(half * 0.62), P.line, 2)}</span>
        <span class="an-p" id="${id}sep" style="left:0;top:${half}px;width:100%;height:10px;background:${P.ink}"></span>
      </div>`)
    }
    case 'voice': {
      // une onde qui se dédouble : la voix clonée
      const n = 22, bw = Math.round(f.w / (n * 1.9)), gap = Math.round(f.w / n)
      const bar = (k, cls, col, top) => {
        const hgt = Math.round(f.h * 0.12 + Math.abs(Math.sin(k * 0.9)) * f.h * 0.26)
        return `<span class="an-b ${cls}" id="${id}${cls}${k}" style="left:${k * gap}px;top:${top - hgt / 2}px;width:${bw}px;height:${hgt}px;background:${col};border-radius:99px"></span>`
      }
      // un micro à gauche : l'onde SORT de quelque chose, elle ne flotte pas
      const mw = Math.round(f.h * 0.2)
      let h = `<span class="an-p" id="${id}mic" style="left:0;top:${Math.round(f.h / 2 - mw * 0.9)}px;width:${mw}px;height:${Math.round(mw * 1.5)}px;border-radius:99px;background:${P.ink}"></span>` +
        `<span class="an-p" style="left:${Math.round(mw * 0.42)}px;top:${Math.round(f.h / 2 + mw * 0.6)}px;width:${Math.round(mw * 0.16)}px;height:${Math.round(mw * 0.5)}px;background:${P.ink}"></span>`
      for (let k = 2; k < n; k++) h += bar(k, 'w1', P.ink, Math.round(f.h * 0.32))
      for (let k = 2; k < n; k++) h += bar(k, 'w2', P.acc, Math.round(f.h * 0.7))
      return box(h)
    }
    case 'list': {
      // Des CARTES de script empilées, avec un titre et deux lignes de texte :
      // des rectangles gris ne disent pas « une bibliothèque de scripts ».
      const rows = 4, rh = Math.round(f.h / rows) - 8, cw = Math.round(f.w * 0.62)
      const cx = Math.round((f.w - cw) / 2)
      let h = ''
      for (let k = 0; k < rows; k++) {
        const on = k === 1
        const pad = Math.round(rh * 0.22)
        h += `<span class="an-r" id="${id}r${k}" style="left:${cx + (k % 2 ? 10 : 0)}px;top:${k * (rh + 8)}px;width:${cw}px;height:${rh}px;` +
          `background:${on ? P.acc : P.soft};border:1px solid ${on ? 'transparent' : P.line};border-radius:${Math.round(rh * 0.22)}px">` +
          `<span style="position:absolute;left:${pad}px;top:${pad}px;width:${Math.round(cw * 0.34)}px;height:${Math.round(rh * 0.16)}px;border-radius:99px;background:${on ? 'rgba(255,255,255,.9)' : P.line}"></span>` +
          `<span style="position:absolute;left:${pad}px;top:${Math.round(pad * 2.1)}px;width:${Math.round(cw * 0.66)}px;height:${Math.round(rh * 0.11)}px;border-radius:99px;background:${on ? 'rgba(255,255,255,.55)' : P.soft}"></span>` +
          `<span style="position:absolute;left:${pad}px;top:${Math.round(pad * 3.0)}px;width:${Math.round(cw * 0.48)}px;height:${Math.round(rh * 0.11)}px;border-radius:99px;background:${on ? 'rgba(255,255,255,.4)' : P.soft}"></span>` +
          `</span>`
      }
      return box(h)
    }
    case 'grow': {
      // des barres qui montent : une croissance, des vues qui décollent
      const n = 6, bw = Math.round(f.w / (n * 1.6)), gap = Math.round(f.w / n)
      let h = ''
      for (let k = 0; k < n; k++) {
        const hgt = Math.round(f.h * (0.18 + (k / (n - 1)) * 0.8))
        h += `<span class="an-g" id="${id}g${k}" style="left:${k * gap}px;top:${f.h - hgt}px;width:${bw}px;height:${hgt}px;background:${k === n - 1 ? P.acc : P.soft};border-radius:${Math.round(bw * 0.22)}px;transform-origin:50% 100%"></span>`
      }
      return box(h)
    }
    case 'compare': {
      const cw = Math.round(f.w * 0.44), ch = f.h
      const rd = Math.round(cw * 0.12)
      // AVEC un visage (s.photo), on montre la VRAIE différence : la même image
      // dégradée/glitchée à gauche, nette à droite. Axel : « quand je dis fake ça
      // met ça » — deux rectangles de couleur ne veulent rien dire.
      if (s.photo) {
        const src = `tuto/${s.photo}.png`
        const badge = (ok) => `<span style="position:absolute;right:${Math.round(cw * 0.07)}px;top:${Math.round(cw * 0.07)}px;width:${Math.round(cw * 0.24)}px;height:${Math.round(cw * 0.24)}px;border-radius:50%;background:${ok ? '#22C55E' : '#FF3B30'};display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px rgba(0,0,0,.4)">
          <svg viewBox="0 0 24 24" width="58%" height="58%">${ok
            ? '<path d="M5 12.6l4.4 4.4L19 7.4" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'
            : '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>'}</svg></span>`
        const tag = (txt, col) => `<span style="position:absolute;left:50%;transform:translateX(-50%);bottom:${Math.round(cw * 0.08)}px;padding:${Math.round(cw * 0.05)}px ${Math.round(cw * 0.13)}px;border-radius:99px;background:${col};color:#fff;font-family:'Archivo Black',sans-serif;font-size:${Math.round(cw * 0.13)}px;letter-spacing:.02em;white-space:nowrap">${txt}</span>`
        const card = (k, inner) => `<div class="an-p" id="${id}c${k}" style="left:${k === 1 ? 0 : f.w - cw}px;top:0;width:${cw}px;height:${ch}px;border-radius:${rd}px;overflow:hidden;background:#141418;box-shadow:0 30px 70px rgba(0,0,0,.45)">${inner}</div>`
        return box(
          card(1, `<img src="${src}" style="position:absolute;left:-8%;top:0;width:116%;height:100%;object-fit:cover;filter:saturate(.28) contrast(1.75) brightness(.82) blur(1.5px)"/>
            <span id="${id}gl" style="position:absolute;left:3%;top:0;width:100%;height:100%;background:url('${src}') center/cover;opacity:.42;mix-blend-mode:screen;filter:hue-rotate(150deg) saturate(3)"></span>
            <span style="position:absolute;inset:0;background:repeating-linear-gradient(180deg,rgba(0,0,0,.30) 0 3px,rgba(0,0,0,0) 3px 8px)"></span>
            ${badge(false)}${tag('FAKE', '#FF3B30')}`) +
          card(2, `<img src="${src}" style="position:absolute;left:-8%;top:0;width:116%;height:100%;object-fit:cover"/>
            ${badge(true)}${tag('RÉEL', '#22C55E')}`))
      }
      // sans visage : deux blocs, l'un tombe et l'autre monte — un avant/après
      return box(
        `<div class="an-p" id="${id}c1" style="left:0;top:0;width:${cw}px;height:100%;background:${P.soft};border:2px solid ${P.line};border-radius:${Math.round(f.h * 0.08)}px"></div>` +
        `<div class="an-p" id="${id}c2" style="left:${f.w - cw}px;top:0;width:${cw}px;height:100%;background:${P.acc};border-radius:${Math.round(f.h * 0.08)}px"></div>`)
    }
    case 'sign': {
      // « ceux qui SIGNENT des CONTRATS » : un contrat, une signature qui
      // s'écrit sous le stylo, un tampon qui claque. Un sac de billets ne dit
      // pas « contrat » — la signature, si.
      const dw = Math.round(f.w * 0.62), dh = Math.round(f.h * 0.9)
      const dx = Math.round((f.w - dw) / 2), dy = Math.round((f.h - dh) / 2)
      const pad = Math.round(dw * 0.11)
      const line = (k, wpc) => `<span style="position:absolute;left:${pad}px;top:${Math.round(dh * (0.16 + k * 0.085))}px;width:${Math.round((dw - pad * 2) * wpc)}px;height:${Math.round(dh * 0.028)}px;border-radius:99px;background:rgba(20,20,24,.16)"></span>`
      const sigW = Math.round(dw * 0.56), sigX = pad, sigY = Math.round(dh * 0.66)
      return box(`<div class="an-p" id="${id}dc" style="left:${dx}px;top:${dy}px;width:${dw}px;height:${dh}px;border-radius:${Math.round(dw * 0.06)}px;background:#FAF8F5;box-shadow:0 34px 80px rgba(0,0,0,.45)">
        <span style="position:absolute;left:${pad}px;top:${Math.round(dh * 0.07)}px;width:${Math.round(dw * 0.34)}px;height:${Math.round(dh * 0.045)}px;border-radius:99px;background:${P.acc}"></span>
        ${line(0, 1)}${line(1, 0.92)}${line(2, 0.98)}${line(3, 0.74)}${line(4, 0.88)}
        <svg id="${id}sg" viewBox="0 0 200 60" style="position:absolute;left:${sigX}px;top:${sigY}px;width:${sigW}px;height:${Math.round(sigW * 0.3)}px;overflow:visible">
          <path id="${id}sp" d="M4 44 C 26 6, 40 8, 46 30 C 52 52, 64 52, 72 28 C 80 4, 96 6, 100 34 C 104 56, 122 50, 136 26 C 150 2, 176 10, 196 26"
            fill="none" stroke="#141418" stroke-width="6" stroke-linecap="round"/></svg>
        <span style="position:absolute;left:${sigX}px;top:${sigY + Math.round(sigW * 0.31)}px;width:${sigW}px;height:3px;background:rgba(20,20,24,.22)"></span>
        <span id="${id}pn" style="position:absolute;left:${sigX}px;top:${sigY - Math.round(sigW * 0.16)}px;width:${Math.round(dw * 0.045)}px;height:${Math.round(dh * 0.3)}px;border-radius:${Math.round(dw * 0.02)}px;background:linear-gradient(180deg,#2B2B33,#0E0E13);transform:rotate(22deg);transform-origin:50% 100%"></span>
        <span id="${id}st" style="position:absolute;right:${pad}px;bottom:${Math.round(dh * 0.07)}px;padding:${Math.round(dh * 0.022)}px ${Math.round(dw * 0.06)}px;border:${Math.max(3, Math.round(dw * 0.014))}px solid #22C55E;border-radius:${Math.round(dw * 0.03)}px;color:#22C55E;font-family:'Archivo Black',sans-serif;font-size:${Math.round(dh * 0.062)}px;transform:rotate(-11deg);opacity:0">SIGNÉ</span>
      </div>`)
    }
    case 'tools': {
      // « les bons OUTILS » : les outils eux-mêmes, pas trois ronds numérotés.
      const td = Math.round(Math.min(f.w * 0.36, f.h * 0.62))
      const gap = Math.round(td * 0.34)
      const x0 = Math.round((f.w - (td * 2 + gap)) / 2), y0 = Math.round((f.h - td) / 2)
      const r = Math.round(td * 0.24)
      return box(`
        <div class="an-p" id="${id}t1" style="left:${x0}px;top:${y0}px;width:${td}px;height:${td}px;border-radius:${r}px;overflow:hidden;box-shadow:0 26px 60px rgba(0,0,0,.45)">
          <img src="tuto/logo-avatarads.png" style="width:100%;height:100%;object-fit:cover;display:block"/></div>
        <div class="an-p" id="${id}t2" style="left:${x0 + td + gap}px;top:${y0}px;width:${td}px;height:${td}px;border-radius:${r}px;background:#F0EEE6;display:flex;align-items:center;justify-content:center;box-shadow:0 26px 60px rgba(0,0,0,.45)">
          <span style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(td * 0.26)}px;color:#D97757;letter-spacing:-.02em">Claude</span></div>
        <span id="${id}pl" style="position:absolute;left:${x0 + td + Math.round(gap / 2)}px;top:${y0 + Math.round(td / 2)}px;width:${Math.round(gap * 0.5)}px;height:${Math.max(4, Math.round(gap * 0.09))}px;margin-left:${-Math.round(gap * 0.25)}px;margin-top:${-Math.round(gap * 0.045)}px;border-radius:99px;background:${P.ink};opacity:0"></span>
        <span id="${id}pv" style="position:absolute;left:${x0 + td + Math.round(gap / 2)}px;top:${y0 + Math.round(td / 2)}px;width:${Math.max(4, Math.round(gap * 0.09))}px;height:${Math.round(gap * 0.5)}px;margin-left:${-Math.round(gap * 0.045)}px;margin-top:${-Math.round(gap * 0.25)}px;border-radius:99px;background:${P.ink};opacity:0"></span>`)
    }
    // ══ PAQUET 1 — LA QUALITÉ, LE TEMPS, LA DIFFUSION ═══════════════════════
    // Ces quinze-là comblent les trous mesurés sur de vrais scripts : « la
    // meilleure qualité du marché », « en deux minutes », « ça devient viral »…
    // autant de moments où la banque ne proposait RIEN et où l'écran restait sur
    // la scène d'avant.
    case 'quality': {
      // « LA MEILLEURE QUALITÉ » : la même image, floue puis nette, séparée par
      // une ligne qui balaie. On VOIT la différence, on ne la lit pas.
      const w = Math.round(Math.min(f.w * 0.78, f.h * 1.25)), h = Math.round(w * 0.62)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const grid = (blur) => `<div style="position:absolute;inset:0;background:linear-gradient(135deg,${P.acc}33,${P.soft}),repeating-linear-gradient(45deg,${P.soft} 0 ${Math.round(w*0.03)}px,transparent ${Math.round(w*0.03)}px ${Math.round(w*0.06)}px);filter:blur(${blur}px)"></div>`
      return box(`
        <div class="an-p" id="${id}qf" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w*0.045)}px;overflow:hidden;box-shadow:0 26px 60px rgba(0,0,0,.4)">${grid(9)}</div>
        <div class="an-p" id="${id}qs" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w*0.045)}px;overflow:hidden;clip-path:inset(0 100% 0 0)">${grid(0)}</div>
        <span id="${id}ql" style="position:absolute;left:${x}px;top:${y - 8}px;width:3px;height:${h + 16}px;background:#fff;box-shadow:0 0 12px rgba(255,255,255,.7)"></span>`)
    }
    case 'hd': {
      // « EN 4K », « 1080p » : le badge claque sur l'image.
      const lab = String((s.items || [])[0]?.text || '4K').toUpperCase().slice(0, 5)
      const bw = Math.round(f.w * 0.44), bh = Math.round(bw * 0.42)
      return box(`
        <div class="an-p" id="${id}hb" style="left:${Math.round((f.w-bw)/2)}px;top:${Math.round((f.h-bh)/2)}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh*0.24)}px;background:${P.acc};display:flex;align-items:center;justify-content:center;box-shadow:0 22px 54px rgba(0,0,0,.45)">
          <span style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(bh*0.5)}px;color:#fff;letter-spacing:.02em">${esc(lab)}</span></div>
        <span id="${id}hr" style="position:absolute;left:50%;top:50%;width:${bw}px;height:${bh}px;margin-left:${-bw/2}px;margin-top:${-bh/2}px;border-radius:${Math.round(bh*0.24)}px;border:3px solid ${P.acc};opacity:0"></span>`)
    }
    case 'podium': {
      // « LE MEILLEUR DU MARCHÉ » : trois marches, la nôtre monte en premier.
      const bw = Math.round(f.w * 0.2), gap = Math.round(bw * 0.14)
      const hs = [0.52, 0.86, 0.4].map((r) => Math.round(f.h * r))
      const x0 = Math.round((f.w - (bw * 3 + gap * 2)) / 2)
      return box(hs.map((hh, k) => `
        <div class="an-p" id="${id}pd${k}" style="left:${x0 + k*(bw+gap)}px;top:${f.h - hh}px;width:${bw}px;height:${hh}px;border-radius:${Math.round(bw*0.1)}px ${Math.round(bw*0.1)}px 0 0;background:${k===1?P.acc:P.soft};transform-origin:50% 100%">
          <span style="position:absolute;left:0;right:0;top:${Math.round(bw*0.16)}px;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(bw*0.42)}px;color:${k===1?'#fff':P.ink};opacity:${k===1?1:.5}">${k===1?1:(k===0?2:3)}</span></div>`).join(''))
    }
    case 'star': {
      // « ILS ADORENT », « 5 étoiles » : les étoiles se remplissent une à une.
      const sz = Math.round(Math.min(f.w * 0.15, f.h * 0.3)), gap = Math.round(sz * 0.2)
      const x0 = Math.round((f.w - (sz * 5 + gap * 4)) / 2), y = Math.round((f.h - sz) / 2)
      const star = '<path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5-4.8-4.6 6.6-.9z"/>'
      return box(Array.from({ length: 5 }, (_, k) => `
        <svg class="an-p" id="${id}st${k}" viewBox="0 0 24 24" style="left:${x0 + k*(sz+gap)}px;top:${y}px;width:${sz}px;height:${sz}px;fill:${P.acc}">${star}</svg>`).join(''))
    }
    case 'speed': {
      // « ULTRA RAPIDE » : l'aiguille du compteur part à fond.
      const r = Math.round(Math.min(f.w * 0.3, f.h * 0.46))
      const cx = Math.round(f.w / 2), cy = Math.round(f.h / 2 + r * 0.3)
      return box(`
        <svg style="position:absolute;left:${cx - r}px;top:${cy - r}px;width:${2*r}px;height:${2*r}px;overflow:visible">
          <path d="M ${r*0.12} ${r} A ${r*0.88} ${r*0.88} 0 0 1 ${r*1.88} ${r}" fill="none" stroke="${P.soft}" stroke-width="${Math.round(r*0.16)}" stroke-linecap="round"/>
          <path id="${id}sp" d="M ${r*0.12} ${r} A ${r*0.88} ${r*0.88} 0 0 1 ${r*1.88} ${r}" fill="none" stroke="${P.acc}" stroke-width="${Math.round(r*0.16)}" stroke-linecap="round"/>
        </svg>
        <span id="${id}sn" style="position:absolute;left:${cx}px;top:${cy}px;width:${Math.round(r*0.06)}px;height:${Math.round(r*0.74)}px;margin-left:${-Math.round(r*0.03)}px;margin-top:${-Math.round(r*0.74)}px;background:${P.ink};border-radius:99px;transform-origin:50% 100%;transform:rotate(-82deg)"></span>
        <span style="position:absolute;left:${cx-Math.round(r*0.07)}px;top:${cy-Math.round(r*0.07)}px;width:${Math.round(r*0.14)}px;height:${Math.round(r*0.14)}px;border-radius:50%;background:${P.ink}"></span>`)
    }
    case 'hourglass': {
      // le temps qui passe, SANS l'horloge : un sablier qui se vide.
      const w = Math.round(Math.min(f.w * 0.26, f.h * 0.42)), h = Math.round(w * 1.5)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const half = Math.round(h / 2)
      return box(`
        <div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
          <span style="position:absolute;inset:0;border:${Math.max(3,Math.round(w*0.07))}px solid ${P.ink};border-radius:${Math.round(w*0.12)}px;clip-path:polygon(0 0,100% 0,52% 50%,100% 100%,0 100%,48% 50%)"></span>
          <span id="${id}gt" style="position:absolute;left:${Math.round(w*0.16)}px;top:${Math.round(w*0.1)}px;width:${Math.round(w*0.68)}px;height:${half - Math.round(w*0.16)}px;background:${P.acc};clip-path:polygon(0 0,100% 0,50% 100%);transform-origin:50% 0"></span>
          <span id="${id}gb" style="position:absolute;left:${Math.round(w*0.16)}px;top:${half + Math.round(w*0.06)}px;width:${Math.round(w*0.68)}px;height:${half - Math.round(w*0.16)}px;background:${P.acc};clip-path:polygon(50% 0,100% 100%,0 100%);transform-origin:50% 100%;transform:scaleY(0)"></span>
        </div>`)
    }
    case 'deadline': {
      // « avant vendredi », « la date limite » : le jour s'entoure.
      const w = Math.round(Math.min(f.w * 0.56, f.h * 0.95)), h = Math.round(w * 0.86)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const cw = Math.round(w / 7), rh = Math.round((h - w * 0.24) / 5)
      let cells = ''
      for (let r0 = 0; r0 < 5; r0++) for (let c = 0; c < 7; c++) {
        const hot = r0 === 2 && c === 4
        cells += `<span ${hot ? `id="${id}dl"` : ''} style="position:absolute;left:${c*cw + Math.round(cw*0.16)}px;top:${Math.round(w*0.24) + r0*rh + Math.round(rh*0.16)}px;width:${Math.round(cw*0.68)}px;height:${Math.round(rh*0.68)}px;border-radius:${Math.round(cw*0.16)}px;background:${hot ? P.acc : P.soft}"></span>`
      }
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w*0.05)}px;background:${P.dark ? '#16161C' : '#FFFFFF'};box-shadow:0 22px 54px rgba(0,0,0,.35);overflow:hidden">
        <span style="position:absolute;left:0;top:0;width:100%;height:${Math.round(w*0.14)}px;background:${P.acc}"></span>${cells}</div>`)
    }
    case 'share': {
      // « partage-le », « envoie-le à un pote » : ça part vers des contacts.
      const r = Math.round(Math.min(f.w * 0.09, f.h * 0.17))
      const cx = Math.round(f.w * 0.26), cy = Math.round(f.h / 2)
      const tgt = [[0.76, 0.22], [0.84, 0.5], [0.76, 0.78]]
      return box(`
        <div class="an-p" id="${id}sh0" style="left:${cx-r}px;top:${cy-r}px;width:${2*r}px;height:${2*r}px;border-radius:${Math.round(r*0.5)}px;background:${P.acc};display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13M8 7l4-4 4 4"/></svg></div>
        ${tgt.map(([px, py], k) => `<div class="an-p" id="${id}sh${k+1}" style="left:${Math.round(f.w*px)-Math.round(r*0.72)}px;top:${Math.round(f.h*py)-Math.round(r*0.72)}px;width:${Math.round(r*1.44)}px;height:${Math.round(r*1.44)}px;border-radius:50%;background:${P.soft};border:2px solid ${P.line}"></div>`).join('')}`)
    }
    case 'dm': {
      // « je t'envoie ça en privé » : le message arrive.
      const w = Math.round(f.w * 0.66), h = Math.round(w * 0.3)
      return box(`
        <div class="an-p" id="${id}m1" style="left:${Math.round(f.w*0.06)}px;top:${Math.round(f.h*0.2)}px;width:${w}px;height:${h}px;border-radius:${Math.round(h*0.34)}px;background:${P.soft}"></div>
        <div class="an-p" id="${id}m2" style="left:${Math.round(f.w - w*0.86 - f.w*0.06)}px;top:${Math.round(f.h*0.56)}px;width:${Math.round(w*0.86)}px;height:${h}px;border-radius:${Math.round(h*0.34)}px;background:${P.acc};display:flex;align-items:center;padding:0 ${Math.round(h*0.34)}px;box-sizing:border-box;gap:${Math.round(h*0.18)}px">
          ${[0,1,2].map(() => `<span style="width:${Math.round(h*0.14)}px;height:${Math.round(h*0.14)}px;border-radius:50%;background:rgba(255,255,255,.85)"></span>`).join('')}</div>`)
    }
    case 'bell': {
      // « active les notifications », « tu reçois une alerte ».
      const sz = Math.round(Math.min(f.w * 0.32, f.h * 0.56))
      return box(`
        <svg class="an-p" id="${id}bl" viewBox="0 0 24 24" style="left:${Math.round((f.w-sz)/2)}px;top:${Math.round((f.h-sz)/2)}px;width:${sz}px;height:${sz}px;fill:none;stroke:${P.ink};stroke-width:1.7;stroke-linecap:round;transform-origin:50% 18%">
          <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M13.7 20a2 2 0 0 1-3.4 0"/></svg>
        <span id="${id}bd" style="position:absolute;left:${Math.round(f.w/2 + sz*0.22)}px;top:${Math.round((f.h-sz)/2 + sz*0.06)}px;width:${Math.round(sz*0.24)}px;height:${Math.round(sz*0.24)}px;border-radius:50%;background:${P.acc};opacity:0"></span>`)
    }
    case 'crowd': {
      // « des milliers de personnes » : la foule grandit.
      const cols = 7, rows = 4
      const sz = Math.round(Math.min(f.w / (cols * 1.5), f.h / (rows * 1.7)))
      const gx = Math.round(sz * 0.5), gy = Math.round(sz * 0.7)
      const x0 = Math.round((f.w - (cols * sz + (cols - 1) * gx)) / 2)
      const y0 = Math.round((f.h - (rows * sz + (rows - 1) * gy)) / 2)
      let h = ''
      for (let r0 = 0; r0 < rows; r0++) for (let c = 0; c < cols; c++) {
        const i = r0 * cols + c
        h += `<div class="an-p an-cw" style="left:${x0 + c*(sz+gx)}px;top:${y0 + r0*(sz+gy)}px;width:${sz}px;height:${sz}px;opacity:0">
          <span style="position:absolute;left:25%;top:0;width:50%;height:50%;border-radius:50%;background:${i % 5 === 2 ? P.acc : P.soft}"></span>
          <span style="position:absolute;left:8%;top:56%;width:84%;height:44%;border-radius:${Math.round(sz*0.3)}px ${Math.round(sz*0.3)}px 0 0;background:${i % 5 === 2 ? P.acc : P.soft}"></span></div>`
      }
      return box(h)
    }
    case 'viral': {
      // « ça devient viral » : un point se propage à tout le réseau.
      const R = Math.round(Math.min(f.w, f.h) * 0.42)
      const cx = Math.round(f.w / 2), cy = Math.round(f.h / 2)
      const pts = Array.from({ length: 9 }, (_, k) => {
        const a = (Math.PI * 2 * k) / 9 - Math.PI / 2
        const rr = k % 2 ? R : R * 0.62
        return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]
      })
      const d = Math.round(Math.min(f.w, f.h) * 0.075)
      return box(`
        <svg style="position:absolute;inset:0;width:100%;height:100%">
          ${pts.map(([px, py], k) => `<line id="${id}vl${k}" x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="${P.line}" stroke-width="2"/>`).join('')}
        </svg>
        <span class="an-p" id="${id}vc" style="left:${cx-d}px;top:${cy-d}px;width:${2*d}px;height:${2*d}px;border-radius:50%;background:${P.acc};box-shadow:0 0 ${d}px ${P.acc}66"></span>
        ${pts.map(([px, py], k) => `<span class="an-p an-vp" id="${id}vp${k}" style="left:${Math.round(px-d*0.62)}px;top:${Math.round(py-d*0.62)}px;width:${Math.round(d*1.24)}px;height:${Math.round(d*1.24)}px;border-radius:50%;background:${P.acc};opacity:0"></span>`).join('')}`)
    }
    case 'scrollstop': {
      // « ils arrêtent de scroller » : le pouce défile puis se fige net.
      const pw = Math.round(Math.min(f.w * 0.42, f.h * 0.62)), ph = Math.round(pw * 1.9)
      const x = Math.round((f.w - pw) / 2), y = Math.round((f.h - ph) / 2)
      return box(`
        <div class="an-p" style="left:${x}px;top:${y}px;width:${pw}px;height:${ph}px;border-radius:${Math.round(pw*0.13)}px;border:${Math.max(3,Math.round(pw*0.035))}px solid ${P.ink};overflow:hidden;background:${P.dark ? '#0F0F14' : '#FFF'}">
          <div id="${id}ss" style="position:absolute;left:0;top:0;width:100%">
            ${[0,1,2,3,4].map((k) => `<div style="height:${Math.round(ph*0.42)}px;margin:${Math.round(ph*0.03)}px ${Math.round(pw*0.07)}px;border-radius:${Math.round(pw*0.07)}px;background:${k===2?P.acc:P.soft}"></div>`).join('')}
          </div></div>
        <svg id="${id}sf" viewBox="0 0 24 24" style="position:absolute;left:${x + pw - Math.round(pw*0.2)}px;top:${y + Math.round(ph*0.62)}px;width:${Math.round(pw*0.42)}px;height:${Math.round(pw*0.42)}px;fill:${P.ink};opacity:0"><path d="M9 21h7a2 2 0 0 0 2-1.6l1.3-6A1.6 1.6 0 0 0 17.7 11H13V5.5A2.5 2.5 0 0 0 10.5 3L9 10.5z"/></svg>`)
    }
    case 'retention': {
      // « ils regardent jusqu'au bout » : la courbe qui NE tombe PAS.
      const w = Math.round(f.w * 0.82), h = Math.round(f.h * 0.62)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const bad = `M0 ${h*0.1} C ${w*0.2} ${h*0.55}, ${w*0.4} ${h*0.85}, ${w} ${h*0.95}`
      const good = `M0 ${h*0.1} C ${w*0.3} ${h*0.16}, ${w*0.6} ${h*0.22}, ${w} ${h*0.3}`
      return box(`
        <svg style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:visible">
          <path d="${bad}" fill="none" stroke="${P.line}" stroke-width="4" stroke-dasharray="8 8"/>
          <path id="${id}rt" d="${good}" fill="none" stroke="${P.acc}" stroke-width="7" stroke-linecap="round"/>
        </svg>
        <span id="${id}rd" style="position:absolute;left:${x + w - 8}px;top:${y + Math.round(h*0.3) - 8}px;width:16px;height:16px;border-radius:50%;background:${P.acc};opacity:0"></span>`)
    }
    case 'abtest': {
      // « on teste deux versions » : A et B, une gagne.
      const cw = Math.round(f.w * 0.36), ch = Math.round(cw * 1.3)
      const y = Math.round((f.h - ch) / 2), gap = Math.round(f.w * 0.08)
      const x0 = Math.round((f.w - (cw * 2 + gap)) / 2)
      return box(['A', 'B'].map((lab, k) => `
        <div class="an-p" id="${id}ab${k}" style="left:${x0 + k*(cw+gap)}px;top:${y}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw*0.1)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;justify-content:center">
          <span style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(cw*0.42)}px;color:${P.ink};opacity:.55">${lab}</span></div>`).join('') + `
        <span id="${id}abw" style="position:absolute;left:${x0 + cw + gap}px;top:${y}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw*0.1)}px;border:4px solid ${P.acc};opacity:0"></span>`)
    }
    // ══ PAQUET 2 — L'ARGENT, L'OUTIL, LA MÉTHODE ════════════════════════════
    case 'roi': {
      // « 1 € investi, 5 € qui reviennent » : ce qui entre, ce qui sort.
      const bw = Math.round(f.w * 0.18), y = Math.round(f.h / 2)
      const mk = (x, n, big) => `<div class="an-p" id="${id}ro${n}" style="left:${x}px;top:${y - Math.round(bw*0.34)}px;width:${bw}px;height:${Math.round(bw*0.68)}px;border-radius:${Math.round(bw*0.12)}px;background:${big ? P.acc : P.soft};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(bw*0.34)}px;color:${big ? '#fff' : P.ink}">${big ? '5€' : '1€'}</div>`
      return box(mk(Math.round(f.w * 0.1), 0, false) + mk(Math.round(f.w * 0.66), 1, true) + `
        <svg style="position:absolute;left:${Math.round(f.w*0.32)}px;top:${y - 24}px;width:${Math.round(f.w*0.3)}px;height:48px;overflow:visible">
          <path id="${id}roa" d="M4 24 H ${Math.round(f.w*0.3) - 22}" fill="none" stroke="${P.acc}" stroke-width="6" stroke-linecap="round"/>
          <path id="${id}roh" d="M ${Math.round(f.w*0.3) - 34} 12 L ${Math.round(f.w*0.3) - 6} 24 L ${Math.round(f.w*0.3) - 34} 36 Z" fill="${P.acc}" opacity="0"/>
        </svg>`)
    }
    case 'save': {
      // « tu économises », « ça te coûte moins cher » : la tirelire se remplit.
      const w = Math.round(Math.min(f.w * 0.42, f.h * 0.7)), h = Math.round(w * 0.74)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2 + h * 0.12)
      return box(`
        <div class="an-p" id="${id}sv" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(h*0.42)}px ${Math.round(h*0.42)}px ${Math.round(h*0.34)}px ${Math.round(h*0.34)}px;background:${P.acc}">
          <span style="position:absolute;left:${Math.round(w*0.36)}px;top:${Math.round(h*0.1)}px;width:${Math.round(w*0.28)}px;height:${Math.max(4,Math.round(h*0.05))}px;border-radius:99px;background:rgba(0,0,0,.3)"></span>
          <span style="position:absolute;left:${Math.round(w*0.72)}px;top:${Math.round(h*0.4)}px;width:${Math.round(w*0.1)}px;height:${Math.round(w*0.1)}px;border-radius:50%;background:rgba(255,255,255,.85)"></span></div>
        ${[0,1,2].map((k) => `<span class="an-p an-cn" id="${id}sc${k}" style="left:${x + Math.round(w*0.42)}px;top:${y - Math.round(h*0.6)}px;width:${Math.round(w*0.16)}px;height:${Math.round(w*0.16)}px;border-radius:50%;background:${P.ink};opacity:0"></span>`).join('')}`)
    }
    case 'free': {
      // « c'est gratuit », « offert » : l'étiquette qui claque.
      const w = Math.round(f.w * 0.6), h = Math.round(w * 0.34)
      return box(`
        <div class="an-p" id="${id}fr" style="left:${Math.round((f.w-w)/2)}px;top:${Math.round((f.h-h)/2)}px;width:${w}px;height:${h}px;border-radius:${Math.round(h*0.22)}px;background:${P.acc};display:flex;align-items:center;justify-content:center;transform:rotate(-7deg);box-shadow:0 20px 48px rgba(0,0,0,.4)">
          <span style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(h*0.42)}px;color:#fff;letter-spacing:.04em">GRATUIT</span></div>`)
    }
    case 'plan': {
      // « il y a trois formules » : les cartes de prix, celle du milieu ressort.
      const cw = Math.round(f.w * 0.26), gap = Math.round(cw * 0.16)
      const x0 = Math.round((f.w - (cw * 3 + gap * 2)) / 2)
      const hs = [0.66, 0.9, 0.66]
      return box(hs.map((rr, k) => {
        const ch = Math.round(f.h * rr)
        return `<div class="an-p" id="${id}pl${k}" style="left:${x0 + k*(cw+gap)}px;top:${Math.round((f.h-ch)/2)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw*0.14)}px;background:${k===1?P.acc:P.soft};border:2px solid ${k===1?'transparent':P.line};padding:${Math.round(cw*0.14)}px;box-sizing:border-box">
          ${[0.5,0.8,0.65,0.75].map((wr,j) => `<span style="display:block;height:${Math.max(4,Math.round(ch*0.045))}px;width:${Math.round(wr*100)}%;margin-bottom:${Math.round(ch*0.06)}px;border-radius:99px;background:${k===1?'rgba(255,255,255,.75)':P.line}"></span>`).join('')}</div>`
      }).join(''))
    }
    case 'crown': {
      // « la version premium », « le meilleur plan » : la couronne se pose.
      const sz = Math.round(Math.min(f.w * 0.4, f.h * 0.62))
      return box(`
        <svg class="an-p" id="${id}cr" viewBox="0 0 24 24" style="left:${Math.round((f.w-sz)/2)}px;top:${Math.round((f.h-sz)/2)}px;width:${sz}px;height:${sz}px;fill:${P.acc}">
          <path d="M3 18h18l1.4-9.4-5.2 3.4L12 4l-5.2 8-5.2-3.4z"/><rect x="3" y="19.4" width="18" height="2.6" rx="1.3"/></svg>
        <span id="${id}cg" style="position:absolute;left:50%;top:50%;width:${Math.round(sz*1.4)}px;height:${Math.round(sz*1.4)}px;margin-left:${-Math.round(sz*0.7)}px;margin-top:${-Math.round(sz*0.7)}px;border-radius:50%;background:radial-gradient(circle,${P.acc}55,transparent 65%);opacity:0"></span>`)
    }
    case 'robot': {
      // « l'IA le fait pour toi » : le petit robot qui s'anime.
      const w = Math.round(Math.min(f.w * 0.36, f.h * 0.56)), h = Math.round(w * 0.94)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const eye = Math.round(w * 0.13)
      return box(`
        <div class="an-p" id="${id}rb" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
          <span style="position:absolute;left:50%;top:0;width:${Math.max(3,Math.round(w*0.03))}px;height:${Math.round(h*0.14)}px;margin-left:${-Math.round(w*0.015)}px;background:${P.ink}"></span>
          <span id="${id}rba" style="position:absolute;left:50%;top:${-Math.round(w*0.06)}px;width:${Math.round(w*0.12)}px;height:${Math.round(w*0.12)}px;margin-left:${-Math.round(w*0.06)}px;border-radius:50%;background:${P.acc}"></span>
          <span style="position:absolute;left:0;top:${Math.round(h*0.14)}px;width:100%;height:${Math.round(h*0.5)}px;border-radius:${Math.round(w*0.16)}px;background:${P.soft};border:${Math.max(3,Math.round(w*0.035))}px solid ${P.ink};box-sizing:border-box"></span>
          <span id="${id}re1" style="position:absolute;left:${Math.round(w*0.28)}px;top:${Math.round(h*0.3)}px;width:${eye}px;height:${eye}px;border-radius:50%;background:${P.acc}"></span>
          <span id="${id}re2" style="position:absolute;left:${Math.round(w*0.59)}px;top:${Math.round(h*0.3)}px;width:${eye}px;height:${eye}px;border-radius:50%;background:${P.acc}"></span>
          <span style="position:absolute;left:${Math.round(w*0.16)}px;top:${Math.round(h*0.68)}px;width:${Math.round(w*0.68)}px;height:${Math.round(h*0.26)}px;border-radius:${Math.round(w*0.1)}px;background:${P.ink}"></span>
        </div>`)
    }
    case 'brain': {
      // « l'IA comprend », « le cerveau du truc » : il s'allume par zones.
      const sz = Math.round(Math.min(f.w * 0.46, f.h * 0.72))
      const x = Math.round((f.w - sz) / 2), y = Math.round((f.h - sz) / 2)
      return box(`
        <svg style="position:absolute;left:${x}px;top:${y}px;width:${sz}px;height:${sz}px" viewBox="0 0 24 24" fill="none" stroke="${P.ink}" stroke-width="1.5" stroke-linecap="round">
          <path d="M12 5.2a3 3 0 0 0-5.6 1.3A2.8 2.8 0 0 0 4 9.2a2.9 2.9 0 0 0 1.2 2.3A2.9 2.9 0 0 0 4.6 15a3 3 0 0 0 2.6 2.6A2.8 2.8 0 0 0 12 18.8zM12 5.2a3 3 0 0 1 5.6 1.3A2.8 2.8 0 0 1 20 9.2a2.9 2.9 0 0 1-1.2 2.3 2.9 2.9 0 0 1 .6 3.5 3 3 0 0 1-2.6 2.6A2.8 2.8 0 0 1 12 18.8z"/></svg>
        ${[[0.34,0.36],[0.62,0.42],[0.44,0.62],[0.68,0.66]].map(([px,py],k) => `<span class="an-p an-bs" id="${id}bs${k}" style="left:${x + Math.round(sz*px)}px;top:${y + Math.round(sz*py)}px;width:${Math.round(sz*0.09)}px;height:${Math.round(sz*0.09)}px;border-radius:50%;background:${P.acc};opacity:0"></span>`).join('')}`)
    }
    case 'magic': {
      // « et là, ça devient magique » : la baguette transforme le bloc.
      const sz = Math.round(Math.min(f.w * 0.34, f.h * 0.5))
      const cx = Math.round(f.w / 2), cy = Math.round(f.h / 2)
      return box(`
        <div class="an-p" id="${id}mb" style="left:${cx - Math.round(sz/2)}px;top:${cy - Math.round(sz/2)}px;width:${sz}px;height:${sz}px;border-radius:${Math.round(sz*0.14)}px;background:${P.soft};border:2px solid ${P.line}"></div>
        <div class="an-p" id="${id}ma" style="left:${cx - Math.round(sz/2)}px;top:${cy - Math.round(sz/2)}px;width:${sz}px;height:${sz}px;border-radius:${Math.round(sz*0.14)}px;background:${P.acc};opacity:0;box-shadow:0 20px 50px ${P.acc}55"></div>
        <span id="${id}mw" style="position:absolute;left:${cx + Math.round(sz*0.32)}px;top:${cy - Math.round(sz*0.78)}px;width:${Math.max(5,Math.round(sz*0.055))}px;height:${Math.round(sz*0.72)}px;border-radius:99px;background:linear-gradient(180deg,${P.ink},${P.acc});transform:rotate(28deg);transform-origin:50% 100%"></span>
        ${[0,1,2,3].map((k) => `<span class="an-p an-mk" id="${id}mk${k}" style="left:${cx - Math.round(sz*0.4) + k*Math.round(sz*0.28)}px;top:${cy - Math.round(sz*0.5) + (k%2?Math.round(sz*0.9):0)}px;width:${Math.round(sz*0.1)}px;height:${Math.round(sz*0.1)}px;background:${P.acc};clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);opacity:0"></span>`).join('')}`)
    }
    case 'filter': {
      // « on garde que le meilleur » : beaucoup entre, peu ressort — un tamis.
      const w = Math.round(f.w * 0.6)
      const x = Math.round((f.w - w) / 2)
      const d = Math.round(w * 0.11)
      return box(`
        ${[0,1,2,3,4].map((k) => `<span class="an-p an-fi" id="${id}fi${k}" style="left:${x + k*Math.round(w*0.22)}px;top:${Math.round(f.h*0.1)}px;width:${d}px;height:${d}px;border-radius:50%;background:${k===2?P.acc:P.soft};opacity:0"></span>`).join('')}
        <div class="an-p" style="left:${x}px;top:${Math.round(f.h*0.46)}px;width:${w}px;height:${Math.round(f.h*0.1)}px;border-radius:99px;background:${P.line};display:flex;align-items:center;justify-content:space-around;padding:0 ${Math.round(w*0.05)}px;box-sizing:border-box">
          ${[0,1,2,3,4,5].map(() => `<span style="width:${Math.max(3,Math.round(w*0.018))}px;height:60%;border-radius:99px;background:${P.dark ? '#0E0E13' : '#fff'}"></span>`).join('')}</div>
        <span class="an-p" id="${id}fo" style="left:${Math.round(f.w/2 - d*0.7)}px;top:${Math.round(f.h*0.78)}px;width:${Math.round(d*1.4)}px;height:${Math.round(d*1.4)}px;border-radius:50%;background:${P.acc};opacity:0"></span>`)
    }
    case 'layers': {
      // « on empile les couches », le montage : les calques se posent.
      const w = Math.round(f.w * 0.56), h = Math.round(f.h * 0.13)
      const x = Math.round((f.w - w) / 2)
      return box([0,1,2,3].map((k) => `
        <div class="an-p an-ly" id="${id}ly${k}" style="left:${x + k*Math.round(w*0.04)}px;top:${Math.round(f.h*0.2 + k*h*1.18)}px;width:${w}px;height:${h}px;border-radius:${Math.round(h*0.26)}px;background:${k===1?P.acc:P.soft};border:2px solid ${k===1?'transparent':P.line};opacity:0"></div>`).join(''))
    }
    case 'before': {
      // AVANT / APRÈS en glissière verticale — différent de `compare`, qui pose
      // deux plans côte à côte : ici c'est LE MÊME visuel qui change.
      const w = Math.round(Math.min(f.w * 0.72, f.h * 1.15)), h = Math.round(w * 0.66)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      return box(`
        <div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w*0.05)}px;overflow:hidden;background:${P.soft};box-shadow:0 24px 56px rgba(0,0,0,.38)">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,${P.line} 0 ${Math.round(w*0.04)}px,transparent ${Math.round(w*0.04)}px ${Math.round(w*0.08)}px)"></span>
          <span id="${id}bf" style="position:absolute;inset:0;background:${P.acc};clip-path:inset(0 0 100% 0)"></span>
        </div>
        <span id="${id}bl" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:4px;background:#fff;box-shadow:0 0 10px rgba(255,255,255,.6);opacity:0"></span>`)
    }
    case 'badge': {
      // « c'est certifié », « validé », « garanti » : le sceau se pose.
      const sz = Math.round(Math.min(f.w * 0.4, f.h * 0.6))
      const x = Math.round((f.w - sz) / 2), y = Math.round((f.h - sz) / 2)
      return box(`
        <svg class="an-p" id="${id}bg" viewBox="0 0 24 24" style="left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;fill:${P.acc}">
          <path d="M12 1.8l2.5 2 3.2-.3 1 3 2.7 1.7-1.2 3 1.2 3-2.7 1.7-1 3-3.2-.3-2.5 2-2.5-2-3.2.3-1-3L2.6 15.9l1.2-3-1.2-3 2.7-1.7 1-3 3.2.3z"/></svg>
        <svg id="${id}bc" viewBox="0 0 24 24" style="position:absolute;left:${x + Math.round(sz*0.26)}px;top:${y + Math.round(sz*0.28)}px;width:${Math.round(sz*0.48)}px;height:${Math.round(sz*0.44)}px;fill:none;stroke:#fff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round"><path d="M3 12.5l5.5 5.5L21 5"/></svg>`)
    }
    case 'trend': {
      // « ça monte », « la tendance » : l'escalier + la flèche.
      const w = Math.round(f.w * 0.74), h = Math.round(f.h * 0.62)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const n = 5, bw = Math.round(w / (n * 1.5))
      return box(Array.from({ length: n }, (_, k) => {
        const bh = Math.round(h * (0.24 + k * 0.19))
        return `<div class="an-p an-tr" style="left:${x + k*Math.round(w/n)}px;top:${y + h - bh}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bw*0.2)}px;background:${k===n-1?P.acc:P.soft};transform-origin:50% 100%;transform:scaleY(0)"></div>`
      }).join('') + `
        <svg id="${id}ta" viewBox="0 0 24 24" style="position:absolute;left:${x + w - Math.round(bw*1.6)}px;top:${y - Math.round(bw*0.4)}px;width:${Math.round(bw*1.5)}px;height:${Math.round(bw*1.5)}px;fill:none;stroke:${P.acc};stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:0"><path d="M5 19L19 5M11 5h8v8"/></svg>`)
    }
    case 'template': {
      // « pars d'un modèle », « duplique » : le gabarit se copie.
      const w = Math.round(f.w * 0.32), h = Math.round(w * 1.4)
      const cx = Math.round(f.w / 2), y = Math.round((f.h - h) / 2)
      return box(`
        <div class="an-p" id="${id}tp0" style="left:${cx - Math.round(w/2)}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w*0.11)}px;background:${P.acc};box-shadow:0 20px 46px rgba(0,0,0,.38)"></div>
        <div class="an-p" id="${id}tp1" style="left:${cx - Math.round(w/2)}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w*0.11)}px;background:${P.soft};border:2px solid ${P.line};opacity:0"></div>
        <div class="an-p" id="${id}tp2" style="left:${cx - Math.round(w/2)}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w*0.11)}px;background:${P.soft};border:2px solid ${P.line};opacity:0"></div>`)
    }
    case 'record': {
      // « tu enregistres ta voix » : le bouton rouge qui pulse + l'onde.
      const r = Math.round(Math.min(f.w * 0.13, f.h * 0.24))
      const cx = Math.round(f.w / 2), cy = Math.round(f.h / 2)
      return box(`
        <span id="${id}rr" style="position:absolute;left:${cx-r}px;top:${cy-r}px;width:${2*r}px;height:${2*r}px;border-radius:50%;background:${P.acc};opacity:0.35"></span>
        <span class="an-p" id="${id}rc" style="left:${cx - Math.round(r*0.56)}px;top:${cy - Math.round(r*0.56)}px;width:${Math.round(r*1.12)}px;height:${Math.round(r*1.12)}px;border-radius:50%;background:${P.acc}"></span>
        <div style="position:absolute;left:${Math.round(f.w*0.14)}px;top:${cy + Math.round(r*1.5)}px;width:${Math.round(f.w*0.72)}px;height:${Math.round(f.h*0.18)}px;display:flex;align-items:center;gap:${Math.round(f.w*0.014)}px">
          ${Array.from({ length: 22 }, (_, k) => `<span class="an-rw" style="flex:1;height:${20 + (k * 37) % 70}%;border-radius:99px;background:${P.soft};transform-origin:50% 50%"></span>`).join('')}
        </div>`)
    }
    case 'copy': {
      // « ET TU COPIES CETTE CLE » : la cle se copie et PART vers Claude.
      // Axel : « quand je dis tu copies cette cle, tu peux faire une animation,
      // ca fait la transition avec Claude ». Le plan precedent montrait le bouton
      // « Ouvrir Claude » — un bouton ne dit pas qu'on emporte quelque chose.
      // Couleurs EXPLICITES : la puce est une piece d'interface, pas un aplat de
      // la palette. (P.ink est blanc sur ce style : le texte disparaissait.)
      const kw = Math.round(Math.min(f.w * 0.84, f.h * 1.7))
      const kh = Math.round(Math.min(kw * 0.17, f.h * 0.17))
      const kx = Math.round((f.w - kw) / 2), ky = Math.round(f.h * 0.05)
      const ph = Math.round(kh * 0.72)
      const py = ky + kh + Math.round(f.h * 0.045)
      const td = Math.round(Math.min(f.w * 0.36, f.h * 0.40))
      const ty = Math.round(f.h - td)
      return box(`
        <div class="an-p" id="${id}k" style="left:${kx}px;top:${ky}px;width:${kw}px;height:${kh}px;border-radius:${Math.round(kh * 0.34)}px;background:#FFFFFF;display:flex;align-items:center;gap:${Math.round(kh * 0.28)}px;padding:0 ${Math.round(kh * 0.4)}px;box-sizing:border-box;box-shadow:0 22px 54px rgba(0,0,0,.42)">
          <svg width="${Math.round(kh * 0.46)}" height="${Math.round(kh * 0.46)}" viewBox="0 0 24 24" fill="none" stroke="${P.acc}" stroke-width="2.3" stroke-linecap="round"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v4"/></svg>
          <span style="font-family:'JetBrains Mono',monospace;font-size:${Math.round(kh * 0.34)}px;color:#141418;letter-spacing:.02em;white-space:nowrap">sk-ava-••••-7X4F</span>
        </div>
        <span id="${id}cp" style="position:absolute;left:50%;top:${py}px;margin-left:${-Math.round(kw * 0.16)}px;width:${Math.round(kw * 0.32)}px;height:${ph}px;border-radius:99px;background:#22C55E;display:flex;align-items:center;justify-content:center;gap:${Math.round(ph * 0.22)}px;color:#fff;font-family:'Archivo Black',sans-serif;font-size:${Math.round(ph * 0.38)}px;opacity:0">
          <svg width="${Math.round(ph * 0.4)}" height="${Math.round(ph * 0.4)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.6l5 5 10-11"/></svg>COPIÉ</span>
        <div class="an-p" id="${id}cl" style="left:${Math.round((f.w - td) / 2)}px;top:${ty}px;width:${td}px;height:${td}px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 26px 60px rgba(0,0,0,.45));opacity:0">
          <img src="tuto/logo-claude.png" style="width:100%;height:100%;object-fit:contain;display:block"/></div>`)
    }
    case 'connect': {
      // « CLAUDE EST CONNECTÉ À AVATARADS » : les DEUX VRAIS logos et la prise
      // qui s'enclenche entre eux. Axel : « à la fin Claude est connecté à
      // AvatarAds, mets les vrais logos des deux ». `tools` les posait côte à
      // côte avec un simple « + » et un mot « Claude » écrit à la main — ici la
      // liaison EST le sujet : les deux blocs se rejoignent, le connecteur
      // claque, le voyant passe au vert.
      const td = Math.round(Math.min(f.w * 0.35, f.h * 0.6))
      const gap = Math.round(td * 0.42)
      const x0 = Math.round((f.w - (td * 2 + gap)) / 2), y0 = Math.round((f.h - td) / 2)
      const r = Math.round(td * 0.24)
      const cx = x0 + td + Math.round(gap / 2), cy = y0 + Math.round(td / 2)
      return box(`
        <div class="an-p" id="${id}c1" style="left:${x0}px;top:${y0}px;width:${td}px;height:${td}px;border-radius:${r}px;overflow:hidden;box-shadow:0 26px 60px rgba(0,0,0,.45)">
          <img src="tuto/logo-avatarads.png" style="width:100%;height:100%;object-fit:cover;display:block"/></div>
        <div class="an-p" id="${id}c2" style="left:${x0 + td + gap}px;top:${y0}px;width:${td}px;height:${td}px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 26px 60px rgba(0,0,0,.45))">
          <img src="tuto/logo-claude.png" style="width:100%;height:100%;object-fit:contain;display:block"/></div>
        <span id="${id}cw" style="position:absolute;left:${cx}px;top:${cy}px;width:${gap}px;height:${Math.max(6, Math.round(td * 0.055))}px;margin-left:${-Math.round(gap / 2)}px;margin-top:${-Math.round(td * 0.0275)}px;border-radius:99px;background:${P.ink};transform-origin:50% 50%"></span>
        <span id="${id}ck" style="position:absolute;left:${cx}px;top:${cy}px;width:${Math.round(td * 0.32)}px;height:${Math.round(td * 0.32)}px;margin-left:${-Math.round(td * 0.16)}px;margin-top:${-Math.round(td * 0.16)}px;border-radius:50%;background:#22C55E;display:flex;align-items:center;justify-content:center;opacity:0;box-shadow:0 12px 34px rgba(34,197,94,.5)">
          <svg width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.6l5 5 10-11"/></svg></span>`)
    }
    case 'post': {
      // « POSTER SUR LES RÉSEAUX » : la vidéo part vers les plateformes et
      // chacune valide. Avant : des bulles de commentaire — « aucun rapport ».
      const td = Math.round(f.w * 0.19), gap = Math.round(td * 0.36)
      const tot = td * 3 + gap * 2, x0 = Math.round((f.w - tot) / 2)
      const glyph = [
        // note de musique · appareil photo · lecture
        '<path d="M9 18.2a2.6 2.6 0 102.6 2.6V7.4l6.4-1.6v9.1a2.6 2.6 0 102.6 2.6V2.5L9 4.9z" fill="#fff"/>',
        '<rect x="3.6" y="5.4" width="16.8" height="13.6" rx="4.2" fill="none" stroke="#fff" stroke-width="2.1"/><circle cx="12" cy="12.2" r="3.5" fill="none" stroke="#fff" stroke-width="2.1"/>',
        '<path d="M9.4 7.6l8 4.6-8 4.6z" fill="#fff"/>',
      ]
      const bg = ['#0E0E13', 'linear-gradient(135deg,#F9A03F,#E1306C 55%,#833AB4)', '#E62117']
      let h = ''
      for (let k = 0; k < 3; k++) {
        h += `<div class="an-p an-pt" id="${id}p${k}" style="left:${x0 + k * (td + gap)}px;top:0;width:${td}px;height:${td}px;border-radius:${Math.round(td * 0.28)}px;background:${bg[k]};display:flex;align-items:center;justify-content:center;box-shadow:0 18px 44px rgba(0,0,0,.4)">
          <svg viewBox="0 0 24 24" width="52%" height="52%">${glyph[k]}</svg>
          <span id="${id}k${k}" style="position:absolute;right:${-Math.round(td * 0.1)}px;bottom:${-Math.round(td * 0.1)}px;width:${Math.round(td * 0.42)}px;height:${Math.round(td * 0.42)}px;border-radius:50%;background:#22C55E;display:flex;align-items:center;justify-content:center;opacity:0">
            <svg viewBox="0 0 24 24" width="62%" height="62%"><path d="M5 12.6l4.4 4.4L19 7.4" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span></div>`
      }
      const vw = Math.round(f.w * 0.24), vh = Math.round(vw * 1.62)
      h += `<div class="an-p" id="${id}vd" style="left:${Math.round((f.w - vw) / 2)}px;top:${f.h - vh}px;width:${vw}px;height:${vh}px;border-radius:${Math.round(vw * 0.13)}px;background:linear-gradient(160deg,${P.acc},#7A3BFF);box-shadow:0 26px 60px rgba(0,0,0,.45)">
        <span style="position:absolute;left:50%;top:50%;margin:-${Math.round(vw * 0.11)}px 0 0 -${Math.round(vw * 0.09)}px;width:0;height:0;border-left:${Math.round(vw * 0.24)}px solid rgba(255,255,255,.92);border-top:${Math.round(vw * 0.14)}px solid transparent;border-bottom:${Math.round(vw * 0.14)}px solid transparent"></span></div>`
      return box(h)
    }
    case 'type': {
      // du texte qui s'écrit, avec le curseur : un script qui se rédige tout seul
      const txt = (items[0] || s.title || '').slice(0, 34)
      const fs = Math.round(H * 0.026)
      // SANS TEXTE : des lignes qui s'ecrivent l'une apres l'autre. Le remplissage
      // automatique ne fournit pas de phrase, et un `type` vide n'affichait rien —
      // pire, il cassait toute la timeline (childNodes[0] etait le curseur, pas un
      // noeud texte, donc .nodeValue valait null).
      if (!txt) {
        const lw = Math.round(f.w * 0.78), lh = Math.round(f.h * 0.09)
        const x = Math.round((f.w - lw) / 2)
        return box([0, 1, 2].map((k) => `<span class="an-p an-tl" id="${id}l${k}" style="left:${x}px;top:${Math.round(f.h * 0.3 + k * lh * 1.7)}px;width:${Math.round(lw * (1 - k * 0.18))}px;height:${lh}px;border-radius:${Math.round(lh * 0.35)}px;background:${k === 1 ? P.acc : P.soft}"></span>`).join('') +
          `<span class="an-p an-cur" id="${id}cur" style="left:${x + lw}px;top:${Math.round(f.h * 0.3)}px;width:${Math.max(4, Math.round(f.w * 0.012))}px;height:${lh}px;background:${P.ink}"></span>`)
      }
      return box(`<div class="an-t" id="${id}t" style="font-size:${fs}px;color:${P.ink}">${esc(txt)}<span class="an-cur" id="${id}cur" style="background:${P.acc}"></span></div>`)
    }
    case 'phone': {
      // Un vrai fil : des vignettes de vidéo qui défilent, avec la barre d'actions
      // à droite. Un dégradé qui glisse ne montre rien.
      const pw = Math.round(f.h * 0.52), ph = f.h
      const card = (top, col) => `<span style="position:absolute;left:6%;top:${top}%;width:88%;height:26%;border-radius:${Math.round(pw * 0.06)}px;background:${col}">` +
        `<span style="position:absolute;right:6%;bottom:8%;width:${Math.round(pw * 0.07)}px;height:${Math.round(pw * 0.07)}px;border-radius:50%;background:rgba(255,255,255,.75)"></span>` +
        `<span style="position:absolute;left:8%;bottom:9%;width:42%;height:${Math.round(pw * 0.035)}px;border-radius:99px;background:rgba(255,255,255,.6)"></span></span>`
      return box(`<div class="an-ph" id="${id}ph" style="left:${Math.round((f.w - pw) / 2)}px;top:0;width:${pw}px;height:${ph}px;border:3px solid ${P.line};border-radius:${Math.round(pw * 0.16)}px;overflow:hidden;background:${P.soft}">
        <span class="an-feed" id="${id}fd">${card(2, P.acc)}${card(31, P.line)}${card(60, P.acc)}${card(89, P.line)}${card(118, P.acc)}</span>
      </div>`)
    }
    case 'money': {
      // Un compteur qui monte + des jetons qui s'empilent. Une SCÈNE, pas une icône :
      // c'est le langage des animations d'origine (cadres, cartes, barres) qu'Axel a
      // validées — un pictogramme isolé fait clipart.
      const cw = Math.round(f.w * 0.54), ch = Math.round(f.h * 0.3)
      const cx = Math.round((f.w - cw) / 2)
      let coins = ''
      for (let k = 0; k < 4; k++) {
        const cd = Math.round(f.h * 0.13)
        coins += `<span class="an-p an-coin" id="${id}c${k}" style="left:${Math.round(f.w / 2 - cd / 2 + (k - 1.5) * cd * 1.15)}px;top:${Math.round(f.h * 0.62)}px;width:${cd}px;height:${cd}px;border-radius:50%;background:${k % 2 ? P.acc : P.ink}"></span>`
      }
      return box(`<div class="an-p" id="${id}cd" style="left:${cx}px;top:${Math.round(f.h * 0.16)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(ch * 0.16)}px;background:${P.soft};border:2px solid ${P.line}">
          <span class="an-p" style="left:8%;top:20%;width:34%;height:12%;border-radius:99px;background:${P.line}"></span>
          <span class="an-p an-amt" id="${id}am" style="left:8%;top:44%;width:64%;height:30%;border-radius:${Math.round(ch * 0.08)}px;background:${P.acc}"></span>
        </div>${coins}`)
    }
    case 'idea': {
      // Des fragments qui convergent et forment un bloc net : l'idée qui se précise.
      const d = Math.round(f.h * 0.4), cx = Math.round(f.w / 2), cy = Math.round(f.h * 0.46)
      let bits = ''
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2, R = f.h * 0.34
        bits += `<span class="an-p an-bit" id="${id}f${k}" style="left:${Math.round(cx + Math.cos(a) * R - d * 0.13)}px;top:${Math.round(cy + Math.sin(a) * R - d * 0.13)}px;width:${Math.round(d * 0.26)}px;height:${Math.round(d * 0.26)}px;border-radius:${Math.round(d * 0.07)}px;background:${P.line}"></span>`
      }
      return box(`${bits}<span class="an-p" id="${id}co" style="left:${cx - Math.round(d / 2)}px;top:${cy - Math.round(d / 2)}px;width:${d}px;height:${d}px;border-radius:${Math.round(d * 0.22)}px;background:${P.acc}"></span>`)
    }
    case 'target': {
      // Un anneau de progression qui se remplit jusqu'au bout : l'objectif atteint.
      const d = Math.round(f.h * 0.66), cx = Math.round(f.w / 2), cy = Math.round(f.h / 2)
      const sw = Math.round(d * 0.1), R = (d - sw) / 2
      const C = Math.round(2 * Math.PI * R)
      return box(`<svg width="${d}" height="${d}" viewBox="0 0 ${d} ${d}" style="position:absolute;left:${cx - Math.round(d / 2)}px;top:${cy - Math.round(d / 2)}px">
          <circle cx="${d / 2}" cy="${d / 2}" r="${R}" fill="none" stroke="${P.line}" stroke-width="${sw}" />
          <circle id="${id}ring" cx="${d / 2}" cy="${d / 2}" r="${R}" fill="none" stroke="${P.acc}" stroke-width="${sw}" stroke-linecap="round"
            stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 ${d / 2} ${d / 2})" />
        </svg>
        <span class="an-p" id="${id}dot" style="left:${cx - Math.round(d * 0.11)}px;top:${cy - Math.round(d * 0.11)}px;width:${Math.round(d * 0.22)}px;height:${Math.round(d * 0.22)}px;border-radius:50%;background:${P.acc}"></span>`)
    }
    case 'lock': {
      // Un champ de saisie dont les caractères deviennent des points : c'est protégé.
      const bw = Math.round(f.w * 0.6), bh = Math.round(f.h * 0.19)
      const x = Math.round((f.w - bw) / 2), y = Math.round(f.h * 0.4)
      let dots = ''
      for (let k = 0; k < 5; k++) {
        const dd = Math.round(bh * 0.3)
        dots += `<span class="an-p an-dot" id="${id}d${k}" style="left:${x + Math.round(bw * 0.1) + k * Math.round(dd * 1.7)}px;top:${y + Math.round((bh - dd) / 2)}px;width:${dd}px;height:${dd}px;border-radius:50%;background:${P.ink}"></span>`
      }
      const sh = Math.round(bh * 0.7)
      return box(`<span class="an-p" id="${id}bx" style="left:${x}px;top:${y}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.28)}px;background:${P.soft};border:2px solid ${P.line}"></span>${dots}
        <span class="an-p" id="${id}sh" style="left:${x + bw - Math.round(sh * 1.5)}px;top:${y - Math.round(sh * 0.72)}px;width:${sh}px;height:${sh}px;border:${Math.round(sh * 0.17)}px solid ${P.acc};border-bottom:0;border-radius:${Math.round(sh * 0.5)}px ${Math.round(sh * 0.5)}px 0 0"></span>`)
    }
    case 'search': {
      // Une barre de recherche qu'on remplit, puis des résultats qui tombent.
      const bw = Math.round(f.w * 0.66), bh = Math.round(f.h * 0.15)
      const x = Math.round((f.w - bw) / 2)
      let rows = ''
      for (let k = 0; k < 3; k++) {
        rows += `<span class="an-p an-res" id="${id}r${k}" style="left:${x}px;top:${Math.round(f.h * 0.36 + k * bh * 1.24)}px;width:${Math.round(bw * (1 - k * 0.12))}px;height:${Math.round(bh * 0.72)}px;border-radius:${Math.round(bh * 0.2)}px;background:${k === 0 ? P.acc : P.soft}"></span>`
      }
      return box(`<span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.13)}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.3)}px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p" id="${id}ty" style="left:${x + Math.round(bh * 0.5)}px;top:${Math.round(f.h * 0.13 + bh * 0.36)}px;width:4px;height:${Math.round(bh * 0.3)}px;border-radius:99px;background:${P.ink}"></span>${rows}`)
    }
    case 'rocket': {
      // Une courbe qui décolle avec sa traînée : la montée en flèche.
      const w2 = Math.round(f.w * 0.62), h2 = Math.round(f.h * 0.56)
      const x = Math.round((f.w - w2) / 2), y = Math.round(f.h * 0.2)
      return box(`<svg width="${w2}" height="${h2}" viewBox="0 0 100 80" preserveAspectRatio="none" style="position:absolute;left:${x}px;top:${y}px">
          <path id="${id}tr" d="M4 76 C28 74 44 56 58 34 C68 18 78 8 96 4" fill="none" stroke="${P.acc}" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="180" stroke-dashoffset="180" />
        </svg>
        <span class="an-p" id="${id}hd" style="left:${x + w2 - Math.round(f.h * 0.07)}px;top:${y - Math.round(f.h * 0.02)}px;width:${Math.round(f.h * 0.11)}px;height:${Math.round(f.h * 0.11)}px;border-radius:50%;background:${P.acc}"></span>`)
    }
    case 'network': {
      // Des profils qui se relient : le réseau, la communauté.
      const n = 5, R = Math.round(f.h * 0.32), cx = Math.round(f.w / 2), cy = Math.round(f.h * 0.5)
      const cd = Math.round(f.h * 0.16)
      let h = ''
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 - Math.PI / 2
        const px = Math.round(cx + Math.cos(a) * R), py = Math.round(cy + Math.sin(a) * R)
        h += `<span class="an-p an-ln" id="${id}l${k}" style="left:${cx}px;top:${cy}px;width:${R}px;height:${Math.max(3, Math.round(f.h * 0.008))}px;background:${P.ink};opacity:.28;transform:rotate(${Math.round((a * 180) / Math.PI)}deg);transform-origin:0 50%"></span>`
        h += `<span class="an-p an-av" id="${id}a${k}" style="left:${px - Math.round(cd / 2)}px;top:${py - Math.round(cd / 2)}px;width:${cd}px;height:${cd}px;border-radius:${Math.round(cd * 0.32)}px;background:${k === 0 ? P.acc : P.soft};border:2px solid ${P.line}">
          <span class="an-p" style="left:28%;top:18%;width:44%;height:36%;border-radius:50%;background:${k === 0 ? 'rgba(255,255,255,.85)' : P.line}"></span>
          <span class="an-p" style="left:20%;top:60%;width:60%;height:30%;border-radius:${Math.round(cd * 0.3)}px ${Math.round(cd * 0.3)}px 0 0;background:${k === 0 ? 'rgba(255,255,255,.85)' : P.line}"></span></span>`
      }
      return box(h)
    }
    case 'check': {
      // Une liste dont les lignes se cochent une par une : tout est inclus.
      const rw = Math.round(f.w * 0.62), rh = Math.round(f.h * 0.16)
      const x = Math.round((f.w - rw) / 2)
      let h = ''
      for (let k = 0; k < 3; k++) {
        const y = Math.round(f.h * 0.16 + k * rh * 1.4)
        const bd = Math.round(rh * 0.6)
        h += `<span class="an-p an-row" id="${id}w${k}" style="left:${x}px;top:${y}px;width:${rw}px;height:${rh}px;border-radius:${Math.round(rh * 0.26)}px;background:${P.soft}"></span>
          <span class="an-p an-bx" id="${id}k${k}" style="left:${x + Math.round(rh * 0.3)}px;top:${y + Math.round((rh - bd) / 2)}px;width:${bd}px;height:${bd}px;border-radius:${Math.round(bd * 0.3)}px;background:${P.acc}">
            <svg width="${bd}" height="${bd}" viewBox="0 0 100 100"><path id="${id}p${k}" d="M26 52 L44 70 L75 34" fill="none" stroke="#FFF" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="90" stroke-dashoffset="90" /></svg></span>
          <span class="an-p" style="left:${x + Math.round(rh * 1.15)}px;top:${y + Math.round(rh * 0.38)}px;width:${Math.round(rw * (0.5 - k * 0.08))}px;height:${Math.round(rh * 0.22)}px;border-radius:99px;background:${P.line}"></span>`
      }
      return box(h)
    }
    case 'screen': {
      // MODE PRESENTATION 3D. L'interface sur un plan incline, un zoom sur la zone
      // dont il parle, et un cadre qui l'entoure. Si une SECONDE cible est donnee
      // (screenX2/Y2), la camera DESCEND de la premiere a la seconde sans coupure :
      // sur l'audio de test, « fruit » et « format » sont dits a 0,54 s d'intervalle,
      // deux plans separes n'y tiennent pas — il faut un travelling.
      // La reference d'Axel (hugomatias / avatarads-express-3d) : l'ecran flotte
      // dans une PIECE SOMBRE avec une lueur orange et une retombee de lumiere au
      // sol, incline franchement — pas une carte posee sur du blanc. On sort donc
      // du fond clair du mode mot-a-mot sur toute la duree du plan.
      if (!s.screenFile) return ''
      // MOT-A-MOT : l'ecran REMPLIT le cadre comme dans la reference — il deborde
      // volontairement de chaque cote et se centre sur toute la hauteur, sinon il
      // reste coince en haut avec du vide dessous. Ce cadrage est valide, on n'y
      // touche pas.
      // TOUS LES AUTRES STYLES (apple, editorial, glass) : la vidéo occupe le bas du
      // cadre. Un ecran calibre pour le plein cadre y debordait sur la video et se
      // faisait couper a droite. Ici il tient dans la zone sure, au-dessus.
      const wide = vs === 'word'
      const w = wide ? Math.round(W * 1.5) : Math.round(f.h * 0.96 / 0.625)
      const h = Math.round(w * 0.625)
      const mkBox = (bx, by, bw, bh2, n) => (bw > 0 && bh2 > 0)
        ? `<span class="an-3dbox" id="${id}bx${n}" style="left:${((bx - bw / 2) * 100).toFixed(2)}%;top:${((by - bh2 / 2) * 100).toFixed(2)}%;width:${(bw * 100).toFixed(2)}%;height:${(bh2 * 100).toFixed(2)}%;border-color:${P.acc}"></span>`
        : ''
      const b1 = mkBox(typeof s.boxX === 'number' ? s.boxX : 0, typeof s.boxY === 'number' ? s.boxY : 0, s.boxW || 0, s.boxH || 0, 1)
      const b2 = mkBox(typeof s.boxX2 === 'number' ? s.boxX2 : 0, typeof s.boxY2 === 'number' ? s.boxY2 : 0, s.boxW2 || 0, s.boxH2 || 0, 2)
      // Axel : « non non toujours sur du blanc ». La reference servait a montrer la
      // PERSPECTIVE voulue, pas a changer le fond : on garde donc le fond clair du
      // mot-a-mot et on ne retient que l'inclinaison franche et la profondeur.
      const typed = String(s.screenText || '')
      const tz = typed && s.boxW > 0
        ? `<span class="an-3dtype" id="${id}tp" style="left:${((s.boxX - s.boxW / 2) * 100).toFixed(2)}%;top:${((s.boxY - s.boxH / 2) * 100).toFixed(2)}%;width:${(s.boxW * 100).toFixed(2)}%;height:${(s.boxH * 100).toFixed(2)}%;font-size:${Math.round(h * 0.030)}px"><span id="${id}tt"></span><i class="an-3dcar" style="background:${P.acc}"></i></span>`
        : ''
      return `<div class="an-stage" id="${id}rm">
        <div class="an-3d" id="${id}sc" style="left:${Math.round((W - w) / 2)}px;top:${wide ? Math.round(H * 0.30 - h / 2) : Math.round(f.y + (f.h - h) / 2)}px;width:${w}px;height:${h}px">
          <div class="an-3di">
            <div class="an-3dz" id="${id}z"><img src="${s.screenFile}" alt="" />${b1}${b2}${tz}</div>
          </div>
        </div>
      </div>`
    }
    case 'result': {
      // LE RESULTAT. Axel : « dommage qu'on n'ait pas le resultat de l'Images IA ».
      // Apres l'ecran de generation, on montre l'image qui vient de sortir, puis le
      // geste d'enregistrement — c'est ce qu'il voulait montrer : on la garde pour
      // la reutiliser. L'image est FOURNIE (screenFile), jamais inventee ici.
      if (!s.screenFile) return ''
      // c'est le moment de recompense : l'image occupe le cadre, pas une vignette.
      // Même règle que pour `screen` : plein cadre en mot-à-mot, contenu dans la zone
      // sûre partout ailleurs — sinon le tirage recouvre la vidéo au lieu de la coiffer.
      const wideR = vs === 'word'
      const ph = wideR ? Math.round(H * 0.46) : Math.round(f.h * 0.96)
      const pw = Math.round(ph * 0.6667)
      return `<div class="an-stage"><div class="an-res" id="${id}rs" style="left:${Math.round((W - pw) / 2)}px;top:${wideR ? Math.round(H * 0.30 - ph / 2) : Math.round(f.y + (f.h - ph) / 2)}px;width:${pw}px;height:${ph}px">
        <img src="${s.screenFile}" alt="" />
        <span class="an-res-flash" id="${id}fl"></span>
        <span class="an-res-save" id="${id}sv" style="background:${P.acc}">
          <svg width="${Math.round(pw * 0.11)}" height="${Math.round(pw * 0.11)}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        </span>
      </div></div>`
    }
    case 'countup': {
      // LE CHIFFRE QUI DEFILE. Axel : « une animation 0 a 3 millions de vues pour
      // "ca cartonne", pareil de 0 a 8000 € quand on parle d'argent ». La valeur
      // vient de ce qu'il DIT (extraite de la transcription cote serveur), jamais
      // inventee ici.
      const val = String(s.value || '')
      const unit = String(s.unit || '')
      if (!val) return ''
      const fs = Math.round(f.h * 0.30)
      return box(`<div class="an-cu" id="${id}cu">
        <span class="an-cun" id="${id}cun" style="font-size:${fs}px;color:${P.ink}">0</span>
        ${unit ? `<span class="an-cuu" id="${id}cuu" style="font-size:${Math.round(fs * 0.34)}px;color:${P.acc}">${esc(unit)}</span>` : ''}
        <span class="an-cub" id="${id}cub" style="background:${P.acc}"></span>
      </div>`)
    }
    case 'flow': {
      // A RELIE B RELIE C — le schema qu'Axel montre (Budget -> Leads -> Clients) :
      // des etapes reliees par des fleches qui se tracent l'une apres l'autre.
      // Les libelles viennent des items de la scene ; sans texte, des blocs muets.
      const labs = (items.length ? items : ['', '', '']).slice(0, 3)
      const n = labs.length
      const d = Math.round(f.h * 0.26)
      const fs = Math.round(f.h * 0.075)
      let h = ''
      for (let k = 0; k < n; k++) {
        const cx = Math.round(f.w * (k % 2 === 0 ? 0.30 : 0.70))
        const cy = Math.round(f.h * (0.16 + k * 0.33))
        h += `<span class="an-p an-nd" id="${id}n${k}" style="left:${cx - d / 2}px;top:${cy - d / 2}px;width:${d}px;height:${d}px;border-radius:${Math.round(d * 0.26)}px;background:${k === n - 1 ? P.acc : P.soft};border:3px solid ${k === n - 1 ? P.acc : P.line};display:flex;align-items:center;justify-content:center">
          <span class="an-p" style="position:relative;left:auto;top:auto;width:52%;height:14%;border-radius:99px;background:${k === n - 1 ? 'rgba(255,255,255,.9)' : P.line}"></span></span>`
        if (labs[k]) h += `<span class="an-p an-lb" id="${id}t${k}" style="left:${cx - Math.round(f.w * 0.24)}px;top:${cy + d / 2 + 6}px;width:${Math.round(f.w * 0.48)}px;text-align:center;font-size:${fs}px;color:${P.ink}">${esc(String(labs[k]).slice(0, 14))}</span>`
        if (k < n - 1) {
          const nx = Math.round(f.w * ((k + 1) % 2 === 0 ? 0.30 : 0.70))
          const ny = Math.round(f.h * (0.16 + (k + 1) * 0.33))
          const dx = nx - cx, dy = ny - cy
          const len = Math.round(Math.sqrt(dx * dx + dy * dy) - d)
          const ang = Math.round((Math.atan2(dy, dx) * 180) / Math.PI)
          h += `<span class="an-p an-ar" id="${id}a${k}" style="left:${cx}px;top:${cy}px;width:${len}px;height:${Math.max(4, Math.round(f.h * 0.012))}px;background:${P.ink};opacity:.5;transform:rotate(${ang}deg) translateX(${Math.round(d * 0.55)}px);transform-origin:0 50%;border-radius:99px"></span>`
        }
      }
      return box(h)
    }
    case 'funnel': {
      // un entonnoir : beaucoup entrent, peu ressortent
      const w0 = Math.round(f.w * 0.62), hh = Math.round(f.h * 0.2)
      let h = ''
      for (let k = 0; k < 3; k++) {
        const ww = Math.round(w0 * (1 - k * 0.28))
        h += `<span class="an-p an-fn" id="${id}f${k}" style="left:${Math.round((f.w - ww) / 2)}px;top:${Math.round(f.h * 0.12 + k * hh * 1.35)}px;width:${ww}px;height:${hh}px;border-radius:${Math.round(hh * 0.22)}px;background:${k === 2 ? P.acc : P.soft};border:2px solid ${P.line}"></span>`
      }
      return box(h)
    }
    case 'orbit': {
      // un centre et des satellites qui tournent : tout part d'un seul outil
      const cd = Math.round(f.h * 0.2), R = Math.round(f.h * 0.34)
      const cx = Math.round(f.w / 2), cy = Math.round(f.h * 0.5)
      let h = `<span class="an-p" id="${id}c" style="left:${cx - cd / 2}px;top:${cy - cd / 2}px;width:${cd}px;height:${cd}px;border-radius:${Math.round(cd * 0.28)}px;background:${P.acc}"></span>`
      h += `<span class="an-p an-orb" id="${id}o" style="left:${cx - R}px;top:${cy - R}px;width:${R * 2}px;height:${R * 2}px;border-radius:50%;border:3px dashed ${P.line}"></span>`
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2, sd = Math.round(cd * 0.5)
        h += `<span class="an-p an-sat" id="${id}s${k}" style="left:${Math.round(cx + Math.cos(a) * R - sd / 2)}px;top:${Math.round(cy + Math.sin(a) * R - sd / 2)}px;width:${sd}px;height:${sd}px;border-radius:${Math.round(sd * 0.3)}px;background:${P.soft};border:2px solid ${P.line}"></span>`
      }
      return box(h)
    }
    case 'bars2': {
      // deux colonnes qui montent a des vitesses differentes : la comparaison chiffree
      const bw = Math.round(f.w * 0.16), gap = Math.round(f.w * 0.14)
      const x0 = Math.round((f.w - (2 * bw + gap)) / 2)
      const hmax = Math.round(f.h * 0.62)
      let h = ''
      for (let k = 0; k < 2; k++) {
        const hh = Math.round(hmax * (k === 0 ? 0.38 : 1))
        h += `<span class="an-p an-b2" id="${id}b${k}" style="left:${x0 + k * (bw + gap)}px;top:${Math.round(f.h * 0.8) - hh}px;width:${bw}px;height:${hh}px;border-radius:${Math.round(bw * 0.18)}px ${Math.round(bw * 0.18)}px 0 0;background:${k === 1 ? P.acc : P.soft}"></span>`
      }
      return box(h)
    }
    case 'wallet': {
      // un portefeuille qui se remplit de cartes : ce que ca rapporte
      const ww = Math.round(f.w * 0.5), wh = Math.round(ww * 0.66)
      const x = Math.round((f.w - ww) / 2), y = Math.round(f.h * 0.42)
      let h = ''
      for (let k = 0; k < 3; k++) {
        h += `<span class="an-p an-cd" id="${id}c${k}" style="left:${x + Math.round(ww * 0.1) + k * Math.round(ww * 0.1)}px;top:${y - Math.round(wh * 0.42) - k * Math.round(wh * 0.13)}px;width:${Math.round(ww * 0.62)}px;height:${Math.round(wh * 0.5)}px;border-radius:${Math.round(wh * 0.08)}px;background:${k === 2 ? P.acc : P.soft};border:2px solid ${P.line}"></span>`
      }
      h += `<span class="an-p" id="${id}w" style="left:${x}px;top:${y}px;width:${ww}px;height:${wh}px;border-radius:${Math.round(wh * 0.16)}px;background:${P.ink}"></span>`
      return box(h)
    }
    case 'swipe': {
      // Un fil qui défile vite dans un téléphone : le scroll, le feed.
      const pw = Math.round(f.h * 0.52), ph = f.h, px = Math.round((f.w - pw) / 2)
      const ch = Math.round(ph * 0.26)
      let cards = ''
      for (let k = 0; k < 5; k++) {
        cards += `<span class="an-p an-sw" id="${id}s${k}" style="left:6%;top:${k * Math.round(ch * 1.12)}px;width:88%;height:${ch}px;border-radius:${Math.round(ch * 0.14)}px;background:${k === 1 ? P.acc : P.soft}"></span>`
      }
      return box(`<div class="an-ph" style="left:${px}px;top:0;width:${pw}px;height:${ph}px;border:3px solid ${P.line};border-radius:${Math.round(pw * 0.14)}px;overflow:hidden">
        <div class="an-p" id="${id}fd" style="left:0;top:0;width:100%;height:${Math.round(ch * 1.12 * 5)}px">${cards}</div></div>`)
    }
    case 'views': {
      // Un compteur de vues qui grimpe, avec sa barre : la portée.
      const bw = Math.round(f.w * 0.62), bh = Math.round(f.h * 0.16)
      const x = Math.round((f.w - bw) / 2)
      return box(`<span class="an-p" id="${id}pl" style="left:${Math.round(f.w / 2 - f.h * 0.11)}px;top:${Math.round(f.h * 0.1)}px;width:${Math.round(f.h * 0.22)}px;height:${Math.round(f.h * 0.22)}px;border-radius:50%;background:${P.acc}">
          <svg viewBox="0 0 100 100" width="100%" height="100%"><path d="M40 30 L72 50 L40 70 Z" fill="#FFF"/></svg></span>
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.46)}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.3)}px;background:${P.soft}"></span>
        <span class="an-p" id="${id}bar" style="left:${x}px;top:${Math.round(f.h * 0.46)}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.3)}px;background:${P.acc}"></span>
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.7)}px;width:${Math.round(bw * 0.42)}px;height:${Math.round(bh * 0.4)}px;border-radius:99px;background:${P.line}"></span>`)
    }
    case 'engage': {
      // Des bulles de commentaire et des cœurs qui montent : l'engagement.
      const bw = Math.round(f.w * 0.42), bh = Math.round(f.h * 0.17)
      let h = ''
      for (let k = 0; k < 3; k++) {
        h += `<span class="an-p an-bub" id="${id}b${k}" style="left:${Math.round(f.w * (k % 2 ? 0.5 : 0.1))}px;top:${Math.round(f.h * (0.08 + k * 0.26))}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.36)}px ${Math.round(bh * 0.36)}px ${Math.round(bh * 0.36)}px ${Math.round(bh * 0.1)}px;background:${k === 1 ? P.acc : P.soft}"></span>`
      }
      for (let k = 0; k < 4; k++) {
        const hd = Math.round(f.h * 0.11)
        h += `<span class="an-p an-hrt" id="${id}h${k}" style="left:${Math.round(f.w * (0.68 + (k % 2) * 0.12))}px;top:${Math.round(f.h * 0.72)}px;width:${hd}px;height:${hd}px">
          <svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 21s-8-5.2-8-10a4.6 4.6 0 018-3 4.6 4.6 0 018 3c0 4.8-8 10-8 10z" fill="${P.acc}"/></svg></span>`
      }
      return box(h)
    }
    case 'calendar': {
      // Une grille de semaine qui se remplit : publier régulièrement.
      const cols = 4, rows = 3
      const cw = Math.round(f.w * 0.15), gap = Math.round(cw * 0.24)
      const gw = cols * cw + (cols - 1) * gap
      const x = Math.round((f.w - gw) / 2), y = Math.round(f.h * 0.16)
      let h = ''
      for (let k = 0; k < cols * rows; k++) {
        h += `<span class="an-p an-cell" id="${id}c${k}" style="left:${x + (k % cols) * (cw + gap)}px;top:${y + Math.floor(k / cols) * (cw + gap)}px;width:${cw}px;height:${cw}px;border-radius:${Math.round(cw * 0.22)}px;background:${k % 3 === 1 ? P.acc : P.soft}"></span>`
      }
      return box(h)
    }
    case 'upload': {
      // Une carte qui s'envole vers une barre : publier, mettre en ligne.
      const cw = Math.round(f.w * 0.34), ch = Math.round(cw * 1.3)
      return box(`<span class="an-p" style="left:${Math.round(f.w * 0.16)}px;top:${Math.round(f.h * 0.08)}px;width:${Math.round(f.w * 0.68)}px;height:${Math.round(f.h * 0.1)}px;border-radius:99px;background:${P.soft};border:2px dashed ${P.line}"></span>
        <span class="an-p" id="${id}cd" style="left:${Math.round((f.w - cw) / 2)}px;top:${Math.round(f.h * 0.42)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw * 0.12)}px;background:${P.acc}"></span>
        <span class="an-p" id="${id}ar" style="left:${Math.round(f.w / 2 - f.h * 0.035)}px;top:${Math.round(f.h * 0.26)}px;width:${Math.round(f.h * 0.07)}px;height:${Math.round(f.h * 0.12)}px;background:${P.ink};clip-path:polygon(50% 0,100% 55%,72% 55%,72% 100%,28% 100%,28% 55%,0 55%)"></span>`)
    }
    case 'stack': {
      // Des vidéos qui s'empilent : le volume, produire en série.
      const cw = Math.round(f.w * 0.42), ch = Math.round(cw * 1.42)
      let h = ''
      for (let k = 0; k < 4; k++) {
        h += `<span class="an-p an-st" id="${id}s${k}" style="left:${Math.round((f.w - cw) / 2 + (k - 1.5) * cw * 0.22)}px;top:${Math.round((f.h - ch) / 2 + (k - 1.5) * ch * 0.06)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw * 0.12)}px;background:${k === 3 ? P.acc : P.soft};border:2px solid ${P.line}"></span>`
      }
      return box(h)
    }
    case 'swap': {
      // Une chose remplacée par une autre : au lieu de, à la place.
      const cw = Math.round(f.w * 0.34), ch = Math.round(f.h * 0.46)
      return box(`<span class="an-p" id="${id}a" style="left:${Math.round(f.w * 0.08)}px;top:${Math.round((f.h - ch) / 2)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw * 0.12)}px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p" id="${id}b" style="left:${Math.round(f.w * 0.58)}px;top:${Math.round((f.h - ch) / 2)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw * 0.12)}px;background:${P.acc}"></span>
        <span class="an-p" id="${id}ar" style="left:${Math.round(f.w * 0.45)}px;top:${Math.round(f.h * 0.47)}px;width:${Math.round(f.w * 0.1)}px;height:${Math.max(4, Math.round(f.h * 0.014))}px;border-radius:99px;background:${P.ink}"></span>`)
    }
    case 'cut': {
      // Une timeline qu'on coupe : le montage, la découpe.
      const bw = Math.round(f.w * 0.76), bh = Math.round(f.h * 0.22)
      const x = Math.round((f.w - bw) / 2), y = Math.round((f.h - bh) / 2)
      return box(`<span class="an-p" id="${id}l" style="left:${x}px;top:${y}px;width:${Math.round(bw * 0.46)}px;height:${bh}px;border-radius:${Math.round(bh * 0.16)}px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p" id="${id}r" style="left:${x + Math.round(bw * 0.54)}px;top:${y}px;width:${Math.round(bw * 0.46)}px;height:${bh}px;border-radius:${Math.round(bh * 0.16)}px;background:${P.acc}"></span>
        <span class="an-p" id="${id}k" style="left:${x + Math.round(bw * 0.49)}px;top:${y - Math.round(bh * 0.3)}px;width:${Math.max(4, Math.round(f.w * 0.012))}px;height:${Math.round(bh * 1.6)}px;background:${P.ink}"></span>`)
    }
    case 'steps': {
      // 1 · 2 · 3 : une méthode en quelques étapes.
      const d = Math.round(f.h * 0.26), gap = Math.round(d * 0.5)
      const tot = 3 * d + 2 * gap, x = Math.round((f.w - tot) / 2)
      let h = ''
      for (let k = 0; k < 3; k++) {
        h += `<span class="an-p an-sp" id="${id}n${k}" style="left:${x + k * (d + gap)}px;top:${Math.round((f.h - d) / 2)}px;width:${d}px;height:${d}px;border-radius:50%;background:${k === 0 ? P.acc : P.soft};border:2px solid ${P.line};display:flex;align-items:center;justify-content:center">
          <span class="an-p" style="position:relative;left:auto;top:auto;width:${Math.round(d * 0.16)}px;height:${Math.round(d * 0.42)}px;border-radius:99px;background:${k === 0 ? '#FFF' : P.line}"></span></span>`
        if (k < 2) h += `<span class="an-p an-lk" id="${id}k${k}" style="left:${x + k * (d + gap) + d}px;top:${Math.round(f.h / 2)}px;width:${gap}px;height:${Math.max(3, Math.round(f.h * 0.01))}px;background:${P.line}"></span>`
      }
      return box(h)
    }
    case 'toggle': {
      // Un interrupteur qui s'allume : activer, en un clic.
      const tw = Math.round(f.w * 0.44), th = Math.round(tw * 0.52)
      const x = Math.round((f.w - tw) / 2), y = Math.round((f.h - th) / 2)
      const kd = Math.round(th * 0.76)
      return box(`<span class="an-p" id="${id}tr" style="left:${x}px;top:${y}px;width:${tw}px;height:${th}px;border-radius:99px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p" id="${id}kn" style="left:${x + Math.round((th - kd) / 2)}px;top:${y + Math.round((th - kd) / 2)}px;width:${kd}px;height:${kd}px;border-radius:50%;background:${P.ink}"></span>`)
    }
    case 'faceless': {
      // « sans jamais montrer ton visage » : une tête, puis une bande qui masque
      // les yeux. C'est la promesse la plus forte du script — elle ne peut pas
      // rester nue à l'écran.
      const d = Math.round(f.h * 0.40)
      const cx = Math.round(f.w / 2), top = Math.round(f.h * 0.10)
      const ey = Math.round(top + d * 0.42), er = Math.round(d * 0.09)
      const bw = Math.round(d * 1.22), bh = Math.round(d * 0.26)
      const eye = (dx, k) => `<span class="an-p" id="${id}e${k}" style="left:${cx + dx - er}px;top:${ey - er}px;width:${er * 2}px;height:${er * 2}px;border-radius:50%;background:#FFFFFF"></span>`
      return box(`<span class="an-p" id="${id}hd" style="left:${cx - Math.round(d / 2)}px;top:${top}px;width:${d}px;height:${d}px;border-radius:50%;background:${P.acc}"></span>
        ${eye(-Math.round(d * 0.17), 1)}${eye(Math.round(d * 0.17), 2)}
        <span class="an-p" id="${id}bd" style="left:${cx - Math.round(d * 0.62)}px;top:${top + Math.round(d * 1.14)}px;width:${Math.round(d * 1.24)}px;height:${Math.round(f.h * 0.30)}px;border-radius:${Math.round(d * 0.62)}px ${Math.round(d * 0.62)}px 0 0;background:${P.acc}"></span>
        <span class="an-p" id="${id}br" style="left:${cx - Math.round(bw / 2)}px;top:${ey - Math.round(bh / 2)}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.22)}px;background:${P.ink}"></span>`)
    }
    case 'logo': {
      // Le logo de la marque, quand il prononce son nom. Il vient du JOB (brand/logo.png,
      // copié depuis le dossier de l'utilisateur) — jamais d'un fichier livré avec le
      // worker : un logo codé en dur serait celui d'AvatarAds sur la vidéo de n'importe
      // quel client. Si le job n'en fournit pas, `logoFile` est vide et rien ne rend.
      if (!s.logoFile) return ''
      // EN GRAND : le logo prend toute la largeur utile de la zone sure. C'est le
      // moment ou la marque se grave — un logotype timide ne sert a rien.
      const d = Math.min(Math.round(f.w * 0.92), Math.round(f.h * 1.0))
      return box(`<div class="an-lg" id="${id}lg" style="left:${Math.round((f.w - d) / 2)}px;top:${Math.round((f.h - d) / 2)}px;width:${d}px;height:${d}px">
        <span class="an-halo" id="${id}ha" style="border:${Math.round(d * 0.02)}px solid ${P.acc}"></span>
        <img src="${s.logoFile}" alt="" id="${id}im" />
      </div>`)
    }
    case 'avatar': {
      // Une silhouette qui se compose dans un cadre vertical : la génération d'un
      // avatar. Une capture de l'écran « Choisis ton avatar » ne montre rien en 2 s.
      const pw = Math.round(f.h * 0.5), ph = f.h, px = Math.round((f.w - pw) / 2)
      const hd = Math.round(pw * 0.34)
      return box(`<div class="an-ph" id="${id}ph" style="left:${px}px;top:0;width:${pw}px;height:${ph}px;border:3px solid ${P.line};border-radius:${Math.round(pw * 0.14)}px;overflow:hidden;background:${P.soft}">
        <span class="an-p" id="${id}hd" style="left:50%;margin-left:-${Math.round(hd / 2)}px;top:${Math.round(ph * 0.2)}px;width:${hd}px;height:${hd}px;border-radius:50%;background:${P.acc}"></span>
        <span class="an-p" id="${id}bd" style="left:50%;margin-left:-${Math.round(pw * 0.31)}px;top:${Math.round(ph * 0.2 + hd * 1.18)}px;width:${Math.round(pw * 0.62)}px;height:${Math.round(ph * 0.34)}px;border-radius:${Math.round(pw * 0.3)}px ${Math.round(pw * 0.3)}px 0 0;background:${P.acc}"></span>
        <span class="an-p" id="${id}sc" style="left:0;top:0;width:100%;height:3px;background:${P.ink};opacity:.55"></span>
      </div>`)
    }
    default: { // clock — le temps qui passe, la rapidité
      const d = Math.round(f.h * 0.82)
      return box(`<div class="an-cl" id="${id}cl" style="left:${Math.round((f.w - d) / 2)}px;top:${Math.round((f.h - d) / 2)}px;width:${d}px;height:${d}px;border:${Math.round(d * 0.07)}px solid ${P.line};border-radius:50%">
        <span class="an-hand" id="${id}hd" style="height:${Math.round(d * 0.34)}px;background:${P.acc}"></span>
      </div>`)
    }
  }
}

export function animJs(name, s, r2) {
  const id = s.id, t0 = r2(s.start + 0.05), end = r2(s.start + s.dur)
  const dur = r2(Math.max(0.6, s.dur - 0.3))
  const inOut = `
      tl.fromTo('#${id}an', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, ${t0});
      tl.to('#${id}an', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, ${r2(end - 0.2)});`
  switch (name) {
    case 'split':
      return inOut + `
      tl.fromTo('#${id}ph', { scale: 0.88, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, ease: 'back.out(1.8)' }, ${t0});
      tl.fromTo('#${id}sep', { scaleX: 0 }, { scaleX: 1, duration: 0.34, ease: 'power3.inOut', transformOrigin: '50% 50%' }, ${r2(t0 + 0.3)});
      tl.fromTo('#${id}p1', { y: 0 }, { y: -6, duration: 0.3, ease: 'power2.out' }, ${r2(t0 + 0.32)});
      tl.fromTo('#${id}p2', { y: 0 }, { y: 6, duration: 0.3, ease: 'power2.out' }, ${r2(t0 + 0.32)});`
    case 'voice':
      return inOut + `
      tl.fromTo('#${id}an .w1', { scaleY: 0.15 }, { scaleY: 1, duration: 0.5, stagger: 0.02, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an .w2', { scaleY: 0.15, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.5, stagger: 0.02, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.35)});`
    case 'list':
      return inOut + `
      tl.fromTo('#${id}an .an-r', { x: -40, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.3, stagger: 0.09, ease: 'power2.out' }, ${t0});`
    case 'grow':
      return inOut + `
      tl.fromTo('#${id}an .an-g', { scaleY: 0 }, { scaleY: 1, duration: 0.4, stagger: 0.07, ease: 'power3.out' }, ${t0});`
    case 'compare':
      return inOut + `
      tl.fromTo('#${id}c1', { y: 0, autoAlpha: 0 }, { y: 24, autoAlpha: 1, duration: 0.45, ease: 'power2.out' }, ${t0});
      tl.fromTo('#${id}c2', { y: 0, autoAlpha: 0 }, { y: -24, autoAlpha: 1, duration: 0.45, ease: 'back.out(1.6)' }, ${r2(t0 + 0.15)});
      tl.fromTo('#${id}gl', { x: '-3%' }, { x: '5%', duration: 0.28, repeat: 3, yoyo: true, ease: 'steps(2)' }, ${r2(t0 + 0.3)});`
    case 'sign': {
      // la signature s'écrit SOUS le stylo qui avance, puis le tampon claque.
      // Le trait est révélé par son propre dash : longueur lue à l'exécution,
      // donc juste quelle que soit la taille de rendu.
      const wr = r2(Math.min(0.95, Math.max(0.5, dur * 0.45)))   // durée d'écriture
      // le stylo parcourt la largeur de la signature = 0.56/0.045 fois sa propre
      // largeur (mêmes ratios que le HTML ci-dessus)
      return inOut + `
      tl.fromTo('#${id}dc', { y: 40, scale: 0.94, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.5)', transformOrigin: '50% 50%' }, ${t0});
      (function(){ var p = document.getElementById('${id}sp');
        if (p && p.getTotalLength) { var L = p.getTotalLength();
          p.style.strokeDasharray = L + ' ' + L; p.style.strokeDashoffset = L; } })();
      tl.to('#${id}sp', { strokeDashoffset: 0, duration: ${wr}, ease: 'power1.inOut' }, ${r2(t0 + 0.34)});
      tl.fromTo('#${id}pn', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16 }, ${r2(t0 + 0.28)});
      tl.fromTo('#${id}pn', { xPercent: 0 }, { xPercent: 1180, duration: ${wr}, ease: 'power1.inOut' }, ${r2(t0 + 0.34)});
      tl.to('#${id}pn', { autoAlpha: 0, duration: 0.18 }, ${r2(t0 + 0.34 + wr)});
      tl.fromTo('#${id}st', { scale: 2.4, opacity: 0, rotation: -34 }, { scale: 1, opacity: 1, rotation: -11, duration: 0.3, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.44 + wr)});`
    }
    case 'tools':
      // les deux outils se rejoignent, le + apparaît entre eux
      return inOut + `
      tl.fromTo('#${id}t1', { xPercent: -60, rotation: -10, autoAlpha: 0 }, { xPercent: 0, rotation: 0, autoAlpha: 1, duration: 0.42, ease: 'back.out(1.7)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}t2', { xPercent: 60, rotation: 10, autoAlpha: 0 }, { xPercent: 0, rotation: 0, autoAlpha: 1, duration: 0.42, ease: 'back.out(1.7)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.16)});
      tl.fromTo(['#${id}pl', '#${id}pv'], { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.26, ease: 'back.out(3)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.52)});
      tl.to(['#${id}t1', '#${id}t2'], { scale: 1.06, duration: ${r2(Math.max(0.5, dur - 0.9))}, ease: 'sine.inOut', transformOrigin: '50% 50%' }, ${r2(t0 + 0.72)});`
    case 'quality':
      // la ligne balaie, le net remplace le flou
      return inOut + `
      tl.fromTo('#${id}qf',{scale:0.94,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'power3.out'},${t0});
      tl.fromTo('#${id}ql',{x:0,autoAlpha:0},{autoAlpha:1,duration:0.14},${r2(t0 + 0.3)});
      tl.to('#${id}qs',{clipPath:'inset(0 0% 0 0)',duration:${r2(Math.max(0.6, dur - 0.9))},ease:'power2.inOut'},${r2(t0 + 0.42)});
      // la ligne suit le bord du révélé : sa course est lue au rendu, donc juste
      // quelle que soit la taille du cadre
      tl.to('#${id}ql',{x:(document.getElementById('${id}qf')||{}).offsetWidth||0,duration:${r2(Math.max(0.6, dur - 0.9))},ease:'power2.inOut'},${r2(t0 + 0.42)});
      tl.to('#${id}ql',{autoAlpha:0,duration:0.2},${r2(t0 + 0.42 + Math.max(0.6, dur - 0.9))});`
    case 'hd':
      return inOut + `
      tl.fromTo('#${id}hb',{scale:0.5,rotation:-8,autoAlpha:0},{scale:1,rotation:0,autoAlpha:1,duration:0.4,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}hr',{scale:1,opacity:0.9},{scale:1.5,opacity:0,duration:0.6,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.3)});
      tl.to('#${id}hb',{scale:1.05,duration:${r2(Math.max(0.4, dur - 0.8))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.45)});`
    case 'podium':
      return inOut + `
      tl.fromTo('#${id}pd1',{scaleY:0},{scaleY:1,duration:0.44,ease:'back.out(1.5)'},${t0});
      tl.fromTo('#${id}pd0',{scaleY:0},{scaleY:1,duration:0.36,ease:'power3.out'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}pd2',{scaleY:0},{scaleY:1,duration:0.36,ease:'power3.out'},${r2(t0 + 0.3)});
      tl.to('#${id}pd1',{y:-10,duration:${r2(Math.max(0.4, dur - 0.9))},ease:'sine.inOut'},${r2(t0 + 0.6)});`
    case 'star':
      return inOut + `
      tl.fromTo('#${id}an [id^="${id}st"]',{scale:0,rotation:-40,autoAlpha:0},{scale:1,rotation:0,autoAlpha:1,duration:0.3,stagger:0.09,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${t0});
      tl.to('#${id}an [id^="${id}st"]',{scale:1.12,duration:0.2,stagger:0.05,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.6)});`
    case 'speed':
      return inOut + `
      (function(){ var p=document.getElementById('${id}sp');
        if(p&&p.getTotalLength){var L=p.getTotalLength();p.style.strokeDasharray=L+' '+L;p.style.strokeDashoffset=L;} })();
      tl.to('#${id}sp',{strokeDashoffset:0,duration:${r2(Math.max(0.5, dur * 0.5))},ease:'power2.out'},${r2(t0 + 0.1)});
      tl.fromTo('#${id}sn',{rotation:-82},{rotation:78,duration:${r2(Math.max(0.5, dur * 0.5))},ease:'power2.out'},${r2(t0 + 0.1)});
      tl.to('#${id}sn',{rotation:70,duration:0.22,yoyo:true,repeat:3,ease:'sine.inOut'},${r2(t0 + 0.15 + Math.max(0.5, dur * 0.5))});`
    case 'hourglass':
      return inOut + `
      tl.fromTo('#${id}gt',{scaleY:1},{scaleY:0,duration:${r2(Math.max(0.7, dur - 0.6))},ease:'none'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}gb',{scaleY:0},{scaleY:1,duration:${r2(Math.max(0.7, dur - 0.6))},ease:'none'},${r2(t0 + 0.2)});`
    case 'deadline':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:40,autoAlpha:0},{y:0,autoAlpha:1,duration:0.4,ease:'power3.out'},${t0});
      tl.fromTo('#${id}dl',{scale:1},{scale:1.55,duration:0.34,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.45)});
      tl.to('#${id}dl',{scale:1.35,duration:0.28,yoyo:true,repeat:3,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.8)});`
    case 'share':
      return inOut + `
      tl.fromTo('#${id}sh0',{scale:0.7,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(1.8)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo(['#${id}sh1','#${id}sh2','#${id}sh3'],{scale:0.4,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,stagger:0.13,ease:'back.out(2.2)',transformOrigin:'50% 50%'},${r2(t0 + 0.34)});`
    case 'dm':
      return inOut + `
      tl.fromTo('#${id}m1',{x:-50,autoAlpha:0},{x:0,autoAlpha:1,duration:0.32,ease:'power3.out'},${t0});
      tl.fromTo('#${id}m2',{x:60,autoAlpha:0},{x:0,autoAlpha:1,duration:0.34,ease:'back.out(1.6)'},${r2(t0 + 0.34)});
      tl.to('#${id}m2',{scale:1.04,duration:0.24,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'100% 50%'},${r2(t0 + 0.72)});`
    case 'bell':
      return inOut + `
      tl.fromTo('#${id}bl',{scale:0.7,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(2)',transformOrigin:'50% 18%'},${t0});
      tl.to('#${id}bl',{rotation:14,duration:0.1,yoyo:true,repeat:5,ease:'sine.inOut',transformOrigin:'50% 18%'},${r2(t0 + 0.36)});
      tl.fromTo('#${id}bd',{scale:0,opacity:0},{scale:1,opacity:1,duration:0.26,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.6)});`
    case 'crowd':
      return inOut + `
      tl.fromTo('#${id}an .an-cw',{scale:0.4,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,stagger:{each:0.022,from:'center'},ease:'back.out(2)',transformOrigin:'50% 100%'},${t0});`
    case 'viral':
      return inOut + `
      tl.fromTo('#${id}vc',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}an line',{drawSVG:'0%'},{opacity:1,duration:0.01},${r2(t0 + 0.2)});
      tl.fromTo('#${id}an .an-vp',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.28,stagger:0.055,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${r2(t0 + 0.28)});
      tl.to('#${id}vc',{scale:1.25,duration:0.3,yoyo:true,repeat:2,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.5)});`
    case 'scrollstop':
      return inOut + `
      tl.fromTo('#${id}ss',{y:0},{y:${-Math.round(240)},duration:${r2(Math.max(0.5, dur * 0.42))},ease:'power2.out'},${r2(t0 + 0.1)});
      tl.fromTo('#${id}sf',{y:26,autoAlpha:0},{y:0,autoAlpha:1,duration:0.24,ease:'back.out(2)'},${r2(t0 + 0.1 + Math.max(0.5, dur * 0.42))});
      tl.to('#${id}sf',{scale:0.86,duration:0.1,yoyo:true,repeat:1,ease:'power2.in',transformOrigin:'50% 50%'},${r2(t0 + 0.2 + Math.max(0.5, dur * 0.42))});`
    case 'retention':
      return inOut + `
      (function(){ var p=document.getElementById('${id}rt');
        if(p&&p.getTotalLength){var L=p.getTotalLength();p.style.strokeDasharray=L+' '+L;p.style.strokeDashoffset=L;} })();
      tl.to('#${id}rt',{strokeDashoffset:0,duration:${r2(Math.max(0.6, dur * 0.6))},ease:'power1.inOut'},${r2(t0 + 0.15)});
      tl.fromTo('#${id}rd',{scale:0,opacity:0},{scale:1,opacity:1,duration:0.26,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.15 + Math.max(0.6, dur * 0.6))});`
    case 'abtest':
      return inOut + `
      tl.fromTo('#${id}ab0',{x:-40,autoAlpha:0},{x:0,autoAlpha:1,duration:0.32,ease:'power3.out'},${t0});
      tl.fromTo('#${id}ab1',{x:40,autoAlpha:0},{x:0,autoAlpha:1,duration:0.32,ease:'power3.out'},${r2(t0 + 0.1)});
      tl.fromTo('#${id}abw',{scale:1.2,opacity:0},{scale:1,opacity:1,duration:0.3,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${r2(t0 + 0.6)});
      tl.to('#${id}ab0',{opacity:0.35,duration:0.3},${r2(t0 + 0.62)});
      tl.to('#${id}ab1',{scale:1.06,duration:${r2(Math.max(0.4, dur - 1.1))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.7)});`
    case 'roi':
      return inOut + `
      tl.fromTo('#${id}ro0',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2)',transformOrigin:'50% 50%'},${t0});
      (function(){ var p=document.getElementById('${id}roa');
        if(p&&p.getTotalLength){var L=p.getTotalLength();p.style.strokeDasharray=L+' '+L;p.style.strokeDashoffset=L;} })();
      tl.to('#${id}roa',{strokeDashoffset:0,duration:0.4,ease:'power2.out'},${r2(t0 + 0.3)});
      tl.to('#${id}roh',{opacity:1,duration:0.14},${r2(t0 + 0.66)});
      tl.fromTo('#${id}ro1',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.36,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.72)});
      tl.to('#${id}ro1',{scale:1.08,duration:${r2(Math.max(0.4, dur - 1.3))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 1.1)});`
    case 'save':
      return inOut + `
      tl.fromTo('#${id}sv',{y:40,scale:0.86,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.4,ease:'back.out(1.6)',transformOrigin:'50% 100%'},${t0});
      tl.fromTo('#${id}an .an-cn',{y:0,autoAlpha:0},{autoAlpha:1,duration:0.12,stagger:0.24},${r2(t0 + 0.4)});
      tl.to('#${id}an .an-cn',{y:'+=90',autoAlpha:0,duration:0.34,stagger:0.24,ease:'power2.in'},${r2(t0 + 0.46)});
      tl.to('#${id}sv',{scale:1.06,duration:0.2,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 100%'},${r2(t0 + 0.8)});`
    case 'free':
      return inOut + `
      tl.fromTo('#${id}fr',{scale:0.3,rotation:-24,autoAlpha:0},{scale:1,rotation:-7,autoAlpha:1,duration:0.44,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${t0});
      tl.to('#${id}fr',{rotation:-4,duration:${r2(Math.max(0.4, dur - 0.8))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.48)});`
    case 'plan':
      return inOut + `
      tl.fromTo('#${id}pl0',{y:50,autoAlpha:0},{y:0,autoAlpha:1,duration:0.34,ease:'power3.out'},${t0});
      tl.fromTo('#${id}pl2',{y:50,autoAlpha:0},{y:0,autoAlpha:1,duration:0.34,ease:'power3.out'},${r2(t0 + 0.1)});
      tl.fromTo('#${id}pl1',{y:70,scale:0.9,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.42,ease:'back.out(1.8)',transformOrigin:'50% 50%'},${r2(t0 + 0.22)});
      tl.to('#${id}pl1',{scale:1.05,duration:${r2(Math.max(0.4, dur - 1))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.68)});`
    case 'crown':
      return inOut + `
      tl.fromTo('#${id}cr',{y:-70,rotation:-16,autoAlpha:0},{y:0,rotation:0,autoAlpha:1,duration:0.46,ease:'back.out(2)',transformOrigin:'50% 100%'},${t0});
      tl.fromTo('#${id}cg',{scale:0.5,opacity:0},{scale:1,opacity:1,duration:0.5,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.3)});
      tl.to('#${id}cr',{scale:1.06,duration:${r2(Math.max(0.4, dur - 1))},ease:'sine.inOut',transformOrigin:'50% 100%'},${r2(t0 + 0.5)});`
    case 'robot':
      return inOut + `
      tl.fromTo('#${id}rb',{y:40,scale:0.86,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.4,ease:'back.out(1.7)',transformOrigin:'50% 100%'},${t0});
      tl.to('#${id}rba',{y:-8,duration:0.5,yoyo:true,repeat:3,ease:'sine.inOut'},${r2(t0 + 0.4)});
      tl.to(['#${id}re1','#${id}re2'],{scaleY:0.15,duration:0.09,yoyo:true,repeat:1,ease:'power2.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.9)});
      tl.to(['#${id}re1','#${id}re2'],{scaleY:0.15,duration:0.09,yoyo:true,repeat:1,ease:'power2.inOut',transformOrigin:'50% 50%'},${r2(t0 + 1.8)});`
    case 'brain':
      return inOut + `
      tl.fromTo('#${id}an svg',{scale:0.86,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.36,ease:'back.out(1.6)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}an .an-bs',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,stagger:0.15,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.34)});
      tl.to('#${id}an .an-bs',{scale:1.5,duration:0.34,stagger:0.15,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.95)});`
    case 'magic':
      return inOut + `
      tl.fromTo('#${id}mb',{scale:0.8,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'power3.out',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}mw',{rotation:48,autoAlpha:0},{rotation:28,autoAlpha:1,duration:0.3,ease:'back.out(2)',transformOrigin:'50% 100%'},${r2(t0 + 0.2)});
      tl.to('#${id}mw',{rotation:14,duration:0.22,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 100%'},${r2(t0 + 0.52)});
      tl.to('#${id}ma',{opacity:1,duration:0.26,ease:'power2.out'},${r2(t0 + 0.66)});
      tl.fromTo('#${id}an .an-mk',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.07,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.6)});
      tl.to('#${id}an .an-mk',{autoAlpha:0,duration:0.3,stagger:0.07},${r2(t0 + 1.1)});`
    case 'filter':
      return inOut + `
      tl.fromTo('#${id}an .an-fi',{y:-40,autoAlpha:0},{y:0,autoAlpha:1,duration:0.26,stagger:0.07,ease:'power2.out'},${t0});
      tl.to('#${id}an .an-fi',{y:'+=${Math.round(150)}',autoAlpha:0,duration:0.4,stagger:0.06,ease:'power2.in'},${r2(t0 + 0.45)});
      tl.fromTo('#${id}fo',{scale:0.3,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${r2(t0 + 0.85)});`
    case 'layers':
      return inOut + `
      tl.fromTo('#${id}an .an-ly',{y:-50,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,stagger:0.13,ease:'back.out(1.8)'},${t0});
      tl.to('#${id}ly1',{scale:1.05,duration:${r2(Math.max(0.4, dur - 1.1))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.75)});`
    case 'before':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{scale:0.94,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'power3.out',transformOrigin:'50% 50%'},${t0});
      tl.to('#${id}bl',{opacity:1,duration:0.14},${r2(t0 + 0.34)});
      tl.to('#${id}bf',{clipPath:'inset(0 0 0% 0)',duration:${r2(Math.max(0.6, dur - 1))},ease:'power2.inOut'},${r2(t0 + 0.4)});
      tl.to('#${id}bl',{y:'+=${Math.round(0)}',duration:0.01},${r2(t0 + 0.4)});
      tl.to('#${id}bl',{opacity:0,duration:0.24},${r2(t0 + 0.4 + Math.max(0.6, dur - 1))});`
    case 'badge':
      return inOut + `
      tl.fromTo('#${id}bg',{scale:0.3,rotation:-40,autoAlpha:0},{scale:1,rotation:0,autoAlpha:1,duration:0.44,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${t0});
      (function(){ var p=document.querySelector('#${id}bc path');
        if(p&&p.getTotalLength){var L=p.getTotalLength();p.style.strokeDasharray=L+' '+L;p.style.strokeDashoffset=L;} })();
      tl.to('#${id}bc path',{strokeDashoffset:0,duration:0.34,ease:'power2.out'},${r2(t0 + 0.4)});
      tl.to('#${id}bg',{scale:1.07,duration:${r2(Math.max(0.4, dur - 1))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.75)});`
    case 'trend':
      return inOut + `
      tl.fromTo('#${id}an .an-tr',{scaleY:0},{scaleY:1,duration:0.3,stagger:0.1,ease:'back.out(1.5)'},${t0});
      tl.fromTo('#${id}ta',{scale:0.4,y:20,autoAlpha:0},{scale:1,y:0,autoAlpha:1,duration:0.34,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${r2(t0 + 0.6)});`
    case 'template':
      return inOut + `
      tl.fromTo('#${id}tp0',{scale:0.85,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(1.7)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}tp1',{x:0,autoAlpha:0},{x:${Math.round(-160)},autoAlpha:1,duration:0.38,ease:'power3.out'},${r2(t0 + 0.36)});
      tl.fromTo('#${id}tp2',{x:0,autoAlpha:0},{x:${Math.round(160)},autoAlpha:1,duration:0.38,ease:'power3.out'},${r2(t0 + 0.48)});`
    case 'record':
      return inOut + `
      tl.fromTo('#${id}rc',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}rr',{scale:0.6,opacity:0.5},{scale:1.5,opacity:0,duration:1,repeat:${Math.max(1, Math.round(dur))},ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}an .an-rw',{scaleY:0.2},{scaleY:1,duration:0.4,stagger:{each:0.03,yoyo:true,repeat:${Math.max(1, Math.round(dur))}},ease:'sine.inOut'},${r2(t0 + 0.25)});`
    case 'copy':
      // la clé apparaît · « COPIÉ » claque · elle plonge dans Claude
      return inOut + `
      tl.fromTo('#${id}k',{y:-40,scale:0.9,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.36,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}cp',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.4)});
      tl.fromTo('#${id}cl',{scale:0.72,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(1.7)'},${r2(t0 + 0.58)});
      tl.to('#${id}cp',{autoAlpha:0,duration:0.18},${r2(t0 + 0.9)});
      tl.to('#${id}k',{y:'+=300',scale:0.3,autoAlpha:0,duration:0.46,ease:'power2.in',transformOrigin:'50% 50%'},${r2(t0 + 0.92)});
      tl.to('#${id}cl',{scale:1.12,duration:0.2,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 1.3)});`
    case 'connect':
      // les deux blocs se rejoignent, le câble se tend, le voyant vert claque
      return inOut + `
      tl.fromTo('#${id}c1', { xPercent: -70, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.42, ease: 'power3.out' }, ${t0});
      tl.fromTo('#${id}c2', { xPercent: 70, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.42, ease: 'power3.out' }, ${t0});
      tl.fromTo('#${id}cw', { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.22, ease: 'power2.out' }, ${r2(t0 + 0.38)});
      tl.to(['#${id}c1', '#${id}c2'], { x: 0, duration: 0.14, ease: 'power2.in' }, ${r2(t0 + 0.56)});
      tl.fromTo('#${id}ck', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(3)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.64)});
      tl.to('#${id}cw', { autoAlpha: 0, duration: 0.16 }, ${r2(t0 + 0.68)});
      tl.to(['#${id}c1', '#${id}c2'], { scale: 1.05, duration: ${r2(Math.max(0.5, dur - 1.0))}, ease: 'sine.inOut', transformOrigin: '50% 50%' }, ${r2(t0 + 0.8)});`
    case 'post':
      // la vidéo monte vers les plateformes, chacune valide à son tour
      return inOut + `
      tl.fromTo('#${id}an .an-pt', { y: -30, scale: 0.7, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.3, stagger: 0.09, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}vd', { yPercent: 45, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.34, ease: 'power3.out' }, ${r2(t0 + 0.16)});
      tl.to('#${id}vd', { yPercent: -118, scale: 0.3, autoAlpha: 0, duration: 0.52, ease: 'power2.in', transformOrigin: '50% 0%' }, ${r2(t0 + 0.56)});
      tl.fromTo(['#${id}k0', '#${id}k1', '#${id}k2'], { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.24, stagger: 0.15, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, ${r2(t0 + 1.0)});
      tl.to('#${id}an .an-pt', { scale: 1.12, duration: 0.18, stagger: 0.15, yoyo: true, repeat: 1, ease: 'sine.inOut', transformOrigin: '50% 50%' }, ${r2(t0 + 1.0)});`
    case 'type':
      return inOut + `
      (function(){ var el = document.querySelector('#${id}t'), cur = document.querySelector('#${id}cur');
        if (!el) {
          tl.fromTo('#${id}an .an-tl', { scaleX: 0 }, { scaleX: 1, duration: 0.34, stagger: 0.16, ease: 'power2.out', transformOrigin: '0% 50%' }, ${t0});
          if (cur) tl.to(cur, { autoAlpha: 0, duration: 0.26, repeat: 5, yoyo: true, ease: 'none' }, ${t0});
          return;
        }
        var node = el.childNodes[0];
        var full = (node && node.nodeValue) || '', o = { n: 0 };
        if (!full) return;
        tl.to(o, { n: full.length, duration: ${r2(Math.min(1.4, dur))}, ease: 'none',
          onUpdate: function(){ if (el) el.childNodes[0].nodeValue = full.slice(0, Math.round(o.n)); } }, ${t0});
        if (cur) tl.to(cur, { autoAlpha: 0, duration: 0.28, repeat: ${Math.max(1, Math.round(dur / 0.56))}, yoyo: true, ease: 'none' }, ${t0}); })();`
    case 'money':
      return inOut + `
      tl.fromTo('#${id}cd', { scale: 0.85, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(1.7)' }, ${t0});
      tl.fromTo('#${id}am', { scaleX: 0.15 }, { scaleX: 1, duration: 0.6, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.2)});
      tl.fromTo('#${id}an .an-coin', { yPercent: -120, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.42, stagger: 0.1, ease: 'bounce.out' }, ${r2(t0 + 0.34)});`
    case 'idea':
      return inOut + `
      tl.fromTo('#${id}an .an-bit', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, stagger: 0.05, ease: 'power2.out', transformOrigin: '50% 50%' }, ${t0});
      tl.to('#${id}an .an-bit', { left: '50%', top: '50%', scale: 0.2, autoAlpha: 0, duration: 0.36, stagger: 0.04, ease: 'power2.in' }, ${r2(t0 + 0.34)});
      tl.fromTo('#${id}co', { scale: 0.2, autoAlpha: 0, rotation: -25 }, { scale: 1, autoAlpha: 1, rotation: 0, duration: 0.34, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.6)});`
    case 'target':
      return inOut + `
      tl.fromTo('#${id}dot', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${t0});
      tl.to('#${id}ring', { strokeDashoffset: 0, duration: ${r2(Math.max(0.6, dur - 0.7))}, ease: 'power2.inOut' }, ${r2(t0 + 0.16)});
      tl.to('#${id}dot', { scale: 1.35, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out', transformOrigin: '50% 50%' }, ${r2(end - 0.5)});`
    case 'lock':
      return inOut + `
      tl.fromTo('#${id}bx', { scaleX: 0.6, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.3, ease: 'power3.out', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-dot', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.2, stagger: 0.08, ease: 'back.out(3)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.24)});
      tl.fromTo('#${id}sh', { yPercent: -50, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.34, ease: 'bounce.out' }, ${r2(t0 + 0.62)});`
    case 'search':
      return inOut + `
      tl.fromTo('#${id}ty', { scaleX: 0 }, { scaleX: 1, duration: 0.1, repeat: 5, yoyo: true, ease: 'none', transformOrigin: '0% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-res', { yPercent: -40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.3, stagger: 0.1, ease: 'power2.out' }, ${r2(t0 + 0.5)});`
    case 'rocket':
      return inOut + `
      tl.fromTo('#${id}tr', { strokeDashoffset: 180 }, { strokeDashoffset: 0, duration: ${r2(Math.max(0.6, dur - 0.6))}, ease: 'power2.inOut' }, ${t0});
      tl.fromTo('#${id}hd', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, ${r2(t0 + Math.max(0.4, dur - 0.8))});`
    case 'network':
      return inOut + `
      tl.fromTo('#${id}an .an-ln', { scaleX: 0 }, { scaleX: 1, duration: 0.3, stagger: 0.07, ease: 'power2.out', transformOrigin: '0% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-av', { scale: 0.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, stagger: 0.07, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.16)});`
    case 'check':
      return inOut + `
      tl.fromTo('#${id}an .an-row', { xPercent: -18, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.28, stagger: 0.14, ease: 'power2.out' }, ${t0});
      tl.fromTo('#${id}an .an-bx', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.24, stagger: 0.14, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.14)});
      ${[0, 1, 2].map((k) => `tl.fromTo('#${id}p${k}', { strokeDashoffset: 90 }, { strokeDashoffset: 0, duration: 0.3, ease: 'power2.out' }, ${r2(t0 + 0.3 + k * 0.14)});`).join('\n      ')}`
    case 'screen': {
      const zx = typeof s.screenX === 'number' ? s.screenX : 0.5
      const zy = typeof s.screenY === 'number' ? s.screenY : 0.5
      const zs = typeof s.screenZoom === 'number' ? s.screenZoom : 1
      // GSAP compose translate(t) scale(z) : l'echelle s'applique AVANT la
      // translation, donc le decalage doit lui aussi etre multiplie par le zoom.
      // Sans ce facteur, la zone visee derivait d'autant plus qu'on zoomait — c'est
      // ce qui empechait la fonction d'etre pile au centre.
      const has2 = typeof s.screenX2 === 'number' && typeof s.screenY2 === 'number'
      const zs2 = typeof s.screenZoom2 === 'number' ? s.screenZoom2 : zs
      // LA CAMERA NE SORT PAS DE L'IMAGE. A un zoom z, la fenetre visible fait 1/z de
      // large : viser plus pres du bord que 1/(2z) fait deborder, et le conteneur
      // apparaissait alors en aplat vide sur le cote (visible en visant le menu
      // lateral, a x = 0.086). On ramene donc la cible dans les limites — le cadre de
      // surbrillance, lui, reste sur la vraie zone.
      const clamp = (v, z) => Math.min(1 - 1 / (2 * z), Math.max(1 / (2 * z), v))
      const tx = ((0.5 - clamp(zx, zs)) * zs * 100).toFixed(2)
      const ty = ((0.5 - clamp(zy, zs)) * zs * 100).toFixed(2)
      const tx2 = has2 ? ((0.5 - clamp(s.screenX2, zs2)) * zs2 * 100).toFixed(2) : tx
      const ty2 = has2 ? ((0.5 - clamp(s.screenY2, zs2)) * zs2 * 100).toFixed(2) : ty
      // le travelling occupe la seconde moitie de la scene
      const panAt = r2(t0 + Math.max(0.9, (dur - 0.5) * 0.5))
      const panDur = r2(Math.max(0.6, end - 0.25 - panAt))
      return inOut + `
      tl.fromTo('#${id}rm', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.22, ease: 'power2.out' }, ${t0});
      tl.to('#${id}rm', { autoAlpha: 0, duration: 0.22, ease: 'power2.in' }, ${r2(end - 0.22)});
      ${s.screenText ? `
      // LE TEXTE S'ECRIT DANS LE CHAMP pendant qu'il le dit. Le curseur clignote
      // en pas discrets (pas de repeat -1 : le rendu doit rester deterministe).
      tl.fromTo('#${id}tp', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, ${r2(t0 + 0.5)});
      (function(){
        var full = ${JSON.stringify(String(s.screenText))};
        var n = ${String(s.screenText).length}, T = ${r2(Math.max(0.9, Math.min(dur - 1.4, String(s.screenText).length * 0.045)))};
        for (var i = 1; i <= n; i++) {
          tl.set('#${id}tt', { textContent: full.slice(0, i) }, ${r2(t0 + 0.6)} + (i / n) * T);
        }
      })();
      for (var cb = 0; cb < 8; cb++) {
        tl.set('#${id}car', {}, 0);
        tl.to('#${id}sc .an-3dcar', { opacity: cb % 2 ? 1 : 0.15, duration: 0.01 }, ${r2(t0 + 0.6)} + cb * 0.28);
      }` : ''}
      // inclinaison FRANCHE et tenue : la reference garde l'ecran de biais du debut
      // a la fin, elle ne le redresse jamais. On derive lentement au lieu de revenir
      // de face, ce qui donnait un rendu plat.
      tl.fromTo('#${id}sc', { rotationY: -30, rotationX: 10, rotationZ: -2, scale: 0.88, autoAlpha: 0 }, { rotationY: -22, rotationX: 6, rotationZ: -1.5, scale: 1, autoAlpha: 1, duration: 0.55, ease: 'power3.out' }, ${t0});
      tl.to('#${id}sc', { rotationY: -17, rotationX: 4, duration: ${r2(Math.max(0.8, dur - 0.6))}, ease: 'sine.inOut' }, ${r2(t0 + 0.55)});
      tl.fromTo('#${id}z', { scale: 1, xPercent: 0, yPercent: 0 }, { scale: ${zs}, xPercent: ${tx}, yPercent: ${ty}, duration: ${r2(Math.max(0.55, (has2 ? panAt - t0 : dur - 0.55)))}, ease: 'power2.inOut' }, ${r2(t0 + 0.25)});
      tl.fromTo('#${id}bx1', { autoAlpha: 0, scale: 1.6 }, { autoAlpha: 1, scale: 1, duration: 0.28, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.5)});` +
      (has2 ? `
      tl.to('#${id}z', { scale: ${zs2}, xPercent: ${tx2}, yPercent: ${ty2}, duration: ${panDur}, ease: 'power2.inOut' }, ${panAt});
      tl.to('#${id}bx1', { autoAlpha: 0, duration: 0.22, ease: 'power2.in' }, ${panAt});
      tl.fromTo('#${id}bx2', { autoAlpha: 0, scale: 1.5 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${r2(panAt + panDur - 0.3)});` : '')
    }
    case 'result':
      return inOut + `
      // l'image arrive comme un tirage : legere echelle + un flash bref, puis la
      // pastille « enregistre » qui vient se poser.
      tl.fromTo('#${id}rs', { scale: 0.9, autoAlpha: 0, rotationZ: -1.5 }, { scale: 1, autoAlpha: 1, rotationZ: 0, duration: 0.42, ease: 'back.out(1.5)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}fl', { autoAlpha: 0.85 }, { autoAlpha: 0, duration: 0.35, ease: 'power2.out' }, ${r2(t0 + 0.1)});
      tl.fromTo('#${id}sv', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, ${r2(t0 + Math.max(0.7, dur * 0.42))});`
    case 'countup': {
      const raw = String(s.value || '').replace(/[^0-9.]/g, '')
      const target = parseFloat(raw) || 0
      const dec = (String(s.value || '').split('.')[1] || '').length
      const steps = 26
      let js = inOut + `
      tl.fromTo('#${id}cun', { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'back.out(2)', transformOrigin: '50% 60%' }, ${t0});
      tl.fromTo('#${id}cuu', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.24, ease: 'power2.out' }, ${r2(t0 + 0.3)});
      tl.fromTo('#${id}cub', { scaleX: 0 }, { scaleX: 1, duration: ${r2(Math.max(0.7, Math.min(dur - 0.7, 1.5)))}, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.2)});`
      // le defilement est ECRIT PAS A PAS : le rendu image par image doit etre
      // reproductible, un compteur anime par onUpdate ne le serait pas.
      const T = Math.max(0.7, Math.min(dur - 0.7, 1.5))
      for (let k = 1; k <= steps; k++) {
        const v = (target * Math.pow(k / steps, 0.62)).toFixed(dec)
        const txt = Number(v).toLocaleString('fr-FR')
        js += `\n      tl.set('#${id}cun', { textContent: ${JSON.stringify(txt)} }, ${r2(t0 + 0.2 + (k / steps) * T)});`
      }
      return js
    }
    case 'flow':
      return inOut + `
      tl.fromTo('#${id}an .an-nd', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, stagger: 0.34, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-lb', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.24, stagger: 0.34, ease: 'power2.out' }, ${r2(t0 + 0.16)});
      tl.fromTo('#${id}an .an-ar', { scaleX: 0 }, { scaleX: 1, duration: 0.28, stagger: 0.34, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.3)});`
    case 'funnel':
      return inOut + `
      tl.fromTo('#${id}an .an-fn', { scaleX: 0.2, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.3, stagger: 0.16, ease: 'back.out(1.6)', transformOrigin: '50% 50%' }, ${t0});`
    case 'orbit':
      return inOut + `
      tl.fromTo('#${id}c', { scale: 0.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-sat', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, stagger: 0.09, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.22)});
      tl.fromTo('#${id}o', { rotation: 0, autoAlpha: 0 }, { rotation: 120, autoAlpha: 1, duration: ${r2(Math.max(0.9, dur - 0.4))}, ease: 'none', transformOrigin: '50% 50%' }, ${r2(t0 + 0.2)});`
    case 'bars2':
      return inOut + `
      tl.fromTo('#${id}an .an-b2', { scaleY: 0, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.5, stagger: 0.2, ease: 'power3.out', transformOrigin: '50% 100%' }, ${t0});`
    case 'wallet':
      return inOut + `
      tl.fromTo('#${id}w', { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(1.8)', transformOrigin: '50% 100%' }, ${t0});
      tl.fromTo('#${id}an .an-cd', { yPercent: 60, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.36, stagger: 0.12, ease: 'back.out(1.5)' }, ${r2(t0 + 0.24)});`
    case 'swipe':
      return inOut + `
      tl.fromTo('#${id}fd', { yPercent: 0 }, { yPercent: -32, duration: ${r2(Math.max(0.7, dur - 0.4))}, ease: 'power2.inOut' }, ${t0});
      tl.fromTo('#${id}an .an-sw', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, stagger: 0.05 }, ${t0});`
    case 'views':
      return inOut + `
      tl.fromTo('#${id}pl', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}bar', { scaleX: 0.05 }, { scaleX: 1, duration: ${r2(Math.max(0.6, dur - 0.6))}, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.2)});`
    case 'engage':
      return inOut + `
      tl.fromTo('#${id}an .an-bub', { xPercent: -30, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.3, stagger: 0.12, ease: 'back.out(1.6)' }, ${t0});
      tl.fromTo('#${id}an .an-hrt', { yPercent: 60, autoAlpha: 0, scale: 0.4 }, { yPercent: -90, autoAlpha: 1, scale: 1, duration: 0.7, stagger: 0.13, ease: 'power2.out' }, ${r2(t0 + 0.24)});`
    case 'calendar':
      return inOut + `
      tl.fromTo('#${id}an .an-cell', { scale: 0.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.22, stagger: 0.035, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${t0});`
    case 'upload':
      return inOut + `
      tl.fromTo('#${id}cd', { yPercent: 25, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.3, ease: 'power2.out' }, ${t0});
      tl.to('#${id}cd', { yPercent: -60, scale: 0.72, duration: ${r2(Math.max(0.5, dur - 0.7))}, ease: 'power2.inOut' }, ${r2(t0 + 0.36)});
      tl.fromTo('#${id}ar', { yPercent: 30, autoAlpha: 0 }, { yPercent: -20, autoAlpha: 1, duration: 0.5, repeat: 2, ease: 'power1.out' }, ${r2(t0 + 0.3)});`
    case 'stack':
      return inOut + `
      tl.fromTo('#${id}an .an-st', { yPercent: 30, autoAlpha: 0, rotation: -6 }, { yPercent: 0, autoAlpha: 1, rotation: 0, duration: 0.34, stagger: 0.11, ease: 'back.out(1.7)' }, ${t0});`
    case 'swap':
      return inOut + `
      tl.fromTo('#${id}a', { scale: 1, autoAlpha: 1 }, { scale: 0.8, autoAlpha: 0.35, duration: 0.36, ease: 'power2.in', transformOrigin: '50% 50%' }, ${r2(t0 + 0.3)});
      tl.fromTo('#${id}ar', { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.2)});
      tl.fromTo('#${id}b', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.38, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.44)});`
    case 'cut':
      return inOut + `
      tl.fromTo(['#${id}l', '#${id}r'], { scaleX: 0.5, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.3, ease: 'power3.out', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}k', { yPercent: -70, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.24, ease: 'power3.in' }, ${r2(t0 + 0.34)});
      tl.to('#${id}l', { xPercent: -12, duration: 0.26, ease: 'power2.out' }, ${r2(t0 + 0.58)});
      tl.to('#${id}r', { xPercent: 12, duration: 0.26, ease: 'power2.out' }, ${r2(t0 + 0.58)});`
    case 'steps':
      return inOut + `
      tl.fromTo('#${id}an .an-sp', { scale: 0.25, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.28, stagger: 0.18, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-lk', { scaleX: 0 }, { scaleX: 1, duration: 0.2, stagger: 0.18, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.2)});`
    case 'toggle':
      return inOut + `
      tl.fromTo('#${id}tr', { scaleX: 0.7, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.28, ease: 'back.out(1.8)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}kn', { x: 0, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.2 }, ${r2(t0 + 0.16)});
      tl.to('#${id}kn', { xPercent: 118, backgroundColor: '#FF5A2B', duration: 0.34, ease: 'back.out(2)' }, ${r2(t0 + 0.44)});
      tl.to('#${id}tr', { borderColor: '#FF5A2B', duration: 0.3 }, ${r2(t0 + 0.44)});`
    case 'faceless':
      return inOut + `
      tl.fromTo('#${id}hd', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}bd', { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, ease: 'power2.out' }, ${r2(t0 + 0.08)});
      tl.fromTo(['#${id}e1', '#${id}e2'], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16 }, ${r2(t0 + 0.26)});
      tl.fromTo('#${id}br', { scaleX: 0, autoAlpha: 1 }, { scaleX: 1, duration: 0.3, ease: 'power3.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.46)});`
    case 'logo':
      return inOut + `
      tl.fromTo('#${id}im', { scale: 0.5, autoAlpha: 0, rotation: -8 }, { scale: 1, autoAlpha: 1, rotation: 0, duration: 0.44, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}ha', { scale: 0.7, autoAlpha: 0 }, { scale: 1.18, autoAlpha: 0, duration: 0.9, ease: 'power2.out', transformOrigin: '50% 50%' }, ${r2(t0 + 0.18)});
      tl.to('#${id}im', { scale: 1.05, duration: ${r2(Math.max(0.5, dur - 0.5))}, ease: 'sine.inOut' }, ${r2(t0 + 0.45)});`
    case 'avatar':
      return inOut + `
      tl.fromTo('#${id}ph', { scale: 0.9, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(1.8)' }, ${t0});
      tl.fromTo('#${id}hd', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.2)});
      tl.fromTo('#${id}bd', { scaleY: 0, autoAlpha: 0, transformOrigin: '50% 100%' }, { scaleY: 1, autoAlpha: 1, duration: 0.36, ease: 'power3.out' }, ${r2(t0 + 0.42)});` + `
      tl.fromTo('#${id}sc', { y: 0, autoAlpha: 0.7 }, { y: ${Math.round(1920 * 0.24)}, autoAlpha: 0, duration: ${r2(Math.max(0.8, s.dur - 0.4))}, ease: 'none' }, ${t0});`
    case 'phone':
      return inOut + `
      tl.fromTo('#${id}ph', { scale: 0.86, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.36, ease: 'back.out(1.8)' }, ${t0});
      tl.fromTo('#${id}fd', { y: '0%' }, { y: '-55%', duration: ${dur}, ease: 'none' }, ${r2(t0 + 0.3)});`
    default:
      return inOut + `
      tl.fromTo('#${id}cl', { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, ease: 'back.out(2)' }, ${t0});
      tl.fromTo('#${id}hd', { rotation: 0 }, { rotation: 360, duration: ${dur}, ease: 'none', transformOrigin: '50% 100%' }, ${t0});`
  }
}

export function animCss(W, H) {
  return `
      /* #135 · animations fabriquées : elles montrent le CONCEPT, pas l'interface */
      .an { position: absolute; z-index: 4; will-change: opacity; }
      .an-p, .an-b, .an-r, .an-g, .an-ph, .an-cl { position: absolute; will-change: transform, opacity; }
      .an-t { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center;
        font-family: "Inter", Helvetica, Arial, sans-serif; font-weight: 600; letter-spacing: -.02em; white-space: nowrap; }
      .an-cur { display: inline-block; width: 3px; height: 1em; margin-left: 4px; vertical-align: -0.12em; }
      .an-feed { position: absolute; left: 0; top: 0; width: 100%; height: 220%; display: block; will-change: transform; }
      .an-hand { position: absolute; left: 50%; bottom: 50%; width: 4px; margin-left: -2px; border-radius: 99px; will-change: transform; }
      .an-e3 { position: absolute; display: flex; align-items: center; justify-content: center; }
      .an-e3 img { width: 100%; height: 100%; object-fit: contain; display: block;
        will-change: transform, opacity; }
      .an-stage { position: absolute; inset: 0; }
      .an-res { position: absolute; border-radius: 18px; overflow: hidden;
        box-shadow: 0 26px 70px -18px rgba(0,0,0,.5), 0 0 0 1px rgba(0,0,0,.06); }
      .an-res img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .an-res-flash { position: absolute; inset: 0; background: #fff; }
      .an-res-save { position: absolute; right: 6%; bottom: 5%; width: 22%; aspect-ratio: 1;
        border-radius: 50%; display: grid; place-items: center;
        box-shadow: 0 8px 22px -6px rgba(0,0,0,.45); }
      .an-cu { position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: .12em; }
      .an-cun { line-height: 1; font-variant-numeric: tabular-nums; font-weight: 900;
        font-family: Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; letter-spacing: -.03em; }
      .an-cuu { font-weight: 800; letter-spacing: .02em;
        font-family: Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; }
      .an-cub { width: 34%; height: 6px; border-radius: 99px; margin-top: .35em; }
      /* le texte qui s'ecrit DANS le champ de l'app, au meme endroit que le cadre */
      /* MASQUE OPAQUE : la capture contient deja du texte dans le champ, il faut
         le couvrir avant d'ecrire par-dessus — et ecrire en BLANC, pas en noir
         (Axel : « l'ecriture est en noir donc on voit rien »). */
      .an-lb { font-weight: 700; font-family: Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; }
      .an-3dtype { position: absolute; display: flex; align-items: center; gap: .35em;
        padding: 0 1.4%; font-family: "Inter", Helvetica, Arial, sans-serif; font-weight: 600;
        white-space: nowrap; overflow: hidden; background: #101319; color: #fff;
        border-radius: 8px; }
      .an-3dcar { display: inline-block; width: .09em; height: 1.15em; flex: none; }
      .an-3d { position: absolute; perspective: 1100px; transform-style: preserve-3d;
        will-change: transform, opacity; }
      .an-3di { width: 100%; height: 100%; overflow: hidden; border-radius: 10px;
        box-shadow: 0 30px 80px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.06);
        transform-style: preserve-3d; }
      .an-3dz { position: absolute; inset: 0; will-change: transform; transform-origin: 50% 50%; }
      .an-3dbox { position: absolute; border: 3px solid;
        box-shadow: 0 0 0 4000px rgba(0,0,0,.55), 0 0 24px 2px currentColor; border-radius: 6px;
        box-shadow: 0 0 0 4000px rgba(0,0,0,.42); will-change: transform, opacity; }
      .an-3dz img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .an-lg { position: absolute; display: flex; align-items: center; justify-content: center; }
      .an-lg img { max-width: 82%; max-height: 82%; display: block; will-change: transform, opacity; }
      .an-halo { position: absolute; inset: 6%; border-radius: 50%; will-change: transform, opacity; }`
}
