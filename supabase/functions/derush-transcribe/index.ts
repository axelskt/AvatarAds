// Supabase Edge Function — 🎙️ Dérush IA (#151, plans Pro / Élite / developer)
//
// Ne fait QU'UNE chose : transcrire l'audio mot à mot via ElevenLabs Scribe et
// renvoyer les mots avec leurs bornes. Toute l'analyse (reprises, « euh »,
// coupes) se fait CÔTÉ CLIENT sur ces mots — pas de logique métier ici, donc
// rien à redéployer quand la détection s'affine.
//
// Scribe transcrit AUSSI les hésitations (« euh », « hum ») — c'est la raison
// du choix : Whisper les efface, or ce sont précisément elles qu'on découpe.
//
//   POST multipart/form-data { audio: File }
//        → { text, words: [{ text, start, end }] }
//
// Auth : JWT utilisateur, réservé pro / elite / developer / is_owner.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const EL_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? ''

const svc = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!EL_KEY) return json(500, { error: 'elevenlabs_key_missing' })

  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json(401, { error: 'unauthorized' })
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json(401, { error: 'unauthorized' })
  const { data: prof } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
  const plan = String(prof?.plan || '').toLowerCase()
  const allowed = !!prof && (['pro', 'elite', 'developer'].includes(plan) || !!prof.is_owner)
  if (!allowed) return json(403, { error: 'pro_elite_only' })

  let audio: File | null = null
  try {
    const fd = await req.formData()
    const f = fd.get('audio')
    if (f instanceof File) audio = f
  } catch { return json(400, { error: 'bad_request' }) }
  if (!audio) return json(400, { error: 'audio_required' })
  if (audio.size > 60 * 1024 * 1024) return json(413, { error: 'audio_too_large' })

  const fd = new FormData()
  fd.append('file', audio, audio.name || 'audio.wav')
  fd.append('model_id', 'scribe_v1')
  fd.append('timestamps_granularity', 'word')
  fd.append('tag_audio_events', 'false')
  fd.append('diarize', 'false')
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': EL_KEY },
    body: fd,
  })
  if (!res.ok) return json(502, { error: 'scribe_error', detail: (await res.text()).slice(0, 200) })
  const data = await res.json()
  const words = (data.words || [])
    .filter((w: { type?: string }) => !w.type || w.type === 'word')
    .map((w: { text: string; start: number; end: number }) => ({
      text: String(w.text || '').trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    }))
    .filter((w: { text: string }) => w.text.length > 0)
  return json(200, { text: String(data.text || ''), words })
})
