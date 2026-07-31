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
  // L'ENCRE SUIT LE FOND, ELLE NE LE DEVINE PAS. `.fslide` — la scène plein cadre —
  // est CRÈME par défaut (scene-pack.mjs) ; seuls `glass` et le moteur Dynamique
  // peignent sombre. On listait pourtant les styles clairs un par un, si bien que
  // « aucun style résolu » tombait dans le cas sombre : encre blanche sur fond
  // crème, animation strictement invisible à l'écran. Le défaut doit donc être
  // CLAIR, et seuls les deux fonds sombres font exception.
  const light = vs !== 'glass' && vs !== 'dynamic'
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

// lineup : le visuel de chaque carte se choisit d'après le TERME prononcé —
// un colis pour un produit, une personne pour du coaching, un cours pour une
// formation, un calque qui glisse pour « animations », un haut-parleur pour
// les sons, deux panneaux qui permutent pour « transitions ». Jamais le mot
// écrit (retour d'Axel 31/07 : « je ne veux pas que tu l'écrives »). Sans
// correspondance, le trio d'offres par position, puis la carte muette.
const LINEUP_KINDS = [
  ['colis', /produit|physique|article|colis|objet|marchandise|e ?-?commerce|boutique/i],
  ['personne', /coach|accompagn|consult|mentor|humain|appel|rendez/i],
  ['cours', /formation|cours|module|ebook|programme|academ|masterclass|tuto/i],
  ['calque', /animation|motion|effet|anim/i],
  ['son', /bruitage|son(s)?\b|audio|musique|voix|sound/i],
  ['transition', /transition|encha|coupe/i],
]
export const lineupKind = (texte, k) => {
  const t = String(texte || '')
  for (const [nom, re] of LINEUP_KINDS) if (re.test(t)) return nom
  return ['colis', 'personne', 'cours'][k] || 'carte'
}

export function animHtml(name, s, W, H, vs) {
  const P = animPalette(vs)
  const f = frame(W, H)
  const id = s.id
  const box = (inner) => `<div class="an" id="${id}an" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px">${inner}</div>`
  const items = (s.items || []).map((it) => String(it.text || '')).filter(Boolean)
  // ── LE CHIFFRE VIENT DE CE QUI EST DIT, PAS DU CODE ────────────────────────
  // Axel : « si la personne dit qu'elle a perdu 10 kg, il faut que ce soit
  // remplacé par -10 kg ». Trente-deux animations affichaient un littéral en
  // dur — un montant, un pourcentage, une durée, un mot-clé. Chacune pouvait
  // donc CONTREDIRE la voix, ce qui est pire que ne rien montrer.
  // `txt(i, defaut)` lit items[i].text du plan et retombe sur la valeur d'exemple
  // quand le chef d'orchestre n'a rien passé. `esc()` protège le HTML : ce texte
  // vient du modèle, il ne doit jamais pouvoir injecter de balise.
  const raw = (s.items || []).map((it) => String(it && it.text != null ? it.text : ''))
  const txt = (i, def) => esc((raw[i] || '').trim() || def)
  // Dégradé de marque : l'accent EST la couleur, le dégradé n'est qu'un voile.
  // `acc2` vaut le bleu du set « word » hors style apple — les cartes pleines
  // partaient donc en orange → BLEU, à côté d'une interface entièrement orange.
  const grad = (deg = 150) => `linear-gradient(${deg}deg,rgba(255,255,255,.22),rgba(0,0,0,.30)),${P.acc}`

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
        <div class="an-p" id="${id}t2" style="left:${x0 + td + gap}px;top:${y0}px;width:${td}px;height:${td}px;border-radius:${r}px;overflow:hidden;box-shadow:0 26px 60px rgba(0,0,0,.45)">
          <img src="tuto/logo-claude.png" style="width:100%;height:100%;object-fit:cover;display:block"/></div>
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
        <span id="${id}ql" style="position:absolute;left:${x}px;top:${y - 8}px;width:3px;height:${h + 16}px;background:#fff;box-shadow:0 0 12px rgba(255,255,255,.7)"></span>
        <!-- Axel : « il manque un truc genre 4K ». Le balayage montrait la
             différence sans jamais la NOMMER : la pastille se pose sur la moitié
             nette, une fois le balayage terminé. -->
        <span class="an-p" id="${id}qb" style="left:${x + w - Math.round(w * 0.3)}px;top:${y + h - Math.round(h * 0.34)}px;width:${Math.round(w * 0.22)}px;height:${Math.round(h * 0.22)}px;border-radius:${Math.round(h * 0.06)}px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.13)}px;color:#FFFFFF;letter-spacing:.02em;opacity:0;box-shadow:0 10px 26px rgba(0,0,0,.3)">${txt(0, '4K')}</span>`)
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
    case 'free': {
      // « C'EST GRATUIT ». L'étiquette seule ne montrait rien : elle apparaissait,
      // point. Ce qui fait l'effet, c'est la CHUTE — le prix affiché, le trait
      // qui le barre, et GRATUIT qui prend sa place. On voit ce qu'on ne paie pas.
      const w = Math.round(f.w * 0.62), h = Math.round(w * 0.34)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const py = y - Math.round(h * 0.9)
      return box(`
        <span class="an-p" id="${id}fp" style="left:0;top:${py}px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.52)}px;color:${P.ink};opacity:.55">${txt(0, '')}</span>
        <span class="an-p" id="${id}fb" style="left:${Math.round(f.w * 0.28)}px;top:${py + Math.round(h * 0.3)}px;width:${Math.round(f.w * 0.44)}px;height:${Math.max(5, Math.round(h * 0.07))}px;border-radius:99px;background:#E5484D;transform-origin:0% 50%"></span>
        <div class="an-p" id="${id}fr" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(h*0.22)}px;background:${P.acc};display:flex;align-items:center;justify-content:center;transform:rotate(-7deg);box-shadow:0 20px 48px rgba(0,0,0,.32)">
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
    case 'layers': {
      // « on empile les couches », le montage : les calques se posent.
      const w = Math.round(f.w * 0.56), h = Math.round(f.h * 0.13)
      const x = Math.round((f.w - w) / 2)
      return box([0,1,2,3].map((k) => `
        <div class="an-p an-ly" id="${id}ly${k}" style="left:${x + k*Math.round(w*0.04)}px;top:${Math.round(f.h*0.2 + k*h*1.18)}px;width:${w}px;height:${h}px;border-radius:${Math.round(h*0.26)}px;background:${k===1?P.acc:P.soft};border:2px solid ${k===1?'transparent':P.line};opacity:0"></div>`).join(''))
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
      // « ÇA MONTE ». Axel : « une plus belle flèche, et pourquoi pas le produit
      // de la personne ». La petite flèche d'icône en coin ne portait rien : on
      // trace maintenant une VRAIE courbe qui grimpe, sa pointe est une flèche
      // pleine, et la tuile du produit se pose au sommet — c'est SA marque qui
      // monte, pas un graphique générique.
      const w = Math.round(f.w * 0.82), h = Math.round(f.h * 0.5)
      const x = Math.round((f.w - w) / 2), y = Math.round(f.h * 0.34)
      const n = 6, bw = Math.round(w / (n * 1.7))
      const bars = Array.from({ length: n }, (_, k) => {
        const bh = Math.round(h * (0.16 + k * 0.15))
        return `<div class="an-p an-tr" style="left:${x + k * Math.round(w / n)}px;top:${y + h - bh}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bw * 0.24)}px;background:${k === n - 1 ? P.acc : P.soft};transform-origin:50% 100%;transform:scaleY(0)"></div>`
      }).join('')
      // la courbe suit le sommet des barres, la flèche est SA pointe
      const pts = Array.from({ length: n }, (_, k) => [
        x + k * Math.round(w / n) + Math.round(bw / 2),
        y + h - Math.round(h * (0.16 + k * 0.15)) - Math.round(h * 0.06),
      ])
      const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')
      const tip = pts[n - 1], sz = Math.round(bw * 1.05)
      // LA POINTE EST CALCULÉE, PAS PIVOTÉE. L'ancienne version posait un triangle
      // droit puis le faisait tourner par `transform="rotate(...)"` — attribut SVG
      // que le transformOrigin de GSAP écrasait au rendu : la flèche partait de
      // travers, décrochée de la courbe. On construit donc ses trois sommets
      // directement dans l'axe des deux derniers points : plus rien à faire tourner.
      const prev = pts[n - 2]
      const dx = tip[0] - prev[0], dy = tip[1] - prev[1]
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len, uy = dy / len          // direction de la courbe
      const px = -uy, py = ux                     // sa perpendiculaire
      const base = [tip[0] - ux * sz * 0.55, tip[1] - uy * sz * 0.55]
      const tri = [
        `${(tip[0] + ux * sz * 0.5).toFixed(1)},${(tip[1] + uy * sz * 0.5).toFixed(1)}`,
        `${(base[0] + px * sz * 0.42).toFixed(1)},${(base[1] + py * sz * 0.42).toFixed(1)}`,
        `${(base[0] - px * sz * 0.42).toFixed(1)},${(base[1] - py * sz * 0.42).toFixed(1)}`,
      ].join(' ')
      const tw = Math.round(f.w * 0.2)
      return box(`${bars}
        <svg class="an-p" style="left:0;top:0;width:${f.w}px;height:${f.h}px" fill="none">
          <path id="${id}tl" d="${d}" stroke="${P.acc}" stroke-width="${Math.max(5, Math.round(bw * 0.22))}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>
          <polygon id="${id}ta" points="${tri}" fill="${P.acc}" opacity="0"/></svg>
        <div class="an-p" id="${id}tp" style="left:${Math.min(f.w - tw - 4, tip[0] - Math.round(tw * 0.1))}px;top:${Math.max(0, tip[1] - tw - Math.round(f.h * 0.12))}px;width:${tw}px;height:${tw}px;border-radius:${Math.round(tw * 0.24)}px;overflow:hidden;background:${P.soft};box-shadow:0 14px 32px rgba(0,0,0,.28);opacity:0">
          ${s.logoFile ? `<img src="${s.logoFile}" style="width:100%;height:100%;object-fit:cover;display:block"/>` : `<span style="position:absolute;inset:0;background:${grad(150)}"></span>`}</div>
        <span class="an-p" id="${id}tn" style="left:0;top:${Math.round(f.h * 0.12)}px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.11)}px;color:${P.acc};opacity:0">${txt(0, '')}</span>`)   // jamais de pourcentage inventé : vide si rien n'est dit
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
    case 'search': {
      // Une barre de recherche qu'on remplit, puis des résultats qui tombent.
      const bw = Math.round(f.w * 0.66), bh = Math.round(f.h * 0.15)
      const x = Math.round((f.w - bw) / 2)
      let rows = ''
      for (let k = 0; k < 3; k++) {
        rows += `<span class="an-p an-res" id="${id}r${k}" style="left:${x}px;top:${Math.round(f.h * 0.36 + k * bh * 1.24)}px;width:${Math.round(bw * (1 - k * 0.12))}px;height:${Math.round(bh * 0.72)}px;border-radius:${Math.round(bh * 0.2)}px;background:${k === 0 ? P.acc : P.soft}"></span>`
      }
      // Axel : « c'est le type d'animation où on peut ajouter quelque chose qui
      // s'écrit avec le bruitage du clavier ». La barre restait vide avec un simple
      // curseur : on ne savait pas ce qu'il cherchait. Le mot s'écrit maintenant
      // lettre par lettre, et le worker pose le son de frappe sur cet intervalle.
      const q = txt(0, 'HOOK VIRAL')
      const qlet = q.split('').map((c) => `<span class="an-sl2" style="opacity:0">${c === ' ' ? '&nbsp;' : c}</span>`).join('')
      const loupe = `<svg viewBox="0 0 24 24" style="width:${Math.round(bh * 0.44)}px;height:${Math.round(bh * 0.44)}px;flex:none" fill="none" stroke="${P.line}" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>`
      return box(`
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.13)}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.3)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;padding:0 ${Math.round(bh * 0.34)}px;box-sizing:border-box;gap:${Math.round(bh * 0.22)}px">
          ${loupe}
          <span id="${id}sq" style="font-family:${SANS};font-weight:800;font-size:${Math.round(bh * 0.36)}px;color:${P.ink};white-space:nowrap">${qlet}</span>
          <span id="${id}ty" style="width:3px;height:${Math.round(bh * 0.38)}px;border-radius:99px;background:${P.acc}"></span></span>${rows}`)
    }
    case 'rocket': {
      // « ÇA DÉCOLLE ». Axel : « bof, tu peux améliorer avec un vrai cadrage et
      // le logo/produit de la personne ». La courbe seule était abstraite — on
      // pouvait la coller sur n'importe quel discours. Ici c'est SA tuile qui
      // décolle : elle part du bas, suit la traînée, et la fumée reste derrière.
      const w2 = Math.round(f.w * 0.78), h2 = Math.round(f.h * 0.62)
      const x = Math.round((f.w - w2) / 2), y = Math.round(f.h * 0.16)
      const tw = Math.round(f.w * 0.24)
      // trois bouffées de fumée le long de la trajectoire
      const puff = [0.18, 0.42, 0.66].map((t, k) => {
        const px = x + Math.round(w2 * t * 0.9), py = y + h2 - Math.round(h2 * t * 1.05)
        const d = Math.round(tw * (0.42 - k * 0.07))
        return `<span class="an-p an-rk" style="left:${px}px;top:${py}px;width:${d}px;height:${d}px;border-radius:50%;background:${P.line};opacity:0"></span>`
      }).join('')
      return box(`
        <svg width="${w2}" height="${h2}" viewBox="0 0 100 80" preserveAspectRatio="none" style="position:absolute;left:${x}px;top:${y}px">
          <path id="${id}tr" d="M4 76 C28 74 44 56 58 34 C68 18 78 8 96 4" fill="none" stroke="${P.acc}" stroke-width="7" stroke-linecap="round"
            stroke-dasharray="180" stroke-dashoffset="180" />
        </svg>${puff}
        <div class="an-p" id="${id}hd" style="left:${x + w2 - Math.round(tw * 0.75)}px;top:${y - Math.round(tw * 0.25)}px;width:${tw}px;height:${tw}px;border-radius:${Math.round(tw * 0.24)}px;overflow:hidden;background:${P.soft};box-shadow:0 16px 38px rgba(0,0,0,.28);opacity:0">
          ${s.logoFile ? `<img src="${s.logoFile}" style="width:100%;height:100%;object-fit:cover;display:block"/>` : `<span style="position:absolute;inset:0;background:${grad(150)}"></span>`}</div>`)
    }
    case 'lowcost': {
      // Un VRAI graphe qui descend. Axel avait refuse la fleche : « je veux un
      // vrai graph qui descend plutot qu'une fleche ». Quatre barres qui
      // decroissent, la courbe qui plonge, la piece au bout.
      const gx = Math.round(f.w * 0.16), gy = Math.round(f.h * 0.22)
      const gw = Math.round(f.w * 0.70), gh = Math.round(f.h * 0.44)
      const bw = Math.round(gw * 0.19), pas = Math.round(gw * 0.245)
      const base = gy + gh
      let barres = ''
      const hs = [1, 0.70, 0.42, 0.20]
      hs.forEach((r, k) => {
        const bh = Math.round(gh * r), bx = gx + Math.round(gw * 0.09) + k * pas
        const col = k === 3 ? P.acc : k === 2 ? 'rgba(255,90,31,.34)' : P.soft
        barres += `<span class="an-p an-bar" id="${id}b${k}" style="left:${bx}px;top:${base - bh}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bw * 0.26)}px;background:${col};transform-origin:50% 100%"></span>`
      })
      const cd = Math.round(f.h * 0.115)
      return box(`
        <svg class="an-p" style="left:0;top:0;width:${f.w}px;height:${f.h}px;overflow:visible" viewBox="0 0 ${f.w} ${f.h}">
          <path d="M${gx} ${gy} L${gx} ${base} L${gx + gw} ${base}" fill="none" stroke="${P.line}" stroke-width="3" stroke-linecap="round"/>
          <path id="${id}cv" d="M${gx + Math.round(gw * 0.14)} ${gy + Math.round(gh * 0.10)} C${gx + Math.round(gw * 0.36)} ${gy + Math.round(gh * 0.32)} ${gx + Math.round(gw * 0.52)} ${gy + Math.round(gh * 0.60)} ${gx + Math.round(gw * 0.09) + 3 * pas + Math.round(bw / 2)} ${base - Math.round(gh * 0.20)}"
            fill="none" stroke="${P.acc}" stroke-width="8" stroke-linecap="round" stroke-dasharray="900" stroke-dashoffset="900"/>
        </svg>
        <span class="an-p" id="${id}co" style="left:${gx + Math.round(gw * 0.09) + 3 * pas + Math.round((bw - cd) / 2)}px;top:${base - Math.round(gh * 0.20) - Math.round(cd * 1.15)}px;width:${cd}px;height:${cd}px;border-radius:50%;background:${P.acc};box-shadow:0 14px 34px rgba(0,0,0,.24);display:grid;place-items:center;opacity:0">
          <span style="font:800 ${Math.round(cd * 0.5)}px/1 ${SANS};color:#FFF">&#8364;</span></span>
        ${barres}`)
    }
    case 'twopaths': {
      // La perspective de l'image qu'Axel a envoyee : un chemin qui s'ouvre en
      // bas, la foule qui s'ecoule d'un cote, LUI seul de l'autre. La premiere
      // version — deux traits et des pastilles — etait « pas ouf ».
      const som = Math.round(f.h * 0.24), bas = f.h
      const cxx = Math.round(f.w / 2)
      const marcheur = (x, y, sc, col, cls) => {
        const t = Math.round(f.h * 0.030 * sc)
        return `<span class="an-p ${cls}" style="left:${x - t}px;top:${y - Math.round(t * 2.4)}px;width:${t * 2}px;height:${Math.round(t * 3.4)}px">
          <span class="an-p" style="left:14%;top:0;width:72%;height:34%;border-radius:50%;background:${col}"></span>
          <span class="an-p" style="left:0;top:36%;width:100%;height:64%;border-radius:${Math.round(t * 0.5)}px ${Math.round(t * 0.5)}px ${Math.round(t * 0.2)}px ${Math.round(t * 0.2)}px;background:${col}"></span></span>`
      }
      const P_ = [[0.70,0.40,.36],[0.77,0.44,.42],[0.68,0.50,.50],[0.83,0.52,.52],[0.73,0.58,.60],[0.90,0.61,.64],
                  [0.65,0.66,.70],[0.80,0.70,.78],[0.96,0.73,.82],[0.71,0.79,.92],[0.88,0.84,1.0],[0.78,0.92,1.12]]
      let foule = ''
      P_.forEach(([rx, ry, sc]) => { foule += marcheur(Math.round(f.w * rx), Math.round(f.h * ry), sc, P.ink, 'an-fl') })
      return box(`
        <svg class="an-p" style="left:0;top:0;width:${f.w}px;height:${f.h}px" viewBox="0 0 ${f.w} ${f.h}">
          <path d="M${cxx} ${som} L${Math.round(f.w * 0.30)} ${bas} L0 ${bas} L${Math.round(cxx - f.w * 0.11)} ${som} Z" fill="rgba(255,255,255,.92)"/>
          <path d="M${cxx} ${som} L${Math.round(f.w * 0.70)} ${bas} L${f.w} ${bas} L${Math.round(cxx + f.w * 0.11)} ${som} Z" fill="rgba(255,255,255,.92)"/>
        </svg>
        ${foule}
        <span class="an-p an-solo" id="${id}so">${marcheur(Math.round(f.w * 0.20), Math.round(f.h * 0.66), 0.78, P.acc, '')}</span>`)
    }
    case 'daypart': {
      // Une journee en creneaux : tout est vide sauf DEUX heures, en couleur.
      const cw = Math.round(f.w * 0.46), ch = Math.round(f.h * 0.062)
      const cx2 = Math.round((f.w - cw) / 2), y0 = Math.round(f.h * 0.16)
      let h = ''
      for (let k = 0; k < 10; k++) {
        const plein = k === 4 || k === 5
        h += `<span class="an-p an-cr" id="${id}c${k}" style="left:${cx2}px;top:${y0 + k * Math.round(ch * 1.25)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(ch * 0.3)}px;background:${plein ? P.acc : P.soft}"></span>`
      }
      h += `<span class="an-p" id="${id}lb" style="left:0;top:${Math.round(f.h * 0.82)}px;width:${f.w}px;text-align:center;font:800 ${Math.round(f.h * 0.075)}px/1 ${SANS};color:${P.acc};opacity:0">${txt(0, '')}</span>`
      return box(h)
    }
    case 'blankfill': {
      // Une page blanche qui se remplit de resultats : on part de rien.
      const pw = Math.round(f.w * 0.72), ph = Math.round(f.h * 0.56)
      const px = Math.round((f.w - pw) / 2), py = Math.round(f.h * 0.20)
      const g = Math.round(pw * 0.06), cw2 = Math.round((pw - g * 3) / 2), chh = Math.round(cw2 * 0.94)
      const tons = ['rgba(255,90,31,.88)', 'rgba(255,90,31,.62)', 'rgba(255,90,31,.40)', 'rgba(255,90,31,.22)', P.soft, P.soft]
      let h = `<span class="an-p" style="left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;border-radius:${Math.round(pw * 0.07)}px;background:#FFF;border:2px solid ${P.line}"></span>`
      for (let k = 0; k < 6; k++) {
        const cxx = px + g + (k % 2) * (cw2 + g), cyy = py + g + Math.floor(k / 2) * (chh + g)
        h += `<span class="an-p an-cd" id="${id}d${k}" style="left:${cxx}px;top:${cyy}px;width:${cw2}px;height:${chh}px;border-radius:${Math.round(cw2 * 0.14)}px;background:${tons[k]}"></span>`
      }
      return box(h)
    }
    case 'easyup': {
      // v2 validee par Axel (maquette du 31/07) : la courbe montante HABILLEE —
      // axes gradues, aire coloree sous le trace, un point qui suit la courbe
      // avec sa pastille (une fleche, jamais un chiffre invente), trois jalons
      // qui claquent au passage. La v1 etait un trait nu sur un axe fantome.
      const COUL = '#22B573'
      const mx = Math.round(f.w * 0.12), my = Math.round(f.h * 0.14)
      const gw2 = f.w - 2 * mx, gh2 = f.h - 2 * my
      const x0 = mx, y0 = f.h - my
      const pts = [[0, 0.06], [0.22, 0.16], [0.45, 0.34], [0.68, 0.58], [0.88, 0.8], [1, 0.9]]
        .map(([px, py]) => [Math.round(x0 + px * gw2), Math.round(y0 - py * gh2)])
      const dLine = 'M' + pts.map((p2) => p2.join(' ')).join(' L')
      const dArea = dLine + ` L${x0 + gw2} ${y0} L${x0} ${y0} Z`
      let ticks = ''
      for (let k = 1; k <= 3; k++) {
        const ty = Math.round(y0 - (k / 3) * gh2)
        ticks += `<span class="an-p" style="left:${x0 - Math.round(f.w * 0.02)}px;top:${ty - 1}px;width:${Math.round(f.w * 0.02)}px;height:2px;background:${P.ink};opacity:.35"></span>
          <span class="an-p" style="left:${x0}px;top:${ty}px;width:${gw2}px;height:1px;background:${P.ink};opacity:.08"></span>`
        const tx = Math.round(x0 + (k / 3) * gw2)
        ticks += `<span class="an-p" style="left:${tx - 1}px;top:${y0}px;width:2px;height:${Math.round(f.h * 0.018)}px;background:${P.ink};opacity:.35"></span>`
      }
      const jalons = [1, 3, 4].map((i, k) => {
        const [jx, jy] = pts[i]
        return `<span class="an-p" id="${id}j${k}" style="left:${jx - 7}px;top:${jy - 7}px;width:14px;height:14px;border-radius:50%;background:#FFFFFF;border:3px solid ${COUL};opacity:0"></span>`
      }).join('')
      return box(`
        <span class="an-p" style="left:${x0}px;top:${y0}px;width:${gw2}px;height:3px;border-radius:99px;background:${P.ink};opacity:.4"></span>
        <span class="an-p" style="left:${x0}px;top:${y0 - gh2}px;width:3px;height:${gh2}px;border-radius:99px;background:${P.ink};opacity:.4"></span>
        ${ticks}
        <svg class="an-p" style="left:0;top:0" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}">
          <path id="${id}area" d="${dArea}" fill="${COUL}" opacity="0"/>
          <path id="${id}line" d="${dLine}" fill="none" stroke="${COUL}" stroke-width="7" stroke-linecap="round"/>
        </svg>
        ${jalons}
        <span class="an-p" id="${id}dot" style="left:${pts[0][0] - 11}px;top:${pts[0][1] - 11}px;width:22px;height:22px;border-radius:50%;background:${COUL};box-shadow:0 0 0 6px ${COUL}2E;opacity:0"></span>
        <span class="an-p" id="${id}bdg" style="left:${pts[0][0] - 26}px;top:${pts[0][1] - 64}px;width:52px;height:36px;border-radius:12px;background:${COUL};opacity:0;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px ${COUL}59">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l6-6 4 3 6-7M20 6h-5M20 6v5"/></svg></span>`)
    }
    case 'easydown': {
      // v2 validee par Axel (maquette du 31/07) : la courbe descendante HABILLEE —
      // axes gradues, aire coloree sous le trace, un point qui suit la courbe
      // avec sa pastille (une fleche, jamais un chiffre invente), trois jalons
      // qui claquent au passage. La v1 etait un trait nu sur un axe fantome.
      const COUL = '#E5484D'
      const mx = Math.round(f.w * 0.12), my = Math.round(f.h * 0.14)
      const gw2 = f.w - 2 * mx, gh2 = f.h - 2 * my
      const x0 = mx, y0 = f.h - my
      const pts = [[0, 0.9], [0.22, 0.8], [0.45, 0.62], [0.68, 0.38], [0.88, 0.16], [1, 0.06]]
        .map(([px, py]) => [Math.round(x0 + px * gw2), Math.round(y0 - py * gh2)])
      const dLine = 'M' + pts.map((p2) => p2.join(' ')).join(' L')
      const dArea = dLine + ` L${x0 + gw2} ${y0} L${x0} ${y0} Z`
      let ticks = ''
      for (let k = 1; k <= 3; k++) {
        const ty = Math.round(y0 - (k / 3) * gh2)
        ticks += `<span class="an-p" style="left:${x0 - Math.round(f.w * 0.02)}px;top:${ty - 1}px;width:${Math.round(f.w * 0.02)}px;height:2px;background:${P.ink};opacity:.35"></span>
          <span class="an-p" style="left:${x0}px;top:${ty}px;width:${gw2}px;height:1px;background:${P.ink};opacity:.08"></span>`
        const tx = Math.round(x0 + (k / 3) * gw2)
        ticks += `<span class="an-p" style="left:${tx - 1}px;top:${y0}px;width:2px;height:${Math.round(f.h * 0.018)}px;background:${P.ink};opacity:.35"></span>`
      }
      const jalons = [1, 3, 4].map((i, k) => {
        const [jx, jy] = pts[i]
        return `<span class="an-p" id="${id}j${k}" style="left:${jx - 7}px;top:${jy - 7}px;width:14px;height:14px;border-radius:50%;background:#FFFFFF;border:3px solid ${COUL};opacity:0"></span>`
      }).join('')
      return box(`
        <span class="an-p" style="left:${x0}px;top:${y0}px;width:${gw2}px;height:3px;border-radius:99px;background:${P.ink};opacity:.4"></span>
        <span class="an-p" style="left:${x0}px;top:${y0 - gh2}px;width:3px;height:${gh2}px;border-radius:99px;background:${P.ink};opacity:.4"></span>
        ${ticks}
        <svg class="an-p" style="left:0;top:0" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}">
          <path id="${id}area" d="${dArea}" fill="${COUL}" opacity="0"/>
          <path id="${id}line" d="${dLine}" fill="none" stroke="${COUL}" stroke-width="7" stroke-linecap="round"/>
        </svg>
        ${jalons}
        <span class="an-p" id="${id}dot" style="left:${pts[0][0] - 11}px;top:${pts[0][1] - 11}px;width:22px;height:22px;border-radius:50%;background:${COUL};box-shadow:0 0 0 6px ${COUL}2E;opacity:0"></span>
        <span class="an-p" id="${id}bdg" style="left:${pts[0][0] - 26}px;top:${pts[0][1] - 64}px;width:52px;height:36px;border-radius:12px;background:${COUL};opacity:0;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px ${COUL}59">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8l6 6 4-3 6 7M20 18h-5M20 18v-5"/></svg></span>`)
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
      // LE CHIFFRE SE LIT OÙ QU'IL SOIT, ET S'IL N'Y EN A PAS ON NE MONTRE RIEN.
      // Le chef d'orchestre avait mis « 100 » dans `center` et « % DE BENEFIC »
      // dans `value` : on ne lisait que `value`, aucun nombre dedans, et le
      // compteur restait figé sur 0 pendant qu'Axel disait « cent pour cent des
      // bénéfices ». Un 0 à l'écran sur « cent pour cent », c'est pire que rien.
      const brut = [s.value, s.center, s.title, (s.items || [])[0] && (s.items || [])[0].text]
        .map((x) => String(x == null ? '' : x)).find((x) => /\d/.test(x)) || ''
      const val = brut
      const unit = String(s.unit || '')
      if (!/\d/.test(val)) return ''   // pas de nombre prononcé → pas de compteur
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
      // « BEAUCOUP ENTRENT, PEU RESSORTENT ». Trois barres de largeur décroissante
      // ne montraient aucune PERTE : on lisait un escalier, pas un entonnoir. On
      // met donc des points qui DESCENDENT étage par étage, et à chaque passage il
      // en reste moins — c'est la chute du nombre qui raconte, pas la forme.
      const w0 = Math.round(f.w * 0.7), hh = Math.round(f.h * 0.17)
      const cnt = [txt(0, '1000'), txt(1, '240'), txt(2, '38')]
      let h = ''
      for (let k = 0; k < 3; k++) {
        const ww = Math.round(w0 * (1 - k * 0.26))
        const lx = Math.round((f.w - ww) / 2), ly = Math.round(f.h * 0.1 + k * hh * 1.42)
        h += `<span class="an-p an-fn" id="${id}f${k}" style="left:${lx}px;top:${ly}px;width:${ww}px;height:${hh}px;border-radius:${Math.round(hh * 0.24)}px;background:${k === 2 ? P.acc : P.soft};border:2px solid ${k === 2 ? P.acc : P.line};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(hh * 0.44)}px;color:${k === 2 ? '#FFFFFF' : P.ink}">${cnt[k]}</span>`
        // les gouttes qui descendent d'un étage à l'autre : de moins en moins
        if (k < 2) {
          const n = k === 0 ? 5 : 3
          for (let j = 0; j < n; j++) {
            const dx = lx + Math.round(ww * (0.2 + j * 0.6 / Math.max(1, n - 1)))
            h += `<span class="an-p an-fd${k}" style="left:${dx}px;top:${ly + hh + Math.round(hh * 0.1)}px;width:${Math.max(5, Math.round(f.w * 0.018))}px;height:${Math.max(5, Math.round(f.w * 0.018))}px;border-radius:50%;background:${P.acc};opacity:0"></span>`
          }
        }
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
      // « ENVOIE TON FICHIER ». Axel : « bof, améliore ou supprime ». Une carte
      // orange qui monte vers une barre en pointillés ne dit rien : ni ce qu'on
      // envoie, ni que c'est parti. On montre donc un VRAI fichier — nom, format,
      // poids — qui tombe dans la zone de dépôt, la barre de progression qui se
      // remplit, et la coche qui valide. C'est le trajet complet en 1,5 s.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const zh = Math.round(f.h * 0.46), zy = Math.round(f.h * 0.34)
      const cw = Math.round(w * 0.46), ch = Math.round(cw * 0.78)
      return box(`
        <span class="an-p" id="${id}uz" style="box-sizing:border-box;left:${x}px;top:${zy}px;width:${w}px;height:${zh}px;border-radius:${Math.round(f.w * 0.06)}px;border:${Math.max(3, Math.round(f.w * 0.008))}px dashed ${P.line};background:${P.soft}"></span>
        <div class="an-p" id="${id}uc" style="left:${Math.round((f.w - cw) / 2)}px;top:${Math.round(f.h * 0.04)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw * 0.1)}px;background:#FFFFFF;box-shadow:0 18px 40px rgba(0,0,0,.22);overflow:hidden">
          <span style="position:absolute;left:0;top:0;width:100%;height:${Math.round(ch * 0.3)}px;background:${P.acc}"></span>
          <span style="position:absolute;left:8%;top:${Math.round(ch * 0.44)}px;width:70%;height:${Math.max(3, Math.round(ch * 0.07))}px;border-radius:99px;background:#11111133"></span>
          <span style="position:absolute;left:8%;top:${Math.round(ch * 0.6)}px;width:46%;height:${Math.max(3, Math.round(ch * 0.06))}px;border-radius:99px;background:#11111122"></span>
          <span style="position:absolute;left:8%;bottom:${Math.round(ch * 0.1)}px;font-family:${SANS};font-weight:800;font-size:${Math.round(ch * 0.13)}px;color:#111111">${txt(0, 'MA-VIDEO.MP4')}</span></div>
        <span class="an-p" id="${id}ub" style="left:${x + Math.round(w * 0.1)}px;top:${zy + zh - Math.round(f.h * 0.12)}px;width:${Math.round(w * 0.8)}px;height:${Math.round(f.h * 0.05)}px;border-radius:99px;background:${P.line};overflow:hidden;opacity:0">
          <span id="${id}ubf" style="position:absolute;left:0;top:0;width:100%;height:100%;background:${P.acc};transform-origin:0% 50%;transform:scaleX(0)"></span></span>
        <svg class="an-p" id="${id}uk" viewBox="0 0 24 24" style="left:${Math.round(f.w / 2 - f.h * 0.08)}px;top:${zy + Math.round(zh * 0.28)}px;width:${Math.round(f.h * 0.16)}px;height:${Math.round(f.h * 0.16)}px" fill="none" stroke="${P.acc}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" opacity="0"><path d="M4 13l5.5 5.5L20 6"/></svg>`)
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
    // ── PAQUET 3 (#157) — le geste du montage, pas l'icône du concept.
    // Axel a supprimé douze animations du paquet précédent (cloche, couronne,
    // cerveau, robot, sablier…) : toutes avaient le même défaut, UNE ICÔNE POSÉE
    // SUR UN FOND. Celles-ci montrent une ACTION qui se déroule — un fichier qui
    // tombe, un cadre qui se recadre, des blancs qui se recollent.
    case 'dropzone': {
      // « tu déposes ton fichier » : la zone en pointillés et le fichier qui tombe dedans.
      const w = Math.round(f.w * 0.72), h = Math.round(f.h * 0.72)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const cw = Math.round(w * 0.3), ch = Math.round(cw * 1.24)
      const ln = (top, wd, op) => `<span style="position:absolute;left:14%;top:${top}%;width:${wd}%;height:${Math.max(3, Math.round(ch * 0.045))}px;border-radius:99px;background:rgba(255,255,255,${op})"></span>`
      return box(`
        <div class="an-p" id="${id}dz" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:${Math.max(3, Math.round(w * 0.014))}px dashed ${P.line};border-radius:${Math.round(w * 0.07)}px;background:${P.soft}"></div>
        <div class="an-p" id="${id}df" style="left:${Math.round((f.w - cw) / 2)}px;top:${Math.round((f.h - ch) / 2)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw * 0.16)}px;background:${P.acc};box-shadow:0 24px 50px rgba(0,0,0,.45)">
          ${ln(20, 52, .9)}${ln(34, 72, .6)}${ln(48, 40, .6)}</div>`)
    }
    case 'render': {
      // « ça génère » : l'aperçu se remplit pendant que la barre avance.
      // ET LE POURCENTAGE MONTE. Axel : « tu pourrais mettre genre un
      // pourcentage rapide qui va de 0 à 100 % ». Une barre qui avance dit
      // « ça travaille » ; un compteur qui atteint 100 dit « c'est FINI ».
      // C'est la fin qu'on vend — « en quelques secondes ».
      const w = Math.round(f.w * 0.6), h = Math.round(w * 0.66)
      const x = Math.round((f.w - w) / 2), y = Math.round(f.h * 0.04)
      const bh = Math.max(10, Math.round(f.h * 0.07)), by = y + h + Math.round(f.h * 0.14)
      const ps = Math.round(f.h * 0.13)
      return box(`
        <div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.07)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          <span class="an-p" id="${id}rv" style="left:0;top:0;width:100%;height:100%;background:${grad(150)};transform-origin:50% 100%"></span></div>
        <div class="an-p" id="${id}rp" style="left:${x}px;top:${y + h + Math.round(f.h * 0.015)}px;width:${w}px;height:${ps}px;line-height:${ps}px;text-align:center;font-weight:800;font-size:${ps}px;color:${P.ink};letter-spacing:-.02em"><span id="${id}rn">0</span><span style="font-size:.58em;opacity:.7"> %</span></div>
        <div class="an-p" style="left:${x}px;top:${by}px;width:${w}px;height:${bh}px;border-radius:99px;background:${P.soft};overflow:hidden">
          <span class="an-p" id="${id}rb" style="left:0;top:0;width:100%;height:100%;border-radius:99px;background:${P.acc};transform-origin:0% 50%"></span></div>`)
    }
    case 'crop': {
      // « on passe en vertical » : le cadre se resserre au format 9:16.
      const w0 = Math.round(f.w * 0.86), h0 = Math.round(w0 * 9 / 16)
      return box(`
        <div class="an-p" id="${id}cm" style="left:${Math.round((f.w - w0) / 2)}px;top:${Math.round((f.h - h0) / 2)}px;width:${w0}px;height:${h0}px;border-radius:${Math.round(f.w * 0.035)}px;overflow:hidden;box-shadow:0 24px 50px rgba(0,0,0,.45)">
          <span class="an-p" style="left:50%;top:50%;width:${w0}px;height:${Math.round(w0 * 1.5)}px;margin-left:${-Math.round(w0 / 2)}px;margin-top:${-Math.round(w0 * 0.75)}px;background:${grad(150)}"></span>
          <span class="an-p" style="left:50%;top:50%;width:${Math.round(w0 * 0.3)}px;height:${Math.round(w0 * 0.3)}px;margin-left:${-Math.round(w0 * 0.15)}px;margin-top:${-Math.round(w0 * 0.15)}px;border-radius:50%;background:rgba(255,255,255,.85)"></span></div>`)
    }
    case 'silence': {
      // « on enlève les blancs » : le silence disparaît et l'onde se recolle.
      const gw = Math.round(f.w * 0.16), bw = Math.round(f.w * 0.4)
      const x0 = Math.round((f.w - (bw * 2 + gw)) / 2)
      const wave = (seed) => {
        const n = 13, st = Math.round(bw / n)
        let o = ''
        for (let k = 0; k < n; k++) {
          const hg = Math.round(f.h * (0.12 + 0.46 * Math.abs(Math.sin((k + seed) * 1.7))))
          o += `<span style="position:absolute;left:${k * st}px;top:${Math.round((f.h - hg) / 2)}px;width:${Math.round(st * 0.56)}px;height:${hg}px;border-radius:99px;background:${P.ink};opacity:.72"></span>`
        }
        return o
      }
      return box(`
        <div class="an-p" style="left:${x0}px;top:0;width:${bw}px;height:${f.h}px">${wave(0)}</div>
        <div class="an-p" id="${id}sg" style="left:${x0 + bw}px;top:${Math.round(f.h * 0.34)}px;width:${gw}px;height:${Math.round(f.h * 0.32)}px;border-radius:${Math.round(f.h * 0.07)}px;background:${P.acc};transform-origin:0% 50%"></div>
        <div class="an-p" id="${id}sr" style="left:${x0 + bw + gw}px;top:0;width:${bw}px;height:${f.h}px">${wave(7)}</div>`)
    }
    case 'chat': {
      // « tu lui demandes » : la question part, la réponse s'écrit.
      const w = Math.round(f.w * 0.84), x = Math.round((f.w - w) / 2)
      // LA BULLE ÉTAIT MINUSCULE. `frame()` borne le panneau à 44 % de la hauteur,
      // donc f.h ≈ 595 px : une bulle à 0,2 × f.h faisait 119 px et son texte à
      // 0,26 × bh tombait à 31 px sur une vidéo 1080 de large — illisible au
      // téléphone. Axel : « ce n'est pas très beau la police ». On grossit la
      // bulle ET son texte : grossir la police seule ne suffit pas, c'est le
      // conteneur qui donne l'échelle.
      const bh = Math.round(f.h * 0.26), r = Math.round(bh * 0.42)
      const th = Math.max(3, Math.round(bh * 0.1))
      // LA POLICE S'ADAPTE AU TEXTE, PAS L'INVERSE. Axel : « ça aurait été bien
      // qu'elle reste sur une seule ligne… max 2 lignes selon le texte ». Une
      // taille fixe marche pour une phrase courte et casse tout dès qu'elle
      // s'allonge. On calcule : une ligne si elle reste lisible, deux sinon,
      // jamais trois. (0.52 = largeur moyenne d'un caractère d'Inter gras,
      // rapportée à la taille de police.)
      const phrase = txt(0, 'écris-moi un hook')
      const dedansW = Math.round(w * 0.92) - 2 * Math.round(bh * 0.28)
      const fsMax = Math.round(bh * 0.38), fsMin = Math.round(bh * 0.24)
      const pour = (lignes) => Math.floor(dedansW / (0.52 * Math.ceil(phrase.length / lignes)))
      const fs = Math.max(fsMin, Math.min(fsMax, pour(1) >= Math.round(bh * 0.28) ? pour(1) : pour(2)))
      return box(`
        <!-- Axel : « chat pareil, on peut ajouter bruitage de clavier ». La question
             ne doit pas apparaître d'un bloc : on l'ÉCRIT, et le son de frappe se
             pose sur cet intervalle comme pour « search » et « comment ».
             (Aucun accent grave ici : ce commentaire vit DANS un template literal.) -->
        <div class="an-p" id="${id}cq" style="left:${x + Math.round(w * 0.08)}px;top:${Math.round(f.h * 0.05)}px;width:${Math.round(w * 0.92)}px;min-height:${bh}px;border-radius:${r}px ${r}px ${Math.round(r * 0.3)}px ${r}px;background:${P.acc};display:flex;align-items:center;padding:0 ${Math.round(bh * 0.28)}px;box-sizing:border-box">
          <span id="${id}cqt" style="font-family:${SANS};font-weight:800;font-size:${fs}px;letter-spacing:-.015em;color:#FFFFFF;line-height:1.18">${
            phrase.split('').map((c) => `<span class="an-cq2" style="opacity:0">${c === ' ' ? '&nbsp;' : c}</span>`).join('')}</span>
          <span id="${id}cqc" style="width:2px;height:${Math.round(bh * 0.3)}px;background:#FFFFFF;border-radius:2px;margin-left:2px"></span></div>
        <div class="an-p" id="${id}ca" style="left:${x}px;top:${Math.round(f.h * 0.4)}px;width:${Math.round(w * 0.86)}px;height:${Math.round(bh * 1.6)}px;border-radius:${r}px ${r}px ${r}px ${Math.round(r * 0.3)}px;background:${P.soft};border:2px solid ${P.line}">
          <span style="position:absolute;left:8%;top:13%;width:${Math.round(bh * 0.4)}px;height:${Math.round(bh * 0.4)}px">${claudeBurst('100%', P.acc)}</span>
          ${[0.46, 0.66, 0.84].map((t, k) => `<span class="an-p" id="${id}cl${k}" style="left:8%;top:${Math.round(bh * 1.6 * t)}px;width:${[78, 64, 42][k]}%;height:${th}px;border-radius:99px;background:${P.ink};opacity:.55;transform-origin:0% 50%"></span>`).join('')}</div>`)
    }
    case 'dashboard': {
      // « tes stats » : les tuiles se posent et la courbe se trace.
      const w = Math.round(f.w * 0.88), h = Math.round(f.h * 0.94)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const pad = Math.round(w * 0.05), gp = Math.round(w * 0.035)
      const tw = Math.round((w - pad * 2 - gp * 2) / 3), th = Math.round(h * 0.24)
      let tiles = ''
      for (let k = 0; k < 3; k++) tiles += `<span class="an-p an-dt" id="${id}dt${k}" style="left:${pad + k * (tw + gp)}px;top:${Math.round(h * 0.09)}px;width:${tw}px;height:${th}px;border-radius:${Math.round(th * 0.24)}px;background:${k === 1 ? P.acc : P.soft};border:2px solid ${P.line}"></span>`
      const gy = Math.round(h * 0.44), gh = Math.round(h * 0.44)
      const pts = [0.05, 0.3, 0.2, 0.5, 0.42, 0.74, 0.96]
      const d = pts.map((v, k) => `${k ? 'L' : 'M'}${pad + Math.round((w - pad * 2) * k / (pts.length - 1))} ${gy + Math.round(gh * (1 - v))}`).join(' ')
      return box(`
        <div class="an-p" id="${id}dp" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.06)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          ${tiles}
          <svg style="position:absolute;left:0;top:0;width:${w}px;height:${h}px" fill="none">
            <path id="${id}dl" d="${d}" stroke="${P.acc}" stroke-width="${Math.max(4, Math.round(w * 0.016))}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg></div>`)
    }
    case 'translate': {
      // « dans une autre langue » : la phrase bascule d'une langue à l'autre.
      const w = Math.round(f.w * 0.8), h = Math.round(f.h * 0.3)
      const x = Math.round((f.w - w) / 2)
      const pill = (t, bg, fg) => `<span style="position:absolute;left:${Math.round(w * 0.05)}px;top:50%;transform:translateY(-50%);padding:${Math.round(h * 0.12)}px ${Math.round(h * 0.2)}px;border-radius:99px;background:${bg};color:${fg};font-family:${SANS};font-weight:800;font-size:${Math.round(h * 0.22)}px;letter-spacing:.06em">${t}</span>`
      const word = (t, col) => `<span style="position:absolute;right:${Math.round(w * 0.07)}px;top:50%;transform:translateY(-50%);font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.4)}px;color:${col}">${t}</span>`
      return box(`
        <div class="an-p" id="${id}g1" style="left:${x}px;top:${Math.round(f.h * 0.04)}px;width:${w}px;height:${h}px;border-radius:${Math.round(h * 0.26)}px;background:${P.soft};border:2px solid ${P.line}">${pill('FR', P.line, P.ink)}${word('Bonjour', P.ink)}</div>
        <svg class="an-p" id="${id}ga" viewBox="0 0 24 24" style="left:50%;margin-left:${-Math.round(f.h * 0.09)}px;top:${Math.round(f.h * 0.4)}px;width:${Math.round(f.h * 0.18)}px;height:${Math.round(f.h * 0.18)}px" fill="none" stroke="${P.acc}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M6 13l6 6 6-6"/></svg>
        <div class="an-p" id="${id}g2" style="left:${x}px;top:${Math.round(f.h * 0.66)}px;width:${w}px;height:${h}px;border-radius:${Math.round(h * 0.26)}px;background:${P.acc}">${pill('EN', 'rgba(255,255,255,.92)', P.acc)}${word('Hello', '#FFFFFF')}</div>`)
    }
    case 'bgswap': {
      // « tu changes le fond » : le décor se remplace derrière la personne.
      const pw = Math.round(f.h * 0.6), ph = f.h, px = Math.round((f.w - pw) / 2)
      const hd = Math.round(pw * 0.26)
      return box(`<div class="an-ph" style="left:${px}px;top:0;width:${pw}px;height:${ph}px;border-radius:${Math.round(pw * 0.11)}px;overflow:hidden;border:3px solid ${P.line}">
        <span class="an-p" style="left:0;top:0;width:100%;height:100%;background:linear-gradient(150deg,#3C3C46,#191920)"></span>
        <span class="an-p" id="${id}bg" style="left:0;top:0;width:100%;height:100%;background:${grad(150)};transform-origin:0% 50%"></span>
        <span class="an-p" id="${id}bs" style="left:50%;margin-left:${-Math.round(pw * 0.27)}px;top:${Math.round(ph * 0.42)}px;width:${Math.round(pw * 0.54)}px;height:${Math.round(ph * 0.58)}px;border-radius:${Math.round(pw * 0.27)}px ${Math.round(pw * 0.27)}px 0 0;background:#FFFFFF"></span>
        <span class="an-p" id="${id}bh" style="left:50%;margin-left:${-Math.round(hd / 2)}px;top:${Math.round(ph * 0.2)}px;width:${hd}px;height:${hd}px;border-radius:50%;background:#FFFFFF"></span></div>`)
    }
    case 'hook': {
      // « les 3 premières secondes » : le début de la timeline s'allume.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const th = Math.round(f.h * 0.2), ty = Math.round(f.h * 0.52)
      const hw = Math.round(w * 0.22)
      return box(`
        <span class="an-p" style="left:${x}px;top:${ty}px;width:${w}px;height:${th}px;border-radius:${Math.round(th * 0.26)}px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p" id="${id}hk" style="left:${x}px;top:${ty}px;width:${hw}px;height:${th}px;border-radius:${Math.round(th * 0.26)}px;background:${P.acc};transform-origin:0% 50%"></span>
        <span class="an-p" id="${id}hl" style="left:${x}px;top:${Math.round(ty - f.h * 0.3)}px;width:${hw}px;height:${Math.round(f.h * 0.24)}px;display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.21)}px;color:${P.acc}">${txt(0, '3s')}</span>
        <span class="an-p" id="${id}hc" style="left:${x}px;top:${Math.round(ty - f.h * 0.05)}px;width:${Math.max(4, Math.round(w * 0.009))}px;height:${Math.round(th + f.h * 0.1)}px;border-radius:99px;background:${P.ink}"></span>`)
    }
    case 'export': {
      // « tu récupères ta vidéo » : le clip descend en fichier prêt.
      const cw = Math.round(f.w * 0.34), ch = Math.round(cw * 1.4)
      const cx = Math.round((f.w - cw) / 2)
      return box(`
        <div class="an-p" id="${id}xc" style="left:${cx}px;top:${Math.round(f.h * 0.02)}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(cw * 0.15)}px;background:${grad(150)};box-shadow:0 24px 50px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="34%" height="34%" fill="#FFFFFF"><path d="M8 5l11 7-11 7z"/></svg></div>
        <svg class="an-p" id="${id}xa" viewBox="0 0 24 24" style="left:50%;margin-left:${-Math.round(f.h * 0.07)}px;top:${Math.round(f.h * 0.56)}px;width:${Math.round(f.h * 0.14)}px;height:${Math.round(f.h * 0.14)}px" fill="none" stroke="${P.acc}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v14M6 12l6 6 6-6"/></svg>
        <div class="an-p" id="${id}xf" style="left:${cx}px;top:${Math.round(f.h * 0.74)}px;width:${cw}px;height:${Math.round(f.h * 0.22)}px;border-radius:${Math.round(cw * 0.12)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.095)}px;color:${P.ink}">MP4</div>`)
    }
    case 'checklist': {
      // « tout est inclus » : les lignes se cochent une par une.
      const w = Math.round(f.w * 0.82), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.19), gp = Math.round(f.h * 0.07)
      const y0 = Math.round((f.h - (4 * rh + 3 * gp)) / 2), bx = Math.round(rh * 0.66)
      let rows = ''
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * (rh + gp)
        rows += `<span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.3)}px;background:${P.soft}"></span>
        <span class="an-p" id="${id}ck${k}" style="left:${x + Math.round(rh * 0.26)}px;top:${y + Math.round((rh - bx) / 2)}px;width:${bx}px;height:${bx}px;border-radius:${Math.round(bx * 0.32)}px;background:${P.acc};display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="66%" height="66%" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg></span>
        <span class="an-p" style="left:${x + Math.round(rh * 0.26) + bx + Math.round(rh * 0.32)}px;top:${y + Math.round(rh * 0.43)}px;width:${Math.round(w * (0.5 - k * 0.06))}px;height:${Math.max(4, Math.round(rh * 0.13))}px;border-radius:99px;background:${P.ink};opacity:.4"></span>`
      }
      return box(rows)
    }
    // ── PAQUET 4 (#157) — du DÉTAIL, pas des aplats.
    // Axel a encore retiré quatre animations du paquet 3 : `bulk` (quatre
    // rectangles orange nus), `broll` (une silhouette grise), `countdown` (un
    // chiffre seul), `subs` (un pavé de texte). Le point commun avec les douze
    // du paquet 2 : une forme pleine sans rien dedans, ou un glyphe isolé. Ici
    // chaque bloc porte de la matière — des lignes de texte, des pastilles, des
    // vignettes, des chiffres — comme une vraie interface qu'on regarde.
    case 'library': {
      // « ta bibliothèque » : la grille de vignettes, l'une d'elles s'ouvre.
      const cols = 3, rows = 2, gp = Math.round(f.w * 0.03)
      const cw = Math.round((f.w * 0.92 - gp * (cols - 1)) / cols), chh = Math.round(cw * 1.16)
      const x0 = Math.round((f.w - (cw * cols + gp * (cols - 1))) / 2)
      const y0 = Math.round((f.h - (chh * rows + gp * rows)) / 2)
      let g = ''
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const k = r * cols + c, hot = k === 4
        g += `<span class="an-p an-lb" id="${id}lb${k}" style="left:${x0 + c * (cw + gp)}px;top:${y0 + r * (chh + gp)}px;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.14)}px;background:${P.soft};border:2px solid ${hot ? P.acc : P.line};overflow:hidden">
          <span style="position:absolute;left:0;top:0;width:100%;height:64%;background:${hot ? P.acc : P.line};opacity:${hot ? 1 : .55}"></span>
          <span style="position:absolute;left:9%;top:73%;width:74%;height:${Math.max(3, Math.round(chh * 0.05))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
          <span style="position:absolute;left:9%;top:86%;width:44%;height:${Math.max(3, Math.round(chh * 0.05))}px;border-radius:99px;background:${P.ink};opacity:.3"></span></span>`
      }
      return box(g)
    }
    case 'queue': {
      // « ça tourne en fond » : les rendus s'enchaînent, un par un, jusqu'au vert.
      const w = Math.round(f.w * 0.88), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.2), gp = Math.round(f.h * 0.06)
      const y0 = Math.round((f.h - (4 * rh + 3 * gp)) / 2)
      let rws = ''
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * (rh + gp), th = Math.round(rh * 0.56)
        rws += `<span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p" style="left:${x + Math.round(rh * 0.28)}px;top:${y + Math.round(rh * 0.22)}px;width:${th}px;height:${th}px;border-radius:${Math.round(th * 0.3)}px;background:${P.line}"></span>
        <span class="an-p" style="left:${x + Math.round(rh * 0.28) + th + Math.round(rh * 0.3)}px;top:${y + Math.round(rh * 0.3)}px;width:${Math.round(w * (0.4 - k * 0.05))}px;height:${Math.max(4, Math.round(rh * 0.11))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
        <span class="an-p" style="left:${x + Math.round(rh * 0.28) + th + Math.round(rh * 0.3)}px;top:${y + Math.round(rh * 0.55)}px;width:${Math.round(w * (0.24 - k * 0.03))}px;height:${Math.max(3, Math.round(rh * 0.09))}px;border-radius:99px;background:${P.ink};opacity:.28"></span>
        <span class="an-p an-qd" id="${id}qd${k}" style="left:${x + w - Math.round(rh * 1.1)}px;top:${y + Math.round((rh - th) / 2)}px;width:${th}px;height:${th}px;border-radius:50%;background:${P.acc};display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg></span>`
      }
      return box(rws)
    }
    case 'notif': {
      // « ça n'arrête pas de sonner » : les bannières s'empilent sur l'écran.
      const pw = Math.round(f.h * 0.52), ph = f.h, px = Math.round((f.w - pw) / 2)
      const bw = Math.round(pw * 0.86), bh = Math.round(pw * 0.3), bx = Math.round((pw - bw) / 2)
      let bs = ''
      for (let k = 0; k < 3; k++) {
        const av = Math.round(bh * 0.52)
        bs += `<span class="an-p an-nb" id="${id}nb${k}" style="left:${bx}px;top:${Math.round(ph * 0.1) + k * Math.round(bh * 1.18)}px;width:${bw}px;height:${bh}px;border-radius:${Math.round(bh * 0.3)}px;background:rgba(255,255,255,.92);box-shadow:0 10px 26px rgba(0,0,0,.4)">
          <span style="position:absolute;left:${Math.round(bh * 0.2)}px;top:${Math.round((bh - av) / 2)}px;width:${av}px;height:${av}px;border-radius:${Math.round(av * 0.32)}px;background:${P.acc}"></span>
          <span style="position:absolute;left:${Math.round(bh * 0.24) + av}px;top:${Math.round(bh * 0.28)}px;width:${[46, 38, 52][k]}%;height:${Math.max(3, Math.round(bh * 0.1))}px;border-radius:99px;background:#111111;opacity:.8"></span>
          <span style="position:absolute;left:${Math.round(bh * 0.24) + av}px;top:${Math.round(bh * 0.55)}px;width:${[62, 54, 44][k]}%;height:${Math.max(3, Math.round(bh * 0.09))}px;border-radius:99px;background:#111111;opacity:.4"></span></span>`
      }
      return box(`<div class="an-ph" style="left:${px}px;top:0;width:${pw}px;height:${ph}px;border:3px solid ${P.line};border-radius:${Math.round(pw * 0.13)}px;overflow:hidden;background:${P.soft}">${bs}</div>`)
    }
    case 'comments': {
      // « les gens réagissent » : le fil de commentaires monte.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.22), av = Math.round(rh * 0.6)
      let cs = ''
      for (let k = 0; k < 4; k++) {
        const y = k * Math.round(rh * 1.06)
        cs += `<span class="an-p an-cm" id="${id}cm${k}" style="left:0;top:${y}px;width:${w}px;height:${rh}px">
          <span style="position:absolute;left:0;top:${Math.round((rh - av) / 2)}px;width:${av}px;height:${av}px;border-radius:50%;background:${k % 2 ? P.acc : P.line}"></span>
          <span style="position:absolute;left:${av + Math.round(rh * 0.2)}px;top:${Math.round(rh * 0.24)}px;width:${[34, 28, 40, 30][k]}%;height:${Math.max(3, Math.round(rh * 0.1))}px;border-radius:99px;background:${P.ink};opacity:.55"></span>
          <span style="position:absolute;left:${av + Math.round(rh * 0.2)}px;top:${Math.round(rh * 0.52)}px;width:${[72, 58, 66, 48][k]}%;height:${Math.max(3, Math.round(rh * 0.09))}px;border-radius:99px;background:${P.ink};opacity:.3"></span>
          <svg viewBox="0 0 24 24" width="${Math.round(rh * 0.3)}" height="${Math.round(rh * 0.3)}" style="position:absolute;right:0;top:${Math.round(rh * 0.34)}px" fill="${P.acc}"><path d="M12 21s-7-4.4-9.5-8.5C.8 9.4 2.3 6 5.5 6 7.6 6 9 7.5 12 10c3-2.5 4.4-4 6.5-4 3.2 0 4.7 3.4 3 6.5C19 16.6 12 21 12 21z"/></svg></span>`
      }
      return box(`<div class="an-p" style="left:${x}px;top:0;width:${w}px;height:${f.h}px;overflow:hidden"><div id="${id}cmw" style="position:absolute;left:0;top:${Math.round(f.h * 0.06)}px;width:100%">${cs}</div></div>`)
    }
    case 'timeline': {
      // « le montage » : la vraie timeline, trois pistes, la tête de lecture passe.
      const w = Math.round(f.w * 0.94), x = Math.round((f.w - w) / 2)
      const th = Math.round(f.h * 0.2), gp = Math.round(f.h * 0.06)
      const y0 = Math.round((f.h - (3 * th + 2 * gp)) / 2)
      let cl = ''
      const cuts = [0, 0.28, 0.52, 0.78]
      cuts.forEach((c, k) => {
        const cw2 = Math.round(w * ((cuts[k + 1] ?? 1) - c)) - 3
        cl += `<span class="an-p" style="left:${x + Math.round(w * c)}px;top:${y0}px;width:${cw2}px;height:${th}px;border-radius:${Math.round(th * 0.18)}px;background:${P.line};overflow:hidden">
          <span style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,${P.ink}22 0 2px,transparent 2px ${Math.round(th * 0.34)}px)"></span></span>`
      })
      let wv = ''
      for (let k = 0; k < 30; k++) {
        const hg = Math.round(th * (0.18 + 0.6 * Math.abs(Math.sin(k * 1.6))))
        wv += `<span style="position:absolute;left:${Math.round(w * 0.02) + k * Math.round(w * 0.032)}px;top:${Math.round((th - hg) / 2)}px;width:${Math.max(2, Math.round(w * 0.008))}px;height:${hg}px;border-radius:99px;background:${P.ink};opacity:.6"></span>`
      }
      let chips = ''
      for (let k = 0; k < 4; k++) chips += `<span style="position:absolute;left:${Math.round(w * (0.03 + k * 0.245))}px;top:${Math.round(th * 0.24)}px;width:${Math.round(w * 0.19)}px;height:${Math.round(th * 0.52)}px;border-radius:${Math.round(th * 0.2)}px;background:${P.acc};opacity:${(0.95 - k * 0.12).toFixed(2)}"></span>`
      return box(`${cl}
        <span class="an-p" style="left:${x}px;top:${y0 + th + gp}px;width:${w}px;height:${th}px;border-radius:${Math.round(th * 0.18)}px;background:${P.soft};overflow:hidden">${wv}</span>
        <span class="an-p" style="left:${x}px;top:${y0 + 2 * (th + gp)}px;width:${w}px;height:${th}px;border-radius:${Math.round(th * 0.18)}px;background:${P.soft};overflow:hidden">${chips}</span>
        <span class="an-p" id="${id}tp" style="left:${x}px;top:${y0 - Math.round(f.h * 0.04)}px;width:${Math.max(3, Math.round(w * 0.006))}px;height:${3 * th + 2 * gp + Math.round(f.h * 0.08)}px;border-radius:99px;background:${P.ink}"></span>`)
    }
    case 'results': {
      // « tu cherches, tu trouves » : la requête s'écrit, les résultats tombent.
      const w = Math.round(f.w * 0.88), x = Math.round((f.w - w) / 2)
      const fh = Math.round(f.h * 0.2), rh = Math.round(f.h * 0.16), gp = Math.round(f.h * 0.05)
      let rs = ''
      for (let k = 0; k < 3; k++) {
        const y = fh + gp + Math.round(f.h * 0.04) + k * (rh + gp)
        rs += `<span class="an-p an-rs" id="${id}rs${k}" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:${P.soft};border:2px solid ${k === 0 ? P.acc : P.line}">
          <span style="position:absolute;left:${Math.round(rh * 0.26)}px;top:${Math.round(rh * 0.24)}px;width:${Math.round(rh * 0.52)}px;height:${Math.round(rh * 0.52)}px;border-radius:${Math.round(rh * 0.18)}px;background:${k === 0 ? P.acc : P.line}"></span>
          <span style="position:absolute;left:${Math.round(rh * 1.02)}px;top:${Math.round(rh * 0.3)}px;width:${[52, 40, 46][k]}%;height:${Math.max(3, Math.round(rh * 0.13))}px;border-radius:99px;background:${P.ink};opacity:.55"></span>
          <span style="position:absolute;left:${Math.round(rh * 1.02)}px;top:${Math.round(rh * 0.6)}px;width:${[34, 28, 24][k]}%;height:${Math.max(3, Math.round(rh * 0.11))}px;border-radius:99px;background:${P.ink};opacity:.3"></span></span>`
      }
      return box(`
        <div class="an-p" style="left:${x}px;top:0;width:${w}px;height:${fh}px;border-radius:99px;background:${P.soft};border:2px solid ${P.line}">
          <svg viewBox="0 0 24 24" width="${Math.round(fh * 0.42)}" height="${Math.round(fh * 0.42)}" style="position:absolute;left:${Math.round(fh * 0.3)}px;top:${Math.round(fh * 0.29)}px" fill="none" stroke="${P.ink}" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <span class="an-p" id="${id}rq" style="left:${Math.round(fh * 0.92)}px;top:${Math.round(fh * 0.44)}px;width:${Math.round(w * 0.5)}px;height:${Math.max(4, Math.round(fh * 0.12))}px;border-radius:99px;background:${P.ink};opacity:.55;transform-origin:0% 50%"></span>
        </div>${rs}`)
    }
    case 'profile': {
      // « ton compte » : l'entête, le compteur d'abonnés, la grille de posts.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const av = Math.round(f.h * 0.24)
      let g = ''
      const cw = Math.round((w - 2 * Math.round(w * 0.025)) / 3)
      for (let k = 0; k < 6; k++) {
        const c = k % 3, r = (k / 3) | 0
        g += `<span class="an-p an-pg" id="${id}pg${k}" style="left:${x + c * (cw + Math.round(w * 0.025))}px;top:${Math.round(f.h * 0.42) + r * (Math.round(cw * 1.1) + Math.round(w * 0.025))}px;width:${cw}px;height:${Math.round(cw * 1.1)}px;border-radius:${Math.round(cw * 0.12)}px;background:${k % 2 ? P.acc : P.line};opacity:${k % 2 ? .9 : .55}"></span>`
      }
      return box(`
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.05)}px;width:${av}px;height:${av}px;border-radius:50%;background:${P.acc};border:3px solid ${P.line}"></span>
        <span class="an-p" style="left:${x + av + Math.round(w * 0.05)}px;top:${Math.round(f.h * 0.1)}px;width:${Math.round(w * 0.34)}px;height:${Math.max(4, Math.round(f.h * 0.035))}px;border-radius:99px;background:${P.ink};opacity:.55"></span>
        <span class="an-p" id="${id}pc" style="left:${x + av + Math.round(w * 0.05)}px;top:${Math.round(f.h * 0.19)}px;width:${Math.round(w * 0.46)}px;height:${Math.round(f.h * 0.13)}px;display:flex;align-items:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.12)}px;color:${P.acc};transform-origin:0% 50%">${txt(0, '+12K')}</span>
        ${g}`)
    }
    case 'invoice': {
      // « la facture » : les lignes se posent, le total tombe.
      const w = Math.round(f.w * 0.76), h = Math.round(f.h * 0.96)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      let ls = ''
      for (let k = 0; k < 4; k++) {
        const ly = Math.round(h * (0.24 + k * 0.13))
        ls += `<span class="an-p an-iv" id="${id}iv${k}" style="left:${Math.round(w * 0.1)}px;top:${ly}px;width:${[52, 44, 58, 38][k]}%;height:${Math.max(3, Math.round(h * 0.026))}px;border-radius:99px;background:${P.ink};opacity:.42"></span>
        <span class="an-p an-iv" style="left:${Math.round(w * 0.68)}px;top:${ly}px;width:${Math.round(w * 0.22)}px;height:${Math.max(3, Math.round(h * 0.026))}px;border-radius:99px;background:${P.ink};opacity:.28"></span>`
      }
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.06)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        <span style="position:absolute;left:0;top:0;width:100%;height:${Math.round(h * 0.13)}px;background:${P.acc}"></span>
        <span style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.045)}px;width:${Math.round(w * 0.34)}px;height:${Math.max(3, Math.round(h * 0.028))}px;border-radius:99px;background:rgba(255,255,255,.9)"></span>
        ${ls}
        <span style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.76)}px;width:${Math.round(w * 0.8)}px;height:2px;background:${P.line}"></span>
        <span class="an-p" id="${id}it" style="left:${Math.round(w * 0.5)}px;top:${Math.round(h * 0.82)}px;width:${Math.round(w * 0.4)}px;height:${Math.round(h * 0.13)}px;display:flex;align-items:center;justify-content:flex-end;font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.11)}px;color:${P.acc}">${txt(0, '490€')}</span></div>`)
    }
    case 'settings': {
      // « tu règles » : les interrupteurs basculent l'un après l'autre.
      const w = Math.round(f.w * 0.84), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.2), gp = Math.round(f.h * 0.06)
      const y0 = Math.round((f.h - (3 * rh + 2 * gp)) / 2)
      const sw = Math.round(rh * 0.9), sh = Math.round(sw * 0.56)
      let rs = ''
      for (let k = 0; k < 3; k++) {
        const y = y0 + k * (rh + gp)
        rs += `<span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p" style="left:${x + Math.round(rh * 0.3)}px;top:${y + Math.round(rh * 0.3)}px;width:${[46, 38, 52][k]}%;height:${Math.max(4, Math.round(rh * 0.12))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
        <span class="an-p" style="left:${x + Math.round(rh * 0.3)}px;top:${y + Math.round(rh * 0.58)}px;width:${[30, 24, 34][k]}%;height:${Math.max(3, Math.round(rh * 0.1))}px;border-radius:99px;background:${P.ink};opacity:.28"></span>
        <span class="an-p an-sb" id="${id}sb${k}" style="left:${x + w - sw - Math.round(rh * 0.3)}px;top:${y + Math.round((rh - sh) / 2)}px;width:${sw}px;height:${sh}px;border-radius:99px;background:${P.line}">
          <span class="an-p an-st" id="${id}st${k}" style="left:${Math.round(sh * 0.12)}px;top:${Math.round(sh * 0.12)}px;width:${Math.round(sh * 0.76)}px;height:${Math.round(sh * 0.76)}px;border-radius:50%;background:#FFFFFF"></span></span>`
      }
      return box(rs)
    }
    case 'versus': {
      // « eux, et toi » : deux colonnes, les croix d'un côté, les coches de l'autre.
      const cw = Math.round(f.w * 0.42), gp = Math.round(f.w * 0.06)
      const x0 = Math.round((f.w - (2 * cw + gp)) / 2)
      const rh = Math.round(f.h * 0.18)
      const col = (cx, ok, idp) => {
        let o = `<span class="an-p" style="left:${cx}px;top:0;width:${cw}px;height:${Math.round(f.h * 0.14)}px;border-radius:${Math.round(f.h * 0.05)}px;background:${ok ? P.acc : P.soft};border:2px solid ${ok ? P.acc : P.line}"></span>`
        for (let k = 0; k < 3; k++) {
          const y = Math.round(f.h * 0.22) + k * (rh + Math.round(f.h * 0.04))
          const ic = ok
            ? `<path d="M5 13l4 4 10-10"/>`
            : `<path d="M6 6l12 12M18 6L6 18"/>`
          o += `<span class="an-p an-vs" id="${idp}${k}" style="left:${cx}px;top:${y}px;width:${cw}px;height:${rh}px">
            <svg viewBox="0 0 24 24" width="${Math.round(rh * 0.62)}" height="${Math.round(rh * 0.62)}" style="position:absolute;left:0;top:${Math.round(rh * 0.19)}px" fill="none" stroke="${ok ? P.acc : P.line}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>
            <span style="position:absolute;left:${Math.round(rh * 0.82)}px;top:${Math.round(rh * 0.42)}px;width:${[62, 76, 54][k]}%;height:${Math.max(3, Math.round(rh * 0.13))}px;border-radius:99px;background:${P.ink};opacity:${ok ? .5 : .28}"></span></span>`
        }
        return o
      }
      return box(col(x0, false, `${id}vl`) + col(x0 + cw + gp, true, `${id}vr`))
    }
    case 'thumb': {
      // « la miniature » : la vignette, son titre, et le compteur qui grimpe.
      const w = Math.round(f.w * 0.8), h = Math.round(w * 0.62)
      const x = Math.round((f.w - w) / 2)
      const pd = Math.round(h * 0.3)
      return box(`
        <div class="an-p" id="${id}tb" style="left:${x}px;top:${Math.round(f.h * 0.05)}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.05)}px;background:${P.line};overflow:hidden;box-shadow:0 20px 44px rgba(0,0,0,.4)">
          <span style="position:absolute;inset:0;background:${grad(140)};opacity:.85"></span>
          <span class="an-p" id="${id}tp2" style="left:50%;top:50%;width:${pd}px;height:${pd}px;margin-left:${-Math.round(pd / 2)}px;margin-top:${-Math.round(pd / 2)}px;border-radius:50%;background:rgba(255,255,255,.94);display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" width="46%" height="46%" fill="#111111"><path d="M8 5l11 7-11 7z"/></svg></span>
          <span style="position:absolute;right:${Math.round(h * 0.08)}px;bottom:${Math.round(h * 0.08)}px;padding:${Math.round(h * 0.045)}px ${Math.round(h * 0.09)}px;border-radius:${Math.round(h * 0.07)}px;background:rgba(0,0,0,.66);font-family:${SANS};font-weight:700;font-size:${Math.round(h * 0.11)}px;color:#FFFFFF">${txt(1, '0:28')}</span>
        </div>
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.05) + h + Math.round(f.h * 0.07)}px;width:${Math.round(w * 0.86)}px;height:${Math.max(4, Math.round(f.h * 0.035))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
        <span class="an-p" id="${id}tv" style="left:${x}px;top:${Math.round(f.h * 0.05) + h + Math.round(f.h * 0.15)}px;width:${Math.round(w * 0.6)}px;height:${Math.round(f.h * 0.12)}px;display:flex;align-items:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.1)}px;color:${P.acc};transform-origin:0% 50%">${txt(0, '1,2M')}</span>`)
    }
    case 'leaderboard': {
      // « passer devant » : le classement, et ta ligne remonte à la première place.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.19), gp = Math.round(f.h * 0.045)
      const y0 = Math.round((f.h - (4 * rh + 3 * gp)) / 2)
      let rs = ''
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * (rh + gp), me = k === 3, av = Math.round(rh * 0.58)
        rs += `<span class="an-p an-ld" id="${id}ld${k}" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:${me ? P.acc : P.soft};border:2px solid ${me ? P.acc : P.line}">
          <span style="position:absolute;left:${Math.round(rh * 0.28)}px;top:${Math.round(rh * 0.28)}px;width:${Math.round(rh * 0.44)}px;height:${Math.round(rh * 0.44)}px;display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(rh * 0.4)}px;color:${me ? '#FFFFFF' : P.ink};opacity:${me ? 1 : .5}">${k + 1}</span>
          <span style="position:absolute;left:${Math.round(rh * 0.9)}px;top:${Math.round((rh - av) / 2)}px;width:${av}px;height:${av}px;border-radius:50%;background:${me ? 'rgba(255,255,255,.9)' : P.line}"></span>
          <span style="position:absolute;left:${Math.round(rh * 1.62)}px;top:${Math.round(rh * 0.42)}px;width:${[42, 34, 48, 38][k]}%;height:${Math.max(4, Math.round(rh * 0.13))}px;border-radius:99px;background:${me ? '#FFFFFF' : P.ink};opacity:${me ? .9 : .45}"></span></span>`
      }
      return box(rs)
    }
    case 'pay': {
      // « ils paient » : le récapitulatif, le bouton, la coche verte.
      const w = Math.round(f.w * 0.78), h = Math.round(f.h * 0.94)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const bh = Math.round(h * 0.17)
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.08)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        <span style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.1)}px;width:${Math.round(w * 0.46)}px;height:${Math.max(4, Math.round(h * 0.028))}px;border-radius:99px;background:${P.ink};opacity:.45"></span>
        <span style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.19)}px;width:${Math.round(w * 0.3)}px;height:${Math.max(3, Math.round(h * 0.024))}px;border-radius:99px;background:${P.ink};opacity:.26"></span>
        <span style="position:absolute;right:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.13)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.085)}px;color:${P.ink}">${txt(0, '49€')}</span>
        <span style="position:absolute;left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.32)}px;width:${Math.round(w * 0.8)}px;height:${Math.round(h * 0.16)}px;border-radius:${Math.round(h * 0.045)}px;background:${P.line};overflow:hidden">
          <span style="position:absolute;left:${Math.round(w * 0.06)}px;top:50%;transform:translateY(-50%);width:${Math.round(w * 0.14)}px;height:${Math.round(h * 0.06)}px;border-radius:${Math.round(h * 0.015)}px;background:${P.acc}"></span>
          <span style="position:absolute;right:${Math.round(w * 0.08)}px;top:50%;transform:translateY(-50%);width:${Math.round(w * 0.3)}px;height:${Math.max(3, Math.round(h * 0.022))}px;border-radius:99px;background:${P.ink};opacity:.4"></span></span>
        <span class="an-p" id="${id}pb" style="left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.56)}px;width:${Math.round(w * 0.8)}px;height:${bh}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(bh * 0.42)}px;color:#FFFFFF">Payer</span>
        <span class="an-p" id="${id}pk" style="left:50%;margin-left:${-Math.round(h * 0.09)}px;top:${Math.round(h * 0.78)}px;width:${Math.round(h * 0.18)}px;height:${Math.round(h * 0.18)}px;border-radius:50%;background:#22C55E;display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg></span></div>`)
    }
    case 'sales': {
      // « les ventes tombent » : les notifications de commande s'empilent avec leur montant.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.21), gp = Math.round(f.h * 0.05)
      const y0 = Math.round(f.h * 0.06)
      const amts = [txt(0, '+49€'), txt(1, '+129€'), txt(2, '+49€')]
      let rs = ''
      for (let k = 0; k < 3; k++) {
        const y = y0 + k * (rh + gp), av = Math.round(rh * 0.54)
        rs += `<span class="an-p an-sl" id="${id}sl${k}" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:${P.soft};border:2px solid ${P.line};box-shadow:0 12px 28px rgba(0,0,0,.28)">
          <span style="position:absolute;left:${Math.round(rh * 0.26)}px;top:${Math.round((rh - av) / 2)}px;width:${av}px;height:${av}px;border-radius:${Math.round(av * 0.3)}px;background:${P.acc};display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 100-2 1 1 0 000 2zM18 20a1 1 0 100-2 1 1 0 000 2z"/></svg></span>
          <span style="position:absolute;left:${Math.round(rh * 0.95)}px;top:${Math.round(rh * 0.28)}px;width:${[38, 30, 44][k]}%;height:${Math.max(4, Math.round(rh * 0.12))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
          <span style="position:absolute;left:${Math.round(rh * 0.95)}px;top:${Math.round(rh * 0.56)}px;width:${[26, 22, 30][k]}%;height:${Math.max(3, Math.round(rh * 0.1))}px;border-radius:99px;background:${P.ink};opacity:.28"></span>
          <span style="position:absolute;right:${Math.round(rh * 0.28)}px;top:50%;transform:translateY(-50%);font-family:'Archivo Black',sans-serif;font-size:${Math.round(rh * 0.3)}px;color:${P.acc}">${amts[k]}</span></span>`
      }
      return box(rs)
    }
    case 'folder': {
      // « tes fichiers » : le dossier s'ouvre, les documents sortent en éventail.
      const fw = Math.round(f.w * 0.5), fh2 = Math.round(fw * 0.76)
      const fx = Math.round((f.w - fw) / 2), fy = Math.round(f.h * 0.4)
      const dw = Math.round(fw * 0.44), dh = Math.round(dw * 1.3)
      let ds = ''
      for (let k = 0; k < 3; k++) {
        ds += `<span class="an-p an-fd" id="${id}fd${k}" style="left:${Math.round((f.w - dw) / 2)}px;top:${fy - Math.round(dh * 0.18)}px;width:${dw}px;height:${dh}px;border-radius:${Math.round(dw * 0.12)}px;background:#FFFFFF;box-shadow:0 12px 28px rgba(0,0,0,.35)">
          ${[0.2, 0.36, 0.52, 0.68].map((t, j) => `<span style="position:absolute;left:14%;top:${t * 100}%;width:${[64, 52, 70, 40][j]}%;height:${Math.max(2, Math.round(dh * 0.035))}px;border-radius:99px;background:#111111;opacity:.3"></span>`).join('')}</span>`
      }
      return box(`${ds}
        <span class="an-p" id="${id}fb" style="left:${fx}px;top:${fy}px;width:${fw}px;height:${fh2}px;border-radius:${Math.round(fw * 0.08)}px;background:${P.acc};box-shadow:0 18px 40px rgba(0,0,0,.4)"></span>
        <span class="an-p" style="left:${fx}px;top:${fy - Math.round(fh2 * 0.16)}px;width:${Math.round(fw * 0.44)}px;height:${Math.round(fh2 * 0.2)}px;border-radius:${Math.round(fw * 0.05)}px ${Math.round(fw * 0.05)}px 0 0;background:${P.acc};opacity:.85"></span>`)
    }
    // ── PAQUET 5 (#157) — l'outil et la vente, avec la même exigence de matière.
    case 'booking': {
      // « il réserve un créneau » : l'agenda de la semaine, un créneau se prend.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const cols = 5, gp = Math.round(w * 0.02)
      const cw = Math.round((w - gp * (cols - 1)) / cols)
      const hh = Math.round(f.h * 0.12), sh = Math.round(f.h * 0.15)
      let head = '', slots = ''
      for (let c = 0; c < cols; c++) {
        head += `<span class="an-p" style="left:${x + c * (cw + gp)}px;top:0;width:${cw}px;height:${hh}px;border-radius:${Math.round(hh * 0.28)}px;background:${P.soft};display:flex;align-items:center;justify-content:center">
          <span style="width:${Math.round(cw * 0.42)}px;height:${Math.max(3, Math.round(hh * 0.16))}px;border-radius:99px;background:${P.ink};opacity:.42"></span></span>`
        for (let r = 0; r < 4; r++) {
          const k = r * cols + c, taken = k === 12
          slots += `<span class="an-p an-bk2" id="${id}bk${k}" style="left:${x + c * (cw + gp)}px;top:${hh + gp + r * (sh + gp)}px;width:${cw}px;height:${sh}px;border-radius:${Math.round(sh * 0.24)}px;background:${taken ? P.acc : P.soft};border:2px solid ${taken ? P.acc : P.line}"></span>`
        }
      }
      return box(head + slots)
    }
    case 'form': {
      // « ils remplissent » : les champs se remplissent, le bouton part.
      const w = Math.round(f.w * 0.82), x = Math.round((f.w - w) / 2)
      const fh = Math.round(f.h * 0.17), gp = Math.round(f.h * 0.06)
      let fs = ''
      for (let k = 0; k < 3; k++) {
        const y = k * (fh + gp)
        fs += `<span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${fh}px;border-radius:${Math.round(fh * 0.26)}px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p an-ff" id="${id}ff${k}" style="left:${x + Math.round(fh * 0.34)}px;top:${y + Math.round(fh * 0.42)}px;width:${[54, 40, 66][k]}%;height:${Math.max(4, Math.round(fh * 0.14))}px;border-radius:99px;background:${P.ink};opacity:.5;transform-origin:0% 50%"></span>`
      }
      const by = 3 * (fh + gp), bh = Math.round(f.h * 0.19)
      return box(`${fs}
        <span class="an-p" id="${id}fbt" style="left:${x}px;top:${by}px;width:${w}px;height:${bh}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(bh * 0.4)}px;color:#FFFFFF">Envoyer</span>`)
    }
    case 'donut': {
      // « la répartition » : l'anneau se remplit, la légende suit.
      const d = Math.round(Math.min(f.w * 0.46, f.h * 0.9))
      const cx2 = Math.round(f.w * 0.3), cy2 = Math.round(f.h / 2)
      const R = d / 2 - Math.round(d * 0.09), C = 2 * Math.PI * R
      const segs = [[0.52, P.acc], [0.28, P.ink], [0.2, P.line]]
      let off = 0, ring = ''
      segs.forEach(([v, col], k) => {
        ring += `<circle id="${id}dn${k}" cx="${d / 2}" cy="${d / 2}" r="${R}" fill="none" stroke="${col}" stroke-width="${Math.round(d * 0.17)}" stroke-dasharray="${(C * v).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-C * off).toFixed(1)}" opacity="${k === 1 ? .55 : 1}" transform="rotate(-90 ${d / 2} ${d / 2})"/>`
        off += v
      })
      let leg = ''
      segs.forEach(([v, col], k) => {
        const ly = Math.round(f.h * 0.28) + k * Math.round(f.h * 0.16)
        leg += `<span class="an-p an-dg" id="${id}dg${k}" style="left:${Math.round(f.w * 0.6)}px;top:${ly}px;width:${Math.round(f.h * 0.07)}px;height:${Math.round(f.h * 0.07)}px;border-radius:${Math.round(f.h * 0.02)}px;background:${col};opacity:${k === 1 ? .55 : 1}"></span>
        <span class="an-p an-dg" style="left:${Math.round(f.w * 0.6 + f.h * 0.11)}px;top:${ly + Math.round(f.h * 0.022)}px;width:${[52, 40, 30][k]}%;height:${Math.max(3, Math.round(f.h * 0.026))}px;border-radius:99px;background:${P.ink};opacity:.42"></span>`
      })
      return box(`<svg class="an-p" id="${id}dnw" style="left:${cx2 - d / 2}px;top:${cy2 - d / 2}px;width:${d}px;height:${d}px">${ring}</svg>${leg}`)
    }
    case 'map': {
      // « partout » : la carte, les épingles qui tombent une à une.
      const w = Math.round(f.w * 0.92), h = Math.round(f.h * 0.9)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const pins = [[0.24, 0.34], [0.52, 0.2], [0.72, 0.46], [0.38, 0.66], [0.84, 0.72]]
      let ps = ''
      pins.forEach(([px2, py2], k) => {
        const pw = Math.round(w * 0.07)
        ps += `<span class="an-p an-mp" id="${id}mp${k}" style="left:${Math.round(w * px2) - pw / 2}px;top:${Math.round(h * py2) - pw}px;width:${pw}px;height:${Math.round(pw * 1.3)}px">
          <svg viewBox="0 0 24 24" width="100%" height="100%" fill="${P.acc}"><path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/></svg></span>`
      })
      let grid = ''
      for (let k = 1; k < 5; k++) grid += `<span style="position:absolute;left:${Math.round(w * k / 5)}px;top:0;width:1px;height:100%;background:${P.ink};opacity:.12"></span>`
      for (let k = 1; k < 4; k++) grid += `<span style="position:absolute;left:0;top:${Math.round(h * k / 4)}px;width:100%;height:1px;background:${P.ink};opacity:.12"></span>`
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.05)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        ${grid}
        <span style="position:absolute;left:8%;top:14%;width:34%;height:26%;border-radius:${Math.round(w * 0.06)}px;background:${P.ink};opacity:.1"></span>
        <span style="position:absolute;left:56%;top:52%;width:36%;height:30%;border-radius:${Math.round(w * 0.07)}px;background:${P.ink};opacity:.1"></span>
        ${ps}</div>`)
    }
    case 'mixer': {
      // « je règle le son » : les curseurs montent, les vu-mètres suivent.
      const n = 4, w = Math.round(f.w * 0.72), x0 = Math.round((f.w - w) / 2)
      const cw = Math.round(w / n), tr = Math.round(f.h * 0.66)
      let ch = ''
      for (let k = 0; k < n; k++) {
        const cx3 = x0 + k * cw + Math.round(cw / 2)
        const lvl = [0.62, 0.44, 0.78, 0.34][k]
        ch += `<span class="an-p" style="left:${cx3 - Math.round(cw * 0.05)}px;top:${Math.round(f.h * 0.06)}px;width:${Math.round(cw * 0.1)}px;height:${tr}px;border-radius:99px;background:${P.soft};border:1px solid ${P.line}"></span>
        <span class="an-p an-mf" id="${id}mf${k}" style="left:${cx3 - Math.round(cw * 0.2)}px;top:${Math.round(f.h * 0.06) + Math.round(tr * (1 - lvl))}px;width:${Math.round(cw * 0.4)}px;height:${Math.round(f.h * 0.055)}px;border-radius:${Math.round(f.h * 0.016)}px;background:${P.acc};box-shadow:0 6px 14px rgba(0,0,0,.35)"></span>
        <span class="an-p an-ml" id="${id}ml${k}" style="left:${cx3 + Math.round(cw * 0.14)}px;top:${Math.round(f.h * 0.06)}px;width:${Math.round(cw * 0.08)}px;height:${tr}px;border-radius:99px;background:${P.acc};transform-origin:50% 100%"></span>
        <span class="an-p" style="left:${cx3 - Math.round(cw * 0.16)}px;top:${Math.round(f.h * 0.06) + tr + Math.round(f.h * 0.06)}px;width:${Math.round(cw * 0.32)}px;height:${Math.max(3, Math.round(f.h * 0.024))}px;border-radius:99px;background:${P.ink};opacity:.4"></span>`
      }
      return box(ch)
    }
    case 'review': {
      // « leurs avis » : la carte de témoignage, les étoiles se remplissent.
      const w = Math.round(f.w * 0.86), h = Math.round(f.h * 0.78)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const av = Math.round(h * 0.22), st = Math.round(h * 0.12)
      let sts = ''
      for (let k = 0; k < 5; k++) sts += `<svg class="an-p an-rv" id="${id}rv${k}" viewBox="0 0 24 24" style="left:${Math.round(w * 0.09) + k * Math.round(st * 1.22)}px;top:${Math.round(h * 0.42)}px;width:${st}px;height:${st}px" fill="${P.acc}"><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 18.6 6.1 21.7l1.2-6.6L2.5 9.5l6.6-.9z"/></svg>`
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.07)}px;background:${P.soft};border:2px solid ${P.line}">
        <span style="position:absolute;left:${Math.round(w * 0.09)}px;top:${Math.round(h * 0.1)}px;width:${av}px;height:${av}px;border-radius:50%;background:${P.acc}"></span>
        <span style="position:absolute;left:${Math.round(w * 0.09) + av + Math.round(w * 0.05)}px;top:${Math.round(h * 0.16)}px;width:${Math.round(w * 0.36)}px;height:${Math.max(4, Math.round(h * 0.035))}px;border-radius:99px;background:${P.ink};opacity:.55"></span>
        <span style="position:absolute;left:${Math.round(w * 0.09) + av + Math.round(w * 0.05)}px;top:${Math.round(h * 0.25)}px;width:${Math.round(w * 0.24)}px;height:${Math.max(3, Math.round(h * 0.03))}px;border-radius:99px;background:${P.ink};opacity:.3"></span>
        ${sts}
        ${[0.62, 0.73, 0.84].map((t, k) => `<span style="position:absolute;left:${Math.round(w * 0.09)}px;top:${Math.round(h * t)}px;width:${[80, 72, 46][k]}%;height:${Math.max(3, Math.round(h * 0.032))}px;border-radius:99px;background:${P.ink};opacity:.38"></span>`).join('')}</div>`)
    }
    case 'upgrade': {
      // « tu passes en Pro » : la carte bascule, les options se débloquent.
      const w = Math.round(f.w * 0.8), h = Math.round(f.h * 0.92)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const rh = Math.round(h * 0.13)
      let rs = ''
      for (let k = 0; k < 4; k++) {
        const ry = Math.round(h * 0.36) + k * (rh + Math.round(h * 0.03))
        rs += `<span class="an-p an-ug" id="${id}ug${k}" style="left:${Math.round(w * 0.1)}px;top:${ry}px;width:${Math.round(rh * 0.6)}px;height:${Math.round(rh * 0.6)}px;border-radius:50%;background:${P.acc};display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg></span>
        <span class="an-p" style="left:${Math.round(w * 0.1) + Math.round(rh * 0.86)}px;top:${ry + Math.round(rh * 0.24)}px;width:${[54, 44, 62, 38][k]}%;height:${Math.max(3, Math.round(rh * 0.18))}px;border-radius:99px;background:${P.ink};opacity:.42"></span>`
      }
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.08)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        <span class="an-p" id="${id}uh" style="left:0;top:0;width:100%;height:${Math.round(h * 0.26)}px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.12)}px;color:#FFFFFF">${txt(0, 'PRO')}</span>
        ${rs}</div>`)
    }
    case 'storyboard': {
      // « plan par plan » : les vignettes numérotées se posent en séquence.
      const n = 3, gp = Math.round(f.w * 0.03)
      const cw = Math.round((f.w * 0.92 - gp * (n - 1)) / n), chh = Math.round(cw * 1.24)
      const x0 = Math.round((f.w - (cw * n + gp * (n - 1))) / 2), y0 = Math.round((f.h - chh) / 2)
      let cs = ''
      for (let k = 0; k < n; k++) {
        cs += `<span class="an-p an-sbd" id="${id}sbd${k}" style="left:${x0 + k * (cw + gp)}px;top:${y0}px;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.1)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          <span style="position:absolute;left:0;top:0;width:100%;height:66%;background:${k === 1 ? P.acc : P.line};opacity:${k === 1 ? 1 : .5}"></span>
          <span style="position:absolute;left:8%;top:6%;width:${Math.round(cw * 0.2)}px;height:${Math.round(cw * 0.2)}px;border-radius:${Math.round(cw * 0.06)}px;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(cw * 0.13)}px;color:#FFFFFF">${k + 1}</span>
          <span style="position:absolute;left:9%;top:74%;width:72%;height:${Math.max(3, Math.round(chh * 0.04))}px;border-radius:99px;background:${P.ink};opacity:.42"></span>
          <span style="position:absolute;left:9%;top:85%;width:44%;height:${Math.max(3, Math.round(chh * 0.04))}px;border-radius:99px;background:${P.ink};opacity:.26"></span></span>`
      }
      return box(cs)
    }
    case 'discount': {
      // « moins cinquante pour cent » : l'ancien prix se barre, le nouveau tombe.
      const w = Math.round(f.w * 0.8), x = Math.round((f.w - w) / 2)
      return box(`
        <span class="an-p" id="${id}do" style="left:${x}px;top:${Math.round(f.h * 0.1)}px;width:${w}px;height:${Math.round(f.h * 0.24)}px;display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.2)}px;color:${P.ink};opacity:.42">${txt(0, '99€')}</span>
        <span class="an-p" id="${id}db" style="left:${Math.round(f.w * 0.3)}px;top:${Math.round(f.h * 0.22)}px;width:${Math.round(f.w * 0.4)}px;height:${Math.max(5, Math.round(f.h * 0.02))}px;border-radius:99px;background:${P.acc};transform-origin:0% 50%"></span>
        <span class="an-p" id="${id}dn2" style="left:${x}px;top:${Math.round(f.h * 0.42)}px;width:${w}px;height:${Math.round(f.h * 0.32)}px;display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.3)}px;color:${P.acc}">${txt(1, '49€')}</span>
        <span class="an-p" id="${id}dc" style="left:50%;margin-left:${-Math.round(f.w * 0.16)}px;top:${Math.round(f.h * 0.78)}px;width:${Math.round(f.w * 0.32)}px;height:${Math.round(f.h * 0.16)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.09)}px;color:#FFFFFF">${txt(2, '-50 %')}</span>`)
    }
    case 'music': {
      // « la musique de fond » : la piste arrive et son volume passe SOUS la voix.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const th = Math.round(f.h * 0.24), gp = Math.round(f.h * 0.09)
      const track = (y, col, seed, op, idn) => {
        let wv = ''
        for (let k = 0; k < 26; k++) {
          const hg = Math.round(th * (0.16 + 0.62 * Math.abs(Math.sin((k + seed) * 1.5))))
          wv += `<span style="position:absolute;left:${Math.round(w * 0.03) + k * Math.round(w * 0.037)}px;top:${Math.round((th - hg) / 2)}px;width:${Math.max(2, Math.round(w * 0.01))}px;height:${hg}px;border-radius:99px;background:${col};opacity:${op}"></span>`
        }
        return `<span class="an-p" ${idn ? `id="${idn}"` : ''} style="left:${x}px;top:${y}px;width:${w}px;height:${th}px;border-radius:${Math.round(th * 0.22)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">${wv}</span>`
      }
      const y0 = Math.round((f.h - (2 * th + gp + f.h * 0.14)) / 2)
      const fy = y0 + 2 * th + gp + Math.round(f.h * 0.04)
      return box(`${track(y0, P.ink, 0, .7)}${track(y0 + th + gp, P.acc, 5, 1, `${id}mt`)}
        <span class="an-p" style="left:${x}px;top:${fy}px;width:${w}px;height:${Math.max(6, Math.round(f.h * 0.022))}px;border-radius:99px;background:${P.soft}"></span>
        <span class="an-p" id="${id}mk" style="left:${x + Math.round(w * 0.8)}px;top:${fy - Math.round(f.h * 0.028)}px;width:${Math.round(f.h * 0.075)}px;height:${Math.round(f.h * 0.075)}px;border-radius:50%;background:${P.acc};box-shadow:0 6px 16px rgba(0,0,0,.4)"></span>`)
    }
    case 'bio': {
      // « le lien en bio » : le profil, le lien qu'on tape, la page qui s'ouvre.
      const pw = Math.round(f.h * 0.5), ph = f.h, px = Math.round((f.w - pw) / 2)
      const av = Math.round(pw * 0.3), lw = Math.round(pw * 0.76)
      return box(`<div class="an-ph" style="left:${px}px;top:0;width:${pw}px;height:${ph}px;border:3px solid ${P.line};border-radius:${Math.round(pw * 0.13)}px;overflow:hidden;background:${P.soft}">
        <span class="an-p" style="left:50%;margin-left:${-Math.round(av / 2)}px;top:${Math.round(ph * 0.07)}px;width:${av}px;height:${av}px;border-radius:50%;background:${P.acc}"></span>
        <span class="an-p" style="left:50%;margin-left:${-Math.round(pw * 0.2)}px;top:${Math.round(ph * 0.07) + av + Math.round(ph * 0.03)}px;width:${Math.round(pw * 0.4)}px;height:${Math.max(4, Math.round(ph * 0.022))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
        <span class="an-p" id="${id}bl2" style="left:50%;margin-left:${-Math.round(lw / 2)}px;top:${Math.round(ph * 0.34)}px;width:${lw}px;height:${Math.round(ph * 0.1)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center">
          <span style="width:52%;height:${Math.max(3, Math.round(ph * 0.016))}px;border-radius:99px;background:rgba(255,255,255,.9)"></span></span>
        <span class="an-p" id="${id}bc" style="left:50%;margin-left:${-Math.round(pw * 0.09)}px;top:${Math.round(ph * 0.4)}px;width:${Math.round(pw * 0.18)}px;height:${Math.round(pw * 0.18)}px;border-radius:50%;border:3px solid ${P.ink};opacity:0"></span>
        <span class="an-p" id="${id}bp" style="left:${Math.round(pw * 0.08)}px;top:${Math.round(ph * 0.5)}px;width:${Math.round(pw * 0.84)}px;height:${Math.round(ph * 0.44)}px;border-radius:${Math.round(pw * 0.1)}px;background:#FFFFFF;box-shadow:0 -14px 34px rgba(0,0,0,.4)">
          ${[0.12, 0.28, 0.44, 0.6].map((t, k) => `<span style="position:absolute;left:10%;top:${t * 100}%;width:${[70, 56, 78, 44][k]}%;height:${Math.max(3, Math.round(ph * 0.016))}px;border-radius:99px;background:#111111;opacity:.3"></span>`).join('')}
          <span style="position:absolute;left:10%;top:78%;width:56%;height:${Math.round(ph * 0.07)}px;border-radius:99px;background:${P.acc}"></span></span>
      </div>`)
    }
    // ── PAQUET 6 (#157) — la mécanique sociale : ce qui se passe AUTOUR du post.
    case 'keyword': {
      // « COMMENTE LE MOT X ». Axel : « on comprend pas très bien ». L'ancienne
      // version posait le mot déjà écrit, une flèche, une bulle : trois symboles
      // à décoder. On montre maintenant le GESTE — le champ de commentaire, le
      // mot qui se TAPE lettre par lettre avec le curseur, puis la réponse qui
      // arrive. C'est le mot lui-même qui est le visuel.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const ch = Math.round(f.h * 0.16), av = Math.round(ch * 0.6)
      const mot = txt(0, 'HOOKS')
      const lettres = mot.split('').map((c, k) =>
        `<span class="an-kl" style="opacity:0">${c === ' ' ? '&nbsp;' : c}</span>`).join('')
      // l'icône COMMENTAIRE remplace la pastille grise : on doit reconnaître d'un
      // coup d'œil qu'on est dans un champ de commentaire, pas dans une recherche.
      const bulle = `<svg viewBox="0 0 24 24" style="width:${av}px;height:${av}px;flex:none" fill="none" stroke="${P.acc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.9-.4L3 21l1.5-4.6A8.3 8.3 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 9 8.4Z"/></svg>`
      return box(`
        <span class="an-p" id="${id}kc" style="left:${x}px;top:${Math.round(f.h * 0.08)}px;width:${w}px;height:${ch}px;border-radius:${Math.round(ch * 0.5)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;padding:0 ${Math.round(ch * 0.3)}px;box-sizing:border-box;gap:${Math.round(ch * 0.26)}px">
          ${bulle}
          <span id="${id}kw" style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(ch * 0.42)}px;color:${P.acc};letter-spacing:.02em;white-space:nowrap">${lettres}</span>
          <span id="${id}kr" style="width:${Math.max(3, Math.round(ch * 0.05))}px;height:${Math.round(ch * 0.46)}px;background:${P.acc};border-radius:2px"></span></span>
        <span class="an-p" id="${id}kb" style="left:${x + w - Math.round(w * 0.3)}px;top:${Math.round(f.h * 0.08) + ch + Math.round(f.h * 0.03)}px;width:${Math.round(w * 0.3)}px;height:${Math.round(ch * 0.72)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(ch * 0.3)}px;color:#FFFFFF;opacity:0">ENVOYER</span>
        <span class="an-p" id="${id}km" style="left:${x}px;top:${Math.round(f.h * 0.5)}px;width:${Math.round(w * 0.82)}px;height:${Math.round(f.h * 0.36)}px;border-radius:${Math.round(f.h * 0.07)}px;border-bottom-left-radius:${Math.round(f.h * 0.02)}px;background:${grad(150)};box-shadow:0 16px 36px rgba(0,0,0,.28);opacity:0">
          <!-- Axel : « quand il envoie, PLAN disparaît de la zone de texte et se met
               dans le message orange ». Le mot VOYAGE : c'est ce déplacement qui
               raconte l'envoi, pas une bulle qui apparaît toute faite. -->
          <span id="${id}kmw" style="position:absolute;left:9%;top:14%;font-family:'Archivo Black',sans-serif;font-size:${Math.round(ch * 0.42)}px;color:#FFFFFF;letter-spacing:.02em;opacity:0">${mot}</span>
          ${[0.42, 0.58].map((t, k) => `<span style="position:absolute;left:9%;top:${t * 100}%;width:${[76, 54][k]}%;height:${Math.max(3, Math.round(f.h * 0.018))}px;border-radius:99px;background:rgba(255,255,255,.85)"></span>`).join('')}
          <span style="position:absolute;left:9%;top:74%;width:64%;height:${Math.round(f.h * 0.08)}px;border-radius:99px;background:rgba(255,255,255,.96)"></span></span>`)
    }
    case 'automation': {
      // « c'est automatique » : le declencheur, la condition, les deux branches.
      const bw = Math.round(f.w * 0.44), bh = Math.round(f.h * 0.17)
      const cx2 = Math.round((f.w - bw) / 2)
      const node = (x, y, w2, col, idn) => `<span class="an-p an-au" ${idn ? `id="${idn}"` : ''} style="left:${x}px;top:${y}px;width:${w2}px;height:${bh}px;border-radius:${Math.round(bh * 0.28)}px;background:${col};border:2px solid ${col === P.soft ? P.line : col}">
        <span style="position:absolute;left:10%;top:32%;width:56%;height:${Math.max(3, Math.round(bh * 0.13))}px;border-radius:99px;background:${col === P.soft ? P.ink : '#FFFFFF'};opacity:${col === P.soft ? .45 : .9}"></span>
        <span style="position:absolute;left:10%;top:60%;width:34%;height:${Math.max(3, Math.round(bh * 0.11))}px;border-radius:99px;background:${col === P.soft ? P.ink : '#FFFFFF'};opacity:${col === P.soft ? .26 : .6}"></span></span>`
      const sw = Math.round(f.w * 0.4)
      return box(`
        ${node(cx2, 0, bw, P.acc, `${id}a0`)}
        <span class="an-p" style="left:50%;width:2px;margin-left:-1px;top:${bh}px;height:${Math.round(f.h * 0.1)}px;background:${P.line}"></span>
        ${node(cx2, Math.round(bh + f.h * 0.1), bw, P.soft, `${id}a1`)}
        <span class="an-p" style="left:${Math.round(f.w * 0.24)}px;top:${Math.round(2 * bh + f.h * 0.1)}px;width:${Math.round(f.w * 0.52)}px;height:2px;background:${P.line}"></span>
        <span class="an-p" style="left:${Math.round(f.w * 0.24)}px;top:${Math.round(2 * bh + f.h * 0.1)}px;width:2px;height:${Math.round(f.h * 0.08)}px;background:${P.line}"></span>
        <span class="an-p" style="left:${Math.round(f.w * 0.76)}px;top:${Math.round(2 * bh + f.h * 0.1)}px;width:2px;height:${Math.round(f.h * 0.08)}px;background:${P.line}"></span>
        ${node(Math.round(f.w * 0.04), Math.round(2 * bh + f.h * 0.18), sw, P.soft, `${id}a2`)}
        ${node(Math.round(f.w * 0.56), Math.round(2 * bh + f.h * 0.18), sw, P.acc, `${id}a3`)}`)
    }
    case 'carousel': {
      // « le carrousel » : les slides defilent, les points suivent.
      const cw = Math.round(f.w * 0.56), chh = Math.round(f.h * 0.78)
      const cx2 = Math.round((f.w - cw) / 2)
      let sl = ''
      for (let k = 0; k < 3; k++) {
        sl += `<span class="an-p an-cr" style="left:${k * cw}px;top:0;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.1)}px;background:${k === 1 ? P.acc : P.line};opacity:${k === 1 ? 1 : .6};overflow:hidden">
          <span style="position:absolute;left:10%;top:${k === 1 ? 16 : 20}%;width:64%;height:${Math.max(4, Math.round(chh * 0.035))}px;border-radius:99px;background:#FFFFFF;opacity:.85"></span>
          <span style="position:absolute;left:10%;top:${k === 1 ? 26 : 30}%;width:44%;height:${Math.max(3, Math.round(chh * 0.028))}px;border-radius:99px;background:#FFFFFF;opacity:.5"></span></span>`
      }
      let dots = ''
      for (let k = 0; k < 3; k++) dots += `<span class="an-p an-cd" id="${id}cd${k}" style="left:${Math.round(f.w / 2) + (k - 1) * Math.round(f.h * 0.05) - Math.round(f.h * 0.014)}px;top:${chh + Math.round(f.h * 0.07)}px;width:${Math.round(f.h * 0.028)}px;height:${Math.round(f.h * 0.028)}px;border-radius:50%;background:${k === 0 ? P.acc : P.line}"></span>`
      return box(`<span class="an-p" style="left:${cx2}px;top:0;width:${cw}px;height:${chh}px;overflow:hidden;border-radius:${Math.round(cw * 0.1)}px">
        <span class="an-p" id="${id}crw" style="left:0;top:0;width:${3 * cw}px;height:${chh}px">${sl}</span></span>${dots}`)
    }
    case 'poll': {
      // « ils votent » : le sondage, les deux barres se remplissent.
      const w = Math.round(f.w * 0.84), x = Math.round((f.w - w) / 2)
      const bh = Math.round(f.h * 0.22)
      const opt = (y, pct, idn, hot) => `<span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${bh}px;border-radius:${Math.round(bh * 0.3)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        <span class="an-p" id="${idn}" style="left:0;top:0;width:${pct}%;height:100%;background:${hot ? P.acc : P.line};transform-origin:0% 50%"></span>
        <span style="position:absolute;left:${Math.round(bh * 0.34)}px;top:50%;transform:translateY(-50%);width:${Math.round(w * 0.34)}px;height:${Math.max(4, Math.round(bh * 0.13))}px;border-radius:99px;background:${P.ink};opacity:.5;z-index:2"></span>
        <span style="position:absolute;right:${Math.round(bh * 0.34)}px;top:50%;transform:translateY(-50%);font-family:'Archivo Black',sans-serif;font-size:${Math.round(bh * 0.32)}px;color:${hot ? '#FFFFFF' : P.ink};z-index:2">${pct} %</span></span>`
      const y0 = Math.round((f.h - (2 * bh + f.h * 0.08 + f.h * 0.12)) / 2)
      return box(`
        <span class="an-p" style="left:${x}px;top:${y0}px;width:${Math.round(w * 0.6)}px;height:${Math.max(4, Math.round(f.h * 0.03))}px;border-radius:99px;background:${P.ink};opacity:.45"></span>
        ${opt(y0 + Math.round(f.h * 0.12), 72, `${id}p1`, true)}
        ${opt(y0 + Math.round(f.h * 0.12) + bh + Math.round(f.h * 0.08), 28, `${id}p2`, false)}`)
    }
    case 'story': {
      // « en story » : les anneaux, et la barre de story qui se remplit.
      const n = 5, d = Math.round(f.w * 0.15), gp = Math.round(f.w * 0.03)
      const x0 = Math.round((f.w - (n * d + (n - 1) * gp)) / 2)
      let rs = ''
      for (let k = 0; k < n; k++) rs += `<span class="an-p an-st2" id="${id}st${k}" style="left:${x0 + k * (d + gp)}px;top:${Math.round(f.h * 0.08)}px;width:${d}px;height:${d}px;border-radius:50%;background:${P.line};border:3px solid ${k === 1 ? P.acc : 'transparent'}"></span>`
      const pw = Math.round(f.h * 0.34), ph = Math.round(pw * 1.7), px = Math.round((f.w - pw) / 2)
      let bars = ''
      for (let k = 0; k < 4; k++) bars += `<span style="position:absolute;left:${Math.round(pw * (0.06 + k * 0.23))}px;top:${Math.round(ph * 0.05)}px;width:${Math.round(pw * 0.2)}px;height:${Math.max(3, Math.round(ph * 0.012))}px;border-radius:99px;background:rgba(255,255,255,.35);overflow:hidden">
        ${k === 1 ? `<span id="${id}sb2" style="position:absolute;left:0;top:0;width:100%;height:100%;background:#FFFFFF;transform-origin:0% 50%"></span>` : ''}</span>`
      return box(`${rs}
        <span class="an-p" id="${id}sp" style="left:${px}px;top:${Math.round(f.h * 0.32)}px;width:${pw}px;height:${ph}px;border-radius:${Math.round(pw * 0.14)}px;background:${grad(150)};overflow:hidden">${bars}</span>`)
    }
    case 'hashtag': {
      // « les hashtags » : la liste, avec le nombre de publications.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.18), gp = Math.round(f.h * 0.05)
      const y0 = Math.round((f.h - (4 * rh + 3 * gp)) / 2)
      const nums = ['1,2M', '840K', '312K', '96K']
      let rs = ''
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * (rh + gp), hot = k === 0
        rs += `<span class="an-p an-ht" id="${id}ht${k}" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.3)}px;background:${hot ? P.acc : P.soft};border:2px solid ${hot ? P.acc : P.line}">
          <span style="position:absolute;left:${Math.round(rh * 0.3)}px;top:50%;transform:translateY(-50%);font-family:'Archivo Black',sans-serif;font-size:${Math.round(rh * 0.42)}px;color:${hot ? '#FFFFFF' : P.ink};opacity:${hot ? 1 : .5}">#</span>
          <span style="position:absolute;left:${Math.round(rh * 0.85)}px;top:50%;transform:translateY(-50%);width:${[42, 34, 48, 30][k]}%;height:${Math.max(4, Math.round(rh * 0.14))}px;border-radius:99px;background:${hot ? '#FFFFFF' : P.ink};opacity:${hot ? .9 : .42}"></span>
          <span style="position:absolute;right:${Math.round(rh * 0.32)}px;top:50%;transform:translateY(-50%);font-family:${SANS};font-weight:800;font-size:${Math.round(rh * 0.26)}px;color:${hot ? '#FFFFFF' : P.ink};opacity:${hot ? .9 : .4}">${nums[k]}</span></span>`
      }
      return box(rs)
    }
    case 'schedule': {
      // « c'est programme » : les publications se posent dans les creneaux.
      const w = Math.round(f.w * 0.92), x = Math.round((f.w - w) / 2)
      const cols = 4, gp = Math.round(w * 0.025)
      const cw = Math.round((w - gp * (cols - 1)) / cols), chh = Math.round(f.h * 0.2)
      const y0 = Math.round((f.h - (3 * chh + 2 * gp)) / 2)
      const filled = [1, 4, 6, 9, 11]
      let cs = ''
      for (let k = 0; k < 12; k++) {
        const c = k % cols, r = (k / cols) | 0, on = filled.includes(k)
        cs += `<span class="an-p" style="left:${x + c * (cw + gp)}px;top:${y0 + r * (chh + gp)}px;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.16)}px;background:${P.soft};border:2px dashed ${P.line}"></span>
        ${on ? `<span class="an-p an-sc" id="${id}sc${k}" style="left:${x + c * (cw + gp)}px;top:${y0 + r * (chh + gp)}px;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.16)}px;background:${P.acc};overflow:hidden">
          <span style="position:absolute;left:14%;top:22%;width:62%;height:${Math.max(3, Math.round(chh * 0.08))}px;border-radius:99px;background:rgba(255,255,255,.9)"></span>
          <span style="position:absolute;left:14%;top:44%;width:40%;height:${Math.max(3, Math.round(chh * 0.07))}px;border-radius:99px;background:rgba(255,255,255,.6)"></span>
          <span style="position:absolute;left:14%;bottom:16%;width:${Math.round(cw * 0.3)}px;height:${Math.round(chh * 0.16)}px;border-radius:99px;background:rgba(255,255,255,.24)"></span></span>` : ''}`
      }
      return box(cs)
    }
    case 'pin': {
      // « le commentaire epingle » : il remonte tout en haut avec sa punaise.
      const w = Math.round(f.w * 0.88), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.2), gp = Math.round(f.h * 0.05)
      const y0 = Math.round((f.h - (4 * rh + 3 * gp)) / 2)
      let rs = ''
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * (rh + gp), me = k === 3, av = Math.round(rh * 0.54)
        rs += `<span class="an-p an-pn" id="${id}pn${k}" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:${me ? P.acc : P.soft};border:2px solid ${me ? P.acc : P.line}">
          <span style="position:absolute;left:${Math.round(rh * 0.26)}px;top:${Math.round((rh - av) / 2)}px;width:${av}px;height:${av}px;border-radius:50%;background:${me ? 'rgba(255,255,255,.9)' : P.line}"></span>
          <span style="position:absolute;left:${Math.round(rh * 0.95)}px;top:${Math.round(rh * 0.26)}px;width:${[40, 32, 46, 52][k]}%;height:${Math.max(4, Math.round(rh * 0.12))}px;border-radius:99px;background:${me ? '#FFFFFF' : P.ink};opacity:${me ? .9 : .45}"></span>
          <span style="position:absolute;left:${Math.round(rh * 0.95)}px;top:${Math.round(rh * 0.56)}px;width:${[28, 22, 34, 30][k]}%;height:${Math.max(3, Math.round(rh * 0.1))}px;border-radius:99px;background:${me ? '#FFFFFF' : P.ink};opacity:${me ? .6 : .26}"></span>
          ${me ? `<svg viewBox="0 0 24 24" width="${Math.round(rh * 0.34)}" height="${Math.round(rh * 0.34)}" style="position:absolute;right:${Math.round(rh * 0.3)}px;top:50%;transform:translateY(-50%)" fill="#FFFFFF"><path d="M14 2l8 8-3 1-3 6-2-2-5 5-1 3-1-1 3-1 5-5-2-2 6-3z"/></svg>` : ''}</span>`
      }
      return box(rs)
    }
    case 'qr': {
      // « scanne le code » : le QR se dessine, le trait balaie, la page s'ouvre.
      const d = Math.round(Math.min(f.w * 0.44, f.h * 0.62))
      const x = Math.round(f.w * 0.28) - Math.round(d / 2), y = Math.round((f.h - d) / 2)
      // Un QR se reconnait a ses TROIS carres de reperage aux coins — sans eux
      // la grille aleatoire ne ressemble a rien (premiere version : des blocs).
      const N = 11, cell = Math.round(d / (N + 2)), pad = cell
      const finder = (fx, fy) => {
        let o = ''
        for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
          const edge = r === 0 || r === 6 || c === 0 || c === 6
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4
          if (!edge && !core) continue
          o += `<span style="position:absolute;left:${pad + (fx + c) * cell}px;top:${pad + (fy + r) * cell}px;width:${cell}px;height:${cell}px;background:#111111"></span>`
        }
        return o
      }
      let cells = finder(0, 0) + finder(N - 7, 0) + finder(0, N - 7)
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const inFinder = (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8)
        if (inFinder) continue
        if ((Math.sin(r * 12.9898 + c * 78.233) * 43758.5453 % 1 + 1) % 1 > 0.52) continue
        cells += `<span style="position:absolute;left:${pad + c * cell}px;top:${pad + r * cell}px;width:${cell}px;height:${cell}px;background:#111111"></span>`
      }
      const pw = Math.round(f.w * 0.3), ph = Math.round(pw * 1.6)
      return box(`
        <span class="an-p" id="${id}qb" style="left:${x}px;top:${y}px;width:${d}px;height:${d}px;background:#FFFFFF;border-radius:${Math.round(d * 0.08)}px;overflow:hidden;padding:0">${cells}
          <span class="an-p" id="${id}ql" style="left:0;top:0;width:100%;height:${Math.max(4, Math.round(d * 0.03))}px;background:${P.acc};box-shadow:0 0 18px ${P.acc}"></span></span>
        <span class="an-p" id="${id}qp" style="left:${Math.round(f.w * 0.72) - Math.round(pw / 2)}px;top:${Math.round((f.h - ph) / 2)}px;width:${pw}px;height:${ph}px;border-radius:${Math.round(pw * 0.14)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          <span style="position:absolute;left:0;top:0;width:100%;height:34%;background:${P.acc}"></span>
          ${[0.44, 0.56, 0.68].map((t, k) => `<span style="position:absolute;left:12%;top:${t * 100}%;width:${[70, 56, 40][k]}%;height:${Math.max(3, Math.round(ph * 0.022))}px;border-radius:99px;background:${P.ink};opacity:.32"></span>`).join('')}
          <span style="position:absolute;left:12%;bottom:10%;width:60%;height:${Math.round(ph * 0.09)}px;border-radius:99px;background:${P.acc}"></span></span>`)
    }
    case 'wizard': {
      // « en trois etapes » : la barre avance, le panneau change.
      const w = Math.round(f.w * 0.88), x = Math.round((f.w - w) / 2)
      const d = Math.round(f.h * 0.11)
      let st = ''
      for (let k = 0; k < 3; k++) {
        const cxs = x + Math.round(w * (0.08 + k * 0.42))
        st += `<span class="an-p an-wz" id="${id}wz${k}" style="left:${cxs - Math.round(d / 2)}px;top:0;width:${d}px;height:${d}px;border-radius:50%;background:${k === 0 ? P.acc : P.soft};border:2px solid ${k === 0 ? P.acc : P.line};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(d * 0.46)}px;color:${k === 0 ? '#FFFFFF' : P.ink};opacity:${k === 0 ? 1 : .45}">${k + 1}</span>`
      }
      return box(`
        <span class="an-p" style="left:${x + Math.round(w * 0.08)}px;top:${Math.round(d / 2) - 2}px;width:${Math.round(w * 0.84)}px;height:4px;border-radius:99px;background:${P.line}"></span>
        <span class="an-p" id="${id}wb" style="left:${x + Math.round(w * 0.08)}px;top:${Math.round(d / 2) - 2}px;width:${Math.round(w * 0.84)}px;height:4px;border-radius:99px;background:${P.acc};transform-origin:0% 50%"></span>
        ${st}
        <span class="an-p" id="${id}wp" style="left:${x}px;top:${Math.round(d + f.h * 0.1)}px;width:${w}px;height:${Math.round(f.h * 0.62)}px;border-radius:${Math.round(w * 0.06)}px;background:${P.soft};border:2px solid ${P.line}">
          ${[0.14, 0.34, 0.54].map((t, k) => `<span style="position:absolute;left:8%;top:${t * 100}%;width:84%;height:${Math.round(f.h * 0.1)}px;border-radius:${Math.round(f.h * 0.03)}px;background:${P.line};opacity:.5"></span>`).join('')}
          <span style="position:absolute;left:8%;bottom:10%;width:44%;height:${Math.round(f.h * 0.1)}px;border-radius:99px;background:${P.acc}"></span></span>`)
    }
    // ── PAQUET 7 (#157) — LES DOMAINES D'ACTIVITE. La banque parlait creation de
    // contenu ; ses utilisateurs vendent des produits, tradent, editent des
    // logiciels, louent des biens. Un e-commercant qui dit « mon panier moyen »
    // n'avait rien a mettre a l'ecran.
    case 'product': {
      // E-COMMERCE — la fiche produit : visuel, prix, bouton.
      const w = Math.round(f.w * 0.68), h = Math.round(f.h * 0.96)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const iv = Math.round(h * 0.46)
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.08)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        <span class="an-p an-pd" style="left:0;top:0;width:100%;height:${iv}px;background:${grad(140)}">
          <span style="position:absolute;left:50%;top:50%;width:${Math.round(w * 0.34)}px;height:${Math.round(w * 0.34)}px;margin-left:${-Math.round(w * 0.17)}px;margin-top:${-Math.round(w * 0.17)}px;border-radius:${Math.round(w * 0.08)}px;background:rgba(255,255,255,.28)"></span></span>
        <span class="an-p an-pd" style="left:${Math.round(w * 0.09)}px;top:${iv + Math.round(h * 0.06)}px;width:${Math.round(w * 0.66)}px;height:${Math.max(4, Math.round(h * 0.032))}px;border-radius:99px;background:${P.ink};opacity:.55"></span>
        <span class="an-p an-pd" style="left:${Math.round(w * 0.09)}px;top:${iv + Math.round(h * 0.12)}px;width:${Math.round(w * 0.42)}px;height:${Math.max(3, Math.round(h * 0.026))}px;border-radius:99px;background:${P.ink};opacity:.3"></span>
        ${txt(0, '')
          ? `<span class="an-p an-pd" style="left:${Math.round(w * 0.09)}px;top:${iv + Math.round(h * 0.19)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.09)}px;color:${P.acc}">${txt(0, '')}</span>`
          : `<span class="an-p an-pd" style="left:${Math.round(w * 0.09)}px;top:${iv + Math.round(h * 0.2)}px;width:${Math.round(w * 0.28)}px;height:${Math.round(h * 0.06)}px;border-radius:99px;background:${P.acc};opacity:.85"></span>`}
        <span class="an-p" id="${id}pdb" style="left:${Math.round(w * 0.09)}px;top:${h - Math.round(h * 0.17)}px;width:${Math.round(w * 0.82)}px;height:${Math.round(h * 0.11)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(h * 0.05)}px;color:#FFFFFF">Ajouter au panier</span></div>`)
    }
    case 'lineup': {
      // LE PRÉSENTOIR QUI SE REMPLIT (retour d'Axel 31/07) : « sans forcément
      // écrire "formation" "coaching" — à chaque fois que j'en dis un,
      // l'animation ajoute UN truc ». Une étagère vide, et une offre VISUELLE
      // qui se pose à chaque terme prononcé : un colis (produit physique), une
      // personne qui parle (coaching), un cours qui se joue (formation). Aucun
      // mot écrit — le sous-titre les porte déjà. Les instants d'arrivée
      // viennent des items du plan (it.t) : chaque carte claque SUR son mot.
      const n = Math.max(2, Math.min(4, (s.items || []).length || 3))
      const cw = Math.round(f.w * (n > 3 ? 0.2 : 0.24))
      const ch = Math.round(cw * 1.28)
      const gap = Math.round(f.w * 0.05)
      const total = n * cw + (n - 1) * gap
      const x0 = Math.round((f.w - total) / 2)
      const cy = Math.round(f.h * 0.5 - ch / 2)
      const shelfY = cy + ch + Math.round(f.h * 0.055)
      // l'étagère est là AVANT les cartes : la scène existe, elle attend
      let h = `<span class="an-p" style="left:${x0 - gap}px;top:${shelfY}px;width:${total + 2 * gap}px;height:4px;border-radius:99px;background:${P.ink};opacity:.35"></span>`
      const rr = Math.round(cw * 0.14)
      const mocks = {
        // LE COLIS : la boîte, son rabat clair, sa bande de scotch
        colis: (ix) => `
          <span style="position:absolute;left:${Math.round(cw * 0.18)}px;top:${Math.round(ch * 0.3)}px;width:${Math.round(cw * 0.64)}px;height:${Math.round(ch * 0.42)}px;border-radius:${Math.round(cw * 0.08)}px;background:${grad(150)}"></span>
          <span style="position:absolute;left:${Math.round(cw * 0.18)}px;top:${Math.round(ch * 0.3)}px;width:${Math.round(cw * 0.64)}px;height:${Math.round(ch * 0.11)}px;border-radius:${Math.round(cw * 0.08)}px ${Math.round(cw * 0.08)}px 0 0;background:rgba(255,255,255,.35)"></span>
          <span style="position:absolute;left:${Math.round(cw * 0.46)}px;top:${Math.round(ch * 0.3)}px;width:${Math.round(cw * 0.08)}px;height:${Math.round(ch * 0.42)}px;background:rgba(255,255,255,.5)"></span>`,
        // LA PERSONNE : tête + épaules + bulle qui pop (le coaching, c'est
        // quelqu'un qui te parle)
        personne: (ix) => `
          <span style="position:absolute;left:${Math.round(cw * 0.33)}px;top:${Math.round(ch * 0.2)}px;width:${Math.round(cw * 0.34)}px;height:${Math.round(cw * 0.34)}px;border-radius:50%;background:${P.acc}"></span>
          <span style="position:absolute;left:${Math.round(cw * 0.22)}px;top:${Math.round(ch * 0.52)}px;width:${Math.round(cw * 0.56)}px;height:${Math.round(ch * 0.24)}px;border-radius:99px 99px 0 0;background:${P.acc}"></span>
          <span class="an-p" id="${ix}bub" style="left:${Math.round(cw * 0.06)}px;top:${Math.round(ch * 0.08)}px;width:${Math.round(cw * 0.32)}px;height:${Math.round(ch * 0.15)}px;border-radius:${Math.round(cw * 0.1)}px ${Math.round(cw * 0.1)}px 2px ${Math.round(cw * 0.1)}px;background:${P.ink};opacity:0"></span>`,
        // LE COURS : l'écran, son play, sa barre de progression qui avance
        cours: (ix) => `
          <span style="position:absolute;left:${Math.round(cw * 0.14)}px;top:${Math.round(ch * 0.24)}px;width:${Math.round(cw * 0.72)}px;height:${Math.round(ch * 0.4)}px;border-radius:${Math.round(cw * 0.07)}px;background:${P.ink}"></span>
          <span style="position:absolute;left:${Math.round(cw * 0.44)}px;top:${Math.round(ch * 0.36)}px;width:0;height:0;border-top:${Math.round(cw * 0.07)}px solid transparent;border-bottom:${Math.round(cw * 0.07)}px solid transparent;border-left:${Math.round(cw * 0.12)}px solid #FFFFFF"></span>
          <span style="position:absolute;left:${Math.round(cw * 0.14)}px;top:${Math.round(ch * 0.73)}px;width:${Math.round(cw * 0.72)}px;height:${Math.round(ch * 0.06)}px;border-radius:99px;background:${P.line}"></span>
          <span class="an-p" id="${ix}bar" style="left:${Math.round(cw * 0.14)}px;top:${Math.round(ch * 0.73)}px;width:${Math.round(cw * 0.72)}px;height:${Math.round(ch * 0.06)}px;border-radius:99px;background:${P.acc};transform:scaleX(0);transform-origin:0 50%"></span>`,
        // LE CALQUE QUI GLISSE : deux panneaux superposés, celui du dessus
        // décalé — « des animations », c'est quelque chose qui BOUGE
        calque: (ix) => `
          <span style="position:absolute;left:${Math.round(cw * 0.16)}px;top:${Math.round(ch * 0.34)}px;width:${Math.round(cw * 0.52)}px;height:${Math.round(ch * 0.34)}px;border-radius:${Math.round(cw * 0.08)}px;background:${P.line}"></span>
          <span class="an-p" id="${ix}mv" style="left:${Math.round(cw * 0.32)}px;top:${Math.round(ch * 0.24)}px;width:${Math.round(cw * 0.52)}px;height:${Math.round(ch * 0.34)}px;border-radius:${Math.round(cw * 0.08)}px;background:${P.acc};box-shadow:0 8px 18px rgba(0,0,0,.18)"></span>`,
        // LE HAUT-PARLEUR : le cône + deux arcs qui claquent — un son s'entend,
        // les arcs le montrent
        son: (ix) => `
          <span style="position:absolute;left:${Math.round(cw * 0.16)}px;top:${Math.round(ch * 0.4)}px;width:${Math.round(cw * 0.16)}px;height:${Math.round(ch * 0.18)}px;border-radius:3px;background:${P.ink}"></span>
          <span style="position:absolute;left:${Math.round(cw * 0.28)}px;top:${Math.round(ch * 0.32)}px;width:0;height:0;border-top:${Math.round(ch * 0.17)}px solid transparent;border-bottom:${Math.round(ch * 0.17)}px solid transparent;border-right:${Math.round(cw * 0.22)}px solid ${P.ink}"></span>
          <span class="an-p" id="${ix}w1" style="left:${Math.round(cw * 0.56)}px;top:${Math.round(ch * 0.34)}px;width:${Math.round(cw * 0.14)}px;height:${Math.round(ch * 0.3)}px;border:4px solid ${P.acc};border-left:none;border-radius:0 99px 99px 0;background:transparent;opacity:0"></span>
          <span class="an-p" id="${ix}w2" style="left:${Math.round(cw * 0.7)}px;top:${Math.round(ch * 0.27)}px;width:${Math.round(cw * 0.18)}px;height:${Math.round(ch * 0.44)}px;border:4px solid ${P.acc};border-left:none;border-radius:0 99px 99px 0;background:transparent;opacity:0"></span>`,
        // LA TRANSITION : deux panneaux, celui du dessus GLISSE par-dessus
        // l'autre — l'enchaînement, montré
        transition: (ix) => `
          <span style="position:absolute;left:${Math.round(cw * 0.14)}px;top:${Math.round(ch * 0.3)}px;width:${Math.round(cw * 0.44)}px;height:${Math.round(ch * 0.4)}px;border-radius:${Math.round(cw * 0.07)}px;background:${P.line}"></span>
          <span class="an-p" id="${ix}sl" style="left:${Math.round(cw * 0.42)}px;top:${Math.round(ch * 0.3)}px;width:${Math.round(cw * 0.44)}px;height:${Math.round(ch * 0.4)}px;border-radius:${Math.round(cw * 0.07)}px;background:${P.acc};box-shadow:-6px 0 14px rgba(0,0,0,.16)"></span>`,
        // repli générique : la carte à lignes muettes
        carte: (ix) => `
          <span style="position:absolute;left:${Math.round(cw * 0.18)}px;top:${Math.round(ch * 0.28)}px;width:${Math.round(cw * 0.64)}px;height:${Math.round(ch * 0.09)}px;border-radius:99px;background:${P.ink};opacity:.6"></span>
          <span style="position:absolute;left:${Math.round(cw * 0.18)}px;top:${Math.round(ch * 0.46)}px;width:${Math.round(cw * 0.5)}px;height:${Math.round(ch * 0.07)}px;border-radius:99px;background:${P.line}"></span>
          <span style="position:absolute;left:${Math.round(cw * 0.18)}px;top:${Math.round(ch * 0.6)}px;width:${Math.round(cw * 0.58)}px;height:${Math.round(ch * 0.07)}px;border-radius:99px;background:${P.line}"></span>`,
      }
      for (let k = 0; k < n; k++) {
        const ix = `${id}l${k}`
        const kind = lineupKind((s.items || [])[k] && (s.items || [])[k].text, k)
        h += `<span class="an-p an-lu" id="${ix}" style="left:${x0 + k * (cw + gap)}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${rr}px;background:${P.soft};border:2px solid ${P.line};opacity:0;overflow:visible">
          ${(mocks[kind] || mocks.carte)(ix)}
          <span class="an-p" id="${ix}ck" style="left:auto;right:-8px;top:-8px;width:${Math.round(cw * 0.24)}px;height:${Math.round(cw * 0.24)}px;border-radius:50%;background:${P.acc};opacity:0;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(0,0,0,.25)">
            <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>
        </span>`
      }
      return box(h)
    }
    case 'cart': {
      // E-COMMERCE — le panier : les lignes, les quantites, le total.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.19), gp = Math.round(f.h * 0.045)
      let rs = ''
      for (let k = 0; k < 3; k++) {
        const y = k * (rh + gp), th = Math.round(rh * 0.62)
        rs += `<span class="an-p an-ct" id="${id}ct${k}" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.26)}px;background:${P.soft};border:2px solid ${P.line}">
          <span style="position:absolute;left:${Math.round(rh * 0.22)}px;top:${Math.round((rh - th) / 2)}px;width:${th}px;height:${th}px;border-radius:${Math.round(th * 0.24)}px;background:${grad(140)}"></span>
          <span style="position:absolute;left:${Math.round(rh * 0.98)}px;top:${Math.round(rh * 0.24)}px;width:${[42, 34, 48][k]}%;height:${Math.max(4, Math.round(rh * 0.12))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
          <span style="position:absolute;left:${Math.round(rh * 0.98)}px;top:${Math.round(rh * 0.54)}px;width:${Math.round(rh * 0.7)}px;height:${Math.round(rh * 0.26)}px;border-radius:${Math.round(rh * 0.08)}px;background:${P.line};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(rh * 0.17)}px;color:${P.ink};opacity:.8">×${k + 1}</span>
          <span style="position:absolute;right:${Math.round(rh * 0.26)}px;top:50%;transform:translateY(-50%);font-family:${SANS};font-weight:800;font-size:${Math.round(rh * 0.24)}px;color:${P.ink};opacity:.7">${[39, 24, 15][k]}€</span></span>`
      }
      const ty = 3 * (rh + gp) + Math.round(f.h * 0.03)
      return box(`${rs}
        <span class="an-p" style="left:${x}px;top:${ty}px;width:${w}px;height:2px;background:${P.line}"></span>
        <span class="an-p" style="left:${x}px;top:${ty + Math.round(f.h * 0.05)}px;width:${Math.round(w * 0.2)}px;height:${Math.max(4, Math.round(f.h * 0.03))}px;border-radius:99px;background:${P.ink};opacity:.4"></span>
        <span class="an-p" id="${id}ctt" style="right:${Math.round((f.w - w) / 2)}px;left:auto;top:${ty + Math.round(f.h * 0.025)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.11)}px;color:${P.acc}">${txt(0, '102€')}</span>`)
    }
    case 'delivery': {
      // E-COMMERCE — le suivi : les etapes se cochent, le colis avance.
      const w = Math.round(f.w * 0.88), x = Math.round((f.w - w) / 2)
      const d = Math.round(f.h * 0.13), ly = Math.round(f.h * 0.4)
      let st = ''
      for (let k = 0; k < 4; k++) {
        const cx2 = x + Math.round(w * (0.06 + k * 0.293))
        st += `<span class="an-p an-dv" id="${id}dv${k}" style="left:${cx2 - Math.round(d / 2)}px;top:${ly - Math.round(d / 2)}px;width:${d}px;height:${d}px;border-radius:50%;background:${P.acc};border:3px solid ${P.acc};display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg></span>
        <span class="an-p" style="left:${cx2 - Math.round(w * 0.11)}px;top:${ly + d}px;width:${Math.round(w * 0.22)}px;height:${Math.max(3, Math.round(f.h * 0.024))}px;border-radius:99px;background:${P.ink};opacity:.32"></span>`
      }
      return box(`
        <span class="an-p" style="left:${x + Math.round(w * 0.06)}px;top:${ly - 2}px;width:${Math.round(w * 0.88)}px;height:4px;border-radius:99px;background:${P.line}"></span>
        <span class="an-p" id="${id}dvl" style="left:${x + Math.round(w * 0.06)}px;top:${ly - 2}px;width:${Math.round(w * 0.88)}px;height:4px;border-radius:99px;background:${P.acc};transform-origin:0% 50%"></span>
        ${st}
        <span class="an-p" id="${id}dvb" style="left:${x}px;top:${ly - Math.round(f.h * 0.3)}px;width:${Math.round(f.h * 0.2)}px;height:${Math.round(f.h * 0.17)}px;border-radius:${Math.round(f.h * 0.03)}px;background:${grad(140)};box-shadow:0 12px 26px rgba(0,0,0,.4)">
          <span style="position:absolute;left:0;top:44%;width:100%;height:${Math.max(3, Math.round(f.h * 0.014))}px;background:rgba(255,255,255,.55)"></span>
          <span style="position:absolute;left:44%;top:0;width:${Math.max(3, Math.round(f.h * 0.014))}px;height:100%;background:rgba(255,255,255,.55)"></span></span>`)
    }
    case 'sizes': {
      // E-COMMERCE — les declinaisons : la taille et la couleur qu'on choisit.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const d = Math.round(f.h * 0.17), gp = Math.round(f.w * 0.035)
      const labs = ['S', 'M', 'L', 'XL']
      let ss = ''
      for (let k = 0; k < 4; k++) ss += `<span class="an-p an-sz" id="${id}sz${k}" style="left:${x + k * (d + gp)}px;top:${Math.round(f.h * 0.1)}px;width:${d}px;height:${d}px;border-radius:${Math.round(d * 0.26)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(d * 0.38)}px;color:${P.ink};opacity:.75">${labs[k]}</span>`
      const cd = Math.round(f.h * 0.14)
      const cols = [P.acc, '#2F6BFF', '#22C55E', '#111111', '#E8E4DE']
      let cs = ''
      for (let k = 0; k < 5; k++) cs += `<span class="an-p an-cl2" id="${id}cl2${k}" style="left:${x + k * (cd + gp)}px;top:${Math.round(f.h * 0.46)}px;width:${cd}px;height:${cd}px;border-radius:50%;background:${cols[k]};border:2px solid ${P.line}"></span>`
      return box(`${ss}${cs}
        <!-- Le cadre de selection colle a la tuile AU PIXEL : sans box-sizing la
             bordure s'AJOUTE a la largeur, l'anneau depassait de 8 px et sortait
             decentre. Ici il est en border-box, decale de son epaisseur exacte :
             son bord interieur epouse le bord de la tuile. -->
        <span class="an-p" id="${id}szr" style="box-sizing:border-box;left:${x + 2 * (d + gp) - 4}px;top:${Math.round(f.h * 0.1) - 4}px;width:${d + 8}px;height:${d + 8}px;border-radius:${Math.round(d * 0.26) + 4}px;border:4px solid ${P.acc};opacity:0"></span>
        <span class="an-p" id="${id}clr" style="box-sizing:border-box;left:${x - 4}px;top:${Math.round(f.h * 0.46) - 4}px;width:${cd + 8}px;height:${cd + 8}px;border-radius:50%;border:4px solid ${P.acc};opacity:0"></span>
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.74)}px;width:${w}px;height:${Math.round(f.h * 0.16)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.07)}px;color:#FFFFFF">Je commande</span>`)
    }
    case 'candles': {
      // TRADING — les bougies japonaises qui se dessinent, la derniere explose.
      const n = 11, w = Math.round(f.w * 0.9), x0 = Math.round((f.w - w) / 2)
      const cw = Math.round(w / n), bw = Math.round(cw * 0.52)
      const vals = [0.42, 0.5, 0.38, 0.46, 0.56, 0.48, 0.6, 0.54, 0.66, 0.72, 0.88]
      let cs = ''
      for (let k = 0; k < n; k++) {
        const up = k === 0 || vals[k] >= vals[k - 1]
        const col = up ? '#22C55E' : '#EF4444'
        const bh2 = Math.round(f.h * (0.06 + Math.abs(vals[k] - (vals[k - 1] ?? 0.4)) * 0.9 + 0.04))
        const cy2 = Math.round(f.h * (1 - vals[k])) - Math.round(bh2 / 2)
        cs += `<span class="an-p an-cn" id="${id}cn${k}" style="left:${x0 + k * cw + Math.round((cw - 2) / 2)}px;top:${cy2 - Math.round(bh2 * 0.42)}px;width:2px;height:${Math.round(bh2 * 1.84)}px;background:${col};opacity:.8"></span>
        <span class="an-p an-cn" style="left:${x0 + k * cw + Math.round((cw - bw) / 2)}px;top:${cy2}px;width:${bw}px;height:${bh2}px;border-radius:2px;background:${col}"></span>`
      }
      return box(cs)
    }
    case 'portfolio': {
      // TRADING — le portefeuille : la valeur, la variation, les lignes d'actifs.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.15), gp = Math.round(f.h * 0.035)
      const names = [[62, '+8,4 %', '#22C55E'], [48, '+2,1 %', '#22C55E'], [34, '-1,3 %', '#EF4444']]
      let rs = ''
      names.forEach(([wd, pct, col], k) => {
        const y = Math.round(f.h * 0.42) + k * (rh + gp), av = Math.round(rh * 0.56)
        rs += `<span class="an-p an-pf" id="${id}pf${k}" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.26)}px;background:${P.soft};border:2px solid ${P.line}">
          <span style="position:absolute;left:${Math.round(rh * 0.24)}px;top:${Math.round((rh - av) / 2)}px;width:${av}px;height:${av}px;border-radius:50%;background:${P.line}"></span>
          <span style="position:absolute;left:${Math.round(rh * 1.0)}px;top:50%;transform:translateY(-50%);width:${wd}%;height:${Math.max(4, Math.round(rh * 0.15))}px;border-radius:99px;background:${P.ink};opacity:.4"></span>
          <span style="position:absolute;right:${Math.round(rh * 0.26)}px;top:50%;transform:translateY(-50%);font-family:${SANS};font-weight:800;font-size:${Math.round(rh * 0.28)}px;color:${col}">${pct}</span></span>`
      })
      return box(`
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.04)}px;width:${Math.round(w * 0.32)}px;height:${Math.max(4, Math.round(f.h * 0.028))}px;border-radius:99px;background:${P.ink};opacity:.4"></span>
        <span class="an-p" id="${id}pfv" style="left:${x}px;top:${Math.round(f.h * 0.11)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.17)}px;color:${P.ink};transform-origin:0% 50%">${txt(0, '24 380€')}</span>
        <span class="an-p" id="${id}pfp" style="left:${x}px;top:${Math.round(f.h * 0.3)}px;padding:${Math.round(f.h * 0.018)}px ${Math.round(f.h * 0.04)}px;border-radius:99px;background:#22C55E;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.055)}px;color:#FFFFFF">${txt(1, '+12,6 %')}</span>
        ${rs}`)
    }
    case 'order': {
      // TRADING — passer un ordre : achat/vente, le prix, la quantite, valide.
      const w = Math.round(f.w * 0.8), h = Math.round(f.h * 0.94)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const tw = Math.round((w - Math.round(w * 0.2)) / 2), th = Math.round(h * 0.14)
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.07)}px;background:${P.soft};border:2px solid ${P.line}">
        <span class="an-p" id="${id}ob" style="left:${Math.round(w * 0.06)}px;top:${Math.round(h * 0.07)}px;width:${tw}px;height:${th}px;border-radius:${Math.round(th * 0.3)}px;background:#22C55E;display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(th * 0.36)}px;color:#FFFFFF">Acheter</span>
        <span class="an-p" style="left:${Math.round(w * 0.06) + tw + Math.round(w * 0.08)}px;top:${Math.round(h * 0.07)}px;width:${tw}px;height:${th}px;border-radius:${Math.round(th * 0.3)}px;background:${P.line};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(th * 0.36)}px;color:${P.ink};opacity:.6">Vendre</span>
        ${[0.3, 0.5].map((t, k) => `<span class="an-p an-or" style="left:${Math.round(w * 0.06)}px;top:${Math.round(h * t)}px;width:${Math.round(w * 0.88)}px;height:${Math.round(h * 0.13)}px;border-radius:${Math.round(h * 0.04)}px;background:${P.line};opacity:.55">
          <span style="position:absolute;left:6%;top:50%;transform:translateY(-50%);width:26%;height:${Math.max(3, Math.round(h * 0.022))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
          <span style="position:absolute;right:6%;top:50%;transform:translateY(-50%);font-family:${SANS};font-weight:800;font-size:${Math.round(h * 0.05)}px;color:${P.ink};opacity:.8">${['1 240€', '0,25'][k]}</span></span>`).join('')}
        <span class="an-p" id="${id}ov" style="left:${Math.round(w * 0.06)}px;top:${Math.round(h * 0.72)}px;width:${Math.round(w * 0.88)}px;height:${Math.round(h * 0.15)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(h * 0.055)}px;color:#FFFFFF">Valider</span></div>`)
    }
    case 'pnl': {
      // TRADING — la courbe de performance qui se trace, avec son pourcentage.
      const w = Math.round(f.w * 0.92), h = Math.round(f.h * 0.62)
      const x = Math.round((f.w - w) / 2), y = Math.round(f.h * 0.26)
      const pts = [0.12, 0.3, 0.22, 0.44, 0.36, 0.58, 0.52, 0.78, 0.94]
      const d = pts.map((v, k) => `${k ? 'L' : 'M'}${x + Math.round(w * k / (pts.length - 1))} ${y + Math.round(h * (1 - v))}`).join(' ')
      const area = `${d} L${x + w} ${y + h} L${x} ${y + h} Z`
      let grid = ''
      for (let k = 1; k < 4; k++) grid += `<line x1="${x}" y1="${y + Math.round(h * k / 4)}" x2="${x + w}" y2="${y + Math.round(h * k / 4)}" stroke="${P.ink}" stroke-opacity=".12" stroke-width="1"/>`
      return box(`
        <svg class="an-p" style="left:0;top:0;width:${f.w}px;height:${f.h}px" fill="none">${grid}
          <path id="${id}pa" d="${area}" fill="#22C55E" opacity="0"/>
          <path id="${id}pl" d="${d}" stroke="#22C55E" stroke-width="${Math.max(4, Math.round(w * 0.014))}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>
        <span class="an-p" id="${id}pp" style="left:${x}px;top:${Math.round(f.h * 0.02)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.17)}px;color:#22C55E;transform-origin:0% 50%">${txt(0, '+248 %')}</span>`)
    }
    case 'mrr': {
      // SAAS — le revenu recurrent : le chiffre, et les mois qui montent.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const n = 7, gp = Math.round(w * 0.022)
      const bw = Math.round((w - gp * (n - 1)) / n)
      const vals = [0.26, 0.34, 0.3, 0.46, 0.58, 0.72, 0.94]
      const base = Math.round(f.h * 0.96), maxh = Math.round(f.h * 0.54)
      let bs = ''
      for (let k = 0; k < n; k++) {
        const bh2 = Math.round(maxh * vals[k])
        bs += `<span class="an-p an-mr" id="${id}mr${k}" style="left:${x + k * (bw + gp)}px;top:${base - bh2}px;width:${bw}px;height:${bh2}px;border-radius:${Math.round(bw * 0.22)}px ${Math.round(bw * 0.22)}px 0 0;background:${k === n - 1 ? P.acc : P.line};opacity:${k === n - 1 ? 1 : .55};transform-origin:50% 100%"></span>`
      }
      return box(`
        <span class="an-p" style="left:${x}px;top:0;width:${Math.round(w * 0.24)}px;height:${Math.max(4, Math.round(f.h * 0.026))}px;border-radius:99px;background:${P.ink};opacity:.4"></span>
        <span class="an-p" id="${id}mrv" style="left:${x}px;top:${Math.round(f.h * 0.06)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.17)}px;color:${P.acc};transform-origin:0% 50%">${txt(0, '12 400€')}</span>
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.25)}px;width:${Math.round(w * 0.34)}px;height:${Math.max(3, Math.round(f.h * 0.022))}px;border-radius:99px;background:${P.ink};opacity:.24"></span>
        ${bs}`)
    }
    case 'churn': {
      // SAAS — la retention : la barre pleine se vide, le pourcentage part en rouge.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const bh = Math.round(f.h * 0.2)
      const y0 = Math.round(f.h * 0.2)
      let rs = ''
      const keep = [1, 0.82, 0.64, 0.41]
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * (bh * 0.78)
        rs += `<span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${Math.round(bh * 0.56)}px;border-radius:${Math.round(bh * 0.16)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          <span class="an-p an-ch" id="${id}ch${k}" style="left:0;top:0;width:${Math.round(keep[k] * 100)}%;height:100%;background:${k === 3 ? '#EF4444' : P.acc};opacity:${1 - k * 0.14};transform-origin:0% 50%"></span></span>
        <span class="an-p" style="left:${x}px;top:${y + Math.round(bh * 0.6)}px;width:${Math.round(w * 0.16)}px;height:${Math.max(3, Math.round(bh * 0.08))}px;border-radius:99px;background:${P.ink};opacity:.26"></span>`
      }
      return box(`
        <span class="an-p" id="${id}chp" style="left:${x}px;top:0;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.15)}px;color:#EF4444;transform-origin:0% 50%">${txt(0, '-59 %')}</span>
        ${rs}`)
    }
    case 'onboarding': {
      // SAAS — l'activation : la liste des taches et le pourcentage qui monte.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.16), gp = Math.round(f.h * 0.04)
      const y0 = Math.round(f.h * 0.32)
      let rs = ''
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * (rh + gp), bx = Math.round(rh * 0.56), done = k < 3
        rs += `<span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:${P.soft}"></span>
        <span class="an-p an-ob2" id="${id}ob2${k}" style="left:${x + Math.round(rh * 0.26)}px;top:${y + Math.round((rh - bx) / 2)}px;width:${bx}px;height:${bx}px;border-radius:${Math.round(bx * 0.3)}px;background:${done ? P.acc : 'transparent'};border:2px solid ${done ? P.acc : P.line};display:flex;align-items:center;justify-content:center">
          ${done ? `<svg viewBox="0 0 24 24" width="64%" height="64%" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg>` : ''}</span>
        <span class="an-p" style="left:${x + Math.round(rh * 1.0)}px;top:${y + Math.round(rh * 0.42)}px;width:${[54, 44, 62, 38][k]}%;height:${Math.max(4, Math.round(rh * 0.15))}px;border-radius:99px;background:${P.ink};opacity:${done ? .45 : .22}"></span>`
      }
      return box(`
        <span class="an-p" id="${id}obp" style="left:${x}px;top:0;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.16)}px;color:${P.acc};transform-origin:0% 50%">${txt(0, '75 %')}</span>
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.2)}px;width:${w}px;height:${Math.max(6, Math.round(f.h * 0.026))}px;border-radius:99px;background:${P.line}"></span>
        <span class="an-p" id="${id}obb" style="left:${x}px;top:${Math.round(f.h * 0.2)}px;width:${Math.round(w * 0.75)}px;height:${Math.max(6, Math.round(f.h * 0.026))}px;border-radius:99px;background:${P.acc};transform-origin:0% 50%"></span>
        ${rs}`)
    }
    case 'integrations': {
      // SAAS — les integrations : les tuiles se branchent sur le coeur.
      const cd = Math.round(f.h * 0.26), cx2 = Math.round(f.w / 2), cy2 = Math.round(f.h / 2)
      const td = Math.round(f.h * 0.17), R = Math.round(Math.min(f.w * 0.34, f.h * 0.36))
      let ts = '', ls = ''
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI * 2 * k) / 6 - Math.PI / 2
        const tx = cx2 + Math.round(Math.cos(a) * R), ty = cy2 + Math.round(Math.sin(a) * R)
        ls += `<line class="an-il" id="${id}il${k}" x1="${cx2}" y1="${cy2}" x2="${tx}" y2="${ty}" stroke="${P.line}" stroke-width="2" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`
        ts += `<span class="an-p an-it2" id="${id}it2${k}" style="left:${tx - Math.round(td / 2)}px;top:${ty - Math.round(td / 2)}px;width:${td}px;height:${td}px;border-radius:${Math.round(td * 0.26)}px;background:${P.soft};border:2px solid ${P.line}">
          <span style="position:absolute;left:26%;top:26%;width:48%;height:48%;border-radius:${Math.round(td * 0.12)}px;background:${P.ink};opacity:.32"></span></span>`
      }
      return box(`<svg class="an-p" style="left:0;top:0;width:${f.w}px;height:${f.h}px" fill="none">${ls}</svg>${ts}
        <span class="an-p" id="${id}ic" style="left:${cx2 - Math.round(cd / 2)}px;top:${cy2 - Math.round(cd / 2)}px;width:${cd}px;height:${cd}px;border-radius:${Math.round(cd * 0.28)}px;background:${grad(140)};box-shadow:0 16px 34px rgba(0,0,0,.4)"></span>`)
    }
    case 'property': {
      // IMMOBILIER — l'annonce : la photo, le prix, les caracteristiques.
      const w = Math.round(f.w * 0.84), h = Math.round(f.h * 0.94)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const iv = Math.round(h * 0.44)
      const specs = ['3 p.', '72 m²', '2 ch.']
      let sp = ''
      specs.forEach((t, k) => {
        sp += `<span class="an-p an-pr" style="left:${Math.round(w * 0.07) + k * Math.round(w * 0.3)}px;top:${iv + Math.round(h * 0.28)}px;width:${Math.round(w * 0.26)}px;height:${Math.round(h * 0.1)}px;border-radius:${Math.round(h * 0.03)}px;background:${P.line};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:700;font-size:${Math.round(h * 0.04)}px;color:${P.ink};opacity:.85">${t}</span>`
      })
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.06)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        <span class="an-p an-pr" style="left:0;top:0;width:100%;height:${iv}px;background:${grad(150)}">
          <span style="position:absolute;left:16%;bottom:14%;width:68%;height:44%;background:rgba(255,255,255,.24);clip-path:polygon(50% 0,100% 36%,100% 100%,0 100%,0 36%)"></span></span>
        <span class="an-p an-pr" style="left:${Math.round(w * 0.07)}px;top:${iv + Math.round(h * 0.05)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.09)}px;color:${P.acc}">${txt(0, '289 000€')}</span>
        <span class="an-p an-pr" style="left:${Math.round(w * 0.07)}px;top:${iv + Math.round(h * 0.18)}px;width:${Math.round(w * 0.6)}px;height:${Math.max(3, Math.round(h * 0.024))}px;border-radius:99px;background:${P.ink};opacity:.34"></span>
        ${sp}
        <span class="an-p" id="${id}prb" style="left:${Math.round(w * 0.07)}px;top:${h - Math.round(h * 0.15)}px;width:${Math.round(w * 0.86)}px;height:${Math.round(h * 0.1)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(h * 0.045)}px;color:#FFFFFF">Visiter</span></div>`)
    }
    case 'menu': {
      // RESTAURATION — la carte : les plats, leurs prix, celui qu'on choisit.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.2), gp = Math.round(f.h * 0.04)
      const y0 = Math.round((f.h - (4 * rh + 3 * gp)) / 2)
      const prices = ['14€', '18€', '12€', '9€']
      let rs = ''
      for (let k = 0; k < 4; k++) {
        const y = y0 + k * (rh + gp), hot = k === 1, th = Math.round(rh * 0.66)
        rs += `<span class="an-p an-mn" id="${id}mn${k}" style="left:${x}px;top:${y}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.24)}px;background:${hot ? P.acc : P.soft};border:2px solid ${hot ? P.acc : P.line}">
          <span style="position:absolute;left:${Math.round(rh * 0.2)}px;top:${Math.round((rh - th) / 2)}px;width:${th}px;height:${th}px;border-radius:${Math.round(th * 0.26)}px;background:${hot ? 'rgba(255,255,255,.9)' : P.line}"></span>
          <span style="position:absolute;left:${Math.round(rh * 1.0)}px;top:${Math.round(rh * 0.26)}px;width:${[46, 38, 52, 42][k]}%;height:${Math.max(4, Math.round(rh * 0.12))}px;border-radius:99px;background:${hot ? '#FFFFFF' : P.ink};opacity:${hot ? .9 : .5}"></span>
          <span style="position:absolute;left:${Math.round(rh * 1.0)}px;top:${Math.round(rh * 0.54)}px;width:${[62, 54, 40, 58][k]}%;height:${Math.max(3, Math.round(rh * 0.1))}px;border-radius:99px;background:${hot ? '#FFFFFF' : P.ink};opacity:${hot ? .55 : .26}"></span>
          <span style="position:absolute;right:${Math.round(rh * 0.26)}px;top:50%;transform:translateY(-50%);font-family:'Archivo Black',sans-serif;font-size:${Math.round(rh * 0.28)}px;color:${hot ? '#FFFFFF' : P.acc}">${prices[k]}</span></span>`
      }
      return box(rs)
    }
    // ── PAQUET 8 (#157) — la suite des domaines : sport, agence, formation,
    // voyage, auto, finances perso, recrutement, evenementiel, equipe.
    case 'weight': {
      // SPORT — la courbe qui DESCEND, avec le chiffre atteint.
      const w = Math.round(f.w * 0.92), h = Math.round(f.h * 0.56)
      const x = Math.round((f.w - w) / 2), y = Math.round(f.h * 0.34)
      const pts = [0.92, 0.84, 0.86, 0.72, 0.66, 0.7, 0.52, 0.4, 0.28]
      const d = pts.map((v, k) => `${k ? 'L' : 'M'}${x + Math.round(w * k / (pts.length - 1))} ${y + Math.round(h * (1 - v))}`).join(' ')
      let grid = ''
      for (let k = 1; k < 4; k++) grid += `<line x1="${x}" y1="${y + Math.round(h * k / 4)}" x2="${x + w}" y2="${y + Math.round(h * k / 4)}" stroke="${P.ink}" stroke-opacity=".12" stroke-width="1"/>`
      return box(`
        <svg class="an-p" style="left:0;top:0;width:${f.w}px;height:${f.h}px" fill="none">${grid}
          <path id="${id}wl2" d="${d}" stroke="${P.acc}" stroke-width="${Math.max(4, Math.round(w * 0.014))}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>
        <span class="an-p" id="${id}wv" style="left:${x}px;top:${Math.round(f.h * 0.02)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.2)}px;color:${P.acc};transform-origin:0% 50%">${txt(0, '-12 kg')}</span>
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.25)}px;width:${Math.round(w * 0.3)}px;height:${Math.max(3, Math.round(f.h * 0.024))}px;border-radius:99px;background:${P.ink};opacity:.3"></span>`)
    }
    case 'quote': {
      // AGENCE / ARTISAN — le devis : les lignes, le total, la signature.
      const w = Math.round(f.w * 0.78), h = Math.round(f.h * 0.96)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      let ls = ''
      for (let k = 0; k < 4; k++) {
        const ly = Math.round(h * (0.2 + k * 0.11))
        ls += `<span class="an-p an-qt" style="left:${Math.round(w * 0.09)}px;top:${ly}px;width:${[54, 42, 60, 38][k]}%;height:${Math.max(3, Math.round(h * 0.024))}px;border-radius:99px;background:${P.ink};opacity:.4"></span>
        <span class="an-p an-qt" style="left:${Math.round(w * 0.7)}px;top:${ly}px;width:${Math.round(w * 0.21)}px;height:${Math.max(3, Math.round(h * 0.024))}px;border-radius:99px;background:${P.ink};opacity:.26"></span>`
      }
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.06)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        <span style="position:absolute;left:${Math.round(w * 0.09)}px;top:${Math.round(h * 0.07)}px;width:${Math.round(w * 0.36)}px;height:${Math.max(5, Math.round(h * 0.034))}px;border-radius:99px;background:${P.acc}"></span>
        ${ls}
        <span style="position:absolute;left:${Math.round(w * 0.09)}px;top:${Math.round(h * 0.66)}px;width:${Math.round(w * 0.82)}px;height:2px;background:${P.line}"></span>
        <span class="an-p" id="${id}qtt" style="right:${Math.round(w * 0.09)}px;left:auto;top:${Math.round(h * 0.71)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(h * 0.1)}px;color:${P.acc}">${txt(0, '2 400€')}</span>
        <svg class="an-p" id="${id}qs" viewBox="0 0 100 30" style="left:${Math.round(w * 0.09)}px;top:${Math.round(h * 0.85)}px;width:${Math.round(w * 0.44)}px;height:${Math.round(h * 0.1)}px" fill="none">
          <path d="M2 22C10 6 16 26 24 14s10 12 18 2 12 14 20 4 14 6 22-6" stroke="${P.ink}" stroke-width="3" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg></div>`)
    }
    case 'cv': {
      // RECRUTEMENT — les candidatures, celle qu'on retient ressort.
      const cw = Math.round(f.w * 0.26), chh = Math.round(cw * 1.36), gp = Math.round(f.w * 0.05)
      const x0 = Math.round((f.w - (3 * cw + 2 * gp)) / 2), y0 = Math.round((f.h - chh) / 2)
      let cs = ''
      for (let k = 0; k < 3; k++) {
        const hot = k === 1
        cs += `<span class="an-p an-cv" id="${id}cv${k}" style="left:${x0 + k * (cw + gp)}px;top:${y0}px;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.12)}px;background:${P.soft};border:2px solid ${hot ? P.acc : P.line};overflow:hidden">
          <span style="position:absolute;left:50%;margin-left:${-Math.round(cw * 0.16)}px;top:${Math.round(chh * 0.08)}px;width:${Math.round(cw * 0.32)}px;height:${Math.round(cw * 0.32)}px;border-radius:50%;background:${hot ? P.acc : P.line}"></span>
          ${[0.42, 0.53, 0.64, 0.75].map((t, j) => `<span style="position:absolute;left:12%;top:${t * 100}%;width:${[74, 58, 66, 44][j]}%;height:${Math.max(2, Math.round(chh * 0.025))}px;border-radius:99px;background:${P.ink};opacity:.3"></span>`).join('')}</span>`
      }
      return box(`${cs}
        <span class="an-p" id="${id}cvk" style="left:${x0 + (cw + gp) + Math.round(cw * 0.62)}px;top:${y0 - Math.round(chh * 0.1)}px;width:${Math.round(cw * 0.4)}px;height:${Math.round(cw * 0.4)}px;border-radius:50%;background:#22C55E;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,.35)">
          <svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg></span>`)
    }
    // ── PAQUET 9 (#157) — CHANGEMENT DE LANGAGE. Axel a retire dix animations du
    // paquet 8 : « l'idee est la mais pas le design ». En les regardant cote a
    // cote, le diagnostic saute aux yeux — `program`, `course`, `quiz`, `brief`
    // sont DES RANGEES ; `macros` et `budget` DES BARRES. La banque en a deja
    // dix comme ca. Je tournais dans deux mises en page.
    // Ici : des METAPHORES PHYSIQUES. Rien ne s'empile en liste, tout se
    // deplace, penche, tombe, tourne, s'emboite ou pousse. Et comme ce sont des
    // images mentales et non des interfaces, elles servent TOUS les domaines.
    case 'liquid': {
      // « ca se remplit », « jusqu'a ras bord » : le verre se remplit, le liquide ondule.
      const w = Math.round(f.w * 0.36), h = Math.round(f.h * 0.86)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      let bub = ''
      for (let k = 0; k < 5; k++) {
        const bd = Math.round(w * (0.06 + (k % 3) * 0.03))
        bub += `<span class="an-p an-lb2" id="${id}lb2${k}" style="left:${Math.round(w * (0.18 + k * 0.15))}px;bottom:${Math.round(h * 0.06)}px;top:auto;width:${bd}px;height:${bd}px;border-radius:50%;background:rgba(255,255,255,.5)"></span>`
      }
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.14)}px ${Math.round(w * 0.14)}px ${Math.round(w * 0.3)}px ${Math.round(w * 0.3)}px;border:4px solid ${P.line};overflow:hidden">
        <span class="an-p an-lq" id="${id}lq" style="left:0;bottom:0;top:auto;width:100%;height:100%;background:${grad(180)};transform-origin:50% 100%">
          <span style="position:absolute;left:-25%;top:-${Math.round(w * 0.13)}px;width:150%;height:${Math.round(w * 0.26)}px;border-radius:50%;background:${P.acc}"></span>
          ${bub}</span></div>`)
    }
    case 'magnet': {
      // « ca attire », « ils viennent a toi » : les points sont aspires vers le centre.
      const md = Math.round(Math.min(f.w * 0.3, f.h * 0.42))
      const cx2 = Math.round(f.w / 2), cy2 = Math.round(f.h / 2)
      let ps = ''
      for (let k = 0; k < 10; k++) {
        const a = (Math.PI * 2 * k) / 10 + 0.3
        const R = Math.round(Math.min(f.w * 0.42, f.h * 0.46))
        const pd = Math.round(f.h * (0.04 + (k % 3) * 0.014))
        ps += `<span class="an-p an-mg" id="${id}mg${k}" style="left:${cx2 + Math.round(Math.cos(a) * R) - Math.round(pd / 2)}px;top:${cy2 + Math.round(Math.sin(a) * R) - Math.round(pd / 2)}px;width:${pd}px;height:${pd}px;border-radius:50%;background:${P.ink};opacity:.55" data-a="${a.toFixed(3)}"></span>`
      }
      return box(`${ps}
        <span class="an-p" id="${id}mgc" style="left:${cx2 - Math.round(md / 2)}px;top:${cy2 - Math.round(md / 2)}px;width:${md}px;height:${md}px;border-radius:${Math.round(md * 0.5)}px ${Math.round(md * 0.5)}px ${Math.round(md * 0.16)}px ${Math.round(md * 0.16)}px;border:${Math.round(md * 0.24)}px solid ${P.acc};border-bottom:none;box-sizing:border-box"></span>`)
    }
    case 'explode': {
      // « on decortique », « piece par piece » : la vue eclatee.
      const cd = Math.round(Math.min(f.w * 0.3, f.h * 0.28))
      const cx2 = Math.round(f.w / 2), cy2 = Math.round(f.h / 2)
      let ps = ''
      const off = [[0, -1], [0.87, -0.5], [0.87, 0.5], [0, 1], [-0.87, 0.5], [-0.87, -0.5]]
      off.forEach(([dx, dy], k) => {
        const pd = Math.round(cd * 0.5)
        ps += `<span class="an-p an-ex" id="${id}ex${k}" style="left:${cx2 - Math.round(pd / 2)}px;top:${cy2 - Math.round(pd / 2)}px;width:${pd}px;height:${pd}px;border-radius:${Math.round(pd * 0.22)}px;background:${k % 2 ? P.acc : P.line}" data-dx="${dx}" data-dy="${dy}"></span>`
      })
      return box(`
        <span class="an-p" id="${id}exc" style="left:${cx2 - Math.round(cd / 2)}px;top:${cy2 - Math.round(cd / 2)}px;width:${cd}px;height:${cd}px;border-radius:${Math.round(cd * 0.24)}px;background:${grad(140)};box-shadow:0 14px 32px rgba(0,0,0,.4)"></span>
        ${ps}`)
    }
    // ── PAQUET 10 (#157) — METAPHORE **ET** MATIERE.
    // Axel a retire douze des quinze du paquet 9. En les regardant : `balance`
    // c'etait deux trapezes et un trait, `puzzle` deux rectangles, `merge` deux
    // ronds, `mirror` deux carres. J'avais bien change de langage — mais en
    // jetant les rangees j'avais jete la MATIERE avec. Or c'est exactement ce
    // qu'il gardait depuis le debut : le tableau de bord a des tuiles ET une
    // courbe, la facture a des lignes ET un total, les bougies ont des meches.
    // Ici : des metaphores, mais peuplees — des graduations, des chiffres, des
    // textures, de la profondeur. Et `snowball` refaite (« bonne idee mais fais
    // la mieux ») : une vraie pente, une boule texturee qui tourne, grossit et
    // ramasse ce qu'elle croise, avec sa trainee.
    case 'iceberg': {
      // « ce que tu vois n'est qu'une partie » : la pointe emergee, la masse dessous.
      const wl = Math.round(f.h * 0.34)
      const tw = Math.round(f.w * 0.36), th = Math.round(f.h * 0.3)
      const bw = Math.round(f.w * 0.72), bh = Math.round(f.h * 0.56)
      const cx2 = Math.round(f.w / 2)
      let strat = ''
      for (let k = 1; k < 4; k++) strat += `<span style="position:absolute;left:8%;top:${k * 24}%;width:84%;height:${Math.max(2, Math.round(bh * 0.012))}px;background:#FFFFFF;opacity:.14"></span>`
      return box(`
        <span class="an-p" id="${id}ibb" style="left:${cx2 - Math.round(bw / 2)}px;top:${wl}px;width:${bw}px;height:${bh}px;clip-path:polygon(18% 0,82% 0,100% 34%,72% 100%,28% 100%,0 40%);background:${P.acc};opacity:.42;overflow:hidden">${strat}</span>
        <span class="an-p" id="${id}ibt" style="left:${cx2 - Math.round(tw / 2)}px;top:${wl - th}px;width:${tw}px;height:${th}px;clip-path:polygon(52% 0,100% 100%,0 100%);background:${grad(150)}"></span>
        <span class="an-p" id="${id}ibw" style="left:0;top:${wl}px;width:${f.w}px;height:${Math.max(4, Math.round(f.h * 0.016))}px;border-radius:99px;background:${P.ink};opacity:.5"></span>
        ${[0.1, 0.34, 0.62, 0.86].map((t, k) => `<span class="an-p an-iw" style="left:${Math.round(f.w * t)}px;top:${wl + Math.round(f.h * (0.03 + (k % 2) * 0.03))}px;width:${Math.round(f.w * 0.1)}px;height:${Math.max(3, Math.round(f.h * 0.01))}px;border-radius:99px;background:${P.ink};opacity:.22"></span>`).join('')}`)
    }
    case 'tunnel': {
      // « tu traverses », « la lumiere au bout » : les anneaux defilent en profondeur.
      const cx2 = Math.round(f.w / 2), cy2 = Math.round(f.h / 2)
      let rings = ''
      for (let k = 0; k < 7; k++) {
        const R = Math.round(Math.min(f.w * 0.46, f.h * 0.48) * Math.pow(0.72, k))
        rings += `<span class="an-p an-tn" id="${id}tn${k}" style="box-sizing:border-box;left:${cx2 - R}px;top:${cy2 - R}px;width:${2 * R}px;height:${2 * R}px;border-radius:${Math.round(R * 0.2)}px;border:${Math.max(3, Math.round(R * 0.07))}px solid ${P.line};opacity:${(0.25 + k * 0.11).toFixed(2)}"></span>`
      }
      const gd = Math.round(f.h * 0.12)
      return box(`${rings}
        <span class="an-p" id="${id}tng" style="left:${cx2 - Math.round(gd / 2)}px;top:${cy2 - Math.round(gd / 2)}px;width:${gd}px;height:${gd}px;border-radius:50%;background:${P.acc};box-shadow:0 0 ${Math.round(gd * 1.4)}px ${P.acc},0 0 ${Math.round(gd * 3)}px ${P.acc}"></span>`)
    }
    case 'thermometer': {
      // « ca chauffe », « la pression monte » : le mercure grimpe le long des graduations.
      const tw = Math.round(f.w * 0.16), th = Math.round(f.h * 0.76)
      const x = Math.round((f.w - tw) / 2) - Math.round(f.w * 0.06), y = Math.round(f.h * 0.05)
      const bd = Math.round(tw * 1.5)
      let gr = ''
      for (let k = 0; k <= 8; k++) {
        const big = k % 2 === 0
        gr += `<span class="an-p" style="left:${x + tw + Math.round(f.w * 0.02)}px;top:${y + Math.round(th * k / 8)}px;width:${Math.round(f.w * (big ? 0.1 : 0.06))}px;height:${Math.max(2, Math.round(f.h * 0.008))}px;border-radius:99px;background:${P.ink};opacity:${big ? .45 : .25}"></span>`
      }
      return box(`${gr}
        <span class="an-p" style="box-sizing:border-box;left:${x}px;top:${y}px;width:${tw}px;height:${th + Math.round(bd * 0.4)}px;border-radius:99px;border:${Math.max(3, Math.round(tw * 0.12))}px solid ${P.line};background:${P.soft}"></span>
        <span class="an-p" style="left:${x - Math.round((bd - tw) / 2)}px;top:${y + th}px;width:${bd}px;height:${bd}px;border-radius:50%;background:${P.acc};box-shadow:0 0 ${Math.round(bd * 0.5)}px ${P.acc}66"></span>
        <span class="an-p" id="${id}thm" style="left:${x + Math.round(tw * 0.24)}px;top:${y + Math.round(tw * 0.24)}px;width:${Math.round(tw * 0.52)}px;height:${th}px;border-radius:99px;background:${P.acc};transform-origin:50% 100%"></span>`)
    }
    // ── PAQUET 11 (#157) — RETOUR A LA CREATION DE CONTENU.
    // Bilan honnete : sur trois paquets de metaphores, Axel en a garde cinq sur
    // quarante-cinq. « Reviens dans la creation de contenu » — il a raison, et
    // les chiffres le disent : ce qu'il garde, ce sont TOUJOURS les scenes de son
    // monde a lui (le tableau de bord, la timeline, le chat, la facture, les
    // bougies). Les images mentales, elles, ne prennent pas. On arrete la piste.
    // Ici : le metier de la video, en detail — la pellicule, le prompteur, le
    // clap, le setup lumiere, la transition, le zoom, le ralenti.
    case 'script': {
      // « le script », « ce que tu vas dire » : les lignes s'ecrivent, une se surligne.
      const w = Math.round(f.w * 0.82), h = Math.round(f.h * 0.96)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      let ls = ''
      const lens = [78, 64, 88, 52, 80, 70, 44]
      for (let k = 0; k < 7; k++) {
        const ly = Math.round(h * (0.16 + k * 0.1))
        ls += `<span class="an-p an-sc3" id="${id}sc3${k}" style="left:${Math.round(w * 0.12)}px;top:${ly}px;width:${lens[k]}%;height:${Math.max(4, Math.round(h * 0.026))}px;border-radius:99px;background:${P.ink};opacity:.42;transform-origin:0% 50%"></span>`
      }
      return box(`<div class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.05)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
        <span style="position:absolute;left:${Math.round(w * 0.06)}px;top:0;width:2px;height:100%;background:${P.acc};opacity:.4"></span>
        <span style="position:absolute;left:${Math.round(w * 0.12)}px;top:${Math.round(h * 0.06)}px;width:42%;height:${Math.max(5, Math.round(h * 0.034))}px;border-radius:99px;background:${P.acc}"></span>
        ${ls}
        <span class="an-p" id="${id}sch" style="left:${Math.round(w * 0.1)}px;top:${Math.round(h * 0.355)}px;width:${Math.round(w * 0.82)}px;height:${Math.round(h * 0.05)}px;border-radius:${Math.round(h * 0.014)}px;background:${P.acc};opacity:0;transform-origin:0% 50%"></span>
        <span style="position:absolute;right:${Math.round(w * 0.06)}px;top:${Math.round(h * 0.8)}px;width:${Math.round(w * 0.24)}px;height:${Math.round(h * 0.09)}px;border-radius:${Math.round(h * 0.025)}px;background:${P.line};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(h * 0.035)}px;color:${P.ink};opacity:.7">${txt(0, '0:42')}</span></div>`)
    }
    case 'clapper': {
      // « moteur », « on tourne », « prise deux » : le clap claque.
      const w = Math.round(f.w * 0.82), h = Math.round(w * 0.72)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const ah = Math.round(h * 0.26)
      let stripes = ''
      for (let k = 0; k < 7; k++) stripes += `<span style="position:absolute;left:${k * 14.3}%;top:0;width:14.3%;height:100%;background:${k % 2 ? P.acc : '#FFFFFF'};opacity:${k % 2 ? 1 : .92};transform:skewX(-14deg)"></span>`
      let rows = ''
      for (let k = 0; k < 3; k++) {
        rows += `<span style="position:absolute;left:8%;top:${26 + k * 24}%;width:26%;height:${Math.max(3, Math.round(h * 0.03))}px;border-radius:99px;background:#FFFFFF;opacity:.32"></span>
        <span style="position:absolute;left:40%;top:${26 + k * 24}%;width:${[46, 30, 38][k]}%;height:${Math.max(3, Math.round(h * 0.03))}px;border-radius:99px;background:#FFFFFF;opacity:.6"></span>`
      }
      return box(`
        <span class="an-p" style="left:${x}px;top:${y + ah}px;width:${w}px;height:${h - ah}px;border-radius:${Math.round(w * 0.04)}px;background:${P.ink};opacity:.92;overflow:hidden">${rows}</span>
        <span class="an-p" id="${id}clp" style="left:${x}px;top:${y}px;width:${w}px;height:${ah}px;border-radius:${Math.round(w * 0.03)}px;overflow:hidden;transform-origin:2% 100%">${stripes}</span>`)
    }
    case 'retakes': {
      // « on la refait », « la bonne prise » : trois prises, celle qui reste.
      const cw = Math.round(f.w * 0.27), chh = Math.round(cw * 1.34), gp = Math.round(f.w * 0.04)
      const x0 = Math.round((f.w - (3 * cw + 2 * gp)) / 2), y0 = Math.round((f.h - chh) / 2)
      let cs = ''
      for (let k = 0; k < 3; k++) {
        const good = k === 1
        cs += `<span class="an-p an-rt" id="${id}rt${k}" style="left:${x0 + k * (cw + gp)}px;top:${y0}px;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.12)}px;background:${P.line};overflow:hidden;box-shadow:0 8px 18px rgba(0,0,0,.3)">
          <span style="position:absolute;left:50%;margin-left:${-Math.round(cw * 0.17)}px;top:16%;width:${Math.round(cw * 0.34)}px;height:${Math.round(cw * 0.34)}px;border-radius:50%;background:#FFFFFF;opacity:.4"></span>
          <span style="position:absolute;left:50%;margin-left:${-Math.round(cw * 0.28)}px;top:52%;width:${Math.round(cw * 0.56)}px;height:${Math.round(chh * 0.26)}px;border-radius:${Math.round(cw * 0.28)}px ${Math.round(cw * 0.28)}px 0 0;background:#FFFFFF;opacity:.28"></span>
          <span style="position:absolute;left:8%;top:6%;padding:${Math.round(chh * 0.02)}px ${Math.round(cw * 0.09)}px;border-radius:99px;background:rgba(0,0,0,.5);font-family:${SANS};font-weight:800;font-size:${Math.round(chh * 0.075)}px;color:#FFFFFF">${k + 1}</span></span>
        ${good ? '' : `<svg class="an-p an-rx" id="${id}rx${k}" viewBox="0 0 24 24" style="left:${x0 + k * (cw + gp) + Math.round(cw * 0.32)}px;top:${y0 + Math.round(chh * 0.38)}px;width:${Math.round(cw * 0.36)}px;height:${Math.round(cw * 0.36)}px" fill="none" stroke="#EF4444" stroke-width="3.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`}`
      }
      return box(`${cs}
        <span class="an-p" id="${id}rtr" style="box-sizing:border-box;left:${x0 + (cw + gp) - 4}px;top:${y0 - 4}px;width:${cw + 8}px;height:${chh + 8}px;border-radius:${Math.round(cw * 0.16)}px;border:4px solid ${P.acc};opacity:0"></span>`)
    }
    case 'transition': {
      // « et la ca bascule », « la transition » : le second plan balaie le premier.
      const pw = Math.round(f.h * 0.54), ph = f.h, px = Math.round((f.w - pw) / 2)
      const inner = (col, dotOp) => `<span style="position:absolute;inset:0;background:${col}"></span>
        <span style="position:absolute;left:50%;margin-left:${-Math.round(pw * 0.17)}px;top:22%;width:${Math.round(pw * 0.34)}px;height:${Math.round(pw * 0.34)}px;border-radius:50%;background:#FFFFFF;opacity:${dotOp}"></span>
        <span style="position:absolute;left:12%;bottom:14%;width:76%;height:${Math.max(4, Math.round(ph * 0.02))}px;border-radius:99px;background:#FFFFFF;opacity:${dotOp * 0.7}"></span>`
      return box(`<div class="an-ph" style="left:${px}px;top:0;width:${pw}px;height:${ph}px;border-radius:${Math.round(pw * 0.12)}px;overflow:hidden;border:3px solid ${P.line}">
        <span class="an-p" style="left:0;top:0;width:100%;height:100%">${inner(P.line, .4)}</span>
        <span class="an-p" id="${id}tr2" style="left:0;top:0;width:100%;height:100%;transform-origin:0% 50%">${inner(P.acc, .85)}</span>
        <span class="an-p" id="${id}trl" style="left:0;top:0;width:${Math.max(5, Math.round(pw * 0.02))}px;height:100%;background:#FFFFFF;box-shadow:0 0 ${Math.round(pw * 0.1)}px #FFFFFF"></span>
      </div>`)
    }
    case 'zoompunch': {
      // « regarde bien ce detail » : le cadre se resserre et le detail grossit.
      const w = Math.round(f.w * 0.86), h = Math.round(f.h * 0.86)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - h) / 2)
      const dd = Math.round(w * 0.2)
      return box(`
        <span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.05)}px;overflow:hidden;background:${P.soft};border:2px solid ${P.line}">
          <span class="an-p" id="${id}zpi" style="left:0;top:0;width:100%;height:100%;background:${grad(140)};transform-origin:68% 38%">
            <span style="position:absolute;left:60%;top:30%;width:${dd}px;height:${dd}px;border-radius:${Math.round(dd * 0.22)}px;background:#FFFFFF;opacity:.85"></span>
            <span style="position:absolute;left:14%;top:64%;width:44%;height:${Math.max(4, Math.round(h * 0.022))}px;border-radius:99px;background:#FFFFFF;opacity:.4"></span>
            <span style="position:absolute;left:14%;top:74%;width:30%;height:${Math.max(4, Math.round(h * 0.022))}px;border-radius:99px;background:#FFFFFF;opacity:.28"></span></span></span>
        <span class="an-p" id="${id}zpb" style="box-sizing:border-box;left:${x + Math.round(w * 0.56)}px;top:${y + Math.round(h * 0.24)}px;width:${Math.round(w * 0.3)}px;height:${Math.round(w * 0.3)}px;border-radius:${Math.round(w * 0.03)}px;border:4px solid ${P.acc};opacity:0"></span>`)
    }
    case 'speedramp': {
      // « la tu ralentis, la tu accelERes » : la timeline avec ses zones de vitesse.
      const w = Math.round(f.w * 0.92), x = Math.round((f.w - w) / 2)
      const th = Math.round(f.h * 0.22), y = Math.round(f.h * 0.36)
      let bars = ''
      for (let k = 0; k < 26; k++) {
        const slow = k >= 7 && k < 13, fast = k >= 17 && k < 23
        const sp = slow ? 1.6 : fast ? 0.5 : 1
        bars += `<span style="position:absolute;left:${Math.round(w * 0.02) + k * Math.round(w * 0.037)}px;top:${Math.round(th * 0.2)}px;width:${Math.max(2, Math.round(w * 0.012 * sp))}px;height:${Math.round(th * 0.6)}px;border-radius:99px;background:${slow ? '#2F6BFF' : fast ? P.acc : P.ink};opacity:${slow || fast ? .9 : .35}"></span>`
      }
      const tag = (lx, lw, col, txt) => `<span class="an-p an-sr2" style="left:${x + Math.round(w * lx)}px;top:${y - Math.round(f.h * 0.11)}px;width:${Math.round(w * lw)}px;height:${Math.round(f.h * 0.09)}px;border-radius:${Math.round(f.h * 0.025)}px;background:${col};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.042)}px;color:#FFFFFF">${txt}</span>`
      return box(`
        ${tag(0.26, 0.22, '#2F6BFF', '0,5×')}
        ${tag(0.63, 0.22, P.acc, '2×')}
        <span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${th}px;border-radius:${Math.round(th * 0.2)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">${bars}</span>
        <span class="an-p" id="${id}srp" style="left:${x}px;top:${y - Math.round(f.h * 0.02)}px;width:${Math.max(4, Math.round(w * 0.008))}px;height:${th + Math.round(f.h * 0.04)}px;border-radius:99px;background:${P.ink}"></span>`)
    }
    case 'substyle': {
      // « tu choisis le style de sous-titres » : trois apercus, un se selectionne.
      const cw = Math.round(f.w * 0.28), chh = Math.round(cw * 1.4), gp = Math.round(f.w * 0.035)
      const x0 = Math.round((f.w - (3 * cw + 2 * gp)) / 2), y0 = Math.round((f.h - chh) / 2)
      const words = [['MOT', 'PAR'], ['GROS', 'TITRE'], ['fin', 'net']]
      let cs = ''
      for (let k = 0; k < 3; k++) {
        const sel = k === 1
        cs += `<span class="an-p an-ss3" id="${id}ss3${k}" style="left:${x0 + k * (cw + gp)}px;top:${y0}px;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.12)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          <span style="position:absolute;left:0;top:0;width:100%;height:52%;background:${P.line};opacity:.5"></span>
          <span style="position:absolute;left:8%;top:58%;width:84%;text-align:center;font-family:${k === 2 ? SANS : "'Archivo Black',sans-serif"};font-weight:${k === 2 ? 600 : 400};font-size:${Math.round(cw * (k === 1 ? 0.19 : 0.15))}px;line-height:1.15;color:${k === 1 ? P.acc : P.ink};${k === 0 ? `background:${P.acc};color:#FFFFFF;border-radius:${Math.round(cw * 0.04)}px;` : ''}">${words[k][0]}<br>${words[k][1]}</span></span>`
      }
      return box(`${cs}
        <span class="an-p" id="${id}ssr" style="box-sizing:border-box;left:${x0 + (cw + gp) - 4}px;top:${y0 - 4}px;width:${cw + 8}px;height:${chh + 8}px;border-radius:${Math.round(cw * 0.16)}px;border:4px solid ${P.acc};opacity:0"></span>`)
    }
    case 'trendsound': {
      // « le son du moment » : la piste tendance, son compteur qui grimpe.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const ch2 = Math.round(f.h * 0.26)
      let wv = ''
      for (let k = 0; k < 24; k++) {
        const hg = Math.round(ch2 * (0.2 + 0.5 * Math.abs(Math.sin(k * 1.7))))
        wv += `<span class="an-p an-tw2" style="left:${Math.round(w * 0.06) + k * Math.round(w * 0.037)}px;top:${Math.round((ch2 - hg) / 2)}px;width:${Math.max(3, Math.round(w * 0.012))}px;height:${hg}px;border-radius:99px;background:#FFFFFF;opacity:.85;transform-origin:50% 50%"></span>`
      }
      const pts = [0.15, 0.24, 0.2, 0.42, 0.56, 0.5, 0.78, 0.95]
      const gy = Math.round(f.h * 0.6), gh = Math.round(f.h * 0.3)
      const d = pts.map((v, k) => `${k ? 'L' : 'M'}${x + Math.round(w * k / (pts.length - 1))} ${gy + Math.round(gh * (1 - v))}`).join(' ')
      return box(`
        <span class="an-p" id="${id}tsc" style="left:${x}px;top:${Math.round(f.h * 0.06)}px;width:${w}px;height:${ch2}px;border-radius:${Math.round(ch2 * 0.24)}px;background:${P.acc};overflow:hidden">${wv}
          <span style="position:absolute;right:${Math.round(w * 0.05)}px;top:50%;transform:translateY(-50%);font-family:'Archivo Black',sans-serif;font-size:${Math.round(ch2 * 0.34)}px;color:#FFFFFF">↑</span></span>
        <svg class="an-p" style="left:0;top:0;width:${f.w}px;height:${f.h}px" fill="none">
          <path id="${id}tsl" d="${d}" stroke="${P.acc}" stroke-width="${Math.max(4, Math.round(w * 0.014))}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>
        <span class="an-p" id="${id}tsn" style="left:${x}px;top:${Math.round(f.h * 0.38)}px;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.14)}px;color:${P.ink};transform-origin:0% 50%">${txt(0, '184K')}</span>`)
    }
    case 'algorithm': {
      // « l'algo te pousse » : la video part et remplit la grille des ecrans.
      const cols = 3, rows = 3, gp = Math.round(f.w * 0.035)
      const cw = Math.round((f.w * 0.86 - gp * (cols - 1)) / cols), chh = Math.round(cw * 1.5)
      const x0 = Math.round((f.w - (cw * cols + gp * (cols - 1))) / 2)
      const y0 = Math.round((f.h - (chh * rows + gp * (rows - 1))) / 2)
      let gs = ''
      for (let k = 0; k < 9; k++) {
        const c = k % cols, r = (k / cols) | 0, src = k === 4
        gs += `<span class="an-p an-ag" id="${id}ag${k}" style="left:${x0 + c * (cw + gp)}px;top:${y0 + r * (chh + gp)}px;width:${cw}px;height:${chh}px;border-radius:${Math.round(cw * 0.16)}px;background:${src ? P.acc : P.line};opacity:${src ? 1 : .4};overflow:hidden">
          <span style="position:absolute;left:50%;margin-left:${-Math.round(cw * 0.14)}px;top:22%;width:${Math.round(cw * 0.28)}px;height:${Math.round(cw * 0.28)}px;border-radius:50%;background:#FFFFFF;opacity:${src ? .8 : .3}"></span>
          <span style="position:absolute;left:14%;bottom:16%;width:72%;height:${Math.max(3, Math.round(chh * 0.035))}px;border-radius:99px;background:#FFFFFF;opacity:${src ? .6 : .22}"></span></span>`
      }
      return box(gs)
    }
    case 'loop': {
      // « ils la regardent en boucle » : la lecture repart sans coupure.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const th = Math.round(f.h * 0.14), y = Math.round(f.h * 0.56)
      const R = Math.round(f.h * 0.17)
      return box(`
        <svg class="an-p" id="${id}lpa" viewBox="0 0 48 48" style="left:${Math.round(f.w / 2) - R}px;top:${Math.round(f.h * 0.12)}px;width:${2 * R}px;height:${2 * R}px" fill="none" stroke="${P.acc}" stroke-width="4.5" stroke-linecap="round">
          <path d="M40 24a16 16 0 1 1-5.6-12.2"/><path d="M40 4v9h-9"/></svg>
        <span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${th}px;border-radius:99px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          <span class="an-p" id="${id}lpb" style="left:0;top:0;width:100%;height:100%;border-radius:99px;background:${P.acc};transform-origin:0% 50%"></span></span>
        <span class="an-p" id="${id}lph" style="left:${x}px;top:${y - Math.round(f.h * 0.03)}px;width:${Math.max(5, Math.round(w * 0.012))}px;height:${th + Math.round(f.h * 0.06)}px;border-radius:99px;background:${P.ink}"></span>
        <span class="an-p" id="${id}lpn" style="left:0;top:${y + Math.round(f.h * 0.16)}px;width:100%;height:${Math.round(f.h * 0.14)}px;display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.13)}px;color:${P.acc};transform-origin:50% 50%">${txt(0, '×3')}</span>`)
    }
    case 'framing': {
      // « bien te cadrer » : le cadre se resserre sur le sujet, les tiers apparaissent.
      const cx = Math.round(f.w / 2), hy = Math.round(f.h * 0.42), hr = Math.round(f.w * 0.13)
      const gl = (x1, y1, x2, y2) => `<span class="an-p an-fg" style="left:${x1}px;top:${y1}px;width:${Math.max(2, x2 - x1)}px;height:${Math.max(2, y2 - y1)}px;background:${P.ink};opacity:.28"></span>`
      const fw = Math.round(f.w * 0.86), fh = Math.round(f.h * 0.6)
      const fx = Math.round((f.w - fw) / 2), fy = Math.round((f.h - fh) / 2)
      return box(`
        <span class="an-p" style="left:${cx - hr}px;top:${hy - hr}px;width:${2 * hr}px;height:${2 * hr}px;border-radius:50%;background:${P.acc}"></span>
        <span class="an-p" style="left:${cx - Math.round(hr * 1.5)}px;top:${hy + hr}px;width:${Math.round(hr * 3)}px;height:${Math.round(hr * 2.2)}px;border-radius:${Math.round(hr * 0.8)}px ${Math.round(hr * 0.8)}px 0 0;background:${P.acc}"></span>
        <span class="an-p" id="${id}fmb" style="box-sizing:border-box;left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px;border:${Math.max(4, Math.round(f.w * 0.012))}px solid ${P.ink};border-radius:${Math.round(f.w * 0.03)}px"></span>
        ${gl(fx + Math.round(fw / 3), fy, fx + Math.round(fw / 3) + 2, fy + fh)}
        ${gl(fx + Math.round(2 * fw / 3), fy, fx + Math.round(2 * fw / 3) + 2, fy + fh)}
        ${gl(fx, fy + Math.round(fh / 3), fx + fw, fy + Math.round(fh / 3) + 2)}
        ${gl(fx, fy + Math.round(2 * fh / 3), fx + fw, fy + Math.round(2 * fh / 3) + 2)}`)
    }
    case 'focus': {
      // « c'est flou » : la même image, floue, qui devient nette d'un coup.
      const w = Math.round(f.w * 0.8), hgt = Math.round(w * 1.1)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - hgt) / 2)
      const inner = (blur) => `
        <span style="position:absolute;inset:0;background:${P.soft};filter:blur(${blur}px)"></span>
        <span style="position:absolute;left:50%;margin-left:${-Math.round(w * 0.17)}px;top:${Math.round(hgt * 0.18)}px;width:${Math.round(w * 0.34)}px;height:${Math.round(w * 0.34)}px;border-radius:50%;background:${P.acc};filter:blur(${blur}px)"></span>
        <span style="position:absolute;left:50%;margin-left:${-Math.round(w * 0.27)}px;top:${Math.round(hgt * 0.55)}px;width:${Math.round(w * 0.54)}px;height:${Math.round(hgt * 0.32)}px;border-radius:${Math.round(w * 0.16)}px ${Math.round(w * 0.16)}px 0 0;background:${P.acc};filter:blur(${blur}px)"></span>`
      const bk = Math.round(f.w * 0.06)
      return box(`
        <span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${hgt}px;border-radius:${Math.round(w * 0.08)}px;overflow:hidden;background:${P.soft}">
          <span class="an-p" id="${id}fcb" style="left:0;top:0;width:100%;height:100%">${inner(Math.round(w * 0.06))}</span>
          <span class="an-p" id="${id}fcn" style="left:0;top:0;width:100%;height:100%;opacity:0">${inner(0)}</span></span>
        <span class="an-p an-fcc" id="${id}fc1" style="left:${x - 6}px;top:${y - 6}px;width:${bk}px;height:${Math.max(4, Math.round(f.w * 0.011))}px;background:${P.acc}"></span>
        <span class="an-p an-fcc" id="${id}fc2" style="left:${x + w - bk + 6}px;top:${y + hgt + 6}px;width:${bk}px;height:${Math.max(4, Math.round(f.w * 0.011))}px;background:${P.acc}"></span>`)
    }
    case 'clipping': {
      // « ton son sature » : l'onde tape le plafond, rougit, puis rentre dans le cadre.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const ch = Math.round(f.h * 0.42), y = Math.round((f.h - ch) / 2)
      let bars = ''
      for (let k = 0; k < 30; k++) {
        const over = k > 8 && k < 21
        bars += `<span class="an-p an-cp" id="${id}cp${k}" style="left:${Math.round(w * 0.03) + k * Math.round(w * 0.032)}px;top:50%;width:${Math.max(3, Math.round(w * 0.014))}px;height:${Math.round(ch * (over ? 0.96 : 0.3 + 0.3 * Math.abs(Math.sin(k * 1.3))))}px;margin-top:${-Math.round(ch * (over ? 0.48 : 0.15 + 0.15 * Math.abs(Math.sin(k * 1.3))))}px;border-radius:99px;background:${over ? '#E5484D' : P.ink};opacity:${over ? 1 : .5};transform-origin:50% 50%"></span>`
      }
      const line = (top) => `<span class="an-p" style="left:${x}px;top:${top}px;width:${w}px;height:3px;background:#E5484D;opacity:.7"></span>`
      return box(`
        <span class="an-p" style="left:${x}px;top:${y}px;width:${w}px;height:${ch}px;border-radius:${Math.round(f.w * 0.03)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">${bars}</span>
        ${line(y + Math.round(ch * 0.04))}${line(y + Math.round(ch * 0.96))}
        <span class="an-p" id="${id}cpw" style="left:0;top:${y + ch + Math.round(f.h * 0.05)}px;width:100%;text-align:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.05)}px;color:#E5484D">${txt(0, 'SATURE')}</span>`)
    }
    case 'lighting': {
      // « eclaire-toi » : la lumière se pose sur le visage et l'ombre recule.
      const cx = Math.round(f.w / 2), cy = Math.round(f.h * 0.56), hr = Math.round(f.w * 0.17)
      return box(`
        <span class="an-p" id="${id}lgh" style="left:${cx - hr}px;top:${cy - hr}px;width:${2 * hr}px;height:${2 * hr}px;border-radius:50%;background:${P.line}"></span>
        <span class="an-p" id="${id}lgb" style="left:${cx - Math.round(hr * 1.6)}px;top:${cy + hr}px;width:${Math.round(hr * 3.2)}px;height:${Math.round(hr * 2)}px;border-radius:${Math.round(hr * 0.9)}px ${Math.round(hr * 0.9)}px 0 0;background:${P.line}"></span>
        <span class="an-p" id="${id}lgg" style="left:${cx - Math.round(f.w * 0.45)}px;top:${Math.round(f.h * 0.06)}px;width:${Math.round(f.w * 0.9)}px;height:${Math.round(f.h * 0.9)}px;border-radius:50%;background:radial-gradient(circle at 50% 30%, rgba(255,214,120,.85), rgba(255,214,120,0) 62%);opacity:0"></span>
        <span class="an-p" id="${id}lgl" style="left:${Math.round(f.w * 0.12)}px;top:${Math.round(f.h * 0.1)}px;width:${Math.round(f.w * 0.2)}px;height:${Math.round(f.w * 0.2)}px;border-radius:${Math.round(f.w * 0.05)}px;background:${P.acc};transform-origin:50% 50%"></span>`)
    }
    case 'retake': {
      // « je la refais » : la prise barrée part, la suivante arrive à sa place.
      const w = Math.round(f.w * 0.66), hgt = Math.round(w * 1.35)
      const x = Math.round((f.w - w) / 2), y = Math.round((f.h - hgt) / 2)
      const card = (bg, label, col) => `
        <span style="position:absolute;inset:0;border-radius:${Math.round(w * 0.1)}px;background:${bg};overflow:hidden"></span>
        <span style="position:absolute;left:0;bottom:${Math.round(hgt * 0.08)}px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(w * 0.15)}px;color:${col}">${label}</span>`
      return box(`
        <span class="an-p" id="${id}rk1" style="left:${x}px;top:${y}px;width:${w}px;height:${hgt}px">${card(P.soft, txt(1, 'PRISE 1'), P.line)}
          <span class="an-p" style="left:${Math.round(w * 0.08)}px;top:${Math.round(hgt * 0.48)}px;width:${Math.round(w * 0.84)}px;height:${Math.max(5, Math.round(w * 0.02))}px;background:#E5484D;transform:rotate(-14deg)"></span></span>
        <span class="an-p" id="${id}rk2" style="left:${x}px;top:${y}px;width:${w}px;height:${hgt}px;opacity:0">${card(grad(160), txt(0, 'PRISE 2'), '#FFFFFF')}</span>`)
    }
    case 'caption': {
      // « la description, les hashtags » : le texte s'écrit sous la vidéo avant de poster.
      const w = Math.round(f.w * 0.88), x = Math.round((f.w - w) / 2)
      const vh = Math.round(f.h * 0.34)
      const tags = ['#viral', '#astuce', '#ia']
      const tg = tags.map((t, k) => `<span class="an-p an-cpt" style="left:${x + k * Math.round(w * 0.31)}px;top:${Math.round(f.h * 0.78)}px;padding:0 ${Math.round(w * 0.035)}px;height:${Math.round(f.h * 0.07)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.036)}px;color:#FFFFFF">${t}</span>`).join('')
      const ln = (k, wd) => `<span class="an-p an-cpl" style="left:${x}px;top:${Math.round(f.h * (0.52 + k * 0.07))}px;width:${Math.round(w * wd)}px;height:${Math.round(f.h * 0.032)}px;border-radius:99px;background:${P.ink};opacity:.7;transform-origin:0% 50%"></span>`
      return box(`
        <span class="an-p" style="left:${x}px;top:${Math.round(f.h * 0.1)}px;width:${w}px;height:${vh}px;border-radius:${Math.round(f.w * 0.05)}px;background:${grad(150)}"></span>
        ${ln(0, 0.95)}${ln(1, 0.8)}${ln(2, 0.55)}
        ${tg}`)
    }
    case 'preview': {
      // « avant de poster » : le rendu final apparaît dans le fil, tel qu'il sera vu.
      const pw = Math.round(f.h * 0.48), ph = Math.round(pw * 2), px = Math.round((f.w - pw) / 2)
      const py = Math.round((f.h - ph) / 2), r = Math.round(pw * 0.14)
      return box(`
        <div class="an-p" id="${id}pvp" style="left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;border:3px solid ${P.line};border-radius:${r}px;background:${P.soft};overflow:hidden">
          <span class="an-p" id="${id}pvv" style="left:${Math.round(pw * 0.06)}px;top:${Math.round(ph * 0.14)}px;width:${Math.round(pw * 0.88)}px;height:${Math.round(ph * 0.56)}px;border-radius:${Math.round(pw * 0.08)}px;background:${grad(150)}"></span>
          <span class="an-p an-pvl" style="left:${Math.round(pw * 0.06)}px;top:${Math.round(ph * 0.75)}px;width:${Math.round(pw * 0.7)}px;height:${Math.round(ph * 0.025)}px;border-radius:99px;background:${P.line}"></span>
          <span class="an-p an-pvl" style="left:${Math.round(pw * 0.06)}px;top:${Math.round(ph * 0.81)}px;width:${Math.round(pw * 0.45)}px;height:${Math.round(ph * 0.025)}px;border-radius:99px;background:${P.line}"></span>
        </div>
        <span class="an-p" id="${id}pvb" style="left:${px + Math.round(pw * 0.2)}px;top:${py + ph - Math.round(f.h * 0.03)}px;width:${Math.round(pw * 0.6)}px;height:${Math.round(f.h * 0.08)}px;border-radius:99px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.038)}px;color:#FFFFFF">${txt(0, 'PUBLIER')}</span>`)
    }
    case 'spike': {
      // « ca a explose » : la courbe plate décolle d'un coup, le chiffre suit.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const gy = Math.round(f.h * 0.72), gh = Math.round(f.h * 0.44)
      const pts = [0.06, 0.08, 0.07, 0.1, 0.12, 0.34, 0.72, 1]
      const d = pts.map((v, k) => `${k ? 'L' : 'M'}${x + Math.round(w * k / (pts.length - 1))} ${gy - Math.round(gh * v)}`).join(' ')
      return box(`
        <span class="an-p" style="left:${x}px;top:${gy}px;width:${w}px;height:3px;background:${P.line}"></span>
        <svg class="an-p" style="left:0;top:0;width:${f.w}px;height:${f.h}px" fill="none">
          <path id="${id}spl" d="${d}" stroke="${P.acc}" stroke-width="${Math.max(5, Math.round(w * 0.018))}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>
        <span class="an-p" id="${id}spd" style="left:${x + w - Math.round(f.w * 0.05)}px;top:${gy - gh - Math.round(f.w * 0.05)}px;width:${Math.round(f.w * 0.1)}px;height:${Math.round(f.w * 0.1)}px;border-radius:50%;background:${P.acc}"></span>
        <span class="an-p" id="${id}spn" style="left:0;top:${Math.round(f.h * 0.12)}px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.14)}px;color:${P.ink};transform-origin:50% 50%">${txt(0, '340K')}</span>`)
    }
    case 'brandeal': {
      // « une marque m'a contacte » : la proposition arrive, le montant se pose.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const ch = Math.round(f.h * 0.3), y = Math.round(f.h * 0.22)
      return box(`
        <span class="an-p" id="${id}bdc" style="left:${x}px;top:${y}px;width:${w}px;height:${ch}px;border-radius:${Math.round(f.w * 0.06)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          <span style="position:absolute;left:${Math.round(w * 0.06)}px;top:${Math.round(ch * 0.16)}px;width:${Math.round(ch * 0.3)}px;height:${Math.round(ch * 0.3)}px;border-radius:${Math.round(ch * 0.09)}px;background:${P.acc}"></span>
          <span style="position:absolute;left:${Math.round(w * 0.28)}px;top:${Math.round(ch * 0.22)}px;width:${Math.round(w * 0.42)}px;height:${Math.round(ch * 0.09)}px;border-radius:99px;background:${P.line}"></span>
          <span style="position:absolute;left:${Math.round(w * 0.28)}px;top:${Math.round(ch * 0.38)}px;width:${Math.round(w * 0.26)}px;height:${Math.round(ch * 0.07)}px;border-radius:99px;background:${P.line};opacity:.6"></span>
          <span style="position:absolute;left:${Math.round(w * 0.06)}px;top:${Math.round(ch * 0.62)}px;width:${Math.round(w * 0.72)}px;height:${Math.round(ch * 0.07)}px;border-radius:99px;background:${P.line};opacity:.5"></span></span>
        <span class="an-p" id="${id}bdm" style="left:${x + Math.round(w * 0.12)}px;top:${y + ch - Math.round(f.h * 0.045)}px;width:${Math.round(w * 0.76)}px;height:${Math.round(f.h * 0.15)}px;border-radius:${Math.round(f.w * 0.05)}px;background:${grad(150)};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.085)}px;color:#FFFFFF;transform-origin:50% 50%">${txt(0, '1500 €')}</span>`)
    }
    case 'mediakit': {
      // « mon media-kit » : la fiche stats se compose, trois chiffres se posent.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const ch = Math.round(f.h * 0.62), y = Math.round((f.h - ch) / 2)
      const vals = [txt(0, '84K'), txt(1, '2,1 M'), txt(2, '7,4 %')]
      const labs = ['ABONNES', 'VUES / MOIS', 'ENGAGEMENT']
      const rows = vals.map((v, k) => `
        <span class="an-p an-mk" style="left:${Math.round(w * 0.07)}px;top:${Math.round(ch * (0.34 + k * 0.2))}px;width:${Math.round(w * 0.86)}px;height:${Math.round(ch * 0.16)}px;border-radius:${Math.round(f.w * 0.03)}px;background:${k === 0 ? P.acc : P.soft};border:2px solid ${k === 0 ? P.acc : P.line};display:flex;align-items:center;justify-content:space-between;padding:0 ${Math.round(w * 0.05)}px;box-sizing:border-box">
          <span style="font-family:${SANS};font-weight:800;font-size:${Math.round(ch * 0.05)}px;letter-spacing:.06em;color:${k === 0 ? 'rgba(255,255,255,.85)' : P.line}">${labs[k]}</span>
          <span style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(ch * 0.09)}px;color:${k === 0 ? '#FFFFFF' : P.ink}">${v}</span></span>`).join('')
      return box(`
        <span class="an-p" id="${id}mkc" style="left:${x}px;top:${y}px;width:${w}px;height:${ch}px;border-radius:${Math.round(f.w * 0.06)}px;background:${P.soft};border:2px solid ${P.line};overflow:hidden">
          <span style="position:absolute;left:${Math.round(w * 0.07)}px;top:${Math.round(ch * 0.08)}px;width:${Math.round(ch * 0.18)}px;height:${Math.round(ch * 0.18)}px;border-radius:50%;background:${P.acc}"></span>
          <span style="position:absolute;left:${Math.round(w * 0.28)}px;top:${Math.round(ch * 0.13)}px;width:${Math.round(w * 0.4)}px;height:${Math.round(ch * 0.05)}px;border-radius:99px;background:${P.line}"></span>
          ${rows}</span>`)
    }
    case 'inventory': {
      // « je suis en rupture » : le stock descend jusqu'à l'alerte, puis remonte.
      const w = Math.round(f.w * 0.34), x = Math.round((f.w - w) / 2)
      const ch = Math.round(f.h * 0.56), y = Math.round(f.h * 0.2)
      return box(`
        <span class="an-p" style="box-sizing:border-box;left:${x}px;top:${y}px;width:${w}px;height:${ch}px;border-radius:${Math.round(w * 0.14)}px;border:${Math.max(4, Math.round(w * 0.035))}px solid ${P.line};overflow:hidden">
          <span class="an-p" id="${id}ivf" style="left:0;bottom:0;top:auto;width:100%;height:100%;background:${P.acc};transform-origin:50% 100%"></span></span>
        <span class="an-p" id="${id}ivw" style="left:${x - Math.round(f.w * 0.06)}px;top:${y + Math.round(ch * 0.78)}px;width:${w + Math.round(f.w * 0.12)}px;height:4px;background:#E5484D;opacity:.75"></span>
        <span class="an-p" id="${id}ivt" style="left:0;top:${y + ch + Math.round(f.h * 0.04)}px;width:100%;text-align:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.05)}px;color:${P.ink}">${txt(0, 'STOCK')}</span>`)
    }
    case 'stoploss': {
      // « mon stop » : la bougie touche la ligne et la position se ferme.
      const w = Math.round(f.w * 0.86), x = Math.round((f.w - w) / 2)
      const base = Math.round(f.h * 0.34), cw = Math.round(w * 0.09)
      const hs = [0.9, 0.72, 0.78, 0.56, 0.4, 0.3]
      const cd = hs.map((v, k) => `<span class="an-p an-sl" id="${id}sl${k}" style="left:${x + Math.round(w * 0.06) + k * Math.round(w * 0.16)}px;top:${base}px;width:${cw}px;height:${Math.round(f.h * 0.36 * v)}px;border-radius:${Math.round(cw * 0.2)}px;background:${k >= 4 ? '#E5484D' : P.ink};opacity:${k >= 4 ? 1 : .55};transform-origin:50% 0%"></span>`).join('')
      const ly = base + Math.round(f.h * 0.36 * 0.42)
      return box(`${cd}
        <span class="an-p" id="${id}sll" style="left:${x}px;top:${ly}px;width:${w}px;height:4px;background:#E5484D;transform-origin:0% 50%"></span>
        <span class="an-p" id="${id}slt" style="left:${x}px;top:${ly - Math.round(f.h * 0.075)}px;padding:0 ${Math.round(w * 0.03)}px;height:${Math.round(f.h * 0.06)}px;border-radius:99px;background:#E5484D;display:flex;align-items:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.033)}px;color:#FFFFFF">${txt(0, 'STOP')}</span>`)
    }
    case 'orderbook': {
      // « le carnet » : les deux côtés se remplissent, l'écart se resserre.
      const w = Math.round(f.w * 0.88), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.052), gp = Math.round(f.h * 0.012)
      const mid = Math.round(f.h * 0.5)
      let rows = ''
      for (let k = 0; k < 5; k++) {
        const wd = Math.round(w * (0.9 - k * 0.13))
        rows += `<span class="an-p an-ob1" style="left:${x}px;top:${mid - Math.round(f.h * 0.05) - (k + 1) * (rh + gp)}px;width:${wd}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:#E5484D;opacity:.55;transform-origin:0% 50%"></span>`
        rows += `<span class="an-p an-ob2" style="left:${x}px;top:${mid + Math.round(f.h * 0.05) + k * (rh + gp)}px;width:${wd}px;height:${rh}px;border-radius:${Math.round(rh * 0.28)}px;background:${P.acc};opacity:.85;transform-origin:0% 50%"></span>`
      }
      return box(`${rows}
        <span class="an-p" id="${id}obs" style="left:${x}px;top:${mid - Math.round(f.h * 0.035)}px;width:${w}px;height:${Math.round(f.h * 0.07)}px;border-radius:${Math.round(f.h * 0.02)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.04)}px;color:${P.ink}">${txt(0, 'SPREAD')}</span>`)
    }
    case 'deploy': {
      // « je deploie » : les étapes défilent jusqu'au badge EN LIGNE.
      const w = Math.round(f.w * 0.84), x = Math.round((f.w - w) / 2)
      const sy = Math.round(f.h * 0.32), sh = Math.round(f.h * 0.09), gp = Math.round(f.h * 0.035)
      const names = ['BUILD', 'TESTS', 'DEPLOY']
      const st = names.map((n, k) => `
        <span class="an-p an-dp" id="${id}dp${k}" style="left:${x}px;top:${sy + k * (sh + gp)}px;width:${w}px;height:${sh}px;border-radius:${Math.round(sh * 0.3)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;padding:0 ${Math.round(w * 0.06)}px;box-sizing:border-box;gap:${Math.round(w * 0.05)}px">
          <span class="an-dpd" style="width:${Math.round(sh * 0.3)}px;height:${Math.round(sh * 0.3)}px;border-radius:50%;background:${P.line}"></span>
          <span style="font-family:${SANS};font-weight:800;font-size:${Math.round(sh * 0.36)}px;letter-spacing:.08em;color:${P.ink}">${n}</span></span>`).join('')
      return box(`${st}
        <span class="an-p" id="${id}dpb" style="left:${x + Math.round(w * 0.18)}px;top:${sy + 3 * (sh + gp) + Math.round(f.h * 0.03)}px;width:${Math.round(w * 0.64)}px;height:${Math.round(f.h * 0.12)}px;border-radius:99px;background:${grad(150)};display:flex;align-items:center;justify-content:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.055)}px;color:#FFFFFF;opacity:0;transform-origin:50% 50%">${txt(0, 'EN LIGNE')}</span>`)
    }
    case 'uptime': {
      // « jamais de panne » : la ligne de disponibilité se remplit jour après jour.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const n = 26, bw = Math.max(4, Math.round(w / (n * 1.6))), gp = Math.round((w - n * bw) / (n - 1))
      const bh = Math.round(f.h * 0.24), y = Math.round(f.h * 0.44)
      let bars = ''
      for (let k = 0; k < n; k++) {
        const bad = k === 17
        bars += `<span class="an-p an-up" style="left:${x + k * (bw + gp)}px;top:${y}px;width:${bw}px;height:${bh}px;border-radius:99px;background:${bad ? '#E5484D' : P.acc};transform-origin:50% 100%"></span>`
      }
      return box(`${bars}
        <span class="an-p" id="${id}upn" style="left:0;top:${Math.round(f.h * 0.18)}px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.13)}px;color:${P.ink};transform-origin:50% 50%">${txt(0, '99,98 %')}</span>
        <span class="an-p" style="left:0;top:${y + bh + Math.round(f.h * 0.05)}px;width:100%;text-align:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.04)}px;letter-spacing:.1em;color:${P.line}">DISPONIBILITE</span>`)
    }
    case 'leads': {
      // « ma liste grossit » : les prospects tombent un à un, le compteur monte.
      const w = Math.round(f.w * 0.84), x = Math.round((f.w - w) / 2)
      const rh = Math.round(f.h * 0.08), gp = Math.round(f.h * 0.022), y = Math.round(f.h * 0.42)
      // Axel : « tu pourrais modifier en mettant différents avatars ». Quatre
      // pastilles identiques ne montraient pas des GENS : c'était une liste. Chaque
      // prospect a maintenant sa silhouette et sa couleur — on lit des personnes
      // qui arrivent, pas des lignes qui s'empilent.
      const teintes = [P.acc, '#3B82F6', '#22C55E', '#A855F7']
      const tete = (col, d) => `<span style="position:relative;width:${d}px;height:${d}px;border-radius:50%;background:${col};flex:none;overflow:hidden">
        <span style="position:absolute;left:50%;margin-left:${-Math.round(d * 0.16)}px;top:${Math.round(d * 0.2)}px;width:${Math.round(d * 0.32)}px;height:${Math.round(d * 0.32)}px;border-radius:50%;background:rgba(255,255,255,.9)"></span>
        <span style="position:absolute;left:50%;margin-left:${-Math.round(d * 0.29)}px;top:${Math.round(d * 0.58)}px;width:${Math.round(d * 0.58)}px;height:${Math.round(d * 0.42)}px;border-radius:${Math.round(d * 0.29)}px ${Math.round(d * 0.29)}px 0 0;background:rgba(255,255,255,.9)"></span></span>`
      let rows = ''
      for (let k = 0; k < 4; k++) {
        rows += `<span class="an-p an-ld" id="${id}ld${k}" style="left:${x}px;top:${y + k * (rh + gp)}px;width:${w}px;height:${rh}px;border-radius:${Math.round(rh * 0.3)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;padding:0 ${Math.round(w * 0.05)}px;box-sizing:border-box;gap:${Math.round(w * 0.04)}px;opacity:0">
          ${tete(teintes[k], Math.round(rh * 0.56))}
          <span style="flex:1;height:${Math.round(rh * 0.16)}px;border-radius:99px;background:${P.line};opacity:.6;max-width:${[70, 52, 78, 60][k]}%"></span></span>`
      }
      return box(`${rows}
        <span class="an-p" id="${id}ldn" style="left:0;top:${Math.round(f.h * 0.16)}px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.16)}px;color:${P.acc};transform-origin:50% 50%">${txt(0, '312')}</span>`)
    }
    case 'views': {
      // « DES MILLIONS DE VUES ». Axel avait supprimé l'ancienne — un œil posé sur
      // un fond, rien ne se passait. Ici c'est la vignette de SA vidéo, et le
      // compteur de vues sous la miniature qui grimpe pendant que la barre de
      // lecture avance. On voit le chiffre monter, pas un symbole de « vue ».
      const pw = Math.round(f.h * 0.44), ph = Math.round(pw * 1.72)
      const px = Math.round((f.w - pw) / 2), py = Math.round(f.h * 0.05)
      return box(`
        <div class="an-p" id="${id}vw" style="left:${px}px;top:${py}px;width:${pw}px;height:${ph}px;border-radius:${Math.round(pw * 0.12)}px;overflow:hidden;background:${P.soft};border:2px solid ${P.line};box-shadow:0 20px 46px rgba(0,0,0,.24)">
          ${s.logoFile ? `<img src="${s.logoFile}" style="width:100%;height:100%;object-fit:cover;display:block"/>` : `<span style="position:absolute;inset:0;background:${grad(150)}"></span>`}
          <span style="position:absolute;left:0;bottom:0;width:100%;height:${Math.max(4, Math.round(ph * 0.02))}px;background:rgba(255,255,255,.3)">
            <span class="an-p" id="${id}vwp" style="left:0;top:0;width:100%;height:100%;background:${P.acc};transform-origin:0% 50%;transform:scaleX(0)"></span></span>
          <svg class="an-p" id="${id}vwt" viewBox="0 0 24 24" style="left:50%;margin-left:${-Math.round(pw * 0.13)}px;top:50%;margin-top:${-Math.round(pw * 0.13)}px;width:${Math.round(pw * 0.26)}px;height:${Math.round(pw * 0.26)}px" fill="#FFFFFF" opacity=".9"><path d="M8 5v14l11-7z"/></svg></div>
        <span class="an-p" id="${id}vwn" style="left:0;top:${py + ph + Math.round(f.h * 0.04)}px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(f.h * 0.14)}px;color:${P.acc};transform-origin:50% 50%">${txt(1, '200')}</span>
        <span class="an-p" style="left:0;top:${py + ph + Math.round(f.h * 0.2)}px;width:100%;text-align:center;font-family:${SANS};font-weight:800;letter-spacing:.14em;font-size:${Math.round(f.h * 0.042)}px;color:${P.ink};opacity:.5">VUES</span>`)
    }
    case 'linkbio': {
      // « LE LIEN DANS MA BIO ». Le profil, la ligne du lien, et le doigt qui vient
      // taper dessus. C'est le geste qu'on demande au spectateur — il doit le voir
      // fait une fois pour le refaire.
      const w = Math.round(f.w * 0.9), x = Math.round((f.w - w) / 2)
      const av = Math.round(f.w * 0.22)
      const ly = Math.round(f.h * 0.52), lh = Math.round(f.h * 0.12)
      return box(`
        <span class="an-p" id="${id}lba" style="left:${Math.round((f.w - av) / 2)}px;top:${Math.round(f.h * 0.05)}px;width:${av}px;height:${av}px;border-radius:50%;overflow:hidden;background:${P.soft};border:3px solid ${P.line}">
          ${s.logoFile ? `<img src="${s.logoFile}" style="width:100%;height:100%;object-fit:cover;display:block"/>` : `<span style="position:absolute;inset:0;background:${grad(150)}"></span>`}</span>
        <span class="an-p" id="${id}lbn" style="left:0;top:${Math.round(f.h * 0.05) + av + Math.round(f.h * 0.025)}px;width:100%;text-align:center;font-family:${SANS};font-weight:800;font-size:${Math.round(f.h * 0.055)}px;color:${P.ink}">${txt(1, '@TONCOMPTE')}</span>
        <span class="an-p" id="${id}lbb" style="left:${x + Math.round(w * 0.14)}px;top:${Math.round(f.h * 0.4)}px;width:${Math.round(w * 0.72)}px;height:${Math.max(3, Math.round(f.h * 0.022))}px;border-radius:99px;background:${P.line};opacity:.55"></span>
        <span class="an-p" id="${id}lbl" style="left:${x}px;top:${ly}px;width:${w}px;height:${lh}px;border-radius:${Math.round(lh * 0.32)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;justify-content:center;gap:${Math.round(lh * 0.2)}px;font-family:${SANS};font-weight:800;font-size:${Math.round(lh * 0.32)}px;color:${P.acc}">
          <svg viewBox="0 0 24 24" style="width:${Math.round(lh * 0.4)}px;height:${Math.round(lh * 0.4)}px;flex:none" fill="none" stroke="${P.acc}" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>
          ${txt(0, 'MON LIEN')}</span>
        <span class="an-p" id="${id}lbf" style="left:${Math.round(f.w / 2) - Math.round(f.w * 0.07)}px;top:${ly + Math.round(lh * 0.5)}px;width:${Math.round(f.w * 0.14)}px;height:${Math.round(f.w * 0.14)}px;border-radius:50%;background:${P.ink};opacity:0"></span>`)
    }
    case 'comment': {
      // « ÉCRIS-MOI EN COMMENTAIRE ». Axel : « une animation avec un clavier
      // Apple pour commenter ». Le clavier iOS complet en bas, le champ au-dessus,
      // et les touches qui s'enfoncent l'une après l'autre pendant que le mot
      // s'écrit. C'est le geste que le spectateur doit reproduire, montré tel quel.
      const rows = ['AZERTYUIOP', 'QSDFGHJKLM', 'WXCVBN']
      const kw = Math.round(f.w / 11.6), kh = Math.round(kw * 1.32), gp = Math.round(kw * 0.14)
      const kbTop = Math.round(f.h - (rows.length * (kh + gp) + Math.round(f.h * 0.02)))
      let keys = '', n = 0
      rows.forEach((r, ri) => {
        const rowW = r.length * (kw + gp) - gp
        const x0 = Math.round((f.w - rowW) / 2)
        r.split('').forEach((c, ci) => {
          // le voile d'accent est POSÉ ici, à opacité 0 : animJs ne connaît pas la
          // palette (pas de `P`), il ne peut donc que le faire apparaître.
          keys += `<span class="an-p an-kk" id="${id}kk${n}" style="left:${x0 + ci * (kw + gp)}px;top:${kbTop + ri * (kh + gp)}px;width:${kw}px;height:${kh}px;border-radius:${Math.round(kw * 0.22)}px;background:${P.soft};border:1px solid ${P.line};display:flex;align-items:center;justify-content:center;font-family:${SANS};font-weight:600;font-size:${Math.round(kw * 0.46)}px;color:${P.ink};overflow:hidden">${c}<span id="${id}kh${n++}" style="position:absolute;inset:0;background:${P.acc};opacity:0"></span></span>`
        })
      })
      const mot = txt(0, 'PLAN')
      const lettres = mot.split('').map((c) => `<span class="an-cl2" style="opacity:0">${c === ' ' ? '&nbsp;' : c}</span>`).join('')
      const fw2 = Math.round(f.w * 0.9), fx = Math.round((f.w - fw2) / 2)
      const fh2 = Math.round(f.h * 0.15), fy = kbTop - fh2 - Math.round(f.h * 0.06)
      return box(`${keys}
        <span class="an-p" id="${id}cf" style="left:${fx}px;top:${fy}px;width:${fw2}px;height:${fh2}px;border-radius:${Math.round(fh2 * 0.5)}px;background:${P.soft};border:2px solid ${P.line};display:flex;align-items:center;padding:0 ${Math.round(fh2 * 0.34)}px;box-sizing:border-box;gap:${Math.round(fh2 * 0.2)}px">
          <span style="width:${Math.round(fh2 * 0.56)}px;height:${Math.round(fh2 * 0.56)}px;border-radius:50%;background:${P.line};flex:none"></span>
          <span id="${id}ct" style="font-family:'Archivo Black',sans-serif;font-size:${Math.round(fh2 * 0.42)}px;color:${P.acc};white-space:nowrap">${lettres}</span>
          <span id="${id}cc" style="width:${Math.max(3, Math.round(fh2 * 0.05))}px;height:${Math.round(fh2 * 0.46)}px;background:${P.acc};border-radius:2px"></span></span>`)
    }
    case 'share': {
      // « PARTAGE » / « METS UN LIKE » — RÉSERVÉ AU CTA. La barre d'actions d'un
      // post : le cœur se remplit et pulse, le compteur saute, la flèche de partage
      // s'envole. On montre le geste demandé, pas une icône posée.
      // Axel : « la capture est petite, mets un clic où on appuie dessus, et le
      // logo partage d'Instagram plutôt que celui-là ». Les icônes occupaient 20 %
      // de la hauteur : à l'écran d'un téléphone ça ne se voit pas. Elles montent à
      // 42 %, la flèche générique devient l'avion en papier, et un doigt vient
      // vraiment appuyer sur le cœur — c'est le geste demandé au spectateur.
      const r = Math.round(Math.min(f.w * 0.19, f.h * 0.21))
      const cy = Math.round(f.h * 0.46)
      const lx1 = Math.round(f.w * 0.31), lx2 = Math.round(f.w * 0.69)
      const ic = (id2, lx, path, fill, sw) => `<svg class="an-p" id="${id2}" viewBox="0 0 24 24" style="left:${lx - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px" fill="${fill}" stroke="${P.acc}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
      const heart = '<path d="M12 20.5 4.2 12.9a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3a4.6 4.6 0 0 1 6.5 6.5Z"/>'
      // l'avion en papier d'Instagram : le triangle plein et le pli marqué
      const plane = '<path d="M22 2 11 13"/><path d="M22 2 15.5 22l-4.5-9-9-4.5Z"/>'
      const fs = Math.round(r * 1.05)
      return box(`
        ${ic(id + 'sh1', lx1, heart, 'none', 1.7)}
        ${ic(id + 'sh2', lx1, heart, P.acc, 1.7)}
        ${ic(id + 'sh3', lx2, plane, 'none', 1.7)}
        <span class="an-p" id="${id}shr" style="left:${lx1 - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;border:${Math.max(4, Math.round(r * 0.13))}px solid ${P.acc};opacity:0"></span>
        <span class="an-p" id="${id}shn" style="left:${lx1 - r}px;top:${cy + r + Math.round(f.h * 0.02)}px;width:${2 * r}px;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(r * 0.62)}px;color:${P.acc};opacity:0">${txt(0, '+1')}</span>
        <!-- le doigt : une pastille sombre qui descend et s'écrase sur le cœur -->
        <span class="an-p" id="${id}shf" style="left:${lx1 - Math.round(fs / 2) + Math.round(r * 0.34)}px;top:${cy - Math.round(fs / 2) + Math.round(r * 0.4)}px;width:${fs}px;height:${fs}px;border-radius:50%;background:${P.ink};opacity:0"></span>`)
      // pas de libellé au-dessus : le geste se suffit à lui-même, et le sous-titre
      // de la vidéo dit déjà ce qu'il faut faire.
    }
    default: { // clock — « en 2 minutes », « en 30 secondes »
      // L'aiguille qui tourne dans un cercle vide illustrait « le temps », pas LE
      // GAIN de temps. Un anneau qui se VIDE, avec la durée écrite au centre et
      // l'ancienne durée barrée à côté, dit ce qu'on entend : c'était long, c'est
      // devenu court. LE CHIFFRE VIENT DE L'AUDIO — et seulement de l'audio.
      // Les valeurs de repli « 2 MIN » / « 3 HEURES » s'affichaient dès que le
      // plan n'en fournissait pas : sur « en quelques secondes, AvatarAds génère
      // ta vidéo », l'écran annonçait « 2 MIN ». Une durée inventée qui contredit
      // la voix. Sans valeur, l'anneau se vide et ne dit aucun chiffre.
      const d = Math.round(Math.min(f.h * 0.78, f.w * 0.72))
      const cx = Math.round(f.w / 2), cy = Math.round(f.h * 0.46)
      const rr = Math.round(d / 2), sw = Math.round(d * 0.09)
      const C = 2 * Math.PI * (rr - sw / 2)
      return box(`
        <svg class="an-p" style="left:${cx - rr}px;top:${cy - rr}px;width:${d}px;height:${d}px" viewBox="0 0 ${d} ${d}" fill="none">
          <circle cx="${rr}" cy="${rr}" r="${rr - sw / 2}" stroke="${P.line}" stroke-width="${sw}"/>
          <circle id="${id}cl" cx="${rr}" cy="${rr}" r="${rr - sw / 2}" stroke="${P.acc}" stroke-width="${sw}" stroke-linecap="round"
            stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="0" transform="rotate(-90 ${rr} ${rr})"/></svg>
        <span class="an-p" id="${id}cn" style="left:0;top:${cy - Math.round(d * 0.14)}px;width:100%;text-align:center;font-family:'Archivo Black',sans-serif;font-size:${Math.round(d * 0.26)}px;color:${P.ink};transform-origin:50% 50%">${txt(0, '')}</span>
        ${(raw[1] || '').trim() ? `<span class="an-p" id="${id}co" style="left:0;top:${cy + rr + Math.round(f.h * 0.04)}px;width:100%;text-align:center;font-family:${SANS};font-weight:800;font-size:${Math.round(d * 0.11)}px;color:${P.ink};opacity:0">
          <span style="position:relative;opacity:.45">${txt(1, '')}<span id="${id}cb" style="position:absolute;left:0;top:50%;width:100%;height:${Math.max(3, Math.round(d * 0.014))}px;background:#E5484D;transform-origin:0% 50%;transform:scaleX(0)"></span></span></span>` : ''}`)
    }

    // ── PAQUET 12 (#147) — LES QUATRE SCENES DECRITES PAR AXEL ────────────────
    // Décrites par lui, maquettées, montrées, validées le 30/07. `brickbuild`
    // (la main qui pose une brique, l'immeuble qui monte) a été écarté à la
    // maquette : la construction dit EFFORT alors que la phrase dit FACILE.
    case 'salesphone': {
      // Le téléphone est un VRAI téléphone : bezel, encoche, heure, fond d'écran.
      // Les notifications sont des bannières iOS — icône du sac, l'app qui envoie,
      // le libellé de la commande, et le montant à droite. C'est la matière qui
      // fait qu'on croit à l'écran ; trois rectangles ne vendent rien.
      // QUATRE notifications, jamais plus : Axel veut que ça s'emballe, pas que
      // l'écran déborde. Le rythme s'accélère (voir draftJs) et le compteur rouge
      // est COMPTÉ, il ne porte plus un « 3 » écrit dans le code.
      const ph = Math.round(f.h * 0.98), pw = Math.round(ph * 0.49)
      const px = Math.round((f.w - pw) / 2), r = Math.round(pw * 0.13)
      const amts = [txt(0, '+49 €'), txt(1, '+129 €'), txt(2, '+79 €'), txt(3, '+34 €')]
      const nw = Math.round(pw * 0.86), nx = Math.round((pw - nw) / 2)
      const nh = Math.round(nw * 0.25), ic = Math.round(nh * 0.56)
      let notes = ''
      for (let k = 0; k < 4; k++) {
        const y = Math.round(ph * 0.185) + k * Math.round(nh * 1.14)
        notes += `<span class="an-p an-sn" id="${id}sn${k}" style="left:${nx}px;top:${y}px;width:${nw}px;height:${nh}px;border-radius:${Math.round(nh * 0.3)}px;background:rgba(255,255,255,.94);box-shadow:0 10px 26px rgba(0,0,0,.22)">
          <span style="position:absolute;left:${Math.round(nh * 0.2)}px;top:${Math.round((nh - ic) / 2)}px;width:${ic}px;height:${ic}px;border-radius:${Math.round(ic * 0.28)}px;background:#5E8E3E;display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l-1.2 12H7.2zM9 7V5a3 3 0 016 0v2"/></svg></span>
          <span style="position:absolute;left:${Math.round(nh * 0.82)}px;top:${Math.round(nh * 0.22)}px;font-family:Inter,Helvetica,Arial,sans-serif;font-weight:700;font-size:${Math.round(nh * 0.19)}px;color:#111;letter-spacing:-.01em">Commande</span>
          <span style="position:absolute;left:${Math.round(nh * 0.82)}px;top:${Math.round(nh * 0.56)}px;width:${[30, 22, 26, 24][k]}%;height:${Math.max(3, Math.round(nh * 0.08))}px;border-radius:99px;background:#111;opacity:.24"></span>
          <span style="position:absolute;right:${Math.round(nh * 0.2)}px;top:50%;transform:translateY(-50%);font-family:'Archivo Black',Inter,sans-serif;font-size:${Math.round(nh * 0.25)}px;color:#5E8E3E;white-space:nowrap">${amts[k]}</span></span>`
      }
      // la pastille rouge du compteur, qui claque à chaque notification
      const bd = Math.round(pw * 0.17)
      return box(`<div class="an-ph" id="${id}ph" style="left:${px}px;top:${Math.round((f.h - ph) / 2)}px;width:${pw}px;height:${ph}px;border-radius:${r}px;background:#0B0B0D;border:${Math.max(3, Math.round(pw * 0.022))}px solid #26262B;overflow:hidden;box-shadow:0 28px 60px -18px rgba(0,0,0,.45)">
        <span style="position:absolute;inset:${Math.round(pw * 0.03)}px;border-radius:${Math.round(r * 0.86)}px;background:linear-gradient(165deg,#2A2F3A,#12141A 62%,#0B0B0D)"></span>
        <span style="position:absolute;left:50%;top:${Math.round(pw * 0.05)}px;transform:translateX(-50%);width:${Math.round(pw * 0.32)}px;height:${Math.round(pw * 0.09)}px;border-radius:99px;background:#000"></span>
        <span style="position:absolute;left:0;right:0;top:${Math.round(ph * 0.085)}px;text-align:center;font-family:Inter,Helvetica,Arial,sans-serif;font-weight:300;font-size:${Math.round(pw * 0.19)}px;color:#fff;letter-spacing:-.02em">9:41</span>
        <span class="an-p" id="${id}bdg" style="left:${Math.round(pw * 0.5 - bd / 2)}px;top:${Math.round(ph * 0.82)}px;width:${bd}px;height:${bd}px;border-radius:50%;background:#FF3B30;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-weight:800;font-size:${Math.round(bd * 0.56)}px;color:#fff">0</span>
        ${notes}
      </div>`)
    }

    // ── 2 · « une personne ouvre son ordinateur, clique une fois, le projet est
    //         terminé ». Remplace `brickbuild` : l'immeuble ne lui plaisait pas,
    //         et il avait raison — la métaphore de la construction dit « effort »,
    //         alors que la phrase dit « facile ». Ici le geste EST le propos :
    //         un clic, et c'est fait.
    case 'oneclick': {
      const sw = Math.round(f.w * 0.62), sh = Math.round(f.h * 0.44)
      const bw = Math.round(f.w * 0.74), bh = Math.round(f.h * 0.028)
      const y0 = Math.round((f.h - sh - bh) / 2)
      const sx = Math.round((f.w - sw) / 2), bx2 = Math.round((f.w - bw) / 2)
      const rad = Math.round(sw * 0.028)
      const pad = Math.round(sw * 0.055)

      // état 1 — l'application, avec son bouton. Trois lignes de contenu et une
      // barre de titre : sans matière, un écran blanc ne dit rien.
      const btnW = Math.round(sw * 0.42), btnH = Math.round(sh * 0.17)
      const ui1 = `<span class="an-p" id="${id}ui1" style="left:0;top:0;width:${sw}px;height:${sh}px">
        <span style="position:absolute;left:${pad}px;top:${pad}px;display:flex;gap:${Math.round(pad * 0.35)}px">
          ${['#FF5F57', '#FEBC2E', '#28C840'].map((c) => `<span style="width:${Math.round(pad * 0.42)}px;height:${Math.round(pad * 0.42)}px;border-radius:50%;background:${c};display:inline-block"></span>`).join('')}
        </span>
        ${[0, 1, 2].map((k) => `<span style="position:absolute;left:${pad}px;top:${Math.round(sh * (0.26 + k * 0.11))}px;width:${[62, 44, 52][k]}%;height:${Math.max(4, Math.round(sh * 0.035))}px;border-radius:99px;background:${P.ink};opacity:${[0.3, 0.18, 0.18][k]}"></span>`).join('')}
        <span id="${id}btn" style="position:absolute;left:${Math.round((sw - btnW) / 2)}px;top:${Math.round(sh * 0.66)}px;width:${btnW}px;height:${btnH}px;border-radius:${Math.round(btnH * 0.5)}px;background:${P.acc};display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-weight:800;font-size:${Math.round(btnH * 0.42)}px;color:#fff;letter-spacing:-.01em;box-shadow:0 ${Math.round(btnH * 0.2)}px ${Math.round(btnH * 0.5)}px -${Math.round(btnH * 0.18)}px rgba(255,90,54,.6)">Générer</span>
      </span>`

      // état 2 — le projet fini : la vignette du rendu, sa coche, sa durée.
      const vw = Math.round(sw * 0.34), vh = Math.round(vw * 1.5)
      const ui2 = `<span class="an-p" id="${id}ui2" style="left:0;top:0;width:${sw}px;height:${sh}px;opacity:0">
        <span style="position:absolute;left:${Math.round(sw * 0.1)}px;top:${Math.round((sh - vh) / 2)}px;width:${vw}px;height:${vh}px;border-radius:${Math.round(vw * 0.11)}px;background:linear-gradient(160deg,#3B4252,#15171D);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(0,0,0,.28)">
          <svg viewBox="0 0 24 24" width="26%" height="26%" fill="#FFFFFF"><path d="M8 5l11 7-11 7z"/></svg></span>
        <span style="position:absolute;left:${Math.round(sw * 0.1 + vw + sw * 0.07)}px;top:${Math.round(sh * 0.3)}px;width:${Math.round(sh * 0.17)}px;height:${Math.round(sh * 0.17)}px;border-radius:50%;background:#28A745;display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5L19 7"/></svg></span>
        <span style="position:absolute;left:${Math.round(sw * 0.1 + vw + sw * 0.07)}px;top:${Math.round(sh * 0.52)}px;font-family:Inter,sans-serif;font-weight:800;font-size:${Math.round(sh * 0.1)}px;color:${P.ink};letter-spacing:-.02em">Terminé</span>
        <span style="position:absolute;left:${Math.round(sw * 0.1 + vw + sw * 0.07)}px;top:${Math.round(sh * 0.68)}px;width:${Math.round(sw * 0.3)}px;height:${Math.max(4, Math.round(sh * 0.032))}px;border-radius:99px;background:#28A745"></span>
      </span>`

      // le curseur : une vraie flèche système, pas un rond. Il entre, il clique.
      const cs = Math.round(f.h * 0.075)
      const cur = `<span class="an-p" id="${id}cur" style="left:${sx + Math.round(sw * 0.5)}px;top:${y0 + Math.round(sh * 0.7)}px;width:${cs}px;height:${cs}px;opacity:0;z-index:6">
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="#111111" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"><path d="M5 2l14 8.5-6.2 1.4L10 20z"/></svg></span>`
      const halo = `<span class="an-p" id="${id}halo" style="left:${sx + Math.round((sw - btnW) / 2) - Math.round(btnW * 0.1)}px;top:${y0 + Math.round(sh * 0.66) - Math.round(btnH * 0.35)}px;width:${Math.round(btnW * 1.2)}px;height:${Math.round(btnH * 1.7)}px;border-radius:99px;border:3px solid ${P.acc};opacity:0"></span>`

      return box(`<span class="an-p" id="${id}wrap" style="left:${sx}px;top:${y0}px;width:${sw}px;height:${sh}px;perspective:1400px">
          <span class="an-p" id="${id}lid" style="left:0;top:0;width:${sw}px;height:${sh}px;border-radius:${rad}px ${rad}px 0 0;background:#FFFFFF;border:2px solid ${P.line};border-bottom:none;overflow:hidden;transform-origin:50% 100%;box-shadow:0 18px 40px -20px rgba(0,0,0,.35)">
            ${ui1}${ui2}
          </span>
        </span>
        <span class="an-p" id="${id}base" style="left:${bx2}px;top:${y0 + sh}px;width:${bw}px;height:${bh}px;border-radius:0 0 ${Math.round(bh * 0.9)}px ${Math.round(bh * 0.9)}px;background:linear-gradient(180deg,#E8E8ED,#C9C9D1)">
          <span style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:${Math.round(bw * 0.13)}px;height:${Math.round(bh * 0.34)}px;border-radius:0 0 99px 99px;background:rgba(17,17,17,.16)"></span></span>
        ${halo}${cur}`)
    }

    // ── ancienne version, remplacée à sa demande — gardée hors du switch
    case 'tsunami': {
      // Première version : trois `path` qui descendaient jusqu'au bas du cadre et
      // se recouvraient — résultat, un aplat orange, aucune vague. Ici la mer
      // n'occupe que le bas, et la vague est une VAGUE : une face qui monte, une
      // crête qui bascule, de l'écume dessus. Elle passe en trois temps, petite,
      // moyenne, immense — la même vague qui enfle, pas trois vagues côte à côte.
      // Le « numérique » est DANS la masse : des points de données emportés.
      // Rien n'est percuté : il n'y a rien d'autre dans le cadre.
      const w = f.w, h = f.h
      const seaY = Math.round(h * 0.86)
      const sea = `<rect x="0" y="${seaY}" width="${w}" height="${h - seaY}" fill="${P.acc}" opacity=".30"/>`

      const wave = (k, ampR, widR, op) => {
        const a = Math.round(h * ampR), v = Math.round(w * widR)
        const d = `M0 ${seaY}
          C ${(v * 0.22).toFixed(0)} ${(seaY - a * 0.12).toFixed(0)}, ${(v * 0.38).toFixed(0)} ${(seaY - a * 0.96).toFixed(0)}, ${(v * 0.62).toFixed(0)} ${(seaY - a).toFixed(0)}
          C ${(v * 0.81).toFixed(0)} ${(seaY - a * 1.03).toFixed(0)}, ${(v * 0.93).toFixed(0)} ${(seaY - a * 0.66).toFixed(0)}, ${(v * 0.79).toFixed(0)} ${(seaY - a * 0.46).toFixed(0)}
          C ${(v * 0.91).toFixed(0)} ${(seaY - a * 0.3).toFixed(0)}, ${(v * 0.97).toFixed(0)} ${(seaY - a * 0.12).toFixed(0)}, ${v} ${seaY} Z`
        // l'écume : un trait blanc épais qui suit la crête et le rouleau
        const fd = `M${(v * 0.30).toFixed(0)} ${(seaY - a * 0.6).toFixed(0)}
          C ${(v * 0.44).toFixed(0)} ${(seaY - a * 0.99).toFixed(0)}, ${(v * 0.72).toFixed(0)} ${(seaY - a * 1.06).toFixed(0)}, ${(v * 0.85).toFixed(0)} ${(seaY - a * 0.7).toFixed(0)}
          C ${(v * 0.9).toFixed(0)} ${(seaY - a * 0.54).toFixed(0)}, ${(v * 0.84).toFixed(0)} ${(seaY - a * 0.46).toFixed(0)}, ${(v * 0.79).toFixed(0)} ${(seaY - a * 0.46).toFixed(0)}`
        // `data-org` : l'origine du scale en coordonnées du viewBox, c'est-à-dire
        // LA LIGNE DE MER. Sans elle GSAP prend le centre de la bbox — et comme
        // la bbox est mesurée pendant que le scale change, il compense par une
        // translation résiduelle : la vague finissait à 242 px au-dessus de l'eau,
        // détachée. animJs n'a pas les dimensions, il lit donc l'attribut.
        return `<g class="an-wg" id="${id}wg${k}" opacity="${op}" data-org="${Math.round(v / 2)} ${seaY}">
          <path d="${d}" fill="${P.acc}"/>
          <path d="${fd}" fill="none" stroke="#FFFFFF" stroke-width="${Math.max(3, Math.round(a * 0.07))}" stroke-linecap="round" opacity=".85"/>
        </g>`
      }

      // les points de données, emportés dans la grande vague uniquement
      let dots = ''
      const aBig = Math.round(h * 0.62)
      for (let k = 0; k < 22; k++) {
        const dx = Math.round(w * (((k * 37) % 100) / 100) * 0.92)
        const dy = seaY - Math.round(aBig * (0.08 + ((k * 61) % 100) / 100 * 0.72))
        const dr = 3 + (k % 3) * 2
        dots += `<span class="an-p an-dt" id="${id}dt${k}" style="left:${dx}px;top:${dy}px;width:${dr * 2}px;height:${dr * 2}px;border-radius:50%;background:#FFFFFF;opacity:.8"></span>`
      }
      return box(`<svg class="an-p" id="${id}svg" style="left:0;top:0" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
          ${sea}
          ${wave(0, 0.13, 0.40, 0)}
          ${wave(1, 0.32, 0.68, 0)}
          ${wave(2, 0.62, 1.00, 0)}
        </svg>${dots}`)
    }

    // ── 4 · « une jauge 0 → 100 % pendant que des notifications de vente tombent »
    case 'gaugefill': {
      // La jauge est graduée (0 / 50 / 100) : sans graduations c'est un tube qui
      // se colore. Le chiffre est compté par le JS, il n'est jamais écrit en dur.
      //
      // Les graduations sont passées À GAUCHE de la jauge et le grand chiffre en
      // haut : à droite, il recouvrait le « 100 » — Axel l'a vu tout de suite.
      // Rien ne se superpose plus, chaque bloc a sa colonne.
      const gw = Math.round(f.w * 0.13), gh = Math.round(f.h * 0.80)
      const gx = Math.round(f.w * 0.17), gy = Math.round((f.h - gh) / 2)
      const rr = Math.round(gw * 0.46)
      let ticks = ''
      for (const t of [0, 0.5, 1]) {
        const ty = Math.round(gy + gh - t * gh)
        ticks += `<span class="an-p" style="left:${gx - Math.round(f.w * 0.055)}px;top:${ty - 2}px;width:${Math.round(f.w * 0.04)}px;height:4px;border-radius:99px;background:${P.ink};opacity:.3"></span>
          <span style="position:absolute;left:0;top:${ty - Math.round(f.w * 0.026)}px;width:${gx - Math.round(f.w * 0.068)}px;text-align:right;font-family:Inter,sans-serif;font-weight:700;font-size:${Math.round(f.w * 0.045)}px;color:${P.ink};opacity:.45">${Math.round(t * 100)}</span>`
      }
      const pct = txt(0, '100 %')
      // QUATRE ventes, et elles tombent au fur et à mesure que la jauge monte :
      // « plus ça monte, plus il y en a », mais jamais plus de quatre.
      const cw = Math.round(f.w * 0.58), cx = f.w - cw
      const ch = Math.round(f.h * 0.155)
      const amts4 = [txt(1, '+49 €'), txt(2, '+129 €'), txt(3, '+79 €'), txt(4, '+34 €')]
      let cards = ''
      for (let k = 0; k < 4; k++) {
        const cy = Math.round(f.h * 0.21) + k * Math.round(ch * 1.24)
        cards += `<span class="an-p an-gs" id="${id}gs${k}" style="left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${Math.round(ch * 0.3)}px;background:#FFFFFF;border:2px solid ${P.line};box-shadow:0 10px 24px rgba(0,0,0,.16)">
          <span style="position:absolute;left:${Math.round(ch * 0.24)}px;top:50%;transform:translateY(-50%);width:${Math.round(ch * 0.5)}px;height:${Math.round(ch * 0.5)}px;border-radius:${Math.round(ch * 0.16)}px;background:${P.acc};display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h15l-1.5 9h-12zM6 6L5 3H2"/></svg></span>
          <span style="position:absolute;left:${Math.round(ch * 0.88)}px;top:${Math.round(ch * 0.3)}px;width:${[52, 40, 60, 46][k]}%;height:${Math.max(3, Math.round(ch * 0.1))}px;border-radius:99px;background:${P.ink};opacity:.32"></span>
          <span style="position:absolute;left:${Math.round(ch * 0.88)}px;top:${Math.round(ch * 0.56)}px;font-family:'Archivo Black',Inter,sans-serif;font-size:${Math.round(ch * 0.28)}px;color:${P.acc}">${amts4[k]}</span></span>`
      }
      return box(`<span class="an-p" style="left:${gx}px;top:${gy}px;width:${gw}px;height:${gh}px;border-radius:${rr}px;background:${P.soft};border:2px solid ${P.line}"></span>
        <span class="an-p" id="${id}gfill" style="left:${gx}px;top:${gy}px;width:${gw}px;height:${gh}px;border-radius:${rr}px;background:${P.acc};transform-origin:50% 100%"></span>
        ${ticks}
        <span class="an-t" id="${id}gnum" style="top:${Math.round(f.h * 0.035)}px;left:${Math.round(f.w * 0.34)}px;right:0;transform:none;font-family:'Archivo Black',Inter,sans-serif;font-size:${Math.round(f.h * 0.135)}px;color:${P.ink};text-align:center" data-pct="${pct}">0 %</span>
        ${cards}`)
    }
  }
}

// animJs ne reçoit ni W ni H : impossible d'y écrire une distance en pixels sans
// la deviner (les valeurs « 1920 × 0,06 » du paquet 2 étaient fausses dès qu'une
// composition changeait de taille). Ces deux aides émettent du code qui MESURE le
// cadre au moment du rendu — GSAP accepte une fonction comme valeur cible.
const FRAME = (id) => `document.getElementById('${id}an').getBoundingClientRect()`
const FH = (id, ratio) => `()=>${FRAME(id)}.height*${ratio}`
const FW = (id, ratio) => `()=>${FRAME(id)}.width*${ratio}`

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
      tl.to('#${id}ql',{autoAlpha:0,duration:0.2},${r2(t0 + 0.42 + Math.max(0.6, dur - 0.9))});
      // la mention se pose UNE FOIS le balayage fini : elle nomme ce qu'on vient de voir
      tl.fromTo('#${id}qb',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.42 + Math.max(0.6, dur - 0.9) - 0.15)});`
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
    case 'deadline':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:40,autoAlpha:0},{y:0,autoAlpha:1,duration:0.4,ease:'power3.out'},${t0});
      tl.fromTo('#${id}dl',{scale:1},{scale:1.55,duration:0.34,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.45)});
      tl.to('#${id}dl',{scale:1.35,duration:0.28,yoyo:true,repeat:3,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.8)});`
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
    case 'free':
      return inOut + `
      tl.fromTo('#${id}fp',{y:-14,autoAlpha:0},{y:0,autoAlpha:0.55,duration:0.26,ease:'power2.out'},${t0});
      tl.fromTo('#${id}fb',{scaleX:0},{scaleX:1,duration:0.24,ease:'power3.inOut'},${r2(t0 + 0.32)});
      tl.to('#${id}fp',{autoAlpha:0.28,duration:0.2},${r2(t0 + 0.5)});
      tl.fromTo('#${id}fr',{scale:0.3,rotation:-24,autoAlpha:0},{scale:1,rotation:-7,autoAlpha:1,duration:0.44,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.5)});
      tl.to('#${id}fr',{rotation:-4,duration:${r2(Math.max(0.4, dur - 1.3))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.98)});`
    case 'plan':
      return inOut + `
      tl.fromTo('#${id}pl0',{y:50,autoAlpha:0},{y:0,autoAlpha:1,duration:0.34,ease:'power3.out'},${t0});
      tl.fromTo('#${id}pl2',{y:50,autoAlpha:0},{y:0,autoAlpha:1,duration:0.34,ease:'power3.out'},${r2(t0 + 0.1)});
      tl.fromTo('#${id}pl1',{y:70,scale:0.9,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.42,ease:'back.out(1.8)',transformOrigin:'50% 50%'},${r2(t0 + 0.22)});
      tl.to('#${id}pl1',{scale:1.05,duration:${r2(Math.max(0.4, dur - 1))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.68)});`
    case 'layers':
      return inOut + `
      tl.fromTo('#${id}an .an-ly',{y:-50,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,stagger:0.13,ease:'back.out(1.8)'},${t0});
      tl.to('#${id}ly1',{scale:1.05,duration:${r2(Math.max(0.4, dur - 1.1))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.75)});`
    case 'badge':
      return inOut + `
      tl.fromTo('#${id}bg',{scale:0.3,rotation:-40,autoAlpha:0},{scale:1,rotation:0,autoAlpha:1,duration:0.44,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${t0});
      (function(){ var p=document.querySelector('#${id}bc path');
        if(p&&p.getTotalLength){var L=p.getTotalLength();p.style.strokeDasharray=L+' '+L;p.style.strokeDashoffset=L;} })();
      tl.to('#${id}bc path',{strokeDashoffset:0,duration:0.34,ease:'power2.out'},${r2(t0 + 0.4)});
      tl.to('#${id}bg',{scale:1.07,duration:${r2(Math.max(0.4, dur - 1))},ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.75)});`
    case 'trend':
      return inOut + `
      tl.fromTo('#${id}an .an-tr',{scaleY:0},{scaleY:1,duration:0.26,stagger:0.075,ease:'back.out(1.5)'},${t0});
      tl.fromTo('#${id}tl',{strokeDashoffset:1},{strokeDashoffset:0,duration:0.5,ease:'power2.out'},${r2(t0 + 0.3)});
      tl.fromTo('#${id}ta',{autoAlpha:0},{autoAlpha:1,duration:0.2,ease:'power2.out'},${r2(t0 + 0.74)});
      tl.fromTo('#${id}tp',{scale:0.5,y:${FH(id, 0.06)},autoAlpha:0},{scale:1,y:0,autoAlpha:1,duration:0.32,ease:'back.out(2.2)'},${r2(t0 + 0.86)});
      tl.fromTo('#${id}tn',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.28,ease:'back.out(2.4)'},${r2(t0 + 0.92)});`
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
    case 'idea': {
      // Sa vie entière tenait en 0,94 s : au-delà, le bloc restait un carré
      // orange statique — vu 2,8 s durant sur l'intro du 31/07, exactement
      // l'aplat qu'Axel bannit (« si ça tient sur une image fixe… »). Quand la
      // fenêtre est plus longue, le bloc RESPIRE : une pulsation lente, autant
      // de cycles que la durée en laisse. Déterministe (repeat calculé), pas
      // de nouveau design — juste l'empêcher de mourir à l'écran.
      const rep = Math.max(0, Math.floor((dur - 1.3) / 1.6) * 2)
      return inOut + `
      tl.fromTo('#${id}an .an-bit', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, stagger: 0.05, ease: 'power2.out', transformOrigin: '50% 50%' }, ${t0});
      tl.to('#${id}an .an-bit', { left: '50%', top: '50%', scale: 0.2, autoAlpha: 0, duration: 0.36, stagger: 0.04, ease: 'power2.in' }, ${r2(t0 + 0.34)});
      tl.fromTo('#${id}co', { scale: 0.2, autoAlpha: 0, rotation: -25 }, { scale: 1, autoAlpha: 1, rotation: 0, duration: 0.34, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.6)});` + (rep ? `
      tl.to('#${id}co', { scale: 1.07, rotation: 4, duration: 0.8, yoyo: true, repeat: ${rep}, ease: 'sine.inOut', transformOrigin: '50% 50%' }, ${r2(t0 + 1.1)});` : '')
    }
    case 'target':
      return inOut + `
      tl.fromTo('#${id}dot', { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${t0});
      tl.to('#${id}ring', { strokeDashoffset: 0, duration: ${r2(Math.max(0.6, dur - 0.7))}, ease: 'power2.inOut' }, ${r2(t0 + 0.16)});
      tl.to('#${id}dot', { scale: 1.35, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out', transformOrigin: '50% 50%' }, ${r2(end - 0.5)});`
    case 'search':
      return inOut + `
      tl.fromTo('#${id}an .an-sl2', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01, stagger: 0.055 }, ${t0});
      tl.fromTo('#${id}ty', { autoAlpha: 1 }, { autoAlpha: 0.15, duration: 0.24, repeat: 4, yoyo: true }, ${t0});
      tl.to('#${id}ty', { autoAlpha: 0, duration: 0.12 }, ${r2(t0 + 0.72)});
      tl.fromTo('#${id}an .an-res', { yPercent: -40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.3, stagger: 0.1, ease: 'power2.out' }, ${r2(t0 + 0.78)});`
    case 'rocket':
      return inOut + `
      tl.fromTo('#${id}tr', { strokeDashoffset: 180 }, { strokeDashoffset: 0, duration: ${r2(Math.max(0.6, dur - 0.6))}, ease: 'power2.inOut' }, ${t0});
      tl.fromTo('#${id}an .an-rk', { scale: 0.3, autoAlpha: 0 }, { scale: 1.15, autoAlpha: 0.5, duration: 0.4, stagger: 0.13, ease: 'power2.out', transformOrigin: '50% 50%' }, ${r2(t0 + 0.2)});
      tl.to('#${id}an .an-rk', { autoAlpha: 0, duration: 0.4, stagger: 0.13 }, ${r2(t0 + 0.6)});
      tl.fromTo('#${id}hd', { x: ${FW(id, -0.5)}, y: ${FH(id, 0.5)}, scale: 0.4, autoAlpha: 0 }, { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: ${r2(Math.max(0.5, dur - 0.7))}, ease: 'power2.out' }, ${t0});`
    case 'daypart':
      return inOut + `
      tl.fromTo('#${id}an .an-cr', { scaleX: 0.2, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.22, stagger: 0.05, ease: 'power2.out', transformOrigin: '0% 50%' }, ${t0});
      tl.fromTo('#${id}c4', { scale: 1 }, { scale: 1.08, duration: 0.2, yoyo: true, repeat: 1, ease: 'power2.inOut', transformOrigin: '50% 50%' }, ${r2(t0 + 0.7)});
      tl.fromTo('#${id}c5', { scale: 1 }, { scale: 1.08, duration: 0.2, yoyo: true, repeat: 1, ease: 'power2.inOut', transformOrigin: '50% 50%' }, ${r2(t0 + 0.76)});
      tl.fromTo('#${id}lb', { y: ${FH(id, 0.05)}, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: 'back.out(2)' }, ${r2(t0 + 0.8)});`
    case 'blankfill':
      return inOut + `
      tl.fromTo('#${id}an .an-cd', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, stagger: 0.11, ease: 'back.out(1.9)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.15)});`
    case 'easyup':
    case 'easydown': {
      // v2 : la courbe se DESSINE (dash mesure a l'execution), l'aire suit, le
      // point la parcourt via getPointAtLength (deterministe au seek), les
      // jalons claquent a leur tour de passage.
      const trace = r2(Math.min(2.2, Math.max(1.2, dur * 0.62)))
      return inOut + `
      (function(){ var p = document.getElementById('${id}line');
        if (p && p.getTotalLength) { var L = p.getTotalLength();
          p.style.strokeDasharray = L + ' ' + L; p.style.strokeDashoffset = L;
          tl.to(p, { strokeDashoffset: 0, duration: ${trace}, ease: 'power1.inOut' }, ${r2(t0 + 0.25)});
          var mv = { t: 0 }, dot = document.getElementById('${id}dot'), bdg = document.getElementById('${id}bdg');
          tl.to(mv, { t: 1, duration: ${trace}, lazy: false, ease: 'power1.inOut', onUpdate: function(){
            var pt = p.getPointAtLength(L * mv.t);
            if (dot) { dot.style.left = (pt.x - 11) + 'px'; dot.style.top = (pt.y - 11) + 'px'; }
            if (bdg) { bdg.style.left = (pt.x - 26) + 'px'; bdg.style.top = (pt.y - 64) + 'px'; }
          } }, ${r2(t0 + 0.25)}); } })();
      tl.fromTo('#${id}dot', { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.22, ease: 'back.out(2)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.2)});
      tl.fromTo('#${id}bdg', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.26, ease: 'back.out(1.8)' }, ${r2(t0 + 0.4)});
      tl.fromTo('#${id}area', { opacity: 0 }, { opacity: 0.14, duration: ${trace}, ease: 'power1.inOut' }, ${r2(t0 + 0.3)});
      tl.fromTo('#${id}j0', { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.25 + trace * 0.24)});
      tl.fromTo('#${id}j1', { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.25 + trace * 0.62)});
      tl.fromTo('#${id}j2', { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.25 + trace * 0.85)});
      tl.to('#${id}dot', { scale: 1.25, duration: 0.3, yoyo: true, repeat: 1, ease: 'sine.inOut', transformOrigin: '50% 50%' }, ${r2(t0 + 0.35 + trace)});`
    }
    case 'lowcost':
      return inOut + `
      tl.fromTo('#${id}an .an-bar', { scaleY: 0, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.32, stagger: 0.1, ease: 'power2.out' }, ${t0});
      tl.fromTo('#${id}cv', { strokeDashoffset: 900 }, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.inOut' }, ${r2(t0 + 0.3)});
      tl.fromTo('#${id}co', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.9)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.75)});`
    case 'twopaths':
      return inOut + `
      tl.fromTo('#${id}an .an-fl', { y: ${FH(id, -0.06)}, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, stagger: 0.045, ease: 'power2.out' }, ${t0});
      tl.fromTo('#${id}so', { y: ${FH(id, -0.06)}, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: 'power2.out' }, ${r2(t0 + 0.45)});`
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
      // ⚠ MEME SOURCE QUE LE HTML. Le HTML cherchait le nombre dans value, center
      // ou title ; le JS ne lisait que `value`. Avec « 100 » dans center et
      // « % DE BENEFIC » dans value, le compteur animait donc de 0 vers 0 — un
      // gros 0 affiché pendant qu'Axel disait « cent pour cent des bénéfices ».
      const source = [s.value, s.center, s.title, (s.items || [])[0] && (s.items || [])[0].text]
        .map((x) => String(x == null ? '' : x)).find((x) => /\d/.test(x)) || ''
      const raw = source.replace(/[^0-9.]/g, '')
      const target = parseFloat(raw) || 0
      const dec = (source.split('.')[1] || '').length
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
    case 'lineup': {
      // chaque carte ARRIVE sur le mot de son item (it.t du plan) ; sans
      // timing, cascade régulière. La bulle du coach et la barre du cours
      // s'animent après l'arrivée : la scène continue de vivre.
      const its = (s.items || [])
      const n = Math.max(2, Math.min(4, its.length || 3))
      let js = inOut
      for (let k = 0; k < n; k++) {
        const tk = r2(Math.min(end - 0.5, Math.max(t0 + 0.15 + k * 0.05, Number(its[k] && its[k].t) || (t0 + 0.3 + k * 0.85))))
        const kind = lineupKind(its[k] && its[k].text, k)
        js += `
      tl.fromTo('#${id}l${k}', { y: 64, scale: 0.6, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(2)', transformOrigin: '50% 100%' }, ${tk});
      tl.fromTo('#${id}l${k}ck', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, ${r2(tk + 0.3)});`
        // la micro-vie de chaque variante, APRÈS l'arrivée : la scène continue
        if (kind === 'personne') js += `
      tl.fromTo('#${id}l${k}bub', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.24, ease: 'back.out(2.4)', transformOrigin: '80% 100%' }, ${r2(tk + 0.42)});`
        if (kind === 'cours') js += `
      tl.to('#${id}l${k}bar', { scaleX: 1, duration: 1.2, ease: 'power1.inOut' }, ${r2(tk + 0.35)});`
        if (kind === 'calque') js += `
      tl.fromTo('#${id}l${k}mv', { x: -10, y: 6 }, { x: 6, y: -4, duration: 0.5, yoyo: true, repeat: 1, ease: 'sine.inOut' }, ${r2(tk + 0.4)});`
        if (kind === 'son') js += `
      tl.fromTo('#${id}l${k}w1', { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.2, ease: 'back.out(2)', transformOrigin: '0% 50%' }, ${r2(tk + 0.38)});
      tl.fromTo('#${id}l${k}w2', { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.2, ease: 'back.out(2)', transformOrigin: '0% 50%' }, ${r2(tk + 0.52)});`
        if (kind === 'transition') js += `
      tl.fromTo('#${id}l${k}sl', { x: -Math.round(18) }, { x: 8, duration: 0.45, ease: 'power2.inOut' }, ${r2(tk + 0.4)});`
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
      tl.fromTo('#${id}an .an-fn', { scaleX: 0.2, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.28, stagger: 0.24, ease: 'back.out(1.6)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-fd0', { y: 0, autoAlpha: 0 }, { y: ${FH(id, 0.11)}, autoAlpha: 1, duration: 0.26, stagger: 0.03, ease: 'power1.in' }, ${r2(t0 + 0.24)});
      tl.to('#${id}an .an-fd0', { autoAlpha: 0, duration: 0.12, stagger: 0.03 }, ${r2(t0 + 0.46)});
      tl.fromTo('#${id}an .an-fd1', { y: 0, autoAlpha: 0 }, { y: ${FH(id, 0.11)}, autoAlpha: 1, duration: 0.26, stagger: 0.04, ease: 'power1.in' }, ${r2(t0 + 0.5)});
      tl.to('#${id}an .an-fd1', { autoAlpha: 0, duration: 0.12, stagger: 0.04 }, ${r2(t0 + 0.72)});`
    case 'orbit':
      return inOut + `
      tl.fromTo('#${id}c', { scale: 0.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${t0});
      tl.fromTo('#${id}an .an-sat', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, stagger: 0.09, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t0 + 0.22)});
      tl.fromTo('#${id}o', { rotation: 0, autoAlpha: 0 }, { rotation: 120, autoAlpha: 1, duration: ${r2(Math.max(0.9, dur - 0.4))}, ease: 'none', transformOrigin: '50% 50%' }, ${r2(t0 + 0.2)});`
    case 'bars2':
      return inOut + `
      tl.fromTo('#${id}an .an-b2', { scaleY: 0, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.5, stagger: 0.2, ease: 'power3.out', transformOrigin: '50% 100%' }, ${t0});`
    case 'engage':
      return inOut + `
      tl.fromTo('#${id}an .an-bub', { xPercent: -30, autoAlpha: 0 }, { xPercent: 0, autoAlpha: 1, duration: 0.3, stagger: 0.12, ease: 'back.out(1.6)' }, ${t0});
      tl.fromTo('#${id}an .an-hrt', { yPercent: 60, autoAlpha: 0, scale: 0.4 }, { yPercent: -90, autoAlpha: 1, scale: 1, duration: 0.7, stagger: 0.13, ease: 'power2.out' }, ${r2(t0 + 0.24)});`
    case 'calendar':
      return inOut + `
      tl.fromTo('#${id}an .an-cell', { scale: 0.2, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.22, stagger: 0.035, ease: 'back.out(2.2)', transformOrigin: '50% 50%' }, ${t0});`
    case 'upload':
      return inOut + `
      tl.fromTo('#${id}uz', { scale: 0.94, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'power2.out' }, ${t0});
      tl.fromTo('#${id}uc', { y: ${FH(id, -0.14)}, rotation: -7, autoAlpha: 0 }, { y: 0, rotation: 0, autoAlpha: 1, duration: 0.3, ease: 'power2.out' }, ${r2(t0 + 0.12)});
      tl.to('#${id}uc', { y: ${FH(id, 0.4)}, scale: 0.78, duration: 0.42, ease: 'power2.in' }, ${r2(t0 + 0.46)});
      tl.to('#${id}uc', { autoAlpha: 0, duration: 0.14 }, ${r2(t0 + 0.8)});
      tl.fromTo('#${id}ub', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16 }, ${r2(t0 + 0.72)});
      tl.to('#${id}ubf', { scaleX: 1, duration: 0.5, ease: 'power1.inOut' }, ${r2(t0 + 0.78)});
      tl.fromTo('#${id}uk', { scale: 0.4, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.28, ease: 'back.out(2.6)', transformOrigin: '50% 50%' }, ${r2(t0 + 1.22)});`
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
    // ── PAQUET 3 (#157) — les gestes du montage ──
    case 'dropzone':
      return inOut + `
      tl.fromTo('#${id}dz',{scale:0.9,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'power3.out',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}df',{y:${FH(id, -0.62)},rotation:-8,autoAlpha:0},{y:0,rotation:0,autoAlpha:1,duration:0.5,ease:'back.out(1.5)'},${r2(t0 + 0.24)});
      tl.fromTo('#${id}dz',{scale:1},{scale:1.05,duration:0.16,yoyo:true,repeat:1,ease:'sine.out',transformOrigin:'50% 50%'},${r2(t0 + 0.7)});`
    case 'render': {
      const T = r2(Math.max(0.7, dur - 0.3))
      // Le compteur est ECRIT PAS A PAS, comme celui de `countup` : un rendu
      // image par image doit etre reproductible, ce qu'un onUpdate ne serait pas.
      // Meme courbe que la barre (power1.inOut) pour qu'ils arrivent ensemble.
      let js = inOut + `
      tl.fromTo('#${id}rv',{scaleY:0},{scaleY:1,duration:${T},ease:'power1.inOut'},${r2(t0 + 0.15)});
      tl.fromTo('#${id}rp',{autoAlpha:0,y:${FH(id, 0.03)}},{autoAlpha:1,y:0,duration:0.24,ease:'power2.out'},${r2(t0 + 0.1)});
      tl.fromTo('#${id}rb',{scaleX:0},{scaleX:1,duration:${T},ease:'power1.inOut'},${r2(t0 + 0.15)});`
      const steps = 24
      for (let k = 1; k <= steps; k++) {
        const u = k / steps
        // l'inverse de power1.inOut, pour que le nombre colle a la barre
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
        js += `
      tl.set('#${id}rn',{ textContent: ${JSON.stringify(String(Math.round(e * 100)))} },${r2(t0 + 0.15 + T * u)});`
      }
      // 100 % ATTEINT : la pastille claque. C'est le moment qui vend.
      js += `
      tl.fromTo('#${id}rp',{scale:1},{scale:1.16,duration:0.14,yoyo:true,repeat:1,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.15 + T)});`
      return js
    }
    case 'crop':
      // le cadre 16:9 se resserre sur la colonne 9:16 — dimensions lues sur le
      // cadre réel plutôt que devinées : animJs ne connaît pas la composition.
      return inOut + `
      tl.fromTo('#${id}cm',{autoAlpha:0,scale:0.92},{autoAlpha:1,scale:1,duration:0.32,ease:'back.out(1.6)'},${t0});
      tl.to('#${id}cm',{width:()=>${FRAME(id)}.height*0.54,height:()=>${FRAME(id)}.height*0.96,left:()=>(${FRAME(id)}.width-${FRAME(id)}.height*0.54)/2,top:()=>${FRAME(id)}.height*0.02,duration:0.52,ease:'power3.inOut'},${r2(t0 + 0.52)});`
    case 'silence':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.26,ease:'power2.out'},${t0});
      tl.to('#${id}sg',{scaleX:1.06,duration:0.18,yoyo:true,repeat:1,ease:'sine.inOut'},${r2(t0 + 0.34)});
      tl.to('#${id}sg',{scaleX:0,autoAlpha:0,duration:0.3,ease:'power3.in'},${r2(t0 + 0.72)});
      tl.to('#${id}sr',{xPercent:-40,duration:0.34,ease:'power3.inOut'},${r2(t0 + 0.8)});`
    case 'chat':
      return inOut + `
      tl.fromTo('#${id}cq',{x:60,autoAlpha:0},{x:0,autoAlpha:1,duration:0.28,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}an .an-cq2',{autoAlpha:0},{autoAlpha:1,duration:0.01,stagger:0.035},${r2(t0 + 0.24)});
      tl.fromTo('#${id}cqc',{autoAlpha:1},{autoAlpha:0.1,duration:0.24,repeat:4,yoyo:true},${r2(t0 + 0.24)});
      tl.to('#${id}cqc',{autoAlpha:0,duration:0.1},${r2(t0 + 0.86)});
      tl.fromTo('#${id}ca',{x:-50,autoAlpha:0},{x:0,autoAlpha:1,duration:0.32,ease:'power3.out'},${r2(t0 + 0.9)});
      tl.fromTo(['#${id}cl0','#${id}cl1','#${id}cl2'],{scaleX:0},{scaleX:1,duration:0.2,stagger:0.11,ease:'power2.out'},${r2(t0 + 1.1)});`
    case 'dashboard':
      return inOut + `
      tl.fromTo('#${id}dp',{scale:0.92,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}an .an-dt',{y:22,autoAlpha:0},{y:0,autoAlpha:1,duration:0.28,stagger:0.1,ease:'back.out(2)'},${r2(t0 + 0.26)});
      tl.fromTo('#${id}dl',{strokeDashoffset:1},{strokeDashoffset:0,duration:${r2(Math.max(0.55, dur * 0.5))},ease:'power2.out'},${r2(t0 + 0.5)});`
    case 'translate':
      return inOut + `
      tl.fromTo('#${id}g1',{y:-26,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'power3.out'},${t0});
      tl.fromTo('#${id}ga',{y:-14,autoAlpha:0},{y:0,autoAlpha:1,duration:0.26,ease:'power2.out'},${r2(t0 + 0.36)});
      tl.fromTo('#${id}g2',{y:26,scale:0.94,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.36,ease:'back.out(1.8)'},${r2(t0 + 0.56)});`
    case 'bgswap':
      return inOut + `
      tl.fromTo('#${id}bs',{y:30,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,ease:'power3.out'},${t0});
      tl.fromTo('#${id}bh',{y:30,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,ease:'power3.out'},${t0});
      tl.fromTo('#${id}bg',{scaleX:0},{scaleX:1,duration:0.5,ease:'power3.inOut'},${r2(t0 + 0.42)});
      tl.to('#${id}bs',{scale:1.03,duration:0.2,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 100%'},${r2(t0 + 0.86)});`
    case 'hook':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,ease:'power2.out'},${t0});
      tl.fromTo('#${id}hk',{scaleX:0},{scaleX:1,duration:0.34,ease:'power3.out'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}hl',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(2.6)',transformOrigin:'50% 100%'},${r2(t0 + 0.44)});
      tl.fromTo('#${id}hc',{x:0},{x:()=>document.getElementById('${id}hk').offsetWidth,duration:0.46,ease:'power2.inOut'},${r2(t0 + 0.24)});`
    case 'export':
      return inOut + `
      tl.fromTo('#${id}xc',{scale:0.88,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(1.7)'},${t0});
      tl.fromTo('#${id}xa',{y:-14,autoAlpha:0},{y:0,autoAlpha:1,duration:0.26,ease:'power2.out'},${r2(t0 + 0.38)});
      tl.to('#${id}xa',{y:10,duration:0.3,yoyo:true,repeat:2,ease:'sine.inOut'},${r2(t0 + 0.6)});
      tl.fromTo('#${id}xf',{y:22,autoAlpha:0},{y:0,autoAlpha:1,duration:0.34,ease:'back.out(2)'},${r2(t0 + 0.62)});`
    case 'checklist':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{x:-24,autoAlpha:0},{x:0,autoAlpha:1,duration:0.26,stagger:0.04,ease:'power3.out'},${t0});
      ${[0, 1, 2, 3].map((k) => `tl.fromTo('#${id}ck${k}',{scale:0},{scale:1,duration:0.26,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.4 + k * 0.16)});`).join('\n      ')}`
    // ── PAQUET 4 (#157) ──
    case 'library':
      return inOut + `
      tl.fromTo('#${id}an .an-lb',{scale:0.7,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,stagger:{each:0.06,from:'start'},ease:'back.out(2)',transformOrigin:'50% 50%'},${t0});
      tl.to('#${id}lb4',{scale:1.12,duration:0.28,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${r2(t0 + 0.62)});`
    case 'queue':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{x:-20,autoAlpha:0},{x:0,autoAlpha:1,duration:0.26,stagger:0.03,ease:'power3.out'},${t0});
      tl.fromTo('#${id}an .an-qd',{scale:0},{scale:1,duration:0.24,stagger:0.17,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.34)});`
    case 'notif':
      return inOut + `
      tl.fromTo('#${id}an .an-nb',{y:${FH(id, -0.14)},autoAlpha:0},{y:0,autoAlpha:1,duration:0.34,stagger:0.16,ease:'back.out(1.7)'},${r2(t0 + 0.1)});
      tl.to('#${id}nb0',{scale:1.03,duration:0.18,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.5)});`
    case 'comments':
      return inOut + `
      tl.fromTo('#${id}an .an-cm',{x:-26,autoAlpha:0},{x:0,autoAlpha:1,duration:0.3,stagger:0.13,ease:'power3.out'},${t0});
      tl.to('#${id}cmw',{y:${FH(id, -0.2)},duration:${r2(Math.max(0.7, dur - 0.4))},ease:'none'},${r2(t0 + 0.5)});`
    case 'timeline':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,stagger:0.04,ease:'power2.out'},${t0});
      tl.fromTo('#${id}tp',{x:0},{x:()=>document.getElementById('${id}an').getBoundingClientRect().width*0.9,duration:${r2(Math.max(0.8, dur - 0.3))},ease:'none'},${r2(t0 + 0.3)});`
    case 'results':
      return inOut + `
      tl.fromTo('#${id}rq',{scaleX:0},{scaleX:1,duration:0.34,ease:'steps(9)'},${t0});
      tl.fromTo('#${id}an .an-rs',{y:18,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,stagger:0.11,ease:'back.out(1.8)'},${r2(t0 + 0.42)});`
    case 'profile':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:16,autoAlpha:0},{y:0,autoAlpha:1,duration:0.28,stagger:0.05,ease:'power3.out'},${t0});
      tl.fromTo('#${id}pc',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.36,ease:'back.out(2.6)'},${r2(t0 + 0.3)});
      tl.fromTo('#${id}an .an-pg',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,stagger:0.05,ease:'back.out(2)',transformOrigin:'50% 50%'},${r2(t0 + 0.44)});`
    case 'invoice':
      return inOut + `
      tl.fromTo('#${id}an .an-iv',{scaleX:0,autoAlpha:0},{scaleX:1,autoAlpha:1,duration:0.22,stagger:0.07,ease:'power2.out',transformOrigin:'0% 50%'},${r2(t0 + 0.18)});
      tl.fromTo('#${id}it',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(2.6)',transformOrigin:'100% 50%'},${r2(t0 + 0.66)});`
    case 'settings':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{x:-18,autoAlpha:0},{x:0,autoAlpha:1,duration:0.26,stagger:0.03,ease:'power3.out'},${t0});
      ${[0, 1, 2].map((k) => `tl.to('#${id}sb${k}',{backgroundColor:'${'#'}FF5A1F',duration:0.22,ease:'power2.out'},${r2(t0 + 0.42 + k * 0.2)});
      tl.to('#${id}st${k}',{x:()=>document.getElementById('${id}sb${k}').offsetWidth-document.getElementById('${id}st${k}').offsetWidth-(document.getElementById('${id}st${k}').offsetLeft*2),duration:0.26,ease:'back.out(2)'},${r2(t0 + 0.42 + k * 0.2)});`).join('\n      ')}`
    case 'versus':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,ease:'power2.out'},${t0});
      tl.fromTo('#${id}an .an-vs',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.09,ease:'back.out(2.4)',transformOrigin:'0% 50%'},${r2(t0 + 0.28)});`
    case 'thumb':
      return inOut + `
      tl.fromTo('#${id}tb',{scale:0.88,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(1.8)'},${t0});
      tl.to('#${id}tp2',{scale:1.16,duration:0.26,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.4)});
      tl.fromTo('#${id}tv',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(2.6)'},${r2(t0 + 0.52)});`
    case 'leaderboard':
      return inOut + `
      tl.fromTo('#${id}an .an-ld',{x:-22,autoAlpha:0},{x:0,autoAlpha:1,duration:0.28,stagger:0.08,ease:'power3.out'},${t0});
      tl.to('#${id}ld3',{y:()=>-(document.getElementById('${id}ld3').getBoundingClientRect().top-document.getElementById('${id}ld0').getBoundingClientRect().top),duration:0.46,ease:'power3.inOut'},${r2(t0 + 0.6)});
      tl.to(['#${id}ld0','#${id}ld1','#${id}ld2'],{y:()=>document.getElementById('${id}ld1').getBoundingClientRect().top-document.getElementById('${id}ld0').getBoundingClientRect().top,duration:0.46,ease:'power3.inOut'},${r2(t0 + 0.6)});`
    case 'pay':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:18,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,ease:'power3.out'},${t0});
      tl.fromTo('#${id}pk',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.66)});
      tl.to('#${id}pb',{scale:0.96,duration:0.14,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.48)});`
    case 'sales':
      return inOut + `
      tl.fromTo('#${id}an .an-sl',{x:${FW(id, 0.5)},autoAlpha:0},{x:0,autoAlpha:1,duration:0.36,stagger:0.19,ease:'back.out(1.6)'},${r2(t0 + 0.1)});`
    case 'folder':
      return inOut + `
      tl.fromTo('#${id}fb',{scale:0.8,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(1.9)',transformOrigin:'50% 100%'},${t0});
      tl.fromTo('#${id}fd0',{y:0,x:0,rotation:0,autoAlpha:0},{y:${FH(id, -0.3)},x:${FW(id, -0.26)},rotation:-16,autoAlpha:1,duration:0.42,ease:'back.out(1.5)'},${r2(t0 + 0.3)});
      tl.fromTo('#${id}fd1',{y:0,x:0,rotation:0,autoAlpha:0},{y:${FH(id, -0.38)},x:0,rotation:0,autoAlpha:1,duration:0.42,ease:'back.out(1.5)'},${r2(t0 + 0.38)});
      tl.fromTo('#${id}fd2',{y:0,x:0,rotation:0,autoAlpha:0},{y:${FH(id, -0.3)},x:${FW(id, 0.26)},rotation:16,autoAlpha:1,duration:0.42,ease:'back.out(1.5)'},${r2(t0 + 0.46)});`
    // ── PAQUET 5 (#157) ──
    case 'booking':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{scale:0.86,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.012,ease:'power3.out',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}bk12',{scale:1},{scale:1.18,duration:0.3,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.66)});
      tl.to('#${id}bk12',{scale:1,duration:0.22,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.96)});`
    case 'form':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:16,autoAlpha:0},{y:0,autoAlpha:1,duration:0.26,stagger:0.05,ease:'power3.out'},${t0});
      tl.fromTo('#${id}an .an-ff',{scaleX:0},{scaleX:1,duration:0.26,stagger:0.15,ease:'steps(7)'},${r2(t0 + 0.3)});
      tl.to('#${id}fbt',{scale:0.95,duration:0.14,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.92)});`
    case 'donut':
      return inOut + `
      tl.fromTo('#${id}dnw',{rotation:-40,scale:0.8,autoAlpha:0},{rotation:0,scale:1,autoAlpha:1,duration:0.44,ease:'back.out(1.6)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}an .an-dg',{x:18,autoAlpha:0},{x:0,autoAlpha:1,duration:0.26,stagger:0.07,ease:'power3.out'},${r2(t0 + 0.34)});`
    case 'map':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{scale:0.94,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'power3.out',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}an .an-mp',{y:${FH(id, -0.16)},scale:0.5,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.32,stagger:0.11,ease:'back.out(2.4)',transformOrigin:'50% 100%'},${r2(t0 + 0.24)});`
    case 'mixer':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,ease:'power2.out'},${t0});
      tl.fromTo('#${id}an .an-ml',{scaleY:0},{scaleY:1,duration:0.34,stagger:0.07,ease:'power2.out'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}an .an-mf',{y:${FH(id, 0.2)}},{y:0,duration:0.4,stagger:0.07,ease:'back.out(1.6)'},${r2(t0 + 0.2)});
      tl.to('#${id}an .an-ml',{scaleY:0.72,duration:0.24,yoyo:true,repeat:3,stagger:0.05,ease:'sine.inOut'},${r2(t0 + 0.66)});`
    case 'review':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:20,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'back.out(1.7)'},${t0});
      tl.fromTo('#${id}an .an-rv',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.09,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.3)});`
    case 'upgrade':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{scale:0.9,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(1.7)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}uh',{yPercent:-100},{yPercent:0,duration:0.36,ease:'power3.out'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}an .an-ug',{scale:0},{scale:1,duration:0.24,stagger:0.13,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.44)});`
    case 'storyboard':
      return inOut + `
      tl.fromTo('#${id}an .an-sbd',{x:${FW(id, 0.3)},rotation:6,autoAlpha:0},{x:0,rotation:0,autoAlpha:1,duration:0.36,stagger:0.15,ease:'back.out(1.7)'},${t0});`
    case 'discount':
      return inOut + `
      tl.fromTo('#${id}do',{y:-16,autoAlpha:0},{y:0,autoAlpha:1,duration:0.28,ease:'power3.out'},${t0});
      tl.fromTo('#${id}db',{scaleX:0},{scaleX:1,duration:0.26,ease:'power3.inOut'},${r2(t0 + 0.34)});
      tl.fromTo('#${id}dn2',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.36,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.5)});
      tl.fromTo('#${id}dc',{scale:0,rotation:-12,autoAlpha:0},{scale:1,rotation:0,autoAlpha:1,duration:0.32,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.72)});`
    case 'music':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,stagger:0.05,ease:'power2.out'},${t0});
      tl.fromTo('#${id}mt',{x:${FW(id, 0.5)},autoAlpha:0},{x:0,autoAlpha:1,duration:0.36,ease:'back.out(1.6)'},${r2(t0 + 0.2)});
      tl.to('#${id}mk',{x:${FW(id, -0.52)},duration:0.44,ease:'power3.inOut'},${r2(t0 + 0.62)});
      tl.to('#${id}mt',{autoAlpha:0.42,duration:0.44,ease:'power2.out'},${r2(t0 + 0.62)});`
    case 'bio':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:14,autoAlpha:0},{y:0,autoAlpha:1,duration:0.28,stagger:0.05,ease:'power3.out'},${t0});
      tl.fromTo('#${id}bc',{scale:0.4,autoAlpha:0.9},{scale:1.4,autoAlpha:0,duration:0.44,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.4)});
      tl.to('#${id}bl2',{scale:0.95,duration:0.14,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.4)});
      tl.fromTo('#${id}bp',{yPercent:110,autoAlpha:0},{yPercent:0,autoAlpha:1,duration:0.42,ease:'power3.out'},${r2(t0 + 0.62)});`
    // ── PAQUET 6 (#157) ──
    case 'keyword':
      // le mot se TAPE lettre par lettre, le curseur clignote, puis la réponse tombe
      return inOut + `
      tl.fromTo('#${id}kc',{y:-18,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,ease:'power3.out'},${t0});
      tl.fromTo('#${id}an .an-kl',{autoAlpha:0},{autoAlpha:1,duration:0.01,stagger:0.055},${r2(t0 + 0.26)});
      tl.fromTo('#${id}kr',{autoAlpha:1},{autoAlpha:0.15,duration:0.22,repeat:5,yoyo:true},${r2(t0 + 0.26)});
      tl.to('#${id}kr',{autoAlpha:0,duration:0.12},${r2(t0 + 0.86)});
      tl.fromTo('#${id}kb',{scale:0.7,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.22,ease:'back.out(2.6)'},${r2(t0 + 0.82)});
      tl.to('#${id}kb',{scale:0.9,duration:0.1,yoyo:true,repeat:1},${r2(t0 + 1.02)});
      // ENVOI : le mot QUITTE le champ et réapparaît dans la bulle
      tl.to('#${id}kw',{autoAlpha:0,y:-10,duration:0.16,ease:'power2.in'},${r2(t0 + 1.1)});
      tl.to('#${id}kb',{autoAlpha:0,duration:0.16},${r2(t0 + 1.1)});
      tl.fromTo('#${id}km',{y:26,scale:0.92,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.36,ease:'back.out(1.8)'},${r2(t0 + 1.2)});
      tl.fromTo('#${id}kmw',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,ease:'back.out(2.6)',transformOrigin:'0% 50%'},${r2(t0 + 1.36)});`
    case 'automation':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.2,ease:'power2.out'},${t0});
      tl.fromTo('#${id}a0',{y:-16,scale:0.9,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.28,ease:'back.out(2)'},${t0});
      tl.fromTo('#${id}a1',{scale:0.9,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.28,ease:'back.out(2)'},${r2(t0 + 0.26)});
      tl.fromTo(['#${id}a2','#${id}a3'],{y:16,scale:0.9,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.3,stagger:0.12,ease:'back.out(2)'},${r2(t0 + 0.5)});
      tl.to('#${id}a3',{scale:1.06,duration:0.24,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.86)});`
    case 'carousel':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{scale:0.92,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(1.7)'},${t0});
      tl.to('#${id}crw',{xPercent:-33.34,duration:0.4,ease:'power3.inOut'},${r2(t0 + 0.44)});
      tl.to('#${id}cd0',{backgroundColor:'${'#'}9a9a9a',duration:0.2},${r2(t0 + 0.44)});
      tl.to('#${id}cd1',{backgroundColor:'${'#'}FF5A1F',scale:1.2,duration:0.24,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${r2(t0 + 0.5)});`
    case 'poll':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:14,autoAlpha:0},{y:0,autoAlpha:1,duration:0.26,stagger:0.06,ease:'power3.out'},${t0});
      tl.fromTo('#${id}p1',{scaleX:0},{scaleX:1,duration:0.5,ease:'power2.out'},${r2(t0 + 0.32)});
      tl.fromTo('#${id}p2',{scaleX:0},{scaleX:1,duration:0.5,ease:'power2.out'},${r2(t0 + 0.4)});`
    case 'story':
      return inOut + `
      tl.fromTo('#${id}an .an-st2',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.06,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}sp',{scale:0.88,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(1.8)'},${r2(t0 + 0.34)});
      tl.fromTo('#${id}sb2',{scaleX:0},{scaleX:1,duration:${r2(Math.max(0.7, dur - 0.6))},ease:'none'},${r2(t0 + 0.5)});`
    case 'hashtag':
      return inOut + `
      tl.fromTo('#${id}an .an-ht',{x:-22,autoAlpha:0},{x:0,autoAlpha:1,duration:0.28,stagger:0.09,ease:'power3.out'},${t0});
      tl.to('#${id}ht0',{scale:1.05,duration:0.24,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'0% 50%'},${r2(t0 + 0.66)});`
    case 'schedule':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{scale:0.88,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.02,ease:'power3.out',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}an .an-sc',{y:${FH(id, -0.12)},scale:0.7,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.3,stagger:0.1,ease:'back.out(2.2)',transformOrigin:'50% 50%'},${r2(t0 + 0.34)});`
    case 'pin':
      return inOut + `
      tl.fromTo('#${id}an .an-pn',{x:-20,autoAlpha:0},{x:0,autoAlpha:1,duration:0.26,stagger:0.07,ease:'power3.out'},${t0});
      tl.to('#${id}pn3',{y:()=>-(document.getElementById('${id}pn3').getBoundingClientRect().top-document.getElementById('${id}pn0').getBoundingClientRect().top),duration:0.46,ease:'power3.inOut'},${r2(t0 + 0.6)});
      tl.to(['#${id}pn0','#${id}pn1','#${id}pn2'],{y:()=>document.getElementById('${id}pn1').getBoundingClientRect().top-document.getElementById('${id}pn0').getBoundingClientRect().top,duration:0.46,ease:'power3.inOut'},${r2(t0 + 0.6)});`
    case 'qr':
      return inOut + `
      tl.fromTo('#${id}qb',{scale:0.86,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(1.9)'},${t0});
      tl.fromTo('#${id}ql',{y:0,autoAlpha:0.9},{y:()=>document.getElementById('${id}qb').offsetHeight,autoAlpha:0.9,duration:0.5,ease:'power1.inOut'},${r2(t0 + 0.28)});
      tl.fromTo('#${id}qp',{x:${FW(id, 0.24)},autoAlpha:0},{x:0,autoAlpha:1,duration:0.36,ease:'back.out(1.7)'},${r2(t0 + 0.66)});`
    case 'wizard':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.22,ease:'power2.out'},${t0});
      tl.fromTo('#${id}wb',{scaleX:0},{scaleX:1,duration:${r2(Math.max(0.6, dur - 0.5))},ease:'power1.inOut'},${r2(t0 + 0.26)});
      ${[1, 2].map((k) => `tl.to('#${id}wz${k}',{backgroundColor:'${'#'}FF5A1F',borderColor:'${'#'}FF5A1F',color:'${'#'}FFFFFF',autoAlpha:1,scale:1.1,duration:0.24,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${r2(t0 + 0.34 + k * 0.28)});
      tl.to('#${id}wz${k}',{scale:1,duration:0.18,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.58 + k * 0.28)});`).join('\n      ')}`
    // ── PAQUET 7 (#157) — les domaines ──
    case 'product':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:20,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}an .an-pd',{y:14,autoAlpha:0},{y:0,autoAlpha:1,duration:0.26,stagger:0.07,ease:'power3.out'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}pdb',{scale:0.86,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.56)});
      tl.to('#${id}pdb',{scale:1.05,duration:0.18,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.9)});`
    case 'cart':
      return inOut + `
      tl.fromTo('#${id}an .an-ct',{x:${FW(id, 0.36)},autoAlpha:0},{x:0,autoAlpha:1,duration:0.34,stagger:0.14,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}ctt',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(2.6)',transformOrigin:'100% 50%'},${r2(t0 + 0.64)});`
    case 'delivery':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.22,ease:'power2.out'},${t0});
      tl.fromTo('#${id}dvl',{scaleX:0},{scaleX:1,duration:${r2(Math.max(0.7, dur - 0.4))},ease:'power1.inOut'},${r2(t0 + 0.22)});
      tl.fromTo('#${id}an .an-dv',{scale:0},{scale:1,duration:0.26,stagger:${r2(Math.max(0.16, (dur - 0.5) / 4))},ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.26)});
      tl.fromTo('#${id}dvb',{x:0},{x:${FW(id, 0.70)},duration:${r2(Math.max(0.7, dur - 0.4))},ease:'power1.inOut'},${r2(t0 + 0.22)});`
    case 'sizes':
      return inOut + `
      tl.fromTo('#${id}an .an-sz',{y:14,autoAlpha:0},{y:0,autoAlpha:1,duration:0.24,stagger:0.06,ease:'back.out(2)'},${t0});
      tl.fromTo('#${id}an .an-cl2',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.22,stagger:0.05,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.24)});
      tl.fromTo('#${id}szr',{scale:1.3,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.28,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.52)});
      tl.fromTo('#${id}clr',{scale:1.4,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.28,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.7)});`
    case 'candles':
      return inOut + `
      tl.fromTo('#${id}an .an-cn',{scaleY:0,autoAlpha:0},{scaleY:1,autoAlpha:1,duration:0.2,stagger:0.055,ease:'power3.out',transformOrigin:'50% 100%'},${t0});`
    case 'portfolio':
      return inOut + `
      tl.fromTo('#${id}pfv',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.36,ease:'back.out(2.4)'},${t0});
      tl.fromTo('#${id}pfp',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.28,ease:'back.out(3)',transformOrigin:'0% 50%'},${r2(t0 + 0.28)});
      tl.fromTo('#${id}an .an-pf',{x:-20,autoAlpha:0},{x:0,autoAlpha:1,duration:0.28,stagger:0.1,ease:'power3.out'},${r2(t0 + 0.4)});`
    case 'order':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:16,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}an .an-or',{scaleX:0.9,autoAlpha:0},{scaleX:1,autoAlpha:1,duration:0.24,stagger:0.1,ease:'power3.out'},${r2(t0 + 0.24)});
      tl.to('#${id}ob',{scale:1.05,duration:0.2,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.5)});
      tl.fromTo('#${id}ov',{scale:0.86,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(2.8)',transformOrigin:'50% 50%'},${r2(t0 + 0.68)});`
    case 'pnl':
      return inOut + `
      tl.fromTo('#${id}pl',{strokeDashoffset:1},{strokeDashoffset:0,duration:${r2(Math.max(0.7, dur - 0.3))},ease:'power2.out'},${t0});
      tl.fromTo('#${id}pa',{autoAlpha:0},{autoAlpha:0.16,duration:0.5,ease:'power2.out'},${r2(t0 + 0.3)});
      tl.fromTo('#${id}pp',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(2.6)'},${r2(t0 + 0.44)});`
    case 'mrr':
      return inOut + `
      tl.fromTo('#${id}mrv',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.36,ease:'back.out(2.4)'},${t0});
      tl.fromTo('#${id}an .an-mr',{scaleY:0},{scaleY:1,duration:0.3,stagger:0.07,ease:'back.out(1.7)'},${r2(t0 + 0.24)});
      tl.to('#${id}mr6',{scaleY:1.06,duration:0.2,yoyo:true,repeat:1,ease:'sine.inOut'},${r2(t0 + 0.86)});`
    case 'churn':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{x:-16,autoAlpha:0},{x:0,autoAlpha:1,duration:0.24,stagger:0.04,ease:'power3.out'},${t0});
      tl.fromTo('#${id}an .an-ch',{scaleX:1.55},{scaleX:1,duration:0.42,stagger:0.1,ease:'power2.out'},${r2(t0 + 0.28)});
      tl.fromTo('#${id}chp',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(2.6)'},${r2(t0 + 0.6)});`
    case 'onboarding':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:14,autoAlpha:0},{y:0,autoAlpha:1,duration:0.24,stagger:0.04,ease:'power3.out'},${t0});
      tl.fromTo('#${id}obb',{scaleX:0},{scaleX:1,duration:0.5,ease:'power2.out'},${r2(t0 + 0.26)});
      tl.fromTo('#${id}obp',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(2.6)'},${r2(t0 + 0.32)});
      tl.fromTo('#${id}an .an-ob2',{scale:0},{scale:1,duration:0.22,stagger:0.12,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.4)});`
    case 'integrations':
      return inOut + `
      tl.fromTo('#${id}ic',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}an .an-il',{strokeDashoffset:1},{strokeDashoffset:0,duration:0.3,stagger:0.06,ease:'power2.out'},${r2(t0 + 0.26)});
      tl.fromTo('#${id}an .an-it2',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,stagger:0.06,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.36)});`
    case 'property':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:20,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}an .an-pr',{y:12,autoAlpha:0},{y:0,autoAlpha:1,duration:0.26,stagger:0.06,ease:'power3.out'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}prb',{scale:0.86,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.6)});`
    case 'menu':
      return inOut + `
      tl.fromTo('#${id}an .an-mn',{x:-20,autoAlpha:0},{x:0,autoAlpha:1,duration:0.28,stagger:0.09,ease:'power3.out'},${t0});
      tl.to('#${id}mn1',{scale:1.05,duration:0.26,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'0% 50%'},${r2(t0 + 0.62)});`
    // ── PAQUET 8 (#157) ──
    case 'weight':
      return inOut + `
      tl.fromTo('#${id}wl2',{strokeDashoffset:1},{strokeDashoffset:0,duration:${r2(Math.max(0.7, dur - 0.3))},ease:'power2.out'},${t0});
      tl.fromTo('#${id}wv',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(2.6)'},${r2(t0 + 0.4)});`
    case 'quote':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:18,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}an .an-qt',{scaleX:0,autoAlpha:0},{scaleX:1,autoAlpha:1,duration:0.2,stagger:0.055,ease:'power2.out',transformOrigin:'0% 50%'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}qtt',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.6)',transformOrigin:'100% 50%'},${r2(t0 + 0.6)});
      tl.fromTo('#${id}qs path',{strokeDashoffset:1},{strokeDashoffset:0,duration:0.42,ease:'power2.out'},${r2(t0 + 0.72)});`
    case 'cv':
      return inOut + `
      tl.fromTo('#${id}an .an-cv',{y:20,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,stagger:0.1,ease:'back.out(1.8)'},${t0});
      tl.to('#${id}cv1',{y:${FH(id, -0.06)},scale:1.08,duration:0.32,ease:'back.out(2.2)',transformOrigin:'50% 50%'},${r2(t0 + 0.56)});
      tl.fromTo('#${id}cvk',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.72)});`
    // ── PAQUET 9 (#157) — les métaphores physiques ──
    case 'liquid':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,ease:'power2.out'},${t0});
      tl.fromTo('#${id}lq',{scaleY:0},{scaleY:0.86,duration:${r2(Math.max(0.8, dur - 0.35))},ease:'power1.inOut'},${r2(t0 + 0.18)});
      tl.fromTo('#${id}an .an-lb2',{y:0,autoAlpha:0},{y:${FH(id, -0.42)},autoAlpha:1,duration:0.9,stagger:0.14,repeat:1,ease:'power1.out'},${r2(t0 + 0.34)});`
    case 'magnet':
      return inOut + `
      tl.fromTo('#${id}mgc',{scale:0.7,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.2)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}an .an-mg',{autoAlpha:0},{autoAlpha:1,duration:0.22,stagger:0.03,ease:'power2.out'},${r2(t0 + 0.16)});
      tl.to('#${id}an .an-mg',{x:(i,el)=>{const a=parseFloat(el.dataset.a);const r=${FRAME(id)};return -Math.cos(a)*r.width*0.4},y:(i,el)=>{const a=parseFloat(el.dataset.a);const r=${FRAME(id)};return -Math.sin(a)*r.height*0.42},scale:0.5,autoAlpha:0.9,duration:0.5,stagger:0.035,ease:'power3.in'},${r2(t0 + 0.34)});`
    case 'explode':
      return inOut + `
      tl.fromTo('#${id}exc',{scale:0.7,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2)',transformOrigin:'50% 50%'},${t0});
      tl.to('#${id}exc',{scale:0.5,autoAlpha:0,duration:0.24,ease:'power2.in',transformOrigin:'50% 50%'},${r2(t0 + 0.42)});
      tl.fromTo('#${id}an .an-ex',{x:0,y:0,scale:0.5,autoAlpha:0},{x:(i,el)=>parseFloat(el.dataset.dx)*${FRAME(id)}.width*0.3,y:(i,el)=>parseFloat(el.dataset.dy)*${FRAME(id)}.height*0.3,scale:1,autoAlpha:1,duration:0.44,stagger:0.045,ease:'back.out(1.6)'},${r2(t0 + 0.44)});`
    // ── PAQUET 10 (#157) — métaphore ET matière ──
    case 'iceberg':
      return inOut + `
      tl.fromTo('#${id}ibw',{scaleX:0},{scaleX:1,duration:0.36,ease:'power3.out'},${t0});
      tl.fromTo('#${id}ibt',{y:${FH(id, -0.18)},autoAlpha:0},{y:0,autoAlpha:1,duration:0.38,ease:'back.out(1.6)'},${r2(t0 + 0.16)});
      tl.fromTo('#${id}ibb',{y:${FH(id, 0.22)},autoAlpha:0},{y:0,autoAlpha:0.42,duration:0.5,ease:'power3.out'},${r2(t0 + 0.42)});
      tl.fromTo('#${id}an .an-iw',{x:-12,autoAlpha:0},{x:0,autoAlpha:1,duration:0.3,stagger:0.06,ease:'power2.out'},${r2(t0 + 0.3)});`
    case 'tunnel':
      return inOut + `
      tl.fromTo('#${id}an .an-tn',{scale:1.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.4,stagger:0.055,ease:'power2.out',transformOrigin:'50% 50%'},${t0});
      tl.to('#${id}an .an-tn',{scale:1.5,duration:${r2(Math.max(0.8, dur - 0.4))},stagger:0.03,ease:'power1.in',transformOrigin:'50% 50%'},${r2(t0 + 0.4)});
      tl.fromTo('#${id}tng',{scale:0.3,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.5,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.42)});`
    case 'thermometer':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,stagger:0.02,ease:'power2.out'},${t0});
      tl.fromTo('#${id}thm',{scaleY:0.06},{scaleY:0.88,duration:${r2(Math.max(0.8, dur - 0.35))},ease:'power2.inOut'},${r2(t0 + 0.2)});`
    // ── PAQUET 11 (#157) — le métier de la vidéo ──
    case 'script':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:16,autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}an .an-sc3',{scaleX:0},{scaleX:1,duration:0.16,stagger:0.06,ease:'steps(6)'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}sch',{scaleX:0,autoAlpha:0.45},{scaleX:1,autoAlpha:0.45,duration:0.3,ease:'power2.out'},${r2(t0 + 0.78)});`
    case 'clapper':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:20,scale:0.92,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.32,ease:'back.out(1.7)'},${t0});
      tl.fromTo('#${id}clp',{rotation:-32},{rotation:0,duration:0.2,ease:'power3.in'},${r2(t0 + 0.4)});
      tl.to('#${id}clp',{rotation:-9,duration:0.14,ease:'power2.out'},${r2(t0 + 0.6)});
      tl.to('#${id}clp',{rotation:0,duration:0.12,ease:'power2.in'},${r2(t0 + 0.74)});`
    case 'retakes':
      return inOut + `
      tl.fromTo('#${id}an .an-rt',{y:18,autoAlpha:0},{y:0,autoAlpha:1,duration:0.28,stagger:0.09,ease:'back.out(1.8)'},${t0});
      tl.fromTo('#${id}an .an-rx',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,stagger:0.14,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.46)});
      tl.to(['#${id}rt0','#${id}rt2'],{autoAlpha:0.35,duration:0.26,ease:'power2.out'},${r2(t0 + 0.72)});
      tl.fromTo('#${id}rtr',{scale:1.2,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.76)});`
    case 'transition':
      return inOut + `
      tl.fromTo('#${id}an',{scale:0.94},{scale:1,duration:0.3,ease:'back.out(1.6)'},${t0});
      tl.fromTo('#${id}tr2',{scaleX:0},{scaleX:1,duration:0.46,ease:'power3.inOut'},${r2(t0 + 0.3)});
      tl.fromTo('#${id}trl',{x:0,autoAlpha:0},{x:()=>document.getElementById('${id}tr2').offsetWidth,autoAlpha:1,duration:0.46,ease:'power3.inOut'},${r2(t0 + 0.3)});
      tl.to('#${id}trl',{autoAlpha:0,duration:0.14,ease:'power2.in'},${r2(t0 + 0.76)});`
    case 'zoompunch':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{scale:0.94,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'power3.out'},${t0});
      tl.fromTo('#${id}zpb',{scale:1.4,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.4)',transformOrigin:'50% 50%'},${r2(t0 + 0.28)});
      tl.to('#${id}zpi',{scale:2.1,duration:0.5,ease:'power3.inOut'},${r2(t0 + 0.56)});
      tl.to('#${id}zpb',{autoAlpha:0,duration:0.24,ease:'power2.in'},${r2(t0 + 0.56)});`
    case 'speedramp':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{y:12,autoAlpha:0},{y:0,autoAlpha:1,duration:0.26,ease:'power3.out'},${t0});
      tl.fromTo('#${id}an .an-sr2',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.26,stagger:0.13,ease:'back.out(2.6)',transformOrigin:'50% 100%'},${r2(t0 + 0.28)});
      tl.fromTo('#${id}srp',{x:0},{x:${FW(id, 0.9)},duration:${r2(Math.max(0.85, dur - 0.3))},ease:'power1.inOut'},${r2(t0 + 0.26)});`
    case 'substyle':
      return inOut + `
      tl.fromTo('#${id}an .an-ss3',{y:18,autoAlpha:0},{y:0,autoAlpha:1,duration:0.28,stagger:0.09,ease:'back.out(1.8)'},${t0});
      tl.fromTo('#${id}ssr',{scale:1.2,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.6)',transformOrigin:'50% 50%'},${r2(t0 + 0.56)});
      tl.to('#${id}ss31',{scale:1.06,duration:0.24,ease:'back.out(2)',transformOrigin:'50% 50%'},${r2(t0 + 0.56)});`
    case 'trendsound':
      return inOut + `
      tl.fromTo('#${id}tsc',{y:-18,autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'back.out(1.7)'},${t0});
      tl.fromTo('#${id}an .an-tw2',{scaleY:0.25},{scaleY:1,duration:0.24,stagger:{each:0.02,yoyo:true,repeat:4},ease:'sine.inOut'},${r2(t0 + 0.26)});
      tl.fromTo('#${id}tsl',{strokeDashoffset:1},{strokeDashoffset:0,duration:0.5,ease:'power2.out'},${r2(t0 + 0.34)});
      tl.fromTo('#${id}tsn',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(2.6)'},${r2(t0 + 0.5)});`
    case 'algorithm':
      return inOut + `
      tl.fromTo('#${id}ag4',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.2)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo(['#${id}ag1','#${id}ag3','#${id}ag5','#${id}ag7'],{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:0.4,duration:0.28,stagger:0.06,ease:'back.out(2)',transformOrigin:'50% 50%'},${r2(t0 + 0.3)});
      tl.fromTo(['#${id}ag0','#${id}ag2','#${id}ag6','#${id}ag8'],{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:0.4,duration:0.28,stagger:0.06,ease:'back.out(2)',transformOrigin:'50% 50%'},${r2(t0 + 0.54)});
      tl.to('#${id}ag4',{scale:1.08,duration:0.24,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.82)});`
    case 'loop':
      return inOut + `
      tl.fromTo('#${id}an .an-p',{autoAlpha:0},{autoAlpha:1,duration:0.24,ease:'power2.out'},${t0});
      tl.fromTo('#${id}lpa',{rotation:-90,scale:0.6,autoAlpha:0},{rotation:0,scale:1,autoAlpha:1,duration:0.36,ease:'back.out(2)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}lpb',{scaleX:0},{scaleX:1,duration:0.44,repeat:2,ease:'none'},${r2(t0 + 0.28)});
      tl.fromTo('#${id}lph',{x:0},{x:${FW(id, 0.88)},duration:0.44,repeat:2,ease:'none'},${r2(t0 + 0.28)});
      tl.to('#${id}lpa',{rotation:360,duration:0.44,repeat:2,ease:'none',transformOrigin:'50% 50%'},${r2(t0 + 0.28)});
      tl.fromTo('#${id}lpn',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.8)'},${r2(t0 + 0.6)});`
    case 'framing':
      return inOut + `
      tl.fromTo('#${id}fmb', { scale: 1.55, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'power3.out' }, ${t0});
      tl.fromTo('#${id}an .an-fg', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, stagger: 0.05 }, ${r2(t0 + 0.4)});`
    case 'focus':
      return inOut + `
      tl.fromTo('#${id}fcn', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.28, ease: 'power2.inOut' }, ${r2(t0 + 0.42)});
      tl.fromTo('#${id}an .an-fcc', { scaleX: 0.2, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.3, ease: 'power2.out', transformOrigin: '50% 50%' }, ${r2(t0 + 0.4)});`
    case 'clipping':
      return inOut + `
      tl.fromTo('#${id}an .an-cp', { scaleY: 0.2 }, { scaleY: 1, duration: 0.3, stagger: 0.012, ease: 'power2.out' }, ${t0});
      tl.to('#${id}an .an-cp', { scaleY: 0.55, duration: 0.34, ease: 'power2.inOut' }, ${r2(t0 + 0.72)});
      tl.fromTo('#${id}cpw', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.24, ease: 'back.out(2)' }, ${r2(t0 + 0.34)});
      tl.to('#${id}cpw', { autoAlpha: 0.25, duration: 0.3 }, ${r2(t0 + 0.8)});`
    case 'lighting':
      return inOut + `
      tl.fromTo('#${id}lgl', { scale: 0.4, autoAlpha: 0, rotation: -25 }, { scale: 1, autoAlpha: 1, rotation: 0, duration: 0.34, ease: 'back.out(2)' }, ${t0});
      tl.fromTo('#${id}lgg', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.45, ease: 'power2.out' }, ${r2(t0 + 0.3)});
      tl.to(['#${id}lgh', '#${id}lgb'], { backgroundColor: '#FFD678', duration: 0.4, ease: 'power2.out' }, ${r2(t0 + 0.34)});`
    case 'retake':
      return inOut + `
      tl.fromTo('#${id}rk1', { scale: 0.9, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.28, ease: 'power2.out' }, ${t0});
      tl.to('#${id}rk1', { x: ${FW(id, -1.1)}, rotation: -12, autoAlpha: 0, duration: 0.36, ease: 'power2.in' }, ${r2(t0 + 0.5)});
      tl.fromTo('#${id}rk2', { x: ${FW(id, 1.1)}, autoAlpha: 1 }, { x: 0, duration: 0.4, ease: 'power3.out' }, ${r2(t0 + 0.58)});`
    case 'caption':
      return inOut + `
      tl.fromTo('#${id}an .an-cpl', { scaleX: 0 }, { scaleX: 1, duration: 0.26, stagger: 0.12, ease: 'power1.inOut' }, ${t0});
      tl.fromTo('#${id}an .an-cpt', { scale: 0.5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.24, stagger: 0.08, ease: 'back.out(2.4)' }, ${r2(t0 + 0.5)});`
    case 'preview':
      return inOut + `
      tl.fromTo('#${id}pvp', { y: ${FH(id, 0.12)}, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.36, ease: 'power3.out' }, ${t0});
      tl.fromTo('#${id}pvv', { scale: 0.82, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: 'back.out(1.7)' }, ${r2(t0 + 0.24)});
      tl.fromTo('#${id}an .an-pvl', { scaleX: 0 }, { scaleX: 1, duration: 0.22, stagger: 0.08, ease: 'power1.out', transformOrigin: '0% 50%' }, ${r2(t0 + 0.42)});
      tl.fromTo('#${id}pvb', { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.28, ease: 'back.out(2.4)' }, ${r2(t0 + 0.6)});`
    case 'spike':
      return inOut + `
      tl.fromTo('#${id}spl', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.62, ease: 'power2.in' }, ${t0});
      tl.fromTo('#${id}spd', { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.26, ease: 'back.out(3)' }, ${r2(t0 + 0.6)});
      tl.fromTo('#${id}spn', { scale: 0.5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(2.2)' }, ${r2(t0 + 0.64)});`
    case 'brandeal':
      return inOut + `
      tl.fromTo('#${id}bdc', { y: ${FH(id, -0.14)}, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.34, ease: 'power3.out' }, ${t0});
      tl.fromTo('#${id}bdm', { scale: 0.55, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.34, ease: 'back.out(2.4)' }, ${r2(t0 + 0.42)});`
    case 'mediakit':
      return inOut + `
      tl.fromTo('#${id}mkc', { scale: 0.9, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'power3.out' }, ${t0});
      tl.fromTo('#${id}an .an-mk', { x: ${FW(id, -0.25)}, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.3, stagger: 0.11, ease: 'power2.out' }, ${r2(t0 + 0.22)});`
    case 'inventory':
      return inOut + `
      tl.fromTo('#${id}ivf', { scaleY: 1 }, { scaleY: 0.18, duration: 0.6, ease: 'power2.in' }, ${t0});
      tl.fromTo('#${id}ivw', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.16, ease: 'power2.out' }, ${r2(t0 + 0.55)});
      tl.to('#${id}ivw', { autoAlpha: 0.3, duration: 0.14, repeat: 3, yoyo: true }, ${r2(t0 + 0.7)});
      tl.to('#${id}ivf', { scaleY: 0.95, duration: 0.4, ease: 'back.out(1.6)' }, ${r2(t0 + 0.92)});`
    case 'stoploss':
      return inOut + `
      tl.fromTo('#${id}an .an-sl', { scaleY: 0 }, { scaleY: 1, duration: 0.22, stagger: 0.07, ease: 'power2.out' }, ${t0});
      tl.fromTo('#${id}sll', { scaleX: 0 }, { scaleX: 1, duration: 0.34, ease: 'power2.out' }, ${r2(t0 + 0.2)});
      tl.fromTo('#${id}slt', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.24, ease: 'back.out(2.4)' }, ${r2(t0 + 0.52)});
      tl.to('#${id}sll', { autoAlpha: 0.35, duration: 0.12, repeat: 3, yoyo: true }, ${r2(t0 + 0.66)});`
    case 'orderbook':
      return inOut + `
      tl.fromTo('#${id}an .an-ob1', { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.26, stagger: 0.06, ease: 'power2.out' }, ${t0});
      tl.fromTo('#${id}an .an-ob2', { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.26, stagger: 0.06, ease: 'power2.out' }, ${r2(t0 + 0.1)});
      tl.fromTo('#${id}obs', { scaleY: 1.5, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(2)' }, ${r2(t0 + 0.5)});`
    case 'deploy':
      return inOut + `
      tl.fromTo('#${id}an .an-dp', { x: ${FW(id, -0.2)}, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.26, stagger: 0.13, ease: 'power2.out' }, ${t0});
      tl.to('#${id}dp0 .an-dpd', { backgroundColor: '#22C55E', duration: 0.16 }, ${r2(t0 + 0.36)});
      tl.to('#${id}dp1 .an-dpd', { backgroundColor: '#22C55E', duration: 0.16 }, ${r2(t0 + 0.52)});
      tl.to('#${id}dp2 .an-dpd', { backgroundColor: '#22C55E', duration: 0.16 }, ${r2(t0 + 0.68)});
      tl.fromTo('#${id}dpb', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: 'back.out(2.4)' }, ${r2(t0 + 0.76)});`
    case 'uptime':
      return inOut + `
      tl.fromTo('#${id}an .an-up', { scaleY: 0 }, { scaleY: 1, duration: 0.2, stagger: 0.022, ease: 'power2.out' }, ${t0});
      tl.fromTo('#${id}upn', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: 'back.out(2.2)' }, ${r2(t0 + 0.5)});`
    case 'leads':
      return inOut + `
      tl.fromTo('#${id}an .an-ld', { y: ${FH(id, -0.1)}, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.28, stagger: 0.14, ease: 'back.out(1.8)' }, ${t0});
      tl.fromTo('#${id}ldn', { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(2.2)' }, ${r2(t0 + 0.2)});`
    case 'views': {
      // LE COMPTEUR MONTE, IL NE SE POSE PAS. Le chiffre s'affichait d'un coup et
      // pulsait : on lisait un nombre, on ne voyait pas une AUDIENCE QUI GRIMPE.
      // Axel : « quand je dis "tes vidéos vont générer des vues", mets une
      // animation en mode de 200 à 100 000 vues rapidement ». C'est la montée
      // qui raconte, pas la valeur finale.
      // ⚠️ `animJs` ne dispose pas du `items` d'`animHtml` : on relit la scène.
      const its = (s.items || []).map((it) => String(it.text || ''))
      const nb = (t, d) => { const v = String(t || '').replace(/[^0-9]/g, ''); return v ? parseInt(v, 10) : d }
      const dep = nb(its[1], 200)
      const arr = Math.max(dep + 1, nb(its[0], 100000))
      const T = r2(Math.max(0.8, Math.min(dur - 0.7, 1.3)))
      let js = inOut + `
      tl.fromTo('#${id}vw',{scale:0.9,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.32,ease:'back.out(1.7)'},${t0});
      tl.to('#${id}vwt',{scale:0.7,autoAlpha:0,duration:0.24,ease:'power2.in',transformOrigin:'50% 50%'},${r2(t0 + 0.3)});
      tl.to('#${id}vwp',{scaleX:1,duration:${r2(Math.max(0.7, dur - 0.6))},ease:'none'},${r2(t0 + 0.32)});
      tl.fromTo('#${id}vwn',{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.6)'},${r2(t0 + 0.34)});`
      const steps = 28
      for (let k = 1; k <= steps; k++) {
        const u = k / steps
        // exponentiel : ça part vite et ça finit en s'installant sur le gros chiffre
        const v = Math.round(dep * Math.pow(arr / dep, Math.pow(u, 0.72)))
        js += `\n      tl.set('#${id}vwn', { textContent: ${JSON.stringify(v.toLocaleString('fr-FR'))} }, ${r2(t0 + 0.4 + T * u)});`
      }
      js += `
      tl.to('#${id}vwn',{scale:1.16,duration:0.15,yoyo:true,repeat:1,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.4 + T)});`
      return js
    }
    case 'linkbio':
      // le profil se pose, le doigt descend et appuie sur le lien
      return inOut + `
      tl.fromTo('#${id}lba',{scale:0.6,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,ease:'back.out(2.2)'},${t0});
      tl.fromTo(['#${id}lbn','#${id}lbb'],{y:-10,autoAlpha:0},{y:0,autoAlpha:1,duration:0.24,stagger:0.08,ease:'power2.out'},${r2(t0 + 0.2)});
      tl.fromTo('#${id}lbl',{y:${FH(id, 0.1)},autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,ease:'back.out(1.8)'},${r2(t0 + 0.36)});
      tl.fromTo('#${id}lbf',{y:${FH(id, 0.18)},scale:1.3,autoAlpha:0},{y:0,scale:1,autoAlpha:0.4,duration:0.3,ease:'power2.in',transformOrigin:'50% 50%'},${r2(t0 + 0.6)});
      tl.to('#${id}lbf',{scale:0.8,duration:0.09,yoyo:true,repeat:1,transformOrigin:'50% 50%'},${r2(t0 + 0.9)});
      tl.to('#${id}lbl',{scale:0.95,duration:0.09,yoyo:true,repeat:1,transformOrigin:'50% 50%'},${r2(t0 + 0.9)});
      tl.to('#${id}lbf',{autoAlpha:0,y:${FH(id, 0.12)},duration:0.24},${r2(t0 + 1.1)});`
    case 'comment': {
      // chaque lettre du mot enfonce une touche : les deux sont synchronisées
      const mot = ((s.items || [])[0] && String(s.items[0].text || '').trim()) || 'PLAN'
      const rows = ['AZERTYUIOP', 'QSDFGHJKLM', 'WXCVBN']
      const all = rows.join('')
      const hits = mot.toUpperCase().split('').map((c) => all.indexOf(c)).filter((i) => i >= 0)
      const press = hits.map((k, i) => `
      tl.to('#${id}kk${k}',{scale:0.84,duration:0.06,yoyo:true,repeat:1,transformOrigin:'50% 50%'},${r2(t0 + 0.4 + i * 0.13)});
      tl.to('#${id}kh${k}',{opacity:0.85,duration:0.06,yoyo:true,repeat:1},${r2(t0 + 0.4 + i * 0.13)});`).join('')
      return inOut + `
      tl.fromTo('#${id}an .an-kk',{y:${FH(id, 0.06)},autoAlpha:0},{y:0,autoAlpha:1,duration:0.3,stagger:0.006,ease:'power2.out'},${t0});
      tl.fromTo('#${id}cf',{y:-14,autoAlpha:0},{y:0,autoAlpha:1,duration:0.28,ease:'power3.out'},${r2(t0 + 0.18)});
      tl.fromTo('#${id}an .an-cl2',{autoAlpha:0},{autoAlpha:1,duration:0.01,stagger:0.13},${r2(t0 + 0.42)});
      tl.fromTo('#${id}cc',{autoAlpha:1},{autoAlpha:0.15,duration:0.26,repeat:6,yoyo:true},${r2(t0 + 0.4)});${press}`
    }
    case 'share':
      // le cœur se remplit et pulse, l'onde part, la flèche s'envole
      return inOut + `
      tl.fromTo(['#${id}sh1','#${id}sh3'],{scale:0.5,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.3,stagger:0.1,ease:'back.out(2.2)',transformOrigin:'50% 50%'},${t0});
      // le doigt descend, appuie, et c'est CET appui qui remplit le cœur
      tl.fromTo('#${id}shf',{y:${FH(id, 0.16)},scale:1.25,autoAlpha:0},{y:0,scale:1,autoAlpha:0.42,duration:0.32,ease:'power2.in',transformOrigin:'50% 50%'},${r2(t0 + 0.3)});
      tl.to('#${id}shf',{scale:0.82,duration:0.09,yoyo:true,repeat:1,transformOrigin:'50% 50%'},${r2(t0 + 0.6)});
      tl.to('#${id}sh1',{scale:0.86,duration:0.09,yoyo:true,repeat:1,transformOrigin:'50% 50%'},${r2(t0 + 0.6)});
      tl.to('#${id}shf',{autoAlpha:0,y:${FH(id, 0.1)},duration:0.26,ease:'power2.out'},${r2(t0 + 0.82)});
      tl.fromTo('#${id}sh2',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.34,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.66)});
      tl.fromTo('#${id}shr',{scale:0.6,autoAlpha:0.9},{scale:1.9,autoAlpha:0,duration:0.5,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 0.68)});
      tl.fromTo('#${id}shn',{y:10,autoAlpha:0},{y:-6,autoAlpha:1,duration:0.3,ease:'back.out(2)'},${r2(t0 + 0.74)});
      tl.to('#${id}sh3',{x:${FW(id, 0.18)},y:${FH(id, -0.08)},autoAlpha:0,duration:0.4,ease:'power2.in'},${r2(t0 + 0.96)});`

    // ── PAQUET 12 (#147) — LES QUATRE SCENES DECRITES PAR AXEL ────────────────
    // Décrites par lui, maquettées, montrées, validées le 30/07. `brickbuild`
    // (la main qui pose une brique, l'immeuble qui monte) a été écarté à la
    // maquette : la construction dit EFFORT alors que la phrase dit FACILE.
    case 'salesphone': {
      // Le téléphone se pose, puis les notifications GLISSENT DU HAUT — et le
      // rythme S'ACCÉLÈRE : 0,56 s entre la 1re et la 2e, 0,44 puis 0,32. C'est
      // ce qui donne « ça n'arrête plus ». Quatre au maximum : au-delà l'écran
      // déborde et on ne lit plus les montants.
      const at = [0.34, 0.90, 1.34, 1.66]
      let notifs = ''
      for (let k = 0; k < 4; k++) {
        notifs += `
      tl.fromTo('#${id}sn${k}',{y:${FH(id, -0.24)},autoAlpha:0},{y:0,autoAlpha:1,duration:0.32,ease:'back.out(1.7)'},${r2(t0 + at[k])});
      tl.to(CNT${id},{v:${k + 1},duration:0.01,onUpdate:SET${id}},${r2(t0 + at[k] + 0.12)});
      tl.to('#${id}bdg',{scale:1.24,duration:0.13,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + at[k] + 0.12)});`
      }
      return inOut + `
      var CNT${id} = {v:0};
      var SET${id} = (function(){ var el=document.getElementById('${id}bdg');
        return function(){ if(el) el.textContent = Math.round(CNT${id}.v); }; })();
      tl.fromTo('#${id}ph',{y:${FH(id, 0.1)},scale:0.9,autoAlpha:0},{y:0,scale:1,autoAlpha:1,duration:0.4,ease:'back.out(1.5)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}bdg',{scale:0,autoAlpha:0},{scale:1,autoAlpha:1,duration:0.24,ease:'back.out(3)',transformOrigin:'50% 50%'},${r2(t0 + 0.4)});${notifs}
      tl.to('#${id}ph',{y:-5,duration:0.09,yoyo:true,repeat:3,ease:'sine.inOut'},${r2(t0 + 0.46)});
      tl.to('#${id}ph',{y:-5,duration:0.09,yoyo:true,repeat:3,ease:'sine.inOut'},${r2(t0 + 1.46)});`
    }
    case 'oneclick':
      // trois temps, dans cet ordre : on OUVRE, on CLIQUE UNE FOIS, c'est FINI.
      // L'écran se relève sur sa charnière (rotationX, origine en bas), le
      // curseur arrive et clique, et l'app laisse place au rendu terminé. Le
      // curseur part avant la fin : ce qui doit rester à l'écran, c'est le
      // résultat, pas la souris.
      return inOut + `
      tl.fromTo('#${id}base',{scaleX:0.7,autoAlpha:0},{scaleX:1,autoAlpha:1,duration:0.28,ease:'back.out(1.6)',transformOrigin:'50% 50%'},${t0});
      tl.fromTo('#${id}lid',{rotationX:-92,autoAlpha:0},{rotationX:0,autoAlpha:1,duration:0.62,ease:'back.out(1.1)',transformOrigin:'50% 100%'},${r2(t0 + 0.16)});
      tl.fromTo('#${id}ui1',{autoAlpha:0},{autoAlpha:1,duration:0.24,ease:'power2.out'},${r2(t0 + 0.66)});
      tl.fromTo('#${id}cur',{x:${FW(id, 0.22)},y:${FH(id, 0.24)},autoAlpha:0},{x:0,y:0,autoAlpha:1,duration:0.46,ease:'power3.out'},${r2(t0 + 0.98)});
      tl.to('#${id}btn',{scale:0.93,duration:0.1,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 1.52)});
      tl.fromTo('#${id}halo',{scale:0.86,autoAlpha:0.9},{scale:1.3,autoAlpha:0,duration:0.44,ease:'power2.out',transformOrigin:'50% 50%'},${r2(t0 + 1.52)});
      tl.to('#${id}ui1',{autoAlpha:0,duration:0.2,ease:'power2.in'},${r2(t0 + 1.86)});
      tl.fromTo('#${id}ui2',{autoAlpha:0,scale:0.94},{autoAlpha:1,scale:1,duration:0.34,ease:'back.out(1.6)',transformOrigin:'50% 50%'},${r2(t0 + 1.96)});
      tl.to('#${id}cur',{x:${FW(id, 0.18)},y:${FH(id, 0.2)},autoAlpha:0,duration:0.3,ease:'power2.in'},${r2(t0 + 1.9)});`
    case 'tsunami':
      // la vague ENFLE : trois passages, chacun plus haut, chacun relevé depuis
      // la ligne de mer (transformOrigin en bas de la bbox = la surface). La
      // précédente s'efface quand la suivante arrive — c'est la MÊME vague.
      // Les points de données montent avec la grande et dérivent : l'eau avance.
      // PAS de scaleY sur les groupes SVG : GSAP calcule l'origine sur une bbox
      // qui bouge pendant le tween et compense par une translation — la vague
      // finissait 800 px au-dessus de l'eau, en l'air. Ici les trois vagues sont
      // dessinées à leur taille définitive, ancrées sur la ligne de mer, et se
      // succèdent : chacune arrive de la gauche et pousse la précédente dehors.
      // Rien qui puisse dériver, et « ça enfle » se lit dans l'enchaînement.
      return inOut + `
      tl.fromTo('#${id}wg0',{x:${FW(id, -0.16)},autoAlpha:0},{x:0,autoAlpha:1,duration:0.42,ease:'power2.out'},${t0});
      tl.to('#${id}wg0',{x:${FW(id, 0.1)},autoAlpha:0,duration:0.3,ease:'power1.in'},${r2(t0 + 0.66)});
      tl.fromTo('#${id}wg1',{x:${FW(id, -0.2)},autoAlpha:0},{x:0,autoAlpha:1,duration:0.5,ease:'power2.out'},${r2(t0 + 0.62)});
      tl.to('#${id}wg1',{x:${FW(id, 0.12)},autoAlpha:0,duration:0.34,ease:'power1.in'},${r2(t0 + 1.3)});
      tl.fromTo('#${id}wg2',{x:${FW(id, -0.26)},autoAlpha:0},{x:0,autoAlpha:1,duration:0.72,ease:'power3.out'},${r2(t0 + 1.24)});
      tl.fromTo('#${id}an .an-dt',{y:${FH(id, 0.26)},autoAlpha:0},{y:0,autoAlpha:1,duration:0.66,stagger:0.014,ease:'power2.out'},${r2(t0 + 1.42)});
      tl.to('#${id}an .an-dt',{x:${FW(id, 0.07)},duration:${r2(Math.max(0.8, dur - 2))},ease:'sine.inOut'},${r2(t0 + 1.9)});`
    case 'gaugefill': {
      // le chiffre est COMPTÉ, il suit la jauge. Il n'y a pas de valeur écrite
      // dans le code : le libellé cible est lu sur l'élément (data-pct), et le
      // compteur s'arrête dessus.
      const fill = r2(Math.max(0.9, dur * 0.66))
      return inOut + `
      tl.fromTo('#${id}gfill',{scaleY:0},{scaleY:1,duration:${fill},ease:'power1.inOut',transformOrigin:'50% 100%'},${r2(t0 + 0.2)});
      (function(){ var el=document.getElementById('${id}gnum'); if(!el) return;
        var target=(el.getAttribute('data-pct')||'100 %'), n=parseFloat(String(target).replace(',','.'))||100, o={v:0};
        // lazy:false — sans lui GSAP diffère le rendu du premier tick, et un
        // seek() sur la timeline laisse le compteur figé à 0 %.
        tl.to(o,{v:n,duration:${fill},lazy:false,ease:'power1.inOut',onUpdate:function(){ el.textContent=Math.round(o.v)+' %'; }},${r2(t0 + 0.2)}); })();
      // les quatre ventes tombent PENDANT la montée, calées sur la jauge : à un
      // quart, à la moitié, aux trois quarts, puis juste avant le plein. « Plus
      // ça monte, plus il y en a » — et jamais plus de quatre.
      ${[0.22, 0.46, 0.7, 0.92].map((p, k) => `tl.fromTo('#${id}gs${k}',{x:${FW(id, 0.26)},autoAlpha:0},{x:0,autoAlpha:1,duration:0.3,ease:'back.out(1.6)'},${r2(t0 + 0.2 + fill * p)});`).join('\n      ')}
      tl.to('#${id}gnum',{scale:1.1,duration:0.18,yoyo:true,repeat:1,ease:'sine.inOut',transformOrigin:'50% 50%'},${r2(t0 + 0.2 + fill)});`
    }
    default:
      return inOut + `
      tl.fromTo('#${id}cn', { scale: 0.5, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.32, ease: 'back.out(2.4)' }, ${t0});
      tl.fromTo('#${id}cl', { strokeDashoffset: (i, el) => (el.getTotalLength ? el.getTotalLength() : 0) }, { strokeDashoffset: 0, duration: ${r2(Math.max(0.6, dur - 0.7))}, ease: 'power1.inOut' }, ${t0});
      tl.fromTo('#${id}co', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.22 }, ${r2(t0 + 0.4)});
      tl.fromTo('#${id}cb', { scaleX: 0 }, { scaleX: 1, duration: 0.26, ease: 'power3.inOut' }, ${r2(t0 + 0.56)});`
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
