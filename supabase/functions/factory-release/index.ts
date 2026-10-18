// Libère le stockage d'une vidéo finale une fois programmée / postée (Axel 30/09 : disque plein, « une fois programmé on
// les supprime »). Déclenché par Axel dans le kit de publication (« C'est programmé », après 6 s pour pouvoir annuler).
//  POST { ids: [uuid…] } → pour chaque post programmé / publié : supprime factory-media/final/… (ou stock/…) et note
//  video_deleted_at.
// Garde-fous : owner/dev seulement ; uniquement des fichiers des dossiers final/ et stock/ (jamais une brique : variants/,
// hooks/, ctas/, demos/…) ; un post encore « à faire » n'est jamais touché. La recette (combo) reste : ré-assemblable.
// 16/10 (stock commun BloxAI) : les posts ajoutés par kit-recharge pointent vers factory-media/stock/<nom>.mp4 (mission
// passée en 'kit' côté BloxAI, plus jamais proposée à un diffuseur) → même règle que final/. Affiches (-poster.jpg) gardées.
// supabase-js épinglé (07/10 : esm.sh servait une 2.117.3 cassée, déploiement refusé — comme yt-stats).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'

const SB_URL = Deno.env.get('SUPABASE_URL') || ''
const svc = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '')
const PUB = SB_URL + '/storage/v1/object/public/factory-media/'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

async function ownerOk(req: Request): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return false
  try {
    const { data: { user }, error } = await svc.auth.getUser(jwt)
    if (error || !user) return false
    const { data } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
    return !!data && (!!data.is_owner || String(data.plan || '').toLowerCase() === 'developer')
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST attendu' }, 405)
  // Corps lu AVANT toute réponse : un refus précoce sans lecture du corps fait attendre la passerelle (504 muet).
  let raw = ''
  try { raw = await req.text() } catch { /* */ }
  if (!(await ownerOk(req))) return json({ error: 'réservé au propriétaire' }, 401)
  let ids: string[] = []
  try { const b = JSON.parse(raw); ids = Array.isArray(b.ids) ? b.ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200) : [] } catch { /* */ }
  if (!ids.length) return json({ error: 'ids manquants' }, 400)
  const { data: rows, error } = await svc.from('factory_posts').select('id, status, video_url, video_deleted_at').in('id', ids)
  if (error) return json({ error: error.message }, 500)
  const done: string[] = [], skipped: { id: string, why: string }[] = []
  for (const r of rows || []) {
    if (r.video_deleted_at) { skipped.push({ id: r.id, why: 'déjà supprimée' }); continue }
    if (r.status !== 'scheduled' && r.status !== 'published') { skipped.push({ id: r.id, why: 'pas encore programmée' }); continue }
    const url = String(r.video_url || '')
    const path = url.startsWith(PUB) ? decodeURIComponent(url.slice(PUB.length).split('?')[0]) : ''
    if (!/^(final|stock)\/[^/]+\.mp4$/i.test(path)) { skipped.push({ id: r.id, why: 'hors des dossiers final/ et stock/' }); continue }
    const { error: e } = await svc.storage.from('factory-media').remove([path])
    if (e) { skipped.push({ id: r.id, why: e.message }); continue }
    await svc.from('factory_posts').update({ video_deleted_at: new Date().toISOString() }).eq('id', r.id)
    done.push(r.id)
  }
  return json({ ok: true, released: done.length, done, skipped })
})
