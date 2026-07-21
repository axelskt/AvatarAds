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

// ── zone sûre TikTok / Reels / Shorts ────────────────────────────────────
// Cumul du pire cas des trois plateformes : barre de statut + recherche en haut,
// colonne photo de profil / like / commentaire / partage à droite, pseudo +
// description + barre de lecture en bas. Rien de lisible ne doit y tomber.
export const SAFE = { top: 0.12, bottom: 0.22, left: 0.04, right: 0.20 }
export const safeX = (W) => ({ min: Math.round(W * SAFE.left), max: Math.round(W * (1 - SAFE.right)) })
// Un texte CENTRÉ reste centré sur W/2 : sa demi-largeur ne doit donc pas dépasser
// le bord le plus proche — à droite, la colonne de boutons.
export const SAFE_CENTERED_W = 2 * (0.5 - SAFE.right)   // 0.60 de la largeur

// ── palettes ──────────────────────────────────────────────────────────────
export const APPLE = { bg: '#FFFFFF', panel: '#F5F5F7', ink: '#1D1D1F', mute: '#6E6E73', line: '#D2D2D7', acc: '#0071E3' }
export const EDITO = { bg: '#FFFFFF', ink: '#111111', mute: '#8A8A8A', line: 'rgba(17,17,17,.12)' }
// « mot par mot » : page blanche, encre noire, et des formes de couleur franche
export const WORD_PAPER = '#FFFFFF'
export const WORD_INK = '#111111'
export const WORD_SHAPES = ['#FF5A36', '#2F6BFF', '#12B76A', '#FFC300', '#7A3BFF']
export const WORD_ACCENT = '#FF5A36'   // le mot que le chef d'orchestre veut appuyer

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
  // ~0.55em par glyphe en Inter semibold ; le filet WORD_FIT_JS rattrape les cas
  // limites une fois la police vraiment chargée.
  // borné à la largeur centrée sûre : au-delà, le mot passe sous la colonne like/partage
  const byWidth = (W * SAFE_CENTERED_W) / (0.55 * longest)
  const byHeight = (H * 0.20) / (1.2 * lines)
  return Math.round(Math.max(H * 0.016, Math.min(H * 0.028, Math.min(byWidth, byHeight))))
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
// AUCUN clip : la vidéo source n'apparaît jamais. Écran blanc du début à la fin,
// UN mot à la fois au centre (le sous-titre lui-même, mot par mot), et des formes
// animées qui illustrent ce que dit l'audio. C'est un mode de rendu à part entière,
// pas une surcouche posée sur la vidéo.
function wordCss(W, H, fz) {
  return `
      /* ══ style « Mot par mot » — page blanche, un mot, des formes animées ══ */
      .vs-word, .vs-word body { background: ${WORD_PAPER}; }
      .vs-word #videozone, .vs-word .fslide, .vs-word .fbanner,
      .vs-word #hook, .vs-word #flash { display: none !important; }
      /* les IMAGES de l'utilisateur restent : carte posée sur la page blanche, au-dessus
         de la bande du mot pour ne pas le recouvrir. Une forme géométrique n'illustre
         rien — une capture de son produit, si. */
      .vs-word .broll { background: none; align-items: flex-start; padding-top: ${Math.round(H * SAFE.top + H * 0.01)}px; z-index: 4; }
      .vs-word .broll-card { max-width: ${Math.round(W * SAFE_CENTERED_W)}px; max-height: ${Math.round(H * 0.29)}px;
        border: 1px solid rgba(17,17,17,.10); border-radius: ${Math.round(H * 0.012)}px;
        box-shadow: 0 ${Math.round(H * 0.012)}px ${Math.round(H * 0.035)}px rgba(17,17,17,.16); }
      .vs-word .broll-card img, .vs-word .broll-card video { max-height: ${Math.round(H * 0.29)}px; }
      /* MOMENT FORT : l'image PREND toute la zone sûre et cache le sous-titre —
         12 % → 78 % en hauteur, 4 % → 80 % en largeur. Aucun texte par-dessus. */
      .vs-word .broll.hero { align-items: center; justify-content: center; padding: 0; }
      .vs-word .broll.hero .broll-card { max-width: ${Math.round(W * 0.76)}px; max-height: ${Math.round(H * 0.62)}px;
        border-radius: ${Math.round(H * 0.016)}px;
        box-shadow: 0 ${Math.round(H * 0.024)}px ${Math.round(H * 0.06)}px rgba(17,17,17,.26); }
      .vs-word .broll.hero .broll-card img, .vs-word .broll.hero .broll-card video { max-height: ${Math.round(H * 0.62)}px; }
      .vs-word #slidezone { left: 0; top: 0; width: ${W}px; height: ${H}px; z-index: 1;
        background: ${WORD_PAPER}; background-image: none; }
      .vs-word #slidezone::after { display: none; }
      .vs-word .slide { left: 0; right: 0; top: 0; height: ${H}px; padding: 0; z-index: 2;
        display: block; }

      /* le mot : c'est le sous-titre, en très gros, noir sur blanc */
      /* BANDE DU MOT : 46 % → 68 % de la hauteur. Les visuels (animations, images)
         restent au-dessus de 44 % — les deux zones ne peuvent plus se croiser, quel
         que soit le nombre de lignes du sous-titre. */
      .vs-word .cap { left: 0 !important; right: 0 !important; top: ${Math.round(H * 0.46)}px !important;
        height: ${Math.round(H * 0.22)}px; display: flex; align-items: center; justify-content: center;
        padding: 0 5%; color: ${WORD_INK}; z-index: 6; text-shadow: none; }
      .vs-word .cap::before { display: none; }

      /* CTA DE FIN : la phrase entière, posée au centre, plus grosse que les mots
         du défilement — c'est le moment où on demande quelque chose. */
      .vs-word .ctablk { left: ${Math.round(W * SAFE.left)}px; right: ${Math.round(W * SAFE.right)}px;
        top: ${Math.round(H * 0.30)}px; height: ${Math.round(H * 0.40)}px; z-index: 7;
        display: flex; align-items: center; justify-content: center; text-align: center; }
      .vs-word .ctablk span { font-family: ${SANS}; font-weight: 700; color: ${WORD_INK};
        font-size: ${Math.round(H * 0.042)}px; line-height: 1.22; letter-spacing: -.025em;
        display: block; max-width: 100%; }
      /* chaque mot du CTA est un élément à part : il apparaît sur sa syllabe et reste */
      .vs-word .ctablk span i { font-style: normal; display: inline-block; will-change: transform, opacity; }
      .vs-word .cap span { font-family: ${SANS}; font-weight: 600; text-transform: none;
        letter-spacing: -.02em; line-height: 1.15; display: block; max-width: 100%; overflow: hidden; }

      /* les formes : elles illustrent la section, sans un mot de plus */
      .wm { position: absolute; left: 0; right: 0; z-index: 3; }
      .wm-s { position: absolute; will-change: transform, opacity; }
      .wm-l { position: absolute; height: ${Math.round(H * 0.004)}px; background: ${WORD_INK};
        transform-origin: 0% 50%; will-change: transform, opacity; }
      /* motif « nuage » : les mots-clés éparpillés, même typo que le sous-titre */
      .wm-w { position: absolute; font-family: ${SANS}; font-weight: 500; letter-spacing: -.01em;
        white-space: nowrap; will-change: transform, opacity; }`
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

// ── « mot par mot » : les formes qui illustrent une section ────────────────
// Le mot porte le sens ; la forme porte le rythme. Pas une lettre de plus.
// Le type de scène décidé par le chef d'orchestre choisit le motif ; la position
// est SEEDÉE sur le timestamp (rendu frame par frame = doit être reproductible).
// Le chef d'orchestre choisit le motif SELON L'AUDIO (champ `motif` du plan) ;
// sans choix explicite, on le déduit du type de scène.
export const MOTIFS = ['chain', 'tiles', 'versus', 'bars', 'ring', 'cloud', 'halftone', 'grid']
const MOTIF_BY_TYPE = { flow: 'chain', checklist: 'tiles', compare: 'versus', versus: 'versus',
  stat: 'bars', bars: 'bars', kpi: 'bars', nodes: 'chain', loop: 'ring' }
export function resolveMotif(s) {
  if (MOTIFS.includes(s.motif)) return s.motif
  if (s.type === 'card' && (s.items || []).length > 1) return 'chain'
  return MOTIF_BY_TYPE[s.type] || 'ring'
}

export function wordMotif(s, si, W, H, opts = {}) {
  const items = s.items || []
  const n = Math.max(1, Math.min(5, items.length))
  const motif = resolveMotif(s)
  const col = (k) => WORD_SHAPES[(si + k) % WORD_SHAPES.length]
  const ink = opts.ink || WORD_INK
  const band = Math.round(H * 0.235)                    // au-dessus du mot, hors zone UI
  // largeur utilisable pour un bloc CENTRÉ (au-delà, on passe sous la colonne
  // photo de profil / like / partage) : une chaîne de 5 pastilles à taille pleine
  // faisait 79 % de la largeur, donc largement dans la zone des boutons.
  const usable = W * SAFE_CENTERED_W
  const unit = Math.round(Math.min(H * 0.062, usable / (1 + 1.55 * (n - 1))))
  const gap = Math.round(unit * 1.55)
  const x0 = Math.round(W / 2 - ((n - 1) * gap) / 2 - unit / 2)
  const at = (k) => x0 + k * gap
  const box = (k, extra) => `<span class="wm-s" id="${s.id}m${k}" style="left:${at(k)}px;top:${band}px;` +
    `width:${unit}px;height:${unit}px;background:${col(k)};${extra}"></span>`

  let html = ''
  if (motif === 'chain') {
    for (let k = 0; k < n; k++) {
      html += box(k, 'border-radius:50%')
      if (k > 0) html += `<span class="wm-l" id="${s.id}l${k}" style="left:${at(k - 1) + unit}px;` +
        `top:${band + Math.round(unit / 2)}px;width:${gap - unit}px;background:${ink}"></span>`
    }
  } else if (motif === 'tiles') {
    for (let k = 0; k < n; k++) html += box(k, `border-radius:${Math.round(unit * 0.26)}px`)
  } else if (motif === 'versus') {
    html = box(0, 'border-radius:50%') +
      `<span class="wm-s" id="${s.id}m1" style="left:${at(1)}px;top:${band}px;width:${unit}px;height:${unit}px;` +
      `background:transparent;border:${Math.round(unit * 0.16)}px solid ${col(1)};border-radius:${Math.round(unit * 0.26)}px"></span>`
  } else if (motif === 'bars') {
    for (let k = 0; k < n; k++) {
      const h = Math.round(unit * (0.7 + ((k + 1) / n) * 1.5))
      html += `<span class="wm-s" id="${s.id}m${k}" style="left:${at(k)}px;top:${band + unit * 2 - h}px;` +
        `width:${unit}px;height:${h}px;background:${col(k)};border-radius:${Math.round(unit * 0.16)}px;` +
        `transform-origin:50% 100%"></span>`
    }
  } else if (motif === 'cloud') {
    // les mots-clés éparpillés sur la page, qui arrivent un par un sur l'audio
    const words = items.slice(0, 12)
    const fs = Math.round(H * 0.021)
    html = words.map((it, k) => {
      // Suite dorée + un peu de bruit : le pur tirage aléatoire entassait les mots
      // dans la même colonne, la suite dorée les étale sur toute la largeur.
      const rx = ((k * 0.618 + seeded(Math.round(s.start * 1000) + k * 37) * 0.22) % 1)
      const ry = seeded(Math.round(s.start * 1000) + k * 71)
      const sx = safeX(W)
      const cx = Math.round(sx.min + rx * (sx.max - sx.min))
      // Répartition haut/bas ALTERNÉE plutôt que purement tirée au sort : sur 4 ou 5
      // mots, le hasard les entassait tous du même côté. On évite aussi la bande
      // centrale, occupée par le mot du sous-titre.
      const up = k % 2 === 0
      const half = (k >> 1) + ry
      const nHalf = Math.max(1, words.length / 2)
      // au-dessus / en dessous de la bande centrale du sous-titre
      const t = up ? SAFE.top + 0.015 + 0.26 * (half / nHalf) : 0.60 + 0.16 * (half / nHalf)
      // largeur estimée (~0.5em/glyphe en Inter medium) → le mot est centré sur son
      // point d'ancrage sans transform, que GSAP écraserait en animant scale/y.
      // 0.54 et non 0.50 : la largeur est estimée, mieux vaut la surestimer que
      // laisser un mot mordre sur la colonne de boutons
      const wpx = Math.round(String(it.text).length * fs * 0.54)
      // le mot ENTIER reste dans la zone sûre : ni sous la colonne like/partage,
      // ni sous le pseudo et la description
      const left = Math.min(sx.max - wpx, Math.max(sx.min, cx - Math.round(wpx / 2)))
      const y = Math.min(H * (1 - SAFE.bottom) - fs * 1.3, Math.max(H * SAFE.top, H * t))
      return `<span class="wm-w" id="${s.id}m${k}" style="left:${Math.round(left)}px;` +
        `top:${Math.round(y)}px;font-size:${fs}px;color:${ink}">${escAttr(it.text)}</span>`
    }).join('')
  } else if (motif === 'halftone') {
    // disque en trame de points : une respiration entre deux sections
    const R = Math.round(H * 0.075), step = Math.round(R / 5.5), cx = Math.round(W / 2), cy = band + R
    const dots = []
    for (let gy = -R; gy <= R; gy += step) {
      for (let gx = -R; gx <= R; gx += step) {
        const d = Math.hypot(gx, gy)
        if (d > R) continue
        const r = Math.max(1, Math.round(step * 0.36 * (0.45 + (d / R) * 0.75)))
        dots.push(`<span style="position:absolute;left:${cx + gx - r}px;top:${cy + gy - r}px;` +
          `width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${ink}"></span>`)
      }
    }
    html = `<span class="wm-s" id="${s.id}m0" style="left:0;top:0;width:${W}px;height:${Math.round(H * 0.5)}px;background:none">${dots.join('')}</span>`
  } else if (motif === 'grid') {
    // mosaïque : la même tuile répétée, décalée, avec une ombre douce
    const cols = 6, rows = 5
    const cell = Math.round(Math.min(H * 0.036, (W * SAFE_CENTERED_W) / (cols * 1.5)))
    const gw = cols * cell * 1.5, gx0 = Math.round(W / 2 - gw / 2), gy0 = band - Math.round(cell)
    const cells = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const jx = Math.round((seeded(r * 31 + c * 7) - 0.5) * cell * 0.5)
        const jy = Math.round((seeded(r * 13 + c * 41) - 0.5) * cell * 0.5)
        cells.push(`<span style="position:absolute;left:${gx0 + Math.round(c * cell * 1.5) + jx}px;` +
          `top:${gy0 + Math.round(r * cell * 1.5) + jy}px;width:${cell}px;height:${cell}px;` +
          `border-radius:${Math.round(cell * 0.28)}px;background:${col(0)};box-shadow:0 ${Math.round(cell * 0.16)}px ${Math.round(cell * 0.4)}px rgba(17,17,17,.16)"></span>`)
      }
    }
    html = `<span class="wm-s" id="${s.id}m0" style="left:0;top:0;width:${W}px;height:${Math.round(H * 0.5)}px;background:none">${cells.join('')}</span>`
  } else {
    const big = Math.round(unit * 2.1)
    html = `<span class="wm-s" id="${s.id}m0" style="left:${Math.round(W / 2 - big / 2)}px;top:${band - Math.round(big * 0.2)}px;` +
      `width:${big}px;height:${big}px;background:transparent;border:${Math.round(unit * 0.14)}px solid ${col(0)};border-radius:50%"></span>` +
      `<span class="wm-s" id="${s.id}m1" style="left:${Math.round(W / 2 - unit * 0.42)}px;top:${band + Math.round(big * 0.3)}px;` +
      `width:${Math.round(unit * 0.84)}px;height:${Math.round(unit * 0.84)}px;background:${col(1)};border-radius:50%"></span>`
  }
  return `<div class="wm" id="${s.id}w">${html}</div>`
}

