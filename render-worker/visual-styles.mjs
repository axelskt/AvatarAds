// visual-styles.mjs — « Styles visuels » des Paramètres avancés du Montage IA (#131)
//
// plan.slideStyle pilote l'apparence de TOUT le montage (slides split, scènes plein
// cadre, bandeaux, sous-titres). Le style est posé en classe sur <body> (.vs-apple,
// .vs-glass, .vs-editorial, .vs-word) : chaque règle ici a une spécificité (0,2,0)
// et écrase donc la règle de base (0,1,0) sans avoir besoin de !important — sauf
// quand la règle de base en met déjà un (cas du verre).
//
//  apple      · pub Apple : blanc immaculé, un seul objet héros, typo fine, beaucoup de vide
//  glass      · liquid glass : cartes en verre dépoli translucide posées SUR la vidéo
//  editorial  · magazine blanc : cartes flottantes, profondeur de champ, sérif léger, trame de points
//  word       · mot par mot : plein écran uni, UN mot énorme à la fois (type Thinks)

export const VSTYLES = ['apple', 'glass', 'editorial', 'word']

// Le conteneur de rendu n'embarque que fonts-liberation : sans ça « Archivo Black »,
// « Inter » et les sérifs retombent tous sur Liberation Sans et les quatre styles se
// ressemblent. Les fichiers sont EMBARQUÉS (render-worker/assets/fonts → proj/fonts) :
// un CDN de polices ferait dépendre chaque rendu du réseau, et un échec donnerait une
// vidéo à la mauvaise typo sans le moindre message d'erreur.
export function fontFaceCss() {
  const ff = (family, file, weight, style = 'normal') => `
      @font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight};
        font-display: block; src: url('fonts/${file}-latin.woff2') format('woff2'); }
      @font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight};
        font-display: block; src: url('fonts/${file}-latin-ext.woff2') format('woff2');
        unicode-range: U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF; }`
  return [
    ff('Inter', 'Inter-var', '100 900'),
    ff('Archivo Black', 'ArchivoBlack-400', 400),
    ff('Instrument Serif', 'InstrumentSerif-400', 400),
    ff('Instrument Serif', 'InstrumentSerif-400i', 400, 'italic'),
    ff('JetBrains Mono', 'JetBrainsMono-400', 400),
    ff('JetBrains Mono', 'JetBrainsMono-700', 700),
  ].join('')
}

// ── palettes ──────────────────────────────────────────────────────────────
export const APPLE = { bg: '#FFFFFF', panel: '#F5F5F7', ink: '#1D1D1F', mute: '#6E6E73', line: '#D2D2D7', acc: '#0071E3' }
export const EDITO = { bg: '#FFFFFF', ink: '#111111', mute: '#8A8A8A', line: 'rgba(17,17,17,.12)' }
// fonds « mot par mot » : profonds et saturés, alternés d'un mot à l'autre
export const WORD_BG = ['#150F22', '#0E1B2E', '#1E1020', '#101E18', '#241408']
export const WORD_SHAPE_A = 0.14   // opacité de la forme découpée derrière le mot
export const WORD_FG = ['#FFE500', '#FFFFFF', '#7CF6FF', '#FFE500', '#FF6B35']

const SANS = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif'
const SERIF = '"Instrument Serif", "Liberation Serif", Georgia, serif'
const MONO = '"JetBrains Mono", "Liberation Mono", ui-monospace, monospace'
const BLACK = '"Archivo Black", "Arial Black", Arial, sans-serif'

// bruit déterministe : même plan → même mise en page (obligatoire, le rendu est
// frame par frame et doit être reproductible)
export function seeded(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

// éparpillement « magazine » : rotation + décalage + flou de profondeur de champ
export function scatterStyle(style, seed, { blur = true } = {}) {
  if (style !== 'editorial') return ''
  const rot = (seeded(seed) * 2 - 1) * 2.6            // -2.6° … +2.6°
  const dy = Math.round((seeded(seed + 11) * 2 - 1) * 16)
  const far = blur && seeded(seed + 23) > 0.72         // ~1 carte sur 4 en arrière-plan
  return ` style="transform:rotate(${Math.round(rot * 10) / 10}deg) translateY(${dy}px)` +
    (far ? `;filter:blur(1.6px);opacity:.72` : '') + `"`
}

// ── mot par mot : taille de police qui tient dans le cadre ─────────────────
export function wordFontSize(text, W, H) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  const longest = Math.max(3, ...words.map((w) => w.length))
  const lines = Math.max(1, Math.ceil(words.length / (words.length > 4 ? 2 : 1)))
  const byWidth = (W * 0.86) / (0.86 * longest)        // ~0.86em par glyphe : Archivo Black est très large
  const byHeight = (H * 0.58) / (1.0 * lines)
  return Math.round(Math.max(H * 0.032, Math.min(H * 0.15, Math.min(byWidth, byHeight))))
}

