// Supabase Edge Function — « Remplacer l'audio » (Motion Control, 09/10/2026 ; ex « Cloner l'audio de la vidéo »)
//
// Axel 08/10 : des créateurs se filment, Motion Control transfère le mouvement sur une fille… et c'est une voix de fille qui
// sort. C'est du speech-to-speech (ElevenLabs Voice Changer) appliqué APRÈS le rendu Kling sur l'audio de la vidéo : mêmes
// mots, même rythme, mêmes pauses et intonation, seul le TIMBRE change → les lèvres (animées par la prise d'origine) restent
// synchro. Une voix générée depuis le texte aurait son propre rythme et ne collerait pas aux lèvres.
//
// GRATUIT (Axel 09/10 : ≈ 0,12 $/min chez ElevenLabs, 0,06 $ au plus par vidéo de 30 s, moins de 2 % du coût Kling de la même
// vidéo). Aucun crédit, donc aucun remboursement à protéger. Garde-fous : abonnés seulement, adossé à un rendu Kling RÉEL du
// compte LIVRÉ et payé (opKlingLivree — relectures 09/10 : une op « motion » débitée à la main puis remboursée, ou un Kling
// soumis pour échouer, ouvraient 10 conversions gratuites par heure), 3 conversions au plus par rendu (rate_hit atomique),
// voix pas plus longue que la vidéo livrée, 10 par heure et par compte, 2 en file, plafonds IP et plateforme.
//
// POST ?voix=fille|garcon&video=<uid>/mc-…-voixsrc-….mp4&cle=<uuid>, corps = WAV (piste son de la vidéo, mono, ≤ 30 s).
// Réponse : { job_id } (composition à suivre avec render-job action 'status') ou { error }. GET ?cle=<uuid> : retrouve ce job
// si la réponse s'est perdue en route (réseau) — job du compte, 'motion-voix', de moins de 15 min. TOUT se fait ici (relecture adverse 09/10) :
//  1. la vidéo est COPIÉE hors de portée du compte (render-media/voix-prep/<uid>/… : les policies storage n'ouvrent que
//     <uid>/…) puis mesurée → l'utilisateur ne peut plus la remplacer ni l'effacer pour faire échouer l'assemblage après
//     l'appel payant à ElevenLabs ; une vidéo illisible est refusée AVANT ElevenLabs ;
//  2. WAV validé strictement (wav.ts) ; seuls ces échantillons partent chez ElevenLabs (WAV reconstruit) ;
//  3. la voix est rangée au même endroit privé : jamais récupérable seule, uniquement posée sur la vidéo ;
//  4. le job de composition 'motion-voix' est créé ICI (clé service) ; le worker supprime les fichiers privés à la fin.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, requirePlan, userPlan, billableGate, svc, rateHit, realIp, fichierDuFlux, tailleObjet, SUPABASE_URL } from '../_shared/guard.ts'
import { cheminSur } from '../_shared/storage-path.ts'
import { dureeMp4Url } from '../_shared/mp4-duree.ts'
import { lireWav, wavCanonique, VOIX_DUREE_MIN, VOIX_DUREE_MAX, VOIX_OCTETS_MAX, VOIX_ELEVENLABS } from './wav.ts'

const PAID_PLANS = ['starter', 'pro', 'elite']
const STS_MODELE = 'eleven_multilingual_sts_v2'
const BUCKET = 'render-media'
const VIDEO_OCTETS_MAX = 200 * 1024 * 1024   // vidéo Motion Control ≤ 30 s
const VIDEO_DUREE_MAX = 31.5                 // Kling : 30 s au plus (+ marge de conteneur)
const EN_COURS_MAX = 2                       // compositions voix en file pour un même compte
const PAR_RENDU_MAX = 3                      // conversions par rendu Kling (choix fille puis garçon, + un nouvel essai)
const MC_CR_PAR_S_MIN = 2                    // Motion Control le moins cher : 2 cr/s → secondes payées ≤ montant / 2

