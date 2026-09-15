// reconcile-fal-orphans — réconcilie les orphelins fal « job lié mort en plein poll » (audit Omni 15/09).
//
// Résidu après le remboursement proxy des échecs de SOUMISSION : un job fal SOUMIS AVEC SUCCÈS (op LIÉE, réserve
// tirée) dont le client MEURT pendant le polling (minutes), puis qui ÉCHOUE côté fal → personne n'observe le FAILED
// → l'op reste reserved_remaining<amount / settled null / refunded null = crédits perdus, sans récupération. Un
// balayage SQL pur ne peut pas le traiter (indistinguable d'un succès non-settled). On VÉRIFIE donc le statut auprès
// de fal, pour chaque orphelin PRIMAIRE listé (list_fal_orphans), et on tranche :
//   • FAILED/ERROR/CANCELLED → refund_by_job_terminal (rembourse le solde, cas propre uniquement) ;
//   • COMPLETED             → settle_by_job (la gén a RÉUSSI = service rendu → non remboursable ; jamais de refund
//                             d'un job livré = pas de refund-and-keep si le client revenait le récupérer) ;
//   • IN_QUEUE/IN_PROGRESS  → on saute (job encore en cours, prochain passage) ;
//   • statut illisible / HTTP non-2xx (404 job purgé, hoquet) → on ne décide RIEN (jamais de refund sans confirmation).
//
// Déclenché par pg_cron (POST + x-cron-key = CRON_SECRET). Best-effort, jamais bloquant. Fenêtre par défaut
// [20 min, 110 min] : min > runtime max d'un job (~11 min) pour ne pas toucher un job vivant ; max < 2 h car
// refund_by_job_terminal refuse au-delà (gel dur du ledger). Clé fal NORMALE (statut de job), jamais exposée.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''
const FAL_KEY = ['FALAI_API_KEY', 'FAL_KEY', 'FAL_API_KEY', 'FAL_AI_KEY', 'FALAI_KEY', 'FAL_SECRET'].map(n => Deno.env.get(n) ?? '').find(Boolean) ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  // Auth : SEULEMENT le cron (x-cron-key = CRON_SECRET). Jamais un JWT/role d'un claim.
  const isCron = !!CRON_SECRET && timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)
  if (!isCron) return json({ error: 'forbidden' }, 403)
  if (!FAL_KEY) return json({ error: 'no_fal_key' }, 500)

  let minAge = 20, maxAge = 110, limit = 50
  try { const b = await req.json(); if (b && typeof b === 'object') { if (Number.isFinite(b.minAge)) minAge = b.minAge; if (Number.isFinite(b.maxAge)) maxAge = b.maxAge; if (Number.isFinite(b.limit)) limit = b.limit } } catch { /* corps optionnel */ }

  const { data: orphans, error } = await svc.rpc('list_fal_orphans', { p_min_age_min: minAge, p_max_age_min: maxAge, p_limit: limit })
  if (error) return json({ error: 'list_failed', detail: error.message }, 500)
  const rows = (orphans as Array<{ id: string; user_id: string; provider_job: string; provider_path: string }>) || []

  const falAuth = { 'Authorization': `Key ${FAL_KEY}` }
  const isFailedStatus = (s: string) => /^(FAILED|ERROR|CANCELLED|CANCELED)$/i.test(s)
  const isFailedBody = (t: string) => /"status"\s*:\s*"(FAILED|ERROR|CANCELLED|CANCELED)"/i.test(t)
  const doRefund = async (o: { user_id: string; provider_job: string }) => {
    const { data } = await svc.rpc('refund_by_job_terminal', { p_user: o.user_id, p_job: o.provider_job })
    return !!(data && (data as { ok?: boolean }).ok)
  }
  let refunded = 0, settled = 0, running = 0, unresolved = 0, errors = 0
  for (const o of rows) {
    try {
      // provider_path = l'URL de suivi RENVOYÉE PAR fal (base .../requests/<id>) — jamais reconstruite. On la valide
      // (hôte queue.fal.run uniquement, anti-SSRF), puis statut = base+'/status', résultat = base.
      const base = String(o.provider_path || '')
      if (!/^https:\/\/queue\.fal\.run\/[A-Za-z0-9._\/-]+$/.test(base)) { unresolved++; continue }
      const stRes = await fetch(base + '/status', { headers: falAuth })
      const stText = await stRes.text().catch(() => '')
      if (!stRes.ok) { unresolved++; continue }   // 404 (purgé) / hoquet → on ne décide rien (pas d'action sans preuve)
      const status = (stText.match(/"status"\s*:\s*"([^"]+)"/) || [])[1] || ''
      if (isFailedStatus(status)) {
        if (await doRefund(o)) refunded++; else unresolved++
      } else if (/^COMPLETED$/i.test(status)) {
        // COMPLETED au STATUT ne prouve PAS la livraison : le mode « COMPLETED puis 422 (sans output) » n'est visible
        // qu'au endpoint RÉSULTAT. On règle SEULEMENT si output réel (comme fal-proxy : res.ok && hasOutput) ; 422 /
        // body FAILED / pas d'output → c'est un ÉCHEC terminal → on rembourse ; ambigu (hoquet) → aucune décision.
        const reRes = await fetch(base, { headers: falAuth })
        const reText = await reRes.text().catch(() => '')
        const hasOutput = /"(video|image|images|url)"\s*:/.test(reText)
        if (reRes.ok && hasOutput) { await svc.rpc('settle_by_job', { p_user: o.user_id, p_job: o.provider_job }); settled++ }
        else if (reRes.status === 422 || isFailedBody(reText)) { if (await doRefund(o)) refunded++; else unresolved++ }
        else { unresolved++ }
      } else {
        running++   // IN_QUEUE / IN_PROGRESS
      }
    } catch (e) { errors++; console.error('reconcile orphan', o.id, (e as Error)?.message) }
  }
  console.log(`[reconcile-fal-orphans] scanned=${rows.length} refunded=${refunded} settled=${settled} running=${running} unresolved=${unresolved} errors=${errors}`)
  return json({ ok: true, scanned: rows.length, refunded, settled, running, unresolved, errors })
})
