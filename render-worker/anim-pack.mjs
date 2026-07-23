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

export const ANIMS = ['split', 'voice', 'list', 'grow', 'compare', 'type', 'phone', 'clock', 'avatar', 'logo', 'faceless', 'money', 'idea', 'target', 'lock', 'search', 'rocket', 'network', 'check',
  'swipe', 'views', 'engage', 'calendar', 'upload', 'stack', 'swap', 'cut', 'steps', 'toggle',
  'screen', 'flow', 'funnel', 'orbit', 'bars2', 'wallet', 'countup']

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Palette : sombre sur clair pour les styles page blanche, l'inverse sinon.
export function animPalette(vs) {
  const light = vs === 'word' || vs === 'apple' || vs === 'editorial'
  return {
    ink: light ? '#111111' : '#FFFFFF',
    soft: light ? 'rgba(17,17,17,.10)' : 'rgba(255,255,255,.14)',
    line: light ? 'rgba(17,17,17,.20)' : 'rgba(255,255,255,.28)',
    acc: vs === 'apple' ? '#0071E3' : vs === 'editorial' ? '#111111' : WORD_SHAPES[0],
    acc2: vs === 'apple' ? '#6E6E73' : WORD_SHAPES[1],
  }
}

// Cadre de travail : centré, dans la zone sûre, au-dessus du sous-titre.
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
      // deux blocs, l'un tombe et l'autre monte : un avant/après
      const cw = Math.round(f.w * 0.42)
      return box(
        `<div class="an-p" id="${id}c1" style="left:0;top:0;width:${cw}px;height:100%;background:${P.soft};border:2px solid ${P.line};border-radius:${Math.round(f.h * 0.08)}px"></div>` +
        `<div class="an-p" id="${id}c2" style="left:${f.w - cw}px;top:0;width:${cw}px;height:100%;background:${P.acc};border-radius:${Math.round(f.h * 0.08)}px"></div>`)
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
      // L'ecran REMPLIT le cadre comme dans la reference : il deborde volontairement
      // de chaque cote, et il est centre sur toute la hauteur de la video (pas sur la
      // zone d'animation) — sinon il reste coince en haut avec du vide dessous.
      const w = Math.round(W * 1.5)
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
        <div class="an-3d" id="${id}sc" style="left:${Math.round((W - w) / 2)}px;top:${Math.round(H * 0.30 - h / 2)}px;width:${w}px;height:${h}px">
          <div class="an-3di">
            <div class="an-3dz" id="${id}z"><img src="${s.screenFile}" alt="" />${b1}${b2}${tz}</div>
          </div>
        </div>
      </div>`
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
      tl.fromTo('#${id}c2', { y: 0, autoAlpha: 0 }, { y: -24, autoAlpha: 1, duration: 0.45, ease: 'back.out(1.6)' }, ${r2(t0 + 0.15)});`
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
      const tx = ((0.5 - zx) * zs * 100).toFixed(2)
      const ty = ((0.5 - zy) * zs * 100).toFixed(2)
      const tx2 = has2 ? ((0.5 - s.screenX2) * zs2 * 100).toFixed(2) : tx
      const ty2 = has2 ? ((0.5 - s.screenY2) * zs2 * 100).toFixed(2) : ty
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