// ── CSS ───────────────────────────────────────────────────────────────────
export function styleCss(style, W, H, SLIDE_H) {
  if (!VSTYLES.includes(style)) return ''
  const fz = (k) => Math.round(SLIDE_H * k)
  if (style === 'apple') return appleCss(W, H, fz)
  if (style === 'editorial') return editoCss(W, H, fz)
  if (style === 'word') return wordCss(W, H, fz)
  return glassCss(W, H, fz)
}

// ══════════════════════════════════════════════════════════ APPLE
function appleCss(W, H, fz) {
  const P = APPLE
  return `
      /* ══ style « Apple » — blanc, typo fine, énormément de vide ══ */
      .vs-apple #slidezone { background: ${P.panel}; background-image: none; }
      .vs-apple #slidezone::after { display: none; }
      .vs-apple .slide { font-family: ${SANS}; gap: ${fz(0.06)}px; }
      .vs-apple .sl-title { color: ${P.mute}; font-weight: 500; font-size: ${fz(0.03)}px; letter-spacing: .26em; }

      /* flow : plus de cartes, du texte posé et espacé */
      .vs-apple .sl-flow { gap: ${fz(0.05)}px; }
      .vs-apple .fl-step { background: transparent; border: none; box-shadow: none;
        color: ${P.ink}; font-weight: 600; font-size: ${fz(0.05)}px; letter-spacing: -.022em;
        padding: 0; max-width: ${Math.round(W * 0.3)}px; }
      .vs-apple .fl-arrow path { stroke: ${P.line}; stroke-width: 4; }

      /* checklist : puce ronde, coche bleue */
      .vs-apple .sl-list { gap: ${fz(0.045)}px; }
      .vs-apple .ck-box { background: ${P.bg}; border: 1px solid rgba(0,0,0,.07); border-radius: 50%;
        box-shadow: 0 8px 22px rgba(0,0,0,.06); }
      .vs-apple .ck-box svg path { stroke: ${P.acc}; stroke-width: 3.6; }
      .vs-apple .ck-txt { color: ${P.ink}; font-weight: 500; letter-spacing: -.015em; }

      .vs-apple .cmp-card.ok, .vs-apple .cmp-card.ko { background: ${P.bg}; border: 1px solid rgba(0,0,0,.07);
        box-shadow: 0 18px 44px rgba(0,0,0,.07); }
      .vs-apple .cmp-badge.ok { background: ${P.acc}; color: #fff; }
      .vs-apple .cmp-badge.ko { background: ${P.panel}; color: #86868B; }
      .vs-apple .cmp-lbl.ok { color: ${P.ink}; } .vs-apple .cmp-lbl.ko { color: #86868B; }

      .vs-apple .st-ticks { display: none; }
      .vs-apple .st-val { color: ${P.ink}; font-weight: 600; font-size: ${fz(0.34)}px;
        letter-spacing: -.045em; text-shadow: none; }
      .vs-apple .st-lbl { color: ${P.mute}; font-weight: 500; font-size: ${fz(0.042)}px; letter-spacing: .2em; }

      .vs-apple .sl-card { background: transparent; color: ${P.ink}; box-shadow: none;
        font-weight: 600; font-size: ${fz(0.068)}px; letter-spacing: -.028em; line-height: 1.08; padding: 0; }

      /* scène plein cadre */
      .vs-apple .fslide { background: ${P.bg}; color: ${P.ink}; }
      .vs-apple .fs-spec { display: none; }
      .vs-apple .fs-eye { font-family: ${SANS}; font-weight: 500; color: ${P.mute}; letter-spacing: .3em; }
      .vs-apple .fs-t { font-family: ${SANS}; font-weight: 600; letter-spacing: -.035em; text-shadow: none;
        text-transform: none; }
      .vs-apple .fs-t .ar { color: ${P.acc}; }
      .vs-apple .sp-bead { background: ${P.panel}; box-shadow: none; }
      .vs-apple .sp-bead span { font-family: ${SANS}; font-weight: 600; color: ${P.acc}; }
      .vs-apple .sp-nd.dark .sp-bead { background: ${P.ink}; }
      .vs-apple .sp-lbl { font-family: ${SANS}; font-weight: 500; letter-spacing: .04em; color: ${P.ink}; }
      .vs-apple .sp-link { background: ${P.line}; }
      .vs-apple .sp-link::before, .vs-apple .sp-link::after { border-color: ${P.line}; }
      .vs-apple .sp-bf { background: #E8E8ED; }
      .vs-apple .sp-bar.hi .sp-bf { background: ${P.acc}; }
      .vs-apple .sp-bar.hi .sp-bv { color: ${P.acc}; }
      .vs-apple .sp-bv { font-family: ${SANS}; font-weight: 600; letter-spacing: -.03em; }
      .vs-apple .sp-bl { font-family: ${SANS}; font-weight: 500; color: #86868B; letter-spacing: .06em; }
      .vs-apple .sp-kn { font-family: ${SANS}; font-weight: 600; letter-spacing: -.055em; }
      .vs-apple .sp-kl { font-family: ${SANS}; font-weight: 500; color: ${P.mute}; letter-spacing: .22em; }
      .vs-apple .sp-kup path { stroke: ${P.acc}; }
      .vs-apple .sp-chart .gl { stroke: rgba(0,0,0,.07); }
      /* la courbe KPI porte ses couleurs en attributs de présentation : le CSS gagne */
      .vs-apple .sp-chart path[fill]:not([fill="none"]) { fill: ${P.acc}; }
      .vs-apple .sp-chart path[stroke]:not([stroke="none"]) { stroke: ${P.acc}; }
      .vs-apple .sp-chart circle { stroke: ${P.acc}; }
      .vs-apple .sp-tm { background: ${P.acc}; box-shadow: 0 20px 50px rgba(0,113,227,.22); }
      .vs-apple .sp-tl, .vs-apple .sp-tv { font-family: ${SANS}; font-weight: 500; }
      .vs-apple .sp-cc { background: ${P.bg}; border: 1px solid rgba(0,0,0,.07); box-shadow: 0 24px 60px rgba(0,0,0,.07); }
      .vs-apple .sp-ct, .vs-apple .sp-cs { font-family: ${SANS}; font-weight: 500; letter-spacing: .04em; }
      .vs-apple .sp-cp { font-family: ${SANS}; font-weight: 600; letter-spacing: -.04em; }
      .vs-apple .sp-cc.ok .sp-cp { color: ${P.acc}; }
      .vs-apple .sp-strike { background: ${P.acc}; }
      .vs-apple .sp-var path { stroke: ${P.line}; }
      .vs-apple .sp-punch { font-family: ${SANS}; font-weight: 600; letter-spacing: -.035em; line-height: 1.04;
        text-transform: none; }
      .vs-apple .sp-punch em { color: ${P.acc}; }

      /* bandeau : carte blanche posée sur la vidéo */
      .vs-apple .fbanner { background: rgba(255,255,255,.94); border: none; border-radius: ${Math.round(H * 0.015)}px;
        box-shadow: 0 30px 80px rgba(0,0,0,.30); }
      .vs-apple .fb-eye { font-family: ${SANS}; font-weight: 500; color: ${P.mute}; letter-spacing: .28em; }
      .vs-apple .fb-t { font-family: ${SANS}; font-weight: 600; color: ${P.ink}; letter-spacing: -.035em; }
      .vs-apple .fb-t em { color: ${P.acc}; }
      .vs-apple .fb-sub { font-family: ${SANS}; font-weight: 400; color: ${P.mute}; }

      /* hook + sous-titres : pas de contour épais, une ombre douce */
      .vs-apple .hook-box { background: rgba(255,255,255,.94); color: ${P.ink};
        font-family: ${SANS}; font-weight: 600; letter-spacing: -.02em; box-shadow: 0 14px 40px rgba(0,0,0,.28); }
      .vs-apple .cap.st-auto { font-family: ${SANS}; font-weight: 600; letter-spacing: -.02em;
        text-shadow: 0 2px 18px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.6); }
      .vs-apple .cap.st-auto::before { display: none; }
      .vs-apple .cap.st-auto.accent { color: #7FB6FF; }
      .vs-apple .cap.st-auto.oncream { color: ${P.ink}; text-shadow: none; }`
}

