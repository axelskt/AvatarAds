// provider-watch — surveille le SOLDE des fournisseurs payants et alerte Axel par e-mail (remplace hedra-watch, 03/09/2026).
//
// Pourquoi : le 02/09 à 23 h 28 le solde Hedra est tombé à 0,86 $ ; chaque création de job a renvoyé 402, un membre Pro a
// essayé six fois en six minutes (crédits remboursés à chaque fois) et a résilié onze minutes plus tard. Aucun fournisseur
// ne nous prévient : on lit donc leurs soldes nous-mêmes, toutes les 15 minutes (pg_cron), et on écrit à Axel.
//
// Fournisseurs AVEC API de solde (surveillés ici) :
//  · Hedra (avatars lipsync, Veo/Kling/Seedance)  GET api.hedra.com/v3/balance            → { balance }            en $
//  · fal.ai (Omni, OmniHuman, faceswap, upscale)  GET api.fal.ai/v1/account/billing        → credits.current_balance en $
//                                                  ⚠ exige une clé ADMIN fal (secret FAL_ADMIN_KEY) — une clé API normale répond 401/403
//  · ElevenLabs (voix)                            GET api.elevenlabs.io/v1/user/subscription → caractères restants / quota du mois
// Fournisseurs SANS API de solde (à régler dans LEUR console, une fois) :
//  · OpenAI (gpt-image)     platform.openai.com → Billing : « Auto recharge » + e-mail de solde bas intégré
//  · Anthropic (Claude)     console.anthropic.com → Billing : « Auto-reload » + e-mail de solde bas intégré
//  · Google AI Studio       facturation Google Cloud post-payée (carte) : alerte de budget dans Cloud Billing
//  · Resend, Whop, Supabase, Railway : quotas mensuels / post-payé, e-mails intégrés
//
//  · POST + x-cron-key (pg_cron toutes les 12 h) ou jeton service_role : lit tous les soldes, mémorise dans
//    service_health (une clé par fournisseur) et envoie UN e-mail Resend sous 5 $ (ElevenLabs : sous 5 % du quota) —
//    au plus un rappel par passage du cron (dédoublonnage 11 h). Plus de seuil « critique », plus de blocage.
//  · GET ?provider=hedra (défaut) avec un jeton utilisateur : état mémorisé { ok, balance, level, at } (rafraîchi si > 20 min).
//    ok est TOUJOURS vrai désormais (on n'empêche plus aucune génération) ; l'app ne bloque plus selon le solde.
//  · GET ?all=1 avec un jeton service_role : tous les états.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? ''
const CRON_SECRET  = Deno.env.get('CRON_SECRET') ?? ''
const HEDRA_V3_KEY = Deno.env.get('HEDRA_V3_KEY') ?? ''
// fal : la clé ADMIN d'abord (seule à pouvoir lire la facturation), sinon les noms tolérés par fal-proxy (on saura vite si elle est refusée)
const FAL_KEY = ['FAL_ADMIN_KEY', 'FALAI_ADMIN_KEY', 'FALAI_API_KEY', 'FAL_KEY', 'FAL_API_KEY', 'FAL_AI_KEY', 'FALAI_KEY', 'FAL_SECRET'].map(n => Deno.env.get(n) ?? '').find(Boolean) ?? ''
const ELEVEN_KEY   = Deno.env.get('ELEVENLABS_API_KEY') ?? ''
const FROM = 'AvatarAds <bonjour@avatarads.fr>'
const TO   = 'axel@iamanager.fr'
const LOW = 5, BLOCK = 0                            // USD : un seul rappel sous 5 $ (03/09 — Axel) ; plus AUCUN blocage côté app
const PCT_LOW = 5                                   // % de quota restant (ElevenLabs)
const FRESH_MS = 20 * 60 * 1000, REALERT_MS = 11 * 60 * 60 * 1000   // cron 12 h → au plus un rappel par passage
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const svc = createClient(SUPABASE_URL, SERVICE_KEY)

type Level = 'ok' | 'low' | 'crit'
type Fetched = { balance: number | null; total?: number | null; error?: string }
type State = { provider: string; label: string; unit: 'usd' | 'chars'; balance: number | null; total?: number | null; at: string; ok: boolean; level: Level; last_alert_level?: string; last_alert_at?: string; error?: string }
type Provider = { id: string; key: string; label: string; unit: 'usd' | 'chars'; billing: string; block: number; fetch: () => Promise<Fetched> }

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json', ...headers } })
  let body: any = null
  try { body = await r.json() } catch { /* corps vide */ }
  return { status: r.status, body }
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }

const PROVIDERS: Provider[] = [
  { id: 'hedra', key: 'hedra_balance', label: 'Hedra', unit: 'usd', billing: 'https://www.hedra.com/app/settings/billing', block: BLOCK,
    fetch: async () => {
      if (!HEDRA_V3_KEY) return { balance: null, error: 'HEDRA_V3_KEY absent' }
      const { status, body } = await getJson('https://api.hedra.com/v3/balance', { 'Authorization': `Key ${HEDRA_V3_KEY}` })
      if (status !== 200) return { balance: null, error: `HTTP ${status}` }
      const b = num(body?.balance); return { balance: b, error: b === null ? 'balance absent' : undefined }
    } },
  { id: 'fal', key: 'fal_balance', label: 'fal.ai', unit: 'usd', billing: 'https://fal.ai/dashboard/billing', block: 0,
    fetch: async () => {
      if (!FAL_KEY) return { balance: null, error: 'clé fal absente' }
      const { status, body } = await getJson('https://api.fal.ai/v1/account/billing?expand=credits', { 'Authorization': `Key ${FAL_KEY}` })
      if (status === 401 || status === 403) return { balance: null, error: `HTTP ${status} — il faut une clé ADMIN fal dans le secret FAL_ADMIN_KEY` }
      if (status !== 200) return { balance: null, error: `HTTP ${status}` }
      const b = num(body?.credits?.current_balance); return { balance: b, error: b === null ? 'current_balance absent' : undefined }
    } },
  { id: 'elevenlabs', key: 'elevenlabs_quota', label: 'ElevenLabs', unit: 'chars', billing: 'https://elevenlabs.io/app/subscription', block: 0,
    fetch: async () => {
      if (!ELEVEN_KEY) return { balance: null, error: 'ELEVENLABS_API_KEY absent' }
      const { status, body } = await getJson('https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': ELEVEN_KEY })
      if (status !== 200) return { balance: null, error: `HTTP ${status}` }
      const used = num(body?.character_count), limit = num(body?.character_limit)
      if (used === null || limit === null) return { balance: null, error: 'quota absent' }
      return { balance: Math.max(0, limit - used), total: limit }
    } },
]

function levelOf(p: Provider, f: Fetched): Level {
  if (f.balance === null) return 'ok'
  if (p.unit === 'usd') return f.balance < LOW ? 'low' : 'ok'
  const pct = f.total ? (f.balance / f.total) * 100 : 100
  return pct < PCT_LOW ? 'low' : 'ok'
}
function fmt(s: State): string {
  if (s.balance === null) return '?'
  if (s.unit === 'usd') return `${s.balance.toFixed(2)} $`
  const pct = s.total ? Math.round((s.balance / s.total) * 100) : 0
  return `${s.balance.toLocaleString('fr-FR')} caractères restants (${pct} % du quota)`
}

async function readStates(): Promise<Record<string, State>> {
  const { data } = await svc.from('service_health').select('key, value, updated_at').in('key', PROVIDERS.map(p => p.key))
  const out: Record<string, State> = {}
  for (const row of data ?? []) out[String(row.key)] = { ...(row.value as State), at: String(row.updated_at) }
  return out
}

async function alert(p: Provider, state: State, prev: State | undefined): Promise<boolean> {
  if (!RESEND_KEY || state.level === 'ok') return false
  const sameLevel = prev?.last_alert_level === state.level
  const recent = !!prev?.last_alert_at && (Date.now() - new Date(prev.last_alert_at).getTime()) < REALERT_MS
  if (sameLevel && recent) return false
  const v = fmt(state)
  const subject = `🟠 ${p.label} : solde bas — ${v} (recharge)`
  const consequence = p.id === 'hedra'
    ? `Recharge avant d'être à zéro : sinon Hedra répond 402 à chaque avatar (c'est ce qui est arrivé le 02/09 à 23 h 28, juste avant la résiliation d'un membre Pro). Les crédits des membres sont remboursés, mais la génération échoue sous leurs yeux.`
    : p.id === 'fal'
    ? `À zéro, fal.ai refuse les jobs : Omni, OmniHuman, changement de visage et upscale échouent (crédits remboursés, mais membres déçus).`
    : `À zéro, les voix ElevenLabs échouent jusqu'au renouvellement du quota.`
  const html = `
    <p style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px">Le solde du compte <b>${p.label}</b> est à <b>${v}</b>.</p>
    <p style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px">${consequence}</p>
    <p style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px">Recharger : <a href="${p.billing}">${p.billing.replace(/^https?:\/\//, '')}</a>. Le suivi se refait toutes les 15 minutes ; un nouvel e-mail part si le palier s'aggrave, sinon au plus un toutes les 6 h.</p>`
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [TO], subject, html }) })
  return r.ok
}

