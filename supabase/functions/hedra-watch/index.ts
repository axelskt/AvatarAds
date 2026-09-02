// hedra-watch — surveille le SOLDE du compte Hedra (fournisseur des avatars lipsync) et alerte Axel.
//
// Pourquoi (03/09/2026) : le 02/09 à 23 h 28 le solde Hedra est tombé à 0,86 $ ; chaque création de job a
// renvoyé 402 « paiement requis », un membre Pro a essayé six fois en six minutes (crédits remboursés à
// chaque fois) et a résilié onze minutes plus tard, motif « je ne l'utilise pas assez ». Personne n'avait vu
// le solde baisser : Hedra n'envoie aucune alerte et /v3/usage ne donne que le dépensé — c'est /v3/balance.
//
//  · POST + x-cron-key (pg_cron toutes les 15 min) ou jeton service_role : lit le solde en direct, le
//    mémorise dans service_health (clé 'hedra_balance') et envoie un e-mail Resend à Axel sous 15 $ (bas)
//    puis sous 5 $ (critique) — au plus un e-mail par palier toutes les 6 h, un nouveau si le palier s'aggrave.
//  · GET avec un jeton utilisateur : renvoie l'état mémorisé { ok, balance, at } (rafraîchi si > 20 min) —
//    l'app le consulte AVANT de débiter un membre : si ok=false, message clair et aucun débit.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const HEDRA_V3_KEY  = Deno.env.get('HEDRA_V3_KEY') ?? ''
const RESEND_KEY    = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET   = Deno.env.get('CRON_SECRET') ?? ''
const FROM = 'AvatarAds <bonjour@avatarads.fr>'
const TO   = 'axel@iamanager.fr'
const LOW = 15, CRIT = 5, BLOCK = 2          // USD : alerte basse, alerte critique, seuil de blocage côté app
const FRESH_MS = 20 * 60 * 1000, REALERT_MS = 6 * 60 * 60 * 1000
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const svc = createClient(SUPABASE_URL, SERVICE_KEY)

type State = { balance: number | null; at: string; ok: boolean; level: 'ok' | 'low' | 'crit'; last_alert_level?: string; last_alert_at?: string; error?: string }

async function readState(): Promise<State | null> {
  const { data } = await svc.from('service_health').select('value, updated_at').eq('key', 'hedra_balance').maybeSingle()
  return data ? { ...(data.value as State), at: String(data.updated_at) } : null
}
async function fetchBalance(): Promise<{ balance: number | null; error?: string }> {
  try {
    // Même clé et même en-tête que hedra-proxy en v3 : `Authorization: Key <HEDRA_V3_KEY>` (api.hedra.com).
    const r = await fetch('https://api.hedra.com/v3/balance', { headers: { 'Authorization': `Key ${HEDRA_V3_KEY}`, 'Content-Type': 'application/json' } })
    if (!r.ok) return { balance: null, error: `HTTP ${r.status}` }
    const j = await r.json()
    const b = Number(j?.balance)
    return { balance: Number.isFinite(b) ? b : null, error: Number.isFinite(b) ? undefined : 'balance absent' }
  } catch (e) { return { balance: null, error: String((e as Error)?.message || e) } }
}
function levelOf(b: number | null): State['level'] { if (b === null) return 'ok'; return b < CRIT ? 'crit' : b < LOW ? 'low' : 'ok' }

async function alert(state: State, prev: State | null): Promise<boolean> {
  if (!RESEND_KEY || state.level === 'ok') return false
  const sameLevel = prev?.last_alert_level === state.level
  const recent = prev?.last_alert_at && (Date.now() - new Date(prev.last_alert_at).getTime()) < REALERT_MS
  if (sameLevel && recent) return false
  const b = state.balance === null ? '?' : state.balance.toFixed(2)
  const subject = state.level === 'crit' ? `🔴 Hedra : solde critique — ${b} $ (les avatars vont échouer)` : `🟠 Hedra : solde bas — ${b} $`
  const html = `
    <p style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px">Le solde du compte Hedra (avatars lipsync) est à <b>${b} $</b>.</p>
    <p style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px">${state.level === 'crit'
      ? `Sous ${BLOCK} $, l'app <b>refuse les générations d'avatar</b> avec un message clair et sans débiter personne. Hedra répond 402 à chaque création de job (c'est ce qui est arrivé le 02/09 à 23 h 28, juste avant la résiliation d'un membre Pro).`
      : `Sous ${CRIT} $ l'alerte devient critique ; sous ${BLOCK} $ l'app bloque les générations d'avatar.`}</p>
    <p style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px">Recharger : <a href="https://www.hedra.com/app/settings/billing">hedra.com → Billing</a>. Le suivi se refait toutes les 15 minutes.</p>`
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [TO], subject, html }) })
  return r.ok
}

async function refresh(): Promise<State> {
  const prev = await readState()
  const { balance, error } = await fetchBalance()
  const level = levelOf(balance)
  const state: State = { balance, at: new Date().toISOString(), ok: balance === null ? (prev?.ok ?? true) : balance >= BLOCK, level, error,
    last_alert_level: prev?.last_alert_level, last_alert_at: prev?.last_alert_at }
  if (balance !== null && await alert(state, prev)) { state.last_alert_level = level; state.last_alert_at = state.at }
  await svc.from('service_health').upsert({ key: 'hedra_balance', value: state, updated_at: state.at })
  return state
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const role = (() => { try { const p = token.split('.')[1]; const b = p.replace(/-/g, '+').replace(/_/g, '/'); return String(JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4)))?.role || '') } catch { return '' } })()
  const isCron = !!CRON_SECRET && req.headers.get('x-cron-key') === CRON_SECRET
  const isService = role === 'service_role'

  if (req.method === 'POST') {
    if (!isCron && !isService) return json({ error: 'forbidden' }, 403)
    const s = await refresh()
    return json({ ok: s.ok, balance: s.balance, level: s.level, at: s.at, error: s.error })
  }
  // GET : utilisateur connecté (ou service) → état mémorisé, rafraîchi s'il est vieux
  if (!isService) {
    if (!token) return json({ error: 'unauthorized' }, 401)
    const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user } } = await anon.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)
  }
  let s = await readState()
  if (!s || (Date.now() - new Date(s.at).getTime()) > FRESH_MS) s = await refresh()
  return json({ ok: s.ok, balance: s.balance, level: s.level, at: s.at })
})
