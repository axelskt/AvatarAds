// delete-account — suppression DÉFINITIVE de son compte par son titulaire (RGPD, Axel 28/09).
// POST, Authorization: Bearer <jeton de session>, corps { confirm: 'SUPPRIMER', dry_run?: true }.
// Refus : compte owner / developer (jamais par cette route) ; abonnement payant encore actif (la facturation vit chez
// Whop : le résilier d'abord, sinon il continuerait d'être prélevé sans compte).
// 24/10 (audit 23/10) : le rendu prioritaire (abonnement Whop À PART, profiles.prio_member_id) est résilié ICI, en fin de
// période comme le plan, AVANT de supprimer quoi que ce soit : avant, il continuait d'être prélevé sur un compte supprimé.
// L'app ne l'affiche nulle part, on ne peut donc pas demander au client de le résilier lui-même.
// 24/10 (relecture) : un refus de Whop ne bloque plus la suppression quand le prioritaire finit déjà chez Whop (résilié par
// le client, expiré, fin de période déjà programmée) : l'abonnement est relu. Avant, le droit à l'effacement restait refusé
// en boucle (502 à chaque essai) jusqu'à un webhook de fin qui pouvait ne jamais arriver.
// Ordre : fichiers du compte (mcp-media, render-media, brand-assets sous <uid>/) → lignes sans cascade (delete_user_rows :
// jetons OAuth, rendus, débits MCP, codes de connexion…) → auth.admin.deleteUser, qui emporte en cascade le profil, les
// crédits, la Bibliothèque, les jobs, les clés MCP et la mémoire de marque. dry_run : ce qui serait supprimé, sans rien toucher.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS, jsonRes, authUser, svc, rateHit } from '../_shared/guard.ts'

