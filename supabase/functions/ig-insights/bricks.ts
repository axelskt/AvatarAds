// Reconnaissance des briques (hook, liaison, CTA) d'une publication à partir de la transcription de son audio.
// Fonctions pures (testées) : score = moitié mots communs, moitié enchaînements de deux mots communs, rapportés au
// texte de la BRIQUE (contenance : le reel dit la brique, plus le reste). Un hook se cherche dans les 12 premières
// secondes, un CTA dans les 15 dernières, une liaison partout ; en dessous du seuil, rien (jamais une brique devinée).
export type Seg = { s: number, e: number, t: string }
export type Brick = { id: string, kind: string, subject: string, text: string, keyword?: string | null, modules?: string[] }
export type Found = { kind: string, id: string, score: number }

const STOP = new Set(('le la les l un une des de du d et a au aux en pour par que qu qui ce c ca cette ces tu te t ton ta tes toi ' +
  'je j me m mon ma mes moi il elle on nous vous ils elles est es sont suis etre ai as avoir ne n pas plus sur dans avec se s sa ' +
  'son ses y si ou comme mais donc alors tout tous toute toutes tres bien ok euh bon ben voila ici la-bas oui non').split(' '))

export function norm(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d)\s*€/g, '$1 euros').replace(/(\d)\s*\$/g, '$1 dollars').replace(/(\d)\s*s\b/g, '$1 secondes')
    .replace(/(\d)\s*min\b/g, '$1 minutes').replace(/(\d)\s*h\b/g, '$1 heures').replace(/</g, ' moins de ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}
// Racine grossière (tester / teste / testes → test) : la brique et le reel ne conjuguent pas toujours pareil.
function stem(w: string): string {
  if (w.length <= 4) return w
  return w.replace(/(ements|ement|ations|ation|euses|euse|eurs|eur|ees|ee|es|er|ez|ent|e|s)$/, '')
}
export function toks(s: string): string[] {
  return norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w) && w !== 'cta').map(stem)
}
function bigrams(t: string[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 1 < t.length; i++) out.add(t[i] + ' ' + t[i + 1])
  return out
}
export function score(brickText: string, windowText: string): number {
  const b = toks(brickText), w = toks(windowText)
  if (b.length < 2 || !w.length) return 0
  const W = new Set(w), B = new Set(b)
  let hit = 0
  for (const x of B) if (W.has(x)) hit++
  const uni = hit / B.size
  const bb = bigrams(b), wb = bigrams(w)
  let hb = 0
  for (const x of bb) if (wb.has(x)) hb++
  const bi = bb.size ? hb / bb.size : uni
  return Math.round((0.5 * uni + 0.5 * bi) * 100) / 100
}

export const HOOK_MIN = 0.55, LIAISON_MIN = 0.55, CTA_MIN = 0.5

export function matchBricks(segs: Seg[], caption: string, bricks: Brick[]): { found: Found[], module: string | null } {
  const end = segs.length ? Math.max(...segs.map((x) => x.e)) : 0
  const txt = (a: number, b: number) => segs.filter((x) => x.e > a && x.s < b).map((x) => x.t).join(' ')
  const head = txt(0, 12), all = segs.map((x) => x.t).join(' '), tail = txt(Math.max(0, end - 15), end + 1)
  const cap = norm(caption)
  const best = (kind: string, win: string, min: number, bonus?: (b: Brick) => number) => {
    let top: { b: Brick, score: number } | null = null
    for (const b of bricks) {
      if (b.kind !== kind) continue
      const sc = Math.min(1, score(b.text, win) + (bonus ? bonus(b) : 0))
      if (!top || sc > top.score) top = { b, score: sc }
    }
    return top && top.score >= min ? top : null
  }
  const found: Found[] = []
  const hook = best('hook', head, HOOK_MIN)
  if (hook) found.push({ kind: 'hook', id: hook.b.id, score: hook.score })
  const liaison = best('liaison', all, LIAISON_MIN)
  if (liaison) found.push({ kind: 'liaison', id: liaison.b.id, score: liaison.score })
  // CTA : le mot-clé demandé en légende (« Commente SITE ») départage les variantes d'un même mot-clé.
  const kw = (b: Brick) => (b.keyword && new RegExp('\\b' + norm(b.keyword) + '\\b').test(cap) ? 0.1 : 0)
  const cta = best('cta', tail, CTA_MIN, kw) || best('cta', all, CTA_MIN + 0.1, kw)
  if (cta) found.push({ kind: 'cta', id: cta.b.id, score: cta.score })
  let module: string | null = null
  if (hook) {
    const sub = hook.b.subject
    if (sub && !['generique', 'general'].includes(sub)) module = sub
    else if (hook.b.modules && hook.b.modules.length === 1 && !['generique', 'general'].includes(hook.b.modules[0])) module = hook.b.modules[0]
  }
  return { found, module }
}
