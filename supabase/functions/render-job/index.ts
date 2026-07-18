// Supabase Edge Function — 🎬 render-job (#113, partie 4)
// File de rendu serveur du Montage IA : cree un job (plan + video uploadee par le
// client dans render-media/<uid>/...) et donne son statut (+ URL signee du MP4 final).
// Le rendu lui-meme est fait par render-worker/ (poll de la table render_jobs).
//
// Auth : JWT utilisateur (verify_jwt au gateway). Credits debites cote client via
// spendCreditsFor AVANT l'appel (pattern des autres proxys).
//
// POST JSON :
//   { action:'create', plan:{...}, input_video:'<uid>/in-x.mp4', assets:[{id,path,kind}] } -> { ok, job_id }
//   (kind: 'image' | 'video' — #111, les b-roll peuvent etre des clips qui jouent)
//   { action:'status', job_id } -> { ok, status, url?, error? }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    // utilisateur reel depuis le JWT
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Non authentifie' }, 401)

    const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const body = await req.json().catch(() => ({}))

    if (body.action === 'create') {
      const plan = body.plan
      if (!plan || typeof plan !== 'object' || !Number(plan.duration)) return json({ error: 'plan invalide (duration manquante)' }, 400)
      if (Number(plan.duration) > 300) return json({ error: 'video trop longue (max 5 min)' }, 400)
      const input = String(body.input_video || '')
      if (!input.startsWith(user.id + '/')) return json({ error: 'input_video invalide' }, 400)
      const assets = (Array.isArray(body.assets) ? body.assets : []).slice(0, 8)
        .map((a: { id?: string; path?: string; kind?: string }) => ({
          id: String(a.id || '').slice(0, 40),
          path: String(a.path || ''),
          kind: a.kind === 'video' ? 'video' : 'image',
        }))
        .filter((a: { id: string; path: string }) => a.id && a.path.startsWith(user.id + '/'))

      // garde-fou : pas plus de 2 jobs en attente/rendu par utilisateur
      const { count } = await service.from('render_jobs').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).in('status', ['queued', 'rendering'])
      if ((count ?? 0) >= 2) return json({ error: 'Tu as deja un rendu en cours — attends qu\'il se termine' }, 429)

      const { data, error } = await service.from('render_jobs')
        .insert({ user_id: user.id, status: 'queued', plan, input_video: input, assets })
        .select('id').single()
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, job_id: data.id })
    }

    if (body.action === 'status') {
      const id = String(body.job_id || '')
      if (!id) return json({ error: 'job_id manquant' }, 400)
      const { data: job, error } = await service.from('render_jobs')
        .select('id, user_id, status, output_url, error').eq('id', id).single()
      if (error || !job) return json({ error: 'job introuvable' }, 404)
      if (job.user_id !== user.id) return json({ error: 'acces refuse' }, 403)
      let url: string | null = null
      if (job.status === 'done' && job.output_url) {
        const { data: signed } = await service.storage.from('render-media')
          .createSignedUrl(job.output_url, 3600, { download: 'montage-final.mp4' })
        url = signed?.signedUrl ?? null
      }
      return json({ ok: true, status: job.status, url, error: job.error })
    }

    return json({ error: 'action inconnue' }, 400)
  } catch (err) {
    console.error('render-job error:', err)
    return json({ error: String((err as Error)?.message || err).slice(0, 300) }, 500)
  }
})