// Op de la génération Motion Control RÉELLE et LIVRÉE à laquelle s'adosse la conversion (2e relecture 09/10) : op « motion »
// du compte, non remboursée, de moins d'1 h, liée à un job fal (bind_reservation_job), job RÉGLÉ (livré : job_bill_state
// 'settled', posé à la lecture du résultat) et réserve ENTIÈREMENT tirée. Exclut donc : une op seulement débitée puis
// remboursée, un Kling soumis pour échouer puis remboursé (jamais 'settled'), un détourage à 1 crédit (ne lie aucun job,
// réserve non vide), un autre modèle fal payé sur une op « motion » (provider_path ≠ kling-video). Une op livrée et vide ne
// se rembourse plus (already_delivered). Si la facture fal du job existe, elle
// doit être celle d'un job Kling réglé, et sa durée MESURÉE (out_sec) plafonne la voix. null = refus (gratuit).
// Motion Control chez kie (Axel 09/10, tous les clients) : même exigence sur une op « motion » SANS job fal lié — elle doit
// porter une tâche Kling kie (kie_jobs : alias kling-*, op réglée par kie_job_bill 'settle' au rapatriement, résultat copié
// ou rangé) ; la durée MESURÉE à la soumission (bill_sec) plafonne la voix.
async function opKlingKieLivree(uid: string): Promise<{ id: string; secMax: number } | null> {
  try {
    const { data, error } = await svc().from('credit_ops').select('id, amount')
      .eq('user_id', uid).eq('reason', 'motion').is('refunded_at', null).not('settled_at', 'is', null)
      .eq('reserved_remaining', 0).is('provider_job', null)
      .gt('created_at', new Date(Date.now() - 3600_000).toISOString()).order('created_at', { ascending: false }).limit(3)
    if (error || !data || !data.length) return null
    for (const o of data as { id: string; amount: number }[]) {
      if (!(o.amount > 0)) continue
      const { data: k, error: ke } = await svc().from('kie_jobs').select('bill_sec')
        .eq('op_id', o.id).eq('user_id', uid).in('alias', ['kling-2.6-mc', 'kling-3.0-mc']).eq('bill_state', 'settled')
        .in('state', ['fetched', 'saved']).limit(1)
      if (ke) return null
      if (!k || !k.length) continue
      const sec = Number((k[0] as { bill_sec?: number | string | null }).bill_sec)
      const plafond = o.amount / MC_CR_PAR_S_MIN
      return { id: o.id, secMax: Number.isFinite(sec) && sec > 0 ? Math.min(sec + 1, plafond) : plafond }
    }
    return null
  } catch { return null }
}
async function opKlingLivree(uid: string): Promise<{ id: string; secMax: number } | null> {
  const viaFal = await opKlingFalLivree(uid)
  return viaFal || await opKlingKieLivree(uid)
}
async function opKlingFalLivree(uid: string): Promise<{ id: string; secMax: number } | null> {
  try {
    const { data, error } = await svc().from('credit_ops').select('id, amount, provider_job')
      .eq('user_id', uid).eq('reason', 'motion').is('refunded_at', null).not('settled_at', 'is', null)
      .eq('job_bill_state', 'settled').eq('reserved_remaining', 0).like('provider_job', 'fal:%')
      .like('provider_path', 'https://queue.fal.run/fal-ai/kling-video/%')   // posé au bind : le job lié est un Kling (3e relecture 09/10)
      .gt('created_at', new Date(Date.now() - 3600_000).toISOString()).order('created_at', { ascending: false }).limit(3)
    if (error || !data || !data.length) return null
    for (const o of data as { id: string; amount: number; provider_job: string }[]) {
      if (!(o.amount > 0)) continue
      const { data: f, error: fe } = await svc().from('fal_job_bills').select('state, path, out_sec').eq('job', o.provider_job).maybeSingle()
      if (fe) return null
      if (!f) return { id: o.id, secMax: o.amount / MC_CR_PAR_S_MIN }
      const fb = f as { state: string | null; path: string | null; out_sec: number | string | null }
      // path = URL de suivi rendue par fal = RACINE fournisseur (…/fal-ai/kling-video/requests/<id>), jamais le chemin modèle
      if (fb.state !== 'settled' || !/^https:\/\/queue\.fal\.run\/fal-ai\/kling-video\//i.test(fb.path || '')) continue
      const out = Number(fb.out_sec)
      return { id: o.id, secMax: Number.isFinite(out) && out > 0 ? Math.min(out, o.amount / MC_CR_PAR_S_MIN) : o.amount / MC_CR_PAR_S_MIN }
    }
    return null
  } catch { return null }
}


const CLE_RE = /^[A-Za-z0-9-]{8,40}$/

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET') {
    const a = await authUser(req)
    if (!a.userId) return jsonRes(401, { error: 'Unauthorized' })
    const q = new URL(req.url).searchParams
    const cle = q.get('cle') || ''
    if (!CLE_RE.test(cle)) return jsonRes(400, { error: 'clé invalide' })
    const { data } = await svc().from('render_jobs').select('id').eq('user_id', a.userId).eq('plan->>__compose', 'motion-voix')
      .eq('plan->>cle', cle).gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString()).limit(1)
    return jsonRes(200, { job_id: data && data.length ? data[0].id : null })
  }
  if (req.method !== 'POST') return jsonRes(405, { error: 'method_not_allowed' })

  const auth = await authUser(req)
  if (!auth.token) return jsonRes(401, { error: 'Unauthorized — token manquant' })
  if (!auth.userId) return jsonRes(401, { error: 'Unauthorized — session invalide ou expirée' })   // pas d'appel service : l'app seule
  const uid = auth.userId

  const q = new URL(req.url).searchParams
  const voix = q.get('voix') || ''
  const voiceId = Object.prototype.hasOwnProperty.call(VOIX_ELEVENLABS, voix) ? VOIX_ELEVENLABS[voix] : ''
  if (!voiceId) return jsonRes(400, { error: 'voix inconnue' })
  // vidéo à habiller : déposée par l'app dans le flux Motion Control du compte (<uid>/mc-….mp4), chemin normalisé
  const video = cheminSur(uid, q.get('video'))
  if (!video || !fichierDuFlux(uid, video, 'mc-', true)) return jsonRes(400, { error: 'vidéo invalide' })
  const cle = q.get('cle') || ''
  if (cle && !CLE_RE.test(cle)) return jsonRes(400, { error: 'clé invalide' })

  // Plan AVANT tout compteur, puis : débit récent + cadence (10 / h), et une génération Motion Control payée il y a < 1 h.
  const p = await requirePlan(uid, PAID_PLANS, 'Remplacer l’audio')
  if (!p.ok) return jsonRes(p.status, { error: 'Remplacer l’audio est réservé aux abonnés (Starter, Pro ou Élite).' })
  const g = await billableGate({ userId: uid, proxy: 'voice-change', requireDebit: true, debitMinutes: 60, rateMax: 10, rateWindowS: 3600, label: voix })
  if (!g.ok) return jsonRes(g.status, { error: g.error })
  const up0 = await userPlan(uid)
  const libre = up0.isOwner || up0.plan === 'developer'
  const op = libre ? null : await opKlingLivree(uid)
  if (!libre && !op) return jsonRes(403, { error: 'Remplacer l’audio s’utilise juste après une génération Motion Control.' })

  const key = Deno.env.get('ELEVENLABS_API_KEY') ?? ''
  if (!key) return jsonRes(500, { error: 'voix_non_configuree' })

  // Corps borné AVANT lecture complète : taille annoncée OBLIGATOIRE, puis revérifiée. L'app envoie un Blob (Content-Length).
  const annonce = Number(req.headers.get('content-length') || NaN)
  if (!Number.isFinite(annonce)) return jsonRes(411, { error: 'taille de l’audio manquante' })
  if (annonce > VOIX_OCTETS_MAX) return jsonRes(413, { error: 'audio trop volumineux' })
  let brut: ArrayBuffer
  try { brut = await req.arrayBuffer() } catch { return jsonRes(400, { error: 'audio illisible' }) }
  const audio = new Uint8Array(brut)
  if (audio.length > VOIX_OCTETS_MAX) return jsonRes(413, { error: 'audio trop volumineux' })
  const wav = lireWav(audio)
  if (!wav) return jsonRes(400, { error: 'audio illisible (WAV attendu)' })
  if (wav.duree < VOIX_DUREE_MIN || wav.duree > VOIX_DUREE_MAX) return jsonRes(400, { error: `durée hors limites (${VOIX_DUREE_MIN}–${VOIX_DUREE_MAX} s)` })
  // Pas plus de son que de secondes Kling payées (+ marge d'arrondi), et PAR_RENDU_MAX conversions par rendu (compteur atomique).
  if (op && wav.duree > op.secMax + 1.5) return jsonRes(400, { error: 'l’audio dépasse la durée de la vidéo générée' })
  if (op && !(await rateHit(`proxy:voice-change:op:${op.id}`, 7200, PAR_RENDU_MAX))) {
    return jsonRes(429, { error: 'Déjà ' + PAR_RENDU_MAX + ' voix pour cette vidéo — lance une nouvelle génération Motion Control.' })
  }

  // Pas plus de EN_COURS_MAX compositions voix en file pour ce compte.
  {
    const depuis = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    const { count } = await svc().from('render_jobs').select('id', { count: 'exact', head: true })
      .eq('user_id', uid).eq('plan->>__compose', 'motion-voix').in('status', ['queued', 'rendering']).gte('created_at', depuis)
    if ((count ?? 0) >= EN_COURS_MAX) return jsonRes(429, { error: 'Une voix est déjà en cours d’assemblage — attends qu’elle se termine.' })
  }
  // Plafond plateforme (IP puis global) pour un appel qui part VRAIMENT chez ElevenLabs.
  const ip = realIp(req)
  if (ip && !(await rateHit(`proxy:voice-change:ip:${ip}`, 3600, 30))) return jsonRes(429, { error: 'Trop de requêtes depuis ce réseau — réessaie dans un moment.' })
  if (!(await rateHit('proxy:voice-change:global', 3600, 300))) return jsonRes(429, { error: 'Service très demandé en ce moment — réessaie dans quelques minutes.' })

  // 1) Vidéo COPIÉE hors de portée du compte, puis mesurée (illisible / trop longue → refus AVANT ElevenLabs).
  const st = svc().storage.from(BUCKET)
  const taille = await tailleObjet(BUCKET, video)
  if (taille === null) return jsonRes(400, { error: 'vidéo introuvable' })
  if (taille > VIDEO_OCTETS_MAX) return jsonRes(413, { error: 'vidéo trop volumineuse' })
  const base = `voix-prep/${uid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const videoPrive = base + '-src.mp4', voixPrive = base + '.mp3'
  const jeter = async () => { try { await st.remove([videoPrive, voixPrive]) } catch (_) { /* best-effort */ } }
  {
    const cp = await st.copy(video, videoPrive)
    if (cp.error) { console.error('[voice-change] copie vidéo :', cp.error.message); return jsonRes(503, { error: 'Préparation de la vidéo impossible — réessaie.' }) }
    let signed = ''
    try { const sg = await st.createSignedUrl(videoPrive, 600); signed = (!sg.error && sg.data?.signedUrl) || '' } catch { signed = '' }
    const signPre = `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/`
    if (!signed.includes(`/object/sign/${BUCKET}/${videoPrive}`)) { await jeter(); return jsonRes(503, { error: 'Préparation de la vidéo impossible — réessaie.' }) }
    const url = signed.startsWith(signPre) ? signed : signPre + signed.slice(signed.indexOf(videoPrive))
    const sec = await dureeMp4Url(url).catch(() => null)
    if (!(sec && sec > 0) || sec > VIDEO_DUREE_MAX) { await jeter(); return jsonRes(400, { error: 'vidéo illisible ou trop longue' }) }
    if (wav.duree > sec + 1.5) { await jeter(); return jsonRes(400, { error: 'l’audio ne correspond pas à la vidéo' }) }
  }

  // 2) ElevenLabs speech-to-speech : bruit de fond retiré d'abord (prise de téléphone), MP3 44,1 kHz.
  let mp3: Uint8Array
  try {
    const canon = wavCanonique(wav, audio)   // EXACTEMENT les échantillons validés (jamais le corps brut du client)
    const form = new FormData()
    form.append('audio', new Blob([canon.buffer as ArrayBuffer], { type: 'audio/wav' }), 'voix.wav')
    form.append('model_id', STS_MODELE)
    form.append('remove_background_noise', 'true')
    const r = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300)
      console.error(`[voice-change] ElevenLabs ${r.status} user=${uid} voix=${voix} : ${detail}`)
      await jeter()
      return jsonRes(502, { error: r.status === 429 ? 'Le service de voix est saturé — réessaie dans une minute.' : 'La conversion de la voix a échoué.' })
    }
    mp3 = new Uint8Array(await r.arrayBuffer())
    if (mp3.length < 1000) throw new Error('réponse vide')
  } catch (e) {
    console.error('[voice-change] ElevenLabs injoignable :', (e as Error)?.message)
    await jeter()
    return jsonRes(502, { error: 'La conversion de la voix a échoué.' })
  }

  // 3) Voix rangée au même endroit privé (lisible par la clé service seule) ; le worker supprime les deux fichiers à la fin.
  const up = await st.upload(voixPrive, mp3, { contentType: 'audio/mpeg', upsert: false })
  if (up.error) {
    console.error('[voice-change] dépôt impossible :', up.error.message)
    await jeter()
    return jsonRes(500, { error: 'La voix n’a pas pu être enregistrée.' })
  }

  // 4) Job de composition créé ICI (le client ne peut pas créer de job 'motion-voix' : absent de COMPOSE_CLIENT).
  const duree = Math.max(1, Math.min(31, Math.ceil(wav.duree)))
  const { data: job, error: jobErr } = await svc().from('render_jobs')
    .insert({ user_id: uid, status: 'queued', plan: { __compose: 'motion-voix', duration: duree, ...(cle ? { cle } : {}), ...(op ? { op: op.id } : {}) }, input_video: videoPrive, assets: [{ id: 'voix', path: voixPrive, kind: 'image' }] })
    .select('id').single()
  if (jobErr || !job) {
    console.error('[voice-change] job non créé :', jobErr?.message)
    await jeter()
    return jsonRes(500, { error: 'L’assemblage de la voix n’a pas pu démarrer.' })
  }
  console.log(`[voice-change] ok user=${uid} voix=${voix} ${wav.duree.toFixed(1)}s job=${job.id}`)
  return jsonRes(200, { job_id: job.id })
})