// ══════════════════════════════════════════════════════════ ÉDITORIAL BLANC
function editoCss(W, H, fz) {
  const P = EDITO
  const dot = Math.round(W * 0.013)
  return `
      /* ══ style « Éditorial blanc » — magazine, trame de points, cartes flottantes ══ */
      .vs-editorial #slidezone { background: ${P.bg};
        background-image: radial-gradient(rgba(17,17,17,.11) 1.4px, transparent 1.5px);
        background-size: ${dot}px ${dot}px; }
      .vs-editorial #slidezone::after { background: ${P.ink}; height: 2px; }
      .vs-editorial .slide { font-family: ${SERIF}; }
      .vs-editorial .sl-title { font-family: ${MONO}; font-weight: 400; color: ${P.mute};
        font-size: ${fz(0.028)}px; letter-spacing: .34em; }

      .vs-editorial .fl-step { background: ${P.bg}; border: 1px solid ${P.line}; color: ${P.ink};
        font-family: ${SERIF}; font-weight: 400; font-size: ${fz(0.056)}px; letter-spacing: 0;
        border-radius: ${fz(0.012)}px; box-shadow: 0 20px 48px rgba(17,17,17,.12); }
      .vs-editorial .fl-arrow path { stroke: ${P.ink}; stroke-width: 4; }

      .vs-editorial .ck-box { background: ${P.bg}; border: 1px solid ${P.line}; border-radius: ${fz(0.008)}px;
        box-shadow: 0 14px 34px rgba(17,17,17,.10); }
      .vs-editorial .ck-box svg path { stroke: ${P.ink}; stroke-width: 3.6; }
      .vs-editorial .ck-txt { color: ${P.ink}; font-family: ${SERIF}; font-weight: 400; letter-spacing: 0; }

      .vs-editorial .cmp-card.ok, .vs-editorial .cmp-card.ko { background: ${P.bg}; border: 1px solid ${P.line};
        border-radius: ${fz(0.012)}px; box-shadow: 0 22px 54px rgba(17,17,17,.12); }
      .vs-editorial .cmp-badge.ok { background: ${P.ink}; color: ${P.bg}; }
      .vs-editorial .cmp-badge.ko { background: #EFEFEF; color: ${P.mute}; }
      .vs-editorial .cmp-lbl.ok { color: ${P.ink}; }
      .vs-editorial .cmp-lbl.ko { color: ${P.mute}; }
      .vs-editorial .cmp-lbl { font-family: ${SERIF}; font-weight: 400; }

      .vs-editorial .st-ticks span { background: ${P.ink}; }
      .vs-editorial .st-val { color: ${P.ink}; font-family: ${SERIF}; font-weight: 400;
        letter-spacing: -.02em; text-shadow: none; }
      .vs-editorial .st-lbl { color: ${P.mute}; font-family: ${MONO}; font-weight: 400; letter-spacing: .3em; }

      .vs-editorial .sl-card { background: ${P.bg}; color: ${P.ink}; font-family: ${SERIF}; font-weight: 400;
        border: 1px solid ${P.line}; border-radius: ${fz(0.012)}px; box-shadow: 0 28px 64px rgba(17,17,17,.14); }

      /* scène plein cadre : la même page blanche, sans le crème */
      .vs-editorial .fslide { background: ${P.bg};
        background-image: radial-gradient(rgba(17,17,17,.09) 1.4px, transparent 1.5px);
        background-size: ${Math.round(W * 0.015)}px ${Math.round(W * 0.015)}px; color: ${P.ink}; }
      .vs-editorial .fs-spec { background: rgba(17,17,17,.16); }
      .vs-editorial .fs-eye { font-family: ${MONO}; font-weight: 400; color: ${P.mute}; letter-spacing: .42em; }
      .vs-editorial .fs-t { font-family: ${SERIF}; font-weight: 400; letter-spacing: -.005em; text-shadow: none;
        text-transform: none; }
      .vs-editorial .fs-t .ar { color: ${P.ink}; font-style: italic; }
      .vs-editorial .sp-bead { background: ${P.bg}; border: 1px solid ${P.line}; box-shadow: 0 16px 40px rgba(17,17,17,.10); }
      .vs-editorial .sp-bead span { font-family: ${SERIF}; font-weight: 400; color: ${P.ink}; }
      .vs-editorial .sp-nd.dark .sp-bead { background: ${P.ink}; }
      .vs-editorial .sp-lbl { font-family: ${MONO}; font-weight: 400; letter-spacing: .16em; color: ${P.ink}; }
      .vs-editorial .sp-link { background: ${P.ink}; height: 2px; }
      .vs-editorial .sp-link::before, .vs-editorial .sp-link::after { border-color: ${P.ink}; }
      .vs-editorial .sp-bf { background: #ECECEC; }
      .vs-editorial .sp-bar.hi .sp-bf { background: ${P.ink}; }
      .vs-editorial .sp-bar.hi .sp-bv { color: ${P.ink}; }
      .vs-editorial .sp-bv { font-family: ${SERIF}; font-weight: 400; }
      .vs-editorial .sp-bl { font-family: ${MONO}; font-weight: 400; color: ${P.mute}; letter-spacing: .14em; }
      .vs-editorial .sp-kn { font-family: ${SERIF}; font-weight: 400; letter-spacing: -.03em; }
      .vs-editorial .sp-kl { font-family: ${MONO}; font-weight: 400; color: ${P.mute}; letter-spacing: .26em; }
      .vs-editorial .sp-kup path { stroke: ${P.ink}; }
      .vs-editorial .sp-chart .gl { stroke: rgba(17,17,17,.08); }
      .vs-editorial .sp-chart path[fill]:not([fill="none"]) { fill: ${P.ink}; }
      .vs-editorial .sp-chart path[stroke]:not([stroke="none"]) { stroke: ${P.ink}; }
      .vs-editorial .sp-chart circle { stroke: ${P.ink}; }
      .vs-editorial .sp-tm { background: ${P.ink}; box-shadow: 0 20px 50px rgba(17,17,17,.24); }
      .vs-editorial .sp-tl, .vs-editorial .sp-tv { font-family: ${MONO}; font-weight: 400; }
      .vs-editorial .sp-cc { background: ${P.bg}; border: 1px solid ${P.line}; box-shadow: 0 26px 62px rgba(17,17,17,.12); }
      .vs-editorial .sp-ct { font-family: ${MONO}; font-weight: 400; letter-spacing: .16em; }
      .vs-editorial .sp-cp { font-family: ${SERIF}; font-weight: 400; letter-spacing: -.02em; }
      .vs-editorial .sp-cc.ok .sp-cp { color: ${P.ink}; }
      .vs-editorial .sp-cs { font-family: ${MONO}; font-weight: 400; color: ${P.mute}; }
      .vs-editorial .sp-strike { background: ${P.ink}; }
      .vs-editorial .sp-var path { stroke: ${P.ink}; }
      .vs-editorial .sp-punch { font-family: ${SERIF}; font-weight: 400; letter-spacing: -.01em; line-height: 1.02;
        text-transform: none; }
      .vs-editorial .sp-punch em { font-style: italic; color: ${P.ink}; }

      .vs-editorial .fbanner { background: rgba(255,255,255,.95); border: 1px solid ${P.line};
        border-radius: ${Math.round(H * 0.012)}px; box-shadow: 0 30px 80px rgba(0,0,0,.34); }
      .vs-editorial .fb-eye { font-family: ${MONO}; font-weight: 400; color: ${P.mute}; letter-spacing: .34em; }
      .vs-editorial .fb-t { font-family: ${SERIF}; font-weight: 400; color: ${P.ink}; letter-spacing: -.01em; }
      .vs-editorial .fb-t em { color: ${P.ink}; font-style: italic; }
      .vs-editorial .fb-sub { font-family: ${MONO}; font-weight: 400; font-size: ${Math.round(H * 0.015)}px;
        color: ${P.mute}; letter-spacing: .1em; }

      .vs-editorial .hook-box { background: rgba(255,255,255,.95); color: ${P.ink};
        font-family: ${SERIF}; font-weight: 400; letter-spacing: 0; box-shadow: 0 14px 40px rgba(0,0,0,.3); }
      .vs-editorial .cap.st-auto { font-family: ${SERIF}; font-weight: 400; letter-spacing: 0;
        text-shadow: 0 2px 16px rgba(0,0,0,.6), 0 1px 3px rgba(0,0,0,.65); }
      .vs-editorial .cap.st-auto::before { display: none; }
      .vs-editorial .cap.st-auto.accent { color: #FFFFFF; font-style: italic; }
      .vs-editorial .cap.st-auto.oncream { color: ${P.ink}; text-shadow: none; }`
}

