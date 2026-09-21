// Instagram Auto-DM — AvatarAds
//  GET  : handshake de vérification du webhook Meta (hub.challenge) — étape 3 du dashboard app
//  POST : événements Instagram (commentaires + messages/postbacks) → « commentaire → DM » avec
//         GATE D'ABONNEMENT RÉEL (champ is_user_follow_business de l'API User Profile).
//
// Le flow (= celui de ManyChat / raph__ai, vérifié le 21/09) :
//   1. quelqu'un COMMENTE un mot-clé sous une publi  → webhook `comments`
//      → Private Reply (recipient.comment_id) : « abonne-toi puis clique Following » + bouton
//   2. la personne TAPE le bouton (quick_reply FOLLOW_CHECK) → webhook `messages`
//      → on interroge son profil : is_user_follow_business ?
//           false → on renvoie « pas encore abonné » (+ bouton)
//           true  → on envoie le LIEN
//
// verify_jwt=false (Meta appelle sans session Supabase — voir config.toml). Le VERIFY_TOKEN est
// choisi par NOUS (collé dans « Vérifier le token » côté Meta). L'APP_SECRET (secret Supabase
// IG_APP_SECRET) valide la signature X-Hub-Signature-256. Le token de compte vit dans ig_accounts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VERIFY_TOKEN = Deno.env.get('IG_VERIFY_TOKEN') || 'avatarads_ig_2026_dm'
const APP_SECRET   = Deno.env.get('IG_APP_SECRET') || ''
const GRAPH        = 'https://graph.instagram.com/v21.0'
const SB_URL       = Deno.env.get('SUPABASE_URL') || ''
const SERVICE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const svc = createClient(SB_URL, SERVICE)

// Défauts si aucune règle ig_rules (CTA AvatarAds « marque GO en commentaire »).
const DEF = {
  keywords: ['go', 'lien', 'link', 'test'],
  link: 'https://avatarads.fr',
  askTitle: 'Le lien est réservé aux abonnés 👀',
  askSub: "Abonne-toi à AvatarAds puis clique le bouton, je te l'envoie direct.",
  notyetTitle: "Tu n'es pas encore abonné 🙈",
  notyetSub: 'Abonne-toi à AvatarAds, reviens ici et clique le bouton.',
}
const BTN_LABEL = 'Je suis abonné'   // libellé du bouton (au lieu de « Following »)

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Réponses PUBLIQUES au commentaire (variées = anti-spam : IG flague les réponses identiques répétées).
const PUBLIC_REPLIES = [
  'Check tes DM !', 'Regarde tes messages 📩', "C'est envoyé !", "Parfait, c'est dans tes DM !",
  'Envoyé en privé 🚀', 'Go voir ta messagerie !', "Je viens de t'écrire !", "C'est dans tes DM !",
  'Regarde tes DM 👀', 'Message envoyé !',
]
// choix déterministe (même commentaire rejoué → même réponse, pas de doublon variable)
const pick = (arr: string[], seed: string) =>
  arr[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % arr.length]

// ── Signature Meta (X-Hub-Signature-256 = HMAC-SHA256 du corps brut) ──
async function validSignature(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return true                              // pas encore configuré : on ne bloque pas (dev)
  if (!header || !header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
  return ('sha256=' + hex) === header
}

async function accountToken(igId: string): Promise<string | null> {
  const { data } = await svc.from('ig_accounts').select('access_token').eq('ig_id', igId).single()
  if (data?.access_token) return data.access_token           // multi-compte (OAuth → ig_accounts)
  return Deno.env.get('IG_TOKEN') || null                    // repli dev mono-compte (secret Supabase)
}

// Règle applicable (la plus spécifique par media_id, sinon la règle par défaut, sinon DEF).
async function loadRule(igId: string, mediaId?: string) {
  const base = {
    keywords: DEF.keywords.map(norm), link: DEF.link,
    askTitle: DEF.askTitle, askSub: DEF.askSub, notyetTitle: DEF.notyetTitle, notyetSub: DEF.notyetSub,
  }
  try {
    const { data } = await svc.from('ig_rules').select('*').eq('ig_id', igId).eq('active', true)
    const rows = data || []
    const r = rows.find((x: any) => mediaId && x.media_id === mediaId) || rows.find((x: any) => !x.media_id)
    if (r) {
      if (r.keywords?.length) base.keywords = r.keywords.map(norm)
      if (r.link) base.link = r.link
      if (r.ask_message) base.askSub = String(r.ask_message).slice(0, 80)   // subtitle ≤ 80 car.
    }
  } catch { /* défauts */ }
  return base
}

// Un utilisateur suit-il le compte ? (API User Profile — dispo une fois en conversation)
async function isFollower(igsid: string, token: string): Promise<boolean | null> {
  try {
    const r = await fetch(`${GRAPH}/${igsid}?fields=is_user_follow_business&access_token=${token}`)
    const j = await r.json().catch(() => ({}))
    return typeof j.is_user_follow_business === 'boolean' ? j.is_user_follow_business : null
  } catch { return null }
}

async function sendMessage(igId: string, token: string, recipient: unknown, message: unknown) {
  const r = await fetch(`${GRAPH}/me/messages`, {           // `me` = compte du token (robuste vs id d'entry)
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient, message }),
  })
  if (!r.ok) console.log('[ig-autodm] send fail', r.status, (await r.text()).slice(0, 250))
  return r
}

