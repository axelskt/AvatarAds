import { helperGate } from '../_shared/guard.ts'
import { lireWav, lireMp3, dureeAudioAutres } from '../_shared/lipsync-audio.ts'
import { dureeMp4Octets } from '../_shared/mp4-duree.ts'
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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aa-op',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Audit 04/10 (AUD-1) : Scribe est payé à la minute d'audio (0,22 $/h) et le dérush n'est jamais débité. Le serveur ne
// contrôlait que le plan, la fréquence et la taille (60 Mo = plusieurs heures d'audio compressé). Désormais :
//   • durée MESURÉE avant l'envoi (WAV du débruitage — le cas par défaut —, MP3, M4A / MP4 / MOV, et — suite AUD-1 — FLAC,
//     Ogg Opus, WebM Opus, AAC brut par dureeAudioAutres : durée DÉCODÉE, jamais déclarée) : au-delà de 90 min → refus (l'app
//     ne dépasse pas ~10 min en WAV 48 kHz dans 60 Mo) ;
//   • format encore non mesurable ici (Ogg / WebM Vorbis, MP3 à grosse pochette en fin de fichier, conteneur inhabituel…,
//     seulement si le débruitage est désactivé) : accepté jusqu'à 2 Mo, compté pour au moins 10 min (ou la durée qu'il
//     contiendrait à 6 kbit/s, au plus 90 min : Scribe ne renvoie pas la durée et un audio de silence tient des heures en
//     2 Mo), corrigé à la hausse par la fin du dernier mot transcrit ; au-delà de 2 Mo → 415. owner / developer : jamais de
//     415 (comme pour le quota), leur fichier est réservé au plus à 90 min ;
//   • quota quotidien de minutes par compte (240 min, RPC transcription_take / transcription_add, migration 20261004030000),
//     owner / developer exemptés. Hoquet DB ou RPC absente (migration pas encore appliquée) → laisser passer, comme rate_hit.
const DERUSH_MAX_S = 90 * 60, DERUSH_JOUR_S = 240 * 60
const NON_MESURE_MAX = 2 * 1024 * 1024, OCTETS_PAR_S_MIN = 750, NON_MESURE_MIN_S = 10 * 60
const minutes = (sec: number) => Math.max(1, Math.round(sec / 60))
// Durée d'un audio / vidéo entier en mémoire. null = non mesurable ici.
function dureeAudio(b: Uint8Array): number | null {
  try {
    const t4 = (o: number) => o + 4 <= b.length ? String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) : ''
    if (t4(0) === 'RIFF' && t4(8) === 'WAVE') {
      const w = lireWav(b)
      return w && w.sr > 0 && w.blockAlign > 0 ? Math.floor(w.dataLen / w.blockAlign) / w.sr : null
    }
    if (t4(4) === 'ftyp') { const s = dureeMp4Octets(b); return s != null && s > 0 ? s : null }
    // Audit 04/10 (AUD-1, suite) : FLAC, Ogg Opus, WebM Opus, AAC brut — trames réellement décodables comptées par
    // dureeAudioAutres (_shared/lipsync-audio.ts, chantier MCP-4) ; < 90 % du fichier reconnu → null (non mesurable).
    // Conteneur reconnu à sa signature : mesuré directement, sans la recherche de trames MP3 sur tout le fichier (~0,3 s
    // pour 60 Mo).
    const conteneur = t4(0) === 'OggS' || t4(0) === 'fLaC' || (b.length >= 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3)
    if (conteneur) { const a = dureeAudioAutres(b); return a && a.sec > 0 ? a.sec : null }
    const m = lireMp3(b)
    if (m && m.sec > 0) return m.sec
    // ID3 suivi de FLAC, AAC brut (ADTS)
    const a = dureeAudioAutres(b)
    return a && a.sec > 0 ? a.sec : null
  } catch { return null }
}
// Réserve `secs` sur le quota du jour. false = quota atteint. Hoquet / RPC absente → true.
async function quotaDerush(uid: string, secs: number): Promise<boolean> {
  try {
    const { data, error } = await svc.rpc('transcription_take', { p_user: uid, p_kind: 'derush', p_secs: Math.max(0, Math.ceil(secs || 0)), p_max: DERUSH_JOUR_S })
    if (error) { console.warn('[derush] quota illisible (laisse passer):', error.message); return true }
    return typeof data === 'number' ? data >= 0 : true
  } catch { return true }
}
// Corrige le compteur du jour (durée transcrite au-delà de la réservation, ou réservation rendue sur échec). Best-effort.
async function ajusterDerush(uid: string, secs: number): Promise<void> {
  const s = Math.max(-86400, Math.min(86400, Math.round(secs || 0)))
  if (!s) return
  try {
    const { error } = await svc.rpc('transcription_add', { p_user: uid, p_kind: 'derush', p_secs: s })
    if (error) console.warn('[derush] ajustement du quota non noté:', error.message)
  } catch { /* best-effort */ }
}

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
  const exempt = plan === 'developer' || !!prof?.is_owner   // owner / developer : pas de quota quotidien de minutes
  const _g = await helperGate(user.id, 'derush', 8, 600)   // audit 05/09 + M6 (06/09) : Scribe payant → 8/10min (drain réduit)
  if (!_g.ok) return json(429, { error: 'rate_limited' })

  let audio: File | null = null
  try {
    const fd = await req.formData()
    const f = fd.get('audio')
    if (f instanceof File) audio = f
  } catch { return json(400, { error: 'bad_request' }) }
  if (!audio) return json(400, { error: 'audio_required' })
  if (audio.size > 60 * 1024 * 1024) return json(413, { error: 'audio_too_large' })

  // Audit 04/10 (AUD-1) : durée bornée par fichier et par jour (voir l'en-tête).
  const mesure = dureeAudio(new Uint8Array(await audio.arrayBuffer()))
  if (mesure != null && mesure > DERUSH_MAX_S) return json(413, { error: `Audio trop long pour le dérush : ${minutes(mesure)} min (${DERUSH_MAX_S / 60} min maximum).` })
  // Audit 04/10 (relecture) : owner / developer jamais refusés ici ; message sans « importe un MP3 » (un MP3 atypique peut
  // tomber dans ce cas) — le WAV du débruitage, lui, est toujours mesurable.
  if (mesure == null && audio.size > NON_MESURE_MAX && !exempt) {
    return json(415, { error: 'Impossible de mesurer la durée de ce fichier audio (au-delà de 2 Mo) : laisse « Supprimer les bruits de fond » activé, ou réexporte-le en WAV.' })
  }
  const pris = mesure != null ? Math.ceil(mesure) : Math.min(DERUSH_MAX_S, Math.max(NON_MESURE_MIN_S, Math.ceil(audio.size / OCTETS_PAR_S_MIN)))
  if (!exempt && !(await quotaDerush(user.id, pris))) {
    return json(429, { error: `Limite quotidienne de dérush atteinte (${DERUSH_JOUR_S / 60} min par jour) — réessaie demain.` })
  }

  const fd = new FormData()
  fd.append('file', audio, audio.name || 'audio.wav')
  fd.append('model_id', 'scribe_v1')
  fd.append('timestamps_granularity', 'word')
  fd.append('tag_audio_events', 'false')
  fd.append('diarize', 'false')
  let res: Response
  try {
    res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': EL_KEY },
      body: fd,
    })
  } catch {
    if (!exempt) await ajusterDerush(user.id, -pris)   // rien n'est parti chez ElevenLabs : réservation rendue
    return json(502, { error: 'Transcription momentanément indisponible — réessaie dans un instant' })
  }
  if (!res.ok) {
    if (!exempt) await ajusterDerush(user.id, -pris)
    { console.error('dérush transcription', res.status, (await res.text()).slice(0, 200)); return json(502, { error: 'Transcription momentanément indisponible — réessaie dans un instant' }) }
  }
  let data: any
  try { data = await res.json() } catch { return json(502, { error: 'Transcription momentanément indisponible — réessaie dans un instant' }) }
  const words = (data.words || [])
    .filter((w: { type?: string }) => !w.type || w.type === 'word')
    .map((w: { text: string; start: number; end: number }) => ({
      text: String(w.text || '').trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    }))
    .filter((w: { text: string }) => w.text.length > 0)
  // Le dernier mot dit au moins jusqu'où l'audio a été transcrit : au-delà de la durée réservée, le quota est corrigé.
  if (!exempt) {
    const fin = Math.ceil(((data.words || []) as { end?: number }[]).reduce((m, w) => Math.max(m, Number(w?.end) || 0), 0))
    if (fin > pris + 5) await ajusterDerush(user.id, fin - pris)
  }
  return json(200, { text: String(data.text || ''), words })
})