// ══════════════════════════════════════════════════════════ MOT PAR MOT
function wordCss(W, H, fz) {
  return `
      /* ══ style « Mot par mot » — plein écran uni, UN mot énorme à la fois ══ */
      .vs-word #slidezone { height: ${H}px; background: ${WORD_BG[0]}; background-image: none; z-index: 5; }
      .vs-word #slidezone::after { display: none; }
      .vs-word .slide { left: 0; right: 0; top: 0; height: ${H}px; padding: 0; z-index: 6; }
      /* la forme découpée reste DERRIÈRE le mot : GSAP pilote son opacité (cf. WORD_SHAPE_A),
         une opacité inline serait écrasée par le tween autoAlpha */
      .wd-shape { position: absolute; z-index: 0; border-radius: 50%; will-change: transform, opacity;
        filter: blur(${Math.round(H * 0.006)}px); }
      .wd-w { position: absolute; z-index: 1; inset: 0; display: flex; align-items: center; justify-content: center;
        padding: 0 5%; text-align: center; will-change: transform, opacity; }
      .wd-w span { font-family: ${BLACK}; font-weight: 900; text-transform: uppercase;
        letter-spacing: -.035em; line-height: .92; display: block; max-width: 100%; overflow: hidden; }
      /* le mot porte déjà le message : le sous-titre est retiré pendant ces plans */
      .vs-word .hook-box { background: ${WORD_FG[0]}; color: #14100A; font-family: ${BLACK}; }

      /* les scènes plein cadre et les bandeaux suivent la même palette, sinon la vidéo
         a l'air de changer de style en cours de route */
      .vs-word .fslide { background: ${WORD_BG[0]}; color: #fff; }
      .vs-word .fs-spec { background: rgba(255,229,0,.20); }
      .vs-word .fs-eye { color: ${WORD_FG[0]}; }
      .vs-word .fs-t { color: #fff; text-shadow: none; }
      .vs-word .fs-t .ar { color: ${WORD_FG[0]}; }
      .vs-word .sp-bead { background: #251D3C; box-shadow: none; }
      .vs-word .sp-bead span { color: ${WORD_FG[0]}; }
      .vs-word .sp-nd.dark .sp-bead { background: ${WORD_FG[0]}; }
      .vs-word .sp-nd.dark .sp-bead span { color: #14100A; }
      .vs-word .sp-lbl { color: #fff; }
      .vs-word .sp-link { background: ${WORD_FG[0]}; }
      .vs-word .sp-link::before, .vs-word .sp-link::after { background: ${WORD_BG[0]}; border-color: ${WORD_FG[0]}; }
      .vs-word .sp-bf { background: #2C2447; }
      .vs-word .sp-bar.hi .sp-bf { background: ${WORD_FG[0]}; }
      .vs-word .sp-bar.hi .sp-bv { color: ${WORD_FG[0]}; }
      .vs-word .sp-bv { color: #fff; }
      .vs-word .sp-bl { color: rgba(255,255,255,.55); }
      .vs-word .sp-kn { color: #fff; }
      .vs-word .sp-kl { color: ${WORD_FG[0]}; }
      .vs-word .sp-kup path { stroke: ${WORD_FG[0]}; }
      .vs-word .sp-chart .gl { stroke: rgba(255,255,255,.12); }
      .vs-word .sp-chart path[fill]:not([fill="none"]) { fill: ${WORD_FG[0]}; }
      .vs-word .sp-chart path[stroke]:not([stroke="none"]) { stroke: ${WORD_FG[0]}; }
      .vs-word .sp-chart circle { fill: ${WORD_BG[0]}; stroke: ${WORD_FG[0]}; }
      .vs-word .sp-tm { background: ${WORD_FG[0]}; box-shadow: 0 20px 50px rgba(255,229,0,.18); }
      .vs-word .sp-tl { color: rgba(255,255,255,.6); }
      .vs-word .sp-tv { color: #fff; }
      .vs-word .sp-cc { background: #1E1834; border-color: rgba(255,255,255,.12); box-shadow: none; }
      .vs-word .sp-ct, .vs-word .sp-cp { color: #fff; }
      .vs-word .sp-cc.ok .sp-cp { color: ${WORD_FG[0]}; }
      .vs-word .sp-cs { color: rgba(255,255,255,.5); }
      .vs-word .sp-strike { background: #FF6B35; }
      .vs-word .sp-var path { stroke: ${WORD_FG[0]}; }
      .vs-word .sp-punch { color: #fff; }
      .vs-word .sp-punch em { color: ${WORD_FG[0]}; }
      .vs-word .cap.oncream.accent { color: ${WORD_FG[0]}; }
      .vs-word .fbanner { background: ${WORD_BG[0]}; border-color: ${WORD_FG[0]}; }
      .vs-word .fb-eye { color: ${WORD_FG[0]}; }
      .vs-word .fb-t em { color: ${WORD_FG[0]}; }`
}

