// Supabase Edge Function — 🎬 render-job (#113, partie 4)
// File de rendu serveur du Montage IA : cree un job (plan + video uploadee par le
// client dans render-media/<uid>/...) et donne son statut (+ URL signee du MP4 final).
// Le rendu lui-meme est fait par render-worker/ (poll de la table render_jobs).
//
// Auth : JWT utilisateur (verify_jwt au gateway). Credits debites cote client via
// spendCreditsFor AVANT l'appel (pattern des autres proxys).
//
// POST JSON :
//   { action:'create', plan:{...}, input_video:'<uid>/in-x.mp4', assets:[{id,path,kind}], avatar_clips?:['<uid>/av0.mp4',…] } -> { ok, job_id }
//   (kind: 'image' | 'video' — #111 ; avatar_clips = scenes lipsync #119, ordre = plan.avatarSegments)
//   { action:'status', job_id } -> { ok, status, url?, error?, progress? [, variants, zip, controle (Décupleur)] }
//     25/10 : Décupleur en cours → variants = celles DÉJÀ envoyées par le moteur ({ n, url, play, poster }), n_total ;
//     chaque variante a un lien de lecture (play, sans téléchargement) en plus du lien de téléchargement (url)
//   Décupleur (24/10, developer / owner) : { action:'dc-fetch', url } · { action:'dc-cut', input_video, a, b }
//     · { action:'decupleur', input_video, a, b, n, alt, textPos, master? } -> { ok, job_id }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { billableGate, userPlan, reserveStrict, reserveEnforce, requirePlan, PLANS_PAYANTS, COMPOSE_SANS_TIRAGE, RENDU_MONTAGE_MIN, plancherRenduOp,
  MONTAGE_DUREE_MAX, RENDU_DUREE_MAX, RETOUCHE_OCTETS_MAX, RETOUCHE_EN_COURS_MAX, MOTION_ASSETS, fichierDuFlux, opMotionRecente,
  opFondVideo, opRenduMontage, tailleObjet } from '../_shared/guard.ts'