const escAttr = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function wordMotifJs(s, si, r2) {
  const items = s.items || []
  const n = Math.max(1, Math.min(5, items.length))
  const end = r2(s.start + s.dur)
  const motif = resolveMotif(s)
  const tOf = (k) => r2(Math.max(s.start + 0.05, Math.min(end - 0.2, (items[k] || {}).t ?? s.start + 0.1 + k * 0.4)))
  let js = ''

  if (motif === 'cloud') {
    // un mot-clé apparaît sur SON timestamp, puis tout s'efface ensemble
    items.slice(0, 12).forEach((_, k) => {
      js += `
      tl.fromTo('#${s.id}m${k}', { autoAlpha: 0, y: 14, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.8)', transformOrigin: '50% 50%' }, ${tOf(k)});
      tl.to('#${s.id}m${k}', { autoAlpha: 0, duration: 0.18, ease: 'power2.in' }, ${r2(Math.max(tOf(k) + 0.3, end - 0.2))});`
    })
    return js
  }
  if (motif === 'halftone' || motif === 'grid') {
    const t = tOf(0)
    js += `
      tl.fromTo('#${s.id}m0', { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'back.out(1.6)', transformOrigin: '50% 50%' }, ${t});
      tl.to('#${s.id}m0', { scale: ${motif === 'halftone' ? 1.06 : 1.03}, duration: ${r2(Math.max(0.5, s.dur - 0.6))}, ease: 'sine.inOut' }, ${r2(t + 0.4)});
      tl.to('#${s.id}m0', { autoAlpha: 0, scale: 0.86, duration: 0.2, ease: 'power2.in' }, ${r2(Math.max(t + 0.4, end - 0.2))});`
    return js
  }

  const growing = motif === 'bars'
  const ring = motif === 'ring'
  const count = ring || motif === 'versus' ? 2 : n
  for (let k = 0; k < count; k++) {
    const t = tOf(ring ? 0 : k)
    js += growing
      ? `
      tl.fromTo('#${s.id}m${k}', { autoAlpha: 0, scaleY: 0 }, { autoAlpha: 1, scaleY: 1, duration: 0.34, ease: 'power3.out' }, ${t});`
      : `
      tl.fromTo('#${s.id}m${k}', { autoAlpha: 0, scale: 0, y: 18 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.32, ease: 'back.out(2.4)', transformOrigin: '50% 50%' }, ${r2(t + (ring ? k * 0.12 : 0))});`
    js += `
      tl.to('#${s.id}m${k}', { autoAlpha: 0, scale: 0.7, duration: 0.16, ease: 'power2.in' }, ${r2(Math.max(t + 0.3, end - 0.18))});`
  }
  if (ring) js += `
      tl.to('#${s.id}m0', { rotation: 180, duration: ${r2(Math.max(0.6, s.dur))}, ease: 'none' }, ${r2(s.start)});`
  if (motif === 'chain') {
    for (let k = 1; k < n; k++) js += `
      tl.fromTo('#${s.id}l${k}', { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.22, ease: 'power2.out' }, ${r2(Math.max(s.start + 0.05, tOf(k) - 0.16))});
      tl.to('#${s.id}l${k}', { autoAlpha: 0, duration: 0.14, ease: 'power2.in' }, ${r2(Math.max(s.start + 0.4, end - 0.18))});`
  }
  return js
}

// Filet de sécurité « mot par mot » : le calcul de taille au build est une estimation
// (on ne peut pas mesurer un glyphe côté Node). Une fois les polices chargées, on
// réduit les mots qui dépassent encore. Déterministe : mêmes polices → même résultat.
export const WORD_FIT_JS = `
      (function () {
        function fit() {
          var ws = document.querySelectorAll('.vs-word .cap');
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
