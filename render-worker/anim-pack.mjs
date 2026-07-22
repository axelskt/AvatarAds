// anim-pack.mjs — #135 · animations fabriquées à la demande du chef d'orchestre.
//
// Une capture d'écran ne montre pas un CONCEPT : le bouton « Split Screen » ne dit
// pas à quoi ressemble un split screen. Ces animations, elles, montrent l'idée —
// et coûtent zéro crédit, se rendent instantanément et sont déterministes.
//
// Le chef d'orchestre écrit `anim: "split"` sur une scène quand il estime qu'une
// animation illustre mieux que n'importe quelle image. Elle prend alors toute la
// zone visuelle, au-dessus de la bande du sous-titre.

import { SAFE, SAFE_CENTERED_W, WORD_SHAPES } from './visual-styles.mjs'

export const ANIMS = ['split', 'voice', 'list', 'grow', 'compare', 'type', 'phone', 'clock', 'avatar', 'logo', 'faceless', 'money', 'idea', 'target', 'lock', 'search', 'rocket', 'network', 'check']

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
      // des billets qui tombent : l'argent, le revenu, le prix
      const bw = Math.round(f.w * 0.26), bh = Math.round(bw * 0.52)
      let h = ''
      for (let k = 0; k < 5; k++) {
        const x = Math.round(f.w * (0.16 + (k % 3) * 0.24) + (k > 2 ? f.w * 0.12 : 0))
        h += `<span class="an-p an-bill" id="${id}b${k}" style="left:${x}px;top:${Math.round(f.h * (0.12 + k * 0.13))}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.12)}px;background:${k % 2 ? P.acc : P.ink};opacity:${k % 2 ? 1 : 0.85}"></span>`
      }
      return box(h)
    }
    case 'idea': {
      // une ampoule qui s'allume : l'idée, la solution, le déclic
      const d = Math.round(f.h * 0.42), cx = Math.round(f.w / 2), top = Math.round(f.h * 0.14)
      return box(`<span class="an-p" id="${id}bl" style="left:${cx - Math.round(d / 2)}px;top:${top}px;width:${d}px;height:${d}px;border-radius:50%;background:${P.acc}"></span>
        <span class="an-p" id="${id}bs" style="left:${cx - Math.round(d * 0.16)}px;top:${top + d - 4}px;width:${Math.round(d * 0.32)}px;height:${Math.round(d * 0.26)}px;border-radius:0 0 ${Math.round(d * 0.1)}px ${Math.round(d * 0.1)}px;background:${P.ink}"></span>
        ${[0, 1, 2, 3, 4, 5].map((k) => { const a = (k / 6) * Math.PI * 2; const r = d * 0.78; return `<span class="an-p an-ray" id="${id}r${k}" style="left:${Math.round(cx + Math.cos(a) * r - d * 0.045)}px;top:${Math.round(top + d / 2 + Math.sin(a) * r - d * 0.045)}px;width:${Math.round(d * 0.09)}px;height:${Math.round(d * 0.09)}px;border-radius:50%;background:${P.acc}"></span>` }).join('')}`)
    }
    case 'target': {
      // une cible et une flèche qui se plante au centre : l'objectif, la précision
      const d = Math.round(f.h * 0.72), cx = Math.round(f.w / 2), cy = Math.round(f.h * 0.5)
      let h = ''
      for (let k = 0; k < 3; k++) {
        const rr = Math.round(d * (0.5 - k * 0.15))
        h += `<span class="an-p an-ring" id="${id}g${k}" style="left:${cx - rr}px;top:${cy - rr}px;width:${rr * 2}px;height:${rr * 2}px;border-radius:50%;border:${Math.round(d * 0.045)}px solid ${k % 2 ? P.ink : P.acc}"></span>`
      }
      h += `<span class="an-p" id="${id}dt" style="left:${cx - Math.round(d * 0.06)}px;top:${cy - Math.round(d * 0.06)}px;width:${Math.round(d * 0.12)}px;height:${Math.round(d * 0.12)}px;border-radius:50%;background:${P.acc}"></span>`
      return box(h)
    }
    case 'lock': {
      // un cadenas qui se ferme : la sécurité, le verrou, l'accès réservé
      const bw = Math.round(f.h * 0.34), bh = Math.round(f.h * 0.28), cx = Math.round(f.w / 2)
      const top = Math.round(f.h * 0.36)
      return box(`<span class="an-p" id="${id}sh" style="left:${cx - Math.round(bw * 0.3)}px;top:${top - Math.round(bh * 0.72)}px;width:${Math.round(bw * 0.6)}px;height:${Math.round(bh * 0.8)}px;border:${Math.round(bw * 0.11)}px solid ${P.ink};border-bottom:0;border-radius:${Math.round(bw * 0.32)}px ${Math.round(bw * 0.32)}px 0 0"></span>
        <span class="an-p" id="${id}bd" style="left:${cx - Math.round(bw / 2)}px;top:${top}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bw * 0.13)}px;background:${P.acc}"></span>`)
    }
    case 'search': {
      // une loupe qui balaie : chercher, analyser, trouver
      const d = Math.round(f.h * 0.42), cx = Math.round(f.w * 0.44), cy = Math.round(f.h * 0.44)
      return box(`<span class="an-p" id="${id}mg" style="left:${cx - Math.round(d / 2)}px;top:${cy - Math.round(d / 2)}px;width:${d}px;height:${d}px;border-radius:50%;border:${Math.round(d * 0.12)}px solid ${P.ink}"></span>
        <span class="an-p" id="${id}hd" style="left:${cx + Math.round(d * 0.34)}px;top:${cy + Math.round(d * 0.34)}px;width:${Math.round(d * 0.46)}px;height:${Math.round(d * 0.12)}px;border-radius:99px;background:${P.ink};transform:rotate(45deg);transform-origin:0 50%"></span>`)
    }
    case 'rocket': {
      // une fusée qui décolle : le lancement, la croissance, la vitesse
      const w2 = Math.round(f.h * 0.2), h2 = Math.round(f.h * 0.46), cx = Math.round(f.w / 2)
      return box(`<span class="an-p" id="${id}rk" style="left:${cx - Math.round(w2 / 2)}px;top:${Math.round(f.h * 0.3)}px;width:${w2}px;height:${h2}px;border-radius:${Math.round(w2 / 2)}px ${Math.round(w2 / 2)}px ${Math.round(w2 * 0.2)}px ${Math.round(w2 * 0.2)}px;background:${P.acc}"></span>
        <span class="an-p" id="${id}fl" style="left:${cx - Math.round(w2 * 0.22)}px;top:${Math.round(f.h * 0.3) + h2 - 2}px;width:${Math.round(w2 * 0.44)}px;height:${Math.round(h2 * 0.34)}px;border-radius:0 0 ${Math.round(w2 * 0.3)}px ${Math.round(w2 * 0.3)}px;background:${P.ink}"></span>`)
    }
    case 'network': {
      // des points qui se relient : le réseau, la connexion, la communauté
      const n = 6, R = Math.round(f.h * 0.34), cx = Math.round(f.w / 2), cy = Math.round(f.h * 0.5)
      const dd = Math.round(f.h * 0.09)
      let h = `<span class="an-p" id="${id}c0" style="left:${cx - Math.round(dd * 0.7)}px;top:${cy - Math.round(dd * 0.7)}px;width:${Math.round(dd * 1.4)}px;height:${Math.round(dd * 1.4)}px;border-radius:50%;background:${P.acc}"></span>`
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2
        const x = Math.round(cx + Math.cos(a) * R), y = Math.round(cy + Math.sin(a) * R)
        h += `<span class="an-p an-nd" id="${id}n${k}" style="left:${x - Math.round(dd / 2)}px;top:${y - Math.round(dd / 2)}px;width:${dd}px;height:${dd}px;border-radius:50%;background:${P.ink}"></span>`
        h += `<span class="an-p an-ln" id="${id}l${k}" style="left:${cx}px;top:${cy}px;width:${R}px;height:3px;background:${P.line};transform:rotate(${Math.round((a * 180) / Math.PI)}deg);transform-origin:0 50%"></span>`
      }
      return box(h)
    }
    case 'check': {
      // une coche qui se trace : c'est validé, c'est fait, ça marche
      const d = Math.round(f.h * 0.6), cx = Math.round(f.w / 2), cy = Math.round(f.h * 0.5)
      return box(`<span class="an-p" id="${id}cc" style="left:${cx - Math.round(d / 2)}px;top:${cy - Math.round(d / 2)}px;width:${d}px;height:${d}px;border-radius:50%;background:${P.acc}"></span>
        <svg id="${id}cv" width="${d}" height="${d}" viewBox="0 0 100 100" style="position:absolute;left:${cx - Math.round(d / 2)}px;top:${cy - Math.round(d / 2)}px">
          <path id="${id}cp" d="M26 52 L44 70 L75 34" fill="none" stroke="#FFFFFF" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="90" stroke-dashoffset="90" />
        </svg>`)
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
      const d = Math.round(f.h * 0.86)
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
        var full = el ? el.childNodes[0].nodeValue : '', o = { n: 0 };
        tl.to(o, { n: full.length, duration: ${r2(Math.min(1.4, dur))}, ease: 'none',
          onUpdate: function(){ if (el) el.childNodes[0].nodeValue = full.slice(0, Math.round(o.n)); } }, ${t0});
        if (cur) tl.to(cur, { autoAlpha: 0, duration: 0.28, repeat: ${Math.max(1, Math.round(dur / 0.56))}, yoyo: true, ease: 'none' }, ${t0}); })();`
    case 'money':
      return inOut + `
      tl.fromTo('#${id}an .an-bill', { yPercent: -160, autoAlpha: 0, rotation: -12 }, { yPercent: 0, autoAlpha: 1, rotation: 0, duration: 0.42, stagger: 0.07, ease: 'back.out(1.6)' }, ${t0});`
    case 'idea':
      return inOut + `
      tl.fromTo('#${id}bs', { scaleY: 0, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.2, ease: 'power2.out', transformOrigin: '50% 0%' }, ${t0});
      tl.fromTo('#${id}bl', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.1)});
      tl.fromTo('#${id}an .an-ray', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, stagger: 0.03, ease: 'back.out(3)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.32)});`
    case 'target':
      return inOut + `
      tl.fromTo('#${id}an .an-ring', { scale: 0.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, stagger: 0.08, ease: 'back.out(1.8)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}dt', { scale: 3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'power3.in', transformOrigin: '50% 50%' }, ${r2(t0 + 0.42)});`
    case 'lock':
      return inOut + `
      tl.fromTo('#${id}bd', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}sh', { yPercent: -60, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.34, ease: 'bounce.out' }, ${r2(t0 + 0.18)});`
    case 'search':
      return inOut + `
      tl.fromTo(['#${id}mg', '#${id}hd'], { scale: 0.5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an', { xPercent: -14 }, { xPercent: 14, duration: ${r2(Math.max(0.6, dur - 0.4))}, ease: 'sine.inOut' }, ${r2(t0 + 0.28)});`
    case 'rocket':
      return inOut + `
      tl.fromTo(['#${id}rk', '#${id}fl'], { yPercent: 60, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.32, ease: 'power2.out' }, ${t0});
      tl.to(['#${id}rk', '#${id}fl'], { yPercent: -45, duration: ${r2(Math.max(0.5, dur - 0.5))}, ease: 'power2.in' }, ${r2(t0 + 0.34)});
      tl.fromTo('#${id}fl', { scaleY: 0.6 }, { scaleY: 1.25, duration: 0.16, repeat: 5, yoyo: true, ease: 'sine.inOut', transformOrigin: '50% 0%' }, ${r2(t0 + 0.34)});`
    case 'network':
      return inOut + `
      tl.fromTo('#${id}c0', { scale: 0.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.28, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-ln', { scaleX: 0 }, { scaleX: 1, duration: 0.3, stagger: 0.06, ease: 'power2.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.2)});
      tl.fromTo('#${id}an .an-nd', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, stagger: 0.06, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.3)});`
    case 'check':
      return inOut + `
      tl.fromTo('#${id}cc', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}cp', { strokeDashoffset: 90 }, { strokeDashoffset: 0, duration: 0.36, ease: 'power2.out' }, ${r2(t0 + 0.24)});`
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
      .an-lg { position: absolute; display: flex; align-items: center; justify-content: center; }
      .an-lg img { max-width: 82%; max-height: 82%; display: block; will-change: transform, opacity; }
      .an-halo { position: absolute; inset: 6%; border-radius: 50%; will-change: transform, opacity; }`
}