import { cheminSur, planClientRenderJob } from '../_shared/storage-path.ts'
import { lienDecupleur, lienEstLive, DC_MSG_LIVE, DC_VARIANTES, DC_PASSAGE_MAX, DC_PERSO_MAX, DC_BUDGET_S, DC_PLANS, DC_CR_VARIANTE, decupleurOuvert } from '../_shared/decupleur.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aa-op',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
// Clés de job d'un rendu (une par op tirée, 3 au plus) — MÊMES clés dans render-worker/worker.mjs (reservationJob).
const DC_COMPOSES = ['dc-fetch', 'dc-cut', 'decupleur']
const cleRendu = (id: string) => ['render:' + id, 'render:' + id + '#1', 'render:' + id + '#2']
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    // utilisateur reel depuis le JWT
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Non authentifie' }, 401)

    const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    // Audit 02/10 (WRK-4) : corps borné AVANT décodage (le plus gros plan réel fait ~150 Ko, le plan est plafonné à 512 Ko).
    if (Number(req.headers.get('content-length') || 0) > 1024 * 1024) return json({ error: 'requête trop volumineuse' }, 413)
    const body = await req.json().catch(() => ({}))

    if (body.action === 'create') {
      // Audit 04/10 (GEN-1, MC-2 — contrat K2) : le Générateur (gen-subs) et Motion Control (motion-split / motion-bg) ne
      // débitent RIEN pour ce rendu (vidéo déjà payée) : depuis RESERVE_STRICT (14/09), l'exigence d'un débit récent puis d'une
      // op tirable les refusait (402) pour tout client — Voix native et Vidéo existante bloquées, split Motion Control livré en
      // plein écran. Ces compositions passent SANS tirage, sous contrôles serveur : plan payant, chemins du flux, cadence,
      // « 2 en cours », op Motion Control récente (motion-*). La composition est lue ici, le plan complet est contrôlé plus bas
      // (planClientRenderJob refuse toute autre valeur de __compose).
      const bp = body.plan
      const composeDemande = (bp && typeof bp === 'object' && !Array.isArray(bp) && typeof bp.__compose === 'string') ? String(bp.__compose) : ''
      const sansTirage = COMPOSE_SANS_TIRAGE.includes(composeDemande)
      if (sansTirage) { const _p = await requirePlan(user.id, PLANS_PAYANTS, 'Le rendu serveur'); if (!_p.ok) return json({ error: _p.error }, _p.status) }
      // Audit 10/10 : un MONTAGE (plan sans __compose) est réservé à l'Élite pendant la bêta, comme dans l'app (montageGo),
      // orchestrate et le MCP. Avant, un Starter pouvait débiter puis envoyer un plan fait main. Owner / developer passent.
      if (!composeDemande) { const _pm = await requirePlan(user.id, ['elite'], 'Le Montage IA'); if (!_pm.ok) return json({ error: 'Le Montage IA est réservé au plan Élite pendant la bêta' }, 403) }
      // Audit #3 : rendu serveur = coût worker. Exiger un débit récent (le client débite AVANT) + plafond.
      const _g = await billableGate({ userId: user.id, proxy: 'render-job', requireDebit: !sansTirage, debitMinutes: 60, rateMax: 20 }); if (!_g.ok) return json({ error: _g.error }, _g.status)
      const plan = body.plan
      if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !Number(plan.duration)) return json({ error: 'plan invalide (duration manquante)' }, 400)
      if (Number(plan.duration) > RENDU_DUREE_MAX) return json({ error: 'video trop longue (max 5 min)' }, 400)
      // Audit 04/10 (MONT-1) : un MONTAGE (plan sans __compose) ne dépasse jamais la durée analysée par orchestrate (180 s ;
      // l'app et le MCP plafonnent à 90 s) — avant, 300 s passaient pour le prix d'un rendu.
      if (!composeDemande && Number(plan.duration) > MONTAGE_DUREE_MAX) return json({ error: 'montage trop long (max 3 min)' }, 400)
      // Audit 02/10 (WRK-1) : « commence par <uid>/ » ne suffisait pas — un segment parent (« .. », « %2e%2e ») visait le
      // fichier d'un autre compte ou un autre bucket (la clé service signe et télécharge sans RLS). Motif fermé : cheminSur.
      const input = cheminSur(user.id, body.input_video)
      if (!input) return json({ error: 'chemin invalide' }, 400)
      // Audit 04/10 : chaque composition sans tirage ne lit que les fichiers de SON flux (seuls producteurs : l'app,
      // _genServerCompose → <uid>/gen-<ts>.mp4, Motion Control → <uid>/mc-<ts>-<rnd>….mp4).
      if (composeDemande === 'gen-subs' && !fichierDuFlux(user.id, input, 'gen-', true)) return json({ error: 'chemin invalide' }, 400)
      if (composeDemande.startsWith('motion-') && !fichierDuFlux(user.id, input, 'mc-', true)) return json({ error: 'chemin invalide' }, 400)
      // Audit 02/10 (WRK-4) : plan borné (taille, tableaux) et clés internes du moteur filtrées — liste blanche et
      // recensement des producteurs dans _shared/storage-path.ts. __lipsync / __brief ne passent QUE s'ils reprennent la
      // valeur d'un job précédent du compte sur la MÊME source (régénération « Détails du montage » d'un montage lancé
      // depuis Claude) : un client peut les retirer, jamais les ajouter. Hoquet DB → pas d'héritage (drapeaux retirés).
      // #montage-audio : le son optionnel (plan.userAudioPath) reste sous <uid>/, sinon il est ignoré (comme avant).
      let herite: Record<string, unknown> | null = null
      if (plan.__lipsync !== undefined || plan.__brief !== undefined) {
        try {
          const { data: prev, error: prevErr } = await service.from('render_jobs').select('plan')
            .eq('user_id', user.id).eq('input_video', input).order('created_at', { ascending: false }).limit(10)
          if (!prevErr) herite = ((prev ?? []).map((r: { plan: Record<string, unknown> | null }) => r.plan)
            .find((p: Record<string, unknown> | null) => !!p && (p.__lipsync != null || p.__brief != null))) ?? null
        } catch (_) { herite = null }
      }
      const verdict = planClientRenderJob(user.id, plan as Record<string, unknown>, herite)
      if ('error' in verdict) return json({ error: verdict.error }, verdict.status)
      if (verdict.retirees.length) console.warn(`[render-job] clés internes retirées du plan client user=${user.id} : ${verdict.retirees.map((k) => k.slice(0, 40).replace(/[^\w-]/g, '?')).join(',')}`)
      const compose = typeof plan.__compose === 'string' ? plan.__compose : ''
      if (compose !== composeDemande) return json({ error: 'plan invalide' }, 400)   // défense en profondeur (lu avant / après contrôle)
      // Médias b-roll : un chemin invalide est REFUSÉ (400). Seules exceptions, ignorées comme avant : une entrée sans chemin,
      // et un média « _local » (blob du navigateur qu'un ancien client renvoyait sans l'avoir déposé au stockage).
      // Audit 04/10 (GEN-4, MC-2) : gen-subs ne lit AUCUN média (le worker les téléchargeait quand même) → ignorés ; motion-*
      // ne lit que ses médias nommés (motion, matted, refmask, bgclean), dans les fichiers de son flux (<uid>/mc-…).
      const assets: { id: string; path: string; kind: string }[] = []
      for (const a of (Array.isArray(body.assets) ? body.assets : []).slice(0, 8) as { id?: unknown; path?: unknown; kind?: unknown; _local?: unknown }[]) {
        if (compose === 'gen-subs') break
        if (!a || typeof a !== 'object' || a._local === true || a.path == null || a.path === '') continue
        const id = String(a.id || '').slice(0, 40)
        if (!id || /[\/\\]|\.\./.test(id)) continue   // C2 (audit 14/09) : jamais de / \ .. dans a.id (path traversal → RCE dans le worker)
        if (compose.startsWith('motion-') && !MOTION_ASSETS.includes(id)) continue
        const path = cheminSur(user.id, a.path)
        if (!path) return json({ error: 'chemin invalide' }, 400)
        if (compose.startsWith('motion-') && !fichierDuFlux(user.id, path, 'mc-')) return json({ error: 'chemin invalide' }, 400)
        assets.push({ id, path, kind: a.kind === 'video' ? 'video' : 'image' })
      }

      // #119 lipsync segmenté : clips avatar (ordre = plan.avatarSegments), chemins <uid>/… — un chemin invalide est refusé
      // (l'ignorer décalerait les clips suivants sur la mauvaise scène). Audit 04/10 : seul un MONTAGE en lit (compositions : ignorés).
      const avatar_clips: string[] = []
      for (const p of (Array.isArray(body.avatar_clips) && !compose ? body.avatar_clips : []).slice(0, 8)) {
        if (p == null || p === '') continue
        const c = cheminSur(user.id, p)
        if (!c) return json({ error: 'chemin invalide' }, 400)
        avatar_clips.push(c)
      }

      // Audit 04/10 (MC-2) : une composition Motion Control suit une génération Motion Control RÉCENTE du compte (op « motion »,
      // « motion-topaz » ou « motion-fond-video » non remboursée de moins de 6 h : « Appliquer le cadrage » peut venir plus tard).
      const { plan: uplan, isOwner, err: planErr } = await userPlan(user.id)
      const exempt = planErr || isOwner || uplan === 'developer'   // owner/dev ou hoquet DB → fail-open
      if (compose.startsWith('motion-') && !exempt && !(await opMotionRecente(user.id))) {
        return json({ error: 'Aucune génération Motion Control récente pour cette composition — relance la génération.' }, 402)
      }

    // ── UN JOB MORT NE BLOQUE PLUS LA FILE ──────────────────────────────────
    // Axel, 03/08 : « pourquoi ça met ça wtf ? je n'ai pas de rendu en cours ».
    // Il en avait deux — laissés en « rendering » depuis 19 h et 17 h, tués par
    // un redémarrage de Railway au milieu de leur travail. Personne ne les a
    // jamais enterrés : le worker ne peut pas écrire son propre certificat de
    // décès quand il meurt.
    //
    // Le garde-fou les comptait, et deux cadavres suffisaient à verrouiller le
    // Montage IA pour toujours. Un rendu dépasse rarement 9 minutes et jamais
    // 45 ; au-delà, le job est mort, pas occupé. On ne compte donc que les
    // rendus RÉCENTS. Les vieux sont marqués échoués au passage, pour que la
    // liste dise la vérité et que le compteur ne les revoie plus.
    {
      // 10/10 : « mort » = sans battement depuis 45 min (le moteur rafraîchit updated_at toutes les 2 min et reprend
      // lui-même ses orphelins) — plus la date de création : un job remis en file après un redéploiement n'est pas mort.
      const limite = new Date(Date.now() - 45 * 60 * 1000).toISOString()
      const { data: morts } = await service.from('render_jobs')
        .update({ status: 'failed', error: 'moteur interrompu pendant le rendu — job clos automatiquement' })
        .eq('user_id', user.id).in('status', ['queued', 'rendering']).lt('updated_at', limite)
        .select('id, plan, input_video, assets')
      // Audit métier 06/09 + 10/10 : un job mort clos ici REMBOURSE (refund_job_open, une seule fois) ; repli : la réserve
      // est rendue (release_by_job) si l'op est encore entamée ailleurs.
      for (const m of (morts ?? [])) for (const k of cleRendu(m.id)) {
        try {
          const { data: r, error: e } = await service.rpc('refund_job_open', { p_user: user.id, p_job: k })
          const rr = (r ?? {}) as { ok?: boolean; reason?: string }
          if (e || (!rr.ok && ['in_progress', 'no_drawn'].includes(String(rr.reason)))) await service.rpc('release_by_job', { p_user: user.id, p_job: k, p_cost: 9999 })
        } catch (_) { /* best-effort */ }
      }
      // « Cloner l'audio » (09/10) : un job 'motion-voix' mort laisse sa vidéo copiée et sa voix sous voix-prep/<uid>/ → supprimées
      // ici (list_media_purge les liste aussi, au-delà d'1 jour, mais la purge planifiée n'est PAS active : décision du 04/10).
      const prives: string[] = []
      for (const m of (morts ?? []) as { plan?: { __compose?: string }; input_video?: string; assets?: { path?: string }[] }[]) {
        if (m.plan?.__compose !== 'motion-voix') continue
        for (const p of [m.input_video, ...(Array.isArray(m.assets) ? m.assets.map((a) => a?.path) : [])]) {
          if (typeof p === 'string' && p.startsWith(`voix-prep/${user.id}/`) && !p.includes('..')) prives.push(p)
        }
      }
      if (prives.length) { try { await service.storage.from('render-media').remove(prives) } catch (_) { /* best-effort */ } }

      const { count } = await service.from('render_jobs').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).in('status', ['queued', 'rendering']).gte('updated_at', limite)
      if ((count ?? 0) >= 2) return json({ error: 'Tu as deja un rendu en cours — attends qu\'il se termine' }, 429)
    }

      // C1 (audit 14/09, durci re-audit) — render-job fail-closed + ANTI-RACE. Le rendu worker facture Hedra/fal
      // en service_role SANS re-gate → ce tirage est la SEULE barrière. On RÉSOUT puis on TIRE la réserve AVANT
      // de créer le job : draw_full est atomique (UPDATE ... WHERE reserve>0), donc un burst concurrent sur la
      // même op → UN SEUL tirage gagne, les perdants prennent 402 (sinon N montages rendus pour 1 seul débit).
      // Ops DÉSIGNÉES par l'app (relecture 26/09, Montage IA avatar) : body.ops = [op du montage, op de l'habillage]. Avant, la
      // « dernière op ouverte » était prise : l'op scènes (reliquat habillage) au lieu de l'op montage → les 6 crédits du rendu
      // restaient remboursables APRÈS la livraison (refund-and-keep). Chaque op désignée est REVÉRIFIÉE ici (resolve_op doit la
      // renvoyer telle quelle : à l'utilisateur, ouverte, réserve > 0, < 2 h), puis tirée ENTIÈRE. La 1re (le montage) est
      // obligatoire ; sans désignation (Éditeur, autres flux) : comportement d'avant (dernière op ouverte). Une désignation
      // DEMANDÉE (tableau non vide) mais illisible ne retombe JAMAIS sur « la dernière op ouverte » : aucune op → 402.
      // Audit 04/10 (GEN-1, MC-2) : gen-subs et motion-split ne tirent AUCUNE op (ni « la dernière op ouverte » du compte, qui
      // vidait celle d'une autre fonctionnalité en cours) ; motion-bg ne tire que SON op « motion-fond-video », si elle existe.
      const tires: { op: string; amt: number }[] = []
      if (!sansTirage) {
        const demande = Array.isArray(body.ops) && body.ops.length > 0
        const designees = [...new Set((demande ? body.ops : []).map((x: unknown) => String(x ?? '').trim()).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 3) as string[]
        let opIds: string[] = []
        let opErr = false
        try {
          if (demande) {
            for (const [k, h] of designees.entries()) {
              const { data: _op, error: _e } = await service.rpc('resolve_op', { p_user: user.id, p_hint: h })
              if (_e) { if (k === 0) opErr = true; break }   // hoquet sur l'habillage : l'op du montage reste tirée
              if (_op === h) opIds.push(h)
              else if (k === 0) { opIds = []; break }   // l'op du montage n'est plus tirable → aucune (jamais une autre op à sa place)
            }
          } else {
            // Audit 04/10 (MONT-1) : sans désignation, l'op d'un débit de MONTAGE qui couvre le plancher d'abord (opRenduMontage) ;
            // à défaut, l'ancienne résolution (dernière op ouverte, revérifiée par resolve_op).
            const _m = await opRenduMontage(user.id)
            if (_m) opIds = [_m]
            else {
              const { data: _op, error: _e } = await service.rpc('resolve_op', { p_user: user.id, p_hint: null })
              if (_e) opErr = true; else if (_op) opIds = [String(_op)]
            }
          }
        } catch (e) { console.warn('resolve_op render-job (fail-open technique):', (e as Error).message); if (!opIds.length) opErr = true }
        if (!opIds.length && !opErr && !exempt) {
          console.warn(`[reserve-strict] render-job user=${user.id} : aucune op tirable (strict=${reserveStrict()}, désignées=${designees.length})`)
          if (reserveStrict()) return json({ error: 'Aucune réservation de crédits ouverte pour ce rendu.' }, 402)
        }
        // Tirage AVANT l'insertion + on vérifie le montant : un perdant du burst (op déjà à 0) → 402, pas de job.
        if (!opErr) {
          // 11/10 : plancher de l'op principale — 1 si le chef d'orchestre y a déjà tiré son plan (prix fixe du niveau), sinon 4
          const plancherMain = opIds.length ? await plancherRenduOp(user.id, opIds[0]) : RENDU_MONTAGE_MIN
          for (const o of opIds) {
            // audit 14/09 : draw_full_reservation renvoie le MONTANT tiré (int, 0 = rien).
            // Audit 04/10 (MONT-1) : l'op PRINCIPALE doit porter au moins le prix du rendu (RENDU_MONTAGE_MIN = montageRender) —
            // avant, le plancher valait 1 : spend_credits(1) finançait un rendu serveur. Flux légitimes : montage IA (8 − 2 tirés
            // par orchestrate = 6), Éditeur et régénération (4). L'habillage (2e op désignée) reste tiré entier, sans plancher.
            let amt = 0
            try { const { data: _ok } = await service.rpc('draw_full_reservation', { p_user: user.id, p_op: o, p_min: o === opIds[0] ? plancherMain : 1 }); amt = Number(_ok) || 0 }
            catch (e) { console.warn('draw_full render-job:', (e as Error).message) }
            if (amt > 0) tires.push({ op: o, amt })
            else if (o === opIds[0]) break   // l'op principale n'a rien donné : on ne tire pas les autres
          }
          const drewMain = tires.length > 0 && tires[0].op === opIds[0]
          if (opIds.length && !drewMain && !exempt) console.warn(`[reserve-full] render-job user=${user.id} : op principale sous le plancher (${RENDU_MONTAGE_MIN}) ou vide (enforce=${reserveEnforce()})`)
          if (opIds.length && !drewMain && !exempt && reserveEnforce()) {
            for (const t of tires) { try { await service.rpc('release_reservation', { p_user: user.id, p_op: t.op, p_cost: t.amt }) } catch (_) { /* best-effort */ } }
            return json({ error: 'Réservation de crédits insuffisante pour ce rendu.' }, 402)
          }
        }
      } else if (compose === 'motion-bg' && !exempt) {
        // le supplément « fond vidéo » est réglé à la livraison (settle_by_job), rendu à l'échec (release_by_job) — comme avant
        const fv = await opFondVideo(user.id)
        if (fv) {
          try { const { data: _ok } = await service.rpc('draw_full_reservation', { p_user: user.id, p_op: fv, p_min: 1 }); const amt = Number(_ok) || 0; if (amt > 0) tires.push({ op: fv, amt }) }
          catch (e) { console.warn('draw_full motion-bg:', (e as Error).message) }
        }
      }
      const { data, error } = await service.from('render_jobs')
        .insert({ user_id: user.id, status: 'queued', plan, input_video: input, assets, avatar_clips })
        .select('id').single()
      if (error) {
        for (const t of tires) { try { await service.rpc('release_reservation', { p_user: user.id, p_op: t.op, p_cost: t.amt }) } catch (_) { /* best-effort */ } }   // job non créé → rendre EXACTEMENT les tirages
        return json({ error: error.message }, 500)
      }
      // lie chaque op tirée au job (+ montant tiré) → le worker règle (settle_by_job) à la livraison, libère (release_by_job) à
      // l'échec. Une op par clé de job (provider_job n'en lie qu'une) : 'render:<id>', puis 'render:<id>#1', '#2'.
      const cles = cleRendu(data.id)
      let lieePrincipale = true
      for (const [k, t] of tires.entries()) {
        try {
          const { data: _lie, error: _le } = await service.rpc('bind_reservation_job', { p_user: user.id, p_op: t.op, p_job: cles[k], p_drawn: t.amt })
          // Audit 10/10 (C38) : une op DÉJÀ liée à un autre rendu (provider_job rempli) refuse la liaison ; tirée sans lien, un
          // échec de CE rendu ne la rembourserait jamais. Pour l'op principale : on rend les tirages et on ne rend pas.
          if (!_le && _lie === false && k === 0) lieePrincipale = false
        } catch (e) { console.warn('bind render:', (e as Error).message) }
      }
      if (!lieePrincipale && !exempt) {
        // le job est déjà visible du moteur : on le FERME d'abord, et on ne rend les tirages que si c'est bien nous qui
        // l'avons fermé — s'il est déjà pris, il se rend (tirages gardés) plutôt que de livrer une vidéo payée et remboursée
        const { data: clos } = await service.from('render_jobs').update({ status: 'failed', error: 'réservation déjà liée à un autre rendu' })
          .eq('id', data.id).eq('status', 'queued').select('id')
        if (clos && clos.length) {
          for (const t of tires) { try { await service.rpc('release_reservation', { p_user: user.id, p_op: t.op, p_cost: t.amt }) } catch (_) { /* best-effort */ } }
          return json({ error: 'Réservation de crédits insuffisante pour ce rendu.' }, 402)
        }
      }
      return json({ ok: true, job_id: data.id })
    }

    // RETOUCHE « FORTE » d'une vidéo Omni Flash (Axel 02/10) : couleurs, netteté et grain recalés sur la photo de départ par le
    // render-worker (retouche.mjs, ~10 s, prioritaire). GRATUITE (la vidéo est déjà payée) mais BORNÉE : un débit récent exigé
    // (une génération vient d'être payée), plafond de cadence, fichiers obligatoirement dans le dossier de l'utilisateur.
    if (body.action === 'retouche') {
      const _g = await billableGate({ userId: user.id, proxy: 'render-job-retouche', requireDebit: true, debitMinutes: 60, rateMax: 30 }); if (!_g.ok) return json({ error: _g.error }, _g.status)
      // Audit 02/10 (WRK-1) : le seul refus de « .. » littéral laissait passer « %2e%2e » → motif fermé (cheminSur).
      const input = cheminSur(user.id, body.input_video), photo = cheminSur(user.id, body.photo)
      if (!input || !photo) return json({ error: 'chemin invalide' }, 400)
      if (!/\.mp4$/i.test(input)) return json({ error: 'input_video invalide' }, 400)
      if (!/\.(png|jpe?g|webp)$/i.test(photo)) return json({ error: 'photo invalide' }, 400)
      // Audit 04/10 (EXP-1, GEN-4) : la retouche passe DEVANT la file du moteur — fichiers de SON flux seulement (seul producteur :
      // _expRetouche → <uid>/retouche-<ts>-<rnd>.mp4|.png|.jpg ; le MCP insère ses retouches lui-même), bornée en taille (une
      // vidéo Omni / Veo de 10 s pèse ~70 Mo au plus ; le bucket en accepte 500) et à 2 retouches en cours par compte (Express +
      // Voix native). Le moteur borne aussi la durée et la résolution. Tout refus garde la vidéo d'origine côté app.
      if (!fichierDuFlux(user.id, input, 'retouche-', true) || !fichierDuFlux(user.id, photo, 'retouche-')) return json({ error: 'chemin invalide' }, 400)
      const taille = await tailleObjet('render-media', input)
      if (taille !== null && taille > RETOUCHE_OCTETS_MAX) return json({ error: 'Vidéo trop lourde pour la retouche.' }, 413)
      {
        const { count, error: cErr } = await service.from('render_jobs').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).in('status', ['queued', 'rendering']).eq('plan->>__compose', 'retouche')
          .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
        if (!cErr && (count ?? 0) >= RETOUCHE_EN_COURS_MAX) return json({ error: 'Une retouche est déjà en cours — patiente quelques secondes.' }, 429)
      }
      const { data, error } = await service.from('render_jobs')
        .insert({ user_id: user.id, status: 'queued', plan: { __compose: 'retouche' }, input_video: input, assets: [{ id: 'photo', path: photo }], avatar_clips: [] })
        .select('id').single()
      if (error || !data) return json({ error: 'creation impossible' }, 500)
      return json({ ok: true, job_id: data.id })
    }

    // ── DÉCUPLEUR (Axel 24/10) — owner / developer (illimités), et Pro / Élite une fois DECUPLEUR_OUVERT=1 ──────────────────
    // dc-fetch : lien TikTok / Instagram → <uid>/<job>.mp4 (téléchargé par le moteur) ; dc-cut : passage gardé seul (≤ 15 s,
    // vidéo de référence du changement de personnage) ; decupleur : N variantes sous <uid>/dc-<job>/. Plan RECONSTRUIT ici
    // (jamais repris du client), chemins contrôlés (cheminSur), 3 jobs en cours au plus. Récupération et découpe : gratuites
    // (bornées en cadence). Variantes d'un compte non illimité : la réservation de l'app (spendCreditsFor, op DÉSIGNÉE dans
    // body.ops) est tirée ENTIÈRE ici, au moins ceil(N × 0,5), AVANT l'insertion, puis liée au job (render:<id>) → le moteur la
    // règle à la livraison, la rembourse à l'échec (reservationJob). Plan illisible (hoquet DB) → refus : jamais un rendu payant
    // accordé « au doute ».
    if (DC_COMPOSES.includes(String(body.action))) {
      const { plan: dcPlan, isOwner: dcOwner, err: dcErr } = await userPlan(user.id)
      if (dcErr) return json({ error: 'Vérification du compte impossible — réessaie dans un instant' }, 503)
      const dcExempt = dcOwner || dcPlan === 'developer'
      if (!dcExempt && !(decupleurOuvert() && DC_PLANS.includes(dcPlan))) return json({ error: 'Le Décupleur est inclus dans tous les plans : choisis un plan pour commencer' }, 403)
      const _g = await billableGate({ userId: user.id, proxy: 'render-job-dc', requireDebit: !dcExempt && body.action === 'decupleur', debitMinutes: 60, rateMax: 30 }); if (!_g.ok) return json({ error: _g.error }, _g.status)
      {
        const { count, error: cErr } = await service.from('render_jobs').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).in('status', ['queued', 'rendering']).in('plan->>__compose', DC_COMPOSES)
          .gte('updated_at', new Date(Date.now() - 45 * 60 * 1000).toISOString())
        if (!cErr && (count ?? 0) >= 3) return json({ error: 'Un décuplage est déjà en cours — attends qu\'il se termine' }, 429)
      }
      const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN }
      let plan: Record<string, unknown>
      let input: string | null
      let assets: { id: string; path: string; kind: string }[] = []
      if (body.action === 'dc-fetch') {
        const u = lienDecupleur(body.url)
        if (!u) return json({ error: lienEstLive(body.url) ? DC_MSG_LIVE : 'Lien TikTok ou Instagram uniquement' }, 400)
        plan = { __compose: 'dc-fetch', lien: u, duration: 1 }   // « lien » et pas « url » : aucune clé média du nettoyeur du moteur (assainirPlan)
        input = `${user.id}/dc-lien-${Date.now()}.mp4`   // clé réservée : le moteur lit le LIEN, jamais ce fichier
      } else {
        input = cheminSur(user.id, body.input_video)
        if (!input || !/\.(mp4|mov|webm|m4v)$/i.test(input)) return json({ error: 'chemin invalide' }, 400)
        const a = num(body.a), b = num(body.b)
        if (!(a >= 0) || !(b > a) || b - a < 1) return json({ error: 'passage invalide (1 s minimum)' }, 400)
        if (body.action === 'dc-cut') {
          if (b - a > DC_PERSO_MAX + 0.05) return json({ error: `Passage de ${DC_PERSO_MAX} s maximum avec le changement de personnage` }, 400)
          plan = { __compose: 'dc-cut', a, b, duration: b - a }
        } else {
          const n = Number(body.n)
          if (!DC_VARIANTES.includes(n)) return json({ error: 'nombre de variantes invalide' }, 400)
          if (b - a > DC_PASSAGE_MAX + 0.05) return json({ error: `Passage de ${DC_PASSAGE_MAX} s maximum` }, 400)
          if (n * (b - a) > DC_BUDGET_S + 1) return json({ error: `Trop long pour ×${n} : garde ${Math.floor(DC_BUDGET_S / n)} s maximum` }, 400)
          const al = (body.alt && typeof body.alt === 'object' && !Array.isArray(body.alt)) ? body.alt as Record<string, unknown> : {}
          const alt = { mirror: al.mirror === true, pixels: al.pixels === true, tint: al.tint === true, audio: al.audio === true, text: al.text === true }
          const textPos = ['Haut', 'Centre', 'Bas', 'Aléatoire'].includes(String(body.textPos)) ? String(body.textPos) : 'Haut'   // 27/10 (Axel) : texte choc en haut par défaut
          if (body.master != null && body.master !== '') {
            // vidéo du changement de personnage = un résultat kie rapatrié dans le dossier du compte, rien d'autre
            const m = cheminSur(user.id, body.master)
            if (!m || !m.startsWith(`${user.id}/kie/`) || !/\.mp4$/i.test(m)) return json({ error: 'chemin invalide' }, 400)
            assets = [{ id: 'master', path: m, kind: 'video' }]
          }
          plan = { __compose: 'decupleur', a, b, n, alt, textPos, seed: Math.floor(Math.random() * 2147483647), duration: b - a }
        }
      }
      // Variantes d'un compte payant : op désignée revérifiée (resolve_op), tirée ENTIÈRE avec un minimum = le prix du lot
      let tire: { op: string; amt: number } | null = null
      if (body.action === 'decupleur' && !dcExempt) {
        const cout = Math.ceil(Number(plan.n) * DC_CR_VARIANTE)
        const op = String((Array.isArray(body.ops) ? body.ops[0] : '') ?? '').trim()
        if (!/^[0-9a-f-]{36}$/i.test(op)) return json({ error: 'Aucune réservation de crédits pour ce décuplage.' }, 402)
        const { data: _op, error: _oe } = await service.rpc('resolve_op', { p_user: user.id, p_hint: op })
        if (_oe) return json({ error: 'Vérification des crédits impossible — réessaie dans un instant' }, 503)
        if (_op !== op) return json({ error: 'Aucune réservation de crédits pour ce décuplage.' }, 402)
        let amt = 0
        try { const { data: _d } = await service.rpc('draw_full_reservation', { p_user: user.id, p_op: op, p_min: cout }); amt = Number(_d) || 0 } catch (_) { amt = 0 }
        if (amt < cout) {
          if (amt > 0) { try { await service.rpc('release_reservation', { p_user: user.id, p_op: op, p_cost: amt }) } catch (_) { /* best-effort */ } }
          return json({ error: 'Réservation de crédits insuffisante pour ce décuplage.' }, 402)
        }
        tire = { op, amt }
      }
      const { data, error } = await service.from('render_jobs')
        .insert({ user_id: user.id, status: 'queued', plan, input_video: input, assets, avatar_clips: [] })
        .select('id').single()
      if (error || !data) {
        if (tire) { try { await service.rpc('release_reservation', { p_user: user.id, p_op: tire.op, p_cost: tire.amt }) } catch (_) { /* best-effort */ } }
        return json({ error: 'creation impossible' }, 500)
      }
      if (tire) {
        // liée au job : règlement à la livraison, remboursement à l'échec (render-worker reservationJob). Une op déjà liée à
        // un autre rendu (bind = false) : job fermé AVANT d'être pris, tirage rendu → 402 (jamais un rendu payé deux fois).
        let lie = true
        try { const { data: _l, error: _le } = await service.rpc('bind_reservation_job', { p_user: user.id, p_op: tire.op, p_job: cleRendu(data.id)[0], p_drawn: tire.amt }); if (!_le && _l === false) lie = false }
        catch (e) { console.warn('bind décupleur:', (e as Error).message) }
        if (!lie) {
          const { data: clos } = await service.from('render_jobs').update({ status: 'failed', error: 'réservation déjà liée à un autre rendu' })
            .eq('id', data.id).eq('status', 'queued').select('id')
          if (clos && clos.length) {
            try { await service.rpc('release_reservation', { p_user: user.id, p_op: tire.op, p_cost: tire.amt }) } catch (_) { /* best-effort */ }
            return json({ error: 'Réservation de crédits insuffisante pour ce décuplage.' }, 402)
          }
        }
      }
      return json({ ok: true, job_id: data.id })
    }

    if (body.action === 'last') {
      // le dernier montage TERMINÉ du compte — l'entrée dev « Détails montage »
      // ouvre l'écran de révision dessus sans relancer un rendu.
      // On IGNORE les jobs techniques (batch d'aperçus d'anims, plan.__batchBlank) :
      // ils n'ont pas de slides → « plan illisible » sur le dernier montage.
      const { data: job } = await service.from('render_jobs')
        .select('id').eq('user_id', user.id).eq('status', 'done')
        .is('plan->__batchBlank', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      return json({ ok: true, job_id: job?.id ?? null })
    }

    if (body.action === 'status') {
      const id = String(body.job_id || '')
      if (!id) return json({ error: 'job_id manquant' }, 400)
      const { data: job, error } = await service.from('render_jobs')
        .select('id, user_id, status, output_url, error, plan, input_video, assets, avatar_clips, progress, created_at').eq('id', id).single()
      if (error || !job) return json({ error: 'job introuvable' }, 404)
      if (job.user_id !== user.id) return json({ error: 'acces refuse' }, 403)
      let url: string | null = null
      let derived_url: string | null = null
      if (job.status === 'done' && job.output_url) {
        const { data: signed } = await service.storage.from('render-media')
          .createSignedUrl(job.output_url, 3600, { download: 'montage-final.mp4' })
        url = signed?.signedUrl ?? null
        // le plan DÉRIVÉ (écrit par le worker à côté du MP4) : c'est lui que lit
        // l'écran « Détails du montage » — la dérivation tranche, pas le chef
        const { data: dsigned } = await service.storage.from('render-media')
          .createSignedUrl(job.output_url + '.derived.json', 3600)
        derived_url = dsigned?.signedUrl ?? null
      }
      // ── L'APERÇU A BESOIN DE LA VIDÉO D'ORIGINE, PAS DU MONTAGE ───────────
      // Axel, 03/08 : « quand j'écarte et que du coup y'a la vidéo par défaut,
      // la vidéo ne bouge pas ; faudrait qu'elle tourne en fond et prenne le
      // relais ». L'éditeur lisait le montage DÉJÀ RENDU : sous les panneaux
      // qu'il déplace, il n'y avait donc pas sa vidéo mais le résultat
      // précédent, animations incrustées comprises. Écarter une scène ne
      // pouvait rien révéler.
      // On signe la source pour que l'aperçu montre ce que le rendu montrera
      // vraiment dans les trous : sa vidéo, à sa seconde, en mouvement.
      let source_url: string | null = null
      // Audit 02/10 (WRK-1) : jamais signer (1 h) une source hors du dossier du compte — défense en profondeur pour les
      // lignes créées avant le durcissement de 'create' (« commence par <uid>/ » laissait passer un segment parent).
      if (job.input_video && cheminSur(user.id, job.input_video) === job.input_video) {
        const { data: ssigned } = await service.storage.from('render-media')
          .createSignedUrl(job.input_video, 3600)
        source_url = ssigned?.signedUrl ?? null
      }
      // Décupleur : les N variantes (téléchargement), leurs affiches, le ZIP et le contrôle des empreintes (dc.json du moteur)
      let dc: Record<string, unknown> = {}
      const cmp = (job.plan as { __compose?: string } | null)?.__compose
      if (job.status === 'done' && cmp === 'decupleur' && job.output_url && cheminSur(user.id, job.output_url) === job.output_url && /\/dc\.json$/.test(job.output_url)) {
        const prefixe = job.output_url.slice(0, -'/dc.json'.length)
        const st = service.storage.from('render-media')
        let man: { variantes?: { fichier: string; affiche: string; distOriginal?: number; distMin?: number }[]; zip?: boolean; controle?: string; faibles?: number; passage?: number } = {}
        try { const { data: f } = await st.download(job.output_url); if (f) man = JSON.parse(await f.text()) } catch (_) { man = {} }
        const vs = (man.variantes ?? []).filter((v) => /^v\d{2}\.mp4$/.test(v.fichier) && /^v\d{2}\.jpg$/.test(v.affiche)).slice(0, 50)
        const [dl, af, zp, pl] = await Promise.all([
          vs.length ? st.createSignedUrls(vs.map((v) => `${prefixe}/${v.fichier}`), 7200, { download: true }) : Promise.resolve({ data: [] }),
          vs.length ? st.createSignedUrls(vs.map((v) => `${prefixe}/${v.affiche}`), 7200) : Promise.resolve({ data: [] }),
          // 25/10 : ZIP nommé comme le dossier (Safari l'ouvre en dossier « AvatarAds-variantes-JJ-MM-HHhMM »), heure de Paris
          man.zip ? st.createSignedUrl(`${prefixe}/variantes.zip`, 7200, { download: 'AvatarAds-variantes-' + new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(job.created_at || Date.now())).replace(/\//g, '-').replace(/\s+/g, '-').replace(':', 'h') + '.zip' }) : Promise.resolve({ data: null }),
          vs.length ? st.createSignedUrls(vs.map((v) => `${prefixe}/${v.fichier}`), 7200) : Promise.resolve({ data: [] }),   // 25/10 : lecture
        ])
        dc = { variants: vs.map((v, i) => ({ n: Number(v.fichier.slice(1, 3)), url: (dl.data ?? [])[i]?.signedUrl ?? null, play: (pl.data ?? [])[i]?.signedUrl ?? null,
            poster: (af.data ?? [])[i]?.signedUrl ?? null, distOriginal: v.distOriginal ?? null, distMin: v.distMin ?? null })),
          zip: (zp.data as { signedUrl?: string } | null)?.signedUrl ?? null, controle: man.controle ?? null, faibles: man.faibles ?? 0, passage: man.passage ?? null,
          n_total: vs.length }
      } else if (cmp === 'decupleur' && job.status !== 'done' && job.status !== 'failed') {
        // 25/10 (Axel) : lot EN COURS — les variantes déjà envoyées par le moteur (vNN.mp4 + vNN.jpg sous <uid>/dc-<job>/),
        // pour que l'app les montre (et les fasse lire) pendant que les suivantes se fabriquent. Dossier du compte seulement.
        const prefixe = `${user.id}/dc-${job.id}`, st = service.storage.from('render-media')
        const { data: objs } = await st.list(prefixe, { limit: 200 })
        const noms = new Set((objs ?? []).map((o) => o.name))
        const prets = [...noms].filter((f) => /^v\d{2}\.mp4$/.test(f)).sort().slice(0, 50)
        const nTot = Number((job.plan as { n?: number } | null)?.n) || null
        if (prets.length) {
          const affs = prets.map((f) => f.replace(/\.mp4$/, '.jpg'))
          const [dl, pl, af] = await Promise.all([
            st.createSignedUrls(prets.map((f) => `${prefixe}/${f}`), 7200, { download: true }),
            st.createSignedUrls(prets.map((f) => `${prefixe}/${f}`), 7200),
            st.createSignedUrls(affs.map((f) => `${prefixe}/${f}`), 7200),
          ])
          dc = { variants: prets.map((f, i) => ({ n: Number(f.slice(1, 3)), url: (dl.data ?? [])[i]?.signedUrl ?? null, play: (pl.data ?? [])[i]?.signedUrl ?? null,
            poster: noms.has(affs[i]) ? (af.data ?? [])[i]?.signedUrl ?? null : null })), n_total: nTot }
        } else dc = { variants: [], n_total: nTot }
      }
      // plan/input/assets/clips : ce qu'il faut pour RÉGÉNÉRER avec des
      // personnalisations sans que le client ait à garder d'état local
      return json({ ok: true, status: job.status, url, derived_url, source_url, error: job.error, progress: job.progress ?? null, ...dc,
        plan: job.plan, input_video: job.input_video, assets: job.assets, avatar_clips: job.avatar_clips })
    }

    return json({ error: 'action inconnue' }, 400)
  } catch (err) {
    console.error('render-job error:', err)
    return json({ error: String((err as Error)?.message || err).slice(0, 300) }, 500)
  }
})
