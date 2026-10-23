import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { rateHit, realIp } from '../_shared/guard.ts'

// ── Après un paiement sur paiement.html (Axel 23/10, test réel sur iPhone) ──
// Sans session AvatarAds dans le navigateur, Whop proposait de « réclamer » l'achat avec un code Whop puis renvoyait sur la
// page d'accueil. Désormais la page joint à son paiement un identifiant aléatoire (metadata aa_nonce, gardé dans l'onglet)
// et interroge cette fonction :
//   POST { action:'etat', nonce }       → { paid:false } tant que l'activation n'est pas arrivée (whop-webhook),
//                                          puis { paid:true, compte:'connecte'|'nouveau'|'existant'|'attente', email,
//                                          mdp, google, recu } — mdp : le compte a un mot de passe ; google : il se connecte
//                                          par Google ; recu : n° de commande, moyen de paiement, 4 derniers chiffres et
//                                          montant ENCAISSÉ (événement payment.succeeded, arrive quelques secondes après)
//   POST { action:'connexion', nonce }  → compte NEUF seulement (créé il y a < 24 h, jamais connecté, sans mot de passe) :
//                                          jeton de connexion à usage unique (lien magique, un seul par paiement)
//   POST { action:'mot_de_passe', password } + Bearer de la session obtenue ainsi → 1er mot de passe du compte (même
//                                          autorisation serveur que auth-otp : password_change_grants + guard_password_change)
// Un compte déjà utilisé (connexion passée ou mot de passe posé) n'est JAMAIS ouvert par ce chemin : connexion habituelle.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FENETRE_MS = 3 * 3600_000       // paiement cherché sur les 3 dernières heures
const NEUF_MS = 24 * 3600_000         // compte « neuf » : créé il y a moins de 24 h
const PWD_MIN = 8, PWD_MAX_BYTES = 72, GRANT_TTL_S = 120   // = auth-otp
const masque = (e: string) => { const [u, d] = e.split('@'); return (u || '').slice(0, 2) + '•••@' + (d || '') }
const verrou = (nonce: string) => 'paiement-compte:' + nonce.toLowerCase()

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)
  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'json' }, 400) }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const action = String(b?.action ?? 'etat')
  if (action === 'mot_de_passe') return await motDePasse(req, b, sb)

  const nonce = String(b?.nonce ?? '').trim()
  if (!NONCE_RE.test(nonce)) return json({ ok: false, error: 'nonce' }, 400)
  // la page interroge toutes les 3 s pendant le paiement : ~200 appels / 10 min au plus par onglet
  if (!(await rateHit('paiement-compte:' + (realIp(req) || 'inconnu'), 600, 400))) return json({ ok: false, error: 'rate' }, 429)

  const depuis = new Date(Date.now() - FENETRE_MS).toISOString()
  const { data: evs, error } = await sb.from('webhook_events').select('body')
    .eq('body->data->metadata->>aa_nonce', nonce).gte('received_at', depuis).order('received_at', { ascending: false }).limit(20)
  if (error) { console.error('paiement-compte journal :', error.message); return json({ ok: false, error: 'db' }, 500) }
  const act = (evs || []).find((e: any) => /membership[._](went[._]valid|activated)/.test(String(e?.body?.action ?? e?.body?.event ?? e?.body?.type ?? '').toLowerCase()))
  if (!act) return json({ ok: true, paid: false })

  const d = act.body?.data ?? {}
  const recu = recuDe(evs || [], String(d.id ?? ''))
  // acheteur déjà connecté sur la page (identifiant de compte joint au paiement) : il a sa session, rien à ouvrir
  const uid = String(d.metadata?.aa_user_id ?? '')
  if (/^[0-9a-f-]{36}$/i.test(uid)) {
    const { data: rows } = await sb.rpc('paiement_compte_etat', { p_user: uid })
    return json({ ok: true, paid: true, compte: 'connecte', recu, ...acces(Array.isArray(rows) ? rows[0] : null) })
  }
  const email = String(d.user?.email ?? d.member?.user?.email ?? d.customer?.email ?? d.email ?? '').toLowerCase().trim()
  if (!email) return json({ ok: true, paid: true, compte: 'attente', recu })
  const { data: rows, error: e2 } = await sb.rpc('paiement_compte_etat', { p_email: email })
  if (e2) { console.error('paiement-compte état :', e2.message); return json({ ok: false, error: 'db' }, 500) }
  const u: any = Array.isArray(rows) ? rows[0] : null
  if (!u) return json({ ok: true, paid: true, compte: 'attente', email: masque(email), recu })   // le webhook crée le compte
  const neuf = !u.a_mot_de_passe && !u.last_sign_in_at && Date.now() - Date.parse(u.created_at) < NEUF_MS
  if (!neuf) return json({ ok: true, paid: true, compte: 'existant', email: masque(email), recu, ...acces(u) })
  if (action !== 'connexion') return json({ ok: true, paid: true, compte: 'nouveau', email: masque(email), recu, ...acces(u) })

  // une seule connexion par paiement : verrou = ligne du journal (index unique sur event_id, comme les verrous du webhook)
  const { error: lkErr } = await sb.from('webhook_events').insert({ event_id: verrou(nonce), body: { action: 'audit.paiement_compte', data: { user: u.id } } })
  if (lkErr) return json({ ok: true, paid: true, compte: 'existant', email: masque(email) })
  const { data: link, error: le } = await sb.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = (link as any)?.properties?.hashed_token
  if (le || !tokenHash) {
    try { await sb.from('webhook_events').delete().eq('event_id', verrou(nonce)) } catch { /* best-effort */ }
    console.error('paiement-compte lien :', le?.message || 'sans jeton')
    return json({ ok: false, error: 'link' }, 500)
  }
  console.log(`🔑 Connexion après achat pour ${masque(email)}`)
  return json({ ok: true, paid: true, compte: 'nouveau', email, token_hash: tokenHash, recu, ...acces(u) })
})

