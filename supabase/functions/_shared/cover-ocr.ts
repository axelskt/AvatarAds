// Lecture du TEXTE CHOC d'une couverture (12/10, Axel : « il peut se baser sur l'heure, le texte choc, la 1re image »).
// Les vidéos de l'usine d'un même avatar se ressemblent trop en vignette (même visage, même pièce) : l'image seule propose
// 3-6 candidates. Le texte choc, lui, est propre à chaque vidéo (TH01…TH26 + style) : on le lit sur la couverture avec un
// petit modèle de vision, on le rapproche de la banque TH (factory_bricks kind 'texte-choc'), puis on ne garde que les
// vidéos de l'usine qui portent CE texte (factory_qc.brick_combo.texte_choc). L'heure de publication (± 40 min d'un
// créneau du kit) ne sert QUE si l'appelant la fournit : Instagram suit le kit à la minute, TikTok non (Axel 12/10). Aucune clé ni image ne sort de l'edge vers le client.
// deno-lint-ignore no-explicit-any
type Svc = { from: (table: string) => any }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 1)

// part des mots du texte de la banque retrouvés dans le texte lu (l'OCR peut couper / ajouter un emoji)
function overlap(read: string, bank: string): number {
  const r = new Set(words(read)), b = words(bank)
  if (!b.length || !r.size) return 0
  return b.filter((w) => r.has(w)).length / b.length
}

function mediaType(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp'
  return 'image/jpeg'
}
function b64(b: Uint8Array): string { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }

// texte en surimpression lu sur la couverture ('' = aucun texte lisible ; null = lecture impossible)
export async function readCoverText(bytes: Uint8Array): Promise<string | null> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!key || bytes.length > 4_500_000) return null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 200, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType(bytes), data: b64(bytes) } },
        { type: 'text', text: 'Recopie mot pour mot le texte en surimpression le plus visible en HAUT de cette image (la phrase dans un encadré ou en gros caractères), sans les emojis. Réponds avec ce texte seul, sur une ligne. S\'il n\'y en a pas, réponds exactement : AUCUN' },
      ] }] }),
    })
    if (!r.ok) { console.log('lecture couverture', r.status, (await r.text()).slice(0, 160)); return null }
    const j = await r.json()
    const t = String(j?.content?.[0]?.text || '').trim().split('\n')[0].slice(0, 200)
    return /^aucun\.?$/i.test(t) ? '' : t
  } catch (e) { console.log('lecture couverture', String((e as Error)?.message || e).slice(0, 120)); return null }
}

export type Refined = { vf: string | null, state: 'auto' | 'unsure' | 'none', candidates: { vf: string, score: number }[], why: string }

// Candidates de l'usine portant le même texte choc que la couverture, départagées par l'image puis par l'heure du kit.
export async function refineByText(svc: Svc, text: string, created: string | null, duration: number | null,
  scoreVf: (vf: string) => Promise<{ score: number } | null>): Promise<Refined | null> {
  if (!text) return null
  const { data: th } = await svc.from('factory_bricks').select('id, label').eq('kind', 'texte-choc')
  const hits = (th || []).map((b: any) => ({ id: String(b.id), o: overlap(text, String(b.label || '')) })).filter((x: any) => x.o >= 0.6)
    .sort((a: any, b: any) => b.o - a.o)
  if (!hits.length) return null
  const best = hits[0].o, ids = hits.filter((h: any) => h.o >= best - 0.05).map((h: any) => h.id)
  const { data: q } = await svc.from('factory_qc').select('template, brick_combo').eq('status', 'approved').in('brick_combo->>texte_choc', ids).limit(400)
  let vfs: string[] = [...new Set<string>((q || []).map((r: any) => String(r.template)).filter((v: string) => /^VF-\d{4}$/.test(v)))]
  if (!vfs.length) return null
  // durée TikTok (secondes entières) à 1,5 s près
  if (duration != null) {
    const { data: fp } = await svc.from('factory_fp').select('vf, duration').in('vf', vfs)
    const ok = new Set((fp || []).filter((f: any) => f.duration == null || Math.abs(Number(f.duration) - duration) <= 1.5).map((f: any) => String(f.vf)))
    if (ok.size) vfs = vfs.filter((v) => ok.has(v))
  }
  const scored = (await Promise.all(vfs.slice(0, 25).map(async (vf) => ({ vf, s: (await scoreVf(vf))?.score ?? 999 })))).sort((a, b) => a.s - b.s)
  const cands = scored.slice(0, 5).map((x) => ({ vf: x.vf, score: +x.s.toFixed(1) }))
  if (scored.length === 1) return { vf: scored[0].vf, state: 'auto', candidates: cands, why: 'texte choc unique' }
  const [a, b] = scored
  if (a.s <= 60 && b.s >= a.s * 1.25) return { vf: a.vf, state: 'auto', candidates: cands, why: 'texte choc + image' }
  // heure : une seule de ces vidéos programmée à ± 40 min de la publication TikTok
  if (created) {
    const t = Date.parse(created), lo = new Date(t - 40 * 60000).toISOString(), hi = new Date(t + 40 * 60000).toISOString()
    const { data: posts } = await svc.from('factory_posts').select('combo').gte('scheduled_at', lo).lte('scheduled_at', hi).limit(50)
    const near: string[] = [...new Set<string>((posts || []).map((p: any) => String(p.combo?.vf || '')).filter((v: string) => vfs.includes(v)))]
    if (near.length === 1) return { vf: near[0], state: 'auto', candidates: cands, why: 'texte choc + heure du kit' }
  }
  return { vf: null, state: 'unsure', candidates: cands, why: 'texte choc, ' + scored.length + ' vidéos' }
}