// ══════════════════════════════════════════════════════════ LIQUID GLASS
// (les cartes des slides + le bandeau ; la distorsion feDisplacementMap n'est
//  appliquée qu'au liseré — sur le texte elle le rendrait illisible)
function glassCss(W, H, fz) {
  const pane = `
        background: rgba(255,255,255,.10) !important;
        backdrop-filter: blur(${fz(0.026)}px) saturate(180%);
        -webkit-backdrop-filter: blur(${fz(0.026)}px) saturate(180%);
        border: 1px solid rgba(255,255,255,.22) !important;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.45),
          inset 0 -1px 0 rgba(0,0,0,.25),
          inset 0 ${fz(0.012)}px ${fz(0.03)}px rgba(255,255,255,.12),
          0 ${fz(0.018)}px ${fz(0.045)}px rgba(0,0,0,.45) !important;
        position: relative; overflow: hidden;`
  const spec = `
        content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
        background: linear-gradient(135deg, rgba(255,255,255,.28) 0%, rgba(255,255,255,.06) 34%, rgba(255,255,255,0) 58%);`
  const edge = (w) => `
        content: ""; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none;
        border: ${w}px solid rgba(255,255,255,.30); filter: url(#glassEdge);`
  return `
      /* ══ style « Liquid glass » ══ */
      /* la zone slides couvre tout l'écran et laisse la vidéo intacte dessous : le verre
         a enfin quelque chose à réfracter. Un léger dégradé sombre en haut garde le texte
         lisible quel que soit le plan filmé. */
      .vs-glass #slidezone { height: ${H}px; z-index: 5; background-image: none;
        background: linear-gradient(180deg, rgba(6,6,10,.46) 0%, rgba(6,6,10,.30) 34%, rgba(6,6,10,0) 52%); }
      .vs-glass #slidezone::after { display: none; }
      .vs-glass .slide { z-index: 6; }
      .vs-glass .sl-title { color: rgba(255,255,255,.92); text-shadow: 0 2px 14px rgba(0,0,0,.75); }
      .vs-glass .fl-step, .vs-glass .ck-box, .vs-glass .cmp-card, .vs-glass .sl-card { ${pane} }
      .vs-glass .fl-step::after, .vs-glass .ck-box::after, .vs-glass .cmp-card::after, .vs-glass .sl-card::after { ${spec} }
      .vs-glass .fl-step::before, .vs-glass .ck-box::before, .vs-glass .cmp-card::before, .vs-glass .sl-card::before { ${edge(fz(0.004))} }
      .vs-glass .sl-card { color: #fff; }
      .vs-glass .cmp-lbl.ok { color: #8AF0AE; } .vs-glass .cmp-lbl.ko { color: #FFA8A0; }
      .vs-glass .st-val { text-shadow: 0 10px 40px rgba(0,0,0,.55); }

      /* #130 · le bandeau posé sur la vidéo passe lui aussi en verre */
      .vs-glass .fbanner { ${pane} border-radius: ${Math.round(H * 0.018)}px !important; }
      .vs-glass .fbanner::after { ${spec} }
      .vs-glass .fbanner::before { ${edge(Math.max(2, Math.round(H * 0.0016)))} }
      .vs-glass .fb-eye { color: rgba(255,255,255,.86); }
      .vs-glass .fb-t { color: #fff; text-shadow: 0 4px 24px rgba(0,0,0,.45); }
      .vs-glass .fb-t em { color: #fff; }
      .vs-glass .cap.oncream.accent { color: #9FD2FF; }
      .vs-glass .hook-box { ${pane} color: #fff; border-radius: ${Math.round(H * 0.012)}px !important; }

      /* la scène plein cadre masque la vidéo : sans elle repeinte, le montage
         passerait sans prévenir du verre au crème éditorial */
      .vs-glass .fslide { background: radial-gradient(${Math.round(W * 1.1)}px ${Math.round(H * 0.5)}px at 50% 16%,
        #2A2E36 0%, #16181D 58%, #0C0D10 100%); color: #fff; }
      .vs-glass .fs-spec { background: rgba(255,255,255,.14); }
      .vs-glass .fs-eye { color: rgba(255,255,255,.72); }
      .vs-glass .fs-t { color: #fff; text-shadow: 0 6px 30px rgba(0,0,0,.5); }
      .vs-glass .fs-t .ar { color: #9FD2FF; }
      .vs-glass .sp-bead { background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.22);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.4), 0 18px 44px rgba(0,0,0,.45); }
      .vs-glass .sp-bead span { color: #fff; }
      .vs-glass .sp-nd.dark .sp-bead { background: rgba(255,255,255,.22); }
      .vs-glass .sp-lbl { color: #fff; }
      .vs-glass .sp-link { background: rgba(255,255,255,.5); }
      .vs-glass .sp-link::before, .vs-glass .sp-link::after { background: #16181D; border-color: rgba(255,255,255,.5); }
      .vs-glass .sp-bf { background: rgba(255,255,255,.14); }
      .vs-glass .sp-bar.hi .sp-bf { background: rgba(159,210,255,.85); }
      .vs-glass .sp-bar.hi .sp-bv { color: #9FD2FF; }
      .vs-glass .sp-bv { color: #fff; }
      .vs-glass .sp-bl { color: rgba(255,255,255,.55); }
      .vs-glass .sp-kn { color: #fff; }
      .vs-glass .sp-kl { color: rgba(255,255,255,.6); }
      .vs-glass .sp-kup path { stroke: #9FD2FF; }
      .vs-glass .sp-chart .gl { stroke: rgba(255,255,255,.12); }
      .vs-glass .sp-chart path[fill]:not([fill="none"]) { fill: #9FD2FF; }
      .vs-glass .sp-chart path[stroke]:not([stroke="none"]) { stroke: #9FD2FF; }
      .vs-glass .sp-chart circle { fill: #16181D; stroke: #9FD2FF; }
      .vs-glass .sp-tm { background: rgba(159,210,255,.8); box-shadow: 0 20px 50px rgba(0,0,0,.4); }
      .vs-glass .sp-tl { color: rgba(255,255,255,.6); }
      .vs-glass .sp-tv { color: #fff; }
      .vs-glass .sp-cc { ${pane} }
      .vs-glass .sp-cc::after { ${spec} }
      .vs-glass .sp-ct, .vs-glass .sp-cp { color: #fff; }
      .vs-glass .sp-cc.ok .sp-cp { color: #8AF0AE; }
      .vs-glass .sp-cs { color: rgba(255,255,255,.5); }
      .vs-glass .sp-var path { stroke: rgba(255,255,255,.7); }
      .vs-glass .sp-punch { color: #fff; }
      .vs-glass .sp-punch em { color: #9FD2FF; }
      /* les flèches jaunes jurent avec le verre */
      .vs-glass .fl-arrow path { stroke: rgba(255,255,255,.75); }
      .vs-glass .ck-box svg path { stroke: #fff; }`
}