// Réponse PUBLIQUE sous le commentaire (« check tes DM ! ») — nécessite instagram_business_manage_comments
async function replyToComment(commentId: string, token: string, text: string) {
  const r = await fetch(`${GRAPH}/${commentId}/replies`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  })
  if (!r.ok) console.log('[ig-autodm] reply fail', r.status, (await r.text()).slice(0, 250))
  return r
}

// Carte (generic template) : bouton INTÉGRÉ dans la bulle (style ManyChat) + libellé custom.
// Le tap = postback silencieux (ne pollue pas la conv). title/subtitle ≤ 80 caractères.
const card = (title: string, subtitle: string) => ({
  attachment: { type: 'template', payload: { template_type: 'generic',
    elements: [{ title, subtitle, buttons: [{ type: 'postback', title: BTN_LABEL, payload: 'FOLLOW_CHECK' }] }] } },
})
const askMsg    = (rule: any) => card(rule.askTitle, rule.askSub)
const notYetMsg = (rule: any) => card(rule.notyetTitle, rule.notyetSub)
const linkMsg   = (url: string) => ({ text: "C'est bon, merci de ton soutien 🙌 Voici le lien pour tester AvatarAds : " + url })
// Lien tracké : passe par avatarads.fr/r.html (logge le clic → CTR) puis redirige vers rule.link.
const trackedLink = (igId: string, sender: string, dest: string) =>
  'https://avatarads.fr/r.html?u=' + encodeURIComponent(sender) + '&ig=' + encodeURIComponent(igId) + '&to=' + encodeURIComponent(dest)

async function alreadyDone(field: 'comment_id' | 'sender_id', value: string, kind: string): Promise<boolean> {
  const { data } = await svc.from('ig_dm_log').select('id').eq(field, value).eq('kind', kind).limit(1)
  return !!(data && data.length)
}
async function logDm(row: Record<string, unknown>) {
  try { await svc.from('ig_dm_log').insert(row) } catch (e) { console.log('[ig-autodm] log err', String(e)) }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // 1) Handshake de vérification du webhook (GET)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response('forbidden', { status: 403 })
  }

  // 2) Événements (POST) — ACK immédiat, traitement en tâche de fond
  if (req.method === 'POST') {
    const raw = await req.text()
    // Signature en LOG-ONLY pour le 1er test (on ne bloque pas). À repasser en strict (return 401)
    // une fois le flux confirmé end-to-end et IG_APP_SECRET vérifié.
    if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) {
      console.log('[ig-autodm] signature invalide — on continue (dev)')
    }
    let body: any = {}
    try { body = JSON.parse(raw) } catch { /* ignore */ }
    ;(async () => { try { await handleEvent(body) } catch (e) { console.log('[ig-autodm] handle error', String(e)) } })()
    return new Response('EVENT_RECEIVED', { status: 200 })
  }

  return new Response('ok', { status: 200 })
})

async function handleEvent(body: any) {
  for (const entry of (body.entry || [])) {
    const igId = String(entry.id || '')
    const token = await accountToken(igId)
    if (!token) { console.log('[ig-autodm] pas de token pour', igId); continue }

    // a) Commentaires : mot-clé → Private Reply avec bouton
    for (const ch of (entry.changes || [])) {
      if (ch.field !== 'comments') continue
      const v = ch.value || {}
      const commentId = String(v.id || '')
      const fromId = v.from?.id ? String(v.from.id) : ''
      if (!commentId || fromId === igId) continue            // ignore ses propres commentaires
      const text = norm(v.text)
      const rule = await loadRule(igId, v.media?.id)
      if (!rule.keywords.some((k: string) => text.includes(k))) continue
      if (await alreadyDone('comment_id', commentId, 'ask')) continue   // dédup : 1 réponse / commentaire
      await replyToComment(commentId, token, pick(PUBLIC_REPLIES, commentId))   // réponse PUBLIQUE variée
      await sendMessage(igId, token, { comment_id: commentId }, askMsg(rule))    // DM privé + bouton
      await logDm({ ig_id: igId, comment_id: commentId, sender_id: fromId, media_id: v.media?.id || null, kind: 'ask' })
      console.log('[ig-autodm] ASK + réponse publique sur commentaire', commentId)
    }

    // b) Messages / postbacks : tap du bouton → gate d'abonnement → lien
    for (const m of (entry.messaging || [])) {
      const sender = m.sender?.id ? String(m.sender.id) : ''
      if (!sender || sender === igId) continue
      const payload = m.postback?.payload || m.message?.quick_reply?.payload
      if (payload !== 'FOLLOW_CHECK') continue
      const rule = await loadRule(igId)
      const follows = await isFollower(sender, token)
      if (follows === true) {
        await sendMessage(igId, token, { id: sender }, linkMsg(trackedLink(igId, sender, rule.link)))
        await logDm({ ig_id: igId, sender_id: sender, kind: 'link' })
        console.log('[ig-autodm] LIEN envoyé à', sender)
      } else {
        await sendMessage(igId, token, { id: sender }, notYetMsg(rule))
        await logDm({ ig_id: igId, sender_id: sender, kind: 'notyet' })
        console.log('[ig-autodm] pas encore abonné', sender, '(follows=', follows, ')')
      }
    }
  }
}
