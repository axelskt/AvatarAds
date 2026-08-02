// ── #24 · LA PASSE DE FINITION ───────────────────────────────────────────────
//
// Axel, 02/08 : « il faut qu'il voie son travail et fasse les finitions, c'est
// ça qui manque ! »
//
// Le chef d'orchestre écrit son plan À L'AVEUGLE : il propose des animations sur
// des mots, puis la dérivation les déplace, les remplace, en refuse la moitié et
// en ajoute d'autres. Ce qui arrive à l'écran ne lui est jamais montré. C'est
// exactement pour ça que les mêmes défauts reviennent d'une version à l'autre :
// personne ne relit la copie.
//
// Ici on lui rend sa vidéo. On lui envoie la LIGNE DE TEMPS RÉELLE — ce que le
// spectateur verra, seconde par seconde, avec les mots prononcés en face — et il
// n'a qu'un travail : repérer ce qui ne colle pas et le corriger.
//
// Trois corrections possibles, et trois seulement :
//   remplace|t|animation   une animation ne correspond pas à ce qui est dit
//   supprime|t             une scène ne montre rien qui serve le propos
//   garde|                 (ligne de politesse, ignorée)
//
// Il ne peut PAS toucher aux temps. Le placement, l'ancrage sur le mot, les
// planchers de durée, l'unicité : tout ça est déterministe, mesuré, et corrigé
// une trentaine de fois. On ne rouvre pas ça à un modèle — on lui demande de
// juger le SENS, ce que le code ne sait pas faire.
//
// Le worker applique ensuite chaque correction en la repassant par ses propres
// garde-fous : une finition n'a aucun privilège, elle propose comme les autres.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-sonnet-5'

type Scene = { start: number; end: number; quoi: string; dit: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  const anthKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!anthKey) return json({ ok: false, corrections: [], erreur: 'ANTHROPIC_API_KEY manquante' })

  let body: { scenes?: Scene[]; anims?: string[]; catalogue?: string; duree?: number; brief?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON invalide' }, 400) }

  const scenes = (body.scenes || []).filter((s) => s && typeof s.start === 'number').slice(0, 40)
  const anims = (body.anims || []).map(String).filter(Boolean)
  if (!scenes.length || !anims.length) return json({ ok: true, corrections: [], note: 'rien à relire' })

  // Chaque plan est NUMÉROTÉ, et la correction se réfère au numéro. Premier essai
  // avec le timestamp : le modèle a répondu `remplace|animation grow|faceless` —
  // la bonne correction, mais désignée par son libellé, donc illisible. Un
  // numéro ne s'interprète pas.
  const ligneDeTemps = scenes.map((s, i) =>
    `#${i + 1}  ${s.start.toFixed(1)}s→${s.end.toFixed(1)}s  ${s.quoi}  |  il dit : « ${String(s.dit || '').slice(0, 110)} »`,
  ).join('\n')

  const system = `Tu viens de monter cette vidéo verticale. On te montre le RÉSULTAT : ce que le spectateur va voir, dans l'ordre, avec les mots prononcés en face de chaque plan.

Ton seul travail : la FINITION. Relis ta copie et corrige ce qui ne colle pas.

${body.catalogue || `Animations disponibles : ${anims.join(', ')}`}

CE QUE TU CHERCHES, dans cet ordre d'importance :
1. UNE ANIMATION QUI NE MONTRE PAS CE QUI EST DIT. C'est la faute grave. Le visuel doit correspondre au MOT, pas à une idée vaguement voisine : une courbe de croissance sur « sans jamais passer devant une caméra » est fausse, même si la phrase parle de business.
2. UNE SCÈNE QUI NE MONTRE RIEN D'UTILE. Un panneau décoratif qui n'ajoute rien au propos vaut moins que le visage de la personne qui parle. Supprime-la.
3. DEUX PLANS VOISINS QUI RACONTENT LA MÊME CHOSE. Garde le meilleur.

CE QUE TU NE PEUX PAS FAIRE : changer les temps, déplacer un plan, allonger ou raccourcir. Les captures d'écran (« capture … »), les médias de l'utilisateur (« média … ») et le visage (« avatar ») ne se touchent PAS non plus : ils ont été placés sur des règles que tu ne vois pas ici.

FORMAT — une ligne par correction, rien d'autre, aucune phrase autour. Le plan se
désigne par SON NUMÉRO (#3 → 3), jamais par son nom ni par son temps :
  remplace|3|<une animation de la liste>
  supprime|7

Si tout est juste, réponds exactement : RAS

Sois EXIGEANT mais pas bavard : au maximum 6 corrections, les plus flagrantes. Une correction qui remplace une animation correcte par une autre correcte ne sert à rien — tu ne corriges que ce qui est FAUX.`

  const user = `Durée : ${(body.duree || 0).toFixed(1)}s${body.brief ? `\nCe que l'utilisateur voulait mettre en avant : ${String(body.brief).slice(0, 400)}` : ''}

LA VIDÉO, PLAN PAR PLAN :
${ligneDeTemps}

Tes corrections :`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 900,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) return json({ ok: false, corrections: [], erreur: `Claude ${res.status}` })
    const data = await res.json()
    const texte = String((data?.content || []).map((c: { text?: string }) => c?.text || '').join('\n'))

    const corrections: { action: string; t: number; anim: string }[] = []
    const refus: string[] = []
    for (const ligne of texte.split('\n')) {
      const p = ligne.split('|').map((x) => x.trim())
      const action = (p[0] || '').toLowerCase()
      if (action !== 'remplace' && action !== 'supprime') continue
      // le numéro du plan (« 3 », « #3 ») ; on tolère aussi un timestamp
      const brutRef = String(p[1] || '').replace('#', '').replace(',', '.').trim()
      const n = parseInt(brutRef, 10)
      let cible = (n >= 1 && n <= scenes.length && !brutRef.includes('s') && !brutRef.includes('.'))
        ? scenes[n - 1] : undefined
      if (!cible) {
        const t = parseFloat(brutRef.replace('s', ''))
        if (isFinite(t)) cible = scenes.find((s) => Math.abs(s.start - t) < 0.35)
      }
      if (!cible) { refus.push(`« ${p[1]} » : aucun plan désigné`); continue }
      const t = cible.start
      // les captures, les médias et le visage ne se corrigent pas ici
      if (/^(capture|média|media|avatar)/i.test(cible.quoi)) { refus.push(`${t}s : ${cible.quoi} — hors de sa portée`); continue }
      if (action === 'supprime') { corrections.push({ action, t: cible.start, anim: '' }); continue }
      const an = (p[2] || '').toLowerCase()
      if (!anims.includes(an)) { refus.push(`${t}s : « ${an} » n'existe pas`); continue }
      corrections.push({ action, t: cible.start, anim: an })
    }
    return json({ ok: true, corrections: corrections.slice(0, 6), refus, brut: texte.slice(0, 400) })
  } catch (e) {
    return json({ ok: false, corrections: [], erreur: String(e).slice(0, 200) })
  }
})