async function refreshAll(): Promise<State[]> {
  const prevs = await readStates()
  const fetched = await Promise.all(PROVIDERS.map(p => p.fetch().catch((e: Error) => ({ balance: null, error: String(e?.message || e) }) as Fetched)))
  const at = new Date().toISOString()
  const states: State[] = []
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i], f = fetched[i], prev = prevs[p.key]
    const level = levelOf(p, f)
    const ok = f.balance === null ? (prev?.ok ?? true) : (p.block > 0 ? f.balance >= p.block : true)
    const state: State = { provider: p.id, label: p.label, unit: p.unit, balance: f.balance, total: f.total ?? null, at, ok, level, error: f.error,
      last_alert_level: prev?.last_alert_level, last_alert_at: prev?.last_alert_at }
    if (f.balance !== null && await alert(p, state, prev)) { state.last_alert_level = level; state.last_alert_at = at }
    states.push(state)
  }
  await svc.from('service_health').upsert(states.map(s => ({ key: PROVIDERS.find(p => p.id === s.provider)!.key, value: s, updated_at: at })))
  return states
}
const pub = (s: State) => ({ provider: s.provider, ok: s.ok, balance: s.balance, total: s.total ?? null, unit: s.unit, level: s.level, at: s.at, error: s.error })
// Vue UTILISATEUR (audit 05/09, L3) : un membre n'a besoin que de « ça marche / dégradé », jamais des
// soldes fournisseurs (renseignement business) ni des messages d'erreur internes.
const pubUser = (s: State) => ({ provider: s.provider, ok: s.ok, level: s.level, at: s.at })
const timingSafeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const isCron = !!CRON_SECRET && timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)
  // Audit offensif 05/09 : verify_jwt=false ici → la passerelle NE vérifie PAS la signature. On ne DÉDUIT
  // donc JAMAIS service_role d'un claim (un JWT non signé role=service_role était accepté et divulguait les
  // soldes fournisseurs). Seul le secret cron accorde la vue service/refresh ; un user doit prouver une
  // vraie session (getUser, validé côté Auth API) pour la vue publique.
  const isService = isCron

  if (req.method === 'POST') {
    if (!isCron && !isService) return json({ error: 'forbidden' }, 403)
    const states = await refreshAll()
    const hedra = states.find(s => s.provider === 'hedra')
    return json({ ok: hedra?.ok ?? true, providers: states.map(pub) })
  }
  // GET : utilisateur connecté (ou service) → état mémorisé, rafraîchi s'il est vieux
  if (!isService) {
    if (!token) return json({ error: 'unauthorized' }, 401)
    const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user } } = await anon.auth.getUser()
    if (!user) return json({ error: 'unauthorized' }, 401)
  }
  const url = new URL(req.url)
  const want = PROVIDERS.find(p => p.id === (url.searchParams.get('provider') || 'hedra')) ?? PROVIDERS[0]
  let states = await readStates()
  const cur = states[want.key]
  if (!cur || (Date.now() - new Date(cur.at).getTime()) > FRESH_MS) { await refreshAll(); states = await readStates() }
  if (isService && url.searchParams.get('all') === '1') return json({ providers: PROVIDERS.map(p => states[p.key]).filter(Boolean).map(pub) })
  const s = states[want.key]
  if (isService) return json(s ? pub(s) : { provider: want.id, ok: true, balance: null, level: 'ok', at: null })
  return json(s ? pubUser(s) : { provider: want.id, ok: true, level: 'ok', at: null })
})