const PAID = ['starter', 'pro', 'elite']
// Fin déjà acquise chez Whop : fin de période programmée, ou abonnement résilié / terminé (même liste que whop-webhook)
const finitDeja = (m: any) => !!m && (m.cancel_at_period_end === true || ['canceled', 'cancelled', 'completed', 'expired'].includes(String(m.status ?? '').toLowerCase()))

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return jsonRes(405, { error: 'method_not_allowed' })
  const auth = await authUser(req)
  if (!auth.userId) return jsonRes(401, { error: 'Connecte-toi pour supprimer ton compte.' })
  const uid = auth.userId
  if (!(await rateHit('delete-account:' + uid, 3600, 10))) return jsonRes(429, { error: 'Trop de tentatives — réessaie plus tard.' })
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* corps vide */ }
  const dry = body.dry_run === true
  if (!dry && body.confirm !== 'SUPPRIMER') return jsonRes(400, { error: 'Confirmation manquante : tape SUPPRIMER.' })

  const db = svc()
  const { data: prof, error: pErr } = await db.from('profiles')
    .select('email, plan, is_owner, whop_member_id, whop_cancel_at_period_end, whop_manage_url, prio_member_id, prio_cancel_member_id').eq('id', uid).maybeSingle()
  if (pErr) return jsonRes(500, { error: 'Lecture du compte impossible — réessaie.' })
  const plan = String(prof?.plan || 'free').toLowerCase()
  if (prof?.is_owner === true || plan === 'developer') return jsonRes(403, { error: 'Ce compte ne peut pas être supprimé depuis l’app.' })
  if (PAID.includes(plan) && prof?.whop_member_id && prof?.whop_cancel_at_period_end !== true) {
    return jsonRes(409, { error: 'Résilie d’abord ton abonnement, sinon il continuerait d’être prélevé. Ensuite tu pourras supprimer ton compte.', manage_url: prof?.whop_manage_url || null })
  }
  // Rendu prioritaire encore actif (pas déjà résilié par whop-cancel ou par un essai précédent)
  const prioId = String(prof?.prio_member_id || '')
  const prioAResilier = !!prioId && prioId !== String(prof?.prio_cancel_member_id || '')
  let email = String(prof?.email || '')
  if (!email) { try { const { data: u } = await db.auth.admin.getUserById(uid); email = String(u?.user?.email || '') } catch { /* sans e-mail */ } }

  const { data: objs, error: oErr } = await db.rpc('list_user_objects', { p_user: uid })
  if (oErr) return jsonRes(500, { error: 'Inventaire des fichiers impossible — rien n’a été supprimé.' })
  const files = (objs as Array<{ bucket_id: string; name: string }>) || []
  if (dry) {
    const { data: rows } = await db.rpc('delete_user_rows', { p_user: uid, p_email: email, p_dry: true })
    const parBucket: Record<string, number> = {}
    for (const f of files) parBucket[f.bucket_id] = (parBucket[f.bucket_id] || 0) + 1
    return jsonRes(200, { ok: true, dry_run: true, fichiers: parBucket, lignes_hors_cascade: rows, rendu_prioritaire: prioAResilier ? 'a_resilier' : null })
  }

  // 0) rendu prioritaire — un échec ARRÊTE tout (sinon il resterait prélevé, sans compte pour le retrouver)
  if (prioAResilier) {
    const key = Deno.env.get('WHOP_API_KEY') ?? ''
    if (!key) { console.error('[delete-account] WHOP_API_KEY manquant'); return jsonRes(500, { error: 'Configuration incomplète — contacte le support. Rien n’a été supprimé.' }) }
    const url = `https://api.whop.com/api/v1/memberships/${encodeURIComponent(prioId)}`
    const headers = { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
    let st = 0, deja = false
    try {
      const r = await fetch(`${url}/cancel`, { method: 'POST', headers, body: JSON.stringify({ cancel_at_period_end: true }) })
      st = r.status
      if (!r.ok) console.error('[delete-account] prioritaire', uid, r.status, (await r.text().catch(() => '')).slice(0, 300))
    } catch (e) { console.error('[delete-account] prioritaire', uid, String(e)) }
    if (st < 200 || st > 299) {
      // Refus : l'abonnement est relu. S'il finit déjà chez Whop, plus rien ne sera prélevé, la suppression continue.
      const rg = await fetch(url, { headers }).catch(() => null)
      const m = rg && rg.ok ? await rg.json().catch(() => null) : null
      deja = finitDeja(m)
      if (!deja) return jsonRes(502, { error: 'Résiliation de ton rendu prioritaire impossible pour le moment — réessaie, ton compte est toujours là.' })
      console.log(`[delete-account] prioritaire déjà en fin chez Whop ${uid} (${String(m?.status ?? '')}${m?.cancel_at_period_end === true ? ', fin de période programmée' : ''})`)
    }
    // résilié ICI : mémorisé pour un nouvel essai si la suite échoue (pas de 2e résiliation chez Whop) ; non bloquant.
    // Déjà en fin chez Whop : pas noté comme résilié par l'app (whop-uncancel ne doit pas le réactiver).
    if (!deja) {
      const { error: mErr } = await db.from('profiles').update({ prio_cancel_member_id: prioId }).eq('id', uid)
      if (mErr) console.error('[delete-account] prioritaire non mémorisé', uid, mErr.message)
    }
  }

  // 1) fichiers — un échec ARRÊTE tout (on ne supprime pas le compte en laissant ses fichiers derrière lui)
  for (const bucket of ['mcp-media', 'render-media', 'brand-assets']) {
    const names = files.filter((f) => f.bucket_id === bucket).map((f) => f.name)
    for (let i = 0; i < names.length; i += 100) {
      const { error: e } = await db.storage.from(bucket).remove(names.slice(i, i + 100))
      if (e) { console.error('[delete-account] fichiers', uid, bucket, e.message); return jsonRes(500, { error: 'Suppression des fichiers interrompue — réessaie, ton compte est toujours là.' }) }
    }
  }
  // 2) lignes que la cascade n'emporte pas, 3) le compte lui-même (cascade)
  const { data: rows, error: rErr } = await db.rpc('delete_user_rows', { p_user: uid, p_email: email, p_dry: false })
  if (rErr) { console.error('[delete-account] lignes', uid, rErr.message); return jsonRes(500, { error: 'Suppression interrompue — réessaie.' }) }
  const { error: dErr } = await db.auth.admin.deleteUser(uid)
  if (dErr) { console.error('[delete-account] compte', uid, dErr.message); return jsonRes(500, { error: 'Suppression du compte interrompue — réessaie.' }) }
  console.log(`[delete-account] compte supprimé ${uid} fichiers=${files.length} lignes=${JSON.stringify(rows)}`)
  return jsonRes(200, { ok: true })
})
