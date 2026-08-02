// ── #38 · CRÉER UNE ANIMATION QUI N'EXISTE PAS ENCORE ────────────────────────
//
// Axel, 02/08 : « laisser l'user créer sa propre animation dans le détail du
// Montage IA […] chaque animation que l'user génère serait sauvegardée dans
// "Ma marque" sur son compte pour qu'il puisse la réutiliser et que le Montage
// IA puisse la réutiliser selon le groupe de mots ».
//
// Le modèle ne produit PAS de code : il décrit une scène dans le format fermé
// d'anim-spec (formes, icônes, positions, entrées). Cette fonction ne fait que
// le prompt et le premier filtre ; la validation qui fait autorité est celle du
// worker, avec la phrase réellement prononcée sous les yeux.
//
// Deux étages, comme décidé : l'animation appartient d'abord à SON compte
// (personne d'autre ne la voit, elle n'engage que lui), et elle arrive en
// parallèle dans la file de validation. Ce qui est bon rejoint la banque
// globale et profite à tout le monde.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-sonnet-5'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  const anthKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!anthKey) return json({ ok: false, erreur: 'ANTHROPIC_API_KEY manquante' }, 500)

  let body: { phrase?: string; mot?: string; catalogue?: string; demande?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON invalide' }, 400) }

  const phrase = String(body.phrase || '').trim().slice(0, 300)
  const mot = String(body.mot || '').trim().slice(0, 40)
  if (!phrase || !mot) return json({ error: 'phrase et mot requis' }, 400)
  if (!body.catalogue) return json({ error: 'catalogue requis' }, 400)

  const system = `Tu dessines UNE animation pour un montage vidéo vertical, dans le style d'AvatarAds : des formes simples, beaucoup d'air, une couleur d'accent orange.

${body.catalogue}

Tu réponds UNIQUEMENT par l'objet JSON, sans texte autour, sans balise de code.`

  const user = `La personne dit : « ${phrase} »
Le mot qui appelle un visuel : « ${mot} »${body.demande ? `\nCe qu'elle veut voir : ${String(body.demande).slice(0, 200)}` : ''}

Décris l'animation qui MONTRE ce mot-là. Pas une idée voisine : la chose elle-même.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1400,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) return json({ ok: false, erreur: `Claude ${res.status}` })
    const data = await res.json()
    const texte = String((data?.content || []).map((c: { text?: string }) => c?.text || '').join('\n'))
    // le modèle encadre parfois son JSON d'une clôture de code, malgré la consigne
    const m = texte.match(/\{[\s\S]*\}/)
    if (!m) return json({ ok: false, erreur: 'aucun JSON dans la réponse', brut: texte.slice(0, 300) })
    let spec: unknown
    try { spec = JSON.parse(m[0]) } catch { return json({ ok: false, erreur: 'JSON illisible', brut: m[0].slice(0, 300) }) }
    return json({ ok: true, spec })
  } catch (e) {
    return json({ ok: false, erreur: String(e).slice(0, 200) })
  }
})