// Filet de sécurité « mot par mot » : le calcul de taille au build est une estimation
// (on ne peut pas mesurer un glyphe côté Node). Une fois les polices chargées, on
// réduit les mots qui dépassent encore. Déterministe : mêmes polices → même résultat.
export const WORD_FIT_JS = `
      (function () {
        function fit() {
          var ws = document.querySelectorAll('.wd-w');
          for (var i = 0; i < ws.length; i++) {
            var box = ws[i], sp = box.firstElementChild;
            if (!sp) continue;
            var size = parseFloat(sp.style.fontSize) || 0, guard = 0;
            while (guard++ < 40 && size > 24 &&
                   (sp.scrollWidth > sp.clientWidth + 1 || sp.scrollHeight > box.clientHeight - 2)) {
              size = Math.floor(size * 0.93);
              sp.style.fontSize = size + 'px';
            }
          }
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); else fit();
      })();`

// ── retouches de timeline propres à un style ──────────────────────────────
// Apple = mouvement lent et continu : chaque plan dérive doucement pendant toute
// sa durée (le « slow motion » des pubs Apple), en plus des apparitions de base.
export function styleExtraJs(style, r2, groups) {
  if (style !== 'apple') return ''
  const drift = (id, start, dur, from) => `
      tl.fromTo('#${id}', { scale: ${from} }, { scale: 1, duration: ${r2(Math.max(0.6, dur))}, ease: 'none' }, ${r2(start)});`
  let js = ''
  for (const s of groups.slides || []) js += drift(s.id, s.start, s.dur, 1.045)
  for (const s of groups.fulls || []) js += drift(s.id, s.start, s.dur, 1.03)
  for (const s of groups.banners || []) js += drift(s.id, s.start + 0.4, s.dur - 0.4, 1.02)
  return js
}
