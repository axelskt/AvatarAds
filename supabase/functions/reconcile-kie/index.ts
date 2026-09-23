// reconcile-kie — filet « jamais perdre une génération kie » (23/09/2026).
//
// kie.ai est lent (Nano Banana Pro 4K mesurée à 9 min) et le compte developer n'a AUCUN repli : quand l'app abandonne
// l'attente (délai dépassé, onglet fermé), la génération finit quand même chez kie — déjà payée — mais personne ne la
// récupère. kie-proxy note chaque tâche lancée dans public.kie_jobs ('pending'), la passe à 'fetched' quand il copie
// le résultat pour l'app, et l'app confirme ('saved', route /ack) une fois rangée en Bibliothèque. Ce filet reprend :
//   A) les 'pending' ABANDONNÉS (> 45 min : l'app a lâché avant la fin) ;
//   B) les 'fetched' SANS accusé depuis > 2 h (onglet fermé pendant le post-traitement…) → on range la copie déjà faite.
// Pour chaque tâche reprise :
//   • réussie   → rapatriée dans render-media/<uid>/lib/kie-<taskId>.<ext> + ligne library_items → state 'saved'
//                 (la Bibliothèque de l'app la fusionne au prochain chargement, sur tous les appareils) ;
//   • échouée   → 'failed' ;  • introuvable depuis > 24 h ou encore en cours après 6 h → 'expired' ;
//   • en cours / hoquet kie → on repasse au prochain tour.
// Fenêtre : tâches de PLUS DE 45 min seulement (l'app attend au plus ~30 min, latence comprise) + RÉSERVATION de
// chaque tâche (pending → saving) avant traitement → jamais de doublon avec le flux normal ni entre deux passages.
// Déclenché par pg_cron (POST + x-cron-key = CRON_SECRET), comme reconcile-fal-orphans. Best-effort, jamais bloquant.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { kieKey, kieRecord, kieDownload, kieKindOf, kieOwnedBy } from '../_shared/kie.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
const RID = /^(mk|veo)-([A-Za-z0-9_-]{6,120})$/
const STORE_SIGN = `${SUPABASE_URL}/storage/v1/object/sign/render-media/`

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const isCron = !!CRON_SECRET && timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)
  if (!isCron) return json({ error: 'forbidden' }, 403)
  if (!kieKey()) return json({ error: 'no_kie_key' }, 500)

  let minAge = 45, limit = 20
  try { const b = await req.json(); if (b && typeof b === 'object') { if (Number.isFinite(b.minAge)) minAge = Math.max(45, b.minAge); if (Number.isFinite(b.limit)) limit = Math.min(50, Math.max(1, b.limit)) } } catch { /* corps optionnel */ }

  // Réservations orphelines (passage précédent tué en pleine copie, ex. fichier géant) : remises en file avec +1 essai,
  // ou 'failed' au 6e — sinon elles resteraient 'saving' pour toujours.
  { const { data: stale } = await svc.from('kie_jobs').select('task_id, attempts').eq('state', 'saving')
      .lt('updated_at', new Date(Date.now() - 30 * 60000).toISOString()).limit(50)
    for (const x of (stale || []) as Array<{ task_id: string; attempts: number }>) {
      const n = (x.attempts || 0) + 1
      await svc.from('kie_jobs').update({ state: n >= 6 ? 'failed' : 'pending', attempts: n, last_error: 'passage interrompu pendant la copie', updated_at: new Date().toISOString() })
        .eq('task_id', x.task_id).eq('state', 'saving')
    } }

  // Rotation : tri sur updated_at (chaque passage le repousse) → les tâches bloquées tournent, les nouvelles passent.
  const cols = 'task_id, user_id, alias, label, created_at, attempts, state, storage_path'
  const { data: jA, error } = await svc.from('kie_jobs').select(cols).eq('state', 'pending')
    .lt('created_at', new Date(Date.now() - minAge * 60000).toISOString()).order('updated_at', { ascending: true }).limit(limit)
  if (error) return json({ error: 'list_failed', detail: error.message }, 500)
  const { data: jB } = await svc.from('kie_jobs').select(cols).eq('state', 'fetched')
    .lt('updated_at', new Date(Date.now() - 120 * 60000).toISOString()).order('updated_at', { ascending: true }).limit(limit)
  const jobs = [...(jA || []), ...(jB || [])]

  const now = () => new Date().toISOString()
  const setState = async (id: string, from: string, state: string, extra: Record<string, unknown> = {}) => {
    const { error: e } = await svc.from('kie_jobs').update({ state, updated_at: now(), ...extra }).eq('task_id', id).eq('state', from)
    if (e) console.warn('[reconcile-kie] état', id, state, e.message)
  }
  let saved = 0, failed = 0, expired = 0, running = 0, retry = 0
  // Range un fichier déjà dans NOTRE storage en Bibliothèque (idempotent : réutilise une ligne existante).
  const toLibrary = async (userId: string, path: string, kind: 'image' | 'video', label: string | null): Promise<string | null> => {
    const { data: prev, error: pErr } = await svc.from('library_items').select('id').eq('user_id', userId).eq('storage_path', path).limit(1)
    if (pErr) throw new Error('bibliothèque (lecture) : ' + pErr.message)
    if (prev && prev[0]) return prev[0].id
    const ins = await svc.from('library_items').insert({ user_id: userId, kind: kind === 'image' ? 'image' : 'video-simple',
      name: label || 'kie.ai', tags: ['kie.ai', 'récupérée'], style: 'kie.ai', emo: '', storage_path: path }).select('id').single()
    if (ins.error) throw new Error('bibliothèque : ' + ins.error.message)
    return ins.data.id
  }
  for (const j of jobs as Array<{ task_id: string; user_id: string; alias: string; label: string | null; created_at: string; attempts: number; state: string; storage_path: string | null }>) {
    // RÉSERVATION : pending|fetched → saving (atomique). Si l'app ou un autre passage l'a prise entre-temps, on passe.
    const from = j.state
    const { data: claimed, error: cErr } = await svc.from('kie_jobs').update({ state: 'saving', updated_at: now() })
      .eq('task_id', j.task_id).eq('state', from).select('task_id')
    if (cErr || !claimed || !claimed.length) continue
    // B) Copie déjà faite par kie-proxy mais jamais confirmée par l'app → on range CE fichier, sans rien retélécharger.
    if (from === 'fetched' && j.storage_path && j.storage_path.startsWith(j.user_id + '/kie/')) {
      try {
        const libId = await toLibrary(j.user_id, j.storage_path, /\.(jpg|png|webp)$/i.test(j.storage_path) ? 'image' : 'video', j.label)
        await setState(j.task_id, 'saving', 'saved', { library_id: libId, last_error: null }); saved++
        console.log('[reconcile-kie] copie non confirmée rangée', j.task_id, j.storage_path)
      } catch (e) { await setState(j.task_id, 'saving', 'fetched', { last_error: String((e as Error)?.message || e).slice(0, 150) }); retry++ }
      continue
    }
    const ageH = (Date.now() - new Date(j.created_at).getTime()) / 3600000
    // Échec de copie : on rend la tâche au prochain tour (attempts+1) ; au 6e essai ou après 24 h → 'failed', jamais bloquante.
    const later = async (why: string) => {
      const n = (j.attempts || 0) + 1
      if (n >= 6 || ageH > 24) { await setState(j.task_id, 'saving', 'failed', { attempts: n, last_error: why }); failed++ }
      else { await setState(j.task_id, 'saving', 'pending', { attempts: n, last_error: why }); retry++ }
    }
    try {
      const m = j.task_id.match(RID); if (!m) { await setState(j.task_id, 'saving', 'expired', { last_error: 'identifiant invalide' }); expired++; continue }
      const fam = m[1] as 'mk' | 'veo', taskId = m[2]
      const rec = await kieRecord(fam, taskId)
      if (rec.transient) {
        if (ageH > 48) { await setState(j.task_id, 'saving', 'expired', { last_error: 'kie injoignable depuis 48 h : ' + rec.err.slice(0, 100) }); expired++ }
        else { await setState(j.task_id, 'saving', 'pending', { last_error: (rec.account ? 'compte kie refusé : ' : 'kie passager : ') + rec.err.slice(0, 120) }); retry++ }
        continue
      }
      if (!rec.found) { if (ageH > 24) { await setState(j.task_id, 'saving', 'expired', { last_error: 'introuvable chez kie' }); expired++ } else { await setState(j.task_id, 'saving', 'pending'); retry++ } continue }
      // Propriété : l'entrée signée de la tâche doit venir du dossier de ce user (même règle que kie-proxy).
      if (rec.state === 'ok' && !kieOwnedBy(rec.param, j.user_id, STORE_SIGN)) { await setState(j.task_id, 'saving', 'failed', { last_error: 'propriété non prouvée' }); failed++; continue }
      if (rec.state === 'fail' || (rec.state === 'ok' && !rec.urls.length)) { await setState(j.task_id, 'saving', 'failed', { last_error: (rec.err || 'échec kie').slice(0, 200) }); failed++; continue }
      if (rec.state !== 'ok') { if (ageH > 6) { await setState(j.task_id, 'saving', 'expired', { last_error: 'toujours en cours après 6 h' }); expired++ } else { await setState(j.task_id, 'saving', 'pending'); running++ } continue }

      const dl = await kieDownload(rec.urls[0]); if (!dl) { await later('téléchargement impossible (trop gros, lien expiré ou hôte refusé)'); continue }
      const k = kieKindOf(dl.ct, dl.buf); if (!k) { await setState(j.task_id, 'saving', 'failed', { last_error: 'format inattendu ' + dl.ct }); failed++; continue }
      const path = `${j.user_id}/lib/kie-${taskId}.${k.ext}`
      const up = await svc.storage.from('render-media').upload(path, new Uint8Array(dl.buf), { contentType: k.mime, upsert: true })
      if (up.error) { await later('copie storage : ' + up.error.message); continue }
      let libId: string | null = null
      try { libId = await toLibrary(j.user_id, path, k.kind, j.label) } catch (e) { await later(String((e as Error)?.message || e).slice(0, 150)); continue }
      await setState(j.task_id, 'saving', 'saved', { storage_path: path, library_id: libId, last_error: null })
      console.log('[reconcile-kie] rangée en Bibliothèque', j.task_id, path)
      saved++
    } catch (e) { await later('exception : ' + String((e as Error)?.message || e).slice(0, 150)) }
  }
  return json({ ok: true, seen: (jobs || []).length, saved, failed, expired, running, retry })
})