// mot de passe posé ? connexion Google ? (« Ouvrir mon espace » ne propose un mot de passe qu'à un compte qui n'a ni l'un ni l'autre)
const acces = (u: any) => u ? { mdp: !!u.a_mot_de_passe, google: Array.isArray(u.fournisseurs) && u.fournisseurs.includes('google') } : {}

// Reçu de la page « Paiement confirmé » : n° de commande Whop (paiement, sinon abonnement), moyen de paiement, 4 derniers
// chiffres, montant encaissé (somme des paiements distincts de ce passage en caisse) et date
function recuDe(evs: any[], membre: string) {
  const vus = new Set<string>()
  let total = 0, p: any = null
  for (const e of evs) {
    if (!/payment[._]succeeded/.test(String(e?.body?.action ?? e?.body?.event ?? e?.body?.type ?? '').toLowerCase())) continue
    const d = e.body?.data ?? {}, id = String(d.id ?? '')
    if (!id || vus.has(id)) continue
    vus.add(id); total += Number(d.total) || 0
    if (!p) p = d
  }
  if (!p) return { commande: membre.slice(0, 40) || null }
  const type = [p.payment_method_type, p.payment_method?.payment_method_type, p.payment_instrument?.payment_method_type,
    p.payment_instrument?.display_name].map((x) => String(x ?? '').toLowerCase()).join(' ')
  const last4 = String(p.card_last4 ?? p.payment_method?.card?.last4 ?? p.payment_instrument?.card?.last4 ?? '').replace(/\D/g, '').slice(-4)
  return {
    commande: String(p.id).slice(0, 40),
    methode: /apple/.test(type) ? 'Apple Pay' : /google/.test(type) ? 'Google Pay' : 'Carte bancaire',
    last4: last4 || null,
    total: Math.round(total * 100) / 100,
    date: p.paid_at ?? p.created_at ?? null,
  }
}

// 1er mot de passe d'un compte ouvert par ce chemin (verrou de connexion présent, compte neuf, aucun mot de passe)
async function motDePasse(req: Request, b: any, sb: any): Promise<Response> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: ud } = await sb.auth.getUser(token)
  const user = ud?.user
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401)
  if (!(await rateHit('paiement-mdp:' + user.id, 3600, 10))) return json({ ok: false, error: 'rate' }, 429)
  const password = String(b?.password ?? '')
  if (password.length < PWD_MIN) return json({ ok: false, error: 'weak_password' }, 400)
  if (new TextEncoder().encode(password).length > PWD_MAX_BYTES) return json({ ok: false, error: 'password_too_long' }, 400)

  const { data: rows } = await sb.rpc('paiement_compte_etat', { p_user: user.id })
  const u: any = Array.isArray(rows) ? rows[0] : null
  if (!u || u.a_mot_de_passe || Date.now() - Date.parse(u.created_at) > NEUF_MS) return json({ ok: false, error: 'refuse' }, 403)
  const depuis = new Date(Date.now() - FENETRE_MS).toISOString()
  const { data: lk } = await sb.from('webhook_events').select('event_id').like('event_id', 'paiement-compte:%')
    .eq('body->data->>user', user.id).gte('received_at', depuis).limit(1)
  if (!lk || !lk.length) return json({ ok: false, error: 'refuse' }, 403)

  // autorisation à usage unique lue par le trigger guard_password_change (sinon la base garde l'ancien mot de passe)
  const { error: gErr } = await sb.from('password_change_grants').upsert(
    { user_id: user.id, expires_at: new Date(Date.now() + GRANT_TTL_S * 1000).toISOString() }, { onConflict: 'user_id' })
  if (gErr) { console.error('paiement-compte autorisation :', gErr.message); return json({ ok: false, error: 'server_error' }, 500) }
  const { error: upErr } = await sb.auth.admin.updateUserById(user.id, { password })
  const { data: reste } = await sb.from('password_change_grants').delete().eq('user_id', user.id).select('user_id')
  if (upErr) {
    const e = upErr as { code?: string; message?: string; reasons?: string[] }
    if (/longer than|too long/i.test(e.message || '')) return json({ ok: false, error: 'password_too_long' }, 400)
    if (e.code === 'weak_password' || /weak|pwned|leaked|at least|characters/i.test(e.message || '')) {
      return json({ ok: false, error: 'weak_password', reasons: Array.isArray(e.reasons) ? e.reasons.slice(0, 3) : [] }, 400)
    }
    console.error('paiement-compte mot de passe :', e.code || '', e.message || '')
    return json({ ok: false, error: 'server_error' }, 500)
  }
  if (reste && reste.length) { console.error('paiement-compte : autorisation non consommée'); return json({ ok: false, error: 'server_error' }, 500) }
  return json({ ok: true, email: user.email })
}
